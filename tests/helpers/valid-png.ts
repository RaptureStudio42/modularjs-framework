// un PNG valide de dimensions choisies, fabriqué à la main sans bibliothèque d'images
// signature, IHDR, IDAT compressé par zlib, IEND, chaque bloc avec sa somme CRC32
// un gris uni de 8 bits : sharp le décode et le redimensionne comme un vrai fichier, `readImageSize` en lit la taille dans l'en-tête
// un en-tête seul (sans IDAT ni IEND) a la bonne taille mais sharp le refuse (« corrupt header ») : un test qui fait fabriquer des variantes a besoin de celui-ci

import { crc32, deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

// un bloc : longueur des données, type, données, CRC32 du type et des données
const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  return Buffer.concat([u32(data.length), body, u32(crc32(body))])
}

export function validPng(width: number, height: number): Buffer {
  // 8 bits, niveaux de gris, compression et filtrage standard, sans entrelacement
  const header = Buffer.concat([u32(width), u32(height), Buffer.from([8, 0, 0, 0, 0])])
  // chaque ligne : un octet de filtre (0) puis ses pixels (0 = noir)
  const pixels = Buffer.alloc((width + 1) * height)
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
