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

socket.on('joined', ({code, playerId})=>{
  myId = playerId; myRoomCode = code; errorMsg='';
  localStorage.setItem('pkTrickSession', JSON.stringify({code, playerId, name: nameInput}));
  screen = 'lobby';
  render();
});
socket.on('lobby', (info)=>{ lobbyInfo = info; if(screen!=='game') screen='lobby'; render(); });
socket.on('state', (s)=>{ gameState = s; screen = 'game'; render(); });
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
  const flipWrap = h('div', {class:'pkcard-flip'});
  const inner = h('div', {class:'pkcard-flip-inner'});
  const front = h('div', {class:'pkcard-flip-face'});
  front.appendChild(h('img', {src: imgSrc('pkcardback'), alt:'card back'}));
  const back = h('div', {class:'pkcard-flip-face pkcard-flip-back'});
  back.appendChild(h('img', {src: imgSrc('pkfinal_'+pk.key), alt: pk.name}));
  inner.appendChild(front); inner.appendChild(back);
  flipWrap.appendChild(inner);
  el.appendChild(flipWrap);

  if(opts.size === 'lg'){
    if(pk.key !== _lastFlippedPokemonKey){
      _lastFlippedPokemonKey = pk.key;
      el.classList.add('is-flipping');
      requestAnimationFrame(()=>{ requestAnimationFrame(()=> flipWrap.classList.add('flipped')); });
      setTimeout(()=> el.classList.remove('is-flipping'), 950);
    } else {
      flipWrap.classList.add('flipped');
    }
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
  return h('div', {}, [
    h('h1', {}, "Pokémon: Gotta Trick 'Em All"),
    h('div', {class:'subtitle'}, "Online multiplayer — up to 4 players, trick-taking")
  ]);
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
    }, fillWithBotsEnabled ? `✓ Fill ${seatsOpen} empty seat${seatsOpen>1?'s':''} with bots` : `Fill empty seats with bots: OFF`));
    panel.appendChild(botToggleRow);
  }

  const canStart = lobbyInfo && (lobbyInfo.players.length >= 2 || fillWithBotsEnabled) && !lobbyInfo.started;
  panel.appendChild(h('div', {class:'row', style:'margin-top:18px;'}, [
    h('button', {class: canStart ? 'gold' : 'secondary', onClick: ()=>{
      if(!canStart) return;
      socket.emit('startGame', {consolationRule: consolationRuleEnabled, fillWithBots: fillWithBotsEnabled});
    }}, canStart ? 'Start Game' : 'Waiting for players (need 2+, or fill with bots)...')
  ]));

  wrap.appendChild(panel);
  if(errorMsg) wrap.appendChild(h('div', {class:'panel', style:'border:1px solid var(--bad);color:var(--bad);'}, errorMsg));
  return wrap;
}

function renderScoreboard(s, opts={}){
  const panel = h('div', {class:'panel'});
  panel.appendChild(h('div', {}, [h('strong',{},'Scoreboard')]));
  const table = h('table', {class:'scoreboard'});
  table.appendChild(h('tr', {}, [h('th',{},'Player'), h('th',{},'Caught this round'), h('th',{},'Total score'), h('th',{},'Total caught')]));
  const playerList = opts.sortByScore
    ? s.players.slice().sort((a,b)=> s.totalScore[b.id] - s.totalScore[a.id])
    : s.players;
  playerList.forEach((p, idx)=>{
    const caughtRound = s.caughtThisRound[p.id] || [];
    const roundPts = caughtRound.reduce((sum,k)=> sum + s.pokemonDefsByKey[k].points, 0);
    const rank = opts.sortByScore ? `${idx+1}. ` : '';
    const row = h('tr', {}, [
      h('td', {}, rank + p.name + (p.id===s.yourId?' (you)':'')),
      h('td', {}, [h('div',{},`${roundPts} pt(s)`), (()=>{const r=h('div',{class:'caught-row'}); caughtRound.forEach(k=> r.appendChild(pokemonCardEl(s.pokemonDefsByKey[k], {size:'sm'}))); return r;})()]),
      h('td', {}, String(s.totalScore[p.id])),
      h('td', {}, String(s.totalCaught[p.id]))
    ]);
    table.appendChild(row);
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
  wrap.appendChild(renderScoreboard(s, {sortByScore:true}));
  wrap.appendChild(h('div', {class:'row', style:'margin-top:16px;justify-content:center;'}, [
    h('button', {class:'gold', onClick: ()=> location.reload() }, 'Back to Home')
  ]));
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
    const waitingOnOther = !isMyTurn && turnPlayer;
    status.appendChild(h('div', {class:'turn-banner' + (isMyTurn?' mine':'') + (botThinking?' thinking':''), style:'margin-top:10px;'},
      isMyTurn ? "It's your turn — play a card!" :
      botThinking ? `${turnPlayer.name} is thinking...` :
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
    slot.appendChild(h('div', {class:'pname' + (pid===s.turnPlayerId && !playRec && !s.awaitingContinue ? ' active':'')}, p.name + (pid===s.yourId?' (you)':'')));
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
}

fetch('/card-data.json').then(r=>r.json()).then(data=>{
  CARD_IMG = data;
  render();
});
render();
