import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import * as fs from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

let auth = null, googleProvider = null, db = null;
if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REMPLACER")) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  db = fs.getFirestore(app);
}
export { auth, googleProvider, db, fs, signInWithPopup, signOut, onAuthStateChanged };
