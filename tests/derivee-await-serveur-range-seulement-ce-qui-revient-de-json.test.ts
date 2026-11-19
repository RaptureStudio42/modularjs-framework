// Rendu serveur d'une valeur dérivée qui attend : une valeur citée, ou une réponse, qui ne revient pas identique de JSON n'est pas rangée
// dans la page, et le navigateur appelle la fonction. Valeurs citées : `undefined` (que JSON écrit `null`), une `Map`, un `Set` (qu'il
// écrit `{}`), une `Date` (un texte) ; réponses : une `Map`, une `Date`, une liste qui contient `undefined`, `NaN`, `Infinity`, un objet
// qui n'est pas un objet simple. Sans cette vérification, `[undefined]` et `[null]` ont la même clé, `Map` et `Set` aussi (`[{}]`) : le
// navigateur montrait la valeur d'un autre état sans appeler. Un texte cité et une réponse en JSON simple restent rangés et repris.
// Méthode : le vrai rendu serveur (moteur happy-dom), puis le cœur et le composant dans happy-dom, la balise `#__mjs_store` du serveur
// posée avant eux ; le composant porte `mjs-ssr`, comme une balise de la page servie.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { pause } from './helpers/derivee-await-banc.js'
import { servir, reprendre, appels, TARD } from './helpers/derivee-await-serveur.js'

const SERVI = TARD + `<script>
  appel = (nom, valeur) ->
    (globalThis.__appels ||= []).push(nom)
    plusTard(valeur, 10)
  $vide      = (if µ.server then null else undefined)
  $carte     = new Map([['k', (if µ.server then 'A' else 'B')]])
  $lot       = new Set([(if µ.server then 1 else 2)])
  $jour      = new Date(86400000)
  $texte     = 'x'
  $rTexte    = await appel('rTexte', 'pour-' + $texte)
  $rVide     = await appel('rVide', 'pour-' + $vide)
  $rCarte    = await appel('rCarte', 'pour-' + $carte.get('k'))
  $rLot      = await appel('rLot', 'pour-' + Array.from($lot)[0])
  $rJour     = await appel('rJour', 'pour-' + $jour.getTime())
  $rMap      = await appel('rMap', new Map([[1, 2]]))
  $rDate     = await appel('rDate', new Date(0))
  $rIndefini = await appel('rIndefini', [1, undefined])
  $rNaN      = await appel('rNaN', NaN)
  $rInfini   = await appel('rInfini', { n: Infinity })
  $rInstance = await appel('rInstance', Object.assign(Object.create({ lire: -> 1 }), { nom: 'x' }))
</script>
<i>{String($rTexte)}</i>
`
const SOURCES = { 'servi.mjs': SERVI }

describe('valeur dérivée qui attend — le rendu serveur ne range que ce qui revient identique de JSON', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('valeurs citées et réponses hors de JSON : rien de rangé, le navigateur appelle et montre sa propre réponse', async () => {
    const { graine } = await servir('aw-json-serveur', SOURCES, 'mjs-servi')
    assert.deepEqual(Object.keys(graine || {}).sort(), ['mjs-servi|rTexte|["x"]', 'mjs-servi|rVide|[null]'], JSON.stringify(graine).slice(0, 600))
    const w  = await reprendre('aw-json-nav', SOURCES, graine, '<mjs-servi mjs-ssr></mjs-servi>')
    const el = w.document.querySelector('mjs-servi')
    await pause(100)
    const s  = el._state
    assert.deepEqual(appels(w).sort(), ['rCarte', 'rDate', 'rIndefini', 'rInfini', 'rInstance', 'rJour', 'rLot', 'rMap', 'rNaN', 'rVide'], 'tout appelle, sauf la valeur rangée')
    assert.equal(s.rTexte, 'pour-x', 'la valeur rangée est reprise')
    assert.equal(s.rVide, 'pour-undefined', '`undefined` cité n\'est pas `null`')
    assert.equal(s.rCarte, 'pour-B', 'la Map citée par le navigateur, pas celle du serveur')
    assert.equal(s.rLot, 'pour-2', 'le Set cité par le navigateur, pas celui du serveur')
    assert.equal(s.rJour, 'pour-86400000')
    // l'état peut envelopper un objet (Proxy) : son prototype, lui, reste celui de la page
    assert.ok(s.rMap instanceof w.Map, 'une Map rendue reste une Map')
    assert.ok(s.rDate instanceof w.Date, 'une Date rendue reste une Date, pas un texte')
    assert.equal(s.rIndefini.length, 2)
    assert.equal(s.rIndefini[1], undefined, 'undefined dans une liste reste undefined')
    assert.ok(Number.isNaN(s.rNaN), 'NaN reste NaN')
    assert.equal(s.rInfini.n, Infinity, 'Infinity reste Infinity')
    assert.equal(typeof s.rInstance.lire, 'function', 'l\'objet garde son prototype')
    assert.deepEqual(Array.from(w.__avis), [])
    w.close()
  })
})
