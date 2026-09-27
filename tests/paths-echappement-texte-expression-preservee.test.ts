// `escapeForTpl` (generator/paths.ts, chemin impératif {await}) échappe le
// texte STATIQUE d'un gabarit avant de le coller dans un template literal —
// mais ne doit JAMAIS toucher au code JS déjà présent dans une fenêtre
// `${...}` (ex. un antislash de regexp), sous peine de le corrompre.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('paths.ts — échappement d\'un attribut texte + expression mêlés', function () {
  this.timeout(15000)

  it('bout-en-bout ({await}) : un antislash de regexp DANS l\'expression n\'est pas doublé', async () => {
    const source = [
      '<script>', '$p = Promise.resolve(\'a b\')', '</script>',
      '{await $p}{success d}<p class="cible" title=\'pré-{d.replace(/\\s/, "_")}\'></p>{end}',
    ].join('\n')
    const { output } = await transpile(source, { moduleName: 'escapeMixed' })
    const line = output.split('\n').find((l) => l.includes('_mjs_updAttrNode') && l.includes('title'))
    assert.ok(line, 'la ligne de pose de l\'attribut title doit être présente')
    const expr   = line!.slice(line!.indexOf(', "title", ') + ', "title", '.length, line!.lastIndexOf(');'))
    const actual = Function('d', `return (${expr});`)('a b')
    assert.equal(actual, 'pré-a_b', 'le texte statique s\'échappe, l\'expression reste exécutable telle quelle')
  })

  it('non-régression : sans préfixe texte, l\'expression nue reste inchangée', async () => {
    const source = [
      '<script>', '$p = Promise.resolve(\'a b\')', '</script>',
      '{await $p}{success d}<p class="cible" title=\'{d.replace(/\\s/, "_")}\'></p>{end}',
    ].join('\n')
    const { output } = await transpile(source, { moduleName: 'escapeBare' })
    const line = output.split('\n').find((l) => l.includes('_mjs_updAttrNode') && l.includes('title'))
    assert.ok(line)
    const expr   = line!.slice(line!.indexOf(', "title", ') + ', "title", '.length, line!.lastIndexOf(');'))
    const actual = Function('d', `return (${expr});`)('a b')
    assert.equal(actual, 'a_b')
  })
})
