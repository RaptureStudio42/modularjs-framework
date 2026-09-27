// `$[k] = v` (clé DYNAMIQUE dans l'état top-level, syntaxe crochet) : le générateur ne
// distinguait pas `$[k]` (accès COMPUTED) de `$.k` (accès fixe) — les deux compilaient
// vers `µ._set(_mjsThis, 'k', v)`, la variable `k` étant lue comme un NOM LITTÉRAL au lieu
// d'être évaluée à l'exécution. `$obj[k] = v` (état PROFOND), lui, était déjà correct
// (path-tracker.ts sait depuis longtemps lire une clé calculée). Même défaut pour la forme
// composée (`$[k] += v`) et `++`/`--` (`$[k]++`) — `delete $[k]`, déjà orienté vers
// `µ._mjs_deepDelete`, était déjà correct.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const DOLLAR_KEY = [
  '<script>',
  '$a = 1',
  '$b = 2',
  'setField = (k, v) -> $[k] = v',
  'incrField = (k) -> $[k]++',
  'addField = (k, v) -> $[k] += v',
  'delField = (k) -> delete $[k]',
  '</script>',
  '<button class="setA" @click={setField("a", 99)}>setA</button>',
  '<button class="incrA" @click={incrField("a")}>incrA</button>',
  '<button class="addB" @click={addField("b", 10)}>addB</button>',
  '<button class="delA" @click={delField("a")}>delA</button>',
  '<p>{$a} {$b}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('cle-dynamique')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'dollar-key.mjs'), DOLLAR_KEY)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('$[k] = v — clé dynamique dans l\'état top-level', function () {
  this.timeout(60000)

  let root: string
  let app: any

  before(async () => {
    root = projetTemporaire()
    app  = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('$[k] = v écrit la clé DÉSIGNÉE PAR k, pas une variable nommée "k"', async () => {
    const c = await app.mount('dollar-key')
    try {
      await c.click('.setA')
      assert.equal(c.state.a, 99, 'la clé réellement désignée par k ("a") doit avoir changé')
      assert.equal((c.state as any).k, undefined, 'aucune clé littérale "k" ne doit avoir été créée')
    } finally {
      c.destroy()
    }
  })

  it('$[k]++ incrémente la clé désignée par k', async () => {
    const c = await app.mount('dollar-key')
    try {
      await c.click('.incrA')
      assert.equal(c.state.a, 2)
    } finally {
      c.destroy()
    }
  })

  it('$[k] += v ajoute à la clé désignée par k', async () => {
    const c = await app.mount('dollar-key')
    try {
      await c.click('.addB')
      assert.equal(c.state.b, 12)
    } finally {
      c.destroy()
    }
  })

  it('delete $[k] retire bien la clé désignée par k (déjà correct, non régressé)', async () => {
    const c = await app.mount('dollar-key')
    try {
      await c.click('.delA')
      assert.equal('a' in c.state, false)
    } finally {
      c.destroy()
    }
  })
})
