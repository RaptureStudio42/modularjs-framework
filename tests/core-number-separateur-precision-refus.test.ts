// module cœur number (<@@number>) : le séparateur décimal est celui de la langue de la page, avec ou sans `decimals` (« 64,3 » en français,
// « 64.3 » en anglais, suivi de µlang sans remonter le module) ; `separator` le force (virgule ou point). `precision` garde au plus N
// décimales, arrondies au plus proche, sans zéro final (« 9,9 ») — écrit seul, deux ; `decimals` garde ses décimales fixes. `zero` : un
// champ vidé vaut 0 et l'écrit à la sortie (« 0,00 »). `strict` : une frappe ou un collage qui donnerait plus de décimales que le champ
// n'en tient est refusé. La variable liée, le formulaire et `aria-valuenow` reçoivent toujours le nombre, au point. La page n'a pas de
// langue au départ : le français, comme pour les libellés des modules cœur. L'arrondi se fait sur l'écriture décimale du nombre, la moitié
// loin de zéro (« 1,005 » donne 1,01) ; un très grand nombre s'écrit en clair (jamais « 1e+21 ») ; la langue entière, région comprise, choisit
// le séparateur (`de-CH` : le point) ; `zero` ramène 0 dans les bornes ; un `decimals` fautif ne promet pas une valeur écrite « telle quelle »

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $a = 64.3',
  '  $neg = -1.5',
  '  $fp = 64.3',
  '  $fv = 64.3',
  '  $p2 = 9.9',
  '  $p3 = 1.23456',
  '  $g = 123456789012.345',
  '  $d = 64.3',
  '  $z = 12.5',
  '  $c = 12.5',
  '  $v = 12.5',
  '  $s = 12.3',
  '  $t = 12.3',
  '  $ps = 1.5',
  '  $k = 1.5',
  '</script>',
  '<form class="f" :noUJS>',
  '  <@@number class="libre" name="libre" value=!{$a}></@@number>',
  '  <@@number class="neg" value=!{$neg} step="0.5"></@@number>',
  '  <@@number class="point" name="point" value=!{$fp} step="0.1" separator="."></@@number>',
  '  <@@number class="virgule" value=!{$fv} separator=","></@@number>',
  '  <@@number class="prec" name="prec" value=!{$p2} precision></@@number>',
  '  <@@number class="prec3" value=!{$p3} precision="3"></@@number>',
  '  <@@number class="grand" value=!{$g} precision="2"></@@number>',
  '  <@@number class="fixe" name="fixe" value=!{$d} decimals="2"></@@number>',
  '  <@@number class="zero" value=!{$z} decimals="2" placeholder="0,00" zero></@@number>',
  '  <@@number class="coule" value.number=!{$c} decimals="2" placeholder="0,00" zero></@@number>',
  '  <@@number class="vide" value=!{$v} decimals="2" placeholder="0,00"></@@number>',
  '  <@@number class="strict" value=!{$s} decimals="2" strict></@@number>',
  '  <@@number class="souple" value=!{$t} decimals="2"></@@number>',
  '  <@@number class="pstrict" value=!{$ps} precision="2" strict></@@number>',
  '  <@@number class="clavier" name="clavier" value=!{$k} precision="2" big="1"></@@number>',
  '</form>',
  '<button class="en" @click={µlang = \'en\'}>en</button>',
  '<button class="fr" @click={µlang = \'fr\'}>fr</button>',
  '<button class="remet" @click={$z = 0; $d = 0}>0</button>',
  '<p class="va">{$a}</p><p class="vp2">{$p2}</p><p class="vg">{$g}</p><p class="vd">{$d}</p><p class="vz">{$z}</p><p class="vc">{$c}</p><p class="vv">{$v}</p><p class="vs">{$s}</p><p class="vt">{$t}</p><p class="vps">{$ps}</p><p class="vk">{$k}</p>',
].join('\n')

const FAUTES = [
  '<script>',
  '  $p = 64.3',
  '  $q = 1.23456',
  '</script>',
  '<@@number class="pmal" value=!{$p} precision="abc"></@@number>',
  '<@@number class="pfaux" value=!{$p} precision="false"></@@number>',
  '<@@number class="smal" value=!{$p} separator=";"></@@number>',
  '<@@number class="deux" value=!{$q} decimals="1" precision="3"></@@number>',
].join('\n')

// l'arrondi des moitiés, le zéro sous un `max` négatif, un très grand nombre, `strict` devant un groupe de milliers, la langue entière de la page
const REPRISE = [
  '<script>',
  '  $r = 1.5',
  '  $d = 7.505',
  '  $n = 0',
  '  $e = 1e21',
  '  $m = 12.3',
  '  $i = 5',
  '  $w = 64.3',
  '</script>',
  '<form class="f" :noUJS>',
  '  <@@number class="moitie" value=!{$r} precision="2"></@@number>',
  '  <@@number class="fixe" value=!{$d} decimals="2"></@@number>',
  '  <@@number class="negmax" value=!{$n} max="-2" zero></@@number>',
  '  <@@number class="enorme" name="enorme" value=!{$e} precision="2"></@@number>',
  '  <@@number class="enormefixe" value=!{$e} decimals="2"></@@number>',
  '  <@@number class="enormelibre" value=!{$e}></@@number>',
  '  <@@number class="milliers" value=!{$m} decimals="2" strict></@@number>',
  '  <@@number class="entier" value=!{$i} strict></@@number>',
  '  <@@number class="region" value=!{$w}></@@number>',
  '</form>',
  '<button class="dech" @click={µlang = \'de-CH\'}>de-CH</button>',
  '<button class="esmx" @click={µlang = \'es-MX\'}>es-MX</button>',
  '<button class="enza" @click={µlang = \'en-ZA\'}>en-ZA</button>',
  '<p class="vr">{$r}</p><p class="vd">{$d}</p><p class="vn">{$n}</p><p class="vm">{$m}</p><p class="vi">{$i}</p>',
].join('\n')

describe('mjs-core-number — séparateur de la langue, `separator`, `precision`, `zero`, `strict`', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const module = (hote: any, sel: string) => hote._shadow.querySelector(sel)
  const champ  = (hote: any, sel: string) => module(hote, sel)._shadow.querySelector('.input')
  const lire   = (hote: any, sel: string) => hote._shadow.querySelector(sel).textContent
  const envoi  = (window: any, hote: any, nom: string) => [...new window.FormData(hote._shadow.querySelector('.f')).entries()].filter((e: any) => e[0] === nom).map((e: any) => e[1])
  const cliquer = async (hote: any, sel: string) => {
    hote._shadow.querySelector(sel).click()
    await pause(60)
  }
  const taper = async (window: any, input: any, texte: string) => {
    input.value = texte
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(40)
  }
  // frappe caractère par caractère, comme au clavier : chaque frappe part du texte que le champ montre
  const frapper = async (window: any, input: any, texte: string) => {
    for (const c of texte) await taper(window, input, input.value + c)
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
  const bouton = async (window: any, hote: any, sel: string, quel: string) => {
    module(hote, sel)._shadow.querySelector(quel).dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }))
    await pause(40)
  }

  it('sans `decimals` : la virgule en français (« 64,3 », « -1,5 »), le point en anglais, à chaud ; la variable et le formulaire gardent « 64.3 »', async () => {
    const { window, hote, erreurs } = await monterHote(HOTE, 'number-separateur-langue')
    const input = champ(hote, '.libre')
    assert.equal(input.value, '64,3')
    assert.equal(champ(hote, '.neg').value, '-1,5')
    assert.equal(lire(hote, '.va'), '64.3', 'la variable liée reste un nombre')
    assert.deepEqual(envoi(window, hote, 'libre'), ['64.3'], 'le formulaire reçoit le nombre, au point')
    assert.equal(input.getAttribute('aria-valuenow'), '64.3')
    await cliquer(hote, '.en')
    assert.ok(champ(hote, '.libre') === input, 'même champ, sans remonter le module')
    assert.equal(input.value, '64.3')
    assert.equal(champ(hote, '.neg').value, '-1.5')
    await cliquer(hote, '.fr')
    assert.equal(input.value, '64,3')
    assert.deepEqual([...erreurs], [], 'aucune erreur')
    window.close()
  })

  it('`separator` force le séparateur : « . » en français, « , » en anglais ; la frappe lit la virgule et le point dans toutes les langues', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-separateur-force')
    const point = champ(hote, '.point')
    assert.equal(point.value, '64.3')
    assert.equal(champ(hote, '.virgule').value, '64,3')
    await cliquer(hote, '.en')
    assert.equal(point.value, '64.3')
    assert.equal(champ(hote, '.virgule').value, '64,3')
    await taper(window, point, '2,5')
    await sortir(window, point)
    assert.equal(point.value, '2.5')
    assert.deepEqual(envoi(window, hote, 'point'), ['2.5'])
    window.close()
  })

  it('`precision` écrit seul : deux décimales au plus, arrondies au plus proche, sans zéro final ; les négatifs aussi', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-precision-defaut')
    const input = champ(hote, '.prec')
    assert.equal(input.value, '9,9', 'sans zéro final')
    assert.equal(input.getAttribute('inputmode'), 'decimal')
    await taper(window, input, '9,996')
    assert.equal(lire(hote, '.vp2'), '10', 'arrondi au plus proche dès la frappe')
    assert.deepEqual(envoi(window, hote, 'prec'), ['10'])
    await sortir(window, input)
    assert.equal(input.value, '10')
    await taper(window, input, '12,344')
    await sortir(window, input)
    assert.equal(lire(hote, '.vp2'), '12.34')
    assert.equal(input.value, '12,34')
    await taper(window, input, '-2,346')
    await sortir(window, input)
    assert.equal(lire(hote, '.vp2'), '-2.35')
    assert.equal(input.value, '-2,35')
    await taper(window, input, '7,5')
    await sortir(window, input)
    assert.equal(input.value, '7,5', 'jamais « 7,50 »')
    assert.equal(champ(hote, '.prec3').value, '1,235', '`precision="3"` : trois décimales au plus')
    window.close()
  })

  it('`precision` : un très grand nombre s\'écrit en clair, arrondi, sans zéro final ni notation exponentielle', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-precision-grand')
    const input = champ(hote, '.grand')
    assert.equal(input.value, '123456789012,35')
    await taper(window, input, '99999999999,999')
    await sortir(window, input)
    assert.equal(lire(hote, '.vg'), '100000000000')
    assert.equal(input.value, '100000000000')
    window.close()
  })

  it('`decimals` ne change pas : « 64,30 », la frappe arrondie, le formulaire au point ; une variable remise à 0 s\'écrit « 0,00 »', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-decimales-inchangees')
    const input = champ(hote, '.fixe')
    assert.equal(input.value, '64,30')
    await taper(window, input, '12,346')
    assert.equal(lire(hote, '.vd'), '12.35')
    assert.deepEqual(envoi(window, hote, 'fixe'), ['12.35'])
    await sortir(window, input)
    assert.equal(input.value, '12,35')
    await cliquer(hote, '.remet')
    assert.equal(input.value, '0,00')
    assert.equal(champ(hote, '.zero').value, '0,00')
    window.close()
  })

  it('`zero` : un champ vidé vaut 0 dès la frappe et s\'écrit « 0,00 » à la sortie ; liée par `value.number`, la variable suit ; sans `zero`, il reste vide', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-zero-ecrit')
    const zero = champ(hote, '.zero')
    await taper(window, zero, '')
    assert.equal(lire(hote, '.vz'), '0', 'la variable retombe à 0 dès la frappe')
    await sortir(window, zero)
    assert.equal(zero.value, '0,00')
    const coule = champ(hote, '.coule')
    await taper(window, coule, '')
    await sortir(window, coule)
    assert.equal(lire(hote, '.vc'), '0')
    assert.equal(coule.value, '0,00', 'la valeur montrée est celle que tient la variable')
    const vide = champ(hote, '.vide')
    await taper(window, vide, '')
    await sortir(window, vide)
    assert.equal(lire(hote, '.vv'), '', 'sans `zero`, la valeur est vide')
    assert.equal(vide.value, '', 'le substitut paraît')
    window.close()
  })

  it('`strict` : la troisième décimale tapée est refusée, la variable reste à 12.34 ; collée, la frappe entière est refusée ; sans `strict`, elle est arrondie à la sortie', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-strict-frappe')
    const strict = champ(hote, '.strict')
    await taper(window, strict, '')
    await frapper(window, strict, '12,345')
    assert.equal(strict.value, '12,34', 'le 5 est refusé')
    assert.equal(lire(hote, '.vs'), '12.34')
    await taper(window, strict, '7,891')
    assert.equal(strict.value, '12,34', 'le collage de trois décimales est refusé, le texte d\'avant reste')
    assert.equal(lire(hote, '.vs'), '12.34')
    await taper(window, strict, '12,340')
    assert.equal(strict.value, '12,340', 'un zéro final ne change pas la valeur : il passe')
    await sortir(window, strict)
    assert.equal(strict.value, '12,34')
    const souple = champ(hote, '.souple')
    await taper(window, souple, '')
    await frapper(window, souple, '12,345')
    assert.equal(souple.value, '12,345', 'sans `strict`, la frappe reste écrite')
    assert.equal(lire(hote, '.vt'), '12.35', 'arrondie dès la frappe')
    await taper(window, souple, '7,891')
    await sortir(window, souple)
    assert.equal(souple.value, '7,89')
    const pstrict = champ(hote, '.pstrict')
    await taper(window, pstrict, '')
    await frapper(window, pstrict, '3,149')
    assert.equal(pstrict.value, '3,14', '`strict` vaut aussi pour `precision`')
    assert.equal(lire(hote, '.vps'), '3.14')
    window.close()
  })

  it('`precision` ou `separator` fautifs : ignorés, une erreur chacun, au vouvoiement ; avec `decimals` écrit, `precision` ne compte pas', async () => {
    const { window, hote, erreurs } = await monterHote(FAUTES, 'number-precision-separateur-fautifs')
    const dites = [...erreurs].filter((l) => /<@@number> : (precision|separator)/.test(l))
    assert.equal(dites.length, 2, [...erreurs].join('\n'))
    assert.match(dites.find((l) => /precision « abc »/.test(l)) ?? '', /écrivez un nombre entier de 0 à 100/)
    assert.match(dites.find((l) => /separator « ; »/.test(l)) ?? '', /écrivez « , » ou « \. »/)
    assert.equal(champ(hote, '.pmal').value, '64,3', 'precision fautive : la valeur en clair')
    assert.equal(champ(hote, '.pfaux').value, '64,3', 'precision="false" : aucune précision, sans un mot')
    assert.equal(champ(hote, '.smal').value, '64,3', 'le séparateur de la langue reste')
    assert.equal(champ(hote, '.deux').value, '1,2', '`decimals` l\'emporte sur `precision`')
    window.close()
  })

  it('clavier, grand pas et boutons sous `precision` : le pas est d\'un centième, `big` d\'une unité, sans zéro final ; le formulaire au point ; la remise à zéro rend « 1,5 »', async () => {
    const { window, hote } = await monterHote(HOTE, 'number-precision-clavier')
    const input = champ(hote, '.clavier')
    assert.equal(input.value, '1,5')
    await touche(window, input, 'ArrowUp')
    assert.equal(lire(hote, '.vk'), '1.51')
    assert.equal(input.value, '1,51')
    await touche(window, input, 'ArrowDown')
    assert.equal(input.value, '1,5', 'jamais « 1,50 »')
    await touche(window, input, 'PageUp')
    assert.equal(lire(hote, '.vk'), '2.5')
    assert.equal(input.value, '2,5')
    await bouton(window, hote, '.clavier', '.more:not(.big)')
    assert.equal(input.value, '2,51')
    await bouton(window, hote, '.clavier', '.less.big')
    assert.equal(input.value, '1,51')
    assert.equal(input.getAttribute('aria-valuenow'), '1.51')
    assert.deepEqual(envoi(window, hote, 'clavier'), ['1.51'])
    hote._shadow.querySelector('.f').reset()
    await pause(60)
    assert.equal(input.value, '1,5')
    assert.equal(lire(hote, '.vk'), '1.5')
    window.close()
  })

  it('l\'arrondi au plus proche se fait sur l\'écriture décimale, la moitié loin de zéro : « 1,005 » donne 1,01 comme « 1,125 » donne 1,13 ; avec `decimals`, une valeur donnée par la page aussi (7.505 s\'écrit « 7,51 »)', async () => {
    const { window, hote } = await monterHote(REPRISE, 'number-arrondi-moities')
    const input = champ(hote, '.moitie')
    for (const [texte, valeur, montre] of [['1,005', '1.01', '1,01'], ['1,125', '1.13', '1,13'], ['2,675', '2.68', '2,68'], ['0,285', '0.29', '0,29'], ['-1,005', '-1.01', '-1,01'], ['1,004', '1', '1']]) {
      await taper(window, input, texte)
      assert.equal(lire(hote, '.vr'), valeur, `« ${texte} » dès la frappe`)
      await sortir(window, input)
      assert.equal(input.value, montre, `« ${texte} » à la sortie`)
    }
    const fixe = champ(hote, '.fixe')
    assert.equal(fixe.value, '7,51', 'la valeur de la page s\'affiche arrondie')
    assert.equal(lire(hote, '.vd'), '7.505', 'la variable ne l\'est qu\'au premier geste')
    await taper(window, fixe, '1,005')
    await sortir(window, fixe)
    assert.equal(fixe.value, '1,01')
    assert.equal(lire(hote, '.vd'), '1.01')
    window.close()
  })

  it('`zero` sous un `max` négatif : un champ vidé vaut 0 ramené dans les bornes, ici -2', async () => {
    const { window, hote } = await monterHote(REPRISE, 'number-zero-max-negatif')
    const input = champ(hote, '.negmax')
    await taper(window, input, '')
    assert.equal(lire(hote, '.vn'), '-2')
    await sortir(window, input)
    assert.equal(input.value, '-2')
    window.close()
  })

  it('un très grand nombre s\'écrit en clair, jamais « 1e+21 » : avec `precision`, avec `decimals` (et ses décimales) et sans eux ; le formulaire le reçoit en chiffres', async () => {
    const { window, hote } = await monterHote(REPRISE, 'number-tres-grand-en-clair')
    assert.equal(champ(hote, '.enorme').value, '1000000000000000000000')
    assert.equal(champ(hote, '.enormefixe').value, '1000000000000000000000,00')
    assert.equal(champ(hote, '.enormelibre').value, '1000000000000000000000')
    assert.deepEqual(envoi(window, hote, 'enorme'), ['1000000000000000000000'])
    window.close()
  })

  it('`strict` et les milliers : dans un champ décimal, le premier séparateur est la virgule décimale, « 1.234,56 » est refusé ; sous un pas entier, « 1,000 » est refusé en entier (rien que des chiffres)', async () => {
    const { window, hote } = await monterHote(REPRISE, 'number-strict-milliers')
    const milliers = champ(hote, '.milliers')
    await taper(window, milliers, '1.234,56')
    assert.equal(milliers.value, '12,30', 'refusé en entier, le texte d\'avant reste')
    assert.equal(lire(hote, '.vm'), '12.3')
    await taper(window, champ(hote, '.entier'), '1,000')
    assert.equal(champ(hote, '.entier').value, '5', 'refusé en entier, le texte d\'avant reste')
    assert.equal(lire(hote, '.vi'), '5')
    window.close()
  })

  it('le séparateur suit la langue entière de la page, région comprise, tel que le format de la langue l\'écrit : `de-CH` et `es-MX` au point, `en-ZA` comme son format, à chaud', async () => {
    const { window, hote, erreurs } = await monterHote(REPRISE, 'number-langue-entiere')
    const input = champ(hote, '.region')
    const sep   = (lang: string) => new Intl.NumberFormat(lang).formatToParts(1.5).find((p) => p.type === 'decimal')?.value
    assert.equal(input.value, '64,3')
    assert.equal(sep('de-CH'), '.', 'le format de de-CH écrit le point, celui de de la virgule')
    for (const [bouton, lang] of [['.dech', 'de-CH'], ['.esmx', 'es-MX'], ['.enza', 'en-ZA']]) {
      await cliquer(hote, bouton)
      assert.equal(input.value, `64${sep(lang)}3`, lang)
    }
    assert.deepEqual([...erreurs], [], 'aucune erreur')
    window.close()
  })

  it('`decimals` fautif : le message dit que la valeur s\'écrit comme sans `decimals` (`precision` écrit l\'arrondit encore), jamais « telle quelle »', async () => {
    const { window, hote, erreurs } = await monterHote(['<script>', '  $w = 1.23456', '</script>', '<@@number class="dmal" value=!{$w} decimals="abc" precision="2"></@@number>'].join('\n'), 'number-decimales-fautives-message')
    const dit = [...erreurs].find((l) => /<@@number> : decimals « abc »/.test(l)) ?? ''
    assert.match(dit, /la valeur s'écrit comme sans decimals/, [...erreurs].join('\n'))
    assert.doesNotMatch(dit, /telle quelle/)
    assert.equal(champ(hote, '.dmal').value, '1,23', '`precision` s\'applique')
    window.close()
  })
})
