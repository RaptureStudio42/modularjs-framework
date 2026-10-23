// Un réglage qui nomme un effet par une variable (`*delta(fx: $effet)`) : tant que l'effet nommé ne
// change pas, l'effet qui le porte n'est pas relancé — changer un autre réglage (`up: $vert`, une
// couleur) met sa variable CSS à jour sur place, comme pour tout effet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'delta-nomme': "<script>\n$e = '*scramble'\n$v = '#00ff00'\n</script>\n<b class=\"d\" *delta(fx: $e, up: $v)>12</b>\n<button class=\"vert\" @click={$v = '#008800'}>v</button>\n<button class=\"autre\" @click={$e = '*count'}>e</button>",
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('réglage qui nomme un effet par une variable : pas de relance quand il ne change pas', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effet-nomme-sans-relance')
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

  it('*delta(fx: $e, up: $v) : $v change — même effet, couleur à jour ; $e change — relancé', async () => {
    window.document.body.innerHTML = '<mjs-delta-nomme></mjs-delta-nomme>'
    const comp = window.document.querySelector('mjs-delta-nomme')
    await attendre(() => !!comp._shadow?.querySelector('.d')?._mjs_fxOff?.delta)
    const d     = comp._shadow.querySelector('.d')
    const avant = d._mjs_fxOff.delta
    comp._shadow.querySelector('.vert').click()
    await attendre(() => d.style.getPropertyValue('--mjs-delta-up') === '#008800')
    assert.equal(d.style.getPropertyValue('--mjs-delta-up'), '#008800')
    assert.equal(d._mjs_fxOff.delta === avant, true, 'relancé alors que l\'effet nommé n\'a pas changé')
    comp._shadow.querySelector('.autre').click()
    await attendre(() => d._mjs_fxOff?.delta !== avant)
    assert.equal(d._mjs_fxOff.delta !== avant, true, 'l\'effet nommé a changé : relancé')
  })
})
