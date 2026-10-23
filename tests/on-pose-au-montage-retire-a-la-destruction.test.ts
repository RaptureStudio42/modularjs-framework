// Un `µon` posé dans `µmount` est retiré à la destruction du composant : `µmount` rejoue à chaque retour dans la page
// et le repose. Défaut garanti absent : l'écouteur s'ajoutait à chaque retour sur la même racine — après deux retours,
// un clic jouait trois fois le gestionnaire. Garde : un `µon` posé par le script du composant (joué une seule fois)
// reste, retours compris.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const VIE = [
  '<script>',
  'window.__vie = {mount: 0, clicMount: 0, clicCorps: 0}',
  "µon 'click', '.b', (e, el) -> window.__vie.clicCorps += 1",
  'µmount ->',
  '  window.__vie.mount += 1',
  "  µon 'click', '.b', (e, el) -> window.__vie.clicMount += 1",
  '</script>',
  '<button class="b">b</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('on-monte-retire')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-onm-vie.mjs'), VIE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('`µon` posé au montage : retiré à la destruction, reposé au retour', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('après deux retours dans la page, un clic joue chaque gestionnaire une fois', async () => {
    const d = app.window.document
    d.body.innerHTML = '<div id="z"><mjs-tst-onm-vie></mjs-tst-onm-vie></div>'
    await pause(80)
    const c = d.querySelector('mjs-tst-onm-vie')
    const z = d.getElementById('z')
    const v = app.window.__vie
    const clic = () => { v.clicMount = 0; v.clicCorps = 0; c._shadow.querySelector('.b').click(); return { mount: v.mount, clicMount: v.clicMount, clicCorps: v.clicCorps } }
    assert.deepEqual(clic(), { mount: 1, clicMount: 1, clicCorps: 1 })
    for (const tour of [2, 3]) {
      c.remove(); await pause(40)
      z.appendChild(c); await pause(60)
      assert.deepEqual(clic(), { mount: tour, clicMount: 1, clicCorps: 1 }, `retour n° ${tour - 1}`)
    }
    d.body.innerHTML = ''
  })
})
