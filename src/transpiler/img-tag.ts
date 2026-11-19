// transpiler/img-tag — `<@@img src="hero.jpg">`
// résolu au build par la MÊME mécanique que `µimage('hero.jpg')` (cf. bundler/index.ts,
// preResolveAssets). Ce module ne fait QUE le repérage/la réécriture TEXTE de la balise —
// aucun accès disque ici (seul le bundler l'a, via resolveOneImage) et aucun import de
// bundler (le bundler importe CE module ; un retour créerait un cycle).

import { tagsOf, readComponent, nameOf } from './template-tree.js'

export interface ImgTagAttr {
  name: string
  raw: string
}

export interface ImgTag {
  text: string
  tagOpen: string
  start: number
  end: number
  src: string | null
  srcQuote: string
  widthsRaw: string | null
  dynamicWidths: string | null
  attrs: ImgTagAttr[]
}

export interface ResolvedImage {
  src: string
  srcset: string
  sizes: string
  width: number | null
  height: number | null
}

// extractQuotedValue — `attrRaw` est le texte COMPLET d'un attribut tel que rendu par
// l'arbre (`nom="valeur"`, `nom='valeur'`) : rend la valeur ET le guillemet utilisé,
// ou null si l'attribut n'est pas sous forme guillemetée (accolade, nu, ou autre nom).
function extractQuotedValue(attrRaw: string, name: string): { value: string; quote: string } | null {
  const m = attrRaw.match(new RegExp(`^${name}\\s*=\\s*(["'])([\\s\\S]*)\\1$`))
  if (!m) return null
  return { quote: m[1], value: m[2] }
}

// ni le contenu d'un exemple (<pre>, <code>), ni un script ou un style écrits dans le gabarit ; lu aussi par le repli d'un <@failed> (macros.ts)
export const OUTSIDE_MARKUP = new Set(['pre', 'code', 'script', 'style'])

// scanImgTags — chaque balise `<@@img …>` d'un gabarit ou d'un composant entier, lue par le lecteur unique
// (template-tree.ts) : jamais dans un exemple affiché dans <pre>/<code>, un script, un style, un commentaire, une
// chaîne d'une expression `{…}` ou la valeur d'un attribut ; le nom entier (`<@@imgx` n'en est pas une), la fin réelle
// de la balise ouvrante (accolades et guillemets lus). `src` n'est candidat que s'il est entre guillemets et sans `{`
// dans la valeur (une valeur à accolade est une interpolation pour le pipeline d'attributs, jamais un chemin littéral).
// CASSE IGNORÉE : la résolution de module (resolveTagShortcuts) et le
// lint a11y sont insensibles à la casse — un scan sensible laissait `<@@IMG src="absent.png">`
// traverser tout le build sans un mot. Le nom écrit est conservé (`tagOpen`) : la balise
// ressort telle que l'auteur l'a tapée, sa fermeture `</@@IMG>` reste appariée. `langue` : celle d'un <script> sans `lang`, que
// reçoit le compilateur : chaque section se referme où il la referme.
export function scanImgTags(text: string, lang?: string): ImgTag[] {
  const tags: ImgTag[] = []
  for (const b of tagsOf(readComponent(text, lang).children, OUTSIDE_MARKUP)) {
    if (nameOf(b) !== '@@img') continue
    const attrs = b.attrs.map(a => {
      const raw = text.slice(a.start, a.end)
      return { name: /^[^\s=/]*/.exec(raw)![0], raw }
    })

    let src: string | null = null
    let srcQuote = '"'
    const srcAttr = attrs.find(a => a.name === 'src')
    if (srcAttr) {
      const q = extractQuotedValue(srcAttr.raw, 'src')
      if (q && !q.value.includes('{')) { src = q.value; srcQuote = q.quote }
    }

    let widthsRaw: string | null     = null
    let dynamicWidths: string | null = null
    const widthsAttr                 = attrs.find(a => a.name === 'widths')
    if (widthsAttr) {
      const q = extractQuotedValue(widthsAttr.raw, 'widths')
      // forme non littérale (`widths={$w}`, `widths=320`) : jamais consommée au build, et
      // jamais retirée en silence non plus — l'appelant lève
      if (q) widthsRaw = q.value
      else dynamicWidths = widthsAttr.raw.slice('widths'.length).replace(/^\s*=\s*/, '') || widthsAttr.raw
    }

    tags.push({ text: text.slice(b.start, b.openingEnd), tagOpen: text.slice(b.start, b.start + 1 + b.name.length), start: b.start, end: b.openingEnd, src, srcQuote, widthsRaw, dynamicWidths, attrs })
  }
  return tags
}

// imgTagsInBlock — les <@@img> du contenu d'un bloc <@head> ou <@failed> (`macro`), tel qu'écrit entre ses balises (non rogné :
// chaque ligne garde son début), lu dans son bloc comme le relevé des images lit le fichier (scanImgTags, qui prépare leur image) :
// un <script> ou un <style> y court jusqu'à sa fermante exacte, où qu'il soit posé, une autre section après des commentaires posés
// avant elle sur sa ligne, et un exemple cité dans leur texte n'est pas une balise ; positions dans `content`
export function imgTagsInBlock(content: string, macro: 'head' | 'failed'): ImgTag[] {
  const open = `<@${macro}>`
  return scanImgTags(open + content + `</@${macro}>`).map(tag => ({ ...tag, start: tag.start - open.length, end: tag.end - open.length }))
}

// isResolvableSrc — chemin RELATIF seulement : un `src` vide, absolu (`/…`), une ancre
// (`#…`) ou une URL à schéma (`http:`, `data:`, `blob:`…) n'est jamais résolu — passe-plat,
// exactement comme un `src={…}` dynamique.
export function isResolvableSrc(src: string | null): src is string {
  if (!src) return false
  if (src.startsWith('/') || src.startsWith('#')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false
  return true
}

// parseWidths — entiers ≥ 1 séparés par espaces ou virgules (`"320 640"`, `"320, 640"`) ;
// toute autre forme (vide, décimal, négatif, texte, ou un nombre si long qu'il dépasse la
// précision d'un double — `Number("4".repeat(400))` vaut `Infinity`, jamais rattrapé par
// `n < 1` : la largeur démesurée passait alors en silence) rend null — l'appelant décide de lever.
export function parseWidths(raw: string): number[] | null {
  const parts = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const widths: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (!Number.isFinite(n) || n < 1) return null
    widths.push(n)
  }
  return widths
}

// rewriteImgTag — attributs de l'auteur conservés VERBATIM et dans l'ORDRE, `widths`
// retiré (n'a de sens qu'au build), `src` remplacé par le chemin résolu (mêmes guillemets
// que l'original), puis ajout des SEULS attributs absents chez l'auteur — jamais de
// duplication ni d'écrasement d'un attribut déjà posé à la main.
export function rewriteImgTag(tag: ImgTag, resolved: ResolvedImage): string {
  const selfClosing = tag.text.endsWith('/>')
  const present = new Set(tag.attrs.map(a => a.name))
  const kept: string[] = []
  for (const attr of tag.attrs) {
    if (attr.name === 'widths') continue
    if (attr.name === 'src') { kept.push(`src=${tag.srcQuote}${resolved.src}${tag.srcQuote}`); continue }
    kept.push(attr.raw)
  }
  if (!present.has('srcset') && resolved.srcset) kept.push(`srcset="${resolved.srcset}"`)
  if (!present.has('sizes') && resolved.sizes) kept.push(`sizes="${resolved.sizes}"`)
  if (!present.has('width') && resolved.width !== null) kept.push(`width="${resolved.width}"`)
  if (!present.has('height') && resolved.height !== null) kept.push(`height="${resolved.height}"`)
  // la balise garde son nombre de lignes : écrite sur plusieurs, elle ne décale pas les lignes citées après elle (avertissements, refus)
  const written = `${tag.tagOpen} ${kept.join(' ')}`
  const missing = (tag.text.match(/\n/g)?.length ?? 0) - (written.match(/\n/g)?.length ?? 0)
  return `${written}${missing > 0 ? '\n'.repeat(missing) : ''}${selfClosing ? ' /' : ''}>`
}
