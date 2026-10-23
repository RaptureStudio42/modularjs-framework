// mjs_devpanel — l'onglet « Effets » allume un réglage que la page n'écrit pas. Le build de développement envoie chaque fichier d'effet en
// entier : `soft` de *pointer, une carte de *hologram, le survol d'une transition, que la page ne cite nulle part, marchent donc comme s'ils
// étaient écrits. En production ces sections sont ôtées (le tri des pages) et le panneau n'y existe pas.
//
// Pipeline RÉEL (Bundler en développement → cœur + composants compilés, montés dans happy-dom), comme devpanel-effets.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  'dpnw-pointeur.mjs': '<div class="z" *pointer(lens, outside: true)><a class="a" href="#x" data-pointer="Voir">lien</a></div>',
  'dpnw-carte.mjs':    '<div class="h" *hologram(rainbow)>carte</div>',
  'dpnw-survol.mjs':   '<section class="w"><div class="f" *fade>texte</div></section>'
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('mjs_devpanel — l\'onglet Effets allume un réglage que la page n\'écrit pas', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('devpanel-effets-non-ecrits')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, source] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, f), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    // les animations des transitions, puis les fichiers des effets, importés par les composants qui les écrivent
    for (const f of files.filter((f) => /^mjs_anims-[0-9a-z]{5}\.js$/.test(f))) window.eval(lire(f))
    for (const f of files.filter((f) => /^mjs_fx_[a-z_]+-[0-9a-z]{5}\.js$/.test(f))) window.eval(lire(f))
    for (const nom of ['dpnw-pointeur', 'dpnw-carte', 'dpnw-survol']) {
      window.eval(lire(files.find((f) => new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`).test(f))!))
    }
  })

  afterEach(() => {
    if (window?.µ?.console) window.µ.console(false)
    if (window) window.document.body.innerHTML = ''
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const racine = () => window.document.querySelector('[data-mjs-devpanel]')?.shadowRoot
  const clic   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const onglet = (id: string) => clic(racine().querySelector(`.onglet[data-onglet="${id}"]`))
  const bloc   = (effet: string) => Array.from(racine().querySelectorAll('.detail .fx') as ArrayLike<any>).find((b: any) => b.querySelector('.fx-nom')?.textContent === '*' + effet)
  const champ  = (effet: string, cle: string) => bloc(effet)?.querySelector(`[data-cle="${cle}"]`)
  const regler = (el: any, valeur: string) => {
    el.value = valeur
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
  }

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow && !!comp._shadow.querySelector(sel))
    await new Promise((r) => setTimeout(r, 20))
    return comp
  }

  it('*pointer(lens, outside: true) sans soft : soft: 40 posé dans le panneau adoucit le bord du calque', async () => {
    const comp = await monter('mjs-dpnw-pointeur', '.z')
    const calque = () => window.document.body.querySelector('[mjs-fx-pointer-layer]')
    assert.equal(calque() !== null, true, 'le calque du pointeur est là')
    assert.equal(calque().hasAttribute('mjs-fx-pointer-soft'), false, 'le bord est franc tant que soft n\'est pas posé')
    window.µ.console('mjs-dpnw-pointeur')
    onglet('effets')
    assert.equal(champ('pointer', 'soft') !== undefined, true, 'le panneau propose le réglage soft')
    regler(champ('pointer', 'soft'), '40')
    assert.equal(calque().hasAttribute('mjs-fx-pointer-soft'), true, 'soft: 40 adoucit le bord')
    regler(champ('pointer', 'soft'), '0')
    assert.equal(calque().hasAttribute('mjs-fx-pointer-soft'), false, 'soft: 0 rend le bord franc')
    assert.equal(comp.isConnected, true)
  })

  it('*hologram(rainbow) : style: night-sky posé dans le panneau, le moteur de carte pose la carte (son ombre) et ôte le reflet simple', async () => {
    const comp = await monter('mjs-dpnw-carte', '.h')
    const el   = comp._shadow.querySelector('.h')
    assert.equal(window.µ._mjs_fxDefs.hologram.css.includes('[mjs-fx-hologram-style="night-sky"]'), true, 'la feuille de l\'effet porte déjà le style de carte')
    assert.equal(el.querySelector('[mjs-fx-layer="hologram"]') !== null, true, 'style simple : le calque du reflet est là')
    assert.equal(el.hasAttribute('mjs-fx-hologram-shadow'), false, 'aucune carte tant que la page n\'en écrit pas')
    window.µ.console('mjs-dpnw-carte')
    onglet('effets')
    regler(champ('hologram', 'style'), 'night-sky')
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(el.hasAttribute('mjs-fx-hologram-shadow'), true, 'la carte est posée par le moteur de carte')
    assert.equal(el.querySelector('[mjs-fx-layer="hologram"]') !== null, false, 'le reflet simple est retiré')
    regler(champ('hologram', 'style'), 'rainbow')
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(el.hasAttribute('mjs-fx-hologram-shadow'), false, 'revenu au style simple, plus de carte')
    assert.equal(el.querySelector('[mjs-fx-layer="hologram"]') !== null, true, 'le reflet simple revient')
  })

  it('*fade (on: view) : on: hover posé dans le panneau, la balise attend le survol', async () => {
    const comp = await monter('mjs-dpnw-survol', '.f')
    const el = comp._shadow.querySelector('.f')
    window.µ.console('mjs-dpnw-survol')
    onglet('effets')
    regler(champ('fade', 'on'), 'hover')
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(el.getAttribute('mjs-fx-hover'), 'rest', 'la balise est cachée jusqu\'au survol')
    regler(champ('fade', 'on'), 'view')
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(el.hasAttribute('mjs-fx-hover'), false, 'revenue à view, la balise n\'attend plus le survol')
  })
})
