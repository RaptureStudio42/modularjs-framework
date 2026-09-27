// extractLang — `checkSectionAttrs` (validation) accepte les espaces autour du `=`
// (`lang = "js"`), mais `extractLang` (lecture de la valeur) exigeait la forme collée
// (`lang="js"`) : la balise validait SANS erreur puis compilait quand même avec le
// langage par DÉFAUT (Civet) au lieu de celui écrit — panne muette, aucun message.

import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'

describe('extractSections — extractLang accepte les espaces autour du =, comme la validation', () => {
  it('<script lang = "js"> (espaces) : lu comme js, pas le défaut civet', () => {
    const src = '<script lang = "js">var x = 1;</script>\n<p>x</p>\n'
    assert.equal(extractSections(src).script.lang, 'js')
  })

  it('contre-cas : <script lang="js"> (collé) fonctionnait déjà', () => {
    const src = '<script lang="js">var x = 1;</script>\n<p>x</p>\n'
    assert.equal(extractSections(src).script.lang, 'js')
  })

  it('même trou sur <script module lang = "js">', () => {
    const src = '<script module lang = "js">var y = 1;</script>\n<script>$n = 0</script>\n<p>x</p>\n'
    assert.equal(extractSections(src).module.lang, 'js')
  })

  it('même trou sur <style lang = "css">', () => {
    const src = '<style lang = "css">.a { color: red; }</style>\n<p>x</p>\n'
    assert.equal(extractSections(src).style.lang, 'css')
  })

  it('même trou sur <theme lang = "css">', () => {
    const src = '<theme lang = "css">\n--x: 1;\n</theme>\n<p>x</p>\n'
    assert.equal(extractSections(src).themes[0].lang, 'css')
  })
})
