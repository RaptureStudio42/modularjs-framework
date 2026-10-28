// relevé des tests : pour chaque fichier de test, les fichiers du projet qu'il LIT pendant son passage — sources de
// src/ lues en fichier par le Bundler (runtime, modules du cœur, images), textes relus par les tests statiques,
// fixtures —, sa durée et ses rouges. Ces lectures sont invisibles au graphe des imports, que l'outil des tests liés
// (script/related-tests.ts) recalcule lui-même au moment du choix. Installé par le crochet commun (tmp-sweep.ts),
// le relevé écrit à chaque passage un fragment JSON dans <dossier du relevé>/fragments/ ; l'outil les fusionne
// Limites : une lecture faite par un sous-processus (bin/mjs, un mocha enfant) ou un worker n'est pas vue — le
// sous-processus est noté à part (`spawns`) ; une lecture mise en cache pour tout le processus n'est rendue qu'au
// premier fichier qui la provoque — la fusion fait l'union des passages, qui la rattrape

import fs from 'node:fs'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import Mocha from 'mocha'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// originaux gardés avant toute substitution : le relevé lit et écrit sans se relever lui-même
const real = { readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, mkdirSync: fs.mkdirSync, lstatSync: fs.lstatSync, readdirSync: fs.readdirSync, existsSync: fs.existsSync, rmSync: fs.rmSync }

// une entrée fusionnée du relevé : durée par réglage de moteurs (`tous`, `chromium`…), lectures cumulées
export type TraceEntry = { at: string, ms: Record<string, number>, reads: string[], dirs: string[], spawns: string[], tests: number, failures: number, pending: number, skippedEngines: Record<string, number> }

// une entrée d'un fragment, telle qu'un passage l'écrit
export type FragmentFile = { ms: number, done: boolean, tests: number, failures: number, pending: number, failed: string[], skippedEngines: Record<string, number>, reads: string[], dirs: string[], spawns: string[] }

// ----------------------------------------------------------------------------------------------------------------------
// OÙ VIT LE RELEVÉ
// ----------------------------------------------------------------------------------------------------------------------

// MJS_TEST_TRACE s'il est posé (« 0 » l'éteint), sinon node_modules/.cache/mjs-tests de l'arbre — sauf si
// node_modules est un lien : une copie de travail qui emprunte celui d'un autre arbre n'écrit jamais dans son cache
export function traceDir(root: string = ROOT, env: Record<string, string | undefined> = process.env): string | null {
  const v = env.MJS_TEST_TRACE
  if (v === '0') return null
  if (v) return resolve(v)
  try {
    if (real.lstatSync(join(root, 'node_modules')).isSymbolicLink()) return null
  }
  catch {
    return null
  }
  return join(root, 'node_modules', '.cache', 'mjs-tests')
}

// réglage des moteurs d'un passage, en clé : `tous`, ou les moteurs voulus triés (`chromium`, `firefox,webkit`)
export function enginesKey(value: string | undefined = process.env.MJS_MOTEURS): string {
  const words = (value ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (!words.length || words.includes('tous')) return 'tous'
  return [...new Set(words)].sort().join(',')
}

// ----------------------------------------------------------------------------------------------------------------------
// FUSION (côté outil)
// ----------------------------------------------------------------------------------------------------------------------

const TEST_KEY = /^tests\/.+\.test\.ts$/
const union    = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])].sort()

// un fragment entre au relevé : lectures en union (une lecture vue une fois reste — sur-approximation sûre), durée
// et comptes du dernier passage COMPLET du fichier ; un passage filtré (--grep) ou coupé ne donne que ses lectures
export function mergeFragment(store: Map<string, TraceEntry>, fragment: any): void {
  for (const [file, f] of Object.entries<FragmentFile>(fragment?.files ?? {})) {
    if (!TEST_KEY.test(file)) continue
    const old   = store.get(file)
    const entry = { at: old?.at ?? '', ms: { ...old?.ms }, reads: union(old?.reads, f.reads), dirs: union(old?.dirs, f.dirs), spawns: union(old?.spawns, f.spawns), tests: old?.tests ?? 0, failures: old?.failures ?? 0, pending: old?.pending ?? 0, skippedEngines: old?.skippedEngines ?? {} }
    if (f.done && !fragment.partial) {
      entry.ms[fragment.engines ?? 'tous'] = f.ms
      entry.at             = fragment.end ?? ''
      entry.tests          = f.tests
      entry.failures       = f.failures
      entry.pending        = f.pending
      entry.skippedEngines = f.skippedEngines ?? {}
    }
    store.set(file, entry)
  }
}

// lit le relevé fusionné, y verse les fragments (du plus ancien au plus récent), le réécrit, puis retire les fragments
// versés. Un fragment illisible (en cours d'écriture) reste pour la fois suivante ; un fragment versé deux fois ne
// change rien (union, dernière durée)
export function compactTrace(dir: string): Map<string, TraceEntry> {
  const store = new Map<string, TraceEntry>()
  const main  = join(dir, 'releve.json')
  try {
    for (const [file, e] of Object.entries<TraceEntry>(JSON.parse(String(real.readFileSync(main, 'utf-8'))).files ?? {})) store.set(file, e)
  }
  catch { /* pas encore de relevé */ }
  const fragDir   = join(dir, 'fragments')
  const fragments = [] as Array<{ name: string, data: any }>
  let names: string[] = []
  try { names = real.readdirSync(fragDir).filter((n) => n.endsWith('.json')) } catch { /* aucun fragment */ }
  for (const name of names) {
    try { fragments.push({ name, data: JSON.parse(String(real.readFileSync(join(fragDir, name), 'utf-8'))) }) } catch { /* illisible : laissé */ }
  }
  fragments.sort((a, b) => String(a.data.end ?? '').localeCompare(String(b.data.end ?? '')))
  for (const f of fragments) mergeFragment(store, f.data)
  if (fragments.length) {
    writeAtomic(main, JSON.stringify({ version: 1, files: Object.fromEntries([...store].sort((a, b) => a[0].localeCompare(b[0]))) }))
    for (const f of fragments) {
      try { real.rmSync(join(fragDir, f.name), { force: true }) } catch { /* rien */ }
    }
  }
  return store
}

function writeAtomic(path: string, text: string): void {
  real.mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}-${randomBytes(3).toString('hex')}.tmp`
  real.writeFileSync(tmp, text)
  real.renameSync(tmp, path)
}

// ----------------------------------------------------------------------------------------------------------------------
// RELEVÉ PENDANT LE PASSAGE (côté crochet)
// ----------------------------------------------------------------------------------------------------------------------

type Live = { ms: number, done: boolean, tests: number, failures: number, pending: number, failed: string[], skippedEngines: Record<string, number>, reads: Set<string>, dirs: Set<string>, spawns: Set<string> }

const ROOT_SEP = ROOT + sep
const IGNORED  = /^(node_modules|\.git)(\/|$)/
const live     = new Map<string, Live>()
let current: any
let loading: string | undefined
let lastFile: string | undefined
let target: string | null = null
let started    = ''
let lastFlush  = 0

// fichier d'un test ou d'un crochet ; un crochet racine `before all` / `after all` (balai, écriture du relevé) n'est à personne
const fileOf = (r: any): string | undefined => r?.type === 'hook' && r.parent?.root && /^"(before|after) all" hook/.test(r.title ?? '') ? undefined : r?.file ?? r?.ctx?.currentTest?.file

// le test ou le crochet en cours, et le fichier auquel une lecture se rattache (celui qu'on charge, ou celui qui joue)
export const currentRunnable = (): any => current
export const currentTestFile = (): string | undefined => loading ?? fileOf(current)

function entry(file: string): Live {
  let t = live.get(file)
  if (!t) live.set(file, t = { ms: 0, done: false, tests: 0, failures: 0, pending: 0, failed: [], skippedEngines: {}, reads: new Set(), dirs: new Set(), spawns: new Set() })
  return t
}

function relativeOf(p: unknown, cwd?: string): string | null {
  let abs = ''
  if (typeof p === 'string') abs = resolve(cwd ?? '.', p)
  else if (p instanceof URL) abs = p.protocol === 'file:' ? fileURLToPath(p) : ''
  else if (Buffer.isBuffer(p)) abs = resolve(p.toString())
  if (!abs.startsWith(ROOT_SEP)) return null
  const rel = abs.slice(ROOT_SEP.length).split(sep).join('/')
  return rel && !IGNORED.test(rel) ? rel : null
}

function track(p: unknown, kind: 'reads' | 'dirs'): void {
  const file = currentTestFile()
  if (!file) return
  const rel = relativeOf(p)
  if (rel) entry(file)[kind].add(rel)
}

// un sous-processus qui exécute du code du projet (bin/mjs, un script de src/, un mocha enfant) : ses lectures
// échappent au relevé, on note ce qu'il lance
function trackSpawn(args: any[]): void {
  const file = currentTestFile()
  if (!file) return
  const cwd   = args.find((a) => a && typeof a === 'object' && !Array.isArray(a) && typeof a.cwd === 'string')?.cwd
  const words = [] as string[]
  for (const a of args) {
    if (typeof a === 'string') words.push(...a.split(/\s+/))
    else if (Array.isArray(a)) words.push(...a.filter((w) => typeof w === 'string'))
  }
  for (const w of words) {
    const rel = relativeOf(w.replace(/^['"]|['"]$/g, ''), cwd)
    if (rel && real.existsSync(join(ROOT, rel))) entry(file).spawns.add(rel)
  }
}

function wrap(obj: any, name: string, note: (args: any[]) => void): void {
  const original = obj?.[name]
  if (typeof original !== 'function' || original.__mjsTrace) return
  const wrapped: any = function (this: any, ...args: any[]) {
    note(args)
    return original.apply(this, args)
  }
  const own = Object.getOwnPropertyDescriptors(original) as any
  delete own[promisify.custom]                                                   //non configurable chez l'original : reposé plus bas
  Object.defineProperties(wrapped, own)
  const custom = original[promisify.custom]
  if (typeof custom === 'function') Object.defineProperty(wrapped, promisify.custom, { value: (...args: any[]) => { note(args); return custom(...args) }, configurable: true })
  wrapped.__mjsTrace = true
  obj[name] = wrapped
}

// écrit le fragment de ce passage (renommage atomique) ; `final` clôt le dernier fichier
export function flushTestTrace(final = false): void {
  if (!target || !live.size) return
  if (final) for (const t of live.values()) t.done = true                       //fin normale du passage : chaque fichier chargé a été joué
  const files = {} as Record<string, FragmentFile>
  for (const [file, t] of live) {
    const key  = file.startsWith(ROOT_SEP) ? file.slice(ROOT_SEP.length).split(sep).join('/') : file
    files[key] = { ms: Math.round(t.ms), done: t.done, tests: t.tests, failures: t.failures, pending: t.pending, failed: t.failed, skippedEngines: t.skippedEngines, reads: [...t.reads].sort(), dirs: [...t.dirs].sort(), spawns: [...t.spawns].sort() }
  }
  const partial = process.argv.some((a) => /^(--grep|-g|--fgrep|-f|--invert|-i)(=|$)/.test(a))
  try {
    writeAtomic(target, JSON.stringify({ version: 1, root: ROOT, engines: enginesKey(), partial, start: started, end: new Date().toISOString(), files }))
  }
  catch (e: any) {
    if (final) console.log(`relevé des tests : fragment non écrit (${e?.message ?? e})`)
  }
  lastFlush = Date.now()
}

// un saut décidé par le filtre des moteurs, compté au fichier du test ou du crochet sauté
export function noteEngineSkip(runnable: any, engine: string): void {
  const file = fileOf(runnable)
  if (!file) return
  const t = entry(file)
  t.skippedEngines[engine] = (t.skippedEngines[engine] ?? 0) + 1
}

// passage d'un fichier au suivant : le précédent est fini ; fragment réécrit au plus toutes les 2 s
function enter(file: string): void {
  if (file === lastFile) return
  if (lastFile) entry(lastFile).done = true
  lastFile = file
  if (Date.now() - lastFlush > 2000) flushTestTrace()
}

let installed = false

// pose le relevé : lectures de node:fs (et node:fs/promises), sous-processus, durées et rouges par fichier, en suivant le
// test ou le crochet que mocha joue. MJS_TEST_TRACE_FILE (posé par l'outil pour une voie) fixe le fragment, retiré de
// l'environnement pour qu'un mocha enfant ne l'écrase pas. Relevé éteint : seul le suivi du test en cours reste (le
// filtre des moteurs s'en sert)
export function installTestTrace(env: Record<string, string | undefined> = process.env): void {
  if (installed) return
  installed = true
  const file = env.MJS_TEST_TRACE_FILE
  delete env.MJS_TEST_TRACE_FILE
  const dir  = traceDir(ROOT, env)
  target     = file ? resolve(file) : dir ? join(dir, 'fragments', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomBytes(3).toString('hex')}.json`) : null
  started    = new Date().toISOString()
  followMocha()
  if (target) traceReads()
}

const follow = (runnable: any) => { current = runnable }

function followMocha(): void {
  const M: any = Mocha
  const run    = M.Runnable.prototype.run
  M.Runnable.prototype.run = function (this: any, fn: (err?: unknown) => void) {
    const file  = fileOf(this)
    const start = performance.now()
    if (file) enter(file)
    follow(this)
    return run.call(this, (...args: any[]) => {
      if (current === this) follow(undefined)
      if (file) entry(file).ms += performance.now() - start
      return (fn as any)(...args)
    })
  }
  // tests comptés à leur fin : un test sauté avec sa suite (crochet `before` sauté) ne passe jamais par run()
  const runnerRun = M.Runner.prototype.run
  M.Runner.prototype.run = function (this: any, ...args: any[]) {
    this.on('test end', (test: any) => {
      const file = fileOf(test)
      if (!file) return
      const t = entry(file)
      t.tests++
      if (test.isPending?.()) t.pending++
    })
    return runnerRun.apply(this, args)
  }
  const fail = M.Runner.prototype.fail
  M.Runner.prototype.fail = function (this: any, test: any, err: unknown, force?: boolean) {
    const before = this.failures
    const out    = fail.call(this, test, err, force)
    const file   = fileOf(test) ?? lastFile
    if (this.failures > before && file) {
      const t = entry(file)
      t.failures++
      if (t.failed.length < 20) t.failed.push(typeof test?.fullTitle === 'function' ? test.fullTitle() : String(test?.title ?? ''))
    }
    return out
  }
  const load = M.prototype.loadFilesAsync
  if (typeof load === 'function') {
    M.prototype.loadFilesAsync = function (this: any, ...args: any[]) {
      this.suite.on('pre-require', (_ctx: unknown, f: string) => {
        loading = f
        entry(f)                                                                  //un fichier sans test joué (tout sauté) a sa ligne aussi
      })
      this.suite.on('post-require', () => { loading = undefined })
      return load.apply(this, args)
    }
  }
}

function traceReads(): void {
  const promises: any = fs.promises
  const first         = (args: any[]) => args[0]
  for (const name of ['readFileSync', 'readFile', 'existsSync', 'statSync', 'openSync', 'createReadStream', 'copyFileSync', 'cpSync']) wrap(fs, name, (a) => track(first(a), 'reads'))
  for (const name of ['readdirSync', 'readdir', 'opendirSync']) wrap(fs, name, (a) => track(first(a), 'dirs'))
  for (const name of ['readFile', 'stat', 'open', 'copyFile', 'cp']) wrap(promises, name, (a) => track(first(a), 'reads'))
  for (const name of ['readdir', 'opendir']) wrap(promises, name, (a) => track(first(a), 'dirs'))
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync']) wrap(childProcess, name, trackSpawn)
  syncBuiltinESMExports()
}
