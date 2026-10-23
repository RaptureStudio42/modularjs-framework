// Un bloc de modèle `{? nom}` au nom invalide, dans un fichier inclus (`<@include faute>`) : le message
// citait une ligne du HTML déjà recollé — ni celle du partiel, ni celle du `<@include>`. Il nomme
// maintenant le partiel et cite la ligne du partiel. Un bloc fautif du composant lui-même garde sa ligne
// du fichier, quels que soient les partiels qui le précèdent.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('include-modele')
// le bloc fautif est à la 4e ligne du partiel
writeFileSync(join(dir, '_faute.mjs'), '<p>1</p>\n<p>2</p>\n<p>3</p>\n{? bad name!}\n<p>4</p>\n{end}\n')
writeFileSync(join(dir, '_ok.mjs'), '<p>1</p>\n{? b}<p>B</p>{end}\n')
writeFileSync(join(dir, '_relais.mjs'), '<p>0</p>\n<@include faute>\n')

const compile = (src: string) => transpile(src, { moduleName: 'hote', baseDir: dir })

describe('{? nom} fautif dans un fichier inclus', () => {
  it('le message nomme le partiel et cite la ligne du partiel', async () => {
    await assert.rejects(compile('<div>\n<@include faute>\n</div>\n'), (e: Error) => {
      assert.match(e.message, /<@include faute>/)
      assert.match(e.message, /\{\? bad name!\} ligne 4\b/)
      assert.doesNotMatch(e.message, /ligne 5\b/)
      return true
    })
  })

  it('un <script> avant le HTML du composant ne décale pas la ligne du partiel', async () => {
    await assert.rejects(compile('<script>\n$n = 1\n</script>\n<div>\n<@include faute>\n</div>\n'), (e: Error) => /<@include faute>/.test(e.message) && /ligne 4\b/.test(e.message))
  })

  it('un partiel inclus par un autre partiel : la faute est citée dans le partiel qui la porte', async () => {
    await assert.rejects(compile('<div>\n<@include relais>\n</div>\n'), (e: Error) => /<@include faute>/.test(e.message) && /ligne 4\b/.test(e.message))
  })

  it('un bloc fautif du composant garde sa ligne du fichier, après un <@include>', async () => {
    await assert.rejects(compile('<@include ok>\n<p>a</p>\n<p>b</p>\n{? bad name!}\n{end}\n'), (e: Error) => /\{\? bad name!\} ligne 4\b/.test(e.message) && !/<@include/.test(e.message))
  })

  it('un partiel dont les blocs sont justes passe, ses blocs sont développés', async () => {
    const { output } = await compile('<div>\n<@include ok>\n</div>\n')
    assert.match(output, /'b'/)
  })
})
