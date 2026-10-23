// {await} qui devient nul saute un nœud déjà DÉTACHÉ de la page : le nettoyage d'une balise peut retirer un frère
// (une bulle, un calque posé à côté d'elle) ; ce frère n'a plus de parent, il n'a plus rien à détruire. La balise
// d'après, elle, est bien détruite. Garde la règle « on saute un nœud seulement quand il n'a plus de parent ».

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const SOURCE = [
  '<script>',
  '$p ?= null',
  '</script>',
  '{await $p}',
  '<p class="a">a</p><p class="b">b</p><p class="c">c</p>',
  '{success v}',
  '<p class="done">{v}</p>',
  '{end}',
  '<div class="ailleurs"></div>',
  '<button class="t" @click={$p = window.__attente}>t</button>',
  '<button class="r" @click={$p = null}>r</button>',
].join('\n')

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('{await} nul — un nœud déjà détaché de la page est sauté', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('await-noeud-detache')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'aw-detache.mjs'), SOURCE)
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

  it('le nettoyage de la première balise retire la deuxième de la page : elle est sautée, la troisième détruite', async () => {
    window.__attente = new Promise(() => {})
    window.document.body.innerHTML = '<mjs-aw-detache></mjs-aw-detache>'
    const comp = window.document.querySelector('mjs-aw-detache')
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    comp._shadow.querySelector('.t').click()
    await attendre(() => !!comp._shadow.querySelector('.a'))
    const b = comp._shadow.querySelector('.b')
    assert.ok(!!b, 'la balise b est affichée pendant l\'attente')
    // le nettoyage de la première balise retire la deuxième de la page, comme un effet qui range son frère
    const origine = comp._mjs_destroyNodeAndChildren
    const detruits: string[] = []
    comp._mjs_destroyNodeAndChildren = function (n: any, ...reste: any[]) {
      detruits.push(n.getAttribute?.('class') ?? '')
      if (n.getAttribute?.('class') === 'a') b.remove()
      return origine.call(this, n, ...reste)
    }
    comp._shadow.querySelector('.r').click()
    await pause(80)
    assert.deepEqual(detruits, ['a', 'c'], 'la balise déjà détachée est sautée, la dernière est détruite')
    assertAbsent(comp._shadow.querySelector('.c'), 'la dernière balise est retirée de la page')
  })
})
