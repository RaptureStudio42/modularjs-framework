// cli/ws — commande `mjs ws` : lance le serveur temps réel (MJS-WS) d'une appli
// à partir d'un fichier d'entry (`export default { …options mjsWs(), setup(app) }`).
// MJS-WS (cf. docs/23-mjs-ws.md §7 pour le contrat complet).
// Logique extraite de cli.ts (même précédent que cli/init.ts et cli/dev-lock.ts)
// pour rester testable SANS déclencher process.exit()/une vraie exécution CLI.
//
// Résolution de l'entry (§7.1) : --entry > mjs.config.json `ws.entry` > défauts
// `ws.server.mjs` > `server/ws.server.mjs` > `ws.js` > `ws.civet` > `server/ws.js` >
// `server/ws.civet`, relatifs à la racine du projet (dossier de mjs.config.json, à défaut --root). `.server.mjs` est le format RECOMMANDÉ (§6.1bis
// docs/23-mjs-ws.md) — MÊME dialecte Civet que le <script> des composants (assignations
// nues auto-déclarées, interpolation "#{}", `->`…), cf. cli/server-entry.ts.
// Contrat de l'entry (§7.2) : `export default` = OBJET, clés acceptées =
// options de mjsWs() sauf port/host/onLog (réservées au CLI, ignorées avec un
// warn) — `transport` EST acceptée : une INSTANCE
// MjsWsTransport maison, prioritaire sur `ws.transport` de la config (les
// chaînes 'ws'/'uws' restent réservées à la config, cf. buildRunPlan) — plus
// `setup(app)` optionnelle (sync ou async). Priorités port/host/heartbeat/
// limits (§7.3) : port = --port > ws.port > 4000, borné 1-65535 (même
// règle que ws.port dans mjs.config.json) ; host =
// --host > ws.host (pas de défaut forcé — le transport `ws` par défaut
// applique le sien : la bannière affiche toujours l'hôte EFFECTIF,
// y compris ce défaut) ; heartbeat/limits/transport définissables dans
// l'entry ET dans la config, l'ENTRY prime en cas de doublon (le code de
// l'app > la config), avec un warn.
//
// Compilation de l'entry (cli/server-entry.ts — module PARTAGÉ avec cli/server.ts et
// server/serve-entry.ts) : un `.server.mjs` est un VRAI fichier MJS — compilé (MÊME dialecte
// Civet que le <script> des composants, assignations nues auto-déclarées, interpolation "#{}",
// `isnt`, `->`… — AUCUNE transformation de symbole réactif $x/@x/§/µ-runes, un fichier serveur
// n'a ni réactivité ni DOM) vers un fichier réel sous `<root>/node_modules/.cache/mjs/server/`
// (repli os.tmpdir() si `<root>/node_modules` est absent), importé par une URL `file://`
// cache-bustée (`?v=n`) — plus de `data:` URL. Seule la directive `@import` a un sens hors DOM
// (grammaire des composants, MÊME regex que transpiler/directives.ts) : cible `https?://`
// laissée telle quelle, cible relative résolue à côté de l'entry PUIS sous --root (compilée
// récursivement si `.civet`/`.mjs`, détection de cycle), sinon spécificateur nu laissé à Node
// (`node:fs`, un paquet npm si `<root>/node_modules` existe). Toute AUTRE directive (`@i18n`,
// `@routes`, `@css`…) est une erreur de compilation explicite. Un `import … from` natif est
// une ERREUR de compilation — seule `@import` importe ; `export … from`
// (ré-export) et `import('littéral')` refusés pareillement, `import(variable)` reste permis
// (clés cli.entry-*, lintNoRawImport, transpiler/index.ts). Un
// `.server.mjs` contenant du markup de composant (<template>, <style>, balise HTML en tête) est
// refusé avec une erreur claire (cf. findComponentMarkupHint, cli/server-entry.ts).
//
// Entry en Civet BRUT (`ws.civet`/`server/ws.civet`, variante documentée) : compilé SANS AUCUNE
// des pré-passes ci-dessus (ni dialecte, ni @import) — un script Civet vanille, avec ses pièges
// connus (assignation nue jamais déclarée, "#{}" jamais interpolé, `isnt` jamais reconnu) — MÊME
// fichier réel + cache-busting que `.server.mjs`. Détail + exemples : docs/23-mjs-ws.md
// « Écrire son fichier serveur ».
//
// Rechargement à chaud (§7.6) : fs.watch PLAT (non récursif) sur le DOSSIER de
// l'entry, filtre .js/.mjs/.cjs/.civet/.json, debounce 150ms. IMPORTE le
// nouveau module D'ABORD (cache-busting `?v=n`, cf. ci-dessus) — si l'import (ou la
// compilation, ou le contrat) échoue, erreur loguée et l'ANCIEN serveur continue de
// tourner (zéro coupure) ; si OK, l'ancien serveur est arrêté (µ:bye) puis le nouveau
// prend sa place sur le MÊME port. Limite ASSUMÉE : un fichier importé par l'entry
// HORS de son dossier n'est pas surveillé (seule l'URL de l'entry elle-même est
// cache-bustée à chaque rechargement, ses PROPRES imports/@import suivent le cache
// ESM normal de Node).
//
// Concurrence : le debounce ci-dessus peut redéclencher PENDANT qu'un
// rechargement précédent tourne encore (import + listen asynchrones) — sérialisé par
// génération, cf. le commentaire devant reload()/scheduleReload() plus bas.

import { existsSync, watch as fsWatch, realpathSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { mjsWs, DEFAULT_LIMITS, DEFAULT_HEARTBEAT, DEFAULT_TOKEN, resolveBridgeOptions, resolveResumeOptions, isLoopbackHost, isProxyOptions } from '../mjs-ws/index.js'
import type { MjsWsApp, MjsWsLimits, MjsWsLogFn, MjsWsOptions, MjsWsTokenOptions, MjsWsTransport } from '../mjs-ws/index.js'
import type { MjsConfig, WsConfig } from '../bundler/config.js'
import { compileServerFile, compileRawCivetFile } from './server-entry.js'
import { t } from '../messages/index.js'
import { gardeArret, SHUTDOWN_GRACE_MS } from './dev-lock.js'

// --- squelette imprimé quand aucune entry n'est trouvée ---------------------

// dialecte Civet des composants (§6.1bis docs/23-mjs-ws.md) : assignation nue
// auto-déclarée (`pong = ->`) + flèche `->` — cf. cli/server-entry.ts.
const ENTRY_SKELETON = `pong = -> 'pong'

export default
  setup: (app) ->
    app.serve 'ping', pong
`

// ordre de résolution des défauts : ws.server.mjs > server/ws.server.mjs > ws.js > ws.civet >
// server/ws.js > server/ws.civet — le format RECOMMANDÉ (`.server.mjs`, MÊME dialecte Civet que
// le <script> des composants : assignations nues auto-déclarées, interpolation "#{}", cf.
// cli/server-entry.ts) prime sur tout le reste ; `.civet` reste la variante « Civet
// brut » documentée (§12 docs/23-mjs-ws.md), compilée SANS les pré-passes du framework.
const ENTRY_DEFAULTS = ['ws.server.mjs', 'server/ws.server.mjs', 'ws.js', 'ws.civet', 'server/ws.js', 'server/ws.civet']

function entryNotFoundMessage(reason: string): string {
  return t('cli.ws.entry-introuvable', { raison: reason, squelette: ENTRY_SKELETON })
}

/** Résout le chemin ABSOLU de l'entry — --entry > ws.entry (config) > ws.server.mjs > server/ws.server.mjs > ws.js > ws.civet > server/ws.js > server/ws.civet. */
export function resolveEntryPath(root: string, cliEntry: string | undefined, configEntry: string | undefined): string {
  if (cliEntry !== undefined) {
    const p = resolve(root, cliEntry)
    if (!existsSync(p)) throw new Error(entryNotFoundMessage(t('cli.entry-cli-introuvable', { cliEntry, chemin: p })))
    return p
  }
  if (configEntry !== undefined) {
    const p = resolve(root, configEntry)
    if (!existsSync(p)) throw new Error(entryNotFoundMessage(t('cli.entry-config-introuvable', { champ: 'ws.entry', valeur: configEntry, chemin: p })))
    return p
  }
  for (const rel of ENTRY_DEFAULTS) {
    const p = resolve(root, rel)
    if (existsSync(p)) return p
  }
  throw new Error(entryNotFoundMessage(t('cli.entry-aucun-trouve', { liste: ENTRY_DEFAULTS.join(', '), racine: root })))
}

// --- contrat de l'entry : export default = objet, clés mjsWs() + setup(app) ---

// `transport` est SORTIE de cette liste : une instance
// MjsWsTransport maison exportée par l'entry est désormais un usage LÉGITIME (prioritaire sur
// la chaîne ws.transport de la config, cf. buildRunPlan ci-dessous) — seules port/host/onLog
// restent réservées au CLI (contrôlées par --port/ws.host/le logger interne, jamais par l'app).
/** clés RÉSERVÉES au CLI — présentes dans l'entry : warn + ignorées (jamais transmises à mjsWs()).
 *  EXPORTÉE — réutilisée telle quelle par cli/server.ts (`mjs serveur`, MÊME règle réservée). */
export const RESERVED_ENTRY_KEYS = ['port', 'host', 'onLog']

export interface EntryContract {
  options: MjsWsOptions
  setup?: (app: MjsWsApp) => unknown
}

/** Valide + isole le contrat d'un module d'entry déjà importé (`mod` = namespace ES) — partagé par `mjs ws` et `mjs serveur`
 *  (`produit`, pour les messages) : export default objet, clés réservées ignorées avec un avertissement, `setup` fonction si
 *  présent. */
export function readEntryContractOf<O, A>(produit: string, mod: any, entryPath: string, warn: (message: string) => void): { options: O, setup?: (app: A) => unknown } {
  const dflt = mod ? mod.default : undefined
  if (dflt === undefined || dflt === null || typeof dflt !== 'object' || Array.isArray(dflt)) {
    const got = dflt === undefined ? t('cli.aucun-export-defaut') : (Array.isArray(dflt) ? t('cli.un-tableau') : typeof dflt)
    throw new Error(t('cli.entry-doit-export-default', { produit, entryPath, recu: got }))
  }

  const options: Record<string, unknown> = {}
  for (const key of Object.keys(dflt)) {
    if (key === 'setup') continue   // traité séparément ci-dessous
    if (RESERVED_ENTRY_KEYS.includes(key)) { warn(t('cli.entry-cle-ignoree', { cle: key })); continue }
    options[key] = (dflt as any)[key]
  }

  let setup: ((app: A) => unknown) | undefined
  if (dflt.setup !== undefined) {
    if (typeof dflt.setup !== 'function') {
      throw new Error(t('cli.entry-setup-doit-etre-fonction', { produit, entryPath, recu: typeof dflt.setup }))
    }
    setup = dflt.setup
  }

  return { options: options as O, setup }
}

/** Contrat de l'entry de `mjs ws`. */
export function readEntryContract(mod: any, entryPath: string, warn: (message: string) => void): EntryContract {
  return readEntryContractOf<MjsWsOptions, MjsWsApp>('mjs ws', mod, entryPath, warn)
}

// --- priorités port/host/heartbeat/limits : entry > config > défauts CLI ----

export interface WsRunPlan {
  options: MjsWsOptions
  setup?: (app: MjsWsApp) => unknown
  port: number
  host?: string
  heartbeat: number
  limits: MjsWsLimits
}

/** Fusionne le contrat de l'entry + la section `ws` de la config + --port/--host — l'ENTRY prime sur heartbeat/limits (warn si doublon).
 *  `cliHost` : dernier paramètre, OPTIONNEL — ajouté après `warn`
 *  pour ne rien casser d'un appel positionnel existant à 4 arguments (host retombe alors sur
 *  `wsConfig?.host`, comportement historique inchangé). */
export function buildRunPlan(
  contract: EntryContract,
  wsConfig: WsConfig | undefined,
  cliPort: number | undefined,
  warn: (message: string) => void,
  cliHost?: string,
): WsRunPlan {
  return buildRunPlanOf(contract, wsConfig, 'ws', SHARED_PLAN_KEYS, 4000, cliPort, warn, cliHost)
}

// clés que la section de configuration (`ws`, `serveur`) partage avec l'entry, dans l'ordre de leurs avertissements : transport
// (instance dans l'entry, chaîne seulement en JSON), codec (µschema), heartbeat, limits, token (expiration, rafraîchissement),
// bridge (pont universel ; son `secret` est exigé au lancement par bridge.ts), resume (reprise de session, `false` explicite
// compris), adapter (multi-processus), stats, sessionExclusive, verifyOrigin (forme fonction comprise), ban (`false` explicite
// compris)
export const SHARED_PLAN_KEYS = ['transport', 'codec', 'heartbeat', 'limits', 'token', 'bridge', 'resume', 'adapter', 'stats', 'sessionExclusive', 'verifyOrigin', 'ban'] as const

/** Fusionne le contrat de l'entry, la section `section` de la configuration et --port/--host — partagé par `mjs ws` et
 *  `mjs serveur`. Pour chaque clé de `keys`, l'ENTRY prime EN BLOC (pas de fusion clé à clé : le code de l'app passe avant la
 *  configuration), avec un avertissement si les deux sont posées. Heartbeat et limites résolus ICI avec les MÊMES défauts que
 *  mjsWs() (passthrough) : la bannière affiche les valeurs effectives sans recopier les littéraux. Port borné comme `ws.port`
 *  (un --port hors plage retombait sur un RangeError brut de Node au moment de lier le transport) ; hôte local par défaut, comme
 *  le pont : qui veut exposer le serveur le dit avec `--host ::`, jamais un silence (chaîne vide = absent). */
export function buildRunPlanOf<O extends object, A>(
  contract: { options: O, setup?: (app: A) => unknown },
  config: object | undefined,
  section: 'ws' | 'serveur',
  keys: readonly string[],
  defaultPort: number,
  cliPort: number | undefined,
  warn: (message: string) => void,
  cliHost?: string,
): { options: O, setup?: (app: A) => unknown, port: number, host: string, heartbeat: number, limits: MjsWsLimits } {
  const cfg: any     = config
  const options: any = { ...contract.options }
  for (const cle of keys) {
    if (cfg?.[cle] === undefined) continue
    if (options[cle] !== undefined) warn(t('cli.entry-config-doublon', { champ: cle, chemin: `${section}.${cle}` }))
    else options[cle] = cfg[cle]
  }
  const heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT
  const limits: MjsWsLimits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
  options.heartbeat = heartbeat
  options.limits    = limits
  const port = cliPort ?? cfg?.port ?? defaultPort
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(t(section === 'ws' ? 'cli.ws.port-hors-plage' : 'cli.serveur.port-hors-plage', { valeur: port }))
  const host = (cliHost ?? cfg?.host ?? '').trim() || '127.0.0.1'
  return { options, setup: contract.setup, port, host, heartbeat, limits }
}

// --- logger horodaté à niveaux (style `mjs dev`, + [HH:MM:SS]) --------------

function pad2(n: number): string { return String(n).padStart(2, '0') }
function timestamp(): string {
  const d = new Date()
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// EXPORTÉS — brique générique (aucune dépendance ws-spécifique), réutilisée telle quelle par
// cli/server.ts (`mjs serveur`, MÊME format de log horodaté)
export interface CliLogger {
  log: MjsWsLogFn
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export function createLogger(): CliLogger {
  const emit: MjsWsLogFn = (level, message, meta) => {
    const icon = level === 'error' ? '❌' : level === 'warn' ? '⚠️ ' : level === 'debug' ? '🔎' : 'ℹ️ '
    const line = `[${timestamp()}] ${icon} ${message}`
    if (level === 'error') console.error(line, meta ?? '')
    else if (level === 'warn') console.warn(line, meta ?? '')
    else console.log(line, meta ?? '')
  }
  return {
    log:   emit,
    info:  message => emit('info', message),
    warn:  message => emit('warn', message),
    error: message => emit('error', message),
  }
}

// affichage de la bannière UNIQUEMENT — la RÉSOLUTION effective ('ws' par défaut si absent, ou
// l'instance passée telle quelle) vit dans mjsWs()/resolveTransport (index.ts, source unique).
// EXPORTÉE — pur formatage, aucune dépendance ws-spécifique au-delà du TYPE (MjsWsOptions['transport']
// = MÊME forme que MjsServerOptions['transport'], héritée) — réutilisée par cli/server.ts.
export function describeTransport(transport: MjsWsOptions['transport']): string {
  if (transport === undefined || transport === 'ws') return t('cli.transport-ws')
  if (transport === 'uws') return 'uws (uWebSockets.js)'
  return t('cli.transport-personnalise')
}

// affiche « MJS-WS » (marque de produit) — PAS « MJS-Server » : `mjs ws`
// construit TOUJOURS l'app via mjsWs() (ci-dessus, boot()/reload()), jamais via mjsServer() —
// un entry qui déclare app.game(...) veut la commande SŒUR `mjs serveur` (cli/server.ts,
// cf. docs/24-mjs-server.md §2 « Démarrer »), qui construit l'app via mjsServer() : aucune app
// reçue ici n'a jamais de `.game`, donc rien de fiable à détecter — mention factuelle du transport seul.
function printBanner(logger: CliLogger, entryPath: string, root: string, plan: WsRunPlan): void {
  const hoteAffiche = (plan.host === '::' || plan.host === '0.0.0.0') ? `${t('cli.toutes-interfaces')} (${plan.host})` : plan.host
  printEntryBanner(logger, 'MJS-WS', entryPath, root, plan, ` (${hoteAffiche})`)
}

/** Bannière de démarrage — partagée par `mjs ws` et `mjs serveur` : `titre` (MJS-WS, MJS-Server), `hote` (texte qui suit le
 *  port), `extra` (lignes propres à la commande, juste avant le rappel de Ctrl+C). */
export function printEntryBanner(logger: CliLogger, titre: string, entryPath: string, root: string, plan: { options: MjsWsOptions, port: number, heartbeat: number, limits: MjsWsLimits }, hote: string, extra?: () => void): void {
  const rel = relative(root, entryPath) || entryPath
  logger.info(`${titre} — entry ${rel}`)
  logger.info(`transport : ${describeTransport(plan.options.transport)}`)
  // µschema — affiche le codec EFFECTIF (défaut 'auto' si jamais posé, ni entry ni
  // config) — jamais un silence sur un réglage qui change le FORMAT DE TRAME (contrairement à
  // heartbeat/limits, une confusion ici casse l'interop avec un client mal configuré).
  logger.info(`codec ws : ${plan.options.codec ?? 'auto'}`)
  // L'hôte EFFECTIF s'affiche TOUJOURS — jamais en silence. Le
  // libellé « toutes les interfaces » ne s'affiche plus QUE si l'hôte
  // effectif l'expose vraiment ('::'/'0.0.0.0', demandé via --host ou ws.host) : le défaut est
  // désormais 127.0.0.1 (buildRunPlan), MÊME philosophie que le pont (bridge.ts).
  logger.info(t('cli.banniere-port', { port: plan.port, hote }))
  logger.info(t('cli.banniere-heartbeat', { etat: plan.heartbeat === 0 ? t('cli.desactive') : `${plan.heartbeat} ms` }))
  // plafonds de connexions — valeurs EFFECTIVES (plan.limits déjà
  // fusionnée avec DEFAULT_LIMITS, cf. buildRunPlan) ; `null` = illimité, affiché tel quel.
  logger.info(t('cli.banniere-limites', { rate: plan.limits.rate, burst: plan.limits.burst, kickAfter: plan.limits.kickAfter, maxPayload: plan.limits.maxPayload, maxBuffered: plan.limits.maxBuffered, maxConnections: plan.limits.maxConnections ?? t('cli.illimite'), maxConnectionsPerIp: plan.limits.maxConnectionsPerIp ?? t('cli.illimite') }))
  // proxy de décisions (proxy.ts) — mention SEULEMENT si auth et/ou rooms.join sont un
  // objet-proxy {url,...} (jamais pour la fonction historique, silence inchangé dans ce cas — même
  // philosophie que les autres blocs conditionnels ci-dessous). isProxyOptions = MÊME détection que
  // core.ts, réexportée par mjs-ws/index.ts. URL loguée SANS le secret (cf. docs/23-mjs-ws.md).
  const authOpt = plan.options.auth
  const joinOpt = plan.options.rooms?.join
  if (isProxyOptions(authOpt)) logger.info(`auth : proxy ${authOpt.url}`)
  if (isProxyOptions(joinOpt)) logger.info(t('cli.banniere-salons-proxy', { url: joinOpt.url }))
  // suivi d'expiration du jeton — MÊME gate que bridge/
  // resume/adapter ci-dessous (plan.options.token n'est PAS auto-défauté dans buildRunPlan,
  // contrairement à heartbeat/limits — cf. son commentaire) : rien si ws.token n'a jamais été
  // configuré, ni dans l'entry ni dans mjs.config.json. Valeurs EFFECTIVES via DEFAULT_TOKEN
  // (source unique, index.ts) sinon — opt-in STRICT au runtime (cf. WsConfig.token,
  // bundler/config.ts) : ce réglage ne garantit pas un balayage réellement ARMÉ (ça dépend d'un
  // client qui présente une échéance `exp`), juste ce qui s'appliquerait le cas échéant.
  if (plan.options.token) {
    const token: MjsWsTokenOptions = { ...DEFAULT_TOKEN, ...plan.options.token }
    logger.info(t('cli.banniere-jeton', { sweep: token.sweep / 1000, marge: token.slack / 1000 }))
  }
  // pont universel — options déjà validées (mjsWs() les a résolues sans lever
  // AVANT cet appel, cf. boot()) : resolveBridgeOptions ici est un pur affichage, jamais un 2e essai
  if (plan.options.bridge) {
    const bridge = resolveBridgeOptions(plan.options.bridge, plan.port)
    logger.info(t('cli.banniere-pont', { host: bridge.host, port: bridge.port }))
    logger.info(bridge.webhooks
      ? t('cli.banniere-webhooks-actifs', { url: bridge.webhooks.url, evenements: Array.from(bridge.webhooks.events).join(', ') })
      : t('cli.banniere-webhooks-desactives'))
    // limite de débit — valeurs EFFECTIVES via resolveBridgeOptions (source unique, bridge.ts)
    logger.info(bridge.rateLimit
      ? t('cli.banniere-rate-limit-actif', { capacite: bridge.rateLimit.perIp.capacity, fenetre: bridge.rateLimit.perIp.windowMs / 1000, echecsCapacite: bridge.rateLimit.fails.capacity, echecsFenetre: bridge.rateLimit.fails.windowMs / 1000 })
      : t('cli.banniere-rate-limit-desactive'))
    // nonce anti-rejeu — valeur EFFECTIVE via resolveBridgeOptions (exigé sauf `nonce: false`)
    logger.info(t(bridge.nonce ? 'cli.banniere-nonce-exige' : 'cli.banniere-nonce-coupe'))
    // état/métriques — affichée seulement si active ET loopback : au-delà (host
    // distant), /state exige une requête signée comme le reste du pont — pas un lien à cliquer.
    if (plan.options.stats && isLoopbackHost(bridge.host)) {
      logger.info(t('cli.banniere-etat', { host: bridge.host, port: bridge.port }))
    }
  }
  // reprise de session — valeurs EFFECTIVES via resolveResumeOptions (source unique, sessions.ts)
  if (plan.options.resume) {
    const resume = resolveResumeOptions(plan.options.resume)!
    logger.info(t('cli.banniere-reprise-session', { grace: resume.grace / 1000, maxBuffered: resume.maxBuffered, maxBytes: resume.maxBytes }))
  }
  // adaptateur multi-processus — affiche l'URL si `adapter` est l'objet de config
  // {redis,prefix?} ; une instance MjsWsAdapter déjà construite (cf. index.ts) n'a pas d'URL
  // publique (juste .prefix) — message générique dans ce cas, jamais un crash sur `undefined`.
  if (plan.options.adapter) {
    const a = plan.options.adapter as { redis?: string; prefix?: string }
    const prefix = a.prefix ?? 'mjs-ws'
    logger.info(typeof a.redis === 'string'
      ? t('cli.banniere-multi-processus-redis', { redis: a.redis, prefixe: prefix })
      : t('cli.banniere-multi-processus-custom', { prefixe: prefix }))
  }
  extra?.()
  logger.info(t('cli.ctrl-c-arreter'))
}

// EXPORTÉE — pure, réutilisée par cli/server.ts
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// --- import cache-busté (rechargement à chaud) -------------------------------

let importCounter = 0
const requireCjs = createRequire(import.meta.url)

// compilation `.server.mjs`/`.civet` déléguée à cli/server-entry.ts (module PARTAGÉ avec
// cli/server.ts et server/serve-entry.ts — cf. le commentaire de tête du fichier) : un
// fichier réel sous le cache, importé par une URL `file://` cache-bustée — plus de `data:` URL.
// `.js`/`.mjs`/`.cjs` restent un import NATIF tel quel (cache-busting `?v=n` sur l'URL file://,
// MÊME compteur que ci-dessus).
export async function importEntryModule(entryPath: string, root: string): Promise<any> {
  if (entryPath.endsWith('.server.mjs')) return import(await compileServerFile(entryPath, root))
  if (entryPath.endsWith('.civet')) return import(await compileRawCivetFile(entryPath, root))
  // une entrée CommonJS (`ws.js` sans `"type": "module"`, `.cjs`) passe par le chargeur CommonJS de Node, dont le cache tient au
  // nom de fichier, pas à l'adresse : sans ce retrait, l'entrée modifiée n'était jamais relue
  try { delete requireCjs.cache[realpathSync(entryPath)] } catch { /* absente : l'import dit pourquoi */ }
  const url = pathToFileURL(entryPath).href + '?v=' + (++importCounter)
  return import(url)
}

// --- commande -----------------------------------------------------------------

export interface WsCommandArgs {
  root: string
  entry?: string
  port?: number
  /** posé par le flag générique --host (src/cli.ts), prioritaire
   *  sur ws.host de la config — cf. buildRunPlan. */
  host?: string
}

export interface WsCommandInjections {
  /** transport custom — MemoryTransport pour les tests (jamais de vrai port lié) */
  transport?: MjsWsTransport
  /** désactive le fs.watch (défaut true) — tests qui n'exercent pas le rechargement */
  watch?: boolean
}

export interface WsRunHandle {
  /** app COURANTE — change de référence après un rechargement à chaud réussi */
  readonly app: MjsWsApp
  readonly entryPath: string
  /** arrêt propre : watcher + timer + listeners signal + app.stop() (µ:bye) — SANS process.exit, réutilisé par le handler SIGINT et par les tests */
  stop(): Promise<void>
}

// EXPORTÉES — réutilisées telles quelles par cli/server.ts (`mjs serveur`, MÊME rechargement à chaud)
export const WATCHED_EXT = /\.(js|mjs|cjs|civet|json)$/
export const RELOAD_DEBOUNCE_MS = 150

export async function runWsCommand(
  args: WsCommandArgs,
  config: MjsConfig | undefined,
  injections: WsCommandInjections = {},
): Promise<WsRunHandle> {
  const entryPath = resolveEntryPath(args.root, args.entry, config?.ws?.entry)
  const transport = injections.transport
  return runEntryServer(args.root, entryPath, injections.watch, {
    readContract: readEntryContract,
    buildPlan:    (contract: EntryContract, warn) => buildRunPlan(contract, config?.ws, args.port, warn, args.host),
    // l'injection de TEST (transport, ex. MemoryTransport) prime TOUJOURS — sinon (usage réel,
    // injections.transport === undefined) c'est plan.options.transport (résolu par buildRunPlan
    // depuis l'entry/la config, chaîne OU instance) qui doit passer, jamais être écrasé par un
    // `undefined` littéral ici (régression : auparavant, `transport` valait TOUJOURS
    // injections.transport, `undefined` en usage réel — inoffensif tant que `transport` n'était
    // pas une clé d'options légitime ; ça ne l'est plus).
    create:       (plan: WsRunPlan, onLog) => mjsWs({ ...plan.options, transport: transport ?? plan.options.transport, port: plan.port, host: plan.host, onLog }),
    banner:       (logger, plan: WsRunPlan) => printBanner(logger, entryPath, args.root, plan),
  })
}

/** Ce qui distingue `mjs ws` de `mjs serveur` au lancement comme à chaque rechargement (cf. runEntryServer). */
export interface EntryServerSpec<C, P, A> {
  readContract(mod: any, entryPath: string, warn: (message: string) => void): C
  buildPlan(contract: C, warn: (message: string) => void): P
  create(plan: P, onLog: MjsWsLogFn): A
  banner(logger: CliLogger, plan: P): void
}

/** Lancement d'une entry de `mjs ws` ou `mjs serveur`, rechargement à chaud et arrêt propre — partagé par les deux commandes. */
export async function runEntryServer<C, P extends { setup?: (app: A) => unknown }, A extends { listen(): Promise<unknown>, stop(): Promise<unknown> }>(
  root: string,
  entryPath: string,
  watch: boolean | undefined,
  spec: EntryServerSpec<C, P, A>,
): Promise<{ readonly app: A, readonly entryPath: string, stop(): Promise<void> }> {
  const logger    = createLogger()

  async function boot(): Promise<A> {
    const mod      = await importEntryModule(entryPath, root)
    const contract = spec.readContract(mod, entryPath, logger.warn)
    const plan     = spec.buildPlan(contract, logger.warn)
    const app      = spec.create(plan, logger.log)
    if (plan.setup) await plan.setup(app)
    await app.listen()
    spec.banner(logger, plan)
    return app
  }

  let currentApp = await boot()

  // rechargement à chaud (cf. commentaire de tête) — import D'ABORD, l'ancien
  // serveur n'est arrêté QUE si le nouveau module est valide.
  //
  // sérialisation à GÉNÉRATION : le watcher (debounce 150ms,
  // ci-dessous) peut redéclencher PENDANT qu'un reload() tourne encore (import + listen
  // asynchrones) — sans garde, deux reload() concurrents pouvaient se disputer le port ou
  // appliquer un import PÉRIMÉ après un plus récent. Fix à trois variables : `reloadGeneration`
  // (bumpée à CHAQUE déclenchement du debounce), `reloadRunning` (verrou — un seul reload() en
  // vol), `reloadPending` (booléen, PAS une file : une rafale de N déclenchements pendant un
  // rechargement en vol ne produit qu'UN SEUL rechargement de plus, sur la génération la plus
  // fraîche AU MOMENT où il démarre). Un import qui résout APRÈS avoir été dépassé (une
  // génération plus récente existe déjà) est jeté SANS toucher currentApp — reloadPending
  // garantit qu'un rechargement frais suit de toute façon. Règle existante conservée : l'ancien
  // serveur continue si le nouveau casse (try/catch inchangés ci-dessous).
  let reloadGeneration = 0
  let reloadRunning    = false
  let reloadPending    = false
  // Posé par shutdown() (cf. plus bas) — un rechargement qui voit ce
  // drapeau APRÈS avoir démarré son NOUVEAU serveur (`app.listen()` déjà réussi) le referme
  // aussitôt SANS jamais l'exposer (ni `currentApp`, ni le message « redémarré ») : sans ce
  // garde-fou, un import lent encore en vol au moment d'un Ctrl-C finissait par (re)brancher un
  // serveur sur le port/transport APRÈS que l'arrêt se soit déjà annoncé terminé.
  let shuttingDown     = false
  // Rechargement EN VOL (import/contrat/stop/listen asynchrones) — attendu par shutdown() avant
  // de fermer `currentApp` : sans lui, l'arrêt pouvait fermer une app sur le point d'être
  // remplacée (ou l'inverse), et surtout rendait AVANT que ce rechargement n'ait fini de décider
  // du sort de son propre serveur.
  let reloadInFlight: Promise<void> | null = null

  function scheduleReload(): void {
    if (shuttingDown) return   // arrêt déjà demandé : aucun nouveau cycle de rechargement
    reloadGeneration++
    if (reloadRunning) { reloadPending = true; return }
    runReloadLoop()
  }

  function runReloadLoop(): void {
    reloadRunning = true
    const myGeneration = reloadGeneration
    reloadInFlight = reload(myGeneration).finally(() => {
      reloadRunning = false
      if (reloadPending && !shuttingDown) { reloadPending = false; runReloadLoop() }
    })
  }

  async function reload(myGeneration: number): Promise<void> {
    let mod: any
    try {
      mod = await importEntryModule(entryPath, root)
    } catch (err) {
      // périmé : une génération plus fraîche est déjà en jeu (reloadPending la reprendra) —
      // l'erreur porte sur un contenu déjà dépassé, plus la peine d'en informer
      if (myGeneration === reloadGeneration) {
        logger.error(t('cli.reload-import-echec', { erreur: errText(err) }))
      }
      return
    }
    if (myGeneration !== reloadGeneration) return   // import périmé — jeté même réussi (cf. commentaire ci-dessus)
    let contract: C
    try {
      contract = spec.readContract(mod, entryPath, logger.warn)
    } catch (err) {
      logger.error(t('cli.reload-echec-generique', { erreur: errText(err) }))
      return
    }
    try {
      const plan = spec.buildPlan(contract, logger.warn)
      // nouvelle app montée et son `setup()` joué AVANT d'arrêter l'ancienne (seul `listen()` exige
      // le port) : un `setup()` qui jette (variable d'environnement manquante, faute) laisse
      // l'ancien serveur en service au lieu d'un processus vivant qui n'écoute plus rien
      const app = spec.create(plan, logger.log)
      try {
        if (plan.setup) await plan.setup(app)
      } catch (err) {
        await Promise.resolve().then(() => app.stop()).catch(() => {})
        logger.error(t('cli.reload-setup-echec', { erreur: errText(err) }))
        return
      }
      await currentApp.stop()
      await app.listen()
      // Un arrêt a été demandé PENDANT cet import/listen : ce nouveau serveur ne doit JAMAIS
      // devenir `currentApp` ni rester en écoute — refermé aussitôt (l'ancien est déjà arrêté par
      // le `currentApp.stop()` ci-dessus ou par shutdown() lui-même), sans le moindre message.
      if (shuttingDown) { await app.stop().catch(() => {}); return }
      currentApp = app
      logger.info(t('cli.redemarre', { chemin: relative(root, entryPath) || entryPath }))
    } catch (err) {
      // hors contrat explicite (§7.6 ne garantit le zéro-coupure QUE sur l'import)
      // — filet de sécurité : ne jamais planter le process en silence.
      logger.error(t('cli.reload-echec-fatal', { erreur: errText(err) }))
    }
  }

  let watcher: ReturnType<typeof fsWatch> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  // production : le fichier d'entrée n'est pas surveillé (un déploiement redémarre le service)
  if (watch ?? process.env.NODE_ENV !== 'production') {
    const dir = dirname(entryPath)
    watcher = fsWatch(dir, { persistent: true, recursive: false }, (_event, filename) => {
      if (!filename || !WATCHED_EXT.test(filename)) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { debounceTimer = null; scheduleReload() }, RELOAD_DEBOUNCE_MS)
    })
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true
    if (watcher) { watcher.close(); watcher = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    // Un rechargement EN VOL (import/listen asynchrones) doit finir de décider du sort de SON
    // serveur (cf. `if (shuttingDown)` dans reload() ci-dessus) avant qu'on ferme `currentApp` —
    // sinon celui-ci pourrait encore désigner l'ANCIEN serveur pendant que le nouveau, lui,
    // continue de s'installer en tâche de fond.
    if (reloadInFlight) await reloadInFlight.catch(() => {})
    await currentApp.stop()
    // écouteurs retirés APRÈS la fermeture, jamais avant : retirés dès l'entrée, le gestionnaire
    // de signaux de tsx (lancement depuis les sources) ne voyait plus aucun écouteur et sortait
    // aussitôt en 130, serveur jamais refermé
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
  // un seul arrêt ordonné (le même Ctrl+C reçu deux fois attend le premier), sortie bornée par
  // SHUTDOWN_GRACE_MS ; un 2e Ctrl+C plus d'une seconde après sort aussitôt (cf. gardeArret)
  const onSignal = gardeArret((): void => {
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref()
    void shutdown().then(() => process.exit(0))
  }, () => process.exit(0))
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  return {
    get app() { return currentApp },
    entryPath,
    stop: shutdown,
  }
}
