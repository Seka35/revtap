# NFC Review Tracker

Dashboard + service de redirection pour les cartes NFC/QR "laisser un avis Google".

## Ce que ça fait

- Une route publique `/r/:code` que tu écris sur chaque tag NFC et encodes dans chaque QR code.
  Elle redirige vers le lien Google Review du commerce et logue chaque scan (avec la source: nfc ou qr).
- Un dashboard admin protégé par mot de passe (`/admin`) pour :
  - Créer des lots de codes vides à imprimer en stock générique (ex: a1 à a20)
  - Assigner un code à un client (nom, lien Google Review, prix payé) au moment de la vente
  - Voir les stats de scans par carte (total, NFC vs QR, historique)
  - Voir le chiffre d'affaires total des cartes actives
  - Générer une feuille A4 avec tous les QR codes prêts à imprimer

## Installation locale (test)

```bash
npm install
cp .env.example .env
# édite .env : DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET, BASE_URL
npm run migrate   # crée les tables dans ta base Postgres (Neon marche très bien)
npm start
```

Le site tourne sur `http://localhost:3000`. Va sur `/admin` pour te connecter.

## Déploiement sur ton VPS (Traefik)

1. Copie ce dossier sur ton VPS (`scp -r nfc-review user@ton-vps:/opt/`)
2. Sur le VPS : `cp .env.example .env` et remplis les vraies valeurs
   - `DATABASE_URL` : ta connection string Neon Postgres
   - `ADMIN_PASSWORD` : un mot de passe fort (c'est le seul rempart d'accès au dashboard)
   - `SESSION_SECRET` : une chaîne aléatoire longue (`openssl rand -hex 32`)
   - `BASE_URL` : ton sous-domaine final, ex `https://tap.tondomaine.com`
3. Édite `docker-compose.yml` : remplace `tap.tondomaine.com` par ton vrai domaine, et vérifie
   que le nom du network Traefik externe correspond à celui déjà utilisé par ta stack.
4. Lance les migrations une fois (depuis le conteneur ou en local pointant sur la même DB) :
   ```bash
   docker compose run --rm nfc-review npm run migrate
   ```
5. Démarre le service :
   ```bash
   docker compose up -d --build
   ```
6. Pointe un enregistrement DNS A/CNAME de `tap.tondomaine.com` vers ton VPS.

Traefik gère le certificat HTTPS automatiquement si ton `certresolver` est déjà configuré
comme sur tes autres services.

## Workflow quotidien

**Préparer un lot de cartes en stock (avant démarchage) :**
1. `/admin/bulk` → génère par ex. 20 codes (`a1`...`a20`)
2. Tu es redirigé vers `/admin/print` → imprime la feuille de QR codes
3. Colle chaque QR imprimé sur sa carte, à côté de l'emplacement du tag NFC

**Programmer le NFC de chaque carte (une seule fois, avant la vente) :**
Pour chaque code, ouvre `/admin/tags/a1` → copie l'"URL pour le tag NFC" → écris-la dans NFC Tools
sur le téléphone. Le tag est prêt, même si aucun client n'est encore assigné (l'URL redirige vers
une page "pas encore activée" tant que tu n'as pas rempli le lien Google Review).

**Au moment de la vente :**
1. Va sur `/admin/tags/a1`
2. Remplis nom du commerce, lien Google Review, prix payé
3. Coche "Carte active"
4. Enregistre — le tag NFC déjà collé sur la carte fonctionne immédiatement, sans réécriture

**Suivi :**
Le dashboard `/admin` te donne d'un coup d'œil : nombre de cartes vendues, scans totaux,
IDR encaissés, et le détail par carte (dernière activité, NFC vs QR).

## Notes de sécurité

- Change `ADMIN_PASSWORD` et `SESSION_SECRET` avant de mettre en ligne — ne garde jamais
  les valeurs d'exemple.
- Le dashboard n'a qu'un seul compte admin (toi). Si tu veux plus tard donner l'accès à
  quelqu'un d'autre, il faudra étendre le système d'auth (actuellement un seul mot de passe partagé).
