# TWIXX HQ — application installable et notifications

Ce dossier contient tout ce qu'il faut pour transformer le site en application installable sur téléphone, avec des rappels du planning même quand le site est fermé.

| Fichier | Rôle |
|---|---|
| `index.html` | Le site (v1.6.0) |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Ce qui rend le site installable et gère les notifications |
| `worker.js` | Le petit serveur gratuit (Cloudflare) qui envoie les rappels |
| `generer-cles.html` | Outil à ouvrir une fois pour créer les clés des notifications |

Compte le temps d'une petite heure pour tout mettre en place, une seule fois.

---

## Étape 0 — Avant de migrer (important)

Le site va changer d'adresse (`https://ton-compte.github.io/...`). Le navigateur garde les données **par adresse** : sur la nouvelle adresse, tout repart de zéro, y compris pour toi.

1. Sur ton **ancien** site (le fichier actuel), onglet **Données › Mots de passe**, clique sur **Copier la liste** et colle-la dans un endroit sûr : sur la nouvelle adresse, les mots de passe en clair ne seront plus visibles (tu pourras toujours en regénérer).
2. Clique sur **⬆ Publier** pour que ton gist soit à jour.
3. Fais aussi **Données › Sauvegarde › Exporter JSON** par sécurité.

## Étape 1 — Héberger le site sur GitHub Pages (gratuit)

1. Sur GitHub, crée un dépôt **public** (par exemple `twixx-hq`).
2. **Add file › Upload files** : envoie `index.html`, `sw.js`, `manifest.webmanifest`, `icon-180.png`, `icon-192.png`, `icon-512.png`. (Pas besoin d'envoyer `worker.js`, `generer-cles.html` ni ce guide.) Valide avec **Commit changes**.
3. **Settings › Pages** : *Source* = « Deploy from a branch », branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une ou deux minutes, GitHub affiche l'adresse du site : `https://TON-COMPTE.github.io/twixx-hq/`. C'est le lien à donner aux joueurs.

> Le site est alors accessible à toute personne qui connaît l'adresse. Les données restent celles de ton gist, comme avant.

Sur la nouvelle adresse : connecte-toi en admin, puis **Données › Partage › Mettre à jour depuis le lien** (le lien du gist est déjà prérempli) pour récupérer tes données. Réenregistre aussi ton **jeton GitHub** (Données › Partage › Publier sur GitHub) : il est lui aussi lié à l'adresse.

Pour mettre le site à jour plus tard : remplace `index.html` dans le dépôt (**Add file › Upload files**, même nom). Les téléphones récupèrent la nouvelle version tout seuls.

## Étape 2 — Créer les clés des notifications

1. Ouvre `generer-cles.html` dans ton navigateur (double-clic).
2. Clique sur **Générer mes clés**.
3. Garde la page ouverte : tu as besoin de la **clé publique** et de la **clé privée** à l'étape suivante. Ne partage jamais la clé privée.

## Étape 3 — Créer le serveur sur Cloudflare (gratuit)

Les intitulés de Cloudflare peuvent légèrement changer, mais la logique reste la même.

1. Crée un compte gratuit sur **cloudflare.com**.
2. **Workers & Pages › Create › Create Worker** (ou « Start with Hello World »). Nomme-le `twixx-push` puis **Deploy**.
3. Clique sur **Edit code**, **supprime tout le code**, colle le contenu de `worker.js`, puis **Deploy**.
4. **Le stockage** : dans le menu de gauche, **Storage & databases › Workers KV › Create** un namespace nommé `twixx-kv`. Retourne dans ton Worker : **Settings › Bindings › Add › KV namespace**, *Variable name* = `KV` (exactement), choisis `twixx-kv`.
5. **Settings › Variables and Secrets › Add** (ajoute ces cinq entrées) :

| Nom | Type | Valeur |
|---|---|---|
| `VAPID_PUBLIC` | Texte | la clé publique de l'étape 2 |
| `VAPID_PRIVATE` | **Secret** | la clé privée de l'étape 2 |
| `VAPID_SUBJECT` | Texte | `mailto:` + ton adresse e-mail |
| `DATA_URL` | Texte | `https://gist.githubusercontent.com/MijeMije17/6328dd4fdd380b24d7046bc8da59ca44/raw/teamops.json` |
| `ADMIN_KEY` | **Secret** | un mot de passe de ton choix (il sert aux boutons « Test » et « Abonnés ») |

   Si ton pseudo admin n'est pas `MijeMije`, ajoute aussi `ADMIN_NAME` avec ton pseudo.
6. **Settings › Trigger Events › Cron Triggers › Add** : expression `*/5 * * * *` (toutes les 5 minutes).
7. Note l'adresse du Worker, du type `https://twixx-push.TON-COMPTE.workers.dev`. Si tu l'ouvres dans le navigateur, tu dois voir « TWIXX HQ · serveur de notifications OK ».

## Étape 4 — Brancher le site

1. Sur le nouveau site, en admin : **Données › Notifications**.
2. Colle l'**adresse du serveur** (étape 3.7) et la **clé publique** (étape 2), vérifie le fuseau horaire (`Europe/Paris`), puis **Enregistrer ces réglages**.
3. Colle ta **clé admin** (`ADMIN_KEY`) et clique sur **Enregistrer la clé** (elle reste sur cet appareil).
4. Clique sur **⬆ Publier** pour que les joueurs reçoivent ces réglages.

## Étape 5 — Les joueurs

Envoie-leur le lien du site (étape 1.4). Chacun fait :

**Sur Android (Chrome)**
1. Ouvre le lien. Se connecter avec son pseudo et son mot de passe. Faire **Données › Partage › Mettre à jour depuis le lien**.
2. Menu ⋮ › **Installer l'application** (ou ouvrir son **Profil** : le bouton « ⬇ Installer l'application » y est aussi).
3. Ouvrir l'application depuis son icône, aller dans **Profil › Notifications**, appuyer sur **🔔 Activer les notifications du planning** et accepter.

**Sur iPhone / iPad (iOS 16.4 ou plus récent)**
1. Ouvrir le lien dans **Safari** (pas dans une autre application).
2. Bouton **Partager** (carré avec une flèche) › **Sur l'écran d'accueil** › Ajouter.
3. **Ouvrir l'application depuis son icône** (pas depuis Safari). Se connecter, faire **Données › Partage › Mettre à jour depuis le lien**.
4. **Profil › 🔔 Activer les notifications du planning** et accepter.

Chaque joueur reçoit tout de suite une notification de confirmation. Il peut ensuite choisir dans son profil : rappel la veille (oui / non) et rappel avant l'événement (30 min, 1 h, 2 h ou aucun).

## Ce que reçoivent les joueurs

- **La veille à 18 h** : « Demain · Entraînement 21:00 — Scrim vs X ».
- **Avant l'événement** (selon leur réglage) : « Dans 1 h · … ». Pour un événement sans heure, un rappel à 9 h le jour même.
- Les événements **répétés** sont pris en compte, ainsi que la **map de la semaine** pour les matchs, tournois et entraînements.
- Un appui sur la notification ouvre le planning.

## Au quotidien

- Après avoir ajouté, modifié ou supprimé un événement, clique sur **⬆ Publier** : le serveur lit le planning dans ton gist. Le lien brut de GitHub peut mettre quelques minutes à se rafraîchir.
- Les rappels partent avec jusqu'à 5 minutes de décalage (le serveur passe toutes les 5 minutes).

## Si ça ne marche pas

| Problème | À essayer |
|---|---|
| Le bouton « Envoyer un test » répond « clé admin incorrecte » | La clé saisie doit être identique à `ADMIN_KEY` dans Cloudflare. |
| « pseudo inconnu » à l'activation | Le joueur n'est pas dans le gist publié : ajoute-le au roster puis **⬆ Publier**. |
| Le joueur ne voit pas le bouton d'activation | Il doit d'abord faire **Mettre à jour depuis le lien** (pour recevoir les réglages), puis rouvrir son profil. Sur iPhone, il doit ouvrir l'application depuis l'icône. |
| « Notifications bloquées » | Réglages du téléphone ou du navigateur › Notifications › autoriser le site, puis réessayer. |
| Plus de notifications après un changement de clés | Chaque joueur désactive puis réactive les notifications dans son profil. |
| Un rappel arrive en retard sur Android | Certains téléphones retardent les notifications pour économiser la batterie : désactiver l'optimisation de batterie pour Chrome / l'application. |
| Rien ne part | Cloudflare › ton Worker › **Logs** pour voir les erreurs (clés mal copiées, `KV` mal nommé, `DATA_URL` incorrect). |

## Limites à connaître

- Une notification ne peut pas être garantie à 100 % (téléphone éteint, mode économie d'énergie, données du navigateur effacées, application désinstallée) : le planning dans l'application reste la référence.
- L'abonnement est propre à un appareil : un joueur qui change de téléphone ou réinstalle l'application doit réactiver ses notifications.
- Formule gratuite de Cloudflare : largement suffisante pour une équipe (quelques dizaines de joueurs).
