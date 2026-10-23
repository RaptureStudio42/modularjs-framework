// Transitions en mode partagé (mjs_easing.ts, `_mjs_anim_mode = 'shared'`) : les transitions identiques partagent un même
// @keyframes, nommé d'après leur empreinte. La courbe y entrait par le texte de sa fonction, le même pour toutes les courbes
// cubic-bezier() : deux transitions qui ne diffèrent que par leur cubic-bezier, jouées ensemble, recevaient les mêmes images
// clés et la seconde jouait la courbe de la première. L'empreinte prend désormais les valeurs de la courbe aux instants des
// images clés : deux courbes différentes ont chacune leurs images clés, deux transitions identiques partagent toujours les leurs.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')

function charger(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${sansEsm(lire('mjs_init.ts'))}\nµ.Ticker = µ.Ticker || { add() {}, _mjs_tasks: new Set() };\n${lire('mjs_easing.ts')}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

const opacite = (t: number): any => ({ opacity: t })

function jouer(document: any, µ: any, courbes: string[]): { noms: string[]; regles: string } {
  const noms = courbes.map((easing) => {
    const el = document.createElement('div')
    document.body.append(el)
    el._mjs_anim_mode = 'shared'
    µ._mjs_runTransition(el, { css: opacite, duration: 400, easing }, 'in')
    return el.style.animation.split(' ')[0]
  })
  return { noms, regles: document.getElementById('_mjs_anim_keyframes').textContent }
}

describe('mjs_easing — mode partagé, une courbe différente donne des images clés différentes', function () {
  it('deux cubic-bezier différents joués ensemble : deux @keyframes, chacun avec sa courbe', function () {
    const { document, µ } = charger()
    const { noms, regles } = jouer(document, µ, ['cubic-bezier(0.9, 0, 1, 0.1)', 'cubic-bezier(0, 0.9, 0.1, 1)'])
    assert.notEqual(noms[0], noms[1])
    assert.equal((regles.match(/@keyframes/g) || []).length, 2)
    const moitie = (nom: string): number => Number((regles.split('@keyframes ' + nom)[1] || '').match(/50\.00% \{ opacity: ([\d.e-]+)/)![1])
    assert.ok(Math.abs(moitie(noms[0]) - µ.easing.bezier(0.9, 0, 1, 0.1)(0.5)) < 0.01, 'la première garde sa courbe')
    assert.ok(Math.abs(moitie(noms[1]) - µ.easing.bezier(0, 0.9, 0.1, 1)(0.5)) < 0.01, 'la seconde joue la sienne')
  })

  it('deux transitions identiques partagent toujours les mêmes images clés', function () {
    const { document, µ } = charger()
    const { noms, regles } = jouer(document, µ, ['cubic-bezier(0.9, 0, 1, 0.1)', 'cubic-bezier(0.9, 0, 1, 0.1)', 'ease-out', 'ease-out'])
    assert.equal(noms[0], noms[1])
    assert.equal(noms[2], noms[3])
    assert.notEqual(noms[0], noms[2])
    assert.equal((regles.match(/@keyframes/g) || []).length, 2)
  })
})
