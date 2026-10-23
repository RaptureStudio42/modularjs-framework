// cli/server — commande `mjs serveur` : lance le serveur de jeu (MJS-Server, mjsServer() +
// app.game()) d'une appli à partir d'un fichier d'entry (`export default { …options mjsServer(),
// setup(app) }`). Commande SŒUR de `mjs ws` (cli/ws.ts, MJS-WS) — MÊME contrat, MÊME format
// d'entry, MÊME dialecte Civet des composants pour `.server.mjs`, MÊME rechargement à chaud —
// SEULE différence : `setup(app)` reçoit une app construite par `mjsServer()` (qui expose
// `.game()`), pas `mjsWs()`. Cf. docs/24-mjs-server.md §2 « Démarrer ».
//
// Briques PARTAGÉES avec cli/ws.ts (une seule logique pour les deux commandes) : contrat d'entry (readEntryContractOf),
// plan de fusion entry/config (buildRunPlanOf, + `antiCheat`, propre à MJS-Server), bannière (printEntryBanner), lancement,
// rechargement à chaud et arrêt (runEntryServer, qui importe l'entry par importEntryModule). Propres à MJS-Server : résolution
// d'entry (défauts propres, AUCUNE collision avec ceux de `mjs ws` — les deux commandes coexistent dans un même projet), port par
// défaut, ligne anti-triche de la bannière, fabrique (TOUJOURS `mjsServer()`, jamais `mjsWs()`).
//
// Résolution de l'entry : --entry > mjs.config.json `serveur.entry` > défauts
// `serveur.server.mjs` > `server/serveur.server.mjs` > `serveur.js` > `serveur.civet` >
// `server/serveur.js` > `server/serveur.civet`, relatifs à la racine du projet (dossier de mjs.config.json, à défaut --root).
//
// Contrat de l'entry : `export default` = OBJET, clés acceptées = options de mjsServer()
// (= options mjsWs() + `persist`/`antiTriche`) sauf port/host/onLog (réservées au CLI, ignorées
// avec un warn — MÊME liste que `mjs ws`), plus `setup(app)` optionnelle (sync ou async), reçoit
// l'app construite par `mjsServer()`.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mjsServer } from '../mjs-server/index.js'
import type { MjsServerApp, MjsServerOptions } from '../mjs-server/index.js'
import type { MjsWsLimits } from '../mjs-ws/index.js'
import type { MjsConfig, ServeurConfig } from '../bundler/config.js'
import { readEntryContractOf, buildRunPlanOf, SHARED_PLAN_KEYS, printEntryBanner, runEntryServer } from './ws.js'
import type { CliLogger } from './ws.js'
import { t } from '../messages/index.js'

// --- squelette imprimé quand aucune entry n'est trouvée ---------------------

// dialecte Civet des composants (MÊME pré-passe que `ws.server.mjs`, cf. cli/ws.ts) —
// app.game(...) via setup(app) : l'app est construite par le CLI (mjsServer), AUCUN import
// dans le squelette (l'entry est chargée par data: URL → un import npm y planterait, cf. ws)
const ENTRY_SKELETON = `export default
  setup: (app) ->
    app.game 'morpion',
      seats: 2
      state: (partie) -> { grille: Array(9).fill(null) }
      moves:
        jouer: (partie, joueur, p) ->
          partie.state.grille[p.i] = joueur.id
          partie.next()
`

// ordre de résolution des défauts : serveur.server.mjs > server/serveur.server.mjs >
// serveur.js > serveur.civet > server/serveur.js > server/serveur.civet — AUCUN chevauchement
// avec ENTRY_DEFAULTS de `mjs ws` (ws.*) : les deux commandes résolvent chacune leur propre
// fichier dans un même projet, sans jamais se marcher dessus.
const SERVEUR_ENTRY_DEFAULTS = ['serveur.server.mjs', 'server/serveur.server.mjs', 'serveur.js', 'serveur.civet', 'server/serveur.js', 'server/serveur.civet']

function entryNotFoundMessage(reason: string): string {
  return t('cli.serveur.entry-introuvable', { raison: reason, squelette: ENTRY_SKELETON })
}

/** Résout le chemin ABSOLU de l'entry — --entry > serveur.entry (config) > serveur.server.mjs >
 *  server/serveur.server.mjs > serveur.js > serveur.civet > server/serveur.js > server/serveur.civet. */
export function resolveServeurEntryPath(root: string, cliEntry: string | undefined, configEntry: string | undefined): string {
  if (cliEntry !== undefined) {
    const p = resolve(root, cliEntry)
    if (!existsSync(p)) throw new Error(entryNotFoundMessage(t('cli.entry-cli-introuvable', { cliEntry, chemin: p })))
    return p
  }
  if (configEntry !== undefined) {
    const p = resolve(root, configEntry)
    if (!existsSync(p)) throw new Error(entryNotFoundMessage(t('cli.entry-config-introuvable', { champ: 'serveur.entry', valeur: configEntry, chemin: p })))
    return p
  }
  for (const rel of SERVEUR_ENTRY_DEFAULTS) {
    const p = resolve(root, rel)
    if (existsSync(p)) return p
  }
  throw new Error(entryNotFoundMessage(t('cli.entry-aucun-trouve', { liste: SERVEUR_ENTRY_DEFAULTS.join(', '), racine: root })))
}

// --- contrat de l'entry : export default = objet, clés mjsServer() + setup(app) -----------

export interface ServeurEntryContract {
  options: MjsServerOptions
  setup?: (app: MjsServerApp) => unknown
}

/** Valide + isole le contrat d'un module d'entry déjà importé (`mod` = namespace ES) — MÊME
 *  règle que readEntryContract (cli/ws.ts) : RESERVED_ENTRY_KEYS (port/host/onLog) réutilisée
 *  telle quelle, `setup` doit être une fonction si présente. */
export function readServeurEntryContract(mod: any, entryPath: string, warn: (message: string) => void): ServeurEntryContract {
  return readEntryContractOf<MjsServerOptions, MjsServerApp>('mjs serveur', mod, entryPath, warn)
}

// --- priorités port/host/heartbeat/limits/antiTriche : entry > config > défauts CLI ---------

export interface ServeurRunPlan {
  options: MjsServerOptions
  setup?: (app: MjsServerApp) => unknown
  port: number
  host?: string
  heartbeat: number
  limits: MjsWsLimits
}

// port par défaut DISTINCT de `mjs ws` (4000) — les deux commandes peuvent tourner en même temps
// dans un même projet (ex. chat MJS-WS + lobby MJS-Server), sur des ports différents par défaut.
const DEFAULT_SERVEUR_PORT = 4001

/** Fusionne le contrat de l'entry + la section `serveur` de la config + --port/--host — l'ENTRY
 *  prime EN BLOC sur chaque clé partagée (warn si doublon) — MÊME règle que buildRunPlan (cli/ws.ts).
 *  `cliHost` : dernier paramètre, OPTIONNEL — même patron que buildRunPlan. */
export function buildServeurRunPlan(
  contract: ServeurEntryContract,
  serveurConfig: ServeurConfig | undefined,
  cliPort: number | undefined,
  warn: (message: string) => void,
  cliHost?: string,
): ServeurRunPlan {
  // antiCheat (propre à MJS-Server) : MÊME règle que les clés héritées, l'entry prime EN BLOC
  return buildRunPlanOf(contract, serveurConfig, 'serveur', [...SHARED_PLAN_KEYS, 'antiCheat'], DEFAULT_SERVEUR_PORT, cliPort, warn, cliHost)
}

// --- bannière ------------------------------------------------------------------

function printBanner(logger: CliLogger, entryPath: string, root: string, plan: ServeurRunPlan): void {
  printEntryBanner(logger, 'MJS-Server', entryPath, root, plan, plan.host ? ` (${plan.host})` : '', () => {
    if (plan.options.antiCheat?.movesPerIdentity) {
      const [n, fenetre] = plan.options.antiCheat.movesPerIdentity
      logger.info(t('cli.serveur.anti-triche', { n, fenetre: fenetre / 1000 }))
    }
  })
}

// --- commande -----------------------------------------------------------------

export interface ServeurCommandArgs {
  root: string
  entry?: string
  port?: number
  /** posé par le flag générique --host (src/cli.ts), prioritaire sur serveur.host
   *  de la config — cf. buildServeurRunPlan. */
  host?: string
}

export interface ServeurCommandInjections {
  /** transport custom — MemoryTransport pour les tests (jamais de vrai port lié) */
  transport?: MjsServerOptions['transport']
  /** désactive le fs.watch (défaut true) — tests qui n'exercent pas le rechargement */
  watch?: boolean
}

export interface ServeurRunHandle {
  /** app COURANTE — change de référence après un rechargement à chaud réussi */
  readonly app: MjsServerApp
  readonly entryPath: string
  /** arrêt propre : watcher + timer + listeners signal + app.stop() (µ:bye) — SANS process.exit, réutilisé par le handler SIGINT et par les tests */
  stop(): Promise<void>
}

export async function runServeurCommand(
  args: ServeurCommandArgs,
  config: MjsConfig | undefined,
  injections: ServeurCommandInjections = {},
): Promise<ServeurRunHandle> {
  const entryPath = resolveServeurEntryPath(args.root, args.entry, config?.serveur?.entry)
  const transport = injections.transport
  return runEntryServer(args.root, entryPath, injections.watch, {
    readContract: readServeurEntryContract,
    buildPlan:    (contract: ServeurEntryContract, warn) => buildServeurRunPlan(contract, config?.serveur, args.port, warn, args.host),
    create:       (plan: ServeurRunPlan, onLog) => mjsServer({ ...plan.options, transport: transport ?? plan.options.transport, port: plan.port, host: plan.host, onLog }),
    banner:       (logger, plan: ServeurRunPlan) => printBanner(logger, entryPath, args.root, plan),
  })
}
