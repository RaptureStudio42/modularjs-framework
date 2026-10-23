// modules cœur gauge, carousel et knob : l'écouteur de molette (non passif : il retient le défilement de la page) n'est posé que quand
// la molette sert — `wheel` écrit pour la jauge et le carrousel, bouton rotatif non désactivé — et suit le réglage s'il change ; sans
// lui, le navigateur fait défiler la page sur ces modules sans attendre le script.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { compter, rendreTout } from './helpers/happy-dom-espions.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $w = false',
  '</script>',
  '<@@gauge class="g"></@@gauge>',
  '<@@gauge class="gw" wheel></@@gauge>',
  '<@@gauge class="gd" wheel disabled></@@gauge>',
  '<@@gauge class="gl" wheel={$w}></@@gauge>',
  '<@@carousel class="c"><div>a</div><div>b</div></@@carousel>',
  '<@@carousel class="cw" wheel><div>a</div><div>b</div></@@carousel>',
  '<@@knob class="k"></@@knob>',
  '<@@knob class="kd" disabled></@@knob>',
  '<button id="b" @click={$w = not $w}>molette</button>',
].join('\n')

describe('modules cœur — écouteur de molette posé seulement quand elle sert', function () {
  this.timeout(60000)
  let window: any
  let code = ''
  let espion: ReturnType<typeof compter>

  before(async () => {
    const root   = mjsTmp('molette-passive')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
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

  async function monter() {
    window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    espion = compter(window)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    const hote = window.document.querySelector('mjs-hote')
    await attendre(() => !!hote._shadow?.querySelector('.kd')?._shadow?.querySelector('.knob'))
    await pause(120)
    return hote
  }

  it('jauge et carrousel sans `wheel`, jauge et bouton désactivés : aucun écouteur ; avec la molette qui sert : un', async () => {
    const hote = await monter()
    const box  = (sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.box')
    const dial = (sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.knob')
    assert.equal(espion.vivants('wheel', box('.g')), 0, 'jauge sans wheel')
    assert.equal(espion.vivants('wheel', box('.gw')), 1, 'jauge avec wheel')
    assert.equal(espion.vivants('wheel', box('.gd')), 0, 'jauge désactivée')
    assert.equal(espion.vivants('wheel', hote._shadow.querySelector('.c')), 0, 'carrousel sans wheel')
    assert.equal(espion.vivants('wheel', hote._shadow.querySelector('.cw')), 1, 'carrousel avec wheel')
    assert.equal(espion.vivants('wheel', dial('.k')), 1, 'bouton rotatif')
    assert.equal(espion.vivants('wheel', dial('.kd')), 0, 'bouton rotatif désactivé')
  })

  it('`wheel` lié : l\'écouteur arrive et repart avec le réglage, et part avec le module', async () => {
    const hote = await monter()
    const box  = () => hote._shadow.querySelector('.gl')._shadow.querySelector('.box')
    const cible = box()
    assert.equal(espion.vivants('wheel', cible), 0, 'préalable : molette coupée')
    hote._shadow.querySelector('#b').click()
    await attendre(() => espion.vivants('wheel', cible) === 1)
    assert.equal(espion.vivants('wheel', cible), 1, 'molette allumée')
    hote._shadow.querySelector('#b').click()
    await attendre(() => espion.vivants('wheel', cible) === 0)
    assert.equal(espion.vivants('wheel', cible), 0, 'molette recoupée')
    const gw = hote._shadow.querySelector('.gw')
    const boite = gw._shadow.querySelector('.box')
    gw.remove()
    await pause(60)
    assert.equal(espion.vivants('wheel', boite), 0, 'module parti')
  })
})
