// Un marqueur `mjs-id`/`mjs-l-id` cité dans la VALEUR d'un autre attribut
// (`title='exemple mjs-id="demo" ici'`, ex. affichage de syntaxe) ne doit
// jamais être confondu avec un vrai marqueur — ni dans `extractPaths` (chemin
// par défaut), ni dans `generateCreateFnBody` (chemin impératif, {await}).

import assert from 'node:assert/strict'
import { extractPaths, generateCreateFnBody } from '../src/generator/paths.js'
import { transpile } from '../src/transpiler/index.js'

describe('paths.ts — mjs-id cité en PROSE dans une valeur d\'attribut', () => {
  it('extractPaths : le texte reste intact, aucune fausse référence DOM', () => {
    const input = '<p title=\'exemple mjs-id="demo" ici\'>test</p>'
    const { cleanHtml, paths } = extractPaths(input)
    assert.equal(cleanHtml, input, 'le HTML nettoyé ne doit RIEN retirer : ce n\'est pas un vrai marqueur')
    assert.equal(paths.demo, undefined, 'aucune référence DOM ne doit être créée pour "demo"')
  })

  it('extractPaths : un vrai mjs-id juste à côté reste, lui, reconnu et retiré', () => {
    const input = '<p mjs-id=\'reel\' title=\'exemple mjs-id="demo" ici\'>test</p>'
    const { cleanHtml, paths } = extractPaths(input)
    assert.equal(cleanHtml, '<p title=\'exemple mjs-id="demo" ici\'>test</p>', 'seul le VRAI attribut mjs-id doit disparaître')
    assert.ok(paths.reel, 'le vrai marqueur doit rester reconnu')
    assert.equal(paths.demo, undefined)
  })

  it('generateCreateFnBody (mode impératif) : même protection', () => {
    const input = '<p title=\'exemple mjs-id="demo" ici\'>test</p>'
    const { body } = generateCreateFnBody(input, { forceImperative: true })
    assert.match(body, /exemple mjs-id=\\?"demo\\?" ici/, 'la valeur d\'attribut doit rester intacte dans le JS généré (guillemets échappés selon le quoting choisi)')
  })

  it('bout-en-bout ({await}, mode impératif réel) : le titre affiché garde son texte complet', async () => {
    const src = [
      '<script>', '$p = Promise.resolve(1)', '$n = \'x\'', '</script>',
      '{await $p}', '{success d}',
      '<p class="cible" title=\'exemple mjs-id="demo" ici\'>{$n}</p>',
      '{end}',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'pathsMjsIdEnProse' })
    assert.match(output, /exemple mjs-id=\\?"demo\\?" ici/, 'le texte complet de l\'attribut doit survivre à la compilation')
  })
})
