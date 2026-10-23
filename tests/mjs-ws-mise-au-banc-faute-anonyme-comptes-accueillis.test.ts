// core.ts — mise au banc par défaut : un anonyme qui se faisait expulser exprès trois fois faisait refuser son
// adresse à l'arrivée pendant 5 minutes, et avec elle tous les comptes qui partagent cette adresse (réseau mobile,
// école, entreprise). La faute d'un anonyme ne met au banc que les connexions anonymes de son adresse, jugées au
// hello ; un compte de la même adresse reste accueilli. La faute d'un compte ne vise que ce compte (`by: 'account'`
// par défaut) : fermer l'adresse à tous pour un compte (`by: 'both'`, contre le multi-compte) reste au choix de
// l'appli, cf. tests/mjs-ws-mise-au-banc.test.ts.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// transport en mémoire qui pose l'adresse lue dans l'en-tête x-ip (MemoryTransport n'en pose aucune)
class TransportAvecAdresse extends MemoryTransport {
  onConnection(handler: Parameters<MemoryTransport['onConnection']>[0]): void {
    super.onConnection((conn) => { (conn.remoteInfo as any).address = conn.remoteInfo.headers?.['x-ip']; handler(conn) })
  }
}

// débit minimal : le hello prend l'unique jeton, le message suivant est une faute, expulsion aussitôt
const LIMITES_STRICTES = { rate: 1, burst: 1, kickAfter: 0 }

interface Visiteur { ws: any; trames: any[]; fermeture: number | null }

async function arriver(transport: MemoryTransport, ip: string, uid?: string): Promise<Visiteur> {
  const ws          = transport.connect({ url: 'memory://banc', headers: { 'x-ip': ip } })
  const v: Visiteur = { ws, trames: [], fermeture: null }
  ws.onmessage = (ev: any) => v.trames.push(JSON.parse(ev.data))
  ws.onclose   = (ev: any) => { v.fermeture = ev.code }
  await tick()
  if (v.fermeture === null) ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, ...(uid ? { auth: { uid } } : {}) } }))
  await tick(10)
  return v
}

async function seFaireExpulser(transport: MemoryTransport, ip: string, uid?: string): Promise<void> {
  const v = await arriver(transport, ip, uid)
  assert.ok(v.trames.some(f => f.t === 'µ:welcome'), 'accueilli avant la rafale')
  v.ws.send(JSON.stringify({ t: 'x' }))
  v.ws.send(JSON.stringify({ t: 'x' }))
  await tick(10)
  assert.equal(v.fermeture, 1008, 'la rafale vaut une expulsion pour débit')
}

async function demarrer(): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new TransportAvecAdresse()
  // mise au banc PAR DÉFAUT (3 expulsions en 1 min, `by: 'account'`)
  const app = mjsWs({ transport, heartbeat: 0, limits: LIMITES_STRICTES, auth: (hello: any) => (hello.auth?.uid ? { id: hello.auth.uid } : {}), onLog: () => {} })
  await app.listen()
  return { transport, app }
}

describe('MJS-WS — mise au banc par défaut : la faute d’un anonyme ne ferme pas la porte aux comptes de son adresse', () => {
  it('3 expulsions d’un anonyme → un compte de la même adresse est accueilli, un anonyme est refusé au hello', async () => {
    const { transport, app } = await demarrer()
    try {
      for (let k = 0; k < 3; k++) await seFaireExpulser(transport, '10.0.0.9')

      const prof = await arriver(transport, '10.0.0.9', 'prof')
      assert.equal(prof.fermeture, null, 'jamais refusé à l’arrivée')
      assert.ok(prof.trames.some(f => f.t === 'µ:welcome'), 'un compte de la même adresse est accueilli')

      const anonyme = await arriver(transport, '10.0.0.9')
      assert.ok(anonyme.trames.some(f => f.t === 'µ:denied'), 'un anonyme de cette adresse est refusé au hello')
      assert.equal(app.stats().connexions.refuseesBan, 1)

      const ailleurs = await arriver(transport, '10.0.0.10')
      assert.ok(ailleurs.trames.some(f => f.t === 'µ:welcome'), 'une autre adresse n’est pas concernée')
    } finally {
      await app.stop()
    }
  })

  it('3 expulsions d’un compte → ce compte est refusé au hello ; un autre compte de la même adresse est accueilli', async () => {
    const { transport, app } = await demarrer()
    try {
      for (let k = 0; k < 3; k++) await seFaireExpulser(transport, '10.0.0.7', 'tricheur')
      const autreCompte = await arriver(transport, '10.0.0.7', 'autre')
      assert.equal(autreCompte.fermeture, null, 'jamais refusé à l’arrivée')
      assert.ok(autreCompte.trames.some(f => f.t === 'µ:welcome'), 'un autre compte de la même adresse est accueilli')
      const tricheur = await arriver(transport, '10.0.0.7', 'tricheur')
      assert.ok(tricheur.trames.some(f => f.t === 'µ:denied'), 'le compte fautif est refusé au hello')
    } finally {
      await app.stop()
    }
  })
})
