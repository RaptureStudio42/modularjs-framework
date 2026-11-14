// les partiels `<@include x>` sont lus dans l'arbre du gabarit : seule une vraie balise inclut son partiel ; un
// `<@include>` cité dans un commentaire HTML, une valeur d'attribut ou une chaîne d'expression n'est pas lu (ni
// inclus, ni signalé) ; partout où une balise se lit, l'inclusion est inchangée

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('partiel-arbre')
writeFileSync(join(dir, '_bas.mjs'), '<script>\n@marque = \'depuis-le-partiel\'\n</script>\n<p>PARTIEL</p>\n')
writeFileSync(join(dir, '_relais.mjs'), '<!-- <@include absent> -->\n<p>RELAIS</p>\n')

// la compilation : sa sortie, puis ses erreurs (console, erreurs de macros, refus de la construction)
async function compile(src: string): Promise<{ output: string, erreurs: string[] }> {
  const orig    = console.error
  const erreurs: string[] = []
  console.error = (...a: unknown[]) => { erreurs.push(a.map(String).join(' ')) }
  try {
    const { output, data } = await transpile(src, { moduleName: 'hote', baseDir: dir })
    return { output, erreurs: [...erreurs, ...data.macroErrors] }
  }
  catch (e) {
    return { output: '', erreurs: [...erreurs, (e as Error).message] }
  }
  finally {
    console.error = orig
  }
}

describe('un <@include> cité dans un commentaire HTML', () => {
  it('n\'inclut pas le partiel : ni son gabarit, ni son script', async () => {
    const { output, erreurs } = await compile('<!-- note : <@include bas> -->\n<p>hôte</p>\n')
    assert.deepEqual(erreurs, [])
    assert.doesNotMatch(output, /depuis-le-partiel/)
    assert.doesNotMatch(output, /PARTIEL/)
  })

  it('un partiel introuvable cité en commentaire n\'est pas une erreur', async () => {
    const { erreurs } = await compile('<!-- <@include absent> -->\n<p>hôte</p>\n')
    assert.deepEqual(erreurs, [])
  })

  it('une forme mal écrite citée en commentaire n\'est pas une erreur', async () => {
    const { erreurs } = await compile('<!-- exemple : <@include bas titre="a"> -->\n<p>hôte</p>\n')
    assert.deepEqual(erreurs, [])
  })

  it('dans le commentaire d\'un partiel inclus, non plus', async () => {
    const { output, erreurs } = await compile('<div>\n<@include relais>\n</div>\n')
    assert.deepEqual(erreurs, [])
    assert.match(output, /RELAIS/)
  })
})

describe('un <@include> écrit dans une valeur d\'attribut ou une chaîne d\'expression', () => {
  it('reste le texte de l\'attribut', async () => {
    const { output, erreurs } = await compile('<p title="<@include bas>">hôte</p>\n')
    assert.deepEqual(erreurs, [])
    assert.doesNotMatch(output, /depuis-le-partiel/)
    assert.match(output, /&lt;@include bas&gt;|<@include bas>/)
  })

  it('reste la chaîne de l\'expression', async () => {
    const { output, erreurs } = await compile('<p>{\'<@include bas>\'}</p>\n')
    assert.deepEqual(erreurs, [])
    assert.doesNotMatch(output, /depuis-le-partiel/)
  })
})

describe('une vraie balise <@include>', () => {
  it('inclut le partiel, son gabarit et son script', async () => {
    const { output, erreurs } = await compile('<div>\n<@include bas>\n</div>\n')
    assert.deepEqual(erreurs, [])
    assert.match(output, /depuis-le-partiel/)
    assert.match(output, /PARTIEL/)
  })

  it('écrite en capitales, sur deux lignes, dans un bloc ou dans un <pre>', async () => {
    for (const src of ['<@INCLUDE bas>\n', '<@include\n  bas>\n', '{if $a}\n<@include bas>\n{end}\n', '<pre><@include bas></pre>\n']) {
      const { output, erreurs } = await compile(src)
      assert.deepEqual(erreurs, [], src)
      assert.match(output, /depuis-le-partiel/, src)
    }
  })

  it('dans un <textarea>, comme aujourd\'hui : le gabarit du partiel devient son texte', async () => {
    const { output, erreurs } = await compile('<textarea><@include bas></textarea>\n')
    assert.deepEqual(erreurs, [])
    assert.match(output, /depuis-le-partiel/)
  })

  it('mal formée, introuvable ou fermée par un slash : la même erreur qu\'avant', async () => {
    assert.match((await compile('<@include bas titre="a">\n')).erreurs.join('\n'), /<@include> mal formé : « <@include bas titre="a">/)
    assert.match((await compile('<@include-pied>\n')).erreurs.join('\n'), /<@include> mal formé : « <@include-pied>/)
    assert.match((await compile('<@include absent>\n')).erreurs.join('\n'), /Partial introuvable : <@include absent>/)
    assert.match((await compile('<@include bas/>\n')).erreurs.join('\n'), /slash final interdit/)
  })
})
