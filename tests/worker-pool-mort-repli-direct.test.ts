// Ce que ce test garantit : un pool de compilation dont les workers meurent tous n'est plus recréé à chaque fichier. Avec
// un worker cassé dès son démarrage, chaque pool lançait ses workers puis autant de remplaçants, mourait, et la soumission
// suivante en recréait un neuf : des milliers de fils lancés pour rien sur un gros site. Désormais le nombre de fils a une
// borne nette (la taille du pool et autant de remplaçants, une fois pour toutes) ; le pool mort fait lui-même la suite des
// tâches par son repli (la même compilation, dans le processus principal), et une seule ligne le dit.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { WorkerPool } from '../src/bundler/worker-pool.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// chaque worker signe le registre à son démarrage, puis meurt avant de lire la moindre tâche
function workerCasse(dir: string): { workerPath: string, workerData: { registre: string } } {
  const workerPath = join(dir, 'casse.mjs')
  writeFileSync(workerPath, `import { workerData } from 'node:worker_threads'\nimport { appendFileSync } from 'node:fs'\nappendFileSync(workerData.registre, 'x')\nprocess.exit(1)\n`)
  return { workerPath, workerData: { registre: join(dir, 'registre') } }
}

const lances = (registre: string): number => existsSync(registre) ? readFileSync(registre, 'utf-8').length : 0

async function attendreMort(pool: any): Promise<void> {
  for (let i = 0; i < 2000 && !pool.isDead(); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(pool.isDead(), true, 'le pool finit sans worker')
}

describe('WorkerPool — un pool mort fait ses tâches par le repli, sans relancer de fils', function () {
  this.timeout(30000)

  after(async () => { await terminateSharedWorkerPool() })

  it('worker cassé au démarrage : chaque tâche passe au repli, les fils lancés restent bornés, une ligne pour toute la suite', async () => {
    const dir    = mjsTmp('pool-mort-repli')
    const spec   = workerCasse(dir)
    const lignes: string[] = []
    const pool   = new WorkerPool(2, spec, { fallback: async (msg: any) => `repli:${msg.moduleName}`, log: line => lignes.push(line) })
    try {
      assert.equal(await pool.submit({ type: 'transpile', moduleName: 'a' }), 'repli:a')
      await attendreMort(pool)
      const apresMort = lances(spec.workerData.registre)
      assert.ok(apresMort <= 4, `au plus la taille du pool et autant de remplaçants : ${apresMort} fils lancés`)
      for (const nom of ['b', 'c', 'd', 'e']) assert.equal(await pool.submit({ type: 'transpile', moduleName: nom }), `repli:${nom}`, `la tâche ${nom} est faite par le repli`)
      assert.equal(lances(spec.workerData.registre), apresMort, 'aucun fil lancé après la mort du pool')
      const suite = lignes.filter(l => /processus principal/.test(l) && /suivants|following/.test(l))
      assert.equal(suite.length, 1, `une ligne dit que la suite est compilée dans le processus principal :\n${lignes.join('\n')}`)
      assert.equal(lignes.filter(l => /\b[bcde] :/.test(l)).length, 0, `pas une ligne par tâche après la mort du pool :\n${lignes.join('\n')}`)
    } finally {
      await pool.terminate()
    }
  })

  it('sans repli, un pool mort rejette toujours la tâche', async () => {
    const dir  = mjsTmp('pool-mort-sans-repli')
    const spec = workerCasse(dir)
    const pool = new WorkerPool(1, spec)
    try {
      await assert.rejects(pool.submit({ type: 'transpile', moduleName: 'a' }))
      await attendreMort(pool)
      await assert.rejects(pool.submit({ type: 'transpile', moduleName: 'b' }), /aucun worker vivant|no worker alive/)
    } finally {
      await pool.terminate()
    }
  })

  it('le pool partagé du bundler, mort, n\'est pas recréé : la tâche suivante passe au repli', async () => {
    const root    = mjsTmp('pool-mort-bundler')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out') })
    try {
      const pool: any = await (bundler as any).ensureWorkerPool()
      // chaque worker vivant tué tant que le pool en remplace : au-delà de sa taille en pertes d'affilée, plus de remplaçant
      for (let tour = 0; tour < 100 && !pool.isDead(); tour++) {
        await Promise.all([...pool.workers].map((w: any) => w.terminate()))
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      await attendreMort(pool)
      let naissances = 0
      const spawn    = pool.spawn.bind(pool)
      pool.spawn     = () => { naissances++; spawn() }
      const encore   = await (bundler as any).ensureWorkerPool()
      assert.ok(encore === pool, 'le même pool, pas un neuf')
      const res: any = await encore.submit({ type: 'transpile', id: 0, content: '<p>essai</p>\n', moduleName: 'essai' })
      assert.match(String(res?.output), /essai/, 'la tâche est compilée par le repli')
      assert.equal(naissances, 0, 'aucun worker relancé')
    } finally {
      await bundler.close()
    }
  })
})
