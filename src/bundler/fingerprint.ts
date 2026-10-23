import { createHash } from 'node:crypto'

// empreinte courte des fichiers du build : 5 caractères base 36 (36^5 = 60 466 176 valeurs)
// tirée du md5 du contenu — entier de ses 128 bits modulo 36^5, complété à gauche par des 0
// (longueur fixe, aucun biais mesurable : 2^128 est un multiple presque exact de 36^5)
export const FINGERPRINT_LENGTH = 5

const FINGERPRINT_MODULO = 36n ** BigInt(FINGERPRINT_LENGTH)

/** l'empreinte courte d'un hachage md5 donné en hexadécimal */
export function shortFingerprintFromHex(hex: string): string {
  return (BigInt('0x' + hex) % FINGERPRINT_MODULO).toString(36).padStart(FINGERPRINT_LENGTH, '0')
}

/** l'empreinte courte d'un contenu */
export function shortFingerprint(content: string | Buffer): string {
  return shortFingerprintFromHex(createHash('md5').update(content).digest('hex'))
}
