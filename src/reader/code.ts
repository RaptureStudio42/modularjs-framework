// reader/code — un morceau de code du fichier lu par le vrai Civet, puis par acorn
// le morceau (retrait commun retiré, raccourcis déguisés à longueur égale) est compilé en mode `coffeeComment
// coffeeInterpolation` ; l'arbre ESTree d'acorn sépare exactement le code de ses textes (chaînes, gabarits, regex,
// commentaires) et la carte de Civet ramène chaque position du JavaScript produit à un indice du fichier
// un morceau de CoffeeScript se compile en plus en mode `coffeeDiv` : `//` y est la division entière (`n // 2`), comme pour
// le compilateur CoffeeScript du projet ; collé à son second terme (`n //2`), Civet y voit encore un commentaire quand
// CoffeeScript y voit une division : l'arbre range alors la suite de la ligne dans un commentaire (le doute du bundler, qui
// cherche une balise du cœur dans le code, lit ce commentaire-là comme du code)

import { createRequire } from 'node:module'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { disguise, presentLetters, reveal, RESERVED_LETTERS } from './disguise.js'
import type { Code, ModeCode, CodeText } from './types.js'

const DIRECTIVE_CIVET  = '"civet coffeeComment coffeeInterpolation"\n'
const DIRECTIVE_COFFEE = '"civet coffeeComment coffeeInterpolation coffeeDiv"\n'
// un fichier CoffeeScript entier (fichier serveur, cli/server-entry.ts) : lu comme son compilateur, classes (`texte: ->`,
// `constructor: (@x) ->`), `for own`, `a ? b` et `::` compris
const DIRECTIVE_COFFEE_COMPAT = '"civet coffeeCompat"\n'
// un fichier `.civet` brut (cli/server-entry.ts) : Civet nu, comme son compilateur (`#` y est du code, `"#{x}"` une chaîne
// simple) ; une directive sans réglage tient la première ligne, et celle que l'auteur écrit en tête reste lue
const BARE_CIVET_DIRECTIVE = '"civet"\n'

// CHOIX — taille du cache des compilations : les mêmes expressions reviennent d'un composant à l'autre (≈ 9 700
// compilations distinctes pour le site, les composants des tests et le cœur, 1 683 fichiers) ; au-delà, la plus ancienne part
const CACHE_MAX = 20000

// noms qui portent un raccourci de MJS (la lettre des directives exceptée : un appel `Ꜷimport(…)` est une directive)
const RE_MJS_NAME = new RegExp(`[$µ${RESERVED_LETTERS['§']}${RESERVED_LETTERS['@@']}${RESERVED_LETTERS['#']}${RESERVED_LETTERS['&']}]`)
const DIRECTIVE_LETTER = RESERVED_LETTERS['@import']

interface Compilation {
  js: string | null
  ast: acorn.Program | null
  comments: acorn.Comment[]
  trace: TraceMap | null
  error: { message: string, line: number, column: number, js: boolean } | null
}

const cache = new Map<string, Compilation>()

// acorn sans le refus d'un `export` d'un nom pas encore déclaré : le lecteur lit le code tel qu'écrit, la passe de
// déclaration (plus loin) déclare ce nom (`export { plus }` puis `plus = (x) -> x + 1`)
const Reader = acorn.Parser.extend((Base: any) => class extends Base {
  raiseRecoverable(pos: number, message: string): void {
    if (!/^Export '.*' is not defined$/.test(message)) super.raiseRecoverable(pos, message)
  }
} as any)

// relevé des lectures, pour l'outil de comparaison et les mesures
export const codeCounters = { compilations: 0, retries: 0, civetMs: 0, acornMs: 0 }

export function clearCodeCache(): void {
  cache.clear()
  codeCounters.compilations = 0
  codeCounters.retries      = 0
  codeCounters.civetMs      = 0
  codeCounters.acornMs      = 0
}

// Civet chargé en synchrone (CJS, `createRequire`) et paresseusement, comme generator/utils.ts
let civetCompile: ((source: string, options: Record<string, unknown>) => { code: string, sourceMap: { json: (source: string, output: string) => unknown } }) | null = null
function compileCivet(source: string, options: Record<string, unknown>) {
  if (!civetCompile) civetCompile = createRequire(import.meta.url)('@danielx/civet').compile
  return civetCompile(source, options)
}

// le texte donné à Civet et, par ligne de ce texte, l'indice du fichier qui tombe sous sa colonne 0
// le retrait commun des lignes est retiré (sauf la première ligne d'une expression ou d'un gestionnaire, qui suit
// l'accolade) ; une expression est mise entre parenthèses, la parenthèse ouvrante posée juste avant le morceau
function prepare(source: string, start: number, end: number, mode: ModeCode, lang: string): { text: string, bases: (number | null)[] } {
  const lines = source.slice(start, end).split('\n')
  let indent  = Infinity
  lines.forEach((line, k) => {
    if ((mode !== 'script' && k === 0) || line.trim() === '') return
    indent = Math.min(indent, /^[ \t]*/.exec(line)[0].length)
  })
  if (indent === Infinity) indent = 0
  const bases: (number | null)[] = [null]
  const pieces: string[] = []
  let pos = start
  lines.forEach((line, k) => {
    const cut = (mode !== 'script' && k === 0) ? 0 : Math.min(indent, /^[ \t]*/.exec(line)[0].length)
    let text    = line.slice(cut)
    let base    = pos + cut
    if (k === 0 && mode === 'expression') {
      text  = '(' + text
      base -= 1
    }
    pieces.push(text)
    bases.push(base)
    pos += line.length + 1
  })
  if (mode === 'expression') pieces[pieces.length - 1] += '\n)'
  return { text: (lang === 'coffee' ? DIRECTIVE_COFFEE : lang === 'coffee-compat' ? DIRECTIVE_COFFEE_COMPAT : lang === 'civet-bare' ? BARE_CIVET_DIRECTIVE : DIRECTIVE_CIVET) + disguise(pieces.join('\n')), bases }
}

// première ligne du message, sans le préfixe `fichier:ligne:colonne` de Civet ni le `(ligne:colonne)` d'acorn
function firstLine(message: string): string {
  return message.split('\n')[0].replace(/^\S*:\d+:\d+\s*/, '').replace(/\s*\(\d+:\d+\)$/, '')
}

function compiler(text: string, name: string, keep = true): Compilation {
  const seen = cache.get(text)
  if (seen) {
    codeCounters.retries++
    return seen
  }
  const r: Compilation = { js: null, ast: null, comments: [], trace: null, error: null }
  const t0 = performance.now()
  try {
    const output = compileCivet(text, { js: true, sync: true, sourceMap: true, filename: name })
    r.js         = output.code
    r.trace      = new TraceMap(output.sourceMap.json(name, name + '.js') as ConstructorParameters<typeof TraceMap>[0])
  }
  catch (e) {
    const err = e as { message?: string, line?: number, column?: number }
    r.error   = { message: firstLine(String(err.message ?? e)), line: err.line ?? 1, column: err.column ?? 1, js: false }
  }
  codeCounters.compilations++
  codeCounters.civetMs += performance.now() - t0
  if (r.js !== null) {
    const t1 = performance.now()
    try {
      r.ast = Reader.parse(r.js, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: r.comments, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
    }
    catch (e) {
      const err = e as { message?: string, loc?: { line: number, column: number } }
      r.error   = { message: firstLine(String(err.message ?? e)), line: err.loc?.line ?? 1, column: err.loc?.column ?? 0, js: true }
    }
    codeCounters.acornMs += performance.now() - t1
  }
  if (!keep) return r
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(text, r)
  return r
}

// indice du fichier d'une position (ligne à partir de 1, colonne à partir de 0) du JavaScript produit pour ce code
// la carte de Civet pose certains jetons sur le blanc qui les précède (`µemit 'x'`) : `skipBlanks` avance au
// premier caractère qui n'est pas un blanc de la même ligne
export function toFile(code: Code, source: string, loc: { line: number, column: number }, skipBlanks = true): number | null {
  if (!code.map) return null
  const o = originalPositionFor(code.map.trace, { line: loc.line, column: loc.column })
  if (o.line === null) return null
  const base = code.map.bases[o.line - 1]
  if (base === null || base === undefined) return null
  let p = base + o.column
  if (skipBlanks) while (source[p] === ' ' || source[p] === '\t') p++
  return p
}

// lit un morceau de code du fichier ; `source` est la source normalisée du fichier
// `garder` faux : la compilation ne rejoint pas le cache (un script entier, relu une fois par compilation, y garderait
// son arbre et sa carte à chaque modification) ; `langue` : celle du morceau (`coffee` pour du CoffeeScript, Civet sinon ;
// `coffee-compat` pour un fichier CoffeeScript entier, `civet-nu` pour un fichier `.civet` brut)
export function readCode(source: string, start: number, end: number, mode: ModeCode, name: string, keep = true, lang = 'civet'): Code {
  const prep       = prepare(source, start, end, mode, lang)
  const r          = compiler(prep.text, name, keep)
  const code: Code = {
    kind: 'code', mode, start, end, js: r.js, ast: r.ast, comments: r.comments, texts: [], names: [], directives: [], error: null,
    map: r.trace ? { bases: prep.bases, trace: r.trace } : null,
  }
  if (r.error) {
    let pos: number | null = null
    if (r.error.js) pos = toFile(code, source, { line: r.error.line, column: r.error.column }, false)
    else {
      const base = prep.bases[r.error.line - 1]
      if (base !== null && base !== undefined) pos = base + r.error.column - 1
      else if (r.error.line > 1) pos = end
    }
    code.error = { message: reveal(r.error.message), start: pos === null ? start : Math.min(Math.max(pos, start), end) }
    return code
  }
  const text = (kind: CodeText['kind'], value: string, raw: string, loc: { line: number, column: number }) => {
    code.texts.push({ kind, value: reveal(value, presentLetters(raw)), start: toFile(code, source, loc) })
  }
  walk.full(r.ast, (n: acorn.Node & Record<string, any>) => {
    if (n.type === 'Literal' && typeof n.value === 'string') text('string', n.value, n.raw ?? '', n.loc.start)
    else if (n.type === 'Literal' && n.regex) text('regex', n.regex.pattern, n.regex.pattern, n.loc.start)
    else if (n.type === 'TemplateElement') text('template', n.value.cooked ?? n.value.raw, n.value.raw, n.loc.start)
    else if (n.type === 'Identifier' && RE_MJS_NAME.test(n.name)) code.names.push({ name: reveal(n.name), start: toFile(code, source, n.loc.start) })
    else if (n.type === 'PrivateIdentifier') code.names.push({ name: '#' + n.name, start: toFile(code, source, n.loc.start) })
    else if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name.startsWith(DIRECTIVE_LETTER)) code.directives.push({ name: '@' + n.callee.name.slice(1), start: toFile(code, source, n.loc.start) })
  })
  for (const c of r.comments) text('comment', c.value, c.value, c.loc.start)
  return code
}

// un texte entier (directive comprise) compilé par Civet puis lu par acorn, par le même cache : les expressions du gabarit
// lues pour le générateur (reader/expression.ts)
export function compileText(text: string, name: string): Compilation {
  return compiler(text, name)
}
