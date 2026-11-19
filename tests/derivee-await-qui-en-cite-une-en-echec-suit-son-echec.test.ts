// une valeur dérivée qui attend en cite une autre (`$avis = await noter($fiche.id)`) : elle n'appelle qu'à l'arrivée de celle-ci. Quand
// la première demande de la valeur citée échoue, aucune demande ne part pour elle : elle n'attend plus (`µpending($avis)` faux) et prend
// l'erreur de sa source (`µfailed($avis)`), sans second message à la console ; si la source échoue encore avant toute réponse, elle prend
// la nouvelle erreur. La réponse suivante de la valeur citée la relance, et sa propre réponse efface l'erreur. Méthode : le vrai Bundler
// (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, repondre, demandes, texte, pause } from './helpers/derivee-await-banc.js'

const FICHE = `<script>
  $q      = 'a'
  charger = (q) -> fetch("/api/fiche-#{q}").then((r) -> r.json())
  noter   = (id) -> fetch("/api/avis-#{id}").then((r) -> r.json())
  $fiche  = await charger($q)
  $avis   = await noter($fiche.id)
  @poser  = (q) -> $q = q
</script>
<p class="etat">{µpending($fiche)}|{µfailed($fiche)?.message}|{µpending($avis)}|{µfailed($avis)?.message}|{$avis and $avis.n}</p>
`

describe('valeur dérivée qui attend — celle qui en cite une autre suit l\'échec de sa première demande', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la source échoue : la suite n\'attend plus et prend son erreur ; la réponse suivante de la source la relance', async () => {
    const w  = await monter('await-citee-en-echec', { 'fiche.mjs': FICHE }, '<mjs-fiche></mjs-fiche>')
    const el = w.document.querySelector('mjs-fiche')
    assert.equal(texte(el, '.etat'), 'true||true||', 'les deux attendent')
    await repondre(w, '/api/fiche-a', 'panne', true)
    assert.deepEqual([texte(el, '.etat'), demandes(w)], ['false|panne|false|panne|', ['/api/fiche-a']], 'la suite n\'attend plus, prend l\'erreur de sa source ; aucune demande pour elle')
    assert.deepEqual(Array.from(w.__erreurs), [], 'l\'erreur est lue : rien à la console')
    el.poser('b')
    await pause(30)
    await repondre(w, '/api/fiche-b', { id: 7 })
    assert.deepEqual([texte(el, '.etat'), demandes(w)], ['false||true|panne|', ['/api/fiche-a', '/api/fiche-b', '/api/avis-7']], 'la source arrive : la suite appelle, son erreur reste jusqu\'à sa réponse')
    await repondre(w, '/api/avis-7', { n: 3 })
    assert.equal(texte(el, '.etat'), 'false||false||3', 'sa réponse efface l\'erreur')
    w.close()
  })

  it('la source échoue encore avant toute réponse : la suite prend la nouvelle erreur, puis repart à son arrivée', async () => {
    const w  = await monter('await-citee-deux-echecs', { 'fiche.mjs': FICHE }, '<mjs-fiche></mjs-fiche>')
    const el = w.document.querySelector('mjs-fiche')
    await repondre(w, '/api/fiche-a', 'panne1', true)
    assert.equal(texte(el, '.etat'), 'false|panne1|false|panne1|', 'premier échec : la suite prend l\'erreur de sa source')
    el.poser('b')
    await pause(30)
    assert.equal(texte(el, '.etat'), 'true|panne1|false|panne1|', 'la source redemande, la suite n\'attend pas')
    await repondre(w, '/api/fiche-b', 'panne2', true)
    assert.equal(texte(el, '.etat'), 'false|panne2|false|panne2|', 'second échec : la suite prend la nouvelle erreur de sa source')
    el.poser('c')
    await pause(30)
    await repondre(w, '/api/fiche-c', { id: 9 })
    assert.deepEqual([texte(el, '.etat'), demandes(w)], ['false||true|panne2|', ['/api/fiche-a', '/api/fiche-b', '/api/fiche-c', '/api/avis-9']], 'la source arrive : la suite appelle, la dernière erreur reste jusqu\'à sa réponse')
    await repondre(w, '/api/avis-9', { n: 4 })
    assert.equal(texte(el, '.etat'), 'false||false||4', 'sa réponse efface l\'erreur')
    assert.deepEqual(Array.from(w.__erreurs), [], 'les erreurs sont lues : rien à la console')
    w.close()
  })

})
