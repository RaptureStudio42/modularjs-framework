// Une chaîne interpolée écrite DANS l'interpolation d'une autre (`"x #{"y #{$v}"} z"`) : au <script>, le `#{` de la
// chaîne intérieure était pris pour un commentaire (`//{$v}` dans la sortie, texte faux à l'écran, `$v` jamais lu), et
// la chaîne intérieure n'était pas convertie en gabarit, ni au <script> ni au gabarit ; un symbole retiré (`&$v`) y
// passait sans erreur. Elle est désormais traitée comme au premier niveau

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

describe('interpolation dans une chaîne elle-même interpolée', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  it('au <script> : aucune marque de commentaire, la chaîne intérieure devient un gabarit qui lit la variable', async () => {
    const r = await transpile('<script>\n$v = 1\nd = "x #{"y #{$v}"} z"\n</script>\n<p>{$v}</p>\n', { moduleName: 'imbrique' })
    const ligne = r.output.split('\n').find((l: string) => /\bd = /.test(l)) ?? ''
    assert.doesNotMatch(ligne, /\/\/\{/)
    assert.match(ligne, /`x \$\{`y \$\{\$\.v\}`\} z`/)
  })

  it('un symbole retiré dans la chaîne intérieure est refusé, comme au premier niveau', async () => {
    await assert.rejects(transpile('<script>\n$v = 1\nd = "x #{"y #{&$v}"} z"\n</script>\n<p>{$v}</p>\n', { moduleName: 'imbrique' }), /« &\$ »/)
  })

  it('au montage : le texte rendu lit la variable, au <script> comme au gabarit', async () => {
    const { window, hote, erreurs } = await monterHote('<script>\n$v = 1\n$d = "x #{"y #{$v}"} z"\n</script>\n<p>{$d}</p>\n<b>{"a #{"b #{$v + 1}"} c"}</b>\n', 'imbrique')
    try {
      const p = hote._shadow.querySelector('p')
      const b = hote._shadow.querySelector('b')
      try { await attendre(() => p.textContent === 'x y 1 z' && b.textContent === 'a b 2 c', 1500) } catch {}
      assert.deepEqual([p.textContent, b.textContent, erreurs.length], ['x y 1 z', 'a b 2 c', 0])
    }
    finally { await window.happyDOM.close() }
  })
})
