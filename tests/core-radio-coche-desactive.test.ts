// module cœur radio (<@@radio>) : un groupe dont le bouton coché est désactivé. Le module ne laisse
// qu'un arrêt de tabulation au groupe (le bouton coché) ; si ce bouton est désactivé, il n'est pas
// focalisable et les autres, à -1, ne l'étaient pas non plus : le groupe n'avait plus AUCUN arrêt, la
// tabulation le sautait. Comme un groupe natif, le premier bouton libre prend l'arrêt à sa place — et
// le rend quand le bouton coché est de nouveau actif.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const radios = (...lignes: string[]) => [
  '<script>',
  '  $size = \'m\'',
  '  $off  = false',
  '</script>',
  ...lignes,
  '<p id="val">{$size}</p>',
].join('\n')

const A = '<@@radio id="ra" name="size" value="s" group=!{$size}>S</@@radio>'
const B = '<@@radio id="rb" name="size" value="m" group=!{$size}>M</@@radio>'
const C = '<@@radio id="rc" name="size" value="l" group=!{$size}>L</@@radio>'
const D = '<@@radio id="rd" name="size" value="xl" group=!{$size}>XL</@@radio>'

const natif  = (hote: any, id: string) => hote._shadow.querySelector('#' + id)._shadow.querySelector('input.native')
const valeur = (hote: any) => hote._shadow.querySelector('#val').textContent
const arrets = (hote: any, ids: string[]) => ids.map((id) => natif(hote, id).tabIndex)

describe('mjs-core-radio — le bouton coché est désactivé', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le premier bouton libre prend l\'arrêt de tabulation, les autres sortent de l\'ordre', async () => {
    const { window, hote } = await monterHote(radios(A, B.replace('value="m"', 'value="m" disabled'), C), 'radio-coche-desactive')
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [0, -1, -1])
    window.close()
  })

  it('le premier bouton est désactivé lui aussi : l\'arrêt passe au suivant libre', async () => {
    const { window, hote } = await monterHote(radios(A.replace('value="s"', 'value="s" disabled'), B.replace('value="m"', 'value="m" disabled'), C, D), 'radio-coche-desactive-premier')
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc', 'rd']), [-1, -1, 0, -1])
    window.close()
  })

  it('un groupe dont le bouton coché est actif garde son arrêt sur lui, même avec un autre bouton désactivé', async () => {
    const { window, hote } = await monterHote(radios(A.replace('value="s"', 'value="s" disabled'), B, C), 'radio-coche-actif')
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [-1, 0, -1])
    window.close()
  })

  it('le bouton coché désactivé puis réactivé : l\'arrêt passe au premier libre, puis revient sur lui', async () => {
    const { window, hote } = await monterHote(radios(A, B.replace('value="m"', 'value="m" disabled={$off}'), C), 'radio-coche-bascule')
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [-1, 0, -1], 'départ : le bouton coché porte l\'arrêt')
    hote._set('off', true)
    await attendre(() => arrets(hote, ['ra', 'rb', 'rc'])[0] === 0)
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [0, -1, -1], 'désactivé : le premier bouton libre le remplace')
    hote._set('off', false)
    await attendre(() => arrets(hote, ['ra', 'rb', 'rc'])[1] === 0)
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [-1, 0, -1], 'réactivé : l\'arrêt revient au bouton coché')
    window.close()
  })

  it('une autre case libre désactivée à son tour : l\'arrêt suit le premier bouton encore libre', async () => {
    const { window, hote } = await monterHote(radios(A.replace('value="s"', 'value="s" disabled={$off}'), B.replace('value="m"', 'value="m" disabled'), C), 'radio-premier-bascule')
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [0, -1, -1], 'départ : le premier bouton libre')
    hote._set('off', true)
    await attendre(() => arrets(hote, ['ra', 'rb', 'rc'])[2] === 0)
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [-1, -1, 0], 'le premier bouton désactivé : l\'arrêt passe au suivant')
    window.close()
  })

  it('depuis le bouton qui porte l\'arrêt, la flèche saute le bouton désactivé et coche le suivant libre', async () => {
    const { window, hote } = await monterHote(radios(A, B.replace('value="m"', 'value="m" disabled'), C), 'radio-coche-desactive-fleche')
    natif(hote, 'ra').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true }))
    await attendre(() => valeur(hote) === 'l')
    await pause(40)
    assert.equal(valeur(hote), 'l')
    assert.deepEqual(arrets(hote, ['ra', 'rb', 'rc']), [-1, -1, 0])
    window.close()
  })
})
