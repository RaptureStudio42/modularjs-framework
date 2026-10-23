// Règles de lecture de l'option `trustProxy` de MJS WS, reprise telle quelle par `journal.trustProxy` de mjs.config.json : les valeurs
// admises et les refus. Communes au temps réel (mjs-ws/trust-proxy.ts en tire les pairs de confiance) et à la validation de la config
// (bundler/config.ts) : hors de mjs-ws/, pour que le constructeur et l'aide de test n'embarquent pas le code du temps réel. Rien n'est
// construit au chargement du module (aucune instruction de premier niveau) : un paquet qui l'importe sans valider de config n'en garde rien.

import { BlockList, isIP } from 'node:net'
import { t } from './messages/index.js'

/** l'option lue : les adresses et plages de confiance ; `local` = croire aussi un pair sans adresse (socket unix) */
export interface TrustProxyList {
  list: BlockList
  local: boolean
}

// une valeur à montrer dans un message d'erreur ; jamais d'exception ici (BigInt, structure circulaire…) : le message voulu doit sortir
function show(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value) }
  catch { return String(value) }
}

// la plus large des plages acceptées : plus large, elle contiendrait des visiteurs directs, crus sur parole comme un proxy
const MAX_RANGE_V4 = 8
const MAX_RANGE_V6 = 16

// vrai si la plage IPv6 `adresse/bits` contient cette adresse
function contains(address: string, bits: number, probe: string): boolean {
  const range = new BlockList()
  range.addSubnet(address, bits, 'ipv6')
  return range.check(probe, 'ipv6')
}

// l'espace des adresses IPv4 écrites en IPv6 (::ffff:0:0/96) : une liste ne distingue pas ::ffff:10.0.0.1 de 10.0.0.1
function inMappedV4(address: string): boolean {
  return contains('::ffff:0.0.0.0', 96, address)
}

// la famille et la limite qu'une plage dépasse, `null` si elle les respecte. Une plage IPv6 qui contient l'espace IPv4 mappé, ou qui
// s'y trouve, se mesure en IPv4 : `::/16` croirait tout pair IPv4
function tooWide(address: string, family: number, bits: number): { family: string; max: number } | null {
  if (family === 4) return bits < MAX_RANGE_V4 ? { family: 'IPv4', max: MAX_RANGE_V4 } : null
  if (bits < MAX_RANGE_V6) return { family: 'IPv6', max: MAX_RANGE_V6 }
  const mapped = bits <= 96 ? contains(address, bits, '::ffff:0.0.0.0') : bits < 96 + MAX_RANGE_V4 && inMappedV4(address)
  return mapped ? { family: 'IPv4', max: MAX_RANGE_V4 } : null
}

// une entrée de liste : adresse, ou plage `adresse/bits` ; une plage de 0 bit couvre le monde entier, c'est `true` ; une plage trop large
// pour un proxy (cf. tooWide) laisserait des visiteurs directs choisir leur adresse
function addEntry(list: BlockList, entry: unknown): void {
  const invalid = () => new Error(t('ws.trust-proxy.entree-invalide', { entry: show(entry) }))
  if (typeof entry !== 'string') throw invalid()
  const [address, bits, ...rest] = entry.trim().split('/')
  const family                   = isIP(address)
  if (rest.length > 0 || family === 0 || address.includes('%')) throw invalid()
  const type = family === 4 ? 'ipv4' : 'ipv6'
  if (bits === undefined) { list.addAddress(address, type); return }
  if (!/^\d{1,3}$/.test(bits) || Number(bits) > (family === 4 ? 32 : 128)) throw invalid()
  if (Number(bits) === 0) throw new Error(t('ws.trust-proxy.plage-trop-large', { entry: show(entry) }))
  const wide = tooWide(address, family, Number(bits))
  if (wide) throw new Error(t('ws.trust-proxy.plage-trop-etendue', { entry: show(entry), family: wide.family, max: wide.max }))
  list.addSubnet(address, Number(bits), type)
}

/**
 * Lit une valeur de `trustProxy`. `null` = aucun proxy de confiance (absent, `false`, `null`, liste vide) ; `'loopback'` = la boucle
 * locale (127.0.0.0/8, ::1) et les sockets unix ; une liste = ses adresses et plages. `true`, une chaîne autre que `'loopback'`, une
 * entrée qui n'est ni une adresse ni une plage, une plage de 0 bit ou plus large que /8 en IPv4 (/16 en IPv6) : refusés en clair, jamais
 * ignorés en silence. Les valeurs fausses qui ne sont pas `false` (0, chaîne vide) sont refusées aussi.
 */
export function parseTrustProxy(raw: unknown): TrustProxyList | null {
  if (raw === undefined || raw === null || raw === false) return null
  if (raw === true) throw new Error(t('ws.trust-proxy.vrai-refuse'))
  if (raw === 'loopback') {
    const list = new BlockList()
    list.addSubnet('127.0.0.0', 8, 'ipv4')
    list.addAddress('::1', 'ipv6')
    return { list, local: true }
  }
  if (!Array.isArray(raw)) throw new Error(t('ws.trust-proxy.valeur-invalide', { raw: show(raw) }))
  if (raw.length === 0) return null
  const list = new BlockList()
  for (const entry of raw) addEntry(list, entry)
  return { list, local: false }
}
