// Transitions en mode partagé (mjs_easing.ts, `_mjs_anim_mode = 'shared'`) : le nom du @keyframes partagé venait d'une
// empreinte qui ne lisait le `css` de la transition qu'à mi-course (t = 0,5). Deux transitions dont le `css` ne diffère
// qu'ailleurs — une entrée par la gauche (`t`) et une par la droite (`u`), même durée et même courbe — recevaient le même
// @keyframes, et la seconde jouait le sens de la première. L'empreinte est désormais celle des images clés elles-mêmes :
// des images clés différentes ont chacune leur @keyframes, des images clés identiques partagent toujours le même.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')

function charger(): { document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${sansEsm(lire('mjs_init.ts'))}\nµ.Ticker = µ.Ticker || { add() {}, _mjs_tasks: new Set() };\n${lire('mjs_easing.ts')}\nglobalThis.µ = µ;`)
  return { document: window.document, µ: window.µ }
}

const parLaGauche = (t: number): any => ({ transform: 'translateX(' + (t * 100) + 'px)' })
const parLaDroite = (t: number, u: number): any => ({ transform: 'translateX(' + (u * 100) + 'px)' })

function jouer(document: any, µ: any, css: Array<(t: number, u: number) => any>): { noms: string[]; regles: string } {
  const noms = css.map((f) => {
    const el = document.createElement('div')
    document.body.append(el)
    el._mjs_anim_mode = 'shared'
    µ._mjs_runTransition(el, { css: f, duration: 400, easing: 'linear' }, 'in')
    return el.style.animation.split(' ')[0]
  })
  return { noms, regles: document.getElementById('_mjs_anim_keyframes').textContent }
}

// première image clé d'un @keyframes nommé
const debut = (regles: string, nom: string): string => ((regles.split('@keyframes ' + nom)[1] || '').match(/0\.00% \{ ([^}]*)\}/) || [])[1] || ''

describe('mjs_easing — mode partagé, l\'empreinte est celle des images clés', function () {
  it('entrée par la gauche et entrée par la droite, même valeur à mi-course : deux @keyframes, chacun son sens', function () {
    const { document, µ } = charger()
    const { noms, regles } = jouer(document, µ, [parLaGauche, parLaDroite])
    assert.notEqual(noms[0], noms[1])
    assert.equal((regles.match(/@keyframes/g) || []).length, 2)
    assert.match(debut(regles, noms[0]), /translateX\(0px\)/, 'la première part de la gauche')
    assert.match(debut(regles, noms[1]), /translateX\(100px\)/, 'la seconde part de la droite')
  })

  it('des images clés identiques partagent toujours le même @keyframes', function () {
    const { document, µ } = charger()
    const { noms, regles } = jouer(document, µ, [parLaGauche, parLaGauche, parLaDroite, parLaDroite])
    assert.equal(noms[0], noms[1])
    assert.equal(noms[2], noms[3])
    assert.notEqual(noms[0], noms[2])
    assert.equal((regles.match(/@keyframes/g) || []).length, 2)
  })
})
