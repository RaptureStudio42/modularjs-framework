// Les lignes de la remise à zéro des composants du cœur (case, interrupteur, nombre, liste, radio) que rien ne
// gardait : leur retrait pouvait sauter sans qu'aucun test ne rougisse.
// - le départ d'un composant retire son écoute du `reset` du formulaire (les cinq) et les observateurs de la liste ;
// - le choix de départ d'une liste `multiple` est une COPIE du tableau, à la prise comme à la remise : la page
//   qui modifie son tableau en place ne déplace pas le départ ;
// - la remise du nombre coupe tout ce qui était en cours : le brouillon de frappe, le geste commencé (pour qu'un
//   `change` se dise au geste suivant), l'appui maintenu et sa répétition ;
// - l'état de départ est pris UN CRAN après le montage, une fois que la page a posé ses props : une prop
//   littérale (`checked={true}`, `value={5}`) y figure déjà.
// happy-dom, bundler réel.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const RETRAIT = [
  '<script>',
  '  $a = false',
  '  $b = false',
  '  $c = false',
  '  $d = false',
  '  $e = false',
  '</script>',
  '<form id="f" @noUJS>',
  '  {if $a}<@@checkbox name="c">Case</@@checkbox>{end}',
  '  {if $b}<@@switch name="s">Interrupteur</@@switch>{end}',
  '  {if $c}<@@number name="n" value={3}></@@number>{end}',
  '  {if $d}<@@select name="p" value="fr"><@@option value="fr">France</@@option></@@select>{end}',
  '  {if $e}<@@radio name="r" value="a">A</@@radio>{end}',
  '</form>',
].join('\n')

const TABLEAU = [
  '<script>',
  '  $langs = [\'fr\']',
  '</script>',
  '<form id="f" @noUJS>',
  '  <@@select class="m" name="langues" multiple value=!{$langs}><@@option value="fr">Français</@@option><@@option value="de">Allemand</@@option></@@select>',
  '</form>',
  '<button class="ajoute" @click={$langs.push(\'de\')}>ajouter</button>',
  '<p id="val">{$langs.join(\',\')}</p>',
].join('\n')

const NOMBRE = [
  '<script>',
  '  $log = \'\'',
  '</script>',
  '<form id="f" @noUJS>',
  '  <@@number class="n" name="n" value={3} @change={$log = $log + \'[\' + e.data + \']\'}></@@number>',
  '</form>',
  '<p id="log">{$log}</p>',
].join('\n')

const LITTERAUX = [
  '<form id="f" @noUJS>',
  '  <@@checkbox class="c" name="c" checked={true}>Case</@@checkbox>',
  '  <@@switch class="s" name="s" checked={true}>Interrupteur</@@switch>',
  '  <@@number class="n" name="n" value={5}></@@number>',
  '  <@@select class="p" name="pays" value={\'be\'}><@@option value="fr">France</@@option><@@option value="be">Belgique</@@option></@@select>',
  '</form>',
].join('\n')

const formulaire = (hote: any) => hote._shadow.querySelector('#f')
const champ      = (hote: any) => hote._shadow.querySelector('.n')._shadow.querySelector('.input')
const bouton     = (hote: any, classe: string) => hote._shadow.querySelector('.n')._shadow.querySelector('.' + classe)
const journal    = (hote: any) => hote._shadow.querySelector('#log').textContent

function saisir(window: any, el: any, texte: string) {
  el.focus()
  el.value = texte
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}

const quitter  = (window: any, el: any) => el.dispatchEvent(new window.Event('blur'))
const appuyer  = (window: any, el: any) => el.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }))
const relacher = (window: any) => window.dispatchEvent(new window.Event('pointerup'))

describe('composants du cœur — la remise à zéro et son nettoyage, ligne par ligne', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('le départ d\'un composant retire ce qu\'il avait posé', () => {
    let m: any
    let resets: Set<any>
    let observateurs: Set<any>

    before(async () => {
      m = await monterHote(RETRAIT, 'reset-retrait')
      const form    = formulaire(m.hote)
      const ajouter = form.addEventListener.bind(form)
      const retirer = form.removeEventListener.bind(form)
      resets = new Set()
      form.addEventListener    = (t: string, f: any, o?: any) => { if (t === 'reset') resets.add(f); return ajouter(t, f, o) }
      form.removeEventListener = (t: string, f: any, o?: any) => { if (t === 'reset') resets.delete(f); return retirer(t, f, o) }
      const Natif  = m.window.MutationObserver
      observateurs = new Set()
      // seul l'observateur d'attributs aria-* de la liste est compté : le runtime en pose d'autres, pour tous les composants
      m.window.MutationObserver = class extends Natif {
        observe(cible: any, options?: any) {
          if (options?.attributeFilter?.includes('aria-label')) observateurs.add(this)
          return super.observe(cible, options)
        }
        disconnect() { observateurs.delete(this); return super.disconnect() }
      }
    })

    after(() => { m.window.close() })

    for (const [drapeau, nom] of [['a', 'la case'], ['b', 'l\'interrupteur'], ['c', 'le nombre'], ['d', 'la liste'], ['e', 'le bouton radio']]) {
      it(`${nom} : l'écoute du reset du formulaire est posée à l'arrivée et retirée au départ`, async () => {
        const avant = observateurs.size
        const base  = resets.size
        m.hote._set(drapeau, true)
        await attendre(() => resets.size === base + 1)
        await pause(150)
        assert.equal(resets.size, base + 1, `${nom} écoute le reset du formulaire`)
        if (drapeau === 'd') assert.equal(observateurs.size, avant + 1, 'la liste observe les attributs aria-* de sa balise')
        m.hote._set(drapeau, false)
        await pause(300)
        assert.equal(resets.size, base, `${nom} a quitté la page : plus d'écouteur du reset sur le formulaire`)
        if (drapeau === 'd') assert.equal(observateurs.size, avant, `${nom} a quitté la page : son observateur des attributs aria-* est relâché`)
      })
    }
  })

  describe('liste `multiple` : le départ est une copie du tableau', () => {
    it('la page qui modifie son tableau en place ne déplace pas le départ : la remise rend le choix du premier rendu', async () => {
      const m = await monterHote(TABLEAU, 'reset-tableau-depart')
      const etiquette = () => m.hote._shadow.querySelector('.m')._shadow.querySelector('.select-label').textContent.trim()
      await pause(150)
      assert.equal(etiquette(), 'Français', 'départ')
      m.hote._shadow.querySelector('.ajoute').click()
      await attendre(() => m.hote._shadow.querySelector('#val').textContent === 'fr,de')
      formulaire(m.hote).reset()
      await attendre(() => m.hote._shadow.querySelector('#val').textContent === 'fr')
      await pause(100)
      assert.equal(m.hote._shadow.querySelector('#val').textContent, 'fr', 'la variable de la page est revenue au choix du premier rendu')
      assert.equal(etiquette(), 'Français', 'la liste aussi')
      m.window.close()
    })

    it('après une remise, le tableau rendu à la liste n\'est pas le départ lui-même : la page qui le modifie ne le fausse pas', async () => {
      const m = await monterHote(TABLEAU, 'reset-tableau-remise')
      const valeur = () => m.hote._shadow.querySelector('#val').textContent
      await pause(150)
      m.hote._shadow.querySelector('.ajoute').click()
      await attendre(() => valeur() === 'fr,de')
      formulaire(m.hote).reset()
      await attendre(() => valeur() === 'fr')
      await pause(100)
      m.hote._shadow.querySelector('.ajoute').click()
      await attendre(() => valeur() === 'fr,de')
      formulaire(m.hote).reset()
      await attendre(() => valeur() === 'fr')
      await pause(100)
      assert.equal(valeur(), 'fr', 'une seconde remise rend encore le choix du premier rendu, pas celui de la première modification')
      m.window.close()
    })
  })

  describe('nombre : la remise coupe ce qui était en cours', () => {
    it('une frappe en cours : le champ montre la valeur de départ, pas le brouillon', async () => {
      const m = await monterHote(NOMBRE, 'reset-nombre-brouillon')
      await pause(150)
      saisir(m.window, champ(m.hote), '7')
      await pause(100)
      assert.equal(champ(m.hote).value, '7', 'préalable : la frappe est là')
      formulaire(m.hote).reset()
      await attendre(() => champ(m.hote).value === '3')
      await pause(100)
      assert.equal(champ(m.hote).value, '3', 'le brouillon est abandonné, le champ montre le départ')
      quitter(m.window, champ(m.hote))
      await pause(100)
      assert.equal(champ(m.hote).value, '3', 'quitter le champ ne ressuscite pas le brouillon')
      assert.equal(journal(m.hote), '', 'aucun change annoncé par la remise')
      m.window.close()
    })

    it('un geste commencé avant la remise ne fausse pas le change du geste suivant', async () => {
      const m = await monterHote(NOMBRE, 'reset-nombre-geste')
      await pause(150)
      saisir(m.window, champ(m.hote), '5')
      quitter(m.window, champ(m.hote))
      await attendre(() => journal(m.hote) === '[5]')
      assert.equal(journal(m.hote), '[5]', 'préalable : 3 devient 5, un change')
      saisir(m.window, champ(m.hote), '7')
      await pause(100)
      formulaire(m.hote).reset()
      await attendre(() => champ(m.hote).value === '3')
      await pause(100)
      assert.equal(journal(m.hote), '[5]', 'la remise n\'annonce rien')
      saisir(m.window, champ(m.hote), '5')
      quitter(m.window, champ(m.hote))
      await pause(200)
      assert.equal(journal(m.hote), '[5][5]', 'de 3 à 5 après la remise : un change, comme la première fois')
      m.window.close()
    })

    it('un appui maintenu sur « + » est coupé par la remise : la valeur de départ ne repart pas', async () => {
      const m = await monterHote(NOMBRE, 'reset-nombre-appui')
      await pause(150)
      appuyer(m.window, bouton(m.hote, 'more'))
      await attendre(() => champ(m.hote).value === '4')
      assert.equal(champ(m.hote).value, '4', 'préalable : l\'appui a fait un pas')
      formulaire(m.hote).reset()
      await attendre(() => champ(m.hote).value === '3')
      await pause(900)
      assert.equal(champ(m.hote).value, '3', 'la répétition de l\'appui est coupée : le départ ne bouge plus')
      relacher(m.window)
      m.window.close()
    })

    it('après une remise pendant un appui, un nouvel appui est pris en compte sans attendre le relâchement', async () => {
      const m = await monterHote(NOMBRE, 'reset-nombre-appui-suivant')
      await pause(150)
      appuyer(m.window, bouton(m.hote, 'more'))
      await attendre(() => champ(m.hote).value === '4')
      formulaire(m.hote).reset()
      await attendre(() => champ(m.hote).value === '3')
      await pause(100)
      appuyer(m.window, bouton(m.hote, 'less'))
      await attendre(() => champ(m.hote).value === '2')
      assert.equal(champ(m.hote).value, '2', 'l\'appui sur « − » après la remise fait son pas')
      relacher(m.window)
      m.window.close()
    })
  })

  describe('l\'état de départ est pris un cran après le montage', () => {
    it('des props littérales (checked={true}, value={5}, value={\'be\'}) posées par la page sont le départ : la remise les rend', async () => {
      const m = await monterHote(LITTERAUX, 'reset-depart-litteraux')
      const natif = (classe: string) => m.hote._shadow.querySelector('.' + classe)._shadow.querySelector('input')
      const nombre = () => m.hote._shadow.querySelector('.n')._shadow.querySelector('.input')
      const liste  = () => m.hote._shadow.querySelector('.p')._shadow.querySelector('.select-label').textContent.trim()
      await pause(300)
      assert.deepEqual([natif('c').checked, natif('s').checked, nombre().value, liste()], [true, true, '5', 'Belgique'], 'départ posé par la page')
      natif('c').click()
      natif('s').click()
      saisir(m.window, nombre(), '9')
      quitter(m.window, nombre())
      m.hote._shadow.querySelector('.p')._shadow.querySelector('.select-btn').click()
      await attendre(() => !!m.hote._shadow.querySelector('.p')._shadow.querySelector('.select-option'))
      m.hote._shadow.querySelector('.p')._shadow.querySelectorAll('.select-option')[0].click()
      await pause(200)
      assert.deepEqual([natif('c').checked, natif('s').checked, nombre().value, liste()], [false, false, '9', 'France'], 'préalable : les gestes ont tout changé')
      formulaire(m.hote).reset()
      await pause(300)
      assert.deepEqual([natif('c').checked, natif('s').checked, nombre().value, liste()], [true, true, '5', 'Belgique'], 'la remise rend ce que la page avait posé, pas les valeurs par défaut du module')
      m.window.close()
    })
  })
})
