// µ.modal et les méthodes qu'un auteur de composant définit sous un nom du DOM. `@contains` et `@focus` sont des
// noms naturels, laissés libres par le compilateur : un composant les prend pour ses propres méthodes (`@contains`
// pour « ce profil contient-il ce mot-clé », `@focus = (id) -> $sel = id` pour choisir un champ). Le cadre appelle
// `contains` sur l'élément en plein écran et `focus` sur l'élément qui avait le focus avant l'ouverture de la
// fenêtre : quand c'est la balise d'un composant, il doit le faire par le DOM lui-même, jamais par la méthode de
// l'auteur, qui masque celle de la balise. Deux conséquences visibles avant : la fenêtre se posait dans le corps,
// invisible derrière le composant en plein écran (`@contains` répondait vrai), et `@focus` recevait l'objet
// d'options du cadre à la place d'un identifiant.
// happy-dom n'a pas l'API Fullscreen : `fullscreenElement` est simulé, comme dans modale-par-dessus-le-plein-ecran.test.ts.

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

const SCENE = [
  '<script>',
  '@contains = (x) ->',
  '  window.__appels.push(\'contains\')',
  '  true',
  '@focus = (options) ->',
  '  window.__appels.push(\'focus\')',
  '</script>',
  '<div class="scene"><p>scène</p></div>',
  ''
].join('\n')

describe('µ.modal — les méthodes @contains et @focus de l\'auteur ne sont jamais appelées sur la balise de son composant', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('modale-methodes-auteur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'scene.mjs'), SCENE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.__appels = []
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-scene tabindex="0"></mjs-scene><button id="ordinaire">ordinaire</button>'
    await attendre(() => !!scene()._shadow?.querySelector('.scene'))
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  afterEach(() => {
    window.µ.modal.close()
    pleinEcran(null, null)
    window.__appels.length = 0
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
    if (window.document.querySelector('.mjs-modal-backdrop')) return 'corps'
    return scene()._shadow.querySelector('.mjs-modal-backdrop') ? 'ombre' : 'nulle part'
  }

  // les appels des méthodes de l'auteur, recopiés dans ce monde-ci (un tableau de la fenêtre n'a pas le même prototype)
  const appels = (): string[] => Array.from(window.__appels)

  // `focus` de la balise elle-même, celle que la méthode de l'auteur masque
  const focusDuDom = (el: any) => window.HTMLElement.prototype.focus.call(el)

  it('plein écran sur la balise d\'un composant qui définit @contains : la modale entre dans son ombre, @contains n\'est pas appelée', () => {
    pleinEcran(scene(), null)
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'ombre')
    assert.deepEqual(appels(), [])
  })

  it('plein écran sur un élément de l\'ombre du composant : la modale y descend aussi, @contains n\'est pas appelée', () => {
    pleinEcran(scene(), scene()._shadow.querySelector('.scene'))
    window.µ.modal.fire({ title: 'Question' })
    assert.equal(lieu(), 'ombre')
    assert.deepEqual(appels(), [])
  })

  it('la modale se ferme alors que le focus était sur la balise d\'un composant qui définit @focus : le focus lui revient, @focus n\'est pas appelée', async () => {
    const hote = scene()
    focusDuDom(hote)
    assert.ok(window.document.activeElement === hote, 'le composant a le focus au départ')
    const p = window.µ.modal.fire({ title: 'Question' })
    assert.ok(window.document.activeElement !== hote, 'le focus est passé dans la modale')
    window.µ.modal.close()
    await p
    assert.ok(window.document.activeElement === hote, 'le focus est revenu au composant')
    assert.deepEqual(appels(), [])
  })

  it('témoin : le focus revient aussi à un élément ordinaire', async () => {
    const bouton = window.document.getElementById('ordinaire')
    bouton.focus()
    assert.ok(window.document.activeElement === bouton, 'le bouton a le focus au départ')
    const p = window.µ.modal.fire({ title: 'Question' })
    assert.ok(window.document.activeElement !== bouton, 'le focus est passé dans la modale')
    window.µ.modal.close()
    await p
    assert.ok(window.document.activeElement === bouton, 'le focus est revenu au bouton')
  })

  it('une balise personnalisée qui n\'est pas un composant (autre bibliothèque) garde son propre focus : sa méthode est appelée', async () => {
    window.eval('customElements.define(\'x-champ\', class extends HTMLElement { focus(options) { window.__appels.push(\'champ\'); return super.focus(options) } })')
    window.document.body.insertAdjacentHTML('beforeend', '<x-champ id="champ" tabindex="0"></x-champ>')
    const champ = window.document.getElementById('champ')
    focusDuDom(champ)
    assert.ok(window.document.activeElement === champ, 'la balise a le focus au départ')
    const p = window.µ.modal.fire({ title: 'Question' })
    window.µ.modal.close()
    await p
    assert.deepEqual(appels(), ['champ'])
    assert.ok(window.document.activeElement === champ, 'le focus est revenu à la balise')
  })
})
