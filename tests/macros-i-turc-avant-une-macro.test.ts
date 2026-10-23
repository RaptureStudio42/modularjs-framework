// un « İ » (i majuscule pointé du turc : İstanbul, İzmir) écrit avant une balise du langage ne décale plus
// rien : les positions étaient cherchées dans le texte passé en minuscules, où « İ » compte deux unités, puis
// appliquées au texte d'origine — un composant valide était refusé (« balise non fermée ») ou sa balise
// laissée intacte

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { processGlobalMacros } from '../src/transpiler/macros.js'
import { extractSections } from '../src/transpiler/sections.js'

describe('« İ » avant une balise du langage', () => {
  it('<@window @resize> après « İstanbul » : compile et pose l\'écouteur', async () => {
    const src = '<script>\n$w = 0\n</script>\n<p>İstanbul</p>\n<@window @resize={-> $w = window.innerWidth}>\n<p>{$w}</p>\n'
    const r = await transpile(src, { moduleName: 'carte' })
    assert.deepEqual(r.data.macroErrors ?? [], [])
    assert.match(r.output, /addEventListener\('resize'/)
    assert.doesNotMatch(r.output, /@window/)
  })

  it('<@head>…</@head> après « İİİ » : contenu injecté, aucune erreur', () => {
    const r = processGlobalMacros('<p>İİİzmir</p>\n<@head><title>{$t}</title></@head>\n<p>x</p>')
    assert.deepEqual(r.errors, [])
    assert.match(r.setup, /µ\._setHead/)
    assert.doesNotMatch(r.html, /@head/)
  })

  it('extractSections : le <@head> qui suit « İİ » est masqué entier, le script reste le script', () => {
    const s = extractSections('<p>İİ</p>\n<@head><script src="/a.js"></script></@head>\n<script>\nx := 1\n</script>\n<p>{$x}</p>')
    assert.equal(s.script.raw.trim(), 'x := 1')
    assert.ok(s.html.includes('<p>İİ</p>\n<@head><script src="/a.js"></script></@head>'), s.html)
  })
})
