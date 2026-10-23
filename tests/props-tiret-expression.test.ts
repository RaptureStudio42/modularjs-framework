// Une prop à tiret (`search-placeholder`) reçoit sa valeur sous son nom camelCase (`searchPlaceholder`), la clé que lit le
// composant, quelle que soit la forme qui la pose : écrite en dur, par une expression `{…}`, par une liaison `!{…}`, par un étalement
// `{...$p}`. Seule la forme en dur passait : l'attribut est relu par le composant à sa connexion (`syncProps`, mjs_element.ts), qui
// camélise le nom ; les trois autres rangeaient la valeur sous `'search-placeholder'`, une clé que personne ne lit — la prop restait à
// son défaut, sans un mot. Ne change PAS : les attributs d'une balise ordinaire (`data-x={…}`, `aria-label={…}`), `data-*` et `aria-*`
// d'un composant (attributs de sa balise), une balise tierce qui ne vient pas du framework, l'attribut écrit par le rendu serveur
// pour la liaison à deux sens (le composant le relit camélisé à l'hydratation).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { renderToString, stripEsm } from '../src/server/renderToString.js'
import { attendre, pause, monterHote } from './helpers/coeur-monter.js'
import { monterModule } from './helpers/module-dynamique.js'
import { mjsTmp } from './helpers/tmp.js'

const CARTE = [
  '<script>',
  "  $searchPlaceholder = 'défaut'",
  '  $showAll           = false',
  '  $itemCount         = 0',
  '</script>',
  '<p class="sp">{$searchPlaceholder}</p><p class="sa">{String($showAll)}</p><p class="ic">{typeof $itemCount}:{$itemCount}</p>'
].join('\n')

const HOTE = [
  '<script>',
  "  $x = 'un'",
  '  $n = 2',
  "  $p = { 'search-placeholder': 'etale', 'item-count': 5, 'data-k': 'k', 'aria-label': 'a' }",
  '</script>',
  '<@carte class="dur" search-placeholder="Chercher" show-all></@carte>',
  '<@carte class="expr" search-placeholder={$x} item-count={$n}></@carte>',
  '<@carte class="lie" search-placeholder=!{$x}></@carte>',
  '<@carte class="etale" {...$p}></@carte>',
  '<@carte class="interp" search-placeholder="a {$x}"></@carte>',
  '<@carte class="donnee" data-x={$x} aria-label={$x}></@carte>',
  '<div class="simple" data-x={$x} aria-label={$x} my-attr={$x}>t</div>'
].join('\n')

async function monter(): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp('props-tiret')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'carte.mjs'), CARTE)
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js')
  const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow && hote._shadow.querySelectorAll('mjs-carte').length === 6)
  await pause(250)
  return { window, hote }
}

// code émis pour un gabarit d'une ligne
const emis = async (gabarit: string): Promise<string> => (await transpile(['<script>', "  $x = 'a'", '</script>', gabarit].join('\n'), { moduleName: 'hote' })).output

describe('props à tiret — le code émis', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('`search-placeholder={$x}` sur un composant : la prop est posée sous `searchPlaceholder`, en attente comme en direct', async () => {
    const out = await emis('<@carte search-placeholder={$x}></@carte>')
    assert.ok(out.includes("_mjs_node._set('searchPlaceholder', $.x)"), 'pose directe sous le nom camelCase')
    assert.ok(out.includes("? 'search-placeholder' : 'searchPlaceholder', $.x)"), 'registre des props en attente sous le nom camelCase (le nom écrit pour une balise tierce)')
    assert.ok(!out.includes("_set('search-placeholder'"), 'pose directe : plus aucune clé à tiret')
  })

  it('`search-placeholder=!{$x}` : la liaison à deux sens suit la clé de l\'état de l\'enfant, l\'attribut du rendu serveur garde le tiret', async () => {
    const out = await emis('<@carte search-placeholder=!{$x}></@carte>')
    assert.ok(out.includes('"mjs-bind:searchPlaceholder"'), 'l\'enfant écrit sur la clé de son état')
    assert.ok(!out.includes('mjs-bind:search-placeholder'), 'aucune route à tiret')
    assert.ok(out.includes("_mjs_binds ??= new Set()).add('searchPlaceholder')"))
    assert.ok(out.includes("_mjs_node._state['searchPlaceholder'] !== $.x"))
    assert.ok(out.includes("_mjs_node._set('searchPlaceholder', $.x)"))
    assert.ok(out.includes("_mjs_node.setAttribute('search-placeholder', __ssrVal)"), 'l\'attribut écrit au serveur est celui de la forme en dur')
  })

  it('`{...$p}` sur un composant : la clé de la donnée est camélisée à l\'exécution, `data-*`, `aria-*` et `mjs-*` restent tels quels', async () => {
    const out = await emis('<@carte {...$x}></@carte>')
    assert.ok(/_mjs_node\._set\(_mjs_p, _mjs_v\)/.test(out), 'pose sous la clé calculée')
    assert.ok(out.includes('(?:data|aria|mjs)-'), 'les trois préfixes qui ne sont pas des props')
  })

  it('`data-x={$x}`, `aria-label={$x}` sur un composant : prop ET attribut de la balise, sous le nom écrit', async () => {
    const out = await emis('<@carte data-x={$x} aria-label={$x}></@carte>')
    assert.ok(out.includes("_mjs_node._set('data-x', __mjsV)"))
    assert.ok(out.includes("_mjs_node._set('aria-label', __mjsV)"))
    assert.ok(out.includes("µ._mjs_updAttrNode(_mjs_node, 'data-x', __mjsV, 1)"))
  })

  it('une balise ordinaire garde ses attributs : `data-x={$x}`, `aria-label={$x}`, `my-attr={$x}`', async () => {
    const out = await emis('<div data-x={$x} aria-label={$x} my-attr={$x}>t</div>')
    for (const nom of ['data-x', 'aria-label', 'my-attr']) assert.ok(new RegExp(`_mjs_updAttr\\('\\w+', '${nom}', \\$\\.x(?:, 1)?\\)`).test(out), nom)
    assert.ok(!/myAttr|dataX|ariaLabel/.test(out))
  })

  it('`some-thing={$x}` et `{...$x}` sur une balise `mjs-…` : la clé se choisit à l\'exécution (tierce : brute, du projet : camelCase), `_set` reste camelCase', async () => {
    const expr = await emis('<@carte some-thing={$x}></@carte>')
    assert.ok(expr.includes("_mjs_node._set('someThing', $.x)"))
    assert.ok(expr.includes("µ._mjs_pend(_mjs_node, (µ.paths && !Object.prototype.hasOwnProperty.call(µ.paths, _mjs_node.localName.slice(4))) ? 'some-thing' : 'someThing', $.x)"), 'registre : nom brut pour une balise tierce')
    const etale = await emis('<@carte {...$x}></@carte>')
    assert.ok(etale.includes('µ._mjs_pend(_mjs_node, (µ.paths && !Object.prototype.hasOwnProperty.call(µ.paths, _mjs_node.localName.slice(4))) ? _mjs_k : _mjs_p, _mjs_v)'), 'registre : clé de la donnée pour une balise tierce')
    assert.ok(etale.includes('_mjs_node._set(_mjs_p, _mjs_v)'))
  })

  it('une balise tierce (hors du framework) garde le nom écrit : `<my-widget some-prop={$x}>`', async () => {
    const out = await emis('<my-widget some-prop={$x}></my-widget>')
    assert.ok(out.includes("_mjs_node._set('some-prop', $.x)"))
    assert.ok(!out.includes('someProp'))
  })
})

describe('props à tiret — un composant du projet, monté', function () {
  this.timeout(60000)
  let window: any = null
  let hote: any   = null

  before(async () => { ({ window, hote } = await monter()) })
  after(async () => { await terminateSharedWorkerPool() })

  const carte = (classe: string) => hote._shadow.querySelector(`mjs-carte.${classe}`)
  const lu    = (classe: string, sel: string) => carte(classe)._shadow.querySelector(sel).textContent
  const cles  = (classe: string) => Object.keys(carte(classe)._state).filter((k) => k.includes('-'))

  it('en dur : `search-placeholder="Chercher" show-all` (la référence)', () => {
    assert.equal(lu('dur', '.sp'), 'Chercher')
    assert.equal(lu('dur', '.sa'), 'true')
    assert.deepEqual(cles('dur'), [])
  })

  it('expression : `search-placeholder={$x} item-count={$n}` — la valeur arrive typée et suit la variable', async () => {
    assert.equal(lu('expr', '.sp'), 'un')
    assert.equal(lu('expr', '.ic'), 'number:2')
    assert.deepEqual(cles('expr'), [], 'aucune clé à tiret dans l\'état')
    hote._set('x', 'deux')
    hote._set('n', 7)
    await attendre(() => lu('expr', '.sp') === 'deux' && lu('expr', '.ic') === 'number:7')
    assert.equal(lu('expr', '.sp'), 'deux')
    assert.equal(lu('expr', '.ic'), 'number:7')
  })

  it('liaison à deux sens : `search-placeholder=!{$x}` descend, et remonte quand l\'enfant écrit', async () => {
    hote._set('x', 'trois')
    await attendre(() => lu('lie', '.sp') === 'trois')
    assert.equal(lu('lie', '.sp'), 'trois')
    assert.deepEqual(cles('lie'), [])
    carte('lie')._set('searchPlaceholder', 'ecrit')
    await attendre(() => hote._state.x === 'ecrit')
    assert.equal(hote._state.x, 'ecrit', 'la variable du parent a suivi l\'enfant')
    await attendre(() => lu('expr', '.sp') === 'ecrit')
    assert.equal(lu('expr', '.sp'), 'ecrit', 'l\'autre enfant lié à la même variable aussi')
  })

  it('étalement : `{...$p}` — les clés à tiret arrivent camélisées, `data-*` et `aria-*` restent des clés brutes', async () => {
    assert.equal(lu('etale', '.sp'), 'etale')
    assert.equal(lu('etale', '.ic'), 'number:5')
    assert.deepEqual(cles('etale').sort(), ['aria-label', 'data-k'], 'seules les clés qui ne sont pas des props gardent le tiret')
    hote._set('p', { 'search-placeholder': 'etale-2', 'item-count': 9 })
    await attendre(() => lu('etale', '.sp') === 'etale-2')
    assert.equal(lu('etale', '.sp'), 'etale-2')
    assert.equal(lu('etale', '.ic'), 'number:9')
  })

  it('texte à trous : `search-placeholder="a {$x}"` suit la variable (la forme en dur, par l\'attribut)', async () => {
    hote._set('x', 'quatre')
    await attendre(() => lu('interp', '.sp') === 'a quatre')
    assert.equal(lu('interp', '.sp'), 'a quatre')
  })

  it('`data-x={$x}` et `aria-label={$x}` sur un composant : l\'attribut de sa balise ET la prop sous le nom écrit', async () => {
    hote._set('x', 'cinq')
    await attendre(() => carte('donnee').getAttribute('data-x') === 'cinq')
    const c = carte('donnee')
    assert.equal(c.getAttribute('data-x'), 'cinq')
    assert.equal(c.getAttribute('aria-label'), 'cinq')
    assert.equal(c._state['data-x'], 'cinq')
    assert.equal(c._state['aria-label'], 'cinq')
    assert.equal(c._state.dataX, undefined)
  })

  it('une balise ordinaire : `data-x={$x}`, `aria-label={$x}`, `my-attr={$x}` restent des attributs', async () => {
    hote._set('x', 'six')
    await attendre(() => hote._shadow.querySelector('div.simple').getAttribute('my-attr') === 'six')
    const d = hote._shadow.querySelector('div.simple')
    assert.equal(d.getAttribute('data-x'), 'six')
    assert.equal(d.getAttribute('aria-label'), 'six')
    assert.equal(d.getAttribute('my-attr'), 'six')
    assert.equal(d.hasAttribute('myattr'), false)
  })
})

describe('props à tiret — module cœur <@@select>', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('`search-placeholder={$ph}` : le champ de recherche affiche le texte et suit la variable', async () => {
    const hoteSelect = [
      '<script>',
      "  $ph = 'Trouver un pays'",
      '</script>',
      '<@@select class="s" name="pays" search search-placeholder={$ph}>',
      '  <@@option value="fr">France</@@option>',
      '</@@select>'
    ].join('\n')
    const { window, hote } = await monterHote(hoteSelect, 'props-tiret-select')
    const select = hote._shadow.querySelector('mjs-core-select')
    const clic   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    clic(select._shadow.querySelector('.select-btn'))
    await attendre(() => !!select._shadow.querySelector('.select-search'))
    const champ = () => select._shadow.querySelector('.select-search')
    assert.equal(select._state.searchPlaceholder, 'Trouver un pays')
    assert.equal(champ().getAttribute('placeholder'), 'Trouver un pays')
    hote._set('ph', 'Autre texte')
    await attendre(() => champ().getAttribute('placeholder') === 'Autre texte')
    assert.equal(champ().getAttribute('placeholder'), 'Autre texte', 'la valeur suit la variable')
  })
})

describe('props à tiret — composant dynamique <@module>', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('`<@module $comp search-placeholder={$x} item-count={$n}>` : les props du composant monté sont camélisées, `data-*` reste un attribut', async () => {
    const hote = [
      '<script>',
      "  $x = 'un'",
      '  $n = 2',
      "  $comp = 'mjs-carte'",
      '</script>',
      '<@module $comp search-placeholder={$x} item-count={$n} data-k={$x}></@module>'
    ].join('\n')
    const m = await monterModule({ carte: CARTE, hote }, { prefixe: 'props-tiret-module' })
    const carte = () => m.hote._shadow.querySelector('mjs-carte')
    await attendre(() => !!carte() && !!carte()._shadow && carte()._shadow.querySelector('.sp').textContent === 'un')
    assert.equal(carte()._shadow.querySelector('.sp').textContent, 'un')
    assert.equal(carte()._shadow.querySelector('.ic').textContent, 'number:2')
    assert.deepEqual(Object.keys(carte()._state).filter((k) => k.includes('-')), [], 'aucune clé à tiret dans l\'état')
    assert.equal(carte().getAttribute('data-k'), 'un', 'data-* reste un attribut de la balise')
    m.hote._set('x', 'deux')
    m.hote._set('n', 7)
    await attendre(() => carte()._shadow.querySelector('.sp').textContent === 'deux' && carte()._shadow.querySelector('.ic').textContent === 'number:7')
    assert.equal(carte()._shadow.querySelector('.sp').textContent, 'deux', 'la prop suit sa variable')
    assert.equal(carte()._shadow.querySelector('.ic').textContent, 'number:7')
  })
})

describe('props à tiret — rendu serveur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le serveur rend les valeurs posées par expression, liaison et étalement ; l\'attribut de la liaison garde le tiret', async () => {
    const root   = mjsTmp('props-tiret-ssr')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'carte.mjs'), CARTE)
    writeFileSync(join(srcDir, 'hote.mjs'), [
      '<script>',
      "  $x = 'valeur-liee'",
      "  $p = { 'search-placeholder': 'valeur-etalee', 'item-count': 5 }",
      '</script>',
      '<@carte class="expr" search-placeholder={"valeur-expression"}></@carte>',
      '<@carte class="lie" search-placeholder=!{$x}></@carte>',
      '<@carte class="etale" {...$p}></@carte>'
    ].join('\n'))
    const { html } = await renderToString({ sourceDir: srcDir, tag: 'mjs-hote' })
    for (const v of ['valeur-expression', 'valeur-liee', 'valeur-etalee']) assert.ok(html.includes(`>${v}<`), `${v} rendu par le serveur — HTML : ${html}`)
    assert.match(html, /<mjs-carte[^>]*search-placeholder="valeur-liee"/, 'l\'attribut de la liaison garde le tiret, le composant le relit camélisé à l\'hydratation')
    assert.ok(!/searchPlaceholder=|searchplaceholder=/.test(html), 'aucun attribut camélisé')
  })
})
