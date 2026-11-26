// Analyse d'une partie avec Stockfish : évaluation de chaque position puis classement des coups.
const URL_JS = new URL("../engine/stockfish-19-lite-single.js?v=19.0.1", import.meta.url).href;
const URL_WASM = new URL("../engine/stockfish-19-lite-single.wasm", import.meta.url).href;
const CATS = {
  best: ["Meilleur coup", "#7bc47f", "Le coup optimal selon Stockfish."],
  good: ["Excellent", "#8fd18f", "Un coup très solide, presque aussi bon que le meilleur."],
  ok: ["Bon", "#b7d98a", "Un coup correct, perte minime."],
  book: ["Livre", "#c9a46a", "Coup théorique habituel de l'ouverture."],
  inacc: ["Imprécision ?!", "#e6c04a", "Le coup relâche la pression ou offre du contre-jeu."],
  miss: ["Gain manqué", "#e69a4a", "Une occasion de garder un grand avantage a été ratée."],
  mistake: ["Erreur ?", "#e07b3a", "Le coup fait basculer l'avantage vers l'adversaire."],
  blunder: ["Gaffe ??", "#d9534f", "Erreur critique : la position devient très mauvaise."]
};
function engine() {
  const w = new Worker(URL_JS + "#" + encodeURIComponent(URL_WASM));
  const ask = (lines, until) => new Promise(res => {
    let cp = null;
    w.onmessage = e => { const t = typeof e.data === "string" ? e.data : ""; const m = t.match(/score (cp|mate) (-?\d+)/);
      if (m) cp = m[1] === "mate" ? (m[2] > 0 ? 10000 : -10000) : Number(m[2]);
      if (t.startsWith(until)) res({ cp, t }); };
    lines.forEach(l => w.postMessage(l));
  });
  return { w, ask };
}
export async function analyse(sans, onProgress) {
  const { w, ask } = engine(), c = new Chess(), fens = [c.fen()], ucis = [];
  sans.forEach(s => { const m = c.move(s); ucis.push(m.from + m.to + (m.promotion || "")); fens.push(c.fen()); });
  await ask(["uci"], "uciok"); await ask(["isready"], "readyok");
  const ev = [], best = [];
  for (let i = 0; i < fens.length; i++) {
    const turn = fens[i].split(" ")[1], r = await ask([`position fen ${fens[i]}`, "go movetime 200"], "bestmove");
    ev.push((r.cp === null ? 0 : r.cp) * (turn === "w" ? 1 : -1) / 100); best.push(r.t.split(" ")[1]);
    onProgress && onProgress(i + 1, fens.length);
  }
  w.terminate();
  const out = sans.map((san, k) => {
    const white = k % 2 === 0, before = white ? ev[k] : -ev[k], after = white ? ev[k + 1] : -ev[k + 1], loss = Math.max(0, before - after);
    let cat = ucis[k] === best[k] || loss < 0.03 ? "best" : loss < 0.15 ? "good" : loss < 0.3 ? "ok" : loss < 0.9 ? "inacc" : loss < 2.5 ? "mistake" : "blunder";
    if (k < 6 && loss < 0.3) cat = "book";
    if ((cat === "mistake" || cat === "inacc") && before >= 1.5 && after <= 0.5) cat = "miss";
    const b = new Chess(fens[k]), bm = best[k] && best[k] !== "(none)" ? b.move({ from: best[k].slice(0, 2), to: best[k].slice(2, 4), promotion: best[k][4] }) : null;
    return { san, cat, loss, after: ev[k + 1], best: bm ? bm.san : "" };
  });
  return out;
}
const fmt = v => (v > 0 ? "+" : "") + (Math.abs(v) >= 99 ? (v > 0 ? "mat" : "-mat") : v.toFixed(1));
export async function showAnalysis(sans) {
  if (!sans.length) return;
  const box = document.createElement("div"); box.className = "sheet-an";
  box.innerHTML = '<div class="an-card"><div class="an-head"><strong>Analyse de la partie</strong><button class="btn btn-small" type="button">Fermer</button></div><p class="an-sum">Analyse en cours…</p><ol class="an-list"></ol></div>';
  document.body.appendChild(box); box.querySelector("button").onclick = () => box.remove();
  const sum = box.querySelector(".an-sum"), list = box.querySelector(".an-list");
  try {
    const res = await analyse(sans, (i, n) => { sum.textContent = `Analyse en cours… ${i}/${n}`; });
    const last = res[res.length - 1].after;
    sum.textContent = Math.abs(last) < 0.3 ? "Position équilibrée." : `Avantage aux ${last > 0 ? "Blancs" : "Noirs"} (${fmt(last)}).`;
    const count = { w: {}, b: {} };
    res.forEach((r, k) => { const s = k % 2 ? "b" : "w"; count[s][r.cat] = (count[s][r.cat] || 0) + 1; });
    res.forEach((r, k) => {
      const [name, color, why] = CATS[r.cat], li = document.createElement("li");
      li.innerHTML = `<span class="an-mv">${k % 2 ? "" : (k / 2 + 1) + ". "}${r.san}</span><span class="an-tag" style="background:${color}"></span><small class="an-ev">${fmt(r.after)}</small>`;
      li.querySelector(".an-tag").textContent = name;
      li.onclick = () => { const d = li.querySelector(".an-more") || li.appendChild(Object.assign(document.createElement("div"), { className: "an-more" }));
        d.textContent = `${why}` + (r.cat === "best" || r.cat === "book" ? "" : ` Perte : ${r.loss.toFixed(1)} pion(s).` + (r.best ? ` Meilleur coup : ${r.best}.` : "")) + ` Évaluation après le coup : ${fmt(r.after)} (${r.after > 0.3 ? "avantage Blancs" : r.after < -0.3 ? "avantage Noirs" : "égalité"}).`; };
      list.appendChild(li);
    });
  } catch (e) { sum.textContent = "Analyse impossible : " + e.message; }
}
