// µ.modal.notify retient son conteneur (`.mjs-toasts`) tant qu'il est dans la page. Posé dans l'ombre fermée d'un
// composant (plein écran sur un élément de cette ombre), il est invisible depuis <html> : une recherche
// `querySelector('.mjs-toasts')` depuis <html> ne le verrait pas et en créerait un second, avec ses propres
// notifications, à côté du premier. Ce test garantit qu'une notification qui arrive pendant que le conteneur est
// dans l'ombre le réutilise — qu'il y soit arrivé avec le plein écran ou qu'il l'ait suivi après des notifications
// posées dans le corps. Il complète notifications-par-dessus-le-plein-ecran.test.ts, qui ne notifie jamais deux
// fois pendant que le conteneur est dans l'ombre.
// happy-dom n'a pas l'API Fullscreen : `fullscreenElement` est simulé sur le document et sur l'ombre du composant,
// et `fullscreenchange` est déclenché à la main, comme le ferait le navigateur.

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

describe('µ.modal.notify — le conteneur retenu est réutilisé, même dans l\'ombre d\'un composant', function () {
  this.timeout(60000)
  let window: any
  let ouvertes: any[] = []

  before(async () => {
    const root   = mjsTmp('notif-conteneur-retenu')
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
    window.document.body.innerHTML = '<mjs-scene></mjs-scene>'
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

  // le texte de chaque notification, tous conteneurs confondus
  function textes(): string[] {
    const d = window.document
    const r = scene()._shadow
    return [...d.querySelectorAll('.mjs-toast-message'), ...r.querySelectorAll('.mjs-toast-message')].map((m: any) => m.textContent)
  }

  it('deux notifications pendant le plein écran d\'un élément de l\'ombre : un seul conteneur, les deux dedans', () => {
    pleinEcran(scene(), scene()._shadow.querySelector('.scene'))
    notifier('Un')
    notifier('Deux')
    assert.deepEqual(lieux(), ['ombre .scene'])
    assert.deepEqual(textes(), ['Un', 'Deux'])
  })

  it('le conteneur a suivi le plein écran dans l\'ombre avec deux notifications : une troisième le réutilise', () => {
    notifier('Un')
    notifier('Deux')
    assert.deepEqual(lieux(), ['corps'])
    pleinEcran(scene(), scene()._shadow.querySelector('.scene'))
    changement()
    assert.deepEqual(lieux(), ['ombre .scene'])
    notifier('Trois')
    assert.deepEqual(lieux(), ['ombre .scene'])
    assert.deepEqual(textes(), ['Un', 'Deux', 'Trois'])
  })
})
