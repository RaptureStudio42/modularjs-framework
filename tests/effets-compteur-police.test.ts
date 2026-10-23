// *count : la place du nombre (sa largeur la plus grande, réservée pour qu'il ne bouge pas en comptant)
// se reprend quand une police finit de charger après la pose — `document.fonts.ready` est souvent déjà
// tenu à la pose, la police partie après ; seul l'événement `loadingdone` le dit. happy-dom ne met rien
// en page : on vérifie que la mesure est refaite, la largeur se voit au banc navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*count — la place du nombre suit l\'arrivée des polices', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-compteur-police')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-compte.mjs'), '<b class="n" *count(on: load)>12480</b>')
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

  it('une police qui finit de charger après la pose : la place du nombre est reprise ; retiré, il n\'écoute plus', async () => {
    const polices: any = new window.EventTarget()
    polices.ready = Promise.resolve()
    Object.defineProperty(window.document, 'fonts', { value: polices, configurable: true })
    let mesures = 0
    const avant = window.µ._mjs_fxNumWidth
    window.µ._mjs_fxNumWidth = function (this: any, ...a: any[]) { mesures++; return avant.apply(this, a) }
    try {
      window.document.body.innerHTML = '<mjs-fx-compte></mjs-fx-compte>'
      const comp = window.document.querySelector('mjs-fx-compte')
      await attendre(() => !!comp._shadow?.querySelector('.n'))
      await new Promise((r) => setTimeout(r, 30))
      const n0 = mesures
      polices.dispatchEvent(new window.Event('loadingdone'))
      assert.ok(mesures > n0, `la place est reprise (${n0} → ${mesures})`)
      window.document.body.innerHTML = ''
      await new Promise((r) => setTimeout(r, 30))
      const n1 = mesures
      polices.dispatchEvent(new window.Event('loadingdone'))
      assert.equal(mesures, n1, 'l\'effet parti, plus rien')
    }
    finally {
      window.µ._mjs_fxNumWidth = avant
    }
  })
})
