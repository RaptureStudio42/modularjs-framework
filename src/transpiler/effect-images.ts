// transpiler/effect-images — `*behind('photo.jpg')`
// le chemin d'un fichier local, écrit en clair dans un réglage d'image d'un effet, est résolu au build par la MÊME
// mécanique que `µimage('photo.jpg')` (cf. bundler/index.ts, preResolveAssets) : ce module ne fait QUE le repérage
// et la réécriture TEXTE — le littéral devient l'appel `µimage('photo.jpg')`, que le bundler résout (fichier, empreinte,
// variantes) et que le transpileur remplace (replaceMagicImages) comme un appel écrit à la main ; pour un réglage dont
// l'effet ne lit que l'adresse (`plain`), l'appel `µasset('photo.jpg')` : le fichier seul, sans variante. Aucun accès
// disque ici. Quels réglages sont des images, c'est la règle du catalogue qui le dit (effects/catalog.ts, localImages) :
// aucun effet n'est nommé dans ce fichier, un effet à venir est couvert dès qu'il déclare un réglage `image`.
// Un effet ne se trouve que dans une balise (`*nom(réglages)` entre deux attributs, ou la valeur d'une directive
// `@in=*nom(réglages)`) : un exemple dans <pre> ou <code>, un commentaire, un <script>, un <style>, un texte ou la
// valeur d'un attribut n'est jamais lu. Un alias d'effet (`*behind.fond('photo.jpg')`, ou à plat `*fond('photo.jpg')`)
// se lit comme l'effet qu'il règle : le chemin donné à la pose est résolu de la même façon.

import { findMacroTagEnd } from './macro-tag.js'
import { localImages } from '../effects/catalog.js'

export interface EffectImage {
  /** l'effet, tel qu'écrit */
  effet: string
  /** le réglage d'image */
  reglage: string
  /** le chemin du fichier, sans guillemets */
  chemin: string
  /** la place du littéral (guillemets compris) dans le texte donné */
  debut: number
  fin: number
  /** l'effet ne lit que l'adresse de cette image, pas ses variantes de largeur */
  plain?: boolean
}

/** l'appel `µimage('chemin')` qu'un chemin local devient : le texte exact sous lequel le bundler range l'image résolue */
export function imageCall(chemin: string): string {
  return `µimage('${chemin}')`
}

/** l'appel `µasset('chemin')` qu'un chemin local devient pour un réglage qui ne lit que l'adresse */
export function assetCall(chemin: string): string {
  return `µasset('${chemin}')`
}

// le texte sans ce qui n'est jamais une balise à lui — exemples (<pre>, <code>), scripts, styles, commentaires —,
// blanchi à longueur égale : les places restent celles du texte donné (même masque que le bundler pour <@@img>,
// qu'il ne peut pas importer sans cycle)
function mask(html: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return html
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, blank)
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, blank)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, blank)
}

// le nom comme l'écrit une balise (parser/index.ts) : un effet, ou un alias d'effet pointé (`*behind.fond(`)
const EFFECT_OPEN = /\*([A-Za-z][\w-]*(?:\.[\w-]+)?)\(/y
const DIRECTIVE   = /@(?:in|out|transition)(?:\.\w+)*\s*=\s*$/

// les effets écrits entre `from` et `end`, les attributs d'une balise : `*nom(` après un blanc, ou après le signe égal
// d'une transition ; une valeur entre guillemets ou entre accolades n'est pas lue
function scanAttributes(text: string, from: number, end: number, out: EffectImage[]): void {
  let quote = ''
  let depth = 0
  for (let i = from; i < end; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
    }
    else if (depth > 0) {
      if (c === '{') depth++
      else if (c === '}') depth--
    }
    else if (c === '"' || c === '\'') quote = c
    else if (c === '{') depth++
    else if (c === '*' && (i === from || /\s/.test(text[i - 1]) || DIRECTIVE.test(text.slice(from, i)))) {
      EFFECT_OPEN.lastIndex = i
      const m = EFFECT_OPEN.exec(text)
      if (!m) continue
      // les réglages, jusqu'à la parenthèse qui ferme : une parenthèse dans un texte ne compte pas
      const start = i + m[0].length
      let open    = 1
      let inText  = ''
      let j       = start
      for (; j < end; j++) {
        const d = text[j]
        if (inText) {
          if (d === '\\') j++
          else if (d === inText) inText = ''
        }
        else if (d === '"' || d === '\'') inText = d
        else if (d === '(') open++
        else if (d === ')' && --open === 0) break
      }
      if (open > 0) return
      for (const img of localImages(m[1], text.slice(start, j))) out.push({ effet: m[1], reglage: img.key, chemin: img.path, debut: start + img.start, fin: start + img.end, ...(img.plain ? { plain: true } : {}) })
      i = j
    }
  }
}

/** les chemins locaux que les effets de `html` écrivent en clair dans leurs réglages d'image, dans l'ordre du texte */
export function scanEffectImages(html: string): EffectImage[] {
  const text = mask(html)
  const out: EffectImage[] = []
  const tag  = /<@{0,2}[A-Za-z][\w:.-]*/g
  let m: RegExpExecArray | null
  while ((m = tag.exec(text))) {
    const from = m.index + m[0].length
    const end  = findMacroTagEnd(text, from)
    if (end === -1) continue
    scanAttributes(text, from, end, out)
    // une balise de plus dans la valeur d'un attribut n'en est pas une
    tag.lastIndex = end + 1
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
    out   += html.slice(cursor, e.debut) + (e.plain ? assetCall(e.chemin) : imageCall(e.chemin))
    cursor = e.fin
  }
  return out + html.slice(cursor)
}
