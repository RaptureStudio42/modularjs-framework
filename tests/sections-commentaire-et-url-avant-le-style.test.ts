// le texte du gabarit n'est plus lu comme du CSS pour trouver le <style> : un `/*` ou un `url(` non refermés écrits
// dans le HTML AVANT le <style> (texte d'un paragraphe, démo de code) masquaient tout jusqu'à leur fin, balise
// comprise, et le composant valide était refusé (« un </style> orphelin »)

import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'
import { transpile } from '../src/transpiler/index.js'

const STYLE = '<style>\n.a\n  color: red\n</style>'

describe('extractSections — `/*` et `url(` dans le HTML avant le style', () => {
  it('`/*` avant le style, refermé après lui', () => {
    const s = extractSections(`<p>/* note</p>\n${STYLE}\n<p>*/</p>`)
    assert.equal(s.style.raw, '\n.a\n  color: red\n')
    assert.ok(s.html.includes('<p>/* note</p>'), s.html)
    assert.ok(s.html.includes('<p>*/</p>'), s.html)
  })

  it('`/*` avant le style, refermé par un commentaire du style', () => {
    const s = extractSections('<p>/* note</p>\n<style>\n/* titre */\n.a\n  color: red\n</style>')
    assert.equal(s.style.raw, '\n/* titre */\n.a\n  color: red\n')
  })

  it('`url(` avant le style, refermé après lui', () => {
    const s = extractSections(`<p>voir url( ici</p>\n${STYLE}\n<p>)</p>`)
    assert.equal(s.style.raw, '\n.a\n  color: red\n')
    assert.ok(s.html.includes('<p>)</p>'), s.html)
  })

  it('`url(` avant le style, refermé par une parenthèse du style', () => {
    const s = extractSections('<p>voir url( ici</p>\n<style>\n.a\n  color: rgb(1, 2, 3)\n</style>')
    assert.equal(s.style.raw, '\n.a\n  color: rgb(1, 2, 3)\n')
  })

  it('`/*` entre le style de base et un style nommé : les deux sont trouvés', () => {
    const s = extractSections(`${STYLE}\n<p>/* note</p>\n<style name="large">\n.a\n  color: blue\n</style>\n<p>*/</p>`)
    assert.equal(s.style.raw, '\n.a\n  color: red\n')
    assert.deepEqual(s.layouts.map(l => [l.name, l.raw]), [['large', '\n.a\n  color: blue\n']])
  })

  it('`/*` dans un commentaire du script, puis un style qui commence par un commentaire', () => {
    const s = extractSections('<script>\n  # motif /* ici\n  x = 1\n</script>\n<style>\n/* titre */\n.a\n  color: red\n</style>')
    assert.equal(s.script.raw, '\n# motif /* ici\nx = 1\n')
    assert.equal(s.style.raw, '\n/* titre */\n.a\n  color: red\n')
  })

  it('transpile() : le composant compile, avec son CSS', async () => {
    const r = await transpile(`<p>/* note</p>\n${STYLE}\n<p>*/</p>\n`, { moduleName: 'note' })
    assert.match(r.output, /color: ?red/)
  })

  it('témoin : `url(//…)` et commentaire dans le style, style inchangé', () => {
    const s = extractSections('<p>texte</p>\n<style>\n/* c */\n.a\n  background: url(//x.png)\n</style>')
    assert.equal(s.style.raw, '\n/* c */\n.a\n  background: url(//x.png)\n')
  })

  it('témoin : un style mis en commentaire HTML reste inerte', () => {
    const s = extractSections(`<!--\n<style>\n.vieux\n  color: red\n</style>\n-->\n${STYLE}`)
    assert.equal(s.style.raw, '\n.a\n  color: red\n')
  })

  it('témoin : un </style> dans une chaîne du script reste dans le script', () => {
    const s = extractSections(`<script>\ncss := '</style>'\n</script>\n${STYLE}`)
    assert.equal(s.script.raw, "\ncss := '</style>'\n")
    assert.equal(s.style.raw, '\n.a\n  color: red\n')
  })
})
