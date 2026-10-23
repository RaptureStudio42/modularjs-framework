// µ.modal.notify et le plein écran (API Fullscreen) : le navigateur n'affiche plus que l'élément plein écran et
// sa descendance. Le conteneur des notifications, posé dans le corps du document, restait donc invisible derrière
// lui — même défaut que la modale, corrigé de la même façon. Ce test garantit que le conteneur se pose DANS
// l'élément plein écran (y compris dans l'ombre fermée d'un composant, avec sa feuille de style), qu'il garde le
// corps quand l'élément ne peut rien afficher (vidéo) ou contient déjà le corps (<html>), et qu'il suit, avec les
// notifications affichées, une entrée ou une sortie du plein écran. Un seul conteneur, jamais un second.
// happy-dom n'a pas l'API Fullscreen : `fullscreenElement` est simulé sur le document et sur l'ombre du
// composant, et `fullscreenchange` est déclenché à la main, comme le ferait le navigateur.

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

describe('µ.modal.notify — visible par-dessus un élément en plein écran', function () {
  this.timeout(60000)
  let window: any
  let ouvertes: any[] = []

  before(async () => {
    const root   = mjsTmp('notif-plein-ecran')
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
    for (const n of ouvertes) n.close()
    ouvertes = []
    pleinEcran(null, null)
    changement()
  })

  const scene = () => window.document.querySelector('mjs-scene')

  // `document.fullscreenElement` rend l'élément vu depuis le document (l'hôte, pour un élément d'une ombre),
  // `fullscreenElement` de l'ombre rend l'élément lui-même
  function pleinEcran(duDocument: any, delOmbre: any) {
    Object.defineProperty(window.document, 'fullscreenElement', { configurable: true, get: () => duDocument })
    Object.defineProperty(scene()._shadow, 'fullscreenElement', { configurable: true, get: () => delOmbre })
  }

  function changement() {
    window.document.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true, composed: true }))
  }

  function notifier(texte: string) {
    ouvertes.push(window.µ.modal.notify(texte, { duration: 0 }))
  }

  // tous les conteneurs, où qu'ils soient, et le lieu de chacun en texte : jamais un nœud dans une assertion
  function lieux(): string[] {
    const d   = window.document
    const r   = scene()._shadow
    const out: string[] = []
    for (const c of [...d.querySelectorAll('.mjs-toasts'), ...r.querySelectorAll('.mjs-toasts')]) {
      const p = c.parentNode
      out.push(p === d.body ? 'corps' : p === r ? 'ombre' : p.id ? '#' + p.id : p.className ? 'ombre .' + p.className : p.nodeName.toLowerCase())
    }
    return out
  }

  function textes(): string[] {
    const d = window.document
    const c = d.querySelector('.mjs-toasts') || scene()._shadow.querySelector('.mjs-toasts')
    return c ? [...c.querySelectorAll('.mjs-toast-message')].map((m: any) => m.textContent) : []
  }

  it('sans plein écran, le conteneur des notifications est dans le corps du document', () => {
    notifier('Enregistré')
    assert.deepEqual(lieux(), ['corps'])
  })

  it('un élément du document en plein écran : la notification se pose dedans', () => {
    pleinEcran(window.document.getElementById('plein'), null)
    notifier('Enregistré')
    assert.deepEqual(lieux(), ['#plein'])
  })

  it('un élément de l\'ombre fermée d\'un composant en plein écran : la notification y descend, avec sa feuille de style', () => {
    pleinEcran(scene(), scene()._shadow.querySelector('.scene'))
    notifier('Enregistré')
    assert.deepEqual(lieux(), ['ombre .scene'])
    assert.ok(scene()._shadow.adoptedStyleSheets.includes(window.µ._mjs_modalSheet), 'la feuille des notifications est adoptée par l\'ombre')
  })

  it('l\'hôte d\'un composant lui-même en plein écran : la notification se pose dans son ombre', () => {
    pleinEcran(scene(), null)
    notifier('Enregistré')
    assert.deepEqual(lieux(), ['ombre'])
  })

  it('<html> ou une vidéo en plein écran : le conteneur garde le corps', () => {
    pleinEcran(window.document.documentElement, null)
    notifier('Un')
    assert.deepEqual(lieux(), ['corps'], '<html> contient déjà le corps')
    pleinEcran(window.document.getElementById('film'), null)
    notifier('Deux')
    assert.deepEqual(lieux(), ['corps'], 'une vidéo n\'affiche pas ses enfants')
  })

  it('le plein écran commence pendant qu\'une notification est affichée : elle suit dans l\'élément', () => {
    notifier('Enregistré')
    assert.deepEqual(lieux(), ['corps'])
    pleinEcran(window.document.getElementById('plein'), null)
    changement()
    assert.deepEqual(lieux(), ['#plein'])
    assert.deepEqual(textes(), ['Enregistré'], 'la notification est toujours là')
  })

  it('le plein écran se termine : le conteneur revient dans le corps, avec ses notifications, sans second conteneur', () => {
    pleinEcran(scene(), scene()._shadow.querySelector('.scene'))
    notifier('Un')
    assert.deepEqual(lieux(), ['ombre .scene'])
    pleinEcran(null, null)
    changement()
    assert.deepEqual(lieux(), ['corps'])
    notifier('Deux')
    assert.deepEqual(lieux(), ['corps'], 'un seul conteneur')
    assert.deepEqual(textes(), ['Un', 'Deux'])
  })
})
