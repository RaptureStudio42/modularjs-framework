// reader/script — le script lu par l'arbre (vrai Civet en mode `coffeeComment`, puis acorn) : les commentaires `#` du
// dialecte (`#` → `//`, `### … ###` → `/* … */`) et les raccourcis `$x`, `&x`, `$x =: valeur` sont réécrits à la position
// que l'arbre leur donne, et rien d'autre ; une ligne qui commence par `####` ou par un nombre de `#` multiple de 3
// (bannière), une chaîne sur plusieurs lignes dont une ligne commence par `#` ou cite un `$x` y sont lues justes ; le
// script d'un composant n'est compilé qu'une fois par Civet (l'arbre de sa compilation vérifie le texte du lexeur) ; un
// script que l'arbre ne lit pas sûrement reprend le balayeur des commentaires ou le lexeur seul, la raison relevée

import * as walk from 'acorn-walk'
import { lireCode, versLeFichier } from './code.js'
import { deguiser, lettresReserveesDe, LETTRES_RESERVEES } from './disguise.js'
import { tokenize, type TokenizeOpts } from '../lexer/index.js'

// relevé des lectures (outil de comparaison, tests) : scripts lus par l'arbre, rendus au balayeur ou au lexeur seul après
// un essai de l'arbre (et la raison du dernier) ; raccourcis posés dans l'arbre de la compilation du script (retouches),
// ou repris par le lecteur (reprises, et la raison de la dernière)
export const compteursLectureDuScript = { arbre: 0, relus: 0, derniere: null as string | null, retouches: 0, reprises: 0, derniereReprise: null as string | null }

// une déclaration de type en tête de ligne (`type Point =`, `interface`, `declare`) : absente de l'arbre, comme ce qu'elle
// contient
const RE_DECLARATION_DE_TYPE = /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:type|interface|namespace)[ \t]+[A-Za-z_$]/m

function relire(raison: string): null {
  compteursLectureDuScript.relus++
  compteursLectureDuScript.derniere = raison
  return null
}

// les commentaires d'un script, selon son chemin : `retires` pour le script d'un composant (retirerCommentaires les a ôtés,
// premier geste de sa lecture : il n'en reste aucun), `lus` pour un script dont l'arbre lit les commentaires (repris quand la
// compilation lit un `#` comme du code), `balayeur` pour les gestionnaires, les modules et les fichiers serveur (le balayeur
// de l'ancienne lecture, sans compilation de plus)
export type CommentairesDuScript = 'retires' | 'lus' | 'balayeur'

// les commentaires `#` d'un script du dialecte (Civet) réécrits en commentaires JavaScript, aux positions que l'arbre lit ;
// null : le chemin `balayeur`, ou un script que l'arbre ne lit pas sûrement (l'appelant prend alors le balayeur) ; un
// script sans commentaire (`retires`) reste tel quel, sans lecture : sa compilation refuse un `#` lu comme du code
// (RelireLeScript), hors d'une heregex `///…///`, où le balayeur lit les `#`
export function commentairesDuDialecte(src: string, commentaires: CommentairesDuScript = 'lus'): string | null {
  // sans `#`, aucun commentaire à réécrire : le texte reste tel quel, sans lecture
  if (!src.includes('#')) {
    compteursLectureDuScript.arbre++
    return src
  }
  if (commentaires === 'balayeur') return null
  if (commentaires === 'retires') {
    if (src.includes('///')) return relire('heregex ///…///')
    compteursLectureDuScript.arbre++
    return src
  }
  if (lettresReserveesDe(src).length > 0) return relire('lettre réservée dans le script')
  // une heregex `///…///` : interpolée (`#{…}`), elle n'est plus un littéral de l'arbre, et ses commentaires `#` n'y sont
  // pas relevés ; la compilation finale, sans `coffeeInterpolation`, la lit autrement que le lecteur
  if (src.includes('///')) return relire('heregex ///…///')
  // une déclaration de type disparaît de l'arbre (compilation en JavaScript), ses commentaires avec elle : laissé tel quel,
  // un `#` y changeait `type Point =` en appel `type(…)` à la compilation finale
  if (RE_DECLARATION_DE_TYPE.test(src)) return relire('déclaration de type')
  const code = lireCode(src, 0, src.length, 'script', 'script.civet', false)
  if (code.erreur || !code.ast) return relire(`script que l'arbre ne lit pas : ${code.erreur?.message ?? 'aucun arbre'}`)
  // `#` vaut `.length` pour Civet : un `#` lu comme du code (bloc `### … ###` au milieu d'une ligne, ou suivi de code) est
  // un commentaire pour l'ancienne lecture
  let doute: string | null = null
  walk.full(code.ast, (n: any) => {
    if (doute) return
    // (la carte de Civet pose `this` sur le blanc d'avant : versLeFichier avance au premier caractère qui n'en est pas un)
    const longueur = n.type === 'ThisExpression' ? n : n.type === 'MemberExpression' && !n.computed && n.property.name === 'length' ? n.property : null
    if (longueur && src[versLeFichier(code, src, longueur.loc.start) ?? -1] === '#') doute = '`#` lu comme du code'
  })
  if (doute) return relire(doute)
  // le texte d'un commentaire, tel que Civet l'a lu, se compare au texte déguisé (déguisement à longueur égale)
  const deguise = deguiser(src)
  const coupes: { debut: number, fin: number, texte: string }[] = []
  for (const c of code.commentaires) {
    const p = versLeFichier(code, src, c.loc.start)
    if (p === null) return relire('commentaire sans position')
    if (src[p] === '/') continue
    if (src[p] !== '#') return relire('commentaire à une position douteuse')
    if (c.type === 'Block') {
      const fin = src.indexOf('###', p + 3)
      if (!src.startsWith('###', p) || fin < 0) return relire('bloc ### sans fin lue')
      // un `*/` du contenu (motif de chemin `src/**/*.json`) refermerait le commentaire JavaScript
      coupes.push({ debut: p, fin: fin + 3, texte: '/*' + src.slice(p + 3, fin).replace(/\*\//g, '*\\/') + '*/' })
      continue
    }
    // `#!` gardé tel quel, comme l'ancienne lecture
    if (src[p + 1] === '!') continue
    const eol = src.indexOf('\n', p)
    const fin = eol < 0 ? src.length : eol
    if (c.value.trimEnd() !== deguise.slice(p + 1, fin).trimEnd()) return relire('commentaire lu autrement')
    coupes.push({ debut: p, fin, texte: '//' + src.slice(p + 1, fin) })
  }
  coupes.sort((a, b) => a.debut - b.debut)
  let out = ''
  let pos = 0
  for (const k of coupes) {
    if (k.debut < pos) return relire('commentaires qui se chevauchent')
    out += src.slice(pos, k.debut) + k.texte
    pos  = k.fin
  }
  compteursLectureDuScript.arbre++
  return out + src.slice(pos)
}

// ---------------------------------------------------------------- raccourcis `$x`, `&x`, `$x =: valeur`

// le lexeur posait `$.` devant un `$` suivi d'une lettre ASCII ou de `_` (`$prénom` → `$.prénom`) et `µ.url.params.` à la
// place d'un `&` suivi de même ; la partie ASCII du nom décide seule (`=:` qui la suit, entité nommée, nom importé)
const RE_ETAT     = /^\$[a-zA-Z_]/
const RE_ASCII    = /^[a-zA-Z_][a-zA-Z0-9_]*/
const RE_FIGE     = /[ \t]*=:[ \t]*/y
const ESPERLUETTE = LETTRES_RESERVEES['&']

// le texte d'un script donné au langage, après les runes : le lexeur pose les autres raccourcis, puis une passe sur l'arbre
// de Civet pose `$x` → `$.x` (gardé tel quel dans un module ou pour un nom importé), `&x` → `µ.url.params.x` et
// `$x =: valeur` → `$.x = µ.snap valeur`, chacun à sa position ; un script que l'arbre ne lit pas, ou d'un autre langage
// que Civet, reprend le lexeur seul (l'ancienne lecture)
export function tokenizeDuScript(texte: string, opts: TokenizeOpts = {}): string {
  if (opts.lang !== undefined && opts.lang !== 'civet') return tokenize(texte, opts)
  return raccourcisParLArbre(tokenize(texte, { ...opts, raccourcisParLArbre: true }), opts) ?? tokenize(texte, opts)
}

// chaque nœud de l'arbre, dans l'ordre : acorn-walk ne visite ni la clé d'une propriété ou d'une méthode, ni un nom importé
// ou exporté, ni une étiquette, où le lexeur posait aussi `$.` (`{$x: 1}` refusé comme avant, jamais compilé autrement)
function chaqueNoeud(n: any, f: (n: any) => void): void {
  f(n)
  for (const cle in n) {
    if (cle === 'loc') continue
    const v = n[cle]
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x.type === 'string') chaqueNoeud(x, f)
    }
    else if (v && typeof v === 'object' && typeof v.type === 'string') chaqueNoeud(v, f)
  }
}

// une écriture du texte : `debut`…`fin` remplacé par `texte`
interface Coupe { debut: number, fin: number, texte: string }

const ecritDe = (nomLu: string): string => nomLu.startsWith(ESPERLUETTE) ? '&' + nomLu.slice(1) : nomLu

// la réécriture du raccourci que le nom `nomLu` (lettre de `&` déguisée) écrit à la position `p` du texte : une coupe, rien
// (propriété `obj.$x`, nom gardé, `&` qui n'est pas un paramètre de route) ou un doute (sa raison)
function raccourciA(texte: string, p: number, nomLu: string, opts: TokenizeOpts): Coupe | string | null {
  const etat  = RE_ETAT.test(nomLu)
  const ecrit = ecritDe(nomLu)
  if (!texte.startsWith(ecrit, p)) return `raccourci ${ecrit} à une position douteuse`
  // un second `$` dans le nom (`$a$b`) : le lexeur y voyait deux raccourcis
  const nom   = nomLu.slice(1)
  const ascii = RE_ASCII.exec(nom)?.[0]
  if (!ascii || nom.includes('$')) return `raccourci ${ecrit} lu autrement`
  if (etat) {
    // `obj.$x` : une propriété ; après `..` ou `...` (plage, décomposition), la variable
    if (texte[p - 1] === '.' && texte[p - 2] !== '.') return null
    const garde = opts.moduleMode || (opts.externalVars ?? []).includes('$' + ascii)
    RE_FIGE.lastIndex = p + 1 + ascii.length
    const fige = ascii === nom ? RE_FIGE.exec(texte) : null
    if (fige) return { debut: p, fin: p + ecrit.length + fige[0].length, texte: `${garde ? nomLu : '$.' + nom} = µ.snap ` }
    return garde ? null : { debut: p, fin: p + 1, texte: '$.' }
  }
  // `&x` : paramètre de route après un début, un blanc ou un ouvrant (`a & b`, `a&&b` restent des opérateurs), jamais une
  // entité nommée suivie de `;`
  const avant = p > 0 ? texte[p - 1] : ''
  const apres = texte[p + 1 + ascii.length] ?? ''
  if ((avant === '' || /[\s(\[{,=:;?]/.test(avant)) && !(apres === ';' && /^(?:amp|lt|gt|quot|apos|nbsp)$/i.test(ascii))) return { debut: p, fin: p + 1, texte: 'µ.url.params.' }
  return null
}

function raccourcisParLArbre(texte: string, opts: TokenizeOpts): string | null {
  // sans `$` ni `&`, aucun raccourci à poser : le texte reste tel quel, sans lecture
  if (!texte.includes('$') && !texte.includes('&')) {
    compteursLectureDuScript.arbre++
    return texte
  }
  if (lettresReserveesDe(texte).length > 0) return relire('lettre réservée dans le script')
  // une heregex interpolée : le lecteur y lit `#{$x}` comme du code, la compilation finale comme du texte de la regex
  if (texte.includes('///')) return relire('raccourcis : heregex ///…///')
  if (RE_DECLARATION_DE_TYPE.test(texte)) return relire('raccourcis : déclaration de type')
  const code = lireCode(texte, 0, texte.length, 'script', 'script.civet', false)
  if (code.erreur || !code.ast) return relire(`raccourcis : script que l'arbre ne lit pas : ${code.erreur?.message ?? 'aucun arbre'}`)
  // une écriture par position : Civet recopie parfois un nom (`a ?= b`), la même écriture revient alors
  const coupes = new Map<number, { fin: number, texte: string }>()
  let doute: string | null = null
  const couper = (debut: number, fin: number, nouveau: string): void => {
    const deja = coupes.get(debut)
    if (deja && (deja.fin !== fin || deja.texte !== nouveau)) doute = 'deux écritures à la même position'
    coupes.set(debut, { fin, texte: nouveau })
  }
  chaqueNoeud(code.ast, (n: any) => {
    if (doute || n.type !== 'Identifier' || !(RE_ETAT.test(n.name) || n.name.startsWith(ESPERLUETTE))) return
    const p = versLeFichier(code, texte, n.loc.start)
    const r = p === null ? `raccourci ${ecritDe(n.name)} à une position douteuse` : raccourciA(texte, p, n.name, opts)
    if (typeof r === 'string') doute = r
    else if (r) couper(r.debut, r.fin, r.texte)
  })
  if (doute) return relire(doute)
  let out = ''
  let pos = 0
  for (const [debut, k] of [...coupes].sort((a, b) => a[0] - b[0])) {
    if (debut < pos) return relire('raccourcis qui se chevauchent')
    out += texte.slice(pos, debut) + k.texte
    pos  = k.fin
  }
  compteursLectureDuScript.arbre++
  return out + texte.slice(pos)
}

// ---------------------------------------------------------------- le script d'un composant, vérifié par l'arbre de sa compilation

// la compilation du script ne le lit pas comme l'ancienne lecture : l'appelant le relit par le lecteur (tokenizeDuScript) ;
// `commentaires` : un `#` lu comme du code, le sucre est relu, ses commentaires lus par l'arbre (commentairesDuDialecte)
export class RelireLeScript extends Error {
  constructor(message: string, readonly commentaires = false) {
    super(message)
  }
}

// un `#` que la compilation lit comme du code (`.length`) ou comme un bloc `###` : un commentaire que retirerCommentaires
// n'a pas ôté (dans une interpolation `${…}`), le balayeur et l'arbre l'auraient réécrit
const DIESE_LU_COMME_DU_CODE = '`#` lu comme du code par la compilation'

// un raccourci que le lexeur a écrit (`$.x`, `µ.url.params.x`, `$.x = µ.snap`) dans un jeton de l'arbre : pas du code (chaîne
// sur plusieurs lignes, ligne d'une heregex, que le lexeur lit comme du code) ; un nom de l'arbre ne porte jamais de point
const RE_RACCOURCI_ECRIT     = /\$\.[A-Za-z_]|µ\.url\.params\.|µ\.snap\b/
const RACCOURCI_HORS_DU_CODE = 'raccourci écrit par le lexeur hors du code (chaîne sur plusieurs lignes, heregex)'

// la vérification que la compilation d'un script de composant pose sur son arbre : Civet ne lit le script qu'une fois
export interface RetoucheDuScript {
  // noms que la retouche écrit en membres : aucun, le lexeur écrit les raccourcis comme l'ancienne lecture
  noms: string[]
  // arbre de la première lecture, avant toute autre passe : un `#` lu comme du code, ou un raccourci écrit par le lexeur hors
  // du code, est refusé (RelireLeScript)
  verifier: (ast: unknown, texte: string) => void
  // le texte auquel la carte de source se rapporte : celui du lexeur, inchangé
  retoucher: (ast: unknown, texte: string) => string
  // première lecture refusée par Civet : la reprise par le lecteur, qui rend l'erreur d'aujourd'hui
  relire: (e: unknown) => RelireLeScript
}

// le texte d'un script de composant donné au langage : celui de l'ancienne lecture (le lexeur écrit `$x` → `$.x`, `&x` →
// `µ.url.params.x`, `$x =: v` → `$.x = µ.snap v`), que Civet lit en membres comme avant : une plage, une comparaison
// chaînée, un motif, un choix d'objet gardent leur code ; quand l'arbre le lit, la vérification que sa compilation pose
export function preparerLeScript(texte: string, opts: TokenizeOpts = {}): { texte: string, retouche: RetoucheDuScript | null } {
  const lu = tokenize(texte, opts)
  if (opts.lang !== undefined && opts.lang !== 'civet') return { texte: lu, retouche: null }
  if (!lu.includes('#') && !RE_RACCOURCI_ECRIT.test(lu)) {
    compteursLectureDuScript.arbre++
    return { texte: lu, retouche: null }
  }
  return { texte: lu, retouche: verificationDuScript() }
}

// compile un script préparé (preparerLeScript) : avec sa vérification ; refusée par l'arbre (RelireLeScript), le texte relu
// par le lecteur, compilé sans elle (le refus vient avant toute autre passe de l'adaptateur) ; pour un `#` lu comme du code,
// le sucre relu par `resucrer`, ses commentaires lus par l'arbre
export async function compilerLeScriptPrepare<R>(lu: { texte: string, retouche: RetoucheDuScript | null }, sucre: string, opts: TokenizeOpts, compiler: (texte: string, retouche: RetoucheDuScript | null) => R | Promise<R>, resucrer?: () => string): Promise<R> {
  if (!lu.retouche) return compiler(lu.texte, null)
  try {
    return await compiler(lu.texte, lu.retouche)
  }
  catch (e) {
    if (!(e instanceof RelireLeScript)) throw e
    reprendre(e.message)
    return compiler(tokenizeDuScript(e.commentaires && resucrer ? resucrer() : sucre, opts), null)
  }
}

function reprendre(raison: string): void {
  compteursLectureDuScript.reprises++
  compteursLectureDuScript.derniereReprise = raison
}

function verificationDuScript(): RetoucheDuScript {
  return {
    noms: [],
    verifier: (ast, texte) => {
      const doute = douteDeLArbre(ast, texte)
      if (doute) throw new RelireLeScript(doute, doute === DIESE_LU_COMME_DU_CODE)
    },
    retoucher: (_ast, texte) => {
      compteursLectureDuScript.arbre++
      compteursLectureDuScript.retouches++
      return texte
    },
    relire: (e) => new RelireLeScript(`script que Civet ne lit pas : ${String((e as Error)?.message ?? e).split('\n')[0]}`),
  }
}

// parcourt l'arbre de Civet (objets et listes, une fois chacun ; le lien `parent` est sauté)
function parcourirArbreCivet(ast: unknown, visite: (n: any) => void): void {
  const vus = new Set<object>()
  const descendre = (n: any): void => {
    if (n === null || typeof n !== 'object' || vus.has(n)) return
    vus.add(n)
    if (Array.isArray(n)) {
      for (const c of n) descendre(c)
      return
    }
    visite(n)
    for (const k of Object.keys(n)) if (k !== 'parent' && k !== '$loc') descendre(n[k])
  }
  descendre(ast)
}

// ce que l'arbre de la première lecture lit autrement que l'ancienne lecture : un `#` lu comme du code
// (DIESE_LU_COMME_DU_CODE), un raccourci écrit par le lexeur dans un jeton qui n'est pas un nom (RACCOURCI_HORS_DU_CODE) ;
// null sinon ; le `#` d'abord, où qu'il soit : sa reprise relit aussi les commentaires, celle d'un raccourci les laisse
function douteDeLArbre(ast: unknown, texte: string): string | null {
  let diese     = false
  let raccourci = false
  parcourirArbreCivet(ast, (n) => {
    if (diese) return
    if (n.type === undefined && typeof n.token === 'string' && n.$loc && texte[n.$loc.pos] === '#' && n.token === 'length') diese = true
    else if (n.type === 'Comment' && n.$loc && texte[n.$loc.pos] === '#') diese = true
    else if (n.type !== 'Identifier' && typeof n.token === 'string' && RE_RACCOURCI_ECRIT.test(n.token)) raccourci = true
    else if (Array.isArray(n.children) && n.children.some((c: unknown) => typeof c === 'string' && RE_RACCOURCI_ECRIT.test(c))) raccourci = true
  })
  return diese ? DIESE_LU_COMME_DU_CODE : raccourci ? RACCOURCI_HORS_DU_CODE : null
}
