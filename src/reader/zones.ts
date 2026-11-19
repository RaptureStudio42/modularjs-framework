// reader/zones — où sont les textes d'un fichier serveur (chaînes, heredocs, gabarits, regex, commentaires), lus par le
// lecteur unique : le fichier entier est lu par Civet puis acorn (reader/code.ts), l'arbre dit où chaque texte s'ouvre et de
// quelle sorte il est ; sa fin se lit ensuite depuis cette ouverture, à ses seuls délimiteurs (guillemet, barre de la regex,
// dièses d'un bloc, fin de ligne), les textes d'une interpolation sautés de même. Une lecture par fichier, gardée nulle part :
// le contrôle des directives des fichiers serveur (cli/server-entry.ts) cherche ses motifs dans ce masque ; les petits
// lecteurs des composants gardent leurs masques faits main

import { createRequire } from 'node:module'
import type { Position } from 'acorn'
import { readCode, toFile } from './code.js'
import { reservedLettersOf } from './disguise.js'
import { readImportDirectives } from '../transpiler/directives.js'

// `diese` : un `#` que Civet nu lit comme du code (`#` → `this.length`, `s.#` → `s.length`), dans une suite d'au moins trois
type Kind = 'string' | 'regex' | 'comment' | 'block' | 'hash'

// le texte lu, à longueur égale : retours chariot en espaces (le lecteur lit des `\n`), `default` d'une directive
// `@import default` (lecture partagée) en un nom (mot réservé, le lecteur refuserait la ligne) ; en CoffeeScript, un `#`
// collé à une lettre ouvre un commentaire, comme pour son compilateur (le lecteur y verrait un nom de MJS). La marque d'ordre
// des octets est retirée avant, à la lecture du fichier (cli/server-entry.ts)
function readText(source: string, lang: string): string {
  let read = source
  if (read.includes('\r')) read = read.replace(/\r\n/g, ' \n').replace(/\r/g, '\n')
  for (const d of readImportDirectives(read, read)) {
    if (!d.isDefault) continue
    const at = d.index + d.text.search(/\bdefault\b/)
    read     = read.slice(0, at) + '_efault' + read.slice(at + 7)
  }
  return lang === 'coffee' ? read.replace(/(?<!#)#[A-Za-z_]/g, '# ') : read
}

// chaque texte d'un arbre ESTree (chaîne, gabarit, regex), clés d'objet et de classe comprises ; `diese` : chaque `this` et
// chaque nom en plus, que la carte de Civet nu ramène au `#` qui les écrit quand il est du code
function eachText(n: any, f: (n: any, kind: Kind) => void, hash = false): void {
  if (n === null || typeof n !== 'object') return
  if (Array.isArray(n)) {
    for (const x of n) eachText(x, f, hash)
    return
  }
  if (typeof n.type !== 'string') return
  if (n.type === 'Literal' && typeof n.value === 'string') f(n, 'string')
  else if (n.type === 'Literal' && n.regex) f(n, 'regex')
  else if (n.type === 'TemplateLiteral') f(n, 'string')
  else if (hash && (n.type === 'ThisExpression' || n.type === 'Identifier')) f(n, 'hash')
  for (const key in n) if (key !== 'loc') eachText(n[key], f, hash)
}

// les ouvertures des textes d'un fichier, et leur sorte ; null quand le lecteur ne le lit pas (faute de syntaxe, lettre
// réservée, arbre trop profond pour la pile, toute autre panne de la lecture) ou, en CoffeeScript, pas sûrement (sameRegexes)
function openings(source: string, lang: string): Map<number, Kind> | null {
  if (reservedLettersOf(source).length > 0) return null
  try {
    const read = readText(source, lang)
    const code = readCode(read, 0, read.length, 'script', 'zones.' + lang, false, lang === 'coffee' ? 'coffee-compat' : lang)
    if (code.error || !code.ast) return null
    const starts = new Map<number, Kind>()
    const set    = (loc: Position, kind: Kind, opens: RegExp): void => {
      const p = toFile(code, read, loc)
      if (p === null) return
      // un `#` de code seul ou doublé reste au masque fait main, qui n'en fait qu'un commentaire de sa ligne (`# @import x`
      // affiché en exemple) ; dès trois, il y ouvrirait un bloc qui cache les lignes suivantes
      if (kind === 'hash' && !read.slice(Math.max(0, p - 2), p + 3).includes('###')) return
      // une regex étendue interpolée (`///…#{x}…///`) devient un appel `RegExp(…)` : son gabarit s'ouvre sur les trois barres
      if ((kind === 'string' || kind === 'regex') && read.startsWith('///', p)) starts.set(p, 'regex')
      // une position qui ne tombe pas sur une ouverture de sa sorte n'est pas un texte écrit
      else if (opens.test(read.slice(p, p + 3))) starts.set(p, kind)
    }
    eachText(code.ast, (n, kind) => set(n.loc.start, kind, kind === 'regex' ? /^\// : kind === 'hash' ? /^#/ : /^['"`]/), lang === 'civet-bare')
    for (const c of code.comments) set(c.loc.start, c.type === 'Block' ? 'block' : 'comment', c.type === 'Block' ? /^(?:###|\/\*)/ : /^(?:#|\/\/)/)
    if (lang === 'coffee' && !sameRegexes(read, starts)) return null
    return starts
  }
  catch {
    // une chaîne de milliers de membres ou de termes déborde la pile du parcours de l'arbre (acorn-walk, eachText), ou la
    // lecture tombe en panne : le masque fait main seul, comme pour une faute de syntaxe
    return null
  }
}

// CoffeeScript divise par `/` après un nombre, une chaîne, `true`, `null`, `}` ou une regex (`2 /b; c = "/`), où le mode
// CoffeeScript de Civet ouvre une regex : chaque regex de l'arbre doit en être une pour le lexeur de CoffeeScript, et
// réciproquement, sinon la lecture n'est pas sûre (le guillemet que l'une des lectures range dans la regex ouvre une chaîne
// pour l'autre)
function sameRegexes(read: string, starts: Map<number, Kind>): boolean {
  const lexees = new Set<number>()
  for (const t of createRequire(import.meta.url)('coffeescript').tokens(read)) if (t[0] === 'REGEX' || t[0] === 'REGEX_START') lexees.add(t[2].range[0])
  for (const [p, kind] of starts) if (kind === 'regex' && !lexees.delete(p)) return false
  return lexees.size === 0
}

// le fichier à longueur égale, chaque texte remplacé par des espaces (sauts de ligne gardés), une chaîne interpolée d'un bloc,
// interpolations comprises ; null quand le lecteur ne le lit pas, ou pas sûrement. `langue` : `coffee` pour du CoffeeScript,
// `civet-nu` pour un `.civet` brut (Civet nu : `#` y est du code, blanchi comme un texte dès trois dièses de suite, et seul un
// gabarit `` `…${x}…` `` interpole), `civet` sinon (modes `coffeeComment coffeeInterpolation`). `dialecte` : le fichier est
// compilé par le dialecte de MJS (transpiler/sugar.ts), où un `####` (`#### titre`, bannière de dièses) ne commente que sa
// ligne, comme en Civet, et où une chaîne `"…"` qui porte `#{` ne passe jamais à la ligne pour le balayeur des interpolations (lexer,
// convertCoffeeInterpolations) : passée à la ligne, sa lecture par Civet n'est plus sûre, le fichier n'est pas masqué. Hors
// Civet nu, un `###` resté au code une fois les textes blanchis rend la lecture pas sûre de même : CoffeeScript et le dialecte
// referment un bloc au premier `###` qui suit, même en milieu de ligne (`### aide = 1`, `foo ### x = 1`), et la suite de la
// ligne est du code ; Civet n'y referme rien, il ouvre un bloc ou une chaîne (`foo "### x = 1`) qui court jusqu'à un `###`
// ou un guillemet plus bas, et cacherait la directive écrite entre les deux. Une panne de la lecture rend null ; une panne du
// blanchiment qui la suit remonte : l'appelant retombe sur son masque fait main
export function textMask(source: string, lang = 'civet', dialect = false): string | null {
  const starts = openings(source, lang)
  if (starts === null) return null
  const n     = source.length
  const chars = source.split('')
  let unsure  = false
  const blank = (from: number, a: number): void => {
    for (let k = from; k < a && k < n; k++) if (chars[k] !== '\n') chars[k] = ' '
  }
  const after = (j: number, closing: string): number => {
    const e = source.indexOf(closing, j)
    return e < 0 ? n : e + closing.length
  }
  // le code d'une interpolation, depuis j jusqu'à son `}` (rendu) ; ses textes sautés d'un bloc
  const code = (j: number): number => {
    let depth = 0
    while (j < n) {
      if (starts.has(j)) {
        j = text(j)
        continue
      }
      const c = source[j]
      if (c === '{') depth++
      else if (c === '}') {
        if (depth === 0) return j
        depth--
      }
      j++
    }
    return n
  }
  // le texte qui s'ouvre en p, blanchi ; rend l'indice qui le suit
  const text = (p: number): number => {
    const kind = starts.get(p)!
    let end    = n
    // un `#` de code en Civet nu : blanchi, le masque fait main qui repasse n'y ouvre ni commentaire ni bloc
    if (kind === 'hash') end = p + 1
    // un commentaire de ligne (`#### titre` aussi, dans le dialecte comme en Civet) s'arrête au premier `\r` ou `\n` pour Civet, au `\n` seul pour CoffeeScript
    else if (kind === 'comment') {
      end = p
      while (end < n && source[end] !== '\n' && (lang === 'coffee' || source[end] !== '\r')) end++
    }
    else if (kind === 'block') end = source.startsWith('###', p) ? after(p + 3, '###') : after(p + 2, '*/')
    else if (kind === 'regex') end = regexEnd(source, p)
    else {
      end = stringEnd(source, p, code, lang !== 'civet-bare')
      if (dialect && source[p] === '"' && !source.startsWith('"""', p) && /[\r\n]/.test(source.slice(p, end)) && source.slice(p, end).includes('#{')) unsure = true
    }
    blank(p, end)
    return end
  }
  let j = 0
  while (j < n) {
    if (starts.has(j)) j = text(j)
    else j++
  }
  const mask = chars.join('')
  // un `###` resté au code : l'arbre n'a pas lu les blocs comme le compilateur (Civet nu, où `###` est du code, excepté)
  return unsure || (lang !== 'civet-bare' && mask.includes('###')) ? null : mask
}

// fin d'une regex ouverte en p (`/…/` sur sa ligne, `///…///` étendue), drapeaux compris
function regexEnd(source: string, p: number): number {
  const n = source.length
  let j   = p + 1
  if (source.startsWith('///', p)) {
    const e = source.indexOf('///', p + 3)
    j       = e < 0 ? n : e + 3
  }
  else {
    let cls = false
    while (j < n && source[j] !== '\n') {
      const c = source[j]
      if (c === '\\') j++
      else if (c === '[') cls = true
      else if (c === ']') cls = false
      else if (c === '/' && !cls) break
      j++
    }
    // jamais refermée sur sa ligne : la ligne suivante reste au code
    if (j >= n || source[j] === '\n') return Math.min(j, n)
    j++
  }
  while (j < n && /[a-z]/.test(source[j])) j++
  return Math.min(j, n)
}

// fin d'une chaîne, d'un heredoc ou d'un gabarit ouvert en p ; `${…}` interpole dans un gabarit, `#{…}` entre guillemets
// doubles quand `guillemets` est vrai (Civet nu ne l'y lit pas) : le code de l'interpolation est sauté par `code`, ses
// textes compris
function stringEnd(source: string, p: number, code: (j: number) => number, quotes: boolean): number {
  const n       = source.length
  const triple  = source.startsWith('\'\'\'', p) || source.startsWith('"""', p) || source.startsWith('```', p)
  const closing = triple ? source.slice(p, p + 3) : source[p]
  const interp  = closing[0] === '`' ? '${' : closing[0] === '"' && quotes ? '#{' : null
  let j         = p + closing.length
  while (j < n) {
    if (source[j] === '\\') j += 2
    else if (source.startsWith(closing, j)) return j + closing.length
    else if (interp !== null && source.startsWith(interp, j)) j = code(j + 2) + 1
    else j++
  }
  return n
}
