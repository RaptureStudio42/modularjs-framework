// `µlayout` lit le modèle choisi (la prop `layout`) : un composant qui a sa propre variable `$layout` est
// refusé, les deux se confondraient. Le raccourci d'un attribut hors accolades — `<p title="$layout">`,
// `class="a $layout"`, `title=$layout` — lit la variable aussi : refusé comme `title={$layout}`. Le texte
// entre les balises (`<p>le prix $layout</p>`) ne lit rien.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const compile = (src: string) => transpile(src, { moduleName: 'carte' })
const LIT     = '<script>\nx = µlayout\n</script>\n'
const refus   = /« µlayout » lit le modèle choisi[\s\S]*\$layout/

describe('µlayout et $layout en raccourci d\'attribut', () => {
  const raccourcis = ['<p title="$layout">x</p>', '<p title=\'$layout\'>x</p>', '<p class="a $layout">x</p>', '<p title=$layout>x</p>', '<p data-a="1" title="le $layout.">x</p>']
  for (const html of raccourcis) {
    it(`${html} : refusé quand le <script> lit µlayout`, async () => {
      await assert.rejects(compile(LIT + html + '\n'), refus)
    })
  }

  it('refusé aussi quand c\'est le HTML qui lit µlayout', async () => {
    await assert.rejects(compile('<p title="$layout">{µlayout}</p>\n'), refus)
    await assert.rejects(compile('{if µlayout is \'a\'}<p>a</p>{end}\n<p title="$layout">x</p>\n'), refus)
  })

  it('refusé comme avant : entre accolades, ou la variable écrite dans le <script>', async () => {
    await assert.rejects(compile(LIT + '<p title={$layout}>x</p>\n'), refus)
    await assert.rejects(compile('<script>\n$layout = 1\nx = µlayout\n</script>\n<p>x</p>\n'), refus)
  })

  it('permis : le texte entre les balises, un autre nom, ou aucun µlayout', async () => {
    await compile(LIT + '<p>le prix $layout</p>\n')
    await compile(LIT + '<p title="$layouts">x</p>\n')
    await compile(LIT + '<p title="a$layout">x</p>\n')
    await compile(LIT + '<p title="layout">x</p>\n')
    await compile('<script>\n$layout = \'a\'\n</script>\n<p title="$layout">x</p>\n')
  })
})
