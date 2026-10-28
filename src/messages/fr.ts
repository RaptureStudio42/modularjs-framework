// catalogue FR — textes du compilateur, du CLI et des serveurs Node (langue par défaut).
// RÈGLE : la valeur fr reproduit EXACTEMENT le texte historique (émoji, espaces, \n compris) ;
// toute nouvelle chaîne utilisateur du périmètre Node DOIT naître ici (jamais en dur en source).

import type { MsgEntry, MsgVars } from './index.js'

export const fr = {

  // ═══ CLI (src/cli.ts, src/cli/) ══════════════════════════════════════════════════════════
  'cli.flag-valeur-manquante': ({ flag }: MsgVars) => `⚠️  ${flag} ignoré : valeur manquante.`,
  // — cli.ts
  // imprimée AVANT 'cli.build-rapport' quand stats.errors est non vide :
  // sans elle, la ligne ✅ s'affichait même sur un build partiellement en échec.
  'cli.build-rapport-echecs': ({ nb }: MsgVars) => `✗ ${nb} en échec`,
  'cli.build-rapport': ({ nb, ms }: MsgVars) => `\n✅ ${nb} fichier${Number(nb) > 1 ? 's' : ''} écrit${Number(nb) > 1 ? 's' : ''} en ${ms}ms`,
  // purge des orphelins d'outputDir après un build sans erreur (cli.ts case 'build' → Bundler.pruneOrphans)
  'cli.build-purge': ({ nb, dossier }: MsgVars) => `🧹 ${nb} ${Number(nb) > 1 ? 'fichiers orphelins retirés' : 'fichier orphelin retiré'} de ${dossier} (plus produits par aucun build)`,
  'cli.build-purge-fichier': ({ fichier }: MsgVars) => `   – ${fichier}`,
  'cli.build-purge-echec': ({ fichier }: MsgVars) => `⚠️  ${fichier} : orphelin non retiré (suppression refusée par le système de fichiers)`,
  // `skipped` (Bundler.pruneOrphans) n'était JAMAIS
  // affiché côté CLI (seuls { removed, failed } étaient déstructurés) : un registre illisible/vide
  // ou un cache-hit sautait la purge SANS UN MOT, indiscernable d'un run sain « rien à purger ».
  'cli.build-purge-registre-illisible': ({ dossier }: MsgVars) => `⚠️  purge ignorée : le registre '.mjs-outputs.json' de ${dossier} est illisible ou de forme inattendue — relancez un build pour le régénérer`,
  'cli.build-purge-registre-vide': ({ dossier }: MsgVars) => `⚠️  purge ignorée : le registre '.mjs-outputs.json' de ${dossier} ne liste aucune extension exploitable — relancez un build pour le régénérer`,
  'cli.build-purge-cache': ({ dossier }: MsgVars) => `⚠️  purge ignorée : ce build a resservi au moins un composant depuis le cache — les assets annexes ne sont pas tous réémis, purger ${dossier} maintenant risquerait de retirer un fichier encore utilisé`,
  'cli.plus-n-autres': ({ nb }: MsgVars) => `+ ${nb} autre${Number(nb) > 1 ? 's' : ''}`,
  'cli.usage': `
mjs — ModularJS V3 compiler

Commands:
  mjs init        Scaffold mjs.config.json + structure de projet
  mjs build       Compile une fois et sort
  mjs dev         Watch + HMR (HTTP+WS sur --port, défaut 3939)
  mjs check       Vérifie la config et liste les composants détectés (compile réellement, comme 'build')
  mjs serve       Sert le rendu SSR/prérendu par requête (render.routes) — bloc render requis dans mjs.config.json (port 3000 par défaut)
  mjs ws          Lance le serveur temps réel (MJS-WS) — fichier d'entry ws.js/server/ws.js, cf. docs/23-mjs-ws.md
  mjs serveur     Lance le serveur de jeu (MJS-Server, mjsServer + app.game) — fichier d'entry serveur.js/server/serveur.js, cf. docs/24-mjs-server.md

Options:
  --root <dir>    Chemin racine du projet (défaut : cwd)
  --manifest <p>  Chemin du bundle_modular.js (entrypoint)
  --output <p>    Répertoire de sortie des fichiers compilés
  --port <n>      Port du serveur dev (défaut : 3939), du serveur ws (défaut : 4000) ou du serveur de jeu (défaut : 4001)
  --entry <p>     Fichier d'entry du serveur ws/serveur (mjs ws/mjs serveur) — défauts propres à chaque commande
  --once          Compile et sort, alias de build
  --dev           Force un build de DÉVELOPPEMENT (panneau d'inspection, non minifié sauf "minify": true)
  --prod          Force un build de PRODUCTION (minifié sauf "minify": false, i18n haché, sans outils de dév)
                  Sans l'un ni l'autre : la clé 'env' de mjs.config.json, sinon NODE_ENV.
  -v, --version   Affiche la version de mjs et sort
  -h, --help      Affiche cette aide et sort
`,
  // `mjs --version` / `-v` — numéro NU précédé du nom de la commande, identique dans les deux
  // langues : un script qui le parse ne doit pas dépendre de la langue du projet
  'cli.version': ({ version }: MsgVars) => `mjs ${version}`,
  'cli.version-illisible': `❌ Version introuvable : le package.json du paquet mjs est illisible ou sans champ "version".`,
  'cli.port-invalide': ({ valeur }: MsgVars) => `⚠️  --port ignoré : "${valeur}" n'est pas un nombre valide (défaut conservé).`,
  'cli.flag-inconnu': ({ arg }: MsgVars) => `⚠️  Flag inconnu ignoré : "${arg}" (vérifiez l'orthographe — voir 'mjs --help').`,
  'cli.config-trouve': ({ dossier }: MsgVars) => `📋 mjs.config.json : ${dossier}/mjs.config.json`,
  'cli.env-dev': ({ origine, minifie }: MsgVars) => `🛠️  Build de DÉVELOPPEMENT (${origine}) — ${minifie ? 'minifié' : 'non minifié'}, panneau d'inspection inclus (Ctrl+Shift+Espace).`,
  'cli.source-origine-config': `« sourceDir » de mjs.config.json`,
  'cli.source-origine-defaut': `chemin par défaut, aucun « sourceDir » en config`,
  'cli.build-racine-vide': ({ commande, racine, source, origine }: MsgVars) => `
❌ [ModularJS] Dossier source INTROUVABLE — « mjs ${commande} » ANNULÉ, aucun fichier écrit.
   Cherché : ${source}
   (${origine})
   Lancé depuis : ${racine}

   Vous êtes probablement dans le mauvais dossier, il manque « --root <projet> », ou le chemin
   de la config ne correspond plus à ce qui est sur le disque.
   Sans ce refus, le build aurait écrit un manifeste VIDE (µ.paths = {}) par-dessus celui
   d'un site en place : plus un composant connu, page blanche, et code de sortie 0.`,
  'cli.build-aucun-composant': ({ commande, source }: MsgVars) => `
❌ [ModularJS] Aucun composant à construire — « mjs ${commande} » ANNULÉ, aucun fichier écrit.
   Dossier source : ${source}
   Il existe, mais ne contient pas un seul fichier « .mjs ».

   Vérifiez « sourceDir » dans mjs.config.json, ou la racine que vous visez.
   C'est exactement le cas qui remplace un manifeste par un manifeste vide.`,
  'cli.env-prod': ({ origine, minifie }: MsgVars) => `🚀 Build de PRODUCTION (${origine}) — ${minifie ? 'minifié' : 'non minifié'}, fragments i18n hachés, aucun outil de développement.`,
  'cli.env-origine-flag': 'imposé par --dev/--prod',
  'cli.env-origine-defaut': 'défaut de `mjs build` — `--prod` pour un build de production',
  'cli.avertissements-titre': ({ nb }: MsgVars) => `\n⚠️  ${nb} avertissement(s) :`,
  'cli.lint-aide-desactivation': 'Pour couper un type : "lint": { "<type>": false } dans mjs.config.json — le type est entre crochets en fin de ligne.',
  'cli.prerendu-debut': `\n🖨️  Prérendu des pages (render.routes) …`,
  'cli.prerendu-resultat': ({ nb, dossier }: MsgVars) => `   → ${nb} page(s) écrite(s) dans ${dossier}`,
  'cli.prerendu-page-ignoree': ({ url, raison }: MsgVars) => `   – ${url} ignorée : ${raison}`,
  'cli.prerendu-aucune-page': `   (aucune page en mode prerender déclarée)`,
  'cli.prerendu-echec': ({ erreur }: MsgVars) => `⚠️  Prérendu ignoré : ${erreur}`,
  'cli.prerendu-echec-build': ({ erreur }: MsgVars) => `✗ Prérendu ou démarrage des pages en échec — build en échec : ${erreur}`,
  'cli.ssr-requiert-happy-dom': '   (le SSR requiert happy-dom : `npm i -D happy-dom`)',
  'cli.css-seul-recharge': '🎨 CSS seul — rechargé à chaud (sans reload de page)',
  'cli.serve-bloc-render-requis': '⚠️  `mjs serve` nécessite un bloc `render` dans mjs.config.json.',
  'cli.serve-demarre': ({ hote, port }: MsgVars) => `\n🖥️  mjs serve — rendu par requête sur http://${hote}:${port}`,
  'cli.serve-mode-info': '   Mode par URL (render.routes) · override header X-MJS-Render · Ctrl+C pour arrêter.',
  'cli.serve-arret-echec': ({ erreur }: MsgVars) => `❌ mjs serve — l'arrêt n'a pas pu tout refermer : ${erreur}`,
  'cli.check-compile-reel': ({ dossier }: MsgVars) => `⚠️  'mjs check' compile réellement (comme 'build') — les fichiers dans ${dossier} seront écrits/écrasés.`,
  'cli.composants-detectes': ({ nb }: MsgVars) => `📦 ${nb} composant${Number(nb) > 1 ? 's' : ''} détecté${Number(nb) > 1 ? 's' : ''}`,
  'cli.et-n-autres': ({ nb }: MsgVars) => `   ... et ${nb} autre${Number(nb) > 1 ? 's' : ''}`,
  'cli.erreurs-compilation': ({ nb }: MsgVars) => `❌ ${nb} erreur${Number(nb) > 1 ? 's' : ''} de compilation :`,
  'cli.tout-compile-ok': ({ nb }: MsgVars) => `✅ Tout compile sans erreur (${nb} fichier${Number(nb) > 1 ? 's' : ''} écrit${Number(nb) > 1 ? 's' : ''}).`,
  'cli.commande-inconnue': ({ commande }: MsgVars) => `Commande inconnue : ${commande}`,
  'cli.commande-suggestion': ({ commande }: MsgVars) => `   Vouliez-vous dire : mjs ${commande} ?`,
  'cli.commande-voir-aide': "   Commandes : init, build, dev, check, serve, ws, serveur — voir 'mjs --help'.",
  'cli.racine-introuvable': ({ racine }: MsgVars) => `❌ [mjs] racine du projet introuvable (pas un dossier) : ${racine}`,
  // une page render.routes DÉCLARÉE dont le RENDU échoue (par
  // opposition à route paramétrée/mode non buildable, skips voulus) fait échouer le build.
  'cli.prerendu-echec-fatal': ({ nb }: MsgVars) => `✗ ${nb} page(s) prérendue(s) en échec — build en échec.`,
  // i18n.default sans dictionnaire réel dans sourceDir/i18n/.
  'cli.i18n-default-sans-dictionnaire': ({ defaut, langues }: MsgVars) => `⚠️  i18n.default : '${defaut}' ne correspond à AUCUN dictionnaire trouvé dans sourceDir/i18n/ (langues présentes : ${langues}) — les visiteurs qui atterrissent sur la langue par défaut n'auront AUCUNE traduction.`,
  // --output/--manifest : garde AVANT compilation + repli catalogue.
  'cli.chemin-non-inscriptible': ({ cle, chemin, ancetre, erreur }: MsgVars) => `❌ ${cle} (${chemin}) : dossier non accessible en écriture (${ancetre}) — ${erreur}`,
  // --output pointe vers un FICHIER déjà existant.
  'cli.output-doit-etre-dossier': ({ cle, chemin }: MsgVars) => `❌ ${cle} (${chemin}) : doit être un dossier — un FICHIER existe déjà à ce chemin.`,
  // --manifest pointe vers un DOSSIER déjà existant (contrainte symétrique).
  'cli.manifest-doit-etre-fichier': ({ cle, chemin }: MsgVars) => `❌ ${cle} (${chemin}) : doit être un fichier — un DOSSIER existe déjà à ce chemin.`,
  // --output et --manifest désignent le même chemin résolu.
  'cli.output-manifest-identiques': ({ chemin }: MsgVars) => `❌ --output et --manifest désignent le MÊME chemin (${chemin}) — l'un écraserait l'autre en pleine compilation. Choisissez deux chemins distincts.`,
  'cli.manifest-refuse-extension': ({ chemin, extension }: MsgVars) => `❌ Le manifeste produit (${chemin}) porterait l'extension d'un fichier source (${extension}) : chaque construction écraserait ce fichier. Donnez à --manifest (ou à manifestPath) un nom en .js, à côté des fichiers produits ; le manifeste que vous écrivez vous-même se déclare dans manifestExternal.`,
  'cli.manifest-refuse-externe': ({ chemin }: MsgVars) => `❌ Le manifeste produit (${chemin}) serait le fichier de manifestExternal : la construction le lirait comme manifeste externe, puis l'écraserait. Donnez à --manifest (ou à manifestPath) un autre chemin, à côté des fichiers produits.`,
  'cli.output-contient-racine': ({ chemin, racine }: MsgVars) => `❌ Le dossier de sortie (${chemin}) contient la racine du projet (${racine}) : mjs dev et mjs serve serviraient tout ce dossier, les fichiers privés d'une application voisine compris (secrets, code serveur). Donnez à outputDir (ou à --output) un dossier dans le projet, par exemple public/modularjs.`,
  'cli.manifest-refuse-sources': ({ chemin, sourceDir, outputDir }: MsgVars) => `❌ Le manifeste produit (${chemin}) serait dans le dossier des sources (${sourceDir}) alors que les fichiers produits vont ailleurs (${outputDir}) : chaque construction l'écrirait au milieu de votre code, par-dessus un fichier du même nom (un lien symbolique, ou une autre casse sur macOS et Windows, mènent au même dossier). Donnez à --manifest (ou à manifestPath) un chemin à côté des fichiers produits.`,
  'cli.erreur-ecriture': ({ code, chemin, erreur }: MsgVars) => `❌ [mjs] impossible d'écrire (${code}) : ${chemin}\n   ${erreur}`,

  // — testing/index.ts (harnais de test des applications)
  'testing.pas-de-projet': ({ racine }: MsgVars) => `[mjs/testing] aucun mjs.config.json trouvé depuis ${racine}, et aucun sourceDir donné — passez { root: '…' } ou { sourceDir: '…' } à createHarness().`,
  'testing.compilation-en-echec': ({ detail }: MsgVars) => `[mjs/testing] le projet ne compile pas, le harnais ne peut rien monter :\n${detail}`,
  'testing.happy-dom-absent': `[mjs/testing] le DOM simulé est absent — installez-le : npm i -D happy-dom (dépendance optionnelle, le framework ne l'impose à personne).`,
  'testing.happy-dom-trop-ancien': ({ found, required }: MsgVars) => `[mjs/testing] les tests d'application requièrent happy-dom ${required} au moins (version installée : ${found}). En dessous, happy-dom perd au ramasse-miettes le rappel d'un MutationObserver : un composant ne voit plus ses attributs changer et un test réussit ou échoue au hasard. Montez la version : npm i -D happy-dom@^${required}`,
  'testing.runtime-introuvable': ({ dossier }: MsgVars) => `[mjs/testing] aucun mjs_core-<empreinte>.js dans ${dossier} — le build n'a rien écrit là où le harnais regarde (vérifiez outputDir).`,
  'testing.composant-en-echec': ({ nom, detail }: MsgVars) => `[mjs/testing] le composant '${nom}' n'a pas pu être chargé : ${detail}`,
  'testing.composant-inconnu': ({ nom, connus }: MsgVars) => `[mjs/testing] aucun composant '${nom}' dans le projet compilé. Connus : ${connus}`,
  'testing.selecteur-sans-noeud': ({ selecteur, tag }: MsgVars) => `[mjs/testing] aucun nœud ne correspond à '${selecteur}' dans <${tag}>.`,
  // — cli/init.ts
  'cli.init.dossier-existe': ({ d }: MsgVars) => `  ↪️  ${d} (existe déjà)`,
  'cli.init.dossier-cree': ({ d }: MsgVars) => `  ✅ ${d}/ créé`,
  'cli.init.config-existe': '  ↪️  mjs.config.json (existe déjà)',
  'cli.init.config-cree': '  ✅ mjs.config.json créé',
  'cli.init.hello-existe': '  ↪️  app/modularjs/hello.mjs (existe déjà)',
  'cli.init.hello-cree': '  ✅ app/modularjs/hello.mjs créé',
  'cli.init.fichier-existe': ({ f }: MsgVars) => `  ↪️  ${f} (existe déjà)`,
  'cli.init.fichier-cree': ({ f }: MsgVars) => `  ✅ ${f} créé`,
  'cli.init.resume': ({ cree, ignores }: MsgVars) => `📦 ${cree} fichier${Number(cree) > 1 ? 's' : ''}/dossier${Number(cree) > 1 ? 's' : ''} créé${Number(cree) > 1 ? 's' : ''}, ${ignores} ignoré${Number(ignores) > 1 ? 's' : ''}`,
  'cli.init.pour-demarrer': 'Pour démarrer :',
  'cli.init.hmr-html': 'Inclure le HMR client dans votre HTML :',

  // — cli/ws.ts (+ clés partagées avec cli/server.ts, cf. risques §8)
  'cli.entry-cli-introuvable': ({ cliEntry, chemin }: MsgVars) => `--entry '${cliEntry}' → '${chemin}' introuvable.`,
  'cli.entry-config-introuvable': ({ champ, valeur, chemin }: MsgVars) => `${champ} '${valeur}' (mjs.config.json) → '${chemin}' introuvable.`,
  'cli.entry-aucun-trouve': ({ liste, racine }: MsgVars) => `aucun fichier d'entry trouvé (cherché : ${liste}, relatifs à la racine du projet '${racine}').`,
  'cli.ws.entry-introuvable': ({ raison, squelette }: MsgVars) => `[mjs ws] ${raison}\n\nCréez un fichier d'entry pour démarrer, par exemple 'ws.server.mjs' à la racine du projet (même dialecte que le <script> de vos composants) :\n\n${squelette}\nPuis relancez 'mjs ws' (ou précisez --entry <chemin>).`,
  'cli.aucun-export-defaut': 'aucun export par défaut',
  'cli.un-tableau': 'un tableau',
  'cli.entry-doit-export-default': ({ produit, entryPath, recu }: MsgVars) => `[${produit}] l'entry '${entryPath}' doit faire 'export default { ... }' (un OBJET) — reçu : ${recu}`,
  'cli.entry-cle-ignoree': ({ cle }: MsgVars) => `entry.${cle} ignorée : gérée par le CLI/la config`,
  'cli.entry-setup-doit-etre-fonction': ({ produit, entryPath, recu }: MsgVars) => `[${produit}] l'entry '${entryPath}' : 'setup' doit être une fonction (app) => … , reçu : ${recu}`,
  'cli.entry-config-doublon': ({ champ, chemin }: MsgVars) => `${champ} défini à la fois dans l'entry et dans mjs.config.json (${chemin}) — l'entry prime`,
  // — cli/server-entry.ts (grammaire @import d'une entry serveur)
  'cli.entry-directive-interdite': ({ entryPath, directive }: MsgVars) => `'${entryPath}' : la directive ${directive} n'a pas de sens dans une entry serveur — seule @import est admise.`,
  'cli.entry-import-cycle': ({ entryPath, chaine }: MsgVars) => `'${entryPath}' : cycle d'import détecté entre fichiers d'entry serveur (${chaine}).`,
  'cli.entry-cache-non-sur': ({ dossier }: MsgVars) => `❌ [mjs] dossier de cache refusé : ${dossier}\n   Il doit être un dossier (pas un lien) qui vous appartient, fermé en écriture aux autres utilisateurs. Supprimez-le ou installez les dépendances du projet (node_modules) pour garder le cache dans le projet.`,
  'cli.entry-import-introuvable': ({ entryPath, cible }: MsgVars) => `'${entryPath}' : cible @import '${cible}' introuvable (ni à côté de l'entry, ni sous --root).`,
  'cli.entry-import-natif-interdit': ({ section, source }: MsgVars) => `'${section}' : import ES natif interdit dans une entry serveur (« import … from '${source}' ») — écrivez @import nom '${source}' en tête de fichier, comme dans un composant.`,
  'cli.entry-import-dynamique-interdit': ({ section }: MsgVars) => `'${section}' : import('…') d'un chemin littéral interdit dans une entry serveur — écrivez @import nom 'chemin' en tête de fichier ; import(variable) reste autorisé.`,
  'cli.entry-reexport-interdit': ({ section, source }: MsgVars) => `'${section}' : ré-export ES interdit dans une entry serveur (« export … from '${source}' ») — importez le nom avec @import puis exportez-le.`,
  'cli.transport-ws': "ws (bibliothèque 'ws')",
  'cli.transport-personnalise': "personnalisé (instance fournie par l'entry)",
  'cli.banniere-port': ({ port, hote }: MsgVars) => `écoute sur le port ${port}${hote}`,
  'cli.desactive': 'désactivé',
  'cli.banniere-heartbeat': ({ etat }: MsgVars) => `heartbeat ${etat}`,
  'cli.illimite': 'illimité',
  // hôte effectif affiché en bannière même par défaut (mjs ws)
  'cli.toutes-interfaces': 'toutes les interfaces',
  'cli.banniere-limites': ({ rate, burst, kickAfter, maxPayload, maxBuffered, maxConnections, maxConnectionsPerIp }: MsgVars) => `limites : rate=${rate}/s burst=${burst} kickAfter=${kickAfter} maxPayload=${maxPayload}o maxBuffered=${maxBuffered}o maxConnections=${maxConnections} maxConnectionsPerIp=${maxConnectionsPerIp}`,
  'cli.banniere-salons-proxy': ({ url }: MsgVars) => `salons (join) : proxy ${url}`,
  'cli.banniere-jeton': ({ sweep, marge }: MsgVars) => `jeton : balayage ${sweep}s (marge ${marge}s)`,
  'cli.banniere-pont': ({ host, port }: MsgVars) => `pont universel : http://${host}:${port}`,
  'cli.banniere-webhooks-actifs': ({ url, evenements }: MsgVars) => `webhooks → ${url} (événements : ${evenements})`,
  'cli.banniere-webhooks-desactives': 'webhooks désactivés (opts.bridge.webhooks absent)',
  'cli.banniere-rate-limit-actif': ({ capacite, fenetre, echecsCapacite, echecsFenetre }: MsgVars) => `limite de débit : ${capacite} req/${fenetre}s par IP (échecs de signature : ${echecsCapacite}/${echecsFenetre}s)`,
  'cli.banniere-rate-limit-desactive': 'limite de débit désactivée (opts.bridge.rateLimit === false)',
  'cli.banniere-nonce-exige': 'nonce anti-rejeu : exigé (en-tête x-mjs-ws-nonce sur chaque requête signée)',
  'cli.banniere-nonce-coupe': 'nonce anti-rejeu : coupé (opts.bridge.nonce === false)',
  'cli.banniere-etat': ({ host, port }: MsgVars) => `état : http://${host}:${port}/state`,
  'cli.banniere-reprise-session': ({ grace, maxBuffered, maxBytes }: MsgVars) => `reprise de session : ${grace} s (tampon ${maxBuffered} trame${Number(maxBuffered) > 1 ? 's' : ''} / ${maxBytes}o)`,
  'cli.banniere-multi-processus-redis': ({ redis, prefixe }: MsgVars) => `multi-processus : ${redis} (préfixe ${prefixe})`,
  'cli.banniere-multi-processus-custom': ({ prefixe }: MsgVars) => `multi-processus : adaptateur personnalisé fourni (préfixe ${prefixe})`,
  'cli.ctrl-c-arreter': 'Ctrl-C pour arrêter',
  'cli.arret-forcer-indice': '[mjs] arrêt en cours — Ctrl+C à nouveau pour couper tout de suite',
  'cli.ws.erreur-compilation-civet': ({ entryPath, erreur }: MsgVars) => `[mjs ws] erreur de compilation Civet dans '${entryPath}' : ${erreur}`,
  'cli.ws.entry-markup-composant': ({ entryPath, indice }: MsgVars) => `[mjs ws] '${entryPath}' contient du markup de composant (${indice}) — un fichier serveur '*.server.mjs' n'est pas un composant .mjs : pas de <template>/<style>/HTML, seulement du Civet/JS ('export default { setup(app) { … } }').`,
  'cli.ws.erreur-compilation': ({ entryPath, erreur }: MsgVars) => `[mjs ws] erreur de compilation dans '${entryPath}' : ${erreur}`,
  // --port hors plage — même règle que ws.port (bundler/config.ts)
  'cli.ws.port-hors-plage': ({ valeur }: MsgVars) => `[mjs ws] port ${valeur} hors plage — attendu un entier entre 1 et 65535 (même règle que ws.port dans mjs.config.json)`,
  // --port hors plage pour `mjs serveur` — MÊME règle que ws.port-hors-plage ci-dessus
  'cli.serveur.port-hors-plage': ({ valeur }: MsgVars) => `[mjs serveur] port ${valeur} hors plage — attendu un entier entre 1 et 65535 (même règle que serveur.port dans mjs.config.json)`,
  'cli.reload-import-echec': ({ erreur }: MsgVars) => `rechargement ignoré — import de l'entry en échec : ${erreur} (l'ancien serveur continue de tourner)`,
  'cli.reload-echec-generique': ({ erreur }: MsgVars) => `rechargement ignoré — ${erreur} (l'ancien serveur continue de tourner)`,
  'cli.redemarre': ({ chemin }: MsgVars) => `♻️  redémarré (${chemin})`,
  'cli.reload-echec-fatal': ({ erreur }: MsgVars) => `rechargement échoué après l'arrêt de l'ancien serveur — plus aucun serveur actif : ${erreur}`,
  'cli.reload-setup-echec': ({ erreur }: MsgVars) => `rechargement refusé — setup() de la nouvelle version a échoué, l'ancienne version reste en service : ${erreur}`,

  // — cli/server.ts (clés propres ; réutilise aussi les clés partagées ci-dessus)
  'cli.serveur.entry-introuvable': ({ raison, squelette }: MsgVars) => `[mjs serveur] ${raison}\n\nCréez un fichier d'entry pour démarrer, par exemple 'serveur.server.mjs' à la racine du projet (même dialecte que le <script> de vos composants ; l'app mjsServer() est construite par le CLI et passée à setup(app) — aucun import à écrire) :\n\n${squelette}\nPuis relancez 'mjs serveur' (ou précisez --entry <chemin>).`,
  'cli.serveur.anti-triche': ({ n, fenetre }: MsgVars) => `anti-triche : quota ${n} coup${Number(n) > 1 ? 's' : ''}/identité par ${fenetre}s (toutes parties confondues)`,

  // — cli/dev-lock.ts
  'cli.dev-lock.deja-actif': ({ pid }: MsgVars) => `❌ Un autre 'mjs dev' tourne déjà (PID ${pid}).`,
  'cli.dev-lock.lockfile-chemin': ({ chemin }: MsgVars) => `   Lockfile : ${chemin}`,
  'cli.dev-lock.pour-forcer': ({ pid }: MsgVars) => `   Pour forcer : 'kill ${pid}' (ou supprimez le lockfile s'il est obsolète).`,
  'cli.dev-lock.orphelin': ({ pid }: MsgVars) => `⚠️  Lockfile orphelin (PID ${pid} mort ou recyclé) — récupération.`,
  'cli.dev-lock.echec-acquisition': ({ chemin }: MsgVars) => `❌ Impossible d'acquérir le lock dev (${chemin}) — un autre processus vient de le reprendre.`,

  // — cli/dev-prerender.ts
  'cli.dev-prerender.echec': ({ erreur }: MsgVars) => `⚠️  Prérendu (dev) ignoré : ${erreur}`,

  // ═══ SIGILS (src/sigils.ts) ══════════════════════════════════════════════════════════════
  // — sigils.ts
  'sigils.vault-retire': ({ nom }: MsgVars) => `[ModularJS] « &$${nom} » : le sigil « &$ » (vault) a été retiré — utilisez « $$${nom} » (store global réactif, zéro import).`,
  'sigils.singleton-importe': ({ nom }: MsgVars) => `[ModularJS] « $$${nom} » : « ${nom} » est un singleton importé (@import µ$$${nom}) — consommez-le avec « µ$$${nom} », pas « $$${nom} » (qui désigne le store GLOBAL, un autre espace).`,

  // ═══ BUNDLER (src/bundler/) ════════════════════════════════════════════════════════════════════
  // — config.ts
  'bundler.config.runtime-paquet-non-implemente': ({ paquet }: MsgVars) => `[mjs.config.json] runtime : paquet '${paquet}' pas encore implémenté`,
  'bundler.config.vt-valeur-vide': 'valeur vide',
  'bundler.config.vt-valeur-malformee': ({ valeur }: MsgVars) => `valeur malformée '${valeur}'`,
  'bundler.config.vt-direction-dans-nom': ({ nom, avant }: MsgVars) => `la direction ne s'écrit plus dans le nom ('${nom}') — utilisez la clé 'direction'/'dir' en option (ex. ${avant}={ dir: left }).`,
  'bundler.config.vt-nom-invalide': ({ nom }: MsgVars) => `nom invalide '${nom}'`,
  'bundler.config.vt-option-malformee': ({ option }: MsgVars) => `option malformée '${option}' — attendu 'clé: valeur'`,
  'bundler.config.vt-option-cle-inconnue': ({ cle, hint, valides }: MsgVars) => `clé inconnue '${cle}'${hint} (clés valides : ${valides})`,
  'bundler.config.vt-cle-double': ({ cle, court }: MsgVars) => `clé en double '${cle}' — '${cle}' et '${court}' désignent la MÊME option, ne la posez qu'une fois`,
  'bundler.config.vt-direction-non-directionnelle': ({ base, bases }: MsgVars) => `clé 'direction' invalide sur la base '${base}' (non directionnelle) — bases directionnelles : ${bases}`,
  'bundler.config.vt-direction-invalide': ({ valeur, valides }: MsgVars) => `direction invalide '${valeur}' — valeurs valides : ${valides}`,
  'bundler.config.vt-duration-invalide': `duration : un nombre nu en millisecondes (comme setTimeout) — ex. dur: 600`,
  'bundler.config.vt-priority-invalide': ({ valeur }: MsgVars) => `priority invalide '${valeur}' — entier ≥ 0 attendu`,
  'bundler.config.doit-etre-objet-racine': ({ chemin }: MsgVars) => `[mjs.config.json] doit être un objet (${chemin})`,
  'bundler.config.env-vient-de-la-commande': ({ chemin }: MsgVars) => `[mjs.config.json] la clé 'env' n'existe pas : l'environnement du build vient de la COMMANDE.\n  \`mjs build\` construit en développement, \`mjs build --prod\` en production.\n  Retirez la clé de ${chemin}.`,
  'bundler.config.cle-inconnue-racine': ({ cle, chemin, valides }: MsgVars) => `[mjs.config.json] clé inconnue '${cle}' dans ${chemin}\n  Clés valides : ${valides}`,
  'bundler.config.valeur-invalide-simple': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] ${cle} invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.sigil-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] sigil invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.doit-etre-chaine': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être une chaîne, reçu : ${valeur} (${type})`,
  'bundler.config.manifestpath-extension-source': ({ valeur, extension }: MsgVars) => `[mjs.config.json] manifestPath ('${valeur}') porte l'extension d'un fichier source (${extension}) : le manifeste produit est du JavaScript, et chaque construction écraserait ce fichier. Donnez-lui un nom en .js (ex. public/modularjs/bundle.js) ; le manifeste que vous écrivez vous-même se déclare dans manifestExternal.`,
  'bundler.config.manifestpath-egal-externe': ({ valeur }: MsgVars) => `[mjs.config.json] manifestPath ('${valeur}') désigne le même fichier que manifestExternal : la construction le lirait comme manifeste externe, puis l'écraserait avec le manifeste produit. Donnez à manifestPath un autre chemin (ex. public/modularjs/bundle.js).`,
  'bundler.config.manifestpath-dans-sources': ({ valeur, sourceDir, outputDir }: MsgVars) => `[mjs.config.json] manifestPath ('${valeur}') est dans le dossier des sources (sourceDir : '${sourceDir}') alors que les fichiers produits vont ailleurs (outputDir : '${outputDir}') : chaque construction écrirait le manifeste au milieu de votre code, par-dessus un fichier du même nom. Placez-le à côté des fichiers produits (ex. '${outputDir}/bundle.js').`,
  // assetDirs : une liste de chemins de dossiers qui existent (relatifs au dossier de mjs.config.json)
  'bundler.config.asset-dirs-doit-etre-liste': ({ valeur, type }: MsgVars) => `[mjs.config.json] assetDirs doit être une liste de dossiers (par exemple ["app/assets/images"]), reçu : ${valeur} (${type})`,
  'bundler.config.asset-dirs-element-invalide': ({ index, valeur, type }: MsgVars) => `[mjs.config.json] assetDirs[${index}] doit être un chemin de dossier (une chaîne non vide), reçu : ${valeur} (${type})`,
  'bundler.config.asset-dirs-dossier-absent': ({ index, dossier, chemin }: MsgVars) => `[mjs.config.json] assetDirs[${index}] : le dossier '${dossier}' n'existe pas (cherché dans ${chemin}). Créez-le, ou retirez-le de la liste.`,
  'bundler.config.asset-dirs-pas-un-dossier': ({ index, dossier, chemin }: MsgVars) => `[mjs.config.json] assetDirs[${index}] : '${dossier}' n'est pas un dossier (${chemin}). Indiquez le dossier qui contient les images.`,
  // urlPrefix sans slash initial (chemin ambigu).
  'bundler.config.urlprefix-slash-initial-exige': ({ valeur }: MsgVars) => `[mjs.config.json] urlPrefix doit commencer par '/', reçu : ${valeur}`,
  'bundler.config.doit-etre-booleen': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être un booléen (true/false), reçu : ${valeur} (${type})`,
  'bundler.config.dev-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'dev' doit être un objet { port?, host?, allowedHosts? } (${chemin})`,
  'bundler.config.dev-cle-inconnue': ({ cle }: MsgVars) => `[mjs.config.json] dev.${cle} : clé inconnue (valides: port, host, allowedHosts)`,
  'bundler.config.dev-allowed-hosts-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] dev.allowedHosts : ${valeur} n'est pas accepté. Écrivez true pour accepter tous les noms, ou une liste de noms d'hôte, sans http:// ni port : ["abc.ngrok-free.app", ".exemple.fr"] (un nom qui commence par un point couvre ce domaine et ses sous-domaines).`,
  'bundler.config.dev-port-doit-etre-nombre': ({ valeur, type }: MsgVars) => `[mjs.config.json] dev.port doit être un nombre, reçu : ${valeur} (${type})`,
  'bundler.config.port-hors-plage': ({ cle, valeur }: MsgVars) => `[mjs.config.json] ${cle} doit être un entier entre 1 et 65535, reçu : ${valeur}`,
  'bundler.config.view-transition-invalide-generique': ({ valeur, bases, basesDir }: MsgVars) => `[mjs.config.json] viewTransition invalide : '${valeur}'\n  Valeur attendue : "none", une base (${bases}), éventuellement suivie d'options "base={ direction: …, duration: …, priority: … }" (direction réservée aux bases directionnelles : ${basesDir}) — aucun booléen accepté`,
  'bundler.config.view-transition-invalide-detail': ({ valeur, erreur }: MsgVars) => `[mjs.config.json] viewTransition invalide : '${valeur}' — ${erreur}`,
  'bundler.config.default-script-lang-conflit': ({ a, b }: MsgVars) => `[mjs.config.json] defaultScriptLang ('${a}') et languages.script ('${b}') diffèrent — gardez une seule des deux clés.`,
  'bundler.config.runtime-invalide-chaine': ({ valeur, modules }: MsgVars) => `[mjs.config.json] runtime invalide : '${valeur}'\n  Valeurs valides : 'all', 'core', ou un tableau de modules optionnels (${modules})`,
  'bundler.config.runtime-doit-etre-tableau': ({ valeur, type, chemin }: MsgVars) => `[mjs.config.json] runtime doit être 'all', 'core' ou un tableau de modules, reçu : ${valeur} (${type}) (${chemin})`,
  'bundler.config.runtime-module-doit-etre-chaine': ({ valeur, type }: MsgVars) => `[mjs.config.json] runtime[] : chaque module doit être une chaîne, reçu : ${valeur} (${type})`,
  'bundler.config.runtime-module-core': ({ module, modules }: MsgVars) => `[mjs.config.json] runtime : '${module}' fait déjà partie du CŒUR (toujours inclus) — ne le listez pas.\n  Modules optionnels valides : ${modules}`,
  'bundler.config.runtime-module-inconnu': ({ module, modules, presets }: MsgVars) => `[mjs.config.json] runtime : module inconnu '${module}'\n  Modules optionnels valides : ${modules} — ou un préréglage : ${presets}`,
  'bundler.config.runtime-module-remplace': ({ module, nouveau }: MsgVars) => `\n  '${module}' n'existe plus : son effet fait désormais partie de '${nouveau}'.`,
  'bundler.config.preload-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] preload invalide : '${valeur}'\n  Valeurs valides : ${valides} (ou un objet { view?, page? })`,
  'bundler.config.preload-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'preload' doit être une chaîne ou un objet { view?, page? } (${chemin})`,
  'bundler.config.preload-axes-renommes': `[mjs.config.json] preload : les axes « local »/« server » ont été renommés — écrivez « view » (préchargement du module de vue) et « page » (préchargement de la page serveur).`,
  'bundler.config.cle-inconnue': ({ cle, valides }: MsgVars) => `[mjs.config.json] ${cle} : clé inconnue\n  Clés valides : ${valides}`,
  'bundler.config.preload-axis-invalide': ({ axe, valeur, valides }: MsgVars) => `[mjs.config.json] preload.${axe} invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.css-mode-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] css invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.js-mode-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] js invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.js-bundle-exige-css-bundle': () => `[mjs.config.json] js: 'bundle' est incompatible avec css: 'split'/'lazy'.\n  Le mode fusionné regroupe TOUT (cœur, styles, animations, composants) dans un seul fichier — un CSS déjà découpé en fichiers séparés contredirait « un seul fichier JS ».\n  Correctif : retirez la clé css (défaut 'bundle') ou posez js: 'split'.`,
  'bundler.config.csp-incompatible-js-bundle': () => `[mjs.config.json] csp: true est incompatible avec js: 'bundle'.\n  Le mode strict exige un CSS DÉCOUPÉ (des <link> vers des feuilles séparées) ; le mode js fusionné exige au contraire un CSS FUSIONNÉ (css: 'bundle', un seul fichier JS) — aucune valeur de css ne peut satisfaire les deux à la fois.\n  Correctif : retirez csp (ou posez-le à false), ou repassez js à 'split'.`,
  'bundler.config.source-map-mode-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] sourceMap invalide : ${valeur}\n  Valeurs valides : ${valides}`,
  'bundler.config.types-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] "types" vaut "warn" (défaut : un avertissement dans la console) ou "error" (une erreur qui arrête l'écriture fautive), en développement seulement — reçu ${valeur}.`,
  'bundler.config.effects-objet': ({ valeur }: MsgVars) => `[mjs.config.json] "effects" est un objet : { "theme": "circle" | "none", "lite": "auto" | "on" | "off", "skeleton": ["await", "components"], "guard": true | false | { "delay": "1s" }, "rate": 4 } — reçu ${valeur}.`,
  'bundler.config.effects-cle': ({ cle, valides }: MsgVars) => `[mjs.config.json] "effects" : clé « ${cle} » inconnue — clés permises : ${valides}.`,
  'bundler.config.effects-liste': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] "effects.${cle}" est une liste — reçu ${valeur} ; mots permis : ${valides} ("skeleton": ["await", "components"] ; [] : aucun).`,
  'bundler.config.effects-element': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] "effects.${cle}" : « ${valeur} » — permis : ${valides}.`,
  'bundler.config.effects-valeur': ({ cle, valeur, valides }: MsgVars) => `[mjs.config.json] "effects.${cle}" vaut ${valides} — reçu ${valeur}.`,
  'bundler.config.effects-guard': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.guard" vaut true, false ou { "delay": "1s" } — reçu ${valeur}.`,
  'bundler.config.effects-guard-delay': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.guard.delay" est une durée : un nombre de millisecondes (800), ou "800ms", "1.5s" — reçu ${valeur}.`,
  'bundler.config.effects-guard-delay-trop-long': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.guard.delay" ne peut pas dépasser 24 h (86 400 000 ms). Donnez une durée plus courte, par exemple 1000, "1s" ou "800ms" — reçu ${valeur}.`,
  'bundler.config.effects-skeleton-i18n': () => `[mjs.config.json] "effects.skeleton" ne porte plus « i18n » : les barres des textes traduits se règlent par "i18n.placeholder" (*skeleton) et par le délai de secours "i18n.timeout" — retirez "i18n" de la liste.`,
  'bundler.config.render-max-body': ({ valeur }: MsgVars) => `[mjs.config.json] "render.maxBody" est la taille la plus grande du corps qu'une action du serveur de rendu accepte, en octets : un entier de 1024 (1 Ko) à 104857600 (100 Mo), 1048576 (1 Mo) par défaut — reçu ${valeur}.`,
  'bundler.config.effects-rate': ({ valeur }: MsgVars) => `[mjs.config.json] "effects.rate" est la part des effets en direct, en messages par seconde : un entier de 1 à 1000 (4 par défaut) — reçu ${valeur}.`,
  'bundler.config.csp-exige-css-decoupe': () => `[mjs.config.json] csp: true est incompatible avec css: 'bundle'.\n  Le mode strict remplace les <style> en ligne du rendu serveur par des <link> vers les feuilles émises, qui n'existent qu'en CSS découpé.\n  Correctif : posez css: 'split' (une feuille par module) ou css: 'lazy' (chargée à la demande).`,
  'bundler.config.lint-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'lint' doit être un objet, par exemple { "a11y": false, "maxStateVars": 60 } (${chemin})`,
  'bundler.config.lint-max-state-vars-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] lint.maxStateVars doit être un entier ≥ 0 (0 pour désactiver l'avertissement), reçu : ${valeur} (${type})`,
  'bundler.config.lint-empty-component-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] lint.emptyComponent doit valoir true, false ou "error" (erreur de build), reçu : ${valeur}`,
  'bundler.config.lint-type-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] lint.${cle} doit être un booléen (true/false), reçu : ${valeur} (${type})`,
  'bundler.config.log-level-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'logLevel' doit être une chaîne ou un objet { dev?, prod? } (${chemin})`,
  'bundler.config.log-level-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] logLevel invalide : '${valeur}'\n  Valeurs valides : ${valides} (ou un objet { dev?, prod? })`,
  'bundler.config.messages-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] messages invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.log-level-env-invalide': ({ env, valeur, valides }: MsgVars) => `[mjs.config.json] logLevel.${env} invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.ws-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'ws' doit être un objet { entry?, transport?, port?, host?, heartbeat?, limits?, resume?, bridge? } (${chemin})`,
  'bundler.config.cle-inconnue-hint': ({ cle, hint, valides }: MsgVars) => `[mjs.config.json] ${cle} : clé inconnue${hint}\n  Clés valides : ${valides}`,
  'bundler.config.transport-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] ${cle} invalide : ${valeur}${hint}\n  Valeurs valides : ${valides} (une instance MjsWsTransport maison se fournit depuis l'entry, pas la config)`,
  'bundler.config.codec-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] ${cle} invalide : ${valeur}${hint}\n  Valeurs valides : ${valides}`,
  'bundler.config.entier-positif-ms-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être un entier > 0 (ms), reçu : ${valeur} (${type})`,
  'bundler.config.limits-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] ${cle} doit être un objet { rate?, burst?, kickAfter?, maxPayload?, maxBuffered?, maxConnections?, maxConnectionsPerIp?, maxRoomsPerClient? } (${chemin})`,
  'bundler.config.limits-cle-invalide': ({ cle, suffixe, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être un entier > 0${suffixe}, reçu : ${valeur} (${type})`,
  'bundler.config.adapter-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] '${cle}' doit être un objet { redis, prefix?, antiEntropy? } (${chemin})`,
  'bundler.config.adapter-redis-requis': ({ cle }: MsgVars) => `[mjs.config.json] ${cle} est requis (chaîne non vide, ex. 'redis://127.0.0.1:6379')`,
  'bundler.config.chaine-non-vide-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être une chaîne non vide, reçu : ${valeur} (${type})`,
  'bundler.config.entier-ou-false-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être un entier > 0 (ms) ou false, reçu : ${valeur} (${type})`,
  'bundler.config.token-doit-etre-objet': ({ cle, valeur, type, chemin }: MsgVars) => `[mjs.config.json] '${cle}' doit être un objet { sweep?, slack? }, reçu : ${valeur} (${type}) (${chemin})`,
  'bundler.config.entier-positif-invalide': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être un entier > 0, reçu : ${valeur} (${type})`,
  'bundler.config.rate-by-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] ${cle} invalide : ${valeur}${hint}\n  Valeurs valides : ${valides}`,
  'bundler.config.ban-doit-etre': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être true, false ou un objet { after?, within?, duration?, by? }, reçu : ${valeur} (${type})`,
  'bundler.config.ban-by-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] ${cle} invalide : ${valeur}${hint}\n  Valeurs valides : ${valides}`,
  'bundler.config.resume-doit-etre-objet': ({ cle, valeur, type, chemin }: MsgVars) => `[mjs.config.json] ${cle} doit être true, false ou un objet { grace?, maxBuffered?, maxBytes? }, reçu : ${valeur} (${type}) (${chemin})`,
  'bundler.config.bridge-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] '${cle}' doit être un objet { port?, host?, secret?, webhooks?, rateLimit?, nonce? } (${chemin})`,
  'bundler.config.webhooks-doit-etre-objet': ({ cle, chemin }: MsgVars) => `[mjs.config.json] ${cle} doit être un objet { url, secret?, events, timeoutMs? } (${chemin})`,
  'bundler.config.webhooks-url-requis': ({ cle }: MsgVars) => `[mjs.config.json] ${cle} est requis (chaîne non vide)`,
  'bundler.config.webhooks-events-invalide': ({ cle }: MsgVars) => `[mjs.config.json] ${cle} doit être un tableau NON VIDE de chaînes (ex. ['connect', 'message:chat'])`,
  'bundler.config.doit-etre-booleen-simple': ({ cle, valeur, type }: MsgVars) => `[mjs.config.json] ${cle} doit être un booléen, reçu : ${valeur} (${type})`,
  'bundler.config.bundles-objet': ({ valeur }: MsgVars) => `[mjs.config.json] "bundles" est un objet : { "nom-du-groupe": ["composant-racine", …] } ou { "nom-du-groupe": { "roots": ["composant-racine", …], "except": ["composant-laissé-dehors", …] } } — reçu ${valeur}.`,
  'bundler.config.bundles-nom': ({ nom }: MsgVars) => `[mjs.config.json] bundles : le nom de groupe '${nom}' est invalide — il entre dans le nom du fichier émis : lettres minuscules, chiffres et tirets seulement, sans tiret en tête.`,
  'bundler.config.bundles-liste': ({ nom, valeur }: MsgVars) => `[mjs.config.json] bundles : le groupe '${nom}' attend une liste de composants racines (["composant", …]) ou un objet { "roots": [...], "except": [...] }, reçu : ${valeur}`,
  'bundler.config.bundles-vide': ({ nom }: MsgVars) => `[mjs.config.json] bundles : le groupe '${nom}' est vide — listez au moins un composant racine.`,
  'bundler.config.bundles-cle-inconnue': ({ nom, cle, valides }: MsgVars) => `[mjs.config.json] bundles : le groupe '${nom}' contient la clé inconnue '${cle}' — clés valides : ${valides}.`,
  'bundler.config.bundles-except': ({ nom, valeur }: MsgVars) => `[mjs.config.json] bundles : le groupe '${nom}' attend, dans "except", une liste de noms de composants (chaînes non vides), reçu : ${valeur}`,
  'bundler.config.bundles-element': ({ nom, valeur }: MsgVars) => `[mjs.config.json] bundles : le groupe '${nom}' ne liste que des noms de composants (chaînes non vides), reçu : ${valeur}`,
  'bundler.config.route-light-sans-effet-csr': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}'].light est sans effet sur une route 'csr' : le serveur n'y rend rien, la racine est montée par le client seul.`,
  'bundler.config.ratelimit-doit-etre-objet': ({ cle, valeur, type, chemin }: MsgVars) => `[mjs.config.json] ${cle} doit être 'false' ou un objet { perIp?, fails? }, reçu : ${valeur} (${type}) (${chemin})`,
  'bundler.config.ratelimit-tuple-invalide': ({ cle, valeur }: MsgVars) => `[mjs.config.json] ${cle} doit être un tableau [capacité, fenêtreMs] de 2 entiers > 0, reçu : ${valeur}`,
  'bundler.config.serveur-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'serveur' doit être un objet { entry?, transport?, port?, host?, heartbeat?, limits?, resume?, bridge?, antiCheat? } (${chemin})`,
  'bundler.config.session-exclusive-invalide': ({ cle, valeur, hint, valides }: MsgVars) => `[mjs.config.json] ${cle} invalide : ${valeur}${hint}\n  Valeurs valides : true, false, ${valides}`,
  'bundler.config.verify-origin-invalide': ({ cle, valeur }: MsgVars) => `[mjs.config.json] ${cle} doit être un tableau non vide de chaînes non vides, reçu : ${valeur}`,
  'bundler.config.antitriche-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'serveur.antiCheat' doit être un objet { movesPerIdentity?, codePerIp?, privateGamesPerCreator? } (${chemin})`,
  'bundler.config.moves-per-identity-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] serveur.antiCheat.movesPerIdentity doit être [n entier ≥ 1, fenêtreMs entier > 0] ou null, reçu : ${valeur}`,
  'bundler.config.code-per-ip-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] serveur.antiCheat.codePerIp doit être [n entier ≥ 1, fenêtreMs entier > 0] ou null, reçu : ${valeur}`,
  'bundler.config.private-games-per-creator-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] serveur.antiCheat.privateGamesPerCreator doit être un entier ≥ 1 ou null, reçu : ${valeur}`,
  'bundler.config.languages-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'languages' doit être un objet { script?, template? } (${chemin})`,
  'bundler.config.i18n-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'i18n' doit être un objet { default?, placeholder?, hash? } (${chemin})`,
  'bundler.config.i18n-default-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] i18n.default doit être une chaîne non vide (code langue), reçu : ${valeur}`,
  'bundler.config.i18n-timeout-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] "i18n.timeout" est une durée : un nombre de millisecondes (800), ou "800ms", "1.5s" (3 s par défaut) — reçu ${valeur}.`,
  'bundler.config.i18n-timeout-trop-long': ({ valeur }: MsgVars) => `[mjs.config.json] "i18n.timeout" ne peut pas dépasser 2147483647 ms (environ 24,8 jours), le plafond d'une minuterie : au-delà, le secours se déclencherait aussitôt au lieu d'attendre. Donnez une durée plus courte, par exemple 5000, "5s" ou "800ms" — reçu ${valeur}.`,
  'bundler.config.i18n-source-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] i18n.source doit être une chaîne non vide (code langue), reçu : ${valeur}`,
  'bundler.config.journal-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'journal' doit être un objet { server?, client?, viewer?, maxEntries?, maxBytes? } (${chemin})`,
  'bundler.config.journal-trust-proxy-invalide': ({ chemin, erreur }: MsgVars) => `[mjs.config.json] journal.trustProxy invalide dans ${chemin} : ${erreur}`,
  'bundler.config.journal-viewer-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] journal.viewer doit être un booléen ou une chaîne non vide (jeton), reçu : ${valeur} (${type})`,
  'bundler.config.booleen-defaut-invalide': ({ cle, defaut, valeur }: MsgVars) => `[mjs.config.json] ${cle} doit être un booléen (défaut ${defaut}), reçu : ${valeur}`,
  'bundler.config.forward-origin-vide': `[mjs.config.json] render.forwardOrigin (origine) ne peut pas être une chaîne vide — attendu une URL d'origine, ex. 'https://exemple.com'`,
  'bundler.config.forward-origin-url-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin doit être une URL d'origine valide (ex. 'https://exemple.com'), reçu : ${valeur}`,
  'bundler.config.forward-origin-cle-inconnue': ({ cle }: MsgVars) => `[mjs.config.json] ${cle} : clé inconnue\n  Clé valide : trustedHosts`,
  'bundler.config.trusted-hosts-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts doit être un tableau non vide de noms d'hôte (chaînes), reçu : ${valeur}`,
  'bundler.config.trusted-host-item-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[] : chaque hôte doit être une chaîne non vide, reçu : ${valeur} (${type})`,
  'bundler.config.forward-origin-trusted-host-invalide': ({ index, valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[${index}] : ${valeur} — attendu un nom d'hôte nu, sans port, sans crochets, sans chemin ; une IPv4 mappée s'écrit en hexadécimal (\`::ffff:102:304\`), jamais en pointé (\`::ffff:1.2.3.4\`)`,
  'bundler.config.forward-origin-trusted-host-non-canonique': ({ index, valeur, canonique }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[${index}] : ${valeur} n'est pas la forme canonique de cet hôte — écrire "${canonique}" (c'est cette forme, normalisée, que le serveur compare à l'en-tête Host)`,
  // avertissement NON bloquant (pas un throw) : un hôte
  // ACCEPTÉ (regex + forme canonique) mais désignant une cible interne reste listé, le build
  // continue — cf. `validateForwardOrigin`, bundler/config.ts.
  'bundler.config.forward-origin-trusted-host-interne': ({ index, valeur }: MsgVars) => `[mjs.config.json] render.forwardOrigin.trustedHosts[${index}] : ${valeur} est un hôte interne (loopback, réseau privé, lien-local, métadonnées) — listé ici mais toujours bloqué à l'exécution par la défense en profondeur du forwarding : cette entrée n'activera jamais rien`,
  'bundler.config.forward-origin-type-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.forwardOrigin doit être un booléen, une origine (chaîne, ex. 'https://exemple.com') ou { trustedHosts: string[] }, reçu : ${valeur} (${type})`,
  'bundler.config.render-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] 'render' doit être un objet (${chemin})`,
  'bundler.config.doit-etre-chaine-simple': ({ cle, chemin }: MsgVars) => `[mjs.config.json] ${cle} doit être une chaîne (${chemin})`,
  'bundler.config.render-outdir-hors-projet': ({ valeur, chemin }: MsgVars) => `[mjs.config.json] render.outDir doit rester dans le dossier du projet (${chemin}) — le prérendu y écrit ses fragments ET en retire les périmés ; reçu : '${valeur}'`,
  'bundler.config.render-target-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] render.target doit être une chaîne non vide (sélecteur CSS du contenant), reçu : ${valeur}`,
  'bundler.config.render-cache-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] render.cache invalide : '${valeur}'\n  Valeurs valides : ${valides}`,
  'bundler.config.startup-bundle-avec-js-bundle': () => `[mjs.config.json] render.startup: 'bundle' et js: 'bundle' ensemble : incompatibles.\n  js: 'bundle' livre déjà TOUT le projet dans un fichier unique — un fichier de page n'aurait rien à assembler.\n  Gardez l'un des deux : js: 'split' (défaut) avec render.startup: 'bundle', ou js: 'bundle' avec render.startup: 'preload'.`,
  'bundler.config.startup-slug-collision': ({ slug, urls }: MsgVars) => `[mjs.config.json] render.startup: 'bundle' — ces routes donnent le même nom de fichier de page (mjs_page-${slug}) : ${urls}\n  Le nom vient de l'URL (tout ce qui n'est pas une lettre ou un chiffre devient un tiret) : une seule des deux garderait son fichier.\n  Changez l'une des URLs, ou posez "startup": "preload" sur l'une d'elles.`,
  'bundler.config.render-routes-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.routes doit être un objet { "<url>": { component, mode? } } (${chemin})`,
  'bundler.config.route-doit-etre-objet': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}'] doit être un objet { component, mode? }`,
  'bundler.config.route-hors-dossier': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}'] : cette adresse sortirait du dossier du prérendu (segment « .. », barre inverse « \\ » ou chemin absolu) — écrivez une adresse qui commence par « / », faite de segments ordinaires (ex. « /blog/article »)`,
  'bundler.config.route-component-requis': ({ url }: MsgVars) => `[mjs.config.json] render.routes['${url}'].component (nom du composant) est requis`,
  'bundler.config.locales-invalide': ({ valeur, type, chemin }: MsgVars) => `[mjs.config.json] render.locales doit être un tableau de langues (chaînes), reçu : ${valeur} (${type}) (${chemin})`,
  'bundler.config.locale-item-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.locales[] : chaque langue doit être une chaîne non vide, reçu : ${valeur} (${type})`,
  'bundler.config.locale-hors-dossier': ({ valeur }: MsgVars) => `[mjs.config.json] render.locales : la langue '${valeur}' sortirait du dossier du prérendu (segment « .. », barre inverse « \\ » ou chemin absolu) — écrivez un code de langue (ex. « fr », « en-US »)`,
  'bundler.config.render-engine-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.engine doit être un objet { prerender?, request? } (${chemin})`,
  'bundler.config.browserpool-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.browserPool doit être un objet { size?, keepAlive?, maxAgeMs?, renderTimeoutMs? } (${chemin})`,
  'bundler.config.browserpool-size-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.browserPool.size doit être un entier ≥ 1, reçu : ${valeur} (${type})`,
  'bundler.config.browserpool-maxagems-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.browserPool.maxAgeMs doit être un entier ≥ 0, reçu : ${valeur} (${type})`,
  'bundler.config.browserpool-rendertimeoutms-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.browserPool.renderTimeoutMs doit être un entier ≥ 1, reçu : ${valeur} (${type})`,
  'bundler.config.renderqueue-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] render.renderQueue doit être un objet { concurrency?, maxQueue? } (${chemin})`,
  'bundler.config.renderqueue-concurrency-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.renderQueue.concurrency doit être un entier ≥ 1, reçu : ${valeur} (${type})`,
  'bundler.config.renderqueue-maxqueue-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.renderQueue.maxQueue doit être un entier ≥ 0, reçu : ${valeur} (${type})`,
  'bundler.config.image-doit-etre-objet': ({ chemin }: MsgVars) => `[mjs.config.json] image doit être un objet { widths?, formats?, quality? } (${chemin})`,
  'bundler.config.image-widths-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] image.widths doit être une liste non vide d'entiers ≥ 1, reçu : ${valeur}`,
  'bundler.config.image-widths-doublon': ({ valeur, largeur }: MsgVars) => `[mjs.config.json] image.widths cite deux fois la largeur ${largeur}, reçu : ${valeur} — écrivez chaque largeur une seule fois`,
  'bundler.config.image-widths-trop-grande': ({ valeur, largeur, max }: MsgVars) => `[mjs.config.json] image.widths : la largeur ${largeur} dépasse ${max} pixels, reçu : ${valeur} — écrivez des largeurs d'écran (ex. [480, 960, 1920])`,
  'bundler.config.image-formats-invalide': ({ valeur, valides }: MsgVars) => `[mjs.config.json] image.formats doit être une liste non vide parmi ${valides}, reçu : ${valeur}`,
  'bundler.config.image-quality-invalide': ({ valeur }: MsgVars) => `[mjs.config.json] image.quality doit être un entier de 1 à 100, reçu : ${valeur}`,
  'bundler.config.suggestion-hint': ({ suggestion }: MsgVars) => ` — vouliez-vous dire '${suggestion}' ?`,
  'bundler.config.limite-nullable-suffixe': ' (ou null = illimité)',
  'bundler.config.allowed-origins-invalide': ({ valeur, type }: MsgVars) => `[mjs.config.json] render.allowedOrigins doit être un tableau de chaînes (ou false), reçu : ${valeur} (${type})`,
  'bundler.config.allowed-origins-item-invalide': ({ index, valeur, type }: MsgVars) => `[mjs.config.json] render.allowedOrigins[${index}] doit être une chaîne non vide, reçu : ${valeur} (${type})`,
  'bundler.config.parse-error': ({ chemin, erreur }: MsgVars) => `[mjs.config.json] erreur de syntaxe JSON dans ${chemin} : ${erreur}`,
  // — index.ts
  'bundler.index.collision-basename-tag': ({ cle, prev, fichier }: MsgVars) => `[bundler] Collision de basename : '${cle}' est publié à la fois par ${prev} ET ${fichier} (tag <mjs-${cle}>). L'autoloader ne pourra résoudre qu'un seul des deux composants (le dernier compilé) — l'autre restera inerte, silencieusement. Renommez l'un des fichiers.`,
  'bundler.index.erreur-fichier': ({ fichier, raison }: MsgVars) => `[bundler] ${fichier}: ${raison}`,
  // repêchage réussi : l'ancien fichier hashé du composant en échec est
  // toujours servi, aucune coupure pour l'utilisateur (juste une version figée).
  'bundler.index.composant-echec-ancienne-version': ({ nom, fichier }: MsgVars) => `[bundler] ${nom} : compilation en échec — l'ancienne version (${fichier}) reste servie.`,
  'bundler.index.composant-echec-non-repeche': ({ nom }: MsgVars) => `[bundler] ${nom} : compilation en échec — le build échoue sans rien publier, le site déjà construit reste servi tel quel ; corrigez le composant, ou lancez \`mjs dev\`, qui garde sa version précédente le temps de le corriger.`,
  'bundler.index.composant-echec-reprise-impossible': ({ nom, fichier }: MsgVars) => `[bundler] ${nom} : compilation en échec — l'ancienne version (${fichier}) n'est plus servie : elle importe un fichier que ce build remplace (le cœur, un module…). Corrigez le composant pour le retrouver.`,
  'bundler.index.animation-inconnue': ({ nom, dossier }: MsgVars) => `[bundler] Animation inconnue : '${nom}' référencée via @transition/@in/@out mais absente de ${dossier} (typo ?). Le composant qui l'utilise échouera SILENCIEUSEMENT à l'exécution ('µ.anim.${nom}' est undefined).`,
  'bundler.index.animation-inconnue-lieu': ({ lieux, suggestion }: MsgVars) => ` Écrite dans ${lieux}.${suggestion}`,
  'bundler.index.transition-inconnue': ({ nom }: MsgVars) => `[ModularJS] *${nom} : transition inconnue — ni un effet de la bibliothèque, ni un effet de votre projet, ni une animation créée par µanim.create.`,
  'bundler.index.transition-inconnue-creer': ({ nom }: MsgVars) => ` Pour la créer : *${nom} = *fade(…) dans un fichier *.effects.mjs de votre projet, ou µanim.create '${nom}', … (µanim.crossfade 'base' pour la paire baseSend et baseReceive) dans un <script>, écrit tel quel avec le nom entre guillemets : la construction ne lit ni un nom calculé, ni un appel fait par une variable (a = µ.anim) ou une déstructuration ({ create } = µ.anim).`,
  'bundler.index.collision-basename-module': ({ nom, precedent, fichier }: MsgVars) => `[bundler] Collision de basename : '${nom}' présent dans ${precedent} ET ${fichier}. Les deux modules compilent vers le même fichier → écrasement + import 404 dans le .mjs qui référence le perdant. Renommez l'un des fichiers.`,
  'bundler.index.runtime-module-inconnu-ignore': ({ module, modules }: MsgVars) => `[bundler] runtime : module inconnu '${module}' ignoré (optionnels : ${modules})`,
  'bundler.index.runtime-repere-laisses': ({ gardes, laisses, liste }: MsgVars) => `[bundler] runtime : sans clé "runtime", le cœur ne prend que les modules optionnels dont le projet se sert — gardés : ${gardes} ; laissés de côté : ${laisses}. Une page servie hors construction (vue serveur, HTML statique, script de la page) ou un serveur temps réel qui parle à la page peut réclamer un module que le code de la page ne montre pas : écrivez dans mjs.config.json la liste complète des modules voulus, ceux gardés ici (${liste}) et ceux qu'il faut en plus, ou "runtime": "all".`,
  // un module gardé qui ne s'écrit dans une liste que par le préréglage du même nom, qui en emmène d'autres : aucune liste à coller
  'bundler.index.runtime-repere-sans-liste': ({ gardes, laisses, prereglages, nb, emmenes }: MsgVars) => `[bundler] runtime : sans clé "runtime", le cœur ne prend que les modules optionnels dont le projet se sert — gardés : ${gardes} ; laissés de côté : ${laisses}. Aucune liste à coller : écrit${Number(nb) > 1 ? 's' : ''} dans une liste, ${prereglages} ${Number(nb) > 1 ? 'sont les préréglages' : 'est le préréglage'} du même nom, qui emmène${Number(nb) > 1 ? 'nt' : ''} aussi ${emmenes} ; si une page servie hors construction ou un serveur temps réel qui parle à la page réclame un module de plus, écrivez la liste vous-même, avec ${emmenes}, ou "runtime": "all", sinon gardez le défaut sans clé.`,
  // rien de gardé : aucune liste à coller (`"runtime": []` écrit serait un cœur nu, sans les outils de développement)
  'bundler.index.runtime-repere-rien-garde': ({ laisses }: MsgVars) => `[bundler] runtime : sans clé "runtime", le cœur ne prend que les modules optionnels dont le projet se sert — gardés : aucun ; laissés de côté : ${laisses}. Une page servie hors construction (vue serveur, HTML statique, script de la page) ou un serveur temps réel qui parle à la page peut réclamer un module que le code de la page ne montre pas : écrivez dans mjs.config.json la liste des modules qu'il lui faut ("runtime": [ … ]), ou "runtime": "all".`,
  // un accès à µ que le relevé ne sait pas résoudre : tout est gardé, `lieux` = fichier:ligne
  'bundler.index.runtime-repere-acces-opaque': ({ lieux }: MsgVars) => `[bundler] runtime : sans clé "runtime", le cœur garde tous les modules optionnels, comme "runtime": "all" : µ est lu par un accès d'où la construction ne peut pas tirer le nom d'un module (indice calculé comme µ[nom], déstructuration comme { ajax } = µ, µ passé à une fonction ou rangé dans une variable), dans ${lieux}. Pour n'embarquer que les modules dont le projet se sert, écrivez le nom après le point (µ.modal.fire, µ.ajax), ou la liste des modules voulus dans mjs.config.json ("runtime": [ … ]).`,
  // schema gardé par le seul `µ.ajax` lu en entier, `lieux` = fichier:ligne
  'bundler.index.runtime-repere-ajax-entier': ({ lieux }: MsgVars) => `[bundler] runtime : sans clé "runtime", schema est gardé avec ajax : µ.ajax est lu en entier (rangé dans une variable, décomposé comme { binary } = µ.ajax, ou passé à une fonction), dans ${lieux}, et sa méthode binary décode la réponse avec le codec de schema. Si le projet n'appelle pas binary, écrivez la méthode après le point (µ.ajax.get, µ.ajax.post) : schema reste de côté.`,
  'bundler.index.runtime-hint-ujs': `[bundler] runtime : 'ujs' intercepte les liens vers µ.Router, absent de votre sélection — l'interception restera inerte. Ajoutez 'router' (et 'ajax' pour le préchargement) pour la nav SPA.`,
  'bundler.index.runtime-hint-game': `[bundler] runtime : 'game' ajoute sock.game() à µ.socket, absent de votre sélection — sock.game restera indéfini. Ajoutez 'socket'.`,
  'bundler.index.runtime-hint-chat': `[bundler] runtime : 'chat' ajoute sock.chat() à µ.socket, absent de votre sélection — sock.chat restera indéfini. Ajoutez 'socket'.`,
  'bundler.index.runtime-hint-accounts': `[bundler] runtime : 'accounts' ajoute sock.account à µ.socket, absent de votre sélection — sock.account restera indéfini. Ajoutez 'socket'.`,
  'bundler.index.runtime-hint-lobby': `[bundler] runtime : 'lobby' ajoute sock.lobby() à µ.socket, absent de votre sélection — sock.lobby restera indéfini. Ajoutez 'socket'.`,
  'bundler.index.runtime-hint-schema': `[bundler] runtime : 'schema' ajoute le binaire à schéma à µ.socket, absent de votre sélection — µ.schema() reste utilisable (registre pur) mais jamais branché au réseau. Ajoutez 'socket'.`,
  'bundler.index.runtime-hint-optimistic': `[bundler] runtime : 'optimistic' s'utilise typiquement avec sock.request(), 'socket' absent de votre sélection — µ.optimistic() reste utilisable seul (ex. via: -> fetch(...)) mais jamais avec sock.request. Ajoutez 'socket' si besoin.`,
  'bundler.index.runtime-hint-interp': `[bundler] runtime : 'interp' interpole les parties de sock.game(), 'game' absent de votre sélection — µ.interp() n'aura aucune partie à observer. Ajoutez 'game'.`,
  'bundler.index.runtime-hint-predict': `[bundler] runtime : 'predict' prédit/réconcilie les intentions de sock.game(), 'game' absent de votre sélection — µ.predict() n'aura aucune partie à piloter. Ajoutez 'game'.`,
  'bundler.index.runtime-hint-lockstep-game': `[bundler] runtime : 'lockstep' pilote les parties de sock.game(), 'game' absent de votre sélection — µ.lockstep() n'aura aucune partie à piloter. Ajoutez 'game'.`,
  'bundler.index.runtime-hint-lockstep-det': `[bundler] runtime : 'lockstep' utilise µ.random (graine déterministe) pour rejouer le journal, 'det' absent de votre sélection — µ.lockstep restera indéfini. Ajoutez 'det'.`,
  'bundler.index.runtime-sans-i18n-liste': ({ liste }: MsgVars) => `[bundler] runtime : votre application traduit des textes (µt ou @i18n), mais 'i18n' est absent de votre sélection — µ.t resterait indéfini et le rendu planterait au premier texte traduit. Ajoutez 'i18n' dans votre mjs.config.json : "runtime": ${liste}`,
  'bundler.index.runtime-sans-i18n-core': `[bundler] runtime : votre application traduit des textes (µt ou @i18n), mais "runtime": "core" n'embarque pas la traduction — µ.t resterait indéfini et le rendu planterait au premier texte traduit. Écrivez dans votre mjs.config.json : "runtime": ["i18n"]`,
  'bundler.index.runtime-introuvable': ({ manquants, total, dossier, liste }: MsgVars) => `[bundler] Runtime introuvable : ${manquants}/${total} fichier(s) manquant(s) dans '${dossier}' (${liste}). Vérifiez 'runtimeDir' dans mjs.config.json ou l'installation de ModularJS.`,
  'bundler.index.contrat-coeur-rompu': ({ manquants, modules, core }: MsgVars) => {
    const noms      = String(manquants).split(', ')
    const publiques = noms.filter(n => n.startsWith('µ.'))
    const internes  = noms.filter(n => !n.startsWith('µ.'))
    const lignes    = [`[bundler] Cœur incomplet — build REFUSÉ : le mjs_core.js produit (${modules} modules assemblés) ne contient pas ce que vos composants appellent : ${manquants}.`]
    if (publiques.length > 0) {
      // µ.Store est une classe, µ.Ticker un objet, les autres des fonctions : chacun nommé pour ce qu'il est, avec l'erreur de sa première vue
      const nature = (n: string) => n === 'µ.Store' ? `la classe ${n}` : n === 'µ.Ticker' ? `l'objet ${n}` : `la fonction ${n}`
      const erreur = (n: string) => n === 'µ.Store' ? `« ${n} is not a constructor »` : n === 'µ.Ticker' ? `« Cannot read properties of undefined »` : `« ${n} is not a function »`
      const mods   = publiques.map(n => `'${n.slice(2).toLowerCase()}'`).join(', ')
      const liste  = publiques.map(n => `${nature(n)} (module '${n.slice(2).toLowerCase()}')`).join(', ')
      const plus   = publiques.length > 1
      lignes.push(`Le cœur produit ne contient pas ${liste} : à l'exécution, la première vue qui s'en sert s'arrêterait sur ${publiques.map(erreur).join(', ')}. Deux causes, dans cet ordre : ${core ? `soit 'runtime' (mjs.config.json) vaut "core", qui ${plus ? 'ne les embarque pas' : "ne l'embarque pas"} — écrivez "runtime": [${publiques.map(n => `"${n.slice(2).toLowerCase()}"`).join(', ')}] ;` : `soit 'runtime' (mjs.config.json) retire ${plus ? 'ces modules' : 'ce module'} — nommez ${mods} dans le tableau ;`} soit le relevé des modules ne reconnaît plus ${plus ? 'ces usages' : 'cet usage'}, et c'est un bogue du framework : signalez-le.`)
    }
    if (internes.length > 0) lignes.push(`${internes.length > 1 ? 'Symboles internes' : 'Symbole interne'} : ${internes.join(', ')} — à l'exécution, chacun donnerait « this.<nom> is not a function » sur la première vue qui s'en sert. Deux causes, dans cet ordre : ${core ? 'soit \'runtime\' (mjs.config.json) vaut "core", qui n\'embarque pas un module dont vous vous servez — remplacez "core" par la liste des modules qu\'il vous faut ;' : 'soit \'runtime\' (mjs.config.json) retire un module dont vous vous servez — nommez-le dans le tableau ;'} soit le compilateur émet un nom que la détection ne reconnaît plus, et c'est un bogue du framework : signalez-le.`)
    return lignes.join('\n')
  },
  'bundler.index.outil-effet-absent': ({ liste }: MsgVars) => `[bundler] Outil d'effet absent — build REFUSÉ : ${liste}.\nChaque outil ci-dessus (src/runtime/mjs_fx_tool*.ts) est nommé dans le code des modules cités entre parenthèses, et ce build ne l'embarque pas : à l'exécution, l'appel donnerait « is not a function » à la première pose de l'effet — sauf la garde de cadence (fx_toolgauge), qui manquerait sans bruit : un effet lourd se poserait sans qu'aucune cadence soit mesurée.\nC'est un bogue du framework (la liste des outils de bundler/fx-tools.ts, ou le tri des sections de l'effet) : signalez-le.`,
  'bundler.index.cycle-import-detecte': ({ chaine }: MsgVars) => `[bundler] Cycle @import/µasset détecté : ${chaine}. Un module ne peut pas s'importer lui-même, directement ou indirectement.`,
  'bundler.index.cycle-import-js-copies': ({ chaine }: MsgVars) => `[bundler] Cycle d'import entre fichiers .js copiés : ${chaine}. Un fichier publié sous empreinte ne peut pas importer un fichier qui l'importe à son tour.`,
  'bundler.index.dep-jamais-resolue': ({ unite, deps }: MsgVars) => `[bundler] '${unite}' : émission impossible — dépendance jamais résolue (${deps}). La dépendance a probablement échoué à compiler ailleurs ; corrigez-la d'abord.`,
  'bundler.index.repere-jamais-resolu-manifeste': ({ cle }: MsgVars) => `[bundler] '${cle}' : repère interne jamais résolu dans le manifeste — l'entrée est retirée plutôt que publiée cassée. Signalez ce cas, c'est un bogue du bundler.`,
  'bundler.index.repere-non-resolu-emission': ({ unite }: MsgVars) => `[bundler] '${unite}' : repère interne encore présent après résolution de ses dépendances — écriture refusée. Signalez ce cas, c'est un bogue du bundler.`,
  'bundler.index.repere-non-resolu-ecriture': ({ fichier }: MsgVars) => `[bundler] '${fichier}' : écriture refusée — contient encore un repère interne non résolu. Signalez ce cas, c'est un bogue du bundler.`,
  'bundler.index.js-bundle-module-virtuel-introuvable': ({ specificateur }: MsgVars) => `[bundler] js: 'bundle' — spécificateur virtuel '${specificateur}' sans contenu en mémoire. Signalez ce cas, c'est un bogue du bundler.`,
  'bundler.index.js-bundle-echec': ({ raison }: MsgVars) => `[bundler] js: 'bundle' — l'assemblage en un seul fichier a échoué : ${raison}`,
  'bundler.startup.echec': ({ page, raison }: MsgVars) => `[bundler] démarrage de '${page}' — l'assemblage du fichier de page a échoué : ${raison}`,
  'bundler.startup.recompile-empreintes': ({ fichier }: MsgVars) => `[bundler] le dossier de sortie a été recompilé avec d'autres empreintes — des sources ont changé pendant le build ('${fichier}' n'existe plus) ; relancez le build.`,
  'bundler.startup.fichier-de-page': ({ page, fichier, nb }: MsgVars) => `   ✓ ${page} → ${fichier} (${nb} composant${Number(nb) > 1 ? 's' : ''} assemblé${Number(nb) > 1 ? 's' : ''})`,
  'bundler.startup.bundle-hors-production': () => `   ℹ️  render.startup: 'bundle' — construction de développement : préchargement seul, le fichier de page n'est assemblé qu'en \`--prod\`.`,
  'bundler.groupes.racine-inconnue': ({ groupe, racine }: MsgVars) => `[bundler] groupe '${groupe}' (bundles) : '${racine}' n'est pas un composant du projet — indiquez le nom d'un fichier .mjs, sans extension (un module .civet/.coffee ne peut pas être racine).`,
  // un composant ne peut appartenir qu'à un seul groupe : l'erreur relève TOUS les composants fautifs d'un coup (une ligne chacun,
  // avec ses groupes), puis ce qu'il faut écrire : la ligne "except" à ajouter aux groupes qui n'en ont pas, la liste complétée de
  // ceux qui en ont déjà un, la consigne d'une racine à part, un mot sur la forme objet si un groupe à modifier est écrit en liste.
  // Les lignes après la première portent trois espaces : la CLI imprime la première après un retrait de trois colonnes
  'bundler.groupes.plusieurs-groupes': ({ nb, composants }: MsgVars) => `[bundler] ✗ ${Number(nb) > 1 ? `${nb} composants sont` : '1 composant est'} dans plusieurs groupes : ${composants}`,
  'bundler.groupes.plusieurs-groupes-ligne': ({ composant, nb, groupes }: MsgVars) => `   ${composant} : ${nb} groupes : ${groupes}`,
  'bundler.groupes.plusieurs-groupes-conseil': ({ nb, nbGroupes, groupes, except }: MsgVars) => `   Pour ${Number(nb) > 1 ? 'les' : 'le'} sortir de ces groupes, ajoutez à ${Number(nbGroupes) > 1 ? 'chacun de ces groupes' : 'ce groupe'} (${groupes}) :\n   "except": [${except}]`,
  'bundler.groupes.plusieurs-groupes-existant': () => `   Un groupe qui a déjà un "except" le complète, sans en ajouter un second qui remplacerait le premier :`,
  'bundler.groupes.plusieurs-groupes-existant-ligne': ({ groupe, except }: MsgVars) => `   ${groupe} : "except": [${except}]`,
  'bundler.groupes.plusieurs-groupes-forme-liste': () => `   Un groupe écrit en liste, ["racine"], devient { "roots": ["racine"], "except": [...] }.`,
  'bundler.groupes.plusieurs-groupes-racine': ({ composant, racines, nbRacines, autres, nbAutres }: MsgVars) => {
    if (Number(nbRacines) > 1) return `   ${composant} est racine des groupes ${racines} : une racine ne peut pas être laissée dehors par "except". Gardez-le racine d'un seul de ces groupes (ou réunissez-les) ; dans chacun des autres, retirez-le de "roots" et ajoutez-le à "except".${Number(nbAutres) > 0 ? ` Ajoutez-le aussi à "except" ${Number(nbAutres) > 1 ? `des groupes (${autres})` : `du groupe ${autres}`}.` : ''}`
    return `   ${composant} est racine du groupe ${racines}, où il reste : ajoutez-le à "except" ${Number(nbAutres) > 1 ? `des autres groupes (${autres})` : `du groupe ${autres}`} seulement.`
  },
  'bundler.groupes.utilise-hors-groupe': ({ composant, groupe, appelants }: MsgVars) => `[bundles] '${composant}' est dans le groupe '${groupe}' mais aussi utilisé hors du groupe (${appelants}) : il reste dans le groupe, et toute page qui l'utilise charge tout le groupe — ajoutez-le à "except" du groupe '${groupe}' (forme { "roots": [...], "except": ["${composant}"] }) pour le laisser en fichier séparé, sortez-le du groupe, ou assumez ce chargement.`,
  'bundler.groupes.except-inconnu': ({ groupe, composant }: MsgVars) => `[bundler] groupe '${groupe}' (bundles) : '${composant}', listé dans "except", n'est pas un composant du projet — indiquez le nom d'un fichier .mjs, sans extension (un module .civet/.coffee n'est jamais dans un groupe, il n'a rien à y laisser dehors).`,
  'bundler.groupes.except-racine': ({ groupe, composant }: MsgVars) => `[bundler] groupe '${groupe}' (bundles) : '${composant}' est une racine du groupe et figure aussi dans "except" — une racine ne peut pas être laissée dehors : retirez-la de "except", ou de "roots" si vous ne voulez pas la regrouper.`,
  'bundler.groupes.fichier-de-groupe': ({ groupe, fichier, nb }: MsgVars) => `   ✓ groupe ${groupe} → ${fichier} (${nb} composant${Number(nb) > 1 ? 's' : ''} assemblé${Number(nb) > 1 ? 's' : ''})`,
  'bundler.groupes.hors-production': () => `   ℹ️  bundles — construction de développement : aucun regroupement, les groupes ne sont assemblés qu'en \`--prod\`.`,
  'bundler.groupes.fichier-unique': () => `   ℹ️  bundles — js: 'bundle' : le fichier unique livre déjà tout le projet, aucun groupe n'est assemblé.`,
  'bundler.groupes.echec': ({ groupe, raison }: MsgVars) => `[bundler] groupe '${groupe}' — l'assemblage du fichier de groupe a échoué : ${raison}`,
  'bundler.startup.fichier-unique': () => `   ℹ️  js: 'bundle' — le fichier unique porte déjà le cœur et tous les composants : aucun en-tête de démarrage dans les fragments.`,
  'bundler.index.compilation-bloquee': ({ fichier, timeout, chaine }: MsgVars) => `[bundler] Compilation de '${fichier}' bloquée depuis ${timeout}ms en attente d'une compilation déjà en vol — probable dépendance circulaire entre modules TOUS DEUX top-level (chacun attend l'autre via @import/µasset). Chaîne actuelle : ${chaine}.`,
  'bundler.index.erreur-fichier-detail': ({ fichier, detail }: MsgVars) => `[bundler] ${fichier} : ${detail}`,
  'bundler.transpile-msg.effet-ligne': ({ ligne }: MsgVars) => ` (ligne ${ligne})`,
  'bundler.transpile-msg.effet-lignes': ({ lignes }: MsgVars) => ` (lignes ${lignes})`,
  'bundler.index.voisin-js-absent': ({ fichier, voisin, chemin }: MsgVars) => `« ${fichier} » importe « ${voisin} », mais ${chemin} est introuvable : l'import reste tel quel et échouera (404) au chargement — corrigez le chemin ou ajoutez le fichier.`,
  'bundler.index.singleton-import-module-ligne': ({ fichier, ligne }: MsgVars) => `[ModularJS] ${fichier} : « ${ligne} » — un singleton réactif exporté (µ$$, anciennement §§) est un mécanisme de COMPOSANT (.mjs), pas de module autonome (.civet/.coffee) — remplacez par \`@import nom 'chemin'\` (valeur simple, non réactive).`,
  'bundler.index.singleton-import-module-dollar': ({ fichier, noms }: MsgVars) => `[ModularJS] ${fichier} : @import d'un singleton réactif (« ${noms} ») — réservé aux composants .mjs, pas à un module autonome (.civet/.coffee) — remplacez par \`@import nom 'chemin'\` (valeur simple, non réactive).`,
  'bundler.index.civet-reaffectation-constante': ({ fichier, nom, ligne }: MsgVars) => `[bundler] ${fichier} : réaffectation de '${nom}' (ligne ${ligne}) refusée — déclaré avec ':=' (constante) : utilisez '.=' pour pouvoir le réaffecter.`,
  'bundler.index.css-sass-erreurs': ({ erreurs }: MsgVars) => `[bundler] erreur(s) de compilation CSS/SASS dans stylesheetsDir :\n${erreurs}`,
  // vocabulaire des thèmes — `@css nom` désigne une FEUILLE PARTAGÉE de stylesheetsDir ;
  // le mot « thème » est désormais pris par le vrai bloc <theme>, il ne doit plus servir ici
  'bundler.index.feuille-partagee-manquante': ({ themes, dossier }: MsgVars) => `[bundler] @css : feuille(s) partagée(s) introuvable(s) dans ${dossier} : ${themes} (aucun fichier .sass/.scss/.css correspondant). Vérifiez le nom, ou ajoutez le fichier manquant.`,
  'bundler.index.precache-echec': ({ raison }: MsgVars) => `[bundler] mjs-precache.json n'a pas pu être écrit : ${raison}. Le build reste valide — seule la liste de pré-cache manque.`,
  'bundler.index.image-sharp-absent': `[bundler] Images : 'sharp' n'est pas installé — les images (µimage, <@@img>, réglages d'image des effets) passent telles quelles, sans variantes de largeur. Les dimensions natives, elles, sont bien écrites (pas de saut de mise en page). Pour produire les variantes : npm i -D sharp`,
  'bundler.index.img-largeur-infinie': ({ chemin, valeur }: MsgVars) => `[bundler] µimage('${chemin}') : largeur invalide (${valeur}) — attendu un nombre fini et positif.`,
  'bundler.index.image-animee-trop-grosse': ({ chemin, erreur }: MsgVars) => `[bundler] µimage('${chemin}') : cette image animée a trop de pixels au total (toutes ses images comptées) pour que 'sharp' en fabrique des variantes — elle passe telle quelle, sans variante, et son animation est gardée. Pour obtenir des variantes, réduisez sa taille ou son nombre d'images. Détail : ${erreur}`,
  'bundler.index.image-animee-illisible': ({ chemin, erreur }: MsgVars) => `[bundler] µimage('${chemin}') : cette image animée n'a pas pu être lue (détail : ${erreur}) ; elle est publiée telle quelle, sans variante, et son animation est gardée. Vérifiez le fichier.`,
  'bundler.index.img-variante-echec': ({ chemin, erreur }: MsgVars) => `[bundler] µimage('${chemin}') : échec de génération d'une variante — ${erreur}`,
  // `dossiers` : sourceDir puis assetDirs, dans l'ordre de recherche (absent sans assetDirs : le message d'avant)
  'bundler.index.img-src-introuvable': ({ chemin, extrait, dossiers }: MsgVars) => `[bundler] <@@img src="${chemin}"> : fichier introuvable ${dossiers ? `(dossiers fouillés, dans l'ordre : ${dossiers})` : 'dans sourceDir'} — ${extrait}`,
  'bundler.index.img-widths-invalide': ({ valeur, extrait }: MsgVars) => `[bundler] <@@img widths="${valeur}"> : largeurs invalides — des entiers ≥ 1 séparés par des espaces ou des virgules — ${extrait}`,
  'bundler.index.img-attribut-duplique': ({ attribut, extrait }: MsgVars) => `[bundler] <@@img> : l'attribut « ${attribut} » est écrit deux fois — gardez-en un seul — ${extrait}`,
  // confinement RÉEL (realpathSync) : un lien symbolique posé dans
  // sourceDir et pointant hors de sourceDir passait le contrôle lexical
  // `racine` : le dossier qui porte le lien, `assetDirs` quand l'image vient d'un dossier de cette liste (absent : sourceDir)
  'bundler.index.img-src-symlink-hors-racine': ({ chemin, cible, extrait, racine }: MsgVars) => `[bundler] <@@img src="${chemin}"> : ce chemin est un lien symbolique dont la cible réelle ('${cible}') est HORS de ${racine ?? 'sourceDir'} — jamais copié, pour ne pas publier un fichier hors du projet. Retirez ce lien ou pointez-le vers un chemin interne à ${racine ?? 'sourceDir'} — ${extrait}`,
  'bundler.index.css-lazy-feuilles-jamais-reclamees': ({ feuilles }: MsgVars) => `[bundler] css lazy : feuille(s) partagée(s) qu'aucun module ne déclare (@css) et qu'aucune vue ne réclame — écrite(s) sur disque mais JAMAIS chargée(s) : ${feuilles}. Ajoutez '@css <nom>' au(x) module(s) qui les utilisent, ou retirez le fichier.`,
  'bundler.index.css-split-feuilles-eager': ({ feuilles }: MsgVars) => `[bundler] css split : feuille(s) partagée(s) qu'aucun module ne déclare (@css) — reste(nt) importée(s) par le manifeste (eager) : ${feuilles}. Ajoutez '@css <nom>' au(x) module(s) qui les utilisent pour réduire le CSS chargé par page.`,
  'bundler.index.css-split-feuilles-eager-view': ({ feuilles }: MsgVars) => `[bundler] css split : feuille(s) partagée(s) réclamée(s) par un '<@view css="…">' — reste(nt) importée(s) par le manifeste (eager) même si un module les déclare déjà via @css ailleurs : ${feuilles}. Une page qui charge cette vue sans charger ce module en aurait sinon hérité vide (cf. runtime/mjs_element.ts, avertissement « Orphelin CSS hérité »).`,
  'bundler.index.image-effet-fichier-introuvable': ({ effet, reglage, chemin, fichier, ligne, dossiers }: MsgVars) => `[bundler] *${effet} (${fichier}, ligne ${ligne}) : le fichier de l'image « ${chemin} » (réglage ${reglage}) est introuvable ${dossiers ? `(dossiers fouillés, dans l'ordre : ${dossiers})` : 'dans le dossier source'}. Vérifiez le chemin, ou donnez l'adresse complète de l'image (https://…).`,
  'bundler.index.image-effet-introuvable': ({ effet, reglage, chemin, dossiers }: MsgVars) => `[bundler] *${effet} : le fichier de l'image « ${chemin} » (réglage ${reglage}) est introuvable ${dossiers ? `(dossiers fouillés, dans l'ordre : ${dossiers})` : 'dans le dossier source'}. Vérifiez le chemin, ou donnez l'adresse complète de l'image (https://…).`,
  'bundler.index.asset-introuvable': ({ chemin, dossiers }: MsgVars) => `[bundler] Asset introuvable : '${chemin}' référencé via µasset()/µimage()/µ.asset()/mjs.asset() n'a pas pu être résolu (fichier absent du disque, ou chemin dynamique non pré-résolvable). Vérifiez le chemin ou que le fichier existe.${dossiers ? ` Dossiers fouillés, dans l'ordre : ${dossiers}.` : ''}`,
  // assetDirs : le même chemin existe dans deux dossiers d'images — le premier de l'ordre de recherche (sourceDir, puis la liste) sert
  'bundler.index.asset-doublon': ({ chemin, retenu, ecarte }: MsgVars) => `[bundler] L'image « ${chemin} » existe dans deux dossiers : ${retenu} est utilisée, ${ecarte} est ignorée (sourceDir passe d'abord, puis assetDirs dans l'ordre). Renommez ou retirez l'un des deux fichiers pour lever le doute.`,
  // confinement RÉEL par realpathSync (findFiles ET
  // resolveOneAsset) : un symlink posé dans sourceDir (dossier ou fichier) et pointant hors de
  // sourceDir était suivi/copié sans un mot, le contrôle existant (resolve()/startsWith) étant
  // purement lexical, donc aveugle à un lien. Un symlink INTERNE (cible sous sourceDir) reste
  // accepté — seule une cible RÉELLE hors racine déclenche cette erreur.
  'bundler.index.collision-empreinte': ({ fichier }: MsgVars) => `[bundler] '${fichier}' : deux contenus différents ont reçu la même empreinte courte (1 chance sur 60 millions). Aucun fichier n'a été écrasé : modifiez légèrement l'un des deux fichiers source (un espace suffit) et relancez le build.`,
  // `racine` : le dossier qui porte le lien, `assetDirs` pour une image d'un dossier de cette liste (absent : sourceDir)
  'bundler.index.symlink-hors-racine': ({ lien, cible, racine }: MsgVars) => `[bundler] '${lien}' est un lien symbolique dont la cible réelle ('${cible}') est HORS de ${racine ?? 'sourceDir'} — jamais suivi ni copié, pour ne pas publier un fichier hors du projet dans outputDir. Retirez ce lien ou pointez-le vers un chemin interne à ${racine ?? 'sourceDir'}.`,
  // lien PENDANT (cible absente) :
  // realpathSync levait un ENOENT Node brut, jamais catalogué.
  'bundler.index.symlink-pendant': ({ lien }: MsgVars) => `[bundler] '${lien}' est un lien symbolique PENDANT (sa cible n'existe pas) — jamais suivi, son confinement ne peut pas être vérifié. Retirez ce lien ou réparez sa cible.`,
  'bundler.index.module-nom-invalide': ({ fichier, nom }: MsgVars) => `[bundler] nom de module refusé '${nom}' (${fichier}) — lettres, chiffres, '_', '.' et '-' seulement (ni espace, ni '#', ni '?'), et jamais le préfixe 'mjs_', réservé aux fichiers internes du framework. Renommez ce fichier.`,
  'bundler.index.collision-composant-module': ({ nom, composant, module }: MsgVars) => `[bundler] Le composant ${composant} et le module ${module} portent le même nom '${nom}' : le module prendrait la place du composant, jamais écrit, et <mjs-${nom}> resterait inerte. Renommez l'un des deux fichiers (le module, par exemple : ${nom}-logique).`,
  'bundler.index.manifeste-refuse-extension': ({ chemin, extension }: MsgVars) => `[bundler] Le manifeste produit (manifestPath : ${chemin}) porterait l'extension d'un fichier source (${extension}) : chaque construction écraserait ce fichier. Rien n'a été écrit. Donnez à manifestPath un nom en .js, à côté des fichiers produits ; le manifeste que vous écrivez vous-même se déclare dans manifestExternal.`,
  'bundler.index.manifeste-refuse-externe': ({ chemin }: MsgVars) => `[bundler] Le manifeste produit (manifestPath : ${chemin}) serait le fichier de manifestExternal : la construction le lirait comme manifeste externe, puis l'écraserait. Rien n'a été écrit. Donnez à manifestPath un autre chemin, à côté des fichiers produits.`,
  'bundler.index.manifeste-refuse-sources': ({ chemin, sourceDir, outputDir }: MsgVars) => `[bundler] Le manifeste produit (manifestPath : ${chemin}) serait dans le dossier des sources (${sourceDir}) alors que les fichiers produits vont ailleurs (${outputDir}) : chaque construction l'écrirait au milieu de votre code, par-dessus un fichier du même nom. Rien n'a été écrit. Donnez à manifestPath un chemin à côté des fichiers produits.`,
  'bundler.index.require-introuvable': ({ spec, dossier }: MsgVars) => `[bundler] require introuvable : '${spec}' (depuis ${dossier})`,
  'bundler.index.require-dir-introuvable': ({ spec, dossier }: MsgVars) => `[bundler] require_dir introuvable : '${spec}' (depuis ${dossier})`,
  'bundler.index.require-hors-projet': ({ directive, fichier, cible }: MsgVars) => `[bundler] manifeste externe : '${directive}' (${fichier}) lit '${cible}', hors du projet — seuls les fichiers du projet (dossier de mjs.config.json, dossier parent de sourceDir ou dossier du manifeste) peuvent être réunis. Copiez ce fichier dans le projet.`,
  'bundler.index.i18n-yaml-manquant': ({ fichier }: MsgVars) => `[bundler] i18n : dictionnaire YAML détecté (${fichier}) mais le paquet 'yaml' n'est pas installé — installez-le (npm i -D yaml) ou convertissez vos dictionnaires en .json`,
  'bundler.index.i18n-fichier-invalide': ({ chemin, erreur }: MsgVars) => `[bundler] i18n : fichier invalide '${chemin}' — ${erreur}`,
  'bundler.index.i18n-pas-un-dictionnaire': () => `le contenu doit être un dictionnaire de clés (objet), pas une liste, un nombre, un texte ou null`,
  'bundler.index.i18n-langue-invalide': ({ langue, chemin }: MsgVars) => `[bundler] i18n : nom de langue invalide '${langue}' (${chemin}) — attendu une étiquette de langue comme fr, en, pt-BR ou zh_Hant. Renommez ce fichier ou ce dossier, ou sortez-le de i18n/.`,
  'bundler.index.i18n-dossier-absent': ({ dossier }: MsgVars) => `[bundler] i18n : config.i18n renseigné mais '${dossier}' est absent — aucun dictionnaire i18n ne sera émis.`,
  'bundler.index.i18n-default-manquant': `[mjs.config.json] i18n/ présent : précisez i18n.default dans mjs.config.json`,
  'bundler.index.i18n-section-invalide': ({ section, chemin }: MsgVars) => `[bundler] i18n : nom de section invalide '${section}' (${chemin}) — doit matcher /^[a-z0-9_-]+$/`,
  'bundler.index.i18n-sortie-dans-sources': ({ dossier, sources }: MsgVars) => `[bundler] i18n : le dossier de sortie mène au dossier de vos traductions (${sources}) — les fragments de traduction seraient écrits dans '${dossier}' : chaque construction y réécrirait vos fichiers, et ses fragments y seraient relus comme des sections. Rien n'a été écrit dans vos traductions ; donnez à outputDir un dossier distinct de sourceDir (ex. public/modularjs).`,
  'bundler.index.manifeste-fichier-auteur': ({ chemin }: MsgVars) => `[bundler] Le manifeste (manifestPath) remplacerait un fichier qui existe déjà et que ModularJS n'a pas produit : ${chemin}. C'est peut-être un fichier à vous. Rien n'a été écrit.\nChoisissez un autre manifestPath, ou renommez ou déplacez ce fichier ; s'il vient d'une construction d'une version précédente, supprimez-le puis relancez.`,
  'bundler.index.sorties-fichiers-auteur': ({ nb, fichiers, sources, marque, cle, avant, raison }: MsgVars) => `[bundler] La construction écrit dans le dossier des sources (${sources}) et remplacerait ${nb === 1 ? 'un fichier qui existe déjà et' : `${nb} fichiers qui existent déjà et`} ${raison === 'forme' ? (nb === 1 ? "n'a pas la forme de celui qu'elle écrit sous ce nom" : "n'ont pas la forme de ceux qu'elle écrit sous ces noms") : raison === 'les-deux' ? `n'ont ni la marque des fichiers qu'elle produit (première ligne ${marque}, clé "${cle}" de mjs-precache.json) ni la forme de ceux qu'elle écrit sous ces noms` : `${nb === 1 ? 'ne porte pas' : 'ne portent pas'} la marque des fichiers qu'elle produit (première ligne ${marque}, clé "${cle}" de mjs-precache.json)`} : ${nb === 1 ? "c'est peut-être un fichier à vous" : 'ce sont peut-être des fichiers à vous'}. ${avant ? "Rien n'a été écrit." : nb === 1 ? "Ce fichier n'a pas été remplacé." : "Ces fichiers n'ont pas été remplacés."}${fichiers}\nRenommez ou déplacez ${nb === 1 ? 'ce fichier' : 'ces fichiers'}, ou faites écrire la construction ailleurs (outputDir, manifestPath) ; ${nb === 1 ? "s'il vient d'une construction d'une version précédente, supprimez-le" : "s'ils viennent d'une construction d'une version précédente, supprimez-les"} puis relancez.`,
  'bundler.index.registre-theme-garde': ({ chemin }: MsgVars) => `[bundler] ${chemin} n'a pas été retiré : la construction de production ne publie pas le registre des variables de thème, et ce fichier n'a pas la forme de celui que ModularJS écrit sous ce nom. C'est peut-être un fichier à vous ; s'il vient d'une construction de développement, supprimez-le.`,
  'bundler.index.i18n-source-langue-inconnue': ({ langue }: MsgVars) => `[mjs.config.json] i18n.source vaut '${langue}' mais aucun dictionnaire pour cette langue n'existe dans i18n/`,
  'bundler.index.i18n-source-scellee': ({ fichier }: MsgVars) => `[bundler] i18n : '${fichier}' porte un __source — la langue source ne se scelle pas, clé retirée`,
  'bundler.index.i18n-source-introuvable': ({ fichier, langue }: MsgVars) => `[bundler] i18n : '${fichier}' rejeté — aucune source '${langue}' correspondante, dictionnaire non émis`,
  'bundler.index.i18n-empreinte-absente': ({ fichier, attendu }: MsgVars) => `[bundler] i18n : '${fichier}' rejeté — __source absent, empreinte attendue : ${attendu}`,
  'bundler.index.i18n-fragment-collision': ({ empreinte }: MsgVars) => `[bundler] i18n : deux fragments de traduction différents ont la même empreinte complète (${empreinte}) — modifiez légèrement l'un des deux textes`,
  'bundler.index.i18n-empreinte-perimee': ({ fichier, attendu }: MsgVars) => `[bundler] i18n : '${fichier}' rejeté — __source périmé, empreinte attendue : ${attendu}`,
  'bundler.index.watch-erreur': '💥 [mjs watch] erreur du watcher :',
  'bundler.index.watch-deja-actif': () => `[bundler] watch() est déjà actif sur ce Bundler : appelez close() avant d'en relancer un.`,
  'bundler.index.watch-recompilation': ({ fichier }: MsgVars) => `\n⚡ ${fichier} — recompilation...`,
  'bundler.index.watch-build-initial': `\n⚡ Build initial...`,
  'bundler.index.watch-build-termine': ({ ecrits, duree, erreurs }: MsgVars) => `✅ ${ecrits} fichier${Number(ecrits) > 1 ? 's' : ''} en ${duree}ms (errors: ${erreurs})`,
  'bundler.index.watch-recompilation-echouee': '💥 [mjs watch] recompilation échouée :',
  'bundler.index.watch-watching': ({ chemins }: MsgVars) => `👀 Watching ${chemins}...`,
  'bundler.index.esm-check-ni-esm-ni-script': ({ filename, line, col, erreur, src }: MsgVars) => `[bundler/esm-check] ${filename}${line ? `:${line}:${col}` : ''} — ${erreur} (ni module ESM ni script classique)\n  ${src}`,
  // un SVG copié tel quel est servi depuis la MÊME origine que le site.
  // libellé généralisé : le motif n'est plus toujours un <script>
  // littéral (entité encodée, injection SMIL, <foreignObject>/<iframe> embarquant une autre
  // origine) — « exécutable »/« Retire le script » ne décrivait plus fidèlement tous les cas.
  'bundler.index.svg-script-refuse': ({ fichier, motif }: MsgVars) => `[bundler] ${fichier} : SVG refusé — contient ${motif}, dangereux si le fichier est servi directement (chargement top-level, <object>, <iframe>) ou via <img>. Retirez ce contenu avant de le référencer via µasset()/µimage()/<@@img>.`,
  'bundler.index.svg-entite-hors-plage': ({ fichier, entite }: MsgVars) => `[bundler] ${fichier} : SVG refusé — l'entité ${entite} désigne un caractère hors de la plage Unicode. Corrigez ou retirez cette entité.`,
  'bundler.index.mangle-cache-ecarte': ({ fichier, cles }: MsgVars) => `[bundler] ${fichier} : entrées écartées (valeur qui n'est pas un texte, ou nom court porté par plusieurs propriétés, par exemple après une fusion git) : ${cles}. Elles seront recalculées à ce build.`,
  // raccourci <@nom> (resolveTagShortcuts) ; notation UNIQUE (résolution
  // projet PUIS cœur), <@mjs-nom> retirée (tag-raccourci-mjs-retire)
  'bundler.index.tag-nom-reserve': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : '${nom}' est une balise RÉSERVÉE de ModularJS (<@${nom}>) — un composant (basename ou alias court) ne peut pas revendiquer ce nom. Renommez le fichier.`,
  'bundler.index.tag-nom-core-prefixe': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : '${nom}' commence par 'core-', préfixe RÉSERVÉ aux modules cœur (balise <mjs-core-nom>, écrite <@@nom>) — un composant du projet (basename ou alias court) ne peut pas l'utiliser. Renommez le fichier.`,
  'bundler.index.tag-nom-mjs-prefixe': ({ fichier, nom, propre }: MsgVars) => `[bundler] ${fichier} : '${nom}' commence par 'mjs-', préfixe RÉSERVÉ au framework — le tag d'un composant est DÉJÀ 'mjs-<nom de fichier>' (celui-ci donnerait <mjs-${nom}>), et tout attribut 'mjs-*' est réservé aux internes. Renommez le fichier en '${propre}.mjs' : son tag sera <mjs-${propre}>.`,
  // alias court (shortName) en collision avec une réservée/core- : abandonné + avertissement (jamais bloquant, contrairement au basename)
  'bundler.index.tag-alias-reserve-ignore': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : l'alias court '${nom}' est ignoré — nom réservé ; le composant reste utilisable par son nom complet.`,
  'bundler.index.tag-raccourci-mjs-retire': ({ fichier, nom, forme }: MsgVars) => `[bundler] ${fichier} : « <@mjs-${nom}> » est retirée — écrivez « ${forme} » (<@nom> pour un composant du projet, <@@nom> pour un module cœur).`,
  'bundler.index.tag-coeur-litteral-inconnu': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : <mjs-core-${nom}> : aucun module cœur « ${nom} » — le préfixe mjs-core- est réservé aux modules cœur (écrits <@@nom>).`,
  'bundler.index.tag-coeur-inconnu': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : « <@@${nom}> » : aucun module cœur « ${nom} ».`,
  'bundler.index.tag-coeur-est-projet': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : « <@@${nom}> » : aucun module cœur « ${nom} » — le composant du projet s'écrit « <@${nom}> ».`,
  'bundler.index.tag-coeur-reservee': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : « <@@${nom}> » : une balise du langage s'écrit avec un seul @ — « <@${nom}> ».`,
  'bundler.index.tag-coeur-sans-arobase': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : « <@${nom}> » : aucun composant « ${nom} » dans le projet. Le module cœur s'écrit avec deux @ : « <@@${nom}> ».`,
  'bundler.index.tag-litteral-coeur-migration': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : <mjs-${nom}> : aucun composant « ${nom} » dans le projet. Le module cœur s'écrit « <@@${nom}> » (balise <mjs-core-${nom}>).`,
  'bundler.index.tag-dev-inconnu': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : balise <@${nom}> inconnue — ni balise du langage, ni composant du projet.`,
  'bundler.index.tag-suggestion': ({ nom, nature }: MsgVars) => {
    const label = nature === 'coeur' ? 'module cœur' : nature === 'reservee' ? 'balise réservée' : 'composant du projet'
    return ` Vouliez-vous dire <${nature === 'coeur' ? '@@' : '@'}${nom}> (${label}) ?`
  },
  'bundler.index.tag-litteral-dev-inconnue': ({ fichier, tag }: MsgVars) => `[bundler] ${fichier} : <${tag}> ne correspond à aucun composant compilé (ni basename ni alias court) — tag inerte au runtime si c'est une faute de frappe sur un composant du projet.`,
  'bundler.index.tag-sans-prefixe': ({ fichier, nom }: MsgVars) => `[bundler] ${fichier} : <${nom}> est écrite sans préfixe — le navigateur ne la relie à aucun composant, elle reste vide. Pour le composant ${nom} du projet, écrivez <mjs-${nom}> ou <@${nom}>.`,
  // alias court AMBIGU : deux composants se le disputent, personne ne le publie (claimShortName,
  // kind 'poisoned') — la balise courte n'est jamais enregistrée, elle reste inerte
  'bundler.index.tag-alias-ambigu': ({ fichier, tag, sources, premier }: MsgVars) => `[bundler] ${fichier} : <${tag}> — alias ambigu : ${sources} se disputent ce raccourci, aucun ne le publie (balise jamais enregistrée, inerte au runtime). Écrivez la balise complète, par exemple <mjs-${premier}>.`,
  // variants — layout="x"/template="x" littéral dont le nom n'est pas une
  // variant <style name="…"> connu du module ciblé (parser/index.ts, TagRef.layoutLiteral)
  'bundler.index.tag-layout-litteral-inconnue': ({ fichier, tag, nom, connus }: MsgVars) => `[bundler] ${fichier} : <${tag} layout="${nom}"> — variant '${nom}' inconnu de ce composant (connus : ${connus}). Corrigez la faute de frappe ou ajoutez <style name="${nom}"> à ce composant.`,
  // <@@chart> : valeurs écrites en dur sur la balise (bundler/core-chart.ts) — un mot inconnu, une couleur refusée, une combinaison impossible
  'bundler.index.chart-mot-inconnu': ({ fichier, tag, attribut, valeur, mot, connus }: MsgVars) => `[bundler] ${fichier} : <${tag} ${attribut}="${valeur}"> — « ${mot} » n'est pas une valeur connue de ${attribut} (valeurs connues : ${connus}). Corrigez la faute de frappe.`,
  'bundler.index.chart-couleur-refusee': ({ fichier, tag, couleur, teintes }: MsgVars) => `[bundler] ${fichier} : <${tag} series={…}> — la couleur « ${couleur} » est refusée : écrivez un nom de teinte (${teintes}), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…).`,
  'bundler.index.chart-axe-serie-inconnu': ({ fichier, tag, mot, connus }: MsgVars) => `[bundler] ${fichier} : <${tag} series={…}> — axis « ${mot} » d'une série n'est pas une valeur connue (valeurs connues : ${connus}). Corrigez la faute de frappe.`,
  'bundler.index.chart-sans-statistiques': ({ fichier, tag, forme, valeur, mots, formes, tendance }: MsgVars) => `[bundler] ${fichier} : <${tag} shape="${forme}" stats="${valeur}"> — la forme ${forme} ne trace pas stats « ${mots} » (formes qui tracent des statistiques : ${formes} ; trend : ${tendance}). Retirez « ${mots} » de stats ou changez de forme.`,
  'bundler.index.chart-combinaison': ({ fichier, tag, forme, attribut, valeur, connus }: MsgVars) => `[bundler] ${fichier} : <${tag} shape="${forme}" ${attribut}="${valeur}"> — ${attribut}="${valeur}" ne va pas avec la forme ${forme} (valeurs possibles : ${connus}).`,
  // un module du cœur : un attribut écrit en dur en camelCase, que le HTML met en minuscules (bundler/core-attrs.ts)
  'bundler.index.coeur-attribut-camel': ({ fichier, tag, attribut, kebab, minuscules }: MsgVars) => `[bundler] ${fichier} : <${tag} ${attribut}=…> — écrivez ${kebab} : sur un module du cœur, un attribut écrit en dur s'écrit à tirets, comme dans sa documentation. Écrit ainsi, ${attribut} arriverait en minuscules (${minuscules}) et le module le recevrait pourtant sous son nom : la construction n'en garde qu'une écriture.`,
  'bundler.index.chart-fuseau-inconnu': ({ fichier, tag, valeur }: MsgVars) => `[bundler] ${fichier} : <${tag} timezone="${valeur}"> — « ${valeur} » n'est pas un fuseau connu : écrivez local (l'heure de l'écran du visiteur) ou le nom d'une zone IANA (Europe/Paris, America/New_York, UTC…), ou retirez timezone pour afficher les heures telles qu'elles sont écrites.`,
  'bundler.index.chart-decimales': ({ fichier, tag, ecrit, valeur }: MsgVars) => `[bundler] ${fichier} : <${tag} ${ecrit}> — decimals attend un nombre entier de 0 à 10, le nombre de chiffres après la virgule : « ${valeur} » ne convient pas.`,
  'bundler.index.chart-radar-axes': ({ fichier, tag, nb }: MsgVars) => `[bundler] ${fichier} : <${tag} shape="radar" rows={…}> — un radar demande au moins 3 lignes, une par axe : ${nb} ${Number(nb) > 1 ? 'sont écrites' : 'est écrite'}.`,
  'bundler.index.chart-axe-droite-ignore': ({ fichier, tag, forme, cles, formes }: MsgVars) => `[bundler] ${fichier} : <${tag} shape="${forme}" series={…}> — la forme ${forme} n'a qu'une échelle, axis « right » est ignoré pour ${cles} (formes à deux échelles : ${formes}). Retirez axis: 'right' ou changez de forme.`,
  // — minify.ts
  'bundler.minify.label-acces-indexe': "accès indexé `obj['_mjs_X']`",
  'bundler.minify.label-acces-template': 'accès template literal `obj[`_mjs_${...}`]`',
  'bundler.minify.label-define-property': "Object.defineProperty(*, '_mjs_X', ...) — string non manglée",
  'bundler.minify.label-reflect': "Reflect.X(*, '_mjs_X', ...) — string non manglée",
  'bundler.minify.label-concat': "concaténation `'_mjs_' + X` — nom fabriqué à l'exécution",
  'bundler.minify.label-in': "test `'_mjs_X' in obj` — string non manglée",
  'bundler.minify.label-has-own': "test `Object.hasOwn(*, '_mjs_X')` / `hasOwnProperty.call(*, '_mjs_X')` — string non manglée",
  'bundler.minify.label-cle-guillemets': "clé d'objet entre guillemets `{ '_mjs_X': … }` — string non manglée",
  'bundler.minify.mjs-prop-access-invalide': ({ fichier, ligne, label, contenu }: MsgVars) => `[bundler/minify] ${fichier}:${ligne} — ${label}\n  → ${contenu}\n  Les props \`_mjs_*\` sont manglées par esbuild via mangleCache pour cohérence inter-fichiers.\n  Un accès indirect ne participe PAS au mangle → crash runtime.\n  Fix : utiliser la notation pointée (\`obj._mjs_X\`) au lieu de l'accès string.`,
  // — worker-pool.ts
  'bundler.worker-pool.worker-sorti': ({ code }: MsgVars) => `WorkerPool: worker sorti avec le code ${code}`,
  'bundler.worker-pool.deja-termine': `WorkerPool: déjà terminé`,
  'bundler.worker-pool.aucun-worker-vivant': `WorkerPool: aucun worker vivant (pool à recréer)`,
  'bundler.worker-pool.erreur-inconnue': `worker: erreur inconnue`,
  'bundler.worker-pool.plus-aucun-worker': ({ message }: MsgVars) => `WorkerPool: plus aucun worker vivant (${message})`,
  'bundler.worker-pool.terminate-queue': `WorkerPool: terminate() pendant tâche en queue`,
  'bundler.worker-pool.terminate-inflight': `WorkerPool: terminate() pendant tâche in-flight`,
  'bundler.worker-pool.worker-ts-introuvable': ({ chemin }: MsgVars) => `[worker-pool] worker.ts introuvable : ${chemin}`,
  // délai maximal d'une tâche, compté depuis son début dans le worker
  'bundler.worker-pool.tache-timeout': ({ fichier, ms }: MsgVars) => `WorkerPool: tâche '${fichier}' sans réponse après ${ms}ms — worker retiré du pool`,
  // tâche dont le worker est perdu (mort, délai dépassé) : seconde chance, puis repli dans le processus principal
  'bundler.worker-pool.nouvel-essai': ({ fichier, raison }: MsgVars) => `[bundler] ${fichier} : ${raison} — nouvel essai sur un autre worker`,
  'bundler.worker-pool.repli-principal': ({ fichier, raison }: MsgVars) => `[bundler] ${fichier} : ${raison} — compilé dans le processus principal`,
  'bundler.worker-pool.repli-direct': `[bundler] plus aucun worker : les fichiers suivants sont compilés dans le processus principal`,
  // tâche commencée qui a dépassé le délai : jamais reprise dans le processus principal, où rien ne la bornerait
  'bundler.worker-pool.delai-depasse': ({ fichier, ms, fois }: MsgVars) => `la compilation de « ${fichier} » a dépassé ${Number(fois) > 1 ? 'deux fois ' : ''}le délai de ${Number(ms) % 1000 === 0 ? `${Number(ms) / 1000} s` : `${ms} ms`} : elle est arrêtée, et n'est pas reprise dans le processus principal, où rien ne la limiterait. Cherchez ce qui, dans ce fichier, retient le compilateur ; sur une machine très chargée, réessayez.`,
  // — worker.ts
  'bundler.worker.parent-port-manquant': `worker.ts doit être exécuté à l'intérieur d'un Worker (parentPort manquant)`,
  // — fx-sections.ts
  'bundler.fx-sections.section-sans-ouverture': ({ fichier }: MsgVars) => `[bundler] ${fichier} : une section se ferme sans avoir été ouverte`,
  'bundler.fx-sections.section-non-fermee': ({ fichier }: MsgVars) => `[bundler] ${fichier} : une section marquée n'est pas fermée`,
  'bundler.fx-sections.etiquette-illisible': ({ fichier, jeton }: MsgVars) => `[bundler] ${fichier} : l'étiquette « ${jeton} » d'une section ne se lit pas — écrivez un réglage, réglage=valeur, effet.réglage ou *effet`,
  // — core-sections.ts
  'bundler.core-sections.section-sans-ouverture': ({ fichier }: MsgVars) => `[bundler] ${fichier} : un repère de module cœur ferme une section qui n'a pas été ouverte`,
  'bundler.core-sections.section-non-fermee': ({ fichier }: MsgVars) => `[bundler] ${fichier} : un repère de module cœur ouvre une section qui n'est pas fermée (ou la ferme dans un autre langage)`,
  'bundler.core-sections.etiquette-illisible': ({ fichier, jeton }: MsgVars) => `[bundler] ${fichier} : l'étiquette « ${jeton} » d'un repère de module cœur ne se lit pas — écrivez le nom d'un attribut, !attribut ou dev attribut`,
  // — hologram-motifs.ts
  'bundler.hologram-motifs.image-introuvable': ({ motif, dossier }: MsgVars) => `[bundler] l'image du motif « ${motif} » de *hologram est introuvable dans ${dossier}`,
  // — hologram-styles.ts
  'bundler.hologram-styles.appel-sans-style': ({ fichier, noms }: MsgVars) => `[bundler] ${fichier} : « style('${noms}' » est gardé sans aucun style demandé`,
  'bundler.hologram-styles.style-sans-section': ({ fichier, style }: MsgVars) => `[bundler] ${fichier} : le style « ${style} » n'a aucune section`,

  'bundler.theme-nom-fichier': ({ nom, fichier }: MsgVars) => `[ModularJS] ${fichier} : « ${nom} » n'est pas un nom de thème valide — minuscules, chiffres et tirets uniquement (le nom du fichier EST le nom du thème : sombre.theme.mjs donne le thème « sombre »).`,
  'bundler.theme-fichier-sans-bloc': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} : aucun bloc <theme> — un fichier de thème ne contient que ça.`,
  'bundler.theme-fichier-impur': ({ fichier, quoi }: MsgVars) => `[ModularJS] ${fichier} contient ${quoi} — un fichier de thème ne contient qu'un bloc <theme> : il déclare des variables, il ne rend rien. Pour du style ou du balisage, écrivez un composant.`,
  'bundler.theme-fichier-multi': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} contient plusieurs blocs <theme> — un fichier = un thème. Pour un deuxième thème, un deuxième fichier.`,
  // fichiers *.types.mjs (bundler/types-files.ts)
  'bundler.types-fichier-sans-bloc': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} : aucun bloc <types> — un fichier *.types.mjs déclare ses règles nommées dans un bloc <types> (ex. Percent  int 0..100).`,
  'bundler.types-fichier-multi': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} contient plusieurs blocs <types> — un seul bloc par fichier.`,
  'bundler.types-fichier-impur': ({ fichier, quoi }: MsgVars) => `[ModularJS] ${fichier} : un fichier *.types.mjs ne contient que son bloc <types> (et des commentaires) — ${quoi} n'a rien à y faire.`,
  'bundler.types-nom-double': ({ nom, fichier1, fichier2 }: MsgVars) => `[ModularJS] la règle « ${nom} » est déclarée deux fois : ${fichier1} et ${fichier2} — un nom par appli.`,
  'bundler.types-store-conflit': ({ store, regle1, fichier1, regle2, fichier2 }: MsgVars) => `[ModularJS] le store $$${store} a deux règles différentes : « ${regle1} » (${fichier1}) et « ${regle2} » (${fichier2}) — un store vaut pour toute l'appli, sa règle aussi : gardez la même partout, ou déclarez-la une seule fois.`,
  'bundler.theme-fichier-name': ({ fichier, nom }: MsgVars) => `[ModularJS] ${fichier} : <theme name="${nom}"> — dans un fichier de thème le nom vient du FICHIER, pas de l'attribut. Retirez name="${nom}" (ou renommez le fichier en ${nom}.theme.mjs). L'attribut name ne sert que dans un composant, pour une variante.`,
  'bundler.page-nom-fichier-vide': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} : nom de page vide — une fois le marqueur « .page » retiré, il ne reste aucun nom (le nom du fichier EST le nom du composant : accueil.page.mjs donne 'accueil'). Renommez le fichier.`,
  'bundler.page-marqueur-double': ({ fichier, reste, suggestion }: MsgVars) => `[ModularJS] ${fichier} : marqueur « .page » en double — un seul est retiré, il reste « ${reste} » qui finit encore par « .page ». Renommez le fichier en '${suggestion}'.`,
  // même garde que bundler.theme-nom-fichier (bundler/themes.ts) : un nom
  // de composant hors kebab-case casse l'autoloader (majuscule) ou customElements.define() (espace)
  'bundler.composant-nom-fichier': ({ nom, fichier, suggestion }: MsgVars) => `[ModularJS] ${fichier} : « ${nom} » n'est pas un nom de composant valide — minuscules, chiffres et tirets uniquement (le nom du fichier détermine à la fois la clé du manifeste ET le tag <mjs-…>). Renommez le fichier en '${suggestion}'.`,

  // registre des variables de thème — deux niveaux : un nom que personne ne déclare est presque
  // toujours une faute de frappe (avertissement), un nom déclaré par plusieurs composants est
  // légitime mais mérite d'être su (information, jamais un reproche)
  'bundler.variable-inconnue': ({ nom, lus }: MsgVars) => `[ModularJS] $$${nom} est lu par ${lus}, mais personne ne le déclare — ni un thème de l'application, ni un composant, ni le framework. Faute de frappe probable : la valeur sera vide à l'écran. Déclarez-le dans un <theme>, ou corrigez le nom.`,
  'bundler.variable-partagee': ({ nom, modules }: MsgVars) => `[ModularJS] $$${nom} est déclaré par ${modules} — rappel : une variable de thème n'appartient à personne, elle cascade. Chacun de ces composants impose sa valeur à toute sa descendance ; le plus proche l'emporte.`,
  'bundler.variable-effet-fondu': ({ nom, effet, alias, nouveau }: MsgVars) => `[ModularJS] $$${nom} : cette variable de thème n'est plus lue — *${effet} fait désormais partie de ${alias} ; écrivez $$${nouveau}.`,
  'bundler.variable-effet-fondu-sans': ({ nom, effet, alias }: MsgVars) => `[ModularJS] $$${nom} : cette variable de thème n'est plus lue — *${effet} fait désormais partie de ${alias}, qui n'a pas de variable de thème pour ce réglage ; écrivez-le sur la balise.`,

  // ═══ COMPILATEUR (lexer/parser/generator/analyzer/transpiler/languages/schema) ═══════════

  // — src/lexer/index.ts —
  'lexer.hook-arobase-retire': ({ hook }: MsgVars) => `[ModularJS] « @${hook} -> » : la forme @ des hooks est retirée — écrivez « µ${hook} -> » (rune de cycle de vie). Le nom « ${hook} » reste libre pour vos méthodes (« @${hook} = -> »).`,
  'lexer.crochet-inconnu': ({ nom, proche }: MsgVars) => `[ModularJS] « µ${nom} » n'est pas un crochet de cycle de vie : vouliez-vous écrire « µ${proche} » ? Les crochets sont µmount, µawake, µsleep, µdestroy, µurlChange et µfailed.`,
  'parser.bloc-modele-nom': ({ ecrit, ligne }: MsgVars) => `[ModularJS] ${ecrit} ligne ${ligne} : un nom de modèle (layout), ou plusieurs séparés par des virgules — {? timer}, {? chrono, minuteur}, {? default}.`,
  'parser.modele-fichier-calcule': ({ tag, nom, modeles, premier, ligne }: MsgVars) => `[ModularJS] <${tag}> ligne ${ligne} : ${nom} a des modèles dans leur propre fichier (${modeles}) ; une valeur calculée s'écrit entre accolades, sans guillemets — layout={$vue} : le compilateur pose la balise du modèle choisi. En dur : layout="${premier}".`,
  'bundler.modele-default': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} : « default » est le modèle de base (le composant lui-même, celui de {? default}) — donnez un autre nom à ce modèle.`,
  'bundler.modele-sans-composant': ({ fichier, base }: MsgVars) => `[ModularJS] ${fichier} : un modèle de « ${base} », mais ${base}.mjs n'existe pas — un fichier modèle se pose à côté de son composant.`,
  'bundler.modele-double': ({ base, nom, fichier }: MsgVars) => `[ModularJS] ${base} : le modèle « ${nom} » est à la fois un fichier (${fichier}) et un style nommé (<style name="${nom}">) — gardez l'un des deux.`,
  'lexer.mu-layout-ecrit': `[ModularJS] « µlayout » se lit, il ne s'écrit pas : le modèle se choisit sur la balise du composant (\`<@carte layout="compacte">\`, ou \`layout={$x}\`).`,
  'lexer.mu-layout-module': `[ModularJS] « µlayout » hors du <script> d'un composant (<script module>, module importé) : ce code est partagé par toutes les instances, et le modèle choisi est celui d'une instance — lisez µlayout dans le <script> du composant, ou passez-le en argument.`,
  'lexer.symbole-declare-civet': ({ varName, preview }: MsgVars) => `[ModularJS] « ${varName} := ${preview} » : « := » est l'opérateur de déclaration Civet, invalide sur un symbole $ — écrivez « ${varName} = ${preview} » (les symboles $ sont auto-déclarés, « := » y est toujours superflu).`,
  'lexer.derived-expr-vide': ({ varName }: MsgVars) => `[ModularJS] « µderived $${varName} = » : expression manquante avant la liste de dépendances forcées.`,
  'lexer.derived-dep-invalide': ({ varName, dep }: MsgVars) => `[ModularJS] « µderived $${varName} = …, ${dep} » : chaque dépendance forcée doit être un symbole $ nu (ex. $a), reçu « ${dep} ».`,

  // — src/parser/index.ts —
  'parser.nom-reserve': ({ ligne, bloc, nom, alt, listeNoms }: MsgVars) => `

🚨 [NOM RÉSERVÉ] Ligne ${ligne}, bloc \`{${bloc}}\` : le nom \`${nom}\` est utilisé
   en interne par le code JS généré par ModularJS. Le choisir comme variable
   de template provoque une collision silencieuse au runtime.
👉 Renommez cette variable (ex: \`${nom}\` → \`${alt}\`).
   Noms réservés : ${listeNoms}

`,
  'parser.symbole-reserve-template': ({ ligne, nom, kind }: MsgVars) => `[ModularJS] ligne ${ligne} : « ${nom} » est un symbole du framework — $ (état), $$ (store), µ (runtime) — il ne peut pas nommer une variable d'un bloc {${kind}}. Renommez-le (par exemple « item »).`,
  'parser.astuce-if-ternaire': `Astuce : pour un ternaire en ligne (une valeur, pas un bloc), utilisez\n   la syntaxe JS \`{cond ? a : b}\` — une interpolation \`{…}\` est du JS ;\n   sinon fermez le bloc \`{if …}\` par \`{end}\`.`,
  'parser.astuce-bloc-modele-end': `Astuce : un bloc {? nom} se ferme par {end} ; dedans, un autre {? nom} ouvre la branche suivante et {else} celle des autres modèles.`,
  'parser.astuce-for-end': `Astuce : chaque \`{for item in liste}\` doit être fermé par \`{end}\` sur une ligne distincte.`,
  'parser.astuce-await-end': `Astuce : chaque \`{await promise}\` doit être fermé par \`{end}\` (après \`{success}\` / \`{error}\`).`,
  'parser.astuce-key-end': `Astuce : \`{key expr}\` délimite un sous-arbre recréé quand \`expr\` change ; il doit être fermé par \`{end}\`.`,
  'parser.chaine-non-fermee': ({ ligne, quote, extrait }: MsgVars) => `

🚨 [CHAÎNE NON FERMÉE] La chaîne ouverte par \`${quote}\` ligne ${ligne} n'est jamais refermée.
   Fin de fichier atteinte : tout le HTML suivant a été avalé par l'expression.
👉 Fermez la chaîne. Attention, \`\\\\\` est un antislash LITTÉRAL : il n'échappe pas le
   guillemet qui le suit (\`'c:\\\\'\` ferme bien la chaîne, \`'c:\\'\` ne la ferme pas).
   Début avalé : ${extrait}

`,
  'parser.delimiteur-non-ferme': ({ ligne, ouvrant, fermant, extrait }: MsgVars) => `

🚨 [EXPRESSION NON FERMÉE] \`${ouvrant}\` ouvert ligne ${ligne} n'a pas de \`${fermant}\` correspondant.
   Fin de fichier atteinte : tout le HTML suivant a été avalé par l'expression.
👉 Fermez l'expression par \`${fermant}\` (une accolade à afficher telle quelle s'écrit \`&#123;\`).
   Début avalé : ${extrait}

`,
  'parser.fermeture-bloc-slash': ({ ecrit, ligne }: MsgVars) => `[ModularJS] ligne ${ligne} : « ${ecrit} » n'existe pas en ModularJS — un bloc ({if}, {for}, {await}, {key}) se ferme par {end}. Remplacez « ${ecrit} » par {end}.`,
  'parser.squelette-attente-ecrite': ({ ligne }: MsgVars) => `[ModularJS] ligne ${ligne} : {await … *skeleton} — la branche d'attente est déjà écrite (avant {success}) : le squelette la remplacerait. Gardez l'une ou l'autre.`,
  'parser.squelette-sans-success': ({ ligne }: MsgVars) => `[ModularJS] ligne ${ligne} : {await … *skeleton} — le squelette se tire de la branche {success nom} : écrivez-la.`,
  'parser.squelette-svg': ({ balise, ligne }: MsgVars) => `[ModularJS] ligne ${ligne} : {await … *skeleton} dans un <${balise}> — le squelette est du HTML, il n'a pas sa place dans un <${balise}>. Écrivez vous-même la branche d'attente (avant {success}), ou mettez le <${balise}> entier dans l'{await}.`,
  'parser.bloc-non-ferme': ({ kind, expr, ligne, astuce }: MsgVars) => `

🚨 [BLOC NON FERMÉ] \`{${kind} ${expr}}\` ouvert ligne ${ligne} n'a pas de \`{end}\` correspondant.
   Fin de fichier atteinte avant la fermeture.
👉 ${astuce}

`,
  'parser.attribut-nu-non-supporte': ({ expr, ligne, tag }: MsgVars) => `🚨 [parser] \`{${expr}}\` nu (ligne ${ligne}) : un \`{expr}\` seul n'est un attribut que sur \`<@slot {…}>\` (nom de slot évalué). Sur <${tag}>, écrivez \`nom={${expr}}\` (attribut nommé).`,
  'parser.const-syntaxe-invalide': ({ ligne }: MsgVars) => `🚨 [parser] {const …} invalide (ligne ${ligne}) : syntaxe attendue « {const NOM = EXPR} »`,
  'parser.const-expression-vide': ({ nom, ligne }: MsgVars) => `🚨 [parser] {const ${nom} = …} (ligne ${ligne}) : expression vide.`,
  'parser.for-item-index-homonyme': ({ item, index, ligne }: MsgVars) => `[ModularJS] {for ${item}, ${index} in …} (ligne ${ligne}) : l'item et l'index ne peuvent pas porter le même nom « ${item} ».`,
  'parser.for-syntaxe-invalide': ({ expr, ligne, astuceOf }: MsgVars) => `🚨 [parser] {for ${expr}} invalide (ligne ${ligne}) : syntaxe attendue « {for [idx,] item in liste [by clé]} »${astuceOf}`,
  'parser.for-astuce-in-pas-of': ` — utilisez « in », pas « of »`,
  // piège JSX/Svelte : `{else if cond}` n'est reconnu ni par `{elsif ...}`
  // ni par `{else}` (tous deux stricts) → tombait en expression Civet nue,
  // erreur cryptique très loin de la vraie cause.
  'parser.else-if-non-supporte': ({ expr, ligne }: MsgVars) => `🚨 [parser] {${expr}} (ligne ${ligne}) : \`{else if …}\` n'existe pas en MJS — utilisez \`{elsif …}\`.`,
  'parser.erreur-fatale': ({ extrait }: MsgVars) => `

🚨 [ERREUR DE PARSING FATALE]
Le compilateur ModularJS est bloqué sur une syntaxe invalide ou un caractère illégal.
Extrait incriminé : ${extrait}
👉 Diagnostic : L'analyseur lexical ne parvient pas à consommer la chaîne.

`,
  'parser.balise-fermante-orpheline': ({ nom, ligne }: MsgVars) => `

🚨 [BALISE FERMANTE ORPHELINE] \`</${nom}>\` ligne ${ligne} : aucune balise ouvrante correspondante.
   Sans erreur, tout le template qui suit cette balise serait ignoré en silence.
👉 Supprimez cette fermante en trop, ou ajoutez la balise ouvrante manquante.

`,
  // symétrique de balise-fermante-orpheline, pour un JETON DE FLUX ({end}, {else}, {elsif …},
  // {success …}, {error …}) en trop à la racine, plutôt qu'une balise HTML — même risque
  // (contenu suivant perdu en silence).
  'parser.jeton-flux-orphelin': ({ jeton, ligne }: MsgVars) => `

🚨 [JETON ORPHELIN] \`${jeton}\` ligne ${ligne} : aucun bloc ouvrant ({if}/{for}/{await}/{key}) à refermer.
   Sans erreur, tout le template qui suit ce jeton serait ignoré en silence.
👉 Supprimez ce ${jeton} en trop, ou ajoutez le bloc ouvrant manquant.

`,
  // même jeton en toute fin de gabarit : rien n'est perdu, avertissement seulement (souvent un
  // bloc refermé deux fois)
  'parser.jeton-flux-orphelin-fin': ({ jeton, ligne }: MsgVars) => `[ModularJS] ⚠️  \`${jeton}\` ligne ${ligne} : aucun bloc ouvrant ({if}/{for}/{await}/{key}) à refermer — jeton en trop à la fin du HTML du composant, sans effet. Vérifiez l'imbrication de vos blocs.`,
  // pile d'appels épuisée par un gabarit imbriqué sur des milliers de niveaux (analyse ou génération)
  'parser.imbrication-trop-profonde': ({ ligne }: MsgVars) => `

🚨 [IMBRICATION TROP PROFONDE] vers la ligne ${ligne} : le gabarit est imbriqué sur trop de niveaux
   (balises dans des balises, ou blocs {if}/{for}/{await}/{key} dans d'autres blocs) et la construction a épuisé la pile d'appels.
👉 Réduisez l'imbrication à quelques centaines de niveaux au plus, par exemple en découpant cette partie en composants.

`,
  // jeton de branche dans un bloc qui ne l'attend pas (`{else}` dans un `{for}`, `{success …}` dans un `{if}`) ou
  // dans une balise : son contenu se fondait dans le bloc, sans un mot
  'parser.jeton-flux-hors-bloc': ({ jeton, bloc, ligneBloc, ligne }: MsgVars) => `

🚨 [JETON HORS DE SON BLOC] \`${jeton}\` ligne ${ligne} n'a pas de sens dans \`${bloc}\` (ouvert ligne ${ligneBloc}).
   {else} et {elsif …} ne suivent qu'un {if}, {success …} et {error …} qu'un {await} : sans erreur, son contenu se fondrait dans le bloc.
👉 Refermez d'abord \`${bloc}\`, ou placez ce jeton dans le bloc qui l'attend.${bloc === '{for}' && jeton === '{else}' ? ' Pour une liste vide, entourez le {for} d\'un {if $liste.length}…{else}…{end}.' : ''}

`,
  'parser.for-by-chemin': ({ expr, cle, champ, ligne }: MsgVars) => `🚨 [parser] {for ${expr}} (ligne ${ligne}) : « by ${cle} » — by attend le nom d'un champ de l'élément, sans préfixe ni expression, comme « by ${champ} ».`,
  // balise ouvrante sans `>` ni `/>` (le plus souvent en dernière ligne) : elle disparaissait du composant
  'parser.balise-ouvrante-non-terminee': ({ nom, ligne }: MsgVars) => `

🚨 [BALISE NON TERMINÉE] \`<${nom}\` ouverte ligne ${ligne} n'est jamais terminée par \`>\`.
   Sans erreur, cette balise et son contenu disparaîtraient du composant.
👉 Ajoutez le \`>\` (ou \`/>\`) qui termine la balise ouvrante.

`,
  'parser.view-auto-fermeture-interdite': ({ nom, ligne }: MsgVars) => `🚨 [parser] <@view${nom ? ' ' + nom : ''}/> (ligne ${ligne}) : auto-fermeture interdite — <@view> reçoit son contenu du routeur à l'exécution, écrivez <@view${nom ? ' ' + nom : ''}></@view>.`,
  // Bloc de slot <@fill nom>…</@fill> (nom tenu par FILL_DIRECTIVE) : les 6 messages
  // suivants prennent tous `directive` (jamais « fill » en dur) et la `ligne` du nœud fautif.
  'parser.fill-sans-nom': ({ directive, ligne }: MsgVars) => `🚨 [parser] <@${directive}> sans nom (ligne ${ligne}) : le bloc de slot exige un nom littéral, comme <@slot nom> — écrivez <@${directive} nom>…</@${directive}>.`,
  'parser.fill-nom-dynamique': ({ directive, expr, ligne }: MsgVars) => `🚨 [parser] <@${directive} {${expr}}> (ligne ${ligne}) : nom dynamique refusé — le bloc de slot exige un nom LITTÉRAL (identifiant nu), comme <@slot nom>.`,
  // Un second attribut (nom en trop, `class=`, `{...$rest}`…) était ignoré en
  // silence par expandFillBlock ; `extrait` reprend les attributs TELS QU'ÉCRITS (describeFillAttr).
  'parser.fill-un-seul-nom': ({ directive, ligne, extrait }: MsgVars) => `🚨 [parser] <@${directive} …> (ligne ${ligne}) : un seul nom de slot, rien d'autre — « ${extrait} »`,
  'parser.fill-texte-nu': ({ directive, nom, ligne }: MsgVars) => `🚨 [parser] texte nu dans <@${directive} ${nom}> (ligne ${ligne}) : un texte ne peut pas viser un slot nommé — enveloppez-le dans un élément (ex. <span slot="${nom}">…</span>).`,
  'parser.fill-slot-deja-pose': ({ directive, nom, tag, ligne }: MsgVars) => `🚨 [parser] <${tag} slot="…"> (ligne ${ligne}) : cet enfant de <@${directive} ${nom}> porte déjà son propre slot= — retirez l'un des deux.`,
  'parser.fill-imbrique': ({ directive, ligne }: MsgVars) => `🚨 [parser] <@${directive}> imbriqué (ligne ${ligne}) : un bloc <@${directive}> ne peut pas en contenir un autre — séparez-les en enfants directs du composant appelé.`,
  // Balise fermante qui NE CORRESPOND PAS à la balise ouverte la plus récente — AVERTISSEMENT
  // seul (pas d'erreur, pour ne casser aucun site existant) : respecte les fermetures implicites
  // légitimes du HTML (cf. IMPLICIT_CLOSE_TAGS, parser/index.ts), sinon la balise attendue est
  // vraiment restée ouverte à tort.
  'parser.fermeture-mal-appariee': ({ attendu, trouve, ligneOuverture, ligneFermeture }: MsgVars) => `[ModularJS] ⚠️  <${attendu}> ouverte ligne ${ligneOuverture} n'est pas refermée par </${attendu}> : </${trouve}> rencontrée ligne ${ligneFermeture} à la place. Vérifiez l'imbrication des balises.`,
  // `{{expr}}` (HTML brut, docs/07-bindings.md) exige DEUX accolades fermantes. Une seule
  // (`{{value}`) n'est PAS une forme documentée : ERREUR plutôt qu'un HTML brut tronqué accepté
  // en silence.
  'parser.html-brut-mal-ferme': ({ ligne }: MsgVars) => `

🚨 [DOUBLE ACCOLADE INCOMPLÈTE] \`{{…}\` ligne ${ligne} : une seule accolade fermante trouvée.
   L'interpolation HTML brut \`{{ expr }}\` exige DEUX accolades fermantes.
👉 Ajoutez l'accolade manquante (\`{{expr}}\`), ou si un \`{\` littéral était voulu, écrivez \`&#123;\`.

`,

  // — src/generator/compile.ts —
  'generator.const-hors-for': ({ nom, expr }: MsgVars) => `
🚨 [ModularJS] {const ${nom} = …} hors d'un {for} n'est pas supporté.
   Au niveau racine, déclarez plutôt une dérivée réactive dans le <script> :
   \`$${nom} = ${expr}\`  (auto-derived), puis lisez \`{$${nom}}\`.
   Le {const} local reste réservé aux blocs {for} (cas Svelte {@const}).
`,
  // attribut STATIQUE contenant littéralement `#{…}` (interpolation Civet,
  // réservée au <script>) : n'interpole PAS, avertissement seul (jamais bloquant).
  'generator.interpolation-civet-attribut': ({ module, attr, valeur, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (ligne ${ligne})` : ''} : attribut "${attr}" — « #{ … } » n'est pas l'interpolation d'attribut : le « # » s'affichera tel quel devant la valeur (${valeur}). Écrivez { … } sans « # » ; #{ } n'existe que dans le <script> Civet.`,
  'generator.attribut-booleen-false': ({ module, balise, attr, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (ligne ${ligne})` : ''} : <${balise} ${attr}="false"> garde « ${attr} » actif — pour un attribut booléen HTML, sa seule présence vaut vrai, quelle que soit la valeur écrite. Retirez l'attribut, ou liez-le à une valeur : ${attr}={false}.`,
  'generator.diese-dans-le-html': ({ module, extrait, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (ligne ${ligne})` : ''} : « ${extrait} » — hors du <script>, un « # » en tête de ligne n'est pas un commentaire : ce texte s'affiche à l'écran. Un commentaire dans le HTML s'écrit <!-- … -->.`,

  // — src/generator/paths.ts —
  'generator.extract-paths-boucle-infinie': ({ i, len, extrait }: MsgVars) => `[ModularJS] extractPaths : boucle infinie détectée (index bloqué à ${i}/${len}). HTML probablement malformé près de : ${extrait}`,
  'generator.create-fn-body-boucle-infinie': ({ i, len, extrait }: MsgVars) => `[ModularJS] generateCreateFnBodyImperative : boucle infinie détectée (index bloqué à ${i}/${len}). HTML probablement malformé près de : ${extrait}`,

  // — src/generator/utils.ts —
  'generator.hook-cycle-vie-interpolation': ({ nom }: MsgVars) => `[ModularJS] « µ${nom} » : les hooks de cycle de vie se déclarent dans le <script> du composant, pas dans une interpolation {…} ni un handler.`,
  // (src/generator/utils.ts:312 réutilise 'lexer.symbole-declare-civet' — garde jumelle, texte identique)
  // (réutilisée aussi par src/transpiler/index.ts:2062)
  'generator.every-hors-script': `[ModularJS] « µevery » : se déclare dans le <script> du composant (niveau racine), pas dans une interpolation {…} ni un handler.`,
  'generator.derived-hors-script': `[ModularJS] « µderived » : se déclare dans le <script> du composant (niveau racine), pas dans une interpolation {…} ni un handler.`,
  'generator.hint-ternaire-colle': ` Indice : ternaire collé « a?b:c » détecté — ajoutez des espaces (« a ? b : c ») ; l'existentiel Coffee « a ? b » (sans « : ») s'écrit « a ?? b » en Civet.`,
  'generator.hint-dans-module': ({ moduleName }: MsgVars) => ` dans « ${moduleName} »`,
  'generator.interpolation-echec-civet': ({ moduleHint, rawExprForError, civetMsg, gluedTernaryHint }: MsgVars) => `[ModularJS] interpolation : échec de compilation Civet${moduleHint} — « ${rawExprForError} » — ${civetMsg}${gluedTernaryHint}`,

  // — src/generator/attributes/index.ts —
  'generator.this-sans-point-exclamation': ({ expr }: MsgVars) => `[ModularJS] « @this={${expr}} » : une référence au nœud s'écrit avec un point d'exclamation, écrivez @this=!{${expr}}. Sans lui, @this serait lu comme l'écoute d'un événement nommé « this », et ${expr} ne recevrait jamais le nœud. Cf. docs/09-directives-dom.md.`,
  'generator.this-sans-reference': ({ ecrit, ref }: MsgVars) => `[ModularJS] « ${ecrit} » : une référence au nœud s'écrit @this=!{${ref}}, une variable entre accolades après un point d'exclamation. Sans elle, @this serait lu comme l'écoute d'un événement nommé « this », et aucune variable ne recevrait le nœud. Cf. docs/09-directives-dom.md.`,
  'generator.preload-sans-valeur': () => `[ModularJS] « @preload » sans valeur : le préchargement d'un lien se règle par une valeur, écrivez @preload="hover" (au survol), @preload="on" (dès que le lien paraît) ou @preload="off" (jamais). Sans valeur, @preload serait lu comme l'écoute d'un événement nommé « preload », et rien ne serait préchargé ; pour écouter un tel événement, écrivez @preload={…}. Cf. docs/17-router.md.`,
  'generator.this-ref-reactive': ({ varExpr, plain }: MsgVars) => `[mjs] @this=!{${varExpr}} : référence DOM liée à une variable RÉACTIVE « $ ». Chaque écriture (${varExpr}.style.x = …) passe alors par la réactivité (coût µ._mjs_deepSet). Pour une simple référence DOM, utilisez une variable SANS « $ » : @this=!{${plain}}. Cf. docs/09-directives-dom.md.`,
  // littéral émis DANS le code généré (navigateur) — cf. risques §5, insertion ${JSON.stringify(t(...))} au site d'appel
  'generator.erreur-intro': `[ModularJS] Erreur intro:`,
  'generator.echec-intro': `[ModularJS] Échec intro:`,
  'generator.hint-cast-suffixe-nom': ({ attrName, cast }: MsgVars) => ` Pour un cast de type, le suffixe va sur le NOM de l'attribut : « ${attrName}.${cast}=!{…} » (et non « ${attrName}=!.${cast}{…} »).`,
  'generator.hint-syntaxe-two-way': ({ attrName }: MsgVars) => ` La syntaxe d'une liaison two-way est « ${attrName}=!{expression} » (des accolades autour de l'expression).`,
  'generator.liaison-two-way-malformee': ({ attrName, rawVal, hint }: MsgVars) => `[ModularJS] Liaison two-way mal formée : « ${attrName}=${rawVal} ».${hint}`,
  'generator.emit-forme-non-reconnue': ({ attrName }: MsgVars) => `[ModularJS] « ${attrName} » : forme d'émission non reconnue — utilisez @emit.NOM_EVENEMENT={expr} ou @emit.once.NOM_EVENEMENT={expr}.`,
  'generator.emit-evenement-brut': ({ module, nomEvenement, ligne }: MsgVars) => `[ModularJS] ${module}${ligne ? ` (ligne ${ligne})` : ''} : « µemit '${nomEvenement}', e » relaie l'ÉVÉNEMENT reçu, pas sa charge — le parent lira « e.data » sur le CustomEvent et trouvera undefined. Envoyez « e.data » (ou l'expression voulue), pas « e » tel quel.`,
  // Sucre « au geste, émets » (@click.emit.NOM) + garde anti-faute-de-frappe sur les
  // modificateurs d'événement — BLOQUANTS tous les deux.
  'generator.event-emit-forme': ({ attrName, evt }: MsgVars) => `[ModularJS] « ${attrName} » : forme d'émission sur le geste non reconnue — écrivez « @${evt}.emit.NOM » (avec charge utile : « @${evt}.emit.NOM={expr} »). Le nom émis est le DERNIER segment : les modificateurs se posent avant (« @${evt}.stop.emit.NOM »), et ce nom ne peut contenir ni point ni apostrophe.`,
  'generator.event-modificateur-inconnu': ({ attrName, mod, hint }: MsgVars) => `[ModularJS] « ${attrName} » : « .${mod} » n'est pas un modificateur d'événement — les seuls reconnus sont .prevent, .stop, .self, .once, .propagate, plus le sucre .emit.NOM.${hint} Un nom d'événement ne peut pas contenir de point non plus : le point sépare les segments.`,
  'generator.attach-modificateur-inconnu': ({ attrName, mod, hint }: MsgVars) => `[ModularJS] « ${attrName} » : « .${mod} » n'est pas un modificateur d'attache — le seul reconnu est .once (la fabrique n'est appelée qu'une fois par balise) : écrivez @attach.once={fabrique(args)}.${hint}`,
  'generator.hint-modificateur-suggestion': ({ suggestion }: MsgVars) => ` Vouliez-vous dire « .${suggestion} » ?`,
  'generator.macro-modificateur-non-gere': ({ evt, suffixe }: MsgVars) => `[ModularJS] « @${evt}.${suffixe} » sur une macro globale (<@window>/<@document>/<@body>/<@head>) : les modificateurs et le sucre d'émission n'y sont PAS gérés — ces écouteurs sont posés en direct, hors du routeur délégué. Écrivez « @${evt}={…} » et appelez « µemit » dans le corps si vous voulez émettre.`,
  'generator.event-deux-points-abrege': ({ evt }: MsgVars) => `[ModularJS] « @${evt} » : forme abrégée interdite pour un événement à deux-points — écrivez « @${evt}={…} » avec le code à exécuter. La forme abrégée appelle la méthode du même nom que l'événement, et « ${evt} » n'est pas un nom de méthode possible (le deux-points compilait un objet jeté, sans la moindre erreur).`,

  // — src/analyzer/index.ts —
  'analyzer.prefixe-mjs-reserve': ({ varName, nomCourt }: MsgVars) => `[ModularJS] ⚠️  $.${varName} : préfixe '_mjs_' est réservé au framework. Renommer en $.${nomCourt} ou autre pour éviter une collision avec les props internes.`,
  'analyzer.effect-lit-ecrit-boucle': ({ liste }: MsgVars) => `[ModularJS] ⚠️  µeffect qui LIT et ÉCRIT ${liste} — risque de boucle réactive (l'effet se re-déclenche lui-même). Écrivez une AUTRE variable (ex. $double = $n * 2), ou garantissez la convergence. Sinon le garde-fou runtime abandonne le rendu.`,
  'analyzer.resolve-dependance-non-convergent': `[ModularJS] resolveDependencyGraph : >100 passes sans convergence — closure de dépendances possiblement incomplète (graphe réactif anormalement profond).`,
  'analyzer.cycle-reactif-detecte': ({ func }: MsgVars) => `[ModularJS] Cycle réactif : '${func}' se lit lui-même, directement ou par un autre dérivé — sa valeur ne peut pas se calculer (undefined, NaN dans un calcul). Pour un calcul fait une seule fois au départ, écrivez \`$${func} =: …\` ; sinon, donnez un autre nom au résultat.`,
  'transpiler.etat-premiere-lettre-accentuee': ({ nom, suggestion }: MsgVars) => `🚨 [ModularJS] \`${nom}\` : le nom d'une variable réactive commence par une lettre sans accent (a-z, A-Z) ou par « _ » — écrivez \`${suggestion}\`.`,
  'analyzer.derived-hors-racine': `[ModularJS] « µderived » doit être déclaré au niveau racine du <script> du composant, pas à l'intérieur d'une fonction.`,

  // — src/transpiler/directives.ts —
  'transpiler.i18n-double': ({ ancienneSection, section }: MsgVars) => `[ModularJS] @i18n en double : « ${ancienneSection} » puis « ${section} » — un seul \`@i18n\` par module ; pour plusieurs sections, nommez-les sur la même ligne : @i18n 'a' 'b'.`,
  'transpiler.i18n-ligne-invalide': ({ ligne }: MsgVars) => `[ModularJS] @i18n : la ligne « ${ligne} » n'a pas la forme de la directive — écrivez les sections entre guillemets, séparées par des espaces (sans virgule), seules sur la ligne : @i18n 'accueil' 'onglets-admin'.`,
  'transpiler.form-associated-plusieurs-fois': ({ moduleName }: MsgVars) => `[ModularJS] ${moduleName} : @formAssociated est écrit plusieurs fois — une seule ligne suffit, retirez les autres.`,
  'transpiler.form-associated-ligne-invalide': ({ ligne }: MsgVars) => `[ModularJS] @formAssociated : la ligne « ${ligne} » n'a pas la forme de la directive — elle ne prend aucune valeur, écrivez @formAssociated seul sur sa ligne.`,
  'transpiler.i18n-section-ecrite-deux-fois': ({ section }: MsgVars) => `[ModularJS] @i18n : « ${section} » est écrit deux fois — nommez chaque section une seule fois.`,
  'transpiler.i18n-section-invalide': ({ section }: MsgVars) => `[ModularJS] @i18n : « ${section} » n'est pas un nom de section valide — minuscules, chiffres, tirets et underscores uniquement (ex. @i18n 'panier').`,
  'i18n.attente-invalide': ({ ou, valeur, valides }: MsgVars) => `${ou} : « ${valeur} » n'est pas une attente permise — valeurs permises : ${valides} (seuls les effets de chargement sont permis).`,
  'i18n.attente-auto': ({ ou, exemple }: MsgVars) => `${ou} : « auto » n'existe plus — écrivez ${exemple} pour les barres grises à la place de chaque texte (le rendu d'avant). Sans rien écrire, le module attend ses textes avant de paraître (wait).`,
  'i18n.attente-variable': ({ ou, effet, valeur }: MsgVars) => `${ou} : *${effet}(${valeur}) — les réglages s'écrivent en valeurs fixes, par exemple *loader(bloom) ; une variable n'a rien à suivre ici.`,
  'i18n.attente-reglage-sans-sens': ({ ou, effet, reglage, valides }: MsgVars) => `${ou} : *${effet}(${reglage}) — ce réglage n'a pas de sens pour des textes : ce sont de simples barres peintes derrière chaque texte, sans mouvement ni arrondi. Réglage permis : ${valides}.`,
  // partagée avec src/transpiler/index.ts:1348,1378 (texte identique)
  'transpiler.vt-off-nexiste-pas': ({ label }: MsgVars) => `[ModularJS] ${label} : 'off' n'existe pas — forme nue pour activer, 'none' pour couper.`,
  // partagée avec src/transpiler/index.ts:1349,1379 (texte identique)
  'transpiler.vt-on-implicite': ({ label }: MsgVars) => `[ModularJS] ${label} : 'on' est implicite — écrivez la directive nue pour activer.`,
  // partagée avec src/transpiler/index.ts:1353 (texte identique) :
  // `example` PROPRE à chaque appelant, @pageTransition (lien, forme CHAÎNE) n'a pas la même
  // syntaxe que les 4 positions @viewTransition (forme à POINT) — un seul exemple pour les deux
  // était trompeur (@pageTransition.cube={...} n'existe pas)
  'transpiler.vt-direction-plus-dans-nom': ({ label, example }: MsgVars) => `[ModularJS] ${label} : la direction ne s'écrit plus dans le nom — écrivez ${example}.`,
  'transpiler.vt-nom-erreur-parsing': ({ label, nameAndDir, erreur }: MsgVars) => `[ModularJS] ${label}.${nameAndDir} : ${erreur}`,
  'transpiler.vt-ancienne-ecriture-remplacee': ({ label }: MsgVars) => `[ModularJS] ${label} : l'ancienne écriture '${label} <nom> [priorité]' a été remplacée — écrivez ${label}.<nom>={ direction: …, duration: …, priority: … } (options facultatives).`,
  'transpiler.i18n-placeholder-wait-sans-section': ({ mode }: MsgVars) => `[ModularJS] @i18nPlaceholder ${mode} : exige une section @i18n à attendre — ajoutez @i18n 'nom' (ou utilisez key ou *skeleton, qui ne dépendent pas d'une section).`,
  // RELOGEMENT — @css/@display/@viewTransition/@vt quittent la racine du
  // fichier, ce sont désormais des attributs de <style> (cf. transpiler/sections.ts).
  'transpiler.css-racine-interdite': ({ ligne, remplacement }: MsgVars) => `[ModularJS] @css ne s'écrit plus à la racine du fichier : c'est un attribut de <style>.\nRemplacez la ligne « ${ligne} » par : ${remplacement}`,
  'transpiler.display-racine-interdite': ({ ligne, remplacement }: MsgVars) => `[ModularJS] @display ne s'écrit plus à la racine du fichier : c'est un attribut de <style>.\nRemplacez la ligne « ${ligne} » par : ${remplacement}`,
  'transpiler.viewtransition-racine-interdite': ({ label, ligne, remplacement }: MsgVars) => `[ModularJS] ${label} ne s'écrit plus à la racine du fichier : c'est un attribut de <style>.\nRemplacez la ligne « ${ligne} » par : ${remplacement}`,
  'transpiler.style-attr-sur-layout': ({ attribut, nom }: MsgVars) => `[ModularJS] ${attribut} n'est valide que sur le <style> de base (sans name=) — trouvé sur <style name="${nom}">.`,
  'transpiler.viewtransition-guillemets-sur-style': ({ label }: MsgVars) => `[ModularJS] ${label}="…" avec guillemets n'existe plus sur <style> — écrivez ${label}.<nom>={ direction: …, duration: …, priority: … } (options facultatives).`,
  'transpiler.viewtransition-forme-invalide-sur-style': ({ label, rest }: MsgVars) => `[ModularJS] ${label}${rest} sur <style> : forme invalide — écrivez ${label}.<nom>={ direction: …, duration: …, priority: … }, ou ${label} nu.`,
  'transpiler.vt-alias-sur-style-interdit': `[ModularJS] @vt n'est pas un alias sur <style> — écrivez @viewTransition.<nom>={ … } (ou @viewTransition nu).`,
  // RENOMMAGE — @vt sur <a> devient @pageTransition, seule orthographe
  // du mécanisme de transition de PAGE niveau UJS (cf. transpiler/index.ts).
  'transpiler.vt-renomme-pagetransition': ({ ligne, remplacement }: MsgVars) => `[ModularJS] @vt ne s'écrit plus ainsi : c'est désormais @pageTransition.\nRemplacez la ligne « ${ligne} » par : ${remplacement}`,
  // @pageTransition (lien) accepte aussi la syntaxe OBJET `nom={ direction: …, duration: … }`
  // (MÊME mini-grammaire que <@view>/<style> ci-dessus, parseVtValue). `priority`/`p`
  // REFUSÉ ici (pas une clé neuve à la grammaire, un refus délibéré) : la cascade d'un lien n'a que 2
  // niveaux (lien, config, cf. µ._mjs_vtResolvePage), aucun arbitrage départ/arrivée à départager
  // (_vtWinner/_vtResolveWithPriority sont réservés au routeur/<@view>, mjs_router.ts).
  'transpiler.pagetransition-forme-invalide': ({ label, val }: MsgVars) => `[ModularJS] ${label}="${val}" : forme invalide — écrivez ${label}="<nom>", "on", "off", ou ${label}="<nom>={ direction: …, duration: … }".`,
  'transpiler.pagetransition-erreur-parsing': ({ label, valeur, erreur }: MsgVars) => `[ModularJS] ${label}="${valeur}" : ${erreur}`,
  'transpiler.pagetransition-priority-sans-effet': ({ label, valeur }: MsgVars) => `[ModularJS] ${label}="${valeur}" : 'priority'/'p' n'a pas d'effet sur un lien — la cascade n'a que 2 niveaux (lien, config), rien à départager (_vtWinner/_vtResolveWithPriority sont réservés au routeur/<@view>) ; retirez l'option.`,
  'transpiler.persist-nom-invalide': ({ nomVar }: MsgVars) => `[ModularJS] @persist : « ${nomVar} » n'est pas un nom de variable valide — séparez les variables par un espace (@persist $a $b).`,
  'transpiler.import-virgule-interdite': ({ rawVars, targetPath }: MsgVars) => `[ModularJS] @import ${rawVars} '${targetPath}' : virgule interdite entre les noms — séparez-les par un espace (@import nomA nomB '${targetPath}').`,
  // les balises de section (<style>/<script>/<theme>/<routes>)
  // n'atteignent jamais le DOM : un attribut qu'elles ne reconnaissent pas, ou une directive
  // racine mal écrite (@improt, @persit), arrête désormais la compilation
  'transpiler.section-attribut-inconnu': ({ tag, attribut, attendus }: MsgVars) => `[ModularJS] <${tag} ${attribut}> : attribut inconnu — une balise <${tag}> n'atteint jamais le DOM, seuls ${attendus} y ont un sens.`,
  'transpiler.section-attribut-inconnu-suggestion': ({ tag, attribut, suggestion, attendus }: MsgVars) => `[ModularJS] <${tag} ${attribut}> : attribut inconnu — vouliez-vous dire « ${suggestion} » ? Sur <${tag}>, seuls ${attendus} ont un sens.`,
  'transpiler.directive-racine-inconnue': ({ nom, suggestion }: MsgVars) => `[ModularJS] « @${nom} » en tête de ligne n'est pas une directive racine — vouliez-vous dire « @${suggestion} » ? (directives racines : @import, @persist)`,

  // — src/transpiler/sections.ts —
  'transpiler.script-module-double': ({ n, nAutres }: MsgVars) => `[ModularJS] ${n} balises <script module> trouvées — un seul bloc est permis par composant : fusionnez-les en un seul (avant cette règle, le contenu des ${nAutres} autre(s) était jeté en silence).`,
  'transpiler.script-double': ({ n, nAutres }: MsgVars) => `[ModularJS] ${n} balises <script> (hors module) trouvées — un seul bloc est permis par composant : fusionnez-les en un seul (avant cette règle, le contenu des ${nAutres} autre(s) était jeté en silence).`,
  'transpiler.style-double': ({ n, nAutres }: MsgVars) => `[ModularJS] ${n} balises <style> trouvées — un seul bloc est permis par composant : fusionnez-les en un seul, ou utilisez plusieurs sélecteurs dans le même bloc (avant cette règle, le contenu des ${nAutres} autre(s) était jeté en silence).`,
  'transpiler.theme-double': ({ nom }: MsgVars) => `[ModularJS] deux blocs <theme${nom === '' ? '' : ` name="${nom}"`}> dans le même composant — un seul bloc sans nom, et un seul par nom.`,
  'transpiler.theme-name-invalide': ({ nom }: MsgVars) => `[ModularJS] <theme name="${nom}"> : nom de variante invalide — minuscules, chiffres et tirets uniquement (ex. <theme name="gold">).`,
  'transpiler.layout-name-invalide': ({ nom }: MsgVars) => `[ModularJS] <style name="${nom}"> : nom de variant invalide — minuscules, chiffres et tirets uniquement (ex. <style name="bandeau">).`,
  'transpiler.layout-double': ({ nom }: MsgVars) => `[ModularJS] deux blocs <style name="${nom}"> dans le même composant — un variant par nom.`,
  'transpiler.layout-default': `[ModularJS] <style name="default"> : « default » est le modèle de base (le composant lui-même, celui de {? default}) — donnez un autre nom à ce modèle.`,
  'transpiler.variable-racine-sans-selecteur': ({ nom, ligne, bloc }: MsgVars) => `[ModularJS] $$${nom} est déclaré à la racine du ${bloc} (ligne ${ligne}) — une surcharge a besoin d'un sélecteur (:host, une classe…) pour s'accrocher. Rangez la ligne sous un sélecteur, ou déclarez la variable dans un <theme> si elle doit valoir pour tout le composant.`,
  'transpiler.balise-orpheline-html': ({ balise }: MsgVars) => `[ModularJS] un ${balise} orphelin traîne dans le HTML du composant — l'extraction des sections est partie en vrille. Causes probables : une chaîne non terminée qui contient ${balise} par erreur de frappe, ou une balise d'ouverture en majuscules non reconnue (ex. <SCRIPT>/<STYLE>). Remède : échappez/scindez la balise dans la chaîne (ex. '</scr' + 'ipt>'), vérifiez la fermeture de vos chaînes, ou repassez la balise d'ouverture en minuscules.`,
  'transpiler.routes-target-manquant': `[ModularJS] <routes> : l'attribut target="…" est obligatoire — c'est l'id du <@view id="…"> (outlet) que ces routes alimentent.`,
  'transpiler.routes-target-double': ({ target }: MsgVars) => `[ModularJS] deux blocs <routes target="${target}"> dans le même composant — un seul bloc par target.`,
  // types et valeurs permises : <vars> (composant) et <types> (fichier *.types.mjs), transpiler/var-types.ts
  'transpiler.vars-double': ({ n }: MsgVars) => `[ModularJS] ${n} blocs <vars> dans le même composant — un seul, qui déclare toutes ses variables, props et stores typés.`,
  'transpiler.section-sans-attribut': ({ tag, attributs }: MsgVars) => `[ModularJS] <${tag} ${attributs}> : un bloc <${tag}> ne prend aucun attribut.`,
  'transpiler.vars-apres-script': ({ ligne }: MsgVars) => `[ModularJS] <vars> (ligne ${ligne}) après le <script> — placez le bloc <vars> avant le <script> : la règle d'une variable se lit avant le code qui l'écrit.`,
  'transpiler.composant-sans-html': ({ moduleName }: MsgVars) => `[ModularJS] ${moduleName} : ce composant n'a pas de HTML — il ne rend rien. Ajoutez son HTML ; s'il ne sert qu'à du script, un module .civet convient mieux.`,
  'transpiler.types-dans-composant': ({ ligne }: MsgVars) => `[ModularJS] ligne ${ligne} : un bloc <types> dans un composant — les règles nommées vivent dans un fichier *.types.mjs, valable dans toute l'appli ; le composant déclare ses variables dans son <vars>.`,
  'transpiler.effets-dans-composant': ({ ligne }: MsgVars) => `[ModularJS] ligne ${ligne} : un bloc <effects> dans un composant — les effets de l'appli vivent dans un fichier *.effects.mjs, valables dans tous ses composants.`,
  'transpiler.include-vars': `un partiel inclus ne porte ni <vars>, ni <types>, ni <effects> — déclarez les types dans le <vars> du composant qui l'inclut, et les effets de l'appli dans un fichier *.effects.mjs.`,
  'transpiler.routes-ligne-invalide': ({ target, ligne, texte }: MsgVars) => `[ModularJS] <routes target="${target}">, ligne ${ligne} : « ${texte} » — attendu un chemin puis un nom de composant, séparés par un espace (ex. /guide/:id  guide-page).`,
  'transpiler.routes-chemin-sans-slash': ({ target, ligne, chemin }: MsgVars) => `[ModularJS] <routes target="${target}">, ligne ${ligne} : le chemin « ${chemin} » doit commencer par /.`,
  'transpiler.routes-chemin-mal-forme': ({ target, ligne, chemin }: MsgVars) => `[ModularJS] <routes target="${target}">, ligne ${ligne} : chemin « ${chemin} » mal formé — segments acceptés : littéral, :param, (:param) ou (littéral) optionnel (à n'importe quelle position), * catch-all en fin de route uniquement.`,
  'transpiler.routes-composant-invalide': ({ target, ligne, composant }: MsgVars) => `[ModularJS] <routes target="${target}">, ligne ${ligne} : « ${composant} » n'est pas un nom de composant valide — minuscules, chiffres et tirets, sans le préfixe mjs- (ex. guide-page).`,
  'transpiler.routes-chemin-double': ({ target, chemin }: MsgVars) => `[ModularJS] <routes target="${target}"> : le chemin « ${chemin} » apparaît deux fois dans le même bloc.`,
  'transpiler.routes-script-reassigne': `[ModularJS] ⚠️ le script RÉASSIGNE @routes alors qu'un bloc <routes> existe : la table déclarative est remplacée. Si vous voulez seulement l'enrichir, complétez-la (@routes['cible']['/x'] = 'composant') au lieu de la réassigner.`,

  // — src/transpiler/macros.ts —
  'transpiler.failed-retry-invalide': ({ valeur }: MsgVars) => `[ModularJS] <@failed> : « ${valeur} » — retry attend un entier positif ou nul (ex. retry="3", retry="0" pour interdire tout réessai).`,
  'transpiler.failed-boundary-retry-epuise': ({ limit }: MsgVars) => `[ModularJS] <@failed> : limite de réessai atteinte (${limit}) — abandon, plus de nouvelle tentative automatique.`,
  'transpiler.head-attr-interpolation-sans-guillemets': ({ macro, ligne, forme, correction }: MsgVars) => `[ModularJS] <@${macro}> ligne ${ligne} : « ${forme} » — dans une balise, une interpolation doit être entre guillemets, sinon un espace dans la valeur ajoute un attribut. Écrivez ${correction}.`,
  'transpiler.head-interpolation-position-attribut': ({ macro, ligne, forme }: MsgVars) => `[ModularJS] <@${macro}> ligne ${ligne} : « ${forme} » — une expression ne peut pas tenir lieu d'attribut dans une balise. Nommez l'attribut et mettez la valeur entre guillemets : <meta name="…" content="{$x}">.`,
  'transpiler.head-interpolation-position-balise': ({ macro, ligne, forme }: MsgVars) => `[ModularJS] <@${macro}> ligne ${ligne} : « ${forme} » — une expression ne peut pas tenir lieu de nom de balise. Écrivez la balise en clair et mettez la donnée dans un attribut entre guillemets ou en texte.`,
  'transpiler.head-script-inerte': ({ ligne }: MsgVars) => `[ModularJS] <@head> ligne ${ligne} : ce <script> sera ajouté au <head> mais ne s'exécutera jamais — le navigateur n'exécute pas un script inséré comme contenu HTML. Chargez-le dans la page qui accueille l'application (index.html), importez-le dans le <script> du composant, ou créez-le au montage du composant avec document.createElement('script'). Seul un script de données (type="application/ld+json") a sa place dans <@head>.`,
  'transpiler.include-slash-final-interdit': ({ target, selfClose, clean }: MsgVars) => `<@include ${target}${selfClose}> : slash final interdit — écrire <@include ${clean}>`,
  'transpiler.include-partial-introuvable': ({ target, baseDir }: MsgVars) => `Partial introuvable : <@include ${target}> (depuis ${baseDir})`,
  'transpiler.include-circulaire': ({ target }: MsgVars) => `<@include> circulaire détecté sur « ${target} » — inclusion ignorée.`,
  'transpiler.include-sans-basedir': ({ target }: MsgVars) => `<@include ${target}> ignoré : compilation sans chemin de fichier (baseDir absent), le partial ne peut pas être résolu`,
  'transpiler.include-hors-racine': ({ target, chemin }: MsgVars) => `<@include ${target}> : ce chemin ('${chemin}') est HORS de sourceDir — jamais suivi ni inliné, pour ne pas publier un fichier hors du projet. Retirez ce chemin ou pointez-le vers un partial interne à sourceDir.`,
  'transpiler.window-propriete-non-liable': ({ prop, liables }: MsgVars) => `<@window ${prop}=!{…}> : propriété non liable. Liables : ${liables}`,
  'transpiler.liaison-reservee-window': ({ macro, prop, liables }: MsgVars) => `<@${macro} ${prop}=!{…}> : une liaison \`nom=!{…}\` n'existe que sur <@window> (propriétés liables : ${liables}) — écrivez-la sur <@window>.`,
  'transpiler.macro-class-interpolation-non-supportee': ({ macro }: MsgVars) => `<@${macro} class="…{…}…"> : interpolation non supportée dans class= d'une macro globale — utilisez @class{cond}="classe".`,
  'transpiler.macro-style-inline-interdit': ({ macro }: MsgVars) => `<@${macro} style="…"> : style inline interdit (règle MJS zéro-CSS-inline). Utilisez @style.prop={expr}, --var={expr}, ou la feuille de style globale.`,
  'transpiler.macro-class-non-supportee-cible': ({ macro }: MsgVars) => `<@${macro} class=…> : liaisons class/style non supportées sur cette cible (réservées à <@body>/<@html>).`,
  'transpiler.macro-auto-fermeture-interdite': ({ macro }: MsgVars) => `<@${macro}/> : auto-fermeture interdite — <@${macro}> attend un contenu, fermez-le explicitement (<@${macro}>…</@${macro}>).`,
  'transpiler.macro-balise-non-fermee': ({ macro, extrait }: MsgVars) => `balise <@${macro}> jamais refermée (accolade ou guillemet ouvert sans fermeture) : « ${extrait}… »`,
  'transpiler.include-malforme': ({ extrait }: MsgVars) => `<@include> mal formé : « ${extrait}… » — la forme attendue est <@include chemin> (un chemin seul, sans attribut)`,
  'transpiler.element-accept-invalide': ({ valeur }: MsgVars) => `attribut accept="${valeur}" invalide sur <@element>/<@module> : une liste de noms de balises séparés par des espaces, littérale (ex. accept="iframe style").`,
  'transpiler.element-variable-attendue': ({ macro, extrait }: MsgVars) => `<@${macro}> : la variable de balise doit venir en premier, avant les attributs (${extrait})`,
  'transpiler.element-expression-interdite': ({ macro, extrait }: MsgVars) => `<@${macro}> : le tag est une variable ($tag), pas une expression entre accolades — calculez la valeur dans une dérivée (${extrait})`,

  // — src/transpiler/index.ts —
  'transpiler.import-singleton-ancienne-forme': ({ nom }: MsgVars) => `[ModularJS] « @import §§${nom} » : cette écriture n'existe plus — un singleton s'importe désormais avec « @import µ$$${nom} », puis se consomme en « µ$$${nom} » (§§${nom} reste réservé au contexte réactif d'ancêtres, jamais à l'import).`,
  'transpiler.singleton-mauvaise-consommation': ({ nom }: MsgVars) => `[ModularJS] Le singleton importé « ${nom} » se consomme avec « µ$$${nom} », pas « $${nom} » / « $$${nom} » / « §§${nom} » (@import µ$$${nom} = l'import ; µ$$${nom} = la lecture réactive ; §§${nom} reste le contexte réactif d'ancêtres, un espace différent).`,
  'transpiler.singleton-sans-import': ({ nom }: MsgVars) => `[ModularJS] « µ$$${nom} » utilisé sans « @import µ$$${nom} » correspondant (ni « export µ$$${nom} » dans ce fichier) — µ$$ ne se lit que pour un nom explicitement importé, ou exporté depuis ce même module.`,
  'transpiler.rune-effect-dans-module': ({ rune, ligne }: MsgVars) => `[ModularJS] « ${rune} » dans <script module> (ligne ${ligne}) — le module s'exécute à l'import, sans composant actif : µeffect/µinspect s'appellent au TOP-LEVEL du <script> composant.`,
  'transpiler.rune-effect-imbriquee': ({ rune, ligne }: MsgVars) => `[ModularJS] « ${rune} » imbriqué (ligne ${ligne}) — µeffect/µinspect s'appellent au TOP-LEVEL du composant : déplacez l'appel au niveau racine du <script> (imbriqué — handler, hook, setTimeout… — il était ignoré en silence au runtime).`,
  'transpiler.rune-emit-dans-module': ({ rune, ligne }: MsgVars) => `[ModularJS] « ${rune} » dans <script module> (ligne ${ligne}) — le module s'exécute à l'import, sans composant actif : aucun élément à qui faire émettre l'événement. L'émission appartient au <script> (ou à une méthode appelée depuis lui).`,
  'transpiler.rune-separee-du-symbole': ({ symbole, rune, lieu, ligne }: MsgVars) => `[ModularJS] « ${symbole} » séparé de sa rune « ${rune} » par un espace ou un retour à la ligne (${lieu}, ligne ${ligne}) — écrivez ${symbole}.${rune} d'un seul tenant, sur une seule ligne : coupée ainsi, la rune échappe à la réécriture et à la détection du compilateur, et le code peut planter à l'exécution.`,
  'transpiler.on-url-change-legacy': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName}${ligne ? ` (ligne ${ligne})` : ''} : « @onUrlChange = -> » : forme V1 retirée — le routeur ne l'appelle plus ; écrivez la rune « µurlChange (path, params) -> ».`,
  'transpiler.code-inaccessible': ({ fichier, ligne, mot }: MsgVars) => `[ModularJS] '${fichier}'${ligne ? ` (ligne ${ligne})` : ''} : ce code suit un « ${mot} » dans le même bloc, il ne sera jamais exécuté — la construction de production le retire sans rien dire. Retirez ce code ou ce « ${mot} », ou placez le « ${mot} » sous une condition.`,
  // Fragments de « forme trouvée », interpolés dans
  // transpiler.page-marqueur-manquant ci-dessous (même patron que hint-ligne-civet plus bas).
  'transpiler.page-forme-bloc-routes': `le bloc « <routes> »`,
  'transpiler.page-forme-directive-routes': `la directive « @routes »`,
  'transpiler.page-forme-vue': `la balise « <@view> »`,
  'transpiler.page-marqueur-manquant': ({ moduleName, suggestion, forme }: MsgVars) => `[ModularJS] '${moduleName}.mjs' utilise ${forme} sans porter le marqueur « .page.mjs » — hors d'un fichier .page.mjs, cette forme est un refus de compilation. Renommez le fichier en '${suggestion}'.`,
  'transpiler.nom-jamais-declare': ({ nom }: MsgVars) => `[ModularJS] « ${nom} = … » : nom jamais déclaré (Civet n'auto-déclare pas, contrairement à Coffee) — provoquera un « ReferenceError: ${nom} is not defined » à l'exécution. Utilisez « ${nom} := … » pour déclarer une nouvelle variable (fonctionne aussi bien avec -> qu'avec =>).`,
  'transpiler.reexport-es-interdit': ({ section, source }: MsgVars) => `[ModularJS] ré-export ES interdit dans ${section} (« export … from '${source}' ») — seule la directive « @import nom 'chemin' » (racine du fichier, hors <script>) est un import MJS valide.`,
  'transpiler.import-es-classique-interdit': ({ section, source }: MsgVars) => `[ModularJS] import ES classique interdit dans ${section} (« import ... '${source}' ») — seule la directive « @import nom 'chemin' » (racine du fichier, hors <script>) est un import MJS valide.`,
  'transpiler.import-dynamique-interdit': ({ section }: MsgVars) => `[ModularJS] import('…') d'un chemin littéral interdit dans ${section} — fichier connu au build : « @import nom 'chemin' » (bundle principal) ou « await µimport('chemin.js') » (chargement paresseux, empreinte résolue au build) ; URL calculée à l'exécution : import(variable) est autorisé tel quel.`,
  'transpiler.rune-import-litteral-requis': ({ section }: MsgVars) => `[ModularJS] µimport exige un chemin littéral dans ${section} (fichier connu au build, empreinte résolue pour vous) — pour une URL calculée à l'exécution, écrivez import(variable) directement.`,
  'transpiler.rune-import-extension': ({ chemin, section }: MsgVars) => `[ModularJS] µimport ne charge qu'un module : un fichier « .js » (module ES) ou un module que MJS compile (« .civet », « .coffee ») — chemin reçu dans ${section} : ${chemin}.`,
  'transpiler.rune-import-composant': ({ chemin, section }: MsgVars) => `[ModularJS] µimport ne charge pas un composant « .mjs » (chemin reçu dans ${section} : ${chemin}) — un composant se pose par sa balise <@nom> ; pour du code à charger au clic, écrivez un module « .civet » ou « .coffee ».`,
  // µinspect suit une variable ou un CHEMIN FIXE (`$x.a.b`) — un appel ou un index calculé n'y a pas de sens
  'transpiler.rune-inspect-chemin': ({ nom, chemin }: MsgVars) => `[ModularJS] µinspect suit une variable ou un chemin fixe ($x.a.b) : un appel ou un index calculé n'est pas accepté (reçu « $${nom}${chemin} »).`,
  'transpiler.minmax-retire': `[ModularJS] µminmax n'existe plus en 3.0 : la plage d'une variable se déclare dans le bloc <vars> du composant, placé avant le <script> — ex. $volume  int 0..10 (pour un champ : $settings  { volume: int 0..10 }).`,
  'transpiler.console-parentheses': ({ ecrit }: MsgVars) => `[ModularJS] « ${ecrit} » : sans parenthèses, µconsole prend un seul argument simple — un texte ('.panier') ou un nom ($$panier, false) — en fin d'instruction ; sinon, écrivez µconsole(…).`,
  'transpiler.rune-store': ({ rune, nom }: MsgVars) => `[ModularJS] µ${rune} s'applique à l'état d'un composant ($x), pas à un store : « $$${nom} » n'est pas accepté. Pour suivre un store : µconsole $$${nom} (panneau) ; pour le contraindre : sa règle dans un <vars>.`,
  'transpiler.rune-toggle-cible': ({ section, recu }: MsgVars) => `[ModularJS] µtoggle attend un chemin assignable en premier argument dans ${section} (« $x », « $$x », « §x », « µtheme », « @prop », un nom de variable, éventuellement suivi de « .clé » ou « [0] »), reçu « ${recu} » — c'est lui qui est réaffecté : ni appel, ni « ++ », ni index calculé, car la bascule le relit une fois par test.`,
  'transpiler.rune-toggle-valeur': ({ section, recu }: MsgVars) => `[ModularJS] µtoggle n'accepte que des valeurs littérales dans ${section} (chaîne, nombre, true/false, null), reçu « ${recu} » — une expression serait évaluée deux fois par la bascule.`,
  'transpiler.rune-toggle-doublon': ({ section, recu }: MsgVars) => `[ModularJS] µtoggle : la valeur ${recu} apparaît deux fois dans le cycle (${section}) — le cycle s'y arrêterait pour de bon.`,
  'transpiler.rune-acces-brut-forme': `[ModularJS] µread/µwrite vise un symbole d'état : « µread $x » ou « µread($x) », rien d'autre entre les parenthèses. Pour écrire : « µwrite $x, v » ou « µwrite($x, v) ».`,
  'transpiler.rune-write-ancienne-forme': `[ModularJS] µwrite écrit un symbole d'état avec une virgule : « µwrite $x, v » ou « µwrite($x, v) », jamais un signe égal.`,
  'transpiler.rune-toggle-appel': ({ section }: MsgVars) => `[ModularJS] µtoggle s'écrit toujours en appel parenthésé dans ${section} : « µtoggle($x, 'a', 'b') » — jamais nu ni sans parenthèses.`,
  'transpiler.handler-var-jamais-declaree': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : dans un gestionnaire d'événement, « ${nom} » se relit dans sa propre déclaration — ce nom n'existe nulle part (ni <script>, ni <script module>, ni variable de boucle). Il serait recréé à chaque appel et lèverait « Cannot access '${nom}' before initialization » au premier clic. Déclarez-le en tête de votre <script> (« ${nom} = … »), ou écrivez « $${nom} » si vous voulez un état réactif.`,
  'transpiler.handler-methode-nue': ({ moduleName, nom, ligne, fenetre }: MsgVars) => `[ModularJS] '${moduleName}.mjs'${ligne ? ` (ligne ${ligne})` : ''} : un gestionnaire d'événement cite « ${nom} » tel quel, mais ni le <script> ni le <script module> ne déclarent de « ${nom} » : c'est la méthode du composant, « @${nom} ». ${fenetre ? `Écrit nu, ce nom est aussi celui d'une fonction du navigateur : le gestionnaire appelle celle-là, pas votre méthode. Écrivez « window.${nom} » pour la fonction du navigateur, ou « @${nom} » pour la méthode du composant (par exemple « @click={@${nom}} »).` : `Écrit nu, ce nom n'existe pas — au clic, rien ne se passerait (« ${nom} is not defined » en console). Écrivez « @${nom} » (par exemple « @click={@${nom}} »), ou déclarez « ${nom} = -> … » dans votre <script>.`}`,
  'transpiler.propriete-balise-construction': ({ moduleName, nom, ligne }: MsgVars) => `[ModularJS] '${moduleName}.mjs'${ligne ? ` (ligne ${ligne})` : ''} : « @${nom} = … » en tête du <script> n'est pas une donnée du composant : c'est la propriété « ${nom} » de sa balise (HTMLElement), écrite pendant que le navigateur la construit — elle modifie la balise (un attribut ou un contenu), et quand le composant est créé par le routeur, <@element> ou document.createElement, le navigateur la refuse (« Fatal Error » au montage). Pour une donnée, prenez un autre nom ou l'état « $${nom} » ; pour agir sur la balise elle-même, écrivez-le dans « µmount -> ».`,
  'transpiler.propriete-balise-lecture-seule': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : « @${nom} = … » en tête du <script> écrit la propriété « ${nom} » de la balise du composant (HTMLElement), qui est en lecture seule : l'écriture lève pendant la construction et le composant tombe au montage (« Fatal Error »). Pour une donnée, prenez un autre nom ou l'état « $${nom} ».`,
  'transpiler.methode-balise-masquee': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : « @${nom} = … » dans le <script> remplace la méthode « ${nom}() » de la balise du composant (HTMLElement), que ModularJS appelle lui-même sur les balises de composant — au montage, pour leurs attributs, leurs événements, leur contenu, leurs transitions et leurs effets : c'est votre fonction qui partirait à la place de la sienne, et le composant cesserait de marcher. Renommez-la : un nom en français ne masque jamais une méthode de la balise (« @poserAttribut » plutôt que « @setAttribute », par exemple).`,
  'transpiler.handler-const-reaffectee': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : un gestionnaire d'événement réaffecte « ${nom} », déclaré CONSTANT dans le <script> (« ${nom} := … »). JavaScript lèverait « Assignment to constant variable » au premier clic. Déclarez-le avec « = » si vous voulez pouvoir le changer, ou écrivez « $${nom} » pour un état réactif.`,
  'transpiler.handler-local-gabarit-reaffecte': ({ moduleName, nom }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : un gestionnaire d'événement ou une liaison deux sens réaffecte « ${nom} », posé par le HTML du composant ({for}, {const} ou {success}/{error}). Il n'en a qu'une copie : l'écriture serait perdue sans un mot. Pour changer un élément de liste, écrivez dans la liste (« $liste[index] = … », ou « value=!{$liste[index]} » pour une liaison) ou modifiez une de ses propriétés (« ${nom}.champ = … ») ; pour une valeur à garder, passez par un état (« $${nom} = … »).`,
  'transpiler.handler-js-invalide': ({ moduleName, ligne, extrait }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : les gestionnaires d'événement de ce composant compilent en JavaScript invalide — le fichier entier serait refusé au chargement (page morte) alors que le build était vert. La ligne produite, citée en fin de message, désigne le gestionnaire fautif. Écrivez son corps directement entre les accolades, sans flèche (« @click={if a then x = 1} ») ; si vous gardez la flèche, passez son corps à la ligne, indenté. Pour un code plus long, appelez une fonction du <script> (« @click={maFonction} »). Ligne ${ligne} produite : ${extrait}`,
  'transpiler.handler-fleche-en-ligne': ({ moduleName, ligne, extrait }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : un gestionnaire d'événement rend une flèche écrite sur une seule ligne dont le corps affecte un « if … then … else » (ou un unless, un switch, un try, un for), comme « @click={-> x = if a then 'b' else 'c'} » — Civet compile cette forme en JavaScript invalide, et le fichier entier serait refusé au chargement. Mettez la valeur entre parenthèses (« -> x = (if a then 'b' else 'c') »), ou écrivez le corps de la flèche à la ligne suivante, indenté. Ligne ${ligne} produite : ${extrait}`,
  'transpiler.script-fleche-en-ligne': ({ moduleName, ligne, extrait, section }: MsgVars) => `[ModularJS] '${moduleName}.mjs' : le ${section ?? '<script>'} contient une flèche écrite sur une seule ligne dont le corps affecte un « if … then … else » (ou un unless, un switch, un try, un for, un while), comme « f = => x = if a then 'b' else 'c' » — Civet compile cette forme en JavaScript invalide. Mettez la valeur entre parenthèses (« f = => x = (if a then 'b' else 'c') »), ou écrivez le corps de la flèche à la ligne suivante, indenté. Ligne ${ligne} produite : ${extrait}`,
  // auto-déclaration scope-aware d'un <script> (ou d'un module .civet autonome) : `nom := …`
  // lie une CONSTANTE Civet — la réaffecter nu (`nom = …`, `nom += …`) compilerait sans erreur
  // puis planterait au chargement (« Assignment to constant variable »). `code` (optionnel) :
  // la ligne citée vient du contrôle par résolution de portée (const-reassign.ts), sur le JS déjà
  // compilé — jamais garanti identique à la ligne de la source Civet, le dire plutôt que mentir.
  'transpiler.civet-reaffectation-constante': ({ nom, ligne, code }: MsgVars) => `[ModularJS] réaffectation de « ${nom} » (ligne ${ligne}${code ? ' du code compilé' : ''}) refusée — déclaré avec « := » (constante) : utilisez « .= » pour pouvoir le réaffecter.`,
  // — src/generator/reserved-symbols.ts —
  'transpiler.symbole-reserve-declare': ({ moduleName, section, nom, extrait }: MsgVars) => `[ModularJS] '${moduleName}.mjs' (${section}) : « ${nom} » est un symbole du framework — $ (état), $$ (store), µ (runtime) — il ne peut pas servir de nom de variable, de paramètre ni d'import : « ${extrait} ». Renommez-le (par exemple « el » pour un élément du DOM).`,
  'transpiler.symbole-reserve-nu': ({ nom }: MsgVars) => `[ModularJS] « ${nom} » seul n'est pas un nom : c'est un symbole du framework (§ contexte figé, §§ contexte réactif) — il s'écrit toujours suivi d'un nom (« §theme », « §§count ») et ne peut pas servir de variable, de paramètre ni de valeur.`,
  'transpiler.isnt-identifiant-reserve': `[ModularJS] « isnt » est un opérateur Coffee/Civet (≡ is not) — identifiant réservé, renommez (ex. « isnt_ », « estPas »).`,
  'transpiler.desequilibre-structurel': ({ moduleName, tag, opens, closes }: MsgVars) => `
❌ [Erreur de Syntaxe ModularJS] Dans '${moduleName}.mjs' :
   Le composant <${tag}> présente un déséquilibre structurel.
   Ouvertures : ${opens}, Fermetures : ${closes}.
   Solution : Utilisez <${tag} /> pour les composants vides.`,
  // @callback (forme accolades interdite ET nom invalide, même message pour les deux pièges)
  'transpiler.callback-nom-attendu': ({ valeur }: MsgVars) => `[ModularJS] @callback=${valeur} : la directive attend un NOM de méthode entre guillemets (ex. @callback="maMethode") — pas une expression entre accolades, pas un identifiant composé.`,
  // @permanent : forme NUE seulement, l'appariement se fait par id
  'transpiler.permanent-valeur-refusee': ({ valeur }: MsgVars) => `[ModularJS] @permanent=${valeur} : cette directive ne prend jamais de valeur — l'appariement entre deux navigations se fait par l'id de l'élément, jamais par un nom porté par @permanent ; écrivez @permanent seul, avec un id stable sur l'élément.`,
  'transpiler.preload-eager-renomme': ({ ou }: MsgVars) => `[ModularJS] @preload : la valeur « eager » n'existe pas — écrivez « on » (${ou}).`,
  // @confirm forme objet (littéral statique text/ok/cancel seulement) : ne
  // parle plus que du CONTENU d'un hash d'options, une expression SANS « clé: » est désormais un
  // attribut réactif à part (mjs-confirm={expr}), qui ne passe plus par ce message
  'transpiler.confirm-objet-invalide': ({ raw }: MsgVars) => `[ModularJS] @confirm={${raw}} : forme objet invalide — dans un hash d'options, seules les clés text/ok/cancel sont acceptées, en valeurs chaîne littérale entre guillemets simples ou doubles, ou un appel µt(…) pour suivre la langue (ex. @confirm={ text: µt('supprimer_question'), ok: 'Supprimer' }) — aucune autre expression ni variable pour ces clés (une expression seule, sans « clé: », est un attribut réactif : @confirm={maVar}).`,
  // @title forme objet (même esprit que @confirm : littéral statique, une clé catalogue
  // PARTAGÉE pour toutes les erreurs de cette forme — text absent, clé inconnue, valeur non
  // littérale, side/transition hors énumération)
  'transpiler.title-objet-invalide': ({ raw }: MsgVars) => `[ModularJS] @title={${raw}} : forme objet invalide — clés acceptées text (obligatoire)/delay/side/dur/transition, en valeurs chaîne ou nombre littérales (side: 'top'/'bottom', transition: 'fade'/'slide') ; seule la clé text accepte aussi un appel µt(…) pour suivre la langue (ex. @title={ text: µt('aide'), side: 'top' }) — aucune autre expression ni variable.`,
  // @title={{ expr }} (forme HTML) : les deux accolades ouvrantes ACCOLÉES exigent deux
  // fermantes ACCOLÉES symétriques — un corps jamais refermé (fin de fichier) ou refermé par
  // une seule accolade tombent sur ce MÊME message.
  'transpiler.title-html-non-ferme': ({ raw }: MsgVars) => `[ModularJS] @title={{${raw}}} : la forme HTML n'est jamais refermée par une double accolade fermante "}}" — deux accolades fermantes ACCOLÉES sont attendues, symétriques des deux ouvrantes (@title={{ expression }}).`,
  'transpiler.title-html-triple-accolade': ({ extrait }: MsgVars) => `[ModularJS] ${extrait}… : trois accolades ouvrantes ACCOLÉES ("{{{") — ni la forme texte (@title={expr}, une accolade), ni la forme HTML (@title={{expr}}, deux) : la troisième glisserait dans le corps comme un objet littéral, affiché "[object Object]" au survol. Utilisez UNE accolade ou DEUX, jamais plus.`,
  // @flash (vocabulaire fermé popup/console/silent, même garde anti-écouteur-fantôme que @callback)
  'transpiler.flash-valeur-invalide': ({ valeur }: MsgVars) => `[ModularJS] @flash=${valeur} : la directive attend "popup", "console" ou "silent" entre guillemets (ex. @flash="popup") — pas une expression entre accolades, pas une autre valeur.`,
  'transpiler.viewtransition-nu-sur-view': ({ label }: MsgVars) => `[ModularJS] ${label} nu sur une <@view> n'a pas d'effet propre — précisez un nom (${label}.fade) ; la forme nue (activer avec héritage) n'existe qu'à la racine d'un module.`,
  'transpiler.viewtransition-forme-invalide-sur-view': ({ label, rest }: MsgVars) => `[ModularJS] ${label}${rest} sur <@view> : forme invalide — écrivez ${label}.<nom>={ direction: …, duration: …, priority: … } (options facultatives).`,
  'transpiler.viewtransition-erreur-parsing-sur-view': ({ label, nameAndDir, erreur }: MsgVars) => `[ModularJS] ${label}.${nameAndDir} sur <@view> : ${erreur}`,
  'transpiler.viewtransition-ancienne-forme-view': ({ label, val, nameOnly }: MsgVars) => {
    const nom = nameOnly || '<nom>'
    return `[ModularJS] ${label}="${val}" remplacé — écrivez ${label}.${nom} ; la forme dynamique ${label}={expr} reste valable.`
  },
  'transpiler.viewtransition-morph-options-interdites': ({ morphName }: MsgVars) => `[ModularJS] @viewTransition.${morphName}={...} : options réservées aux niveaux de navigation (config, module, <@view>) pour l'instant.`,
  'transpiler.viewtransition-ancienne-forme': ({ val }: MsgVars) => {
    const nom = val || '<nom>'
    return `[ModularJS] @viewTransition="${val}" remplacé — écrivez @viewTransition.${nom}.`
  },
  'transpiler.viewtransition-etiquette-calculee-interdite': ({ expr }: MsgVars) => `[ModularJS] @viewTransition={${expr}} : étiquette calculée retirée — @viewTransition.<nom> reste fixe. Pour une valeur calculée, écrivez @style.view-transition-name={${expr}}.`,
  'transpiler.viewtransition-etiquette-conditionnelle-interdite': ({ cond, val }: MsgVars) => `[ModularJS] @viewTransition{${cond}}="${val}" : étiquette conditionnelle retirée — @viewTransition.<nom> reste fixe. Pour une valeur conditionnelle, écrivez @style.view-transition-name{${cond}}="${val}".`,
  'transpiler.css-trap-fontface': `<style> composant : @font-face en Shadow DOM ne charge PAS la police (limite navigateur). Déclarez-la au niveau document : <@head><style>@font-face { font-family: '…'; src: url(µasset('fonts/….woff2')) }</style></@head>. (Sans objet si le composant est monté en mjs-light.)`,
  'transpiler.css-trap-import': `<style> composant : @import est ignoré dans une feuille construite (adoptedStyleSheets). Feuille externe (Google Fonts…) → <@head><link rel="stylesheet" href="…"></@head> ; fichier local → url(µasset('…')).`,
  'transpiler.hint-spread-else-civet': ` Piste : « if … then {…} else {...x} » (objet 100 % spread en else) déclenche un bug Civet amont — contournez avec « Object.assign({}, x) », une clé explicite (« {…, k: v} »), ou un if/else classique.`,
  // même piste, second motif : spread dans le corps-objet d'une flèche
  // FINE `->` (`(x) -> { ...x, k: v }`) — même bug Civet amont, deux contournements.
  'transpiler.hint-spread-fleche-fine-civet': ` Piste : « (x) -> { ...x, k: v } » (spread dans le corps-objet d'une flèche fine) déclenche un bug Civet amont — contournez avec des parenthèses explicites « -> ({ ...x, k: v }) » ou une flèche grasse « => ».`,
  'transpiler.mu-layout-homonyme': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ${moduleName} : « µlayout » lit le modèle choisi (la prop layout), et ce composant a sa propre variable $layout${ligne ? ` (ligne ${ligne})` : ''} — les deux se confondraient. Renommez la variable.`,
  'transpiler.trop-de-variables-etat': ({ moduleName, n, seuil }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} déclare ${n} variables d'état ($) — seuil ${seuil} : découpez en sous-composants/écrans ou structurez l'état (objets/tableaux) ; réglage lint.maxStateVars (0 pour désactiver).`,
  // — lint a11y (transpiler/a11y.ts), activé par défaut —
  'transpiler.a11y-img-alt-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (ligne ${ligne}) : <img> sans attribut alt — ajoutez alt="…" (texte descriptif), ou alt="" si l'image est purement décorative.`,
  'transpiler.a11y-iframe-title-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (ligne ${ligne}) : <iframe> sans attribut title — ajoutez title="…" décrivant le contenu intégré.`,
  'transpiler.a11y-tabindex-positif': ({ moduleName, ligne, valeur }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (ligne ${ligne}) : tabindex="${valeur}" positif casse l'ordre de tabulation naturel — utilisez tabindex="0" (ordre du DOM) ou réordonnez le HTML, jamais un tabindex positif.`,
  'transpiler.a11y-click-non-interactif': ({ moduleName, ligne, tag }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (ligne ${ligne}) : @click sur <${tag}> non interactif, sans role ni tabindex — ajoutez role="button" tabindex="0" (+ la gestion clavier), ou utilisez un <button>/<a>.`,
  'transpiler.a11y-bouton-nom-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (ligne ${ligne}) : <button> sans nom accessible (rien que des icônes ou du vide) — ajoutez aria-label="…" ou du texte visible.`,
  'transpiler.a11y-lien-nom-manquant': ({ moduleName, ligne }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (ligne ${ligne}) : <a> sans nom accessible (rien que des icônes ou du vide) — ajoutez aria-label="…" ou du texte visible.`,
  'transpiler.a11y-champ-etiquette-manquante': ({ moduleName, ligne, tag }: MsgVars) => `[ModularJS] ⚠️  ${moduleName} (ligne ${ligne}) : <${tag}> sans étiquette associée — ajoutez <label for="…">…</label> (ou aria-label="…").`,
  // — lint ujs-form (transpiler/ujs-form.ts), activé par défaut —
  'transpiler.lint.ujs-form': ({ file, ligne }: MsgVars) => `[ModularJS] ⚠️  ${file}:${ligne} — ce <form> n'a ni action ni @method : UJS l'intercepte quand même et la soumission repart en navigation vers l'URL courante. S'il est purement local, retenez l'envoi dans votre gestionnaire (@submit.prevent) ou posez @noUJS.`,
  'transpiler.hint-ligne-civet': ({ ligne, ligneFautive }: MsgVars) => ` (ligne ${ligne} indiquée par Civet : \`${ligneFautive}\`)`,
  // (transpiler/index.ts:2062 réutilise 'generator.hint-ternaire-colle' — texte identique, cf. risques §8)
  'transpiler.handler-inline-echec-civet': ({ moduleName, lineHint, civetMsg, gluedTernaryHint }: MsgVars) => `[ModularJS] handler inline : échec de compilation Civet dans « ${moduleName} »${lineHint} — ${civetMsg}${gluedTernaryHint}`,

  // — src/languages/coffee.ts —
  'languages.source-coffee-depreciee': ({ fichier }: MsgVars) => `[ModularJS] ⚠️  source CoffeeScript dépréciée (${fichier}) — migrez vers .civet ; l'adaptateur Coffee sera retiré dans une version future.`,
  'languages.js-erreur-syntaxe': ({ detail }: MsgVars) => `erreur de syntaxe JavaScript : ${detail}`,

  // — src/languages/index.ts —
  'languages.langage-inconnu': ({ lang, supportes }: MsgVars) => `[languages] langage inconnu : "${lang}". Supportés : ${supportes}`,

  // — src/schema/core.ts —
  'schema.type-inconnu': ({ schema, champ, type, indice, valides }: MsgVars) => `[µschema] schéma '${schema}', champ '${champ}' : type inconnu '${type}'${indice} — types valides : ${valides}, list(type), bits([noms])`,
  'schema.suggestion-type': ({ suggestion }: MsgVars) => ` — vouliez-vous dire '${suggestion}' ?`,
  'schema.list-type-scalaire': ({ schema, champ, valides, typeDe }: MsgVars) => `[µschema] schéma '${schema}', champ '${champ}' : list() attend un type scalaire (${valides}) — sous-schémas/list imbriquée non supportés en v1, reçu '${typeDe}'`,
  'schema.bits-noms-vides': ({ schema, champ }: MsgVars) => `[µschema] schéma '${schema}', champ '${champ}' : bits() attend un tableau de noms non vide`,
  'schema.bits-trop-de-noms': ({ schema, champ, nb }: MsgVars) => `[µschema] schéma '${schema}', champ '${champ}' : bits() accepte au plus 8 booléens dans son octet (reçu ${nb})`,
  'schema.bits-noms-double': ({ schema, champ }: MsgVars) => `[µschema] schéma '${schema}', champ '${champ}' : bits() — noms en double`,
  'schema.type-champ-invalide': ({ schema, champ }: MsgVars) => `[µschema] schéma '${schema}', champ '${champ}' : type de champ invalide (ni chaîne scalaire, ni list(), ni bits())`,
  'schema.nom-champ-invalide': ({ schema, champ }: MsgVars) => `[µschema] schéma '${schema}' : nom de champ invalide '${champ}' — ne survit pas à un objet ordinaire ({}[nom] = valeur), ex. '__proto__'`,
  'schema.forme-differente': ({ nom, ancien, nouveau }: MsgVars) => `[µschema] schéma '${nom}' déjà déclaré avec une forme différente — garde AJOUT-SEUL : un schéma existant est IMMUABLE (jamais de champ ajouté/retiré/retypé/réordonné). Déclarez un schéma à un NOM neuf pour faire évoluer le protocole.
  ancien   : ${ancien}
  nouveau  : ${nouveau}`,
  'schema.registre-plein': ({ nom }: MsgVars) => `[µschema] registre plein — 256 schémas déjà déclarés (id u8 épuisé), impossible d'ajouter '${nom}'`,
  'schema.chaine-trop-longue': ({ type, octets, max }: MsgVars) => `[µschema] chaîne trop longue pour ${type} (${octets} octets UTF-8, max ${max})`,
  'schema.valeur-hors-plage': ({ schema, champ, type, valeur, min, max }: MsgVars) => `[µschema] schéma '${schema}', champ '${champ}' : ${valeur} est hors de la plage de ${type} (${min} à ${max}) — la valeur arriverait repliée. Choisissez un type plus large, ou bornez la valeur avant l'envoi.`,
  'schema.list-trop-longue': ({ of, n }: MsgVars) => `[µschema] list(${of}) : ${n} éléments, max 65535 (compteur u16)`,
  'schema.decode-hors-bornes': `[µschema] decode : trame tronquée/malformée — lecture hors bornes`,
  'schema.encode-schema-inconnu': ({ nom }: MsgVars) => `[µschema] encode() : schéma inconnu '${nom}' — déclarez-le d'abord (defSchema/app.schema)`,
  'schema.decode-trame-vide': `[µschema] decode() : trame vide, octet id de schéma attendu`,
  'schema.decode-id-inconnu': ({ id }: MsgVars) => `[µschema] decode() : id de schéma inconnu (${id}) — registre local incomplet ou désynchronisé`,

  // ═══ SERVEURS (src/server/, src/mjs-server/) ════════════════════════════════════════════

  // --- src/server/index.ts ---
  'server.index-hmr-actif': ({ host, port }: MsgVars) => `🔥 HMR actif (ws://${host}:${port}/__mjs_hmr)`,
  'server.index-ecoute': ({ host, port, pathPrefix }: MsgVars) => `📡 Serveur ModularJS : http://${host}:${port}${pathPrefix}/...`,
  // réponse 403 de `mjs dev` à un en-tête Host étranger (garde contre le rebinding DNS)
  'server.hote-refuse': ({ nom }: MsgVars) => `Hôte refusé : « ${nom} ». Ce serveur de développement ne répond qu'à localhost et à ses sous-domaines, à 127.0.0.1, à [::1], au nom de cette machine et à l'hôte de \`dev.host\`. Pour ouvrir ce nom (tunnel, proxy), ajoutez-le dans mjs.config.json : "dev": { "allowedHosts": ["${nom}"] }.`,
  'server.origine-nom-exact': ({ nom, motif, hote }: MsgVars) => `Origine refusée : « ${nom} » n'est couvert que par « ${motif} » dans dev.allowedHosts, et l'en-tête Host reçu (« ${hote} ») ne le nomme pas : un tunnel l'a réécrit. Une entrée qui commence par un point couvre aussi les pages des autres utilisateurs de ce domaine ; derrière un Host réécrit, le rechargement à chaud et les formulaires de mjs dev n'acceptent donc qu'un nom exact. Ajoutez-le dans mjs.config.json : "dev": { "allowedHosts": ["${nom}"] }.`,
  'server.origine-refus-tus': ({ max }: MsgVars) => `Origines refusées : ${max} noms déjà signalés dans ce terminal ; les refus suivants ne sont plus affichés jusqu'au prochain démarrage de mjs dev. La réponse 403 d'un formulaire refusé dit toujours le nom exact à écrire.`,
  // avertissement de configuration — le viseur du journal est une page de
  // `journal.viewer: true` vaut « hors production seulement » : en production la page n'est pas servie
  'server.journal-viewer-ignore-en-prod': "[ModularJS] ⚠️  journal.viewer: true est ignoré en production : la page de consultation du journal d'erreurs n'est pas servie (404). Pour l'ouvrir en production, donnez un jeton (`journal.viewer: \"<jeton>\"`, page ouverte avec `?token=<jeton>`).",

  // --- src/server/hmr.ts ---
  'server.hmr-connecte': '[HMR] connecté',
  'server.hmr-deconnecte': '[HMR] déconnecté — nouvel essai dans {wait} ms',
  'server.hmr-compilation-echouee': '[ModularJS HMR] Échec de compilation :',
  'server.hmr-aucun-message': '(aucun message)',

  // --- src/server/prerender.ts ---
  'server.prerender-route-parametree': 'route paramétrée → prérendu build impossible (passer en mode ssr + serveur)',
  'server.prerender-mode-non-buildable': ({ mode }: MsgVars) => `mode ${mode} (rendu au client/serveur, pas au build)`,
  'server.prerender-banner': ({ url, lang }: MsgVars) => `Page prérendue par MJS (mjs build) pour '${url}'${lang ? ` (langue '${lang}')` : ''} — ne pas éditer à la main.`,
  'server.prerender-echec-rendu': ({ component, langTag, err }: MsgVars) => `échec rendu (${component}${langTag}) : ${err}`,
  'server.prerender-hors-dossier': ({ url, file, outDir }: MsgVars) => `page '${url}' non prérendue : son fichier (${file}) sortirait de render.outDir (${outDir}) — rien n'est écrit`,

  // --- src/server/render-request.ts ---
  'server.render-handler-ferme': '[mjs] handler de rendu déjà fermé',
  'server.render-erreur-interne': 'erreur interne',
  'server.render-echec-html': ({ component, pathname, detail }: MsgVars) => `<!-- [mjs] échec du rendu de ${component} pour '${pathname}' : ${detail} -->`,

  // --- src/server/render-browser.ts ---
  'server.browser-erreurs-compilation': ({ errors }: MsgVars) => `[mjs-ssr-browser] erreurs de compilation :\n${errors}`,
  'server.browser-core-introuvable': '[mjs-ssr-browser] mjs_core introuvable après compilation',
  'server.browser-playwright-manquant': "[mjs-ssr-browser] le moteur navigateur requiert Playwright — installez-le : npm i -D playwright (ou configurez render.engine.prerender / render.engine.request: 'happy-dom').",
  'server.browser-deja-ferme': '[mjs-ssr-browser] renderer déjà fermé',
  'server.browser-forward-refuse-interne': ({ tag, host }: MsgVars) => `[mjs-ssr-browser] render.forwardOrigin refusé pour <${tag}> : cible réseau interne bloquée (${host}) — proxy désactivé.`,
  'server.browser-forward-url-invalide': ({ tag }: MsgVars) => `[mjs-ssr-browser] render.forwardOrigin refusé pour <${tag}> : forwardedUrl invalide — proxy désactivé.`,
  'server.browser-prop-invalide': ({ keyJson }: MsgVars) => `[mjs-ssr-browser] nom de prop invalide ignoré : ${keyJson}`,
  'server.browser-composant-non-enregistre': ({ tag }: MsgVars) => `[mjs-ssr-browser] composant <${tag}> non enregistré (vérifiez le nom de fichier en kebab-case minuscule)`,
  'server.browser-non-stabilise': ({ tag, settleMs }: MsgVars) => `[mjs-ssr-browser] rendu de <${tag}> non stabilisé en ${settleMs}ms (scheduler occupé ou {await} encore pending) — HTML potentiellement incomplet, divergence possible à l'hydratation.`,
  'server.browser-erreur-page': ({ tag, err }: MsgVars) => `[mjs-ssr-browser] erreur non interceptée dans la page pour <${tag}> : ${err}`,
  'server.browser-erreur-non-geree': ({ tag }: MsgVars) => `[mjs-ssr-browser] erreur non gérée pendant le rendu de <${tag}> (crash intercepté par le framework sans frontière <@failed> pour l'absorber) — ce rendu est en échec.`,
  'server.browser-shadow-closed': ({ tag }: MsgVars) => `[mjs-ssr-browser] shadowMode:'closed' pour <${tag}> : le client ne peut PAS reprendre la main sur ce rendu (Shadow DOM closed non détectable/adoptable) — le composant échouera à s'hydrater. Utilisez shadowMode:'open' (défaut) si ce composant doit rester interactif côté client.`,
  'server.browser-demarrage-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] le navigateur n'a pas démarré en ${ms}ms (lancement ou ouverture de page bloqués) — rendu abandonné (borne : deux fois render.browserPool.renderTimeoutMs).`,
  'server.browser-fermeture-navigateur-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] la fermeture du navigateur n'a pas abouti en ${ms}ms (borne : deux fois render.browserPool.renderTimeoutMs, jamais moins de 10 s) — abandonnée, le processus Chromium reste à la charge de Playwright.`,
  'server.browser-fermeture-contexte-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] la fermeture d'un contexte d'emplacement n'a pas abouti en ${ms}ms (borne : deux fois render.browserPool.renderTimeoutMs, jamais moins de 10 s) — abandonnée, ce contexte peut rester vivant dans Playwright.`,
  'server.browser-fermeture-attente-navigateur-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] l'attente du navigateur n'a pas abouti en ${ms}ms (résolution du moteur ou lancement bloqués, borne : deux fois render.browserPool.renderTimeoutMs, jamais moins de 10 s) — abandonnée, le navigateur sera refermé s'il finit par arriver.`,
  'server.browser-fermeture-bundler-trop-long': ({ ms }: MsgVars) => `[mjs-ssr-browser] la fermeture du bundler n'a pas abouti en ${ms}ms (borne : deux fois render.browserPool.renderTimeoutMs, jamais moins de 10 s) — abandonnée, le réservoir de travailleurs partagé peut retenir le processus vivant.`,
  'server.browser-render-timeout': ({ tag, renderTimeoutMs }: MsgVars) => `[mjs-ssr-browser] rendu de <${tag}> abandonné après ${renderTimeoutMs}ms (timeout de rendu — montage/fetch proxifié probablement bloqué).`,
  'server.browser-prerender-happydom-fallback': '[mjs] prérendu happy-dom : installez playwright pour le moteur navigateur (npm i -D playwright).',
  'server.browser-plusieurs-core': ({ files, first }: MsgVars) => `[mjs-ssr-browser] plusieurs mjs_core-*.js présents (${files}) — la page charge ${first}, celui de ce build ; les autres viennent de builds antérieurs, vous pouvez les retirer de l'outputDir.`,
  'server.browser-popup-fermee': ({ tag }: MsgVars) => `[mjs-ssr-browser] popup fermée (window.open non suivi, jamais fermé par Playwright) pour <${tag}>`,
  'server.browser-route-echec': ({ url, erreur }: MsgVars) => `[mjs-ssr-browser] la ressource ${url} n'a pas pu être servie à la page (${erreur}) : réponse 500, le rendu continue.`,
  'server.browser-releve-racine-echec': ({ tag, err }: MsgVars) => `[mjs-ssr-browser] relevé des clés racine lues par <${tag}> en échec (${err}) — la graine sort sans elles : ces textes n'arriveront qu'avec le fichier de langue et pourront clignoter au chargement.`,

  // --- src/server/renderToString.ts ---
  'server.ssr-import-circulaire': ({ names }: MsgVars) => `[mjs-ssr] @import circulaire détecté — ces modules ne peuvent pas être ordonnés pour le rendu serveur : ${names}. Contrairement au bundle client (liaisons ESM natives, live), le SSR évalue chaque module dans une IIFE séquentielle et ne supporte pas les dépendances circulaires. Retirez le cycle entre ces fichiers.`,
  'server.ssr-erreurs-compilation': ({ errors }: MsgVars) => `[mjs-ssr] erreurs de compilation :\n${errors}`,
  'server.ssr-core-introuvable': '[mjs-ssr] mjs_core introuvable après compilation',
  'server.ssr-plusieurs-core': ({ files, first }: MsgVars) => `[mjs-ssr] plusieurs mjs_core-*.js présents (${files}) — le rendu charge ${first}, celui de ce build ; les autres viennent de builds antérieurs, vous pouvez les retirer de l'outputDir.`,
  'server.ssr-happydom-manquant': '[mjs-ssr] le rendu serveur requiert "happy-dom". Installez-le : npm i happy-dom',
  'server.ssr-happydom-trop-ancien': ({ found, required }: MsgVars) => `[mjs-ssr] le rendu serveur requiert happy-dom ${required} au moins (version installée : ${found}). En dessous, happy-dom perd au ramasse-miettes le rappel d'un MutationObserver : un composant ne voit plus ses attributs changer et le rendu varie d'un passage à l'autre. Montez la version : npm i happy-dom@^${required}`,
  'server.ssr-eval-echec': ({ message }: MsgVars) => `[mjs-ssr] éval du bundle dans happy-dom : ${message}`,
  'server.ssr-composant-non-enregistre': ({ tag }: MsgVars) => `[mjs-ssr] composant <${tag}> non enregistré (vérifiez le nom de fichier en kebab-case minuscule)`,
  'server.ssr-erreur-non-geree': ({ tag }: MsgVars) => `[mjs-ssr] erreur non gérée pendant le rendu de <${tag}> (crash intercepté par le framework sans frontière <@failed> pour l'absorber) — ce rendu est en échec.`,
  'server.ssr-injection-store-echec': ({ message }: MsgVars) => `[mjs-ssr] injection du store global : ${message}`,
  'server.ssr-prop-invalide': ({ keyJson }: MsgVars) => `[mjs-ssr] nom de prop invalide ignoré : ${keyJson}`,
  'server.ssr-serialisation-echec': ({ expr, errMsg }: MsgVars) => `[mjs-ssr] échec de sérialisation de ${expr} (client démarrera sans cet état) : ${errMsg}`,
  'server.ssr-non-stabilise': ({ tag, settleMs }: MsgVars) => `[mjs-ssr] rendu de <${tag}> non stabilisé en ${settleMs}ms (scheduler occupé ou {await} encore pending) — HTML potentiellement incomplet, divergence possible à l'hydratation.`,
  'server.ssr-shadow-closed': ({ tag }: MsgVars) => `[mjs-ssr] shadowMode:'closed' pour <${tag}> : le client ne peut PAS reprendre la main sur ce rendu (Shadow DOM closed non détectable/adoptable) — le composant échouera à s'hydrater. Utilisez shadowMode:'open' (défaut) si ce composant doit rester interactif côté client.`,
  'server.ssr-forward-refuse-interne': ({ tag, host }: MsgVars) => `[mjs-ssr] render.forwardOrigin refusé pour <${tag}> : cible réseau interne bloquée (${host}) — repli sur l'origine locale.`,
  'server.ssr-forward-url-invalide': ({ tag }: MsgVars) => `[mjs-ssr] render.forwardOrigin refusé pour <${tag}> : forwardedUrl invalide — repli sur l'origine locale.`,
  'server.ssr-await-rejete-sans-branche': ({ tag, message }: MsgVars) => `[mjs-ssr] {await} rejetée dans <${tag}> sans branche {error} pour la consommer (${message}) — rendu vide côté serveur, ajoutez {error err}…{end} pour l'afficher.`,

  // --- src/server/serve-entry.ts (chargeurs props/actions .server.mjs) ---
  'server.entry-charge': ({ fichier }: MsgVars) => `[mjs serve] chargeurs serveur : ${fichier}`,
  'server.entry-echec': ({ fichier, erreur, actif }: MsgVars) => `[mjs serve] échec du chargement de '${fichier}' : ${erreur} — ${actif ? 'ancien chargeur conservé' : 'chargeur inactif'}`,
  'server.entry-cle-ignoree': ({ cle }: MsgVars) => `[mjs serve] clé '${cle}' ignorée dans l'entry serveur (attendu : props/actions)`,
  'server.entry-props-invalides': ({ pathname }: MsgVars) => `[mjs serve] props invalides renvoyées pour '${pathname}' (attendu un objet) — ignorées`,
  'server.entry-props-echec': ({ pathname, erreur }: MsgVars) => `[mjs serve] échec du chargeur de props pour '${pathname}' : ${erreur}`,

  // --- src/server/render-server.ts (formulaires POST) ---
  'server.form-cible-invalide': ({ pathname, cible }: MsgVars) => `[mjs serve] action pour '${pathname}' : redirection invalide (attendu une chaîne commençant par '/'), reçu : ${cible}`,
  'server.form-resultat-invalide': ({ pathname }: MsgVars) => `[mjs serve] action pour '${pathname}' : forme de retour invalide (attendu { redirect } ou { errors })`,
  'server.form-fichier-ignore': ({ pathname, champ }: MsgVars) => `[mjs serve] action pour '${pathname}' : champ fichier '${champ}' ignoré (fichiers non pris en charge pour l'instant)`,
  'server.form-champ-reserve-ignore': ({ pathname, champ }: MsgVars) => `[mjs serve] action pour '${pathname}' : champ '${champ}' refusé (nom réservé) — valeur ignorée`,
  // journal du catch de l'exécution d'action (500 imprévu, cas le plus courant en dev).
  'server.action-exception': ({ pathname, erreur }: MsgVars) => `[mjs serve] action pour '${pathname}' : exception non interceptée (${erreur})`,
  // journal du catch global (dernier filet, 500 imprévu quel qu'il soit).
  'server.erreur-imprevue': ({ url, erreur }: MsgVars) => `[mjs serve] erreur imprévue pour '${url}' : ${erreur}`,
  // µres au 1er chargement HTML : échec de sérialisation (référence circulaire...), jamais un 500.
  'server.res-serialisation-echec': ({ pathname, erreur }: MsgVars) => `[mjs serve] échec de sérialisation de µres pour '${pathname}' (page servie sans cet état) : ${erreur}`,

  // --- src/server/journal.ts (journal d'erreurs 3 étages) ---
  'server.journal-ecriture-echec': ({ erreur }: MsgVars) => `[mjs] journal d'erreurs : échec d'écriture (${erreur}) — nouvel essai silencieux aux prochains signalements`,
  'server.journal-viewer-compile-echec': ({ erreur }: MsgVars) => `[mjs] visionneuse du journal d'erreurs : échec de compilation (${erreur})`,
  // visionneuses du journal et de l'atelier des thèmes (repères de leur source, cf. server/viewer-page.ts)
  'viewer.journal.titre': "Journal d'erreurs",
  'viewer.journal.tous': 'Tous',
  'viewer.journal.serveur': 'Serveur',
  'viewer.journal.client': 'Client',
  'viewer.journal.rafraichir': 'Rafraîchir',
  'viewer.journal.purger-serveur': 'Purger serveur',
  'viewer.journal.purger-client': 'Purger client',
  'viewer.journal.purger-tout': 'Purger tout',
  'viewer.journal.purger-source-question': 'Purger les entrées {source} du journal ?',
  'viewer.journal.purger-tout-question': 'Purger TOUTES les entrées du journal ?',
  'viewer.journal.echec': 'Chargement impossible — réessayez avec « Rafraîchir ».',
  'viewer.journal.vide': 'Aucune erreur — tout va bien.',
  'viewer.journal.premier': 'premier',
  'viewer.journal.dernier': 'dernier',
  'viewer.theme.titre': 'Variables de thème',
  'viewer.theme.kind-module': 'module',
  'viewer.theme.kind-theme': 'thème',
  'viewer.theme.kind-framework': 'framework',
  'viewer.theme.kind-stylesheet': 'feuille partagée',
  'viewer.theme.motif-introuvable': 'déclaration introuvable dans le fichier — reconstruire ?',
  'viewer.theme.motif-ambigu': 'plusieurs déclarations dans ce fichier, ligne indécidable',
  'viewer.theme.motif-inchange': 'déjà à cette couleur',
  'viewer.theme.motif-hors-projet': 'fichier hors du projet (framework, lien symbolique)',
  'viewer.theme.motif-racine-inconnue': 'racine du projet inconnue du serveur',
  'viewer.theme.motif-valeur-refusee': 'valeur refusée par le crible',
  'viewer.theme.motif-nom-refuse': 'nom de variable refusé',
  'viewer.theme.motif-fichier-manquant': 'aucun fichier déclarant connu',
  'viewer.theme.ecrit-dans': 'écrit dans',
  'viewer.theme.compte-source-1': '{n} source',
  'viewer.theme.compte-source-n': '{n} sources',
  'viewer.theme.compte-variable-1': '{n} variable',
  'viewer.theme.compte-variable-n': '{n} variables',
  'viewer.theme.compte-declaration-1': '{n} déclaration',
  'viewer.theme.compte-declaration-n': '{n} déclarations',
  'viewer.theme.compte-defaut-1': '{n} valeur par défaut de composant',
  'viewer.theme.compte-defaut-n': '{n} valeurs par défaut de composants',
  'viewer.theme.compte-posee-1': '{n} variable posée par le composant',
  'viewer.theme.compte-posee-n': '{n} variables posées par le composant',
  'viewer.theme.compte-lue-1': '{n} variable lue par au moins un composant',
  'viewer.theme.compte-lue-n': '{n} variables lues par au moins un composant',
  'viewer.theme.compte-direct-1': "Aperçu en direct — {n} page à l'écoute",
  'viewer.theme.compte-direct-n': "Aperçu en direct — {n} pages à l'écoute",
  'viewer.theme.compte-retablir-1': 'Rétablir la couleur modifiée',
  'viewer.theme.compte-retablir-n': 'Rétablir les {n} couleurs modifiées',
  'viewer.theme.compte-lecteur-1': '{n} lecteur',
  'viewer.theme.compte-lecteur-n': '{n} lecteurs',
  'viewer.theme.enregistrer': 'Enregistrer dans le source',
  'viewer.theme.precision-ecrit': "Chaque couleur choisie part dans la ligne exacte où sa source la déclare. « Rétablir » ne défait que l'aperçu : ce qui est écrit reste écrit.",
  'viewer.theme.precision-apercu': "Rien n'est écrit sur le disque : fermez l'onglet et tout revient.",
  'viewer.theme.lecture-seule-direct': "Lecture seule — l'aperçu en direct demande « mjs dev ».",
  'viewer.theme.vide': "Ce projet ne déclare et ne lit aucune variable de thème ($$) pour l'instant — c'est le silence par défaut du compilateur, pas une panne.",
  'viewer.theme.recherche-label': 'Rechercher une variable de thème',
  'viewer.theme.recherche-placeholder': 'Rechercher une variable, un déclarant, un lecteur…',
  'viewer.theme.filtre-tous': 'Tous',
  'viewer.theme.filtre-themes': 'Thèmes',
  'viewer.theme.filtre-modules': 'Modules',
  'viewer.theme.filtre-feuilles': 'Feuilles partagées',
  'viewer.theme.filtre-framework': 'Framework',
  'viewer.theme.aucune': 'Aucune variable ne correspond à la recherche.',
  'viewer.theme.variante': 'variante',
  'viewer.theme.badge-defauts': 'valeurs par défaut',
  'viewer.theme.badge-posees': 'posées par le composant',
  'viewer.theme.badge-lecture-seule': 'lecture seule',
  'viewer.theme.plier': 'Plier ou déplier les variables posées par',
  'viewer.theme.couleur-de': 'Couleur de',
  'viewer.theme.source': 'source',
  'viewer.theme.retablir-nom': 'Rétablir',
  'viewer.theme.retablir': 'rétablir',
  'viewer.theme.par-defaut': 'par défaut',
  'viewer.theme.ligne': 'ligne',
  'viewer.theme.ligne-inconnue': 'ligne inconnue',
  'viewer.theme.ailleurs': 'ailleurs',
  'viewer.theme.doc-posee': 'pose cette variable lui-même, dans son script, son gabarit ou son CSS : ce que vous déclarez dessus peut ne rien changer.',
  'viewer.theme.doc-lue': "lit cette variable avec ce défaut, écrit dans son CSS. Pour la régler, déclarez-la dans le thème de l'application, sur :root ou sur un ancêtre du composant.",
  'viewer.theme.cible-posee': 'Aucune écriture possible : cette variable est posée par le composant.',
  'viewer.theme.cible-defaut': "Aucune écriture possible : ce défaut n'est pas une déclaration.",
  'viewer.theme.cible-vers': 'Enregistrement vers',
  'viewer.theme.cible-ligne-cherchee': 'ligne cherchée dans le fichier',
  'viewer.theme.cible-framework': 'Aucune écriture possible : cette déclaration appartient au framework.',
  'viewer.theme.cascade-lue': "Des déclarations existent pour ce nom — la cascade s'applique, la plus proche du composant l'emporte sur ce défaut.",
  'viewer.theme.cascade-ailleurs': "Ce nom est aussi déclaré ailleurs — la cascade s'applique, le plus proche gagne, et l'aperçu en direct les repeint toutes ensemble. L'enregistrement, lui, ne touche que la ligne ci-dessus.",
  'viewer.theme.sans-lecteur': 'Aucun lecteur — déclaré mais jamais consommé.',
  'viewer.theme.lu-par': 'Lu par',
  'server.journal-viewer-manifest-absent': `manifeste introuvable (mjs build requis)`,
  'server.journal-viewer-core-introuvable': `import du cœur introuvable dans le manifeste`,
  'server.viewer-runtime-introuvable': ({ fichier, dossier }: MsgVars) => `fichier du runtime « ${fichier} » introuvable dans ${dossier} : la visionneuse ne peut pas apporter ce que votre cœur nu n'embarque pas`,
  'server.viewer-import-coeur-introuvable': `import du cœur introuvable en tête du script de la visionneuse : impossible de lui joindre ce que votre cœur nu n'embarque pas`,

  // --- src/server/theme-viewer.mjs / viewer-page.ts (atelier /__mjs/theme) ---
  'server.theme-viewer-compile-echec': ({ erreur }: MsgVars) => `[mjs] atelier des variables de thème : échec de compilation (${erreur})`,

  // --- src/server/ssr-head.ts (<head> thématisé SSR anti-flash) ---
  'server.ssr-head-echec': ({ erreur }: MsgVars) => `[mjs] construction du <head> thématisé SSR : échec (${erreur}) — page servie sans thème inliné`,

  // --- src/server/prerender.ts ---
  'server.prerender-fichier-perime-supprime': ({ file }: MsgVars) => `fichier périmé supprimé (${file})`,
  'server.prerender-fragment-sans-route': ({ file }: MsgVars) => `fragment sans route supprimé (${file})`,
  'server.prerender-dossier-vide-retire': ({ dir }: MsgVars) => `dossier vidé de ses fragments retiré (${dir})`,
  'server.prerender-echec-suppression': ({ file, err }: MsgVars) => `échec de la suppression du fichier périmé ${file} : ${err}`,
  // un avertissement vu sur plus de pages qu'on n'en nomme (toujours plus de trois)
  'server.prerender-avertissement-pages': ({ nb }: MsgVars) => `${nb} pages`,

  // --- src/mjs-server/index.ts ---
  'serveur.index-movesperidentity-invalide': ({ received }: MsgVars) => `[MJS-Server] opts.antiCheat.movesPerIdentity doit être [n entier ≥ 1, fenêtreMs finie > 0] ou null/absent (désactivez le quota), reçu : ${received}`,
  'serveur.index-codeperip-invalide': ({ received }: MsgVars) => `[MJS-Server] opts.antiCheat.codePerIp doit être [n entier ≥ 1, fenêtreMs finie > 0] ou null (désactivez le verrou) ou absent (défaut), reçu : ${received}`,
  'serveur.index-privategamespercreator-invalide': ({ received }: MsgVars) => `[MJS-Server] opts.antiCheat.privateGamesPerCreator doit être un entier ≥ 1, ou null (désactivez la borne) ou absent (défaut : 5), reçu : ${received}`,
  'serveur.index-serve-prefixe-reserve': ({ type, prefix }: MsgVars) => `[MJS-Server] app.serve('${type}', …) : préfixe réservé — '${prefix}' est la plomberie interne de MJS-Server, invisible pour l'appli hôte`,
  'serveur.index-on-prefixe-reserve': ({ type, prefix }: MsgVars) => `[MJS-Server] app.on('${type}', …) : préfixe réservé — '${prefix}' est la plomberie interne de MJS-Server, invisible pour l'appli hôte`,
  'serveur.index-schema-prefixe-reserve': ({ type, prefix }: MsgVars) => `[MJS-Server] schéma '${type}' : préfixe réservé — '${prefix}' ne peut pas voyager en binaire, sa charge porte une vue de jeu (un objet), que µschema v1 ne sait pas décrire ; la vue s'encoderait en valeur vide SANS lever`,
  'serveur.index-game-deja-declare': ({ type }: MsgVars) => `[MJS-Server] app.game('${type}', …) : déjà déclaré`,

  // --- src/mjs-server/history.ts ---
  'serveur.histo-ticks-invalide': ({ received }: MsgVars) => `[MJS-Server] history.ticks doit être un entier ≥ 1, reçu : ${received}`,
  'serveur.histo-tampon-vide': '[MJS-Server] game.rewind() : tampon vide (aucun tick encore écoulé, ou partie détruite)',
  'serveur.histo-instant-invalide': ({ received }: MsgVars) => `[MJS-Server] game.rewind() : l'instant doit être un nombre fini (horodatage en ms, cf. game.timeSeenBy), reçu : ${received}`,

  // --- src/mjs-server/space.ts ---
  'serveur.space-cell-invalide': ({ received }: MsgVars) => `[MJS-Server] space.cell doit être un nombre > 0, reçu : ${received}`,
  'serveur.space-query-invalide': ({ x, y, radius }: MsgVars) => `[MJS-Server] space.query(${x}, ${y}, ${radius}) : coordonnées/rayon non finis — résultat vide`,

  // --- src/mjs-server/matchmaking.ts ---
  // file d'attente publique pleine (plafond DEFAULT_QUEUE_CAP)
  'serveur.matchmaking-file-pleine': ({ type }: MsgVars) => `file d'attente pleine pour '${type}' — réessayez plus tard`,
  'serveur.matchmaking-parties-privees-limite': ({ max }: MsgVars) => `limite de parties privées en cours atteinte (${max}) : attendez qu'une de vos parties se termine avant d'en créer une autre`,
  'serveur.matchmaking-parties-privees-siege-limite': ({ max }: MsgVars) => `vous siégez déjà dans ${max} parties privées en cours (limite atteinte) : quittez-en une, ou attendez qu'une se termine, avant d'en créer ou d'en rejoindre une autre`,
  'serveur.matchmaking-arret-en-cours': "le serveur s'arrête : votre coup n'a pas été joué — rejouez-le après son redémarrage",
  'serveur.matchmaking-trop-tentatives-code': 'trop de tentatives de code — patientez',
  'serveur.matchmaking-code-inconnu': ({ code }: MsgVars) => `code inconnu '${code}'`,
  'serveur.matchmaking-play-type-manquant': 'µgame:play : type de jeu manquant',
  'serveur.matchmaking-type-jeu-inconnu': ({ type }: MsgVars) => `type de jeu inconnu '${type}'`,
  'serveur.matchmaking-spectateur-doit-etre-bool': 'µgame:play : spectator doit être true ou absent',
  'serveur.matchmaking-spectateur-sans-code-prive': ({ type }: MsgVars) => `le jeu '${type}' ne supporte pas les parties privées — un spectateur doit désigner une partie existante par code`,
  'serveur.matchmaking-spectateur-code-requis': 'µgame:play : spectator nécessite un code de partie existante',
  'serveur.matchmaking-jeu-sans-parties-privees': ({ type }: MsgVars) => `le jeu '${type}' ne supporte pas les parties privées`,
  'serveur.matchmaking-code-invalide': 'code invalide',
  'serveur.matchmaking-move-partie-manquante': 'µgame:move : partie manquante',
  'serveur.matchmaking-move-coup-manquant': 'µgame:move : coup manquant',
  'serveur.matchmaking-partie-introuvable': 'partie introuvable',
  'serveur.matchmaking-leave-partie-manquante': 'µgame:leave : partie manquante',
  'serveur.matchmaking-resync-partie-manquante': 'µgame:resync : partie manquante',
  'serveur.matchmaking-entree-refusee': 'votre entrée dans la partie a été refusée',
  'serveur.matchmaking-appariement-echoue': ({ msg }: MsgVars) => `[MJS-Server] l'appariement d'un groupe de la file a échoué : ${msg}`,

  // --- src/mjs-server/persist.ts ---
  'serveur.cle-inconnue': ({ prefix, k, hint, clesValides }: MsgVars) => `${prefix}.${k} : clé inconnue${hint}\n  Clés valides : ${clesValides}`,
  'serveur.cle-inconnue-suggestion': ({ suggestion }: MsgVars) => ` — vouliez-vous dire '${suggestion}' ?`,
  'serveur.persist-option-invalide': ({ prefix, received }: MsgVars) => `${prefix} : attendu un adaptateur { load, save, remove } ou { adapter, debounce?, snapshotEvery? }, reçu : ${received}`,
  'serveur.persist-adaptateur-invalide': ({ prefix, received }: MsgVars) => `${prefix}.adapter doit exposer { load(), save(id, data), remove(id) }, reçu : ${received}`,
  'serveur.persist-debounce-invalide': ({ prefix, received }: MsgVars) => `${prefix}.debounce doit être un nombre ≥ 0 (ms), reçu : ${received}`,
  'serveur.persist-snapshotevery-invalide': ({ prefix, received }: MsgVars) => `${prefix}.snapshotEvery doit être un nombre ≥ 0 (ms, 0 = désactivé), reçu : ${received}`,
  'serveur.persist-save-echoue': ({ id }: MsgVars) => `[MJS-Server] persist.save('${id}') a échoué`,
  'serveur.persist-save-echoue-nouvel-essai': ({ id, delai }: MsgVars) => `[MJS-Server] persist.save('${id}') a échoué — nouvel essai dans ${delai} s`,
  'serveur.persist-remove-echoue': ({ id }: MsgVars) => `[MJS-Server] persist.remove('${id}') a échoué`,
  'serveur.persist-remove-echoue-nouvel-essai': ({ id, delai }: MsgVars) => `[MJS-Server] persist.remove('${id}') a échoué — nouvel essai dans ${delai} s`,
  'serveur.persist-serialisation-echoue': ({ id }: MsgVars) => `[MJS-Server] la partie '${id}' ne se sérialise pas (serialize() a levé) : sauvegarde abandonnée, sans nouvel essai — sa prochaine modification en tentera une autre`,
  'serveur.persist-save-sans-reponse': ({ id, delai, essai }: MsgVars) => `[MJS-Server] persist.save('${id}') : aucune réponse de l'adaptateur en ${String(Math.round(Number(delai) * 10) / 10).replace('.', ',')} s — écriture abandonnée, ${Number(essai) > 0 ? `nouvel essai dans ${String(Math.round(Number(essai) * 10) / 10).replace('.', ',')} s` : 'la sauvegarde de la partie continue'} ; si elle finit par aboutir, l'état courant de la partie est réécrit par-dessus (vérifiez votre stockage)`,
  'serveur.persist-remove-sans-reponse': ({ id, delai, essai }: MsgVars) => `[MJS-Server] persist.remove('${id}') : aucune réponse de l'adaptateur en ${String(Math.round(Number(delai) * 10) / 10).replace('.', ',')} s — suppression abandonnée, ${Number(essai) > 0 ? `nouvel essai dans ${String(Math.round(Number(essai) * 10) / 10).replace('.', ',')} s` : 'la partie pourra revenir au prochain démarrage'} ; si elle finit par aboutir alors que l'identifiant a été réutilisé, la nouvelle partie est réécrite (vérifiez votre stockage)`,
  'serveur.persist-flush-sans-reponse': ({ delai }: MsgVars) => `[MJS-Server] persist.flush() : aucune réponse de l'adaptateur en ${String(Math.round(Number(delai) * 10) / 10).replace('.', ',')} s — l'arrêt continue sans l'attendre (vérifiez votre stockage)`,
  'serveur.persist-save-tardive': ({ id }: MsgVars) => `[MJS-Server] persist.save('${id}') : l'écriture abandonnée a fini par répondre et a pu remplacer un état plus récent — l'état courant de la partie est réécrit`,
  'serveur.persist-remove-tardive': ({ id }: MsgVars) => `[MJS-Server] persist.remove('${id}') : la suppression abandonnée a fini par répondre et a pu effacer la partie recréée sous le même identifiant — son état courant est réécrit`,
  'serveur.persist-save-tardive-partie-finie': ({ id }: MsgVars) => `[MJS-Server] persist.save('${id}') : l'écriture abandonnée a fini par répondre après la fin de la partie et a pu recréer sa ligne — la suppression est renvoyée`,
  'serveur.persist-ecriture-tardive-arret': ({ id }: MsgVars) => `[MJS-Server] persist('${id}') : une écriture abandonnée a répondu pendant l'arrêt et a pu remplacer un état plus récent, que l'arrêt ne réécrit pas (vérifiez votre stockage)`,
  'serveur.persist-load-echoue': '[MJS-Server] persist.load() a échoué — démarrage SANS restauration',
  'serveur.persist-load-pas-un-tableau': ({ recu }: MsgVars) => `[MJS-Server] persist.load() doit rendre un tableau de sauvegardes { id, data } — reçu : ${recu} ; démarrage SANS restauration`,
  'serveur.persist-partie-ignoree': ({ id, type }: MsgVars) => `[MJS-Server] persist : partie '${id}' ignorée — type '${type}' non déclaré (app.game() manquant ?)`,
  'serveur.persist-restauration-echouee': ({ id }: MsgVars) => `[MJS-Server] persist : restauration de '${id}' a échoué`,
  'serveur.persist-restauration-doublon': ({ id }: MsgVars) => `[MJS-Server] persist : la partie '${id}' est déjà restaurée depuis une autre sauvegarde rendue par load() — celle-ci est ignorée (une copie de sauvegarde dans votre stockage ?)`,

  // --- src/mjs-server/persist-sql.ts ---
  'serveur.persist-sql-query-manquant': '[MJS-Server] persist-sql : opts.query manquant — attendu (sql, params) => Promise',
  'serveur.persist-sql-dialect-invalide': ({ received }: MsgVars) => `[MJS-Server] persist-sql : opts.dialect doit être '?' ou '$', reçu : ${received}`,
  'serveur.persist-sql-table-invalide': ({ table }: MsgVars) => `[MJS-Server] persist-sql : opts.table '${table}' n'est pas un identifiant SQL valide`,

  // --- src/mjs-server/persist-bridge.ts ---
  'serveur.persist-bridge-delai-depasse': 'délai de requête dépassé',
  'serveur.persist-bridge-url-manquant': '[MJS-Server] persist-bridge : opts.url manquant',
  'serveur.persist-bridge-secret-manquant': '[MJS-Server] persist-bridge : opts.secret manquant',
  'serveur.persist-bridge-http-non-loopback': ({ url }: MsgVars) => `[MJS-Server] persist-bridge (${url}) : http:// non-loopback = risque de falsification de l'état restauré par MITM — utilisez https:// ou, en connaissance de cause, { allowInsecure: true }`,
  'serveur.persist-bridge-reponse-http': ({ status }: MsgVars) => `réponse HTTP ${status}`,
  'serveur.persist-bridge-reponse-trop-grande': ({ max }: MsgVars) => `[MJS-Server] persist-bridge : réponse trop grande (> ${max} octets), abandon`,
  'serveur.persist-bridge-delai-global-depasse': '[MJS-Server] persist-bridge : délai global dépassé',

  // --- src/mjs-server/persist-file.ts ---
  'serveur.persist-file-dir-manquant': '[MJS-Server] persist-file : opts.dir manquant',
  'serveur.persist-file-id-invalide': ({ id }: MsgVars) => `[MJS-Server] persist-file : identifiant de partie invalide : '${id}'`,
  'serveur.persist-file-id-hors-dossier': ({ id }: MsgVars) => `[MJS-Server] persist-file : identifiant de partie invalide : '${id}' (chemin résolu hors du dossier de stockage)`,

  // --- src/mjs-server/game.ts ---
  'serveur.game-def-invalide': ({ prefix }: MsgVars) => `${prefix} : la définition doit être un objet { seats, state, moves, ... }`,
  'serveur.game-places-invalide': ({ prefix, received }: MsgVars) => `${prefix}.seats doit être un entier ≥ 1, reçu : ${received}`,
  'serveur.game-code-invalide': ({ prefix, received, receivedType }: MsgVars) => `${prefix}.code doit être un booléen, reçu : ${received} (${receivedType})`,
  'serveur.game-seatttl-invalide': ({ prefix, received }: MsgVars) => `${prefix}.seatTtl doit être un nombre > 0 (ms), reçu : ${received}`,
  'serveur.game-tick-invalide': ({ prefix, received }: MsgVars) => `${prefix}.tick doit être un nombre ≥ 0, reçu : ${received}`,
  'serveur.game-tick-hors-plage': ({ prefix, tickHz }: MsgVars) => `${prefix}.tick doit être 0 (événementiel) ou compris entre 1 et 60 (Hz), reçu : ${tickHz}`,
  'serveur.game-mode-invalide': ({ prefix, received }: MsgVars) => `${prefix}.mode doit être 'authoritative' ou 'lockstep', reçu : ${received}`,
  'serveur.game-tick-requis-lockstep': ({ prefix }: MsgVars) => `${prefix}.tick doit être > 0 en mode 'lockstep' — cadence de regroupement des ordres, cf. def.mode`,
  'serveur.game-state-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.state interdit en mode 'lockstep' — la salle ne simule rien (aucun état serveur), cf. def.mode`,
  'serveur.game-state-requis': ({ prefix, received }: MsgVars) => `${prefix}.state est requis — fonction (partie) => état initial, reçu : ${received}`,
  'serveur.game-moves-requis': ({ prefix }: MsgVars) => `${prefix}.moves est requis — objet { nom: (partie, joueur, p) => résultat }`,
  'serveur.game-moves-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.moves.${nom} doit être une fonction, reçu : ${received}`,
  'serveur.game-view-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.view interdit en mode 'lockstep' — aucun état serveur à filtrer, cf. def.mode`,
  'serveur.game-view-invalide': ({ prefix, received }: MsgVars) => `${prefix}.view doit être une fonction (partie, joueur) => vue, reçu : ${received}`,
  'serveur.game-ondivergence-hors-lockstep': ({ prefix }: MsgVars) => `${prefix}.onDivergence nécessite mode: 'lockstep' — aucune détection de divergence hors lockstep`,
  'serveur.game-ondivergence-invalide': ({ prefix, received }: MsgVars) => `${prefix}.onDivergence doit être une fonction (partie, {tick, suspects, reason}) => void, reçu : ${received}`,
  'serveur.game-lockstepjournal-hors-lockstep': ({ prefix }: MsgVars) => `${prefix}.lockstepJournal nécessite mode: 'lockstep' — aucun journal d'ordres hors lockstep`,
  'serveur.game-lockstepjournal-invalide': ({ prefix }: MsgVars) => `${prefix}.lockstepJournal doit être un objet { maxTicks?, maxBytes?, maxOrderBytes?, snapshotEvery? }`,
  'serveur.game-lockstepjournal-maxticks-invalide': ({ prefix, received }: MsgVars) => `${prefix}.lockstepJournal.maxTicks doit être un entier ≥ 1, reçu : ${received}`,
  'serveur.game-lockstepjournal-snapshotevery-invalide': ({ prefix, received }: MsgVars) => `${prefix}.lockstepJournal.snapshotEvery doit être un entier ≥ 1 (une cadence en ticks), reçu : ${received}`,
  'serveur.game-lockstepjournal-maxticks-sous-fenetre': ({ prefix, maxTicks, window }: MsgVars) => `${prefix}.lockstepJournal.maxTicks (${maxTicks}) ne couvre pas la fenêtre des propositions d'instantané (${window} ticks : deux secondes de ticks, ou snapshotEvery s'il est plus long) — un instantané accordé en fin de fenêtre laisserait un trou avant le journal ; déclarez maxTicks à ${window} au moins, ou retirez-le`,
  'serveur.game-lockstepjournal-maxbytes-invalide': ({ prefix, received }: MsgVars) => `${prefix}.lockstepJournal.maxBytes doit être un entier ≥ 1 (octets), reçu : ${received}`,
  'serveur.game-lockstepjournal-maxorderbytes-invalide': ({ prefix, received }: MsgVars) => `${prefix}.lockstepJournal.maxOrderBytes doit être un entier ≥ 1 (octets), reçu : ${received}`,
  'serveur.game-phases-invalide': ({ prefix }: MsgVars) => `${prefix}.phases doit être un objet { phase: [coups permis] }`,
  'serveur.game-phases-valeur-invalide': ({ prefix, phase, received }: MsgVars) => `${prefix}.phases.${phase} doit être un tableau de noms de coups (string[]), reçu : ${received}`,
  'serveur.game-turns-invalide': ({ prefix }: MsgVars) => `${prefix}.turns doit être un objet { order?, timeout? }`,
  'serveur.game-turns-order-invalide': ({ prefix, received }: MsgVars) => `${prefix}.turns.order doit être 'roundrobin' ou une fonction (partie) => joueur, reçu : ${received}`,
  'serveur.game-turns-timeout-invalide': ({ prefix, received }: MsgVars) => `${prefix}.turns.timeout doit être un nombre > 0 (ms), ou null pour n'armer aucune minuterie de tour, reçu : ${received}`,
  'serveur.game-timers-invalide': ({ prefix }: MsgVars) => `${prefix}.timers doit être un objet { nom: (partie) => void }`,
  'serveur.game-timers-nom-reserve': ({ prefix, nom }: MsgVars) => `${prefix}.timers.${nom} : nom de minuterie RÉSERVÉ (interne à MJS-Server) — choisissez un autre nom`,
  'serveur.game-timers-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.timers.${nom} doit être une fonction, reçu : ${received}`,
  'serveur.game-limits-invalide': ({ prefix }: MsgVars) => `${prefix}.limits doit être un objet { moves?: [n, fenêtreMs], moveIntervalMs?: ms, moveWaitMs?: ms }`,
  'serveur.game-limits-moves-invalide': ({ prefix, received }: MsgVars) => `${prefix}.limits.moves doit être [n entier ≥ 1, fenêtreMs finie > 0] ou null (désactivez le quota), reçu : ${received}`,
  'serveur.game-limits-moveintervalms-invalide': ({ prefix, received }: MsgVars) => `${prefix}.limits.moveIntervalMs doit être un nombre > 0 (ms), reçu : ${received}`,
  'serveur.game-limits-movewaitms-invalide': ({ prefix, received }: MsgVars) => `${prefix}.limits.moveWaitMs doit être un nombre fini > 0 et au plus 2147483647 (ms, environ 24,8 jours : le plus long délai d'une minuterie Node), reçu : ${received}`,
  'serveur.game-emptyttl-invalide': ({ prefix, received }: MsgVars) => `${prefix}.emptyTtl doit être un nombre > 0 (ms), reçu : ${received}`,
  'serveur.game-endttl-invalide': ({ prefix, received }: MsgVars) => `${prefix}.endTtl doit être un nombre > 0 (ms), reçu : ${received}`,
  'serveur.valeur-recue-fonction': '[fonction]',
  'serveur.valeur-recue-objet': '[objet]',
  'serveur.game-hooks-invalide': ({ prefix }: MsgVars) => `${prefix}.hooks doit être un objet { onCreate?, onJoin?, onLeave?, onEnd?, onTurnTimeout?, onDestroy? }`,
  'serveur.game-hooks-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.hooks.${nom} doit être une fonction, reçu : ${received}`,
  'serveur.game-intents-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.intents interdit en mode 'lockstep' — chaque µgame:move devient un ORDRE diffusé tel quel, cf. def.mode`,
  'serveur.game-intents-invalide': ({ prefix }: MsgVars) => `${prefix}.intents doit être un objet { nom: (partie, joueur, p) => void }`,
  'serveur.game-intents-tick-requis': ({ prefix }: MsgVars) => `${prefix}.intents nécessite tick > 0 (mode action) — sans boucle, les intentions ne seraient jamais appliquées`,
  'serveur.game-intents-nom-invalide': ({ prefix, nom, received }: MsgVars) => `${prefix}.intents.${nom} doit être une fonction, reçu : ${received}`,
  'serveur.game-intents-nom-collision': ({ prefix, nom }: MsgVars) => `${prefix}.intents.${nom} : nom déjà pris par moves.${nom} — un coup ne peut pas être à la fois un move classique et une intention`,
  'serveur.game-simulate-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.simulate interdit en mode 'lockstep' — le serveur ne calcule rien, cf. def.mode`,
  'serveur.game-simulate-invalide': ({ prefix, received }: MsgVars) => `${prefix}.simulate doit être une fonction (partie, dt) => void, reçu : ${received}`,
  'serveur.game-simulate-tick-requis': ({ prefix }: MsgVars) => `${prefix}.simulate nécessite tick > 0 (mode action)`,
  'serveur.game-slowtick-invalide': ({ prefix }: MsgVars) => `${prefix}.slowTick doit être un objet { hz, fn }`,
  'serveur.game-slowtick-hz-invalide': ({ prefix, received }: MsgVars) => `${prefix}.slowTick.hz doit être un nombre > 0, reçu : ${received}`,
  'serveur.game-slowtick-fn-invalide': ({ prefix, received }: MsgVars) => `${prefix}.slowTick.fn doit être une fonction (partie) => void, reçu : ${received}`,
  'serveur.game-slowtick-tick-requis': ({ prefix }: MsgVars) => `${prefix}.slowTick nécessite tick > 0 (mode action)`,
  'serveur.game-deltas-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.deltas interdit en mode 'lockstep' — rien à diffuser en delta (aucun état), cf. def.mode`,
  'serveur.game-deltas-invalide': ({ prefix, received }: MsgVars) => `${prefix}.deltas doit être un booléen, reçu : ${received}`,
  'serveur.game-space-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.space interdit en mode 'lockstep' — aucune zone d'intérêt sans état serveur, cf. def.mode`,
  'serveur.game-space-invalide': ({ prefix }: MsgVars) => `${prefix}.space doit être un objet { cell }`,
  'serveur.game-space-cell-invalide': ({ prefix, received }: MsgVars) => `${prefix}.space.cell doit être un nombre > 0, reçu : ${received}`,
  'serveur.game-histo-interdit-lockstep': ({ prefix }: MsgVars) => `${prefix}.history interdit en mode 'lockstep' — pas de positions serveur à historiser, cf. def.mode`,
  'serveur.game-histo-invalide': ({ prefix }: MsgVars) => `${prefix}.history doit être un objet { ticks, extract?, interp? }`,
  'serveur.game-histo-tick-requis': ({ prefix }: MsgVars) => `${prefix}.history nécessite tick > 0 (mode action) — sans boucle, aucun tick à historiser`,
  'serveur.game-histo-ticks-invalide': ({ prefix, received }: MsgVars) => `${prefix}.history.ticks doit être un entier ≥ 1, reçu : ${received}`,
  'serveur.game-histo-extraire-invalide': ({ prefix, received }: MsgVars) => `${prefix}.history.extract doit être une fonction (game) => positions, reçu : ${received}`,
  'serveur.game-histo-extraire-requis': ({ prefix }: MsgVars) => `${prefix}.history.extract est requis quand def.space n'est pas déclaré — aucun extracteur par défaut sans zone d'intérêt`,
  'serveur.game-histo-interp-invalide': ({ prefix, received }: MsgVars) => `${prefix}.history.interp doit être un nombre ≥ 0 (ms) — 0 = aucun retard d'interpolation déclaré, reçu : ${received}`,
  'serveur.game-suspect-invalide': ({ prefix, received }: MsgVars) => `${prefix}.suspect doit être une fonction (coup, contexte) => résultat, reçu : ${received}`,
  'serveur.game-antirejeu-invalide': ({ prefix, received }: MsgVars) => `${prefix}.antiReplay doit être true (ou absent), reçu : ${received}`,
  'serveur.game-onsuspicion-invalide': ({ prefix, received }: MsgVars) => `${prefix}.onSuspicion doit être une fonction (evenement) => void, reçu : ${received}`,
  'serveur.game-spectatorview-invalide': ({ prefix, received }: MsgVars) => `${prefix}.spectatorView doit être une fonction (partie) => vue, reçu : ${received}`,
  'serveur.game-view-absente-avertissement': ({ type }: MsgVars) => `game('${type}') : def.view absente — l'état COMPLET est diffusé à tous les sièges ; définissez def.view pour masquer l'état secret`,

  // --- src/mjs-server/game.ts ---
  'serveur.partie-phase-inconnue': ({ phase, phases }: MsgVars) => `[MJS-Server] game.to('${phase}') : phase inconnue — phases déclarées : ${phases}`,
  'serveur.partie-timer-nom-reserve': ({ nom }: MsgVars) => `[MJS-Server] game.timer('${nom}', …) : nom réservé (interne à MJS-Server)`,
  'serveur.partie-timer-inconnu': ({ nom, timers }: MsgVars) => `[MJS-Server] game.timer('${nom}', …) : minuterie non déclarée — déclarez-la dans timers (minuteries déclarées : ${timers})`,
  'serveur.partie-timer-aucun': 'aucune',
  'serveur.partie-vuede-lockstep': "[MJS-Server] game.viewFor() : indisponible en mode 'lockstep' (aucun état serveur, cf. def.mode)",
  'serveur.partie-rembobiner-sans-histo': '[MJS-Server] game.rewind() nécessite def.history — cf. game.ts',
  'serveur.partie-instantvupar-sans-histo': '[MJS-Server] game.timeSeenBy() nécessite def.history — cf. game.ts',
  'serveur.partie-complete': 'partie complète',
  'serveur.partie-pas-dans-partie': "vous n'êtes pas dans cette partie",
  'serveur.partie-page-sans-instantane': "cette page ne sait pas reprendre la partie : son journal a été coupé par un instantané, que seule une version plus récente de la page sait lire — rechargez la page pour la reprendre",
  'serveur.partie-spectateur-sans-vue': ({ type }: MsgVars) => `game('${type}') : spectateur sans def.spectatorView/def.view — aucun état diffusé (anti-fuite)`,
  'serveur.partie-pas-assis': "vous n'êtes pas assis dans cette partie",
  'serveur.partie-terminee': 'partie terminée',
  'serveur.partie-spectateur-lecture-seule': 'spectateur : lecture seule',
  'serveur.partie-coup-interdit-phase': ({ coup, phase }: MsgVars) => `coup '${coup}' interdit en phase '${phase}'`,
  'serveur.partie-pas-votre-tour': "ce n'est pas votre tour",
  'serveur.partie-trop-de-coups': 'trop de coups, ralentissez',
  'serveur.partie-coup-sans-fin': ({ coup, ms }: MsgVars) => `[MJS-Server] le coup '${coup}' n'est toujours pas réglé après ${ms} ms (limits.moveWaitMs) : sa requête reçoit une erreur, et les coups suivants du joueur sont refusés jusqu'à sa fin`,
  'serveur.partie-coup-sans-reponse': ({ coup, ms }: MsgVars) => `votre coup '${coup}' est resté sans réponse pendant ${ms} ms (limits.moveWaitMs) : il continue sur le serveur, et vos coups suivants sont refusés jusqu'à sa fin`,
  'serveur.partie-coup-precedent-en-cours': 'votre coup précédent est encore en cours',
  'serveur.partie-ordre-trop-gros': ({ taille, max }: MsgVars) => `ordre trop volumineux (${taille} octets, ${max} au plus) : il n'est pas transmis — allégez sa charge ou relevez lockstepJournal.maxOrderBytes`,
  'serveur.partie-journal-lockstep-plein': ({ id, max }: MsgVars) => `partie ${id} terminée : son journal lockstep dépasserait ${max} octets (lockstepJournal.maxBytes) — raison 'journal-full'`,
  'serveur.partie-coup-inconnu': ({ coup }: MsgVars) => `coup inconnu '${coup}'`,
  'serveur.partie-tick-rejete': ({ quoi, msg }: MsgVars) => `boucle de tick — ${quoi} a rejeté : ${msg}`,
  'serveur.partie-tick-leve': ({ quoi, msg }: MsgVars) => `boucle de tick — ${quoi} a levé : ${msg}`,
  'serveur.partie-coup-rejete-suspect': ({ coup, raison }: MsgVars) => `[MJS-Server] coup '${coup}' rejeté — suspect (${raison})`,
  'serveur.partie-coup-rejete-rejeu': ({ coup, seq, dernier }: MsgVars) => `[MJS-Server] coup '${coup}' rejeté — rejeu détecté (seq ${seq} ≤ ${dernier})`,
  'serveur.partie-coup-rejete-sequence-avance': ({ coup, seq, dernier }: MsgVars) => `[MJS-Server] coup '${coup}' rejeté — séquence trop en avance (seq ${seq}, dernier ${dernier})`,
  'serveur.partie-coup-rejete-cadence': ({ coup }: MsgVars) => `[MJS-Server] coup '${coup}' rejeté — cadence trop rapide`,
  'serveur.partie-coup-rejete-quota-identite': ({ coup }: MsgVars) => `[MJS-Server] coup '${coup}' rejeté — quota de coups par identité dépassé`,
  'serveur.partie-timer-applicatif-rejete': ({ nom, msg }: MsgVars) => `[MJS-Server] timer('${nom}') a rejeté : ${msg}`,
  'serveur.partie-timer-applicatif-leve': ({ nom, msg }: MsgVars) => `[MJS-Server] timer('${nom}') a levé : ${msg}`,
  'serveur.partie-vue-leve': ({ msg }: MsgVars) => `[MJS-Server] def.view a levé — trame ignorée pour ce siège : ${msg}`,
  'serveur.partie-spectatorview-leve': ({ msg }: MsgVars) => `[MJS-Server] def.spectatorView a levé (à défaut, def.view appelée sans joueur) — trame ignorée pour les spectateurs : ${msg}`,
  'serveur.partie-onturntimeout-leve': ({ msg }: MsgVars) => `[MJS-Server] hooks.onTurnTimeout a levé à l'échéance du tour — la partie continue : ${msg}`,
  'serveur.partie-onturntimeout-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onTurnTimeout a rejeté à l'échéance du tour — la partie continue : ${msg}`,
  'serveur.partie-turns-order-timeout-leve': ({ msg }: MsgVars) => `[MJS-Server] turns.order a levé au passage de tour automatique (échéance de turns.timeout) — le tour reste au même siège, aucune nouvelle échéance n'est armée : ${msg}`,
  'serveur.partie-turns-order-depart-leve': ({ msg }: MsgVars) => `[MJS-Server] turns.order a levé au départ du joueur dont c'était le tour — le départ est allé à son terme, l'erreur de hooks.onLeave a été renvoyée à celui qui part : ${msg}`,
  'serveur.partie-turns-order-refus-leve': ({ msg }: MsgVars) => `[MJS-Server] turns.order a levé au refus du joueur dont c'était le tour — le refus est allé à son terme, le tour n'a pas changé de main : ${msg}`,
  'serveur.partie-onleave-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onLeave a rejeté — le départ est allé à son terme, celui qui part a déjà reçu sa réponse : ${msg}`,
  'serveur.partie-onjoin-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onJoin a rejeté — joueur refusé après coup : ${msg}`,
  'serveur.partie-onjoin-rejete-code': ({ msg }: MsgVars) => `[MJS-Server] hooks.onJoin a rejeté — joueur refusé : ${msg}`,
  'serveur.partie-onjoin-rejete-file': ({ msg }: MsgVars) => `[MJS-Server] hooks.onJoin a rejeté — joueur refusé, le groupe de la file n'est pas annoncé : ${msg}`,
  'serveur.partie-onend-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onEnd a rejeté — la fin de partie a eu lieu : ${msg}`,
  'serveur.partie-oncreate-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onCreate a rejeté — la partie est créée quand même : ${msg}`,
  'serveur.partie-ondestroy-leve': ({ msg }: MsgVars) => `[MJS-Server] hooks.onDestroy a levé — la partie est détruite quand même : ${msg}`,
  'serveur.partie-ondestroy-rejete': ({ msg }: MsgVars) => `[MJS-Server] hooks.onDestroy a rejeté — la partie est détruite quand même : ${msg}`,
  'serveur.partie-histo-extraire-leve': ({ msg }: MsgVars) => `[MJS-Server] def.history.extract a levé — tick ignoré pour l'historique : ${msg}`,
  'serveur.restore-invalide': ({ champ, attendu }: MsgVars) => `[MJS-Server] restoreGame() : champ '${champ}' invalide (attendu ${attendu})`,
  'serveur.restore-attendu-objet': 'un objet',
  'serveur.restore-champ-racine': 'racine',
  'serveur.restore-attendu-chaine-non-vide': 'une chaîne non vide',
  'serveur.restore-attendu-tableau': 'un tableau',
  'serveur.restore-attendu-siege': '{seat:number, id:string} ou null',
  'serveur.restore-attendu-minuterie': '{name:string, at:number}',
  'serveur.restore-attendu-instantane-lockstep': '{tick:entier ≥ 1, state, rng:entier de 0 à 4294967295}',
  'serveur.restore-attendu-journal-apres-instantane': ({ tick }: MsgVars) => `un journal qui reprend au tick ${tick}, juste après l'instantané`,

  // --- src/mjs-server/persist-redis.ts + persist-bridge.ts + persist-sql.ts + persist-file.ts (mutualisées) ---
  'serveur.persist-backend-rejet-non-intercepte': ({ backend, label }: MsgVars) => `persist-${backend} : ${label} — rejet non intercepté`,
  'serveur.persist-backend-load-echoue': ({ backend }: MsgVars) => `persist-${backend} : load() a échoué — démarrage SANS restauration`,
  'serveur.persist-backend-save-echouee': ({ backend, id }: MsgVars) => `persist-${backend} : save('${id}') a échoué`,
  'serveur.persist-backend-remove-echouee': ({ backend, id }: MsgVars) => `persist-${backend} : remove('${id}') a échoué`,
  'serveur.persist-backend-entree-illisible': ({ backend, id }: MsgVars) => `persist-${backend} : entrée '${id}' illisible (JSON invalide) — ignorée`,
  'serveur.persist-backend-flush-sans-reponse': ({ backend, nb, delai }: MsgVars) => `persist-${backend} : flush() — ${nb} écriture(s) sans réponse après ${delai} s, l'arrêt continue sans les attendre (vérifiez votre stockage)`,

  // --- src/mjs-server/persist-redis.ts ---
  'serveur.persist-redis-operation-echouee': ({ label }: MsgVars) => `persist-redis : ${label} a échoué`,
  'serveur.persist-redis-connexion-indisponible': ({ label, timeout }: MsgVars) => `persist-redis : ${label} abandonné — connexion Redis indisponible après ${timeout} ms (le prochain save() rattrapera l'état)`,
  'serveur.persist-redis-load-delai-depasse': ({ timeout }: MsgVars) => `persist-redis : load() délai de connexion Redis dépassé (${timeout} ms) — démarrage SANS restauration`,

  // --- src/mjs-server/persist-bridge.ts ---
  'serveur.persist-bridge-load-tentative-echouee': ({ tentative }: MsgVars) => `persist-bridge : load() tentative ${tentative} échouée`,
  'serveur.persist-bridge-load-abandonne': 'persist-bridge : load() abandonné — démarrage SANS restauration',
  'serveur.persist-bridge-load-reponse-illisible': 'persist-bridge : load() réponse illisible',
  // entrées {id,data} malformées reçues du back, filtrées avant restitution
  'serveur.persist-bridge-load-entrees-invalides': ({ nb }: MsgVars) => `persist-bridge : load() ${nb} entrée(s) malformée(s) ignorée(s) (id/data invalides)`,
  'serveur.persist-bridge-tentative-echouee': ({ label, tentative }: MsgVars) => `persist-bridge : ${label} tentative ${tentative} échouée`,
  'serveur.persist-bridge-abandonne-apres-tentatives': ({ label, tentatives }: MsgVars) => `persist-bridge : ${label} abandonné après ${tentatives} tentative(s)`,

  // --- src/mjs-server/persist-sql.ts (suite) ---
  'serveur.persist-sql-table-creation-echouee': ({ table }: MsgVars) => `persist-sql : création de la table '${table}' a échoué`,
  'serveur.persist-sql-sqlite-non-pris-en-charge': "persist-sql : SQLite n'est pas pris en charge — le dialecte '?' écrit l'upsert de MySQL/MariaDB (ON DUPLICATE KEY UPDATE), que SQLite refuse : aucune partie n'est sauvegardée",

  // --- src/mjs-server/persist-file.ts (suite) ---
  'serveur.persist-file-fichier-corrompu': ({ fichier }: MsgVars) => `persist-file : fichier corrompu ignoré '${fichier}'`,
  'serveur.persist-file-copie-ignoree': ({ fichier, id }: MsgVars) => `persist-file : fichier '${fichier}' ignoré — il contient la partie '${id}', dont la sauvegarde est '${id}.json' (une copie de sauvegarde ? renommez-la ou retirez-la du dossier)`,

  // ═══ MJS-WS (src/mjs-ws/) ════════════════════════════════════════════════════════════════

  // avertissement de configuration — l'authentification par COOKIE rejoue le
  // cookie de la requête d'ouverture ; le navigateur l'attache tout seul, y compris depuis une
  // page tierce (une ouverture WebSocket n'est pas soumise à la politique des requêtes ordinaires).
  // Sans contrôle d'origine, une page tierce ouvre donc une connexion AUTHENTIFIÉE. Le patron par
  // jeton explicite n'a pas ce défaut : la page tierce ne peut pas lire le jeton
  'ws.core.origine-non-verifiee-avec-cookie': "[mjs-ws] ⚠️  authentification par cookie SANS verifyOrigin : n'importe quelle page tierce peut ouvrir une connexion authentifiée au nom de vos visiteurs (le navigateur joint le cookie tout seul). Armez verifyOrigin avec la liste des origines de votre application — cf. docs/23-mjs-ws.md § Vérifier l'origine.",

  // — adapter-redis.ts
  'ws.adapter-redis.entier-invalide': ({ line }: MsgVars) => `[mjs-ws/adapter-redis] entier RESP invalide '${line}' — flux corrompu ou pas du RESP`,
  'ws.adapter-redis.longueur-bulk-invalide': ({ line }: MsgVars) => `[mjs-ws/adapter-redis] longueur bulk RESP invalide '${line}' — flux corrompu ou pas du RESP`,
  'ws.adapter-redis.longueur-tableau-invalide': ({ line }: MsgVars) => `[mjs-ws/adapter-redis] longueur de tableau RESP invalide '${line}' — flux corrompu ou pas du RESP`,
  'ws.adapter-redis.octet-inattendu': ({ hex }: MsgVars) => `[mjs-ws/adapter-redis] octet RESP inattendu 0x${hex} — flux corrompu ou pas du RESP`,
  'ws.adapter-redis.url-invalide': ({ raw }: MsgVars) => `[mjs-ws/adapter-redis] URL Redis invalide '${raw}'`,
  'ws.adapter-redis.url-schema-invalide': ({ raw, protocol }: MsgVars) => `[mjs-ws/adapter-redis] URL Redis invalide '${raw}' — schéma attendu 'redis://' (ou 'rediss://'), reçu '${protocol}'`,
  'ws.adapter-redis.url-base-invalide': ({ raw, path }: MsgVars) => `[mjs-ws/adapter-redis] URL Redis invalide '${raw}' — base '${path}' n'est pas un entier`,
  'ws.adapter-redis.auth-echec': ({ role, err }: MsgVars) => `[mjs-ws/adapter-redis] authentification Redis en échec (${role}) : ${err}`,
  'ws.adapter-redis.auth-sans-utilisateur': ({ role, username }: MsgVars) => `[mjs-ws/adapter-redis] ${role} : ce Redis n'accepte pas de nom d'utilisateur dans AUTH (version antérieure à 6) — connexion avec le mot de passe seul, le nom « ${username} » de l'URL est ignoré`,
  'ws.adapter-redis.flux-corrompu': ({ role, err }: MsgVars) => `[mjs-ws/adapter-redis] flux RESP corrompu (${role}) — connexion fermée pour reconnexion propre : ${err}`,
  'ws.adapter-redis.reconnexion-backoff': ({ role, delay }: MsgVars) => `[mjs-ws/adapter-redis] reconnexion Redis (${role}) dans ${delay} ms`,
  'ws.adapter-redis.connexion-perdue': ({ role }: MsgVars) => `connexion Redis perdue (${role})`,
  'ws.adapter-redis.connexion-indisponible': ({ role }: MsgVars) => `connexion Redis indisponible (${role})`,
  'ws.adapter-redis.adaptateur-arrete': ({ role }: MsgVars) => `adaptateur arrêté (${role})`,
  'ws.adapter-redis.commande-sans-reponse': ({ role, delai }: MsgVars) => `commande Redis sans réponse après ${delai} s (${role}) — connexion fermée, l'ordre des réponses n'est plus sûr`,
  'ws.adapter-redis.commande-delai-depasse': ({ role, nb, delai }: MsgVars) => `[mjs-ws/adapter-redis] Redis ne répond plus (${role}) : ${nb} commande(s) sans réponse après ${delai} s — connexion fermée pour reconnexion propre (vérifiez votre serveur Redis)`,
  'ws.adapter-redis.connexion-pas-prete': ({ role, delai }: MsgVars) => `connexion Redis (${role}) pas prête ${delai} s après son ouverture (connexion, poignée de main TLS, AUTH ou SELECT sans réponse) — connexion fermée, la reconnexion reprend`,
  'ws.adapter-redis.connexion-delai-depasse': ({ role, nb, delai }: MsgVars) => `[mjs-ws/adapter-redis] connexion Redis (${role}) pas prête ${delai} s après son ouverture : ${nb} commande(s) en attente rejetée(s) — connexion fermée pour reconnexion propre (vérifiez l'adresse, le TLS et le mot de passe de votre serveur Redis)`,
  'ws.adapter-redis.messages-ignores': ({ channel, n, cause }: MsgVars) => `[mjs-ws/adapter-redis] message ignoré sur '${channel}' : ${cause} — ${n} ignoré(s) sur ce canal depuis son dernier avertissement (un par minute au plus)`,
  'ws.adapter.rappel-a-leve': ({ channel, n, cause }: MsgVars) => `[mjs-ws/adapter] un rappel du canal '${channel}' a levé : ${cause} — message ignoré pour ce rappel ; ${n} sur ce canal depuis le dernier avertissement (un par minute au plus)`,
  'ws.adapter-redis.publish-echec': ({ channel, err }: MsgVars) => `[mjs-ws/adapter-redis] publish('${channel}') en échec : ${err}`,
  'ws.adapter-redis.subscribe-echec': ({ channel, err }: MsgVars) => `[mjs-ws/adapter-redis] subscribe('${channel}') en échec : ${err}`,

  // — bridge.ts
  'ws.bridge.secret-manquant': ({ label }: MsgVars) => `[MJS-WS] ${label} manquant — un secret est OBLIGATOIRE pour activer le pont (chaîne littérale, ou 'env:NOM_VAR')`,
  'ws.bridge.secret-court': ({ label, length, min }: MsgVars) => `[MJS-WS] ${label} ne fait que ${length} caractères — ${min} au moins sont conseillés (openssl rand -hex 32, par exemple) : un secret court se devine hors ligne à partir d'une seule requête signée interceptée. Ce message apparaît une fois pour chaque serveur`,
  'ws.bridge.secret-env-absent': ({ label, varName }: MsgVars) => `[MJS-WS] ${label} référence la variable d'environnement '${varName}' — absente ou vide`,
  'ws.bridge.webhooks-url-manquant': '[MJS-WS] opts.bridge.webhooks.url manquant',
  'ws.bridge.webhooks-events-vide': "[MJS-WS] opts.bridge.webhooks.events doit être un tableau non vide (ex. ['connect', 'message:chat'])",
  'ws.bridge.webhooks-forward-headers-invalide': ({ received }: MsgVars) => `[MJS-WS] opts.bridge.webhooks.forwardHeaders doit être une liste de noms d'en-têtes HTTP (ex. ['x-remote-user']), reçu : ${received}`,
  'ws.bridge.signature-manquante': 'signature manquante (en-têtes x-mjs-ws-timestamp / x-mjs-ws-signature requis)',
  'ws.bridge.timestamp-invalide': 'x-mjs-ws-timestamp invalide (unix, en secondes, attendu)',
  'ws.bridge.horodatage-hors-fenetre': 'horodatage hors fenêtre — requête trop vieille ou rejeu suspect',
  'ws.bridge.nonce-requis': ({ min, max }: MsgVars) => `x-mjs-ws-nonce requis (chaîne de ${min} à ${max} caractères) — nonce anti-rejeu actif (ws.bridge.nonce)`,
  'ws.bridge.nonce-manquant': ({ min, max }: MsgVars) => `nonce manquant : ajoutez l'en-tête x-mjs-ws-nonce (une chaîne neuve de ${min} à ${max} caractères à chaque requête, par exemple 32 caractères hexadécimaux aléatoires) et placez-le en dernier champ de la chaîne signée — le pont l'exige par défaut`,
  'ws.bridge.signature-invalide': 'signature invalide',
  'ws.bridge.corps-trop-volumineux': 'corps de requête trop volumineux (max 1 Mo)',
  'ws.bridge.erreur-lecture-corps': 'erreur de lecture du corps de la requête',
  'ws.bridge.type-requis': "'type' requis (chaîne non vide)",
  'ws.bridge.except-invalide': "'except' doit être une personne (une chaîne), une connexion ({ client: id }) ou un tableau des deux",
  'ws.bridge.client-ou-user': "fournissez exactement l'un de 'client' ou 'user' (pas les deux, pas aucun)",
  'ws.bridge.client-user-chaine': "'client'/'user' doit être une chaîne non vide",
  'ws.bridge.room-requis': "'room' requis (chaîne non vide)",
  'ws.bridge.name-requis': "'name' requis (chaîne non vide)",
  'ws.bridge.op-invalide': "'op' doit être 'add', 'update', 'remove' ou 'reset'",
  'ws.bridge.id-requis-add': "'id' requis pour op 'add'",
  'ws.bridge.value-requis-add': "'value' requis pour op 'add'",
  'ws.bridge.id-requis-update': "'id' requis pour op 'update'",
  'ws.bridge.value-objet-update': "'value' doit être un objet (le patch) pour op 'update'",
  'ws.bridge.id-requis-remove': "'id' requis pour op 'remove'",
  'ws.bridge.values-objet-reset': "'values' doit être un objet pour op 'reset'",
  'ws.bridge.chemin-inconnu': ({ route }: MsgVars) => `chemin inconnu '${route}'`,
  'ws.bridge.requete-refusee': ({ error }: MsgVars) => `pont : requête refusée (${error})`,
  'ws.bridge.json-invalide': 'JSON invalide',
  'ws.bridge.erreur-interne': 'pont : erreur interne',
  'ws.bridge.delai-webhook-depasse': 'délai de webhook dépassé',
  'ws.bridge.reponse-http-non-2xx': 'réponse HTTP non-2xx',
  'ws.bridge.webhook-abandonne': ({ event, tentative }: MsgVars) => `pont : webhook '${event}' abandonné après ${tentative} tentative(s)`,
  'ws.bridge.file-webhooks-pleine': ({ max, event }: MsgVars) => `pont : file de webhooks pleine (${max}) — événement '${event}' abandonné`,
  'ws.bridge.file-webhooks-pleine-compte': ({ max, event, perdus }: MsgVars) => `pont : file de webhooks pleine (${max}) — événements abandonnés depuis le dernier avertissement : ${perdus} (dernier : '${event}') ; un avertissement par minute au plus, vérifiez que le back des webhooks répond`,
  'ws.bridge.webhook-non-serialisable': ({ event }: MsgVars) => `pont : webhook '${event}' abandonné — sa charge ne passe pas en JSON (un BigInt ou un objet cyclique dans l'identité ou la méta ?) ; rendez-la sérialisable`,
  'ws.bridge.hote-refuse': 'en-tête Host refusé — sans signature, le pont en boucle locale ne répond qu\'aux noms localhost, 127.0.0.1 et [::1] (parade au rebinding DNS)',
  'ws.bridge.erreur-interne-non-geree': 'pont : erreur interne non gérée',
  'ws.bridge.ecoute-pont': ({ host, port, nonce }: MsgVars) => `pont universel en écoute sur http://${host}:${port}${nonce ? ' (nonce : exigé)' : ''}`,
  // validation d'entrée AVANT tout envoi (broadcast/send/room-send/stream)
  'ws.bridge.charge-non-serialisable': ({ depth }: MsgVars) => `charge ('p'/'value'/'values') non sérialisable ou trop imbriquée (> ${depth} niveaux)`,
  'ws.bridge.echec-envoi': 'pont : échec d\'envoi — l\'encodage réseau du message a échoué côté serveur',

  // — chat.ts
  // canJoin/moderators qui lèvent : détail au journal serveur
  // (ces 2 clés), message GÉNÉRIQUE au client ('chat-denied', déjà catalogué par le handler appelant)
  'ws.chat.canjoin-a-leve': 'canJoin() a levé',
  'ws.cursors.canjoin-a-leve': 'canJoin() a levé',
  'ws.reactions.canjoin-a-leve': 'canJoin() a levé',
  'ws.follow.canlead-a-leve': 'canLead() a levé',
  'ws.heatmap.exclude-a-leve': 'exclude() a levé',
  'ws.heatmap.onpoint-a-leve': 'onPoint() a levé',
  'ws.heatmap.unit-inconnue': ({ unit, liste }: MsgVars) => `[mjs-ws:heatmap] unit « ${unit} » inconnue — une de : ${liste}`,
  'ws.heatmap.maxage-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] maxAge « ${valeur} » : un nombre plus grand que 0 (l'âge au-delà duquel un point s'efface, en unit)`,
  'ws.heatmap.file-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] file est le chemin d'un fichier (ex. 'heatmap.json') — reçu ${valeur}`,
  'ws.heatmap.saveevery-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] saveEvery « ${valeur} » : un nombre de millisecondes plus grand que 0 (défaut 60000, une minute)`,
  'ws.heatmap.origins-manquantes': `[mjs-ws:heatmap] origins manque : la liste des origines de vos pages, ex. heatmapPackage({ origins: ['https://monsite.fr'] }) — l'en-tête Origin se falsifie par un script : sans cette liste blanche, n'importe qui remplirait la carte d'adresses de son choix, que la page d'admin charge ensuite`,
  'ws.heatmap.origine-invalide': ({ valeur }: MsgVars) => `[mjs-ws:heatmap] origins : ${valeur} n'est pas une origine — une adresse http ou https sans chemin, ex. 'https://monsite.fr' ('https://monsite.fr/' passe aussi)`,
  'ws.heatmap.plafond-invalide': ({ nom, valeur }: MsgVars) => `[mjs-ws:heatmap] ${nom} « ${valeur} » : un nombre entier plus grand que 0 (un plafond de sécurité de la mémoire)`,
  'ws.heatmap.debit-adresse-invalide': ({ cle, valeur }: MsgVars) => `[mjs-ws:heatmap] addressRateLimit.${cle} « ${valeur} » : un nombre plus grand que 0 (les points par seconde, ou la rafale, d'une adresse) — ou addressRateLimit: false pour le seau de la connexion seul`,
  'ws.heatmap.file-relu': ({ file, n }: MsgVars) => `${n} point${Number(n) > 1 ? 's' : ''} relu${Number(n) > 1 ? 's' : ''} de ${file}`,
  'ws.heatmap.file-adresses-ecartees': ({ file, n }: MsgVars) => `pages écartées à la relecture de ${file} : ${n} — leur adresse n'est pas une adresse http ou https, ou dépasse 2000 caractères (la page d'admin les chargerait dans un cadre)`,
  'ws.heatmap.file-origines-ecartees': ({ file, n }: MsgVars) => `pages écartées à la relecture de ${file} : ${n} — leur origine n'est pas dans origins (heatmapPackage({ origins }) liste les origines de vos pages)`,
  'ws.heatmap.file-plafonds-ecartes': ({ file, pages, zones, maxPages, maxZones }: MsgVars) => `écartés à la relecture de ${file} : ${pages} page${Number(pages) > 1 ? 's' : ''} au-delà de maxPages (${maxPages}), ${zones} zone${Number(zones) > 1 ? 's' : ''} au-delà de maxZones (${maxZones} par page) — heatmapPackage({ maxPages, maxZones }) les règle`,
  'ws.heatmap.file-lecture': ({ file }: MsgVars) => `lecture impossible de ${file} : la carte repart de zéro`,
  'ws.heatmap.file-illisible': ({ file, aside }: MsgVars) => `${file} illisible : mis de côté sous ${aside}, la carte repart de zéro`,
  'ws.heatmap.file-intouchable': ({ file }: MsgVars) => `${file} illisible, et impossible à mettre de côté : il ne sera pas écrasé — les points restent en mémoire, sans fichier`,
  'ws.heatmap.file-ecriture': ({ file }: MsgVars) => `écriture impossible de ${file} : les points restent en mémoire, nouvel essai à la prochaine sauvegarde`,
  'ws.heatmap.plafond-points': ({ max }: MsgVars) => `plafond de sécurité atteint : ${max} point${Number(max) > 1 ? 's' : ''} — les plus anciens partent (heatmapPackage({ maxPoints }) le règle ; onPoint garde tout dans une base)`,
  'ws.heatmap.plafond-pages': ({ max }: MsgVars) => `plafond de sécurité atteint : ${max} page${Number(max) > 1 ? 's' : ''} — la page la moins récente part pour faire place à une nouvelle adresse (heatmapPackage({ maxPages }) le règle)`,
  'ws.heatmap.plafond-zones': ({ max, url }: MsgVars) => `plafond de sécurité atteint : ${max} zone${Number(max) > 1 ? 's' : ''} sur ${url} — la zone la moins récente de la page part pour faire place à une nouvelle (heatmapPackage({ maxZones }) le règle)`,
  'ws.chat.moderators-a-leve': 'moderators() a levé',

  // — accounts.ts
  'ws.accounts.dir-manquant': '[MJS-WS] FileAccountsPersistAdapter : opts.dir manquant',
  'ws.accounts.fichier-corrompu-ignore': ({ fichier }: MsgVars) => `comptes:file : fichier corrompu ignoré '${fichier}'`,
  'ws.accounts.remove-echoue': ({ id }: MsgVars) => `comptes:file : remove('${id}') a échoué`,
  'ws.accounts.rejet-non-intercepte': ({ label }: MsgVars) => `comptes:file : ${label} — rejet non intercepté`,
  'ws.accounts.save-echoue': ({ id }: MsgVars) => `comptes:file : save('${id}') a échoué`,
  'ws.accounts.secret-manquant': '[MJS-WS] accountsPackage : opts.secret manquant — DOIT être le MÊME secret que accountsAuth(secret) posé en mjsWs({ auth }) (cf. docs/27-accounts.md « Élévation »)',
  'ws.accounts.adaptateur-memoire-defaut': 'adaptateur mémoire (défaut) — les comptes NE SURVIVENT PAS à un redémarrage. DEV SEULEMENT : fournissez opts.persist (FileAccountsPersistAdapter, ou un adaptateur maison) en production.',
  'ws.accounts.hachage-reduit-essais': 'weakHashForTests : les secrets des comptes sont hachés à coût réduit (scrypt N = 2^10, r = 8, p = 1) — réservé aux tests, ne l\'activez jamais en production',
  'ws.accounts.persist-load-echoue': 'persist.load() a échoué — démarrage SANS comptes restaurés',
  'ws.accounts.persist-echec': ({ name }: MsgVars) => `persist.save() a échoué — compte '${name}' non créé`,
  'ws.accounts.enregistrement-incomplet-ignore': ({ id }: MsgVars) => `enregistrement de compte incomplet ignoré (id '${id}') : id, name, hash et salt doivent être des chaînes — son pseudo, s'il est lisible, reste réservé`,
  'ws.accounts.date-connexion-echec': ({ name }: MsgVars) => `persist.save() a échoué pour la date de dernière connexion de '${name}' — connexion acceptée quand même`,

  // — core.ts
  'ws.core.envoi-ignore-contre-pression': ({ clientId }: MsgVars) => `envoi ignoré (contre-pression) vers ${clientId}`,
  'ws.core.close-contre-pression-persistante': 'contre-pression persistante',
  'ws.core.echec-envoi-binaire': "échec d'envoi (binaire)",
  'ws.core.echec-serialisation': ({ type }: MsgVars) => `échec de sérialisation (type '${type}')`,
  'ws.core.echec-envoi': "échec d'envoi",
  'ws.core.client-expulse': ({ clientId, reason }: MsgVars) => `client ${clientId} expulsé (${reason})`,
  'ws.core.close-jeton-expire': 'jeton expiré',
  'ws.core.connexion-refusee-origine': ({ origin, address }: MsgVars) => `connexion refusée — origine non autorisée (${origin ?? 'absente'}, ${address ?? 'ip inconnue'})`,
  'ws.core.close-origine-refusee': 'origine refusée',
  'ws.core.plafond-global-atteint': ({ max }: MsgVars) => `plafond global de connexions atteint (${max})`,
  'ws.core.plafond-par-ip-atteint': ({ ip, max }: MsgVars) => `plafond par IP atteint (${ip}, ${max})`,
  'ws.core.connexion-refusee-raison': ({ reason }: MsgVars) => `connexion refusée — ${reason}`,
  'ws.core.refus-semblables-tus': ({ n }: MsgVars) => `(et ${n} autres refus semblables depuis la ligne précédente, non journalisés)`,
  'ws.core.close-reessayez-plus-tard': 'réessayez plus tard',
  'ws.core.verifyorigin-exception': 'connexion refusée — verifyOrigin a levé une exception',
  'ws.core.close-inactivite': 'inactivité',
  'ws.core.erreur-interne-non-geree': 'erreur interne non gérée',
  'ws.core.close-payload-trop-volumineux': 'payload trop volumineux',
  'ws.core.hello-attendu-premier': 'µ:hello attendu en premier message',
  'ws.core.hello-deja-recu': 'hello déjà reçu',
  'ws.core.type-inconnu': ({ type }: MsgVars) => `type inconnu '${type}'`,
  'ws.core.json-invalide-recu': ({ clientId }: MsgVars) => `JSON invalide reçu de ${clientId}`,
  'ws.core.close-trop-messages-invalides': 'trop de messages invalides',
  'ws.core.debit-depasse-ralentis': 'débit dépassé, ralentissez',
  'ws.core.close-debit-depasse': 'débit dépassé',
  'ws.core.close-trame-binaire-trop-volumineuse': 'trame binaire trop volumineuse',
  'ws.core.accroche-binaire-a-leve': "l'accroche binaire interne a levé",
  'ws.core.close-protocole-non-supporte': 'protocole non supporté',
  'ws.core.auth-exception-interne': ({ clientId, err }: MsgVars) => `opts.auth a levé une exception interne pour ${clientId} — message masqué au client : ${err}`,
  'ws.core.close-authentification-refusee': 'authentification refusée',
  'ws.core.close-session-deja-active': 'session déjà active pour cette identité',
  'ws.core.close-id-anon-reserve': 'identifiant de compte refusé : « anon: » est réservé aux visiteurs sans compte',
  'ws.core.auth-id-anon-reserve': ({ clientId, id }: MsgVars) => `opts.auth a rendu l'id « ${id} » pour ${clientId} : un id de compte ne peut pas commencer par « anon: », réservé aux visiteurs sans compte — connexion refusée ; donnez à vos comptes des id sans ce préfixe`,
  'ws.core.close-banni': 'banni temporairement',
  'ws.core.close-au-banc': ({ minutes }: MsgVars) => `mis au banc pour abus répétés — réessayez dans ${minutes} min`,
  'ws.core.banc-comptes-seulement': ({ minutes }: MsgVars) => `adresse mise au banc pour abus répétés — connectez-vous à votre compte pour continuer, ou réessayez dans ${minutes} min`,
  'ws.core.mise-au-banc-ip': ({ ip, fautes, minutes }: MsgVars) => `IP ${ip} mise au banc ${minutes} min (${fautes} expulsion${Number(fautes) > 1 ? 's' : ''} pour abus)`,
  'ws.core.mise-au-banc-ip-anonymes': ({ ip, fautes, minutes }: MsgVars) => `IP ${ip} mise au banc ${minutes} min pour les connexions anonymes (${fautes} expulsion${Number(fautes) > 1 ? 's' : ''} pour abus) — les comptes de cette adresse restent accueillis`,
  'ws.core.mise-au-banc-compte': ({ compte, fautes, minutes }: MsgVars) => `compte ${compte} mis au banc ${minutes} min (${fautes} expulsion${Number(fautes) > 1 ? 's' : ''} pour abus)`,
  'ws.core.welcome-a-leve': 'welcome() a levé — µ:welcome envoyé quand même (charge {})',
  'ws.core.client-repris': ({ clientId, sessionId, count }: MsgVars) => `client ${clientId} repris (session ${sessionId}, ${count} trame(s) rejouée(s))`,
  'ws.core.serve-a-leve': ({ type }: MsgVars) => `serve('${type}') a levé`,
  'ws.core.on-a-leve': ({ type }: MsgVars) => `on('${type}') a levé`,
  'ws.core.serve-a-refuse': ({ type, message }: MsgVars) => `serve('${type}') a refusé : ${message}`,
  'ws.core.on-a-refuse': ({ type, message }: MsgVars) => `on('${type}') a refusé : ${message}`,
  'ws.core.erreur-interne-client': 'erreur interne du serveur',
  'ws.core.uncaught-exception-survit': 'uncaughtException — process survit',
  'ws.core.unhandled-rejection-survit': 'unhandledRejection — process survit',
  'ws.core.paquet-deja-installe': ({ nom }: MsgVars) => `paquet '${nom}' déjà installé — installation ignorée`,
  'ws.core.depart-salon-a-leve': ({ room }: MsgVars) => `un paquet a levé en apprenant un départ du salon '${room}' — le départ est quand même enregistré`,
  'ws.core.installer-a-leve': ({ nom }: MsgVars) => `installer('${nom}') a levé — paquet NON installé`,
  'ws.core.ondisconnect-a-leve': ({ clientId }: MsgVars) => `opts.onDisconnect a levé pour ${clientId} — la purge de la connexion est allée à son terme`,
  'ws.core.ondisconnect-a-rejete': ({ clientId }: MsgVars) => `opts.onDisconnect a rejeté pour ${clientId} — sans effet sur la purge de la connexion`,
  'ws.core.process-distant-bail-expire': ({ pid }: MsgVars) => `[MJS-WS] process distant '${pid}' — bail expiré, purge de ses pairs de présence`,
  'ws.core.verification-baux-echec': ({ err }: MsgVars) => `[MJS-WS] vérification des baux distants en échec : ${err}`,
  'ws.core.message-canal-malforme': ({ channel, n }: MsgVars) => `[MJS-WS] message de forme inattendue ignoré sur le canal '${channel}' (autre application sur le même Redis, outil d'administration, version voisine pendant une mise à jour ?) — ${n} ignoré(s) sur ce canal depuis son dernier avertissement (un par minute au plus)`,
  'ws.core.renouvellement-bail-echec': ({ err }: MsgVars) => `[MJS-WS] renouvellement du bail en échec : ${err}`,

  // — index.ts
  'ws.index.adapter-redis-manquant': "[MJS-WS] opts.adapter.redis manquant — attendu une URL 'redis://...' (ou une instance MjsWsAdapter déjà construite)",
  'ws.index.transport-invalide': ({ raw }: MsgVars) => `[MJS-WS] transport invalide : '${raw}' — valeurs valides : 'ws', 'uws', ou une instance MjsWsTransport`,
  'ws.index.session-exclusive-invalide': ({ raw }: MsgVars) => `[MJS-WS] sessionExclusive invalide : ${raw} — valeurs valides : true, false, 'replace', 'refuse'`,
  'ws.index.ban-invalide': ({ cle, raw, attendu }: MsgVars) => `[MJS-WS] ${cle} invalide : ${raw} — attendu : ${attendu}`,
  'ws.index.entier-positif': 'un entier ≥ 1',
  'ws.index.rate-by-invalide': ({ raw, valides }: MsgVars) => `[MJS-WS] limits.rateBy invalide : ${raw} — valeurs valides : ${valides}`,
  'ws.index.reglage-invalide': ({ cle, raw, attendu }: MsgVars) => `[MJS-WS] ${cle} invalide : ${raw} — attendu : ${attendu}`,
  'ws.index.nombre-positif-ou-nul': 'un nombre fini ≥ 0',
  'ws.index.nombre-positif-ou-nul-ou-null': 'un nombre fini ≥ 0, ou null (illimité)',
  'ws.index.entier-positif-ou-false': 'un entier ≥ 1, ou false (désactivée)',

  // — lobby.ts
  // clé HISTORIQUE inchangée (lobby.ts la référence telle quelle) —
  // seul le TEXTE est corrigé : l'option réelle est `opts.onJoin`, jamais `onRejoindre`.
  'ws.lobby.onrejoindre-a-leve': 'onJoin a levé',
  // moderators qui lève (lobby:withdraw) : détail au journal
  // serveur (cette clé), message GÉNÉRIQUE au client ('lobby-denied', déjà catalogué par le handler)
  'ws.lobby.moderators-a-leve': 'moderators() a levé',

  // — proxy.ts
  'ws.proxy.secret-manquant': ({ label }: MsgVars) => `[MJS-WS] ${label} : 'secret' manquant — OBLIGATOIRE (chaîne littérale, ou 'env:NOM_VAR')`,
  'ws.proxy.secret-env-absent': ({ label, varName }: MsgVars) => `[MJS-WS] ${label} : 'secret' référence la variable d'environnement '${varName}' — absente ou vide`,
  'ws.proxy.url-manquante': "[MJS-WS] proxy de décision : 'url' manquante (chaîne non vide attendue)",
  'ws.proxy.url-invalide': ({ url }: MsgVars) => `[MJS-WS] proxy de décision : 'url' invalide : ${url}`,
  'ws.proxy.http-non-loopback': ({ url }: MsgVars) => `[MJS-WS] proxy de décision (${url}) : http:// non-loopback = risque d'usurpation d'identité par MITM — utilisez https:// ou, en connaissance de cause, { allowInsecure: true }`,
  'ws.proxy.cache-ttl-invalide': ({ url }: MsgVars) => `[MJS-WS] proxy de décision (${url}) : 'cache.ttl' doit être un entier > 0 (ms)`,
  'ws.proxy.signature-absente': 'non signée (en-têtes x-mjs-ws-timestamp/x-mjs-ws-signature absents)',
  'ws.proxy.timestamp-invalide': 'x-mjs-ws-timestamp invalide',
  'ws.proxy.horodatage-hors-fenetre': 'horodatage hors fenêtre (rejeu suspect)',
  'ws.proxy.reponse-statut-refus': ({ url, status, event }: MsgVars) => `proxy de décision — ${url} a répondu ${status} (event '${event}') — décision de refus`,
  'ws.proxy.reponse-signature-refus': ({ url, erreur, event }: MsgVars) => `proxy de décision — ${url} : réponse ${erreur} (event '${event}') — décision de refus`,
  'ws.proxy.reponse-json-invalide': ({ url, event }: MsgVars) => `proxy de décision — ${url} : réponse JSON invalide (event '${event}') — décision de refus`,
  'ws.proxy.requete-en-echec': ({ url, event }: MsgVars) => `proxy de décision — ${url} en échec (event '${event}') — décision de refus`,
  'ws.proxy.authentification-refusee': 'authentification refusée (proxy)',
  // plafond de la réponse du back (MÊME esprit que le corps entrant du pont)
  'ws.proxy.reponse-trop-volumineuse': ({ url, event, max }: MsgVars) => `proxy de décision — ${url} : réponse trop volumineuse (plafond ${max} octets, event '${event}') — décision de refus`,

  // — token.ts
  'ws.token.secret-manquant': ({ fn }: MsgVars) => `[MJS-WS] ${fn} : secret manquant ou vide — un secret est OBLIGATOIRE pour signer et vérifier les jetons (une chaîne non vide). Avec un secret vide, n'importe qui fabriquerait un jeton valide : vérifiez que la variable d'environnement qui le porte (JWT_SECRET, par exemple) est bien définie`,
  // émis UNE fois par processus, au premier secret de jeton trop court
  'ws.token.secret-court': ({ fn, length, min }: MsgVars) => `[MJS-WS] ${fn} : le secret des jetons ne fait que ${length} caractères — ${min} au moins sont conseillés (openssl rand -hex 32, par exemple) : un secret court se devine hors ligne à partir d'un seul jeton intercepté. Ce message n'apparaît qu'une fois`,
  // options de jwtAuth/verifyToken/accountsAuth, audience, issuer et clés inconnues d'accountsPackage — refusées dès la construction
  'ws.token.options-invalides': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn} : les options doivent être un objet ({ audience, issuer, clockTolerance }, chacune facultative), reçu : ${received}`,
  'ws.token.audience-invalide': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn} : audience doit être une chaîne non vide ou une liste non vide de chaînes non vides (le site pour lequel les jetons sont faits, par exemple 'boutique' ou ['boutique', 'boutique-admin']), reçu : ${received}. Si la valeur vient d'une variable d'environnement, vérifiez qu'elle est bien définie`,
  'ws.token.issuer-invalide': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn} : issuer doit être une chaîne non vide ou une liste non vide de chaînes non vides (l'émetteur attendu des jetons, par exemple 'https://boutique.fr'), reçu : ${received}. Si la valeur vient d'une variable d'environnement, vérifiez qu'elle est bien définie`,
  'ws.token.tolerance-invalide': ({ fn, received }: MsgVars) => `[MJS-WS] ${fn} : clockTolerance doit être un nombre de secondes fini, positif ou nul (la tolérance d'horloge appliquée à exp et nbf, par exemple 30 ; 0 par défaut), reçu : ${received}`,
  'ws.token.option-inconnue': ({ fn, key, hint, known }: MsgVars) => `[MJS-WS] ${fn} : option '${key}' inconnue${hint}\n  Options valides : ${known}`,
  'ws.token.option-inconnue-suggestion': ({ suggestion }: MsgVars) => ` — vouliez-vous dire '${suggestion}' ?`,

  // — rooms.ts
  'ws.rooms.meta-a-leve': 'rooms.meta() a levé',
  // join/canSeePresence qui lèvent : détail au journal serveur
  // (ces 2 clés), même message GÉNÉRIQUE au client que le refus explicite (false), juste en dessous
  'ws.rooms.join-a-leve': 'join() a levé',
  'ws.rooms.acces-salon-refuse': 'accès au salon refusé',
  'ws.rooms.can-see-presence-a-leve': 'canSeePresence() a levé',
  'ws.rooms.acces-presence-refuse': 'accès à la présence du salon refusé',
  'ws.rooms.presence-reservee-aux-membres': `présence réservée aux membres du salon : rejoignez-le d'abord`,
  'ws.rooms.presence-globale-fermee': `présence globale fermée sur ce serveur : ouvrez-la avec mjsWs({ presence: 'public' })`,
  'ws.rooms.trop-de-salons': 'trop de salons',
  'ws.rooms.nom-trop-long': ({ max }: MsgVars) => `nom de salon trop long (${max} caractères au plus)`,

  // — schema.ts
  'ws.schema.codec-invalide': ({ raw }: MsgVars) => `[MJS-WS] ws.codec invalide : '${raw}' — valeurs valides : 'auto', 'binary', 'json'`,
  'ws.schema.binaire-strict-refuse': ({ type }: MsgVars) => `[MJS-WS] ws.codec 'binary' strict — envoi du type applicatif '${type}' SANS schéma déclaré. Déclarez-le d'abord : app.schema('${type}', { ... }) (ou opts.schemas en masse), ou repassez en ws.codec 'auto'/'json' si ce type doit vraiment voyager en JSON.`,
  'ws.schema.decodage-echec': 'µschema — décodage en échec (trame corrompue ?)',
  'ws.schema.id-inconnu-desynchronise': ({ id }: MsgVars) => `id de schéma inconnu (${id}) — registre local désynchronisé, cf. µ:schema`,
  'ws.schema.trame-binaire-corrompue': 'trame binaire corrompue',
  'ws.schema.texte-strict-rejete': ({ type }: MsgVars) => `ws.codec 'binary' strict — type applicatif texte '${type}' rejeté, déclarez-le via app.schema() (ou repassez en codec 'auto'/'json')`,

  // — sessions.ts
  'ws.sessions.expiree-purge-differee': ({ id, clientId }: MsgVars) => `session ${id} expirée sans retour — purge différée de ${clientId}`,
  'ws.sessions.client-parque': ({ clientId, id, grace }: MsgVars) => `client ${clientId} parqué (session ${id}, grâce ${grace} ms)`,
  'ws.sessions.tampon-reprise-deborde': ({ clientId, id }: MsgVars) => `tampon de reprise débordé pour ${clientId} (session ${id}) — session non reprenable`,
  'ws.sessions.session-revoquee': ({ id, clientId }: MsgVars) => `session ${id} révoquée (identité déjà reconnectée ailleurs) — purge de ${clientId}`,

  // — streams.ts
  'ws.streams.mutation-clusterisee-echec': ({ name }: MsgVars) => `flux '${name}' — mutation clusterisée en échec`,
  'ws.streams.flux-non-declare': ({ via, name }: MsgVars) => `${via} vers un flux non déclaré '${name}' — reset vide renvoyé`,
  'ws.streams.ecriture-apres-destroy': ({ name, op }: MsgVars) => `écriture '${op}' sur le flux '${name}' après son destroy() — sans effet : ce flux est retiré ; pour le servir de nouveau, déclarez-le avec app.stream('${name}') et écrivez avec cette nouvelle poignée`,
  'ws.streams.application-avec-trou': ({ name, reason, count }: MsgVars) => `flux '${name}' — ${reason} : application avec un trou (${count} delta(s) en attente)`,
  'ws.streams.tampon-reordonnancement-plein': ({ max }: MsgVars) => `tampon de réordonnancement plein (${max})`,
  'ws.streams.delai-reordonnancement-depasse': ({ ms }: MsgVars) => `délai de réordonnancement dépassé (${ms} ms)`,
  // garde d'ABONNEMENT (canSubscribe/room, cf. MjsWsStreamOptions)
  'ws.streams.room-sans-accroche': ({ name, room }: MsgVars) => `flux '${name}' — option 'room' ('${room}') exige un accroche que le moteur ne câble pas encore (createStreamsEngine, paramètre hasRoomMember absent) : app.stream() refuse de démarrer plutôt que de laisser 'room' silencieusement sans effet — utilisez canSubscribe: (client) => app.room('${room}').has(client) en attendant`,
  'ws.streams.abonnement-refuse': ({ via, name }: MsgVars) => `${via} refusé vers le flux '${name}' — garde d'accès non satisfaite (canSubscribe/room)`,
  'ws.streams.flux-pont-non-declare': ({ via, name }: MsgVars) => `${via} refusé vers le flux '${name}' — écrit par le pont mais jamais déclaré sur ce processus : déclarez-le avec app.stream() (et sa garde s'il est privé) ; un flux du pont n'est jamais public par défaut`,
  'ws.streams.acces-flux-refuse': 'accès au flux refusé',
  'ws.streams.flux-ferme-a-la-declaration': ({ name }: MsgVars) => `flux '${name}' fermé : déclaré sans accès, il n'est servi à personne — écrivez app.stream('${name}', { public: true }) pour l'ouvrir à tous, ou { room } / { canSubscribe } pour le réserver`,
  'ws.streams.abonnement-flux-ferme': ({ via, name }: MsgVars) => `${via} refusé vers le flux '${name}' — flux fermé, déclaré sans accès : écrivez app.stream('${name}', { public: true }) pour l'ouvrir à tous, ou { room } / { canSubscribe } pour le réserver`,
  'ws.streams.flux-non-declare-nom-trop-long': ({ via, name, max }: MsgVars) => `${via} vers un flux non déclaré au nom trop long '${name}' (${max} caractères au plus) — erreur renvoyée`,
  'ws.streams.nom-trop-long': ({ max }: MsgVars) => `nom de flux trop long (${max} caractères au plus)`,
  'ws.streams.desabonnement-flux-non-declare': ({ name }: MsgVars) => `µ:unsub-stream vers un flux non déclaré '${name}' — refusé, aucun abonnement à retirer (µ:error renvoyé)`,
  'ws.streams.desabonnement-flux-inconnu': 'désabonnement refusé : flux inconnu',
  'ws.streams.garde-sans-reponse': "accès au flux refusé : sa garde n'a pas répondu à temps",
  'ws.streams.garde-sans-reponse-journal': ({ name, ms }: MsgVars) => `flux '${name}' — la garde canSubscribe n'a pas répondu en ${ms} ms (guardTimeout) : comptée comme un refus ; vérifiez l'appel qu'elle attend (back, base de données…) ou allongez guardTimeout`,
  // garde de profondeur/sérialisation (add/update/reset)
  'ws.streams.entree-non-serialisable': ({ name, op, depth }: MsgVars) => `flux '${name}' — ${op}() refusé : valeur non sérialisable ou trop imbriquée (> ${depth} niveaux) — jamais stockée (empoisonnerait durablement snapshot()/µ:sub-stream pour tout futur abonné)`,

  // — transport-uws.ts
  'ws.transport-uws.paquet-requis': "le paquet uWebSockets.js est requis pour transport: 'uws' — npm install uNetworking/uWebSockets.js#v20.52.0",
  'ws.transport-uws.echec-ecoute': ({ port, host }: MsgVars) => `[mjs-ws/transport-uws] échec d'écoute sur le port ${port}${host ? ` (${host})` : ''} — port déjà utilisé ?`,
  'ws.transport-uws.echec-ecoute-socket': ({ path }: MsgVars) => `[mjs-ws/transport-uws] échec du bind sur la socket unix ${path} — répertoire absent, droits refusés, ou un process y écoute déjà ?`,
  'ws.transport-uws.socket-trop-longue': ({ path, bytes, max }: MsgVars) => `[mjs-ws/transport-uws] chemin de socket unix trop long (${bytes} octets, ${max} au plus) : ${path}`,

  // — transport-ws.ts
  'ws.watchdog.arme': ({ periode, fenetre }: MsgVars) => `[mjs-ws/watchdog] chien de garde systemd armé — battement toutes les ${periode} ms (fenêtre ${fenetre} ms)`,
  'ws.watchdog.fenetre-trop-courte': ({ periode, fenetre }: MsgVars) => `[mjs-ws/watchdog] fenêtre du chien de garde très courte (WatchdogSec = ${fenetre} ms) : le battement, à la moitié de la fenêtre, lance systemd-notify toutes les ${periode} ms, et un retard de la boucle de plus de ${periode} ms fera tuer le service ; réglez WatchdogSec à 1 s au moins`,
  'ws.watchdog.notifier-introuvable': ({ notifier }: MsgVars) => `[mjs-ws/watchdog] ${notifier} est introuvable alors que systemd arme un chien de garde (WATCHDOG_USEC) : sans lui le service serait abattu toutes les WatchdogSec secondes, en silence — arrêt immédiat`,
  'ws.watchdog.notifier-refuse': ({ notifier, code }: MsgVars) => `[mjs-ws/watchdog] ${notifier} a rendu ${code} au premier battement — vérifiez NotifyAccess=all dans l'unité systemd (le défaut, main, REFUSE le message d'un enfant et fait tuer un service sain) — arrêt immédiat`,

  'ws.transport-ws.paquet-requis': 'le paquet "ws" est requis pour mjs ws — npm install ws',

  // — trust-proxy.ts
  'ws.trust-proxy.vrai-refuse': "[MJS-WS] trustProxy : true est refusé — croire les en-têtes de n'importe quel pair laisserait tout visiteur choisir l'adresse qu'il veut. Choisissez 'loopback' (votre proxy tourne sur la même machine) ou la liste de vos proxies, par exemple ['10.0.0.0/8', '192.168.1.5']",
  'ws.trust-proxy.valeur-invalide': ({ raw }: MsgVars) => `[MJS-WS] trustProxy invalide : ${raw} — valeurs valides : false, 'loopback', ou une liste d'adresses ou de plages, par exemple ['10.0.0.0/8', '192.168.1.5']`,
  'ws.trust-proxy.entree-invalide': ({ entry }: MsgVars) => `[MJS-WS] trustProxy : ${entry} n'est ni une adresse IP ni une plage (10.0.0.0/8, fd12:3456::/32) — attendu : 'loopback', ou une liste comme ['10.0.0.0/8', '192.168.1.5']`,
  'ws.trust-proxy.plage-trop-etendue': ({ entry, family, max }: MsgVars) => `[MJS-WS] trustProxy : la plage ${entry} est trop étendue — plus large que /${max} en ${family}. Un visiteur direct dont l'adresse tombe dans une plage de confiance est cru sur parole : il choisit l'adresse qu'il veut dans X-Forwarded-For, et les bornes par adresse (connexions, mise au banc, verrou des codes de partie) ne le retiennent plus. Listez vos proxies réels, par exemple ['10.0.0.0/8', '192.168.1.5']`,
  'ws.trust-proxy.plage-trop-large': ({ entry }: MsgVars) => `[MJS-WS] trustProxy : la plage ${entry} couvre toutes les adresses — c'est true sous un autre nom, refusé de la même façon. Listez vos proxies réels, par exemple ['10.0.0.0/8', '192.168.1.5']`,
  // émis UNE fois, au premier en-tête de proxy venu d'une adresse locale quand trustProxy n'est pas réglé
  'ws.trust-proxy.proxy-sans-reglage': "[MJS-WS] des en-têtes de proxy (X-Forwarded-For ou X-Real-IP) arrivent d'une adresse locale : vous semblez être derrière un proxy (nginx, par exemple). Sans trustProxy, tous vos visiteurs partagent l'adresse du proxy, et les bornes par adresse (connexions par adresse, verrou des codes de partie, mise au banc) s'appliquent à tous à la fois. Réglez trustProxy: 'loopback' (ou trustProxy: false pour garder ce comportement et ne plus voir ce message) — cf. docs/23-mjs-ws.md § Derrière un proxy inverse.",
  // émis UNE fois pour tout le processus, quand X-Real-IP et X-Forwarded-For d'un proxy de confiance ne désignent pas le même visiteur
  'ws.trust-proxy.en-tetes-contradictoires': "[MJS-WS] trustProxy : X-Real-IP et X-Forwarded-For, reçus d'un proxy de confiance, ne désignent pas le même visiteur. Votre proxy n'écrit sans doute que l'un des deux et laisse passer l'autre tel que le visiteur l'a envoyé, avec l'adresse de son choix : dans le doute, la connexion porte l'adresse du proxy. Faites écrire les deux en-têtes par votre proxy (nginx : proxy_set_header X-Real-IP $remote_addr; et proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;), ou faites-lui retirer celui qu'il n'écrit pas (HAProxy : http-request del-header X-Real-IP) — cf. docs/23-mjs-ws.md § Derrière un proxy inverse. Ce message ne paraît qu'une fois.",

  // — transport.ts
  'ws.transport.send-non-ouvert': '[MemoryTransport] send() sur un WebSocket non ouvert',
  'ws.transport.arrete': 'transport arrêté',
  'ws.transport.connect-avant-start': '[MemoryTransport] connect() avant start()',

  // ═══ MJS-WS — dashboard d'état (src/mjs-ws/stats-page.ts, hors inventaire, cf. risques §6) ═══

  'ws.stats.titre-page': 'µWS — état du serveur',
  'ws.stats.pied-de-page': 'auto-rafraîchi toutes les 2 s — dernière mise à jour',
  'ws.stats.titre-connexions': 'Connexions',
  'ws.stats.titre-salons': 'Salons',
  'ws.stats.titre-flux': 'Flux',
  'ws.stats.titre-messages': 'Messages',
  'ws.stats.titre-garde': 'Garde (kicks)',
  'ws.stats.titre-pont': 'Pont',
  'ws.stats.titre-adaptateur': 'Adaptateur',
  'ws.stats.titre-sessions': 'Sessions',
  'ws.stats.titre-intervalle-ping': 'Intervalle entre deux pings (ms)',
  'ws.stats.titre-memoire': 'Mémoire / uptime',
  'ws.stats.champ-actives': 'actives',
  'ws.stats.champ-parquees': 'parquées',
  'ws.stats.champ-accueillies': 'accueillies',
  'ws.stats.champ-refusees': 'refusées',
  'ws.stats.champ-refusees-plafond': 'refusées (plafond)',
  'ws.stats.champ-refusees-origine': 'refusées (origine)',
  'ws.stats.champ-refusees-ban': 'refusées (au banc)',
  'ws.stats.champ-fermees': 'fermées',
  'ws.stats.champ-nombre': 'nombre',
  'ws.stats.champ-membres-total': 'membres au total',
  'ws.stats.champ-abonnes-presence': 'abonnés présence',
  'ws.stats.champ-deltas-emis': 'deltas émis',
  'ws.stats.champ-resyncs-rejeu': 'resyncs (rejeu)',
  'ws.stats.champ-resyncs-reset': 'resyncs (reset)',
  'ws.stats.champ-recus': 'reçus',
  'ws.stats.champ-envoyes': 'envoyés',
  'ws.stats.champ-tamponnes': 'tamponnés',
  'ws.stats.champ-rejoues': 'rejoués',
  'ws.stats.champ-rejetes': 'rejetés',
  'ws.stats.champ-binaire-recues': 'binaires reçues',
  'ws.stats.champ-binaire-ignorees': 'binaires ignorées',
  'ws.stats.champ-kicks-debit': 'débit',
  'ws.stats.champ-kicks-silence': 'silence',
  'ws.stats.champ-kicks-engorgement': 'engorgement',
  'ws.stats.champ-kicks-charge-utile': 'charge utile',
  'ws.stats.champ-mises-au-banc': 'mises au banc',
  'ws.stats.champ-expirations-jeton': 'jeton expiré',
  'ws.stats.champ-rate-limited': 'limitées (429)',
  'ws.stats.champ-webhooks-envoyes': 'webhooks envoyés',
  'ws.stats.champ-webhooks-echoues': 'webhooks échoués',
  'ws.stats.champ-webhooks-abandonnes': 'webhooks abandonnés',
  'ws.stats.champ-publies': 'publiés',
  'ws.stats.champ-ignores-origin': 'ignorés (origin)',
  'ws.stats.champ-reordonnances': 'réordonnancés',
  'ws.stats.champ-reconnexions': 'reconnexions',
  'ws.stats.champ-emises': 'émises',
  'ws.stats.champ-reprises': 'reprises',
  'ws.stats.champ-expirees': 'expirées',
  'ws.stats.champ-debordees': 'débordées',
  'ws.stats.champ-echantillon': 'échantillon',
  'ws.stats.sub-process': 'process ',
  'ws.stats.sub-depuis': ' — actif depuis ',
  'ws.stats.sub-s': ' s',

  // commentaire HTML `<!-- … -->` jamais refermé : même famille que
  // parser.chaine-non-fermee/delimiteur-non-ferme (bannière « fin de fichier atteinte »).
  'parser.commentaire-non-ferme': ({ ligne }: MsgVars) => `

🚨 [COMMENTAIRE NON FERMÉ] \`<!--\` ouvert ligne ${ligne} n'a pas de \`-->\` correspondant.
   Fin de fichier atteinte : tout le HTML suivant a été avalé par le commentaire.
👉 Fermez le commentaire par \`-->\`.

`,
  'parser.cdata-non-fermee': ({ ligne }: MsgVars) => `

🚨 [CDATA NON FERMÉE] \`<![CDATA[\` ouverte ligne ${ligne} dans un <svg> ou un <math> n'a pas de \`]]>\` correspondant.
   Le navigateur lirait tout le reste du composant comme du texte : balises et valeurs disparaîtraient.
👉 Fermez la section par \`]]>\`.

`,
  // balise HTML jamais refermée jusqu'à la fin du fichier : même famille que
  // parser.balise-fermante-orpheline (symétrique, fermante SANS ouvrante).
  'parser.balise-non-fermee': ({ nom, ligne }: MsgVars) => `

🚨 [BALISE NON FERMÉE] \`<${nom}>\` ouverte ligne ${ligne} n'a pas de \`</${nom}>\` correspondante.
   Fin de fichier atteinte avant la fermeture.
👉 Ajoutez la balise fermante manquante, ou rendez la balise auto-fermante (\`<${nom} />\`) si elle n'a pas de contenu.

`,
  // filet GÉNÉRIQUE côté parseur : un nom
  // d'attribut vu deux fois sur la même balise, quelle que soit sa forme d'origine (directive
  // `@…=` déjà réécrite, attribut natif dupliqué, forme non couverte par la détection textuelle
  // de preprocessHtml qui ne voit que SES marqueurs reconnus). `@class{cond}`/`@style.prop{cond}`
  // incluent la condition dans le nom : deux conditions différentes ne collisionnent jamais.
  'parser.attribut-duplique': ({ attribut, tag, ligne }: MsgVars) => `

🚨 [ATTRIBUT DUPLIQUÉ] \`${attribut}\` apparaît deux fois sur <${tag}> (ligne ${ligne}).
   Un attribut HTML dupliqué ne garde que la PREMIÈRE valeur au DOM ; le second est silencieusement ignoré.
👉 Retirez l'un des deux.

`,
  // @import $X (dollar simple, sans µ$) : un nom importé ne porte
  // jamais `$` seul, un singleton s'importe et se consomme UNIQUEMENT par `µ$$X` (docs/14-stores.md
  // § « Un seul symbole, un seul rôle ») — `@import $counter` compilait en silence.
  'transpiler.import-nom-dollar': ({ nom, base }: MsgVars) => `[ModularJS] @import ${nom} : un nom importé ne porte jamais « $ » — un singleton s'importe et se consomme par « µ$$${base} » (déclaration « export µ$$${base} = … » dans le module).`,
  // @no-ujs/@noUJS : forme NUE seulement, même politique que @permanent
  // (transpiler/index.ts) — l'appariement UJS ne porte aucune valeur, une valeur qui traîne serait
  // un bogue muet (attribut mjs-no-ujs='valeur' posé au lieu du marqueur nu attendu).
  'transpiler.no-ujs-valeur-refusee': ({ valeur }: MsgVars) => `[ModularJS] @no-ujs=${valeur} : cette directive ne prend jamais de valeur — elle désactive l'interception UJS pour l'élément entier, rien à préciser ; écrivez @no-ujs seul (ou @noUJS).`,
  // préfixe le nom du module devant TOUT message d'erreur du pipeline
  // transpile()/transpileFile() qui ne le porte pas déjà (~25 erreurs de preprocessHtml sans
  // fichier ni ligne, erreur de l'analyseur sans fichier) — sur un build multi-fichiers, savoir
  // LEQUEL des composants a échoué.
  'transpiler.erreur-dans-module': ({ moduleName, message }: MsgVars) => `'${moduleName}' : ${message}`,
  // même directive posée deux fois sur la MÊME balise (ex. @confirm=…
  // @confirm=…) : seule la première valeur survit au DOM (attribut HTML dupliqué), la seconde,
  // écrite par le dev, est silencieusement ignorée — refusé au build plutôt que laissé muet.
  'transpiler.directive-dupliquee': ({ directive, balise }: MsgVars) => `[ModularJS] ${directive} est posé deux fois sur <${balise}> — un attribut HTML dupliqué ne garde que la PREMIÈRE valeur au DOM ; retirez l'un des deux.`,
  // deux hooks du même nom (µmount/µawake/µsleep/µdestroy/µfailed/µurlChange)
  // dans le même <script> : `_mjs_hooks[name]` est un slot UNIQUE au runtime, le second écrase
  // le premier SANS le moindre signal — refusé ICI, à la compilation.
  'transpiler.hook-duplique': ({ moduleName, hook }: MsgVars) => `[ModularJS] '${moduleName}.mjs' déclare µ${hook} deux fois — le second écrase le premier au runtime (un seul emplacement par hook), le premier ne s'exécute jamais ; regroupez les deux blocs en un seul.`,
  // cible d'@import contenant un guillemet/antislash/retour à la ligne/NUL : cette
  // valeur s'insère telle quelle dans la chaîne double-quote générée (fromClause) — jamais admise.
  'transpiler.import-cible-invalide': ({ cible }: MsgVars) => `[ModularJS] @import : cible '${cible}' invalide — elle ne peut être vide ni contenir un guillemet, un antislash, un accent grave, une interpolation #{…}/\${…} ou un retour à la ligne (forme attendue : @import nom 'chemin').`,
  // entry .civet BRUTE (compileRawCivetFile) : une directive MJS (@import, @css…)
  // en colonne 0 y compile en Civet ordinaire sans jamais faire ce qu'elle promet (erreur muette
  // au runtime seulement) — refusée avant compilation, renvoie vers .server.mjs.
  'cli.entry-civet-brut-directive': ({ entryPath, directive }: MsgVars) => `'${entryPath}' : la directive ${directive} n'existe pas dans une entry '.civet' brute (aucune pré-passe MJS) — renommez le fichier en '.server.mjs' pour utiliser ${directive}.`,
  // $__proto__/$constructor/$prototype : nom d'état réservé, rejeté AVANT
  // l'analyse (sinon expandOneDep plante en silence sur le prototype JS, TypeError non orienté).
  'analyzer.nom-etat-reserve': ({ name }: MsgVars) => `[ModularJS] $${name} : nom d'état réservé — « ${name} » appartient au prototype JavaScript, choisissez un autre nom.`,
  // repli Civet du suivi de dépendances (getEffectVars) épuisé :
  // dernier avertissement avant de classer l'effet « mountOnly » à tort (vue jamais remise à jour).
  'generator.deps-non-analysables': ({ expr, moduleHint }: MsgVars) => `[ModularJS] ⚠️  dépendances non analysables pour « ${expr} »${moduleHint} — la vue ne se remettra pas à jour.`,
  // une fonction importée d'un module .js écrit dans le magasin $$x (ou le chemin dedans) qu'elle reçoit en argument :
  // MJS ne réécrit jamais ce module, l'écriture qu'il fait sur son paramètre ne prévient personne
  'generator.magasin-vers-module-js': ({ moduleName, ligne, fonction, fichier, magasin, ligneJs }: MsgVars) => `[ModularJS] '${moduleName}.mjs'${ligne ? ` (ligne ${ligne})` : ''} : ${fonction} écrit dans ${magasin}, reçu en argument (ligne ${ligneJs} de '${fichier}'). MJS copie un module .js tel quel, sans jamais le réécrire : cette écriture change la valeur du magasin mais ne redessine rien. Écrivez dans le magasin depuis le composant, ou faites renvoyer la valeur par ${fonction} et écrivez-la dans le composant.`,
  // @__proto__/@constructor/@prototype : nom de MÉTHODE
  // réservé, rejeté AVANT l'analyse (sinon methodReads['__proto__'] retombe sur
  // Object.prototype, TypeError « reads is not iterable » non orienté).
  'analyzer.nom-methode-reserve': ({ name }: MsgVars) => `[ModularJS] @${name} : nom de méthode réservé — « ${name} » appartient au prototype JavaScript, choisissez un autre nom.`,
  // <p> refermé d'office par le navigateur devant un élément de flow
  // content (div, section, table…) : le chemin calculé au build visait un enfant
  // qui n'existe jamais dans l'arbre réel (CRASH au montage). Refusé à la compilation.
  'generator.p-contenu-interdit': ({ tag, ligne }: MsgVars) => `[ModularJS] <p> (ligne ${ligne}) : <${tag}> ne peut pas être un enfant d'un <p> — le navigateur referme le <p> tout seul avant d'ouvrir <${tag}>, et le chemin calculé au build viserait alors un enfant qui n'existe plus. Refermez le <p> avant <${tag}>, ou utilisez un élément inline à la place (span, a, em…).`,
  'generator.template-dynamique': ({ ligne }: MsgVars) => `[ModularJS] <template> (ligne ${ligne}) : une valeur {…}, un bloc ou un gestionnaire ne peut pas être placé dans un <template> — le navigateur range son contenu à part (template.content), hors de la page, et le composant ne pourrait jamais l'atteindre. Sortez la partie dynamique du <template>, ou affichez-la dans un sous-composant.`,
  'generator.hors-tableau': ({ tag, parent, ligne }: MsgVars) => `[ModularJS] <${tag}> (ligne ${ligne}) ne peut pas être placé directement dans un <${parent}> — le navigateur le retire du tableau et le pose avant lui, et le chemin calculé au build viserait alors un nœud qui n'est pas là. Placez-le dans une cellule <td>, ou hors du <table>.`,
  'generator.hors-tableau-form': ({ parent, ligne }: MsgVars) => `[ModularJS] <form> (ligne ${ligne}) ne peut pas être placé directement dans un <${parent}> — le navigateur y laisse un <form> vide, refermé sur place, et sort son contenu du formulaire (les rangées restent dans le tableau, le reste passe avant lui) : le chemin calculé au build viserait alors un nœud qui n'est pas là. Placez le <form> autour du <table>, ou dans une cellule <td>.`,
  'generator.texte-hors-tableau': ({ parent, ligne }: MsgVars) => `[ModularJS] du texte (ligne ${ligne}) ne peut pas être placé directement dans un <${parent}> — le navigateur le retire du tableau et le pose avant lui, et le chemin calculé au build viserait alors un nœud qui n'est pas là. Placez-le dans une cellule <td>, ou hors du <table>.`,
  'generator.imbrication-refusee': ({ tag, ligne }: MsgVars) => `[ModularJS] <${tag}> (ligne ${ligne}) : un <${tag}> ne peut pas être placé dans un autre <${tag}> — selon le cas, le navigateur referme le premier, ignore le second ou en déplace le contenu, et le chemin calculé au build viserait alors un nœud qui n'est pas là. Refermez le premier <${tag}> avant d'ouvrir le suivant.`,
  // {await} imbriqué dans {for} dégradait en silence en un placeholder
  // visible des utilisateurs finaux, sans la moindre erreur de compilation.
  'generator.await-imbrique-dans-await': ({ ligne }: MsgVars) => `[ModularJS] {await} (ligne ${ligne}) : un {await} imbriqué dans la branche d'un autre {await} n'est pas supporté, même au fond d'un {if} ou d'un {key} de cette branche — déplacez-le dans un sous-composant que cette branche affiche (<@nom-du-composant>) : ce composant porte alors son propre {await}.`,
  'generator.await-imbrique-interdit': ({ ligne }: MsgVars) =>`[ModularJS] {await} (ligne ${ligne}) : un {await} imbriqué dans un {for} n'est pas supporté — sortez-le du {for} (un {await} imbriqué dans un {if} à la racine reste permis).`,
  // guillemet d'attribut resté ouvert jusqu'à la fin du gabarit : le tag
  // fautif ET tout ce qui le suit disparaissaient du fragment généré, sans erreur.
  'generator.attribut-guillemet-non-ferme': ({ tag }: MsgVars) => `[ModularJS] <${tag}> : un guillemet resté ouvert dans un attribut n'est jamais refermé avant la fin du HTML du composant — vérifiez les guillemets/apostrophes de ses attributs.`,
  'transpiler.derived-await-interdit': ({ varName }: MsgVars) => `[ModularJS] « µderived $${varName} = … » : un dérivé µderived est synchrone — pour une valeur asynchrone, écrivez un µeffect qui attend puis écrit une variable d'état.`,

  // ═══ Types et valeurs permises (transpiler/var-types.ts) ═════════════════════════════════
  'types.regle-invalide': ({ bloc, ligne, texte, detail }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : « ${texte} » — ${detail}`,
  'types.detail-chaine-non-fermee': ({ texte }: MsgVars) => `le texte ${texte} n'a pas de guillemet de fin — refermez-le.`,
  'types.detail-forme-non-fermee': ({ texte }: MsgVars) => `la forme ${texte} n'a pas de / de fin — refermez-la.`,
  'types.detail-forme-drapeau': ({ texte, drapeau }: MsgVars) => `le drapeau ${drapeau} de ${texte} ferait changer le résultat d'un test à l'autre — retirez-le.`,
  'types.detail-forme-invalide': ({ texte, erreur }: MsgVars) => `la forme ${texte} est invalide (${erreur}).`,
  'types.detail-forme-vide': ({ texte }: MsgVars) => `la forme ${texte} est vide : elle ne contraint rien — écrivez-la entre les deux /, ou retirez-la (un commentaire commence par #).`,
  'types.detail-caractere': ({ car }: MsgVars) => `caractère « ${car} » inattendu.`,
  'types.detail-fin': ({ attendu }: MsgVars) => `la règle s'arrête trop tôt — il manque « ${attendu} ».`,
  'types.detail-jeton': ({ jeton, attendu }: MsgVars) => `« ${jeton} » inattendu — attendu « ${attendu} ».`,
  'types.detail-jeton-seul': ({ jeton }: MsgVars) => `« ${jeton} » inattendu ici.`,
  'types.detail-interdits-conteneur': `des valeurs interdites s'appliquent à une valeur simple, pas à une liste ni à un objet — posez-les sur ses éléments ou ses champs (une règle nommée aide : Nick  string ! 'admin', puis Nick[]).`,
  'types.detail-interdits-vides': `rien après le « ! » — écrivez les valeurs interdites, séparées par | (ex. ! 'admin' | 'root').`,
  'types.detail-interdit-invalide': ({ jeton }: MsgVars) => `« ${jeton} » ne peut pas être interdit — une valeur interdite est un texte, un nombre, true, false, null, ou une plage de nombres (40..60).`,
  'types.detail-plage-vide': `une plage a au moins une borne (0..10, 0.. ou ..10).`,
  'types.detail-bornes-inversees': ({ plage }: MsgVars) => `bornes inversées (${plage}) — la plus petite d'abord.`,
  'types.detail-plage-sans-type': ({ plage }: MsgVars) => `une plage de nombres dit ce qu'elle accepte : int ${plage} (entier) ou float ${plage} (nombre à virgule).`,
  'types.detail-plage-hors-nombre': ({ type }: MsgVars) => `pas de plage sur un ${type}.`,
  'types.detail-plage-regle-nommee': ({ nom }: MsgVars) => `« ${nom} » ne prend pas de plage : une règle nommée porte la sienne dans sa définition (fichier *.types.mjs) — ou « ${nom} » est un type mal écrit (int, float, string, bool, any).`,
  'types.detail-fin-regle': `la règle est vide.`,
  'types.detail-forme-hors-string': ({ texte }: MsgVars) => `une forme ${texte} ne s'applique qu'à un string.`,
  'types.detail-deux-plages': `deux plages pour la même valeur — gardez-en une.`,
  'types.detail-bornes-entieres': `un int a des bornes entières.`,
  'types.detail-longueur': `une longueur (d'un texte ou d'une liste) a des bornes entières, positives ou nulles.`,
  'types.detail-deux-formes': `deux formes /…/ pour le même texte — gardez-en une.`,
  'types.detail-accolade': `accolade jamais refermée — ajoutez le } de fin.`,
  'types.detail-cle': ({ jeton }: MsgVars) => `« ${jeton} » n'est pas un nom de champ.`,
  'types.detail-cle-double': ({ cle }: MsgVars) => `le champ « ${cle} » apparaît deux fois.`,
  'types.detail-cle-reservee': ({ cle }: MsgVars) => `« ${cle} » ne peut pas être un nom de champ.`,
  'types.ligne-invalide': ({ bloc, ligne, texte }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : « ${texte} » — une ligne commence par un nom, puis sa règle.`,
  'types.regle-nommee-dans-vars': ({ ligne, nom }: MsgVars) => `[ModularJS] <vars>, ligne ${ligne} : « ${nom} » — une règle nommée se déclare dans un fichier *.types.mjs, valable dans toute l'appli ; <vars> déclare les variables du composant ($nom) et les stores ($$nom).`,
  'types.deux-points': ({ bloc, ligne, nom, regle }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : pas de deux-points après le nom — écrivez \`${nom}  ${regle}\`.`,
  'types.regle-manquante': ({ bloc, ligne, nom }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : « ${nom} » sans règle — écrivez sa règle après le nom (ex. ${nom}  int 0..100).`,
  'types.double': ({ bloc, ligne, nom }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : « ${nom} » est déjà déclaré plus haut dans le bloc.`,
  'types.variable-dans-types': ({ ligne, nom }: MsgVars) => `[ModularJS] <types>, ligne ${ligne} : « ${nom} » — une variable se déclare dans le <vars> de son composant ; un fichier *.types.mjs ne contient que des règles nommées (ex. Percent  int 0..100).`,
  'types.mot-reserve': ({ ligne, nom }: MsgVars) => `[ModularJS] <types>, ligne ${ligne} : « ${nom} » est un mot de la grammaire — choisissez un autre nom.`,
  'types.regle-inconnue-suggestion': ({ bloc, ligne, nom, suggestion }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : règle « ${nom} » inconnue — vouliez-vous dire « ${suggestion} » ? Les règles nommées se déclarent dans un fichier *.types.mjs.`,
  'types.regle-inconnue': ({ bloc, ligne, nom }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : règle « ${nom} » inconnue — déclarez-la dans un fichier *.types.mjs (ex. ${nom}  int 0..100).`,
  'types.regle-boucle': ({ bloc, ligne, chaine }: MsgVars) => `[ModularJS] ${bloc}, ligne ${ligne} : ces règles nommées tournent en rond (${chaine}).`,
  'types.ressort': ({ nom, rune, signature, ligne }: MsgVars) => `[ModularJS] <vars> : « ${nom} » reçoit un ${rune} ligne ${ligne} — une valeur animée a déjà ses propres bornes : ${signature}. Retirez ${nom} du <vars>.`,
  'effets.inconnu': ({ nom, liste }: MsgVars) => `[ModularJS] *${nom} : effet inconnu — effets disponibles : ${liste}.`,
  'effets.alias-inconnu': ({ nom, effet, liste }: MsgVars) => `[ModularJS] *${nom} : aucun alias de ce nom pour *${effet} — alias connus : ${liste}. Déclarez-le dans un fichier *.effects.mjs : *${nom} = *${effet}(réglages).`,
  'effets.alias-nom': ({ nom, liste, exemple }: MsgVars) => `[ModularJS] *${nom} : le nom d'un alias s'écrit en minuscules, chiffres et _ seulement, et commence par une lettre (${exemple}) — alias connus : ${liste}.`,
  'effets.retire': ({ nom, liste }: MsgVars) => `[ModularJS] *${nom} : effet inconnu — il a été retiré de la bibliothèque ; effets disponibles : ${liste}.`,
  'effets.remplace': ({ nom, effet, reglages }: MsgVars) => `[ModularJS] *${nom} n'existe plus : il fait désormais partie d'un autre effet — écrivez ${effet}, qui donne le même rendu${reglages}.`,
  'effets.remplace-reglages': ({ nom, effet, reglages }: MsgVars) => `[ModularJS] *${nom} n'existe plus : il fait désormais partie d'un autre effet — écrivez ${effet}, où vos réglages sont traduits${reglages}.`,
  'effets.remplace-correspondance': ({ liste }: MsgVars) => ` (correspondance des réglages : ${liste})`,
  'effets.remplace-sans-equivalent': ({ alias, liste }: MsgVars) => ` Sans équivalent direct dans ${alias}, à reporter d'après la correspondance ou à retirer : ${liste}.`,
  'effets.pseudo-partage': ({ balise, liste }: MsgVars) => `<${balise}> : deux effets dessinent dans le même pseudo-élément — ${liste} ; un seul apparaîtra. Posez l'un d'eux sur une balise qui englobe celle-ci.`,
  'effets.hauteur-sans-effet': ({ balise, nom, valeur }: MsgVars) => `<${balise}> *${nom} : height = ${valeur} — une hauteur nulle ou négative ne donne rien à la silhouette ; écrivez une longueur positive (120, 8rem, 100%), ou retirez height : la silhouette prend alors la hauteur de ses barres.`,
  'effets.remplace-ramene': ({ alias, liste }: MsgVars) => ` Valeur hors de la plage de ${alias}, ramenée à sa borne dans l'écriture proposée : ${liste}.`,
  'effets.alias-retire': ({ nom, effet, ecriture }: MsgVars) => `[ModularJS] *${nom} : aucun alias de ce nom pour *${effet} — il a été retiré de la bibliothèque : écrivez à la place ${ecriture}.`,
  'effets.valeur-retiree': ({ nom, reglage, valeur, nouveau, note, regle }: MsgVars) => `[ModularJS] *${nom} : ${reglage} = ${valeur} n'existe plus — écrivez ${reglage}: ${nouveau}${note} ; permis : ${regle}.`,
  'effets.valeur-meme-dessin': ' (le même dessin)',
  'effets.valeur-mesh-aurora': ' (la palette aurora s\'appelle maintenant boreal ; *mesh.aurora est l\'ancien effet *aurora, pas cette palette)',
  'effets.valeur-attention-flash': ' (le clignotement s\'appelle maintenant blink, pour ne pas le confondre avec l\'effet *flash)',
  'effets.suggestion': ({ nom }: MsgVars) => ` Vouliez-vous dire *${nom} ?`,
  'effets.reglage-inconnu': ({ nom, reglage, liste }: MsgVars) => `[ModularJS] *${nom} : réglage « ${reglage} » inconnu — réglages de *${nom} : ${liste}.`,
  'effets.reglage-renomme': ({ reglage, nouveau }: MsgVars) => ` « ${reglage} » a été remplacé — à la place : ${nouveau}.`,
  'effets.valeur': ({ nom, reglage, valeur, regle }: MsgVars) => `[ModularJS] *${nom} : ${reglage} = ${valeur} — permis : ${regle}.`,
  'effets.positionnel': ({ nom, principal }: MsgVars) => `[ModularJS] *${nom} : une seule valeur sans nom est permise (elle règle « ${principal} ») ; nommez les autres : *${nom}(valeur, réglage: valeur).`,
  'effets.double': ({ nom, reglage }: MsgVars) => `[ModularJS] *${nom} : « ${reglage} » est écrit deux fois.`,
  'effets.valeur-calculee': ({ nom, reglage }: MsgVars) => `[ModularJS] *${nom} : ${reglage} — pas d'accolades entre les parenthèses : écrivez la valeur, ou la variable telle quelle (*${nom}(${reglage}: $x)).`,
  'effets.image-longue': ({ nom, reglage, longueur }: MsgVars) => `[ModularJS] *${nom} : ${reglage} — une image tient en 2000 caractères au plus, celle-ci en compte ${longueur} : rangez le fichier dans le dossier source et écrivez son chemin ('photo.png'), ou donnez son adresse complète (https://…).`,
  'effets.image-non-resolue': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom} : ${reglage} — ${valeur} n'a pas été remplacé au build : écrivez le chemin de l'image entre guillemets, ${reglage}: 'chemin.png', avec le fichier dans le dossier source ; µimage('chemin.png', 480, 960) reste possible pour choisir les largeurs des variantes, le chemin aussi entre guillemets.`,
  'effets.variable-seule': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom} : ${reglage} = ${valeur} — une variable s'écrit seule ($x, $$x, $x.champ) ; pour un calcul, passez par une variable dérivée.`,
  'effets.manque': ({ nom, reglage }: MsgVars) => `[ModularJS] *${nom} : la clé manque — *${nom}(${reglage === 'key' ? 'p.id' : reglage}) : c'est elle qui apparie la balise d'une page à celle de l'autre.`,
  'effets.sock-variable': ({ nom, valeur }: MsgVars) => `[ModularJS] *${nom} : sock prend la variable qui tient la connexion — sock: $$sock (un store : la même connexion pour toute l'appli) ou sock: @sock ; reçu ${valeur}. Une autre adresse s'écrit server: 'wss://…'.`,
  'effets.sock-absent': ({ nom, ecriture }: MsgVars) => `[ModularJS] *${nom} prend sa connexion dans @sock, que ce composant ne pose pas : écrivez @sock = µsocket 'wss://…' dans son <script>, ou donnez-la : *${nom}(${ecriture}).`,
  'effets.egal': ({ nom, ligne }: MsgVars) => `[ModularJS] *${nom}=… (ligne ${ligne}) : les réglages d'un effet s'écrivent entre parenthèses — *${nom}(réglage: valeur).`,
  'effets.espace': ({ nom, ligne }: MsgVars) => `[ModularJS] *${nom} (…)${ligne ? ` (ligne ${ligne})` : ''} : les réglages d'un effet se collent à son nom — écrivez *${nom}(…), sans espace avant la parenthèse.`,
  'effets.point-espace': ({ nom, point, exemple, ligne }: MsgVars) => `[ModularJS] *${nom} ${point}${ligne ? ` (ligne ${ligne})` : ''} : un espace sépare « ${point} » de son effet — le nom d'un alias se colle à son effet, sans espace (${exemple}).`,
  'effets.point-reglages': ({ nom, blanc, point, exemple, ligne }: MsgVars) => `[ModularJS] *${nom}(…)${blanc}${point}${ligne ? ` (ligne ${ligne})` : ''} : « ${point} » suit les réglages — le nom d'un alias se place avant eux, collé à son effet : ${exemple}(réglages).`,
  'effets.point-sans-effet': ({ point, ligne }: MsgVars) => `[ModularJS] *${point}${ligne ? ` (ligne ${ligne})` : ''} : il manque le nom de l'effet avant le point — un alias s'écrit *effet.nom (l'effet, un point, puis le nom de l'alias, sans espace).`,
  'effets.commentaire': ({ nom, ligne, commentaire }: MsgVars) => `[ModularJS] *${nom}${ligne ? ` (ligne ${ligne})` : ''} : « ${commentaire} » — un commentaire ne s'écrit pas dans les réglages d'un effet : retirez-le. Si c'est une adresse, mettez-la entre guillemets : image: '//cdn/a.png'.`,
  'effets.balise': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} ne se pose pas sur <${balise}>, qui n'affiche rien elle-même : posez-le sur une balise qui l'entoure.`,
  'effets.svg': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} sur <${balise}> : dans un <svg> ou un <math>, un effet se pose sur la balise <svg> ou <math> elle-même, ou sur une balise qui l'entoure.`,
  'effets.contenu': ({ quoi, balise }: MsgVars) => `[ModularJS] ${quoi} dessine à l'intérieur de sa balise, et <${balise}> n'affiche pas de contenu : posez l'effet sur une balise qui l'entoure.`,
  'effets.texte': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} travaille le texte de sa balise, et <${balise}> n'a pas de texte à elle (une image, un champ, ou un composant qui affiche le sien) : posez l'effet sur une balise de texte — dans le composant, s'il le faut.`,
  'effets.balise-speciale': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} ne se pose pas sur <@${balise}> : un effet se pose sur une balise HTML ou un composant.`,
  'effets.parenthese': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} sur <@${balise}> : la parenthèse de ses réglages n'est jamais refermée — ajoutez le ) de fin.`,
  'effets.guillemet-ouvert': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} sur <@${balise}> : un guillemet double n'est jamais refermé dans ses réglages — ajoutez le " de fin.`,
  'effets.texte-ouvert': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} sur <@${balise}> : un texte entre guillemets n'est jamais refermé dans ses réglages — une apostrophe dans un mot (l'été) en ouvre un. Entourez la valeur de guillemets doubles : *${nom}(réglage: "l'été").`,
  'effets.document': ({ nom, liste }: MsgVars) => `[ModularJS] *${nom} ne se pose pas sur <@document> : seuls les effets de toute la page y vont (${liste}). Posez *${nom} sur une balise HTML ou un composant.`,
  'effets.document-variable': ({ nom }: MsgVars) => `[ModularJS] *${nom} sur <@document> : une valeur fixe seulement — aucune balise du HTML du composant ne suit une variable ici. Écrivez la valeur, ou posez l'effet sur une balise.`,
  'effets.regle-duree': () => `une durée (300ms, 1.5s, 0)`,
  'effets.regle-couleurs': () => `une liste de couleurs ([#f0f, #0ff, gold])`,
  'effets.regle-mots': () => `une liste de mots ([Coder., 'Designer, web.'])`,
  'effets.regle-direction': () => `right, left, up, down, up-right, up-left, down-right, down-left, ou un angle en degrés (0 = vers le haut, 90 = vers la droite, de -360 à 360)`,
  'effets.regle-origine': () => `center, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right, ou « x% y% » (20% 80%)`,
  'effets.regle-origine-pointeur': () => `center, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right, « x% y% » (20% 80%), ou pointer (le point sous la souris)`,
  'effets.regle-courbe': () => `linear, ease, ease-in, ease-out, ease-in-out, cubic-bezier(…), ou une courbe : back, bounce, circ, cubic, elastic, expo, quad, quart, quint, sine, suivie de -in, -out ou -in-out (bounce-out, elastic-out)`,
  'effets.regle-longueur': () => `une longueur : un nombre (en px) ou une valeur CSS (40px, 100%, 2em)`,
  'effets.regle-plage': () => `deux positions de défilement de la page, « début fin », en px ou en vh (0 1000px, 100vh 200vh)`,
  'effets.regle-zone': () => `deux hauteurs de l'écran, « début fin », en % (0 % en haut, 100 % en bas) ou top, center, bottom (70% 40%, bottom center)`,
  'effets.regle-cle': () => `ce qui reconnaît la balise d'une liste à l'autre : une variable (item.id, $choix) ou une valeur`,
  'effets.regle-css': () => `une valeur CSS (#0ff, 12px, 0 0 20px red), sans ; ni accolades`,
  'effets.regle-image': () => `une image : son adresse, µasset('…') ou µimage('…'), ou le chemin d'un fichier du dossier source ou d'un dossier de \`assetDirs\` ('photo.jpg')`,
  'effets.regle-images': () => `une liste d'images : leurs adresses, µasset('…') ou µimage('…'), ou le chemin d'un fichier du dossier source ou d'un dossier de \`assetDirs\` ([a.jpg, 'b.jpg'])`,
  'effets-fichier.retrait': ({ fichier, ligne, texte }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : « ${texte} » — retrait inattendu. Un effet commence au bord du bloc (*nom = … ou *nom(réglages) =), ses lignes CSS en dessous, toutes au même retrait.`,
  'effets-fichier.ligne': ({ fichier, ligne, texte }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : « ${texte} » — attendu : *nom = *effet(réglages) (un effet de la bibliothèque réglé), ou *nom(réglage: défaut) = suivi de ses lignes CSS.`,
  'effets-fichier.double': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} est déjà défini plus haut.`,
  'effets-fichier.alias-reglages': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom}(…) = *… — un effet réglé prend ses réglages à droite : *${nom} = *effet(réglages).`,
  'effets-fichier.alias-corps': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : du CSS sous *${nom}, qui règle un effet de la bibliothèque — pour un effet CSS à vous, écrivez *${nom} = puis ses lignes.`,
  'effets-fichier.vide': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} = … sans rien : écrivez l'effet qu'il règle (*${nom} = *fade(300ms)), ou ses lignes CSS en dessous.`,
  'effets-fichier.reglage': ({ fichier, ligne, nom, reglage }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — réglage « ${reglage} » : écrivez nom: valeur par défaut (color: #0ff, size: 12px), une valeur CSS sans ; ni accolades.`,
  'effets-fichier.reserve': ({ fichier, ligne, nom, reglage, liste }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — « ${reglage} » est un réglage que tout effet a déjà (${liste}) : ne le déclarez pas, écrivez-le à la pose.`,
  'effets-fichier.declaration': ({ fichier, ligne, texte, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — « ${texte} » : une déclaration CSS s'écrit propriété: valeur, sur une ligne, sans ; ni accolades.`,
  'effets-fichier.inconnu': ({ fichier, ligne, nom, reglage, liste }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — $${reglage} n'est pas un réglage de l'effet (réglages : ${liste}). Déclarez-le entre les parenthèses : *${nom}(${reglage}: valeur) =.`,
  'effets-fichier.images-cles': ({ fichier, ligne, texte, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — « ${texte} » : sous @keyframes, une étape (from, to, 50%) puis ses déclarations, plus en retrait.`,
  'effets-fichier.nom-pris': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} est déjà un effet de la bibliothèque — choisissez un autre nom.`,
  'effets-fichier.nom-double': ({ nom, fichier1, fichier2 }: MsgVars) => `[ModularJS] *${nom} est défini deux fois : dans ${fichier1} et dans ${fichier2}. Un nom par appli.`,
  'effets-fichier.boucle': ({ fichier, ligne, chaine }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : des effets qui se règlent en rond — ${chaine}.`,
  'effets-fichier.variable': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — une valeur fixe seulement : le fichier vaut pour toute l'appli, aucune variable n'y est suivie. Passez la variable à la pose : *${nom}(réglage: $x).`,
  'effets-fichier.cible-inconnue': ({ fichier, ligne, nom, cible, suggestion }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} = *${cible} — *${cible} n'est ni un effet de la bibliothèque, ni un effet de l'appli${suggestion}.`,
  'effets-fichier.alias-nom': ({ fichier, ligne, effet, alias, exemple }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${effet}.${alias} — le nom d'un alias s'écrit en minuscules, chiffres et _ seulement, et commence par une lettre (${exemple}).`,
  'effets-fichier.alias-cible': ({ fichier, ligne, effet, alias }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${effet}.${alias} — un alias se rattache à son effet : écrivez *${effet}.${alias} = *${effet}(réglages), *${effet} étant un effet de la bibliothèque.`,
  'effets-fichier.alias-fondu': ({ fichier, ligne, effet, alias, nouveau, ecriture }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${effet}.${alias} — *${effet} n'existe plus : il fait désormais partie de *${nouveau} ; écrivez ${ecriture}.`,
  'effets-fichier.alias-remplace': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} remplace l'alias du même nom que ModularJS livre.`,
  'effets-fichier.commentaire': ({ fichier, ligne, nom, commentaire }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — « ${commentaire} » : un commentaire ne s'écrit pas dans les réglages d'un effet : retirez-le. Si c'est une adresse, mettez-la entre guillemets : image: '//cdn/a.png'.`,
  'effets-fichier.reglage-faux': ({ fichier, ligne, detail }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : ${detail}`,
  'effets-fichier.non-ferme': ({ fichier, ligne, texte, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — « ${texte} » : un guillemet ou une parenthèse reste ouvert (ou un antislash finit la valeur) ; dans la feuille de l'effet, il avalerait la suite. Refermez-le.`,
  'effets-fichier.nom-js': ({ fichier, ligne, nom }: MsgVars) => `[ModularJS] ${fichier} (ligne ${ligne}) : « ${nom} » — ce nom est déjà pris par JavaScript (constructor, toString, valueOf…) : choisissez-en un autre.`,
  'bundler.effets-fichier-sans-bloc': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} : un fichier *.effects.mjs contient un bloc <effects>…</effects>.`,
  'bundler.effets-fichier-multi': ({ fichier }: MsgVars) => `[ModularJS] ${fichier} : un seul bloc <effects> par fichier.`,
  'bundler.effets-fichier-impur': ({ fichier, quoi }: MsgVars) => `[ModularJS] ${fichier} : un fichier *.effects.mjs ne contient que son bloc <effects> — ${quoi} n'y a pas sa place.`,
  'transitions.cycle-seul': ({ nom }: MsgVars) => `[ModularJS] *${nom} relie une balise qui sort à celle qui entre : il se pose sur son cycle de vie, @transition=*${nom}(key: …) (ou @in, @out), pas directement sur la balise.`,
  'transitions.declencheur': ({ nom, reglage, directive }: MsgVars) => `[ModularJS] ${directive}=*${nom} : « ${reglage} » n'a pas de sens ici — c'est ${directive} qui déclenche l'effet (l'entrée ou la sortie de la balise). Retirez-le, ou posez l'effet directement : *${nom}(${reglage}: …).`,
  'transitions.declencheur-alias': ({ nom, reglage, valeur, directive }: MsgVars) => `[ModularJS] ${directive}=*${nom} : l'alias *${nom} porte un déclencheur (${reglage}: ${valeur}) — il ne s'emploie donc pas après ${directive}=, c'est ${directive} qui déclenche l'effet. Posez-le directement sur la balise : *${nom}, ou déclarez un alias sans ${reglage} dans un fichier *.effects.mjs.`,
  'transitions.continu': ({ nom, directive }: MsgVars) => `[ModularJS] ${directive}=*${nom} : *${nom} est un effet continu (ou à état), il ne se joue pas une fois à l'entrée ou à la sortie d'une balise. Posez-le directement sur elle : *${nom}.`,
  'transitions.ancienne': ({ ecrite, directive, nom, reglage, modificateurs }: MsgVars) => `[ModularJS] ${ecrite} : une transition est un effet — écrivez ${directive}=*${nom}, ses réglages entre parenthèses (${directive}=*${nom}(${reglage}))${modificateurs ? '' : ` ; les modificateurs restent sur la directive (${directive}.global=*${nom})`}.`,
  'transitions.ancienne-reglee': ({ ecrite, ecriture, notes, directive, nom, modificateurs }: MsgVars) => `[ModularJS] ${ecrite} : une transition est un effet — écrivez ${ecriture}${notes}${modificateurs ? '' : ` ; les modificateurs restent sur la directive (${directive}.global=*${nom})`}.`,
  // toutes celles d'un composant, une ligne chacune
  'transitions.anciennes': ({ nb, lignes }: MsgVars) => `[ModularJS] ${nb} transitions de ce composant s'écrivent en effets, leurs réglages entre parenthèses — écrivez :${lignes}`,
  'transitions.ancienne-ligne': ({ ligne, ecrite, ecriture, notes }: MsgVars) => `\n  ${ligne ? `ligne ${ligne} : ` : ''}${ecrite} → ${ecriture}${notes}`,
  'transitions.ancienne-retiree': ({ nom }: MsgVars) => ` ; ${nom} n'existe plus`,
  'transitions.ancienne-calcul': ({ reglage, calcul, variable }: MsgVars) => ` ; ${reglage} se calcule (${calcul}) : un effet prend une valeur fixe ou une variable écrite telle quelle — posez ${variable} = ${calcul} dans le <script>`,
  'transitions.ancienne-objet': ({ calcul, exemple }: MsgVars) => ` ; ses réglages se calculent (${calcul}) : un effet prend une valeur fixe ou une variable écrite telle quelle, réglage par réglage (${exemple})`,
  'transitions.ancienne-xy': ({ x, y }: MsgVars) => ` ; x et y se calculent (${x}, ${y}) : écrivez une direction (un mot comme up-left, ou un angle) et une distance, fixes ou dans des variables $…`,
  'transitions.ancienne-sans': ({ reglages, nb }: MsgVars) => ` ; ${reglages} : aucun équivalent, ${Number(nb) > 1 ? 'retirés' : 'retiré'}`,
  'transitions.retiree': ({ ecrite, directive, effet, notes }: MsgVars) => `[ModularJS] ${ecrite} : cette animation n'existe plus — écrivez ${directive}=${effet}${notes ?? ''}.`,
  'transitions.attend-effet': ({ directive }: MsgVars) => `[ModularJS] ${directive} attend un effet : ${directive}=*fade, ${directive}=*fly(up, distance: 40px).`,
  'transitions.guillemets': ({ directive, effet }: MsgVars) => `[ModularJS] ${directive}="${effet}" : un effet s'écrit sans guillemets — ${directive}=${effet}.`,
  'transitions.modificateur': ({ directive, mod }: MsgVars) => `[ModularJS] ${directive}.${mod} : modificateur inconnu — une transition n'en connaît que deux, .global et .shared (${directive}.global=*fade).`,
  'transitions.maison-positionnel': ({ nom }: MsgVars) => `[ModularJS] *${nom} : une transition créée par µanim.create n'a pas de réglage principal — nommez chaque réglage (*${nom}(duration: 400ms)).`,
  'transitions.maison-valeur': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom} : ${reglage} = ${valeur} — une valeur fixe (400ms, 12, right, 'texte', [a, b]) ou une variable ($x, item.id) ; pas de calcul entre les parenthèses.`,
  'effets.regle-effet': () => `un effet qui se joue une fois (*scramble, *fly(up), *count…), ou none`,
  'effets.regle-connexion': () => `la variable qui tient une connexion µsocket ($$sock, @sock)`,
  'effets.fx-effet': ({ nom, reglage, valeur }: MsgVars) => `[ModularJS] *${nom} : ${reglage} = ${valeur} — ${reglage} attend un effet, écrit avec son étoile : ${reglage}: *scramble, ${reglage}: *fly(up) ; ou none.`,
  'effets.fx-une-fois': ({ nom, reglage, effet }: MsgVars) => `[ModularJS] *${nom} : ${reglage}: *${effet} — *${effet} ne se joue pas une fois (c'est un effet continu, ou à état) : ${reglage} prend une transition (*fade, *fly…) ou un effet qui se joue (*scramble, *stagger, *count…).`,
  'effets.fx-variable': ({ nom, reglage, effet }: MsgVars) => `[ModularJS] *${nom} : ${reglage} = ${effet} — l'effet donné à ${reglage} s'écrit en entier, en valeurs fixes (${reglage}: *scramble(20)) ; pas de variable.`,
  'effets.champ': ({ nom, balise }: MsgVars) => `[ModularJS] *${nom} se pose sur un champ (<input>, <textarea>, <select>), pas sur <${balise}>.`,
  'effets.regle-couleur': () => `une couleur CSS`,

} satisfies Record<string, MsgEntry>
