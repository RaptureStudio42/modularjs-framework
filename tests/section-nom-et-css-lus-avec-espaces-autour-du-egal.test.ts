// `<style name = "x">`, `<theme name = "x">` et `:css = "a"` : des espaces autour du `=` sont acceptés, et la valeur écrite
// est lue, comme pour `lang = "…"` — la balise passait sans erreur, mais sa valeur était ignorée (style nommé pris pour un
// second style de base, thème sans nom, feuilles partagées jamais citées)
import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'

describe('sections : name et :css lus avec des espaces autour du =', () => {
  it('<style name = "sombre"> est un style nommé, pas un second style de base', () => {
    assert.doesNotThrow(() => extractSections('<style>\np { color: red }\n</style>\n<style name = "sombre">\np { color: blue }\n</style>\n<p>t</p>\n'))
  })

  it('<theme name = "sombre"> garde son nom', () => {
    const r: any = extractSections('<theme name = "sombre">\n--fond: #000\n</theme>\n<p>t</p>\n')
    assert.deepEqual(r.themes.map((th: any) => th.name), ['sombre'])
  })

  it('<style :css = "a b"> cite ses feuilles partagées', () => {
    const r: any = extractSections('<style :css = "a b">\np { color: red }\n</style>\n<p>t</p>\n')
    assert.deepEqual(r.style.sharedCssNames, ['a', 'b'])
  })
})
