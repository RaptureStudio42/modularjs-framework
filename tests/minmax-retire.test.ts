// µminmax n'existe plus (V3) : les types du bloc <vars> le remplacent (`$volume  int 0..10`). Une
// rune µminmax restée dans un composant — script, interpolation, gestionnaire, avec ou sans
// parenthèses, sur une variable ou un chemin — refuse la compilation avec un message qui dit quoi
// écrire à la place, au lieu de partir au navigateur en `µ.minmax is not a function`. Un
// commentaire ou une chaîne qui le cite ne gêne rien.

import assert from 'node:assert/strict'
import { cleanJs, cleanJsExpr } from '../src/generator/utils.js'
import { transpile } from '../src/transpiler/index.js'

const MIGRATION = /µminmax[\s\S]*<vars>[\s\S]*int 0\.\.10/

describe('µminmax retiré : refusé à la compilation, avec la marche à suivre', () => {
  it('dans le <script>, toutes les formes', async () => {
    for (const ligne of ['µminmax($volume, 0, 10)', 'µminmax $volume, 0, 10', 'µminmax($x.volume, 0, 10)', "µminmax $x['cle'], 0, 10", 'µ.minmax($volume, 0, 10)']) {
      await assert.rejects(transpile(`<script>\n$volume = 5\n$x = {volume: 1}\n${ligne}\n</script>\n<p>{$volume}</p>`, { moduleName: 'minmax-retire' }), MIGRATION, ligne)
    }
  })

  it('dans une interpolation ou un gestionnaire du gabarit', async () => {
    assert.throws(() => cleanJs('µminmax($x, 0, 10)'), MIGRATION)
    assert.throws(() => cleanJsExpr('µminmax($x, 0, 10)'), MIGRATION)
    await assert.rejects(transpile('<script>\n$x = 1\n</script>\n<button @click={µminmax($x, 0, 10)}>b</button>', { moduleName: 'minmax-retire-gestionnaire' }), MIGRATION)
  })

  it('un commentaire ou une chaîne qui le cite ne gêne rien', async () => {
    assert.doesNotThrow(() => cleanJs('// µminmax($x, 0, 10) a disparu\ndoStuff()'))
    await assert.doesNotReject(transpile("<script>\n# µminmax $x, 0, 10 : remplacé par <vars>\n$t = 'µminmax'\n</script>\n<p>{$t}</p>", { moduleName: 'minmax-cite' }))
  })

  it('la grille CSS minmax() reste du CSS', async () => {
    await assert.doesNotReject(transpile('<p>x</p>\n<style>\np\n  display: grid\n  grid-template-columns: minmax(10px, 1fr)\n</style>', { moduleName: 'minmax-css' }))
  })
})
