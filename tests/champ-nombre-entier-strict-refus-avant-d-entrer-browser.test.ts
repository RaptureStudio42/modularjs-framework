// `<@@number strict>` : chaque refus part par l'événement `refuse`, dont la donnée dit la raison ({ reason, limit }). Sous un pas entier,
// la frappe, le collage ou la composition qui porte autre chose qu'un chiffre est refusé en entier, avant d'entrer (le signe moins en tête
// seulement quand `min` est négatif ou absent) : `digits` ; un texte de plus de 15 caractères aussi : `length` ; la frappe qui met le nombre
// hors des bornes sans retour possible par la suite de la frappe (au-delà de `max` pour un nombre positif, en deçà de `min` pour un nombre
// négatif) aussi : `max`, `min`, avec la borne ; « 5 » sous `min="10"` reste, peut encore grandir, et se ramène à la sortie, dit de même ;
// une composition (clavier IME) qui finit sur un texte refusé revient au dernier bon texte. Sous un pas décimal : la décimale de trop
// (`decimals`, avec le nombre de décimales tenues), le texte trop long, la lettre retirée de la frappe et le nombre ramené à sa borne à la
// sortie. Sans `strict`, aucun `refuse` (« 1,000 » y vaut 1000). Chromium réel (frappe au clavier, collage par insertion, composition par
// le protocole du navigateur). Un champ en lecture seule ne refuse rien ; effacer passe toujours, même dans une valeur de la page hors des
// bornes, ramenée à la sortie ; une composition se montre telle quelle en route et se juge à sa fin, sous un pas entier comme décimal, où
// elle ne dit son refus qu'une fois ; un refus part après l'événement `input` de la même frappe, et l'exemple de la doc
// (`@refuse={$r = e.data} @input={$r = null}`) le garde affiché, sous Chromium comme sous Firefox, où un texte inséré passe par une
// composition ; à la sortie du champ, un refus de la dernière frappe part avant `change`, même dans la même tâche

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'entier-page.mjs': `<script>
  $a = 5
  $b = 20
  $c = 0
  $d = 12.3
  $e = 3
  $s = 5
  $l = 5
  $h = 50000
  $x = 5
  $y = 1
  $r = null
  $m = 12
  $n = 20
  $o = 12
  $jm = ''
  $jn = ''
  $jo = ''
  $refus = ''
</script>

<form class="f" :noUJS>
  <@@number class="entier" name="entier" value=!{$a} max="999" strict @refuse={$refus += JSON.stringify(e.data)}></@@number>
  <@@number class="borne" name="borne" value=!{$b} min="10" max="999" strict @refuse={$refus += JSON.stringify(e.data)}></@@number>
  <@@number class="signe" value=!{$c} min="-50" max="50" strict @refuse={$refus += JSON.stringify(e.data)}></@@number>
  <@@number class="positif" value=!{$e} min="0" strict @refuse={$refus += JSON.stringify(e.data)}></@@number>
  <@@number class="decimal" value=!{$d} decimals="2" max="99" strict @refuse={$refus += JSON.stringify(e.data)}></@@number>
  <@@number class="lecture" value=!{$l} readonly max="999" strict @refuse={$refus += JSON.stringify(e.data)}></@@number>
  <@@number class="hors" value=!{$h} max="999" strict @refuse={$refus += JSON.stringify(e.data)}></@@number>
  <@@number class="exemple" value=!{$x} min="1" max="999" strict @refuse={$r = e.data} @input={$r = null}></@@number>
  <@@number class="exemple-decimal" value=!{$y} decimals="2" max="99" strict @refuse={$r = e.data} @input={$r = null}></@@number>
  <@@number class="ordre-decimal" value=!{$m} decimals="2" min="5" max="99" strict @refuse={$jm += JSON.stringify(e.data)} @change={$jm += '|c' + e.data + '|'}></@@number>
  <@@number class="ordre-entier" value=!{$n} min="10" max="999" strict @refuse={$jn += JSON.stringify(e.data)} @change={$jn += '|c' + e.data + '|'}></@@number>
  <@@number class="ordre-tache" value=!{$o} decimals="2" min="5" max="99" strict @refuse={$jo += JSON.stringify(e.data)} @change={$jo += '|c' + e.data + '|'}></@@number>
  <@@number class="souple" value=!{$s} max="999" @refuse={$refus += JSON.stringify(e.data)}></@@number>
</form>
<p class="refus">{$refus}</p><p class="vs">{$s}</p><p class="r">{JSON.stringify($r)}</p><p class="jm">{$jm}</p><p class="jn">{$jn}</p><p class="jo">{$jo}</p>
<button class="efface" @click={$refus = ''}>e</button>
`
}

const CHIFFRES = '{"reason":"digits"}'
const LONG     = '{"reason":"length","limit":15}'

let construit: Promise<string> | null = null

function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('champ-nombre-entier-strict')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return construit
}

// la page construite, ouverte dans un onglet du navigateur sans fenêtre ; `__hote()` y lit la page, `__champ(classe)` la saisie d'un champ
async function ouvrir(browser: any, erreurs: string[]): Promise<any> {
  const script = await construire()
  const onglet = await browser.newPage()
  onglet.setDefaultTimeout(8000)
  onglet.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
  await onglet.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-entier-page></mjs-entier-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
  await onglet.waitForFunction(() => !!(document.querySelector('mjs-entier-page') as any)?._shadow?.querySelector('.souple')?._shadow?.querySelector('input'))
  await onglet.evaluate(`window.__hote = () => document.querySelector('mjs-entier-page')._shadow; window.__champ = (c) => __hote().querySelector('.' + c)._shadow.querySelector('input')`)
  return onglet
}

// l'onglet de la suite en cours : Chromium, puis Firefox
let page: any

const montre  = (c: string): Promise<string> => page.evaluate(`__champ('${c}').value`)
const annonce = (c: string): Promise<string> => page.evaluate(`__champ('${c}').getAttribute('aria-valuenow')`)
const refus   = (): Promise<string> => page.evaluate(`__hote().querySelector('p.refus').textContent`)
// ce qu'affiche l'exemple de la doc : son dernier refus, « null » une fois effacé par `@input`
const affiche = (): Promise<string> => page.evaluate(`__hote().querySelector('p.r').textContent`)
// le relevé ordonné d'un champ : ses refus et ses `change` (« |c5| »), dans l'ordre où ils partent
const ordre   = (j: string): Promise<string> => page.evaluate(`__hote().querySelector('p.${j}').textContent`)
// le champ pris, tout son texte sélectionné
const choisir = (c: string) => page.evaluate(`(() => { const i = __champ('${c}'); i.focus(); i.select() })()`)
// le champ vidé, puis la frappe au clavier réel, sans le quitter
const frapper = async (c: string, texte: string) => {
  await choisir(c)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(texte, { delay: 20 })
  await page.waitForTimeout(60)
}
// un texte inséré d'un coup sur la sélection, comme un collage
const coller = async (c: string, texte: string) => {
  await choisir(c)
  await page.keyboard.insertText(texte)
  await page.waitForTimeout(60)
}
const sortir = async (c: string) => {
  await page.evaluate(`__champ('${c}').blur()`)
  await page.waitForTimeout(60)
}

// l'exemple de la doc tel qu'écrit, sous un pas décimal puis entier : le refus part après l'événement `input` de la même frappe, que la page
// efface sur `@input`, et reste affiché
async function exempleDeLaDoc(): Promise<void> {
  await frapper('exemple-decimal', '1a')
  assert.equal(await montre('exemple-decimal'), '1', 'la lettre est retirée de la frappe')
  assert.equal(await affiche(), CHIFFRES, 'la lettre retirée reste dite (avant : « null », effacé aussitôt par `@input`)')
  await frapper('exemple-decimal', '1,234')
  assert.equal(await montre('exemple-decimal'), '1,23', 'la troisième décimale est refusée')
  assert.equal(await affiche(), '{"reason":"decimals","limit":2}', 'la décimale de trop reste dite (avant : « null »)')
  await sortir('exemple-decimal')
  await coller('exemple', '12a')
  assert.equal(await montre('exemple'), '5', 'le collage qui porte une lettre est refusé en entier')
  assert.equal(await affiche(), CHIFFRES, 'le collage refusé reste dit')
  await sortir('exemple')
}

describe('<@@number strict> : chaque refus dit sa raison par `refuse` ; sous un pas entier, refus avant d\'entrer, composition ramenée (chromium réel)', function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let cdp: any
  const erreurs: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) {
      console.log('  ℹ️  chromium non installé, test du champ strict sauté')
      return
    }
    browser = await playwright.chromium.launch()
    page    = await ouvrir(browser, erreurs)
    cdp     = await page.context().newCDPSession(page)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(async function () {
    if (!present) return
    await page.evaluate(`__hote().querySelector('button.efface').click()`)
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  // un état de composition (clavier IME) à la place de la sélection, par le protocole du navigateur, sans la valider
  const composition = async (etat: string) => {
    await cdp.send('Input.imeSetComposition', { text: etat, selectionStart: etat.length, selectionEnd: etat.length })
    await page.waitForTimeout(40)
  }
  // la composition en cours validée en `texte`
  const valider = async (texte: string) => {
    await cdp.send('Input.insertText', { text: texte })
    await page.waitForTimeout(80)
  }
  // une composition ouverte sur la sélection, menée par ses états (`etats`, le texte seul par défaut), puis validée en `texte`
  const composer = async (c: string, texte: string, etats: string[] = [texte]) => {
    await choisir(c)
    for (const etat of etats) await composition(etat)
    await valider(texte)
  }

  it('lettres, séparateurs et espaces refusés à la frappe, avant d\'entrer, chacun dit par `refuse` (raison `digits`)', async function () {
    if (!present) { this.skip(); return }
    await frapper('entier', '4a,2. b')
    assert.equal(await montre('entier'), '42', 'seuls les chiffres entrent (avant : « 4,2. »)')
    assert.equal(await annonce('entier'), '42')
    assert.equal(await refus(), CHIFFRES.repeat(5), 'chaque caractère refusé le dit : a , . espace b (avant : rien)')
    await sortir('entier')
  })

  it('collage mêlé refusé en entier : le champ garde son texte, et le dit (raison `digits`)', async function () {
    if (!present) { this.skip(); return }
    await frapper('entier', '17')
    await coller('entier', '12a3')
    assert.equal(await montre('entier'), '17', 'le collage qui porte une lettre est refusé en entier (avant : « 123 »)')
    assert.equal(await refus(), CHIFFRES)
    await coller('entier', '1,000')
    assert.equal(await montre('entier'), '17', 'un groupe de milliers aussi (avant : « 1,000 », valeur 1000)')
    assert.equal(await refus(), CHIFFRES + CHIFFRES)
    await sortir('entier')
  })

  it('frappe et collage au-delà de `max` refusés, dits par `refuse` avec la borne et sa valeur', async function () {
    if (!present) { this.skip(); return }
    await frapper('entier', '9999')
    assert.equal(await montre('entier'), '999', 'le quatrième 9 est refusé (avant : « 9999 », valeur 999)')
    assert.equal(await refus(), '{"reason":"max","limit":999}')
    await coller('entier', '1000')
    assert.equal(await montre('entier'), '999', 'le collage au-delà de max est refusé')
    assert.equal(await refus(), '{"reason":"max","limit":999}{"reason":"max","limit":999}')
    await sortir('entier')
    assert.equal(await montre('entier'), '999')
  })

  it('« 5 » sous `min="10"` reste écrit, puis se ramène à 10 à la sortie, dit par `refuse`', async function () {
    if (!present) { this.skip(); return }
    await frapper('borne', '5')
    assert.equal(await montre('borne'), '5', 'un nombre trop petit qui peut grandir reste')
    assert.equal(await refus(), '', 'rien n\'est refusé tant qu\'il peut grandir')
    await page.keyboard.type('0')
    await page.waitForTimeout(60)
    assert.equal(await montre('borne'), '50')
    await frapper('borne', '5')
    await sortir('borne')
    assert.equal(await montre('borne'), '10', 'ramené à la borne à la sortie')
    assert.equal(await refus(), '{"reason":"min","limit":10}', 'la sortie qui ramène à la borne le dit (avant : rien)')
  })

  it('le signe moins : en tête, quand `min` est négatif ; un nombre négatif sous `min` refusé ; refusé quand `min` est positif ou nul', async function () {
    if (!present) { this.skip(); return }
    await frapper('signe', '-60')
    assert.equal(await montre('signe'), '-6', 'le 0 qui mettrait -60 sous min="-50" est refusé')
    assert.equal(await refus(), '{"reason":"min","limit":-50}')
    await page.keyboard.type('-')
    await page.waitForTimeout(60)
    assert.equal(await montre('signe'), '-6', 'un signe ailleurs qu\'en tête est refusé')
    assert.equal(await refus(), '{"reason":"min","limit":-50}' + CHIFFRES)
    await sortir('signe')
    await frapper('positif', '-3')
    assert.equal(await montre('positif'), '3', 'sous min="0", le signe moins est refusé')
    assert.equal(await refus(), '{"reason":"min","limit":-50}' + CHIFFRES + CHIFFRES)
    await sortir('positif')
  })

  it('une composition qui finit sur un texte refusé revient au dernier bon texte, et le dit ; une composition de chiffres entre', async function () {
    if (!present) { this.skip(); return }
    await frapper('entier', '12')
    await sortir('entier')
    await composer('entier', '34')
    assert.equal(await montre('entier'), '34', 'des chiffres composés entrent')
    assert.equal(await refus(), '')
    await composer('entier', '５,6')
    assert.equal(await montre('entier'), '34', 'une composition qui porte autre chose que des chiffres revient au dernier bon texte (avant : « 5,6 » ou « ５,6 »)')
    assert.equal(await annonce('entier'), '34')
    assert.equal(await refus(), CHIFFRES, 'la composition ramenée le dit (avant : rien)')
    await composer('entier', '5000')
    assert.equal(await montre('entier'), '34', 'une composition au-delà de max revient au dernier bon texte')
    assert.equal(await refus(), CHIFFRES + '{"reason":"max","limit":999}')
    await sortir('entier')
  })

  it('un texte de plus de 15 caractères refusé en entier, dit par `refuse` (raison `length`, limite 15), sous un pas entier comme décimal', async function () {
    if (!present) { this.skip(); return }
    await frapper('positif', '3')
    await coller('positif', '1234567890123456')
    assert.equal(await montre('positif'), '3', 'le collage de 16 chiffres est refusé, le champ garde son texte')
    assert.equal(await refus(), LONG, 'le refus le dit (avant : rien)')
    await sortir('positif')
    await frapper('decimal', '12')
    await coller('decimal', '1234567890123,45')
    assert.equal(await montre('decimal'), '12', 'dans un champ décimal aussi')
    assert.equal(await refus(), LONG + LONG)
    await sortir('decimal')
    await frapper('entier', '17')
    await coller('entier', '1234567890123456')
    assert.equal(await montre('entier'), '17')
    assert.equal(await refus(), LONG + LONG + '{"reason":"max","limit":999}', 'sous `max`, un refus ne dit qu\'une raison : la borne, avant la longueur')
    await sortir('entier')
  })

  it('champ décimal sous `strict` : la décimale de trop (raison `decimals`, limite 2), la lettre retirée (`digits`), le nombre ramené à `max` à la sortie (`max`)', async function () {
    if (!present) { this.skip(); return }
    await frapper('decimal', '12,345')
    assert.equal(await montre('decimal'), '12,34', 'la troisième décimale est refusée, comme avant')
    assert.equal(await refus(), '{"reason":"decimals","limit":2}', 'le refus le dit (avant : rien)')
    await page.keyboard.type('a')
    await page.waitForTimeout(60)
    assert.equal(await montre('decimal'), '12,34', 'la lettre est retirée, comme avant')
    assert.equal(await refus(), '{"reason":"decimals","limit":2}' + CHIFFRES, 'la lettre retirée le dit (avant : rien)')
    await sortir('decimal')
    assert.equal(await montre('decimal'), '12,34')
    await frapper('decimal', '150')
    assert.equal(await montre('decimal'), '150', 'un nombre au-delà de max reste écrit jusqu\'à la sortie, comme avant')
    await sortir('decimal')
    assert.equal(await montre('decimal'), '99,00', 'ramené à max à la sortie')
    assert.equal(await refus(), '{"reason":"decimals","limit":2}' + CHIFFRES + '{"reason":"max","limit":99}', 'la sortie qui ramène à la borne le dit (avant : rien)')
  })

  it('sans `strict`, aucun `refuse` : « 1,000 » vaut 1000, ramené à max à la sortie', async function () {
    if (!present) { this.skip(); return }
    await frapper('souple', '1,000')
    assert.equal(await montre('souple'), '1,000')
    await page.keyboard.type('a')
    await page.waitForTimeout(60)
    assert.equal(await montre('souple'), '1,000', 'la lettre est retirée')
    await sortir('souple')
    assert.equal(await page.evaluate(`__hote().querySelector('p.vs').textContent`), '999', 'sans `strict`, « 1,000 » vaut 1000, ramené à max à la sortie')
    assert.equal(await refus(), '', 'aucun `refuse` sans `strict`')
  })

  it('lecture seule : une lettre tapée, un collage de 16 chiffres n\'entrent pas, et rien n\'est refusé', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`(() => { const i = __champ('lecture'); i.focus(); i.setSelectionRange(1, 1) })()`)
    await page.keyboard.type('a')
    await page.waitForTimeout(60)
    assert.equal(await montre('lecture'), '5', 'la lettre n\'entre pas')
    await coller('lecture', '1234567890123456')
    assert.equal(await montre('lecture'), '5', 'le collage n\'entre pas')
    assert.equal(await refus(), '', 'un champ en lecture seule ne refuse rien (avant : `digits`, puis `max`)')
    await sortir('lecture')
  })

  it('effacer passe toujours, même dans une valeur de la page hors des bornes (« 50000 » sous `max="999"`), ramenée à la sortie et dite alors', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await montre('hors'), '50000', 'la valeur de la page est montrée telle quelle')
    await page.evaluate(`(() => { const i = __champ('hors'); i.focus(); i.setSelectionRange(5, 5) })()`)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(60)
    assert.equal(await montre('hors'), '5000', 'le Retour arrière efface (avant : refusé, « 50000 » gardé)')
    assert.equal(await refus(), '', 'effacer ne se refuse pas (avant : `max`)')
    await sortir('hors')
    assert.equal(await montre('hors'), '999', 'ramenée à la borne à la sortie')
    assert.equal(await refus(), '{"reason":"max","limit":999}', 'la sortie qui ramène à la borne le dit')
  })

  it('champ décimal : une composition se montre telle quelle en route et se juge à sa fin, où elle dit au plus un refus', async function () {
    if (!present) { this.skip(); return }
    await choisir('decimal')
    await composition('a')
    await composition('ab')
    assert.equal(await montre('decimal'), 'ab', 'la composition en cours est montrée telle quelle (avant : vidée en route)')
    await valider('12')
    assert.equal(await montre('decimal'), '12', 'la composition validée entre')
    assert.equal(await refus(), '', 'une composition validée en chiffres ne dit rien (avant : `digits` pour « a », puis pour « ab »)')
    await composer('decimal', '１２', ['１', '１２'])
    assert.equal(await refus(), CHIFFRES, 'une composition validée sur des caractères retirés le dit une fois, à sa fin (avant : trois fois)')
    await sortir('decimal')
  })

  it('champ décimal : « 1 », une composition « a » laissée ouverte, puis la sortie : le refus part avant `change`, puis la borne', async function () {
    if (!present) { this.skip(); return }
    await frapper('ordre-decimal', '1')
    await composition('a')
    await sortir('ordre-decimal')
    assert.equal(await ordre('jm'), CHIFFRES + '|c5|{"reason":"min","limit":5}', 'la composition se juge à la sortie, son refus d\'abord')
    assert.equal(await montre('ordre-decimal'), '5,00')
  })

  it('champ entier : « 5 », une composition « x » laissée ouverte, puis la sortie : le refus part avant `change`, puis la borne', async function () {
    if (!present) { this.skip(); return }
    await frapper('ordre-entier', '5')
    await composition('x')
    await sortir('ordre-entier')
    assert.equal(await ordre('jn'), CHIFFRES + '|c10|{"reason":"min","limit":10}', 'le refus de la composition part avant `change` (avant : après la borne)')
    assert.equal(await montre('ordre-entier'), '10')
  })

  it('un `input` refusé puis la sortie, dans la même tâche : le refus part avant `change`', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`(() => { const i = __champ('ordre-tache'); i.focus(); i.select(); i.value = '1'; i.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: '1' })); i.value = '1a'; i.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'a' })); i.blur() })()`)
    await page.waitForTimeout(60)
    assert.equal(await ordre('jo'), CHIFFRES + '|c5|{"reason":"min","limit":5}', 'le refus de la frappe part d\'abord (avant : après la borne)')
  })

  it('l\'exemple de la doc (`@refuse={$r = e.data} @input={$r = null}`) garde le refus affiché, dans un champ décimal comme entier', async function () {
    if (!present) { this.skip(); return }
    await exempleDeLaDoc()
  })
})

describe('<@@number strict> : l\'exemple de la doc garde le refus affiché (firefox réel, où un texte inséré passe par une composition)', function () {
  this.timeout(120000)
  let present = false
  let browser: any
  const erreurs: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.firefox.executablePath())
    if (!present) {
      console.log('  ℹ️  firefox non installé, exemple de la doc sous firefox sauté')
      return
    }
    browser = await playwright.firefox.launch()
    page    = await ouvrir(browser, erreurs)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  it('l\'exemple de la doc : la lettre retirée, la décimale de trop, le collage refusé restent affichés', async function () {
    if (!present) { this.skip(); return }
    await exempleDeLaDoc()
  })
})
