// cli — entrypoint exécutable. Branché par bin/mjs.

import { join, resolve, relative, dirname, extname, basename } from 'node:path'
import { isComponentFile } from './bundler/class-files.js'
import { existsSync, readdirSync, readFileSync, statSync, realpathSync, accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { Bundler, type CompileStats } from './bundler/index.js'
import type { ClassifiedDerived } from './analyzer/derived-classes.js'
import { StaticServer } from './server/index.js'
import { findConfig, resolveBundlerOpts, rejectManifestPath, pathInDir } from './bundler/config.js'
import { runInit } from './cli/init.js'
import { runWsCommand } from './cli/ws.js'
import { runServerCommand } from './cli/server.js'
import { syncAgentsMd } from './cli/agents-md.js'
import { startCheckJson, countWarningLines } from './cli/check-json.js'
import { FaultListing } from './cli/check-faults.js'
import { flushWorkerOutput } from './bundler/worker-pool.js'
import { runMcp } from './cli/mcp.js'
import { acquireDevLock, stopGuard, SHUTDOWN_GRACE_MS } from './cli/dev-lock.js'
import { prerenderPages } from './server/prerender.js'
import { emitStartup, latestBundler } from './bundler/startup.js'
import { createDevPrerenderScheduler } from './cli/dev-prerender.js'
import { startRenderServer } from './server/render-server.js'
import { createRenderHandler } from './server/render-request.js'
import { createJournal, type RecordServerFn } from './server/journal.js'
import { createServeEntry } from './server/serve-entry.js'
import { readBuildVersion } from './server/build-version.js'
import { t } from './messages/index.js'
import { resolveColorsEnabled, paintError, typedLine, printDiagnostic, printedTypedLines } from './diagnostics.js'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// version du paquet mjs LUI-MÊME, lue au runtime dans son package.json — `../package.json` vaut
// depuis les DEUX entrées possibles : `src/cli.ts` (dev, lancé par tsx) et `dist/cli.js` (build
// esbuild, `--format=esm` préserve `import.meta.url`). Pas d'import statique du JSON : esbuild le
// figerait dans le bundle, et un `npm version` sans `build:self` annoncerait l'ancien numéro
function readPackageVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null
  } catch { return null }
}

// hasComponents — y a-t-il au moins un `.mjs` sous `dir` ? Sert à la seule garde du build :
// aucun composant veut dire qu'il n'y a RIEN à construire, et un build qui n'a rien construit
// ne doit pas écrire un manifeste vide par-dessus celui d'un site en place.
// MÊME PARCOURS que `Bundler.findFiles` (bundler/index.ts) — `statSync` et non le `Dirent`,
// donc les liens symboliques sont SUIVIS, et `realpathSync` ferme les cycles : avec un
// `isDirectory()` de Dirent, un dossier de composants atteint par un lien était compté zéro,
// et la garde refusait un projet parfaitement valide que le bundler, lui, aurait construit
// (trouvé en testant).
function hasComponents(dir: string): boolean {
  const stack    = [dir]
  const seenDirs = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    let real: string
    try { real = realpathSync(current) } catch { continue }   // lien cassé — cette branche seulement
    if (seenDirs.has(real)) continue
    seenDirs.add(real)
    for (const name of readdirSync(current)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const path = join(current, name)
      let st
      try { st = statSync(path) } catch { continue }
      if (st.isDirectory()) stack.push(path)
      // MÊME EXCLUSION que le bundler (`!basename(f, '.mjs').startsWith('_')`) : un partial
      // `_entete.mjs` n'est PAS un composant, seulement du contenu à inclure. Les compter faisait
      // passer la garde à un dossier qui n'en contient que — et rendait exactement le sinistre
      // qu'elle existe pour empêcher : « ✅ 2 fichiers écrits », code 0, `µ.paths = {}`.
      else if (isComponentFile(name) && !name.startsWith('_') && st.size > 0) return true
    }
  }
  return false
}

// readI18nLanguages — langues RÉELLEMENT présentes sous `i18nDir`, UN dictionnaire
// VIDE reste PRÉSENT dans la liste mais sous un libellé distinct « <langue> (vide) » : un
// fichier racine `<langue>.{yml,yaml,json}` OU un sous-dossier `<langue>/` (sections), MÊME
// convention que scanI18n (bundler/index.ts) — AUPARAVANT, seule la PRÉSENCE comptait : un `fr.yml`
// VIDE (0 octet, ou `{}`) avec `i18n.default: 'fr'` comptait `fr` « trouvée » (sous son vrai nom),
// taisant l'avertissement juste après (`langues.includes(i18n.default)` vrai). Retirer purement
// l'entrée aurait cassé le garde-fou JUMEAU du même appelant (cli.ts, GARDE i18n.default) qui reste
// SILENCIEUX quand `langues.length === 0` (« aucun dictionnaire encore écrit ») : un dossier i18n/
// qui ne contient QUE ce fichier vide se serait alors retrouvé, à tort, dans ce cas-là. Le suffixe
// garde `langues.length` correct (le dossier N'EST PAS vide) tout en faisant échouer
// `langues.includes(default)` pour la langue vide (jamais égale à son propre libellé suffixé) —
// et se lit tel quel dans le message d'avertissement (`langues présentes : fr (vide)`). Un
// sous-dossier de sections garde son ancien comportement (présence seule, hors périmètre).
function readI18nLanguages(i18nDir: string): string[] {
  const langs = new Set<string>()
  for (const entry of readdirSync(i18nDir)) {
    let st
    try { st = statSync(join(i18nDir, entry)) } catch { continue }
    if (st.isFile()) {
      const ext = extname(entry)
      if (ext !== '.yml' && ext !== '.yaml' && ext !== '.json') continue
      const lang = basename(entry, ext)
      langs.add(isEmptyI18nDict(join(i18nDir, entry), ext) ? `${lang} (vide)` : lang)
    } else if (st.isDirectory()) {
      langs.add(entry)
    }
  }
  return Array.from(langs)
}

// isEmptyI18nDict — mêmes formats que le bundler (YAML via le paquet
// OPTIONNEL `yaml`, JSON via JSON.parse, cf. parseI18nFile/scanI18n, bundler/index.ts). Lecture ou
// parse en échec : reste PERMISSIF (pas « vide », donc pas de faux avertissement) — cette garde
// n'est qu'un avertissement, le VRAI échec de parsing remonte, lui, au build réel avec son détail.
function isEmptyI18nDict(path: string, ext: string): boolean {
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch { return false }
  if (raw.trim() === '') return true
  try {
    const parsed = ext === '.json' ? JSON.parse(raw) : createRequire(import.meta.url)('yaml').parse(raw)
    return parsed === null || parsed === undefined || (typeof parsed === 'object' && Object.keys(parsed).length === 0)
  } catch {
    return false
  }
}

// FS_ERROR_CODES — codes d'erreur Node dont le SENS est connu et vaut la peine d'être nommé au
// dev (ENOTDIR/EISDIR ajoutés) : au-delà de ceux-ci, une erreur vraiment
// inattendue garde sa trace complète (console.error('❌', e), comportement historique) — jamais
// moins d'information. ENOTDIR/EISDIR : défense en profondeur pour un `--output`/`--manifest` qui
// échapperait encore à `checkWritablePath` ci-dessous (ex. devient un fichier/dossier ENTRE la
// vérification et l'écriture réelle, TOCTOU) — le cas COURANT (`--output` = fichier existant) est
// désormais intercepté AVANT toute compilation, cf. `checkWritablePath`.
const FS_ERROR_CODES = new Set(['EACCES', 'EPERM', 'ENOENT', 'EROFS', 'ENOSPC', 'ENOTDIR', 'EISDIR'])

// checkWritablePath — `--output`/`--manifest` acceptent n'importe quel
// chemin (usage légitime, cf. cli-build-prerender-overrides.test.ts — un déploiement peut
// rediriger la sortie hors du projet) ; mais un EACCES en écriture tombait tout en bas du
// fichier, stack Node BRUTE, seule exception du catalogue. Remonte au plus proche ANCÊTRE
// EXISTANT de `target` (le reste sera créé par mkdirSync récursif) et vérifie qu'il est
// accessible en écriture — message catalogue nommé AVANT de lancer la moindre compilation.
// `mustBeDir` : `--output` DOIT être un dossier ou ne pas
// exister (mkdirSync le crée) — un `--output` pointant vers un FICHIER existant passait
// `accessSync` (le fichier EST accessible en écriture) et n'échouait que plus tard, en pleine
// compilation (`ENOTDIR` au premier `readdirSync` dedans), stack Node brute. `--manifest`, lui,
// DÉSIGNE normalement un fichier — active `mustBeFile` : la
// contrainte SYMÉTRIQUE, un dossier déjà présent à cet emplacement n'échouait, lui, qu'en PLEINE
// compilation (`EISDIR` au premier `readFileSync`/`writeFileSync` du manifeste), stack Node brute,
// une partie de `outputDir` déjà écrite au moment du plantage.
function checkWritablePath(target: string, key: string, mustBeDir = false, mustBeFile = false): void {
  const resolved = resolve(target)
  if (mustBeDir && existsSync(resolved) && !statSync(resolved).isDirectory()) {
    console.error(t('cli.output-must-be-dir', { key: key, path: resolved }))
    process.exit(1)
  }
  if (mustBeFile && existsSync(resolved) && statSync(resolved).isDirectory()) {
    console.error(t('cli.manifest-must-be-file', { key: key, path: resolved }))
    process.exit(1)
  }
  let ancestor = resolved
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) break   // racine du système atteinte, jamais de boucle infinie
    ancestor = parent
  }
  try {
    accessSync(ancestor, constants.W_OK)
  } catch (e: any) {
    console.error(t('cli.path-not-writable', { key: key, path: target, ancestor, error: e?.message || e }))
    process.exit(1)
  }
}

// les avertissements écrits sur la sortie d'erreur avant le bilan (a11y…, threads de travail compris), relevés depuis le début
// de la commande : posé par `mjs build`, `mjs check` et `mjs dev`, lu puis retiré à la fin de la compilation (cf. settleWarningLines)
let warningLines = null as ReturnType<typeof countWarningLines> | null

// le nombre relevé, pris une fois : le relevé est retiré
function takeWarningLines(): number {
  const n = warningLines?.count() ?? 0
  warningLines?.stop()
  warningLines = null
  return n
}

// fin d'une compilation, avant d'en écrire les erreurs et le bilan : les lignes des fils d'exécution sont toutes écrites (au-delà de
// 40 fichiers ils écrivent eux-mêmes leurs avertissements, à leur rythme, cf. bundler/worker-pool.ts), puis le relevé est pris. Un
// fil qui ne répond plus n'est attendu que le délai d'un fichier (cf. WorkerPool.flush) : le relevé compte ce qui est arrivé. Pris
// ICI, avant que la commande écrive les erreurs : une erreur étiquetée `[lint.<type>]` ("emptyComponent": "error") n'est pas un
// avertissement
async function settleWarningLines(): Promise<number> {
  await flushWorkerOutput()
  return takeWarningLines()
}

// bilan des avertissements de `mjs build` et `mjs check` : leur nombre — les lignes de `stats.warnings` et celles déjà écrites
// plus haut (`direct`, relevé à la fin de la compilation, cf. settleWarningLines), le nombre d'entrées que rend `mjs check --json` —, les lignes de `stats.warnings`, puis
// l'aide UNE fois dès qu'une ligne étiquetée `[lint.<type>]` est sortie — celles de ce bilan comme
// celles imprimées en direct pendant la compilation (a11y…, threads de travail compris)
function printWarningsSummary(bundler: Bundler, stats: CompileStats, direct: number): void {
  if (stats.warnings.length > 0) {
    bundler.buildWarn(t('cli.warnings-title', { count: stats.warnings.length + direct, above: direct }))
    for (const w of stats.warnings) bundler.buildWarn('   '+ w)
  }
  if ((stats.lintPrinted ?? 0) > 0 || printedTypedLines() > 0) bundler.buildWarn(t('cli.lint-help-disable'))
}

// `mjs check --derived` : le mode de l'appli (option `derived` de mjs.config.json) et sa légende — à l'horloge, ce que la précision
// changerait —, puis par fichier, chaque valeur dérivée, sa classe (« précise » ou « horloge ») et ses raisons, puis le total et le
// compte des raisons (une dérivée compte une fois par raison) ; un fichier sans dérivée n'est pas listé
function printDerivedReport(derived: Map<string, ClassifiedDerived[]>, root: string, precise: boolean): void {
  const files = [...derived].filter(([, l]) => l.length > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  console.log(precise ? t('cli.derived-title-precise') : t('cli.derived-title-clock'))
  if (files.length === 0) {
    console.log(t('cli.derived-none'))
    console.log(``)
    return
  }
  let total      = 0
  let precises   = 0
  const byReason = new Map<string, number>()
  for (const [file, list] of files) {
    console.log(`   ${relative(root, file)}`)
    const large = Math.max(...list.map((d) => d.name.length + 1))
    for (const d of list) {
      total++
      const name = ('$' + d.name).padEnd(large)
      if (d.class === 'precise') {
        precises++
        console.log(`      ${name}  ${t('cli.derived-precise')}`)
        continue
      }
      console.log(`      ${name}  ${t('cli.derived-clock')} — ${d.reasons.map((r) => t('cli.derived-reason', { code: r.code, name: r.name, by: r.by })).join(' ; ')}`)
      for (const code of new Set(d.reasons.map((r) => r.code))) byReason.set(code, (byReason.get(code) ?? 0) + 1)
    }
  }
  const detail = [...byReason].sort((a, b) => b[1] - a[1]).map(([code, count]) => t('cli.derived-reason-short', { code, count: count })).join(', ')
  console.log(t('cli.derived-total', { count: total, files: files.length, precise: precises, clocks: total - precises, detail }))
  console.log(``)
}

function printBuildReport(stats: CompileStats): void {
  // Un build avec des erreurs affichait QUAND MÊME la ligne ✅ juste
  // en dessous (rien ne distinguait « succès » de « succès partiel, N cassés
  // repêchés » au premier coup d'œil) : la ligne d'échec passe maintenant
  // AVANT, toujours visible même si stats.sizes est vide.
  // les erreurs listées plus bas (une faute d'un fichier importé y est dite une fois), puis les composants en échec
  if (stats.errors.length > 0) console.log(t('cli.build-report-failures', { count: stats.errors.length, components: stats.failedComponents ?? 0 }))
  console.log(t('cli.build-report', { count: stats.written, ms: stats.durationMs }))
  if (stats.sizes.length === 0) return

  // Top 10 par taille (le bundle, le runtime, les composants les plus gros)
  console.log(``)
  const top = stats.sizes.slice(0, 10)
  const maxName = Math.max(...top.map(s => s.name.length))
  for (const s of top) {
    console.log(`   ${s.name.padEnd(maxName)}  ${fmtBytes(s.bytes).padStart(8)}`)
  }
  if (stats.sizes.length > 10) {
    const rest = stats.sizes.slice(10)
    const restBytes = rest.reduce((a, b) => a + b.bytes, 0)
    const label = t('cli.n-more', { count: rest.length })
    console.log(`   ${label.padEnd(maxName)}  ${fmtBytes(restBytes).padStart(8)}`)
  }
  const total = stats.sizes.reduce((a, b) => a + b.bytes, 0)
  console.log(`   ${'─'.repeat(maxName + 10)}`)
  console.log(`   ${'TOTAL'.padEnd(maxName)}  ${fmtBytes(total).padStart(8)}`)
}

const USAGE = t('cli.usage')

const COMMANDS = ['init', 'build', 'dev', 'check', 'serve', 'ws', 'server', 'mcp'] as const

// distance d'édition (insertion, suppression, substitution, transposition de deux voisins)
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

// commande la plus proche d'un mot mal tapé, ou null si aucune n'est assez proche
function closestCommand(word: string): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const c of COMMANDS) {
    const dist = c.startsWith(word.toLowerCase()) ? 1 : editDistance(word.toLowerCase(), c)
    if (dist < bestDist) { best = c; bestDist = dist }
  }
  return bestDist <= 2 ? best : null
}

interface Args {
  command: 'init' | 'build' | 'dev' | 'check' | 'serve' | 'ws' | 'server' | 'mcp'
  root: string
  manifest?: string
  output?: string
  port?: number
  /** --host : hôte pour `mjs ws` et `mjs server` — cf. WsCommandArgs.host,
   *  cli/ws.ts et ServerCommandArgs.host, cli/server.ts */
  host?: string
  entry?: string
  help?: boolean
  /** `-v`/`--version` : imprime la version du paquet mjs et sort */
  version?: boolean
  /** `--dev`/`--prod` : l'environnement du build. Absent ⇒ développement. */
  env?: 'dev' | 'prod'
  /** `--derived` : `mjs check` classe chaque valeur dérivée (précise ou horloge, cf. printDerivedReport) */
  derived?: boolean
  /** `--json` : `mjs check` rend un seul document JSON, erreurs et avertissements en objets (cf. cli/check-json.ts) */
  json?: boolean
  /** `--cache` : `mjs build` ne recompile que les fichiers changés depuis la construction d'avant (cf. Bundler.loadDiskCache) */
  /** `--cache=verify` : la même construction, puis comparée à l'octet à une construction complète (cf. Bundler.verifyDiskCache) */
  cache?: boolean | 'verify'
  /** premier mot qui n'est ni une commande ni un drapeau : refusé par run(), jamais un build */
  unknownCommand?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: 'build', root: process.cwd() }
  let i = 0
  // Récupère la valeur SUIVANT un flag en validant qu'elle existe et n'est pas
  // elle-même un flag. Sans ça, `--port` sans valeur → parseInt(undefined)=NaN
  // → listen(NaN) ; `--output --port 3000` mangeait `--port` comme valeur.
  const value = (flag: string): string | undefined => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('-')) {
      console.warn(t('cli.flag-value-missing', { flag }))
      return undefined
    }
    i++ // consomme la valeur
    return v
  }
  while (i < argv.length) {
    const a = argv[i]
    if ((COMMANDS as readonly string[]).includes(a)) {
      args.command = a as Args['command']
    } else if (a === '--root') {
      const v = value('--root'); if (v !== undefined) args.root = v
    } else if (a === '--manifest') {
      const v = value('--manifest'); if (v !== undefined) args.manifest = v
    } else if (a === '--output') {
      const v = value('--output'); if (v !== undefined) args.output = v
    } else if (a === '--entry') {
      const v = value('--entry'); if (v !== undefined) args.entry = v
    } else if (a === '--port') {
      const v = value('--port')
      if (v !== undefined) {
        const p = parseInt(v, 10)
        if (Number.isFinite(p)) args.port = p
        else console.warn(t('cli.port-invalid', { value: v }))
      }
    } else if (a === '--host') {
      // hôte, pour `mjs ws` et `mjs server` — les autres commandes ignorent args.host
      const v = value('--host'); if (v !== undefined) args.host = v
    } else if (a === '--once') {
      args.command = 'build'
    } else if (a === '--dev') {
      args.env = 'dev'
    } else if (a === '--prod') {
      args.env = 'prod'
    } else if (a === '--derived') {
      args.derived = true
    } else if (a === '--json') {
      args.json = true
    } else if (a === '--cache') {
      args.cache = true
    } else if (a === '--cache=verify') {
      args.cache = 'verify'
    } else if (a === '-h' || a === '--help') {
      args.help = true
    } else if (a === '-v' || a === '--version') {
      args.version = true
    } else {
      // Tout argument non reconnu
      // (flag inconnu type `--minify`/`--otuput` typo, ou mot-clé de
      // commande mal orthographié) était silencieusement IGNORÉ, sans le
      // moindre warning : un flag tapé de travers n'a jamais d'effet, et
      // rien ne le signale — le dev le découvre bien plus tard en
      // constatant que l'option attendue n'a "pour une raison inconnue"
      // pas été appliquée. Un MOT inconnu (commande mal tapée) n'est plus un simple avertissement :
      // la commande par défaut (`build`) écrasait la sortie, cf. run().
      if (a.startsWith('-')) console.warn(t('cli.flag-unknown', { arg: a }))
      else args.unknownCommand ??= a
    }
    i++
  }
  return args
}

async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  // `-v`/`--version` répond AVANT tout le reste — ni chdir, ni lecture de config, ni Bundler :
  // c'est la première commande que tape un inconnu, elle doit marcher depuis n'importe quel
  // dossier, y compris vide. Version ILLISIBLE = échec dit et code 1, jamais un numéro inventé
  if (args.version) {
    const version = readPackageVersion()
    if (version === null) {
      console.error(t('cli.version-unreadable'))
      process.exit(1)
    }
    console.log(t('cli.version', { version }))
    process.exit(0)
  }
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  // commande mal tapée (`mjs biuld`, `mjs serv`) : refusée AVANT tout — retomber sur `build`
  // écrasait la sortie servie par un build de développement, avec un code 0
  if (args.unknownCommand !== undefined) {
    console.error(t('cli.command-unknown', { command: args.unknownCommand }))
    const near = closestCommand(args.unknownCommand)
    if (near) console.error(t('cli.command-suggestion', { command: near }))
    else console.error(t('cli.command-see-help'))
    process.exit(1)
  }
  // `--derived` ne vaut que pour `mjs check` : ailleurs, dit plutôt qu'ignoré sans un mot
  if (args.derived && args.command !== 'check') console.warn(t('cli.derived-outside-check', { command: args.command }))
  // `--json` : même règle que `--derived`
  if (args.json && args.command !== 'check') console.warn(t('cli.json-outside-check', { command: args.command }))
  // `--cache` ne vaut que pour `mjs build` : même règle
  if (args.cache && args.command !== 'build') console.warn(t('cli.cache-outside-build', { command: args.command }))
  // capture posée AVANT tout le reste : la sortie standard ne portera que le document, refus avant compilation compris
  const checkJson = args.json && args.command === 'check' ? startCheckJson(readPackageVersion()) : null
  if (!checkJson && (args.command === 'build' || args.command === 'check' || args.command === 'dev')) warningLines = countWarningLines()

  // Résolu en ABSOLU AVANT le chdir : `mjs ws`/`mjs server` repassent `args.root` tel quel à
  // resolveEntryPath (cli/ws.ts, cli/server.ts) — un `--root child` RELATIF, encore relatif après
  // ce chdir, se voit alors ré-ancré depuis le cwd DÉJÀ déplacé (<root>/child/child/…, introuvable).
  // Un chemin déjà absolu traverse `resolve()` inchangé, aucune régression pour l'usage courant.
  if (args.root) {
    args.root = resolve(args.root)
    // racine absente ou fichier : dit tel quel, la racine nommée — sans ça le filet final
    // annonçait « impossible d'écrire » avec le dossier COURANT
    let isDir = false
    try { isDir = statSync(args.root).isDirectory() } catch { /* absente : estDossier reste faux */ }
    if (!isDir) {
      console.error(t('cli.root-not-found', { root: args.root }))
      process.exit(1)
    }
    process.chdir(args.root)
  }

  // `mjs init` : scaffolding — n'a pas besoin de config.
  if (args.command === 'init') {
    runInit(process.cwd())
    return
  }

  // `mjs mcp` : serveur MCP en stdio — la sortie standard est au protocole, rien ne doit s'y écrire avant lui (pas même la
  // ligne de la config trouvée, plus bas) ; la config est relue par chaque outil
  if (args.command === 'mcp') {
    await runMcp({ root: process.cwd(), version: readPackageVersion() })
    process.exit(0)
  }

  // mjs.config.json : si présent, fournit les défauts ; les flags CLI override.
  const found = findConfig()
  const cfgOpts: ReturnType<typeof resolveBundlerOpts> = found
    ? resolveBundlerOpts(found.config, found.configDir)
    // Littéral de repli désynchronisé du
    // type réel de resolveBundlerOpts() : `contextAlias`/`preload`/`runtimeDir`/
    // `urlPrefix` manquaient (ajoutés à MjsConfig après ce littéral), faisant
    // échouer `tsc --noEmit` (erreur pré-existante, découverte en écrivant
    // ce commentaire — pas un crash runtime, mjs.config.json absent est un cas
    // fréquent en dev).
    // `css` (bundle / split / lazy) et `js` (split / bundle) ajoutées à
    // resolveBundlerOpts() (bundler/config.ts) : même piège structurel que le reste de ce
    // littéral (cf. commentaire ci-dessus).
    // `render` (bloc des pages, lu par le bundler pour le seul module d'hydratation) : idem.
    : { sourceDir: undefined, outputDir: undefined, manifestPath: undefined, manifestExternal: undefined, stylesheetsDir: undefined, assetDirs: undefined, runtimeDir: undefined, urlPrefix: undefined, defaultScriptLang: undefined, templateLang: undefined, sigil: undefined, contextAlias: undefined, varPrefix: undefined, defaultTheme: undefined, preload: undefined, viewTransition: undefined, logLevel: undefined, messages: undefined, types: undefined, typesReport: undefined, derivedMode: undefined, reffetsMode: undefined, routesPreload: undefined, blocksPreload: undefined, proxy: undefined, responsiveFontSize: undefined, collections: undefined, effects: undefined, bundles: undefined, maxStateVars: undefined, a11y: undefined, ujsForm: undefined, lint: undefined, image: undefined, minify: 'auto' as const, devPort: undefined, devHost: undefined, runtime: undefined, css: undefined, js: undefined, csp: undefined, anchorHistory: undefined, sourceMap: undefined, i18n: undefined, render: undefined, prune: undefined }
  if (found) {
    console.log(t('cli.config-found', { dir: found.configDir }))
  }

  // GARDE ANTI-BOURDE — `mjs build` lancé DEPUIS LE MAUVAIS
  // DOSSIER (ou visant une racine sans sources) construisait un projet VIDE en annonçant
  // « ✅ 2 fichiers écrits », code de sortie 0 : le manifeste du site servi se retrouvait
  // remplacé par un `µ.paths = {}`, plus un seul composant connu, page blanche — et un
  // script de déploiement qui enchaîne sur `rsync` n'avait rien pour s'arrêter. C'est la
  // garde muette appliquée à un build : « je n'ai rien trouvé à construire » est
  // indiscernable de « tout va bien ». On refuse AVANT d'écrire quoi que ce soit, jamais
  // un avertissement. Deux cas, jamais confondus dans le message : plus rien du projet
  // sous la racine, ou un dossier source bel et bien là mais sans le moindre composant.
  if (args.command === 'build' || args.command === 'check' || args.command === 'dev') {
    // défaut depuis le dossier de mjs.config.json, comme le constructeur (lancé d'un sous-dossier, jamais le dossier courant)
    const sourceDir = cfgOpts.sourceDir ?? resolve(found?.configDir ?? process.cwd(), 'app/modularjs')
    // `--json` : la racine et les composants, pour nommer les fichiers — même si une garde ci-dessous refuse
    checkJson?.setProject(found?.configDir ?? process.cwd(), sourceDir)
    // le dossier source n'est pas là — quelle que soit la présence d'un mjs.config.json.
    // La première écriture de cette garde ne couvrait QUE l'absence de config : une config
    // présente dont le `sourceDir` avait été renommé rejouait le sinistre à l'identique,
    // « ✅ 2 fichiers écrits », code 0, manifeste écrasé (même sinistre, vérifié en testant).
    if (!existsSync(sourceDir)) {
      console.error(t('cli.build-root-empty', { command: args.command, root: process.cwd(), source: sourceDir, origin: t(cfgOpts.sourceDir ? 'cli.source-origin-config' : 'cli.source-origin-default') }))
      process.exit(1)
    }
    // `mjs dev` reste tolérant au dossier VIDE : on lance couramment le watcher avant
    // d'écrire son premier composant. `build` et `check`, eux, écrivent pour de bon.
    if (args.command !== 'dev' && !hasComponents(sourceDir)) {
      console.error(t('cli.build-no-component', { command: args.command, source: sourceDir }))
      process.exit(1)
    }
  }

  // calculé UNE fois, ici, dans le thread PRINCIPAL (un thread de travail n'est jamais un
  // terminal) — descend au Bundler puis au transpileur par leurs options respectives (cf.
  // src/diagnostics.ts), jamais redéterminé plus bas.
  const colorsEnabled = resolveColorsEnabled()

  // GARDE i18n.default — `bundler/config.ts` vérifie que `i18n.default` est
  // une chaîne non vide, mais JAMAIS qu'elle désigne un dictionnaire RÉEL sous sourceDir/i18n/ :
  // un défaut sans fichier compile en silence, traductions absentes pour qui atterrit dessus.
  // Avertissement SEUL (pas une erreur) : un projet sans AUCUN dictionnaire encore écrit reste
  // silencieux — seul un dossier i18n/ PEUPLÉ dont `default` est absent des langues trouvées avertit.
  if (args.command === 'build' && found?.config.i18n?.default) {
    const sourceDir = cfgOpts.sourceDir ?? resolve(found?.configDir ?? process.cwd(), 'app/modularjs')
    const i18nDir = join(sourceDir, 'i18n')
    if (existsSync(i18nDir)) {
      const langs = readI18nLanguages(i18nDir)
      if (langs.length > 0 && !langs.includes(found.config.i18n.default)) {
        const line = typedLine('i18n', t('cli.i18n-default-no-dictionary', { defaultValue: found.config.i18n.default, langs: langs.join(', ') }), cfgOpts.lint)
        if (line !== null) printDiagnostic(line, colorsEnabled)
      }
    }
  }

  // ENVIRONNEMENT du build — la COMMANDE le dit, et rien d'autre : `mjs build` construit en
  // développement, `mjs build --prod` en production. Ni fichier de config, ni NODE_ENV : une
  // variable d'ambiance qui traîne dans un shell (ou un fichier versionné parti sur un serveur)
  // ne doit pas changer ce que produit un build sur la machine de qui le lance.
  const envBuild: 'dev' | 'prod' = args.env ?? 'dev'

  // Bandeau d'environnement — un build qui se trompe de mode ne se voit AUTREMENT nulle part
  // (le manifeste dit `dev:`, mais personne ne l'ouvre). Écrit tel quel dans le journal de
  // déploiement : un `mjs build` lancé sans `--prod` y annonce « DÉVELOPPEMENT ». La minification se dit à part,
  // par la règle du Bundler : `"minify": true` minifie un build de développement, `false` laisse lisible la production.
  if (args.command === 'build' || args.command === 'check' || args.command === 'dev' || args.command === 'serve') {
    const origin  = args.env ? t('cli.env-origin-flag') : t('cli.env-origin-default')
    const minifie = Bundler.minifies(cfgOpts.minify ?? 'auto', envBuild)
    console.log(t(envBuild === 'prod' ? 'cli.env-prod' : 'cli.env-dev', { origin: origin, minified: minifie }))
  }

  const bundler = new Bundler({
    sourceDir:         cfgOpts.sourceDir,
    outputDir:         args.output ?? cfgOpts.outputDir,
    manifestPath:      args.manifest ?? cfgOpts.manifestPath,
    manifestExternal:  cfgOpts.manifestExternal,
    stylesheetsDir:    cfgOpts.stylesheetsDir,
    // dossiers d'images en plus de sourceDir : résolus par resolveBundlerOpts(), à transmettre ici sinon la clé reste sans effet
    assetDirs:         cfgOpts.assetDirs,
    // Même bug que contextAlias
    // ci-dessous : runtimeDir/urlPrefix étaient résolus par
    // resolveBundlerOpts() mais jamais transmis ici.
    runtimeDir:        cfgOpts.runtimeDir,
    urlPrefix:         cfgOpts.urlPrefix,
    defaultScriptLang: cfgOpts.defaultScriptLang,
    // Grammaire interpolations/handlers — même
    // piège que contextAlias/maxStateVars ci-dessus si on oublie de la
    // transmettre ici : resolveBundlerOpts() la résout mais serait sinon MORTE.
    templateLang:      cfgOpts.templateLang,
    sigil:             cfgOpts.sigil,
    // varPrefix/defaultTheme (mjs.config.json) : même piège que contextAlias ci-dessous —
    // résolus par resolveBundlerOpts() mais jamais transmis ici, un build gardait toujours le
    // préfixe de variables --mjs-* et le thème par défaut sans sa règle :where(:root), alors
    // que le rendu serveur, lui, les transmettait déjà (build et SSR divergeaient).
    varPrefix:         cfgOpts.varPrefix,
    defaultTheme:      cfgOpts.defaultTheme,
    // contextAlias était validé par
    // resolveBundlerOpts() (mjs.config.json → cfgOpts.contextAlias) mais
    // jamais transmis ICI au Bundler — option totalement MORTE en CLI : un
    // projet qui configure `contextAlias: true` dans mjs.config.json pour
    // utiliser `mjs.X` au lieu de `µ.X` continuait à générer `__context`/
    // `__shared` avec l'alias par défaut, sans AUCUNE erreur (silencieux).
    contextAlias:      cfgOpts.contextAlias,
    preload:           cfgOpts.preload,
    viewTransition:    cfgOpts.viewTransition,
    // logLevel (mjs.config.json) : même piège que preload/viewTransition/contextAlias
    // ci-dessus si on oublie cette ligne — resolveBundlerOpts() la résout mais resterait
    // MORTE en CLI (µ._logLevel toujours au défaut, `pure` du minifieur jamais ajusté).
    logLevel:          cfgOpts.logLevel,
    messages:          cfgOpts.messages,
    types:             cfgOpts.types,
    typesReport:       cfgOpts.typesReport,
    derivedMode:       cfgOpts.derivedMode,
    reffetsMode:       cfgOpts.reffetsMode,
    routesPreload:     cfgOpts.routesPreload,
    blocksPreload:     cfgOpts.blocksPreload,
    proxy:             cfgOpts.proxy,
    responsiveFontSize: cfgOpts.responsiveFontSize,
    collections:       cfgOpts.collections,
    // effects (mjs.config.json : thème en cercle, effets économes, squelettes) : même piège que
    // logLevel ci-dessus — sans cette ligne, résolue mais morte en `mjs build`/`mjs dev`
    effects:           cfgOpts.effects,
    // bundles (mjs.config.json : groupes de fichiers) : même piège que effects ci-dessus — sans cette
    // ligne, la clé est lue, validée, et jamais appliquée
    bundles:           cfgOpts.bundles,
    // lint.maxStateVars (mjs.config.json) → seuil du warning « trop de vars
    // d'état » du transpiler — transmis ici, sinon option MORTE en CLI (même
    // piège que contextAlias/runtimeDir ci-dessus).
    maxStateVars:      cfgOpts.maxStateVars,
    // lint.a11y (mjs.config.json, défaut true) → même piège que maxStateVars
    // ci-dessus si non transmis ici : resolveBundlerOpts() la résout mais
    // resterait MORTE en CLI.
    a11y:              cfgOpts.a11y,
    // lint.ujsForm (mjs.config.json, défaut true) → même piège que lint.a11y ci-dessus :
    // résolu par resolveBundlerOpts() mais resterait MORTE en CLI sans cette ligne.
    ujsForm:           cfgOpts.ujsForm,
    // bloc `lint` ENTIER (mjs.config.json, tous les autres types — cf. src/diagnostics.ts) :
    // même piège que ci-dessus si non transmis ici.
    lint:              cfgOpts.lint,
    // calculé UNE fois ici (thread principal, le seul qui soit un terminal) — cf.
    // resolveColorsEnabled ci-dessous, descend au Bundler puis au transpileur par ses options.
    colorsEnabled,
    // Un composant en échec ne garde son ANCIENNE sortie
    // référencée qu'en dev/serve, où le site doit rester utilisable le temps de corriger ; en
    // build, la version repêchée peut importer un cœur supprimé depuis (page morte, build vert)
    keepFailedComponents: args.command === 'dev' || args.command === 'serve',
    // `"prune": false` (mjs.config.json) : les anciennes empreintes restent aussi sur disque, pas seulement les orphelins
    prune:             cfgOpts.prune,
    // Environnement du build : `--prod` ou rien (cf. Bundler.isProd). `minify` ne dit QUE la
    // minification — poser `"minify": true` ne fait pas basculer le projet en prod.
    env:               envBuild,
    minify:            cfgOpts.minify,
    // Tree-shake explicite du runtime (mjs.config.json → clé `runtime`) : même
    // piège que runtimeDir/contextAlias/maxStateVars ci-dessus — résolu par
    // resolveBundlerOpts() mais INERTE tant qu'il n'est pas transmis ici.
    runtime:           cfgOpts.runtime,
    // Stratégie de livraison des feuilles PARTAGÉES (mjs.config.json → clé `css`) : même
    // piège que runtime/contextAlias ci-dessus — validée par resolveBundlerOpts() mais
    // INERTE (le mode reste 'bundle' quoi qu'écrive le projet) tant qu'elle n'arrive pas ici.
    css:               cfgOpts.css,
    // Mode d'émission JS (mjs.config.json → clé `js`) : même piège que css/runtime
    // ci-dessus — validée par resolveBundlerOpts() mais INERTE (le mode resterait TOUJOURS
    // 'split' quoi qu'écrive le projet) tant qu'elle n'arrive pas ici.
    js:                cfgOpts.js,
    // `render` : lu par le bundler pour joindre le module d'hydratation selon les modes des
    // pages ; résolu par resolveBundlerOpts() mais mort sans cette ligne (même piège que `js`)
    render:            cfgOpts.render,
    // Mode strict CSP (mjs.config.json → clé `csp`) et émission des cartes de source
    // (clé `sourceMap`) : même piège que css/runtime/contextAlias ci-dessus — résolues
    // par resolveBundlerOpts() mais INERTES tant qu'elles n'arrivent pas ici.
    csp:               cfgOpts.csp,
    // chaque ancre d'une même page, une entrée d'historique (clé `anchorHistory`) : même piège, la ligne du manifeste n'est
    // écrite que si l'option arrive ici
    anchorHistory:     cfgOpts.anchorHistory,
    sourceMap:         cfgOpts.sourceMap,
    // image (mjs.config.json, défauts résolus au constructeur du Bundler) — même
    // piège que contextAlias/maxStateVars/css ci-dessus si on oublie la ligne
    image:             cfgOpts.image,
    // i18n façon Rails (mjs.config.json → clé `i18n`) : même piège que
    // runtime/contextAlias ci-dessus — résolu par resolveBundlerOpts() mais
    // INERTE (sourceDir/i18n/ jamais scanné) tant qu'il n'est pas transmis ici.
    i18n:              cfgOpts.i18n,
    // classement des valeurs dérivées : calculé pour `mjs check --derived` seulement
    derived:           args.command === 'check' && args.derived === true,
    // `mjs check --json` : toute la compilation dans le processus principal — ce qu'un fil d'exécution écrit à la console
    // arrive après coup, et la capture du document le manquerait
    inlineTranspileLimit: checkJson ? Number.POSITIVE_INFINITY : undefined,
    // `mjs build --cache` : ce que la construction compile est gardé dans node_modules/.cache/mjs/build du projet
    cache:             args.command === 'build' && args.cache !== undefined,
  })

  // GARDE ÉCRITURE — `--output`/`--manifest`/défauts config : chemin résolu et
  // vérifié (plus proche ancêtre EXISTANT accessible en écriture) AVANT toute compilation, pour
  // les 4 commandes qui écrivent réellement (cf. checkWritablePath ci-dessus pour le pourquoi).
  if (args.command === 'build' || args.command === 'check' || args.command === 'dev' || args.command === 'serve') {
    // `--output` ET `--manifest` sur le MÊME chemin résolu :
    // le manifeste écrase le dossier de sortie (ou l'inverse) en pleine compilation, laissant une
    // écriture PARTIELLE derrière une trace Node brute (EISDIR) — refusé AVANT toute compilation.
    if (resolve(bundler.outputDir) === resolve(bundler.manifestPath)) {
      console.error(t('cli.output-manifest-identical', { path: resolve(bundler.outputDir) }))
      process.exit(1)
    }
    // manifeste sur son chemin DÉFINITIF, drapeaux compris : mjs.config.json est vérifié à la lecture, `--manifest` et
    // `--output` ne le sont qu'ici — `mjs build --manifest app/modularjs/manifest.civet` écrasait le manifeste de l'auteur.
    // Les chemins seulement : un fichier existant de l'auteur est refusé par la construction elle-même (cf. Bundler.authorOutputsReject)
    const reject = rejectManifestPath({ manifestPath: bundler.manifestPath, sourceDir: bundler.sourceDir, outputDir: bundler.outputDir, manifestExternal: bundler.manifestExternal })
    if (reject !== null) {
      if (reject.reason === 'extension') console.error(t('cli.manifest-refused-extension', { path: bundler.manifestPath, extension: reject.extension }))
      else if (reject.reason === 'external') console.error(t('cli.manifest-refused-external', { path: bundler.manifestPath }))
      else console.error(t('cli.manifest-refused-sources', { path: bundler.manifestPath, sourceDir: bundler.sourceDir, outputDir: bundler.outputDir }))
      process.exit(1)
    }
    // dossier de sortie qui contient la racine du projet (dossier parent) : `mjs dev` et `mjs serve` serviraient tout ce dossier, les
    // fichiers privés d'une appli voisine compris. La racine elle-même reste permise : le serveur y garde les fichiers du projet
    const root = found?.configDir ?? process.cwd()
    if (args.command !== 'check' && pathInDir(root, bundler.outputDir) && !pathInDir(bundler.outputDir, root)) {
      console.error(t('cli.output-contains-root', { path: resolve(bundler.outputDir), root: root }))
      process.exit(1)
    }
    checkWritablePath(bundler.outputDir, 'outputDir', true)
    checkWritablePath(bundler.manifestPath, 'manifestPath', false, true)
  }

  // Config transmise au RENDU (`mjs dev`/`mjs serve`) : `bundler.outputDir`/`manifestPath` sont
  // déjà résolus en ABSOLU, overrides --output/--manifest compris (cf. `new Bundler({...})`
  // ci-dessus) — createRenderHandler/startRenderServer recalculaient depuis `found.config` SEUL,
  // ignorant ces overrides (le prérendu de `mjs build`, lui, les reçoit déjà). Sans override, ces
  // deux valeurs sont IDENTIQUES à ce que `found.config` aurait donné (même résolution, cf.
  // Bundler.outputDir/manifestPath) : aucun changement pour l'usage courant.
  const renderConfig = found ? { ...found.config, outputDir: bundler.outputDir, manifestPath: bundler.manifestPath } : undefined

  switch (args.command) {
    case 'build': {
      const stats = await bundler.compile()
      const above = await settleWarningLines()
      printBuildReport(stats)
      // `--cache` : fichiers repris et recompilés, ou la raison d'une construction complète
      if (bundler.diskCacheLine !== null) console.log(bundler.diskCacheLine)
      // `--cache=verify` : la construction servie par le cache comparée à l'octet à une construction complète ; un écart jette le cache,
      // la construction complète est refaite sur place et fait foi pour le prérendu et la purge (la sortie devient celle de `mjs build`),
      // puis la commande échoue
      const verdict        = args.cache === 'verify' && stats.errors.length === 0 ? await bundler.verifyDiskCache() : null
      const cacheDiscarded = verdict !== null && !verdict.ok
      const base           = verdict?.rebuilt ?? bundler
      // le résultat du compile() de `base`, que le prérendu reprend (cf. PrerenderOverrides.compiled)
      const baseStats      = verdict?.rebuilt ? verdict.rebuiltStats : stats
      const rest           = stats.errors.length === 0 && (verdict?.errors.length ?? 0) === 0
      if (verdict?.ok) console.log(verdict.line)
      else if (verdict) {
        for (const e of verdict.errors) console.error('  ', paintError(e.message, colorsEnabled))
        console.error(verdict.line)
        for (const f of verdict.gaps.slice(0, 10)) console.error(`   ${f}`)
        if (verdict.gaps.length > 10) console.error(`   ${t('cli.n-more', { count: verdict.gaps.length - 10 })}`)
      }
      // groupes de fichiers (`bundles`) : un fichier par groupe en production, une ligne d'information sinon
      for (const line of bundler.groupInfo) console.log(line)
      for (const e of stats.errors) console.error('  ', paintError(e.message, colorsEnabled))
      // la première faute de chaque fichier : `mjs check` les liste toutes
      if (stats.errors.length > 0) console.error(t('cli.check-list-all'))
      printWarningsSummary(bundler, stats, above)
      // Prérendu des pages déclarées (bloc `render`) — opt-in, seulement si la
      // compilation a réussi. Génère le HTML figé des routes `prerender` que le
      // back servira (le dev n'écrit aucun script de rendu).
      // UN PRÉRENDU QUI ÉCHOUE FAIT ÉCHOUER LE BUILD quand le projet a DÉCLARÉ des routes
      // à prérendre (`render.routes`) : avant, on se contentait d'un avertissement et `mjs build`
      // sortait en 0 — un déploiement enchaînait donc sur des pages MANQUANTES en croyant avoir
      // réussi (incident réel : trois sous-sites en 500). Sans `render.routes`,
      // rien n'est promis à personne : on garde l'avertissement seul.
      // Le `catch` ci-dessous ne couvrait QUE l'échec de
      // COMPILATION globale (prerenderPages() qui lève). Un échec de RENDU sur UNE SEULE page
      // (composant introuvable, exception…) est capturé PAR PAGE par prerenderPages elle-même
      // (report.skipped, `fatal: true`) SANS jamais lever — `prerenderFatal` restait `false`,
      // rejouant l'incident à l'identique sur une simple typo de composant. Couvert plus bas,
      // après la boucle qui affiche chaque page ignorée (`renderFailures`).
      let prerenderFatal = false
      // Bundler dont le manifeste fait foi après le prérendu (le premier tant que celui-ci n'a rien recompilé)
      let last = base
      if (found?.config.render && rest) {
        try {
          console.log(t('cli.prerender-start'))
          // Garde-fou — `args.output`/
          // `args.manifest` (mêmes overrides que ceux appliqués au `bundler`
          // ci-dessus) DOIVENT être transmis ici : sans eux, `prerenderPages`
          // re-dérivait ses propres chemins depuis `mjs.config.json`,
          // ignorant un build redirigé — le prérendu recompilait puis
          // écrasait les fichiers du VRAI projet.
          // `env` transmis pour la MÊME raison que `outputDir`/`manifestPath` : quand ce prérendu
          // ne peut pas reprendre la compilation de la construction (`compiled` ci-dessous), il
          // RECOMPILE dans le vrai dossier de sortie, par-dessus le build qu'on vient de faire.
          // Sans lui il retomberait sur son défaut (développement) et DÉFERAIT un `--prod` —
          // sortie non minifiée, manifeste `dev:true`, fragments i18n en clair.
          const report = await prerenderPages(found.config, found.configDir, m => console.log(m), {
            outputDir: args.output,
            manifestPath: args.manifest,
            env: envBuild,
            // `--cache` : quand le prérendu compile à part (`js: 'bundle'`, cf. `compiled` ci-dessous), sa compilation est servie par le
            // même cache ; sous `--cache=verify` et en production, elle recompile tout
            cache: args.cache === true && envBuild !== 'prod',
            // la compilation que cette construction vient d'écrire (sous `--cache=verify`, celle qui fait foi) : les moteurs de rendu
            // rendent dessus sans recompiler le projet, sauf quand ils compileraient autre chose (cf. reusableCompile)
            compiled: baseStats ? { bundler: base, stats: baseStats } : undefined,
          })
          if (report.generated.length) {
            console.log(t('cli.prerender-result', { count: report.generated.length, dir: report.outDir }))
          }
          // Démarrage des pages prérendues (`render.startup`) : le fragment qui vient d'être écrit
          // reçoit ses propres liens de préchargement, et son fichier de page en production quand il
          // en demande un. APRÈS le prérendu (les fragments et le manifeste existent, le `bundler`
          // de ce build porte les chemins hachés), jamais avant.
          // le manifeste du DERNIER compile du dossier de sortie (celui du prérendu), pas celui du premier : une source
          // modifiée entre les deux donnerait sinon des empreintes de fichiers disparus (cf. latestBundler)
          last = latestBundler(base, report)
          await emitStartup(last, found.config.render, report, { prod: envBuild === 'prod', log: m => console.log(m) })
          for (const s of report.skipped) console.log(t('cli.prerender-page-ignored', { url: s.url, reason: s.reason }))
          if (!report.generated.length && !report.skipped.length) {
            console.log(t('cli.prerender-no-page'))
          }
          // Cf. commentaire au-dessus de `prerenderFatal` : un échec de RENDU par page
          // (jamais un skip VOULU comme route paramétrée/mode non buildable) fait échouer le build.
          const renderFailures = report.skipped.filter(s => s.fatal)
          if (renderFailures.length > 0) {
            prerenderFatal = true
            console.error(t('cli.prerender-failed-fatal', { count: renderFailures.length }))
          }
        } catch (e: any) {
          prerenderFatal = Object.keys(found.config.render.routes ?? {}).length > 0
          // le build sort en erreur dès que des routes sont déclarées : le message le dit, il n'écrit « ignoré » que
          // pour un projet sans routes (rien n'est promis à personne)
          console.warn(t(prerenderFatal ? 'cli.prerender-failed-build' : 'cli.prerender-failed', { error: e?.message || e }))
          console.warn(t('cli.ssr-requires-happy-dom'))
        }
      }
      // Purge des orphelins d'outputDir : DERNIER GESTE de la construction, seulement après un build
      // sans erreur (un build partiel garde tout, cf. recoverFailedComponentManifest) ET après le
      // prérendu et son en-tête de démarrage. Les fichiers de page (`mjs_page-…`) sont écrits par
      // `emitStartup`, donc APRÈS `compile()` : purger avant les aurait pris pour des orphelins (ils
      // n'appartiennent à aucune émission de compile()) et retirés au build suivant, juste avant que
      // le prérendu ne les réécrive — un dossier servi qui perd puis retrouve le fichier que ses
      // pages d'entrée démarrent. Prérendu qui échoue : rien n'est purgé (ce build ne sait plus ce
      // qu'il a émis) — les fichiers du précédent restent servis. Opt-out `"prune": false` dans
      // mjs.config.json. Jamais un sous-dossier (i18n/, mjs_pages/), jamais un nom stable — cf.
      // Bundler.pruneOrphans
      if (rest && !prerenderFatal && found?.config.prune !== false) {
        const { removed, failed, skipped } = last.pruneOrphans()
        const purgedDir = relative(process.cwd(), last.outputDir) || '.'
        if (removed.length > 0) {
          console.log(t('cli.build-purge', { count: removed.length, dir: purgedDir }))
          const shown = removed.slice(0, 20)
          for (const f of shown) console.log(t('cli.build-purge-file', { file: f }))
          if (removed.length > shown.length) console.log(`   ${t('cli.n-more', { count: removed.length - shown.length })}`)
        }
        for (const f of failed) bundler.buildWarn(t('cli.build-purge-failed', { file: f }))
        // Garde muette côté CLI : `skipped` n'était jamais
        // affiché, un registre illisible/vide ou un cache-hit sautait la purge SANS UN MOT (les
        // 4 autres raisons — errors/empty/no-core/no-dir — restent silencieuses, déjà couvertes
        // par ailleurs ou non actionnables par l'utilisateur).
        if (skipped === 'registry-unreadable') bundler.buildWarn(t('cli.build-purge-registry-unreadable', { dir: purgedDir }))
        if (skipped === 'registry-empty') bundler.buildWarn(t('cli.build-purge-registry-empty', { dir: purgedDir }))
        if (skipped === 'cache') bundler.buildWarn(t('cli.build-purge-cache', { dir: purgedDir }))
      }
      // Termine le worker pool pour que Node puisse exit proprement.
      await bundler.close()
      if (base !== bundler) await base.close()
      process.exit(stats.errors.length > 0 || prerenderFatal || cacheDiscarded ? 1 : 0)
    }
    case 'dev': {
      // Journal d'erreurs 3 étages, même magasin que `mjs serve` (cf. render-server.ts
      // pour le commentaire détaillé) : le MAGASIN est créé dès qu'un mjs.config.json existe (coût
      // nul tant qu'aucun fichier n'est lu/écrit, cf. journal.ts) — INDÉPENDANT du bloc `render`
      // (renderHandler ci-dessous, qui ne couvre que le rendu SSR/prérendu). `recordServer` est
      // PRÉ-GATÉ une seule fois ici (no-op si journal.server === false) : createRenderHandler n'a
      // pas à retester la config lui-même — même contrat que RecordServerFn (journal.ts). Sans
      // `found` (aucun mjs.config.json) : ni magasin ni recordServer, comportement HISTORIQUE
      // strictement inchangé.
      // `version` posée ici comme le fait `mjs serve` (render-server.ts, MÊME appel à
      // readBuildVersion, désormais partagée par server/build-version.ts) : une entrée de dev dit de
      // QUEL build elle vient. Cache par mtime ⇒ la valeur suit les recompiles du watcher.
      const journalCfg   = found?.config.journal
      const journalStore = found ? createJournal({ dir: join(found.configDir, 'log'), maxEntries: journalCfg?.maxEntries, maxBytes: journalCfg?.maxBytes, maxDays: journalCfg?.maxDays }) : null
      const recordServer: RecordServerFn | undefined = journalStore
        ? (journalCfg?.server !== false ? (input) => journalStore.record('server', { ...input, version: readBuildVersion(bundler.manifestPath) }) : () => {})
        : undefined

      // verrou D'ABORD, avant tout code du projet : `createServeEntry` (plus bas) importe, donc EXÉCUTE, `serve.server.mjs` — un
      // second `mjs dev` refusé n'en lance rien. Les écouteurs SIGINT/SIGTERM/SIGHUP sont posés ici (cf. cli/dev-lock.ts — un
      // écouteur ajouté APRÈS coup ne tournerait jamais, `acquireDevLock` appelle `process.exit()` de façon synchrone) ; leur rappel
      // lit `stopDev`, complété dès que le serveur existe : un signal reçu avant n'a rien à fermer (le rendu ne touche le disque
      // qu'à la première requête), le processus sort aussitôt.
      // Rappel ASYNCHRONE, et ATTENDU : `close()` du handler de rendu rend une promesse (il ferme le
      // renderer, donc son dossier de travail — cf. server/render-compile-dir.ts). Un rappel
      // synchrone la jetait, `dev-lock.ts` n'attendait rien et sortait aussitôt : un dossier de
      // travail restait derrière chaque session de développement.
      // Le serveur HTTP cesse d'abord d'accepter des connexions ; ses réponses en cours d'écriture
      // (gros fichier, client lent) vont jusqu'au bout avant la sortie au lieu d'être coupées net par `process.exit()`.
      // verrou à la RACINE du projet (dossier de mjs.config.json, trouvé en remontant) : posé dans le
      // dossier de lancement, `--root proj` et `--root proj/app` tournaient ensemble sur la même sortie
      let stopDev = async (): Promise<void> => {}
      acquireDevLock(join(found?.configDir ?? process.cwd(), '.mjs-dev.lock'), () => stopDev())

      // render.routes en dev (feature) — bloc `render` optionnel : quand présent,
      // MÊME moteur que `mjs serve` (createRenderHandler), pour voir le rendu
      // SSR/prérendu FRAIS directement en dev, sans lancer `mjs serve` à part.
      // Créé APRÈS le verrou (cf. juste au-dessus) : `createRenderHandler` ne compile RIEN et ne touche pas le
      // disque tant qu'aucune requête SSR/navigateur n'arrive (mémoïsation
      // paresseuse interne, cf. son commentaire).
      // `envBuild` transmis (4e paramètre, déjà accepté par
      // createRenderHandler, cf. render-request.ts:120/isProd) : sans lui, le corps d'erreur SSR
      // d'un `mjs dev --prod` restait celui du dev (message brut) faute de NODE_ENV positionné.
      const renderHandler = found?.config.render
        ? await createRenderHandler(renderConfig!, found.configDir, recordServer, envBuild)
        : null

      // Chargeur d'actions `.server.mjs` (cf. serve-entry.ts), MÊME appareillage que `mjs
      // serve` (render-server.ts) : entièrement optionnel (aucun `serve.server.mjs`/`render.entry`
      // trouvé ⇒ chargeur INACTIF en silence, `entry.actionFor` répond toujours null, StaticServer
      // retombe alors sur son 405 sec historique, cf. son commentaire). INDÉPENDANT du bloc `render`
      // (renderHandler ci-dessus) — un projet sans render.routes peut quand même déclarer des
      // actions. Absent `found` (aucun mjs.config.json) ⇒ pas d'entry du tout, comportement
      // HISTORIQUE inchangé.
      const serveEntry = found ? await createServeEntry(found.config, found.configDir, recordServer) : null

      // Priorité port : --port flag > mjs.config.json dev.port > défaut 3939
      const server = new StaticServer({
        // le dossier où le constructeur écrit (son défaut part du dossier de mjs.config.json, cf. Bundler)
        rootDir: bundler.outputDir,
        pathPrefix: bundler.urlPrefix,
        port: args.port ?? cfgOpts.devPort ?? 3939,
        host: cfgOpts.devHost ?? '127.0.0.1',
        // Sans `env`, StaticServer retombait sur NODE_ENV seul
        // (isProdEnv, viewer-page.ts) : un `mjs dev --prod` sans NODE_ENV=production laissait
        // /__mjs/theme(.json) ET /__mjs/errors(.json) ouverts en « production ».
        env: envBuild,
        hmr: true,
        renderHandle: renderHandler?.handle,
        // Passé INCONDITIONNELLEMENT (avant : seulement avec un `renderHandler`). Le manifeste
        // est écrit par le bundler dans TOUS les cas ; le lier au bloc `render` fermait la page du
        // journal et l'atelier des thèmes aux projets qui n'en ont pas, alors que le cœur µ dont ces
        // deux visionneuses ont besoin était bel et bien sur le disque. Fichier pas encore écrit
        // (premier build en cours) ⇒ les routes concernées rendent 404, cf. server/index.ts.
        manifestPath: bundler.manifestPath,
        // Mêmes config/configDir que renderHandler ci-dessus, pour que
        // serveRenderFallback (server/index.ts) puisse thémer son <head> comme `mjs serve`.
        config: found?.config,
        configDir: found?.configDir,
        // Racine du PROJET (dossier de mjs.config.json, ou --root sans config trouvée — `process.cwd()`
        // reflète déjà --root, chdir plus haut) : `mjs dev` sert désormais la page du projet lui-même
        // (index.html, public/…) quand aucun bloc `render` n'est configuré, comme le ferait un serveur
        // de dev Vite/Angular (cf. ServerOpts.projectRoot, server/index.ts). `found.configDir` prime
        // quand il existe (peut être un ANCÊTRE de cwd, si mjs.config.json vit plus haut).
        projectRoot: found?.configDir ?? process.cwd(),
        defaultLang: found?.config.i18n?.default,
        // Magasin du journal (cf. ci-dessus) : absent (pas de mjs.config.json) ⇒ AUCUNE
        // route /__mjs/errors(.json) servie par StaticServer.
        journal: journalStore ?? undefined,
        // Chargeur d'actions (cf. ci-dessus) : absent ⇒ AUCUN verbe mutant traité, 405 sec
        // historique (cf. StaticServer.handle).
        entry: serveEntry ?? undefined,
        recordServer,
      })
      stopDev = async () => {
        const stop = server.stop()
        await renderHandler?.close()
        serveEntry?.close()
        await stop
      }
      await server.start()
      // bloc MJS de l'AGENTS.md du projet rétabli au démarrage (cf. cli/agents-md.ts) — jamais de fichier créé ici
      syncAgentsMd(found?.configDir ?? process.cwd(), { create: false })

      // Le build initial se faisait ICI,
      // séquentiellement AVANT `bundler.watch()` : fenêtre où un fichier
      // modifié pendant ce build (potentiellement long) n'était vu par AUCUN
      // watcher, silencieusement perdu. `watch()` fait maintenant CE build
      // initial lui-même, en tout premier, via la MÊME file de compiles que
      // les recompiles déclenchées par le watcher (cf. son commentaire
      // détaillé) — un changement survenant pendant le build initial
      // déclenche désormais sa propre recompile juste après, au lieu d'être
      // ignoré. Le monkey-patch de `bundler.compile` doit rester posé AVANT
      // l'appel à `watch()` pour que SON build initial en bénéficie aussi.

      // Re-build à chaque changement avec notif HMR : reload sur succès,
      // overlay error sinon (récupéré via la sortie du dernier compile).
      // S'applique aussi au build initial (watch() l'invoque désormais lui-même).
      let lastErrors: Error[] = []
      // erreur affichée sur la page : un tour qui ne change rien d'autre (le texte revenu à celui d'avant) la retire, sans recharger
      let errorShown = false
      // composants du dernier échange à chaud : le terminal les nomme quand la page répond (échange fait, ou page rechargée)
      let hotNames = ''
      if (server.hmr) server.hmr.onHotResult = (ok) => console.log(t(ok ? 'cli.components-hot-reloaded' : 'cli.components-page-reloaded', { names: hotNames }))
      // relevé des avertissements du premier build, pris dès la fin de sa compilation (cf. settleWarningLines) : watch() écrit ensuite
      // ses erreurs, puis rend la main au bilan
      let aboveInitial  = null as number | null
      const origCompile = bundler.compile.bind(bundler)
      bundler.compile = async () => {
        const stats = await origCompile()
        lastErrors = stats.errors
        if (aboveInitial === null) aboveInitial = await settleWarningLines()
        return stats
      }

      // Sérialise les passes de prérendu déclenchées par le watcher (cf. son commentaire détaillé)
      // — UNE instance pour toute la session `mjs dev`, créée AVANT `watch()` pour couvrir aussi
      // le premier recompile.
      const devPrerenderScheduler = createDevPrerenderScheduler(found?.config, found?.configDir ?? '', {
        log: console.log,
        warn: console.warn,
        bundler,
        // mêmes drapeaux que le bundler, comme `mjs build` (cf. plus haut)
        overrides: { outputDir: args.output, manifestPath: args.manifest, env: envBuild },
      })

      await bundler.watch({
        onRecompile: (changed, stats) => {
          // bilan des avertissements UNE fois, au premier build : ceux de fin de build (thème
          // partagé, collisions…) ne sortaient qu'avec `mjs build`/`mjs check` ; le redire à
          // chaque sauvegarde serait du bruit
          if (changed === '<initial>' && stats) printWarningsSummary(bundler, stats, aboveInitial ?? takeWarningLines())
          // bilan de la première construction : `mjs check` liste toutes les fautes des fichiers en échec
          if (changed === '<initial>' && lastErrors.length > 0) console.error(t('cli.check-list-all'))
          // premier passage sans résultat : pas de bilan, le relevé des avertissements ne sert plus
          else if (changed === '<initial>') takeWarningLines()
          if (lastErrors.length > 0) {
            const msg = lastErrors.map(e => e.message).join('\n\n')
            server.hmr?.notifyError(msg)
            errorShown = true
          }
          // sauvegarde sans changement (stats.unchanged, cf. bundler) : la page n'a rien à recevoir, elle ne bouge pas
          else if (stats?.unchanged) {
            if (errorShown) server.hmr?.notifyErrorCleared()
            errorShown = false
          }
          else {
            errorShown = false
            // Renderer SSR/navigateur mémoïsé (createRenderHandler) : invalidé à CHAQUE recompile
            // RÉUSSI (y compris css-only, coût négligeable en dev — le SSR peut inliner du style)
            // — sans cet appel, un `mjs dev` avec bloc `render` servait indéfiniment le rendu
            // compilé AVANT la modification, la mémoïsation étant pensée pour la PRODUCTION (code
            // figé pour la vie du process), jamais pour un watcher qui recompile en continu.
            renderHandler?.invalidate()
            // Attend la fin de LA PASSE de prérendu couvrant CE changement (sérialisée, jamais deux
            // passes en vol, cf. createDevPrerenderScheduler) AVANT de notifier le navigateur — un
            // reload signalé avant la fin de l'écriture du fichier prérendu pouvait recharger sur le
            // HTML FIGÉ d'AVANT cette modification. Fire-and-forget au niveau du dev loop lui-même
            // (onRecompile reste synchrone pour le bundler, la RECOMPILATION suivante n'attend pas) :
            // seule la notification HMR de CE changement patiente.
            void devPrerenderScheduler.schedule().finally(() => {
              // Changement 100 % CSS (stats.cssOnly non nul, cf. bundler) :
              // hot-swap sans reload ni perte d'état (µ._hotCss côté page). Tout le
              // reste (JS/template touché, fichier ajouté/supprimé, moindre doute) →
              // reload complet, comportement historique. Une erreur SASS remonte via
              // stats.errors → branche notifyError ci-dessus (overlay), jamais css-only.
              if (stats?.cssOnly) {
                server.hmr?.notifyCssUpdate(stats.cssOnly)
                console.log(t('cli.css-only-reloaded'))
              }
              // composants seuls, nature inchangée (stats.hot, cf. bundler) : la page importe leurs nouveaux fichiers et redessine
              // leurs instances en gardant leur état (µ._hotSwap) ; elle se recharge en entier si l'échange n'est pas sûr, et le dit
              else if (stats?.hot) {
                hotNames = [...Object.keys(stats.hot.components), ...Object.keys(stats.hot.i18n ?? {}).map(l => 'i18n/' + l)].join(', ')
                server.hmr?.notifyHotUpdate(stats.hot)
              }
              else {
                server.notifyReload()
              }
            })
          }
        },
      })
      break
    }
    case 'serve': {
      // Serveur de rendu par requête. Exige un bloc `render`.
      if (!found?.config.render) {
        console.error(t('cli.serve-block-render-required'))
        process.exit(1)
      }
      // Compile d'abord : les assets servis + le renderer ont besoin d'un build frais.
      const stats = await bundler.compile()
      printBuildReport(stats)
      for (const e of stats.errors) console.error('  ', e.message)
      if (stats.errors.length > 0) { await bundler.close(); process.exit(1) }
      const port = args.port ?? cfgOpts.devPort ?? 3000
      const host = cfgOpts.devHost ?? '127.0.0.1'
      const running = await startRenderServer(renderConfig!, found.configDir, { port, host, env: envBuild })
      // ARRÊT PROPRE (Ctrl-C) — sans ces écouteurs, le process mourait sur le signal par défaut :
      // `running.close()` n'était jamais atteint, donc ni le renderer de rendu par requête ni son
      // dossier de travail (`mjs-render-*`, cf. server/render-compile-dir.ts) — un dossier laissé
      // derrière PAR SESSION. Même patron que `mjs ws`/`mjs server` : une seule passe (stopGuard :
      // le même Ctrl+C reçu deux fois attend le premier, un 2e Ctrl+C plus d'une seconde après sort
      // aussitôt), sortie au code adéquat une fois tout refermé, bornée par SHUTDOWN_GRACE_MS. Les
      // écouteurs RESTENT posés pendant la fermeture asynchrone : retirés, le gestionnaire de
      // signaux de tsx (lancement depuis les sources) ne voyait plus aucun écouteur et sortait
      // aussitôt en 130, coupant les requêtes en vol.
      const onSignal = stopGuard((): void => {
        setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref()
        void (async () => {
          let code = 0
          try {
            await running.close()
            await bundler.close()
          } catch (e: any) {
            console.error(t('cli.serve-stop-failed', { error: e?.message || e }))
            code = 1
          }
          // 0 quand tout s'est refermé, comme `mjs ws`/`mjs server` : un arrêt demandé qui aboutit
          // n'est pas un échec. Seule une fermeture EN ERREUR sort en 1.
          process.exit(code)
        })()
      }, () => process.exit(0))
      process.on('SIGINT', onSignal)
      process.on('SIGTERM', onSignal)
      console.log(t('cli.serve-started', { host, port: running.port }))
      console.log(t('cli.serve-mode-info'))
      break
    }
    case 'ws': {
      // serveur temps réel (MJS-WS) — pas de compilation, `bundler` construit
      // ci-dessus n'est pas utilisé ici (cf. cli/ws.ts pour la logique complète :
      // résolution d'entry, contrat, rechargement à chaud, arrêt propre).
      // `ws.entry` et les défauts se lisent depuis le dossier de mjs.config.json, même lancé d'un sous-dossier (comme `mjs dev` et
      // `mjs build`) ; `--entry` depuis le dossier courant
      await runWsCommand({ root: found?.configDir ?? args.root, entry: args.entry === undefined ? undefined : resolve(args.root, args.entry), port: args.port, host: args.host }, found?.config)
      break
    }
    case 'server': {
      // serveur de jeu (MJS-Server, mjsServer() + app.game()) — pas de compilation, `bundler`
      // construit ci-dessus n'est pas utilisé ici (cf. cli/server.ts pour la logique complète :
      // résolution d'entry, contrat, rechargement à chaud, arrêt propre — MÊME patron que `mjs ws`).
      // même racine que `mjs ws` : le dossier de mjs.config.json pour `server.entry` et les défauts, le dossier courant pour `--entry`
      await runServerCommand({ root: found?.configDir ?? args.root, entry: args.entry === undefined ? undefined : resolve(args.root, args.entry), port: args.port, host: args.host }, found?.config)
      break
    }
    case 'check': {
      const root = found?.configDir ?? process.cwd()
      // bloc MJS de l'AGENTS.md du projet rétabli (cf. cli/agents-md.ts) — jamais de fichier créé ici
      syncAgentsMd(root, { create: false })
      // `--json` : la même compilation, rendue en un document (écrit à la sortie, cf. cli/check-json.ts)
      if (checkJson) {
        const stats   = await bundler.compile()
        // sans objet aujourd'hui : `--json` compile tout dans le processus principal (inlineTranspileLimit, plus haut), aucun pool ne vit et cet appel rend la main aussitôt — il reste le filet si des fils d'exécution écrivaient ici (leurs lignes capturées avant que le document soit rempli)
        await flushWorkerOutput()
        const derived = args.derived ? [...bundler.derivedClasses].flatMap(([file, list]) => list.map((d) => ({ file: relative(root, file), name: d.name, class: d.class, reasons: d.reasons.map((r) => ({ code: r.code, name: r.name, by: r.by })) }))) : undefined
        // toutes les fautes de chaque fichier en échec, comme le texte (cf. cli/check-faults.ts)
        const listing = stats.errors.length > 0 ? await FaultListing.collect(bundler, stats.errors, root) : null
        checkJson.setResult({ components: Object.keys(stats.manifest).filter((k) => !k.startsWith('__')).sort(), errors: listing === null ? [] : listing.faults.map((f) => f.message), places: listing?.places(), warnings: stats.warnings, derived, listing: listing?.summary() })
        await bundler.close()
        process.exit(stats.errors.length > 0 ? 1 : 0)
      }
      // Vérifie la config + liste les composants détectés.
      console.log(`Source dir   : ${bundler.sourceDir}`)
      console.log(`Output dir   : ${bundler.outputDir}`)
      console.log(`Manifest     : ${bundler.manifestPath}`)
      console.log(`Stylesheets  : ${bundler.stylesheetsDir}`)
      console.log(`Default lang : ${bundler.defaultScriptLang}`)
      console.log(``)

      // Le commentaire prétendait une
      // "compilation à blanc" (dry-run) : FAUX, `bundler.compile()` est le
      // MÊME compile RÉEL que `mjs build` — il écrit tout autant les fichiers
      // hashés + le manifest dans outputDir/manifestPath. Un dev qui lance
      // `mjs check` en pensant faire une simple vérification READ-ONLY
      // écrase en réalité sa sortie compilée sans le savoir. Fix : commentaire
      // corrigé + avertissement explicite avant de compiler (aucun dry-run
      // implémenté — refactor disproportionné pour ce cas ; l'important est
      // que l'utilisateur ne soit plus surpris).
      console.log(t('cli.check-compile-real', { dir: bundler.outputDir }))
      const stats = await bundler.compile()
      const above = await settleWarningLines()
      const components = Object.keys(stats.manifest)
        .filter(k => !k.startsWith('__'))
      console.log(t('cli.components-detected', { count: components.length }))
      for (const c of components.slice(0, 20)) console.log(`   - ${c}`)
      if (components.length > 20) console.log(t('cli.and-n-others', { count: components.length - 20 }))
      console.log(``)
      if (args.derived) printDerivedReport(bundler.derivedClasses, process.cwd(), bundler.derivedPrecise)
      // toutes les fautes de chaque fichier en échec, rangées par fichier (cf. cli/check-faults.ts)
      if (stats.errors.length > 0) (await FaultListing.collect(bundler, stats.errors, root)).print(colorsEnabled)
      // même bilan d'avertissements que `mjs build` : `check` compile pareil, il doit dire pareil
      printWarningsSummary(bundler, stats, above)
      if (stats.errors.length > 0) {
        await bundler.close()
        process.exit(1)
      }
      console.log(t('cli.all-compile-ok', { count: stats.written }))
      await bundler.close()
      process.exit(0)
    }
  }
}

run(process.argv.slice(2)).catch(e => {
  // Filet générique : `checkWritablePath` (ci-dessus) attrape le cas courant
  // AVANT de compiler, mais une erreur d'ÉCRITURE peut encore survenir en cours de build (droits
  // révoqués en vol, disque plein…) — code fs CONNU → message catalogue nommant le chemin ; port
  // déjà pris (`EADDRINUSE`) → message qui nomme le port et `--port` ; plutôt que la stack Node
  // brute. Le reste (erreur vraiment inattendue) garde sa trace complète, jamais moins d'information qu'avant.
  if (e && typeof e.code === 'string' && FS_ERROR_CODES.has(e.code)) {
    console.error(t('cli.error-write', { code: e.code, path: e.path ?? '?', error: e.message }))
  } else if (e?.code === 'EADDRINUSE') {
    console.error(t('cli.port-already-taken', { port: e.port ?? '?', host: e.address ?? '?' }))
  } else {
    console.error('❌', e)
  }
  process.exit(1)
})
