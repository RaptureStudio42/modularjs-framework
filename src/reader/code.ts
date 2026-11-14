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
import { deguiser, lettresPresentes, rendre, LETTRES_RESERVEES } from './disguise.js'
import type { Code, ModeCode, TexteDuCode } from './types.js'

const DIRECTIVE_CIVET  = '"civet coffeeComment coffeeInterpolation"\n'
const DIRECTIVE_COFFEE = '"civet coffeeComment coffeeInterpolation coffeeDiv"\n'
// un fichier CoffeeScript entier (fichier serveur, cli/server-entry.ts) : lu comme son compilateur, classes (`texte: ->`,
// `constructor: (@x) ->`), `for own`, `a ? b` et `::` compris
const DIRECTIVE_COFFEE_COMPAT = '"civet coffeeCompat"\n'
// un fichier `.civet` brut (cli/server-entry.ts) : Civet nu, comme son compilateur (`#` y est du code, `"#{x}"` une chaîne
// simple) ; une directive sans réglage tient la première ligne, et celle que l'auteur écrit en tête reste lue
const DIRECTIVE_CIVET_NU = '"civet"\n'

// CHOIX — taille du cache des compilations : les mêmes expressions reviennent d'un composant à l'autre (≈ 9 700
// compilations distinctes pour le site, les composants des tests et le cœur, 1 683 fichiers) ; au-delà, la plus ancienne part
const CACHE_MAX = 20000

// noms qui portent un raccourci de MJS (la lettre des directives exceptée : un appel `Ꜷimport(…)` est une directive)
const RE_NOM_MJS = new RegExp(`[$µ${LETTRES_RESERVEES['§']}${LETTRES_RESERVEES['@@']}${LETTRES_RESERVEES['#']}${LETTRES_RESERVEES['&']}]`)
const LETTRE_DIRECTIVE = LETTRES_RESERVEES['@import']

interface Compilation {
  js: string | null
  ast: acorn.Program | null
  commentaires: acorn.Comment[]
  trace: TraceMap | null
  erreur: { message: string, ligne: number, colonne: number, js: boolean } | null
}

const cache = new Map<string, Compilation>()

// acorn sans le refus d'un `export` d'un nom pas encore déclaré : le lecteur lit le code tel qu'écrit, la passe de
// déclaration (plus loin) déclare ce nom (`export { plus }` puis `plus = (x) -> x + 1`)
const Lecteur = acorn.Parser.extend((Base: any) => class extends Base {
  raiseRecoverable(pos: number, message: string): void {
    if (!/^Export '.*' is not defined$/.test(message)) super.raiseRecoverable(pos, message)
  }
} as any)

// relevé des lectures, pour l'outil de comparaison et les mesures
export const compteursCode = { compilations: 0, reprises: 0, civetMs: 0, acornMs: 0 }

export function viderCacheCode(): void {
  cache.clear()
  compteursCode.compilations = 0
  compteursCode.reprises     = 0
  compteursCode.civetMs      = 0
  compteursCode.acornMs      = 0
}

// Civet chargé en synchrone (CJS, `createRequire`) et paresseusement, comme generator/utils.ts
let civetCompile: ((source: string, options: Record<string, unknown>) => { code: string, sourceMap: { json: (source: string, sortie: string) => unknown } }) | null = null
function compilerCivet(source: string, options: Record<string, unknown>) {
  if (!civetCompile) civetCompile = createRequire(import.meta.url)('@danielx/civet').compile
  return civetCompile(source, options)
}

// le texte donné à Civet et, par ligne de ce texte, l'indice du fichier qui tombe sous sa colonne 0
// le retrait commun des lignes est retiré (sauf la première ligne d'une expression ou d'un gestionnaire, qui suit
// l'accolade) ; une expression est mise entre parenthèses, la parenthèse ouvrante posée juste avant le morceau
function preparer(source: string, debut: number, fin: number, mode: ModeCode, langue: string): { texte: string, bases: (number | null)[] } {
  const lignes = source.slice(debut, fin).split('\n')
  let retrait  = Infinity
  lignes.forEach((ligne, k) => {
    if ((mode !== 'script' && k === 0) || ligne.trim() === '') return
    retrait = Math.min(retrait, /^[ \t]*/.exec(ligne)[0].length)
  })
  if (retrait === Infinity) retrait = 0
  const bases: (number | null)[] = [null]
  const morceaux: string[] = []
  let pos = debut
  lignes.forEach((ligne, k) => {
    const coupe = (mode !== 'script' && k === 0) ? 0 : Math.min(retrait, /^[ \t]*/.exec(ligne)[0].length)
    let texte   = ligne.slice(coupe)
    let base    = pos + coupe
    if (k === 0 && mode === 'expression') {
      texte = '(' + texte
      base -= 1
    }
    morceaux.push(texte)
    bases.push(base)
    pos += ligne.length + 1
  })
  if (mode === 'expression') morceaux[morceaux.length - 1] += '\n)'
  return { texte: (langue === 'coffee' ? DIRECTIVE_COFFEE : langue === 'coffee-compat' ? DIRECTIVE_COFFEE_COMPAT : langue === 'civet-nu' ? DIRECTIVE_CIVET_NU : DIRECTIVE_CIVET) + deguiser(morceaux.join('\n')), bases }
}

// première ligne du message, sans le préfixe `fichier:ligne:colonne` de Civet ni le `(ligne:colonne)` d'acorn
function premiereLigne(message: string): string {
  return message.split('\n')[0].replace(/^\S*:\d+:\d+\s*/, '').replace(/\s*\(\d+:\d+\)$/, '')
}

function compiler(texte: string, nom: string, garder = true): Compilation {
  const vu = cache.get(texte)
  if (vu) {
    compteursCode.reprises++
    return vu
  }
  const r: Compilation = { js: null, ast: null, commentaires: [], trace: null, erreur: null }
  const t0 = performance.now()
  try {
    const sortie = compilerCivet(texte, { js: true, sync: true, sourceMap: true, filename: nom })
    r.js    = sortie.code
    r.trace = new TraceMap(sortie.sourceMap.json(nom, nom + '.js') as ConstructorParameters<typeof TraceMap>[0])
  }
  catch (e) {
    const err = e as { message?: string, line?: number, column?: number }
    r.erreur  = { message: premiereLigne(String(err.message ?? e)), ligne: err.line ?? 1, colonne: err.column ?? 1, js: false }
  }
  compteursCode.compilations++
  compteursCode.civetMs += performance.now() - t0
  if (r.js !== null) {
    const t1 = performance.now()
    try {
      r.ast = Lecteur.parse(r.js, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: r.commentaires, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
    }
    catch (e) {
      const err = e as { message?: string, loc?: { line: number, column: number } }
      r.erreur  = { message: premiereLigne(String(err.message ?? e)), ligne: err.loc?.line ?? 1, colonne: err.loc?.column ?? 0, js: true }
    }
    compteursCode.acornMs += performance.now() - t1
  }
  if (!garder) return r
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(texte, r)
  return r
}

// indice du fichier d'une position (ligne à partir de 1, colonne à partir de 0) du JavaScript produit pour ce code
// la carte de Civet pose certains jetons sur le blanc qui les précède (`µemit 'x'`) : `sauterBlancs` avance au
// premier caractère qui n'est pas un blanc de la même ligne
export function versLeFichier(code: Code, source: string, loc: { line: number, column: number }, sauterBlancs = true): number | null {
  if (!code.carte) return null
  const o = originalPositionFor(code.carte.trace, { line: loc.line, column: loc.column })
  if (o.line === null) return null
  const base = code.carte.bases[o.line - 1]
  if (base === null || base === undefined) return null
  let p = base + o.column
  if (sauterBlancs) while (source[p] === ' ' || source[p] === '\t') p++
  return p
}

// lit un morceau de code du fichier ; `source` est la source normalisée du fichier
// `garder` faux : la compilation ne rejoint pas le cache (un script entier, relu une fois par compilation, y garderait
// son arbre et sa carte à chaque modification) ; `langue` : celle du morceau (`coffee` pour du CoffeeScript, Civet sinon ;
// `coffee-compat` pour un fichier CoffeeScript entier, `civet-nu` pour un fichier `.civet` brut)
export function lireCode(source: string, debut: number, fin: number, mode: ModeCode, nom: string, garder = true, langue = 'civet'): Code {
  const prep = preparer(source, debut, fin, mode, langue)
  const r    = compiler(prep.texte, nom, garder)
  const code: Code = {
    sorte: 'code', mode, debut, fin, js: r.js, ast: r.ast, commentaires: r.commentaires, textes: [], noms: [], directives: [], erreur: null,
    carte: r.trace ? { bases: prep.bases, trace: r.trace } : null,
  }
  if (r.erreur) {
    let pos: number | null = null
    if (r.erreur.js) pos = versLeFichier(code, source, { line: r.erreur.ligne, column: r.erreur.colonne }, false)
    else {
      const base = prep.bases[r.erreur.ligne - 1]
      if (base !== null && base !== undefined) pos = base + r.erreur.colonne - 1
      else if (r.erreur.ligne > 1) pos = fin
    }
    code.erreur = { message: rendre(r.erreur.message), debut: pos === null ? debut : Math.min(Math.max(pos, debut), fin) }
    return code
  }
  const texte = (sorte: TexteDuCode['sorte'], valeur: string, brut: string, loc: { line: number, column: number }) => {
    code.textes.push({ sorte, valeur: rendre(valeur, lettresPresentes(brut)), debut: versLeFichier(code, source, loc) })
  }
  walk.full(r.ast, (n: acorn.Node & Record<string, any>) => {
    if (n.type === 'Literal' && typeof n.value === 'string') texte('chaine', n.value, n.raw ?? '', n.loc.start)
    else if (n.type === 'Literal' && n.regex) texte('regex', n.regex.pattern, n.regex.pattern, n.loc.start)
    else if (n.type === 'TemplateElement') texte('gabarit', n.value.cooked ?? n.value.raw, n.value.raw, n.loc.start)
    else if (n.type === 'Identifier' && RE_NOM_MJS.test(n.name)) code.noms.push({ nom: rendre(n.name), debut: versLeFichier(code, source, n.loc.start) })
    else if (n.type === 'PrivateIdentifier') code.noms.push({ nom: '#' + n.name, debut: versLeFichier(code, source, n.loc.start) })
    else if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name.startsWith(LETTRE_DIRECTIVE)) code.directives.push({ nom: '@' + n.callee.name.slice(1), debut: versLeFichier(code, source, n.loc.start) })
  })
  for (const c of r.commentaires) texte('commentaire', c.value, c.value, c.loc.start)
  return code
}

// un texte entier (directive comprise) compilé par Civet puis lu par acorn, par le même cache : les expressions du gabarit
// lues pour le générateur (reader/expression.ts)
export function compilerTexte(texte: string, nom: string): Compilation {
  return compiler(texte, nom)
}
