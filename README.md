# FONTE — installation sur iPhone

Ce dossier est un projet React (Vite) complet et autonome. Une fois déployé
en ligne, vous pourrez l'installer sur l'écran d'accueil de votre iPhone et
il s'ouvrira en plein écran, sans barre Safari — comme une vraie app.

## 1. Déployer en ligne (gratuit, ~2 minutes)

Le plus simple est **Vercel** :

1. Créez un compte sur https://vercel.com (gratuit, avec GitHub ou email)
2. Installez la CLI si besoin : `npm i -g vercel`
3. Dans ce dossier, lancez :
   ```
   npm install
   vercel
   ```
4. Suivez les instructions à l'écran (répondre aux questions par défaut suffit)
5. Vercel vous donne une URL du type `https://fonte-xxxx.vercel.app`

Alternative équivalente : **Netlify** (glisser-déposer le dossier `dist`
après `npm run build` sur https://app.netlify.com/drop).

## 2. Installer sur l'écran d'accueil (iPhone)

1. Ouvrez l'URL obtenue dans **Safari** sur l'iPhone (important : Safari,
   pas Chrome — "Ajouter à l'écran d'accueil" fonctionne différemment ailleurs)
2. Appuyez sur l'icône **Partager** (le carré avec la flèche vers le haut)
3. Choisissez **"Sur l'écran d'accueil"**
4. Confirmez le nom (FONTE) et validez

L'icône apparaît alors sur votre écran d'accueil. En l'ouvrant depuis là
(et non depuis Safari), l'app se lance en plein écran, sans barre d'adresse.

## Synchronisation entre appareils (PC / tablette / téléphone)

Depuis cette version, les données ne sont plus seulement stockées dans le
navigateur de chaque appareil : elles sont aussi enregistrées côté serveur,
via **Netlify Blobs** (une base de données incluse gratuitement avec votre
hébergement Netlify — aucun compte supplémentaire à créer).

Concrètement : ce que "Moi" ou "Ben" ajoute sur un appareil sera visible
sur les autres après avoir rechargé la page. Il n'y a pas de mise à jour
en direct pendant que l'app est ouverte (il faut recharger pour voir les
changements faits ailleurs), mais les données sont bien communes à tous.

Le `localStorage` de chaque appareil reste utilisé comme copie de secours
en cas de coupure réseau — l'app continue de fonctionner hors-ligne, et se
resynchronise à la prochaine connexion.

## Notes techniques

- Les données (séries, machines, historique) sont désormais centralisées
  côté serveur (Netlify Blobs) et partagées entre tous les appareils.
- Une copie est aussi gardée dans le `localStorage` de chaque appareil,
  comme filet de sécurité hors-ligne.
- Si deux personnes modifient exactement au même moment sur deux appareils
  différents, la dernière sauvegarde écrasera l'autre (pas de fusion
  automatique) — peu probable en usage normal, mais bon à savoir.
