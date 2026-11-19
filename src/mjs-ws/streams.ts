// mjs-ws/streams — « les flux » : état courant (Map) + journal circulaire des
// N derniers deltas + resync incrémental — remplace
// les stubs déclaratifs de core.ts (µ:sub-stream/µ:resync, reset vide).
// Contrat exact : runtime/mjs_socket.ts (_onStreamDelta) — delta {t: nomFlux,
// seq, p:{op,…}}, `seq` STRICTEMENT croissant PAR flux (le client ignore tout
// seq ≤ dernier vu — dédup), `reset` accepté à n'importe quelle seq (nouvelle
// époque, aucune contrainte de contiguïté).
//
// JOURNAL = tampon circulaire des deltas add/update/remove SEULEMENT (pas les
// reset — un reset VIDE le journal, cf. reset() ci-dessous) : TOUJOURS
// contigu par construction (push en ordre de seq, purge en tête quand la
// taille dépasse `journalSize`), donc « from+1..seq est couvert » se réduit à
// une seule comparaison : « le 1er élément du journal a une seq ≤ from+1 ».

import type { MjsWsClient, MjsWsLogFn, MjsWsFanSend } from './core.js'
import { putOwn, checkSetting } from './guard.js'
import type { MjsWsStatsRegistry } from './stats.js'
import { t } from '../messages/index.js'

/** garde d'ABONNEMENT à un flux — MIROIR de MjsWsJoinFn (rooms.ts), même contrat (sync/async, false = refus) */
export type MjsWsStreamAccessFn = (client: MjsWsClient, name: string) => boolean | Promise<boolean>

export interface MjsWsStreamOptions {
  /** taille du journal circulaire des derniers deltas — défaut 200 */
  journal?: number
  /**
   * Faille HAUTE comblée — garde d'ABONNEMENT (µ:sub-stream/µ:resync), consultée
   * AVANT tout snapshot/rejeu. SANS elle, n'importe quel client authentifié reçoit le flux complet
   * en devinant/connaissant son nom, MÊME s'il n'a jamais rejoint un salon — `rooms.join` n'est
   * JAMAIS consulté par app.stream() (deux gardes INDÉPENDANTES à dessein, cf. `room` ci-dessous).
   * Repassée aussi quand une appartenance lue à sa dernière réponse (`app.room(nom).has(client)`) change — départ d'un
   * salon lu dedans (cf. onLeaveRoom), entrée dans un salon lu dehors (cf. onJoinRoom) — et quand un µ:refresh change
   * l'identité de la connexion (cf. onIdentityChange) ; rien du flux ne part vers elle jusqu'à la réponse.
   * `false`/throw = refus (MÊME contrat que `MjsWsRoomsOptions.join`, rooms.ts). Sans elle, ni `room`, ni
   * `public` ci-dessous, le flux est FERMÉ : servi à personne — cf. docs/23-mjs-ws.md « Les flux qui se rattrapent ».
   */
  canSubscribe?: MjsWsStreamAccessFn
  /**
   * délai de la garde `canSubscribe` asynchrone, en ms (entier ≥ 1, défaut 5000) — à son terme, sans réponse, elle compte
   * comme un refus, appliqué par la même règle que ses réponses (cf. applyResponse) : la connexion n'attend plus sans
   * fin un appel au back perdu. Au-delà de ce qu'une minuterie tient (2 147 483 647 ms), borné
   */
  guardTimeout?: number
  /**
   * ouvre le flux à tout client authentifié — sans elle, ni `room`, ni `canSubscribe`, un flux n'est servi à
   * personne (un avertissement le dit à la déclaration, pendant le développement). Une garde (`room`,
   * `canSubscribe`) déclarée aussi reste maîtresse : `public` n'ouvre qu'un flux sans garde
   */
  public?: boolean
  /**
   * sucre — exige l'appartenance au salon `room` (MÊME notion que rooms.ts) avant tout
   * µ:sub-stream/µ:resync. Combinable avec `canSubscribe` ci-dessus (les deux doivent accepter,
   * ET logique). NÉCESSITE un accroche posée par le moteur (core.ts, hors périmètre de ce module,
   * cf. le paramètre `hasRoomMember` de `createStreamsEngine`) — SANS elle, `stream()` REFUSE de
   * démarrer (throw explicite au moment de la déclaration, jamais un refus silencieux à l'usage).
   */
  room?: string
}

export interface MjsWsStreamHandle {
  add(key: string, value: unknown): void
  update(key: string, patch: Record<string, unknown>): void
  remove(key: string): void
  reset(values: Record<string, unknown>): void
  readonly size: number
  snapshot(): Record<string, unknown>
  /**
   * retire ce flux du registre (journal, abonnés, tampon de
   * réordonnancement cluster) : SANS ça, `streams` ne rétrécit JAMAIS (aucun autre point du
   * moteur ne fait `streams.delete(name)`) — un flux par PARTIE (ex. `app.stream('partie-'+id)`,
   * cas d'usage documenté, §5) fuit à vie.
   * `destroy()` n'annonce RIEN aux abonnés courants (cohérent avec un flux jamais déclaré : un
   * futur µ:sub-stream/µ:resync sur ce nom retombe sur `unknownStreamFallback`, reset vide +
   * warn) — à l'appli de prévenir ses clients AVANT si besoin (ex. un dernier message applicatif).
   * LIMITE CONNUE (multi-processus) : purement LOCALE, jamais propagée aux autres
   * process du cluster — ceux-ci gardent leur propre état pour ce nom tant qu'ils ne le
   * détruisent pas eux-mêmes (pas de canal de destruction cross-process).
   */
  destroy(): void
}

/** frame brute {t,seq,p} — même primitive que sendRaw (core.ts), élargie à MjsWsClient */
export type MjsWsRawSend = (client: MjsWsClient, frame: Record<string, unknown>) => void

// marque du pont (bridge.ts, POST /stream), passée en options à app.stream() et reconnue par son identité : le flux
// est ÉCRIT, pas déclaré. Né ainsi, il n'est servi à personne tant que le code de ce process ne l'a pas déclaré
// (cf. StreamState.bridged) — sa garde, s'il en a une sur un autre process, est inconnue ici
export const WRITTEN_BY_BRIDGE: MjsWsStreamOptions = Object.freeze({})

interface JournalEntry { seq: number; p: unknown }

// garde d'accès résolue à la déclaration (cf. accessOf, dans createStreamsEngine) — `undefined` =
// flux FERMÉ, servi à personne ; `public` seul = ouvert à tous. Une déclaration qui arrive sur un flux déjà créé
// (delta d'un autre process, POST /stream du pont, premier app.stream() sans garde) la resserre, ou l'ouvre (`public`),
// jamais ne la jette (cf. tightenAccess). `remoteGuard` : une garde `canSubscribe` posée par un AUTRE process,
// annoncée avec ses deltas (cf. wireDelta) — une fonction ne voyage pas : tout abonnement est refusé ici tant que le
// code local ne déclare pas ce flux avec la sienne. `delai` : celui de `canSubscribe` (option guardTimeout), qu'il suit
interface StreamAccess { canSubscribe?: MjsWsStreamAccessFn; room?: string; remoteGuard?: boolean; public?: boolean; delay?: number }

interface StreamState {
  name: string
  values: Map<string, unknown>
  seq: number
  journal: JournalEntry[]
  journalSize: number
  subscribers: Set<MjsWsClient>
  /** FIFO des mutations LOCALES clusterisées — sérialise incr/apply/publish de CE flux (cf. produceLocal) */
  chain: Promise<void>
  access?: StreamAccess
  /** déclaré par le code de CE process (app.stream) — un flux né du pont ou du delta d'un autre process ne l'est pas */
  declared: boolean
  /** écrit par le pont sans déclaration, ici ou sur un autre process qui l'a annoncé (cf. wireDelta) : refusé à tout
   *  abonné tant que `declared` reste faux, jamais public par défaut */
  bridged: boolean
  /** retiré par destroy() : une poignée gardée n'écrit plus (cf. produceLocal), un second destroy() ne touche plus au registre */
  destroyed?: boolean
  warnedAfterDestroy?: boolean
  /** déclaré fermé, et déjà dit (cf. warnIfClosed) : un avertissement par flux, jamais un par déclaration */
  warnedClosed?: boolean
  /** abonnés retenus, à qui rien du flux ne part en attendant une réponse de la garde (cf. retain) : `liftable` si un
   *  retour la lève, seq du dernier delta reçu avant la retenue */
  retained?: Map<MjsWsClient, { liftable: boolean; from: number | null }>
  /** connexions qui tiennent un seau pour ce flux dans `checks`, abonnées ou non (cf. checkOf) : destroy() les libère toutes */
  bucketHolders?: Set<MjsWsClient>
  /** connexions écartées en silence de ce flux (cf. silences) : destroy() les oublie */
  silent?: Set<MjsWsClient>
  /** connexions qui ont une évaluation de garde ou une demande en attente pour ce flux (cf. latest, demandes) : destroy()
   *  les lâche, même si la garde ne répond jamais */
  pending?: Set<MjsWsClient>
  /** en grappe, numéro où ce flux a repris celui d'un flux détruit sous le même nom (cf. floors) : un rejeu demandé
   *  depuis ce numéro ou avant vient de l'ancien flux, il reçoit l'état complet */
  base?: number
  /** connexions qui se sont désabonnées de ce flux (cf. abandons) : destroy() les oublie */
  abandons?: Set<MjsWsClient>
}

// évaluations de garde lancées pour une connexion et un flux (cf. lancerEvaluation) : la dernière tant qu'elle attend sa
// réponse, le nombre de réponses encore attendues, et l'échéance de chaque évaluation asynchrone (cf. deadline)
interface Evaluations { read: ReadonlySet<string> | null; waiting: number; deadlines?: Map<ReadonlySet<string>, ReturnType<typeof setTimeout>> }

// vérification de la garde repassée au départ d'un salon, par connexion et par flux (cf. requestCheck)
interface StreamCheck {
  fullAt: number                                  // seau de jetons (cf. takeToken) : plein à cette heure (ms)
  inFlight: Set<string> | null                       // jeton de la vérification en cours
  room: string                                   // salon du dernier départ
  timer: ReturnType<typeof setTimeout> | null     // vérification ou reprise différée faute de jeton
  start: string | null                           // salon du départ repris par la vérification repassée (cf. startCheck)
}

// demande en attente d'une réponse de garde, par connexion et par flux (cf. noteRequest) : l'état complet (µ:sub-stream,
// flux rendu au retour), ou le rejeu depuis ce numéro (µ:resync)
interface StreamRequest { state: boolean; from: number | null }

const DEFAULT_JOURNAL = 200

// délai par défaut d'une garde `canSubscribe` asynchrone (option guardTimeout), celui du proxy de décisions (proxy.ts) ; au-delà
// de MAX_TIMER_MS, setTimeout partirait tout de suite
const DEFAULT_GUARD_TIMEOUT = 5000
const MAX_TIMER_MS          = 2147483647

// Faille HAUTE comblée — profondeur bornée AVANT toute écriture (add/update/
// reset) : SANS cette garde, une SEULE entrée trop imbriquée (JSON.stringify lève un RangeError,
// pile V8 dépassée) empoisonne st.values de façon PERMANENTE — snapshotOf() la retraverse à CHAQUE
// futur µ:sub-stream/µ:resync (même d'un client jamais connecté avant l'incident), qui échoue donc
// en silence pour TOUJOURS (cf. core.ts::preEncodeFrame, qui avale l'exception sans jamais remonter
// à l'appelant — cf. bridge.ts pour le même plafond, dupliqué là-bas : ce module reste indépendant).
const MAX_VALUE_DEPTH = 64

// récursion elle-même bornée à `limit` (jamais plus loin, MÊME sur un objet cyclique — un cycle
// grimpe en profondeur à chaque tour, il ne peut donc QUE heurter le mur, jamais boucler à l'infini
// ni faire lever la garde elle-même) — SEULS objets/tableaux comptent un niveau
function isTooDeep(value: unknown, limit: number, depth = 0): boolean {
  if (depth > limit) return true
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    for (const item of value) if (isTooDeep(item, limit, depth + 1)) return true
    return false
  }
  for (const k in value as Record<string, unknown>) if (isTooDeep((value as Record<string, unknown>)[k], limit, depth + 1)) return true
  return false
}

// sérialisable ET pas trop imbriquée — profondeur D'ABORD (borne la récursion AVANT tout appel à
// JSON.stringify sur une structure potentiellement énorme), puis JSON.stringify en `try` pour les
// AUTRES cas (BigInt, etc.) — jamais un throw qui remonterait jusqu'à l'appelant de cette fonction.
// JSON.stringify seul NE SUFFIT PAS : une Map/Set/fonction/Symbol NICHÉ(E) ne lève JAMAIS, elle
// disparaît en silence à
// l'encodage ({}) — parcours DÉDIÉ ci-dessous (la profondeur est déjà bornée par isTooDeep juste
// au-dessus, cette walk reste donc bornée SANS compteur propre) avant JSON.stringify ; seul le
// toJSON natif de Date reste toléré (fidèle), tout AUTRE toJSON refusé (fidélité invérifiable en
// général). `undefined` NICHÉ (clé objet/élément de tableau) est REFUSÉ (disparaît en silence, MÊME
// symptôme) — MAIS `value`/`patch`/`values` valant `undefined` AU SOMMET reste ACCEPTÉ (comportement
// historique inchangé, cf. tests/mjs-ws-bridge.test.ts côté pont pour la MÊME distinction).
function isSerializableEntry(value: unknown): boolean {
  if (isTooDeep(value, MAX_VALUE_DEPTH)) return false
  function hasLossyValue(v: unknown, nested: boolean): boolean {
    if (nested && v === undefined) return true
    if (typeof v === 'function' || typeof v === 'bigint' || typeof v === 'symbol') return true
    if (v instanceof Map || v instanceof Set) return true
    if (v === null || typeof v !== 'object') return false
    if (v instanceof Date) return false
    if (typeof (v as { toJSON?: unknown }).toJSON === 'function') return true
    if (Array.isArray(v)) { for (const item of v) if (hasLossyValue(item, true)) return true; return false }
    for (const k in v as Record<string, unknown>) if (hasLossyValue((v as Record<string, unknown>)[k], true)) return true
    return false
  }
  if (hasLossyValue(value, false)) return false
  try { JSON.stringify(value); return true }
  catch { return false }
}

// --- clustering (adaptateur) — cf. core.ts pour le branchement réel -----------------
// absent (undefined) = comportement historique STRICT, compteur LOCAL synchrone, zéro octet de
// différence (même précédent que resume/bridge, opt-in). Présent = compteur GLOBAL cross-process
// (adapter.incr), l'application locale devient asynchrone (attend l'allocation du seq).

export interface MjsWsStreamsCluster {
  /** alloue le PROCHAIN seq d'un flux — compteur GLOBAL cross-process (remplace le compteur local) */
  allocateSeq(name: string): Promise<number>
  /** mutation locale ADMISE (op connu, seq déjà alloué) — publiée aux autres process TOUT DE SUITE,
   *  que l'application locale soit immédiate ou différée (cf. admitSeq/produceLocal, plus bas) : un
   *  trou LOCAL ne doit jamais retarder ce que les autres process reçoivent. */
  publish(name: string, seq: number, p: Record<string, unknown>): void
}

// descripteur d'une opération EN ENTRÉE (avant application) — le delta {op,...} qui en résulte
// (calculé par applyOp) a la MÊME forme pour 'add'/'remove', mais PAS pour 'update' (patch, pas
// la valeur fusionnée) ni 'reset' (values = l'INSTANTANÉ post-remplacement, pas l'entrée brute) —
// cf. applyOp. C'est CE delta qui voyage sur le réseau (journal local ET publication cluster).
type StreamOp =
  | { op: 'add'; key: string; value: unknown }
  | { op: 'update'; key: string; patch: Record<string, unknown> }
  | { op: 'remove'; key: string }
  | { op: 'reset'; values: Record<string, unknown> }

const REORDER_MAX_PENDING  = 100
const REORDER_TIMEOUT_MS   = 2000

interface ReorderState {
  pending: Map<number, Record<string, unknown>>
  timer: ReturnType<typeof setTimeout> | null
}

// accroche du sucre `room` (MjsWsStreamOptions) : vérifie l'appartenance d'un
// client à un salon rooms.ts. `undefined` = accroche NON câblée (core.ts, hors périmètre de ce
// module) — `stream(name, {room})` refuse alors de démarrer (cf. accessOf) plutôt que de laisser
// `room` silencieusement inactif. Câblage attendu, CÔTÉ core.ts, au point de construction de
// l'engine (INCHANGÉ ici, juste l'accroche décrite) : `(client, room) => roomsEngine.room(room).has(client)`.
export type MjsWsStreamRoomMembership = (client: MjsWsClient, room: string) => boolean

// Faille comblée — vivacité de la connexion, consultée par handleSubStream/handleResync APRÈS la
// garde canSubscribe async (MÊME course, MÊME contrat que MjsWsRoomsHooks.isAlive de rooms.ts) :
// absente = toujours vivante (comportement historique). Fournie par core.ts (`client.state !==
// 'closed'`) : une déconnexion PENDANT cette garde a déjà tout purgé (onDisconnect) — sans ce
// contrôle, l'abonnement serait quand même enregistré pour une connexion qui n'existe déjà plus
// nulle part (cf. le commentaire de rooms.ts pour le détail du symptôme).
export type MjsWsStreamIsAlive = (client: MjsWsClient) => boolean

export function createStreamsEngine(
  rawSend: MjsWsRawSend, log: MjsWsLogFn, cluster?: MjsWsStreamsCluster, stats?: MjsWsStatsRegistry,
  fanSend?: MjsWsFanSend, hasRoomMember?: MjsWsStreamRoomMembership, isAlive?: MjsWsStreamIsAlive,
) {
  const streams = new Map<string, StreamState>()
  const reorderByStream = new Map<string, ReorderState>()   // réordonnancement des deltas DISTANTS, par flux (cf. receiveRemote)
  // connexion → flux qu'elle suit → salons dont la garde `canSubscribe` du flux a lu l'appartenance de cette connexion à
  // sa dernière réponse (cf. noteMembershipRead) : une déconnexion ou un départ de salon ne parcourt que ces flux, jamais
  // tous ceux du serveur, et un départ ne repasse que les gardes qui ont lu ce salon (cf. subscribe/unsubscribe, seuls à
  // le tenir à jour avec st.subscribers)
  const streamsOfClient = new Map<MjsWsClient, Map<StreamState, ReadonlySet<string>>>()
  // évaluations de garde en cours, par connexion : chaque lecture d'appartenance (app.room(nom).has(client)) s'inscrit
  // dans celles de cette connexion ; une garde asynchrone reste ouverte jusqu'à l'application de sa réponse (cf. applyResponse)
  const pendingReads = new Map<MjsWsClient, Set<Set<string>>>()
  // évaluations périmées par un départ avant l'application de leur réponse (cf. onLeaveRoom, requestCheck), avec le
  // salon quitté, ou par un changement d'identité (`null`, cf. onIdentityChange) : leur réponse date d'avant
  const staleReads = new WeakMap<Set<string>, string | null>()
  // salons qu'une évaluation en cours a lus alors que la connexion n'en était pas membre (cf. noteMembershipRead) : revenue
  // dans l'un d'eux avant l'arrivée de la réponse, la connexion a changé ce que la garde a lu (cf. applyResponse)
  const outsideReads = new WeakMap<Set<string>, Set<string>>()
  // dernière évaluation de garde lancée, par connexion et par flux, tant qu'elle attend sa réponse (cf. lancerEvaluation),
  // et réponses encore attendues : seule compte celle de la dernière (cf. applyResponse) ; l'entrée tombe avec la
  // dernière réponse attendue, à la déconnexion, au destroy() du flux ou au désabonnement (cf. forgetEvaluations)
  const latest = new Map<MjsWsClient, Map<StreamState, Evaluations>>()
  // entrée de chaque évaluation dans `latest` : une évaluation dont l'entrée est partie (déconnexion, destroy(),
  // désabonnement) ne compte plus, jamais dans l'entrée d'une demande suivante (cf. lastLaunched)
  const entryOf = new WeakMap<ReadonlySet<string>, Evaluations>()
  // évaluations dont la réponse est le refus de l'échéance (cf. deadline) : leur µ:error le dit (cf. denyStreamAccess)
  const expiredReads = new WeakSet<ReadonlySet<string>>()
  // désabonnements (µ:unsub-stream), par connexion : rien ne lui rend plus ces flux de lui-même — ni la reprise au retour
  // dans un salon, ni l'entrée dans un salon qu'un refus a lu (cf. restoreOnReturn) ; oublié quand elle les redemande (cf.
  // noteRequest), à sa déconnexion et au destroy() du flux
  const abandons = new Map<MjsWsClient, Set<StreamState>>()
  // demandes (µ:sub-stream, µ:resync, flux rendu au retour) qui attendent une réponse de garde, par connexion et par flux :
  // servies ou refusées par la réponse qui s'applique, qu'elle vienne de leur évaluation, d'une demande plus récente, de la
  // vérification d'un départ ou de la garde posée après coup — une demande dépassée n'est jamais oubliée (cf. servir)
  const requests = new Map<MjsWsClient, Map<StreamState, StreamRequest>>()
  // sans grappe, plus grand seq d'un flux détruit : un flux créé ensuite numérote au-delà, si bien qu'un client resté sur un
  // flux détruit puis redéclaré sous le même nom demande un rejeu que le nouveau ne couvre jamais (état complet, cf. replay)
  let floorSeq = 0
  // abonnés écartés en silence par la vérification d'un départ (hors du salon quitté, le flux leur est rendu à leur retour),
  // avec les salons que ce refus a lus en leur absence : entrer dans l'un d'eux lui rend le flux de même (cf. onJoinRoom)
  const silences = new Map<MjsWsClient, Map<StreamState, ReadonlySet<string>>>()
  // en grappe, numéro où s'est arrêté un flux détruit, par nom : le compteur partagé de l'adaptateur continue d'un flux à
  // l'autre, le flux recréé sous ce nom reprend donc là (cf. getOrCreateStream) — son premier delta est contigu, jamais
  // retenu dans le tampon de réordonnancement — et un client resté sur l'ancien flux reçoit l'état complet du nouveau (cf.
  // rejouer). Gardé pour les FLOORS_MAX derniers noms détruits, le plus ancien oublié au-delà
  const FLOORS_MAX = 10000
  const floors     = new Map<string, number>()
  // gardes repassées au départ d'un salon : une seule vérification en vol par connexion et par flux, deux d'avance puis une
  // par seconde — une connexion qui sort et rentre sans cesse d'un salon lu par la garde la faisait appeler à chaque départ
  // (20 flux, 120 trames : 1 200 appels). Même cadence pour la garde rappelée au retour (cf. restoreOnReturn). Tenu tant que
  // la connexion suit le flux ; désabonnée, son seau encore entamé est gardé à part tant qu'il sert (cf. keepCadence),
  // pour qu'un aller-retour (refus ou flux réservé au salon quitté au départ, reprise au retour) garde sa cadence
  const CHECK_AHEAD = 2
  const CHECK_MS    = 1000
  const checks      = new Map<MjsWsClient, Map<StreamState, StreamCheck>>()
  const leftChecks  = new Map<MjsWsClient, Map<string, StreamCheck>>()   // par nom : un flux détruit n'y reste pas retenu
  const swept       = new WeakMap<Map<string, StreamCheck>, number>()     // taille des seaux d'une connexion à leur dernier balayage

  // fan-out à encodage unique (perf, cf. core.ts preEncodeFrame/sendPre/fanSend) —
  // MÊME principe que rooms.ts : injecté par core.ts, repli boucle rawSend si absent (moteur
  // constructible SANS core.ts). Sert à TOUTE diffusion de delta, locale ou distante (cluster) :
  // fanStream, appelé par produceLocal et par applyAccepted.
  const fan: MjsWsFanSend = fanSend ?? ((targets, frame, skip) => { for (const c of targets) { if (skip?.has(c)) continue; rawSend(c, frame) } })

  function snapshotOf(st: StreamState): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of st.values) putOwn(out, k, v)
    return out
  }

  function pushJournal(st: StreamState, entry: JournalEntry): void {
    st.journal.push(entry)
    if (st.journal.length > st.journalSize) st.journal.shift()
  }

  // résout la garde d'accès à la DÉCLARATION (jamais réévaluée depuis les opts ensuite, cf.
  // getOrCreateStream) — `room` sans accroche câblée (hasRoomMember absent) = throw IMMÉDIAT,
  // jamais un refus silencieux à l'usage (cf. MjsWsStreamOptions.room)
  function accessOf(name: string, streamOpts?: MjsWsStreamOptions): StreamAccess | undefined {
    if (streamOpts?.guardTimeout !== undefined) checkSetting(`app.stream('${name}', { guardTimeout })`, streamOpts.guardTimeout, 'integer')
    if (!streamOpts || (streamOpts.canSubscribe == null && streamOpts.room == null && streamOpts.public !== true)) return undefined
    if (streamOpts.room != null && !hasRoomMember) throw new Error(t('ws.streams.room-no-hook', { name, room: streamOpts.room }))
    const access: StreamAccess = streamOpts.public === true ? { canSubscribe: streamOpts.canSubscribe, room: streamOpts.room, public: true } : { canSubscribe: streamOpts.canSubscribe, room: streamOpts.room }
    if (streamOpts.canSubscribe != null && streamOpts.guardTimeout !== undefined) access.delay = Math.min(streamOpts.guardTimeout, MAX_TIMER_MS)
    return access
  }

  // déclaré par le code sans aucun accès : un avertissement, pendant le développement, après les déclarations du même
  // tour (une première poignée sans option, ouverte juste après, n'en mérite pas)
  function warnIfClosed(name: string, st: StreamState): void {
    if (st.warnedClosed || st.access || process.env.NODE_ENV === 'production') return
    st.warnedClosed = true
    queueMicrotask(() => {
      if (st.access || streams.get(name) !== st) return
      log('warn', t('ws.streams.stream-closed-at-declaration', { name }))
    })
  }

  // `origin` : 'code' = déclaration du code de ce process (app.stream), 'bridge' = écriture du pont, 'remote' = delta
  // d'un autre process — seul 'code' déclare le flux (cf. StreamState.declared)
  function getOrCreateStream(name: string, streamOpts: MjsWsStreamOptions | undefined, origin: 'code' | 'bridge' | 'remote'): StreamState {
    let st = streams.get(name)
    if (!st) {
      const floor = floors.get(name)
      if (floor !== undefined) floors.delete(name)
      st = {
        name, values: new Map(), seq: floor ?? (floorSeq > 0 ? floorSeq + 1 : 0), journal: [], journalSize: streamOpts?.journal ?? DEFAULT_JOURNAL,
        subscribers: new Set(), chain: Promise.resolve(), access: accessOf(name, streamOpts),
        declared: origin === 'code', bridged: origin === 'bridge',
      }
      if (floor !== undefined) st.base = floor
      streams.set(name, st)
      if (origin === 'code') warnIfClosed(name, st)
      return st
    }
    if (origin === 'code') st.declared = true
    // flux déjà créé (delta d'un autre process, POST /stream du pont, premier app.stream() sans garde) : la
    // garde déclarée maintenant s'y ajoute, jamais jetée en silence (`journal`, lui, reste celui de la création)
    const added = accessOf(name, streamOpts)
    if (added) tightenAccess(name, st, added)
    if (origin === 'code') warnIfClosed(name, st)
    return st
  }

  function subscribe(client: MjsWsClient, st: StreamState, read: ReadonlySet<string>): void {
    st.subscribers.add(client)
    let mine = streamsOfClient.get(client)
    if (!mine) { mine = new Map(); streamsOfClient.set(client, mine) }
    mine.set(st, read)
    forgetSilence(client, st)
    // accordé à l'instant : remplace toute vérification en attente pour ce flux
    if (st.retained?.delete(client) && st.retained.size === 0) st.retained = undefined
    const v = checks.get(client)?.get(st)
    if (v) { if (v.timer) { clearTimeout(v.timer); v.timer = null } v.inFlight = null; v.start = null }
  }

  function checkOf(client: MjsWsClient, st: StreamState): StreamCheck {
    let theirs = checks.get(client)
    if (!theirs) { theirs = new Map(); checks.set(client, theirs) }
    let v = theirs.get(st)
    if (v) return v
    v = resumeCadence(client, st.name) ?? { fullAt: 0, inFlight: null, room: '', timer: null, start: null }
    theirs.set(st, v)
    if (!st.bucketHolders) st.bucketHolders = new Set()
    st.bucketHolders.add(client)
    return v
  }

  // seau encore entamé d'un flux quitté : gardé à part tant qu'il sert, sans plafond — un plafond faisait perdre leur
  // cadence aux plus anciens (garde rappelée à chaque retour) et oubliait un flux qui attendait son tour (plus jamais
  // rendu). Redevenu plein sans attente, il ne sert plus : oublié au balayage, lancé quand les seaux gardés ont doublé
  // depuis le précédent (coût constant par flux quitté) — leur nombre suit les flux que la connexion a réellement suivis
  function keepCadence(client: MjsWsClient, name: string, v: StreamCheck): void {
    const now = Date.now()
    if (v.fullAt <= now) return   // seau plein : rien à retenir
    let theirs = leftChecks.get(client)
    if (!theirs) { theirs = new Map(); leftChecks.set(client, theirs) }
    theirs.delete(name)
    theirs.set(name, v)
    if (theirs.size < 2 * (swept.get(theirs) ?? 0)) return
    for (const [other, w] of theirs) if (w.fullAt <= now && !w.timer) theirs.delete(other)
    swept.set(theirs, theirs.size)
  }

  function resumeCadence(client: MjsWsClient, name: string): StreamCheck | undefined {
    const theirs = leftChecks.get(client)
    const v = theirs?.get(name)
    if (!theirs || !v) return undefined
    theirs.delete(name)
    if (theirs.size === 0) leftChecks.delete(client)
    if (v.timer) { clearTimeout(v.timer); v.timer = null }   // reprise en attente : l'abonnement repris la remplace
    return v
  }

  // seau de jetons tenu par une seule heure : `fullAt` = heure où il sera plein (deux jetons) ; chaque jeton pris la
  // repousse d'une seconde, et il reste au moins un jeton tant qu'elle est à moins d'une seconde
  function takeToken(v: StreamCheck): boolean {
    const now    = Date.now()
    const fullAt = Math.max(now, v.fullAt)
    if (fullAt - now > (CHECK_AHEAD - 1) * CHECK_MS) return false
    v.fullAt = fullAt + CHECK_MS
    return true
  }

  // vrai : un jeton est pris, la vérification part tout de suite ; sinon `suite` part dès qu'un jeton revient (une seule attente)
  function whenToken(v: StreamCheck, rest: () => void): boolean {
    if (takeToken(v)) return true
    if (!v.timer) v.timer = setTimeout(() => { v.timer = null; takeToken(v); rest() }, Math.max(0, v.fullAt - Date.now() - (CHECK_AHEAD - 1) * CHECK_MS))
    return false
  }

  // désabonnée : l'attente éventuelle tombe, le seau encore entamé est gardé à part (cf. keepCadence)
  function dropCheck(client: MjsWsClient, st: StreamState): void {
    const theirs = checks.get(client)
    const v = theirs?.get(st)
    if (!theirs || !v) return
    if (v.timer) { clearTimeout(v.timer); v.timer = null }
    v.inFlight = null
    v.start    = null
    theirs.delete(st)
    if (theirs.size === 0) checks.delete(client)
    if (st.bucketHolders?.delete(client) && st.bucketHolders.size === 0) st.bucketHolders = undefined
    keepCadence(client, st.name, v)
  }

  // appartenance lue par `app.room(room).has(client)` (accroche de rooms.ts, câblée par core.ts) — notée dans chaque
  // évaluation de garde en cours pour cette connexion, avec les salons lus hors d'eux (cf. outsideReads)
  function noteMembershipRead(client: MjsWsClient, room: string): void {
    if (pendingReads.size === 0) return
    const open = pendingReads.get(client)
    if (!open) return
    const outer = !!hasRoomMember && !hasRoomMember(client, room)
    for (const read of open) {
      read.add(room)
      if (!outer) continue
      let outside = outsideReads.get(read)
      if (!outside) { outside = new Set(); outsideReads.set(read, outside) }
      outside.add(room)
    }
  }

  // évaluation lancée : seule sa réponse comptera (cf. applyResponse). Lancée quand la précédente attend encore la sienne,
  // la connexion qui suit le flux n'en reçoit plus rien jusqu'à sa réponse (cf. retain)
  function launchEvaluation(client: MjsWsClient, st: StreamState, read: ReadonlySet<string>): void {
    let theirs = latest.get(client)
    if (!theirs) { theirs = new Map(); latest.set(client, theirs) }
    const d = theirs.get(st)
    if (!d) { const fresh: Evaluations = { read, waiting: 1 }; theirs.set(st, fresh); entryOf.set(read, fresh); trackPending(st, client); return }
    if (d.read) retain(st, client, false)
    d.read = read
    d.waiting++
    entryOf.set(read, d)
  }

  // réponse arrivée : vrai si elle vient de la dernière évaluation lancée pour cette connexion et ce flux
  function lastLaunched(client: MjsWsClient, st: StreamState, read: ReadonlySet<string>): boolean {
    const theirs = latest.get(client)
    const d = theirs?.get(st)
    if (!theirs || !d || entryOf.get(read) !== d) return false   // entrée partie (déconnexion, destroy(), désabonnement)
    const last = d.read === read
    if (last) d.read = null
    if (--d.waiting === 0) { theirs.delete(st); if (theirs.size === 0) latest.delete(client); dropPending(client, st) }
    return last
  }

  function trackPending(st: StreamState, client: MjsWsClient): void {
    if (!st.pending) st.pending = new Set()
    st.pending.add(client)
  }

  // plus rien en attente pour ce flux sur cette connexion, ni évaluation ni demande : l'index la lâche
  function dropPending(client: MjsWsClient, st: StreamState): void {
    if (latest.get(client)?.has(st) || requests.get(client)?.has(st)) return
    if (st.pending?.delete(client) && st.pending.size === 0) st.pending = undefined
  }

  // chaque salon lu l'est encore de même : la connexion en est membre s'il a été lu dedans, absente s'il a été lu dehors
  function membershipsUnchanged(client: MjsWsClient, read: ReadonlySet<string> | undefined): boolean {
    if (!read) return false
    if (!hasRoomMember) return true
    const outside = outsideReads.get(read as Set<string>)
    for (const room of read) if (hasRoomMember(client, room) === (outside?.has(room) ?? false)) return false
    return true
  }

  // INVARIANT de toute réponse de garde (cf. applyResponse) : les appartenances qu'elle a lues sont celles de la
  // connexion au moment où elle s'applique, entrée comme sortie ; un « oui » ne couvre pas non plus le départ d'un salon
  // qu'il a lu dedans survenu depuis sa lecture, même suivi d'un retour (cf. staleReads). Appliquée, tout changement de
  // l'une d'elles, départ comme entrée, retient la connexion et repasse la garde (cf. onLeaveRoom, onJoinRoom)
  function readsHold(client: MjsWsClient, read: Set<string>, ok: boolean): boolean {
    if (ok && staleReads.has(read)) return false
    return membershipsUnchanged(client, read)
  }

  function closeReads(client: MjsWsClient, read: Set<string>): void {
    const open = pendingReads.get(client)
    if (!open) return
    open.delete(read)
    if (open.size === 0) pendingReads.delete(client)
  }

  function unsubscribe(client: MjsWsClient, st: StreamState): void {
    st.subscribers.delete(client)
    if (st.retained?.delete(client) && st.retained.size === 0) st.retained = undefined
    dropCheck(client, st)
    const mine = streamsOfClient.get(client)
    if (!mine) return
    mine.delete(st)
    if (mine.size === 0) streamsOfClient.delete(client)
  }

  // resserre la garde d'un flux existant : une règle absente est posée (salon, fonction), une règle déjà là
  // est gardée (la première déclaration prime) ; la garde annoncée par un autre process s'efface devant la
  // fonction déclarée ici. Les abonnés déjà inscrits repassent la garde : un refusé le sait et ne reçoit plus rien.
  // `public` ouvre un flux fermé, une fois pour toutes ; il ne change rien à un flux gardé
  function tightenAccess(name: string, st: StreamState, added: StreamAccess): void {
    const cur          = st.access
    const room         = cur?.room ?? added.room
    const canSubscribe = cur?.canSubscribe ?? added.canSubscribe
    const delay        = cur?.canSubscribe != null ? cur.delay : added.delay
    const remoteGuard  = canSubscribe == null && (cur?.remoteGuard === true || added.remoteGuard === true)
    const open         = cur?.public === true || added.public === true
    if (cur && cur.room === room && cur.canSubscribe === canSubscribe && (cur.remoteGuard === true) === remoteGuard) {
      if (open && !cur.public) st.access = { ...cur, public: true }
      return
    }
    st.access = remoteGuard ? { room, canSubscribe, remoteGuard } : { room, canSubscribe }
    if (open) st.access.public = true
    if (delay !== undefined) st.access.delay = delay
    recheckSubscribers(name, st)
  }

  // les abonnés déjà inscrits repassent la garde (resserrée, ou flux annoncé sans déclaration) : rien du flux ne leur part
  // jusqu'à sa réponse (cf. retain), appliquée selon la règle commune (cf. applyResponse) — un refusé le sait et ne
  // reçoit plus rien, un accepté reçoit ce qui a été retenu ; une réponse qui ne s'applique pas fait repasser la garde comme
  // à un abonnement demandé, la connexion désabonnée en attendant
  function recheckSubscribers(name: string, st: StreamState): void {
    for (const client of Array.from(st.subscribers)) {
      const before  = streamsOfClient.get(client)?.get(st)
      const restart = () => handleSubStream(client, name)
      retain(st, client, false)
      const read    = new Set<string>()
      const allowed = checkAccess(st, client, name, read)
      if (allowed === true || allowed === false) applyResponse(client, st, read, allowed, restart, before, 'µ:sub-stream')
      else allowed.then(ok => applyResponse(client, st, read, ok, restart, before, 'µ:sub-stream'))
    }
  }

  // RÈGLE COMMUNE, seule à appliquer une réponse de garde — demande (µ:sub-stream, µ:resync, flux rendu au retour), garde
  // resserrée, vérification au départ ou repassée. Pour une connexion et un flux, une réponse ne s'applique que si elle
  // vient de la dernière évaluation lancée (cf. lancerEvaluation) et que ses lectures tiennent (cf. readsHold).
  // Dépassée, elle est ignorée, « oui » comme « non », sans µ:error ni delta. Lectures changées, la garde est repassée au
  // même rythme et rien du flux ne part vers la connexion en attendant : une demande (`restart`) est repassée telle quelle,
  // la connexion désabonnée ; un abonnement est vérifié de nouveau, la connexion retenue (cf. retain). Ne compte pas non
  // plus une réponse arrivée après la déconnexion ou la destruction du flux, ni, pour un abonné, celle d'une évaluation dont
  // l'abonnement est tombé depuis (`jeton` : celui qu'elle évalue). Appliquée, elle sert ou refuse toutes les demandes en
  // attente (cf. servir, refuser) ; `room` est relu à son arrivée : jamais rien pour un non-membre
  function applyResponse(client: MjsWsClient, st: StreamState, read: Set<string>, ok: boolean, restart: (() => void) | null, token: ReadonlySet<string> | undefined, via: string, start?: string): void {
    closeReads(client, read)   // jusqu'ici, un départ d'un salon lu compte (cf. onLeaveRoom)
    if (!lastLaunched(client, st, read)) return   // dépassée par une évaluation lancée après elle
    if (isAlive && !isAlive(client)) return   // tombée pendant la garde : onDisconnect a déjà tout purgé (cf. MjsWsStreamIsAlive)
    if (st.destroyed) { takeRequest(client, st); return }
    if (token !== undefined && (!st.subscribers.has(client) || streamsOfClient.get(client)?.get(st) !== token)) return
    if (!inRoomOf(st, client)) { reject(client, st, restart !== null, via); return }
    if (!readsHold(client, read, ok)) {
      if (restart) { if (st.subscribers.has(client)) unsubscribe(client, st); recheckGuard(client, st, restart) }
      else { retain(st, client, true); checkOf(client, st).start = start ?? null; requestCheck(client, st, staleReads.get(read) ?? null) }
      return
    }
    if (ok) { serve(client, st, read); return }
    reject(client, st, restart !== null || (!!start && !!hasRoomMember && hasRoomMember(client, start)), via, read)
  }

  // « oui » appliqué : l'abonnement tient sur les lectures de cette réponse, la retenue tombe, et les demandes en attente
  // reçoivent ce qu'elles ont demandé — l'état complet pour un µ:sub-stream ou un flux rendu au retour, sinon le rejeu
  // depuis le plus petit numéro demandé (µ:resync) ou retenu (cf. replay)
  function serve(client: MjsWsClient, st: StreamState, read: ReadonlySet<string>): void {
    const request  = takeRequest(client, st)
    const retained = st.retained?.get(client)?.from ?? null
    subscribe(client, st, read)
    if (request?.state) { rawSend(client, { t: st.name, seq: st.seq, p: { op: 'reset', values: snapshotOf(st) } }); return }
    const requested = request?.from ?? null
    const from      = requested == null ? retained : retained == null ? requested : Math.min(requested, retained)
    if (from != null) replay(client, st, from)
  }

  // « non » appliqué : la connexion perd le flux — un µ:error pour une demande (la sienne, ou une demande en attente qu'une
  // vérification a dépassée), pour une garde resserrée, et pour un abonné revenu dans le salon dont le départ a lancé la
  // vérification (sa reprise est passée, rien ne le lui rendra) ; sinon en silence, le flux lui étant rendu à son retour dans ce salon (cf. restoreOnReturn), ou à son
  // entrée dans un salon que ce refus a lu en son absence (cf. onJoinRoom)
  function reject(client: MjsWsClient, st: StreamState, warn: boolean, via: string, read?: Set<string>): void {
    const request = takeRequest(client, st)
    if (warn || request) { denyStreamAccess(client, st.name, via, !!read && expiredReads.has(read)); return }
    unsubscribe(client, st)
    const outside = read ? outsideReads.get(read) : undefined
    if (!outside || outside.size === 0) return
    let theirs = silences.get(client)
    if (!theirs) { theirs = new Map(); silences.set(client, theirs) }
    theirs.set(st, outside)
    if (!st.silent) st.silent = new Set()
    st.silent.add(client)
  }

  function forgetSilence(client: MjsWsClient, st: StreamState): void {
    const theirs = silences.get(client)
    if (!theirs?.delete(st)) return
    if (theirs.size === 0) silences.delete(client)
    if (st.silent?.delete(client) && st.silent.size === 0) st.silent = undefined
  }

  // entrée dans un salon (µ:join accepté — accroche de rooms.ts, câblée par core.ts) : la garde d'un flux suivi dont la
  // réponse en vigueur a lu ce salon en l'absence de la connexion est repassée, la connexion retenue jusqu'à sa réponse (cf.
  // requestCheck) — une vérification déjà en vol suffit, sa réponse ne compte que si ce qu'elle a lu tient encore
  // (cf. applyResponse). Un flux dont la garde a écarté la connexion en silence en lisant ce salon en son absence lui est
  // rendu comme à un retour (cf. restoreOnReturn)
  function onJoinRoom(client: MjsWsClient, room: string): void {
    const mine = streamsOfClient.get(client)
    if (mine) for (const [st, read] of Array.from(mine)) {
      if (!outsideReads.get(read as Set<string>)?.has(room)) continue
      if (checks.get(client)?.get(st)?.inFlight) retain(st, client, true)
      else requestCheck(client, st, room)
    }
    const theirs = silences.get(client)
    if (!theirs) return
    for (const [st, outside] of Array.from(theirs)) {
      if (!outside.has(room)) continue
      forgetSilence(client, st)
      restoreOnReturn(client, st.name, room)
    }
  }

  function noteRequest(client: MjsWsClient, st: StreamState, state: boolean, from: number | null): void {
    forgetSilence(client, st)
    forgetAbandon(client, st)
    let theirs = requests.get(client)
    if (!theirs) { theirs = new Map(); requests.set(client, theirs) }
    const d = theirs.get(st)
    if (!d) { theirs.set(st, { state, from }); trackPending(st, client); return }
    if (state) d.state = true
    if (from != null) d.from = d.from == null ? from : Math.min(d.from, from)
  }

  function takeRequest(client: MjsWsClient, st: StreamState): StreamRequest | undefined {
    const theirs = requests.get(client)
    const d = theirs?.get(st)
    if (!theirs || !d) return undefined
    theirs.delete(st)
    if (theirs.size === 0) requests.delete(client)
    dropPending(client, st)
    return d
  }

  // appartenance au salon exigé par le flux (option `room`) — vrai si le flux n'en exige aucun
  function inRoomOf(st: StreamState, client: MjsWsClient): boolean {
    const room = st.access?.room
    return room == null || (!!hasRoomMember && hasRoomMember(client, room))
  }

  // évalue la garde d'accès (canSubscribe ET/OU room, ET logique — cf. MjsWsStreamOptions) —
  // retourne un booléen SYNCHRONE si tout est sync/absent (chemin HISTORIQUE, zéro await de plus
  // dans le cas courant sans garde), sinon une Promise (au moins une garde async) — MÊME contrat
  // que rooms.ts::opts.join, jamais un throw qui remonterait jusqu'au dispatcheur réseau (core.ts)
  // `lues` reçoit les salons dont la garde lit l'appartenance pendant son évaluation (cf. noteMembershipRead)
  function checkAccess(st: StreamState, client: MjsWsClient, name: string, read: Set<string>): boolean | Promise<boolean> {
    launchEvaluation(client, st, read)
    if (st.bridged && !st.declared) return false   // écrit par le pont, jamais déclaré ici : sa garde est inconnue
    const access = st.access
    if (!access) return false   // fermé : déclaré sans public, room ni canSubscribe
    if (!inRoomOf(st, client)) return false
    if (!access.canSubscribe) return access.remoteGuard !== true
    let open = pendingReads.get(client)
    if (!open) { open = new Set(); pendingReads.set(client, open) }
    open.add(read)
    let result: boolean | Promise<boolean>
    try { result = access.canSubscribe(client, name) }
    catch { closeReads(client, read); return false }
    if (result instanceof Promise) return deadline(client, st, read, result.then(ok => ok === true, () => false), access.delay ?? DEFAULT_GUARD_TIMEOUT)   // lectures fermées à l'application (cf. applyResponse)
    closeReads(client, read)
    return result === true
  }

  // garde asynchrone : sa réponse, ou le refus de l'échéance (option guardTimeout) — la première des deux, une seule fois :
  // la règle commune ne voit jamais deux réponses d'une même évaluation (cf. lastLaunched), et celle qui arrive après
  // l'échéance est ignorée. L'échéance tombe avec l'évaluation (déconnexion, destroy(), désabonnement, cf. forgetEvaluations)
  function deadline(client: MjsWsClient, st: StreamState, read: Set<string>, response: Promise<boolean>, ms: number): Promise<boolean> {
    const d = latest.get(client)?.get(st)
    if (!d || entryOf.get(read) !== d) return response   // entrée partie pendant l'appel de la garde : sa réponse ne compte pas
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        d.deadlines?.delete(read)
        expiredReads.add(read)
        logRefusal('timeout', () => t('ws.streams.guard-no-response-journal', { name: loggedName(st.name), ms }), client)
        resolve(false)
      }, ms)
      if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()   // jamais elle ne retient le process
      if (!d.deadlines) d.deadlines = new Map()
      d.deadlines.set(read, timer)
      response.then(ok => { clearTimeout(timer); d.deadlines?.delete(read); resolve(ok) })
    })
  }

  // évaluations encore sans réponse pour ce flux et cette connexion (désabonnement, destroy()) : leurs échéances tombent,
  // leurs lectures se ferment, leur entrée part — une réponse qui arrive ensuite ne compte plus (cf. lastLaunched)
  function forgetEvaluations(client: MjsWsClient, st: StreamState): void {
    const theirs = latest.get(client)
    const d = theirs?.get(st)
    if (!theirs || !d) return
    if (d.read) closeReads(client, d.read as Set<string>)
    if (d.deadlines) for (const [read, timer] of d.deadlines) { clearTimeout(timer); closeReads(client, read as Set<string>) }
    d.deadlines = undefined
    theirs.delete(st)
    if (theirs.size === 0) latest.delete(client)
  }

  // décrit un descripteur d'opération SANS muter st.values — c'est CE delta qui voyage sur le
  // réseau (journal local ET publication cluster), calculé AVANT de savoir si l'admission locale
  // sera immédiate ou différée (cf. admitSeq, plus bas) : un 'update' reste TOUJOURS le patch brut
  // (jamais la valeur fusionnée), un 'add'/'remove' la charge verbatim, un 'reset' l'instantané
  // recopié clé à clé, `__proto__` rangé en clé propre (cf. putOwn ; le client trie lui-même les noms). PARTAGÉ par le producteur LOCAL (produceLocal) — un delta
  // REÇU du réseau EST DÉJÀ dans cette forme (receiveRemote), rien à décrire pour lui.
  function describeOp(op: StreamOp): Record<string, unknown> {
    if (op.op === 'add')    return { op: 'add', key: op.key, value: op.value }
    if (op.op === 'update') return { op: 'update', key: op.key, patch: op.patch }
    if (op.op === 'remove') return { op: 'remove', key: op.key }
    const out: Record<string, unknown> = {}
    for (const k in op.values) putOwn(out, k, op.values[k])
    return { op: 'reset', values: out }
  }

  // applique un delta DÉJÀ DÉCRIT (forme StreamOp, cf. describeOp) à st.values — MÊME fonction pour
  // un delta LOCAL admis (cf. admitSeq) et un delta DISTANT rejoué (receiveRemote) : les deux ont
  // rigoureusement la même forme à ce stade, rejouer avec mutateOp() produit donc, sur chaque
  // process, EXACTEMENT le même état.
  function mutateOp(st: StreamState, op: StreamOp): void {
    if (op.op === 'add')    { st.values.set(op.key, op.value); return }
    if (op.op === 'update') {
      const cur  = st.values.get(op.key)
      const base = (cur && typeof cur === 'object') ? cur as Record<string, unknown> : {}
      st.values.set(op.key, { ...base, ...op.patch })
      return
    }
    if (op.op === 'remove') { st.values.delete(op.key); return }
    // 'reset' — nouvelle époque : journal vidé, un rejeu ne doit JAMAIS le traverser
    st.values = new Map(Object.entries(op.values))
    st.journal.length = 0
  }

  // combine describeOp+mutateOp — SEUL besoin de la voie NON clusterisée (produceLocal), qui
  // applique toujours tout de suite (pas d'arbitrage de contiguïté hors cluster, cf. plus bas)
  function applyOp(st: StreamState, op: StreamOp): Record<string, unknown> {
    const p = describeOp(op)
    mutateOp(st, op)
    return p
  }

  // Faille HAUTE comblée — admet un seq (LOCAL déjà alloué OU DISTANT reçu) dans st, par LE MÊME
  // arbitre de contiguïté des deux côtés : AVANT ce correctif, une production LOCALE s'appliquait
  // tout de suite quel que soit le compteur GLOBAL, « sautant » un trou qu'un AUTRE producteur
  // n'avait pas encore comblé — le delta distant plus ancien, arrivé ensuite, était alors rejeté
  // comme périmé (seq ≤ st.seq) au lieu d'être réordonné (cf. receiveRemote plus bas). Contigu (seq
  // = st.seq+1, cas courant — y compris toute production strictement séquentielle) → appliqué +
  // journal + diffusion tout de suite, comme avant ; un trou → mis de côté (bufferReorder, MÊME
  // tampon qu'un delta distant) jusqu'à ce qu'il se comble (drainReorder) ou que le délai/la taille
  // limite force l'application quand même (forceFlush, avertissement — cf. leurs commentaires).
  function admitSeq(name: string, st: StreamState, seq: number, p: Record<string, unknown>): void {
    if (seq <= st.seq) return   // déjà admis — dédup (robustesse : ne devrait plus arriver en pratique, compteur global)
    if (seq === st.seq + 1) { applyAccepted(name, st, seq, p); drainReorder(name, st); return }
    bufferReorder(name, st, seq, p)
  }

  // --- production LOCALE (add/update/remove/reset applicatifs) ---------------------------------
  function produceLocal(name: string, st: StreamState, op: StreamOp): void {
    // poignée gardée après destroy() : écriture sans effet, jamais une exception (une minuterie oubliée ferait tomber le
    // process) ; un avertissement par flux détruit
    if (st.destroyed) {
      if (!st.warnedAfterDestroy) { st.warnedAfterDestroy = true; log('warn', t('ws.streams.write-after-destroy', { name, op: op.op })) }
      return
    }
    if (!cluster) {
      // comportement HISTORIQUE, inchangé octet pour octet — compteur local synchrone, jamais de trou possible
      const p = applyOp(st, op)
      st.seq++
      if (op.op !== 'reset') pushJournal(st, { seq: st.seq, p })
      fanStream(name, st, st.seq, p)
      if (stats) stats.streamCounters.deltasEmitted++
      return
    }
    // clusterisé — FIFO PAR FLUX (même idée que client.chain, core.ts) : sérialise les
    // incr/publish/admission LOCAUX de CE flux, pour que deux appels d'affilée (add(); add();)
    // restent dans l'ordre d'APPEL même si allocateSeq() est asynchrone (réseau, cas Redis).
    st.chain = st.chain
      .then(async () => {
        const seq = await cluster.allocateSeq(name)
        const p   = describeOp(op)      // calculé SANS muter — l'admission locale peut différer (cf. admitSeq)
        cluster.publish(name, seq, wireDelta(st, p))   // aux AUTRES process tout de suite, jamais retardé par un trou local
        admitSeq(name, st, seq, p)
      })
      .catch(err => log('error', t('ws.streams.mutation-clustered-failed', { name }), { err }))
  }

  // --- API applicative — app.stream(nom, opts) ---
  function stream(name: string, streamOpts?: MjsWsStreamOptions): MjsWsStreamHandle {
    const s = streamOpts === WRITTEN_BY_BRIDGE ? getOrCreateStream(name, undefined, 'bridge') : getOrCreateStream(name, streamOpts, 'code')
    return {
      add(key, value) {
        // refuse plutôt que d'empoisonner st.values (cf. isSerializableEntry)
        if (!isSerializableEntry(value)) throw new Error(t('ws.streams.entry-not-serializable', { name, op: 'add', depth: MAX_VALUE_DEPTH }))
        produceLocal(name, s, { op: 'add', key, value })
      },
      update(key, patch) {
        if (!isSerializableEntry(patch)) throw new Error(t('ws.streams.entry-not-serializable', { name, op: 'update', depth: MAX_VALUE_DEPTH }))
        produceLocal(name, s, { op: 'update', key, patch })
      },
      remove(key)           { produceLocal(name, s, { op: 'remove', key }) },
      reset(values) {
        if (!isSerializableEntry(values)) throw new Error(t('ws.streams.entry-not-serializable', { name, op: 'reset', depth: MAX_VALUE_DEPTH }))
        produceLocal(name, s, { op: 'reset', values })
      },
      get size(): number   { return s.values.size },
      snapshot()           { return snapshotOf(s) },
      destroy() {
        // déjà détruit : le nom appartient peut-être à un flux recréé depuis, que l'ancienne poignée ne retire pas
        if (s.destroyed) return
        s.destroyed = true
        if (!cluster) floorSeq = Math.max(floorSeq, s.seq)
        else noteFloor(name, s)
        if (streams.get(name) === s) streams.delete(name)
        // l'index des connexions lâche ce flux, et ses abonnés ne reçoivent plus rien (cf. produceLocal) ; les seaux de
        // vérification tombent avec leurs attentes, abonnées ou non (une garde repassée qui attendait son jeton) : rien ne
        // retient plus l'état du flux détruit, et une réponse arrivée après n'est plus appliquée (cf. applyResponse)
        for (const client of s.subscribers) {
          const mine = streamsOfClient.get(client)
          if (mine) { mine.delete(s); if (mine.size === 0) streamsOfClient.delete(client) }
          takeRequest(client, s)
        }
        if (s.bucketHolders) for (const client of s.bucketHolders) {
          const theirs = checks.get(client)
          const v = theirs?.get(s)
          if (theirs && v) { if (v.timer) clearTimeout(v.timer); theirs.delete(s); if (theirs.size === 0) checks.delete(client) }
          takeRequest(client, s)
        }
        s.bucketHolders = undefined
        // évaluations et demandes encore sans réponse, même d'une garde qui ne répondra jamais (cf. pending)
        if (s.pending) for (const client of Array.from(s.pending)) {
          forgetEvaluations(client, s)
          takeRequest(client, s)
        }
        s.pending = undefined
        if (s.silent) for (const client of Array.from(s.silent)) forgetSilence(client, s)
        if (s.abandons) for (const client of Array.from(s.abandons)) forgetAbandon(client, s)
        s.subscribers.clear()
        s.retained = undefined
        const rs = reorderByStream.get(name)
        if (rs) { if (rs.timer) clearTimeout(rs.timer); reorderByStream.delete(name) }
      },
    }
  }

  // en grappe : plancher du flux détruit (cf. floors), au-delà de tout numéro qu'il a vu, même encore en attente dans le
  // tampon de réordonnancement
  function noteFloor(name: string, st: StreamState): void {
    let seq = st.seq
    const rs = reorderByStream.get(name)
    if (rs) for (const n of rs.pending.keys()) if (n > seq) seq = n
    floors.delete(name)
    floors.set(name, seq)
    if (floors.size > FLOORS_MAX) floors.delete(floors.keys().next().value as string)
  }

  // journal des demandes refusées (flux inconnu, garde, flux du pont sans déclaration) — une ligne au plus par minute
  // et par motif : la première part tout de suite, les suivantes sont comptées et annoncées par la ligne d'après. Le
  // nom, écrit par le client, est tronqué : une rafale de µ:sub-stream ne remplit plus le journal
  const REFUSAL_LOG_MS   = 60000
  const LOGGED_NAME_MAX  = 200
  const UNKNOWN_NAME_MAX = 200   // même borne que les noms de salon (rooms.ts)
  const refusalLog      = { unknown: { since: -Infinity, muted: 0 }, denied: { since: -Infinity, muted: 0 }, bridged: { since: -Infinity, muted: 0 }, closed: { since: -Infinity, muted: 0 }, timeout: { since: -Infinity, muted: 0 } }

  function logRefusal(motive: keyof typeof refusalLog, line: () => string, client: MjsWsClient): void {
    const state = refusalLog[motive]
    const now   = Date.now()
    if (now >= state.since && now - state.since < REFUSAL_LOG_MS) { state.muted++; return }
    log('warn', state.muted > 0 ? line() + ' ' + t('ws.core.refusal-similar-silenced', { n: state.muted }) : line(), { client: client.id })
    state.since = now
    state.muted = 0
  }

  function loggedName(name: string): string {
    return name.length > LOGGED_NAME_MAX ? name.slice(0, LOGGED_NAME_MAX) + '…' : name
  }

  // flux non déclaré (jamais vu app.stream()) → réponse honnête ; PAS d'auto-création, PAS d'abonnement fantôme.
  // Un nom inconnu trop long ne revient pas au client (sa réponse portait le nom en type : 60 000 caractères
  // demandés, une trame de 60 Ko renvoyée) : une erreur courte à la place
  function unknownStreamFallback(client: MjsWsClient, name: string, via: string): void {
    if (name.length > UNKNOWN_NAME_MAX) {
      logRefusal('unknown', () => t('ws.streams.stream-not-declared-name-too-long', { via, name: loggedName(name), max: UNKNOWN_NAME_MAX }), client)
      rawSend(client, { t: 'µ:error', p: { message: t('ws.streams.name-too-long', { max: UNKNOWN_NAME_MAX }) } })
      return
    }
    logRefusal('unknown', () => t('ws.streams.stream-not-declared', { via, name: loggedName(name) }), client)
    rawSend(client, { t: name, seq: 0, p: { op: 'reset', values: {} } })
  }

  // refus d'abonnement : log + µ:error catalogué, JAMAIS un simple silence (la
  // « garde muette » serait indiscernable d'un flux non déclaré ou d'un bogue réseau côté client). Une connexion qui
  // suivait déjà le flux (sa redemande refusée) le perd : plus aucun delta, ni le rejeu d'une vérification en attente.
  // `expired` : la garde n'a pas répondu à temps (cf. deadline), le µ:error le dit — le journal l'a dit à l'échéance. Quelle
  // que soit la cause, le µ:error nomme le flux (`code: 'stream-denied'`, `stream`), comme le refus d'un salon nomme le sien
  function denyStreamAccess(client: MjsWsClient, name: string, via: string, expired = false): void {
    const st = streams.get(name)
    if (st) unsubscribe(client, st)
    if (expired) { rawSend(client, { t: 'µ:error', p: { message: t('ws.streams.guard-no-response'), code: 'stream-denied', stream: name } }); return }
    if (st && st.bridged && !st.declared) logRefusal('bridged', () => t('ws.streams.stream-bridge-not-declared', { via, name: loggedName(name) }), client)
    else if (st && !st.access) logRefusal('closed', () => t('ws.streams.subscription-stream-closed', { via, name: loggedName(name) }), client)
    else logRefusal('denied', () => t('ws.streams.subscription-refused', { via, name: loggedName(name) }), client)
    rawSend(client, { t: 'µ:error', p: { message: t('ws.streams.access-stream-refused'), code: 'stream-denied', stream: name } })
  }

  // --- µ:sub-stream — garde d'accès (cf. checkAccess), puis abonne + instantané reset (cf. servir) ---
  function handleSubStream(client: MjsWsClient, name: string): void {
    const st = streams.get(name)
    if (!st) { unknownStreamFallback(client, name, 'µ:sub-stream'); return }
    noteRequest(client, st, true, null)
    const restart = () => handleSubStream(client, name)
    const read    = new Set<string>()
    const allowed = checkAccess(st, client, name, read)
    if (allowed === true || allowed === false) applyResponse(client, st, read, allowed, restart, undefined, 'µ:sub-stream')
    else allowed.then(ok => applyResponse(client, st, read, ok, restart, undefined, 'µ:sub-stream'))
  }

  // --- µ:unsub-stream — la connexion cesse de suivre le flux (cf. lacher) ; un flux inconnu (jamais déclaré, ou détruit)
  // est refusé d'un µ:error, sans rien créer, et un nom inconnu trop long ne revient pas au client (cf. unknownStreamFallback) ---
  function handleUnsubStream(client: MjsWsClient, name: string): void {
    const st = streams.get(name)
    if (st) { drop(client, st); return }
    if (name.length > UNKNOWN_NAME_MAX) { unknownStreamFallback(client, name, 'µ:unsub-stream'); return }
    logRefusal('unknown', () => t('ws.streams.unsubscription-stream-not-declared', { name: loggedName(name) }), client)
    rawSend(client, { t: 'µ:error', p: { message: t('ws.streams.unsubscription-stream-unknown') } })
  }

  // désabonnement : plus aucun delta, et rien de ce que la connexion attendait ne la réabonne — demande en attente,
  // évaluation de garde encore sans réponse (son échéance tombe, sa réponse ne comptera pas), vérification ou flux rendu au
  // retour qui attendait son jeton, flux écarté en silence, reprise au retour dans un salon (cf. abandons). Sans effet sur
  // un flux qu'elle ne suit pas : un second désabonnement ne change rien
  function drop(client: MjsWsClient, st: StreamState): void {
    let theirs = abandons.get(client)
    if (!theirs) { theirs = new Set(); abandons.set(client, theirs) }
    theirs.add(st)
    if (!st.abandons) st.abandons = new Set()
    st.abandons.add(client)
    takeRequest(client, st)
    forgetEvaluations(client, st)
    dropPending(client, st)
    forgetSilence(client, st)
    unsubscribe(client, st)   // abonnement, retenue, vérification et son attente (cf. dropCheck)
    const waiting = leftChecks.get(client)?.get(st.name)
    if (waiting?.timer) { clearTimeout(waiting.timer); waiting.timer = null }
  }

  function forgetAbandon(client: MjsWsClient, st: StreamState): void {
    const theirs = abandons.get(client)
    if (!theirs?.delete(st)) return
    if (theirs.size === 0) abandons.delete(client)
    if (st.abandons?.delete(client) && st.abandons.size === 0) st.abandons = undefined
  }

  // rejeu incrémental ou reset complet — servi seulement APRÈS la garde d'accès (cf. servir)
  function replay(client: MjsWsClient, st: StreamState, from: number): void {
    const name = st.name
    const seq  = st.seq
    // époque future/serveur redémarré (from > seq), ou, en grappe, numéro du flux détruit que celui-ci a remplacé → reset complet
    if (from > seq || (st.base !== undefined && from <= st.base)) { rawSend(client, { t: name, seq, p: { op: 'reset', values: snapshotOf(st) } }); if (stats) stats.streamCounters.resyncsReset++; return }
    // déjà à jour → rien à renvoyer (ni rejeu ni reset — pas de compteur, rien ne s'est passé)
    if (from === seq) return

    const covered = st.journal.length > 0 && st.journal[0].seq <= from + 1
    if (!covered) { rawSend(client, { t: name, seq, p: { op: 'reset', values: snapshotOf(st) } }); if (stats) stats.streamCounters.resyncsReset++; return }
    // REJEU dans l'ordre, avec les seq D'ORIGINE du journal (jamais renumérotés)
    for (const entry of st.journal) { if (entry.seq > from) rawSend(client, { t: name, seq: entry.seq, p: entry.p }) }
    if (stats) stats.streamCounters.resyncsReplay++
  }

  // --- µ:resync — garde d'accès (cf. checkAccess), puis abonne (si besoin) + rejeu (cf. servir) ---
  function handleResync(client: MjsWsClient, name: string, from: number): void {
    const st = streams.get(name)
    if (!st) { unknownStreamFallback(client, name, 'µ:resync'); return }
    noteRequest(client, st, false, from)
    const restart = () => handleResync(client, name, from)
    const read    = new Set<string>()
    const allowed = checkAccess(st, client, name, read)
    if (allowed === true || allowed === false) applyResponse(client, st, read, allowed, restart, undefined, 'µ:resync')
    else allowed.then(ok => applyResponse(client, st, read, ok, restart, undefined, 'µ:resync'))
  }

  function onDisconnect(client: MjsWsClient): void {
    pendingReads.delete(client)
    for (const [st, d] of latest.get(client) ?? []) {
      if (d.deadlines) for (const timer of d.deadlines.values()) clearTimeout(timer)
      if (st.pending?.delete(client) && st.pending.size === 0) st.pending = undefined
    }
    const dropped = abandons.get(client)
    if (dropped) for (const st of dropped) if (st.abandons?.delete(client) && st.abandons.size === 0) st.abandons = undefined
    abandons.delete(client)
    for (const st of requests.get(client)?.keys() ?? []) if (st.pending?.delete(client) && st.pending.size === 0) st.pending = undefined
    requests.delete(client)
    const clientSilences = silences.get(client)
    if (clientSilences) for (const st of Array.from(clientSilences.keys())) forgetSilence(client, st)
    latest.delete(client)
    const theirs = checks.get(client)
    if (theirs) for (const [st, v] of theirs) {
      if (v.timer) clearTimeout(v.timer)
      if (st.bucketHolders?.delete(client) && st.bucketHolders.size === 0) st.bucketHolders = undefined
    }
    checks.delete(client)
    const left = leftChecks.get(client)
    if (left) for (const v of left.values()) if (v.timer) clearTimeout(v.timer)
    leftChecks.delete(client)
    const mine = streamsOfClient.get(client)
    if (!mine) return
    for (const st of mine.keys()) {
      st.subscribers.delete(client)
      if (st.retained?.delete(client) && st.retained.size === 0) st.retained = undefined
    }
    streamsOfClient.delete(client)
  }

  // départ d'un salon (µ:leave, expulsion — accroche de rooms.ts, câblée par core.ts) : la connexion quitte tout de
  // suite les flux réservés à ce salon (`room`), et la garde `canSubscribe` des flux qui ont lu son appartenance à ce
  // salon à leur dernière réponse est repassée — jamais celle des autres, qu'un départ sans rapport ne change pas. La
  // fonction rendue, appelée par rooms.ts quand la connexion revient dans ce salon, lui rend ces flux comme si elle les
  // redemandait (garde repassée, état complet puis deltas), sauf les flux `salon/…` : le client du framework les oublie
  // en partant et les redemande lui-même au retour, la connexion en est donc désabonnée. Un départ pendant une vérification
  // encore sans réponse compte aussi : elle peut lire ce salon plus tard. Toute évaluation encore sans réponse qui a déjà lu
  // ce salon est périmée (cf. applyResponse), et un flux qui attendait son jeton pour être rendu l'est au retour suivant
  // (cf. restoreOnReturn). Déconnexion : rien à faire ici, onDisconnect purge tout juste après
  function onLeaveRoom(client: MjsWsClient, room: string): (() => void) | undefined {
    if (isAlive && !isAlive(client)) return undefined
    const open = pendingReads.get(client)
    if (open) for (const read of open) if (read.has(room)) staleReads.set(read, room)
    const left = new Set<string>()
    const waiting = leftChecks.get(client)
    if (waiting) for (const [name, v] of waiting) if (v.timer && v.room === room) { clearTimeout(v.timer); v.timer = null; left.add(name) }
    const mine = streamsOfClient.get(client)
    for (const [st, readsBefore] of mine ? Array.from(mine) : []) {
      if (st.name.startsWith(room + '/')) { unsubscribe(client, st); continue }
      if (st.access?.room === room) { unsubscribe(client, st); left.add(st.name); continue }
      if (!st.access?.canSubscribe) continue
      if (!readsBefore.has(room) && !checks.get(client)?.get(st)?.inFlight) continue
      left.add(st.name)
      requestCheck(client, st, room)
    }
    if (left.size === 0) return undefined
    return () => { for (const name of left) restoreOnReturn(client, name, room) }
  }

  // retour dans le salon : un flux perdu au départ est rendu comme si la connexion le redemandait — rien pour un flux
  // détruit entre-temps (redevenu comme jamais déclaré) ni pour un flux qu'elle suit encore. La garde rappelée suit la
  // cadence des départs (cf. checks), même celle d'un flux réservé au salon : sans jeton, le flux attend son tour, et un
  // départ entre-temps le reporte au retour suivant (cf. onLeaveRoom). Une demande de ce flux déjà repassée, qui attend
  // son jeton, tranche seule : une seule attente par connexion et par flux. Rien pour un flux dont elle s'est désabonnée
  // (µ:unsub-stream) sans le redemander depuis (cf. abandons)
  function restoreOnReturn(client: MjsWsClient, name: string, room: string, tokenTaken = false): void {
    const st = streams.get(name)
    if (!st || st.subscribers.has(client) || abandons.get(client)?.has(st)) return
    const v = leftChecks.get(client)?.get(name) ?? checks.get(client)?.get(st)
    if (v) v.room = room
    if (v && !tokenTaken && !whenToken(v, () => { if (!hasRoomMember || hasRoomMember(client, room)) restoreOnReturn(client, name, room, true) })) return
    if (v) checkOf(client, st)   // la cadence suit l'abonnement rendu (un refus la remet à part, cf. denyStreamAccess)
    else if (st.access?.canSubscribe) takeToken(checkOf(client, st))   // garde rappelée sans cadence encore : elle commence ici
    handleSubStream(client, name)
  }

  // demande dont le « oui » est périmé (cf. applyResponse) : repassée à la cadence des départs, par connexion et par flux
  function recheckGuard(client: MjsWsClient, st: StreamState, rest: () => void): void {
    if (whenToken(checkOf(client, st), rest)) rest()
  }

  // appartenance lue qui change, départ ou entrée (`room`, le salon), identité changée ou réponse d'une vérification qui ne
  // s'applique pas (`null`) : une seule vérification en vol par connexion et par flux, deux d'avance puis une par seconde
  // (cf. checks). La connexion reste abonnée mais ne reçoit plus rien jusqu'à la réponse (cf. retain). Pendant une
  // vérification en vol, la demande périme sa réponse : elle sera repassée
  function requestCheck(client: MjsWsClient, st: StreamState, room: string | null): void {
    const v = checkOf(client, st)
    if (room !== null) v.room = room
    retain(st, client, true)
    if (v.inFlight) staleReads.set(v.inFlight, v.room)
    else if (!v.timer && whenToken(v, () => startCheck(client, st, v))) startCheck(client, st, v)
  }

  // identité changée par un µ:refresh accepté (même utilisateur, autres champs — câblé par core.ts) : la garde de chaque
  // flux suivi est repassée au même rythme qu'un départ, la connexion retenue sans levée possible jusqu'à sa réponse ; un
  // refus lui est annoncé (µ:error), comme à une demande. Une évaluation encore sans réponse a lu l'ancienne identité : son
  // « oui » ne compte plus, la garde est repassée
  function onIdentityChange(client: MjsWsClient): void {
    const open = pendingReads.get(client)
    if (open) for (const read of open) if (!staleReads.has(read)) staleReads.set(read, null)
    const mine = streamsOfClient.get(client)
    if (!mine) return
    for (const st of Array.from(mine.keys())) {
      if (!st.access?.canSubscribe) continue
      retain(st, client, false)
      noteRequest(client, st, false, null)
      requestCheck(client, st, null)
    }
  }

  // vérification de l'abonnement (cf. requestCheck) : sa réponse suit la règle commune (cf. applyResponse).
  // `depart` : le salon du dernier départ à son lancement, ou, repassée faute d'une réponse qui s'applique, celui de la
  // vérification qu'elle remplace — revenue dedans, la connexion apprend un refus par un µ:error (cf. reject)
  function startCheck(client: MjsWsClient, st: StreamState, v: StreamCheck): void {
    const token = streamsOfClient.get(client)?.get(st)
    if (!token || (isAlive && !isAlive(client))) return
    if (streams.get(st.name) !== st) { unsubscribe(client, st); return }   // détruit entre-temps
    const start = v.start ?? v.room
    v.start = null
    const read = new Set<string>()
    v.inFlight = read
    const allowed = checkAccess(st, client, st.name, read)
    if (allowed === true || allowed === false) settleCheck(client, st, v, read, allowed, token, start)
    else allowed.then(ok => settleCheck(client, st, v, read, ok, token, start))
  }

  function settleCheck(client: MjsWsClient, st: StreamState, v: StreamCheck, read: Set<string>, ok: boolean, token: ReadonlySet<string>, start: string): void {
    if (v.inFlight === read) v.inFlight = null
    applyResponse(client, st, read, ok, null, token, 'µ:sub-stream', start)
  }

  // retenue : rien du flux ne part vers la connexion (cf. fanStream) ; sur un « oui » qui s'applique, ce qu'elle a manqué
  // lui est rejoué (cf. servir). `liftable` (départ, entrée, vérification repassée) : la connexion revenue dans chaque salon que la
  // réponse qui l'a abonnée a lu dedans, et absente de chaque salon qu'elle a lu dehors, reçoit de nouveau tant que rien
  // n'a été retenu — revenir dans un seul ne suffit pas ; sinon (une évaluation en a dépassé une autre encore en attente,
  // garde resserrée) plus rien jusqu'à la réponse qui s'applique
  function retain(st: StreamState, client: MjsWsClient, liftable: boolean): void {
    if (!st.subscribers.has(client)) return
    const r = st.retained?.get(client)
    if (r) { if (!liftable) r.liftable = false; return }
    if (!st.retained) st.retained = new Map()
    st.retained.set(client, { liftable, from: null })
  }

  // diffusion d'un delta — un flux réservé à un salon contrôle l'appartenance à CHAQUE envoi : un abonné qui
  // n'en est plus membre (parti, expulsé, par quelque chemin que ce soit) est désabonné au passage ; un abonné retenu ne
  // reçoit rien (rejoué sur un « oui », cf. retain)
  function fanStream(name: string, st: StreamState, seq: number, p: Record<string, unknown>): void {
    const room = st.access?.room
    if (room != null) for (const client of st.subscribers) if (!(hasRoomMember && hasRoomMember(client, room))) unsubscribe(client, st)
    let skip: Set<MjsWsClient> | null = null
    if (st.retained) for (const [client, r] of st.retained) {
      if (r.from == null && r.liftable && membershipsUnchanged(client, streamsOfClient.get(client)?.get(st))) continue
      if (r.from == null) r.from = seq - 1
      if (!skip) skip = new Set()
      skip.add(client)
    }
    fan(st.subscribers, { t: name, seq, p }, skip)
  }

  // --- réception d'un delta DISTANT (cluster, core.ts) — réordonnancement par flux -------------
  // le producteur (un AUTRE process) a déjà alloué `seq` (INCR global) et publié chez lui ; ici on
  // admet ce seq via admitSeq, LE MÊME arbitre que la production LOCALE (cf. son commentaire) — deux
  // publications concurrentes (locales ou distantes) peuvent arriver dans le désordre (pas de
  // garantie d'ordre du transport pub/sub, et une production locale peut ELLE-MÊME laisser un trou
  // le temps qu'un delta distant plus ancien arrive), d'où le tampon commun ci-dessous (cf.
  // docs/23-mjs-ws.md « flux multi-processus » pour la version vulgarisée).

  // applique un seq ADMIS (cf. admitSeq) — LOCAL ou DISTANT, même fonction (cf. mutateOp) : nom
  // générique (avant : applyRemoteOne, réservé au distant) depuis que la production LOCALE passe
  // elle aussi par l'arbitre de contiguïté.
  function applyAccepted(name: string, st: StreamState, seq: number, p: Record<string, unknown>): void {
    mutateOp(st, p as StreamOp)
    st.seq = seq
    if (p.op !== 'reset') pushJournal(st, { seq, p })
    fanStream(name, st, seq, p)
    if (stats) stats.streamCounters.deltasEmitted++
  }

  function drainReorder(name: string, st: StreamState): void {
    const rs = reorderByStream.get(name)
    if (!rs) return
    while (rs.pending.has(st.seq + 1)) {
      const next = st.seq + 1
      const p = rs.pending.get(next)!
      rs.pending.delete(next)
      applyAccepted(name, st, next, p)
    }
    if (rs.pending.size === 0) { if (rs.timer) clearTimeout(rs.timer); reorderByStream.delete(name) }
  }

  // applique ce qui est en attente MALGRÉ le trou (seq manquants jamais arrivés) — la divergence
  // possible est documentée (docs/23-mjs-ws.md) ; le client protocolaire s'auto-corrige de toute
  // façon via µ:resync dès qu'il détecte un saut de seq (cf. runtime/mjs_socket.ts _onStreamDelta).
  function forceFlush(name: string, st: StreamState, reason: string): void {
    const rs = reorderByStream.get(name)
    if (!rs) return
    const seqs = Array.from(rs.pending.keys()).sort((a, b) => a - b)
    log('warn', t('ws.streams.apply-with-gap', { name, reason, count: seqs.length }), { pending: seqs })
    for (const seq of seqs) {
      const p = rs.pending.get(seq)!
      rs.pending.delete(seq)
      if (seq > st.seq) applyAccepted(name, st, seq, p)
    }
    if (rs.timer) clearTimeout(rs.timer)
    reorderByStream.delete(name)
  }

  function bufferReorder(name: string, st: StreamState, seq: number, p: Record<string, unknown>): void {
    let rs = reorderByStream.get(name)
    if (!rs) { rs = { pending: new Map(), timer: null }; reorderByStream.set(name, rs) }
    rs.pending.set(seq, p)
    // statistiques (stats.ts) — un delta (LOCAL ou DISTANT) mis de côté faute d'ordre = « réordonnancé »
    // (famille adaptateur, pas flux : c'est le compteur PARTAGÉ/pub-sub cluster qui n'a pas garanti
    // l'ordre, pas le flux lui-même — cf. admitSeq)
    if (stats) stats.adapter.reordered++
    if (rs.pending.size > REORDER_MAX_PENDING) { forceFlush(name, st, t('ws.streams.buffer-reordering-full', { max: REORDER_MAX_PENDING })); return }
    if (!rs.timer) rs.timer = setTimeout(() => forceFlush(name, st, t('ws.streams.reordering-timeout', { ms: REORDER_TIMEOUT_MS })), REORDER_TIMEOUT_MS)
  }

  // delta publié aux autres process : la garde du flux l'accompagne (son salon, le fait qu'une fonction `canSubscribe`
  // existe, son ouverture `public`, et `declared: false` pour un flux écrit par le pont sans déclaration) — un process
  // qui n'a pas déclaré ce flux ne le sert ainsi jamais sans garde, ni un flux fermé
  function wireDelta(st: StreamState, p: Record<string, unknown>): Record<string, unknown> {
    const access     = st.access
    const undeclared = st.bridged && !st.declared
    if (!access && !undeclared) return p
    const wire: Record<string, unknown> = {}
    if (access?.room != null) wire.room = access.room
    if (access?.canSubscribe || access?.remoteGuard) wire.guard = true
    if (access?.public) wire.public = true
    if (undeclared) wire.declared = false
    return { ...p, access: wire }
  }

  function remoteAccessOf(raw: unknown): StreamAccess | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const a = raw as { room?: unknown; guard?: unknown; public?: unknown }
    const room = typeof a.room === 'string' ? a.room : undefined
    const remoteGuard = a.guard === true
    if (room == null && !remoteGuard && a.public !== true) return undefined
    const access: StreamAccess = remoteGuard ? { room, remoteGuard } : { room }
    if (a.public === true) access.public = true
    return access
  }

  // delta reçu d'un autre process : forme vérifiée avant tout usage (un message mal formé ne doit ni lever ni
  // corrompre l'état), annonce de garde retirée avant journal et diffusion — `null` = mal formé
  function remoteDeltaOf(p: unknown): { delta: Record<string, unknown>; access?: StreamAccess; undeclared: boolean } | null {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null
    const { access, ...delta } = p as Record<string, unknown>
    const keyOk = typeof delta.key === 'string' || (typeof delta.key === 'number' && Number.isFinite(delta.key))
    if (delta.op === 'add' || delta.op === 'remove') { if (!keyOk) return null }
    else if (delta.op === 'update') { if (!keyOk || (delta.patch !== undefined && (delta.patch === null || typeof delta.patch !== 'object'))) return null }
    else if (delta.op === 'reset') { if (!delta.values || typeof delta.values !== 'object') return null }
    else return null
    const undeclared = !!access && typeof access === 'object' && (access as { declared?: unknown }).declared === false
    return { delta, access: remoteAccessOf(access), undeclared }
  }

  // `false` = message mal formé, ignoré sans rien toucher (core.ts en avertit, regroupé)
  function receiveRemote(name: string, seq: number, p: Record<string, unknown>): boolean {
    if (!Number.isSafeInteger(seq) || seq < 1) return false
    const remote = remoteDeltaOf(p)
    if (!remote) return false
    const st = getOrCreateStream(name, undefined, 'remote')
    // écrit par le pont d'un autre process sans déclaration : refusé ici aussi tant que le code local ne le déclare pas
    if (remote.undeclared && !st.declared && !st.bridged) { st.bridged = true; recheckSubscribers(name, st) }
    if (remote.access) tightenAccess(name, st, remote.access)
    admitSeq(name, st, seq, remote.delta)
    return true
  }

  // état/métriques (stats.ts) — GAUGE lue EN DIRECT à la demande (app.stats(), core.ts) ;
  // les compteurs cumulés (deltasEmitted/resyncs*) vivent dans le registre lui-même (streamCounters).
  function statsSnapshot(): { count: number } {
    return { count: streams.size }
  }

  return { stream, handleSubStream, handleResync, handleUnsubStream, onDisconnect, onLeaveRoom, onJoinRoom, onIdentityChange, noteMembershipRead, receiveRemote, statsSnapshot }
}
