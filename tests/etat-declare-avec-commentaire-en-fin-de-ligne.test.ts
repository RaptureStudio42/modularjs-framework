// `µ$n = 0  # compteur` (ou `export µ$m = 1  # total` dans le <script module>) ne se construisait pas : le
// commentaire de fin de ligne restait dans `µ.state(…)` et avalait sa parenthèse fermante (et l'export qui suit)

import assert from 'node:assert/strict'
import { transpile, applyMjsSugarToScript } from '../src/transpiler/index.js'

describe('état déclaré avec un commentaire en fin de ligne', function () {
  this.timeout(60000)

  it('le commentaire reste après la déclaration', () => {
    const out = applyMjsSugarToScript('µ$n = 0  # compteur\nexport µ$m = 1  # total', 'civet')
    assert.match(out, /µ_state\.n \?= µ\.state\(0\)  \/\/ compteur/)
    assert.match(out, /µ_state\.m \?= µ\.state\(1\); export \$m = µ_state\.m  \/\/ total/)
  })

  it('<script> : se construit', async () => {
    const { output } = await transpile('<p>{µ$n}</p>\n<script>\nµ$n = 0  # compteur\n</script>', { moduleName: 'etat-commentaire' })
    assert.match(output, /compteur/)
  })

  it('<script module> : export µ$ avec un commentaire se construit', async () => {
    await assert.doesNotReject(transpile('<script module>\nexport µ$m = 1  # total\n</script>\n<p>a</p>', { moduleName: 'etat-commentaire-module' }))
  })

  it('témoins : une chaîne finale reste dans µ.state, un commentaire seul ne bouge pas', () => {
    assert.match(applyMjsSugarToScript("µ$s = 'a # pas un commentaire'", 'civet'), /µ\.state\('a # pas un commentaire'\)/)
    assert.match(applyMjsSugarToScript('µ$t = 2 /* bloc */', 'civet'), /µ\.state\(2 \/\* bloc \*\/\)/)
  })
})
