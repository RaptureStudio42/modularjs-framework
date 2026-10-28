// Ce que ce test garantit : un fichier dont la compilation, une fois commencée, dépasse le délai du pool n'est jamais
// refait dans le processus principal, où rien ne la bornerait. Un compilateur qui tourne sans fin y bloquait la
// construction pour toujours, et un dépassement de mémoire y emportait tout le processus, `mjs dev` compris. Le fichier
// garde sa seconde chance sur un autre worker ; s'il dépasse encore le délai, ou si ce second essai est perdu autrement,
// la tâche échoue avec une erreur qui le nomme, comme une erreur du fichier : `mjs build` échoue, `mjs dev` l'affiche et
// continue. Le repli dans le processus principal reste pour les workers qui ne commencent pas la tâche ou qui meurent.
// Un worker perdu sur un fichier trop long ne compte pas parmi les pertes d'affilée : des fichiers qui dépassent le délai
// ne tuent jamais le pool, dont la mort ferait passer toute la suite au repli. Délais joués sur une horloge factice, sauf
// dans le bundler.
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
function fakeWorker(dir: string, body: string): string {
  const path = join(dir, 'w.mjs')
  writeFileSync(path, `import { parentPort, workerData } from 'node:worker_threads'\nimport { existsSync, writeFileSync } from 'node:fs'\n${body}\n`)
  return path
}

// la tâche `boucle` est commencée, puis le compilateur ne rend plus jamais la main ; les autres sont rendues aussitôt
const LOOPS = `parentPort.on('message', (msg) => {
  if (msg.moduleName !== 'boucle') { parentPort.postMessage({ id: msg.id, ok: true, result: 'pong' }); return }
  parentPort.postMessage({ id: msg.id, started: true })
  for (;;) {}
})`

// premier essai commencé puis sans fin ; le worker du second essai meurt sur la tâche
const LOOPS_THEN_DIES = `parentPort.on('message', (msg) => {
  parentPort.postMessage({ id: msg.id, started: true })
  if (existsSync(workerData.marker)) process.exit(1)
  writeFileSync(workerData.marker, '')
  for (;;) {}
})`

// ne commence jamais la tâche : c'est le worker qui est en faute, pas le fichier
const NEVER_STARTS = `parentPort.on('message', () => {})`

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`jamais arrivé : ${what}`)
}

const OVERDUE = /délai|time limit/

describe('WorkerPool — un fichier qui dépasse le délai n\'est jamais compilé dans le processus principal', function () {
  this.timeout(30000)

  after(async () => { await terminateSharedWorkerPool() })

  it('commencée, la tâche dépasse deux fois le délai : elle échoue en nommant le fichier, sans repli, et le pool tient', async () => {
    const dir    = mjsTmp('pool-delai-deux-fois')
    const clock  = fakeClock()
    const lignes: string[] = []
    let replis   = 0
    const pool   = new WorkerPool(1, { workerPath: fakeWorker(dir, LOOPS) }, { timeoutMs: 10, timers: clock, fallback: async (msg: any) => { replis++; return `repli:${msg.moduleName}` }, log: line => lignes.push(line) })
    try {
      // deux fois de suite, comme deux enregistrements du même fichier sous `mjs dev`
      for (const tour of [1, 2]) {
        const base   = clock.armed
        const result = pool.submit({ type: 'transpile', moduleName: 'boucle' })
        result.catch(() => {})
        await until(() => clock.armed >= base + 2, `accusé de début du premier essai (tour ${tour})`)
        clock.advance(10)
        await until(() => clock.armed >= base + 4, `accusé de début du second essai (tour ${tour})`)
        clock.advance(10)
        await assert.rejects(result, (e: Error) => /boucle/.test(e.message) && OVERDUE.test(e.message), `tour ${tour} : la tâche échoue en nommant le fichier et le délai`)
      }
      assert.equal(replis, 0, 'le repli n\'est jamais appelé pour un fichier qui a dépassé le délai')
      assert.equal(lignes.filter(l => /boucle/.test(l) && /processus principal|main process/.test(l)).length, 0, `aucune ligne de repli :\n${lignes.join('\n')}`)
      assert.equal(lignes.filter(l => /boucle/.test(l) && /nouvel essai|retrying/.test(l)).length, 2, `une ligne par seconde chance :\n${lignes.join('\n')}`)
      assert.equal(pool.isDead(), false, 'les workers perdus sur un fichier trop long sont remplacés : le pool ne meurt pas')
      assert.equal(await pool.submit({ type: 'transpile', moduleName: 'suivante' }), 'pong', 'la tâche suivante passe par un worker')
      assert.equal(replis, 0, 'la tâche suivante ne passe pas par le repli')
    } finally {
      await pool.terminate()
    }
  })

  it('le délai dépassé au premier essai, le worker du second essai mort : la tâche échoue aussi, sans repli', async () => {
    const dir   = mjsTmp('pool-delai-puis-mort')
    const clock = fakeClock()
    let replis  = 0
    const pool  = new WorkerPool(1, { workerPath: fakeWorker(dir, LOOPS_THEN_DIES), workerData: { marker: join(dir, 'pris') } }, { timeoutMs: 10, timers: clock, fallback: async () => { replis++; return 'repli' }, log: () => {} })
    try {
      const result = pool.submit({ type: 'transpile', moduleName: 'carte' })
      result.catch(() => {})
      await until(() => clock.armed >= 2, 'accusé de début du premier essai')
      clock.advance(10)
      await assert.rejects(result, (e: Error) => /carte/.test(e.message) && OVERDUE.test(e.message), 'la tâche échoue en nommant le fichier et le délai')
      assert.equal(replis, 0, 'pas de repli pour un fichier qui a déjà dépassé le délai')
    } finally {
      await pool.terminate()
    }
  })

  it('le délai dépassé, puis plus aucun worker pour le second essai : la tâche échoue, sans repli', async () => {
    const dir   = mjsTmp('pool-delai-sans-remplacant')
    const clock = fakeClock()
    let replis  = 0
    const pool  = new WorkerPool(1, { workerPath: fakeWorker(dir, LOOPS) }, { timeoutMs: 10, timers: clock, fallback: async () => { replis++; return 'repli' }, log: () => {} })
    try {
      const result = pool.submit({ type: 'transpile', moduleName: 'boucle' })
      result.catch(() => {})
      await until(() => clock.armed >= 2, 'accusé de début')
      // remplaçant refusé : la tâche reste en queue d'un pool sans worker
      ;(pool as any).spawn = () => { throw new Error('remplaçant refusé') }
      clock.advance(10)
      await assert.rejects(result, (e: Error) => /boucle/.test(e.message) && OVERDUE.test(e.message), 'la tâche échoue en nommant le fichier et le délai')
      assert.equal(replis, 0, 'pas de repli pour un fichier qui a déjà dépassé le délai, même pool mort')
    } finally {
      await pool.terminate()
    }
  })

  it('un worker qui ne commence jamais la tâche : perdue deux fois, elle passe au repli, comme avec un worker mort', async () => {
    const dir   = mjsTmp('pool-jamais-commencee')
    const clock = fakeClock()
    const pool  = new WorkerPool(1, { workerPath: fakeWorker(dir, NEVER_STARTS) }, { timeoutMs: 10, timers: clock, fallback: async (msg: any) => `repli:${msg.moduleName}`, log: () => {} })
    try {
      const result = pool.submit({ type: 'transpile', moduleName: 'carte' })
      result.catch(() => {})
      clock.advance(10)
      await until(() => clock.armed >= 2, 'second essai envoyé')
      clock.advance(10)
      assert.equal(await result, 'repli:carte', 'le repli fait la tâche que les workers n\'ont pas commencée')
    } finally {
      await pool.terminate()
    }
  })

  it('dans le bundler : le fichier qui retient le compilateur est une erreur de compilation qui le nomme, et la compilation suivante passe', async function () {
    this.timeout(120000)
    const root = mjsTmp('pool-delai-bundler')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'boucle.mjs'), '<p class="boucle">boucle</p>\n')
    writeFileSync(join(src, 'carte.mjs'), '<p class="carte">carte</p>\n')
    writeFileSync(join(src, 'titre.mjs'), '<h1 class="titre">titre</h1>\n')
    // enveloppe du vrai worker : le fichier visé est commencé, puis le compilateur ne rend plus la main ; une fois le
    // fichier `gueri` posé, tout passe au vrai worker
    const workerPath = join(root, 'enveloppe.mjs')
    writeFileSync(workerPath, [
      `import { parentPort, workerData } from 'node:worker_threads'`,
      `import { existsSync } from 'node:fs'`,
      `import { pathToFileURL } from 'node:url'`,
      `const on = parentPort.on.bind(parentPort)`,
      `parentPort.on = (event, listener) => on(event, event !== 'message' ? listener : (msg) => {`,
      `  if (msg && msg.moduleName === workerData.cible && !existsSync(workerData.gueri)) {`,
      `    parentPort.postMessage({ id: msg.id, started: true })`,
      `    for (;;) {}`,
      `  }`,
      `  return listener(msg)`,
      `})`,
      `await import(pathToFileURL(workerData.reel).href)`,
      '',
    ].join('\n'))
    const reel    = (await resolveWorkerScript()).workerPath
    const gueri   = join(root, 'gueri')
    const pool    = new WorkerPool(2, { workerPath, workerData: { reel, cible: 'boucle', gueri } }, { fallback: transpileFromMsg, log: () => {} })
    const bundler = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), inlineTranspileLimit: 0 })
    ;(bundler as any).ensureWorkerPool = async () => pool
    try {
      // les deux workers démarrés avant de raccourcir le délai : leur démarrage (plusieurs secondes sur une machine
      // chargée) ne doit pas passer pour une tâche jamais commencée
      await Promise.all(['a', 'b'].map(nom => pool.submit({ type: 'transpile', id: 0, content: '<p>essai</p>\n', moduleName: `essai-${nom}` })))
      ;(pool as any).timeoutMs = 3000
      const stats   = await bundler.compile()
      const erreurs = stats.errors.map(e => e.message)
      assert.equal(erreurs.length, 1, `une seule erreur :\n${erreurs.join('\n')}`)
      assert.match(erreurs[0], /boucle\.mjs/, 'l\'erreur nomme le fichier')
      assert.match(erreurs[0], OVERDUE, 'l\'erreur dit le délai dépassé')
      const sortis = readdirSync(join(root, 'out')).join(' ')
      assert.match(sortis, /carte/, `les autres fichiers sont compilés : ${sortis}`)
      assert.match(sortis, /titre/, `les autres fichiers sont compilés : ${sortis}`)
      assert.equal(pool.isDead(), false, 'le pool tient')
      // le fichier corrigé et enregistré : la compilation suivante passe, sans erreur
      writeFileSync(gueri, '')
      writeFileSync(join(src, 'boucle.mjs'), '<p class="boucle">boucle corrigée</p>\n')
      const encore = await bundler.compile()
      assert.equal(encore.errors.length, 0, `la compilation suivante passe :\n${encore.errors.map(e => e.message).join('\n')}`)
      assert.match(readdirSync(join(root, 'out')).join(' '), /boucle/, 'le fichier corrigé est compilé')
    } finally {
      await bundler.close()
      await pool.terminate()
    }
  })
})
