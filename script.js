/* Deck'Cadence demo — pure JS, no deps, mobile-first
   state + render + actions + engine (queue/state machine)
*/
(function(){
  'use strict';

  // ---------- Assets ----------
  const ASSETS = {
    uiRules: './assets/ui/regles_accueil.png',
    back: './assets/ui/dos.png',
    cards: {
      merlin: './assets/cards/1_merlin_lepiocheur.png',
      chat: './assets/cards/3_chat_rond.png',
      robin: './assets/cards/3_robin_descartes.png',
      mime: './assets/cards/4_mime_mique.png',
      val: './assets/cards/4_val_kyrie.png',
    }
  };

  // ---------- Card types & effects ----------
  const CardType = {
    ROBIN: 'Robin Descartes',
    MIME: 'Mime Mique',
    CHAT: 'Chat Rond',
    VAL: 'Val Kyrie',
    MERLIN: 'Merlin Lepiocheur',
  };

  const CARD_DEF = {
    [CardType.ROBIN]: {
      img: ASSETS.cards.robin,
      entry: null,
      inPlay: null,
      lastBreath: (ctx) => ({ kind:'stealRandom', owner: ctx.owner, from: opp(ctx.owner), n:2, source: CardType.ROBIN }),
      text: 'Dernier souffle : Vole 2 cartes aléatoires dans la main adverse.'
    },
    [CardType.MIME]: {
      img: ASSETS.cards.mime,
      entry: (ctx) => ({ kind:'destroyChoose', owner: ctx.owner, n:1, source: CardType.MIME }),
      inPlay: null,
      lastBreath: null,
      text: 'Entrée en scène : Détruis 1 carte de ton choix (n’importe quel terrain).'
    },
    [CardType.CHAT]: {
      img: ASSETS.cards.chat,
      entry: null,
      inPlay: null,
      lastBreath: (ctx) => ({ kind:'destroyChoose', owner: ctx.owner, n:2, source: CardType.CHAT }),
      text: 'Dernier souffle : Détruis 2 cartes de ton choix (n’importe quel terrain).'
    },
    [CardType.VAL]: {
      img: ASSETS.cards.val,
      entry: (ctx) => ({ kind:'draw', owner: ctx.owner, n:2, source: CardType.VAL }),
      inPlay: null,
      lastBreath: null,
      text: 'Entrée en scène : Pioche 2 cartes.'
    },
    [CardType.MERLIN]: {
      img: ASSETS.cards.merlin,
      entry: null,
      inPlay: (ctx) => ({ kind:'extraDrawStartTurn', owner: ctx.owner, n:1, source: CardType.MERLIN }),
      lastBreath: null,
      text: 'En jeu : +1 pioche au début de ton tour.'
    },
  };

  // Deck list (10)
  const DECKLIST = [
    CardType.ROBIN, CardType.ROBIN,
    CardType.MIME, CardType.MIME, CardType.MIME, CardType.MIME,
    CardType.CHAT, CardType.CHAT,
    CardType.VAL,
    CardType.MERLIN
  ];

  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs={}, children=[]) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(c));
    return n;
  };

  // Screens
  const screens = {
    loading: $('#screen-loading'),
    home: $('#screen-home'),
    game: $('#screen-game'),
    result: $('#screen-result'),
  };

  const dom = {
    loadingStatus: $('#loading-status'),
    btnPlay: $('#btn-play'),
    btnHow: $('#btn-how'),
    btnSound: $('#btn-sound'),
    btnRestart: $('#btn-restart'),
    btnReplay: $('#btn-replay'),
    btnHome: $('#btn-home'),
    btnEnd: $('#btn-end'),
    btnSkip: $('#btn-skip'),
    deckCount: $('#deck-count'),
    turnCount: $('#turn-count'),
    who: $('#who'),
    phase: $('#phase'),
    log: $('#log'),
    pField: $('#p-field'),
    aiField: $('#ai-field'),
    pHand: $('#p-hand'),
    aiHand: $('#ai-hand'),
    pFieldCount: $('#p-field-count'),
    aiFieldCount: $('#ai-field-count'),
    modal: $('#modal'),
    modalTitle: $('#modal-title'),
    modalHint: $('#modal-hint'),
    modalBackdrop: $('#modal-backdrop'),
    btnConfirm: $('#btn-confirm'),
    resultTitle: $('#result-title'),
    resultSub: $('#result-sub'),
    scoreYou: $('#score-you'),
    scoreAi: $('#score-ai'),
  };

  // ---------- Audio (OFF by default) ----------
  const AudioFX = {
    enabled: false,
    unlocked: false,
    sounds: {},
    initOnce(){
      if (this.unlocked) return;
      this.unlocked = true;
      // If files missing, browser will just fail silently; game still works.
      this.sounds.draw = new Audio('./assets/sfx/draw.mp3');
      this.sounds.play = new Audio('./assets/sfx/play.mp3');
      this.sounds.destroy = new Audio('./assets/sfx/destroy.mp3');
      this.sounds.steal = new Audio('./assets/sfx/steal.mp3');
      Object.values(this.sounds).forEach(a => { a.preload = 'auto'; a.volume = 0.75; });
    },
    setEnabled(on){
      this.enabled = !!on;
      dom.btnSound.setAttribute('aria-pressed', String(this.enabled));
      dom.btnSound.textContent = this.enabled ? 'Son : On' : 'Son : Off';
      try{ localStorage.setItem('dc_sound', this.enabled ? '1' : '0'); }catch(e){}
    },
    play(name){
      if (!this.enabled) return;
      const a = this.sounds[name];
      if (!a) return;
      try{ a.currentTime = 0; a.play().catch(()=>{}); }catch(e){}
    }
  };

  function loadSoundPref(){
    let on = false;
    try{ on = localStorage.getItem('dc_sound') === '1'; }catch(e){}
    AudioFX.setEnabled(on);
  }

  function bump(node, cls='anim-pulse'){
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth; // reflow
    node.classList.add(cls);
    node.addEventListener('animationend', () => node.classList.remove(cls), { once:true });
  }
  function flashZone(who, bad=false){
    const field = (who==='P') ? dom.pField : dom.aiField;
    const zone = field ? field.closest('.zone') : null;
    bump(zone, bad ? 'anim-flashBad' : 'anim-flash');
  }

  function showScreen(name){
  Object.values(screens).forEach(s => s.classList.remove('screen--active'));
  screens[name].classList.add('screen--active');

  // Sécurité : l'accueil ne doit jamais avoir de modal au-dessus
  if (name === 'home') {
    try { closeTargeting(); } catch(e) { /* noop */ }
    if (dom.modal) dom.modal.hidden = true;
  }
}

  function logLine(html){
    const p = document.createElement('p');
    p.innerHTML = html;
    dom.log.appendChild(p);
    dom.log.scrollTop = dom.log.scrollHeight;
  }
  function clearLog(){ dom.log.innerHTML = ''; }

  // ---------- State ----------
  const S = {
    turnIndex: 0,      // 0..7
    current: 'P',      // 'P' or 'A'
    phase: 'idle',     // 'startTurn'|'play'|'resolve'|'ai'|'targeting'|'gameOver'
    awaiting: null,
    effectQ: [],
    lock: false,

    deck: [],
    hands: { P: [], A: [] },
    fields: { P: [], A: [] },

    selected: [],
    lastPlayedId: null,
    playerPlayedThisTurn: false,
  };

  function opp(who){ return who === 'P' ? 'A' : 'P'; }

  // Card instances
  let uid = 0;
  function makeCard(type){
    uid += 1;
    return { id: 'c'+uid, type, owner: null };
  }

  function shuffle(a){
    for (let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  // ---------- Preload ----------
  async function preload(){
    const list = [ASSETS.uiRules, ASSETS.back, ...Object.values(ASSETS.cards)];
    let loaded = 0;
    dom.loadingStatus.textContent = '';
    await Promise.all(list.map(src => new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => {
        loaded += 1;
        dom.loadingStatus.textContent = `${loaded}/${list.length}`;
        resolve();
      };
      img.src = src;
    })));
  }

  // ---------- Game setup ----------
  function whoLabel(who){ return who==='P' ? '<b>Toi</b>' : '<b>IA</b>'; }

  function drawCards(who, n, silent=false){
    let drawn = 0;
    for (let i=0;i<n;i++){
      const c = S.deck.pop();
      if (!c) break;
      c.owner = who;
      S.hands[who].push(c);
      drawn++;
    }
    if (!silent && drawn>0){
      logLine(`${whoLabel(who)} pioche ${drawn} carte${drawn>1?'s':''}.`);
      bump(dom.deckCount.closest('.pill'), 'anim-pulse');
      AudioFX.play('draw');
    }
    if (!silent && drawn===0){
      logLine(`${whoLabel(who)} <span class="muted">ne peut pas piocher (pioche vide).</span>`);
    }
    return drawn;
  }

  function moveToField(who, card){
    S.lastPlayedId = card.id;
    const hand = S.hands[who];
    const idx = hand.findIndex(x => x.id === card.id);
    if (idx >= 0) hand.splice(idx,1);
    card.owner = who;
    S.fields[who].push(card);
  }

  function removeFromField(card){
    const f = S.fields[card.owner];
    const idx = f.findIndex(x => x.id === card.id);
    if (idx >= 0) f.splice(idx,1);
  }

  // Destroy chain: remove immediately, enqueue last breath in destruction order
  function destroyCards(ownerTriggering, targets){
    const order = [];
    targets.forEach(t => {
      if (!t) return;
      const onP = S.fields.P.some(x => x.id===t.id);
      const onA = S.fields.A.some(x => x.id===t.id);
      if (!onP && !onA) return;
      order.push(t);
    });
    if (order.length === 0) return;

    order.forEach(card => {
      removeFromField(card);
      logLine(`${whoLabel(ownerTriggering)} détruit <b>${card.type}</b> (${card.owner==='P'?'ton':'son'} terrain).`);
      AudioFX.play('destroy');
      flashZone(card.owner, true);

      const def = CARD_DEF[card.type];
      if (def.lastBreath){
        const eff = def.lastBreath({ owner: card.owner, card });
        S.effectQ.push(eff); // FIFO
      }
    });
  }

  function enqueue(eff){ if (eff) S.effectQ.push(eff); }

  function processNextEffect(){
    const eff = S.effectQ.shift();
    if (!eff) return false;

    if (eff.kind === 'draw'){
      drawCards(eff.owner, eff.n);
      updateUI();
      return true;
    }

    if (eff.kind === 'stealRandom'){
      const fromHand = S.hands[eff.from];
      if (fromHand.length === 0){
        logLine(`${whoLabel(eff.owner)} tente de voler, mais la main adverse est vide.`);
        return true;
      }
      const n = Math.min(eff.n, fromHand.length);
      for (let i=0;i<n;i++){
        const j = Math.floor(Math.random()*fromHand.length);
        const c = fromHand.splice(j,1)[0];
        c.owner = eff.owner;
        S.hands[eff.owner].push(c);
      }
      logLine(`${whoLabel(eff.owner)} vole <b>${n}</b> carte${n>1?'s':''} au hasard.`);
      AudioFX.play('steal');
      flashZone(eff.from, true);
      updateUI();
      return true;
    }

    if (eff.kind === 'destroyChoose'){
      const all = [...S.fields.P, ...S.fields.A];
      if (all.length === 0){
        logLine(`${whoLabel(eff.owner)} veut détruire, mais aucun terrain n’a de cartes.`);
        return true;
      }
      requestTargeting(eff.owner, eff.n, eff.source, (chosen) => {
        destroyCards(eff.owner, chosen);
        updateUI();
        step();
      });
      return true;
    }

    return true;
  }

  // ---------- Targeting ----------
  function requestTargeting(owner, n, source, onDone){
    S.phase = 'targeting';
    S.awaiting = { owner, n, source, onDone };
    S.selected = [];
    dom.btnConfirm.disabled = true;

    dom.modalTitle.textContent = `${owner==='P'?'Toi':'IA'} — Choix (${n})`;
    dom.modalHint.textContent =
      n === 1
        ? `${source} : choisis 1 carte sur un terrain.`
        : `${source} : choisis jusqu’à ${n} cartes (si possible).`;

    dom.modal.hidden = false;
    markTargetables(true);
    updateUI();

    if (owner === 'A'){
      setTimeout(() => {
        const chosen = aiChooseTargets('A', n);
        closeTargeting();
        S.phase = 'resolve';
        onDone(chosen);
      }, 350);
    }
  }

  function closeTargeting(){
    dom.modal.hidden = true;
    markTargetables(false);
    S.awaiting = null;
    S.selected = [];
  }

  function markTargetables(on){
    const allBtns = document.querySelectorAll('[data-zone="field"] .cardbtn');
    allBtns.forEach(b => {
      if (on) b.classList.add('is-targetable');
      else {
        b.classList.remove('is-targetable');
        b.classList.remove('is-selected');
      }
    });
  }

  function toggleSelected(cardId){
    const req = S.awaiting;
    if (!req) return;
    const max = req.n;

    const idx = S.selected.indexOf(cardId);
    if (idx >= 0) S.selected.splice(idx,1);
    else {
      if (S.selected.length >= max) return;
      S.selected.push(cardId);
    }

    document.querySelectorAll('[data-zone="field"] .cardbtn').forEach(btn => {
      if (S.selected.includes(btn.dataset.cardId)) btn.classList.add('is-selected');
      else btn.classList.remove('is-selected');
    });

    dom.btnConfirm.disabled = (S.selected.length === 0);

    if (max === 1 && S.selected.length === 1) confirmTargeting(); // auto 1
  }

  function confirmTargeting(){
    const req = S.awaiting;
    if (!req) return;

    const chosenCards = S.selected
      .map(id => [...S.fields.P, ...S.fields.A].find(c => c.id===id))
      .filter(Boolean);

    closeTargeting();
    S.phase = 'resolve';
    req.onDone(chosenCards);
  }

  dom.btnConfirm.addEventListener('click', confirmTargeting);
  dom.modalBackdrop.addEventListener('click', () => {
    logLine(`<span class="muted">Choix requis pour continuer.</span>`);
  });

  // ---------- Turn engine ----------
  function applyStartTurnInPlay(who){
    const merlins = S.fields[who].filter(c => c.type === CardType.MERLIN);
    if (merlins.length > 0){
      logLine(`${whoLabel(who)} <span class="hint">active Merlin</span> : +1 pioche.`);
      drawCards(who, 1);
    }
  }

  async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  async function aiTurn(){
    applyStartTurnInPlay('A');
    await sleep(220);

    drawCards('A', 1);
    await sleep(220);

    const hand = S.hands.A;
    if (hand.length === 0){
      logLine(`${whoLabel('A')} ne peut pas poser (main vide).`);
      await sleep(200);
      return;
    }

    const card = chooseAiCardToPlay(hand);
    moveToField('A', card);
    logLine(`${whoLabel('A')} pose <b>${card.type}</b>.`);
    AudioFX.play('play');
    updateUI();
    flashZone('A', false);
    await sleep(220);

    const def = CARD_DEF[card.type];
    if (def.entry) enqueue(def.entry({ owner:'A', card }));

    while (S.effectQ.length > 0){
      processNextEffect();
      await sleep(S.phase === 'targeting' ? 420 : 140);
    }
  }

  function chooseAiCardToPlay(hand){
    // IA sous-optimale (quasi-victoire joueur souvent), sans être caricaturale
    const weights = hand.map(c => {
      let w = 1;
      if (c.type === CardType.MIME) w = 4.0;
      if (c.type === CardType.VAL) w = 2.2;
      if (c.type === CardType.MERLIN) w = 1.8;
      if (c.type === CardType.ROBIN) w = 1.0;
      if (c.type === CardType.CHAT) w = 0.9;
      w *= (0.85 + Math.random()*0.4); // petite "malchance"
      return w;
    });

    const sum = weights.reduce((a,b)=>a+b,0);
    let r = Math.random()*sum;
    for (let i=0;i<hand.length;i++){
      r -= weights[i];
      if (r <= 0) return hand[i];
    }
    return hand[hand.length-1];
  }

  function aiChooseTargets(owner, n){
    const all = [
      ...S.fields.P.map(c => ({c, side:'P'})),
      ...S.fields.A.map(c => ({c, side:'A'}))
    ];

    const preferOwn = 0.62;    // sabotage léger
    const preferRandom = 0.22; // maladresse légère

    const picks = [];
    const pool = all.slice();

    for (let i=0;i<n;i++){
      if (pool.length === 0) break;

      let pick;
      const roll = Math.random();

      if (roll < preferRandom){
        pick = pool[Math.floor(Math.random()*pool.length)];
      } else if (roll < preferRandom + preferOwn){
        const ownPool = pool.filter(x => x.side === owner);
        pick = ownPool.length ? ownPool[Math.floor(Math.random()*ownPool.length)] : pool[Math.floor(Math.random()*pool.length)];
      } else {
        const oppPool = pool.filter(x => x.side !== owner);
        // soft : évite parfois de donner des gros triggers au joueur
        const softened = oppPool.filter(x => x.c.type !== CardType.CHAT && x.c.type !== CardType.ROBIN);
        const targetPool = softened.length ? softened : oppPool;
        pick = targetPool.length ? targetPool[Math.floor(Math.random()*targetPool.length)] : pool[Math.floor(Math.random()*pool.length)];
      }

      const idx = pool.findIndex(x => x.c.id === pick.c.id);
      if (idx >= 0) pool.splice(idx,1);
      picks.push(pick.c);
    }
    return picks;
  }

  function endGame(){
    S.phase = 'gameOver';
    const you = S.fields.P.length;
    const ai = S.fields.A.length;

    dom.scoreYou.textContent = String(you);
    dom.scoreAi.textContent = String(ai);

    if (you > ai){
      dom.resultTitle.textContent = 'Tu gagnes !';
      dom.resultSub.textContent = 'Bien joué : tu as posé plus de cartes sur ton terrain.';
    } else if (ai > you){
      dom.resultTitle.textContent = 'Défaite…';
      dom.resultSub.textContent = 'Tu peux gagner au prochain essai : vise le tempo et les bons ciblages.';
    } else {
      dom.resultTitle.textContent = 'Égalité';
      dom.resultSub.textContent = 'Tu es passé tout près. Rejoue, et tente un autre ordre de poses.';
    }
    showScreen('result');
  }

  function phaseLabel(){
    if (S.turnIndex >= 8) return 'Fin';
    if (S.phase === 'startTurn') return 'Début de tour (En jeu) → pioche';
    if (S.phase === 'play') return 'Pose 1 carte';
    if (S.phase === 'resolve') return 'Résolution';
    if (S.phase === 'targeting') return 'Ciblage';
    if (S.phase === 'ai') return 'Tour IA';
    return '—';
  }

  function renderFieldCard(card){
    const def = CARD_DEF[card.type];
    const btn = el('button', {
      class: 'cardbtn',
      'data-zone': 'field',
      'data-card-id': card.id,
      title: card.type,
      onClick: () => {
        if (S.phase === 'targeting' && S.awaiting && S.awaiting.owner === 'P'){
          toggleSelected(card.id);
        }
      }
    }, [
      el('img', { class:'cardimg', src: def.img, alt: card.type }),
    ]);

    const wrap = el('div', { class:'cardwrap' }, [
      btn,
      el('div', { class:'tag', text: card.type })
    ]);

    if (S.lastPlayedId === card.id){
      btn.classList.add('anim-pop');
      setTimeout(() => { if (S.lastPlayedId === card.id) S.lastPlayedId = null; }, 0);
    }
    return wrap;
  }

  function renderHandCard(card){
    const def = CARD_DEF[card.type];
    const btn = el('button', {
      class: 'cardbtn',
      'data-zone': 'hand',
      'data-card-id': card.id,
      title: `${card.type} — ${def.text}`,
      onClick: () => playerPlay(card.id),
    }, [
      el('img', { class:'cardimg', src: def.img, alt: card.type }),
    ]);

    return el('div', { class:'cardwrap' }, [
      btn,
      el('div', { class:'tag', text: card.type })
    ]);
  }

  function renderAIFaceDown(){
    return el('div', { class:'cardwrap' }, [
      el('button', { class:'cardbtn', disabled: true }, [
        el('img', { class:'cardimg cardimg--faceDown', src: ASSETS.back, alt: 'Dos de carte' }),
      ]),
      el('div', { class:'tag', text: 'Carte' })
    ]);
  }

  function updateUI(){
    dom.deckCount.textContent = String(S.deck.length);
    dom.turnCount.textContent = `${Math.min(S.turnIndex+1,8)}/8`;
    dom.pFieldCount.textContent = String(S.fields.P.length);
    dom.aiFieldCount.textContent = String(S.fields.A.length);

    dom.who.textContent = (S.current==='P') ? 'À toi' : 'IA';
    dom.phase.textContent = phaseLabel();

    const canEnd = (S.current==='P') && (S.phase === 'play' || S.phase === 'resolve') && (S.playerPlayedThisTurn || S.hands.P.length === 0);
    dom.btnEnd.disabled = !canEnd;
    dom.btnSkip.disabled = !(S.current==='P' && S.hands.P.length === 0 && (S.phase === 'play' || S.phase === 'resolve'));

    dom.aiField.innerHTML = '';
    dom.pField.innerHTML = '';
    S.fields.A.forEach(card => dom.aiField.appendChild(renderFieldCard(card)));
    S.fields.P.forEach(card => dom.pField.appendChild(renderFieldCard(card)));

    dom.pHand.innerHTML = '';
    S.hands.P.forEach(card => dom.pHand.appendChild(renderHandCard(card)));

    dom.aiHand.innerHTML = '';
    for (let i=0;i<S.hands.A.length;i++){
      dom.aiHand.appendChild(renderAIFaceDown());
    }

    if (S.phase === 'targeting'){
      document.querySelectorAll('[data-zone="field"] .cardbtn').forEach(btn => {
        if (S.selected.includes(btn.dataset.cardId)) btn.classList.add('is-selected');
      });
      dom.btnConfirm.disabled = (S.selected.length === 0);
    }
  }

  function step(){
    if (S.lock) return;
    S.lock = true;

    if (S.phase === 'targeting'){ S.lock = false; return; }

    // resolve queued effects first
    if (S.effectQ.length > 0){
      S.phase = 'resolve';
      updateUI();
      while (S.effectQ.length > 0){
        processNextEffect();
        if (S.phase === 'targeting'){ S.lock = false; return; }
      }
    }

    if (S.turnIndex >= 8){
      endGame();
      S.lock = false;
      return;
    }

    S.current = (S.turnIndex % 2 === 0) ? 'P' : 'A';

    if (S.current === 'A'){
      S.phase = 'ai';
      updateUI();
      aiTurn().then(() => {
        S.turnIndex += 1;
        S.lock = false;
        step();
      });
      return;
    }

    // Player turn (auto pioche pour UX 1 minute)
    S.phase = 'startTurn';
    S.playerPlayedThisTurn = false;

    applyStartTurnInPlay('P');
    drawCards('P', 1);

    S.phase = 'play';
    updateUI();
    S.lock = false;
  }

  function playerPlay(cardId){
  console.log(
    'CLICK CARD',
    cardId,
    'phase=',
    S.phase,
    'current=',
    S.current,
    'played=',
    S.playerPlayedThisTurn
  );

  if (S.current !== 'P' || S.phase !== 'play') return;
  if (S.playerPlayedThisTurn) return;

    const card = S.hands.P.find(c => c.id === cardId);
    if (!card) return;

    moveToField('P', card);
    logLine(`${whoLabel('P')} pose <b>${card.type}</b>.`);
    AudioFX.play('play');
    updateUI();
    flashZone('P', false);

    const def = CARD_DEF[card.type];
    if (def.entry) enqueue(def.entry({ owner:'P', card }));

    S.playerPlayedThisTurn = true;
    updateUI();
    step();
  }

  function playerEndTurn(){
    if (S.current !== 'P') return;

    if (!S.playerPlayedThisTurn && S.hands.P.length > 0){
      logLine(`<span class="muted">Tu dois poser 1 carte (si possible) avant de finir ton tour.</span>`);
      return;
    }

    S.turnIndex += 1;
    updateUI();
    step();
  }

  function playerSkip(){
    if (S.current !== 'P') return;
    if (S.hands.P.length > 0){
      logLine(`<span class="muted">Passer n’est possible que si ta main est vide.</span>`);
      return;
    }
    logLine(`${whoLabel('P')} passe (main vide).`);
    S.turnIndex += 1;
    updateUI();
    step();
  }

  function newGame(){
    clearLog();
    S.turnIndex = 0;
    S.current = 'P';
    S.phase = 'startTurn';
    S.awaiting = null;
    S.effectQ = [];
    S.lock = false;
    S.selected = [];
    S.lastPlayedId = null;
    S.playerPlayedThisTurn = false;

    uid = 0;
    S.deck = shuffle(DECKLIST.map(t => makeCard(t)));
    S.hands.P = [];
    S.hands.A = [];
    S.fields.P = [];
    S.fields.A = [];

    drawCards('P', 2, true);
    drawCards('A', 2, true);

    logLine(`<span class="hint">Mise en place :</span> toi et l’IA piochez 2 cartes.`);
    updateUI();
    step();
  }

  // ---------- Wire UI ----------
  dom.btnPlay.addEventListener('click', () => { showScreen('game'); newGame(); });

  dom.btnHow.addEventListener('click', () => {
    logLine(`<span class="hint">Rappel :</span> Début de tour (En jeu) → pioche 1 → pose 1 → Entrée en scène. Dernier souffle quand une carte est détruite.`);
  });

  dom.btnSound.addEventListener('click', () => {
    AudioFX.initOnce();
    AudioFX.setEnabled(!AudioFX.enabled);
    logLine(`<span class="muted">Son : ${AudioFX.enabled ? 'On' : 'Off'}</span>`);
  });

  dom.btnRestart.addEventListener('click', () => { showScreen('game'); newGame(); });
  dom.btnReplay.addEventListener('click', () => { showScreen('game'); newGame(); });
  dom.btnHome.addEventListener('click', () => { showScreen('home'); });

  dom.btnEnd.addEventListener('click', () => { playerEndTurn(); });
  dom.btnSkip.addEventListener('click', () => { playerSkip(); });

  // ---------- Boot ----------
  (async function boot(){
    showScreen('loading');
try{ await preload(); } catch(e){}

if (dom.modal) dom.modal.hidden = true; // sécurité
showScreen('home');
    loadSoundPref();

    // unlock audio after first user action (mobile)
    const unlock = () => { AudioFX.initOnce(); document.removeEventListener('pointerdown', unlock); };
    document.addEventListener('pointerdown', unlock, { once: true });
  })();

  // Safety UI refresh
  setInterval(() => {
    if (screens.game.classList.contains('screen--active')){
      updateUI();
      if (S.turnIndex >= 8 && S.phase !== 'gameOver') step();
    }
  }, 250);

})();