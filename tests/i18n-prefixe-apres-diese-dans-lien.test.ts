// Sous `@i18n 'section'`, chaque clé relative `µt('clé')` est préfixée par la section au build. Le
// défaut : un `#` dans une chaîne compilée en gabarit JS (`"#/x/#{n}"`, un lien de routeur) était
// pris pour un commentaire et masquait la fin de sa ligne compilée — les `µt` qui suivaient sur
// cette ligne (tous les textes du HTML y sont réunis) restaient sans leur section : libellés vides à
// l'écran. Dans du JS compilé, `#` n'ouvre jamais de commentaire.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('i18n — un # dans un lien ne masque pas les µt qui le suivent', () => {
  it('lien "#/x/#{…}" avant deux µt : les deux clés reçoivent leur section', async () => {
    const src = '@i18n \'fiche\'\n<script>\n$n = 3\n</script>\n<a href={"#/x/#{$n}"}>{µt(\'lien\')}</a>\n<p>{µt(\'titre\')}</p>\n'
    const { output } = await transpile(src, { moduleName: 'fiche' })
    assert.match(output, /µ\.t\('fiche\.lien'\)/)
    assert.match(output, /µ\.t\('fiche\.titre'\)/)
    assert.doesNotMatch(output, /µ\.t\('(lien|titre)'\)/, 'aucune clé laissée sans sa section')
  })

  it('même chose dans le <script> : un gabarit avec # puis un µt sur la même ligne', async () => {
    const src = '@i18n \'fiche\'\n<script>\n$n = 3\nlibelle = -> "#/x/#{$n}" + µt(\'lien\')\n</script>\n<p>{libelle()}</p>\n'
    const { output } = await transpile(src, { moduleName: 'fiche' })
    assert.match(output, /µ\.t\('fiche\.lien'\)/)
  })
})
