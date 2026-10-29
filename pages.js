/* Sessions, home games and settings pages. */
"use strict";

const Pages = (() => {
  const POS_NAMES = (n) => {   // seat index -> position label, seat 0 = dealer
    if (n === 2) return ["BTN/SB", "BB"];
    const names = Array(n).fill("");
    names[0] = "BTN"; names[1] = "SB"; names[2] = "BB";
    const late = { 1: "CO", 2: "HJ", 3: "LJ" };
    for (let rel = 3; rel < n; rel++) {
      const fromEnd = n - rel;
      names[rel] = late[fromEnd] && n >= 5 ? late[fromEnd] : rel === 3 ? "UTG" : `UTG+${rel - 3}`;
    }
    return names;
  };
  const money = (x) => (x < 0 ? "−" : "") + "$" + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const dateStr = (iso) => { const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00") : new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  let backTo = "sessions";

  // ================================================================ navigation
  function go(page) {
    if (page === "play") { if (G && G.session && G.session.status === "live" && !$("table").hidden) return; show(G && !$("standings").hidden ? "standings" : "lobby"); if ($("lobby").hidden === false) checkResume(); }
    else if (page === "sessions") renderSessions();
    else if (page === "home") renderHome();
    else if (page === "more") renderMore();
  }

  // ================================================================ sessions
  async function renderSessions() {
    show("sessions");
    const list = $("sessions-list");
    const all = (await DB.all("sessions")).sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    if (!all.length) {
      list.innerHTML = `<div class="empty"><p>No sessions yet.</p><p class="hint">Play a game and every hand will show up here with its analysis.</p><button class="btn-brass" type="button" onclick="Pages.go('play')">Play now</button></div>`;
      return;
    }
    list.innerHTML = "";
    for (const s of all) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "row";
      const mode = s.options.mode === "table" ? "Full table" : s.options.mode === "maniac" ? "vs maniac" : s.options.opponents ? `${s.names.length} players` : "Heads-up";
      const res = s.result ? `finished ${ordinal(s.result.place)} of ${s.result.players} · ${Math.round(s.result.points)} pts` : s.status === "live" ? "in progress" : "unfinished";
      b.innerHTML = `<div class="row-main"><div class="row-title">${mode} <span class="muted">· ${dateStr(s.startedAt)}</span></div>
        <div class="row-sub">${res} · ${s.handsPlayed || s.hands.length} hands</div></div>
        <div class="row-right">${s.avgScore !== null && s.avgScore !== undefined ? scoreBadge(s.avgScore, labelOf(s.avgScore)) : ""}</div>`;
      b.onclick = () => openSession(s.id);
      list.appendChild(b);
    }
  }

  async function openSession(id) {
    const s = await DB.get("sessions", id);
    if (!s) return renderSessions();
    show("session");
    backTo = "sessions";
    const mode = s.options.mode === "table" ? "Full table" : s.options.mode === "maniac" ? "vs maniac" : "Heads-up";
    $("session-title").textContent = `${mode} · ${dateStr(s.startedAt)}`;
    $("session-sub").textContent = s.result ? `You finished ${ordinal(s.result.place)} of ${s.result.players} after ${s.result.hands} hands.` : s.status === "live" ? "In progress." : "Not finished.";
    const scored = s.hands.filter((h) => h.score !== null && h.score !== undefined);
    const counts = { optimal: 0, fine: 0, mistake: 0, blunder: 0 };
    let decisions = 0;
    for (const h of scored) for (const d of (h.analysis.decisions || [])) { counts[d.label]++; decisions++; }
    const worst = scored.flatMap((h) => (h.analysis.decisions || []).map((d) => ({ ...d, n: h.n }))).sort((a, b) => a.score - b.score).slice(0, 3);
    $("session-summary").innerHTML = `
      <div class="tiles">
        <div class="tile"><span class="tile-v">${s.avgScore !== null && s.avgScore !== undefined ? Math.round(s.avgScore) : "–"}</span><span class="tile-l">average score</span></div>
        <div class="tile"><span class="tile-v">${decisions}</span><span class="tile-l">decisions</span></div>
        <div class="tile"><span class="tile-v">${counts.mistake + counts.blunder}</span><span class="tile-l">mistakes</span></div>
        <div class="tile"><span class="tile-v ${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${s.net > 0 ? "+" : ""}${fmt(s.net || 0)}</span><span class="tile-l">chips</span></div>
      </div>
      ${worst.length && worst[0].label !== "optimal" ? `<h2>Biggest leaks</h2><ul class="leaks">${worst.filter((d) => d.label !== "optimal").map((d) => `<li><b>Hand ${d.n}, ${d.street}</b> (${esc(d.situation)}): you ${esc(d.chosen.toLowerCase())}, best was ${esc(d.best.toLowerCase())}. ${scoreBadge(d.score, d.label)}</li>`).join("")}</ul>` : ""}
      <h2>Hands</h2>`;
    const box = $("session-hands");
    box.innerHTML = "";
    for (const h of s.hands) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "row";
      const d = h.deltas[s.hero];
      const left = document.createElement("div");
      left.className = "row-main";
      left.innerHTML = `<div class="row-title">Hand ${h.n}</div>`;
      left.querySelector(".row-title").appendChild(cardsRow(h.hole || [], "small"));
      const right = document.createElement("div");
      right.className = "row-right";
      right.innerHTML = `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" : d < 0 ? "−" : ""}${fmt(Math.abs(d))}</span>${h.score !== null && h.score !== undefined ? scoreBadge(h.score, h.label) : `<span class="muted">no decision</span>`}`;
      b.append(left, right);
      b.onclick = () => openHand(s, h);
      box.appendChild(b);
    }
    $("session-back").onclick = renderSessions;
  }

  function openHand(s, h) {
    show("handview");
    $("hand-title").textContent = `Hand ${h.n}`;
    $("hand-back").textContent = "‹ Session";
    $("hand-back").onclick = () => openSession(s.id);
    const d = h.deltas[s.hero];
    $("hand-sub").textContent = d > 0 ? `You won ${fmt(d)}` : d < 0 ? `You lost ${fmt(-d)}` : "No chips changed hands for you";
    $("hand-body").innerHTML = "";
    $("hand-body").appendChild(renderHandReplay(h.record, s.names, s.hero, { all_cards: h.all_cards, all_rank: h.all_rank, deltas: h.deltas, shown: h.shown, board: h.board }, h.analysis));
  }

  function renderHandReplay(rec, names, hero, end, analysis) {
    const wrap = document.createElement("div");
    const n = rec.seats;
    const pos = positionsFor(rec);
    const info = document.createElement("p");
    info.className = "hint";
    info.textContent = `Blinds ${fmt(rec.sb)}/${fmt(rec.bb)} · you were ${pos[hero]} with ${fmt(rec.start_stacks[hero])} chips`;
    wrap.appendChild(info);
    wrap.appendChild(cardsRow(rec.hole[String(hero)] || [], "small"));
    // streets
    const ol = document.createElement("ol");
    ol.className = "replay";
    let street = -1;
    const stacks = rec.start_stacks.slice(), bets = Array(n).fill(0);
    let high = 0;
    for (const a of rec.actions) {
      if (a.street !== street) {
        street = a.street;
        const li = document.createElement("li");
        li.className = "street";
        li.textContent = STREETS[street];
        if (street > 0) li.appendChild(cardsRow(rec.board.slice(0, [0, 3, 4, 5][street]), "small"));
        ol.appendChild(li);
        bets.fill(0); high = 0;
        if (street === 0) {
          if (rec.sb_seat !== undefined) { bets[rec.sb_seat] = rec.sb; bets[rec.bb_seat] = rec.bb; high = rec.bb; }
        }
      }
      const li = document.createElement("li");
      const who = a.seat === hero ? "You" : names[a.seat];
      let text;
      if (a.kind === "F") text = "fold";
      else if (a.kind === "K") text = "check";
      else if (a.kind === "C") { text = `call ${fmt(high - bets[a.seat])}`; bets[a.seat] = high; }
      else { text = (street > 0 && high === 0 ? "bet " : "raise to ") + fmt(a.to); bets[a.seat] = a.to; high = Math.max(high, a.to); }
      li.innerHTML = `<b>${esc(who)}</b> ${text}`;
      if (a.seat === hero) li.classList.add("me");
      ol.appendChild(li);
    }
    if (end && end.board && end.board.length > [0, 3, 4, 5][Math.max(0, street)]) {
      const li = document.createElement("li");
      li.className = "street";
      li.textContent = "Runout";
      li.appendChild(cardsRow(end.board, "small"));
      ol.appendChild(li);
    }
    wrap.appendChild(ol);
    if (end) {
      const h2 = document.createElement("h2");
      h2.textContent = "Everyone's cards";
      wrap.appendChild(h2);
      wrap.appendChild(renderPlayersTable({ deltas: end.deltas, all_cards: end.all_cards || end.shown, all_rank: end.all_rank || {}, shown: end.shown || {}, shown_rank: {}, record: rec }, { reveal: true }, names, hero));
    }
    wrap.appendChild(renderAnalysis(analysis));
    return wrap;
  }

  function positionsFor(rec) {
    const dealt = rec.seats_dealt || rec.start_stacks.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0);
    const order = dealt.slice().sort((a, b) => ((a - rec.button) % 1000 + 1000) % 1000 - ((b - rec.button) % 1000 + 1000) % 1000);
    const names = POS_NAMES(dealt.length);
    const out = {};
    order.forEach((s, i) => { out[s] = names[i]; });
    return out;
  }

  // ================================================================ home games: results
  let homeTab = "results";
  async function renderHome() {
    show("home");
    document.querySelectorAll("#home .segmented button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === homeTab));
      b.onclick = () => { homeTab = b.dataset.tab; renderHome(); };
    });
    $("home-results").hidden = homeTab !== "results";
    $("home-hands").hidden = homeTab !== "hands";
    if (homeTab === "results") await renderResults(); else await renderHomeHands();
  }

  async function renderResults() {
    const all = (await DB.all("homegames")).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const tiles = $("home-tiles"), chart = $("home-chart"), list = $("home-list");
    $("add-result").onclick = () => openResultForm(null);
    if (!all.length) {
      tiles.innerHTML = "";
      chart.innerHTML = `<div class="empty"><p>No results yet.</p><p class="hint">Add each home game's buy-in and cash-out and your profit over time shows up here.</p></div>`;
      list.innerHTML = "";
      return;
    }
    const profits = all.map((r) => r.cashout - r.buyin);
    const net = profits.reduce((a, b) => a + b, 0);
    const wins = profits.filter((p) => p > 0).length;
    const hours = all.reduce((a, r) => a + (Number(r.hours) || 0), 0);
    tiles.innerHTML = `
      <div class="tile"><span class="tile-v ${net > 0 ? "up" : net < 0 ? "down" : ""}">${money(net)}</span><span class="tile-l">net, ${all.length} session${all.length === 1 ? "" : "s"}</span></div>
      <div class="tile"><span class="tile-v">${Math.round((100 * wins) / all.length)}%</span><span class="tile-l">winning sessions</span></div>
      <div class="tile"><span class="tile-v ${Math.max(...profits) > 0 ? "up" : ""}">${money(Math.max(...profits))}</span><span class="tile-l">best</span></div>
      <div class="tile"><span class="tile-v ${Math.min(...profits) < 0 ? "down" : ""}">${money(Math.min(...profits))}</span><span class="tile-l">worst</span></div>
      ${hours ? `<div class="tile"><span class="tile-v">${money(net / hours)}</span><span class="tile-l">per hour over ${hours} h</span></div>` : ""}`;
    chart.innerHTML = "";
    chart.appendChild(profitChart(all, profits));
    list.innerHTML = "<h2>Sessions</h2>";
    for (const r of all.slice().reverse()) {
      const p = r.cashout - r.buyin;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "row";
      b.innerHTML = `<div class="row-main"><div class="row-title">${esc(r.venue)} <span class="muted">· ${dateStr(r.date)}</span></div>
        <div class="row-sub">${r.stakes ? esc(r.stakes) + " · " : ""}in ${money(r.buyin)}, out ${money(r.cashout)}${r.hours ? ` · ${r.hours} h` : ""}${r.notes ? ` · ${esc(r.notes)}` : ""}</div></div>
        <div class="row-right"><span class="delta ${p > 0 ? "up" : p < 0 ? "down" : ""}">${p > 0 ? "+" : ""}${money(p)}</span></div>`;
      b.onclick = () => openResultForm(r);
      list.appendChild(b);
    }
  }

  function profitChart(all, profits) {
    // Cumulative profit by session: one series, brass line, markers, zero baseline, tap for details.
    const W = 360, H = 200, padL = 44, padR = 14, padT = 16, padB = 28;
    const cum = [];
    let acc = 0;
    for (const p of profits) { acc += p; cum.push(acc); }
    const ys = [0, ...cum];
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const n = cum.length;
    const x = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
    const y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
    const ticks = niceTicks(lo, hi, 4);
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Cumulative profit over ${n} sessions, now ${money(cum[n - 1])}`);
    const mk = (tag, attrs, text) => {
      const e = document.createElementNS(svgNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text !== undefined) e.textContent = text;
      svg.appendChild(e);
      return e;
    };
    mk("text", { x: padL, y: 11, class: "chart-title" }, "Cumulative profit by session");
    for (const t of ticks) {
      mk("line", { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? "chart-zero" : "chart-grid" });
      mk("text", { x: padL - 6, y: y(t) + 4, class: "chart-tick", "text-anchor": "end" }, shortMoney(t));
    }
    const pts = cum.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    mk("polyline", { points: pts, class: "chart-line" });
    cum.forEach((v, i) => {
      const dot = mk("circle", { cx: x(i), cy: y(v), r: 4.5, class: "chart-dot" });
      const hit = mk("circle", { cx: x(i), cy: y(v), r: 14, class: "chart-hit" });
      const r = all[i];
      const label = `${dateStr(r.date)}: ${profits[i] >= 0 ? "+" : ""}${money(profits[i])} (total ${money(v)})`;
      hit.addEventListener("click", (e) => { e.stopPropagation(); showTip(svg, x(i), y(v), label, W); });
      dot.appendChild(document.createElementNS(svgNS, "title")).textContent = label;
    });
    if (n > 1) {
      mk("text", { x: padL, y: H - 8, class: "chart-tick" }, dateStr(all[0].date));
      mk("text", { x: W - padR, y: H - 8, class: "chart-tick", "text-anchor": "end" }, dateStr(all[n - 1].date));
    }
    mk("text", { x: x(n - 1) - 6, y: y(cum[n - 1]) - 10, class: "chart-label", "text-anchor": "end" }, money(cum[n - 1]));
    svg.addEventListener("click", () => svg.querySelectorAll(".chart-tip").forEach((t) => t.remove()));
    return svg;
  }

  function showTip(svg, cx, cy, text, W) {
    svg.querySelectorAll(".chart-tip").forEach((t) => t.remove());
    const g = document.createElementNS(svg.namespaceURI, "g");
    g.setAttribute("class", "chart-tip");
    const w = Math.min(W - 20, text.length * 6.2 + 16);
    const tx = Math.max(10, Math.min(W - w - 10, cx - w / 2));
    const ty = cy > 60 ? cy - 36 : cy + 14;
    g.innerHTML = `<rect x="${tx}" y="${ty}" width="${w}" height="24" rx="6"></rect><text x="${tx + 8}" y="${ty + 16}">${esc(text)}</text>`;
    svg.appendChild(g);
  }

  function niceTicks(lo, hi, count) {
    const span = hi - lo, raw = span / count, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 100) / 100);
    if (!out.includes(0) && lo < 0 && hi > 0) out.push(0);
    return out.sort((a, b) => a - b);
  }
  const shortMoney = (v) => (v < 0 ? "−" : "") + "$" + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1) + "k" : Math.abs(v));

  function openResultForm(r) {
    show("result-form");
    const f = $("result-form-el");
    f.reset();
    f.date.value = r ? r.date : new Date().toISOString().slice(0, 10);
    if (r) { f.venue.value = r.venue; f.buyin.value = r.buyin; f.cashout.value = r.cashout; f.hours.value = r.hours || ""; f.stakes.value = r.stakes || ""; f.notes.value = r.notes || ""; }
    $("result-delete").hidden = !r;
    $("result-delete").onclick = async () => { if (confirm("Delete this result?")) { await DB.del("homegames", r.id); homeTab = "results"; renderHome(); } };
    $("result-form-back").onclick = () => { homeTab = "results"; renderHome(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const obj = { id: r ? r.id : DB.id(), date: f.date.value, venue: f.venue.value.trim(), buyin: Number(f.buyin.value) || 0,
                    cashout: Number(f.cashout.value) || 0, hours: Number(f.hours.value) || 0, stakes: f.stakes.value.trim(), notes: f.notes.value.trim() };
      await DB.put("homegames", obj);
      homeTab = "results";
      renderHome();
    };
  }

  // ================================================================ home games: hands
  async function renderHomeHands() {
    const all = (await DB.all("homehands")).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    const list = $("homehands-list");
    $("add-hand").onclick = () => openHandForm();
    if (!all.length) {
      list.innerHTML = `<div class="empty"><p>No hands recorded.</p><p class="hint">Record a hand from your home game and get each decision scored, with the better line where there was one.</p></div>`;
      return;
    }
    list.innerHTML = "";
    for (const h of all) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "row";
      const left = document.createElement("div");
      left.className = "row-main";
      left.innerHTML = `<div class="row-title">${esc(h.title || "Hand")} <span class="muted">· ${dateStr(h.savedAt)}</span></div><div class="row-sub">${esc(h.summary || "")}</div>`;
      left.querySelector(".row-title").prepend(cardsRow(h.record.hole[String(h.record.hero)], "small"));
      const right = document.createElement("div");
      right.className = "row-right";
      right.innerHTML = h.analysis && h.analysis.score !== null ? scoreBadge(h.analysis.score, h.analysis.label) : "";
      b.append(left, right);
      b.onclick = () => openHomeHand(h);
      list.appendChild(b);
    }
  }

  function openHomeHand(h) {
    show("handview");
    $("hand-title").textContent = h.title || "Hand";
    $("hand-sub").textContent = h.summary || "";
    $("hand-back").textContent = "‹ Home games";
    $("hand-back").onclick = () => { homeTab = "hands"; renderHome(); };
    const body = $("hand-body");
    body.innerHTML = "";
    body.appendChild(renderHandReplay(h.record, h.record.names, h.record.hero, h.end || null, h.analysis));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-danger wide";
    del.textContent = "Delete this hand";
    del.onclick = async () => { if (confirm("Delete this hand?")) { await DB.del("homehands", h.id); homeTab = "hands"; renderHome(); } };
    body.appendChild(del);
  }

  // ---- the recorder
  const KINDS = [["F", "folds"], ["K", "checks"], ["C", "calls"], ["R", "bets / raises to"]];
  function openHandForm() {
    show("hand-form");
    $("hand-form-back").onclick = () => { homeTab = "hands"; renderHome(); };
    const root = $("hand-form-el");
    const state = { n: 6, hero: 0, sb: 1, bb: 2, stack: 200, names: [], stacks: [], hole: "", board: ["", "", ""], actions: [[], [], [], []], cards: {}, title: "" };
    const defaultNames = (n) => Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
    state.names = defaultNames(state.n);
    state.names[0] = "Me";
    const render = () => {
      const pos = POS_NAMES(state.n);
      root.innerHTML = `
        <div class="form">
          <label>Title <input id="hf-title" placeholder="e.g. AK vs a 3-bet at Sam's" value="${esc(state.title)}"></label>
          <div class="fields">
            <label>Players <select id="hf-n">${[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<option ${k === state.n ? "selected" : ""}>${k}</option>`).join("")}</select></label>
            <label>Your seat <select id="hf-hero">${pos.map((p, i) => `<option value="${i}" ${i === state.hero ? "selected" : ""}>${p}</option>`).join("")}</select></label>
          </div>
          <div class="fields">
            <label>Small blind <input id="hf-sb" inputmode="decimal" value="${state.sb}"></label>
            <label>Big blind <input id="hf-bb" inputmode="decimal" value="${state.bb}"></label>
          </div>
          <label>Your cards <input id="hf-hole" placeholder="As Kd" value="${esc(state.hole)}" autocapitalize="characters"></label>
          <details class="advanced" open>
            <summary>Players and stacks (seat 1 is the dealer)</summary>
            <div id="hf-players"></div>
          </details>
          ${[0, 1, 2, 3].map((st) => `
          <section class="street-box">
            <h3>${STREETS[st]}</h3>
            ${st > 0 ? `<label>${st === 1 ? "Flop cards" : st === 2 ? "Turn card" : "River card"} <input class="hf-board" data-st="${st}" placeholder="${st === 1 ? "Qs Jh 2c" : "9d"}" value="${esc(state.board[st - 1])}" autocapitalize="characters"></label>` : ""}
            <div class="action-rows" data-st="${st}"></div>
            <button type="button" class="btn-quiet add-action" data-st="${st}">+ Add action</button>
          </section>`).join("")}
          <details class="advanced">
            <summary>Opponents' cards, if you saw them</summary>
            <div id="hf-cards"></div>
          </details>
          <button type="button" class="btn-brass wide" id="hf-analyze">Analyze this hand</button>
          <p class="lobby-error" id="hf-error"></p>
          <div id="hf-result"></div>
        </div>`;
      // players
      const pl = root.querySelector("#hf-players");
      pl.innerHTML = state.names.map((nm, i) => `<div class="fields player-row"><label>${pos[i]} name <input class="hf-name" data-i="${i}" value="${esc(nm)}"></label><label>Stack <input class="hf-stack" data-i="${i}" inputmode="decimal" value="${state.stacks[i] ?? state.stack}"></label></div>`).join("");
      root.querySelector("#hf-cards").innerHTML = state.names.map((nm, i) => i === state.hero ? "" : `<label>${esc(nm)} <input class="hf-vcards" data-i="${i}" placeholder="unknown" value="${esc(state.cards[i] || "")}" autocapitalize="characters"></label>`).join("");
      for (let st = 0; st < 4; st++) renderActions(st);
      bind();
    };
    const renderActions = (st) => {
      const box = root.querySelector(`.action-rows[data-st="${st}"]`);
      box.innerHTML = "";
      state.actions[st].forEach((a, idx) => {
        const row = document.createElement("div");
        row.className = "action-row";
        row.innerHTML = `<select class="a-seat">${state.names.map((nm, i) => `<option value="${i}" ${a.seat === i ? "selected" : ""}>${esc(i === state.hero ? "Me" : nm)}</option>`).join("")}</select>
          <select class="a-kind">${KINDS.map(([k, l]) => `<option value="${k}" ${a.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          <input class="a-to" inputmode="decimal" placeholder="to" value="${a.to ?? ""}" ${a.kind === "R" ? "" : "hidden"}>
          <button type="button" class="a-del" aria-label="Remove">✕</button>`;
        row.querySelector(".a-seat").onchange = (e) => { a.seat = Number(e.target.value); };
        row.querySelector(".a-kind").onchange = (e) => { a.kind = e.target.value; row.querySelector(".a-to").hidden = a.kind !== "R"; };
        row.querySelector(".a-to").oninput = (e) => { a.to = Number(e.target.value); };
        row.querySelector(".a-del").onclick = () => { state.actions[st].splice(idx, 1); renderActions(st); };
        box.appendChild(row);
      });
    };
    const bind = () => {
      root.querySelector("#hf-title").oninput = (e) => { state.title = e.target.value; };
      root.querySelector("#hf-n").onchange = (e) => {
        const n = Number(e.target.value);
        state.names = state.names.slice(0, n).concat(defaultNames(n).slice(state.names.length));
        state.stacks = state.stacks.slice(0, n);
        state.n = n; state.hero = Math.min(state.hero, n - 1);
        state.actions = state.actions.map((list) => list.filter((a) => a.seat < n));
        render();
      };
      root.querySelector("#hf-hero").onchange = (e) => { state.hero = Number(e.target.value); render(); };
      root.querySelector("#hf-sb").oninput = (e) => { state.sb = Number(e.target.value); };
      root.querySelector("#hf-bb").oninput = (e) => { state.bb = Number(e.target.value); };
      root.querySelector("#hf-hole").oninput = (e) => { state.hole = e.target.value; };
      root.querySelectorAll(".hf-board").forEach((i) => { i.oninput = (e) => { state.board[Number(e.target.dataset.st) - 1] = e.target.value; }; });
      root.querySelectorAll(".hf-name").forEach((i) => { i.oninput = (e) => { state.names[Number(e.target.dataset.i)] = e.target.value; }; });
      root.querySelectorAll(".hf-stack").forEach((i) => { i.oninput = (e) => { state.stacks[Number(e.target.dataset.i)] = Number(e.target.value); }; });
      root.querySelectorAll(".hf-vcards").forEach((i) => { i.oninput = (e) => { state.cards[Number(e.target.dataset.i)] = e.target.value; }; });
      root.querySelectorAll(".add-action").forEach((b) => {
        b.onclick = () => {
          const st = Number(b.dataset.st);
          const prev = state.actions[st][state.actions[st].length - 1];
          const seat = prev ? (prev.seat + 1) % state.n : (st === 0 ? (state.n === 2 ? 0 : 3 % state.n) : 1 % state.n);
          state.actions[st].push({ seat, kind: "F", to: null });
          renderActions(st);
        };
      });
      root.querySelector("#hf-analyze").onclick = analyzeForm;
    };
    const parseCards = (s, count) => {
      const parts = s.trim().replace(/10/g, "T").replace(/,/g, " ").split(/\s+/).filter(Boolean)
        .map((c) => c.length === 2 ? c[0].toUpperCase() + c[1].toLowerCase() : c);
      for (const c of parts) if (!/^[2-9TJQKA][cdhs]$/.test(c)) throw new Error(`"${c}" is not a card. Use rank + suit, like As, Td or 9c.`);
      if (count !== undefined && parts.length !== count) throw new Error(`Expected ${count} card${count === 1 ? "" : "s"}, got ${parts.length}.`);
      return parts;
    };
    const buildRecord = () => {
      const n = state.n;
      const bb = Number(state.bb) || 2, sb = Number(state.sb) || 1;
      const scale = bb >= 1 && Number.isInteger(bb) && Number.isInteger(sb) ? 1 : 100;   // allow $0.25/$0.50 games
      const chips = (v) => Math.round((Number(v) || 0) * scale);
      const rec = { sb: chips(sb), bb: chips(bb), seats: n, hero: state.hero, button: 0, names: state.names.map((x, i) => i === state.hero ? "You" : x || `Player ${i + 1}`),
                    start_stacks: Array.from({ length: n }, (_, i) => chips(state.stacks[i] ?? state.stack)), hole: {}, board: [], actions: [], scale };
      rec.hole[String(state.hero)] = parseCards(state.hole, 2);
      for (const [i, v] of Object.entries(state.cards)) if (v && v.trim()) rec.hole[String(i)] = parseCards(v, 2);
      const b = [];
      if (state.board[0].trim()) b.push(...parseCards(state.board[0], 3));
      if (b.length === 3 && state.board[1].trim()) b.push(...parseCards(state.board[1], 1));
      if (b.length === 4 && state.board[2].trim()) b.push(...parseCards(state.board[2], 1));
      rec.board = b;
      const all = [].concat(...Object.values(rec.hole), b);
      if (new Set(all).size !== all.length) throw new Error("The same card appears twice.");
      for (let st = 0; st < 4; st++) {
        if (st > 0 && state.actions[st].length && b.length < [0, 3, 4, 5][st]) throw new Error(`Add the ${STREETS[st].toLowerCase()} card${st === 1 ? "s" : ""} before its actions.`);
        for (const a of state.actions[st]) {
          const act = { street: st, seat: a.seat, kind: a.kind };
          if (a.kind === "R") { if (!a.to) throw new Error(`Enter the amount for ${rec.names[a.seat]}'s bet on the ${STREETS[st].toLowerCase()}.`); act.to = chips(a.to); }
          rec.actions.push(act);
        }
      }
      if (!rec.actions.some((a) => a.seat === state.hero)) throw new Error("Add at least one action of yours.");
      return rec;
    };
    const analyzeForm = async () => {
      const err = root.querySelector("#hf-error"), out = root.querySelector("#hf-result");
      err.textContent = ""; out.innerHTML = "";
      let rec;
      try { rec = buildRecord(); } catch (e) { err.textContent = e.message; return; }
      try {
        const analysis = await engine.analyze(rec);
        out.appendChild(renderAnalysis(analysis));
        const save = document.createElement("button");
        save.type = "button";
        save.className = "btn-brass wide";
        save.textContent = "Save this hand";
        save.onclick = async () => {
          const pos = positionsFor(rec);
          const h = { id: DB.id(), savedAt: new Date().toISOString(), title: state.title.trim() || `${rec.hole[String(rec.hero)].join(" ")} from ${pos[rec.hero]}`,
                      summary: `${rec.seats} players, blinds ${state.sb}/${state.bb}`, record: rec, analysis };
          await DB.put("homehands", h);
          homeTab = "hands";
          renderHome();
        };
        out.appendChild(save);
        save.scrollIntoView({ behavior: "smooth", block: "end" });
      } catch (e) {
        err.textContent = "Couldn't analyze: " + e.message;
      }
    };
    render();
  }

  // ================================================================ more
  async function renderMore() {
    show("more");
    $("set-reveal").checked = settings.reveal;
    $("set-instant").checked = settings.instant;
    $("set-reveal").onchange = (e) => { settings.reveal = e.target.checked; if (G) G.reveal = e.target.checked; };
    $("set-instant").onchange = (e) => { settings.instant = e.target.checked; if (G) G.instant = e.target.checked; };
    $("export").onclick = async () => {
      const data = await DB.export();
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nolimit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      $("backup-msg").textContent = `Exported ${data.sessions.length} sessions, ${data.homegames.length} results and ${data.homehands.length} hands.`;
    };
    $("import").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        await DB.import(data, false);
        $("backup-msg").textContent = "Backup imported.";
      } catch (err) {
        $("backup-msg").textContent = "Couldn't import: " + err.message;
      }
      e.target.value = "";
    };
    let st = "Offline use: ";
    if (!("serviceWorker" in navigator)) st += "not supported by this browser.";
    else if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) st += "this address is http, so the browser won't keep the app offline. Host the web folder on an https site to use it without network.";
    else st += (await navigator.serviceWorker.getRegistration()) ? "ready. The app and engine are cached on this device." : "being prepared…";
    $("offline-status").textContent = st;
  }

  function init() {
    document.querySelectorAll("#tabs button").forEach((b) => { b.onclick = () => go(b.dataset.page); });
  }

  return { init, go, openSession, renderHandReplay };
})();
window.Pages = Pages;
