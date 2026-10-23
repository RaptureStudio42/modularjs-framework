// *follow, *cursors, *react, *heatmap — la connexion et le salon, dans la page :
//   - `@sock` posé APRÈS le montage (dans une fonction après une connexion de l'utilisateur, après un
//     `await` dans µawake, sur <@document> par µawake, `sock: @autre`, ou une autre connexion posée à la
//     place de celle que l'appli a détruite) : l'effet s'y branche, sans erreur de trop ;
//   - le salon par défaut est la page et sa route : quand la route change, l'effet quitte l'ancien salon
//     et rejoint le nouveau (un microtour après l'événement : le routeur le dit avant d'injecter la vue
//     suivante) ; la trousse des curseurs reste en place (même calque, même compte de clics) et ne montre plus
//     ceux de l'ancien salon ; un salon écrit (`room`) ne bouge pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CORPS = '<section><button class="b">Un</button></section>'
const tard  = (url: string) => `<script>\nconnecter = ->\n  @sock = µsocket '${url}'\n</script>\n<button class="go" @click={connecter()}>go</button>\n`

const COMPOSANTS: Record<string, string> = {
  // @sock posé dans une fonction, appelée après le montage
  'fx-sp-suivre':   tard('wss://tard.fr/suivre') + '<div class="z" *follow>' + CORPS + '</div>',
  'fx-sp-curseurs': tard('wss://tard.fr/curseurs') + '<div class="z" *cursors>' + CORPS + '</div>',
  'fx-sp-reagir':   tard('wss://tard.fr/reagir') + '<div class="z" *react(stage: true)></div>',
  'fx-sp-chaleur':  tard('wss://tard.fr/chaleur') + '<div class="z" *heatmap>zone</div>',
  // après un await dans µawake
  'fx-sp-attente': '<script>\nµawake ->\n  await new Promise (r) -> setTimeout r, 120\n  @sock = µsocket \'wss://tard.fr/attente\'\n</script>\n<div class="z" *follow>' + CORPS + '</div>',
  // <@document *follow>, @sock posé dans µawake (après l'effet de la page)
  'fx-sp-document': '<script>\nµawake ->\n  @sock = µsocket \'wss://tard.fr/document\'\n</script>\n<@document *follow></@document>\n<p class="z">x</p>',
  // une autre variable du composant
  'fx-sp-autre': '<script>\nconnecter = ->\n  @autre = µsocket \'wss://tard.fr/autre\'\n</script>\n<button class="go" @click={connecter()}>go</button>\n<div class="z" *follow(sock: @autre)>' + CORPS + '</div>',
  // la connexion détruite par l'appli, une autre posée à sa place
  'fx-sp-remplace': '<script>\n@sock = µsocket \'wss://tard.fr/avant\'\nrenouveler = ->\n  @sock.destroy()\n  @sock = µsocket \'wss://tard.fr/apres\'\n</script>\n<button class="go" @click={renouveler()}>go</button>\n<div class="z" *follow>' + CORPS + '</div>',
  // le salon : la page et sa route
  'fx-sr-suivre':   '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow>' + CORPS + '</div>',
  'fx-sr-curseurs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *cursors(cursor: pulse, selection: false, focus: false)>' + CORPS + '</div>',
  'fx-sr-reagir':   '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *react(stage: true)></div>',
  'fx-sr-document': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<@document *cursors(selection: false, focus: false)></@document>\n<p class="z">x</p>',
  'fx-sr-ecrit':    '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow(room: \'cours\')>' + CORPS + '</div>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*follow, *cursors, *react, *heatmap — la connexion posée plus tard, le salon qui suit la route', function () {
  this.timeout(60000)
  let window: any
  let vraiSocket: any
  let erreurs: string[]
  let erreurOrigine: any
  let pointOrigine: any

  before(async () => {
    const root   = mjsTmp('effets-en-direct-sock-pose-plus-tard-et-route')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
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
    // aucune vraie connexion : le navigateur simulé n'en ouvre pas
    window.WebSocket = class { readyState = 0; send() {} close() {} }
    vraiSocket    = window.µ.socket
    erreurOrigine = window.µ.error
    pointOrigine  = window.document.elementFromPoint
  })

  beforeEach(() => {
    erreurs = []
    window.µ.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }
    window.µ.socket = vraiSocket
    window.µ._mjs_sockGrace = 60
    window.µ._mjs_sockPoll  = 20
    window.location.hash = '#/a'
  })

  afterEach(() => {
    window.document.body.innerHTML = ''
    window.document.elementFromPoint = pointOrigine
    Object.values(window.µ._mjs_sockets || {}).forEach((s: any) => s.destroy())
    window.µ._mjs_sockets = {}
  })

  after(async () => {
    window.µ.error = erreurOrigine
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause(20)
    return comp._shadow.querySelector(sel)
  }

  const connexion = (url: string) => () => window.µ._mjs_sockets[url]

  describe('@sock posé après le montage', () => {
    for (const [effet, tag, url, trace] of [
      ['*follow', 'mjs-fx-sp-suivre', 'wss://tard.fr/suivre', (s: any) => s._mjs_rooms['follow:/page#/a']],
      ['*cursors', 'mjs-fx-sp-curseurs', 'wss://tard.fr/curseurs', (s: any) => s._mjs_rooms['cursors:/page#/a']],
      ['*react', 'mjs-fx-sp-reagir', 'wss://tard.fr/reagir', (s: any) => s._mjs_rooms['reactions:/page#/a']],
      ['*heatmap', 'mjs-fx-sp-chaleur', 'wss://tard.fr/chaleur', (s: any) => s._mjs_fxPackages && s._mjs_fxPackages['heatmap:']]
    ] as Array<[string, string, string, (s: any) => any]>) {
      it(`${effet} : @sock posé dans une fonction après le montage — l'effet s'y branche, sans attendre un autre rendu`, async () => {
        const racine = await monter(tag, '.go')
        const ou     = connexion(url)
        assert.equal(ou(), undefined, 'aucune connexion au montage')
        racine.click()
        await attendre(() => !!ou() && !!trace(ou()))
        assert.ok(ou(), 'la connexion existe')
        assert.ok(trace(ou()), `${effet} s'y est branché`)
      })
    }

    it('*follow : @sock posé après un await dans µawake — l\'effet s\'y branche', async () => {
      window.µ._mjs_sockGrace = 5000
      await monter('mjs-fx-sp-attente', '.z')
      const ou = connexion('wss://tard.fr/attente')
      await attendre(() => !!ou() && !!ou()._mjs_rooms['follow:/page#/a'])
      assert.ok(ou() && ou()._mjs_rooms['follow:/page#/a'], 'le salon de la page est rejoint sur la connexion posée plus tard')
      assert.deepEqual(erreurs, [], 'et le message « variable vide » n\'a pas été dit (la connexion est arrivée avant)')
    })

    it('<@document *follow> : @sock posé dans µawake (après l\'effet de la page) — l\'effet s\'y branche', async () => {
      await monter('mjs-fx-sp-document', '.z')
      const ou = connexion('wss://tard.fr/document')
      await attendre(() => !!ou() && !!ou()._mjs_rooms['follow:/page#/a'])
      assert.ok(ou() && ou()._mjs_rooms['follow:/page#/a'], 'le salon de la page est rejoint')
    })

    it('sock: @autre : une autre variable du composant, posée plus tard, est relue aussi', async () => {
      const racine = await monter('mjs-fx-sp-autre', '.go')
      racine.click()
      const ou = connexion('wss://tard.fr/autre')
      await attendre(() => !!ou() && !!ou()._mjs_rooms['follow:/page#/a'])
      assert.ok(ou() && ou()._mjs_rooms['follow:/page#/a'])
    })

    it('la connexion posée après le délai : l\'effet l\'a dit en console une fois, puis s\'y branche quand même (comme son message le promet)', async () => {
      window.µ._mjs_sockGrace = 40
      await monter('mjs-fx-sp-attente', '.z')
      const ou = connexion('wss://tard.fr/attente')
      await attendre(() => !!ou() && !!ou()._mjs_rooms['follow:/page#/a'], 4000)
      assert.ok(ou() && ou()._mjs_rooms['follow:/page#/a'], 'branché')
      assert.equal(erreurs.length, 1, 'le message n\'est dit qu\'une fois : ' + JSON.stringify(erreurs))
      assert.match(erreurs[0], /\*follow n'a pas de connexion/)
    })

    it('la connexion détruite par l\'appli puis remplacée dans @sock : l\'effet se détache de l\'ancienne et se branche sur la nouvelle', async () => {
      const racine = await monter('mjs-fx-sp-remplace', '.go')
      const avant  = window.µ._mjs_sockets['wss://tard.fr/avant']
      await attendre(() => !!avant && !!avant._mjs_rooms['follow:/page#/a'])
      assert.ok(avant._mjs_rooms['follow:/page#/a'], 'branché sur la première')
      racine.click()
      const apres = connexion('wss://tard.fr/apres')
      await attendre(() => !!apres() && !!apres()._mjs_rooms['follow:/page#/a'])
      assert.equal(avant._mjs_destroyed, true)
      assert.ok(apres() && apres()._mjs_rooms['follow:/page#/a'], 'branché sur la seconde')
    })
  })

  describe('le salon suit la route', () => {
    // un serveur temps réel simulé : les salons rejoints et quittés, ce que l'effet envoie et demande
    const fauxSocket = () => {
      const journal: string[] = []
      const envoyes: any[] = []
      const requetes: any[] = []
      const ecoutes: Record<string, any[]> = {}
      const s: any = {
        journal, envoyes, requetes,
        send(type: string, p: any, o?: any) { envoyes.push([type, p, o]) },
        on(type: string, f: any) { (ecoutes[type] ||= []).push(f); return () => {} },
        room(nom: string) {
          journal.push('join ' + nom)
          // les visiteurs que tient la présence du salon (seuls ceux-là sont dessinés) : Ana (7), Bob (9)
          return { presence: () => ({ '7': true, '9': true }), leave() { journal.push('leave ' + nom) } }
        },
        destroy() {},
        request(type: string, p: any) { requetes.push([type, p]); return Promise.resolve(type === 'follow:last' ? null : { id: 'moi', name: 'Moi' }) },
        recoit(type: string, p: any) { (ecoutes[type] || []).forEach((f) => f(p)) },
        release() {}
      }
      window.µ.socket = () => s
      window.µ._mjs_sockets = { 'wss://x.fr/ws': s }
      return s
    }
    // la navigation du routeur : l'adresse change, puis il le dit
    const navigue = (hash: string, evenement = 'mjs-route-changed') => {
      window.location.hash = hash
      window.dispatchEvent(new window.Event(evenement))
    }

    for (const [effet, tag, sel, prefixe] of [
      ['*follow', 'mjs-fx-sr-suivre', '.z', 'follow:'],
      ['*cursors', 'mjs-fx-sr-curseurs', '.z', 'cursors:'],
      ['*react', 'mjs-fx-sr-reagir', '.z', 'reactions:'],
      ['*cursors sur <@document>', 'mjs-fx-sr-document', '.z', 'cursors:']
    ]) {
      it(`${effet} : la route change — il quitte l'ancien salon et rejoint le nouveau`, async () => {
        const s = fauxSocket()
        await monter(tag, sel)
        assert.deepEqual(s.journal, [`join ${prefixe}/page#/a`], 'le salon de la page et de sa route, à la pose')
        navigue('#/b')
        await pause(0)
        assert.deepEqual(s.journal, [`join ${prefixe}/page#/a`, `leave ${prefixe}/page#/a`, `join ${prefixe}/page#/b`], 'quitté, puis rejoint')
        // le retour en arrière (popstate), lui aussi
        window.location.hash = '#/a'
        window.dispatchEvent(new window.Event('popstate'))
        await pause(0)
        assert.deepEqual(s.journal.slice(3), [`leave ${prefixe}/page#/b`, `join ${prefixe}/page#/a`])
        // et un changement d'ancre ou de requête seul ne change pas de salon
        const avant = s.journal.length
        navigue('#/a?tri=nom')
        navigue('#/a?tri=prix', 'hashchange')
        await pause(0)
        assert.equal(s.journal.length, avant, 'la route est la même : aucun mouvement')
      })
    }

    it('la navigation du routeur MJS elle-même (µ.Router.navigate) change le salon, comme son retour en arrière', async () => {
      const s = fauxSocket()
      await monter('mjs-fx-sr-suivre', '.z')
      window.µ.Router.navigate('#/b')
      await pause(0)
      assert.deepEqual(s.journal, ['join follow:/page#/a', 'leave follow:/page#/a', 'join follow:/page#/b'])
      window.µ.Router.navigate('#/a')
      await pause(0)
      assert.deepEqual(s.journal.slice(3), ['leave follow:/page#/b', 'join follow:/page#/a'])
    })

    it('*follow : au salon neuf, il redemande la dernière position de celui-là', async () => {
      const s = fauxSocket()
      await monter('mjs-fx-sr-suivre', '.z')
      const avant = s.requetes.length
      navigue('#/b')
      await pause(0)
      assert.equal(JSON.stringify(s.requetes.slice(avant)), JSON.stringify([['follow:last', { room: '/page#/b' }]]), 'une seule demande, pour le salon neuf')
    })

    it('*cursors : la trousse reste (même calque, même compte de clics), elle ne montre plus ceux de l\'ancien salon et dessine ceux du nouveau', async () => {
      const s      = fauxSocket()
      const zone   = await monter('mjs-fx-sr-curseurs', '.z')
      const bouton = zone.querySelector('.b')
      const calque = window.document.querySelector('[mjs-fx-cursors-layer]')
      assert.ok(calque, 'le calque existe')
      const de = { id: '7', name: 'Ana' }
      s.recoit('cursors:move', { room: '/page#/a', p: { a: [0, 0, 0], x: 0.5, y: 0.5 }, from: de })
      await attendre(() => window.document.querySelectorAll('[mjs-fx-cursor]').length === 1)
      assert.equal(window.document.querySelectorAll('[mjs-fx-cursor]').length, 1, 'le curseur d\'Ana, dans le salon de départ')
      // un clic de moi : le compte monte à 1, dans le salon de départ
      window.document.elementFromPoint = () => bouton
      const clique = () => window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
      clique()
      const comptes = () => s.envoyes.filter((e: any) => e[0] === 'cursors:move').map((e: any) => [e[1].room, e[1].c])
      assert.deepEqual(comptes().at(-1), ['/page#/a', 1])
      navigue('#/b')
      await pause(0)
      assert.ok(window.document.querySelector('[mjs-fx-cursors-layer]') === calque, 'le même calque : la trousse n\'est pas refaite')
      assert.equal(window.document.querySelectorAll('[mjs-fx-cursor]').length, 0, 'le curseur d\'Ana, de l\'ancien salon, n\'est plus là')
      clique()
      assert.deepEqual(comptes().at(-1), ['/page#/b', 2], 'le compte des clics continue, dans le salon neuf')
      // un visiteur du salon neuf : dessiné ; celui de l'ancien salon : ignoré
      s.recoit('cursors:move', { room: '/page#/b', p: { a: [0, 0, 0], x: 0.2, y: 0.2 }, from: { id: '9', name: 'Bob' } })
      s.recoit('cursors:move', { room: '/page#/a', p: { a: [0, 0, 0], x: 0.2, y: 0.2 }, from: de })
      await attendre(() => window.document.querySelectorAll('[mjs-fx-cursor]').length === 1)
      assert.equal(window.document.querySelectorAll('[mjs-fx-cursor]').length, 1, 'Bob seul')
    })

    it('un salon écrit (`room`) ne bouge pas avec la route', async () => {
      const s = fauxSocket()
      await monter('mjs-fx-sr-ecrit', '.z')
      assert.deepEqual(s.journal, ['join follow:cours'])
      navigue('#/b')
      await pause(0)
      assert.deepEqual(s.journal, ['join follow:cours'], 'aucun mouvement')
    })

    it('l\'effet retiré n\'écoute plus la route : plus aucun salon rejoint', async () => {
      const s = fauxSocket()
      await monter('mjs-fx-sr-suivre', '.z')
      window.document.body.innerHTML = ''
      await attendre(() => s.journal.includes('leave follow:/page#/a'))
      assert.ok(s.journal.includes('leave follow:/page#/a'), 'l\'effet retiré a quitté son salon : ' + JSON.stringify(s.journal))
      const avant = s.journal.length
      navigue('#/c')
      navigue('#/d', 'popstate')
      await pause(0)
      assert.equal(s.journal.length, avant, 'rien de rejoint après le retrait : ' + JSON.stringify(s.journal))
    })
  })
})
