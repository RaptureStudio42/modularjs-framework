// modules cœur number, knob et gauge (<@@number>, <@@knob>, <@@gauge>) : un min plus grand que le max bloque la valeur sur une borne
// (le nombre saute au min, le bouton rotatif et la jauge restent au max) ; un avertissement le dit au montage, et à chaque changement
// des bornes qui les laisse inversées. Des bornes dans l'ordre, ou une seule borne donnée au nombre, ne disent rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $max = 5',
  '</script>',
  '<@@number class="n" min="10" max={$max} value="7"></@@number>',
  '<@@knob class="k" min="80" max="20"></@@knob>',
  '<@@gauge class="g" min="9" max="3"></@@gauge>',
  '<@@gauge class="seul" min="20"></@@gauge>',
  '<@@number class="ok" min="0" max="10"></@@number>',
  '<@@number class="bas" min="3"></@@number>',
  '<@@knob class="okk" min="0" max="100"></@@knob>',
  '<button class="large" @click={$max = 50}>large</button>',
  '<button class="etroit" @click={$max = 2}>étroit</button>',
].join('\n')

// comme l'aide des modules cœur, mais les avertissements aussi sont relevés
async function monter(): Promise<{ window: any, hote: any, notes: string[] }> {
  const root   = mjsTmp('bornes-inversees')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__notes = [];\nµ.error = µ.warn = function(...a) { globalThis.__notes.push(a.map(String).join(' ')); };`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow?.querySelector('.okk')?._shadow?.querySelector('.knob'))
  await pause(120)
  return { window, hote, notes: window.eval('globalThis.__notes') }
}

describe('mjs-core number, knob, gauge — min plus grand que max', function () {
  this.timeout(60000)
  let window: any
  let hote: any
  let notes: string[]
  before(async () => { ({ window, hote, notes } = await monter()) })
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const bornes = () => notes.filter((n) => /est plus grand que max/.test(n))
  const clic   = async (c: string) => {
    hote._shadow.querySelector('.' + c).click()
    await pause(80)
  }

  it('au montage : un avertissement par module aux bornes inversées, qui nomme le module et ses bornes ; rien pour des bornes dans l\'ordre', () => {
    const vus = bornes()
    assert.equal(vus.length, 4, notes.join(' | '))
    assert.ok(vus.some((n) => n.includes('<@@number>') && n.includes('min « 10 »') && n.includes('max « 5 »')), vus.join(' | '))
    assert.ok(vus.some((n) => n.includes('<@@knob>') && n.includes('min « 80 »') && n.includes('max « 20 »')), vus.join(' | '))
    assert.ok(vus.some((n) => n.includes('<@@gauge>') && n.includes('min « 9 »') && n.includes('max « 3 »')), vus.join(' | '))
    assert.ok(vus.some((n) => n.includes('<@@gauge>') && n.includes('min « 20 »') && n.includes('max « 10 »')), 'le max par défaut de la jauge compte : ' + vus.join(' | '))
    assert.ok(vus.every((n) => /Écrivez un min plus petit que max\./.test(n)), 'le texte dit quoi faire, au vouvoiement')
  })

  it('au changement : des bornes remises dans l\'ordre ne disent rien, inversées à nouveau elles le redisent', async () => {
    const avant = bornes().length
    await clic('large')
    assert.equal(bornes().length, avant, 'max 50 : bornes dans l\'ordre, rien de plus')
    await clic('etroit')
    assert.equal(bornes().length, avant + 1, 'max 2 : un avertissement de plus')
    assert.ok(bornes()[avant].includes('<@@number>') && bornes()[avant].includes('max « 2 »'), bornes()[avant])
  })
})
