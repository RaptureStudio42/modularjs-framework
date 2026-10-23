// mjs-ws/follow — paquet SUIVRE : l'écran du public suit le défilement du présentateur (un cours, une
// démo, une réunion — l'effet `*follow`, runtime/mjs_fx_follow.ts). MÊME patron que cursors.ts : un
// salon MJS-WS par page ; le serveur garde la dernière position, qu'un retardataire demande en
// arrivant.
//
//   import { mjsWs, followPackage } from 'modularjs-framework/ws'
//   app.use(followPackage({ canLead: (client) => client.identity?.role === 'prof' }))
//
// Protocole (préfixe 'follow:') :
//   follow:at    CLIENT→SERVEUR (fire-and-forget)  { room, a, y }  → rediffusé aux AUTRES membres,
//                                                                      gardé comme dernière position
//                SERVEUR→CLIENT                     { room, a, y, from: { id, name } }
//   follow:last  CLIENT→SERVEUR (requête)          { room }        → { a, y } ou null
//   follow:cursor CLIENT→SERVEUR (fire-and-forget) { room, p, t, f, c }  → rediffusé aux AUTRES membres
//                SERVEUR→CLIENT                     { room, p, t, f, c, from: { id, name } }
//     ce que ceux qui suivent voient aussi de celui qui mène (`*follow(cursor, selection, focus)`) :
//     sa souris (p) et le texte sélectionné (t), dans le même format que *cursors (cleanPointer,
//     cleanText de cursors.ts), la balise active (f, un chemin comme `a`), le compte de ses clics
//     (c : quand il monte, une onde bat chez qui suit) — dans un seul sens : seul qui peut mener est
//     rediffusé
//     a : la balise en haut de l'écran du présentateur — les rangs des enfants depuis la zone de
//         l'effet, -1 = entrer dans un shadow root (1 à 64 pas) ; y : où son haut est coupé par
//         le haut de l'écran, en fraction de sa hauteur (0..1 ; négatif, jusqu'à -1 : le haut de
//         l'écran tombe dans l'espace qui la précède). Rien d'autre ne passe.
// `opts.canLead(client, salon)` : qui peut mener, parmi les membres du salon — sans elle, personne : l'appli désigne
// qui mène (`canLead: () => true` pour tout membre, une salle où chacun a l'effet en `lead: false`).
// Débit : un seau à jetons par (salon, identité).

import type { MjsWsClient, MjsWsLogFn } from './core.js'
import { definePackage } from './packages.js'
import type { MjsPackage } from './packages.js'
import { peerIdOf } from './rooms.js'
import { defaultLogOf, nameOf, perRoomBuckets } from './package-helpers.js'
import { cleanClicks, cleanPath, cleanPointer, cleanText } from './cursors.js'
import { t } from '../messages/index.js'

export interface MjsWsFollowOptions {
  /** préfixe des noms de salon MJS-WS (défaut `'follow:'`) */
  prefix?: string
  /** débit PAR IDENTITÉ ET PAR SALON (défaut `{ rate: 20, burst: 40 }`) */
  rateLimit?: { rate?: number; burst?: number }
  /** qui peut mener, parmi les membres du salon — sans elle, personne ne mène */
  canLead?: (client: MjsWsClient, room: string) => boolean | Promise<boolean>
  /** défaut : console, préfixe '[mjs-ws:follow]' */
  onLog?: MjsWsLogFn
}

/** une position reçue, recopiée champ par champ ; null s'il manque quoi que ce soit */
export function cleanSpot(p: unknown): { a: number[], y: number } | null {
  if (!p || typeof p !== 'object') return null
  const r = p as Record<string, unknown>
  if (!Array.isArray(r.a) || r.a.length === 0 || r.a.length > 64) return null
  for (const n of r.a) if (!Number.isInteger(n) || n < -1 || n > 100000) return null
  const y = r.y
  if (typeof y !== 'number' || !isFinite(y) || y < -1 || y > 1) return null
  return { a: (r.a as number[]).slice(), y: Math.round(y * 10000) / 10000 }
}

/** paquet SUIVRE — `app.use(followPackage(opts))` (cf. tête de fichier pour le protocole). */
export function followPackage(opts: MjsWsFollowOptions = {}): MjsPackage {
  const prefix  = opts.prefix ?? 'follow:'
  const rate    = opts.rateLimit?.rate ?? 20
  const burst   = opts.rateLimit?.burst ?? 40
  const onLog   = opts.onLog ?? defaultLogOf('follow')
  const seaux   = perRoomBuckets(burst, rate)
  const buckets = seaux.buckets
  // la dernière position de chaque salon (partie avec le dernier membre)
  const last    = new Map<string, { a: number[], y: number }>()
  // qui l'a vue, par salon : ceux qui étaient là avant qu'elle soit posée (leur première demande en
  // arrivant, `asked`, date d'avant `at`), celui qui l'a posée, ceux à qui elle a été rendue (`told`) —
  // un salon dont aucun de ces membres n'est resté a été vidé : la position est celle d'un autre cours
  const seen   = new Map<string, { at: number, asked: WeakMap<MjsWsClient, number>, told: WeakSet<MjsWsClient> }>()
  let tick     = 0
  let actions  = 0
  const seenOf = (fullName: string) => {
    let s = seen.get(fullName)
    if (!s) { s = { at: 0, asked: new WeakMap(), told: new WeakSet() }; seen.set(fullName, s) }
    return s
  }

  const pkg = definePackage('follow', app => {
    // mémoire bornée : les seaux, positions et témoins des salons vidés, toutes les 200 demandes
    const sweep = () => {
      if (++actions < 200) return
      actions = 0
      for (const nom of buckets.keys()) if (app.room(nom).size === 0) { buckets.delete(nom); last.delete(nom) }
      for (const nom of seen.keys()) if (app.room(nom).size === 0) seen.delete(nom)
    }

    app.serve('follow:last', (p, client) => {
      const room = p?.room
      if (typeof room !== 'string' || !room || room.length > 200) return null
      const fullName = prefix + room
      const salon    = app.room(fullName)
      if (!salon.has(client)) return null
      sweep()
      const record = seenOf(fullName)
      if (!record.asked.has(client)) record.asked.set(client, ++tick)
      const spot = last.get(fullName)
      if (!spot) return null
      // un membre resté qui l'a vue ? sinon le salon s'était vidé : la position d'avant est celle d'un autre cours
      let found = false
      for (const c of salon.clients) {
        if (c === client) continue
        if (record.told.has(c) || (record.asked.get(c) ?? Infinity) < record.at) { found = true; break }
      }
      if (!found) {
        last.delete(fullName)
        return null
      }
      record.told.add(client)
      return spot
    })

    // qui peut mener : la garde que l'appli donne — sans elle, personne
    const mene = async (client: MjsWsClient, fullName: string): Promise<boolean> => {
      if (!opts.canLead) return false
      try { return (await opts.canLead(client, fullName)) === true }
      catch (err) { onLog('error', t('ws.follow.canlead-a-leve'), { err: err instanceof Error ? err.message : String(err) }); return false }
    }
    // la souris et la sélection de celui qui mène, vers ceux qui suivent — ses propres seaux par (salon, identité). Seuls
    // ceux des salons vidés sont balayés, toutes les 200 trames : jamais tous à la fois, un seau vide le reste
    const souris      = perRoomBuckets(60, 30)
    let actionsSouris = 0
    app.on('follow:cursor', async (p, client) => {
      const room = p?.room
      if (typeof room !== 'string' || !room || room.length > 200) return
      const fullName = prefix + room
      const salon    = app.room(fullName)
      if (!salon.has(client) || !(await mene(client, fullName))) return
      const id  = peerIdOf(client)
      if (++actionsSouris >= 200) { actionsSouris = 0; souris.sweep(app) }
      if (!souris.bucketOf(fullName, id).take()) return
      salon.send('follow:cursor', { room, p: cleanPointer(p?.p), t: cleanText(p?.t), f: cleanPath(p?.f), c: cleanClicks(p?.c), from: { id, name: nameOf(client) } }, { except: client })
    })
    app.on('follow:at', async (p, client) => {
      const room = p?.room
      if (typeof room !== 'string' || !room || room.length > 200) return
      const spot = cleanSpot(p)
      if (!spot) return
      const fullName = prefix + room
      const salon    = app.room(fullName)
      if (!salon.has(client)) return
      if (!(await mene(client, fullName))) return
      sweep()
      const id = peerIdOf(client)
      if (!seaux.bucketOf(fullName, id).take()) return
      const record = seenOf(fullName)
      record.at = ++tick
      record.told.add(client)
      last.set(fullName, spot)
      salon.send('follow:at', { room, a: spot.a, y: spot.y, from: { id, name: nameOf(client) } }, { except: client })
    })
  })
  ;(pkg as any)._last = last
  return pkg
}
