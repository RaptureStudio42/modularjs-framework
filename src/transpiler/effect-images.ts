// transpiler/effect-images — `*behind('photo.jpg')`
// le chemin d'un fichier local, écrit en clair dans un réglage d'image d'un effet, est résolu au build par la MÊME
// mécanique que `µimage('photo.jpg')` (cf. bundler/index.ts, preResolveAssets) : ce module ne fait QUE le repérage
// et la réécriture TEXTE — le littéral devient l'appel `µimage('photo.jpg')`, que le bundler résout (fichier, empreinte,
// variantes) et que le transpileur remplace (replaceMagicImages) comme un appel écrit à la main ; pour un réglage dont
// l'effet ne lit que l'adresse (`plain`), l'appel `µasset('photo.jpg')` : le fichier seul, sans variante. Aucun accès
// disque ici. Quels réglages sont des images, c'est la règle du catalogue qui le dit (effects/catalog.ts, localImages) :
// aucun effet n'est nommé dans ce fichier, un effet à venir est couvert dès qu'il déclare un réglage `image`.
// Un effet ne se trouve que dans une balise, lue par le lecteur unique (template-tree.ts) : `*nom(réglages)` entre deux
// attributs, ou la valeur d'une transition `:in=*nom(réglages)` ; un exemple dans <pre> ou <code>, un commentaire, un
// <script>, un <style>, un texte, une expression `{…}` ou la valeur d'un attribut n'est jamais lu. Un alias d'effet (`*behind.fond('photo.jpg')`, ou à plat `*fond('photo.jpg')`)
// se lit comme l'effet qu'il règle : le chemin donné à la pose est résolu de la même façon.

import { localImages } from '../effects/catalog.js'
import { SIGN_RE } from '../parser/mjs-words.js'
import type { TagAttr, Span } from '../reader/index.js'
import { tagsOf, readComponent } from './template-tree.js'

export interface EffectImage {
  /** l'effet, tel qu'écrit */
  effect: string
  /** le réglage d'image */
  setting: string
  /** le chemin du fichier, sans guillemets */
  path: string
  /** la place du littéral (guillemets compris) dans le texte donné */
  start: number
  end: number
  /** l'effet ne lit que l'adresse de cette image, pas ses variantes de largeur */
  plain?: boolean
}

/** l'appel `µimage('chemin')` qu'un chemin local devient : le texte exact sous lequel le bundler range l'image résolue */
export function imageCall(path: string): string {
  return `µimage('${path}')`
}

/** l'appel `µasset('chemin')` qu'un chemin local devient pour un réglage qui ne lit que l'adresse */
export function assetCall(path: string): string {
  return `µasset('${path}')`
}

// le nom comme l'écrit une balise (parser/index.ts) : un effet, ou un alias d'effet pointé (`*behind.fond(`)
const EFFECT_NAME       = /^[A-Za-z][\w-]*(?:\.[\w-]+)?$/
// une transition dont la valeur est un effet (`:in=*nom(réglages)`, `:out`, `:transition`, modificateurs compris)
const TRANSITION      = new RegExp('^' + SIGN_RE + String.raw`(?:in|out|transition)(?:\.\w+)*$`)
const EFFECT_AS_VALUE = /=\s*\*([A-Za-z][\w-]*(?:\.[\w-]+)?)\(/

// ni le contenu d'un exemple (<pre>, <code>), ni un script ou un style écrits dans le gabarit
const OUTSIDE_MARKUP = new Set(['pre', 'code', 'script', 'style'])

// l'effet que porte un attribut et la place de ses réglages : `*nom(réglages)` entre deux attributs, ou la valeur d'une
// transition ; null pour tout autre attribut
function effectOf(src: string, a: TagAttr): { name: string, settings: Span } | null {
  if (a.kind === 'effect') return a.name !== null && a.settings !== null && EFFECT_NAME.test(a.name) ? { name: a.name, settings: a.settings } : null
  if (a.value !== 'effect' || a.name === null || !TRANSITION.test(a.name)) return null
  const raw = src.slice(a.start, a.end)
  const m   = EFFECT_AS_VALUE.exec(raw)
  if (m === null || !raw.endsWith(')')) return null
  return { name: m[1], settings: { start: a.start + m.index + m[0].length, end: a.end - 1 } }
}

/** les chemins locaux que les effets de `html` (un gabarit ou un composant entier) écrivent en clair dans leurs réglages
 *  d'image, dans l'ordre du texte ; `langue` : celle d'un <script> sans `lang`, que reçoit le compilateur (ses commentaires
 *  décident où la section se referme) */
export function scanEffectImages(html: string, lang?: string): EffectImage[] {
  const tree               = readComponent(html, lang)
  const src                = tree.source
  const out: EffectImage[] = []
  for (const b of tagsOf(tree.children, OUTSIDE_MARKUP)) {
    for (const a of b.attrs) {
      const effect = effectOf(src, a)
      if (effect === null) continue
      const { start, end } = effect.settings
      for (const img of localImages(effect.name, src.slice(start, end))) out.push({ effect: effect.name, setting: img.key, path: img.path, start: start + img.start, end: start + img.end, ...(img.plain ? { plain: true } : {}) })
    }
  }
  return out
}

/** `html` où chaque chemin local écrit en clair dans un réglage d'image d'effet est devenu l'appel `µimage('chemin')`
 * (`µasset('chemin')` pour un réglage qui ne lit que l'adresse) ;
 * le texte reçu, tel quel, quand il n'y en a pas */
export function resolveEffectImages(html: string): string {
  const found = scanEffectImages(html)
  if (found.length === 0) return html
  let out    = ''
  let cursor = 0
  for (const e of found) {
    out   += html.slice(cursor, e.start) + (e.plain ? assetCall(e.path) : imageCall(e.path))
    cursor = e.end
  }
  return out + html.slice(cursor)
}
