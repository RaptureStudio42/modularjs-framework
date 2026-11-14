// La part des collections de l'état — `Map`, `Set`, `WeakMap`, `WeakSet` : clé objet suivie, index des clés, enveloppe d'une `WeakMap`
// ou d'un `WeakSet`, `µraw` qui en rend la vraie collection — n'entre au cœur que si une unité du projet, ou un fichier `.js` qu'elle
// importe, nomme une de ces collections (dans son code : ni dans une chaîne ni dans un commentaire), ou si la clé `runtime` la demande
// (`"collections"`). Sans elle, le cœur garde ses lignes d'avant, en développement comme en production : une `Map` venue d'ailleurs
// (bibliothèque chargée à part) garde son enveloppe, sa clé objet sort brute, une `WeakMap` reste sans enveloppe dans un composant —
// jamais une erreur, et le développement le dit une fois. `µraw` ne lit rien sur l'objet qu'on lui donne : un Proxy de la page qui
// refuse toute lecture se range, se relit, s'affiche, avec ou sans la part des collections faibles. L'index des clés d'une collection ne
// retient aucun objet, même après un `clear` fait hors de MJS (ramasse-miettes forcé)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

interface Reglages { prod?: boolean, proxy?: boolean, lisible?: boolean, runtime?: string[], fichiers?: Record<string, string> }

// une appli bâtie : son code prêt à évaluer dans une page, et les avertissements de la construction ; `lisible` : production non minifiée,
// où les noms internes du cœur se lisent
async function construire(composants: Record<string, string>, r: Reglages = {}): Promise<{ code: string, avis: string[] }> {
  const root   = mjsTmp('collections-part')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  for (const [nom, source] of Object.entries(r.fichiers || {})) writeFileSync(join(srcDir, nom), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (r.proxy === false) opts.proxy = false
  if (r.runtime) opts.runtime = r.runtime
  if (r.prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  if (r.lisible) opts.minify = false
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = r.prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  return { code, avis: stats.warnings.map(String) }
}

async function jouer(code: string, page: string, scenario: string, gc?: () => void): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  if (gc) window.__gc = gc
  window.eval(page)
  window.eval(code)
  const r = JSON.parse(JSON.stringify(await window.eval(scenario)))
  await window.happyDOM.close()
  return r
}

const MODES: [string, boolean, boolean][] = [['enveloppe, développement', false, true], ['enveloppe, production', true, true], ['"proxy": false, développement', false, false], ['"proxy": false, production', true, false]]
// essai qui rend le texte de la valeur, ou le nom de l'erreur levée
const T = `t = (f) ->\n  try\n    String(f())\n  catch e\n    'ERR ' + e.constructor.name\n`
// noms de la page à deux soulignés : le paquet de production, évalué comme un script, déclare ses noms courts sur `window`
const AVIS   = `window.__W = [];
(() => {
  const w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`
const OUTILS = `const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const monter = async (n) => { const el = document.body.appendChild(document.createElement('mjs-' + n)); await attendre(() => el._shadow?.querySelector('.v')); return el }
  const ecran = (el) => el._shadow.querySelector('.v').textContent`

// ce que le cœur porte, lu sur une production non minifiée : l'aide des clés (`_mjs_keyIn`) pour la part des collections, le carnet des
// enveloppes des collections faibles (`_mjs_weakRaw`) pour celle de `WeakMap` et de `WeakSet`
// l'appli écrit ce pour quoi le compilateur fabrique ses propres collections (écouteurs, liaison, classe d'une ligne, `:attach`) : elles ne comptent pas
const LISTE = (plus: string) => `<script>\n$l = [{id: 1}]\n$a = 1\n$choix = 1\n${plus}@brut = -> µraw({a: 1})\n@plus = -> $l.push({id: 2})\n@noter = (n) -> -> n\n</script>\n<ul class="v">{for r in $l by id}<li class:choisi={r.id is $choix} @click={@plus} :attach={@noter(_node)}>{r.id}</li>{end}</ul><input aria-label="a" :value=$a>\n`
// lu hors des lignes de commentaire, que le cœur de développement garde
const porte = (code: string) => { const c = code.replace(/^[ \t]*\/\/.*$/gm, ''); return { cles: /\._mjs_keyIn\b/.test(c), faibles: /\._mjs_weakRaw\b/.test(c), tests: /instanceof Weak(?:Map|Set)\b/.test(c) } }

describe('part des collections de l\'état : au cœur seulement quand le projet nomme une collection, ou que `runtime` la demande', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucune collection nommée : ni aide des clés, ni carnet des collections faibles, ni test `instanceof WeakMap`', async () => {
    const { code } = await construire({ 'co-sans': LISTE('') }, { prod: true, lisible: true })
    assert.deepEqual(porte(code), { cles: false, faibles: false, tests: false })
  })

  it('`Map` ou `Set` nommé dans une unité : l\'aide des clés, sans le carnet des collections faibles', async () => {
    const { code } = await construire({ 'co-map': LISTE('$m = new Map()\n') }, { prod: true, lisible: true })
    assert.deepEqual(porte(code), { cles: true, faibles: false, tests: true })
  })

  it('`WeakMap` ou `WeakSet` nommé dans une unité : l\'aide des clés et le carnet des collections faibles', async () => {
    const { code } = await construire({ 'co-faible': LISTE('$w = new WeakSet()\n') }, { prod: true, lisible: true })
    assert.deepEqual(porte(code), { cles: true, faibles: true, tests: true })
  })

  it('nommée dans une chaîne ou un commentaire seulement : rien', async () => {
    const { code } = await construire({ 'co-texte': LISTE('# une Map, un Set\n$t = \'new Map(), new WeakSet()\'\n') }, { prod: true, lisible: true })
    assert.deepEqual(porte(code), { cles: false, faibles: false, tests: false })
  })

  it('nommée dans un fichier `.js` importé seulement : la part entre', async () => {
    const source   = `<script>\n$n = 0\n@charger = ->\n  m = await µimport('./aide.js')\n  $n = m.carte().size\n</script>\n<p class="v">{$n}</p>\n`
    const { code } = await construire({ 'co-js': source }, { prod: true, lisible: true, fichiers: { 'aide.js': 'export const carte = () => new WeakMap()\n' } })
    assert.deepEqual(porte(code), { cles: true, faibles: true, tests: true })
  })

  it('`"runtime": ["collections"]` : la part entre sans collection nommée, et le nom est accepté', async () => {
    const { code, avis } = await construire({ 'co-force': LISTE('') }, { prod: true, lisible: true, runtime: ['collections'] })
    assert.deepEqual(porte(code), { cles: true, faibles: true, tests: true })
    assert.deepEqual(avis.filter((a) => a.includes('collections')), [])
  })

  it('développement : la même règle qu\'en production', async () => {
    const sans = await construire({ 'co-sans': LISTE('') })
    const avec = await construire({ 'co-map': LISTE('$m = new Map()\n') })
    assert.deepEqual([porte(sans.code).cles, porte(avec.code).cles], [false, true])
  })
})

// collections faites par la page (une bibliothèque chargée à part), rangées dans l'état d'une appli qui n'en nomme aucune
const PAGE_VENUE     = AVIS + `
window.__carte = (r) => new Map([[r, { prix: 2 }]]);
window.__faible = (r) => new WeakMap([[r, 3]]);`
const VENUE          = `<script>\nr0 = {nom: 'a'}\n$rows = [r0]\n$m = window.__carte(r0)\n$w = window.__faible(r0)\n${T}@lire = -> [t(-> $m.get(r0)?.prix), t(-> $m.has($rows[0])), t(-> $m.size), t(-> $w.get(r0)), t(-> $w.has($rows[0]))].join('/')\n@ecrire = ->\n  f = ->\n    $m.set('k', 1)\n    $w.set($rows[0], 5)\n    'ok'\n  t(f)\n</script>\n<p class="v">{$m.size}</p>\n`
const SCENARIO_VENUE = `(async () => {
  ${OUTILS}
  const el = await monter('co-venue')
  await pause(60)
  const R = [el.lire(), ecran(el), el.ecrire()]
  await pause(60)
  R.push(el.lire(), ecran(el))
  return { R, W: window.__W.filter((w) => w.includes('collections')).length }
})()`

describe('collection venue d\'ailleurs dans une appli bâtie sans la part des collections : un comportement défini, jamais une erreur', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    it(`${prod ? 'production' : 'développement'} : la \`Map\` garde son enveloppe et redessine, la \`WeakMap\` reste sans enveloppe ; ${prod ? 'aucun avertissement' : 'dit une fois'}`, async () => {
      const { code } = await construire({ 'co-venue': VENUE }, { prod })
      const r        = await jouer(code, PAGE_VENUE, SCENARIO_VENUE)
      // `$w.has($rows[0])` : sans enveloppe, la `WeakMap` cherche l'enveloppe de la ligne et ne trouve pas l'entrée rangée sous l'objet brut
      assert.deepEqual(r.R, ['2/true/1/3/false', '1', 'ok', '2/true/2/5/false', '2'])
      assert.equal(r.W, prod ? 0 : 1)
    })

    it(`${prod ? 'production' : 'développement'}, part demandée par \`runtime\` : la \`WeakMap\` retrouve l'entrée par l'enveloppe, aucun avertissement`, async () => {
      const { code } = await construire({ 'co-venue': VENUE }, { prod, runtime: ['collections'] })
      const r        = await jouer(code, PAGE_VENUE, SCENARIO_VENUE)
      assert.deepEqual(r.R, ['2/true/1/3/true', '1', 'ok', '2/true/2/5/true', '2'])
      assert.equal(r.W, 0)
    })
  }

  it('développement, `Map` nommée mais ni `WeakMap` ni `WeakSet` : la `WeakMap` venue d\'ailleurs reste sans enveloppe, dit une fois', async () => {
    const { code } = await construire({ 'co-venue': VENUE.replace('$rows = [r0]\n', '$rows = [r0]\n$autre = new Map()\n') })
    const r        = await jouer(code, PAGE_VENUE, SCENARIO_VENUE)
    assert.deepEqual(r.R, ['2/true/1/3/false', '1', 'ok', '2/true/2/5/false', '2'])
    assert.equal(r.W, 1)
  })
})

// objets de la page qui refusent, ou comptent, toute lecture d'une clé inconnue
const PAGE_RAW     = `window.__lus = [];
window.__strict = new Proxy({ a: 1 }, { get(t, k) { if (typeof k === 'symbol') throw new Error('symbole lu'); return t[k] } });
window.__espion = new Proxy({ a: 1 }, { get(t, k) { window.__lus.push(typeof k === 'symbol' ? 'symbole' : String(k)); return t[k] } });`
const RAW          = (plus: string, vraie: string) => `<script>\n$x = null\n${plus}${T}@ranger = ->\n  f = ->\n    $x = µraw(window.__strict)\n    'ok'\n  t(f)\n@relire = -> [t(-> typeof $x), t(-> $x.a), t(-> $x is window.__strict)].join('|')\n@espion = ->\n  window.__lus.length = 0\n  µraw(window.__espion)\n  window.__lus.join(',')\n@vraie = -> ${vraie}\n</script>\n<p class="v">{if $x}{$x.a}{end}</p>\n`
const SCENARIO_RAW = `(async () => {
  ${OUTILS}
  const el = await monter('co-raw')
  const R = [el.ranger()]
  await pause(60)
  R.push(el.relire(), ecran(el), el.espion(), el.vraie())
  return R
})()`

describe('µraw ne lit rien sur l\'objet reçu : un Proxy de la page qui refuse toute lecture se range, se relit, s\'affiche', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [mode, prod, proxy] of MODES) {
    it(`${mode} : avec la part des collections faibles (\`µraw($vus)\` rend la vraie collection), puis sans elle`, async () => {
      const avec = await construire({ 'co-raw': RAW('wm = new WeakMap()\n$vus = wm\n', 'String(µraw($vus) is wm)') }, { prod, proxy })
      assert.deepEqual(await jouer(avec.code, PAGE_RAW, SCENARIO_RAW), ['ok', 'object|1|true', '1', '', 'true'])
      const sans = await construire({ 'co-raw': RAW('', '\'-\'') }, { prod, proxy })
      assert.deepEqual(await jouer(sans.code, PAGE_RAW, SCENARIO_RAW), ['ok', 'object|1|true', '1', '', '-'])
    })
  }
})

// `Set` qui tient les lignes sous leur enveloppe ; un `has` raté fait son index ; puis il est vidé hors de MJS (sur la collection gardée
// sans `$`, sans `µrefresh`) et la liste est remplacée : une ligne, suivie par une référence faible, est-elle encore en vie ?
const PAGE_INDEX     = `window.__lignes = () => window.__liste = Array.from({ length: 10000 }, (_, i) => ({ i }));`
const INDEX          = `<script>\n$rows = window.__lignes()\ns0 = new Set()\n$s = s0\n@monter = ->\n  s0 = new Set($rows)\n  $s = s0\n@rater = -> String($s.has({i: -1}))\n@vider = -> s0.clear()\n@remplacer = -> $rows = []\n</script>\n<p class="v">{$s.size}</p>\n`
const SCENARIO_INDEX = `(async () => {
  ${OUTILS}
  const el = await monter('co-index')
  el.monter(); await pause()
  const rate = el.rater()
  el.vider(); await pause()
  let wr = new WeakRef(window.__liste[5])
  window.__liste = null
  el.remplacer(); await pause(60)
  window.__gc(); await pause(); window.__gc(); await pause()
  return { rate, retenue: String(wr.deref() !== undefined) }
})()`

describe('index des clés d\'une collection de l\'état : rien n\'y reste retenu après un `clear` fait hors de MJS (ramasse-miettes forcé)', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })
  setFlagsFromString('--expose_gc')
  const gc = runInNewContext('gc')

  for (const prod of [false, true]) {
    it(`enveloppe, ${prod ? 'production' : 'développement'} : la liste remplacée ne reste pas en mémoire`, async () => {
      const { code } = await construire({ 'co-index': INDEX }, { prod })
      assert.deepEqual(await jouer(code, PAGE_INDEX, SCENARIO_INDEX, gc), { rate: 'false', retenue: 'false' })
    })
  }
})
