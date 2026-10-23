// `readImageSize` (src/bundler/image.ts), branche SVG : la taille native part dans `width`/`height` de la balise
// `<img>` et dans le filtre des largeurs. Trois lectures fausses, courantes dans les SVG d'icônes et
// d'illustrations : `width="100%"` lu comme 100 pixels (le `viewBox` ignoré, image carrée déformée),
// `stroke-width` placé avant `width` lu comme la largeur, une taille en `em` lue comme des pixels.
// Règle : seule une taille en pixels (nombre nu ou `px`) compte ; toute autre unité renvoie au `viewBox`,
// et sans `viewBox`, pas de taille.

import assert from 'node:assert/strict'
import { readImageSize } from '../src/bundler/image.js'

const svg = (attributs: string): Buffer => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attributs}><rect width="3" height="3"/></svg>`)

describe('bundler/image — taille d\'un SVG : seules les tailles en pixels comptent', () => {
  it('témoin : `width`/`height` en pixels nus', () => {
    assert.deepEqual(readImageSize(svg('width="48" height="24"')), { width: 48, height: 24 })
  })

  it('`px` explicite est une taille en pixels', () => {
    assert.deepEqual(readImageSize(svg('width="48px" height="24px" viewBox="0 0 10 10"')), { width: 48, height: 24 })
  })

  it('`width="100%"` : le `viewBox` donne la taille', () => {
    assert.deepEqual(readImageSize(svg('width="100%" height="100%" viewBox="0 0 800 600"')), { width: 800, height: 600 })
  })

  it('`stroke-width` avant `width` n\'est pas la largeur', () => {
    assert.deepEqual(readImageSize(svg('stroke-width="1.5" width="48" height="48" viewBox="0 0 24 24"')), { width: 48, height: 48 })
    assert.deepEqual(readImageSize(svg('stroke-width="2" viewBox="0 0 64 32"')), { width: 64, height: 32 })
  })

  it('une taille en `em` n\'est pas lue comme des pixels : le `viewBox` donne la taille', () => {
    assert.deepEqual(readImageSize(svg('width="10em" height="5em" viewBox="0 0 160 80"')), { width: 160, height: 80 })
  })

  it('une seule des deux tailles en pixels : le `viewBox` donne la taille', () => {
    assert.deepEqual(readImageSize(svg('width="48" height="50%" viewBox="0 0 160 80"')), { width: 160, height: 80 })
  })

  it('sans taille en pixels ni `viewBox` : pas de taille', () => {
    assert.equal(readImageSize(svg('width="100%" height="100%"')), null)
    assert.equal(readImageSize(svg('width="2em" height="1em"')), null)
  })
})
