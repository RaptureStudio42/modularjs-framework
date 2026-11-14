// reader — le lecteur unique d'un fichier .mjs : un seul arbre pour tout le fichier
// le gabarit, les sections et les directives de racine sont lus ici ; chaque morceau de code (script, expression
// `{…}`, gestionnaire `@click={…}`) est lu par le vrai Civet puis par acorn (reader/code.ts), avec la position de
// chaque nœud dans le fichier. Le compilateur lit le gabarit d'un composant par ce lecteur (option `gabarit`,
// parser/index.ts : lireParLArbre) ; l'outil script/compare-lecteur.ts compare ses passes à celles d'aujourd'hui sur
// tout un corpus.

import { AT_RESERVED_NAMES, Scanner, extractBalanced, extractSettings } from '../parser/index.js'
import { SIGN_RE } from '../parser/mjs-words.js'
import { bornesDesSections, type BorneDeSection } from '../transpiler/sections.js'
import { lireCode } from './code.js'
import { lettresReserveesDe, messageLettreReservee } from './disguise.js'
import { debutsDeLigne, situer } from './positions.js'
import type { AttributDeBalise, Balise, Bloc, Branche, Code, Diagnostic, Fichier, FormeBalise, ModeCode, Noeud, Script, Section, Style } from './types.js'

export * from './types.js'
export { debutsDeLigne, situer, positionDe, formaterPosition } from './positions.js'
export { deguiser, rendre, LETTRES_RESERVEES } from './disguise.js'
export { compteursCode, viderCacheCode, versLeFichier } from './code.js'

export interface OptionsDeLecture {
  fichier?: string                      // chemin, repris dans chaque position (`fichier:ligne:colonne`)
  langue?: string                       // langue d'un script sans `lang`, ou d'un module (civet par défaut)
  module?: boolean                      // fichier sans gabarit, un seul script ; par défaut : `.civet` et `*.server.mjs`
  // le gabarit seul, tel que le compilateur le prépare (sections retirées, directives lues, partiels versés) : ni
  // section ni directive, le texte lu tel quel (positions de ce texte), le code découpé par la lecture du compilateur
  // (extractBalanced) sans être compilé
  gabarit?: boolean
  // gabarit seul : son code est du Civet ou du CoffeeScript (`languages.template` hors `js`), où une regex se passe aussi sans
  // parenthèses (`$v.replace /}/g, ''`) — la lecture du compilateur la lit alors de même (Scanner.dialecte)
  dialecte?: boolean
  // false : sections et directives lues comme d'habitude, le code découpé sans être compilé (relevés qui ne lisent que
  // les balises et leurs attributs, transpiler/template-tree.ts) ; seule une accolade que la découpe faite main ne ferme
  // pas essaie encore ses fins par Civet (finDeCode)
  compiler?: boolean
  // false : une ligne de racine en `@` est un texte, jamais une directive (relevés des balises, transpiler/template-tree.ts) ; le
  // compilateur ne prend pour directive que ses mots (`@import`, `@persist`…), une ligne de prose `@nom <@@img …>` reste du gabarit
  directives?: boolean
  // gabarit seul, ses partiels pas encore versés (le compilateur y cherche les `<@include>`) : `<@include x>` n'a pas
  // d'enfants, comme dans un fichier entier
  partiels?: boolean
}

const VIDES      = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
// comme l'extraction des sections du compilateur (transpiler/sections.ts) : `<theme-toggle>`, `<effects-demo>`, `<vars/>` sont des
// balises du gabarit, pas des sections
const BRUTES     = /^<(script|style|(?:theme|routes|vars|types|effects)(?=[\s>]))\b/i
const BALISE     = /^<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/
const FERMANTE   = /^<\/([a-zA-Z0-9\-@]+)\s*>/
const NOM_ATTR   = /^[a-zA-Z0-9:@\-._]+/
const EFFET      = /^\*([A-Za-z][\w-]*(?:\.[\w.-]*)?)/
// classe ou style conditionnels, avec le signe des mots de MJS (`:class{…}=…`, `:style.prop{…}=…`)
const MOT_CLASSE = new RegExp('^' + SIGN_RE + String.raw`(class|style\.[a-zA-Z0-9-]+)\{`)
// `{await.keep …}` : un {await} dont l'option s'écrit sur le mot du bloc (cf. parser/index.ts, AWAIT_GARDE) ; son expression commence après le mot
const BLOCS      = /^(if|elsif|for|await(?:\.keep)?|success|error|key|const)\s+/
const ATTR_GESTE = /^@(?!class|style|in\b|out\b|transition|title)/
// éléments HTML à texte brut (cf. server/prerender.ts) : le navigateur ne lit aucune balise dans leur contenu
const TEXTE_BRUT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'])
// un commentaire HTML : jusqu'à `-->` ou `--!>`, `<!-->` et `<!--->` refermés d'emblée (comme le navigateur)
const COMMENTAIRE = /<!--(?:-?>|[\s\S]*?--!?>)/y
// dans un <textarea> ou un <title>, une balise écrite est un texte, jusqu'à son `>`
const BALISE_TEXTE = /<\/?[^<>]*>?/y
const LANGUES_LUES = new Set(['civet', 'coffee'])
// CHOIX — `}` essayées au plus quand la découpe faite main d'une région de code échoue
const ESSAIS_DE_FIN = 50
// gabarit seul : où le compilateur commence la lecture d'une accolade (parser/index.ts, extractBalanced) — après le mot d'un bloc
// et ses blancs, après `{const nom =` ; `{/if}` et ses pareils, qu'il refuse sans les lire
const MOT_DE_BLOC     = /\{(?:await(?:\.keep)?|success|error|if|elsif|key|for)\s+|\{const\s+(?:[a-zA-Z_$][a-zA-Z0-9_$]*\s*=(?![=>])\s*)?/y
const FERMETURE_SLASH = /\{\/(?:if|for|each|await|key)\}/y
// une ouvrante de section comme les cherche le compilateur, où qu'elle soit : un fichier qui n'en a aucune n'a aucune section
const OUVRANTE_DE_SECTION = /<(?:script|style|theme|routes|vars|types|effects)/

// ---------------------------------------------------------------- découpe des régions de code du gabarit

// fin d'une chaîne qui commence en i (guillemet compris) ; les interpolations `#{…}` et `${…}` sont des régions de code
function finChaine(src: string, i: number): number {
  const q = src[i]
  if (src.startsWith(q + q + q, i)) {
    const e = src.indexOf(q + q + q, i + 3)
    return e < 0 ? -1 : e + 3
  }
  i++
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === q) return i + 1
    if ((q === '"' && c === '#' && src[i + 1] === '{') || (q === '`' && c === '$' && src[i + 1] === '{')) {
      const e = finRegion(src, i + 2, '}')
      if (e < 0) return -1
      i = e + 1
      continue
    }
    i++
  }
  return -1
}

// indice du caractère fermant (`}` ou `)`) d'une région de code qui commence en i ; -1 si elle ne se referme pas
// découpe faite main du fichier entier : le contenu est ensuite lu par le vrai Civet, qui refuse une découpe fausse (jamais
// en silence) ; le gabarit seul, dont le code n'est pas compilé ici, est découpé par la lecture du compilateur (finCompilee)
export function finRegion(src: string, i: number, fermant: '}' | ')'): number {
  const ouvrant = fermant === '}' ? '{' : '('
  let prof = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\'' || c === '"' || c === '`') {
      const e = finChaine(src, i)
      if (e < 0) return -1
      i = e
      continue
    }
    if (c === '#' && src.startsWith('###', i)) {
      const e = src.indexOf('###', i + 3)
      if (e < 0) return -1
      i = e + 3
      continue
    }
    // commentaire de ligne : jusqu'à la fin de la ligne, ou jusqu'au fermant de la région (`{$x // note}`, comme le lecteur d'aujourd'hui)
    if ((c === '#' && /[ \t#]/.test(src[i + 1] ?? ' ')) || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n' && !(src[i] === fermant && prof === 0)) i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      if (e < 0) return -1
      i = e + 2
      continue
    }
    if (c === ouvrant) prof++
    else if (c === fermant) {
      if (prof === 0) return i
      prof--
    }
    i++
  }
  return -1
}

function formeDe(nom: string): FormeBalise {
  const bas = nom.toLowerCase()
  if (nom.startsWith('@@')) return 'coeur'
  if (nom.startsWith('@')) return AT_RESERVED_NAMES.includes(nom.slice(1)) ? 'reservee' : 'projet'
  if (bas.startsWith('mjs-core-')) return 'coeur-litteral'
  if (bas.startsWith('mjs-')) return 'mjs'
  return 'html'
}

// le nom d'une balise dans le gabarit compilé (`<@x>` → `mjs-x`, `<@@x>` → `mjs-core-x`, `<@view>` → `metamjs-view`,
// `<@slot>` → `slot`) : une fermante referme sa balise sous l'un ou l'autre nom, casse comprise, comme le compilateur
function nomCompile(nom: string): string {
  if (nom === '@view') return 'metamjs-view'
  if (nom === '@slot') return 'slot'
  if (nom.startsWith('@@')) return 'mjs-core-' + nom.slice(2)
  if (nom.startsWith('@')) return AT_RESERVED_NAMES.includes(nom.slice(1)) ? nom : 'mjs-' + nom.slice(nom.startsWith('@mjs-') ? 5 : 1)
  return nom
}

// un code découpé sans être compilé (gabarit lu pour le compilateur)
function codeNonCompile(debut: number, fin: number, mode: ModeCode): Code {
  return { sorte: 'code', mode, debut, fin, js: null, ast: null, commentaires: [], textes: [], noms: [], directives: [], erreur: null, carte: null }
}

// ---------------------------------------------------------------- le fichier

// lit un fichier .mjs (ou un module `.civet`, `*.server.mjs`) en un arbre ; ne lève jamais : chaque faute de lecture
// est un diagnostic, à sa position
export function lireFichier(texte: string, options: OptionsDeLecture = {}): Fichier {
  const gabarit = options.gabarit === true
  const src     = gabarit ? texte : texte.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const chemin  = options.fichier ?? 'inline.mjs'
  const langue  = options.langue ?? 'civet'
  const fichier: Fichier = { sorte: 'fichier', chemin, source: src, debutsDeLigne: debutsDeLigne(src), debut: 0, fin: src.length, enfants: [], codes: [], diagnostics: [] }
  const faute   = (message: string, debut: number, guillemet?: Diagnostic['guillemet']): void => {
    const { ligne, colonne } = situer(fichier.debutsDeLigne, debut)
    const d: Diagnostic = { message, debut, ligne, colonne, position: `${chemin}:${ligne}:${colonne}` }
    if (guillemet !== undefined) d.guillemet = guillemet
    fichier.diagnostics.push(d)
  }
  if (!gabarit) for (const i of lettresReserveesDe(src)) faute(messageLettreReservee(src[i]), i)
  // le texte où se lit le code : le fichier, ou le gabarit relu sans les sections que le compilateur lit hors de la lecture (plus bas)
  let texteDuCode = src
  const code = (debut: number, fin: number, mode: ModeCode, langueDuCode?: string): Code => {
    if (gabarit || options.compiler === false) {
      const decoupe = codeNonCompile(debut, fin, mode)
      fichier.codes.push(decoupe)
      return decoupe
    }
    const lu = lireCode(texteDuCode, debut, fin, mode, chemin, true, langueDuCode)
    fichier.codes.push(lu)
    if (lu.erreur) {
      const quoi = mode === 'script' ? 'ce script' : mode === 'gestionnaire' ? 'ce gestionnaire' : 'cette expression'
      faute(lu.js === null ? `Civet ne lit pas ${quoi} : ${lu.erreur.message}` : `le JavaScript produit pour ${quoi} ne se lit pas : ${lu.erreur.message}`, lu.erreur.debut)
    }
    return lu
  }
  if (!gabarit && (options.module ?? /\.(civet|civet\.mjs|server\.mjs)$/.test(chemin))) {
    const script: Script = { sorte: 'script', debut: 0, fin: src.length, langue, module: true, attributs: '', corps: { debut: 0, fin: src.length }, code: null, nonLu: null }
    script.code = code(0, src.length, 'script', langue)
    fichier.enfants.push(script)
    return fichier
  }
  const lues = { bornes: null as BornesLues | null }
  const deja = fichier.diagnostics.length
  const lire = (texte: string): BorneDeSection[] => lireGabarit(texte, fichier, langue, gabarit, options.dialecte === true, options.directives !== false, faute, code, options.partiels === true, lues)
  // une section que le compilateur lit là où le lecteur ne s'arrête pas (dans une valeur d'attribut, une expression `{…}`, un
  // <![CDATA[) : il la retire du gabarit avant de le lire ; le gabarit est relu sans elle, blanchie à longueur égale, la première
  // manquée d'abord (une section manquée peut n'être que la suite d'une autre, lue de travers avant elle)
  const blanchies: BorneDeSection[] = []
  for (let manquees = lire(src); ;) {
    const premiere = manquees.find(b => !blanchies.includes(b))
    if (premiere === undefined) break
    blanchies.push(premiere)
    fichier.enfants.length     = 0
    fichier.codes.length       = 0
    fichier.diagnostics.length = deja
    texteDuCode = sansSections(src, blanchies)
    manquees    = lire(texteDuCode)
  }
  return fichier
}

type Ouvert = Fichier | Balise | Bloc

// les sections que le compilateur lit dans un fichier (bornesDesSections), par position de leur `<`, et ses blocs <@head> / <@failed>
interface BornesLues {
  sections: Map<number, BorneDeSection>
  blocs:    Array<[number, number]>
}

// le texte où chaque section donnée est blanchie à longueur égale, sauts de ligne gardés
function sansSections(src: string, sections: BorneDeSection[]): string {
  let out = ''
  let cur = 0
  for (const s of [...sections].sort((a, b) => a.debut - b.debut)) {
    if (s.debut < cur) continue
    out += src.slice(cur, s.debut) + src.slice(s.debut, s.fin).replace(/[^\n]/g, ' ')
    cur  = s.fin
  }
  return out + src.slice(cur)
}

// lit le gabarit de `src` dans `fichier` ; rend les sections que le compilateur lit et que cette lecture n'a pas posées (dans une valeur
// d'attribut, une expression `{…}`, un <![CDATA[), hors de celles qu'une autre contient (un <script module> écrit dans un <script>,
// lu avec lui). `lues` : les sections du compilateur, cherchées une fois dans le texte reçu par lireFichier
function lireGabarit(src: string, fichier: Fichier, langue: string, gabarit: boolean, dialecte: boolean, directives: boolean, faute: (message: string, debut: number, guillemet?: Diagnostic['guillemet']) => void, code: (debut: number, fin: number, mode: ModeCode, langueDuCode?: string) => Code, partiels: boolean, lues: { bornes: BornesLues | null }): BorneDeSection[] {
  const pile: Ouvert[] = [fichier]                // éléments et blocs ouverts
  // le guillemet d'une valeur d'attribut jamais refermé (lireValeur) : la balise qui le porte n'est jamais terminée
  let guillemetSansFin: Diagnostic['guillemet']
  // la fin du dernier texte lu jusqu'au prochain `<` ou `{` : une fermante dont le nom ne commence pas par une lettre (`</3>`,
  // `</-a>`) écrite là est lue dans ce texte, comme le compilateur lit la suite de caractères d'un texte (TEXT_RUN_RE), et part
  // telle quelle dans le gabarit compilé, où le navigateur en fait un commentaire (aucune balise, aucun texte affiché) ; en tête
  // d'un nœud, elle reste une fermante
  let finTexte = -1
  // les éléments à texte brut ouverts hors d'un dessin (TEXTE_BRUT) : une balise écrite dans leur contenu n'en est pas une
  // pour le navigateur, un guillemet jamais refermé dans ses attributs non plus
  const textesBruts  = new Set<Balise>()
  const dansTexteBrut = (): boolean => pile.some((o) => o.sorte === 'balise' && textesBruts.has(o))
  const listes = new Map<Balise, Noeud[]>()        // la liste où chaque balise qui peut être rendue vide a été posée
  const ouvert  = (): Ouvert => pile[pile.length - 1]
  const enfants = (): Noeud[] => {
    const o = ouvert()
    return o.sorte === 'bloc' ? o.branches[o.branches.length - 1].enfants : o.enfants
  }
  const poser = <N extends Noeud>(n: N): N => {
    enfants().push(n)
    return n
  }
  const enTeteDeLigne = (i: number): boolean => /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))
  // fin d'une balise ouvrante de section (guillemets sautés)
  const finOuvrante = (i: number): number => {
    let q = ''
    for (; i < src.length; i++) {
      const c = src[i]
      if (q) {
        if (c === q) q = ''
      }
      else if (c === '"' || c === '\'') q = c
      else if (c === '>') return i
    }
    return -1
  }
  // le contenu étranger qui entoure la position (`svg`, `math`), null en HTML : un <foreignObject> rouvre du HTML
  const etranger = (): string | null => {
    for (let k = pile.length - 1; k > 0; k--) {
      const o = pile[k]
      if (o.sorte !== 'balise') continue
      const bas = o.nom.toLowerCase()
      if (bas === 'svg' || bas === 'math') return bas
      if (bas === 'foreignobject') return null
    }
    return null
  }
  // une balise raccourci (`<@x>`, `<@@x>`) ; dans le fichier brut, toute balise `@` (les macros `<@window>`, `<@body>` s'y
  // écrivent sans fermante, le compilateur les lit avant le gabarit)
  const raccourci = (n: Ouvert): n is Balise => n.sorte === 'balise' && (gabarit ? n.forme === 'projet' || n.forme === 'coeur' : n.nom.startsWith('@'))
  // une balise rendue vide en `a` (la fermante d'un ancêtre, un jeton de bloc, la fin du texte) : son contenu revient à la
  // liste qui la porte, juste après elle. Les balises sont rendues vides du haut de la pile vers le bas, et celle du
  // dessus est toujours le dernier enfant de celle du dessous : le contenu de chacune attend, puis le tout est versé d'un
  // coup dans la liste qui porte la plus basse (verser), chaque nœud déplacé une seule fois. Recopié à chaque niveau, le
  // contenu de 20 000 balises raccourci non refermées remplissait le tas
  const attente: Noeud[][] = []
  let porteuse: Noeud[] | null = null
  const vider = (n: Balise, a: number): void => {
    porteuse = listes.get(n)!
    listes.delete(n)
    attente.push(n.enfants)
    n.enfants = []
    n.vide    = true
    n.videeA  = a
  }
  // à la première balise qui n'est pas rendue vide, et à la fin de chaque balayage ; les anciennes listes, vidées, ne
  // gardent plus rien
  const verser = (): void => {
    for (let k = attente.length - 1; k >= 0; k--) {
      for (const n of attente[k]) porteuse!.push(n)
      attente[k].length = 0
    }
    attente.length = 0
    porteuse = null
  }
  // balise raccourci jamais refermée : rendue vide
  const viderRaccourci = (n: Ouvert, a: number): boolean => {
    if (!raccourci(n)) return false
    vider(n, a)
    return true
  }
  const referme = (n: Ouvert, ecrit: string): boolean => n.sorte === 'balise' && (ecrit === n.nom || ecrit === nomCompile(n.nom))
  const pasRefermeAvant = (n: Bloc, fermante: string): string => `le bloc {${n.nom}} n'est pas refermé avant </${fermante}> : ajoutez {end}`
  // gabarit seul : la fin d'une région de code, lue par le compilateur lui-même (extractBalanced, ou extractSettings pour
  // les réglages d'un effet) depuis le caractère où il la commence : regex, chaînes, commentaires `#`, `###`, `//` et
  // `/* */` compris, la regex d'une tête de bloc (`{if /}/.test($s)}`) comme l'accolade d'un commentaire
  // (`{$a ### } ###}`) ; l'indice du fermant, -1 s'il manque (le parseur en donne le message, cf. lireParLArbre)
  const compilateur = gabarit ? new Scanner(src, 1, dialecte) : null
  const finCompilee = (i: number, reglages = false): number => {
    const lecteur = compilateur!
    lecteur.pos = i
    try {
      if (reglages) extractSettings(lecteur)
      else extractBalanced(lecteur, '}')
    }
    catch {
      return -1
    }
    return lecteur.pos - 1
  }
  // gabarit seul : fin d'une accolade du texte qui s'ouvre en i, lue depuis là où le compilateur commence la sienne
  const finAccolade = (i: number, brut: boolean): number => {
    if (brut) return finCompilee(i + 2)
    FERMETURE_SLASH.lastIndex = i
    const f = FERMETURE_SLASH.exec(src)
    if (f) return i + f[0].length - 1
    MOT_DE_BLOC.lastIndex = i
    const m = MOT_DE_BLOC.exec(src)
    return finCompilee(i + (m ? m[0].length : 1))
  }
  // fin d'une région de code `{…}` qui commence en i : dans le gabarit seul, celle du compilateur ; ailleurs la découpe
  // faite main, et quand elle échoue, chaque `}` qui suit est essayée dans l'ordre et la première dont Civet lit le
  // contenu est retenue (regex d'un appel sans parenthèses : `@click={ $v = $v.replace /'/g, '' }`) ; aucune : la faute
  // de la découpe faite main
  const finDeCode = (i: number, mode: ModeCode): number => {
    if (gabarit) return finCompilee(i)
    const e = finRegion(src, i, '}')
    if (e >= 0) return e
    let k = i
    for (let n = 0; n < ESSAIS_DE_FIN; n++) {
      k = src.indexOf('}', k)
      if (k < 0) break
      if (!lireCode(src, i, k, mode, fichier.chemin).erreur) return k
      k++
    }
    return -1
  }
  // les sections du fichier et ses blocs <@head> / <@failed>, lus par le compilateur (bornesDesSections) dans le texte reçu par
  // lireFichier, cherchés à la première ouvrante de section brute
  const lesBornes = (): BornesLues => {
    if (lues.bornes === null) {
      const b = bornesDesSections(src, langue)
      lues.bornes = { sections: new Map(b.sections.map(x => [x.debut, x])), blocs: b.blocs }
    }
    return lues.bornes
  }
  // les sections posées par cette lecture, par position
  const posees = new Set<number>()
  // contenu de la section brute `nom` ouverte en i et fin de sa fermante : celles du compilateur ; dans un bloc <@head> / <@failed>,
  // qu'il émet tel quel, un <script> ou un <style> se lit jusqu'à sa première fermante exacte dans le bloc, et n'est qu'une balise
  // s'il est auto-fermé (`<script src="…" />`) ou jamais refermé dans le bloc (undefined) ; ailleurs, une section que le compilateur
  // ne lit pas (il refuse alors le fichier) se lit jusqu'au premier `</nom` ; null : jamais refermée
  const sectionLue = (i: number, nom: string): { corps: BorneDeSection['corps'], fin: number } | null | undefined => {
    const ferme = finOuvrante(i)
    if (ferme < 0) return null
    const section = lesBornes().sections.get(i)
    if (section !== undefined) return section
    const bloc = lesBornes().blocs.find(([a, b]) => a < i && i < b)
    if (bloc !== undefined && (nom === 'script' || nom === 'style')) {
      const e = src.slice(0, bloc[1]).toLowerCase().indexOf(`</${nom}>`, ferme)
      return src[ferme - 1] === '/' || e < 0 ? undefined : { corps: { debut: ferme + 1, fin: e }, fin: e + nom.length + 3 }
    }
    const e = src.toLowerCase().indexOf('</' + nom, ferme)
    return e < 0 ? null : { corps: { debut: ferme + 1, fin: e }, fin: src.indexOf('>', e) + 1 || src.length }
  }
  // la ligne de i ne porte avant lui que des blancs et des commentaires HTML entiers (un commentaire ouvert sur une ligne d'avant
  // compris), comme le masque des relevés d'avant les blanchissait
  const apresDesCommentaires = (i: number): boolean => {
    let k = i
    for (;;) {
      while (k > 0 && (src[k - 1] === ' ' || src[k - 1] === '\t')) k--
      if (k === 0 || src[k - 1] === '\n') return true
      if (!src.startsWith('-->', k - 3) && !src.startsWith('--!>', k - 4)) return false
      const o = src.lastIndexOf('<!--', k - 4)
      if (o < 0) return false
      k = o
    }
  }
  // dans un bloc <@head> / <@failed>, que le compilateur émet tel quel, une section hors de la tête de ligne : un <script> ou un
  // <style> partout, une autre section après des commentaires HTML posés avant elle sur sa ligne ; lue comme en tête de ligne
  // (sectionLue), une balise si elle n'est jamais refermée ; undefined hors d'un bloc
  const sectionDuBloc = (i: number, nom: string): ReturnType<typeof sectionLue> => {
    if (!lesBornes().blocs.some(([a, b]) => a < i && i < b)) return undefined
    if (nom !== 'script' && nom !== 'style' && !apresDesCommentaires(i)) return undefined
    return sectionLue(i, nom) ?? undefined
  }
  // fin d'un commentaire HTML ouvert en i, comme le compilateur la lit : il retire les sections avant de lire le gabarit, une section
  // de plusieurs lignes y laisse un commentaire de même hauteur (`<!--`, ses sauts de ligne, `-->`), une section d'une ligne rien ; la
  // fin de la première section de plusieurs lignes qui suit i quand elle s'ouvre avant `avant` (le premier `-->` du texte, ou sa fin),
  // undefined sinon (refermé à ce `-->` ; sans lui, le compilateur refuse le gabarit)
  const finDuCommentaireOuvert = (i: number, avant: number): number | undefined => {
    for (const s of lesBornes().sections.values()) {
      const saut = s.debut > i ? src.indexOf('\n', s.debut) : -1
      if (saut >= 0 && saut < s.fin) return s.debut < avant ? s.fin : undefined
    }
    return undefined
  }
  // la fin de ce commentaire (finDuCommentaireOuvert) tant que la lecture est dedans, -1 hors de lui : les sections qu'il couvre restent
  // des sections pour le compilateur, lues comme telles, le texte entre elles est le commentaire
  let commentaireJusqua = -1
  let texteSeul: string | null = null
  let i = 0

  while (i < src.length) {
    if (i < commentaireJusqua && !(src[i] === '<' && lesBornes().sections.has(i) && BRUTES.test(src.slice(i, i + 20)))) {
      // le commentaire jusqu'à la prochaine section du texte (une section blanchie, relue sans elle, n'y est plus) ou jusqu'à sa fin
      let fin = commentaireJusqua
      for (const s of lesBornes().sections.values()) {
        if (s.debut <= i || src[s.debut] !== '<') continue
        fin = Math.min(fin, s.debut)
        break
      }
      poser({ sorte: 'commentaireHtml', debut: i, fin })
      i = fin
      continue
    }
    const reste = src[i] === '<' || src[i] === '{' || src[i] === '@' ? src.slice(i, i + 200) : ''
    let m: RegExpExecArray | null
    // section brute (script, style, theme, routes, vars, types, effects), à toute profondeur : en tête de ligne, et partout où le
    // compilateur en ouvre une (après un commentaire HTML posé avant elle sur sa ligne, qu'il retire d'abord, après un séparateur
    // U+2028 / U+2029, fin de ligne pour ses expressions, dans un <textarea> ou un <title>) ; refermée où le compilateur la referme
    // (sectionLue) ; dans un bloc <@head> / <@failed>, aussi hors de la tête de ligne (sectionDuBloc) ; undefined : une balise
    const lue = !gabarit && reste.startsWith('<') && (m = BRUTES.exec(reste)) ? ((texteSeul === null && enTeteDeLigne(i)) || lesBornes().sections.has(i) ? sectionLue(i, m[1].toLowerCase()) : texteSeul === null ? sectionDuBloc(i, m[1].toLowerCase()) : undefined) : undefined
    if (lue !== undefined) {
      const nom = m![1].toLowerCase()
      if (lue === null) {
        faute(`la section <${nom}> n'est jamais refermée : ajoutez </${nom}>`, i)
        break
      }
      posees.add(i)
      const attributs = src.slice(i + m![0].length, lue.corps.debut - 1).trim()
      const corps     = { debut: lue.corps.debut, fin: lue.corps.fin }
      const finNoeud  = lue.fin
      if (nom === 'script') {
        const l = /\blang\s*=\s*["']?(\w+)/.exec(attributs)
        const script: Script = { sorte: 'script', debut: i, fin: finNoeud, langue: l ? l[1].toLowerCase() : langue, module: /\bmodule\b/.test(attributs), attributs, corps, code: null, nonLu: null }
        if (LANGUES_LUES.has(script.langue)) script.code = code(corps.debut, corps.fin, 'script', script.langue)
        else script.nonLu = `langue ${script.langue} : aucun lecteur`
        poser(script)
      }
      else if (nom === 'style') {
        const l = /\blang\s*=\s*["']?(\w+)/.exec(attributs)
        poser({ sorte: 'style', debut: i, fin: finNoeud, langue: l ? l[1].toLowerCase() : 'css', attributs, corps } satisfies Style)
      }
      else poser({ sorte: 'section', debut: i, fin: finNoeud, nom, attributs, corps } satisfies Section)
      i = finNoeud
      continue
    }
    // directive de racine en tête de ligne (`@import …`, `@i18n …`), hors de tout élément
    if (!gabarit && directives && texteSeul === null && reste.startsWith('@') && pile.length === 1 && enTeteDeLigne(i) && (m = /^@([A-Za-z]\w*)[^\n]*/.exec(reste))) {
      const fin = i + m[0].length
      poser({ sorte: 'directive', debut: i, fin, nom: '@' + m[1] })
      i = fin
      continue
    }
    if (reste.startsWith('<!--')) {
      COMMENTAIRE.lastIndex = i
      const lu = COMMENTAIRE.exec(src)
      // dans un <textarea> ou un <title>, un commentaire est un texte, sans passer la fermante ; jamais refermé : `<!--` seul
      if (texteSeul !== null) {
        const fin = lu === null || lu[0].toLowerCase().includes('</' + texteSeul) ? i + 4 : i + lu[0].length
        poser({ sorte: 'texte', debut: i, fin })
        i = fin
        continue
      }
      // refermé où le compilateur le referme (finDuCommentaireOuvert) : à une section de plusieurs lignes ouverte avant le premier
      // `-->` du texte, ou jamais refermé (un `<!--` cité dans un <script> du gabarit qui n'est pas une section, texte brut pour le
      // navigateur, que le compilateur laisse à son gabarit, compris) ; la lecture continue après lui
      const fermeA = !gabarit ? finDuCommentaireOuvert(i, lu === null ? src.length : i + lu[0].length) : undefined
      if (fermeA !== undefined) {
        commentaireJusqua = fermeA
        continue
      }
      if (lu === null) {
        faute('ce commentaire HTML n\'est jamais refermé : ajoutez -->', i)
        poser({ sorte: 'commentaireHtml', debut: i, fin: src.length })
        break
      }
      poser({ sorte: 'commentaireHtml', debut: i, fin: i + lu[0].length })
      i += lu[0].length
      continue
    }
    // `<![CDATA[…]]>` dans un <svg> ou un <math> : un texte, jusqu'à `]]>` ; ailleurs, un texte comme un autre
    if (reste.startsWith('<![CDATA[') && texteSeul === null && etranger() !== null) {
      const e = src.indexOf(']]>', i + 9)
      if (e < 0) {
        faute('cette section <![CDATA[ n\'est jamais refermée : ajoutez ]]>', i)
        poser({ sorte: 'texte', debut: i, fin: src.length })
        break
      }
      poser({ sorte: 'texte', debut: i, fin: e + 3 })
      i = e + 3
      continue
    }
    // dans un <textarea> ou un <title>, une balise autre que sa fermante est un texte, jusqu'à son `>`
    if (texteSeul !== null && reste.startsWith('<') && /^<\/?[a-zA-Z@]/.test(reste) && !new RegExp(`^</${texteSeul}[\\s/>]`, 'i').test(reste)) {
      BALISE_TEXTE.lastIndex = i
      const fin = i + BALISE_TEXTE.exec(src)![0].length
      poser({ sorte: 'texte', debut: i, fin })
      i = fin
      continue
    }
    if (reste.startsWith('</') && (m = FERMANTE.exec(reste)) && (i !== finTexte || /^[a-zA-Z@]/.test(m[1]))) {
      const ecrit = m[1]
      const fin   = i + m[0].length
      // remonte jusqu'à l'élément de ce nom : une balise raccourci restée ouverte dedans est rendue vide, une autre balise
      // est refermée par cette fermante (`fermeeParAncetre`), un bloc est une faute
      let k = pile.length - 1
      while (k > 0 && !referme(pile[k], ecrit)) k--
      if (k === 0) faute(`la balise fermante </${ecrit}> ne ferme aucune balise ouverte`, i)
      else {
        for (let j = pile.length - 1; j > k; j--) {
          const o = pile[j]
          if (viderRaccourci(o, i)) continue
          verser()
          if (o.sorte === 'bloc') faute(pasRefermeAvant(o, ecrit), o.debut)
          else {
            const b = o as Balise
            b.fermeeParAncetre = i
            b.fin = i
          }
        }
        verser()
        pile[k].fin = fin
        pile.length = k
      }
      texteSeul = null
      i = fin
      continue
    }
    if (texteSeul === null && reste.startsWith('<') && (m = BALISE.exec(reste))) {
      const balise: Balise = { sorte: 'balise', debut: i, fin: i, nom: m[1], forme: formeDe(m[1]), attributs: [], enfants: [], autoFermante: false, vide: false, finOuvrante: i, fermeeParAncetre: null, videeA: null }
      const fin = lireAttributs(i + m[0].length, balise)
      if (fin < 0) {
        faute(`la balise <${m[1]}> n'est jamais refermée (« > » manquant)`, i, guillemetSansFin)
        break
      }
      if (m[1] === '@slot' || raccourci(balise)) listes.set(balise, enfants())
      poser(balise)
      balise.fin = balise.finOuvrante = fin
      const bas = m[1].toLowerCase()
      if (!balise.autoFermante && !VIDES.has(bas) && ((gabarit && !partiels) || bas !== '@include')) {
        pile.push(balise)
        if ((bas === 'textarea' || bas === 'title') && etranger() === null) texteSeul = bas
        if (TEXTE_BRUT.has(bas) && etranger() === null) textesBruts.add(balise)
      }
      i = fin
      continue
    }
    if (reste.startsWith('{')) {
      const brut = reste.startsWith('{{')
      const de   = i + (brut ? 2 : 1)
      const e    = gabarit ? finAccolade(i, brut) : brut ? finRegion(src, de, '}') : finDeCode(de, 'expression')
      if (e < 0) {
        faute('cette accolade n\'est jamais refermée', i)
        break
      }
      if (brut && src[e + 1] !== '}') faute('le HTML calculé `{{…}}` se referme par deux accolades : `}}`', i)
      const fin = e + 1 + (brut && src[e + 1] === '}' ? 1 : 0)
      lireBloc(i, de, e, brut, fin)
      i = fin
      continue
    }
    // texte jusqu'au prochain `<` ou `{` (hors du gabarit seul : ou début de ligne, une directive peut y commencer)
    let j = i + 1
    while (j < src.length && src[j] !== '<' && src[j] !== '{' && (gabarit || !(src[j] === '@' && src[j - 1] === '\n'))) j++
    finTexte = j
    poser({ sorte: 'texte', debut: i, fin: j })
    i = j
  }
  // fin du texte : une balise raccourci restée ouverte est rendue vide, un `<@slot>` suivi dans le texte de blancs et de
  // commentaires seulement aussi (comme `<@slot/>`) — un jeton refusé après lui le laisse ouvert, comme le compilateur ; un bloc
  // ouvert est une faute, et dans le gabarit toute autre balise ouverte
  for (let k = pile.length - 1; k > 0; k--) {
    const n = pile[k]
    if (viderRaccourci(n, src.length)) continue
    verser()
    if (n.sorte === 'balise' && n.nom === '@slot' && /^(?:\s|<!--(?:-?>|[\s\S]*?--!?>))*$/.test(src.slice(n.finOuvrante))) {
      vider(n, src.length)
      continue
    }
    n.fin = src.length
    if (n.sorte === 'bloc') faute(`le bloc {${n.nom}} n'est jamais refermé : ajoutez {end}`, n.debut)
    else if (gabarit) faute(`la balise <${(n as Balise).nom}> n'est jamais refermée : ajoutez </${(n as Balise).nom}>`, n.debut)
  }
  verser()
  if (gabarit || (lues.bornes === null && !OUVRANTE_DE_SECTION.test(src))) return []
  const toutes = [...lesBornes().sections.values()]
  return toutes.filter(b => !posees.has(b.debut) && !toutes.some(a => a.debut < b.debut && b.fin <= a.fin))

  // un bloc `{…}` : bloc de contrôle, branche, fin, étalement ou expression ; le mot du bloc est collé à l'accolade
  // (`{if $a}`), `{else}` et `{end}` s'écrivent seuls, comme le compilateur les lit (`{ if $a}` est une expression)
  function lireBloc(debut: number, de: number, e: number, brut: boolean, fin: number): void {
    const corps = src.slice(de, e)
    const tete  = { debut: de, fin: e }
    let m: RegExpExecArray | null
    if (!brut && corps.startsWith('...')) {
      faute('un étalement `{...x}` pose des attributs : il s\'écrit dans une balise ouvrante', debut)
      poser({ sorte: 'etalement', debut, fin, code: code(de + 3, e, 'expression') })
      return
    }
    const fermeRaccourcis = (): void => {
      while (raccourci(ouvert()) && viderRaccourci(ouvert(), debut)) pile.pop()
      verser()
    }
    // une branche du bloc ouvert ; `blocs` : les blocs qui la portent ({elsif} et {else} : {if} ; {success} et {error} : {await})
    const brancheDe = (sorte: Branche['sorte'], blocs: string[]): Branche | null => {
      fermeRaccourcis()
      const o = ouvert()
      if (o.sorte !== 'bloc' || !blocs.includes(o.nom)) {
        faute(`{${sorte}} est écrit hors d'un bloc {${blocs[0]}}`, debut)
        return null
      }
      const branche: Branche = { sorte, debut, tete, enfants: [], code: null }
      o.branches.push(branche)
      return branche
    }
    if (!brut && corps === 'else') {
      brancheDe('else', ['if'])
      return
    }
    // `{success}` et `{error}` sans nom : une branche au niveau d'un {await} (balises raccourci ouvertes rendues vides),
    // ailleurs l'affichage d'une variable de ce nom
    if (!brut && (corps === 'success' || corps === 'error')) {
      let k = pile.length - 1
      while (k > 0 && raccourci(pile[k])) k--
      const o = pile[k]
      if (o.sorte === 'bloc' && o.nom === 'await') {
        brancheDe(corps, ['await'])
        return
      }
    }
    if (!brut && corps === 'end') {
      fermeRaccourcis()
      const o = ouvert()
      if (o.sorte !== 'bloc') {
        faute('{end} ne ferme aucun bloc ouvert', debut)
        return
      }
      o.fin = fin
      pile.pop()
      return
    }
    const nouveauBloc = (nom: string): Bloc => ({ sorte: 'bloc', debut, fin, nom, disposition: null, variables: null, branches: [{ sorte: 'alors', debut, tete, enfants: [], code: null }], code: null, cle: null, tete })
    if (!brut && corps.startsWith('?')) {
      const bloc = poser(nouveauBloc('if'))
      bloc.disposition = corps.slice(1).trim()
      pile.push(bloc)
      return
    }
    if (!brut && (m = BLOCS.exec(corps))) {
      const motCle = m[1] === 'await.keep' ? 'await' : m[1]
      const expr   = de + m[0].length
      if (motCle === 'elsif' || motCle === 'success' || motCle === 'error') {
        const branche = brancheDe(motCle, motCle === 'elsif' ? ['if'] : ['await'])
        if (branche && motCle === 'elsif') branche.code = code(expr, e, 'expression')
        return
      }
      const bloc = poser(nouveauBloc(motCle))
      if (motCle === 'const') {
        // `{const nom = valeur}` : une déclaration, sans branches ni {end}
        const c = /^([a-zA-Z_$][\w$]*)\s*=\s*/.exec(src.slice(expr, e))
        bloc.branches  = []
        bloc.variables = c ? c[1] : null
        if (c) bloc.code = code(expr + c[0].length, e, 'expression')
        return
      }
      if (motCle === 'for') {
        // `{for x, i in liste by clé}` (ou `key=clé`) : la liste et la clé sont du code, les noms sont lus à part
        const f = /^([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)$/.exec(src.slice(expr, e))
        if (f) {
          bloc.variables = f[1].trim()
          let liste = f[2]
          const cle = /\s+(?:key\s*=\s*|by\s+)([\s\S]*)$/.exec(liste)
          if (cle) liste = liste.slice(0, cle.index)
          const dl = e - f[2].length
          bloc.code = code(dl, dl + liste.length, 'expression')
          if (cle) bloc.cle = code(e - cle[1].length, e, 'expression')
        }
        else faute('{for} attend « in » ou « of » : {for x in $liste}', debut)
      }
      else if (motCle === 'await') {
        const s = /\s+\*skeleton(?:\([\s\S]*\))?$/.exec(src.slice(expr, e))
        bloc.code = code(expr, s ? expr + s.index : e, 'expression')
      }
      else bloc.code = code(expr, e, 'expression')
      pile.push(bloc)
      return
    }
    poser({ sorte: 'expression', debut, fin, brut, code: corps.trim() === '' ? null : code(de, e, 'expression') })
  }

  // attributs d'une balise ouvrante, depuis i ; rend l'indice qui suit `>` (ou -1)
  function lireAttributs(i: number, balise: Balise): number {
    const attribut = (sorte: AttributDeBalise['sorte'], nom: string | null, debut: number): AttributDeBalise => ({ sorte, nom, debut, fin: debut, valeur: null, code: null, interpolations: [], reglages: null })
    while (i < src.length) {
      while (/\s/.test(src[i] ?? '')) i++
      if (src.startsWith('/>', i)) {
        balise.autoFermante = true
        return i + 2
      }
      if (src[i] === '>') return i + 1
      const reste = src.slice(i, i + 200)
      let m: RegExpExecArray | null
      if (src[i] === '{') {
        const etale = src.startsWith('{...', i)
        const e     = finDeCode(i + (gabarit && etale ? 4 : 1), 'expression')
        if (e < 0) return -1
        const a     = attribut(etale ? 'etalement' : 'expression', null, i)
        a.code = code(i + (etale ? 4 : 1), e, 'expression')
        a.fin  = e + 1
        balise.attributs.push(a)
        i = e + 1
        continue
      }
      if ((m = EFFET.exec(reste))) {
        const a = attribut('effet', m[1], i)
        i += m[0].length
        if (src[i] === '(') {
          const e = gabarit ? finCompilee(i + 1, true) : finRegion(src, i + 1, ')')
          if (e < 0) return -1
          a.reglages = { debut: i + 1, fin: e }
          i = e + 1
        }
        a.fin = i
        balise.attributs.push(a)
        continue
      }
      if ((m = MOT_CLASSE.exec(reste))) {
        const e = gabarit ? finCompilee(i + m[0].length) : finRegion(src, i + m[0].length, '}')
        if (e < 0) return -1
        const a = attribut('classe', m[0].slice(0, -1), i)
        i = lireValeur(e + 1, a)
        balise.attributs.push(a)
        continue
      }
      if ((m = NOM_ATTR.exec(reste))) {
        const a = attribut(ATTR_GESTE.test(m[0]) ? 'geste' : 'attribut', m[0], i)
        i = lireValeur(i + m[0].length, a)
        balise.attributs.push(a)
        continue
      }
      i++
    }
    return -1
  }

  // la valeur d'un attribut, depuis i : code `{…}`, HTML calculé `{{…}}`, texte entre guillemets (ses `{…}` sont du
  // code), effet, ou valeur nue ; rend l'indice qui suit la valeur
  function lireValeur(i: number, a: AttributDeBalise): number {
    const eg = /^\s*=\s*/.exec(src.slice(i, i + 50))
    if (!eg) {
      a.fin = i
      return i
    }
    i += eg[0].length
    let m: RegExpExecArray | null
    if (gabarit && src[i] === '{') {
      // comme le compilateur (parseAttrs) : la valeur est une accolade lue depuis la première, `{{…}}` compris
      const e = finCompilee(i + 1)
      if (e < 0) return src.length
      const brut = src[i + 1] === '{' && src[e - 1] === '}'
      a.valeur = brut ? 'brut' : 'code'
      a.code   = brut ? code(i + 2, e - 1, 'expression') : code(i + 1, e, a.sorte === 'geste' ? 'gestionnaire' : 'expression')
      i = e + 1
    }
    else if (src.startsWith('{{', i)) {
      const e = finRegion(src, i + 2, '}')
      if (e < 0 || src[e + 1] !== '}') return src.length
      a.valeur = 'brut'
      a.code   = code(i + 2, e, 'expression')
      i = e + 2
    }
    else if (src[i] === '{') {
      const mode = a.sorte === 'geste' ? 'gestionnaire' : 'expression'
      const e    = finDeCode(i + 1, mode)
      if (e < 0) return src.length
      a.valeur = 'code'
      a.code   = code(i + 1, e, mode)
      i = e + 1
    }
    else if ((src[i] === '"' || src[i] === '\'') && (src.indexOf(src[i], i + 1) >= 0 || !dansTexteBrut())) {
      const e = src.indexOf(src[i], i + 1)
      if (e < 0) {
        // jamais refermé : comme le navigateur, la valeur court jusqu'au bout du texte, et la balise n'est jamais terminée ;
        // dans le contenu d'un élément à texte brut, la valeur est lue nue (plus bas), comme le compilateur la lit
        guillemetSansFin = { debut: i, attribut: a.debut }
        return src.length
      }
      a.valeur = 'texte'
      for (let k = i + 1; k < e; k++) {
        if (src[k] !== '{') continue
        const f = finRegion(src, k + 1, '}')
        if (f < 0 || f > e) break
        a.interpolations.push({ debut: k, fin: f + 1, code: src.slice(k + 1, f).trim() === '' ? null : code(k + 1, f, 'expression') })
        k = f
      }
      i = e + 1
    }
    else if ((m = EFFET.exec(src.slice(i, i + 200)))) {
      i += m[0].length
      if (src[i] === '(') {
        const e = gabarit ? finCompilee(i + 1, true) : finRegion(src, i + 1, ')')
        i = e < 0 ? src.length : e + 1
      }
      a.valeur = 'effet'
    }
    else if ((m = /^((?:[^\s>/]|\/(?!>))+)/.exec(src.slice(i, i + 500)))) {
      a.valeur = 'nue'
      i += m[0].length
    }
    a.fin = i
    return i
  }
}

// ---------------------------------------------------------------- parcours

// visite chaque nœud de l'arbre, parent avant enfants, branches des blocs comprises ; sans appel par niveau (listes d'enfants
// en attente, la dernière empilée lue d'abord) : un gabarit imbriqué sur des milliers de niveaux n'épuise pas la pile ici
export function parcourir(racine: Noeud, visite: (n: Noeud) => void): void {
  const listes: Noeud[][] = [[racine]]
  const rangs: number[]   = [0]
  while (listes.length > 0) {
    const haut = listes.length - 1
    if (rangs[haut] >= listes[haut].length) {
      listes.pop()
      rangs.pop()
      continue
    }
    const noeud = listes[haut][rangs[haut]++]
    visite(noeud)
    if (noeud.sorte === 'bloc') for (let b = noeud.branches.length - 1; b >= 0; b--) rangs[listes.push(noeud.branches[b].enfants) - 1] = 0
    if ('enfants' in noeud) rangs[listes.push(noeud.enfants) - 1] = 0
  }
}
