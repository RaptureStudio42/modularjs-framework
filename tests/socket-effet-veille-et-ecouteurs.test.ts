// µ._mjs_fxSock — ce que la connexion d'un effet en direct défait vraiment, un test pour chaque geste :
//   - la connexion détruite par l'appli : l'effet se détache, puis relit sa variable (une autre connexion
//     posée à sa place, sans que rien ne l'annonce, est prise) ;
//   - la veille de la variable (un intervalle) s'arrête dès qu'une connexion est branchée, et au retrait de
//     l'effet — avec ou sans connexion, avant ou après la perte de l'ancienne ; sans réglage, elle relit
//     toutes les 250 ms ;
//   - le salon suit `popstate` seul, `hashchange` seul, et `mjs-route-changed` seul ;
//   - au retrait de l'effet, aucun des trois écouteurs de la fenêtre ne reste (connexion de la variable, ou
//     connexion propre `server`).
// Le vrai client µ.socket ; la fenêtre et les intervalles sont des espions (rien n'est simulé de leur
// comportement).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

const EVENEMENTS = ['mjs-route-changed', 'popstate', 'hashchange']

describe('µ._mjs_fxSock — la veille, la route et ce qui se défait au retrait', () => {
  const g: any = globalThis
  const vrai    = { setInterval: g.setInterval, clearInterval: g.clearInterval, window: g.window, hadWindow: 'window' in g }
  const suivi   = { vivants: new Set<any>(), delais: [] as number[] }
  const ecoutes = new Map<string, Set<any>>()
  let µ: any
  let fenetre: any

  beforeEach(() => {
    suivi.vivants.clear()
    suivi.delais.length = 0
    ecoutes.clear()
    g.setInterval = (f: any, ms: number, ...a: any[]) => {
      const id = vrai.setInterval(f, ms, ...a)
      suivi.vivants.add(id)
      suivi.delais.push(ms)
      return id
    }
    g.clearInterval = (id: any) => {
      suivi.vivants.delete(id)
      vrai.clearInterval(id)
    }
    // une fenêtre qui retient ses écouteurs vivants (ajoutés moins retirés)
    fenetre = new EventTarget()
    const ajoute = fenetre.addEventListener.bind(fenetre)
    const retire = fenetre.removeEventListener.bind(fenetre)
    fenetre.addEventListener = (type: string, f: any, o?: any) => {
      if (!ecoutes.has(type)) ecoutes.set(type, new Set())
      ecoutes.get(type)!.add(f)
      ajoute(type, f, o)
    }
    fenetre.removeEventListener = (type: string, f: any, o?: any) => {
      ecoutes.get(type)?.delete(f)
      retire(type, f, o)
    }
    g.window = fenetre
    µ = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
    new Function('µ', socketSrc)(µ)
    µ._mjs_sockPoll = 20
  })

  afterEach(() => {
    suivi.vivants.forEach((id) => vrai.clearInterval(id))
    g.setInterval   = vrai.setInterval
    g.clearInterval = vrai.clearInterval
    if (vrai.hadWindow) g.window = vrai.window
    else delete g.window
    Object.values(µ._mjs_sockets || {}).forEach((s: any) => s.destroy())
  })

  const lien    = (liens: any[], defaits: any[] = []) => (k: any) => {
    liens.push(k)
    return () => { defaits.push(k) }
  }
  const vivants = () => EVENEMENTS.map((e) => ecoutes.get(e)?.size ?? 0)

  it('la connexion détruite par l\'appli, une autre posée à sa place sans que rien ne l\'annonce : l\'effet se détache de la première, puis relit sa variable et se branche sur la seconde', async () => {
    const a       = µ.socket('wss://veille/a')
    const liens: any[]   = []
    const defaits: any[] = []
    let courante: any    = a
    const stop = µ._mjs_fxSock(a, undefined, 'msg', lien(liens, defaits), { read: () => courante })
    assert.deepEqual(liens, [a], 'branché sur la première')
    a.destroy()
    assert.deepEqual(defaits, [a], 'détaché de la première, détruite par l\'appli')
    const b = µ.socket('wss://veille/b')
    courante = b
    await tick(120)
    assert.deepEqual(liens, [a, b], 'la variable relue : la seconde est prise, sans autre rendu')
    stop()
    assert.deepEqual(defaits, [a, b], 'et le retrait défait la seconde')
  })

  it('la veille s\'arrête dès qu\'une connexion est branchée : plus aucun intervalle vivant', async () => {
    const a      = µ.socket('wss://veille/arrive')
    const liens: any[] = []
    let courante: any  = null
    const stop = µ._mjs_fxSock(null, undefined, 'msg', lien(liens), { read: () => courante })
    assert.equal(suivi.vivants.size, 1, 'sans connexion, la variable est relue : un intervalle vivant')
    courante = a
    await tick(120)
    assert.deepEqual(liens, [a], 'la connexion arrivée est branchée')
    assert.equal(suivi.vivants.size, 0, 'branchée : la veille est arrêtée')
    stop()
  })

  it('l\'effet retiré avant toute connexion arrête sa veille ; retiré après la perte de sa connexion (la veille a repris), aussi', async () => {
    const liens: any[] = []
    const seul = µ._mjs_fxSock(null, undefined, 'msg', lien(liens), { read: () => null })
    assert.equal(suivi.vivants.size, 1)
    seul()
    assert.equal(suivi.vivants.size, 0, 'retiré sans avoir eu de connexion : plus d\'intervalle')
    const a    = µ.socket('wss://veille/perdue')
    const stop = µ._mjs_fxSock(a, undefined, 'msg', lien(liens), { read: () => null })
    assert.equal(suivi.vivants.size, 0, 'branché : aucune veille')
    a.destroy()
    assert.equal(suivi.vivants.size, 1, 'la connexion détruite par l\'appli : la veille reprend')
    stop()
    assert.equal(suivi.vivants.size, 0, 'retiré : plus d\'intervalle')
  })

  it('sans réglage, la veille relit la variable toutes les 250 ms', () => {
    const neuf: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
    new Function('µ', socketSrc)(neuf)
    assert.equal(neuf._mjs_sockPoll, 250, 'le délai par défaut')
    const stop = neuf._mjs_fxSock(null, undefined, 'msg', lien([]), { read: () => null })
    assert.deepEqual(suivi.delais, [250], 'l\'intervalle posé porte ce délai')
    stop()
  })

  for (const evenement of EVENEMENTS) {
    it(`le salon suit « ${evenement} » à lui seul : l'effet quitte l'ancien salon et rejoint le nouveau`, async () => {
      const a      = µ.socket('wss://route/' + evenement)
      const salles: string[] = []
      const defaites: string[] = []
      let salle  = '/a'
      const stop = µ._mjs_fxSock(a, undefined, 'msg', () => {
        const ici = salle
        salles.push(ici)
        return () => { defaites.push(ici) }
      }, { room: () => salle })
      assert.deepEqual(salles, ['/a'])
      salle = '/b'
      fenetre.dispatchEvent(new Event(evenement))
      await tick(0)
      assert.deepEqual(defaites, ['/a'], 'l\'ancien salon est quitté')
      assert.deepEqual(salles, ['/a', '/b'], 'le nouveau est rejoint')
      stop()
    })
  }

  it('« popstate » et « hashchange » d\'une même navigation (le navigateur les envoie ensemble) ne refont le lien qu\'une fois', async () => {
    const a = µ.socket('wss://route/ensemble')
    const salles: string[]   = []
    const defaites: string[] = []
    let salle = '/a'
    const stop = µ._mjs_fxSock(a, undefined, 'msg', () => {
      const ici = salle
      salles.push(ici)
      return () => { defaites.push(ici) }
    }, { room: () => salle })
    salle = '/b'
    fenetre.dispatchEvent(new Event('popstate'))
    fenetre.dispatchEvent(new Event('hashchange'))
    await tick(0)
    assert.deepEqual(defaites, ['/a'], 'l\'ancien salon est quitté une fois')
    assert.deepEqual(salles, ['/a', '/b'], 'le nouveau est rejoint une fois')
    stop()
  })

  it('l\'effet retiré ne laisse aucun écouteur de la fenêtre (connexion de sa variable, avec ou sans connexion encore)', () => {
    const a       = µ.socket('wss://ecoute/a')
    const branche = µ._mjs_fxSock(a, undefined, 'msg', lien([]), { room: () => '/a' })
    assert.deepEqual(vivants(), [1, 1, 1], 'trois écouteurs posés : la route, le retour en arrière, l\'ancre')
    branche()
    assert.deepEqual(vivants(), [0, 0, 0], 'branché puis retiré : aucun ne reste')
    const attend = µ._mjs_fxSock(null, undefined, 'msg', lien([]), { room: () => '/a', read: () => null })
    assert.deepEqual(vivants(), [1, 1, 1])
    attend()
    assert.deepEqual(vivants(), [0, 0, 0], 'retiré sans avoir eu de connexion : aucun ne reste')
  })

  it('l\'effet retiré ne laisse aucun écouteur de la fenêtre (sa connexion propre, `server`)', () => {
    const liens: any[] = []
    const stop = µ._mjs_fxSock(undefined, 'wss://ecoute/propre', 'msg', lien(liens), { room: () => '/a' })
    assert.equal(liens.length, 1, 'sa connexion propre est ouverte')
    assert.deepEqual(vivants(), [1, 1, 1])
    stop()
    assert.equal(liens[0]._mjs_destroyed, true, 'fermée avec l\'effet')
    assert.deepEqual(vivants(), [0, 0, 0], 'aucun écouteur ne reste')
  })
})
