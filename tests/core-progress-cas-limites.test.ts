// module cœur progress (<@@progress>) : cas limites — en `scroll`, le pourcentage est juste dès le
// montage (page rechargée au milieu, ancre) et au redimensionnement, pas seulement au défilement ;
// en `follow`, le cercle se cache quand la souris quitte la fenêtre.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

describe('mjs-core-progress — cas limites', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('scroll : la page déjà défilée à moitié, le cercle montre 50 % dès le montage', async () => {
    const { window, hote } = await monterHote('<@@progress id="p" scroll></@@progress>', 'progress-scroll')
    // la page mesurée : 2000 px de haut, 1000 visibles, défilée de 500 — puis le module remonté
    const html = window.document.documentElement
    Object.defineProperty(html, 'scrollHeight', { configurable: true, get: () => 2000 })
    Object.defineProperty(html, 'clientHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(window, 'pageYOffset', { configurable: true, get: () => 500 })
    const p = hote._shadow.querySelector('#p')
    const copie = p.cloneNode(true)
    p.replaceWith(copie)
    await pause(120)
    assert.equal(copie._shadow.querySelector('text').textContent, '50%')
    // la fenêtre agrandie, sans défilement : le pourcentage suit
    Object.defineProperty(html, 'clientHeight', { configurable: true, get: () => 1500 })
    window.dispatchEvent(new window.Event('resize'))
    await pause(60)
    assert.equal(copie._shadow.querySelector('text').textContent, '100%')
    window.close()
  })

  it('follow : la souris quitte la fenêtre, le cercle se cache', async () => {
    const { window, hote } = await monterHote('<@@progress id="p" follow></@@progress>', 'progress-follow')
    const cercle = () => hote._shadow.querySelector('#p')._shadow.querySelector('.progress')
    window.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 40, clientY: 40 }))
    await pause(60)
    assert.equal(cercle().classList.contains('shown'), true, 'préalable : il suit la souris')
    window.document.documentElement.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: null }))
    await pause(60)
    assert.equal(cercle().classList.contains('shown'), false)
    window.close()
  })
})
