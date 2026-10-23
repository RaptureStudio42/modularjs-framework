// Ce que ce test garantit : `<@@select>` annonce chaque choix de l'utilisateur par un événement
// `change` qui remonte (bubbles, composed), `e.data` = la nouvelle valeur dans son type (tableau en
// mode `multiple`) — comme un `<select>` natif, et comme ses voisins du cœur qui portent une valeur
// (`<@@color>`, `<@@number>`, `<@@knob>`, `<@@tabs>`…). Sans lui, un composant qui l'utilise ne
// pouvait réagir au choix qu'à travers la liaison `value=!{…}`. Comme le natif : rien quand
// l'utilisateur rechoisit l'option déjà choisie, rien quand la page pose la valeur elle-même.
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = `<script>
  $compte  = 0
  $dernier = null
  $lie     = 'fr'
  $echosLie = 0

  @onChoix = (e)->
    $compte++
    $dernier = e.data

  @onLie = (e)->
    $echosLie++
</script>

<div id="zone">
  <@@select name="pays" @change={@onChoix(e)}>
    <@@option value="fr">France</@@option>
    <@@option value={18}>Dix-huit</@@option>
  </@@select>
</div>

<div id="zone-multi">
  <@@select name="langues" multiple>
    <@@option value="fr">Français</@@option>
    <@@option value="de">Allemand</@@option>
  </@@select>
</div>

<div id="zone-lie">
  <@@select name="lie" value=!{$lie} @change={@onLie(e)}>
    <@@option value="fr">France</@@option>
    <@@option value="de">Allemagne</@@option>
  </@@select>
</div>

<p class="echo">{$compte}|{$dernier}</p>
`

describe('<@@select> — un choix de l\'utilisateur s\'annonce par un événement change', function () {
  this.timeout(60000)

  let window: any = null
  let hote: any   = null
  const recus: Array<{ zone: string; data: any; bubbles: boolean; composed: boolean }> = []

  const sel     = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const bouton  = (zone: string) => sel(zone)._shadow.querySelector('.select-btn')
  const options = (zone: string) => sel(zone)._shadow.querySelectorAll('.select-option')
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const touche  = (el: any, k: string) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }))

  async function choisir(zone: string, i: number): Promise<void> {
    if (!sel(zone)._state.open) { clic(bouton(zone)); await pause(30) }
    clic(options(zone)[i])
    await pause(30)
  }

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-change')
    window = monte.window
    hote   = monte.hote
    for (const zone of ['zone', 'zone-multi', 'zone-lie']) {
      hote._shadow.querySelector(`#${zone}`).addEventListener('change', (e: any) => recus.push({ zone, data: e.data, bubbles: e.bubbles, composed: e.composed }))
    }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('clic sur une option : un change remonte jusqu\'au parent, e.data = la valeur choisie', async () => {
    await choisir('zone', 0)
    const zone = recus.filter(r => r.zone === 'zone')
    assert.equal(zone.length, 1, `un change attendu, reçu : ${JSON.stringify(recus)}`)
    assert.equal(zone[0].data, 'fr')
    assert.equal(zone[0].bubbles, true, 'remonte comme le change d\'un <select> natif')
    assert.equal(zone[0].composed, true, 'traverse les frontières d\'ombre, comme les autres modules cœur')
    assert.equal(hote._shadow.querySelector('.echo').textContent, '1|fr', 'le composant réagit par @change')
  })

  it('rechoisir l\'option déjà choisie : aucun change (valeur inchangée, comme le natif)', async () => {
    await choisir('zone', 0)
    assert.equal(recus.filter(r => r.zone === 'zone').length, 1)
  })

  it('valeur typée : e.data garde le type posé par la page (le nombre 18, pas « 18 »)', async () => {
    await choisir('zone', 1)
    const dernier = recus.filter(r => r.zone === 'zone').at(-1)!
    assert.equal(dernier.data, 18)
    assert.equal(hote._shadow.querySelector('.echo').textContent, '2|18')
  })

  it('au clavier (flèche puis Entrée) : même annonce', async () => {
    const avant   = recus.filter(r => r.zone === 'zone').length
    const wrapper = sel('zone')._shadow.querySelector('.select')
    touche(wrapper, 'ArrowDown')
    await pause(30)
    touche(wrapper, 'ArrowUp')
    await pause(30)
    touche(wrapper, 'Enter')
    await pause(30)
    const zone = recus.filter(r => r.zone === 'zone')
    assert.equal(zone.length, avant + 1)
    assert.equal(zone.at(-1)!.data, 'fr')
  })

  it('mode multiple : chaque bascule annonce le nouveau tableau', async () => {
    await choisir('zone-multi', 0)
    await choisir('zone-multi', 1)
    await choisir('zone-multi', 0)
    assert.deepEqual(recus.filter(r => r.zone === 'zone-multi').map(r => Array.from(r.data)), [['fr'], ['fr', 'de'], ['de']])
  })

  it('valeur posée par la page (liaison value=!{…}) : aucun change, rien ne revient en écho', async () => {
    hote._set('lie', 'de')
    await pause(60)
    assert.equal(sel('zone-lie')._state.value, 'de', 'sanity : la liaison a bien posé la valeur')
    assert.equal(recus.filter(r => r.zone === 'zone-lie').length, 0)
    assert.equal(hote._state.echosLie, 0)
  })

  it('choix de l\'utilisateur sur un select lié : la liaison suit ET le change part', async () => {
    await choisir('zone-lie', 0)
    assert.equal(hote._state.lie, 'fr', 'la liaison remonte la valeur')
    assert.deepEqual(recus.filter(r => r.zone === 'zone-lie').map(r => r.data), ['fr'])
    assert.equal(hote._state.echosLie, 1)
  })
})
