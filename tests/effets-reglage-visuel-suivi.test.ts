// Effets — un réglage visuel tenu par une variable : le moteur met sa variable CSS à jour sur place
// (l'effet ne repart pas), et prévient aussi l'effet, par son `set(k, v)`, quand il en a un — un effet
// qui recopie ce réglage dans son code (une durée pour sa minuterie, une couleur pour son canevas)
// garde sinon l'ancienne valeur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

describe('effets — un réglage visuel suivi par une variable', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-reglage-visuel')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    // un effet écrit, pour que le moteur soit au cœur
    writeFileSync(join(srcDir, 'fx-neon.mjs'), '<h1 class="t" *neon>Néon</h1>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('la variable CSS suit sur place, l\'effet ne repart pas, et son set(k, v) reçoit la nouvelle valeur', () => {
    const µ = window.µ
    const poses: any[] = []
    const vus: any[] = []
    µ._mjs_fxDefs.essai = {
      vars: { speed: 'ms' },
      setup(el: any, s: any) {
        poses.push(s.speed)
        const stop: any = () => {}
        stop.set = (k: string, v: any) => {
          vus.push([k, v])
          return k === 'speed' ? undefined : false
        }
        return stop
      },
    }
    const el = window.document.createElement('div')
    window.document.body.appendChild(el)
    µ._mjs_fx(null, el, 'essai', { speed: 100 })
    assert.equal(el.style.getPropertyValue('--mjs-essai-speed'), '100ms')
    µ._mjs_fxSet(el, 'essai', { speed: 250 })
    assert.equal(el.style.getPropertyValue('--mjs-essai-speed'), '250ms', 'la variable CSS suit')
    assert.deepEqual(poses, [100], 'l\'effet n\'a pas été reposé')
    assert.equal(JSON.stringify(vus), JSON.stringify([['speed', 250]]), 'l\'effet est prévenu')
  })

  it('un effet sans set : la variable CSS seule, sans erreur', () => {
    const µ = window.µ
    let poses = 0
    µ._mjs_fxDefs.essai2 = { vars: { color: '' }, setup() { poses++; return () => {} } }
    const el = window.document.createElement('div')
    window.document.body.appendChild(el)
    µ._mjs_fx(null, el, 'essai2', { color: '#f00' })
    µ._mjs_fxSet(el, 'essai2', { color: '#0f0' })
    assert.equal(el.style.getPropertyValue('--mjs-essai2-color'), '#0f0')
    assert.equal(poses, 1)
  })
})
