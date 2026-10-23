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
import { putOwn } from './guard.js'
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
// code local ne déclare pas ce flux avec la sienne
interface StreamAccess { canSubscribe?: MjsWsStreamAccessFn; room?: string; remoteGuard?: boolean; public?: boolean }

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
  /** abonnés retenus, à qui rien du flux ne part en attendant une réponse de la garde (cf. retenir) : `levable` si un
   *  retour la lève, seq du dernier delta reçu avant la retenue */
  retenus?: Map<MjsWsClient, { levable: boolean; depuis: number | null }>
  /** connexions qui tiennent un seau pour ce flux dans `verifs`, abonnées ou non (cf. verifDe) : destroy() les libère toutes */
  seaux?: Set<MjsWsClient>
  /** connexions écartées en silence de ce flux (cf. silences) : destroy() les oublie */
  silencieux?: Set<MjsWsClient>
  /** connexions qui ont une évaluation de garde ou une demande en attente pour ce flux (cf. dernieres, demandes) : destroy()
   *  les lâche, même si la garde ne répond jamais */
  enCours?: Set<MjsWsClient>
  /** en grappe, numéro où ce flux a repris celui d'un flux détruit sous le même nom (cf. planchers) : un rejeu demandé
   *  depuis ce numéro ou avant vient de l'ancien flux, il reçoit l'état complet */
  base?: number
}

// vérification de la garde repassée au départ d'un salon, par connexion et par flux (cf. demanderVerification)
interface Verif {
  pleinA: number                                  // seau de jetons (cf. prendreJeton) : plein à cette heure (ms)
  enVol: Set<string> | null                       // jeton de la vérification en cours
  salon: string                                   // salon du dernier départ
  timer: ReturnType<typeof setTimeout> | null     // vérification ou reprise différée faute de jeton
  depart: string | null                           // salon du départ repris par la vérification repassée (cf. lancerVerification)
}

// demande en attente d'une réponse de garde, par connexion et par flux (cf. noterDemande) : l'état complet (µ:sub-stream,
// flux rendu au retour), ou le rejeu depuis ce numéro (µ:resync)
interface Demande { etat: boolean; depuis: number | null }

const DEFAULT_JOURNAL = 200

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
  // dans celles de cette connexion ; une garde asynchrone reste ouverte jusqu'à l'application de sa réponse (cf. appliquerReponse)
  const lecturesEnCours = new Map<MjsWsClient, Set<Set<string>>>()
  // évaluations périmées par un départ avant l'application de leur réponse (cf. onLeaveRoom, demanderVerification), avec le
  // salon quitté, ou par un changement d'identité (`null`, cf. onIdentityChange) : leur réponse date d'avant
  const luesPerimees = new WeakMap<Set<string>, string | null>()
  // salons qu'une évaluation en cours a lus alors que la connexion n'en était pas membre (cf. noteMembershipRead) : revenue
  // dans l'un d'eux avant l'arrivée de la réponse, la connexion a changé ce que la garde a lu (cf. appliquerReponse)
  const luesHors = new WeakMap<Set<string>, Set<string>>()
  // dernière évaluation de garde lancée, par connexion et par flux, tant qu'elle attend sa réponse (cf. lancerEvaluation),
  // et réponses encore attendues : seule compte celle de la dernière (cf. appliquerReponse) ; l'entrée tombe avec la
  // dernière réponse attendue, ou à la déconnexion
  const dernieres = new Map<MjsWsClient, Map<StreamState, { lues: ReadonlySet<string> | null; enAttente: number }>>()
  // demandes (µ:sub-stream, µ:resync, flux rendu au retour) qui attendent une réponse de garde, par connexion et par flux :
  // servies ou refusées par la réponse qui s'applique, qu'elle vienne de leur évaluation, d'une demande plus récente, de la
  // vérification d'un départ ou de la garde posée après coup — une demande dépassée n'est jamais oubliée (cf. servir)
  const demandes = new Map<MjsWsClient, Map<StreamState, Demande>>()
  // sans grappe, plus grand seq d'un flux détruit : un flux créé ensuite numérote au-delà, si bien qu'un client resté sur un
  // flux détruit puis redéclaré sous le même nom demande un rejeu que le nouveau ne couvre jamais (état complet, cf. rejouer)
  let plancherSeq = 0
  // abonnés écartés en silence par la vérification d'un départ (hors du salon quitté, le flux leur est rendu à leur retour),
  // avec les salons que ce refus a lus en leur absence : entrer dans l'un d'eux lui rend le flux de même (cf. onJoinRoom)
  const silences = new Map<MjsWsClient, Map<StreamState, ReadonlySet<string>>>()
  // en grappe, numéro où s'est arrêté un flux détruit, par nom : le compteur partagé de l'adaptateur continue d'un flux à
  // l'autre, le flux recréé sous ce nom reprend donc là (cf. getOrCreateStream) — son premier delta est contigu, jamais
  // retenu dans le tampon de réordonnancement — et un client resté sur l'ancien flux reçoit l'état complet du nouveau (cf.
  // rejouer). Gardé pour les PLANCHERS_MAX derniers noms détruits, le plus ancien oublié au-delà
  const PLANCHERS_MAX = 10000
  const planchers     = new Map<string, number>()
  // gardes repassées au départ d'un salon : une seule vérification en vol par connexion et par flux, deux d'avance puis une
  // par seconde — une connexion qui sort et rentre sans cesse d'un salon lu par la garde la faisait appeler à chaque départ
  // (20 flux, 120 trames : 1 200 appels). Même cadence pour la garde rappelée au retour (cf. rendreAuRetour). Tenu tant que
  // la connexion suit le flux ; désabonnée, son seau encore entamé est gardé à part tant qu'il sert (cf. garderCadence),
  // pour qu'un aller-retour (refus ou flux réservé au salon quitté au départ, reprise au retour) garde sa cadence
  const VERIF_D_AVANCE = 2
  const VERIF_MS       = 1000
  const verifs   = new Map<MjsWsClient, Map<StreamState, Verif>>()
  const quittees = new Map<MjsWsClient, Map<string, Verif>>()   // par nom : un flux détruit n'y reste pas retenu
  const balayees = new WeakMap<Map<string, Verif>, number>()     // taille des seaux d'une connexion à leur dernier balayage

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
    if (!streamOpts || (streamOpts.canSubscribe == null && streamOpts.room == null && streamOpts.public !== true)) return undefined
    if (streamOpts.room != null && !hasRoomMember) throw new Error(t('ws.streams.room-sans-accroche', { name, room: streamOpts.room }))
    return streamOpts.public === true ? { canSubscribe: streamOpts.canSubscribe, room: streamOpts.room, public: true } : { canSubscribe: streamOpts.canSubscribe, room: streamOpts.room }
  }

  // déclaré par le code sans aucun accès : un avertissement, pendant le développement, après les déclarations du même
  // tour (une première poignée sans option, ouverte juste après, n'en mérite pas)
  function warnIfClosed(name: string, st: StreamState): void {
    if (st.warnedClosed || st.access || process.env.NODE_ENV === 'production') return
    st.warnedClosed = true
    queueMicrotask(() => {
      if (st.access || streams.get(name) !== st) return
      log('warn', t('ws.streams.flux-ferme-a-la-declaration', { name }))
    })
  }

  // `origin` : 'code' = déclaration du code de ce process (app.stream), 'bridge' = écriture du pont, 'remote' = delta
  // d'un autre process — seul 'code' déclare le flux (cf. StreamState.declared)
  function getOrCreateStream(name: string, streamOpts: MjsWsStreamOptions | undefined, origin: 'code' | 'bridge' | 'remote'): StreamState {
    let st = streams.get(name)
    if (!st) {
      const plancher = planchers.get(name)
      if (plancher !== undefined) planchers.delete(name)
      st = {
        name, values: new Map(), seq: plancher ?? (plancherSeq > 0 ? plancherSeq + 1 : 0), journal: [], journalSize: streamOpts?.journal ?? DEFAULT_JOURNAL,
        subscribers: new Set(), chain: Promise.resolve(), access: accessOf(name, streamOpts),
        declared: origin === 'code', bridged: origin === 'bridge',
      }
      if (plancher !== undefined) st.base = plancher
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

  function subscribe(client: MjsWsClient, st: StreamState, lues: ReadonlySet<string>): void {
    st.subscribers.add(client)
    let mine = streamsOfClient.get(client)
    if (!mine) { mine = new Map(); streamsOfClient.set(client, mine) }
    mine.set(st, lues)
    oublierSilence(client, st)
    // accordé à l'instant : remplace toute vérification en attente pour ce flux
    if (st.retenus?.delete(client) && st.retenus.size === 0) st.retenus = undefined
    const v = verifs.get(client)?.get(st)
    if (v) { if (v.timer) { clearTimeout(v.timer); v.timer = null } v.enVol = null; v.depart = null }
  }

  function verifDe(client: MjsWsClient, st: StreamState): Verif {
    let siennes = verifs.get(client)
    if (!siennes) { siennes = new Map(); verifs.set(client, siennes) }
    let v = siennes.get(st)
    if (v) return v
    v = reprendreCadence(client, st.name) ?? { pleinA: 0, enVol: null, salon: '', timer: null, depart: null }
    siennes.set(st, v)
    if (!st.seaux) st.seaux = new Set()
    st.seaux.add(client)
    return v
  }

  // seau encore entamé d'un flux quitté : gardé à part tant qu'il sert, sans plafond — un plafond faisait perdre leur
  // cadence aux plus anciens (garde rappelée à chaque retour) et oubliait un flux qui attendait son tour (plus jamais
  // rendu). Redevenu plein sans attente, il ne sert plus : oublié au balayage, lancé quand les seaux gardés ont doublé
  // depuis le précédent (coût constant par flux quitté) — leur nombre suit les flux que la connexion a réellement suivis
  function garderCadence(client: MjsWsClient, name: string, v: Verif): void {
    const now = Date.now()
    if (v.pleinA <= now) return   // seau plein : rien à retenir
    let siennes = quittees.get(client)
    if (!siennes) { siennes = new Map(); quittees.set(client, siennes) }
    siennes.delete(name)
    siennes.set(name, v)
    if (siennes.size < 2 * (balayees.get(siennes) ?? 0)) return
    for (const [autre, w] of siennes) if (w.pleinA <= now && !w.timer) siennes.delete(autre)
    balayees.set(siennes, siennes.size)
  }

  function reprendreCadence(client: MjsWsClient, name: string): Verif | undefined {
    const siennes = quittees.get(client)
    const v = siennes?.get(name)
    if (!siennes || !v) return undefined
    siennes.delete(name)
    if (siennes.size === 0) quittees.delete(client)
    if (v.timer) { clearTimeout(v.timer); v.timer = null }   // reprise en attente : l'abonnement repris la remplace
    return v
  }

  // seau de jetons tenu par une seule heure : `pleinA` = heure où il sera plein (deux jetons) ; chaque jeton pris la
  // repousse d'une seconde, et il reste au moins un jeton tant qu'elle est à moins d'une seconde
  function prendreJeton(v: Verif): boolean {
    const now    = Date.now()
    const pleinA = Math.max(now, v.pleinA)
    if (pleinA - now > (VERIF_D_AVANCE - 1) * VERIF_MS) return false
    v.pleinA = pleinA + VERIF_MS
    return true
  }

  // vrai : un jeton est pris, la vérification part tout de suite ; sinon `suite` part dès qu'un jeton revient (une seule attente)
  function quandJeton(v: Verif, suite: () => void): boolean {
    if (prendreJeton(v)) return true
    if (!v.timer) v.timer = setTimeout(() => { v.timer = null; prendreJeton(v); suite() }, Math.max(0, v.pleinA - Date.now() - (VERIF_D_AVANCE - 1) * VERIF_MS))
    return false
  }

  // désabonnée : l'attente éventuelle tombe, le seau encore entamé est gardé à part (cf. garderCadence)
  function lacherVerif(client: MjsWsClient, st: StreamState): void {
    const siennes = verifs.get(client)
    const v = siennes?.get(st)
    if (!siennes || !v) return
    if (v.timer) { clearTimeout(v.timer); v.timer = null }
    v.enVol  = null
    v.depart = null
    siennes.delete(st)
    if (siennes.size === 0) verifs.delete(client)
    if (st.seaux?.delete(client) && st.seaux.size === 0) st.seaux = undefined
    garderCadence(client, st.name, v)
  }

  // appartenance lue par `app.room(room).has(client)` (accroche de rooms.ts, câblée par core.ts) — notée dans chaque
  // évaluation de garde en cours pour cette connexion, avec les salons lus hors d'eux (cf. luesHors)
  function noteMembershipRead(client: MjsWsClient, room: string): void {
    if (lecturesEnCours.size === 0) return
    const ouvertes = lecturesEnCours.get(client)
    if (!ouvertes) return
    const dehors = !!hasRoomMember && !hasRoomMember(client, room)
    for (const lues of ouvertes) {
      lues.add(room)
      if (!dehors) continue
      let hors = luesHors.get(lues)
      if (!hors) { hors = new Set(); luesHors.set(lues, hors) }
      hors.add(room)
    }
  }

  // évaluation lancée : seule sa réponse comptera (cf. appliquerReponse). Lancée quand la précédente attend encore la sienne,
  // la connexion qui suit le flux n'en reçoit plus rien jusqu'à sa réponse (cf. retenir)
  function lancerEvaluation(client: MjsWsClient, st: StreamState, lues: ReadonlySet<string>): void {
    let siennes = dernieres.get(client)
    if (!siennes) { siennes = new Map(); dernieres.set(client, siennes) }
    const d = siennes.get(st)
    if (!d) { siennes.set(st, { lues, enAttente: 1 }); suivreEnCours(st, client); return }
    if (d.lues) retenir(st, client, false)
    d.lues = lues
    d.enAttente++
  }

  // réponse arrivée : vrai si elle vient de la dernière évaluation lancée pour cette connexion et ce flux
  function derniereLancee(client: MjsWsClient, st: StreamState, lues: ReadonlySet<string>): boolean {
    const siennes = dernieres.get(client)
    const d = siennes?.get(st)
    if (!siennes || !d) return false   // purgée par la déconnexion
    const derniere = d.lues === lues
    if (derniere) d.lues = null
    if (--d.enAttente === 0) { siennes.delete(st); if (siennes.size === 0) dernieres.delete(client); lacherEnCours(client, st) }
    return derniere
  }

  function suivreEnCours(st: StreamState, client: MjsWsClient): void {
    if (!st.enCours) st.enCours = new Set()
    st.enCours.add(client)
  }

  // plus rien en attente pour ce flux sur cette connexion, ni évaluation ni demande : l'index la lâche
  function lacherEnCours(client: MjsWsClient, st: StreamState): void {
    if (dernieres.get(client)?.has(st) || demandes.get(client)?.has(st)) return
    if (st.enCours?.delete(client) && st.enCours.size === 0) st.enCours = undefined
  }

  // chaque salon lu l'est encore de même : la connexion en est membre s'il a été lu dedans, absente s'il a été lu dehors
  function appartenancesInchangees(client: MjsWsClient, lues: ReadonlySet<string> | undefined): boolean {
    if (!lues) return false
    if (!hasRoomMember) return true
    const hors = luesHors.get(lues as Set<string>)
    for (const room of lues) if (hasRoomMember(client, room) === (hors?.has(room) ?? false)) return false
    return true
  }

  // INVARIANT de toute réponse de garde (cf. appliquerReponse) : les appartenances qu'elle a lues sont celles de la
  // connexion au moment où elle s'applique, entrée comme sortie ; un « oui » ne couvre pas non plus le départ d'un salon
  // qu'il a lu dedans survenu depuis sa lecture, même suivi d'un retour (cf. luesPerimees). Appliquée, tout changement de
  // l'une d'elles, départ comme entrée, retient la connexion et repasse la garde (cf. onLeaveRoom, onJoinRoom)
  function lecturesTiennent(client: MjsWsClient, lues: Set<string>, ok: boolean): boolean {
    if (ok && luesPerimees.has(lues)) return false
    return appartenancesInchangees(client, lues)
  }

  function fermerLectures(client: MjsWsClient, lues: Set<string>): void {
    const ouvertes = lecturesEnCours.get(client)
    if (!ouvertes) return
    ouvertes.delete(lues)
    if (ouvertes.size === 0) lecturesEnCours.delete(client)
  }

  function unsubscribe(client: MjsWsClient, st: StreamState): void {
    st.subscribers.delete(client)
    if (st.retenus?.delete(client) && st.retenus.size === 0) st.retenus = undefined
    lacherVerif(client, st)
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
    const remoteGuard  = canSubscribe == null && (cur?.remoteGuard === true || added.remoteGuard === true)
    const ouvert       = cur?.public === true || added.public === true
    if (cur && cur.room === room && cur.canSubscribe === canSubscribe && (cur.remoteGuard === true) === remoteGuard) {
      if (ouvert && !cur.public) st.access = { ...cur, public: true }
      return
    }
    st.access = remoteGuard ? { room, canSubscribe, remoteGuard } : { room, canSubscribe }
    if (ouvert) st.access.public = true
    recheckSubscribers(name, st)
  }

  // les abonnés déjà inscrits repassent la garde (resserrée, ou flux annoncé sans déclaration) : rien du flux ne leur part
  // jusqu'à sa réponse (cf. retenir), appliquée selon la règle commune (cf. appliquerReponse) — un refusé le sait et ne
  // reçoit plus rien, un accepté reçoit ce qui a été retenu ; une réponse qui ne s'applique pas fait repasser la garde comme
  // à un abonnement demandé, la connexion désabonnée en attendant
  function recheckSubscribers(name: string, st: StreamState): void {
    for (const client of Array.from(st.subscribers)) {
      const avant   = streamsOfClient.get(client)?.get(st)
      const relance = () => handleSubStream(client, name)
      retenir(st, client, false)
      const lues    = new Set<string>()
      const allowed = checkAccess(st, client, name, lues)
      if (allowed === true || allowed === false) appliquerReponse(client, st, lues, allowed, relance, avant, 'µ:sub-stream')
      else allowed.then(ok => appliquerReponse(client, st, lues, ok, relance, avant, 'µ:sub-stream'))
    }
  }

  // RÈGLE COMMUNE, seule à appliquer une réponse de garde — demande (µ:sub-stream, µ:resync, flux rendu au retour), garde
  // resserrée, vérification au départ ou repassée. Pour une connexion et un flux, une réponse ne s'applique que si elle
  // vient de la dernière évaluation lancée (cf. lancerEvaluation) et que ses lectures tiennent (cf. lecturesTiennent).
  // Dépassée, elle est ignorée, « oui » comme « non », sans µ:error ni delta. Lectures changées, la garde est repassée au
  // même rythme et rien du flux ne part vers la connexion en attendant : une demande (`relance`) est repassée telle quelle,
  // la connexion désabonnée ; un abonnement est vérifié de nouveau, la connexion retenue (cf. retenir). Ne compte pas non
  // plus une réponse arrivée après la déconnexion ou la destruction du flux, ni, pour un abonné, celle d'une évaluation dont
  // l'abonnement est tombé depuis (`jeton` : celui qu'elle évalue). Appliquée, elle sert ou refuse toutes les demandes en
  // attente (cf. servir, refuser) ; `room` est relu à son arrivée : jamais rien pour un non-membre
  function appliquerReponse(client: MjsWsClient, st: StreamState, lues: Set<string>, ok: boolean, relance: (() => void) | null, jeton: ReadonlySet<string> | undefined, via: string, depart?: string): void {
    fermerLectures(client, lues)   // jusqu'ici, un départ d'un salon lu compte (cf. onLeaveRoom)
    if (!derniereLancee(client, st, lues)) return   // dépassée par une évaluation lancée après elle
    if (isAlive && !isAlive(client)) return   // tombée pendant la garde : onDisconnect a déjà tout purgé (cf. MjsWsStreamIsAlive)
    if (st.destroyed) { prendreDemande(client, st); return }
    if (jeton !== undefined && (!st.subscribers.has(client) || streamsOfClient.get(client)?.get(st) !== jeton)) return
    if (!inRoomOf(st, client)) { refuser(client, st, relance !== null, via); return }
    if (!lecturesTiennent(client, lues, ok)) {
      if (relance) { if (st.subscribers.has(client)) unsubscribe(client, st); repasserGarde(client, st, relance) }
      else { retenir(st, client, true); verifDe(client, st).depart = depart ?? null; demanderVerification(client, st, luesPerimees.get(lues) ?? null) }
      return
    }
    if (ok) { servir(client, st, lues); return }
    refuser(client, st, relance !== null || (!!depart && !!hasRoomMember && hasRoomMember(client, depart)), via, lues)
  }

  // « oui » appliqué : l'abonnement tient sur les lectures de cette réponse, la retenue tombe, et les demandes en attente
  // reçoivent ce qu'elles ont demandé — l'état complet pour un µ:sub-stream ou un flux rendu au retour, sinon le rejeu
  // depuis le plus petit numéro demandé (µ:resync) ou retenu (cf. rejouer)
  function servir(client: MjsWsClient, st: StreamState, lues: ReadonlySet<string>): void {
    const demande = prendreDemande(client, st)
    const retenu  = st.retenus?.get(client)?.depuis ?? null
    subscribe(client, st, lues)
    if (demande?.etat) { rawSend(client, { t: st.name, seq: st.seq, p: { op: 'reset', values: snapshotOf(st) } }); return }
    const demandee = demande?.depuis ?? null
    const depuis   = demandee == null ? retenu : retenu == null ? demandee : Math.min(demandee, retenu)
    if (depuis != null) rejouer(client, st, depuis)
  }

  // « non » appliqué : la connexion perd le flux — un µ:error pour une demande (la sienne, ou une demande en attente qu'une
  // vérification a dépassée), pour une garde resserrée, et pour un abonné revenu dans le salon dont le départ a lancé la
  // vérification (sa reprise est passée, rien ne le lui rendra) ; sinon en silence, le flux lui étant rendu à son retour dans ce salon (cf. rendreAuRetour), ou à son
  // entrée dans un salon que ce refus a lu en son absence (cf. onJoinRoom)
  function refuser(client: MjsWsClient, st: StreamState, avertir: boolean, via: string, lues?: Set<string>): void {
    const demande = prendreDemande(client, st)
    if (avertir || demande) { denyStreamAccess(client, st.name, via); return }
    unsubscribe(client, st)
    const hors = lues ? luesHors.get(lues) : undefined
    if (!hors || hors.size === 0) return
    let siens = silences.get(client)
    if (!siens) { siens = new Map(); silences.set(client, siens) }
    siens.set(st, hors)
    if (!st.silencieux) st.silencieux = new Set()
    st.silencieux.add(client)
  }

  function oublierSilence(client: MjsWsClient, st: StreamState): void {
    const siens = silences.get(client)
    if (!siens?.delete(st)) return
    if (siens.size === 0) silences.delete(client)
    if (st.silencieux?.delete(client) && st.silencieux.size === 0) st.silencieux = undefined
  }

  // entrée dans un salon (µ:join accepté — accroche de rooms.ts, câblée par core.ts) : la garde d'un flux suivi dont la
  // réponse en vigueur a lu ce salon en l'absence de la connexion est repassée, la connexion retenue jusqu'à sa réponse (cf.
  // demanderVerification) — une vérification déjà en vol suffit, sa réponse ne compte que si ce qu'elle a lu tient encore
  // (cf. appliquerReponse). Un flux dont la garde a écarté la connexion en silence en lisant ce salon en son absence lui est
  // rendu comme à un retour (cf. rendreAuRetour)
  function onJoinRoom(client: MjsWsClient, room: string): void {
    const mine = streamsOfClient.get(client)
    if (mine) for (const [st, lues] of Array.from(mine)) {
      if (!luesHors.get(lues as Set<string>)?.has(room)) continue
      if (verifs.get(client)?.get(st)?.enVol) retenir(st, client, true)
      else demanderVerification(client, st, room)
    }
    const siens = silences.get(client)
    if (!siens) return
    for (const [st, hors] of Array.from(siens)) {
      if (!hors.has(room)) continue
      oublierSilence(client, st)
      rendreAuRetour(client, st.name, room)
    }
  }

  function noterDemande(client: MjsWsClient, st: StreamState, etat: boolean, depuis: number | null): void {
    oublierSilence(client, st)
    let siennes = demandes.get(client)
    if (!siennes) { siennes = new Map(); demandes.set(client, siennes) }
    const d = siennes.get(st)
    if (!d) { siennes.set(st, { etat, depuis }); suivreEnCours(st, client); return }
    if (etat) d.etat = true
    if (depuis != null) d.depuis = d.depuis == null ? depuis : Math.min(d.depuis, depuis)
  }

  function prendreDemande(client: MjsWsClient, st: StreamState): Demande | undefined {
    const siennes = demandes.get(client)
    const d = siennes?.get(st)
    if (!siennes || !d) return undefined
    siennes.delete(st)
    if (siennes.size === 0) demandes.delete(client)
    lacherEnCours(client, st)
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
  function checkAccess(st: StreamState, client: MjsWsClient, name: string, lues: Set<string>): boolean | Promise<boolean> {
    lancerEvaluation(client, st, lues)
    if (st.bridged && !st.declared) return false   // écrit par le pont, jamais déclaré ici : sa garde est inconnue
    const access = st.access
    if (!access) return false   // fermé : déclaré sans public, room ni canSubscribe
    if (!inRoomOf(st, client)) return false
    if (!access.canSubscribe) return access.remoteGuard !== true
    let ouvertes = lecturesEnCours.get(client)
    if (!ouvertes) { ouvertes = new Set(); lecturesEnCours.set(client, ouvertes) }
    ouvertes.add(lues)
    let result: boolean | Promise<boolean>
    try { result = access.canSubscribe(client, name) }
    catch { fermerLectures(client, lues); return false }
    if (result instanceof Promise) return result.then(ok => ok === true, () => false)   // lectures fermées à l'application (cf. appliquerReponse)
    fermerLectures(client, lues)
    return result === true
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
      if (!st.warnedAfterDestroy) { st.warnedAfterDestroy = true; log('warn', t('ws.streams.ecriture-apres-destroy', { name, op: op.op })) }
      return
    }
    if (!cluster) {
      // comportement HISTORIQUE, inchangé octet pour octet — compteur local synchrone, jamais de trou possible
      const p = applyOp(st, op)
      st.seq++
      if (op.op !== 'reset') pushJournal(st, { seq: st.seq, p })
      fanStream(name, st, st.seq, p)
      if (stats) stats.fluxCompteurs.deltasEmis++
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
      .catch(err => log('error', t('ws.streams.mutation-clusterisee-echec', { name }), { err }))
  }

  // --- API applicative — app.stream(nom, opts) ---
  function stream(name: string, streamOpts?: MjsWsStreamOptions): MjsWsStreamHandle {
    const s = streamOpts === WRITTEN_BY_BRIDGE ? getOrCreateStream(name, undefined, 'bridge') : getOrCreateStream(name, streamOpts, 'code')
    return {
      add(key, value) {
        // refuse plutôt que d'empoisonner st.values (cf. isSerializableEntry)
        if (!isSerializableEntry(value)) throw new Error(t('ws.streams.entree-non-serialisable', { name, op: 'add', depth: MAX_VALUE_DEPTH }))
        produceLocal(name, s, { op: 'add', key, value })
      },
      update(key, patch) {
        if (!isSerializableEntry(patch)) throw new Error(t('ws.streams.entree-non-serialisable', { name, op: 'update', depth: MAX_VALUE_DEPTH }))
        produceLocal(name, s, { op: 'update', key, patch })
      },
      remove(key)           { produceLocal(name, s, { op: 'remove', key }) },
      reset(values) {
        if (!isSerializableEntry(values)) throw new Error(t('ws.streams.entree-non-serialisable', { name, op: 'reset', depth: MAX_VALUE_DEPTH }))
        produceLocal(name, s, { op: 'reset', values })
      },
      get size(): number   { return s.values.size },
      snapshot()           { return snapshotOf(s) },
      destroy() {
        // déjà détruit : le nom appartient peut-être à un flux recréé depuis, que l'ancienne poignée ne retire pas
        if (s.destroyed) return
        s.destroyed = true
        if (!cluster) plancherSeq = Math.max(plancherSeq, s.seq)
        else noterPlancher(name, s)
        if (streams.get(name) === s) streams.delete(name)
        // l'index des connexions lâche ce flux, et ses abonnés ne reçoivent plus rien (cf. produceLocal) ; les seaux de
        // vérification tombent avec leurs attentes, abonnées ou non (une garde repassée qui attendait son jeton) : rien ne
        // retient plus l'état du flux détruit, et une réponse arrivée après n'est plus appliquée (cf. appliquerReponse)
        for (const client of s.subscribers) {
          const mine = streamsOfClient.get(client)
          if (mine) { mine.delete(s); if (mine.size === 0) streamsOfClient.delete(client) }
          prendreDemande(client, s)
        }
        if (s.seaux) for (const client of s.seaux) {
          const siennes = verifs.get(client)
          const v = siennes?.get(s)
          if (siennes && v) { if (v.timer) clearTimeout(v.timer); siennes.delete(s); if (siennes.size === 0) verifs.delete(client) }
          prendreDemande(client, s)
        }
        s.seaux = undefined
        // évaluations et demandes encore sans réponse, même d'une garde qui ne répondra jamais (cf. enCours)
        if (s.enCours) for (const client of Array.from(s.enCours)) {
          const siennes = dernieres.get(client)
          const d = siennes?.get(s)
          if (siennes && d) { if (d.lues) fermerLectures(client, d.lues as Set<string>); siennes.delete(s); if (siennes.size === 0) dernieres.delete(client) }
          prendreDemande(client, s)
        }
        s.enCours = undefined
        if (s.silencieux) for (const client of Array.from(s.silencieux)) oublierSilence(client, s)
        s.subscribers.clear()
        s.retenus = undefined
        const rs = reorderByStream.get(name)
        if (rs) { if (rs.timer) clearTimeout(rs.timer); reorderByStream.delete(name) }
      },
    }
  }

  // en grappe : plancher du flux détruit (cf. planchers), au-delà de tout numéro qu'il a vu, même encore en attente dans le
  // tampon de réordonnancement
  function noterPlancher(name: string, st: StreamState): void {
    let seq = st.seq
    const rs = reorderByStream.get(name)
    if (rs) for (const n of rs.pending.keys()) if (n > seq) seq = n
    planchers.delete(name)
    planchers.set(name, seq)
    if (planchers.size > PLANCHERS_MAX) planchers.delete(planchers.keys().next().value as string)
  }

  // journal des demandes refusées (flux inconnu, garde, flux du pont sans déclaration) — une ligne au plus par minute
  // et par motif : la première part tout de suite, les suivantes sont comptées et annoncées par la ligne d'après. Le
  // nom, écrit par le client, est tronqué : une rafale de µ:sub-stream ne remplit plus le journal
  const REFUSAL_LOG_MS   = 60000
  const LOGGED_NAME_MAX  = 200
  const UNKNOWN_NAME_MAX = 200   // même borne que les noms de salon (rooms.ts)
  const refusalLog      = { unknown: { since: -Infinity, muted: 0 }, denied: { since: -Infinity, muted: 0 }, bridged: { since: -Infinity, muted: 0 }, closed: { since: -Infinity, muted: 0 } }

  function logRefusal(motive: keyof typeof refusalLog, line: () => string, client: MjsWsClient): void {
    const state = refusalLog[motive]
    const now   = Date.now()
    if (now >= state.since && now - state.since < REFUSAL_LOG_MS) { state.muted++; return }
    log('warn', state.muted > 0 ? line() + ' ' + t('ws.core.refus-semblables-tus', { n: state.muted }) : line(), { client: client.id })
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
      logRefusal('unknown', () => t('ws.streams.flux-non-declare-nom-trop-long', { via, name: loggedName(name), max: UNKNOWN_NAME_MAX }), client)
      rawSend(client, { t: 'µ:error', p: { message: t('ws.streams.nom-trop-long', { max: UNKNOWN_NAME_MAX }) } })
      return
    }
    logRefusal('unknown', () => t('ws.streams.flux-non-declare', { via, name: loggedName(name) }), client)
    rawSend(client, { t: name, seq: 0, p: { op: 'reset', values: {} } })
  }

  // refus d'abonnement : log + µ:error catalogué, JAMAIS un simple silence (la
  // « garde muette » serait indiscernable d'un flux non déclaré ou d'un bogue réseau côté client). Une connexion qui
  // suivait déjà le flux (sa redemande refusée) le perd : plus aucun delta, ni le rejeu d'une vérification en attente
  function denyStreamAccess(client: MjsWsClient, name: string, via: string): void {
    const st = streams.get(name)
    if (st) unsubscribe(client, st)
    if (st && st.bridged && !st.declared) logRefusal('bridged', () => t('ws.streams.flux-pont-non-declare', { via, name: loggedName(name) }), client)
    else if (st && !st.access) logRefusal('closed', () => t('ws.streams.abonnement-flux-ferme', { via, name: loggedName(name) }), client)
    else logRefusal('denied', () => t('ws.streams.abonnement-refuse', { via, name: loggedName(name) }), client)
    rawSend(client, { t: 'µ:error', p: { message: t('ws.streams.acces-flux-refuse') } })
  }

  // --- µ:sub-stream — garde d'accès (cf. checkAccess), puis abonne + instantané reset (cf. servir) ---
  function handleSubStream(client: MjsWsClient, name: string): void {
    const st = streams.get(name)
    if (!st) { unknownStreamFallback(client, name, 'µ:sub-stream'); return }
    noterDemande(client, st, true, null)
    const relance = () => handleSubStream(client, name)
    const lues    = new Set<string>()
    const allowed = checkAccess(st, client, name, lues)
    if (allowed === true || allowed === false) appliquerReponse(client, st, lues, allowed, relance, undefined, 'µ:sub-stream')
    else allowed.then(ok => appliquerReponse(client, st, lues, ok, relance, undefined, 'µ:sub-stream'))
  }

  // rejeu incrémental ou reset complet — servi seulement APRÈS la garde d'accès (cf. servir)
  function rejouer(client: MjsWsClient, st: StreamState, from: number): void {
    const name = st.name
    const seq  = st.seq
    // époque future/serveur redémarré (from > seq), ou, en grappe, numéro du flux détruit que celui-ci a remplacé → reset complet
    if (from > seq || (st.base !== undefined && from <= st.base)) { rawSend(client, { t: name, seq, p: { op: 'reset', values: snapshotOf(st) } }); if (stats) stats.fluxCompteurs.resyncsReset++; return }
    // déjà à jour → rien à renvoyer (ni rejeu ni reset — pas de compteur, rien ne s'est passé)
    if (from === seq) return

    const covered = st.journal.length > 0 && st.journal[0].seq <= from + 1
    if (!covered) { rawSend(client, { t: name, seq, p: { op: 'reset', values: snapshotOf(st) } }); if (stats) stats.fluxCompteurs.resyncsReset++; return }
    // REJEU dans l'ordre, avec les seq D'ORIGINE du journal (jamais renumérotés)
    for (const entry of st.journal) { if (entry.seq > from) rawSend(client, { t: name, seq: entry.seq, p: entry.p }) }
    if (stats) stats.fluxCompteurs.resyncsRejeu++
  }

  // --- µ:resync — garde d'accès (cf. checkAccess), puis abonne (si besoin) + rejeu (cf. servir) ---
  function handleResync(client: MjsWsClient, name: string, from: number): void {
    const st = streams.get(name)
    if (!st) { unknownStreamFallback(client, name, 'µ:resync'); return }
    noterDemande(client, st, false, from)
    const relance = () => handleResync(client, name, from)
    const lues    = new Set<string>()
    const allowed = checkAccess(st, client, name, lues)
    if (allowed === true || allowed === false) appliquerReponse(client, st, lues, allowed, relance, undefined, 'µ:resync')
    else allowed.then(ok => appliquerReponse(client, st, lues, ok, relance, undefined, 'µ:resync'))
  }

  function onDisconnect(client: MjsWsClient): void {
    lecturesEnCours.delete(client)
    for (const st of dernieres.get(client)?.keys() ?? []) if (st.enCours?.delete(client) && st.enCours.size === 0) st.enCours = undefined
    for (const st of demandes.get(client)?.keys() ?? []) if (st.enCours?.delete(client) && st.enCours.size === 0) st.enCours = undefined
    demandes.delete(client)
    const siens = silences.get(client)
    if (siens) for (const st of Array.from(siens.keys())) oublierSilence(client, st)
    dernieres.delete(client)
    const siennes = verifs.get(client)
    if (siennes) for (const [st, v] of siennes) {
      if (v.timer) clearTimeout(v.timer)
      if (st.seaux?.delete(client) && st.seaux.size === 0) st.seaux = undefined
    }
    verifs.delete(client)
    const quittes = quittees.get(client)
    if (quittes) for (const v of quittes.values()) if (v.timer) clearTimeout(v.timer)
    quittees.delete(client)
    const mine = streamsOfClient.get(client)
    if (!mine) return
    for (const st of mine.keys()) {
      st.subscribers.delete(client)
      if (st.retenus?.delete(client) && st.retenus.size === 0) st.retenus = undefined
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
  // ce salon est périmée (cf. appliquerReponse), et un flux qui attendait son jeton pour être rendu l'est au retour suivant
  // (cf. rendreAuRetour). Déconnexion : rien à faire ici, onDisconnect purge tout juste après
  function onLeaveRoom(client: MjsWsClient, room: string): (() => void) | undefined {
    if (isAlive && !isAlive(client)) return undefined
    const ouvertes = lecturesEnCours.get(client)
    if (ouvertes) for (const lues of ouvertes) if (lues.has(room)) luesPerimees.set(lues, room)
    const left = new Set<string>()
    const enAttente = quittees.get(client)
    if (enAttente) for (const [name, v] of enAttente) if (v.timer && v.salon === room) { clearTimeout(v.timer); v.timer = null; left.add(name) }
    const mine = streamsOfClient.get(client)
    for (const [st, luesAvant] of mine ? Array.from(mine) : []) {
      if (st.name.startsWith(room + '/')) { unsubscribe(client, st); continue }
      if (st.access?.room === room) { unsubscribe(client, st); left.add(st.name); continue }
      if (!st.access?.canSubscribe) continue
      if (!luesAvant.has(room) && !verifs.get(client)?.get(st)?.enVol) continue
      left.add(st.name)
      demanderVerification(client, st, room)
    }
    if (left.size === 0) return undefined
    return () => { for (const name of left) rendreAuRetour(client, name, room) }
  }

  // retour dans le salon : un flux perdu au départ est rendu comme si la connexion le redemandait — rien pour un flux
  // détruit entre-temps (redevenu comme jamais déclaré) ni pour un flux qu'elle suit encore. La garde rappelée suit la
  // cadence des départs (cf. verifs), même celle d'un flux réservé au salon : sans jeton, le flux attend son tour, et un
  // départ entre-temps le reporte au retour suivant (cf. onLeaveRoom). Une demande de ce flux déjà repassée, qui attend
  // son jeton, tranche seule : une seule attente par connexion et par flux
  function rendreAuRetour(client: MjsWsClient, name: string, room: string, jetonPris = false): void {
    const st = streams.get(name)
    if (!st || st.subscribers.has(client)) return
    const v = quittees.get(client)?.get(name) ?? verifs.get(client)?.get(st)
    if (v) v.salon = room
    if (v && !jetonPris && !quandJeton(v, () => { if (!hasRoomMember || hasRoomMember(client, room)) rendreAuRetour(client, name, room, true) })) return
    if (v) verifDe(client, st)   // la cadence suit l'abonnement rendu (un refus la remet à part, cf. denyStreamAccess)
    else if (st.access?.canSubscribe) prendreJeton(verifDe(client, st))   // garde rappelée sans cadence encore : elle commence ici
    handleSubStream(client, name)
  }

  // demande dont le « oui » est périmé (cf. appliquerReponse) : repassée à la cadence des départs, par connexion et par flux
  function repasserGarde(client: MjsWsClient, st: StreamState, suite: () => void): void {
    if (quandJeton(verifDe(client, st), suite)) suite()
  }

  // appartenance lue qui change, départ ou entrée (`room`, le salon), identité changée ou réponse d'une vérification qui ne
  // s'applique pas (`null`) : une seule vérification en vol par connexion et par flux, deux d'avance puis une par seconde
  // (cf. verifs). La connexion reste abonnée mais ne reçoit plus rien jusqu'à la réponse (cf. retenir). Pendant une
  // vérification en vol, la demande périme sa réponse : elle sera repassée
  function demanderVerification(client: MjsWsClient, st: StreamState, room: string | null): void {
    const v = verifDe(client, st)
    if (room !== null) v.salon = room
    retenir(st, client, true)
    if (v.enVol) luesPerimees.set(v.enVol, v.salon)
    else if (!v.timer && quandJeton(v, () => lancerVerification(client, st, v))) lancerVerification(client, st, v)
  }

  // identité changée par un µ:refresh accepté (même utilisateur, autres champs — câblé par core.ts) : la garde de chaque
  // flux suivi est repassée au même rythme qu'un départ, la connexion retenue sans levée possible jusqu'à sa réponse ; un
  // refus lui est annoncé (µ:error), comme à une demande. Une évaluation encore sans réponse a lu l'ancienne identité : son
  // « oui » ne compte plus, la garde est repassée
  function onIdentityChange(client: MjsWsClient): void {
    const ouvertes = lecturesEnCours.get(client)
    if (ouvertes) for (const lues of ouvertes) if (!luesPerimees.has(lues)) luesPerimees.set(lues, null)
    const mine = streamsOfClient.get(client)
    if (!mine) return
    for (const st of Array.from(mine.keys())) {
      if (!st.access?.canSubscribe) continue
      retenir(st, client, false)
      noterDemande(client, st, false, null)
      demanderVerification(client, st, null)
    }
  }

  // vérification de l'abonnement (cf. demanderVerification) : sa réponse suit la règle commune (cf. appliquerReponse).
  // `depart` : le salon du dernier départ à son lancement, ou, repassée faute d'une réponse qui s'applique, celui de la
  // vérification qu'elle remplace — revenue dedans, la connexion apprend un refus par un µ:error (cf. refuser)
  function lancerVerification(client: MjsWsClient, st: StreamState, v: Verif): void {
    const jeton = streamsOfClient.get(client)?.get(st)
    if (!jeton || (isAlive && !isAlive(client))) return
    if (streams.get(st.name) !== st) { unsubscribe(client, st); return }   // détruit entre-temps
    const depart = v.depart ?? v.salon
    v.depart = null
    const lues = new Set<string>()
    v.enVol = lues
    const allowed = checkAccess(st, client, st.name, lues)
    if (allowed === true || allowed === false) trancherVerification(client, st, v, lues, allowed, jeton, depart)
    else allowed.then(ok => trancherVerification(client, st, v, lues, ok, jeton, depart))
  }

  function trancherVerification(client: MjsWsClient, st: StreamState, v: Verif, lues: Set<string>, ok: boolean, jeton: ReadonlySet<string>, depart: string): void {
    if (v.enVol === lues) v.enVol = null
    appliquerReponse(client, st, lues, ok, null, jeton, 'µ:sub-stream', depart)
  }

  // retenue : rien du flux ne part vers la connexion (cf. fanStream) ; sur un « oui » qui s'applique, ce qu'elle a manqué
  // lui est rejoué (cf. servir). `levable` (départ, entrée, vérification repassée) : la connexion revenue dans chaque salon que la
  // réponse qui l'a abonnée a lu dedans, et absente de chaque salon qu'elle a lu dehors, reçoit de nouveau tant que rien
  // n'a été retenu — revenir dans un seul ne suffit pas ; sinon (une évaluation en a dépassé une autre encore en attente,
  // garde resserrée) plus rien jusqu'à la réponse qui s'applique
  function retenir(st: StreamState, client: MjsWsClient, levable: boolean): void {
    if (!st.subscribers.has(client)) return
    const r = st.retenus?.get(client)
    if (r) { if (!levable) r.levable = false; return }
    if (!st.retenus) st.retenus = new Map()
    st.retenus.set(client, { levable, depuis: null })
  }

  // diffusion d'un delta — un flux réservé à un salon contrôle l'appartenance à CHAQUE envoi : un abonné qui
  // n'en est plus membre (parti, expulsé, par quelque chemin que ce soit) est désabonné au passage ; un abonné retenu ne
  // reçoit rien (rejoué sur un « oui », cf. retenir)
  function fanStream(name: string, st: StreamState, seq: number, p: Record<string, unknown>): void {
    const room = st.access?.room
    if (room != null) for (const client of st.subscribers) if (!(hasRoomMember && hasRoomMember(client, room))) unsubscribe(client, st)
    let skip: Set<MjsWsClient> | null = null
    if (st.retenus) for (const [client, r] of st.retenus) {
      if (r.depuis == null && r.levable && appartenancesInchangees(client, streamsOfClient.get(client)?.get(st))) continue
      if (r.depuis == null) r.depuis = seq - 1
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
    if (stats) stats.fluxCompteurs.deltasEmis++
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
    log('warn', t('ws.streams.application-avec-trou', { name, reason, count: seqs.length }), { pending: seqs })
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
    if (stats) stats.adaptateur.reordonnances++
    if (rs.pending.size > REORDER_MAX_PENDING) { forceFlush(name, st, t('ws.streams.tampon-reordonnancement-plein', { max: REORDER_MAX_PENDING })); return }
    if (!rs.timer) rs.timer = setTimeout(() => forceFlush(name, st, t('ws.streams.delai-reordonnancement-depasse', { ms: REORDER_TIMEOUT_MS })), REORDER_TIMEOUT_MS)
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
  // les compteurs cumulés (deltasEmis/resyncs*) vivent dans le registre lui-même (fluxCompteurs).
  function statsSnapshot(): { nombre: number } {
    return { nombre: streams.size }
  }

  return { stream, handleSubStream, handleResync, onDisconnect, onLeaveRoom, onJoinRoom, onIdentityChange, noteMembershipRead, receiveRemote, statsSnapshot }
}
