// module cœur number (<@@number>) : sous un pas entier (le défaut), un séparateur suivi d'exactement trois chiffres groupe des milliers
// — « 1,000 » vaut 1000, « 10.000 » vaut 10000, jamais 1 ni 10 — ; un autre séparateur reste la virgule décimale, arrondie aux décimales
// du pas (« 1.5 » vaut 2) ; un pas décimal ne lit jamais de milliers. Début et Fin tenus avec Maj, Ctrl, Alt ou Méta gardent leur effet
// natif (sélectionner le texte) au lieu de mener aux bornes.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $e = 1',
  '  $d = 1',
  '  $p = 1',
  '  $b = 5',
  '  $chg = 0',
  '</script>',
  '<form class="f" @noUJS>',
  '  <@@number class="entier" name="entier" value=!{$e}></@@number>',
  '  <@@number class="demi" name="demi" step="0.5" big="5" value=!{$d}></@@number>',
  '  <@@number class="cinq" name="cinq" step="5" value=!{$p}></@@number>',
  '  <@@number class="borne" name="borne" value=!{$b} min="0" max="10" @change={$chg++}></@@number>',
  '</form>',
  '<p class="e">{$e}</p><p class="d">{$d}</p><p class="p">{$p}</p><p class="b">{$b}</p><p class="chg">{$chg}</p>',
].join('\n')

describe('mjs-core-number — milliers sous un pas entier, Début et Fin avec Maj', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const champ = (hote: any, sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.input')
  const lire  = (hote: any, sel: string) => hote._shadow.querySelector(sel).textContent
  const envoi = (window: any, hote: any, nom: string) => [...new window.FormData(hote._shadow.querySelector('.f')).entries()].filter((e: any) => e[0] === nom).map((e: any) => e[1])
  const coller = async (window: any, input: any, texte: string) => {
    input.value = texte
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(30)
  }
  const sortir = async (window: any, input: any) => {
    input.dispatchEvent(new window.Event('blur'))
    await pause(40)
  }

  it('pas entier : « 1,000 » vaut 1000 et « 10.000 » vaut 10000, pendant la frappe comme après la sortie du champ', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-milliers')
    const input = champ(hote, '.entier')
    await coller(window, input, '1,000')
    assert.equal(input.value, '1,000', 'le champ montre la frappe')
    assert.equal(lire(hote, '.e'), '1000')
    assert.deepEqual(envoi(window, hote, 'entier'), ['1000'])
    await sortir(window, input)
    assert.equal(lire(hote, '.e'), '1000')
    assert.equal(input.value, '1000')
    await coller(window, input, '10.000')
    assert.equal(lire(hote, '.e'), '10000')
    await sortir(window, input)
    assert.equal(lire(hote, '.e'), '10000')
    window.close()
  })

  it('pas entier : « 1,000,000 » tapé touche après touche vaut 1000000 ; « 1.234,56 » vaut 1235 ; « 1.5 » vaut 2 ; « 0,500 » vaut 1', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-milliers-frappe')
    const input = champ(hote, '.entier')
    input.value = ''
    for (const c of '1,000,000') {
      // le navigateur ajoute la touche à ce que le champ montre, après le nettoyage de la touche précédente
      input.value = input.value + c
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      await pause(20)
    }
    assert.equal(input.value, '1,000,000', 'le second séparateur reste écrit')
    assert.equal(lire(hote, '.e'), '1000000')
    await sortir(window, input)
    assert.equal(lire(hote, '.e'), '1000000')
    for (const [texte, attendu] of [['1.234,56', '1235'], ['1.5', '2'], ['0,500', '1'], ['-2,000', '-2000']]) {
      await coller(window, input, texte)
      await sortir(window, input)
      assert.equal(lire(hote, '.e'), attendu, texte)
    }
    window.close()
  })

  it('pas décimal : « 1,000 » reste 1, la virgule est décimale', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-milliers-decimal')
    const input = champ(hote, '.demi')
    await coller(window, input, '1,000')
    await sortir(window, input)
    assert.equal(lire(hote, '.d'), '1')
    window.close()
  })

  it('l\'arrondi se fait aux décimales du pas : step="5", « 7 » vaut 7 (pas de saut au multiple du pas)', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-arrondi-decimales')
    const input = champ(hote, '.cinq')
    await coller(window, input, '7')
    await sortir(window, input)
    assert.equal(lire(hote, '.p'), '7')
    window.close()
  })

  it('Maj + Début, Ctrl + Maj + Fin, Ctrl + Début : la touche garde son effet natif, la valeur ne bouge pas ; Début seul mène au min', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-debut-fin-maj')
    const input = champ(hote, '.borne')
    for (const mods of [{ shiftKey: true, key: 'Home' }, { ctrlKey: true, shiftKey: true, key: 'End' }, { ctrlKey: true, key: 'Home' }, { metaKey: true, key: 'End' }, { altKey: true, key: 'Home' }]) {
      const ev = new window.KeyboardEvent('keydown', { ...mods, bubbles: true, cancelable: true })
      input.dispatchEvent(ev)
      await pause(30)
      assert.equal(ev.defaultPrevented, false, JSON.stringify(mods))
      assert.equal(lire(hote, '.b'), '5', JSON.stringify(mods))
    }
    assert.equal(lire(hote, '.chg'), '0')
    const home = new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    input.dispatchEvent(home)
    await pause(30)
    assert.equal(home.defaultPrevented, true)
    assert.equal(lire(hote, '.b'), '0')
    window.close()
  })
})
