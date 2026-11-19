// `visible: 60%` : la part de la balise qui doit être à l'écran pour que `on: view` se déclenche, de 1 % à 100 %, sur tout effet et
// toute transition dont `on` connaît view (le catalogue le déclare). Ici, la construction : ce qu'elle accepte, ce qu'elle refuse
// (valeur hors bornes, sans %, tenue par une variable, sans on: view, après @in, dans un effet donné en réglage), en français et en
// anglais, avec le fichier et la ligne ; le signal qui fait entrer le code de `visible` au cœur, et le cœur d'une appli qui ne
// l'écrit pas, rendu tel qu'avant. Le seuil lui-même, en vrais navigateurs : effets-visible-part-browser.test.ts

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EFFECTS, parseEffect, checkPlacement, checkLife, devCatalog } from '../src/effects/catalog.js'
import { setMessagesLang } from '../src/messages/index.js'
import * as features from '../src/bundler/features.js'
import { Bundler, projectBlocks, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const RUNTIME = new URL('../src/runtime/', import.meta.url)

// la faute d'une pose directe : lecture des réglages, puis la balise (comme le générateur)
function erreur(nom: string, raw: string): string {
  try {
    const r = parseEffect(nom, raw)
    checkPlacement(r.base ?? nom, r, 'div', false, nom)
  }
  catch (e) {
    return (e as Error).message
  }
  return ''
}

describe('visible : la part de on: view réglable (construction)', function () {
  this.timeout(60000)

  afterEach(() => setMessagesLang('fr'))
  after(async () => { await terminateSharedWorkerPool() })

  it('déclaré partout où on connaît view, et seulement là', () => {
    for (const [nom, fx] of Object.entries(EFFECTS)) {
      const vue = /'view'/.test(fx.settings.on?.rule ?? '')
      assert.equal('visible' in fx.settings, vue, `*${nom}`)
    }
    for (const nom of ['fade', 'fly', 'ink', 'stagger', 'shine', 'attention', 'annotate', 'pulse', 'matrix', 'filter']) assert.ok('visible' in EFFECTS[nom].settings, `*${nom}`)
    for (const nom of ['fluid', 'parallax', 'focus']) assert.ok(!('visible' in EFFECTS[nom].settings), `*${nom}`)
  })

  it('accepté : la part en %, de 1 % à 100 %, sur une transition, un effet qui se joue, un effet qui boucle', () => {
    assert.equal(parseEffect('fly', 'up, on: view, visible: 60%').fixed.visible, 60)
    assert.equal(parseEffect('ink', 'on: view, duration: 1600ms, visible: 100%').fixed.visible, 100)
    assert.equal(parseEffect('stagger', 'visible: 1%').fixed.visible, 1)
    assert.equal(parseEffect('shine', 'on: view, visible: 12.5%').fixed.visible, 12.5)
    assert.equal(erreur('pulse', 'on: view, visible: 50%'), '')
    // le défaut de on est view : rien à écrire de plus
    assert.equal(erreur('stagger', 'visible: 100%'), '')
    assert.equal(erreur('fade', 'visible: 100%'), '')
  })

  it('sans visible, rien ne change : aucun réglage ajouté à la pose', () => {
    assert.deepEqual(parseEffect('fly', 'up, on: view').fixed, { direction: 'up', on: 'view' })
  })

  it('refusé : hors bornes, sans %, une autre unité — le message donne la forme permise', () => {
    for (const valeur of ['0%', '150%', '100', '0.5', '50px', '-10%', '100 %', 'all']) {
      const m = erreur('fade', `on: view, visible: ${valeur}`)
      assert.match(m, /\*fade : visible = /, valeur)
      assert.match(m, /de 1 % à 100 %/, valeur)
    }
  })

  it('refusé : tenu par une variable — la part s\'écrit en clair', () => {
    const m = erreur('fade', 'on: view, visible: $part')
    assert.match(m, /\*fade : visible = \$part/)
    assert.match(m, /en valeur fixe/)
  })

  it('refusé : sans on: view (écrit, ou par défaut), avec un message qui dit quoi écrire', () => {
    const m = erreur('shine', 'on: hover, visible: 50%')
    assert.match(m, /\*shine : visible ne sert qu'avec on: view/)
    assert.match(m, /ici, on vaut hover/)
    assert.match(m, /Écrivez on: view, ou retirez visible/)
    // le défaut de *shine est hover
    assert.match(erreur('shine', 'visible: 50%'), /ici, on vaut hover/)
    assert.match(erreur('fade', 'on: scroll, visible: 50%'), /ici, on vaut scroll/)
  })

  it('on tenu par une variable : accepté (il peut valoir view)', () => {
    assert.equal(erreur('fade', 'on: $quand, visible: 50%'), '')
  })

  it('refusé après @in, @out, @transition : la directive déclenche l\'effet', () => {
    const r = parseEffect('fade', 'visible: 50%')
    assert.throws(() => checkLife('fade', r, 'in', 'visible: 50%'), /« visible » n'a pas de sens ici/)
  })

  it('refusé dans un effet donné en réglage : il se joue une fois, sans attendre l\'écran', () => {
    const m = erreur('delta', 'fx: *fly(up, on: view, visible: 50%)')
    assert.match(m, /\*delta : fx = \*fly/)
    assert.match(m, /retirez visible/)
  })

  it('en anglais aussi, au vouvoiement en français', () => {
    setMessagesLang('en')
    assert.match(erreur('fade', 'on: view, visible: 150%'), /1% to 100% of the tag, as a fixed value/)
    assert.match(erreur('shine', 'on: hover, visible: 50%'), /\*shine: visible only works with on: view \(.*\); here, on is hover\. Write on: view, or remove visible\./)
    assert.match(erreur('delta', 'fx: *fly(up, visible: 50%)'), /remove visible/)
  })

  it('le panneau d\'inspection et l\'extension : une part de 1 à 100', () => {
    const [spec, dflt] = devCatalog(['fade']).fade.s.visible
    assert.deepEqual(spec.slice(0, 3), ['f', 1, 100])
    assert.equal(dflt, null)
  })

  it('la construction : le fichier et la ligne de la balise, et le signal du cœur', async () => {
    const root   = mjsTmp('effets-visible-part')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'part-faute.mjs'), '<p>texte</p>\n<p *fade(on: view, visible: 120%)>titre</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    const m = stats.errors.map((e: any) => `${e.file ?? ''} ${e.message}`).join('\n')
    assert.match(m, /part-faute\.mjs/)
    assert.match(m, /\*fade \(ligne 2\) : visible = 120%/)
  })

  it('le signal : une pose qui écrit visible le donne, une autre non', () => {
    assert.equal(typeof (features as any).VIEW_PART, 'string')
    assert.ok(features.scanCompiledFeatures('µ._mjs_fx(this, n, "fade", {"on":"view","visible":60});').has((features as any).VIEW_PART))
    assert.ok(!features.scanCompiledFeatures('µ._mjs_fx(this, n, "fade", {"on":"view"});').has((features as any).VIEW_PART))
  })

  it('le cœur d\'une appli qui n\'écrit pas visible : les déclencheurs d\'avant, rien de visible', () => {
    for (const f of ['mjs_fx.ts', 'mjs_fx_transition.ts']) {
      const src  = readFileSync(new URL(f, RUNTIME), 'utf-8')
      const sans = projectBlocks(src, { visible: false })
      assert.doesNotMatch(sans, /_mjsFxPart|_mjs_fxSight|_mjs_part|<\/?(?:sans-)?visible>/, f)
      assert.doesNotMatch(projectBlocks(src, { visible: true }), /<\/?(?:sans-)?visible>/, f)
    }
    const sans = projectBlocks(readFileSync(new URL('mjs_fx.ts', RUNTIME), 'utf-8'), { visible: false })
    assert.equal(sans.split('var io = new IntersectionObserver(function(entries) {').length - 1, 4)
    assert.match(sans, /return µ\._mjs_fxKeep \? µ\._mjs_fxKeep\(def, el, name, s, comp\) : def\.setup\(el, s, comp\);/)
  })
})
