// mjs-server/lockstep — moteur du mode salle 'lockstep' (def.mode) : la salle NE SIMULE
// RIEN (cf. game.ts pour la liste FERMÉE d'interdits state/view/deltas/intents/simulate/space/history) —
// SEULS les ORDRES (µgame:move reçus, jamais exécutés côté serveur) circulent, groupés PAR TICK et
// diffusés à l'IDENTIQUE à tous les joueurs (µgame:orders, cf. game.ts::_broadcastTickOrders) :
// l'égalité stricte d'entrée entre clients est le cœur du déterminisme (tous simulent le MÊME modèle
// à partir des MÊMES ordres, dans le MÊME ordre — jeux STR/combat/rejouabilité).
//
// GRAINE (seed, µgame:start) — PAS de Math.random en dur : `deterministicSeed(id)` hache
// l'id de partie (FNV-1a 32 bits, PURE) — l'id embarque déjà le COMPTEUR monotone de création
// ('gameN', cf. matchmaking.ts generateGameId), donc CE hash dérive bien « d'un compteur + de
// l'id ». Conséquence utile : la graine est TOUJOURS ré-dérivable depuis `id` seul —
// aucun besoin de la persister séparément (cf. `_restoreJournal`, appelé SANS graine explicite).
//
// JOURNAL — append-only (contrairement à `Game.journal`, le journal court v1 des coups CLASSIQUES,
// cf. game.ts commentaire de tête) : la rejouabilité lockstep exige l'historique depuis la genèse, ou
// depuis le dernier INSTANTANÉ gardé (cf. plus bas) — µgame:resync renvoie l'instantané s'il y en a un
// puis les ordres qui le suivent, le client repart de lui ou de son état initial (cf. mjs_lockstep.ts).
// Sans instantané, rien ne permet d'élaguer le journal sans fausser l'état d'un joueur. Deux bornes, en
// octets du JSON (UTF-8, tel que renvoyé au resync et sauvegardé) : `maxOrderBytes` — un ordre plus
// gros est REFUSÉ par addOrder (throw, il n'entre jamais dans le journal) ; `maxBytes` — l'instantané et
// le journal ENSEMBLE : un tick qui ferait dépasser n'entre pas, closeTick rend `null` et game.ts TERMINE
// la partie (raison 'journal-full') : tous les joueurs gardent l'état du dernier tick diffusé, jamais un
// journal tronqué. Défauts dans game-def.ts (def.lockstepJournal) ; borne absente (appel direct) = illimité.
// En OPT-IN, `def.lockstepJournal.maxTicks` reste un anneau qui purge les plus VIEUX ticks au-delà du
// seuil (troncature assumée par l'auteur, cf. game-def.ts) — la borne d'octets s'y applique après purge.
//
// INSTANTANÉS (opt-in, def.lockstepJournal.snapshotEvery) — la salle ne simule rien : seuls les clients
// connaissent l'état. Tous les `snapshotEvery` ticks, chacun propose le sien (µgame:snapshot : l'état à la
// fin du tick et celui du générateur partagé, cf. mjs_lockstep.ts) ; receiveSnapshot ne le GARDE que quand
// au moins DEUX joueurs assis et la majorité absolue des joueurs assis ont proposé exactement le même JSON pour
// ce tick — la confiance du quorum des hash ci-dessous, en plus strict : le texte entier est comparé (jamais un
// hash de 32 bits, qu'un tricheur saurait forger), et un joueur seul ne certifie jamais rien, puisque l'état
// gardé repart chez les autres joueurs. Le décompte ne retient que les votes des joueurs assis AU MOMENT où il
// a lieu (`seated`, relu à chaque proposition) : le vote d'un joueur parti est oublié, celui qui prend son siège
// ne vote que pour lui — sans quoi un menteur qui propose puis cède sa place à un complice ferait garder son état
// faux avec un seul joueur assis pour lui. Gardé, l'instantané remplace le début du journal (les ticks qu'il
// couvre sont retirés) ; un accord tombé pendant le tick même qu'il couvre (le dernier clos) n'est rangé qu'à la
// clôture du suivant, juste avant d'y journaliser ce tick : jamais un instantané à côté d'un journal vide — un
// client qui ne sait pas lire les instantanés reçoit toujours au moins le tick qui le suit, et signale le journal
// tronqué au lieu de rester figé (celui qui ne se déclare pas capable de les lire est d'ailleurs refusé, une fois le
// journal coupé, cf. game.ts::_requireSnapshotReader). `hold` (cf. game.ts::_receiveSnapshot) retient un accord atteint : rien n'est
// gardé tant qu'un client assis n'a jamais proposé d'instantané. FENÊTRE des propositions : un tick de la cadence
// déjà clos est reçu tant que moins de `snapshotWindow` ticks l'ont suivi (game-def.ts : deux secondes de ticks,
// ou la cadence si elle est plus longue) ; un seul tick est en cours à la fois — le premier proposé depuis le
// dernier accord, jusqu'à son accord, sa retenue ou la fin de sa fenêtre —, ce qui laisse aux joueurs les plus
// lents le temps de proposer le même. Un joueur ne vote qu'une fois par tick, et seules les propositions du tick
// en cours sont retenues (mémoire bornée par le nombre de sièges et la taille de trame de MJS-WS). Jamais de trou
// entre l'instantané et le journal : un accord dont le tick suivant a déjà quitté l'anneau `maxTicks` n'est pas
// gardé (game-def.ts refuse d'ailleurs un anneau plus court que la fenêtre).
//
// PERSISTANCE (µpersist) — `Game.serialize()` (mode lockstep) inclut `{ journal: journal() }`, plus
// `snapshot` quand un instantané est gardé (PAS la graine, ré-dérivable de `id`) à la place de `state` :
// « save = l'append des ordres » au sens
// CONCEPTUEL (ce qui est persisté EST le journal d'ordres, jamais un état simulé) — MÉCANIQUEMENT,
// chaque save() réécrit le journal COMPLET à ce jour (même contrat adaptateur.save « écrit/remplace »
// que le mode authoritative, cf. persist.ts) : pas un append incrémental fichier/bdd, qui exigerait de
// faire évoluer le CONTRAT des adaptateurs (persist-file/redis/sql/bridge.ts), hors scope actuel.
//
// DIVERGENCE (anti-triche, durcissement quorum) — le client annonce périodiquement un hash
// FNV de son état (µgame:hash {tick, h}, cf. mjs_lockstep.ts) ; `receiveHash` NE retient PLUS « le
// 1er hash vu = référence » (troué : un seul siège pouvait pré-empoisonner un tick FUTUR avant que
// les honnêtes n'y arrivent, ou déclencher lui-même une divergence en s'envoyant 2 hash contradictoires
// à lui seul) — deux mécanismes INDÉPENDANTS, chacun identifie le(s) SUSPECT(S), jamais la majorité :
//  1. AUTO-CONTRADICTION — un siège qui rapporte deux hash DIFFÉRENTS pour le MÊME tick est flaggé
//     suspect IMMÉDIATEMENT (preuve interne, ne dépend d'aucun autre siège ni d'aucun quorum).
//  2. QUORUM — la référence d'un tick ne se fige QUE quand un hash atteint la MAJORITÉ ABSOLUE des
//     sièges COURANTS (floor(N/2)+1 sur N, jamais parmi les seuls sièges ayant déjà répondu) : par
//     construction, DEUX hash différents ne peuvent JAMAIS atteindre tous les deux ce seuil pour le
//     même tick (pigeonhole) — une fois figée, la référence ne se retourne donc plus jamais. Tout
//     siège dont le hash diffère (déjà rapporté OU rapporté plus tard) devient suspect. Cas N PAIR
//     strictement scindé (aucune valeur n'atteint jamais floor(N/2)+1, même une fois TOUS les sièges
//     rapportés — ex. 2 sièges en désaccord, 1 contre 1) : politique ASSUMÉE = AUCUNE déclaration
//     (indécidable sans arbitre extérieur — jamais un « premier arrivé blâme le second » arbitraire).
//     Seuls comptent les hash des joueurs assis AU MOMENT du décompte (`seated`, relu à chaque appel, comme pour les
//     instantanés) : celui d'un joueur parti est oublié, ni compté ni blâmé, et celui qui prend son siège ne vote que pour
//     lui — sans quoi un menteur qui annonce un faux hash puis cède sa place à un complice ferait figer la référence sur le
//     faux, à deux voix dont une seule assise, et les honnêtes passeraient pour suspects. Une référence figée ne bouge plus.
// FENÊTRE — tout hash pour un tick hors de [tickCourant−FENETRE_TICKS, tickCourant+DELAI_AVANT_TICKS]
// est REJETÉ d'emblée (silence, jamais stocké) : ferme le pré-empoisonnement (l'attaquant ne peut
// plus poser une fausse entrée bien avant que les honnêtes n'atteignent ce tick) ET borne la mémoire
// (éviction active à chaque closeTick(), en plus du refus à l'entrée — cf. createLockstep plus bas).
// Un seau à jetons DÉDIÉ (game.ts::_consumeHashToken, TokenBucket de mjs-ws/guard.ts) filtre en
// amont un flood de hash par ailleurs VALIDES mais coûteux à traiter, cf. game.ts::_receiveHash.

import { Buffer } from 'node:buffer'
import { t } from '../messages/index.js'

export interface MjsServerLockstepOrder {
  player: string
  move: string
  p: unknown
}

export interface MjsServerLockstepTick {
  tick: number
  orders: MjsServerLockstepOrder[]
}

export interface MjsServerLockstepDivergence {
  tick: number
  /** sièges identifiés comme suspects pour ce tick — JAMAIS la majorité honnête (cf. tête de
   *  fichier) ; toujours ≥ 1 entrée quand cet objet existe (jamais renvoyé vide, cf. receiveHash) */
  suspects: string[]
  /** 'auto-contradiction' = CE siège s'est contredit lui-même (2 hash différents, même tick — preuve
   *  interne) ; 'quorum' = hash minoritaire face à la référence MAJORITAIRE établie (cf. tête de fichier) */
  reason: 'auto-contradiction' | 'quorum'
}

/** instantané gardé (cf. tête de fichier « INSTANTANÉS ») — renvoyé tel quel au resync et sauvegardé */
export interface MjsServerLockstepSnapshot {
  /** dernier tick dont l'instantané porte les ordres appliqués — le journal reprend au tick suivant */
  tick: number
  /** état de la simulation des clients à la fin de `tick` (JSON, tel que proposé) */
  state: unknown
  /** état du générateur partagé (µ.random) à la fin de `tick` — entier de 32 bits non signé */
  rng: number
}

/** bornes en octets du JSON (UTF-8) — cf. tête de fichier « JOURNAL » ; absente ou `null` = aucune borne */
export interface MjsServerLockstepBounds {
  /** taille maximale de l'instantané et du journal ensemble — au-delà, closeTick rend `null` (partie à terminer) */
  maxBytes?: number | null
  /** taille maximale d'UN ordre `{player, move, p}` — au-delà, addOrder lève */
  maxOrderBytes?: number | null
}

export interface MjsServerLockstep {
  readonly seed: number
  /** file un ordre pour le tick COURANT (pas encore diffusé) — cf. Game._onMove. Lève si l'ordre
   *  dépasse `maxOrderBytes` : il n'entre alors ni dans le tick ni dans le journal */
  addOrder(player: string, move: string, p: unknown): void
  /** clôt le tick courant (ordres accumulés + avance le compteur), range d'abord l'instantané accordé pendant le tick précédent s'il
   *  y en a un (cf. tête de fichier « INSTANTANÉS »), journalise (append), évince les
   *  entrées de divergence sorties de la fenêtre (cf. tête de fichier « FENÊTRE ») et retourne le
   *  groupe à diffuser — renvoyé même `orders: []` (le tick lui-même est l'horloge commune
   *  que les clients doivent avancer — jamais de trame sautée faute d'ordre). `null` seulement quand
   *  ce tick ferait dépasser `maxBytes` au journal : rien n'est journalisé ni à diffuser, la partie
   *  doit se terminer (cf. game.ts::_broadcastTickOrders) */
  closeTick(): MjsServerLockstepTick | null
  /** journal depuis la genèse, ou depuis le dernier instantané gardé (rejouabilité, µgame:play/start/resync — cf. game.ts _infoMode) */
  journal(): MjsServerLockstepTick[]
  /** instantané proposé par le joueur `player` pour `tick` (cf. tête de fichier « INSTANTANÉS ») — `true` quand CETTE proposition le
   *  fait garder (le journal vient d'être coupé avant lui) ; `false` sinon : pas de cadence déclarée, tick hors cadence, pas encore clos,
   *  sorti de la fenêtre, déjà couvert ou autre que le tick en cours, générateur qui n'est pas un entier de 32 bits, état absent,
   *  expéditeur qui n'est pas assis, vote déjà compté, accord pas encore atteint ou retenu (`hold`), accord sur le dernier tick clos
   *  (rangé à la clôture du suivant), ou instantané qui ne tiendrait pas dans `maxBytes` avec les ordres qui le suivent. `seated` :
   *  identités des joueurs assis en ce moment (connectés ou non) — seuls leurs votes comptent */
  receiveSnapshot(player: string, tick: number, state: unknown, rng: number, seated: readonly string[], hold?: boolean): boolean
  /** dernier instantané gardé, `null` tant qu'aucun ne l'a été */
  snapshot(): MjsServerLockstepSnapshot | null
  /** reçoit un hash annoncé par un joueur pour `tick` (cf. tête de fichier pour le modèle quorum +
   *  auto-contradiction + fenêtre) — `null` si rien à signaler (hash hors fenêtre REJETÉ, expéditeur qui n'est pas assis, quorum
   *  pas encore atteint, ou hash concordant — hashs concordants = rien à signaler).
   *  `seated` = identités des joueurs assis en ce moment (connectés ou non, MÊME politique que le tour par
   *  tour roundrobin — cf. game.ts commentaire de tête) : relu à CET appel, jamais figé à la
   *  création (cf. game.ts::_receiveHash) — seuls leurs hash comptent, la majorité se prend sur leur nombre. */
  receiveHash(player: string, tick: number, h: string, seated: readonly string[]): MjsServerLockstepDivergence | null
  /** persistance (µpersist) — restaure le journal depuis une sauvegarde (cf. restoreGameFromSnapshot), et l'instantané gardé
   *  s'il y en avait un : reprend la numérotation de tick JUSTE APRÈS la dernière entrée restaurée (ou après l'instantané quand
   *  le journal est vide), jamais une renumérotation qui collisionnerait avec l'historique déjà connu des clients. No-op sur un
   *  journal vide sans instantané. */
  _restoreJournal(journal: MjsServerLockstepTick[], snapshot?: MjsServerLockstepSnapshot | null): void
  /** introspection interne (tests/diagnostics — MÊME statut que _clear/_restoreJournal, PAS un
   *  contrat public MjsServerApp) — nombre de ticks actuellement retenus pour la détection de
   *  divergence ; TOUJOURS ≤ FENETRE_TICKS + DELAI_AVANT_TICKS + 1 (borné, cf. tête de fichier). */
  _hashSize(): number
  /** introspection interne (tests/diagnostics) — taille en octets du JSON de `journal()`, tenue à
   *  chaque tick (jamais recalculée sur tout le journal) */
  _bytes(): number
  _clear(): void
}

/** graine déterministe — FNV-1a 32 bits de l'id de partie, cf. commentaire de tête.
 *  PURE (aucun état, aucun Math.random) : même id ⇒ même graine, TOUJOURS — testable, reproductible.
 *  MÊME algorithme que le hash d'état CÔTÉ CLIENT (mjs_lockstep.ts::_mjlockstepFnv) — isomorphe au
 *  sens large (même famille d'algorithme), bien que ces deux usages hachent des entrées différentes. */
export function deterministicSeed(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// anti-triche — fenêtre de tolérance des hash autour du tick courant (cf. tête de fichier
// « FENÊTRE ») : ~64 ticks en arrière (rejoue une latence/déconnexion raisonnable), petite marge en
// avant (course bénigne hash/clôture de tick — PAS une fenêtre pour un hash réellement futur, cf.
// receiveHash plus bas).
const TICKS_WINDOW     = 64
const DELAY_BEFORE_TICKS = 4

/** état de divergence d'UN tick — remplace l'ancien couple hashParTick/tickDejaDivergent (« 1er hash
 *  = référence ») : tous les hash vus par siège + décompte par valeur + référence gelée une fois la
 *  majorité absolue atteinte + sièges déjà signalés (jamais 2 fois pour le même siège/tick), cf. tête
 *  de fichier. */
interface TickHashState {
  perPlayer: Map<string, string>
  comptes: Map<string, number>
  reference: string | null
  signales: Set<string>
}

const absoluteMajority = (seats: number): number => Math.floor(seats / 2) + 1

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')

// octets d'un tick journalisé `{"tick":N,"orders":[…]}` : 21 fixes, les chiffres du tick, ses ordres et leurs virgules
const tickBytes = (tick: number, ordersBytes: number, count: number): number => 21 + String(tick).length + ordersBytes + Math.max(0, count - 1)

/** construit le moteur lockstep d'UNE partie — `id` sert à dériver la graine (cf. deterministicSeed) ;
 *  le journal démarre VIDE (partie fraîche, cf. matchmaking.ts::create()) — `_restoreJournal` le repeuple pour
 *  une partie RESTAURÉE (cf. restoreGameFromSnapshot), sans jamais changer la graine (ré-dérivée de `id`, donc
 *  déjà identique à l'originale — aucune valeur à restaurer séparément). `bounds` : cf. tête de fichier « JOURNAL ».
 *  `snapshotEvery` : cadence des instantanés en ticks (cf. tête de fichier « INSTANTANÉS »), `null` = aucun ; `snapshotWindow` :
 *  fenêtre de réception d'une proposition en ticks, la cadence par défaut. */
export function createLockstep(id: string, maxTicks: number | null = null, bounds: MjsServerLockstepBounds = {}, snapshotEvery: number | null = null, snapshotWindow: number | null = null): MjsServerLockstep {
  const seed = deterministicSeed(id)
  const maxBytes      = bounds.maxBytes ?? null
  const maxOrderBytes = bounds.maxOrderBytes ?? null
  let fullJournal: MjsServerLockstepTick[] = []
  let currentOrders: MjsServerLockstepOrder[] = []
  let tickCount = 0
  // taille du journal tenue au fil des ticks : octets de chaque tick journalisé (alignés sur
  // fullJournal), des ordres du tick courant, et du JSON entier (`[` + ticks séparés par `,` + `]`)
  let tickSizes: number[] = []
  let currentBytes = 0
  let journalBytes = 2
  // instantané gardé et sa taille en octets du JSON, comptée avec le journal dans `maxBytes` ; instantané accordé sur le dernier tick
  // clos, rangé à la clôture du suivant ; tick en cours et ses propositions (joueur → texte proposé, `[état, générateur]`) ; `settled` :
  // son accord est déjà atteint (gardé, rangé au tick suivant, retenu ou sans place), il ne bloque plus le tick suivant de la cadence
  const windowTicks = snapshotWindow ?? snapshotEvery ?? 0
  let snap: MjsServerLockstepSnapshot | null = null
  let pending: MjsServerLockstepSnapshot | null = null
  let snapBytes    = 0
  let proposedTick = 0
  let proposals    = new Map<string, string>()
  let settled      = false
  // divergence (anti-triche) — PAR TICK, cf. TickHashState ; bornée par éviction dans
  // closeTick() (au-delà du simple refus à l'entrée dans receiveHash, cf. tête de fichier)
  const hashesPerTick = new Map<number, TickHashState>()

  // coupe le journal avant l'instantané accordé, s'il tient dans `maxBytes` avec les ordres qui le suivent (`extra` : octets du tick que
  // closeTick s'apprête à journaliser) et si le tick qui le suit est encore là (jamais de trou, cf. tête de fichier) — sinon rien ne
  // change, le journal reste entier
  const cut = (candidate: MjsServerLockstepSnapshot, extra: number): boolean => {
    const first = fullJournal.findIndex(g => g.tick > candidate.tick)
    if (first < 0 ? tickCount !== candidate.tick : fullJournal[first].tick !== candidate.tick + 1) return false
    const bytes = jsonBytes(candidate)
    const kept  = first < 0 ? [] : tickSizes.slice(first)
    const keptBytes = 2 + kept.reduce((sum, n) => sum + n, 0) + Math.max(0, kept.length - 1)
    if (maxBytes != null && bytes + keptBytes + extra > maxBytes) return false
    snap         = candidate
    snapBytes    = bytes
    fullJournal  = first < 0 ? [] : fullJournal.slice(first)
    tickSizes    = kept
    journalBytes = keptBytes
    return true
  }

  return {
    get seed() { return seed },

    addOrder(player, move, p) {
      const order: MjsServerLockstepOrder = { player, move, p }
      const bytes = jsonBytes(order)
      if (maxOrderBytes != null && bytes > maxOrderBytes) throw new Error(t('serveur.partie-ordre-trop-gros', { taille: bytes, max: maxOrderBytes }))
      currentOrders.push(order)
      currentBytes += bytes
    },

    closeTick() {
      const tick  = tickCount + 1
      const bytes = tickBytes(tick, currentBytes, currentOrders.length)
      // accord tombé pendant le tick précédent, qu'il couvre : le journal est coupé ici, juste avant d'y ranger ce tick — jamais un
      // instantané à côté d'un journal vide (cf. tête de fichier « INSTANTANÉS »)
      if (pending) { cut(pending, bytes); pending = null }
      // journal borné (opt-in, def.lockstepJournal.maxTicks, cf. game.ts) — MÊME idiome que
      // l'éviction hashesPerTick plus bas : anneau, purge les plus VIEUX ticks au-delà de
      // `maxTicks` ; `maxTicks` null (défaut, absent de la déclaration) = aucun anneau. Les octets
      // du tick évincé (et sa virgule) sont décomptés AVANT la borne : un anneau n'est jamais pris
      // pour un journal plein
      const evicted = maxTicks != null && fullJournal.length + 1 > maxTicks ? fullJournal.length + 1 - maxTicks : 0
      let freed = 0
      for (let i = 0; i < evicted; i++) freed += tickSizes[i] + 1
      const nextBytes = journalBytes + (fullJournal.length > 0 ? 1 : 0) + bytes - freed
      // journal plein (instantané compris) : ce tick n'entre pas (ni journalisé ni diffusé), l'appelant termine la partie
      if (maxBytes != null && snapBytes + nextBytes > maxBytes) return null
      tickCount = tick
      const group: MjsServerLockstepTick = { tick, orders: currentOrders }
      currentOrders = []
      currentBytes  = 0
      journalBytes  = nextBytes
      fullJournal.push(group)
      tickSizes.push(bytes)
      if (evicted > 0) { fullJournal.splice(0, evicted); tickSizes.splice(0, evicted) }
      // éviction active — sans ça, une entrée qui a un jour reçu UN hash reste en mémoire
      // indéfiniment une fois hors fenêtre (le refus à l'entrée dans receiveHash empêche
      // seulement la CRÉATION de nouvelles entrées hors fenêtre, jamais la purge des anciennes au
      // fil du temps) : c'est CETTE éviction qui borne réellement la durée de vie de la partie.
      const threshold = tickCount - TICKS_WINDOW
      for (const t of hashesPerTick.keys()) if (t < threshold) hashesPerTick.delete(t)
      return group
    },

    journal() { return fullJournal },

    receiveSnapshot(player, tick, state, rng, seated, hold = false) {
      if (snapshotEvery == null || !Number.isInteger(tick) || tick % snapshotEvery !== 0) return false
      // un tick de la cadence déjà clos, que moins de `windowTicks` ticks ont suivi, plus récent que l'instantané gardé ou déjà accordé
      const covered = pending?.tick ?? snap?.tick ?? 0
      if (tick > tickCount || tickCount - tick >= windowTicks || tick <= covered) return false
      if (!Number.isInteger(rng) || rng < 0 || rng > 0xFFFFFFFF || state === undefined) return false
      const present = new Set(seated)
      if (!present.has(player)) return false
      // un seul tick en cours : un autre n'est ouvert qu'une fois celui-ci accordé ou sorti de sa fenêtre
      if (tick !== proposedTick) {
        if (proposedTick > 0 && tickCount - proposedTick < windowTicks && !settled) return false
        proposedTick = tick
        proposals    = new Map()
        settled      = false
      }
      // seuls comptent les votes des joueurs assis à ce décompte : ceux des joueurs partis ou remplacés sont oubliés
      for (const voter of proposals.keys()) if (!present.has(voter)) proposals.delete(voter)
      if (proposals.has(player)) return false
      let text: string
      try {
        text = JSON.stringify([state, rng])
      } catch {
        return false
      }
      proposals.set(player, text)
      let count = 0
      for (const proposed of proposals.values()) if (proposed === text) count++
      if (count < Math.max(2, absoluteMajority(present.size))) return false
      // accord atteint : ce tick ne bloque plus le suivant de la cadence. Retenu (un client assis n'a jamais proposé d'instantané, cf.
      // game.ts::_receiveSnapshot), rien n'est gardé — ce tick s'accorde encore si la retenue tombe avant la fin de sa fenêtre
      settled = true
      if (hold) return false
      // l'instantané (relu du texte comparé, celui qui repartira chez les clients) remplace les ticks qu'il couvre ; sur le dernier tick
      // clos, il attend la clôture du suivant (cf. closeTick)
      proposals = new Map()
      const candidate: MjsServerLockstepSnapshot = { tick, state: (JSON.parse(text) as [unknown, number])[0], rng }
      if (tick === tickCount) { pending = candidate; return false }
      return cut(candidate, 0)
    },

    snapshot() { return snap },

    receiveHash(player, tick, h, seated) {
      // tick NON ENTIER — REJETÉ d'emblée : `tick * 0.001` &c. contourneraient sinon le plafond
      // d'entrées retenues (une infinité de valeurs fractionnaires distinctes tiennent dans la
      // MÊME fenêtre entière ci-dessous, cf. hashesPerTick/_hashSize)
      if (!Number.isInteger(tick)) return null
      // hors fenêtre — REJETÉ d'emblée, jamais stocké (ferme le pré-empoisonnement d'un tick
      // lointain ET la fuite mémoire par ticks inventés, cf. tête de fichier)
      if (tick < tickCount - TICKS_WINDOW || tick > tickCount + DELAY_BEFORE_TICKS) return null
      const present = new Set(seated)
      if (!present.has(player)) return null

      let state = hashesPerTick.get(tick)
      if (!state) { state = { perPlayer: new Map(), comptes: new Map(), reference: null, signales: new Set() }; hashesPerTick.set(tick, state) }

      const previous = state.perPlayer.get(player)

      // auto-contradiction — CE siège a déjà rapporté un hash DIFFÉRENT pour ce tick : preuve
      // interne, suspect IMMÉDIAT, sans attendre le quorum (cf. tête de fichier). Le hash déjà
      // enregistré n'est JAMAIS écrasé (garde le 1er vote pour le décompte ci-dessous, stable).
      if (previous !== undefined && previous !== h) {
        if (state.signales.has(player)) return null   // déjà signalé pour ce tick — jamais 2 fois
        state.signales.add(player)
        return { tick, suspects: [player], reason: 'auto-contradiction' }
      }

      if (previous === undefined) {
        state.perPlayer.set(player, h)
        state.comptes.set(h, (state.comptes.get(h) ?? 0) + 1)
      }

      // référence déjà figée pour ce tick (majorité atteinte à un appel PRÉCÉDENT) — comparaison
      // directe, jamais de retour en arrière possible (cf. tête de fichier : pigeonhole)
      if (state.reference !== null) {
        if (h === state.reference || state.signales.has(player)) return null
        state.signales.add(player)
        return { tick, suspects: [player], reason: 'quorum' }
      }

      // pas encore de référence — seuls comptent les hash des joueurs assis à ce décompte : ceux des joueurs partis ou remplacés
      // sont oubliés (cf. tête de fichier « QUORUM »)
      for (const [voter, hv] of state.perPlayer) {
        if (present.has(voter)) continue
        state.perPlayer.delete(voter)
        const left = (state.comptes.get(hv) ?? 1) - 1
        if (left > 0) state.comptes.set(hv, left)
        else state.comptes.delete(hv)
      }
      // CE hash vient-il de franchir la majorité ABSOLUE des joueurs assis ?
      if ((state.comptes.get(h) ?? 0) < absoluteMajority(present.size)) return null   // quorum pas encore atteint — silence, on attend d'autres rapports

      state.reference = h
      const suspects: string[] = []
      for (const [j, hj] of state.perPlayer) {
        if (hj !== h && !state.signales.has(j)) { state.signales.add(j); suspects.push(j) }
      }
      return suspects.length > 0 ? { tick, suspects, reason: 'quorum' } : null   // personne à blâmer — silence
    },

    _restoreJournal(journal, restored = null) {
      // instantané sauvegardé : la numérotation reprend au plus tôt après lui (journal vide = sauvegardé juste après l'avoir gardé)
      if (restored) { snap = restored; snapBytes = jsonBytes(restored); tickCount = restored.tick }
      if (journal.length === 0) return
      // MÊME plafond qu'à l'éviction en direct (closeTick ci-dessus) — une restauration ne doit
      // jamais réintroduire plus de `maxTicks` ticks qu'un journal vécu normalement n'en garderait
      fullJournal = maxTicks != null && journal.length > maxTicks ? journal.slice(journal.length - maxTicks) : journal.slice()
      tickCount = fullJournal[fullJournal.length - 1].tick
      // taille mesurée sur le JSON restauré tel quel — un journal déjà au-delà de `maxBytes` (borne
      // abaissée entre deux lancements) fait refuser le tick suivant : la partie se termine, rien n'est tronqué
      tickSizes    = fullJournal.map(jsonBytes)
      journalBytes = 2 + tickSizes.reduce((sum, n) => sum + n, 0) + fullJournal.length - 1
    },

    _hashSize() { return hashesPerTick.size },

    _bytes() { return journalBytes },

    _clear() {
      fullJournal = []; currentOrders = []; tickSizes = []; currentBytes = 0; journalBytes = 2; hashesPerTick.clear()
      snap = null; pending = null; snapBytes = 0; proposedTick = 0; proposals = new Map(); settled = false
    },
  }
}
