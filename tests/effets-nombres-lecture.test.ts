// *count, *delta : un nombre écrit avec la marque des décimales de l'effet (une virgule, par défaut)
// se lit avec ses séparateurs — ceux qu'il écrit lui-même (milliers : une espace, par défaut).
// « 3,5 » vaut 3,5, pas 35 ; « 1 234,5 » vaut 1 234,5. Un nombre écrit sans séparateur (`12480`,
// `3.5`, `12480.5` même avec `separator: "."`) se lit comme avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'nombre-virgule': '<b class="n" *count(on: load, duration: 0s)>3,5</b>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*count, *delta : le nombre se lit avec les séparateurs de l\'effet', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-nombres')
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

  it('réglages par défaut : « 3,5 » → 3,5 ; « 1 234,5 » → 1 234,5 ; sans séparateur, comme avant', () => {
    const num = window.µ._mjs_fxNum({})
    assert.deepEqual(['3,5', '1 234,5', '1 234,5 €', '12480', '3.5', '-2 €'].map((t) => num.parse(t)), [3.5, 1234.5, 1234.5, 12480, 3.5, -2])
  })

  it('séparateurs à l\'anglaise : « 1,234.5 » → 1 234,5', () => {
    const num = window.µ._mjs_fxNum({ separator: ',', decimal: '.' })
    assert.equal(num.parse('1,234.5'), 1234.5)
  })

  it('milliers en point, décimales en virgule : « 12.480,5 » et la forme brute « 12480.5 » → 12 480,5', () => {
    const num = window.µ._mjs_fxNum({ separator: '.', decimal: ',' })
    assert.deepEqual([num.parse('12.480,5'), num.parse('12480.5')], [12480.5, 12480.5])
  })

  it('*count sur « 3,5 » : le compte finit sur 3,5', async () => {
    window.document.body.innerHTML = '<mjs-nombre-virgule></mjs-nombre-virgule>'
    const comp = window.document.querySelector('mjs-nombre-virgule')
    await attendre(() => !!comp._shadow?.querySelector('.n [mjs-fx-layer]'))
    const calque = comp._shadow.querySelector('.n [mjs-fx-layer]')
    await attendre(() => calque.textContent === '3,5', 1500)
    assert.equal(calque.textContent, '3,5')
  })
})
