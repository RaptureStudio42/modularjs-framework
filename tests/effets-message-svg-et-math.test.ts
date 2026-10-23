// Un effet posé sur une balise de contenu SVG ou MathML est refusé : il se pose sur la balise
// racine (<svg> ou <math>) ou autour. Le message nomme les deux racines : sous un <math>, il ne
// parlait que de <svg>.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('effets : le message sous <svg> et sous <math>', () => {
  it('sous un <math>, le message nomme <math>', async () => {
    await assert.rejects(transpile('<math><mi *neon>x</mi></math>\n', { moduleName: 'effet-math' }), (err: any) => /\*neon sur <mi>/.test(err.message) && /<math>/.test(err.message))
  })

  it('sous un <svg>, il nomme toujours <svg>', async () => {
    await assert.rejects(transpile('<svg><text *neon>x</text></svg>\n', { moduleName: 'effet-svg' }), (err: any) => /\*neon sur <text>/.test(err.message) && /<svg>/.test(err.message))
  })
})
