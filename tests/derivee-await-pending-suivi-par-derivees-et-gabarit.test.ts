// `µpending($x)` et `µfailed($x)` suivis partout où le composant les lit : une dérivée déclarée avant ou après la valeur qui attend,
// une dérivée qui en fait un texte, un attribut, un bloc {if}, la prop d'un enfant ; vrais pendant chaque attente, faux après.
// Méthode : le vrai Bundler (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, repondre, texte, pause } from './helpers/derivee-await-banc.js'

const SUIVI = `<script>
  $avant     = µpending($resultats)
  $q         = ''
  rechercher = (q) -> fetch("/api/p-#{q}").then((r) -> r.json())
  $resultats = await rechercher($q)
  $apres     = µpending($resultats)
  $etat      = if µpending($resultats) then 'charge' else 'pret'
  $msg       = µfailed($resultats)?.message or 'aucune'
  @chercher  = (q) -> $q = q
</script>
<i class="avant">{$avant}</i><i class="apres">{$apres}</i><i class="etat">{$etat}</i><b class="msg">{$msg}</b>
<p class="attr" data-occ={µpending($resultats)}></p>
{if µpending($resultats)}<em class="si">charge</em>{end}
<@c-voyant on={µpending($resultats)}></@c-voyant>
`
const VOYANT = `<script>
  $on = false
</script>
<s class="on">{$on}</s>
`

describe('dérivée qui attend — µpending et µfailed suivis par les dérivées et le gabarit', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('vrais pendant chaque attente, faux après ; l\'échec se lit', async () => {
    const w  = await monter('await-pending-suivi', { 'suivi.mjs': SUIVI, 'c-voyant.mjs': VOYANT }, '<mjs-suivi></mjs-suivi>')
    const el = w.document.querySelector('mjs-suivi')
    const vu = () => [texte(el, '.avant'), texte(el, '.apres'), texte(el, '.etat'), texte(el, '.msg'), el._shadow.querySelector('.attr')?.getAttribute('data-occ') ?? 'sans', el._shadow.querySelector('.si') ? 'si' : '-', el._shadow.querySelector('mjs-c-voyant')?._shadow?.querySelector('.on')?.textContent].join('|')
    assert.equal(vu(), 'true|true|charge|aucune|true|si|true', 'au départ : en attente')
    await repondre(w, '/api/p-', [1])
    assert.equal(vu(), 'false|false|pret|aucune|sans|-|false', 'la réponse arrivée')
    el.chercher('x')
    await pause(60)
    assert.equal(vu(), 'true|true|charge|aucune|true|si|true', 'une nouvelle demande : tous le disent')
    await repondre(w, '/api/p-x', 'panne', true)
    assert.equal(vu(), 'false|false|pret|panne|sans|-|false', 'l\'échec : l\'attente finie, l\'erreur lue')
    w.close()
  })
})
