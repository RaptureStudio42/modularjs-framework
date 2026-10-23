// transpiler/sections — extraction des sections <script module>, <script>, <style>, HTML.
// Port de la section "extraction" de la V1 Ruby, transpiler.rb.

import type { SupportedLang } from '../languages/index.js'
import { dedent } from '../generator/state.js'
import { maskInertSameLength, maskHtmlComments } from '../mask.js'
import { t } from '../messages/index.js'
import { parseVtValue, suggestKey } from '../bundler/config.js'
import { findMacroTagEnd, asciiLower } from './macro-tag.js'
import { tagReader } from './tag-reader.js'

export interface ScriptSection {
  raw: string
  lang: SupportedLang
  /** ligne 1-based du `.mjs` où DÉBUTE le contenu du bloc (après la balise ouvrante) —
   * `dedent()` conserve le nombre de lignes, donc ce numéro reste l'offset constant à
   * appliquer à une carte de source produite sur `raw`. `1` par défaut (section absente). */
  startLine: number
}

export interface StyleSection {
  raw: string
  lang: 'css' | 'sass' | 'scss'
  /** Noms des CSS partagés (`<style @css="base typo">`, relogé racine → attribut). */
  sharedCssNames: string[]
  /** Override du `:host{display:X}` (`<style @display="inline-block">`). */
  moduleDisplay: string
  /** Transitions de page par défaut du module (`<style @viewTransition.<nom>={…}>`) —
   *  chaîne VERBATIM (`<nom>` ou `<nom>={ direction: …, duration: …, priority: … }`),
   *  relue au runtime par µ._mjs_vtParse (mjs_vt_presets.ts) ; null si absente. */
  moduleViewTransition: string | null
  /** Priorité (façon z-index) de `@viewTransition`/`@vt` — cf. directives.ts
   *  (ancien porteur du champ), EXTRAITE de l'option `priority:`. Défaut 1. */
  moduleViewTransitionPriority: number
}

/** Un bloc `<style name="bandeau">` : un VARIANT de forme du composant, sorti
 * par le build dans un fichier à part et chargée seulement quand un `layout="bandeau"`
 * apparaît. Le `<style>` sans nom reste le style de base, embarqué dans le composant. */
export interface LayoutSection {
  raw: string
  lang: 'css' | 'sass' | 'scss'
  name: string
}

/** Un bloc `<theme>` du composant : déclaration de variables de thème.
 * `name` vide = le thème de base du composant (posé sur :host) ; `name` renseigné
 * = une variante, activée par l'attribut `theme="<name>"` sur l'instance. */
export interface ThemeSection {
  raw: string
  lang: 'css' | 'sass' | 'scss'
  name: string
}

/** Un bloc `<routes target="…">` du composant : table de routes FIXES pour
 * l'outlet `<@view id="target">` visé — alternative déclarative à `@routes`
 * (réservé, lui, aux tables calculées en boucle). `entries` : chemin → nom
 * de composant kebab-case, dans l'ordre d'écriture. */
export interface RoutesSection {
  raw: string
  target: string
  entries: [string, string][]
}

/** Un bloc `<vars>` du composant (types et valeurs permises de ses variables, props et stores),
 * ou un bloc `<types>` d'un fichier `*.types.mjs` (règles nommées) : lignes brutes, lues par
 * transpiler/var-types.ts. */
export interface TypesSection {
  raw: string
  /** ligne 1-based du `.mjs` où débute le contenu du bloc (après la balise ouvrante) */
  startLine: number
}

export interface SectionsResult {
  module: ScriptSection
  script: ScriptSection
  style: StyleSection
  layouts: LayoutSection[]
  themes: ThemeSection[]
  routes: RoutesSection[]
  /** le bloc `<vars>`, toujours avant le `<script>` ; null s'il n'y en a pas */
  vars: TypesSection | null
  /** les blocs `<types>` — leur place est un fichier `*.types.mjs`, jamais un composant */
  types: TypesSection[]
  /** les blocs `<effects>` — leur place est un fichier `*.effects.mjs`, jamais un composant */
  effects: TypesSection[]
  html: string
  /** ligne 1-based du `.mjs` où DÉBUTE le HTML rendu ci-dessus : les blocs retirés laissent un
   * commentaire de MÊME hauteur (cf. boucle de découpe), seul le `.trim()` final décale. Sert à
   * citer une ligne juste dans les erreurs posées sur cette section (processGlobalMacros). */
  htmlStartLine: number
  /** un 2e `<script module>`,
   * `<script>` (hors module), ou `<style>` était SILENCIEUSEMENT jeté (seul le
   * PREMIER de chaque catégorie était gardé) — perte de code sans le moindre
   * signal. Un simple warning a d'abord comblé ce trou (non vide dès qu'une
   * catégorie a plus d'UNE occurrence) ; un doublon lève
   * désormais `throw new Error(...)` (ERREUR DE COMPILATION), donc plus AUCUN
   * producteur ne remplit ce champ depuis `extractSections` elle-même. Conservé
   * (jamais rempli, toujours `[]`) car d'autres maillons de la chaîne le lisent
   * encore (`TranspileData.sectionWarnings`, `IncludeAccumulator.warnings`). */
  warnings: string[]
}

const DEFAULT_SCRIPT_LANG: SupportedLang = 'civet'
const DEFAULT_STYLE_LANG: 'css' | 'sass' | 'scss' = 'sass'

// ----------------------------------------------------------------------------
// extractLang — repère `lang="…"` dans une chaîne d'attributs
// ----------------------------------------------------------------------------
// espaces autour du `=` tolérés — même forme que SECTION_ATTR_RE (checkSectionAttrs, plus bas) :
// `lang = "js"` validait déjà SANS erreur mais compilait avec le langage par DÉFAUT (Civet),
// la valeur écrite n'étant jamais lue — panne muette, aucun message
function extractLang(attrs: string): string | null {
  const m = attrs.match(/lang[ \t]*=[ \t]*['"]([^'"]+)['"]/)
  return m ? m[1] : null
}

// extractAttr — même principe que extractLang, pour le `name=` d'un <theme>
function extractAttr(attrs: string, nom: string): string {
  const m = attrs.match(new RegExp(`${nom}=['"]([^'"]*)['"]`))
  return m ? m[1] : ''
}

// extractAttrValue — variante d'extractAttr pour un nom d'attribut portant un `@`
// (littéral en regex, aucun échappement nécessaire) ; null si absent.
function extractAttrValue(attrs: string, nom: string): string | null {
  const m = attrs.match(new RegExp(`${nom}=(['"])([^'"]*)\\1`))
  return m ? m[2] : null
}

// noms d'attributs d'une balise de section, base avant le 1er `.` (`@viewTransition.zoom` → `@viewTransition`)
const SECTION_ATTR_RE = /(@?[a-zA-Z][a-zA-Z0-9:_.-]*)(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+))?/g

// attribut inconnu sur <style>/<script>/<theme>/<routes> = ERREUR : ces balises n'atteignent jamais le DOM, rien d'autre que la liste attendue n'y a de sens — suggestion à ≤2 lettres quand il y en a une
function checkSectionAttrs(tag: string, attrs: string, allowed: string[]): void {
  for (const m of attrs.matchAll(SECTION_ATTR_RE)) {
    const base = m[1].split('.')[0]
    if (allowed.includes(base)) continue
    const attendus   = allowed.join(', ')
    const suggestion = suggestKey(base, allowed)
    if (suggestion) throw new Error(t('transpiler.section-attribut-inconnu-suggestion', { tag, attribut: m[1], suggestion, attendus }))
    throw new Error(t('transpiler.section-attribut-inconnu', { tag, attribut: m[1], attendus }))
  }
}

// extractStyleViewTransition — repère `@viewTransition` sur `<style …>` et rend son RESTE BRUT,
// tel quel : c'est l'APPELANT qui juge, exactement comme le fait déjà `<@view @viewTransition…>`
// (transpiler/index.ts, même grammaire). `rest: undefined` = forme NUE, sentinel 'on' posé par
// l'appelant. `aliasVt` = écrit `@vt` — ALIAS RETIRÉ sur `<style>` (reste vivant à la racine du
// fichier pour le message, directives.ts, et sur `<a @vt="…">`, mécanisme UJS distinct).
//
// ⚠ FAMILLE « GARDE MUETTE » — la version d'avant rendait `null` sur
// `.cube:left` et sur `={expr}` : EXACTEMENT ce que rend « pas d'attribut du tout ». Les deux
// écritures partaient à la poubelle sans un mot — ni transition, ni erreur — alors que la doc les
// annonçait comme des erreurs de compilation. D'où les deux changements ici : le nom accepte
// `:` et `_` EXPRÈS (pour que la forme fautive ARRIVE jusqu'au juge, qui la refuse avec le message
// dédié), et le second filet rattrape tout ce qui échapperait encore à la grammaire.
function extractStyleViewTransition(attrs: string): { rest: string | undefined, aliasVt: boolean, label: string, malformed: boolean } | null {
  const m = attrs.match(/@(viewTransition|vt)(\.[a-zA-Z][a-zA-Z0-9:_-]*(?:[ \t]*=[ \t]*\{[^}]*\})?|=(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]*))?(?=[ \t]|$)/)
  if (m) return { rest: m[2], aliasVt: m[1] === 'vt', label: `@${m[1]}`, malformed: false }
  const brut = attrs.match(/@(viewTransition|vt)\b([^\s>]*)/)
  if (!brut) return null
  return { rest: brut[2], aliasVt: brut[1] === 'vt', label: `@${brut[1]}`, malformed: true }
}

// findRelocatedStyleAttrToken — un des attributs `@css`/`@display`/`@viewTransition`/`@vt`
// posé sur ce `<style>` (peu importe valué ou nu) — sert à interdire ces attributs
// sur un `<style name="…">` (variant/layout).
function findRelocatedStyleAttrToken(attrs: string): string | null {
  const m = attrs.match(/@(css|display|viewTransition|vt)\b/)
  return m ? `@${m[1]}` : null
}

// nom de variante : minuscules/chiffres/tirets — il finit en sélecteur d'attribut
const THEME_NAME_RE = /^[a-z][a-z0-9-]*$/

// nom de composant kebab-case, SANS le préfixe `mjs-` — même contrainte que les valeurs
// de l'objet `@routes` calculé (transpiler/index.ts).
const ROUTE_COMPONENT_RE = /^[a-z][a-z0-9-]*$/
const ROUTE_PARAM_RE          = /^:[a-zA-Z_][a-zA-Z0-9_]*$/
const ROUTE_OPTIONAL_PARAM_RE = /^\(:[a-zA-Z_][a-zA-Z0-9_]*\)$/
const ROUTE_OPTIONAL_LITERAL_RE = /^\([^():*\s]+\)$/

// validateRoutePath — un chemin de `<routes>` doit matcher exactement ce que le routeur
// runtime sait traiter (`src/runtime/mjs_router.ts`, `_matchSegs`) : segments littéraux,
// `:param`, `*` catch-all (dernier segment SEULEMENT — capture le reste), `(:param)`
// optionnel À N'IMPORTE QUELLE POSITION. L'optionnel MÉDIAN était refusé ici au motif que
// le routeur ne saurait pas revenir en arrière — c'est faux depuis le retour arrière de
// `_matchSegs` (`tests/router-optional-mid-segment.test.ts` prouve `/a/(:x)/b` et même deux
// optionnels médians consécutifs). Le validateur était donc PLUS STRICT que le moteur qu'il
// alimente : `@routes` acceptait un motif que le bloc rejetait, et migrer d'une forme à
// l'autre cassait la compilation (parité).
function validateRoutePath(path: string): boolean {
  const segs = path.slice(1).split('/').filter(s => s.length > 0)
  for (let i = 0; i < segs.length; i++) {
    const seg    = segs[i]
    const isLast = i === segs.length - 1
    if (seg === '*') { if (!isLast) return false; continue }
    // `(…)` = segment facultatif : `(:param)` capture, `(littéral)` ne capture rien (préfixe
    // d'URL optionnel). Le routeur traite les deux (`_matchSegs`, mjs_router.ts) — le bloc les
    // refusait, `@routes` les acceptait : même écart de parité que l'optionnel médian
    if (seg[0] === '(') { if (!ROUTE_OPTIONAL_PARAM_RE.test(seg) && !ROUTE_OPTIONAL_LITERAL_RE.test(seg)) return false; continue }
    if (seg[0] === ':') { if (!ROUTE_PARAM_RE.test(seg)) return false; continue }
    // segment littéral : tout sauf espace (déjà exclu par le découpage \S+ de parseRoutesLines)
  }
  return true
}

// parseRoutesLines — mini-parseur du CORPS d'un bloc `<routes target="…">` : une route
// par ligne (`<chemin>` puis espaces/tabulations puis `<nom-de-composant>`), lignes vides
// ignorées, ligne commençant par `#` = commentaire. Exportée pour être testée seule.
export function parseRoutesLines(raw: string, target: string): [string, string][] {
  const entries: [string, string][] = []
  const seenPaths = new Set<string>()
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const ligne = i + 1
    const m = trimmed.match(/^(\S+)[ \t]+(\S+)$/)
    if (!m) throw new Error(t('transpiler.routes-ligne-invalide', { target, ligne, texte: trimmed }))
    const [, path, component] = m
    if (path[0] !== '/') throw new Error(t('transpiler.routes-chemin-sans-slash', { target, ligne, chemin: path }))
    if (!validateRoutePath(path)) throw new Error(t('transpiler.routes-chemin-mal-forme', { target, ligne, chemin: path }))
    if (!ROUTE_COMPONENT_RE.test(component)) throw new Error(t('transpiler.routes-composant-invalide', { target, ligne, composant: component }))
    if (seenPaths.has(path)) throw new Error(t('transpiler.routes-chemin-double', { target, chemin: path }))
    seenPaths.add(path)
    entries.push([path, component])
  }
  return entries
}

// lineOfOffset — numéro de ligne 1-based d'un offset dans `src` (compte les `\n` avant)
function lineOfOffset(src: string, offset: number): number {
  let n = 1
  for (let i = 0; i < offset; i++) if (src.charCodeAt(i) === 10) n++
  return n
}

// countNewlines — nombre de `\n` dans une plage, sert à choisir un
// remplacement de MÊME hauteur pour un bloc retiré (cf. bandeau sur la boucle de découpe HTML).
function countNewlines(src: string): number {
  let n = 0
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) n++
  return n
}

// FIX faille lexer de sections — un `</script>`/`</style>` DANS
// un littéral (chaîne, heredoc, commentaire) du CODE tronquait l'extraction
// (les 4 regex de section matchaient à plat sur `scan`, aveugles au contexte).
// Parade : chercher sur une VUE MASQUÉE même-longueur (littéraux → espaces,
// `\n` préservés → offsets alignés sur l'original), puis relire le texte réel
// via `m.indices` (drapeau `d`) — jamais de 2e passe regex sur la tranche
// extraite, qui retomberait dans le même piège.

// masqueur CSS/SASS local — chaînes '…'/"…" + commentaires /*…*/ et //…
// UNIQUEMENT. PAS de règle `#…` (SASS `#123` = couleur hex, pas un commentaire ;
// une règle `#` avalerait `}</style>` sur la même ligne).
//
// `url(https://…)` (SANS guillemets) sur la même ligne qu'un `</style>` : le `//` de l'URL
// était lu comme un commentaire SASS, qui masquait alors tout jusqu'à la fin de ligne — `</style>`
// compris → « balise orpheline » refusée sur un composant valide. Un `//` n'est un commentaire ni
// dans une chaîne (déjà protégé), ni dans `url( )` : l'alternative `url\(...\)` consomme tout le
// contenu de l'appel AVANT que le scan n'atteigne son `//` interne (guillemetée ou non, peu
// importe : blanchir tout l'appel est sans effet ici, cette vue ne sert qu'à repérer les balises).
const STYLE_INERT_RE = /'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|\/\*[\s\S]*?\*\/|url\((?:[^)\\]|\\.)*\)|\/\/[^\n]*/gi

function maskStyleInertSameLength(src: string): string {
  return src.replace(STYLE_INERT_RE, (tok) => tok.replace(/[^\n]/g, ' '))
}

// lecteur des littéraux de STYLE_INERT_RE : le premier qui commence à `de` ou après, [début, fin) — même résultat que
// l'expression, sans relire tout le texte à chaque appel : la fin déjà cherchée d'un `/*` ou d'un `url(` est gardée (un `/*`
// ou un `url(` jamais refermés relisaient le texte jusqu'au bout à chacun de leurs appels : temps quadratique)
const FIN_DE_LIGNE = new Set(['\n', '\r', ' ', ' '])

function lecteurLitteraux(scan: string): (de: number) => [number, number] | null {
  const n = scan.length
  // premier `*/` à partir d'une position de [deCom, finCom] : finCom (-1 : aucun après deCom)
  let deCom  = -1
  let finCom = -1
  const finCommentaire = (x: number): number => {
    if (deCom === -1 || x < deCom || (finCom !== -1 && x > finCom)) {
      deCom  = x
      finCom = scan.indexOf('*/', x)
    }
    return finCom
  }
  // `)` qui ferme un `url(` lu à partir d'une position de [deUrl, arretUrl] : finUrl (-1 : aucune) ; un `\` y garde le
  // caractère qui suit, sauf une fin de ligne. Une position lue juste après `url(` ne tombe jamais au milieu d'un `\x`
  let deUrl    = -1
  let arretUrl = -1
  let finUrl   = -1
  const fermeUrl = (x: number): number => {
    if (deUrl === -1 || x < deUrl || x > arretUrl) {
      let i = x
      finUrl = -1
      while (i < n) {
        const c = scan[i]
        if (c === ')') { finUrl = i; break }
        if (c === '\\') {
          if (i + 1 >= n || FIN_DE_LIGNE.has(scan[i + 1])) break
          i += 2
          continue
        }
        i++
      }
      deUrl    = x
      arretUrl = Math.min(i, n)
    }
    return finUrl
  }
  // fin (après le guillemet) d'une chaîne d'une ligne ouverte en `p`, -1 sans guillemet fermant
  const finChaine = (p: number): number => {
    const q = scan[p]
    for (let i = p + 1; i < n; i++) {
      const c = scan[i]
      if (c === q) return i + 1
      if (c === '\n') return -1
      if (c === '\\') {
        if (i + 1 >= n || FIN_DE_LIGNE.has(scan[i + 1])) return -1
        i++
      }
    }
    return -1
  }
  return (de: number): [number, number] | null => {
    for (let p = de; p < n; p++) {
      const c = scan[p]
      if (c === '\'' || c === '"') {
        const fin = finChaine(p)
        if (fin !== -1) return [p, fin]
      }
      else if (c === '/') {
        const c1 = scan[p + 1]
        if (c1 === '*') {
          const fin = finCommentaire(p + 2)
          if (fin !== -1) return [p, fin + 2]
        }
        else if (c1 === '/') {
          const fin = scan.indexOf('\n', p)
          return [p, fin === -1 ? n : fin]
        }
      }
      else if ((c === 'u' || c === 'U') && scan[p + 3] === '(' && scan.slice(p + 1, p + 3).toLowerCase() === 'rl') {
        const fin = fermeUrl(p + 4)
        if (fin !== -1) return [p, fin + 1]
      }
    }
    return null
  }
}

// maskStylesCss — vue CSS/SASS où seuls les styles sont lus comme du CSS : le texte du gabarit n'en est pas, et un `/*`
// ou un `url(` non refermés écrits dans le HTML AVANT un <style> (texte d'un paragraphe, démo de code) masquaient tout
// jusqu'à leur fin, balise comprise — le composant valide était refusé (« un </style> orphelin »). Lecture continue,
// comme avant ; une balise <style> en tête de ligne, hors des scripts, qu'un littéral a avalée relance la lecture à
// partir d'elle. <theme>, <routes>, <vars>, <types> et <effects> se cherchent dans cette même vue : même relance à leur balise
// (suivie d'un blanc ou de `>`) ; l'une d'elles jamais refermée ne coupe pas la lecture de la suite
// Une relance relit les littéraux à partir de la balise : le texte n'est plus masqué en entier à chaque relance (2 000 styles avalés
// coûtaient deux secondes), les littéraux de la lecture en cours sont lus au fil des besoins et le texte masqué se compose à la fin,
// chaque tronçon lu depuis sa relance — même résultat
function maskStylesCss(scan: string, scriptMatches: RegExpMatchArray[], caseInsensitive: boolean): string {
  const open = new RegExp(String.raw`^[ \t]*<(style|(?:theme|routes|vars|types|effects)(?=[\s>]))`, caseInsensitive ? 'gmi' : 'gm')
  // positions d'où la lecture des littéraux repart, la première au début du texte
  const relances = [0]
  const litteral = lecteurLitteraux(scan)
  // position d'où la lecture en cours cherche son prochain littéral
  let suite = 0
  // littéraux de la lecture en cours, dans l'ordre : début, fin, début, fin…
  let lus: number[] = []
  let fini = false
  // [a, b) touche-t-il un littéral de la lecture en cours (a après sa relance)
  const masque = (a: number, b: number): boolean => {
    while (!fini && (lus.length === 0 || lus[lus.length - 1] <= a)) {
      const l = litteral(suite)
      if (l === null) fini = true
      else {
        lus.push(l[0], l[1])
        suite = l[1]
      }
    }
    let bas  = 0
    let haut = lus.length / 2
    while (bas < haut) {
      const milieu = (bas + haut) >> 1
      if (lus[milieu * 2 + 1] <= a) bas = milieu + 1
      else haut = milieu
    }
    return bas < lus.length / 2 && lus[bas * 2] < b
  }
  let pos = 0
  for (;;) {
    open.lastIndex = pos
    const m = open.exec(scan)
    if (!m) break
    const balise = '<' + m[1]
    const at     = m.index + m[0].length - balise.length
    const script = scriptMatches.find(s => s.indices![0][0] <= at && at < s.indices![0][1])
    if (script) {
      pos = script.indices![0][1]
      continue
    }
    if (masque(at, at + balise.length)) {
      relances.push(at)
      suite = at
      lus   = []
      fini = false
    }
    const close = new RegExp('</' + m[1] + '>', caseInsensitive ? 'gi' : 'g')
    close.lastIndex = at
    let c = close.exec(scan)
    while (c !== null && masque(c.index, c.index + c[0].length)) {
      close.lastIndex = c.index + 1
      c = close.exec(scan)
    }
    if (!c) {
      if (m[1].toLowerCase() === 'style') break
      pos = at + balise.length
      continue
    }
    pos = c.index + c[0].length
  }
  const morceaux: string[] = []
  for (let k = 0; k < relances.length; k++) {
    const debut = relances[k]
    const fin   = k + 1 < relances.length ? relances[k + 1] : scan.length
    let curseur = debut
    for (let l = litteral(debut); l !== null && l[0] < fin; l = litteral(l[1])) {
      const bout = Math.min(fin, l[1])
      morceaux.push(scan.slice(curseur, l[0]), scan.slice(l[0], bout).replace(/[^\n]/g, ' '))
      curseur = bout
    }
    morceaux.push(scan.slice(curseur, fin))
  }
  return morceaux.join('')
}

// masqueValeursAttributs — valeurs d'attribut des balises ouvrantes du HTML blanchies (même longueur) : entre guillemets sur une
// ligne, nues (jusqu'au blanc ou au `>`, comme les lit le navigateur : `title=a</script>b` vaut `a</script`), et le contenu
// des accolades `{…}`, chaînes comprises.
// Lecture stricte d'une balise : son nom, puis des attributs séparés par des blancs — `nom` (réglages `(…)` d'un effet compris),
// `nom=valeur` ou `{…}`, la valeur entre guillemets, entre accolades ou nue — jusqu'à `>` ou `/>`. Une balise qui ne s'y plie pas
// n'est pas lue : un reste de script échappé de l'extraction (`if a <b then c` puis `</script>` à la ligne) n'est pas une balise
const NOM_ATTRIBUT_RE = /[^\s"'<>/=(){}`]+/y
const REGLAGES_RE     = /\((?:[^()<>\n]|\([^()<>\n]*\))*\)/y
const EGAL_RE         = /\s*=\s*/y
const VALEUR_NUE_RE   = /[^\s>]+/y

export function masqueValeursAttributs(html: string): string {
  const lecteur = tagReader(html)
  const valeurs: [number, number][] = []
  const balise  = /<[A-Za-z@][\w:.@-]*/g
  const lit = (re: RegExp, i: number): number => {
    re.lastIndex = i
    return re.test(html) ? re.lastIndex : -1
  }
  for (let m = balise.exec(html); m !== null; m = balise.exec(html)) {
    const trouvees: [number, number][] = []
    let i = m.index + m[0].length
    let fin = -1
    for (;;) {
      const blanc = i
      while (i < html.length && /\s/.test(html[i])) i++
      if (html[i] === '>') { fin = i; break }
      if (html.startsWith('/>', i)) { fin = i + 1; break }
      if (i === blanc) break
      if (html[i] === '{') {
        const ferme = lecteur.braceEnd(i + 1)
        if (ferme === -1) break
        trouvees.push([i + 1, ferme])
        i = ferme + 1
        continue
      }
      i = lit(NOM_ATTRIBUT_RE, i)
      if (i === -1) break
      if (html[i] === '(') {
        i = lit(REGLAGES_RE, i)
        if (i === -1) break
      }
      const egal = lit(EGAL_RE, i)
      if (egal === -1) continue
      i = egal
      const q = html[i]
      if (q === '"' || q === '\'') {
        const ferme = html.indexOf(q, i + 1)
        if (ferme === -1) break
        if (!html.slice(i + 1, ferme).includes('\n')) trouvees.push([i + 1, ferme])
        i = ferme + 1
      }
      else if (q === '{') {
        const ferme = lecteur.braceEnd(i + 1)
        if (ferme === -1) break
        trouvees.push([i + 1, ferme])
        i = ferme + 1
      }
      else {
        const debut = i
        i = lit(VALEUR_NUE_RE, i)
        if (i === -1) break
        trouvees.push([debut, i])
      }
    }
    if (fin === -1) continue
    valeurs.push(...trouvees)
    balise.lastIndex = fin + 1
  }
  const morceaux: string[] = []
  let curseur = 0
  for (const [debut, fin] of valeurs) {
    morceaux.push(html.slice(curseur, debut), ' '.repeat(fin - debut))
    curseur = fin
  }
  morceaux.push(html.slice(curseur))
  return morceaux.join('')
}

// blankRange — neutralise [start,end) en espaces même-longueur (préserve les `\n`)
function blankRange(src: string, start: number, end: number): string {
  return src.slice(0, start) + src.slice(start, end).replace(/[^\n]/g, ' ') + src.slice(end)
}

// motifs de reconnaissance des balises de section — constantes PARTAGÉES entre
// findScriptMatches/findStyleMatches (plus bas) et extractSections, pour qu'il n'existe qu'UN
// seul endroit où ces regex sont écrites.
const SCRIPT_MODULE_RE_SRC = String.raw`^[ \t]*<script([^>]*?)\bmodule\b([^>]*)>([\s\S]*?)</script>`
const SCRIPT_RE_SRC        = String.raw`^[ \t]*<script([^>]*)>([\s\S]*?)</script>`
const STYLE_RE_SRC         = String.raw`^[ \t]*<style([^>]*)>([\s\S]*?)</style>`

// maskScriptsCivet — vue Civet où seuls les scripts sont lus comme du code : le texte du gabarit n'en est pas, et un
// `###` (commentaire bloc) ou un accent grave isolé écrits dans le HTML AVANT un <script> masquaient tout jusqu'au
// suivant, balise comprise — le composant valide était refusé (« un </script> orphelin »). Lecture continue, comme
// avant ; une balise <script> en tête de ligne qu'un littéral du HTML a avalée relance la lecture à partir d'elle
function maskScriptsCivet(scan: string, caseInsensitive: boolean): string {
  const open  = new RegExp(String.raw`^[ \t]*<script`, caseInsensitive ? 'gmi' : 'gm')
  const close = new RegExp('</script>', caseInsensitive ? 'gi' : 'g')
  let masked  = maskInertSameLength(scan)
  let pos     = 0
  for (;;) {
    open.lastIndex = pos
    const m = open.exec(scan)
    if (!m) return masked
    const at = m.index + m[0].length - '<script'.length
    if (masked.slice(at, at + '<script'.length) !== scan.slice(at, at + '<script'.length)) masked = masked.slice(0, at) + maskInertSameLength(scan.slice(at))
    close.lastIndex = at
    const c = close.exec(masked)
    if (!c) return masked
    pos = c.index + c[0].length
  }
}

// findScriptMatches — repère les blocs <script module>/<script> sur la vue Civet masquée
// (littéraux/commentaires Civet puis commentaires HTML) — SEULE recherche de cette borne,
// partagée avec extractDirectives (transpiler/directives.ts) : avant, celui-ci réimplémentait sa
// propre recherche, qui pouvait diverger de celle-ci sans que rien ne le signale.
// `caseInsensitive` : extractDirectives s'en sert AVANT même de savoir si le fichier compilera —
// une balise mal casée (`<SCRIPT>`) qui deviendra une ERREUR de compilation plus tard (cf.
// garde-fou orphelin plus bas) doit quand même voir son CONTENU traité comme du script tant que
// la compilation n'a pas encore tranché ; extractSections, lui, reste strictement en minuscules
// (défaut `false`, comportement inchangé).
export function findScriptMatches(scan: string, caseInsensitive = false): { moduleScripts: RegExpMatchArray[], scripts: RegExpMatchArray[] } {
  const maskedCivet = maskHtmlComments(maskScriptsCivet(scan, caseInsensitive))
  const flags = caseInsensitive ? 'gmdi' : 'gmd'
  const moduleScripts = [...maskedCivet.matchAll(new RegExp(SCRIPT_MODULE_RE_SRC, flags))]
  const moduleRe = caseInsensitive ? /\bmodule\b/i : /\bmodule\b/
  const scripts = [...maskedCivet.matchAll(new RegExp(SCRIPT_RE_SRC, flags))]
    .filter(m => !moduleRe.test(m[1]))
  return { moduleScripts, scripts }
}

export interface StyleMatchResult {
  matches: RegExpMatchArray[]
  /** vue CSS/SASS utilisée pour les trouver (plages de script neutralisées, commentaires HTML
   *  masqués) — extractSections la réutilise telle quelle pour la suite de la chaîne
   *  (<theme>, <routes>), jamais recalculée deux fois. */
  maskedView: string
}

// findStyleMatches — repère les blocs <style> (base ET `name=`) sur une vue CSS/SASS
// (maskStylesCss), plages des scripts déjà trouvés neutralisées, puis commentaires
// HTML masqués — MÊME vérité que findScriptMatches, partagée avec extractDirectives.
export function findStyleMatches(scan: string, scriptMatches: RegExpMatchArray[], caseInsensitive = false): StyleMatchResult {
  let maskedStyle = maskStylesCss(scan, scriptMatches, caseInsensitive)
  for (const m of scriptMatches) {
    const [start, end] = m.indices![0]
    maskedStyle = blankRange(maskedStyle, start, end)
  }
  maskedStyle = maskHtmlComments(maskedStyle)
  const flags = caseInsensitive ? 'gmdi' : 'gmd'
  const matches = [...maskedStyle.matchAll(new RegExp(STYLE_RE_SRC, flags))]
  return { matches, maskedView: maskedStyle }
}

// maskHeadFailedBlocks — masque chaque
// `<@head …>…</@head>`/`<@failed …>…</@failed>` de `src`, `>` de la balise
// OUVRANTE retrouvé via `findMacroTagEnd` (macro-tag.ts — même fonction que
// macros.ts) et non plus le premier `>` textuel. AVANT (regex
// `<@(head|failed)\b[^>]*>[\s\S]*?<\/@\1>`) : un `>` niché dans une accolade
// d'attribut coupait la balise au mauvais endroit (`<@head @click={$y > 100}>`
// → coupée à ce `>`-là, un résidu `100}>` fuyait dans le HTML rendu). Frontière
// de nom : le caractère qui suit `head`/`failed` ne doit être ni un caractère
// de mot ni un tiret (`<@headx>`, `<@head-foo>` ignorés, laissés en texte).
// Balise jamais refermée (aucun `>` réel trouvé) ou fermeture
// `</@head>`/`</@failed>` absente → bloc laissé TEL QUEL, comportement
// identique à l'ancienne regex qui ne matchait pas dans ces deux cas (la
// balise jamais refermée sera signalée par `macro-balise-non-fermee`, plus
// tard, quand macros.ts la retraite sous sa forme écouteur/contenu).
function maskHeadFailedBlocks(src: string, masks: string[]): string {
  const lower = asciiLower(src)
  let out = ''
  let pos = 0
  for (;;) {
    const headIdx = lower.indexOf('<@head', pos)
    const failedIdx = lower.indexOf('<@failed', pos)
    const idx = headIdx === -1 ? failedIdx : (failedIdx === -1 ? headIdx : Math.min(headIdx, failedIdx))
    if (idx === -1) { out += src.slice(pos); return out }
    const name = idx === headIdx ? 'head' : 'failed'
    const nameEnd = idx + `<@${name}`.length
    const boundary = src[nameEnd]
    if (boundary !== undefined && /[\w-]/.test(boundary)) { out += src.slice(pos, idx + 1); pos = idx + 1; continue }
    const tagEnd = findMacroTagEnd(src, nameEnd)
    if (tagEnd === -1) { out += src.slice(pos, idx + 1); pos = idx + 1; continue }
    const closeIdx = lower.indexOf(`</@${name}>`, tagEnd + 1)
    if (closeIdx === -1) { out += src.slice(pos, idx + 1); pos = idx + 1; continue }
    const wholeEnd = closeIdx + `</@${name}>`.length
    masks.push(src.slice(idx, wholeEnd))
    out += src.slice(pos, idx) + `\x00MJSHF${masks.length - 1}\x00`
    pos = wholeEnd
  }
}

// ----------------------------------------------------------------------------
// extractSections — sépare les blocs <script module>, <script>, <style>, HTML
// ----------------------------------------------------------------------------
export function extractSections(content: string, opts: {
  defaultScriptLang?: SupportedLang
  defaultStyleLang?: 'css' | 'sass' | 'scss'
} = {}): SectionsResult {
  const defaultScriptLang = opts.defaultScriptLang ?? DEFAULT_SCRIPT_LANG
  const defaultStyleLang = opts.defaultStyleLang ?? DEFAULT_STYLE_LANG
  const warnings: string[] = []

  // un BOM (U+FEFF) en tête de
  // fichier (PowerShell `Out-File`/Notepad sous Windows) n'est ni un espace ni
  // un tab : les 3 regex d'ouverture ancrées sur `^[ \t]*<script…` ne le
  // sautent pas, AUCUNE section n'est trouvée, tout part en HTML, et l'orphan-
  // guard plus bas throw avec un message qui ne parle que de backtick/chaîne
  // non fermée. `readFileSync(...,'utf-8')` ne strip pas le BOM (Node standard).
  // Strippé ICI, choke point unique par lequel transite tout contenu de
  // composant (`transpile` → `extractSections`, et `<@include>` qui appelle
  // `extractSections` direct) — pas besoin de dupliquer aux points de lecture.
  content = content.replace(/^\uFEFF/, '')

  // MASQUE les blocs <@head>/<@failed> AVANT toute extraction de section.
  // Un `<script src>` (SDK/analytics) ou un `<style>` DANS un <@head> (usage
  // naturel) ne doit PAS être volé comme LA section <script>/<style> du composant
  // (extractSections matche à plat ; ces macros sont traitées bien plus tard par
  // processGlobalMacros). Sans ce masque, le `<script src>` vide du <@head>
  // devenait la section <script>, le vrai script du composant était compté
  // « doublon » et JETÉ → logique perdue + injection head vide. On extrait sur le
  // texte MASQUÉ, puis on restaure les blocs dans le HTML de sortie.
  // Masquage aligné sur `findMacroTagEnd`
  // (voir bandeau de `maskHeadFailedBlocks` ci-dessus) : l'ancienne regex
  // `[^>]*` s'arrêtait au premier `>` textuel, y compris niché dans une
  // accolade d'attribut.
  const macroMasks: string[] = []
  const scan = maskHeadFailedBlocks(content, macroMasks)
  const restoreMacros = (s: string): string =>
    macroMasks.length ? s.replace(/\x00MJSHF(\d+)\x00/g, (_m, i) => macroMasks[Number(i)]) : s

  // littéraux/commentaires Civet (chaînes, heredocs, `#…`/`###…###`/`//…`/`/*…*/`) puis
  // commentaires HTML (`<!-- … -->`) → espaces même-longueur, findScriptMatches (plus haut).
  // Cet ORDRE est ce qui rend le 2e masquage sûr : un `<!--` littéral écrit DANS une chaîne/un
  // commentaire Civet est déjà blanchi par `maskInertSameLength`, donc invisible à
  // `maskHtmlComments` — il ne peut plus amorcer un faux commentaire qui avalerait le vrai
  // `</script>` qui suit. Sans ce 2e passage, un `<script>…</script>` ENTIER écrit dans
  // `<!-- … -->` était retrouvé par la regex et devenait LE script réel du composant (mettre un
  // bloc de côté en le commentant ne le désactivait pas).
  //
  // 1. <script module>
  // `\bmodule\b` (pas la sous-chaîne `module`) : `<script data-modulex>`
  // ne doit pas être classé « module ». Group 1 non-gourmand pour ne pas avaler
  // un `module` situé plus loin. Recherche sur la vue Civet masquée (offsets alignés
  // sur `scan`), relecture du texte réel via `m.indices` (drapeau `d`).
  const { moduleScripts: allModuleScripts, scripts: allScripts } = findScriptMatches(scan)
  const moduleMatch = allModuleScripts[0]
  const moduleSection: ScriptSection = { raw: '', lang: defaultScriptLang, startLine: 1 }
  if (moduleMatch) {
    const idx = moduleMatch.indices!
    const attrs = `${scan.slice(...idx[1])} ${scan.slice(...idx[2])}`
    checkSectionAttrs('script', attrs, ['module', 'lang'])
    const explicitLang = extractLang(attrs) as SupportedLang | null
    moduleSection.raw = dedent(scan.slice(...idx[3]))
    moduleSection.lang = explicitLang ?? defaultScriptLang
    moduleSection.startLine = lineOfOffset(scan, idx[3][0])
  }
  if (allModuleScripts.length > 1) {
    throw new Error(t('transpiler.script-module-double', { n: allModuleScripts.length, nAutres: allModuleScripts.length - 1 }))
  }

  // 2. <script> (sans `module`) — déjà calculé par findScriptMatches ci-dessus (allScripts)
  const standardScript = allScripts[0]
  const script: ScriptSection = { raw: '', lang: defaultScriptLang, startLine: 1 }
  if (standardScript) {
    const idx = standardScript.indices!
    const attrs = scan.slice(...idx[1])
    checkSectionAttrs('script', attrs, ['module', 'lang'])
    const explicitLang = extractLang(scan.slice(...idx[1])) as SupportedLang | null
    script.raw = dedent(scan.slice(...idx[2]))
    script.lang = explicitLang ?? defaultScriptLang
    script.startLine = lineOfOffset(scan, idx[2][0])
  }
  if (allScripts.length > 1) {
    throw new Error(t('transpiler.script-double', { n: allScripts.length, nAutres: allScripts.length - 1 }))
  }

  // vue masquée pour <style> : chaînes/commentaires CSS/SASS (masqueur LOCAL, pas INERT_RE) +
  // plages des <script module>/<script> déjà trouvés neutralisées (un `<style>`/`</style>`
  // littéral DANS un script ne doit pas polluer la recherche du bloc <style> réel) + COMMENTAIRES
  // HTML : un bloc mis en commentaire (ancienne version gardée en référence, exemple documenté)
  // doit rester INERTE. Ce masquage n'existait qu'au niveau de <routes>, plus bas ; <style
  // name="…"> et <theme>, tous deux NEUFS, ne l'avaient pas — un `<theme name="dark">` commenté
  // ressortait dans `themes`, et avec la version active à côté le build échouait sur « deux blocs
  // <theme name="dark"> » ; seul, le commenté REMPLAÇAIT l'actif. Posé en amont des trois
  // extractions (findStyleMatches, plus haut), pour qu'aucune ne puisse encore l'oublier.
  //
  // 3. <style> — le bloc SANS nom est le style de base du composant (embarqué) ; chaque
  // `<style name="bandeau">` est un VARIANT, sorti dans son propre fichier et chargé
  // seulement quand elle sert. Un seul bloc sans nom, un seul par nom.
  const styleResult = findStyleMatches(scan, [...allModuleScripts, ...allScripts])
  const allStyles    = styleResult.matches
  const maskedStyle  = styleResult.maskedView
  const style: StyleSection = { raw: '', lang: defaultStyleLang, sharedCssNames: [], moduleDisplay: 'block', moduleViewTransition: null, moduleViewTransitionPriority: 1 }
  const layouts: LayoutSection[] = []
  let styleVus = 0
  for (const m of allStyles) {
    const idx = m.indices!
    const attrs = scan.slice(...idx[1])
    checkSectionAttrs('style', attrs, ['lang', 'name', '@css', '@display', '@viewTransition', '@vt'])
    const nom = extractAttr(attrs, 'name')
    const lang = (extractLang(attrs) as 'css' | 'sass' | 'scss') ?? defaultStyleLang
    const raw = dedent(scan.slice(...idx[2]))
    if (nom === '') {
      styleVus++
      if (styleVus > 1) throw new Error(t('transpiler.style-double', { n: styleVus, nAutres: styleVus - 1 }))
      style.lang = lang
      style.raw  = raw

      // @css/@display/@viewTransition — RELOGÉS : attributs
      // du `<style>` de base, plus des directives racine (cf. directives.ts).
      // `@viewTransition` sans alias `@vt` ici (RETIRÉ, cf. extractStyleViewTransition).
      const cssAttr = extractAttrValue(attrs, '@css')
      if (cssAttr !== null) {
        style.sharedCssNames = cssAttr.split(/[ \t]+/).map(s => s.trim()).filter(s => s.length > 0)
      }
      const displayAttr = extractAttrValue(attrs, '@display')
      if (displayAttr !== null) style.moduleDisplay = displayAttr
      const vt = extractStyleViewTransition(attrs)
      if (vt) {
        // MÊME ORDRE DE JUGEMENT QUE `<@view>` (transpiler/index.ts) : c'est ce qui rend les deux
        // niveaux de navigation interchangeables — une écriture refusée ici l'est aussi là-bas,
        // avec le MÊME message. Le durcissement a fermé les trois écarts.
        const rest: string | undefined = vt.rest
        if (vt.aliasVt) throw new Error(t('transpiler.vt-alias-sur-style-interdit'))
        if (vt.malformed) throw new Error(t('transpiler.viewtransition-forme-invalide-sur-style', { label: vt.label, rest }))
        if (rest === undefined) {
          style.moduleViewTransition = 'on'
        } else if (rest[0] === '.') {
          const dm = rest.match(/^\.([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)(?:[ \t]*=[ \t]*\{([^}]*)\})?$/)
          if (!dm) throw new Error(t('transpiler.viewtransition-forme-invalide-sur-style', { label: vt.label, rest }))
          const nameAndDir: string = dm[1]
          const optsRaw: string | undefined = dm[2]
          const base = nameAndDir.split(':')[0]
          if (base === 'off') throw new Error(t('transpiler.vt-off-nexiste-pas', { label: vt.label }))
          if (base === 'on') throw new Error(t('transpiler.vt-on-implicite', { label: vt.label }))
          // Le suffixe `:direction` n'existe plus, la SEULE façon d'orienter est la
          // clé d'option ; le nom le CAPTURE tout de même pour pouvoir le refuser (cf. l'extracteur).
          if (nameAndDir.includes(':')) throw new Error(t('transpiler.vt-direction-plus-dans-nom', { label: vt.label, example: `${vt.label}.cube={ dir: left }` }))
          const verbatim = optsRaw !== undefined ? `${nameAndDir}={${optsRaw}}` : nameAndDir
          const parsed = parseVtValue(verbatim)
          // cast explicite : strictNullChecks:false désactive le narrowing natif des unions
          // discriminées (même piège que directives.ts/bundler/config.ts, cf. leurs commentaires).
          if (!parsed.ok) throw new Error(t('transpiler.vt-nom-erreur-parsing', { label: vt.label, nameAndDir: verbatim, erreur: (parsed as { ok: false, error: string }).error }))
          // AUCUN CONTRÔLE DE LA BASE ICI (revenant sur le durcissement
          // du matin) : `µ._vtPresets` reste garnissable par l'appli, et un nom qu'on ne connaît pas
          // au build peut très bien exister au runtime. Le nom mal tapé retombe sur le `µ.warn` de
          // `µ._mjs_vtApplyPreset`. Seuls les deux refus de FORME restent — le suffixe `:direction`
          // ci-dessus et l'étiquette calculée plus bas : eux ne dépendent d'aucun dictionnaire.
          const okParsed = parsed as { ok: true, value: { priority: number | null } }
          style.moduleViewTransition = verbatim
          if (okParsed.value.priority != null) style.moduleViewTransitionPriority = okParsed.value.priority
        } else if (rest[1] === '"' || rest[1] === "'") {
          throw new Error(t('transpiler.viewtransition-guillemets-sur-style', { label: vt.label }))
        } else if (rest[1] === '{') {
          throw new Error(t('transpiler.viewtransition-etiquette-calculee-interdite', { expr: rest.slice(2, -1) }))
        } else {
          throw new Error(t('transpiler.viewtransition-forme-invalide-sur-style', { label: vt.label, rest }))
        }
      }
    } else {
      const forbidden = findRelocatedStyleAttrToken(attrs)
      if (forbidden) throw new Error(t('transpiler.style-attr-sur-layout', { attribut: forbidden, nom }))
      if (!THEME_NAME_RE.test(nom))                 throw new Error(t('transpiler.layout-name-invalide', { nom }))
      // « default » : le composant lui-même, sans modèle ({? default}, layout="default")
      if (nom === 'default')                        throw new Error(t('transpiler.layout-default'))
      if (layouts.some(ly => ly.name === nom))      throw new Error(t('transpiler.layout-double', { nom }))
      layouts.push({ raw, lang, name: nom })
    }
  }

  // 3-bis. <theme> — mêmes règles de masquage que <style> (c'est du SASS), plus les
  // plages du <style> déjà trouvé neutralisées : un `<theme>` cité DANS le style (ou
  // dans un script) ne doit pas être pris pour une section. Contrairement à <style>,
  // PLUSIEURS blocs sont permis — un seul sans nom, un seul par nom.
  let maskedTheme = maskedStyle
  for (const m of allStyles) {
    const [start, end] = m.indices![0]
    maskedTheme = blankRange(maskedTheme, start, end)
  }
  const allThemes = [...maskedTheme.matchAll(/^[ \t]*<theme\b([^>]*)>([\s\S]*?)<\/theme>/gmd)]
  const themes: ThemeSection[] = []
  for (const m of allThemes) {
    const idx = m.indices!
    const attrs = scan.slice(...idx[1])
    checkSectionAttrs('theme', attrs, ['name', 'lang'])
    const name = extractAttr(attrs, 'name')
    if (name !== '' && !THEME_NAME_RE.test(name)) throw new Error(t('transpiler.theme-name-invalide', { nom: name }))
    if (themes.some(th => th.name === name)) throw new Error(t('transpiler.theme-double', { nom: name }))
    themes.push({
      raw:     dedent(scan.slice(...idx[2])),
      lang:    (extractLang(attrs) as 'css' | 'sass' | 'scss') ?? defaultStyleLang,
      name,
    })
  }

  // 3-ter. <routes target="…"> — bloc racine, RÉPÉTABLE (un par outlet), table de routes
  // FIXES. Même masquage que <theme> plus les plages des <theme> déjà trouvés neutralisées.
  let maskedRoutes = maskedTheme
  for (const m of allThemes) {
    const [start, end] = m.indices![0]
    maskedRoutes = blankRange(maskedRoutes, start, end)
  }
  // (les commentaires HTML sont masqués une seule fois, en amont de `maskedStyle` — ce masquage
  // vivait ici, il couvre désormais <style>, <style name>, <theme> ET <routes>)
  const allRoutesBlocks = [...maskedRoutes.matchAll(/^[ \t]*<routes\b([^>]*)>([\s\S]*?)<\/routes>/gmd)]
  const routes: RoutesSection[] = []
  for (const m of allRoutesBlocks) {
    const idx = m.indices!
    const attrs  = scan.slice(...idx[1])
    checkSectionAttrs('routes', attrs, ['target'])
    const target = extractAttr(attrs, 'target')
    if (target === '') throw new Error(t('transpiler.routes-target-manquant'))
    if (routes.some(r => r.target === target)) throw new Error(t('transpiler.routes-target-double', { target }))
    const raw = dedent(scan.slice(...idx[2]))
    routes.push({ raw, target, entries: parseRoutesLines(raw, target) })
  }

  // 3-quinquies. <vars> (composant) et <types> (fichier *.types.mjs) — des lignes de règles, même
  // masquage que <routes> plus les plages des <routes> déjà trouvés neutralisées. Aucun attribut ;
  // un seul <vars>, toujours AVANT le <script> : la règle d'une variable se lit avant le code qui
  // l'écrit.
  let maskedVars = maskedRoutes
  for (const m of allRoutesBlocks) {
    const [start, end] = m.indices![0]
    maskedVars = blankRange(maskedVars, start, end)
  }
  const allVars = [...maskedVars.matchAll(/^[ \t]*<vars\b([^>]*)>([\s\S]*?)<\/vars>/gmd)]
  for (const m of allVars) {
    const [start, end] = m.indices![0]
    maskedVars = blankRange(maskedVars, start, end)
  }
  const allTypes = [...maskedVars.matchAll(/^[ \t]*<types\b([^>]*)>([\s\S]*?)<\/types>/gmd)]
  // <effects> (fichier *.effects.mjs) : les effets de l'appli, lus par effects/project.ts
  let maskedEffects = maskedVars
  for (const m of allTypes) {
    const [start, end] = m.indices![0]
    maskedEffects = blankRange(maskedEffects, start, end)
  }
  const allEffects = [...maskedEffects.matchAll(/^[ \t]*<effects\b([^>]*)>([\s\S]*?)<\/effects>/gmd)]
  if (allVars.length > 1) throw new Error(t('transpiler.vars-double', { n: allVars.length }))
  const typesSection = (m: RegExpMatchArray, tag: string): TypesSection => {
    const idx = m.indices!
    if (scan.slice(...idx[1]).trim() !== '') throw new Error(t('transpiler.section-sans-attribut', { tag, attributs: scan.slice(...idx[1]).trim() }))
    return { raw: dedent(scan.slice(...idx[2])), startLine: lineOfOffset(scan, idx[2][0]) }
  }
  const vars  = allVars.length > 0 ? typesSection(allVars[0], 'vars') : null
  const types = allTypes.map(m => typesSection(m, 'types'))
  const effects = allEffects.map(m => typesSection(m, 'effects'))
  if (allVars.length > 0) {
    const debutVars   = allVars[0].indices![0][0]
    const premierCode = [...allModuleScripts, ...allScripts].map(m => m.indices![0][0]).filter(o => o < debutVars)
    if (premierCode.length > 0) throw new Error(t('transpiler.vars-apres-script', { ligne: lineOfOffset(scan, debutVars) }))
  }

  // 4. HTML : tout sauf les <script>/<style>/<theme>/<routes> déjà repérés (au plus
  //    1 script et les doublons ont déjà levé throw ci-dessus). Retrait par PLAGES d'offsets
  //    (jamais une regex ré-exécutée sur `scan` — même piège que le bug corrigé),
  //    puis restauration des blocs <@head>/<@failed> masqués en tête de fonction.
  // Un bloc retiré SANS rien à sa place décale vers le HAUT
  // toutes les lignes qui le suivent : le parseur et le générateur (`node.line`/`currentLine`
  // posés sur CE `html`) citent alors un numéro FAUX pour toute erreur après un <script>/
  // <style>/<theme>/<routes> (`{await}` en ligne 6 du .mjs cité « ligne 2 »). Remplacé par un
  // commentaire HTML inerte de MÊME hauteur (mêmes `\n` que le bloc retiré) : `parseComment`
  // (parser/index.ts) ne produit NI texte NI nœud pour un commentaire — zéro trace dans l'AST,
  // dans `surgicalHtml` ou dans la sortie compilée, seuls les OFFSETS DE LIGNE du reste du
  // gabarit restent justes.
  // SEUIL `> 0` retour à la ligne, volontaire : un bloc qui tient sur UNE SEULE ligne (aucun
  // `\n` interne) laisse `extractSections(...).html` byte-identique à avant (padding omis) —
  // tests/sections-macro-tag.test.ts (s1-s4, `<script>real=1</script>` etc.) compare CE champ
  // au caractère près. Limite CONNUE, non corrigée ici : un bloc
  // top-level à une seule ligne laisse un décalage résiduel d'1 ligne pour ce qui le suit (le
  // séparateur `\n` d'origine, lui, est mangé par le `.trim()` final, cf. plus bas) — seuls les
  // blocs MULTI-LIGNES (le cas réel de la quasi-totalité des `<script>`/`<style>`) sont couverts.
  const cuts = [...allModuleScripts, ...allScripts, ...allStyles, ...allThemes, ...allRoutesBlocks, ...allVars, ...allTypes, ...allEffects].map(m => m.indices![0]).sort((a, b) => a[0] - b[0])
  let html = ''
  let cursor = 0
  for (const [start, end] of cuts) {
    html += scan.slice(cursor, start)
    const nl = countNewlines(scan.slice(start, end))
    if (nl > 0) html += `<!--${'\n'.repeat(nl)}-->`
    cursor = end
  }
  html += scan.slice(cursor)

  // GARDE-FOU reliquats lexer — un `</script>`/`</style>` ORPHELIN
  // encore présent dans le HTML résiduel est le symptôme certain d'une extraction
  // partie en vrille : (a) backtick imbriqué dans une interpolation, ex.
  // `` `…${`</script>`}…` `` — CORRIGÉ À LA SOURCE : le masquage
  // des littéraux repose depuis sur un LECTEUR À NIVEAUX (lexer/index.ts), qui
  // referme le backtick extérieur au bon endroit ; ce cas ne parvient donc plus
  // jusqu'ici (cf. tests/lexer-backtick-imbrique.test.ts) ;
  // (b) chaîne non terminée (typo) contenant `</script>`/`</style>` : le lecteur
  // n'a rien à masquer (pas de guillemet fermant), fuite silencieuse ;
  // (c) une balise d'OUVERTURE en
  // majuscules (`<SCRIPT>`/`<Script>`/`<STYLE>`) : les 3 regex d'extraction
  // sont sensibles à la casse (`<script…`/`<style…`), donc jamais reconnues —
  // le contenu entier (avec sa fermeture, elle bien matchée par le `/i` du
  // check ci-dessous) fuit dans le HTML. Choix CONSERVATEUR (vs. rendre les 3
  // regex d'extraction elles-mêmes insensibles à la casse) : un `i` là-bas
  // toucherait aussi le filtre `\bmodule\b` de la section 2 et pourrait
  // classer un même `<SCRIPT MODULE>` dans les DEUX listes (double comptage) —
  // risque de régression pour un cas 0-occurrence sur le corpus réel. Ici on
  // se contente d'un message qui NOMME la vraie cause, jamais silencieux.
  // Testé sur `html` AVANT `restoreMacros` : le contenu des blocs <@head>/
  // <@failed> (qui peut légitimement contenir `<script src>…</script>`) est
  // encore un placeholder `\x00MJSHF…\x00` à ce stade, donc hors-jeu (0 faux
  // positif sur les 572 composants réels du corpus).
  // Un masquage <pre>/
  // <code> avait été ajouté ici pour couvrir l'hypothèse d'un `</script>`/
  // `</style>` LITTÉRAL affiché en texte dans un bloc de doc/tuto. RETIRÉ :
  // ce masquage (regex LAZY, sans
  // vérification d'appariement) masquait à travers un `<pre>` NON FERMÉ —
  // une vraie fuite d'extraction (chaîne non fermée contenant `</script>`)
  // située entre ce `<pre>` orphelin et un `</pre>` distant SANS RAPPORT
  // devenait invisible : FAUX NÉGATIF, `script.raw` silencieusement tronqué,
  // exactement le trou que ce garde-fou existe pour combattre. Le faux
  // positif que le masquage protégeait est un cas à ZÉRO occurrence réelle
  // (572 .mjs du corpus réel : aucun composant n'affiche un `</script>`/
  // `</style>` LITTÉRAL non échappé — tous échappent en `&lt;/script&gt;`,
  // qui ne matche pas cette regex et ne déclenche jamais le check). Le garde
  // redevient donc STRICT : tout `</script>`/`</style>` orphelin dans le HTML
  // résiduel throw, y compris à l'intérieur d'un `<pre>`/`<code>`.
  // NUANCE COMMENTAIRE : un bloc mis en COMMENTAIRE HTML est volontairement inerte — l'extraction
  // l'ignore (masquage posé en amont de `maskedCivet`/`maskedStyle`, §1 et §3) — donc sa balise
  // fermante n'est pas un orphelin. Vaut désormais pour `</script>` COMME pour `</style>`/
  // `</theme>`/`</routes>` : le masquage des commentaires HTML tourne AVANT la recherche des
  // scripts elle-même (§1), en toute sécurité (il s'applique APRÈS le masquage des littéraux
  // Civet — un `<!--` écrit dans une chaîne/un commentaire de code est donc déjà blanchi, il ne
  // peut plus amorcer un faux commentaire qui avalerait un `</script>` réel). Un `</script>`
  // trouvé ICI, dans le HTML résiduel, ne peut donc jamais venir d'un bloc rendu inerte : il
  // signale toujours la vraie fuite d'extraction que ce garde-fou existe pour attraper.
  // Un `</script>` écrit dans la VALEUR d'un attribut (`title="a </script> b"`, HTML valide) n'est pas une fuite : les valeurs
  // entre guillemets des balises bien formées ne sont pas lues (masqueValeursAttributs), seulement quand une balise est en vue
  const htmlHorsCommentaires = maskHtmlComments(html)
  const ORPHELIN_RE = /<\/(?:script|style|theme|routes|vars|types|effects)>/i
  const orphanTag = ORPHELIN_RE.test(htmlHorsCommentaires) ? masqueValeursAttributs(htmlHorsCommentaires).match(ORPHELIN_RE) : null
  if (orphanTag) {
    throw new Error(t('transpiler.balise-orpheline-html', { balise: orphanTag[0] }))
  }

  const htmlRestored = restoreMacros(html)
  // ce que le `.trim()` mange en tête donne la ligne de départ du HTML (les blocs retirés, eux,
  // gardent leur hauteur)
  const htmlStartLine = lineOfOffset(htmlRestored, htmlRestored.length - htmlRestored.trimStart().length)
  html = htmlRestored.trim()

  return { module: moduleSection, script, style, layouts, themes, routes, vars, types, effects, html, htmlStartLine, warnings }
}
