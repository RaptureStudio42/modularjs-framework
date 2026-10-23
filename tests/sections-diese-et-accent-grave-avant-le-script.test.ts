// le texte du gabarit n'est plus lu comme du code pour trouver le <script> : un `###` (commentaire bloc Civet)
// ou un accent grave isolé écrits dans le HTML AVANT le <script> masquaient tout jusqu'au suivant, et le
// composant valide était refusé (« un </script> orphelin… chaîne non terminée »)

import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'

describe('extractSections — `###` et accent grave dans le HTML avant le script', () => {
  it('`###` avant et après le script', () => {
    const s = extractSections('<p>### a</p>\n<script>\nx := 1\n</script>\n<p>### b</p>')
    assert.equal(s.script.raw, '\nx := 1\n')
    assert.ok(s.html.includes('<p>### b</p>'), s.html)
  })

  it('accent grave isolé avant le script', () => {
    const s = extractSections('<p>code ` ici</p>\n<script>\nx := 1\n</script>\n<p>`</p>')
    assert.equal(s.script.raw, '\nx := 1\n')
  })

  it('`###` entre <script module> et <script> : les deux sont trouvés', () => {
    const s = extractSections('<script module>\nexport a := 1\n</script>\n<p>### note</p>\n<script>\nx := 1\n</script>\n<p>### fin {x}</p>')
    assert.equal(s.module.raw, '\nexport a := 1\n')
    assert.equal(s.script.raw, '\nx := 1\n')
  })

  it('témoin : un <script> écrit en tête de ligne dans une chaîne du script reste dans le script', () => {
    const s = extractSections("<script>\nhtml := '''\n<script src=\"x\"></script>\n'''\n</script>\n<p>{html}</p>")
    assert.ok(s.script.raw.includes('<script src="x"></script>'), s.script.raw)
    assert.equal(s.html.replace(/<!--\s*-->/g, '').trim(), '<p>{html}</p>')
  })

  it('témoin : un <script> mis en commentaire HTML reste inerte', () => {
    const s = extractSections('<!--\n<script>\nvieux := 1\n</script>\n-->\n<script>\nx := 1\n</script>\n<p>{x}</p>')
    assert.equal(s.script.raw, '\nx := 1\n')
  })
})
