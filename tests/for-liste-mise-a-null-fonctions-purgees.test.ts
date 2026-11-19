// {for} dont la liste devient null ou undefined — les lignes d'une liste dont une liaison suit un choix (`:class{x is $choix}`,
// `checked={x is $choix}`, `:style.x={x is $choix ? …}`) laissent une fonction par ligne dans l'index que le composant tient pour ne
// toucher que l'ancienne et la nouvelle ligne quand le choix change. Quand la liste devient null, ses lignes sont détruites, mais ces
// fonctions, avec les lignes mortes qu'elles ferment, restaient dans l'index jusqu'à la mort du composant : chaque aller-retour de la liste
// en ajoutait une série. L'index ne garde plus, à tout moment, qu'une fonction par ligne vivante et par liaison ; la liste revenue relit le
// choix du moment. La page est lue dans un navigateur réel, rendue par le client seul (l'index n'existe que là).

import assert from 'node:assert/strict'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

const COMPOSANT = `<script lang="coffee">
$choix   = 'b'
$valeurs = ['a', 'b', 'c', 'd']
vider = ->
  $valeurs = null
effacer = ->
  $valeurs = undefined
rendre = ->
  $valeurs = ['a', 'b', 'c', 'd']
changer = ->
  $choix = 'c'
</script>
<button class="vider" @click={vider}>vider</button>
<button class="effacer" @click={effacer}>effacer</button>
<button class="rendre" @click={rendre}>rendre</button>
<button class="changer" @click={changer}>changer</button>
<div>
{for x in $valeurs}
<p data-k="classe" :class{x is $choix}="on">x</p>
<input data-k="case" type="checkbox" aria-label="case" checked={x is $choix}>
<p data-k="style" :style.color={x is $choix ? 'red' : ''}>x</p>
{end}
</div>
`

// l'état de chaque ligne, par marque, dans toutes les racines d'ombre de la page
const LIRE = `(() => {
  ${VISITER}
  const out = {}
  visiter(document, (racine) => {
    for (const el of racine.querySelectorAll('[data-k]')) {
      const k = el.getAttribute('data-k')
      let etat
      if (k === 'classe') etat = el.classList.contains('on')
      else if (k === 'case') etat = el.checked === true
      else etat = el.style.color === 'red'
      ;(out[k] ??= []).push(etat)
    }
  })
  return out
})()`

// le nombre de fonctions de lignes que l'index garde, toutes liaisons confondues
const FONCTIONS = `(() => {
  const el = document.querySelector('mjs-liste-nulle')
  let n = 0
  for (const fe of Object.values(el._mjs_filt || {})) for (const e of (fe.idx || new Map()).values()) n += e instanceof Set ? e.size : 1
  return n
})()`

// quatre lignes, trois liaisons par ligne
const VIVANTES = 12


describe('{for} dont la liste devient null — les fonctions de ses lignes partent avec elles', function () {
  this.timeout(240000)
  let composants: Composants | null

  before(async function () {
    composants = await monterComposants({ 'liste-nulle': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  async function page(): Promise<any> {
    return composants!.client('liste-nulle', '[data-k="case"]')
  }

  async function cliquer(p: any, classe: string): Promise<void> {
    await p.evaluate(`document.querySelector('mjs-liste-nulle')._shadow.querySelector('.${classe}').click()`)
    await p.waitForTimeout(300)
  }

  for (const [geste, classe] of [['null', 'vider'], ['undefined', 'effacer']]) {
    it(`liste mise à ${geste} : l'index ne garde plus aucune fonction de ses lignes ; revenue, elle relit le choix`, async function () {
      const p = await page()
      try {
        assert.equal(await p.evaluate(FONCTIONS), VIVANTES, 'au départ')
        await cliquer(p, classe)
        assert.deepEqual(await p.evaluate(LIRE), {}, 'les lignes sont parties')
        assert.equal(await p.evaluate(FONCTIONS), 0, 'leurs fonctions aussi')
        await cliquer(p, 'rendre')
        assert.equal(await p.evaluate(FONCTIONS), VIVANTES, 'la liste revenue')
        await cliquer(p, 'changer')
        assert.deepEqual(await p.evaluate(LIRE), { classe: [false, false, true, false], case: [false, false, true, false], style: [false, false, true, false] })
      } finally {
        await p.close()
      }
    })
  }

  it('des allers-retours de la liste ne font pas grossir l\'index', async function () {
    const p = await page()
    try {
      for (let tour = 0; tour < 4; tour++) {
        await cliquer(p, 'vider')
        await cliquer(p, 'rendre')
      }
      assert.equal(await p.evaluate(FONCTIONS), VIVANTES, 'après quatre allers-retours')
    } finally {
      await p.close()
    }
  })
})
