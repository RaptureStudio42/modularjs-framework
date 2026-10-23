// Effets — sur `<@document>` : les effets de toute la page (`*ripple`, `*lang`, `*cursors`)
// s'y posent et agissent dans toute la page (un calque fixe dans le document), posés au réveil du composant, retirés à sa
// destruction ; tout autre effet, ou une valeur tenue par une variable, y est refusé à la
// compilation, avec la raison.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

async function construire(nom: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { stats, outDir }
}

describe('effets — sur <@document>', function () {
  this.timeout(60000)
  let window: any
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('*ripple : posé sur la racine du document, un calque fixe dans la page, tout part avec le composant', async () => {
    const { stats, outDir } = await construire('effets-document', {
      'fx-page.mjs': '<@document *ripple(#f00, size: 60)></@document>\n<p class="p">page</p>',
    })
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    const doc = window.document
    doc.body.innerHTML = '<mjs-fx-page></mjs-fx-page>'
    const comp = doc.querySelector('mjs-fx-page')
    await attendre(() => !!comp._shadow?.querySelector('.p') && !!doc.querySelector('[mjs-fx-layer="ripple-page"]'))
    const marque = (doc.documentElement.getAttribute('mjs-fx') ?? '').split(' ')
    assert.ok(marque.includes('ripple'), marque.join(' '))
    const calque = doc.querySelector('[mjs-fx-layer="ripple-page"]')
    assert.ok(calque, 'le calque des anneaux')
    assert.equal(calque.style.getPropertyValue('--mjs-fx-ripple-size'), '60px', 'size : 60')
    doc.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 30, clientY: 40, bubbles: true }))
    const anneau = doc.querySelector('[mjs-fx-layer="ripple-page"] [mjs-fx-ring]')
    assert.ok(anneau, 'un anneau au point cliqué')
    assert.equal(anneau.style.left, '30px')
    doc.body.innerHTML = ''
    await attendre(() => !doc.documentElement.hasAttribute('mjs-fx'))
    assert.equal(doc.documentElement.getAttribute('mjs-fx'), null)
    assertAbsent(doc.querySelector('[mjs-fx-layer="ripple-page"]'), 'le calque des anneaux est retiré')
  })

  it('deux composants posent *ripple sur <@document> : le premier posé l\'emporte, l\'effet reste tant qu\'un des deux est affiché', async () => {
    const { stats, outDir } = await construire('effets-document-partage', {
      'fx-page-a.mjs': '<@document *ripple(#f00, size: 60)></@document>\n<p class="a">a</p>',
      'fx-page-b.mjs': '<@document *ripple(#00f, size: 90)></@document>\n<p class="b">b</p>',
    })
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const w = new Window({ url: 'http://localhost/' })
    w.eval(`${code}\nglobalThis.µ = µ;`)
    const doc = w.document
    doc.body.innerHTML = '<mjs-fx-page-a></mjs-fx-page-a><mjs-fx-page-b></mjs-fx-page-b>'
    await attendre(() => !!doc.querySelector('mjs-fx-page-b')?._shadow?.querySelector('.b') && !!doc.querySelector('[mjs-fx-layer="ripple-page"]'))
    assert.equal(doc.querySelectorAll('[mjs-fx-layer="ripple-page"]').length, 1, 'un seul calque')
    assert.equal(doc.querySelector('[mjs-fx-layer="ripple-page"]').style.getPropertyValue('--mjs-fx-ripple-size'), '60px', 'le premier posé : size 60')
    doc.querySelector('mjs-fx-page-b').remove()
    await new Promise((r) => setTimeout(r, 50))
    assert.ok((doc.documentElement.getAttribute('mjs-fx') ?? '').split(' ').includes('ripple'), 'le départ de B ne retire pas l\'onde de A')
    assert.ok(doc.querySelector('[mjs-fx-layer="ripple-page"]'), 'le calque de A est toujours là')
    doc.querySelector('mjs-fx-page-a').remove()
    await attendre(() => !doc.documentElement.hasAttribute('mjs-fx'))
    assert.equal(doc.documentElement.getAttribute('mjs-fx'), null, 'le dernier parti, l\'onde s\'en va')
    w.close()
  })

  it('*lang et *cursors : des effets de toute la page, eux aussi sur <@document>', async () => {
    const { stats } = await construire('effets-document-page', {
      'fx-page2.mjs': '<script>\n  @sock = µsocket \'wss://x.fr/ws\'\n</script>\n<@document *lang(type) *cursors(cursor: normal, selection: false)></@document>\n<p class="p">page</p>',
    })
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  })

  it('refusé à la compilation : un effet qui n\'est pas de souris, une variable, un effet sur <@window>', async () => {
    const cas: Array<[string, RegExp]> = [
      ['<@document *neon></@document>', /\*neon ne se pose pas sur <@document>[\s\S]*\*ripple/],
      ['<script>\n$s = "#f00"\n</script>\n<@document *ripple($s)></@document>', /\*ripple sur <@document> : une valeur fixe/],
      ['<@window *ripple></@window>', /\*ripple ne se pose pas sur <@window>/],
      ['<@document *ripple(on: sparks)></@document>', /\*ripple : on = sparks/],
    ]
    for (const [src, attendu] of cas) {
      const { stats } = await construire('effets-document-refus', { 'fx-refus.mjs': src + '\n<p>x</p>' })
      const msgs = stats.errors.map((e: any) => e.message).join('\n')
      assert.match(msgs, attendu, src)
    }
  })
})
