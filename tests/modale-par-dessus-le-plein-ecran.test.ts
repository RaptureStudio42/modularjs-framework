// µ.modal et le plein écran (API Fullscreen) : le navigateur n'affiche plus que l'élément plein écran et sa
// descendance. Une modale posée dans le corps du document restait donc invisible derrière lui. Ce test garantit
// qu'elle se pose DANS l'élément plein écran — y compris quand il vit dans l'ombre fermée d'un composant, où elle
// emporte sa feuille de style et où Tab continue de circuler entre ses boutons —, qu'elle garde le corps quand
// l'élément ne peut rien afficher (vidéo) ou contient déjà le corps (<html>), et qu'elle suit une entrée ou une
// sortie du plein écran survenue pendant qu'elle est ouverte : restée dans un élément que l'appli retire à la
// sortie, elle disparaissait sans jamais se fermer.
// happy-dom n'a pas l'API Fullscreen : `fullscreenElement` est simulé sur le document et sur l'ombre du
// composant (le document ne voit que l'hôte d'un élément qui vit dans une ombre), et `fullscreenchange` est
// déclenché à la main, comme le ferait le navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('µ.modal — visible par-dessus un élément en plein écran', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('modale-plein-ecran')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'scene.mjs'), '<div class="scene"><p>scène</p></div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<div id="plein"><p>plein</p></div><mjs-scene></mjs-scene><video id="film"></video>'
    await attendre(() => !!scene()._shadow?.querySelector('.scene'))
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  afterEach(() => {
    window.µ.modal.close()
    pleinEcran(null, null)
  })

  const scene = () => window.document.querySelector('mjs-scene')

  // `document.fullscreenElement` rend l'élément vu depuis le document (l'hôte, pour un élément d'une ombre),
  // `fullscreenElement` de l'ombre rend l'élément lui-même
  function pleinEcran(duDocument: any, delOmbre: any) {
    Object.defineProperty(window.document, 'fullscreenElement', { configurable: true, get: () => duDocument })
    Object.defineProperty(scene()._shadow, 'fullscreenElement', { configurable: true, get: () => delOmbre })
  }

  // où la modale est posée, en texte : jamais un nœud dans une assertion
  function lieu(): string {
    const d = window.document
    const b = d.querySelector('.mjs-modal-backdrop')
    if (b) return b.parentNode === d.body ? 'corps' : b.parentNode.id ? '#' + b.parentNode.id : b.parentNode.nodeName.toLowerCase()
    const r = scene()._shadow
    const s = r.querySelector('.mjs-modal-backdrop')
    if (s) return s.parentNode === r ? 'ombre' : 'ombre .' + s.parentNode.className
    return 'nulle part'
  }

  function tab(shiftKey = false): boolean {
    const ev = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    window.document.dispatchEvent(ev)
    return ev.defaultPrevented
  }

  it('sans plein écran, la modale se pose dans le corps du document', () => {
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'corps')
  })

  it('un élément du document en plein écran : la modale se pose dedans', () => {
    const plein = window.document.getElementById('plein')
    pleinEcran(plein, null)
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), '#plein')
  })

  it('un élément de l\'ombre fermée d\'un composant en plein écran : la modale y descend, avec sa feuille de style', () => {
    const interieur = scene()._shadow.querySelector('.scene')
    pleinEcran(scene(), interieur)
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'ombre .scene')
    assert.ok(scene()._shadow.adoptedStyleSheets.includes(window.µ._mjs_modalSheet), 'la feuille de la modale est adoptée par l\'ombre')
  })

  it('l\'hôte d\'un composant lui-même en plein écran : la modale se pose dans son ombre (ses enfants directs ne s\'affichent pas)', () => {
    pleinEcran(scene(), null)
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'ombre')
  })

  it('<html> ou une vidéo en plein écran : la modale garde le corps', () => {
    pleinEcran(window.document.documentElement, null)
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'corps', '<html> contient déjà le corps')
    window.µ.modal.close()
    pleinEcran(window.document.getElementById('film'), null)
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'corps', 'une vidéo n\'affiche pas ses enfants')
  })

  it('dans l\'ombre, Tab circule entre les boutons de la modale et reboucle du dernier au premier', () => {
    const interieur = scene()._shadow.querySelector('.scene')
    pleinEcran(scene(), interieur)
    window.µ.modal.fire({ title: 'Question', showCancelButton: true })
    const r       = scene()._shadow
    const valider = r.querySelector('.mjs-modal-confirm')
    const annuler = r.querySelector('.mjs-modal-cancel')
    assert.ok(!!valider && !!annuler, 'les deux boutons sont dans l\'ombre')
    assert.ok(r.activeElement === valider, 'le bouton de validation a le focus')
    assert.equal(tab(), false, 'Tab sur le premier bouton : le navigateur avance, rien n\'est retenu')
    annuler.focus()
    assert.equal(tab(), true, 'Tab sur le dernier bouton : retenu…')
    assert.ok(r.activeElement === valider, '… et le focus revient au premier')
  })

  it('le plein écran se termine pendant qu\'elle est ouverte : la modale revient dans le corps, le focus reste sur son bouton', () => {
    const interieur = scene()._shadow.querySelector('.scene')
    pleinEcran(scene(), interieur)
    window.µ.modal.fire({ title: 'Question', showCancelButton: true })
    assert.equal(lieu(), 'ombre .scene')
    pleinEcran(null, null)
    window.document.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true, composed: true }))
    assert.equal(lieu(), 'corps')
    assert.ok(window.document.activeElement === window.document.querySelector('.mjs-modal-confirm'), 'le focus suit la modale')
  })

  it('le plein écran commence pendant qu\'elle est ouverte : la modale suit dans l\'élément', () => {
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'corps')
    pleinEcran(window.document.getElementById('plein'), null)
    window.document.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true, composed: true }))
    assert.equal(lieu(), '#plein')
  })

  it('fermée, elle ne suit plus rien : un changement de plein écran ne la fait pas réapparaître', () => {
    window.µ.modal.fire({ title: 'Question' })
    window.µ.modal.close()
    pleinEcran(window.document.getElementById('plein'), null)
    window.document.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true, composed: true }))
    assert.equal(lieu(), 'nulle part')
  })
})
