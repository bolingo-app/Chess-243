import { auth, db, fs, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase.js";
const $ = id => document.getElementById(id), files = "abcdefgh";
const cat = m => m < 3 ? "bullet" : m < 10 ? "blitz" : "rapid";
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const gref = id => fs.doc(db, "chess_games", id), uref = id => fs.doc(db, "chess_users", id);
const game = new Chess();
let me = null, gid = null, g = null, myC = null, sel = null, targets = [], recvAt = 0;
let unsubGame = null, flagged = false, applying = false, lastDelta = null;

function say(t) { $("msg").textContent = t; $("msg").hidden = !t; }
if (!auth || !db) say("Firebase n'est pas configuré (js/firebase-config.js).");

async function ensureUser(u) {
  const r = uref(u.uid), s = await fs.getDoc(r), base = { name: u.displayName || "Joueur", photo: u.photoURL || "" };
  if (!s.exists()) await fs.setDoc(r, { ...base, rating_bullet: 1200, rating_blitz: 1200, rating_rapid: 1200, games_bullet: 0, games_blitz: 0, games_rapid: 0 });
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
  unsubGame && unsubGame(); gid = id; flagged = false; firstFlag = false; lastDelta = null; g = null;
  history.replaceState(null, "", "?g=" + id);
  say("");
  unsubGame = fs.onSnapshot(gref(id), s => {
    if (!s.exists()) { say("Partie introuvable."); return; }
    g = s.data(); recvAt = performance.now(); sel = null; targets = [];
    if (g.status === "waiting" && searching) return;
    if (searching && g.status === "active") stopSearch();
    $("game").hidden = false; $("home").hidden = true; $("play").hidden = true; window.scrollTo(0, 0);
    myC = g.w && g.w.uid === me.uid ? "w" : g.b && g.b.uid === me.uid ? "b" : null;
    game.load(g.fen); render();
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
  const last = g.moves.length ? g.moves[g.moves.length - 1] : "";
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const r = flip ? 7 - i : i, c = flip ? 7 - j : j, sq = files[c] + (8 - r), p = game.get(sq), el = document.createElement("button");
    el.type = "button"; el.className = "square " + ((r + c) % 2 === 0 ? "light" : "dark");
    if (sel === sq) el.classList.add("selected");
    if (targets.includes(sq)) el.classList.add("target");
    if (last && (last.slice(0, 2) === sq || last.slice(2, 4) === sq)) el.classList.add("last");
    if (p) { const im = document.createElement("img"); im.className = "piece"; im.alt = ""; im.draggable = false; im.src = `pieces/${p.color}${p.type.toUpperCase()}.svg`; el.appendChild(im); }
    el.addEventListener("click", () => click(sq)); b.appendChild(el);
  }
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
  if (!g || g.status !== "active" || g.turn !== myC) return;
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
      tx.update(uref(me.uid), { ["rating_" + g.cat]: fs.increment(delta), ["games_" + g.cat]: fs.increment(1) });
    });
    lastDelta = delta; me.data = (await fs.getDoc(uref(me.uid))).data(); render();
  } catch (e) { console.error(e); }
  applying = false;
}

const candQuery = (m, i) => fs.query(fs.collection(db, "chess_games"), fs.where("status", "==", "waiting"), fs.where("vis", "==", "public"), fs.where("tcMin", "==", m), fs.where("tcInc", "==", i), fs.limit(20));
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
async function quick(tc) {
  if (!me) { say("Connecte-toi avec Google (bouton en haut) pour jouer en ligne."); return; }
  if (searching) return;
  const [m, i] = tc.split("|").map(Number);
  searching = { start: Date.now(), m, i, tc, id: null }; markTiles(); say("");
  try {
    cands = (await fs.getDocs(candQuery(m, i))).docs.map(d => ({ id: d.id, ...d.data() }));
    const best = pick(100, m);
    if (best && await joinGame(best.id)) return;
    const [mm, ii] = [m, i], c = cat(m);
    const ref = await fs.addDoc(fs.collection(db, "chess_games"), {
      status: "waiting", vis: "public", creator: { uid: me.uid, name: me.name, rating: mineRating(c) }, uids: [me.uid],
      tcMin: mm, tcInc: ii, cat: c, moves: [], fen: new Chess().fen(), turn: "w", wMs: mm * 60000, bMs: mm * 60000, createdAt: fs.serverTimestamp()
    });
    if (!searching) { abortGame(ref.id); return; }
    searching.id = ref.id; openGame(ref.id);
    unsubCands = fs.onSnapshot(candQuery(m, i), s => { cands = s.docs.map(d => ({ id: d.id, ...d.data() })); });
    pairTimer = setInterval(async () => {
      if (!searching || !searching.id) return;
      $("search-text").textContent = `Recherche d'un adversaire… (écart Elo : ±${win() >= 700 ? "illimité" : win()})`;
      const b = pick(win() >= 700 ? 1e9 : win(), m);
      if (b && searching.id > b.id) {                       // le plus grand identifiant rejoint l'autre : pas de double appariement
        const mine = searching.id, t = searching.tc;
        unsubGame && unsubGame(); unsubGame = null; stopSearch(); await abortGame(mine);
        if (!(await joinGame(b.id))) quick(t);
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
    if (!user) { me = null; unsubGame && unsubGame(); stopSearch(); say(new URLSearchParams(location.search).get("g") ? "Connecte-toi avec Google (bouton en haut) pour rejoindre ce défi." : "Connecte-toi avec Google (bouton en haut) pour jouer en ligne."); return; }
    try {
      me = { uid: user.uid, name: user.displayName || "Joueur", data: await ensureUser(user) };
      say("");
      const id = new URLSearchParams(location.search).get("g");
      if (id) { const s = await fs.getDoc(gref(id)); if (!s.exists()) say("Défi introuvable."); else if (s.data().status === "waiting" && s.data().creator.uid !== me.uid) joinGame(id); else openGame(id); }
    } catch (e) { console.error(e); say("Erreur Firestore : " + e.message + " (règles publiées ?)"); }
  });
}
