// Garde du raccourcissement des noms internes (`assertNoStringIndexedMjsAccess`, src/bundler/minify.ts) : esbuild
// raccourcit `o._mjs_flag` en `o.t` sans toucher à la chaîne `"_mjs_flag"`. Deux formes lui échappaient :
// le test d'existence par `hasOwnProperty.call(o, '_mjs_x')` / `Object.hasOwn(o, '_mjs_x')`, et la clé d'objet
// entre guillemets `{ '_mjs_x': 1 }` — après minification, le test ne trouvait plus jamais la propriété, et la clé
// posée n'était plus celle que le code lisait, sans un mot au build.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNoStringIndexedMjsAccess } from '../src/bundler/minify.js'

const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime')

describe('garde du raccourcissement des noms internes — hasOwn et clés entre guillemets', function () {
  // la lecture de tout le runtime (près de 200 fichiers) dépasse les 2 s par défaut sur une machine chargée
  this.timeout(30000)

  it('`Object.prototype.hasOwnProperty.call(o, \'_mjs_x\')` : refusé', () => {
    assert.throws(() => assertNoStringIndexedMjsAccess("function f(o){ o._mjs_flag = 1; return Object.prototype.hasOwnProperty.call(o, '_mjs_flag') }", 'x.js'), /x\.js:1/)
  })

  it('`Object.hasOwn(o, "_mjs_x")` et `o.hasOwnProperty(\'_mjs_x\')` : refusés', () => {
    assert.throws(() => assertNoStringIndexedMjsAccess('const a = Object.hasOwn(o, "_mjs_flag")', 'x.js'), /hasOwn/)
    assert.throws(() => assertNoStringIndexedMjsAccess("const a = o.hasOwnProperty('_mjs_flag')", 'x.js'), /hasOwn/)
  })

  it('clé d\'objet entre guillemets `{ \'_mjs_x\': … }` : refusée', () => {
    assert.throws(() => assertNoStringIndexedMjsAccess("const g = { '_mjs_flag': 2 }", 'x.js'), /x\.js:1/)
    assert.throws(() => assertNoStringIndexedMjsAccess('const g = {\n  a: 1,\n  "_mjs_flag": 2\n}', 'x.js'), /x\.js:3/)
  })

  it('témoins acceptés : hasOwn sur une clé ordinaire ou derrière un nom pointé, clé non citée, chaîne de donnée', () => {
    assert.doesNotThrow(() => assertNoStringIndexedMjsAccess('var had = Object.prototype.hasOwnProperty.call(µ._mjs_storeRaw, key)', 'x.js'))
    assert.doesNotThrow(() => assertNoStringIndexedMjsAccess("const ok = Object.hasOwn(o, 'nom')", 'x.js'))
    assert.doesNotThrow(() => assertNoStringIndexedMjsAccess('const g = { _mjs_flag: 2, nom: 1 }', 'x.js'))
    assert.doesNotThrow(() => assertNoStringIndexedMjsAccess("const doc = 'écrivez { \\'_mjs_x\\': 1 } et hasOwn(o, \\'_mjs_x\\')'", 'x.js'))
    assert.doesNotThrow(() => assertNoStringIndexedMjsAccess("const t = c ? '_mjs_a' : '_mjs_b'", 'x.js'))
  })

  it('aucun fichier du runtime n\'écrit ces formes', () => {
    const fautifs: string[] = []
    for (const f of readdirSync(runtimeDir).filter(n => n.endsWith('.ts'))) {
      try {
        assertNoStringIndexedMjsAccess(readFileSync(join(runtimeDir, f), 'utf-8'), f)
      }
      catch (e) {
        fautifs.push((e as Error).message.split('\n')[0])
      }
    }
    assert.deepEqual(fautifs, [])
  })
})
