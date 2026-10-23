// Le calque de lettres (`*stagger`, `*scramble`…) découpe le texte en caractères perçus : un drapeau,
// une famille d'emojis, un emoji à teinte de peau, une lettre suivie de son accent décomposé restent
// UNE lettre, avec `Intl.Segmenter` quand l'environnement l'a. Sans lui, le découpage reste celui de
// toujours, par point de code (un emoji simple n'est jamais coupé en deux).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const DRAPEAU  = '\u{1F1EB}\u{1F1F7}'
const FAMILLE  = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
const TEINTE   = '\u{1F44D}\u{1F3FD}'
const DECOMPOSE = 'é'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('calque de lettres : une lettre par caractère perçu', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-lettres-graphemes')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-lettres.mjs'), `<p class="t" *stagger(on: load)>${DRAPEAU} ${FAMILLE} ${TEINTE} ${DECOMPOSE}cole</p>`)
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

  // le texte découpé dans un calque neuf : les lettres, et le nombre posé sur le calque
  function lettres(txt: string) {
    const calque = window.document.createElement('span')
    window.µ._mjs_fxSplit(calque, txt)
    return { lettres: Array.from(calque.querySelectorAll('[mjs-fx-letter]')).map((l: any) => l.textContent), n: calque.style.getPropertyValue('--n') }
  }

  it('un drapeau, une famille, une teinte de peau, un accent décomposé : une lettre chacun', () => {
    assert.deepEqual(lettres(DRAPEAU).lettres, [DRAPEAU])
    assert.deepEqual(lettres(FAMILLE).lettres, [FAMILLE])
    assert.deepEqual(lettres(TEINTE).lettres, [TEINTE])
    assert.deepEqual(lettres(DECOMPOSE).lettres, [DECOMPOSE])
  })

  it('un texte mêlé : les mots restent des mots, le nombre de lettres est celui des caractères perçus', () => {
    const r = lettres(`Un ${DRAPEAU} ${DECOMPOSE}té`)
    assert.deepEqual(r.lettres, ['U', 'n', DRAPEAU, DECOMPOSE, 't', 'é'])
    assert.equal(r.n, '6')
  })

  it('un texte simple : une lettre par caractère, comme avant', () => {
    assert.deepEqual(lettres('abc déf').lettres, ['a', 'b', 'c', 'd', 'é', 'f'])
  })

  it('dans le calque de *stagger posé sur une balise : 8 caractères perçus, 8 lettres', async () => {
    window.document.body.innerHTML = '<mjs-fx-lettres></mjs-fx-lettres>'
    const comp = window.document.querySelector('mjs-fx-lettres')
    await attendre(() => !!comp._shadow?.querySelector('.t [mjs-fx-letter]'))
    const lettresCalque = Array.from(comp._shadow.querySelectorAll('.t [mjs-fx-letter]')).map((l: any) => l.textContent)
    assert.deepEqual(lettresCalque, [DRAPEAU, FAMILLE, TEINTE, DECOMPOSE, 'c', 'o', 'l', 'e'])
  })

  it('sans Intl.Segmenter : le découpage de toujours, par point de code', () => {
    const avant = window.Intl.Segmenter
    window.Intl.Segmenter = undefined
    try {
      assert.deepEqual(lettres('abc').lettres, ['a', 'b', 'c'])
      assert.equal(lettres(DRAPEAU).lettres.length, 2, 'le drapeau en deux points de code')
      assert.equal(lettres('\u{1F600}').lettres.length, 1, 'un emoji simple reste entier')
    }
    finally {
      window.Intl.Segmenter = avant
    }
  })
})
