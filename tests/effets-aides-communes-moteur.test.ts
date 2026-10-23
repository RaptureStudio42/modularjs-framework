// les aides communes des effets, écrites une seule fois au lieu d'une copie par effet qui finissait par dériver : la règle des
// ancêtres qui retiennent les balises fixes (*cursors, *longshadow), dans le moteur (mjs_fx.ts), dont le rognage s'en sert ; le
// moteur WebKit et la couleur lue sur la balise elle-même (*blend, *filter), la reprise à la fin d'un chargement de police (*weight,
// *delta, *annotate), le libellé d'un effet dans la langue de la page (*guard, *offline, *loader), dans un outil partagé chacune
// (mjs_fx_tool<nom>.ts), qui ne part qu'avec un effet qui s'en sert. Chaque effet appelle l'aide, aucun n'en garde de copie ;
// l'aide garde le comportement des copies.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '../src/runtime')
const lire    = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')

// le moteur et les outils des aides, comme un build qui les embarque
function moteur() {
  const window: any = new Window({ url: 'http://localhost/' })
  const µ: any = { warn: () => {}, error: () => {}, _mjs_msg: (_c: string, _v: unknown, t: string) => t }
  const textes = ['mjs_fx.ts', ...new Set(AIDES.map(([, f]) => f).filter((f) => f !== 'mjs_fx.ts'))].map(lire).join('\n')
  window.eval(`globalThis.__charge = function(µ) {\n${textes}\n}`)
  window.__charge(µ)
  return { window, µ }
}

// [aide, fichier qui la définit, effets qui l'appellent, ce que chaque copie écrivait]
const AIDES: Array<[string, string, string[], RegExp]> = [
  ['_mjs_fxHoldsFixed', 'mjs_fx.ts', ['mjs_fx_cursors.ts', 'mjs_fx_longshadow.ts'], /\(cs\.offsetPath \|\| 'none'\) !== 'none'/],
  ['_mjs_fxWebkit', 'mjs_fx_toolwebkit.ts', ['mjs_fx_blend.ts', 'mjs_fx_filter.ts'], /\/Apple\/\.test\(navigator\.vendor/],
  ['_mjs_fxColorOn', 'mjs_fx_toolcolor.ts', ['mjs_fx_blend.ts', 'mjs_fx_filter.ts'], /setProperty\('caret-color'/],
  ['_mjs_fxOnFonts', 'mjs_fx_toolfonts.ts', ['mjs_fx_weight.ts', 'mjs_fx_delta.ts', 'mjs_fx_annotate.ts'], /addEventListener\('loadingdone'/],
  ['_mjs_fxLabel', 'mjs_fx_toollabel.ts', ['mjs_fx_guard.ts', 'mjs_fx_offline.ts', 'mjs_fx_loader.ts'], /µ\._mjs_label\('fx', k\)/]
]

describe('effets — aides communes des effets, sans copie dans les effets', () => {
  for (const [aide, ou, fichiers, copie] of AIDES) {
    it(`µ.${aide} : défini par ${ou}, appelé par ${fichiers.join(', ')}, qui n'en gardent aucune copie`, () => {
      const m = lire(ou)
      assert.ok(new RegExp('µ\\.' + aide + ' = ').test(m), aide + ' absent de ' + ou)
      assert.ok(copie.test(m), ou + ' porte la règle')
      for (const f of fichiers) {
        const src = lire(f)
        assert.ok(new RegExp('µ\\.' + aide + '(?![\\w$])').test(src), f + ' n\'appelle pas ' + aide)
        assert.ok(!copie.test(src), f + ' garde une copie')
      }
    })
  }

  it('la règle des balises fixes : transformation, filtre, confinement, will-change — pas container-type', () => {
    const { µ } = moteur()
    const h = µ._mjs_fxHoldsFixed
    assert.equal(h({}), false)
    assert.equal(h({ transform: 'none', filter: 'none', containerType: 'inline-size' }), false)
    assert.equal(h({ filter: 'blur(2px)' }), true)
    assert.equal(h({ translate: '10px' }), true)
    assert.equal(h({ contain: 'paint' }), true)
    assert.equal(h({ willChange: 'transform' }), true)
    assert.equal(h({ willChange: 'offset-rotate' }), false)
    assert.equal(typeof µ._mjs_fxWebkit, 'boolean')
  })

  it('le libellé d\'un effet : celui du projet d\'abord, sinon celui de la langue de la page, sinon le français', () => {
    const { µ } = moteur()
    µ._runtimeLabels     = { fr: { fx: { range: 'de {a} à {b}' } }, en: { fx: { range: 'from {a} to {b}' } } }
    µ._runtimeLabelsLang = 'en'
    assert.equal(µ._mjs_fxLabel('range'), 'from {a} to {b}')
    µ._runtimeLabelsLang = 'de'
    assert.equal(µ._mjs_fxLabel('range'), 'de {a} à {b}')
    µ._mjs_label = (_s: string, k: string) => k === 'range' ? 'entre {a} et {b}' : void 0
    assert.equal(µ._mjs_fxLabel('range'), 'entre {a} et {b}')
    assert.equal(µ._mjs_fxLabel('atLeast'), undefined)
  })

  it('la reprise des polices : une fois à la fin de chaque chargement (le jumeau ignoré), même sans `loadingdone` (WebKit) ; rien après le retrait', async () => {
    const { window, µ } = moteur()
    const ecoutes: Record<string, Array<() => void>> = {}
    let fin: () => void = () => {}
    const fonts: any = {
      status: 'loaded',
      ready: Promise.resolve(),
      addEventListener: (t: string, f: () => void) => { (ecoutes[t] ??= []).push(f) },
      removeEventListener: (t: string, f: () => void) => { ecoutes[t] = (ecoutes[t] ?? []).filter((g) => g !== f) }
    }
    Object.defineProperty(window.document, 'fonts', { value: fonts, configurable: true })
    const emettre = (t: string) => { for (const f of ecoutes[t] ?? []) f() }
    const charger = () => { fonts.ready = new Promise<void>((r) => { fin = r }); emettre('loading') }
    let n = 0
    const off = µ._mjs_fxOnFonts(() => { n++ })
    const tour = () => new Promise((r) => setTimeout(r, 0))
    // Chromium : `loadingdone`, puis `ready` (son jumeau)
    charger()
    emettre('loadingdone')
    fin()
    await tour()
    assert.equal(n, 1)
    // Firefox : `ready`, puis `loadingdone`
    charger()
    fin()
    await tour()
    emettre('loadingdone')
    assert.equal(n, 2)
    // WebKit : `loading`, puis `ready` seul
    charger()
    fin()
    await tour()
    assert.equal(n, 3)
    off()
    charger()
    emettre('loadingdone')
    fin()
    await tour()
    assert.equal(n, 3)
    assert.deepEqual([ecoutes.loading.length, ecoutes.loadingdone.length], [0, 0])
  })

  it('une police déjà en route à la pose : sa fin est entendue', async () => {
    const { window, µ } = moteur()
    let fin: () => void = () => {}
    const fonts: any = { status: 'loading', ready: new Promise<void>((r) => { fin = r }), addEventListener: () => {}, removeEventListener: () => {} }
    Object.defineProperty(window.document, 'fonts', { value: fonts, configurable: true })
    let n = 0
    µ._mjs_fxOnFonts(() => { n++ })
    fin()
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(n, 1)
  })

  it('la couleur lue sur la balise : son style en ligne (caret-color, transition) rendu tel quel', () => {
    const { window, µ } = moteur()
    const el = window.document.body.appendChild(window.document.createElement('div'))
    el.style.setProperty('caret-color', 'blue')
    el.style.setProperty('transition-duration', '2s')
    const c = µ._mjs_fxColorOn(el, 'red')
    assert.equal(typeof c, 'string')
    assert.ok(c !== '')
    assert.equal(el.style.getPropertyValue('caret-color'), 'blue')
    assert.equal(el.style.getPropertyValue('transition-duration'), '2s')
    assert.equal(el.style.getPropertyValue('transition-property'), '')
  })
})
