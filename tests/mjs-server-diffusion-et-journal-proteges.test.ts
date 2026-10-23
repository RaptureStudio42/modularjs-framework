// def.spectatorView est appelée à chaque diffusion, depuis une microtâche (mode événementiel) ou la boucle de tick (mode
// action) : aucune requête n'attend sa réponse, une erreur qui en sortirait ferait tomber le processus du serveur. Elle est
// journalisée, la trame des spectateurs est ignorée pour ce tour de diffusion, les sièges ont la leur et la partie continue
// Le journal (onLog) est appelé depuis des minuteries et des chaînes de promesses : un onLog qui lève (intégration cassée)
// ne doit pas non plus faire tomber le serveur, ni arrêter les sauvegardes
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

function fakeAppCapture(): any {
  const envoyes: any[] = []
  return { send: (client: any, type: string, p: any) => envoyes.push({ client, type, p }), _envoyes: envoyes }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

describe('MJS-Server — def.spectatorView qui lève : le serveur ne tombe pas', function () {
  this.timeout(8000)

  // une partie à un siège et un spectateur déjà assis ; `lever.oui` fait lever spectatorView à partir de l'appel suivant
  function salle(extra: Record<string, any> = {}) {
    const app   = fakeAppCapture()
    const lever = { oui: false }
    const erreurs: string[] = []
    const def = resolveGameDef('spec', {
      seats: 1, code: true, state: () => ({ n: 0 }),
      moves: { inc: (game: any) => { game.state.n++ } },
      view: (game: any) => ({ n: game.state.n }),
      spectatorView: (game: any) => { if (lever.oui) throw new Error('boum-spectateur'); return { n: game.state.n } },
      ...extra,
    }, (level, msg) => { if (level === 'error') erreurs.push(String(msg)) })
    const game        = createGame(app, def, () => {}, 'specg')
    const joueur      = fakeClient('p1')
    const spectateur  = fakeClient('s1')
    game._createSeat(joueur)
    game._addSpectator(spectateur)
    const recus = (client: any): any[] => app._envoyes.filter((e: any) => e.client === client && e.type === 'µgame:state')
    return { app, game, joueur, spectateur, lever, erreurs, recus }
  }

  it('mode événementiel : journalisé, le siège reçoit sa trame, le spectateur la sienne dès que la vue est réparée', async () => {
    await sansChute(async () => {
      const { app, game, joueur, spectateur, lever, erreurs, recus } = salle()
      try {
        await tick()
        app._envoyes.length = 0
        lever.oui = true
        game._onMove(joueur, 'inc', {})
        await until(() => erreurs.length > 0, 'l\'erreur de spectatorView est journalisée')
        assert.ok(erreurs.some(m => m.includes('boum-spectateur')), `le journal doit porter l'erreur, reçu : ${JSON.stringify(erreurs)}`)
        assert.equal(recus(joueur).length, 1, 'le siège a reçu sa trame')
        assert.equal(recus(spectateur).length, 0, 'la trame des spectateurs est ignorée pour ce tour de diffusion')

        lever.oui = false
        game._onMove(joueur, 'inc', {})
        await until(() => recus(spectateur).length === 1, 'le spectateur reçoit de nouveau les trames')
        assert.equal(recus(spectateur)[0].p.view.n, 2, 'avec la vue à jour')
      } finally { game._destroy() }
    })
  })

  it('mode événementiel : la partie est tout de même sauvegardée (le hook de mutation est atteint)', async () => {
    await sansChute(async () => {
      const { game, joueur, lever, erreurs } = salle()
      try {
        let mutations = 0
        game._onMutate = () => { mutations++ }
        lever.oui = true
        game._onMove(joueur, 'inc', {})
        await until(() => erreurs.length > 0, 'l\'erreur de spectatorView est journalisée')
        assert.ok(mutations >= 1, 'la sauvegarde est programmée malgré l\'erreur de la vue des spectateurs')
      } finally { game._destroy() }
    })
  })

  it('mode action : journalisé à chaque tick, la boucle continue et les sièges reçoivent leurs trames', async () => {
    await sansChute(async () => {
      const { app, game, joueur, spectateur, lever, erreurs, recus } = salle({ tick: 50 })
      try {
        app._envoyes.length = 0
        lever.oui = true
        await until(() => erreurs.length >= 2 && recus(joueur).length >= 2, 'au moins deux ticks ont tourné malgré l\'erreur répétée')
        assert.ok(erreurs.every(m => m.includes('boum-spectateur')), `chaque erreur du journal porte celle de la vue, reçu : ${JSON.stringify(erreurs)}`)
        assert.equal(recus(spectateur).length, 0, 'aucune trame de spectateur tant que la vue lève')

        lever.oui = false
        await until(() => recus(spectateur).length >= 1, 'le spectateur reçoit de nouveau les trames')
      } finally { game._destroy() }
    })
  })
})

describe('MJS-Server — onLog qui lève : le serveur ne tombe pas', function () {
  this.timeout(8000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // journal cassé : chaque appel lève ; un seul siège, créé par code
  async function serveur(def: Record<string, any>, options: Record<string, any> = {}) {
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => { throw new Error('journal cassé') }, ...options })
    app.game('solo', { seats: 1, code: true, state: () => ({ n: 0 }), view: (game: any) => ({ n: game.state.n }), ...def })
    await app.listen()
    const hote = makeClient(transport, 'hote'); await tick()
    const cree = await hote.request('µgame:play', { type: 'solo', code: true })
    return { hote, cree }
  }

  it('une minuterie applicative qui lève, avec un journal qui lève : rien ne remonte au processus', async () => {
    await sansChute(async () => {
      const { hote, cree } = await serveur({ moves: { arme: (game: any) => { game.timer('rappel', 20) } }, timers: { rappel: () => { throw new Error('boum-minuterie') } } })
      await hote.request('µgame:move', { game: cree.game, move: 'arme' })
      await tick(100)
      const suite = await hote.request('µgame:move', { game: cree.game, move: 'arme' })
      assert.equal(suite.ok, true, 'le serveur répond encore')
    })
  })

  it('hooks.onTurnTimeout qui lève, avec un journal qui lève : rien ne remonte au processus', async () => {
    await sansChute(async () => {
      const { hote, cree } = await serveur({
        turns: { order: 'roundrobin', timeout: 20 },
        moves: { go: (game: any) => { game.next() } },
        hooks: { onTurnTimeout: () => { throw new Error('boum-tour') } },
      })
      await hote.request('µgame:move', { game: cree.game, move: 'go' })
      await tick(100)
      const suite = await hote.request('µgame:move', { game: cree.game, move: 'go' })
      assert.equal(suite.ok, true, 'le serveur répond encore')
    })
  })

  it('une sauvegarde qui échoue, avec un journal qui lève : rien ne remonte au processus et les sauvegardes suivantes partent', async () => {
    await sansChute(async () => {
      let sauvegardes = 0
      const espion = { load: async () => [], save: () => { sauvegardes++; return Promise.reject(new Error('disque plein')) }, remove: () => {} }
      const { hote, cree } = await serveur({ moves: { inc: (game: any) => { game.state.n++ } } }, { persist: { adapter: espion, debounce: 10 } })
      await until(() => sauvegardes >= 1, 'la première sauvegarde (échouée) est tentée')
      const avant = sauvegardes
      await tick(30)   // laisse l'échec et son journal se dérouler
      await hote.request('µgame:move', { game: cree.game, move: 'inc' })
      await until(() => sauvegardes > avant, 'une sauvegarde part encore après l\'échec journalisé par un journal qui lève')
    })
  })
})
