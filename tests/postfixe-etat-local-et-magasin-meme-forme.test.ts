// `$y = $x++` (valeur lue) sortait sous deux formes selon la cible : `((_v => …)(lu))` pour l'état local,
// `((_v) => …)(lu)` pour le magasin et un chemin. Une seule écriture désormais, même sens : l'ancienne valeur, en nombre

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const SOURCE = '<script>\n$x = "2"\n$y = 0\n$$s = 5\n$z = 0\nf = -> $y = $x++\ng = -> $z = $$s--\n</script>\n<button @click={f()}>{$x}-{$y}</button>\n<i @click={g()}>{$$s}-{$z}</i>\n'

describe('postfixe lu : une seule forme pour l\'état local et le magasin', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  it('l\'état local s\'écrit comme le magasin', async () => {
    const r = await transpile(SOURCE, { moduleName: 'postfixe' })
    assert.doesNotMatch(r.output, /\(\(_v => \(/)
    assert.match(r.output, /\(\(_v\) => \(µ\._set\(_mjsThis, 'x', \(\+_v\) \+ 1\), \+_v\)\)\(\$\.x\)/)
  })

  it('même sens au clic : l\'ancienne valeur, convertie en nombre', async () => {
    const { window, hote, erreurs } = await monterHote(SOURCE, 'postfixe')
    try {
      const b = hote._shadow.querySelector('button')
      const i = hote._shadow.querySelector('i')
      b.click()
      i.click()
      try { await attendre(() => b.textContent === '3-2' && i.textContent === '4-5', 1500) } catch {}
      assert.deepEqual([b.textContent, i.textContent, erreurs.length], ['3-2', '4-5', 0])
    }
    finally { await window.happyDOM.close() }
  })
})
