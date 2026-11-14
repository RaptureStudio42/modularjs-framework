// transpiler/template-tree — les balises d'un gabarit ou d'un composant, lues par le lecteur unique (src/reader)
// les contrôles du gabarit (a11y.ts, ujs-form.ts) et les relevés d'images (img-tag.ts, effect-images.ts) y cherchent
// des balises et des attributs, jamais dans le texte brut : un commentaire HTML, une chaîne d'une expression `{…}`, la
// valeur d'un attribut, le texte d'un <textarea>, un script ou un style ne sont pas du balisage

import { lireFichier, situer, type AttributDeBalise, type Balise, type Fichier, type Noeud } from '../reader/index.js'

// le dernier texte lu de chaque façon : les contrôles qui passent l'un après l'autre sur le même texte relisent le même arbre
const lus = new Map<string, { texte: string, arbre: Fichier }>()

function memo(facon: string, texte: string, lire: () => Fichier): Fichier {
  const vu = lus.get(facon)
  if (vu !== undefined && vu.texte === texte) return vu.arbre
  const arbre = lire()
  lus.set(facon, { texte, arbre })
  return arbre
}

// le gabarit tel que le compilateur le prépare (sections retirées, partiels versés), lu comme il le lit : dans le dialecte de
// Civet ou de CoffeeScript, sans lui pour un gabarit `js` (`{$a /2}` y est une division, cf. parser/index.ts, lireParLArbre)
export function gabaritLu(texte: string, dialecte = true): Fichier {
  return memo(dialecte ? 'gabarit' : 'gabarit-js', texte, () => lireFichier(texte, { gabarit: true, dialecte }))
}

// un texte qui peut être un composant entier (relevés du bundler) : sections et scripts reconnus, le code découpé sans
// être compilé, une ligne de prose en `@` gardée au gabarit ; le BOM et les retours chariot, que le lecteur retire, sont remplacés à longueur égale (un saut de ligne,
// une espace devant le saut de ligne) : une position de l'arbre est celle du texte reçu. `langue` : celle d'un <script> sans `lang`,
// que reçoit le compilateur (ses commentaires décident où la section se referme)
export function composantLu(texte: string, langue = 'civet'): Fichier {
  return memo('composant-' + langue, texte, () => lireFichier(memeLongueur(texte), { compiler: false, directives: false, langue }))
}

function memeLongueur(texte: string): string {
  const bom = texte.charCodeAt(0) === 0xfeff
  if (!bom && !texte.includes('\r')) return texte
  return (bom ? '\n' + texte.slice(1) : texte).replace(/\r\n/g, ' \n').replace(/\r/g, '\n')
}

// les balises de `noeuds`, dans l'ordre du texte, branches des blocs comprises ; une balise nommée dans `sauf` n'est pas
// rendue, ni rien de son contenu (les exemples montrés dans <pre> ou <code>)
export function balisesDe(noeuds: Noeud[], sauf: ReadonlySet<string> = new Set()): Balise[] {
  const out: Balise[] = []
  const pile          = [{ liste: noeuds, k: 0 }]
  while (pile.length > 0) {
    const haut = pile[pile.length - 1]
    if (haut.k >= haut.liste.length) {
      pile.pop()
      continue
    }
    const n = haut.liste[haut.k++]
    if (n.sorte === 'balise' && !sauf.has(n.nom.toLowerCase())) {
      out.push(n)
      pile.push({ liste: n.enfants, k: 0 })
    }
    else if (n.sorte === 'bloc') for (let b = n.branches.length - 1; b >= 0; b--) pile.push({ liste: n.branches[b].enfants, k: 0 })
  }
  return out
}

// le nom d'une balise en minuscules : le navigateur le lit sans casse
export function nomDe(b: Balise): string {
  return b.nom.toLowerCase()
}

// l'attribut `nom` d'une balise, écrit avec ou sans `@` devant, casse ignorée : le premier, comme le navigateur
export function attributDe(b: Balise, nom: string): AttributDeBalise | undefined {
  return b.attributs.find(a => (a.sorte === 'attribut' || a.sorte === 'geste') && a.nom !== null && a.nom.toLowerCase().replace(/^@/, '') === nom)
}

// la valeur écrite en clair d'un attribut, comme le navigateur la lit (entre guillemets, telle quelle ; nue, jusqu'au
// blanc) ; undefined quand il n'en a pas ou qu'elle est calculée (`={…}`, `={{…}}`)
export function valeurDe(source: string, a: AttributDeBalise | undefined): string | undefined {
  if (a === undefined) return undefined
  const brut = source.slice(a.debut, a.fin)
  if (a.valeur === 'texte') return brut.slice(brut.search(/["']/) + 1, -1)
  if (a.valeur === 'nue') return brut.slice(brut.indexOf('=') + 1).trimStart()
  return undefined
}

// la ligne d'un indice du texte lu ; `premiere` : la ligne du fichier où commence ce texte (le HTML d'un composant est
// rogné en tête)
export function ligneDe(arbre: Fichier, indice: number, premiere = 1): number {
  return premiere - 1 + situer(arbre.debutsDeLigne, indice).ligne
}
