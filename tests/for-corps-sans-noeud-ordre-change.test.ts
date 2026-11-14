// un `{for}` dont le corps ne laisse aucun nœud (un commentaire seul) a des lignes vides : changer leur ordre — échange, ligne remontée en
// tête, ligne descendue en fin — ne déplace rien et ne fait pas tomber le composant ; retraits, ajouts et remplacement continuent de suivre

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOST = `<script lang="js">
  $rows = [];
  @fill = function(a) { $rows = a; };
</script>
<div class="l">{for r in $rows by id}<!-- c -->{end}</div><p class="s">{$rows.length}</p>
`

describe('{for} au corps sans nœud — l\'ordre des lignes change sans faire tomber le composant', function () {
  this.timeout(60000)
  let host: any, errors: string[]

  before(async () => { ({ hote: host, erreurs: errors } = await monterHote(HOST, 'for-corps-sans-noeud')) })
  after(async () => { await terminateSharedWorkerPool() })

  // pose la liste des lignes de ces clés, puis regarde le composant : aucune erreur, pas d'écran d'erreur, le reste du gabarit suit
  const set = async (ids: number[], what: string) => {
    host.fill(ids.map((id) => ({ id, label: 'l' + id })))
    await pause(0)
    await pause(0)
    assert.equal(errors.join(' | '), '', what + ' : erreurs')
    assert.ok(!host._mjs_has_crashed, what + ' : le composant est tombé')
    assert.equal(host._shadow.querySelectorAll('.mjs-fatal-error').length, 0, what + ' : écran d\'erreur')
    assert.equal(host._shadow.querySelector('.s').textContent, String(ids.length), what + ' : le reste du composant suit')
    assert.equal(host._shadow.querySelector('.l').children.length, 0, what + ' : la liste n\'affiche aucune balise')
  }

  it('échanger la première et la dernière ligne', async () => {
    await set([1, 2, 3, 4], 'création')
    await set([4, 2, 3, 1], 'échange')
  })

  it('remonter la dernière ligne en tête, descendre la première en fin', async () => {
    await set([1, 4, 2, 3], 'dernière ligne remontée en tête')
    await set([4, 2, 3, 1], 'première ligne descendue en fin')
  })

  it('retirer, ajouter, tout remplacer, vider : la liste suit', async () => {
    await set([4, 3, 1], 'retrait')
    await set([4, 3, 1, 5, 6], 'ajout')
    await set([6, 5, 1, 3, 4], 'ordre renversé')
    await set([7, 8], 'tout remplacé')
    await set([], 'vidage')
  })
})
