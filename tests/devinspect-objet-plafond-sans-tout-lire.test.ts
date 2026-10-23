// L'inspecteur d'objets (panneau de développement) plafonne un conteneur déplié à 200 entrées et dit combien il en
// reste. Pour un objet ordinaire, il lisait TOUTES ses valeurs (et fabriquait une entrée par clé) avant d'en garder
// 200, à chaque redessin du panneau (toutes les 700 ms) — un objet de 50 000 clés, lu par son enveloppe réactive,
// coûtait 50 000 lectures à chaque battement. Seules les 200 premières valeurs sont lues désormais ; le reste se
// compte par le nombre de clés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function compilerCore() {
  const root   = mjsTmp('devinspect-objet')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'dio-neutre.mjs'), '<script>\n$x ?= 1\n</script>\n<p>{$x}</p>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const core = readFileSync(join(outDir, readdirSync(outDir).find(f => /^mjs_core-/.test(f))!), 'utf-8')
  await bundler.close()
  return core
}

describe('mjs_devinspect — un objet ordinaire déplié ne lit que les valeurs affichées', function () {
  this.timeout(60000)
  let window: any
  before(async () => {
    const core = await compilerCore()
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${stripEsm(core)}\nglobalThis.µ = µ;`)
  })
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  function deplier(valeur: any) {
    const hote = window.document.createElement('div')
    window.document.body.appendChild(hote)
    window.µ._mjs_diRender(hote, valeur, { ns: 'objet-' + Math.random() })
    const reste = hote.querySelector('.di-reste')
    return { lignes: hote.querySelectorAll('.di-ligne').length, reste: reste ? reste.textContent : '' }
  }

  it('un objet de 50 000 clés : 200 valeurs lues, « et 49800 de plus »', () => {
    const brut: Record<string, number> = {}
    for (let i = 0; i < 50000; i++) brut['k' + i] = i
    let lues = 0
    const suivi = new Proxy(brut, { get(o: any, k: any) { if (typeof k === 'string' && k[0] === 'k') lues++; return o[k] } })
    const r = deplier(suivi)
    assert.match(r.reste, /49800/)
    assert.ok(r.lignes >= 200, `lignes affichées : ${r.lignes}`)
    assert.ok(lues <= 400, `valeurs lues : ${lues}`)
  })

  it('un petit objet reste affiché en entier, clés symboliques comprises', () => {
    const s = window.Symbol('marque')
    const o: any = { a: 1, b: 'deux' }
    o[s] = 3
    const r = deplier(o)
    assert.equal(r.reste, '')
    assert.ok(r.lignes >= 3, `lignes affichées : ${r.lignes}`)
  })
})
