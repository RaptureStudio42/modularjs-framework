// de petits fichiers animés fabriqués à la main, sans aucune bibliothèque : un vrai GIF lisible partout (une couleur unie
// par image, rouge, vert, bleu à tour de rôle) et les en-têtes d'un WebP animé, d'un PNG animé et d'un AVIF animé,
// assez pour qu'on les reconnaisse (ils ne se décodent pas)

import { deflateSync } from 'node:zlib'

const u16 = (n: number): number[] => [n & 255, n >> 8]
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }

// un GIF de `images` images de `w` × `h` pixels, `delai` centièmes de seconde entre deux images, qui boucle sans fin ;
// `locale` (1 à 7) donne à CHAQUE image sa propre table de couleurs de 2^(locale + 1) couleurs, après son en-tête
// (c'est ce que fabriquent la plupart des encodeurs) ; la table globale reste écrite
export function gifAnime(images: number, w = 8, h = 8, delai = 10, locale?: number): Buffer {
  const octets: number[] = [...Buffer.from('GIF89a')]
  // quatre couleurs : rouge, vert, bleu, noir
  octets.push(...u16(w), ...u16(h), 0xf1, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0)
  if (images > 1) octets.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0)
  for (let f = 0; f < images; f++) {
    octets.push(0x21, 0xf9, 4, 0, ...u16(delai), 0, 0)
    octets.push(0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), locale === undefined ? 0 : 0x80 | locale)
    // la table locale : rouge, vert, bleu, noir, puis la suite en boucle, sans octet nul qui ressemblerait à une fin de bloc
    if (locale !== undefined) for (let i = 0; i < 3 << (locale + 1); i++) octets.push([255, 0, 0, 0, 255, 0, 0, 0, 255, 17, 17, 17][i % 12] || 9)
    octets.push(2)
    // LZW sans compression : un code d'effacement tous les deux pixels, chaque code sur trois bits
    const bits: number[] = []
    const code = (c: number) => { for (let b = 0; b < 3; b++) bits.push((c >> b) & 1) }
    for (let i = 0; i < w * h; i += 2) {
      code(4)
      code(f % 3)
      if (i + 1 < w * h) code(f % 3)
    }
    code(5)
    const data: number[] = []
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b, k) => n | (b << k), 0))
    for (let i = 0; i < data.length; i += 255) octets.push(Math.min(255, data.length - i), ...data.slice(i, i + 255))
    octets.push(0)
  }
  octets.push(0x3b)
  return Buffer.from(octets)
}

// l'en-tête d'un WebP étendu (VP8X) : animé ou non
function webp(animation: boolean): Buffer {
  const vp8x = Buffer.concat([Buffer.from([animation ? 0x02 : 0x00, 0, 0, 0]), Buffer.from([15, 0, 0]), Buffer.from([15, 0, 0])])
  const chunks = Buffer.concat([Buffer.from('VP8X'), Buffer.from([10, 0, 0, 0]), vp8x, animation ? Buffer.from('ANIM\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1') : Buffer.alloc(0)])
  return Buffer.concat([Buffer.from('RIFF'), Buffer.from([chunks.length + 4, 0, 0, 0]), Buffer.from('WEBP'), chunks])
}
export const webpAnime = (): Buffer => webp(true)
export const webpFixe  = (): Buffer => webp(false)

// un PNG en niveaux de gris de `w` × 8 pixels, avec ou sans le bloc acTL qui en fait un PNG animé (sharp lit alors sa première image)
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc   = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function png(animation: boolean, w: number): Buffer {
  const bloc = (type: string, data: Buffer) => { const corps = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([u32(data.length), corps, u32(crc(corps))]) }
  const tete = Buffer.concat([u32(w), u32(8), Buffer.from([8, 0, 0, 0, 0])])
  const actl = animation ? bloc('acTL', Buffer.concat([u32(3), u32(0)])) : Buffer.alloc(0)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', tete), actl, bloc('IDAT', deflateSync(Buffer.alloc((w + 1) * 8))), bloc('IEND', Buffer.alloc(0))])
}
export const apngAnime = (w = 1200): Buffer => png(true, w)
// un PNG dont le bloc acTL arrive APRÈS les données de l'image : la norme l'exige avant, ce n'est pas une animation
export function apngTardif(w = 1200): Buffer {
  const fixe = png(false, w)
  const iend = fixe.length - 12
  const actl = Buffer.concat([u32(8), Buffer.from('acTL'), u32(3), u32(0)])
  return Buffer.concat([fixe.subarray(0, iend), Buffer.concat([actl, u32(crc(actl.subarray(4)))]), fixe.subarray(iend)])
}
export const pngFixe   = (w = 1200): Buffer => png(false, w)

// la boîte ftyp d'un AVIF : une image fixe (`avif`) ou une suite d'images (`avis`)
function avif(animation: boolean): Buffer {
  const marques = animation ? ['avis', 'avif', 'mif1'] : ['avif', 'mif1']
  const corps   = Buffer.concat([Buffer.from(animation ? 'avis' : 'avif'), u32(0), ...marques.map((m) => Buffer.from(m))])
  return Buffer.concat([u32(corps.length + 8), Buffer.from('ftyp'), corps])
}
export const avifAnime = (): Buffer => avif(true)
export const avifFixe  = (): Buffer => avif(false)

// un GIF de `images` images de 1 × 1 pixel posées sur un écran logique de `w` × `h` : quelques octets, mais pour sharp chaque
// image pèse `w` × `h` pixels, donc `w` × `h` × `images` pour l'ensemble (de quoi dépasser sa limite avec un tout petit fichier)
export function gifEcranGeant(images: number, w = 1280, h = 720): Buffer {
  const octets: number[] = [...Buffer.from('GIF89a'), ...u16(w), ...u16(h), 0xf1, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]
  octets.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0)
  for (let f = 0; f < images; f++) {
    octets.push(0x21, 0xf9, 4, 0, ...u16(10), 0, 0)
    octets.push(0x2c, 0, 0, 0, 0, ...u16(1), ...u16(1), 0, 2, 2, 0x44, 0x01, 0)
  }
  octets.push(0x3b)
  return Buffer.from(octets)
}
