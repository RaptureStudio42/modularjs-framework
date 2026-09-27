// Les deux réécritures ligne-entière `µ$X = expr` / `export µ$X = expr` (applyMjsSugarToScript)
// tournaient SANS masquer chaînes ni commentaires, contrairement à leur sœur µ$$X — une ligne
// `µ$compteur = 5` simplement CITÉE dans un gabarit (backtick) multi-ligne, à des fins d'exemple,
// ressortait réécrite en code réel (texte affiché corrompu, build vert malgré tout).

import assert from 'node:assert/strict'
import { applyMjsSugarToScript } from '../src/transpiler/index.ts'

describe('µ$X = expr (assignation) : jamais réécrit à l\'intérieur d\'une chaîne', () => {
  it('un gabarit multi-lignes citant "µ$count = 5" en exemple de doc reste intact', () => {
    const src = 'docText := `\nExemple :\n  µ$count = 5\n`\nconsole.log(docText)'
    const out = applyMjsSugarToScript(src, 'civet')
    assert.match(out, /µ\$count = 5/, 'le texte cité doit survivre tel quel dans la chaîne')
    assert.doesNotMatch(out, /µ_state\.count/, 'aucune réécriture ne doit avoir lieu à l\'intérieur de la chaîne')
  })

  it('un gabarit multi-lignes citant "export µ$total = 5" en exemple reste intact', () => {
    const src = 'docText := `\nExemple :\n  export µ$total = 5\n`\nconsole.log(docText)'
    const out = applyMjsSugarToScript(src, 'civet')
    assert.match(out, /export µ\$total = 5/, 'le texte cité doit survivre tel quel dans la chaîne')
    assert.doesNotMatch(out, /µ_state\.total/, 'aucune réécriture ne doit avoir lieu à l\'intérieur de la chaîne')
  })

  it('un VRAI `µ$count = 5` hors chaîne reste réécrit en état universel', () => {
    const out = applyMjsSugarToScript('µ$count = 5', 'civet')
    assert.match(out, /µ_state\.count \?= µ\.state\(5\)/, 'un vrai usage doit toujours être réécrit')
  })

  it('un VRAI `export µ$total = 5` hors chaîne reste réécrit', () => {
    const out = applyMjsSugarToScript('export µ$total = 5', 'civet')
    assert.match(out, /µ_state\.total \?= µ\.state\(5\)/, 'un vrai export doit toujours être réécrit')
    assert.match(out, /export \$total = µ_state\.total/, 'l\'export dérivé doit toujours être émis')
  })

  it('une rhs contenant une chaîne ("µ$msg = \'bonjour\'") garde son contenu réel après réécriture', () => {
    const out = applyMjsSugarToScript(`µ$msg = 'bonjour'`, 'civet')
    assert.match(out, /µ_state\.msg \?= µ\.state\('bonjour'\)/, 'la rhs réelle (chaîne comprise) doit être préservée dans la réécriture')
  })
})
