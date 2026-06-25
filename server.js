const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const G = require('./game-logic.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---- Basic chat profanity filter ----
// Not exhaustive, but covers common cases. Matches whole words only (so it
// doesn't mangle innocent words that merely contain a substring), and
// replaces the match with asterisks rather than rejecting the whole message.
const BAD_WORDS = [
  'fuck','shit','bitch','asshole','bastard','cunt','dick','piss','cock',
  'pussy','slut','whore','fag','retard','nigger','nigga'
];
const BAD_WORDS_RE = new RegExp('\\b(' + BAD_WORDS.join('|') + ')\\w*\\b', 'gi');
function censorText(text){
  return text.replace(BAD_WORDS_RE, (match)=> match[0] + '*'.repeat(Math.max(1, match.length-1)));
}

// ---- In-memory room storage ----
// rooms[code] = {
//   code, players: [{id, socketId, name, connected}],
//   state: <game state or null until started>,
//   started: boolean
// }
const rooms = {};

function makeUniqueRoomCode(){
  let code;
  do { code = G.makeRoomCode(); } while(rooms[code]);
  return code;
}

// Build a per-viewer-safe copy of the state: every player's hand is hidden
// except the viewer's own (others just get a card count).
function personalize(state, viewerId, roomPlayers){
  const safeHands = {};
  Object.keys(state.hands).forEach(pid=>{
    safeHands[pid] = pid === viewerId ? state.hands[pid] : { count: state.hands[pid].length };
  });
  const legalKeys = (G.currentTurnPlayerId(state) === viewerId && !state.awaitingContinue && !state.awaitingRoundContinue)
    ? G.legalPlays(state, viewerId)
    : [];
  const pokemonDefsByKey = {};
  G.POKEMON_DEFS.forEach(d=> pokemonDefsByKey[d.key] = d);
  const connectedById = {};
  (roomPlayers||[]).forEach(p=> connectedById[p.id] = !!p.connected || !!p.isBot);
  const playersWithStatus = state.players.map(p=> ({...p, connected: connectedById[p.id] !== false}));
  return {
    ...state,
    players: playersWithStatus,
    hands: safeHands,
    yourId: viewerId,
    isYourTurn: G.currentTurnPlayerId(state) === viewerId,
    turnPlayerId: G.currentTurnPlayerId(state),
    order: G.turnOrder(state),
    legalKeys,
    pokemonDefsByKey
  };
}

function broadcastState(room){
  if(!room.state) return;
  room.players.forEach(p=>{
    if(p.socketId){
      io.to(p.socketId).emit('state', personalize(room.state, p.id, room.players));
    }
  });
}

function broadcastLobby(room){
  io.to(room.code).emit('lobby', {
    code: room.code,
    started: room.started,
    players: room.players.map(p=>({name:p.name, connected:p.connected, isBot:!!p.isBot}))
  });
}

// Server-side auto-continue, mirroring the original client timing.
function scheduleAutoContinue(room){
  if(room._autoContinueTimer) return;
  room._autoContinueTimer = setTimeout(()=>{
    room._autoContinueTimer = null;
    if(room.state && room.state.awaitingContinue){
      G.continueAfterTrick(room.state);
      broadcastState(room);
      if(room.state.awaitingRoundContinue) scheduleAutoRoundContinue(room);
      else maybeRunBot(room);
    }
  }, 2200);
}
function scheduleAutoRoundContinue(room){
  if(room._autoRoundTimer) return;
  room._autoRoundTimer = setTimeout(()=>{
    room._autoRoundTimer = null;
    if(room.state && room.state.awaitingRoundContinue){
      G.continueAfterRound(room.state);
      broadcastState(room);
      maybeRunBot(room);
    }
  }, 4500);
}

// If it's a bot's turn, have it play after a human-like delay. Also covers
// the disconnect-grace check for human turns, so every call site that
// already calls this gets both behaviors for free.
function maybeRunBot(room){
  const s = room.state;
  if(!s || s.phase !== 'playing' || s.awaitingContinue || s.awaitingRoundContinue) return;
  const turnId = G.currentTurnPlayerId(s);
  const turnPlayer = s.players.find(p=>p.id===turnId);
  if(!turnPlayer) return;
  if(!turnPlayer.isBot){
    scheduleDisconnectGrace(room);
    return;
  }
  if(room._pendingBotMove) return;
  room._pendingBotMove = true;
  setTimeout(()=>{
    room._pendingBotMove = false;
    if(!room.state || room.state.phase !== 'playing') return;
    const cardKey = G.botChooseCard(room.state, turnId);
    G.applyPlayCard(room.state, turnId, cardKey);
    broadcastState(room);
    if(room.state.awaitingContinue) scheduleAutoContinue(room);
    else maybeRunBot(room); // chain in case the next seat is also a bot
  }, 1200 + Math.random()*1300);
}

// Safety net: if it's a disconnected human's turn and they don't reconnect
// within the grace period, auto-play a reasonable card for them so the game
// doesn't stall forever for everyone else. Cancelled automatically the next
// time state changes (a fresh timer is only set if still relevant).
const DISCONNECT_GRACE_MS = 30000;
function scheduleDisconnectGrace(room){
  if(room._disconnectGraceTimer) return;
  const s = room.state;
  if(!s || s.phase !== 'playing' || s.awaitingContinue || s.awaitingRoundContinue) return;
  const turnId = G.currentTurnPlayerId(s);
  const roomPlayer = room.players.find(p=>p.id===turnId);
  if(!roomPlayer || roomPlayer.isBot || roomPlayer.connected) return;
  room._disconnectGraceTimer = setTimeout(()=>{
    room._disconnectGraceTimer = null;
    if(!room.state || room.state.phase !== 'playing') return;
    const stillTurnId = G.currentTurnPlayerId(room.state);
    const stillPlayer = room.players.find(p=>p.id===stillTurnId);
    if(!stillPlayer || stillPlayer.isBot || stillPlayer.connected) return; // reconnected or moved on already
    const cardKey = G.botChooseCard(room.state, stillTurnId);
    G.applyPlayCard(room.state, stillTurnId, cardKey);
    room.state.log.push(`${stillPlayer.name} was disconnected too long — a card was auto-played for them.`);
    broadcastState(room);
    if(room.state.awaitingContinue) scheduleAutoContinue(room);
    else maybeRunBot(room);
  }, DISCONNECT_GRACE_MS);
}

io.on('connection', (socket)=>{

  socket.on('createRoom', ({name})=>{
    const code = makeUniqueRoomCode();
    const player = { id: G.makeId(), socketId: socket.id, name: censorText((name||'Player').slice(0,20)), connected:true };
    rooms[code] = { code, players:[player], state:null, started:false };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.emit('joined', { code, playerId: player.id });
    broadcastLobby(rooms[code]);
  });

  socket.on('joinRoom', ({code, name})=>{
    code = (code||'').toUpperCase().trim();
    const room = rooms[code];
    if(!room) return socket.emit('errorMsg', 'Room not found.');
    if(room.started) return socket.emit('errorMsg', 'That game already started.');
    if(room.players.length >= 4) return socket.emit('errorMsg', 'Room is full (max 4 players).');
    const player = { id: G.makeId(), socketId: socket.id, name: censorText((name||'Player').slice(0,20)), connected:true };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.emit('joined', { code, playerId: player.id });
    socket.emit('chatHistory', room.chatLog || []);
    broadcastLobby(room);
  });

  socket.on('rematch', ({consolationRule, bonusRule})=>{
    const room = rooms[socket.data.roomCode];
    if(!room || !room.state) return;
    if(room.state.phase !== 'gameOver') return; // only allowed once a game has actually ended
    const pid = socket.data.playerId;

    room.rematchVotes = room.rematchVotes || new Set();
    room.rematchVotes.add(pid);
    room._rematchConsolationRule = consolationRule;
    room._rematchBonusRule = bonusRule;

    // Bots always count as ready; only connected humans need to actively vote.
    const requiredVoterIds = room.players.filter(p=> !p.isBot && p.connected).map(p=>p.id);
    const votedNames = room.players.filter(p=> room.rematchVotes.has(p.id)).map(p=>p.name);
    const allReady = requiredVoterIds.every(id => room.rematchVotes.has(id));

    io.to(room.code).emit('rematchStatus', {
      votedNames,
      requiredCount: requiredVoterIds.length,
      votedCount: requiredVoterIds.filter(id=>room.rematchVotes.has(id)).length
    });

    if(!allReady) return;

    // Everyone's ready — start the new game.
    room.rematchVotes = new Set();
    const gamePlayers = room.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot}));
    room.state = G.initGameState(gamePlayers, {
      consolationRule: room._rematchConsolationRule != null ? !!room._rematchConsolationRule : room.state.consolationRule,
      bonusRule: room._rematchBonusRule != null ? !!room._rematchBonusRule : room.state.bonusRule
    });
    G.revealNextPokemon(room.state);
    broadcastState(room);
    maybeRunBot(room);
  });

  socket.on('startGame', ({consolationRule, bonusRule, fillWithBots, totalPlayers})=>{
    const room = rooms[socket.data.roomCode];
    if(!room || room.started) return;
    if(room.players.length < 2 && !fillWithBots) return socket.emit('errorMsg', 'Need at least 2 players to start (or fill empty seats with bots).');
    room.started = true;
    const gamePlayers = room.players.map(p=>({id:p.id, name:p.name, isBot:false}));
    if(fillWithBots){
      const target = Math.max(gamePlayers.length, Math.min(4, parseInt(totalPlayers) || 4));
      const botNames = ['Bot 1','Bot 2','Bot 3','Bot 4'];
      let n = 0;
      while(gamePlayers.length < target){
        const id = G.makeId();
        gamePlayers.push({id, name: botNames[n++], isBot:true});
        room.players.push({id, socketId:null, name: botNames[n-1], connected:true, isBot:true});
      }
    }
    room.state = G.initGameState(gamePlayers, { consolationRule: !!consolationRule, bonusRule: bonusRule !== false });
    G.revealNextPokemon(room.state);
    broadcastLobby(room);
    broadcastState(room);
    maybeRunBot(room);
  });

  socket.on('playCard', ({cardKey})=>{
    const room = rooms[socket.data.roomCode];
    if(!room || !room.state) return;
    const s = room.state;
    const pid = socket.data.playerId;
    if(G.currentTurnPlayerId(s) !== pid) return socket.emit('errorMsg', "It's not your turn.");
    if(!G.legalPlays(s, pid).includes(cardKey)) return socket.emit('errorMsg', 'That card is not legal right now.');
    G.applyPlayCard(s, pid, cardKey);
    broadcastState(room);
    if(s.awaitingContinue) scheduleAutoContinue(room);
    else maybeRunBot(room);
  });

  // Rejoin an existing seat after a page refresh or dropped connection,
  // using the stable player id issued at join time (kept in the client's
  // localStorage, not the socket id, which changes every connection).
  socket.on('rejoinRoom', ({code, playerId})=>{
    code = (code||'').toUpperCase().trim();
    const room = rooms[code];
    if(!room) return socket.emit('errorMsg', 'rejoin-failed');
    const player = room.players.find(p=>p.id === playerId);
    if(!player) return socket.emit('errorMsg', 'rejoin-failed');
    player.socketId = socket.id;
    player.connected = true;
    if(room._disconnectGraceTimer){ clearTimeout(room._disconnectGraceTimer); room._disconnectGraceTimer = null; }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.emit('joined', { code, playerId: player.id });
    socket.emit('chatHistory', room.chatLog || []);
    broadcastLobby(room);
    if(room.state){
      io.to(socket.id).emit('state', personalize(room.state, player.id, room.players));
    }
  });

  socket.on('disconnect', ()=>{
    const room = rooms[socket.data.roomCode];
    if(!room) return;
    const player = room.players.find(p=>p.id === socket.data.playerId);
    if(player) player.connected = false;
    broadcastLobby(room);
    if(room.state) scheduleDisconnectGrace(room);
    // If a rematch vote is in progress, recompute in case this drop-out
    // means everyone remaining is now actually ready.
    if(room.state && room.state.phase === 'gameOver' && room.rematchVotes){
      const requiredVoterIds = room.players.filter(p=> !p.isBot && p.connected).map(p=>p.id);
      const votedNames = room.players.filter(p=> room.rematchVotes.has(p.id)).map(p=>p.name);
      const votedCount = requiredVoterIds.filter(id=>room.rematchVotes.has(id)).length;
      io.to(room.code).emit('rematchStatus', { votedNames, requiredCount: requiredVoterIds.length, votedCount });
      if(requiredVoterIds.length > 0 && votedCount === requiredVoterIds.length){
        room.rematchVotes = new Set();
        const gamePlayers = room.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot}));
        room.state = G.initGameState(gamePlayers, {
          consolationRule: room._rematchConsolationRule != null ? !!room._rematchConsolationRule : room.state.consolationRule,
          bonusRule: room._rematchBonusRule != null ? !!room._rematchBonusRule : room.state.bonusRule
        });
        G.revealNextPokemon(room.state);
        broadcastState(room);
        maybeRunBot(room);
      }
    }
    // Rooms with no game in progress and everyone gone get cleaned up.
    if(!room.started && room.players.every(p=>!p.connected)){
      delete rooms[room.code];
    }
  });

  socket.on('sendChatMessage', ({text})=>{
    const room = rooms[socket.data.roomCode];
    if(!room) return;
    const player = room.players.find(p=>p.id === socket.data.playerId);
    if(!player) return;
    let clean = String(text||'').slice(0, 300).trim();
    if(!clean) return;
    clean = censorText(clean);
    const msg = { name: player.name, text: clean, ts: Date.now() };
    room.chatLog = room.chatLog || [];
    room.chatLog.push(msg);
    if(room.chatLog.length > 100) room.chatLog.shift();
    io.to(room.code).emit('chatMessage', msg);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`Server listening on port ${PORT}`));
