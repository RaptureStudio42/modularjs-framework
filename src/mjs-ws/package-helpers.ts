// mjs-ws/package-helpers — ce que les paquets serveur (chat, cursors, follow, lobby, reactions) recopiaient chacun : le
// nom affiché d'une connexion, le journal par défaut préfixé du nom du paquet, les seaux de débit par (salon, identité) ;
// la comparaison à temps constant des signatures, jetons, clés et hachages ; la suggestion orthographique d'une clé
// inconnue (options des jetons ici, opts.persist et définition de partie de MJS-Server). Une seule copie : un correctif
// ici vaut pour tous.

import { timingSafeEqual } from 'node:crypto'
import type { MjsWsApp, MjsWsClient, MjsWsLogFn, MjsWsLogLevel } from './core.js'
import { TokenBucket } from './guard.js'
import { peerIdOf } from './rooms.js'

/** nom affiché — `identity.name` si c'est une chaîne non vide, sinon repli `peerIdOf(client)` (lui-même `identity.id`
 *  puis `anon:` suivi de `client.id`) : id et nom TOUJOURS résolus serveur, jamais depuis une charge client. `identity.name` est la
 *  convention d'identité PARTAGÉE par les paquets (lobby.ts lit le même champ, accounts.ts l'émet dans le jeton) : elle
 *  se renomme d'un seul tenant, jamais dans un paquet isolé. */
export function nameOf(client: MjsWsClient): string {
  const identity = client.identity
  if (identity && typeof identity === 'object') {
    const name = (identity as Record<string, unknown>).name
    if (typeof name === 'string' && name) return name
  }
  return peerIdOf(client)
}

/** journal console, chaque ligne préfixée `prefixe` (le serveur : `[MJS-WS]`) */
export function consoleLog(prefixe: string): MjsWsLogFn {
  return (level: MjsWsLogLevel, message: string, meta?: unknown): void => {
    const line = `${prefixe} ${message}`
    if (level === 'error') console.error(line, meta ?? '')
    else if (level === 'warn') console.warn(line, meta ?? '')
    else console.log(line, meta ?? '')
  }
}

/** comparaison à temps constant de deux chaînes : jetons et clés de session en texte, signatures et hachages en
 *  hexadécimal (`hex` : comparés octet à octet une fois décodés, seulement s'ils sont tout entiers de l'hexadécimal en
 *  nombre pair de caractères — le décodage s'arrête au premier caractère illisible, une signature suivie de « zz » serait
 *  sinon égale à la signature seule). Longueur d'abord (timingSafeEqual lève sur une longueur différente), jamais un
 *  court-circuit sur le contenu ; une chaîne vide n'est égale à rien, pas même à une autre */
export function safeEqual(a: string, b: string, encoding: 'utf8' | 'hex' = 'utf8'): boolean {
  const ba = Buffer.from(a, encoding)
  const bb = Buffer.from(b, encoding)
  if (ba.length === 0 || ba.length !== bb.length) return false
  if (encoding === 'hex' && (ba.length * 2 !== a.length || bb.length * 2 !== b.length)) return false
  return timingSafeEqual(ba, bb)
}

// --- suggestion orthographique (distance de Levenshtein ≤ 2, sinon aucune) -------------------

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

/** la clé valide la plus proche de `key` (faute de frappe), `null` au-delà d'une distance de 2 */
export function suggestKey(key: string, validKeys: Iterable<string>): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const k of validKeys) { const d = levenshtein(key, k); if (d < bestDist) { bestDist = d; best = k } }
  return best !== null && bestDist <= 2 ? best : null
}

/** journal par défaut d'un paquet : la console, chaque ligne préfixée `[mjs-ws:<nom>]` */
export function defaultLogOf(nom: string): MjsWsLogFn {
  return consoleLog(`[mjs-ws:${nom}]`)
}

/** seaux de débit par (salon, identité) — un seau par identité dans chaque salon, partagé par ses onglets */
export interface MjsWsPerRoomBuckets {
  /** salon → identité → seau (lue telle quelle par les tests des paquets) */
  readonly buckets: Map<string, Map<string, TokenBucket>>
  /** le seau de cette identité dans ce salon, créé plein à la première demande */
  bucketOf(room: string, id: string): TokenBucket
  /** mémoire bornée : retire les seaux des salons vidés (`app.room(salon).size === 0`), jamais ceux d'un salon habité —
   *  ou ceux que dit vides `estVide`, quand l'appelant lit chaque salon une seule fois pour plusieurs registres */
  sweep(app: MjsWsApp | ((room: string) => boolean)): void
}

export function perRoomBuckets(burst: number, rate: number): MjsWsPerRoomBuckets {
  const buckets = new Map<string, Map<string, TokenBucket>>()
  return {
    buckets,
    bucketOf(room, id) {
      let perRoom = buckets.get(room)
      if (!perRoom) { perRoom = new Map(); buckets.set(room, perRoom) }
      let b = perRoom.get(id)
      if (!b) { b = new TokenBucket(burst, rate); perRoom.set(id, b) }
      return b
    },
    sweep(app) {
      const estVide = typeof app === 'function' ? app : (nom: string) => app.room(nom).size === 0
      for (const nom of buckets.keys()) if (estVide(nom)) buckets.delete(nom)
    },
  }
}
