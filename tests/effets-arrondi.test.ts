// `radius` — l'arrondi des coins des effets qui dessinent un cadre autour de leur balise (un éclair, une
// garde, des anneaux, un bord, une lueur, une jauge, des cartes empilées, du verre, une ombre) : sans lui,
// celui de la balise ; avec lui, la balise prend cet arrondi tant que l'effet est posé, et le cadre le
// suit. happy-dom ne dessine rien : on lit le style posé sur la balise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

const CADRES = ['flash', 'guard', 'pulse', 'border', 'spotlight', 'gauge', 'stack', 'glass', 'lift']

const COMPOSANTS: Record<string, string> = {
  'fx-arrondi': '<script>\n$r = 12\n$vu = true\n</script>\n{if $vu}<div class="p" *pulse(radius: $r)>a</div>{end}\n<div class="b" *border(radius: 20)>b</div>\n<div class="s" *stack>c</div>\n<button class="plus" @click={$r = 30}>+</button>\n<button class="cache" @click={$vu = false}>x</button>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets — radius, l\'arrondi des cadres', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-arrondi')
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

  it('les effets à cadre acceptent radius (en px) ; sans lui, rien n\'est posé', () => {
    for (const nom of CADRES) {
      assert.equal(parseEffect(nom, 'radius: 8').fixed.radius, 8, nom)
      assert.equal(parseEffect(nom, '').fixed.radius, undefined, nom + ' : pas d\'arrondi par défaut')
    }
    assert.throws(() => parseEffect('pulse', 'radius: 1rem'), /radius/)
  })

  it('la balise prend l\'arrondi ; une variable le change sur place ; retiré, l\'effet rend le sien', async () => {
    window.document.body.innerHTML = '<mjs-fx-arrondi></mjs-fx-arrondi>'
    const comp = window.document.querySelector('mjs-fx-arrondi')
    await attendre(() => !!comp._shadow?.querySelector('.p'))
    const root = comp._shadow
    const p = root.querySelector('.p')
    assert.equal(p.style.borderRadius, '12px')
    assert.equal(root.querySelector('.b').style.borderRadius, '20px')
    assert.equal(root.querySelector('.s').style.borderRadius, '', 'sans radius : l\'arrondi de la balise')
    root.querySelector('.plus').click()
    await attendre(() => p.style.borderRadius === '30px')
    assert.equal(p.style.borderRadius, '30px')
    assert.ok(p.getAttribute('mjs-fx')?.includes('pulse'), 'le même effet, pas reposé')
    root.querySelector('.cache').click()
    await attendre(() => !p.isConnected)
    assert.equal(p.style.borderRadius, '', 'l\'effet retiré : la balise retrouve son arrondi')
  })
})
