// *fluid sans WebGL (happy-dom : pas de contexte graphique) : l'effet ne pose rien, ne casse rien et
// prévient une seule fois, au vouvoiement, dans la langue de la page. Les règles de ses réglages sont
// celles du catalogue : plages, mots permis, liste de couleurs en réglage principal. La balise garde
// son texte, son contenu et sa mise en page : un visiteur sans WebGL voit la page sans l'effet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*fluid — le catalogue', () => {
  it('une entrée de la famille des fonds, qui dessine dans la balise, réglage principal : les couleurs', () => {
    assert.equal(EFFECTS.fluid.family, 'background')
    assert.equal(EFFECTS.fluid.inside, true)
    assert.equal(EFFECTS.fluid.main, 'colors')
    assert.deepEqual(Object.keys(EFFECTS.fluid.settings).sort(), ['auto', 'background', 'colors', 'curl', 'detail', 'fade', 'friction', 'glow', 'on', 'quality', 'rays', 'resolution', 'size', 'strength', 'where'])
  })

  it('les valeurs par défaut sont les valeurs de référence visées (taches larges, encre qui s\'efface vite, curl à 4), plus la résolution à 1,5', () => {
    const d = (k: string) => EFFECTS.fluid.settings[k].dflt
    assert.deepEqual([d('size'), d('strength'), d('fade'), d('friction'), d('curl'), d('glow'), d('rays'), d('detail'), d('quality'), d('resolution')], [0.5, 1000, 2, 1, 4, 0.5, 0.6, 32, 512, 1.5])
    assert.deepEqual([d('where'), d('auto'), d('on')], ['box', false, 'hover'])
    assert.equal(d('background'), undefined, 'background n\'a pas de défaut : sans lui, la toile est transparente et laisse voir le fond de la balise')
  })

  it('resolution (0,5 à 4) : les bornes sont vérifiées à la compilation', () => {
    assert.deepEqual(parseEffect('fluid', 'resolution: 2').fixed, { resolution: 2 })
    assert.throws(() => parseEffect('fluid', 'resolution: 0.4'), /resolution = 0.4/)
    assert.throws(() => parseEffect('fluid', 'resolution: 5'), /resolution = 5/)
  })

  it('veil n\'existe plus : la toile est transparente sans réglage, et veil est refusé comme tout réglage inconnu, par l\'erreur ordinaire du catalogue', () => {
    assert.ok(!('veil' in EFFECTS.fluid.settings), 'veil est encore au catalogue')
    assert.throws(() => parseEffect('fluid', 'veil: 0.5'), /\*fluid : réglage « veil » inconnu — réglages de \*fluid : colors, where, auto, size, strength, fade, friction, curl, glow, rays, detail, quality, resolution, background, on\./)
    assert.throws(() => parseEffect('fluid', 'veil: 0'), /réglage « veil » inconnu/)
    assert.throws(() => parseEffect('fluid', 'glow: 0, veil: 1'), /réglage « veil » inconnu/)
  })

  it('la liste de couleurs s\'écrit seule ; chaque réglage est vérifié à la compilation', () => {
    assert.deepEqual(parseEffect('fluid', '[#ff3d81, #3dc8ff]').fixed, { colors: ['#ff3d81', '#3dc8ff'] })
    assert.deepEqual(parseEffect('fluid', 'where: text, auto: true, on: click').fixed, { where: 'text', auto: true, on: 'click' })
    assert.deepEqual(parseEffect('fluid', 'background: transparent, glow: 0, rays: 0').fixed, { background: 'transparent', glow: 0, rays: 0 })
    assert.throws(() => parseEffect('fluid', 'where: both'), /where = both/)
    assert.throws(() => parseEffect('fluid', 'on: always'), /on = always/)
    assert.throws(() => parseEffect('fluid', 'size: 3'), /size = 3/)
    assert.throws(() => parseEffect('fluid', 'detail: 8'), /detail = 8/)
    assert.throws(() => parseEffect('fluid', 'quality: 4096'), /quality = 4096/)
    assert.throws(() => parseEffect('fluid', 'fade: -1'), /fade = -1/)
  })
})

describe('*fluid — sans WebGL, rien n\'est posé', function () {
  this.timeout(90000)
  let window: any
  const avertissements: string[] = []
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('effets-fluid')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fl-page.mjs'), '<div class="un" *fluid>Bonjour</div>\n<h1 class="deux" *fluid(where: text, auto: true)>Titre</h1>\n<p class="trois" *fluid(on: click)>Texte</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    fenetres.push(window)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.µ._runtimeLabels = RUNTIME_LABELS
    window.µ._runtimeLabelsLang = 'fr'
    window.µ.warn = (...a: any[]) => { avertissements.push(a.map(String).join(' ')) }
    window.document.body.innerHTML = '<mjs-fl-page></mjs-fl-page>'
    const comp = window.document.querySelector('mjs-fl-page')
    await attendre(() => !!comp._shadow?.querySelector('.trois'))
    await new Promise((r) => setTimeout(r, 60))
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  it('aucune toile, aucun texte rendu transparent, le contenu de la balise intact', () => {
    const racine = window.document.querySelector('mjs-fl-page')._shadow
    for (const classe of ['un', 'deux', 'trois']) {
      const el = racine.querySelector('.' + classe)
      assert.ok(el, classe)
      assertAbsent(el.querySelector('[mjs-fx-layer]'), `${classe} : une toile est posée`)
      assert.ok(!el.hasAttribute('mjs-fx-fluid-text'), `${classe} : le texte est devenu transparent`)
    }
    assert.equal(racine.querySelector('.un').textContent, 'Bonjour')
    assert.equal(racine.querySelector('.deux').textContent, 'Titre')
  })

  it('un avertissement, une seule fois pour la page, au vouvoiement et sans mot anglais', () => {
    const siens = avertissements.filter((m) => m.includes('*fluid'))
    assert.equal(siens.length, 1, siens.join('\n'))
    assert.match(siens[0], /^\[ModularJS\] \*fluid : ce navigateur ne sait pas faire tourner le fluide/)
    assert.doesNotMatch(siens[0], /\b(tu|ton|tes|toi)\b/i)
  })

  it('les messages existent dans les deux langues, avec le même texte de secours dans le code', () => {
    assert.match(RUNTIME_LABELS.fr.err.fluidNoGl, /WebGL avec textures demi-flottantes requis/)
    assert.match(RUNTIME_LABELS.en.err.fluidNoGl, /WebGL with half-float textures required/)
    const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/runtime/mjs_fx_fluid.ts'), 'utf-8')
    assert.ok(code.includes(`'${RUNTIME_LABELS.fr.err.fluidNoGl.replace(/'/g, '\\\'')}'`), 'texte de secours différent de la table française')
    const fr = RUNTIME_LABELS.fr.err as Record<string, string>
    const en = RUNTIME_LABELS.en.err as Record<string, string>
    for (const cle of ['fluidTextComponent', 'fluidColor', 'fluidNoContext']) {
      assert.ok(fr[cle] && en[cle], `${cle} : absent d'une des deux langues`)
      assert.ok(code.includes(`'${fr[cle].replace(/'/g, '\\\'')}'`), `${cle} : texte de secours différent de la table française`)
      assert.doesNotMatch(fr[cle], /\b(tu|ton|tes|toi)\b/i)
    }
    assert.match(fr.fluidColor, /\{color\}/)
    assert.match(en.fluidColor, /\{color\}/)
  })

  it('l\'effet se retire sans rien laisser, même s\'il n\'a rien posé', () => {
    const comp = window.document.querySelector('mjs-fl-page')
    const el = comp._shadow.querySelector('.un')
    const off = el._mjs_fxOff?.fluid
    assert.ok(off, 'le retrait est inscrit')
    off()
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.equal(el._mjs_fxOff ?? null, null)
  })
})

describe('*fluid — background : toute couleur CSS s\'écrit en clair et arrive entière dans la pose', function () {
  this.timeout(90000)
  // une couleur à barre oblique (`hsl(210 50% 20% / .4)`) s'écrit telle quelle, comme les autres ; entre guillemets elle passe aussi
  const FORMES = ['rgb(200, 30, 30)', 'rgba(0, 0, 0, .5)', 'rgb(0 0 0 / 50%)', 'hsl(210, 50%, 20%)', 'hsla(210, 50%, 20%, .4)', 'hsl(210 50% 20% / .4)', '\'hsl(210 50% 20% / .4)\'', '#00000080', '#0008', 'rebeccapurple', 'transparent', 'var(--teinte)', 'pas-une-couleur']
  let code = ''
  let stats: any

  before(async () => {
    const root   = mjsTmp('effets-fluid-fond')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fl-formes.mjs'), `<script>\n$fond = ''\n</script>\n${FORMES.map((f, i) => `<div class="b${i}" *fluid(background: ${f})>x</div>\n`).join('')}<div class="dyn" *fluid(background: $fond)>x</div>\n`)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    stats = await bundler.compile()
    await bundler.close()
    code = readdirSync(outDir).filter((f) => f.endsWith('.js') && !f.startsWith('mjs_')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('chaque écriture passe à la construction sans erreur ni avertissement', () => {
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    assert.deepEqual((stats.warnings || []).map((w: any) => w.message ?? String(w)), [])
  })

  it('et arrive entière dans la pose, telle qu\'elle est écrite', () => {
    for (const f of FORMES) {
      const ecrit = f.replace(/^'|'$/g, '')
      assert.ok(code.includes(`"fluid", {"background":${JSON.stringify(ecrit)}}`), `${f} : absente de la pose`)
    }
  })

  it('liée à une variable : la pose suit la variable, la règle du catalogue est « une couleur CSS »', () => {
    assert.ok(code.includes('{"background": ($.fond)}'), 'la pose ne suit pas la variable')
    assert.ok(code.includes('{"background":["c","une couleur CSS"]}'), 'la règle du catalogue est absente de la pose')
  })

  it('le catalogue garde l\'écriture telle quelle ; un texte qui n\'est pas une couleur passe aussi à la construction (il prévient à l\'exécution, au développement)', () => {
    assert.deepEqual(parseEffect('fluid', 'background: rgba(0, 0, 0, .5)').fixed, { background: 'rgba(0, 0, 0, .5)' })
    assert.deepEqual(parseEffect('fluid', 'background: rgb(0 0 0 / 50%)').fixed, { background: 'rgb(0 0 0 / 50%)' })
    assert.deepEqual(parseEffect('fluid', 'background: #00000080').fixed, { background: '#00000080' })
    assert.deepEqual(parseEffect('fluid', 'background: hsla(210, 50%, 20%, .4)').fixed, { background: 'hsla(210, 50%, 20%, .4)' })
    assert.deepEqual(parseEffect('fluid', 'background: var(--teinte)').fixed, { background: 'var(--teinte)' })
    assert.deepEqual(parseEffect('fluid', 'background: pas-une-couleur').fixed, { background: 'pas-une-couleur' })
  })
})
