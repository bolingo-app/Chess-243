const boardEl = document.getElementById("board");
const game = new Chess();
const files = "abcdefgh";
const symbols = {wk:"♔",wq:"♕",wr:"♖",wb:"♗",wn:"♘",wp:"♙",bk:"♚",bq:"♛",br:"♜",bb:"♝",bn:"♞",bp:"♟"};
let selected = null, legalTargets = [], lastMove = null, timer = null;
let whiteSeconds = 300, blackSeconds = 300, running = false;
let computer = true;

const $ = id => document.getElementById(id);
function fmt(s){return `${String(Math.floor(Math.max(0,s)/60)).padStart(2,"0")}:${String(Math.max(0,s)%60).padStart(2,"0")}`;}
function drawBoard(){
  boardEl.innerHTML = "";
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const sq = files[c]+(8-r), piece=game.get(sq), el=document.createElement("button");
    el.type="button"; el.className=`square ${(r+c)%2===0?"light":"dark"}`;
    if(selected===sq) el.classList.add("selected");
    if(legalTargets.includes(sq)) el.classList.add("target");
    if(lastMove && (lastMove.from===sq||lastMove.to===sq)) el.classList.add("last");
    if(piece) el.textContent=symbols[piece.color+piece.type];
    el.setAttribute("aria-label",sq+(piece?` ${piece.color==="w"?"blanc":"noir"} ${piece.type}`:""));
    el.addEventListener("click",()=>onSquare(sq));
    boardEl.appendChild(el);
  }
  renderMoves(); renderStatus();
}
function onSquare(sq){
  if(game.game_over()||!running&&game.history().length>0&&whiteSeconds===0||!running&&game.history().length>0&&blackSeconds===0)return;
  const piece=game.get(sq);
  if(selected && legalTargets.includes(sq)){
    const moving=game.get(selected);
    let promotion="q";
    if(moving && moving.type==="p" && (sq.endsWith("8")||sq.endsWith("1"))){
      const choice=prompt("Promotion : q (dame), r (tour), b (fou), n (cavalier)","q");
      if(choice && ["q","r","b","n"].includes(choice.toLowerCase())) promotion=choice.toLowerCase();
    }
    const move=game.move({from:selected,to:sq,promotion});
    if(move){lastMove=move;selected=null;legalTargets=[];startClock();drawBoard();if(game.game_over())stopClock();else if(computer&&game.turn()==="b")setTimeout(computerMove,450);return;}
  }
  if(piece && piece.color===game.turn()){
    selected=sq;legalTargets=game.moves({square:sq,verbose:true}).map(m=>m.to);
  }else{selected=null;legalTargets=[];}
  drawBoard();
}
function computerMove(){
  if(game.game_over()||game.turn()!=="b")return;
  const moves=game.moves(); if(!moves.length)return;
  const move=game.move(moves[Math.floor(Math.random()*moves.length)]);
  lastMove=move;drawBoard();if(game.game_over())stopClock();
}
function renderMoves(){
  const list=$("moves");list.innerHTML="";
  const hist=game.history();
  if(!hist.length){list.innerHTML='<li class="empty-moves">Les coups apparaîtront ici.</li>';return;}
  for(let i=0;i<hist.length;i+=2){const li=document.createElement("li");li.textContent=`${Math.floor(i/2)+1}. ${hist[i]}${hist[i+1]?"   "+hist[i+1]:""}`;list.appendChild(li);}
}
function renderStatus(){
  const over=game.game_over();
  let status="À vous de jouer", turn=game.turn()==="w"?"Trait aux Blancs":"Trait aux Noirs";
  if(game.in_checkmate())status=`Échec et mat — ${game.turn()==="w"?"Noirs":"Blancs"} gagnent`;
  else if(game.in_stalemate())status="Partie nulle — pat";
  else if(game.in_threefold_repetition()||game.insufficient_material()||game.in_draw())status="Partie nulle";
  else if(game.in_check())status="Échec !";
  $("game-status").textContent=status;$("turn-status").textContent=over?"Partie terminée":turn;
  $("white-clock").textContent=fmt(whiteSeconds);$("black-clock").textContent=fmt(blackSeconds);
  $("white-clock").classList.toggle("active",running&&game.turn()==="w");
  $("black-clock").classList.toggle("active",running&&game.turn()==="b");
}
function startClock(){
  if(timer)return;running=true;
  timer=setInterval(()=>{
    if(game.turn()==="w")whiteSeconds--;else blackSeconds--;
    renderStatus();
    if(whiteSeconds<=0||blackSeconds<=0){stopClock();$("game-status").textContent=`Temps écoulé — ${whiteSeconds<=0?"Noirs":"Blancs"} gagnent`;}
  },1000);
}
function stopClock(){clearInterval(timer);timer=null;running=false;renderStatus();}
function newGame(){
  stopClock();game.reset();selected=null;legalTargets=[];lastMove=null;
  const mins=Number($("mode").value);whiteSeconds=mins*60;blackSeconds=mins*60;
  computer=$("opponent").value==="computer";
  $("opponent-label").textContent=computer?"Ordinateur":"Deux joueurs";
  drawBoard();
}
$("new-game").addEventListener("click",newGame);
$("undo").addEventListener("click",()=>{stopClock();game.undo();if(computer)game.undo();lastMove=null;selected=null;legalTargets=[];drawBoard();});
$("resign").addEventListener("click",()=>{if(!game.game_over()){stopClock();$("game-status").textContent=`Abandon — ${game.turn()==="w"?"Noirs":"Blancs"} gagnent`; }});
$("copy-pgn").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(game.pgn());$("copy-pgn").textContent="Copié !";setTimeout(()=>$("copy-pgn").textContent="Copier PGN",1400);}catch(e){alert(game.pgn()||"Aucun coup à copier.");}});
newGame();

// Firebase Auth: configure js/firebase-config.js before using sign-in.
import("./firebase.js").then(({auth,googleProvider,signInWithPopup,signOut,onAuthStateChanged})=>{
  if(!auth)return;
  onAuthStateChanged(auth,user=>{
    $("auth-status").textContent=user?(user.displayName||user.email||"Joueur connecté"):"Invité";
    $("my-name").textContent=user?(user.displayName||"Joueur"):"Vous";
    $("login-google").classList.toggle("hidden",!!user);
    $("logout").classList.toggle("hidden",!user);
  });
  $("login-google").addEventListener("click",async()=>{
    try{await signInWithPopup(auth,googleProvider);}catch(e){alert("Connexion impossible : "+e.message);}
  });
  $("logout").addEventListener("click",()=>signOut(auth));
}).catch(()=>{});
