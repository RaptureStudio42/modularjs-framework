// bundler/features — signaux « briques du cœur utilisées », lus dans le CODE COMPILÉ d'une
// unité (composant .mjs, module .civet/.coffee, manifeste externe), jamais dans le texte
// source. Remplace scanRuntimeFeatures() (balayage textuel de sourceDir, supprimé) : le
// compilateur GÉNÈRE ces symboles de façon stable (appel littéral, attribut posé, champ de
// données) — les chercher directement dans sa sortie ne peut plus rater une forme compilée
// ni s'arrêter à un commentaire/une chaîne qui MENTIONNE le symbole sans l'utiliser (faux
// positif du scan texte, cf. tests/bundler-core-after-components.test.ts).
//
// Chaque regex ci-dessous a été prouvée par une fixture compilée via transpile() (jamais
// déduite du seul texte du générateur) — cf. tests/bundler-features-scan.test.ts, une fixture
// par clé. Un correctif notable trouvé ainsi : la balise `<@failed>` ne compile PAS en
// `_mjs_hook('failed', …)` (réservé à la rune nue `µfailed (err, reset)->`) mais en
// `this._mjs_fallback = (err, reset) => {…}` — scanné en plus du premier.
//
// Appliquée à la sortie NON MINIFIÉE (le minifieur esbuild mangle les propriétés `_mjs_*`/
// `_upd*` via mangleCache, les signaux y deviennent invisibles) — cf. les appelants
// (bundler/index.ts, chemin froid de _compileMjsInner/_compileScriptModuleInner).

/** sous-ensemble de TranspileDataLike utilisé ici — layoutCss seul (déclaration de variant de
 * mise en page, `<style name="…">`) : `used === undefined` pour un module de script autonome
 * (aucun TranspileData, jamais de <style name>), le scan retombe alors sur le texte compilé. */
import * as acorn from 'acorn'
import { EFFECTS, playsOnce } from '../effects/catalog.js'

export type FeatureScanData = {
  layoutCss?: Record<string, string>
}

// Les 21 clés historiques de scanRuntimeFeatures() (bundler/index.ts, SCAN_KEYS) + `theme`
// (thème clair/sombre embarqué détaché en mjs_theme.ts) + `html` (interpolation brute `{{…}}`,
// mjs_html.ts) + `slots` (slots indexés, mjs_slots.ts) + `deep`/`textpool`/`esc` (trois familles
// de fonctions détachées de mjs_init.ts) + `alias` (enregistrement de l'alias court d'un
// composant, mjs_alias.ts) — même vocabulaire, même consommateur
// (resolveRuntimeFiles/wantsByFile) : aucun renommage.
export const SCAN_KEYS = [
  'title', 'store', 'interpolate', 'ticker', 'head', 'body', 'dynamic', 'failed', 'rare_runes',
  'on', 'effect', 'every', 'for', 'if', 'key', 'await', 'emit', 'context', 'lifecycle',
  'layout_variant', 'destroy_hooks', 'theme', 'html', 'slots', 'deep', 'textpool', 'esc', 'for_nested', 'alias', 'types', 'fx', 'lang', 'state', 'inspect', 'play', 'refuse', 'slot_events', 'element_at', 'boundary', 'adopt_sheet', 'form_reset', 'form_associated', 'clone', 'chart',
] as const

// un effet `*nom` écrit dans un gabarit (ou sur `<@document>`) : le moteur (`fx`) et le fichier de
// CET effet (`fx_nom`, runtime/mjs_fx_nom.ts) — un effet jamais écrit n'entre pas au cœur ; les
// transitions partagent un seul fichier (`fx_transition`, runtime/mjs_fx_transition.ts), leurs
// animations viennent de runtime/animations/ (les animations utilisées, à part)
export const FX_KEYS = [...Object.keys(EFFECTS).filter(n => !EFFECTS[n].transition).map(n => 'fx_' + n.replace(/-/g, '_')), 'fx_transition', 'fx_custom']
// les effets dont le code part dans son propre fichier en construction découpée (`js: 'split'`),
// importé par les composants qui les écrivent (bundler/index.ts, compileFxChunks) ; restent au cœur
// le squelette (le cœur s'en sert pour ses chargements et ses textes traduits), les transitions et
// les effets CSS de l'appli (le code compilé appelle leurs fonctions directement)
export const FX_CHUNK_KEYS = new Set(FX_KEYS.filter(k => k !== 'fx_skeleton' && k !== 'fx_transition' && k !== 'fx_custom'))
// un effet choisi par une variable (`*delta(fx: $effet)`) : la pose porte la règle du réglage, `["e", …]`.
// Signal à part, jamais le nom d'un fichier runtime (pas de préfixe `fx_`) : il peut nommer n'importe
// quel effet qui se joue une fois — ceux qui ont leur propre fichier sont alors tous préparés, importés
// seulement quand la variable les nomme (bundler/index.ts, compileFxChunks)
export const FX_NAMED = 'named_fx'
// ce que les poses compilées d'un effet écrivent, pour les sections de son fichier (bundler/fx-sections.ts) : un signal par réglage
// écrit, `<effet>_<réglage>:<valeur>` (`hologram_style:cosmos`, `fade_on:hover`), et `use:<effet>` pour l'effet écrit, avec ou sans
// réglage. `<effet>_<réglage>:*` : une valeur que le build ne sait pas lire (tenue par une variable, liste, objet), ou tous les
// réglages d'un effet dont une mention n'est pas une pose reconnue — toutes les valeurs sont alors demandées. Jamais le nom d'un
// fichier runtime (d'où l'absence du préfixe `fx_`, comme FX_NAMED)
export const FX_ANY = '*'
export const fxSignal    = (effect: string, setting: string, value: string) => effect + '_' + setting + ':' + value
export const fxUseSignal = (effect: string) => 'use:' + effect
// le renvoi d'une pose d'effet à la table des alias du cœur, `µ._mjs_alias(rang[, changements])` (bundler/index.ts, tableAliases) : un signal par
// rang renvoyé, la table n'écrit que ceux-là. Jamais le nom d'un fichier runtime (pas de préfixe `fx_`)
export const fxAliasSignal = (rank: number | string) => 'effect_alias:' + rank
// les signaux du réglage `style` de *hologram, nommés pour son client (bundler/hologram-styles.ts) et ses tests
export const HOLOGRAM_STYLE_PREFIX = fxSignal('hologram', 'style', '')
export const HOLOGRAM_STYLE_ANY    = fxSignal('hologram', 'style', FX_ANY)
// `µ.Autoloader.preload(nom)` écrit par le projet : le manifeste ne porte la fonction (et rien d'autre, la table
// des dépendances y est déjà) que si le build voit l'appel. Signal à part, comme FX_NAMED : il ne désigne aucun
// fichier du cœur. L'appel peut s'écrire sous bien des formes (alias `A = µ.Autoloader`, extraction
// `{ preload } = µ.Autoloader`, appel optionnel `preload?(…)`, crochets, module partagé) : plutôt que de les
// énumérer, le build retient que le code de l'appli mentionne `Autoloader` ET le mot `preload` — chaque mention
// est un signal à part, croisés sur TOUT le projet (l'alias peut vivre dans un module, l'appel dans un composant).
// Faux positifs acceptés : la fonction pèse peu, et seulement dans le manifeste
export const AUTOLOADER_MENTION = 'autoloader_mention'
export const PRELOAD_MENTION    = 'preload_mention'
// un module demande plusieurs sections de traduction (`@i18n 'accueil' 'onglets'`) : le bloc `<i18n-paquets>` de mjs_i18n.ts (les demander
// ensemble, chercher une clé dans chacune) n'entre au cœur que si une unité de ce build en écrit. Signal à part, comme FX_NAMED : il ne
// désigne aucun fichier du cœur ; une appli dont aucun module n'écrit plusieurs sections reçoit un cœur identique à l'octet
export const I18N_PAQUETS = 'i18n_paquets'
// l'attente des textes traduits écrite par une page (`@i18nPlaceholder *loader(bloom)`) : l'accroche de l'indicateur de chargement de mjs_i18n.ts
// n'entre au cœur que si une unité de ce build l'écrit (ou la configuration, `i18n.placeholder`, cf. collectUsedFeatures) ; le fichier de l'effet
// `*loader` part, lui, avec le signal `fx_loader`. Signal à part, comme I18N_PAQUETS. Le rendu des barres grises (`*skeleton`) est, lui, toujours au
// cœur d'une appli traduite : le secours de `wait` (3 s sans textes) s'en sert
export const I18N_LOADER = 'i18n_loader'
// l'appli se sert de la traduction : une page écrit `@i18n` ou `µt(…)` (le compilateur pose alors `_mjs_i18n` ou appelle `µ.t(`). Sert à refuser un
// `runtime` qui n'embarque pas 'i18n' (bundler/index.ts, resolveRuntimeFiles) seulement quand l'appli en a besoin. Signal à part, comme I18N_PAQUETS
export const I18N_USED = 'i18n_used'
// une boucle qui écrit l'état, enveloppée par le compilateur (`µ._mjs_lq++;try{…}`, generator/loop-batch.ts) : la file des boucles (bloc balisé
// `<boucles>` de mjs_init.ts et de `_mjs_invalidate`, mjs_element.ts) n'entre au cœur que si une unité de ce build en a une. Signal à part, comme
// I18N_PAQUETS : une appli sans boucle enveloppée reçoit un cœur identique à l'octet
export const BOUCLES = 'boucles'
// les appels `µ?.Autoloader?.observe?.(` et `µ.Autoloader?.load?.(` sont écrits par le compilateur dans CHAQUE composant : ils ne comptent pas
const REGEX_AUTOLOADER_MENTION = /\bAutoloader\b(?!\?\.(?:observe|load)\?\.\()/
const REGEX_PRELOAD_MENTION    = /\bpreload\b/
// `@mjs:sprite-end` (ou `'mjs:sprite-end'` dans un script) écrit par l'appli : *sprite ne fabrique son évènement de fin de tour que pour elle ;
// signal `sprite_end:listened`, au format des signaux de réglage de l'effet (`<effet>_<réglage>:<valeur>`)
export const SPRITE_END_LISTENED = 'sprite_end:listened'
const REGEX_SPRITE_END        = /mjs:sprite-end/
// repère rapide : le texte `":["e",` peut aussi venir d'un JSON ordinaire (`$data = {"fr":["e","x"]}`) — il n'est
// retenu que lu à sa place, dans la pose d'un effet (hasNamedEffectPlacement)
const REGEX_FX_NAMED = /":\["e",/
// une pose compilée d'un effet, où les règles des réglages tenus par une variable sont le DERNIER argument :
// `µ._mjs_fx(this, nœud, "nom", fixes, variables, règles)` (6e, de même pour les poses de cycle de vie `_mjs_fxAnim`/`_mjs_fxLife`)
// ou `µ._mjs_fxSet(nœud, "nom", variables, règles)` (4e)
const REGEX_FX_CALL = /(µ|mjs)\._mjs_fx(Set|Anim|Life)?\(/g
const REGEX_ALIAS_CALL = /µ\._mjs_alias\(/g
const REGEX_ALIAS_RANK = /µ\._mjs_alias\((\d+)/g
// les effets qu'une variable peut nommer et qui ont leur propre fichier (les transitions restent au
// cœur, avec leurs animations : seules celles écrites dans l'appli y sont)
export const FX_NAMEABLE_KEYS = Object.keys(EFFECTS).filter(n => playsOnce(EFFECTS[n])).map(n => 'fx_' + n.replace(/-/g, '_')).filter(k => FX_CHUNK_KEYS.has(k))
// la balise d'une pose : un nom réservé du code émis (préfixe `_mjs`), `_node` ou la racine de la page (`document.documentElement`)
const REGEX_FX = /µ\._mjs_fx\(this, (?:_mjs\w*|_node|document\.documentElement), "([a-z][a-z0-9-]*)"/g
// une transition ou un effet sur le cycle de vie d'une balise (`@in=*fly`, `@out=*scramble`) ; la balise y porte un nom réservé du code émis
const REGEX_FX_LIFE = /µ\._mjs_fx(?:Anim|AnimCustom|Life)\(/
const REGEX_FX_PLAY = /µ\._mjs_fxLife\(_mjsThis, _mjs\w*, "([a-z][a-z0-9-]*)"/g
// un effet CSS de l'appli (fichier *.effects.mjs), sa définition posée avec lui
const REGEX_FX_CUSTOM = /µ\._mjs_fxCustom\(/
// un effet donné en réglage (`*delta(fx: *scramble)`) : les réglages fixes le portent, `{"fx":"scramble","s":…}`
const REGEX_FX_NESTED = /\{"fx":"([a-z][a-z0-9-]*)","s":/g

// une regex par clé — `(?![\w$])`/`\b` où un nom pourrait être le préfixe d'un autre
// identifiant (mangleCache retire déjà les composants minifiés de la course, cf. bandeau).
const REGEX_TITLE         = /mjs-title/
// blancs compris autour du point (`new µ .Store(…)`, `µ\n  .Ticker`), comme `µ.every` plus bas, et chaînage optionnel (`µ?.Store`) :
// le contrat du cœur (core-contract.ts) lit les jetons et réclame ces écritures, un relevé qui les ratait faisait refuser le build
const REGEX_STORE         = /µ\s*\??\.\s*Store(?![a-zA-Z0-9_])/
const REGEX_INTERPOLATE   = /µ\s*\??\.\s*interpolate(?![a-zA-Z0-9_])/
const REGEX_TICKER        = /µ\s*\??\.\s*Ticker(?![a-zA-Z0-9_])/
const REGEX_HEAD          = /µ\._setHead\(/
const REGEX_BODY          = /µ\._glCl\(|µ\._glSt\(/
const REGEX_DYNAMIC       = /µ\._updDynEl\(|µ\._updModule\(/
// balise <@failed> compilée (this._mjs_fallback = (err, reset) => {…}) OU rune nue
// (this._mjs_hook('failed', fn)) — deux émetteurs distincts, cf. bandeau de tête.
const REGEX_FAILED        = /_mjs_fallback\s*=|_mjs_hook\(\s*'failed'/
const REGEX_RARE_RUNES    = /µ\.raw\(|µ\.snap\(|µ\._mjs_import\(/
// un appel, blancs compris (`µ.inspect ('n')`, retour à la ligne autour du point) et chaînage optionnel, comme `µ.effect` et
// `µ.every` plus bas : la même lecture que le contrat du cœur (core-contract.ts), qui les réclame au cœur
const REGEX_INSPECT       = /µ\s*\??\.\s*inspect\s*\(/
const REGEX_PLAY          = /µ\s*\??\.\s*play\s*\(/
const REGEX_ON            = /_mjs_on\(/
const REGEX_EFFECT        = /µ\s*\??\.\s*effect\s*\(/
// un appel, blancs compris (`µ.every (1000, fn)`, retour à la ligne) : la même lecture que le contrat du cœur (core-contract.ts),
// qui refusait le build quand ce relevé ratait l'appel
const REGEX_EVERY         = /µ\s*\??\.\s*every\s*\(/
// {if}/{key} imbriqués dans {for}/{await} compilent en _mjs_updItemIf( (mjs_if.ts), jamais
// _mjs_updIf(/_mjs_updKey( — un composant qui n'a QUE la forme nichée doit quand même lever 'if'
// (mjs_if.ts sert dans les deux cas ; un faux positif sur 'if' pour un {key} nu niché est
// sans conséquence, wantsKey force déjà wantsIf, cf. resolveRuntimeFiles).
const REGEX_FOR           = /this\._mjs_updFor\(/
const REGEX_IF            = /this\._mjs_updIf\(|this\._mjs_updItemIf\(/
const REGEX_KEY           = /this\._mjs_updKey\(/
const REGEX_AWAIT         = /this\._mjs_updAwait\(/
const REGEX_EMIT          = /_mjs_emit\(/
// `§` (figé) compile en _mjs_setContext(/_mjs_getContext( ; `§§` (RÉACTIF) compile en
// _mjs_setRCtx(/_mjs_getRCtx( (marqueur DISTINCT, trouvé empiriquement — la conception ne
// citait que les deux premiers, corrigé après un test rouge sur `{§§theme}` en LECTURE
// seule). `_mjs_rctxRemember(` complète la même famille (cf. config.ts, DETECTED_CORE_MODULES).
const REGEX_CONTEXT       = /_mjs_setContext\(|_mjs_getContext\(|_mjs_setRCtx\(|_mjs_getRCtx\(|_mjs_rctxRemember\(|__context\.|__shared\./
// n'importe quel hook de cycle de vie (mount/awake/sleep/destroy/urlChange/failed nu) —
// même regroupement que l'ancien REGEX_LIFECYCLE (alternance incluant 'failed').
const REGEX_LIFECYCLE     = /_mjs_hook\(/
// reliquat texte : la DEMANDE (`layout="x"`/`template="x"`) peut ne venir que d'une page que
// ce build ne compile jamais (vue serveur, HTML statique) — mais quand elle EST dans une
// source compilée, le HTML compilé la porte encore telle quelle (µ._mjs_cloneTpl("<p layout='x'>
// …")) : un scan sur la SORTIE suffit, plus besoin du texte SOURCE séparément.
const REGEX_LAYOUT_TEXT   = /layout=|template=/
// `static _mjs_noDestroyHooks = …;` est TOUJOURS émis (true ou false) par tout composant —
// seule la valeur `false` signale un vrai besoin (transpiler/template.ts).
const REGEX_DESTROY_HOOKS = /_mjs_noDestroyHooks = false/
// thème clair/sombre embarqué (mjs_theme.ts) — 8 variables canoniques du framework
// (surface/fg/fg-muted/border/hover/selected/accent/shadow), jamais un nom de thème PROJET
// (`$$brand` reste hors de cette liste). Deux formes compilées :
//   - lecture CSS directe `var(--mjs-x)`, ou sucre `$$x` — la passe `rewriteStyleVars`
//     (transpiler/index.ts) réécrit `$$x` en texte CSS littéral `var(--mjs-x)` AVANT la
//     compilation JS, le texte compilé porte donc déjà la forme `var(...)` : aucun signal
//     séparé nécessaire pour `$$`, `data.varsRead` n'est pas consultée ici ;
//   - rune `µtheme`, qui compile soit en lecture `µ.store.__mjsTheme` (sigils.ts,
//     MU_THEME_OUT) soit en écriture `µ._storeSet('__mjsTheme', v)` (generator/utils.ts) — la
//     2e forme loge `__mjsTheme` dans un littéral de chaîne, JAMAIS masqué ici (contrairement à
//     store/interpolate/ticker/every) pour ne pas produire de faux négatif sur `µtheme = v`.
const REGEX_THEME = /--mjs-(?:surface|fg|fg-muted|border|hover|selected|accent|shadow)\b|__mjsTheme\b/
// interpolation brute `{{…}}` (mjs_html.ts) : appel littéral `this._mjs_updHtml('tN', …)` émis par
// generator/compile.ts pour chaque `{{…}}` du composant — racine, {if}/{else}, {key}, contenu de
// <@slot>, contenu passé à un enfant, partiel <@include>. Dans un {for} la ligne écrit
// `innerHTML` elle-même, dans un {await} la branche construit son nœud : ni l'un ni l'autre
// n'appelle la méthode, aucun signal à chercher pour eux.
const REGEX_HTML = /\._mjs_updHtml\(/
// slots indexés (mjs_slots.ts) : `this._mjs_injectSlots();` n'est émis dans le constructeur compilé
// que si le composant écrit `<@slot` (partiel <@include> compris, inliné avant ce test —
// transpiler/index.ts, `hasDynamicSlots`) ; sans lui, la méthode n'avait rien à faire.
const REGEX_SLOTS = /\._mjs_injectSlots\(/
// mutations PROFONDES (mjs_deep.ts) : les quatre appels que le suiveur de chemins
// (generator/path-tracker.ts) émet LITTÉRALEMENT —
// `µ._mjs_deepSet(` pour `$o.x = v`, `µ._mjs_deepCall(` pour `$liste.push(v)`, `µ._mjs_deepDelete(` pour
// `delete $o.x`, `µ._mjs_makeDeepProxy(` au point de fuite d'un chemin. Le symbole est cherché
// SANS son objet (`µ`/`mjs` selon la config du projet), comme pour `_mjs_updHtml` plus haut.
const REGEX_DEEP = /\._mjs_deepSet\(|\._mjs_deepCall\(|\._mjs_deepDelete\(|\._mjs_makeDeepProxy\(/
// pool de nœuds texte (mjs_textpool.ts) : `µ._mjs_getTextNode('')` émis par le mode IMPÉRATIF du
// générateur (generator/paths.ts), seul consommateur du pool — le mode clone, lui, crée ses
// nœuds texte directement. Sans cet appel, rien ne puise dans le pool.
const REGEX_TEXTPOOL = /\._mjs_getTextNode\(/
// échappement HTML (mjs_esc.ts) : `µ._esc(` émis pour CHAQUE interpolation d'un `<@head>` ou du
// repli d'un `<@failed>` (transpiler/macros.ts, buildHeadInjection) — les deux partent en
// innerHTML. Un `<@head>` sans interpolation n'émet rien : il n'y a rien à échapper.
const REGEX_ESC = /\._esc\(/
// `{for}` dont les ancres ne sont pas celles du composant (mjs_for_nested.ts) : `this._mjs_updList(`
// émis par generator/compile.ts pour une liste DANS une autre liste, et pour une liste dans une
// branche `{await}`. Racine, `{if}` et `{key}` compilent en `this._mjs_updFor(` : rien à chercher.
const REGEX_FOR_NESTED = /\._mjs_updList\(/
// alias COURT d'un composant (mjs_alias.ts) : `µ._al(` émis par le squelette du module compilé
// (transpiler/index.ts) pour le SEUL composant qui porte un nom court — un projet dont chaque
// fichier vit à la racine n'en écrit aucun. Le symbole est cherché SANS son objet (`µ`/`mjs` selon
// la config du projet), comme pour `_mjs_updHtml` plus haut.
const REGEX_ALIAS = /\._al\(/
// langue courante lue ou écrite (`µlang`) : le compilateur émet en tête du module la déclaration de la
// clé cachée, `µ._storeDeclare(["__mjsLang"])`, définie dans mjs_store_globals.ts (module optionnel
// `vault`). Les modules cœur à libellé (<@@select>, <@@number>…) lisent `µlang` pour suivre la
// bascule : sans ce signal, un projet en `runtime: []` qui en pose un se faisait refuser par la garde
// « Cœur incomplet »
const REGEX_LANG = /\._storeDeclare\(\[[^\]]*"__mjsLang"/
// rune `µ.state` (mjs_state.ts) : tout appel écrit par le projet, et l'écriture `µ$x = …` qui compile en
// `µ_state.x ?= µ.state(…)`. Le symbole est cherché SANS son objet (`µ`/`mjs` selon la config du projet) et
// sans parenthèse : `const f = µ.state` appelle aussi. Faux positifs acceptés (`jeu.state`), jamais de faux négatif.
const REGEX_STATE = /\.state\b/
// types et valeurs permises (mjs_types.ts) : la table des règles posée par le constructeur d'un
// composant qui écrit un `<vars>` (`this._mjs_types = …`), ou les règles de ses stores
// (`µ._mjs_storeTypes(`, au chargement du module) — transpiler/index.ts, data.typesDecl/typesLine
// champ nombre lié dont la saisie est refusée (mjs_refuse.ts) : le gestionnaire de saisie d'un `value=!{$x}` dont
// le type peut être `number` (type fixe `number`, ou type donné par une variable) appelle `µ._mjs_refuse(`
// (generator/attributes/index.ts) ; un champ au type fixe autre, une case à cocher, un `value.number` sur un
// champ texte n'émettent pas l'appel. Le symbole est cherché SANS son objet (`µ`/`mjs` selon la config du projet).
const REGEX_REFUSE = /\._mjs_refuse\(/
// contenu glissé (mjs_slot_events.ts) : un composant ne reçoit un événement né hors de son arbre que par un `<slot>` de
// son gabarit, écrit en toutes lettres dans le HTML compilé (`<@slot>`, `<slot>`, dans un `{if}`, un `{for}`, un
// `{await}`, un `{key}`) ou créé par `createElement('slot')`. Faux positifs acceptés, jamais de faux négatif.
const REGEX_SLOT_EVENTS = /<slot\b|['"`]slot['"`]/
// l'élément sous un point (mjs_element_at.ts) : le MOT `elementAt` écrit par le projet, forme privée comprise —
// cherché sans son objet (`µ`/`mjs` selon la config du projet), sans point (`µ['elementAt']`, `{ elementAt } = µ`)
// et sans parenthèse (`const f = µ.elementAt` appelle aussi). Les trois effets en direct qui l'appellent n'ont pas
// besoin de signal à part : leurs fichiers l'entraînent (bundler/index.ts). Faux positifs acceptés
// (`liste.elementAt(`, le mot dans un texte) ; seul un nom fabriqué à l'exécution échappe (`runtime: ['element_at']`).
const REGEX_ELEMENT_AT = /\b(?:_mjs_)?elementAt\b/
// la remise à zéro d'un formulaire (mjs_form_reset.ts) : `µ._mjs_formReset(` écrit par les modules de saisie du cœur à leur montage (case, interrupteur,
// radio, nombre, jauge, bouton rotatif, liste, champ, éditeur), jamais par une application (le préfixe `_mjs_` est réservé au framework) : un projet
// sans module de saisie n'en cite aucun et ne paie pas le fichier
const REGEX_FORM_RESET = /\._mjs_formReset\(/
// le socle des composants associés au formulaire (mjs_form_associated.ts) : `µ._mjs_formClass(` que le compilateur écrit dans le fichier d'un
// composant qui déclare `@formAssociated` (un module de saisie du cœur, un composant de l'application), juste avant l'enregistrement de sa balise ;
// le préfixe `_mjs_` est réservé au framework : un projet sans composant déclaré n'en cite aucun et ne paie pas le fichier
const REGEX_FORM_ASSOCIATED = /\._mjs_formClass\(/
// les calculs des graphiques (mjs_chart.ts) : `µ._mjs_chart` écrit par les modules de graphiques du cœur (échelles, statistiques, tracés), jamais
// par une application (le préfixe `_mjs_` est réservé au framework) : un projet sans graphique n'en cite aucun et ne paie pas le fichier
const REGEX_CHART = /\._mjs_chart\b/
// entrée/sortie de survol (mjs_boundary.ts) : la clé de l'événement dans la table de routage que le gabarit compilé passe à
// `_mjs_bindEvents({"mouseenter":{…}})` (JSON.stringify : toujours entre guillemets doubles). Faux positifs acceptés
// (le nom d'événement dans un texte), jamais de faux négatif ; seul un nom fabriqué à l'exécution échappe (`runtime: ['boundary']`).
const REGEX_BOUNDARY = /"(?:pointer|mouse)(?:enter|leave)":/
// coller une feuille dans l'ombre d'un composant (mjs_adopt_sheet.ts) : le MOT `adoptSheet` écrit par le projet — cherché sans son objet
// (`µ`/`mjs` selon la config du projet), sans point (`µ['adoptSheet']`, `{ adoptSheet } = µ`) et sans parenthèse (`const f = µ.adoptSheet`
// appelle aussi). Faux positifs acceptés (le mot dans un texte), jamais de faux négatif ; seul un nom fabriqué à l'exécution échappe
// (`runtime: ['adopt_sheet']`).
const REGEX_ADOPT_SHEET = /\badoptSheet\b/
// copier un composant avec son état (mjs_clone.ts) : le MOT `clone` — la rune `µclone el` compile en `µ.clone(el)` —, cherché sans son
// objet (`µ`/`mjs` selon la config du projet), sans point (`µ['clone']`, `{ clone } = µ`) et sans parenthèse. `cloneNode`,
// `structuredClone`, `_mjs_cloneTpl` du code émis ne le contiennent pas en mot entier. Faux positifs acceptés (une méthode `clone` d'une
// autre bibliothèque, `box-decoration-break: clone` dans un style), jamais de faux négatif ; seul un nom fabriqué à l'exécution échappe
// (`runtime: ['clone']`).
const REGEX_CLONE = /\bclone\b/
// la ligne d'instance d'un module à plusieurs sections de traduction : `_mjs_i18n = ["accueil",null,["onglets"]]` (3e élément, les sections en plus) ;
// le mode (2e élément) peut être un effet d'attente, `"*loader"` : toute chaîne y est lue
const REGEX_I18N_PAQUETS  = /\b_mjs_i18n = \["[a-z0-9_-]+",(?:null|"[^"]*"),\[/
// l'appli se sert de la traduction : un appel `µt` (compilé en `µ.t(`, composant ou module de script) ou la ligne d'instance d'un `@i18n` ;
// un `runtime` sans 'i18n' est alors refusé. Faux positifs acceptés (le mot dans un texte), jamais de faux négatif
const REGEX_I18N_USED   = /µ\.t\(|\b_mjs_i18n\b/
// l'attente de ce module est l'indicateur de chargement : `_mjs_i18n = ["accueil","*loader",null,{"style":"bloom"}]` (ou sans section, `[null,"*loader"]`)
const REGEX_I18N_LOADER = /\b_mjs_i18n = \[(?:null|"[a-z0-9_-]+"),"\*loader"/
const REGEX_TYPES =/\._mjs_types = |\._mjs_storeTypes\(/
// l'ouverture de l'enveloppe d'une boucle qui écrit l'état, cherchée sans son objet (`µ`/`mjs` selon la config du projet)
const REGEX_BOUCLES = /\._mjs_lq\+\+;\s*try\s*\{/

// la valeur d'un réglage écrit dans une pose, en texte : un mot, un nombre ou un booléen en toutes lettres ; `*` quand le build ne
// sait pas la lire (une variable `($.s)`, sa règle `["l", …]`, une liste, un objet)
function settingValue(node: any): string {
  if (node?.type === 'Literal' && node.value !== null && typeof node.value !== 'object') return String(node.value)
  if (node?.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'Literal' && typeof node.argument.value === 'number') return String(-node.argument.value)
  return FX_ANY
}

// les littéraux de chaîne du code compilé (commentaires sautés : leurs apostrophes ne doivent pas décaler la lecture des chaînes)
const REGEX_STRING_OR_COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g

// expandAliasCalls — la pose d'un alias en table s'écrit `µ._mjs_alias(rang)` ou `µ._mjs_alias(rang, {changements})` : pour lire ce qu'elle
// demande (les sections de l'effet, les effets donnés en réglage), le renvoi est remplacé par les réglages qu'il désigne, ceux de la table
// (`table[rang]`) sauf ceux que l'usage change, puis ceux de l'usage — la lecture de la pose est celle de réglages écrits en clair
function expandAliasCalls(js: string, table: ReadonlyArray<Record<string, unknown>>): string {
  if (!js.includes('_mjs_alias(')) return js
  let out  = ''
  let from = 0
  for (const m of js.matchAll(REGEX_ALIAS_CALL)) {
    if (m.index! < from) continue
    let call: any
    try {
      call = acorn.parseExpressionAt(js, m.index!, { ecmaVersion: 'latest', sourceType: 'module' })
    }
    catch {
      continue
    }
    // le renvoi suivi d'une virgule (`µ._mjs_fxAnim(…, µ._mjs_alias(0), null, null)`) se lit comme une suite : son premier terme est l'appel
    if (call?.type === 'SequenceExpression') call = call.expressions[0]
    const entry = call?.type === 'CallExpression' ? table[call.arguments[0]?.value] : undefined
    if (!entry) continue
    const changes = call.arguments[1]?.type === 'ObjectExpression' ? call.arguments[1] : null
    const given   = changes ? changes.properties.map((p: any) => p.key?.type === 'Literal' ? String(p.key.value) : p.key?.name) : []
    const props   = Object.keys(entry).filter(k => !given.includes(k)).map(k => JSON.stringify(k) + ':' + JSON.stringify(entry[k]))
    if (changes) props.push(js.slice(changes.start + 1, changes.end - 1))
    out += js.slice(from, call.start) + '{' + props.filter(Boolean).join(',') + '}'
    from = call.end
  }
  return out + js.slice(from)
}

// fxSettings — ce que les poses compilées des effets du catalogue écrivent : `use:<effet>`, puis `<effet>_<réglage>:<valeur>` pour
// chaque réglage (fixe : sa valeur ; tenu par une variable, liste, objet : `*`). Une pose se lit sur son arbre (jamais sur du texte) :
// l'appel `µ._mjs_fx(…, "nom", fixes, variables, règles)`, `µ._mjs_fxSet(nœud, "nom", variables, règles)`, un effet donné en réglage
// `{"fx":"nom","s":{…}}`. Une mention d'un effet du catalogue qui n'en fait pas partie (un mot seul dans le code, une pose qui ne se
// lit pas) demande tous les réglages de cet effet : jamais une section manquante. Un effet du projet (CSS à soi) n'est pas au catalogue.
function fxSettings(js: string): string[] {
  if (!js.includes('_mjs_fx') && !js.includes('"fx"')) return []
  const out   = new Set<string>()
  const spans: Array<[number, number]> = []
  const known = (name: any) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(EFFECTS, name)
  const keyOf = (p: any) => p.key?.type === 'Literal' ? String(p.key.value) : p.key?.name
  const write = (name: string, obj: any) => {
    out.add(fxUseSignal(name))
    if (obj?.type !== 'ObjectExpression') return
    for (const p of obj.properties) {
      if (p.type !== 'Property') {
        for (const k of Object.keys(EFFECTS[name].settings)) out.add(fxSignal(name, k, FX_ANY))
        continue
      }
      out.add(fxSignal(name, keyOf(p), settingValue(p.value)))
    }
  }
  const parse = (at: number): any => {
    try {
      return acorn.parseExpressionAt(js, at, { ecmaVersion: 'latest', sourceType: 'module' })
    }
    catch {
      return null
    }
  }
  for (const m of js.matchAll(REGEX_FX_CALL)) {
    let call = parse(m.index!)
    if (call?.type === 'SequenceExpression') call = call.expressions[0]
    if (call?.type !== 'CallExpression') continue
    const args: any[] = call.arguments
    const at = args.findIndex((a, i) => i < 3 && a.type === 'Literal' && known(a.value))
    if (at < 0) continue
    spans.push([call.start, call.end])
    // les objets qui suivent le nom : les réglages fixes, puis ceux des variables et leurs règles
    for (const a of args.slice(at + 1)) write(args[at].value, a)
    if (args.length <= at + 1) write(args[at].value, null)
  }
  for (const m of js.matchAll(REGEX_FX_NESTED)) {
    if (!known(m[1])) continue
    const ref = parse(m.index!)
    if (ref?.type !== 'ObjectExpression') continue
    spans.push([ref.start, ref.end])
    write(m[1], ref.properties.find((p: any) => keyOf(p) === 's')?.value)
  }
  // une mention libre : un mot seul, entre guillemets, hors de toute pose (`$nom = "hologram"`)
  for (const m of js.matchAll(REGEX_STRING_OR_COMMENT)) {
    if (m[0][0] !== '"' && m[0][0] !== "'") continue
    const word = m[0].slice(1, -1)
    if (!known(word) || spans.some(([a, b]) => m.index! >= a && m.index! < b)) continue
    if (/^\s*:/.test(js.slice(m.index! + m[0].length, m.index! + m[0].length + 8))) continue
    out.add(fxUseSignal(word))
    for (const k of Object.keys(EFFECTS[word].settings)) out.add(fxSignal(word, k, FX_ANY))
  }
  return [...out]
}

// hasNamedEffectPlacement — une pose d'effet dont un réglage a la règle d'un effet nommé par une variable, `["e", …]` :
// lue sur l'arbre de l'appel lui-même, jamais sur du texte ailleurs dans le code ; un appel qui ne se lit pas
// compte comme nommé (jamais de faux négatif toléré, cf. scanCompiledFeatures)
function hasNamedEffectPlacement(js: string): boolean {
  for (const m of js.matchAll(REGEX_FX_CALL)) {
    let call: any
    try {
      call = acorn.parseExpressionAt(js, m.index!, { ecmaVersion: 'latest', sourceType: 'module' })
    }
    catch {
      return true
    }
    const rules = call.type === 'CallExpression' ? call.arguments[m[2] === 'Set' ? 3 : 5] : undefined
    if (rules?.type !== 'ObjectExpression') continue
    for (const p of rules.properties) {
      const first = p.value?.type === 'ArrayExpression' ? p.value.elements[0] : undefined
      if (first?.type === 'Literal' && first.value === 'e') return true
    }
  }
  return false
}

// maskStringLiterals — blanchit les chaînes, le texte des gabarits, les expressions régulières et
// les commentaires (même longueur, retours à la ligne gardés) avant de tester store/interpolate/
// ticker/every : ce sont des noms « publics » du framework (documentés), qu'une chaîne ou un
// commentaire affiché peut mentionner SANS jamais les utiliser (`@doc = 'µ.Store'`, faux positif
// texte vérifié). Lu d'après les jetons d'acorn, jamais par une expression régulière : une regex
// ne sait pas dans quel contexte elle tombe — l'apostrophe d'un littéral regex (`s.replace(/'/g,
// '')`, très courant) ouvrait une « chaîne » refermée à la prochaine apostrophe du fichier, et
// tout le code entre les deux disparaissait du relevé (cœur parti sans `µ.Store`, page cassée au
// navigateur). Les expressions `${…}` d'un gabarit restent du code : un usage qui s'y trouve
// compte. Lecture d'un programme (en module, puis en script), sinon jetons seuls : la sortie de
// transpile() lue hors du bundler porte encore ses repères d'import (`import { µ } from
// µ.asset('mjs_core.js')`), qu'aucun programme n'accepte. Un texte qu'acorn ne lit d'aucune de ces
// trois façons n'est pas masqué du tout : une mention de trop embarque un module pour rien, un
// usage caché casserait la page.
// Jamais appliqué aux autres clés : soit leur marqueur est un appel interne préfixé `_mjs_`/
// `_upd`/`µ._` qu'aucun texte utilisateur n'écrit par hasard, soit (title/layout_variant) le
// HTML compilé lui-même EST une chaîne JS — le masquer les rendrait indétectables.
function maskStringLiterals(js: string): string {
  const types                          = acorn.tokTypes
  const spans: Array<[number, number]> = []
  const inerte = (token: acorn.Token): void => {
    if (token.type === types.string || token.type === types.template || token.type === types.invalidTemplate || token.type === types.regexp) spans.push([token.start, token.end])
  }
  const commentaire = (_block: boolean, _text: string, start: number, end: number): void => { spans.push([start, end]) }
  const lectures: Array<() => void> = [
    () => { acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', onToken: inerte, onComment: commentaire }) },
    () => { acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script', onToken: inerte, onComment: commentaire }) },
    () => { for (const token of acorn.tokenizer(js, { ecmaVersion: 'latest', sourceType: 'script', onComment: commentaire })) inerte(token) },
  ]
  for (const lire of lectures) {
    spans.length = 0
    try {
      lire()
    }
    catch {
      continue
    }
    let out    = ''
    let cursor = 0
    for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
      out   += js.slice(cursor, start) + js.slice(start, end).replace(/[^\n]/g, ' ')
      cursor = end
    }
    return out + js.slice(cursor)
  }
  return js
}

// un des sept noms publics écrit quelque part, blancs ou commentaires compris entre les jetons (`µ /* c */ .Store`, `µ // c⏎
// .every(`) : sans lui, rien à masquer (le masque ne peut que retirer des mentions). Le contrat du cœur (core-contract.ts),
// qui lit ces écritures sur les jetons, part du MÊME indice : un nom qu'il réclame est toujours relevé ici
const ENTRE_JETONS = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*`
export const INDICE_NOMS_PUBLICS = new RegExp(`µ${ENTRE_JETONS}\\??\\.${ENTRE_JETONS}(?:Store|interpolate|Ticker|every|inspect|play|effect)(?![\\w$])`)

// --------------------------------------------------------------------------
// scanCompiledFeatures(js, data?, aliases?) : union des signaux détectés dans la sortie compilée
// NON MINIFIÉE d'une unité. `data` optionnel (module de script autonome : aucun
// TranspileData, aucun `<style name>` possible — la clé layout_variant retombe alors sur le
// seul texte compilé). `aliases` : les réglages fixes de la table des alias de l'appli, dans l'ordre de leur
// rang — les poses qui y renvoient sont lues comme si elles les écrivaient. Jamais de faux négatif toléré : les faux
// positifs (mention hors-usage) sont, eux, acceptés — sauf store/
// interpolate/ticker/every, dont le seul faux positif texte connu (mention en chaîne) est
// corrigé par maskStringLiterals ci-dessus.
// --------------------------------------------------------------------------
export function scanCompiledFeatures(js: string, data?: FeatureScanData, aliases: ReadonlyArray<Record<string, unknown>> = []): Set<string> {
  const used = new Set<string>()
  const masked = INDICE_NOMS_PUBLICS.test(js) ? maskStringLiterals(js) : js
  if (REGEX_TITLE.test(js)) used.add('title')
  if (REGEX_STORE.test(masked)) used.add('store')
  if (REGEX_INTERPOLATE.test(masked)) used.add('interpolate')
  if (REGEX_TICKER.test(masked)) used.add('ticker')
  if (REGEX_HEAD.test(js)) used.add('head')
  if (REGEX_BODY.test(js)) used.add('body')
  if (REGEX_DYNAMIC.test(js)) used.add('dynamic')
  if (REGEX_FAILED.test(js)) used.add('failed')
  if (REGEX_RARE_RUNES.test(js)) used.add('rare_runes')
  if (REGEX_INSPECT.test(js) || (masked !== js && REGEX_INSPECT.test(masked))) used.add('inspect')
  if (REGEX_PLAY.test(js) || (masked !== js && REGEX_PLAY.test(masked))) used.add('play')
  if (REGEX_REFUSE.test(js)) used.add('refuse')
  if (REGEX_SLOT_EVENTS.test(js)) used.add('slot_events')
  if (REGEX_ELEMENT_AT.test(js)) used.add('element_at')
  if (REGEX_BOUNDARY.test(js)) used.add('boundary')
  if (REGEX_ADOPT_SHEET.test(js)) used.add('adopt_sheet')
  if (REGEX_CLONE.test(js)) used.add('clone')
  if (REGEX_FORM_RESET.test(js)) used.add('form_reset')
  if (REGEX_FORM_ASSOCIATED.test(js)) used.add('form_associated')
  if (REGEX_CHART.test(js)) used.add('chart')
  if (REGEX_I18N_USED.test(js)) used.add(I18N_USED)
  if (REGEX_I18N_PAQUETS.test(js)) used.add(I18N_PAQUETS)
  if (REGEX_BOUCLES.test(js)) used.add(BOUCLES)
  if (REGEX_I18N_LOADER.test(js)) {
    used.add(I18N_LOADER)
    used.add('fx')
    used.add('fx_loader')
  }
  if (REGEX_ON.test(js)) used.add('on')
  if (REGEX_EFFECT.test(js) || (masked !== js && REGEX_EFFECT.test(masked))) used.add('effect')
  if (REGEX_EVERY.test(masked)) used.add('every')
  if (REGEX_FOR.test(js)) used.add('for')
  if (REGEX_IF.test(js)) used.add('if')
  if (REGEX_KEY.test(js)) used.add('key')
  if (REGEX_AWAIT.test(js)) used.add('await')
  if (REGEX_EMIT.test(js)) used.add('emit')
  if (REGEX_CONTEXT.test(js)) used.add('context')
  if (REGEX_LIFECYCLE.test(js)) used.add('lifecycle')
  if ((data?.layoutCss && Object.keys(data.layoutCss).length > 0) || REGEX_LAYOUT_TEXT.test(js)) used.add('layout_variant')
  if (REGEX_DESTROY_HOOKS.test(js)) used.add('destroy_hooks')
  if (REGEX_THEME.test(js)) used.add('theme')
  if (REGEX_HTML.test(js)) used.add('html')
  if (REGEX_SLOTS.test(js)) used.add('slots')
  if (REGEX_DEEP.test(js)) used.add('deep')
  if (REGEX_TEXTPOOL.test(js)) used.add('textpool')
  if (REGEX_ESC.test(js)) used.add('esc')
  if (REGEX_FOR_NESTED.test(js)) used.add('for_nested')
  if (REGEX_ALIAS.test(js)) used.add('alias')
  if (REGEX_TYPES.test(js)) used.add('types')
  if (REGEX_LANG.test(js)) used.add('lang')
  if (REGEX_STATE.test(js)) used.add('state')
  for (const m of js.matchAll(REGEX_FX)) {
    used.add('fx')
    if (EFFECTS[m[1]]) used.add(EFFECTS[m[1]].transition ? 'fx_transition' : 'fx_' + m[1].replace(/-/g, '_'))
  }
  if (REGEX_FX_CUSTOM.test(js)) {
    used.add('fx')
    used.add('fx_custom')
  }
  if (REGEX_FX_LIFE.test(js)) {
    used.add('fx')
    used.add('fx_transition')
  }
  for (const m of js.matchAll(REGEX_FX_PLAY)) used.add('fx_' + m[1].replace(/-/g, '_'))
  // les poses d'alias en table lues comme des réglages écrits en clair (sections, effets donnés en réglage)
  const poses = aliases.length > 0 ? expandAliasCalls(js, aliases) : js
  for (const m of js.matchAll(REGEX_ALIAS_RANK)) used.add(fxAliasSignal(m[1]))
  for (const m of poses.matchAll(REGEX_FX_NESTED)) {
    if (EFFECTS[m[1]]) used.add(EFFECTS[m[1]].transition ? 'fx_transition' : 'fx_' + m[1].replace(/-/g, '_'))
  }
  for (const signal of fxSettings(poses)) used.add(signal)
  if (REGEX_FX_NAMED.test(js) && hasNamedEffectPlacement(js)) used.add(FX_NAMED)
  if (REGEX_AUTOLOADER_MENTION.test(js)) used.add(AUTOLOADER_MENTION)
  if (REGEX_PRELOAD_MENTION.test(js)) used.add(PRELOAD_MENTION)
  if (REGEX_SPRITE_END.test(js)) used.add(SPRITE_END_LISTENED)
  // *follow(cursor, selection, focus) dessine ce que montre celui qui mène avec la trousse de *cursors
  if (used.has('fx_follow')) used.add('fx_cursors')
  return used
}
