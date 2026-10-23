// *annotate(on: always) — le trait se retrace sans fin : un tracé, la pause `every`, puis il s'efface
// et repart. Sans `on: always`, il se trace une fois et reste. Le retrait de la balise arrête la boucle.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-boucle':         '<p><span class="a" *annotate(box, on: always, every: 60ms, duration: 40ms)>mot</span></p>',
  'fx-boucle-une':     '<p><span class="a" *annotate(box, on: load, duration: 40ms)>mot</span></p>',
  'fx-boucle-retrait': '<script>\n$on = true\n</script>\n{if $on}<p><span class="a" *annotate(on: always, every: 60ms, duration: 40ms)>mot</span></p>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *annotate en boucle', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-annotation-en-boucle')
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

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp
  }

  // le nombre de tracés joués : chaque jeu repose la marque `mjs-fx-play`
  function compter(el: any): () => number {
    let n = 0
    const mo = new window.MutationObserver((ms: any[]) => {
      for (const m of ms) if ((el.getAttribute('mjs-fx-play') ?? '').split(' ').includes('annotate') && !(m.oldValue ?? '').split(' ').includes('annotate')) n++
    })
    mo.observe(el, { attributes: true, attributeFilter: ['mjs-fx-play'], attributeOldValue: true })
    return () => { mo.disconnect(); return n }
  }

  it('on: always — le tracé repart tout seul, après la pause every', async () => {
    const comp = await monter('mjs-fx-boucle')
    const el   = comp._shadow.querySelector('.a')
    assert.ok((el.getAttribute('mjs-fx-play') ?? '').includes('annotate'), 'premier tracé joué')
    const fin = compter(el)
    await pause(450)
    const n = fin()
    assert.ok(n >= 2, `au moins deux nouveaux tracés en 450 ms (tour de 100 ms) : ${n}`)
    assert.ok(n <= 6, `jamais plus d'un tracé par tour : ${n}`)
  })

  it('on: load — un seul tracé, qui reste', async () => {
    const comp = await monter('mjs-fx-boucle-une')
    const el   = comp._shadow.querySelector('.a')
    const fin  = compter(el)
    await pause(300)
    assert.equal(fin(), 0)
    assert.equal(el.getAttribute('mjs-fx-annotate-done'), '', 'tracé fini, gardé')
  })

  it('la balise retirée : la boucle s\'arrête', async () => {
    const comp = await monter('mjs-fx-boucle-retrait')
    const el   = comp._shadow.querySelector('.a')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(30)
    const fin = compter(el)
    await pause(300)
    assert.equal(fin(), 0, 'plus aucun tracé après le retrait')
  })

  it('every et on: always sont acceptés, un déclencheur inconnu est refusé', async () => {
    await compiler('<span *annotate(circle, on: always, every: 2s)>x</span>')
    await assert.rejects(compiler('<span *annotate(on: toujours)>x</span>'), /\*annotate : on = toujours/)
    await assert.rejects(compiler('<span *annotate(every: vite)>x</span>'), /\*annotate : every = vite/)
  })
})
