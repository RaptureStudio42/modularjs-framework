// `@this` s'écrit `@this=!{ref}`. Écrit sans valeur (`@this`) ou avec un texte (`@this="ref"`), il tombait dans le repli des événements,
// comme `@this={ref}` avant lui : le composant écoutait un événement nommé « this », aucune variable ne recevait le nœud, et la construction
// passait sans un mot. `@preload` sans valeur (sur un lien comme sur un composant) devenait de même l'écoute d'un événement nommé « preload »,
// et rien n'était préchargé : le préchargement d'un lien se règle par une valeur (`hover`, `on`, `off`), sans valeur par défaut. Ce sont
// maintenant des erreurs de construction qui donnent la bonne écriture, en français et en anglais. Les formes justes passent : `@this=!{ref}`
// pose la référence, `@preload="hover"` devient l'attribut lu au chargement, `@preload={…}` écoute toujours un événement « preload »

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const source = (balise: string) => `<script>\n  ref = null\n\n  @noter = (e)-> console.log(e)\n\n  µmount -> console.log(ref)\n</script>\n\n${balise}\n`

const THIS: [string, string, string][] = [
  ['@this sans valeur, balise HTML', '<canvas @this width="30"></canvas>', '« @this »'],
  ['@this sans valeur, composant', '<@enfant @this>', '« @this »'],
  ['@this="ref", balise HTML', '<canvas @this="ref" width="30"></canvas>', '« @this="ref" »'],
  ['@this="ref", composant', '<@enfant @this="ref">', '« @this="ref" »'],
]

const PRELOAD: [string, string][] = [
  ['lien', '<a href="/produit/42" @preload>Produit</a>'],
  ['composant', '<@enfant @preload>'],
]

describe('@this sans référence entre accolades, @preload sans valeur : erreurs de construction', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const [nom, balise, ecrit] of THIS) it(`${nom} : refus qui donne la bonne écriture, en français`, async () => {
    await assert.rejects(() => transpile(source(balise), { moduleName: 'mjs-this-sans-reference' }), (e: any) => {
      assert.ok(e.message.includes(ecrit), `ce qui est écrit : ${e.message}`)
      assert.match(e.message, /@this=!\{ref\}/, 'la bonne écriture')
      assert.match(e.message, /événement nommé « this »/, 'la raison')
      return true
    })
  })

  for (const [nom, balise] of PRELOAD) it(`@preload sans valeur, ${nom} : refus qui donne les valeurs, en français`, async () => {
    await assert.rejects(() => transpile(source(balise), { moduleName: 'mjs-preload-sans-valeur' }), (e: any) => {
      assert.match(e.message, /« @preload » sans valeur/, 'ce qui est écrit')
      for (const v of ['hover', 'on', 'off']) assert.ok(e.message.includes(`@preload="${v}"`), `la valeur ${v} : ${e.message}`)
      assert.match(e.message, /événement nommé « preload »/, 'la raison')
      assert.match(e.message, /@preload=\{…\}/, 'l\'écoute d\'un événement « preload », écrite')
      return true
    })
  })

  it('en anglais', async () => {
    setMessagesLang('en')
    await assert.rejects(() => transpile(source('<canvas @this="ref"></canvas>'), { moduleName: 'mjs-this-sans-reference' }), (e: any) => {
      assert.ok(e.message.includes('\'@this="ref"\': a node reference'), `l'écriture fautive, entre guillemets simples puisqu'elle contient des guillemets doubles : ${e.message}`)
      assert.ok(!e.message.includes('""'), `aucun guillemet doublé : ${e.message}`)
      assert.match(e.message, /@this=!\{ref\}/)
      assert.match(e.message, /event named "this"/)
      return true
    })
    await assert.rejects(() => transpile(source('<canvas @this></canvas>'), { moduleName: 'mjs-this-sans-reference' }), (e: any) => {
      assert.ok(e.message.includes('"@this": a node reference'), `sans valeur, entre guillemets doubles : ${e.message}`)
      return true
    })
    await assert.rejects(() => transpile(source('<a href="/x" @preload>x</a>'), { moduleName: 'mjs-preload-sans-valeur' }), (e: any) => {
      assert.match(e.message, /"@preload" without a value/)
      assert.ok(e.message.includes('@preload="hover"'), e.message)
      assert.match(e.message, /event named "preload"/)
      return true
    })
  })

  it('les formes justes passent : la référence posée, l\'attribut de préchargement, l\'écoute explicite d\'un événement « preload »', async () => {
    const ref = (await transpile(source('<canvas @this=!{ref} width="30"></canvas>'), { moduleName: 'mjs-this-juste' })).output
    assert.match(ref, /ref = _mjs_node/)
    assert.doesNotMatch(ref, /"this":\{/)
    const lien = (await transpile(source('<a href="/x" @preload="hover">x</a>'), { moduleName: 'mjs-preload-juste' })).output
    assert.match(lien, /data-mjs-preload=\\?['"]hover/)
    assert.doesNotMatch(lien, /"preload":\{/)
    const ecoute = (await transpile(source('<@enfant @preload={@noter(e)}>'), { moduleName: 'mjs-preload-ecoute' })).output
    assert.match(ecoute, /"preload":\{/, 'un événement « preload » s\'écoute toujours, écrit avec son gestionnaire')
  })
})
