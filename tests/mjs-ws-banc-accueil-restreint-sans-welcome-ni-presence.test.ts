// visiteur sans compte d'une adresse au banc, accueilli avec le paquet comptes mais réduit à se connecter ou créer un
// compte : à chaque reconnexion, la fonction `welcome` de l'appli tournait pour lui, il apparaissait dans la présence
// globale de tous et le webhook `connect` partait au back. Rien de cela n'a lieu d'être pour une connexion qui ne peut
// que se connecter à un compte : il n'apparaît plus, et à la fin du banc la connexion rejoint la présence globale et le
// webhook `connect` part (`disconnect` seulement après un `connect`). Un visiteur normal ne voit aucune différence
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mjsWs, accountsPackage, accountsAuth } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const SECRET = 'secret-de-test-accueil-au-banc-assez-long'
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

let numero = 0
async function requete(poste: Poste, t: string, p: unknown): Promise<any> {
  const id = ++numero
  poste.envoyer({ t, p, id })
  return attendre(poste, f => f.t === 'µ:ack' && f.id === id)
}

async function troisExpulsions(transport: MemoryTransport): Promise<void> {
  for (let k = 0; k < 3; k++) {
    const { poste } = await arriver(transport, IP)
    for (let i = 0; i < 51; i++) poste.brut('{pas du json')
    for (let i = 0; i < 300 && !poste.ferme; i++) await tick(2)
    assert.ok(poste.ferme, 'expulsé')
  }
}

interface Banc { transport: MemoryTransport; app: MjsWsApp; accueils: string[]; webhooks: any[]; back: Server }

async function demarrer(duree: number): Promise<Banc> {
  const webhooks: any[] = []
  const back = createServer((req, res) => { let corps = ''; req.on('data', (c) => { corps += c }); req.on('end', () => { webhooks.push(JSON.parse(corps)); res.end('{}') }) })
  await new Promise<void>(r => back.listen(0, '127.0.0.1', () => r()))
  const url       = 'http://127.0.0.1:'+ (back.address() as any).port +'/ws'
  const accueils: string[] = []
  const transport = new TransportAvecAdresse()
  const app = mjsWs({
    transport, heartbeat: 0, auth: accountsAuth(SECRET), ban: { by: 'account', duration: duree }, onLog: () => {}, presence: 'public',
    welcome: (client) => { accueils.push(client.id); return { bonjour: true } },
    bridge: { port: 0, secret: SECRET, webhooks: { url, events: ['connect', 'disconnect'] } },
  })
  app.use(accountsPackage({ secret: SECRET, onLog: () => {} }))
  await app.listen()
  return { transport, app, accueils, webhooks, back }
}

async function arreter(b: Banc): Promise<void> {
  await b.app.stop()
  await new Promise<void>(r => b.back.close(() => r()))
}

// un compte abonné à la présence globale : voit les arrivées
async function temoin(b: Banc): Promise<Poste> {
  const { poste: p0 } = await arriver(b.transport, '10.0.0.50')
  const { p: { token } } = await requete(p0, 'account:create', { name: 'temoin', secret: 'motdepassetemoin' })
  const { poste } = await arriver(b.transport, '10.0.0.51', { token })
  poste.envoyer({ t: 'µ:sub-presence', p: {} })
  await tick(20)
  return poste
}

// visiteurs sans compte : dans la présence, `anon:` suivi de leur id de connexion
const joins = (poste: Poste, id: string) => poste.trames.filter(f => f.t === 'µ:presence' && f.p?.op === 'join' && f.p?.id === 'anon:'+ id).length
const evts  = (b: Banc, ev: string, id: string) => b.webhooks.filter(w => w.event === ev && w.client?.id === id).length

describe('MJS-WS — visiteur accueilli au banc : ni welcome, ni présence globale, ni webhook connect', function () {
  this.timeout(30000)

  it('au banc : µ:welcome reçu, mais aucune trace ; un visiteur normal garde tout', async () => {
    const b = await demarrer(300000)
    try {
      const vu = await temoin(b)
      const { poste: normal, accueil: a0 } = await arriver(b.transport, '10.0.0.60')
      assert.deepEqual(a0.p.bonjour, true, 'visiteur normal : welcome de l’appli')
      await tick(100)
      const idNormal = b.app.clients ? Array.from(b.app.clients).map(c => c.id).find(id => b.accueils.includes(id) && joins(vu, id) === 1) : undefined
      assert.ok(idNormal, 'visiteur normal : welcome, présence globale')
      assert.equal(evts(b, 'connect', idNormal!), 1, 'visiteur normal : webhook connect')
      normal.ws.close()
      await troisExpulsions(b.transport)
      const avant = new Set(Array.from(b.app.clients).map(c => c.id))
      const { poste: auBanc, accueil } = await arriver(b.transport, IP)
      assert.equal(accueil.t, 'µ:welcome', 'accueilli au banc')
      await tick(100)
      const id = Array.from(b.app.clients).map(c => c.id).find(i => !avant.has(i))!
      assert.ok(id, 'connexion au banc trouvée')
      assert.equal(b.accueils.includes(id), false, 'welcome de l’appli : pas pour une connexion au banc')
      assert.equal(accueil.p.bonjour, undefined, 'µ:welcome sans la charge de l’appli')
      assert.equal(joins(vu, id), 0, 'pas dans la présence globale')
      assert.equal(evts(b, 'connect', id), 0, 'pas de webhook connect')
      auBanc.ws.close()
      await tick(100)
      assert.equal(evts(b, 'disconnect', id), 0, 'pas de webhook disconnect sans connect')
    }
    finally {
      await arreter(b)
    }
  })

  it('fin du banc pendant la connexion : présence globale et webhook connect à la trame suivante', async () => {
    const b = await demarrer(1500)
    try {
      const vu = await temoin(b)
      await troisExpulsions(b.transport)
      const avant = new Set(Array.from(b.app.clients).map(c => c.id))
      const { poste: auBanc } = await arriver(b.transport, IP)
      await tick(50)
      const id = Array.from(b.app.clients).map(c => c.id).find(i => !avant.has(i))!
      assert.equal(joins(vu, id), 0, 'au banc : absent')
      await tick(1700)
      auBanc.envoyer({ t: 'µ:ping', p: {} })
      await tick(150)
      assert.equal(joins(vu, id), 1, 'banc fini : présence globale')
      assert.equal(evts(b, 'connect', id), 1, 'banc fini : webhook connect')
      auBanc.ws.close()
      await tick(150)
      assert.equal(evts(b, 'disconnect', id), 1, 'webhook disconnect après le connect')
    }
    finally {
      await arreter(b)
    }
  })
})
