// {for} dans une branche {await} — les lignes d'une liste dont une liaison suit un choix (`@class{x is $choix}`, `checked={x is $choix}`,
// `@style.x={x is $choix ? …}`) laissent une fonction par ligne dans l'index que le composant tient pour ne toucher que l'ancienne et la nouvelle
// ligne quand le choix change. Quand la branche disparaît sans que sa liste soit rappelée (la promesse est remplacée, rejetée ou retirée), ces
// fonctions, avec les lignes mortes qu'elles ferment, restaient dans l'index jusqu'à la mort du composant : chaque aller-retour de la promesse en
// ajoutait une série. L'index ne garde plus, à tout moment, qu'une fonction par ligne vivante et par liaison ; la branche revenue relit le choix du moment.
// La page est lue dans un navigateur réel, rendue par le client seul (l'index n'existe que là).

import assert from 'node:assert/strict'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

const COMPOSANT = `<script lang="coffee">
$choix    = 'b'
$valeurs  = ['a', 'b', 'c', 'd']
$promesse = Promise.resolve({ ok: true })
remplacer = ->
  $promesse = new Promise((resolve) -> null)
rejeter = ->
  $promesse = Promise.reject(new Error('non'))
retirer = ->
  $promesse = null
rendre = ->
  $promesse = Promise.resolve({ ok: true })
changer = ->
  $choix = 'c'
</script>
<button class="remplacer" @click={remplacer}>remplacer</button>
<button class="rejeter" @click={rejeter}>rejeter</button>
<button class="retirer" @click={retirer}>retirer</button>
<button class="rendre" @click={rendre}>rendre</button>
<button class="changer" @click={changer}>changer</button>
<div>
{await $promesse}
{success d}
{for x in $valeurs}
<p data-k="classe" @class{x is $choix}="on">x</p>
<input data-k="case" type="checkbox" aria-label="case" checked={x is $choix}>
<p data-k="style" @style.color={x is $choix ? 'red' : ''}>x</p>
{end}
{error err}
<p data-k="erreur">erreur</p>
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
      else if (k === 'style') etat = el.style.color === 'red'
      else etat = true
      ;(out[k] ??= []).push(etat)
    }
  })
  return out
})()`

// le nombre de fonctions de lignes que l'index garde, toutes liaisons confondues
const FONCTIONS = `(() => {
  const el = document.querySelector('mjs-await-fonctions')
  let n = 0
  for (const fe of Object.values(el._mjs_filt || {})) for (const e of (fe.idx || new Map()).values()) n += e instanceof Set ? e.size : 1
  return n
})()`

// quatre lignes, trois liaisons par ligne
const VIVANTES = 12

describe('{for} dans une branche {await} — les fonctions de ses lignes partent avec la branche', function () {
  this.timeout(240000)
  let composants: Composants | null

  before(async function () {
    composants = await monterComposants({ 'await-fonctions': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  async function page(): Promise<any> {
    return composants!.client('await-fonctions', '[data-k="case"]')
  }

  async function cliquer(p: any, classe: string): Promise<void> {
    await p.evaluate(`document.querySelector('mjs-await-fonctions')._shadow.querySelector('.${classe}').click()`)
    await p.waitForTimeout(300)
  }

  it('au départ, une fonction par ligne et par liaison', async function () {
    const p = await page()
    try {
      assert.equal(await p.evaluate(FONCTIONS), VIVANTES)
      assert.deepEqual(await p.evaluate(LIRE), { classe: [false, true, false, false], case: [false, true, false, false], style: [false, true, false, false] })
    } finally {
      await p.close()
    }
  })

  for (const [geste, classe] of [['la promesse est remplacée', 'remplacer'], ['la promesse est rejetée', 'rejeter'], ['la promesse est retirée', 'retirer']]) {
    it(`quand ${geste}, l'index ne garde plus aucune fonction de la branche`, async function () {
      const p = await page()
      try {
        await cliquer(p, classe)
        assert.equal(await p.evaluate(FONCTIONS), 0, 'la branche est partie')
        // la branche revenue relit le choix du moment, et l'index repart de zéro
        await cliquer(p, 'rendre')
        assert.equal(await p.evaluate(FONCTIONS), VIVANTES, 'la branche revenue')
        await cliquer(p, 'changer')
        assert.deepEqual(await p.evaluate(LIRE), { classe: [false, false, true, false], case: [false, false, true, false], style: [false, false, true, false] })
      } finally {
        await p.close()
      }
    })
  }

  it('des allers-retours de la promesse ne font pas grossir l\'index', async function () {
    const p = await page()
    try {
      for (let tour = 0; tour < 4; tour++) {
        await cliquer(p, 'remplacer')
        await cliquer(p, 'rendre')
        await cliquer(p, 'rejeter')
        await cliquer(p, 'rendre')
        await cliquer(p, 'retirer')
        await cliquer(p, 'rendre')
      }
      assert.equal(await p.evaluate(FONCTIONS), VIVANTES, 'après douze allers-retours')
      await cliquer(p, 'changer')
      assert.deepEqual(await p.evaluate(LIRE), { classe: [false, false, true, false], case: [false, false, true, false], style: [false, false, true, false] }, 'le choix suivant')
    } finally {
      await p.close()
    }
  })
})
