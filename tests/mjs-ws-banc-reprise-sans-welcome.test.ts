// visiteur sans compte accueilli au banc (réduit au paquet comptes) : la fonction `welcome` de l'appli ne tourne pas pour lui
// — et pas davantage quand sa connexion, coupée puis parquée, est reprise par sa session depuis une adresse qui n'est pas au
// banc pendant que son banc court (elle tournait, et son µ:welcome repartait avec la charge de l'appli). Le banc fini, une
// reprise retrouve le `welcome` de l'appli, comme tout visiteur
import assert from 'node:assert/strict'
import { mjsWs, accountsPackage, accountsAuth } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const SECRET = 'secret-de-test-reprise-au-banc-assez-long'
const IP     = '10.0.0.9'
const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
class TransportAvecAdresse extends MemoryTransport {
  onConnection(handler: Parameters<MemoryTransport['onConnection']>[0]): void {
    super.onConnection((conn) => { (conn.remoteInfo as any).address = conn.remoteInfo.headers?.['x-ip']; handler(conn) })
  }
}

interface Poste { ws: any; trames: any[]; ferme: boolean; envoyer: (o: unknown) => void; brut: (s: string) => void }

async function arriver(transport: MemoryTransport, ip: string, auth?: unknown): Promise<{ poste: Poste; accueil: any }> {
  const ws = transport.connect({ headers: { 'x-ip': ip } })
  const poste: Poste = { ws, trames: [], ferme: false, envoyer: (o) => ws.send(JSON.stringify(o)), brut: (s) => ws.send(s) }
  ws.onmessage = (ev: any) => poste.trames.push(JSON.parse(ev.data))
  ws.onclose   = () => { poste.ferme = true }
  await tick()
  poste.envoyer({ t: 'µ:hello', p: { protocol: 1, auth } })
  return { poste, accueil: await attendre(poste, f => f.t === 'µ:welcome' || f.t === 'µ:denied') }
}

async function attendre(poste: Poste, pred: (f: any) => boolean, ms = 10000): Promise<any> {
  const debut = Date.now()
  for (;;) {
    const i = poste.trames.findIndex(pred)
    if (i >= 0) return poste.trames.splice(i, 1)[0]
    if (Date.now() - debut > ms) throw new Error('trame attendue jamais reçue')
    await tick(1)
  }
}

async function troisExpulsions(transport: MemoryTransport): Promise<void> {
  for (let k = 0; k < 3; k++) {
    const { poste } = await arriver(transport, IP)
    for (let i = 0; i < 51; i++) poste.brut('{pas du json')
    for (let i = 0; i < 300 && !poste.ferme; i++) await tick(2)
    assert.ok(poste.ferme, 'expulsé')
  }
}

async function reprendre(transport: MemoryTransport, ip: string, session: unknown): Promise<any> {
  const ws = transport.connect({ headers: { 'x-ip': ip } })
  const poste: Poste = { ws, trames: [], ferme: false, envoyer: (o) => ws.send(JSON.stringify(o)), brut: (s) => ws.send(s) }
  ws.onmessage = (ev: any) => poste.trames.push(JSON.parse(ev.data))
  await tick()
  poste.envoyer({ t: 'µ:hello', p: { protocol: 1, session } })
  return attendre(poste, f => f.t === 'µ:welcome' || f.t === 'µ:denied')
}

async function demarrer(duree: number): Promise<{ transport: MemoryTransport; app: MjsWsApp; accueils: string[] }> {
  const accueils: string[] = []
  const transport = new TransportAvecAdresse()
  const app = mjsWs({
    transport, heartbeat: 0, auth: accountsAuth(SECRET), ban: { by: 'account', duration: duree }, resume: true, onLog: () => {},
    welcome: (client) => { accueils.push(client.id); return { bonjour: true } },
  })
  app.use(accountsPackage({ secret: SECRET, onLog: () => {} }))
  await app.listen()
  return { transport, app, accueils }
}

// accueilli au banc, puis coupé : sa session est parquée
async function accueilliAuBancPuisCoupe(transport: MemoryTransport, app: MjsWsApp): Promise<{ id: string; session: any }> {
  await troisExpulsions(transport)
  const avant = new Set(Array.from(app.clients).map(c => c.id))
  const { poste, accueil } = await arriver(transport, IP)
  assert.equal(accueil.t, 'µ:welcome', 'accueilli au banc')
  assert.equal(accueil.p.bonjour, undefined, 'µ:welcome sans la charge de l’appli')
  const id = Array.from(app.clients).map(c => c.id).find(i => !avant.has(i))!
  assert.ok(id && accueil.p.session?.id, 'connexion au banc, avec sa session')
  poste.ws.close()
  await tick(30)
  return { id, session: { id: accueil.p.session.id, key: accueil.p.session.key } }
}

describe('MJS-WS — reprise d’une connexion accueillie au banc', function () {
  this.timeout(30000)

  it('reprise depuis une adresse hors banc pendant que son banc court : ni welcome de l’appli, ni sa charge', async () => {
    const { transport, app, accueils } = await demarrer(300000)
    try {
      const { id, session } = await accueilliAuBancPuisCoupe(transport, app)
      const repris = await reprendre(transport, '10.0.0.77', session)
      assert.equal(repris.t, 'µ:welcome')
      assert.equal(repris.p.resumed, true, 'la session est reprise')
      assert.equal(accueils.includes(id), false, 'welcome de l’appli : pas pour une connexion encore au banc, reprise comprise')
      assert.equal(repris.p.bonjour, undefined, 'µ:welcome repris sans la charge de l’appli')
    }
    finally {
      await app.stop()
    }
  })

  it('le banc fini, la reprise retrouve le welcome de l’appli', async () => {
    const { transport, app, accueils } = await demarrer(1500)
    try {
      const { id, session } = await accueilliAuBancPuisCoupe(transport, app)
      await tick(1700)
      const repris = await reprendre(transport, '10.0.0.77', session)
      assert.equal(repris.p.resumed, true, 'la session est reprise')
      assert.equal(accueils.includes(id), true, 'welcome de l’appli après le banc')
      assert.equal(repris.p.bonjour, true)
    }
    finally {
      await app.stop()
    }
  })
})
