// MOTEURS ENSEMBLE — les suites sœurs d'une boucle sur les moteurs jouées EN MÊME TEMPS au lieu de l'une après l'autre :
//   for (const nom of ['chromium', 'firefox', 'webkit'] as const) playTogether(describe(nom, function () { … }))
// chaque suite déroule ses crochets `before` puis ses tests dans son ordre, de son côté, avec ses délais (`this.timeout`),
// ses sauts (`this.skip`) et son `before` en échec ; mocha rend ensuite chaque verdict à sa place, sous le nom de son
// moteur, comme avant. Le `after` d'une suite attend la fin des autres : un `terminateSharedWorkerPool()` ne coupe plus
// un moteur en route.
// L'ordre d'avant revient quand un seul moteur se lance (MJS_MOTEURS), avec `--grep`, ou MJS_ENSEMBLE=0 ; une suite que
// l'ensemble ne sait pas jouer (`beforeEach`, `afterEach`, `describe` imbriqué, test à `done`) est refusée au chargement.
// Limite : une exception levée hors de toute promesse (minuterie, écouteur) est rendue par mocha au test qu'il attend à
// ce moment, celui de la suite en cours, pas forcément au moteur qui l'a levée

import { readFileSync } from 'node:fs'
import Mocha from 'mocha'
import { ENGINES, parseEngines, declaredEngines } from './engine-filter.js'

type Outcome = { err?: unknown, pending?: boolean, played: boolean }

const GREP = process.argv.some((a) => /^(--grep|-g|--fgrep|-f|--invert|-i)(=|$)/.test(a))

// une issue attendue et de quoi la rendre
class Deferred {
  promise: Promise<Outcome>
  resolve!: (o: Outcome) => void
  constructor() { this.promise = new Promise((r) => { this.resolve = r }) }
}

// le moteur nommé par le titre de la suite se lance-t-il ? (même règle que le filtre des moteurs ; sans nom lisible, non)
function launches(suite: any): boolean {
  const wanted = parseEngines(process.env.MJS_MOTEURS)
  if (!wanted) return true
  const name = ENGINES.find((e) => new RegExp(`\\b${e}\\b`).test(suite.title))
  let declared: Set<string> | null | undefined
  try { declared = declaredEngines(readFileSync(suite.file, 'utf-8')) } catch { declared = undefined }
  return !!name && (wanted.has(name) || declared === null || !!declared?.has(name))
}

// joue une fonction de test ou de crochet comme mocha la jouerait (contexte de sa suite, délai, saut), sur une copie :
// le test ou le crochet d'origine reste à mocha, qui rendra le verdict à sa place
function play(runnable: any, fn: Function, timeout: number): Promise<Outcome> {
  const copy: any = new (Mocha as any).Runnable(runnable.title, fn)
  copy.parent     = runnable.parent
  copy.ctx        = runnable.ctx
  copy.file       = runnable.file
  copy.timeout(timeout)
  return new Promise((resolve) => copy.run((err?: unknown) => resolve({ err, pending: copy.pending, played: true })))
}

class EngineGroup {
  done?: Promise<unknown>
  suites: any[]   = []
  together: any[] = []
  originals       = new Map<any, Function>()
  timeouts        = new Map<any, number>()
  outcomes        = new Map<any, Deferred>()
  decided         = false

  add(suite: any): void {
    const all   = [...suite._beforeAll, ...suite.tests, ...suite._afterAll]
    const refus = suite.suites.length ? 'un describe imbriqué' : suite._beforeEach.length ? 'un beforeEach' : suite._afterEach.length ? 'un afterEach' : all.some((r: any) => r.fn && r.fn.length > 0) ? 'un test ou un crochet à done' : ''
    if (refus) throw new Error(`playTogether : la suite « ${suite.title} » a ${refus}, que les moteurs ne savent pas jouer ensemble — gardez pour elle la boucle l'un après l'autre`)
    this.suites.push(suite)
    for (const r of all) {
      if (!r.fn) continue
      this.originals.set(r, r.fn)
      this.timeouts.set(r, r.timeout())
    }
    for (const hook of suite._beforeAll) wrap(this, suite, hook, 'before')
    for (const test of suite.tests) wrap(this, suite, test, 'test')
    for (const hook of suite._afterAll) wrap(this, suite, hook, 'after')
  }

  // une fois, au premier crochet ou test joué : les suites jouées ensemble ; les autres retrouvent leurs fonctions
  decide(): any[] {
    if (this.decided) return this.together
    this.decided  = true
    this.together = this.suites.filter((s) => !s.isPending() && launches(s))
    if (process.env.MJS_ENSEMBLE === '0' || GREP || this.together.length < 2) this.together = []
    for (const s of this.suites) {
      if (this.together.includes(s)) continue
      for (const r of [...s._beforeAll, ...s.tests, ...s._afterAll]) if (this.originals.has(r)) r.fn = this.originals.get(r)
    }
    return this.together
  }

  // les suites jouées ensemble partent toutes au premier appel venu de l'une d'elles
  begin(): void {
    if (this.done) return
    for (const s of this.together) for (const r of [...s._beforeAll, ...s.tests]) this.outcomes.set(r, new Deferred())
    this.done = Promise.all(this.together.map((s) => this.chain(s)))
  }

  // une suite de son côté : ses `before` dans l'ordre, puis ses tests ; un `before` en échec ou sauté arrête la suite, comme mocha
  async chain(suite: any): Promise<void> {
    let stop = false
    for (const hook of suite._beforeAll) {
      const o: Outcome = stop || !this.originals.has(hook) ? { played: false } : await play(hook, this.originals.get(hook)!, this.timeouts.get(hook)!)
      this.outcomes.get(hook)!.resolve(o)
      if (o.err || o.pending) stop = true
    }
    for (const test of suite.tests) {
      const o: Outcome = stop || test.isPending() || !this.originals.has(test) ? { played: false } : await play(test, this.originals.get(test)!, this.timeouts.get(test)!)
      this.outcomes.get(test)!.resolve(o)
    }
  }
}

// la fonction d'un test ou d'un crochet remplacée par son relais : joué avec les autres suites, son verdict rendu à sa place
function wrap(group: EngineGroup, suite: any, runnable: any, kind: 'before' | 'test' | 'after'): void {
  const original = group.originals.get(runnable)
  if (!original) return
  runnable.fn = async function (this: any) {
    if (!group.decide().includes(suite)) return original.call(this)
    group.begin()
    runnable.timeout(0)                                                         //le délai d'origine tient sur la copie jouée
    const o = kind === 'after' ? await group.done!.then(() => play(runnable, original, group.timeouts.get(runnable)!)) : await group.outcomes.get(runnable)!.promise
    if (!o.played) {
      if (kind === 'test') throw new Error('playTogether : ce test n\'a pas été joué avec les autres moteurs')
      return
    }
    if (o.pending) runnable.skip()
    if (o.err) throw o.err
  }
}

const groups = new WeakMap<object, Map<string, EngineGroup>>()

// la suite rendue par `describe(…)`, rangée avec ses sœurs du même describe parent et du même fichier
export function playTogether<T>(suite: T): T {
  const s: any = suite
  if (!s || !Array.isArray(s.tests) || !s.parent) throw new Error('playTogether : attendu la suite rendue par describe(…)')
  let byFile = groups.get(s.parent)
  if (!byFile) groups.set(s.parent, byFile = new Map())
  let group = byFile.get(s.file)
  if (!group) byFile.set(s.file, group = new EngineGroup())
  group.add(s)
  return suite
}
