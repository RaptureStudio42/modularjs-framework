// Un bloc de modèle `{? nom}` jamais refermé, dans un fichier inclus (`<@include nom>`) : le message nomme le
// partiel et cite la ligne du partiel, pas celle du HTML déjà recollé. Même citation pour le bloc du composant
// lui-même, quels que soient les partiels qui le précèdent. Un partiel dont les blocs sont refermés passe.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expandLayoutBlocks } from '../src/parser/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('include-modele-ouvert')
// le bloc jamais refermé est à la 4e ligne du partiel
writeFileSync(join(dir, '_ouvert.mjs'), '<p>1</p>\n<p>2</p>\n<p>3</p>\n{? a}\n<p>4</p>\n')
writeFileSync(join(dir, '_relais.mjs'), '<p>0</p>\n<@include ouvert>\n')
writeFileSync(join(dir, '_ferme.mjs'), '<p>1</p>\n{? b}<p>B</p>{end}\n')
writeFileSync(join(dir, '_chaine.mjs'), '<p>1</p>\n{? a}\n<p>A</p>\n{? b}\n<p>B</p>\n')

const compile = (src: string) => transpile(src, { moduleName: 'hote', baseDir: dir })

describe('{? nom} jamais refermé dans un fichier inclus', () => {
  it('le message nomme le partiel et cite la ligne du partiel', async () => {
    await assert.rejects(compile('<div>\n<@include ouvert>\n</div>\n'), (e: Error) => {
      assert.match(e.message, /<@include ouvert>/)
      assert.match(e.message, /\{\? a\}` ouvert ligne 4\b/)
      assert.doesNotMatch(e.message, /ligne 5\b/)
      return true
    })
  })

  it('un <script> avant le HTML du composant ne décale pas la ligne du partiel', async () => {
    await assert.rejects(compile('<script>\n$n = 1\n</script>\n<div>\n<@include ouvert>\n</div>\n'), (e: Error) => /<@include ouvert>/.test(e.message) && /ouvert ligne 4\b/.test(e.message))
  })

  it('un partiel inclus par un autre partiel : la faute est citée dans le partiel qui la porte', async () => {
    await assert.rejects(compile('<div>\n<@include relais>\n</div>\n'), (e: Error) => /<@include ouvert>/.test(e.message) && /ouvert ligne 4\b/.test(e.message))
  })

  it('une chaîne de blocs jamais refermée : citée à sa première ouverture', async () => {
    await assert.rejects(compile('<div>\n<@include chaine>\n</div>\n'), (e: Error) => /<@include chaine>/.test(e.message) && /\{\? a\}` ouvert ligne 2\b/.test(e.message))
  })

  it('un bloc du composant jamais refermé garde sa ligne du fichier, après un <@include>', async () => {
    await assert.rejects(compile('<@include ferme>\n<p>a</p>\n<p>b</p>\n{? zz}\n<p>c</p>\n'), (e: Error) => /\{\? zz\}` ouvert ligne 4\b/.test(e.message) && !/<@include/.test(e.message))
  })

  it('un partiel dont les blocs sont refermés passe, ses blocs sont développés', async () => {
    const { output } = await compile('<div>\n<@include ferme>\n</div>\n')
    assert.match(output, /'b'/)
  })

  it('un bloc refermé dans un {if}, un bloc dans un commentaire : rien à signaler', async () => {
    const { output } = await compile('<script>\n$x = true\n</script>\n{if $x}\n{? a}<p>A</p>{end}\n{end}\n<!-- {? jamais} -->\n')
    assert.match(output, /'a'/)
  })

  it('expandLayoutBlocks : la ligne citée part de la première ligne donnée', () => {
    assert.throws(() => expandLayoutBlocks('<p>x</p>\n{? a}\n<p>y</p>\n', 10), /\{\? a\}` ouvert ligne 11\b/)
    assert.throws(() => expandLayoutBlocks('<p>x</p>\n{? a}\n<p>y</p>\n'), /\{\? a\}` ouvert ligne 2\b/)
  })

  it('expandLayoutBlocks : un bloc refermé, ou un {if} laissé ouvert (au parseur de le dire), ne lève pas', () => {
    assert.doesNotThrow(() => expandLayoutBlocks('{? a}<p>x</p>{end}\n'))
    assert.doesNotThrow(() => expandLayoutBlocks('{if $x}\n<p>x</p>\n'))
  })
})
