// un réglage qui porte le nom d'une propriété d'Object (`constructor`, `toString`…) est un réglage
// inconnu ordinaire : la table des réglages renommés ne le prend pas pour un ancien nom (« à la place :
// function Object() { [native code] } »)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { parseEffect } from '../src/effects/catalog.js'

const message = (nom: string, reglages: string): string => {
  try { parseEffect(nom, reglages) } catch (e) { return (e as Error).message }
  assert.fail(`*${nom}(${reglages}) aurait dû être refusé`)
}

describe('réglage nommé comme une propriété d\'Object', () => {
  const heritees = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'toLocaleString', 'propertyIsEnumerable']
  for (const effet of ['cursors', 'count', 'underline']) {
    for (const nom of heritees) {
      it(`*${effet}(${nom}: 1) : réglage inconnu, sans piste`, () => {
        const texte = message(effet, `${nom}: 1`)
        assert.match(texte, new RegExp(`réglage « ${nom} » inconnu`))
        assert.doesNotMatch(texte, /remplacé/)
        assert.doesNotMatch(texte, /native code|\[object/)
      })
    }
  }

  it('sur une balise HTML aussi', async () => {
    await assert.rejects(transpile('<div *cursors(constructor: 1)>x</div>', { moduleName: 'herite' }), (e: Error) => /réglage « constructor » inconnu/.test(e.message) && !/remplacé/.test(e.message))
    await assert.rejects(transpile('<p *underline(toString: 1)>x</p>', { moduleName: 'herite' }), (e: Error) => /réglage « toString » inconnu/.test(e.message) && !/remplacé/.test(e.message))
  })

  it('un vrai réglage renommé garde sa piste', () => {
    assert.ok(message('cursors', 'show: both').includes('« show » a été remplacé — à la place : cursor, selection, focus.'))
    assert.ok(message('underline', 'from: left').includes('« from » a été remplacé — à la place : origin.'))
  })
})
