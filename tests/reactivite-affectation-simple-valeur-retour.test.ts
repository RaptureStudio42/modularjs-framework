// Affectation réactive TOP-LEVEL ($.x = v / $.x op= v) utilisée comme VALEUR : deux défauts.
//
// 1. `µ._set` renvoie TOUJOURS `true` (compromis historique : un `return $.x = v`, très
//    courant en auto-return Coffee, restait volontairement la forme DIRECTE pour ne pas
//    perturber le routeur d'événements — qui appelle la valeur de retour d'un handler si
//    c'est une fonction). Hors de ce cas précis, toute affectation réactive consommée comme
//    valeur (return, affectation en chaîne, argument, condition) doit valoir la valeur
//    RÉELLEMENT affectée, exactement comme en JavaScript — y compris pour la forme composée
//    (`+=`, `-=`…), qui n'avait ELLE JAMAIS de forme fidèle, même hors `return`.
//
// 2. `_set` ne renvoyait jamais `false`, même quand l'écriture est refusée (clé
//    __proto__/constructor/prototype) : impossible pour un appelant de distinguer un refus
//    d'un succès.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const RETVAL = [
  '<script>',
  '$x = 1',
  '$captured = null',
  '$rappel = null',
  'essaiSet = ->',
  '  f = -> return $.x = 5',
  '  $.captured = f()',
  'essaiCompound = ->',
  '  $.x = 1',
  '  f = -> return $.x += 4',
  '  $.captured = f()',
  '</script>',
  '<button class="set" @click={essaiSet()}>set</button>',
  '<button class="compound" @click={essaiCompound()}>compound</button>',
  '<button class="range" @click={$rappel = -> $x = 42}>range</button>',
  '<p>{$captured}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('affectation-valeur')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'av-retval.mjs'), RETVAL)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('affectation réactive top-level utilisée comme valeur (return, forme composée)', function () {
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

  it('return $.x = 5 vaut 5 (la valeur affectée), pas true', async () => {
    const c = await app.mount('av-retval')
    try {
      await c.click('.set')
      assert.equal(c.state.captured, 5, 'la valeur capturée doit être celle affectée à $.x')
      assert.equal(c.state.x, 5)
    } finally {
      c.destroy()
    }
  })

  it('gestionnaire en ligne qui RANGE une fonction dans l\'état : elle n\'est pas exécutée au clic', async () => {
    // le routeur d'événements appelle une fonction RENVOYÉE par un gestionnaire (forme référence
    // `@click={save}`) : le retour implicite d'une affectation ne doit jamais lui livrer la valeur
    const c = await app.mount('av-retval')
    try {
      await c.click('.range')
      assert.equal(typeof c.state.rappel, 'function', 'la fonction doit être rangée dans l\'état')
      assert.equal(c.state.x, 1, 'la fonction rangée ne doit pas avoir été appelée par le routeur')
    } finally {
      c.destroy()
    }
  })

  it('return $.x += 4 vaut la nouvelle valeur (1 + 4 = 5), pas true', async () => {
    const c = await app.mount('av-retval')
    try {
      await c.click('.compound')
      assert.equal(c.state.captured, 5, 'la forme composée consommée comme valeur doit être fidèle')
      assert.equal(c.state.x, 5)
    } finally {
      c.destroy()
    }
  })

  it("_set refuse une clé __proto__/constructor/prototype et le SIGNALE (false), au lieu de true", async () => {
    const c = await app.mount('av-retval')
    try {
      assert.equal(c.el._set('__proto__', 'PWNED'), false, 'une écriture refusée doit rendre false')
      assert.equal(c.el._set('constructor', 'PWNED'), false)
      assert.equal(c.el._set('prototype', 'PWNED'), false)
    } finally {
      c.destroy()
    }
  })

  it('_set accepte toujours une clé normale et rend true', async () => {
    const c = await app.mount('av-retval')
    try {
      assert.equal(c.el._set('x', 9), true)
      assert.equal(c.state.x, 9)
    } finally {
      c.destroy()
    }
  })
})
