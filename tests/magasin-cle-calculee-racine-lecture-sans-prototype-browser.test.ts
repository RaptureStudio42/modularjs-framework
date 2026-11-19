// clé calculée à la racine du magasin, LUE (`Object.assign(µ.store[k], …)`, `Object.defineProperty`, `Reflect.set`, `x = µ.store[k]`
// puis `x.valeur = v`, `return µ.store[k]`), y compris par un alias du magasin (`s = µ.store; s[k]`, `µ['store'][k]`, `(0, µ.store)[k]`), dans Chromium et Firefox, script en mode strict, avec et sans l'enveloppe : une clé venue
// de données qui vaut `__proto__`, `constructor` ou `prototype` ne rend jamais Object.prototype ni la fonction Object au code de l'appli,
// et rien ne s'écrit dans les objets communs de la page ; une clé juste lit et écrit la fiche du magasin

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { codeStrict } from './helpers/construction-stricte.js'

const COMPOSANT = `<script lang="js">
$$fiche = { valeur: '', n: 0 };
this.assign = function(k, v) { Object.assign(µ.store[k], { valeur: v }); };
this.define = function(k, v) { Object.defineProperty(µ.store[k], 'valeur', { value: v, writable: true, enumerable: true, configurable: true }); };
this.reflect = function(k, v) { Reflect.set(µ.store[k], 'valeur', v); };
this.alias = function(k, v) { const x = µ.store[k]; x.valeur = v; };
this.lit = function(k) { return µ.store[k]; };
this.aliasMag = function(k, v) { const s = µ.store; s[k].valeur = v; };
this.aliasMagAssign = function(k, v) { const s = µ.store; Object.assign(s[k], { valeur: v }); };
this.crochet = function(k, v) { Object.assign(µ['store'][k], { valeur: v }); };
this.virgule = function(k, v) { Object.assign((0, µ.store)[k], { valeur: v }); };
this.litAlias = function(k) { const s = µ.store; return s[k]; };
this.litCrochet = function(k) { return µ['store'][k]; };
</script>
<p>{$$fiche.valeur}</p>
`

// chaque forme par chaque clé : les clés neuves des objets communs relevées puis effacées (la suivante part d'objets propres), et ce que
// rend la lecture seule ; puis chaque forme par une clé juste, relue dans la fiche
const SCENARIO = `(() => {
  const e       = document.querySelector('mjs-magasin-lu')
  const communs = { 'Object.prototype': Object.prototype, 'Object': Object, 'Function.prototype': Function.prototype }
  const formes  = ['assign', 'define', 'reflect', 'alias', 'aliasMag', 'aliasMagAssign', 'crochet', 'virgule']
  const photo   = () => Object.fromEntries(Object.entries(communs).map(([n, o]) => [n, new Set(Reflect.ownKeys(o))]))
  const pollue  = []
  const rendus  = []
  const justes  = {}
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    for (const m of formes) {
      const avant = photo()
      try { e[m](k, 'P') } catch (x) {}
      for (const [n, o] of Object.entries(communs)) for (const c of Reflect.ownKeys(o)) if (!avant[n].has(c)) { pollue.push(m + ' ' + k + ' : ' + n + '.' + String(c)); Reflect.deleteProperty(o, c) }
    }
    for (const l of ['lit', 'litAlias', 'litCrochet']) {
      const r = e[l](k)
      if (r === Object.prototype || r === Object || r === Function.prototype) rendus.push(l + ' ' + k)
    }
  }
  for (const m of formes) {
    e[m]('fiche', 'ok ' + m)
    justes[m] = e.lit('fiche').valeur
  }
  return JSON.stringify({ pollue, rendus, justes })
})()`

const ATTENDU = { pollue: [], rendus: [], justes: { assign: 'ok assign', define: 'ok define', reflect: 'ok reflect', alias: 'ok alias', aliasMag: 'ok aliasMag', aliasMagAssign: 'ok aliasMagAssign', crochet: 'ok crochet', virgule: 'ok virgule' } }

for (const moteur of ['chromium', 'firefox']) {
  describe(`clé calculée à la racine du magasin, lue (\`Object.assign(µ.store[k], …)\`, \`x = µ.store[k]\`), dans ${moteur} : jamais Object.prototype ni Object`, function () {
    this.timeout(120000)
    let navigateur: any

    before(async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      navigateur = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    })

    after(async () => {
      await navigateur?.close()
      await terminateSharedWorkerPool()
    })

    for (const [nom, reglages] of [['avec l\'enveloppe', {}], ['réglage `"proxy": false`', { proxy: false }]] as const) {
      it(`${nom} : \`__proto__\`, \`constructor\`, \`prototype\` n'écrivent rien dans les objets communs par \`Object.assign\`, \`Object.defineProperty\`, \`Reflect.set\` ni un alias, la lecture ne les rend pas ; une clé juste lit et écrit`, async () => {
        const code    = await codeStrict('magasin-racine-lu-' + moteur, { 'magasin-lu': COMPOSANT }, reglages)
        const page    = await navigateur.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(e.message))
        await page.setContent('<!doctype html><html><body><mjs-magasin-lu></mjs-magasin-lu></body></html>')
        await page.addScriptTag({ content: code })
        await page.waitForFunction(() => !!(document.querySelector('mjs-magasin-lu') as any)?._shadow?.querySelector('p'))
        assert.deepEqual(JSON.parse(await page.evaluate(SCENARIO)), ATTENDU)
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    }
  })
}
