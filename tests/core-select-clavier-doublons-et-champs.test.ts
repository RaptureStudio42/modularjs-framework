// <@@select>, joué dans happy-dom : avec `search`, le champ qui a le focus annonce la ligne active (il est le combobox, hors de la
// liste) ; deux options de même valeur s'affichent toutes les deux, aucune suite d'options ne disparaît ; liste ouverte, Espace choisit
// la ligne active (la coche en `multiple`) sauf dans le champ de recherche, où il s'écrit ; une valeur qu'aucune option ne porte ne
// part pas avec le formulaire ; Échap qui referme la liste (ou le champ du lien d'un éditeur) ne referme pas le tiroir qui la contient ;
// liste fermée, la jauge de largeur ne garde pas un élément par option.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, attendre } from './helpers/editeur-riche.js'
import { assertAbsent } from './helpers/dom-assert.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const HOTE = `<script>
  $pays    = 'fr'
  $options = [{ v: 'fr', t: 'France' }, { v: 'de', t: 'Allemagne' }]
  $mille   = [1..200].map((n)-> { v: n, t: 'Option ' + n })
  $ouvert  = true
  µmount ->
    window.__retirerFrance = -> $options = $options.filter((o)-> o.v != 'fr')
    window.__ouvert = -> $ouvert
    window.__ouvrir = -> $ouvert = true
</script>
<form class="f" @noUJS>
  <div id="z-rech"><@@select name="r" search><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="it">Italie</@@option></@@select></div>
  <div id="z-doubles"><@@select name="d"><@@option value="1">Un</@@option><@@option value="1">Uno</@@option><@@option value="2">Deux</@@option></@@select></div>
  <div id="z-sections"><@@select name="c"><@@option value="1">X</@@option><@@optgroup label="G"><@@option value="2">Y</@@option></@@optgroup><@@option value="1">Z</@@option><@@option value="3">W</@@option></@@select></div>
  <div id="z-simple"><@@select name="s"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="it">Italie</@@option></@@select></div>
  <div id="z-multi"><@@select name="m" multiple><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select></div>
  <div id="z-orphelin"><@@select name="o" value="zz"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select></div>
  <div id="z-retire"><@@select name="pays" value=!{$pays}>{for o in $options by v}<@@option value={o.v}>{o.t}</@@option>{end}</@@select></div>
  <div id="z-mille"><@@select name="n">{for o in $mille by v}<@@option value={o.v}>{o.t}</@@option>{end}<@@option value="long">Une option au libellé nettement plus long que les autres</@@option></@@select></div>
</form>
<@@menu layout="drawer" open=!{$ouvert}>
  <@@select class="lang" name="lang"><@@option value="fr">Français</@@option><@@option value="en">English</@@option></@@select>
  <@@editor class="ed" name="e" value="<p>un</p>"></@@editor>
  <input class="garde" aria-label="garde" @keydown={e.preventDefault() if e.key == 'Escape'}>
</@@menu>
`

describe('<@@select> : recherche annoncée, valeurs en double, Espace, champ d\'une valeur inconnue, Échap dans un tiroir, jauge', function () {
  this.timeout(120000)

  let window: any = null
  let hote: any   = null

  const sel     = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const ombre   = (zone: string) => sel(zone)._shadow
  const bouton  = (zone: string) => ombre(zone).querySelector('.select-btn')
  const panneau = (zone: string) => ombre(zone).querySelector('.select-panel')
  const lignes  = (zone: string) => [...ombre(zone).querySelectorAll('.select-option')]
  const champs  = (zone: string) => [...sel(zone).querySelectorAll('input[type=hidden]')].map((i: any) => [i.name, i.value])
  const touche  = (el: any, key: string) => { const e = new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }); el.dispatchEvent(e); return e }
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

  async function ouvrir(zone: string): Promise<void> {
    if (!panneau(zone)) { clic(bouton(zone)); await pause(40) }
    assert.ok(panneau(zone), 'la liste est ouverte')
  }

  async function fermer(zone: string): Promise<void> {
    if (panneau(zone)) { clic(bouton(zone)); await pause(40) }
  }

  before(async () => {
    const monte = await monter(HOTE, 'core-select-clavier-doublons')
    window = monte.window
    hote   = monte.hote
    await attendre(() => !!hote._shadow.querySelector('.ed')?._mjsExec, 10000)
  })

  after(async () => {
    await window?.happyDOM?.close()
    await terminateSharedWorkerPool()
  })

  describe('recherche et lecteur d\'écran', () => {
    it('le champ de recherche est le combobox : il annonce la ligne active et suit les flèches', async () => {
      await ouvrir('z-rech')
      await pause(30)
      const champ = ombre('z-rech').querySelector('.select-search')
      assert.ok(ombre('z-rech').activeElement === champ, 'le focus est dans le champ')
      assert.equal(champ.getAttribute('role'), 'combobox')
      assert.equal(champ.getAttribute('aria-expanded'), 'true')
      const liste = ombre('z-rech').querySelector('[role=listbox]')
      assert.equal(champ.getAttribute('aria-controls'), liste.id, 'le champ désigne la liste')
      assert.equal(champ.getAttribute('aria-activedescendant'), ombre('z-rech').querySelector('.select-option.active').id)
      touche(champ, 'ArrowDown')
      await pause(30)
      const active = ombre('z-rech').querySelector('.select-option.active')
      assert.equal(active.textContent.trim(), 'Allemagne')
      assert.equal(champ.getAttribute('aria-activedescendant'), active.id, 'la ligne active suit la flèche')
      assert.equal(bouton('z-rech').getAttribute('aria-activedescendant'), null, 'le bouton, qui n\'a plus le focus, n\'annonce rien')
      assertAbsent(liste.querySelector('input'), 'aucun champ dans la liste')
      touche(champ, 'Escape')
      await pause(30)
    })

    it('sans recherche, le bouton garde l\'annonce de la ligne active', async () => {
      bouton('z-simple').focus()
      touche(bouton('z-simple'), 'ArrowDown')
      await pause(30)
      const active = ombre('z-simple').querySelector('.select-option.active')
      assert.equal(bouton('z-simple').getAttribute('aria-activedescendant'), active.id)
      assert.equal(ombre('z-simple').querySelector('[role=listbox]').id, bouton('z-simple').getAttribute('aria-controls'))
      touche(bouton('z-simple'), 'Escape')
      await pause(30)
    })
  })

  describe('valeurs en double', () => {
    it('deux options de même valeur s\'affichent toutes les deux, ids continus', async () => {
      await ouvrir('z-doubles')
      assert.deepEqual(lignes('z-doubles').map((o: any) => o.textContent.trim()), ['Un', 'Uno', 'Deux'])
      assert.deepEqual(lignes('z-doubles').map((o: any) => o.id.split('-opt-')[1]), ['0', '1', '2'])
      touche(bouton('z-doubles'), 'ArrowDown')
      await pause(30)
      const id = bouton('z-doubles').getAttribute('aria-activedescendant')
      assert.ok(id && ombre('z-doubles').getElementById(id), 'la ligne annoncée existe')
      await fermer('z-doubles')
    })

    it('deux suites hors groupe qui commencent par la même valeur : aucune ne disparaît', async () => {
      await ouvrir('z-sections')
      assert.deepEqual(lignes('z-sections').map((o: any) => o.textContent.trim()), ['X', 'Y', 'Z', 'W'])
      assert.deepEqual(lignes('z-sections').map((o: any) => o.id.split('-opt-')[1]), ['0', '1', '2', '3'])
      await fermer('z-sections')
    })
  })

  describe('Espace, liste ouverte', () => {
    it('choisit la ligne active et referme la liste', async () => {
      bouton('z-simple').focus()
      touche(bouton('z-simple'), 'ArrowDown')
      await pause(30)
      touche(bouton('z-simple'), 'ArrowDown')
      await pause(30)
      const e = touche(bouton('z-simple'), ' ')
      await pause(30)
      assert.ok(e.defaultPrevented, 'le clic natif du bouton n\'est pas joué')
      assert.equal(sel('z-simple')._state.value, 'de')
      assertAbsent(panneau('z-simple'), 'la liste est refermée')
      assert.equal(bouton('z-simple').textContent.trim(), 'Allemagne')
    })

    it('en `multiple`, coche la ligne active et laisse la liste ouverte', async () => {
      bouton('z-multi').focus()
      touche(bouton('z-multi'), 'ArrowDown')
      await pause(30)
      touche(bouton('z-multi'), ' ')
      await pause(30)
      assert.deepEqual(Array.from(sel('z-multi')._state.value ?? []), ['fr'])
      assert.ok(panneau('z-multi'), 'la liste reste ouverte')
      touche(bouton('z-multi'), 'Escape')
      await pause(30)
    })

    it('dans le champ de recherche, Espace s\'écrit et ne choisit rien', async () => {
      await ouvrir('z-rech')
      await pause(30)
      const e = touche(ombre('z-rech').querySelector('.select-search'), ' ')
      await pause(30)
      assert.ok(!e.defaultPrevented)
      assert.equal(sel('z-rech')._state.value, null)
      assert.ok(panneau('z-rech'))
      touche(ombre('z-rech').querySelector('.select-search'), 'Escape')
      await pause(30)
    })
  })

  describe('valeur qu\'aucune option ne porte', () => {
    it('elle ne part pas avec le formulaire, le bouton dit « Choisir… »', async () => {
      assert.deepEqual(champs('z-orphelin'), [])
      assert.ok(bouton('z-orphelin').querySelector('.select-label.placeholder'))
    })

    it('l\'option choisie retirée par la page : son champ part aussi', async () => {
      assert.deepEqual(champs('z-retire'), [['pays', 'fr']])
      window.__retirerFrance()
      await pause(80)
      assert.deepEqual(champs('z-retire'), [])
      assert.ok(bouton('z-retire').querySelector('.select-label.placeholder'))
    })
  })

  describe('Échap dans un tiroir', () => {
    const lang = () => hote._shadow.querySelector('.lang')

    it('Échap referme la liste et laisse le tiroir ouvert ; liste fermée, il referme le tiroir', async () => {
      assert.equal(window.__ouvert(), true)
      const b = lang()._shadow.querySelector('.select-btn')
      b.focus()
      touche(b, 'ArrowDown')
      await pause(30)
      assert.ok(lang()._shadow.querySelector('.select-panel'))
      touche(b, 'Escape')
      await pause(30)
      assertAbsent(lang()._shadow.querySelector('.select-panel'), 'la liste est refermée')
      assert.equal(window.__ouvert(), true, 'le tiroir reste ouvert')
      touche(b, 'Escape')
      await pause(30)
      assert.equal(window.__ouvert(), false, 'liste fermée, Échap referme le tiroir')
    })

    it('Échap dans le champ du lien de l\'éditeur le referme et laisse le tiroir ouvert', async () => {
      window.__ouvrir()
      await pause(40)
      assert.equal(window.__ouvert(), true)
      const ed = hote._shadow.querySelector('.ed')
      ed._shadow.querySelector('.surface').focus()
      ed._mjsExec('link')
      await attendre(() => !!ed._shadow.querySelector('.link-url'), 3000)
      touche(ed._shadow.querySelector('.link-url'), 'Escape')
      await pause(30)
      assertAbsent(ed._shadow.querySelector('.link'), 'le champ du lien est refermé')
      assert.equal(window.__ouvert(), true, 'le tiroir reste ouvert')
    })

    it('un Échap déjà pris en charge (defaultPrevented) ne referme pas le tiroir', async () => {
      assert.equal(window.__ouvert(), true)
      touche(hote._shadow.querySelector('.garde'), 'Escape')
      await pause(30)
      assert.equal(window.__ouvert(), true)
    })
  })

  describe('jauge de largeur', () => {
    it('liste fermée, la jauge ne garde que quelques libellés, dont le plus long', async () => {
      const jauge = ombre('z-mille').querySelector('.select-sizer')
      assert.ok(jauge.children.length <= 8, `éléments dans la jauge : ${jauge.children.length}`)
      assert.ok(jauge.textContent.includes('Une option au libellé nettement plus long que les autres'))
      await ouvrir('z-mille')
      assert.equal(lignes('z-mille').length, 201, 'ouverte, la liste montre toutes ses options')
      await fermer('z-mille')
    })
  })
})
