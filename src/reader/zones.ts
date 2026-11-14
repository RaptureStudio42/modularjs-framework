// reader/zones — où sont les textes d'un fichier serveur (chaînes, heredocs, gabarits, regex, commentaires), lus par le
// lecteur unique : le fichier entier est lu par Civet puis acorn (reader/code.ts), l'arbre dit où chaque texte s'ouvre et de
// quelle sorte il est ; sa fin se lit ensuite depuis cette ouverture, à ses seuls délimiteurs (guillemet, barre de la regex,
// dièses d'un bloc, fin de ligne), les textes d'une interpolation sautés de même. Une lecture par fichier, gardée nulle part :
// le contrôle des directives des fichiers serveur (cli/server-entry.ts) cherche ses motifs dans ce masque ; les petits
// lecteurs des composants gardent leurs masques faits main

import { createRequire } from 'node:module'
import type { Position } from 'acorn'
import { lireCode, versLeFichier } from './code.js'
import { lettresReserveesDe } from './disguise.js'
import { readImportDirectives } from '../transpiler/directives.js'

// `diese` : un `#` que Civet nu lit comme du code (`#` → `this.length`, `s.#` → `s.length`), dans une suite d'au moins trois
type Sorte = 'chaine' | 'regex' | 'commentaire' | 'bloc' | 'diese'

// le texte lu, à longueur égale : retours chariot en espaces (le lecteur lit des `\n`), `default` d'une directive
// `@import default` (lecture partagée) en un nom (mot réservé, le lecteur refuserait la ligne) ; en CoffeeScript, un `#`
// collé à une lettre ouvre un commentaire, comme pour son compilateur (le lecteur y verrait un nom de MJS). La marque d'ordre
// des octets est retirée avant, à la lecture du fichier (cli/server-entry.ts)
function texteLu(source: string, langue: string): string {
  let lu = source
  if (lu.includes('\r')) lu = lu.replace(/\r\n/g, ' \n').replace(/\r/g, '\n')
  for (const d of readImportDirectives(lu, lu)) {
    if (!d.isDefault) continue
    const at = d.index + d.texte.search(/\bdefault\b/)
    lu       = lu.slice(0, at) + '_efault' + lu.slice(at + 7)
  }
  return langue === 'coffee' ? lu.replace(/(?<!#)#[A-Za-z_]/g, '# ') : lu
}

// chaque texte d'un arbre ESTree (chaîne, gabarit, regex), clés d'objet et de classe comprises ; `diese` : chaque `this` et
// chaque nom en plus, que la carte de Civet nu ramène au `#` qui les écrit quand il est du code
function chaqueTexte(n: any, f: (n: any, sorte: Sorte) => void, diese = false): void {
  if (n === null || typeof n !== 'object') return
  if (Array.isArray(n)) {
    for (const x of n) chaqueTexte(x, f, diese)
    return
  }
  if (typeof n.type !== 'string') return
  if (n.type === 'Literal' && typeof n.value === 'string') f(n, 'chaine')
  else if (n.type === 'Literal' && n.regex) f(n, 'regex')
  else if (n.type === 'TemplateLiteral') f(n, 'chaine')
  else if (diese && (n.type === 'ThisExpression' || n.type === 'Identifier')) f(n, 'diese')
  for (const cle in n) if (cle !== 'loc') chaqueTexte(n[cle], f, diese)
}

// les ouvertures des textes d'un fichier, et leur sorte ; null quand le lecteur ne le lit pas (faute de syntaxe, lettre
// réservée, arbre trop profond pour la pile, toute autre panne de la lecture) ou, en CoffeeScript, pas sûrement (memesRegex)
function ouvertures(source: string, langue: string): Map<number, Sorte> | null {
  if (lettresReserveesDe(source).length > 0) return null
  try {
    const lu   = texteLu(source, langue)
    const code = lireCode(lu, 0, lu.length, 'script', 'zones.' + langue, false, langue === 'coffee' ? 'coffee-compat' : langue)
    if (code.erreur || !code.ast) return null
    const debuts = new Map<number, Sorte>()
    const poser  = (loc: Position, sorte: Sorte, ouvre: RegExp): void => {
      const p = versLeFichier(code, lu, loc)
      if (p === null) return
      // un `#` de code seul ou doublé reste au masque fait main, qui n'en fait qu'un commentaire de sa ligne (`# @import x`
      // affiché en exemple) ; dès trois, il y ouvrirait un bloc qui cache les lignes suivantes
      if (sorte === 'diese' && !lu.slice(Math.max(0, p - 2), p + 3).includes('###')) return
      // une regex étendue interpolée (`///…#{x}…///`) devient un appel `RegExp(…)` : son gabarit s'ouvre sur les trois barres
      if ((sorte === 'chaine' || sorte === 'regex') && lu.startsWith('///', p)) debuts.set(p, 'regex')
      // une position qui ne tombe pas sur une ouverture de sa sorte n'est pas un texte écrit
      else if (ouvre.test(lu.slice(p, p + 3))) debuts.set(p, sorte)
    }
    chaqueTexte(code.ast, (n, sorte) => poser(n.loc.start, sorte, sorte === 'regex' ? /^\// : sorte === 'diese' ? /^#/ : /^['"`]/), langue === 'civet-nu')
    for (const c of code.commentaires) poser(c.loc.start, c.type === 'Block' ? 'bloc' : 'commentaire', c.type === 'Block' ? /^(?:###|\/\*)/ : /^(?:#|\/\/)/)
    if (langue === 'coffee' && !memesRegex(lu, debuts)) return null
    return debuts
  }
  catch {
    // une chaîne de milliers de membres ou de termes déborde la pile du parcours de l'arbre (acorn-walk, chaqueTexte), ou la
    // lecture tombe en panne : le masque fait main seul, comme pour une faute de syntaxe
    return null
  }
}

// CoffeeScript divise par `/` après un nombre, une chaîne, `true`, `null`, `}` ou une regex (`2 /b; c = "/`), où le mode
// CoffeeScript de Civet ouvre une regex : chaque regex de l'arbre doit en être une pour le lexeur de CoffeeScript, et
// réciproquement, sinon la lecture n'est pas sûre (le guillemet que l'une des lectures range dans la regex ouvre une chaîne
// pour l'autre)
function memesRegex(lu: string, debuts: Map<number, Sorte>): boolean {
  const lexees = new Set<number>()
  for (const t of createRequire(import.meta.url)('coffeescript').tokens(lu)) if (t[0] === 'REGEX' || t[0] === 'REGEX_START') lexees.add(t[2].range[0])
  for (const [p, sorte] of debuts) if (sorte === 'regex' && !lexees.delete(p)) return false
  return lexees.size === 0
}

// le fichier à longueur égale, chaque texte remplacé par des espaces (sauts de ligne gardés), une chaîne interpolée d'un bloc,
// interpolations comprises ; null quand le lecteur ne le lit pas, ou pas sûrement. `langue` : `coffee` pour du CoffeeScript,
// `civet-nu` pour un `.civet` brut (Civet nu : `#` y est du code, blanchi comme un texte dès trois dièses de suite, et seul un
// gabarit `` `…${x}…` `` interpole), `civet` sinon (modes `coffeeComment coffeeInterpolation`). `dialecte` : le fichier est
// compilé par le dialecte de MJS (transpiler/sugar.ts), où un commentaire qui commence par `###` (`####`, `#### titre`,
// bannière de dièses) ouvre un bloc jusqu'au `###` suivant, comme `###` (Civet y lit un commentaire de ligne), et où une
// chaîne `"…"` qui porte `#{` ne passe jamais à la ligne pour le balayeur des interpolations (lexer,
// convertCoffeeInterpolations) : passée à la ligne, sa lecture par Civet n'est plus sûre, le fichier n'est pas masqué. Hors
// Civet nu, un `###` resté au code une fois les textes blanchis rend la lecture pas sûre de même : CoffeeScript et le dialecte
// referment un bloc au premier `###` qui suit, même en milieu de ligne (`### aide = 1`, `foo ### x = 1`), et la suite de la
// ligne est du code ; Civet n'y referme rien, il ouvre un bloc ou une chaîne (`foo "### x = 1`) qui court jusqu'à un `###`
// ou un guillemet plus bas, et cacherait la directive écrite entre les deux. Une panne de la lecture rend null ; une panne du
// blanchiment qui la suit remonte : l'appelant retombe sur son masque fait main
export function masqueDesTextes(source: string, langue = 'civet', dialecte = false): string | null {
  const debuts = ouvertures(source, langue)
  if (debuts === null) return null
  const n     = source.length
  const chars = source.split('')
  let pasSur  = false
  const blank = (de: number, a: number): void => {
    for (let k = de; k < a && k < n; k++) if (chars[k] !== '\n') chars[k] = ' '
  }
  const apres = (j: number, fermant: string): number => {
    const e = source.indexOf(fermant, j)
    return e < 0 ? n : e + fermant.length
  }
  // le code d'une interpolation, depuis j jusqu'à son `}` (rendu) ; ses textes sautés d'un bloc
  const code = (j: number): number => {
    let profondeur = 0
    while (j < n) {
      if (debuts.has(j)) {
        j = texte(j)
        continue
      }
      const c = source[j]
      if (c === '{') profondeur++
      else if (c === '}') {
        if (profondeur === 0) return j
        profondeur--
      }
      j++
    }
    return n
  }
  // le texte qui s'ouvre en p, blanchi ; rend l'indice qui le suit
  const texte = (p: number): number => {
    const sorte = debuts.get(p)!
    let fin     = n
    // un `#` de code en Civet nu : blanchi, le masque fait main qui repasse n'y ouvre ni commentaire ni bloc
    if (sorte === 'diese') fin = p + 1
    // dans le dialecte, un commentaire `####…` court jusqu'au `###` suivant, ou jusqu'à la fin du fichier
    else if (sorte === 'commentaire' && dialecte && source.startsWith('###', p)) fin = apres(p + 3, '###')
    // un commentaire de ligne s'arrête au premier `\r` ou `\n` pour Civet, au `\n` seul pour CoffeeScript
    else if (sorte === 'commentaire') {
      fin = p
      while (fin < n && source[fin] !== '\n' && (langue === 'coffee' || source[fin] !== '\r')) fin++
    }
    else if (sorte === 'bloc') fin = source.startsWith('###', p) ? apres(p + 3, '###') : apres(p + 2, '*/')
    else if (sorte === 'regex') fin = finDeRegex(source, p)
    else {
      fin = finDeChaine(source, p, code, langue !== 'civet-nu')
      if (dialecte && source[p] === '"' && !source.startsWith('"""', p) && /[\r\n]/.test(source.slice(p, fin)) && source.slice(p, fin).includes('#{')) pasSur = true
    }
    blank(p, fin)
    return fin
  }
  let j = 0
  while (j < n) {
    if (debuts.has(j)) j = texte(j)
    else j++
  }
  const masque = chars.join('')
  // un `###` resté au code : l'arbre n'a pas lu les blocs comme le compilateur (Civet nu, où `###` est du code, excepté)
  return pasSur || (langue !== 'civet-nu' && masque.includes('###')) ? null : masque
}

// fin d'une regex ouverte en p (`/…/` sur sa ligne, `///…///` étendue), drapeaux compris
function finDeRegex(source: string, p: number): number {
  const n = source.length
  let j   = p + 1
  if (source.startsWith('///', p)) {
    const e = source.indexOf('///', p + 3)
    j       = e < 0 ? n : e + 3
  }
  else {
    let classe = false
    while (j < n && source[j] !== '\n') {
      const c = source[j]
      if (c === '\\') j++
      else if (c === '[') classe = true
      else if (c === ']') classe = false
      else if (c === '/' && !classe) break
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
function finDeChaine(source: string, p: number, code: (j: number) => number, guillemets: boolean): number {
  const n       = source.length
  const triple  = source.startsWith('\'\'\'', p) || source.startsWith('"""', p) || source.startsWith('```', p)
  const fermant = triple ? source.slice(p, p + 3) : source[p]
  const interp  = fermant[0] === '`' ? '${' : fermant[0] === '"' && guillemets ? '#{' : null
  let j         = p + fermant.length
  while (j < n) {
    if (source[j] === '\\') j += 2
    else if (source.startsWith(fermant, j)) return j + fermant.length
    else if (interp !== null && source.startsWith(interp, j)) j = code(j + 2) + 1
    else j++
  }
  return n
}
