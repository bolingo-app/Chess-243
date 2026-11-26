import { showAnalysis } from "./analysis.js";
import { auth, db, fs, googleProvider, signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from "./firebase.js";
const $ = id => document.getElementById(id), files = "abcdefgh";
const cat = m => m < 3 ? "bullet" : m < 10 ? "blitz" : "rapid";
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const gref = id => fs.doc(db, "chess_games", id), uref = id => fs.doc(db, "chess_users", id);
const game = new Chess();
let pm = [], viewPly = null, me = null, gid = null, g = null, myC = null, sel = null, targets = [], recvAt = 0;
let unsubGame = null, flagged = false, applying = false, lastDelta = null;

function say(t) { $("msg").textContent = t; $("msg").hidden = !t; }
if (!auth || !db) say("Firebase n'est pas configuré (js/firebase-config.js).");

async function ensureUser(u) {
  const r = uref(u.uid), s = await fs.getDoc(r), base = { name: u.displayName || "Joueur", photo: u.photoURL || "" };
  if (!s.exists() || s.data().rating_blitz === undefined) await fs.setDoc(r, { ...base, rating_bullet: 1200, rating_blitz: 1200, rating_rapid: 1200, games_bullet: 0, games_blitz: 0, games_rapid: 0 }, { merge: true });
  else await fs.updateDoc(r, base);
  return (await fs.getDoc(r)).data();
}

async function joinGame(id) {
  let ok = false;
  await fs.runTransaction(db, async tx => {
    const d = (await tx.get(gref(id))).data();
    if (!d || d.status !== "waiting" || d.creator.uid === me.uid) return;
    const mine = { uid: me.uid, name: me.name, rating: me.data["rating_" + d.cat] }, iw = Math.random() < .5;
    tx.update(gref(id), { status: "active", w: iw ? mine : d.creator, b: iw ? d.creator : mine, uids: [d.creator.uid, me.uid] }); ok = true;
  });
  if (ok) openGame(id);
  return ok;
}

function openGame(id) {
  unsubGame && unsubGame(); gid = id; pm = []; flagged = false; firstFlag = false; lastDelta = null; g = null;
  history.replaceState(null, "", "?g=" + id);
  say("");
  unsubGame = fs.onSnapshot(gref(id), s => {
    if (!s.exists()) { say("Partie introuvable."); return; }
    g = s.data(); recvAt = performance.now(); sel = null; targets = []; viewPly = null;
    if (g.status === "waiting" && searching) return;
    if (searching && g.status === "active") stopSearch();
    $("game").hidden = false; $("home").hidden = true; $("play").hidden = true; window.scrollTo(0, 0);
    myC = g.w && g.w.uid === me.uid ? "w" : g.b && g.b.uid === me.uid ? "b" : null;
    game.load(g.fen); if (g.status !== "active") pm = []; render();
    if (g.status === "active" && g.turn === myC && pm.length) { const p = pm.shift(); if (game.moves({ square: p.from, verbose: true }).some(m => m.to === p.to)) play(p.from, p.to); else { pm = []; render(); } }
    if (g.status === "finished") {
      applyElo();
      if (g.w && g.b && g.rematch && g.rematch[g.w.uid] && g.rematch[g.b.uid] && !g.next) makeRematch();
      if (g.next) openGame(g.next);
    }
  });
}

function closeGame() {
  unsubGame && unsubGame(); unsubGame = null; gid = null; g = null;
  history.replaceState(null, "", location.pathname);
  $("game").hidden = true; $("home").hidden = false;
}

const clock = side => g[side + "Ms"] - (g.status === "active" && g.moves.length >= 2 && g.turn === side ? performance.now() - recvAt : 0);

function render() {
  if (!g) return;
  const flip = myC === "b", top = flip ? "w" : "b", bot = flip ? "b" : "w";
  const name = s => g[s] ? g[s].name : "En attente…", sub = s => g[s] ? "Elo " + g[s].rating : "";
  $("top-name").textContent = name(top); $("top-sub").textContent = sub(top);
  $("bot-name").textContent = name(bot); $("bot-sub").textContent = sub(bot);
  const b = $("o-board"); b.innerHTML = "";
  const cur = viewPly === null ? g.moves.length : viewPly, src = viewPly === null ? (pm.length && g.status === "active" && myC && g.turn !== myC ? virtual() : game) : replay(cur), last = cur ? g.moves[cur - 1] : "";
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const r = flip ? 7 - i : i, c = flip ? 7 - j : j, sq = files[c] + (8 - r), p = src.get(sq), el = document.createElement("button");
    el.type = "button"; el.className = "square " + ((r + c) % 2 === 0 ? "light" : "dark");
    if (sel === sq) el.classList.add("selected");
    if (targets.includes(sq)) el.classList.add("target");
    if (pm.some(p => p.from === sq)) el.classList.add("premove-from");
    if (pm.some(p => p.to === sq)) el.classList.add("premove-to");
    if (last && (last.slice(0, 2) === sq || last.slice(2, 4) === sq)) el.classList.add("last");
    if (p) { const im = document.createElement("img"); im.className = "piece"; im.alt = ""; im.draggable = false; im.src = `pieces/${p.color}${p.type.toUpperCase()}.svg`; el.appendChild(im); }
    el.addEventListener("click", () => click(sq)); b.appendChild(el);
  }
  arrows(flip);
  const sans = sanAll(), ol = $("o-moves"); ol.innerHTML = "";
  sans.forEach((s, i) => { const li = document.createElement("li"); li.textContent = (i % 2 ? "" : (i / 2 + 1) + ". ") + s; if (i + 1 === cur) li.className = "cur"; li.onclick = () => { viewPly = i + 1 === sans.length ? null : i + 1; render(); }; ol.appendChild(li); });
  { const c = ol.querySelector(".cur"); if (c) ol.scrollLeft = c.offsetLeft - ol.clientWidth / 2 + c.clientWidth / 2; }
  $("o-analyse").hidden = !(g.status === "finished" && sans.length);
  let st = "";
  if (g.status === "waiting") st = "En attente d'un adversaire… Partage le lien.";
  else if (g.status === "aborted") st = "Partie annulée.";
  else if (g.status === "finished") {
    const w = g.result === "1-0" ? "Les Blancs gagnent" : g.result === "0-1" ? "Les Noirs gagnent" : "Partie nulle";
    st = `${w} (${g.reason})` + (lastDelta !== null ? ` · Elo ${lastDelta >= 0 ? "+" : ""}${lastDelta}` : "");
  } else st = !myC ? "Spectateur" : g.turn === myC ? "À vous de jouer" : "Tour de l'adversaire";
  if (g.status === "active" && game.in_check()) st += " · Échec !";
  $("o-status").textContent = st;
  const over = g.status === "finished" || g.status === "aborted";
  $("share").hidden = true; $("back").hidden = !over;
  const opp = myC && g.w && g.b ? (myC === "w" ? g.b.uid : g.w.uid) : null, rm = $("rematch");
  rm.hidden = !(over && g.status === "finished" && myC); rm.disabled = !!(g.rematch && g.rematch[me.uid]);
  const asked = !!(g.rematch && opp && g.rematch[opp] && !g.rematch[me.uid]);
  rm.classList.toggle("blink", asked); rm.textContent = asked ? "Revanche demandée ⚡ Accepter" : g.rematch && g.rematch[me.uid] ? "Revanche demandée…" : "Nouvelle partie"; $("o-resign").hidden = over || !myC;
  $("o-resign").textContent = g.status === "waiting" ? "Annuler le défi" : g.moves.length < 2 ? "Annuler la partie" : "Abandonner";
  tick();
}

function tick() {
  if (!g) return;
  const flip = myC === "b";
  $("top-clock").textContent = g.w ? fmt(clock(flip ? "w" : "b")) : "--:--";
  $("bot-clock").textContent = g.w ? fmt(clock(flip ? "b" : "w")) : "--:--";
  if (g.status === "active" && g.moves.length === 0) {
    const left = Math.ceil(20 - (performance.now() - recvAt) / 1000);
    $("o-status").textContent = (myC === "w" ? "À vous de jouer" : "Les Blancs jouent") + ` — ${Math.max(0, left)} s avant annulation`;
    if (left <= 0 && !firstFlag) { firstFlag = true; const n = gid; fs.runTransaction(db, async tx => { const d = (await tx.get(gref(n))).data(); if (d.status === "active" && d.moves.length === 0) tx.update(gref(n), { status: "aborted" }); }).catch(() => {}); }
  }
  if (g.status === "active" && g.moves.length >= 2 && !flagged && clock(g.turn) <= 0) {
    flagged = true; const t = g.turn, n = g.moves.length;
    finish(d => d.turn === t && d.moves.length === n, t === "w" ? "0-1" : "1-0", "temps écoulé");
  }
}
setInterval(tick, 250);

function click(sq) {
  if (viewPly !== null) return;
  if (!g || g.status !== "active" || !myC) return;
  if (g.turn !== myC) { premoveClick(sq); return; }
  if (sel && targets.includes(sq)) { play(sel, sq); return; }
  const p = game.get(sq);
  if (p && p.color === myC) { sel = sq; targets = game.moves({ square: sq, verbose: true }).map(m => m.to); } else { sel = null; targets = []; }
  render();
}

async function play(from, to) {
  const m = game.move({ from, to, promotion: "q" }); if (!m) return;
  const side = myC, n = g.moves.length, rem = Math.max(1, clock(side));
  const upd = { moves: [...g.moves, from + to + (m.promotion || "")], fen: game.fen(), turn: game.turn(), [side + "Ms"]: n >= 2 ? rem + g.tcInc * 1000 : rem };
  if (game.in_checkmate()) Object.assign(upd, { status: "finished", result: side === "w" ? "1-0" : "0-1", reason: "échec et mat" });
  else if (game.game_over()) Object.assign(upd, { status: "finished", result: "1/2-1/2", reason: "nulle" });
  sel = null; targets = []; render();
  try {
    await fs.runTransaction(db, async tx => {
      const d = (await tx.get(gref(gid))).data();
      if (d.status !== "active" || d.turn !== side || d.moves.length !== n) throw new Error("stale");
      tx.update(gref(gid), upd);
    });
  } catch (e) { game.load(g.fen); render(); }
}

async function finish(cond, result, reason) {
  try {
    await fs.runTransaction(db, async tx => {
      const d = (await tx.get(gref(gid))).data();
      if (d.status !== "active" || !cond(d)) return;
      tx.update(gref(gid), { status: "finished", result, reason });
    });
  } catch (e) { flagged = false; }
}

$("o-resign").addEventListener("click", async () => {
  if (!g || !myC) return;
  if (g.status === "waiting" || g.moves.length < 2) {
    await fs.runTransaction(db, async tx => {
      const d = (await tx.get(gref(gid))).data();
      if (d.status === "waiting" || (d.status === "active" && d.moves.length < 2)) tx.update(gref(gid), { status: "aborted" });
    });
  } else finish(() => true, myC === "w" ? "0-1" : "1-0", "abandon");
});
$("back").addEventListener("click", closeGame);
$("share").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "?g=" + gid;
  try { if (navigator.share) await navigator.share({ title: "Défi Chess243", url }); else { await navigator.clipboard.writeText(url); $("share").textContent = "Lien copié !"; } }
  catch (e) { prompt("Copie ce lien :", url); }
});

async function applyElo() {
  if (!myC || !g.result || applying || (g.applied && g.applied[me.uid])) return;
  applying = true;
  const s = g.result === "1/2-1/2" ? .5 : (g.result === "1-0") === (myC === "w") ? 1 : 0;
  const mine = g[myC].rating, opp = g[myC === "w" ? "b" : "w"].rating, delta = Math.round(32 * (s - expected(mine, opp)));
  try {
    await fs.runTransaction(db, async tx => {
      const d = (await tx.get(gref(gid))).data();
      if (d.applied && d.applied[me.uid]) return;
      tx.update(gref(gid), { ["applied." + me.uid]: true });
      if (g.tid) tx.set(fs.doc(db, "chess_tournaments", g.tid, "players", me.uid), { name: me.name, points: fs.increment(s * 2), games: fs.increment(1) }, { merge: true });
      tx.update(uref(me.uid), { ["rating_" + g.cat]: fs.increment(delta), ["games_" + g.cat]: fs.increment(1) });
    });
    lastDelta = delta; me.data = (await fs.getDoc(uref(me.uid))).data(); render();
  } catch (e) { console.error(e); }
  applying = false;
}

const candQuery = (m, i, t) => fs.query(fs.collection(db, "chess_games"), fs.where("status", "==", "waiting"), fs.where("vis", "==", "public"), fs.where("tid", "==", t || null), fs.where("tcMin", "==", m), fs.where("tcInc", "==", i), fs.limit(20));
let searching = null, cands = [], unsubCands = null, pairTimer = null, firstFlag = false;
const win = () => 100 + 100 * Math.floor((Date.now() - searching.start) / 10000); // ±100, puis élargi toutes les 10 s
const mineRating = c => me.data["rating_" + c];
function pick(w, m) {
  const mine = mineRating(cat(m));
  return cands.filter(x => x.creator.uid !== me.uid && (!x.createdAt || Date.now() - x.createdAt.toMillis() < 120000) && Math.abs(x.creator.rating - mine) <= w)
    .sort((p, q) => Math.abs(p.creator.rating - mine) - Math.abs(q.creator.rating - mine))[0];
}
function markTiles() {
  document.querySelectorAll(".tc").forEach(t => { t.classList.toggle("on", !!searching && t.dataset.tc === searching.tc); t.disabled = !!searching && t.dataset.tc !== searching.tc; });
  $("search").hidden = !searching;
}
function stopSearch() {
  searching = null; clearInterval(pairTimer); unsubCands && unsubCands(); unsubCands = null; cands = []; markTiles();
}
async function abortGame(id) {
  try { await fs.runTransaction(db, async tx => { const d = (await tx.get(gref(id))).data(); if (d && d.status === "waiting") tx.update(gref(id), { status: "aborted" }); }); } catch (e) {}
}
async function quick(tc, tid = null) {
  if (!me) { say("Connecte-toi avec Google (bouton en haut) pour jouer en ligne."); return; }
  if (searching) return;
  const [m, i] = tc.split("|").map(Number);
  searching = { start: Date.now(), m, i, tc, tid, id: null }; markTiles(); say("");
  try {
    cands = (await fs.getDocs(candQuery(m, i, tid))).docs.map(d => ({ id: d.id, ...d.data() }));
    const best = pick(100, m);
    if (best && await joinGame(best.id)) return;
    const [mm, ii] = [m, i], c = cat(m);
    const ref = await fs.addDoc(fs.collection(db, "chess_games"), {
      status: "waiting", vis: "public", tid, creator: { uid: me.uid, name: me.name, rating: mineRating(c) }, uids: [me.uid],
      tcMin: mm, tcInc: ii, cat: c, moves: [], fen: new Chess().fen(), turn: "w", wMs: mm * 60000, bMs: mm * 60000, createdAt: fs.serverTimestamp()
    });
    if (!searching) { abortGame(ref.id); return; }
    searching.id = ref.id; openGame(ref.id);
    unsubCands = fs.onSnapshot(candQuery(m, i, tid), s => { cands = s.docs.map(d => ({ id: d.id, ...d.data() })); });
    pairTimer = setInterval(async () => {
      if (!searching || !searching.id) return;
      $("search-text").textContent = `Recherche d'un adversaire… (écart Elo : ±${win() >= 700 ? "illimité" : win()})`;
      const b = pick(win() >= 700 ? 1e9 : win(), m);
      if (b && searching.id > b.id) {                       // le plus grand identifiant rejoint l'autre : pas de double appariement
        const mine = searching.id, t = searching.tc, tv = searching.tid;
        unsubGame && unsubGame(); unsubGame = null; stopSearch(); await abortGame(mine);
        if (!(await joinGame(b.id))) quick(t, tv);
      }
    }, 2000);
  } catch (e) { console.error(e); stopSearch(); say("Erreur : " + e.message); }
}
async function cancelSearch() {
  const id = searching && searching.id; unsubGame && unsubGame(); unsubGame = null; gid = null; stopSearch(); if (id) await abortGame(id);
}
document.querySelectorAll(".tc").forEach(t => t.addEventListener("click", () => quick(t.dataset.tc)));
$("cancel-search").addEventListener("click", cancelSearch);
addEventListener("pagehide", () => { if (searching && searching.id) abortGame(searching.id); });

// Revanche
$("rematch").addEventListener("click", () => fs.updateDoc(gref(gid), { ["rematch." + me.uid]: true }));
async function makeRematch() {
  const old = gid, nref = fs.doc(fs.collection(db, "chess_games"));
  try {
    await fs.runTransaction(db, async tx => {
      const d = (await tx.get(gref(old))).data(); if (d.next) return;
      tx.set(nref, { status: "active", vis: "private", creator: { uid: me.uid, name: me.name, rating: mineRating(d.cat) }, uids: d.uids, w: d.b, b: d.w,
        tcMin: d.tcMin, tcInc: d.tcInc, cat: d.cat, moves: [], fen: new Chess().fen(), turn: "w", wMs: d.tcMin * 60000, bMs: d.tcMin * 60000, createdAt: fs.serverTimestamp() });
      tx.update(gref(old), { next: nref.id });
    });
  } catch (e) { console.error(e); }
}

// Ordinateur
$("cpu-level").addEventListener("input", () => { $("cpu-level-text").textContent = "Niveau " + $("cpu-level").value + "/19"; });
$("cpu-start").addEventListener("click", () => {
  $("opponent").value = "computer"; $("mode").value = $("cpu-tc").value;
  $("difficulty").value = $("cpu-level").value; $("difficulty").dispatchEvent(new Event("input"));
  $("opponent").dispatchEvent(new Event("change"));
  $("home").hidden = true; $("play").hidden = false; $("new-game").click(); window.scrollTo(0, 0);
});
$("play-back").addEventListener("click", () => { $("play").hidden = true; $("home").hidden = false; });

if (auth) {
  onAuthStateChanged(auth, async user => {
    if (!user) { me = null; setAccount(null); clearInterval(hb); unsubInv && unsubInv(); unsubGame && unsubGame(); stopSearch(); say(new URLSearchParams(location.search).get("g") ? "Connecte-toi avec Google (bouton en haut) pour rejoindre ce défi." : "Connecte-toi avec Google (bouton en haut) pour jouer en ligne."); return; }
    try {
      const data = await ensureUser(user); me = { uid: user.uid, name: data.nick || data.name || "Joueur", data };
      setAccount(me); startPresence(); startInvites(); say("");
      const tp = new URLSearchParams(location.search), tid = tp.get("t");
      if (tid) { history.replaceState(null, "", location.pathname); quick(tp.get("tc") || "5|0", tid); return; }
      const id = tp.get("g");
      if (id) { const s = await fs.getDoc(gref(id)); if (!s.exists()) say("Défi introuvable."); else if (s.data().status === "waiting" && s.data().creator.uid !== me.uid) joinGame(id); else openGame(id); }
    } catch (e) { console.error(e); say("Erreur Firestore : " + e.message + " (règles publiées ?)"); }
  });
}

function replay(n) { const c = new Chess(); g.moves.slice(0, n).forEach(u => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })); return c; }
function sanAll() { const c = new Chess(); return g.moves.map(u => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); }
{ const nav = document.createElement("div"); nav.className = "nav-arrows";
  nav.innerHTML = '<button type="button" id="o-prev" class="btn btn-small">◀</button><button type="button" id="o-next" class="btn btn-small">▶</button><button type="button" id="o-analyse" class="btn btn-small" hidden>🔍 Analyser</button>';
  const ol = document.createElement("ol"); ol.id = "o-moves"; ol.className = "moves";
  $("o-board").parentElement.append(nav, ol);
  const go = d => { if (!g) return; const n = g.moves.length; let p = (viewPly === null ? n : viewPly) + d; p = Math.max(0, Math.min(n, p)); viewPly = p === n ? null : p; render(); };
  $("o-prev").onclick = () => go(-1); $("o-next").onclick = () => go(1); $("o-analyse").onclick = () => showAnalysis(sanAll()); }

const pmOn = () => localStorage.getItem("c243_premove") !== "0";
function forceMine(c) { const f = c.fen().split(" "); f[1] = myC; f[3] = "-"; return new Chess(f.join(" ")); }
function virtual() { let c = game; for (const p of pm) { const h = forceMine(c); if (!h.move({ from: p.from, to: p.to, promotion: "q" })) break; c = h; } return c; }
function premoveClick(sq) {
  if (!pmOn()) return;
  const f = forceMine(virtual()), p = f.get(sq);
  if (sel && targets.includes(sq)) { if (pm.length < 5) pm.push({ from: sel, to: sq }); sel = null; targets = []; }
  else if (p && p.color === myC && sq !== sel) { sel = sq; targets = f.moves({ square: sq, verbose: true }).map(m => m.to); }
  else { sel = null; targets = []; }
  render();
}
function arrows(flip) {
  if (!pm.length) return;
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 8 8"); svg.setAttribute("class", "arrows");
  const ctr = s => { const f = files.indexOf(s[0]), r = Number(s[1]); return [(flip ? 7 - f : f) + .5, (flip ? r - 1 : 8 - r) + .5]; };
  let h = '<defs><marker id="oah" markerWidth="3.2" markerHeight="3.2" refX="2.2" refY="1.6" orient="auto"><path d="M0,0L3.2,1.6L0,3.2z" fill="#f0a030"/></marker></defs>';
  pm.forEach((p, i) => { const [x1, y1] = ctr(p.from), [x2, y2] = ctr(p.to), d = Math.hypot(x2 - x1, y2 - y1) || 1, k = .3 / d;
    h += `<line x1="${x1}" y1="${y1}" x2="${x2 - (x2 - x1) * k}" y2="${y2 - (y2 - y1) * k}" stroke="#f0a030" stroke-opacity=".85" stroke-width=".14" stroke-linecap="round" marker-end="url(#oah)"/><circle cx="${x2 + .3}" cy="${y2 - .3}" r=".18" fill="#10151d" stroke="#f0a030" stroke-width=".04"/><text x="${x2 + .3}" y="${y2 - .24}" font-size=".24" font-weight="700" text-anchor="middle" fill="#f0a030">${i + 1}</text>`; });
  svg.innerHTML = h; $("o-board").appendChild(svg);
}
$("o-board").addEventListener("contextmenu", e => { e.preventDefault(); pm = []; sel = null; targets = []; if (g) render(); });

// Menu ☰ des paramètres
{ const hd = document.querySelector(".topbar"), btn = document.createElement("button"); btn.id = "menu-btn"; btn.type = "button"; btn.className = "btn btn-small"; btn.textContent = "☰"; hd.prepend(btn);
  const dr = document.createElement("div"); dr.className = "drawer"; dr.hidden = true;
  dr.innerHTML = '<div class="drawer-card"><div class="an-head"><strong>Paramètres</strong><button class="btn btn-small" type="button" id="drawer-close">Fermer</button></div><label class="chk"><input type="checkbox" id="premove-on"> Activer les prémouvements (5 coups max)</label><div id="drawer-body"></div></div>';
  document.body.appendChild(dr); const body = $("drawer-body");
  ["theme", "move-sound", "mate-sound"].forEach(id => { const lab = document.querySelector(`label[for="${id}"]`), el = $(id); if (lab) body.appendChild(lab); if (el) body.appendChild(el); });
  const panel = document.querySelector("#play .premove-panel"); if (panel) body.appendChild(panel);
  $("premove-on").checked = pmOn();
  $("premove-on").addEventListener("change", e => { localStorage.setItem("c243_premove", e.target.checked ? "1" : "0"); if (!e.target.checked) { pm = []; const c = $("clear-premoves"); c && c.click(); if (g) render(); } });
  btn.onclick = () => { dr.hidden = false; }; $("drawer-close").onclick = () => { dr.hidden = true; }; dr.addEventListener("click", e => { if (e.target === dr) dr.hidden = true; }); }
{ const ml = $("moves"); if (ml) new MutationObserver(() => { ml.scrollLeft = ml.scrollWidth; }).observe(ml, { childList: true }); }

// En-tête : le nom du compte (cliquable → profil) remplace le bouton Google ; « Quitter » est dans le menu ☰
const acc = document.createElement("button"); acc.id = "account-btn"; acc.type = "button"; acc.className = "btn btn-small"; acc.hidden = true;
acc.onclick = () => { location.href = "profile.html"; };
{ const gb = $("login-google"); gb.parentElement.insertBefore(acc, gb); const as = $("auth-status"); if (as) as.style.display = "none";
  const lo = $("logout"), card = document.querySelector(".drawer-card"); if (lo && card) card.appendChild(lo); }
function setAccount(m) { acc.hidden = !m; if (!m) return; acc.textContent = ""; const d = document.createElement("span"); d.className = "dot on"; acc.append(d, m.name); }
let hb = null, unsubInv = null;
function startPresence() {
  clearInterval(hb); const beat = () => { if (!document.hidden) fs.updateDoc(uref(me.uid), { lastSeen: Date.now() }).catch(() => {}); };
  beat(); hb = setInterval(beat, 30000); document.addEventListener("visibilitychange", beat);
}
function startInvites() {
  unsubInv && unsubInv();
  unsubInv = fs.onSnapshot(fs.query(fs.collection(db, "chess_games"), fs.where("status", "==", "waiting"), fs.where("invited", "==", me.uid), fs.limit(3)), s => {
    let b = $("invite"); if (!b) { b = document.createElement("div"); b.id = "invite"; b.className = "invite"; document.body.appendChild(b); }
    b.innerHTML = ""; const rows = s.docs.filter(d => { const t = d.data().createdAt; return !t || Date.now() - t.toMillis() < 600000; }); b.hidden = !rows.length;
    rows.forEach(d => { const x = d.data(), row = document.createElement("div");
      row.innerHTML = '<span></span><button class="btn btn-small btn-primary" type="button">Accepter</button><button class="btn btn-small" type="button">Refuser</button>';
      row.querySelector("span").textContent = `${x.creator.name} te défie (${x.tcMin}+${x.tcInc})`;
      const [ok, no] = row.querySelectorAll("button"); ok.onclick = () => joinGame(d.id); no.onclick = () => abortGame(d.id); b.appendChild(row); });
  }, () => {});
}

// Connexion par e-mail
if (auth) {
  const eb = document.createElement("button"); eb.id = "email-btn"; eb.type = "button"; eb.className = "btn btn-small"; eb.textContent = "E-mail";
  $("login-google").after(eb);
  const dlg = document.createElement("div"); dlg.className = "drawer"; dlg.hidden = true;
  dlg.innerHTML = '<div class="drawer-card"><div class="an-head"><strong>Connexion par e-mail</strong><button class="btn btn-small" type="button" id="em-close">Fermer</button></div><label for="em-nick">Pseudo (pour créer un compte)</label><input type="text" id="em-nick" maxlength="20"><label for="em-mail">E-mail</label><input type="text" id="em-mail" inputmode="email" autocomplete="email"><label for="em-pass">Mot de passe (6 caractères min.)</label><input type="password" id="em-pass" autocomplete="current-password"><p id="em-msg"></p><button id="em-in" class="btn btn-primary full" type="button">Se connecter</button><button id="em-new" class="btn btn-ghost full" type="button">Créer un compte</button><button id="em-reset" class="btn btn-small full" type="button">Mot de passe oublié</button></div>';
  document.body.appendChild(dlg);
  const msg = t => { $("em-msg").textContent = t; }, val = id => $(id).value.trim();
  eb.onclick = () => { dlg.hidden = false; }; $("em-close").onclick = () => { dlg.hidden = true; };
  const err = e => msg({ "auth/invalid-credential": "E-mail ou mot de passe incorrect.", "auth/email-already-in-use": "Cet e-mail a déjà un compte.", "auth/weak-password": "Mot de passe trop court.", "auth/invalid-email": "E-mail invalide.", "auth/operation-not-allowed": "E-mail/Mot de passe n'est pas activé dans Firebase." }[e.code] || e.message);
  $("em-in").onclick = async () => { try { await signInWithEmailAndPassword(auth, val("em-mail"), $("em-pass").value); dlg.hidden = true; } catch (e) { err(e); } };
  $("em-new").onclick = async () => {
    if (val("em-nick").length < 2) { msg("Choisis un pseudo (2 caractères min.)."); return; }
    try { const c = await createUserWithEmailAndPassword(auth, val("em-mail"), $("em-pass").value); await updateProfile(c.user, { displayName: val("em-nick") }); await fs.setDoc(uref(c.user.uid), { nick: val("em-nick") }, { merge: true }); dlg.hidden = true; location.reload(); } catch (e) { err(e); } };
  $("em-reset").onclick = async () => { try { await sendPasswordResetEmail(auth, val("em-mail")); msg("E-mail de réinitialisation envoyé."); } catch (e) { err(e); } };
  onAuthStateChanged(auth, u => { eb.classList.toggle("hidden", !!u); });
}
