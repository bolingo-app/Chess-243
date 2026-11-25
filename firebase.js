import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

let auth = null, googleProvider = null;
if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REMPLACER")) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
}
export { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged };
