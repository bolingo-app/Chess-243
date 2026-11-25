const CACHE="chess243-v3";
const SHELL=["./","index.html","css/style.css","js/app.js","js/firebase.js","js/firebase-config.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png",
 ..."wK wQ wR wB wN wP bK bQ bR bB bN bP".split(" ").map(p=>`pieces/${p}.svg`),
 "engine/stockfish-19-lite-single.js?v=19.0.1","engine/stockfish-19-lite-single.wasm"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u)))).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
// Réseau d'abord (toujours la dernière version), cache en secours hors connexion.
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET"||new URL(r.url).origin!==location.origin)return;
  e.respondWith(fetch(r).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy));return res;}).catch(()=>caches.match(r).then(m=>m||caches.match("index.html"))));
});
