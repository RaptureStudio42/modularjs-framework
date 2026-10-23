// Un effet de l'appli (fichier `*.effects.mjs`) donné en réglage d'un autre effet — `*delta(fx: *titre)` :
// le composant dépend de ce fichier comme s'il posait l'effet lui-même, pour que `mjs dev` le recompile
// quand l'effet change (un effet réglé comme un effet CSS).

import assert from 'node:assert/strict'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { collectEffectDefs } from '../src/bundler/effects-files.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('effets de l\'appli donnés en réglage : le composant en dépend', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un effet réglé en réglage (*delta(fx: *titre)) : la transpilation le dit au bundler', async () => {
    const effectDefs = collectEffectDefs(['/x/app.effects.mjs'], () => '<effects>\n  *titre = *scramble(20)\n</effects>\n')
    const res = await transpileFromMsg({ type: 'transpile', id: 0, content: '<script>\n$n = 1\n</script>\n<b *delta(fx: *titre)>{$n}</b>\n', moduleName: 'c', preResolvedAssets: {}, effectDefs })
    assert.equal(res.data.usesProjectEffects, true)
  })

  it('un effet CSS de l\'appli en réglage : pareil', async () => {
    const effectDefs = collectEffectDefs(['/x/app.effects.mjs'], () => '<effects>\n  *halo =\n    box-shadow: 0 0 8px #0ff\n</effects>\n')
    const res = await transpileFromMsg({ type: 'transpile', id: 0, content: '<script>\n$n = 1\n</script>\n<b *delta(fx: *halo)>{$n}</b>\n', moduleName: 'c', preResolvedAssets: {}, effectDefs })
    assert.equal(res.data.usesProjectEffects, true)
  })
})
