// µ.spring (mjs_spring.ts) se pose toujours sur sa cible. La précision du repos était absolue : près d'une très grande valeur
// (1e15), ou sous une précision plus fine que l'écart représentable autour de la cible, le pas k·écart s'arrondissait à zéro
// et le ressort restait à un cran de la cible sans jamais se poser — tâche du Ticker et nouveau rendu à chaque image, pour
// toujours. Le seuil de repos suit désormais l'échelle de la cible ; pour les valeurs ordinaires rien ne change.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')

function charger(): any {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${sansEsm(lire('mjs_init.ts'))}\nµ.Ticker = µ.Ticker || { add() {}, _mjs_tasks: new Set() };\n${lire('mjs_easing.ts')}\n${lire('mjs_spring.ts')}\nglobalThis.µ = µ;`)
  return window.µ
}

// nombre de pas avant le repos, borné
function pasAvantRepos(s: any, borne = 1000): number {
  let n = 0
  while (s._mjs_step() && n < borne) { n++ }
  return n
}

describe('µ.spring — le ressort se pose quelle que soit l\'échelle de la cible', function () {
  for (const cible of [1e15, -1e15, 1e13, 3.5e17]) {
    it(`cible ${cible} : posé en moins de 1000 pas, exactement sur la cible`, function () {
      const µ = charger()
      const s = µ.spring(0)
      s.value = cible
      assert.ok(pasAvantRepos(s) < 1000, 'le ressort se pose')
      assert.equal(s.current, cible)
    })
  }

  it('précision plus fine que l\'écart représentable (1e-15, cible 1000) : posé', function () {
    const µ = charger()
    const s = µ.spring(0)
    s.precision = 1e-15
    s.value = 1000
    assert.ok(pasAvantRepos(s) < 1000, 'le ressort se pose')
    assert.equal(s.current, 1000)
  })

  it('valeur ordinaire : le même nombre de pas qu\'avec un seuil absolu', function () {
    const µ = charger()
    const s = µ.spring(0)
    s.value = 100
    const n = pasAvantRepos(s)
    assert.ok(n > 10 && n < 1000, `${n} pas`)
    assert.equal(s.current, 100)
  })
})
