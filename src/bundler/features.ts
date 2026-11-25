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
import * as walk from 'acorn-walk'
import { EFFECTS, playsOnce } from '../effects/catalog.js'
import { unescapeMu } from '../transpiler/mu-escapes.js'
import { mentionsAjax } from '../transpiler/var-types.js'
import { readableAssetImports } from '../transpiler/load-sites.js'
import { MU_T_CALL_STRICT_RE } from '../sigils.js'

export type FeatureScanData = {
  layoutCss?: Record<string, string>
}

// Les 21 clés historiques de scanRuntimeFeatures() (bundler/index.ts, SCAN_KEYS) + `theme`
// (thème clair/sombre embarqué détaché en mjs_theme.ts) + `html` (interpolation brute `{{…}}`,
// mjs_html.ts) + `slots` (slots indexés, mjs_slots.ts) + `deep`/`esc` (deux familles
// de fonctions détachées de mjs_init.ts) + `alias` (enregistrement de l'alias court d'un
// composant, mjs_alias.ts) — même vocabulaire, même consommateur
// (resolveRuntimeFiles/wantsByFile) : aucun renommage.
export const SCAN_KEYS = [
  'title', 'store', 'interpolate', 'ticker', 'head', 'body', 'dynamic', 'failed', 'rare_runes',
  'on', 'effect', 'every', 'for', 'if', 'key', 'await', 'emit', 'context', 'lifecycle',
  'layout_variant', 'destroy_hooks', 'theme', 'html', 'slots', 'deep', 'esc', 'for_nested', 'alias', 'types', 'types_select', 'types_ajax', 'fx', 'lang', 'state', 'inspect', 'play', 'refuse', 'slot_events', 'element_at', 'boundary', 'adopt_sheet', 'form_reset', 'form_associated', 'clone', 'chart', 'wake', 'load', 'await_derived', 'rules', 'form', 'form_tag', 'form_view',
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
// un module demande plusieurs sections de traduction (`@i18n 'accueil' 'onglets'`) : le bloc `<i18n-packs>` de mjs_i18n.ts (les demander
// ensemble, chercher une clé dans chacune) n'entre au cœur que si une unité de ce build en écrit. Signal à part, comme FX_NAMED : il ne
// désigne aucun fichier du cœur ; une appli dont aucun module n'écrit plusieurs sections reçoit un cœur identique à l'octet
export const I18N_PACKS = 'i18n_packs'
// l'attente des textes traduits écrite par une page (`@i18nPlaceholder *loader(bloom)`) : l'accroche de l'indicateur de chargement de mjs_i18n.ts
// n'entre au cœur que si une unité de ce build l'écrit (ou la configuration, `i18n.placeholder`, cf. collectUsedFeatures) ; le fichier de l'effet
// `*loader` part, lui, avec le signal `fx_loader`. Signal à part, comme I18N_PACKS. Le rendu des barres grises (`*skeleton`) est, lui, toujours au
// cœur d'une appli traduite : le secours de `wait` (3 s sans textes) s'en sert
export const I18N_LOADER = 'i18n_loader'
// l'appli se sert de la traduction : une page écrit `@i18n` ou `µt(…)` (le compilateur pose alors `_mjs_i18n` ou appelle `µ.t(`). Sert à refuser un
// `runtime` qui n'embarque pas 'i18n' (bundler/index.ts, resolveRuntimeFiles) seulement quand l'appli en a besoin. Signal à part, comme I18N_PACKS
export const I18N_USED = 'i18n_used'
// une boucle qui écrit l'état, enveloppée par le compilateur (`µ._mjs_lq++;try{…}`, generator/loop-batch.ts) : la file des boucles (bloc balisé
// `<loops>` de mjs_init.ts et de `_mjs_invalidate`, mjs_element.ts) n'entre au cœur que si une unité de ce build en a une. Signal à part, comme
// I18N_PACKS : une appli sans boucle enveloppée reçoit un cœur identique à l'octet
export const LOOPS = 'loops'
// mise à jour fine, champ par champ : une unité dont le compilateur a posé la table des variables lues champ par champ (`_mjsThis._mjs_fine =
// {…}`, transpiler/index.ts) ; le code fin du cœur (blocs balisés `<fine-grained>` de mjs_deep.ts, mjs_init.ts et mjs_hotswap.ts) n'entre qu'avec
// elle. Signal à part, comme BOUCLES : une appli sans table reçoit un cœur identique à l'octet
export const FINE = 'fine'
// `visible` écrit sur un effet (`*ink(on: view, visible: 100%)`, effets/catalog.ts) : la part de `on: view` réglable (blocs balisés `<visible>`
// de mjs_fx.ts et de mjs_fx_transition.ts) n'entre au cœur de production que si une unité de ce build l'écrit. Signal à part, comme FINE (jamais
// le nom d'un fichier runtime) : une appli qui ne l'écrit pas reçoit un cœur de production identique à l'octet
export const VIEW_PART = 'view_part'
// un objet du magasin (`$$x`, compilé `µ.store.x`) ou d'un état de module (`µ$$x`, `µ$x` : `µ_state.x`, ou le nom `$x` qu'exporte le
// module) qui peut finir dans une variable `$` d'un composant : lu dans l'affectation d'une variable ou d'une prop (`µ._set(_mjsThis,
// 'sel', µ.store.m[0])`, `__mjsV = µ.store.m[0]`), rangé dans un nom (`t = µ.store.m.find(f)`), rendu par une fonction (`return
// µ.store.m[0]`, `=> µ.store.m`), parcouru par une boucle du script (`of µ.store.m`), étalé (`...µ.store.m`), passé à une fonction de
// l'appli (`choisir(µ.store.m[0])`), rendu par une valeur dérivée (`() => (µ.store.m.filter(f))` : ses objets vont où va la valeur),
// liste d'un `{for}` dont les lignes vont à un composant ou à un gestionnaire de la ligne qui la garde (`@click={$sel = r}`) : le
// carnet des objets gardés (blocs balisés `<ledger>` de mjs_element.ts, mjs_store_globals.ts et mjs_state.ts) n'entre au cœur qu'avec
// lui, en développement comme en production. Une lecture faite pour l'écran (texte, attribut, condition, liste d'un `{for}` aux lignes
// sans composant ni ligne gardée), une valeur simple (longueur, calcul, comparaison, négation, langue et thème du framework), une copie
// étalée dans un littéral, l'écriture d'un champ et la déclaration d'un état de module n'en sont pas. Faux positifs acceptés (une
// valeur lue dans le magasin et passée à une fonction ou à une prop, `{fmt($$prix)}`, `count={$$compte}` : sa sorte n'est pas connue).
// Signal à part, comme BOUCLES : une appli sans ce cas reçoit un cœur identique à l'octet
export const STORE_HELD = 'store_held'
// aides gardées du module `deep` (`µ._mjs_deepSetOn(`…, `µ._mjs_deepSafe(`, `µ._mjs_deepKey(`, `µ._mjs_deepName(`, `µ._mjs_deepSame(`, mjs_deep.ts) : le bloc `<deep-guard>`
// n'est gardé que pour l'appli dont le code compilé les appelle
export const DEEP_GUARD = 'deep_guard'
// aides gardées du magasin (mjs_store_globals.ts) : le bloc `<store-guard>` (`µ._mjs_storeSafe(`) et le bloc `<store-key>`
// (`µ._mjs_keyStore(`) ne sont gardés que pour l'appli dont le code compilé appelle leur aide
export const STORE_GUARD = 'store_guard'
export const STORE_KEY   = 'store_key'
// `res` lu sur l'objet du cœur (`µres`, compilé en `µ.res` : le sac des réponses, que pose mjs_store_globals.ts, clé `vault`) : une liste
// `runtime` qui omet `vault` l'emmène quand même pour le composant qui le lit (<@@field> lit `µres.errors`). Signal à part, comme BOUCLES :
// la sélection par défaut le porte déjà (la clé `vault` se détecte sur la même lecture)
export const RES_READ = 'res_read'
// une ligne peuplée après son insertion qui livre des props à un composant enfant (une directive qui lit sa balise dans le document, sur la
// ligne : generator/compile.ts, `µ._mjs_waitRow(`), ou la branche d'un `{if}` de ligne qui en livre (refaite dans une ligne déjà dans la page) :
// les réveils retenus des lignes (blocs balisés `<retained-wakes>` de mjs_for.ts) n'entrent au cœur que si une unité de ce build en a une.
// Signal à part, comme BOUCLES : une liste dans une liste, sans directive, n'en paie pas un octet, ni un `{if}` de ligne sans composant
export const RETAINED_WAKES = 'retained_wakes'
// le nettoyage gardé d'une attache (`µ._mjs_attKeep(`, émis pour chaque `:attach` par generator/attributes) : l'aide (bloc balisé
// `<attach-keep>` de mjs_destroy_hooks.ts) n'entre au cœur que si une unité de ce build en a une ; une transition, un `:this=!`, un
// `:flip` ou un effet, qui joignent aussi ce fichier, n'en paient pas un octet
export const ATTACH_KEEP = 'attach_keep'
// pages d'une table de routes confiées au routeur (`µ._mjs_routesIdle?.(`, émis par le compilateur sous `routes.preload` "idle" ou "off") :
// la file au repos et la demande de la page par le routeur (blocs balisés `<routes-idle>` de mjs_router.ts et mjs_autoloader.ts)
// n'entrent au cœur que si une unité de ce build en émet un. Sans table, ou sous "on", pas un octet
export const ROUTES_IDLE = 'routes_idle'
// les props qu'un composant livre aux composants d'une branche de `{if}`, d'un bloc `{key}` ou de sa racine, posées avant leur entrée dans
// la page (`_mjs_kb`, generator/compile.ts ; blocs balisés `<child-props>` de mjs_element.ts, mjs_if.ts, mjs_key.ts et mjs_ujs.ts) : n'entrent au
// cœur que si une unité de ce build en livre une. Signal à part, comme BOUCLES
export const CHILD_PROPS = 'child_props'
// `:preload` écrit sur une balise (attribut `data-mjs-preload` du gabarit compilé, transpiler/index.ts) : la file des liens à précharger d'un
// composant, lue à l'image qui suit sa construction (blocs balisés `<preload-on>` de mjs_ujs.ts), n'entre au cœur de production que si une
// unité de ce build l'écrit ; sans elle, la porte se lit à la construction, sans une opération de plus par composant. Signal à part, comme BOUCLES
export const PRELOAD_LINK = 'preload_link'
// `@wake=interaction` sur la balise d'un composant (attribut `mjs-wake` de valeur `interaction` du gabarit compilé) : l'écoute des signes
// d'intention et le passage à la vue de ce que l'utilisateur a fait dans la page du serveur (blocs balisés `<wake-intent>` de
// mjs_wake.ts) n'entrent au cœur de production que si une unité de ce build l'écrit ; une appli qui n'écrit que `@wake=view` n'en paie rien
export const WAKE_INTERACTION = 'wake_interaction'
// la liaison d'un champ (`value=!{…}`, `checked=!{…}`, `:group=!{…}`, route marquée 4 par le compilateur, generator/attributes/index.ts) :
// la saisie faite dans la page du serveur avant le démarrage, que cette liaison écrit dans sa variable (blocs balisés `<server-input>` de
// mjs_element.ts et mjs_wake.ts), n'entre au cœur de production d'une appli rendue par le serveur que si une unité de ce build en écrit une
export const FIELD_BIND = 'field_bind'
// une liaison filtrée par valeur dans un `{for}` (`checked={x is $choix}`, generator/attributes/index.ts, filteredBinding) : chaque ligne range sa
// clé dans `_mjs_filtIdxKeys` ; l'index, ses purges et sa vidange en masse (blocs balisés `<filtered-bindings>` de mjs_for.ts) n'entrent au cœur
// que si une unité de ce build en écrit une. Signal à part, comme BOUCLES
export const FILTERED_BINDINGS = 'filtered_bindings'
// `:in`, `:out` ou `:transition` écrit (generator/attributes/index.ts, bindingTransition : `_mjs_node._mjs_intro = …`, `_mjs_node._mjs_outro = …`) :
// le retour d'une sortie en cours (blocs balisés `<exit-reverse>` de mjs_for.ts et mjs_easing.ts — la ligne de `{for}` remise pendant sa
// sortie revient, ses balises intérieures avec elle, une transition partagée reprise repart de là où elle en était) n'entre au cœur que si
// une unité de ce build en écrit une. `:attach`, `:this=!`, `:flip` ou un effet posé sur la balise joignent les crochets de destruction
// sans en payer un octet. Signal à part, comme BOUCLES
export const TRANSITION_DIRECTIVES = 'transition_directives'
// `<@view>` compilé en `<metamjs-view>` (generator/compile.ts, preprocess) : la déclaration de cette balise (bloc balisé `<view-tag>` de mjs_init.ts)
// n'entre au cœur que si une unité de ce build l'écrit, ou avec le routeur ou les liens (bundler/index.ts). Signal à part, comme BOUCLES
export const VIEW_TAG = 'view_tag'
// `matches`/`animate` de la balise, insensibles à une méthode du composant du même nom (blocs balisés `<native>` de mjs_element.ts) : appelés
// par du code compilé (`µ._mjs_matches(` de <@@field>) ; les modules du runtime qui s'en servent posent leur copie. Signal à part, comme BOUCLES
export const NATIVE_HELPERS = 'native_helpers'
// la classe étalée (blocs balisés `<spread-class>` de mjs_element.ts et mjs_dynamic.ts : la part étalée de la classe d'une balise, sa pose
// et ses relevés) : appelée par le code compilé d'un étalement sur un composant (`µ._mjs_spWc(`), sur `<@module>` ou sur une balise ordinaire
// qui porte une classe écrite (`µ._mjs_spCls(`, generator/attributes/index.ts)
export const SPREAD_CLASS = 'spread_class'
// la classe seule d'un étalement sur `<@module>` ou sur une balise ordinaire qui porte une classe écrite (bloc balisé `<spread-class-only>` de
// mjs_element.ts, `µ._mjs_spCls(`) ; les attributs qu'un étalement pose sur la balise d'un composant (bloc balisé `<spread-component>`,
// `µ._mjs_spWc(`). Tous deux se servent de `<spread-class>`. Signaux à part, comme BOUCLES
export const SPREAD_TAG_CLASS = 'spread_tag_class'
export const SPREAD_COMPONENT = 'spread_component'
// un attribut global calculé (`class`, `title`…) écrit sur la balise d'un composant (balise à tiret) : l'aide qui le pose sur la balise, sauf
// prop déclarée du même nom, et qui attend la définition de la balise (bloc balisé `<attr-global>` de mjs_element.ts, `µ._mjs_attrGlob(`,
// generator/attributes/index.ts, componentLogic) n'entre au cœur que si une unité de ce build en écrit un. Signal à part, comme BOUCLES
export const GLOBAL_ATTR_COMPONENT = 'global_attr_component'
// les aides que le code compilé appelle pour écrire un attribut ou un texte (blocs balisés de mjs_element.ts et mjs_init.ts) : la mise à jour d'un
// attribut calculé (`<attr-upd>` : µ._mjs_updAttrNode, et la méthode `_mjs_updAttr` ; generator/attributes/index.ts, paths.ts), la valeur d'un
// <select> (`<attr-select>`, µ._mjs_selVal), la prop posée sur un enfant pas encore mis à niveau (`<pending-props>`, µ._mjs_pend ;
// generator/compile.ts), le filtre des attributs à risque (`<attr-filter>`, µ._mjs_safeAttr et ses tables) et la mise à jour d'un texte de la
// racine (`<root-text>`, `_mjs_updText` ; generator/compile.ts) : chacune n'entre au cœur de production que si une unité de ce build la nomme, ou
// si le cœur lui-même s'en sert encore (bundler/index.ts). Signaux à part, comme BOUCLES
export const ATTR_UPDATE   = 'attr_update'
export const ATTR_SELECT   = 'attr_select'
export const PROPS_PENDING = 'props_pending'
export const ATTR_FILTER   = 'attr_filter'
export const ROOT_TEXT     = 'root_text'
// les deux parties de mjs_dynamic.ts, qui ne se servent pas l'une de l'autre : la balise dynamique (bloc balisé `<dynamic-element>`, appelée par
// le code compilé de `<@element>` : `µ._updDynEl(`, transpiler/macros.ts) et le composant dynamique (bloc balisé `<dynamic-module>`, appelé par
// le code compilé de `<@module>` : `µ._updModule(`, generator/attributes/index.ts) : chacune n'entre au cœur de production que si une unité de ce
// build l'appelle. Signaux à part, comme BOUCLES
export const DYNAMIC_ELEMENT = 'dynamic_element'
export const DYNAMIC_MODULE  = 'dynamic_module'
// une valeur dérivée compilée (`$total = $a * 2`, `µderived`, une dérivée qui lit un magasin : `µ._mjs_setComputed(`, generator/transform-reactive.ts) :
// la machinerie des valeurs dérivées (blocs balisés `<derived-values>` de mjs_element.ts, mjs_init.ts et mjs_store_globals.ts : `_mjs_setComputed`, l'horloge
// et ses comptes) n'entre au cœur de production que si une unité de ce build en a une (tout build qui n'est pas de production la garde).
// Signal à part, comme BOUCLES
export const DERIVED_VALUES = 'derived_values'
// une lecture notée pour le graphe des signaux (`µ._mjs_sigRead(`, generator/transform-reactive.ts : le calcul d'une valeur dérivée précise) : le
// module du graphe (mjs_signals.ts) part avec elle ; une appli dont les valeurs dérivées sont toutes à l'horloge n'en a pas besoin
export const SIG_READS = 'sig_reads'
// une `µderived` que le composant écrit (`this._mjs_computedSrc = `, transpiler/index.ts) : le choix gardé jusqu'au changement d'une dépendance nommée (blocs
// balisés `<derived-choice>` de mjs_element.ts et de mjs_clone.ts) n'entre au cœur de production qu'avec elle. Signal à part, comme BOUCLES
export const DERIVED_CHOICE = 'derived_choice'
// `µrefresh($x)` ou `µrefresh($$x)` écrit par une unité (`µ._mjs_refresh(`, `µ._mjs_storeRefresh(`) : les blocs
// `<refresh>` de mjs_element.ts et de mjs_store_globals.ts, et le chemin qui redessine sans relancer les effets (blocs `<redraw>`, cf. projectPrecision), n'entrent au cœur de production qu'avec lui
export const REFRESH_RUNE = 'refresh_rune'
// réglage `proxy: false` : une variable qu'une unité note comme un autre nom d'une autre (`this._mjs_otherNames = `, transpiler/index.ts) : le bloc
// `<other-names>` de mjs_element.ts, qui prévient aussi l'autre quand l'objet est écrit par elle, n'entre au cœur de production qu'avec elle
export const STATE_ALIAS = 'state_alias'
// une variable `layout` ou `template` que déclare une unité (`this._mjs_var_bits = { "layout": 1 }`, l'état du composant) : le bloc
// `<layout-variable>` de mjs_element.ts, qui laisse alors l'attribut du même nom à la variable au lieu d'y lire le modèle de style, n'entre
// au cœur de production qu'avec elle
export const LAYOUT_VAR = 'layout_var'
// une attache ou une référence que pose le code d'une unité (`:attach`, `:this` : `this._mjs_attachments`) : la défaite des attaches d'un
// composant qui quitte la page (blocs `<attached>` de mjs_element.ts) n'entre au cœur de production que si une unité en pose une, ou si un
// fichier du cœur ou d'effet nomme leur liste (un effet posé, `µsignal`, une valeur dérivée qui attend, les crochets de destruction, le cache des pages)
export const ATTACHMENTS = 'attachments'
// les aides du cœur que seuls un autre fichier du cœur ou une écriture précise du code compilé appellent : [bloc balisé, membres de µ qu'il
// définit, module dont le nom, écrit dans la liste de la clé `runtime`, la garde]. En production, chacune part si aucune unité de ce build
// n'écrit le nom d'un de ses membres (loneHelperSignal), si la clé `runtime` ne demande pas son module (`"runtime": ["deep"]` garde les
// écritures profondes que l'aide-mémoire lui prête : affectation, méthode, suppression, état lu comme une valeur) et si le cœur assemblé
// sans elle, effets à part compris, n'en nomme plus aucun. Dans l'ordre où elles se nomment : l'état lu comme une valeur nomme la
// suppression profonde. Une page compilée à la volée apporte celles qu'elle appelle (VIEWER_RUNTIME, server/viewer-page.ts)
export const LONE_HELPERS: ReadonlyArray<readonly [string, readonly string[], string?]> = [
  ['state-as-value',   ['_mjs_makeDeepProxy'], 'deep'],
  ['deep-call',        ['_mjs_deepCall'], 'deep'],
  ['deep-delete',      ['_mjs_deepDelete'], 'deep'],
  ['longest-run',      ['_mjs_lis']],
  ['copy-listeners',   ['_mjs_evCopy']],
  ['multiple-filters', ['_mjs_filtPut', '_mjs_filtCall']],
  ['write-no-render',  ['_mjs_rawWrite']],
]
// le signal d'une de ces aides : le nom d'un de ses membres écrit où que ce soit dans le texte compilé ENTIER d'une unité — code, chaîne,
// commentaire ou expression régulière. Aucune lecture n'y trie le code du reste : une mention de trop garde l'aide (quelques octets), un
// appel n'est jamais manqué
export const loneHelperSignal = (block: string): string => 'lone_' + block
// une collection que nomme le code d'une unité ou d'un fichier `.js` qu'elle importe — `Map`, `Set`, `WeakMap`, `WeakSet`, lus hors des chaînes et des
// commentaires (cf. scanCollections) : la part des collections de l'état (blocs `<collections>` de mjs_init.ts, mjs_element.ts, mjs_deep.ts, mjs_state.ts,
// mjs_store.ts et mjs_store_globals.ts : clé objet suivie, index des clés, oubli) n'entre au cœur qu'avec ce signal, ou demandée par la clé `runtime`
// (`collections`) ; `WeakMap` ou `WeakSet` nommé : celle des collections faibles en plus (blocs `<weak>` : leur enveloppe dans un composant, le
// carnet qui rend la vraie collection à µraw). Signaux à part, comme BOUCLES : aucun fichier du runtime ne porte ces noms. Relevés par le bundler
// sur le code de chaque unité, module de script et fichier `.js` (scanCollections), jamais par scanCompiledFeatures : nommer une collection n'est pas
// appeler le cœur, et un outil compilé à la volée (atelier de thème, journal d'erreurs) qui en garde une pour lui n'en réclame rien
export const COLLECTIONS      = 'collections'
export const WEAK_COLLECTIONS = 'weak_collections'
// les blocs des types et de µajax que le build ne garde que pour l'appli qui s'en sert (bundler/index.ts, projectBlocks) : la valeur de
// départ d'un champ (`_mjs_z`, que le compilateur écrit dans une règle d'objet), `strict` (`_mjs_tstrict`, une marque que rien d'autre n'écrit), le gestionnaire de l'appli et la
// µTypeError qu'elle nomme (`µtypes.onError`, `µTypeError`), la forme appelable de µajax (`µ._mjs_ajax(`)
export const TYPES_DEFAULTS = 'types_defaults'
export const TYPES_STRICT   = 'types_strict'
export const TYPES_HARD     = 'types_hard'
export const AJAX_CALL      = 'ajax_call'
// un reffet d'avant l'écran (`µeffect.before`, compilé en `µ.effect.before(`) : son enregistrement et son passage avant les blocs et les liaisons
// (blocs balisés `<reffet-before>` de mjs_effect.ts et de mjs_element.ts) n'entrent au cœur de production que si une unité de ce build en écrit
// un ; un reffet au premier niveau du fichier d'un magasin (`µ._mjs_magOpen(`, bundler/index.ts) : le reffet du magasin (`<reffet-store>`
// de mjs_effect.ts), de même. Tout build qui n'est pas de production les garde, comme les valeurs dérivées. Signaux à part, comme BOUCLES
export const EFFECT_BEFORE = 'effect_before'
export const EFFECT_STORE  = 'effect_store'
// la file des reffets du graphe des signaux qui ne sont pas d'un composant, avec leurs propriétaires (blocs balisés `<signal-queue>` de
// mjs_signals.ts : `µ._mjs_sigEffect`, la passe, `µ._mjs_sigRoot`, `µ._mjs_sigDispose`) : au cœur de production seulement si une unité
// de ce build appelle l'un de ces trois ; un reffet de composant n'en a pas besoin (sa passe le mène). Tout autre build la garde
export const SIG_QUEUE     = 'sig_queue'
// la racine des reffets lancés à la demande (`µeffect.root`, compilé en `µ.effect.root(` : blocs `<reffet-root>` de mjs_effect.ts), qui
// n'emmène le reffet d'un magasin que pour une racine sans composant (il en mène les reffets, rootWithoutComponent) ; la fin d'un `µStore` (`magasin.destroy()`, un
// appel `.destroy(`, large : au pire, le bloc gardé pour rien : blocs `<store-fine-grained>` de mjs_store.ts et mjs_effect.ts) ; le gestionnaire
// d'un `<@window>` hors du calcul en cours (`µ._mjs_sigFree(`, transpiler/macros.ts : bloc `<signals-free-handler>` de mjs_signals.ts). Au cœur
// de production seulement si une unité de ce build en écrit un ; tout autre build les garde
export const EFFECT_ROOT   = 'effect_root'
export const STORE_DESTROY = 'store_destroy'
export const SIG_FREE      = 'sig_free'
// les options de `{await}` (generator/compile.ts, compileAwait) : chacune n'entre au cœur de production que si une unité de ce build l'écrit, ses blocs
// balisés de mjs_await.ts (et de mjs_hydrate.ts pour la relecture gardée) retirés sinon — une appli à `{await}` qui n'en écrit aucune reçoit
// le cœur d'avant, à l'octet. `{await.keep …}` : le drapeau posé après les variables de l'expression (`<wait-kept>`) ; `µpending` lu
// dans une branche (`<wait-pending>`) ; `µsignal` lu par l'expression (`<wait-signal>`). Signaux à part, comme BOUCLES
export const AWAIT_KEEP    = 'await_keep'
export const AWAIT_PENDING = 'await_pending'
export const AWAIT_SIGNAL  = 'await_signal'
// une unité écrit 'focus' ou 'online' en clair (la règle `refresh` de µload, ou toute autre chaîne de ce nom) : l'écoute du retour sur l'onglet
// et du réseau (blocs balisés `<load-review>` de mjs_load.ts) n'entre au cœur d'une appli qui appelle µload que si une unité de ce build l'écrit.
// Faux positifs acceptés (le mot écrit pour autre chose) ; une règle fabriquée à l'exécution, sans ce mot dans le code, n'écoute rien. Signal à part,
// comme BOUCLES
export const LOAD_REVIEW = 'load_review'
// une unité écrit `µload.clear` (compilé `µ.load.clear`) : l'oubli de toutes les adresses gardées (blocs balisés `<load-forget>` de mjs_load.ts)
// n'entre au cœur d'une appli qui appelle µload que si une unité de ce build l'écrit ; un nom fabriqué à l'exécution n'y mène pas. Signal à part,
// comme BOUCLES
export const LOAD_FORGOTTEN = 'load_forgotten'

// ---- morceaux du cœur retirés à la construction quand l'appli ne s'en sert pas ----
// une ligne de `{for}` à racine unique : son gabarit se copie par `µ._mjs_cloneEl` (generateCloneFnBody, generator/paths.ts). L'élément du dernier
// gabarit copié, gardé d'un appel au suivant (bloc balisé `<line-copy>` de mjs_init.ts), n'entre au cœur de production qu'avec elle
export const ROW_CLONE = 'row_clone'
const REGEX_ROW_CLONE  = /\._mjs_cloneEl\(/
// `µraw(liste, true)` : le carnet des listes marquées avec leurs lignes, sa lecture par la passe d'un `{for}` et le second argument de µraw (blocs
// `<raw-lines>` de mjs_init.ts, mjs_rare_runes.ts et mjs_for.ts) n'entrent au cœur de production qu'avec ce signal
export const RAW_ROWS = 'raw_rows'
const REGEX_RAW_WORD  = /\braw\b/
// un appel de µraw qui peut porter un second argument, relevé sur l'arbre d'acorn d'un code (unité compilée, fichier `.js` importé). Jamais de faux
// « non » : donnent le signal tout accès à `raw` sur µ (`µ.raw`, `µ?.raw`, `µ['raw']`, `window.µ.raw`) qui n'est pas l'appel direct à un seul
// argument non étalé (µraw passé comme valeur, `call`, `apply`, `bind`), tout appel `x.raw(…)` à plusieurs arguments ou à arguments étalés quel
// que soit `x` (µ sous un autre nom ; `String.raw` mis à part), un motif qui tire `raw` d'un objet (`{ raw } = µ`), et un code qu'acorn ne lit
// pas. Un code sans le mot `raw` n'est pas lu. Hors d'atteinte : µ pris sous un autre nom ET µraw passé comme valeur (`m = µ`, puis `f = m.raw`),
// comme un code que la construction ne lit pas — la clé `runtime` garde alors le bloc (`'all'`, ou `rare_runes` dans la liste)
export function scanRawRows(js: string): string[] {
  const code = unescapeMu(js)
  if (!REGEX_RAW_WORD.test(code)) return []
  const ast = jsTree(readableAssetImports(code))
  if (ast === null) return [RAW_ROWS]
  const isMu            = (o: any): boolean => (o?.type === 'Identifier' && o.name === 'µ') || (o?.type === 'MemberExpression' && keyName(o.property, o.computed) === 'µ')
  const isRaw           = (o: any): boolean => o?.type === 'MemberExpression' && keyName(o.property, o.computed) === 'raw'
  const direct          = new Set<any>()
  const accesses: any[] = []
  let found             = false
  walk.simple(ast, {
    CallExpression(n: any) {
      if (!isRaw(n.callee)) return
      if (n.arguments.length === 1 && n.arguments[0].type !== 'SpreadElement') direct.add(n.callee)
      else if (!(n.callee.object.type === 'Identifier' && n.callee.object.name === 'String')) found = true
    },
    MemberExpression(n: any) {
      if (isRaw(n) && isMu(n.object)) accesses.push(n)
    },
    ObjectPattern(n: any) {
      if (n.properties.some((p: any) => p.type === 'Property' && keyName(p.key, p.computed) === 'raw')) found = true
    },
  })
  return found || accesses.some((n) => !direct.has(n)) ? [RAW_ROWS] : []
}
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
// `@wake` sur la balise d'un composant : l'attribut `mjs-wake` du gabarit compilé
const REGEX_WAKE          = /mjs-wake/
// `@wake=interaction` : sa valeur, entre guillemets simples ou doubles, échappés ou non dans le texte du code compilé
const REGEX_WAKE_INTERACTION = /mjs-wake=\\?['"]interaction/
const REGEX_FIELD_BIND       = /_mjs_bindEvents\(\{[^\n]*?,4\]/
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
// µraw et µsnap appelés, passés comme valeur (`$l.map(µsnap)`) ou appelés par `?.` (`µraw?(x)`, compilé `µ.raw?.(x)`), lus dans le code seul :
// écrits dans une chaîne, un gabarit littéral ou le texte du HTML, ils n'emmènent rien, `${µ.raw(x)}` si (cf. scanCompiledFeatures) ; µimport, appelé
const REGEX_RAW_SNAP      = /µ\s*\??\.\s*(?:raw|snap)(?![\w$])/
const REGEX_RARE_RUNES    = /µ\._mjs_import\(/
// un appel, blancs compris (`µ.inspect ('n')`, retour à la ligne autour du point) et chaînage optionnel, comme `µ.effect` et
// `µ.every` plus bas : la même lecture que le contrat du cœur (core-contract.ts), qui les réclame au cœur
const REGEX_INSPECT       = /µ\s*\??\.\s*inspect\s*\(/
const REGEX_PLAY          = /µ\s*\??\.\s*play\s*\(/
const REGEX_ON            = /_mjs_on\(/
const REGEX_EFFECT        = /µ\s*\??\.\s*effect\s*(?:\.\s*before\s*)?\(/
// un appel, blancs compris (`µ.every (1000, fn)`, retour à la ligne) : la même lecture que le contrat du cœur (core-contract.ts),
// qui refusait le build quand ce relevé ratait l'appel
const REGEX_EVERY         = /µ\s*\??\.\s*(?:every|after)\s*\(/
// de quoi relire l'arbre pour les minuteries (cf. collectTimers), cherché dans le texte remis en clair par unescapeMu : µ
// sous toute écriture (en clair, `\xb5`, octal `\265` hors mode strict ; échappé en `\u`, déjà remis en clair), ou un nom qui
// fait d'un texte du code (cf. TEXT_CODE, et `constructor`)
const REGEX_TIMER_READ = /µ|\\(?:x[bB]5|265)|\b(?:eval|Function|setTimeout|setInterval|constructor)\b/

// `id:` de µafter / µevery et minuterie posée hors de tout composant actif (mjs_every.ts, blocs `<named-timers>` et
// `<page-timers>`) : relevés accès par accès, sur l'arbre d'acorn du code compilé — jamais un `id:` cherché dans le texte
// (une chaîne, une note, une expression régulière n'y comptent pas). Un appel écrit : EVERY_ID quand ses options peuvent
// porter la clé `id` (cf. namedOptions), EVERY_PAGE quand il n'a pas le composant en tête (`_mjsThis`, code compilé d'un
// composant) : module, magasin, fichier `.js`. Tout autre accès : les deux (cf. collectTimers)
export const EVERY_ID   = 'every_id'
export const EVERY_PAGE = 'every_page'

// une fonction écrite (`->`, `=>`, `function`)
const WRITTEN_FUNCTION = /^(?:FunctionExpression|ArrowFunctionExpression)$/

// les options d'un appel (délai, OPTIONS, fonction ; composant de tête déjà retiré) peuvent-elles porter la clé `id` ? À deux
// arguments, le second est la fonction quand c'en est une écrite, ou un nom lié à une fonction et à rien d'autre, déclaré
// dans une portée où l'appel le lit (`µafter 30, tirer`) ; un objet écrit : la clé `id`, ou peut-être (étalement, clé
// calculée) ; tout le reste —
// variable d'un objet, paramètre, appel, condition — peut-être, donc oui : un octet de trop vaut mieux qu'un `id` ignoré en
// production
function namedOptions(args: any[], callback: (a: any) => boolean): boolean {
  if (args.some(a => a.type === 'SpreadElement')) return true
  const o = args[1]
  if (o == null || (args.length < 3 ? callback(o) : WRITTEN_FUNCTION.test(o.type))) return false
  if (o.type !== 'ObjectExpression') return true
  return o.properties.some((p: any) => p.type === 'SpreadElement' || p.computed || (p.key.type === 'Identifier' ? p.key.name : p.key.value) === 'id')
}

// les portées : celle d'un `var` (une fonction, le fichier), puis celle d'un `let`, d'un `const` ou d'une fonction déclarée
// (aussi un bloc, une boucle, un `switch`)
const VAR_SCOPE   = /^(?:Program|FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/
const BLOCK_SCOPE = /^(?:Program|FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|BlockStatement|StaticBlock|SwitchStatement|ForStatement|ForInStatement|ForOfStatement)$/
// ce que traverse un nom lié par un motif (`{ a }`, `[a]`, `...a`, `a = 1`)
const PATTERN       = /^(?:ObjectPattern|ArrayPattern|RestElement|AssignmentPattern|Property)$/
// les objets globaux, nus ou lus sur un autre (`window.self`) ; `defaultView` (`document.defaultView`) sur tout objet :
// `window.eval`, `self.setTimeout` se lisent comme `eval`, `setTimeout`
const GLOBALS     = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames', 'defaultView'])
// ce qui fait d'un texte du code : `eval`, `Function`, un texte donné à `setTimeout` / `setInterval`
const TEXT_CODE  = new Set(['eval', 'Function', 'setTimeout', 'setInterval'])
// à la place de la fonction de `setTimeout` / `setInterval`, ce qui peut en être une : tout le reste peut être un texte
const CALLBACK      = /^(?:FunctionExpression|ArrowFunctionExpression|Identifier|MemberExpression|ChainExpression|CallExpression)$/
// lus sur `setTimeout` / `setInterval`, `.call`, `.apply`, `.bind` peuvent leur donner un texte, quels que soient leurs arguments
const DETOURS     = /^(?:call|apply|bind)$/
// le nom écrit d'une propriété (`.nom`, `['nom']`, `` [`nom`] ``, clé d'un motif ou d'un import), null quand il se calcule
const writtenName = (key: any, computed: boolean): string | null => !computed ? key.name ?? String(key.value) : key.type === 'Literal' && typeof key.value === 'string' ? key.value : key.type === 'TemplateLiteral' && key.expressions.length === 0 ? key.quasis[0].value.cooked : null
// les valeurs que peut rendre une expression, sous son enveloppe : `x?.y`, `(x)`, le dernier terme de `(0, x)`, `await x`, et
// chaque branche de `x || y`, `x ?? y`, `x && y`, `c ? x : y`
function values(n: any): any[] {
  switch (n.type) {
    case 'ChainExpression':
    case 'ParenthesizedExpression': return values(n.expression)
    case 'SequenceExpression':      return values(n.expressions[n.expressions.length - 1])
    case 'AwaitExpression':         return values(n.argument)
    case 'LogicalExpression':       return [...values(n.left), ...values(n.right)]
    case 'ConditionalExpression':   return [...values(n.consequent), ...values(n.alternate)]
    default:                        return [n]
  }
}
// µ lui-même, dans l'une des valeurs : `µ`, `window.µ`, `w['µ']`, `` globalThis[`µ`] ``, `window.µ || {}`, `µ ?? {}`
const hasMu = (n: any): boolean => values(n).some((m: any) => m.type === 'Identifier' ? m.name === 'µ' : m.type === 'MemberExpression' && writtenName(m.property, m.computed) === 'µ')

// chaque mention de µ, relevée sur l'arbre d'acorn du code compilé, où la lettre se lit en clair comme échappée. Le niveau de
// la page et les noms restent hors du cœur seulement si chacune est `µ.<nom>` écrit, `<nom>` autre que `after` / `every`, ou
// un appel écrit (`µ.after(…)`, `µ?.after(…)`, `µ.after?.(…)`) : la page quand il n'a pas le composant en tête, les noms
// quand ses options peuvent porter un `id` (cf. namedOptions). Les autres formes lues font entrer les deux, la construction
// ne sait plus ce qui part : µ lu autrement (crochets, alias, déstructuration, clé `µ` d'un motif à toute profondeur, `.call`,
// `.apply`, `.bind`, µ passé comme valeur, lu sur un objet, nommé par le texte `'µ'`), et le code fait d'un texte : `eval`,
// `Function`, un membre `constructor` appelé, `setTimeout` / `setInterval` appelés avec un texte ou par `.call`, `.apply`,
// `.bind`. Un objet global passé comme valeur ou rangé n'y change rien. Le contrat : ce que la construction ne lit pas (accès
// entièrement calculé comme `window[k]`, code qu'un texte fait exécuter par une autre voie), l'avertissement de développement
// le signale quand l'appel s'exécute.
// Un nom `after` / `every` écrit sous µ — `a = µafter`, `` µ[`after`] ``, `{ after } = µ`, `{ µ: { after } } = window`,
// `{ after } = window.µ || {}`, `typeof µ.after` — fait entrer son module (`every`) ; un accès qui ne le nomme pas (`µ[k]`,
// `m = µ`) ne l'emmène pas, comme les autres modules du cœur
function collectTimers(js: string, used: Set<string>): void {
  // l'import que le compilateur pose en tête (`import { µ } from µ.asset('mjs_core.js')`, résolu par le bundler) est du code du
  // framework, jamais une mention de µ par l'appli : lu comme une chaîne (sortie de transpile() lue hors du bundler)
  const ast = jsTree(readableAssetImports(js))
  // un code qu'acorn ne lit pas : les deux, par prudence
  if (ast === null) {
    used.add(EVERY_PAGE)
    used.add(EVERY_ID)
    return
  }
  // par nom : les portées qui le déclarent, puis ce qu'on lui donne — une fonction écrite (`tirer = ->`, `function tirer`),
  // ou autre chose (paramètre, valeur, boucle, déstructuration, `x++`…) ; `bound` : tout nom que le fichier lie
  const scopes         = new Map<string, any[]>()
  const functions      = new Set<string>()
  const others         = new Set<string>()
  const bound          = new Set<string>()
  const paths: any[][] = []
  // `eval`, `Function`, `setTimeout`, `setInterval` : jugés après la lecture, quand on sait quels noms le fichier lie
  const codes: any[][]  = []
  const patterns: any[][] = []
  let indirect          = false
  let named             = false
  // déclaré dans la portée (`re`) la plus proche au-dessus du rang `i` du chemin
  const declare = (name: string, anc: any[], i: number, re: RegExp): void => {
    let j = i - 1
    while (j > 0 && !re.test(anc[j].type)) j--
    scopes.set(name, [...(scopes.get(name) ?? []), anc[j]])
  }
  // `for (x of …)`, `for (const x in …)` : une valeur de la liste
  const loop = (n: any): void => {
    for (const x of n.left.type === 'VariableDeclaration' ? n.left.declarations.map((d: any) => d.id) : [n.left]) if (x.type === 'Identifier') others.add(x.name)
  }
  // un objet global, dans l'une des valeurs (`window || self`) : son nom nu, que le fichier ne lie pas, ou lu sur un autre
  // (`window.self`) ; `defaultView` sur tout objet
  const global = (n: any): boolean => values(n).some((m: any) => {
    const name = m.type === 'MemberExpression' ? writtenName(m.property, m.computed) : null
    return m.type === 'Identifier' ? GLOBALS.has(m.name) && !bound.has(m.name) : name === 'defaultView' || (name !== null && GLOBALS.has(name) && global(m.object))
  })
  // le motif de rang `i` du chemin tient-il µ ? `{ after } = µ`, ou sous une clé `µ` (`{ µ: { after } } = window`)
  const held = (anc: any[], i: number): boolean => {
    const n = anc[i]
    const p = anc[i - 1]
    if (p.type === 'VariableDeclarator' && p.id === n) return p.init != null && hasMu(p.init)
    if ((p.type === 'AssignmentExpression' || p.type === 'AssignmentPattern') && p.left === n) return hasMu(p.right) || (p.type === 'AssignmentPattern' && i > 1 && held(anc, i - 1))
    if (p.type !== 'ObjectPattern') return false
    const q = p.properties.find((x: any) => x.value === n)
    return q != null && writtenName(q.key, q.computed) === 'µ'
  }
  const visitors: Record<string, (n: any, st: unknown, anc: any[]) => void> = {
    // un nom lié, déclaré (`var`, `let`, `const`, paramètre, fonction, classe, `catch`) ou affecté
    VariablePattern(n, _st, anc) {
      bound.add(n.name)
      let i = anc.length - 2
      while (i > 0 && PATTERN.test(anc[i].type)) i--
      const p     = anc[i]
      const alone = i === anc.length - 2
      // `var tirer;` seul (CoffeeScript déclare en tête) ne donne rien ; `var tirer = ->` donne une fonction
      if (alone && p.type === 'VariableDeclarator' && (p.init == null || WRITTEN_FUNCTION.test(p.init.type))) {
        if (p.init != null) functions.add(n.name)
        declare(n.name, anc, i - 1, anc[i - 1].kind === 'var' ? VAR_SCOPE : BLOCK_SCOPE)
      }
      else if (p.id === n && p.type === 'FunctionDeclaration') {
        functions.add(n.name)
        declare(n.name, anc, i, BLOCK_SCOPE)
      }
      // le nom d'une fonction écrite ne vaut qu'en elle
      else if (p.id === n && p.type === 'FunctionExpression') {
        functions.add(n.name)
        declare(n.name, anc, i + 1, VAR_SCOPE)
      }
      else if (alone && p.type === 'AssignmentExpression' && p.operator === '=' && WRITTEN_FUNCTION.test(p.right.type)) functions.add(n.name)
      else others.add(n.name)
    },
    UpdateExpression(n) {
      if (n.argument.type === 'Identifier') others.add(n.argument.name)
    },
    ForInStatement: loop,
    ForOfStatement: loop,
    // µ : sûr en `µ.<nom>` écrit seulement (`after` / `every` : cf. MemberExpression) ; `eval`, `setTimeout`… : plus bas
    Identifier(n, _st, anc) {
      const p = anc[anc.length - 2]
      if (n.name === 'µ') {
        if (!(p.type === 'MemberExpression' && p.object === n && !p.computed)) indirect = true
      }
      else if (TEXT_CODE.has(n.name)) codes.push(anc.slice())
    },
    // µ nommé par un texte : `Reflect.get(globalThis, 'µ')`, `'µ' in window`, `` [`µ`] ``
    Literal(n) {
      if (n.value === 'µ') indirect = true
    },
    TemplateLiteral(n) {
      if (writtenName(n, true) === 'µ') indirect = true
    },
    MemberExpression(n, _st, anc) {
      const name = writtenName(n.property, n.computed)
      // µ lu sur un objet : `window.µ`, `globalThis['µ']`, `w.µ`
      if (name === 'µ') indirect = true
      else if ((name === 'after' || name === 'every') && hasMu(n.object)) {
        named   = true
        const p = anc[anc.length - 2]
        if (!n.computed && n.object.type === 'Identifier' && p.type === 'CallExpression' && p.callee === n) paths.push(anc.slice(0, -1))
        else indirect = true
      }
      else if (name !== null && TEXT_CODE.has(name)) codes.push(anc.slice())
    },
    // un membre `constructor` appelé (`Function.prototype.constructor('…')`, `(() => 1).constructor('…')`) : peut-être le
    // constructeur des fonctions, qui fait d'un texte du code
    CallExpression(n) {
      if (values(n.callee).some((c: any) => c.type === 'MemberExpression' && writtenName(c.property, c.computed) === 'constructor')) indirect = true
    },
    ObjectPattern(_n, _st, anc) {
      patterns.push(anc.slice())
    },
    // µ sous un autre nom : `import { µ as m }`, `export { µ as m }`
    ImportSpecifier(n) {
      if (writtenName(n.imported, false) === 'µ' && n.local.name !== 'µ') indirect = true
    },
    ExportNamedDeclaration(n) {
      for (const s of n.specifiers ?? []) if (writtenName(s.local, false) === 'µ' && writtenName(s.exported, false) !== 'µ') indirect = true
    },
  }
  walk.ancestor(ast, visitors)
  // les clés d'un motif : `µ` à toute profondeur ; `after` / `every` d'un motif qui tient µ
  for (const anc of patterns) {
    const mu = held(anc, anc.length - 1)
    for (const q of anc[anc.length - 1].properties) {
      const key = q.type === 'Property' ? writtenName(q.key, q.computed) : null
      if (key === 'µ') indirect = true
      if (mu && (key === 'after' || key === 'every')) {
        named    = true
        indirect = true
      }
    }
  }
  // `eval`, `Function` : sûrs lus sans partir (`typeof eval`, `Function.prototype`) ; `setTimeout` / `setInterval` appelés :
  // avec ce qui peut être une fonction (cf. RAPPEL), lus sans partir sinon, hors de `.call`, `.apply`, `.bind` (cf. DETOURS)
  for (const anc of codes) {
    const g    = anc[anc.length - 1]
    const p    = anc[anc.length - 2]
    const name = g.type === 'Identifier' ? g.name : writtenName(g.property, g.computed)
    // un nom que le fichier lie, ou lu sur ce qui n'est pas un objet global (`vm.eval`)
    if (g.type === 'Identifier' ? bound.has(name) : !global(g.object)) continue
    const timer = name === 'setTimeout' || name === 'setInterval'
    if (timer && p.type === 'CallExpression' && p.callee === g) {
      if (p.arguments.length > 0 && !CALLBACK.test(p.arguments[0].type)) indirect = true
    }
    else if (timer && p.type === 'MemberExpression' && p.object === g && DETOURS.test(writtenName(p.property, p.computed) ?? '')) indirect = true
    else if (opaqueRead(anc)) indirect = true
  }
  if (named) used.add('every')
  if (indirect) {
    used.add(EVERY_PAGE)
    used.add(EVERY_ID)
    return
  }
  for (const path of paths) {
    let args = path[path.length - 1].arguments
    if (args[0]?.type === 'Identifier' && args[0].name === '_mjsThis') args = args.slice(1)
    else used.add(EVERY_PAGE)
    // un nom est la fonction s'il n'est lié qu'à des fonctions, et déclaré dans une portée où l'appel le lit
    const callback = (a: any): boolean => WRITTEN_FUNCTION.test(a.type) || (a.type === 'Identifier' && functions.has(a.name) && !others.has(a.name) && (scopes.get(a.name) ?? []).some(p => path.includes(p)))
    if (namedOptions(args, callback)) used.add(EVERY_ID)
  }
}

// un fichier `.js` importé (`@import`, `µimport`, ses voisins) part tel quel, jamais compilé : ses µ.every / µ.after n'ont
// jamais le composant en tête (hors composant : la page) et se lisent comme ailleurs — relevés à part (cf. bundler,
// jsSignals) : le module des minuteries avec un nom `after` / `every` écrit sous µ ; hors des formes sûres (cf.
// collectTimers), la page et les noms. Rien à relire sans aucune écriture de µ ni nom qui fait d'un texte du code (cf.
// REGEX_TIMER_READ)
export function scanJsTimers(js: string): string[] {
  const text = unescapeMu(js)
  if (!REGEX_TIMER_READ.test(text)) return []
  const used = new Set<string>()
  if (REGEX_EVERY.test(maskStringLiterals(js))) used.add('every')
  collectTimers(js, used)
  return [...used]
}
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
// <@slot>, contenu passé à un enfant, partiel <@include>. Dans un {for}, une branche ou une liaison
// `@html`, la ligne émise appelle `µ._mjs_rawHtml(nœud, html)`, du même fichier : l'un ou l'autre
// appel suffit.
const REGEX_HTML = /\._mjs_(?:updHtml|rawHtml)\(/
// slots indexés (mjs_slots.ts) : `this._mjs_injectSlots();` n'est émis dans le constructeur compilé
// que si le composant écrit `<@slot` (partiel <@include> compris, inliné avant ce test —
// transpiler/index.ts, `hasDynamicSlots`) ; sans lui, la méthode n'avait rien à faire.
const REGEX_SLOTS = /\._mjs_injectSlots\(/
// mutations PROFONDES (mjs_deep.ts) : les quatre appels que le suiveur de chemins
// (generator/path-tracker.ts) émet LITTÉRALEMENT —
// `µ._mjs_deepSet(` pour `$o.x = v`, `µ._mjs_deepCall(` pour `$liste.push(v)`, `µ._mjs_deepDelete(` pour
// `delete $o.x`, `µ._mjs_makeDeepProxy(` au point de fuite d'un chemin ; les aides gardées d'une écriture par un objet que le
// suiveur ne compile pas (`µ._mjs_deepSetOn(`…, réglage `proxy: false`) et du premier argument d'`Object.assign` & co. pris dans
// l'état ou le magasin (`µ._mjs_deepSafe(`), de la clé calculée de leur chaîne (`µ._mjs_deepKey(`) et de celle d'un motif
// (`µ._mjs_deepName(`), la valeur de `sort` & co. relue par l'enveloppe en tête d'une écriture (`µ._mjs_deepSame(`). Le symbole est cherché
// SANS son objet (`µ`/`mjs` selon la config du projet), comme pour `_mjs_updHtml` plus haut.
const REGEX_DEEP = /\._mjs_deep(?:Set|Call|Delete)(?:On)?\(|\._mjs_deep(?:Safe|Key|Name|Same)\(|\._mjs_makeDeepProxy\(/
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
// une balise form écrite par l'application (le gabarit compilé, ou une création par le code) : les réponses du serveur rangées par
// formulaire (mjs_form_answers.ts) n'entrent qu'avec elle — une application sans formulaire n'en paie rien
const REGEX_FORM_TAG = /<form\b|createElement\(\s*['"]form['"]/i
// un lecteur de ces réponses : `µ._mjs_formView`, que <@@field> écrit (l'objet formulaire, mjs_form.ts, se détecte à part) ; une case, un
// nombre ou un éditeur du cœur ne les lisent pas
const REGEX_FORM_VIEW = /\._mjs_formView\b/
// le socle des composants associés au formulaire (mjs_form_associated.ts) : `µ._mjs_formClass(` que le compilateur écrit dans le fichier d'un
// composant qui déclare `@formAssociated` (un module de saisie du cœur, un composant de l'application), juste avant l'enregistrement de sa balise ;
// le préfixe `_mjs_` est réservé au framework : un projet sans composant déclaré n'en cite aucun et ne paie pas le fichier
const REGEX_FORM_ASSOCIATED = /\._mjs_formClass\(/
// la liaison d'une <@@select> à une variable de règle (mjs_types_select.ts) : `µ._mjs_tpick(` et `µ._mjs_tshow(`, que le compilateur
// n'écrit que pour une <@@select> dont `value=!{$x}` lie une variable de règle (generator/attributes/index.ts) ; le préfixe `_mjs_` est
// réservé au framework : une appli dont les listes du cœur sont liées à des variables libres n'en cite aucun et ne paie pas le fichier
const REGEX_TYPES_SELECT = /\._mjs_t(?:pick|show)\(/
// la réponse d'un appel µajax contrôlée par une règle nommée (mjs_types_ajax.ts) : `µ._mjs_tajax(`, que le compilateur n'écrit que pour
// un `type: Reward[]` dans un appel µajax (transpiler/var-types.ts) ; une appli qui n'en écrit aucun ne paie pas le fichier
const REGEX_TYPES_AJAX     = /\._mjs_tajax\(/
const REGEX_TYPES_DEFAULTS = /\b_mjs_z\s*:/
const REGEX_TYPES_STRICT   = /\b_mjs_tstrict\s*:/
const REGEX_TYPES_HARD     = /(?:µ|mjs)\.(?:types\.onError|TypeError)\b/
const REGEX_AJAX_CALL      = /\._mjs_ajax(?![\w$])/
const REGEX_DEEP_GUARD     = /\._mjs_deep(?:Set|Call|Delete)On\(|\._mjs_deep(?:Safe|Key|Name|Same)\(/
const REGEX_STORE_GUARD    = /\._mjs_storeSafe\(/
const REGEX_STORE_KEY      = /\._mjs_keyStore\(/
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
// le magasin qui se charge seul (mjs_load.ts) : la rune `µload(url)` compile en `µ.load(url)` — cherchée AVEC son objet, blancs et chaînage
// optionnel compris (`µ?.load`), comme `µ.Store` : le mot seul est partout (`addEventListener('load')`, `img.onload`), et `µ.Autoloader?.load`
// du code émis ne suit pas `µ` directement. Seul un nom fabriqué à l'exécution échappe (`runtime: ['load']`)
const REGEX_LOAD = /µ\s*\??\.\s*load\b/
// valeur dérivée qui attend (mjs_await_derived.ts) : le compilateur l'écrit `µ._mjs_setAwait(` (transpiler/await-derived.ts)
const REGEX_AWAIT_DERIVED = /µ\._mjs_setAwait\(/
// la ligne d'instance d'un module à plusieurs sections de traduction : `_mjs_i18n = ["accueil",null,["onglets"]]` (3e élément, les sections en plus) ;
// le mode (2e élément) peut être un effet d'attente, `"*loader"` : toute chaîne y est lue
const REGEX_I18N_PACKS  = /\b_mjs_i18n = \["[a-z0-9_-]+",(?:null|"[^"]*"),\[/
// l'appli se sert de la traduction : un appel qui lève une erreur sans le module (`µt(…)` compilé en `µ.t(`, ou `µ?.t(` ; MU_T_CALL_STRICT_RE
// de sigils.ts ; composant ou module de script) ou la ligne d'instance d'un `@i18n` (jamais celle d'un module sans section, `[null,…]`,
// posée pour ses seuls appels) ; un `runtime` sans 'i18n' est alors refusé. `µt?.(…)`, `µ.t?.(…)` et `µ?.t?.(…)` rendent `undefined` sans
// le module, sans erreur : pas de refus. Faux positifs acceptés (le mot dans un texte), jamais de faux négatif
const REGEX_I18N_USED   = new RegExp(`${MU_T_CALL_STRICT_RE.source}|\\b_mjs_i18n\\b(?! = \\[null,)`, 'u')
// l'attente de ce module est l'indicateur de chargement : `_mjs_i18n = ["accueil","*loader",null,{"style":"bloom"}]` (ou sans section, `[null,"*loader"]`)
const REGEX_I18N_LOADER = /\b_mjs_i18n = \[(?:null|"[a-z0-9_-]+"),"\*loader"/
const REGEX_TYPES =/\._mjs_types = |\._mjs_storeTypes\(/
// les règles du bloc <vars> en schémas standard (mjs_rules.ts) : la rune `µrules(@)`, compilée en `µ.rules(this)` — `rules` lu sur l'objet
// du cœur, `µ` (écrit tel quel ; échappé en `\u00b5` ou `\u{b5}`, déjà remis en clair par unescapeMu) ou `mjs` selon la config du projet,
// chaînage optionnel et espaces compris, sans parenthèse (`const f = µ.rules` appelle aussi). Cherché dans le code seul (maskStringLiterals :
// chaînes, texte des gabarits, expressions régulières et commentaires blanchis, le code des `${…}` gardé) : aucun texte (« Lisez
// mjs.rules »), aucune clé de traduction (`'mjs.rules.required'`), aucun commentaire, aucun autre objet (`config.rules`, `jeu.rules`),
// aucun `mjs` ni `µ` qui est lui-même le champ d'un objet (`opts.mjs.rules`, `cfg?.µ.rules` ; une décomposition `...µ.rules` compte),
// aucune classe CSS (`.rules`) ne le réclame ; un nom fabriqué à l'exécution (`{ rules } = µ`) se demande par `runtime: ['rules']`. Le
// fichier entraîne celui des types (bundler/index.ts) : un composant sans <vars> n'a que des règles vides
const REGEX_RULES = /(?<![\w$\u00b5\\])(?<!(?<!\.\.)\.\s*)(?:µ|mjs)\s*\??\.\s*rules(?![\w$\u00b5])/
// l'objet formulaire d'un composant (mjs_form.ts) : la rune `µform(@)`, compilée en `µ.form(this)` — `form` lu sur l'objet du cœur, cherché
// comme `rules` juste au-dessus (code seul, `µ` ou `mjs`, jamais le champ d'un autre objet) : ni le formulaire d'un champ (`input.form`),
// ni un autre nom du cœur (`µ._mjs_formReset`, `µ._mjs_formErr` que lit <@@field>) ne le réclament. Le fichier entraîne les règles, le
// contrôle des types et l'état réactif (bundler/index.ts)
// la lecture du sac des réponses (RES_READ) : `µ.res` ou `µ?.res` dans le code, jamais `µ.result`, le `res` d'un autre objet, ni une
// mention dans une chaîne ou un commentaire
const REGEX_RES = /(?<![\w$\u00b5\\.])µ\s*\??\.\s*res(?![\w$\u00b5])/
const REGEX_FORM = /(?<![\w$\u00b5\\])(?<!(?<!\.\.)\.\s*)(?:µ|mjs)\s*\??\.\s*form(?![\w$\u00b5])/
// l'ouverture de l'enveloppe d'une boucle qui écrit l'état, cherchée sans son objet (`µ`/`mjs` selon la config du projet)
const REGEX_LOOPS = /\._mjs_lq\+\+;\s*try\s*\{/
// la table de la mise à jour fine posée dans `init`, cherchée sans son receveur
const REGEX_FINE = /\._mjs_fine = \{/
// un objet du magasin ou d'un état de module qui peut finir dans une variable `$` (cf. STORE_HELD), cherché sans son objet (`µ`/`mjs`
// selon la config du projet) : dans l'affectation d'une variable ou d'une prop (`_set`, ou `µ._mjs_prop` qui la livre à un enfant) ; rangé dans un nom, hors des variables de travail
// d'une écriture compilée (`_mjs_ra_0 = µ.store.m` ; `_mjs_n = µ.store.c` d'un `++` / `--`, qui n'y prend que l'ancienne valeur,
// convertie en nombre) et de la déclaration d'un état de module ; rendu par une fonction, hors de
// l'affectation qu'elle rend (`return µ_state.l[0].nom = v`) ; par une flèche ; parcouru, étalé ; passé à une fonction de l'appli,
// pas à une aide du cœur (`_mjs_…`, `µ.…`), à une conversion (`String(…)`) ni à un mot du langage. Puis la liste d'un `{for}` du
// magasin ou d'un état de module, avec une prop posée sur un composant dans la même unité ou une ligne gardée par son gestionnaire.
// Une lecture dont la valeur est simple n'en est pas : longueur au bout du chemin (`µ.store.m.length`), opérande d'un calcul, d'une
// comparaison, premier opérande d'un `&&`, condition d'un `?`, négation, `typeof`, texte d'un gabarit littéral, langue et thème du framework
// (`µlang`, `µtheme` : des chaînes) ; ni une copie étalée en tête d'un littéral (`[...µ.store.m, x]`, `{...µ.store.o}` : un objet
// neuf, que le carnet ne suivrait pas). Le reste d'une lecture étalée (`f(...µ.store.m)`, `[x, ...µ.store.m]`) en est
const READ_PATH    = String.raw`(?:\??\.[\w$]+|\[[^\]\n]*\])*`
const SIMPLE_VALUE = String.raw`(?!` + READ_PATH + String.raw`(?:\??\.length\b(?![\w$]|\s*(?:\??\.|\[|\())|\s*(?:\*\*?|[-+%]|\/(?![/*])|[<>]=?|[!=]==?|&&|\?(?![?.]))(?![=>])))`
// des appels en tête de la lecture (`Object.values(µ.store.o)`, `Array.from(µ.store.m)`), hors conversion et texte (`String`, `JSON.stringify`,
// `Object.keys`…) : ce qu'ils rendent peut porter les objets lus
const LEADING_CALLS       = String.raw`(?:(?!(?:String|Number|Boolean|parseInt|parseFloat|isNaN|isFinite|JSON\.stringify|Object\.keys)\()[A-Za-z_$][\w$.]*\(\s*)*`
// l'appel d'une fonction de l'appli, jusqu'à sa parenthèse : ni une aide du cœur, ni une conversion, ni un mot du langage
const APP_CALL         = String.raw`(?<![\w$.])(?!_mjs_|µ|mjs\b|(?:if|while|for|switch|return|typeof|void|catch|function|String|Number|Boolean|parseInt|parseFloat|isNaN|isFinite)\b)[A-Za-z_$][\w$]*\(\s*`
const KEPT_SOURCE      = String.raw`(?<!(?:[-+%<]|[^*/]\/|[^/*]\*|[^=]>|[<>!=]=|typeof|!|\$\{|[\[{]\s*\.\.\.)\s*)(?:µ|mjs)(?:\.store\b(?!\.__mjs(?:Lang|Theme)\b)|_state(?=\.))` + SIMPLE_VALUE
const REGEX_STORE_HELD = new RegExp([
  String.raw`\b(?:_set|_mjs_prop)\([^;\n]*?(?:` + KEPT_SOURCE + String.raw`|[(,\s]\$[A-Za-z_])`,
  String.raw`(?<![=!<>]|_mjs_ra_\d+ |(?<![\w$])_mjs_n |export var \$[\w$]+ )=\s*` + LEADING_CALLS + KEPT_SOURCE,
  String.raw`\breturn\s+` + LEADING_CALLS + String.raw`(?:` + KEPT_SOURCE + String.raw`|\$[A-Za-z_])(?![^;\n]*?[^=!<>]=(?![=>]))`,
  String.raw`=>\s*\(*\s*` + LEADING_CALLS + KEPT_SOURCE,
  String.raw`(?:\bof\s+|\.\.\.)` + KEPT_SOURCE,
  APP_CALL + String.raw`(?:[^()]*?,\s*)?` + KEPT_SOURCE
].join('|'))
const REGEX_STORE_ROWS     = new RegExp(String.raw`\._mjs_updFor\('[^']*', ` + LEADING_CALLS + String.raw`(?:(?:µ|mjs)(?:\.store\b|_state\.)|\$[A-Za-z_])`)
// la ligne d'un `{for}` que son gestionnaire garde (`@click={$sel = r}`, `@click={choisir(r)}`) : le nom de la ligne (`let r =
// _mjs_ra_0[_mjs_ri_0]`), passé à `_set`, livré en prop (`µ._mjs_prop`) ou passé à une fonction de l'appli
const REGEX_NAMED_ROW   = /\blet ([\w$]+) = _mjs_ra_\d+\[_mjs_ri_\d+\]/g
function holdsRow(js: string): boolean {
  const names = new Set(Array.from(js.matchAll(REGEX_NAMED_ROW), (m) => m[1].replace(/\$/g, '\\$')))
  for (const name of names) {
    if (new RegExp(String.raw`(?:\b(?:_set|_mjs_prop)\([^;\n]*?|` + APP_CALL + String.raw`(?:[^()\n]*?,\s*)?)(?<![\w$.])` + name + String.raw`(?![\w$])`).test(js)) return true
  }
  return false
}
// la prop d'un composant enfant : sa pose directe, ou la livraison par le parent (`µ._mjs_prop(_mjs_node, 'item', …)`, componentLogic)
const REGEX_COMPONENT_PROP = /\._set\('|\._mjs_prop\([\w$]+, '/
// la marque des composants d'une ligne peuplée après son insertion, cherchée sans son objet (`µ`/`mjs` selon la config du projet), appel
// facultatif compris (`?.(`)
const REGEX_RETAINED_WAKES = /\._mjs_waitRow(?:\?\.)?\(/
const REGEX_ATTACH_KEEP    = /\._mjs_attKeep\(/
const REGEX_ROUTES_IDLE    = /\._mjs_routesIdle\?\.\(/
const REGEX_CHILD_PROPS    = /\b_mjs_kb\b/
const REGEX_PRELOAD_LINK   = /data-mjs-preload/
// la passe d'une ligne à liaison filtrée, toujours émise avec elle ; la balise de `<@view>` sous toutes ses formes (gabarit cloné, création
// impérative) ; un appel des aides natives, cherché sans son objet (`µ`/`mjs` selon la config du projet). Faux positifs acceptés
const REGEX_FILTERED_BINDINGS = /\b_mjs_filtIdxKeys\b/
// l'effet d'entrée ou de sortie posé sur la balise par le code émis pour `:in`, `:out` et `:transition`, jamais une lecture
const REGEX_TRANSITION_DIRECTIVES = /\._mjs_(?:intro|outro)\s*=(?!=)/
const REGEX_VIEW_TAG          = /metamjs-view/
const REGEX_NATIVE_HELPERS    = /\._mjs_(?:matches|animate)\(/
const REGEX_SPREAD_CLASS      = /\._mjs_sp(?:Cls|Wc)\(/
const REGEX_SPREAD_TAG_CLASS  = /\._mjs_spCls\(/
const REGEX_SPREAD_COMPONENT  = /\._mjs_spWc\(/
const REGEX_GLOBAL_ATTR_COMP  = /\._mjs_attrGlob\(/
// le nom de chaque aide d'écriture, cherché sans son objet (`µ`/`mjs` selon la config du projet, `this`, une ligne de liste), appel ou valeur
// prise : faux positifs acceptés (le nom dans un texte), jamais de faux négatif
const REGEX_ATTR_UPDATE   = /_mjs_updAttr/
const REGEX_ATTR_SELECT   = /_mjs_(?:selVal|tsel)\b/
const REGEX_PROPS_PENDING = /_mjs_pend\b/
const REGEX_ATTR_FILTER   = /_mjs_(?:safeAttr|isExecUrlAttr|URL_ATTRS|DANGER_SCHEMES|ctrlCharRe|schemeRe)\b/
const REGEX_ROOT_TEXT     = /_mjs_updText\b/
// l'appel de chaque partie de mjs_dynamic.ts, cherché sans son objet (`µ`/`mjs` selon la config du projet) : jamais plus étroit que le signal du
// module (`dynamic`), la partie appelée ne manque donc jamais au module embarqué
const REGEX_DYNAMIC_ELEMENT = /\._updDynEl\(/
const REGEX_DYNAMIC_MODULE  = /\._updModule\(/
// l'installation d'une valeur dérivée, cherchée sans son objet (`µ`/`mjs` selon la config du projet)
const REGEX_DERIVED_VALUES = /\._mjs_setComputed\(/
const REGEX_DERIVED_CHOICE = /\._mjs_computedSrc = /
const REGEX_SIG_READS      = /\._mjs_sigRead\(/
const REGEX_REFRESH_RUNE   = /\._mjs_(?:refresh|storeRefresh)\(/
const REGEX_STATE_ALIAS    = /\._mjs_otherNames = /
const REGEX_LAYOUT_VAR     = /\._mjs_var_bits = \{[^}]*"(?:layout|template)":/
const REGEX_ATTACHMENTS    = /\._mjs_attachments\b/
// [signal, nom d'un des membres de l'aide, entier (`_mjs_lis` n'est pas `_mjs_liste`) et où qu'il soit]
const LONE_HELPER_NAMES: ReadonlyArray<readonly [string, RegExp]> = LONE_HELPERS.map(([block, members]) => [loneHelperSignal(block), new RegExp(`(?:${members.join('|')})(?![\\w$])`)])
// le nom d'une collection, écrit seul (`new Map()`, `instanceof Set`, `globalThis.WeakMap`) ; faux positifs acceptés (`cartes.Map`)
const REGEX_COLLECTIONS      = /(?<![\w$])(?:Weak)?(?:Map|Set)(?![\w$])/
const REGEX_WEAK_COLLECTIONS = /(?<![\w$])Weak(?:Map|Set)(?![\w$])/
// les collections que le code du compilateur fabrique pour ses propres champs (`static _mjs_evt_ids = new Set([…])`, `_mjs_binds ??= new Set()`,
// `_mjs_attachments || new Set()`, `__fe.idx = new Map()`) : jamais rangées dans l'état, elles ne comptent pas
const REGEX_COLLECTIONS_INTERNAL = /(?:_mjs_\w+|__fe\.idx)\s*(?:\?\?=|\|\|=|=|\|\||\?\?)\s*new (?:Weak)?(?:Map|Set)\(/g
// cherchés sans leur objet (`µ`/`mjs` selon la config du projet) ; faux positifs acceptés
const REGEX_EFFECT_BEFORE = /\.\s*effect\s*\.\s*before\s*\(/
const REGEX_EFFECT_STORE  = /\._mjs_magOpen\(/
const REGEX_SIG_QUEUE     = /\._mjs_sig(?:Effect|Root|Dispose)\(/
const REGEX_EFFECT_ROOT   = /\.\s*effect\s*\.\s*root\s*\(/
const REGEX_STORE_DESTROY = /\.\s*destroy\s*\(/
const REGEX_SIG_FREE      = /\._mjs_sigFree\(/

// une racine sans composant : un appel `µ.effect.root(fn)` à un seul argument (dans le `<script>` d'un composant et dans les gestionnaires
// de son gabarit, le compilateur passe le composant en second, generator/effect-deps.ts), écrit dans un module ou un `<script module>` ;
// ses reffets sont menés comme ceux d'un module. Un code qu'acorn ne lit pas compte comme tel : au pire, le bloc gardé pour rien
function rootWithoutComponent(js: string): boolean {
  let ast: acorn.Node
  try {
    ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return true
  }
  let without = false
  walk.simple(ast, {
    CallExpression(n: any) {
      const c = n.callee
      if (c?.type === 'MemberExpression' && !c.computed && c.property?.name === 'root' && c.object?.type === 'MemberExpression' && !c.object.computed && c.object.property?.name === 'effect' && n.arguments.length < 2) without = true
    },
  })
  return without
}
// nom d'une clé écrite : `effect` (`m.effect`, `{ effect }`), entre crochets (`m['effect']`, gabarit sans expression compris) ; null pour
// une clé calculée
function keyName(key: any, computed: boolean): string | null {
  if (key?.type === 'Identifier' && !computed) return key.name
  if (key?.type === 'Literal' && typeof key.value === 'string') return key.value
  if (key?.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0].value.cooked
  return null
}
// le reffet appelé dans un `.js`, lu sur son arbre (le code seul) : µ y arrive de son appelant, sous le nom qu'il veut — `m.effect(…)`,
// `m['effect'](…)`, `m.effect?.(…)`, ou pris par une destructuration (`const { effect } = m`, `({ effect }) => …`). Pas un appel dont le
// premier argument est une chaîne ou un objet écrit : la signature de jQuery UI (`$(el).effect('shake', …)`, `.effect({ effect: 'fade' })`),
// celui de µ reçoit une fonction. Sa racine et son reffet d'avant l'écran, pris de même (`m['effect'].root(…)`, `m.effect?.root(…)`,
// `m.effect.root?.(…)`, `effect.before(…)` après la destructuration) : `root` (`rootSingleArg` : un seul argument, sans composant) et
// `avant`. null : un code qu'acorn ne lit pas, cherché dans le code masqué (`REGEX_EFFECT_CALL`, chaînes blanchies guillemets compris),
// même règle
const REGEX_EFFECT_CALL = /\.\s*effect\s*\(\s*(?![\s,){'"`])/
function jsReffets(js: string): { call: boolean, root: boolean, rootSingleArg: boolean, before: boolean } | null {
  let ast: any = null
  for (const sourceType of ['module', 'script'] as const) {
    try {
      ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType })
      break
    }
    catch {
      // pas un module : relu en script ; ni l'un ni l'autre : la règle du texte (scanJsReffets)
    }
  }
  if (ast === null) return null
  const read = { call: false, root: false, rootSingleArg: false, before: false }
  // noms locaux du reffet pris par une destructuration (`const { effect } = m`, `{ effect: suivre }`, `{ effect = f }`)
  const names = new Set<string>()
  walk.simple(ast, {
    ObjectPattern(n: any) {
      for (const p of n.properties) {
        if (p.type !== 'Property' || keyName(p.key, p.computed) !== 'effect') continue
        read.call = true
        const v = p.value?.type === 'AssignmentPattern' ? p.value.left : p.value
        if (v?.type === 'Identifier') names.add(v.name)
      }
    },
  })
  // le reffet lui-même : `m.effect`, `m['effect']`, ou un nom pris par la destructuration
  const isReffet = (o: any): boolean => (o?.type === 'MemberExpression' && keyName(o.property, o.computed) === 'effect') || (o?.type === 'Identifier' && names.has(o.name))
  walk.simple(ast, {
    CallExpression(n: any) {
      const c = n.callee
      const a = n.arguments[0]
      if (c?.type !== 'MemberExpression') return
      const key = keyName(c.property, c.computed)
      if (key === 'effect' && !(a?.type === 'Literal' && typeof a.value === 'string') && a?.type !== 'TemplateLiteral' && a?.type !== 'ObjectExpression') read.call = true
      else if ((key === 'root' || key === 'before') && isReffet(c.object)) {
        read.call = true
        if (key === 'before') read.before = true
        else {
          read.root = true
          if (n.arguments.length < 2) read.rootSingleArg = true
        }
      }
    },
  })
  return read
}
// les collections que nomme un code (sortie compilée d'une unité, fichier `.js` importé tel quel) : COLLECTIONS, et WEAK_COLLECTIONS pour `WeakMap` ou
// `WeakSet`. Lu sur le code seul (maskStringLiterals) : un texte affiché (`'Set de table'`), un commentaire n'emmènent rien, ni les collections que
// le compilateur range dans ses propres champs (cf. REGEX_COLLECTIONS_INTERNAL) ; le masque, qui lit tout le code, n'est fait que pour celui qui
// porte un de ces noms hors de ces champs et de ses lignes de commentaire. Jamais de faux négatif pour un code lu : une collection venue d'un code que
// la construction ne lit pas (bibliothèque chargée à part) se demande par la clé `runtime`
export function scanCollections(js: string): string[] {
  const withoutInternal = (text: string): string => text.replace(REGEX_COLLECTIONS_INTERNAL, '')
  if (!REGEX_COLLECTIONS.test(withoutInternal(js).replace(/^[ \t]*\/\/.*$/gm, ''))) return []
  const code = withoutInternal(maskStringLiterals(js))
  if (!REGEX_COLLECTIONS.test(code)) return []
  return REGEX_WEAK_COLLECTIONS.test(code) ? [COLLECTIONS, WEAK_COLLECTIONS] : [COLLECTIONS]
}
// un fichier `.js` importé (`@import`, `µimport`, ses voisins) part tel quel, jamais compilé : ses reffets sont relevés à part (cf.
// bundler, jsSignals), comme ceux d'une unité compilée — le module des reffets, le reffet d'avant l'écran, la racine. Sa racine n'a pas
// de composant (le compilateur ne le passe qu'à celles d'un composant) : elle emmène la mécanique des reffets de module, sans
// quoi elle casserait en production quand les autres racines de l'appli sont toutes dans des composants. Lu sur le code seul
// (maskStringLiterals, s) : une racine citée dans un commentaire ou une chaîne n'emmène rien. Faux positifs acceptés (un
// `.effect(fn)` qui n'est pas celui de µ)
export function scanJsReffets(js: string): string[] {
  if (!js.includes('effect')) return []
  const code = maskStringLiterals(js)
  const read = jsReffets(js)
  const used = new Set<string>()
  if (REGEX_EFFECT_BEFORE.test(code) || read?.before) used.add(EFFECT_BEFORE)
  if (REGEX_EFFECT_ROOT.test(code) || read?.root) {
    used.add(EFFECT_ROOT)
    if (!read || read.rootSingleArg || rootWithoutComponent(js)) used.add(EFFECT_STORE)
  }
  if (used.size > 0 || (read ? read.call : REGEX_EFFECT_CALL.test(code))) used.add('effect')
  return [...used]
}
// la fin de l'appel d'un `{await.keep}` (`…, ['q'], 1);`, `…, null, 1);`), la valeur `µpending` d'une branche, la lecture qui reçoit `µsignal`.
// Faux positifs acceptés (le mot dans un texte), jamais de faux négatif
const REGEX_AWAIT_KEEP    = /\._mjs_updAwait\('[\w-]+', [\s\S]*?(?:\]|null), 1\);/
const REGEX_AWAIT_PENDING = /\b_mjs_pnd\b/
const REGEX_AWAIT_SIGNAL  = /\(_mjs_sig\) =>/
// 'focus' ou 'online' entre guillemets, simples, doubles ou obliques
const REGEX_LOAD_REVIEW    = /(['"`])(?:focus|online)\1/
const REGEX_LOAD_FORGOTTEN = /µ\s*\??\.\s*load\s*\??\.\s*clear\b/

// --------------------------------------------------------------------------
// modules OPTIONNELS repérés (config.ts, OPTIONAL_RUNTIME_MODULES) : lus quand mjs.config.json n'écrit pas de clé `runtime`, pour ne
// joindre au cœur que ceux dont le projet se sert (bundler/index.ts, resolveRuntimeFiles). Un signal par module, `opt:<nom>`, cherché
// sur le texte compilé ENTIER (chaînes et commentaires compris) : faux positifs acceptés — le module part pour rien —, jamais de faux
// négatif. Leurs noms publics (`µ.modal`, `µ.ajax`…) après un point, blancs et chaînage optionnel compris, les rubriques que leur
// sucre compile (`µmodal` → `µ.modal`), les attributs que le compilateur pose pour eux (`mjs-method`, `mjs-confirm`, `mjs-flip`).
// Ce qu'une page servie hors construction écrit (vue serveur, HTML statique, script de la page) reste invisible ici : la sélection
// garde d'office les modules de page quand le projet a des vues serveur, et nomme ce qui reste de côté (resolveRuntimeFiles)
// --------------------------------------------------------------------------
export const optionalSignal = (module: string) => 'opt:' + module
const MU = String.raw`µ\s*\??\.\s*`
const REGEX_OPTIONAL: Record<string, RegExp> = {
  // le moteur des animations (`µ.anim`, les courbes `µ.easing`, `animate` de la balise d'un composant)
  easing:     new RegExp(MU + String.raw`(?:anim|easing)\b|\.animate\s*\(`),
  spring:     new RegExp(MU + String.raw`[sS]pring\b`),
  smooth:     new RegExp(MU + String.raw`smooth\b`),
  // le magasin global (`$$x` → `µ._storeDeclare`/`µ._storeSet`/`µ.store`, `µonline`, `µvisible`, `µready`, `µ.nav`, `µ.res`, `µ.server`)
  vault:      new RegExp(MU + String.raw`(?:store|online|visible|ready|nav|res|server)\b|\._storeDeclare\(|\._storeSet\(|\._mjs_store[A-Z]\w*\(`),
  // µajax et ses verbes ; sa forme appelable (`µajax url, options`), que le compilateur écrit `µ._mjs_ajax(` : un seul appel suffit
  ajax:       new RegExp(MU + String.raw`(?:ajax|csrfToken|_mjs_ajax)\b`),
  socket:     new RegExp(MU + String.raw`socket\b|\bMjsSocket\b`),
  // µschema, et `µ.ajax.binary(url, { schema })`, qui décode la réponse avec son codec
  schema:     new RegExp(MU + String.raw`(?:schema|list|bits)\b|` + MU + String.raw`ajax\s*\??\.\s*binary\b`),
  optimistic: new RegExp(MU + String.raw`optimistic\b`),
  // les poignées d'une connexion (`sock.game`, `sock.chat`, `sock.account`, `sock.lobby`), quel que soit le nom de la variable
  game:       /\.\s*game\b/,
  chat:       /\.\s*chat\b/,
  accounts:   /\.\s*account\b/,
  lobby:      /\.\s*lobby\b/,
  interp:     new RegExp(MU + String.raw`interp\b`),
  predict:    new RegExp(MU + String.raw`predict\b`),
  det:        new RegExp(MU + String.raw`(?:det|random)\b`),
  lockstep:   new RegExp(MU + String.raw`lockstep\b`),
  // `<@view>`, `µ.Router`, `µurl`, le crochet `µurlChange`, un lien vers une route `#/…`
  router:     new RegExp(String.raw`metamjs-view|\burlChange\b|href=\\?['"]?#\/|` + MU + String.raw`(?:Router|url)\b`),
  // `µmodal`, `µsound`, et `@confirm`, dont la question passe par la modale
  modal:      new RegExp(MU + String.raw`(?:modal|sound)\b|\bmjs-confirm\b`),
  // les attributs de la navigation (`@method`, `@confirm`, `@flash`, `@callback`, `@noDisable`, `@vt`, le préchargement) et ses noms publics
  ujs:        new RegExp(String.raw`\bmjs-(?:method|confirm|no-disable|flash|callback|vt)\b|data-mjs-preload|` + MU + String.raw`(?:confirm|pageCache|realTarget)\b`),
  flip:       /\bmjs-flip\b/,
  // l'étage client du journal, ouvert par le code (`µ.config.journal = true`)
  journal:    /\bconfig\s*\??\.\s*journal\b|\bjournal\s*:\s*true\b/,
}

// --------------------------------------------------------------------------
// accès à `µ` que le relevé des modules ne sait pas résoudre : un module optionnel se repère à son nom public écrit après un point
// (`µ.modal`, `µ?.ajax`, `window.µ.socket`). Un indice calculé (`µ[nom]`, `µ?.[nom]`), une déstructuration (`{ ajax } = µ`), `µ`
// passé à une fonction, rangé dans une variable, un objet ou une liste, rendu par une fonction, ne disent pas lequel sert : sans clé
// `runtime`, la sélection garde alors tous les modules optionnels (bundler/index.ts, detectOptionalModules). Lu sur l'arbre d'acorn,
// jamais sur le texte : `µ` cité dans une chaîne, un gabarit ou un commentaire — la prose d'une page de documentation — ne compte pas.
// Restent lisibles `typeof µ`, une comparaison ou un calcul (`µ === undefined`, `'modal' in µ`), un test (`if (µ)`, `µ && µ.x`) et
// `µ = window.µ`. Un code qu'acorn ne lit pas n'a aucun accès relevé (les noms publics, eux, s'y lisent sur le texte entier)
// --------------------------------------------------------------------------
export const OPAQUE_MU = 'opaque_mu'
// le même signal, situé par le bundler dans la source de l'unité : `opaque_mu@<fichier>:<ligne>`, ou `opaque_mu@<fichier>` quand la
// source ne montre pas la ligne
export const OPAQUE_MU_AT = OPAQUE_MU + '@'
export const opaqueMuSignal = (file: string, line: number | null) => OPAQUE_MU_AT + file + (line === null ? '' : ':' + line)

// un `µ` (ou `window.µ`) qui n'est ni le début ni la fin d'un nom plus long (la rune `µmodal` compile en `µ.modal`), ni suivi d'un nom
// après un point
const OPAQUE_READ = /(?<![\w$\u00b5])µ(?![\w$\u00b5]|\s*\??\.\s*[A-Za-z_$])/
// la ligne d'import du cœur que porte chaque unité (`import { µ } from '…'`)
const CORE_IMPORT = /^[ \t]*import\s*\{[^}\n]*\}\s*from\s*['"][^'"\n]*['"];?[ \t]*$/gm

// l'occurrence de µ (dernier des `ancetres`, chemin d'acorn-walk depuis la racine) laisse-t-elle µ partir sans nom après un point ?
function opaqueRead(ancestors: any[]): boolean {
  let child = ancestors[ancestors.length - 1]
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const p = ancestors[i]
    switch (p.type) {
      case 'MemberExpression':     return p.object === child ? p.computed : true
      case 'UnaryExpression':
      case 'BinaryExpression':
      case 'ExpressionStatement':
      case 'IfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForStatement':         return false
      case 'LogicalExpression':
        if (p.operator === '&&' && p.left === child) return false
        break
      case 'ConditionalExpression':
        if (p.test === child) return false
        break
      case 'SequenceExpression':
        if (p.expressions[p.expressions.length - 1] !== child) return false
        break
      case 'AwaitExpression':
      case 'ParenthesizedExpression':
        break
      // `const µ = window.µ`, `µ = window.µ`, `window.µ = µ` : µ reste µ
      case 'VariableDeclarator':   return !(p.id.type === 'Identifier' && p.id.name === 'µ')
      case 'AssignmentExpression':
        if (p.left === child) return false
        return !((p.left.type === 'Identifier' && p.left.name === 'µ') || (p.left.type === 'MemberExpression' && !p.left.computed && p.left.property.name === 'µ'))
      default:                     return true
    }
    child = p
  }
  return true
}

// l'arbre d'acorn d'un code compilé, lu en module puis en script ; null quand acorn ne le lit pas
function jsTree(js: string): acorn.Node | null {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return acorn.parse(js, { ecmaVersion: 'latest', sourceType })
    }
    catch {
      continue
    }
  }
  return null
}

// position (dans `js`) du premier accès à µ que le relevé des modules ne sait pas résoudre, -1 sans aucun
export function opaqueMuOffset(js: string): number {
  if (!OPAQUE_READ.test(unescapeMu(js).replace(CORE_IMPORT, ''))) return -1
  const ast = jsTree(js)
  if (ast === null) return -1
  let first  = -1
  const read = (node: any, ancestors: any[]): void => {
    if ((first === -1 || node.start < first) && opaqueRead(ancestors)) first = node.start
  }
  walk.ancestor(ast, {
    Identifier(node: any, _st: unknown, ancestors: any[]) { if (node.name === 'µ') read(node, ancestors) },
    MemberExpression(node: any, _st: unknown, ancestors: any[]) { if (!node.computed && node.property.type === 'Identifier' && node.property.name === 'µ') read(node, ancestors) },
  })
  return first
}

// --------------------------------------------------------------------------
// `µ.ajax` lu en entier : rangé dans une variable (`a := µ.ajax`), décomposé (`{ binary } := µ.ajax`), passé à une fonction, lu sous un indice
// calculé (`µ.ajax[verbe]`). La méthode appelée ne se lit pas, et `binary` décode la réponse avec le codec de schema : sans clé `runtime`, la
// sélection garde alors schema avec ajax (bundler/index.ts, detectOptionalModules). Lu sur l'arbre d'acorn, comme un accès à µ (cf. lectureOpaque) :
// `µ.ajax.get(…)`, `µ.ajax?.binary(…)`, `typeof µ.ajax`, un test (`if (µ.ajax)`), `µ.ajax` dans une chaîne ou un commentaire ne comptent pas
// --------------------------------------------------------------------------
export const OPAQUE_AJAX = 'opaque_ajax'
// le même signal, situé par le bundler dans la source de l'unité (cf. OPAQUE_MU_AT)
export const OPAQUE_AJAX_AT = OPAQUE_AJAX + '@'
export const opaqueAjaxSignal = (file: string, line: number | null) => OPAQUE_AJAX_AT + file + (line === null ? '' : ':' + line)

// `µ.ajax` (`µ?.ajax`, `window.µ.ajax`, la rune `µajax` de la source) que ne suit pas un nom après un point
const AJAX_READ = /(?<![\w$\u00b5])µ(?:\s*\??\.\s*)?ajax(?![\w$])(?!\s*\??\.\s*[A-Za-z_$])/

// position (dans `js`) du premier `µ.ajax` lu en entier, -1 sans aucun
export function opaqueAjaxOffset(js: string): number {
  if (!AJAX_READ.test(unescapeMu(js))) return -1
  const ast = jsTree(js)
  if (ast === null) return -1
  let first = -1
  walk.ancestor(ast, {
    MemberExpression(node: any, _st: unknown, ancestors: any[]) {
      const object = node.object
      const mu     = object.type === 'Identifier' ? object.name === 'µ' : object.type === 'MemberExpression' && !object.computed && object.property.type === 'Identifier' && object.property.name === 'µ'
      if (mu && !node.computed && node.property.type === 'Identifier' && node.property.name === 'ajax' && (first === -1 || node.start < first) && opaqueRead(ancestors)) first = node.start
    },
  })
  return first
}


// la ligne (à partir de 1) de cet accès dans le texte SOURCE d'une unité : le code compilé ne garde pas les lignes du fichier. La
// première lecture de µ qui ne soit pas un nom après un point, chaînes et commentaires d'une ligne mis de côté : dans les blocs
// `<script>` d'un composant d'abord (le texte du gabarit peut citer µ en prose), puis dans tout le fichier, puis telle qu'écrite
// (une interpolation de chaîne) ; null si aucune. `read` : la forme cherchée, un accès à µ par défaut
const INERT_LINE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`|\/\*.*?\*\/|\/\/.*|#(?!\{).*|<!--.*?-->/g
export function opaqueMuSourceLine(source: string, read: RegExp = OPAQUE_READ): number | null {
  const lines    = source.split('\n')
  const masked   = lines.map(l => l.replace(INERT_LINE, m => ' '.repeat(m.length)))
  const inScript = new Array<boolean>(lines.length).fill(false)
  let open       = false
  for (let i = 0; i < lines.length; i++) {
    if (/<script\b/.test(lines[i])) open = true
    inScript[i] = open
    if (/<\/script\s*>/.test(lines[i])) open = false
  }
  for (const [text, script] of [[masked, true], [masked, false], [lines, false]] as const) {
    for (let i = 0; i < lines.length; i++) {
      if (script && !inScript[i]) continue
      if (read.test(text[i])) return i + 1
    }
  }
  return null
}

// la ligne d'un `µ.ajax` lu en entier dans le texte SOURCE d'une unité (cf. opaqueMuSourceLine)
export const opaqueAjaxSourceLine = (source: string): number | null => opaqueMuSourceLine(source, AJAX_READ)

// --------------------------------------------------------------------------
// la navigation vers le SERVEUR (mjs_ujs.ts : requête par ajax, `@confirm` et messages du serveur par la modale, rideaux) : un lien
// ou un formulaire que la navigation prendrait hors des routes `#/…`, un attribut ou un nom public de ujs (signal `opt:ujs`), un départ
// écrit par le code (`location.assign(`, `location.replace(`, `location.href =`). Les vues serveur et les réglages de navigation se
// lisent dans le bundler (detectOptionalModules). Faux positifs acceptés, jamais de faux négatif
// --------------------------------------------------------------------------
export const NAV_SERVER = 'nav_server'
const REGEX_LOCATION_LEAVE = /\blocation\s*\??\.\s*(?:(?:assign|replace)\s*\(|href\s*=(?!=))/
// les rideaux et préréglages de `:viewTransition` (mjs_vt_presets.ts) : une transition de page compilée (`_mjs_viewTransition = …`,
// `static _mjs_vt = …`) autre que rien, `data-mjs-vt` sur une vue, `mjs-vt` sur un lien
export const VT_USED = 'vt_presets'
const REGEX_VT_USED = new RegExp(String.raw`\b_mjs_v(?:iewTransition|t)\s*=\s*(?!void 0\b|undefined\b|null\b)[^\s;]|\bmjs-vt\b|` + MU + String.raw`viewTransition\s*(?:\|\||\?\?|&&)?=(?!=)`)

// une balise `<a …>` ou `<form …>` du gabarit compilé (attributs entre apostrophes dans la chaîne du code émis)
const REGEX_NAV_TAG = /<(a|form)\b([^<>]*)>/gi
// un `href` posé à l'exécution (`_mjs_updAttr(…, 'href', …)`, `_mjs_updAttrNode(…, 'href', …)`) : le début écrit de sa valeur,
// quand la valeur commence par un texte (`\`#/item/${$.id}\``, `'#/' + x`) ; rien quand elle commence par une variable
const REGEX_HREF_SET = /_mjs_updAttr(?:Node)?\([^,()]*,\s*['"]href['"],\s*(?:[`'"]([^`'"$]*))?/g

// un lien ou un formulaire que la navigation prendrait (mjs_ujs.ts) : un formulaire, sauf `@noUJS` (`mjs-no-ujs`) ou `method="dialog"` ;
// un lien de même origine, sauf `@noUJS`, `download`, une autre cible que `_self`, une ancre de la page (`#section`, le navigateur la
// suit). Un `href` posé à l'exécution (lié à une variable : vide ou absent du gabarit), une balise créée par le code ou du HTML brut
// (`{{…}}`, `innerHTML`) comptent : leur adresse ne se lit pas ici. `routes` : une adresse `#/…` (une route) compte aussi — elle sert
// ujs, pas la navigation vers le serveur (cf. NAV_SERVER)
function navigationTargets(js: string, routes = true): boolean {
  if (/createElement\(\s*['"](?:a|form)['"]/i.test(js) || /\._mjs_updHtml\(|\binnerHTML\b|insertAdjacentHTML\(/.test(js)) return true
  // les `href` posés à l'exécution : tous de début écrit `#` (une route `#/…` quand `routes` est faux, une ancre) → un lien sans `href`
  // au gabarit ne compte pas ; un seul de début inconnu (`href={$url}`) → il compte
  let hrefsSet = false
  let hrefsPage  = true
  for (const m of js.matchAll(REGEX_HREF_SET)) {
    hrefsSet = true
    const start = m[1]
    if (start === undefined || !start.startsWith('#') || (routes && start.startsWith('#/')) || (routes && start === '#')) hrefsPage = false
  }
  for (const m of js.matchAll(REGEX_NAV_TAG)) {
    const attrs = m[2]
    if (/\bmjs-no-ujs\b/.test(attrs)) continue
    if (m[1].toLowerCase() === 'form') {
      if (/\bmethod=\\?['"]?dialog\b/i.test(attrs)) continue
      return true
    }
    if (/\bdownload\b/.test(attrs)) continue
    const target = /\btarget=\\?['"]?([^'"\s>\\]*)/.exec(attrs)
    if (target && target[1] !== '' && target[1] !== '_self') continue
    const href = /\bhref=(?:'([^']*)'|"([^"]*)"|([^\s>]+))/.exec(attrs)
    if (!href) {
      if (hrefsSet && hrefsPage) continue
      return true
    }
    const address = (href[1] ?? href[2] ?? href[3] ?? '').trim()
    if (address === '') return true
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(address)) continue
    if (address.startsWith('#') && !(routes && address.startsWith('#/'))) continue
    return true
  }
  return false
}

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
  // un réglage écrit ; `visible`, sur n'importe quel effet, demande aussi la part de `on: view` au cœur (cf. VIEW_PART) — pas une mention
  // libre : l'effet qu'une variable nomme se joue à sa pose (`on: load`), sans part
  const setting = (name: string, key: string, value: string) => {
    out.add(fxSignal(name, key, value))
    if (key === 'visible') out.add(VIEW_PART)
  }
  const write = (name: string, obj: any) => {
    out.add(fxUseSignal(name))
    if (obj?.type !== 'ObjectExpression') return
    for (const p of obj.properties) {
      if (p.type !== 'Property') {
        for (const k of Object.keys(EFFECTS[name].settings)) setting(name, k, FX_ANY)
        continue
      }
      setting(name, keyOf(p), settingValue(p.value))
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
// ticker/every/rules : ce sont des noms « publics » du framework (documentés), qu'une chaîne ou un
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
  const inert                          = (token: acorn.Token): void => {
    if (token.type === types.string || token.type === types.template || token.type === types.invalidTemplate || token.type === types.regexp) spans.push([token.start, token.end])
  }
  const comment = (_block: boolean, _text: string, start: number, end: number): void => { spans.push([start, end]) }
  const reads: Array<() => void> = [
    () => { acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', onToken: inert, onComment: comment }) },
    () => { acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script', onToken: inert, onComment: comment }) },
    () => { for (const token of acorn.tokenizer(js, { ecmaVersion: 'latest', sourceType: 'script', onComment: comment })) inert(token) },
  ]
  for (const read of reads) {
    spans.length = 0
    try {
      read()
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
const BETWEEN_TOKENS = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*`
export const PUBLIC_NAME_HINT = new RegExp(`µ${BETWEEN_TOKENS}\\??\\.${BETWEEN_TOKENS}(?:Store|interpolate|Ticker|every|inspect|play|effect)(?![\\w$])`)

// --------------------------------------------------------------------------
// scanCompiledFeatures(js, data?, aliases?) : union des signaux détectés dans la sortie compilée
// NON MINIFIÉE d'une unité. `data` optionnel (module de script autonome : aucun
// TranspileData, aucun `<style name>` possible — la clé layout_variant retombe alors sur le
// seul texte compilé). `aliases` : les réglages fixes de la table des alias de l'appli, dans l'ordre de leur
// rang — les poses qui y renvoient sont lues comme si elles les écrivaient. Jamais de faux négatif toléré : les faux
// positifs (mention hors-usage) sont, eux, acceptés — sauf store/
// interpolate/ticker/every, dont le seul faux positif texte connu (mention en chaîne) est
// corrigé par maskStringLiterals ci-dessus. Chaque relevé lit le texte où `µ` échappé (`\u00B5`, écrit à la main ou par un outil) est écrit
// en clair (transpiler/mu-escapes.ts).
// --------------------------------------------------------------------------
export function scanCompiledFeatures(compile: string, data?: FeatureScanData, aliases: ReadonlyArray<Record<string, unknown>> = []): Set<string> {
  const js     = unescapeMu(compile)
  const used   = new Set<string>()
  const masked = PUBLIC_NAME_HINT.test(js) ? maskStringLiterals(js) : js
  if (REGEX_TITLE.test(js)) used.add('title')
  if (REGEX_WAKE.test(js)) used.add('wake')
  if (REGEX_WAKE_INTERACTION.test(js)) used.add(WAKE_INTERACTION)
  if (REGEX_FIELD_BIND.test(js)) used.add(FIELD_BIND)
  if (REGEX_STORE.test(masked)) used.add('store')
  if (REGEX_INTERPOLATE.test(masked)) used.add('interpolate')
  if (REGEX_TICKER.test(masked)) used.add('ticker')
  if (REGEX_HEAD.test(js)) used.add('head')
  if (REGEX_BODY.test(js)) used.add('body')
  if (REGEX_DYNAMIC.test(js)) used.add('dynamic')
  if (REGEX_FAILED.test(js)) used.add('failed')
  if (REGEX_RARE_RUNES.test(js) || (REGEX_RAW_SNAP.test(js) && REGEX_RAW_SNAP.test(masked !== js ? masked : maskStringLiterals(js)))) used.add('rare_runes')
  // µinspect et µplay sur le code masqué seul : un texte qui les cite (chaîne, exemple d'un `<pre>`) n'emmène rien, un commentaire entre les
  // jetons (`µ /* c */ .inspect(`) reste un appel ; l'indice des noms publics, qui tolère ces commentaires, a déjà fait masquer le code quand
  // l'appel peut s'y trouver
  if (REGEX_INSPECT.test(masked)) used.add('inspect')
  if (REGEX_PLAY.test(masked)) used.add('play')
  if (REGEX_REFUSE.test(js)) used.add('refuse')
  if (REGEX_SLOT_EVENTS.test(js)) used.add('slot_events')
  if (REGEX_ELEMENT_AT.test(js)) used.add('element_at')
  if (REGEX_BOUNDARY.test(js)) used.add('boundary')
  if (REGEX_ADOPT_SHEET.test(js)) used.add('adopt_sheet')
  if (REGEX_CLONE.test(js)) used.add('clone')
  if (REGEX_LOAD.test(js)) used.add('load')
  if (REGEX_AWAIT_DERIVED.test(js)) used.add('await_derived')
  if (REGEX_FORM_RESET.test(js)) used.add('form_reset')
  if (REGEX_FORM_ASSOCIATED.test(js)) used.add('form_associated')
  if (REGEX_FORM_TAG.test(js)) used.add('form_tag')
  if (REGEX_FORM_VIEW.test(js)) used.add('form_view')
  if (REGEX_TYPES_SELECT.test(js)) used.add('types_select')
  if (REGEX_TYPES_AJAX.test(js)) used.add('types_ajax')
  if (REGEX_TYPES_DEFAULTS.test(js)) used.add(TYPES_DEFAULTS)
  if (REGEX_TYPES_STRICT.test(js)) used.add(TYPES_STRICT)
  if (REGEX_TYPES_HARD.test(js)) used.add(TYPES_HARD)
  if (REGEX_AJAX_CALL.test(js)) used.add(AJAX_CALL)
  // µajax appelé lui-même, que le compilateur n'écrit pas µ._mjs_ajax (`µajax?.(…)`) : la forme appelable entre, et le module de
  // µajax avec elle ; pris comme valeur, il arrête le build (cf. mentionsAjax, transpiler/var-types.ts)
  else if (mentionsAjax(js).call) {
    used.add(AJAX_CALL)
    used.add('ajax')
  }
  if (REGEX_DEEP_GUARD.test(js)) used.add(DEEP_GUARD)
  if (REGEX_STORE_GUARD.test(js)) used.add(STORE_GUARD)
  if (REGEX_STORE_KEY.test(js)) used.add(STORE_KEY)
  if (REGEX_CHART.test(js)) used.add('chart')
  if (REGEX_I18N_USED.test(js)) used.add(I18N_USED)
  if (REGEX_I18N_PACKS.test(js)) used.add(I18N_PACKS)
  if (REGEX_LOOPS.test(js)) used.add(LOOPS)
  if (REGEX_FINE.test(js)) used.add(FINE)
  if (REGEX_STORE_HELD.test(masked) || (REGEX_STORE_ROWS.test(masked) && (REGEX_COMPONENT_PROP.test(masked) || holdsRow(masked)))) used.add(STORE_HELD)
  if (REGEX_RETAINED_WAKES.test(js)) used.add(RETAINED_WAKES)
  if (REGEX_ATTACH_KEEP.test(js)) used.add(ATTACH_KEEP)
  if (REGEX_ROUTES_IDLE.test(js)) used.add(ROUTES_IDLE)
  if (REGEX_CHILD_PROPS.test(js)) used.add(CHILD_PROPS)
  if (REGEX_PRELOAD_LINK.test(js)) used.add(PRELOAD_LINK)
  if (REGEX_FILTERED_BINDINGS.test(js)) used.add(FILTERED_BINDINGS)
  if (REGEX_TRANSITION_DIRECTIVES.test(js)) used.add(TRANSITION_DIRECTIVES)
  if (REGEX_VIEW_TAG.test(js)) used.add(VIEW_TAG)
  if (REGEX_NATIVE_HELPERS.test(js)) used.add(NATIVE_HELPERS)
  if (REGEX_SPREAD_CLASS.test(js)) used.add(SPREAD_CLASS)
  if (REGEX_SPREAD_TAG_CLASS.test(js)) used.add(SPREAD_TAG_CLASS)
  if (REGEX_SPREAD_COMPONENT.test(js)) used.add(SPREAD_COMPONENT)
  if (REGEX_GLOBAL_ATTR_COMP.test(js)) used.add(GLOBAL_ATTR_COMPONENT)
  if (REGEX_ATTR_UPDATE.test(js)) used.add(ATTR_UPDATE)
  if (REGEX_ATTR_SELECT.test(js)) used.add(ATTR_SELECT)
  if (REGEX_PROPS_PENDING.test(js)) used.add(PROPS_PENDING)
  if (REGEX_ATTR_FILTER.test(js)) used.add(ATTR_FILTER)
  if (REGEX_ROOT_TEXT.test(js)) used.add(ROOT_TEXT)
  if (REGEX_DYNAMIC_ELEMENT.test(js)) used.add(DYNAMIC_ELEMENT)
  if (REGEX_DYNAMIC_MODULE.test(js)) used.add(DYNAMIC_MODULE)
  if (REGEX_DERIVED_VALUES.test(js)) used.add(DERIVED_VALUES)
  if (REGEX_DERIVED_CHOICE.test(js)) used.add(DERIVED_CHOICE)
  if (REGEX_SIG_READS.test(js)) used.add(SIG_READS)
  if (REGEX_REFRESH_RUNE.test(js)) used.add(REFRESH_RUNE)
  if (REGEX_STATE_ALIAS.test(js)) used.add(STATE_ALIAS)
  if (REGEX_LAYOUT_VAR.test(js)) used.add(LAYOUT_VAR)
  if (REGEX_ATTACHMENTS.test(js)) used.add(ATTACHMENTS)
  for (const [signal, named] of LONE_HELPER_NAMES) if (named.test(js)) used.add(signal)
  if (REGEX_EFFECT_BEFORE.test(js)) used.add(EFFECT_BEFORE)
  if (REGEX_EFFECT_STORE.test(js)) used.add(EFFECT_STORE)
  if (REGEX_SIG_QUEUE.test(js)) used.add(SIG_QUEUE)
  if (REGEX_EFFECT_ROOT.test(js)) {
    used.add(EFFECT_ROOT)
    // la racine vit dans le module des reffets : elle l'emmène, même sans aucun `µeffect` écrit (comme le relevé des `.js`, scanJsReffets)
    used.add('effect')
    if (rootWithoutComponent(js)) used.add(EFFECT_STORE)
  }
  if (REGEX_STORE_DESTROY.test(js)) used.add(STORE_DESTROY)
  if (REGEX_SIG_FREE.test(js)) used.add(SIG_FREE)
  if (REGEX_AWAIT_KEEP.test(js)) used.add(AWAIT_KEEP)
  if (REGEX_AWAIT_PENDING.test(js)) used.add(AWAIT_PENDING)
  if (REGEX_AWAIT_SIGNAL.test(js)) used.add(AWAIT_SIGNAL)
  if (REGEX_LOAD_REVIEW.test(js)) used.add(LOAD_REVIEW)
  if (REGEX_LOAD_FORGOTTEN.test(js)) used.add(LOAD_FORGOTTEN)
  if (REGEX_I18N_LOADER.test(js)) {
    used.add(I18N_LOADER)
    used.add('fx')
    used.add('fx_loader')
  }
  if (REGEX_ON.test(js)) used.add('on')
  if (REGEX_EFFECT.test(js) || (masked !== js && REGEX_EFFECT.test(masked))) used.add('effect')
  if (REGEX_EVERY.test(masked)) used.add('every')
  if (used.has('every') || REGEX_TIMER_READ.test(unescapeMu(js))) collectTimers(js, used)
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
  if (REGEX_ESC.test(js)) used.add('esc')
  if (REGEX_FOR_NESTED.test(js)) used.add('for_nested')
  if (REGEX_ALIAS.test(js)) used.add('alias')
  if (REGEX_TYPES.test(js)) used.add('types')
  if (REGEX_RULES.test(js) && REGEX_RULES.test(masked !== js ? masked : maskStringLiterals(js))) used.add('rules')
  if (REGEX_FORM.test(js) && REGEX_FORM.test(masked !== js ? masked : maskStringLiterals(js))) used.add('form')
  if (REGEX_RES.test(js) && REGEX_RES.test(masked !== js ? masked : maskStringLiterals(js))) used.add(RES_READ)
  if (REGEX_LANG.test(js)) used.add('lang')
  if (REGEX_STATE.test(js)) used.add('state')
  for (const [module, regex] of Object.entries(REGEX_OPTIONAL)) {
    if (regex.test(js)) used.add(optionalSignal(module))
  }
  if (used.has(optionalSignal('ujs')) || navigationTargets(js, false) || REGEX_LOCATION_LEAVE.test(js)) used.add(NAV_SERVER)
  if (!used.has(optionalSignal('ujs')) && navigationTargets(js)) used.add(optionalSignal('ujs'))
  if (REGEX_VT_USED.test(js)) used.add(VT_USED)
  if (opaqueMuOffset(js) !== -1) used.add(OPAQUE_MU)
  // µ lu sans nom après un point : la construction ne sait plus quelles minuteries partent (cf. collectTimers)
  if (used.has(OPAQUE_MU)) {
    used.add(EVERY_PAGE)
    used.add(EVERY_ID)
  }
  if (opaqueAjaxOffset(js) !== -1) used.add(OPAQUE_AJAX)
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
  const expanded = aliases.length > 0 ? expandAliasCalls(js, aliases) : js
  for (const m of js.matchAll(REGEX_ALIAS_RANK)) used.add(fxAliasSignal(m[1]))
  for (const m of expanded.matchAll(REGEX_FX_NESTED)) {
    if (EFFECTS[m[1]]) used.add(EFFECTS[m[1]].transition ? 'fx_transition' : 'fx_' + m[1].replace(/-/g, '_'))
  }
  for (const signal of fxSettings(expanded)) used.add(signal)
  if (REGEX_FX_NAMED.test(js) && hasNamedEffectPlacement(js)) used.add(FX_NAMED)
  if (REGEX_AUTOLOADER_MENTION.test(js)) used.add(AUTOLOADER_MENTION)
  if (REGEX_PRELOAD_MENTION.test(js)) used.add(PRELOAD_MENTION)
  if (REGEX_SPRITE_END.test(js)) used.add(SPRITE_END_LISTENED)
  // *follow(cursor, selection, focus) dessine ce que montre celui qui mène avec la trousse de *cursors
  if (used.has('fx_follow')) used.add('fx_cursors')
  // morceaux du cœur retirés quand l'appli ne s'en sert pas (cf. ROW_CLONE, RAW_ROWS)
  if (REGEX_ROW_CLONE.test(js)) used.add(ROW_CLONE)
  for (const f of scanRawRows(js)) used.add(f)
  return used
}
