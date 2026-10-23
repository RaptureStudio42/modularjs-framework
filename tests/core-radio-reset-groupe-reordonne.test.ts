// module cœur radio (<@@radio>) : `form.reset()` rend un groupe lié (group=!{…}) au choix de son PREMIER rendu,
// quelle que soit la place que les boutons tiennent : un `{for … by clé}` réordonné réutilise les nœuds sur
// place, un bouton portait la photo d'une autre ligne, la remise cochait un autre bouton (voire changeait la
// variable de la page). Le départ du groupe est celui du bouton monté le premier ; chaque bouton se coche
// d'après lui. (Le bouton monté plus tard est dans le test navigateur voisin : happy-dom ne rend pas la même
// identité à un <form> selon le chemin par lequel on l'atteint.)

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const REORDRE = [
  '<script>',
  '  $z = \'b\'',
  '  $opts = [\'a\', \'b\', \'c\']',
  '</script>',
  '<form id="f" @noUJS>',
  '  {for o in $opts by o}<@@radio class="zr" name="z" value={o} group=!{$z}>{o}</@@radio>{end}',
  '</form>',
  '<p id="val">{$z}</p>',
].join('\n')

const natif      = (hote: any, el: any) => el._shadow.querySelector('input.native')
const valeur     = (hote: any) => hote._shadow.querySelector('#val').textContent
const formulaire = (hote: any) => hote._shadow.querySelector('#f')
const boutons    = (hote: any) => Array.from(hote._shadow.querySelectorAll('mjs-core-radio')) as any[]
// « valeur=coché » pour chaque bouton, dans l'ordre du DOM
const coches     = (hote: any) => boutons(hote).map((r) => `${r._state.value}=${natif(hote, r).checked ? 'oui' : 'non'}`)

// un clic de l'utilisateur : le natif passe à coché PUIS l'événement change part
function choisir(window: any, el: any) {
  el.checked = true
  el.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true, composed: true }))
}

describe('mjs-core-radio — form.reset() d\'un groupe lié réordonné', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un {for} réordonné réutilise les nœuds sur place : la remise coche le bouton de la variable, sans la changer', async () => {
    const { window, hote } = await monterHote(REORDRE, 'radio-reset-reordonne')
    assert.deepEqual(coches(hote), ['a=non', 'b=oui', 'c=non'], 'départ')
    hote._set('opts', ['b', 'a', 'c'])
    await attendre(() => (boutons(hote)[0] as any)._state.value === 'b')
    await pause(150)
    assert.deepEqual(coches(hote), ['b=oui', 'a=non', 'c=non'], 'réordonné : la variable dit toujours b')
    formulaire(hote).reset()
    await pause(150)
    assert.equal(valeur(hote), 'b', 'la remise ne change pas la variable de la page')
    assert.deepEqual(coches(hote), ['b=oui', 'a=non', 'c=non'], 'le bouton b est coché, pas celui que son nœud portait au premier rendu')
    window.close()
  })

  it('réordonné puis un autre choix : la remise rend le choix du premier rendu, sur le bon bouton', async () => {
    const { window, hote } = await monterHote(REORDRE, 'radio-reset-reordonne-choix')
    hote._set('opts', ['b', 'c', 'a'])
    await attendre(() => (boutons(hote)[0] as any)._state.value === 'b')
    await pause(150)
    choisir(window, natif(hote, boutons(hote)[2]))
    await attendre(() => valeur(hote) === 'a')
    formulaire(hote).reset()
    await pause(150)
    assert.equal(valeur(hote), 'b')
    assert.deepEqual(coches(hote), ['b=oui', 'c=non', 'a=non'])
    window.close()
  })
})
