// mjs-server/persist — brique OPTIONNELLE de persistance par bdd au choix : ZÉRO dépendance,
// interfaçage par simple duck-typing (« au choix » = n'importe quel
// objet qui expose les 4 fonctions ci-dessous marche, mémoire/fichier/pont HTTP fournis ici, Redis/SQL
// à venir SANS toucher cette façade). La persistance DURE reste chez l'appli hôte quand elle
// passe par le pont (persist-bridge.ts pousse, ne stocke jamais lui-même).
//
// CONTRAT (duck-typing STRICT — seules ces 3 fonctions sont vérifiées, `flush` et `writeTimeoutMs` sont optionnels) :
//   load()             → Promise<{id, données}[]>  — lu UNE FOIS au boot, avant que le serveur
//                         n'accepte la moindre connexion (cf. index.ts, app.listen())
//   save(id, données)  → void | Promise<void>       — écrit/remplace l'entrée `id` (`données` =
//                         partie.serialize(), cf. game.ts) — jamais attendu par la partie
//   remove(id)         → void | Promise<void>       — supprime l'entrée `id`, no-op si absente
//   promesse rendue = fin de l'écriture : le moteur s'y enchaîne (une écriture en vol par partie, cf.
//   « sérialisation par id ») — les adaptateurs fournis la rendent tous ; `void` = aucune attente
//   sans réponse dans WRITE_TIMEOUT_MS (30 s, ou le délai que l'adaptateur déclare + 1 s, cf. writeTimeoutMs),
//   une écriture est ABANDONNÉE : un warn nomme la partie, et la sauvegarde de la partie continue sans l'attendre ;
//   si elle finit par répondre APRÈS une écriture plus récente qui avait abouti, elle a pu la remplacer dans le
//   stockage : l'état courant de la partie est réécrit (cf. lateArrival)
//   flush()?           → void | Promise<void>       — vidange/synchronisation finale, appelée par
//                         app.stop() APRÈS la rafale de sauvegardes en attente ; sans réponse dans
//                         WRITE_TIMEOUT_MS (30 s, ou le délai de l'adaptateur + 1 s), un warn le dit et l'arrêt continue sans l'attendre
//   writeTimeoutMs?    → number (ms)                — délai global d'UNE écriture, si l'adaptateur a le sien (le pont :
//                         son totalTimeoutMs) : le moteur l'attend aussi, plus une seconde de marge pour que l'adaptateur
//                         abandonne le premier ; absent, nul, négatif ou non fini → 30 s
//
// ENCODAGE — `données` devient du TEXTE par encodeSnapshot()/decodeSnapshot() (ci-dessous), JAMAIS
// par une colonne typée du moteur : la règle et sa raison à la section « encodage du snapshot ».
//
// CÂBLAGE (mjsServer(opts), cf. index.ts) — `opts.persist` accepte soit un adaptateur NU (défauts
// appliqués), soit `{ adaptateur, debounce?, snapshotEvery? }` (validation stricte façon
// resolveGameDef, clé inconnue → suggestion). ABSENT = AUCUN hook armé, zéro coût (pas une Map, pas
// un timer créés) — cf. createPersistEngine, qui retourne `null` tout de suite dans ce cas.
//
// DÉBOUNCE (défaut 150 ms) — chaque mutation DIFFUSÉE d'une partie (cf. game.ts _broadcastState,
// hook `_onMutate`) réarme un setTimeout par partie : N mutations rapprochées → 1 seul save(), celui
// qui capture l'état APRÈS la dernière. `snapshotEvery` (défaut 0 = désactivé) est le PLANCHER : sous
// mutation CONTINUE (chaque coup réarme le débounce avant qu'il n'expire), un débounce pur ne sauve
// JAMAIS — snapshotEvery force un save des parties encore sales à intervalle fixe, garantissant une
// borne supérieure de fraîcheur même dans ce cas.
// plafond du débounce, actif même sans snapshotEvery : une partie sale est sauvée au plus tard
// MAX_WAIT_DEBOUNCES débounces après sa 1re mutation non sauvée (partie d'action : la boucle de tick
// signale une mutation toutes les 100 ms, sous les 150 ms par défaut, et n'était jamais sauvée)
//
// CYCLE DE VIE — matchmaking.ts est le SEUL appelant (ownership des Game, cf. son commentaire de
// tête) : armGame() posée après CHAQUE create()/restauration, forgetGame() posée dans
// onGameDestroyed() SAUF pendant app.stop() (détruire pour un arrêt serveur ne doit PAS effacer la
// partie du stockage — elle doit revivre au prochain boot via load(), cf. matchmaking.ts `stopping`).
// app.stop() (index.ts) : stop() = rafale finale des débounces en attente PUIS flush() adaptateur.
//
//   import { mjsServer, MemoryPersistAdapter } from 'modularjs-framework/mjs-server'
//   app = mjsServer({ persist: { adaptateur: new MemoryPersistAdapter(), debounce: 150 } })

import type { MjsWsLogFn } from '../mjs-ws/index.js'
import type { Game, MjsServerGameSnapshot } from './game.js'
import { t } from '../messages/index.js'
import { keyUnknown } from './util.js'

// --- le contrat -------------------------------------------------------------------------------

export interface MjsServerPersistAdapter {
  load(): Promise<Array<{ id: string; data: MjsServerGameSnapshot }>>
  save(id: string, data: MjsServerGameSnapshot): void | Promise<void>
  remove(id: string): void | Promise<void>
  flush?(): void | Promise<void>
  /** ms — délai global d'UNE écriture, si l'adaptateur a le sien (le pont : totalTimeoutMs) ; le moteur l'attend aussi, plus
   *  une seconde de marge, pour une écriture comme pour flush() ; absent ou inutilisable (≤ 0, non fini) → 30 s */
  writeTimeoutMs?: number
}

export interface MjsServerPersistOptions {
  adapter: MjsServerPersistAdapter
  /** ms — regroupe les saves rapprochés d'UNE MÊME partie, défaut 150 ; sous mutation continue,
   *  sauvée quand même au plus tard 10 débounces après la 1re mutation non sauvée */
  debounce?: number
  /** ms — plancher périodique (parties encore sales), défaut 0 = désactivé (débounce pur) */
  snapshotEvery?: number
}

/** `opts.persist` accepte l'adaptateur NU ou la forme objet avec réglages — cf. resolvePersistOption */
export type MjsServerPersistOption = MjsServerPersistAdapter | MjsServerPersistOptions

export interface MjsServerResolvedPersist {
  adapter: MjsServerPersistAdapter
  debounce: number
  snapshotEvery: number
}

export const DEFAULT_PERSIST_DEBOUNCE = 150
// plafond de la sauvegarde différée, en débounces (150 ms par défaut → sauvée au plus tard 1,5 s après
// sa 1re mutation non sauvée) — une mutation isolée part toujours au bout d'UN débounce
const MAX_WAIT_DEBOUNCES = 10
// délai maximum d'UNE écriture (save ou remove) sans réponse de l'adaptateur, en ms — 30 s, soit le délai global PAR DÉFAUT du
// pont (persist-bridge.ts), qui le règle avec totalTimeoutMs : un adaptateur qui a son propre délai le déclare (writeTimeoutMs)
// et le moteur le suit (cf. writeDelay) ; sans lui, une écriture qui ne répond jamais (requête SQL
// restée pendante, Redis muet) gelait pour toujours les sauvegardes de sa partie — chaque écriture
// attend la précédente — et le remove() d'une partie finie ne partait jamais. Borne aussi le flush() final
// de l'arrêt (cf. stop()), et les adaptateurs la reprennent pour le leur : exportée, un seul délai
export const WRITE_TIMEOUT_MS = 30000
// marge ajoutée au délai que déclare un adaptateur : il abandonne le premier (un pont réglé à 30 s rend sa main, échec dit, avant que
// le moteur ne tranche), le moteur ne coupe qu'une écriture qu'aucune borne de l'adaptateur n'a su finir
const WRITE_GRACE_MS = 1000
// plus grand délai qu'une minuterie accepte (2^31 - 1 ms, environ 24,8 jours) — au-delà Node la ramène à 1 ms
const MAX_TIMER_MS = 2147483647

/** délai d'une écriture pour cet adaptateur : le sien (writeTimeoutMs) plus la marge, sinon WRITE_TIMEOUT_MS — jamais une valeur
 *  que setTimeout lirait mal (nulle, négative, NaN, infinie, du texte) */
function writeDelay(adapter: MjsServerPersistAdapter): number {
  const own = adapter.writeTimeoutMs
  if (typeof own !== 'number' || !Number.isFinite(own) || own <= 0) return WRITE_TIMEOUT_MS
  return Math.min(own + WRITE_GRACE_MS, MAX_TIMER_MS)
}

// --- les écritures en vol d'un adaptateur — ce que flush() attend à l'arrêt ----------------------
// Chacune n'est suivie que WRITE_TIMEOUT_MS depuis son départ : c'est le moment où le moteur abandonne une écriture sans réponse et
// repart avec la suivante. Garder pour toujours la promesse abandonnée retenait une promesse de plus à chaque tentative sous une
// panne muette (une par délai et par partie, 120 par heure et par partie). Passé le délai, l'écriture est LÂCHÉE : elle peut toujours
// aboutir plus tard (le moteur rattrape alors son arrivée, cf. lateArrival), mais ni la liste ni flush() ne l'attendent plus, et
// flush() la compte parmi celles restées sans réponse. La minuterie est retirée dès la réponse, jamais laissée armée derrière une
// écriture qui a répondu ; jamais unref() : flush() attend ces minuteries, et une minuterie qui ne retient pas le process le
// laisserait sortir avant la fin de l'arrêt (rien d'autre ne retient un process dont l'écriture ne répond jamais)

export class PendingWrites {
  private _tracked = new Set<Promise<boolean>>()

  /** écritures suivies en ce moment (celles de moins de WRITE_TIMEOUT_MS qui n'ont pas répondu) */
  get size(): number { return this._tracked.size }

  /** suit `write` : elle sort de la liste dès qu'elle répond (réussie ou non), ou lâchée au bout de WRITE_TIMEOUT_MS sans réponse */
  track(write: Promise<unknown>): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const followed = new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), WRITE_TIMEOUT_MS)
      const answered = () => { clearTimeout(timer); resolve(true) }
      write.then(answered, answered)
    })
    this._tracked.add(followed)
    void followed.then(() => { this._tracked.delete(followed) })
  }

  /** attend les écritures suivies, au plus WRITE_TIMEOUT_MS depuis le départ de chacune — rend combien sont restées sans réponse */
  async settle(): Promise<number> {
    const outcomes = await Promise.all(Array.from(this._tracked))
    return outcomes.filter(answered => !answered).length
  }
}

// --- encodage du snapshot — LE point de passage texte de TOUS les adaptateurs ------------------
// RÈGLE : un adaptateur écrit du TEXTE et encode LUI-MÊME — jamais une colonne typée du moteur
// (`JSON` MySQL, `JSONB` Postgres…). Un type délégué au moteur se lit différemment selon le
// moteur : le MÊME schéma a rendu du Hash sous MySQL et de la String sous MariaDB (leçon
// vécue — `t.json` = alias LONGTEXT côté MariaDB). Texte + encodage explicite =
// indépendant du moteur, donc infaillible. C'est aussi pourquoi le DDL de persist-sql.ts déclare une
// colonne texte (`data TEXT`, LONGTEXT sous MySQL/MariaDB pour sa taille) et pourquoi `dialect` ne sert qu'à la syntaxe des
// paramètres bind et à cette taille, jamais au typage.
// Les 3 adaptateurs de stockage (sql/redis/file) passent par cette paire — un cas particulier à
// traiter un jour (valeur cyclique, Date, très gros payload) se traite ICI, une fois, pour les
// trois. persist-bridge.ts n'en est pas : il n'encode pas un état mais une ENVELOPPE HTTP
// ({op, id, data}), et c'est le back qui stocke.

/** état sérialisé d'une partie → texte, la forme stockée par TOUS les adaptateurs */
export function encodeSnapshot(data: MjsServerGameSnapshot): string {
  return JSON.stringify(data)
}

/** texte relu (colonne SQL, champ de hash Redis, fichier) → état de partie. THROW si illisible :
 *  l'appelant journalise et saute l'entrée, jamais un crash de boot (cf. load() des adaptateurs) */
export function decodeSnapshot(raw: unknown): MjsServerGameSnapshot {
  return JSON.parse(String(raw)) as MjsServerGameSnapshot
}

const KNOWN_PERSIST_KEYS = new Set(['adapter', 'debounce', 'snapshotEvery'])

// duck-typing STRICT (cf. commentaire de tête) — MÊME principe que isAdapterInstance de
// mjs-ws/index.ts : la présence des 3 fonctions suffit à trancher, jamais d'instanceof (isAnAdapter)
function isAnAdapter(x: unknown): x is MjsServerPersistAdapter {
  const a = x as Record<string, unknown> | null | undefined
  return !!a && typeof a === 'object'
    && typeof a.load === 'function' && typeof a.save === 'function' && typeof a.remove === 'function'
}

/** Résout `opts.persist` — `undefined`/`null`/`false` → `null` (désactivé, AUCUN hook armé côté
 *  index.ts). Validation STRICTE de la forme objet (clé inconnue → suggestion), MÊME patron que
 *  resolveGameDef (game.ts) : throw immédiat, jamais un défaut silencieux sur une clé mal typée. */
export function resolvePersistOption(raw: MjsServerPersistOption | undefined | null | false): MjsServerResolvedPersist | null {
  if (!raw) return null
  const prefix = '[MJS-Server] opts.persist'
  if (isAnAdapter(raw)) return { adapter: raw, debounce: DEFAULT_PERSIST_DEBOUNCE, snapshotEvery: 0 }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(t('serveur.persist-option-invalide', { prefix: prefix, received: JSON.stringify(raw) }))
  }
  for (const k of Object.keys(raw)) if (!KNOWN_PERSIST_KEYS.has(k)) throw keyUnknown(prefix, k, KNOWN_PERSIST_KEYS)
  if (!isAnAdapter(raw.adapter)) {
    throw new Error(t('serveur.persist-adaptateur-invalide', { prefix: prefix, received: JSON.stringify(raw.adapter) }))
  }
  if (raw.debounce !== undefined && (typeof raw.debounce !== 'number' || !Number.isFinite(raw.debounce) || raw.debounce < 0)) {
    throw new Error(t('serveur.persist-debounce-invalide', { prefix: prefix, received: JSON.stringify(raw.debounce) }))
  }
  if (raw.snapshotEvery !== undefined && (typeof raw.snapshotEvery !== 'number' || !Number.isFinite(raw.snapshotEvery) || raw.snapshotEvery < 0)) {
    throw new Error(t('serveur.persist-snapshotevery-invalide', { prefix: prefix, received: JSON.stringify(raw.snapshotEvery) }))
  }
  return {
    adapter:    raw.adapter,
    debounce:      raw.debounce ?? DEFAULT_PERSIST_DEBOUNCE,
    snapshotEvery: raw.snapshotEvery ?? 0,
  }
}

// --- adaptateur mémoire — référence minimale, sert aussi de fixture de test -------------------

export class MemoryPersistAdapter implements MjsServerPersistAdapter {
  private _store = new Map<string, MjsServerGameSnapshot>()

  async load(): Promise<Array<{ id: string; data: MjsServerGameSnapshot }>> {
    return Array.from(this._store.entries()).map(([id, data]) => ({ id, data }))
  }

  save(id: string, data: MjsServerGameSnapshot): void { this._store.set(id, data) }
  remove(id: string): void { this._store.delete(id) }
  flush(): void {}
}

// --- le moteur — débounce par partie + plancher périodique + boot/arrêt -----------------------
// SEUL appelant : matchmaking.ts (ownership des Game, cf. son commentaire de tête) — ce fichier
// ne construit JAMAIS de Game lui-même (ni create() ni restoreGameFromSnapshot()), il ne connaît QUE
// serialize()/l'instance qu'on lui passe — le lookup de `def` par type (jeux.get) et la
// construction restent 100% dans matchmaking.ts (cf. index.ts pour le câblage app.listen()).

export interface MjsServerPersistEngine {
  /** posée sur CHAQUE partie vivante (fraîche OU restaurée) — arme le hook `_onMutate` */
  armGame(game: Game): void
  /** miroir — annule le débounce en attente puis adaptateur.remove(id), APRÈS toute sauvegarde déjà
   *  en vol (JAMAIS l'inverse : une sauvegarde tardive qui ressusciterait une entrée tout juste
   *  supprimée, cf. commentaire de tête ET « sérialisation par id » ci-dessous) */
  forgetGame(id: string): void
  /** AU BOOT (index.ts, app.listen(), AVANT le vrai listen) — `restore` = fourni par
   *  matchmaking.ts, construit la Game et retourne `false` si le type est inconnu (log ici) */
  loadAtBoot(restore: (data: MjsServerGameSnapshot) => boolean): Promise<void>
  /** app.stop() — rafale finale des débounces en attente, PUIS attend aussi toute sauvegarde déjà en
   *  vol (cf. « sérialisation par id ») et le remove() d'une partie finie juste avant ou pendant l'arrêt, PUIS flush() de
   *  l'adaptateur, attendu au plus WRITE_TIMEOUT_MS (ou le délai de l'adaptateur + 1 s) ; une fois lancé, plus aucune sauvegarde
   *  n'est programmée, et une écriture abandonnée qui répond n'en relance plus aucune, elle prévient */
  stop(): Promise<void>
}

// SÉRIALISATION PAR ID — `chain` accroche CHAQUE save/remove d'UNE partie à la suite du précédent,
// pour TOUS les adaptateurs (le souci n'est pas propre à un backend : un pool SQL, un fichier ou un
// pont HTTP peuvent tous finir deux écritures dans le désordre) : sans elle, deux runSave() du MÊME
// id peuvent partir en parallèle et compléter dans l'ordre INVERSE de leur lancement — l'état FINAL
// écrit devient alors l'ANCIEN, pas le dernier connu. `saveQueued` COALESCE : au plus UNE sauvegarde
// en attente derrière celle en vol (jamais un maillon par mutation), et comme runSave() relit
// `game.serialize()` PARESSEUSEMENT (au moment où le maillon s'exécute, pas à sa programmation), ce
// maillon unique porte toujours le DERNIER état connu. `forgetGame` remet `saveQueued` à `false`
// (annule la sauvegarde coalescée en attente, s'il y en a une) puis s'accroche lui-même en bout de
// chaîne — un remove ne part donc jamais AVANT une sauvegarde déjà en vol, et rien de sauvegardé
// APRÈS lui ne peut plus ressusciter l'entrée supprimée. Cet invariant tenait seulement PAR CHAÎNE,
// pas PAR ID : un armGame() du MÊME id juste après un forgetGame() (partie détruite puis recréée
// avant que son ancien remove/save en vol n'ait fini) repartait d'une chaîne NEUVE
// (Promise.resolve()), sans lien avec l'ancienne — le nouveau save pouvait alors terminer AVANT le
// vieux remove hérité de la vie précédente, qui effaçait ensuite la partie pourtant vivante.
// `tailChains` porte la chaîne résiduelle d'un id tout juste OUBLIÉ, tant qu'elle n'est pas éteinte :
// armGame() s'y raccroche si elle existe, pour que ses propres save/remove restent TOUJOURS après
// ceux de la vie précédente du même id.
// `dirtySince` : instant (horloge monotone, performance.now() — l'heure murale peut sauter, en avant
// comme en arrière) de la 1re mutation non sauvée, point de départ du plafond (cf. MAX_WAIT_DEBOUNCES)
// UNE SEULE ÉCRITURE EN VOL PAR PARTIE tient jusqu'au délai (WRITE_TIMEOUT_MS) : passé ce délai l'écriture est ABANDONNÉE, la suivante
// part, et l'abandonnée peut encore aboutir plus tard, par-dessus — c'est le rôle de `lastDone` : chaque écriture lancée reçoit un
// rang croissant (`stamp`), et `lastDone` retient le rang le plus élevé qui a abouti pour cette partie, à temps ou tard ; une
// écriture abandonnée qui répond alors que `lastDone` dépasse son rang a pu remplacer un état plus récent (cf. lateArrival)
// `life` : numéro de vie de l'entrée — un identifiant recréé (forgetGame puis armGame) en reçoit un neuf, ce qui distingue la sauvegarde tardive de l'ANCIENNE partie.
// `launched` : rang le plus élevé LANCÉ pour cette entrée (abouti ou non) — un stockage qui exécute dans le désordre a pu laisser une
// écriture abandonnée s'exécuter après une plus récente déjà partie, sans réponse encore. `correcting` : la prochaine sauvegarde lancée est une
// réécriture de rattrapage — la tardive d'une réécriture ne se rattrape que sur ce qui a ABOUTI après elle (jamais sur ce qui est seulement
// parti), faute de quoi les réécritures se relanceraient les unes les autres tant que le stockage est lent
interface Entry { game: Game; handle: ReturnType<typeof setTimeout> | null; dirty: boolean; dirtySince: number; chain: Promise<void>; saveQueued: boolean; lastDone: number; life: number; launched: number; correcting: boolean }

// DÉLAI MAXIMUM D'UNE ÉCRITURE — `write` en course contre `delay` (WRITE_TIMEOUT_MS, ou le délai de l'adaptateur, cf. writeDelay) :
// rend la main quand l'écriture finit ou, sans réponse à temps, après `onSilence()` (qui prévient) ; l'écriture est alors
// ABANDONNÉE — plus attendue, mais pas morte : sa réponse tardive, réussie ou non (on ne sait pas ce que le stockage a reçu), appelle
// `onLate()`, qui rattrape son arrivée (cf. lateArrival) — Promise.race écoute les deux côtés : le rejet tardif d'une écriture
// abandonnée n'est jamais un unhandledRejection (Node tue le process dessus), et une erreur de `onLate` (un onLog qui lève) non plus.
// La minuterie est retirée dès la course finie, jamais laissée armée derrière une écriture qui a répondu ; jamais unref() : stop()
// attend cette promesse, et une minuterie qui ne retient pas le process le laisserait sortir avant la fin de l'arrêt
// `Promise.resolve().then(write)` — PAS `Promise.resolve(write())` : ce dernier évalue write() pour
// CONSTRUIRE l'argument, AVANT que le .catch() de l'appelant ne soit posé — un throw SYNCHRONE de
// l'adaptateur traverse alors le filet tel quel (stop() rejette ; un appel par timer devient un
// uncaughtException, process tué). Ici le throw se produit DANS le callback .then(), donc DEVIENT un rejet
// de la promesse retournée, capté par le .catch() de l'appelant
// le flush() final de stop() passe par la même course : `write` est alors le flush() de l'adaptateur, abandonné de la même façon
// (SANS .catch() : un rejet de flush() remonte à stop() comme avant, la borne ne l'avale pas ; sans `onLate` : un flush() qui répond tard n'écrit rien)
function boundedWrite(write: () => void | Promise<void>, onSilence: () => void, delay: number, onLate?: () => void): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abandoned = false
  const silence = new Promise<void>(resolve => { timer = setTimeout(() => { abandoned = true; onSilence(); resolve() }, delay) })
  const done    = Promise.resolve().then(write)
  if (onLate) {
    const late = () => { if (abandoned) onLate() }
    done.then(late, late).catch(() => {})
  }
  return Promise.race([done, silence]).finally(() => clearTimeout(timer))
}

/** `resolved === null` (opts.persist absent) → retourne `null` tout de suite, AUCUNE Map ni timer
 *  créés — zéro coût, cf. commentaire de tête. */
export function createPersistEngine(resolved: MjsServerResolvedPersist | null, onLog: MjsWsLogFn): MjsServerPersistEngine | null {
  if (!resolved) return null
  const entries = new Map<string, Entry>()
  // chaîne résiduelle d'un id tout juste OUBLIÉ (forgetGame), tant que son save/remove hérité n'est
  // pas éteint — cf. commentaire de tête « SÉRIALISATION PAR ID ». Peuplée par forgetGame(),
  // consommée (et retirée) par armGame() ; nettoyée toute seule si jamais réclamée (pas de fuite).
  const tailChains = new Map<string, Promise<void>>()
  let snapshotTimer: ReturnType<typeof setInterval> | null = null
  // délai d'une écriture pour CET adaptateur (le sien s'il en déclare un, cf. writeDelay), et son écriture en secondes pour les warns
  const writeMs  = writeDelay(resolved.adapter)
  const writeSec = writeMs / 1000
  // rang de la prochaine écriture lancée (save ou remove, toutes parties) — comparé seulement entre écritures d'une même partie
  let stamp   = 0
  // numéro de la prochaine vie d'entrée (un par armGame)
  let lifeSeq = 0
  // vrai dès que stop() commence : plus aucune sauvegarde programmée (cf. scheduleSave), plus aucune réécriture (cf. lateArrival)
  let stopped = false

  // l'écriture passe par boundedWrite : un throw SYNCHRONE de l'adaptateur y devient un rejet, capté par le
  // .catch() d'ici ; une écriture sans réponse en writeMs est abandonnée (warn), la chaîne repart, et sa réponse tardive est rattrapée
  function runSave(e: Entry): Promise<void> {
    e.dirty = false
    e.saveQueued = true
    e.chain = e.chain.then(() => {
      if (!e.saveQueued) return undefined   // coalescé/annulé entre-temps (maillon déjà consommé, ou remove passé devant)
      e.saveQueued = false
      const id         = e.game.id
      const rank       = ++stamp
      const life       = e.life
      const correction = e.correcting
      e.correcting = false
      e.launched   = rank
      // `lastDone` note ce qui a ABOUTI (à temps ou tard) : la comparaison de lateArrival en dépend
      const save = () => Promise.resolve(resolved.adapter.save(id, e.game.serialize())).then(() => { if (rank > e.lastDone) e.lastDone = rank })
      return boundedWrite(save, () => { onLog('warn', t('serveur.persist-save-sans-reponse', { id: id, delai: writeSec })) }, writeMs, () => lateArrival(id, rank, 'save', life, correction))
        .catch(err => { onLog('warn', t('serveur.persist-save-echoue', { id: id }), { err: err instanceof Error ? err.message : String(err) }) })
    })
    return e.chain
  }

  // le remove passe lui aussi par boundedWrite, abandonné et rattrapé comme une sauvegarde
  function runRemove(id: string, life: number): Promise<void> {
    const rank = ++stamp
    return boundedWrite(() => resolved.adapter.remove(id), () => { onLog('warn', t('serveur.persist-remove-sans-reponse', { id: id, delai: writeSec })) }, writeMs, () => lateArrival(id, rank, 'remove', life, false))
      .catch(err => onLog('warn', t('serveur.persist-remove-echoue', { id: id }), { err: err instanceof Error ? err.message : String(err) }))
  }

  // remove(id) accroché derrière `after`, et publié comme suite de la chaîne de cet id pour un armGame() du MÊME id qui suivrait
  // avant qu'elle ne s'éteigne (partie recréée) — auto-nettoyage une fois éteinte, SAUF si un armGame() l'a déjà consommée
  // entre-temps (elle n'est alors plus la valeur courante de tailChains)
  function chainRemove(id: string, after: Promise<void>, life: number): Promise<void> {
    const suite = after.then(() => runRemove(id, life))
    tailChains.set(id, suite)
    void suite.finally(() => { if (tailChains.get(id) === suite) tailChains.delete(id) })
    return suite
  }

  // UNE ÉCRITURE ABANDONNÉE VIENT DE RÉPONDRE (`rank` : son rang, `life` : la vie de l'identifiant qui l'a lancée) — réussie ou non, on ne
  // sait pas ce que le stockage a reçu. Si une écriture plus récente de la même partie avait ABOUTI avant elle (`lastDone` dépasse `rank`),
  // ou seulement été LANCÉE (`launched` : un stockage peut exécuter dans le désordre, bien après le délai), elle a pu la remplacer : la
  // sauvegarde est reprogrammée avec l'état COURANT de la partie (relu à l'exécution, cf. runSave), pour que le stockage finisse toujours sur
  // le plus récent. Rien de plus récent n'avait été lancé (écriture seule) : ce qu'elle a écrit est le dernier état connu, aucune réécriture.
  // Aucune boucle de réécriture sous un stockage lent : la tardive d'une réécriture de rattrapage (`correction`) ne compte que ce qui a
  // ABOUTI après elle, pas ce qui est seulement parti — chaque écriture d'origine déclenche au plus une réécriture. Un identifiant recréé :
  // la sauvegarde tardive d'une AUTRE vie (`life` différente de celle de l'entrée vivante) a pu remettre l'ancienne ligne alors que la partie
  // vivante n'a encore rien écrit — l'état de la partie vivante est réécrit par-dessus.
  // Une sauvegarde déjà programmée (débounce, plafond, ou en attente derrière l'écriture en vol) part de toute façon APRÈS : pas de
  // doublon. Un id recréé : l'entrée vivante est la NOUVELLE vie, qu'un remove tardif de l'ancienne a pu effacer. Plus d'entrée
  // vivante (partie finie) : un remove tardif est conforme, mais une sauvegarde tardive a pu recréer la ligne après le remove, la
  // suppression est renvoyée (derrière la chaîne de l'id, comme tout remove). Après stop() : plus rien ne repart, l'arrêt prévient.
  // L'écriture repart AVANT l'avertissement : un journal qui lève ne la fait pas perdre
  function lateArrival(id: string, rank: number, kind: 'save' | 'remove', life: number, correction: boolean): void {
    const live = entries.get(id)
    if (!live) {
      if (kind === 'remove') return
      if (stopped) { onLog('warn', t('serveur.persist-ecriture-tardive-arret', { id: id })); return }
      chainRemove(id, tailChains.get(id) ?? Promise.resolve(), life)
      onLog('warn', t('serveur.persist-save-tardive-partie-finie', { id: id }))
      return
    }
    // dépassée : une écriture plus récente a abouti, ou (sauf pour une réécriture de rattrapage) seulement été lancée — un stockage peut les exécuter
    // dans le désordre. Fantôme : la sauvegarde d'une AUTRE vie de l'identifiant a pu remettre sa ligne alors que la partie vivante n'a rien écrit
    const exceeded = (correction ? live.lastDone : live.launched) > rank || live.lastDone > rank
    const ghost    = kind === 'save' && live.life !== life
    if (!exceeded && !ghost) return
    if (stopped) { onLog('warn', t('serveur.persist-ecriture-tardive-arret', { id: id })); return }
    if (live.dirty || live.saveQueued) return
    live.correcting = true
    void runSave(live)
    onLog('warn', t(kind === 'save' ? 'serveur.persist-save-tardive' : 'serveur.persist-remove-tardive', { id: id }))
  }

  function scheduleSave(game: Game): void {
    // arrêt commencé : une sauvegarde programmée maintenant partirait après flush(), avec l'état d'une partie déjà détruite
    // (minuteries vidées) à la place de celui de la rafale finale
    if (stopped) return
    const e = entries.get(game.id)
    if (!e) return   // partie non suivie — ne devrait pas arriver, armGame() couvre fraîche+restaurée
    // horloge monotone : l'heure murale (Date.now) saute sur une correction NTP ou une reprise de machine virtuelle
    const now = performance.now()
    if (!e.dirty) e.dirtySince = now
    e.dirty = true
    if (e.handle) clearTimeout(e.handle)
    // réarmé à chaque mutation, mais jamais au-delà du plafond compté depuis la 1re mutation non sauvée
    const delay = Math.min(resolved.debounce, Math.max(0, e.dirtySince + resolved.debounce * MAX_WAIT_DEBOUNCES - now))
    e.handle    = setTimeout(() => { e.handle = null; void runSave(e) }, delay)
  }

  if (resolved.snapshotEvery > 0) {
    snapshotTimer = setInterval(() => {
      for (const e of entries.values()) {
        if (!e.dirty) continue
        if (e.handle) { clearTimeout(e.handle); e.handle = null }
        void runSave(e)
      }
    }, resolved.snapshotEvery)
  }

  return {
    armGame(game: Game): void {
      // hérite la chaîne résiduelle d'une vie précédente du MÊME id, s'il en reste une en vol
      // (cf. tailChains ci-dessus) — sinon repart d'une chaîne neuve (id inédit ou vie précédente déjà éteinte)
      const inherited = tailChains.get(game.id)
      if (inherited !== undefined) tailChains.delete(game.id)
      entries.set(game.id, { game, handle: null, dirty: false, dirtySince: 0, chain: inherited ?? Promise.resolve(), saveQueued: false, lastDone: 0, life: ++lifeSeq, launched: 0, correcting: false })
      game._onMutate = () => scheduleSave(game)
    },

    forgetGame(id: string): void {
      const e = entries.get(id)
      if (e?.handle) clearTimeout(e.handle)
      entries.delete(id)
      if (e) {
        e.saveQueued = false   // annule la sauvegarde coalescée en attente — le remove doit gagner
        e.chain      = chainRemove(id, e.chain, e.life)
      } else {
        void runRemove(id, 0)   // aucune entry (jamais armée / déjà oubliée) — MÊME comportement qu'avant
      }
    },

    async loadAtBoot(restore: (data: MjsServerGameSnapshot) => boolean): Promise<void> {
      let brut: Array<{ id: string; data: MjsServerGameSnapshot }>
      try {
        brut = await resolved.adapter.load()
      } catch (err) {
        onLog('warn', t('serveur.persist-load-echoue'), { err: err instanceof Error ? err.message : String(err) })
        return
      }
      // un adaptateur maison qui rend autre chose qu'un tableau ({}, null, une chaîne…) : même sort qu'un load() qui échoue — le
      // `for…of` ci-dessous levait (boot cassé) ou parcourait une chaîne caractère par caractère
      if (!Array.isArray(brut)) {
        onLog('warn', t('serveur.persist-load-pas-un-tableau', { recu: brut === null ? 'null' : typeof brut }))
        return
      }
      for (const entry of brut) {
        // entrée elle-même `null` (adaptateur maison) : même avertissement qu'une donnée illisible, jamais un boot cassé
        const data = entry?.data
        try {
          // `data` peut être `null` (colonne SQL NULL, fichier `null` JSON valide,
          // cf. decodeSnapshot) — `data?.id`/`data?.type` : sinon CETTE ligne lève à son tour, hors
          // de tout try, et fait fuir loadAtBoot() entier (boot cassé pour UNE seule entrée)
          if (!restore(data)) onLog('warn', t('serveur.persist-partie-ignoree', { id: data?.id, type: data?.type }))
        } catch (err) {
          onLog('warn', t('serveur.persist-restauration-echouee', { id: data?.id }), { err: err instanceof Error ? err.message : String(err) })
        }
      }
    },

    async stop(): Promise<void> {
      stopped = true   // une écriture abandonnée qui répond pendant l'arrêt ne relance rien (cf. lateArrival)
      if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null }
      for (const e of entries.values()) {
        if (e.handle) { clearTimeout(e.handle); e.handle = null }
        if (e.dirty) runSave(e)
      }
      // attend TOUTES les chaînes : une sauvegarde déjà EN VOL (dirty déjà remis à false par runSave) comme celles de la rafale, et le
      // remove() d'une partie finie (tailChains) — juste avant l'arrêt, ou pendant cette attente (repris tant qu'il en naît) : rien ne
      // part vers l'adaptateur après son flush(), où le stockage est peut-être déjà fermé (Redis)
      const awaited = new Set<Promise<void>>()
      let pending: Array<Promise<void>>
      do {
        pending = [...Array.from(entries.values(), e => e.chain), ...tailChains.values()].filter(chain => !awaited.has(chain))
        for (const chain of pending) awaited.add(chain)
        await Promise.allSettled(pending)
      } while (pending.length > 0)
      await boundedWrite(() => resolved.adapter.flush?.(), () => { onLog('warn', t('serveur.persist-flush-sans-reponse', { delai: writeSec })) }, writeMs)
    },
  }
}
