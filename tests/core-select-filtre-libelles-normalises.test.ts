// module cœur select (<@@select search>) : le libellé de chaque option est normalisé (accents,
// casse) une fois, quand les options sont lues — plus à chaque touche ni à chaque survol. Avant,
// chaque flèche et chaque survol refiltraient toutes les options en normalisant chaque libellé
// (2 412 appels à normalize() pour 5 flèches et un survol sur 200 options).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $liste = Array.from({ length: 200 }, (_, i)-> i + 1)',
  '</script>',
  '<@@select id="s" search>',
  '  {for i in $liste}<@@option value={i}>Pays {i}</@@option>{end}',
  '  <@@option value="e">État à part</@@option>',
  '</@@select>',
].join('\n')

describe('mjs-core-select — recherche : libellés normalisés une fois', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('5 flèches et un survol dans une liste filtrée de 200 options : normalize() ne repasse pas sur chaque libellé', async () => {
    const { window, hote } = await monterHote(HOTE, 'select-normalise')
    const sh = hote._shadow.querySelector('#s')._shadow
    sh.querySelector('.select-btn').click()
    await pause(80)
    const champ = sh.querySelector('.select-search')
    champ.value = 'pays 1'
    champ.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(80)
    window.eval('globalThis.__n = 0; const __orig = String.prototype.normalize; String.prototype.normalize = function(...a) { globalThis.__n++; return __orig.apply(this, a) }')
    for (let k = 0; k < 5; k++) {
      champ.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await pause(15)
    }
    sh.querySelectorAll('.select-option')[3].dispatchEvent(new window.MouseEvent('mouseenter'))
    await pause(15)
    const n = window.eval('globalThis.__n')
    assert.ok(n < 60, `appels à normalize() : ${n}`)
    // le comportement ne bouge pas : même filtre, même option active, même annonce (portée par le champ de recherche, qui a le focus)
    assert.equal(sh.querySelectorAll('.select-option').length, 111)
    assert.equal(sh.querySelector('.select-option.active').textContent.trim(), 'Pays 12')
    assert.equal(sh.querySelector('.select-search').getAttribute('aria-activedescendant'), sh.querySelector('.select-option.active').id)
    window.close()
  })

  it('accents et casse ignorés : « ETAT » trouve « État à part »', async () => {
    const { window, hote } = await monterHote(HOTE, 'select-normalise-accents')
    const sh = hote._shadow.querySelector('#s')._shadow
    sh.querySelector('.select-btn').click()
    await pause(80)
    const champ = sh.querySelector('.select-search')
    champ.value = 'ETAT'
    champ.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(80)
    assert.deepEqual([...sh.querySelectorAll('.select-option-label')].map((e: any) => e.textContent), ['État à part'])
    window.close()
  })
})
