// <@@select> : des défauts de détail, et le parcours aux flèches à travers les groupes.
// - de 0 à "" puis à false, chaque choix est annoncé : la comparaison est stricte, 0 == "" ne compte pas ;
// - en mode `multiple`, e.data est une COPIE : un gestionnaire qui la modifie ne touche pas l'état du select ;
// - une icône qui n'est ni un texte ni une image (`icon={{}}`) n'écrit plus « [object Object] » ;
// - un <@@optgroup> sans titre (`label=""`, ou sans `label`) n'ajoute pas de ligne de titre vide ;
// - le parcours aux flèches dit aussi le GROUPE de l'option active : une liste sans groupes donne les mêmes
//   libellés mais aucun groupe, donc ce test rougit dessus.
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = `<div id="zone-stricte">
  <@@select name="stricte" value={0}>
    <@@option value={0}>Zéro</@@option>
    <@@option value="">Vide</@@option>
    <@@option value={false}>Faux</@@option>
  </@@select>
</div>

<div id="zone-multi">
  <@@select name="langues" multiple>
    <@@option value="fr">Français</@@option>
    <@@option value="de">Allemand</@@option>
  </@@select>
</div>

<div id="zone-icone">
  <@@select name="icone" value="a">
    <@@option value="a" icon={{}}>Alpha</@@option>
    <@@option value="b" icon="★">Beta</@@option>
  </@@select>
</div>

<div id="zone-titres">
  <@@select name="titres">
    <@@optgroup label="">
      <@@option value="a">Sans titre</@@option>
    </@@optgroup>
    <@@optgroup label="Titre">
      <@@option value="b">Avec titre</@@option>
    </@@optgroup>
    <@@optgroup>
      <@@option value="c">Sans label</@@option>
    </@@optgroup>
    <@@optgroup label={0}>
      <@@option value="d">Titre zéro</@@option>
    </@@optgroup>
  </@@select>
</div>

<div id="zone-groupes">
  <@@select name="groupes">
    <@@optgroup label="Europe">
      <@@option value="eur">Euro</@@option>
      <@@option value="chf">Franc suisse</@@option>
    </@@optgroup>
    <@@optgroup label="Asie">
      <@@option value="jpy">Yen</@@option>
    </@@optgroup>
    <@@option value="btc">Bitcoin</@@option>
  </@@select>
</div>

<div id="zone-plat">
  <@@select name="plat">
    <@@option value="eur">Euro</@@option>
    <@@option value="chf">Franc suisse</@@option>
    <@@option value="jpy">Yen</@@option>
    <@@option value="btc">Bitcoin</@@option>
  </@@select>
</div>
`

const ATTENDU_GROUPES = ['Euro|Europe', 'Franc suisse|Europe', 'Yen|Asie', 'Bitcoin|', 'Bitcoin|', 'Yen|Asie', 'Euro|Europe', 'Bitcoin|']

describe('<@@select> — valeurs strictes, copie du tableau, icône sans image, groupes sans titre, flèches', function () {
  this.timeout(60000)

  let window: any = null
  let hote: any   = null
  const recus: Array<{ zone: string; data: any }> = []

  const sel     = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const bouton  = (zone: string) => sel(zone)._shadow.querySelector('.select-btn')
  const options = (zone: string) => sel(zone)._shadow.querySelectorAll('.select-option')
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const touche  = (zone: string, k: string) => sel(zone)._shadow.querySelector('.select').dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }))
  const de      = (zone: string) => recus.filter((r) => r.zone === zone).map((r) => r.data)

  async function ouvrir(zone: string): Promise<void> {
    if (!sel(zone)._state.open) { clic(bouton(zone)); await pause(30) }
  }

  async function choisir(zone: string, i: number): Promise<void> {
    await ouvrir(zone)
    clic(options(zone)[i])
    await pause(30)
  }

  // « libellé|groupe » de l'option active : le titre du groupe qui la porte, vide hors groupe
  function active(zone: string): string {
    const o = sel(zone)._shadow.querySelector('.select-option.active')
    const g = o.closest('.select-group')
    return `${o.textContent.trim()}|${g ? g.querySelector('.select-group-label').textContent.trim() : ''}`
  }

  async function parcours(zone: string): Promise<string[]> {
    await ouvrir(zone)
    const vus = [active(zone)]
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      touche(zone, k)
      await pause(30)
      vus.push(active(zone))
    }
    return vus
  }

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-valeurs-icones-groupes')
    window = monte.window
    hote   = monte.hote
    for (const zone of ['zone-stricte', 'zone-multi']) {
      hote._shadow.querySelector(`#${zone}`).addEventListener('change', (e: any) => {
        recus.push({ zone, data: Array.isArray(e.data) ? Array.from(e.data) : e.data })
        if (Array.isArray(e.data)) e.data.push('INTRUS')
      })
    }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('de 0 à "" puis à false : chaque choix est annoncé', async () => {
    await choisir('zone-stricte', 1)
    await choisir('zone-stricte', 2)
    assert.deepEqual(de('zone-stricte'), ['', false])
    assert.equal(sel('zone-stricte')._state.value, false, 'le select tient la dernière valeur, dans son type')
  })

  it('multiple : e.data est une copie, la modifier ne change pas le choix du select', async () => {
    await choisir('zone-multi', 0)
    assert.deepEqual(Array.from(sel('zone-multi')._state.value), ['fr'], 'l\'intrus poussé dans e.data n\'entre pas dans l\'état')
    await choisir('zone-multi', 1)
    assert.deepEqual(Array.from(sel('zone-multi')._state.value), ['fr', 'de'])
    assert.deepEqual(de('zone-multi'), [['fr'], ['fr', 'de']], 'chaque annonce porte le tableau tel qu\'il était au choix')
  })

  it('icon={{}} : ni « [object Object] », ni icône vide — dans le bouton, la liste et la jauge de largeur', async () => {
    assert.doesNotMatch(bouton('zone-icone').textContent, /object/i, 'le bouton')
    assert.equal(bouton('zone-icone').querySelectorAll('.select-icon').length, 0, 'aucune icône pour l\'option choisie')
    assert.doesNotMatch(sel('zone-icone')._shadow.querySelector('.select-sizer').textContent, /object/i, 'la jauge de largeur')
    await ouvrir('zone-icone')
    const opts = options('zone-icone')
    assert.doesNotMatch(opts[0].textContent, /object/i, 'la liste')
    assert.equal(opts[0].querySelectorAll('.select-icon').length, 0)
    assert.equal(opts[1].querySelector('.select-icon').textContent, '★', 'l\'option voisine garde son texte')
  })

  it('<@@optgroup label=""> et <@@optgroup> sans label : pas de ligne de titre vide ; les groupes titrés gardent la leur', async () => {
    await ouvrir('zone-titres')
    const titres = [...sel('zone-titres')._shadow.querySelectorAll('.select-group-label')].map((n: any) => n.textContent.trim())
    assert.deepEqual(titres, ['Titre', '0'], 'un titre « 0 » (le nombre) reste un titre')
    assert.equal(sel('zone-titres')._shadow.querySelectorAll('.select-group').length, 4, 'les quatre groupes restent des groupes')
    assert.equal(options('zone-titres').length, 4, 'et leurs options sont là')
  })

  it('les flèches passent d\'un groupe à l\'autre : chaque étape dit son option ET son groupe', async () => {
    const vus = await parcours('zone-groupes')
    assert.deepEqual(vus, ATTENDU_GROUPES)
  })

  it('la même marche sur une liste sans groupes ne donne aucun groupe : le test précédent y rougirait', async () => {
    const vus = await parcours('zone-plat')
    assert.deepEqual(vus.map((v) => v.split('|')[0]), ['Euro', 'Franc suisse', 'Yen', 'Bitcoin', 'Bitcoin', 'Yen', 'Euro', 'Bitcoin'], 'mêmes libellés')
    assert.ok(vus.every((v) => v.endsWith('|')), `aucun groupe : ${JSON.stringify(vus)}`)
    assert.notDeepEqual(vus, ATTENDU_GROUPES)
  })
})
