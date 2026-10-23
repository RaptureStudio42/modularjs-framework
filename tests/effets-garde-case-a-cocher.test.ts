// *guard sur une case à cocher : un choix refusé par la règle de la variable rend la dernière bonne
// valeur — l'état coché de la case, pas sa valeur (« on »), qui ne change rien à l'écran.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'garde-case': '<vars>\n  $accord  true\n</vars>\n<script>\n$accord = true\n</script>\n<input class="c" type="checkbox" aria-label="accord" checked=!{$accord} *guard(silent: true)>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*guard sur une case à cocher : le refus rend l\'état coché', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('garde-case')
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

  it('décochée alors que la règle ne permet que « true » : la case redevient cochée', async () => {
    window.document.body.innerHTML = '<mjs-garde-case></mjs-garde-case>'
    const comp = window.document.querySelector('mjs-garde-case')
    await attendre(() => !!comp._shadow?.querySelector('.c[mjs-fx~="guard"]'))
    const c = comp._shadow.querySelector('.c')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(c.checked, true, 'cochée au départ')
    c.checked = false
    c.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
    c.dispatchEvent(new window.Event('change', { bubbles: true, composed: true }))
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(c.checked, true, 'le refus rend l\'état coché')
    assert.equal(comp._state.accord, true)
  })
})
