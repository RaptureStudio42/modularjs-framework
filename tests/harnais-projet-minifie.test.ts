// Le harnais de test d'une appli (`createHarness`) sur un projet minifié (`"minify": true`) : chaque
// fichier du build importe le cœur sous un nom court (`import{µ as o}`), que le harnais doit relier au
// cœur déjà chargé ; un fichier d'effet qui refuse de s'évaluer ne doit pas emporter tout le harnais.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(etiquette: string, config: Record<string, unknown>) {
  const root = mjsTmp('harnais-minifie-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  writeFileSync(join(root, 'src', 'carte.mjs'), '<p class="t" *neon>Bonjour</p>\n')
  return root
}

describe('harnais de test : un projet minifié', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [etiquette, config] of [['dev', {}], ['minifie', { minify: true }]] as const) {
    it(`${etiquette} : le composant se monte et son effet se pose`, async () => {
      const app = await createHarness({ root: projet(etiquette, config) })
      try {
        const c = await app.mount('carte')
        assert.match(String(c.find('.t')?.getAttribute('mjs-fx') ?? ''), /neon/)
      }
      finally {
        await app.destroy()
      }
    })
  }

  // minifié, chaque fichier reçoit des noms courts tirés du même alphabet (`class o`, `function r`) :
  // évalués côte à côte, sans la portée propre d'un module, ils s'écrasaient — le second composant
  // ne s'évaluait plus, ou la fonction d'un composant remplaçait celle du cœur. Un composant simple et son
  // voisin passaient aussi côte à côte : un formulaire `@submit.prevent` et une entrée `@in=*fade` y plantaient au montage
  it('minifie, deux composants : chacun se monte et fonctionne, un formulaire @submit.prevent et une entrée @in=*fade', async () => {
    const root = projet('deux', { minify: true })
    writeFileSync(join(root, 'src', 'envoi.mjs'), '<script>\n$envoye = false\n</script>\n<form class="f" @submit.prevent={$envoye = true}><button class="ok">Envoyer</button></form>\n<p class="e">{$envoye}</p>\n')
    writeFileSync(join(root, 'src', 'entree.mjs'), '<p class="t" @in=*fade>Bonjour</p>\n')
    const app = await createHarness({ root })
    try {
      const envoi  = await app.mount('envoi')
      const entree = await app.mount('entree')
      assert.equal(envoi.text('.e'), 'false')
      await envoi.click('.ok')
      assert.equal(envoi.text('.e'), 'true', 'le formulaire est envoyé sans navigation : son gestionnaire a tourné')
      assert.equal(entree.find('.t')?.textContent, 'Bonjour')
    }
    finally {
      await app.destroy()
    }
  })

  it('stripEsm relie, sur demande, le nom court du cœur importé ; sans demande, rien ne change', () => {
    const code = 'import{µ as o}from"/out/mjs_core-12345678.js";o._x=1;'
    assert.match(stripEsm(code, { bridgeCore: true }), /var o = µ;/)
    assert.doesNotMatch(stripEsm(code), /var o = µ;/)
    assert.doesNotMatch(stripEsm('import{µ}from"/out/mjs_core-12345678.js";µ._x=1;', { bridgeCore: true }), /var µ = µ/)
  })
})
