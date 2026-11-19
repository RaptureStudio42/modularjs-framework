// `class={$c}` (ou un autre attribut global calculé) sur une balise à tiret pas encore définie : la balise ne dit pas ses props, l'attribut
// attend sa définition. Chaque écriture ajoutait sa propre attente (50 attentes pour 50 écritures sur une balise jamais définie, gardées
// jusqu'à la fermeture de la page) ; il n'y en a plus qu'une par balise, et c'est la dernière valeur écrite de chaque attribut qui se pose.
// La règle ne change pas : la classe ne se pose que sur une balise définie. Lu dans un navigateur réel (Chromium et Firefox), rendu par
// le client seul.

import assert from 'node:assert/strict'
import { monterComposants, type Composants, type Moteur } from './helpers/composants-navigateur.js'

const COMPOSANT = `<script lang="coffee">
$n = 0
$c = 'c0'
suivant = ->
  $n++
  $c = 'c' + $n
</script>
<button class="suivant" @click={suivant}>suivant</button>
<x-boite class={$c} title={$c}>tiers</x-boite>
<mjs-jamais-definie class={$c}>projet</mjs-jamais-definie>
`

// 50 écritures, chacune dans sa tâche (un rendu par écriture) ; rend la classe et le titre de chaque balise, et les attentes
// demandées par balise pendant ces écritures
const ECRIRE = `(async () => {
  const el = document.querySelector('mjs-tiret-jamais-definie')
  const vu = {}
  const avant = customElements.whenDefined.bind(customElements)
  customElements.whenDefined = (t) => { vu[t] = (vu[t] || 0) + 1; return avant(t) }
  for (let i = 0; i < 50; i++) {
    el._shadow.querySelector('.suivant').click()
    await new Promise((r) => setTimeout(r, 0))
  }
  await new Promise((r) => setTimeout(r, 50))
  customElements.whenDefined = avant
  const tiers  = el._shadow.querySelector('x-boite')
  const projet = el._shadow.querySelector('mjs-jamais-definie')
  return { tiers: [tiers.getAttribute('class'), tiers.getAttribute('title')], projet: projet.getAttribute('class'), attentes: vu }
})()`

for (const moteur of ['chromium', 'firefox'] as Moteur[]) {
  describe(`attribut global sur une balise à tiret jamais définie (${moteur})`, function () {
    this.timeout(240000)
    let composants: Composants | null

    before(async function () {
      composants = await monterComposants({ 'tiret-jamais-definie': COMPOSANT }, moteur)
      if (!composants) this.skip()
    })

    after(async () => {
      if (composants) await composants.fermer()
    })

    it('balise tierce ou mjs- jamais définie : une attente par balise, pas une par écriture', async function () {
      const p = await composants!.client('tiret-jamais-definie', '.suivant')
      try {
        const r = await p.evaluate(ECRIRE)
        assert.ok((r.attentes['x-boite'] || 0) <= 1, `${r.attentes['x-boite']} attentes pour la balise tierce, une au plus`)
        assert.ok((r.attentes['mjs-jamais-definie'] || 0) <= 1, `${r.attentes['mjs-jamais-definie']} attentes pour la balise mjs-, une au plus`)
        assert.deepEqual(r.tiers, [null, 'c50'], 'la classe attend la définition ; le titre est posé')
        assert.equal(r.projet, null, 'la balise mjs- attend sa définition')
      } finally {
        await p.close()
      }
    })
  })
}
