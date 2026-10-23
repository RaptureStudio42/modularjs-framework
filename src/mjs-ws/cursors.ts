// mjs-ws/cursors — paquet CURSEURS : les curseurs des autres visiteurs d'une page, en direct (l'effet
// `*cursors`, runtime/mjs_fx_cursors.ts). MÊME patron que chat.ts : composé sur l'API publique
// (app.serve/on/room), un salon MJS-WS par page (`opts.prefix` + nom), la présence du salon dit qui
// est là (le client retire le curseur d'un visiteur parti).
//
//   import { mjsWs, cursorsPackage } from 'modularjs-framework/ws'
//   app = mjsWs({ auth: … })
//   app.use(cursorsPackage())
//
// Protocole (préfixe 'cursors:') :
//   cursors:me    CLIENT→SERVEUR (requête)          { max }               → { id, name } (soi : ne pas se montrer ;
//                                                                            max : les curseurs qu'il montre, 20 par défaut)
//   cursors:move  CLIENT→SERVEUR (fire-and-forget)  { room, p, t, f, c }  → rediffusé aux AUTRES membres du salon
//                 SERVEUR→CLIENT                    { room, p, t, f, c, from: { id, name } }
//   cursors:moves SERVEUR→CLIENT                    { room, list }        → un salon d'au moins `groupFrom` membres
//                 (100 par défaut) : les positions regroupées, une trame par quart de seconde à tout le salon — la
//                 dernière de chacun, la plus récente en tête, au plus le plus grand `max` des visiteurs (100 au
//                 plus) et une de plus : chacun écarte la sienne et en montre ses `max` ; rien n'a bougé, rien ne part
//     p : le pointeur — { a: chemin, x, y } (la balise sous la souris, le point en fractions de sa
//         boîte) ou null (hors de la page) ;
//     t : le texte — { k: 'r', a: chemin, ao, b: chemin, bo } (une sélection : début, fin, la fin
//         étant là où se trouve le curseur de texte) ou { k: 'f', a: chemin, s, e } (un champ :
//         la balise, le début et la fin de la sélection) ou null ;
//     f : la balise active — un chemin, ou null ;
//     c : le compte des clics du visiteur (quand il monte, une onde bat chez les autres) ;
//     chemin : les rangs des enfants depuis la zone de l'effet, -1 = entrer dans le shadow root.
//   Tout est VÉRIFIÉ et recopié champ par champ (nombres bornés, chemins de 64 pas au plus) : rien
//   d'autre ne passe. L'identité (`from`) est TOUJOURS résolue ici, jamais reçue du client.
// Débit : un seau à jetons par (salon, identité) — au-delà, la trame est ignorée (un curseur en
// retard vaut mieux qu'une erreur). `opts.canJoin` : même contrat que chat.ts. Regroupées, les
// positions d'une page à 100 visiteurs partent 4 fois par seconde à chacun, au lieu de 100 fois plus.

import type { MjsWsClient, MjsWsLogFn } from './core.js'
import { definePackage } from './packages.js'
import type { MjsPackage } from './packages.js'
import { peerIdOf } from './rooms.js'
import type { MjsWsJoinFn } from './rooms.js'
import { defaultLogOf, nameOf, perRoomBuckets } from './package-helpers.js'
import { t } from '../messages/index.js'

export interface MjsWsCursorsOptions {
  /** préfixe des noms de salon MJS-WS — `app.room(prefix + room)` (défaut `'cursors:'`) */
  prefix?: string
  /** débit PAR IDENTITÉ ET PAR SALON — seau à jetons (défaut `{ rate: 30, burst: 60 }`) */
  rateLimit?: { rate?: number; burst?: number }
  /** garde d'accès à un salon, réévaluée à chaque trame — même contrat que chat.ts */
  canJoin?: MjsWsJoinFn
  /** défaut : console, préfixe '[mjs-ws:cursors]' — journal d'un canJoin qui lève */
  onLog?: MjsWsLogFn
  /** à partir de combien de membres un salon reçoit ses positions regroupées (`cursors:moves`, une
   *  trame par quart de seconde) plutôt qu'une trame par position (défaut 100) */
  groupFrom?: number
}

type CursorPath = number[]

const DEFAULT_PREFIX = 'cursors:'
const DEFAULT_RATE   = 30
const DEFAULT_BURST  = 60
const MAX_PATH       = 64
const MAX_INDEX      = 100000
const MAX_OFFSET     = 1000000
const DEFAULT_GROUP  = 100
const GROUP_EVERY    = 250
const DEFAULT_SHOWN  = 20
const MAX_SHOWN      = 1000
const MAX_GROUPED    = 100

// un chemin : des entiers de -1 (entrer dans un shadow root) à MAX_INDEX, 64 pas au plus ; null sinon
export function cleanPath(v: unknown): CursorPath | null {
  if (!Array.isArray(v) || v.length > MAX_PATH) return null
  for (const n of v) if (!Number.isInteger(n) || n < -1 || n > MAX_INDEX) return null
  return v.slice()
}

const offset   = (v: unknown): number | null => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_OFFSET ? v as number : null
const fraction = (v: unknown): number | null => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : null

// le pointeur reçu, recopié champ par champ ; null s'il manque quoi que ce soit
export function cleanPointer(p: unknown): { a: CursorPath, x: number, y: number } | null {
  if (!p || typeof p !== 'object') return null
  const r = p as Record<string, unknown>
  const a = cleanPath(r.a)
  const x = fraction(r.x)
  const y = fraction(r.y)
  return a && x !== null && y !== null ? { a, x, y } : null
}

/** le compte des clics d'un visiteur : un entier positif, sinon 0 */
export function cleanClicks(c: unknown): number {
  return Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 2147483647 ? c as number : 0
}

// le texte reçu (une sélection, un champ), recopié champ par champ ; null s'il manque quoi que ce soit
export function cleanText(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const a = cleanPath(r.a)
  if (!a) return null
  if (r.k === 'r') {
    const b  = cleanPath(r.b)
    const ao = offset(r.ao)
    const bo = offset(r.bo)
    return b && ao !== null && bo !== null ? { k: 'r', a, ao, b, bo } : null
  }
  if (r.k === 'f') {
    const s = offset(r.s)
    const e = offset(r.e)
    return s !== null && e !== null ? { k: 'f', a, s, e } : null
  }
  return null
}

/** paquet CURSEURS — `app.use(cursorsPackage(opts))` (cf. tête de fichier pour le protocole). */
export function cursorsPackage(opts: MjsWsCursorsOptions = {}): MjsPackage {
  const prefix  = opts.prefix ?? DEFAULT_PREFIX
  const rate    = opts.rateLimit?.rate ?? DEFAULT_RATE
  const burst   = opts.rateLimit?.burst ?? DEFAULT_BURST
  const onLog   = opts.onLog ?? defaultLogOf('cursors')
  const groupFrom = typeof opts.groupFrom === 'number' && opts.groupFrom >= 1 ? Math.floor(opts.groupFrom) : DEFAULT_GROUP
  // un seau par (salon, identité), purgé quand le salon n'a plus de membre
  const seaux   = perRoomBuckets(burst, rate)
  const buckets = seaux.buckets
  let actions   = 0
  // les curseurs que chaque visiteur montre (son `max`, dit par cursors:me)
  const shown   = new WeakMap<MjsWsClient, number>()
  // un salon regroupé : la dernière position de chacun (la plus récente en fin) et l'envoi qui vient
  const waiting = new Map<string, { room: string, list: Map<string, Record<string, unknown>> }>()

  // les positions regroupées d'un salon : une trame à tout le salon, la plus récente en tête, au plus
  // le plus grand `max` de ses visiteurs — borné à MAX_GROUPED : un seul visiteur qui en demande mille ne
  // règle pas la trame de tous — plus une, celle de qui la reçoit (il l'écarte : elle ne prend la place
  // d'aucun autre)
  function flush(app: { room(name: string): { clients: Iterable<MjsWsClient>, send(type: string, p?: unknown): void } }, fullName: string): void {
    const w = waiting.get(fullName)
    waiting.delete(fullName)
    if (!w || w.list.size === 0) return
    const salon = app.room(fullName)
    let cap = 0
    for (const client of salon.clients) cap = Math.max(cap, shown.get(client) ?? DEFAULT_SHOWN)
    salon.send('cursors:moves', { room: w.room, list: [...w.list.values()].reverse().slice(0, Math.min(cap || DEFAULT_SHOWN, MAX_GROUPED) + 1) })
  }

  const bucketOf = seaux.bucketOf

  const pkg = definePackage('cursors', app => {

    app.serve('cursors:me', (p, client) => {
      const max = (p as { max?: unknown } | null)?.max
      if (Number.isInteger(max) && (max as number) >= 1) shown.set(client, Math.min(max as number, MAX_SHOWN))
      return { id: peerIdOf(client), name: nameOf(client) }
    })

    app.on('cursors:move', async (p, client) => {
      const room = p?.room
      if (typeof room !== 'string' || !room || room.length > 200) return
      const fullName = prefix + room
      const salon    = app.room(fullName)
      if (!salon.has(client)) return
      if (opts.canJoin) {
        let ok: unknown
        try { ok = await opts.canJoin(fullName, client) }
        catch (err) { onLog('error', t('ws.cursors.canjoin-a-leve'), { err: err instanceof Error ? err.message : String(err) }); return }
        if (ok === false) return
      }
      // mémoire bornée : les seaux des salons vidés, toutes les 200 trames
      if (++actions >= 200) {
        actions = 0
        seaux.sweep(app)
      }
      const id = peerIdOf(client)
      if (!bucketOf(fullName, id).take()) return
      const move = { room, p: cleanPointer(p?.p), t: cleanText(p?.t), f: cleanPath(p?.f), c: cleanClicks(p?.c), from: { id, name: nameOf(client) } }
      if (salon.size < groupFrom) {
        salon.send('cursors:move', move, { except: client })
        return
      }
      let w = waiting.get(fullName)
      if (!w) {
        w = { room, list: new Map() }
        waiting.set(fullName, w)
        const timer = setTimeout(() => flush(app, fullName), GROUP_EVERY)
        if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
      }
      w.list.delete(id)
      w.list.set(id, move)
    })
  })

  // état interne, pour les tests seulement (même précédent que chat.ts)
  ;(pkg as any)._buckets = buckets
  return pkg
}
