// µ.smooth : le retard d'affichage s'écrit `delay` (en ms, 100 par défaut), et seulement ainsi : l'ancien nom français `retard`
// n'est plus lu (le défaut s'applique), et ne prend jamais la place de `delay` quand les deux sont écrits
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const runtimeSrc = readFileSync(join(__dirname, '../src/runtime/mjs_smooth.ts'), 'utf8')

// position affichée à 150 ms d'une entité passée de x = 0 (à 0 ms) à x = 10 (à 100 ms) : 5 avec un retard de 100 ms, 10 sans retard
function shownAt150(opts: Record<string, unknown>): number {
  let task: any = null
  const µ: any = {
    state: (init: any) => Object.assign({}, init),
    Ticker: { _mjs_tasks: new Set<any>(), add: (t: any) => { task = t; µ.Ticker._mjs_tasks.add(t) } },
  }
  new Function('µ', runtimeSrc)(µ)
  const source: any = { a: { x: 0 } }
  const out = µ.smooth(source, opts)
  task._mjs_step(0)
  source.a = { x: 10 }
  task._mjs_step(100)
  task._mjs_step(150)
  return out.a.x
}

describe('µ.smooth — `delay`, seul nom du retard', () => {
  it('`delay` règle le retard', () => {
    assert.equal(shownAt150({ delay: 0 }), 10)
    assert.equal(shownAt150({ delay: 100 }), 5)
  })

  it('sans `delay` : 100 ms', () => {
    assert.equal(shownAt150({}), 5)
  })

  it('`retard` n\'agit plus : le défaut s\'applique', () => {
    assert.equal(shownAt150({ retard: 0 }), 5)
  })

  it('`delay` et `retard` écrits ensemble : `delay` seul compte', () => {
    assert.equal(shownAt150({ delay: 100, retard: 0 }), 5)
    assert.equal(shownAt150({ delay: 0, retard: 100 }), 10)
  })
})
