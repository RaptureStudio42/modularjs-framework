// Le signal des effets nommés par une variable se lit sur la pose compilée de l'effet. Une pose qui ne se lit pas
// (jamais produite par le générateur, mais un faux négatif livrerait un effet sans son fichier) compte comme
// nommée ; un JSON ordinaire qui ressemble à la règle d'un réglage, à côté d'une pose lisible, ne la fait pas compter.

import assert from 'node:assert/strict'
import { scanCompiledFeatures, FX_NAMED } from '../src/bundler/features.js'

describe('signal des effets nommés — la pose illisible', () => {
  it('une pose qui ne se lit pas compte comme nommée', () => {
    const unreadable = 'µ._mjs_fx(this, node, "scramble", {}, {}, {"on":["e","x"]}, @@ pose coupée\n'
    assert.equal(scanCompiledFeatures(unreadable).has(FX_NAMED), true)
  })

  it('un JSON qui ressemble à la règle d\'un réglage, à côté d\'une pose lisible qui ne nomme rien : pas de signal', () => {
    const readable = 'const data = {"fr":["e","x"]};\nµ._mjs_fx(this, node, "scramble", {}, {}, {});\n'
    assert.equal(scanCompiledFeatures(readable).has(FX_NAMED), false)
  })

  it('une pose lisible dont un réglage est tenu par une variable d\'effet : le signal', () => {
    const named = 'µ._mjs_fx(this, node, "delta", {}, {}, {"fx":["e","x"]});\n'
    assert.equal(scanCompiledFeatures(named).has(FX_NAMED), true)
  })
})
