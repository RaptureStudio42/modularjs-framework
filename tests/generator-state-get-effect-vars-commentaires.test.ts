// getEffectVars (generator/state.ts) — deux replis heuristiques scannaient le texte BRUT d'une
// expression au lieu de la vue masquée (maskNonCode) :
//   - le repli du sucre `#` (commentaire Civet sans accolades, ex. `$x > 0 # note`) : un `$var`
//     dans CE commentaire, ou dans une chaîne littérale de l'expression ('texte #$fake'),
//     devenait une fausse dépendance — l'effet se réabonnait à une var qu'il ne lit jamais.
//   - la décomposition en blocs équilibrés (sucre Civet sans parenthèses, ex.
//     `µt 'clé', { x: $v }`) : le texte HORS des blocs pouvait être un reste de CODE (la clé
//     `'...'` de l'appel) — un `$var` DANS cette chaîne devenait, de la même façon, une fausse
//     dépendance.
// Un `$var` nu dans un attribut BRUT (`href="#$ancre"`, `isRawText: true`) reste, lui, un
// raccourci LÉGITIME : le `#` y est un caractère littéral, pas un commentaire — non-régression
// couverte ici aussi.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function structVars(src: string, moduleName: string): Promise<Record<string, number>> {
  const { output } = await transpile(src, { moduleName })
  const m = output.match(/_mjs_renderStructVars\s*=\s*(\{[^;]*\});/)
  return m ? JSON.parse(m[1]) : {}
}

// les VALEURS de `_mjs_effectsByVar` sont du JS brut (`[_mjs_eff[0]]`, pas du JSON) : on ne lit
// que les CLÉS (noms de vars), par une regex sur les têtes de propriété littérales.
async function effectsByVarKeys(src: string, moduleName: string): Promise<string[]> {
  const { output } = await transpile(src, { moduleName })
  const m = output.match(/_mjs_effectsByVar\s*=\s*\{([^;]*)\};/)
  if (!m) return []
  return Array.from(m[1].matchAll(/"([^"]+)":/g)).map(x => x[1])
}

describe('generator/state.ts — getEffectVars ne scanne plus le texte brut d\'un commentaire/chaîne', () => {
  describe('repli `#` (commentaire Civet sans accolades)', () => {
    it('un $var DANS une chaîne littérale de la condition n\'est pas une dépendance', async () => {
      const src = [
        '<script>', '$count = 0', '$flag = false', '</script>',
        '<p>{if $count > 0 and \'exemple #$flag ici\'}Actif{end}</p>',
      ].join('\n')
      const vars = await structVars(src, 'commentaireHashChaine')
      assert.deepEqual(Object.keys(vars), ['count'], 'flag ne doit pas apparaitre, seul count pilote la condition')
    })

    it('un $var mentionné dans le commentaire lui-même n\'est pas une dépendance', async () => {
      const src = [
        '<script>', '$count = 0', '$flag = false', '</script>',
        '<p>{if $count > 0 # note sur $flag}Actif{end}</p>',
      ].join('\n')
      const vars = await structVars(src, 'commentaireHashDansCommentaire')
      assert.deepEqual(Object.keys(vars), ['count'])
    })

    it('non-régression — un commentaire Civet sans $var dedans compile toujours (count seul)', async () => {
      const src = [
        '<script>', '$count = 0', '</script>',
        '<p>{if $count > 0 # une note}Positif{end}</p>',
      ].join('\n')
      const vars = await structVars(src, 'commentaireHashTemoin')
      assert.deepEqual(Object.keys(vars), ['count'])
    })

    it('non-régression — un $var nu dans un attribut brut (href="#$ancre") reste une dépendance', async () => {
      const src = [
        '<script>', '$section = \'intro\'', '</script>',
        '<a href="#$section">Aller</a>',
      ].join('\n')
      const keys = await effectsByVarKeys(src, 'hrefAncreBrut')
      assert.deepEqual(keys, ['section'])
    })
  })

  describe('décomposition en blocs équilibrés (sucre Civet sans parenthèses)', () => {
    it('un $var DANS la chaîne-clé d\'un appel `µt \'...\', {...}` sans parenthèses n\'est pas une dépendance', async () => {
      const src = [
        '<script>', '$name = \'Ada\'', '$flag = false', '</script>',
        '<p class="o">{µt \'exemple avec $flag\', { name: $name }}</p>',
      ].join('\n')
      const keys = await effectsByVarKeys(src, 'mutLeftoverChaine')
      assert.deepEqual(keys, ['name'], 'flag ne doit pas apparaitre, seul name est réellement lu')
    })
  })
})
