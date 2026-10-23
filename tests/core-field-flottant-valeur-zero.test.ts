// module cœur field (<@@field layout="float">) : un nombre, une jauge, un bouton rotatif du cœur n'ont pas de propriété `value` — le
// champ lit leur valeur dans leur état : le libellé flottant monte au-dessus d'elle, zéro compris, au lieu de la couvrir ; une valeur
// vide le laisse couché ; une valeur posée par la page (liaison), sans aucun geste, le fait monter aussi.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $n = 3',
  '  $m = \'\'',
  '</script>',
  '<@@field class="zero" layout="float" label="Quantité"><@@number name="q0" value="0"></@@number></@@field>',
  '<@@field class="jauge" layout="float" label="Places"><@@gauge name="g0"></@@gauge></@@field>',
  '<@@field class="vide" layout="float" label="Libre"><@@number name="v0" placeholder="aucun"></@@number></@@field>',
  '<@@field class="lie" layout="float" label="Lié"><@@number name="l0" value=!{$n}></@@number></@@field>',
  '<@@field class="tard" layout="float" label="Tard"><@@number name="t0" placeholder="aucun" value=!{$m}></@@number></@@field>',
  '<@@field class="bouton" layout="float" label="Volume"><@@knob name="k0" value="40"></@@knob></@@field>',
  '<button id="b" @click={$n = 0; $m = 0}>zéro</button>',
].join('\n')

describe('mjs-core-field — libellé flottant d\'un champ qui vaut 0', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('nombre à 0, jauge à 0, bouton rotatif : rempli ; nombre vide : couché ; une liaison qui passe de vide à 0 le fait monter', async () => {
    const { window, hote } = await monterHote(HOTE, 'field-zero')
    const rempli = (sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.field').classList.contains('filled')
    assert.equal(rempli('.zero'), true, 'nombre à 0')
    assert.equal(rempli('.jauge'), true, 'jauge à 0')
    assert.equal(rempli('.vide'), false, 'nombre vide')
    assert.equal(rempli('.bouton'), true, 'bouton rotatif à 40')
    assert.equal(rempli('.lie'), true, 'liaison à 3')
    assert.equal(rempli('.tard'), false, 'préalable : liaison vide')
    hote._shadow.querySelector('#b').click()
    await attendre(() => hote._shadow.querySelector('.lie mjs-core-number')?._shadow?.querySelector('.input')?.value === '0')
    await pause(40)
    assert.equal(rempli('.lie'), true, 'passé de 3 à 0 par la liaison')
    assert.equal(rempli('.tard'), true, 'passé de vide à 0 par la liaison, sans aucun geste')
    window.close()
  })
})
