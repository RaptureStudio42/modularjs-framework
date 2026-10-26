// *fly(blur) : le flou s'ajoute au filtre propre de la balise (`filter: grayscale(1)`) au lieu de le
// remplacer le temps de l'animation — comme *blur le fait déjà.

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { chargerAnimation } from './helpers/charger-animation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// fly est posée sur l'enveloppe commune (shared/from.ts) et sur shared/len.ts : l'aide les charge avec elle
function loadFactory(µMock: any) {
  return chargerAnimation('fly', µMock)
}

describe('animations/fly.ts — flou et filtre propre de la balise', function () {
  let avant: any

  beforeEach(() => {
    avant = (globalThis as any).window
    ;(globalThis as any).window = { getComputedStyle: () => ({ opacity: '1', transform: 'none', filter: 'grayscale(1)' }) }
  })

  afterEach(() => {
    (globalThis as any).window = avant
  })

  it('le filtre de la balise reste, le flou s\'y ajoute puis s\'efface', () => {
    const µMock = { easing: { resolve: (e: any) => e || ((t: number) => t) } }
    const cfg = loadFactory(µMock)({ blur: 4, y: '40px' }).intro({})
    assert.equal(cfg.css(0, 1).filter, 'grayscale(1) blur(4px)')
    assert.equal(cfg.css(1, 0).filter, 'grayscale(1) blur(0px)')
  })
})
