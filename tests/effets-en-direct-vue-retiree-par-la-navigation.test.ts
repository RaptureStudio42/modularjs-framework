// *follow dans une vue du routeur MJS, retiré par la navigation elle-même : le routeur dit « la route change »
// AVANT d'injecter la vue suivante (et de retirer celle d'avant) — l'effet de la vue d'avant ne rejoint pas
// le salon de la page suivante pour le quitter aussitôt (un faux arrivant chez les autres : sa présence, sa
// demande de la dernière position). Il quitte son salon, et c'est tout. Le vrai routeur, les vraies vues ;
// la connexion seule est simulée (les salons rejoints et quittés, ce qu'on demande au serveur).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  'fx-rv-shell.page.mjs': '<routes target="app-view">\n/a  fx-rv-a\n/b  fx-rv-b\n/c  fx-rv-c\n</routes>\n<@view app-view>\n',
  // la vue /a porte l'effet ; /b n'en a pas ; /c en a un, comme /a
  'fx-rv-a.mjs':          '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow><p>a</p></div>\n',
  'fx-rv-b.mjs':          '<p class="b">b</p>\n',
  'fx-rv-c.mjs':          '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow><p>c</p></div>\n',
  // un effet hors de la vue (dans le composant de la page) : il reste, il change de salon avec la route
  'fx-rv-garde.page.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="g" *follow><p>g</p></div>\n<routes target="app-view">\n/a  fx-rv-b\n/b  fx-rv-b\n</routes>\n<@view app-view>\n'
}

const attendre = async (cond: () => boolean, ms = 3000) => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*follow dans une vue du routeur — retiré par la navigation, il ne rejoint pas le salon d\'après', function () {
  this.timeout(120000)
  let window: any
  let erreurOrigine: any

  before(async () => {
    const root   = mjsTmp('effets-en-direct-vue-retiree-par-la-navigation')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/page#/a' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.documentElement.lang = 'fr'
    window.WebSocket = class { readyState = 0; send() {} close() {} }
    erreurOrigine = window.µ.error
  })

  afterEach(() => {
    window.document.body.innerHTML = ''
    window.location.hash = '#/a'
  })

  after(async () => {
    window.µ.error = erreurOrigine
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // une connexion simulée : les salons rejoints et quittés, les présences demandées, les demandes au serveur
  const fauxSocket = () => {
    const journal: string[]  = []
    const requetes: string[] = []
    const s: any = {
      journal, requetes,
      _mjs_refs: 1, state: 'open', opts: {}, _mjs_destroyed: false,
      send() {},
      on() { return () => {} },
      room(nom: string) {
        journal.push('join ' + nom)
        return { presence() { journal.push('presence ' + nom); return {} }, leave() { journal.push('leave ' + nom) } }
      },
      destroy() {},
      request(type: string, p: any) { requetes.push(type + ' ' + JSON.stringify(p)); return Promise.resolve(null) },
      release() {}
    }
    window.µ.socket = () => s
    window.µ._mjs_sockets = { 'wss://x.fr/ws': s }
    window.µ.error = () => {}
    return s
  }

  const monte = async (tag: string, sel: string) => {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const racine = window.document.querySelector(tag)
    await attendre(() => !!(racine._shadow || racine).querySelector(sel))
    await pause(50)
    return racine
  }

  it('naviguer de /a (la vue porte l\'effet) vers /b : le salon de /a est quitté, aucun salon de /b n\'est rejoint ni demandé', async () => {
    const s = fauxSocket()
    await monte('mjs-fx-rv-shell', '.z')
    assert.deepEqual(s.journal, ['join follow:/page#/a', 'presence follow:/page#/a'], 'l\'effet de la vue /a est dans son salon')
    s.journal.length  = 0
    s.requetes.length = 0
    window.µ.Router.navigate('#/b')
    await pause(400)
    assert.deepEqual(s.journal, ['leave follow:/page#/a'], 'quitté, et rien de plus : ni join, ni présence, ni leave du salon d\'après')
    assert.deepEqual(s.requetes, [], 'et aucune demande de la dernière position pour le salon d\'après : un faux arrivant chez les autres')
  })

  it('naviguer d\'une vue qui porte l\'effet à une autre qui en porte un : le salon de /a est quitté, celui de /c rejoint une fois, par l\'effet neuf', async () => {
    const s = fauxSocket()
    await monte('mjs-fx-rv-shell', '.z')
    s.journal.length  = 0
    s.requetes.length = 0
    window.µ.Router.navigate('#/c')
    await attendre(() => s.journal.includes('join follow:/page#/c'))
    await pause(200)
    assert.deepEqual(s.journal, ['leave follow:/page#/a', 'join follow:/page#/c', 'presence follow:/page#/c'], 'un seul join pour /c')
    assert.deepEqual(s.requetes, ['follow:last {"room":"/page#/c"}'], 'une seule demande, pour /c')
  })

  it('un effet hors de la vue (dans le composant de la page) reste : il quitte l\'ancien salon et rejoint le nouveau, après la navigation', async () => {
    const s = fauxSocket()
    await monte('mjs-fx-rv-garde', '.g')
    assert.deepEqual(s.journal, ['join follow:/page#/a', 'presence follow:/page#/a'])
    s.journal.length = 0
    window.µ.Router.navigate('#/b')
    await attendre(() => s.journal.includes('join follow:/page#/b'))
    assert.deepEqual(s.journal, ['leave follow:/page#/a', 'join follow:/page#/b', 'presence follow:/page#/b'])
  })
})
