// Ce que ce test garantit : une tâche lente ou un worker qui meurt ne fait plus échouer la construction. Sous forte charge
// (machine à 20 et plus), une tâche qui dépassait le délai du pool était rejetée et son worker retiré sans remplaçant :
// la construction sortait en code 1, et le pool rétrécissait pour les tâches suivantes. Désormais le worker perdu est
// remplacé, la tâche repart une fois sur un autre worker, puis, perdue une seconde fois, est faite dans le processus
// principal (repli fourni par le bundler) ; une ligne le dit. Le délai part du moment où le worker COMMENCE la tâche
// (accusé `started` du worker) : ni l'attente de son tour ni le démarrage du worker n'en mangent une part. Une erreur
// rendue par la tâche elle-même n'est jamais reprise. Les délais sont joués sur une horloge factice : rien n'attend
// l'horloge réelle.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { mjsTmp } from './helpers/tmp.js'
import { WorkerPool, resolveWorkerScript } from '../src/bundler/worker-pool.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'

// horloge factice : les minuteries du pool ne partent que quand le test avance l'heure
function fakeClock() {
  let now  = 0
  let next = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    armed: 0,
    setTimeout(fn: () => void, ms: number): number {
      const id = next++
      timers.set(id, { at: now + ms, fn })
      this.armed++
      return id
    },
    clearTimeout(id: unknown): void {
      timers.delete(id as number)
    },
    advance(ms: number): void {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue
        timers.delete(id)
        timer.fn()
      }
    },
  }
}

// faux workers, même protocole que worker.ts ({ id, started } puis { id, ok, result | error })
function fakeWorker(dir: string, name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `import { parentPort, workerData } from 'node:worker_threads'\nimport { existsSync, writeFileSync } from 'node:fs'\n${body}\n`)
  return path
}

// le premier à recevoir une tâche meurt (le témoin le dit aux suivants), les autres répondent
const DIES_ONCE = `parentPort.on('message', (msg) => {
  if (!existsSync(workerData.marker)) { writeFileSync(workerData.marker, ''); process.exit(1) }
  parentPort.postMessage({ id: msg.id, ok: true, result: 'pong' })
})`

const DIES_ALWAYS = `parentPort.on('message', () => { process.exit(1) })`

const FAILS = `parentPort.on('message', (msg) => { parentPort.postMessage({ id: msg.id, ok: false, error: 'faute dans le fichier' }) })`

// le premier commence sa tâche et ne la rend qu'une fois le fichier \`go\` posé ; les suivants la rendent aussitôt
const SLOW_ONCE = `parentPort.on('message', (msg) => {
  parentPort.postMessage({ id: msg.id, started: true })
  if (existsSync(workerData.marker)) { parentPort.postMessage({ id: msg.id, ok: true, result: 'pong' }); return }
  writeFileSync(workerData.marker, '')
  const wait = setInterval(() => {
    if (!existsSync(workerData.go)) return
    clearInterval(wait)
    parentPort.postMessage({ id: msg.id, ok: true, result: 'tard' })
  }, 5)
})`

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`jamais arrivé : ${what}`)
}

describe('WorkerPool — un worker perdu est remplacé, la tâche a une seconde chance', function () {
  this.timeout(20000)

  after(async () => { await terminateSharedWorkerPool() })

  it('un worker qui meurt sur sa tâche est remplacé : la tâche repart sur le remplaçant et aboutit', async () => {
    const dir  = mjsTmp('pool-meurt-une-fois')
    const pool = new WorkerPool(1, { workerPath: fakeWorker(dir, 'w.mjs', DIES_ONCE), workerData: { marker: join(dir, 'mort') } })
    try {
      assert.equal(await pool.submit({ type: 'transpile', moduleName: 'carte' }), 'pong', 'la tâche aboutit sur le remplaçant')
      assert.equal(pool.isDead(), false, 'le pool garde sa taille')
      assert.equal(await pool.submit({ type: 'transpile', moduleName: 'suivante' }), 'pong', 'la tâche suivante trouve un worker')
    } finally {
      await pool.terminate()
    }
  })

  it('perdue deux fois, la tâche est faite par le repli, et une ligne le dit', async () => {
    const dir    = mjsTmp('pool-meurt-toujours')
    const lignes: string[] = []
    const pool   = new WorkerPool(1, { workerPath: fakeWorker(dir, 'w.mjs', DIES_ALWAYS) }, { fallback: async (msg: any) => `repli:${msg.moduleName}`, log: line => lignes.push(line) })
    try {
      assert.equal(await pool.submit({ type: 'transpile', moduleName: 'carte' }), 'repli:carte', 'le repli fait la tâche')
      assert.equal(lignes.filter(l => /carte/.test(l) && /processus principal/.test(l)).length, 1, `une ligne nomme la tâche reprise dans le processus principal :\n${lignes.join('\n')}`)
    } finally {
      await pool.terminate()
    }
  })

  it('une erreur rendue par la tâche n\'est pas reprise : ni nouvel essai, ni repli', async () => {
    const dir   = mjsTmp('pool-erreur')
    let replis  = 0
    const pool  = new WorkerPool(1, { workerPath: fakeWorker(dir, 'w.mjs', FAILS) }, { fallback: async () => { replis++; return 'repli' } })
    try {
      await assert.rejects(pool.submit({ type: 'transpile', moduleName: 'carte' }), /faute dans le fichier/)
      assert.equal(replis, 0, 'le repli n\'est pas appelé pour une erreur du fichier')
    } finally {
      await pool.terminate()
    }
  })

  it('le délai part du début de la tâche : le temps passé avant son début ne compte pas', async () => {
    const dir   = mjsTmp('pool-delai-debut')
    const clock = fakeClock()
    const go    = join(dir, 'go')
    const pool  = new WorkerPool(1, { workerPath: fakeWorker(dir, 'w.mjs', SLOW_ONCE), workerData: { marker: join(dir, 'pris'), go } }, { timeoutMs: 10, timers: clock })
    try {
      const result = pool.submit({ type: 'transpile', moduleName: 'carte' })
      let settled  = false
      result.then(() => { settled = true }, () => { settled = true })
      clock.advance(9)
      // l'accusé de début réarme le délai : 9 de plus font 18 depuis l'envoi, 9 depuis le début
      await until(() => clock.armed >= 2 || settled, 'accusé de début de la tâche')
      clock.advance(9)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(settled, false, 'la tâche commencée depuis moins que le délai n\'est pas abandonnée')
      writeFileSync(go, '')
      assert.equal(await result, 'tard', 'le premier worker rend sa tâche')
    } finally {
      await pool.terminate()
    }
  })

  it('une tâche commencée qui dépasse le délai : son worker est remplacé, la tâche repart et aboutit', async () => {
    const dir   = mjsTmp('pool-delai-depasse')
    const clock = fakeClock()
    const pool  = new WorkerPool(1, { workerPath: fakeWorker(dir, 'w.mjs', SLOW_ONCE), workerData: { marker: join(dir, 'pris'), go: join(dir, 'go') } }, { timeoutMs: 10, timers: clock })
    try {
      const result = pool.submit({ type: 'transpile', moduleName: 'carte' })
      let settled  = false
      result.then(() => { settled = true }, () => { settled = true })
      await until(() => clock.armed >= 2 || settled, 'accusé de début de la tâche')
      clock.advance(11)
      assert.equal(await result, 'pong', 'la tâche aboutit sur le remplaçant')
      assert.equal(pool.isDead(), false, 'le pool garde sa taille')
    } finally {
      await pool.terminate()
    }
  })

  it('le worker du framework accuse le début de chaque tâche avant de la rendre', async () => {
    const spec     = await resolveWorkerScript()
    const worker   = new Worker(spec.workerPath, { workerData: spec.workerData })
    const messages: any[] = []
    try {
      const done = new Promise<void>((resolve, reject) => {
        worker.on('error', reject)
        worker.on('message', (m: any) => { messages.push(m); if (m.ok !== undefined) resolve() })
      })
      worker.postMessage({ type: 'transpile', id: 7, content: '<p>essai</p>\n', moduleName: 'essai' })
      await done
      assert.deepEqual(messages[0], { id: 7, started: true }, 'le premier message est l\'accusé de début')
      assert.equal(messages[1]?.ok, true, `puis le résultat : ${JSON.stringify(messages[1])?.slice(0, 200)}`)
    } finally {
      await worker.terminate()
    }
  })

  it('le pool du bundler a son repli : la même transpilation, dans le processus principal', async () => {
    const root    = mjsTmp('pool-repli-bundler')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out') })
    try {
      const pool = await (bundler as any).ensureWorkerPool()
      assert.equal(pool.fallback, transpileFromMsg, 'le repli du pool est la transpilation du processus principal')
    } finally {
      await bundler.close()
    }
  })

  it('l\'attente d\'une compilation déjà en vol couvre les deux essais d\'une tâche lente', () => {
    const root    = mjsTmp('pool-attente-en-vol')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out') })
    assert.ok(bundler.dedupWaitTimeoutMs >= 4 * 60_000, `délai d'attente par défaut : ${bundler.dedupWaitTimeoutMs} ms`)
  })
})
