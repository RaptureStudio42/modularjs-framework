// *cursors, *follow : un bloc qui défile DANS un composant (un panneau, une barre latérale : un
// `overflow: auto` de son shadow root) — le défilement ne sort pas de ce shadow root (l'événement
// `scroll` ne traverse pas), et l'effet ne le voyait pas : chez qui montre, la balise sous la souris
// immobile change sans que rien ne reparte ; chez qui voit, les marques restent collées à l'écran.
// Le cœur relaie désormais ce défilement aux effets qui dessinent sur la page.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-panneau': '<div class="defile">un long texte</div>',
  'fx-zone': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<main class="c" *cursors><@fx-panneau></@fx-panneau><b class="b" tabindex="0">x</b></main>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*cursors — un défilement dans un composant', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-curseurs-defilement-interne')
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
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('la souris immobile, un bloc défile dans un composant de la zone : la position repart', async () => {
    const envoyes: any[] = []
    const s: any = {
      send(type: string, p: any) { envoyes.push([type, p]) },
      on() { return () => {} },
      room() { return { presence: () => ({}), leave() {} } },
      request() { return Promise.resolve({ id: 'moi', name: 'Moi' }) },
      destroy() {}, release() {},
    }
    window.µ.socket = () => s
    window.µ._mjs_sockets = { 'wss://x.fr/ws': s }
    window.document.body.innerHTML = '<mjs-fx-zone></mjs-fx-zone>'
    const zone = window.document.querySelector('mjs-fx-zone')
    await attendre(() => !!zone._shadow?.querySelector('mjs-fx-panneau')?._shadow?.querySelector('.defile'))
    await new Promise((r) => setTimeout(r, 20))
    const cible  = zone._shadow.querySelector('.b')
    const defile = zone._shadow.querySelector('mjs-fx-panneau')._shadow.querySelector('.defile')
    const avant  = window.document.elementFromPoint
    window.document.elementFromPoint = () => cible
    try {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => envoyes.some((e: any) => e[0] === 'cursors:move' && e[1].p))
      const n0 = envoyes.length
      assert.ok(n0 > 0, 'la souris est partie')
      defile.dispatchEvent(new window.Event('scroll'))
      await attendre(() => envoyes.length > n0, 500)
      assert.ok(envoyes.length > n0, 'le défilement dans le composant fait repartir la position')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })
})
