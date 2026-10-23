// µ.spring (mjs_spring.ts) : un ressort raide et peu amorti (raideur 2 et plus, amortissement 0,05 et moins, réglages permis)
// entrait, près d'une grande cible (1e15) ou sous une précision très fine, dans un cycle à l'échelle de l'arrondi : la
// position oscillait de quelques dizaines de crans autour de la cible sans jamais se poser — tâche du Ticker et nouveau rendu
// à chaque image, pour toujours. Le seuil de repos couvre désormais ce cycle (une petite part de la cible, bien en dessous de
// tout ce qui se voit) ; pour une valeur ordinaire et la précision par défaut, le mouvement ne change pas d'un pas.

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

const BORNE = 300000

function pasAvantRepos(s: any): number {
  let n = 0
  while (s._mjs_step() && n < BORNE) { n++ }
  return n
}

describe('µ.spring — ressort raide et peu amorti : il se pose', function () {
  this.timeout(60000)

  for (const [k, a] of [[3.9, 0.01], [3.5, 0.05], [2, 0.01], [3.97, 0.01], [1.99, 1]]) {
    for (const [cible, precision] of [[1e15, 0.01], [1000, 1e-15], [123456.789, 1e-12]]) {
      it(`raideur ${k}, amortissement ${a}, cible ${cible}, précision ${precision} : posé exactement sur la cible`, function () {
        const µ = charger()
        const s = µ.spring(0, k, a)
        s.precision = precision
        s.value = cible
        const n = pasAvantRepos(s)
        assert.ok(n < BORNE, `toujours en mouvement après ${BORNE} pas, écart ${cible - s.current}`)
        assert.equal(s.current, cible)
        assert.equal(s.velocity, 0)
      })
    }
  }

  // le même calcul écrit à part : vitesse d'abord, position avec la nouvelle vitesse, repos sous la précision demandée
  function trajet(k: number, a: number, depart: number, cible: number, precision: number): number[] {
    const out: number[] = []
    let x = depart
    let v = 0
    for (let n = 0; n < 100000; n++) {
      const nv = v + k * (cible - x) - a * v
      const nx = x + nv
      if (Math.abs(nv) < precision && Math.abs(cible - nx) < precision) { out.push(cible); return out }
      x = nx
      v = nv
      out.push(x)
    }
    return out
  }

  for (const [k, a] of [[0.15, 0.8], [0.3, 0.2], [0.5, 0.1], [1, 0.1], [0.05, 0.5], [3.9, 0.01]]) {
    for (const [depart, cible] of [[0, 100], [250, -40], [0, 1e6], [-3, 0]]) {
      it(`réglages ${k} / ${a}, de ${depart} à ${cible} : chaque pas est celui du calcul à seuil absolu`, function () {
        const µ = charger()
        const s = µ.spring(depart, k, a)
        s.value = cible
        const attendu = trajet(k, a, depart, cible, 0.01)
        const vu: number[] = []
        while (s._mjs_step() && vu.length < 100000) { vu.push(s.current) }
        vu.push(s.current)
        assert.deepEqual(vu, attendu)
      })
    }
  }
})
