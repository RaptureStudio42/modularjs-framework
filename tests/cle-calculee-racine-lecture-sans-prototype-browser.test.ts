// clé calculée à la racine de l'état, LUE (`x = $[k]`, `Object.assign($[c.nom], …)`, `return $[k]`), dans Chromium et Firefox, script en
// mode strict, avec et sans l'enveloppe : une clé venue de données qui vaut `__proto__`, `constructor` ou `prototype` ne rend jamais
// Object.prototype ni la fonction Object au code de l'appli, et rien ne s'écrit dans les objets communs de la page ; une clé juste lit
// et écrit la fiche

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { codeStrict } from './helpers/construction-stricte.js'

const COMPOSANT = `<script lang="js">
$fiche = { valeur: '', n: 0 };
this.alias = function(k, v) { const x = $[k]; x.valeur = v; };
this.assign = function(k, v) { const c = { nom: k }; Object.assign($[c.nom], { valeur: v }); };
this.lit = function(k) { return $[k]; };
</script>
<p>{$fiche.valeur}</p>
`

// chaque forme par chaque clé : les clés neuves des objets communs relevées puis effacées (la suivante part d'objets propres), et ce que
// rend la lecture seule ; puis une clé juste
const SCENARIO = `(() => {
  const e      = document.querySelector('mjs-cle-lue')
  const communs = { 'Object.prototype': Object.prototype, 'Object': Object, 'Function.prototype': Function.prototype }
  const photo  = () => Object.fromEntries(Object.entries(communs).map(([n, o]) => [n, new Set(Reflect.ownKeys(o))]))
  const pollue = []
  const rendus = []
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    for (const m of ['alias', 'assign']) {
      const avant = photo()
      try { e[m](k, 'P') } catch (x) {}
      for (const [n, o] of Object.entries(communs)) for (const c of Reflect.ownKeys(o)) if (!avant[n].has(c)) { pollue.push(m + ' ' + k + ' : ' + n + '.' + String(c)); Reflect.deleteProperty(o, c) }
    }
    const r = e.lit(k)
    if (r === Object.prototype || r === Object || r === Function.prototype) rendus.push(k)
  }
  e.assign('fiche', 'ok')
  const assign = e.lit('fiche').valeur
  e.alias('fiche', 'ok2')
  return JSON.stringify({ pollue, rendus, assign, alias: e.lit('fiche').valeur })
})()`

const ATTENDU = { pollue: [], rendus: [], assign: 'ok', alias: 'ok2' }

for (const moteur of ['chromium', 'firefox']) {
  describe(`clé calculée à la racine de l'état, lue (\`x = $[k]\`, \`Object.assign($[k], …)\`), dans ${moteur} : jamais Object.prototype ni Object`, function () {
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
      it(`${nom} : \`__proto__\`, \`constructor\`, \`prototype\` n'écrivent rien dans les objets communs, la lecture ne les rend pas ; une clé juste lit et écrit`, async () => {
        const code    = await codeStrict('cle-racine-lue-' + moteur, { 'cle-lue': COMPOSANT }, reglages)
        const page    = await navigateur.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(e.message))
        await page.setContent('<!doctype html><html><body><mjs-cle-lue></mjs-cle-lue></body></html>')
        await page.addScriptTag({ content: code })
        await page.waitForFunction(() => !!(document.querySelector('mjs-cle-lue') as any)?._shadow?.querySelector('p'))
        assert.deepEqual(JSON.parse(await page.evaluate(SCENARIO)), ATTENDU)
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    }
  })
}
