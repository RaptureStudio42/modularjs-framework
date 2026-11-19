// reader/script — le script lu par l'arbre (vrai Civet en mode `coffeeComment`, puis acorn) : les commentaires `#` du
// dialecte (`#` → `//`, `### … ###` → `/* … */`) et les raccourcis `$x`, `&x`, `$x =: valeur` sont réécrits à la position
// que l'arbre leur donne, et rien d'autre ; une ligne qui commence par `####` ou par un nombre de `#` multiple de 3
// (bannière), une chaîne sur plusieurs lignes dont une ligne commence par `#` ou cite un `$x` y sont lues correctement ; le
// script d'un composant n'est compilé qu'une fois par Civet (l'arbre de sa compilation vérifie le texte du lexeur) ; un
// script que l'arbre ne lit pas sûrement reprend le balayeur des commentaires ou le lexeur seul, la raison relevée

import * as walk from 'acorn-walk'
import { readCode, toFile } from './code.js'
import { disguise, reservedLettersOf, RESERVED_LETTERS } from './disguise.js'
import { tokenize, type TokenizeOpts } from '../lexer/index.js'

// relevé des lectures (outil de comparaison, tests) : scripts lus par l'arbre, rendus au balayeur ou au lexeur seul après
// un essai de l'arbre (et la raison du dernier) ; raccourcis posés dans l'arbre de la compilation du script (retouches),
// ou repris par le lecteur (reprises, et la raison de la dernière)
export const scriptReadCounters = { tree: 0, reread: 0, last: null as string | null, patches: 0, retries: 0, lastRetry: null as string | null }

// une déclaration de type en tête de ligne (`type Point =`, `interface`, `declare`) : absente de l'arbre, comme ce qu'elle
// contient
const RE_TYPE_DECLARATION = /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:type|interface|namespace)[ \t]+[A-Za-z_$]/m

function reread(reason: string): null {
  scriptReadCounters.reread++
  scriptReadCounters.last = reason
  return null
}

// les commentaires d'un script, selon son chemin : `removed` pour le script d'un composant (removeComments les a ôtés,
// premier geste de sa lecture : il n'en reste aucun), `read` pour un script dont l'arbre lit les commentaires (repris quand la
// compilation lit un `#` comme du code), `scanner` pour les gestionnaires, les modules et les fichiers serveur (le balayeur
// de l'ancienne lecture, sans compilation de plus)
export type ScriptComments = 'removed' | 'read' | 'scanner'

// les commentaires `#` d'un script du dialecte (Civet) réécrits en commentaires JavaScript, aux positions que l'arbre lit ;
// null : le chemin `scanner`, ou un script que l'arbre ne lit pas sûrement (l'appelant prend alors le balayeur) ; un
// script sans commentaire (`removed`) reste tel quel, sans lecture : sa compilation refuse un `#` lu comme du code
// (RereadScript), hors d'une heregex `///…///`, où le balayeur lit les `#`
export function dialectComments(src: string, comments: ScriptComments = 'read'): string | null {
  // sans `#`, aucun commentaire à réécrire : le texte reste tel quel, sans lecture
  if (!src.includes('#')) {
    scriptReadCounters.tree++
    return src
  }
  if (comments === 'scanner') return null
  if (comments === 'removed') {
    if (src.includes('///')) return reread('heregex ///…///')
    scriptReadCounters.tree++
    return src
  }
  if (reservedLettersOf(src).length > 0) return reread('lettre réservée dans le script')
  // une heregex `///…///` : interpolée (`#{…}`), elle n'est plus un littéral de l'arbre, et ses commentaires `#` n'y sont
  // pas relevés ; la compilation finale, sans `coffeeInterpolation`, la lit autrement que le lecteur
  if (src.includes('///')) return reread('heregex ///…///')
  // une déclaration de type disparaît de l'arbre (compilation en JavaScript), ses commentaires avec elle : laissé tel quel,
  // un `#` y changeait `type Point =` en appel `type(…)` à la compilation finale
  if (RE_TYPE_DECLARATION.test(src)) return reread('déclaration de type')
  const code = readCode(src, 0, src.length, 'script', 'script.civet', false)
  if (code.error || !code.ast) return reread(`script que l'arbre ne lit pas : ${code.error?.message ?? 'aucun arbre'}`)
  // `#` vaut `.length` pour Civet : un `#` lu comme du code (bloc `### … ###` au milieu d'une ligne, ou suivi de code) est
  // un commentaire pour l'ancienne lecture
  let doubt: string | null = null
  walk.full(code.ast, (n: any) => {
    if (doubt) return
    // (la carte de Civet pose `this` sur le blanc d'avant : toFileIndex avance au premier caractère qui n'en est pas un)
    const length = n.type === 'ThisExpression' ? n : n.type === 'MemberExpression' && !n.computed && n.property.name === 'length' ? n.property : null
    if (length && src[toFile(code, src, length.loc.start) ?? -1] === '#') doubt = '`#` lu comme du code'
  })
  if (doubt) return reread(doubt)
  // le texte d'un commentaire, tel que Civet l'a lu, se compare au texte déguisé (déguisement à longueur égale)
  const disguised = disguise(src)
  const cuts: { start: number, end: number, text: string }[] = []
  for (const c of code.comments) {
    const p = toFile(code, src, c.loc.start)
    if (p === null) return reread('commentaire sans position')
    if (src[p] === '/') continue
    if (src[p] !== '#') return reread('commentaire à une position douteuse')
    if (c.type === 'Block') {
      const end = src.indexOf('###', p + 3)
      if (!src.startsWith('###', p) || end < 0) return reread('bloc ### sans fin lue')
      // un `*/` du contenu (motif de chemin `src/**/*.json`) refermerait le commentaire JavaScript
      cuts.push({ start: p, end: end + 3, text: '/*' + src.slice(p + 3, end).replace(/\*\//g, '*\\/') + '*/' })
      continue
    }
    // `#!` gardé tel quel, comme l'ancienne lecture
    if (src[p + 1] === '!') continue
    const eol = src.indexOf('\n', p)
    const end = eol < 0 ? src.length : eol
    if (c.value.trimEnd() !== disguised.slice(p + 1, end).trimEnd()) return reread('commentaire lu autrement')
    cuts.push({ start: p, end, text: '//' + src.slice(p + 1, end) })
  }
  cuts.sort((a, b) => a.start - b.start)
  let out = ''
  let pos = 0
  for (const k of cuts) {
    if (k.start < pos) return reread('commentaires qui se chevauchent')
    out += src.slice(pos, k.start) + k.text
    pos  = k.end
  }
  scriptReadCounters.tree++
  return out + src.slice(pos)
}

// ---------------------------------------------------------------- raccourcis `$x`, `&x`, `$x =: valeur`

// le lexeur posait `$.` devant un `$` suivi d'une lettre ASCII ou de `_` (`$prénom` → `$.prénom`) et `µ.url.params.` à la
// place d'un `&` suivi de même ; la partie ASCII du nom décide seule (`=:` qui la suit, entité nommée, nom importé)
const RE_STATE    = /^\$[a-zA-Z_]/
const RE_ASCII    = /^[a-zA-Z_][a-zA-Z0-9_]*/
const RE_FROZEN   = /[ \t]*=:[ \t]*/y
const ESPERLUETTE = RESERVED_LETTERS['&']

// le texte d'un script donné au langage, après les runes : le lexeur pose les autres raccourcis, puis une passe sur l'arbre
// de Civet pose `$x` → `$.x` (gardé tel quel dans un module ou pour un nom importé), `&x` → `µ.url.params.x` et
// `$x =: valeur` → `$.x = µ.snap valeur`, chacun à sa position ; un script que l'arbre ne lit pas, ou d'un autre langage
// que Civet, reprend le lexeur seul (l'ancienne lecture)
export function tokenizeScript(text: string, opts: TokenizeOpts = {}): string {
  if (opts.lang !== undefined && opts.lang !== 'civet') return tokenize(text, opts)
  return shortcutsFromTree(tokenize(text, { ...opts, shortcutsFromTree: true }), opts) ?? tokenize(text, opts)
}

// chaque nœud de l'arbre, dans l'ordre : acorn-walk ne visite ni la clé d'une propriété ou d'une méthode, ni un nom importé
// ou exporté, ni une étiquette, où le lexeur posait aussi `$.` (`{$x: 1}` refusé comme avant, jamais compilé autrement)
function eachNode(n: any, f: (n: any) => void): void {
  f(n)
  for (const key in n) {
    if (key === 'loc') continue
    const v = n[key]
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x.type === 'string') eachNode(x, f)
    }
    else if (v && typeof v === 'object' && typeof v.type === 'string') eachNode(v, f)
  }
}

// une écriture du texte : `debut`…`fin` remplacé par `texte`
interface Cut { start: number, end: number, text: string }

const writtenForm = (readName: string): string => readName.startsWith(ESPERLUETTE) ? '&' + readName.slice(1) : readName

// la réécriture du raccourci que le nom `nomLu` (lettre de `&` déguisée) écrit à la position `p` du texte : une coupe, rien
// (propriété `obj.$x`, nom gardé, `&` qui n'est pas un paramètre de route) ou un doute (sa raison)
function shorthandAt(text: string, p: number, readName: string, opts: TokenizeOpts): Cut | string | null {
  const state   = RE_STATE.test(readName)
  const written = writtenForm(readName)
  if (!text.startsWith(written, p)) return `raccourci ${written} à une position douteuse`
  // un second `$` dans le nom (`$a$b`) : le lexeur y voyait deux raccourcis
  const name  = readName.slice(1)
  const ascii = RE_ASCII.exec(name)?.[0]
  if (!ascii || name.includes('$')) return `raccourci ${written} lu autrement`
  if (state) {
    // `obj.$x` : une propriété ; après `..` ou `...` (plage, décomposition), la variable
    if (text[p - 1] === '.' && text[p - 2] !== '.') return null
    const guard = opts.moduleMode || (opts.externalVars ?? []).includes('$' + ascii)
    RE_FROZEN.lastIndex = p + 1 + ascii.length
    const frozen = ascii === name ? RE_FROZEN.exec(text) : null
    if (frozen) return { start: p, end: p + written.length + frozen[0].length, text: `${guard ? readName : '$.' + name} = µ.snap ` }
    return guard ? null : { start: p, end: p + 1, text: '$.' }
  }
  // `&x` : paramètre de route après un début, un blanc ou un ouvrant (`a & b`, `a&&b` restent des opérateurs), jamais une
  // entité nommée suivie de `;`
  const before = p > 0 ? text[p - 1] : ''
  const after  = text[p + 1 + ascii.length] ?? ''
  if ((before === '' || /[\s(\[{,=:;?]/.test(before)) && !(after === ';' && /^(?:amp|lt|gt|quot|apos|nbsp)$/i.test(ascii))) return { start: p, end: p + 1, text: 'µ.url.params.' }
  return null
}

function shortcutsFromTree(text: string, opts: TokenizeOpts): string | null {
  // sans `$` ni `&`, aucun raccourci à poser : le texte reste tel quel, sans lecture
  if (!text.includes('$') && !text.includes('&')) {
    scriptReadCounters.tree++
    return text
  }
  if (reservedLettersOf(text).length > 0) return reread('lettre réservée dans le script')
  // une heregex interpolée : le lecteur y lit `#{$x}` comme du code, la compilation finale comme du texte de la regex
  if (text.includes('///')) return reread('raccourcis : heregex ///…///')
  if (RE_TYPE_DECLARATION.test(text)) return reread('raccourcis : déclaration de type')
  const code = readCode(text, 0, text.length, 'script', 'script.civet', false)
  if (code.error || !code.ast) return reread(`raccourcis : script que l'arbre ne lit pas : ${code.error?.message ?? 'aucun arbre'}`)
  // une écriture par position : Civet recopie parfois un nom (`a ?= b`), la même écriture revient alors
  const cuts = new Map<number, { end: number, text: string }>()
  let doubt: string | null = null
  const cut = (start: number, end: number, fresh: string): void => {
    const already = cuts.get(start)
    if (already && (already.end !== end || already.text !== fresh)) doubt = 'deux écritures à la même position'
    cuts.set(start, { end, text: fresh })
  }
  eachNode(code.ast, (n: any) => {
    if (doubt || n.type !== 'Identifier' || !(RE_STATE.test(n.name) || n.name.startsWith(ESPERLUETTE))) return
    const p = toFile(code, text, n.loc.start)
    const r = p === null ? `raccourci ${writtenForm(n.name)} à une position douteuse` : shorthandAt(text, p, n.name, opts)
    if (typeof r === 'string') doubt = r
    else if (r) cut(r.start, r.end, r.text)
  })
  if (doubt) return reread(doubt)
  let out = ''
  let pos = 0
  for (const [start, k] of [...cuts].sort((a, b) => a[0] - b[0])) {
    if (start < pos) return reread('raccourcis qui se chevauchent')
    out += text.slice(pos, start) + k.text
    pos  = k.end
  }
  scriptReadCounters.tree++
  return out + text.slice(pos)
}

// ---------------------------------------------------------------- le script d'un composant, vérifié par l'arbre de sa compilation

// la compilation du script ne le lit pas comme l'ancienne lecture : l'appelant le relit par le lecteur (tokenizeScript) ;
// `commentaires` : un `#` lu comme du code, le sucre est relu, ses commentaires lus par l'arbre (dialectComments)
export class RereadScript extends Error {
  constructor(message: string, readonly comments = false) {
    super(message)
  }
}

// un `#` que la compilation lit comme du code (`.length`) ou comme un bloc `###` : un commentaire que removeComments
// n'a pas ôté (dans une interpolation `${…}`), le balayeur et l'arbre l'auraient réécrit
const HASH_READ_AS_CODE = '`#` lu comme du code par la compilation'

// un raccourci que le lexeur a écrit (`$.x`, `µ.url.params.x`, `$.x = µ.snap`) dans un jeton de l'arbre : pas du code (chaîne
// sur plusieurs lignes, ligne d'une heregex, que le lexeur lit comme du code) ; un nom de l'arbre ne porte jamais de point
const RE_WRITTEN_SHORTHAND   = /\$\.[A-Za-z_]|µ\.url\.params\.|µ\.snap\b/
const SHORTHAND_OUTSIDE_CODE = 'raccourci écrit par le lexeur hors du code (chaîne sur plusieurs lignes, heregex)'

// la vérification que la compilation d'un script de composant pose sur son arbre : Civet ne lit le script qu'une fois
export interface ScriptFixup {
  // noms que la retouche écrit en membres : aucun, le lexeur écrit les raccourcis comme l'ancienne lecture
  names: string[]
  // arbre de la première lecture, avant toute autre passe : un `#` lu comme du code, ou un raccourci écrit par le lexeur hors
  // du code, est refusé (RereadScript)
  check: (ast: unknown, text: string) => void
  // le texte auquel la carte de source se rapporte : celui du lexeur, inchangé
  fixup: (ast: unknown, text: string) => string
  // première lecture refusée par Civet : la reprise par le lecteur, qui rend l'erreur d'aujourd'hui
  reread: (e: unknown) => RereadScript
}

// le texte d'un script de composant donné au langage : celui de l'ancienne lecture (le lexeur écrit `$x` → `$.x`, `&x` →
// `µ.url.params.x`, `$x =: v` → `$.x = µ.snap v`), que Civet lit en membres comme avant : une plage, une comparaison
// chaînée, un motif, un choix d'objet gardent leur code ; quand l'arbre le lit, la vérification que sa compilation pose
export function prepareScript(text: string, opts: TokenizeOpts = {}): { text: string, tweak: ScriptFixup | null } {
  const read = tokenize(text, opts)
  if (opts.lang !== undefined && opts.lang !== 'civet') return { text: read, tweak: null }
  if (!read.includes('#') && !RE_WRITTEN_SHORTHAND.test(read)) {
    scriptReadCounters.tree++
    return { text: read, tweak: null }
  }
  return { text: read, tweak: scriptCheck() }
}

// compile un script préparé (prepareScript) : avec sa vérification ; refusée par l'arbre (RereadScript), le texte relu
// par le lecteur, compilé sans elle (le refus vient avant toute autre passe de l'adaptateur) ; pour un `#` lu comme du code,
// le sucre relu par `resucrer`, ses commentaires lus par l'arbre
export async function compilePreparedScript<R>(read: { text: string, tweak: ScriptFixup | null }, sugar: string, opts: TokenizeOpts, compiler: (text: string, tweak: ScriptFixup | null) => R | Promise<R>, resucrer?: () => string): Promise<R> {
  if (!read.tweak) return compiler(read.text, null)
  try {
    return await compiler(read.text, read.tweak)
  }
  catch (e) {
    if (!(e instanceof RereadScript)) throw e
    resume(e.message)
    return compiler(tokenizeScript(e.comments && resucrer ? resucrer() : sugar, opts), null)
  }
}

function resume(reason: string): void {
  scriptReadCounters.retries++
  scriptReadCounters.lastRetry = reason
}

function scriptCheck(): ScriptFixup {
  return {
    names: [],
    check: (ast, text) => {
      const doubt = treeDoubt(ast, text)
      if (doubt) throw new RereadScript(doubt, doubt === HASH_READ_AS_CODE)
    },
    fixup: (_ast, text) => {
      scriptReadCounters.tree++
      scriptReadCounters.patches++
      return text
    },
    reread: (e) => new RereadScript(`script que Civet ne lit pas : ${String((e as Error)?.message ?? e).split('\n')[0]}`),
  }
}

// parcourt l'arbre de Civet (objets et listes, une fois chacun ; le lien `parent` est sauté)
function walkCivetTree(ast: unknown, visit: (n: any) => void): void {
  const seen = new Set<object>()
  const descend = (n: any): void => {
    if (n === null || typeof n !== 'object' || seen.has(n)) return
    seen.add(n)
    if (Array.isArray(n)) {
      for (const c of n) descend(c)
      return
    }
    visit(n)
    for (const k of Object.keys(n)) if (k !== 'parent' && k !== '$loc') descend(n[k])
  }
  descend(ast)
}

// ce que l'arbre de la première lecture lit autrement que l'ancienne lecture : un `#` lu comme du code
// (HASH_READ_AS_CODE), un raccourci écrit par le lexeur dans un jeton qui n'est pas un nom (SHORTHAND_OUTSIDE_CODE) ;
// null sinon ; le `#` d'abord, où qu'il soit : sa reprise relit aussi les commentaires, celle d'un raccourci les laisse
function treeDoubt(ast: unknown, text: string): string | null {
  let hash      = false
  let shorthand = false
  walkCivetTree(ast, (n) => {
    if (hash) return
    if (n.type === undefined && typeof n.token === 'string' && n.$loc && text[n.$loc.pos] === '#' && n.token === 'length') hash = true
    else if (n.type === 'Comment' && n.$loc && text[n.$loc.pos] === '#') hash = true
    else if (n.type !== 'Identifier' && typeof n.token === 'string' && RE_WRITTEN_SHORTHAND.test(n.token)) shorthand = true
    else if (Array.isArray(n.children) && n.children.some((c: unknown) => typeof c === 'string' && RE_WRITTEN_SHORTHAND.test(c))) shorthand = true
  })
  return hash ? HASH_READ_AS_CODE : shorthand ? SHORTHAND_OUTSIDE_CODE : null
}
