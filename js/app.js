const boardEl = document.getElementById("board");
const game = new Chess();
const files = "abcdefgh";
const symbols = {wk:"♔",wq:"♕",wr:"♖",wb:"♗",wn:"♘",wp:"♙",bk:"♚",bq:"♛",br:"♜",bb:"♝",bn:"♞",bp:"♟"};
const $ = id => document.getElementById(id);

let selected = null, legalTargets = [], lastMove = null, timer = null, engineMoveTimer = null;
let whiteSeconds = 300, blackSeconds = 300, incrementSeconds = 0, running = false;
let computer = true, pendingPromotion = null, audioContext = null;
let engine = null, engineReady = false, engineThinking = false, engineBusy = false;
let gameFinished = false, premoveFrom = null, premoves = [];
let engineInitTimer = null;

const STOCKFISH_VERSION = "19.0.1";
const STOCKFISH_WORKER_URL = new URL("../engine/stockfish-19-lite-single.js?v="+STOCKFISH_VERSION, import.meta.url);
const STOCKFISH_WASM_URL = new URL("../engine/stockfish-19-lite-single.wasm", import.meta.url).href;
const STOCKFISH_CDN = `https://cdn.jsdelivr.net/npm/stockfish@${STOCKFISH_VERSION}/bin/stockfish-19-lite-single`;
let engineAttempt = 0;

const MOVE_SOUNDS = [
  [520,760,"triangle"],[420,640,"sine"],[680,900,"triangle"],[350,520,"square"],[560,840,"sine"],
  [740,980,"triangle"],[300,460,"sine"],[610,780,"square"],[480,920,"triangle"],[800,1100,"sine"]
];
const MATE_SOUNDS = [
  [880,660,440],[740,554,370],[990,740,494],[660,494,330],[1046,784,523]
];

function fmt(seconds) { const v=Math.max(0,seconds); return `${String(Math.floor(v/60)).padStart(2,"0")}:${String(v%60).padStart(2,"0")}`; }
function getAudioContext(){ const C=window.AudioContext||window.webkitAudioContext; if(!C)return null; if(!audioContext)audioContext=new C(); if(audioContext.state==="suspended")audioContext.resume(); return audioContext; }
function tone(freq,start,duration,type="sine",volume=.055){const ctx=getAudioContext();if(!ctx)return;const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,ctx.currentTime+start);g.gain.setValueAtTime(.0001,ctx.currentTime+start);g.gain.exponentialRampToValueAtTime(volume,ctx.currentTime+start+.012);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+start+duration);o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime+start);o.stop(ctx.currentTime+start+duration+.02);}
function playMoveSound(){const s=MOVE_SOUNDS[Number($("move-sound")?.value||0)%MOVE_SOUNDS.length];tone(s[0],0,.075,s[2],.05);tone(s[1],.025,.065,"sine",.035);}
function playCheckmateSound(){const s=MATE_SOUNDS[Number($("mate-sound")?.value||0)%MATE_SOUNDS.length];tone(s[0],0,.18,"sine",.085);tone(s[1],.19,.22,"sine",.085);tone(s[2],.42,.42,"triangle",.09);}

function setEngineStatus(message, state="") { const el=$("engine-status"); if(el){el.textContent=message;el.dataset.state=state;} }
function killEngine(){
  clearTimeout(engineInitTimer);
  if(engine){try{engine.terminate();}catch(e){}if(engine._blobUrl)URL.revokeObjectURL(engine._blobUrl);}
  engine=null;engineReady=false;engineThinking=false;engineBusy=false;
}
function createEngineWorker(source){
  if(source==="local"){
    // Indiquer explicitement le WASM évite toute ambiguïté de chemin sur GitHub Pages
    // lorsque le dépôt est publié dans un sous-répertoire (username.github.io/projet/).
    const workerUrl=STOCKFISH_WORKER_URL.href+"#"+encodeURIComponent(STOCKFISH_WASM_URL);
    return new Worker(workerUrl,{name:"Chess243 Stockfish 19"});
  }
  // Secours : le .js vient du CDN via un Worker blob ; le .wasm est indiqué dans le #hash.
  const blobUrl=URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(STOCKFISH_CDN+".js")});`],{type:"text/javascript"}));
  const w=new Worker(blobUrl+"#"+encodeURIComponent(STOCKFISH_CDN+".wasm"));
  w._blobUrl=blobUrl;return w;
}
function startEngine(source){
  const attempt=++engineAttempt;
  killEngine();
  setEngineStatus(source==="local"?"Chargement de Stockfish 19…":"Chargement de Stockfish 19 (secours CDN)…","loading");
  const fail=reason=>{
    if(attempt!==engineAttempt)return;
    console.error("Stockfish ("+source+") :",reason);
    killEngine();
    if(source==="local"){startEngine("cdn");return;}
    setEngineStatus("Stockfish introuvable — vérifiez que engine/stockfish-19-lite-single.js ET .wasm sont sur GitHub","error");
  };
  try{
    engine=createEngineWorker(source);
    engine.addEventListener("message",e=>{if(attempt===engineAttempt)onEngineMessage(e);});
    engine.addEventListener("error",e=>fail(e.message||"erreur worker"));
    engine.addEventListener("messageerror",()=>fail("message worker illisible"));
    engine.postMessage("uci");
    // Le téléchargement/compilation du WASM peut être lent sur mobile : ne pas
    // basculer prématurément vers le CDN avant la fin de l'initialisation locale.
    engineInitTimer=setTimeout(()=>{if(!engineReady)fail("initialisation trop longue");},source==="local"?45000:30000);
  }catch(error){fail(error);}
}
function bootStockfish(){
  if(engine||!computer)return;
  if(!window.Worker){setEngineStatus("Navigateur incompatible avec Stockfish","error");return;}
  startEngine("local");
}
function onEngineMessage(event){
  const line=String(event.data||"").trim();
  if(line.includes("uciok")){
    const level=Number($("difficulty")?.value||10);
    engine.postMessage("setoption name Hash value 32");
    applyEngineStrength(level);
    engine.postMessage("isready");
    return;
  }
  if(line.includes("readyok")){
    engineReady=true;clearTimeout(engineInitTimer);
    setEngineStatus("Stockfish 19 prêt","ready");
    if(computer&&game.turn()==="b"&&game.history().length)requestComputerMove();
    return;
  }
  if(line.startsWith("bestmove")){
    engineThinking=false;engineBusy=false;
    const uci=line.split(/\s+/)[1];
    if(!uci||uci==="(none)"||gameFinished||!computer||game.turn()!=="b")return;
    const move=game.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||"q"});
    if(!move){setEngineStatus("Coup moteur invalide — partie conservée","error");return;}
    lastMove=move;afterMove(false);
    if(!gameFinished)setEngineStatus("Stockfish 19 prêt","ready");
    if(!gameFinished&&premoves.length)playNextPremove();
  }
}
function applyEngineStrength(level){
  if(!engine)return;
  const safeLevel=Math.max(1,Math.min(19,Number(level)||10));
  // Le niveau Skill Level limite les choix du moteur ; UCI_Elo ajoute une
  // limitation de force progressive lorsque cette option est disponible.
  const elo=Math.round(1320+(safeLevel-1)*(1710/18));
  engine.postMessage(`setoption name Skill Level value ${safeLevel}`);
  engine.postMessage("setoption name UCI_LimitStrength value true");
  engine.postMessage(`setoption name UCI_Elo value ${elo}`);
}
function requestComputerMove(){
  if(!computer||!engineReady||engineBusy||gameFinished||game.turn()!=="b")return;
  engineBusy=true;engineThinking=true;setEngineStatus("Stockfish réfléchit…","thinking");
  clearTimeout(engineMoveTimer);
  engineMoveTimer=setTimeout(()=>{
    if(!computer||!engineReady||gameFinished||game.turn()!=="b") { engineBusy=false;engineThinking=false;return; }
    const level=Number($("difficulty")?.value||10);
    applyEngineStrength(level);
    const depth=Math.max(6,Math.min(18,Math.round(7+level*.58)));
    engine.postMessage(`position fen ${game.fen()}`);
    engine.postMessage(`go depth ${depth}`);
  },1500);
}
function difficultyName(level){
  if(level<=4)return "Débutant";
  if(level<=9)return "Moyen";
  if(level<=15)return "Avancé";
  return "Très élevé";
}
function setDifficulty(){
  const level=Number($("difficulty").value);
  $("difficulty-value").textContent=`${difficultyName(level)} · Niveau ${level}/19`;
  if(engineReady)applyEngineStrength(level);
}

function drawBoard(){
  boardEl.innerHTML="";
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const square=files[c]+(8-r),piece=game.get(square),el=document.createElement("button");
    el.type="button";el.className=`square ${(r+c)%2===0?"light":"dark"}`;
    if(selected===square)el.classList.add("selected");if(legalTargets.includes(square))el.classList.add("target");
    if(premoveFrom===square)el.classList.add("premove-selected");
    if(premoves.some(m=>m.from===square))el.classList.add("premove-from");
    if(premoves.some(m=>m.to===square))el.classList.add("premove-to");
    if(lastMove&&(lastMove.from===square||lastMove.to===square))el.classList.add("last");
    if(piece){
      const glyph=document.createElement("span");
      glyph.className=`piece ${piece.color==="w"?"piece-white":"piece-black"}`;
      glyph.textContent=symbols[piece.color+piece.type];
      el.appendChild(glyph);
    }
    if(r===7){const coord=document.createElement("span");coord.className="coordinate file-coordinate";coord.textContent=files[c].toUpperCase();el.appendChild(coord);}
    if(c===7){const coord=document.createElement("span");coord.className="coordinate rank-coordinate";coord.textContent=String(8-r);el.appendChild(coord);}
    el.setAttribute("aria-label",square+(piece?` ${piece.color==="w"?"blanc":"noir"} ${piece.type}`:""));
    el.addEventListener("click",()=>onSquare(square));boardEl.appendChild(el);
  }
  renderMoves();renderStatus();renderPremoves();
}
function onSquare(square){
  if(pendingPromotion||gameFinished)return;
  if(computer&&game.turn()==="b") { queuePremoveClick(square);return; }
  if(selected&&legalTargets.includes(square)){
    const p=game.get(selected);if(p&&p.type==="p"&&(square.endsWith("8")||square.endsWith("1"))){showPromotionChooser(selected,square,p.color);return;}
    makeMove(selected,square);return;
  }
  const piece=game.get(square);
  if(piece&&piece.color===game.turn()){selected=square;legalTargets=game.moves({square,verbose:true}).map(m=>m.to);}else{selected=null;legalTargets=[];}
  drawBoard();
}
function queuePremoveClick(square){
  if(!computer||gameFinished)return;
  const piece=game.get(square);
  if(!premoveFrom){
    const isWhitePiece=piece&&piece.color==="w";
    const isPlannedDestination=premoves.some(move=>move.to===square);
    if(isWhitePiece||isPlannedDestination){
      premoveFrom=square;
      $("premove-status").textContent=`Coup ${premoves.length+1}/5 : choisis la case d’arrivée de ${square.toUpperCase()}.`;
      drawBoard();
    }else{
      $("premove-status").textContent="Sélectionne une pièce blanche (ou la destination d’un prémouvement déjà programmé).";
    }
    return;
  }
  if(square===premoveFrom){premoveFrom=null;$("premove-status").textContent="Sélection annulée.";drawBoard();return;}
  if(piece&&piece.color==="w"&&!premoves.some(move=>move.to===square)){
    premoveFrom=square;
    $("premove-status").textContent=`Coup ${premoves.length+1}/5 : choisis la case d’arrivée de ${square.toUpperCase()}.`;
    drawBoard();return;
  }
  if(premoves.length>=5){
    $("premove-status").textContent="La file est pleine : cinq coups sont déjà programmés.";
    premoveFrom=null;drawBoard();return;
  }
  premoves.push({from:premoveFrom,to:square,promotion:"q"});
  premoveFrom=null;
  $("premove-status").textContent=`${premoves.length}/5 coup(s) programmé(s). Ils seront vérifiés et joués à ton tour.`;
  drawBoard();
}
function playNextPremove(){
  if(!premoves.length||gameFinished||game.turn()!=="w")return;
  let p, legal;
  while(premoves.length){
    p=premoves.shift();
    legal=game.moves({square:p.from,verbose:true}).find(m=>m.to===p.to);
    if(legal)break;
  }
  if(!legal){$("premove-status").textContent=`Prémouvement(s) devenu(s) illégal(aux), file vérifiée.`;renderPremoves();return;}
  const piece=game.get(p.from);const promotion=piece&&piece.type==="p"&&(p.to.endsWith("8")||p.to.endsWith("1"))?"q":undefined;
  const move=game.move({from:p.from,to:p.to,promotion});if(!move)return;
  lastMove=move;afterMove(true);
}
function renderPremoves(){
  const el=$("premove-list");if(!el)return;
  const queued=premoves.map((p,i)=>`${i+1}. ${p.from.toUpperCase()}–${p.to.toUpperCase()}`);
  if(premoveFrom)queued.push(`${premoves.length+1}. ${premoveFrom.toUpperCase()}–…`);
  el.textContent=queued.length?queued.join("  ·  "):"Aucun prémouvement";
  const clear=$("clear-premoves");if(clear)clear.disabled=!premoves.length&&!premoveFrom;
}
function showPromotionChooser(from,to,color){pendingPromotion={from,to};selected=from;const panel=document.querySelector(".board-panel");let chooser=$("promotion-chooser");if(!chooser){chooser=document.createElement("div");chooser.id="promotion-chooser";chooser.className="promotion-chooser";chooser.setAttribute("role","dialog");chooser.setAttribute("aria-modal","true");panel.appendChild(chooser);}const choices=[{type:"q",label:"Dame"},{type:"r",label:"Tour"},{type:"b",label:"Fou"},{type:"n",label:"Cavalier"}];chooser.innerHTML=`<div class="promotion-card"><strong>Promouvoir en…</strong><div class="promotion-options">${choices.map(c=>`<button type="button" class="promotion-choice" data-piece="${c.type}"><span>${symbols[color+c.type]}</span><small>${c.label}</small></button>`).join("")}</div></div>`;chooser.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{const data=pendingPromotion;const promo=b.dataset.piece;closePromotionChooser();if(data)makeMove(data.from,data.to,promo);}));}
function closePromotionChooser(){const el=$("promotion-chooser");if(el)el.remove();pendingPromotion=null;}
function makeMove(from,to,promotion="q"){const move=game.move({from,to,promotion});if(!move){selected=null;legalTargets=[];drawBoard();return;}lastMove=move;selected=null;legalTargets=[];afterMove(true);}
function afterMove(isHuman){
  // L'incrément est ajouté au joueur qui vient de terminer son coup.
  if(incrementSeconds>0){if(game.turn()==="b")whiteSeconds+=incrementSeconds;else blackSeconds+=incrementSeconds;}
  drawBoard();if(game.in_checkmate()){finishGame();return;}if(game.game_over()){gameFinished=true;stopClock();setEngineStatus("Partie terminée","ready");return;}
  playMoveSound();startClock();if(computer&&game.turn()==="b")requestComputerMove();
}
function finishGame(){gameFinished=true;stopClock();playCheckmateSound();$("game-status").textContent=`Échec et mat — ${game.turn()==="w"?"Noirs":"Blancs"} gagnent`;$("turn-status").textContent="Partie terminée";setEngineStatus("Partie terminée","ready");drawBoard();}
function renderMoves(){const list=$("moves");list.innerHTML="";const h=game.history();if(!h.length){list.innerHTML='<li class="empty-moves">Les coups apparaîtront ici.</li>';return;}for(let i=0;i<h.length;i+=2){const li=document.createElement("li");li.textContent=`${Math.floor(i/2)+1}. ${h[i]}${h[i+1]?"   "+h[i+1]:""}`;list.appendChild(li);}}
function renderStatus(){const over=game.game_over()||gameFinished;let status="À vous de jouer";const turn=game.turn()==="w"?"Trait aux Blancs":"Trait aux Noirs";if(game.in_checkmate())status=`Échec et mat — ${game.turn()==="w"?"Noirs":"Blancs"} gagnent`;else if(game.in_stalemate())status="Partie nulle — pat";else if(game.in_threefold_repetition()||game.insufficient_material()||game.in_draw())status="Partie nulle";else if(game.in_check())status="Échec !";$("game-status").textContent=status;$("turn-status").textContent=over?"Partie terminée":turn;$("white-clock").textContent=fmt(whiteSeconds);$("black-clock").textContent=fmt(blackSeconds);$("white-clock").classList.toggle("active",running&&game.turn()==="w");$("black-clock").classList.toggle("active",running&&game.turn()==="b");}
function startClock(){if(timer||gameFinished)return;running=true;timer=setInterval(()=>{if(game.turn()==="w")whiteSeconds--;else blackSeconds--;if(whiteSeconds<=0||blackSeconds<=0){stopClock();gameFinished=true;$("game-status").textContent=`Temps écoulé — ${whiteSeconds<=0?"Noirs":"Blancs"} gagnent`;$("turn-status").textContent="Partie terminée";setEngineStatus("Partie terminée","ready");}renderStatus();},1000);}
function stopClock(){clearInterval(timer);timer=null;running=false;renderStatus();}
function stopEngineSearch(){
  clearTimeout(engineMoveTimer);engineMoveTimer=null;
  if(engine&&engineBusy){try{engine.postMessage("stop");}catch(e){}}
  engineBusy=false;engineThinking=false;
}
function newGame(shouldScroll=true){
  stopClock();stopEngineSearch();closePromotionChooser();game.reset();
  if(engineReady){engine.postMessage("ucinewgame");applyEngineStrength(Number($("difficulty").value));engine.postMessage("isready");}
  selected=null;legalTargets=[];lastMove=null;gameFinished=false;premoves=[];premoveFrom=null;
  const [minutes,increment]=String($("mode").value).split("|").map(Number);
  whiteSeconds=minutes*60;blackSeconds=minutes*60;incrementSeconds=increment||0;
  computer=$("opponent").value==="computer";
  $("opponent-label").textContent=computer?"Stockfish 19":"Deux joueurs";
  $("premove-status").textContent="Pendant le tour de l’ordinateur, sélectionne une pièce blanche puis sa destination pour programmer jusqu’à cinq coups.";
  if(computer){if(engineReady)setEngineStatus("Stockfish 19 prêt","ready");else bootStockfish();}
  else setEngineStatus("Mode deux joueurs","ready");
  drawBoard();
  if(shouldScroll)document.querySelector(".board-panel").scrollIntoView({behavior:"smooth",block:"start"});
}

$("new-game").addEventListener("click",()=>newGame(true));
$("undo").addEventListener("click",()=>{if(pendingPromotion)closePromotionChooser();stopEngineSearch();stopClock();if(game.history().length){game.undo();if(computer&&game.history().length)game.undo();}gameFinished=false;premoves=[];premoveFrom=null;lastMove=null;selected=null;legalTargets=[];drawBoard();});
$("resign").addEventListener("click",()=>{if(!gameFinished&&!game.game_over()){gameFinished=true;stopClock();stopEngineSearch();$("game-status").textContent=`Abandon — ${game.turn()==="w"?"Noirs":"Blancs"} gagnent`;$("turn-status").textContent="Partie terminée";}});
$("copy-pgn").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(game.pgn());$("copy-pgn").textContent="Copié !";setTimeout(()=>$("copy-pgn").textContent="Copier PGN",1400);}catch(e){alert(game.pgn()||"Aucun coup à copier.");}});
$("difficulty").addEventListener("input",setDifficulty);setDifficulty();
$("opponent").addEventListener("change",()=>{if($("opponent").value==="computer")bootStockfish();});
$("theme").addEventListener("change",e=>{document.documentElement.dataset.boardTheme=e.target.value;});
$("clear-premoves").addEventListener("click",()=>{
  premoves=[];premoveFrom=null;
  $("premove-status").textContent="La file de prémouvements a été effacée.";
  drawBoard();
});
newGame(false);

// Authentification Firebase existante : elle reste facultative à cette étape.
import("./firebase.js").then(({auth,googleProvider,signInWithPopup,signOut,onAuthStateChanged})=>{if(!auth)return;onAuthStateChanged(auth,user=>{$("auth-status").textContent=user?(user.displayName||user.email||"Joueur connecté"):"Invité";$("my-name").textContent=user?(user.displayName||"Joueur"):"Vous";$("login-google").classList.toggle("hidden",!!user);$("logout").classList.toggle("hidden",!user);});$("login-google").addEventListener("click",async()=>{try{await signInWithPopup(auth,googleProvider);}catch(e){alert("Connexion impossible : "+e.message);}});$("logout").addEventListener("click",()=>signOut(auth));}).catch(()=>{});
