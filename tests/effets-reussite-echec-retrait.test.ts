// `on: success` / `on: error` : tant qu'un effet attend la fin des actions de sa balise, la balise la
// dit (`el._mjs_fxResult`, appelé par le routeur d'événements sur la promesse d'un gestionnaire). Au
// retrait du dernier effet qui l'attend, elle se tait : plus de `.then` accroché ni d'événement émis
// pour personne.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fin-action': '<button class="b" *shake(on: success)>ok</button>',
}

describe('on: success / error : la balise se tait au retrait du dernier effet qui attendait', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('reussite-echec-retrait')
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

  it('deux attentes sur la même balise : elle parle jusqu\'au retrait de la seconde', () => {
    const el   = window.document.createElement('button')
    const un   = window.µ._mjs_fxOnResult(el, 'success', () => {})
    const deux = window.µ._mjs_fxOnResult(el, 'error', () => {})
    assert.equal(typeof el._mjs_fxResult, 'function')
    un()
    assert.equal(typeof el._mjs_fxResult, 'function', 'une attente reste')
    deux()
    assert.equal(!!el._mjs_fxResult, false, 'plus personne n\'attend')
  })

  it('*shake(on: success) retiré : la balise se tait', () => {
    const el = window.document.createElement('button')
    window.document.body.appendChild(el)
    const off = window.µ._mjs_fx(null, el, 'shake', { on: 'success' })
    assert.equal(typeof el._mjs_fxResult, 'function')
    off()
    assert.equal(!!el._mjs_fxResult, false)
  })
})
