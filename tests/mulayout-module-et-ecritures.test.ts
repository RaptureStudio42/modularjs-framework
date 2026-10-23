// µlayout se lit dans le <script> d'un composant et dans son HTML, jamais ailleurs, et ne s'écrit pas.
// Dans un <script module> (partagé par toutes les instances), il se réécrivait en `$.layout` au
// niveau du module : ReferenceError au chargement, ou le `$` d'une autre bibliothèque ; il est refusé
// avec la raison. Toutes les écritures sont refusées par le message de µlayout — `?=`, `:=`, `++`
// comprises, qui finissaient en erreur d'analyse cryptique. Comparer, passer ou lire µlayout reste permis.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const ecrit = /« µlayout » se lit, il ne s'écrit pas/

describe('µlayout : ni en <script module>, ni écrit', () => {
  it('dans un <script module> : refusé, le message dit pourquoi', async () => {
    await assert.rejects(
      transpile('<script module>\n  export modeleDe := -> µlayout\n</script>\n<p>x</p>\n', { moduleName: 'layout-module' }),
      (err: any) => /µlayout/.test(err.message) && err.message.includes('<script module>')
    )
  })

  for (const [forme, code] of [['?=', "µlayout ?= 'a'"], [':=', "µlayout := 'a'"], ['++', 'µlayout++'], ['++ devant', '++µlayout'], ['||=', "µlayout ||= 'a'"]]) {
    it(`écrit par ${forme} dans le script : le message de µlayout`, async () => {
      await assert.rejects(transpile(`<script>\n  ${code}\n</script>\n<p>{µlayout}</p>\n`, { moduleName: 'layout-ecrit' }), ecrit)
    })
  }

  it('écrit par ?= dans un gestionnaire du HTML : le message de µlayout', async () => {
    await assert.rejects(transpile("<button @click={µlayout ?= 'x'}>b</button>\n", { moduleName: 'layout-ecrit-html' }), ecrit)
  })

  it('le lire, le comparer, le passer : permis', async () => {
    const src = "<script>\n  a := µlayout == 'x'\n  b := if µlayout is 'y' then 1 else 2\n  c := { m: µlayout }\n  d := if a then µlayout else 'z'\n  e := µlayout != 'w' and µlayout <= 'v'\n</script>\n<p>{a}{b}{c.m}{d}{e}{µlayout}</p>\n"
    const { data } = await transpile(src, { moduleName: 'layout-lu' })
    assert.equal(data.layoutRune, true)
  })
})
