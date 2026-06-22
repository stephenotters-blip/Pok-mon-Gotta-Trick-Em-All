const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const G = require('./game-logic.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

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
function personalize(state, viewerId){
  const safeHands = {};
  Object.keys(state.hands).forEach(pid=>{
    safeHands[pid] = pid === viewerId ? state.hands[pid] : { count: state.hands[pid].length };
  });
  const legalKeys = (G.currentTurnPlayerId(state) === viewerId && !state.awaitingContinue && !state.awaitingRoundContinue)
    ? G.legalPlays(state, viewerId)
    : [];
  const pokemonDefsByKey = {};
  G.POKEMON_DEFS.forEach(d=> pokemonDefsByKey[d.key] = d);
  return {
    ...state,
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
      io.to(p.socketId).emit('state', personalize(room.state, p.id));
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

// If it's a bot's turn, have it play after a human-like delay.
function maybeRunBot(room){
  const s = room.state;
  if(!s || s.phase !== 'playing' || s.awaitingContinue || s.awaitingRoundContinue) return;
  if(room._pendingBotMove) return;
  const turnId = G.currentTurnPlayerId(s);
  const turnPlayer = s.players.find(p=>p.id===turnId);
  if(!turnPlayer || !turnPlayer.isBot) return;
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

io.on('connection', (socket)=>{

  socket.on('createRoom', ({name})=>{
    const code = makeUniqueRoomCode();
    const player = { id: G.makeId(), socketId: socket.id, name: (name||'Player').slice(0,20), connected:true };
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
    const player = { id: G.makeId(), socketId: socket.id, name: (name||'Player').slice(0,20), connected:true };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.emit('joined', { code, playerId: player.id });
    broadcastLobby(room);
  });

  socket.on('startGame', ({consolationRule, fillWithBots, totalPlayers})=>{
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
    room.state = G.initGameState(gamePlayers, { consolationRule: !!consolationRule });
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
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.emit('joined', { code, playerId: player.id });
    broadcastLobby(room);
    if(room.state){
      io.to(socket.id).emit('state', personalize(room.state, player.id));
    }
  });

  socket.on('disconnect', ()=>{
    const room = rooms[socket.data.roomCode];
    if(!room) return;
    const player = room.players.find(p=>p.id === socket.data.playerId);
    if(player) player.connected = false;
    broadcastLobby(room);
    // Rooms with no game in progress and everyone gone get cleaned up.
    if(!room.started && room.players.every(p=>!p.connected)){
      delete rooms[room.code];
    }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`Server listening on port ${PORT}`));
