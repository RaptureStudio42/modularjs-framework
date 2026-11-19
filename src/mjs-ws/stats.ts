// mjs-ws/stats — « l'état du serveur » : registre de compteurs LÉGER, TOUJOURS actif —
// connections/messages/guard/rooms/streams/bridge/adapter/sessions/errors +
// réservoir des intervalles entre deux µ:ping (p50/p95). Créé UNE FOIS par app (core.ts), passé en ÉCRITURE aux
// moteurs qui en ont besoin (streams.ts, sessions.ts, bridge.ts) — rooms.ts n'écrit RIEN ici, ses
// gauges (nombre de salons, membres) sont lues EN DIRECT à la demande (cf. MjsWsStatsGauges plus
// bas) : jamais deux sources de vérité, jamais de drift. app.stats() (core.ts) assemble le tout en
// un instantané JSON. Le pont (bridge.ts) sert cet instantané en HTTP (GET /stats), sa forme texte
// Prometheus (GET /metrics, cf. toPrometheusText) et une page HTML sombre (GET /state, cf.
// stats-page.ts) — SEULEMENT si l'option `stats` de mjsWs() est active (le registre, lui, tourne
// toujours : app.stats() marche même sans pont). cf. docs/23-mjs-ws.md « L'état du serveur ».

import { randomBytes } from 'node:crypto'

// --- réservoir de mesures en ms (intervalles entre deux µ:ping) — échantillon glissant borné, p50/p95
// calculés à la demande. Le nom de la classe et de son type sont restés (`Latency…`, exportés) : c'est la mesure
// exposée qui a changé de nom, `pingIntervals` — le serveur ne voit que l'écart entre deux pings reçus d'une
// connexion (≈ la période du battement client), jamais un aller-retour (le client ne répond pas à un ping du
// serveur) ; l'aller-retour se mesure côté client (`sock.latency`) ---

export const LATENCY_RESERVOIR_SIZE = 256

/** Anneau borné de mesures (ms) — au-delà de LATENCY_RESERVOIR_SIZE valeurs, les plus anciennes
 *  sont écrasées (fenêtre GLISSANTE) plutôt que jetées par un shift() O(n) inutile. */
export class LatencyReservoir {
  private _buf: number[] = []
  private _idx = 0

  push(ms: number): void {
    if (this._buf.length < LATENCY_RESERVOIR_SIZE) this._buf.push(ms)
    else { this._buf[this._idx] = ms; this._idx = (this._idx + 1) % LATENCY_RESERVOIR_SIZE }
  }

  get size(): number { return this._buf.length }

  percentiles(): MjsWsStatsLatencies {
    if (this._buf.length === 0) return { p50: null, p95: null, samples: 0 }
    const sorted = this._buf.slice().sort((a, b) => a - b)
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]
    return { p50: at(0.50), p95: at(0.95), samples: sorted.length }
  }
}

// --- cause d'expulsion de garde — cf. guard.ts pour les primitives, core.ts pour les call-sites,
// « trop de messages invalides » (JSON) est comptée sous 'rate' (même seuil kickAfter, même
// famille d'abus « le client envoie trop », pas une 5e catégorie) ---

export type MjsWsGuardCause = 'rate' | 'silence' | 'backpressure' | 'payload'

export interface MjsWsStatsLatencies {
  p50: number | null
  p95: number | null
  samples: number
}

// --- familles de compteurs — cf. docs/23-mjs-ws.md « L'état du serveur » pour le sens de chacune ---

export interface MjsWsStatsConnections {
  active: number
  parked: number
  welcomed: number
  refused: number
  closed: number
  /** plafond de connexions — connexions refusées AVANT le hello par
   *  limits.maxConnections/maxConnectionsPerIp (core.ts::refuseForCap), DISTINCT de `refused`
   *  ci-dessus (celui-ci compte les µ:denied applicatifs POST-hello, cf. sendDeniedAndClose). */
  refusedCap: number
  /** vérification d'origine — connexions refusées AVANT le hello par
   *  opts.verifyOrigin (core.ts::refuseForOrigin), DISTINCTE de `refused`/`refusedCap` :
   *  même famille « refus pré-hello », pas une décision applicative. */
  refusedOrigin: number
  /** mise au banc — connexions refusées parce que leur IP (à l'arrivée) ou leur compte (au hello,
   *  µ:denied, compté AUSSI dans `refused`) est au banc, cf. core.ts::refuseForBan/handleHello */
  refusedBan: number
}

export interface MjsWsStatsMessages {
  received: number
  sent: number
  buffered: number
  replayed: number
  dropped: number
  /** trames BINAIRES reçues (socle du futur µschema) — comptée AVANT toute garde,
   *  même politique que `received` pour le texte (cf. core.ts::handleBinaryRaw). */
  binaryReceived: number
  /** sous-ensemble de `binaryReceived` : ignorée faute d'authentification, d'accroche interne, OU
   *  (µschema) id de schéma inconnu/trame corrompue — jamais un crash, µ:error
   *  SEULEMENT en mode ws.codec 'binary' (cf. core.ts::handleBinaryRaw, mjs-ws/schema.ts). */
  binaryIgnored: number
  /** µschema — trame TEXTE applicative (t hors préfixe µ:) reçue alors que
   *  ws.codec === 'binary' (strict) : rejetée avant tout routage, µ:error throttlé envoyé (cf.
   *  mjs-ws/schema.ts::rejectIfStrictText, core.ts::handleRaw). Zéro en dehors du mode 'binary'. */
  textRejected: number
}

export interface MjsWsStatsGuard {
  kicksRate: number
  kicksSilence: number
  kicksBackpressure: number
  kicksPayload: number
  /** fermetures pour JETON EXPIRÉ (core.ts::expireClientToken) — DÉDIÉE, hors de
   *  l'union MjsWsGuardCause : cette fermeture ne passe jamais par kickClient (µ:error{code}
   *  spécifique, code de fermeture 4002, jamais de µ:bye — cf. son commentaire de tête core.ts). */
  tokenExpired: number
  /** mises au banc prononcées par CE process (une par clé : compte ou IP), cf. core.ts::noteFault */
  bans: number
}

/** gauges — lues EN DIRECT depuis rooms.ts à la demande (jamais accumulées ici, jamais de drift) */
export interface MjsWsStatsRooms {
  count: number
  membersTotal: number
  presenceSubscribers: number
}

export interface MjsWsStatsStreams {
  /** gauge — lue EN DIRECT depuis streams.ts à la demande, cf. MjsWsStatsRooms ci-dessus */
  count: number
  deltasEmitted: number
  resyncsReplay: number
  resyncsReset: number
}

export interface MjsWsStatsBridge {
  requestsByEndpoint: Record<string, number>
  http401: number
  /** limite de débit — 429 renvoyés (seau général OU seau-échecs), cf. bridge.ts */
  rateLimited: number
  webhooksSent: number
  webhooksFailed: number
  webhooksAbandoned: number
}

export interface MjsWsStatsAdapter {
  published: number
  received: number
  ignoredOrigin: number
  reordered: number
  reconnects: number
}

export interface MjsWsStatsSessions {
  issued: number
  resumed: number
  expired: number
  overflowed: number
}

export interface MjsWsStatsErrors {
  errors: number
  warnings: number
}

export interface MjsWsStatsSnapshot {
  /** secondes écoulées depuis app.listen() — cf. core.ts, posé au moment de créer le registre */
  uptime: number
  processId: string
  timestamp: number
  memory: { rss: number }
  connections: MjsWsStatsConnections
  messages: MjsWsStatsMessages
  guard: MjsWsStatsGuard
  rooms: MjsWsStatsRooms
  streams: MjsWsStatsStreams
  bridge: MjsWsStatsBridge
  adapter: MjsWsStatsAdapter
  sessions: MjsWsStatsSessions
  /** intervalle entre deux µ:ping reçus d'une même connexion, ms — PAS un aller-retour (cf. LatencyReservoir) */
  pingIntervals: MjsWsStatsLatencies
  errors: MjsWsStatsErrors
}

// --- le registre — TOUJOURS actif (aucune option ne le désactive), incréments = simple ++ -----

/** gauges lues EN DIRECT par l'appelant (core.ts, via rooms.ts/streams.ts) au moment du snapshot —
 *  jamais stockées dans le registre, cf. le commentaire de tête (une seule source de vérité). */
export interface MjsWsStatsGauges {
  rooms: MjsWsStatsRooms
  /** streams.ts ne fournit QUE la gauge — les compteurs cumulés (deltasEmitted/resyncs*) vivent
   *  dans le registre lui-même (`streamCounters` ci-dessous), streams.ts les incrémente en direct */
  streams: Pick<MjsWsStatsStreams, 'count'>
}

export interface MjsWsStatsRegistry {
  readonly processId: string
  connections: MjsWsStatsConnections
  messages: MjsWsStatsMessages
  guard: MjsWsStatsGuard
  bridge: MjsWsStatsBridge
  adapter: MjsWsStatsAdapter
  sessions: MjsWsStatsSessions
  errors: MjsWsStatsErrors
  streamCounters: Pick<MjsWsStatsStreams, 'deltasEmitted' | 'resyncsReplay' | 'resyncsReset'>
  pingIntervals: LatencyReservoir
  /** assemble l'instantané complet — `gauges` : valeurs lues EN DIRECT par l'appelant (core.ts) */
  snapshot(gauges: MjsWsStatsGauges): MjsWsStatsSnapshot
}

export function createStatsRegistry(): MjsWsStatsRegistry {
  const startedAt = Date.now()
  const processId = randomBytes(6).toString('hex')

  const registry: MjsWsStatsRegistry = {
    processId,
    connections:    { active: 0, parked: 0, welcomed: 0, refused: 0, closed: 0, refusedCap: 0, refusedOrigin: 0, refusedBan: 0 },
    messages:       { received: 0, sent: 0, buffered: 0, replayed: 0, dropped: 0, binaryReceived: 0, binaryIgnored: 0, textRejected: 0 },
    guard:          { kicksRate: 0, kicksSilence: 0, kicksBackpressure: 0, kicksPayload: 0, tokenExpired: 0, bans: 0 },
    bridge:         { requestsByEndpoint: {}, http401: 0, rateLimited: 0, webhooksSent: 0, webhooksFailed: 0, webhooksAbandoned: 0 },
    adapter:        { published: 0, received: 0, ignoredOrigin: 0, reordered: 0, reconnects: 0 },
    sessions:       { issued: 0, resumed: 0, expired: 0, overflowed: 0 },
    errors:         { errors: 0, warnings: 0 },
    streamCounters: { deltasEmitted: 0, resyncsReplay: 0, resyncsReset: 0 },
    pingIntervals:  new LatencyReservoir(),

    snapshot(gauges: MjsWsStatsGauges): MjsWsStatsSnapshot {
      return {
        uptime:        Math.round((Date.now() - startedAt) / 1000),
        processId,
        timestamp:     Date.now(),
        memory:        { rss: process.memoryUsage().rss },
        connections:   { ...registry.connections },
        messages:      { ...registry.messages },
        guard:         { ...registry.guard },
        rooms:         { ...gauges.rooms },
        streams:       { ...gauges.streams, ...registry.streamCounters },
        bridge:        { ...registry.bridge, requestsByEndpoint: { ...registry.bridge.requestsByEndpoint } },
        adapter:       { ...registry.adapter },
        sessions:      { ...registry.sessions },
        pingIntervals: registry.pingIntervals.percentiles(),
        errors:        { ...registry.errors },
      }
    },
  }
  return registry
}

// --- format texte Prometheus (GET /metrics, bridge.ts) — lignes PLATES, aucun label (des noms
// distincts à la place, ex. par endpoint) : lisible par n'importe quel scraper sans config exotique,
// chaque valeur sur sa propre ligne `mjs_ws_<nom> <valeur>` précédée de son `# TYPE` -------------

function sanitizeEndpointName(route: string): string {
  return route.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function toPrometheusText(snapshot: MjsWsStatsSnapshot): string {
  const lines: string[] = []
  const gauge   = (name: string, value: number) => { lines.push(`# TYPE mjs_ws_${name} gauge`);   lines.push(`mjs_ws_${name} ${value}`) }
  const counter = (name: string, value: number) => { lines.push(`# TYPE mjs_ws_${name} counter`); lines.push(`mjs_ws_${name} ${value}`) }

  gauge('uptime_seconds', snapshot.uptime)
  gauge('memory_rss_bytes', snapshot.memory.rss)

  gauge('connections_active', snapshot.connections.active)
  gauge('connections_parked', snapshot.connections.parked)
  counter('connections_welcomed_total', snapshot.connections.welcomed)
  counter('connections_refused_total', snapshot.connections.refused)
  counter('connections_refused_cap_total', snapshot.connections.refusedCap)
  counter('connections_refused_origin_total', snapshot.connections.refusedOrigin)
  counter('connections_refused_ban_total', snapshot.connections.refusedBan)
  counter('connections_closed_total', snapshot.connections.closed)

  counter('messages_received_total', snapshot.messages.received)
  counter('messages_sent_total', snapshot.messages.sent)
  counter('messages_buffered_total', snapshot.messages.buffered)
  counter('messages_replayed_total', snapshot.messages.replayed)
  counter('messages_dropped_total', snapshot.messages.dropped)
  counter('messages_binary_received_total', snapshot.messages.binaryReceived)
  counter('messages_binary_ignored_total', snapshot.messages.binaryIgnored)
  counter('messages_text_rejected_strict_total', snapshot.messages.textRejected)

  counter('guard_kicks_rate_total', snapshot.guard.kicksRate)
  counter('guard_kicks_silence_total', snapshot.guard.kicksSilence)
  counter('guard_kicks_backpressure_total', snapshot.guard.kicksBackpressure)
  counter('guard_kicks_payload_total', snapshot.guard.kicksPayload)
  counter('guard_token_expired_total', snapshot.guard.tokenExpired)
  counter('guard_bans_total', snapshot.guard.bans)

  gauge('rooms_total', snapshot.rooms.count)
  gauge('rooms_members_total', snapshot.rooms.membersTotal)
  gauge('rooms_presence_subscribers', snapshot.rooms.presenceSubscribers)

  gauge('streams_total', snapshot.streams.count)
  counter('streams_deltas_total', snapshot.streams.deltasEmitted)
  counter('streams_resync_replay_total', snapshot.streams.resyncsReplay)
  counter('streams_resync_reset_total', snapshot.streams.resyncsReset)

  // pas de chiffre dans le NOM de la métrique (mjs_ws_bridge_http_401_total violerait la forme
  // attendue par un scraper strict, noms = lettres+underscore seulement — le code 401 reste
  // dans la doc/description, jamais dans le nom de la métrique elle-même)
  counter('bridge_unauthorized_total', snapshot.bridge.http401)
  counter('bridge_rate_limited_total', snapshot.bridge.rateLimited)
  counter('bridge_webhooks_sent_total', snapshot.bridge.webhooksSent)
  counter('bridge_webhooks_failed_total', snapshot.bridge.webhooksFailed)
  counter('bridge_webhooks_abandoned_total', snapshot.bridge.webhooksAbandoned)
  for (const route of Object.keys(snapshot.bridge.requestsByEndpoint)) {
    counter(`bridge_requests_${sanitizeEndpointName(route)}_total`, snapshot.bridge.requestsByEndpoint[route])
  }

  counter('adapter_published_total', snapshot.adapter.published)
  counter('adapter_received_total', snapshot.adapter.received)
  counter('adapter_ignored_origin_total', snapshot.adapter.ignoredOrigin)
  counter('adapter_reordered_total', snapshot.adapter.reordered)
  counter('adapter_reconnects_total', snapshot.adapter.reconnects)

  counter('sessions_issued_total', snapshot.sessions.issued)
  counter('sessions_resumed_total', snapshot.sessions.resumed)
  counter('sessions_expired_total', snapshot.sessions.expired)
  counter('sessions_overflowed_total', snapshot.sessions.overflowed)

  counter('log_errors_total', snapshot.errors.errors)
  counter('log_warnings_total', snapshot.errors.warnings)

  if (snapshot.pingIntervals.p50 != null) gauge('ping_interval_p50_ms', snapshot.pingIntervals.p50)
  if (snapshot.pingIntervals.p95 != null) gauge('ping_interval_p95_ms', snapshot.pingIntervals.p95)
  gauge('ping_interval_samples', snapshot.pingIntervals.samples)

  return lines.join('\n') + '\n'
}
