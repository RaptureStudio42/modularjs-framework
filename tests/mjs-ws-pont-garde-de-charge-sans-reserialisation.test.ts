// La charge d'une requête du pont (p, value, values) naît toujours d'un JSON.parse : ni Map, ni fonction, ni
// BigInt, ni undefined niché possibles. La garde d'entrée la parcourait pourtant une fois de plus et la
// sérialisait une fois de plus « pour voir », avant la vraie sérialisation à l'envoi (3,4 ms pour un corps de
// 0,75 Mo). Désormais seule la profondeur est bornée ; la charge n'est plus sérialisée avant l'envoi.
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const SECRET = 'secret-de-test-garde-de-charge'
const MARQUE = 'sonde-garde-de-charge'

function signer(methode: string, chemin: string, corps: string, ts: number, nonce: string): string {
  const canonique = ['in', String(ts), methode, chemin, corps, nonce].map(c => c.length +':'+ c).join('')
  return createHmac('sha256', SECRET).update(canonique).digest('hex')
}

async function poster(port: number, chemin: string, corps: unknown): Promise<{ status: number; json: any }> {
  const brut  = JSON.stringify(corps)
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')   // neuf à chaque requête : le pont l'exige par défaut
  const res   = await fetch('http://127.0.0.1:'+ port + chemin, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-nonce': nonce, 'x-mjs-ws-signature': signer('POST', chemin, brut, ts, nonce) },
    body: brut,
  })
  return { status: res.status, json: await res.json() }
}

// une sérialisation comptée : un JSON.stringify appelé depuis le serveur temps réel (src/mjs-ws/), lu sur la pile d'appel. Le reste
// du process ne compte pas : une fenêtre happy-dom laissée par un fichier de tests précédent, où un effet tourne encore, en fait des
// milliers par seconde
const parLeServeur = (): boolean => /[\\/]src[\\/]mjs-ws[\\/]/.test(new Error().stack ?? '')

// compte les JSON.stringify du serveur qui portent la charge elle-même (marquée), pendant `faire`
async function compterSerialisations(faire: () => Promise<void>): Promise<number> {
  const original = JSON.stringify
  let n     = 0
  let total = 0
  ;(JSON as any).stringify = function (valeur: any, ...reste: any[]) {
    if (parLeServeur()) {
      total++
      if (valeur && typeof valeur === 'object' && valeur.marque === MARQUE) n++
    }
    return (original as any).call(JSON, valeur, ...reste)
  }
  try { await faire() }
  finally { (JSON as any).stringify = original }
  assert.ok(total > 0, 'aucune sérialisation du serveur comptée : le compte ne la voit plus')
  return n
}

describe('MJS-WS — pont : garde de charge sans parcours ni sérialisation de trop', function () {
  this.timeout(10000)

  let app: MjsWsApp
  let port = 0

  before(async () => {
    app = mjsWs({
      transport: new MemoryTransport(), heartbeat: 0,
      onLog: (_l, message, meta: any) => { if (meta?.port && /pont universel|universal bridge/.test(message)) port = meta.port },
      bridge: { port: 0, secret: SECRET, rateLimit: false },
    })
    await app.listen()
  })

  after(async () => { await app.stop() })

  it('POST /broadcast : la charge n\'est jamais sérialisée seule par la garde', async () => {
    const charge = { marque: MARQUE, liste: Array.from({ length: 1000 }, (_v, i) => ({ i, texte: 'ligne '+ i })) }
    let reponse: { status: number; json: any } = { status: 0, json: null }
    const n = await compterSerialisations(async () => { reponse = await poster(port, '/broadcast', { type: 'annonce', p: charge }) })
    assert.equal(reponse.status, 200, JSON.stringify(reponse.json))
    assert.equal(n, 0, 'la garde a sérialisé la charge pour la vérifier')
  })

  // le flux garde sa propre vérification à l'entrée (app.stream().add, commune à tous les appelants) : une au plus
  it('POST /stream (add) : le pont n\'ajoute pas sa sérialisation à celle du flux', async () => {
    let reponse: { status: number; json: any } = { status: 0, json: null }
    const n = await compterSerialisations(async () => { reponse = await poster(port, '/stream', { name: 'flux-garde', op: 'add', id: 'e1', value: { marque: MARQUE, x: 1 } }) })
    assert.equal(reponse.status, 200, JSON.stringify(reponse.json))
    assert.ok(n <= 1, 'sérialisations de la valeur avant l\'envoi : '+ n)
  })

  it('la borne de profondeur tient toujours : 65 niveaux → 400', async () => {
    let p: any = 'fond'
    for (let i = 0; i < 65; i++) p = [p]
    const r = await poster(port, '/broadcast', { type: 'annonce', p })
    assert.equal(r.status, 400)
  })
})
