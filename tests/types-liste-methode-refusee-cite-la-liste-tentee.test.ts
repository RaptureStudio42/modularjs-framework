// Types — une méthode qui change le nombre d'éléments d'une liste typée (push, pop, splice) au-delà de ses bornes est refusée :
// la liste revient à son état d'avant, et le message cite la liste telle que la méthode l'aurait laissée (`["a","b","c"]`
// après `push('b', 'c')`), en français comme en anglais — jamais la liste gardée, qui n'est pas celle qui a été refusée.
// Le gestionnaire de l'appli (`µtypes.onError`) reçoit la même liste dans `e.value`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = [
  '<vars>',
  '  $t  string[] 1..2',
  '</vars>',
  '',
  '<script>',
  "$t = ['a']",
  "@deux = -> $t.push('b', 'c')",
  '@retirer = -> $t.pop()',
  "@inserer = -> $t.splice(0, 0, 'x', 'y')",
  'µtypes.onError (e) ->',
  '  globalThis.__recus?.push(e)',
  '  return',
  '</script>',
  '',
  '<p class="n">{$t.length}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('types — méthode refusée sur une liste typée : le message cite la liste tentée', function () {
  this.timeout(120000)
  let window: any
  const dits: string[] = []

  before(async () => {
    const root   = mjsTmp('types-liste-methode-refusee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste.mjs'), LISTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ; µ._typesMode = 'warn';`)
    window.µ.warn = (...a: any[]) => { dits.push(a.join(' ')) }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter() {
    window.document.body.innerHTML = '<mjs-liste></mjs-liste>'
    const comp = window.document.querySelector('mjs-liste')
    await attendre(() => !!comp._shadow?.querySelector('.n'))
    dits.length = 0
    return comp
  }

  const brut = (comp: any) => [...window.µ._mjs_toRaw(comp._state.t)]

  it('push au-delà du maximum : la liste reste ["a"], le message cite ["a","b","c"]', async () => {
    const comp = await monter()
    comp.deux()
    assert.deepEqual(brut(comp), ['a'])
    assert.ok(dits.some((d) => d.includes('$t refuse ["a","b","c"]')), dits.join('\n'))
    assert.ok(!dits.some((d) => d.includes('$t refuse ["a"]')), dits.join('\n'))
  })

  it('pop en deçà du minimum : la liste reste ["a"], le message cite la liste vide', async () => {
    const comp = await monter()
    comp.retirer()
    assert.deepEqual(brut(comp), ['a'])
    assert.ok(dits.some((d) => d.includes('$t refuse []')), dits.join('\n'))
  })

  it('splice qui ajoute deux éléments : le message cite ["x","y","a"]', async () => {
    const comp = await monter()
    comp.inserer()
    assert.deepEqual(brut(comp), ['a'])
    assert.ok(dits.some((d) => d.includes('$t refuse ["x","y","a"]')), dits.join('\n'))
  })

  it('en anglais : le même texte cite la liste tentée', async () => {
    const comp = await monter()
    const avant = window.µ._runtimeLabels
    window.µ._runtimeLabels = { en: (RUNTIME_LABELS as any).en }
    try {
      comp.deux()
    }
    finally {
      window.µ._runtimeLabels = avant
    }
    assert.deepEqual(brut(comp), ['a'])
    assert.ok(dits.some((d) => d.includes('$t refuses ["a","b","c"]')), dits.join('\n'))
  })

  it('le gestionnaire de l\'appli reçoit la liste tentée dans e.value, la liste gardée reste ["a"]', async () => {
    const comp = await monter()
    const recus: any[] = window.__recus = []
    try {
      comp.deux()
    }
    finally {
      window.__recus = undefined
    }
    assert.equal(recus.length, 1)
    assert.deepEqual([...recus[0].value], ['a', 'b', 'c'])
    assert.deepEqual(brut(comp), ['a'])
  })
})
