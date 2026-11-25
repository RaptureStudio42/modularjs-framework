// bundler/one-byte — le texte d'un fichier JS de production gardé sur un octet par caractère.
//
// le navigateur garde le texte de chaque script tant que la page vit : un octet par caractère si tout le fichier tient sous U+0100,
// DEUX dès qu'un seul caractère dépasse U+00FF (`…`, `’`, `—`, `œ`, `€`, un émoji). Écrit en échappement (`…`), ce caractère
// laisse le fichier sur un octet ; les accents du français et `µ` sont sous U+0100, ils restent tels quels.
//
// règle de sûreté : dans le doute, le fichier sort TEL QUEL, en entier. Un échappement ne se pose que là où il vaut le caractère :
// chaîne entre guillemets, texte d'un gabarit sans étiquette, nom (identifiant, propriété, nom privé). Un gabarit étiqueté lit le
// texte brut (`String.raw`), la propriété `source` d'une expression régulière aussi, une directive se reconnaît à son texte : un
// caractère large à l'un de ces endroits, dans un commentaire ou hors de tout jeton, et rien n'est touché. Le fichier est lu par
// acorn (en module, puis en script), puis RELU après la passe : mêmes jetons, mêmes valeurs, sinon il sort tel quel. Un fichier trop long pour être
// analysé sans risque pour la mémoire de la construction sort tel quel lui aussi (cf. ONE_BYTE_MAX_LENGTH).
//
// ce qui lit son propre texte (`fn.toString()`) y voit l'échappement, comme il y voit déjà le compactage.

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { decode, encode } from '@jridgewell/sourcemap-codec'

/**
 * `narrow` : aucun caractère au-delà de U+00FF, fichier non analysé ; `converted` : écrit en échappements ; tout autre état : fichier
 * laissé tel quel, et pourquoi — `unreadable` (acorn ne le lit pas), `regexp`, `tagged-template`, `directive`, `comment` (le caractère
 * est à cet endroit), `elsewhere` (hors de tout jeton reconnu), `lone-surrogate` (demi-caractère isolé), `weight` (plafond de poids),
 * `text` (le texte gardé ne baisserait pas), `changed` (la relecture ne rend pas les mêmes jetons), `map` (la carte ne peut pas suivre),
 * `size` (fichier trop long : il n'est pas analysé).
 */
export type OneByteState = 'narrow' | 'converted' | 'unreadable' | 'regexp' | 'tagged-template' | 'directive' | 'comment' | 'elsewhere' | 'lone-surrogate' | 'weight' | 'text' | 'changed' | 'map' | 'size'

export interface OneByteResult {
  /** le texte à écrire : celui de la passe s'il est `converted`, sinon le texte reçu, le même */
  code: string
  /** la carte de source de ce texte : ses colonnes suivent les échappements */
  map?: string
  state: OneByteState
  /** unités UTF-16 au-delà de U+00FF du texte reçu */
  wide: number
  /** le texte rendu (`code`) a été lu par acorn en module, `ecmaVersion: 'latest'` : les options du contrôle ESM du bundler, les autres
   *  (`allowAwaitOutsideFunction`, déjà permis en module, `onToken`, `onComment`) n'acceptant rien de plus — sa syntaxe est prouvée */
  readAsModule: boolean
}

/** plafond de poids : un fichier n'est touché que si son poids brut (UTF-8) monte de 2 % au plus */
export const ONE_BYTE_MAX_GROWTH = 0.02

/**
 * plafond de taille, en unités UTF-16 : au-delà, le fichier sort tel quel sans être analysé. L'analyse garde l'arbre et les jetons du fichier, avant
 * puis après la passe : environ 190 Mo de mémoire par Mo de texte, et Node s'arrête net, sans erreur à rattraper, quand son tas est plein
 */
export const ONE_BYTE_MAX_LENGTH = 2 * 1024 * 1024

// un échappement : début et fin du caractère dans le texte reçu, texte qui le remplace
type Edit = [start: number, end: number, text: string]

// un jeton d'acorn avec sa valeur lue (valeur d'une chaîne, texte d'un morceau de gabarit, nom), que ses types ne déclarent pas
type ReadToken = acorn.Token & { value?: any }

interface Reading {
  ast:        acorn.Node
  tokens:     ReadToken[]
  comments:   Array<[number, number]>
  sourceType: 'module' | 'script'
}

// unités UTF-16 au-delà de U+00FF entre deux positions
function countWide(text: string, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) if (text.charCodeAt(i) > 0xFF) n++
  return n
}

function hasWide(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (text.charCodeAt(i) > 0xFF) return true
  return false
}

const escapeUnit = (unit: number): string => '\\u' + unit.toString(16).toUpperCase().padStart(4, '0')

// le fichier lu par acorn, en module puis en script (`await` permis hors fonction) : son arbre, ses jetons, ses commentaires ; null s'il ne se lit pas
function read(code: string): Reading | null {
  for (const sourceType of ['module', 'script'] as const) {
    const tokens: ReadToken[]               = []
    const comments: Array<[number, number]> = []
    try {
      const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType, allowAwaitOutsideFunction: true, onToken: tokens, onComment: (_block, _text, start, end) => { comments.push([start, end]) } })
      return { ast, tokens, comments, sourceType }
    }
    catch {
      continue
    }
  }
  return null
}

// mêmes jetons, dans le même ordre, de même sorte et de même valeur : valeur d'une chaîne, texte lu d'un morceau de gabarit, nom d'un identifiant
function sameProgram(a: Reading, b: Reading): boolean {
  if (a.sourceType !== b.sourceType || a.tokens.length !== b.tokens.length || a.comments.length !== b.comments.length) return false
  for (let i = 0; i < a.tokens.length; i++) {
    const x = a.tokens[i]
    const y = b.tokens[i]
    if (x.type !== y.type) return false
    if (x.type === acorn.tokTypes.regexp ? x.value.pattern !== y.value.pattern || x.value.flags !== y.value.flags : x.value !== y.value) return false
  }
  return true
}

// la carte suit les échappements : sur chaque ligne, les colonnes placées après un caractère échappé avancent de son allongement. Lignes comptées
// comme esbuild compte celles du texte qu'il produit (\n, \r\n, \r, U+2028, U+2029), colonnes en unités UTF-16 ; null si la carte ne se lit pas,
// ou si un séparateur de ligne (U+2028, U+2029) est échappé : le compte des lignes de la carte changerait
function shiftMap(map: string, code: string, edits: Edit[]): string | null {
  let parsed: any
  let lines: ReturnType<typeof decode>
  try {
    parsed = JSON.parse(map)
    if (typeof parsed.mappings !== 'string' || parsed.sections) return null
    lines = decode(parsed.mappings)
  }
  catch {
    return null
  }
  const byLine = new Map<number, Array<[number, number]>>()
  let line     = 0
  let lineAt   = 0
  let i        = 0
  for (const [start, end, text] of edits) {
    const first = code.charCodeAt(start)
    if (first === 0x2028 || first === 0x2029) return null
    for (; i < start; i++) {
      const unit = code.charCodeAt(i)
      if (unit === 10 || unit === 0x2028 || unit === 0x2029 || (unit === 13 && code.charCodeAt(i + 1) !== 10)) {
        line++
        lineAt = i + 1
      }
    }
    let list = byLine.get(line)
    if (!list) byLine.set(line, list = [])
    list.push([start - lineAt, text.length - (end - start)])
  }
  for (const [n, list] of byLine) {
    let k   = 0
    let add = 0
    for (const segment of lines[n] ?? []) {
      while (k < list.length && list[k][0] < segment[0]) add += list[k++][1]
      segment[0] += add
    }
  }
  parsed.mappings = encode(lines)
  return JSON.stringify(parsed)
}

/**
 * Le texte d'un fichier JS, ses caractères au-delà de U+00FF écrits en échappements quand le programme reste le même, et sa carte de source
 * si elle est donnée. `maxGrowth` : la part de poids brut que le fichier peut prendre (défaut `ONE_BYTE_MAX_GROWTH`) ; `maxLength` : la longueur
 * au-delà de laquelle il n'est pas analysé (défaut `ONE_BYTE_MAX_LENGTH`).
 */
export function oneByteSource(code: string, map?: string, maxGrowth: number = ONE_BYTE_MAX_GROWTH, maxLength: number = ONE_BYTE_MAX_LENGTH): OneByteResult {
  const wide = countWide(code, 0, code.length)
  // vrai dès que la première lecture est en module : le texte gardé tel quel est celui qu'elle a lu, le texte réécrit est relu dans la même grammaire (cf. sameProgram)
  let readAsModule = false
  const left = (state: OneByteState): OneByteResult => ({ code, map, state, wide, readAsModule })
  if (wide === 0) return left('narrow')
  if (code.length > maxLength) return left('size')
  const before = read(code)
  if (!before) return left('unreadable')
  readAsModule = before.sourceType === 'module'
  for (const [start, end] of before.comments) if (hasWide(code, start, end)) return left('comment')
  // débuts des morceaux d'un gabarit étiqueté, débuts des chaînes écrites en directive
  const tagged     = new Set<number>()
  const directives = new Set<number>()
  try {
    walk.full(before.ast, (n: any) => {
      if (n.type === 'TaggedTemplateExpression') for (const q of n.quasi.quasis) tagged.add(q.start)
      else if (n.type === 'ExpressionStatement' && typeof n.directive === 'string') directives.add(n.expression.start)
    })
  }
  catch {
    return left('unreadable')
  }
  const types         = acorn.tokTypes
  const edits: Edit[] = []
  for (const tok of before.tokens) {
    if (!hasWide(code, tok.start, tok.end)) continue
    const name = tok.type === types.name || tok.type === types.privateId
    if (tok.type === types.regexp) return left('regexp')
    if (tok.type === types.invalidTemplate || (tok.type === types.template && tagged.has(tok.start))) return left('tagged-template')
    if (tok.type === types.string && directives.has(tok.start)) return left('directive')
    if (!name && tok.type !== types.string && tok.type !== types.template) return left('elsewhere')
    for (let i = tok.start; i < tok.end; i++) {
      const unit = code.charCodeAt(i)
      if (unit <= 0xFF) continue
      if (unit < 0xD800 || unit > 0xDFFF) {
        edits.push([i, i + 1, escapeUnit(unit)])
        continue
      }
      // un caractère sur deux unités : ses deux moitiés dans une chaîne ou un gabarit, son point de code entre accolades dans un nom (seule forme permise)
      const low = i + 1 < tok.end ? code.charCodeAt(i + 1) : 0
      if (unit > 0xDBFF || low < 0xDC00 || low > 0xDFFF) return left('lone-surrogate')
      edits.push([i, i + 2, name ? `\\u{${((unit - 0xD800) * 0x400 + low - 0xDC00 + 0x10000).toString(16).toUpperCase()}}` : escapeUnit(unit) + escapeUnit(low)])
      i++
    }
  }
  let out    = ''
  let cursor = 0
  for (const [start, end, text] of edits) {
    out   += code.slice(cursor, start) + text
    cursor = end
  }
  out += code.slice(cursor)
  // un caractère large hors de tout jeton (espace typographique entre deux instructions) : rien de sûr à écrire à sa place
  if (hasWide(out, 0, out.length)) return left('elsewhere')
  if (Buffer.byteLength(out) > Buffer.byteLength(code) * (1 + maxGrowth)) return left('weight')
  // texte gardé par le navigateur : deux octets par unité avant, un après
  if (out.length >= 2 * code.length) return left('text')
  const after = read(out)
  if (!after || !sameProgram(before, after)) return left('changed')
  if (map === undefined) return { code: out, state: 'converted', wide, readAsModule }
  const shifted = shiftMap(map, code, edits)
  return shifted === null ? left('map') : { code: out, map: shifted, state: 'converted', wide, readAsModule }
}
