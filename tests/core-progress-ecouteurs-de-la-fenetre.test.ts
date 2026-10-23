// module cœur progress (<@@progress>) : la fenêtre n'est écoutée que pour ce qui sert — défilement et redimensionnement en `scroll`,
// souris en `follow`, rien pour un cercle qui montre `value` ; en `follow`, la position suivie s'écrit une fois par image, la dernière
// connue (plusieurs mouvements de souris entre deux images ne redessinent pas plusieurs fois).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { compter, rendreTout } from './helpers/happy-dom-espions.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const COMPOSANTS: Record<string, string> = {
  'hote-calme':  '<@@progress class="p" value="40"></@@progress>',
  'hote-defile': '<@@progress class="p" scroll></@@progress>',
  'hote-suivi':  '<@@progress class="p" follow></@@progress>',
}

const TYPES = ['scroll', 'resize', 'mousemove', 'mouseout']

describe('mjs-core-progress — écouteurs de la fenêtre', function () {
  this.timeout(60000)
  let window: any
  let code = ''
  let espion: ReturnType<typeof compter>

  before(async () => {
    const root   = mjsTmp('progress-fenetre')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    code = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  afterEach(() => {
    rendreTout()
    window?.close?.()
  })

  after(async () => { await terminateSharedWorkerPool() })

  // les écouteurs que le module ajoute à ceux que le moteur pose déjà sur la fenêtre
  async function monter(tag: string) {
    window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    espion = compter(window)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    const avant = Object.fromEntries(TYPES.map((t) => [t, espion.vivants(t, window)]))
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const hote = window.document.querySelector(tag)
    await attendre(() => !!hote._shadow?.querySelector('.p')?._shadow?.querySelector('.progress'))
    await pause(120)
    const poses = () => Object.fromEntries(TYPES.map((t) => [t, espion.vivants(t, window) - avant[t]]))
    return { hote, poses }
  }

  it('`value` seul : aucun écouteur sur la fenêtre', async () => {
    const { poses } = await monter('mjs-hote-calme')
    assert.deepEqual(poses(), { scroll: 0, resize: 0, mousemove: 0, mouseout: 0 })
  })

  it('`scroll` : défilement et redimensionnement seulement', async () => {
    const { poses } = await monter('mjs-hote-defile')
    assert.deepEqual(poses(), { scroll: 1, resize: 1, mousemove: 0, mouseout: 0 })
  })

  it('`follow` : la souris seulement, retirée avec le module', async () => {
    const { hote, poses } = await monter('mjs-hote-suivi')
    assert.deepEqual(poses(), { scroll: 0, resize: 0, mousemove: 1, mouseout: 1 })
    hote._shadow.querySelector('.p').remove()
    await pause(60)
    assert.deepEqual(poses(), { scroll: 0, resize: 0, mousemove: 0, mouseout: 0 })
  })

  it('`follow` : cinq mouvements entre deux images, une seule écriture de la position, la dernière', async () => {
    const { hote } = await monter('mjs-hote-suivi')
    const cercle = hote._shadow.querySelector('.p')._shadow.querySelector('.progress')
    let ecritures = 0
    const mo = new window.MutationObserver((l: any[]) => { ecritures += l.length })
    mo.observe(cercle, { attributes: true, attributeFilter: ['style'] })
    for (const x of [10, 20, 30, 40, 50]) {
      window.dispatchEvent(new window.MouseEvent('mousemove', { clientX: x, clientY: 5 }))
      // les mouvements arrivent un par un : le moteur a le temps de redessiner entre deux, pas d'atteindre l'image suivante
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }
    ecritures += mo.takeRecords().length
    assert.ok(ecritures <= 1, `écritures du style entre deux images : ${ecritures}`)
    await pause(60)
    mo.disconnect()
    assert.equal(cercle.style.getPropertyValue('--mjs-progress-x'), '50px')
    assert.equal(cercle.classList.contains('shown'), true)
  })
})
