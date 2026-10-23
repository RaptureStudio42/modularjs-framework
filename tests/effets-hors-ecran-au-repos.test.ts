// Un effet mené par une minuterie, réglé `on: always` (*sparkles, *cycle, *rainbow, *glitch,
// *shine) : sa minuterie s'arrête quand la balise quitte l'écran, et repart quand elle y revient —
// vingt étiquettes *sparkles plus bas dans la page ne créent plus des centaines de nœuds par seconde.
// Sans observateur d'intersection, ou tant qu'il n'a rien dit, l'effet tourne comme avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'etincelles': Array.from({ length: 5 }, (_, i) => `<p class="s s${i}" *sparkles(count: 20)>Nouveau</p>`).join('\n'),
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('on: always hors de l\'écran : la minuterie de l\'effet se repose', function () {
  this.timeout(60000)
  let window: any
  const ios: any[] = []

  before(async () => {
    const root   = mjsTmp('effets-hors-ecran')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // un observateur qu'on déclenche à la main : chaque balise observée dit si elle est à l'écran
    window.IntersectionObserver = class {
      cb: any; els: any[] = []
      constructor(cb: any) { this.cb = cb; ios.push(this) }
      observe(el: any) { this.els.push(el) }
      unobserve() {}
      disconnect() { this.els = [] }
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // les balises observées, toutes à l'écran (oui) ou toutes hors de l'écran (non)
  const ecran = (oui: boolean) => { for (const io of ios) if (io.els.length) io.cb(io.els.map((el: any) => ({ target: el, isIntersecting: oui, intersectionRatio: oui ? 1 : 0 }))) }

  // les nœuds ajoutés dans le composant pendant `ms`
  async function ajouts(comp: any, ms: number) {
    let n = 0
    const mo = new window.MutationObserver((l: any[]) => { for (const m of l) n += m.addedNodes.length })
    mo.observe(comp._shadow, { childList: true, subtree: true })
    await new Promise((r) => setTimeout(r, ms))
    mo.disconnect()
    return n
  }

  it('cinq *sparkles : à l\'écran, des étincelles ; hors de l\'écran, aucune ; revenues, elles repartent', async () => {
    window.document.body.innerHTML = '<mjs-etincelles></mjs-etincelles>'
    const comp = window.document.querySelector('mjs-etincelles')
    await attendre(() => comp._shadow?.querySelectorAll('.s[mjs-fx]').length === 5)
    assert.ok(await ajouts(comp, 400) > 0, 'avant tout signal de l\'observateur : l\'effet tourne')
    ecran(false)
    await new Promise((r) => setTimeout(r, 50))
    const hors = await ajouts(comp, 600)
    ecran(true)
    const revenu = await ajouts(comp, 400)
    assert.equal(hors, 0, 'hors de l\'écran : nœuds créés')
    assert.ok(revenu > 0, 'revenues à l\'écran : les étincelles repartent')
  })
})
