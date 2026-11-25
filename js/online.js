import { auth, db, fs, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase.js";
const $ = id => document.getElementById(id), files = "abcdefgh";
const cat = m => m < 3 ? "bullet" : m < 10 ? "blitz" : "rapid";
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const gref = id => fs.doc(db, "chess_games", id), uref = id => fs.doc(db, "chess_users", id);
const game = new Chess();
let me = null, gid = null, g = null, myC = null, sel = null, targets = [], recvAt = 0;
let unsubGame = null, unsubLobby = null, flagged = false, applying = false, lastDelta = null, lbCat = "blitz";

function say(t) { $("msg").textContent = t; $("msg").hidden = !t; }
if (!auth || !db) say("Firebase n'est pas configuré (js/firebase-config.js).");

async function ensureUser(u) {
  const r = uref(u.uid), s = await fs.getDoc(r), base = { name: u.displayName || "Joueur", photo: u.photoURL || "" };
  if (!s.exists()) await fs.setDoc(r, { ...base, rating_bullet: 1200, rating_blitz: 1200, rating_rapid: 1200, games_bullet: 0, games_blitz: 0, games_rapid: 0 });
  else await fs.updateDoc(r, base);
  return (await fs.getDoc(r)).data();
}

async function createGame(vis) {
  const [m, i] = $("tc").value.split("|").map(Number), c = cat(m);
  const ref = await fs.addDoc(fs.collection(db, "chess_games"), {
    status: "waiting", vis, creator: { uid: me.uid, name: me.name, rating: me.data["rating_" + c] }, uids: [me.uid],
    tcMin: m, tcInc: i, cat: c, moves: [], fen: new Chess().fen(), turn: "w", wMs: m * 60000, bMs: m * 60000, createdAt: fs.serverTimestamp()
  });
  openGame(ref.id);
}

async function joinGame(id) {
  await fs.runTransaction(db, async tx => {
    const d = (await tx.get(gref(id))).data();
    if (!d || d.status !== "waiting" || d.creator.uid === me.uid) return;
    const mine = { uid: me.uid, name: me.name, rating: me.data["rating_" + d.cat] }, iw = Math.random() < .5;
    tx.update(gref(id), { status: "active", w: iw ? mine : d.creator, b: iw ? d.creator : mine, uids: [d.creator.uid, me.uid] });
  });
  openGame(id);
}

function openGame(id) {
  unsubGame && unsubGame(); gid = id; flagged = false; lastDelta = null; g = null;
  history.replaceState(null, "", "?g=" + id);
  $("lobby").hidden = true; $("game").hidden = false; say("");
  unsubGame = fs.onSnapshot(gref(id), s => {
    if (!s.exists()) { say("Partie introuvable."); return; }
    g = s.data(); recvAt = performance.now(); sel = null; targets = [];
    myC = g.w && g.w.uid === me.uid ? "w" : g.b && g.b.uid === me.uid ? "b" : null;
    game.load(g.fen); render();
    if (g.status === "finished") applyElo();
  });
}

function closeGame() {
  unsubGame && unsubGame(); unsubGame = null; gid = null; g = null;
  history.replaceState(null, "", location.pathname);
  $("game").hidden = true; $("lobby").hidden = false; refreshMine(); loadBoard(lbCat);
}

const clock = side => g[side + "Ms"] - (g.status === "active" && g.moves.length >= 2 && g.turn === side ? performance.now() - recvAt : 0);

function render() {
  if (!g) return;
  const flip = myC === "b", top = flip ? "w" : "b", bot = flip ? "b" : "w";
  const name = s => g[s] ? g[s].name : "En attente…", sub = s => g[s] ? "Elo " + g[s].rating : "";
  $("top-name").textContent = name(top); $("top-sub").textContent = sub(top);
  $("bot-name").textContent = name(bot); $("bot-sub").textContent = sub(bot);
  const b = $("board"); b.innerHTML = "";
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
  $("game-status").textContent = st;
  const over = g.status === "finished" || g.status === "aborted";
  $("share").hidden = g.status !== "waiting"; $("back").hidden = !over; $("resign").hidden = over || !myC;
  $("resign").textContent = g.status === "waiting" ? "Annuler le défi" : g.moves.length < 2 ? "Annuler la partie" : "Abandonner";
  tick();
}

function tick() {
  if (!g) return;
  const flip = myC === "b";
  $("top-clock").textContent = g.w ? fmt(clock(flip ? "w" : "b")) : "--:--";
  $("bot-clock").textContent = g.w ? fmt(clock(flip ? "b" : "w")) : "--:--";
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

$("resign").addEventListener("click", async () => {
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

function startLobby() {
  unsubLobby && unsubLobby();
  unsubLobby = fs.onSnapshot(fs.query(fs.collection(db, "chess_games"), fs.where("status", "==", "waiting"), fs.where("vis", "==", "public"), fs.limit(20)), snap => {
    const ul = $("open-list"); ul.innerHTML = "";
    snap.docs.filter(d => { const t = d.data().createdAt; return !t || Date.now() - t.toMillis() < 30 * 60000; }).forEach(d => {
      const x = d.data(), li = document.createElement("li"), mineGame = x.creator.uid === me.uid;
      li.innerHTML = `<span><strong></strong><br><small>${x.tcMin}+${x.tcInc} · ${x.cat} · Elo ${x.creator.rating}</small></span>`;
      li.querySelector("strong").textContent = x.creator.name;
      const b = document.createElement("button"); b.className = "btn btn-small"; b.textContent = mineGame ? "Ouvrir" : "Jouer";
      b.addEventListener("click", () => mineGame ? openGame(d.id) : joinGame(d.id)); li.appendChild(b); ul.appendChild(li);
    });
    if (!ul.children.length) ul.innerHTML = "<li><small>Aucun défi pour le moment.</small></li>";
  }, e => console.error(e));
}

function refreshMine() { $("mine").textContent = me ? `Ton Elo ${lbCat} : ${me.data["rating_" + lbCat]} (${me.data["games_" + lbCat]} parties)` : ""; }
async function loadBoard(c) {
  lbCat = c; refreshMine();
  document.querySelectorAll(".tabs .btn").forEach(b => b.classList.toggle("on", b.dataset.c === c));
  const snap = await fs.getDocs(fs.query(fs.collection(db, "chess_users"), fs.orderBy("rating_" + c, "desc"), fs.limit(30)));
  const ol = $("lb"); ol.innerHTML = "";
  snap.docs.forEach((d, i) => {
    const x = d.data(), li = document.createElement("li");
    li.innerHTML = `<span>${i + 1}. <strong></strong></span><span>${x["rating_" + c]} <small>(${x["games_" + c]})</small></span>`;
    li.querySelector("strong").textContent = x.name; ol.appendChild(li);
  });
}
document.querySelectorAll(".tabs .btn").forEach(b => b.addEventListener("click", () => loadBoard(b.dataset.c)));
$("btn-link").addEventListener("click", () => createGame("private"));
$("btn-public").addEventListener("click", () => createGame("public"));

if (auth) {
  $("login-google").addEventListener("click", async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Connexion impossible : " + e.message); } });
  $("logout").addEventListener("click", () => signOut(auth));
  onAuthStateChanged(auth, async user => {
    $("auth-status").textContent = user ? (user.displayName || "Joueur") : "Invité";
    $("login-google").classList.toggle("hidden", !!user); $("logout").classList.toggle("hidden", !user);
    if (!user) { me = null; unsubLobby && unsubLobby(); unsubGame && unsubGame(); $("lobby").hidden = true; $("game").hidden = true; say("Connecte-toi avec Google pour jouer en ligne."); return; }
    try {
      me = { uid: user.uid, name: user.displayName || "Joueur", data: await ensureUser(user) };
      say(""); startLobby(); loadBoard(lbCat); $("lobby").hidden = false;
      const id = new URLSearchParams(location.search).get("g");
      if (id) { const s = await fs.getDoc(gref(id)); if (!s.exists()) say("Défi introuvable."); else if (s.data().status === "waiting" && s.data().creator.uid !== me.uid) joinGame(id); else openGame(id); }
    } catch (e) { console.error(e); say("Erreur Firestore : " + e.message + " (règles publiées ?)"); }
  });
}
