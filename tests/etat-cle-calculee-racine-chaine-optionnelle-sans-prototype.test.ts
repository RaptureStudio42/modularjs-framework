// clé calculée à la racine de l'état lue derrière `?.` (`x = $?.[k]`, `Object.assign($?.[k], …)`, `return $?.[k]`), dans un composant
// qui n'écrit `$[` nulle part ailleurs : une clé venue de données qui vaut `__proto__`, `constructor` ou `prototype` ne rend jamais
// Object.prototype ni la fonction Object, et rien ne s'écrit dans les objets communs de la page ; une clé juste lit et écrit la fiche.
// Vraie construction, mode strict, avec et sans l'enveloppe

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'

const COMPOSANT = `<script lang="js">
$fiche = { valeur: '' };
this.assign = function(k, v) { Object.assign($?.[k], { valeur: v }); };
this.alias = function(k, v) { const x = $?.[k]; x.valeur = v; };
this.lit = function(k) { return $?.[k]; };
</script>
<p>{$fiche.valeur}</p>
`

// chaque forme par chaque clé : les clés neuves des objets communs relevées puis effacées (la suivante part d'objets propres), et ce que
// rend la lecture seule ; puis une clé juste
const SCENARIO = `(() => {
  const e       = document.querySelector('mjs-etat-optionnel')
  const communs = { 'Object.prototype': Object.prototype, 'Object': Object, 'Function.prototype': Function.prototype }
  const photo   = () => Object.fromEntries(Object.entries(communs).map(([n, o]) => [n, new Set(Reflect.ownKeys(o))]))
  const pollue  = []
  const rendus  = []
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    for (const m of ['assign', 'alias']) {
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

describe('clé calculée à la racine de l\'état lue derrière `?.` (`x = $?.[k]`, `Object.assign($?.[k], …)`), seule forme `$[` du composant : jamais Object.prototype ni Object', function () {
  this.timeout(120000)
  const pages: any[] = []

  after(async () => {
    for (const p of pages) await p.window.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  for (const [nom, reglages] of [['avec l\'enveloppe', {}], ['réglage `"proxy": false`', { proxy: false }]] as const) {
    it(`${nom} : \`__proto__\`, \`constructor\`, \`prototype\` n'écrivent rien dans les objets communs, la lecture ne les rend pas ; une clé juste lit et écrit`, async () => {
      const page = await monterStrict('etat-optionnel-' + ('proxy' in reglages ? 'sans' : 'avec'), { 'etat-optionnel': COMPOSANT }, reglages)
      pages.push(page)
      assert.deepEqual(JSON.parse(page.window.eval(SCENARIO)), { pollue: [], rendus: [], assign: 'ok', alias: 'ok2' })
    })
  }
})
