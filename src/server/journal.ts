// journal — magasin NDJSON du journal d'erreurs 3 étages (étage 1). Deux fichiers PLATS
// (server/client), un enregistrement par SIGNATURE (jamais un par occurrence) : une erreur qui
// se répète incrémente un compteur au lieu de faire grossir le fichier sans borne. Conçu pour
// être robuste à l'excès — AUCUNE des opérations exposées ne lève jamais (cf. `record`/`list`/
// `purge`/`flush`/`close`) : un journal qui plante l'appli qu'il est censé surveiller serait absurde.
//
// Pas de précédent NDJSON dans ce projet — écriture ATOMIQUE (tmp + renameSync, même patron que
// `Bundler.writeFileAtomicAlways`, bundler/index.ts) mais DÉBOUNCÉE (~1s, cf. RELOAD_DEBOUNCE_MS
// de cli/ws.ts pour le même motif clearTimeout/setTimeout) : chaque `record()` ne réécrit pas le
// fichier immédiatement, une rafale d'erreurs coalesce en une poignée d'écritures disque.
//
// `process.on('exit', …)` best-effort (flush du dernier état avant que le process ne parte) —
// insuffisant SEUL : `systemctl stop` envoie SIGTERM, qui termine Node SANS jamais atteindre ce
// hook — jusqu'à DEBOUNCE_MS (1s) d'erreurs fraîchement enregistrées perdues à CHAQUE
// redéploiement. `ensureSigtermHook()` comble ce trou : `process.once('SIGTERM', …)` flush puis
// SE RÉ-ENVOIE le signal (`process.kill(process.pid, 'SIGTERM')`) — `once` s'étant auto-retiré
// dès le premier appel, ce 2e SIGTERM ne trouve plus aucun listener et Node reprend son
// comportement PAR DÉFAUT (terminaison, code de sortie 143 préservé pour l'appelant, ex. systemd).
//
// COROLLAIRE à connaître, et c'est la raison d'être de `close()` : une écriture encore en attente
// au moment du hook 'exit' passe par `writeAtomic`, qui RECRÉE le dossier cible s'il a disparu
// entre-temps (mkdirSync recursive). En production c'est voulu (mieux vaut recréer un dossier de
// logs effacé sous les pieds du serveur que perdre les dernières erreurs d'un `systemctl stop`) ;
// pour un appelant à durée de vie courte — test, script, commande one-shot — c'est un dossier qui
// RESSUSCITE après son propre ménage. `close()` solde et se retire du hook : le cas disparaît.
//
// PAS de `process.on('SIGINT', …)` en revanche : vérifié
// empiriquement (aucun listener SIGINT préexistant dans `mjs serve`) qu'ajouter un listener SIGINT
// qui ne fait QUE flush (sans `process.exit()` ni ré-émission façon SIGTERM ci-dessus) SUPPRIME
// le comportement de terminaison PAR DÉFAUT de Ctrl+C (le process reste vivant tant que rien
// n'appelle `process.exit()`) — régression bien pire que la perte, best-effort, de quelques
// entrées non encore flushées. Un listener PAR ÉVÉNEMENT ('exit'/'SIGTERM'), PARTAGÉ (module-level,
// jamais un par instance), évite tout MaxListenersExceededWarning au fil des nombreux
// `createJournal()` d'une suite de tests.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { t } from '../messages/index.js'

export type JournalSource = 'server' | 'client'

export interface JournalEntryInput {
  message: string
  pile?: string
  url?: string
  version?: string | null
  ua?: string
}

export interface JournalEntry {
  ts: number
  source: JournalSource
  signature: string
  message: string
  pile: string
  url: string
  version: string | null
  ua?: string
  n: number
  premier: number
  dernier: number
}

export interface JournalOptions {
  dir: string
  maxEntries?: number
  maxBytes?: number
  /** durée de vie d'une entrée en jours, depuis sa dernière occurrence (défaut 30) */
  maxDays?: number
}

export interface Journal {
  record(source: JournalSource, entry: JournalEntryInput): void
  list(): JournalEntry[]
  purge(source?: JournalSource | null): void
  flush(): void
  /** Solde les écritures en attente PUIS retire ce journal du hook de sortie (`process.on('exit')`)
   *  — à appeler par tout appelant à DURÉE DE VIE COURTE (test, script, commande CLI one-shot) qui
   *  ne veut pas voir son dossier de logs recréé après coup. Idempotent. Un `record()` postérieur
   *  reste honoré, mais écrit IMMÉDIATEMENT (plus de débounce à rattraper) : jamais de perte muette. */
  close(): void
}

/** Callback pré-gaté (déjà tranché selon `journal.server`, cf. render-server.ts) branché sur les
 *  5 points de capture serveur — `source` et `version` sont posés par l'appelant (startRenderServer),
 *  chaque point ne fournit que ce qu'il connaît. INERTE (no-op) si l'étage serveur est désactivé —
 *  aucun des call-sites n'a besoin de tester la config lui-même. */
export type RecordServerFn = (entry: { message: string, pile?: string, url?: string }) => void

const DEFAULT_MAX_ENTRIES = 200
const DEFAULT_MAX_BYTES   = 1_048_576
const DEFAULT_MAX_DAYS    = 30
const DAY_MS              = 86_400_000
const DEBOUNCE_MS         = 1000
// Cap défensif du champ STOCKÉ `message` — aligné sur le plafond déjà posé par l'endpoint POST
// (render-server.ts, 2 Ko) : un filet pour les AUTRES appelants (les 5 points de capture serveur,
// qui ne pré-tronquent rien eux-mêmes), jamais une 2e troncature visible pour l'endpoint.
const MAX_MESSAGE_CHARS       = 2048
// Extrait utilisé UNIQUEMENT pour la clé de GROUPEMENT (signature) — cf. le JSDoc de `record()` :
// « message (1re ligne, ≤300 c.) » qualifie la signature, PAS le champ stocké.
const MAX_SIGNATURE_MSG_CHARS = 300
const MAX_PILE_CHARS          = 8192
// même plafond pour l'adresse d'une entrée serveur que celui que l'endpoint POST pose déjà à celle d'une entrée client
const MAX_URL_CHARS           = 2048

const FILE_BY_SOURCE: Record<JournalSource, string> = {
  server: 'mjs-errors-server.ndjson',
  client: 'mjs-errors-client.ndjson',
}

// secrets masqués à l'écriture : ni le fichier, ni la signature, ni la visionneuse ne les voient. Le texte est d'abord ramené à sa
// taille stockée, plus une marge pour qu'un secret à cheval sur la coupe soit reconnu entier, puis masqué, puis coupé (cf. record()).
// Chaque motif ne démarre qu'en un point précis (séparateur, mot `Bearer`, `Basic`, `Cookie`, `Authorization`, guillemet, adresse,
// début d'une suite de caractères qu'aucun caractère de la même suite ne précède) et ses répétitions sont bornées : temps linéaire,
// même sur un message hostile ; maskSecrets ramène d'elle-même son entrée à 64 Kio
const MAX_MASK_INPUT_CHARS = 65_536
const MASK_MARGIN_CHARS    = 16_384
const SECRET_PARAM_NAME    = /(?:token|secret|passw(?:or)?d|pwd|pass|key|signature|sig|code|otp|jwt|session(?:id)?|sid|auth(?:orization)?|credentials?|ticket|nonce|state|verifier)$/
// noms d'une paire JSON : ceux d'un secret, sans les noms ordinaires d'un objet (`code`, `state`, `key`…) ; un mot de passe partout dans
// le nom ; `cookie` et `authorization` ont leur motif (cf. COOKIE_RE, AUTH_HEADER_RE)
const SECRET_JSON_NAME     = /passw(?:or)?d|pwd|(?:token|secret|passphrase|apikey|accesskey|privatekey|signature|jwt|sessionid|sid|credentials?|otp|verifier)$/
const PARAM_RE             = /([?&;#])([^=&#?\s"'<>]{1,64})=([^&#\s"'<>]+)/g
// valeur d'un en-tête d'identification, écrit en clair (`Cookie: …`) ou en JSON (`"cookie": "…"`), jusqu'à la fin de la ligne, de la
// chaîne ou d'une parenthèse fermante ; `Authorization` garde son schéma (`Authorization: Basic ***`)
const COOKIE_RE            = /\b((?:set-)?cookie)(["']?[ \t]*:[ \t]*["']?)[^\r\n"')\]}]{1,4096}/gi
const AUTH_HEADER_RE       = /\b((?:proxy-)?authorization)(["']?[ \t]*:[ \t]*["']?)(?:([A-Za-z][A-Za-z0-9-]{0,31})[ \t]+)?[^\r\n"')\]}]{1,4096}/gi
const BEARER_RE            = /\bBearer\s+[A-Za-z0-9._~+/-]{8,4096}=*/g
// `Basic` suivi d'un base64 qui ne se lit pas comme un mot : un chiffre, `+`, `/`, `=` ou une bosse (`dX`)
const BASIC_RE             = /\bBasic\s+(?=[A-Za-z0-9+/]{0,4096}(?:[0-9+/=]|[a-z][A-Z]))[A-Za-z0-9+/]{8,4096}={0,2}/g
const JSON_PAIR_RE         = /"([^"\\\r\n]{1,64})"([ \t]*:[ \t]*)("(?:[^"\\\r\n]|\\.){0,4096}"|-?[0-9][0-9.eE+-]{0,63})/g
const JWT_RE               = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,4096}\.[A-Za-z0-9_-]{4,4096}\.[A-Za-z0-9_-]{0,4096}/g
// courriel écrit `@` ou `%40` (formulaire GET, `encodeURIComponent`) : la partie locale
const EMAIL_RE             = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}(@|%40)((?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24})\b/g
// une adresse http(s), ou le chemin seul qui ouvre le texte (le champ `url` d'une entrée)
const URL_RE               = /\bhttps?:\/\/[^\s"'<>]{1,4096}|^\/[^\s"'<>]{0,4096}/g
// segment de chemin de 16 caractères ou plus (lettres, chiffres, `-`, `_`), extension à part
const SEGMENT_RE           = /(?<=\/)([A-Za-z0-9_-]{16,})(\.[A-Za-z0-9]{1,8})?(?=[/?#;]|$)/g

// une partie de segment (entre `-` et `_`) qui se lit : un nombre de 4 chiffres au plus, un court repère (`s24`, `mp3`, `1080p`), ou
// un mot — une voyelle au moins, jamais 6 consonnes de suite, et dès 16 lettres une voyelle sur quatre
function seLit(partie: string): boolean {
  const p = partie.toLowerCase()
  if (/^(?:\d{0,4}|[a-z]{1,4}\d{1,4}|\d{1,4}[a-z]{1,3})$/.test(p)) return true
  if (!/^[a-z]+$/.test(p) || !/[aeiouy]/.test(p) || /[^aeiouy]{6}/.test(p)) return false
  return p.length < 16 || p.replace(/[^aeiouy]/g, '').length * 4 >= p.length
}

// les segments du chemin d'une adresse qui ne se lisent pas comme des mots (jeton, UUID, empreinte) deviennent `***`, extension
// gardée ; l'hôte n'est jamais touché, un slug lisible (`mon-article-2024`) reste en clair
function maskUrlPath(adresse: string): string {
  const debut = adresse.startsWith('/') ? 0 : adresse.indexOf('/', adresse.indexOf('//') + 2)
  if (debut === -1) return adresse
  return adresse.slice(0, debut) + adresse.slice(debut).replace(SEGMENT_RE, (seg, nom: string, ext?: string) => nom.split(/[-_]/).every(seLit) ? seg : '***' + (ext ?? ''))
}

/** Masque jetons et identifiants : paramètres d'adresse au nom de secret, valeur des en-têtes `Cookie`, `Set-Cookie`,
 *  `Authorization`, `Proxy-Authorization`, `Bearer …`, `Basic …`, paires JSON au nom de secret, JWT, partie locale d'un courriel
 *  (`@` ou `%40`), segments de chemin d'une adresse qui ne se lisent pas comme des mots. Exportée pour test direct. */
export function maskSecrets(text: string): string {
  return text.slice(0, MAX_MASK_INPUT_CHARS)
    .replace(PARAM_RE, (all, sep: string, name: string) => SECRET_PARAM_NAME.test(name.toLowerCase().replace(/[^a-z]/g, '')) ? `${sep}${name}=***` : all)
    .replace(COOKIE_RE, '$1$2***')
    .replace(AUTH_HEADER_RE, (_all, nom: string, sep: string, schema?: string) => `${nom}${sep}${schema ? schema + ' ' : ''}***`)
    .replace(BEARER_RE, 'Bearer ***')
    .replace(BASIC_RE, 'Basic ***')
    .replace(JSON_PAIR_RE, (all, nom: string, sep: string) => SECRET_JSON_NAME.test(nom.toLowerCase().replace(/[^a-z]/g, '')) ? `"${nom}"${sep}"***"` : all)
    .replace(JWT_RE, '***')
    .replace(EMAIL_RE, '***$1$2')
    .replace(URL_RE, maskUrlPath)
}

// coupe d'abord (avec la marge), masque, puis ramène à la taille stockée : le coût du masquage suit la taille stockée, jamais le message reçu
function maskThenTruncate(s: string, max: number): string {
  return truncate(maskSecrets(truncate(s, max + MASK_MARGIN_CHARS)), max)
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i)
}

// `message`/`pile` reçus ICI sont déjà les valeurs STOCKÉES (post-troncature MAX_MESSAGE_CHARS/
// MAX_PILE_CHARS, cf. record()) — la signature en dérive un extrait PLUS ÉTROIT (1re ligne, ≤300 c.
// pour le message ; 1re ligne seule pour la pile), sans jamais réduire ce qui est écrit sur disque.
function signatureOf(message: string, pile: string, url: string): string {
  return truncate(firstLine(message), MAX_SIGNATURE_MSG_CHARS) + '\n' + firstLine(pile) + '\n' + url
}

function serialize(entries: JournalEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')
}

// retire l'entrée au `dernier` le plus ANCIEN (purge FIFO) — recherche linéaire, journaux bornés
// (≤ quelques centaines d'entrées par défaut), pas besoin d'une structure plus élaborée.
function removeOldest(entries: JournalEntry[]): void {
  if (entries.length === 0) return
  let idx = 0
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].dernier < entries[idx].dernier) idx = i
  }
  entries.splice(idx, 1)
}

// taille sérialisée de chaque entrée (sa ligne NDJSON + le saut de ligne), retenue : tenir le
// plafond en octets ne resérialise plus tout le journal à chaque record() (≈ 1 Mio, plusieurs ms
// de boucle bloquée par erreur). Une entrée modifiée (regroupement) est oubliée, puis remesurée.
const entrySizes = new WeakMap<JournalEntry, number>()

function entrySize(e: JournalEntry): number {
  let n = entrySizes.get(e)
  if (n === undefined) { n = Buffer.byteLength(JSON.stringify(e), 'utf-8') + 1; entrySizes.set(e, n) }
  return n
}

// retire l'entrée la plus ancienne et rend sa taille
function removeOldestSized(entries: JournalEntry[]): number {
  let idx = 0
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].dernier < entries[idx].dernier) idx = i
  }
  return entrySize(entries.splice(idx, 1)[0])
}

function enforceCaps(entries: JournalEntry[], maxEntries: number, maxBytes: number): void {
  while (entries.length > maxEntries) removeOldest(entries)
  let total = 0
  for (const e of entries) total += entrySize(e)
  while (entries.length > 0 && total > maxBytes) total -= removeOldestSized(entries)
}

// écriture atomique (tmp + renameSync, même patron que Bundler.writeFileAtomicAlways) — dossier
// créé PARESSEUSEMENT ici (jamais avant le tout premier write réel).
function writeAtomic(target: string, content: string): void {
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, content, 'utf-8')
  try {
    renameSync(tmp, target)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* best-effort */ }
    throw e
  }
}

// chargement paresseux d'un fichier NDJSON existant — une ligne invalide (JSON cassé, vide, pas
// un objet) est IGNORÉE en silence, jamais un crash (le fichier peut avoir été tronqué par un
// arrêt brutal précédent).
function loadFile(path: string): JournalEntry[] {
  if (!existsSync(path)) return []
  const out: JournalEntry[] = []
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    return []
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.push(parsed as JournalEntry)
    } catch { /* ligne corrompue ignorée */ }
  }
  return out
}

// listener 'exit' UNIQUE, partagé par TOUTES les instances (jamais un par createJournal() —
// éviterait un MaxListenersExceededWarning au fil d'une suite de tests qui en crée des dizaines).
const pendingFlushes = new Set<() => void>()
let exitHookInstalled = false
function ensureExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => {
    for (const fn of pendingFlushes) {
      try { fn() } catch { /* best-effort */ }
    }
  })
}

// listener 'SIGTERM' UNIQUE, même garde que ensureExitHook — `once` (jamais `on`) : le
// flush tourne UNE fois puis le listener s'auto-retire, ensuite le process SE RÉ-ENVOIE le même
// signal ; au 2e passage plus aucun listener n'est en place, Node reprend sa terminaison PAR
// DÉFAUT (cf. commentaire d'en-tête).
let sigtermHookInstalled = false
function ensureSigtermHook(): void {
  if (sigtermHookInstalled) return
  sigtermHookInstalled = true
  process.once('SIGTERM', () => {
    for (const fn of pendingFlushes) {
      try { fn() } catch { /* best-effort */ }
    }
    process.kill(process.pid, 'SIGTERM')
  })
}

export function createJournal(opts: JournalOptions): Journal {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxBytes   = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const maxAgeMs   = (opts.maxDays ?? DEFAULT_MAX_DAYS) * DAY_MS

  // état par source — chargé paresseusement (1re opération qui le touche), dirty + timer de
  // debounce propres à CHAQUE fichier (server/client sont deux ressources indépendantes).
  const tables: Record<JournalSource, { entries: JournalEntry[] | null, dirty: boolean, timer: ReturnType<typeof setTimeout> | null }> = {
    server: { entries: null, dirty: false, timer: null },
    client: { entries: null, dirty: false, timer: null },
  }
  let warned = false
  let closed = false

  const warnOnce = (e: unknown): void => {
    if (warned) return
    warned = true
    const erreur = e instanceof Error ? e.message : String(e)
    console.warn(t('server.journal-ecriture-echec', { erreur }))
  }

  const pathFor = (source: JournalSource): string => join(opts.dir, FILE_BY_SOURCE[source])

  const getEntries = (source: JournalSource): JournalEntry[] => {
    const table = tables[source]
    if (table.entries === null) table.entries = loadFile(pathFor(source))
    // durée de vie : une entrée sans nouvelle occurrence depuis `maxDays` jours est oubliée, sur le disque aussi (date illisible comprise)
    const limite = Date.now() - maxAgeMs
    if (table.entries.some((e) => !(e.dernier >= limite))) {
      table.entries = table.entries.filter((e) => e.dernier >= limite)
      scheduleFlush(source)
    }
    return table.entries
  }

  const flushSource = (source: JournalSource): void => {
    const table = tables[source]
    if (table.timer) { clearTimeout(table.timer); table.timer = null }
    if (!table.dirty || table.entries === null) return
    try {
      writeAtomic(pathFor(source), serialize(table.entries))
      table.dirty = false
    } catch (e) {
      warnOnce(e)
    }
  }

  const scheduleFlush = (source: JournalSource): void => {
    const table = tables[source]
    table.dirty = true
    if (table.timer) clearTimeout(table.timer)
    // journal soldé (close()) : plus aucun hook de sortie derrière pour rattraper un différé —
    // on écrit TOUT DE SUITE plutôt que de perdre l'entrée (jamais un no-op muet)
    if (closed) { flushSource(source); return }
    table.timer = setTimeout(() => flushSource(source), DEBOUNCE_MS)
    // best-effort : un timer actif garderait le process éveillé (setTimeout non-ref) — un
    // serveur `mjs serve` tourne de toute façon en continu, mais un script one-shot (test, CLI)
    // qui créerait un journal puis quitterait sans jamais appeler flush()/close() ne doit pas
    // rester bloqué 1s de plus pour rien.
    table.timer.unref?.()
  }

  // flusher NOMMÉ (jamais une lambda anonyme posée à la volée) : close() doit pouvoir le retirer
  // de `pendingFlushes` — un Set ne sait supprimer que la référence exacte qu'on lui a donnée
  const flushBoth = (): void => { flushSource('server'); flushSource('client') }
  pendingFlushes.add(flushBoth)
  ensureExitHook()
  ensureSigtermHook()

  return {
    record(source, input) {
      try {
        const message = maskThenTruncate(String(input.message ?? ''), MAX_MESSAGE_CHARS)
        const pile     = maskThenTruncate(String(input.pile ?? ''), MAX_PILE_CHARS)
        const url      = maskThenTruncate(String(input.url ?? ''), MAX_URL_CHARS)
        const signature = signatureOf(message, pile, url)
        const now = Date.now()
        const entries = getEntries(source)
        const existing = entries.find((e) => e.signature === signature)
        if (existing) {
          entrySizes.delete(existing)   // compteur, date, version : sa taille change
          existing.n++
          existing.dernier = now
          if (input.version !== undefined) existing.version = input.version
          if (input.ua !== undefined) existing.ua = input.ua
        } else {
          const entry: JournalEntry = {
            ts: now, source, signature, message, pile, url,
            version: input.version ?? null, n: 1, premier: now, dernier: now,
          }
          if (input.ua !== undefined) entry.ua = input.ua
          entries.push(entry)
        }
        enforceCaps(entries, maxEntries, maxBytes)
        scheduleFlush(source)
      } catch (e) {
        warnOnce(e)
      }
    },
    list() {
      try {
        return [...getEntries('server'), ...getEntries('client')].sort((a, b) => b.dernier - a.dernier)
      } catch (e) {
        warnOnce(e)
        return []
      }
    },
    purge(source) {
      try {
        const targets: JournalSource[] = source ? [source] : ['server', 'client']
        for (const s of targets) {
          tables[s].entries = []
          scheduleFlush(s)
        }
      } catch (e) {
        warnOnce(e)
      }
    },
    flush() {
      try {
        flushSource('server')
        flushSource('client')
      } catch (e) {
        warnOnce(e)
      }
    },
    close() {
      if (closed) return
      closed = true
      try {
        flushSource('server')
        flushSource('client')
      } catch (e) {
        warnOnce(e)
      }
      pendingFlushes.delete(flushBoth)
    },
  }
}
