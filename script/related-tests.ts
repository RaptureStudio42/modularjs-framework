// npm run test:lies -- [fichiers changés] : ne joue que les tests liés à un changement, dans un budget de temps (300 s
// par défaut). Sans argument, les fichiers changés sont ceux que git voit modifiés, ajoutés ou supprimés.
// Un test est lié quand son relevé (tests/helpers/test-trace.ts : ce qu'il a lu pendant ses passages) ou le graphe
// statique des imports, recalculé ici, le relie à un fichier changé ; le test changé lui-même et ceux sans relevé
// (signalés) s'y ajoutent. Pour un fichier du cœur, d'un effet ou du runtime, les tests qui le visent passent devant :
// ceux que leur nom désigne (`core-select-…` pour select.mjs), puis ceux qui le citent dans leur source (nom du fichier,
// import, balise `<@@select>`, effet `*liquid`) ; le constructeur du Bundler lit tous les modules du cœur, si bien que
// presque tout test relevé « lit » chacun d'eux. Les choisis passent par priorité — test changé, nommé, cité, lien
// direct (lu pendant le test, ou importé par le test ou ses aides), lien à distance (import d'import dans src/), sans
// relevé —, puis par famille (le début du nom) du plus court au plus long, chaque famille gardant un représentant avant
// qu'une autre en ait deux : le budget coupe par la fin de cet ordre, et le reste est listé « non joué ». Ils se jouent
// sous script/test-enclos.sh en plusieurs voies (un mocha par voie), un seul moteur par défaut (MJS_MOTEURS=chromium) ;
// un rouge se rejoue seul, après la passe, par ordre de priorité, avant d'être cru

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, constants, freemem, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compactTrace, enginesKey, traceDir, type TraceEntry } from '../tests/helpers/test-trace.js'
import { declaredEngines, parseEngines } from '../tests/helpers/engine-filter.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// CHOIX — réglages par défaut de l'outil
const BUDGET_S       = 300                 //la promesse : moins de 5 min
const MAX_LANES      = 4                   //voies au plus, un mocha chacune
const LANE_MEMORY    = 3 * 1024 ** 3       //mémoire disponible exigée par voie
const OVERHEAD_MS    = 6000                //démarrage d'un mocha sous l'enclos (tsx, chargement des sources)
const PLAN_SHARE     = 0.8                 //part du budget remplie par le plan ; le reste aux rejeux et à l'imprévu
const MAIN_SHARE     = 0.9                 //la passe principale est coupée à 90 % du budget
const END_MARGIN_MS  = 5000                //fin des rejeux 5 s avant le budget : arrêt des processus et bilan tiennent dedans
const CHROMIUM_SHARE = 0.7                 //part de Chromium dans la durée d'un test navigateur joué sur les trois moteurs
const FAMILY_SPLIT   = 50                  //au-delà de 50 fichiers, une famille se divise par son deuxième mot
const PASSES_KEPT    = 10                  //journaux de passage gardés
const ESTIMATE_MS    = { navigateur: 28000, cli: 10000, compile: 4000, statique: 600 }   //durée supposée d'un fichier sans relevé

export type Kind = 'navigateur' | 'cli' | 'compile' | 'statique'
export type TestInfo = { file: string, kind: Kind, cli: boolean, family: string, engines: Set<string> | null | undefined, source?: string }
export type Change = { file: string, state: 'modifié' | 'ajouté' | 'supprimé' }
export type Reach = Map<string, { d: number, from: string }>
export type Candidate = { file: string, level: 0 | 1 | 2 | 3 | 4 | 5, why: string, traced: boolean, ms: number, family: string, kind: Kind }
export type FileResult = { done: boolean, failures: number, failed: string[], tests: number, pending: number, skippedEngines: Record<string, number> }
export type LaneResult = { code: number, killed: boolean, files: Record<string, FileResult>, log: string }
export type Job = { files: string[], name: string, deadline: number }
export type Runner = (job: Job) => Promise<LaneResult>
export type Status = 'vert' | 'instable' | 'rouge' | 'rouge non rejoué' | 'interrompu' | 'voie tombée'
export type Outcome = { status: Map<string, Status>, replays: string[], lanes: LaneResult[], failed: Map<string, string[]>, skippedEngines: Record<string, number>, laneFailures: LaneResult[], short: Map<string, { left: number, need: number }> }

// ----------------------------------------------------------------------------------------------------------------------
// GRAPHE STATIQUE DES IMPORTS
// ----------------------------------------------------------------------------------------------------------------------

const IMPORT_FROM = /(?:^|\n)[ \t]*(?:import|export)(\s+type\b)?[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g
const IMPORT_BARE = /(?:^|\n)[ \t]*import\s*['"]([^'"\n]+)['"]/g
const IMPORT_CALL = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g
const LITERAL     = /['"`]((?:\.\.?\/)+(?:src|tests|bin)\/[^'"`\s$]+)['"`]/g          //chemin du projet écrit en toutes lettres dans un test (lecture de fichier)
const SKIPPED     = /^(tests\/snapshots|tests\/browser-smoke\/fixture\/sortie)(\/|$)|(^|\/)node_modules(\/|$)/
const PARSED      = /\.(ts|mts|cts|js|cjs)$/

function walk(root: string, dir: string, out: string[]): void {
  let entries
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`
    if (SKIPPED.test(rel)) continue
    if (e.isDirectory()) walk(root, rel, out)
    else if (e.isFile()) out.push(rel)
  }
}

function resolveSpec(from: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const base = posix.normalize(posix.join(posix.dirname(from), spec.split('?')[0]))
  for (const t of [base, base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.mts'), base.replace(/\.cjs$/, '.cts'), `${base}.ts`, `${base}/index.ts`]) {
    if (files.has(t)) return t
  }
  return base.startsWith('..') ? null : base.replace(/\.js$/, '.ts')                 //cible absente (supprimée) : nœud fantôme, ses importeurs restent liés
}

// fichier → fichiers du projet qu'il importe (sans les imports de type seul) ; un test ajoute les chemins du projet
// qu'il écrit en toutes lettres (lecture d'un fichier de src/ par un test statique)
export function buildGraph(root: string): Map<string, Set<string>> {
  const all = [] as string[]
  walk(root, 'src', all)
  walk(root, 'tests', all)
  const files = new Set(all)
  const graph = new Map<string, Set<string>>()
  for (const file of all) {
    if (!PARSED.test(file)) continue
    let source = ''
    try { source = readFileSync(join(root, file), 'utf-8') } catch { continue }
    const deps = new Set<string>()
    const add  = (spec: string) => {
      const target = resolveSpec(file, spec, files)
      if (target && target !== file) deps.add(target)
    }
    for (const m of source.matchAll(IMPORT_FROM)) if (!m[1]) add(m[2])
    for (const m of source.matchAll(IMPORT_BARE)) add(m[1])
    for (const m of source.matchAll(IMPORT_CALL)) add(m[1])
    if (file.startsWith('tests/')) {
      for (const m of source.matchAll(LITERAL)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[1]))
        if (files.has(target)) deps.add(target)
      }
    }
    graph.set(file, deps)
  }
  return graph
}

// distance de chaque fichier aux cibles, en nombre d'imports traversés DANS src/ : un test, ses aides et ses fixtures
// ne comptent pas (un import par une aide du test reste un lien direct) ; parcours en largeur à poids 0 ou 1
export function distancesTo(graph: Map<string, Set<string>>, targets: string[]): Reach {
  const reverse = new Map<string, string[]>()
  for (const [from, deps] of graph) {
    for (const d of deps) {
      if (!reverse.has(d)) reverse.set(d, [])
      reverse.get(d)!.push(from)
    }
  }
  const out: Reach = new Map()
  const queue      = [] as string[]
  for (const t of targets) {
    out.set(t, { d: 0, from: t })
    queue.push(t)
  }
  while (queue.length) {
    const node = queue.shift()!
    const here = out.get(node)!
    for (const from of reverse.get(node) ?? []) {
      const w = from.startsWith('src/') ? 1 : 0
      const d = here.d + w
      const seen = out.get(from)
      if (seen && seen.d <= d) continue
      out.set(from, { d, from: here.from })
      if (w) queue.push(from)
      else queue.unshift(from)
    }
  }
  return out
}

// ----------------------------------------------------------------------------------------------------------------------
// LES TESTS
// ----------------------------------------------------------------------------------------------------------------------

export function familyOf(file: string, counts: Map<string, number>): string {
  const words = basename(file).replace(/\.test\.ts$/, '').split('-')
  return (counts.get(words[0]) ?? 0) > FAMILY_SPLIT && words.length > 1 ? `${words[0]}-${words[1]}` : words[0]
}

const CLI_RE     = /bin\/mjs|['"]bin['"],\s*['"]mjs['"]|dist\/cli|assertDistFrais/
const COMPILE_RE = /\bBundler\b|compilerScript|\.compile\(/

// les fichiers de test que `npm test` joue, avec leur nature (lue dans le source et dans celui de leurs aides)
export function testInfos(root: string, graph: Map<string, Set<string>>): TestInfo[] {
  const files  = readdirSync(join(root, 'tests')).filter((n) => n.endsWith('.test.ts')).sort().map((n) => `tests/${n}`)
  const counts = new Map<string, number>()
  for (const f of files) {
    const first = basename(f).split('-')[0].replace(/\.test\.ts$/, '')
    counts.set(first, (counts.get(first) ?? 0) + 1)
  }
  const read = (f: string) => {
    try { return readFileSync(join(root, f), 'utf-8') } catch { return '' }
  }
  const helpers = new Map<string, string>()
  for (const f of graph.keys()) if (f.startsWith('tests/helpers/')) helpers.set(f, read(f))
  return files.map((file) => {
    const source = read(file)
    const aides  = [...(graph.get(file) ?? [])].filter((d) => helpers.has(d)).map((d) => helpers.get(d)!)
    const texts  = [source, ...aides]
    const cli    = CLI_RE.test(source)
    const kind: Kind = texts.some((t) => /playwright/.test(t)) ? 'navigateur' : cli ? 'cli' : texts.some((t) => COMPILE_RE.test(t)) ? 'compile' : 'statique'
    return { file, kind, cli, family: familyOf(file, counts), engines: declaredEngines(source), source }
  })
}

// durée attendue : celle du relevé pour le même réglage de moteurs, sinon rapportée d'un autre réglage, sinon supposée
function estimate(t: TestInfo, e: TraceEntry | undefined, engines: string): number {
  const ms      = e?.ms ?? {}
  const browser = t.kind === 'navigateur'
  if (ms[engines] !== undefined) return ms[engines]
  if (engines !== 'tous' && ms.tous !== undefined) return browser ? Math.round(ms.tous * CHROMIUM_SHARE) : ms.tous
  const other = Object.values(ms)[0]
  if (other !== undefined) return browser && engines === 'tous' ? Math.round(other / CHROMIUM_SHARE) : other
  return browser && engines !== 'tous' ? Math.round(ESTIMATE_MS.navigateur * CHROMIUM_SHARE) : ESTIMATE_MS[t.kind]
}

// ----------------------------------------------------------------------------------------------------------------------
// LE CHOIX
// ----------------------------------------------------------------------------------------------------------------------

export type Aim = { file: string, words: string[], cites: RegExp }

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ce qui vise un fichier du cœur, d'un effet ou du runtime : les mots de son nom (sans `mjs_`, ni `fx_` pour un effet ;
// `core-select` pour un module du cœur, un test `for-select-…` parle de la balise <select>), que porte le nom d'un test
// qui lui est consacré, et ce qu'en écrit la source d'un test qui s'en sert — le nom du fichier
// (un chemin, un import en .js), `mjs_every` sans extension, la balise `<@@select>` d'un module du cœur, `*liquid` pour
// l'effet de src/runtime/mjs_fx_liquid.ts. Un autre fichier ne vise rien : son lien passe par le relevé et les imports
export function aimOf(file: string): Aim | null {
  const m = /^src\/(core-modules|runtime|effects)\/(?:.+\/)?([^/]+?)\.[^./]+$/.exec(file)
  if (!m) return null
  const stem  = m[2]
  const word  = stem.replace(/^mjs_(fx_)?/, '')
  const cites = [`(?<![\\w$.-])${escapeRe(basename(file))}(?![\\w-])`]
  if (stem !== word) cites.push(`(?<![\\w$.-])${escapeRe(stem)}(?![\\w-])`)
  if (m[1] === 'core-modules') cites.push(`<@@${escapeRe(stem)}(?![\\w-])`)
  if (stem.startsWith('mjs_fx_')) cites.push(`(?<![\\w$*)\\]])\\*${escapeRe(word.replace(/_/g, '-'))}(?![\\w-])`)
  const words = word.toLowerCase().split(/[_-]+/).filter(Boolean)
  return { file, words: m[1] === 'core-modules' ? ['core', ...words] : words, cites: new RegExp(cites.join('|')) }
}

// le nom du test porte les mots du fichier visé, à la suite : `core-select-attente` pour select.mjs, `for-nested-…`
// pour mjs_for_nested.ts
function namedBy(test: string, aim: Aim): boolean {
  const words = basename(test).replace(/\.test\.ts$/, '').toLowerCase().split('-')
  return words.some((_, i) => aim.words.every((w, k) => words[i + k] === w))
}

// niveau 0 : test changé ; 1 : son nom désigne un fichier changé du cœur, d'un effet ou du runtime ; 2 : sa source le
// cite ; 3 : lien direct (lu pendant le test, importé par lui ou ses aides) ; 4 : lien à distance (import d'import dans
// src/, ou bin/mjs qui lit tout src/) ; 5 : sans relevé ni lien. Avec `all` (--tout), chaque test entre : ceux sans
// relevé d'abord, pour remplir le relevé
export function selectTests(o: { tests: TestInfo[], changes: Change[], trace: Map<string, TraceEntry>, reach: Reach, engines: string, all?: boolean }): Candidate[] {
  const changed = new Set(o.changes.map((c) => c.file))
  const moved   = o.changes.filter((c) => c.state !== 'modifié').map((c) => posix.dirname(c.file))
  const src     = o.changes.some((c) => c.file.startsWith('src/'))
  const aims    = o.changes.map((c) => aimOf(c.file)).filter((a): a is Aim => a !== null)
  const out     = [] as Candidate[]
  for (const t of o.tests) {
    const e      = o.trace.get(t.file)
    const traced = Boolean(e?.at)
    const r      = o.reach.get(t.file)
    let level: Candidate['level'] | undefined
    let why      = ''
    const read   = e?.reads.find((x) => changed.has(x))
    const dir    = e?.dirs.find((x) => moved.includes(x))
    const named  = aims.find((a) => namedBy(t.file, a))
    const cited  = named ? undefined : aims.map((a) => ({ a, m: t.source?.match(a.cites) })).find((x) => x.m)
    if (changed.has(t.file)) [level, why] = [0, 'test changé']
    else if (named) [level, why] = [1, `son nom désigne ${named.file}`]
    else if (cited) [level, why] = [2, `cite ${cited.a.file} (« ${cited.m![0]} »)`]
    else if (read) [level, why] = [3, `lit ${read}`]
    else if (dir) [level, why] = [3, `liste ${dir}/`]
    else if (r && r.d === 0) [level, why] = [3, `importe ${r.from}`]
    else if (r) [level, why] = [4, `atteint ${r.from} par ${r.d} import(s) de src/`]
    else if (src && (t.cli || e?.spawns.some((s) => /^(bin\/mjs|dist\/|src\/cli\.ts)/.test(s)))) [level, why] = [4, 'lance bin/mjs, qui lit tout src/']
    else if (o.all) [level, why] = traced ? [5, 'déjà relevé (--tout)'] : [4, 'sans relevé']
    else if (!traced) [level, why] = [5, 'sans relevé']
    if (level === undefined) continue
    if (!traced && !why.startsWith('sans relevé')) why += ' — sans relevé'
    out.push({ file: t.file, level, why, traced, ms: estimate(t, e, o.engines), family: t.family, kind: t.kind })
  }
  return out
}

const byMs = (a: Candidate, b: Candidate) => a.ms - b.ms || a.file.localeCompare(b.file)

// par niveau, puis famille par famille du plus court au plus long : un représentant de chaque famille avant le deuxième
export function orderCandidates(chosen: Candidate[]): Candidate[] {
  const out = [] as Candidate[]
  for (const level of [0, 1, 2, 3, 4, 5]) {
    const families = new Map<string, Candidate[]>()
    for (const c of chosen) {
      if (c.level !== level) continue
      if (!families.has(c.family)) families.set(c.family, [])
      families.get(c.family)!.push(c)
    }
    const lists = [...families.values()].map((l) => l.sort(byMs)).sort((a, b) => byMs(a[0], b[0]))
    for (let round = 0; lists.some((l) => l.length > round); round++) {
      for (const l of lists) if (l[round]) out.push(l[round])
    }
  }
  return out
}

// chaque choisi, dans l'ordre, va à la voie la moins chargée (part du budget moins le démarrage) ; le premier qui n'y
// tient plus arrête le plan : le budget coupe par la fin de l'ordre, jamais un test d'avant au profit d'un d'après. Un
// test plus long qu'une voie entière ne tiendrait nulle part : il est mis de côté (« non joué ») sans arrêter la suite
export function planRun(chosen: Candidate[], o: { budgetMs: number, lanes: number, overheadMs: number }): { lanes: Candidate[][], loads: number[], played: Candidate[], notPlayed: Candidate[], cap: number } {
  const cap       = o.budgetMs * PLAN_SHARE - o.overheadMs
  const lanes     = Array.from({ length: Math.max(1, o.lanes) }, () => [] as Candidate[])
  const loads     = lanes.map(() => 0)
  const played    = [] as Candidate[]
  const notPlayed = [] as Candidate[]
  let full        = false
  for (const c of orderCandidates(chosen)) {
    const i = loads.indexOf(Math.min(...loads))
    if (!full && loads[i] + c.ms <= cap) {
      loads[i] += c.ms
      lanes[i].push(c)
      played.push(c)
      continue
    }
    if (c.ms <= cap) full = true
    notPlayed.push(c)
  }
  return { lanes, loads, played, notPlayed, cap }
}

// le budget laisse-t-il la place d'un rejeu ? Les rejeux partent après la passe principale, coupée à 90 % du budget, et
// finissent 5 s avant lui ; un rejeu coûte le démarrage d'un mocha et la durée du test. Rend l'avertissement à écrire
export function replayWarning(budgetS: number, played: Candidate[]): string | null {
  if (!played.length) return null
  const main  = budgetS * 1000 * MAIN_SHARE
  const room  = budgetS * 1000 - END_MARGIN_MS - main
  const need  = OVERHEAD_MS + Math.min(...played.map((c) => c.ms))
  if (room >= need) return null
  const least = Math.ceil(Math.round((END_MARGIN_MS + need) / (1 - MAIN_SHARE)) / 1000)   //arrondi : 1 - 0,9 ne tombe pas juste en binaire
  return `rejeux : budget trop court — après la coupe de la passe principale (${Math.round(main / 1000)} s), il reste ${Math.max(0, Math.round(room / 1000))} s, moins que le rejeu seul du plus court des tests joués (≈ ${Math.round(need / 1000)} s) : un rouge n'y sera rejoué que si la passe finit avant sa coupe ; --budget ${least} au moins pour garder la place d'un rejeu`
}

// ----------------------------------------------------------------------------------------------------------------------
// LE PASSAGE
// ----------------------------------------------------------------------------------------------------------------------

// les voies en parallèle jusqu'à l'échéance principale ; puis chaque rouge rejoué SEUL (un fichier, un mocha, l'un après
// l'autre, machine au calme), par ordre de priorité (celui du plan), s'il tient avant la fin du budget : vert seul =
// « instable », rouge encore = « rouge » ; faute de temps, « rouge non rejoué », avec le temps qui restait et celui
// qu'il fallait
export async function executeRun(plan: { lanes: Candidate[][], played?: Candidate[] }, o: { runner: Runner, mainDeadline: number, endDeadline: number, overheadMs: number, now?: () => number, log?: (line: string) => void }): Promise<Outcome> {
  const now            = o.now ?? Date.now
  const status         = new Map<string, Status>()
  const failed         = new Map<string, string[]>()
  const skippedEngines = {} as Record<string, number>
  const estimates      = new Map<string, number>()
  const active         = plan.lanes.filter((l) => l.length)
  const lanes          = await Promise.all(active.map((lane, i) => o.runner({ files: lane.map((c) => c.file), name: `voie-${i + 1}`, deadline: o.mainDeadline }).then((r) => {
    const reds = lane.filter((c) => r.files[c.file]?.failures).length
    o.log?.(`  voie ${i + 1} : ${lane.length} fichier(s), ${reds} rouge(s)${r.killed ? ', coupée à l\'échéance' : ''} — ${r.log}`)
    return r
  })))
  const reds         = [] as string[]
  const laneFailures = [] as LaneResult[]
  active.forEach((lane, i) => {
    const r = lanes[i]
    let attributed = false
    for (const c of lane) {
      estimates.set(c.file, c.ms)
      const f = r.files[c.file]
      for (const [n, k] of Object.entries(f?.skippedEngines ?? {})) skippedEngines[n] = (skippedEngines[n] ?? 0) + k
      if (f?.failures) {
        reds.push(c.file)
        failed.set(c.file, f.failed)
        attributed = true
      }
      else if (f?.done) status.set(c.file, 'vert')
      else status.set(c.file, r.killed ? 'interrompu' : 'voie tombée')
    }
    if (!r.killed && r.code !== 0 && !attributed) laneFailures.push(r)
  })
  const rank    = new Map((plan.played ?? plan.lanes.flat()).map((c, i) => [c.file, i]))
  const replays = [] as string[]
  const short   = new Map<string, { left: number, need: number }>()
  reds.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
  for (const file of reds) {
    const left = o.endDeadline - now()
    const need = (estimates.get(file) ?? 0) + o.overheadMs
    if (need > left) {
      status.set(file, 'rouge non rejoué')
      short.set(file, { left: Math.max(0, left), need })
      continue
    }
    replays.push(file)
    const r = await o.runner({ files: [file], name: `rejeu-${replays.length}`, deadline: o.endDeadline })
    const f = r.files[file]
    if (f?.done && !f.failures) status.set(file, 'instable')
    else if (f?.failures) {
      status.set(file, 'rouge')
      failed.set(file, f.failed)
    }
    else status.set(file, 'rouge non rejoué')
    o.log?.(`  rejeu seul : ${file} → ${status.get(file)} — ${r.log}`)
  }
  return { status, replays, lanes, failed, skippedEngines, laneFailures, short }
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return
  try { process.kill(-pid, signal) } catch { /* déjà parti */ }
}

// une voie = `bash script/test-enclos.sh <fichiers>` dans son groupe de processus, TMPDIR court à elle, journal à elle ;
// son fragment du relevé (MJS_TEST_TRACE_FILE) dit fichier par fichier ce qui a fini et ce qui a rougi ; l'échéance
// passée, le groupe reçoit SIGTERM (Playwright ferme ses navigateurs), puis SIGKILL 3 s plus tard
export function realRunner(o: { root: string, passDir: string, fragmentDir: string, tmpBase: string, env: Record<string, string> }): Runner {
  return async (job) => {
    mkdirSync(o.passDir, { recursive: true })
    mkdirSync(o.fragmentDir, { recursive: true })
    const log      = join(o.passDir, `${job.name}.log`)
    const fragment = join(o.fragmentDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${job.name}.json`)
    const tmp      = mkdtempSync(join(o.tmpBase, 'tl-'))
    const fd       = openSync(log, 'w')
    const child    = spawn('bash', [join(o.root, 'script', 'test-enclos.sh'), ...job.files], { cwd: o.root, env: { ...process.env, ...o.env, TMPDIR: tmp, MJS_TEST_TRACE_FILE: fragment }, stdio: ['ignore', fd, fd], detached: true })
    closeSync(fd)
    let killed     = false
    const timer    = setTimeout(() => {
      killed = true
      killGroup(child.pid, 'SIGTERM')
      setTimeout(() => killGroup(child.pid, 'SIGKILL'), 3000).unref()
    }, Math.max(0, job.deadline - Date.now()))
    const code     = await new Promise<number>((done) => {
      child.on('error', () => done(127))
      child.on('exit', (c, s) => done(c ?? (s ? 128 + ((constants.signals as any)[s] ?? 1) : 1)))
    })
    clearTimeout(timer)
    const files    = {} as Record<string, FileResult>
    try {
      const data = JSON.parse(readFileSync(fragment, 'utf-8'))
      for (const f of job.files) {
        const abs = resolve(o.root, f)
        const key = abs.startsWith(o.root + sep) ? abs.slice(o.root.length + 1).split(sep).join('/') : abs
        if (data.files?.[key]) files[f] = data.files[key]
      }
    }
    catch { /* aucun fragment : voie tombée avant le premier fichier */ }
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* rien */ }
    return { code, killed, files, log }
  }
}

// ----------------------------------------------------------------------------------------------------------------------
// LES FICHIERS CHANGÉS
// ----------------------------------------------------------------------------------------------------------------------

function git(root: string, args: string[]) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf-8' })
}

// ce que git voit changé sous la racine du paquet : modifié, ajouté (nouveau ou non suivi), supprimé
export function changesFromGit(root: string): Change[] {
  const prefix = git(root, ['rev-parse', '--show-prefix'])
  if (prefix.status !== 0) throw new Error(`git ne répond pas ici (${prefix.stderr.trim()}) : donnez les fichiers changés en argument`)
  const head   = prefix.stdout.trim()
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
  const parts  = status.stdout.split('\0')
  const out    = [] as Change[]
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    const xy   = p.slice(0, 2)
    const path = p.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++                                       //renommage : l'ancien chemin suit
    if (!path.startsWith(head)) continue
    const state = xy.includes('D') ? 'supprimé' : xy === '??' || xy.includes('A') || xy[0] === 'R' ? 'ajouté' : 'modifié'
    out.push({ file: path.slice(head.length), state })
  }
  return out
}

// fichiers donnés en argument : relatifs au dossier courant, à la racine du paquet, ou au dépôt (ModularJS/src/…)
export function changesFromArgs(root: string, args: string[]): Change[] {
  return args.map((a) => {
    const name  = basename(root)
    const tries = [isAbsolute(a) ? a : resolve(process.cwd(), a), resolve(root, a), a.startsWith(`${name}/`) ? resolve(root, a.slice(name.length + 1)) : '']
    const abs   = tries.find((t) => t && t.startsWith(root + sep) && existsSync(t)) ?? tries.find((t) => t && t.startsWith(root + sep)) ?? resolve(root, a)
    const file  = relative(root, abs).split(sep).join('/')
    if (!existsSync(abs)) return { file, state: 'supprimé' as const }
    return { file, state: git(root, ['ls-files', '--error-unmatch', '--', file]).status === 0 ? 'modifié' as const : 'ajouté' as const }
  })
}

// dist/cli.js plus ancien qu'un fichier de src/ : bin/mjs jouerait l'ancien compilateur
function staleDist(root: string): string | null {
  const cli = join(root, 'dist', 'cli.js')
  if (!existsSync(cli)) return null
  const all = [] as string[]
  walk(root, 'src', all)
  let newest = { file: '', ms: 0 }
  for (const f of all) {
    const ms = statSync(join(root, f)).mtimeMs
    if (ms > newest.ms) newest = { file: f, ms }
  }
  return newest.ms > statSync(cli).mtimeMs ? newest.file : null
}

function defaultLanes(): number {
  return Math.max(1, Math.min(MAX_LANES, Math.floor(availableParallelism() / 2), Math.floor(freemem() / LANE_MEMORY)))
}

// ----------------------------------------------------------------------------------------------------------------------
// LIGNE DE COMMANDE
// ----------------------------------------------------------------------------------------------------------------------

const USAGE = `npm run test:lies -- [fichiers changés…] [options]
  sans fichier : ceux que git voit modifiés, ajoutés ou supprimés
  --budget <s>   budget de temps en secondes (défaut ${BUDGET_S})
  --voies <n>    processus mocha en parallèle (défaut : selon la machine, ${MAX_LANES} au plus)
  --a-blanc      montre le choix et le plan sans rien jouer
  --build        reconstruit dist/ (npm run build:self) s'il est périmé, au lieu d'écarter les tests de bin/mjs
  --tout         tous les tests sont candidats, ceux sans relevé d'abord (pour remplir le relevé)
  MJS_MOTEURS    chromium par défaut ici ; tous pour Chromium, Firefox et WebKit
  MJS_TEST_TRACE dossier du relevé (défaut node_modules/.cache/mjs-tests), 0 pour l'éteindre`

type Options = { files: string[], budget: number, lanes?: number, dryRun: boolean, build: boolean, all: boolean, help: boolean }

function parseArgs(argv: string[]): Options {
  const o: Options = { files: [], budget: BUDGET_S, dryRun: false, build: false, all: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--budget') o.budget = Number(argv[++i])
    else if (a === '--voies') o.lanes = Number(argv[++i])
    else if (a === '--a-blanc') o.dryRun = true
    else if (a === '--build') o.build = true
    else if (a === '--tout') o.all = true
    else if (a === '--aide' || a === '-h' || a === '--help') o.help = true
    else if (a.startsWith('--')) throw new Error(`option inconnue ${a}\n${USAGE}`)
    else o.files.push(a)
  }
  if (!(o.budget > 0)) throw new Error(`--budget attend un nombre de secondes\n${USAGE}`)
  if (o.lanes !== undefined && !(o.lanes >= 1)) throw new Error(`--voies attend un nombre entier, au moins 1\n${USAGE}`)
  return o
}

const n = (x: number) => x.toLocaleString('fr-FR')
const s = (ms: number) => {
  const t = Math.round(ms / 1000)
  return t >= 60 ? `${Math.floor(t / 60)} min ${t % 60} s` : `${t} s`
}

export async function main(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  const t0      = Date.now()
  const opts    = parseArgs(argv)
  if (opts.help) {
    out(USAGE)
    return 0
  }
  const engines = enginesKey(process.env.MJS_MOTEURS || 'chromium')
  parseEngines(engines)
  const changes = opts.all ? [] : opts.files.length ? changesFromArgs(ROOT, opts.files) : changesFromGit(ROOT)
  if (!changes.length && !opts.all) {
    out('tests liés : aucun fichier changé, rien à jouer')
    return 0
  }
  const dir     = traceDir(ROOT)
  const trace   = dir ? compactTrace(dir) : new Map<string, TraceEntry>()
  const graph   = buildGraph(ROOT)
  const tests   = testInfos(ROOT, graph)
  const reach   = distancesTo(graph, changes.map((c) => c.file))
  const chosen  = selectTests({ tests, changes, trace, reach, engines, all: opts.all })
  const stale   = staleDist(ROOT)
  const cli     = new Set(tests.filter((t) => t.cli || trace.get(t.file)?.spawns.some((x) => /^(bin\/mjs|dist\/)/.test(x))).map((t) => t.file))
  const blocked = stale && !opts.build ? chosen.filter((c) => cli.has(c.file)) : []
  const lanesN  = opts.lanes ?? defaultLanes()
  const plan    = planRun(chosen.filter((c) => !blocked.includes(c)), { budgetMs: opts.budget * 1000, lanes: lanesN, overheadMs: OVERHEAD_MS })
  const traced  = tests.filter((t) => trace.get(t.file)?.at).length
  const count   = (f: (c: Candidate) => boolean) => n(chosen.filter(f).length)

  out(opts.all ? `tests liés — --tout : les ${n(tests.length)} fichiers de test sont candidats` : `tests liés — ${changes.length} fichier(s) changé(s) : ${changes.slice(0, 6).map((c) => c.file + (c.state === 'modifié' ? '' : ` (${c.state})`)).join(', ')}${changes.length > 6 ? ', …' : ''}`)
  out(dir ? `relevé : ${n(traced)} fichiers de test relevés sur ${n(tests.length)} — ${dir}` : 'relevé : éteint (MJS_TEST_TRACE=0, ou copie dont node_modules est un lien) — tous les tests passent pour « sans relevé » ; posez MJS_TEST_TRACE=<dossier> pour l\'activer')
  if (opts.all) out(`choisis : ${n(chosen.length)} — ${count((c) => !c.traced)} sans relevé (joués d'abord), ${count((c) => c.traced)} déjà relevés`)
  else out(`choisis : ${n(chosen.length)} — ${count((c) => c.level === 0)} test(s) changé(s), ${count((c) => c.level === 1)} nommé(s) d'après un fichier du cœur, d'un effet ou du runtime, ${count((c) => c.level === 2)} qui le citent, ${count((c) => c.level === 3)} lien(s) direct(s), ${count((c) => c.level === 4)} lien(s) à distance, ${count((c) => c.level === 5)} sans lien connu ; dont ${count((c) => !c.traced)} sans relevé (signalés)`)
  if (stale) out(opts.build ? `dist/ périmé (${stale} plus récent que dist/cli.js) : reconstruit avant de jouer (--build)` : `dist/ périmé (${stale} plus récent que dist/cli.js) : ${blocked.length} test(s) de bin/mjs écartés — lancez \`npm run build:self\` ou ajoutez --build`)
  out(`plan : ${plan.lanes.filter((l) => l.length).length} voie(s), budget ${opts.budget} s, moteur(s) ${engines === 'tous' ? 'Chromium, Firefox et WebKit' : engines}${engines === 'tous' ? '' : ' (MJS_MOTEURS=tous pour les trois)'} — ${n(plan.played.length)} joué(s), ≈ ${s(Math.max(0, ...plan.loads) + OVERHEAD_MS)} par voie`)
  if (plan.notPlayed.length || blocked.length) out(`budget dépassé : ${n(plan.notPlayed.length + blocked.length)} non joué(s), coupés par la fin de l'ordre (priorité, puis un représentant par famille avant le deuxième) — la liste est écrite plus bas`)
  const warning = replayWarning(opts.budget, plan.played)
  if (warning) out(warning)

  const passRoot = dir ? join(dir, 'passes') : mkdtempSync(join(tmpdir(), 'tests-lies-'))
  const passDir  = dir ? join(passRoot, new Date(t0).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')) : passRoot
  mkdirSync(passDir, { recursive: true })
  writeFileSync(join(passDir, 'choisis.txt'), plan.played.map((c) => `${c.file}\t${c.why}\t${s(c.ms)}`).join('\n') + '\n')
  writeFileSync(join(passDir, 'non-joues.txt'), [...blocked.map((c) => `${c.file}\tdist/ périmé\t${c.why}`), ...plan.notPlayed.map((c) => `${c.file}\t${c.ms > plan.cap ? 'plus long qu\'une voie' : 'budget'}\t${c.why}\t${s(c.ms)}`)].join('\n') + '\n')
  if (dir) {
    const old = readdirSync(passRoot).filter((x) => /^\d{8}-\d{6}$/.test(x)).sort().slice(0, -PASSES_KEPT)
    for (const x of old) rmSync(join(passRoot, x), { recursive: true, force: true })
  }
  if (plan.notPlayed.length || blocked.length) out(`non joués : ${join(passDir, 'non-joues.txt')}`)
  if (opts.dryRun) {
    for (const c of plan.played.slice(0, 40)) out(`  ${c.file} — ${c.why} (≈ ${s(c.ms)})`)
    if (plan.played.length > 40) out(`  … ${n(plan.played.length - 40)} de plus : ${join(passDir, 'choisis.txt')}`)
    out('à blanc : rien n\'a été joué')
    return 0
  }
  if (!plan.played.length) {
    out('rien ne tient dans le budget : rien n\'a été joué')
    return plan.notPlayed.length ? 1 : 0
  }
  if (stale && opts.build) {
    const b = spawnSync('npm', ['run', 'build:self'], { cwd: ROOT, encoding: 'utf-8' })
    if (b.status !== 0) {
      out(`npm run build:self a échoué (code ${b.status}) :\n${b.stdout}${b.stderr}`)
      return 1
    }
  }

  const tmpBase = mkdtempSync(join(tmpdir().length <= 40 ? tmpdir() : '/tmp', 'tl-'))
  const runner  = realRunner({ root: ROOT, passDir, fragmentDir: dir ? join(dir, 'fragments') : passDir, tmpBase, env: { MJS_MOTEURS: engines, MJS_TEST_TRACE: dir ?? '0' } })
  let outcome: Outcome
  try {
    outcome = await executeRun(plan, { runner, mainDeadline: t0 + opts.budget * 1000 * MAIN_SHARE, endDeadline: t0 + opts.budget * 1000 - END_MARGIN_MS, overheadMs: OVERHEAD_MS, log: out })
  }
  finally {
    rmSync(tmpBase, { recursive: true, force: true })
  }
  if (dir) compactTrace(dir)

  const by       = (st: Status) => [...outcome.status].filter(([, v]) => v === st).map(([f]) => f)
  const red      = by('rouge')
  const unsure   = by('rouge non rejoué')
  const shaky    = by('instable')
  const cut      = [...by('interrompu'), ...by('voie tombée')]
  const skips    = Object.entries(outcome.skippedEngines).map(([k, v]) => `${k} ${v}`).join(', ')
  out(`bilan : ${n(by('vert').length)} vert(s), ${shaky.length} instable(s), ${red.length} rouge(s) confirmé(s), ${unsure.length} rouge(s) non rejoué(s), ${cut.length} non fini(s)${skips ? ` ; sautés pour moteur écarté : ${skips}` : ''}`)
  for (const f of shaky) out(`  instable (rouge sous charge, vert seul) : ${f}`)
  for (const f of [...red, ...unsure]) {
    const late = outcome.short.get(f)
    out(`  ${outcome.status.get(f)} : ${f}${late ? ` — plus le temps de le rejouer seul (il restait ${s(late.left)}, il en fallait ≈ ${s(late.need)}) : relancez-le, ou donnez un --budget plus grand` : ''}${outcome.failed.get(f)?.length ? ` — ${outcome.failed.get(f)!.slice(0, 3).join(' | ')}` : ''}`)
  }
  const cutList = join(passDir, 'non-finis.txt')
  if (cut.length) writeFileSync(cutList, cut.map((f) => `${f}\t${outcome.status.get(f)}`).join('\n') + '\n')
  for (const f of cut.slice(0, 5)) out(`  ${outcome.status.get(f)} : ${f}`)
  if (cut.length > 5) out(`  … ${n(cut.length - 5)} de plus : ${cutList}`)
  for (const r of outcome.laneFailures) out(`  voie en échec hors fichier (code ${r.code}) : ${r.log}`)
  out(`journaux : ${passDir}`)
  out(`durée : ${s(Date.now() - t0)}`)
  return red.length || unsure.length || outcome.laneFailures.length || by('voie tombée').length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
    console.error(`tests liés : ${e?.message ?? e}`)
    process.exitCode = 2
  })
}
