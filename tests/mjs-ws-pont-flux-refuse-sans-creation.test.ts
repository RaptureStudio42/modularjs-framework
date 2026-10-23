// Pont — `POST /stream` créait le flux AVANT de vérifier la charge : une écriture refusée en 400 (id manquant, valeur
// absente ou non sérialisable) laissait un flux vide dans le registre, que le serveur traitait ensuite comme un flux
// écrit par le pont (refus « accès au flux refusé » au lieu de la réponse d'un flux inconnu). La charge se vérifie
// maintenant d'abord : une écriture refusée ne crée rien.
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-de-test-flux-refuse-du-pont'

function signer(methode: string, chemin: string, corps: string, ts: number, nonce: string): string {
  const canonique = ['in', String(ts), methode, chemin, corps, nonce].map(c => c.length + ':' + c).join('')
  return createHmac('sha256', SECRET).update(canonique).digest('hex')
}

async function poster(port: number, corps: unknown): Promise<number> {
  const brut  = JSON.stringify(corps)
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')   // neuf à chaque requête : le pont l'exige par défaut
  const res   = await fetch('http://127.0.0.1:' + port + '/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-nonce': nonce, 'x-mjs-ws-signature': signer('POST', '/stream', brut, ts, nonce) },
    body: brut,
  })
  await res.json()
  return res.status
}

// ce qu'un client reçoit après un µ:sub-stream : 'reset vide' (flux inconnu) ou 'refus'
async function vu(transport: MemoryTransport, flux: string): Promise<string[]> {
  const ws = transport.connect({ url: 'ws://visiteur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: flux } }))
  await tick(30)
  return trames.filter(f => f.t === flux || f.t === 'µ:error').map(f => f.t === 'µ:error' ? 'refus' : 'reset ' + JSON.stringify(f.p.values))
}

describe('MJS-WS — pont : une écriture de flux refusée ne crée pas le flux', function () {
  this.timeout(10000)

  it('POST /stream refusé en 400 (id manquant, valeur absente, mise à jour qui n’est pas un objet) : le flux reste inconnu', async () => {
    const transport = new MemoryTransport()
    let port = 0
    const app = mjsWs({
      transport, heartbeat: 0, auth: () => ({ id: 'u1' }),
      onLog: (_niveau, message, meta: any) => { if (meta?.port && /pont universel|universal bridge/.test(message)) port = meta.port },
      bridge: { port: 0, secret: SECRET, rateLimit: false },
    })
    await app.listen()
    try {
      assert.equal(await poster(port, { name: 'fantome-1', op: 'add', value: 1 }), 400)
      assert.equal(await poster(port, { name: 'fantome-2', op: 'add', id: 'a' }), 400)
      assert.equal(await poster(port, { name: 'fantome-3', op: 'update', id: 'a', value: 3 }), 400)
      assert.equal(await poster(port, { name: 'fantome-4', op: 'reset', values: [] }), 400)
      for (const flux of ['fantome-1', 'fantome-2', 'fantome-3', 'fantome-4']) {
        assert.deepEqual(await vu(transport, flux), ['reset {}'], `${flux} : aucune trace d’une écriture refusée`)
      }
      // témoin : une écriture valide crée bien le flux (écrit, non déclaré : refusé tant que le code ne le déclare pas)
      assert.equal(await poster(port, { name: 'temoin', op: 'add', id: 'a', value: 1 }), 200)
      assert.deepEqual(await vu(transport, 'temoin'), ['refus'])
    } finally {
      await app.stop()
    }
  })
})
