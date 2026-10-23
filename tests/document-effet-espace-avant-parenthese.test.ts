// `<@document *ripple (color: red)>` : une parenthèse séparée du nom de l'effet par un blanc perdait ses
// réglages en silence (`"ripple", {}`), alors que la même écriture sur une balise HTML est refusée avec
// « les réglages d'un effet se collent à son nom ». Les balises du langage (<@document>, <@window>,
// <@body>, <@element>…) refusent pareil, et le message cite la ligne du fichier.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('doc-espace')
writeFileSync(join(dir, '_haut.mjs'), '<p>1</p>\n<p>2</p>\n<p>3</p>\n')

const erreurs = async (html: string) => (await transpile(html, { moduleName: 'doc-espace' })).data.macroErrors

describe('<@document *effet (réglages)> : un blanc avant la parenthèse', () => {
  it('refusé comme sur une balise : le message dit de coller la parenthèse et cite la ligne', async () => {
    const vues = await erreurs('<p>un</p>\n<@document *ripple (color: red)>\n')
    assert.equal(vues.length, 1, JSON.stringify(vues))
    assert.match(vues[0], /\*ripple \(…\)/)
    assert.match(vues[0], /sans espace avant la parenthèse/)
    assert.match(vues[0], /ligne 2\b/)
  })

  it('la ligne est celle du fichier, un <script> avant le HTML compris', async () => {
    const vues = await erreurs('<script>\n$n = 1\n</script>\n\n<p>un</p>\n<@document *ripple (color: red)>\n')
    assert.equal(vues.length, 1, JSON.stringify(vues))
    assert.match(vues[0], /\*ripple \(…\)/)
    assert.match(vues[0], /ligne 6\b/)
  })

  it('un partiel inclus plus haut ne décale pas la ligne : celle du fichier, pas du HTML recollé', async () => {
    const { data } = await transpile('<@include haut>\n<@document *ripple (color: red)>\n', { moduleName: 'doc-espace', baseDir: dir })
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /ligne 2\b/)
  })

  it('les autres balises du langage : l\'espace et l\'effet qui ne s\'y pose pas sont dits tous les deux', async () => {
    for (const balise of ['window', 'body', 'html']) {
      const vues = await erreurs(`<@${balise} *ripple (color: red)>\n<p>x</p>\n`)
      assert.equal(vues.length, 2, `${balise} : ${JSON.stringify(vues)}`)
      assert.ok(vues.some(m => /sans espace avant la parenthèse/.test(m)), `${balise} : ${JSON.stringify(vues)}`)
      assert.ok(vues.some(m => m.includes(`*ripple ne se pose pas sur <@${balise}>`)), `${balise} : ${JSON.stringify(vues)}`)
    }
  })

  it('sur <@document>, où l\'effet se pose : l\'espace seul est refusé', async () => {
    const vues = await erreurs('<@document *ripple (color: red)>\n<p>x</p>\n')
    assert.equal(vues.length, 1, JSON.stringify(vues))
    assert.doesNotMatch(vues[0], /ne se pose pas/)
  })

  it('une balise écrite sur plusieurs lignes : la ligne de l\'effet fautif, pas celle du début de la balise', async () => {
    const vues = await erreurs('<p>un</p>\n<@document\n  @click={ 1 }\n  *ripple (color: red)>\n')
    assert.equal(vues.length, 1, JSON.stringify(vues))
    assert.match(vues[0], /ligne 4\b/)
    const deux = await erreurs('<p>un</p>\n<@document\n  *ripple(color: blue)\n  *lang (color: red)>\n')
    assert.equal(deux.length, 1, JSON.stringify(deux))
    assert.match(deux[0], /\*lang/)
    assert.match(deux[0], /ligne 4\b/)
  })

  it('collée, ou sans réglages : rien ne change', async () => {
    assert.deepEqual(await erreurs('<@document *ripple(color: red)>\n<p>x</p>\n'), [])
    assert.deepEqual(await erreurs('<@document *ripple>\n<p>x</p>\n'), [])
    assert.deepEqual(await erreurs('<@document *ripple @click={ 1 }>\n<p>x</p>\n'), [])
  })
})
