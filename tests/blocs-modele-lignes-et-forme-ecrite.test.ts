// Blocs de modèle `{? nom}` : les messages citent la bonne ligne et la forme écrite. Une faute dans un
// `{? …}` placé après un `<@include>` est citée à sa ligne du fichier, pas décalée de la hauteur du
// partiel ; un `{? a,\n b}` sur deux lignes ne décale pas les lignes qui suivent ; un `{? compact}`
// jamais refermé est cité tel qu'écrit, pas sous sa forme développée `{if µlayout is 'compact'}` ;
// un `{if µlayout is 'x'}` écrit à la main garde, lui, sa forme.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('blocs {? nom} : lignes et forme écrite dans les messages', () => {
  it('un {? …} fautif après un partiel de quatre lignes : cité à sa ligne', async () => {
    const dir = mjsTmp('blocs-modele-include')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '_entete.mjs'), '<p>1</p>\n<p>2</p>\n<p>3</p>\n<p>4</p>\n')
    await assert.rejects(
      transpile('<div>\n  <@include entete>\n  {? bad name!}\n</div>\n', { moduleName: 'blocs-include', baseDir: dir }),
      (err: any) => /\{\? bad name!\} ligne 3/.test(err.message)
    )
  })

  it('un {? a, b} sur deux lignes ne décale pas la suite', async () => {
    await assert.rejects(
      transpile('<script>\n  $x = 1\n</script>\n<div>\n  {? a,\n     b}<p>x</p>{end}\n  {if $x}a{else if $x}b{end}\n</div>\n', { moduleName: 'blocs-deux-lignes' }),
      (err: any) => /ligne 7/.test(err.message) && /else if/.test(err.message)
    )
  })

  it('un {? compact} jamais refermé : cité tel qu\'écrit', async () => {
    await assert.rejects(
      transpile('<div>\n  {? compact}\n  <p>x</p>\n</div>\n', { moduleName: 'blocs-non-referme' }),
      (err: any) => err.message.includes('{? compact}') && /ligne 2/.test(err.message) && !err.message.includes('µlayout is')
    )
    await assert.rejects(
      transpile('<div>\n  {? a, b}\n  <p>x</p>\n</div>\n', { moduleName: 'blocs-non-referme-deux' }),
      (err: any) => err.message.includes('{? a, b}')
    )
  })

  it('un {if µlayout is \'x\'} écrit à la main garde sa forme dans le message', async () => {
    await assert.rejects(
      transpile("<div>\n  {if µlayout is 'x'}\n  <p>x</p>\n</div>\n", { moduleName: 'blocs-if-main' }),
      (err: any) => err.message.includes("{if µlayout is 'x'}")
    )
  })

  it('un {? …} bien formé compile toujours, noms relevés', async () => {
    const { data } = await transpile('<div>\n  {? a,\n     b}<p>x</p>{? c}<p>y</p>{end}\n</div>\n', { moduleName: 'blocs-ok' })
    assert.deepEqual(Object.keys(data.layoutCss).sort(), ['a', 'b', 'c'])
  })
})
