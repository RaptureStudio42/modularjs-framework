// Rendu serveur d'une valeur dérivée qui attend : au-delà de 2 000 caractères de valeurs citées (leur texte JSON), rien n'est rangé
// dans la page et le navigateur appelle la fonction ; à 2 000 caractères tout juste, la valeur est rangée et reprise. Une valeur citée de
// 200 000 nombres ne fait plus entrer dans la page une clé de plus d'un million de caractères.
// Méthode : le vrai rendu serveur (moteur happy-dom), puis le cœur et le composant dans happy-dom, la balise `#__mjs_store` du serveur
// posée avant eux ; le composant porte `mjs-ssr`, comme une balise de la page servie.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { pause } from './helpers/derivee-await-banc.js'
import { servir, reprendre, appels, TARD } from './helpers/derivee-await-serveur.js'

// `["x…x"]` : 1 996 lettres et 4 signes font 2 000 caractères, une lettre de plus en fait 2 001
const SERVI = TARD + `<script>
  appel = (nom, valeur) ->
    (globalThis.__appels ||= []).push(nom)
    plusTard(valeur, 10)
  $court  = 'x'.repeat(1996)
  $long   = 'x'.repeat(1997)
  $grand  = [0...200000]
  $rCourt = await appel('court', $court.length)
  $rLong  = await appel('long', $long.length)
  $rGrand = await appel('grand', $grand.length)
</script>
<i>{$rCourt}</i>
`
const SOURCES = { 'servi.mjs': SERVI }

describe('valeur dérivée qui attend — une clé de plus de 2 000 caractères n\'est pas rangée', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('2 000 caractères de valeurs citées : rangée ; 2 001 et plus : rien dans la page, le navigateur appelle', async () => {
    const { res, graine } = await servir('aw-cle-longue', SOURCES, 'mjs-servi')
    const cles = Object.keys(graine || {})
    assert.deepEqual(cles.map((c) => c.split('|')[1]), ['rCourt'], cles.map((c) => c.slice(0, 40) + '… ' + c.length).join(' ; '))
    assert.equal(cles[0].length, 'mjs-servi|rCourt|'.length + 2000)
    assert.ok(res.sharedScript.length < 5000, 'la balise du magasin reste petite : ' + res.sharedScript.length + ' caractères')
    const w  = await reprendre('aw-cle-longue-nav', SOURCES, graine, '<mjs-servi mjs-ssr></mjs-servi>')
    const el = w.document.querySelector('mjs-servi')
    await pause(100)
    assert.deepEqual(appels(w).sort(), ['grand', 'long'], 'la valeur rangée est reprise, les autres appellent')
    assert.deepEqual([el._state.rCourt, el._state.rLong, el._state.rGrand], [1996, 1997, 200000])
    w.close()
  })
})
