// MOTEURS ENSEMBLE — les suites sœurs d'une boucle sur les moteurs jouées EN MÊME TEMPS au lieu de l'une après l'autre :
//   for (const nom of ['chromium', 'firefox', 'webkit'] as const) playTogether(describe(nom, function () { … }))
// chaque suite se déroule de son côté comme mocha la déroulerait : ses crochets `before`, puis pour chaque test ses
// `beforeEach` (de la suite du moteur jusqu'à celle du test), le test, ses `afterEach` en remontant, puis ses `describe`
// imbriqués avec leurs `before` et leurs `after` ; un crochet en échec ou sauté arrête ce que mocha arrête. Chacun garde
// ses délais (`this.timeout`) et ses sauts (`this.skip`) ; mocha rend ensuite chaque verdict à sa place, sous le nom de
// son moteur, comme avant. Le `after` d'une suite de moteur attend la fin des autres : un `terminateSharedWorkerPool()`
// ne coupe plus un moteur en route.
// Sont sœurs les suites d'un même describe parent et d'un même fichier dont le titre ne diffère que par le nom du
// moteur : `for (const nom of MOTEURS) for (const env of ENVS) playTogether(describe(`${nom}, ${env}`, …))` joue ses trois
// moteurs ensemble, un `env` après l'autre.
// L'ordre d'avant revient quand un seul moteur se lance (MJS_MOTEURS), avec `--grep`, ou MJS_ENSEMBLE=0 ; une suite que
// l'ensemble ne sait pas jouer (test ou crochet à `done`, test repris par `retries`, `beforeEach` ou `afterEach` d'un
// describe au-dessus des suites de moteur) est refusée. Les crochets de la racine (ceux de `--require` : balai, comptes)
// restent à mocha, autour du relais de chaque test.
// Limite : une exception levée hors de toute promesse (minuterie, écouteur) est rendue par mocha au test qu'il attend à
// ce moment, celui de la suite en cours, pas forcément au moteur qui l'a levée

import { readFileSync } from 'node:fs'
import Mocha from 'mocha'
import { ENGINES, parseEngines, declaredEngines } from './engine-filter.js'

type Outcome = { err?: unknown, pending?: boolean, played: boolean }
type Kind    = 'before' | 'beforeEach' | 'test' | 'afterEach' | 'after'

const GREP = process.argv.some((a) => /^(--grep|-g|--fgrep|-f|--invert|-i)(=|$)/.test(a))
const OWN  = new Set<string | symbol>(['currentTest', 'test', '_runnable'])

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

// le titre sans le nom de son moteur : les suites sœurs le partagent
function sisterKey(title: string): string {
  const name = ENGINES.find((e) => new RegExp(`\\b${e}\\b`).test(title))
  return name ? title.replace(new RegExp(`\\b${name}\\b`), '\u0000') : title
}

// la suite et ses describe imbriqués, dans l'ordre de mocha
function subtree(suite: any): any[] {
  return [suite, ...suite.suites.flatMap(subtree)]
}

const runnables = (s: any): [any[], Kind][] => [[s._beforeAll, 'before'], [s._beforeEach, 'beforeEach'], [s.tests, 'test'], [s._afterEach, 'afterEach'], [s._afterAll, 'after']]

// ce que l'ensemble ne sait pas jouer ; la racine (crochets de `--require`) reste à mocha
function refusal(suite: any): string {
  for (let p = suite.parent; p && !p.root; p = p.parent) {
    if (p._beforeEach?.length) return 'un beforeEach au-dessus d\'elle'
    if (p._afterEach?.length) return 'un afterEach au-dessus d\'elle'
  }
  const all = subtree(suite).flatMap((s) => runnables(s).flatMap(([list]) => list))
  if (all.some((r: any) => r.fn && r.fn.length > 0)) return 'un test ou un crochet à done'
  if (all.some((r: any) => typeof r.retries === 'function' && r.retries() > 0)) return 'un test repris (retries)'
  return ''
}

// le contexte d'une copie : celui de sa suite, sauf le crochet ou le test en cours (`this.currentTest`, `this.skip()`,
// `this.timeout()`), qui restent à la copie pendant que mocha rejoue l'original sur le même contexte
function ownContext(ctx: any, currentTest: any): any {
  const mine: Record<string | symbol, unknown> = { currentTest }
  return new Proxy(ctx, {
    get: (target, key, receiver) => (OWN.has(key) ? mine[key] : Reflect.get(target, key, receiver)),
    set: (target, key, value) => {
      if (OWN.has(key)) mine[key] = value
      else target[key] = value
      return true
    },
  })
}

// la copie d'un test ou d'un crochet, jouée comme mocha la jouerait (contexte de sa suite, délai, saut) : l'original reste
// à mocha, qui rendra le verdict à sa place
function copyOf(runnable: any, fn: Function, timeout: number, currentTest?: any): any {
  const copy: any = runnable.type === 'test' ? new (Mocha as any).Test(runnable.title, fn) : new (Mocha as any).Runnable(runnable.title, fn)
  copy.parent     = runnable.parent
  copy.ctx        = ownContext(runnable.ctx, currentTest)
  copy.file       = runnable.file
  copy.timeout(timeout)
  return copy
}

function play(copy: any): Promise<Outcome> {
  return new Promise((resolve) => copy.run((err?: unknown) => resolve({ err, pending: copy.pending, played: true })))
}

class EngineGroup {
  done?: Promise<unknown>
  previous?: EngineGroup
  suites: any[]   = []
  together: any[] = []
  originals       = new Map<any, Function>()
  timeouts        = new Map<any, number>()
  engineOf        = new Map<any, any>()
  outcomes        = new Map<any, Map<any, Deferred>>()
  skipped         = new Set<any>()
  finished        = new Set<any>()
  decided         = false

  add(suite: any): void {
    const refus = refusal(suite)
    if (refus) throw new Error(`playTogether : la suite « ${suite.title} » a ${refus}, que les moteurs ne savent pas jouer ensemble — gardez pour elle la boucle l'un après l'autre`)
    this.suites.push(suite)
    for (const s of subtree(suite)) {
      for (const [list, kind] of runnables(s)) {
        for (const r of list) {
          if (!r.fn) continue
          this.originals.set(r, r.fn)
          this.timeouts.set(r, r.timeout())
          this.engineOf.set(r, suite)
          wrap(this, suite, s, r, kind)
        }
      }
    }
  }

  // une fois, au premier crochet ou test joué : les suites jouées ensemble ; les autres retrouvent leurs fonctions. Un
  // beforeEach ou un afterEach posé au-dessus après la boucle se voit ici : refusé tout haut à chaque relais
  decide(): any[] {
    if (this.decided) return this.together
    for (const s of this.suites) {
      const refus = refusal(s)
      if (refus) throw new Error(`playTogether : la suite « ${s.title} » a ${refus}, que les moteurs ne savent pas jouer ensemble — gardez pour elle la boucle l'un après l'autre`)
    }
    this.decided  = true
    this.together = this.suites.filter((s) => !s.isPending() && launches(s))
    if (process.env.MJS_ENSEMBLE === '0' || GREP || this.together.length < 2) this.together = []
    for (const [r, fn] of this.originals) if (!this.together.includes(this.engineOf.get(r))) r.fn = fn
    return this.together
  }

  // les suites jouées ensemble partent toutes au premier appel venu de l'une d'elles, après celles du groupe d'avant
  begin(): void {
    if (this.done) return
    const previous = this.previous?.done ?? Promise.resolve()
    this.done = previous.then(() => {}, () => {}).then(() => Promise.all(this.together.map((s) => this.chain(s))))
  }

  // l'issue d'un crochet ou d'un test (pour un crochet de chaque test : celle du test nommé), attendue par le relais ;
  // une issue que le moteur, fini, n'a pas rendue revient « pas jouée »
  outcome(runnable: any, test: any = null): Deferred {
    let byTest = this.outcomes.get(runnable)
    if (!byTest) this.outcomes.set(runnable, byTest = new Map())
    let d = byTest.get(test)
    if (!d) {
      byTest.set(test, d = new Deferred())
      if (this.finished.has(this.engineOf.get(runnable))) d.resolve({ played: false })
    }
    return d
  }

  pending(x: any): boolean {
    for (let s = x; s; s = s.parent) if (s.pending || this.skipped.has(s)) return true
    return false
  }

  // une suite de moteur de son côté ; son propre `after` reste à mocha, qui le joue après les autres moteurs
  async chain(engine: any): Promise<void> {
    try {
      await this.suite(engine, engine)
    }
    finally {
      this.finished.add(engine)
      for (const [r, byTest] of this.outcomes) if (this.engineOf.get(r) === engine) for (const d of byTest.values()) d.resolve({ played: false })
    }
  }

  // un crochet joué et son issue rendue ; celui d'une suite sautée ne se joue pas, comme chez mocha
  async hook(hook: any, current: any, test: any = null): Promise<Outcome> {
    if (this.pending(hook) || !this.originals.has(hook)) return { played: false }
    const o = await play(copyOf(hook, this.originals.get(hook)!, this.timeouts.get(hook)!, current))
    this.outcome(hook, test).resolve(o)
    return o
  }

  // runSuite de mocha : ses `before` (un saut saute ses tests et ses describe), ses tests, ses describe tant qu'aucun
  // crochet de chaque test n'a échoué, ses `after` ; rend la suite d'un tel échec quand il remonte au-dessus d'elle
  async suite(engine: any, s: any): Promise<any> {
    if (!s.total()) return undefined
    let failed = false
    let errSuite: any
    for (const hook of s._beforeAll) {
      const o = await this.hook(hook, s.tests[0])
      if (o.pending) {
        for (const x of [...s.tests, ...s.suites]) this.skipped.add(x)
        break
      }
      if (o.err) {
        failed = true
        break
      }
    }
    if (!failed) {
      errSuite = await this.tests(engine, s)
      for (let i = 0; !errSuite && i < s.suites.length; i++) errSuite = await this.suite(engine, s.suites[i])
    }
    if (s !== engine) {
      for (const hook of s._afterAll) {
        const o = await this.hook(hook, s.tests[s.tests.length - 1])
        if (o.err || o.pending) break
      }
    }
    return errSuite === s ? undefined : errSuite
  }

  // runTests de mocha : pour chaque test, ses `beforeEach` du moteur jusqu'à sa suite, le test, ses `afterEach` en
  // remontant ; un `beforeEach` en échec, ou un `afterEach`, arrête les tests de la suite du crochet
  async tests(engine: any, s: any): Promise<any> {
    for (const test of s.tests) {
      if (this.pending(test)) continue
      const stand = copyOf(test, this.originals.get(test) ?? (() => {}), this.timeouts.get(test) ?? test.timeout())
      let from = s
      let skip = false
      let errSuite: any
      for (const x of subtreePath(engine, s)) {
        for (const hook of x._beforeEach) {
          const o = await this.hook(hook, stand, test)
          if (o.pending) skip = true
          if (o.pending || o.err) {
            errSuite = x
            break
          }
        }
        if (errSuite) break
      }
      if (errSuite && !skip) {
        const up = await this.afterEach(engine, errSuite, stand, test)
        return up ? await this.afterEachFailed(engine, up, stand, test) : errSuite
      }
      if (skip) {
        from        = errSuite
        stand.state = 'pending'
      }
      else {
        const o = await play(stand)
        stand.state = o.pending ? 'pending' : o.err ? 'failed' : 'passed'
        if (o.err) stand.err = o.err
        this.outcome(test).resolve(o)
      }
      const up = await this.afterEach(engine, from, stand, test)
      if (up) return await this.afterEachFailed(engine, up, stand, test)
    }
    return undefined
  }

  // les `afterEach` de la suite `from` jusqu'à celle du moteur ; rend la suite du premier en échec
  async afterEach(engine: any, from: any, stand: any, test: any): Promise<any> {
    for (let x = from; x; x = x === engine ? null : x.parent) {
      for (const hook of x._afterEach) {
        const o = await this.hook(hook, stand, test)
        if (o.err) return x
      }
    }
    return undefined
  }

  // un `afterEach` en échec : mocha joue encore ceux des suites au-dessus de la sienne, puis arrête la suite du dernier
  async afterEachFailed(engine: any, x: any, stand: any, test: any): Promise<any> {
    for (;;) {
      if (x === engine) return x
      const up = await this.afterEach(engine, x.parent, stand, test)
      if (!up) return x
      x = up
    }
  }
}

// les suites de celle du moteur jusqu'à `s`, de haut en bas
function subtreePath(engine: any, s: any): any[] {
  const path = [s]
  while (path[0] !== engine) path.unshift(path[0].parent)
  return path
}

// la fonction d'un test ou d'un crochet remplacée par son relais : joué avec les autres suites, son verdict rendu à sa place
function wrap(group: EngineGroup, engine: any, suite: any, runnable: any, kind: Kind): void {
  const original = group.originals.get(runnable)
  if (!original) return
  runnable.fn = async function (this: any) {
    if (!group.decide().includes(engine)) return original.call(this)
    const test = kind === 'beforeEach' || kind === 'afterEach' ? this.currentTest : null   //posé par mocha à l'instant
    group.begin()
    runnable.timeout(0)                                                                   //le délai d'origine tient sur la copie jouée
    const last = suite.tests[suite.tests.length - 1]
    const o    = kind === 'after' && suite === engine ? await group.done!.then(() => play(copyOf(runnable, original, group.timeouts.get(runnable)!, last))) : await group.outcome(runnable, test).promise
    if (!o.played) throw new Error(`playTogether : ${kind === 'test' ? 'ce test' : 'ce crochet'} n'a pas été joué avec les autres moteurs`)
    if (o.pending) runnable.skip()
    if (o.err) throw o.err
  }
}

const groups = new WeakMap<object, Map<string, EngineGroup>>()
const lastOf = new WeakMap<object, Map<string, EngineGroup>>()

// la suite rendue par `describe(…)`, rangée avec ses sœurs du même describe parent et du même fichier
export function playTogether<T>(suite: T): T {
  const s: any = suite
  if (!s || !Array.isArray(s.tests) || !s.parent) throw new Error('playTogether : attendu la suite rendue par describe(…)')
  let byKey = groups.get(s.parent)
  if (!byKey) groups.set(s.parent, byKey = new Map())
  let last = lastOf.get(s.parent)
  if (!last) lastOf.set(s.parent, last = new Map())
  const key = `${s.file}\u0000${sisterKey(s.title)}`
  let group = byKey.get(key)
  if (!group) {
    byKey.set(key, group = new EngineGroup())
    group.previous = last.get(s.file)
    last.set(s.file, group)
  }
  group.add(s)
  return suite
}
