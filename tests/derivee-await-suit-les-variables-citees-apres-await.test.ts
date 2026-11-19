// une valeur dérivée qui attend suit toutes les `$` que son expression cite, même après le premier `await` :
// `$prix = (await tarif($produit)) * $quantite` se refait quand `$quantite` change, et `combiner(await charger($q), $p)` quand `$p`
// change. Les écritures d'un même tour font une seule demande ; une écriture sans rapport n'en fait aucune.
// Méthode : le vrai Bundler (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, demandes, repondre, texte, pause } from './helpers/derivee-await-banc.js'

const PRIX = `<script>
  $produit   = 'p1'
  $quantite  = 2
  $p         = 'a'
  $q         = 'u'
  $autre     = 0
  tarif      = (p) -> fetch("/api/tarif-#{p}").then((r) -> r.json())
  charger    = (q) -> fetch("/api/liste-#{q}").then((r) -> r.json())
  combiner   = (l, p) -> (l or []).map((x) -> x + p).join(',')
  $prix      = (await tarif($produit)) * $quantite
  $vue       = combiner(await charger($q), $p)
  @quantite  = (n) -> $quantite = n
  @dix       = -> $quantite = i for i in [1..10]
  @changerP  = (p) -> $p = p
  @toucher   = -> $autre++
</script>
<i class="prix">{$prix}</i><b class="vue">{$vue}</b><s>{$autre}</s>
`

describe('dérivée qui attend — les $ citées après le premier await sont suivies', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$quantite, citée après l\'await, relance la demande ; dix écritures d\'un tour, une demande ; une écriture sans rapport, aucune', async () => {
    const w  = await monter('await-suivi', { 'prix.mjs': PRIX }, '<mjs-prix></mjs-prix>')
    const el = w.document.querySelector('mjs-prix')
    assert.deepEqual(demandes(w).sort(), ['/api/liste-u', '/api/tarif-p1'])
    await repondre(w, '/api/tarif-p1', 10)
    await repondre(w, '/api/liste-u', ['x', 'y'])
    assert.equal(texte(el, '.prix'), '20')
    assert.equal(texte(el, '.vue'), 'xa,ya')
    el.quantite(3)
    await pause(60)
    assert.deepEqual(demandes(w, 2), ['/api/tarif-p1'], '$quantite change : une demande')
    await repondre(w, '/api/tarif-p1', 10)
    assert.equal(texte(el, '.prix'), '30')
    el.dix()
    await pause(60)
    assert.deepEqual(demandes(w, 3), ['/api/tarif-p1'], 'dix écritures dans un tour : une demande')
    await repondre(w, '/api/tarif-p1', 10)
    assert.equal(texte(el, '.prix'), '100')
    el.changerP('b')
    await pause(60)
    assert.deepEqual(demandes(w, 4), ['/api/liste-u'], '$p, citée après l\'await, relance sa demande, et elle seule')
    await repondre(w, '/api/liste-u', ['x', 'y'])
    assert.equal(texte(el, '.vue'), 'xb,yb')
    el.toucher()
    await pause(60)
    assert.equal(w.__req.length, 5, 'une écriture sans rapport ne rappelle rien')
    assert.deepEqual([...w.__avis], [], 'aucun avertissement')
    w.close()
  })
})
