// Ce que ce test garantit : `WorkerPool.flush()` ne rend la main qu'une fois passé aux sorties du processus tout ce que les
// workers ont écrit sur les leurs — le bilan des avertissements de `mjs check` s'écrit ainsi après la dernière de leurs lignes.
// Un worker garde ses lignes tant que le processus principal n'a pas pris les précédentes : la réponse d'une tâche peut arriver
// avant elles. La marque d'un vidage n'est jamais écrite au terminal ; un worker qui ne connaît pas ce message, ou qui sort
// pendant le vidage, ne fait jamais attendre sans fin.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import * as workerPool from '../src/bundler/worker-pool.js'
import { captureOutput } from '../src/cli/check-json.js'

const LIGNES = 40
const TACHES = 16

// un worker d'essai : à chaque tâche, des lignes sur ses deux sorties puis la réponse ; au message `flush`, ce que dit `mode`
function script(mode: 'marque' | 'inconnu' | 'sortie'): string {
  const flush = { marque: 'process.stdout.write(msg.mark); process.stderr.write(msg.mark)', inconnu: 'parentPort.postMessage({ id: msg.id, ok: false, error: \'Unknown message type: flush\' })', sortie: 'process.exit(0)' }[mode]
  const file  = join(mjsTmp('pool-vidage'), 'worker.cjs')
  writeFileSync(file, [
    'const { parentPort } = require(\'node:worker_threads\')',
    'parentPort.on(\'message\', (msg) => {',
    `  if (msg.type === 'flush') { ${flush}; return }`,
    '  parentPort.postMessage({ id: msg.id, started: true })',
    `  for (let i = 0; i < ${LIGNES}; i++) { console.warn('avertissement ' + msg.n + ' ' + i); console.log('ligne ' + msg.n + ' ' + i) }`,
    '  parentPort.postMessage({ id: msg.id, ok: true, result: msg.n })',
    '})'
  ].join('\n') + '\n')
  return file
}

describe('bundler/worker-pool — flush : les lignes des workers sont passées aux sorties du processus', function () {
  this.timeout(60000)

  it('après le vidage, chaque ligne écrite par les workers est écrite par le processus, la marque jamais ; le pool sert encore', async () => {
    const pool    = new workerPool.WorkerPool(4, { workerPath: script('marque') })
    const capture = captureOutput()
    let apres: unknown
    try {
      await Promise.all(Array.from({ length: TACHES }, (_, n) => pool.submit({ type: 'transpile', n })))
      await workerPool.flushWorkerOutput()
      apres = await pool.submit({ type: 'transpile', n: 99 })
    }
    finally {
      capture.restore()
      await pool.terminate()
    }
    const texte = (stream: 'out' | 'err') => capture.lines.filter((l) => l.stream === stream).map((l) => l.text).join('')
    assert.equal(texte('err').split('\n').filter((l) => l.startsWith('avertissement ') && !l.startsWith('avertissement 99 ')).length, TACHES * LIGNES)
    assert.equal(texte('out').split('\n').filter((l) => l.startsWith('ligne ') && !l.startsWith('ligne 99 ')).length, TACHES * LIGNES)
    assert.ok(!(texte('err') + texte('out')).includes('\0'), 'la marque du vidage n\'est pas écrite')
    assert.equal(apres, 99)
  })

  it('un worker qui ne connaît pas ce message : sa réponse clôt le vidage', async () => {
    const pool = new workerPool.WorkerPool(2, { workerPath: script('inconnu') })
    try {
      await pool.flush()
      assert.equal(await pool.submit({ type: 'transpile', n: 7 }), 7)
    }
    finally {
      await pool.terminate()
    }
  })

  it('un worker qui sort pendant le vidage ne le fait pas attendre', async () => {
    const pool = new workerPool.WorkerPool(2, { workerPath: script('sortie') })
    try {
      await pool.flush()
    }
    finally {
      await pool.terminate()
    }
  })

  it('un pool terminé pendant un vidage le clôt, et la marque arrivée ensuite n\'est pas écrite', async () => {
    const pool    = new workerPool.WorkerPool(4, { workerPath: script('marque') })
    const capture = captureOutput()
    try {
      await Promise.all(Array.from({ length: TACHES }, (_, n) => pool.submit({ type: 'transpile', n })))
      await pool.flush()
      const vidage = pool.flush()
      // ce thread, occupé, ne lit rien : les workers écrivent leur marque, qui n'arrive qu'après la clôture du vidage
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
      await pool.terminate()
      await vidage
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    finally {
      capture.restore()
      await pool.terminate()
    }
    assert.ok(!capture.lines.map((l) => l.text).join('').includes('\0'), 'la marque du vidage n\'est pas écrite')
  })
})
