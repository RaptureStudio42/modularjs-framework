# Passer de la 4.0 à la 4.1

Les noms français du serveur temps réel (MJS-WS), du serveur de jeu, de µschema, de `µ.smooth`, de la commande du serveur de jeu et de ses fichiers d'entrée par défaut, du préréglage de transition `volet`, de la transition d'élément `*volet`, des sorties des outils de développement (`mjs check --json --derived`, journal de `mjs dev`) et des types du compilateur passent en anglais. Les anciens noms ne sont plus lus ni acceptés, sans période de transition : remplacez-les avant de passer en 4.1.0. Le détail de chaque changement est dans le [journal des modifications](CHANGELOG.md).

## L'API parle anglais

| Où | Avant | Maintenant |
|---|---|---|
| option de `µ.smooth` | `retard` | `delay` |
| définition rendue par `µ.schema` | `nom`, `champs`, `ordre` | `name`, `fields`, `order` |
| `bits([…])`, `µ.bits([…])` | `{ kind: 'bits', noms }` | `{ kind: 'bits', names }` |
| définitions qui voyagent (`µ:schema`, point d'accès de `µ.ajax.binary`) | `{ hash, schemas: [{ nom, champs }] }` | `{ hash, schemas: [{ name, fields }] }` |
| tampon de positions du serveur de jeu | `createHistory(n).pousser(…)` | `createHistory(n).push(…)` |
| paquet du serveur temps réel | `{ nom, installer(app) }` | `{ name, install(app) }` |
| compteurs de `RedisAdapter` ou d'un adaptateur maison | `reconnexions`, `ignoresOrigin` | `reconnects`, `ignoredOrigin` |
| `MjsWsGuardCause` | `'debit'`, `'engorgement'`, `'charge'` | `'rate'`, `'backpressure'`, `'payload'` |
| types | `MjsWsStatsConnexions`, `MjsWsStatsFlux`, `MjsWsStatsPont`, `MjsWsStatsAdaptateur`, `MjsWsStatsErreurs`, `MjsWsStatsLatences` | `MjsWsStatsConnections`, `MjsWsStatsStreams`, `MjsWsStatsBridge`, `MjsWsStatsAdapter`, `MjsWsStatsErrors`, `MjsWsStatsLatencies` |
| réponse `connect` refusée de votre back (proxy de décisions) | `{ ok: false, raison }` | `{ ok: false, reason }` |
| `reason` d'une divergence lockstep (`def.onDivergence`, événement `divergence`) | `'auto-contradiction'` | `'self-contradiction'` |
| commande du serveur de jeu | `mjs serveur` | `mjs server` |
| section de `mjs.config.json` et son type | `serveur`, `ServeurConfig` | `server`, `ServerConfig` |
| préréglage de transition de page | `volet` | `cover` |
| registre global des schémas | `µ._mjs_mjschemaRegistre` | `µ._mjs_mjschemaRegistry` |
| transition d'élément | `*volet` | `*cover` |
| fichiers d'entrée par défaut de `mjs server` (à la racine, puis sous `server/`) | `serveur.server.mjs`, `serveur.js`, `serveur.civet` | `game.server.mjs`, `game.js`, `game.civet` |

L'état du serveur (`app.stats()`, `createStatsRegistry()`, `GET /stats`, page `/state`) :

| Avant | Maintenant |
|---|---|
| `horodatage`, `memoire` | `timestamp`, `memory` |
| `connexions` : `actives`, `parquees`, `accueillies`, `refusees`, `fermees`, `refuseesPlafond`, `refuseesOrigine`, `refuseesBan` | `connections` : `active`, `parked`, `welcomed`, `refused`, `closed`, `refusedCap`, `refusedOrigin`, `refusedBan` |
| `messages` : `recus`, `envoyes`, `tamponnes`, `rejoues`, `rejetes`, `binaireRecues`, `binaireIgnorees`, `texteRejete` | `messages` : `received`, `sent`, `buffered`, `replayed`, `dropped`, `binaryReceived`, `binaryIgnored`, `textRejected` |
| `garde` : `kicksDebit`, `kicksEngorgement`, `kicksChargeUtile`, `expirationsJeton`, `misesAuBanc` | `guard` : `kicksRate`, `kicksBackpressure`, `kicksPayload`, `tokenExpired`, `bans` |
| `salons` : `nombre`, `membresTotal`, `abonnesPresence` | `rooms` : `count`, `membersTotal`, `presenceSubscribers` |
| `flux` : `nombre`, `deltasEmis`, `resyncsRejeu` | `streams` : `count`, `deltasEmitted`, `resyncsReplay` |
| `pont` : `requetesParEndpoint`, `webhooksEnvoyes`, `webhooksEchoues`, `webhooksAbandonnes` | `bridge` : `requestsByEndpoint`, `webhooksSent`, `webhooksFailed`, `webhooksAbandoned` |
| `adaptateur` : `publies`, `recus`, `ignoresOrigin`, `reordonnances`, `reconnexions` | `adapter` : `published`, `received`, `ignoredOrigin`, `reordered`, `reconnects` |
| `sessions` : `emises`, `reprises`, `expirees`, `debordees` | `sessions` : `issued`, `resumed`, `expired`, `overflowed` |
| `intervallesPing` : `echantillon` | `pingIntervals` : `samples` |
| `erreurs` : `erreurs`, `avertissements` | `errors` : `errors`, `warnings` |
| registre : `fluxCompteurs` | registre : `streamCounters` |

`GET /metrics` ne change pas.

## Les outils de développement parlent anglais

| Où | Avant | Maintenant |
|---|---|---|
| `mjs check --json --derived`, `class` | `"horloge"` | `"clock"` |
| `mjs check --json --derived`, `reasons[].code` | `globale`, `heure`, `hasard`, `methode`, `fonction`, `contexte`, `cle`, `etat`, `attente`, `derivee`, `inconnue`, `liste`, `garde` | `global`, `time`, `random`, `method`, `function`, `context`, `key`, `state`, `await`, `derived`, `unknown`, `list`, `guard` |
| entrée du journal de `mjs dev` (fichiers, `page_errors` de `mjs mcp`) | `premier`, `dernier`, `pile` | `first`, `last`, `stack` |
| corps que la page envoie à `POST /__mjs/errors` (`mjs dev`, `mjs serve`) | `pile` | `stack` |
| types internes du compilateur (`dist/types`) | `DeriveeClassee`, `ScriptEcrit`, `raccourci-dev`… | `ClassifiedDerived`, `WrittenScript`, `shortcut-dev`… |

## Ce qui sort du framework parle anglais

| Où | Avant | Maintenant |
|---|---|---|
| `decode()` de `µ.schema` | `{ nom, objet }` | `{ name, object }` |
| raisons envoyées au client (MJS WS) | `deconnexion`, `inconnue` | `logout`, `unknown` |
| refus du pont (réponse HTTP 401) | `nonce-rejoué` | `nonce-replayed` |
| raisons d'un bannissement (journal, statistiques) | `origine`, `plafond` | `origin`, `cap` |
| code d'une élévation de µaccounts qui échoue | `account-elevation-echec` | `account-elevation-failed` |
| raisons d'un refus du serveur de jeu | `quota-identite`, `rejeu-fenetre` | `identity-quota`, `replay-window` |
| classes posées par le cœur | `mjs-toast-barre`, `mjs-fx-hologram-nu` | `mjs-toast-bar`, `mjs-fx-hologram-bare` |
| feuilles partagées du rendu serveur | `mjs_ssr_style_partagee-…`, `partagee-theme`, `partagee-theme-appli` | `mjs_ssr_style_shared-…`, `shared-theme`, `shared-theme-app` |
| motif d'un refus du serveur des thèmes (JSON) | `introuvable`, `ambigu`, `inchange`, `fichier-manquant`, `hors-projet`, `machine-seule`, `nom-refuse`, `racine-inconnue`, `valeur-refusee` | `not-found`, `ambiguous`, `unchanged`, `missing-file`, `outside-project`, `local-machine-only`, `name-rejected`, `unknown-root`, `value-rejected` |
| genre d'un fichier dans la sortie de `mjs mcp` | `serveur`, `entree`, `autre`, `classe`, `regles`, `effets`, `partiel` | `server`, `entry`, `other`, `class`, `rules`, `effects`, `partial` |
| aide de console | `µ._mjs_inspectAffiche` | `µ._mjs_inspectShow` |
| options de l'API de construction | `BundlerOpts.reffetsMode`, `TranspileOpts.reffetsAll`, `Bundler.reffetsAll` | `effectsMode`, `effectsAll`, `effectsAll` |
| panneau de développement (réglages gardés, position) | `mjs-devpanel-maj`, `bas`, `flottant` | `mjs-devpanel-upd`, `bottom`, `floating` |
| panneau de développement et inspecteur (onglet, actions, classes) | `derives`, `objet-fermer`, `fx-copier`, `fx-retablir`, `.panneau`, `.onglet-corps`, `.di-apercu`… | `derived`, `object-close`, `fx-copy`, `fx-restore`, `.panel`, `.tab-body`, `.di-preview`… |
| page `GET /heatmap` du pont, carte de chaleur (`id`, classes) | `#liste`, `#titre`, `#recents`, `#depuis`, `#legende`, `.vide`, `.cadre` | `#list`, `#title`, `#recent`, `#since`, `#legend`, `.empty`, `.frame` |
| option de `mjs build` | `--cache=verifier` | `--cache=verify` |
| troisième argument de `onLog`, file des webhooks pleine (serveur temps réel) | `perdus` | `lost` |
| message du canal `:ban` (bus MJS WS) | `{ cle, duree }` | `{ key, duration }` |

## Trouver les anciens noms

Sept recherches de texte et une recherche de fichiers, à la racine de votre projet :

```bash
grep -rnIE --exclude-dir={node_modules,.git,vendor,tmp,log,dist,public} "MjschemaRegistre|\b(parNom|parId)\b|\.pousser\(|\bretard:|\binstaller\s*(\(|:|,|\}|=|$)|\.(champs|ordre)\b|\bchamps['\"]?(:|\s*=>)|kind['\"]?\s*(:|=>)\s*['\"]bits|intervallesPing|refusees(Plafond|Origine|Ban)|kicks(Debit|Engorgement|ChargeUtile)|expirationsJeton|misesAuBanc|membresTotal|abonnesPresence|deltasEmis|resyncsRejeu|requetesParEndpoint|webhooks(Envoyes|Echoues|Abandonnes)|reordonnances|binaire(Recues|Ignorees)|texteRejete|fluxCompteurs|ignoresOrigin|\breconnexions\b|MjsWsStats(Connexions|Flux|Pont|Adaptateur|Erreurs|Latences)" .
grep -rnIE --exclude-dir={node_modules,.git,vendor,tmp,log,dist,public} "['\"](horodatage|memoire|connexions|garde|salons|flux|pont|adaptateur|erreurs|actives|parquees|accueillies|refusees|fermees|recus|envoyes|tamponnes|rejoues|rejetes|nombre|publies|emises|reprises|expirees|debordees|avertissements|echantillon)['\"]|\b(horodatage|memoire|connexions|garde|salons|flux|pont|adaptateur|erreurs|sessions|messages)\??\.(rss|actives|parquees|accueillies|refusees|fermees|recus|envoyes|tamponnes|rejoues|rejetes|nombre|publies|emises|reprises|expirees|debordees|erreurs|avertissements)\b" .
grep -rnIE --exclude-dir={node_modules,.git,vendor,tmp,log,dist,public} "auto-contradiction|\braison:|['\"]raison['\"]|:raison\b|mjs serveur|ServeurConfig|['\"]serveur['\"]\s*:|['\"]volet(:(left|right|up|down))?['\"]|\*volet\b|_mjs_mjschemaRegistre" .
grep -rnIE --exclude-dir={node_modules,.git,vendor,tmp,log,dist,public} "(class|code)['\"]?\]?\s*(:|[!=]==?|=>)\s*['\"](horloge|globale|heure|hasard|methode|fonction|contexte|cle|etat|attente|derivee|inconnue|liste|garde)['\"]|\.(class|code),\s*['\"](horloge|globale|heure|hasard|methode|fonction|contexte|cle|etat|attente|derivee|inconnue|liste|garde)['\"]|\b(case|when)\s+['\"](horloge|globale|heure|hasard|methode|fonction|contexte|cle|etat|attente|derivee|inconnue|liste|garde)['\"]|\.includes\([^)]*\b(class|code)\)|(\.|\[['\":])(premier|dernier)\b|\{[^}]*\b(premier|dernier)\b[^}]*\}\s*=" .
grep -rnIE --exclude-dir={node_modules,.git,vendor,tmp,log,dist,public} "\.(nom|objet)\b|['\"](deconnexion|inconnue|nonce-rejoué|origine|plafond|account-elevation-echec|quota-identite|rejeu-fenetre|introuvable|ambigu|inchange|fichier-manquant|hors-projet|machine-seule|nom-refuse|racine-inconnue|valeur-refusee|entree|autre|classe|regles|effets|partiel)['\"]|mjs-toast-barre|mjs-fx-hologram-nu|_ssr_style_partagee-|partagee-theme|_mjs_inspectAffiche|reffets(Mode|All)\b" .
grep -rnIF --exclude-dir={node_modules,.git,vendor,tmp,log,dist,public} -e "--cache=verifier" .
grep -rlIZE --exclude-dir={node_modules,.git,vendor,tmp,log,dist,public} "onLog" . | xargs -0 -r grep -nHIE "\bperdus\b"
find . \( -name node_modules -o -name .git \) -prune -o \( -name 'serveur.server.mjs' -o -name 'serveur.js' -o -name 'serveur.civet' \) -print
```

Chaque ligne trouvée se relit : un mot français peut aussi appartenir à vos propres données (`raison`, `volet`, un `.premier` à vous) ; relisez aussi tout `.nom` lu sur une définition de schéma. Un fichier trouvé par la dernière n'est concerné que s'il est l'entrée de votre serveur de jeu et que `mjs.config.json` ne la déclare pas (`server.entry`). Une recherche ne voit pas un compteur de `app.stats()` lu sans son sous-champ (`const c = stats.connexions`) : relisez aussi ces lectures.

## Ce qui casse si vous en oubliez un

- un ancien nom lu dans `app.stats()` ou dans `GET /stats` vaut `undefined` : `app.stats().connexions.actives` lève `TypeError`, un tableau de bord affiche une case vide ;
- un paquet `{ nom, installer }` fait lever `app.use` au démarrage : « app.use : paquet refusé — il lui manque name (le texte qui l'identifie) et install (la fonction qui l'installe) ; écrivez-le { name: 'mon-paquet', install(app) { … } } ou definePackage('mon-paquet', app => { … }) » ;
- un adaptateur maison qui expose encore `reconnexions` ou `ignoresOrigin` ne lève rien : ses deux compteurs restent à `0` ;
- `µ.smooth(…, { retard: 50 })` ne lève rien : le retard redevient 100 ms ;
- un objet `{ kind: 'bits', noms: […] }` écrit à la main fait lever la déclaration du schéma (`TypeError`) ;
- lire `def.nom`, `def.champs` ou `def.ordre` donne `undefined` ;
- un serveur qui sert encore ses définitions avec `nom` et `champs` au point d'accès de `µ.ajax.binary` : la requête binaire échoue dès que le navigateur doit recharger les définitions ;
- `createHistory(n).pousser(…)` lève `TypeError` ;
- un back qui répond encore `{ ok: false, raison: '…' }` refuse toujours la connexion, mais le client reçoit « authentification refusée (proxy) » au lieu de votre message ;
- un code qui compare `reason` à `'auto-contradiction'` ne voit plus ce cas, sans erreur ;
- `mjs serveur` répond « Commande inconnue » et propose `mjs server` ; une section `serveur` dans `mjs.config.json` la fait refuser (« clé inconnue 'serveur' ») ;
- `viewTransition: 'volet'` fait refuser `mjs.config.json` ;
- `µ._mjs_mjschemaRegistre` vaut `undefined` ;
- `*volet` arrête la construction, écrit seul ou avec un réglage sans nom (`*volet(down)`) : « *volet : transition inconnue » ; remplacez `*volet` par `*cover` ;
- un serveur de jeu dont l'entrée s'appelle encore `serveur.server.mjs`, `serveur.js` ou `serveur.civet`, sans `server.entry`, ne démarre plus : `mjs server` répond « aucun fichier d'entry trouvé » ; renommez le fichier (`game.server.mjs`, `game.js`…) ou déclarez-le dans `"server": { "entry": "…" }` ;
- un script de la page nommé `game.js`, posé à la racine du projet, n'est plus servi par `mjs dev` sans bloc `render` (404) : rangez-le dans un dossier, `public/` par exemple ;
- un script qui compare `class` à `"horloge"`, ou un code à `"hasard"`, dans la sortie de `mjs check --json --derived` ne trouve plus rien, sans erreur ;
- un script qui lance `mjs build --cache=verifier` voit l'avertissement « option inconnue » à chaque construction, qui se fait en entier, sans cache ni vérification ;
- un `onLog` à vous qui lit `meta.perdus` lit `undefined` ; le message reste le même ;
- un adaptateur de bus à vous qui lit `cle` ou `duree` sur le canal `:ban` lit `undefined` ; un processus 4.0 et un processus 4.1 sur le même bus ignorent les bannissements l'un de l'autre ;
- un outil qui lit `premier`, `dernier` ou `pile` dans le journal de `mjs dev` lit `undefined` ; le journal écrit par la 4.0.0 repart vide ;
- un serveur à vous qui reçoit le corps de `POST /__mjs/errors` et lit `pile` lit `undefined` ; une page construite par la 4.0.0 et restée ouverte envoie encore `pile` : sa pile d'appels n'arrive pas au journal ;
- `res.nom` ou `res.objet` lu sur le résultat de `decode()` vaut `undefined`, sans erreur ;
- un client qui compare une raison, un motif ou un code à son ancien nom (`'deconnexion'`, `'nonce-rejoué'`, `'plafond'`, `'quota-identite'`, `'introuvable'`, `'account-elevation-echec'`…) ne voit plus ce cas, sans erreur ;
- une feuille qui stylait `.mjs-toast-barre` ou `.mjs-fx-hologram-nu`, ou une règle de cache écrite pour `mjs_ssr_style_partagee-…`, ne s'applique plus ;
- un client de `mjs mcp` qui attend `classe`, `regles` ou `effets` ne range plus ces fichiers ;
- `µ._mjs_inspectAffiche(…)` lève « is not a function » ; `reffetsMode` passé à l'API de construction est ignoré ;
- la position et les réglages du panneau de développement gardés par la 4.0 ne sont plus relus : il repart en bas ;
- un test ou une sonde qui cherche le panneau de développement, l'inspecteur ou la page `GET /heatmap` par une ancienne classe, un ancien `id` ou une ancienne action (`.panneau`, `[data-action="fx-copier"]`, `#liste`…) ne trouve plus rien ; une feuille qui habillait la page `/heatmap` par ses anciens `id` ne s'applique plus ;
- en TypeScript, un ancien nom de type ou de champ, de l'API comme des types internes du compilateur, est une erreur de compilation.

## Pendant le déploiement

Un onglet resté ouvert sur la 4.0.0 et qui déclare les mêmes schémas que le serveur n'est pas touché. S'il n'en déclare pas, ou d'autres, il écrit « définitions µ:schema invalides » dans la console et perd les messages que le serveur lui envoie en binaire ; les messages JSON passent. Rechargez-le. Il en va de même d'un onglet 4.1.0 face à un serveur resté en 4.0.0 : passez le serveur et les pages ensemble. Une requête `µ.ajax.binary` n'échoue que si le navigateur doit recharger les définitions (hash différent). Aucune autre trame `µ:` ne change.

Les processus d'un même bus MJS WS (adaptateur Redis ou mémoire) passent ensemble en 4.1.0 : le canal `:ban` porte `{ key, duration }`, et un processus 4.0 et un processus 4.1 ne s'appliquent plus leurs bannissements.

## Depuis la 4.1.1

- Une attache qui appelle une fonction du `<script>` (`:attach={f(_node)}`) se rejoue quand ce que lit la fonction change, comme `:attach={@f(_node)}` avec une méthode : nettoyage, puis nouvelle pose. Si elle ne doit passer qu'une fois, écrivez `:attach.once={f(_node)}`.
- La trace du cache de construction s'appelle `last.json` (`last-render.json` pour le prérendu) : vous pouvez effacer l'ancien `dernier.json` de `node_modules/.cache/mjs/build/`.
- Un `µeffect` ou un composant qui appelle une méthode de sa connexion `µsocket` (`on()`, `connect()`, `send()`…) ne suit plus l'état de la connexion : il ne repart plus et n'est plus redessiné quand cet état change. Ce qui doit suivre l'état le lit lui-même (`{@sock.state}`, `@sock.connected`).

## Depuis la 4.1.2

- Rien à changer dans votre code. `mjs build` d'un projet qui prérend ses pages ne compile plus qu'une fois : la ligne des modules du cœur, les avertissements de la compilation et, sous `--cache`, la ligne `Prérendu — cache : …` ne sortent plus deux fois. Un script qui compte ces lignes dans la sortie de la commande n'en voit plus qu'une.
- Quand le projet convertit des images avec `sharp`, le dossier de sortie porte un fichier de plus, `.mjs-images.json` : il note les variantes déjà encodées, pour ne pas les refaire à la construction suivante. Traitez-le comme le reste du dossier de sortie ; un déploiement qui garde ce dossier d'une fois sur l'autre ne réencode plus les images qui n'ont pas changé.

## Depuis la 4.1.3

- Une prop liée ne s'écrit plus dans l'enfant quand sa ligne se redessine, quand la liste est triée, ni quand le parent réécrit la même valeur ou appelle `µrefresh` : seule une valeur changée, ou une ligne qui porte un autre élément, l'y remet. Pour remettre un enfant à la valeur du parent, liez la prop dans les deux sens (`!{…}`) ou recréez l'enfant par `{key}`.
- Un `<@@number strict>` sous un pas entier ne laisse plus entrer que des chiffres : s'il doit accepter « 1,000 » (mille), retirez `strict`. Sous `strict`, chaque refus part par l'événement `refuse`, dont `e.data` dit la raison (`digits`, `decimals`, `length`, `min` ou `max`) et la limite (`{ reason: 'max', limit: 999 }`), pour le dire près du champ : le contrôle de la frappe que votre page faisait elle-même (chiffres seuls, bornes) peut partir.
- Une liste liée (`<select value={$x}>`) choisit maintenant l'option qui porte sa valeur même quand la valeur des options est calculée : les `selected={…}` posés pour s'en passer peuvent partir. Quand plus aucune option ne porte la valeur liée, elle n'en montre aucune (avant, l'ancienne option restait choisie).
- La première construction après la mise à jour réencode toutes vos images une fois (la façon dont MJS les encode entre maintenant dans la clé de `.mjs-images.json`), puis les reprend comme avant.
- `mjs build` échoue maintenant (code 1) quand un fichier qu'il a livré a disparu avant sa fin, et nomme ce qui manque : un autre programme a effacé une partie de la sortie pendant la construction. Relancez-la ; avec `--cache`, elle remet ce qui manquait.
- `mjs build` sort aussi en code 1 quand sa sortie cite un fichier absent du dossier de sortie (adresse `.js` sous son adresse publique, manifeste, `mjs-precache.json`). La vérification regarde le disque à la fin : un fichier qu'une étape lancée après `mjs build` pose dans ce dossier ne compte pas encore ; posez-le avant.
- `mjs build --cache` ne relit plus un fichier déjà en place dont le nom porte l'empreinte de son contenu : un fichier de sortie abîmé à la main, sous le même nom et avec la même taille, y reste. `mjs build --cache=verify` le voit.
- Une construction `mjs build --cache` dont la compilation échoue laisse `.mangle-cache.json` tel qu'il était : la construction relancée ensuite (par exemple le repli complet d'une mise en ligne) donne les mêmes fichiers que si l'essai n'avait pas eu lieu. Hors production avec `"minify": true`, elle n'écrit plus rien dans le cache.
- Avec Node 22.8 ou plus, toutes les commandes de `mjs` sauf `dev`, `ws` et `server` (`build`, `check`, `serve`…) gardent le code compilé de Node dans `mjs-node-cache-<uid>` du dossier temporaire ; `NODE_DISABLE_COMPILE_CACHE=1` le coupe.
- `structuredClone` marche dans une page rendue au serveur ou prérendue (moteur `happy-dom`) et dans `createHarness` : une page qui s'en passait par un repli (`JSON.parse(JSON.stringify(…))`) peut le reprendre.

## Noms internes renommés, pour vos tests et vos sondes

Aucune appli ne doit lire un nom qui commence par `_mjs_` : il peut changer sans préavis. Si vos tests ou vos sondes en lisent quand même un (`µ._mjs_…`, `el._mjs_…`), voici ceux qui changent dans la 4.1. Les autres gardent leur nom (`_shadow`, `µ._mjs_store`, `µ._mjs_txt`, `µ._mjs_ws`, `µ._mjs_dispatch`, `µ._mjs_setComputed`…).

| 4.0 | 4.1 |
|---|---|
| `_mjs_FICHE` (symbole `Symbol('mjs_fiche')`) | `_mjs_HANDLER` (`Symbol('mjs_handler')`) |
| `_mjs_auteurs` | `_mjs_authors` |
| `_mjs_awVu` | `_mjs_awSeen` |
| `_mjs_awVue` | `_mjs_awView` |
| `_mjs_basc` | `_mjs_flip` |
| `_mjs_carnet` | `_mjs_ledger` |
| `_mjs_carnetVoit` | `_mjs_ledgerSees` |
| `_mjs_cle<n>` (variable du code compilé) | `_mjs_keyAt<n>` |
| `_mjs_compte` | `_mjs_account` |
| `_mjs_compteWired` | `_mjs_accountWired` |
| `_mjs_deepCle` | `_mjs_deepKey` |
| `_mjs_deepMeme` | `_mjs_deepSame` |
| `_mjs_deepNom` | `_mjs_deepName` |
| `_mjs_deepNomA` | `_mjs_deepNameA` |
| `_mjs_deepNomF` | `_mjs_deepNameF` |
| `_mjs_deepNomLu` | `_mjs_deepNameRead` |
| `_mjs_deepNomV` | `_mjs_deepNameV` |
| `_mjs_deepSur` | `_mjs_deepSafe` |
| `_mjs_derAvertis` | `_mjs_lastWarned` |
| `_mjs_detAvis` | `_mjs_claimNotice` |
| `_mjs_detConnu` | `_mjs_claimKnown` |
| `_mjs_detSortis` | `_mjs_claimOut` |
| `_mjs_detT` | `_mjs_claimT` |
| `_mjs_detenu` | `_mjs_isClaimed` |
| `_mjs_detenus` | `_mjs_claimed` |
| `_mjs_detenusAvant` | `_mjs_claimedBefore` |
| `_mjs_detient` | `_mjs_claims` |
| `_mjs_devCree` | `_mjs_devCreate` |
| `_mjs_devDefini` | `_mjs_devDefined` |
| `_mjs_devFineVu` | `_mjs_devFineSeen` |
| `_mjs_devLu` | `_mjs_devRead` |
| `_mjs_devModifie` | `_mjs_devModified` |
| `_mjs_devPropre` | `_mjs_devClean` |
| `_mjs_diApercu` | `_mjs_diPreview` |
| `_mjs_douteCle` | `_mjs_doubtKey` |
| `_mjs_en` | `_mjs_ent` |
| `_mjs_en_<n>` (variable du code compilé) | `_mjs_ent_<n>` |
| `_mjs_fait` | `_mjs_done` |
| `_mjs_fil` | `_mjs_tap` |
| `_mjs_filEcrit` | `_mjs_tapWrite` |
| `_mjs_fin` | `_mjs_end` |
| `_mjs_forCourt` | `_mjs_forShort` |
| `_mjs_fxPileHad` | `_mjs_fxStackHad` |
| `_mjs_fxPileWarn` | `_mjs_fxStackWarn` |
| `_mjs_i18nPremier` | `_mjs_i18nFirst` |
| `_mjs_i18nTard` | `_mjs_i18nLate` |
| `_mjs_inspectAffiche` | `_mjs_inspectShow` |
| `_mjs_jeton` | `_mjs_token` |
| `_mjs_lie` | `_mjs_bind` |
| `_mjs_localesDites` | `_mjs_toldLocals` |
| `_mjs_lu` | `_mjs_read` |
| `_mjs_lus` | `_mjs_reads` |
| `_mjs_mefiance` | `_mjs_distrust` |
| `_mjs_milieu` | `_mjs_middle` |
| `_mjs_minuteries` | `_mjs_timers` |
| `_mjs_mjsDisplayAvant` | `_mjs_mjsDisplayPrev` |
| `_mjs_mjsMasque` | `_mjs_mjsMask` |
| `_mjs_mjsRecu` | `_mjs_mjsReceived` |
| `_mjs_monte` | `_mjs_lift` |
| `_mjs_mur` | `_mjs_wall` |
| `_mjs_navRecu` | `_mjs_navReceived` |
| `_mjs_nom` | `_mjs_tid` |
| `_mjs_noms` | `_mjs_tids` |
| `_mjs_nonTenu` | `_mjs_notHeld` |
| `_mjs_partage` | `_mjs_sharing` |
| `_mjs_partages` | `_mjs_sharedRoots` |
| `_mjs_propre` | `_mjs_isClean` |
| `_mjs_proprio` | `_mjs_owner` |
| `_mjs_rafAvertis` | `_mjs_rafWarned` |
| `_mjs_redit` | `_mjs_retold` |
| `_mjs_refaire` | `_mjs_redo` |
| `_mjs_refuseRetablir` | `_mjs_refuseRestore` |
| `_mjs_rendu` | `_mjs_rendering` |
| `_mjs_sorti` | `_mjs_exited` |
| `_mjs_stateFil` | `_mjs_stateTap` |
| `_mjs_storeCle` | `_mjs_keyStore` |
| `_mjs_storeFil` | `_mjs_storeTap` |
| `_mjs_storeSur` | `_mjs_storeSafe` |
| `_mjs_storeVu` | `_mjs_storeSeen` |
| `_mjs_tenus` | `_mjs_holders` |
| `_mjs_tonErr` | `_mjs_userTypeError` |
| `_mjs_toute` | `_mjs_all` |
| `_mjs_uAvis` | `_mjs_uNotice` |
| `_mjs_uTenus` | `_mjs_uHeld` |
| `_mjs_vu` | `_mjs_seen` |
