// `*cycle(style: type)` (la machine à écrire) et `*circular` (le texte en cercle) découpent leur texte en caractères
// perçus, comme le calque de lettres : un drapeau, un accent décomposé restent UN caractère. La machine à
// écrire ne montre jamais un demi-drapeau en tapant ; chaque caractère du cercle prend sa part du cercle,
// le drapeau en une seule.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const DRAPEAU   = '\u{1F1EB}\u{1F1F7}'
const DECOMPOSE = 'e\u0301'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*cycle (machine à écrire) et *circular : des caractères perçus', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-cycle-circular-graphemes')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-frappe-percus.mjs'), `<span class="t" *cycle(style: type, speed: 300ms, delay: 0ms)>${DRAPEAU}${DECOMPOSE}x</span>`)
    writeFileSync(join(srcDir, 'fx-cercle-percus.mjs'), `<p class="c" *circular(on: load)>${DRAPEAU} ${DECOMPOSE}</p>`)
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

  it('*circular : un drapeau, une espace, un accent décomposé = trois caractères, trois parts du cercle', async () => {
    window.document.body.innerHTML = '<mjs-fx-cercle-percus></mjs-fx-cercle-percus>'
    const comp = window.document.querySelector('mjs-fx-cercle-percus')
    await attendre(() => !!comp._shadow?.querySelector('.c [mjs-fx-letter]'))
    const calque  = comp._shadow.querySelector('.c [mjs-fx-layer="text"]')
    const lettres = Array.from(calque.querySelectorAll('[mjs-fx-letter]')).map((l: any) => l.textContent)
    assert.deepEqual(lettres, [DRAPEAU, ' ', DECOMPOSE])
    assert.equal(calque.style.getPropertyValue('--n'), '3', 'le cercle compte trois parts')
  })

  it('*cycle(style: type) : à chaque instant le texte tapé est fait de caractères entiers (jamais un demi-drapeau)', async () => {
    // une horloge à la main : le mot dure 300 ms, la frappe les 45 % premiers (135 ms)
    let faux = 0
    const dateAvant = window.Date.now
    window.Date.now = () => faux
    try {
      window.document.body.innerHTML = '<mjs-fx-frappe-percus></mjs-fx-frappe-percus>'
      const comp = window.document.querySelector('mjs-fx-frappe-percus')
      await attendre(() => !!comp._shadow?.querySelector('.t [mjs-fx-cycle-word]'))
      const tape = () => comp._shadow.querySelector('.t [mjs-fx-cycle-word]').textContent
      // trois caractères perçus (le drapeau, le e accentué, x) : le k-ième est tapé dès que la frappe dépasse 45 ms × (k - 1)
      const attendu: Record<number, string> = { 10: DRAPEAU, 30: DRAPEAU, 50: DRAPEAU + DECOMPOSE, 75: DRAPEAU + DECOMPOSE, 100: DRAPEAU + DECOMPOSE + 'x', 125: DRAPEAU + DECOMPOSE + 'x' }
      for (const ms of Object.keys(attendu).map(Number)) {
        faux = ms
        await new Promise((r) => setTimeout(r, 70))
        assert.equal(tape(), attendu[ms], `à ${ms} ms de frappe : ${Array.from(tape()).length} points de code`)
      }
    }
    finally {
      window.Date.now = dateAvant
    }
  })
})
