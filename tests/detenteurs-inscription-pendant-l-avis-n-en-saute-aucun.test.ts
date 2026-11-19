// le registre des détenteurs : un objet d'un `<script module>` tenu par 17 composants frères (chacun le range dans sa variable `$o`) ;
// l'écriture de l'un prévient les autres par le registre seul. Un détenteur mort (sa référence faible ne rend plus rien) juste avant un
// détenteur dont l'avis inscrit de nouveaux détenteurs du même objet (un rendu fait sur-le-champ), la liste passant une puissance de deux :
// son élagage, fait pendant l'avis, ne fait sauter ni perdre aucun détenteur vivant — tous montrent chaque écriture. La mort et le rendu
// sur-le-champ sont joués par le test (référence faible qui ne rend plus rien, inscriptions par `µ._mjs_claims`, l'entrée des familles,
// au cœur avec mjs_state.ts ou mjs_store.ts : une unité à `µ.state`, jamais montée, l'y apporte) : une vraie collecte de la mémoire ne se
// commande pas dans happy-dom. Méthode : le vrai Bundler (développement), happy-dom

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, pause, texte } from './helpers/derivee-await-banc.js'

const SOURCES = {
  'carte.mjs': `<script module>
  partage = { n: 0 }
</script>
<script>
  $o      = partage
  @ecrire = -> $o.n++
</script>
<b>{$o.n}</b>
`,
  'etat.mjs': `<script>
  st = µ.state({ n: 0 })
</script>
<i>{st.n}</i>
`,
}

describe('registre des détenteurs — une inscription pendant l\'avis ne fait sauter aucun détenteur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('mort juste avant un avis qui inscrit 64 détenteurs : chaque composant vivant montre chaque écriture', async () => {
    const w     = await monter('detenteurs-avis-elague', SOURCES, '<mjs-carte></mjs-carte>'.repeat(17))
    const fils  = Array.from(w.document.querySelectorAll('mjs-carte')) as any[]
    const raw   = w.µ._mjs_toRaw(fils[0]._state.o)
    const vus   = () => fils.filter((_, i) => i !== 3).map((f) => texte(f, 'b')).join(',')
    assert.equal(fils.length, 17)
    assert.equal(vus(), Array(16).fill('0').join(','))
    // le composant 3 meurt ; l'avis du composant 4 inscrit 64 nouveaux détenteurs de l'objet, une fois
    assert.equal(typeof fils[3]._mjs_wr?.deref, 'function', 'la référence faible du détenteur')
    fils[3]._mjs_wr.deref = () => undefined
    const faux: any[] = w.__faux = []
    const avis = fils[4]._mjs_claimNotice
    fils[4]._mjs_claimNotice = function(...a: any[]) {
      const r = avis.apply(this, a)
      if (!faux.length) for (let i = 0; i < 64; i++) {
        const f = { _mjs_claimNotice: () => true }
        faux.push(f)
        w.µ._mjs_claims(f, raw)
      }
      return r
    }
    fils[0].ecrire()
    await pause(80)
    assert.equal(vus(), Array(16).fill('1').join(','), 'première écriture : chaque composant vivant est prévenu')
    fils[0].ecrire()
    await pause(80)
    assert.equal(vus(), Array(16).fill('2').join(','), 'seconde écriture : aucun détenteur perdu par l\'élagage')
    w.close()
  })
})
