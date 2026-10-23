// `server: 'wss://…'` d'un effet en direct ouvre toujours SA connexion, jamais celle de l'appli, même à la
// même adresse : l'identité d'un compte ne passe pas à un autre, l'`auth` de l'appli n'est pas remplacée par
// « anonyme ». Le vrai client µ.socket contre un vrai serveur mjsWs (MemoryTransport) : le serveur dit qui
// il voit derrière chaque connexion.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

// le serveur : qui envoie « qui » ? son identité, telle que la connexion l'a donnée à l'accueil
async function demarrer() {
  const transport = new MemoryTransport()
  const vus: string[] = []
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth ?? { id: 'anonyme' }, onLog: () => {} } as any)
  app.on('qui', (_p: any, client: any) => { vus.push(client.identity?.id) })
  await app.listen()
  const qui = async (s: any) => {
    vus.length = 0
    s.send('qui', {})
    await tick(30)
    return [...vus]
  }
  return { transport, app, qui }
}

// ce que fait un effet en direct de sa connexion : il la lie, et s'en sert (le lien ouvre la connexion)
const lie = (liens: any[]) => (k: any) => {
  liens.push(k)
  k.connect()
  return () => {}
}

describe('µ._mjs_fxSock — `server` : la connexion propre de l\'effet', () => {
  it('l\'appli tient déjà la même adresse avec son auth : l\'effet n\'en prend pas la connexion, il en ouvre une autre, anonyme', async () => {
    const { transport, app, qui } = await demarrer()
    const µ     = makeClient(transport)
    const appli = µ.socket('memory://meme', { auth: () => ({ id: 'alice' }), reconnect: { enabled: false } })
    appli.connect()
    await tick(20)
    const liens: any[] = []
    const stop = µ._mjs_fxSock(undefined, 'memory://meme', 'msg', lie(liens))
    await tick(20)
    assert.equal(liens.length, 1)
    assert.ok(liens[0] !== appli, 'une autre connexion que celle de l\'appli')
    assert.equal(appli._mjs_refs, 1, 'l\'effet ne retient pas celle de l\'appli')
    assert.deepEqual(await qui(liens[0]), ['anonyme'], 'l\'effet est anonyme')
    assert.deepEqual(await qui(appli), ['alice'], 'l\'appli reste alice')
    stop()
    appli.destroy()
    await app.stop()
  })

  it('l\'effet tient son adresse pendant que l\'appli se déconnecte puis se reconnecte sous un autre compte : bob reste bob', async () => {
    const { transport, app, qui } = await demarrer()
    const µ     = makeClient(transport)
    const alice = µ.socket('memory://meme2', { auth: () => ({ id: 'alice' }), reconnect: { enabled: false } })
    alice.connect()
    await tick(20)
    const liens: any[] = []
    const stop = µ._mjs_fxSock(undefined, 'memory://meme2', 'msg', lie(liens))
    alice.destroy()
    assert.equal(alice._mjs_destroyed, true, 'la connexion de l\'appli se ferme vraiment, l\'effet ne la retient pas')
    const bob = µ.socket('memory://meme2', { auth: () => ({ id: 'bob' }), reconnect: { enabled: false } })
    assert.ok(bob !== alice && bob !== liens[0], 'une connexion neuve, ni celle d\'alice ni celle de l\'effet')
    await tick(20)
    assert.deepEqual(await qui(bob), ['bob'], 'le serveur voit bob, pas alice')
    assert.equal(liens[0]._mjs_destroyed, false, 'celle de l\'effet vit toujours')
    stop()
    bob.destroy()
    await app.stop()
  })

  it('l\'effet ouvre son adresse avant l\'appli : l\'appli qui ouvre la même adresse avec son auth garde son identité, elle n\'est pas « anonyme »', async () => {
    const { transport, app, qui } = await demarrer()
    const µ     = makeClient(transport)
    const liens: any[] = []
    const stop  = µ._mjs_fxSock(undefined, 'memory://meme3', 'msg', lie(liens))
    const appli = µ.socket('memory://meme3', { auth: () => ({ id: 'alice' }), reconnect: { enabled: false } })
    assert.ok(appli !== liens[0], 'l\'appli reçoit sa connexion, pas celle de l\'effet')
    assert.equal(typeof appli.opts.auth, 'function', 'avec les options qu\'elle a demandées')
    appli.connect()
    await tick(20)
    assert.deepEqual(await qui(appli), ['alice'])
    assert.deepEqual(await qui(liens[0]), ['anonyme'])
    stop()
    appli.destroy()
    await app.stop()
  })

  it('l\'effet retiré ferme sa connexion et elle seule : celle de l\'appli reste ouverte', async () => {
    const { transport, app } = await demarrer()
    const µ     = makeClient(transport)
    const appli = µ.socket('memory://meme4', { auth: () => ({ id: 'alice' }), reconnect: { enabled: false } })
    appli.connect()
    await tick(20)
    const liens: any[] = []
    const stop = µ._mjs_fxSock(undefined, 'memory://meme4', 'msg', lie(liens))
    await tick(20)
    stop()
    assert.equal(liens[0]._mjs_destroyed, true, 'la connexion de l\'effet est fermée pour de bon')
    assert.equal(appli._mjs_destroyed, false)
    assert.equal(appli.state, 'open', 'celle de l\'appli reste ouverte')
    assert.equal(µ._mjs_sockets['memory://meme4'], appli, 'et reste celle que µ.socket rend à cette adresse')
    appli.destroy()
    await app.stop()
  })

  it('deux effets avec la même adresse : chacun sa connexion', async () => {
    const { transport, app } = await demarrer()
    const µ    = makeClient(transport)
    const liens: any[] = []
    const a = µ._mjs_fxSock(undefined, 'memory://meme5', 'msg', lie(liens))
    const b = µ._mjs_fxSock(undefined, 'memory://meme5', 'msg', lie(liens))
    assert.equal(liens.length, 2)
    assert.ok(liens[0] !== liens[1], 'deux connexions')
    a()
    assert.equal(liens[0]._mjs_destroyed, true)
    assert.equal(liens[1]._mjs_destroyed, false, 'le retrait du premier ne coupe pas le second')
    b()
    assert.equal(liens[1]._mjs_destroyed, true)
    await app.stop()
  })

  it('sa connexion propre reste connue de µ._mjs_sockets (l\'effet *offline la voit), sans prendre la place de celle de l\'appli', async () => {
    const { transport, app } = await demarrer()
    const µ    = makeClient(transport)
    const liens: any[] = []
    const stop = µ._mjs_fxSock(undefined, 'memory://meme6', 'msg', lie(liens))
    assert.ok(Object.values(µ._mjs_sockets).includes(liens[0]), 'connue du registre')
    assert.equal(µ._mjs_sockets['memory://meme6'], undefined, 'mais pas à l\'adresse que l\'appli demande')
    stop()
    assert.ok(!Object.values(µ._mjs_sockets).includes(liens[0]), 'retirée du registre avec l\'effet')
    await app.stop()
  })
})
