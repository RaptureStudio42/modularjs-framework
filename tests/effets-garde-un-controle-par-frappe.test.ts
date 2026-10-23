// *guard : une frappe, un contrôle. Le routeur d'événements demande au champ s'il retient la frappe
// (valeur hors de la règle), puis l'écouteur du champ la juge : les deux lisent le même contrôle,
// fait une fois pour l'événement.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'garde-frappe': '<vars>\n  $age  int 18..120\n</vars>\n<script>\n$age = 30\n</script>\n<input class="a" aria-label="âge" value=!{$age} *guard(delay: 0)>\n<b class="v">{$age}</b>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*guard : un seul contrôle par frappe', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('garde-frappe')
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

  it('une valeur bonne puis une valeur hors de la règle : un contrôle chacune, et le même verdict qu\'avant', async () => {
    window.document.body.innerHTML = '<mjs-garde-frappe></mjs-garde-frappe>'
    const comp = window.document.querySelector('mjs-garde-frappe')
    await attendre(() => !!comp._shadow?.querySelector('.a[mjs-fx~="guard"]'))
    const a = comp._shadow.querySelector('.a')
    await new Promise((r) => setTimeout(r, 20))
    const µ = window.µ
    const tcheck0 = µ._mjs_tcheck
    let n = 0
    µ._mjs_tcheck = function (r: any, v: any) { n++; return tcheck0(r, v) }
    try {
      a.value = '42'
      a.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
      const bonne = n
      n = 0
      a.value = '7'
      a.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
      const hors = n
      assert.deepEqual({ bonne, hors }, { bonne: 1, hors: 1 })
    }
    finally {
      µ._mjs_tcheck = tcheck0
    }
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(comp._state.age, 42, 'la bonne valeur est passée, la mauvaise retenue')
    assert.equal(a.hasAttribute('mjs-fx-guard-no'), true, 'la mauvaise est signalée')
  })
})
