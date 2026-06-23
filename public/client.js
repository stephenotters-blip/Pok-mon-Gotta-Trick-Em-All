/* ===================== IMAGES ===================== */
let CARD_IMG = {};
function imgSrc(key){
  const b64 = CARD_IMG[key];
  return b64 ? `data:image/png;base64,${b64}` : '';
}

/* ===================== NETWORK ===================== */
const socket = io();
let screen = 'home';      // home | lobby | game
let nameInput = '';
let joinCodeInput = '';
let errorMsg = '';
let myId = null;
let myRoomCode = null;
let lobbyInfo = null;     // {code, started, players:[{name,connected}]}
let gameState = null;     // latest personalized state from server
let consolationRuleEnabled = false;
let fillWithBotsEnabled = false;
let desiredPlayerCount = 4;
let showPlayerAid = false;
let showChat = false;
let chatMessages = [];
let chatInput = '';
let unreadChatCount = 0;
let rematchStatus = null; // {votedNames, requiredCount, votedCount}
let myRematchVote = false;

function helpButtonEl(){
  return h('button', {class:'help-circle', onClick: ()=>{ showPlayerAid = true; render(); }}, '?');
}

function chatButtonEl(){
  const btn = h('button', {class:'help-circle chat-circle', onClick: ()=>{ showChat = true; unreadChatCount = 0; render(); }}, '💬');
  if(unreadChatCount > 0){
    btn.appendChild(h('span', {class:'chat-badge'}, String(Math.min(unreadChatCount, 9))));
  }
  return btn;
}

function renderPlayerAidModal(){
  const overlay = h('div', {class:'modal-overlay', onClick: (e)=>{ if(e.target.classList.contains('modal-overlay')){ showPlayerAid=false; render(); } }});
  const box = h('div', {class:'modal-box'});
  box.appendChild(h('div', {class:'row', style:'justify-content:space-between;align-items:center;margin-bottom:10px;'}, [
    h('strong', {style:'font-size:1.1rem;'}, '📖 Player Aid — Quick Reference'),
    h('button', {class:'secondary', onClick: ()=>{ showPlayerAid=false; render(); }}, 'Close ✕')
  ]));

  const section = (title, lines)=>{
    box.appendChild(h('div', {class:'aid-section'}, [
      h('div', {class:'aid-title'}, title),
      ...lines.map(l=> h('div', {class:'aid-line'}, l))
    ]));
  };

  section('Setup', [
    '40 Ball Cards (4 suits × 1-10) + 20 Pokémon Cards, shuffled separately.',
    'Each player is dealt 7 Ball Cards. Remainder forms the draw pile.'
  ]);
  section('Each Trick', [
    '1. Flip the top Pokémon card — note its point value and Wild Suit.',
    '2. Starting left of the dealer/last winner, each player plays one card.',
    '3. Follow the Lead Suit if you hold it. A Wild Suit card is always a legal alternative (never mandatory). If you hold neither, any card is legal.'
  ]);
  section('Resolving the Trick', [
    'Wild Suit beats everything — highest Wild Suit card played wins.',
    'No Wild Suit played? Highest card of the Lead Suit wins.',
    'Any other suit can never win the trick, regardless of value.'
  ]);
  section('After the Trick', [
    'Winner takes the Pokémon card — it counts toward their score this round.',
    'Caught Pokémon are removed from the game permanently.',
    'All players immediately draw back up to 7 cards. Winner leads the next trick.'
  ]);
  section('End of Round (after 4 tricks)', [
    'Total the points of Pokémon you caught this round.',
    'Highest round total earns a +3 bonus (ties: everyone tied for the top earns it).'
  ]);
  section('Winning', [
    'After 4 rounds (16 tricks), highest total score wins.',
    'Tiebreaker: most Pokémon caught, then who won the most recent trick.'
  ]);

  overlay.appendChild(box);
  return overlay;
}

socket.on('joined', ({code, playerId})=>{
  myId = playerId; myRoomCode = code; errorMsg='';
  localStorage.setItem('pkTrickSession', JSON.stringify({code, playerId, name: nameInput}));
  screen = 'lobby';
  render();
});
socket.on('lobby', (info)=>{ lobbyInfo = info; if(screen!=='game') screen='lobby'; render(); });
socket.on('chatHistory', (msgs)=>{ chatMessages = msgs; render(); });
socket.on('chatMessage', (msg)=>{
  chatMessages.push(msg);
  if(chatMessages.length>100) chatMessages.shift();
  if(!showChat) unreadChatCount++;
  render();
});
socket.on('rematchStatus', (status)=>{ rematchStatus = status; render(); });
socket.on('state', (s)=>{
  // A fresh (non-gameOver) state means either the first start or a rematch
  // actually kicked off — clear any stale rematch UI from the previous game.
  if(s.phase !== 'gameOver'){ rematchStatus = null; myRematchVote = false; }
  gameState = s; screen = 'game'; render();
});
socket.on('errorMsg', (msg)=>{
  if(msg === 'rejoin-failed'){
    localStorage.removeItem('pkTrickSession');
    screen = 'home';
    render();
    return;
  }
  errorMsg = msg; render();
});

// If we have a saved session from before a refresh/disconnect, try to
// silently rejoin that seat instead of showing the home screen.
(function tryAutoRejoin(){
  const raw = localStorage.getItem('pkTrickSession');
  if(!raw) return;
  try{
    const saved = JSON.parse(raw);
    if(saved && saved.code && saved.playerId){
      nameInput = saved.name || '';
      myRoomCode = saved.code;
      socket.emit('rejoinRoom', { code: saved.code, playerId: saved.playerId });
    }
  } catch(e){ /* ignore corrupt session data */ }
})();

/* ===================== DOM HELPER ===================== */
function h(tag, attrs={}, children=[]){
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k === 'class') el.className = v;
    else if(k === 'onClick') el.addEventListener('click', v);
    else if(k === 'oninput') el.addEventListener('input', v);
    else if(k === 'onclick') el.addEventListener('click', v);
    else if(k === 'style') el.setAttribute('style', v);
    else el.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c=>{
    if(c == null) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

/* ===================== CARD RENDERING (ported as-is) ===================== */
let _flippedSlotCards = {};
function cardEl(cardKey, opts={}){
  const cls = 'card' + (opts.extraClass ? ' '+opts.extraClass : '');
  const el = h('div', {class: cls});
  if(cardKey){
    if(opts.flip){
      const flipKey = opts.flipKey;
      const isNew = _flippedSlotCards[flipKey] !== cardKey;
      _flippedSlotCards[flipKey] = cardKey;
      const flipWrap = h('div', {class:'card-flip'});
      const inner = h('div', {class:'card-flip-inner'});
      const front = h('div', {class:'card-flip-face'});
      front.appendChild(h('img', {src: imgSrc('numbercardback'), alt:'card back'}));
      const back = h('div', {class:'card-flip-face card-flip-back'});
      back.appendChild(h('img', {src: imgSrc(cardKey), alt: cardKey}));
      inner.appendChild(front); inner.appendChild(back);
      flipWrap.appendChild(inner);
      el.appendChild(flipWrap);
      if(isNew){
        el.classList.add('is-flipping');
        requestAnimationFrame(()=>{ requestAnimationFrame(()=> flipWrap.classList.add('flipped')); });
        setTimeout(()=> el.classList.remove('is-flipping'), 550);
      } else {
        flipWrap.classList.add('flipped');
      }
    } else {
      el.appendChild(h('img', {src: imgSrc(cardKey), alt: cardKey}));
    }
  } else {
    el.classList.add('empty');
    el.style.backgroundImage = `url(${imgSrc('numbercardback')})`;
    if(opts.flipKey) delete _flippedSlotCards[opts.flipKey];
  }
  if(opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

let _lastFlippedPokemonKey = null;
function pokemonCardEl(pk, opts={}){
  const sizeClass = opts.size ? `size-${opts.size}` : '';
  const el = h('div', {class: `pkcard ${sizeClass} ${opts.extraClass||''}`.trim()});

  // Small/medium thumbnails (scoreboard, round summary) never animate — they're
  // always shown already face-up — so skip the 3D flip structure entirely and
  // just render the art directly. This avoids relying on aspect-ratio + 3D
  // transforms together, which some mobile/tablet browsers render unreliably
  // at small sizes.
  if(opts.size !== 'lg'){
    el.appendChild(h('img', {src: imgSrc('pkfinal_'+pk.key), alt: pk.name, class:'pkcard-img'}));
    return el;
  }

  const flipWrap = h('div', {class:'pkcard-flip'});
  const inner = h('div', {class:'pkcard-flip-inner'});
  const front = h('div', {class:'pkcard-flip-face'});
  front.appendChild(h('img', {src: imgSrc('pkcardback'), alt:'card back'}));
  const back = h('div', {class:'pkcard-flip-face pkcard-flip-back'});
  back.appendChild(h('img', {src: imgSrc('pkfinal_'+pk.key), alt: pk.name}));
  inner.appendChild(front); inner.appendChild(back);
  flipWrap.appendChild(inner);
  el.appendChild(flipWrap);

  if(pk.key !== _lastFlippedPokemonKey){
    _lastFlippedPokemonKey = pk.key;
    el.classList.add('is-flipping');
    requestAnimationFrame(()=>{ requestAnimationFrame(()=> flipWrap.classList.add('flipped')); });
    setTimeout(()=> el.classList.remove('is-flipping'), 950);
  } else {
    flipWrap.classList.add('flipped');
  }
  return el;
}

function suitTagEl(suit){
  const SUIT_NAME = {poke:"Poké Ball", great:"Great Ball", ultra:"Ultra Ball", master:"Master Ball"};
  return h('span', {class:`suit-tag suit-${suit}`}, [h('span',{class:'suit-dot'}), SUIT_NAME[suit]]);
}

/* ===================== SCREENS ===================== */
function header(){
  return h('div', {class:'row', style:'justify-content:space-between;align-items:flex-start;'}, [
    h('div', {}, [
      h('h1', {}, "Pokémon: Gotta Trick 'Em All"),
      h('div', {class:'subtitle'}, "Online multiplayer — up to 4 players, trick-taking")
    ]),
    h('div', {class:'row', style:'gap:8px;'}, [chatButtonEl(), helpButtonEl()])
  ]);
}

function renderChatModal(){
  const overlay = h('div', {class:'modal-overlay', onClick: (e)=>{ if(e.target.classList.contains('modal-overlay')){ showChat=false; render(); } }});
  const box = h('div', {class:'modal-box chat-modal-box'});
  box.appendChild(h('div', {class:'row', style:'justify-content:space-between;align-items:center;margin-bottom:10px;'}, [
    h('strong', {style:'font-size:1.1rem;'}, '💬 Chat'),
    h('button', {class:'secondary', onClick: ()=>{ showChat=false; render(); }}, 'Close ✕')
  ]));

  const list = h('div', {class:'chat-messages'});
  chatMessages.slice(-50).forEach(m=>{
    list.appendChild(h('div', {class:'chat-line'}, [
      h('span', {class:'chat-name'}, m.name + ': '),
      h('span', {}, m.text)
    ]));
  });
  if(chatMessages.length === 0) list.appendChild(h('div', {class:'small'}, 'No messages yet — say hi!'));
  box.appendChild(list);

  const inputEl = h('input', {type:'text', placeholder:'Say something...', value: chatInput, style:'flex:1;'});
  inputEl.addEventListener('input', e=> chatInput = e.target.value);
  const sendChat = ()=>{
    const text = inputEl.value.trim();
    if(!text) return;
    socket.emit('sendChatMessage', {text});
    chatInput = '';
    render();
    requestAnimationFrame(()=>{
      const el = document.querySelector('.chat-modal-box input[type=text]');
      if(el) el.focus();
    });
  };
  inputEl.addEventListener('keydown', e=>{ if(e.key === 'Enter') sendChat(); });
  box.appendChild(h('div', {class:'row', style:'margin-top:8px;'}, [
    inputEl,
    h('button', {onClick: sendChat}, 'Send')
  ]));

  requestAnimationFrame(()=>{
    list.scrollTop = list.scrollHeight;
    const el = document.querySelector('.chat-modal-box input[type=text]');
    if(el) el.focus();
  });

  overlay.appendChild(box);
  return overlay;
}

function renderHome(){
  const wrap = h('div');
  wrap.appendChild(header());

  const hero = h('div', {class:'panel lobby-hero'}, [
    h('div', {}, [h('strong',{},'Play online with friends in different locations.')])
  ]);
  wrap.appendChild(hero);

  const panel = h('div', {class:'panel'});
  const nameEl = h('input', {type:'text', placeholder:'Your name', value: nameInput});
  nameEl.addEventListener('input', e=> nameInput = e.target.value);
  panel.appendChild(h('div', {}, [h('strong',{},'Your name')]));
  panel.appendChild(h('div', {class:'row', style:'margin-top:8px;margin-bottom:16px;'}, [nameEl]));

  panel.appendChild(h('div', {}, [h('strong',{},'Create a new room')]));
  panel.appendChild(h('div', {class:'row', style:'margin-top:8px;margin-bottom:16px;'}, [
    h('button', {class:'gold', onClick: ()=>{
      if(!nameEl.value.trim()){ errorMsg='Enter your name first.'; render(); return; }
      socket.emit('createRoom', {name: nameEl.value.trim()});
    }}, 'Create Room')
  ]));

  panel.appendChild(h('div', {}, [h('strong',{},'Or join an existing room')]));
  const codeEl = h('input', {type:'text', placeholder:'Room code', value: joinCodeInput, style:'text-transform:uppercase;letter-spacing:2px;max-width:140px;'});
  codeEl.addEventListener('input', e=> joinCodeInput = e.target.value.toUpperCase());
  panel.appendChild(h('div', {class:'row', style:'margin-top:8px;'}, [
    codeEl,
    h('button', {class:'secondary', onClick: ()=>{
      if(!nameEl.value.trim()){ errorMsg='Enter your name first.'; render(); return; }
      if(!codeEl.value.trim()){ errorMsg='Enter a room code.'; render(); return; }
      socket.emit('joinRoom', {code: codeEl.value.trim(), name: nameEl.value.trim()});
    }}, 'Join Room')
  ]));

  wrap.appendChild(panel);
  if(errorMsg) wrap.appendChild(h('div', {class:'panel', style:'border:1px solid var(--bad);color:var(--bad);'}, errorMsg));
  wrap.appendChild(h('div', {class:'footer-note'}, "Share the room code with up to 3 friends so they can join from their own devices."));
  return wrap;
}

function renderLobby(){
  const wrap = h('div');
  wrap.appendChild(header());

  const panel = h('div', {class:'panel'});
  panel.appendChild(h('div', {}, [h('strong',{},'Room code')]));
  panel.appendChild(h('div', {class:'row', style:'margin:8px 0 16px;align-items:center;'}, [
    h('div', {class:'code-display'}, myRoomCode || lobbyInfo?.code || '')
  ]));
  panel.appendChild(h('div', {class:'small'}, 'Share this code with up to 3 friends. They enter it on the home screen to join.'));

  panel.appendChild(h('div', {style:'margin-top:18px;'}, [h('strong',{},`Players (${lobbyInfo ? lobbyInfo.players.length : 0}/4)`)]));
  const list = h('div', {class:'row', style:'margin-top:8px;flex-wrap:wrap;'});
  (lobbyInfo ? lobbyInfo.players : []).forEach(p=>{
    list.appendChild(h('div', {class:'pill'}, `${p.connected ? '🟢' : '⚪'} ${p.name}${p.isBot ? ' 🤖' : ''}`));
  });
  panel.appendChild(list);

  panel.appendChild(h('div', {style:'margin-top:18px;'}, [h('strong',{},'House rules')]));
  const toggleRow = h('div', {class:'row', style:'margin-top:8px;'});
  toggleRow.appendChild(h('button', {
    class: consolationRuleEnabled ? 'gold' : 'secondary',
    onClick: ()=>{ consolationRuleEnabled = !consolationRuleEnabled; render(); }
  }, consolationRuleEnabled ? '✓ Consolation rule: ON' : 'Consolation rule: OFF'));
  panel.appendChild(toggleRow);
  panel.appendChild(h('div', {class:'small', style:'margin-top:6px;'}, "If a player wins zero tricks in a round, they score the highest card value in their hand instead of 0."));

  const seatsOpen = lobbyInfo ? 4 - lobbyInfo.players.length : 3;
  if(seatsOpen > 0){
    const botToggleRow = h('div', {class:'row', style:'margin-top:10px;'});
    botToggleRow.appendChild(h('button', {
      class: fillWithBotsEnabled ? 'gold' : 'secondary',
      onClick: ()=>{ fillWithBotsEnabled = !fillWithBotsEnabled; render(); }
    }, fillWithBotsEnabled ? `✓ Fill empty seats with bots` : `Fill empty seats with bots: OFF`));
    panel.appendChild(botToggleRow);

    if(fillWithBotsEnabled){
      const humanCount = lobbyInfo.players.length;
      panel.appendChild(h('div', {class:'small', style:'margin-top:8px;'}, 'Total players (including you):'));
      const countRow = h('div', {class:'row', style:'margin-top:6px;'});
      for(let n = Math.max(2, humanCount); n <= 4; n++){
        countRow.appendChild(h('button', {
          class: desiredPlayerCount === n ? 'gold' : 'secondary',
          onClick: ()=>{ desiredPlayerCount = n; render(); }
        }, `${n} (${n - humanCount} bot${n - humanCount===1?'':'s'})`));
      }
      panel.appendChild(countRow);
    }
  }

  const canStart = lobbyInfo && (lobbyInfo.players.length >= 2 || fillWithBotsEnabled) && !lobbyInfo.started;
  if(lobbyInfo && desiredPlayerCount < lobbyInfo.players.length) desiredPlayerCount = Math.min(4, lobbyInfo.players.length);
  panel.appendChild(h('div', {class:'row', style:'margin-top:18px;'}, [
    h('button', {class: canStart ? 'gold' : 'secondary', onClick: ()=>{
      if(!canStart) return;
      socket.emit('startGame', {consolationRule: consolationRuleEnabled, fillWithBots: fillWithBotsEnabled, totalPlayers: desiredPlayerCount});
    }}, canStart ? 'Start Game' : 'Waiting for players (need 2+, or fill with bots)...')
  ]));

  wrap.appendChild(panel);
  if(errorMsg) wrap.appendChild(h('div', {class:'panel', style:'border:1px solid var(--bad);color:var(--bad);'}, errorMsg));
  return wrap;
}

function renderScoreboard(s, opts={}){
  const showRoundColumn = opts.showRoundColumn !== false;
  const panel = h('div', {class:'panel'});
  panel.appendChild(h('div', {}, [h('strong',{},'Scoreboard')]));
  const table = h('table', {class:'scoreboard'});
  const headerCells = [h('th',{},'Player')];
  if(showRoundColumn) headerCells.push(h('th',{},'Caught this round'));
  headerCells.push(h('th',{},'Total score'), h('th',{},'Total caught'));
  table.appendChild(h('tr', {}, headerCells));
  const playerList = opts.sortByScore
    ? s.players.slice().sort((a,b)=> s.totalScore[b.id] - s.totalScore[a.id])
    : s.players;
  playerList.forEach((p, idx)=>{
    const rank = opts.sortByScore ? `${idx+1}. ` : '';
    const cells = [h('td', {}, rank + p.name + (p.id===s.yourId?' (you)':''))];
    if(showRoundColumn){
      const caughtRound = s.caughtThisRound[p.id] || [];
      const roundPts = caughtRound.reduce((sum,k)=> sum + s.pokemonDefsByKey[k].points, 0);
      cells.push(h('td', {}, [h('div',{},`${roundPts} pt(s)`), (()=>{const r=h('div',{class:'caught-row'}); caughtRound.forEach(k=> r.appendChild(pokemonCardEl(s.pokemonDefsByKey[k], {size:'sm'}))); return r;})()]));
    }
    cells.push(h('td', {}, String(s.totalScore[p.id])), h('td', {}, String(s.totalCaught[p.id])));
    table.appendChild(h('tr', {}, cells));
  });
  panel.appendChild(table);
  return panel;
}

function renderRoundSummary(s){
  const wrap = h('div', {class:'panel'});
  const rs = s.roundSummary;
  wrap.appendChild(h('div', {class:'turn-banner mine'}, `Round ${rs.roundNumber} complete!`));
  const table = h('table', {class:'scoreboard', style:'margin-top:14px;'});
  table.appendChild(h('tr', {}, [h('th',{},'Player'), h('th',{},'Caught this round'), h('th',{},'Round points'), h('th',{},'Running total')]));
  rs.breakdown.slice().sort((a,b)=> b.points - a.points).forEach(b=>{
    const caughtRow = h('div', {class:'caught-row'});
    b.caughtKeys.forEach(k => caughtRow.appendChild(pokemonCardEl(s.pokemonDefsByKey[k], {size:'sm'})));
    if(b.caughtKeys.length === 0) caughtRow.appendChild(h('span', {class:'small'}, b.consolation ? 'No tricks won' : 'Nothing caught'));
    table.appendChild(h('tr', {}, [
      h('td', {}, b.name + (b.playerId===s.yourId?' (you)':'') + (b.bonus ? ' 👑':'')),
      h('td', {}, caughtRow),
      h('td', {}, `${b.points}${b.consolation ? ' (consolation)' : ''}${b.bonus ? ' +3 bonus' : ''}`),
      h('td', {}, String(s.totalScore[b.playerId]))
    ]));
  });
  wrap.appendChild(table);
  wrap.appendChild(h('div', {class:'small', style:'margin-top:12px;'}, `Starting round ${rs.roundNumber+1}...`));
  return wrap;
}

function renderGameOver(s){
  const wrap = h('div', {class:'panel winner-banner'});
  const maxScore = Math.max(...Object.values(s.totalScore));
  let contenders = s.players.filter(p=>s.totalScore[p.id]===maxScore);
  if(contenders.length > 1){
    const maxCaught = Math.max(...contenders.map(p=>s.totalCaught[p.id]));
    const tieBreak = contenders.filter(p=>s.totalCaught[p.id]===maxCaught);
    if(tieBreak.length === 1) contenders = tieBreak;
    else if(s.lastTrickWinner) contenders = contenders.filter(p=>p.id===s.lastTrickWinner);
  }
  const winner = contenders[0];
  wrap.appendChild(h('div', {class:'trophy'}, '🏆'));
  wrap.appendChild(h('h2', {}, `${winner ? winner.name : 'Someone'} wins the game!`));
  wrap.appendChild(renderScoreboard(s, {sortByScore:true, showRoundColumn:false}));

  const rematchBtn = h('button', {
    class: myRematchVote ? 'secondary' : 'gold',
    onClick: ()=>{
      if(myRematchVote) return;
      myRematchVote = true;
      socket.emit('rematch', {});
      render();
    }
  }, myRematchVote ? '✓ Ready for rematch' : '🔁 Rematch (same players)');

  wrap.appendChild(h('div', {class:'row', style:'margin-top:16px;justify-content:center;'}, [
    rematchBtn,
    h('button', {class:'secondary', onClick: ()=>{
      localStorage.removeItem('pkTrickSession');
      location.reload();
    }}, 'Back to Home')
  ]));

  if(myRematchVote && rematchStatus){
    const remaining = rematchStatus.requiredCount - rematchStatus.votedCount;
    wrap.appendChild(h('div', {class:'small', style:'text-align:center;margin-top:10px;'},
      remaining > 0
        ? `Waiting for ${remaining} other player${remaining===1?'':'s'} to be ready... (${rematchStatus.votedNames.join(', ')} ready so far)`
        : 'Everyone is ready — starting!'
    ));
  }
  return wrap;
}

function renderGame(){
  const s = gameState;
  const wrap = h('div');
  wrap.appendChild(header());

  if(!s) { wrap.appendChild(h('div',{class:'panel'},'Loading...')); return wrap; }
  if(s.phase === 'gameOver'){ wrap.appendChild(renderGameOver(s)); return wrap; }
  if(s.awaitingRoundContinue && s.roundSummary){ wrap.appendChild(renderRoundSummary(s)); return wrap; }

  const isMyTurn = s.isYourTurn && !s.awaitingContinue;
  const myPlayer = s.players.find(p=>p.id===s.yourId);
  const legalKeys = new Set(s.legalKeys || []);

  const status = h('div', {class:'panel'});
  status.appendChild(h('div', {class:'row', style:'justify-content:space-between;'}, [
    h('div', {class:'small'}, `Round ${s.round} of 4 • Trick ${s.trickNum} of 4`),
    h('div', {class:'code-display', style:'font-size:.9rem;letter-spacing:.2em;padding:5px 10px;'}, myRoomCode)
  ]));
  if(s.awaitingContinue){
    const winnerName = s.players.find(p=>p.id===s.trick.winnerId).name;
    status.appendChild(h('div', {class:'turn-banner mine', style:'margin-top:10px;'}, `${winnerName} won this trick!`));
  } else {
    const turnPlayer = s.players.find(p=>p.id===s.turnPlayerId);
    const botThinking = !isMyTurn && turnPlayer && turnPlayer.isBot;
    const disconnected = !isMyTurn && turnPlayer && turnPlayer.connected === false;
    const waitingOnOther = !isMyTurn && turnPlayer;
    status.appendChild(h('div', {class:'turn-banner' + (isMyTurn?' mine':'') + (botThinking?' thinking':''), style:'margin-top:10px;'},
      isMyTurn ? "It's your turn — play a card!" :
      botThinking ? `${turnPlayer.name} is thinking...` :
      disconnected ? `${turnPlayer.name} disconnected — a card will auto-play for them if they don't return soon.` :
      waitingOnOther ? `Waiting for ${turnPlayer.name}...` : '...'
    ));
  }
  wrap.appendChild(status);

  const tableArea = h('div', {class:'panel table-area'});
  if(s.currentPokemon){
    const pk = s.currentPokemon;
    const pokemonBlock = h('div', {class:'pokemon-block'});
    pokemonBlock.appendChild(pokemonCardEl(pk, {size:'lg'}));
    pokemonBlock.appendChild(h('div', {class:'pokemon-meta'}, [
      h('div', {class:'sub'}, `Wild suit: `),
      suitTagEl(pk.suit)
    ]));
    tableArea.appendChild(pokemonBlock);
  }

  const playsBySlot = h('div', {class:'trick-plays'});
  s.order.forEach(pid=>{
    const p = s.players.find(pp=>pp.id===pid);
    const playRec = s.trick.plays.find(pl=>pl.playerId===pid);
    const slot = h('div', {class:'play-slot'});
    const isWinner = s.awaitingContinue && playRec && pid === s.trick.winnerId;
    slot.appendChild(cardEl(playRec ? playRec.cardKey : null, {extraClass: isWinner ? 'winner-card' : '', flip:true, flipKey: pid}));
    slot.appendChild(h('div', {class:'pname' + (pid===s.turnPlayerId && !playRec && !s.awaitingContinue ? ' active':'')}, p.name + (pid===s.yourId?' (you)':'') + (p.connected===false?' 💤':'')));
    playsBySlot.appendChild(slot);
  });
  tableArea.appendChild(playsBySlot);
  wrap.appendChild(tableArea);

  const handPanel = h('div', {class:'panel'});
  handPanel.appendChild(h('div', {}, [h('strong',{}, 'Your hand'), h('span',{class:'small'}, `  (${myPlayer ? myPlayer.name : ''})`)]));
  if(isMyTurn) handPanel.appendChild(h('div', {class:'small'}, "Cards you can't legally play are dimmed — you must follow the lead suit if you hold it, but you may always play the wild suit instead (it's never mandatory). If you hold neither, any card is legal."));
  const handDiv = h('div', {class:'hand'});
  const myHand = s.hands[s.yourId];
  if(Array.isArray(myHand)){
    myHand.slice().sort((a,b)=> a.suit===b.suit ? a.value-b.value : a.suit.localeCompare(b.suit)).forEach(c=>{
      const disabled = !isMyTurn || !legalKeys.has(c.key);
      const el = cardEl(c.key, {extraClass: disabled?'disabled':'', onClick: ()=>{
        if(disabled) return;
        socket.emit('playCard', {cardKey: c.key});
      }});
      handDiv.appendChild(el);
    });
  }
  handPanel.appendChild(handDiv);
  wrap.appendChild(handPanel);

  wrap.appendChild(renderScoreboard(s));

  const logPanel = h('div', {class:'panel'});
  logPanel.appendChild(h('div', {}, [h('strong',{},'Game Log')]));
  const logDiv = h('div', {class:'log'});
  s.log.slice(-30).reverse().forEach(line => logDiv.appendChild(h('div', {}, line)));
  logPanel.appendChild(logDiv);
  wrap.appendChild(logPanel);


  return wrap;
}

/* ===================== ROOT RENDER ===================== */
const app = document.getElementById('app');
function render(){
  app.innerHTML = '';
  if(screen === 'home') app.appendChild(renderHome());
  else if(screen === 'lobby') app.appendChild(renderLobby());
  else if(screen === 'game') app.appendChild(renderGame());
  if(showPlayerAid) app.appendChild(renderPlayerAidModal());
  if(showChat) app.appendChild(renderChatModal());
}

fetch('/card-data.json').then(r=>r.json()).then(data=>{
  CARD_IMG = data;
  render();
});
render();
