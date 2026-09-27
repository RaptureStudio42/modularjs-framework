// Mutation profonde compilée ($.obj.x = v, µ._mjs_deepSet/_mjs_deepCall/_mjs_deepDelete) :
// deux régressions distinctes.
//
// 1. Un enfant lié en two-way (`obj=!{$obj}`) qui écrit une propriété profonde de
//    l'objet partagé (`$obj.x = 2`, `$obj.a.b = 3`) ne prévenait jamais le parent — seule
//    une mutation passée par le Proxy filet (alias échappé) le faisait. Le chemin compilé
//    écrit directement sur l'objet brut, sans jamais faire avancer l'« époque » de mutation
//    que le two-way compare pour distinguer un écho d'une mutation réelle — le parent
//    croyait donc recevoir un écho et ignorait la notification, à toute profondeur.
//
// 2. Une affectation ou une suppression profonde utilisée comme VALEUR (`$captured = ($.obj.x
//    = 7)`, `$captured = (delete $.obj.x)`) rendait `undefined` au lieu de la valeur réellement
//    affectée ou de `true` — le retour de la notification était renvoyé tel quel, au lieu de la
//    valeur JS attendue.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CHILD = [
  '<script>',
  '$obj ?= { x: 0, a: { b: 0 } }',
  '</script>',
  '<button class="setx" @click={$obj.x = 2}>x</button>',
  '<button class="setab" @click={$obj.a.b = 3}>ab</button>',
  '<p class="x">{$obj.x}</p>',
  '<p class="ab">{$obj.a.b}</p>',
].join('\n')

const PARENT = [
  '<script>',
  '$obj = { x: 0, a: { b: 0 } }',
  '</script>',
  '<p class="px">{$obj.x}</p>',
  '<p class="pab">{$obj.a.b}</p>',
  '<mjs-mp-child obj=!{$obj}></mjs-mp-child>',
].join('\n')

const RETVAL = [
  '<script>',
  '$obj = { x: 1 }',
  '$captured = null',
  'essaiSet = ->',
  '  f = -> return $.obj.x = 7',
  '  $.captured = f()',
  'essaiDelete = ->',
  '  f = -> return delete $.obj.x',
  '  $.captured = f()',
  '</script>',
  '<button class="set" @click={essaiSet()}>set</button>',
  '<button class="del" @click={essaiDelete()}>del</button>',
  '<p>{$captured}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('mutation-profonde')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'mp-child.mjs'), CHILD)
  writeFileSync(join(srcDir, 'mp-parent.mjs'), PARENT)
  writeFileSync(join(srcDir, 'mp-retval.mjs'), RETVAL)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('mutation profonde compilée — liaison two-way et valeur affectée', function () {
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

  it("l'enfant écrit une propriété profonde (profondeur 1) : le parent affiche la nouvelle valeur", async () => {
    const parent = await app.mount('mp-parent')
    try {
      const child = parent.find('mjs-mp-child')
      assert.ok(child, `le composant enfant doit être dans le rendu :\n${parent.html()}`)
      child._shadow.querySelector('.setx').dispatchEvent(new app.window.Event('click', { bubbles: true }))
      await parent.tick()
      assert.equal(parent.state.obj.x, 2, 'état du parent muté (objet partagé)')
      assert.equal(child._shadow.querySelector('.x').textContent, '2', 'rendu enfant à jour')
      assert.equal(parent.find('.px').textContent, '2', 'rendu PARENT à jour — le two-way remonte la mutation profonde')
    } finally {
      parent.destroy()
    }
  })

  it("l'enfant écrit une propriété à deux niveaux de profondeur ($obj.a.b) : le parent affiche la nouvelle valeur", async () => {
    const parent = await app.mount('mp-parent')
    try {
      const child = parent.find('mjs-mp-child')
      child._shadow.querySelector('.setab').dispatchEvent(new app.window.Event('click', { bubbles: true }))
      await parent.tick()
      assert.equal(parent.state.obj.a.b, 3, 'état du parent muté (deuxième niveau)')
      assert.equal(child._shadow.querySelector('.ab').textContent, '3', 'rendu enfant à jour')
      assert.equal(parent.find('.pab').textContent, '3', 'rendu parent à jour à deux niveaux de profondeur')
    } finally {
      parent.destroy()
    }
  })

  it('une seule notification par mutation profonde côté parent — pas de double rendu ni de boucle', async () => {
    const parent = await app.mount('mp-parent')
    try {
      const child = parent.find('mjs-mp-child')
      let notifs = 0
      const original = parent.el._mjs_notifyMutation.bind(parent.el)
      parent.el._mjs_notifyMutation = (k: string, old: any) => { if (k === 'obj') notifs++; return original(k, old) }
      child._shadow.querySelector('.setx').dispatchEvent(new app.window.Event('click', { bubbles: true }))
      await parent.tick()
      assert.equal(notifs, 1, 'exactement une notification du parent pour cette mutation, pas de double compte ni de boucle')
    } finally {
      parent.destroy()
    }
  })

  it("une affectation profonde utilisée comme valeur de retour vaut la valeur affectée, pas true", async () => {
    const c = await app.mount('mp-retval')
    try {
      await c.click('.set')
      assert.equal(c.state.captured, 7, 'la valeur capturée doit être celle affectée à $.obj.x, pas le retour de la notification')
    } finally {
      c.destroy()
    }
  })

  it('une suppression profonde utilisée comme valeur de retour vaut true', async () => {
    const c = await app.mount('mp-retval')
    try {
      await c.click('.del')
      assert.equal(c.state.captured, true, 'delete $.obj.x utilisé comme valeur doit valoir true, comme en JavaScript')
    } finally {
      c.destroy()
    }
  })
})
