// rewriteStyleVars — balayage : la passe `$$`/`$` des blocs <style>/<theme> a son PROPRE
// scanner conscient des chaînes et des commentaires (pas de mask.ts ici, jamais sondé jusqu'ici).
// Verrouille que `$$nom` mentionné dans une chaîne ou un commentaire — exemple de doc, valeur
// littérale — ne devient jamais une LECTURE ni une DÉCLARATION de variable de thème.

import assert from 'node:assert/strict'
import { rewriteStyleVars } from '../src/transpiler/style-vars.js'

describe('rewriteStyleVars — $$nom dans une chaîne : jamais lu ni déclaré', () => {
  it('guillemets doubles : le texte survit, aucune lecture recensée', () => {
    const rw = rewriteStyleVars('.a::before { content: "$$brand exemple"; }\n')
    assert.deepEqual(rw.read, [])
    assert.ok(rw.code.includes('"$$brand exemple"'), rw.code)
  })

  it('guillemets simples : le texte survit, aucune lecture recensée', () => {
    const rw = rewriteStyleVars(".a::before { content: '$$brand exemple'; }\n")
    assert.deepEqual(rw.read, [])
    assert.ok(rw.code.includes("'$$brand exemple'"), rw.code)
  })

  it('une FORME DE DÉCLARATION (`$$nom:`) écrite dans une chaîne n\'est pas déclarée', () => {
    const rw = rewriteStyleVars('.a::before { content: "$$brand: red"; }\n')
    assert.deepEqual(rw.declared, [])
    assert.ok(rw.code.includes('"$$brand: red"'), rw.code)
  })
})

describe('rewriteStyleVars — $$nom dans un commentaire : jamais lu ni déclaré', () => {
  it('commentaire de bloc `/* … */` sur la ligne : le texte survit, aucune lecture', () => {
    const rw = rewriteStyleVars('/* exemple : $$brand */\n.a { color: red; }\n')
    assert.deepEqual(rw.read, [])
    assert.deepEqual(rw.declared, [])
    assert.ok(rw.code.includes('$$brand'), rw.code)
  })

  it('une FORME DE DÉCLARATION entière dans un commentaire de bloc multi-lignes : pas déclarée', () => {
    const rw = rewriteStyleVars('/*\n$$brand: red\n*/\n.a { color: blue; }\n')
    assert.deepEqual(rw.declared, [])
    assert.ok(rw.code.includes('$$brand: red'), rw.code)
  })

  it('commentaire de ligne `//` (SASS/indenté) : le texte survit, aucune lecture', () => {
    const rw = rewriteStyleVars('.a\n  color: red // exemple $$brand ici\n')
    assert.deepEqual(rw.read, [])
  })
})

describe('rewriteStyleVars — $nom (SASS simple) dans une chaîne ou un commentaire : jamais recensé', () => {
  it('chaîne : $gap ignoré (ni sassRead ni sassDeclared)', () => {
    const rw = rewriteStyleVars('.a::before { content: "$gap"; }\n')
    assert.deepEqual(rw.sassRead, [])
    assert.deepEqual(rw.sassDeclared, [])
  })

  it('commentaire de bloc : $gap ignoré', () => {
    const rw = rewriteStyleVars('/* $gap: 2px */\n.a { color: red; }\n')
    assert.deepEqual(rw.sassRead, [])
    assert.deepEqual(rw.sassDeclared, [])
  })
})

describe('rewriteStyleVars — témoin, hors chaîne/commentaire : lu et déclaré normalement', () => {
  it('$$brand décrit hors chaîne est bien déclaré', () => {
    const rw = rewriteStyleVars('$$brand: red\n.a { color: $$brand; }\n')
    assert.deepEqual(rw.declared.map(d => d.name), ['brand'])
    assert.deepEqual(rw.read, ['brand'])
  })
})
