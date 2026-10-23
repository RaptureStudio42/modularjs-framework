// mjs-ws/reactions — paquet RÉACTIONS : un émoji cliqué s'envole chez tous les visiteurs d'une page,
// comme pendant un direct (l'effet `*react(server: …)`, runtime/mjs_fx_react.ts). MÊME patron que
// cursors.ts : composé sur l'API publique, un salon MJS-WS par page (`opts.prefix` + nom).
//
//   import { mjsWs, reactionsPackage } from 'modularjs-framework/ws'
//   app.use(reactionsPackage())
//
// Protocole (préfixe 'reactions:') :
//   reactions:send  CLIENT→SERVEUR (fire-and-forget)  { room, e }  → rediffusé aux AUTRES membres
//                   SERVEUR→CLIENT                     { room, e, from: { id, name } }
//     e : l'émoji — court (16 unités au plus) : des pictogrammes seulement (émojis, drapeaux, touches,
//         teintes, familles liées), sinon n'importe qui écrirait à toute la page ; `opts.emojis` donne
//         la liste permise (texte compris). L'identité (`from`) est TOUJOURS résolue ici.
// Débit : un seau à jetons par (salon, identité) — au-delà, l'émoji est ignoré. `opts.canJoin` : même
// contrat que chat.ts.

import type { MjsWsClient, MjsWsLogFn } from './core.js'
import { definePackage } from './packages.js'
import type { MjsPackage } from './packages.js'
import { peerIdOf } from './rooms.js'
import type { MjsWsJoinFn } from './rooms.js'
import { defaultLogOf, nameOf, perRoomBuckets } from './package-helpers.js'
import { t } from '../messages/index.js'

export interface MjsWsReactionsOptions {
  /** préfixe des noms de salon MJS-WS — `app.room(prefix + room)` (défaut `'reactions:'`) */
  prefix?: string
  /** débit PAR IDENTITÉ ET PAR SALON — seau à jetons (défaut `{ rate: 5, burst: 10 }`) */
  rateLimit?: { rate?: number; burst?: number }
  /** les émojis permis, texte compris (défaut : tout pictogramme — jamais de texte) */
  emojis?: string[]
  /** garde d'accès à un salon, réévaluée à chaque émoji — même contrat que chat.ts */
  canJoin?: MjsWsJoinFn
  /** défaut : console, préfixe '[mjs-ws:reactions]' */
  onLog?: MjsWsLogFn
}

// un ou plusieurs pictogrammes : émoji (et ses teintes, variantes, liaisons), drapeau, touche `1️⃣`,
// drapeau de région (caractères d'étiquette) ; au moins un vrai pictogramme
const PICTOS   = /^(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}|\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u200D\uFE0E\uFE0F]|[\u{E0020}-\u{E007F}])+$/u
const UN_PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u

/** un émoji reçu, s'il est permis ; null sinon */
export function cleanEmoji(e: unknown, allowed?: string[]): string | null {
  if (typeof e !== 'string' || e === '' || e.length > 16) return null
  if (/[<>&"'`\u0000-\u001f\u007f]/.test(e)) return null
  if (allowed) return allowed.includes(e) ? e : null
  return PICTOS.test(e) && UN_PICTO.test(e) ? e : null
}

/** paquet RÉACTIONS — `app.use(reactionsPackage(opts))` (cf. tête de fichier pour le protocole). */
export function reactionsPackage(opts: MjsWsReactionsOptions = {}): MjsPackage {
  const prefix  = opts.prefix ?? 'reactions:'
  const rate    = opts.rateLimit?.rate ?? 5
  const burst   = opts.rateLimit?.burst ?? 10
  const onLog   = opts.onLog ?? defaultLogOf('reactions')
  const seaux   = perRoomBuckets(burst, rate)
  const buckets = seaux.buckets
  let actions   = 0

  const pkg = definePackage('reactions', app => {
    app.on('reactions:send', async (p, client) => {
      const room = p?.room
      if (typeof room !== 'string' || !room || room.length > 200) return
      const e = cleanEmoji(p?.e, opts.emojis)
      if (!e) return
      const fullName = prefix + room
      const salon    = app.room(fullName)
      if (!salon.has(client)) return
      if (opts.canJoin) {
        let ok: unknown
        try { ok = await opts.canJoin(fullName, client) }
        catch (err) { onLog('error', t('ws.reactions.canjoin-a-leve'), { err: err instanceof Error ? err.message : String(err) }); return }
        if (ok === false) return
      }
      // mémoire bornée : les seaux des salons vidés, toutes les 200 trames
      if (++actions >= 200) {
        actions = 0
        seaux.sweep(app)
      }
      const id = peerIdOf(client)
      if (!seaux.bucketOf(fullName, id).take()) return
      salon.send('reactions:send', { room, e, from: { id, name: nameOf(client) } }, { except: client })
    })
  })
  ;(pkg as any)._buckets = buckets
  return pkg
}
