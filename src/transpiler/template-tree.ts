// transpiler/template-tree — les balises d'un gabarit ou d'un composant, lues par le lecteur unique (src/reader)
// les contrôles du gabarit (a11y.ts, ujs-form.ts) et les relevés d'images (img-tag.ts, effect-images.ts) y cherchent
// des balises et des attributs, jamais dans le texte brut : un commentaire HTML, une chaîne d'une expression `{…}`, la
// valeur d'un attribut, le texte d'un <textarea>, un script ou un style ne sont pas du balisage

import { readFile, locate, type TagAttr, type Tag, type File, type Node } from '../reader/index.js'

// le dernier texte lu de chaque façon : les contrôles qui passent l'un après l'autre sur le même texte relisent le même arbre
const lastReads = new Map<string, { text: string, tree: File }>()

function memo(way: string, text: string, read: () => File): File {
  const seen = lastReads.get(way)
  if (seen !== undefined && seen.text === text) return seen.tree
  const tree = read()
  lastReads.set(way, { text, tree })
  return tree
}

// le gabarit tel que le compilateur le prépare (sections retirées, partiels versés), lu comme il le lit : dans le dialecte de
// Civet ou de CoffeeScript, sans lui pour un gabarit `js` (`{$a /2}` y est une division, cf. parser/index.ts, readViaTree)
export function readTemplate(text: string, dialect = true): File {
  return memo(dialect ? 'template' : 'template-js', text, () => readFile(text, { template: true, dialect }))
}

// un texte qui peut être un composant entier (relevés du bundler) : sections et scripts reconnus, le code découpé sans
// être compilé, une ligne de prose en `@` gardée au gabarit ; le BOM et les retours chariot, que le lecteur retire, sont remplacés à longueur égale (un saut de ligne,
// une espace devant le saut de ligne) : une position de l'arbre est celle du texte reçu. `langue` : celle d'un <script> sans `lang`,
// que reçoit le compilateur (ses commentaires décident où la section se referme)
export function readComponent(text: string, lang = 'civet'): File {
  return memo('component-' + lang, text, () => readFile(sameLength(text), { compiler: false, directives: false, lang }))
}

function sameLength(text: string): string {
  const bom = text.charCodeAt(0) === 0xfeff
  if (!bom && !text.includes('\r')) return text
  return (bom ? '\n' + text.slice(1) : text).replace(/\r\n/g, ' \n').replace(/\r/g, '\n')
}

// les balises de `noeuds`, dans l'ordre du texte, branches des blocs comprises ; une balise nommée dans `sauf` n'est pas
// rendue, ni rien de son contenu (les exemples montrés dans <pre> ou <code>)
export function tagsOf(nodes: Node[], except: ReadonlySet<string> = new Set()): Tag[] {
  const out: Tag[] = []
  const stack      = [{ list: nodes, k: 0 }]
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.k >= top.list.length) {
      stack.pop()
      continue
    }
    const n = top.list[top.k++]
    if (n.kind === 'tag' && !except.has(n.name.toLowerCase())) {
      out.push(n)
      stack.push({ list: n.children, k: 0 })
    }
    else if (n.kind === 'block') for (let b = n.branches.length - 1; b >= 0; b--) stack.push({ list: n.branches[b].children, k: 0 })
  }
  return out
}

// le nom d'une balise en minuscules : le navigateur le lit sans casse
export function nameOf(b: Tag): string {
  return b.name.toLowerCase()
}

// l'attribut `nom` d'une balise, écrit avec ou sans `@` devant, casse ignorée : le premier, comme le navigateur
export function attrOf(b: Tag, name: string): TagAttr | undefined {
  return b.attrs.find(a => (a.kind === 'attribute' || a.kind === 'gesture') && a.name !== null && a.name.toLowerCase().replace(/^@/, '') === name)
}

// la valeur écrite en clair d'un attribut, comme le navigateur la lit (entre guillemets, telle quelle ; nue, jusqu'au
// blanc) ; undefined quand il n'en a pas ou qu'elle est calculée (`={…}`, `={{…}}`)
export function valueOf(source: string, a: TagAttr | undefined): string | undefined {
  if (a === undefined) return undefined
  const raw = source.slice(a.start, a.end)
  if (a.value === 'text') return raw.slice(raw.search(/["']/) + 1, -1)
  if (a.value === 'bare') return raw.slice(raw.indexOf('=') + 1).trimStart()
  return undefined
}

// la ligne d'un indice du texte lu ; `premiere` : la ligne du fichier où commence ce texte (le HTML d'un composant est
// rogné en tête)
export function lineOf(tree: File, hint: number, first = 1): number {
  return first - 1 + locate(tree.lineStarts, hint).line
}
