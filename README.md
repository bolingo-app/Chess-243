# Chess243 — première version

## Installation sur GitHub
1. Ouvre ton dépôt GitHub `chess-platform`.
2. Choisis **Add file > Upload files**.
3. Envoie tous les fichiers et dossiers de cette archive en conservant leur structure.
4. Clique **Commit changes**.

## Configuration Firebase
1. Ouvre `js/firebase-config.js`.
2. Remplace les valeurs `REMPLACER_...` par celles de la configuration Web de ton projet Firebase.
3. Enregistre le fichier et envoie-le sur GitHub.
4. Dans Firebase Authentication, active Google et Email/Mot de passe.
5. Dans Authentication > Paramètres > Domaines autorisés, ajoute le domaine de publication du site.

## Publication de test
Cette version est une première démo locale : échiquier, règles de déplacement, coups, horloge, partie contre ordinateur aléatoire et connexion Google (après configuration).
Le multijoueur Internet, les classements officiels, les tournois et la validation serveur ne sont pas encore implémentés.

Pour tester correctement, active GitHub Pages dans Settings > Pages > Deploy from a branch > main > /(root).
