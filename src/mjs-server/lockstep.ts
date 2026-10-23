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
// cf. game.ts commentaire de tête) : la rejouabilité lockstep exige l'historique COMPLET depuis la
// genèse (µgame:resync renvoie tout, le client rejoue depuis son état initial, cf. mjs_lockstep.ts) —
// aucun instantané d'état ne permet de l'élaguer sans fausser l'état d'un joueur. Deux bornes, en
// octets du JSON (UTF-8, tel que renvoyé au resync et sauvegardé) : `maxOrderBytes` — un ordre plus
// gros est REFUSÉ par addOrder (throw, il n'entre jamais dans le journal) ; `maxBytes` — un tick qui
// ferait dépasser le journal n'y entre pas, closeTick rend `null` et game.ts TERMINE la partie
// (raison 'journal-full') : tous les joueurs gardent l'état du dernier tick diffusé, jamais un journal
// tronqué. Défauts dans game-def.ts (def.lockstepJournal) ; borne absente (appel direct) = illimité.
// En OPT-IN, `def.lockstepJournal.maxTicks` reste un anneau qui purge les plus VIEUX ticks au-delà du
// seuil (troncature assumée par l'auteur, cf. game-def.ts) — la borne d'octets s'y applique après purge.
//
// PERSISTANCE (µpersist) — `Game.serialize()` (mode lockstep) inclut `{ journal: journal() }` (PAS
// la graine, ré-dérivable de `id`) à la place de `state` : « save = l'append des ordres » au sens
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

/** bornes en octets du JSON (UTF-8) — cf. tête de fichier « JOURNAL » ; absente ou `null` = aucune borne */
export interface MjsServerLockstepBounds {
  /** taille maximale du journal entier — au-delà, closeTick rend `null` (partie à terminer) */
  maxBytes?: number | null
  /** taille maximale d'UN ordre `{player, move, p}` — au-delà, addOrder lève */
  maxOrderBytes?: number | null
}

export interface MjsServerLockstep {
  readonly seed: number
  /** file un ordre pour le tick COURANT (pas encore diffusé) — cf. Game._onMove. Lève si l'ordre
   *  dépasse `maxOrderBytes` : il n'entre alors ni dans le tick ni dans le journal */
  addOrder(player: string, move: string, p: unknown): void
  /** clôt le tick courant (ordres accumulés + avance le compteur), journalise (append), évince les
   *  entrées de divergence sorties de la fenêtre (cf. tête de fichier « FENÊTRE ») et retourne le
   *  groupe à diffuser — renvoyé même `orders: []` (le tick lui-même est l'horloge commune
   *  que les clients doivent avancer — jamais de trame sautée faute d'ordre). `null` seulement quand
   *  ce tick ferait dépasser `maxBytes` au journal : rien n'est journalisé ni à diffuser, la partie
   *  doit se terminer (cf. game.ts::_broadcastTickOrders) */
  closeTick(): MjsServerLockstepTick | null
  /** journal COMPLET depuis la genèse (rejouabilité, µgame:play/start/resync — cf. game.ts _infoMode) */
  journal(): MjsServerLockstepTick[]
  /** reçoit un hash annoncé par un joueur pour `tick` (cf. tête de fichier pour le modèle quorum +
   *  auto-contradiction + fenêtre) — `null` si rien à signaler (hash hors fenêtre REJETÉ, quorum pas
   *  encore atteint, ou hash concordant — hashs concordants = rien à signaler).
   *  `seats` = nombre de sièges OCCUPÉS courants (connectés ou non, MÊME politique que le tour par
   *  tour roundrobin — cf. game.ts commentaire de tête) : relu à CET appel, jamais figé à la
   *  création (cf. game.ts::_receiveHash pour le calcul). */
  receiveHash(player: string, tick: number, h: string, seats: number): MjsServerLockstepDivergence | null
  /** persistance (µpersist) — restaure le journal depuis un instantané (cf. restoreGameFromSnapshot) : reprend
   *  la numérotation de tick JUSTE APRÈS la dernière entrée restaurée, jamais une renumérotation qui
   *  collisionnerait avec l'historique déjà connu des clients. No-op sur un journal vide. */
  _restoreJournal(journal: MjsServerLockstepTick[]): void
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
 *  déjà identique à l'originale — aucune valeur à restaurer séparément). `bounds` : cf. tête de fichier « JOURNAL ». */
export function createLockstep(id: string, maxTicks: number | null = null, bounds: MjsServerLockstepBounds = {}): MjsServerLockstep {
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
  // divergence (anti-triche) — PAR TICK, cf. TickHashState ; bornée par éviction dans
  // closeTick() (au-delà du simple refus à l'entrée dans receiveHash, cf. tête de fichier)
  const hashesPerTick = new Map<number, TickHashState>()

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
      // journal borné (opt-in, def.lockstepJournal.maxTicks, cf. game.ts) — MÊME idiome que
      // l'éviction hashesPerTick plus bas : anneau, purge les plus VIEUX ticks au-delà de
      // `maxTicks` ; `maxTicks` null (défaut, absent de la déclaration) = aucun anneau. Les octets
      // du tick évincé (et sa virgule) sont décomptés AVANT la borne : un anneau n'est jamais pris
      // pour un journal plein
      const evicted = maxTicks != null && fullJournal.length + 1 > maxTicks ? fullJournal.length + 1 - maxTicks : 0
      let freed = 0
      for (let i = 0; i < evicted; i++) freed += tickSizes[i] + 1
      const nextBytes = journalBytes + (fullJournal.length > 0 ? 1 : 0) + bytes - freed
      // journal plein : ce tick n'entre pas (ni journalisé ni diffusé), l'appelant termine la partie
      if (maxBytes != null && nextBytes > maxBytes) return null
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

    receiveHash(player, tick, h, seats) {
      // tick NON ENTIER — REJETÉ d'emblée : `tick * 0.001` &c. contourneraient sinon le plafond
      // d'entrées retenues (une infinité de valeurs fractionnaires distinctes tiennent dans la
      // MÊME fenêtre entière ci-dessous, cf. hashesPerTick/_hashSize)
      if (!Number.isInteger(tick)) return null
      // hors fenêtre — REJETÉ d'emblée, jamais stocké (ferme le pré-empoisonnement d'un tick
      // lointain ET la fuite mémoire par ticks inventés, cf. tête de fichier)
      if (tick < tickCount - TICKS_WINDOW || tick > tickCount + DELAY_BEFORE_TICKS) return null

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

      // pas encore de référence — CE hash vient-il de franchir la majorité ABSOLUE de `seats` ?
      if ((state.comptes.get(h) ?? 0) < absoluteMajority(seats)) return null   // quorum pas encore atteint — silence, on attend d'autres rapports

      state.reference = h
      const suspects: string[] = []
      for (const [j, hj] of state.perPlayer) {
        if (hj !== h && !state.signales.has(j)) { state.signales.add(j); suspects.push(j) }
      }
      return suspects.length > 0 ? { tick, suspects, reason: 'quorum' } : null   // personne à blâmer — silence
    },

    _restoreJournal(journal) {
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

    _clear() { fullJournal = []; currentOrders = []; tickSizes = []; currentBytes = 0; journalBytes = 2; hashesPerTick.clear() },
  }
}
