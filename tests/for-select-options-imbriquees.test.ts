// {for} — une liste à choix unique garde l'option choisie quand ses options viennent d'une boucle dans une boucle (avec ou sans <optgroup>), quand une
// option fixe la précède, et quand une option s'ajoute plus tard. Le gabarit d'une ligne posait `selected=""` sur chaque <option> avant que la mise à
// jour ne dise laquelle était choisie : une option insérée avec cet attribut prend le choix de la liste (le navigateur n'en garde qu'une), puis la mise à
// jour la déchoisit — la liste, sans option choisie, retombait sur sa PREMIÈRE option. Dans une boucle simple l'ordre des mises à jour sauvait le cas ;
// dans une boucle imbriquée, les options de chaque groupe arrivent après celles du groupe d'avant, déjà réglées. Trois écritures du choix : comparaison
// à une variable (`selected={o.id is $choix}`), comparaison à une valeur écrite (`selected={o.id is 'b'}`), appartenance à une liste
// (`selected={$liste.includes(o.id)}`). La page est lue dans un navigateur réel : rendue par le client seul (au départ, puis quand le choix change ou
// qu'une option s'ajoute), par le serveur happy-dom et par le serveur navigateur.

import assert from 'node:assert/strict'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

// chaque liste porte sa classe `s-<nom>` ; les options valent leur identifiant
const LISTES: Record<string, string> = {
  'groupe-variable': `<select class="s-groupe-variable" aria-label="liste">{for g in $groupes}<optgroup label={g.nom}>{for o in g.options}<option value={o.id} selected={o.id is $choix}>{o.id}</option>{end}</optgroup>{end}</select>`,
  'groupe-ecrite':   `<select class="s-groupe-ecrite" aria-label="liste">{for g in $groupes}<optgroup label={g.nom}>{for o in g.options}<option value={o.id} selected={o.id is 'b'}>{o.id}</option>{end}</optgroup>{end}</select>`,
  'groupe-liste':    `<select class="s-groupe-liste" aria-label="liste">{for g in $groupes}<optgroup label={g.nom}>{for o in g.options}<option value={o.id} selected={$liste.includes(o.id)}>{o.id}</option>{end}</optgroup>{end}</select>`,
  'sans-groupe':     `<select class="s-sans-groupe" aria-label="liste">{for g in $groupes}{for o in g.options}<option value={o.id} selected={o.id is $choix}>{o.id}</option>{end}{end}</select>`,
  'option-fixe':     `<select class="s-option-fixe" aria-label="liste"><option value="z">z</option>{for g in $groupes}{for o in g.options}<option value={o.id} selected={o.id is $choix}>{o.id}</option>{end}{end}</select>`,
  'simple':          `<select class="s-simple" aria-label="liste">{for o in $plat}<option value={o.id} selected={o.id is $choix}>{o.id}</option>{end}</select>`
}

const COMPOSANT = `<script lang="coffee">
$choix   = 'b'
$liste   = ['b']
$groupes = [{ nom: 'g1', options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { nom: 'g2', options: [{ id: 'd' }, { id: 'e' }, { id: 'f' }] }]
$plat    = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
changer = ->
  $choix = 'e'
  $liste = ['e']
ajouter = ->
  $plat.push { id: 'd' }
</script>
<button class="changer" @click={changer}>changer</button>
<button class="ajouter" @click={ajouter}>ajouter</button>
<div>
${Object.values(LISTES).join('\n')}
</div>
`

// la valeur de chaque liste, par classe, dans toutes les racines d'ombre de la page
const LIRE = `(() => {
  ${VISITER}
  const out = {}
  visiter(document, (racine) => {
    for (const s of racine.querySelectorAll('select[class^="s-"]')) out[s.className.slice(2)] = s.value
  })
  return out
})()`

const toutes = (valeur: string): Record<string, string> => Object.fromEntries(Object.keys(LISTES).map((nom) => [nom, valeur]))

describe('{for} — une liste à choix unique garde son option choisie', function () {
  this.timeout(240000)
  let composants: Composants | null

  before(async function () {
    composants = await monterComposants({ 'select-imbrique': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  async function page(): Promise<any> {
    return composants!.client('select-imbrique', '.s-simple')
  }

  async function cliquer(p: any, classe: string): Promise<void> {
    await p.evaluate(`document.querySelector('mjs-select-imbrique')._shadow.querySelector('.${classe}').click()`)
    await p.waitForTimeout(300)
  }

  it('client seul : au départ, chaque liste est sur l\'option choisie', async function () {
    const p = await page()
    try {
      assert.deepEqual(await p.evaluate(LIRE), toutes('b'))
    } finally {
      await p.close()
    }
  })

  it('client seul : quand le choix change, les listes qui le suivent changent d\'option', async function () {
    const p = await page()
    try {
      await cliquer(p, 'changer')
      const lu = await p.evaluate(LIRE)
      // « e » n'est pas dans la liste simple (a, b, c) ; la liste à valeur écrite garde « b »
      assert.deepEqual({ ...lu, simple: '' }, { ...toutes('e'), 'groupe-ecrite': 'b', simple: '' })
    } finally {
      await p.close()
    }
  })

  it('client seul : une option qui s\'ajoute à la liste ne lui retire pas son choix', async function () {
    const p = await page()
    try {
      await cliquer(p, 'ajouter')
      assert.deepEqual(await p.evaluate(LIRE), toutes('b'))
    } finally {
      await p.close()
    }
  })

  for (const moteur of ['happy', 'navigateur'] as const) {
    it(`serveur ${moteur === 'happy' ? 'happy-dom' : 'navigateur'} : la page dit chaque liste sur l'option choisie`, async function () {
      const p = await composants!.photo(composants!.serveur[moteur]['select-imbrique'])
      try {
        assert.deepEqual(await p.evaluate(LIRE), toutes('b'))
      } finally {
        await p.close()
      }
    })
  }
})
