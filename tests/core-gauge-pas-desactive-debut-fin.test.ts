// module cœur gauge (<@@gauge>) : un pas négatif ou nul retombe sur le pas par défaut, avec un avertissement (step="-1" inversait les
// commandes, step="0" les rendait muettes) ; `disabled` la désactive comme un champ natif — clavier, boutons et molette inertes, rien
// dans le formulaire ; Début et Fin mènent au min et au max.

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
  '  $chg = 0',
  '  $b = 5',
  '</script>',
  '<form class="f">',
  '  <@@gauge class="moins" value="5" step="-1"></@@gauge>',
  '  <@@gauge class="nul" value="5" step="0"></@@gauge>',
  '  <@@gauge class="off" name="g" value="3" disabled wheel @change={$chg++}></@@gauge>',
  '  <@@gauge class="bornes" value=!{$b} min="2" max="9" @change={$chg++}></@@gauge>',
  '</form>',
  '<p class="chg">{$chg}</p><p class="b">{$b}</p>',
].join('\n')

// comme l'aide des modules cœur, mais les avertissements aussi sont relevés : celui du pas part au premier rendu
async function monter(): Promise<{ window: any, hote: any, notes: string[] }> {
  const root   = mjsTmp('gauge-pas')
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
  await attendre(() => !!hote._shadow?.querySelector('.bornes')?._shadow?.querySelector('.spinner'))
  await pause(120)
  return { window, hote, notes: window.eval('globalThis.__notes') }
}

describe('mjs-core-gauge — pas, désactivée, Début et Fin', function () {
  this.timeout(60000)
  let window: any
  let hote: any
  let notes: string[]
  before(async () => { ({ window, hote, notes } = await monter()) })
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const jauge   = (sel: string) => hote._shadow.querySelector(sel)
  const spinner = (sel: string) => jauge(sel)._shadow.querySelector('.spinner')
  const touche  = async (sel: string, key: string) => {
    spinner(sel).dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    spinner(sel).dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }))
    await pause(40)
  }

  it('step="-1" et step="0" : la flèche haute monte d\'un pas par défaut, et un avertissement nomme le pas', async () => {
    await touche('.moins', 'ArrowUp')
    await touche('.nul', 'ArrowUp')
    assert.equal(jauge('.moins')._state.value, 6)
    assert.equal(jauge('.nul')._state.value, 6)
    const pas = notes.filter((n) => n.includes('<@@gauge>'))
    assert.equal(pas.length, 2, notes.join(' | '))
    assert.match(pas[0], /« -1 »/)
    assert.match(pas[1], /« 0 »/)
  })

  it('disabled : clavier, boutons et molette ne bougent rien, aucun `change`, rien dans le formulaire', async () => {
    await touche('.off', 'ArrowUp')
    for (const b of jauge('.off')._shadow.querySelectorAll('.btn')) b.click()
    const cran = new window.Event('wheel', { bubbles: true, cancelable: true })
    cran.deltaY    = -100
    cran.deltaMode = 0
    jauge('.off')._shadow.querySelector('.box').dispatchEvent(cran)
    await pause(320)
    assert.equal(Number(jauge('.off')._state.value), 3)
    assert.equal(hote._shadow.querySelector('.chg').textContent, '0')
    assert.deepEqual([...new window.FormData(hote._shadow.querySelector('.f')).entries()].filter((e: any) => e[0] === 'g'), [])
    assert.equal(spinner('.off').getAttribute('aria-disabled'), 'true')
    assert.deepEqual([...jauge('.off')._shadow.querySelectorAll('.btn')].map((b: any) => b.disabled), [true, true])
  })

  it('Début et Fin : le min et le max, un `change` chacun', async () => {
    await touche('.bornes', 'Home')
    assert.equal(hote._shadow.querySelector('.b').textContent, '2')
    await touche('.bornes', 'End')
    assert.equal(hote._shadow.querySelector('.b').textContent, '9')
    assert.equal(hote._shadow.querySelector('.chg').textContent, '2')
  })
})
