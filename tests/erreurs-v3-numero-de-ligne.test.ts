// Erreurs de la 3.0 qui citent leur ligne : un bloc <types> ou <effects> posé dans un composant, une
// variable du <vars> qui reçoit un ressort (µspring, µinterpolate), une variable $layout homonyme de
// µlayout. La ligne est celle du fichier .mjs, là où la faute est écrite.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const cite = (ligne: number, ...motifs: RegExp[]) => (err: any) => err.message.includes(`ligne ${ligne}`) && motifs.every((m) => m.test(err.message))

describe('erreurs de la 3.0 : le numéro de ligne', () => {
  it('<types> dans un composant', async () => {
    await assert.rejects(transpile('<!-- a -->\n<p></p>\n<types>\nPercent int 0..100\n</types>\n', { moduleName: 'ligne-types' }), cite(3, /\*\.types\.mjs/))
  })

  it('<effects> dans un composant', async () => {
    await assert.rejects(transpile('<p></p>\n<effects>\n  lueur  *neon(#0ff)\n</effects>\n', { moduleName: 'ligne-effets' }), cite(2, /\*\.effects\.mjs/))
  })

  it('un ressort sur une variable typée, dans le script', async () => {
    await assert.rejects(transpile('<vars>\n$x float\n</vars>\n<script>\n$y = 1\n$x = µspring(0)\n</script>\n<p>{$x}{$y}</p>\n', { moduleName: 'ligne-ressort' }), cite(6, /\$x/, /µspring/))
  })

  it('un ressort sur une variable typée, dans un gestionnaire du HTML', async () => {
    await assert.rejects(transpile('<vars>\n$x float\n</vars>\n<p>{$x}</p>\n<button @click={$x = µinterpolate(1)}>b</button>\n', { moduleName: 'ligne-ressort-html' }), cite(5, /\$x/, /µinterpolate/))
  })

  it('un ressort sur un store typé, dans le <script module>', async () => {
    await assert.rejects(transpile('<vars>\n$$x float\n</vars>\n<script module>\n  a = 1\n  $$x = µspring(0)\n</script>\n<p>{$$x}</p>\n', { moduleName: 'ligne-ressort-module' }), cite(6, /\$\$x/, /µspring/))
  })

  it('une variable $layout homonyme de µlayout', async () => {
    await assert.rejects(transpile("<script>\n  a = 1\n  $layout = 'x'\n</script>\n<p>{µlayout}{a}</p>\n", { moduleName: 'ligne-homonyme' }), cite(3, /\$layout/))
  })
})
