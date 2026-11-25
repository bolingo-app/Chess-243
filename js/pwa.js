// Bouton « Installer l'app » : visible seulement si l'app n'est pas installée.
// Chrome ne déclenche « beforeinstallprompt » que lorsque l'app n'est pas installée :
// après une désinstallation, l'événement revient et le bouton réapparaît tout seul.
(function(){
  const btn=document.getElementById("install-app");
  let deferred=null;
  const standalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.MSStream;
  const refresh=()=>{if(btn)btn.classList.toggle("hidden",standalone()||(!deferred&&!ios));};
  addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;refresh();});
  addEventListener("appinstalled",()=>{deferred=null;refresh();});
  try{matchMedia("(display-mode: standalone)").addEventListener("change",refresh);}catch(e){}
  if(btn)btn.addEventListener("click",async()=>{
    if(deferred){deferred.prompt();try{await deferred.userChoice;}catch(e){}deferred=null;refresh();}
    else if(ios)alert("Sur iPhone : touche Partager, puis « Sur l’écran d’accueil ».");
  });
  refresh();
  if("serviceWorker" in navigator)addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
