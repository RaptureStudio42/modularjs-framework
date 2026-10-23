// module cœur number (<@@number>) : ce que la frappe laisse partir. Un champ à pas entier garde le séparateur tapé (« 1.5 » ne devient
// jamais 15 ; « 1.234,56 », des milliers suivis de décimales, jamais 123456 ni 1) et arrondit la valeur aux décimales du pas, comme la
// sortie du champ ; un pas écrit en notation exponentielle
// (0.0000001 s'écrit 1e-7 en JavaScript) compte ses décimales ; pendant la frappe, la variable liée, aria-valuenow et le formulaire ne
// reçoivent que des valeurs bornées ; Début et Fin mènent au min et au max quand ils existent.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $q = 5',
  '  $e = 1',
  '  $t = 0',
  '  $chg = 0',
  '</script>',
  '<form class="f" @noUJS>',
  '  <@@number class="borne" name="borne" value=!{$q} min="0" max="10" @change={$chg++}></@@number>',
  '  <@@number class="entier" name="entier" value=!{$e}></@@number>',
  '  <@@number class="fin" value=!{$t} step="0.0000001"></@@number>',
  '</form>',
  '<p class="q">{$q}</p><p class="e">{$e}</p><p class="t">{$t}</p><p class="chg">{$chg}</p>',
].join('\n')

describe('mjs-core-number — saisie décimale, pas fin et bornes pendant la frappe', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const champ = (hote: any, sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.input')
  const lire  = (hote: any, sel: string) => hote._shadow.querySelector(sel).textContent
  const envoi = (window: any, hote: any, nom: string) => [...new window.FormData(hote._shadow.querySelector('.f')).entries()].filter((e: any) => e[0] === nom).map((e: any) => e[1])
  const sortir = async (window: any, input: any) => {
    input.dispatchEvent(new window.Event('blur'))
    await pause(40)
  }
  const touche = async (window: any, input: any, key: string) => {
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    input.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }))
    await pause(40)
  }

  it('pas entier : « 1.5 » tapé touche après touche ne devient jamais 15 — arrondi au pas, 2', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimale')
    const input = champ(hote, '.entier')
    input.value = ''
    const vus: string[] = []
    for (const c of '1.5') {
      // le navigateur ajoute la touche à ce que le champ montre, après le nettoyage de la touche précédente
      input.value = input.value + c
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      await pause(30)
      vus.push(lire(hote, '.e'))
    }
    assert.ok(!vus.includes('15'), `variable liée pendant la frappe : ${vus.join(', ')}`)
    assert.equal(input.value, '1.5', 'le champ montre ce qui a été tapé')
    await sortir(window, input)
    assert.equal(lire(hote, '.e'), '2')
    assert.equal(input.value, '2')
    window.close()
  })

  it('pas entier : « 1,5 » collé donne 2, « 1.234,56 » collé donne 1235, jamais 123456 ni 1', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-colle')
    const input = champ(hote, '.entier')
    input.value = '1,5'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sortir(window, input)
    assert.equal(lire(hote, '.e'), '2')
    input.value = '1.234,56'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(30)
    assert.notEqual(lire(hote, '.e'), '123456')
    await sortir(window, input)
    assert.equal(lire(hote, '.e'), '1235')
    assert.deepEqual(envoi(window, hote, 'entier'), ['1235'])
    window.close()
  })

  it('step="0.0000001" : la flèche avance d\'un pas, écrit en clair', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-pas-fin')
    const input = champ(hote, '.fin')
    await touche(window, input, 'ArrowUp')
    assert.equal(Number(lire(hote, '.t')), 1e-7)
    assert.equal(input.value, '0.0000001')
    await touche(window, input, 'ArrowUp')
    assert.equal(Number(lire(hote, '.t')), 2e-7)
    window.close()
  })

  it('max="10" : « 999 » tapé, la variable liée, aria-valuenow et le formulaire valent 10 avant la sortie du champ', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-frappe-bornee')
    const input = champ(hote, '.borne')
    input.focus()
    input.value = '999'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(40)
    assert.equal(lire(hote, '.q'), '10')
    assert.equal(input.getAttribute('aria-valuenow'), '10')
    assert.deepEqual(envoi(window, hote, 'borne'), ['10'])
    assert.equal(input.value, '999', 'le champ montre la frappe jusqu\'à la sortie')
    await sortir(window, input)
    assert.equal(input.value, '10')
    window.close()
  })

  it('Début et Fin : le min et le max quand ils existent, un `change` chacun ; sans borne, la touche reste au champ', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-debut-fin')
    const input = champ(hote, '.borne')
    await touche(window, input, 'Home')
    assert.equal(lire(hote, '.q'), '0')
    await touche(window, input, 'End')
    assert.equal(lire(hote, '.q'), '10')
    assert.equal(lire(hote, '.chg'), '2')
    const libre = champ(hote, '.entier')
    const home  = new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    libre.dispatchEvent(home)
    await pause(30)
    assert.equal(home.defaultPrevented, false, 'sans min, Début mène au début du texte')
    assert.equal(lire(hote, '.e'), '1')
    window.close()
  })
})
