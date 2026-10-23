// <select> — une liste à choix unique garde l'option choisie quand une option arrive dans un bloc de la racine ({if}, {key}, branche {success} d'un {await}),
// hors de toute boucle. Le gabarit du bloc posait `selected=""` sur l'<option> avant que la mise à jour ne dise si elle était choisie : une option insérée
// avec cet attribut prend le choix de la liste (le navigateur n'en garde qu'une), puis la mise à jour la déchoisit — la liste, sans option choisie, retombait
// sur sa PREMIÈRE option, et le choix de l'utilisateur était perdu. Quatre listes : une option sous un {if} qui s'ouvre plus tard, une sous un {if}
// ouvert dès le départ, une sous un {key} qui se refait, une dans la branche {success} d'un {await} dont la promesse est remplacée. La page est lue dans
// un navigateur réel : rendue par le client seul (au départ, quand une option arrive, quand elle devient le choix), par le serveur happy-dom et par le serveur
// navigateur.

import assert from 'node:assert/strict'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

const LISTES = ['si-plus', 'si-vu', 'cle', 'attente']

// chaque liste porte sa classe `s-<nom>` ; l'option du bloc vaut « p »
const COMPOSANT = `<script lang="coffee">
$choix    = 'b'
$vu       = true
$plus     = false
$cle      = 1
$promesse = Promise.resolve({ ok: true })
ajouter = ->
  $plus = true
refaire = ->
  $cle++
rattendre = ->
  $promesse = Promise.resolve({ ok: true })
choisir = ->
  $choix = 'p'
</script>
<button class="ajouter" @click={ajouter}>ajouter</button>
<button class="refaire" @click={refaire}>refaire</button>
<button class="rattendre" @click={rattendre}>rattendre</button>
<button class="choisir" @click={choisir}>choisir</button>
<div>
<select class="s-si-plus" aria-label="liste">
<option value="a">a</option>
<option value="b" selected={$choix is 'b'}>b</option>
{if $plus}<option value="p" selected={$choix is 'p'}>p</option>{end}
</select>
<select class="s-si-vu" aria-label="liste">
<option value="a">a</option>
<option value="b" selected={$choix is 'b'}>b</option>
{if $vu}<option value="p" selected={$choix is 'p'}>p</option>{end}
</select>
<select class="s-cle" aria-label="liste">
<option value="a">a</option>
<option value="b" selected={$choix is 'b'}>b</option>
{key $cle}<option value="p" selected={$choix is 'p'}>p</option>{end}
</select>
<select class="s-attente" aria-label="liste">
<option value="a">a</option>
<option value="b" selected={$choix is 'b'}>b</option>
{await $promesse}{success d}<option value="p" selected={$choix is 'p'}>p</option>{end}
</select>
</div>
`

// la valeur de chaque liste et le nombre de ses options, par classe, dans toutes les racines d'ombre de la page
const LIRE = `(() => {
  ${VISITER}
  const out = {}
  visiter(document, (racine) => {
    for (const s of racine.querySelectorAll('select[class^="s-"]')) out[s.className.slice(2)] = s.value + '/' + s.options.length
  })
  return out
})()`

// ce que dit chaque liste : sa valeur et son nombre d'options ; `sans` : les listes dont l'option du bloc n'est pas encore là
const attendu = (valeur: string, sans: string[] = []): Record<string, string> =>
  Object.fromEntries(LISTES.map((nom) => [nom, `${valeur}/${sans.includes(nom) ? 2 : 3}`]))

describe('<select> — une option qui arrive dans un bloc de la racine ne retire pas le choix des autres', function () {
  this.timeout(240000)
  let composants: Composants | null

  before(async function () {
    composants = await monterComposants({ 'option-bloc': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  async function page(): Promise<any> {
    return composants!.client('option-bloc', '.s-attente')
  }

  async function cliquer(p: any, classe: string): Promise<void> {
    await p.evaluate(`document.querySelector('mjs-option-bloc')._shadow.querySelector('.${classe}').click()`)
    await p.waitForTimeout(300)
  }

  it('client seul : au départ, chaque liste est sur l\'option choisie', async function () {
    const p = await page()
    try {
      assert.deepEqual(await p.evaluate(LIRE), attendu('b', ['si-plus']))
    } finally {
      await p.close()
    }
  })

  it('client seul : une option qui arrive sous un {if} ne retire pas le choix', async function () {
    const p = await page()
    try {
      await cliquer(p, 'ajouter')
      assert.deepEqual(await p.evaluate(LIRE), attendu('b'))
    } finally {
      await p.close()
    }
  })

  it('client seul : une option sous un {key} qui se refait ne retire pas le choix', async function () {
    const p = await page()
    try {
      await cliquer(p, 'refaire')
      assert.deepEqual(await p.evaluate(LIRE), attendu('b', ['si-plus']), 'une fois refaite')
      await cliquer(p, 'refaire')
      assert.deepEqual(await p.evaluate(LIRE), attendu('b', ['si-plus']), 'refaite encore')
    } finally {
      await p.close()
    }
  })

  it('client seul : une option dans la branche d\'un {await} dont la promesse est remplacée ne retire pas le choix', async function () {
    const p = await page()
    try {
      await cliquer(p, 'rattendre')
      assert.deepEqual(await p.evaluate(LIRE), attendu('b', ['si-plus']))
    } finally {
      await p.close()
    }
  })

  it('client seul : l\'option arrivée devient le choix quand le choix la désigne', async function () {
    const p = await page()
    try {
      await cliquer(p, 'ajouter')
      await cliquer(p, 'choisir')
      assert.deepEqual(await p.evaluate(LIRE), attendu('p'))
      await cliquer(p, 'refaire')
      await cliquer(p, 'rattendre')
      assert.deepEqual(await p.evaluate(LIRE), attendu('p'), 'les blocs refaits')
    } finally {
      await p.close()
    }
  })

  for (const moteur of ['happy', 'navigateur'] as const) {
    it(`serveur ${moteur === 'happy' ? 'happy-dom' : 'navigateur'} : la page dit chaque liste sur l'option choisie`, async function () {
      const p = await composants!.photo(composants!.serveur[moteur]['option-bloc'])
      try {
        assert.deepEqual(await p.evaluate(LIRE), attendu('b', ['si-plus']))
      } finally {
        await p.close()
      }
    })
  }
})
