// `_mjs_wrapDeep` (filet Proxy de l'état $ d'un composant, mutations profondes échappées
// au suivi statique) : deux défauts du piège `get`.
//
// 1. Lire `__proto__`/`constructor`/`prototype` HÉRITÉS (pas une donnée propre de l'objet)
//    renvoyait la valeur réelle (Object.prototype…), elle-même enveloppée récursivement dans
//    un NOUVEAU Proxy dont la cible EST Object.prototype — écrire dessus pollue le prototype
//    de TOUS les objets du realm. Seule l'ÉCRITURE d'une clé interdite était gardée
//    (`µ._mjs_safeKey`) ; la LECTURE, elle, ne l'était pas.
//
// 2. `map.get(clé)` (Map stockée dans l'état, `isWrapped`) rendait la valeur INTERNE brute,
//    jamais ré-enveloppée : muter l'objet obtenu échappait à toute réactivité.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const DUMMY = '<script>\n$dummy = 0\n</script>\n<p>{$dummy}</p>\n'

function projetTemporaire(): string {
  const root   = mjsTmp('etat-proxy-securite')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'proxy-dummy.mjs'), DUMMY)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('_mjs_wrapDeep (état $ de composant) — lecture __proto__ et Map.get()', function () {
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

  it("lire __proto__ sur un état profond enveloppé rend undefined — jamais Object.prototype", async () => {
    const c = await app.mount('proxy-dummy')
    try {
      const wrapped = c.el._mjs_wrapDeep({ a: 1 }, 'zz')
      assert.equal(wrapped.__proto__, undefined, '__proto__ hérité ne doit jamais être exposé par le proxy')
      assert.equal(wrapped.constructor, undefined, 'constructor hérité ne doit jamais être exposé par le proxy')
      assert.equal(wrapped.prototype, undefined, 'prototype hérité ne doit jamais être exposé par le proxy')
    } finally {
      c.destroy()
    }
  })

  it("une clé PROPRE nommée constructor/proto reste lisible normalement (donnée réelle)", async () => {
    const c = await app.mount('proxy-dummy')
    try {
      const wrapped = c.el._mjs_wrapDeep({ constructor: 'valeur métier', autre: 1 }, 'zz2')
      assert.equal(wrapped.constructor, 'valeur métier', 'une propriété PROPRE nommée constructor doit rester lisible')
    } finally {
      c.destroy()
    }
  })

  it("un alias échappé (paramètre de fonction, hors suivi statique) : $obj.__proto__ ne pollue plus Object.prototype", async () => {
    // `o` est un PARAMÈTRE de fonction : le suivi statique du compilateur ne le
    // traite jamais comme un alias de `$obj` (« taint », cf. path-tracker.ts) — la
    // lecture `o.__proto__` passe donc par le VRAI filet Proxy (_mjs_wrapDeep),
    // pas par le chemin compilé (_mjs_deepSet, déjà gardé par µ._mjs_guardPath).
    const root2 = mjsTmp('etat-proxy-securite-leak')
    const srcDir = join(root2, 'src')
    mkdirSync(srcDir, { recursive: true })
    const src = [
      '<script>',
      '$obj = {x: 0}',
      'leakVia = (o) ->',
      '  p = o.__proto__',
      '  p.injectedViaParam = "valeur-injectee"',
      '$leak = -> leakVia($obj)',
      '</script>',
      '<button @click={$leak()}>test</button>',
    ].join('\n')
    writeFileSync(join(srcDir, 'proxy-leak.mjs'), src)
    writeFileSync(join(root2, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    const app2 = await createHarness({ root: root2 })
    // `$obj` est créé PAR le code évalué dans la fenêtre happy-dom : son prototype
    // est celui du REALM de la fenêtre, pas celui de ce process Node — la pollution
    // (si elle a lieu) se lit donc sur `app2.window.Object.prototype`.
    const winProto = app2.window.Object.prototype
    try {
      const c = await app2.mount('proxy-leak')
      const before = winProto.injectedViaParam
      assert.equal(before, undefined)
      // `p` vaut désormais `undefined` (garde de lecture) : écrire une clé dessus lève —
      // qu'elle remonte au clic ou reste interne au handler, seule l'ABSENCE de pollution compte.
      try { await c.click('button') } catch { /* attendu : écriture sur undefined */ }
      const fuite = winProto.injectedViaParam
      assert.equal(fuite, undefined, 'Object.prototype (realm de la fenêtre) ne doit pas avoir été pollué')
    } finally {
      delete winProto.injectedViaParam
      await app2.destroy()
    }
  })

  it('map.get(clé) rend un objet ENVELOPPÉ — le muter redessine', async () => {
    const c = await app.mount('proxy-dummy')
    try {
      // Map créée dans le REALM de la fenêtre : `_mjs_wrapDeep` (évalué par
      // `window.eval`) teste `target instanceof Map` avec SON PROPRE `Map` —
      // une Map créée côté Node échouerait ce test (instanceof cross-realm) et
      // ressortirait brute d'entrée de jeu, faussant le test.
      const rawMap = new app.window.Map([['x', { n: 0 }]])
      const wrapped = c.el._mjs_wrapDeep(rawMap, 'mymap')
      const got1 = wrapped.get('x')
      assert.notEqual(got1, rawMap.get('x'), 'get() doit rendre un Proxy, pas l\'objet brut')
      got1.n = 42
      assert.equal(rawMap.get('x').n, 42, 'la mutation à travers le proxy doit bien atteindre le brut')
    } finally {
      c.destroy()
    }
  })
})
