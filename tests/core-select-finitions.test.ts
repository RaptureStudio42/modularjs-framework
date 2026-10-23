// Ce que ce test garantit : trois finitions de `<@@select>`.
// - la mémoire des choix de `match="async"` ne retient que les valeurs choisies (50 listes différentes servies : seules les valeurs choisies gardent leur libellé) ;
//   une valeur qui n'est plus choisie en sort, et le libellé du choix suit le texte de son option quand elle est visible ;
// - Tab (et Maj+Tab) ferme le panneau sans changer la valeur et sans retenir le focus, `search` part avec '' comme à toute fermeture ;
// - pendant une composition de saisie (IME), ni filtre ni `search` ne partent ; un seul passage à `compositionend`.
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = `<script>
  $serveur = [{ id: 'a', nom: 'Alpha' }, { id: 'b', nom: 'Beta' }]
  $multi   = [{ id: 'a', nom: 'Alpha' }, { id: 'b', nom: 'Beta' }]
  $texte   = 'Alpha'
  $vs      = null
  $vm      = []

  @liste = (e)->
    $serveur = [{ id: 'a', nom: 'Alpha' }, { id: 'b', nom: 'Beta' }]

  @servir = (n)->
    $serveur = Array.from({ length: 4 }, (_, i)-> { id: "s#{n}-#{i}", nom: "Serveur #{n}-#{i}" })

  @servirMulti = (n)->
    $multi = Array.from({ length: 4 }, (_, i)-> { id: "m#{n}-#{i}", nom: "Multi #{n}-#{i}" })

  @poserSimple = (v)->
    $vs = v

  @poserMulti = (v)->
    $vm = v

  @renommer = (nom)->
    $texte = nom
</script>

<form id="formulaire" @noUJS>
  <div id="serveur">
    <@@select name="serveur" search match="async" value={$vs} @search={@liste(e)}>
      {for t in $serveur by id}
        <@@option value={t.id}>{t.nom}</@@option>
      {end}
    </@@select>
  </div>

  <div id="multi">
    <@@select name="multi[]" multiple search match="async" value={$vm}>
      {for t in $multi by id}
        <@@option value={t.id}>{t.nom}</@@option>
      {end}
    </@@select>
  </div>

  <div id="renom">
    <@@select name="renom" search match="async" value="r">
      <@@option value="r">{$texte}</@@option>
    </@@select>
  </div>

  <div id="ime">
    <@@select name="ime" search>
      <@@option value="a">Alpha</@@option>
      <@@option value="b">Beta</@@option>
      <@@option value="c">Gamma</@@option>
    </@@select>
  </div>

  <input id="apres" type="text">
</form>
`

describe('<@@select> — mémoire des choix, Tab, composition', function () {
  this.timeout(60000)

  let window: any = null
  let hote: any   = null
  const recus: Array<{ zone: string; data: any }> = []

  const sel      = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const bouton   = (zone: string) => sel(zone)._shadow.querySelector('.select-btn')
  const champ    = (zone: string) => sel(zone)._shadow.querySelector('.select-search')
  const options  = (zone: string) => Array.from(sel(zone)._shadow.querySelectorAll('.select-option')) as any[]
  const clic     = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const ouvrir   = async (zone: string) => { if (!sel(zone)._state.open) { clic(bouton(zone)); await pause(40) } }
  const touche   = async (zone: string, key: string, extra: any = {}) => {
    const cible = champ(zone) ?? bouton(zone)
    cible.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...extra }))
    await pause(40)
  }
  const evt      = (zone: string, type: string, extra: any = {}) => champ(zone).dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true, composed: true, ...extra }))
  const recusDe  = (zone: string) => recus.filter((r) => r.zone === zone).map((r) => r.data)
  const choisir  = async (zone: string, texte: string) => {
    await ouvrir(zone)
    clic(options(zone).find((o: any) => o.textContent.trim() === texte))
    await pause(60)
  }

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-finitions')
    window = monte.window
    hote   = monte.hote
    for (const zone of ['serveur', 'multi', 'renom', 'ime']) {
      hote._shadow.querySelector(`#${zone}`).addEventListener('search', (e: any) => recus.push({ zone, data: e.data }))
    }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  describe('mémoire des choix (match="async")', () => {
    const libelle = (zone: string) => sel(zone)._shadow.querySelector('.select-label').textContent.trim()

    it('simple : 50 listes servies, seul le choix reste connu ; une option vue jadis sans être choisie n\'est pas retenue', async () => {
      await choisir('serveur', 'Alpha')
      for (let n = 0; n < 50; n++) {
        hote.servir(n)
        await pause(15)
      }
      await pause(60)
      assert.equal(libelle('serveur'), 'Alpha')
      hote.poserSimple('s49-1')
      await pause(60)
      assert.equal(libelle('serveur'), 'Serveur 49-1')
      hote.servir(50)
      await pause(60)
      assert.equal(libelle('serveur'), 'Serveur 49-1')
      hote.poserSimple('s3-0')
      await pause(60)
      assert.equal(sel('serveur')._shadow.querySelector('.select-label').classList.contains('placeholder'), true)
    })

    it('multiple : les choisies restent, une valeur retirée du choix est oubliée, une jamais choisie ne revient pas', async () => {
      await choisir('multi', 'Alpha')
      await choisir('multi', 'Beta')
      for (let n = 0; n < 50; n++) {
        hote.servirMulti(n)
        await pause(15)
      }
      await pause(60)
      assert.equal(libelle('multi'), 'Alpha, Beta')
      hote.poserMulti(['a'])
      await pause(60)
      assert.equal(libelle('multi'), 'Alpha')
      hote.poserMulti(['a', 'b'])
      await pause(60)
      assert.equal(libelle('multi'), 'Alpha')
      hote.poserMulti(['a', 'm3-0'])
      await pause(60)
      assert.equal(libelle('multi'), 'Alpha')
    })

    it('le libellé du choix suit le texte de son option quand elle est visible', async () => {
      assert.equal(libelle('renom'), 'Alpha')
      hote.renommer('Renommé')
      await pause(80)
      assert.equal(libelle('renom'), 'Renommé')
    })
  })

  describe('Tab', () => {
    it('Tab ferme le panneau ouvert sans changer la valeur, et la recherche annonce \'\'', async () => {
      await ouvrir('ime')
      champ('ime').value = 'al'
      evt('ime', 'input')
      await pause(60)
      assert.deepEqual(recusDe('ime'), ['al'])
      await touche('ime', 'Tab')
      assert.equal(sel('ime')._state.open, false)
      assert.equal(sel('ime')._state.value, null)
      assert.deepEqual(recusDe('ime'), ['al', ''])
    })

    it('Maj+Tab ferme aussi, sans changer la valeur', async () => {
      await ouvrir('ime')
      await touche('ime', 'Tab', { shiftKey: true })
      assert.equal(sel('ime')._state.open, false)
      assert.equal(sel('ime')._state.value, null)
    })

    it('Tab n\'est pas retenu : le navigateur garde son geste (pas de preventDefault)', async () => {
      await ouvrir('ime')
      const e = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, composed: true })
      champ('ime').dispatchEvent(e)
      await pause(40)
      assert.equal(e.defaultPrevented, false)
    })
  })

  describe('composition (IME)', () => {
    const taper = (texte: string, composition: boolean) => { champ('ime').value = texte; evt('ime', 'input', { isComposing: composition }) }

    it('pendant la composition ni filtre ni search ; un seul passage à compositionend', async () => {
      recus.length = 0
      await ouvrir('ime')
      const visibles = () => options('ime').length
      assert.equal(visibles(), 3)
      evt('ime', 'compositionstart')
      taper('b', true)
      taper('be', true)
      await pause(60)
      assert.deepEqual(recusDe('ime'), [])
      assert.equal(visibles(), 3)
      evt('ime', 'compositionend')
      await pause(60)
      assert.deepEqual(recusDe('ime'), ['be'])
      assert.equal(visibles(), 1)
    })

    it('un input qui suit compositionend avec le même texte (ordre de WebKit) ne repart pas', async () => {
      recus.length = 0
      champ('ime').value = ''
      evt('ime', 'input')
      await pause(60)
      recus.length = 0
      evt('ime', 'compositionstart')
      taper('ga', true)
      evt('ime', 'compositionend')
      taper('ga', false)
      await pause(60)
      assert.deepEqual(recusDe('ime'), ['ga'])
    })

    it('une saisie ordinaire après la composition repart normalement', async () => {
      recus.length = 0
      taper('gam', false)
      await pause(60)
      assert.deepEqual(recusDe('ime'), ['gam'])
    })
  })
})
