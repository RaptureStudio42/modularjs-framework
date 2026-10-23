// L'inspecteur d'objets (panneau de développement) plafonne un conteneur déplié à 200 entrées et dit combien il en
// reste. Défaut garanti absent : pour compter ce reste, il parcourait TOUS les éléments d'un tableau, d'une Map ou
// d'un Set, à chaque redessin du panneau (toutes les 700 ms) — un tableau de 10⁷ éléments coûtait 10⁷ tours à chaque
// battement. Le reste se compte maintenant par la taille (`length`, `size`).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function compilerCore() {
  const root   = mjsTmp('devinspect-plafond')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'dip-neutre.mjs'), '<script>\n$x ?= 1\n</script>\n<p>{$x}</p>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const core = readFileSync(join(outDir, readdirSync(outDir).find(f => /^mjs_core-/.test(f))!), 'utf-8')
  await bundler.close()
  return core
}

// compte chaque élément produit par toutes les voies de parcours d'une Map ou d'un Set
function compter(c: any) {
  const vu = { n: 0 }
  const forEach = c.forEach, entries = c.entries, values = c.values, keys = c.keys
  const suivre = (it: any) => ({ next() { const r = it.next(); if (!r.done) vu.n++; return r }, [Symbol.iterator]() { return this } })
  c.forEach = function (f: any, t: any) { return forEach.call(this, function (this: any, ...a: any[]) { vu.n++; return f.apply(this, a) }, t) }
  c.entries = function () { return suivre(entries.call(this)) }
  c.values = function () { return suivre(values.call(this)) }
  c.keys = function () { return suivre(keys.call(this)) }
  c[Symbol.iterator] = c instanceof Map ? c.entries : c.values
  return vu
}

describe('mjs_devinspect — le plafond de 200 entrées compte le reste sans tout parcourir', function () {
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
    window.µ._mjs_diRender(hote, valeur, { ns: 'plafond-' + Math.random() })
    const reste = hote.querySelector('.di-reste')
    return { lignes: hote.querySelectorAll('.di-ligne').length, reste: reste ? reste.textContent : '' }
  }

  it('une Map de 50 000 entrées : 200 lues, « et 49800 de plus »', () => {
    const m = new window.Map()
    for (let i = 0; i < 50000; i++) m.set('k' + i, i)
    const vu = compter(m)
    const r = deplier(m)
    assert.match(r.reste, /49800/)
    assert.ok(vu.n <= 201, `entrées parcourues : ${vu.n}`)
  })

  it('un Set de 50 000 éléments : 200 lus, « et 49800 de plus »', () => {
    const s = new window.Set()
    for (let i = 0; i < 50000; i++) s.add(i)
    const vu = compter(s)
    const r = deplier(s)
    assert.match(r.reste, /49800/)
    assert.ok(vu.n <= 201, `éléments parcourus : ${vu.n}`)
  })

  it('un tableau de 2²⁷ cases : déplié sans tour par case', () => {
    const a = new window.Array()
    a.length = 2 ** 27
    a[0] = 'premier'
    const t = Date.now()
    const r = deplier(a)
    const ms = Date.now() - t
    assert.match(r.reste, new RegExp(String(2 ** 27 - 200)))
    assert.ok(ms < 1000, `dépliage en ${ms} ms`)
  })
})
