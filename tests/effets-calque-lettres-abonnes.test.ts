// Calque de lettres partagé par plusieurs effets d'une même balise (`<h1 *rainbow *scramble>`) : un
// effet qui s'arrête (retiré, relancé par un réglage) emporte ses abonnés à la reconstruction du
// calque — sinon, tant qu'un autre effet garde le calque, ses anciennes fonctions recolorent ou
// rebrouillent encore les lettres à chaque changement du texte, une de plus à chaque relance.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'lettres': '<h1 class="t" *scramble>Titre</h1>',
}

describe('calque de lettres partagé : un effet arrêté emporte ses abonnés', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('calque-lettres-abonnes')
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

  it('deux effets sur le calque ; le premier s\'arrête, le texte change : seul le second est prévenu', async () => {
    const el = window.document.createElement('h1')
    el.textContent = 'Titre'
    window.document.body.appendChild(el)
    const a = window.µ._mjs_fxLayer(null, el)
    const b = window.µ._mjs_fxLayer(null, el)
    assert.equal(a.layer === b.layer, true, 'un seul calque')
    const vus = { a: 0, b: 0 }
    a.onBuild(() => { vus.a++ })
    b.onBuild(() => { vus.b++ })
    a.off()
    el.firstChild.data = 'Nouveau titre'
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(vus, { a: 0, b: 1 })
    assert.equal(b.text, 'Nouveau titre', 'le texte d\'origine, relu')
    assert.equal(!!el.querySelector('[mjs-fx-layer]'), true, 'le calque reste pour le second')
    b.off()
    assert.equal(!!el.querySelector('[mjs-fx-layer]'), false, 'le dernier parti, le calque aussi')
  })
})
