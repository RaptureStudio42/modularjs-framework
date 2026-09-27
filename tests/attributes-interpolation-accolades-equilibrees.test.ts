// interpolation() (generator/attributes/index.ts) découpait une valeur d'attribut mixte
// (`attr="pre-{expr}-post"`) par une regex NON équilibrée (`/\{([^}]+)\}/g`, refermait sur le
// PREMIER `}` rencontré) : un objet littéral imbriqué dans l'expression (`{clic({a:1})}`) ou un
// `}` LITTÉRAL dans une chaîne de l'expression (`{clic({a:'}'})}`) tronquait l'expression avant
// sa vraie fin — échec de compilation sur du code utilisateur pourtant valide. `interpolation()`
// n'est atteinte que si la valeur ne contient AUCUN `$var` nu (sinon le dispatch bare-$, plus
// robuste via `parseMixedString`, intercepte avant) : d'où l'appel de méthode SANS `$` ci-dessous.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('generator/attributes/index.ts — interpolation() : accolades équilibrées, conscientes des chaînes', () => {
  it('un `}` littéral DANS une chaîne de l\'expression ne tronque plus l\'expression', async () => {
    const src = [
      '<script>', 'clic = (o) -> o.a', '</script>',
      '<div title="Avant {clic({a:1, b:\'}\'})} Apres">contenu</div>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'interpolAccoladesChaine' })
    assert.match(output, /Avant \$\{clic\(\{a:1, b:'\}'\}\)\} Apres/)
  })

  it('un objet littéral imbriqué (sans chaîne) ne tronque plus l\'expression', async () => {
    const src = [
      '<script>', 'clic = (o) -> o.a.b', '</script>',
      '<div title="Avant {clic({a:{b:1}})} Apres">contenu</div>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'interpolAccoladesImbriquees' })
    assert.match(output, /Avant \$\{clic\(\{a:\{b:1\}\}\)\} Apres/)
  })

  it('non-régression — interpolation simple sans accolades imbriquées reste correcte', async () => {
    const src = [
      '<script>', 'label = -> \'Bonjour\'', '</script>',
      '<div title="Avant {label()} Apres">contenu</div>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'interpolSimpleTemoin' })
    assert.match(output, /Avant \$\{label\(\)\} Apres/)
  })
})
