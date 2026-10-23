// Calque de lettres partagé par plusieurs effets d'une même balise (`<h1 *rainbow *scramble>`) : le
// SECOND effet, celui qui trouve le calque déjà posé, a sa propre poignée — en s'arrêtant, il emporte
// ses abonnés à la reconstruction du calque, et le calque reste pour le premier. Sans elle, ses
// anciennes fonctions recoloraient ou rebrouilleraient encore les lettres à chaque changement du texte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

describe('calque de lettres partagé : le second effet arrêté emporte ses abonnés', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('calque-lettres-second-effet')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'lettres.mjs'), '<h1 class="t" *scramble>Titre</h1>')
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

  it('deux effets sur le calque ; le second s\'arrête, le texte change : seul le premier est prévenu, le calque reste', async () => {
    const el = window.document.createElement('h1')
    el.textContent = 'Titre'
    window.document.body.appendChild(el)
    const a = window.µ._mjs_fxLayer(null, el)
    const b = window.µ._mjs_fxLayer(null, el)
    assert.equal(a.layer === b.layer, true, 'un seul calque')
    const vus = { a: 0, b: 0 }
    a.onBuild(() => { vus.a++ })
    b.onBuild(() => { vus.b++ })
    b.off()
    el.firstChild.data = 'Nouveau titre'
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(vus, { a: 1, b: 0 })
    assert.equal(a.text, 'Nouveau titre', 'le texte d\'origine, relu')
    assert.equal(!!el.querySelector('[mjs-fx-layer]'), true, 'le calque reste pour le premier')
    b.off()
    assert.equal(!!el.querySelector('[mjs-fx-layer]'), true, 'une poignée arrêtée deux fois ne compte qu\'une fois')
    a.off()
    assert.equal(!!el.querySelector('[mjs-fx-layer]'), false, 'le dernier parti, le calque aussi')
  })

  it('trois effets ; le deuxième s\'arrête : le premier et le troisième restent prévenus', async () => {
    const el = window.document.createElement('h1')
    el.textContent = 'Titre'
    window.document.body.appendChild(el)
    const mains = [1, 2, 3].map(() => window.µ._mjs_fxLayer(null, el))
    const vus = [0, 0, 0]
    mains.forEach((m: any, i: number) => m.onBuild(() => { vus[i]++ }))
    mains[1].off()
    el.firstChild.data = 'Autre titre'
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(vus, [1, 0, 1])
    mains[0].off()
    mains[2].off()
  })
})
