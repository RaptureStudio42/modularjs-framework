// `$n++`/`--$n` (état local ET store `$$obj.a++`) : le générateur émettait `_v + 1`/`_v - 1`
// SANS conversion numérique — en JavaScript natif, `++`/`--` convertissent TOUJOURS
// l'opérande en nombre avant de l'incrémenter (`ToNumeric`), y compris quand la variable
// contient une chaîne. Une valeur texte « 2 » (cas courant : `<input>` non typé) donnait
// donc « 21 » (concaténation) au lieu de 3. Le suffixe doit en plus valoir l'ANCIENNE
// valeur, déjà convertie en nombre — pas la chaîne d'origine.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const INCR_LOCAL = [
  '<script>',
  '$n = "2"',
  '$captured = null',
  'incr = -> $n++',
  'decr = -> $n--',
  'incrCaptured = -> $captured = $n++',
  'preIncr = -> ++$n',
  '</script>',
  '<button class="incr" @click={incr()}>incr</button>',
  '<button class="decr" @click={decr()}>decr</button>',
  '<button class="incrCaptured" @click={incrCaptured()}>incrCaptured</button>',
  '<button class="preIncr" @click={preIncr()}>preIncr</button>',
  '<p>{$n}</p>',
].join('\n')

const INCR_STORE = [
  '<script>',
  '$$sobj = {a: "2"}',
  '$scaptured = null',
  'sincr = -> $$sobj.a++',
  'sincrCaptured = -> $scaptured = $$sobj.a++',
  '</script>',
  '<button class="sincr" @click={sincr()}>sincr</button>',
  '<button class="sincrCaptured" @click={sincrCaptured()}>sincrCaptured</button>',
  '<p>{$$sobj.a}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('increment-numerique')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'incr-local.mjs'), INCR_LOCAL)
  writeFileSync(join(srcDir, 'incr-store.mjs'), INCR_STORE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('++/-- sur une variable réactive contenant une chaîne — conversion numérique JS', function () {
  this.timeout(60000)

  let root: string
  let app: any

  before(async () => {
    root = projetTemporaire()
    app  = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('$n++ sur "2" (état local) donne 3, un NOMBRE, pas "21"', async () => {
    const c = await app.mount('incr-local')
    try {
      await c.click('.incr')
      assert.equal(c.state.n, 3)
      assert.equal(typeof c.state.n, 'number')
    } finally {
      c.destroy()
    }
  })

  it('$n-- sur "2" (état local) donne 1', async () => {
    const c = await app.mount('incr-local')
    try {
      await c.click('.decr')
      assert.equal(c.state.n, 1)
      assert.equal(typeof c.state.n, 'number')
    } finally {
      c.destroy()
    }
  })

  it('$captured = $n++ (postfix consommé) : capture l\'ANCIENNE valeur numérique (2), $n devient 3', async () => {
    const c = await app.mount('incr-local')
    try {
      await c.click('.incrCaptured')
      assert.equal(c.state.captured, 2, 'ancienne valeur numérique')
      assert.equal(typeof c.state.captured, 'number')
      assert.equal(c.state.n, 3)
    } finally {
      c.destroy()
    }
  })

  it('++$n (préfixe) sur "2" donne 3', async () => {
    const c = await app.mount('incr-local')
    try {
      await c.click('.preIncr')
      assert.equal(c.state.n, 3)
      assert.equal(typeof c.state.n, 'number')
    } finally {
      c.destroy()
    }
  })

  it('$$sobj.a++ (store, profondeur 1) sur "2" donne 3', async () => {
    const c = await app.mount('incr-store')
    try {
      await c.click('.sincr')
      assert.equal(app.µ.store.sobj.a, 3)
      assert.equal(typeof app.µ.store.sobj.a, 'number')
    } finally {
      c.destroy()
    }
  })

  it('$scaptured = $$sobj.a++ (store, postfix consommé) capture l\'ancienne valeur numérique', async () => {
    const c = await app.mount('incr-store')
    try {
      await c.click('.sincrCaptured')
      assert.equal(c.state.scaptured, 2)
      assert.equal(typeof c.state.scaptured, 'number')
      assert.equal(app.µ.store.sobj.a, 3)
    } finally {
      c.destroy()
    }
  })
})
