// Messages du framework écrits dans la console du navigateur (avertissements, erreurs levées) :
// ils sortent de la table `err` (et `dev` pour les builds de développement) dans la langue de la
// page, le français affiché ne change pas d'un caractère, l'anglais ne contient aucun mot français,
// un site peut corriger un message par `mjs.err.<clé>`, et l'assistant ne plante jamais — table
// absente, clé inconnue, variable absente.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME_DIR = join(__dirname, '../src/runtime')
const ANIMATIONS_DIR = join(__dirname, '../src/runtime/animations')
const CORE_MODULES_DIR = join(__dirname, '../src/core-modules')

// [clé, variables, texte français d'origine (relevé avant le déplacement), préfixe [ModularJS] ou non]
const REFERENCE: Array<[string, Record<string, string>, string, boolean]> = [
  ['vtMalformed', { name: 'a:b', namePart: 'a' }, '[ModularJS] @viewTransition : valeur malformée \'a:b\' — repli sur \'a\'.', true],
  ['vtDirName', { namePart: 'a', base: 'a' }, '[ModularJS] @viewTransition : la direction ne s\'écrit plus dans le nom (\'a\') — repli sur \'a\', posez \'dir\'/\'direction\' en option.', true],
  ['vtOptMalformed', { pair: 'x', name: 'a:b' }, '[ModularJS] @viewTransition : option malformée \'x\' dans \'a:b\' — ignorée.', true],
  ['vtUnknownKey', { rawKey: 'k', name: 'a:b', keys: 'dir/d, dur/u' }, '[ModularJS] @viewTransition : clé inconnue \'k\' dans \'a:b\' — ignorée (clés valides : dir/d, dur/u).', true],
  ['vtDupKey', { key: 'dir', name: 'a:b', short: 'd' }, '[ModularJS] @viewTransition : clé \'dir\' en double dans \'a:b\' (\'dir\'/\'d\' désignent la même option) — 2e occurrence ignorée.', true],
  ['vtBadDir', { val: 'v', name: 'a:b' }, '[ModularJS] @viewTransition : direction invalide \'v\' dans \'a:b\' — ignorée.', true],
  ['vtBadDur', { val: 'v', name: 'a:b' }, '[ModularJS] @viewTransition : duration invalide \'v\' dans \'a:b\' — un nombre nu en millisecondes (comme setTimeout), ex. dur: 600 — ignorée.', true],
  ['vtBadPrio', { val: 'v', name: 'a:b' }, '[ModularJS] @viewTransition : priority invalide \'v\' dans \'a:b\' — ignorée.', true],
  ['vtUnknownPreset', { name: 'a:b', presets: 'p1, p2', curtains: 'c1' }, '[ModularJS] @viewTransition : préréglage inconnu \'a:b\' — valeurs valides : p1, p2, c1 (pour orienter une base directionnelle : l\'option { dir: left }, le suffixe \':left\' a été retiré en v6).', true],
  ['vtLevitation', { msg: 'boom' }, '[ModularJS] couche de lévitation VT abandonnée : boom', true],
  ['vtLevitationIn', { msg: 'boom' }, '[ModularJS] couche de lévitation VT (arrivée) abandonnée : boom', true],
  ['vtSwapThrew', {}, '[ModularJS] @viewTransition : la permutation sous rideau a levé —', true],
  ['modalRead', { where: 'w', reason: 'raison' }, 'la lecture de `w` a échoué : raison.', false],
  ['modalWantsText', { key: 'k', type: 'string' }, '`k` attend du texte, reçu string.', false],
  ['modalNotText', { key: 'k', reason: 'raison' }, '`k` n\'a pas pu être converti en texte : raison.', false],
  ['modalMapKeys', { key: 'k', reason: 'raison' }, '`k` ressemble à une Map mais son `keys()` n\'est pas parcourable : raison.', false],
  ['modalNotIterable', { key: 'k', reason: 'raison' }, '`k` n\'a pas pu être parcouru : raison.', false],
  ['modalGetFailed', { key: 'k', reason: 'raison' }, '`k.get()` a échoué : raison.', false],
  ['modalOptsObject', { type: 'string' }, 'les options doivent être un objet, reçu string.', false],
  ['modalWantsFn', { key: 'k', type: 'string' }, '`k` doit être une fonction, reçu string.', false],
  ['modalIconString', { type: 'string' }, '`icon` doit être une chaîne, reçu string.', false],
  ['modalInputString', { type: 'string' }, '`input` doit être une chaîne, reçu string.', false],
  ['modalInputOptions', { type: 'string' }, '`inputOptions` doit être un objet ou une Map, reçu string.', false],
  ['modalTimer', { got: 'string' }, '`timer` doit être un nombre de millisecondes, reçu string.', false],
  ['modalCustomClass', { type: 'string' }, '`customClass` doit être un objet, reçu string.', false],
  ['modalSoundType', { type: 'string' }, '`sound` doit être un booléen ou une chaîne, reçu string.', false],
  ['modalNoBody', {}, '`document.body` est absent — une modale ne peut pas être affichée à ce moment du chargement.', false],
  ['modalUnknownIcon', { v: 'v', list: 'a, b' }, '[ModularJS] µ.modal.fire — icône inconnue « v », ignorée (attendu : a, b).', true],
  ['modalUnknownInput', { v: 'v', list: 'text, select' }, '[ModularJS] µ.modal.fire — type d\'input inconnu « v », repli sur « text » (attendu : text, select).', true],
  ['modalSoundPath', { path: '/x', reason: 'raison' }, '[ModularJS] µ.sound — chemin « /x » non résoluble, aucun son : raison.', true],
  ['modalSoundUnknown', { type: 't', list: 's1, s2' }, '[ModularJS] µ.sound — type inconnu « t », aucun son (attendu : s1, s2).', true],
  ['modalNotifyPos', { v: 'v' }, '[ModularJS] µ.config.notifyPosition : valeur invalide (« v ») — repli \'top-right\'.', true],
  ['modalNotifyFlow', { v: 'v' }, '[ModularJS] µ.config.notifyFlow : valeur invalide (« v ») — repli \'auto\'.', true],
  ['modalPreConfirm', {}, '[ModularJS] µ.modal : preConfirm en échec —', true],
  ['modalValidator', {}, '[ModularJS] µ.modal : inputValidator en échec —', true],
  ['elProto', {}, '[ModularJS] état : changement de prototype refusé', true],
  ['elCycle', { k: 'x' }, '[ModularJS] Cycle réactif détecté sur \'x\' — retourne undefined', true],
  ['elTeardown', {}, '[ModularJS] @attach/@this teardown en erreur :', true],
  ['elOrphanInherited', { sheetName: 'feuille' }, '[ModularJS] Orphelin CSS hérité : La feuille \'feuille\' est absente du registre.', true],
  ['elOrphanLocal', { sheetName: 'feuille' }, '[ModularJS] Orphelin CSS local : La feuille \'feuille\' est introuvable.', true],
  ['elHydrate', {}, '[ModularJS] hydratation demandée par la page mais absente du cœur : mode ssr:markers/positional/diff dans render, ou runtime: [\'hydrate\'].', true],
  ['elHydrateMismatch', { tag: 'mjs-x' }, '[ModularJS] <mjs-x> : les repères écrits par le serveur ne correspondent pas à ceux du navigateur — ce composant est reconstruit, sans le gain de la reprise. Cause probable : le serveur et le navigateur ont été construits différemment (autre « env », autres pages) ; construisez-les à l\'identique.', true],
  ['elLoop', { tag: 'div' }, '[ModularJS] Boucle réactive détectée sur <div> : plus de 10 000 rendus dans la même rafale de microtasks. Un effet mute probablement sa propre dépendance ($x = $x + … dans un µeffect ?). Effets suspendus pour garder la page vivante.', true],
  ['elStructLoop', { tag: 'div' }, '[ModularJS] <div> : boucle de mutations structurelles détectée (20 passes) — re-render abandonné. Une var pilotant un {for}/{if} est probablement re-mutée par le rendu lui-même.', true],
  ['storeGWatch', {}, '[ModularJS] µ._mjs_storeWatch : callback en erreur.', true],
  ['storeGProtoKey', { k: 'k' }, '[ModularJS] µ.store : clé « k » refusée — elle appartient au prototype JavaScript, choisissez un autre nom.', true],
  ['storeGCycle', { key: 'key' }, '[ModularJS] µ.store : cycle de computed détecté sur « key » — undefined retourné.', true],
  ['storeGKey', { key: 'key' }, '[ModularJS] µ.store : clé refusée (« key ») — mutation ignorée.', true],
  ['storeGTheme', { value: 'v', themes: 'clair, sombre' }, '[ModularJS] µtheme : « v » n\'est pas un thème déclaré — ignorée. Thèmes connus : clair, sombre.', true],
  ['storeGResKey', { k: 'k' }, '[ModularJS] µ.res : clé refusée (« k ») — mutation ignorée.', true],
  ['storeGResTag', {}, '[ModularJS] µres : balise __mjs_res illisible au boot, ignorée.', true],
  ['runesKey', { key: 'k' }, '[ModularJS] µ.state : clé refusée (« k ») — mutation ignorée.', true],
  ['runesCycle', { key: 'k' }, '[ModularJS] µ.state : cycle de computed détecté sur « k » — undefined retourné.', true],
  ['everyInit', {}, '[ModularJS] µevery doit être appelé à l\'initialisation.', true],
  ['everySyntax', {}, '[ModularJS] µevery s\'écrit « µevery 2500, -> » : un délai en millisecondes, puis la fonction à répéter.', true],
  ['everyHash', {}, '[ModularJS] µevery : le 2e argument est un hash d\'options (« µevery 3000, pause: true, -> ») — reçu :', true],
  ['everyOptType', { opt: 'c', type: 'boolean' }, '[ModularJS] µevery : option « c » attendue de type boolean, reçu : ', true],
  ['everyIgnored', {}, '— option ignorée.', false],
  ['everyUnknownOpt', { opt: 'c', list: 'a, b' }, '[ModularJS] µevery : option inconnue « c ». Options reconnues : a, b.', true],
  ['everyTimes', {}, '[ModularJS] µevery : option « times » attendue ≥ 0, reçu :', true],
  ['everyError', {}, '[ModularJS] µevery :', true],
  ['everyWhileAsync', {}, '[ModularJS] µevery : l\'option « while » doit rendre un booléen SYNCHRONE — une fonction async rend une promesse, toujours vraie, et la répétition ne s\'arrêterait jamais. Arrêt.', true],
  ['dynAccept', {}, '[ModularJS] <@element>/<@module> : accept attend une liste de noms (tableau ou chaîne séparée par des espaces)', true],
  ['dynRefused', { norm: 'table' }, '[ModularJS] <@element>/<@module> : balise « table » refusée — un élément dynamique ne peut pas devenir table ; pour l\'autoriser explicitement : accept="table".', true],
  ['dynNotListed', { norm: 'table', list: 'a b' }, '[ModularJS] <@element>/<@module> : balise « table » refusée — hors de la liste accept="a b" ; quand accept est présent, seuls les noms qu\'il liste sont créés.', true],
  ['dynInstance', {}, '[ModularJS] <@module> : impossible d\'instancier le composant. Passez le NOM de tag (chaîne kebab du custom element) plutôt que la classe.', true],
  ['i18nMissing', { key: 'a.b', lang: 'en', def: 'fr' }, '[ModularJS] i18n : clé « a.b » absente en « en », repli sur « fr »', true],
  ['i18nNoData', {}, '[ModularJS] i18n : µ._i18nData jamais reçu, composants i18n en placeholder', true],
  ['i18nLoadSection', { section: 's', lang: 'en', reason: 'boom' }, '[ModularJS] i18n : échec de chargement de « s » (en) — boom', true],
  ['i18nLoadLang', { lang: 'en', url: '/u', reason: 'boom' }, '[ModularJS] i18n : échec de chargement de la langue « en » (/u) — boom', true],
  ['i18nHook', {}, '[ModularJS] i18n : crochet de bascule en erreur :', true],
  ['i18nSecours', { ms: '3000' }, '[ModularJS] i18n : textes toujours absents après 3000 ms — le module paraît avec ⟦clé⟧ à la place de chaque texte absent, les textes les remplaceront à leur arrivée', true],
  ['fxLoad', { name: 'pulse' }, '[ModularJS] effet « pulse » : son fichier ne s\'est pas chargé —', true],
  ['fxApply', { name: 'pulse' }, '[ModularJS] effet « pulse » : sa pose a échoué —', true],
  ['fxRemove', {}, '[ModularJS] retrait d\'effet en erreur :', true],
  ['storeKey', { prop: 'p' }, '[ModularJS] µ.Store : clé refusée (« p ») — mutation ignorée.', true],
  ['storeProto', {}, '[ModularJS] store : changement de prototype refusé', true],
  ['ifReintro', {}, '[ModularJS] Échec re-intro:', true],
  ['ifDestroy', {}, '[ModularJS] destruction de branche {if} en erreur :', true],
  ['ifDestroyNested', {}, '[ModularJS] destruction de branche {if}/{key} imbriquée en erreur :', true],
  ['dev.hotcssLight', { tag: 'my-tag' }, '[ModularJS] _hotCss : replaceSync a échoué pour la feuille légère <my-tag> :', true],
  ['dev.hotcssTag', { tag: 'my-tag' }, '[ModularJS] _hotCss : replaceSync a échoué pour <my-tag> :', true],
  ['dev.hotcssShared', { name: 'shared' }, '[ModularJS] _hotCss : replaceSync a échoué pour la feuille partagée « shared » :', true],
  ['dev.hotcssRoot', {}, '[ModularJS] _hotCss : replaceSync a échoué pour mjs_root :', true],
  ['blendCsp', {}, '[ModularJS] *blend : la politique de sécurité de la page refuse les images data: — le calque garde des coins carrés et un dégradé prend sa première couleur. Ajoutez data: à img-src pour les retrouver.', true],
  ['blendImage', { src: 'a.png' }, '[ModularJS] *blend : l\'image a.png n\'a pas pu être chargée, le calque reste vide.', true],
  ['blendNoSrc', {}, '[ModularJS] *blend : l\'image donnée n\'a pas d\'adresse, l\'effet n\'est pas posé.', true],
  ['fluidNoGl', {}, '[ModularJS] *fluid : ce navigateur ne sait pas faire tourner le fluide (WebGL avec textures demi-flottantes requis), l\'effet n\'est pas posé.', true],
  ['fluidTextComponent', {}, '[ModularJS] *fluid : sur un composant, `where: text` ne s\'applique pas (son texte est dans son intérieur, pas dans la balise) — le fluide est posé en `box` et le texte reste tel quel.', true],
  ['fluidColor', { color: 'var(--x)' }, '[ModularJS] *fluid : la couleur « var(--x) » ne se résout pas (variable absente ou valeur qui n\'est pas une couleur), elle est ignorée.', true],
  ['fluidNoContext', {}, '[ModularJS] *fluid : le navigateur ne donne plus de contexte WebGL à cette balise (il en limite le nombre par page, une quinzaine) — elle reste sans effet et réessaiera à son prochain survol ou quand elle reviendra à l\'écran.', true],
  ['blendFilter', {}, '[ModularJS] *blend : cette balise a déjà un `filter` en CSS, que l\'effet remplace — posez *blend sur une balise qui l\'englobe pour garder les deux.', true],
  ['destroyAttach', {}, '[ModularJS] nettoyage (@attach/@this=!) en erreur :', true],
  ['destroyRef', {}, '[ModularJS] nettoyage (ref) en erreur :', true],
  ['destroyOut', {}, '[ModularJS] transition de sortie en erreur :', true],
  ['ujsConfirmNoModal', {}, '[ModularJS] µ.config.confirm = true mais µ.modal est absent (module \'modal\' non inclus dans `runtime`) — repli sur window.confirm.', true],
  ['ujsConfirmValue', {}, '[ModularJS] µ.config.confirm attend désormais true/false (l\'ancien \'sweetalert2\'/objet n\'existe plus) — repli sur window.confirm.', true],
  ['lifeOnDestroy', {}, '[ModularJS] _mjs_onDestroy : callback en erreur :', true],
  ['lifeHook', {}, '[ModularJS] hook destroy en erreur :', true],
  ['lifeRun', { name: 'sleep' }, '[ModularJS] hook µsleep en erreur :', true],
  ['layoutUnknown', { tag: 'div', name: 'x', known: 'a, b' }, '[ModularJS] <div> : variant de style \'x\' inconnu (connus : a, b).', true],
  ['layoutFile', { tag: 'div', name: 'x', url: '/u', known: 'a, b' }, '[ModularJS] <div> : fichier du variant \'x\' introuvable (/u) — noms connus : a, b.', true],
  ['layoutNone', {}, 'aucune', false],
  ['interpInvalidator', {}, '[ModularJS] µ.interpolate : invalidator en erreur, détaché.', true],
  ['interpNonFinite', { value: 'NaN' }, '[ModularJS] µ.interpolate : valeur non-finie ignorée (NaN)', true],
  ['initReadOnly', { tag: 'my-el', prop: 'p' }, '[ModularJS] <my-el> : propriété « p » en lecture seule, valeur ignorée.', true],
  ['initPath', { seg: '__proto__' }, '[ModularJS] chemin d\'état refusé (segment « __proto__ ») — mutation ignorée.', true],
  ['forDupKeys', { id: 'c1' }, '[ModularJS] {for} : clés dupliquées détectées — seules les 1ères occurrences sont rendues. Vérifiez l\'unicité de la clé `by`. (cacheId: c1)', true],
  ['failedLimit', { limit: '3' }, '[ModularJS] <@failed> : limite de réessai atteinte (3) — abandon.', true],
  ['failedFallback', {}, '[ModularJS] fallback @failed en erreur :', true],
  ['awaitUnhandled', { tag: 'mjs-x' }, '[ModularJS] {await} rejeté dans <mjs-x> sans branche {error} pour l\'afficher — le bloc reste vide. Ajoutez {error err}…{end} pour montrer l\'erreur.', true],
  ['followNoSock', {}, '[ModularJS] *follow n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne suit — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec followPackage côté serveur ; une connexion posée plus tard dans la variable le relance', true],
  ['cursorsNoSock', {}, '[ModularJS] *cursors n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec cursorsPackage côté serveur ; une connexion posée plus tard dans la variable le relance', true],
  ['heatmapNoSock', {}, '[ModularJS] *heatmap n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec heatmapPackage côté serveur ; une connexion posée plus tard dans la variable le relance', true],
  ['reactNoSock', {}, '[ModularJS] *react n\'a pas de connexion MJS WS : la variable de sa scène (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec reactionsPackage côté serveur ; une connexion posée plus tard dans la variable la relance', true],
  ['followNoCore', {}, '[ModularJS] *follow : le module socket manque au cœur (réglage runtime)', true],
  ['cursorsNoCore', {}, '[ModularJS] *cursors : le module socket manque au cœur (réglage runtime)', true],
  ['heatmapNoCore', {}, '[ModularJS] *heatmap : le module socket manque au cœur (réglage runtime)', true],
  ['reactNoCore', {}, '[ModularJS] *react : le module socket manque au cœur (réglage runtime)', true],
  ['heatmapServerHint', {}, ' — pour l\'adresse d\'un serveur, écrivez server: \'{on}\'', false],
  ['heatmapEvent', { name: 'wss://x', hint: ' — pour l\'adresse d\'un serveur, écrivez server: \'wss://x\'' }, '[ModularJS] *heatmap : « wss://x » n\'est pas un nom d\'événement valide (en minuscules : click, mousemove, dblclick…) — pour l\'adresse d\'un serveur, écrivez server: \'wss://x\'', true],
  ['tickerTask', {}, '[ModularJS] Ticker : tâche en erreur, éjectée.', true],
  ['socketPackage', { effet: '*follow', type: 't', paquet: 'followPackage', invoke: 'followPackage()' }, '[ModularJS] *follow : le serveur MJS WS ne connaît pas « t » — il lui manque le paquet followPackage : ajoutez app.use(followPackage()) côté serveur ; en attendant, rien ne part', true],
  ['runesInspectInit', {}, '[ModularJS] µ.inspect doit être appelé à l\'initialisation.', true],
  ['lazyCss', { name: 's', url: '/s.css' }, '[ModularJS] Feuille partagée \'s\' introuvable (/s.css) — le composant s\'affichera sans elle.', true],
  ['keyDestroy', {}, '[ModularJS] destruction de l\'ancienne clé {key} en erreur :', true],
  ['htmlDestroy', {}, '[ModularJS] destruction de contenu {@html} en erreur :', true],
  ['hoverIgnored', { name: 'fade', list: 'once, zone' }, '[ModularJS] *fade : au survol (on: hover), les réglages suivants ne servent à rien : once, zone. Retirez-les.', true],
  ['hoverOfAlone', { name: 'fade' }, '[ModularJS] *fade : le réglage of ne sert qu\'avec on: hover — il est ignoré ici. Retirez-le, ou ajoutez on: hover.', true],
  ['transitionNone', { name: 'fade2' }, '[ModularJS] *fade2 : aucune transition de ce nom — µanim.create \'fade2\' n\'a pas été appelé.', true],
  ['hoverOf', { name: 'fly', of: '.carte' }, '[ModularJS] *fly : aucun ancêtre de la balise ne vérifie « .carte » (réglage of) : son parent direct commande le survol. Vérifiez ce sélecteur.', true],
  ['dev.marqueeKids', { where: ' [<mjs-carte> /c/carte.js]' }, '[ModularJS] *marquee [<mjs-carte> /c/carte.js] : cette balise fait défiler des balises que le compilateur n\'a pas vues dans le gabarit (un script les a ajoutées, le plus souvent). En production, le défilé des balises n\'est envoyé que si une pose de l\'application le demande : celle-ci ne le demande pas, ces balises ne défileront pas à moins qu\'une autre pose ne le fasse envoyer. Écrivez *marquee(unit: child) pour le demander.', true],
  ['dev.filterSpotParent', { parent: '<div.scene>' }, '[ModularJS] *filter : pas de zone nette (spot) sur cette balise — son parent <div.scene> rogne ou défile sans être positionné, et le positionner déplacerait ce qu\'il contient (une balise posée en absolu, ou des décalages top, left… écrits sur lui). Mettez la balise dans un bloc en position: relative, à l\'intérieur de ce parent', true],
  ['dev.hologramImages', { style: 'rainbow' }, '[ModularJS] *hologram : image, mask et back ne servent qu\'aux styles de carte ; avec le style « rainbow », ils sont ignorés et aucune image n\'est chargée', true],
  ['dev.autosizeField', { tag: 'textarea' }, '[ModularJS] *autosize : sur un <textarea>, l\'effet ne fait rien — il fait glisser la taille d\'une boîte quand son contenu change (une balise ajoutée, un bloc qui s\'ouvre, une image qui arrive), et ce qu\'on tape dans un champ n\'en change pas le contenu. Posez *autosize sur la boîte dont le contenu change, par exemple celle qui entoure le champ et ses messages.', true],
  ['dev.crossfadeGroup', { group: 'g1', keys: 'duration' }, '[ModularJS] *crossfade : le groupe « g1 » garde les réglages de sa première pose ; une pose suivante écrit d\'autres valeurs pour duration, qui ne comptent pas. Donnez les mêmes réglages à toutes les poses du groupe, ou placez celle-ci dans un autre groupe (group).', true],
  ['dev.selectOtherScript', {}, '[ModularJS] <@@select> : une liste reçoit « other » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — la réponse libre « Autre » n\'est pas envoyée, ni en développement ni en production. Écrivez « other » sur la liste dans votre page plutôt que de le poser par un script.', true],
  ['dev.editorAnswerScript', {}, '[ModularJS] <@@editor> : un éditeur reçoit « answer » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — le mode « répondre » n\'est pas envoyé, ni en développement ni en production. Écrivez « answer » sur l\'éditeur dans votre page plutôt que de le poser par un script.', true],
  ['dev.toolbarToolScript', { n: 'link' }, '[ModularJS] <@@toolbar> : une barre reçoit l\'outil « link » d\'un script, mais aucune page de l\'application n\'écrit cet outil — il n\'est pas envoyé, ni en développement ni en production. Écrivez « link » dans la liste d\'outils d\'une barre de votre page (l\'attribut toolbar d\'un éditeur, ou tools d\'une barre) plutôt que de le poser par un script.', true],
  ['dev.chartToolbarScript', {}, '[ModularJS] <@@chart> : un graphique reçoit « toolbar » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — la barre d\'outils n\'est pas envoyée, ni en développement ni en production. Écrivez « toolbar » sur le graphique dans votre page plutôt que de le poser par un script.', true],
  ['pathStays', { why: 'raison', tag: ' (<g>)' }, '[ModularJS] *path : raison — la balise ne bouge pas (<g>)', true],
  ['pathMissing', { from: '#p' }, 'le tracé « #p » n\'existe pas dans votre composant (il faut un <path> SVG)', false],
  ['pathUnreadable', { d: 'M0 0' }, 'le tracé « M0 0 » est illisible', false],
  ['travelNone', { to: '#fiche' }, '[ModularJS] *travel : la destination « #fiche » est introuvable, cette étape est sautée — vérifiez le sélecteur, il est cherché dans votre composant puis dans la page', true],
  ['liquidCap', { max: 8 }, '[ModularJS] *liquid : plus de 8 images se déforment en même temps par carreaux (le navigateur limite les contextes WebGL) : les suivantes prennent la déformation lisse. Posez radius : seule l\'image sous la souris se déforme alors.', true],
  ['liquidTag', {}, '[ModularJS] *liquid : cette balise n\'est pas une <img>, elle prend donc la déformation lisse ; posez *liquid sur une <img> pour avoir les carreaux.', true],
  ['liquidCors', {}, '[ModularJS] *liquid : cette image vient d\'un autre site et le navigateur ne la laisse pas lire sans crossorigin, elle prend donc la déformation lisse ; ajoutez crossorigin="anonymous" à la balise <img> (le site de l\'image doit l\'autoriser).', true],
  ['liquidGl', {}, '[ModularJS] *liquid : ce navigateur ne propose pas WebGL, les images prennent donc la déformation lisse ; activez l\'accélération matérielle du navigateur.', true],
  ['liquidFilter', {}, '[ModularJS] *liquid : la balise porte déjà un autre effet à filtre (*filter ou *chromatic) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.', true],
  ['pileOverflow', { tag: 'div' }, '[ModularJS] *pile : <div> a un « overflow » (hidden, auto…) mais ne défile pas : les panneaux ne peuvent plus se coller (position: sticky). Retirez-le, ou remplacez-le par « overflow: clip ».', true],
  ['chromaticFilter', {}, '[ModularJS] *chromatic : la balise porte déjà un autre effet à filtre (*filter ou *liquid) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.', true],
  ['pixelateFilter', {}, '[ModularJS] *pixelate : la balise porte déjà un autre effet à filtre (*filter, *chromatic ou *liquid) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.', true],
  ['gradientImage', { url: 'a.png' }, '[ModularJS] *gradient : l\'image a.png est introuvable, le dégradé la remplace', true],
  ['flipcard', {}, '[ModularJS] *flipcard : la balise doit porter deux enfants — le premier est le recto, le second le verso. Ajoutez-lui le verso.', true],
  ['physicsHeight', {}, '[ModularJS] *physics : la balise n\'a pas de hauteur — rien ne peut tomber. Donnez-lui une hauteur (height ou min-height).', true],
  ['focusHost', { tag: 'mjs-coque' }, '[ModularJS] *focus : le composant <mjs-coque> n\'a aucun enfant glissé — ses enfants vivent dans son gabarit, où *focus ne les atteint pas. Posez *focus dans le gabarit du composant, sur le parent de ses enfants.', true],
  ['spotlightWhere', { word: 'veil' }, '[ModularJS] *spotlight : « veil » est lu comme une couleur, non comme un mode — écrivez *spotlight(where: veil).', true],
  ['effectInit', {}, '[ModularJS] µ.effect doit être appelé à l\'initialisation.', true],
  ['domDefined', { tag: 'x-y' }, '[ModularJS] x-y déjà défini par un autre bundle : cette définition est ignorée', true],
  ['reflectBlur', { tag: 'my-card' }, '[ModularJS] *reflect : sur un composant (<my-card>), blur et water ne sont pas possibles dans votre navigateur — le reflet reste simple', true],
  ['reflectNone', { tag: 'my-card' }, '[ModularJS] *reflect : votre navigateur n\'a ni reflet natif ni -moz-element, et un composant (<my-card>) ne se copie pas — aucun reflet', true],
  ['reflectBlurInside', { tag: 'div', inner: 'my-card' }, '[ModularJS] *reflect : <div> contient un composant (<my-card>), qu\'une copie ferait naître une seconde fois : blur et water ne sont pas possibles dans votre navigateur — le reflet reste simple', true],
  ['behindImage', { url: 'a.png' }, '[ModularJS] *behind : l\'image a.png est introuvable — le sujet détouré n\'apparaît pas', true],
  ['behindEdge', { edge: 'zooom' }, '[ModularJS] *behind : edge = zooom n\'est ni zoom, ni blur, ni une couleur que votre navigateur connaît — le zoom est pris. Vérifiez comment vous l\'avez écrit.', true],
  ['backlightNone', { tag: 'div' }, '[ModularJS] *backlight : la balise <div> n\'a ni image ni image de fond — le halo n\'a rien à copier', true],
  ['scratchBadMany', {}, 'ces couleurs ne sont pas lisibles', false],
  ['scratchBadOne', {}, 'cette couleur n\'est pas lisible', false],
  ['scratchIgnMany', {}, 'elles sont ignorées', false],
  ['scratchIgnOne', {}, 'elle est ignorée', false],
  ['scratchIgnNone', {}, 'la couche prend la couleur de color', false],
  ['scratchColors', { what: 'ces couleurs ne sont pas lisibles', list: 'zz, yy', fate: 'elles sont ignorées' }, '[ModularJS] *scratch : ces couleurs ne sont pas lisibles (zz, yy), elles sont ignorées — donnez une couleur CSS valide dans colors.', true],
  ['scratchImage', { url: 'a.png' }, '[ModularJS] *scratch : l\'image a.png n\'a pas pu être chargée, la couche de couleur la remplace.', true],
  ['scrubTag', { tag: 'div' }, '[ModularJS] *scrub : sans frames ni images, la balise doit être une <video> (c\'est une <div>) — l\'effet n\'est pas posé. Pour une suite d\'images, écrivez frames et count sur un <canvas> ou une <img>.', true],
  ['scrubSeqTag', { tag: 'video' }, '[ModularJS] *scrub : une suite d\'images (frames, images) se pose sur un <canvas> ou une <img>, pas sur une <video> — l\'effet n\'est pas posé.', true],
  ['scrubCount', {}, '[ModularJS] *scrub : frames demande count, le nombre d\'images de la suite — l\'effet n\'est pas posé. Écrivez par exemple *scrub(frames: \'img/seq-###.webp\', count: 120).', true],
  ['scrubHash', {}, '[ModularJS] *scrub : frames doit contenir ### à la place du numéro de l\'image (img/seq-###.webp) — l\'effet n\'est pas posé.', true],
  ['scrubContext', {}, '[ModularJS] *scrub : ce <canvas> porte déjà un autre contexte que 2d — l\'effet n\'est pas posé.', true],
  ['dev.propOneWay', { tag: 'mjs-fenetre', prop: 'dialog' }, '[ModularJS] <mjs-fenetre> écrit sa prop « dialog » : cette valeur vient du parent ; liez-la par !{…} ou envoyez un événement. Le parent garde sa propre valeur, il ne voit pas ce changement.', true],
  ['dev.attachNotFn', { tag: 'mjs-menu', node: 'div', line: 12, type: 'number' }, '[ModularJS] <mjs-menu> : l\'@attach de <div> (ligne 12) a rendu une valeur de type number, pas une fonction : elle est ignorée. Rendez une fonction de nettoyage, appelée quand la balise disparaît, ou rien.', true],
  ['dev.inspectArmed', {}, '[ModularJS] inspecteur d\'objets armé — µconsole(valeur), ou depuis le panneau (Ctrl+Shift+Espace)', true],
  ['dev.panelArmed', {}, '[ModularJS] panneau d\'inspection armé — Ctrl+Shift+Espace, ou µconsole', true],
  ['ujsSubmitFailed', { status: 'status1' }, 'Submit en échec (statut status1) — aucune page de repli HTML complète dans la réponse.', false],
  ['ujsSubmitNotHtml', {}, 'Réponse du submit non reconnue comme une page HTML complète (attendu : une chaîne contenant "<html") — aucun contenu mis à jour. Pour gérer vous-même une réponse non-HTML, posez @noUJS sur le <form>.', false],
  ['ujsSubmitNoBody', {}, 'Réponse HTML du submit reçue, mais aucun <body> exploitable (page courante ou réponse serveur) — aucun contenu mis à jour.', false],
  ['ujsMethodDialog', {}, '_method=dialog n\'a pas de sens : dialog est un attribut method/formmethod, pas un verbe HTTP', false],
  ['ujsVerbUnknown', { verb: 'verb1' }, 'mjs-method="verb1" : verbe HTTP non reconnu (get/delete/post/put/patch attendus) — navigation normale.', false],
  ['ujsConfirmRetryFailed', { e: 'e1' }, '@confirm : relance de requestSubmit() nu a ÉGALEMENT échoué, formulaire non soumis — e1', false],
  ['ujsConfirmRetry', { tag: 'tag1', reqErr: 'reqErr1' }, '@confirm : requestSubmit(tag1) a échoué après acceptation, repli sur requestSubmit() nu — reqErr1', false],
  ['ujsNoAjax', {}, 'navigation ujs : module runtime \'ajax\' absent (µ._mjs_ajaxRequest introuvable).', false],
  ['ujsHardNavOutside', { dest: 'dest1' }, 'navigation abandonnée, url hors origine et protocole non http/https : dest1', false],
  ['ujsCallbackMissing', { nom: 'nom1', tag: 'tag1' }, '@callback="nom1" : aucune méthode « nom1 » trouvée sur tag1 ni ses ancêtres — rappel ignoré.', false],
  ['ujsFlashNoModal', {}, 'flash/error à afficher mais µ.modal est absent (module \'modal\' non inclus dans `runtime`) — repli console/alert.', false],
  ['ujsFlashUnknown', { attr: 'attr1' }, 'mjs-flash="attr1" : valeur non reconnue (popup/console/silent attendus) — politique globale utilisée.', false],
  ['ujsTargetMissingReceived', { target: 'target1' }, 'cible de navigation \'target1\' introuvable dans la page reçue — contenu de <body> remplacé (des deux côtés).', false],
  ['ujsReplaceNoTarget', {}, 'method \'replace\' sans target : <body> n\'est jamais remplacé — contenu remplacé à la place.', false],
  ['ujsPermanentDupId', { id: 'id1' }, '[mjs-permanent] id \'id1\' porté par PLUSIEURS éléments — un seul peut traverser la navigation, les autres partent avec la page quittée. Un id doit être unique dans le document.', false],
  ['ujsPermanentNoId', {}, '[mjs-permanent] sans id ignoré — un appariement entre deux navigations exige un id stable sur cet élément.', false],
  ['ujsScriptSwapped', { sig: 'sig1' }, '<script> détecté dans le contenu échangé : le navigateur ne ré-exécute JAMAIS un <script> injecté (règle du DOM) — ce code ne tournera pas. Déplacez-le dans un composant MJS (µmount), ou posez @noUJS sur les liens qui mènent à cette page. Script : sig1', false],
  ['ujsMethodNoUjs', { method: 'method1' }, '@method="method1" ignoré — @noUJS rend la navigation native, et le navigateur ne sait faire qu\'un GET sur un lien. Retirez l\'un des deux.', false],
  ['ujsMethodNative', { method: 'method1' }, '@method="method1" : lien non suivi — vers une autre origine, avec une touche Ctrl, Maj, Alt ou Cmd, au clic du milieu, avec `target` ou `download`, le navigateur le suivrait lui-même, en GET, sans le verbe. Seul un clic simple sur un lien de la même origine, sans `target` ni `download`, envoie la requête.', false],
  ['ujsUnknownCache', { raw: 'raw1' }, 'cache \'raw1\' inconnu dans la fiche de navigation — \'cache-first\' appliqué.', false],
  ['ujsUnknownMethod', { raw: 'raw1' }, 'method \'raw1\' inconnu dans la fiche de navigation — \'update\' appliqué.', false],
  ['ujsTargetMissing', { target: 'target1' }, 'cible de navigation \'target1\' introuvable dans la page — contenu de <body> remplacé.', false],
  ['ujsHardNavProtocol', { destination: 'destination1' }, 'navigation dure refusée, protocole non http/https : destination1', false],
  ['schemaDefsInvalid', {}, 'définitions µ:schema invalides, registre local INCHANGÉ', false],
  ['schemaDecodeFailed', {}, 'décodage en échec (trame corrompue ?)', false],
  ['schemaUnknownIdReceived', { id: 'id1' }, 'id de schéma inconnu (id1) reçu — registre local désynchronisé (en attente d\'un µ:schema ?)', false],
  ['schemaEncodeFailed', {}, 'encodage en échec, envoi en JSON', false],
  ['schemaDecodeUnknownId', { id: 'id1' }, 'decode() : id de schéma inconnu (id1) — registre local incomplet ou désynchronisé', false],
  ['schemaDecodeEmpty', {}, 'decode() : trame vide, octet id de schéma attendu', false],
  ['schemaEncodeUnknown', { nom: 'nom1' }, 'encode() : schéma inconnu \'nom1\' — déclarez-le d\'abord (µ.schema)', false],
  ['schemaDecodeOutOfFrame', { offset: 'offset1', taille: 'taille1', frame: 'frame1' }, 'decode() : lecture hors de la trame (offset offset1, taille1 octets, trame de frame1)', false],
  ['schemaListTooLong', { of: 'of1', count: 'count1' }, 'list(of1) : count1 éléments, max 65535 (compteur u16)', false],
  ['schemaStringTooLong', { t: 't1', bytes: 'bytes1', max: 'max1' }, 'chaîne trop longue pour t1 (bytes1 octets UTF-8, max max1)', false],
  ['schemaOutOfRange', { nomSchema: 'nomSchema1', nomChamp: 'nomChamp1', valeur: 'valeur1', t: 't1', min: 'min1', max: 'max1' }, 'schéma \'nomSchema1\', champ \'nomChamp1\' : valeur1 est hors de la plage de t1 (min1 à max1) — la valeur arriverait repliée. Choisissez un type plus large, ou bornez la valeur avant l\'envoi.', false],
  ['schemaRegistryFull', { nom: 'nom1' }, 'registre plein — 256 schémas déjà déclarés (id u8 épuisé), impossible d\'ajouter \'nom1\'', false],
  ['schemaRedeclared', { nom: 'nom1' }, 'schéma \'nom1\' déjà déclaré avec une forme différente — garde AJOUT-SEUL : un schéma existant est IMMUABLE, déclarez un NOM neuf pour faire évoluer le protocole.', false],
  ['schemaFieldName', { nom: 'nom1', field: 'field1' }, 'schéma \'nom1\' : nom de champ invalide \'field1\' — ne survit pas à un objet ordinaire ({}[nom] = valeur), ex. \'__proto__\'', false],
  ['schemaFieldInvalid', { nomSchema: 'nomSchema1', nomChamp: 'nomChamp1' }, 'schéma \'nomSchema1\', champ \'nomChamp1\' : type de champ invalide (ni chaîne scalaire, ni list(), ni bits())', false],
  ['schemaBitsDup', { nomSchema: 'nomSchema1', nomChamp: 'nomChamp1' }, 'schéma \'nomSchema1\', champ \'nomChamp1\' : bits() — noms en double', false],
  ['schemaBitsMax', { nomSchema: 'nomSchema1', nomChamp: 'nomChamp1', count: 'count1' }, 'schéma \'nomSchema1\', champ \'nomChamp1\' : bits() accepte au plus 8 booléens (reçu count1)', false],
  ['schemaBitsEmpty', { nomSchema: 'nomSchema1', nomChamp: 'nomChamp1' }, 'schéma \'nomSchema1\', champ \'nomChamp1\' : bits() attend un tableau de noms non vide', false],
  ['schemaListType', { nomSchema: 'nomSchema1', nomChamp: 'nomChamp1', scalars: 'scalars1', of: 'of1' }, 'schéma \'nomSchema1\', champ \'nomChamp1\' : list() attend un type scalaire (scalars1) — sous-schémas/list imbriquée non supportés, reçu \'of1\'', false],
  ['schemaUnknownType', { nomSchema: 'nomSchema1', nomChamp: 'nomChamp1', type: 'type1', scalars: 'scalars1' }, 'schéma \'nomSchema1\', champ \'nomChamp1\' : type inconnu \'type1\' — types valides : scalars1, list(type), bits([noms])', false],
  ['sockLiveEffect', {}, 'effet en direct', false],
  ['sockQueueFull', { maxQ: 'maxQ1' }, 'file hors-ligne pleine (maxQueue=maxQ1) — message le plus ancien perdu', false],
  ['sockQueueDenied', { n: 'n1' }, 'file hors ligne vidée (n1 en attente) : le serveur a refusé l\'identité pour laquelle ces messages ont été écrits, ils ne partent sous aucune autre — renvoyez-les une fois reconnecté si besoin', false],
  ['sockSendDropped', { url: 'url1' }, 'envoi ignoré : connexion abandonnée (close() volontaire, essais épuisés ou reconnect.enabled:false) — appelez connect() pour reprendre : url1', false],
  ['sockOptionInvalid', { name: 'name1', value: 'value1' }, 'option name1 ignorée : valeur invalide value1', false],
  ['sockBadUrl', { url: 'url1' }, 'URL invalide, connexion abandonnée : url1', false],
  ['sockDuplicateAuth', { url: 'url1' }, 'url1 : une connexion à cette adresse existe déjà avec un autre auth — elle vous revient telle quelle, sous sa première identité ; fermez-la (destroy()) avant d\'en ouvrir une autre sous une autre identité', false],
  ['sockHandleGone', { fn: 'fn1', room: 'room1' }, 'fn1() sur une poignée du salon « room1 » déjà partie (leave()) : rien n\'est inscrit ni envoyé — pour reprendre ce salon, prenez une poignée neuve avec sock.room()', false],
  ['ajaxBinVersionDiff', { hashLocal: 'hashLocal1', version: 'version1' }, 'version de schéma différente (client hashLocal1, serveur version1) — rafraîchissement en arrière-plan', false],
  ['ajaxBinTooShort', { size: 'size1' }, 'réponse trop courte pour porter une version de schéma (8 octets attendus, size1 reçus)', false],
  ['ajaxBinRefreshFailed', { url: 'url1', status: 'status1' }, 'rafraîchissement du schéma en échec (url1) : HTTP status1', false],
  ['ajaxBinUnknownSchema', { schema: 'schema1', names: 'names1' }, 'schéma inconnu \'schema1\' — schémas déclarés dans ce registre : names1', false],
  ['ajaxBinNoRegistry', { schema: 'schema1' }, 'aucun registre disponible — déclarez au moins un schéma via µ.schema(...) avant d\'appeler µ.ajax.binary(url, { schema: \'schema1\' }), ou passez options.codec.', false],
  ['ajaxBinNoSchemaModule', {}, 'option \'schema\' utilisée sans le module runtime \'schema\' chargé — µschema-HTTP a besoin de son codec (µ.schema/µ.list/µ.bits, cf. docs/23-mjs-ws.md §3.2). Ajoutez \'schema\' à la sélection runtime (mjs.config.json), ou passez un registre tout fait via options.codec.', false],
  ['ajaxCrossOrigin', { method: 'method1', url: 'url1' }, 'requête method1 vers une autre origine (url1) : le jeton CSRF de la page n\'est PAS envoyé — il n\'a de sens que pour l\'origine qui l\'a émis.', false],
  ['txCssThrew', { direction: 'direction1', txId: 'txId1' }, 'cfg.css() a levé (transition direction1 #txId1) — transition close proprement :', false],
  ['txSetupThrew', { direction: 'direction1', txId: 'txId1' }, 'setup() a levé (transition direction1 #txId1) — transition close proprement :', false],
  ['txCssSharedThrew', { direction: 'direction1', txId: 'txId1' }, 'cfg.css() a levé (transition partagée direction1 #txId1) — transition close proprement :', false],
  ['txTickThrew', { direction: 'direction1', txId: 'txId1' }, 'cfg.tick() a levé (transition direction1 #txId1) — transition close proprement :', false],
  ['txEasingUnknown', { e: 'e1' }, 'easing inconnu « e1 » — repli cubicOut (attendu : linear, ease, ease-in, ease-out, ease-in-out, cubic-bezier(x1,y1,x2,y2), ou une fonction)', false],
  ['txBezierRange', { x1: 'x11', y1: 'y11', x2: 'x21', y2: 'y21' }, 'cubic-bezier(x11, y11, x21, y21) : x1/x2 hors de [0, 1] — repli cubicOut', false],
  ['springShapeMismatch', {}, 'la cible n\'a pas la même forme que la valeur courante (clés ou longueur différentes) — chaque axe est traité indépendamment : absent de la cible => figé à sa valeur courante, absent de current => apparaît sans animer.', false],
  ['springContainerKind', {}, 'la cible change de nature de conteneur (objet <-> tableau) — le ressort redémarre à zéro sur la nouvelle forme.', false],
  ['springShapeToObject', {}, 'la cible change de forme (nombre → objet/tableau) — le ressort redémarre à zéro sur la nouvelle forme.', false],
  ['springShapeToNumber', {}, 'la cible change de forme (objet/tableau → nombre) — le ressort redémarre à zéro sur la nouvelle forme.', false],
  ['springNestedShape', {}, 'une valeur imbriquée change de forme (objet/tableau/nombre) — cette branche saute directement à la nouvelle valeur.', false],
  ['routerHistoryRefused', { dest: 'dest1' }, '(r)emplacement d\'historique refusé pour \'dest1\' :', false],
  ['routerSlashRefused', { hash: 'hash1' }, 'canonicalisation du slash refusée pour \'hash1\' :', false],
  ['routerCatchAllLast', { tag: 'tag1', path: 'path1', seg: 'seg1' }, '<tag1> : route \'path1\' invalide — le \'*\' catch-all doit être en DERNIÈRE position (segment \'seg1\' et la suite ne seraient jamais atteints).', false],
  ['autoloaderNotRegistered', { fileName: 'fileName1', tag: 'tag1' }, '❌ Import de \'fileName1\' réussi mais <tag1> n\'a jamais été enregistré (customElements.define manquant dans le module ?).', false],
  ['autoloaderRejected', { fileName: 'fileName1' }, '❌ Rejet : Composant \'fileName1\' absent du manifeste de distribution.', false],
  ['autoloaderStale', { fileName: 'fileName1' }, 'bundle périmé : \'fileName1\' introuvable — rechargement de la page (une seule fois par build).', false],
  ['lockstepJournalTruncated', { tick: 'tick1', expected: 'expected1' }, 'journal tronqué au resync (tick tick1 reçu, tick expected1 attendu) — resync déterministe impossible, état local potentiellement faux', false],
  ['lockstepNotLockstep', { game: 'game1' }, 'partie \'game1\' n\'est pas en mode lockstep côté serveur (def.mode) — µ.lockstep restera inerte', false],
  ['lruEvictError', {}, 'onEvict en erreur :', false],
  ['optimisticBadStore', {}, 'store invalide (objet attendu, ex. µ.state({...}))', false],
  ['smoothNonFinite', { id: 'id1' }, 'échantillon non fini (Infinity/NaN) ignoré pour \'id1\'', false],
  ['crossfadeFallbackFailed', {}, 'fonction de repli en échec — transition close proprement :', false],
  ['animCreateOverride', { name: 'name1' }, '\'name1\' remplace une animation déjà enregistrée sous ce nom (built-in du framework, ou un autre µanim.create appelé avant) — la précédente est perdue.', false],
  ['typewriterOneText', {}, '*typewriter exige un unique nœud texte', false],
  ['ajaxBinNoneDeclared', {}, '(aucun)', false],
  ['ujsNoPage', { matchPath: '/x' }, 'Aucune page ne correspond à \'/x\'.', false],
  ['routerNoRouteLog', { matchPath: '/x' }, 'Aucune route pour \'/x\'.', false],
  ['routerNoRoute', { matchPath: '/x', routes: '/a, /b' }, 'Aucune route ne correspond à \'/x\'. Routes déclarées : /a, /b — déclarez une route de repli (\'/*\') pour servir votre propre page 404.', false],
  ['routerViewCrash', { targetId: 'main' }, 'CRASH : <@view main> introuvable dans le DOM !', false],
  ['routerNoneDeclared', {}, '(aucune)', false],
  ['routerLogRegister', { tag: 'tag1' }, 'Enregistrement de : <tag1>', false],
  ['routerLogInit', { tag: 'tag1', matchPath: '/x' }, 'Init <tag1> avec le Hash Path : \'/x\'', false],
  ['routerLogNavigate', { matchPath: '/x' }, 'Navigation locale vers : \'/x\'', false],
  ['routerLogCurtain', { value: 'cube', priority: '3' }, 'Permutation de vues sous RIDEAU (cube, priorité 3)', false],
  ['routerLogViewTransition', { value: 'zoom', priority: '3' }, 'Permutation de vues sous View Transition (zoom, priorité 3)', false],
  ['routerLogNative', {}, 'natif', false],
  ['routerLogNoRoutes', { tag: 'tag1' }, 'Aucun objet @routes trouvé dans <tag1>', false],
  ['routerLogAnalyze', { tag: 'tag1' }, 'Analyse des @routes pour <tag1>...', false],
  ['routerLogMatch', { routePath: '/a', module: 'page-a', targetId: 'main' }, 'Match ! [/a] -> Module [page-a] injecté dans <@view main>', false],
  ['routerLogNothingToInject', { matchPath: '/x' }, 'Aucun composant à injecter pour le path \'/x\'.', false],
  ['routerLogViewCleared', { targetId: 'main' }, 'Aucune route pour <@view main> — vue vidée.', false],
  ['routerLogCacheHit', { tag: 'tag1' }, 'Restauration depuis le cache : <tag1>', false],
  ['routerLogCreate', { tag: 'tag1' }, 'Création DOM : <tag1>', false],
  ['elementClosedShadow', { tag: 'tag1' }, '<tag1> : un Shadow DOM \'closed\' préexiste (SSR avec shadowMode:\'closed\' ?) — MJS ne peut pas l\'adopter ni le reconstruire (contenu inaccessible en mode closed). Utilisez shadowMode:\'open\' (défaut) dans les options de rendu SSR.', false],
  ['importEmptyPath', {}, 'µimport : chemin vide — asset non résolu au build', false],
  ['i18nHttp', { status: 'status1', path: 'path1' }, 'i18n : HTTP status1 sur path1', false],
  ['coreFieldNoName', {}, 'aucun « name » : ni sur <@@field>, ni sur le champ enveloppé.', false],
  ['coreColorNoValue', {}, 'l\'attribut « value » est requis.', false],
  ['coreToolbarUnknown', { n: 'gras', list: 'h2 h3' }, '[ModularJS] <@@toolbar> : l\'outil « gras » n\'existe pas, il est ignoré — outils connus : h2 h3.', true],
  ['coreChartWord', { word: 'courbe', prop: 'shape', list: 'line area dots bar' }, '[ModularJS] <@@chart> : « courbe » n\'est pas une valeur connue de shape, elle est ignorée — valeurs connues : line area dots bar.', true],
  ['coreChartColor', { color: 'red;x', key: 'poids', hue: '1', list: 'blue orange green pink violet gold' }, '[ModularJS] <@@chart> : la couleur « red;x » de la série « poids » est refusée, la série prend la teinte 1 — écrivez un nom de teinte (blue orange green pink violet gold), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…).', true],
  ['coreChartNoStats', { shape: 'histogram', word: 'trend', list: 'line area dots bar histogram', trend: 'line area dots bar' }, '[ModularJS] <@@chart> : la forme histogram ne trace pas stats « trend », il est ignoré — formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar.', true],
  ['coreChartMix', { prop: 'step', word: 'year', shape: 'calendar', list: 'auto day week month' }, '[ModularJS] <@@chart> : step « year » ne va pas avec la forme calendar, il est ignoré — valeurs possibles : auto day week month.', true],
  ['coreChartRadar', { n: '2' }, '[ModularJS] <@@chart> : un radar demande au moins 3 lignes, une par axe ; il en reçoit 2, une courbe le remplace.', true],
  ['coreChartRadarCut', { max: '12', n: '14' }, '[ModularJS] <@@chart> : un radar montre 12 axes au plus, les 14 lignes reçues sont réduites aux 12 dernières.', true],
  ['coreChartUnits', { shape: 'stack', units: 'kg min' }, '[ModularJS] <@@chart> : les séries de la forme stack n\'ont pas la même unité (kg min) et partagent pourtant une même échelle.', true],
  ['coreChartZone', { zone: 'Europe/Pariss' }, '[ModularJS] <@@chart> : « Europe/Pariss » n\'est pas un fuseau connu, il est ignoré — écrivez local ou le nom d\'une zone IANA (Europe/Paris, UTC…) ; sans fuseau, les heures s\'affichent telles qu\'elles sont écrites.', true],
  ['coreChartDecimals', { value: '11' }, '[ModularJS] <@@chart> : decimals « 11 » est ignoré — écrivez un nombre entier de 0 à 10 ; sans decimals, les nombres gardent leur écriture automatique.', true],
  ['coreChartPieDrop', { key: 'moins' }, '[ModularJS] <@@chart> : la série « moins » n\'a pas de total positif, l\'anneau ne lui donne aucune part.', true],
  ['coreChartPieLabelDrop', { label: 'Bâle' }, '[ModularJS] <@@chart> : le libellé « Bâle » n\'a pas de total positif, l\'anneau ne lui donne aucune part.', true],
  ['coreGaugeStep', { n: '-1' }, '[ModularJS] <@@gauge> : le pas « -1 » n\'est pas un nombre positif, la jauge avance de 1. Écrivez un pas plus grand que 0.', true],
  ['coreRangeInverted', { tag: 'knob', min: '80', max: '20' }, '[ModularJS] <@@knob> : min « 80 » est plus grand que max « 20 », la valeur reste bloquée sur une borne. Écrivez un min plus petit que max.', true],
  ['dev.majEffect', {}, 'effet', false],
  ['dev.majColor', {}, 'couleur', false],
  ['dev.majDuration', {}, 'durée', false],
  ['dev.anchorDetach', {}, 'détacher', false],
  ['dev.anchorBottom', {}, 'ancrer en bas', false],
  ['dev.btnTarget', {}, 'cibler', false],
  ['dev.tipTarget', {}, 'cliquer ensuite un élément de la page', false],
  ['dev.btnFlash', {}, 'clignoter au rendu', false],
  ['dev.tipFlash', {}, 'chaque composant qui se re-rend s\'éclaire', false],
  ['dev.btnUpdates', {}, 'mises à jour', false],
  ['dev.tipUpdates', {}, 'chaque morceau que MJS réécrit s\'éclaire', false],
  ['dev.btnRefresh', {}, 'rafraîchir', false],
  ['dev.btnClose', {}, 'fermer', false],
  ['dev.rowEffects', {}, 'effets (*)', false],
  ['dev.tabState', {}, 'État', false],
  ['dev.tabDerived', {}, 'Dérivés', false],
  ['dev.tabBindings', {}, 'Liaisons', false],
  ['dev.tabContext', {}, 'Contexte', false],
  ['dev.tabProps', {}, 'Attributs et props', false],
  ['dev.tabStyle', {}, 'Style et thème', false],
  ['dev.tabEffects', {}, 'Effets', false],
  ['dev.empty', {}, '(vide)', false],
  ['dev.themeNone', {}, 'aucune variable de thème détectée', false],
  ['dev.themeActive', {}, 'Thème actif', false],
  ['dev.themeKnown', {}, 'connus :', false],
  ['dev.themeVars', {}, 'Variables de thème en vigueur', false],
  ['dev.cssActive', {}, 'CSS actif (feuilles adoptées)', false],
  ['dev.cssNone', {}, 'aucun CSS propre détecté', false],
  ['dev.propsDeclared', {}, 'Props / variables déclarées', false],
  ['dev.noneF', {}, 'aucune', false],
  ['dev.attrsReal', {}, 'Attributs réels de l\'élément', false],
  ['dev.noneM', {}, 'aucun', false],
  ['dev.closeInspector', {}, 'fermer l\'inspecteur d\'objet', false],
  ['dev.noStore', {}, 'aucun store', false],
  ['dev.noEffectPage', {}, 'aucun effet dans la page', false],
  ['dev.pickComponent', {}, 'Choisissez un composant à gauche.<br>Survolez une ligne pour le situer dans la page.', false],
  ['dev.derivedTitle', {}, 'Dérivés et leurs dépendances', false],
  ['dev.noDerived', {}, 'aucun dérivé', false],
  ['dev.bindingsTitle', {}, 'Ce que chaque variable met à jour', false],
  ['dev.noBinding', {}, 'aucune liaison', false],
  ['dev.ctxSet', {}, 'Posés ici', false],
  ['dev.ctxReceived', {}, 'Reçus d\'un ancêtre', false],
  ['dev.noCtxSet', {}, 'aucun contexte posé par ce composant', false],
  ['dev.noCtxReceived', {}, 'aucun contexte reçu', false],
  ['dev.noEffectComp', {}, 'aucun effet posé par ce composant', false],
  ['dev.noStateVar', {}, 'aucune variable d\'état', false],
  ['dev.fxDuration', {}, 'durée', false],
  ['dev.fxCurve', {}, 'courbe', false],
  ['dev.fxMain', {}, 'principal', false],
  ['dev.fxCopy', {}, 'copier l\'écriture', false],
  ['dev.fxRevert', {}, 'rétablir', false],
  ['dev.fxCopied', {}, 'copié ✓', false],
  ['dev.fxSelected', {}, 'sélectionné : Ctrl+C', false],
  ['dev.mountedOne', { n: 'n1' }, 'n1 composant monté', false],
  ['dev.mountedMany', { n: 'n1' }, 'n1 composants montés', false],
  ['dev.keysOne', { n: 'n1' }, 'n1 clé', false],
  ['dev.keysMany', { n: 'n1' }, 'n1 clés', false],
  ['dev.fxSetOne', { n: 'n1' }, 'n1 posé', false],
  ['dev.fxSetMany', { n: 'n1' }, 'n1 posés', false],
  ['dev.renderOne', { n: 'n1' }, 'n1 rendu', false],
  ['dev.renderMany', { n: 'n1' }, 'n1 rendus', false],
  ['dev.bindingOne', { n: 'n1' }, 'n1 liaison', false],
  ['dev.bindingMany', { n: 'n1' }, 'n1 liaisons', false],
  ['dev.panelOpen', {}, 'panneau d\'inspection ouvert — Échap pour le fermer', false],
  ['dev.panelClosed', {}, 'panneau d\'inspection fermé', false],
  ['dev.inspNode', {}, 'nœud', false],
  ['dev.inspObject', {}, 'Objet', false],
  ['dev.inspNoValue', {}, 'aucune valeur', false],
  ['dev.inspMore', { n: 'n1', max: 'max1' }, 'et n1 de plus (affichage plafonné à max1)', false],
  ['dev.inspAccessor', {}, 'accesseur', false],
  ['dev.inspFailed', {}, 'échec :', false],
  ['dev.inspCircular', {}, 'référence circulaire', false],
  ['typesAllowed', { d: 'd1' }, ' — permis : d1', false],
  ['typesRefuses', { p: 'p1', v: 'v1', d: 'd1', at: 'at1' }, '[ModularJS] p1 refuse v1d1at1', true],
  ['typesBrought', { p: 'p1', v: 'v1', to: 'to1', d: 'd1', at: 'at1' }, '[ModularJS] p1 : v1 ramené à to1d1at1', true],
  ['typesAnimated', { p: 'p1', at: 'at1' }, '[ModularJS] p1 reçoit une valeur animée : ses bornes se règlent en la créant (µspring(valeur, raideur, amortissement, min, max), µinterpolate(valeur, durée, min, max)) — retirez p1 du <vars>at1', true],
  ['fxBrought', { name: 'name1', k: 'k1', vu: 'vu1', to: 'to1', reg: 'reg1', at: 'at1' }, '[ModularJS] *name1 : k1 = vu1 ramené à to1 — permis : reg1at1', true],
  ['fxRefused', { name: 'name1', k: 'k1', vu: 'vu1', reg: 'reg1', at: 'at1' }, '[ModularJS] *name1 : k1 = vu1 refusé, valeur par défaut — permis : reg1at1', true],
  ['fxEveryRefused', { vu: 'vu1', at: 'at1' }, '[ModularJS] la variable de thème $$mjs-fx-every vaut vu1, une valeur refusée : chaque effet garde sa cadence par défaut — permis : une durée (300ms, 1.5s, 0)at1', true],
  ['spriteImage', { url: 'a.png' }, '[ModularJS] *sprite : l\'image a.png est introuvable — la planche n\'est pas animée', true],
  ['spriteFps', {}, '[ModularJS] *sprite : fps et speed sont écrits tous les deux — fps l\'emporte', true],
  ['spriteRow', {}, '[ModularJS] *sprite : row sans rows — row est ignoré', true],
  ['spritePoses', { valeur: 'a' }, '[ModularJS] *sprite : poses : « a » n\'est pas un numéro de case — écarté', true],
  ['adoptSheetNoShadow', { tag: 'mjs-x' }, '[ModularJS] µ.adoptSheet : la feuille n\'est pas collée dans <mjs-x>, car cette balise n\'a pas d\'ombre (composant réglé en mjs-light, ou balise qui n\'est pas un composant ModularJS). Écrivez ce style dans le <style> du composant, ou dans une feuille de la page : sans ombre, les feuilles de la page s\'appliquent déjà à la balise.', true],
  ['cloneNotComponent', { tag: '<div>' }, '[ModularJS] µclone : <div> n\'est pas un composant MJS, ou sa définition n\'est pas encore chargée — aucun état à copier. Pour copier une balise ordinaire, écrivez el.cloneNode(true).', true],
  ['cloneOption', { opt: 'miroir' }, '[ModularJS] µclone : option « miroir » inconnue — la seule option est mirror : µclone el, mirror: true rend un miroir vivant, qui partage l\'état de l\'original.', true],
]

const table = (lang: 'fr' | 'en') => {
  const t: Record<string, string> = {}
  for (const groupe of ['err', 'dev']) {
    for (const [cle, texte] of Object.entries((RUNTIME_LABELS[lang] as any)[groupe] ?? {})) t[groupe === 'dev' ? 'dev.' + cle : cle] = texte as string
  }
  return t
}

const variables = (texte: string) => [...texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

// le cœur seul (mjs_init) dans une fenêtre : l'assistant tel que le navigateur le lit
function assistant(opts: { lang?: string, labels?: any, lookup?: (k: string) => any } = {}): any {
  const win: any = new Window({ url: 'http://localhost/' })
  const initSrc = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8').replace(/export\s*\{[^}]*\}/, '')
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', `${initSrc}\nreturn µ;`)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet,
  )
  if (opts.labels) { µ._runtimeLabels = opts.labels; µ._runtimeLabelsLang = 'fr' }
  if (opts.lang) µ._mjs_storeRaw = { __mjsLang: opts.lang }
  if (opts.lookup) µ._mjs_i18nLookup = opts.lookup
  return µ
}

// découpe les arguments de premier niveau d'un appel dont la parenthèse ouvrante est en `debut`
function arguments_(src: string, debut: number): string[] {
  const args: string[] = []
  let profondeur = 0
  let quote = ''
  let courant = ''
  for (let i = debut; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      courant += c
      if (c === '\\') { courant += src[++i]; continue }
      if (c === quote) quote = ''
      continue
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; courant += c; continue }
    if (c === '(' || c === '{' || c === '[') { profondeur++; if (profondeur > 1) courant += c; continue }
    if (c === ')' || c === '}' || c === ']') {
      profondeur--
      if (profondeur === 0) { args.push(courant.trim()); return args }
      courant += c
      continue
    }
    if (c === ',' && profondeur === 1) { args.push(courant.trim()); courant = ''; continue }
    courant += c
  }
  throw new Error('appel non fermé')
}

describe('messages du navigateur — table err/dev fr/en', () => {
  const fr = table('fr')
  const en = table('en')

  it('chaque message d\'origine existe dans la table', () => {
    for (const [cle] of REFERENCE) assert.ok(cle in fr, `clé absente de la table fr : ${cle}`)
  })

  it('mêmes clés en fr et en, mêmes variables {…}', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort())
    for (const cle of Object.keys(fr)) {
      assert.deepEqual(variables(en[cle]), variables(fr[cle]), `variables différentes pour ${cle}`)
    }
  })

  it('aucune clé de la table sans message d\'origine relevé', () => {
    assert.deepEqual(Object.keys(fr).sort(), REFERENCE.map((r) => r[0]).sort())
  })

  it('aucun message anglais ne contient un mot français', () => {
    const mots = /\b(vous|votre|vos|est|une|pas|n'a|le|la|les|des|du|dans|avec|pour|sur|ou|ne|aux|mais|donnez|ajoutez|posez|balise|calque|ignorée?s?|attendu|reçu)\b/i
    const accents = /[àâäçéèêëîïôöùûüœ]/i
    for (const [cle, texte] of Object.entries(en)) {
      assert.doesNotMatch(texte, mots, `mot français dans ${cle} : ${texte}`)
      assert.doesNotMatch(texte, accents, `accent dans ${cle} : ${texte}`)
    }
  })

  it('le délai de secours dit ce que le développeur voit : la clé de chaque texte absent (⟦clé⟧), pas des barres grises (fr et en)', () => {
    assert.match(fr.i18nSecours, /⟦clé⟧/)
    assert.doesNotMatch(fr.i18nSecours, /barres/)
    assert.match(en.i18nSecours, /⟦key⟧/)
    assert.doesNotMatch(en.i18nSecours, /bars/)
  })

  it('aucun message vouvoyé n\'est tutoyé (fr)', () => {
    for (const [cle, texte] of Object.entries(fr)) assert.doesNotMatch(texte, /\b(tu|ton|tes|toi)\b/i, `tutoiement dans ${cle}`)
  })
})

describe('messages du navigateur — texte rendu', () => {
  for (const lang of ['fr', '']) {
    it(`français ${lang ? '(µlang = fr)' : '(page sans langue)'} : identique au texte d'origine, clé par clé`, () => {
      const µ = assistant({ labels: RUNTIME_LABELS, lang })
      for (const [cle, vars, origine, prefixe] of REFERENCE) {
        const rendu = prefixe ? µ._mjs_msg(cle, vars, 'REPLI') : µ._mjs_txt(cle, vars, 'REPLI')
        assert.equal(rendu, origine, `texte français changé pour ${cle}`)
      }
    })
  }

  it('anglais : préfixe identique, variables remplacées, aucune accolade de variable restante', () => {
    const µ = assistant({ labels: RUNTIME_LABELS, lang: 'en' })
    const en = table('en')
    for (const [cle, vars, , prefixe] of REFERENCE) {
      const rendu = prefixe ? µ._mjs_msg(cle, vars, 'REPLI') : µ._mjs_txt(cle, vars, 'REPLI')
      assert.ok(!rendu.includes('REPLI'), `repli utilisé pour ${cle}`)
      if (prefixe) assert.ok(rendu.startsWith('[ModularJS] '), `préfixe absent pour ${cle}`)
      for (const nom of Object.keys(vars)) assert.ok(!rendu.includes(`{${nom}}`), `variable ${nom} non remplacée pour ${cle}`)
      for (const [nom, valeur] of Object.entries(vars)) if (variables(en[cle]).includes(nom)) assert.ok(rendu.includes(valeur), `valeur de ${nom} absente de ${cle}`)
    }
  })

  it('anglais : *travel cite la destination entre guillemets droits doubles, jamais entre « »', () => {
    const µ = assistant({ labels: RUNTIME_LABELS, lang: 'en' })
    const rendu = µ._mjs_msg('travelNone', { to: '#fiche' }, 'REPLI')
    assert.equal(rendu, '[ModularJS] *travel: the destination "#fiche" was not found, this step is skipped — check the selector, it is looked up in your component, then in the page')
    assert.doesNotMatch(rendu, /[«»]/)
  })

  it('une accolade sans variable reste intacte, une valeur contenant {x} n\'est pas re-développée', () => {
    const µ = assistant({ labels: { fr: { err: { t: 'a {for} {x}' } }, en: { err: {} } }, lang: 'fr' })
    assert.equal(µ._mjs_msg('t', { x: '{for}' }, 'REPLI'), '[ModularJS] a {for} {for}')
  })

  it('table absente : le texte français de secours sort tel quel', () => {
    const µ = assistant()
    assert.equal(µ._mjs_msg('cleInconnue', { n: 3 }, 'texte {n}'), '[ModularJS] texte 3')
    assert.equal(µ._mjs_txt('cleInconnue', null, 'sans variable'), 'sans variable')
  })

  it('clé inconnue de la table : secours ; sans secours, la clé — jamais undefined', () => {
    const µ = assistant({ labels: RUNTIME_LABELS, lang: 'en' })
    assert.equal(µ._mjs_msg('cleInconnue', null, 'secours'), '[ModularJS] secours')
    assert.equal(µ._mjs_msg('cleInconnue'), '[ModularJS] cleInconnue')
    assert.equal(µ._mjs_msg('cleInconnue', undefined, undefined), '[ModularJS] cleInconnue')
  })

  it('ne plante jamais : variable absente, valeur exotique, table cassée', () => {
    const µ = assistant({ labels: { fr: { err: { t: 'x {a} {b}' } }, en: { err: { t: 'x {a} {b}' } } }, lang: 'en' })
    assert.equal(µ._mjs_msg('t', { a: undefined }, 'REPLI'), '[ModularJS] x undefined {b}')
    assert.doesNotThrow(() => µ._mjs_msg('t', { a: Object.create(null), b: Symbol('s') }, 'REPLI'))
    const cassee = assistant({ labels: { fr: null, en: null }, lang: 'en' })
    assert.equal(cassee._mjs_msg('t', null, 'secours'), '[ModularJS] secours')
  })

  it('le groupe dev : clé dev.xxx lue dans le groupe dev, repli si la table n\'a pas ce groupe', () => {
    const µ = assistant({ labels: RUNTIME_LABELS, lang: 'en' })
    assert.match(µ._mjs_msg('dev.hotcssRoot', null, 'REPLI'), /replaceSync failed for mjs_root/)
    const sans = assistant({ labels: { fr: { err: {} }, en: { err: {} } }, lang: 'en' })
    assert.equal(sans._mjs_msg('dev.hotcssRoot', null, 'repli dev'), '[ModularJS] repli dev')
  })

  it('un site corrige un message par mjs.err.<clé> dans ses dictionnaires', () => {
    const µ = assistant({
      labels: RUNTIME_LABELS,
      lang: 'en',
      lookup: (k: string) => k === 'mjs.err.elProto' ? 'Prototype: {x}' : undefined,
    })
    assert.equal(µ._mjs_msg('elProto', { x: 1 }, 'REPLI'), '[ModularJS] Prototype: 1')
    assert.match(µ._mjs_msg('storeProto', null, 'REPLI'), /prototype change refused/)
  })

  it('langue inconnue de la table (de) : repli sur la langue du build', () => {
    const µ = assistant({ labels: RUNTIME_LABELS, lang: 'de' })
    µ._runtimeLabelsLang = 'en'
    assert.match(µ._mjs_msg('storeProto', null, 'REPLI'), /prototype change refused/)
  })
})

describe('messages du navigateur — texte de secours du code = table fr', () => {
  const fr = table('fr')
  const vus = new Map<string, string>()

  before(() => {
    const fichiers = [
      ...readdirSync(RUNTIME_DIR).filter((n) => n.endsWith('.ts')).map((n) => join(RUNTIME_DIR, n)),
      ...readdirSync(ANIMATIONS_DIR).filter((n) => n.endsWith('.ts')).map((n) => join(ANIMATIONS_DIR, n)),
      ...readdirSync(CORE_MODULES_DIR).filter((n) => n.endsWith('.mjs')).map((n) => join(CORE_MODULES_DIR, n)),
    ]
    for (const f of fichiers) {
      const src = readFileSync(f, 'utf-8')
      for (const m of src.matchAll(/µ\._mjs_(?:msg|txt)\(/g)) {
        const args = arguments_(src, m.index! + m[0].length - 1)
        if (!/^'[\w.]+'$/.test(args[0] ?? '')) continue
        if (args.length !== 3 || !/^'/.test(args[2])) throw new Error(`appel mal formé dans ${f} : ${args[0]}`)
        const secours = new Function(`return ${args[2]}`)() as string
        const cle = args[0].slice(1, -1)
        const prec = vus.get(cle)
        assert.ok(prec === undefined || prec === secours, `${cle} : deux textes de secours différents`)
        vus.set(cle, secours)
      }
    }
  })

  it('chaque appel porte, comme texte de secours, le texte français de la table', () => {
    assert.ok(vus.size > 100, `trop peu d'appels trouvés : ${vus.size}`)
    for (const [cle, secours] of vus) assert.equal(secours, fr[cle], `secours différent de la table pour ${cle}`)
  })

  it('chaque clé de la table est utilisée par le code', () => {
    for (const cle of Object.keys(fr)) assert.ok(vus.has(cle), `clé jamais utilisée : ${cle}`)
  })
})

describe('messages du navigateur — build réel : un effet chargé à part sort traduit', function () {
  this.timeout(90000)

  const fenetres: any[] = []
  let sources: string[] = []
  let libelles = ''

  const stripEsm = (s: string) => s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+/g, '')
    .replace(/import\.meta\.url/g, "'http://localhost/'")

  before(async () => {
    const root = mjsTmp('messages-langue')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<div id="carte" *flipcard><b>recto seul</b></div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f: string) => f.endsWith('.js'))
    const ordre = (f: string) => /^mjs_core-/.test(f) ? 0 : /^hote-/.test(f) ? 2 : 1
    files.sort((a: string, b: string) => ordre(a) - ordre(b))
    libelles = libellesDuManifeste(join(root, 'bundle.js'))
    sources = files.map((f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8')))
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  async function avertissements(lang: string): Promise<string[]> {
    const window: any = new Window({ url: 'http://localhost/' })
    if (lang) window.document.documentElement.setAttribute('lang', lang)
    fenetres.push(window)
    window.eval(`${sources.join('\n')}\nglobalThis.µ = µ;`)
    window.eval(libelles)
    const recus: string[] = []
    window.µ.warn = (...a: any[]) => { recus.push(a.map(String).join(' ')) }
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    await new Promise((r) => setTimeout(r, 200))
    return recus
  }

  it('page en anglais : le message de *flipcard sort en anglais', async () => {
    const recus = await avertissements('en')
    assert.ok(recus.some((m) => m.startsWith('[ModularJS] *flipcard: the tag must carry two children')), recus.join('\n'))
  })

  it('page en français ou sans langue : le message de *flipcard sort en français, mot pour mot', async () => {
    for (const lang of ['fr', '']) {
      const recus = await avertissements(lang)
      assert.ok(recus.some((m) => m.startsWith('[ModularJS] *flipcard : la balise doit porter deux enfants — le premier est le recto, le second le verso. Ajoutez-lui le verso.')), recus.join('\n'))
    }
  })
})

describe('messages du navigateur — le groupe dev ne part que dans un build de développement', function () {
  this.timeout(90000)

  after(async () => { await terminateSharedWorkerPool() })

  async function manifeste(env: 'dev' | 'prod'): Promise<any> {
    const root = mjsTmp('messages-dev-' + env)
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<div>x</div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), env })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const ligne = libellesDuManifeste(join(root, 'bundle.js')).split('\n').find((l) => l.startsWith('µ._runtimeLabels ='))!
    return JSON.parse(ligne.slice('µ._runtimeLabels ='.length).trim().replace(/;$/, ''))
  }

  it('développement : groupes err et dev, dans les deux langues', async () => {
    const t = await manifeste('dev')
    for (const lang of ['fr', 'en']) {
      assert.ok(Object.keys(t[lang].err).length > 100)
      assert.ok(t[lang].dev.hotcssRoot)
    }
  })

  it('production : ni groupe err (un fichier par langue) ni message de développement', async () => {
    const t = await manifeste('prod')
    for (const lang of ['fr', 'en']) {
      assert.equal(t[lang].err, undefined)
      assert.equal(t[lang].dev, undefined)
      assert.ok(t[lang].modal && t[lang].router && t[lang].toast && t[lang].ujs)
    }
  })
})
