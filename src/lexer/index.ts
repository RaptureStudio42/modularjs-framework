// lexer — port de la V1 Ruby, lexer_coffee.rb
//
// Tokenise le sucre ModularJS dans une source post-langage (CoffeeScript pré-compile,
// ou JS issu de Civet/TS/JS direct). Port à l'identique (output strictement
// égal à V1). Une prochaine étape ajoutera l'émission `__mjs_get/__mjs_set` à la place de `$.x`.
//
// externalVars : noms `$foo` à préserver tels quels (imports cross-module)
// moduleMode   : si true, tous les `$foo` restent littéraux (modules .coffee externes)

import { MU_FAILED_MALFORMED, failedWritten, RAW_ACCESS_BODY, RAW_ACCESS_PAREN_BODY, RAW_ACCESS_MALFORMED_BODY, rawAccessShapeError, MU_REFRESH_PAREN_BODY, MU_REFRESH_BODY, MU_REFRESH_REST_BODY, MU_REFRESH_BARE_BODY, MU_REFRESH_OUT, MU_REFRESH_STORE_OUT, refreshShapeError, refreshBareError, refreshOutsideComponentError, RAW_WRITE_BODY, RAW_WRITE_PAREN_BODY, RAW_WRITE_PAREN_OUT_OPEN, RAW_WRITE_OLD_SHAPE_BODY, RAW_WRITE_OLD_SHAPE_PAREN_BODY, rawWriteOldShapeError, BARE_SECTION_BODY, bareSectionError, RAW_ACCESS_OUT, RAW_ACCESS_STORE_OUT, RAW_WRITE_OUT, RAW_WRITE_STORE_OUT, MU_PASCAL_BODY, MU_SHORT_BODY, MU_LANG_BODY, MU_LANG_OUT, MU_THEME_BODY, MU_THEME_OUT, MU_LAYOUT_BODY, MU_LAYOUT_OUT, MU_LAYOUT_WRITE_BODY, MU_HOOKS, MU_HOOKS_BODY, MU_DERIVED_BODY, rewriteMuToggle, vaultRemovedError, importedSingletonError, storeComputedKeyError, opensRegex, regexInArgument, scanRegexLiteral, expressionEnd, SCOPE_OPENS_REGEX } from '../sigils.js'
import { t } from '../messages/index.js'
import { selfWriteError, SELF_WRITE_STORE, SELF_WRITE_MODULE_STATE, SELF_WRITE_VAR } from '../sigils.js'
import { skipQuotedSpan } from '../quoted-span.js'
import type { SupportedLang } from '../languages/index.js'

// regex ancrées du scanner — bâties UNE fois sur les corps partagés (sigils.ts,
// source unique lexer↔cleanJs) ; l'ancre `^` reste locale à ce moteur
const RE_RAW_ACCESS                = new RegExp(`^${RAW_ACCESS_BODY}`)
const RE_RAW_ACCESS_PAREN          = new RegExp(`^${RAW_ACCESS_PAREN_BODY}`)
const RE_RAW_ACCESS_MALFORMED      = new RegExp(`^${RAW_ACCESS_MALFORMED_BODY}`)
const RE_RAW_WRITE                 = new RegExp(`^${RAW_WRITE_BODY}`)
const RE_RAW_WRITE_PAREN           = new RegExp(`^${RAW_WRITE_PAREN_BODY}`)
const RE_RAW_WRITE_OLD_SHAPE       = new RegExp(`^${RAW_WRITE_OLD_SHAPE_BODY}`)
const RE_RAW_WRITE_OLD_SHAPE_PAREN = new RegExp(`^${RAW_WRITE_OLD_SHAPE_PAREN_BODY}`)
const RE_BARE_SECTION              = new RegExp(`^${BARE_SECTION_BODY}`)
const RE_MU_PASCAL                 = new RegExp(`^${MU_PASCAL_BODY}`)
const RE_MU_SHORT                  = new RegExp(`^${MU_SHORT_BODY}`)
const RE_MU_REFRESH_PAREN          = new RegExp(`^${MU_REFRESH_PAREN_BODY}`)
const RE_MU_REFRESH                = new RegExp(`^${MU_REFRESH_BODY}`)
const RE_MU_REFRESH_BARE           = new RegExp(`^${MU_REFRESH_BARE_BODY}`)
const RE_MU_REFRESH_REST           = new RegExp(`^${MU_REFRESH_REST_BODY}`)
const RE_MU_LANG                   = new RegExp(`^${MU_LANG_BODY}`)
const RE_MU_THEME                  = new RegExp(`^${MU_THEME_BODY}`)
const RE_MU_LAYOUT                 = new RegExp(`^${MU_LAYOUT_BODY}`)
const RE_MU_LAYOUT_WRITE           = new RegExp(`^${MU_LAYOUT_WRITE_BODY}`)
const RE_MU_HOOKS                  = new RegExp(`^${MU_HOOKS_BODY}`)
const RE_FAILED_MALFORMED          = new RegExp(`^${MU_FAILED_MALFORMED}`)

// µderived $var = expr, $a, $b — PRÉ-PASSE (pas un branchement scanner : pas
// d'ancre `^`, consommée par un `code.replace` global comme les pré-passes §/§§)
const RE_MU_DERIVED_STMT = new RegExp(
  `${MU_DERIVED_BODY}[ \\t]+\\$([a-zA-Z_][a-zA-Z0-9_]*)[ \\t]*=(?!=|>)[ \\t]*(.+?)(?=\\n|;|$)`,
  'g'
)

// garde-fou : ancienne forme hook `@mount ->` / `@urlChange (p, a) ->` RETIRÉE.
// Ne matche QUE la silhouette hook (flèche directe, ou (args) puis flèche) —
// `@mount = ->` (méthode utilisateur, noms désormais LIBRES) et `@mount(x)`
// (appel parenthésé) ne sont PAS concernés.
const RE_OLD_HOOK = new RegExp(`^@(${MU_HOOKS})(?=[ \\t]*(?:->|=>|\\([^)\\n]*\\)[ \\t]*(?:->|=>)))`)

export interface TokenizeOpts {
  externalVars?: string[]
  moduleMode?: boolean
  // singletons que le module déclare lui-même (`export µ$$X = …`, module autonome) : avec les noms importés
  // (`$X` ∈ externalVars), les seuls qui se lisent `µ$$X` dans une interpolation
  singletons?: string[]
  // position des erreurs : nom du texte compilé (`<module>.script`, comme pour Civet) et ligne du fichier où
  // commence ce texte ; sans nom, une erreur garde son message seul
  fileName?: string
  firstLine?: number
  // colonne du fichier où commence ce texte (contenu d'une interpolation) ; 1 sans précision
  firstColumn?: number
  // langage du texte : en CoffeeScript et en Civet, une regex se passe aussi sans parenthèses (`s.replace /"/g, "#{x}"`,
  // regexInArgument) ; en JavaScript, en TypeScript ou sans langage, `a /2 + b /4` divise
  lang?: SupportedLang
  // les raccourcis `$x`, `&x` et `$x =: valeur` laissés tels quels : une passe sur l'arbre de Civet les pose ensuite
  // (lecture du script par l'arbre, reader/script.ts)
  shortcutsFromTree?: boolean
  // module autonome (fichier importé, celui d'un magasin compris), et non le `<script module>` d'un composant : ses refus le nomment
  moduleFile?: boolean
}

// situe — préfixe `<fichier>:<ligne>:<colonne>` d'une erreur du lexeur, même forme que celles de Civet ; `pos` est
// l'offset de la faute dans `texte`, dont les lignes sont celles de la source (les pré-passes n'en ajoutent ni
// n'en retirent)
function located(err: Error, text: string, pos: number, opts: TokenizeOpts): Error {
  if (!opts.fileName) return err
  const { firstLine, firstColumn } = locateIn(opts, text, pos)
  return new Error(`${opts.fileName}:${firstLine}:${firstColumn} ${err.message}`, { cause: err })
}

// options d'un texte qui commence à l'offset `pos` de `texte` (contenu d'une interpolation) : sa ligne et sa colonne
// dans le fichier, pour que ses erreurs citent la place de la faute et non `1:1`
function locateIn(opts: TokenizeOpts, text: string, pos: number): TokenizeOpts {
  const before = text.slice(0, pos)
  const jumps  = before.match(/\n/g)?.length ?? 0
  return { ...opts, firstLine: (opts.firstLine ?? 1) + jumps, firstColumn: jumps > 0 ? pos - before.lastIndexOf('\n') : (opts.firstColumn ?? 1) + pos }
}

// selfWriteAt — `$x = $x`, `$$x = $$x` ou `µ$$x = µ$$x` (lu `$x` : nom importé, singleton du module) qui commence à l'indice `i`
// de `code` : la variable, la clé du magasin ou l'état de module écrit avec sa propre valeur, exactement (sigils.ts, selfWriteError),
// espaces, `;` et parenthèses autour d'un côté compris, suivi de la fin de l'expression. Une ligne d'après qui la continue (un point,
// un opérateur, une ouvrante, un retrait plus grand) laisse passer l'écriture, comme toute forme que ce lecteur ne lit pas sûrement :
// les passes d'écriture la refusent alors sans sa place. Rend l'indice où commence l'écriture (sa première parenthèse) et l'erreur
const RE_SELF_WRITE      = /^(µ\$\$|\$\$?)([a-zA-Z_][a-zA-Z0-9_]*)((?:[ \t]*\))*)[ \t]*=(?![=>~:])[ \t]*((?:\([ \t]*)*)\1\2(?![\w$])((?:[ \t]*\))*)/
const RE_SELF_WRITE_END  = /^[ \t]*(?:[;,)\]}]|\/\*|$)|^[ \t]+(?:if|unless|else|for|while|until|then|when)(?![\w$])/
const RE_LINE_END        = /^(?:[ \t]+#[^\n]*|[ \t]*\/\/[^\n]*|[ \t]*)\r?(?=\n|$)/
const RE_LINE_GOES_ON    = /^[ \t]*(?:[.?[(+\-*/%&|^<>=!:,`]|(?:and|or|not|is|isnt|in|of|instanceof)(?![\w$]))/
const RE_LINE_BLANK      = /^[ \t]*(?:(?:#|\/\/)[^\n]*)?\r?$/

function selfWriteAt(code: string, i: number, externalVars: string[], singletons: string[], moduleMode: boolean): { at: number, error: Error } | null {
  if (/[\w$]/.test(code[i - 1] ?? '') || (code[i - 1] === '.' && code[i - 2] !== '.')) return null
  const m = RE_SELF_WRITE.exec(code.slice(i, i + 300))
  // `$$X = $$X` d'un singleton importé : refusé par la règle 3.2, qui dit d'écrire `µ$$X`
  if (!m || (m[1] === '$$' && externalVars.includes(`$${m[2]}`))) return null
  const parens = (s: string): number => s.split(/[()]/).length - 1
  // autant d'ouvrantes juste avant la gauche que de fermantes juste après elle
  let at = i
  for (let k = parens(m[3]); k > 0; k--) {
    let j = at - 1
    while (code[j] === ' ' || code[j] === '\t') j--
    if (code[j] !== '(') return null
    at = j
  }
  // à droite, une fermante de plus que d'ouvrantes ferme l'expression qui la contient
  const open   = parens(m[4])
  const closed = parens(m[5])
  if (closed < open || (closed === open && !expressionEnds(code, i + m[0].length, at))) return null
  const kind = m[1] === '$$' ? SELF_WRITE_STORE : m[1] === 'µ$$' || externalVars.includes(`$${m[2]}`) || singletons.includes(m[2]) ? SELF_WRITE_MODULE_STATE : SELF_WRITE_VAR
  return { at, error: selfWriteError(kind, m[2], moduleMode && kind === SELF_WRITE_VAR, !moduleMode && kind === SELF_WRITE_VAR && isDerivedWrite(code, m[2])) }
}

// `$d = …` écrit au premier niveau du script, qui lit une autre variable `$`, une clé du magasin ou un contexte `§§` : une valeur
// dérivée, dont le refus de `$d = $d` dit d'écrire `µrefresh` sur la variable qu'elle lit (cf. selfWriteError) — lue au texte, le
// lecteur passe avant l'analyse du script ; un gestionnaire refusé par les passes d'écriture la tient de l'analyse (transpiler/index.ts)
function isDerivedWrite(code: string, name: string): boolean {
  return new RegExp(`^\\$${name}[ \\t]*=(?![=>~:])[^\\n]*?(?<![\\w$.])(?:\\$\\$?(?!${name}(?![\\w$]))[a-zA-Z_]|§§[a-zA-Z_])`, 'm').test(code)
}

// la fin d'une expression à l'indice `k` de `code` (cf. selfWriteAt) : `;`, `,`, une fermante, `if`, `unless`, `else`, `for`,
// `while`, `until`, `then`, `when`, la fin du texte, ou la fin de sa ligne (commentaire compris) quand la ligne écrite suivante ne
// la continue pas et n'est pas plus en retrait que la ligne où commence l'écriture (`at`)
function expressionEnds(code: string, k: number, at: number): boolean {
  const rest = code.slice(k, k + 300)
  if (RE_SELF_WRITE_END.test(rest)) return true
  if (!RE_LINE_END.test(rest)) return false
  const start  = code.lastIndexOf('\n', at - 1) + 1
  const indent = /^[ \t]*/.exec(code.slice(start, at))![0].length
  for (let p = code.indexOf('\n', k); p >= 0; ) {
    const q    = code.indexOf('\n', p + 1)
    const line = code.slice(p + 1, q < 0 ? code.length : q)
    p          = q
    if (!RE_LINE_BLANK.test(line)) return /^[ \t]*/.exec(line)![0].length <= indent && !RE_LINE_GOES_ON.test(line)
  }
  return true
}

// crochet mal écrit (`µmounted ->`, `µonDestroy ->`, `µdestory ->`) : le crochet de cycle de vie dont le nom est
// contenu dans `nom`, en est le début (4 lettres au moins) ou n'en diffère que d'une faute ; `null` sinon — toute
// autre rune ou fonction µ passe
const HOOK_NAMES = MU_HOOKS.split('|')

function nearestHook(name: string): string | null {
  if (HOOK_NAMES.includes(name)) return null
  const low = name.toLowerCase()
  for (const bracket of HOOK_NAMES) {
    const c = bracket.toLowerCase()
    if (low.includes(c) || (low.length >= 4 && c.startsWith(low)) || oneTypo(low, c)) return bracket
  }
  return null
}

// vrai si `a` et `b` diffèrent d'une seule faute : une lettre en trop, en moins ou changée, deux voisines inversées
function oneTypo(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i)
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1)
  return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
}

const RE_HOOK_SHAPE = /^µ\.?([a-zA-Z_][a-zA-Z0-9_]*)(?=[ \t]*(?:->|=>|\([^)\n]*\)[ \t]*(?:->|=>)))/

// masque strings/heredocs/commentaires (MÊMES formes que la règle 3.1
// du scanner) par des jetons inertes `NUL+N+NUL` (ni `;`, ni `\n`, ni `§`),
// le temps des PRÉ-PASSES § / §§ (4 replace globaux, exécutés AVANT le scanner).
// Sans ce masquage : (a) un `§ident` dans le TEXTE d'une chaîne était réécrit en
// code (texte faux à l'écran) ; (b) un `;` DANS une chaîne du RHS d'un setter
// coupait la capture `(.+?)(?=\n|;|$)` au milieu de la chaîne. Le `§` d'une
// INTERPOLATION `#{…}` reste géré : le scanner rappelle `tokenize` sur l'inner.
// LECTEUR À NIVEAUX — remplace l'ancienne regex INERT_RE, dont
// l'alternative backtick (non récursive) fermait au PREMIER backtick rencontré :
// sur un backtick imbriqué dans une interpolation, elle fermait au 2e backtick au
// lieu du 4e, décalait tout le masquage, et laissait fuir dans le HTML résiduel un
// `</script>` pourtant situé DANS une chaîne (cf. garde-fou reliquats de
// transpiler/sections.ts). Le scanner ci-dessous parcourt la source une fois, dans
// le MÊME ordre de priorité que l'ancienne alternance, et compte les niveaux
// d'imbrication backtick / interpolation.
// Repli identique à la regex : un littéral NON TERMINÉ n'est pas masqué du tout (on
// repart au caractère suivant) — c'est ce repli qui laisse le garde-fou de
// sections.ts détecter la chaîne non fermée au lieu de la masquer en silence.
const IDENT_START_RE = /[a-zA-Z_]/

// KEPT_MJS_COMMENT — le commentaire MJS `//!` (jusqu'à la fin de la ligne) sort dans le code produit, en
// développement comme en production (vrai), ou part comme tous les autres commentaires (faux) : SEUL réglage, lu par
// le retrait des commentaires (transpiler/sections.ts, removeComments) et par la minification (bundler/minify.ts)
export const KEPT_MJS_COMMENT = true

// fin (exclue) d'une regex étendue `///…///` de Coffee ou de Civet ouverte en i, drapeaux compris ; -1 si elle ne se referme pas ou si
// elle porte une interpolation `#{…}` (son code reste alors du code)
function heregexEnd(src: string, i: number): number {
  const e = src.indexOf('///', i + 3)
  if (e < 0 || src.slice(i + 3, e).includes('#{')) return -1
  let f = e + 3
  while (/[a-z]/.test(src[f] ?? '')) f++
  return f
}

// fin (exclue) d'une chaîne `"…"` ou `'…'` ouverte en i, écrite sur une ou plusieurs lignes ; dans `"…"`, une interpolation `#{…}` et
// les chaînes qu'elle porte (`"a #{"b #{$v}"} c"`) restent dedans
export function stringEnd(text: string, i: number): number {
  const q = text[i]
  let j   = i + 1
  let n   = 0
  while (j < text.length && !(text[j] === q && n === 0)) {
    if (text[j] === '\\') j++
    else if (q === '"' && text.startsWith('#{', j)) {
      n++
      j++
    }
    else if (n > 0 && text[j] === '}') n--
    j++
  }
  return Math.min(j + 1, text.length)
}

// fin (exclue) d'un commentaire ouvert en i : `### … ###` jusqu'à son `###` fermant (sur sa ligne ou plus loin), un `#` suivi d'un blanc
// ou quatre dièses et plus (`######`, `#### x ###`, qui n'ouvrent aucun bloc : opensHashBlock) jusqu'au bout de sa ligne ; -1 sinon (un
// `#nom` est un nom privé, un `#{…}` n'ouvre jamais de commentaire, ni un `#` juste après un point : `$l.#`, la longueur de Civet)
export function hashCommentEnd(text: string, i: number): number {
  if (text[i - 1] === '.') return -1
  if (opensHashBlock(text, i)) {
    const e = text.indexOf('###', i + 3)
    return e < 0 ? text.length : e + 3
  }
  if (text[i] !== '#' || !(/\s/.test(text[i + 1] ?? ' ') || text.startsWith('###', i))) return -1
  const e = text.indexOf('\n', i)
  return e < 0 ? text.length : e
}

// fin (exclue) d'une chaîne à trois guillemets ouverte en i (`"""a "x # y" b"""`, `'''…'''`) : ses trois guillemets fermants, ou le bout du
// texte ; les guillemets seuls qu'elle contient ne la ferment pas
function tripleQuoteEnd(text: string, i: number): number {
  const q = text.slice(i, i + 3)
  let j   = i + 3
  while (j < text.length && !text.startsWith(q, j)) j += text[j] === '\\' ? 2 : 1
  return Math.min(j + 3, text.length)
}

// le texte d'une expression du gabarit sans ses commentaires `# …` (hashCommentEnd), ses chaînes, gabarits et regex lus d'un bloc :
// `{$t # note}` se lit `$t`, comme un commentaire du script
export function noHashComment(text: string): string {
  if (!text.includes('#')) return text
  let out = ''
  let i   = 0
  while (i < text.length) {
    const c = text[i]
    const f = hashCommentEnd(text, i)
    if (f > i) {
      i = f
      continue
    }
    const e = text.startsWith('"""', i) || text.startsWith("'''", i) ? tripleQuoteEnd(text, i) : c === '"' || c === "'" ? stringEnd(text, i) : c === '`' || c === '/' ? scanInertAt(text, i, true) : -1
    if (e > i) {
      out += text.slice(i, e)
      i = e
      continue
    }
    out += c
    i++
  }
  return out
}

// opensHashBlock — un bloc `###` s'ouvre-t-il en i ? trois dièses que ne suit pas un quatrième : `####`, `#### titre`, une
// bannière de dièses ne commentent que leur ligne, règle de CoffeeScript et de Civet. Seule lecture de cette règle, pour le
// compilateur (sugar.ts) comme pour ses lecteurs : masque commun, lexeur, commentaires des expressions du gabarit, retrait des
// commentaires, découpe des régions, contrôle des directives d'un fichier serveur
export function opensHashBlock(src: string, i: number): boolean {
  return src.startsWith('###', i) && src[i + 3] !== '#'
}

// scanInertAt — un littéral/commentaire commence-t-il en `i` ? rend l'offset de FIN
// (exclu), ou -1 (rien ici, ou littéral non terminé) ; `dialecte` : code Coffee ou Civet, où une regex se passe aussi
// sans parenthèses (`s.split /@/`, regexInArgument)
export function scanInertAt(src: string, i: number, dialect = false): number {
  const c = src[i]
  if (c === '#') {
    if (opensHashBlock(src, i)) { const e = src.indexOf('###', i + 3); return e < 0 ? -1 : e + 3 }
    if (IDENT_START_RE.test(src[i + 1] ?? '')) return -1   //`#nom` = symbole, pas un commentaire
    const e = src.indexOf('\n', i)
    return e < 0 ? src.length : e
  }
  if (c === '/') {
    // regex étendue `///…///` de Coffee et de Civet, sur plusieurs lignes : inerte jusqu'à son `///` fermant et ses drapeaux, ses `$x`
    // restent du texte de la regex ; une interpolation `#{…}` dedans la laisse lue comme avant (son code reste du code)
    if (dialect && src.startsWith('///', i)) {
      const f = heregexEnd(src, i)
      if (f > 0) return f
    }
    if (src[i + 1] === '/') { const e = src.indexOf('\n', i); return e < 0 ? src.length : e }
    if (src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); return e < 0 ? -1 : e + 2 }
    // littéral regex `/…/` : ZONE INERTE au même titre qu'une chaîne. Sans ce
    // garde-fou, un `§`/`§§` À L'INTÉRIEUR d'un regex (`/§theme/`) survivait à CE masquage et se
    // faisait manger par les pré-passes §/§§ juste en dessous (AVANT même que la règle 3.1a du
    // scanner, plus bas dans ce fichier, ne voie le littéral en entier). Même heuristique
    // PARTAGÉE (sigils.ts) que la règle 3.1a et le parser.
    if (opensRegex(src.slice(0, i)) || (dialect && regexInArgument(src, i))) return scanRegexLiteral(src, i)
    return -1
  }
  if (c === '"' || c === "'") {
    const triple = c + c + c
    if (src.startsWith(triple, i)) { const e = src.indexOf(triple, i + 3); return e < 0 ? -1 : e + 3 }   //heredocs
    let j = i + 1
    while (j < src.length) {
      const d = src[j]
      if (d === '\\') { j += 2; continue }
      if (d === '\n') return -1                            //chaîne simple : jamais multi-ligne
      if (d === c) return j + 1
      j++
    }
    return -1
  }
  if (c === '`') return scanTemplateAt(src, i)
  return -1
}

// scanTemplateAt — backtick ouvrant en `i` : avance jusqu'au backtick fermant du MÊME
// niveau, en traversant les interpolations (elles-mêmes porteuses de backticks, de
// chaînes et d'accolades imbriquées)
export function scanTemplateAt(src: string, i: number): number {
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === '`') return j + 1
    if (c === '$' && src[j + 1] === '{') {
      const e = scanInterpAt(src, j + 2)
      if (e < 0) return -1
      j = e
      continue
    }
    j++
  }
  return -1
}

// scanInterpAt — intérieur d'une interpolation (offset du 1er caractère après
// l'accolade) : rend l'offset APRÈS l'accolade fermante de profondeur 0, ou -1 si
// jamais refermée
function scanInterpAt(src: string, i: number): number {
  let depth = 1
  let j     = i
  while (j < src.length) {
    const c = src[j]
    if (c === '{') { depth++; j++; continue }
    if (c === '}') { depth--; j++; if (depth === 0) return j; continue }
    // AVANT : un `/` n'était sauté en bloc que pour `//`/`/* */` — un littéral regex générique
    // (`/…/`) tombait dans le `j++` du bas, caractère par caractère. Un backtick DANS ce regex
    // (`/`/`) était alors vu, à l'itération suivante, comme un VRAI début de gabarit imbriqué
    // (branche `c === '`'` juste en dessous) : le scan partait chercher un backtick fermant
    // n'importe où plus loin, décalait la position, et corrompait le texte littéral du gabarit
    // voisin — trouvé en revue le 23/09/2026, prouvé par exécution. scanInertAt sait déjà
    // distinguer regex/division (opensRegex, cf. scanInertAt ci-dessus et sigils.ts) : lui
    // déléguer TOUT `/` laisse la division retomber sur le même repli `j++` qu'avant (aucun
    // littéral détecté), sans rien changer pour elle.
    if (c === '`' || c === '"' || c === "'" || c === '/') {
      const e = scanInertAt(src, j)                        //chaîne/commentaire/regex imbriqué : sauté d'un bloc
      j = e < 0 ? j + 1 : e
      continue
    }
    j++
  }
  return -1
}

// scanDoubleQuoteAt — guillemet double ouvrant en `i` (chaîne d'une ligne, pas un `"""`) : rend l'offset
// APRÈS le guillemet fermant du MÊME niveau, ou -1 si la ligne ne le referme pas. Une interpolation `#{…}`
// refermée sur la ligne est traversée d'un bloc, elle peut porter ses propres guillemets
// (`"Bonjour #{ if $ok then "oui" else "non" }"`) ; non refermée, elle se lit comme du texte.
// Lecteur PARTAGÉ : le lexeur (règle 3.1) et les deux conversions Coffee `"…#{X}…"` → gabarit
// (transpiler/index.ts pour le <script>, generator/utils.ts pour le gabarit)
export function scanDoubleQuoteAt(src: string, i: number): number {
  let line: string | null = null
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      if (j + 1 >= src.length || /[\n\r\u2028\u2029]/.test(src[j + 1])) return -1   //pas de chaîne sur deux lignes
      j += 2
      continue
    }
    if (c === '\n') return -1
    if (c === '"') return j + 1
    if (c === '#' && src[j + 1] === '{') {
      if (line === null) { const end = src.indexOf('\n', j); line = end < 0 ? src : src.slice(0, end) }
      const e = scanInterpAt(line, j + 2)
      if (e > 0) { j = e; continue }
    }
    j++
  }
  return -1
}

const WORD_CHAR_RE    = /[\p{L}\p{N}_$]/u
const DIVISION_END_RE = /[\w$)\]]/

// le guillemet de `i`, que sa ligne ne referme pas, peut-il ouvrir une chaîne écrite sur plusieurs lignes ? non s'il est collé à un
// mot (l'apostrophe d'un texte, `l'un`), doublé (`"""` jamais refermé), ou si une barre `/` de sa ligne, avant lui, a été lue comme
// du code (`slash` : position de la dernière) sans être sûrement une division (suivie d'un blanc, ou collée à la valeur qu'elle
// divise) — une regex que la lecture n'a pas reconnue, en tête de ligne après une valeur (`/["']/.test s`), porte des guillemets
// qui n'ouvrent rien (règle du lecteur du script, readString)
function opensLongString(src: string, i: number, slash: number): boolean {
  if (src[i + 1] === src[i] || WORD_CHAR_RE.test(src[i - 1] ?? '')) return false
  return slash < src.lastIndexOf('\n', i - 1) + 1 || /\s/.test(src[slash + 1] ?? '') || DIVISION_END_RE.test(src[slash - 1] ?? '')
}

// gabarit `` `…${X}…` `` d'une chaîne Coffee `"…#{X}…"` (corps sans ses guillemets) : `` ` `` et `${` du texte
// échappés, un échappement recopié d'un bloc ; le code de chaque interpolation (lue au niveau, scanInterpAt) repasse
// par la conversion — une chaîne interpolée écrite DANS une interpolation devient gabarit elle aussi, comme au premier
// niveau. Une interpolation vide ou jamais refermée reste du texte
function toTemplateLiteral(body: string): string {
  let out = ''
  let j   = 0
  while (j < body.length) {
    const c = body[j]
    if (c === '\\') { out += body.slice(j, j + 2); j += 2; continue }
    if (c === '#' && body[j + 1] === '{') {
      const e = scanInterpAt(body, j + 2)
      if (e > j + 3) { out += '${' + convertCoffeeInterpolations(body.slice(j + 2, e - 1)) + '}'; j = e; continue }
    }
    if (c === '$' && body[j + 1] === '{') { out += '\\${'; j += 2; continue }
    out += c === '`' ? '\\`' : c
    j++
  }
  return '`' + out + '`'
}

// conversion Coffee `"…#{X}…"` → gabarit `` `…${X}…` `` (Civet ne lit pas `#{}`), SOURCE UNIQUE : Pass 3 du <script>
// (transpiler/index.ts) et expressions du gabarit (generator/utils.ts). Double-quote seulement (Coffee n'interpole pas
// les single-quotes) ; scan contexte-aware : commentaires, chaînes simples, gabarits natifs et heredocs `'''` intacts.
// `chaine` : ce que devient une chaîne double interpolée, de son corps (sans ses guillemets) et de ses guillemets. Une regex est
// lue d'un bloc, ses guillemets n'ouvrent aucune chaîne ; `dialecte` : code Civet ou CoffeeScript, où elle se passe aussi sans
// parenthèses (`s.replace /"/g, 'R'`, regexInArgument)
export function convertCoffeeInterpolations(src: string, str: (bodyCode: string, quotes: string) => string = toTemplateLiteral, dialect = false): string {
  let res = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i)
      const end = e === -1 ? n : e
      res += src.slice(i, end); i = end; continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e === -1 ? n : e + 2
      res += src.slice(i, end); i = end; continue
    }
    if (ch === '/' && (opensRegex(src.slice(0, i)) || (dialect && regexInArgument(src, i)))) {
      const end = scanRegexLiteral(src, i)
      if (end !== -1) { res += src.slice(i, end); i = end; continue }
    }
    if (src.startsWith("'''", i)) {
      const e = src.indexOf("'''", i + 3)
      const end = e === -1 ? n : e + 3
      res += src.slice(i, end); i = end; continue
    }
    if (ch === "'") {
      let j = i + 1
      while (j < n && src[j] !== "'" && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
      if (j < n && src[j] === "'") { res += src.slice(i, j + 1); i = j + 1 } else { res += src.slice(i, j); i = j }
      continue
    }
    if (ch === '`') {
      const end = skipQuotedSpan(src, i)
      res += src.slice(i, end); i = end; continue
    }
    if (src.startsWith('"""', i)) {
      const e = src.indexOf('"""', i + 3)
      if (e === -1) { res += src.slice(i); break }
      const body = src.slice(i + 3, e)
      res += body.includes('#{') ? str(body, '"""') : src.slice(i, e + 3)
      i = e + 3; continue
    }
    if (ch === '"') {
      // une interpolation `#{…}` peut porter ses propres guillemets (scanDoubleQuoteAt) ; sinon, lecture d'avant
      let j = scanDoubleQuoteAt(src, i) - 1
      // écrite sur plusieurs lignes en Civet : lue jusqu'à son guillemet fermant (scriptStringEnd, le lecteur du script), interpolée de même
      const f = j < 0 && dialect ? scriptStringEnd(src, i, true) : i
      if (f > i) j = f - 1
      if (j < 0) {
        j = i + 1
        while (j < n && src[j] !== '"' && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
        if (j >= n || src[j] === '\n') { res += src.slice(i, j); i = j; continue }
      }
      const body = src.slice(i + 1, j)
      res += body.includes('#{') ? str(body, '"') : src.slice(i, j + 1)
      i = j + 1; continue
    }
    res += ch; i++
  }
  return res
}

// le code de chaque interpolation `#{…}` des chaînes doubles de `src` passé par `fn`, les chaînes gardées telles quelles : mêmes chaînes
// et mêmes bornes que la conversion en gabarit ci-dessus, pour un code que Coffee lit lui-même (les gestionnaires du gabarit)
export function interpolationCode(src: string, fn: (code: string) => string): string {
  return convertCoffeeInterpolations(src, (body, quotes) => {
    let out = ''
    let j   = 0
    while (j < body.length) {
      const c = body[j]
      if (c === '\\') { out += body.slice(j, j + 2); j += 2; continue }
      if (c === '#' && body[j + 1] === '{') {
        const e = scanInterpAt(body, j + 2)
        if (e > j + 3) { out += '#{' + fn(body.slice(j + 2, e - 1)) + '}'; j = e; continue }
      }
      out += c
      j++
    }
    return quotes + out + quotes
  })
}

// ─── LECTEUR DU SCRIPT ──────────────────────────────────────────────────────
// le lecteur du script de Civet ou de CoffeeScript (`dialecte`), ou de JavaScript : ses plages dans l'ordre, sans trou ni
// recouvrement — code, chaîne, expression régulière, commentaire (SPAN) —, lues comme le langage les lit ; les passes du script
// (transpiler/sugar.ts, le retrait des commentaires de transpiler/sections.ts, le masque du lexeur) le partagent :
// - une chaîne `"…"` ou `'…'` court jusqu'à son guillemet fermant, sur autant de lignes qu'il faut ; laissée ouverte sur sa ligne,
//   elle n'en ouvre une que là où une chaîne peut commencer (opensLongString : un guillemet collé à un mot, ou qui suit sur sa
//   ligne une barre lue comme une division douteuse, reste du code) ;
// - le code d'une interpolation (`${…}` d'un gabarit, `#{…}` d'une chaîne `"…"`, `"""…"""`, ou d'une regex étendue `///…///` de
//   CoffeeScript : Civet laisse `#{…}` en texte dans une regex étendue) est
//   lu comme un script à lui, une profondeur plus bas, entre les plages de texte de son littéral ;
// - `#` ouvre un commentaire d'une ligne (sauf un nom privé `#nom` et `#!`), `###` un commentaire jusqu'au `###` fermant (`####` :
//   d'une ligne), `//` et `/* */` des commentaires, `/…/` une regex là où une valeur commence ; en dialecte, `///` ouvre une regex
//   étendue, `"""` et `'''` une chaîne à trois guillemets, et une regex se passe aussi sans parenthèses (regexInArgument)
export const SPAN = { CODE: 0, STRING: 1, REGEX: 2, COMMENT: 3 } as const

/** une plage du script : sa sorte (SPAN), son début, sa fin (exclue), sa profondeur (0 au niveau du script, 1 dans le code d'une
 *  interpolation, et ainsi de suite) */
export type ScriptSpan = [number, number, number, number]

/** heregex `///…///` de Coffee et de Civet en `i` : index juste après son `///` fermant et ses drapeaux, ou -1 si elle ne se referme
 *  pas ; un `\` échappe le caractère qui le suit */
export function endOfHeregex(src: string, i: number): number {
  let j = i + 3
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue }
    if (src.startsWith('///', j)) {
      j += 3
      while (j < src.length && /[a-z]/.test(src[j])) j++
      return j
    }
    j++
  }
  return -1
}

/** les plages du script `src` (cf. le bandeau du lecteur ci-dessus) */
export function scriptSpans(src: string, dialect = true, coffee = false): ScriptSpan[] {
  const out: ScriptSpan[] = []
  readSpans(src, 0, 0, dialect, out, coffee)
  return out
}

/** fin (exclue) de la chaîne `"…"` ou `'…'` ouverte en `i`, refermée sur sa ligne ou plus loin, telle que la lit le lecteur du
 *  script ; `i` si ce guillemet n'ouvre aucune chaîne refermée */
export function scriptStringEnd(src: string, i: number, dialect = true, coffee = false): number {
  const startPos = src.lastIndexOf('\n', i - 1) + 1
  let slash      = -1
  for (const [kind, start, end, depth] of scriptSpans(src.slice(startPos, i), dialect, coffee)) {
    if (kind === SPAN.CODE && depth === 0) { const k = src.lastIndexOf('/', startPos + end - 1); if (k >= startPos + start) slash = k }
  }
  const read = readString(src, i, 0, 0, dialect, [], slash, coffee)
  return read.closed ? read.end : i
}

// plage `kind` de `out`, collée à la précédente de même sorte et de même profondeur
function pushSpan(out: ScriptSpan[], kind: number, start: number, end: number, depth: number): void {
  if (end <= start) return
  const last = out[out.length - 1]
  if (last !== undefined && last[0] === kind && last[3] === depth && last[2] === start) last[2] = end
  else out.push([kind, start, end, depth])
}

// les plages de `text`, placé en `base` dans le script : le code d'une interpolation se lit seul, comme un script à lui (une regex y
// commence là où une valeur commence dans ce code)
function readSpans(text: string, base: number, depth: number, dialect: boolean, out: ScriptSpan[], coffee: boolean): void {
  const n   = text.length
  let i     = 0
  let code  = 0
  let slash = -1
  const zone = (kind: number, end: number): void => {
    pushSpan(out, SPAN.CODE, base + code, base + i, depth)
    pushSpan(out, kind, base + i, base + end, depth)
    i = code = end
  }
  while (i < n) {
    const c = text[i]
    if (c === '/' && dialect && text.startsWith('///', i)) {
      const end = endOfHeregex(text, i)
      if (end !== -1) {
        let closes = end
        while (/[a-z]/.test(text[closes - 1])) closes--
        pushSpan(out, SPAN.CODE, base + code, base + i, depth)
        readDelimited(text, i, closes - 3, end, coffee, SPAN.REGEX, base, depth, dialect, out, coffee)
        i = code = end
        continue
      }
    }
    if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); zone(SPAN.COMMENT, e < 0 ? n : e); continue }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); zone(SPAN.COMMENT, e < 0 ? n : e + 2); continue }
    if (c === '#' && opensHashBlock(text, i)) { const e = text.indexOf('###', i + 3); zone(SPAN.COMMENT, e < 0 ? n : e + 3); continue }
    if (c === '#' && (coffee || !/[a-zA-Z_!]/.test(text[i + 1] ?? ' '))) { const e = text.indexOf('\n', i); zone(SPAN.COMMENT, e < 0 ? n : e); continue }
    if (c === '/' && (opensRegex(text.slice(0, i)) || (dialect && regexInArgument(text, i)))) {
      const end = scanRegexLiteral(text, i)
      if (end !== -1) { zone(SPAN.REGEX, end); continue }
    }
    if (c === '"' || c === "'" || c === '`') {
      const pieces: ScriptSpan[] = []
      const read = readString(text, i, base, depth, dialect, pieces, slash, coffee)
      if (read.end > i) {
        pushSpan(out, SPAN.CODE, base + code, base + i, depth)
        for (const [kind, start, end, depth] of pieces) pushSpan(out, kind, start, end, depth)
        i = code = read.end
        continue
      }
    }
    if (c === '/') slash = i
    i++
  }
  pushSpan(out, SPAN.CODE, base + code, base + n, depth)
}

// littéral [i, stop) au délimiteur fermant connu (en `ferme`) — chaîne à trois guillemets, regex étendue : ses plages de texte
// (`kind`), et le code de chaque interpolation `#{…}` refermée avant `ferme` quand il en porte (`interpolates`), une profondeur plus bas
function readDelimited(text: string, i: number, closes: number, stop: number, interpolates: boolean, kind: number, base: number, depth: number, dialect: boolean, out: ScriptSpan[], coffee: boolean): void {
  let from = i
  if (interpolates) {
    for (let j = i + 3; j < closes; j++) {
      if (text[j] === '\\') { j++; continue }
      if (text[j] !== '#' || text[j + 1] !== '{') continue
      const end = expressionEnd(text, j + 1)
      if (end < 0 || end > closes) continue
      pushSpan(out, kind, base + from, base + j + 2, depth)
      readSpans(text.slice(j + 2, end - 1), base + j + 2, depth + 1, dialect, out, coffee)
      from = end - 1
      j    = end - 1
    }
  }
  pushSpan(out, kind, base + from, base + stop, depth)
}

// chaîne ouverte en `i` (guillemet, apostrophe, backtick, ou trois guillemets en dialecte) : ses plages dans `out`, sa fin et si son
// guillemet fermant est lu (`closed`) ; `end` vaut `i` quand ce guillemet n'ouvre aucune chaîne — laissé ouvert sur sa ligne là où
// une chaîne ne peut pas commencer (`slash` : la dernière barre lue comme du code)
function readString(text: string, i: number, base: number, depth: number, dialect: boolean, out: ScriptSpan[], slash: number, coffee: boolean): { end: number, closed: boolean } {
  const n = text.length
  const q = text[i]
  if (dialect && q !== '`' && text.startsWith(q + q + q, i)) {
    const e    = text.indexOf(q + q + q, i + 3)
    const stop = e < 0 ? n : e + 3
    readDelimited(text, i, stop - 3, stop, q === '"', SPAN.STRING, base, depth, dialect, out, coffee)
    return { end: stop, closed: e >= 0 }
  }
  // signe d'une interpolation : `${…}` d'un gabarit, `#{…}` d'une chaîne `"…"` de Civet ou de CoffeeScript ; jamais refermée, une
  // interpolation `#{` reste du texte, celle d'un gabarit est du code jusqu'à la fin
  const mark = q === '`' ? '$' : dialect && q === '"' ? '#' : ''
  let start  = i
  let j      = i + 1
  let closed = false
  while (j < n) {
    if (text[j] === '\\') { j += 2; continue }
    if (text[j] === q) { j++; closed = true; break }
    if (mark && text[j] === mark && text[j + 1] === '{') {
      const end = expressionEnd(text, j + 1)
      if (end < 0) {
        if (mark === '#') { j += 2; continue }
        pushSpan(out, SPAN.STRING, base + start, base + j + 2, depth)
        pushSpan(out, SPAN.CODE, base + j + 2, base + n, depth + 1)
        return { end: n, closed: false }
      }
      pushSpan(out, SPAN.STRING, base + start, base + j + 2, depth)
      readSpans(text.slice(j + 2, end - 1), base + j + 2, depth + 1, dialect, out, coffee)
      start = end - 1
      j     = end
      continue
    }
    j++
  }
  j = Math.min(j, n)
  if (q !== '`' && text.slice(i, j).includes('\n') && !opensLongString(text, i, slash)) { out.length = 0; return { end: i, closed: false } }
  pushSpan(out, SPAN.STRING, base + start, base + j, depth)
  return { end: j, closed }
}

// fin de la ligne de `i` : position de son saut, ou fin du texte
function lineEndOf(src: string, i: number): number {
  const e = src.indexOf('\n', i)
  return e < 0 ? src.length : e
}

// inertRanges — toutes les plages inertes de `src`, dans l'ordre, sans recouvrement ; `heregex` : code Coffee ou Civet, où `///…///`
// est une regex étendue (heregexEnd), pas un commentaire `//` suivi de lignes de code, et où une chaîne `"…"` ou `'…'` court sur
// autant de lignes qu'il faut (scriptStringEnd, le lecteur du script) ; une regex étendue qui porte une interpolation `#{…}` a son texte
// inerte, le code de l'interpolation reste du code ; `coffee` : CoffeeScript, où `#` ouvre toujours un commentaire (`#x` compris : ce
// langage n'a pas de nom privé)
export function inertRanges(src: string, heregex = false, coffee = false): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#' || c === '/' || c === '"' || c === "'" || c === '`') {
      const h = heregex && src.startsWith('///', i) ? heregexEnd(src, i) : -1
      const r = h < 0 && heregex && src.startsWith('///', i) ? endOfHeregex(src, i) : -1
      if (r > 0) {
        for (const [kind, start, end] of scriptSpans(src.slice(i, r), true, coffee)) if (kind !== SPAN.CODE) out.push([i + start, i + end])
        i = r
        continue
      }
      let e = h > 0 ? h : coffee && c === '#' && !opensHashBlock(src, i) ? lineEndOf(src, i) : scanInertAt(src, i)
      if (e <= i && heregex && (c === '"' || c === "'") && !src.startsWith(c + c + c, i)) e = scriptStringEnd(src, i, true, coffee)
      if (e > i) { out.push([i, e]); i = e; continue }
    }
    i++
  }
  return out
}

// replaceInert — réécrit chaque plage inerte par `fn(texte)`, laisse le reste intact
function replaceInert(src: string, fn: (tok: string) => string, heregex = false, coffee = false): string {
  const ranges = inertRanges(src, heregex, coffee)
  if (ranges.length === 0) return src
  let out    = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    out   += src.slice(cursor, start) + fn(src.slice(start, end))
    cursor = end
  }
  return out + src.slice(cursor)
}

// delimiteur de masque : NUL, absent de toute source .mjs (garde le fichier en
// ASCII pur -- pas d'octet NUL litteral qui le classerait binaire pour grep)
const NUL = String.fromCharCode(0)
const UNMASK_RE = new RegExp(NUL + '(\\d+)' + NUL, 'g')

function maskInert(src: string, heregex = false, coffee = false): { masked: string; slots: string[] } {
  const slots: string[] = []
  const masked = replaceInert(src, (tok) => NUL + (slots.push(tok) - 1) + NUL, heregex, coffee)
  return { masked, slots }
}

function unmaskInert(src: string, slots: string[]): string {
  return slots.length === 0 ? src : src.replace(UNMASK_RE, (_m, id) => slots[+id])
}

// contextValueEnd — fin de la valeur d'un setter de contexte (`§x = v`, `§§x = v`), lue sur une vue
// MASQUÉE (chaînes et commentaires neutralisés) : un `if`/`unless` postfixe, ou le `then`/`else` d'un `if`
// qui englobe le setter, n'appartiennent pas à la valeur — avalés dans l'appel émis, ils donnaient un code
// que Civet refuse (`this._mjs_setContext('theme', 'dark' if $.sombre)`). Un `if … then … else …` écrit
// COMME valeur, un mot entre parenthèses, une propriété (`p.then`) et tout ce qui suit une flèche (corps de
// fonction) restent dans la valeur. `brut` (même longueur que `masque`) dit si une valeur précède le
// mot-clé : dans une vue masquée à longueur égale, une chaîne n'est plus que des blancs. Rend l'index du
// mot-clé qui termine la valeur, ou la longueur de `masque`
const WORDS_BEFORE_VALUE = new Set([ 'if', 'unless', 'then', 'else', 'and', 'or', 'not', 'is', 'isnt', 'in', 'of', 'instanceof', 'return', 'typeof', 'new', 'await', 'yield', 'void', 'delete' ])

export function contextValueEnd(mask: string, raw: string = mask): number {
  let depth = 0
  let openIfs = 0
  for (const m of mask.matchAll(/[A-Za-z_$][\w$]*|->|=>|[()[\]{}]/g)) {
    const word = m[0]
    const pos  = m.index!
    if (word === '(' || word === '[' || word === '{') { depth++; continue }
    if (word === ')' || word === ']' || word === '}') { depth--; continue }
    if (depth !== 0 || mask[pos - 1] === '.' || mask[pos - 1] === '@') continue
    if (word === '->' || word === '=>') return mask.length
    if (word === 'if' || word === 'unless') {
      if (afterValue(raw, pos)) return pos
      openIfs++
    }
    else if (word === 'then') {
      if (openIfs === 0) return pos
    }
    else if (word === 'else') {
      if (openIfs === 0) return pos
      openIfs--
    }
  }
  return mask.length
}

// vrai si une valeur se termine juste avant `pos` (mot, nombre, chaîne, fermante, chaîne masquée en
// emplacement `\0n\0`) : le `if`/`unless` qui suit est alors postfixe
function afterValue(raw: string, pos: number): boolean {
  const before = raw.slice(0, pos).trimEnd()
  const word   = before.match(/[A-Za-z_$][\w$]*$/)
  if (word) return !WORDS_BEFORE_VALUE.has(word[0])
  return /[\w$'"`)\]}\u0000]$/.test(before)
}

// splitTrailingMaskedComment — un commentaire masqué en TOUTE FIN de capture (§/§§, règles 1
// et 2-bis ci-dessous) doit sortir de l'argument AVANT que le générateur y pose sa `)` : sinon,
// au démasquage, le `#`/`//` restauré avale tout le reste de la ligne, `)` comprise
// (exemple exact docs/13-contexte.md:75, `§canvas = { addItem }   # le service…`).
// Une chaîne/regex/heredoc masqué EN FIN d'expression (`§msg = 'texte'`) N'EST PAS concerné :
// seul le CONTENU du slot (`#`/`//`/`/*`) tranche — une simple adjacence d'espaces ne suffit pas
// à distinguer les deux cas (une chaîne finale légitime peut aussi être précédée d'un espace,
// `$x + '  '`).
function splitTrailingMaskedComment(expr: string, slots: string[]): { code: string; tail: string } {
  const m = expr.match(new RegExp('^([\\s\\S]*?)(\\s*' + NUL + '(\\d+)' + NUL + ')$'))
  if (!m) return { code: expr, tail: '' }
  const slot = slots[+m[3]] ?? ''
  if (!(slot.startsWith('#') || slot.startsWith('//') || slot.startsWith('/*'))) return { code: expr, tail: '' }
  return { code: m[1], tail: m[2] }
}

// scinde `tail` par les virgules de PROFONDEUR 0 (hors parenthèses/crochets/
// accolades) — texte déjà masqué (maskInert), pas de quotes à gérer ici
function splitTopLevelCommas(tail: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of tail) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' }
    else cur += ch
  }
  parts.push(cur)
  return parts
}

// maskInertSameLength — variante MÊME LONGUEUR de maskInert : chaque littéral/
// commentaire (lecteur à niveaux) est remplacé par des espaces, `\n` préservés → les
// offsets restent alignés avec la source d'origine (utile pour re-matcher sur
// la vue masquée puis relire le texte réel via `m.indices`, cf. transpiler/sections.ts). `dialecte` : code Civet ou CoffeeScript
// (regex étendue `///…///`, chaîne `"…"` ou `'…'` sur plusieurs lignes : cf. inertRanges)
export function maskInertSameLength(src: string, dialect = false, coffee = false): string {
  return replaceInert(src, (tok) => tok.replace(/[^\n]/g, ' '), dialect, coffee)
}

// maskInertKeepingTemplateCode — comme maskInertSameLength, sauf les parties calculées `${…}` d'un gabarit : elles restent du code (leurs
// propres littéraux masqués à leur tour), même longueur, `\n` préservés ; un appel posé dans un gabarit (`son : ${f(x)}`) reste visible,
// le texte du gabarit est blanchi
export function maskInertKeepingTemplateCode(src: string): string {
  return replaceInert(src, (tok) => tok[0] === '`' ? maskTemplateText(tok) : tok.replace(/[^\n]/g, ' '))
}

function maskTemplateText(tok: string): string {
  let out = ''
  let j   = 0
  while (j < tok.length) {
    if (tok[j] === '\\') {
      out += tok.slice(j, j + 2).replace(/[^\n]/g, ' ')
      j   += 2
      continue
    }
    if (tok[j] === '$' && tok[j + 1] === '{') {
      let depth = 1
      let k     = j + 2
      while (k < tok.length && depth > 0) {
        const ch = tok[k]
        if (ch === '/' || ch === '"' || ch === "'" || ch === '`') {
          const e = scanInertAt(tok, k)
          if (e > k) {
            k = e
            continue
          }
        }
        if (ch === '{') depth++
        if (ch === '}') depth--
        if (depth > 0) k++
      }
      out += '  ' + maskInertKeepingTemplateCode(tok.slice(j + 2, k)) + (k < tok.length ? ' ' : '')
      j    = k + 1
      continue
    }
    out += tok[j] === '\n' ? '\n' : ' '
    j++
  }
  return out
}

// interpolateSigils — dans une chaîne, tokenise le contenu des interpolations
// `<marker>{ ... }` (`#{...}` pour Coffee/Civet, `${...}` pour les template
// literals). Les parties littérales restent intactes ; seul le code des
// interpolations passe par `tokenize` (récursif). Gère les `{}` imbriqués.
// `texte` / `origine` : le texte où `str` commence, à cet offset — de quoi situer une erreur levée dans une interpolation
function interpolateSigils(str: string, marker: string, opts: TokenizeOpts, text: string, origin: number): string {
  let out = ''
  let j = 0
  while (j < str.length) {
    // un échappement se recopie d'un bloc : dans `C:\\${$y}`, l'antislash est échappé et l'interpolation
    // reste du code ; `\${…}` est une interpolation échappée, du texte
    if (str[j] === '\\') { out += str.slice(j, j + 2); j += 2; continue }
    if (str[j] === marker && str[j + 1] === '{') {
      let depth = 1
      let k = j + 2
      // comptage des `{}` CONSCIENT des zones inertes (chaînes, commentaires,
      // regex) : sans ça, un `}` littéral dans l'une d'elles (`#{ fn('}') + $y }`,
      // `${ /* } */ $y }`, `${ /}/.test(x) ? $y : 1 }`) décrémentait `depth` et
      // fermait trop tôt → la fin réelle copiée VERBATIM hors zone tokenisée →
      // `$y` restait littéral (ReferenceError au runtime). Même lecteur que
      // `scanInertAt` (ci-dessus, même fichier) : une zone jamais refermée
      // (`e === -1`) retombe sur le caractère courant, sans avancer. Jamais sur `#` :
      // DANS une interpolation, `#` est un champ privé ou un `#longueur` Civet, pas un
      // commentaire (même règle que skipInertFrom de sigils.ts) — le lire comme un
      // commentaire avalait jusqu'à la fin de ligne le `}` qui ferme l'interpolation.
      while (k < str.length && depth > 0) {
        const ch = str[k]
        if (ch === '/' || ch === '"' || ch === "'" || ch === '`') {
          const e = scanInertAt(str, k)
          if (e > k) { k = e; continue }
        }
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) break }
        k++
      }
      // jamais refermée : recopiée telle quelle, sans `}` ajoutée — le compilateur du langage signale l'oubli
      if (depth > 0) { out += str.slice(j); break }
      const inner = str.slice(j + 2, k)
      out += marker + '{' + tokenize(inner, opts.fileName ? locateIn(opts, text, origin + j + 2) : opts) + '}'
      j = k + 1
    } else {
      out += str[j]
      j++
    }
  }
  return out
}

// valeur de départ d'une écriture composée : `§§x` rend l'objet réactif du contexte, où une valeur simple posée par
// `§§x = 1` est rangée sous `value` (µ.state) — le calcul part de cette valeur, pas de l'objet (« [object Object]1 »),
// et `||=` voit un texte vide comme vide ; un contexte qui tient un objet est pris tel quel
function contextRead(target: string, readCall: string, name: string): string {
  const read = `${target}.${readCall}('${name}')`
  if (readCall !== '_mjs_getRCtx') return read
  return `((_c) => _c && typeof _c === 'object' && Object.keys(_c).join() === 'value' ? _c.value : _c)(${read})`
}

// écriture d'un contexte `§x = v` → `<cible>.<appel>('x', v)`, commune au <script> et aux gestionnaires du gabarit
// (generator/utils.ts). Affectation composée, comme sur une variable : `§x += v` vaut `§x = §x + (v)` (de même -= *= /=
// %= **= |= &= ^= <<= >>= >>>=), `§x ||= v` vaut `§x || (§x = v)` (de même &&= ??=), l'écriture n'a lieu que si
// l'opérateur la demande
export function contextWrite(target: string, call: string, readCall: string, name: string, op: string | undefined, value: string): string {
  const read = contextRead(target, readCall, name)
  if (op === '||' || op === '&&' || op === '??') return `${read} ${op} ${target}.${call}('${name}', ${value})`
  return `${target}.${call}('${name}', ${op ? `${read} ${op} (${value})` : value})`
}

// setters `§x = v` / `§§x = v` du <script> (vue masquée) → contextWrite ; une valeur coupée
// (contextValueEnd) laisse la suite à relire : le passage se répète tant qu'il a coupé quelque chose
function rewriteSetter(code: string, re: RegExp, call: string, readCall: string, target: string, slots: string[]): string {
  let cut = true
  while (cut) {
    cut = false
    code = code.replace(re, (_m, name, op, expr) => {
      const end  = contextValueEnd(expr)
      const head = end < expr.length ? expr.slice(0, end).trimEnd() : expr
      if (end < expr.length) cut = true
      const { code: realExpr, tail } = splitTrailingMaskedComment(head, slots)
      return `${contextWrite(target, call, readCall, name, op, realExpr)}${tail}${expr.slice(head.length)}`
    })
  }
  return code
}

// incrément et décrément d'un contexte, comme sur une variable : `§x++` et `++§x` valent `§x += 1`, `§x--` et `--§x`
// valent `§x -= 1` (de même `§§x`) — laissés au getter, ils donnaient `this._mjs_getContext('x')++`, que Civet refusait.
// Commun au <script> et aux gestionnaires du gabarit (generator/utils.ts)
export function incrementContextRe(mark: string): RegExp {
  return new RegExp(`(?<![\\w.§])${mark}([a-zA-Z_]\\w*)(\\+\\+|--)|(\\+\\+|--)${mark}([a-zA-Z_]\\w*)`, 'g')
}

export function rewriteIncrement(code: string, mark: string, call: string, readCall: string, target: string): string {
  return code.replace(incrementContextRe(mark), (_m, nameAfter, opAfter, opBefore, nameBefore) => {
    const name = nameAfter ?? nameBefore
    const op   = (opAfter ?? opBefore) === '++' ? '+' : '-'
    return `${target}.${call}('${name}', ${contextRead(target, readCall, name)} ${op} 1)`
  })
}

export function tokenize(codeRaw: string, opts: TokenizeOpts = {}): string {
  const externalVars = opts.externalVars ?? []
  const moduleMode   = opts.moduleMode ?? false
  const singletons   = opts.singletons ?? []
  const dialect      = opts.lang === 'coffee' || opts.lang === 'civet'
  // receveur des contextes § / §§ : le composant dont le script les porte (`_mjsThis`, capturé à l'init), quel que
  // soit l'appelant — `this` valait l'état dans une fonction rangée dans l'état (`$go = -> §x = 1`, appelée `$go()`).
  // Un module n'a pas de composant : `this` y reste
  const target = moduleMode ? 'this' : '_mjsThis'

  let code = codeRaw

  // 0. µtoggle($x, 'a', 'b') → `$x = (…)` — PRÉ-PASSE de tête, AVANT le masquage :
  // les valeurs du cycle SONT des chaînes littérales, un masquage fait ici les
  // rendrait invisibles (rewriteMuToggle masque elle-même).
  // Corps PARTAGÉ avec cleanJs (sigils.ts) ; la cible `$x`/`$$x` ressort VERBATIM,
  // c'est le scanner ci-dessous qui pose le setter réactif — comme µderived.
  code = rewriteMuToggle(code, '<script>')

  // on MASQUE chaînes/heredocs/commentaires le temps des 4 pré-passes
  // § / §§ ci-dessous (replace globaux aveugles au contexte), puis on restaure.
  const inert = maskInert(code, dialect, opts.lang === 'coffee')
  code = inert.masked

  // 1. setContext : `§foo = expr` → `_mjsThis._mjs_setContext('foo', expr)`
  // Le lookbehind exclut AUSSI `§` : sans ça, `§§foo` (contexte réactif) était
  // mangé ici (le 2e § est précédé d'un non-word) et le cas 3.3 (fallback §§
  // contexte réactif) du scanner était du code mort (bug V1 porté,
  // test skippé historique).
  // Un commentaire masqué en fin de ligne (`§foo = expr   # note`) sortait
  // de l'expression APRÈS la `)` : au démasquage le `#`/`//` avalait cette `)`, Civet partait en
  // erreur sur la ligne suivante. splitTrailingMaskedComment isole ce commentaire AVANT la `)`.
  // La valeur s'arrête avant un `if`/`unless` postfixe ou le `then`/`else` d'un `if` englobant
  // (contextValueEnd) ; la suite se relit alors, elle peut porter un autre setter (`else §x = 2`).
  // Une affectation composée (`§total += 1`) passe par le setter avec son opérateur : laissée au getter, elle
  // donnait `this._mjs_getContext('total') += 1`, que Civet refusait sur un message obscur.
  // `§x++`, `--§x` : réécrits d'abord, sur le contexte (`§§x++` plus bas, avec les contextes réactifs)
  code = rewriteIncrement(code, '§', '_mjs_setContext', '_mjs_getContext', target)
  code = rewriteSetter(code, /(?<![\w.§])§([a-zA-Z_]\w*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)\s*(.+?)(?=\n|;|$)/g, '_mjs_setContext', '_mjs_getContext', target, inert.slots)

  // 2. getContext : `§foo` → `_mjsThis._mjs_getContext('foo')`
  code = code.replace(
    /(?<![\w.§])§([a-zA-Z_]\w*)/g,
    (_m, name) => `${target}._mjs_getContext('${name}')`
  )

  // 2-bis. §§ CONTEXTE RÉACTIF de sous-arbre — TOUJOURS (plus aucune résolution
  //   vers un singleton importé : celui-ci se consomme désormais en `µ$$x`,
  //   jamais en `§§x` — cf. lintSingletonConsume). Setter `§§foo = expr` →
  //   `_mjsThis._mjs_setRCtx('foo', expr)` (déclaration sur l'ancêtre) ; getter
  //   `§§foo` → `_mjsThis._mjs_getRCtx('foo')` (remonte l'arbre + abonne).
  //   Ces `§§` échappent aux règles § (1/2) : leur lookbehind exclut un `§` devant.
  // Même correctif que la règle 1 ci-dessus (commentaire de fin de ligne isolé
  // AVANT la `)`, jamais capturé DANS l'expression).
  code = rewriteIncrement(code, '§§', '_mjs_setRCtx', '_mjs_getRCtx', target)
  code = rewriteSetter(code, /(?<![\w.§])§§([a-zA-Z_]\w*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)\s*(.+?)(?=\n|;|$)/g, '_mjs_setRCtx', '_mjs_getRCtx', target, inert.slots)
  code = code.replace(
    /(?<![\w.§])§§([a-zA-Z_]\w*)/g,
    (_m, name) => `${target}._mjs_getRCtx('${name}')`
  )

  // 2-ter. µderived $var = expr, $a, $b, … → dérivé à DÉPENDANCES FORCÉES. Réduit à
  // `$var = µ._mjs_forceDeps(expr, $a, $b, …)` — marqueur reconnu et EFFACÉ par
  // l'analyzer pour un JS final sans artefact. `expr` et les `$a`/`$b` restent
  // verbatim : le scanner du dessous les convertira normalement.
  code = code.replace(RE_MU_DERIVED_STMT, (_m, varName, tail, offset: number, text: string) => {
    // une faute se situe sur le texte démasqué : un littéral sur plusieurs lignes n'y est plus qu'un jeton
    const before   = unmaskInert(text.slice(0, offset), inert.slots)
    const reject   = (err: Error): Error => located(err, before, before.length, opts)
    const segments = splitTopLevelCommas(tail).map((s) => s.trim())
    const realExpr = segments[0] ?? ''
    if (!realExpr) throw reject(new Error(t('lexer.derived-expr-empty', { varName })))
    // `realExpr` sort de la vue MASQUÉE (maskInert, tout en haut de
    // tokenize) : un `await` DANS une chaîne/un commentaire a déjà été remplacé par un jeton
    // NUL, il ne peut plus matcher ici — seul un VRAI mot-clé await déclenche ce refus.
    if (/\bawait\b/.test(realExpr)) throw reject(new Error(t('transpiler.derived-await-forbidden', { varName })))
    const forcedDeps = segments.slice(1)
    for (const dep of forcedDeps) {
      if (!/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(dep)) {
        throw reject(new Error(t('lexer.derived-dep-invalid', { varName, dep })))
      }
    }
    const depsArg = forcedDeps.length > 0 ? `, ${forcedDeps.join(', ')}` : ''
    return `$${varName} = µ._mjs_forceDeps(${realExpr}${depsArg})`
  })

  // restaure les chaînes/commentaires masqués avant le scanner (qui
  // ré-isole lui-même les chaînes, et re-tokenise le code des interpolations).
  code = unmaskInert(code, inert.slots)

  // 3. Scanner caractère par caractère — gère strings/comments comme contextes inertes
  // La sortie s'assemble par morceaux : à chaque `/` de code (règle 3.1a), la part déjà jugée rejoint
  // `morceaux` et `result` n'en garde que la queue que lit opensRegex (blancs de fin + SCOPE_OPENS_REGEX
  // caractères : la parenthèse d'une condition `if (…)` se cherche jusque-là).
  // Relire une sortie de toute la taille du script à chaque `/` l'aplatissait : coût quadratique
  const pieces: string[] = []
  let result = ''
  let i = 0
  const n = code.length

  while (i < n) {
    const rest = code.slice(i)

    // 3.1 Comments / heredocs / strings — passe inchangé
    // - `###...###` / `# ...`  Coffee comments
    // - `//...`     line JS/Civet/TS (essentiel : sans ça, une apostrophe dans
    //                un `// L'éditeur` ouvre une string qui consume plusieurs
    //                lignes et casse la tokenisation des `$var` qui suivent)
    // - `/* ... */` block JS/Civet/TS
    // - `#identifier` PRÉSERVÉ : c'est un champ privé JS (Civet le supporte)
    // - `"""..."""` / `'''...'''` heredocs
    // - Strings ` " ' : limitées à une ligne (sinon une apostrophe non-fermée
    //                   mange jusqu'à la prochaine, souvent plusieurs lignes plus loin)
    //
    // Note : la conversion `#` Coffee → `//` Civet (Civet parse `#` comme
    // `this.length(...)`) se fait dans `applyMjsSugarToScript` (lang-aware),
    // pas ici — le lexer doit rester langage-agnostique.
    // NB sécurité : `\\` est EXCLU des classes négatives ([^\\`] etc.) pour que
    // les branches `\\.` et `[^...]` soient disjointes — sinon une chaîne non
    // fermée pleine de backslashes déclenche un backtracking exponentiel
    // (ReDoS build-time : ~40 backslashes ≈ 10 s de gel du watcher).
    // Gabarit à backtick : lu au NIVEAU (scanTemplateAt, MÊME lecteur que scanInertAt/
    // maskInert, partage l'imbrication backtick/interpolation) plutôt que par l'ancienne
    // alternative de la grande regex ci-dessous, qui se refermait au 1er backtick INTERNE
    // rencontré : sur un gabarit imbriqué dans une interpolation
    // (`` `a${ `inner${1}inner` }b` ``), elle tronquait le token au 2e backtick au lieu du
    // 6e, et `interpolateSigils` complétait alors avec une `}` FANTÔME (absente de la
    // source) — JS généré corrompu. Un littéral NON TERMINÉ (`scanTemplateAt` rend -1) n'est
    // PAS pris ici : repli sur la suite du scanner, comme avant (aucun cas ne le matchait).
    if (code[i] === '`') {
      const e = scanTemplateAt(code, i)
      if (e !== -1) {
        result += interpolateSigils(code.slice(i, e), '$', opts, code, i)
        i = e
        continue
      }
    }

    // Chaîne `"…"` : lue au NIVEAU, elle aussi (scanDoubleQuoteAt) — l'alternative `"…"` de la grande
    // regex ci-dessous s'arrêtait au premier guillemet d'une interpolation : `"Bonjour #{ if $ok then
    // "oui" else "non" }"` s'affichait « Bonjour }oui ». Non refermée sur la ligne : repli sur la regex
    // Écrite sur plusieurs lignes en Civet et en CoffeeScript : lue jusqu'à son guillemet fermant (scriptStringEnd, le lecteur du script)
    if (code[i] === '"' && !code.startsWith('"""', i)) {
      let e = scanDoubleQuoteAt(code, i)
      if (e === -1 && dialect) e = scriptStringEnd(code, i, true, opts.lang === 'coffee')
      if (e > i) {
        result += interpolateSigils(code.slice(i, e), '#', opts, code, i)
        i = e
        continue
      }
    }

    // chaîne `'…'` écrite sur plusieurs lignes en Civet et en CoffeeScript : lue jusqu'à son apostrophe fermante, comme `"…"` ci-dessus
    if (dialect && code[i] === "'" && !code.startsWith("'''", i)) {
      const e = scriptStringEnd(code, i, true, opts.lang === 'coffee')
      if (e > i && code.slice(i, e).includes('\n')) {
        result += code.slice(i, e)
        i = e
        continue
      }
    }

    // regex étendue `///…///` de Coffee et de Civet (heregexEnd) : recopiée telle quelle, ses `$x` sont du texte de la regex — lue
    // comme un commentaire `//` jusqu'au bout de sa ligne, la suite passait pour du code (`$y` sortait `$.y`)
    if (dialect && code.startsWith('///', i)) {
      const e = heregexEnd(code, i)
      if (e !== -1) {
        result += code.slice(i, e)
        i = e
        continue
      }
      // qui porte `#{…}` : du texte en Civet, qui le laisse tel quel ; en CoffeeScript, le code de ses interpolations est lu comme dans
      // une chaîne `"…"`
      const f = endOfHeregex(code, i)
      if (f !== -1) {
        result += opts.lang === 'coffee' ? interpolateSigils(code.slice(i, f), '#', opts, code, i) : code.slice(i, f)
        i = f
        continue
      }
    }

    // CoffeeScript : `#` ouvre toujours un commentaire, `#x` compris (ce langage n'a pas de nom privé)
    if (opts.lang === 'coffee' && code[i] === '#' && /[a-zA-Z_]/.test(code[i + 1] ?? '')) {
      const end = lineEndOf(code, i)
      result += code.slice(i, end)
      i = end
      continue
    }

    let m = rest.match(
      /^(###[\s\S]*?###|#(?![a-zA-Z_])[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^\\"\n])*"|'(?:\\.|[^\\'\n])*')/
    )
    if (m) {
      const tok = m[0]
      const c0 = tok[0]
      // Chaînes INTERPOLABLES : le contenu des `#{...}` (Coffee/Civet, dans
      // `"..."` et heredocs `"""..."""`) est du CODE → il faut y tokeniser les
      // sigils `$x`. Sans ça, un `"texte #{$x}"` laisse `$x` littéral →
      // ReferenceError au runtime. Les chaînes simples (`'...'`, `'''...'''`)
      // et les commentaires passent inertes (pas d'interpolation).
      if (c0 === '"') {
        result += interpolateSigils(tok, '#', opts, code, i)
      } else {
        result += tok
      }
      i += tok.length
      continue
    }

    // 3.1a — littéral regex `/…/` : ZONE INERTE au même titre qu'une chaîne — sans ce garde-fou,
    // `x = /§/` levait la garde « § nu » et `re = /µTotal/` sortait réécrit `/µ.Total/` EN PLEIN
    // MILIEU du littéral. Heuristique PARTAGÉE avec le parser (sigils.ts,
    // opensRegex sur le texte déjà émis `result`) : un `/` en position d'EXPRESSION ouvre une
    // regex, en position de VALEUR il divise — `scanRegexLiteral` rend -1 si aucun `/` fermant
    // n'apparaît avant la fin de ligne (une division ne se referme jamais), et ce `/` retombe
    // alors sur les règles suivantes (code normal, division comprise).
    // En CoffeeScript et en Civet (`dialecte`), une regex passée sans parenthèses en est une aussi (`$v.replace /"/g, "#{$n}"`,
    // regexInArgument) : lue comme une division, son guillemet ouvrait une fausse chaîne refermée par celui de l'interpolation,
    // et `#{$n}"` passait pour un commentaire — `$n` sortait tel quel (ReferenceError à l'exécution)
    if (code[i] === '/') {
      let k = result.length
      while (k > 0 && /\s/.test(result[k - 1])) k--
      k = Math.max(0, k - SCOPE_OPENS_REGEX)
      if (k > 0) { pieces.push(result.slice(0, k)); result = result.slice(k) }
      if (opensRegex(result) || (dialect && regexInArgument(code, i))) {
        const end = scanRegexLiteral(code, i)
        if (end !== -1) { result += code.slice(i, end); i = end; continue }
      }
    }

    // 3.1b &$xxx RETIRÉ : le « vault » a fusionné dans le store global `$$`.
    //      Erreur explicite plutôt que laisser `&` + `$x` produire `&$.x`.
    m = rest.match(/^&\$([a-zA-Z0-9_]+)/)
    if (m) throw located(vaultRemovedError(m[1]), code, i, opts)

    // 3.1c &xxx → µ.url.params.xxx : PARAM DE ROUTE, lecture réactive. `µ.url`
    //      est maintenu par le routeur, donc `&id` ≡ `µ.url.params.id` — SANS
    //      injection d'attribut DOM (fini la collision `:id` ↔ attribut natif
    //      `id`/`class`/…). Désambiguïsation robuste au caractère, à la compil :
    //        • param : `&` suivi IMMÉDIATEMENT d'un identifiant ET en position
    //          « préfixe » — le caractère juste AVANT `&` est le début du flux,
    //          un espace, ou un OUVRANT/séparateur `( [ { , = : ; ?`. Jamais
    //          après un opérande : lettre/chiffre/_/guillemet NI un FERMANT
    //          `) ] }` (résultat d'appel/index/bloc) NI un autre `&`.
    //        • ET-binaire `a & b` / `a&b` / `a&&b` : opérande (ou 2ᵉ `&`) avant,
    //          ou espace juste APRÈS le `&` (`& b`) → non-match, `&` laissé tel quel.
    //        • entité HTML `&amp;` (suivie de `;`) / `&#123;` (`#`, pas un ident)
    //          → non-match.
    m = opts.shortcutsFromTree ? null : rest.match(/^&([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (m) {
      const before = i > 0 ? code[i - 1] : ''       // char juste AVANT le '&'
      const after = rest.charAt(m[0].length)         // char juste APRÈS l'identifiant
      const prefixOk = before === '' || /[\s(\[{,=:;?]/.test(before)
      // en CONTEXTE SCRIPT le `;` est un terminateur d'instruction
      // (idiome js/ts), pas un marqueur d'entité : `const p = &id;` ne doit PAS
      // être pris pour une entité. On restreint la garde aux entités NOMMÉES
      // réelles (les numériques `&#123;` ne matchent déjà pas `[a-zA-Z_]`).
      const isEntity = after === ';' && /^(?:amp|lt|gt|quot|apos|nbsp)$/i.test(m[1])
      if (prefixOk && !isEntity) {
        result += `µ.url.params.${m[1]}`
        i += m[0].length
        continue
      }
      // sinon : ET-binaire ou entité → le `&` retombe sur le fallthrough caractère.
    }

    // 3.2-pré µ$$xxx → $xxx : le singleton lu DANS le code d'une interpolation (`"#{µ$$X.y}"`, `` `${µ$$X.y}` ``, une
    //     expression du gabarit). Hors chaîne, la pré-passe 0-bis du transpileur l'a déjà réécrit en `$xxx`, mais elle met
    //     chaque chaîne de côté d'un bloc, interpolations comprises : ce `µ$$X` n'arrivait qu'ici, où le `µ` passait tel
    //     quel et `$$X` tombait sous la garde de la règle 3.2 (refus d'un singleton importé, `µµ.store.X` sinon).
    //     Même verdict que la pré-passe : un nom importé, ou le singleton qu'un module autonome déclare (`singletons`), se
    //     lit `$xxx` ; tout autre nom est refusé, dans un module comme ailleurs — laissé passer, `$Inconnu` levait au
    //     chargement du module
    // `$x = $x`, `$$x = $$x`, `µ$$x = µ$$x` : refusés à leur place, avant toute réécriture (cf. selfWriteAt)
    if (code[i] === '$' || code[i] === 'µ') {
      const write = selfWriteAt(code, i, externalVars, singletons, moduleMode)
      if (write) throw located(write.error, code, write.at, opts)
    }

    m = rest.match(/^µ\$\$([a-zA-Z0-9_]+)/)
    if (m) {
      if (!externalVars.includes(`$${m[1]}`) && !singletons.includes(m[1])) throw located(new Error(t('transpiler.singleton-no-import', { name: m[1] })), code, i, opts)
      result += `$${m[1]}`; i += m[0].length; continue
    }

    // 3.2-bis `$$[…]` : une clé du magasin calculée n'est pas une syntaxe (`$$` se suit d'un nom écrit dans le code) — laissé tel
    //     quel, `$$` seul levait à l'exécution. Refusé à sa ligne, avec ce qu'il faut écrire ; précédé d'un point, c'est la propriété
    //     `$$` d'un objet (`o.$$[0]`), laissée telle quelle comme `obj.$$x` ; précédé d'une lettre, la fin d'un nom (`a$$[0]`)
    if (rest.startsWith('$$[') && !/[\w$]/.test(code[i - 1] ?? '') && (code[i - 1] !== '.' || code[i - 2] === '.')) throw located(storeComputedKeyError(code, i + 3), code, i, opts)

    // 3.2 $$xxx → µ.store.xxx : STORE GLOBAL réactif, zéro import (µ.store =
    //     µ.state({}) au runtime, cf. mjs_store_globals.ts). Aligné avec le generator
    //     (cleanJs émet déjà `µ.store.x`). Le store global se lit `$$X` partout ;
    //     il se déclare via `export µ$$X` (module). Le singleton importé, lui,
    //     se CONSOMME via `µ$$X` (pas `$$X`) — cf. modèle des sigils.
    // 1er caractère restreint à `[a-zA-Z_]` (pas de chiffre en tête) :
    // `$$9lives` produisait `µ.store.9lives` (accès membre illégal → SyntaxError
    // lointaine). Le token non conforme reste littéral (identifiant JS valide).
    // Précédé d'un point, c'est la propriété `$$x` d'un objet (`obj.$$x`), pas le store : laissée telle quelle,
    // comme `obj.$x` (règle 3.8) ; de deux, une plage ou une décomposition (`[1..$$n]`, `[...$$l]`) : le store
    m = rest.match(/^\$\$([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (m && code[i - 1] === '.' && code[i - 2] !== '.') { result += m[0]; i += m[0].length; continue }
    if (m) {
      // Garde : un singleton importé (`@import µ$$X` → `$X` ∈ externalVars) se
      // consomme en `µ$$X`, PAS en `$$X` (qui est le store GLOBAL). Sinon lecture
      // silencieuse du mauvais store → erreur de compilation explicite.
      if (externalVars.includes(`$${m[1]}`)) throw located(importedSingletonError(m[1]), code, i, opts)
      result += `µ.store.${m[1]}`; i += m[0].length; continue
    }

    // 3.3 §§xxx → CONTEXTE réactif de sous-arbre, TOUJOURS (plus aucune
    //     résolution vers un singleton importé — cf. pré-passe 2-bis, même
    //     bascule). Ce fallback n'est qu'un filet défensif si un `§§` de
    //     lecture atteignait quand même le scanner (2-bis couvre déjà la
    //     quasi-totalité des cas réels).
    // Charset uniformisé `[a-zA-Z_]\w*` (comme les pré-passes 2-bis) :
    // avant, ce fallback acceptait un chiffre en tête et divergeait de cleanJs.
    m = rest.match(/^§§([a-zA-Z_]\w*)/)
    if (m) {
      result += `${target}._mjs_getRCtx('${m[1]}')`
      i += m[0].length
      continue
    }

    // 3.3-bis §/§§ NU (non suivi d'un nom) : survécu aux pré-passes 1/2/2-bis (aucune ne
    //         consomme un §/§§ sans identifiant collé derrière) — refus explicite plutôt
    //         qu'un caractère qui atteint Civet tel quel (message cryptique). Corps
    //         PARTAGÉ (sigils.ts), même garde que RE_RAW_ACCESS_MALFORMED (règle 3.5).
    m = rest.match(RE_BARE_SECTION)
    if (m) throw located(bareSectionError(m[0]), code, i, opts)

    // 3.4 @@xxx → _mjsThis.xxx  (pas de chiffre en tête → `@@2fa` reste littéral)
    m = rest.match(/^@@([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (m) { result += `_mjsThis.${m[1]}`; i += m[0].length; continue }

    // 3.5 µread $x / µwrite $x, v → _mjsThis._state.x — accès NON réactif explicite
    //      (remplace l'ancien sigil $__x, RETIRÉ). `µread $x` lit le slot sans
    //      poser de dépendance ; `µwrite $x, v` écrit le slot sans notifier
    //      (la valeur après la virgule suit telle quelle, cf. RAW_WRITE_BODY,
    //      sigils.ts). On consomme la rune + le `$x` d'un bloc AVANT que la
    //      règle 3.8 ne transforme `$x` en `$.x` (proxy tracké).
    // (même piège qu'analyzer.ts
    // autoDeclareFromTemplate) — 1er caractère après `$` restreint à `[a-zA-Z]` :
    // `µread $_secret` (underscore juste après le sigil) ne matchait PAS cette
    // règle. **Vérifié empiriquement** : `µread`/`µwrite` restaient alors des
    // identifiants LITTÉRAUX non définis dans le JS généré (`µread $._secret`,
    // le `$_secret` séparément retombé sur la règle générique du Proxy tracké)
    // → `ReferenceError: µread is not defined` à l'exécution. `_` est un 1er
    // caractère d'identifiant JS valide, aucune raison de l'exclure ici.
    // Depuis, le CORPS du motif vit en source UNIQUE (sigils.ts), consommé
    // aussi par cleanJs — la dérive lexer↔generator est morte par
    // construction.
    // Parenthèses OPTIONNELLES : `µread($x)` d'abord (le corps NU exige un
    // espace puis `$`, il ne peut pas matcher une forme parenthésée — l'ordre n'est
    // donc qu'une convention de lecture), puis la forme nue.
    // Accès MEMBRE (`obj.µread`, `a.µwrite = 1`) : ce n'est PAS la rune, c'est une
    // propriété qui porte ce nom — cleanJs l'exclut depuis toujours par son lookbehind
    // `(?<![\w.])`, le lexer ne le faisait pas. Divergence :
    // `a.µread $x` compilait en `a._mjsThis._state.x`
    // (non-sens, en silence) et, le garde élargi, `obj.µwrite = 1` levait à tort.
    const prevChar = i > 0 ? code[i - 1] : ''
    if (!(prevChar === '.' || /[a-zA-Z0-9_$]/.test(prevChar))) {
      m = rest.match(RE_RAW_ACCESS_PAREN) || rest.match(RE_RAW_ACCESS)
      if (m) {
        // Statisation $$ : `µread $$x` → accès BRUT au store (m[1] = '$'),
        // `µread $x` → slot local inchangé.
        result += (m[1] ? RAW_ACCESS_STORE_OUT : RAW_ACCESS_OUT) + m[2]
        i += m[0].length
        continue
      }

      // µwrite $x, v / µwrite($x, v) — le corps s'arrête à la virgule, `v` continue
      // tel quel dans le flux (sigils.ts, RAW_WRITE_BODY). Forme parenthésée : une
      // parenthèse ouvrante FRAÎCHE remplace `µwrite(`, la fermante d'origine (jamais
      // consommée ici) referme celle-là.
      m = rest.match(RE_RAW_WRITE_PAREN)
      if (m) {
        result += RAW_WRITE_PAREN_OUT_OPEN + (m[1] ? RAW_WRITE_STORE_OUT : RAW_WRITE_OUT) + m[2] + ' = '
        i += m[0].length
        continue
      }
      m = rest.match(RE_RAW_WRITE)
      if (m) {
        result += (m[1] ? RAW_WRITE_STORE_OUT : RAW_WRITE_OUT) + m[2] + ' = '
        i += m[0].length
        continue
      }

      // Ancienne forme `µwrite $x = v` / `µwrite($x) = v` (RETIRÉE) :
      // message dédié plutôt que la garde générique plus bas.
      if (RE_RAW_WRITE_OLD_SHAPE_PAREN.test(rest) || RE_RAW_WRITE_OLD_SHAPE.test(rest)) throw located(rawWriteOldShapeError(), code, i, opts)

      // …et ce qui reste est une faute de forme : refus BRUYANT plutôt qu'un
      // identifiant littéral qui casse au navigateur avec un build vert.
      if (RE_RAW_ACCESS_MALFORMED.test(rest)) throw located(rawAccessShapeError(), code, i, opts)

      // µrefresh($x) / µrefresh $x → µ._mjs_refresh(_mjsThis, 'x'), µrefresh($$x) → µ._mjs_storeRefresh("x") (sigils.ts) ; toute
      // autre forme refusée, et un singleton importé écrit `$$X`, comme dans `$$X = $$X` (règle 3.2)
      m = rest.match(RE_MU_REFRESH_PAREN) || rest.match(RE_MU_REFRESH)
      // hors d'un composant (`<script module>`, module importé — fichier d'un magasin compris) : ni `_mjsThis` ni variable de composant,
      // seule une clé du magasin s'y signale ; `µrefresh($x)`, `µrefresh(µ$$x)` (lu `$x`) et toute autre forme, refusés par le message
      // de ce lieu — la forme nue d'une clé suivie d'une expression garde le sien (les parenthèses)
      if (moduleMode && RE_MU_REFRESH_REST.test(rest) && !m?.[1] && !rest.match(RE_MU_REFRESH_BARE)?.[1]) throw located(refreshOutsideComponentError(opts.moduleFile === true), code, i, opts)
      if (m) {
        if (m[1] && externalVars.includes(`$${m[2]}`)) throw located(importedSingletonError(m[2]), code, i, opts)
        result += m[1] ? MU_REFRESH_STORE_OUT(m[2]) : MU_REFRESH_OUT(m[2])
        i += m[0].length
        continue
      }
      // la forme nue suivie d'un opérateur ou d'une autre expression : les parenthèses
      m = rest.match(RE_MU_REFRESH_BARE)
      if (m) throw located(refreshBareError(m[1] + m[2]), code, i, opts)
      if (RE_MU_REFRESH_REST.test(rest)) throw located(refreshShapeError(), code, i, opts)
    }

    // 3.6-pré Garde-fou hooks : l'ancienne forme `@mount ->` (appel de la
    //      méthode d'enregistrement, retirée du runtime) casserait en silence
    //      → erreur de compilation explicite orientant vers la rune µ. Les
    //      noms restent LIBRES pour de vraies méthodes (`@mount = ->`, appels
    //      `@mount(x)`) : seule la silhouette hook est bloquée.
    m = rest.match(RE_OLD_HOOK)
    if (m) {
      throw located(new Error(t('lexer.hook-at-sign-removed', { hook: m[1] })), code, i, opts)
    }

    // 3.6 @xxx → this.xxx  (pas de chiffre en tête → `@2fa` reste littéral)
    m = rest.match(/^@([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (m) { result += `this.${m[1]}`; i += m[0].length; continue }

    // 3.7 Snapshot — désactiver la dérivation : $xxx =: expr → $.xxx = µ.snap expr
    // Note : on n'utilise PAS `:=` (qui est réservé `const` côté Civet) pour
    // éviter toute collision avec le langage source. La syntaxe MJS est `=:`.
    // Pas de chiffre en tête (aligné sur les autres sigils).
    m = opts.shortcutsFromTree ? null : rest.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*=:[ \t]*/)
    if (m) {
      const varName = `$${m[1]}`
      const prefix = (moduleMode || externalVars.includes(varName)) ? varName : `$.${m[1]}`
      result += `${prefix} = µ.snap `
      i += m[0].length
      continue
    }

    // 3.8-pré Garde-fou `$xxx := expr` : `:=` est l'opérateur de DÉCLARATION
    //      Civet (cf. note 3.7 ci-dessus — même collision, jamais utilisée côté
    //      MJS pour cette raison). Un `$xxx` bare, une fois réécrit `$.xxx` par
    //      la règle 3.8 juste en dessous, donnerait `$.xxx := expr` — Civet ne
    //      s'y oppose PAS (compile tel quel en `const $.xxx = expr`, cible
    //      non-identifiant d'un `const` : JS invalide) : le vrai crash n'arrivait
    //      QU'ENSUITE, loin de la vraie faute, au parse acorn de l'Analyzer MJS
    //      (« [analyzer] parse error: Unexpected token », découvert par test réel).
    //      On intercepte ICI, avant que la réécriture `$.xxx` ne
    //      rende le motif méconnaissable en aval. Même garde que 3.8 pour savoir
    //      si CE `$xxx` serait réellement réécrit : en moduleMode/externalVars,
    //      `$xxx` reste un identifiant Civet ordinaire (`$xxx := expr` y compile
    //      en `const $xxx = expr`, JS parfaitement valide) — aucun risque, on
    //      laisse filer sans throw (retombe sur 3.8 juste en dessous).
    m = rest.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*:=/)
    if (m) {
      const varName = `$${m[1]}`
      if (!(moduleMode || externalVars.includes(varName))) {
        let preview = rest.slice(m[0].length).match(/^[ \t]*([^\n;]*)/)?.[1]?.trim() || '...'
        // une fermante que l'expression n'ouvre pas (`[$x := 2]`, la liste qui l'entoure) n'est pas de la valeur
        while (/[\])}]$/.test(preview) && (preview.match(/[[({]/g)?.length ?? 0) < (preview.match(/[\])}]/g)?.length ?? 0)) preview = preview.slice(0, -1).trimEnd()
        throw located(new Error(t('lexer.symbol-declared-civet', { varName, preview })), code, i, opts)
      }
    }

    // 3.8 $xxx → $.xxx (sauf moduleMode ou externalVars). Un `$xxx` ∈ externalVars
    //     est un singleton importé : on garde `$xxx` (sa forme compilée). La FAUTE
    //     de le consommer en `$xxx` (au lieu de `µ$$xxx`) est détectée par le lint
    //     singleton sur le SOURCE du dev (pas ici : le lexer tourne aussi sur du
    //     code déjà routé `µ$$`→`$xxx`).
    // 1er caractère `[a-zA-Z_]` (pas de chiffre) — `$9` reste littéral.
    // Précédé d'un point, c'est une propriété (`obj.$x`, `evt.$el`) : laissée telle quelle, comme dans le
    // gabarit (cleanJs) ; de deux, une plage ou une décomposition (`[1..$n]`, `[...$items]`) : la variable
    m = opts.shortcutsFromTree || (code[i - 1] === '.' && code[i - 2] !== '.') ? null : rest.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (m) {
      const varName = `$${m[1]}`
      result += (moduleMode || externalVars.includes(varName)) ? varName : `$.${m[1]}`
      i += m[0].length
      continue
    }

    // 3.8b µXxx (PascalCase) → µ.Xxx : accès namespacé aux classes/objets du
    //      framework sans le point (µRouter → µ.Router, µStore → µ.Store,
    //      µElement → µ.Element). Symétrique du sucre `µinspect`. Ne matche QUE
    //      si une MAJUSCULE suit `µ` : les runes minuscules (µeffect, µeasing…)
    //      et la forme déjà pointée (`µ.Router` : après `µ` vient `.`) ne sont
    //      pas touchées.
    m = rest.match(RE_MU_PASCAL)
    if (m) { result += `µ.${m[1]}`; i += m[0].length; continue }

    // 3.8c-pré Hooks de cycle de vie : µmount/µawake/µsleep/µdestroy/
    //      µurlChange/µfailed + callback → enregistrement via l'API interne
    //      unique. `µmount ->` devient `_mjsThis._mjs_hook 'mount', ->` (appel
    //      implicite Coffee — la sortie du lexer repasse par Civet). DOIT
    //      précéder 3.8c : `µurlChange` contient `µurl` (le lookahead de
    //      MU_SHORT_BODY protège déjà, l'ordre rend l'intention lisible).
    //      Receveur `cible`, comme `§` : `this` valait l'état dans une fonction rangée dans l'état
    //      (`$armer = -> µdestroy -> …`, appelée `$armer()`), le crochet n'était rangé nulle part
    // `µfailed` mal écrit (MU_FAILED_MALFORMED) : ni le crochet ni la lecture d'une erreur, refusé avec la forme juste
    // marqué de sa forme écrite : lu sans fichier (expression du gabarit), sa ligne est cherchée par le transpileur (locateBadFailed)
    if (RE_FAILED_MALFORMED.test(rest)) throw located(Object.assign(new Error(t('lexer.failed-misspelled', { written: failedWritten(rest) })), { failedMalformed: failedWritten(rest) }), code, i, opts)
    m = rest.match(RE_MU_HOOKS)
    if (m) { result += `${target}._mjs_hook '${m[1]}',`; i += m[0].length; continue }

    // 3.8c-bis Crochet mal écrit dans la silhouette d'un crochet (flèche directe, ou (args) puis flèche) :
    //      `µmounted ->` (déjà `µ.mounted ->` après le sucre µfoo → µ.foo du transpileur) se construisait, puis
    //      levait à l'exécution (« µ.mounted is not a function »). Seuls les noms proches d'un des six
    //      crochets sont refusés (nearestHook) ; le message propose le plus proche
    if (code[i] === 'µ' && !(prevChar === '.' || /[a-zA-Z0-9_$]/.test(prevChar))) {
      m = rest.match(RE_HOOK_SHAPE)
      const near = m && nearestHook(m[1])
      if (near) throw located(new Error(t('lexer.bracket-unknown', { name: m![1], nearest: near })), code, i, opts)
    }

    // 3.8c µxxx (minuscules, allowlist) → µ.xxx : GLOBALES du framework en
    //      forme courte — µurl (URL réactive maintenue par le routeur),
    //      µonline/µvisible/µready (environnement, mjs_store_globals),
    //      µserver (contexte SSR/client, valeur simple NON réactive — seule
    //      nuance avec le trio précédent, cf. mjs_store_globals.ts), et les
    //      fabriques temps réel µsocket(url)/µsmooth(src) (mjs_socket, mjs_smooth).
    //      Allowlist STRICTE (définie dans sigils.ts, partagée avec cleanJs) :
    //      les runes minuscules à compilation dédiée (µeffect, µspring,
    //      µeasing…) et tout autre identifiant restent intacts ; la forme
    //      pointée (`µ.url`) ne matche pas (`.` après `µ`).
    m = rest.match(RE_MU_SHORT)
    if (m) { result += `µ.${m[1]}`; i += m[0].length; continue }

    // 3.8d µlang → µ.store.__mjsLang : langue courante (clé store INTERNE
    //      cachée, cf. sigils.ts) — lecture/écriture héritent ensuite de
    //      toute la plomberie $$ existante (analyzer, réactivité, µ._storeSet).
    m = rest.match(RE_MU_LANG)
    if (m) { result += MU_LANG_OUT; i += m[0].length; continue }

    // 3.8e µtheme → µ.store.__mjsTheme : thème courant, CALQUE EXACT de 3.8d.
    m = rest.match(RE_MU_THEME)
    if (m) { result += MU_THEME_OUT; i += m[0].length; continue }

    // 3.8f µlayout → le modèle choisi (la prop `layout`, « default » sans rien) : lu seulement, et
    //      seulement par une instance — un module (partagé, ou importé) n'a pas de modèle
    m = rest.match(RE_MU_LAYOUT)
    if (m) {
      if (moduleMode) throw located(new Error(t('lexer.mu-layout-module')), code, i, opts)
      if (RE_MU_LAYOUT_WRITE.test(rest) || /(?:\+\+|--[ \t]*)$/.test(result)) throw located(new Error(t('lexer.mu-layout-written')), code, i, opts)
      result += MU_LAYOUT_OUT
      i += m[0].length
      continue
    }

    // 3.9 Identifier classique (préservé tel quel)
    m = rest.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)
    if (m) { result += m[0]; i += m[0].length; continue }

    // 3.10 Tout autre caractère
    result += code[i]
    i += 1
  }

  return pieces.join('') + result
}
