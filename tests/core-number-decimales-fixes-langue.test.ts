// module cœur number (<@@number>) : `decimals` fixe le nombre de décimales montrées, au format de la langue de la page (« 64,30 » en
// français, « 64.30 » en anglais, suivi de µlang sans remonter le module). La variable liée et le formulaire gardent le nombre ; la frappe,
// les flèches et les boutons arrondissent à ces décimales ; sans `step`, le pas en est la plus petite unité (0,01 pour deux), un `step`
// écrit garde la main ; un pas ou une borne plus fins imposent leurs décimales ; `decimals="0"` montre un entier. Sans `decimals`, rien
// ne change. La page n'a pas de langue au départ : le français, comme pour les libellés des modules cœur

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $p = 64.3',
  '  $n = 64',
  '  $libre = 64.3',
  '  $q = 2.5',
  '  $z = 64.4',
  '  $f = 1',
  '  $m = 5',
  '</script>',
  '<form class="f" @noUJS>',
  '  <@@number class="prix" name="prix" value=!{$p} decimals="2" min="0"></@@number>',
  '  <@@number class="entier" value=!{$n} decimals="2"></@@number>',
  '  <@@number class="libre" name="libre" value=!{$libre}></@@number>',
  '  <@@number class="pas" value=!{$q} decimals="2" step="1"></@@number>',
  '  <@@number class="zero" value=!{$z} decimals="0"></@@number>',
  '  <@@number class="fin" value=!{$f} decimals="1" step="0.05"></@@number>',
  '  <@@number class="borne" value=!{$m} decimals="2" min="0.005"></@@number>',
  '</form>',
  '<button class="en" @click={µlang = \'en\'}>en</button>',
  '<button class="fr" @click={µlang = \'fr\'}>fr</button>',
  '<p class="vp">{$p}</p><p class="vn">{$n}</p><p class="vq">{$q}</p><p class="vz">{$z}</p><p class="vf">{$f}</p><p class="vm">{$m}</p>',
].join('\n')

describe('mjs-core-number — `decimals` : décimales fixes au format de la langue de la page', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const champ  = (hote: any, sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.input')
  const lire   = (hote: any, sel: string) => hote._shadow.querySelector(sel).textContent
  const envoi  = (window: any, hote: any, nom: string) => [...new window.FormData(hote._shadow.querySelector('.f')).entries()].filter((e: any) => e[0] === nom).map((e: any) => e[1])
  const langue = async (hote: any, lang: string) => {
    hote._shadow.querySelector('.' + lang).click()
    await pause(60)
  }
  const taper = async (window: any, input: any, texte: string) => {
    input.value = texte
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(40)
  }
  const sortir = async (window: any, input: any) => {
    input.dispatchEvent(new window.Event('blur'))
    await pause(40)
  }
  const touche = async (window: any, input: any, key: string) => {
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    input.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }))
    await pause(40)
  }

  it('français : 64.3 se montre « 64,30 », 64 « 64,00 » ; la variable liée garde le nombre ; sans `decimals`, « 64.3 » comme avant', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-fr')
    assert.equal(champ(hote, '.prix').value, '64,30')
    assert.equal(champ(hote, '.entier').value, '64,00')
    assert.equal(lire(hote, '.vp'), '64.3', 'la variable liée reste un nombre')
    assert.equal(champ(hote, '.libre').value, '64.3', 'sans `decimals`, l\'affichage ne change pas')
    assert.equal(champ(hote, '.prix').getAttribute('inputmode'), 'decimal')
    assert.equal(champ(hote, '.zero').getAttribute('inputmode'), 'numeric')
    window.close()
  })

  it('µlang passe à l\'anglais : « 64.30 » et « 64.00 » dans le même champ, sans remonter le module ; retour au français : « 64,30 »', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-bascule')
    const input = champ(hote, '.prix')
    await langue(hote, 'en')
    assert.ok(champ(hote, '.prix') === input, 'même champ')
    assert.equal(input.value, '64.30')
    assert.equal(champ(hote, '.entier').value, '64.00')
    assert.equal(champ(hote, '.libre').value, '64.3')
    await langue(hote, 'fr')
    assert.equal(input.value, '64,30')
    window.close()
  })

  it('frappe en français : « 12,346 » donne 12.35 dès la frappe, « 12,35 » à la sortie, le formulaire reçoit 12.35 ; « 7 » devient « 7,00 »', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-frappe-fr')
    const input = champ(hote, '.prix')
    input.focus()
    await taper(window, input, '12,346')
    assert.equal(lire(hote, '.vp'), '12.35', 'arrondi aux décimales fixées')
    assert.equal(input.value, '12,346', 'le champ montre la frappe jusqu\'à la sortie')
    assert.deepEqual(envoi(window, hote, 'prix'), ['12.35'], 'le formulaire reçoit le nombre, au point')
    await sortir(window, input)
    assert.equal(input.value, '12,35')
    await taper(window, input, '7')
    await sortir(window, input)
    assert.equal(lire(hote, '.vp'), '7')
    assert.equal(input.value, '7,00')
    window.close()
  })

  it('frappe en anglais : « 12.346 » donne « 12.35 », « 1,5 » donne « 1.50 » (la virgule tapée reste un séparateur décimal)', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-frappe-en')
    await langue(hote, 'en')
    const input = champ(hote, '.prix')
    await taper(window, input, '12.346')
    await sortir(window, input)
    assert.equal(lire(hote, '.vp'), '12.35')
    assert.equal(input.value, '12.35')
    await taper(window, input, '1,5')
    await sortir(window, input)
    assert.equal(lire(hote, '.vp'), '1.5')
    assert.equal(input.value, '1.50')
    window.close()
  })

  it('pas : sans `step`, la flèche avance d\'un centième (« 64,31 »), Page haut de dix ; `step="1"` écrit garde son pas (« 3,50 »)', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-pas')
    const input = champ(hote, '.prix')
    await touche(window, input, 'ArrowUp')
    assert.equal(lire(hote, '.vp'), '64.31')
    assert.equal(input.value, '64,31')
    await touche(window, input, 'PageUp')
    assert.equal(lire(hote, '.vp'), '64.41')
    assert.equal(input.value, '64,41')
    const pas = champ(hote, '.pas')
    await touche(window, pas, 'ArrowUp')
    assert.equal(lire(hote, '.vq'), '3.5')
    assert.equal(pas.value, '3,50')
    window.close()
  })

  it('`decimals="0"` : un entier lisible (64.4 se montre « 64 ») et « 1,000 » tapé vaut 1000, comme sous un pas entier', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-zero')
    const input = champ(hote, '.zero')
    assert.equal(input.value, '64')
    await taper(window, input, '1,000')
    await sortir(window, input)
    assert.equal(lire(hote, '.vz'), '1000')
    assert.equal(input.value, '1000')
    window.close()
  })

  it('un pas ou une borne plus fins que `decimals` imposent leurs décimales : la valeur montrée est toujours celle que tient le champ', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-plus-fines')
    const fin = champ(hote, '.fin')
    assert.equal(fin.value, '1,00', '`step="0.05"` sous `decimals="1"` : deux décimales')
    await touche(window, fin, 'ArrowUp')
    assert.equal(lire(hote, '.vf'), '1.05')
    assert.equal(fin.value, '1,05', 'le pas se voit, il ne retombe jamais sur 1,0 ou 1,1')
    const borne = champ(hote, '.borne')
    assert.equal(borne.value, '5,000', '`min="0.005"` sous `decimals="2"` : trois décimales')
    await touche(window, borne, 'Home')
    assert.equal(lire(hote, '.vm'), '0.005')
    assert.equal(borne.value, '0,005')
    window.close()
  })
})
