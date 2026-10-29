/* No Limit: the play screens. The engine (Python) runs in a web worker; see engine.js. */
"use strict";

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString("en-US");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUITS = { c: "♣", d: "♦", h: "♥", s: "♠" };
const STREETS = ["Preflop", "Flop", "Turn", "River"];
const BOT_CHOICES = [
  ["nolimit", "Bot", "the competition bot"],
  ["maniac", "maniac", "raises everything"],
  ["tag", "tag", "tight-aggressive"],
  ["nit", "nit", "very tight"],
  ["pusher", "pusher", "shoves or folds"],
  ["station", "station", "calls everything"],
  ["random", "random", "random moves"],
  ["loose-passive", "loose-passive", "plays most hands"],
  ["erratic", "erratic", "changes style"],
  ["keating", "keating", "loose and unpredictable"],
];
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
};
const settings = {
  get reveal() { return store.get("nolimit.reveal", "1") === "1"; },
  set reveal(v) { store.set("nolimit.reveal", v ? "1" : "0"); },
  get instant() { return store.get("nolimit.instant", "0") === "1"; },
  set instant(v) { store.set("nolimit.instant", v ? "1" : "0"); },
};

let engine = null;     // Engine (worker bridge)
let G = null;          // current game
let picked = [];       // lobby: chosen opponents
let currentPage = "play";

// ------------------------------------------------------------------ helpers
function bbOf(chips, bb) {
  const v = chips / bb;
  return (v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")) + " bb";
}

function cardEl(str, extra) {
  const el = document.createElement("div");
  el.className = "card" + (extra ? " " + extra : "");
  if (!str) { el.classList.add("slot"); return el; }
  const r = str[0] === "T" ? "10" : str[0];
  const s = str[1];
  el.classList.add(s);
  el.innerHTML = `<span class="r">${r}</span><span class="s">${SUITS[s]}</span>`;
  el.setAttribute("aria-label", `${r} of ${{ c: "clubs", d: "diamonds", h: "hearts", s: "spades" }[s]}`);
  return el;
}

function cardsRow(cards, extra = "small") {
  const d = document.createElement("div");
  d.className = "cards";
  for (const c of cards || []) d.appendChild(cardEl(c, extra));
  return d;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const VIEWS = ["lobby", "table", "standings", "sessions", "session", "handview", "home", "result-form", "hand-form", "more"];
function show(view) {
  for (const v of VIEWS) $(v).hidden = v !== view;
  $("tabs").hidden = view === "table";
  const page = { lobby: "play", table: "play", standings: "play", sessions: "sessions", session: "sessions", handview: "sessions",
                 home: "home", "result-form": "home", "hand-form": "home", more: "more" }[view];
  document.querySelectorAll("#tabs button").forEach((b) => {
    if (b.dataset.page === page) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
}

function scoreBadge(score, label) {
  if (score === null || score === undefined) return "";
  return `<span class="badge ${label}">${Math.floor(score)} · ${label}</span>`;
}

// ------------------------------------------------------------------ lobby
function buildLobby() {
  const chips = $("bot-chips");
  chips.innerHTML = "";
  for (const [key, label, desc] of BOT_CHOICES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.title = desc;
    b.setAttribute("aria-label", `Add ${label}: ${desc}`);
    b.onclick = () => { if (picked.length < 7) { picked.push(key); renderPicked(); } };
    chips.appendChild(b);
  }
  renderPicked();
  document.querySelectorAll(".choice[data-mode]").forEach((b) => {
    b.onclick = () => startGame({ mode: b.dataset.mode });
  });
  $("custom-start").onclick = () => {
    const seed = $("seed").value.trim();
    const stack = $("stack").value.trim();
    const body = { mode: picked.length === 1 ? "heads-up" : "table", stack: Number(stack) || 2000 };
    if (picked.length) body.opponents = picked.slice();
    if (seed) body.seed = Number(seed);
    startGame(body);
  };
}

function renderPicked() {
  const box = $("picked");
  box.innerHTML = "";
  if (!picked.length) {
    box.innerHTML = `<span class="hint" style="margin:0">No players picked: the defaults are used.</span>`;
    return;
  }
  picked.forEach((key, i) => {
    const label = (BOT_CHOICES.find((b) => b[0] === key) || [key, key])[1];
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label + " ✕";
    b.setAttribute("aria-label", `Remove ${label}`);
    b.onclick = () => { picked.splice(i, 1); renderPicked(); };
    box.appendChild(b);
  });
  const n = document.createElement("span");
  n.className = "hint";
  n.style.margin = "4px 0 0";
  n.textContent = `${picked.length + 1} players with you`;
  box.appendChild(n);
}

async function checkResume() {
  const live = await DB.kvGet("live", null);
  $("resume").hidden = true;
  if (!live || !live.options) return;
  $("resume-sub").textContent = `${live.handsDone || 0} hands played, started ${new Date(live.startedAt).toLocaleString()}`;
  $("resume").hidden = false;
  $("resume-btn").onclick = () => resumeGame(live);
}

function goLobby() {
  G = null;
  show("lobby");
  checkResume();
}

// ------------------------------------------------------------------ game state
function newGameState(meta, options) {
  const m = meta;
  return {
    meta: m, n: m.seats, hero: m.hero, names: m.names, options,
    queue: [], processing: false, instant: settings.instant, reveal: settings.reveal,
    stacks: Array(m.seats).fill(options.stack || 2000), bets: Array(m.seats).fill(0),
    inHand: Array(m.seats).fill(false), dealt: Array(m.seats).fill(false), out: Array(m.seats).fill(false),
    bubbles: {}, shown: {}, board: [], pot: 0, button: 0, sb: 10, bb: 20, hand: 0,
    hole: null, turn: null, log: [], street: 0, heroOut: false, startStacks: [],
    actions: [],          // the hero's moves, for resume
    session: null,        // DB session document
    replaying: false,
  };
}

async function startGame(options) {
  $("lobby-error").textContent = "";
  try {
    const opts = { ...options, reveal: true };
    const r = await engine.newGame(opts);
    const full = { ...options, seed: r.meta.options.seed, stack: r.meta.options.stack };
    G = newGameState(r.meta, full);
    G.session = {
      id: DB.id(), startedAt: new Date().toISOString(), status: "live", options: full,
      names: r.meta.names, hero: r.meta.hero, hands: [], result: null,
    };
    await DB.put("sessions", G.session);
    await DB.kvSet("live", { options: full, actions: [], startedAt: G.session.startedAt, sessionId: G.session.id, handsDone: 0 });
    enterTable();
    G.queue.push(...r.events);
    pump();
  } catch (e) {
    $("lobby-error").textContent = "Couldn't start a game: " + e.message;
  }
}

async function resumeGame(live) {
  $("lobby-error").textContent = "";
  try {
    const r = await engine.newGame({ ...live.options, reveal: true });
    G = newGameState(r.meta, live.options);
    G.session = (await DB.get("sessions", live.sessionId)) || {
      id: live.sessionId, startedAt: live.startedAt, status: "live", options: live.options,
      names: r.meta.names, hero: r.meta.hero, hands: [], result: null,
    };
    G.actions = live.actions.slice();
    G.replaying = true;
    enterTable();
    $("waiting").textContent = "Replaying your game…";
    let evs = r.events;
    for (const a of live.actions) {
      for (const e of evs) await apply(e, G, true);
      evs = (await engine.act(a.kind, a.amount)).events;
    }
    G.replaying = false;
    G.queue.push(...evs);
    pump();
  } catch (e) {
    await DB.kvSet("live", null);
    $("lobby-error").textContent = "Couldn't resume that game: " + e.message;
    show("lobby");
  }
}

function enterTable() {
  $("instant").checked = G.instant;
  $("reveal").checked = G.reveal;
  show("table");
  buildSeats();
  renderAll();
}

function fast(ev) {
  return G.instant || G.heroOut || G.replaying;
}

async function pump() {
  if (!G || G.processing) return;
  const game = G;
  game.processing = true;
  try {
    while (game.queue.length && game === G) {
      const ev = game.queue.shift();
      if (ev.type === "your_turn") {
        game.turn = ev;
        renderAll();
        break;
      }
      await apply(ev, game, false);
    }
  } finally {
    game.processing = false;
  }
  if (game === G && !game.turn) renderControls();
}

async function apply(ev, game, replay) {
  const quick = replay || fast(ev);
  switch (ev.type) {
    case "hand_start": {
      game.hand = ev.hand; game.sb = ev.sb; game.bb = ev.bb; game.button = ev.button;
      game.level = ev.level; game.nextLevel = ev.hands_to_next_level;
      game.stacks = ev.stacks.slice(); game.bets = ev.bets.slice(); game.startStacks = ev.start_stacks.slice();
      game.dealt = ev.dealt.slice(); game.inHand = ev.dealt.slice();
      game.out = ev.start_stacks.map((s) => s === 0);
      game.playersLeft = ev.players_left;
      game.board = []; game.street = 0; game.shown = {}; game.bubbles = {}; game.hole = ev.hole;
      game.pot = ev.bets.reduce((a, b) => a + b, 0);
      game.log = [{ street: "Preflop", board: [] },
                  { text: `${game.names[ev.sb_seat]} posts ${fmt(ev.bets[ev.sb_seat])}` },
                  { text: `${game.names[ev.bb_seat]} posts ${fmt(ev.bets[ev.bb_seat])}` }];
      game.handActed = false;
      game.dealAnim = !quick;
      if (!replay) renderAll();
      if (!quick) await sleep(350);
      break;
    }
    case "action": {
      const s = ev.seat, a = ev.action;
      const prevHigh = Math.max(...game.bets);
      const added = ev.bets[s] - game.bets[s];
      const allIn = ev.stacks[s] === 0 && a.kind !== "F" && a.kind !== "K";
      let text;
      if (a.kind === "F") text = "Fold";
      else if (a.kind === "K") text = "Check";
      else if (a.kind === "C") text = allIn ? `All-in ${fmt(ev.bets[s])}` : `Call ${fmt(added)}`;
      else if (allIn) text = `All-in ${fmt(a.amount)}`;
      else text = (ev.street > 0 && prevHigh === 0) ? `Bet ${fmt(a.amount)}` : `Raise to ${fmt(a.amount)}`;
      game.stacks = ev.stacks.slice(); game.bets = ev.bets.slice(); game.inHand = ev.in_hand.slice();
      game.pot = ev.pot;
      game.bubbles[s] = text;
      game.lastActor = s;
      if (s === game.hero) game.handActed = true;
      game.log.push({ text: `${game.names[s]}: ${text.toLowerCase()}` });
      if (!replay) renderAll();
      if (!quick && s !== game.hero) await sleep(600);
      break;
    }
    case "street": {
      game.street = ev.street; game.board = ev.board.slice(); game.pot = ev.pot;
      game.bets = Array(game.n).fill(0); game.bubbles = {};
      game.boardAnimFrom = quick ? 99 : (ev.street === 1 ? 0 : ev.board.length - 1);
      game.log.push({ street: STREETS[ev.street], board: ev.board.slice() });
      if (!replay) renderAll();
      if (!quick) await sleep(500);
      break;
    }
    case "hand_end": {
      game.stacks = ev.stacks.slice(); game.bets = Array(game.n).fill(0);
      if (ev.board.length > game.board.length) game.board = ev.board.slice();
      game.shown = game.reveal ? ev.all_cards : ev.shown;
      game.pot = 0;
      game.playersLeft = ev.players_left;
      const heroBusted = ev.busted.includes(game.hero);
      if (!replay) renderAll();
      await saveHand(ev, game, replay);
      if (!quick) await showResult(ev, game);
      else if (!replay && game.handActed && ev.analysis) await showResult(ev, game);
      for (const s of ev.busted) game.out[s] = true;
      if (heroBusted && !game.heroOut) {
        game.heroOut = true;
        if (!replay) banner("You're out. Finishing the table…", 4000);
      }
      break;
    }
    case "game_over":
      await finishGame(ev, game);
      break;
  }
}

async function saveHand(ev, game, replay) {
  if (!game.session) return;
  const s = game.session;
  if (s.hands.some((h) => h.n === ev.hand)) return;    // already saved (resume replay)
  const a = ev.analysis;
  s.hands.push({
    n: ev.hand, hole: game.hole, board: ev.board, deltas: ev.deltas, all_cards: ev.all_cards, all_rank: ev.all_rank,
    shown: ev.shown, record: ev.record, analysis: a, score: a ? a.score : null, label: a ? a.label : null,
    bb: game.bb, players: game.playersLeft + ev.busted.length, busted: ev.busted,
  });
  const scored = s.hands.filter((h) => h.score !== null && h.score !== undefined);
  s.avgScore = scored.length ? Math.round(scored.reduce((x, h) => x + h.score, 0) / scored.length * 10) / 10 : null;
  s.handsPlayed = s.hands.length;
  s.net = game.stacks[game.hero] - (game.options.stack || 2000);
  await DB.put("sessions", s);
  if (!replay) {
    const live = await DB.kvGet("live", null);
    if (live) { live.handsDone = s.hands.length; await DB.kvSet("live", live); }
  }
}

// ------------------------------------------------------------------ rendering
function seatPos(s) {
  const n = G.n, rel = (s - G.hero + n) % n;      // 1..n-1, clockwise from you
  let deg;
  if (n === 2) deg = 270;
  else deg = 160 + ((rel - 1) / (n - 2)) * 220;
  const rad = (deg * Math.PI) / 180;
  return { x: 50 + 41 * Math.cos(rad), y: 56 + 41 * Math.sin(rad) };
}

function buildSeats() {
  const box = $("seats");
  box.innerHTML = "";
  G.seatEls = {};
  G.betEls = {};
  for (let s = 0; s < G.n; s++) {
    if (s === G.hero) continue;
    const p = seatPos(s);
    const el = document.createElement("div");
    el.className = "seat" + (G.names[s] === "Bot" ? " is-bot" : "");
    el.style.left = `clamp(40px, ${p.x}%, calc(100% - 40px))`;
    el.style.top = p.y + "%";
    if (p.x > 55) el.classList.add("right");
    el.title = "Tap to show stacks in big blinds";
    el.onclick = () => { G.showBB = !G.showBB; renderSeats(); };
    box.appendChild(el);
    G.seatEls[s] = el;
    const bet = document.createElement("div");
    bet.className = "bet";
    bet.style.left = (p.x + (50 - p.x) * 0.42) + "%";
    bet.style.top = (p.y + (56 - p.y) * 0.42) + "%";
    box.appendChild(bet);
    G.betEls[s] = bet;
  }
}

function renderAll() {
  if (!G) return;
  renderStatus();
  renderSeats();
  renderBoard();
  renderHero();
  renderControls();
}

function renderStatus() {
  const lvl = G.nextLevel ? `, blinds up in ${G.nextLevel}` : "";
  $("status").innerHTML = G.hand
    ? `<strong>Hand ${G.hand}</strong> &nbsp;Blinds ${fmt(G.sb)}/${fmt(G.bb)}<br>${G.playersLeft} players left${lvl}`
    : "Dealing…";
}

function renderSeats() {
  for (const k of Object.keys(G.seatEls)) {
    const s = Number(k), el = G.seatEls[s], bb = G.bb;
    const folded = G.dealt[s] && !G.inHand[s];
    el.classList.toggle("folded", folded);
    el.classList.toggle("out", G.out[s]);
    let st;
    if (G.out[s]) st = "out";
    else if (G.stacks[s] === 0 && G.inHand[s]) st = "all-in";
    else st = G.showBB ? bbOf(G.stacks[s], bb) : fmt(G.stacks[s]);
    let html = `<div class="nm">${esc(G.names[s])}</div><div class="st">${st}</div>`;
    if (G.button === s && !G.out[s]) html += `<span class="dealer" aria-label="Dealer">D</span>`;
    if (G.bubbles[s] && (!folded || s === G.lastActor)) html += `<span class="bubble">${G.bubbles[s]}</span>`;
    el.innerHTML = html;
    if (G.shown[s]) {
      const sh = document.createElement("div");
      sh.className = "shown";
      for (const c of G.shown[s]) sh.appendChild(cardEl(c, "small"));
      el.appendChild(sh);
    }
    const b = G.betEls[s];
    b.textContent = G.bets[s] ? fmt(G.bets[s]) : "";
    b.hidden = !G.bets[s];
  }
}

function renderBoard() {
  const box = $("board");
  box.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const anim = G.boardAnimFrom !== undefined && i >= G.boardAnimFrom && i < G.board.length;
    box.appendChild(cardEl(G.board[i], anim ? "deal" : ""));
  }
  G.boardAnimFrom = undefined;
  $("pot").textContent = G.pot ? `Pot ${fmt(G.pot)}` : "";
  const t = G.turn;
  if (t && t.to_call > 0) {
    const odds = Math.round((100 * t.to_call) / (t.pot + t.to_call));
    $("odds").textContent = `${fmt(t.to_call)} to call, pot odds ${odds}%`;
  } else {
    $("odds").textContent = "";
  }
}

function renderHero() {
  const h = G.hero, hole = $("hole");
  hole.innerHTML = "";
  if (G.hole && !G.out[h]) {
    for (const c of G.hole) hole.appendChild(cardEl(c, G.dealAnim ? "deal" : ""));
  }
  G.dealAnim = false;
  hole.classList.toggle("folded", G.dealt[h] && !G.inHand[h]);
  const dealer = G.button === h ? `<span class="dealer" aria-label="You are the dealer">D</span>` : "";
  $("hero-stack").innerHTML = G.out[h] || G.heroOut
    ? "You're out"
    : `You &nbsp;<strong>${fmt(G.stacks[h])}</strong> &nbsp;${bbOf(G.stacks[h], G.bb)}${dealer}`;
  $("hero-bet").innerHTML = G.bets[h] ? `<span class="bet">${fmt(G.bets[h])}</span>` : "";
}

// ------------------------------------------------------------------ controls
function renderControls() {
  const c = $("controls"), t = G && G.turn;
  if (!t) {
    c.classList.add("idle");
    closeDrawer();
    let msg = "Waiting for the other players";
    if (G && G.replaying) msg = "Replaying your game…";
    else if (G && G.heroOut) msg = "You're out. Finishing the table…";
    else if (G && G.dealt[G.hero] && !G.inHand[G.hero]) msg = "You folded. Watching the hand.";
    $("waiting").textContent = msg;
    return;
  }
  c.classList.remove("idle");
  const legal = new Set(t.legal);
  const fold = $("btn-fold"), call = $("btn-call"), raise = $("btn-raise");
  fold.disabled = !legal.has("F");
  if (legal.has("C")) {
    const allIn = t.to_call >= t.my_stack;
    call.querySelector(".lbl").textContent = allIn ? "All-in" : "Call";
    call.querySelector(".amt").textContent = fmt(Math.min(t.to_call, t.my_stack));
  } else {
    call.querySelector(".lbl").textContent = "Check";
    call.querySelector(".amt").textContent = "";
  }
  call.disabled = false;
  raise.disabled = !legal.has("R");
  raise.querySelector(".lbl").textContent = t.street > 0 && t.to_call === 0 ? "Bet" : "Raise";
}

function presets(t) {
  const out = [], bb = t.bb, high = t.my_bet + t.to_call, potAfter = t.pot + t.to_call;
  const add = (label, to) => {
    to = Math.round(Math.max(t.min_raise_to, Math.min(t.max_raise_to, to)));
    if (!out.some((p) => p.to === to)) out.push({ label: to === t.max_raise_to ? "All-in" : label, to });
  };
  if (t.street === 0) {
    if (high <= bb) { add("2.5 bb", 2.5 * bb); add("3 bb", 3 * bb); } else { add("3×", 3 * high); }
    add("Pot", high + potAfter);
  } else {
    add("⅓ pot", high + potAfter / 3);
    add("½ pot", high + potAfter / 2);
    add("⅔ pot", high + (2 * potAfter) / 3);
    add("Pot", high + potAfter);
  }
  add("All-in", t.max_raise_to);
  return out;
}

let raiseTo = 0, armTimer = null;

function openDrawer() {
  const t = G.turn;
  if (!t) return;
  $("drawer").hidden = false;
  $("btn-raise").setAttribute("aria-expanded", "true");
  const ps = presets(t);
  const box = $("presets");
  box.innerHTML = "";
  for (const p of ps) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "preset";
    b.dataset.to = p.to;
    b.innerHTML = `${p.label}<small>${fmt(p.to)}</small>`;
    b.onclick = () => setRaise(p.to);
    box.appendChild(b);
  }
  const steps = Math.max(1, Math.ceil((t.max_raise_to - t.min_raise_to) / t.bb));
  const sl = $("slider");
  sl.min = 0; sl.max = steps; sl.step = 1;
  sl.oninput = () => {
    const k = Number(sl.value);
    setRaise(k >= steps ? t.max_raise_to : t.min_raise_to + k * t.bb, true);
  };
  const def = ps.find((p) => p.label === "½ pot" || p.label === "2.5 bb" || p.label === "3×") || ps[0];
  setRaise(def ? def.to : t.min_raise_to);
}

function closeDrawer() {
  $("drawer").hidden = true;
  $("btn-raise").setAttribute("aria-expanded", "false");
  disarm();
}

function setRaise(to, fromSlider) {
  const t = G.turn;
  raiseTo = to;
  disarm();
  if (!fromSlider) {
    const steps = Number($("slider").max);
    $("slider").value = to >= t.max_raise_to ? steps : Math.round((to - t.min_raise_to) / t.bb);
  }
  $("slider-out").textContent = `${fmt(to)} · ${bbOf(to, t.bb)}`;
  document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.to) === to)));
  $("confirm").textContent = confirmLabel(to);
}

function confirmLabel(to) {
  const t = G.turn;
  if (to >= t.max_raise_to) return `All-in ${fmt(to)}`;
  return (t.street > 0 && t.to_call === 0 ? "Bet " : "Raise to ") + fmt(to);
}

function disarm() {
  clearTimeout(armTimer);
  $("confirm").classList.remove("armed");
  if (G && G.turn && raiseTo) $("confirm").textContent = confirmLabel(raiseTo);
}

function onConfirm() {
  const t = G.turn;
  if (!t) return;
  const big = raiseTo >= t.max_raise_to || raiseTo - t.my_bet > 0.5 * (t.my_stack + t.my_bet);
  const btn = $("confirm");
  if (big && !btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.textContent = raiseTo >= t.max_raise_to ? "Tap again to go all-in" : `Tap again: ${confirmLabel(raiseTo).toLowerCase()}`;
    armTimer = setTimeout(disarm, 3000);
    return;
  }
  submit("R", raiseTo);
}

async function submit(kind, amount) {
  const g = G, t = g && g.turn;
  if (!t) return;
  g.turn = null;
  closeDrawer();
  renderAll();
  try {
    const r = await engine.act(kind, amount || 0);
    g.actions.push({ kind, amount: amount || 0 });
    const live = await DB.kvGet("live", null);
    if (live && g.session && live.sessionId === g.session.id) { live.actions = g.actions.slice(); await DB.kvSet("live", live); }
    if (g !== G) return;
    g.queue.push(...r.events);
    pump();
  } catch (e) {
    if (g !== G) return;
    g.turn = t;
    banner(e.message);
    renderAll();
  }
}

function setupControls() {
  const fold = $("btn-fold");
  let holdTimer = null;
  const cancelHold = () => { clearTimeout(holdTimer); fold.classList.remove("holding"); };
  fold.addEventListener("pointerdown", (e) => {
    if (fold.disabled) return;
    e.preventDefault();
    fold.classList.add("holding");
    holdTimer = setTimeout(() => { fold.classList.remove("holding"); submit("F"); }, 250);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => fold.addEventListener(ev, cancelHold));
  fold.addEventListener("click", (e) => { if (e.detail === 0) submit("F"); });
  fold.addEventListener("contextmenu", (e) => e.preventDefault());
  $("btn-call").onclick = () => { const t = G && G.turn; if (t) submit(t.legal.includes("C") ? "C" : "K"); };
  $("btn-raise").onclick = () => { if ($("drawer").hidden) openDrawer(); else closeDrawer(); };
  $("confirm").onclick = onConfirm;
  $("log-btn").onclick = openLog;
  $("log-close").onclick = () => { $("log").hidden = true; };
  $("menu-btn").onclick = () => {
    const m = $("menu");
    m.hidden = !m.hidden;
    $("menu-btn").setAttribute("aria-expanded", String(!m.hidden));
  };
  $("instant").onchange = (e) => { settings.instant = e.target.checked; if (G) G.instant = e.target.checked; };
  $("reveal").onchange = (e) => { settings.reveal = e.target.checked; if (G) G.reveal = e.target.checked; };
  $("leave").onclick = () => { $("menu").hidden = true; goLobby(); };
  document.addEventListener("click", (e) => {
    if (!$("menu").hidden && !e.target.closest("#menu") && e.target.id !== "menu-btn") $("menu").hidden = true;
  });
  $("rematch").onclick = () => G && startGame({ mode: G.options.mode, opponents: G.options.opponents, seed: G.options.seed, stack: G.options.stack });
  $("to-lobby").onclick = goLobby;
  $("review-session").onclick = () => { if (G && G.session) Pages.openSession(G.session.id); };
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.onclick = () => Pages.go(b.dataset.page);
  });
}

// ------------------------------------------------------------------ sheets & banners
function openLog() {
  const list = $("log-list");
  list.innerHTML = "";
  for (const item of (G ? G.log : [])) {
    const li = document.createElement("li");
    if (item.street) {
      li.className = "street";
      li.textContent = item.street;
      if (item.board.length) li.appendChild(cardsRow(item.board));
    } else {
      li.textContent = item.text;
    }
    list.appendChild(li);
  }
  $("log").hidden = false;
}

function renderPlayersTable(ev, game, names, hero) {
  const deltas = ev.deltas;
  const cards = game.reveal ? ev.all_cards : ev.shown;
  const ranks = game.reveal ? ev.all_rank : ev.shown_rank;
  const rows = document.createElement("ul");
  rows.className = "result-rows";
  const seats = Object.keys(cards || {}).map(Number).concat(deltas.map((d, s) => (d ? s : -1)).filter((s) => s >= 0));
  const uniq = [...new Set(seats)].sort((a, b) => deltas[b] - deltas[a]);
  for (const s of uniq) {
    const li = document.createElement("li");
    const folded = ev.record && ev.record.actions.some((a) => a.seat === s && a.kind === "F");
    if (folded) li.classList.add("folded");
    const nm = document.createElement("span");
    nm.innerHTML = esc(s === hero ? "You" : names[s]) + (ranks && ranks[s] ? ` <span class="rk">${ranks[s]}${folded ? ", folded" : ""}</span>` : (folded ? ` <span class="rk">folded</span>` : ""));
    const d = document.createElement("span");
    d.className = "delta " + (deltas[s] > 0 ? "up" : deltas[s] < 0 ? "down" : "");
    d.textContent = deltas[s] > 0 ? "+" + fmt(deltas[s]) : deltas[s] < 0 ? "−" + fmt(-deltas[s]) : "0";
    li.append(nm, cardsRow(cards ? cards[s] : []), d);
    rows.appendChild(li);
  }
  return rows;
}

function renderAnalysis(a) {
  const box = document.createElement("div");
  box.className = "analysis";
  if (!a || a.error || !a.decisions || !a.decisions.length) {
    box.innerHTML = `<p class="hint">No decisions to score in this hand.</p>`;
    return box;
  }
  box.innerHTML = `<div class="analysis-head"><h3>Your decisions</h3>${scoreBadge(a.score, a.label)}</div>`;
  for (const d of a.decisions) {
    const el = document.createElement("div");
    el.className = "decision " + d.label;
    const opts = d.options.map((o) => `<span class="${o.best ? "best" : ""} ${o.chosen ? "chosen" : ""}">${esc(o.name)} <b>${o.ev >= 0 ? "+" : ""}${fmt(o.ev)}</b></span>`).join("");
    el.innerHTML = `
      <div class="decision-top"><span class="where">${d.street}${d.board.length ? "" : ""} · ${esc(d.situation)}</span>${scoreBadge(d.score, d.label)}</div>
      <div class="decision-line">You: <b>${esc(d.chosen)}</b>${d.chosen !== d.best ? ` · Best: <b>${esc(d.best)}</b>` : ""}</div>
      <p class="why">${esc(d.why)}</p>
      <div class="opts">${opts}</div>
      ${d.hindsight ? `<p class="hindsight">${esc(d.hindsight)}</p>` : ""}`;
    box.appendChild(el);
  }
  return box;
}

function showResult(ev, game) {
  return new Promise((resolve) => {
    const h = game.hero, deltas = ev.deltas;
    const winners = deltas.map((d, s) => [d, s]).filter(([d]) => d > 0).sort((a, b) => b[0] - a[0]);
    const body = $("result-body");
    let head, cls = "";
    if (deltas[h] > 0) { head = `You win ${fmt(deltas[h])}`; cls = "win"; }
    else if (deltas[h] < 0 && game.dealt[h]) { head = `You lose ${fmt(-deltas[h])}`; cls = "lose"; }
    else if (winners.length) head = `${game.names[winners[0][1]]} wins ${fmt(winners[0][0])}`;
    else head = "Split pot";
    const shownSeats = Object.keys(ev.shown).map(Number);
    let sub;
    if (!shownSeats.length) sub = "Everyone else folded.";
    else if (winners.length) {
      const ws = winners[0][1], rank = (ev.shown_rank[ws] || "the best hand").toLowerCase();
      sub = cls === "lose" ? `${game.names[ws]} wins with ${rank}.` : `With ${rank}.`;
    } else sub = "Equal hands.";
    body.innerHTML = `<p class="result-head ${cls}">${head}</p><p class="result-sub">${esc(sub)}</p>`;
    if (ev.board.length) body.appendChild(cardsRow(ev.board, "small"));
    body.appendChild(renderPlayersTable(ev, game, game.names, h));
    if (ev.busted.length) {
      const p = document.createElement("p");
      p.className = "result-sub";
      const who = ev.busted.map((s) => (s === h ? "You" : game.names[s]));
      const list = who.length === 1 ? who[0] : who.slice(0, -1).join(", ") + " and " + who[who.length - 1];
      p.textContent = `${list} ${who.length === 1 && who[0] !== "You" ? "is" : "are"} out.`;
      body.appendChild(p);
    }
    if (game.handActed || ev.analysis) body.appendChild(renderAnalysis(ev.analysis));
    const sheet = $("result");
    sheet.hidden = false;
    sheet.querySelector(".sheet-scroll").scrollTop = 0;
    const done = () => { clearTimeout(timer); sheet.hidden = true; $("result-next").onclick = null; resolve(); };
    const needsTap = game.handActed && ev.analysis && ev.analysis.decisions && ev.analysis.decisions.length;
    const timer = needsTap ? null : setTimeout(done, 2200);
    $("result-next").textContent = needsTap ? "Next hand" : "Continue";
    $("result-next").onclick = done;
  });
}

let bannerTimer = null;
function banner(text, ms = 2600) {
  let b = document.querySelector(".banner");
  if (!b) { b = document.createElement("div"); b.className = "banner"; b.setAttribute("role", "status"); $("table").appendChild(b); }
  b.textContent = text;
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

// ------------------------------------------------------------------ standings
async function finishGame(ev, game) {
  const n = game.n;
  const rows = [];
  for (let s = 0; s < n; s++) rows.push({ s, place: ev.places[s], pts: ev.points[s] });
  const survivors = rows.filter((r) => !r.place).sort((a, b) => b.pts - a.pts);
  survivors.forEach((r, i) => { r.place = i + 1; });
  rows.sort((a, b) => a.place - b.place);
  const me = rows.find((r) => r.s === game.hero);
  if (game.session) {
    game.session.status = "done";
    game.session.endedAt = new Date().toISOString();
    game.session.result = { place: me.place, points: me.pts, hands: ev.hands, players: n };
    await DB.put("sessions", game.session);
  }
  await DB.kvSet("live", null);
  $("standings-title").textContent = me.place === 1 ? "You won the table" : `You finished ${ordinal(me.place)}`;
  const w = rows[0];
  $("standings-sub").textContent = ev.winner !== null
    ? `${w.s === game.hero ? "You" : game.names[w.s]} took every chip after ${ev.hands} hands.`
    : `The table hit the ${ev.hands}-hand limit; survivors split points by chip count.`;
  const s = game.session;
  $("session-score").innerHTML = s && s.avgScore !== null && s.avgScore !== undefined
    ? `<div class="tile"><span class="tile-v">${scoreBadge(s.avgScore, labelOf(s.avgScore))}</span><span class="tile-l">average decision score over ${s.hands.filter((h) => h.score !== null).length} hands</span></div>`
    : "";
  const list = $("places");
  list.innerHTML = "";
  for (const r of rows) {
    const li = document.createElement("li");
    if (r.s === game.hero) li.className = "me";
    const pts = Math.round(r.pts * 10) / 10;
    li.innerHTML = `<span class="pl">${r.place}</span><span>${r.s === game.hero ? "You" : esc(game.names[r.s])}</span><span class="pts">${pts} pts</span>`;
    list.appendChild(li);
  }
  if (!game.replaying) { await sleep(fast(ev) ? 0 : 600); }
  show("standings");
}

function labelOf(score) {
  return score >= 95 ? "optimal" : score >= 80 ? "fine" : score >= 55 ? "mistake" : "blunder";
}

// ------------------------------------------------------------------ boot
async function boot() {
  const fill = $("boot-fill"), msg = $("boot-msg");
  let p = 5;
  const tick = setInterval(() => { p = Math.min(92, p + (92 - p) * 0.06); fill.style.width = p + "%"; }, 150);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  engine = new Engine();
  try {
    await engine.ready();
  } catch (e) {
    clearInterval(tick);
    msg.textContent = "The engine couldn't load. Reload the page; if this is the first open, make sure you're online.";
    return;
  }
  clearInterval(tick);
  fill.style.width = "100%";
  await sleep(150);
  $("boot").hidden = true;
  try {
    const ed = await engine.edition();
    if (ed.edition === "public") {
      document.querySelector("#lobby .lobby-head p").textContent =
        "Practice against bots under the regional rules: 2,000 chips, blinds from 10/20, rising every 25 hands. " +
        "Every hand you play is scored and saved. This public version uses a stand-in for the competition bot.";
      BOT_CHOICES[0][2] = "stand-in for the competition bot";
    }
  } catch (e) { /* older bundle: full edition */ }
  buildLobby();
  setupControls();
  Pages.init();
  show("lobby");
  checkResume();
}

boot();
