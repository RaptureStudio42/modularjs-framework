// Barre de navigation (mjs_nav_progress.ts) côté routeur : deux filets. Une navigation dont un
// `urlChange` lève finit quand même (la barre ne reste pas jusqu'à la navigation suivante). Un
// composant qui n'arrivera jamais n'éteint la barre que s'il est l'un de ceux que la navigation en
// cours attend — un composant hors de la navigation qui échoue ne coupe pas celle-ci.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME   = join(__dirname, '..', 'src', 'runtime')
const lire      = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')

// le routeur réel, la barre et l'autoloader dans une fenêtre happy-dom
function charger(win: any) {
  const init = lire('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')
  const src  = `${init}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_nav_progress.ts')}\n${lire('mjs_router.ts')}\n${lire('mjs_autoloader.ts')}\nreturn µ;`
  return new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'CustomEvent', src)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, win.CustomEvent)
}

// un composant routé : une vue, deux routes
function routeur(µ: any, document: any) {
  const comp: any = document.createElement('div')
  const view: any = document.createElement('metamjs-view')
  view.id = 'main'
  comp._shadow = comp
  comp.appendChild(view)
  comp.routes = { main: { '/a': 'page-a', '/b': 'page-b' } }
  document.body.appendChild(comp)
  µ.Router._mjs_awareComponents = [comp]
  return comp
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
// la barre à l'écran (un booléen : jamais un nœud dans une assertion)
const barre = (document: any) => !!document.body.querySelector('.mjs-nav-progress')

describe('barre de navigation — filets du routeur', function () {
  it('un urlChange qui lève : la navigation finit quand même, la barre ne paraît pas', async () => {
    const win: any = new Window({ url: 'http://localhost/#/' })
    const µ = charger(win)
    µ.log = () => {}
    µ.config.navProgress = 20
    const comp = routeur(µ, win.document)
    comp._mjs_hooks = { urlChange() { throw new Error('garde en panne') } }
    assert.throws(() => µ.Router.navigate('#/a'), /garde en panne/, 'l\'erreur reste visible')
    await pause(60)
    assert.equal(barre(win.document), false)
    assert.equal(µ._mjs_navProgressTimer === null, true)
    win.close()
  })

  it('un composant hors de la navigation qui n\'arrivera jamais : la barre de la navigation reste', async () => {
    const win: any = new Window({ url: 'http://localhost/#/' })
    const µ = charger(win)
    µ.log = () => {}
    µ.error = () => {}
    µ.config.navProgress = 20
    µ.paths = {}
    routeur(µ, win.document)
    µ.Router.navigate('#/a')
    await pause(60)
    assert.equal(barre(win.document), true, 'la barre pendant que <mjs-page-a> attend son code')
    await µ.Autoloader.load('mjs-autre')
    assert.equal(barre(win.document), true, '<mjs-autre> n\'est pas attendu par la navigation')
    await µ.Autoloader.load('mjs-page-a')
    assert.equal(barre(win.document), false, '<mjs-page-a>, lui, l\'était')
    win.close()
  })
})
