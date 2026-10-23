// Un commentaire de bloc `### … ###` qui cite un motif de chemin (`src/**/*.json`) reste un commentaire jusqu'à
// son `###` fermant : avant, le `*/` du motif refermait le commentaire au milieu, la suite était lue comme du
// code et la construction échouait (« Failed to parse »).

import assert from 'node:assert/strict'
import { transpile, applyMjsSugarToScript } from '../src/transpiler/index.js'

describe('commentaire ### … ### contenant */', () => {
  it('le composant se construit', async () => {
    await assert.doesNotReject(transpile('<script>\n###\nCharge src/**/*.json au démarrage\n###\n$n = 1\n</script>\n<p>{$n}</p>', { moduleName: 'commentaire-bloc' }))
  })

  it('le commentaire converti ne se referme qu\'à sa fin', () => {
    const sortie = applyMjsSugarToScript('###\nCharge src/**/*.json au démarrage\n###\n$n = 1', 'civet')
    assert.equal(sortie.indexOf('*/'), sortie.lastIndexOf('*/'), sortie)
    assert.ok(sortie.includes('$n = 1'), sortie)
  })
})
