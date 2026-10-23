// mjs-server/matchmaking — l'entrée : trames µgame:play/move/leave/resync (cf. index.ts pour le
// tableau complet des trames). Possède les 3 registres vivants (file d'attente par type, parties
// par id, codes → id de partie) — game.ts ne connaît RIEN de ça, il ne gère qu'UNE instance.
//
// µgame:play { type, code? } — discrimination par TYPE de `code`, jamais par sa seule présence :
//   - absent                → file d'attente publique (`seats` atteintes → partie créée)
//   - `true` (booléen)      → crée une partie privée NEUVE, code généré (réponse le porte)
//   - "XXXXX" (chaîne)      → rejoint la partie privée existant à ce code (inconnu → erreur)
// `code` sous quelque forme que ce soit exige `def.code === true`, sinon erreur claire.

import { randomInt } from 'node:crypto'
import type { MjsWsApp, MjsWsClient } from '../mjs-ws/index.js'
import type { MjsServerResolvedDef } from './game-def.js'
import { Game, createGame, restoreGame, peerIdOf } from './game.js'
import type { MjsServerSeat, MjsServerGameSnapshot, MjsServerGameStats } from './game.js'
// anti-triche — quota de coups PAR IDENTITÉ agrégé (cf. identityQuotas plus bas), MÊME
// primitive que game.ts::_consumeToken/_consumeHashToken (guard.ts, déjà composée là-bas)
import { TokenBucket, errMessage } from '../mjs-ws/guard.js'
// anti-brute-force sur le CODE de partie privée — MÊME classe/patron que
// accounts.ts::account:login (failuresByIp), réutilisée TELLE QUELLE (jamais réimplémentée), cf.
// codeFailures plus bas
import { FailureBucket } from '../mjs-ws/accounts.js'
// couture persistance (persist.ts) — `null` si opts.persist absent (cf. index.ts) :
// TOUS les call-sites ci-dessous passent par `persist?.` (optional chaining), zéro coût sinon
import type { MjsServerPersistEngine } from './persist.js'
import { t } from '../messages/index.js'

const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // sans 0/O/1/I — ambiguïté typographique
const CODE_LENGTH = 5

// anti-brute-force code de partie privée (32^5 ≈ 33M codes, aucun autre rempart
// que le rate-limit transport générique) — défaut CONSERVATEUR toujours actif (contrairement à
// movesPerIdentity, opt-in) : `codePerIp` de createMatchmaking (dernier paramètre) vaut CE défaut tant
// qu'aucun appelant direct n'en passe un autre (index.ts n'en expose PAS encore l'option publique,
// hors périmètre de ce correctif) ; `null` explicite désactive le verrou.
const DEFAULT_CODE_PAR_IP_CAPACITY  = 10
const DEFAULT_CODE_PAR_IP_WINDOW_MS = 60000   // 10 échecs/min/IP

// plafond de la file d'attente publique — sans lui, `queues` (une entrée par
// IDENTITÉ distincte, cf. idempotence de file plus bas) grossit sans borne : N identités qui jouent
// µgame:play sans jamais atteindre def.seats font gonfler la mémoire indéfiniment. Défaut
// TOUJOURS actif (même politique que codePerIp) — `null` explicite désactive le plafond.
const DEFAULT_QUEUE_CAP = 1000

// parties privées en cours (au registre, pas finies) d'un même créateur où il siège encore, tous types et toutes connexions confondus
// — sans elle, un jeu à une place ou deux connexions qui se relaient (l'une crée, l'autre complète) gardaient autant de parties
// qu'elles en demandaient. La même valeur borne les parties privées en cours où une même identité siège, qu'elle les ait créées ou
// rejointes par code (cf. checkSeatedPrivateGames) : sans elle, le relais « A crée, B complète, A quitte » n'était borné nulle part,
// B n'étant créateur d'aucune. Défaut TOUJOURS actif (même politique que codePerIp) — `null` explicite désactive les deux bornes
const DEFAULT_PRIVATE_GAMES_PER_CREATOR = 5

/** un ticket d'un groupe de la file en cours d'appariement, avec le siège qu'il a pris (cf. openMatch) */
interface SeatedTicket { ticket: MjsWsClient; player: MjsServerSeat }

/** le refus SYNCHRONE d'un ticket (hooks.onJoin a levé) : le ticket et l'erreur levée (cf. openMatch) */
interface TicketRefusal { ticket: MjsWsClient; err: unknown }

export interface MjsServerMatchmaking {
  /** cf. index.ts — composé avec opts.onDisconnect (MJS-WS), jamais appelé pour un client jamais assis nulle part */
  onClientDisconnect(client: MjsWsClient): void
  /** cf. index.ts — app.stop() commence : tout coup reçu ensuite est refusé (la rafale finale de sauvegarde ne le contiendrait pas) */
  refuseMoves(): void
  /** cf. index.ts — app.stop() : coupe tous les setTimeout vivants (aucun ne doit survivre à l'arrêt) */
  destroyAll(): void
  /** persist.ts (boot, AVANT le vrai listen) — restaure UNE partie depuis un instantané dans les
   *  registres parties/codes ; `false` si `données.type` n'est déclaré par AUCUN app.game() (log
   *  côté appelant, entrée ignorée, jamais un throw qui bloquerait tout le boot pour une seule
   *  partie orpheline). Id restauré JAMAIS réattribué ensuite (cf. generateGameId plus bas). */
  restoreGameFromSnapshot(data: MjsServerGameSnapshot): boolean
}

/** Câble les 4 handlers `µgame:*` sur `baseServe` (jamais `app.serve` lui-même — déjà gardé par
 *  index.ts contre le préfixe réservé au moment où ce module tourne) et possède les registres.
 *  `baseOn` — MÊME esprit que `baseServe`, pour µgame:hash : fire-and-forget (PAS
 *  d'ack, cf. mjs-ws/core.ts routeAppMessage — un message SANS id n'invoque jamais un handler serve(),
 *  seulement les abonnés on()), cf. handlerHash plus bas.
 *  `persist` — `null` si `opts.persist` absent, cf. persist.ts pour le contrat.
 *  `gameStats` (anti-triche) — compteurs APP-ENTIÈRE créés par index.ts::mjsServer(), rattachés
 *  à CHAQUE partie ci-dessous (MÊME patron que `persist?.armGame`) : jamais `null` en usage réel
 *  (seul le défaut sert les tests qui appellent createMatchmaking directement sans passer par mjsServer()).
 *  `movesPerIdentity` (anti-triche) — cf. MjsServerAntiCheatOptions.movesPerIdentity
 *  (index.ts, déjà validée [n, fenêtreMs] à cet appel) : `null` = option absente, AUCUN contrôle
 *  (défaut, MÊME politique que persist/gameStats ci-dessus pour les tests directs).
 *  `codePerIp` — [capacité, fenêtreMs] pour le verrou anti-brute-force sur les
 *  tentatives de join par CODE échouées (cf. codeFailures plus bas) ; défaut TOUJOURS actif
 *  (DEFAULT_CODE_PAR_IP_*, contrairement à movesPerIdentity qui est opt-in) — `null` explicite pour
 *  désactiver. index.ts n'expose PAS encore d'option publique pour le repasser (hors périmètre).
 *  `privateGamesPerCreator` — cf. DEFAULT_PRIVATE_GAMES_PER_CREATOR (opts.antiCheat.privateGamesPerCreator, déjà validée par index.ts) */
export function createMatchmaking(app: MjsWsApp, gameDefs: Map<string, MjsServerResolvedDef>, baseServe: MjsWsApp['serve'], baseOn: MjsWsApp['on'], persist: MjsServerPersistEngine | null = null, gameStats: MjsServerGameStats | null = null, movesPerIdentity: [number, number] | null = null, codePerIp: [number, number] | null = [DEFAULT_CODE_PAR_IP_CAPACITY, DEFAULT_CODE_PAR_IP_WINDOW_MS], queueCap: number | null = DEFAULT_QUEUE_CAP, privateGamesPerCreator: number | null = DEFAULT_PRIVATE_GAMES_PER_CREATOR): MjsServerMatchmaking {
  const queues     = new Map<string, MjsWsClient[]>()     // type → tickets FIFO
  // reverse index — retrait O(1) sur déconnexion ; SINGULIER par construction (une connexion n'est
  // JAMAIS dans deux files à la fois, cf. playQueued) — s'inscrire pour un NOUVEAU type retire
  // d'abord le ticket d'un type précédent, sinon la déconnexion (onClientDisconnect plus bas) ne
  // nettoierait QUE la DERNIÈRE file : le ticket de la première resterait indéfiniment, prêt à
  // apparier un futur joueur avec une connexion déjà morte (siège fantôme signalé `connected: true`)
  const queuedType = new Map<MjsWsClient, string>()
  // idempotence de file (anti-triche) — type → Set des IDENTITÉS (peerIdOf) déjà
  // en file pour ce type : empêche un spam de µgame:play (même connexion qui rejoue, OU 2e onglet
  // de la MÊME identité) de pousser plusieurs tickets — cf. matchmaking.ts:130-152
  // (file.push SANS idempotence → N tickets → N sièges fantômes → partie jamais vidée). Nettoyé
  // aux DEUX points de sortie de la file (appariement ET déconnexion, cf. plus bas) — jamais laissé
  // traîner. Indépendant de `queuedType` ci-dessus (celui-ci reste keyé par CONNEXION, pour le
  // retrait O(1) du tableau `queues` lui-même — inchangé).
  const queuedIdentities = new Map<string, Set<string>>()
  // index inverse — les parties où une CONNEXION a pris place (siège ou regard) et celles où une IDENTITÉ est assise, par type : la
  // déconnexion et le rejeu de µgame:play ne balaient plus toutes les parties vivantes (O(parties) à chaque appel). Indice, jamais
  // vérité : chaque usage revérifie la partie (toujours au registre, connexion ou identité encore là), une entrée périmée (départ,
  // refus, siège vidé par l'appli) est donc sans effet ; une partie qui sort du registre emporte toutes ses entrées (cf. GameRegistry)
  const gamesOfConnection = new Map<MjsWsClient, Set<Game>>()
  const gamesOfIdentity   = new Map<string, Set<Game>>()   // clé : identityKey(type, identité)
  const indexEntries      = new Map<Game, { connections: Set<MjsWsClient>; identities: Set<string> }>()
  // une connexion ne tient qu'UNE partie privée en attente à la fois : la dernière qu'elle a créée (cf. createWithCode)
  const waitingPrivate = new Map<MjsWsClient, Game>()
  // parties privées par créateur (cf. creatorKeyOf, privateGamesPerCreator) — une partie détruite en sort (cf. GameRegistry), une
  // partie finie, ou que son créateur a quittée, est écartée au prochain compte ; `seat` = l'identité de siège du créateur (peerIdOf)
  const privateGamesOf = new Map<string, Set<Game>>()
  const creatorOf      = new Map<Game, { key: string; seat: string }>()
  // registre des parties annoncées (id → partie) — tient l'index inverse à chaque entrée et sortie, quel que soit le chemin : partie
  // par code, groupe de la file (sièges déjà posés), partie restaurée au démarrage (sièges restaurés), destruction (onGameDestroyed)
  class GameRegistry extends Map<string, Game> {
    set(id: string, game: Game): this {
      super.set(id, game)
      indexSeats(game)
      return this
    }

    delete(id: string): boolean {
      const game = super.get(id)
      if (game) { unindexGame(game); forgetCreator(game) }
      return super.delete(id)
    }
  }
  const games    = new GameRegistry()
  const codes      = new Map<string, string>()             // code → id de partie
  // parties de la file en cours d'appariement (muettes, cf. openMatch) : hors de `games` tant qu'elles ne sont pas annoncées, donc hors
  // de portée d'un µgame:resync/move/leave et d'un rejeu de µgame:play (cf. findGameOfIdentity) ; destroyAll les détruit aussi
  const matching   = new Set<Game>()
  // anti-triche — quota de coups PAR IDENTITÉ agrégé sur TOUTES les parties vivantes (cf.
  // movesPerIdentity plus haut) : SEUL endroit qui voit toutes les parties (cf. tête de fichier) —
  // un seau à jetons (TokenBucket) PAR IDENTITÉ, jamais par partie : TOUTES les parties d'une même
  // identité PARTAGENT LE MÊME bucket (Map keyée SEULEMENT par id), c'est précisément ce qui borne
  // le farm multi-parties. Attaché à CHAQUE partie via `game._identityQuota` (MÊME patron que
  // `_gameStats`, cf. create()/restoreGameFromSnapshot plus bas) ; vide et jamais consultée si
  // `movesPerIdentity` est `null` (coût nul, cf. identityQuotaOk).
  // RÉTENTION (corrigé) — le bucket d'une identité NE SE RÉINITIALISE JAMAIS sur
  // un simple leave/rejoin (cf. l'ancien nettoyerQuotaIdentiteSiVide, qui le SUPPRIMAIT dès le siège
  // vide — un rejoin recréait alors un bucket PLEIN, reset gratuit du quota agrégé). Purge désormais
  // UNIQUEMENT par TTL = fenêtreMs (movesPerIdentity[1]) depuis le dernier `take()` — cf.
  // purgeExpiredIdentityQuotas plus bas pour la justification (passé ce délai le seau est de toute
  // façon GARANTI plein, purger et recréer à la demande est donc STRICTEMENT équivalent à le garder).
  // `lastSeen` = date du dernier take(), Map ré-insérée en fin d'accès (ordre = ancienneté) — MÊME
  // patron que accounts.ts::FailureBucket::_touch, réutilisé en esprit ici (structure interne différente,
  // le bucket doit rester attaché à `game._identityQuota` via la closure identityQuotaOk).
  const identityQuotas = new Map<string, { bucket: TokenBucket; lastSeen: number }>()
  // anti-brute-force code de partie privée (cf. tête de fichier) — PAR IP,
  // FailureBucket (accounts.ts) réutilisée telle quelle : `isBlocked` AVANT toute résolution de code
  // (cf. checkCodeLockout), `recordCodeFailure` SEULEMENT sur code inexistant — jamais sur 'partie
  // complète' (code réel, pas une tentative de deviner) ni
  // sur un code invalide/format (déjà refusé bon marché par handlerPlay, avant d'arriver ici). `null`
  // si `codePerIp` désactivé (coût nul).
  const codeFailures = codePerIp ? new FailureBucket(codePerIp[0], codePerIp[1]) : null
  // amorcé à l'heure du démarrage (ms), +1 par partie : jamais l'id d'une partie d'un démarrage précédent, même quand sa sauvegarde
  // n'a pas été restaurée (load() en échec, type de jeu retiré, instantané invalide) — reparti de 0, il rendait game1 à la 1re partie
  // neuve, qui écrasait la sauvegarde de la veille puis l'effaçait à sa fin. Relevé ensuite par tout id lu au chargement (reserveGameId)
  let _gameCounter = Date.now()
  // true PENDANT app.stop() (destroyAll) — cf. onGameDestroyed : détruire pour un ARRÊT SERVEUR
  // ne doit JAMAIS effacer la partie du stockage persistant (elle doit revivre au prochain boot via
  // persist.ts load()), contrairement à une VRAIE fin de partie (end/emptyTtl/annulation de sièges)
  let stopping = false
  // true dès le début de app.stop() (refuseMoves, avant la rafale finale de sauvegarde) : un coup reçu ensuite est refusé, sans quoi
  // il était acquitté puis perdu au redémarrage
  let refusingMoves = false

  function generateGameId(): string { return 'game' + (++_gameCounter) }

  /** un id `game<n>` lu au chargement, partie restaurée ou non, n'est jamais réattribué ensuite (même sous une horloge qui a reculé
   *  depuis le démarrage précédent). Un instantané d'AVANT l'anglicisation porte `partie<n>` (pas encore passé par
   *  migrate-games-fr-to-en) : volontairement PAS lu ici — espace de noms disjoint de `game<n>`, aucune collision possible */
  function reserveGameId(id: unknown): void {
    const m = typeof id === 'string' ? /^game(\d+)$/.exec(id) : null
    // 15 chiffres au plus (le compteur en a 13) : un id démesuré (sauvegarde illisible) poussait le compteur au-delà de 2^53, où `++`
    // ne bouge plus — toutes les parties neuves recevaient le même id. Le compteur ne peut de toute façon pas rendre un tel id
    if (m && m[1].length <= 15) _gameCounter = Math.max(_gameCounter, Number(m[1]))
  }

  /** create() + armGame() persistance — SEUL point d'entrée pour une partie FRAÎCHE
   *  (les 3 call-sites ci-dessous), symétrique de restoreGameFromSnapshot pour une partie
   *  RESTAURÉE : les deux chemins arment la MÊME couture, jamais deux logiques qui divergent. */
  function create(def: MjsServerResolvedDef): Game {
    const game = createGame(app, def, onGameDestroyed, generateGameId())
    game._gameStats = gameStats
    // anti-triche — `null` si movesPerIdentity absent (cf. tête de fichier) : game.ts
    // court-circuite alors la garde entièrement (if (this._identityQuota && ...)), coût nul.
    if (movesPerIdentity) game._identityQuota = identityQuotaOk
    persist?.armGame(game)
    return game
  }

  function generateCode(): string {
    let code: string
    do {
      code = ''
      // tirage cryptographique : le code sert de contrôle d'accès (rejoindre, regarder), la suite de Math.random se devine
      for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)]
    } while (codes.has(code))
    return code
  }

  function onGameDestroyed(game: Game): void {
    games.delete(game.id)
    if (game.code) codes.delete(game.code)
    // cf. `stopping` ci-dessus — un arrêt serveur détruit les parties vivantes (timers coupés)
    // SANS jamais les effacer du stockage persistant, seule une VRAIE fin de partie le fait
    if (!stopping) persist?.forgetGame(game.id)
    // anti-triche — la destruction d'une partie est un point d'activité naturel pour
    // borner `identityQuotas` (cf. purgeExpiredIdentityQuotas plus bas) ; PLUS d'occupation de
    // siège consultée ici (cf. tête de fichier « RÉTENTION ») — un bucket
    // ne dépend plus de la présence en siège, seulement du TTL.
    if (movesPerIdentity) purgeExpiredIdentityQuotas(Date.now())
  }

  // --- anti-triche (quota de coups par identité, cf. identityQuotas/movesPerIdentity
  // plus haut) — seau à jetons PAR IDENTITÉ, PARTAGÉ entre toutes ses parties vivantes -----------

  const QUOTA_IDENTITY_SWEEP_MAX = 8   // borne le coût d'un passage — MÊME patron que accounts.ts::ECHEC_SWEEP_MAX

  function identityQuotaOk(id: string): boolean {
    if (!movesPerIdentity) return true
    const now = Date.now()
    purgeExpiredIdentityQuotas(now)
    let entry = identityQuotas.get(id)
    if (entry) identityQuotas.delete(id)   // ré-insère en fin ci-dessous — ordre = ancienneté de dernier accès
    else entry = { bucket: new TokenBucket(movesPerIdentity[0], movesPerIdentity[0] / (movesPerIdentity[1] / 1000)), lastSeen: now }
    entry.lastSeen = now
    identityQuotas.set(id, entry)
    return entry.bucket.take()
  }

  /** purge les buckets INACTIFS depuis plus de `movesPerIdentity[1]` (fenêtreMs) — cf. « RÉTENTION »
   *  en tête de fichier pour la justification complète : passé ce délai sans `take()`, le TokenBucket
   *  est GARANTI plein (refill continu borné à sa capacité) donc le purger puis le recréer à la
   *  demande (cf. identityQuotaOk) est STRICTEMENT équivalent à le garder — zéro perte de rigueur du
   *  quota, zéro fuite mémoire (une identité qui ne rejoue plus jamais finit purgée). PLUS aucune
   *  dépendance à l'occupation de siège (contrairement à l'ancien nettoyerQuotaIdentiteSiVide,
   *  remplacé) : un leave/rejoin, quelle que soit la partie visée, ne touche
   *  JAMAIS `lastSeen`. Balayage borné (`QUOTA_IDENTITY_SWEEP_MAX`) sur une Map ordonnée par
   *  ancienneté d'accès (ré-insertion dans identityQuotaOk) — s'arrête au premier bucket encore
   *  valide, MÊME patron que accounts.ts::FailureBucket::_touch. No-op si l'option est absente. */
  function purgeExpiredIdentityQuotas(now: number): void {
    if (!movesPerIdentity) return
    const ttl = movesPerIdentity[1]
    let evicted = 0
    for (const [id, entry] of identityQuotas) {
      if (now - entry.lastSeen <= ttl) break
      identityQuotas.delete(id)
      if (++evicted >= QUOTA_IDENTITY_SWEEP_MAX) break
    }
  }

  // --- idempotence de file (anti-triche, cf. queuedIdentities plus haut) -------

  function isQueued(type: string, id: string): boolean {
    return queuedIdentities.get(type)?.has(id) ?? false
  }

  function enqueue(type: string, id: string): void {
    let s = queuedIdentities.get(type)
    if (!s) { s = new Set(); queuedIdentities.set(type, s) }
    s.add(id)
  }

  function dequeue(type: string, id: string): void {
    queuedIdentities.get(type)?.delete(id)
  }

  // --- index inverse (cf. gamesOfConnection/gamesOfIdentity plus haut) --------------------------

  function identityKey(type: string, id: string): string { return type + '\n' + id }

  function indexEntry(game: Game): { connections: Set<MjsWsClient>; identities: Set<string> } {
    let entry = indexEntries.get(game)
    if (!entry) { entry = { connections: new Set(), identities: new Set() }; indexEntries.set(game, entry) }
    return entry
  }

  /** retient que `client` prend place dans `game` (siège ou regard) — posé AVANT l'opération : si elle échoue, l'entrée reste
   *  périmée, sans effet (cf. onClientDisconnect, qui revérifie) */
  function indexConnection(game: Game, client: MjsWsClient): void {
    let joined = gamesOfConnection.get(client)
    if (!joined) { joined = new Set(); gamesOfConnection.set(client, joined) }
    joined.add(game)
    indexEntry(game).connections.add(client)
  }

  /** retient que l'identité `id` est (ou va être) assise dans `game` — même règle que indexConnection (cf. findGameOfIdentity) */
  function indexIdentity(game: Game, id: string): void {
    const key = identityKey(game.type, id)
    let seatedIn = gamesOfIdentity.get(key)
    if (!seatedIn) { seatedIn = new Set(); gamesOfIdentity.set(key, seatedIn) }
    seatedIn.add(game)
    indexEntry(game).identities.add(key)
  }

  /** une partie entre au registre : ses sièges déjà posés (groupe de la file, partie restaurée), identités et connexions */
  function indexSeats(game: Game): void {
    for (const player of game.players) {
      if (!player) continue
      indexIdentity(game, player.id)
      for (const client of player.clients) indexConnection(game, client)
    }
  }

  /** une partie sort du registre (détruite) : toutes ses entrées d'index partent avec elle, sa place de partie privée en attente aussi */
  function unindexGame(game: Game): void {
    const entry = indexEntries.get(game)
    if (!entry) return
    indexEntries.delete(game)
    for (const client of entry.connections) {
      const joined = gamesOfConnection.get(client)
      if (joined) { joined.delete(game); if (joined.size === 0) gamesOfConnection.delete(client) }
      if (waitingPrivate.get(client) === game) waitingPrivate.delete(client)
    }
    for (const key of entry.identities) {
      const seatedIn = gamesOfIdentity.get(key)
      if (seatedIn) { seatedIn.delete(game); if (seatedIn.size === 0) gamesOfIdentity.delete(key) }
    }
  }

  /** la partie VIVANTE (au registre) de CE type où cette IDENTITÉ (peerIdOf) occupe déjà un siège, trouvée par l'index inverse sans
   *  visiter les autres parties ; une entrée périmée rencontrée (identité plus assise, partie sortie du registre) est retirée au
   *  passage. Une partie FINIE (grâce `endTtl`) est ignorée : le joueur qui relance la file après la fin y est remis, au lieu de
   *  retrouver une partie où tous ses coups sont refusés (« partie terminée »).
   *  Scopé par TYPE (jamais cross-type) : une même identité PEUT légitimement occuper un siège
   *  dans plusieurs parties de types DIFFÉRENTS (v1 ne l'empêche pas, cf. onClientDisconnect) —
   *  seule la dédup INTRA-type est visée ici. Utilisé par playQueued pour réattacher un 2e
   *  onglet/spam de µgame:play À LA PARTIE où il est déjà assis plutôt que de créer un 2e ticket
   *  (qui, via la dédup de game.ts::_createSeat, finirait de toute façon par réattacher — ceci
   *  évite juste de repasser par une file/un appariement pour rien). */
  function findGameOfIdentity(type: string, id: string): Game | null {
    const key = identityKey(type, id)
    const seatedIn = gamesOfIdentity.get(key)
    if (!seatedIn) return null
    let found: Game | null = null
    for (const game of seatedIn) {
      if (games.get(game.id) !== game || !game.players.some(j => j !== null && j.id === id)) {
        seatedIn.delete(game)
        indexEntries.get(game)?.identities.delete(key)
      }
      else if (!found && !game._ended) found = game
    }
    if (seatedIn.size === 0) gamesOfIdentity.delete(key)
    return found
  }

  // `game._infoMode(player)` porte `{view}` (authoritative) OU `{seed, journal}`
  // (lockstep, cf. game.ts) : SEUL endroit qui varie entre les deux modes, spread tel quel.
  function seatResponse(game: Game, player: MjsServerSeat): unknown {
    return { game: game.id, seat: player.seat, ...game._infoMode(player), phase: game.phase, turn: game.turn, seq: game.seq, code: game.code }
  }

  /** µgame:start poussé à un siège NON appelant direct — l'appelant direct reçoit l'équivalent via sa propre réponse */
  function pushStart(game: Game, player: MjsServerSeat): void {
    const frame = { game: game.id, seat: player.seat, ...game._infoMode(player), phase: game.phase, turn: game.turn, seq: game.seq, code: game.code }
    for (const client of player.clients) app.send(client, 'µgame:start', frame)
  }

  /** 1re fois que `seats` est atteint → µgame:start à tous les AUTRES sièges déjà occupés (jamais deux fois) */
  function markStartedIfFull(game: Game, directPlayer: MjsServerSeat | null): void {
    if (game._started) return
    const full = game.players.filter((j): j is MjsServerSeat => j !== null).length === game.def.seats
    if (!full) return
    game._started = true
    for (const autre of game.players) { if (autre && autre !== directPlayer) pushStart(game, autre) }
  }

  // --- code : créer / rejoindre ----------------------------------------------------------------

  /** la réponse d'un siège admis dans une partie par code : µgame:start aux autres sièges si les places sont complètes, puis le siège.
   *  Une partie déjà finie à ce moment (hooks.onJoin de l'entrant a appelé .end()) : son µgame:end est parti avant cette réponse, que
   *  le client de l'entrant, qui ne connaissait pas encore la partie, a ignoré — il lui est renvoyé, à lui seul, un tour de boucle
   *  après sa réponse (même raison que game.ts::_announce pour la file) */
  function seatedResponse(game: Game, player: MjsServerSeat, client: MjsWsClient): unknown {
    markStartedIfFull(game, player)
    resendEnd(game, client)
    return seatResponse(game, player)
  }

  /** une partie déjà finie quand une connexion y prend place (siège, 2e demande d'une connexion déjà assise, regard de spectateur) :
   *  son µgame:end lui est renvoyé, à elle seule, un tour de boucle après sa réponse — avant, son client ne connaît pas la partie */
  function resendEnd(game: Game, client: MjsWsClient): void {
    if (game._ended) setImmediate(() => app.send(client, 'µgame:end', { game: game.id, result: game._endResult }))
  }

  /** pose le siège de `client` dans une partie par code (créateur ou invité) et répond. Quand hooks.onJoin rend une Promise, la demande
   *  lui laisse un tour de la boucle d'événements (setImmediate) avant de répondre, sans l'attendre davantage : un rejet déjà connu à ce
   *  moment (le crochet n'a rien attendu du dehors) est un refus synchrone — le siège est défait sans trace, la demande échoue — ; un
   *  rejet plus tardif refuse le joueur APRÈS sa réponse (game.ts::_refuseSeat), jamais avant : le client ne connaît pas encore la
   *  partie, la fin lui échapperait et sa poignée resterait assise sur un siège libéré. Le siège n'est annoncé (roster, µgame:start
   *  aux autres) qu'une fois ce premier verdict rendu : un refus synchrone ne laisse aucune trace chez les autres joueurs. */
  function takeSeat(game: Game, client: MjsWsClient): unknown {
    const admissions: Array<Promise<MjsServerSeat | null>> = []
    indexConnection(game, client)
    indexIdentity(game, peerIdOf(client))
    const player = game._createSeat(client, admissions)
    if (admissions.length === 0) return seatedResponse(game, player, client)
    const verdict = { waiting: true, refused: null as MjsServerSeat | null }
    admissions[0].then(seat => {
      if (seat === null) return
      if (verdict.waiting) verdict.refused = seat
      else game._refuseSeat(seat)
    })
    return Promise.race([admissions[0], new Promise<void>(resolve => setImmediate(resolve))]).then(() => {
      verdict.waiting = false
      if (game._destroyed) throw new Error(t('serveur.matchmaking-partie-introuvable'))
      if (verdict.refused) {
        if (verdict.refused.clients.size > 1) game._refuseSeat(verdict.refused)   // un autre onglet de la même identité s'est rattaché pendant l'attente et a sa réponse : refus après coup, pour tous
        else game._dropSeat(verdict.refused)
        throw new Error(t('serveur.matchmaking-entree-refusee'))
      }
      game._seatAdmitted()
      return seatedResponse(game, player, client)
    })
  }

  /** crée une partie privée et y assoit son créateur. Une connexion ne tient qu'UNE partie privée en attente à la fois : la précédente
   *  qu'elle a créée, si ses places n'ont jamais été toutes prises (`_started` faux) et si cette connexion y siège encore, est fermée —
   *  µgame:end { cancelled: true, reason: 'replaced' } à ses sièges, partie détruite, code oublié —, quel que soit son type de jeu. Une
   *  partie complétée une fois est une vraie partie : jamais fermée ainsi ; une table que son créateur a quittée non plus (d'autres
   *  joueurs y attendent peut-être). La précédente n'est fermée qu'une fois la nouvelle créée (un hooks.onCreate qui lève la laisse
   *  intacte). Au-delà, un même créateur (cf. creatorKeyOf) ne garde que `privateGamesPerCreator` parties privées en cours où il siège
   *  encore, connecté ou non (complétées ou non, tous types, toutes connexions) : la demande suivante est refusée, la partie remplacée
   *  ne comptant pas ; une partie qu'il a quittée ne compte plus, même si d'autres y restent. Son identité ne siège pas non plus dans
   *  plus de `privateGamesPerCreator` parties privées en cours, créées ou rejointes (cf. checkSeatedPrivateGames). Sans ces bornes, un
   *  jeu à une place, ou deux connexions qui se relaient, créaient autant de parties vivantes qu'ils envoyaient de demandes et
   *  pouvaient épuiser la mémoire du serveur ; une table vide qu'ils quittent est fermée tout de suite (cf. game.ts::_afterDeparture) */
  function createWithCode(def: MjsServerResolvedDef, client: MjsWsClient): unknown {
    const previous = waitingPrivate.get(client)
    const replaced = previous && replaceable(previous, client) ? previous : null
    const creator  = creatorKeyOf(client)
    if (privateGamesPerCreator !== null) {
      const live = livePrivateGamesOf(creator)
      if (live.size - (replaced && live.has(replaced) ? 1 : 0) >= privateGamesPerCreator) throw new Error(t('serveur.matchmaking-parties-privees-limite', { max: privateGamesPerCreator }))
      checkSeatedPrivateGames(peerIdOf(client), replaced)
    }
    const game = create(def)
    if (replaced && replaceable(replaced, client)) replaced._cancel('replaced')
    game.code = generateCode()
    codes.set(game.code, game.id)
    games.set(game.id, game)
    waitingPrivate.set(client, game)
    trackCreator(creator, peerIdOf(client), game)
    return takeSeat(game, client)
  }

  /** la partie privée en attente de cette connexion peut-elle être remplacée : toujours au registre, jamais complète, pas finie, et la
   *  connexion y siège encore */
  function replaceable(game: Game, client: MjsWsClient): boolean {
    return games.get(game.id) === game && !game._started && !game._ended && game._findSeatOf(client) !== null
  }

  /** le créateur compté par privateGamesPerCreator : son identité ; un anonyme, son adresse (sa connexion quand le transport n'en
   *  donne pas, ex. MemoryTransport) — préfixes distincts, une identité ne se confond jamais avec une adresse */
  function creatorKeyOf(client: MjsWsClient): string {
    const id = peerIdOf(client)
    if (id !== 'anon:' + client.id || client.meta.address === undefined) return 'id:' + id
    return 'ip:' + client.meta.address
  }

  function trackCreator(creator: string, seat: string, game: Game): void {
    let created = privateGamesOf.get(creator)
    if (!created) { created = new Set(); privateGamesOf.set(creator, created) }
    created.add(game)
    creatorOf.set(game, { key: creator, seat })
  }

  /** une partie sort du registre : elle ne compte plus pour son créateur */
  function forgetCreator(game: Game): void {
    const creator = creatorOf.get(game)
    if (creator === undefined) return
    creatorOf.delete(game)
    const created = privateGamesOf.get(creator.key)
    if (created) { created.delete(game); if (created.size === 0) privateGamesOf.delete(creator.key) }
  }

  /** les parties privées en cours de ce créateur où il siège encore (au registre, pas finies, son siège occupé, connecté ou non) — une
   *  partie finie (grâce `endTtl`) n'y est plus, une partie qu'il a quittée non plus, même si d'autres joueurs y restent */
  function livePrivateGamesOf(creator: string): Set<Game> {
    const live = new Set<Game>()
    for (const game of privateGamesOf.get(creator) ?? []) {
      const seat = creatorOf.get(game)?.seat
      if (games.get(game.id) === game && !game._ended && game.players.some(j => j !== null && j.id === seat)) live.add(game)
    }
    return live
  }

  /** les parties privées en cours où cette identité (peerIdOf) siège, créateur ou invité (au registre, pas finies, son siège occupé,
   *  connecté ou non), tous types confondus — trouvées par l'index inverse, sans visiter les autres parties */
  function seatedPrivateGamesOf(id: string): Set<Game> {
    const seated = new Set<Game>()
    for (const type of gameDefs.keys()) {
      for (const game of gamesOfIdentity.get(identityKey(type, id)) ?? []) {
        if (game.code && games.get(game.id) === game && !game._ended && game.players.some(j => j !== null && j.id === id)) seated.add(game)
      }
    }
    return seated
  }

  /** une place de plus dans une partie privée (création, entrée par code) est refusée à l'identité qui siège déjà dans
   *  `privateGamesPerCreator` parties privées en cours, qu'elle les ait créées ou rejointes ; `freed` = la partie en attente que la
   *  demande remplace (elle ne compte pas). Sans elle, deux connexions qui se relaient (A crée, B complète, A quitte) gardaient vivantes
   *  autant de parties qu'elles en demandaient : la borne des créateurs ne compte que les parties où le créateur siège encore */
  function checkSeatedPrivateGames(id: string, freed: Game | null): void {
    if (privateGamesPerCreator === null) return
    const seated = seatedPrivateGamesOf(id)
    if (seated.size - (freed && seated.has(freed) ? 1 : 0) >= privateGamesPerCreator) throw new Error(t('serveur.matchmaking-parties-privees-siege-limite', { max: privateGamesPerCreator }))
  }

  // anti-brute-force code (cf. codeFailures plus haut) — `ipOf` MÊME fonction que
  // accounts.ts::ipDe (copiée, pas importée : un paquet n'a pas à dépendre d'un autre pour un
  // one-liner, MÊME raison que accounts.ts a copié bridge.ts::createBridgeRateLimiter en tête de
  // fichier). `undefined` (transport qui n'expose pas l'IP, ex. MemoryTransport en test) retombe sur
  // UNE clé 'unknown' partagée — PAS le même choix que core.ts::maxConnectionsPerIp (qui EXEMPTE les
  // IP inconnues), volontairement : ici mieux vaut un faux-partage bénin (IP inconnues limitées
  // ENSEMBLE) qu'un verrou totalement inopérant derrière un proxy qui ne transmet jamais l'IP.
  function ipOf(client: MjsWsClient): string { return client.meta.address ?? 'unknown' }

  /** refuse IMMÉDIATEMENT (avant toute résolution de code) si cette IP est déjà en pénalité — MÊME
   *  message qu'un rejet ordinaire du module (throw new Error), rien de spécifique côté client. */
  function checkCodeLockout(client: MjsWsClient): void {
    if (!codeFailures) return
    if (codeFailures.isBlocked(ipOf(client))) throw new Error(t('serveur.matchmaking-trop-tentatives-code'))
  }

  /** à appeler UNIQUEMENT sur code INEXISTANT (cf. call-sites) — jamais sur 'partie complète' (code
   *  RÉEL, pas une tentative de deviner) ni sur un format déjà refusé bon marché par handlerPlay.
   *  Retourne `true` = encore DANS le budget (reste 'code inconnu' normal) ; `false` = CET appel
   *  vient de faire déborder le seau — reclassement IMMÉDIAT de la réponse EN COURS en lockout,
   *  MÊME contrat/raison que accounts.ts::FailureBucket::recordFailure (cf. son commentaire) : sans
   *  ce reclassement, la tentative qui déclenche le verrou recevrait encore 'code inconnu', et
   *  seule la SUIVANTE verrait le lockout (cf. checkCodeLockout, qui ne s'applique qu'AVANT
   *  résolution) — décalage d'un cran par rapport au seuil configuré (`codePerIp[0]`). */
  function recordCodeFailure(client: MjsWsClient): boolean {
    return codeFailures ? codeFailures.recordFailure(ipOf(client)) : true
  }

  function joinWithCode(def: MjsServerResolvedDef, client: MjsWsClient, code: string): unknown {
    checkCodeLockout(client)
    const gameId = codes.get(code)
    const game = gameId !== undefined ? games.get(gameId) : undefined
    // le TYPE demandé doit correspondre à celui de la partie visée par ce code — sinon une requête
    // { type: 'B', code: codeDeA } rejoindrait intégralement la partie A (vue/état RÉELS de A
    // renvoyés à une requête B). MÊME message que 'code inconnu' (pas une forme d'erreur à part) :
    // ne révèle jamais qu'un code existe pour un AUTRE type
    if (!game || game.type !== def.type) throw new Error(recordCodeFailure(client) ? t('serveur.matchmaking-code-inconnu', { code: code }) : t('serveur.matchmaking-trop-tentatives-code'))
    const alreadySeated = game._findSeatOf(client)
    if (alreadySeated) {   // même connexion qui rejoue play (composant remonté) : idempotent, la fin comprise
      resendEnd(game, client)
      return seatResponse(game, alreadySeated)
    }
    // une autre connexion de la même identité, déjà assise, s'y rattache (cf. game.ts::_createSeat) : aucune place de plus à borner
    const id = peerIdOf(client)
    if (!game.players.some(j => j !== null && j.id === id)) checkSeatedPrivateGames(id, null)
    return takeSeat(game, client)   // throw 'partie complète' si déjà pleine — PAS un échec de code, non comptabilisé
  }

  // --- file d'attente publique --------------------------------------------------------------

  // v1 — seatTtl couvre UNIQUEMENT les sièges issus de la file (le
  // fondateur d'une partie par code est confirmé par sa propre requête, rien à surveiller tant
  // qu'il reste connecté ; un fondateur qui repart sans jamais recevoir personne voit sa table
  // fermée tout de suite, cf. game.ts::_afterDeparture). À l'expiration : la partie ENTIÈRE est annulée (pas de re-complétion depuis la
  // file) — le plus simple des deux choix envisagés, documenté ici.
  function playQueued(def: MjsServerResolvedDef, client: MjsWsClient): unknown {
    // idempotence (anti-triche) — CETTE identité (peerIdOf, cf. game.ts) est
    // déjà en file OU déjà assise dans une partie VIVANTE et non finie de ce type : ignore/réattache plutôt que
    // de pousser un 2e ticket (cf. matchmaking.ts:130-152 — un spam de µgame:play
    // prenait autant de tickets que d'appels, jusqu'à des sièges fantômes qui ne vident jamais la
    // partie). Déjà en file → réponse IDENTIQUE à celle du 1er ticket (même {queue}, aucun 2e
    // push) ; déjà assise → réattache CETTE connexion au siège existant (_createSeat dédup en
    // interne, cf. game.ts) et renvoie sa réponse de siège, comme si elle rejouait play() après
    // coup — jamais un 2e siège, jamais une 2e partie.
    const id = peerIdOf(client)
    if (isQueued(def.type, id)) return { queue: (queues.get(def.type) ?? []).length }
    const existingGame = findGameOfIdentity(def.type, id)
    if (existingGame) {
      indexConnection(existingGame, client)
      const player = existingGame._createSeat(client)
      return seatResponse(existingGame, player)
    }

    // queuedType est SINGULIER par conception (cf. sa déclaration) — s'inscrire dans une NOUVELLE
    // file retire d'abord le ticket d'une file PRÉCÉDENTE pour cette MÊME connexion
    const previousType = queuedType.get(client)
    if (previousType !== undefined && previousType !== def.type) {
      dequeue(previousType, id)
      const previousQueue = queues.get(previousType)
      if (previousQueue) { const i = previousQueue.indexOf(client); if (i !== -1) previousQueue.splice(i, 1) }
    }

    let queue = queues.get(def.type)
    if (!queue) { queue = []; queues.set(def.type, queue) }
    // plafond — refuse le ticket AVANT de le pousser, jamais une file qui
    // grossit sans borne (queueCap null = plafond désactivé, cf. tête de fichier)
    if (queueCap !== null && queue.length >= queueCap) throw new Error(t('serveur.matchmaking-file-pleine', { type: def.type }))
    queue.push(client)
    queuedType.set(client, def.type)
    enqueue(def.type, id)
    if (queue.length < def.seats) return { queue: queue.length }
    return drainQueue(def, client)
  }

  // Un groupe complet est apparié en deux temps. La partie naît MUETTE (rien n'en part vers les joueurs), tous les tickets prennent
  // siège et passent par hooks.onJoin — une Promise rendue est attendue —, PUIS SEULEMENT la partie est annoncée (µgame:start aux
  // tickets qui attendaient, réponse à la requête qui a complété le groupe). Un ticket refusé, par un throw ou par une Promise
  // rejetée, défait l'appariement sans bruit : la partie disparaît, les autres tickets retournent EN TÊTE de la file, dans leur
  // ordre, et y attendent un autre adversaire sans rien avoir reçu. Le refusé est averti une seule fois : par µgame:end « entrée
  // refusée » (game.ts::_sendJoinRefused, qui y met le type de jeu et `queue: true` : le client en tire la poignée en file à qui la
  // donner), ou par l'erreur de sa requête µgame:play quand c'est lui le dernier arrivé (sa requête
  // est encore en cours : l'erreur de onJoin si elle est synchrone, « entrée refusée » si le refus vient d'une Promise — le message
  // d'une Promise rejetée reste dans le journal du serveur). Tant que le groupe est en suspens, ses tickets restent marqués en file
  // (queuedType, queuedIdentities) : un µgame:play de plus de leur part est l'idempotence habituelle, pas un 2e ticket.

  /** retire un ticket de la file : ses marques de connexion et d'identité (le tableau `queues` n'est pas touché) — seulement celles que
   *  CE ticket détient encore pour ce type. Une connexion fermée pendant l'attente a déjà rendu les siennes (onClientDisconnect) et la
   *  marque d'identité est peut-être celle de sa nouvelle connexion ; une connexion passée dans la file d'un autre type y garde la sienne */
  function forget(def: MjsServerResolvedDef, ticket: MjsWsClient): void {
    if (queuedType.get(ticket) !== def.type) return
    queuedType.delete(ticket)
    dequeue(def.type, peerIdOf(ticket))
  }

  /** remet des tickets d'un groupe défait EN TÊTE de la file de leur type, dans leur ordre. Un ticket qui n'est plus marqué en file
   *  pour ce type (sa connexion s'est fermée pendant l'attente, ou est partie dans la file d'un autre type) n'est pas remis ; un
   *  ticket déjà présent dans le tableau (sa connexion a rejoué entre-temps) non plus. */
  function requeue(def: MjsServerResolvedDef, tickets: MjsWsClient[]): void {
    const queue = queues.get(def.type) ?? []
    queues.set(def.type, queue)
    queue.unshift(...tickets.filter(ticket => queuedType.get(ticket) === def.type && !queue.includes(ticket)))
  }

  /** position (à partir de 1) d'une connexion dans la file de ce type, 0 si elle n'y est pas */
  function positionOf(def: MjsServerResolvedDef, ticket: MjsWsClient): number {
    return (queues.get(def.type) ?? []).indexOf(ticket) + 1
  }

  /** forme les groupes complets de la file de ce type, un par un, dans l'ordre d'arrivée. `caller` = la connexion dont la requête
   *  µgame:play est en cours (`null` pour une reprise en arrière-plan) : sa réponse est celle de son groupe (son siège, l'erreur de
   *  son refus, ou sa position quand son groupe est défait), à défaut sa position dans la file. Un groupe défait remet ses
   *  survivants en tête : la boucle les reprend si la file contient déjà un groupe complet (des joueurs arrivés pendant l'attente
   *  d'un onJoin). Un hooks.onCreate qui lève arrête la boucle : les tickets sortis de la file reviennent en tête, sauf celui de
   *  l'appelant, qui reçoit l'erreur ; la prochaine arrivée relancera l'appariement. */
  function drainQueue(def: MjsServerResolvedDef, caller: MjsWsClient | null): unknown {
    const queue = queues.get(def.type)
    let answered = false
    let reply: unknown
    let failure: { err: unknown } | null = null
    while (queue && queue.length >= def.seats) {
      const group = queue.splice(0, def.seats)
      const mine  = caller !== null && group.includes(caller)
      let game: Game
      try {
        game = create(def)
      } catch (err) {
        requeue(def, group.filter(ticket => ticket !== caller))
        if (mine) { forget(def, caller!); failure = { err } }
        else def.log('error', t('serveur.matchmaking-appariement-echoue', { msg: errMessage(err) }))
        break
      }
      try {
        const outcome = openMatch(def, game, group, mine ? caller : null)
        if (mine) { answered = true; reply = outcome }
        else if (outcome instanceof Promise) outcome.catch((err: unknown) => def.log('error', t('serveur.matchmaking-appariement-echoue', { msg: errMessage(err) })))
      } catch (err) {
        if (mine) failure = { err }   // le refus de l'appelant : seule exception que le règlement d'un groupe laisse remonter
        else def.log('error', t('serveur.matchmaking-appariement-echoue', { msg: errMessage(err) }))
      }
    }
    if (failure) throw failure.err
    if (answered) return reply
    return caller ? { queue: positionOf(def, caller) } : undefined
  }

  /** assoit tous les tickets du groupe dans `game` (muette) et leur fait passer hooks.onJoin ; règle ensuite le groupe (cf. settleMatch),
   *  tout de suite si aucun onJoin n'a rendu de Promise, sinon une fois toutes terminées (rend alors une Promise de la réponse). Un
   *  refus synchrone arrête l'assise des suivants : le groupe est défait sans attendre les Promises des tickets déjà assis. */
  function openMatch(def: MjsServerResolvedDef, game: Game, tickets: MjsWsClient[], caller: MjsWsClient | null): unknown {
    game._silent  = true
    game._started = true   // née complète par construction — jamais un 2e µgame:start pour elle
    matching.add(game)
    const seated: SeatedTicket[]                      = []
    const waits: Array<Promise<MjsServerSeat | null>> = []

    let refusal: TicketRefusal | null = null
    for (const ticket of tickets) {
      try {
        seated.push({ ticket, player: game._createSeat(ticket, waits) })
      } catch (err) {
        refusal = { ticket, err }
        break
      }
    }
    if (refusal || waits.length === 0) return settleMatch(def, game, tickets, caller, seated, refusal, [])
    return Promise.all(waits).then(refused => {
      try { return settleMatch(def, game, tickets, caller, seated, null, refused) }
      finally { drainQueue(def, null) }   // les survivants d'un groupe défait sont revenus en tête : un groupe complet a pu se former derrière eux
    })
  }

  /** décide du sort d'un groupe dont les onJoin ont tous passé : annoncé si personne n'est refusé et si toutes les connexions sont encore là
   *  (une fermée pendant l'attente n'a plus de marque de file, cf. onClientDisconnect), défait sinon. `refusal` = le refus synchrone
   *  (ticket et erreur), `refused` = les sièges dont la Promise de onJoin a rejeté (`null` pour ceux qui ont abouti) */
  function settleMatch(def: MjsServerResolvedDef, game: Game, tickets: MjsWsClient[], caller: MjsWsClient | null, seated: SeatedTicket[], refusal: TicketRefusal | null, refused: Array<MjsServerSeat | null>): unknown {
    matching.delete(game)
    if (game._destroyed) return undefined   // l'arrêt du serveur est passé pendant l'attente : rien à annoncer ni à remettre en file
    const refusedTickets = new Set<MjsWsClient>()
    if (refusal) refusedTickets.add(refusal.ticket)
    for (const seat of refused) {
      const entry = seat ? seated.find(e => e.player === seat) : undefined
      if (entry) refusedTickets.add(entry.ticket)
    }
    const everyoneHere = tickets.every(ticket => queuedType.get(ticket) === def.type)
    if (refusedTickets.size === 0 && everyoneHere) return startMatch(def, game, tickets, caller, seated)
    return undoMatch(def, game, tickets, caller, refusal, refusedTickets)
  }

  /** annonce un groupe complet et admis : la partie entre dans le registre et devient audible, les tickets qui attendaient reçoivent
   *  µgame:start (puis ont `seatTtl` pour se manifester), la requête de l'appelant reçoit son siège */
  function startMatch(def: MjsServerResolvedDef, game: Game, tickets: MjsWsClient[], caller: MjsWsClient | null, seated: SeatedTicket[]): unknown {
    games.set(game.id, game)
    for (const ticket of tickets) forget(def, ticket)
    game._announce()
    const unconfirmedIds: string[] = []
    let callerSeat: MjsServerSeat | null = null
    for (const { ticket, player } of seated) {
      if (ticket === caller) callerSeat = player
      else { unconfirmedIds.push(player.id); pushStart(game, player) }
    }
    game._armConfirmWindow(unconfirmedIds, def.seatTtl)
    return callerSeat ? seatResponse(game, callerSeat) : undefined
  }

  /** défait un groupe sans bruit : la partie est détruite (ni µgame:end, ni crochet de l'appli), les refusés sortent de la file et
   *  reçoivent leur fin « entrée refusée » (sauf l'appelant, dont la requête a l'erreur), les autres reviennent en tête de la file.
   *  Rend la réponse de l'appelant : sa position s'il attend toujours, sinon l'erreur de son refus est levée */
  function undoMatch(def: MjsServerResolvedDef, game: Game, tickets: MjsWsClient[], caller: MjsWsClient | null, refusal: TicketRefusal | null, refusedTickets: Set<MjsWsClient>): unknown {
    game._destroy()
    for (const ticket of refusedTickets) {
      forget(def, ticket)
      if (ticket !== caller) game._sendJoinRefused(ticket, true)
    }
    requeue(def, tickets.filter(ticket => !refusedTickets.has(ticket)))
    if (caller === null) return undefined
    if (refusal && refusal.ticket === caller) throw refusal.err
    if (refusedTickets.has(caller)) throw new Error(t('serveur.matchmaking-entree-refusee'))
    return { queue: positionOf(def, caller) }
  }

  // --- spectateurs (anti-triche, lecture seule) ------------------------------------

  /** rejoint une partie EXISTANTE comme spectateur — adressée PAR CODE, MÊME registre `codes` que
   *  joinWithCode : aucune ambiguïté possible (contrairement à la file publique, où plusieurs
   *  parties du MÊME type peuvent être vivantes en parallèle — rien n'identifierait LAQUELLE
   *  regarder). N'occupe AUCUN siège (cf. game._addSpectator) — jamais de _createSeat,
   *  jamais de markStartedIfFull. `seat: null` EXPLICITE (jamais `undefined`) — MÊME
   *  invariant que côté client (store.seat = null tant que jamais assis, cf. mjs_game.ts).
   *  MÊME garde de TYPE que joinWithCode (cf. son commentaire) : `def` (résolu depuis `p.type` par
   *  handlerPlay) doit correspondre au type RÉEL de la partie visée par ce code. */
  function joinAsSpectator(def: MjsServerResolvedDef, client: MjsWsClient, code: string): unknown {
    checkCodeLockout(client)   // MÊME verrou anti-brute-force que joinWithCode — même registre `codes`, même risque de devinette
    const gameId = codes.get(code)
    const game = gameId !== undefined ? games.get(gameId) : undefined
    if (!game || game.type !== def.type) throw new Error(recordCodeFailure(client) ? t('serveur.matchmaking-code-inconnu', { code: code }) : t('serveur.matchmaking-trop-tentatives-code'))
    indexConnection(game, client)
    const info = game._addSpectator(client)
    resendEnd(game, client)
    return { game: game.id, seat: null, spectator: true, phase: game.phase, turn: game.turn, seq: game.seq, code: game.code, ...info }
  }

  // --- les 4 handlers µgame:* --------------------------------------------------------------

  function handlerPlay(p: any, client: MjsWsClient): unknown {
    if (typeof p?.type !== 'string') throw new Error(t('serveur.matchmaking-play-type-manquant'))
    const def = gameDefs.get(p.type)
    if (!def) throw new Error(t('serveur.matchmaking-type-jeu-inconnu', { type: p.type }))
    // anti-triche — drapeau spectateur SUR µgame:play (jamais une trame séparée : réutilise
    // l'ack/le rejeu-après-coupure déjà câblés côté client, cf. mjs_game.ts).
    // Adressage PAR CODE UNIQUEMENT (cf. joinAsSpectator) : une file publique peut avoir
    // PLUSIEURS parties du même type vivantes en parallèle, rien n'identifierait laquelle regarder.
    if (p.spectator !== undefined && p.spectator !== true) throw new Error(t('serveur.matchmaking-spectateur-doit-etre-bool'))
    if (p.spectator === true) {
      if (!def.code) throw new Error(t('serveur.matchmaking-spectateur-sans-code-prive', { type: p.type }))
      if (typeof p.code !== 'string' || p.code === '') throw new Error(t('serveur.matchmaking-spectateur-code-requis'))
      return joinAsSpectator(def, client, p.code)
    }
    if (p.code === true) {
      if (!def.code) throw new Error(t('serveur.matchmaking-jeu-sans-parties-privees', { type: p.type }))
      return createWithCode(def, client)
    }
    if (typeof p.code === 'string') {
      if (p.code === '') throw new Error(t('serveur.matchmaking-code-invalide'))
      if (!def.code) throw new Error(t('serveur.matchmaking-jeu-sans-parties-privees', { type: p.type }))
      return joinWithCode(def, client, p.code)
    }
    if (p.code !== undefined) throw new Error(t('serveur.matchmaking-code-invalide'))
    return playQueued(def, client)
  }

  // coups async : `await` fait remonter une éventuelle rejection au try/catch de
  // routeAppMessage (mjs-ws/core.ts — log + µ:ack{e:true,p:errMessage(err)}) ; SANS lui, un move
  // async n'était JAMAIS attendu ici, donc un rejet ultérieur devenait orphelin (jamais loggué ni
  // renvoyé). Corrige aussi un bug de VALEUR : un move async RÉUSSI renvoyait `{}` (Promise
  // sérialisée telle quelle) au lieu de sa vraie valeur de résolution. AUCUN nouveau format
  // d'erreur — celui déjà utilisé par tout throw synchrone.
  async function handlerMove(p: any, client: MjsWsClient): Promise<unknown> {
    if (typeof p?.game !== 'string') throw new Error(t('serveur.matchmaking-move-partie-manquante'))
    if (typeof p?.move !== 'string') throw new Error(t('serveur.matchmaking-move-coup-manquant'))
    const game = games.get(p.game)
    if (!game) throw new Error(t('serveur.matchmaking-partie-introuvable'))
    if (refusingMoves) throw new Error(t('serveur.matchmaking-arret-en-cours'))
    return { ok: true, result: await game._onMove(client, p.move, p.p) }
  }

  function handlerLeave(p: any, client: MjsWsClient): unknown {
    // sans `game`, avec `type` : le joueur quitte la file publique avant d'être apparié — son ticket part (le suivant
    // n'est pas apparié avec un fantôme) ; rien à faire s'il n'y est plus (apparié entre-temps, ou jamais entré)
    if (p?.game === undefined && typeof p?.type === 'string') {
      if (queuedType.get(client) === p.type) {
        queuedType.delete(client)
        dequeue(p.type, peerIdOf(client))
        const queue = queues.get(p.type)
        if (queue) { const i = queue.indexOf(client); if (i !== -1) queue.splice(i, 1) }
      }
      return { ok: true }
    }
    if (typeof p?.game !== 'string') throw new Error(t('serveur.matchmaking-leave-partie-manquante'))
    const game = games.get(p.game)
    if (!game) throw new Error(t('serveur.matchmaking-partie-introuvable'))
    game._leave(client)   // gère aussi bien un siège qu'un spectateur, cf. son commentaire
    // anti-triche — le quota de CETTE identité n'est JAMAIS réinitialisé par ce leave (cf.
    // « RÉTENTION » en tête de fichier) : simple point d'activité pour borner
    // `identityQuotas` par TTL, rien de plus.
    if (movesPerIdentity) purgeExpiredIdentityQuotas(Date.now())
    return { ok: true }
  }

  function handlerResync(p: any, client: MjsWsClient): unknown {
    if (typeof p?.game !== 'string') throw new Error(t('serveur.matchmaking-resync-partie-manquante'))
    const game = games.get(p.game)
    if (!game) throw new Error(t('serveur.matchmaking-partie-introuvable'))
    indexConnection(game, client)
    const { seat, info } = game._resync(client)
    return { game: game.id, seat, ...info, phase: game.phase, turn: game.turn, seq: game.seq, code: game.code }
  }

  // µgame:hash — fire-and-forget (PAS d'ack, cf. commentaire de createMatchmaking) :
  // trame malformée ou partie/joueur introuvable → silencieusement ignorée (best-effort, jamais un
  // throw qui n'aurait de toute façon personne à qui le remonter).
  function handlerHash(p: any, client: MjsWsClient): void {
    // tick NON ENTIER rejeté ICI aussi (garde redondante avec lockstep.ts::receiveHash — défense
    // en profondeur) : sans elle, des ticks fractionnaires (i*0.001…) contourneraient le plafond
    // d'entrées retenues par tick
    if (typeof p?.game !== 'string' || typeof p?.tick !== 'number' || !Number.isInteger(p.tick) || typeof p?.h !== 'string') return
    const game = games.get(p.game)
    game?._receiveHash(client, p.tick, p.h)
  }

  baseServe('µgame:play', handlerPlay)
  baseServe('µgame:move', handlerMove)
  baseServe('µgame:leave', handlerLeave)
  baseServe('µgame:resync', handlerResync)
  baseOn('µgame:hash', handlerHash)

  return {
    onClientDisconnect(client: MjsWsClient): void {
      // file d'attente — retire le ticket s'il y est encore (hygiène : garantit qu'un siège
      // issu de la file n'est JAMAIS attribué à une connexion déjà morte, cf. seatTtl au-dessus)
      const type = queuedType.get(client)
      if (type !== undefined) {
        queuedType.delete(client)
        dequeue(type, peerIdOf(client))
        const queue = queues.get(type)
        if (queue) { const i = queue.indexOf(client); if (i !== -1) queue.splice(i, 1) }
      }
      // un même client PEUT occuper un siège dans plusieurs parties (types différents, v1 ne l'empêche pas) — seules celles où il a
      // pris place sont visitées (index inverse, cf. indexConnection), chacune revérifiée : une partie sortie du registre est ignorée,
      // et _onDisconnect ne fait rien là où la connexion n'est plus (départ, refus)
      const joined = gamesOfConnection.get(client)
      if (joined) {
        gamesOfConnection.delete(client)
        for (const game of joined) {
          indexEntries.get(game)?.connections.delete(client)
          if (games.get(game.id) === game) game._onDisconnect(client)
        }
      }
      waitingPrivate.delete(client)
      // anti-triche — le siège reste OCCUPÉ après une déconnexion (v1, pas de kick auto,
      // cf. _onDisconnect) ; le quota de cette identité n'y est PLUS lié
      // (cf. « RÉTENTION » en tête de fichier) — simple point d'activité pour la purge par TTL.
      if (movesPerIdentity) purgeExpiredIdentityQuotas(Date.now())
    },

    refuseMoves(): void {
      refusingMoves = true
    },

    destroyAll(): void {
      stopping = true
      for (const game of Array.from(games.values())) game._destroy()
      for (const game of Array.from(matching)) game._destroy()   // groupes de la file en cours d'appariement : leurs minuteries ne survivent pas à l'arrêt non plus
      matching.clear()
    },

    restoreGameFromSnapshot(data: MjsServerGameSnapshot): boolean {
      // AVANT tout refus (type retiré, doublon, instantané invalide) : la sauvegarde reste dans le stockage, son id ne doit pas resservir
      reserveGameId(data?.id)
      const def = gameDefs.get(data.type)
      if (!def) return false
      // deux sauvegardes du même id (copie dans le dossier de stockage, back qui rend un doublon) : la 1re restaurée reste, la suivante est
      // refusée (avertissement de loadAtBoot) — restaurée aussi, l'orpheline, détruite à sa grâce, retirait la partie vivante du registre
      // et effaçait sa sauvegarde
      if (games.has(data.id)) throw new Error(t('serveur.persist-restauration-doublon', { id: data.id }))
      const game = restoreGame(app, def, onGameDestroyed, data)
      game._gameStats = gameStats
      if (movesPerIdentity) game._identityQuota = identityQuotaOk
      games.set(game.id, game)
      if (game.code) codes.set(game.code, game.id)
      persist?.armGame(game)
      return true
    },
  }
}
