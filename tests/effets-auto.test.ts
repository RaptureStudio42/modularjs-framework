// Effets que MJS pose de lui-même : le thème en cercle (une bascule `µtheme` qui suit un clic se
// propage en cercle depuis le point cliqué, par une transition de vue ; d'un coup sans geste
// récent ou avec `"effects": { "theme": "none" }`), les effets économes (sur un appareil qui peine,
// les effets lourds passent au tiers de leurs particules et leurs fonds animés s'arrêtent) et la
// clé `effects` de mjs.config.json qui les règle. happy-dom n'a pas de transition de vue : elle est
// simulée, l'animation du cercle est lue dans l'appel à `animate`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-theme': '<button class="nuit" @click={µtheme = \'dark\'}>🌙</button>\n<button class="jour" @click={µtheme = \'light\'}>☀</button>',
  'fx-lourd': '<div class="neige" *particles(snow, count: 30)></div>\n<div class="bruit" *noise></div>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// un projet compilé, chargé dans une fenêtre neuve ; `conf` : la clé effects du manifeste
async function charger(etiquette: string, opts: Record<string, unknown> = {}) {
  const root   = mjsTmp('effets-auto-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const manifeste = readFileSync(join(root, 'bundle.js'), 'utf-8')
  const conf      = /µ\._fxConf = ([^;]+);/.exec(manifeste)
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;${conf ? ` µ._fxConf = ${conf[1]};` : ''}`)
  return { window, manifeste }
}

async function monter(window: any, tag: string, sel: string) {
  window.document.body.innerHTML = `<${tag}></${tag}>`
  const comp = window.document.querySelector(tag)
  await attendre(() => !!comp._shadow?.querySelector(sel))
  await new Promise((r) => setTimeout(r, 20))
  return comp._shadow.querySelector(sel)
}

// une transition de vue simulée : le changement tout de suite, ready et finished tenus ; les
// animations posées sur <html> relevées
function transitionDeVue(window: any) {
  const vues: any[] = []
  const animations: any[] = []
  window.document.startViewTransition = (maj: () => void) => {
    const html = window.document.documentElement
    vues.push({ pendant: html.hasAttribute('mjs-theme-circle') })
    maj()
    return { ready: Promise.resolve(), finished: Promise.resolve() }
  }
  window.document.documentElement.animate = (images: any, opts: any) => { animations.push({ images, opts }); return {} }
  return { vues, animations }
}

const clic = (window: any, el: any, x: number, y: number) => {
  el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, composed: true, clientX: x, clientY: y }))
  el.click()
}

describe('effets que MJS pose de lui-même', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('thème en cercle', function () {
    let window: any
    before(async () => { ({ window } = await charger('theme')) })
    after(() => window?.close?.())

    it('un clic qui change le thème : transition de vue, le nouveau thème s\'ouvre en cercle depuis le point cliqué', async () => {
      const nuit = await monter(window, 'mjs-fx-theme', '.nuit')
      window.innerWidth  = 1000
      window.innerHeight = 600
      const { vues, animations } = transitionDeVue(window)
      clic(window, nuit, 100, 50)
      await attendre(() => animations.length > 0)
      assert.equal(window.document.documentElement.dataset.mjsTheme, 'dark')
      assert.equal(vues.length, 1)
      assert.ok(vues[0].pendant, 'l\'attribut mjs-theme-circle est posé le temps du cercle')
      const [de, vers] = animations[0].images.clipPath
      assert.equal(de, 'circle(0px at 100px 50px)')
      // le coin le plus loin : (1000, 600) depuis (100, 50)
      assert.equal(vers, `circle(${Math.ceil(Math.hypot(900, 550))}px at 100px 50px)`)
      assert.equal(animations[0].opts.pseudoElement, '::view-transition-new(root)')
      await attendre(() => !window.document.documentElement.hasAttribute('mjs-theme-circle'))
      assert.equal(window.document.documentElement.hasAttribute('mjs-theme-circle'), false, 'retiré à la fin')
    })

    it('sans geste récent (le code, le système) : d\'un coup', async () => {
      const jour = await monter(window, 'mjs-fx-theme', '.jour')
      const { vues } = transitionDeVue(window)
      jour.click()
      await attendre(() => window.document.documentElement.dataset.mjsTheme === 'light')
      assert.equal(window.document.documentElement.dataset.mjsTheme, 'light')
      assert.equal(vues.length, 0)
    })
  })

  describe('"effects": { "theme": "none" }', function () {
    let window: any
    let manifeste = ''
    before(async () => { ({ window, manifeste } = await charger('theme-none', { effects: { theme: 'none' } })) })
    after(() => window?.close?.())

    it('le manifeste porte le réglage ; la bascule se fait d\'un coup, même après un clic', async () => {
      assert.match(manifeste, /µ\._fxConf = \{"theme":"none"\};/)
      const nuit = await monter(window, 'mjs-fx-theme', '.nuit')
      const { vues } = transitionDeVue(window)
      clic(window, nuit, 10, 10)
      await attendre(() => window.document.documentElement.dataset.mjsTheme === 'dark')
      assert.equal(window.document.documentElement.dataset.mjsTheme, 'dark')
      assert.equal(vues.length, 0)
    })
  })

  describe('effets économes', function () {
    let window: any
    before(async () => { ({ window } = await charger('lite')) })
    after(() => window?.close?.())

    it('économe : les particules passent au tiers (l\'effet repart), les fonds animés s\'arrêtent', async () => {
      const neige = await monter(window, 'mjs-fx-lourd', '.neige')
      const flocons = () => neige.querySelectorAll('[mjs-fx-layer="particles"] i').length
      assert.equal(flocons(), 30)
      assert.equal(window.µ._mjs_fxLite, false)
      window.µ._mjs_fxGoLite()
      assert.equal(flocons(), 10)
      const html = window.document.documentElement
      assert.ok(html.hasAttribute('mjs-fx-lite'))
      assert.equal(html.style.getPropertyValue('--mjs-fx-lite-play'), 'paused')
      assert.match(window.µ._mjs_fxDefs.noise.css, /animation-play-state:var\(--mjs-fx-lite-play,running\)/)
      assert.equal(window.µ._mjs_fxCount(40), 14)
    })
  })

  describe('"effects": { "lite": "on" }', function () {
    let window: any
    before(async () => { ({ window } = await charger('lite-on', { effects: { lite: 'on' } })) })
    after(() => window?.close?.())

    it('économe d\'emblée : le premier effet lourd compte déjà ses particules au tiers', async () => {
      const neige = await monter(window, 'mjs-fx-lourd', '.neige')
      assert.equal(neige.querySelectorAll('[mjs-fx-layer="particles"] i').length, 10)
      assert.equal(window.µ._mjs_fxLite, true)
    })
  })

  describe('la clé effects de mjs.config.json', function () {
    const projet = (etiquette: string, effects: unknown) => {
      const root = mjsTmp('effets-auto-config-' + etiquette)
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', effects }))
      return root
    }

    it('recopiée jusqu\'au bundler', () => {
      const trouve = findConfig(projet('ok', { theme: 'none', lite: 'off' }))!
      assert.deepEqual(resolveBundlerOpts(trouve.config, trouve.configDir).effects, { theme: 'none', lite: 'off' })
    })

    it('skeleton : la liste des chargements qui montrent un squelette d\'eux-mêmes (await, components)', () => {
      const trouve = findConfig(projet('squelette', { skeleton: ['await', 'components'] }))!
      assert.deepEqual(resolveBundlerOpts(trouve.config, trouve.configDir).effects, { skeleton: ['await', 'components'] })
      assert.throws(() => findConfig(projet('squelette-faux', { skeleton: ['await', 'images'] })), /"effects\.skeleton" : « images » — permis : "await", "components"/)
      assert.throws(() => findConfig(projet('squelette-mot', { skeleton: 'await' })), /"effects\.skeleton" est une liste/)
    })

    it('une clé ou une valeur inconnue : le build refuse, en disant ce qui est permis', () => {
      assert.throws(() => findConfig(projet('cle', { cercle: true })), /"effects" : clé « cercle » inconnue — clés permises : theme, lite, skeleton, guard, rate\./)
      assert.throws(() => findConfig(projet('valeur', { lite: 'yes' })), /"effects\.lite" vaut "auto", "on", "off" — reçu "yes"/)
      assert.throws(() => findConfig(projet('objet', 'circle')), /"effects" est un objet/)
    })
  })
})
