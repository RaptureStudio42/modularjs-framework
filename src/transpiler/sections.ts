// transpiler/sections — extraction des sections <script module>, <script>, <style>, HTML.
// Port de la section "extraction" de la V1 Ruby, transpiler.rb.

import { SIGN, SIGN_RE, STYLE_WORDS } from '../parser/mjs-words.js'
import type { SupportedLang } from '../languages/index.js'
import { dedent } from '../generator/state.js'
import { maskInertSameLength, maskHtmlComments, createMaskTable, readHtmlComment } from '../mask.js'
import { KEPT_MJS_COMMENT, scanDoubleQuoteAt, scanInertAt, scriptStringEnd, opensHashBlock } from '../lexer/index.js'
import { LINE_CARRIER_OPEN } from '../parser/index.js'
import { t } from '../messages/index.js'
import { parseVtValue, suggestKey } from '../bundler/config.js'
import { findMacroTagEnd, asciiLower } from './macro-tag.js'
import { tagReader } from './tag-reader.js'
import { FaultFix } from '../fault-fix.js'

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
  /** Noms des CSS partagés (`<style :css="base typo">`, relogé racine → attribut). */
  sharedCssNames: string[]
  /** Override du `:host{display:X}` (`<style :display="inline-block">`). */
  moduleDisplay: string
  /** Transitions de page par défaut du module (`<style :viewTransition.<nom>={…}>`) —
   *  chaîne VERBATIM (`<nom>` ou `<nom>={ direction: …, duration: …, priority: … }`),
   *  relue au runtime par µ._mjs_vtParse (mjs_vt_presets.ts) ; null si absente. */
  moduleViewTransition: string | null
  /** Priorité (façon z-index) de `:viewTransition`/`@vt` — cf. directives.ts
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
  /** ligne du bloc dans la source (1 = première) */
  line?: number
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
export function extractLang(attrs: string): string | null {
  const m = attrs.match(/lang[ \t]*=[ \t]*['"]([^'"]+)['"]/)
  return m ? m[1] : null
}

// extractAttr — même principe que extractLang, espaces autour du `=` tolérés, pour le `name=` d'un <theme> ou d'un <style>
function extractAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`${name}[ \\t]*=[ \\t]*['"]([^'"]*)['"]`))
  return m ? m[1] : ''
}

// extractAttrValue — variante d'extractAttr pour un nom d'attribut portant un `@`
// (littéral en regex, aucun échappement nécessaire) ; null si absent.
function extractAttrValue(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}[ \\t]*=[ \\t]*(['"])([^'"]*)\\1`))
  return m ? m[2] : null
}

// noms d'attributs d'une balise de section, base avant le 1er `.` (`:viewTransition.zoom` → `:viewTransition`)
const SECTION_ATTR_RE = /([@:]?[a-zA-Z][a-zA-Z0-9:_.-]*)(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+))?/g

// attribut inconnu sur <style>/<script>/<theme>/<routes> = ERREUR : ces balises n'atteignent jamais le DOM, rien d'autre que la liste attendue n'y a de sens — suggestion à ≤2 lettres quand il y en a une
// `texte` et `debut` (le fichier lu et la place des attributs, même longueur que la source) : la ligne de l'attribut, pour la
// correction que porte le refus quand il a une suggestion (`mjs check` la pose le temps de la relecture, cf. fault-fix.ts)
function checkSectionAttrs(tag: string, attrs: string, allowed: string[], text?: string, start?: number): void {
  for (const m of attrs.matchAll(SECTION_ATTR_RE)) {
    const base = m[1].split('.')[0]
    if (allowed.includes(base)) continue
    const expected   = allowed.join(', ')
    const suggestion = suggestKey(base, allowed)
    const line       = text !== undefined && start !== undefined ? text.slice(0, start + (m.index ?? 0)).split('\n').length : undefined
    if (suggestion) throw FaultFix.attach(new Error(t('transpiler.section-attribute-unknown-suggestion', { tag, attribute: m[1], suggestion, expected: expected })), m[1], suggestion + m[1].slice(base.length), line)
    throw new Error(t('transpiler.section-attribute-unknown', { tag, attribute: m[1], expected: expected }))
  }
}

// extractStyleViewTransition — repère `:viewTransition` sur `<style …>` et rend son RESTE BRUT,
// tel quel : c'est l'APPELANT qui juge, exactement comme le fait déjà `<@view :viewTransition…>`
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
  const m = attrs.match(new RegExp(SIGN_RE + String.raw`(viewTransition|vt)(\.[a-zA-Z][a-zA-Z0-9:_-]*(?:[ \t]*=[ \t]*\{[^}]*\})?|=(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]*))?(?=[ \t]|$)`))
  if (m) return { rest: m[2], aliasVt: m[1] === 'vt', label: `${SIGN}${m[1]}`, malformed: false }
  const raw = attrs.match(new RegExp(SIGN_RE + String.raw`(viewTransition|vt)\b([^\s>]*)`))
  if (!raw) return null
  return { rest: raw[2], aliasVt: raw[1] === 'vt', label: `${SIGN}${raw[1]}`, malformed: true }
}

// findRelocatedStyleAttrToken — un des attributs `:css`/`:display`/`:viewTransition`/`@vt`
// posé sur ce `<style>` (peu importe valué ou nu) — sert à interdire ces attributs
// sur un `<style name="…">` (variant/layout).
function findRelocatedStyleAttrToken(attrs: string): string | null {
  const m = attrs.match(new RegExp(SIGN_RE + String.raw`(css|display|viewTransition|vt)\b`))
  return m ? `${SIGN}${m[1]}` : null
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
    const line = i + 1
    const m = trimmed.match(/^(\S+)[ \t]+(\S+)$/)
    if (!m) throw new Error(t('transpiler.routes-line-invalid', { target, line: line, text: trimmed }))
    const [, path, component] = m
    if (path[0] !== '/') throw new Error(t('transpiler.routes-path-no-slash', { target, line: line, path }))
    if (!validateRoutePath(path)) throw new Error(t('transpiler.routes-path-malformed', { target, line: line, path }))
    if (!ROUTE_COMPONENT_RE.test(component)) throw new Error(t('transpiler.routes-component-invalid', { target, line: line, component }))
    if (seenPaths.has(path)) throw new Error(t('transpiler.routes-path-duplicate', { target, path }))
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
//
// lecteur de ces littéraux : le premier qui commence à `de` ou après, [début, fin), sans relire tout le texte à chaque
// appel : la fin déjà cherchée d'un `/*` ou d'un `url(` est gardée (un `/*` ou un `url(` jamais refermés relisaient le
// texte jusqu'au bout à chacun de leurs appels : temps quadratique)
const LINE_END = new Set(['\n', '\r', ' ', ' '])

function literalReader(scan: string): (from: number) => [number, number] | null {
  const n = scan.length
  // premier `*/` à partir d'une position de [deCom, finCom] : finCom (-1 : aucun après deCom)
  let comStart     = -1
  let comEnd       = -1
  const commentEnd = (x: number): number => {
    if (comStart === -1 || x < comStart || (comEnd !== -1 && x > comEnd)) {
      comStart = x
      comEnd   = scan.indexOf('*/', x)
    }
    return comEnd
  }
  // `)` qui ferme un `url(` lu à partir d'une position de [deUrl, urlStop] : finUrl (-1 : aucune) ; un `\` y garde le
  // caractère qui suit, sauf une fin de ligne. Une position lue juste après `url(` ne tombe jamais au milieu d'un `\x`
  let urlStart    = -1
  let urlStop     = -1
  let urlEnd      = -1
  const closesUrl = (x: number): number => {
    if (urlStart === -1 || x < urlStart || x > urlStop) {
      let i = x
      urlEnd = -1
      while (i < n) {
        const c = scan[i]
        if (c === ')') { urlEnd = i; break }
        if (c === '\\') {
          if (i + 1 >= n || LINE_END.has(scan[i + 1])) break
          i += 2
          continue
        }
        i++
      }
      urlStart = x
      urlStop  = Math.min(i, n)
    }
    return urlEnd
  }
  // fin (après le guillemet) d'une chaîne d'une ligne ouverte en `p`, -1 sans guillemet fermant
  const stringEnd = (p: number): number => {
    const q = scan[p]
    for (let i = p + 1; i < n; i++) {
      const c = scan[i]
      if (c === q) return i + 1
      if (c === '\n') return -1
      if (c === '\\') {
        if (i + 1 >= n || LINE_END.has(scan[i + 1])) return -1
        i++
      }
    }
    return -1
  }
  return (from: number): [number, number] | null => {
    for (let p = from; p < n; p++) {
      const c = scan[p]
      if (c === '\'' || c === '"') {
        const end = stringEnd(p)
        if (end !== -1) return [p, end]
      }
      else if (c === '/') {
        const c1 = scan[p + 1]
        if (c1 === '*') {
          const end = commentEnd(p + 2)
          if (end !== -1) return [p, end + 2]
        }
        else if (c1 === '/') {
          const end = scan.indexOf('\n', p)
          return [p, end === -1 ? n : end]
        }
      }
      else if ((c === 'u' || c === 'U') && scan[p + 3] === '(' && scan.slice(p + 1, p + 3).toLowerCase() === 'rl') {
        const end = closesUrl(p + 4)
        if (end !== -1) return [p, end + 1]
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
  const restarts = [0]
  const literal  = literalReader(scan)
  // position d'où la lecture en cours cherche son prochain littéral
  let rest = 0
  // littéraux de la lecture en cours, dans l'ordre : début, fin, début, fin…
  let read: number[] = []
  let finished = false
  // [a, b) touche-t-il un littéral de la lecture en cours (a après sa relance)
  const mask = (a: number, b: number): boolean => {
    while (!finished && (read.length === 0 || read[read.length - 1] <= a)) {
      const l = literal(rest)
      if (l === null) finished = true
      else {
        read.push(l[0], l[1])
        rest = l[1]
      }
    }
    let low = 0
    let top = read.length / 2
    while (low < top) {
      const middle = (low + top) >> 1
      if (read[middle * 2 + 1] <= a) low = middle + 1
      else top = middle
    }
    return low < read.length / 2 && read[low * 2] < b
  }
  let pos = 0
  for (;;) {
    open.lastIndex = pos
    const m = open.exec(scan)
    if (!m) break
    const tag    = '<' + m[1]
    const at     = m.index + m[0].length - tag.length
    const script = scriptMatches.find(s => s.indices![0][0] <= at && at < s.indices![0][1])
    if (script) {
      pos = script.indices![0][1]
      continue
    }
    if (mask(at, at + tag.length)) {
      restarts.push(at)
      rest     = at
      read     = []
      finished = false
    }
    const close = new RegExp('</' + m[1] + '>', caseInsensitive ? 'gi' : 'g')
    close.lastIndex = at
    let c = close.exec(scan)
    while (c !== null && mask(c.index, c.index + c[0].length)) {
      close.lastIndex = c.index + 1
      c = close.exec(scan)
    }
    if (!c) {
      if (m[1].toLowerCase() === 'style') break
      pos = at + tag.length
      continue
    }
    pos = c.index + c[0].length
  }
  const pieces: string[] = []
  for (let k = 0; k < restarts.length; k++) {
    const start = restarts[k]
    const stop   = k + 1 < restarts.length ? restarts[k + 1] : scan.length
    let cursor  = start
    for (let l = literal(start); l !== null && l[0] < stop; l = literal(l[1])) {
      const end = Math.min(stop, l[1])
      pieces.push(scan.slice(cursor, l[0]), scan.slice(l[0], end).replace(/[^\n]/g, ' '))
      cursor = end
    }
    pieces.push(scan.slice(cursor, stop))
  }
  return pieces.join('')
}

// attrValueMask — valeurs d'attribut des balises ouvrantes du HTML blanchies (même longueur) : entre guillemets sur une
// ligne, nues (jusqu'au blanc ou au `>`, comme les lit le navigateur : `title=a</script>b` vaut `a</script`), et le contenu
// des accolades `{…}`, chaînes comprises.
// Lecture stricte d'une balise : son nom, puis des attributs séparés par des blancs — `nom` (réglages `(…)` d'un effet compris),
// `nom=valeur` ou `{…}`, la valeur entre guillemets, entre accolades ou nue — jusqu'à `>` ou `/>`. Une balise qui ne s'y plie pas
// n'est pas lue : un reste de script échappé de l'extraction (`if a <b then c` puis `</script>` à la ligne) n'est pas une balise
const ATTR_NAME_RE  = /[^\s"'<>/=(){}`]+/y
const SETTINGS_RE   = /\((?:[^()<>\n]|\([^()<>\n]*\))*\)/y
const EQUALS_RE     = /\s*=\s*/y
const BARE_VALUE_RE = /[^\s>]+/y

export function attrValueMask(html: string): string {
  const reader                     = tagReader(html)
  const values: [number, number][] = []
  const tag                        = /<[A-Za-z@][\w:.@-]*/g
  const readAt                        = (re: RegExp, i: number): number => {
    re.lastIndex = i
    return re.test(html) ? re.lastIndex : -1
  }
  for (let m = tag.exec(html); m !== null; m = tag.exec(html)) {
    const found: [number, number][] = []
    let i = m.index + m[0].length
    let end = -1
    for (;;) {
      const blank = i
      while (i < html.length && /\s/.test(html[i])) i++
      if (html[i] === '>') { end = i; break }
      if (html.startsWith('/>', i)) { end = i + 1; break }
      if (i === blank) break
      if (html[i] === '{') {
        const closes = reader.braceEnd(i + 1)
        if (closes === -1) break
        found.push([i + 1, closes])
        i = closes + 1
        continue
      }
      i = readAt(ATTR_NAME_RE, i)
      if (i === -1) break
      if (html[i] === '(') {
        i = readAt(SETTINGS_RE, i)
        if (i === -1) break
      }
      const equals = readAt(EQUALS_RE, i)
      if (equals === -1) continue
      i = equals
      const q = html[i]
      if (q === '"' || q === '\'') {
        const closes = html.indexOf(q, i + 1)
        if (closes === -1) break
        if (!html.slice(i + 1, closes).includes('\n')) found.push([i + 1, closes])
        i = closes + 1
      }
      else if (q === '{') {
        const closes = reader.braceEnd(i + 1)
        if (closes === -1) break
        found.push([i + 1, closes])
        i = closes + 1
      }
      else {
        const start = i
        i = readAt(BARE_VALUE_RE, i)
        if (i === -1) break
        found.push([start, i])
      }
    }
    if (end === -1) continue
    values.push(...found)
    tag.lastIndex = end + 1
  }
  const pieces: string[] = []
  let cursor = 0
  for (const [start, end] of values) {
    pieces.push(html.slice(cursor, start), ' '.repeat(end - start))
    cursor = end
  }
  pieces.push(html.slice(cursor))
  return pieces.join('')
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
// lecture de gauche à droite, sur le texte sans commentaires (removeComments, plus bas) : la première ouverture
// rencontrée décide ; un <script> en tête de ligne est sauté jusqu'à sa fin de findScriptMatches (premier `</script>` hors
// des littéraux), un <style> ou un bloc <theme>, <routes>, <vars>, <types>, <effects> en tête de ligne jusqu'à sa
// fermeture : un `<@head>` / `<@failed>` cité dans une chaîne du script, du module ou dans le texte d'un style reste du
// texte, sans jeton dans le code ; un bloc jamais refermé n'est pas sauté (comme les regex des sections) ; dans un vrai
// bloc, la première fermeture écrite, comme avant (une interpolation `{"</@head>"}` le ferme là, refus bruyant plus loin) ;
// chaque recherche garde sa dernière réponse (temps linéaire)
function maskHeadFailedBlocks(src: string, stash: (block: string, at: number) => string): string {
  const lower = asciiLower(src)
  if (!lower.includes('<@head') && !lower.includes('<@failed')) return src
  const opener                      = /^[ \t]*<(script|style|(?:theme|routes|vars|types|effects)(?=[\s>]))/gm
  const last                        = { head: lower.lastIndexOf('</@head>'), failed: lower.lastIndexOf('</@failed>') }
  let civet: string | null          = null
  let block: RegExpExecArray | null = null
  let readBlocks                    = false
  let head                          = -2
  let failure                       = -2
  let out                           = ''
  let copy                          = 0
  let pos                           = 0
  for (;;) {
    if (head !== -1 && head < pos) head = lower.indexOf('<@head', pos)
    if (failure !== -1 && failure < pos) failure = lower.indexOf('<@failed', pos)
    const idx = head === -1 ? failure : (failure === -1 ? head : Math.min(head, failure))
    if (idx === -1) break
    if (!readBlocks && (block === null || block.index < pos)) {
      opener.lastIndex = pos
      block            = opener.exec(src)
      readBlocks       = block === null
    }
    if (block !== null && block.index < idx) {
      const name = block[1]
      const at   = block.index + block[0].length - name.length - 1
      let end    = -1
      if (name === 'script') {
        civet ??= maskScriptsCivet(src, false)
        end = civet.indexOf('</script>', at)
      }
      else end = src.indexOf(`</${name}>`, at)
      pos = end === -1 ? at + name.length + 1 : end + name.length + 3
      continue
    }
    const name     = idx === head ? 'head' : 'failed'
    const nameEnd  = idx + `<@${name}`.length
    const boundary = src[nameEnd]
    const tagEnd   = boundary !== undefined && /[\w-]/.test(boundary) ? -1 : findMacroTagEnd(src, nameEnd)
    const closeIdx = tagEnd === -1 || tagEnd + 1 > last[name] ? -1 : lower.indexOf(`</@${name}>`, tagEnd + 1)
    if (closeIdx === -1) {
      pos = idx + 1
      continue
    }
    const wholeEnd = closeIdx + `</@${name}>`.length
    out           += src.slice(copy, idx) + stash(src.slice(idx, wholeEnd), idx)
    copy           = pos = wholeEnd
  }
  return copy === 0 ? src : out + src.slice(copy)
}

// ----------------------------------------------------------------------------
// removeComments — PREMIER geste de la lecture d'un composant (extractSections, plus bas) : tous les commentaires de
// l'auteur retirés, avant les sections, les masques, les macros et le gabarit, qui lisent un texte plus court où aucun
// commentaire n'ouvre plus une section, une macro ou une chaîne. Lecture de gauche à droite, comme le navigateur :
// - gabarit : commentaire HTML (bornes du navigateur, readHtmlComment), jamais dans une balise (valeur d'attribut), une
//   interpolation `{…}`, le texte d'un <textarea> ou d'un <title> ;
// - <script> du composant (en tête de ligne, hors <@head> / <@failed>), par le lexeur (scanInertAt, scanDoubleQuoteAt) :
//   Civet `#…`, `###…###`, `//…`, `/*…*/` (`#nom` est un symbole, `///…///` une regex) ; Coffee `#…`, `###…###` (`//` y
//   est la division entière, `///…///` une regex) ; JS et TS `//…`, `/*…*/` (`#x` est un champ privé) ;
// - <style> du composant : `/*…*/`, et `//…` en SASS / SCSS (literalReader : chaînes et `url(…)` gardées).
// Un commentaire part avec son texte, ses sauts de ligne restent (lignes des erreurs et des tables de correspondance) ;
// dans le gabarit, ils restent dans un porteur de lignes (LINE_CARRIER_OPEN) que la sortie ignore (un saut nu y serait une
// espace) ; un `/*…*/` qui soudait deux mots laisse une espace. Seule exception, le commentaire MJS `//!` jusqu'à la fin
// de la ligne : rien n'y est lu, il sort dans le code produit (tel quel dans un script Civet, JS ou TS, en `###! … ###` en
// Coffee, en `/*! … */` dans un style), sauf si KEPT_MJS_COMMENT est faux ; dans le gabarit, `//!` est du texte.
// Laissés tels quels : un `<!--` jamais refermé ; les scripts et styles d'un <@head> / <@failed> ; les blocs <types>,
// <vars>, <effects>, <theme>, <routes> ; un commentaire dans une interpolation `#{…}` / `${…}` ; colonnes : celles qui
// suivent un commentaire posé en milieu de ligne reculent de sa longueur.
// À longueur égale (`sameLength`, pour les bornes des sections lues par le lecteur du fichier, sectionBounds plus bas) : même
// lecture, chaque commentaire blanchi au lieu d'être retiré, sauts de ligne gardés ; un commentaire HTML de plusieurs lignes garde
// ses délimiteurs, comme le porteur de lignes qui le remplace ; un `//!` d'un script Coffee ou d'un style est blanchi lui aussi
// ----------------------------------------------------------------------------
type CommentLanguage = 'civet' | 'coffee' | 'js'

const WORD_RE      = /[\w$µ]/
const RAW_RE       = /^(?:script|style|textarea|title)$/
const BLOCK_MJS_RE = /^(?:types|vars|effects|theme|routes)$/
const OPENING_RE   = /<(\/?)(@?[a-zA-Z][\w-]*)/y

// langue des commentaires d'un script : Coffee, JS (TS compris) ou Civet (défaut)
function scriptLangOf(lang: string): CommentLanguage {
  if (/coffee/.test(lang)) return 'coffee'
  return /^(?:js|ts|javascript|typescript|jsx|tsx)$/.test(lang) ? 'js' : 'civet'
}

// ce qui remplace le commentaire [a, b) de `src` : ses seuls sauts de ligne, une espace s'il soudait deux mots ; à longueur égale
// (`sameLength`), le commentaire blanchi
function blankOf(src: string, a: number, b: number, sameLength = false): string {
  if (sameLength) return src.slice(a, b).replace(/[^\n]/g, ' ')
  const jumps = src.slice(a, b).replace(/[^\n]/g, '')
  return jumps === '' && WORD_RE.test(src[a - 1] ?? '') && WORD_RE.test(src[b] ?? '') ? ' ' : jumps
}

// fin de la ligne de `i` : position de son saut, ou fin du texte
function lineEnd(src: string, i: number): number {
  const e = src.indexOf('\n', i)
  return e === -1 ? src.length : e
}

// script du composant ouvert jusqu'à `de` : [texte sans ses commentaires, `</script>` compris ; position qui le suit],
// null s'il n'est jamais refermé ; fin au premier `</script>` hors des littéraux, comme findScriptMatches ; à longueur égale
// (`sameLength`), chaque commentaire blanchi ; une chaîne de Civet ou de CoffeeScript écrite sur plusieurs lignes est lue jusqu'à son
// guillemet fermant (scriptStringEnd, le lecteur du script)
function scriptWithoutComments(src: string, from: number, lang: CommentLanguage, sameLength: boolean): [string, number] | null {
  let out = ''
  let cur = from
  let i   = from
  while (i < src.length) {
    const c = src[i]
    let end = -1
    let by  = ''
    if (c === '<' && src.startsWith('</script>', i)) {
      return [out + src.slice(cur, i + 9), i + 9]
    }
    if (c === '#' && lang !== 'js') {
      if (opensHashBlock(src, i)) {
        const e = src.indexOf('###', i + 3)
        end = e === -1 ? lineEnd(src, i) : e + 3
      }
      else if (lang === 'coffee' || !/[a-zA-Z_]/.test(src[i + 1] ?? '')) end = lineEnd(src, i)
    }
    else if (c === '/' && src[i + 1] === '/') {
      if (src[i + 2] === '!') {
        end = lineEnd(src, i)
        if (KEPT_MJS_COMMENT) {
          if (lang !== 'coffee') {
            i = end
            continue
          }
          by = `###!${src.slice(i + 3, end).replace(/###/g, '# # #')} ###`
        }
      }
      else if (lang === 'coffee' || (lang === 'civet' && src.startsWith('///', i))) {
        const e = src.startsWith('///', i) ? src.indexOf('///', i + 3) : -1
        i = e === -1 ? i + 2 : e + 3
        continue
      }
      else end = lineEnd(src, i)
    }
    else if (c === '/' && src[i + 1] === '*' && lang !== 'coffee') {
      const e = src.indexOf('*/', i + 2)
      if (e !== -1) end = e + 2
    }
    else if (c === '"' || c === '\'' || c === '`' || c === '/') {
      const e = c === '"' && lang !== 'js' && !src.startsWith('"""', i) ? scanDoubleQuoteAt(src, i) : scanInertAt(src, i, lang === 'civet' || lang === 'coffee')
      if (e > i) {
        i = e
        continue
      }
      // chaîne `"…"` ou `'…'` écrite sur plusieurs lignes en Civet et en CoffeeScript : lue jusqu'à son guillemet fermant, comme le lit
      // le langage (scriptStringEnd, le lecteur du script), quand elle se referme avant le `</script>` qui suit
      const f = (c === '"' || c === '\'') && lang !== 'js' ? scriptStringEnd(src, i, true, lang === 'coffee') : i
      if (f > i && !src.slice(i, f).includes('</script>')) {
        i = f
        continue
      }
    }
    if (end === -1) {
      i++
      continue
    }
    out += src.slice(cur, i) + (sameLength ? blankOf(src, i, end, true) : by || blankOf(src, i, end))
    cur  = i = end
  }
  return null
}

// style du composant ouvert jusqu'à `de` : [texte sans ses commentaires, `</style>` compris ; position qui le suit], null
// s'il n'est jamais refermé ; fin au premier `</style>` hors des littéraux CSS, comme maskStylesCss ; à longueur égale
// (`sameLength`), chaque commentaire blanchi
function styleWithoutComments(src: string, from: number, sass: boolean, sameLength: boolean): [string, number] | null {
  const literal = literalReader(src)
  let end       = src.indexOf('</style>', from)
  let l         = literal(from)
  let out       = ''
  let cur       = from
  while (end !== -1 && l !== null && l[0] < end) {
    const [a, b] = l
    if (b > end) {
      end = src.indexOf('</style>', end + 1)
      continue
    }
    const mjs = src.startsWith('//!', a)
    if (src.startsWith('/*', a) || (src.startsWith('//', a) && (sass || mjs))) {
      out += src.slice(cur, a) + (sameLength ? blankOf(src, a, b, true) : mjs && KEPT_MJS_COMMENT ? `/*!${src.slice(a + 3, b).replace(/\*\//g, '* /')} */` : blankOf(src, a, b))
      cur  = b
    }
    l = literal(b)
  }
  return end === -1 ? null : [out + src.slice(cur, end + 8), end + 8]
}

// fins des accolades du gabarit lues depuis celle ouverte en `i`, chaînes sautées par le lexeur : pour chaque `{` vue hors des
// chaînes, la position qui suit sa `}`, -1 sans fin. Une seule lecture pour une accolade jamais refermée et toutes celles qu'elle
// contient : chacune relisait le reste du texte (coût quadratique sur un gabarit en cours de frappe) ; macros.ts lit de même les
// commentaires qui citent une balise du langage
export function braceEnds(src: string, i: number, ends: Map<number, number>): void {
  const stack: number[] = []
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === '"' || c === '\'' || c === '`') {
      const e = scanInertAt(src, j)
      if (e > j) j = e - 1
    }
    else if (c === '{') stack.push(j)
    else if (c === '}' && stack.length > 0) {
      ends.set(stack.pop()!, j + 1)
      if (stack.length === 0) return
    }
  }
  for (const p of stack) ends.set(p, -1)
}

export function removeComments(src: string, scriptLang: string, styleLang: string, sameLength = false): string {
  if (!src.includes('<!--') && !src.includes('#') && !src.includes('//') && !src.includes('/*')) return src
  const lower = asciiLower(src)
  const sign  = /[<{]/g
  const ends  = new Map<number, number>()
  let head    = ''
  let out     = ''
  let cur     = 0
  let i       = 0
  while (i < src.length) {
    sign.lastIndex = i
    const s = sign.exec(src)
    if (s === null) break
    i = s.index
    if (src[i] === '{') {
      if (!ends.has(i)) braceEnds(src, i, ends)
      const e = ends.get(i)!
      i = e === -1 ? i + 1 : e
      continue
    }
    if (src.startsWith('<!--', i)) {
      const read = readHtmlComment(src, i)
      if (read === null) {
        i += 4
        continue
      }
      const jumps = src.slice(i, read.end).replace(/[^\n]/g, '')
      if (sameLength) out += src.slice(cur, i) + (jumps === '' ? blankOf(src, i, read.end, true) : `<!--${blankOf(src, i + 4, read.end - 3, true)}-->`)
      else out += src.slice(cur, i) + (jumps === '' ? '' : `${LINE_CARRIER_OPEN}${jumps}-->`)
      cur  = i = read.end
      continue
    }
    OPENING_RE.lastIndex = i
    const b = OPENING_RE.exec(src)
    if (b === null) {
      i++
      continue
    }
    const name = b[2].toLowerCase()
    if (b[1] === '/') {
      if (name === '@' + head) head = ''
      i += b[0].length
      continue
    }
    const tagEnd = findMacroTagEnd(src, i + b[0].length)
    if (tagEnd === -1) {
      i += b[0].length
      continue
    }
    if (name === '@head' || name === '@failed') {
      head ||= name.slice(1)
      i = tagEnd + 1
      continue
    }
    const header = /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))
    if (header && head === '' && (name === 'script' || name === 'style')) {
      const lang = extractLang(src.slice(i + b[0].length, tagEnd))
      const read = name === 'script' ? scriptWithoutComments(src, tagEnd + 1, scriptLangOf(lang ?? scriptLang), sameLength) : styleWithoutComments(src, tagEnd + 1, /^s[ac]ss$/.test(lang ?? styleLang), sameLength)
      if (read !== null) {
        out += src.slice(cur, tagEnd + 1) + read[0]
        cur  = i = read[1]
        continue
      }
    }
    if (RAW_RE.test(name) || (header && BLOCK_MJS_RE.test(name))) {
      const e = lower.indexOf(`</${name}`, tagEnd + 1)
      i = e === -1 ? tagEnd + 1 : e
      continue
    }
    i = tagEnd + 1
  }
  return cur === 0 ? src : out + src.slice(cur)
}

// un <@head> ou un <@failed> se lit comme le reste du gabarit : une fermante de bloc (`</vars>`, `</types>`, `</theme>`, `</routes>`,
// `</effects>`) qui n'y referme aucun bloc ouvert en tête de ligne y est orpheline, avec le refus du gabarit. Lue hors commentaires, hors
// valeurs d'attribut et hors du texte de ses <script> et <style>, qui courent jusqu'à leur fermante où qu'ils soient posés (un JSON-LD
// qui cite `</types>` y reste permis) ; une ligne y finit sur un saut de ligne ou un retour chariot, comme pour le lecteur du fichier qui
// y relève les images, jamais sur U+2028 ou U+2029. Le bloc masqué échappait à cette recherche : une <@@img> citée dans le texte du
// faux bloc y était refusée comme une image de l'en-tête
const RAW_TEXT_RE      = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const HEADER_BLOCK_RE  = /(?<=^|[\n\r])[ \t]*<(theme|routes|vars|types|effects)\b[^>]*>[\s\S]*?<\/\1>/g
const CLOSING_BLOCK_RE = /<\/(?:theme|routes|vars|types|effects)>/i

function orphanClosingBlock(blocks: readonly string[]): RegExpMatchArray | null {
  for (const block of blocks) {
    if (!CLOSING_BLOCK_RE.test(block)) continue
    const view = attrValueMask(maskHtmlComments(block).replace(RAW_TEXT_RE, m => m.replace(/[^\n\r]/g, ' '))).replace(HEADER_BLOCK_RE, '')
    const orphan = view.match(CLOSING_BLOCK_RE)
    if (orphan) return orphan
  }
  return null
}

// les sections d'un texte (extractSections : commentaires retirés, blocs <@head> / <@failed> masqués ; sectionBounds : la même
// vue à longueur égale) : <script module> et <script> sur la vue Civet, <style> sur la vue CSS, puis <theme>, <routes>, <vars>,
// <types> et <effects>, chaque recherche sur la vue de la précédente, ses plages déjà trouvées neutralisées. La seule recherche des
// sections : le compilateur et le lecteur du fichier (src/reader) referment une section au même endroit
interface FoundSections {
  moduleScripts: RegExpMatchArray[]
  scripts:       RegExpMatchArray[]
  styles:        RegExpMatchArray[]
  themes:        RegExpMatchArray[]
  routes:        RegExpMatchArray[]
  vars:          RegExpMatchArray[]
  types:         RegExpMatchArray[]
  effects:       RegExpMatchArray[]
}

function findSections(scan: string): FoundSections {
  const { moduleScripts, scripts } = findScriptMatches(scan)
  const { matches: styles, maskedView } = findStyleMatches(scan, [...moduleScripts, ...scripts])
  const no = (view: string, found: RegExpMatchArray[]): string => {
    for (const m of found) view = blankRange(view, m.indices![0][0], m.indices![0][1])
    return view
  }
  const themesView = no(maskedView, styles)
  const themes     = [...themesView.matchAll(/^[ \t]*<theme\b([^>]*)>([\s\S]*?)<\/theme>/gmd)]
  const routesView = no(themesView, themes)
  const routes     = [...routesView.matchAll(/^[ \t]*<routes\b([^>]*)>([\s\S]*?)<\/routes>/gmd)]
  const varsView   = no(routesView, routes)
  const vars       = [...varsView.matchAll(/^[ \t]*<vars\b([^>]*)>([\s\S]*?)<\/vars>/gmd)]
  const typesView  = no(varsView, vars)
  const types      = [...typesView.matchAll(/^[ \t]*<types\b([^>]*)>([\s\S]*?)<\/types>/gmd)]
  const effects    = [...no(typesView, types).matchAll(/^[ \t]*<effects\b([^>]*)>([\s\S]*?)<\/effects>/gmd)]
  return { moduleScripts, scripts, styles, themes, routes, vars, types, effects }
}

// une section que le compilateur lit dans un fichier : `start` sur son `<`, `body` [début, fin) de son contenu, `end` après sa
// fermante
export interface SectionBound {
  start: number
  body: { start: number, end: number }
  end:   number
}

// les sections d'un composant ou d'un partiel aux positions du texte donné, telles que extractSections les lit (findSections), et
// les blocs <@head> / <@failed> qu'il masque avant, [début, fin) : le lecteur du fichier (src/reader) referme une section au même
// endroit que le compilateur. Le texte est lu à longueur égale : chaque commentaire blanchi où removeComments le retire (ceux
// d'un script selon sa langue, `scriptLang` pour un <script> sans `lang`, celle que reçoit extractSections), chaque bloc <@head> /
// <@failed> blanchi où maskHeadFailedBlocks le masque, son dernier caractère gardé (comme le jeton qui le remplace, rien ne commence
// une ligne juste après lui)
export function sectionBounds(content: string, scriptLang: string = DEFAULT_SCRIPT_LANG): { sections: SectionBound[], blocks: Array<[number, number]> } {
  const blocks: Array<[number, number]> = []
  const text = removeComments(content.charCodeAt(0) === 0xfeff ? ' ' + content.slice(1) : content, scriptLang, DEFAULT_STYLE_LANG, true)
  const view = maskHeadFailedBlocks(text, (block, at) => {
    blocks.push([at, at + block.length])
    return block.slice(0, -1).replace(/[^\n]/g, ' ') + block.slice(-1)
  })
  const t = findSections(view)
  const sections = [...t.moduleScripts.map(m => [m, 3] as const), ...[t.scripts, t.styles, t.themes, t.routes, t.vars, t.types, t.effects].flatMap(l => l.map(m => [m, 2] as const))].map(([m, body]) => ({
    start: m.indices![0][0] + /^[ \t]*/.exec(m[0])![0].length,
    body: { start: m.indices![body][0], end: m.indices![body][1] },
    end:   m.indices![0][1],
  }))
  return { sections: sections.sort((a, b) => a.start - b.start), blocks }
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
  // jetons à sceau, remise au point fixe (createMaskTable) : un NUL écrit par l'auteur reste tel quel
  // premier geste : tous les commentaires de l'auteur retirés (removeComments, plus haut), lignes gardées
  content = removeComments(content, defaultScriptLang, defaultStyleLang, false)
  const macroMasks = createMaskTable(content, 'MJSHF')
  // chaque bloc masqué : la place de son jeton dans `scan` et les sauts de ligne qu'il remplace (un jeton tient sur une ligne) ;
  // lineInFile : la ligne du fichier d'une position de `scan`, ces sauts comptés (après un <@head> ou un <@failed> de plusieurs
  // lignes, une section et ses fautes étaient citées trop haut)
  const folds  = [] as Array<[number, number]>
  const macros = [] as string[]
  let shift    = 0
  const scan   = maskHeadFailedBlocks(content, (block, at) => {
    const token = macroMasks.stash(block)
    macros.push(block)
    folds.push([at - shift, countNewlines(block)])
    shift += block.length - token.length
    return token
  })
  const lineInFile = (offset: number): number => folds.reduce((n, [at, lines]) => (at < offset ? n + lines : n), lineOfOffset(scan, offset))

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
  const { moduleScripts: allModuleScripts, scripts: allScripts, styles: allStyles, themes: allThemes, routes: allRoutesBlocks, vars: allVars, types: allTypes, effects: allEffects } = findSections(scan)
  const moduleMatch = allModuleScripts[0]
  const moduleSection: ScriptSection = { raw: '', lang: defaultScriptLang, startLine: 1 }
  if (moduleMatch) {
    const idx = moduleMatch.indices!
    const attrs = `${scan.slice(...idx[1])} ${scan.slice(...idx[2])}`
    checkSectionAttrs('script', attrs, ['module', 'lang'])
    const explicitLang = extractLang(attrs) as SupportedLang | null
    moduleSection.raw = dedent(scan.slice(...idx[3]))
    moduleSection.lang = explicitLang ?? defaultScriptLang
    moduleSection.startLine = lineInFile(idx[3][0])
  }
  if (allModuleScripts.length > 1) {
    throw new Error(t('transpiler.script-module-duplicate', { n: allModuleScripts.length, nOthers: allModuleScripts.length - 1 }))
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
    script.startLine = lineInFile(idx[2][0])
  }
  if (allScripts.length > 1) {
    throw new Error(t('transpiler.script-duplicate', { n: allScripts.length, nOthers: allScripts.length - 1 }))
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
  const style: StyleSection = { raw: '', lang: defaultStyleLang, sharedCssNames: [], moduleDisplay: 'block', moduleViewTransition: null, moduleViewTransitionPriority: 1 }
  const layouts: LayoutSection[] = []
  let seenStyles = 0
  for (const m of allStyles) {
    const idx = m.indices!
    const attrs = scan.slice(...idx[1])
    checkSectionAttrs('style', attrs, ['lang', 'name', ...STYLE_WORDS.map((w) => SIGN + w)], scan, idx[1][0])
    const name = extractAttr(attrs, 'name')
    const lang = (extractLang(attrs) as 'css' | 'sass' | 'scss') ?? defaultStyleLang
    const raw = dedent(scan.slice(...idx[2]))
    if (name === '') {
      seenStyles++
      if (seenStyles > 1) throw new Error(t('transpiler.style-duplicate', { n: seenStyles, nOthers: seenStyles - 1 }))
      style.lang = lang
      style.raw  = raw

      // :css/:display/:viewTransition — RELOGÉS : attributs
      // du `<style>` de base, plus des directives racine (cf. directives.ts).
      // `:viewTransition` sans alias `@vt` ici (RETIRÉ, cf. extractStyleViewTransition).
      const cssAttr = extractAttrValue(attrs, SIGN_RE + 'css')
      if (cssAttr !== null) {
        style.sharedCssNames = cssAttr.split(/[ \t]+/).map(s => s.trim()).filter(s => s.length > 0)
      }
      const displayAttr = extractAttrValue(attrs, SIGN_RE + 'display')
      if (displayAttr !== null) style.moduleDisplay = displayAttr
      const vt = extractStyleViewTransition(attrs)
      if (vt) {
        // MÊME ORDRE DE JUGEMENT QUE `<@view>` (transpiler/index.ts) : c'est ce qui rend les deux
        // niveaux de navigation interchangeables — une écriture refusée ici l'est aussi là-bas,
        // avec le MÊME message. Le durcissement a fermé les trois écarts.
        const rest: string | undefined = vt.rest
        if (vt.aliasVt) throw new Error(t('transpiler.vt-alias-on-style-forbidden'))
        if (vt.malformed) throw new Error(t('transpiler.viewtransition-shape-invalid-on-style', { label: vt.label, rest }))
        if (rest === undefined) {
          style.moduleViewTransition = 'on'
        } else if (rest[0] === '.') {
          const dm = rest.match(/^\.([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)(?:[ \t]*=[ \t]*\{([^}]*)\})?$/)
          if (!dm) throw new Error(t('transpiler.viewtransition-shape-invalid-on-style', { label: vt.label, rest }))
          const nameAndDir: string = dm[1]
          const optsRaw: string | undefined = dm[2]
          const base = nameAndDir.split(':')[0]
          if (base === 'off') throw new Error(t('transpiler.vt-off-does-not-exist', { label: vt.label }))
          if (base === 'on') throw new Error(t('transpiler.vt-on-implicit', { label: vt.label }))
          // Le suffixe `:direction` n'existe plus, la SEULE façon d'orienter est la
          // clé d'option ; le nom le CAPTURE tout de même pour pouvoir le refuser (cf. l'extracteur).
          if (nameAndDir.includes(':')) throw new Error(t('transpiler.vt-direction-no-longer-in-name', { label: vt.label, example: `${vt.label}.cube={ dir: left }` }))
          const verbatim = optsRaw !== undefined ? `${nameAndDir}={${optsRaw}}` : nameAndDir
          const parsed = parseVtValue(verbatim)
          // cast explicite : strictNullChecks:false désactive le narrowing natif des unions
          // discriminées (même piège que directives.ts/bundler/config.ts, cf. leurs commentaires).
          if (!parsed.ok) throw new Error(t('transpiler.vt-name-error-parsing', { label: vt.label, nameAndDir: verbatim, error: (parsed as { ok: false, error: string }).error }))
          // AUCUN CONTRÔLE DE LA BASE ICI (revenant sur le durcissement
          // du matin) : `µ._vtPresets` reste garnissable par l'appli, et un nom qu'on ne connaît pas
          // au build peut très bien exister au runtime. Le nom mal tapé retombe sur le `µ.warn` de
          // `µ._mjs_vtApplyPreset`. Seuls les deux refus de FORME restent — le suffixe `:direction`
          // ci-dessus et l'étiquette calculée plus bas : eux ne dépendent d'aucun dictionnaire.
          const okParsed = parsed as { ok: true, value: { priority: number | null } }
          style.moduleViewTransition = verbatim
          if (okParsed.value.priority != null) style.moduleViewTransitionPriority = okParsed.value.priority
        } else if (rest[1] === '"' || rest[1] === "'") {
          throw new Error(t('transpiler.viewtransition-quotes-on-style', { label: vt.label }))
        } else if (rest[1] === '{') {
          throw new Error(t('transpiler.viewtransition-label-computed-forbidden', { expr: rest.slice(2, -1) }))
        } else {
          throw new Error(t('transpiler.viewtransition-shape-invalid-on-style', { label: vt.label, rest }))
        }
      }
    } else {
      const forbidden = findRelocatedStyleAttrToken(attrs)
      if (forbidden) throw new Error(t('transpiler.style-attr-on-layout', { attribute: forbidden, name: name }))
      if (!THEME_NAME_RE.test(name))                 throw new Error(t('transpiler.layout-name-invalid', { name: name }))
      // « default » : le composant lui-même, sans modèle ({? default}, layout="default")
      if (name === 'default')                        throw new Error(t('transpiler.layout-default'))
      if (layouts.some(ly => ly.name === name))      throw new Error(t('transpiler.layout-duplicate', { name: name }))
      layouts.push({ raw, lang, name: name })
    }
  }

  // 3-bis. <theme> — mêmes règles de masquage que <style> (c'est du SASS), plus les
  // plages du <style> déjà trouvé neutralisées : un `<theme>` cité DANS le style (ou
  // dans un script) ne doit pas être pris pour une section. Contrairement à <style>,
  // PLUSIEURS blocs sont permis — un seul sans nom, un seul par nom.
  const themes: ThemeSection[] = []
  for (const m of allThemes) {
    const idx = m.indices!
    const attrs = scan.slice(...idx[1])
    checkSectionAttrs('theme', attrs, ['name', 'lang'])
    const name = extractAttr(attrs, 'name')
    if (name !== '' && !THEME_NAME_RE.test(name)) throw new Error(t('transpiler.theme-name-invalid', { name }))
    if (themes.some(th => th.name === name)) throw new Error(t('transpiler.theme-duplicate', { name }))
    themes.push({
      raw:     dedent(scan.slice(...idx[2])),
      lang:    (extractLang(attrs) as 'css' | 'sass' | 'scss') ?? defaultStyleLang,
      name,
    })
  }

  // 3-ter. <routes target="…"> — bloc racine, RÉPÉTABLE (un par outlet), table de routes
  // FIXES. Même masquage que <theme> plus les plages des <theme> déjà trouvés neutralisées.
  // (les commentaires HTML sont masqués une seule fois, en amont de `maskedStyle` — ce masquage
  // vivait ici, il couvre désormais <style>, <style name>, <theme> ET <routes>)
  const routes: RoutesSection[] = []
  for (const m of allRoutesBlocks) {
    const idx = m.indices!
    const attrs  = scan.slice(...idx[1])
    checkSectionAttrs('routes', attrs, ['target'])
    const target = extractAttr(attrs, 'target')
    if (target === '') throw new Error(t('transpiler.routes-target-missing'))
    if (routes.some(r => r.target === target)) throw new Error(t('transpiler.routes-target-duplicate', { target }))
    const raw = dedent(scan.slice(...idx[2]))
    routes.push({ raw, target, entries: parseRoutesLines(raw, target), line: lineInFile(idx[0][0]) })
  }

  // 3-quinquies. <vars> (composant) et <types> (fichier *.types.mjs) — des lignes de règles, même
  // masquage que <routes> plus les plages des <routes> déjà trouvés neutralisées. Aucun attribut ;
  // un seul <vars>, toujours AVANT le <script> : la règle d'une variable se lit avant le code qui
  // l'écrit.
  // <effects> (fichier *.effects.mjs) : les effets de l'appli, lus par effects/project.ts
  if (allVars.length > 1) throw new Error(t('transpiler.vars-duplicate', { n: allVars.length }))
  const typesSection = (m: RegExpMatchArray, tag: string): TypesSection => {
    const idx = m.indices!
    if (scan.slice(...idx[1]).trim() !== '') throw new Error(t('transpiler.section-no-attribute', { tag, attributes: scan.slice(...idx[1]).trim() }))
    return { raw: dedent(scan.slice(...idx[2])), startLine: lineInFile(idx[2][0]) }
  }
  const vars    = allVars.length > 0 ? typesSection(allVars[0], 'vars') : null
  const types   = allTypes.map(m => typesSection(m, 'types'))
  const effects = allEffects.map(m => typesSection(m, 'effects'))
  if (allVars.length > 0) {
    const startVars = allVars[0].indices![0][0]
    const firstCode = [...allModuleScripts, ...allScripts].map(m => m.indices![0][0]).filter(o => o < startVars)
    if (firstCode.length > 0) throw new Error(t('transpiler.vars-after-script', { line: lineInFile(startVars) }))
  }

  // 4. HTML : tout sauf les <script>/<style>/<theme>/<routes> déjà repérés (au plus
  //    1 script et les doublons ont déjà levé throw ci-dessus). Retrait par PLAGES d'offsets
  //    (jamais une regex ré-exécutée sur `scan` — même piège que le bug corrigé),
  //    puis restauration des blocs <@head>/<@failed> masqués en tête de fonction.
  // Un bloc retiré SANS rien à sa place décale vers le HAUT
  // toutes les lignes qui le suivent : le parseur et le générateur (`node.line`/`currentLine`
  // posés sur CE `html`) citent alors un numéro FAUX pour toute erreur après un <script>/
  // <style>/<theme>/<routes> (`{await}` en ligne 6 du .mjs cité « ligne 2 »). Remplacé par un
  // commentaire HTML inerte de MÊME hauteur (mêmes `\n` que le bloc retiré) : la lecture du gabarit
  // (readViaTree, parser/index.ts) ne produit NI texte NI nœud pour un commentaire — zéro trace dans l'AST,
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
  // entre guillemets des balises bien formées ne sont pas lues (attrValueMask), seulement quand une balise est en vue
  const htmlWithoutComments = maskHtmlComments(html)
  const ORPHAN_RE = /<\/(?:script|style|theme|routes|vars|types|effects)>/i
  const orphanTag = (ORPHAN_RE.test(htmlWithoutComments) ? attrValueMask(htmlWithoutComments).match(ORPHAN_RE) : null) ?? orphanClosingBlock(macros)
  if (orphanTag) {
    throw new Error(t('transpiler.tag-orphan-html', { tag: orphanTag[0] }))
  }

  const htmlRestored = macroMasks.restore(html)
  // ce que le `.trim()` mange en tête donne la ligne de départ du HTML (les blocs retirés, eux,
  // gardent leur hauteur)
  const htmlStartLine = lineOfOffset(htmlRestored, htmlRestored.length - htmlRestored.trimStart().length)
  html = htmlRestored.trim()

  return { module: moduleSection, script, style, layouts, themes, routes, vars, types, effects, html, htmlStartLine, warnings }
}
