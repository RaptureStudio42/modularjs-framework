// `@this` s'écrit `@this=!{ref}`. Sans le point d'exclamation (`@this={ref}`), l'attribut tombait dans le repli des événements : le composant
// écoutait un événement nommé « this », la variable ne recevait jamais le nœud, et la construction passait sans un mot. C'est maintenant une
// erreur de construction qui donne la bonne écriture, en français et en anglais, sur une balise HTML comme sur un composant ; la forme juste
// pose toujours la référence

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const source = (balise: string) => `<script>\n  µmount -> console.log(ref)\n</script>\n\n${balise}\n`

describe('@this sans point d\'exclamation : erreur de construction', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const [nom, balise] of [['balise HTML', '<canvas @this={ref} width="30"></canvas>'], ['composant', '<@enfant @this={ref}>']] as const) {
    it(`${nom} : refus qui donne la bonne écriture, en français`, async () => {
      await assert.rejects(() => transpile(source(balise), { moduleName: 'mjs-this-sans-point' }), (e: any) => {
        assert.match(e.message, /@this=!\{ref\}/, 'la bonne écriture')
        assert.match(e.message, /@this=\{ref\}/, 'ce qui est écrit')
        assert.match(e.message, /événement nommé « this »/, 'la raison')
        return true
      })
    })
  }

  it('en anglais', async () => {
    setMessagesLang('en')
    await assert.rejects(() => transpile(source('<canvas @this={ref}></canvas>'), { moduleName: 'mjs-this-sans-point' }), (e: any) => {
      assert.match(e.message, /@this=!\{ref\}/)
      assert.match(e.message, /event named "this"/)
      return true
    })
  })

  it('la forme juste pose la référence, aucun écouteur « this »', async () => {
    const { output } = await transpile(source('<canvas @this=!{ref} width="30"></canvas>'), { moduleName: 'mjs-this-juste' })
    assert.match(output, /ref = _mjs_node/)
    assert.doesNotMatch(output, /"this":\{/)
  })
})
