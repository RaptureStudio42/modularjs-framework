// une valeur qui attend dont rien ne lit l'erreur (aucun µfailed($x) dans le composant) : chaque échec va à la console d'erreurs
// (µ.error, avec l'erreur), comme le plantage d'un gestionnaire, sans planter le composant — la valeur d'avant reste ; en développement
// le premier message dit quoi écrire. Lue par µfailed($x), l'erreur ne va pas à la console. Méthode : le vrai Bundler (développement),
// happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, repondre, texte, pause } from './helpers/derivee-await-banc.js'

const SOURCE = (b: string, lu: boolean) => `<script>
  $q         = ''
  rechercher = (q) -> fetch("/api/${b}-#{q}").then((r) -> r.json())
  $resultats = await rechercher($q)
  @chercher  = (q) -> $q = q
</script>
<i class="n">{($resultats or []).length}</i>${lu ? '<b class="err">{µfailed($resultats)?.message}</b>' : ''}
`

describe('dérivée qui attend — une erreur que rien ne lit va à la console d\'erreurs', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque échec non lu : µ.error avec l\'erreur, le premier dit µfailed($resultats) ; le composant vit, la valeur reste', async () => {
    const w  = await monter('await-non-lue', { 'muette.mjs': SOURCE('m', false) }, '<mjs-muette></mjs-muette>')
    const el = w.document.querySelector('mjs-muette')
    await repondre(w, '/api/m-', [1, 2])
    el.chercher('x')
    await pause(60)
    await repondre(w, '/api/m-x', 'serveur en panne', true)
    assert.equal(w.__erreurs.length, 1, 'une erreur à la console — ' + w.__erreurs.join(' | '))
    assert.match(w.__erreurs[0], /µfailed\(\$resultats\)/)
    assert.match(w.__erreurs[0], /serveur en panne/)
    assert.equal(texte(el, '.n'), '2', 'la valeur d\'avant reste')
    assert.ok(!el._shadow.querySelector('.mjs-fatal-error'), 'le composant ne plante pas')
    el.chercher('z')
    await pause(60)
    await repondre(w, '/api/m-z', 'encore', true)
    assert.equal(w.__erreurs.length, 2, 'le second échec aussi — ' + w.__erreurs.join(' | '))
    assert.match(w.__erreurs[1], /<mjs-muette> \$resultats.*encore/)
    w.close()
  })

  it('lue par µfailed($x) : rien à la console', async () => {
    const w  = await monter('await-lue', { 'lue.mjs': SOURCE('l', true) }, '<mjs-lue></mjs-lue>')
    const el = w.document.querySelector('mjs-lue')
    await repondre(w, '/api/l-', 'panne', true)
    assert.equal(texte(el, '.err'), 'panne')
    assert.deepEqual([...w.__erreurs], [])
    w.close()
  })
})
