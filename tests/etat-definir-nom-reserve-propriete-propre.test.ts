// `Object.defineProperty($, nom, …)` sur l'état du composant, avec un nom réservé (`__proto__`, `constructor`, `prototype`), pose une
// propriété propre de l'état, comme sur un objet ordinaire : aucune erreur, aucun prototype changé (ni celui de l'état, ni
// `Object.prototype`), aucune variable prévenue. Une définition sous un autre nom prévient la variable, l'écran suit

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const HOTE = `<script lang="js">
  $x = 1;
  @definir = function(nom, v) { try { Object.defineProperty($, nom, {value: v, writable: true, configurable: true, enumerable: false}); return 'propre=' + Object.prototype.hasOwnProperty.call($, nom); } catch (e) { return 'leve ' + e.constructor.name; } };
</script>
<p class="x">{$x}</p>
`

describe('état : Object.defineProperty($, nom réservé, …) pose une propriété propre, sans pollution', function () {
  this.timeout(60000)

  let window: any, hote: any, erreurs: string[]
  const texte = (sel: string) => hote._shadow.querySelector(sel).textContent

  before(async () => {
    ({ window, hote, erreurs } = await monterHote(HOTE, 'etat-definir-reserve'))
    window.eval('µ.warn = function(...a) { globalThis.__erreurs.push(\'warn \' + a.map(String).join(\' \')); };')
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of ['__proto__', 'constructor', 'prototype']) it(`${nom} : propriété propre de l'état, aucun prototype changé`, () => {
    const proto = Object.getPrototypeOf(hote._state)
    const v     = { pollue: 1 }
    assert.equal(hote.definir(nom, v), 'propre=true')
    const d = Object.getOwnPropertyDescriptor(hote._state, nom)
    assert.ok(d !== undefined && d.value.pollue === 1, `${nom} est une propriété propre de l'état`)
    assert.ok(Object.getPrototypeOf(hote._state) === proto, 'le prototype de l\'état est inchangé')
    assert.equal(window.eval('({}).pollue'), undefined)
    assert.equal(window.eval('Object.prototype.pollue'), undefined)
    assert.equal(({} as any).pollue, undefined)
    assert.equal(texte('.x'), '1')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })

  it('un autre nom : la variable est prévenue, l\'écran suit', async () => {
    assert.equal(hote.definir('x', 5), 'propre=true')
    await attendre(() => texte('.x') === '5')
    assert.equal(texte('.x'), '5')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })
})
