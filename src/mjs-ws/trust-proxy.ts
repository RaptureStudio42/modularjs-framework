// mjs-ws/trust-proxy — l'option `trustProxy` : à quels pairs croire quand ils annoncent, dans X-Forwarded-For ou
// X-Real-IP, l'adresse du vrai visiteur.
//
// derrière nginx (ou tout proxy inverse), la socket du serveur ne voit que l'adresse du proxy : 127.0.0.1, ou
// rien du tout sur une socket unix. Tous les visiteurs partagent alors la même adresse, et les bornes par
// adresse (limits.maxConnectionsPerIp, mise au banc par IP, débit par IP, anti-force-brute des comptes, verrou
// des codes de partie de MJS-Server) deviennent des bornes GLOBALES : dix codes faux d'un visiteur bloquent tout
// le monde.
//
//   trustProxy absent ou false          rien ne change : l'adresse de la socket
//   trustProxy: 'loopback'              croire les en-têtes d'un pair de boucle (127.0.0.0/8, ::1, socket unix)
//   trustProxy: ['10.0.0.0/8', '1.2.3.4']   croire les en-têtes d'un pair de cette liste (adresses ou plages)
//   trustProxy: true                    REFUSÉ : tout visiteur direct pourrait choisir son adresse
//
// une plage plus large que /8 en IPv4, ou que /16 en IPv6, est refusée de même : elle contiendrait des visiteurs directs (deux plages
// /1 qui se partagent IPv4 reviennent à `true`).
//
// quand le pair est de confiance, deux en-têtes peuvent nommer le visiteur : X-Real-IP, et l'entrée la plus à
// DROITE de X-Forwarded-For qui n'est pas elle-même un proxy de confiance (on remonte la chaîne de droite à gauche :
// le proxy ajoute la vraie adresse à droite, ce qu'un visiteur écrit à gauche ne compte pas). Un proxy n'écrit
// souvent que l'un des deux et laisse passer l'autre tel que le visiteur l'a envoyé : nginx avec la seule ligne
// X-Real-IP, HAProxy (`option forwardfor`) ou AWS ALB avec le seul X-Forwarded-For. On ne sait pas lequel des deux
// est le bon, donc :
//   X-Real-IP lisible, pas un proxy de confiance   le visiteur, si X-Forwarded-For est absent ou désigne le même ;
//                                                  sinon (les deux se contredisent, ou X-Forwarded-For illisible)
//                                                  le pair, avec un avertissement unique pour tout le processus
//   X-Real-IP absent, illisible, ou proxy de       le visiteur de X-Forwarded-For (un CDN devant nginx) ; sinon
//   confiance                                      le pair
// Un en-tête malformé ne lève jamais. Les adresses sont ramenées à la forme que le système écrit (minuscules, IPv6
// abrégée, IPv4 mappée en IPv4).
//
// consommé par les transports intégrés (transport-ws.ts, transport-uws.ts), seuls à connaître le pair réel :
// `meta.address`, lu par tous les plafonds, porte ensuite l'adresse retenue.

import { BlockList, SocketAddress, isIP } from 'node:net'
import { t } from '../messages/index.js'
import { parseTrustProxy } from '../trust-proxy-rules.js'
import { normalizeRemoteAddress } from './transport.js'
import type { MjsWsRemoteInfo } from './transport.js'

/** réglage public de `opts.trustProxy` — `true` n'en fait volontairement pas partie : refusé, trop large */
export type MjsWsTrustProxy = false | 'loopback' | string[]

type Headers = MjsWsRemoteInfo['headers']

/** les pairs de confiance, une fois l'option lue */
export interface MjsWsTrustedProxies {
  /** vrai si ce pair est un proxy de confiance ; `undefined` = aucune adresse (socket unix) */
  trusts(address: string | undefined): boolean
}

/** adresse retenue pour une connexion : pair brut (tel que le transport le lit) et en-têtes de la requête d'upgrade */
export type MjsWsAddressResolver = (rawPeer: string | undefined, headers: Headers) => string | undefined

// adresse IP lue dans un texte libre (en-tête, socket), ramenée à la forme du système ; `null` si ce n'est pas
// une adresse : port collé, zone, nom, texte vide, forme décimale à zéros initiaux…
function canonical(text: string): string | null {
  const family = isIP(text)
  if (family === 0 || text.includes('%')) return null
  if (family === 4) return text
  try { return normalizeRemoteAddress(new SocketAddress({ address: text, family: 'ipv6' }).address) ?? null }
  catch { return null }
}

function inList(list: BlockList, address: string): boolean {
  try { return list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6') }
  catch { return false }
}

function trustedFrom(list: BlockList, local: boolean): MjsWsTrustedProxies {
  return {
    trusts(address) {
      if (address === undefined) return local
      const ip = canonical(address)
      return ip !== null && inList(list, ip)
    },
  }
}

/**
 * Lit `opts.trustProxy`. `null` = aucun proxy de confiance (absent, `false`, `null`, liste vide) ; sinon les
 * pairs de confiance. `true`, une chaîne autre que `'loopback'`, une entrée de liste qui n'est ni une adresse ni
 * une plage, une plage de 0 bit ou plus large que /8 en IPv4 (/16 en IPv6) : refusés en clair, jamais ignorés en silence. Les valeurs fausses qui ne sont
 * pas `false` (0, chaîne vide) sont refusées aussi : le test est strict, pas « faux ou vide ».
 */
export function resolveTrustProxy(raw: unknown): MjsWsTrustedProxies | null {
  const read = parseTrustProxy(raw)
  return read === null ? null : trustedFrom(read.list, read.local)
}

const LOOPBACK = resolveTrustProxy('loopback')!

// un en-tête de requête en une chaîne ; répété (tableau), il se lit dans l'ordre, comme une seule liste ; vide = absent
function headerText(headers: Headers, name: string): string | undefined {
  const raw  = headers?.[name]
  const text = (Array.isArray(raw) ? raw.join(', ') : raw ?? '').trim()
  return text === '' ? undefined : text
}

// la chaîne de droite à gauche : la première entrée qui n'est pas un proxy de confiance est le visiteur ; si
// toutes en sont un, le début de la chaîne ; une entrée illisible rend la chaîne douteuse (`null`)
function fromChain(chain: string, trusted: MjsWsTrustedProxies): string | null {
  const hops = chain.split(',')
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = canonical(hops[i].trim())
    if (hop === null) return null
    if (i === 0 || !trusted.trusts(hop)) return hop
  }
  return null
}

let conflictWarned = false

// X-Real-IP et X-Forwarded-For en désaccord : l'un des deux vient du visiteur ; un avertissement pour tout le
// processus, et une console qui lève ne touche jamais à la connexion
function warnConflict(): void {
  if (conflictWarned) return
  conflictWarned = true
  try { console.warn(t('ws.trust-proxy.en-tetes-contradictoires')) }
  catch { /* journal cassé : jamais de quoi empêcher une connexion */ }
}

/**
 * L'adresse retenue pour une connexion. Sans proxy de confiance, ou pair qui n'en est pas un : exactement
 * l'adresse de la socket, normalisée comme avant, en-têtes ignorés. Pair de confiance : X-Real-IP lisible qui n'est
 * pas lui-même un proxy de confiance, si X-Forwarded-For est absent ou désigne le même visiteur (entrée la plus à
 * droite qui n'est pas un proxy de confiance) ; les deux en désaccord, ou X-Forwarded-For illisible : le pair, avec
 * un avertissement unique. X-Real-IP absent, illisible ou proxy de confiance : le visiteur de X-Forwarded-For, à
 * défaut le pair.
 */
export function visitorAddress(rawPeer: string | undefined, headers: Headers, trusted: MjsWsTrustedProxies | null): string | undefined {
  const peer = normalizeRemoteAddress(rawPeer)
  if (trusted === null || !trusted.trusts(rawPeer)) return peer
  const real      = headerText(headers, 'x-real-ip')
  const realIp    = real === undefined ? null : canonical(real)
  const chain     = headerText(headers, 'x-forwarded-for')
  const forwarded = chain === undefined ? null : fromChain(chain, trusted)
  if (realIp === null || trusted.trusts(realIp)) return forwarded ?? peer
  if (chain === undefined || forwarded === realIp) return realIp
  warnConflict()
  return peer
}

/** vrai si des en-têtes de proxy arrivent d'un pair de boucle (ou d'une socket unix) : un proxy local dont on ne lit pas les en-têtes */
export function proxyHeadersFromLocalPeer(rawPeer: string | undefined, headers: Headers): boolean {
  if (headerText(headers, 'x-forwarded-for') === undefined && headerText(headers, 'x-real-ip') === undefined) return false
  return LOOPBACK.trusts(rawPeer)
}

/**
 * Le résolveur d'adresse d'un transport. Lève tout de suite sur une valeur fausse de `trustProxy`. `onProxyHeaders`
 * (l'avertisseur) n'est armé que si l'option est ABSENTE — `false` ou une liste sont des choix explicites — et ne
 * part qu'une fois, au premier en-tête de proxy venu d'un pair de boucle ; un avertisseur qui lève ne touche jamais
 * à la connexion.
 */
export function createAddressResolver(trustProxy: unknown, onProxyHeaders?: () => void): MjsWsAddressResolver {
  const trusted = resolveTrustProxy(trustProxy)
  let pending   = trustProxy === undefined ? onProxyHeaders : undefined
  return (rawPeer, headers) => {
    if (pending && proxyHeadersFromLocalPeer(rawPeer, headers)) {
      const warn = pending
      pending    = undefined
      try { warn() }
      catch { /* journal cassé : jamais de quoi empêcher une connexion */ }
    }
    return visitorAddress(rawPeer, headers, trusted)
  }
}
