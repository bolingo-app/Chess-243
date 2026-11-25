const boardEl = document.getElementById("board");
const game = new Chess();
const files = "abcdefgh";
const symbols = {
  wk:"♔", wq:"♕", wr:"♖", wb:"♗", wn:"♘", wp:"♙",
  bk:"♚", bq:"♛", br:"♜", bb:"♝", bn:"♞", bp:"♟"
};

let selected = null;
let legalTargets = [];
let lastMove = null;
let timer = null;
let whiteSeconds = 300;
let blackSeconds = 300;
let running = false;
let computer = true;
let pendingPromotion = null;
let audioContext = null;

const $ = id => document.getElementById(id);

function fmt(seconds) {
  const value = Math.max(0, seconds);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/* Sons synthétisés localement : aucun fichier audio externe nécessaire. */
function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function playTone(frequency, start, duration, type = "sine", volume = 0.075) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.02);
}

function playMoveSound() {
  playTone(520, 0, 0.085, "triangle", 0.055);
  playTone(760, 0.025, 0.07, "sine", 0.035);
}

function playCheckmateSound() {
  // Petite signature sonore descendante, différente du son de coup.
  playTone(880, 0, 0.18, "sine", 0.085);
  playTone(660, 0.19, 0.22, "sine", 0.085);
  playTone(440, 0.42, 0.42, "triangle", 0.09);
}

function drawBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = files[c] + (8 - r);
      const piece = game.get(square);
      const element = document.createElement("button");
      element.type = "button";
      element.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;

      if (selected === square) element.classList.add("selected");
      if (legalTargets.includes(square)) element.classList.add("target");
      if (lastMove && (lastMove.from === square || lastMove.to === square)) {
        element.classList.add("last");
      }

      if (piece) element.textContent = symbols[piece.color + piece.type];
      element.setAttribute(
        "aria-label",
        square + (piece ? ` ${piece.color === "w" ? "blanc" : "noir"} ${piece.type}` : "")
      );
      element.addEventListener("click", () => onSquare(square));
      boardEl.appendChild(element);
    }
  }
  renderMoves();
  renderStatus();
}

function onSquare(square) {
  if (pendingPromotion || game.game_over()) return;
  if ((!running && game.history().length > 0 && whiteSeconds === 0) ||
      (!running && game.history().length > 0 && blackSeconds === 0)) return;

  const piece = game.get(square);

  if (selected && legalTargets.includes(square)) {
    const movingPiece = game.get(selected);
    if (movingPiece && movingPiece.type === "p" &&
        (square.endsWith("8") || square.endsWith("1"))) {
      showPromotionChooser(selected, square, movingPiece.color);
      return;
    }

    makeMove(selected, square);
    return;
  }

  if (piece && piece.color === game.turn()) {
    selected = square;
    legalTargets = game.moves({ square, verbose: true }).map(move => move.to);
  } else {
    selected = null;
    legalTargets = [];
  }
  drawBoard();
}

function showPromotionChooser(from, to, color) {
  pendingPromotion = { from, to };
  selected = from;
  const panel = document.querySelector(".board-panel");
  let chooser = document.getElementById("promotion-chooser");

  if (!chooser) {
    chooser = document.createElement("div");
    chooser.id = "promotion-chooser";
    chooser.className = "promotion-chooser";
    chooser.setAttribute("role", "dialog");
    chooser.setAttribute("aria-modal", "true");
    chooser.setAttribute("aria-label", "Choisir la pièce de promotion");
    panel.appendChild(chooser);
  }

  const choices = [
    { type: "q", label: "Dame" },
    { type: "r", label: "Tour" },
    { type: "b", label: "Fou" },
    { type: "n", label: "Cavalier" }
  ];

  chooser.innerHTML = `
    <div class="promotion-card">
      <strong>Promouvoir en…</strong>
      <div class="promotion-options">
        ${choices.map(choice => `
          <button type="button" class="promotion-choice" data-piece="${choice.type}"
                  aria-label="${choice.label}">
            <span>${symbols[color + choice.type]}</span>
            <small>${choice.label}</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  chooser.querySelectorAll(".promotion-choice").forEach(button => {
    button.addEventListener("click", () => {
      const promotion = button.dataset.piece;
      const moveData = pendingPromotion;
      closePromotionChooser();
      if (moveData) makeMove(moveData.from, moveData.to, promotion);
    });
  });
}

function closePromotionChooser() {
  const chooser = document.getElementById("promotion-chooser");
  if (chooser) chooser.remove();
  pendingPromotion = null;
}

function makeMove(from, to, promotion = "q") {
  const move = game.move({ from, to, promotion });
  if (!move) {
    selected = null;
    legalTargets = [];
    drawBoard();
    return;
  }

  lastMove = move;
  selected = null;
  legalTargets = [];
  startClock();
  drawBoard();

  if (game.in_checkmate()) {
    stopClock();
    playCheckmateSound();
  } else {
    playMoveSound();
    if (game.game_over()) stopClock();
    else if (computer && game.turn() === "b") {
      setTimeout(computerMove, 450);
    }
  }
}

function computerMove() {
  if (game.game_over() || game.turn() !== "b" || pendingPromotion) return;
  const moves = game.moves();
  if (!moves.length) return;

  const move = game.move(moves[Math.floor(Math.random() * moves.length)]);
  lastMove = move;
  drawBoard();

  if (game.in_checkmate()) {
    stopClock();
    playCheckmateSound();
  } else {
    playMoveSound();
    if (game.game_over()) stopClock();
  }
}

function renderMoves() {
  const list = $("moves");
  list.innerHTML = "";
  const history = game.history();

  if (!history.length) {
    list.innerHTML = '<li class="empty-moves">Les coups apparaîtront ici.</li>';
    return;
  }

  for (let i = 0; i < history.length; i += 2) {
    const item = document.createElement("li");
    item.textContent = `${Math.floor(i / 2) + 1}. ${history[i]}${history[i + 1] ? "   " + history[i + 1] : ""}`;
    list.appendChild(item);
  }
}

function renderStatus() {
  const over = game.game_over();
  let status = "À vous de jouer";
  const turn = game.turn() === "w" ? "Trait aux Blancs" : "Trait aux Noirs";

  if (game.in_checkmate()) {
    status = `Échec et mat — ${game.turn() === "w" ? "Noirs" : "Blancs"} gagnent`;
  } else if (game.in_stalemate()) {
    status = "Partie nulle — pat";
  } else if (game.in_threefold_repetition() || game.insufficient_material() || game.in_draw()) {
    status = "Partie nulle";
  } else if (game.in_check()) {
    status = "Échec !";
  }

  $("game-status").textContent = status;
  $("turn-status").textContent = over ? "Partie terminée" : turn;
  $("white-clock").textContent = fmt(whiteSeconds);
  $("black-clock").textContent = fmt(blackSeconds);
  $("white-clock").classList.toggle("active", running && game.turn() === "w");
  $("black-clock").classList.toggle("active", running && game.turn() === "b");
}

function startClock() {
  if (timer) return;
  running = true;
  timer = setInterval(() => {
    if (game.turn() === "w") whiteSeconds--;
    else blackSeconds--;

    renderStatus();
    if (whiteSeconds <= 0 || blackSeconds <= 0) {
      stopClock();
      $("game-status").textContent =
        `Temps écoulé — ${whiteSeconds <= 0 ? "Noirs" : "Blancs"} gagnent`;
    }
  }, 1000);
}

function stopClock() {
  clearInterval(timer);
  timer = null;
  running = false;
  renderStatus();
}

function newGame() {
  stopClock();
  closePromotionChooser();
  game.reset();
  selected = null;
  legalTargets = [];
  lastMove = null;
  const minutes = Number($("mode").value);
  whiteSeconds = minutes * 60;
  blackSeconds = minutes * 60;
  computer = $("opponent").value === "computer";
  $("opponent-label").textContent = computer ? "Ordinateur" : "Deux joueurs";
  drawBoard();
}

$("new-game").addEventListener("click", newGame);
$("undo").addEventListener("click", () => {
  if (pendingPromotion) closePromotionChooser();
  stopClock();
  game.undo();
  if (computer && game.history().length) game.undo();
  lastMove = null;
  selected = null;
  legalTargets = [];
  drawBoard();
});
$("resign").addEventListener("click", () => {
  if (!game.game_over()) {
    stopClock();
    $("game-status").textContent =
      `Abandon — ${game.turn() === "w" ? "Noirs" : "Blancs"} gagnent`;
  }
});
$("copy-pgn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(game.pgn());
    $("copy-pgn").textContent = "Copié !";
    setTimeout(() => $("copy-pgn").textContent = "Copier PGN", 1400);
  } catch (error) {
    alert(game.pgn() || "Aucun coup à copier.");
  }
});

newGame();

// Firebase Auth : configure js/firebase-config.js avant d'activer la connexion.
import("./firebase.js").then(({ auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged }) => {
  if (!auth) return;

  onAuthStateChanged(auth, user => {
    $("auth-status").textContent = user ? (user.displayName || user.email || "Joueur connecté") : "Invité";
    $("my-name").textContent = user ? (user.displayName || "Joueur") : "Vous";
    $("login-google").classList.toggle("hidden", !!user);
    $("logout").classList.toggle("hidden", !user);
  });

  $("login-google").addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      alert("Connexion impossible : " + error.message);
    }
  });

  $("logout").addEventListener("click", () => signOut(auth));
}).catch(() => {});
