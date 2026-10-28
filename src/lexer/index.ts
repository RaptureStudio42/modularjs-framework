// lexer — port de la V1 Ruby, lexer_coffee.rb
//
// Tokenise le sucre ModularJS dans une source post-langage (CoffeeScript pré-compile,
// ou JS issu de Civet/TS/JS direct). Port à l'identique (output strictement
// égal à V1). Une prochaine étape ajoutera l'émission `__mjs_get/__mjs_set` à la place de `$.x`.
//
// externalVars : noms `$foo` à préserver tels quels (imports cross-module)
// moduleMode   : si true, tous les `$foo` restent littéraux (modules .coffee externes)

import { RAW_ACCESS_BODY, RAW_ACCESS_PAREN_BODY, RAW_ACCESS_MALFORME_BODY, rawAccessFormeError, RAW_WRITE_BODY, RAW_WRITE_PAREN_BODY, RAW_WRITE_PAREN_OUT_OPEN, RAW_WRITE_OLD_FORME_BODY, RAW_WRITE_OLD_FORME_PAREN_BODY, rawWriteAncienneFormeError, BARE_SECTION_BODY, bareSectionError, RAW_ACCESS_OUT, RAW_ACCESS_STORE_OUT, RAW_WRITE_OUT, RAW_WRITE_STORE_OUT, MU_PASCAL_BODY, MU_SHORT_BODY, MU_LANG_BODY, MU_LANG_OUT, MU_THEME_BODY, MU_THEME_OUT, MU_LAYOUT_BODY, MU_LAYOUT_OUT, MU_LAYOUT_WRITE_BODY, MU_HOOKS, MU_HOOKS_BODY, MU_DERIVED_BODY, rewriteMuToggle, vaultRemovedError, importedSingletonError, ouvreUneRegex, scanRegexLiteral, PORTEE_OUVRE_UNE_REGEX } from '../sigils.js'
import { t } from '../messages/index.js'
import { skipQuotedSpan } from '../quoted-span.js'

// regex ancrées du scanner — bâties UNE fois sur les corps partagés (sigils.ts,
// source unique lexer↔cleanJs) ; l'ancre `^` reste locale à ce moteur
const RE_RAW_ACCESS = new RegExp(`^${RAW_ACCESS_BODY}`)
const RE_RAW_ACCESS_PAREN = new RegExp(`^${RAW_ACCESS_PAREN_BODY}`)
const RE_RAW_ACCESS_MALFORME = new RegExp(`^${RAW_ACCESS_MALFORME_BODY}`)
const RE_RAW_WRITE = new RegExp(`^${RAW_WRITE_BODY}`)
const RE_RAW_WRITE_PAREN = new RegExp(`^${RAW_WRITE_PAREN_BODY}`)
const RE_RAW_WRITE_OLD_FORME = new RegExp(`^${RAW_WRITE_OLD_FORME_BODY}`)
const RE_RAW_WRITE_OLD_FORME_PAREN = new RegExp(`^${RAW_WRITE_OLD_FORME_PAREN_BODY}`)
const RE_BARE_SECTION = new RegExp(`^${BARE_SECTION_BODY}`)
const RE_MU_PASCAL  = new RegExp(`^${MU_PASCAL_BODY}`)
const RE_MU_SHORT   = new RegExp(`^${MU_SHORT_BODY}`)
const RE_MU_LANG    = new RegExp(`^${MU_LANG_BODY}`)
const RE_MU_THEME   = new RegExp(`^${MU_THEME_BODY}`)
const RE_MU_LAYOUT  = new RegExp(`^${MU_LAYOUT_BODY}`)
const RE_MU_LAYOUT_WRITE = new RegExp(`^${MU_LAYOUT_WRITE_BODY}`)
const RE_MU_HOOKS   = new RegExp(`^${MU_HOOKS_BODY}`)

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
}

// situe — préfixe `<fichier>:<ligne>:<colonne>` d'une erreur du lexeur, même forme que celles de Civet ; `pos` est
// l'offset de la faute dans `texte`, dont les lignes sont celles de la source (les pré-passes n'en ajoutent ni
// n'en retirent)
function situe(err: Error, texte: string, pos: number, opts: TokenizeOpts): Error {
  if (!opts.fileName) return err
  const { firstLine, firstColumn } = situeDans(opts, texte, pos)
  return new Error(`${opts.fileName}:${firstLine}:${firstColumn} ${err.message}`, { cause: err })
}

// options d'un texte qui commence à l'offset `pos` de `texte` (contenu d'une interpolation) : sa ligne et sa colonne
// dans le fichier, pour que ses erreurs citent la place de la faute et non `1:1`
function situeDans(opts: TokenizeOpts, texte: string, pos: number): TokenizeOpts {
  const avant = texte.slice(0, pos)
  const sauts = avant.match(/\n/g)?.length ?? 0
  return { ...opts, firstLine: (opts.firstLine ?? 1) + sauts, firstColumn: sauts > 0 ? pos - avant.lastIndexOf('\n') : (opts.firstColumn ?? 1) + pos }
}

// crochet mal écrit (`µmounted ->`, `µonDestroy ->`, `µdestory ->`) : le crochet de cycle de vie dont le nom est
// contenu dans `nom`, en est le début (4 lettres au moins) ou n'en diffère que d'une faute ; `null` sinon — toute
// autre rune ou fonction µ passe
const CROCHETS = MU_HOOKS.split('|')

function crochetProche(nom: string): string | null {
  if (CROCHETS.includes(nom)) return null
  const bas = nom.toLowerCase()
  for (const crochet of CROCHETS) {
    const c = crochet.toLowerCase()
    if (bas.includes(c) || (bas.length >= 4 && c.startsWith(bas)) || uneFaute(bas, c)) return crochet
  }
  return null
}

// vrai si `a` et `b` diffèrent d'une seule faute : une lettre en trop, en moins ou changée, deux voisines inversées
function uneFaute(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i)
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1)
  return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
}

const RE_CROCHET_SILHOUETTE = /^µ\.?([a-zA-Z_][a-zA-Z0-9_]*)(?=[ \t]*(?:->|=>|\([^)\n]*\)[ \t]*(?:->|=>)))/

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

// scanInertAt — un littéral/commentaire commence-t-il en `i` ? rend l'offset de FIN
// (exclu), ou -1 (rien ici, ou littéral non terminé)
function scanInertAt(src: string, i: number): number {
  const c = src[i]
  if (c === '#') {
    if (src.startsWith('###', i)) { const e = src.indexOf('###', i + 3); return e < 0 ? -1 : e + 3 }
    if (IDENT_START_RE.test(src[i + 1] ?? '')) return -1   //`#nom` = symbole, pas un commentaire
    const e = src.indexOf('\n', i)
    return e < 0 ? src.length : e
  }
  if (c === '/') {
    if (src[i + 1] === '/') { const e = src.indexOf('\n', i); return e < 0 ? src.length : e }
    if (src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); return e < 0 ? -1 : e + 2 }
    // littéral regex `/…/` : ZONE INERTE au même titre qu'une chaîne. Sans ce
    // garde-fou, un `§`/`§§` À L'INTÉRIEUR d'un regex (`/§theme/`) survivait à CE masquage et se
    // faisait manger par les pré-passes §/§§ juste en dessous (AVANT même que la règle 3.1a du
    // scanner, plus bas dans ce fichier, ne voie le littéral en entier). Même heuristique
    // PARTAGÉE (sigils.ts) que la règle 3.1a et le parser.
    if (ouvreUneRegex(src.slice(0, i))) return scanRegexLiteral(src, i)
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
    // distinguer regex/division (ouvreUneRegex, cf. scanInertAt ci-dessus et sigils.ts) : lui
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
  let ligne: string | null = null
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
      if (ligne === null) { const fin = src.indexOf('\n', j); ligne = fin < 0 ? src : src.slice(0, fin) }
      const e = scanInterpAt(ligne, j + 2)
      if (e > 0) { j = e; continue }
    }
    j++
  }
  return -1
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
// les single-quotes) ; scan contexte-aware : commentaires, chaînes simples, gabarits natifs et heredocs `'''` intacts
export function convertCoffeeInterpolations(src: string): string {
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
      res += body.includes('#{') ? toTemplateLiteral(body) : src.slice(i, e + 3)
      i = e + 3; continue
    }
    if (ch === '"') {
      // une interpolation `#{…}` peut porter ses propres guillemets (scanDoubleQuoteAt) ; sinon, lecture d'avant
      let j = scanDoubleQuoteAt(src, i) - 1
      if (j < 0) {
        j = i + 1
        while (j < n && src[j] !== '"' && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
        if (j >= n || src[j] === '\n') { res += src.slice(i, j); i = j; continue }
      }
      const body = src.slice(i + 1, j)
      res += body.includes('#{') ? toTemplateLiteral(body) : src.slice(i, j + 1)
      i = j + 1; continue
    }
    res += ch; i++
  }
  return res
}

// inertRanges — toutes les plages inertes de `src`, dans l'ordre, sans recouvrement
function inertRanges(src: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#' || c === '/' || c === '"' || c === "'" || c === '`') {
      const e = scanInertAt(src, i)
      if (e > i) { out.push([i, e]); i = e; continue }
    }
    i++
  }
  return out
}

// replaceInert — réécrit chaque plage inerte par `fn(texte)`, laisse le reste intact
function replaceInert(src: string, fn: (tok: string) => string): string {
  const ranges = inertRanges(src)
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

function maskInert(src: string): { masked: string; slots: string[] } {
  const slots: string[] = []
  const masked = replaceInert(src, (tok) => NUL + (slots.push(tok) - 1) + NUL)
  return { masked, slots }
}

function unmaskInert(src: string, slots: string[]): string {
  return slots.length === 0 ? src : src.replace(UNMASK_RE, (_m, id) => slots[+id])
}

// finValeurContexte — fin de la valeur d'un setter de contexte (`§x = v`, `§§x = v`), lue sur une vue
// MASQUÉE (chaînes et commentaires neutralisés) : un `if`/`unless` postfixe, ou le `then`/`else` d'un `if`
// qui englobe le setter, n'appartiennent pas à la valeur — avalés dans l'appel émis, ils donnaient un code
// que Civet refuse (`this._mjs_setContext('theme', 'dark' if $.sombre)`). Un `if … then … else …` écrit
// COMME valeur, un mot entre parenthèses, une propriété (`p.then`) et tout ce qui suit une flèche (corps de
// fonction) restent dans la valeur. `brut` (même longueur que `masque`) dit si une valeur précède le
// mot-clé : dans une vue masquée à longueur égale, une chaîne n'est plus que des blancs. Rend l'index du
// mot-clé qui termine la valeur, ou la longueur de `masque`
const MOTS_AVANT_VALEUR = new Set([ 'if', 'unless', 'then', 'else', 'and', 'or', 'not', 'is', 'isnt', 'in', 'of', 'instanceof', 'return', 'typeof', 'new', 'await', 'yield', 'void', 'delete' ])

export function finValeurContexte(masque: string, brut: string = masque): number {
  let profondeur = 0
  let si = 0
  for (const m of masque.matchAll(/[A-Za-z_$][\w$]*|->|=>|[()[\]{}]/g)) {
    const mot = m[0]
    const pos = m.index!
    if (mot === '(' || mot === '[' || mot === '{') { profondeur++; continue }
    if (mot === ')' || mot === ']' || mot === '}') { profondeur--; continue }
    if (profondeur !== 0 || masque[pos - 1] === '.' || masque[pos - 1] === '@') continue
    if (mot === '->' || mot === '=>') return masque.length
    if (mot === 'if' || mot === 'unless') {
      if (apresUneValeur(brut, pos)) return pos
      si++
    }
    else if (mot === 'then') {
      if (si === 0) return pos
    }
    else if (mot === 'else') {
      if (si === 0) return pos
      si--
    }
  }
  return masque.length
}

// vrai si une valeur se termine juste avant `pos` (mot, nombre, chaîne, fermante, chaîne masquée en
// emplacement `\0n\0`) : le `if`/`unless` qui suit est alors postfixe
function apresUneValeur(brut: string, pos: number): boolean {
  const avant = brut.slice(0, pos).trimEnd()
  const mot   = avant.match(/[A-Za-z_$][\w$]*$/)
  if (mot) return !MOTS_AVANT_VALEUR.has(mot[0])
  return /[\w$'"`)\]}\u0000]$/.test(avant)
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
// la vue masquée puis relire le texte réel via `m.indices`, cf. transpiler/sections.ts).
export function maskInertSameLength(src: string): string {
  return replaceInert(src, (tok) => tok.replace(/[^\n]/g, ' '))
}

// interpolateSigils — dans une chaîne, tokenise le contenu des interpolations
// `<marker>{ ... }` (`#{...}` pour Coffee/Civet, `${...}` pour les template
// literals). Les parties littérales restent intactes ; seul le code des
// interpolations passe par `tokenize` (récursif). Gère les `{}` imbriqués.
// `texte` / `origine` : le texte où `str` commence, à cet offset — de quoi situer une erreur levée dans une interpolation
function interpolateSigils(str: string, marker: string, opts: TokenizeOpts, texte: string, origine: number): string {
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
      out += marker + '{' + tokenize(inner, opts.fileName ? situeDans(opts, texte, origine + j + 2) : opts) + '}'
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
function lectureContexte(cible: string, lecture: string, nom: string): string {
  const lu = `${cible}.${lecture}('${nom}')`
  if (lecture !== '_mjs_getRCtx') return lu
  return `((_c) => _c && typeof _c === 'object' && Object.keys(_c).join() === 'value' ? _c.value : _c)(${lu})`
}

// écriture d'un contexte `§x = v` → `<cible>.<appel>('x', v)`, commune au <script> et aux gestionnaires du gabarit
// (generator/utils.ts). Affectation composée, comme sur une variable : `§x += v` vaut `§x = §x + (v)` (de même -= *= /=
// %= **= |= &= ^= <<= >>= >>>=), `§x ||= v` vaut `§x || (§x = v)` (de même &&= ??=), l'écriture n'a lieu que si
// l'opérateur la demande
export function ecritureContexte(cible: string, appel: string, lecture: string, nom: string, op: string | undefined, valeur: string): string {
  const lu = lectureContexte(cible, lecture, nom)
  if (op === '||' || op === '&&' || op === '??') return `${lu} ${op} ${cible}.${appel}('${nom}', ${valeur})`
  return `${cible}.${appel}('${nom}', ${op ? `${lu} ${op} (${valeur})` : valeur})`
}

// setters `§x = v` / `§§x = v` du <script> (vue masquée) → ecritureContexte ; une valeur coupée
// (finValeurContexte) laisse la suite à relire : le passage se répète tant qu'il a coupé quelque chose
function rewriteSetter(code: string, re: RegExp, appel: string, lecture: string, cible: string, slots: string[]): string {
  let coupe = true
  while (coupe) {
    coupe = false
    code = code.replace(re, (_m, name, op, expr) => {
      const fin  = finValeurContexte(expr)
      const tete = fin < expr.length ? expr.slice(0, fin).trimEnd() : expr
      if (fin < expr.length) coupe = true
      const { code: realExpr, tail } = splitTrailingMaskedComment(tete, slots)
      return `${ecritureContexte(cible, appel, lecture, name, op, realExpr)}${tail}${expr.slice(tete.length)}`
    })
  }
  return code
}

// incrément et décrément d'un contexte, comme sur une variable : `§x++` et `++§x` valent `§x += 1`, `§x--` et `--§x`
// valent `§x -= 1` (de même `§§x`) — laissés au getter, ils donnaient `this._mjs_getContext('x')++`, que Civet refusait.
// Commun au <script> et aux gestionnaires du gabarit (generator/utils.ts)
export function incrementContexteRe(marque: string): RegExp {
  return new RegExp(`(?<![\\w.§])${marque}([a-zA-Z_]\\w*)(\\+\\+|--)|(\\+\\+|--)${marque}([a-zA-Z_]\\w*)`, 'g')
}

export function rewriteIncrement(code: string, marque: string, appel: string, lecture: string, cible: string): string {
  return code.replace(incrementContexteRe(marque), (_m, nomApres, opApres, opAvant, nomAvant) => {
    const nom = nomApres ?? nomAvant
    const op  = (opApres ?? opAvant) === '++' ? '+' : '-'
    return `${cible}.${appel}('${nom}', ${lectureContexte(cible, lecture, nom)} ${op} 1)`
  })
}

export function tokenize(codeRaw: string, opts: TokenizeOpts = {}): string {
  const externalVars = opts.externalVars ?? []
  const moduleMode   = opts.moduleMode ?? false
  const singletons   = opts.singletons ?? []
  // receveur des contextes § / §§ : le composant dont le script les porte (`_mjsThis`, capturé à l'init), quel que
  // soit l'appelant — `this` valait l'état dans une fonction rangée dans l'état (`$go = -> §x = 1`, appelée `$go()`).
  // Un module n'a pas de composant : `this` y reste
  const cible = moduleMode ? 'this' : '_mjsThis'

  let code = codeRaw

  // 0. µtoggle($x, 'a', 'b') → `$x = (…)` — PRÉ-PASSE de tête, AVANT le masquage :
  // les valeurs du cycle SONT des chaînes littérales, un masquage fait ici les
  // rendrait invisibles (rewriteMuToggle masque elle-même).
  // Corps PARTAGÉ avec cleanJs (sigils.ts) ; la cible `$x`/`$$x` ressort VERBATIM,
  // c'est le scanner ci-dessous qui pose le setter réactif — comme µderived.
  code = rewriteMuToggle(code, '<script>')

  // on MASQUE chaînes/heredocs/commentaires le temps des 4 pré-passes
  // § / §§ ci-dessous (replace globaux aveugles au contexte), puis on restaure.
  const inert = maskInert(code)
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
  // (finValeurContexte) ; la suite se relit alors, elle peut porter un autre setter (`else §x = 2`).
  // Une affectation composée (`§total += 1`) passe par le setter avec son opérateur : laissée au getter, elle
  // donnait `this._mjs_getContext('total') += 1`, que Civet refusait sur un message obscur.
  // `§x++`, `--§x` : réécrits d'abord, sur le contexte (`§§x++` plus bas, avec les contextes réactifs)
  code = rewriteIncrement(code, '§', '_mjs_setContext', '_mjs_getContext', cible)
  code = rewriteSetter(code, /(?<![\w.§])§([a-zA-Z_]\w*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)\s*(.+?)(?=\n|;|$)/g, '_mjs_setContext', '_mjs_getContext', cible, inert.slots)

  // 2. getContext : `§foo` → `_mjsThis._mjs_getContext('foo')`
  code = code.replace(
    /(?<![\w.§])§([a-zA-Z_]\w*)/g,
    (_m, name) => `${cible}._mjs_getContext('${name}')`
  )

  // 2-bis. §§ CONTEXTE RÉACTIF de sous-arbre — TOUJOURS (plus aucune résolution
  //   vers un singleton importé : celui-ci se consomme désormais en `µ$$x`,
  //   jamais en `§§x` — cf. lintSingletonConsume). Setter `§§foo = expr` →
  //   `_mjsThis._mjs_setRCtx('foo', expr)` (déclaration sur l'ancêtre) ; getter
  //   `§§foo` → `_mjsThis._mjs_getRCtx('foo')` (remonte l'arbre + abonne).
  //   Ces `§§` échappent aux règles § (1/2) : leur lookbehind exclut un `§` devant.
  // Même correctif que la règle 1 ci-dessus (commentaire de fin de ligne isolé
  // AVANT la `)`, jamais capturé DANS l'expression).
  code = rewriteIncrement(code, '§§', '_mjs_setRCtx', '_mjs_getRCtx', cible)
  code = rewriteSetter(code, /(?<![\w.§])§§([a-zA-Z_]\w*)\s*(\*\*|\|\||&&|\?\?|>>>|<<|>>|[-+*/%|&^])?=(?!=|>)\s*(.+?)(?=\n|;|$)/g, '_mjs_setRCtx', '_mjs_getRCtx', cible, inert.slots)
  code = code.replace(
    /(?<![\w.§])§§([a-zA-Z_]\w*)/g,
    (_m, name) => `${cible}._mjs_getRCtx('${name}')`
  )

  // 2-ter. µderived $var = expr, $a, $b, … → dérivé à DÉPENDANCES FORCÉES. Réduit à
  // `$var = µ._mjs_forceDeps(expr, $a, $b, …)` — marqueur reconnu et EFFACÉ par
  // l'analyzer pour un JS final sans artefact. `expr` et les `$a`/`$b` restent
  // verbatim : le scanner du dessous les convertira normalement.
  code = code.replace(RE_MU_DERIVED_STMT, (_m, varName, tail, offset: number, texte: string) => {
    // une faute se situe sur le texte démasqué : un littéral sur plusieurs lignes n'y est plus qu'un jeton
    const avant    = unmaskInert(texte.slice(0, offset), inert.slots)
    const refus    = (err: Error): Error => situe(err, avant, avant.length, opts)
    const segments = splitTopLevelCommas(tail).map((s) => s.trim())
    const realExpr = segments[0] ?? ''
    if (!realExpr) throw refus(new Error(t('lexer.derived-expr-vide', { varName })))
    // `realExpr` sort de la vue MASQUÉE (maskInert, tout en haut de
    // tokenize) : un `await` DANS une chaîne/un commentaire a déjà été remplacé par un jeton
    // NUL, il ne peut plus matcher ici — seul un VRAI mot-clé await déclenche ce refus.
    if (/\bawait\b/.test(realExpr)) throw refus(new Error(t('transpiler.derived-await-interdit', { varName })))
    const forcedDeps = segments.slice(1)
    for (const dep of forcedDeps) {
      if (!/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(dep)) {
        throw refus(new Error(t('lexer.derived-dep-invalide', { varName, dep })))
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
  // `morceaux` et `result` n'en garde que la queue que lit ouvreUneRegex (blancs de fin + PORTEE_OUVRE_UNE_REGEX
  // caractères : la parenthèse d'une condition `if (…)` se cherche jusque-là).
  // Relire une sortie de toute la taille du script à chaque `/` l'aplatissait : coût quadratique
  const morceaux: string[] = []
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
    if (code[i] === '"' && !code.startsWith('"""', i)) {
      const e = scanDoubleQuoteAt(code, i)
      if (e !== -1) {
        result += interpolateSigils(code.slice(i, e), '#', opts, code, i)
        i = e
        continue
      }
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
    // ouvreUneRegex sur le texte déjà émis `result`) : un `/` en position d'EXPRESSION ouvre une
    // regex, en position de VALEUR il divise — `scanRegexLiteral` rend -1 si aucun `/` fermant
    // n'apparaît avant la fin de ligne (une division ne se referme jamais), et ce `/` retombe
    // alors sur les règles suivantes (code normal, division comprise).
    if (code[i] === '/') {
      let k = result.length
      while (k > 0 && /\s/.test(result[k - 1])) k--
      k = Math.max(0, k - PORTEE_OUVRE_UNE_REGEX)
      if (k > 0) { morceaux.push(result.slice(0, k)); result = result.slice(k) }
      if (ouvreUneRegex(result)) {
        const fin = scanRegexLiteral(code, i)
        if (fin !== -1) { result += code.slice(i, fin); i = fin; continue }
      }
    }

    // 3.1b &$xxx RETIRÉ : le « vault » a fusionné dans le store global `$$`.
    //      Erreur explicite plutôt que laisser `&` + `$x` produire `&$.x`.
    m = rest.match(/^&\$([a-zA-Z0-9_]+)/)
    if (m) throw situe(vaultRemovedError(m[1]), code, i, opts)

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
    m = rest.match(/^&([a-zA-Z_][a-zA-Z0-9_]*)/)
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
    m = rest.match(/^µ\$\$([a-zA-Z0-9_]+)/)
    if (m) {
      if (!externalVars.includes(`$${m[1]}`) && !singletons.includes(m[1])) throw situe(new Error(t('transpiler.singleton-sans-import', { nom: m[1] })), code, i, opts)
      result += `$${m[1]}`; i += m[0].length; continue
    }

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
      if (externalVars.includes(`$${m[1]}`)) throw situe(importedSingletonError(m[1]), code, i, opts)
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
      result += `${cible}._mjs_getRCtx('${m[1]}')`
      i += m[0].length
      continue
    }

    // 3.3-bis §/§§ NU (non suivi d'un nom) : survécu aux pré-passes 1/2/2-bis (aucune ne
    //         consomme un §/§§ sans identifiant collé derrière) — refus explicite plutôt
    //         qu'un caractère qui atteint Civet tel quel (message cryptique). Corps
    //         PARTAGÉ (sigils.ts), même garde que RE_RAW_ACCESS_MALFORME (règle 3.5).
    m = rest.match(RE_BARE_SECTION)
    if (m) throw situe(bareSectionError(m[0]), code, i, opts)

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
    const avant = i > 0 ? code[i - 1] : ''
    if (!(avant === '.' || /[a-zA-Z0-9_$]/.test(avant))) {
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
      if (RE_RAW_WRITE_OLD_FORME_PAREN.test(rest) || RE_RAW_WRITE_OLD_FORME.test(rest)) throw situe(rawWriteAncienneFormeError(), code, i, opts)

      // …et ce qui reste est une faute de forme : refus BRUYANT plutôt qu'un
      // identifiant littéral qui casse au navigateur avec un build vert.
      if (RE_RAW_ACCESS_MALFORME.test(rest)) throw situe(rawAccessFormeError(), code, i, opts)
    }

    // 3.6-pré Garde-fou hooks : l'ancienne forme `@mount ->` (appel de la
    //      méthode d'enregistrement, retirée du runtime) casserait en silence
    //      → erreur de compilation explicite orientant vers la rune µ. Les
    //      noms restent LIBRES pour de vraies méthodes (`@mount = ->`, appels
    //      `@mount(x)`) : seule la silhouette hook est bloquée.
    m = rest.match(RE_OLD_HOOK)
    if (m) {
      throw situe(new Error(t('lexer.hook-arobase-retire', { hook: m[1] })), code, i, opts)
    }

    // 3.6 @xxx → this.xxx  (pas de chiffre en tête → `@2fa` reste littéral)
    m = rest.match(/^@([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (m) { result += `this.${m[1]}`; i += m[0].length; continue }

    // 3.7 Snapshot — désactiver la dérivation : $xxx =: expr → $.xxx = µ.snap expr
    // Note : on n'utilise PAS `:=` (qui est réservé `const` côté Civet) pour
    // éviter toute collision avec le langage source. La syntaxe MJS est `=:`.
    // Pas de chiffre en tête (aligné sur les autres sigils).
    m = rest.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*=:[ \t]*/)
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
        const preview = rest.slice(m[0].length).match(/^[ \t]*([^\n;]*)/)?.[1]?.trim() || '...'
        throw situe(new Error(t('lexer.symbole-declare-civet', { varName, preview })), code, i, opts)
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
    m = code[i - 1] === '.' && code[i - 2] !== '.' ? null : rest.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)/)
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
    m = rest.match(RE_MU_HOOKS)
    if (m) { result += `${cible}._mjs_hook '${m[1]}',`; i += m[0].length; continue }

    // 3.8c-bis Crochet mal écrit dans la silhouette d'un crochet (flèche directe, ou (args) puis flèche) :
    //      `µmounted ->` (déjà `µ.mounted ->` après le sucre µfoo → µ.foo du transpileur) se construisait, puis
    //      levait à l'exécution (« µ.mounted is not a function »). Seuls les noms proches d'un des six
    //      crochets sont refusés (crochetProche) ; le message propose le plus proche
    if (code[i] === 'µ' && !(avant === '.' || /[a-zA-Z0-9_$]/.test(avant))) {
      m = rest.match(RE_CROCHET_SILHOUETTE)
      const proche = m && crochetProche(m[1])
      if (proche) throw situe(new Error(t('lexer.crochet-inconnu', { nom: m![1], proche })), code, i, opts)
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
      if (moduleMode) throw situe(new Error(t('lexer.mu-layout-module')), code, i, opts)
      if (RE_MU_LAYOUT_WRITE.test(rest) || /(?:\+\+|--[ \t]*)$/.test(result)) throw situe(new Error(t('lexer.mu-layout-ecrit')), code, i, opts)
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

  return morceaux.join('') + result
}
