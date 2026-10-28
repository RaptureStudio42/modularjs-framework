// mjs-server/game — l'instance de partie : état applicatif (`state`, librement muté par les
// coups), sièges, phase, tour, minuteries NOMMÉES (sérialisables, jamais de fermeture stockée),
// journal borné, diffusion groupée par microtâche (mode événementiel, tick=0) OU par tick (mode
// action, tick>0). Tout ce qui est marqué `_` en tête n'est PAS un contrat public MjsServerApp —
// usage interne exclusif de matchmaking.ts (sœur de confiance, pas une app hôte : aucun besoin des
// gardes `(x as any)` que core.ts réserve à ses accroches de test, cf. son commentaire de tête).
//
// MODE ACTION (def.tick > 0, 1-60 Hz, cf. game-def.ts) — 3 pièces :
//  - intentions (def.intents) — reçues par _onMove comme un move, mais mises en FILE par
//    joueur (_intentQueue, dernière valeur gagne par nom) au lieu d'être exécutées ; la boucle
//    (setInterval, _startTickLoop/_runTick) déroule à chaque tick : intentions en file
//    (ordre des SIÈGES) → def.simulate(game, dt RÉEL mesuré) → UNE diffusion (_broadcastTick).
//    `_markDirty` ne diffuse plus rien tant que tick>0 (il n'y pose que la marque de sauvegarde, cf. _markTick) : la cadence de
//    diffusion appartient exclusivement à la boucle dans ce mode (jamais les deux à la fois). Les moves
//    classiques restent exécutés IMMÉDIATEMENT, hors boucle (ex. chat) — cf. _onMove.
//    def.slowTick optionnel = 2e setInterval à sa propre cadence, indépendante de `tick`.
//    Boucle démarrée dès le 1er siège CONNECTÉ (_checkEmpty, y compris _createSeat), coupée à la
//    vidange, à .end() et à ._destroy() — jamais de setInterval résiduel.
//  - deltas (def.deltas, ORTHOGONAL à tick) — _buildFrame calcule PAR JOUEUR un diff profond
//    (deepDiff plus bas) entre la vue courante et `_lastViews` (dernière vue ENVOYÉE à CE
//    joueur) ; repli vue complète en 1re diffusion/resync/delta trop gros (>60% du JSON de la vue).
//    Défaut false = frame IDENTIQUE au v1 (compatibilité stricte, cf. tests/socket-game.test.ts).
//  - persistance (_onMutate) — la partie n'est marquée à sauvegarder que si quelque chose a pu la changer (cf. _markTick) : un
//    coup, une intention, un siège, la phase, le tour, la fin, game.changed() la font écrire ; simulate, slowTick et les minuteries
//    de l'appli, dont l'effet ne se voit pas, seulement si elle diffère de sa dernière sauvegarde, comparée au moment d'écrire (cf.
//    _prepareSave) — une empreinte par sauvegarde tentée, pas par tick, sauf ticks plus espacés que le débounce de persist.ts (chacun
//    tente alors la sienne). La boucle passe la marque au plus une fois par TICK_PERSIST_THROTTLE_MS
//    (_markDirtyTick) ; arrêtée, la marque part tout de suite, et à l'arrêt du serveur aussi (_releaseMark). Boucle arrêtée, ce
//    que change une minuterie ou game.changed() est diffusé tout de suite (_broadcastWithoutLoop). Le lissage et l'écriture réels restent gouvernés par persist.ts
//    (débounce/snapshotEvery). La suite d'une intention asynchrone (la Promise qu'elle rend) marque la partie à sa fin, comme un coup ;
//    celle de simulate ou de slowTick aussi, comparée à la dernière sauvegarde comme leur début — boucle arrêtée entre-temps, elle est
//    diffusée tout de suite (_broadcastWithoutLoop).
//
// Sièges/tour/minuteries — quelques décisions v1 assumées :
//  - .next() (roundrobin) fait tourner le tour parmi TOUS les sièges occupés, connectés ou non —
//    aucun « saut » automatique d'un siège déconnecté (fidèle à « pas de kick automatique v1 »).
//    Le VRAI filet contre un tour bloqué par un absent, c'est turns.timeout (générique, 30 s par
//    défaut, `null` pour s'en passer : partie par correspondance), pas un filtrage caché en plus.
//  - .end() n'impose AUCUNE phase — si l'auteur veut fermer les coups après la fin, il déclare sa
//    propre phase 'fin' à coups vides dans `def.phases` et l'atteint lui-même via `.to('fin')`.
//  - .end() arme une grâce de destruction = `def.endTtl` (défaut `def.emptyTtl`, qui reste la vie d'une
//    partie vide non finie) : la partie reste interrogeable (resync) le temps que les clients encaissent la fin.
//    Elle désarme aussi la minuterie de tour (`µturn`), la fenêtre de confirmation des sièges de la file
//    (`µmatch`) et TOUTES les minuteries nommées de l'appli (`.timer()`) : une partie finie n'est jamais « annulée »,
//    son tour n'est pas rejoué et le code de l'appli ne tourne plus ; une minuterie armée après la fin (depuis
//    `onEnd`, par exemple) ne part pas non plus. La grâce (`µempty`) est la seule minuterie qui reste armée.

import type { MjsWsApp, MjsWsClient } from '../mjs-ws/index.js'
import { TokenBucket, errMessage } from '../mjs-ws/guard.js'
import type { MjsServerResolvedDef } from './game-def.js'
import { createSpace } from './space.js'
import type { MjsServerSpace } from './space.js'
// compensation de lag — tampon circulaire de positions, cf. history.ts pour le contrat complet
import { createHistory } from './history.js'
import type { MjsServerHistory, MjsServerHistoryPositions, MjsServerHistoryMeta } from './history.js'
// mode lockstep — la salle ne simule rien, cf. lockstep.ts pour le contrat complet
import { createLockstep } from './lockstep.js'
import type { MjsServerLockstep, MjsServerLockstepTick, MjsServerLockstepSnapshot } from './lockstep.js'
import { t } from '../messages/index.js'
import type { MsgKey } from '../messages/index.js'

// id de peer = identity.id si présent, sinon `anon:` suivi de l'id de connexion — RÉIMPLÉMENTATION LOCALE de
// mjs-ws/rooms.ts peerIdOf (non exportée par l'index public de MJS-WS —
// composition sur l'API PUBLIQUE seulement), même forme : les anonymes ont leur propre espace de noms. Sans lui, un compte
// dont l'id valait l'id de connexion d'un anonyme (`c5`, dans une appli où l'on choisit son pseudo) reprenait le siège de cet
// anonyme. MJS-WS refuse dès le hello un compte dont l'id commence par `anon:` ; s'il en arrivait un quand même, il serait
// préfixé une fois de plus (jamais un id de connexion, qui ne commence pas ainsi). Seul écart : un id vide, ou un objet sans
// conversion propre, compte ici comme une absence d'identité. Conséquence à
// connaître : sans `opts.auth` côté MJS-WS, chaque reconnexion change d'id (repli sur l'id de
// connexion, qui ne survit jamais à une coupure) — µgame:resync ne peut alors JAMAIS retrouver
// un siège après coupure. Une identité stable (opts.auth) est le prix de la reprise v1.
export function peerIdOf(client: MjsWsClient): string {
  const identity = client.identity
  if (identity && typeof identity === 'object' && 'id' in (identity as object)) {
    const raw = (identity as Record<string, unknown>).id
    const id  = raw != null ? String(raw) : ''
    // chaîne vide/blanche = pas d'identité stable (auth mal typée…) — repli sur l'id de connexion,
    // sinon deux connexions distinctes collisionnent sur le même siège ; même repli pour un objet sans conversion propre
    // (`[object Object]`, le même pour tous), un objet qui se convertit en chaîne (identifiant de base de données) restant stable
    if (id.trim() !== '' && !(typeof raw === 'object' && id.startsWith('[object '))) return id.startsWith('anon:') ? 'anon:' + id : id
  }
  return 'anon:' + client.id
}

// noms de minuterie RÉSERVÉS (internes à MJS-Server) — jamais un nom d'auteur valide dans
// `def.timers` (game-def.ts le refuse à la déclaration) NI en argument direct de `game.timer()`
// (refusé aussi, cf. plus bas) : même politique que le préfixe 'µgame:' des trames (index.ts).
export const RESERVED_TIMER_NAMES = new Set(['µturn', 'µmatch', 'µempty'])

// messages du journal selon le code JEU que _guardTimerCall garde : une minuterie applicative (def.timers, par défaut), le crochet
// hooks.onTurnTimeout, le passage de tour automatique (turns.order ; next() ne rend jamais de Promise : `rejected` y est sans objet)
interface TimerCallKeys { thrown: MsgKey; rejected?: MsgKey }
const TIMER_CALL_KEYS:      TimerCallKeys = { thrown: 'serveur.partie-timer-applicatif-leve', rejected: 'serveur.partie-timer-applicatif-rejete' }
const TURN_TIMEOUT_KEYS:    TimerCallKeys = { thrown: 'serveur.partie-onturntimeout-leve', rejected: 'serveur.partie-onturntimeout-rejete' }
const TURN_ORDER_AUTO_KEYS: TimerCallKeys = { thrown: 'serveur.partie-turns-order-timeout-leve' }

// résultat de la fin « entrée refusée » d'un joueur dont hooks.onJoin a refusé l'entrée — même forme que les fins d'annulation
// ({ cancelled: true, reason: 'seat-expired' }) : un drapeau et une raison
function joinRefusedResult(): { refused: true; reason: 'join-refused' } {
  return { refused: true, reason: 'join-refused' }
}

// plafond d'un setTimeout Node (2^31-1 ms, 24,8 jours) : au-delà il arme 1 ms — cf. _arm, qui attend par tranches, et limits.moveWaitMs,
// refusé au-delà (game-def.ts)
export const MAX_TIMEOUT_MS = 2147483647
const JOURNAL_MAX = 200
// mode action — throttle LOCAL de la marque de sauvegarde que passe la boucle (_markDirtyTick), INDÉPENDANT de def.tick (jusqu'à
// 60 Hz) : borne la fréquence d'APPEL du hook _onMutate, jamais la logique d'écriture elle-même
// (100% chez persist.ts, débounce/snapshotEvery inchangés) — cf. commentaire de tête du fichier
const TICK_PERSIST_THROTTLE_MS = 100
// anti-triche (µgame:hash, cf. _consumeHashToken plus bas) — budget FIXE, PAS de clé
// def.limits dédiée (garde volontairement SIMPLE) : même chiffre que
// DEFAULT_MOVES_LIMIT (game-def.ts, 30/1000ms) — largement au-dessus d'un usage légitime (µ.lockstep
// hache par défaut toutes les 60 ticks, cf. mjs_lockstep.ts), bloque un flood de hash par ailleurs
// VALIDES mais coûteux à traiter (Map par tick, cf. lockstep.ts) ; canal DISTINCT de `_buckets`
// (coups) — jamais mélangé, cf. _bucketsHash. Les propositions d'instantané (µgame:snapshot) ont le leur, à la cadence du jeu (cf.
// _consumeSnapshotToken) : au-delà de 30 Hz, une cadence de 1 en enverrait plus que ces 30 jetons.
const HASH_LIMIT: [number, number] = [30, 1000]
// anti-triche (détection par coup) — anneau borné DÉDIÉ (JAMAIS mélangé à `journal`, le
// journal COURT v1 des coups CLASSIQUEMENT appliqués ci-dessus, cf. commentaire de tête du fichier)
const ANTICHEAT_LOG_MAX = 100
// anti-triche (def.antiReplay) — fenêtre MAXIMALE d'avance de séquence acceptée en 1 coup :
// protège contre un `_n`/`_s` empoisonné à une valeur énorme, qui ferait paraître tout coup FUTUR
// légitime « en retard » pour toujours (dernier resterait bloqué à cette valeur aberrante) — budget
// FIXE, garde volontairement SIMPLE (MÊME esprit que HASH_LIMIT ci-dessus, pas de clé def dédiée)
const ANTIREPLAY_WINDOW = 1000

/** cf. MjsServerLimitsDef.moveWaitMs — un coup asynchrone qui ne s'est pas réglé en 10 s libère la requête du joueur (ses coups suivants restent refusés jusqu'à sa fin) */
export const DEFAULT_MOVE_WAIT_MS = 10000

// segments que le client refuse de suivre dans un chemin à points (garde contre la pollution de prototype, cf. mjs_game.ts::_applyDeltaOps)
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** une opération de delta (cf. _buildFrame) — `v` pose/remplace la valeur au chemin `p`
 *  ('a.2.b', à points, jamais échappés : un objet qui porte une clé à point, ou une clé __proto__/constructor/prototype, est remplacé
 *  en bloc, cf. deepDiff),
 *  `x: 1` supprime la clé finale du chemin. */
export interface MjsServerDeltaOp { p: string; v?: unknown; x?: 1 }

/** diff profond RÉCURSIF (objets/tableaux traités UNIFORMÉMENT via Object.keys — un index de
 *  tableau n'est jamais qu'une clé numérique), scalaires comparés par égalité STRICTE. Un
 *  changement de FORME (objet<->tableau/scalaire) OU un tableau qui RÉTRÉCIT remplace tout le
 *  sous-arbre EN BLOC à ce chemin — plutôt qu'une récursion incohérente entre deux formes
 *  différentes, ou un diff par clé qui émettrait un `x:1` par index retiré (cf. juste plus bas). */
function deepDiff(chemin: string, old: unknown, fresh: unknown, ops: MjsServerDeltaOp[]): void {
  if (old === fresh) return
  const oldObj = typeof old === 'object' && old !== null
  const newObj   = typeof fresh === 'object' && fresh !== null
  if (!oldObj || !newObj || Array.isArray(old) !== Array.isArray(fresh)) {
    ops.push({ p: chemin, v: fresh })
    return
  }
  // rétrécissement de tableau : un diff par clé émettrait `{x:1}` sur les index retirés — `delete`
  // côté client (cf. mjs_game.ts::_applyDeltaOps) laisse un TROU et ne corrige pas `.length`, d'où
  // un `undefined` en queue. Remplacement du sous-arbre EN BLOC = seul cas sûr ; un
  // tableau qui GRANDIT ou se réordonne à longueur ÉGALE garde le diff par clé (l'affectation
  // d'index étend `.length` toute seule côté client, aucun souci).
  if (Array.isArray(old) && Array.isArray(fresh) && fresh.length < old.length) {
    ops.push({ p: chemin, v: fresh })
    return
  }
  const keys = new Set([...Object.keys(old as object), ...Object.keys(fresh as object)])
  // une clé qui contient un point (« jean.dupont ») ne s'écrit pas dans un chemin à points, le client y lirait deux clés ; une clé
  // __proto__/constructor/prototype (un pseudo « constructor ») y serait jetée par le client, qui ne suit jamais ces segments :
  // l'objet qui la porte est remplacé EN BLOC à ce chemin (à la racine, chemin vide : vue complète, cf. _buildFrame)
  for (const key of keys) {
    if (key.includes('.') || UNSAFE_PATH_KEYS.has(key)) { ops.push({ p: chemin, v: fresh }); return }
  }
  for (const key of keys) {
    const subPath = chemin ? chemin +'.'+ key : key
    const inOld = Object.prototype.hasOwnProperty.call(old, key)
    const inFresh   = Object.prototype.hasOwnProperty.call(fresh, key)
    if (inOld && !inFresh) { ops.push({ p: subPath, x: 1 }); continue }
    if (!inOld && inFresh) { ops.push({ p: subPath, v: (fresh as Record<string, unknown>)[key] }); continue }
    deepDiff(subPath, (old as Record<string, unknown>)[key], (fresh as Record<string, unknown>)[key], ops)
  }
}

export interface MjsServerSeat {
  readonly seat: number
  /** identity.id (ou id de connexion en repli, cf. peerIdOf) — stable across reconnexions SEULEMENT avec une identité authentifiée */
  readonly id: string
  /** connexions LIVE représentant ce siège en ce moment — 0+ (0 = déconnecté, cf. `connected`) */
  readonly clients: Set<MjsWsClient>
  connected: boolean
}

interface JournalEntry {
  move: string
  player: string
  // plus jamais remplie (cf. _playMove) : seule une sauvegarde d'une version antérieure peut encore la porter
  p?: unknown
  at: number
}

// --- anti-triche (détection par coup, TOUT opt-in via def, cf. _antiCheatGuard
// plus bas) — 3 mesures indépendantes (def.suspect métier / def.antiReplay séquence / def.limits.
// moveIntervalMs cadence) qui partagent le MÊME journal borné + les MÊMES compteurs agrégés ---------

/** contexte transmis à def.suspect EN PLUS de `move` (1er argument) — SURFACE MINIMALE, jamais le
 *  MjsServerSeat complet (`.clients` resterait une fuite d'état interne) : `seat` est
 *  l'INDEX numérique (même convention que _broadcastSeats()), `game` est l'instance ENTIÈRE (MÊME
 *  accès que def.moves/intents/simulate/view, cf. game-def.ts) ; `type`/`turn`/`phase` = raccourcis vers
 *  game.type/turn/phase (évite un détour par `game.xxx` pour les 3 lectures les plus courantes).
 *  `p` (anti-triche) — charge BRUTE du coup, TELLE QUE REÇUE (jamais consommée
 *  ni mutée avant cet appel, cf. _onMove) : permet au hook d'inspecter le CONTENU du coup,
 *  pas seulement son nom — ajout PUREMENT ADDITIF, rétro-compatible (un def.suspect existant qui
 *  ignorait déjà les champs en trop du contexte continue de fonctionner à l'identique). */
export interface MjsServerSuspectContext {
  seat: number
  game: Game
  type: string
  turn: string | null
  phase: string | null
  p: unknown
}

/** retour de def.suspect — falsy (false/undefined/void) = RAS ; `true` = suspect journalisé SEUL,
 *  JAMAIS rejeté tout seul (politique de rejet PAR DÉFAUT : explicite uniquement, cf. tests) ;
 *  `{ reason?, reject? }` = suspect journalisé + REJETÉ si `reject:true` (reason par défaut
 *  'suspect' si omise) — cf. _antiCheatGuard. */
export type MjsServerSuspectResult = boolean | { reason?: string; reject?: boolean } | void

/** un événement du journal anti-triche (cf. _antiCheatLogBuf/_reportSuspicion) — MÊME forme
 *  transmise telle quelle à def.onSuspicion. `type` ICI = nom du COUP concerné (à ne pas confondre
 *  avec MjsServerSuspectContext.type = game.type, un objet différent). */
export interface MjsServerSuspicionEvent {
  time: number
  seat: number
  type: string
  reason: string
  /** `true` = le coup a été REJETÉ (pas appliqué) — sous-ensemble des événements journalisés, cf. _antiCheatLogBuf */
  rejected: boolean
}

/** compteurs anti-triche AGRÉGÉS pour l'app ENTIÈRE (tous jeux/parties confondus, jamais
 *  réinitialisés à la destruction d'UNE partie — même politique que garde.kicksDebit &c. côté
 *  mjs-ws/stats.ts) — cf. index.ts::mjsServer() pour la création + le greffage ADDITIF sur
 *  app.stats() (`game: {...}`, rétro-compatible : un mjsWs() nu ou un app.stats() déjà consommé
 *  ailleurs ne perd rien), matchmaking.ts pour le rattachement à CHAQUE partie (MÊME patron que
 *  `_onMutate`/persist.ts::armGame). */
export interface MjsServerGameStats {
  /** def.suspect véridique (rejeté ou non) + violations antiReplay/moveIntervalMs (TOUJOURS rejetées) */
  suspectMoves: number
  /** sous-ensemble de coupsSuspects RÉELLEMENT rejeté (coup non appliqué) */
  rejectedMoves: number
}

interface TimerSnapshot { name: string; at: number }
interface SeatSnapshot {
  seat: number
  id: string
  connected: boolean
  // anti-triche par joueur — `undefined` si le joueur n'a
  // encore envoyé aucun coup à antiReplay/cadence, jamais 0 par défaut (0 serait une SÉQUENCE valide)
  lastAntiReplaySeq?: number
  lastMoveAt?: number
}

/** cf. .serialize()/restoreGameFromSnapshot() — la couture de la persistance à venir */
export interface MjsServerGameSnapshot {
  id: string
  type: string
  code: string | null
  state: unknown
  phase: string | null
  turn: string | null
  seq: number
  journal: JournalEntry[]
  seats: Array<SeatSnapshot | null>
  timers: TimerSnapshot[]
  /** cf. .end()/`_ended` — absent d'un instantané ANTÉRIEUR à ce champ (rétro-compat : traité comme
   *  `false`, une partie qu'on ne SAIT pas terminée reste jouable, comportement HISTORIQUE inchangé
   *  côté restoreGame). Sans lui, une partie terminée puis rechargée acceptait de nouveau des coups. */
  ended?: boolean
  /** résultat transmis à .end() (cf. `_endResult`) — absent si `ended` est absent/false. UNIQUEMENT
   *  pour la persistance : jamais relu ailleurs, jamais retransmis à hooks.onEnd (idempotence de
   *  .end(), cf. `_ended` — restaurer une partie finie ne rejoue JAMAIS le hook). */
  result?: unknown
  /** cf. `_started` (matchmaking.ts::markStartedIfFull) — absent = traité comme `false` (rétro-compat) */
  started?: boolean
  /** cf. `_unconfirmedSeats`/_armConfirmWindow — sièges (id) qui n'ont pas encore confirmé leur
   *  place lors d'une complétion par file ; absent/`null` = aucune fenêtre de confirmation en cours */
  unconfirmedSeats?: string[] | null
  /** mode lockstep — µpersist = JOURNAL D'ORDRES (cf. lockstep.ts) — `undefined` pour
   *  une partie 'authoritative' (absent après un aller-retour JSON, rétro-compat totale des anciens
   *  instantanés). Pas de `seed` : ré-dérivée de `id` à la restauration, cf. deterministicSeed. `snapshot` : le dernier
   *  instantané gardé (cf. lockstep.ts « INSTANTANÉS »), le journal ne portant alors que les ticks qui le suivent ; absent sans lui */
  lockstep?: { journal: MjsServerLockstepTick[]; snapshot?: MjsServerLockstepSnapshot }
}

export class Game {
  readonly id: string
  readonly type: string
  code: string | null = null
  state: unknown
  phase: string | null
  turn: string | null = null
  seq = 0
  journal: JournalEntry[] = []
  players: Array<MjsServerSeat | null>

  readonly app: MjsWsApp
  readonly def: MjsServerResolvedDef
  // tout ce qui suit est `_`-préfixé PAR CONVENTION (pas de `private` TS, MÊME parti pris que
  // MjsWsClientImpl côté mjs-ws/core.ts, cf. son commentaire de tête) : matchmaking.ts (sœur de
  // confiance) et les factory functions plus bas (hors de la classe) y accèdent directement.
  _onDestroy: (game: Game) => void
  _dirty = false
  /** la diffusion groupée en attente (`_dirty`) sauvegarde aussi la partie — faux quand seules des minuteries de l'appli qui laissent
   *  la partie identique à sa dernière sauvegarde l'ont demandée (cf. _markDirty, _markTimerDirty) */
  _saveWanted = false
  /** empreinte (cf. _savedPrint) de la dernière sauvegarde RÉUSSIE, prise quand persist.ts a sérialisé la partie pour l'écrire (cf.
   *  _prepareSave) et retenue quand l'écriture aboutit (cf. _noteSaved) — une écriture refusée ou restée sans réponse ne la change pas :
   *  le stockage porte peut-être encore la précédente. Le tir d'une minuterie de l'appli s'y compare pour savoir s'il faut sauvegarder
   *  (mode événementiel, cf. _markTimerDirty), la sauvegarde suivante pour savoir s'il faut écrire (mode action). `null` = inconnue
   *  (aucune sauvegarde réussie dans ce processus, partie restaurée, empreinte non calculée) : la minuterie qui part, ou la sauvegarde
   *  suivante, fait alors écrire la partie */
  _lastSavePrint: string | null = null
  /** mode action — une marque de sauvegarde attend que la boucle de tick la passe à la persistance (cf. _markTick, _markDirtyTick) */
  _tickMark = false
  /** mode action — depuis la dernière sauvegarde, la partie a changé à coup sûr (coup, intention, siège, phase, tour, game.changed()…) :
   *  la sauvegarde suivante s'écrit sans comparaison ; sinon seul du code dont l'effet ne se voit pas a tourné (simulate, slowTick,
   *  minuterie de l'appli), et elle ne s'écrit que si la partie diffère de sa dernière sauvegarde (cf. _prepareSave) */
  _saveSure = false
  _destroyed = false
  /** arrêt du serveur commencé (matchmaking.ts, holdTimers) : plus aucune minuterie de la partie ne part — ni grâce, ni tour, ni
   *  minuterie de l'appli. L'échéance reste dans `_timers`, donc dans la sauvegarde de la rafale finale, et part au redémarrage : une
   *  grâce échue pendant que l'arrêt attendait un stockage lent détruisait la partie en plein arrêt (hooks.onDestroy appelé, sauvegarde
   *  retirée), alors que l'arrêt ne finit aucune partie. Jamais remis à `false` : la partie est détruite à la fin de l'arrêt */
  _held = false
  /** `true` dès le PREMIER .end() réussi (cf. .end() plus bas) — SÉPARÉE de `_destroyed` : une partie
   *  finie mais encore dans sa fenêtre de grâce `endTtl` est `_ended=true, _destroyed=false` (toujours
   *  interrogeable, cf. commentaire de tête). Rend .end() IDEMPOTENT — sans elle, un move métier
   *  qui rappelle game.end() (pattern resign/gameOver, avant que
   *  la grâce ne rende `_destroyed` vrai) rejouait hooks.onEnd + µgame:end + réarmait `µempty` à
   *  volonté (double récompense, result spoofé, partie maintenue en vie indéfiniment). Jamais
   *  réinitialisée (aucun « re-end » possible, MÊME esprit que `_started` ci-dessus). */
  _ended = false
  /** résultat transmis au .end() qui a posé `_ended` — cf. commentaire de `_ended` juste au-dessus ;
   *  UNIQUEMENT pour la persistance (serialize()/restoreGame, cf. leurs commentaires) : jamais relu
   *  ailleurs, jamais retransmis à hooks.onEnd (idempotence de .end(), cf. `_ended`). */
  _endResult: unknown = undefined
  /** `true` dès que `seats` a été atteint une 1re fois (cf. matchmaking.ts µgame:start) — jamais réinitialisé */
  _started = false
  /** partie MUETE — posée par matchmaking.ts le temps d'apparier un groupe de la file : tant que tous les joueurs appariés n'ont pas passé
   *  hooks.onJoin, rien ne part de la partie vers les sièges (ni roster, ni état, ni événement), la boucle de tick ne démarre pas et rien
   *  n'est sauvegardé ; _announce() la rend audible. `false` partout ailleurs (parties par code, parties restaurées). */
  _silent = false
  _buckets: Array<TokenBucket | null> = []
  /** anti-triche (µgame:hash) — seau à jetons DÉDIÉ par siège, canal DISTINCT de `_buckets`
   *  (coups) : cf. HASH_LIMIT/_consumeHashToken plus bas. */
  _bucketsHash: Array<TokenBucket | null> = []
  /** mode lockstep avec instantanés (µgame:snapshot) — seau à jetons DÉDIÉ par siège, jamais celui des hash : cf. _consumeSnapshotToken */
  _bucketsSnapshot: Array<TokenBucket | null> = []
  _unconfirmedSeats: Set<string> | null = null
  _timers = new Map<string, { at: number; handle: ReturnType<typeof setTimeout> }>()
  /** couture persistance (persist.ts) — posée par MjsServerPersistEngine.armGame()
   *  UNIQUEMENT si `opts.persist` est actif (sinon `null`, jamais assignée, zéro coût) : appelée à
   *  CHAQUE diffusion d'état (cf. _broadcastState ci-dessous), jamais dans le chemin chaud lui-même
   *  (le débounce/l'écriture réelle vivent entièrement côté persist.ts). */
  _onMutate: ((game: Game) => void) | null = null
  // --- mode action (cf. commentaire de tête) ----------------------------------------
  /** zone d'intérêt OPTIONNELLE (def.space) — `null` si non déclarée, cf. space.ts */
  space: MjsServerSpace | null = null
  /** tampon circulaire de positions (def.history) — `null` si non déclaré, cf. history.ts */
  _history: MjsServerHistory | null = null
  /** mode lockstep (def.mode:'lockstep') — `null` hors lockstep, cf. lockstep.ts */
  _lockstep: MjsServerLockstep | null = null
  /** mode lockstep avec instantanés — connexions qui ont déjà proposé un instantané (µgame:snapshot) : elles savent le lire au resync.
   *  Tant qu'une connexion assise n'y est pas, aucun accord ne coupe le journal (cf. _receiveSnapshot) */
  _snapshotReaders = new WeakSet<MjsWsClient>()
  _tickHandle: ReturnType<typeof setInterval> | null = null
  _slowTickHandle: ReturnType<typeof setInterval> | null = null
  /** Date.now() du tick précédent — sert à mesurer `dt` RÉEL (cf. _runTick) */
  _lastTick = 0
  /** compteur de tick MONOTONE (def.history) — jamais réinitialisé, sert de méta à rewind() */
  _tickCount = 0
  /** intentions en attente — player.id → (nom → dernier payload reçu), vidée à chaque tick */
  _intentQueue = new Map<string, Map<string, unknown>>()
  /** deltas (def.deltas) — CONNEXION (jamais l'identité du joueur) → dernière vue NORMALISÉE
   *  (JSON round-trip) ENVOYÉE À CETTE connexion précise. Par CONNEXION et non par joueur : deux
   *  onglets d'une même identité ont chacun leur PROPRE baseline — sans ça, le `µgame:resync` de
   *  l'un avance la baseline PARTAGÉE, et l'autre ne reçoit alors plus jamais rien (son prochain
   *  delta se calcule contre une vue qu'IL n'a jamais reçue lui-même, souvent déjà vide). Nettoyée
   *  à la déconnexion/au départ de CETTE connexion (cf. _onDisconnect/_leave) — sinon une entrée
   *  gardée pour un client mort (voire réutilisée si la MÊME connexion rejoint à nouveau) fausserait
   *  la 1re diffusion suivante. */
  _lastViews = new Map<MjsWsClient, unknown>()
  /** deltas (def.deltas) — CONNEXION → {phase, turn, _ack} DERNIÈREMENT ENVOYÉS à cette connexion
   *  (cf. _buildFrame) : sans ce suivi, un changement de phase/tour/_ack SANS changement de vue ne
   *  produirait AUCUNE trame (deltas vides ⇒ frame `null`) — la méta serait perdue pour ce round.
   *  MÊME politique de clé et de nettoyage que `_lastViews` juste au-dessus. */
  _lastMeta = new Map<MjsWsClient, { phase: string | null; turn: string | null; ack: number | undefined }>()
  /** couture _ack (netcode) — player.id → dernier `_n` APPLIQUÉ (jamais en arrière) ;
   *  `_n` est un numéro d'ordre OPTIONNEL posé par le CLIENT (µ.predict, cf.
   *  src/runtime/mjs_predict.ts) aux côtés du payload d'une intention — absent chez un jeu qui ne
   *  l'utilise pas, `_ack` n'apparaît alors JAMAIS sur la trame (cf. _buildFrame). */
  _lastAppliedN = new Map<string, number>()
  _lastPersistMark = 0
  // --- anti-triche (détection par coup, cf. section dédiée plus bas) -----------------
  /** def.antiReplay — player.id → dernier seq ACCEPTÉ (`_n` s'il existe déjà côté predict, SINON `_s`
   *  dédié, cf. _extractAntiReplaySeq) — INDÉPENDANTE de `_lastAppliedN` ci-dessus (celle-ci sert
   *  SEULEMENT l'`_ack` de réconciliation predict, jamais un rejet) : lire `_n` ici ne consomme rien,
   *  ne mute rien côté predict — les deux Maps avancent en parallèle, sans jamais s'influencer. */
  _lastAntiReplaySeq = new Map<string, number>()
  /** def.limits.moveIntervalMs — player.id → Date.now() du dernier coup ACCEPTÉ (horloge SERVEUR,
   *  jamais côté client) — canal DISTINCT de `_buckets` (débit MOYEN, cf. plus bas) : borne la
   *  RAFALE/cadence instantanée, pas le débit sur la fenêtre. */
  _lastMoveAt = new Map<string, number>()
  /** anneau borné (JOURNAL_ANTITRICHE_MAX) des coups suspects/rejetés de CETTE partie — cf.
   *  _antiCheatLog() (lecture défensive) / _reportSuspicion (écriture) */
  _antiCheatLogBuf: MjsServerSuspicionEvent[] = []
  /** compteurs APP-ENTIÈRE — posé par matchmaking.ts APRÈS la construction (MÊME patron que
   *  `_onMutate`/persist.ts::armGame), `null` UNIQUEMENT quand une Game est construite HORS
   *  mjsServer() (fakeApp() des tests directs, cf. tests/mjs-server-anti-triche*.test.ts) — jamais en
   *  usage réel : mjsServer() (index.ts) l'arme TOUJOURS, coût négligible (même politique « toujours
   *  actif » que le registre mjs-ws/stats.ts lui-même, cf. son commentaire de tête). */
  _gameStats: MjsServerGameStats | null = null

  // --- anti-triche (spectateurs + quota inter-parties, TOUT opt-in,
  // anti-triche poussé au maximum) -------------------------------------------------------------------
  /** connexions SPECTATRICES (lecture seule) — jamais dans `this.players`, jamais comptées dans
   *  `seats` (cf. _addSpectator) ; nettoyé au départ volontaire (_leave) ET à la
   *  déconnexion (_onDisconnect), cf. leurs commentaires respectifs. */
  _spectators = new Set<MjsWsClient>()
  /** avertissement « spectateur sans vue sûre » émis AU PLUS UNE FOIS par partie (jamais par
   *  diffusion — un mode action jusqu'à 60Hz spammerait sinon), cf. _spectatorView. */
  _warnedSpectatorNoView = false
  /** quota de coups PAR IDENTITÉ agrégé APP-ENTIÈRE (cf. MjsServerAntiCheatOptions.movesPerIdentity,
   *  index.ts) — posé par matchmaking.ts::create() APRÈS construction (MÊME patron que `_gameStats`
   *  ci-dessus) ; `null` = option absente (AUCUN contrôle) OU Game construite HORS mjsServer()
   *  (harnais direct des tests). Le registre RÉEL (Map identité→TokenBucket) vit ENTIÈREMENT dans
   *  matchmaking.ts (seul point qui voit toutes les parties vivantes) — cette fonction n'est qu'un
   *  simple PONT, zéro état ici. */
  _identityQuota: ((id: string) => boolean) | null = null
  /** identité d'un joueur → ses coups asynchrones pas encore réglés (cf. _onMove) : `turn` se règle à la fin du DERNIER (`false`), ou
   *  au passage de limits.moveWaitMs depuis son départ (`true`) — le coup suivant du joueur l'attend ; `done`, à la vraie fin de tous ;
   *  `stuck` : un de ces coups a passé limits.moveWaitMs sans se régler, les coups suivants sont refusés. L'entrée disparaît dès que
   *  plus rien n'est en cours */
  _movesInFlight = new Map<string, { turn: Promise<boolean>; done: Promise<unknown>; stuck: boolean }>()

  constructor(app: MjsWsApp, def: MjsServerResolvedDef, onDestroy: (game: Game) => void, id: string) {
    this.app        = app
    this.def        = def
    this.type       = def.type
    this._onDestroy = onDestroy
    this.id         = id
    this.players    = new Array(def.seats).fill(null)
    this.phase      = def.phases ? (Object.keys(def.phases)[0] ?? null) : null
    this.space      = def.space ? createSpace(def.space.cell, msg => def.log('warn', msg)) : null
    this._history     = def.history ? createHistory(def.history.ticks) : null
    this._lockstep  = def.mode === 'lockstep' ? createLockstep(id, def.lockstepJournal?.maxTicks ?? null, { maxBytes: def.lockstepJournal?.maxBytes, maxOrderBytes: def.lockstepJournal?.maxOrderBytes }, def.lockstepSnapshot?.every ?? null, def.lockstepSnapshot?.window ?? null) : null
  }

  // --- API publique (contrat du design MJS-Server) --------------------------------------------

  /** tour suivant — 'roundrobin' (ordre des sièges) ou `turns.order` fourni ; no-op sans `turns` */
  next(): void {
    this._passTurn(null)
  }

  /** cf. next() — `fromSeat` = le siège que le détenteur du tour vient de quitter (départ, entrée refusée) : en 'roundrobin', le tour
   *  repart du siège qui le suit (sans lui, il revenait au premier siège : un joueur rejouait aussitôt, un autre était sauté) */
  _passTurn(fromSeat: number | null): void {
    if (!this.def.turns) return
    const order = this.def.turns.order
    const nextSeat = order === 'roundrobin' ? this._nextRoundrobin(fromSeat) : order(this)
    this.turn = typeof nextSeat === 'string' ? nextSeat : (nextSeat ? nextSeat.id : null)
    this._armTurnTimeout()
    this._markDirty()
  }

  /** change de phase — valide contre `def.phases` SI déclaré (sinon libre, aucune restriction) */
  to(phase: string): void {
    if (this.def.phases && !(phase in this.def.phases)) {
      throw new Error(t('serveur.partie-phase-inconnue', { phase: phase, phases: Object.keys(this.def.phases).join(', ') }))
    }
    this.phase = phase
    this._markDirty()
  }

  /** arme/réarme une minuterie NOMMÉE — à l'échéance, appelle `def.timers[name](game)` : l'état est rediffusé, la partie sauvegardée
   *  seulement si elle diffère alors de sa dernière sauvegarde — état, phase, tour, sièges, fin, minuteries présentes ; une minuterie
   *  réarmée sous le même nom ne compte pas (cf. _markTimerDirty). Sérialisable ({name, at}, cf. serialize()) :
   *  jamais de fermeture stockée. Sans effet une fois la partie finie :
   *  .end() coupe les minuteries de l'appli, et celle qu'on armerait ensuite (depuis hooks.onEnd, par exemple) ne part pas. Sans effet non
   *  plus sur une partie détruite : un hooks.onJoin asynchrone peut rendre la main après la destruction du groupe de la file.
   *  Un nom absent de `def.timers` lève tout de suite (propriété PROPRE, comme moves/intents : un nom hérité, 'toString'…, n'est pas
   *  une minuterie déclarée) — armé, il ne lançait rien à son échéance. */
  timer(name: string, ms: number): void {
    if (RESERVED_TIMER_NAMES.has(name)) throw new Error(t('serveur.partie-timer-nom-reserve', { nom: name }))
    if (!Object.hasOwn(this.def.timers, name)) {
      const declared = Object.keys(this.def.timers)
      throw new Error(t('serveur.partie-timer-inconnu', { nom: name, timers: declared.length > 0 ? declared.join(', ') : t('serveur.partie-timer-aucun') }))
    }
    this._armByName(name, ms)
  }

  /** événement applicatif (µgame:event) à tous les sièges CONNECTÉS */
  send(type: string, p?: unknown): void {
    this._broadcastTo('µgame:event', { type, p })
  }

  /** annonce un changement que MJS-Server ne voit pas seul : celui que fait du code qui tourne hors d'un coup, d'une minuterie et de
   *  la Promise qu'ils rendent (la suite d'un appel lancé sans être attendu, une réponse reçue plus tard…). Mode événementiel : l'état
   *  est diffusé et la partie sauvegardée, comme après un coup (une seule diffusion par microtâche, cf. _markDirty). Mode action : la
   *  sauvegarde est demandée tout de suite, sans attendre la cadence de la boucle ; la diffusion reste celle de la boucle tant qu'elle
   *  tourne (au tick suivant) — arrêtée (partie finie, plus aucun siège connecté), aucun tick ne porterait le changement : il part ici
   *  (cf. _broadcastWithoutLoop). Sans effet sur une partie détruite ou muette (appariement de la file en cours : _announce() la marque
   *  elle-même) */
  changed(): void {
    if (this._destroyed || this._silent) return
    if (this.def.tick <= 0) { this._markDirty(); return }
    if (this._onMutate) { this._saveSure = true; this._onMutate(this) }
    this._broadcastWithoutLoop()
  }

  /** vue filtrée par joueur (`def.view`, défaut = état entier) — jamais accédée à `def` en dehors de
   *  ce fichier. Throw en mode 'lockstep' (def.view est `null`, cf. game-def.ts) — ne devrait jamais être
   *  appelée pour une partie lockstep (aucun état serveur), cf. _infoMode/_broadcastTickOrders. */
  viewFor(player: MjsServerSeat | null): unknown {
    if (!this.def.view) throw new Error(t('serveur.partie-vuede-lockstep'))
    return this.def.view(this, player)
  }

  /** partie du protocole SPÉCIFIQUE au mode — 'authoritative' : `{ view: viewFor(player) }` ;
   *  'lockstep' : `{ seed, journal }` (graine + historique des ordres, cf. lockstep.ts) — le client rejoue le journal pour
   *  rattraper l'état commun (cf. µ.lockstep, mjs_lockstep.ts) ; avec des instantanés (def.lockstepJournal.snapshotEvery), en plus
   *  `snapshotEvery` et `snapshotMax` (cadence et taille permise d'une proposition), et `snapshot`, le dernier gardé, dont le client
   *  repart avant de rejouer les ordres qui le suivent. Point
   *  UNIQUE consommé par les 3 réponses qui portent l'identité de siège (seatResponse/pushStart
   *  côté matchmaking.ts, _resync ci-dessous) — jamais dupliqué. */
  _infoMode(player: MjsServerSeat | null): Record<string, unknown> {
    if (this.def.mode === 'lockstep') {
      const info: Record<string, unknown> = { seed: this._lockstep!.seed, journal: this._lockstep!.journal() }
      const every = this.def.lockstepSnapshot
      if (every) { info.snapshotEvery = every.every; info.snapshotMax = every.max }
      const snapshot = this._lockstep!.snapshot()
      if (snapshot) info.snapshot = snapshot
      return info
    }
    return { view: this.viewFor(player) }
  }

  /** mode lockstep — une page qui ne sait pas lire un instantané ne se déclare pas (`snapshots: true` dans µgame:play et µgame:resync,
   *  cf. mjs_game.ts) : face à un journal déjà coupé, elle repartirait de son état initial sans les ordres retirés (journal tronqué, état
   *  faux). Refusée franchement dès qu'un instantané est gardé, avec de quoi recharger la page, avant de prendre ou de retrouver son
   *  siège ; tant que le journal est entier, elle joue comme les autres (sa présence retient alors toute coupe, cf. _receiveSnapshot).
   *  Lève l'erreur que reçoit sa requête ; rien hors du mode lockstep */
  _requireSnapshotReader(reads: boolean): void {
    if (!reads && this._lockstep?.snapshot()) throw new Error(t('serveur.partie-page-sans-instantane'))
  }

  /** compensation de lag serveur (def.history) — rembobine le tampon d'historique à l'instant
   *  `instantMs` (ms epoch, Date.now()-like ; borné : plus vieille entrée dispo si `instantMs` est
   *  trop ancien, entrée du tick COURANT si `instantMs` est dans le futur, cf. history.ts) : appelle
   *  `fn(positionsFigées, méta)` et RETOURNE tel quel son résultat. `positionsFigées` = COPIE gelée
   *  (Object.freeze, l'objet ET chaque {x,y}) de l'instantané retenu — jamais l'original de l'anneau,
   *  jamais mutable (cf. history.ts pour la justification). Throw si `def.history` n'est pas déclaré, ou
   *  si le tampon est vide (aucun tick encore écoulé, ou partie détruite). */
  rewind<T>(instantMs: number, fn: (positions: MjsServerHistoryPositions, meta: MjsServerHistoryMeta) => T): T {
    if (!this._history) throw new Error(t('serveur.partie-rembobiner-sans-histo'))
    return this._history.rewind(instantMs, fn)
  }

  /** compensation de lag serveur (def.history) — instant (ms epoch) que CE joueur voyait au
   *  moment où il a agi = maintenant − (latence aller estimée de SA connexion + retard
   *  d'interpolation déclaré, def.history.interp) ; latence lue sur `client.latency` (MJS-WS, déjà
   *  mesurée par le réservoir ping/pong, cf. mjs-ws/core.ts handlePing) de la 1re connexion LIVE de
   *  ce siège — déconnecté ou latence pas-encore-mesurée (`null`) replient sur 0 (aucune
   *  compensation par défaut, jamais un throw pour une mesure simplement absente). Throw si
   *  `def.history` n'est pas déclaré (pas de `interp` par défaut sans lui). */
  timeSeenBy(player: MjsServerSeat): number {
    if (!this.def.history) throw new Error(t('serveur.partie-instantvupar-sans-histo'))
    let latency = 0
    for (const client of player.clients) { latency = client.latency ?? 0; break }
    return Date.now() - (latency + this.def.history.interp)
  }

  /** fin de partie — µgame:end + hooks.onEnd, puis destruction après une grâce `def.endTtl` (défaut `def.emptyTtl`) :
   *  la partie reste interrogeable avant de disparaître du registre — un resync répond encore, mais sans dire qu'elle est
   *  finie (la réponse n'a ni `ended` ni `result` : l'issue n'y est que si le `state` ou la `view` de l'appli la porte).
   *  La minuterie de tour (`µturn`), la fenêtre de confirmation des sièges de la file (`µmatch`) et toutes les minuteries nommées
   *  de l'appli (`.timer()`) sont désarmées d'entrée : sans cela, la fenêtre `seatTtl` encore ouverte « annulait » la partie finie
   *  en pleine grâce (2e µgame:end, partie détruite), le tour continuait de passer (onTurnTimeout rappelé, état rediffusé et
   *  sauvegardé) et les minuteries de l'appli (un rappel récurrent, par exemple) tiraient pendant toute la grâce. Une minuterie
   *  armée après la fin (par hooks.onEnd, ou par un appel direct à `.timer()`) n'est pas armée (cf. _armByName).
   *  IDEMPOTENT (cf. `_ended`) : un 2e appel (avant OU après la grâce) est un NO-OP total — pas de
   *  2e diffusion µgame:end, pas de 2e hooks.onEnd, pas de réarmement de `µempty` (sinon la partie
   *  resterait vivante indéfiniment tant qu'un move rejoue .end() sous le quota limits.moves).
   *  hooks.onEnd est protégé par un `finally` — même s'il LÈVE, `µempty` est TOUJOURS armée
   *  ensuite (sinon une partie dont le hook casse ne serait plus jamais détruite, cf. _checkEmpty/
   *  _onEmptyExpired) ; le throw, lui, continue de remonter normalement à l'appelant de .end().
   *  `endTtl ?? emptyTtl` : une définition résolue construite à la main avant l'option `endTtl` n'a que `emptyTtl`.
   *  Une Promise rendue par le hook (hors contrat) n'est pas attendue : son rejet est journalisé, la fin a eu lieu (cf. _followRejection).
   *  Relayée aux spectateurs (cf. _broadcastToSpectatorsRaw) — anti-triche, amélioration : une
   *  partie finie restait visuellement active côté spectateur (aucun signal de fin). */
  end(result: unknown): void {
    if (this._destroyed || this._ended) return
    this._ended = true
    this._endResult = result
    this._stopTickLoop()
    this._disarm('µturn')
    this._disarm('µmatch')
    this._disarmAppTimers()
    this._unconfirmedSeats = null
    this._broadcastTo('µgame:end', { result })
    this._broadcastToSpectatorsRaw('µgame:end', { result })
    try {
      this._followRejection('serveur.partie-onend-rejete', this.def.hooks.onEnd?.(this, result))
    } finally {
      this._armByName('µempty', this.def.endTtl ?? this.def.emptyTtl)
    }
  }

  /** état+phase+sièges+minuteries+journal → objet JSON-able — couture de la persistance. Porte
   *  aussi `ended`/`result` (cf. `_ended`/`_endResult`), `started` et `unconfirmedSeats` (cf.
   *  restoreGame, qui les restaure symétriquement) — sans eux, une partie TERMINÉE puis rechargée
   *  oubliait qu'elle l'était (coups de nouveau acceptés) et la fenêtre de confirmation d'une
   *  partie issue de la file perdait toute portée après un redémarrage.
   *  Mode lockstep : `lockstep: { journal }` REMPLACE `state` conceptuellement (µpersist =
   *  journal d'ordres, cf. lockstep.ts) — `state` reste présent mais vaut `undefined` (jamais assigné,
   *  cf. le constructeur matchmaking.ts::create()), élidé par JSON.stringify. */
  serialize(): MjsServerGameSnapshot {
    return {
      id:      this.id,
      type:    this.type,
      code:    this.code,
      state:   this.state,
      phase:   this.phase,
      turn:    this.turn,
      seq:     this.seq,
      // trace des coups sans leur charge : déjà reflétée dans `state`, la recopier ferait grossir
      // chaque sauvegarde du détail de chaque coup (jusqu'à 200 charges, sans borne de taille)
      journal: this.journal.map(e => ({ move: e.move, player: e.player, at: e.at })),
      // anti-triche par joueur repeuplé au restore — _buckets (cadence flood) repart PLEIN
      // par design (TokenBucket non sérialisable proprement, risque moindre qu'un rejeu accepté)
      seats: this.players.map(j => j ? { seat: j.seat, id: j.id, connected: j.connected, lastAntiReplaySeq: this._lastAntiReplaySeq.get(j.id), lastMoveAt: this._lastMoveAt.get(j.id) } : null),
      timers: Array.from(this._timers.entries()).map(([name, t]) => ({ name, at: t.at })),
      ended: this._ended,
      result: this._endResult,
      started: this._started,
      unconfirmedSeats: this._unconfirmedSeats ? Array.from(this._unconfirmedSeats) : null,
      lockstep: this._lockstep ? lockstepData(this._lockstep) : undefined,
    }
  }

  // --- usage interne (matchmaking.ts) — hors du contrat MjsServerApp -------------------------

  /** siège existant occupé par CETTE connexion, sinon `null` */
  _findSeatOf(client: MjsWsClient): MjsServerSeat | null {
    return this.players.find((j): j is MjsServerSeat => j !== null && j.clients.has(client)) ?? null
  }

  /** assigne un siège à cette connexion — POINT D'ENTRÉE UNIQUE, appelé par TOUT chemin
   *  d'attribution (file publique ET code privé, cf. matchmaking.ts::playQueued/createWithCode/
   *  joinWithCode) : la dédup ci-dessous les couvre donc tous les trois d'un coup.
   *
   *  Dédup par IDENTITÉ (anti-triche) — si `peerIdOf(client)` occupe DÉJÀ un siège de
   *  CETTE partie (2e onglet d'une même session, spam de µgame:play après appariement…), on
   *  RÉATTACHE cette connexion au siège EXISTANT (MÊME logique que _reattachSeat — une
   *  reconnexion/2e onglet, réutilisée telle quelle) plutôt que d'en créer un 2e : sans ça, une
   *  identité pourrait voir SES DEUX mains cachées à la fois et casser le tour par tour (2 sièges
   *  = 2 `player.id` identiques dans `this.players`). Choix
   *  assumé : RÉATTACHER (jamais refuser) — symétrique de _resync, qui fait déjà exactement ça
   *  pour reconnecter un onglet après coupure ; refuser aurait cassé le cas légitime « 2 onglets
   *  ouverts par erreur, l'utilisateur ferme le premier » (le 2e doit continuer à fonctionner).
   *  Les identités ANONYMES (pas d'identity.id stable, repli sur l'id de CONNEXION — cf. peerIdOf)
   *  restent distinctes PAR CONSTRUCTION : chaque connexion sans identité stable EST sa propre
   *  identité, la dédup y est inévitablement inopérante — limite documentée, pas un trou (seule
   *  une identité authentifiée stable, cf. opts.auth, bénéficie de la protection).
   *
   *  Sinon (aucun siège existant pour cette identité) : assigne un siège NEUF (1er emplacement
   *  libre) — throw si complète.
   *
   *  `admissions` — posé par matchmaking.ts (file publique et parties par code) : la Promise rendue par hooks.onJoin n'est alors PAS suivie
   *  d'un refus après coup (cf. _refuseSeat) mais rangée dans ce tableau, que l'appelant attend ; elle rend le siège si onJoin a rejeté,
   *  `null` sinon. Tant que l'appelant n'a pas statué, le siège n'est pas annoncé (ni roster, ni sauvegarde, ni boucle de tick) : il
   *  l'admet (_seatAdmitted) ou le défait sans trace (_dropSeat). */
  _createSeat(client: MjsWsClient, admissions?: Array<Promise<MjsServerSeat | null>>): MjsServerSeat {
    const existing = this._reattachSeat(client)
    if (existing) { this._broadcastSeats(); return existing }
    // partie finie (grâce `endTtl`) : un joueur déjà assis s'y rattache encore (ci-dessus), un nouveau venu n'y prend pas le siège
    // laissé libre par un départ — il serait assis dans une partie terminée et hooks.onJoin tournerait après la fin
    if (this._ended) throw new Error(t('serveur.partie-terminee'))
    const index = this.players.findIndex(j => j === null)
    if (index === -1) throw new Error(t('serveur.partie-complete'))
    const player: MjsServerSeat = { seat: index, id: peerIdOf(client), clients: new Set([client]), connected: true }
    this.players[index] = player
    // le siège est posé AVANT onJoin (le hook lit game.players et player.seat) ; un throw de onJoin REFUSE le joueur : son siège
    // est rendu avant que l'erreur ne remonte (rien n'a été diffusé de lui, aucune trame de la partie ne lui part ensuite). Ce que
    // onJoin a fait avant de lever (état modifié, game.send()…) n'est PAS défait. Une Promise rendue par le hook (hors contrat) est
    // suivie : son rejet est journalisé. Sans `admissions`, il refuse le joueur après coup (cf. _refuseSeat), le siège étant annoncé
    // tout de suite ; avec `admissions`, c'est l'appelant qui attend la Promise (l'appariement de la file, ou la réponse d'une partie
    // par code) et décide du sort du siège, qui n'est annoncé qu'ensuite
    try {
      const key     = !admissions ? 'serveur.partie-onjoin-rejete' : this._silent ? 'serveur.partie-onjoin-rejete-file' : 'serveur.partie-onjoin-rejete-code'
      const joining = this._followRejection(key, this.def.hooks.onJoin?.(this, player), admissions ? undefined : () => this._refuseSeat(player))
      if (admissions && joining) {
        admissions.push(joining.then(admitted => admitted ? null : player))
        return player
      }
    } catch (err) {
      this._dropSeat(player)
      throw err
    }
    this._seatAdmitted()
    return player
  }

  /** le siège qui vient d'être pris est admis (hooks.onJoin n'a pas refusé) : le roster part, la partie est sauvegardée et sa boucle de
   *  tick démarre au 1er siège CONNECTÉ (mode action) — no-op en mode événementiel (tick=0) pour la boucle, cf. _checkEmpty */
  _seatAdmitted(): void {
    this._broadcastSeats()
    this._markDirty()
    this._checkEmpty()
  }

  /** défait un siège pris dont l'admission est refusée AVANT toute annonce (throw de onJoin, ou rejet connu avant la réponse d'une
   *  partie par code) : rien n'a été diffusé de lui, personne ne voit rien. Sans effet si le siège a changé de main (l'appli a pu le
   *  vider elle-même, contournement historique). S'il avait la main (onJoin a pu la lui donner), le tour passe au siège suivant. Une
   *  partie sans siège connecté est fermée ou arme sa grâce de partie vide (cf. _afterDeparture), sans repousser celle déjà en cours */
  _dropSeat(player: MjsServerSeat): void {
    if (this.players[player.seat] === player) {
      this.players[player.seat] = null
      this._passTurnFrom(player)
    }
    if (!this._timers.has('µempty')) this._afterDeparture()
  }

  /** refus d'un siège après coup (la Promise de hooks.onJoin est rejetée) — un départ forcé, sans hooks.onLeave (le joueur n'est
   *  jamais entré) : le siège est vidé, les autres sièges et les spectateurs reçoivent µgame:left, le tour passe au siège suivant
   *  s'il avait la main (sinon l'autre joueur attendait l'échéance de turns.timeout), puis le roster à jour part, l'état est
   *  rediffusé et sauvegardé, et une partie qui n'a plus aucun siège connecté est fermée ou arme sa grâce de partie vide (cf.
   *  _afterDeparture ; sans repousser celle déjà en cours). Le refusé a déjà reçu la réponse de sa requête : il reçoit, lui seul et
   *  avant les autres, une fin de partie « entrée refusée » (µgame:end { refused: true, reason: 'join-refused' }), puis plus aucune
   *  trame ; son prochain coup ou resync est refusé comme celui de n'importe quel joueur non assis. Sans effet si le siège a changé
   *  de main entre-temps (départ, contournement historique) ou si la partie est détruite */
  _refuseSeat(player: MjsServerSeat): void {
    if (this._destroyed || this.players[player.seat] !== player) return
    this.players[player.seat] = null
    for (const c of player.clients) { this._lastViews.delete(c); this._lastMeta.delete(c) }
    for (const c of player.clients) this._sendJoinRefused(c)
    this._broadcastTo('µgame:left', { seat: player.seat })
    this._broadcastToSpectatorsRaw('µgame:left', { seat: player.seat })
    this._passTurnFrom(player)
    this._broadcastSeats()
    this._markDirty()
    if (!this._timers.has('µempty')) this._afterDeparture()
  }

  /** le siège tout juste vidé de `player` (entrée refusée, cf. _refuseSeat/_dropSeat) avait la main : le tour passe au siège suivant.
   *  Une erreur de turns.order n'a personne à qui remonter : elle est journalisée, le refus va à son terme */
  _passTurnFrom(player: MjsServerSeat): void {
    if (!this.def.turns || this.turn !== player.id) return
    try {
      this._passTurn(player.seat)
    } catch (err) {
      this.def.log('error', t('serveur.partie-turns-order-refus-leve', { msg: errMessage(err) }))
    }
  }

  /** fin de partie « entrée refusée » (µgame:end { refused: true, reason: 'join-refused' }) à UNE connexion : le refus d'un joueur
   *  assis (cf. _refuseSeat) ou d'un ticket de la file défait avant l'annonce de sa partie (matchmaking.ts) — la partie, elle, ne
   *  finit pas pour les autres. Le refus d'un joueur assis part dans la forme `{ game, result }` : `game` est une partie que son client
   *  connaît. Celui d'un ticket de la file (`queue`) porte en plus `type` et `queue: true` : `game` est l'id d'une partie défaite
   *  qu'aucun client n'a jamais vu, de quoi rattacher la fin à la poignée en file du même type et à elle seule */
  _sendJoinRefused(client: MjsWsClient, queue = false): void {
    const result = joinRefusedResult()
    this.app.send(client, 'µgame:end', queue ? { game: this.id, type: this.type, queue: true, result } : { game: this.id, result })
  }

  /** fin du silence d'une partie de la file (cf. `_silent`) : tous les joueurs appariés ont passé hooks.onJoin, la partie devient
   *  audible — le roster part, l'état est diffusé et sauvegardé, la boucle de tick démarre (mode action). L'annonce de la partie
   *  aux sièges (µgame:start et réponse de l'appelant) revient à matchmaking.ts. Une partie finie pendant son silence (hooks.onJoin
   *  a appelé .end()) n'avait rien pu dire de sa fin : µgame:end part aux sièges un tour de boucle plus tard, après leur µgame:start
   *  et la réponse de l'appelant (avant, leur client ne connaît pas encore la partie et ignorerait la fin) */
  _announce(): void {
    this._silent = false
    this._seatAdmitted()
    if (this._ended) setImmediate(() => this._broadcastTo('µgame:end', { result: this._endResult }))
  }

  /** rattache CETTE connexion à un siège EXISTANT de même identité (reconnexion) — `null` si aucun */
  _reattachSeat(client: MjsWsClient): MjsServerSeat | null {
    const id = peerIdOf(client)
    const player = this.players.find((j): j is MjsServerSeat => j !== null && j.id === id) ?? null
    if (!player) return null
    player.clients.add(client)
    player.connected = true
    this._checkEmpty()
    return player
  }

  /** µgame:resync — rattache + info fraîche COMPLÈTE (vue, ou seed+journal en mode lockstep, cf.
   *  _infoMode : « à la reconnexion, le client reçoit seed + journal et rejoue ») */
  _resync(client: MjsWsClient): { seat: number; info: Record<string, unknown> } {
    const player = this._reattachSeat(client)
    if (!player) throw new Error(t('serveur.partie-pas-dans-partie'))
    this._confirmSeat(player.id)
    this._broadcastSeats()
    const info = this._infoMode(player)
    // resync = TOUJOURS une vue complète (jamais un delta) ; en mode deltas
    // (authoritative SEUL — lockstep n'a pas de `view`, cf. _infoMode), ce qui vient d'être envoyé
    // DEVIENT la baseline — le prochain _buildFrame() pourra delta-er dessus au lieu de
    // re-considérer cette CONNEXION comme « jamais vue » (repli inutile). PAR CONNEXION (`client`),
    // jamais par identité (`player.id`) — cf. _lastViews : sinon le resync d'un 2e onglet avance
    // la baseline PARTAGÉE et le 1er onglet ne reçoit alors plus jamais de trame.
    if (this.def.deltas) {
      this._lastViews.set(client, JSON.parse(JSON.stringify(info.view)))
      this._lastMeta.set(client, { phase: this.phase, turn: this.turn, ack: this._lastAppliedN.get(player.id) })
    }
    return { seat: player.seat, info }
  }

  // --- spectateurs (anti-triche, lecture seule) ------------------------------------

  /** rejoint comme SPECTATEUR — n'occupe AUCUN siège (jamais dans `this.players`, jamais compté
   *  dans `seats`) : ajoute la connexion à `_spectators` et renvoie une info fraîche COMPLÈTE
   *  (MÊME enveloppe `{view}` que seatResponse/_resync côté matchmaking.ts, cf. _spectatorInfo)
   *  pour l'ack de la requête. Tout µgame:move ultérieur de cette connexion est rejeté PAR
   *  CONSTRUCTION (_findSeatOf ne cherche que dans `this.players`, cf. _onMove plus
   *  bas — message précisé « spectateur : lecture seule »). Idempotent (Set) : rejouer la même
   *  requête avec la MÊME connexion ne fait rien de plus. La vue est calculée AVANT l'inscription : une vue qui lève fait échouer
   *  la requête sans laisser la connexion inscrite (sinon une erreur au journal à chaque diffusion). */
  _addSpectator(client: MjsWsClient): { view: unknown } {
    const info = this._spectatorInfo()
    this._spectators.add(client)
    return info
  }

  /** vue SÛRE d'un spectateur — cf. def.spectatorView (game-def.ts::resolveGameDef, RÉSOUT DÉJÀ le
   *  repli sur le `view` AUTEUR le cas échéant, jamais le défaut état-complet) : `null` = aucune
   *  vue sûre disponible pour CE jeu → repli `{}` STRICT (JAMAIS l'état brut à un spectateur par
   *  défaut), avec un avertissement émis UNE SEULE FOIS par partie (guard
   *  `_warnedSpectatorNoView` ci-dessous — jamais par diffusion, un mode action à 60Hz spammerait sinon). */
  _spectatorView(): unknown {
    if (this.def.spectatorView) return this.def.spectatorView(this)
    if (!this._warnedSpectatorNoView) {
      this._warnedSpectatorNoView = true
      this.def.log('warn', t('serveur.partie-spectateur-sans-vue', { type: this.type }))
    }
    return {}
  }

  /** enveloppe `{view}` d'un spectateur — MÊME point unique que _infoMode(player) pour les sièges,
   *  mais SANS branche lockstep (seed/journal) : un spectateur ne rejoue rien localement, une
   *  simple vue lui suffit quel que soit `def.mode` (def.spectatorView reste mode-agnostique,
   *  cf. game-def.ts). */
  _spectatorInfo(): { view: unknown } {
    return { view: this._spectatorView() }
  }

  /** µgame:leave volontaire — vide le siège (contrairement à une déconnexion, qui le garde). Gère
   *  aussi un spectateur (anti-triche) : retrait silencieux de `_spectators`, AUCUNE trame en
   *  retour pour lui (permet à sock.leave() côté client de fonctionner SANS changement, qu'il
   *  s'agisse d'une poignée siège OU spectateur) — le départ D'UN SIÈGE, lui, diffuse µgame:left
   *  aux AUTRES sièges ET, désormais, aux spectateurs (cf. _broadcastToSpectatorsRaw).
   *  le siège est vidé AVANT le code JEU (hooks.onLeave, puis turns.order au passage de tour) ; un throw de ce code ne coupe jamais
   *  la suite du départ (prévenir les autres, roster, état, partie vide à détruire : sans elle, une partie dont le dernier joueur
   *  part ainsi resterait en mémoire pour toujours) ; la 1re erreur remonte à celui qui part une fois le départ fini (réponse
   *  d'erreur de sa requête µgame:leave), la 2e, qui n'a plus personne à qui remonter, est journalisée ; ce que le code a fait
   *  avant de lever n'est pas défait ; une Promise rejetée par onLeave est journalisée (cf. _followRejection) */
  _leave(client: MjsWsClient): void {
    const player = this._findSeatOf(client)
    if (player) {
      this.players[player.seat] = null
      // deltas (def.deltas) — le siège ENTIER se vide (toutes ses connexions perdent leur place) :
      // purge _lastViews/_lastMeta pour CHACUNE (cf. leurs commentaires) — sinon une connexion qui
      // quitte puis rejoint (même objet client, ex. leave/play sans coupure réseau) retrouverait une
      // baseline PÉRIMÉE de son passage précédent et sauterait la 1re diffusion « vue complète »
      for (const c of player.clients) { this._lastViews.delete(c); this._lastMeta.delete(c) }
      let failure: { err: unknown } | null = null   // enveloppée : une valeur levée falsy (throw undefined) reste une erreur
      try {
        this._followRejection('serveur.partie-onleave-rejete', this.def.hooks.onLeave?.(this, player))
      } catch (err) {
        failure = { err }
      }
      this._broadcastTo('µgame:left', { seat: player.seat })
      this._broadcastToSpectatorsRaw('µgame:left', { seat: player.seat })
      if (this.def.turns && this.turn === player.id) {
        try {
          this._passTurn(player.seat)
        } catch (err) {
          if (failure) this.def.log('error', t('serveur.partie-turns-order-depart-leve', { msg: errMessage(err) }))
          else failure = { err }
        }
      }
      this._broadcastSeats()
      this._markDirty()
      this._afterDeparture()
      if (failure) throw failure.err
      return
    }
    if (this._spectators.delete(client)) return
    throw new Error(t('serveur.partie-pas-assis'))
  }

  /** déconnexion (MJS-WS opts.onDisconnect) — marque le siège déconnecté SANS le vider ; la
   *  partie continue (tour par tour social, pas de kick auto v1), sauf une table jamais complète qui
   *  n'a plus aucun siège connecté, fermée tout de suite (cf. _afterDeparture). Un spectateur (anti-triche),
   *  lui, est retiré PURE ET SIMPLEMENT (aucun « siège déconnecté » à conserver pour un
   *  rôle en lecture seule — cf. _addSpectator, jamais de resync spectateur v1). Retourne
   *  `true` si ce client occupait bien un siège OU regardait ICI (matchmaking s'en sert pour
   *  arrêter de chercher ailleurs). */
  _onDisconnect(client: MjsWsClient): boolean {
    const player = this.players.find((j): j is MjsServerSeat => j !== null && j.clients.has(client)) ?? null
    if (player) {
      player.clients.delete(client)
      // deltas (def.deltas) — CETTE connexion précise disparaît : purge sa baseline (cf.
      // _lastViews/_lastMeta) — jamais celle des AUTRES connexions du même siège (multi-onglets),
      // qui restent valides tant qu'elles restent live
      this._lastViews.delete(client)
      this._lastMeta.delete(client)
      if (player.clients.size === 0) player.connected = false
      this._broadcastSeats()
      this._markDirty()
      this._afterDeparture()
      return true
    }
    return this._spectators.delete(client)
  }

  /** coup reçu — vérifs (assis, phase, tour, anti-abus) puis `def.moves[move](game, player, p)` ;
   *  un throw (garde ICI ou dans le move lui-même) remonte tel quel — matchmaking.ts le laisse
   *  filer jusqu'à app.serve (µ:ack{e:true}, comme tout serve() normal).
   *  Les coups d'un même joueur passent un par un, comme les trames d'une même connexion (mjs-ws) : tant qu'un coup ASYNCHRONE
   *  du joueur n'est pas réglé, le suivant (venu d'un autre onglet) attend sa fin, puis passe toutes les gardes comme s'il
   *  arrivait (sans quoi deux onglets jouaient deux fois dans le même tour). Sans coup en cours, rien ne change : un coup
   *  synchrone rend son résultat, ou lève, tout de suite. Un coup qui ne se règle pas en limits.moveWaitMs depuis son départ (cf.
   *  _moveSettled) libère sa requête : elle reçoit une erreur, le coup continue sur le serveur — MJS-WS traite les trames d'une
   *  connexion une par une, et tout ce que l'onglet du joueur enverrait ensuite (resync, départ, discussion) attendrait sinon
   *  derrière elle. Les coups suivants du joueur, eux, sont refusés jusqu'à la vraie fin de ce coup, ceux qui l'attendaient
   *  compris : jamais deux coups du même joueur à la fois. */
  _onMove(client: MjsWsClient, move: string, p: unknown): unknown {
    const id      = peerIdOf(client)
    const pending = this._movesInFlight.get(id)
    if (pending?.stuck) throw new Error(t('serveur.partie-coup-precedent-en-cours'))
    const result  = pending ? pending.turn.then(expired => this._playQueuedMove(client, move, p, expired)) : this._playMove(client, move, p)
    if (!result || typeof (result as any).then !== 'function') return result
    const ended = (result as Promise<unknown>).then(() => {}, () => {})
    // un coup en file part quand le précédent est réglé : son délai de garde court à partir de là ; refusé derrière un coup resté
    // sans réponse, il garde l'entrée bloquée jusqu'à la fin de celui-ci
    const turn  = pending ? pending.turn.then(expired => expired || this._moveSettled(result as Promise<unknown>, move)) : this._moveSettled(result as Promise<unknown>, move)
    const entry = { turn, done: pending ? Promise.all([pending.done, ended]) : ended, stuck: false }
    this._movesInFlight.set(id, entry)
    turn.then(expired => { if (expired) entry.stuck = true })
    entry.done.then(() => { if (this._movesInFlight.get(id) === entry) this._movesInFlight.delete(id) })
    return new Promise<unknown>((resolve, reject) => {
      (result as Promise<unknown>).then(resolve, reject)
      turn.then(expired => { if (expired) reject(new Error(t('serveur.partie-coup-sans-reponse', { coup: move, ms: this._moveWaitMs() }))) })
    })
  }

  /** cf. MjsServerLimitsDef.moveWaitMs — repli sur le défaut pour une définition résolue construite à la main avant l'option */
  _moveWaitMs(): number {
    return this.def.limits.moveWaitMs ?? DEFAULT_MOVE_WAIT_MS
  }

  /** fin (réglée, jamais rejetée) d'un coup asynchrone (`false`), ou passage de limits.moveWaitMs sans qu'il soit réglé (`true`) —
   *  journalisé : sa requête reçoit une erreur et les coups suivants du joueur sont refusés jusqu'à sa fin (le coup lui-même
   *  continue, sa fin éventuelle rediffuse l'état comme d'habitude). La minuterie ne retient pas le processus et disparaît dès la
   *  fin du coup */
  _moveSettled(result: Promise<unknown>, move: string): Promise<boolean> {
    const ms = this._moveWaitMs()
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        if (!this._destroyed) this.def.log('warn', t('serveur.partie-coup-sans-fin', { coup: move, ms }))
        resolve(true)
      }, ms)
      timer.unref?.()
      const done = () => { clearTimeout(timer); resolve(false) }
      result.then(done, done)
    })
  }

  /** coup qui attendait la fin du précédent coup asynchrone du même joueur (cf. _onMove) — la partie a pu être détruite entre-temps
   *  (annulée, vidée) : il ne tourne pas, comme un coup qui arriverait maintenant ; le précédent a passé limits.moveWaitMs sans se
   *  régler (`expired`) : refusé, il ne joue pas en même temps que lui */
  _playQueuedMove(client: MjsWsClient, move: string, p: unknown, expired: boolean): unknown {
    if (this._destroyed) throw new Error(t('serveur.matchmaking-partie-introuvable'))
    if (expired) throw new Error(t('serveur.partie-coup-precedent-en-cours'))
    return this._playMove(client, move, p)
  }

  /** cf. _onMove — le coup lui-même, gardes comprises */
  _playMove(client: MjsWsClient, move: string, p: unknown): unknown {
    // partie déjà terminée (fenêtre de grâce `endTtl`) — la partie reste interrogeable (resync)
    // mais plus JOUABLE : aucun coup ne mute l'état ni ne se diffuse après .end()
    if (this._ended) throw new Error(t('serveur.partie-terminee'))
    const player = this._findSeatOf(client)
    if (!player) {
      // anti-triche — message DÉDIÉ pour un spectateur CONNU (plutôt que le message
      // générique ci-dessous) : _findSeatOf ne cherche que dans `this.players`, un spectateur
      // n'y est jamais — cette garde est donc déjà, PAR CONSTRUCTION, ce qui rejette tout
      // µgame:move d'un spectateur (rien à ajouter côté autorisation, juste un message plus clair).
      if (this._spectators.has(client)) throw new Error(t('serveur.partie-spectateur-lecture-seule'))
      throw new Error(t('serveur.partie-pas-assis'))
    }
    if (this.def.phases && !(this.def.phases[this.phase ?? ''] ?? []).includes(move)) {
      throw new Error(t('serveur.partie-coup-interdit-phase', { coup: move, phase: this.phase }))
    }
    // `this.turn === null` = aucun tour encore établi (avant le 1er .next(), ex. une phase
    // d'attente/prêt-check) : personne n'est bloqué tant que .next() n'a jamais tourné une 1re
    // fois — la garde ne parle qu'une fois un VRAI tour en cours
    if (this.def.turns && this.turn !== null && this.turn !== player.id) throw new Error(t('serveur.partie-pas-votre-tour'))

    // anti-triche (détection par coup, TOUT opt-in — def.suspect/antiReplay/limits.
    // moveIntervalMs) — cf. _antiCheatGuard : s'applique UNIFORMÉMENT aux 3 branches
    // ci-dessous (lockstep compris — un ORDRE est un coup pour ces gardes génériques, cf. sa
    // propre doc), AVANT toute exécution/mise en file/ordre ; no-op quasi total si rien n'est déclaré.
    // `accept` enregistre séquence et heure du coup, une fois passés les refus qui suivent (débit, nom de coup)
    const accept = this._antiCheatGuard(player, move, p)

    // mode lockstep — AUCUNE exécution serveur : chaque µgame:move devient un ORDRE en
    // file pour le tick COURANT (cf. lockstep.ts addOrder), diffusé GROUPÉ par _broadcastTickOrders
    // au tick suivant — jamais de résultat (l'ack matchmaking.ts::handlerMove reste {ok:true,
    // result:undefined}, INCHANGÉ), jamais `this.journal` (celui-ci reste le journal COURT v1 du
    // mode authoritative, cf. commentaire de tête — le VRAI journal lockstep vit dans `this._lockstep`,
    // borné en octets, cf. son fichier). `move` n'est PAS validé contre `def.moves` — n'importe quel nom
    // devient un ordre valide (aucune whitelist demandée : chaque µgame:move reçu devient
    // un ORDRE, sous la seule condition de taille de lockstepJournal.maxOrderBytes).
    if (this.def.mode === 'lockstep') {
      if (!this._consumeToken(player)) throw new Error(t('serveur.partie-trop-de-coups'))
      // addOrder refuse un ordre trop gros (lockstepJournal.maxOrderBytes) : il passe AVANT accept(), comme les autres refus
      this._lockstep!.addOrder(player.id, move, p)
      accept()
      this._confirmSeat(player.id)
      return undefined
    }

    // le jeton anti-abus se consomme AVANT toute résolution du nom de coup (intent ou classique) —
    // sinon un spam de noms INEXISTANTS n'entame jamais le seau (contournement du quota)
    if (!this._consumeToken(player)) throw new Error(t('serveur.partie-trop-de-coups'))

    // mode action (def.intents, MÊME canal µgame:move que les coups classiques) — MISE EN FILE,
    // JAMAIS exécutée ici : la DERNIÈRE valeur gagne par nom (un spam de 'bouger' ne garde que la
    // dernière direction) ; appliquée par la boucle au tick suivant
    // (_applyIntents) — ni journal (débit trop élevé pour les 200 entrées bornées, cf.
    // commentaire de tête du fichier) ni _markDirty (l'état n'a pas encore changé).
    // Object.hasOwn (propriété PROPRE uniquement) — `def.intents`/`def.moves` sont des objets
    // LITTÉRAUX (prototype Object.prototype) : un `[move]` en lecture directe laisserait un nom
    // HÉRITÉ ('toString', 'valueOf'…) passer pour une intention/un coup déclaré, sans qu'AUCUN
    // gestionnaire ne soit réellement enregistré sous ce nom.
    const intentFn = Object.hasOwn(this.def.intents, move) ? this.def.intents[move] : undefined
    if (intentFn) {
      accept()
      this._confirmSeat(player.id)
      let queue = this._intentQueue.get(player.id)
      if (!queue) { queue = new Map(); this._intentQueue.set(player.id, queue) }
      queue.set(move, p)
      return undefined
    }

    const fn = Object.hasOwn(this.def.moves, move) ? this.def.moves[move] : undefined
    if (!fn) throw new Error(t('serveur.partie-coup-inconnu', { coup: move }))
    accept()
    this._confirmSeat(player.id)
    const result = fn(this, player, p)
    // coup ASYNCHRONE — `fn` peut renvoyer une Promise dont la RÉSOLUTION mute `state` (ex. un
    // appel réseau/BDD avant d'appliquer le coup) : le _markDirty() ci-dessous diffuse l'état
    // D'AVANT tout de suite (avant que la Promise ne se résolve) — sans un 2e _markDirty() À LA
    // RÉSOLUTION, aucune trame ne reflète JAMAIS le nouvel état pour ce coup. Chaîne SÉPARÉE de
    // `result` (jamais `.then()` en remplacement) : la valeur renvoyée à l'appelant (cf.
    // matchmaking.ts::handlerMove, qui `await`) reste EXACTEMENT celle de `fn`, inchangée.
    // Un REJET aussi : le coup a pu modifier l'état avant d'échouer (débit puis paiement refusé) — rien n'est annulé, l'état
    // réel du serveur est rediffusé et sauvegardé, comme après une minuterie de l'appli (cf. _guardTimerCall)
    if (result && typeof (result as any).then === 'function') {
      (result as Promise<unknown>).then(() => this._markDirty(), () => this._markDirty())
    }
    // sans la charge `p` (jusqu'à 64 Ko par coup, 200 coups gardés) : rien ne la relit, la sauvegarde ne la garde pas non plus
    this.journal.push({ move, player: player.id, at: Date.now() })
    if (this.journal.length > JOURNAL_MAX) this.journal.shift()
    this._markDirty()
    return result
  }

  /** µgame:hash (mode lockstep ; anti-triche) — reçoit un hash d'état
   *  PÉRIODIQUE d'un joueur pour `tick` (cf. lockstep.ts receiveHash pour le modèle quorum +
   *  auto-contradiction + fenêtre) — SILENCIEUX en fonctionnement normal (hashs concordants, ou
   *  quorum pas encore atteint) ; une divergence identifiée (auto-contradiction OU minorité face au
   *  hash majoritaire, JAMAIS la majorité elle-même) → µgame:event 'divergence' à TOUS +
   *  def.onDivergence (le jeu décide). `seated` = identités de TOUS les sièges OCCUPÉS de cette
   *  partie, connectés ou non (MÊME politique que le tour par tour roundrobin, cf. commentaire de
   *  tête) — relu à CET appel (jamais figé) : seuls leurs hash comptent, la majorité absolue se prend sur leur nombre (le hash
   *  d'un joueur parti est oublié, cf. lockstep.ts « QUORUM »).
   *  Anti-abus dédié AVANT tout traitement (_consumeHashToken, cf. HASH_LIMIT) : au-delà du
   *  budget, le rapport est silencieusement ignoré (comme toute autre garde ICI). No-op si
   *  non-lockstep/joueur inconnu — jamais un throw : trame reçue via app.on (fire-and-forget, cf.
   *  matchmaking.ts::handlerHash), aucun ack possible de toute façon. */
  _receiveHash(client: MjsWsClient, tick: number, h: string): void {
    // même garde que _onMove — une partie terminée ne mute ni ne diffuse plus rien,
    // fire-and-forget : on ignore silencieusement plutôt que throw (aucun ack possible ici)
    if (this._ended) return
    if (this.def.mode !== 'lockstep' || !this._lockstep) return
    const player = this._findSeatOf(client)
    if (!player) return
    if (!this._consumeHashToken(player)) return
    const seated: string[] = []
    for (const j of this.players) if (j) seated.push(j.id)
    const divergence = this._lockstep.receiveHash(player.id, tick, h, seated)
    if (!divergence) return
    this.send('divergence', divergence)
    this.def.onDivergence?.(this, divergence)
  }

  /** µgame:snapshot (mode lockstep, def.lockstepJournal.snapshotEvery) — un siège propose l'état de sa simulation à la fin de `tick`
   *  et celui du générateur partagé ; lockstep.ts ne le garde que quand au moins deux joueurs assis et la majorité absolue des joueurs
   *  assis (connectés ou non, comme _receiveHash) proposent le même, en ne comptant que les votes des joueurs assis à ce décompte (cf. son
   *  « INSTANTANÉS »). Gardé, il coupe le journal : la partie est marquée à sauvegarder. Un client qui ne sait pas lire les instantanés
   *  n'en propose jamais, et repartirait au resync de son état initial sans les ordres retirés : tant qu'une connexion assise n'a jamais
   *  proposé d'instantané (cf. _snapshotReaders), l'accord est retenu et le journal reste entier. Mêmes gardes silencieuses que
   *  _receiveHash — partie finie, joueur inconnu, seau à jetons (le sien, à la cadence du jeu, cf. _consumeSnapshotToken) : trame reçue
   *  via app.on, sans réponse possible */
  _receiveSnapshot(client: MjsWsClient, tick: number, state: unknown, rng: number): void {
    if (this._ended || this.def.mode !== 'lockstep' || !this._lockstep) return
    const player = this._findSeatOf(client)
    if (!player) return
    this._snapshotReaders.add(client)
    if (!this._consumeSnapshotToken(player)) return
    const seated: string[] = []
    let hold = false
    for (const j of this.players) {
      if (!j) continue
      seated.push(j.id)
      for (const c of j.clients) if (!this._snapshotReaders.has(c)) hold = true
    }
    if (this._lockstep.receiveSnapshot(player.id, tick, state, rng, seated, hold)) this._markTick(true)
  }

  /** ouvre la fenêtre de confirmation seatTtl (parties issues de la file, cf. matchmaking.ts) —
   *  `unconfirmedIds` = sièges qui n'ont pas eux-mêmes déclenché la complétion du groupe. Rien pour une partie déjà finie (pendant
   *  l'appariement) : une partie finie n'est jamais annulée. */
  _armConfirmWindow(unconfirmedIds: string[], ms: number): void {
    if (unconfirmedIds.length === 0 || this._ended) return
    this._unconfirmedSeats = new Set(unconfirmedIds)
    this._armByName('µmatch', ms)
  }

  /** un siège « arrive » (coup, resync — cf. leurs appelants ci-dessus) : sort de la fenêtre de confirmation */
  _confirmSeat(id: string): void {
    if (!this._unconfirmedSeats) return
    this._unconfirmedSeats.delete(id)
    if (this._unconfirmedSeats.size === 0) { this._disarm('µmatch'); this._unconfirmedSeats = null }
  }

  /** force la destruction (timers coupés) — appelée par les échéances internes, par matchmaking.ts (appariement défait) ET à
   *  l'arrêt du serveur (app.stop(), `stopping`) pour ne laisser AUCUN setTimeout survivre. hooks.onDestroy part ensuite, une
   *  seule fois, la partie déjà retirée du registre — jamais à l'arrêt du serveur, qui laisse la partie sauvegardée revivre au
   *  redémarrage. Code JEU sans requête à qui répondre : un throw ou une Promise rejetée est journalisé, la destruction a eu lieu */
  _destroy(stopping = false): void {
    if (this._destroyed) return
    this._destroyed = true
    this._stopTickLoop()   // garde-fou ULTIME — inconditionnel, même si des sièges restaient connectés (cf. .end()/_checkEmpty pour les arrêts normaux)
    this.space?._clear()
    this._history?._clear()
    this._lockstep?._clear()
    for (const t of this._timers.values()) clearTimeout(t.handle)
    this._timers.clear()
    this._onDestroy(this)
    if (stopping) return
    try {
      this._followRejection('serveur.partie-ondestroy-rejete', this.def.hooks.onDestroy?.(this))
    } catch (err) {
      this.def.log('error', t('serveur.partie-ondestroy-leve', { msg: errMessage(err) }))
    }
  }

  // --- diffusion ------------------------------------------------------------------------------

  /** bas niveau : MÊME charge `p` à tous les sièges CONNECTÉS (µgame:end/left/seat/event) — rien ne part d'une partie muette (`_silent`) */
  _broadcastTo(type: string, p: Record<string, unknown>): void {
    if (this._silent) return
    const frame = { game: this.id, ...p }
    for (const player of this.players) {
      if (!player) continue
      for (const client of player.clients) this.app.send(client, type, frame)
    }
  }

  /** µgame:seat — instantané léger du roster (places/connexion), séparé de µgame:state */
  _broadcastSeats(): void {
    const seats = this.players.map(j => j ? { seat: j.seat, connected: j.connected } : null)
    this._broadcastTo('µgame:seat', { seatCount: this.def.seats, seats })
  }

  /** construit la trame µgame:state POUR CETTE CONNEXION — vue complète (défaut, ou repli deltas)
   *  ou delta (def.deltas actif) ; `null` = rien à envoyer (deltas actif, NI la vue NI la méta
   *  n'ont changé depuis la dernière fois — zéro trame). Chemin non-delta byte-identique
   *  au v1 (MÊME ordre de clés) — compatibilité stricte, cf. tests/socket-game.test.ts.
   *  `_ack` (netcode) : MÉTA de trame (jamais dans `view`/`delta`, jamais dans le JEU) —
   *  posé UNIQUEMENT si CE joueur a déjà fait appliquer au moins un `_n` (cf. `_lastAppliedN` /
   *  `_extractN`) ; absent sinon, `meta` est alors un objet VIDE dont le spread ne change RIEN à la
   *  forme historique de la trame — rétro-compat totale pour un jeu qui n'utilise jamais `_n`.
   *  PAR CONNEXION (`client`), jamais par siège seul (cf. `_lastViews`/`_lastMeta`) : appelée UNE
   *  fois par connexion live du siège (cf. _broadcastToPlayers), pas une fois par siège.
   *  Garde-fou (def.view/def.view+JSON) — un throw QUELCONQUE pendant la construction (vue auteur
   *  cassée, valeur non JSON-able…) est capturé : log error + `null` (aucune trame pour CETTE
   *  connexion ce round, la partie continue) plutôt qu'un throw NU dans un setInterval/microtâche
   *  SANS requête à qui répondre — cf. _armByName pour le même principe côté minuteries. */
  _buildFrame(player: MjsServerSeat, client: MjsWsClient): Record<string, unknown> | null {
    const ack = this._lastAppliedN.get(player.id)
    const meta = ack != null ? { _ack: ack } : {}
    try {
      if (!this.def.deltas) return { game: this.id, view: this.viewFor(player), phase: this.phase, turn: this.turn, seq: this.seq, ...meta }

      const base = { game: this.id, phase: this.phase, turn: this.turn, seq: this.seq, ...meta }
      // normalisation JSON — MÊME forme que ce qui voyage réellement sur le fil (le transport
      // JSON.stringify la trame de toute façon) : clone STABLE, jamais aliasé à game.state (une vue
      // qui réutilise des objets internes mutés en place casserait le diff) ; la chaîne sert aussi de mesure de la vue (plus bas)
      const viewJson = JSON.stringify(this.viewFor(player))
      const viewNorm = JSON.parse(viewJson) as unknown
      if (!this._lastViews.has(client)) {
        this._lastViews.set(client, viewNorm)
        this._lastMeta.set(client, { phase: this.phase, turn: this.turn, ack })
        return { ...base, view: viewNorm }   // repli : 1re diffusion à CETTE connexion
      }
      const ops: MjsServerDeltaOp[] = []
      deepDiff('', this._lastViews.get(client), viewNorm, ops)
      this._lastViews.set(client, viewNorm)

      // méta seule — un changement de phase/tour/_ack SANS changement de vue doit quand même
      // partir : sinon `ops.length === 0` rendrait `null` et la méta serait perdue pour cette
      // connexion (cf. `_lastMeta`, comparaison PAR CHAMP — `seq`, lui, change à CHAQUE round,
      // jamais un signal utile ici)
      const previousMeta = this._lastMeta.get(client)
      const metaChanged = !previousMeta || previousMeta.phase !== this.phase || previousMeta.turn !== this.turn || previousMeta.ack !== ack
      if (ops.length === 0 && !metaChanged) return null   // ni vue ni méta n'ont changé POUR ELLE — aucune trame
      this._lastMeta.set(client, { phase: this.phase, turn: this.turn, ack })
      if (ops.length === 0) return { ...base }   // méta seule — la vue, elle, n'a pas bougé
      // un chemin vide ne s'écrit pas en delta (la racine change de forme, ou porte une clé à point) : vue complète
      if (ops.some(op => op.p === '')) return { ...base, view: viewNorm }

      const viewSize  = viewJson.length   // celle de la vue normalisée : la même chaîne, sans la sérialiser une 2e fois
      const deltaSize = JSON.stringify(ops).length
      if (deltaSize > viewSize * 0.6) return { ...base, view: viewNorm }   // repli : delta trop gros
      return { ...base, delta: ops }
    } catch (err) {
      this.def.log('error', t('serveur.partie-vue-leve', { msg: errMessage(err) }))
      return null
    }
  }

  /** diffuse à CHAQUE connexion (siège) SA trame (ou rien, cf. _buildFrame) — `seq` incrémenté
   *  UNE fois par APPEL (round de diffusion, pas par joueur ni par mutation brute) ; partagée par
   *  _broadcastState (microtâche, tick=0) et _broadcastTick (1×/tick, tick>0) — seule la CADENCE
   *  change. Une trame PAR CONNEXION (jamais une trame calculée UNE fois par siège puis recopiée à
   *  chaque connexion, cf. _buildFrame) : deux onglets d'un même siège ont chacun leur PROPRE
   *  baseline de delta (cf. `_lastViews`/`_lastMeta`), donc potentiellement leur propre trame. */
  _broadcastToPlayers(): void {
    this.seq++
    for (const player of this.players) {
      if (!player) continue
      for (const client of player.clients) {
        const frame = this._buildFrame(player, client)
        if (!frame) continue
        this.app.send(client, 'µgame:state', frame)
      }
    }
    this._broadcastToSpectators()
  }

  /** anti-triche — diffuse l'état à TOUS les spectateurs (vue SÛRE, cf. _spectatorView) :
   *  contrairement aux sièges (cf. _buildFrame), TOUJOURS une vue COMPLÈTE, jamais de delta —
   *  simplicité assumée (aucun `_lastViews` par spectateur : lecture seule, pas de couture
   *  predict/ack à préserver). No-op si aucun spectateur (Set vide, coût nul). Appelée depuis
   *  _broadcastToPlayers (couvre événementiel ET action) ET _broadcastTickOrders (lockstep, qui ne
   *  passe jamais par _broadcastToPlayers) — MÊME `seq` que la diffusion joueurs du round.
   *  Garde-fou (def.spectatorView, code JEU) — appelée depuis une microtâche ou la boucle de tick, sans requête à
   *  qui répondre : un throw y ferait tomber le process. Capturé : log error, trame des spectateurs ignorée pour
   *  ce round (les sièges ont déjà reçu la leur), la suite du round (sauvegarde) continue — MÊME principe que
   *  _buildFrame pour les sièges. */
  _broadcastToSpectators(): void {
    if (this._spectators.size === 0) return
    let info: { view: unknown }
    try {
      info = this._spectatorInfo()
    } catch (err) {
      this.def.log('error', t('serveur.partie-spectatorview-leve', { msg: errMessage(err) }))
      return
    }
    const frame = { game: this.id, ...info, phase: this.phase, turn: this.turn, seq: this.seq }
    for (const client of this._spectators) this.app.send(client, 'µgame:state', frame)
  }

  /** anti-triche, amélioration — relaie µgame:end/left à TOUS les spectateurs, MÊME charge `p`
   *  que celle déjà envoyée aux sièges (cf. .end()/_leave()) : contrairement à µgame:state
   *  (_broadcastToSpectators, filtrée par def.spectatorView), AUCUN filtrage supplémentaire ICI —
   *  `result`/`seat` ne sont PAS des vues à filtrer, ce sont déjà des données PUBLIQUES à TOUTE la
   *  table (`_broadcastTo` les diffuse identiquement à CHAQUE siège, aucune redaction par joueur
   *  n'existe pour elles) : les relayer telles quelles à un spectateur n'expose donc rien de plus
   *  qu'un siège ne voit déjà. Un auteur qui glisserait malgré tout une donnée sensible dans
   *  `result` (result d'un .end() n'est pas structurellement une vue, def.spectatorView ne sait pas
   *  le filtrer) reste responsable de son propre contenu, comme il l'est déjà pour les sièges.
   *  `µgame:seat` (roster), lui, N'EST PAS concerné — reste réservé aux sièges (cf. _broadcastSeats,
   *  scope volontairement inchangé). No-op si aucun spectateur (Set vide, coût nul). */
  _broadcastToSpectatorsRaw(type: string, p: Record<string, unknown>): void {
    if (this._spectators.size === 0) return
    const frame = { game: this.id, ...p }
    for (const client of this._spectators) this.app.send(client, type, frame)
  }

  /** mode événementiel (tick=0) — groupe les mutations d'une même microtâche en UNE diffusion, suivie de la sauvegarde si une des
   *  marques la voulait (cf. `_saveWanted`) */
  _broadcastState(): void {
    const save       = this._saveWanted
    this._dirty      = false
    this._saveWanted = false
    if (this._destroyed || this._silent) return   // muette : ni trame ni sauvegarde, _announce() marque la partie à nouveau
    this._broadcastToPlayers()
    if (save) this._onMutate?.(this)
  }

  /** mode action (tick>0) — UNE diffusion PAR TICK, après def.simulate (cf. _runTick) ;
   *  jamais additionnée à _broadcastState (_markDirty est un no-op tant que tick>0, cf. plus bas).
   *  Pousse aussi l'instantané d'historique (def.history, cf. history.ts) — MÊME emplacement
   *  « après simulate, 1×/tick » que la diffusion, avant elle (l'ordre entre les deux n'a pas
   *  d'importance, aucune dépendance croisée) : compensation de lag serveur, cf. game.rewind.
   *  `def.history.extract` (code JEU) est capturé — un throw n'annule QUE cet instantané
   *  d'historique (log error, tick suivant réessaiera), jamais tout le round de diffusion, jamais
   *  un throw nu dans le setInterval de la boucle de tick. */
  _broadcastTick(): void {
    if (this._destroyed) return
    if (this._history) {
      this._tickCount++
      try {
        this._history.pousser(this._tickCount, Date.now(), this.def.history!.extract(this))
      } catch (err) {
        this.def.log('error', t('serveur.partie-histo-extraire-leve', { msg: errMessage(err) }))
      }
    }
    this._broadcastToPlayers()
    this._markDirtyTick()
  }

  /** mode lockstep — clôt le tick courant (lockstep.ts : ordres accumulés + journal) et
   *  DIFFUSE la MÊME trame à TOUS les sièges connectés (µgame:orders {tick, orders}) — même frame pour
   *  tous, l'égalité d'entrée est le cœur du déterminisme (cf. commentaire de tête de lockstep.ts).
   *  TOUJOURS diffusé, MÊME sans ordre (tick vide) : le tick lui-même est l'horloge commune que les
   *  clients doivent avancer (jamais de trame sautée faute d'ordre). `seq` réutilisé
   *  comme compteur de tick (cf. commentaire de _runTick) — jamais incrémenté par
   *  _broadcastToPlayers ici (aucune vue/delta en lockstep, cf. _infoMode). */
  _broadcastTickOrders(): void {
    if (this._destroyed) return
    const group = this._lockstep!.closeTick()
    // journal plein (lockstepJournal.maxBytes) : ce tick n'est ni journalisé ni diffusé, la partie se termine — chaque
    // joueur garde l'état du dernier tick reçu, jamais un journal tronqué. hooks.onEnd tourne ici dans la boucle de tick : protégé
    if (!group) {
      this.def.log('warn', t('serveur.partie-journal-lockstep-plein', { id: this.id, max: this.def.lockstepJournal?.maxBytes }))
      this._guardTick('hooks.onEnd', () => this.end({ ended: true, reason: 'journal-full' }))
      this._markTick(true)
      return
    }
    this.seq = group.tick
    this._broadcastTo('µgame:orders', { tick: group.tick, orders: group.orders })
    this._broadcastToSpectators()
    // le journal d'ordres s'allonge d'un tick, même vide : l'horloge commune avance, la partie a changé
    this._markTick(true)
    this._markDirtyTick()
  }

  /** groupe les mutations d'une même microtâche en UNE diffusion — SUSPENDU
   *  en mode action (def.tick > 0) : la cadence de diffusion appartient alors exclusivement à la
   *  boucle de tick (_broadcastTick), jamais à une microtâche (cf. commentaire de tête du fichier) ; seule la marque de sauvegarde
   *  y est posée (cf. _markTick, `save` = changement sûr).
   *  `save` faux : diffusion seule, sans sauvegarde (minuterie de l'appli qui laisse la partie identique à sa dernière sauvegarde, cf.
   *  _markTimerDirty) — une autre marque de la même microtâche qui sauvegarde l'emporte */
  _markDirty(save = true): void {
    if (this.def.tick > 0) { this._markTick(save); return }
    if (save) this._saveWanted = true
    if (this._dirty || this._destroyed) return
    this._dirty = true
    queueMicrotask(() => this._broadcastState())
  }

  /** mode action : la partie a pu changer — `sure` : à coup sûr (coup, intention, siège, phase, tour, fin, journal d'ordres), la
   *  sauvegarde s'écrit sans comparaison ; sinon par du code dont l'effet ne se voit pas (simulate, slowTick, minuterie de l'appli), elle
   *  ne s'écrit que si la partie diffère de sa dernière sauvegarde (cf. _prepareSave). Boucle en marche, la marque attend son tick
   *  (_markDirtyTick) ; arrêtée (plus aucun siège connecté, partie finie), elle part tout de suite : une minuterie qui part alors est
   *  sauvegardée. Rien sans persistance ni sur une partie détruite ; une partie muette garde sa marque (_announce() la fait partir) */
  _markTick(sure: boolean): void {
    if (this._destroyed || !this._onMutate) return
    if (sure) this._saveSure = true
    this._tickMark = true
    if (!this._tickHandle && !this._silent) this._passTickMark(Date.now())
  }

  /** persistance en mode action, à chaque tick — passe la marque posée depuis le précédent passage (cf. _markTick), au plus une fois
   *  par TICK_PERSIST_THROTTLE_MS (throttle LOCAL, indépendant du débounce de persist.ts qui reste seul maître du LISSAGE/de
   *  l'ÉCRITURE réels) ; rien quand rien n'a tourné qui puisse changer la partie */
  _markDirtyTick(): void {
    if (!this._tickMark || this._destroyed || !this._onMutate) return
    const now = Date.now()
    if (now - this._lastPersistMark < TICK_PERSIST_THROTTLE_MS) return
    this._passTickMark(now)
  }

  /** passe la marque de sauvegarde du mode action à la persistance (cf. _markTick, _markDirtyTick, _stopTickLoop) */
  _passTickMark(now: number): void {
    this._tickMark        = false
    this._lastPersistMark = now
    this._onMutate?.(this)
  }

  /** mode action, boucle arrêtée (partie finie, plus aucun siège connecté) : le changement annoncé par game.changed() ou fait par une
   *  minuterie (cf. _markTimerDirty) part ici, aucun tick ne le porterait — aux spectateurs qui regardent encore, notamment. Une
   *  diffusion par microtâche, comme en mode événementiel (`_dirty`, dont _markDirty ne se sert pas en mode
   *  action). Rien tant que la boucle tourne (elle diffuse au tick suivant), ni en mode lockstep (aucune vue à diffuser) */
  _broadcastWithoutLoop(): void {
    if (this._tickHandle || this.def.mode === 'lockstep' || this._dirty) return
    this._dirty = true
    queueMicrotask(() => {
      this._dirty = false
      if (this._destroyed || this._silent || this._tickHandle) return
      this._broadcastToPlayers()
    })
  }

  /** aucun siège CONNECTÉ → arme la destruction après `emptyTtl` (+ coupe la boucle de tick) ; un
   *  retour désarme ET (re)démarre la boucle (mode action) — couvre aussi bien un 1er siège frais
   *  (cf. _createSeat) qu'un resync après coupure (cf. _reattachSeat).
   *  Garde `_ended` EN PREMIER — une partie FINIE ne doit jamais voir son compte à rebours de
   *  fermeture (`µempty`, armé par .end() à `endTtl`) annulé ou réarmé à `emptyTtl`, ni sa boucle de tick relancée : un resync d'un
   *  siège encore connecté au moment du .end() (ou qui se reconnecte pendant la grâce) appelle
   *  _reattachSeat → _checkEmpty comme n'importe quel resync normal — sans cette garde, il
   *  ranimerait une partie censée n'être plus qu'interrogeable (cf. .end()/_ended). */
  _checkEmpty(): void {
    if (this._ended) return
    if (this.players.some(j => j && j.connected)) { this._disarm('µempty'); this._startTickLoop(); return }
    this._armByName('µempty', this.def.emptyTtl)
    this._stopTickLoop()
  }

  /** un siège vient de partir (µgame:leave, déconnexion, entrée refusée) : une partie qui n'a plus aucun siège connecté est fermée
   *  tout de suite quand personne n'a à y revenir — une table jamais complète (`_started` faux), ou une partie dont plus aucun siège
   *  n'est occupé (tous partis ou refusés : aucun µgame:resync ne la retrouverait). Sans cela, ces tables vides vivaient `emptyTtl` :
   *  des refus de hooks.onJoin ou une page rechargée remplissaient la borne des parties privées de leur créateur, et une connexion qui
   *  enchaînait µgame:play/leave dans la file publique gardait autant de parties qu'elle en demandait. Sinon, cf. _checkEmpty :
   *  `emptyTtl` garde une partie commencée pour le retour de ses joueurs déconnectés. Une partie finie garde sa grâce `endTtl` ; une
   *  partie muette (appariement de la file en cours) est laissée à matchmaking.ts, qui la défait lui-même */
  _afterDeparture(): void {
    const abandoned = !this._ended && !this._silent && !this.players.some(j => j && j.connected) && (!this._started || this.players.every(j => j === null))
    if (abandoned) this._closeAbandoned()
    else this._checkEmpty()
  }

  // --- mode action — boucle de tick (def.tick Hz) + slowTick (def.slowTick) -------------------

  /** démarre la boucle — no-op si déjà tournante/tick=0/partie détruite/partie TERMINÉE (cf.
   *  `_ended` — même raison que _checkEmpty juste au-dessus, filet redondant si un futur appel
   *  direct contournait _checkEmpty)/partie MUETTE (cf. `_silent` : _announce() la démarre) — cf.
   *  _checkEmpty, .end(), ._destroy() pour les points d'arrêt : AUCUN setInterval ne doit jamais rester résiduel */
  _startTickLoop(): void {
    if (this.def.tick <= 0 || this._tickHandle || this._destroyed || this._ended || this._silent) return
    const period = 1000 / this.def.tick
    this._lastTick = Date.now()
    this._tickHandle = setInterval(() => this._runTick(), period)
    if (this.def.slowTick) {
      const slowPeriod = 1000 / this.def.slowTick.hz
      this._slowTickHandle = setInterval(() => {
        if (this._destroyed) return
        // la suite d'une Promise rendue change encore la partie à sa fin : marquée comme le début, diffusée si la boucle s'est arrêtée
        this._guardTick('slowTick', () => this.def.slowTick!.fn(this), () => { this._markTick(false); this._broadcastWithoutLoop() })
        this._markTick(false)
      }, slowPeriod)
    }
  }

  /** arrêt du serveur (persist.ts, avant la rafale finale) : la marque de sauvegarde que la boucle retenait (une passe au plus par
   *  TICK_PERSIST_THROTTLE_MS) part tout de suite — sinon le dernier changement de la partie manquait à la sauvegarde, et au
   *  redémarrage. Mode événementiel, la sauvegarde que la diffusion groupée attend (cf. `_saveWanted`) aussi : un coup, une minuterie
   *  ou game.changed() juste avant app.stop(), dans le même tour, la faisait partir après la rafale finale, quand la persistance ne
   *  programme plus rien ; la diffusion reste celle de la microtâche. Rien sans marque, ni sur une partie détruite ou muette */
  _releaseMark(): void {
    if (this._destroyed || this._silent) return
    if (this.def.tick <= 0) {
      if (this._saveWanted) { this._saveWanted = false; this._onMutate?.(this) }
      return
    }
    if (this._tickMark) this._passTickMark(Date.now())
  }

  /** arrête la boucle — la marque de sauvegarde qui attendait son tick part tout de suite (départ du dernier siège connecté, fin de
   *  la partie, ce que le dernier tick a changé) ; rien sur une partie détruite ou muette */
  _stopTickLoop(): void {
    if (this._tickHandle) { clearInterval(this._tickHandle); this._tickHandle = null }
    if (this._slowTickHandle) { clearInterval(this._slowTickHandle); this._slowTickHandle = null }
    if (this._tickMark && !this._destroyed && !this._silent) this._passTickMark(Date.now())
  }

  /** garde-fou boucle de tick — capture SYNC (throw) et ASYNC (rejet) du seul code
   *  JEU appelé nu dans le setInterval (def.intents/def.simulate/def.slowTick.fn) : sans elle, une
   *  exception y est invisible (diffusion broadcast, aucun client à qui répondre). Log seul, AUCUN
   *  changement de gameplay. NE PAS l'étendre au code interne du framework (_broadcastTick,
   *  _broadcastTickOrders, _applyIntents elle-même) — un throw là est un bug framework à
   *  laisser remonter, pas à masquer. `settled` : appelé à la fin d'une Promise rendue, qu'elle aboutisse ou rejette (une intention,
   *  simulate ou slowTick asynchrone marque alors la partie, cf. _applyIntents, _runTick, _startTickLoop) */
  _guardTick(what: string, fn: () => unknown, settled?: () => void): void {
    try {
      const r = fn()
      if (r && typeof (r as any).then === 'function') {
        const pending = (r as Promise<unknown>).catch((err: unknown) => this.def.log('error', t('serveur.partie-tick-rejete', { quoi: what, msg: errMessage(err) })))
        if (settled) void pending.then(settled)
      }
    } catch (err) {
      this.def.log('error', t('serveur.partie-tick-leve', { quoi: what, msg: errMessage(err) }))
    }
  }

  /** intentions en file → def.simulate → UNE diffusion. `dt` = écart RÉEL mesuré depuis le tick
   *  précédent (Date.now(), jamais la période nominale figée) — correction de dérive SIMPLE : le
   *  `setInterval` peut driver légèrement, la simulation reçoit quand même le temps VRAIMENT écoulé.
   *  Mode lockstep : AUCUNE intention/simulation serveur (interdites, cf. game-def.ts) —
   *  clôture du tick d'ordres SEULE (_broadcastTickOrders), cf. commentaire de tête du fichier. */
  _runTick(): void {
    if (this._destroyed) return
    const now = Date.now()
    const dt = now - this._lastTick
    this._lastTick = now
    if (this.def.mode === 'lockstep') { this._broadcastTickOrders(); return }
    this._applyIntents()
    // une intention a terminé la partie : plus de simulation (elle modifiait l'état final), l'état final part encore
    if (this._ended) { this._broadcastTick(); return }
    if (this.def.simulate) {
      // son effet ne se voit pas : la sauvegarde se compare à la dernière au moment d'écrire (cf. _prepareSave) — la suite d'une Promise
      // rendue aussi, à sa fin, et elle est diffusée si la boucle s'est arrêtée entre-temps (aucun tick ne la porterait)
      this._guardTick('simulate', () => this.def.simulate!(this, dt), () => { this._markTick(false); this._broadcastWithoutLoop() })
      this._markTick(false)
    }
    this._broadcastTick()
  }

  /** applique la file accumulée depuis le tick précédent — ordre des SIÈGES (arrivée), PAS l'ordre
   *  de réception réseau ; la file est vidée après coup (nouvelle fenêtre pour le tick suivant).
   *  Couture _ack (netcode) : `_extractN` détache un `_n` numérique éventuel AVANT
   *  l'appel à `fn` — le jeu reçoit un payload STRICTEMENT identique à ce qu'il recevrait sans la
   *  couture, aucune fuite de méta-donnée protocole dans `def.intents`.
   *  Une intention qui termine la partie (.end()) arrête la file : celles qui suivent dans ce tick ne tournent pas (le score de
   *  l'autre joueur était compté après la victoire). Une intention qui rend une Promise change encore l'état à sa fin : une 2e marque,
   *  sûre comme la première, la fait sauvegarder (elle était diffusée au tick suivant, jamais écrite) ; boucle arrêtée entre-temps,
   *  aucun tick ne la porterait : elle est diffusée aussi (cf. _broadcastWithoutLoop) */
  _applyIntents(): void {
    if (this._intentQueue.size === 0) return
    for (const player of this.players) {
      if (this._ended) break
      if (!player) continue
      const queue = this._intentQueue.get(player.id)
      if (!queue) continue
      for (const [name, p] of queue) {
        if (this._ended) break
        const fn = this.def.intents[name]
        if (fn) this._guardTick('intent:'+ name, () => fn(this, player, this._extractN(player.id, p)), () => { this._markTick(true); this._broadcastWithoutLoop() })
      }
    }
    this._intentQueue.clear()
    // des coups de joueurs ont tourné (leur numéro de séquence part aussi avec la sauvegarde) : changement sûr
    this._markTick(true)
  }

  /** détache `_n` (numéro d'ordre CLIENT optionnel, cf. commentaire de `_lastAppliedN`) d'un
   *  payload d'intention — `p` inchangé si absent/non-numérique (rétro-compat totale). Avance
   *  `_lastAppliedN[playerId]` au PLUS GRAND `_n` vu (jamais en arrière — l'ordre des sièges
   *  n'est pas forcément l'ordre d'émission), renvoie un CLONE superficiel de `p` sans `_n`. */
  _extractN(playerId: string, p: unknown): unknown {
    if (!p || typeof p !== 'object' || !('_n' in (p as object))) return p
    const { _n, ...reste } = p as Record<string, unknown>
    if (typeof _n === 'number') {
      const last = this._lastAppliedN.get(playerId)
      if (last == null || _n > last) this._lastAppliedN.set(playerId, _n)
    }
    return reste
  }

  /** annulation (`seat-expired`, `replaced`) : la même fin part aux sièges et aux spectateurs (cf. _broadcastToSpectatorsRaw) */
  _cancel(reason: string): void {
    const result = { cancelled: true, reason }
    this._broadcastTo('µgame:end', { result })
    this._broadcastToSpectatorsRaw('µgame:end', { result })
    this._destroy()
  }

  /** fermeture d'une partie que ses joueurs ont laissée (cf. _afterDeparture, grâce `µempty` échue) : une partie NON finie prévient
   *  d'abord ses spectateurs, dont la vue restait sinon figée (µgame:end { cancelled: true, reason: 'abandoned' }) — aucun siège n'a
   *  plus de connexion. Une partie finie les a déjà prévenus à .end() ; l'arrêt du serveur (_destroy direct) ne dit rien, la partie
   *  sauvegardée revit au redémarrage */
  _closeAbandoned(): void {
    if (!this._ended && !this._destroyed) this._broadcastToSpectatorsRaw('µgame:end', { result: { cancelled: true, reason: 'abandoned' } })
    this._destroy()
  }

  // --- minuteries — {name, at} sérialisable, jamais de fermeture stockée (cf. .timer() public) ---

  /** réservée (µturn/µmatch/µempty) → code FRAMEWORK, laissé remonter tel quel (un throw ici est
   *  un bug interne, pas à masquer) — SAUF le code JEU que l'échéance de µturn appelle (hooks.onTurnTimeout,
   *  turns.order), gardé dans _onTurnExpired ; APPLICATIVE (def.timers) → code JEU, protégé (cf.
   *  _guardApplicativeTimer) : un `setTimeout` nu n'a AUCUNE requête à qui répondre, un throw non
   *  capturé y ferait planter le PROCESS entier. */
  _armByName(name: string, ms: number): void {
    if (this._destroyed) return   // partie détruite : plus aucune minuterie, ni du framework ni de l'appli (un crochet asynchrone peut rendre la main après la destruction)
    const reserved = RESERVED_TIMER_NAMES.has(name)
    if (this._ended && !reserved) return   // partie finie : le code de l'appli ne tourne plus (ni .timer(), ni onEnd, ni la minuterie nommée d'une sauvegarde restaurée)
    const onExpire = reserved
      ? () => this._onReservedTimer(name)
      : () => this._guardApplicativeTimer(name)
    this._arm(name, ms, onExpire)
  }

  /** minuterie APPLICATIVE (def.timers[name], cf. _armByName) — appel gardé par _guardTimerCall, qui ne sauvegarde la partie que si
   *  elle diffère de sa dernière sauvegarde (cf. _markTimerDirty) ; un nom non déclaré (sauvegarde d'une version antérieure de
   *  l'appli, nom hérité d'Object.prototype) ne lance rien */
  _guardApplicativeTimer(name: string): void {
    const fn = Object.hasOwn(this.def.timers, name) ? this.def.timers[name] : undefined
    if (!fn) return
    this._guardTimerCall(name, () => fn(this), TIMER_CALL_KEYS, true)
  }

  /** garde-fou d'un appel de code JEU fait par une minuterie (def.timers[name], hooks.onTurnTimeout, passage de tour
   *  automatique) — capture SYNC (throw) ET ASYNC (rejet, si l'auteur renvoie malgré tout une Promise) : log error par
   *  le canal déjà utilisé par le serveur (def.log), AUCUN changement de gameplay — même esprit que _guardTick pour la
   *  boucle de tick, adapté à un appel HORS tick (arme/réarme n'importe quand). `keys` choisit le message du journal selon
   *  l'appel (une minuterie applicative par défaut, `name` la nomme ; les crochets et le passage de tour ont le leur).
   *  `changesOnly` (minuteries de l'appli, def.timers) : l'état est rediffusé (une vue peut dépendre d'autre chose que de l'état),
   *  mais la partie n'est sauvegardée que si elle diffère de sa dernière sauvegarde (cf. _markTimerDirty) — une veille récurrente
   *  qui ne change rien faisait écrire le stockage de l'appli à chacune de ses échéances. Sans lui (hooks.onTurnTimeout, passage de
   *  tour automatique), chaque appel sauvegarde, comme un coup. */
  _guardTimerCall(name: string, call: () => unknown, keys: TimerCallKeys = TIMER_CALL_KEYS, changesOnly = false): void {
    try {
      // `call` est typé `() => unknown` : def.timers et les hooks sont typés `=> void`, un auteur peut malgré tout
      // renvoyer une Promise À L'EXÉCUTION (le type ne l'empêche pas) — MÊME idiome que _guardTick
      // (fn: () => unknown) pour la boucle de tick, de quoi la détecter.
      const r = call()
      if (r && typeof (r as any).then === 'function') {
        // l'état change aussi après l'attente (même si elle est rejetée, la minuterie a pu le modifier avant) : une 2e marque à la fin,
        // comparée elle aussi à la dernière sauvegarde (changesOnly) — un coup ou une autre minuterie a pu changer l'état pendant
        // l'attente, et la suite le remettre à la valeur d'avant
        const pending = r as Promise<unknown>
        pending.catch((err: unknown) => this.def.log('error', t(keys.rejected ?? keys.thrown, { nom: name, msg: errMessage(err) }))).then(() => this._markTimerDirty(changesOnly))
      }
    } catch (err) {
      this.def.log('error', t(keys.thrown, { nom: name, msg: errMessage(err) }))
    }
    // l'état a pu changer (même si la minuterie a levé après l'avoir modifié) : diffusion, et sauvegarde comme après un coup (changesOnly :
    // si la partie diffère de sa dernière sauvegarde)
    this._markTimerDirty(changesOnly)
  }

  /** marque de diffusion d'un appel gardé par _guardTimerCall — `changesOnly` faux : sauvegarde, comme après un coup ; vrai (minuteries
   *  de l'appli) : la sauvegarde n'est demandée que si l'empreinte de la partie diffère de celle de sa dernière sauvegarde
   *  (`_lastSavePrint`). Une empreinte par appel, et seulement quand elle sert : sans persistance (`_onMutate` absent), rien à
   *  sauvegarder ; en mode action, aucune au tir : la marque de sauvegarde (cf. _markTick, qui la passe tout de suite quand la boucle
   *  est arrêtée) se compare à la dernière sauvegarde au moment d'écrire (cf. _prepareSave), et la diffusion est celle de la boucle —
   *  arrêtée, celle de _broadcastWithoutLoop, sans quoi les spectateurs ne voyaient pas le changement */
  _markTimerDirty(changesOnly: boolean): void {
    if (this.def.tick > 0) { this._markTick(!changesOnly); this._broadcastWithoutLoop(); return }
    if (!changesOnly || this._destroyed || !this._onMutate) { this._markDirty(); return }
    const print = this._savedPrint()
    this._markDirty(print === null || print !== this._lastSavePrint)
  }

  /** empreinte de ce que la sauvegarde porte et que le code de l'appli peut changer — état, phase, tour, sièges, fin et résultat, et
   *  la PRÉSENCE des minuteries (leurs noms, triés) : une minuterie partie sans être réarmée, ou une minuterie neuve, la change (la
   *  sauvegarde garderait sinon une minuterie déjà partie, qui repartirait au redémarrage) ; une minuterie réarmée sous le même nom
   *  ne la change pas, seule son échéance a bougé (la sauvegarde suivante la portera ; après un redémarrage, l'échéance sauvegardée,
   *  déjà passée, part tout de suite, une fois). `null` quand JSON ne sait pas l'écrire (objet circulaire, BigInt…) */
  _savedPrint(): string | null {
    try {
      return JSON.stringify([this.state, this.phase, this.turn, this.players.map(j => j && j.id), this._ended, this._endResult, Array.from(this._timers.keys()).sort()])
    } catch {
      return null
    }
  }

  /** persist.ts vient de sérialiser la partie pour l'écrire (cf. runSave) : rend l'empreinte de ce qui part (`print`, cf. _savedPrint —
   *  retenue par persist.ts jusqu'à la fin de l'écriture, cf. _noteSaved) et si l'écriture est utile (`useful`) : faux en mode action
   *  quand rien n'a changé à coup sûr depuis la dernière sauvegarde (cf. `_saveSure`) et que la partie est identique à la dernière
   *  sauvegarde réussie — persist.ts ne l'écrit pas si le stockage porte bien celle-ci. Empreinte calculée seulement quand elle peut
   *  servir — `def.timers` non vide, ou, en mode action, simulate ou slowTick déclarés —, sinon inconnue (`null`) */
  _prepareSave(): { print: string | null; useful: boolean } {
    const action = this.def.tick > 0
    const sure   = !action || this._saveSure
    const hidden = Object.keys(this.def.timers).length > 0 || (action && !!(this.def.simulate || this.def.slowTick))
    const print  = hidden ? this._savedPrint() : null
    this._saveSure = false
    return { print, useful: sure || print === null || print !== this._lastSavePrint }
  }

  /** l'écriture qui portait `print` (cf. _prepareSave) a abouti, la plus récente à aboutir : son empreinte devient celle de la dernière
   *  sauvegarde, à laquelle se comparent le tir d'une minuterie de l'appli (mode événementiel, cf. _markTimerDirty) et la sauvegarde
   *  suivante (mode action). Une écriture refusée ou restée sans réponse ne la change pas : persist.ts la refait */
  _noteSaved(print: string | null): void {
    this._lastSavePrint = print
  }

  /** une Promise rendue par du code JEU que personne n'attend (crochet async : onJoin, onLeave, onEnd, onCreate) : son rejet est
   *  journalisé avec le message `key` (un par crochet), jamais un rejet non géré qui ferait tomber le processus ; `onRejected`
   *  tourne ensuite (onJoin : le refus du siège, cf. _refuseSeat) ; aucune marque de diffusion à la fin de l'attente (la Promise
   *  n'est pas attendue par l'appelant). Rend `null` quand le crochet n'a rendu aucune Promise, sinon une Promise qui dit comment
   *  il a fini : `true` s'il a abouti, `false` s'il a rejeté (rejet déjà journalisé, `onRejected` déjà passé) — seul l'appariement
   *  de la file l'attend (cf. _createSeat), les autres appelants l'ignorent */
  _followRejection(key: MsgKey, r: unknown, onRejected?: () => void): Promise<boolean> | null {
    if (!(r && typeof (r as any).then === 'function')) return null
    return Promise.resolve(r as PromiseLike<unknown>).then(() => true, (err: unknown) => {
      this.def.log('error', t(key, { msg: errMessage(err) }))
      onRejected?.()
      return false
    })
  }

  /** arme (ou réarme) la minuterie `name` à `ms` ms d'ici. Une durée au-delà de MAX_TIMEOUT_MS (24,8 jours) est attendue
   *  PAR TRANCHES : à chaque tranche le reste se recalcule sur l'échéance `at` (la même que celle sauvegardée par serialize()),
   *  et l'entrée garde toujours la poignée de la tranche EN COURS (désarmement, réarmement et destruction la coupent).
   *  `Infinity` = attente sans fin : l'échéance est bornée à Number.MAX_SAFE_INTEGER pour rester un nombre sérialisable en JSON.
   *  Une durée qui n'est pas un nombre (NaN, absente d'une définition construite à la main) donne une échéance immédiate, mais
   *  toujours un nombre : un `NaN` sauvegardé devient `null` en JSON et la sauvegarde entière ne se restaure plus. */
  _arm(name: string, ms: number, onExpire: () => void): void {
    const existing = this._timers.get(name)
    if (existing) clearTimeout(existing.handle)
    const span  = Math.min(ms, Number.MAX_SAFE_INTEGER)
    const at    = Date.now() + (Number.isFinite(span) ? span : 0)
    const entry = { at, handle: undefined as unknown as ReturnType<typeof setTimeout> }
    const wait  = (left: number): void => {
      entry.handle = left > MAX_TIMEOUT_MS ? setTimeout(() => wait(at - Date.now()), MAX_TIMEOUT_MS) : setTimeout(() => { if (this._held) return; this._timers.delete(name); onExpire() }, left)
    }
    wait(ms)
    this._timers.set(name, entry)
  }

  _disarm(name: string): void {
    const existing = this._timers.get(name)
    if (existing) { clearTimeout(existing.handle); this._timers.delete(name) }
  }

  /** coupe toutes les minuteries nommées de l'appli (`.timer()`), jamais celles du framework (µturn, µmatch, µempty) */
  _disarmAppTimers(): void {
    for (const name of Array.from(this._timers.keys())) {
      if (!RESERVED_TIMER_NAMES.has(name)) this._disarm(name)
    }
  }

  _armTurnTimeout(): void {
    // partie finie : plus de tour à chronométrer (un .next() après .end() n'arme rien) ; turns.timeout null : aucune minuterie de tour
    if (this._ended || !this.def.turns || !this.def.turns.timeout) return
    this._armByName('µturn', this.def.turns.timeout)
  }

  _onReservedTimer(name: string): void {
    if (name === 'µturn') this._onTurnExpired()
    else if (name === 'µmatch') this._onMatchExpired()
    else if (name === 'µempty') this._onEmptyExpired()
  }

  /** hooks.onTurnTimeout et, sans lui, le passage de tour automatique (turns.order peut être une fonction de l'auteur) :
   *  code JEU appelé par une minuterie, gardé comme une minuterie applicative (cf. _guardTimerCall) — le crochet garde son
   *  appel en méthode de `hooks` (`this` = hooks). Sans effet sur une partie finie : .end() désarme `µturn`, mais la sauvegarde
   *  d'une version antérieure, qui ne le désarmait pas, la porte encore et la restauration la réarme. Sans effet non plus quand la
   *  définition n'arme plus de minuterie de tour (turns.timeout null, ou turns retiré) : celle d'une sauvegarde écrite avant, que la
   *  restauration réarme, ne fait rien. */
  _onTurnExpired(): void {
    if (this._ended || !this.def.turns?.timeout) return
    if (this.def.hooks.onTurnTimeout) this._guardTimerCall('hooks.onTurnTimeout', () => this.def.hooks.onTurnTimeout!(this), TURN_TIMEOUT_KEYS)
    else this._guardTimerCall('turns.order', () => this.next(), TURN_ORDER_AUTO_KEYS)
  }

  /** fin de la fenêtre de confirmation des sièges de la file : annule la partie si un siège n'a rien confirmé. Une partie FINIE
   *  n'est jamais annulée (sa grâce `endTtl` va à son terme, un seul µgame:end part) : .end() désarme `µmatch`, mais la sauvegarde
   *  d'une version antérieure, qui ne le désarmait pas, la porte encore et la restauration la réarme. */
  _onMatchExpired(): void {
    if (this._ended || !this._unconfirmedSeats || this._unconfirmedSeats.size === 0) return
    this._cancel('seat-expired')
  }

  _onEmptyExpired(): void {
    this._closeAbandoned()
  }

  // --- anti-abus (limits.moves) — seau à jetons PAR SIÈGE, TokenBucket réutilisée de mjs-ws/guard.ts ---

  _consumeToken(player: MjsServerSeat): boolean {
    const cfg = this.def.limits.moves
    if (!cfg) return true
    const [n, windowMs] = cfg
    let bucket = this._buckets[player.seat]
    if (!bucket) { bucket = new TokenBucket(n, n / (windowMs / 1000)); this._buckets[player.seat] = bucket }
    return bucket.take()
  }

  // anti-triche (µgame:hash) — seau à jetons DÉDIÉ par siège, budget FIXE HASH_LIMIT (PAS
  // de clé def.limits, cf. son commentaire) : canal INDÉPENDANT de _consumeToken (coups) —
  // spammer ses coups n'épuise jamais le budget hash, et réciproquement.
  _consumeHashToken(player: MjsServerSeat): boolean {
    const [n, windowMs] = HASH_LIMIT
    let bucket = this._bucketsHash[player.seat]
    if (!bucket) { bucket = new TokenBucket(n, n / (windowMs / 1000)); this._bucketsHash[player.seat] = bucket }
    return bucket.take()
  }

  // propositions d'instantané (µgame:snapshot) — seau DÉDIÉ par siège, canal distinct des hash : un joueur en fait au plus
  // `tick / every` par seconde (60 à 60 Hz pour une cadence de 1, deux à 20 Hz pour une cadence de 10), d'où le débit du seau ; et
  // autant d'un coup que la fenêtre de réception compte de ticks de la cadence (les ticks arrivés en rafale après un silence du
  // réseau), d'où sa réserve, plus un — 121 jetons à 60 Hz pour une cadence de 1, 5 à 20 Hz pour une cadence de 10. Sans instantanés
  // déclarés, aucune proposition ne sert : refusée d'emblée
  _consumeSnapshotToken(player: MjsServerSeat): boolean {
    const snap = this.def.lockstepSnapshot
    if (!snap) return false
    let bucket = this._bucketsSnapshot[player.seat]
    if (!bucket) { bucket = new TokenBucket(Math.ceil(snap.window / snap.every) + 1, this.def.tick / snap.every); this._bucketsSnapshot[player.seat] = bucket }
    return bucket.take()
  }

  // --- anti-triche (détection par coup, TOUT opt-in — anti-triche poussé au
  // maximum) — 3 mesures INDÉPENDANTES appelées depuis _onMove, chacune protégée par SA
  // PROPRE clé `def` : un jeu qui n'en déclare AUCUNE ne paie que 3 lectures de propriété `undefined`
  // par coup (zéro Map peuplée, zéro entrée de journal, zéro appel à def.onSuspicion) --------------

  /** garde composite — def.suspect (métier) → def.antiReplay (séquence) → def.limits.moveIntervalMs
   *  (cadence serveur), DANS CET ORDRE. Chaque sous-garde qui REJETTE journalise+compte D'ABORD
   *  (_reportSuspicion) PUIS throw — même convention que _consumeToken ci-dessus : un refus ICI
   *  redevient une ack d'erreur classique côté client (cf. commentaire de tête de _onMove),
   *  aucun canal d'erreur spécial à connaître. Ne throw JAMAIS si les 3 options sont absentes.
   *  Rend la fonction qui ENREGISTRE la séquence (antiReplay) et l'heure (moveIntervalMs) du coup : _onMove ne l'appelle qu'une fois
   *  le coup accepté (débit limits.moves, nom de coup) — sinon un coup refusé pour débit consommait son numéro, et sa reprise
   *  légitime passait pour un rejeu (refusée, comptée suspecte, remontée à def.onSuspicion). */
  _antiCheatGuard(player: MjsServerSeat, move: string, p: unknown): () => void {
    if (this.def.suspect) {
      const r = this.def.suspect(move, { seat: player.seat, game: this, type: this.type, turn: this.turn, phase: this.phase, p })
      if (r) {
        // `true` littéral (typeof !== 'object') = journalisé SEUL, JAMAIS rejeté tout seul — seule
        // la forme objet `{reject:true}` déclenche un rejet (politique par défaut EXPLICITE
        // uniquement, cf. MjsServerSuspectResult/tests : « true sans rejet → appliqué mais journalisé »)
        const reject = typeof r === 'object' && r.reject === true
        const reason  = (typeof r === 'object' && r.reason) || 'suspect'
        this._reportSuspicion(player, move, reason, reject)
        if (reject) throw new Error(t('serveur.partie-coup-rejete-suspect', { coup: move, raison: reason }))
      }
    }

    let seq: number | null = null
    if (this.def.antiReplay) {
      seq = this._extractAntiReplaySeq(p)
      // aucun _n/_s numérique attaché à CE coup → rien à vérifier, jamais un faux rejet (cf.
      // commentaire de _extractAntiReplaySeq : rétro-compat totale pour un coup qui n'en porte pas)
      if (seq != null) {
        const last = this._lastAntiReplaySeq.get(player.id)
        if (last != null && seq <= last) {
          this._reportSuspicion(player, move, 'rejeu', true)
          throw new Error(t('serveur.partie-coup-rejete-rejeu', { coup: move, seq: seq, dernier: last }))
        }
        if (last != null && seq - last > ANTIREPLAY_WINDOW) {
          this._reportSuspicion(player, move, 'rejeu-fenetre', true)
          throw new Error(t('serveur.partie-coup-rejete-sequence-avance', { coup: move, seq: seq, dernier: last }))
        }
      }
    }

    let now: number | null = null
    if (this.def.limits.moveIntervalMs) {
      now = Date.now()
      const last = this._lastMoveAt.get(player.id)
      if (last != null && now - last < this.def.limits.moveIntervalMs) {
        this._reportSuspicion(player, move, 'rate', true)
        throw new Error(t('serveur.partie-coup-rejete-cadence', { coup: move }))
      }
    }

    // anti-triche (opt-in, anti-triche poussé au maximum) — quota de coups PAR
    // IDENTITÉ agrégé sur TOUTES les parties vivantes de l'app (cf. MjsServerAntiCheatOptions.
    // movesPerIdentity, index.ts) : borne un bot qui farme plusieurs parties EN PARALLÈLE, aveugle
    // à limits.moves/moveIntervalMs ci-dessus (PAR SIÈGE, PAR PARTIE). `_identityQuota` est un
    // simple PONT vers le registre RÉEL (Map identité→TokenBucket), tenu ENTIÈREMENT par
    // matchmaking.ts (seul point qui voit toutes les parties vivantes, cf. son commentaire) — posé
    // APRÈS construction, MÊME patron que `_gameStats` (cf. matchmaking.ts::create()) ; `null` =
    // option absente, AUCUN contrôle (défaut). Réutilise _reportSuspicion (journal + _gameStats +
    // def.onSuspicion) — MÊME infrastructure que les 3 gardes ci-dessus, rien de dupliqué.
    if (this._identityQuota && !this._identityQuota(player.id)) {
      this._reportSuspicion(player, move, 'quota-identite', true)
      throw new Error(t('serveur.partie-coup-rejete-quota-identite', { coup: move }))
    }

    return () => {
      if (seq != null) this._lastAntiReplaySeq.set(player.id, seq)
      if (now != null) this._lastMoveAt.set(player.id, now)
    }
  }

  /** lit un numéro de séquence CLIENT depuis `p` pour def.antiReplay — réutilise `_n` s'il est
   *  présent (MÊME champ que µ.predict, cf. _extractN/_lastAppliedN un peu plus haut) SANS le
   *  consommer ni y toucher : simple LECTURE, la réconciliation predict (_ack) continue EXACTEMENT
   *  comme avant, cette méthode ne mute jamais `p` ni `_lastAppliedN`. Sinon replie sur `_s`, un
   *  champ DÉDIÉ pour les coups qui n'utilisent pas predict (classique/lockstep). `null` si aucun
   *  des deux n'est un nombre — l'anti-rejeu ne bloque alors RIEN pour ce coup précis. */
  _extractAntiReplaySeq(p: unknown): number | null {
    if (!p || typeof p !== 'object') return null
    const obj = p as Record<string, unknown>
    if (typeof obj._n === 'number') return obj._n
    if (typeof obj._s === 'number') return obj._s
    return null
  }

  /** journalise + compte un événement anti-triche (anneau borné JOURNAL_ANTITRICHE_MAX,
   *  compteurs `_gameStats` cf. index.ts, hook def.onSuspicion) — appelée UNIQUEMENT par les 3 gardes
   *  de _antiCheatGuard ci-dessus. */
  _reportSuspicion(player: MjsServerSeat, type: string, reason: string, rejected: boolean): void {
    const event: MjsServerSuspicionEvent = { time: Date.now(), seat: player.seat, type, reason, rejected }
    this._antiCheatLogBuf.push(event)
    if (this._antiCheatLogBuf.length > ANTICHEAT_LOG_MAX) this._antiCheatLogBuf.shift()
    if (this._gameStats) {
      this._gameStats.suspectMoves++
      if (rejected) this._gameStats.rejectedMoves++
    }
    this.def.onSuspicion?.(event)
  }

  /** lecture du journal anti-triche (cf. _reportSuspicion) — exposée pour les tests et l'appli
   *  hôte (bannir/logguer sur historique, au-delà du hook temps réel def.onSuspicion) ; COPIE
   *  défensive (jamais l'anneau interne, MÊME politique que .serialize()/journal.slice()). */
  _antiCheatLog(): MjsServerSuspicionEvent[] {
    return this._antiCheatLogBuf.slice()
  }

  // --- tour par tour (turns.order 'roundrobin') ------------------------------------------------

  /** ordre = celui des SIÈGES occupés (index croissant), connectés ou non — cf. commentaire de tête. Détenteur du tour qui n'est
   *  plus assis : le siège occupé qui suit `fromSeat` (celui qu'il vient de quitter, en bouclant), à défaut le premier */
  _nextRoundrobin(fromSeat: number | null = null): MjsServerSeat | null {
    const seats = this.players.filter((j): j is MjsServerSeat => j !== null)
    if (seats.length === 0) return null
    const currentIdx = seats.findIndex(j => j.id === this.turn)
    if (currentIdx === -1) return fromSeat === null ? seats[0] : (seats.find(j => j.seat > fromSeat) ?? seats[0])
    return seats[(currentIdx + 1) % seats.length]
  }
}

/** valide la FORME minimale d'un instantané avant restauration (cf. restoreGame) — un fichier
 *  corrompu/tronqué/d'un format inconnu ne doit JAMAIS produire une partie À MOITIÉ construite
 *  (état incohérent, pire qu'une absence de restauration) : throw AVANT tout `new Game()`, capté
 *  par le try/catch PAR ENTRÉE de persist.ts::loadAtBoot (une seule partie orpheline n'empêche
 *  jamais le boot des autres, cf. son commentaire — aucun besoin de recapturer ici). Ne valide PAS
 *  le CONTENU métier (state/journal libres, propre à chaque def.state) — seulement la forme
 *  STRUCTURELLE que ce fichier lit directement (.slice()/.map()/for…of un peu plus bas), sinon
 *  c'est une TypeError bien plus cryptique qui surviendrait à leur place. */
function validateSnapshot(data: MjsServerGameSnapshot): void {
  if (!data || typeof data !== 'object') throw new Error(t('serveur.restore-invalide', { champ: t('serveur.restore-champ-racine'), attendu: t('serveur.restore-attendu-objet') }))
  if (typeof data.id !== 'string' || data.id === '') throw new Error(t('serveur.restore-invalide', { champ: 'id', attendu: t('serveur.restore-attendu-chaine-non-vide') }))
  if (typeof data.type !== 'string' || data.type === '') throw new Error(t('serveur.restore-invalide', { champ: 'type', attendu: t('serveur.restore-attendu-chaine-non-vide') }))
  if (!Array.isArray(data.journal)) throw new Error(t('serveur.restore-invalide', { champ: 'journal', attendu: t('serveur.restore-attendu-tableau') }))
  if (!Array.isArray(data.seats)) throw new Error(t('serveur.restore-invalide', { champ: 'seats', attendu: t('serveur.restore-attendu-tableau') }))
  if (!Array.isArray(data.timers)) throw new Error(t('serveur.restore-invalide', { champ: 'timers', attendu: t('serveur.restore-attendu-tableau') }))
  for (const s of data.seats) {
    if (s === null) continue
    if (typeof s !== 'object' || typeof s.seat !== 'number' || typeof s.id !== 'string') {
      throw new Error(t('serveur.restore-invalide', { champ: 'seats[]', attendu: t('serveur.restore-attendu-siege') }))
    }
  }
  for (const timer of data.timers) {
    if (!timer || typeof timer.name !== 'string' || typeof timer.at !== 'number') {
      throw new Error(t('serveur.restore-invalide', { champ: 'timers[]', attendu: t('serveur.restore-attendu-minuterie') }))
    }
  }
  // instantané lockstep (cf. lockstep.ts « INSTANTANÉS ») : un tick entier ≥ 1, un état, un générateur entier de 32 bits — faux, la
  // numérotation des ticks et l'état renvoyé aux clients partiraient d'une valeur fausse
  const snapshot = (data.lockstep as { snapshot?: unknown } | undefined)?.snapshot
  if (snapshot !== undefined && snapshot !== null) {
    const s = snapshot as Partial<MjsServerLockstepSnapshot>
    const ok = typeof snapshot === 'object' && Number.isInteger(s.tick) && s.tick! >= 1 && s.state !== undefined && Number.isInteger(s.rng) && s.rng! >= 0 && s.rng! <= 0xFFFFFFFF
    if (!ok) throw new Error(t('serveur.restore-invalide', { champ: 'lockstep.snapshot', attendu: t('serveur.restore-attendu-instantane-lockstep') }))
    // le journal reprend au tick qui suit l'instantané : un chevauchement ferait rejouer aux clients des ordres déjà dans l'état, un
    // trou leur en ferait manquer
    const journal = (data.lockstep as { journal?: unknown } | undefined)?.journal
    if (Array.isArray(journal) && journal.length > 0 && (journal[0] as { tick?: unknown } | null)?.tick !== s.tick! + 1) {
      throw new Error(t('serveur.restore-invalide', { champ: 'lockstep.journal', attendu: t('serveur.restore-attendu-journal-apres-instantane', { tick: s.tick! + 1 }) }))
    }
  }
}

/** ce que serialize() garde d'une partie lockstep — le journal, et l'instantané gardé s'il y en a un (cf. lockstep.ts « INSTANTANÉS ») */
function lockstepData(lockstep: MjsServerLockstep): { journal: MjsServerLockstepTick[]; snapshot?: MjsServerLockstepSnapshot } {
  const snapshot = lockstep.snapshot()
  return snapshot ? { journal: lockstep.journal(), snapshot } : { journal: lockstep.journal() }
}

/** diffusions couvertes par milliseconde depuis le démarrage, en moyenne, par le `seq` d'une partie restaurée (cf. restoredSeq) : une
 *  rafale de `changed()` en diffuse bien plus d'une par milliseconde (5 000 en 160 ms : 31 par ms). L'heure en millisecondes multipliée
 *  par 2 000 reste un entier exact (sous 2^53, Number.MAX_SAFE_INTEGER) jusqu'en 2112 */
const SEQ_PER_MS = 2000

/** `seq` d'une partie restaurée (hors lockstep, où il est le numéro de tick repris du journal) — il ordonne les trames : un client ignore
 *  celle dont le `seq` ne dépasse pas le dernier qu'il a vu, réponse de µgame:resync comprise, et le client déjà publié ne changera pas.
 *  La sauvegarde ne le suit pas : une diffusion qui ne change rien n'écrit pas (veille récurrente, boucle d'action dont simulate ne
 *  change rien), et la dernière écriture précède au plus le dernier état diffusé. Repris tel quel, il restait sous ce que les joueurs
 *  avaient vu, qui restaient figés après le redémarrage. Il repart donc de l'heure en millisecondes multipliée par SEQ_PER_MS quand elle
 *  le dépasse : une diffusion n'avance `seq` que d'un, jamais plus de SEQ_PER_MS par milliseconde en moyenne depuis le démarrage, si
 *  bien que le redémarrage suivant dépasse tout ce qu'une exécution précédente a diffusé — sans écriture de plus, même après un arrêt
 *  brutal suivi d'un redémarrage aussitôt. Seule limite : une horloge qui recule entre deux démarrages. Un `seq` sauvegardé illisible
 *  (absent, non numérique) compte pour 0 */
function restoredSeq(stored: unknown): number {
  const seq = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0
  return Math.max(seq, Date.now() * SEQ_PER_MS)
}

/** Restaure une partie depuis un instantané `serialize()` — sièges reconstruits SANS connexion
 *  live (`clients` vide, `connected: false` : personne n'est encore rattaché après un redémarrage,
 *  cf. µgame:resync pour le rattachement). `seq` repart au-dessus de ce que les joueurs ont vu (cf. restoredSeq). Minuteries réarmées au DÉLAI RESTANT (à - maintenant,
 *  jamais négatif). Ni `def.state()` ni `hooks.onCreate` ne re-tournent (restaurer ≠ créer). Mode
 *  lockstep : `data.lockstep.journal` repeuple `game._lockstep` (déjà construit avec
 *  la MÊME graine, ré-dérivée de `data.id`, cf. lockstep.ts deterministicSeed) — no-op si absent
 *  (partie authoritative, ou lockstep restaurée depuis un instantané antérieur).
 *  `data` VALIDÉE en premier (cf. validateSnapshot) : forme inattendue → throw, AUCUNE partie
 *  n'est construite (jamais un objet à moitié restauré posé dans le registre). */
export function restoreGame(app: MjsWsApp, def: MjsServerResolvedDef, onDestroy: (game: Game) => void, data: MjsServerGameSnapshot): Game {
  validateSnapshot(data)
  const game = new Game(app, def, onDestroy, data.id)
  game.code    = data.code
  game.state   = data.state
  game.phase   = data.phase
  game.turn    = data.turn
  game.seq     = def.mode === 'lockstep' ? data.seq : restoredSeq(data.seq)
  game.journal = data.journal.slice()
  game.players = data.seats.map(s => s ? { seat: s.seat, id: s.id, clients: new Set<MjsWsClient>(), connected: false } : null)
  // cf. `_ended`/`_endResult`/`_started`/`_unconfirmedSeats` (game.ts) — absents d'un instantané
  // ANTÉRIEUR à ces champs : `??` retombe sur le comportement HISTORIQUE (jouable, pas encore
  // pleine, aucune fenêtre de confirmation en cours), jamais un throw pour leur seule absence
  game._ended            = data.ended ?? false
  game._endResult         = data.result
  game._started           = data.started ?? false
  game._unconfirmedSeats = data.unconfirmedSeats ? new Set(data.unconfirmedSeats) : null
  // anti-triche par joueur — repeuple _lastAntiReplaySeq/_lastMoveAt AVANT tout rattachement,
  // sinon un rejeu bloqué avant l'arrêt repasserait après restauration (_buckets repart plein, par design)
  for (const s of data.seats) {
    if (!s) continue
    if (s.lastAntiReplaySeq != null) game._lastAntiReplaySeq.set(s.id, s.lastAntiReplaySeq)
    if (s.lastMoveAt != null) game._lastMoveAt.set(s.id, s.lastMoveAt)
  }
  if (game._lockstep && data.lockstep) game._lockstep._restoreJournal(data.lockstep.journal, data.lockstep.snapshot ?? null)
  // AVANT le ré-armement des minuteries SAUVÉES juste en dessous — si la partie était DÉJÀ vide
  // avant le redémarrage, `µempty` fait partie de `data.timers` et sera réarmée au délai RESTANT
  // juste après (_arm remplace toujours l'existant, le plus précis des deux gagne) ; si elle était
  // PLEINEMENT connectée (donc `µempty` absente de `data.timers`, désarmée à l'époque), CET appel
  // l'arme fraîche au TTL complet — sans lui, une partie restaurée sans AUCUN siège connecté (le
  // cas normal juste après un redémarrage, cf. `connected: false` ci-dessus) n'aurait NI boucle de
  // tick NI garde de grâce : des sièges déconnectés gardés indéfiniment en mémoire. Respecte
  // `_ended` (cf. _checkEmpty) : une partie restaurée déjà terminée ne relance ni tick ni grâce.
  game._checkEmpty()
  for (const { name, at } of data.timers) game._armByName(name, Math.max(0, at - Date.now()))
  // partie finie dont la sauvegarde n'a pas sa grâce (écrite pendant un arrêt, ou par une version antérieure) : sans elle, rien ne la
  // détruirait jamais ni ne la retirerait du stockage — sa grâce de fin repart entière
  if (game._ended && !game._timers.has('µempty')) game._armByName('µempty', def.endTtl ?? def.emptyTtl)
  return game
}

/** Crée une partie FRAÎCHE — `def.state(game)` puis `hooks.onCreate` (dans cet ordre : l'état
 *  existe déjà quand onCreate le lit). Seul point d'entrée normal — jamais `new Game()` direct
 *  hors de ce fichier (le state ne serait pas initialisé). Mode lockstep : `def.state`
 *  est `null` (interdit, cf. game-def.ts) — `game.state` reste `undefined`, jamais assigné.
 *  Un throw de onCreate remonte à l'appelant (aucune partie n'est rendue) ; une Promise qu'il rend n'est pas attendue, son
 *  rejet est journalisé et la partie est créée quand même (cf. _followRejection). */
export function createGame(app: MjsWsApp, def: MjsServerResolvedDef, onDestroy: (game: Game) => void, id: string): Game {
  const game = new Game(app, def, onDestroy, id)
  if (def.state) game.state = def.state(game)
  game._followRejection('serveur.partie-oncreate-rejete', def.hooks.onCreate?.(game))
  return game
}
