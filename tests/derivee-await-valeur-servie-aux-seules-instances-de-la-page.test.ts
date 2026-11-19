// La valeur qu'un rendu serveur range pour une valeur dérivée qui attend (`$resultats = await rechercher($q)`) ne sert qu'aux composants
// de la page servie : ceux que le serveur a rendus (balise `mjs-ssr`), et ceux que la vue d'un tel composant recrée au navigateur
// (`replace`), autant de fois que le serveur a rendu de composants avec la même clé. Deux composants servis de même clé la prennent tous
// deux, chacun sa copie ; un composant rendu par le serveur dont la première demande vient tard (réveil à l'intention) la prend encore. Un
// composant créé ensuite par le navigateur, dans la page servie (un `{if}` qui s'ouvre) ou hors d'elle, appelle la fonction.
// Méthode : le vrai rendu serveur (moteur happy-dom), puis le cœur et les composants dans happy-dom, la balise `#__mjs_store` du serveur
// posée avant eux ; l'hôte servi porte `mjs-ssr` sans page déclarative : sa vue se bâtit au navigateur, comme en `replace`.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { pause, ecran } from './helpers/derivee-await-banc.js'
import { servir, reprendre, appels, TARD } from './helpers/derivee-await-serveur.js'

const SERVI = TARD + `<script>
  $q         = 'ad'
  rechercher = (q) ->
    (globalThis.__appels ||= []).push(q)
    plusTard([{ id: 1, pseudo: (if µ.server then 'Serveur' else 'Navigateur') }], 20)
  $resultats = await rechercher($q)
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul>
`
const HOTE = `<script>
  $ouvert = false
  @ouvrir = -> $ouvert = true
</script>
<@servi class="un"></@servi>
<@servi class="deux"></@servi>
{if $ouvert}
  <@servi class="trois"></@servi>
{end}
`
const SOURCES = { 'servi.mjs': SERVI, 'hote.mjs': HOTE }
const CLE     = 'mjs-servi|resultats|["ad"]'

describe('valeur dérivée qui attend — la valeur du serveur ne sert qu\'aux composants de la page servie', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le serveur range la valeur une fois, avec le nombre de composants servis qui la lisent', async () => {
    const { graine } = await servir('aw-servie-graine', SOURCES, 'mjs-hote')
    assert.deepEqual(graine, { [CLE]: { v: [{ id: 1, pseudo: 'Serveur' }], n: 2 } })
  })

  it('composants servis : valeur reprise sans appel, chacun sa copie ; un composant créé ensuite par le navigateur appelle', async () => {
    const { graine } = await servir('aw-servie-reprise', SOURCES, 'mjs-hote')
    const w    = await reprendre('aw-servie-reprise-nav', SOURCES, graine, '<mjs-hote mjs-ssr></mjs-hote>')
    const hote = w.document.querySelector('mjs-hote')
    const un   = hote._shadow.querySelector('.un')
    const deux = hote._shadow.querySelector('.deux')
    assert.match(ecran(un), /<li>Serveur<\/li>/, 'le premier composant servi montre la valeur du serveur')
    assert.match(ecran(deux), /<li>Serveur<\/li>/, 'le second, de même clé, aussi')
    assert.deepEqual(appels(w), [], 'aucun appel au réveil de la page servie')
    assert.notEqual(un._state.resultats, deux._state.resultats, 'chacun reçoit sa propre copie de la valeur')
    hote.ouvrir()
    await pause(150)
    assert.deepEqual(appels(w), ['ad'], 'un composant créé ensuite dans la page servie appelle la fonction')
    assert.match(ecran(hote._shadow.querySelector('.trois')), /<li>Navigateur<\/li>/)
    w.document.body.insertAdjacentHTML('beforeend', '<mjs-servi class="dehors"></mjs-servi>')
    await pause(150)
    assert.deepEqual(appels(w), ['ad', 'ad'], 'un composant créé hors de la page servie appelle aussi')
    assert.match(ecran(w.document.querySelector('.dehors')), /<li>Navigateur<\/li>/)
    // rendu par le serveur, il ne demande que maintenant (comme une balise réveillée à l'intention) : la valeur servie l'attend encore
    w.document.body.insertAdjacentHTML('beforeend', '<mjs-servi class="tard" mjs-ssr></mjs-servi>')
    await pause(150)
    assert.deepEqual(appels(w), ['ad', 'ad'], 'le composant servi qui demande tard ne rappelle pas')
    assert.match(ecran(w.document.querySelector('.tard')), /<li>Serveur<\/li>/)
    assert.deepEqual(Array.from(w.__avis), [])
    w.close()
  })
})
