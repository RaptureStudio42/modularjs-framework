// Liaison enfant → parent `value=!{$x}` : la remontée compare sans conversion. Défaut garanti absent :
// un enfant qui passait de vide à 0 (ou de 0 à vide) changeait chez lui, et la page gardait l'ancienne
// valeur — `'' != 0` est faux pour une comparaison lâche. Garde : NaN remonte aussi.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

describe('liaison de composant value=!{$x} — la remontée de vide à 0', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('de vide à 0, de 0 à vide, de 1 à « 1 » : la page suit', async () => {
    const root   = mjsTmp('liaison-zero')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'enfant.mjs'), '<script>\n$value = \'\'\n@poser = (v) -> $value = v\n</script>\n<p class="v">{JSON.stringify($value)}</p>\n')
    writeFileSync(join(srcDir, 'page.mjs'), '<script>\n$x = \'\'\n</script>\n<@enfant value=!{$x}></@enfant>\n<p class="x">{JSON.stringify($x)}</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const order  = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;')
    window.document.body.innerHTML = '<mjs-page></mjs-page>'
    const page = window.document.querySelector('mjs-page')
    for (let i = 0; i < 100 && !page._shadow?.querySelector('mjs-enfant')?._shadow?.querySelector('.v'); i++) await pause(20)
    await pause(60)
    const child = page._shadow.querySelector('mjs-enfant')
    const read  = () => page._shadow.querySelector('.x').textContent
    const step  = async (v: unknown) => { child.poser(v); await pause(50); return read() }
    assert.equal(await step(5), '5', 'témoin : de vide à 5')
    assert.equal(await step(''), '""', 'témoin : de 5 à vide')
    assert.equal(await step(0), '0', 'de vide à 0')
    assert.equal(await step(''), '""', 'de 0 à vide')
    assert.equal(await step(1), '1', 'à 1')
    assert.equal(await step('1'), '"1"', 'de 1 au texte « 1 »')
    assert.equal(await step(null), 'null', 'à null')
    await step(NaN)
    assert.equal(page._state.x !== page._state.x, true, 'NaN remonte')
  })
})
