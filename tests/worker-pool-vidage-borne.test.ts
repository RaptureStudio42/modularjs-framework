// Ce que ce test garantit : `WorkerPool.flush()` attend un temps borné — le délai des tâches du pool (`timeoutMs`), pas un de plus à
// régler. Un worker en vie qui, ses tâches rendues, ne lit plus ses messages n'écrira jamais sa marque : au délai il est arrêté et
// remplacé, une ligne le dit, et le vidage rend la main avec ce qui est arrivé. Un worker qui travaille n'est pas muet : le délai de
// sa tâche le juge, jamais celui du vidage.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { WorkerPool } from '../src/bundler/worker-pool.js'

// un worker d'essai : la marque au message `flush` ; à chaque tâche l'accusé, `work` ms de calcul sans lire ses messages, la réponse,
// puis — `stuck` — une boucle sans fin : sa tâche est rendue, il est libre aux yeux du pool, il ne lit plus rien
function script(): string {
  const file = join(mjsTmp('pool-vidage-borne'), 'worker.cjs')
  writeFileSync(file, [
    'const { parentPort } = require(\'node:worker_threads\')',
    'parentPort.on(\'message\', (msg) => {',
    '  if (msg.type === \'flush\') { process.stdout.write(msg.mark); process.stderr.write(msg.mark); return }',
    '  parentPort.postMessage({ id: msg.id, started: true })',
    '  if (msg.work) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, msg.work)',
    '  parentPort.postMessage({ id: msg.id, ok: true, result: msg.n })',
    '  if (msg.stuck) setImmediate(() => { for (;;) {} })',
    '})'
  ].join('\n') + '\n')
  return file
}

// horloge factice : une minuterie du pool ne sonne que quand le test le dit
function fakeClock() {
  let next     = 1
  const timers = new Map<number, { ms: number, fn: () => void }>()
  return {
    timers,
    setTimeout(fn: () => void, ms: number): number {
      const id = next++
      timers.set(id, { ms, fn })
      return id
    },
    clearTimeout(id: unknown): void {
      timers.delete(id as number)
    },
    // fait sonner celles de `ids` qui sont encore armées
    ring(ids: number[]): void {
      for (const id of ids) {
        const timer = timers.get(id)
        if (!timer) continue
        timers.delete(id)
        timer.fn()
      }
    }
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// `promise` est-elle rendue dans les `ms` millisecondes ?
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms) })
  try {
    return await Promise.race([promise.then(() => true), late])
  }
  finally {
    clearTimeout(timer)
  }
}

// attend que `cond` soit vraie, 10 s au plus
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await pause(20)
  assert.ok(cond(), `attendu : ${what}`)
}

describe('bundler/worker-pool — flush : une attente bornée par le délai des tâches', function () {
  this.timeout(60000)

  it('un worker qui, sa tâche rendue, ne lit plus ses messages ne fait pas attendre le vidage sans fin ; le pool sert encore', async () => {
    const pool = new WorkerPool(2, { workerPath: script() }, { timeoutMs: 1500, log: () => {} })
    try {
      assert.equal(await pool.submit({ type: 'transpile', n: 1, stuck: true }), 1)
      await pause(200)
      assert.equal(await settlesWithin(pool.flush(), 10000), true, 'le vidage rend la main (10 s attendues, délai du pool : 1,5 s)')
      assert.equal(await pool.submit({ type: 'transpile', n: 2 }), 2)
    }
    finally {
      await pool.terminate()
    }
  })

  it('le délai du vidage est celui des tâches ; à ce délai le worker muet, et lui seul, est arrêté et remplacé, une ligne le dit', async () => {
    const clock = fakeClock()
    const lines = [] as string[]
    const pool  = new WorkerPool(2, { workerPath: script() }, { timeoutMs: 60000, timers: clock, log: (line) => lines.push(line) })
    try {
      assert.equal(await pool.submit({ type: 'transpile', n: 1, stuck: true }), 1)
      await pause(200)
      const before = new Set(clock.timers.keys())
      const flush  = pool.flush()
      const armed  = [...clock.timers.keys()].filter((id) => !before.has(id))
      assert.deepEqual(armed.map((id) => clock.timers.get(id)?.ms), [60000, 60000], 'un délai par worker, celui des tâches')
      // le worker en vie écrit sa marque : son délai est retiré, celui du worker muet reste armé
      await until(() => armed.filter((id) => clock.timers.has(id)).length === 1, 'la marque du worker en vie')
      assert.equal(await settlesWithin(flush, 300), false, 'avant le délai, le vidage attend le worker muet')
      clock.ring(armed)
      assert.equal(await settlesWithin(flush, 10000), true, 'au délai, le vidage rend la main')
      assert.equal(lines.length, 1, `une ligne, pour le seul worker muet : ${JSON.stringify(lines)}`)
      assert.match(lines[0], /^\[bundler\] .*60 s/)
      assert.equal(await pool.submit({ type: 'transpile', n: 2 }), 2)
      // le worker muet n'est plus du pool : le vidage suivant rend la main sans qu'aucun délai sonne
      assert.equal(await settlesWithin(pool.flush(), 10000), true, 'le vidage suivant n\'attend plus le worker arrêté')
      assert.equal(lines.length, 1)
    }
    finally {
      await pool.terminate()
    }
  })

  it('un worker qui travaille n\'est pas muet : le délai du vidage repart, sa tâche et ses lignes arrivent', async () => {
    const clock = fakeClock()
    const lines = [] as string[]
    const pool  = new WorkerPool(1, { workerPath: script() }, { timeoutMs: 60000, timers: clock, log: (line) => lines.push(line) })
    try {
      // worker démarré, puis une tâche longue : il ne lit le message du vidage qu'après elle
      assert.equal(await pool.submit({ type: 'transpile', n: 0 }), 0)
      const task   = pool.submit({ type: 'transpile', n: 1, work: 1000 })
      const before = new Set(clock.timers.keys())
      const flush  = pool.flush()
      const armed  = [...clock.timers.keys()].filter((id) => !before.has(id))
      assert.equal(armed.length, 1, 'le vidage a son délai')
      // le délai du vidage sonne pendant que la tâche est en vol
      clock.ring(armed)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(await task, 1)
      assert.equal(await settlesWithin(flush, 10000), true, 'la tâche rendue, le worker écrit sa marque')
      assert.deepEqual(lines, [], 'ni worker arrêté, ni nouvel essai')
    }
    finally {
      await pool.terminate()
    }
  })
})
