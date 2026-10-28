// l'Analyzer exporté par le paquet garde l'ancienne API des masques de bits pour le code qui l'appelle encore, et sa doc dit ce
// qu'elle fait : batchCalculateMasks() fait le travail de batchCalculateVars() (les dépendances se lisent par getEffectVars()),
// getMaskFromCache() rend toujours 0 — il n'y a plus de masque ; chacune nomme la méthode à écrire

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Analyzer } from '../src/index.js'

describe('Analyzer — l\'ancienne API des masques, gardée et documentée telle qu\'elle est', () => {
  it('batchCalculateMasks() remplit le même cache que batchCalculateVars() ; getMaskFromCache() rend 0', () => {
    const ancien  = new Analyzer('$.a = 0; $.b = $.a + 1; $.c = 2;')
    const nouveau = new Analyzer('$.a = 0; $.b = $.a + 1; $.c = 2;')
    ancien.batchCalculateMasks(['$.b', '$.c'])
    nouveau.batchCalculateVars(['$.b', '$.c'])
    assert.deepEqual(ancien.getEffectVars('$.b'), nouveau.getEffectVars('$.b'))
    assert.deepEqual(ancien.getEffectVars('$.c'), ['c'])
    assert.ok(ancien.getEffectVars('$.b').includes('a'), ancien.getEffectVars('$.b').join(' '))
    assert.equal(ancien.getMaskFromCache('$.b'), 0)
    assert.equal(ancien.getMaskFromCache('inconnu'), 0)
  })

  it('leur doc dit ce qu\'elles font, sans promettre de masque, et nomme la remplaçante', () => {
    const source = readFileSync(new URL('../src/analyzer/index.ts', import.meta.url), 'utf-8')
    const docs   = new Map([...source.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*\n\s*(\w+)\(/g)].map((m) => [m[2], m[1]]))
    assert.match(docs.get('batchCalculateMasks') ?? '', /@deprecated écrivez `batchCalculateVars\(snippets\)`/)
    assert.match(docs.get('getMaskFromCache') ?? '', /Rend toujours 0[\s\S]*@deprecated écrivez `getEffectVars\(snippet\)`/)
    assert.doesNotMatch(docs.get('batchCalculateMasks') ?? '', /Retourne 0|À supprimer|tests historiques/)
  })
})
