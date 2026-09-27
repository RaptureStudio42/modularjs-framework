// Directives RACINES × contenu de <script>/<style> — extractDirectives masquait déjà
// <pre>/<code>/commentaires HTML (cf. directives-commentaires-html.test.ts), mais jamais
// <script>/<style> eux-mêmes : une directive citée en exemple dans une CHAÎNE ou un
// COMMENTAIRE de code (un gabarit affiché à l'écran par le composant, une note de dev) était
// donc ACTIVÉE malgré tout, ET la ligne montrée à l'utilisateur disparaissait du texte réel.
//
// `<style>` est masqué EN BLOC (une directive MJS n'y vit jamais, `@import` y est une RÈGLE
// CSS). `<script>`, lui, accueille légitimement des directives écrites au niveau du CODE
// (docs/21-navigation.md : `@import µ$$draft '…'` DANS un <script> ; docs/17-router.md :
// `@preload on` idem) : seules ses zones INERTES (chaînes, gabarits, commentaires, regex) sont
// masquées, jamais le bloc entier — une ligne de VRAI CODE reste vue et traitée normalement.

import assert from 'node:assert/strict'
import { extractDirectives } from '../src/transpiler/directives.js'

describe('directives racines : une directive écrite en CODE dans <script> est activée normalement', () => {
  it('@import', () => {
    const src = "<script>\n@import Foo 'foo.civet'\n</script>\n<p>x</p>\n"
    const { pendingAutoImports } = extractDirectives(src)
    assert.equal(pendingAutoImports.length, 1, `pendingAutoImports: ${JSON.stringify(pendingAutoImports)}`)
  })

  it('@persist', () => {
    const src = '<script>\n@persist $x\n</script>\n<p>x</p>\n'
    const { persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars.map(v => v.var), ['$x'])
  })

  it('@preload', () => {
    const src = '<script>\n@preload on\n</script>\n<p>x</p>\n'
    const { modulePreload } = extractDirectives(src)
    assert.equal(modulePreload, 'on')
  })

  it('@i18n', () => {
    const src = "<script>\n@i18n 'panier'\n</script>\n<p>x</p>\n"
    const { moduleI18nSection } = extractDirectives(src)
    assert.equal(moduleI18nSection, 'panier')
  })

  it('la ligne de directive disparaît du script nettoyé (comme au niveau racine), le reste du code survit', () => {
    const src = '<script>\n@persist $x\n$y = 1\n</script>\n<p>x</p>\n'
    const { cleaned } = extractDirectives(src)
    assert.doesNotMatch(cleaned, /@persist/)
    assert.match(cleaned, /\$y = 1/)
  })
})

describe('directives racines : le contenu INERTE (chaîne/commentaire) de <script>/<style> reste inerte', () => {
  it('@persist dans un gabarit Civet affiché en doc (chaîne du script) : ni activé, ni retiré du texte', () => {
    const src = '<script>\ndocText := `\nExemple de directive a ne pas confondre avec du code :\n  @persist $x\n`\nconsole.log(docText)\n</script>\n<p>{docText}</p>\n'
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [])
    assert.equal(cleaned, src)
  })

  it('@i18n dans un commentaire de bloc `/* … */` du script : ni activé, ni retiré', () => {
    const src = "<script>\n/*\n@i18n 'panier'\n*/\n$x = 1\n</script>\n<p>{$x}</p>\n"
    const { cleaned, moduleI18nSection } = extractDirectives(src)
    assert.equal(moduleI18nSection, null)
    assert.equal(cleaned, src)
  })

  it('@css dans un commentaire de bloc du script : ne fait plus échouer la compilation (relogée normalement : throw)', () => {
    const src = '<script>\n/*\n@css nom1 nom2\n*/\n$x = 1\n</script>\n<p>{$x}</p>\n'
    assert.doesNotThrow(() => extractDirectives(src))
    assert.equal(extractDirectives(src).cleaned, src)
  })

  it('@preload dans un commentaire de bloc DANS <script> : ni activé, ni retiré', () => {
    const src = '<script>\n/*\n@preload hover\n*/\n$x = 1\n</script>\n<p>{$x}</p>\n'
    const { cleaned, modulePreload } = extractDirectives(src)
    assert.equal(modulePreload, null)
    assert.equal(cleaned, src)
  })

  it('@import dans un commentaire de ligne `//` DANS <script> : ni activé, ni retiré', () => {
    const src = "<script>\n// @import Foo 'foo.civet'\n$x = 1\n</script>\n<p>{$x}</p>\n"
    const { cleaned, pendingAutoImports } = extractDirectives(src)
    assert.equal(pendingAutoImports.length, 0)
    assert.equal(cleaned, src)
  })

  it('@preload dans un commentaire de bloc de <style> : ni activé, ni retiré (bloc entier masqué)', () => {
    const src = '<style>\n/*\n@preload hover\n*/\n.a { color: red; }\n</style>\n<p>x</p>\n'
    const { cleaned, modulePreload } = extractDirectives(src)
    assert.equal(modulePreload, null)
    assert.equal(cleaned, src)
  })
})

describe('directives racines : contre-cas', () => {
  it('@persist HORS <script>, à la racine du fichier, reste actif', () => {
    const src = '@persist $x\n<p>x</p>\n'
    const { persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars.map(v => v.var), ['$x'])
  })

  it('un @import RACINE entre deux <script> légitimes reste actif', () => {
    const src = "<script module>\nx = 1\n</script>\n@import Foo 'x.civet'\n<script>\ny = 2\n</script>\n<p>x</p>\n"
    const { pendingAutoImports } = extractDirectives(src)
    assert.equal(pendingAutoImports.length, 1)
  })

  it('le style ressort intact (aucun contenu perdu, bloc entier masqué puis restauré)', () => {
    const src = '<style>\n.a { color: red; }\n</style>\n<p>x</p>\n'
    assert.equal(extractDirectives(src).cleaned, src)
  })

  it('deux <script> : une directive de code dans le PREMIER et une autre dans le SECOND sont toutes les deux vues', () => {
    const src = "<script module>\n@import Foo 'foo.civet'\n</script>\n<script>\n@persist $x\n</script>\n<p>x</p>\n"
    const { pendingAutoImports, persistLocalVars } = extractDirectives(src)
    assert.equal(pendingAutoImports.length, 1)
    assert.deepEqual(persistLocalVars.map(v => v.var), ['$x'])
  })
})
