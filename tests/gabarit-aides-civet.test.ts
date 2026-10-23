// Une expression de gabarit que Civet compile avec une fonction d'aide — une plage `[1..200]` (au-delà
// de quelques nombres, ou à borne variable : `[1..$n]`), un modulo `%%` — : l'aide reste avec son
// expression. Avant, sa déclaration (`var range = …`) atterrissait au milieu de l'appel du {for} :
// le composant ne compilait plus. Et une variable après deux points (`[1..$n]`, `[...$items]`) est
// bien la variable, pas une propriété : avant, `$n` restait tel quel (ReferenceError au montage).

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

describe('gabarit — les expressions à fonction d\'aide de Civet', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('gabarit-aides-civet')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'plages.mjs'), '<script>\n$n = 3\n$items = [1, 2]\n</script>\n<ul class="a">{for i in [1..200]}<li>{i}</li>{end}</ul>\n<ul class="b">{for i in [1..$n]}<li>{i}</li>{end}</ul>\n<b class="m">{-7 %% 3}</b>\n<b class="s">{[...$items, 4].length}</b>\n<b class="l">{[1..$n].length}</b>\n<button class="k" @click={$n = 5; $items = [1, 2, 3]}>k</button>\n')
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

  it('[1..200], [1..$n] (qui suit $n), -7 %% 3 et [...$items] se rendent', async () => {
    window.document.body.innerHTML = '<mjs-plages></mjs-plages>'
    const comp = window.document.querySelector('mjs-plages')
    await attendre(() => !!comp._shadow?.querySelector('.m'))
    const sh = comp._shadow
    assert.equal(sh.querySelectorAll('.a li').length, 200)
    assert.equal(sh.querySelector('.a li:last-child').textContent, '200')
    assert.deepEqual([...sh.querySelectorAll('.b li')].map((li: any) => li.textContent), ['1', '2', '3'])
    assert.equal(sh.querySelector('.m').textContent, '2')
    assert.equal(sh.querySelector('.s').textContent, '3')
    assert.equal(sh.querySelector('.l').textContent, '3')
    sh.querySelector('.k').click()
    await attendre(() => sh.querySelectorAll('.b li').length === 5)
    assert.equal(sh.querySelectorAll('.b li').length, 5)
    assert.equal(sh.querySelector('.s').textContent, '4')
    assert.equal(sh.querySelector('.l').textContent, '5')
  })
})
