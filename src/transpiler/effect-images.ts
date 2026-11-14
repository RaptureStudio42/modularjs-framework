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
import type { AttributDeBalise, Etendue } from '../reader/index.js'
import { balisesDe, composantLu } from './template-tree.js'

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

// le nom comme l'écrit une balise (parser/index.ts) : un effet, ou un alias d'effet pointé (`*behind.fond(`)
const NOM_EFFET       = /^[A-Za-z][\w-]*(?:\.[\w-]+)?$/
// une transition dont la valeur est un effet (`:in=*nom(réglages)`, `:out`, `:transition`, modificateurs compris)
const TRANSITION      = new RegExp('^' + SIGN_RE + String.raw`(?:in|out|transition)(?:\.\w+)*$`)
const EFFET_EN_VALEUR = /=\s*\*([A-Za-z][\w-]*(?:\.[\w-]+)?)\(/

// ni le contenu d'un exemple (<pre>, <code>), ni un script ou un style écrits dans le gabarit
const HORS_BALISAGE = new Set(['pre', 'code', 'script', 'style'])

// l'effet que porte un attribut et la place de ses réglages : `*nom(réglages)` entre deux attributs, ou la valeur d'une
// transition ; null pour tout autre attribut
function effetDe(src: string, a: AttributDeBalise): { nom: string, reglages: Etendue } | null {
  if (a.sorte === 'effet') return a.nom !== null && a.reglages !== null && NOM_EFFET.test(a.nom) ? { nom: a.nom, reglages: a.reglages } : null
  if (a.valeur !== 'effet' || a.nom === null || !TRANSITION.test(a.nom)) return null
  const brut = src.slice(a.debut, a.fin)
  const m    = EFFET_EN_VALEUR.exec(brut)
  if (m === null || !brut.endsWith(')')) return null
  return { nom: m[1], reglages: { debut: a.debut + m.index + m[0].length, fin: a.fin - 1 } }
}

/** les chemins locaux que les effets de `html` (un gabarit ou un composant entier) écrivent en clair dans leurs réglages
 *  d'image, dans l'ordre du texte ; `langue` : celle d'un <script> sans `lang`, que reçoit le compilateur (ses commentaires
 *  décident où la section se referme) */
export function scanEffectImages(html: string, langue?: string): EffectImage[] {
  const arbre = composantLu(html, langue)
  const src   = arbre.source
  const out: EffectImage[] = []
  for (const b of balisesDe(arbre.enfants, HORS_BALISAGE)) {
    for (const a of b.attributs) {
      const effet = effetDe(src, a)
      if (effet === null) continue
      const { debut, fin } = effet.reglages
      for (const img of localImages(effet.nom, src.slice(debut, fin))) out.push({ effet: effet.nom, reglage: img.key, chemin: img.path, debut: debut + img.start, fin: debut + img.end, ...(img.plain ? { plain: true } : {}) })
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
    out   += html.slice(cursor, e.debut) + (e.plain ? assetCall(e.chemin) : imageCall(e.chemin))
    cursor = e.fin
  }
  return out + html.slice(cursor)
}
