// Un effet dont le fichier arrive à la demande, posé deux fois sur la même balise pendant l'attente
// (le bloc qui la porte repasse, une variable de réglage a changé entre-temps) : c'est le dernier
// appel qui pose l'effet, avec ses valeurs. Avant, le premier l'emportait, avec une couleur périmée.
// Posé par deux composants (le même effet sur <@document>), il reste tant qu'un des deux est affiché.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

describe('effets — un fichier en route, le dernier appel l\'emporte', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-fichier-en-route')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-neon.mjs'), '<b class="n" *neon(#0ff)>x</b>')
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

  it('deux poses pendant l\'attente : la couleur du dernier appel', async () => {
    const µ    = window.µ
    const def  = µ._mjs_fxDefs.neon
    const need = µ._mjs_fxNeed
    let arrive: () => void = () => {}
    const enRoute = new Promise<void>((ok) => { arrive = ok })
    delete µ._mjs_fxDefs.neon
    µ._mjs_fxNeed = () => enRoute
    try {
      const b = window.document.createElement('b')
      b.textContent = 'x'
      window.document.body.appendChild(b)
      µ._mjs_fx(null, b, 'neon', {}, { color: '#ff0000' }, { color: ['c', 'color'] })
      µ._mjs_fx(null, b, 'neon', {}, { color: '#0000ff' }, { color: ['c', 'color'] })
      µ._mjs_fxDefs.neon = def
      arrive()
      await new Promise((r) => setTimeout(r, 20))
      assert.equal(b.style.getPropertyValue('--mjs-neon-color').trim().toLowerCase(), '#0000ff')
    }
    finally {
      µ._mjs_fxDefs.neon = def
      µ._mjs_fxNeed      = need
    }
  })

  it('deux composants pendant l\'attente : l\'effet reste tant qu\'un des deux est là', async () => {
    const µ    = window.µ
    const def  = µ._mjs_fxDefs.neon
    const need = µ._mjs_fxNeed
    let arrive: () => void = () => {}
    const enRoute = new Promise<void>((ok) => { arrive = ok })
    delete µ._mjs_fxDefs.neon
    µ._mjs_fxNeed = () => enRoute
    try {
      const b = window.document.createElement('b')
      b.textContent = 'x'
      window.document.body.appendChild(b)
      const c1: any = {}
      const c2: any = {}
      µ._mjs_fx(c1, b, 'neon', {}, { color: '#ff0000' }, { color: ['c', 'color'] })
      µ._mjs_fx(c2, b, 'neon', {}, { color: '#0000ff' }, { color: ['c', 'color'] })
      µ._mjs_fxDefs.neon = def
      arrive()
      await new Promise((r) => setTimeout(r, 20))
      const posee = () => b.style.getPropertyValue('--mjs-neon-color').trim().toLowerCase()
      assert.equal(posee(), '#0000ff')
      assert.equal(c1._mjs_attachments?.size, 1, 'le premier composant y tient aussi')
      ;[...c2._mjs_attachments][0]()
      assert.equal(posee(), '#0000ff', 'le second parti, l\'effet reste pour le premier')
      ;[...c1._mjs_attachments][0]()
      assert.equal(posee(), '', 'les deux partis, l\'effet s\'en va')
    }
    finally {
      µ._mjs_fxDefs.neon = def
      µ._mjs_fxNeed      = need
    }
  })
})
