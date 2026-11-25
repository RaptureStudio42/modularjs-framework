// bundler/image — les images : dimensions natives, et variantes de largeur.
//
// DEUX NIVEAUX, délibérément séparés :
//
//   1. LES DIMENSIONS, sans aucune dépendance. On lit l'en-tête du fichier et on en
//      sort la largeur et la hauteur natives. C'est ce qui permet d'écrire `width` et
//      `height` sur la balise, et donc de supprimer le SAUT DE MISE EN PAGE au
//      chargement — le gain le plus visible, et il marche pour tout le monde.
//   2. LES VARIANTES (plusieurs largeurs, formats modernes), qui exigent un vrai
//      encodeur d'images. `sharp` est une dépendance OPTIONNELLE : présent, on génère ;
//      absent, on prévient UNE fois et l'image d'origine passe telle quelle. Même
//      patron que le moteur de rendu `browser` avec Playwright — un poste qui ne peut
//      pas compiler un binaire natif n'a jamais un build cassé pour autant.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// Spécifieur en VARIABLE, jamais en littéral : `sharp` n'est pas une dépendance du
// framework, un `import('sharp')` littéral ferait échouer NOTRE typecheck alors que le
// module est parfaitement résolvable chez qui l'installe.
const SHARP = 'sharp'

export interface ImageSize {
  width: number
  height: number
}

/** Un `ispe` d'ISOBMFF (avif/heic) : size(4) 'ispe'(4) version+flags(4) width(4) height(4). */
function ispeSize(buf: Buffer): ImageSize | null {
  const i = buf.indexOf('ispe', 0, 'ascii')
  if (i < 0 || i + 16 > buf.length) return null
  return { width: buf.readUInt32BE(i + 8), height: buf.readUInt32BE(i + 12) }
}

/** La balise OUVRANTE `<svg …>` (de `<svg` à son premier `>` HORS guillemets), ou `null` si elle
 *  n'est jamais refermée dans la fenêtre lue — jamais ce qui suit (les enfants). */
function svgOpeningTag(str: string): string | null {
  const start = str.search(/<svg[\s>]/i)
  if (start < 0) return null
  let i = start + 4
  let quote: string | null = null
  while (i < str.length) {
    const c = str[i]
    if (quote) { if (c === quote) quote = null }
    else if (c === '"' || c === '\'') quote = c
    else if (c === '>') return str.slice(start, i + 1)
    i++
  }
  return null
}

/** Dimensions natives d'une image, lues dans son en-tête. `null` si le format est inconnu. */
export function readImageSize(buf: Buffer): ImageSize | null {
  if (buf.length < 16) return null

  // PNG — signature 8 octets, puis IHDR : largeur et hauteur en tête
  // un PNG TRONQUÉ (assez long pour passer la garde `< 16` mais pas les 24
  // octets de l'IHDR) faisait lever `readUInt32BE(20)` (RangeError) : un fichier corrompu cassait
  // le build au lieu de rendre `null`. On vérifie aussi que l'IHDR est bien LÀ (offset 12-15).
  if (buf.readUInt32BE(0) === 0x89504e47) {
    if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }

  // GIF — 'GIF8', puis largeur/hauteur en petit-boutiste
  if (buf.toString('ascii', 0, 4) === 'GIF8') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }

  // WebP — conteneur RIFF, trois variantes de bloc
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const block = buf.toString('ascii', 12, 16)
    if (block === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (block === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (block === 'VP8X' && buf.length >= 30) return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
    return null
  }

  // AVIF / HEIC — ISOBMFF : la taille vit dans un bloc `ispe`
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return ispeSize(buf)

  // SVG — pas de pixels natifs : on prend `width`/`height`, sinon le `viewBox`
  const start = buf.toString('utf-8', 0, Math.min(buf.length, 2048))
  if (/<svg[\s>]/i.test(start)) {
    // `width`/`height`/`viewBox` étaient cherchés dans TOUT le préambule : un
    // enfant (`<rect width="10" height="10"/>`) pouvait fournir la taille à la place du `<svg>`
    // lui-même. On isole d'abord la balise OUVRANTE (jusqu'à son `>`, hors guillemets) et on ne
    // cherche plus que DEDANS.
    const tag = svgOpeningTag(start) ?? ''
    // l'attribut ENTIER (précédé d'un blanc : `stroke-width` n'est pas `width`), et seulement une taille en
    // pixels, nombre nu ou `px` : `100%`, `10em`… ne sont pas des pixels, le `viewBox` donne alors la taille
    const w = tag.match(/\swidth\s*=\s*(["'])\s*(\d*\.?\d+)\s*(?:px)?\s*\1/i)
    const h = tag.match(/\sheight\s*=\s*(["'])\s*(\d*\.?\d+)\s*(?:px)?\s*\1/i)
    if (w && h) return { width: Math.round(Number(w[2])), height: Math.round(Number(h[2])) }
    const vb = tag.match(/\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i)
    if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) }
    return null
  }

  // JPEG — on marche de marqueur en marqueur jusqu'à un « début de trame »
  // le bourrage `0xFF 0xFF…` (un ou plusieurs `0xFF` avant le VRAI marqueur) et
  // les marqueurs SANS champ de longueur (`0xD0`-`0xD9` RSTn/SOI/EOI, `0x01` TEM) faisaient lire
  // une « longueur » fantaisiste au mauvais offset : le balayage désynchronisait et ratait la
  // trame. On saute le bourrage, on avance de 2 (le `0xFF` + le marqueur) sur un marqueur nu, on
  // s'arrête proprement à l'EOI, et chaque lecture est bornée (jamais de RangeError).
  if (buf.readUInt16BE(0) === 0xffd8) {
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      while (buf[i] === 0xff) i++            // bourrage — le marqueur est le premier octet non-FF
      if (i >= buf.length) return null        // bourrage jusqu'à la fin, plus rien à lire
      const marker = buf[i]
      i++                                      // i pointe maintenant juste APRÈS l'octet de marqueur
      if (marker === 0xd9) return null      // EOI — fin de flux, aucune trame trouvée
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue   // TEM/RSTn/SOI : pas de longueur
      if (i + 1 >= buf.length) return null    // pas la place de lire la longueur du segment
      // SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15 : les trames qui portent la taille
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 7 > buf.length) return null   // segment tronqué avant la hauteur/largeur
        return { width: buf.readUInt16BE(i + 5), height: buf.readUInt16BE(i + 3) }
      }
      const length = buf.readUInt16BE(i)
      if (length < 2) return null           // longueur invalide (elle s'inclut elle-même)
      i += length
    }
  }

  return null
}

/** L'animation d'une image, lue dans ses octets sans la décoder : `gif` (au moins deux images), `webp` (animé), `apng` (un bloc
 *  `acTL` avant les données), `avif` (une suite d'images, marque `avis`) ; `null` pour une image fixe, un format inconnu ou
 *  un fichier illisible. Ne lève jamais : chaque lecture est bornée au fichier. */
export function animatedKind(buf: Buffer): 'gif' | 'webp' | 'apng' | 'avif' | null {
  const n = buf.length

  // GIF — on saute les blocs (extensions 0x21, images 0x2C), dès la deuxième image il est animé
  if (n >= 13 && buf.toString('ascii', 0, 4) === 'GIF8') {
    let i            = 13 + ((buf[10] & 0x80) ? 3 << ((buf[10] & 7) + 1) : 0)
    let images       = 0
    const skipBlocks = () => { while (i < n && buf[i] !== 0) i += buf[i] + 1; i++ }
    while (i < n) {
      if (buf[i] === 0x21) {
        i += 2
        skipBlocks()
      }
      else if (buf[i] === 0x2c) {
        if (++images > 1) return 'gif'
        if (i + 10 > n) return null
        i += 11 + ((buf[i + 9] & 0x80) ? 3 << ((buf[i + 9] & 7) + 1) : 0)
        skipBlocks()
      }
      else return null
    }
    return null
  }

  // WebP — l'en-tête étendu (VP8X) porte le drapeau d'animation
  if (n >= 21 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return buf.toString('ascii', 12, 16) === 'VP8X' && (buf[20] & 0x02) !== 0 ? 'webp' : null
  }

  // PNG animé — un bloc acTL avant les données de l'image (blocs : longueur, type, données, somme)
  if (n >= 8 && buf.readUInt32BE(0) === 0x89504e47) {
    for (let i = 8; i + 8 <= n; i += 12 + buf.readUInt32BE(i)) {
      const type = buf.toString('ascii', i + 4, i + 8)
      if (type === 'acTL') return 'apng'
      if (type === 'IDAT' || type === 'IEND') return null
    }
    return null
  }

  // AVIF — la boîte ftyp : marque principale, version, puis les marques compatibles ; `avis` annonce une suite d'images
  if (n >= 16 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const end = Math.min(n, buf.readUInt32BE(0))
    for (let i = 8; i + 4 <= end; i += i === 8 ? 8 : 4) if (buf.toString('ascii', i, i + 4) === 'avis') return 'avif'
  }

  return null
}

/** Nom de fichier d'une variante : `hero-960-<empreinte>.webp`. */
export function variantName(baseName: string, width: number, format: string, digest: string): string {
  return `${baseName}-${width}-${digest}.${format}`
}

let sharpCache: Promise<any | null> | null = null

/**
 * Résout `sharp`, ou `null` s'il n'est pas installé. Trois essais, du plus proche du
 * PROJET au plus proche du framework : c'est l'auteur de l'application qui installe
 * cette dépendance optionnelle, elle vit donc d'abord dans SON `node_modules`.
 * Ne lève JAMAIS : une absence réelle se traduit par `null`.
 */
export async function resolveSharp(): Promise<any | null> {
  if (!sharpCache) {
    sharpCache = (async () => {
      try { return createRequire(join(process.cwd(), 'index.js'))(SHARP) } catch { /* pas dans le projet */ }
      try { return (await import(SHARP)).default } catch { /* pas résolvable depuis ici */ }
      try { return createRequire(import.meta.url)(SHARP) } catch { return null }
    })()
  }
  return sharpCache
}

export interface VariantRequest {
  bytes: Buffer
  baseName: string
  /** Largeurs voulues, déjà bornées à la largeur native (jamais d'agrandissement). */
  widths: number[]
  formats: string[]
  quality: number
}

export interface GeneratedVariant {
  filename: string
  bytes: Buffer
  width: number
  format: string
}

/**
 * Génère les variantes avec `sharp`, s'il est installé. Rend `null` quand il ne l'est
 * pas — c'est au caller de prévenir UNE fois et de laisser passer l'image d'origine :
 * un build ne casse jamais parce qu'un poste n'a pas pu compiler un binaire natif.
 */
export async function generateVariants(req: VariantRequest): Promise<GeneratedVariant[] | null> {
  const sharp = await resolveSharp()
  if (!sharp) return null
  // une image animée garde son animation : sharp ne lit que la première image d'un fichier sauf demande (`animated`), et seul
  // le WebP les réécrit (l'AVIF, le PNG et le JPEG les empileraient en hauteur) ; un PNG ou un AVIF animé, que sharp ne
  // lit pas image par image, n'a aucune variante — le fichier d'origine passe seul
  const animation = animatedKind(req.bytes)
  if (animation === 'apng' || animation === 'avif') return []
  const formats = animation ? req.formats.filter(f => f === 'webp') : req.formats
  const outputs: GeneratedVariant[] = []
  const seen = new Set<string>()
  for (const width of req.widths) {
    for (const format of formats) {
      // try/catch PAR VARIANTE (largeur × format) : sharp peut refuser une combinaison précise
      // (largeur invalide, format non supporté pour ce contenu…) sans que les AUTRES variantes
      // de la même image en pâtissent — le message NOMME l'image, la largeur et le format
      // demandés, jamais le seul message interne brut de sharp.
      let output: any
      // ces réglages font aussi les octets d'une variante : un changement ici avance IMAGE_ENCODING_FORMAT (index des images)
      try {
        const pipeline = sharp(req.bytes, animation ? { animated: true } : undefined).resize({ width: width, withoutEnlargement: true })
        output = await (format === 'avif' ? pipeline.avif({ quality: req.quality })
                     : format === 'webp' ? pipeline.webp({ quality: req.quality })
                     : format === 'png'  ? pipeline.png()
                     : pipeline.jpeg({ quality: req.quality })).toBuffer({ resolveWithObject: true })
      } catch (e: any) {
        throw new Error(`${req.baseName} (${width}px, .${format}) : ${e?.message ?? String(e)}`)
      }
      const bytes: Buffer = output.data
      // LARGEUR RÉELLE, jamais la largeur DEMANDÉE — `withoutEnlargement` PLAFONNE au
      // natif : une largeur demandée au-dessus rend un fichier plus petit que promis. On indexait
      // pourtant la demande, et le `srcset` annonçait des largeurs jamais produites — le
      // navigateur choisit alors sur une information fausse. Le cas arrive dès que
      // `readImageSize` ne reconnaît pas le format : faute de largeur native connue, le filtre de
      // l'appelant (`w <= taille.width`) laisse TOUT passer.
      const real     = typeof output?.info?.width === 'number' ? output.info.width : width
      const digest   = createHash('md5').update(bytes).digest('hex').slice(0, 8)
      const filename = variantName(req.baseName, real, format, digest)
      // deux largeurs demandées plafonnées à la MÊME largeur réelle rendent le même fichier :
      // une seule entrée de `srcset`, jamais un doublon qui annonce deux fois la même image
      if (seen.has(filename)) continue
      seen.add(filename)
      outputs.push({ filename, bytes, width: real, format })
    }
  }
  return outputs
}

// --------------------------------------------------------------------------
// INDEX DES IMAGES — `.mjs-images.json`, dans le dossier de sortie : les variantes qu'une construction a encodées, pour que la
// suivante (un autre processus : `mjs build`, premier passage de `mjs dev`, prérendu) les reprenne au lieu de les réencoder.
// clé : empreinte de ce qui fait les octets d'une variante (nom de base, contenu de l'image, largeurs, formats, qualité, versions
// de sharp, numéro des réglages d'encodage du framework) ; valeur : les variantes, dans l'ordre de generateVariants. Rien du poste (aucun chemin) : le fichier est servi
// avec les sorties. Jamais cru sur parole : chaque fichier repris est relu et vérifié par l'empreinte de son nom
// --------------------------------------------------------------------------

/** une variante telle que l'index la consigne : son fichier (dans le dossier de sortie), sa largeur réelle, son format */
export interface IndexedVariant {
  filename: string
  width: number
  format: string
}

let versionsCache: Promise<string | null> | null = null

/**
 * les versions de `sharp` et des bibliothèques qu'il embarque (libvips, encodeurs), lues une fois par processus dans
 * `sharp.versions` : `null` sans `sharp`, ou quand elles ne disent pas au moins celles de `sharp` et de libvips — aucune
 * variante n'est alors reprise d'une construction à l'autre, chacune s'encode comme avant ; ne lève jamais
 */
export async function sharpVersions(): Promise<string | null> {
  if (!versionsCache) {
    versionsCache = (async () => {
      try {
        const versions = (await resolveSharp())?.versions
        if (typeof versions?.sharp !== 'string' || typeof versions?.vips !== 'string') return null
        return Object.keys(versions).sort().filter(k => typeof versions[k] === 'string').map(k => `${k}@${versions[k]}`).join(' ')
      } catch {
        return null
      }
    })()
  }
  return versionsCache
}

// numéro des réglages d'encodage écrits dans generateVariants (largeur jamais agrandie, animation gardée, appels avif, webp, png et
// jpeg) : ils font aussi les octets d'une variante ; avancé quand l'un d'eux change, il change la clé de chaque image, et les variantes
// encodées par une version d'avant se réencodent au lieu d'être reprises
export const IMAGE_ENCODING_FORMAT = 1

/**
 * clé d'une image dans l'index : `digest` est le md5 du contenu de l'image source, `versions` celles de sharpVersions(), `format` le
 * numéro des réglages d'encodage (IMAGE_ENCODING_FORMAT)
 */
export function imageIndexKey(req: VariantRequest, digest: string, versions: string, format = IMAGE_ENCODING_FORMAT): string {
  return createHash('sha256').update(JSON.stringify([req.baseName, digest, req.widths, req.formats, req.quality, versions, format])).digest('hex')
}

/**
 * les variantes qu'une entrée de l'index consigne, relues dans `dir` : chacune y porte le nom que generateVariants lui donnerait
 * (`variantName`), et le md5 de ses octets commence par l'empreinte de ce nom (le même calcul) ; `null` au premier manque
 * (fichier absent, coupé ou changé) : l'image s'encode de nouveau, l'entrée est remplacée
 */
export function readIndexedVariants(dir: string, baseName: string, listed: IndexedVariant[] | undefined): GeneratedVariant[] | null {
  if (!listed || listed.length === 0) return null
  const variants: GeneratedVariant[] = []
  for (const v of listed) {
    const digest = /-([a-f0-9]{8})\.[a-z0-9]+$/.exec(v.filename)?.[1]
    if (digest === undefined || v.filename !== variantName(baseName, v.width, v.format, digest)) return null
    let bytes: Buffer
    try {
      bytes = readFileSync(join(dir, v.filename))
    } catch {
      return null
    }
    if (!createHash('md5').update(bytes).digest('hex').startsWith(digest)) return null
    variants.push({ filename: v.filename, bytes, width: v.width, format: v.format })
  }
  return variants
}

// une variante bien formée : un nom simple (jamais un chemin ni un fichier caché), une largeur entière, un format
const indexedVariant = (v: any): boolean => v !== null && typeof v === 'object' && typeof v.filename === 'string' && /^[^/\\\0.][^/\\\0]*$/.test(v.filename) && Number.isInteger(v.width) && v.width > 0 && typeof v.format === 'string'

/** l'index lu dans `text` ; vide pour un fichier illisible ou d'une autre forme, ignoré en entier (tout s'encode, il est réécrit) */
export function parseImageIndex(text: string): Map<string, IndexedVariant[]> {
  let read: any
  try {
    read = JSON.parse(text)
  } catch {
    return new Map()
  }
  if (read === null || typeof read !== 'object' || Array.isArray(read)) return new Map()
  const index = new Map<string, IndexedVariant[]>()
  for (const [key, list] of Object.entries(read)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !Array.isArray(list) || list.length === 0 || !list.every(indexedVariant)) return new Map()
    index.set(key, list.map((v: any) => ({ filename: v.filename, width: v.width, format: v.format })))
  }
  return index
}

/** `text` a-t-il la forme de l'index (un objet vide en est un) ? Sinon, dans le dossier des sources, c'est peut-être un fichier de l'auteur */
export function isImageIndex(text: string): boolean {
  try {
    const read = JSON.parse(text)
    return read !== null && typeof read === 'object' && !Array.isArray(read) && Object.entries(read).every(([key, list]) => /^[a-f0-9]{64}$/.test(key) && Array.isArray(list) && list.length > 0 && list.every(indexedVariant))
  } catch {
    return false
  }
}

/** forme écrite de l'index : clés triées, comme `.mjs-outputs.json` — les mêmes entrées donnent les mêmes octets */
export function serializeImageIndex(index: Map<string, IndexedVariant[]>): string {
  return JSON.stringify(Object.fromEntries([...index.keys()].sort().map(k => [k, index.get(k)])), null, 2) + '\n'
}
