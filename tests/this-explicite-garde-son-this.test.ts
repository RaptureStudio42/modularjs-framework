// Un `this` choisi à la main garde son `this` : `.call(x)`, `.bind(x)`, `new Fn()`, `forEach(fn, thisArg)`
// ne sont pas écrasés par le composant, même quand le <script> pose le même nom sur le composant
// (`@v = 'comp'`). Seul un `this` absent (appel nu : `undefined`, `null`) retombe sur le composant. Un
// `this` que pose le navigateur est celui de l'appelant comme un autre : un écouteur posé à la main reçoit
// l'élément, `setTimeout` la fenêtre — `@x` les lit, `@@x` lit le composant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { rebindDetachedThisMapped } from '../src/generator/this-rebinding.js'

const rebindDetachedThis = (js: string): string => rebindDetachedThisMapped(js).code
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// le <script> pose `v` et `ouvrir` sur le composant ; `dire`, `Pt`, `appeler`, `lireClasse` et `poser`
// sont des fonctions détachées (flèches fines à la racine) qui lisent ou écrivent ces noms
const SCRIPT = [
  'this.v = \'comp\'',
  'this.ouvrir = function() { return \'ouvert\' }',
  'let dire = function() { return this.v }',
  'let Pt = function(v) { this.v = v }',
  'let appeler = function() { return this.ouvrir() }',
  'let lireClasse = function() { return this.classList }',
  'let poser = function(x) {',
  '  this.v = x',
  '  this.w = x',
  '  return this.v + this.w',
  '}',
  'let poserDeux = function(x) {',
  '  this.v = x',
  '  this.ouvrir = x',
  '}',
].join('\n')

// exécute le script réécrit en mode strict (comme un module) avec `comp` pour composant, puis `corps`
function jouer(corps: string, autres: Record<string, unknown> = {}, comp: any = {}): any {
  const code = `'use strict'\n${rebindDetachedThis(SCRIPT)}\n${corps}`
  return new Function('_mjsThis', ...Object.keys(autres), code).apply(comp, [comp, ...Object.values(autres)])
}

describe('this choisi à la main — rebindDetachedThis', () => {
  it('.call(x) : lit x, pas le composant', () => {
    assert.equal(jouer('return dire.call(autre)', { autre: { v: 'autre' } }), 'autre')
  })

  it('.bind(x)() : lit x, pas le composant', () => {
    assert.equal(jouer('return dire.bind(autre)()', { autre: { v: 'lie' } }), 'lie')
  })

  it('new Fn() : écrit sur la nouvelle instance, pas sur le composant', () => {
    const comp: any = {}
    assert.deepEqual(jouer('const p = new Pt(\'inst\'); return [p.v, _mjsThis.v]', {}, comp), ['inst', 'comp'])
    assert.equal(comp.v, 'comp', 'le composant garde sa valeur')
  })

  it('forEach(fn, thisArg) : lit thisArg', () => {
    assert.equal(jouer('const vus = []; [1, 2].forEach(function() { vus.push(dire.call(this)) }, cible); return vus.join(\'\')', { cible: { v: 't' } }), 'tt')
    assert.equal(jouer('const vus = []; const pousse = function() { vus.push(this.v) }; [1, 2].forEach(pousse, cible); return vus.join(\'\')', { cible: { v: 'u' } }), 'uu')
  })

  it('une méthode du composant appelée avec un objet à soi : l\'objet, pas le composant', () => {
    const autre = { ouvrir: () => 'autre ouvre' }
    assert.equal(jouer('return appeler.call(autre)', { autre }), 'autre ouvre')
  })

  it('appel nu (this undefined) : le composant', () => {
    assert.equal(jouer('return dire()'), 'comp')
    assert.equal(jouer('return appeler()'), 'ouvert')
  })

  it('.call(null) et .call(undefined) : le composant', () => {
    assert.equal(jouer('return dire.call(null)'), 'comp')
    assert.equal(jouer('return dire.call(undefined)'), 'comp')
  })

  it('écouteur posé à la main : l\'élément est le this de l\'appelant, même pour un nom que le <script> pose', () => {
    const element = { addEventListener() {}, v: 'element' }
    assert.equal(jouer('return dire.call(element)', { element }), 'element')
    assert.throws(() => jouer('return appeler.call(element)', { element }), TypeError, '@ouvrir lit l\'élément, qui n\'a pas de méthode ouvrir : le composant s\'écrit @@ouvrir')
  })

  it('setTimeout : la fenêtre est le this de l\'appelant', () => {
    const fenetre = { addEventListener() {}, setTimeout() {}, v: 'fenetre' }
    assert.equal(jouer('return dire.call(fenetre)', { fenetre }), 'fenetre')
  })

  it('un nom que le <script> ne pose pas (@classList) : le this de l\'appelant', () => {
    const element = { addEventListener() {}, classList: 'celle de l\'element' }
    assert.equal(jouer('return lireClasse.call(element)', { element }, { classList: 'celle du composant' }), 'celle de l\'element')
    assert.equal(jouer('return lireClasse()', {}, { classList: 'celle du composant' }), 'celle du composant')
  })

  it('deux membres du composant posés à la suite : la 2e ligne ne se colle pas à la 1re', () => {
    const autre: any = {}
    jouer('poserDeux.call(autre, 5)', { autre })
    assert.deepEqual([autre.v, autre.ouvrir], [5, 5], 'les deux écritures atteignent l\'objet choisi')
    const comp: any = {}
    jouer('poserDeux(6)', {}, comp)
    assert.deepEqual([comp.v, comp.ouvrir], [6, 6], 'et le composant, en appel nu')
  })

  it('plusieurs lignes qui ouvrent par this : aucun appel fantôme entre elles, chacune au bon receveur', () => {
    const comp: any = {}
    assert.equal(jouer('return poser.call(autre, 3)', { autre: {} }, comp), 6)
    assert.equal(comp.v, 'comp', 'poser.call(autre) n\'écrit pas sur le composant')
    assert.equal(comp.w, undefined)
    assert.equal(jouer('return poser(4)'), 8)
  })
})

// bout en bout : un composant qui pose `v` sur lui-même et le lit par des fonctions détachées, compilé par le vrai Bundler et monté dans happy-dom
const SOURCE = [
  '<script>',
  '@v = "comp"',
  'Pt = (v) -> @v = v',
  'dire = -> @v',
  'lus = []',
  'pousser = -> lus.push(@v)',
  '$res = ""',
  '@run = ->',
  '  p = new Pt("inst")',
  '  autre = { v: "autre" }',
  '  [1].forEach(pousser, autre)',
  '  $res = [p.v, @v, dire.call(autre), dire.bind(autre)(), lus[0], dire()].join("|")',
  '</script>',
  '<button class="b" @click={@run()}>go</button><p class="r">{$res}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('this choisi à la main — composant monté', function () {
  this.timeout(60000)
  let window: any
  const erreurs: string[] = []

  before(async () => {
    const root   = mjsTmp('this-explicite')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'this-choisi.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.addEventListener('error', (e: any) => erreurs.push(String(e.error?.message ?? e.message)))
    window.console.error = (...a: unknown[]) => { erreurs.push(a.map(String).join(' ')) }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('new, call, bind, forEach(fn, thisArg) : chacun son this ; l\'appel nu : le composant', async () => {
    window.document.body.innerHTML = '<mjs-this-choisi></mjs-this-choisi>'
    const comp = window.document.querySelector('mjs-this-choisi')
    await attendre(() => !!comp._shadow?.querySelector('.b'))
    comp._shadow.querySelector('.b').dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }))
    await attendre(() => (comp._shadow.querySelector('.r')?.textContent ?? '') !== '')
    assert.equal(comp._shadow.querySelector('.r').textContent, 'inst|comp|autre|autre|autre|comp')
    assert.deepEqual(erreurs, [])
  })
})
