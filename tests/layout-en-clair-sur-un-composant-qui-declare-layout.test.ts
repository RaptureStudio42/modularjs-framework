// `layout="grid"` écrit en clair sur un composant qui déclare son propre `$layout` (un état ordinaire, `'list'` ou `'grid'`) : la valeur
// va à la variable, jamais au choix d'une feuille de style. La connexion et la relecture des attributs appliquaient le modèle « grid »
// (requête de la feuille `….grid.css`, avertissement), alors que l'écriture par `_set` le gardait déjà
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const SOURCE = `<script>
  $layout ?= 'list'
</script>

<p class="vu">{$layout}</p>
`

describe('layout en clair sur un composant qui déclare $layout', function () {
  this.timeout(40000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('la valeur va à $layout, aucun modèle de style n\'est appliqué', async () => {
    const { window, hote, erreurs } = await monterHote(SOURCE, 'layout-en-clair')
    const modeles: string[] = []
    const appliquer = hote._mjs_applyLayout
    hote._mjs_applyLayout = function(this: any, ...a: any[]) { modeles.push(a[0]); return appliquer.apply(this, a) }
    hote.remove()
    hote.setAttribute('layout', 'grid')
    window.document.body.appendChild(hote)
    await pause(60)
    assert.equal(hote._shadow.querySelector('.vu').textContent, 'grid', 'la prop arrive à $layout')
    hote.setAttribute('layout', 'list')
    await pause(60)
    assert.equal(hote._shadow.querySelector('.vu').textContent, 'list', 'relue après un changement d\'attribut')
    assert.deepEqual(modeles.filter((m) => m === 'grid' || m === 'list'), [], 'aucun modèle de style « grid » ni « list »')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })
})
