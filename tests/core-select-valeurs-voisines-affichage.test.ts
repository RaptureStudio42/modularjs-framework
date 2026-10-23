// <@@select> : ce qui s'affiche quand les valeurs des options se ressemblent. 0, "" et false sont trois valeurs : après le
// choix de « Vide » (""), le bouton affichait « Zéro » et les trois options étaient cochées (la comparaison, lâche,
// confondait 0 == "" == false). Une seule option est cochée, celle qu'on a choisie. La comparaison se fait par la forme
// texte : « 18 » et 18 restent la même valeur (un attribut value="18" choisit l'option {18}).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = `<div id="zone-voisines">
  <@@select name="voisines" value={0}>
    <@@option value={0}>Zéro</@@option>
    <@@option value="">Vide</@@option>
    <@@option value={false}>Faux</@@option>
  </@@select>
</div>

<div id="zone-texte">
  <@@select name="texte" value="18">
    <@@option value={17}>Dix-sept</@@option>
    <@@option value={18}>Dix-huit</@@option>
    <@@option value={19}>Dix-neuf</@@option>
  </@@select>
</div>

<div id="zone-multiple">
  <@@select name="multiple" multiple value={[0, false]}>
    <@@option value={0}>Zéro</@@option>
    <@@option value="">Vide</@@option>
    <@@option value={false}>Faux</@@option>
  </@@select>
</div>
`

describe('<@@select> — 0, "" et false ne se confondent pas à l\'affichage ; « 18 » et 18 restent la même valeur', function () {
  this.timeout(60000)

  let window: any = null
  let hote: any   = null

  const sel     = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const bouton  = (zone: string) => sel(zone)._shadow.querySelector('.select-btn')
  const options = (zone: string) => [...sel(zone)._shadow.querySelectorAll('.select-option')]
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

  async function ouvrir(zone: string): Promise<void> {
    if (!sel(zone)._state.open) { clic(bouton(zone)); await pause(30) }
  }

  async function choisir(zone: string, i: number): Promise<void> {
    await ouvrir(zone)
    clic(options(zone)[i])
    await pause(30)
  }

  // le libellé du bouton, et les libellés des options cochées (classe et aria-selected), liste ouverte
  async function etat(zone: string): Promise<{ bouton: string; cochees: string[]; aria: string[] }> {
    await ouvrir(zone)
    const libelle = (o: any) => o.textContent.trim().replace(/^[^\p{L}]+/u, '')
    return {
      bouton:  bouton(zone).textContent.trim(),
      cochees: options(zone).filter((o: any) => o.classList.contains('selected')).map(libelle),
      aria:    options(zone).filter((o: any) => o.getAttribute('aria-selected') === 'true').map(libelle)
    }
  }

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-valeurs-voisines')
    window = monte.window
    hote   = monte.hote
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('au départ, value={0} : « Zéro » seul est choisi', async () => {
    const e = await etat('zone-voisines')
    assert.equal(e.bouton, 'Zéro')
    assert.deepEqual(e.cochees, ['Zéro'])
    assert.deepEqual(e.aria, ['Zéro'])
  })

  it('après le choix de « Vide » : le bouton dit « Vide », une seule option est cochée', async () => {
    await choisir('zone-voisines', 1)
    const e = await etat('zone-voisines')
    assert.equal(e.bouton, 'Vide', 'le bouton')
    assert.deepEqual(e.cochees, ['Vide'], 'les options cochées')
    assert.deepEqual(e.aria, ['Vide'], 'aria-selected')
  })

  it('après le choix de « Faux » : le bouton dit « Faux », une seule option est cochée', async () => {
    await choisir('zone-voisines', 2)
    const e = await etat('zone-voisines')
    assert.equal(e.bouton, 'Faux')
    assert.deepEqual(e.cochees, ['Faux'])
    assert.deepEqual(e.aria, ['Faux'])
  })

  it('retour à « Zéro » : le bouton dit « Zéro », une seule option est cochée', async () => {
    await choisir('zone-voisines', 0)
    const e = await etat('zone-voisines')
    assert.equal(e.bouton, 'Zéro')
    assert.deepEqual(e.cochees, ['Zéro'])
  })

  it('« 18 » (le texte d\'un attribut) choisit l\'option dont la valeur est le nombre 18, et elle seule', async () => {
    const e = await etat('zone-texte')
    assert.equal(e.bouton, 'Dix-huit')
    assert.deepEqual(e.cochees, ['Dix-huit'])
    assert.deepEqual(e.aria, ['Dix-huit'])
  })

  it('rouverte après le choix de « Vide », la liste met en avant « Vide » (l\'option active au clavier), pas « Zéro »', async () => {
    await choisir('zone-voisines', 1)
    if (sel('zone-voisines')._state.open) { clic(bouton('zone-voisines')); await pause(30) }
    await ouvrir('zone-voisines')
    const active = options('zone-voisines').filter((o: any) => o.classList.contains('active')).map((o: any) => o.textContent.trim().replace(/^[^\p{L}]+/u, ''))
    assert.deepEqual(active, ['Vide'])
    await choisir('zone-voisines', 0)
  })

  it('multiple : [0, false] coche « Zéro » et « Faux », pas « Vide »', async () => {
    const e = await etat('zone-multiple')
    assert.deepEqual(e.cochees, ['Zéro', 'Faux'])
    assert.deepEqual(e.aria, ['Zéro', 'Faux'])
  })
})
