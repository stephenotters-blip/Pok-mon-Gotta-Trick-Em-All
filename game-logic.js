const SUITS = ['poke','great','ultra','master'];
const SUIT_NAME = {poke:"Poké Ball", great:"Great Ball", ultra:"Ultra Ball", master:"Master Ball"};

const POKEMON_DEFS = [
  {key:'magikarp', name:'Magikarp', points:1, suit:'great'},
  {key:'oddish', name:'Oddish', points:1, suit:'poke'},
  {key:'paras', name:'Paras', points:2, suit:'poke'},
  {key:'ekans', name:'Ekans', points:2, suit:'poke'},
  {key:'sandshrew', name:'Sandshrew', points:2, suit:'ultra'},
  {key:'bulbasaur', name:'Bulbasaur', points:3, suit:'poke'},
  {key:'growlithe', name:'Growlithe', points:3, suit:'poke'},
  {key:'ponyta', name:'Ponyta', points:3, suit:'ultra'},
  {key:'squirtle', name:'Squirtle', points:3, suit:'great'},
  {key:'tentacool', name:'Tentacool', points:3, suit:'great'},
  {key:'charmander', name:'Charmander', points:4, suit:'ultra'},
  {key:'electabuzz', name:'Electabuzz', points:4, suit:'ultra'},
  {key:'lapras', name:'Lapras', points:4, suit:'great'},
  {key:'scyther', name:'Scyther', points:4, suit:'ultra'},
  {key:'pikachu', name:'Pikachu', points:5, suit:'master'},
  {key:'alakazam', name:'Alakazam', points:5, suit:'master'},
  {key:'gyarados', name:'Gyarados', points:5, suit:'great'},
  {key:'snorlax', name:'Snorlax', points:5, suit:'master'},
  {key:'dragonite', name:'Dragonite', points:6, suit:'master'},
  {key:'mewtwo', name:'Mewtwo', points:6, suit:'master'},
];

function buildBallDeck(){
  const deck = [];
  for(const s of SUITS){
    for(let v=1; v<=10; v++){
      deck.push({key:`${s}_${v}`, suit:s, value:v});
    }
  }
  return deck;
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function makeRoomCode(){
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s='';
  for(let i=0;i<4;i++) s += letters[Math.floor(Math.random()*letters.length)];
  return s;
}
function makeId(){ return 'p_' + Math.random().toString(36).slice(2,10); }

/* ===================== GAME LOGIC ===================== */
function initGameState(players, opts={}){
  const ballDeck = shuffle(buildBallDeck());
  const pokemonDeck = shuffle(POKEMON_DEFS.map(p=>p.key));
  const hands = {};
  players.forEach(p => hands[p.id] = []);
  for(let i=0;i<7;i++){
    players.forEach(p => { hands[p.id].push(ballDeck.pop()); });
  }
  const totalScore = {}; const totalCaught = {};
  players.forEach(p => { totalScore[p.id]=0; totalCaught[p.id]=0; });

  return {
    players, hands, drawPile: ballDeck, discardPile: [], pokemonDeck,
    totalScore, totalCaught,
    caughtThisRound: Object.fromEntries(players.map(p=>[p.id,[]])),
    round: 1, trickNum: 1,
    leaderIndex: Math.floor(Math.random() * players.length),
    currentPokemon: null,
    trick: { leadSuit: null, plays: [] }, // plays: [{playerId, cardKey}]
    phase: 'playing',
    log: [`Game started with ${players.length} players.`],
    lastTrickWinner: null,
    consolationRule: !!opts.consolationRule,
    bonusRule: opts.bonusRule !== false, // default ON to match existing behavior
    version: 0
  };
}

function revealNextPokemon(s){
  const key = s.pokemonDeck.pop();
  const def = POKEMON_DEFS.find(p=>p.key===key);
  s.currentPokemon = def;
  s.trick = { leadSuit: null, plays: [] };
  s.log.push(`A wild ${def.name} appeared! (${def.points} pts, ${SUIT_NAME[def.suit]} wild)`);
  return s;
}

function turnOrder(s){
  const n = s.players.length;
  const order = [];
  for(let i=0;i<n;i++) order.push(s.players[(s.leaderIndex+i)%n].id);
  return order;
}

function currentTurnPlayerId(s){
  const order = turnOrder(s);
  return order[s.trick.plays.length] || null;
}

function applyPlayCard(s, playerId, cardKey){
  if(s.phase !== 'playing' || s.awaitingContinue) return null;
  if(currentTurnPlayerId(s) !== playerId) return null;
  const hand = s.hands[playerId];
  const idx = hand.findIndex(c => c.key === cardKey);
  if(idx === -1) return null;
  if(!legalPlays(s, playerId).includes(cardKey)) return null; // must follow suit/wild if able
  const card = hand.splice(idx,1)[0];
  if(s.trick.plays.length === 0) s.trick.leadSuit = card.suit;
  s.trick.plays.push({playerId, cardKey: card.key, suit: card.suit, value: card.value});
  const pname = s.players.find(p=>p.id===playerId).name;
  s.log.push(`${pname} played ${SUIT_NAME[card.suit]} ${card.value}.`);

  if(s.trick.plays.length === s.players.length){
    resolveTrick(s);
  }
  return s;
}

function resolveTrick(s){
  const wildSuit = s.currentPokemon.suit;
  const wildPlays = s.trick.plays.filter(p => p.suit === wildSuit);
  let winnerPlay;
  if(wildPlays.length > 0){
    winnerPlay = wildPlays.reduce((a,b)=> b.value > a.value ? b : a);
  } else {
    const leadPlays = s.trick.plays.filter(p => p.suit === s.trick.leadSuit);
    winnerPlay = leadPlays.reduce((a,b)=> b.value > a.value ? b : a);
  }
  const winnerId = winnerPlay.playerId;
  const winnerName = s.players.find(p=>p.id===winnerId).name;
  s.caughtThisRound[winnerId].push(s.currentPokemon.key);
  s.totalCaught[winnerId] += 1;
  s.lastTrickWinner = winnerId;
  s.log.push(`${winnerName} caught ${s.currentPokemon.name}! 🎉`);
  // NOTE: leaderIndex (which drives slot/turn order) is intentionally left
  // unchanged here. Updating it now would reorder the play-slots in the very
  // same render where the last card's flip animation is still playing,
  // making it look like the cards "jump" around. We update it in
  // continueAfterTrick() instead, once the pause is over and the slots are
  // about to be cleared for the next trick anyway.

  // Pause here so all played cards stay visible. The actual advance to the
  // next trick/round happens in continueAfterTrick(), triggered by a button.
  s.trick.winnerId = winnerId;
  s.awaitingContinue = true;
}

function redrawAllToSeven(s){
  s.players.forEach(p=>{
    while(s.hands[p.id].length < 7){
      if(s.drawPile.length === 0){
        if(s.discardPile.length === 0) break; // truly no cards left anywhere (shouldn't happen)
        s.drawPile = shuffle(s.discardPile);
        s.discardPile = [];
      }
      s.hands[p.id].push(s.drawPile.pop());
    }
  });
}

function continueAfterTrick(s){
  if(!s.awaitingContinue) return s;
  s.awaitingContinue = false;
  // Now that the pause is over and we're about to clear the slots for the
  // next trick, it's safe to move turn order to the winner without it
  // looking like the cards reshuffled mid-animation.
  s.leaderIndex = s.players.findIndex(p=>p.id===s.lastTrickWinner);
  // Played cards go to the discard pile so they can be reshuffled back in later.
  s.trick.plays.forEach(p => s.discardPile.push({key:p.cardKey, suit:p.suit, value:p.value}));
  // Hands stay at 7 cards at all times — redraw immediately after every trick.
  redrawAllToSeven(s);
  if(s.trickNum >= 4){
    endRoundScoring(s);
  } else {
    s.trickNum += 1;
    revealNextPokemon(s);
  }
  return s;
}

function endRoundScoring(s){
  const roundPoints = {};
  const breakdown = [];
  s.players.forEach(p=>{
    const caughtKeys = s.caughtThisRound[p.id];
    let pts = caughtKeys.reduce((sum,k)=> sum + POKEMON_DEFS.find(d=>d.key===k).points, 0);
    let consolation = false;
    if(s.consolationRule && caughtKeys.length === 0){
      // Didn't win a single trick this round: consolation = highest card value in hand.
      const hand = s.hands[p.id];
      if(hand.length > 0){
        pts = Math.max(...hand.map(c=>c.value));
        consolation = true;
      }
    }
    roundPoints[p.id] = pts;
    breakdown.push({playerId: p.id, name: p.name, caughtKeys: caughtKeys.slice(), points: pts, bonus: false, consolation});
  });
  const maxPts = Math.max(...Object.values(roundPoints));
  breakdown.forEach(b=>{
    if(s.bonusRule && roundPoints[b.playerId] === maxPts && maxPts > 0){
      b.bonus = true;
      s.totalScore[b.playerId] += b.points + 3;
    } else {
      s.totalScore[b.playerId] += b.points;
    }
    s.log.push(`${b.name} scored ${b.points} pt(s) this round${b.consolation ? ' (consolation: no tricks won)' : ''}${b.bonus ? ' +3 bonus!' : ''}.`);
  });
  s.caughtThisRound = Object.fromEntries(s.players.map(p=>[p.id,[]]));

  if(s.round >= 4){
    s.phase = 'gameOver';
    s.log.push('Game over! Final scores tallied.');
    return s;
  }

  // Pause here to show a round summary before dealing the next round.
  s.roundSummary = { roundNumber: s.round, breakdown };
  s.awaitingRoundContinue = true;
  return s;
}

function continueAfterRound(s){
  if(!s.awaitingRoundContinue) return s;
  s.awaitingRoundContinue = false;
  s.roundSummary = null;
  // Hands are already at 7 (topped up after every trick), so just advance the round.
  s.round += 1;
  s.trickNum = 1;
  s.log.push(`--- Round ${s.round} begins ---`);
  revealNextPokemon(s);
  return s;
}

function legalPlays(s, playerId){
  const hand = s.hands[playerId];
  if(s.trick.plays.length === 0) return hand.map(c=>c.key); // leading the trick: anything goes
  const leadSuit = s.trick.leadSuit;
  const wildSuit = s.currentPokemon.suit;
  const hasLead = hand.some(c=>c.suit===leadSuit);
  if(hasLead){
    // Must follow the lead suit if held. A wild card is always a legal
    // alternative (never mandatory) even if you also hold the lead suit.
    return hand.filter(c=>c.suit===leadSuit || c.suit===wildSuit).map(c=>c.key);
  }
  // Don't hold the lead suit: any card is legal, including (but not
  // requiring) the wild suit. You're never forced to spend a wild.
  return hand.map(c=>c.key);
}

/* Simple bot AI */
function botChooseCard(s, playerId){
  const legalKeys = new Set(legalPlays(s, playerId));
  const hand = s.hands[playerId].filter(c => legalKeys.has(c.key));
  const wildSuit = s.currentPokemon.suit;
  const pts = s.currentPokemon.points;
  const plays = s.trick.plays;

  if(plays.length === 0){
    const myWilds = hand.filter(c=>c.suit===wildSuit).sort((a,b)=>a.value-b.value);

    if(pts >= 3 && myWilds.length > 0){
      // Worth contesting, and we hold a wild. A wild beats every non-wild play
      // regardless of size, so lead with the LOWEST wild that still wins —
      // no point burning the biggest one when a small wild does the same job.
      return myWilds[0].key;
    }

    if(pts >= 3 && myWilds.length === 0){
      // No wild, but the catch is worth contesting. Lead high in whichever
      // suit looks "thin" elsewhere — i.e. we can already account for most of
      // that suit between our own hand and the discard pile, so it's unlikely
      // an opponent is sitting on something bigger.
      const otherSuits = SUITS.filter(su => su !== wildSuit);
      let bestSuit = null, bestUnknown = Infinity, bestCard = null;
      otherSuits.forEach(suit=>{
        const inHand = hand.filter(c=>c.suit===suit);
        if(inHand.length === 0) return;
        const discardCount = s.discardPile.filter(c=>c.suit===suit).length;
        const unknown = 10 - inHand.length - discardCount; // could be in opponents' hands or the draw pile
        if(unknown < bestUnknown){
          bestUnknown = unknown;
          bestSuit = suit;
          bestCard = inHand.sort((a,b)=>b.value-a.value)[0]; // highest we hold in that suit
        }
      });
      if(bestSuit && bestUnknown <= 3){
        return bestCard.key;
      }
    }

    // Not worth contesting (or too risky to read): dump a low non-wild card
    // and conserve our good cards for a more valuable Pokémon later.
    const nonWild = hand.filter(c=>c.suit!==wildSuit).sort((a,b)=>a.value-b.value);
    if(nonWild.length>0) return nonWild[0].key;
    return hand.slice().sort((a,b)=>a.value-b.value)[0].key;
  }

  const wildOnTable = plays.filter(p=>p.suit===wildSuit);
  const maxWildOnTable = wildOnTable.length ? Math.max(...wildOnTable.map(p=>p.value)) : -1;
  const leadSuit = s.trick.leadSuit;
  const maxLeadOnTable = Math.max(...plays.filter(p=>p.suit===leadSuit).map(p=>p.value), -1);

  const myWilds = hand.filter(c=>c.suit===wildSuit).sort((a,b)=>a.value-b.value);
  const myLeads = hand.filter(c=>c.suit===leadSuit).sort((a,b)=>a.value-b.value);

  let winningCard = null;
  if(maxWildOnTable >= 0){
    const beat = myWilds.find(c=>c.value > maxWildOnTable);
    if(beat) winningCard = beat;
  } else {
    const beatWild = myWilds[0]; // any wild wins if none on table yet
    const beatLead = myLeads.find(c=>c.value > maxLeadOnTable);
    if(beatWild && beatLead) winningCard = beatWild.value <= beatLead.value ? beatWild : beatWild;
    else winningCard = beatWild || beatLead || null;
  }

  if(winningCard && pts >= 3){
    return winningCard.key;
  }
  if(winningCard && pts >= 1 && Math.random() < 0.35){
    return winningCard.key;
  }

  // otherwise dump lowest non-wild, non-lead card if possible, else lowest overall
  const dump = hand.filter(c=>c.suit!==wildSuit && c.suit!==leadSuit).sort((a,b)=>a.value-b.value);
  if(dump.length>0) return dump[0].key;
  const anyLow = hand.slice().sort((a,b)=>a.value-b.value);
  return anyLow[0].key;
}


module.exports = {
  SUITS, SUIT_NAME, POKEMON_DEFS,
  buildBallDeck, shuffle, makeRoomCode, makeId,
  initGameState, revealNextPokemon, turnOrder, currentTurnPlayerId,
  applyPlayCard, resolveTrick, redrawAllToSeven, continueAfterTrick,
  endRoundScoring, continueAfterRound, legalPlays, botChooseCard
};
