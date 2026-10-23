// Proxy de décisions, durcissement `verifyResponse: true` : la signature de la réponse du back doit couvrir la
// signature de la requête à laquelle elle répond. Sans ce lien, un intermédiaire qui a vu passer une réponse
// signée `{ok:true, identity:{id:'alice'}}` la rejoue pour n'importe quel autre hello pendant toute la fenêtre
// anti-rejeu, et s'authentifie comme Alice. Le faux back signe avec createHmac brut (jamais une primitive de
// production importée) : preuve en boîte noire du format documenté.

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { creerAuthProxy } from '../src/mjs-ws/proxy.js'

const SECRET = 'secret-partage-du-back-de-decision'

const hmac = (canonical: string): string => createHmac('sha256', SECRET).update(canonical).digest('hex')

interface Reply { body: string; headers: Record<string, string> }

// `respond` fabrique la réponse d'une requête à partir de sa signature et de son chemin
function startBack(respond: (requestSig: string, path: string) => Reply): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        const reply = respond(String(req.headers['x-mjs-ws-signature']), req.url || '/')
        res.writeHead(200, { 'content-type': 'application/json', ...reply.headers })
        res.end(reply.body)
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({
      url:   `http://127.0.0.1:${(server.address() as AddressInfo).port}/decide`,
      close: () => { server.closeAllConnections(); return new Promise<void>(done => server.close(() => done())) },
    }))
  })
}

// la réponse signée comme le documente le protocole : la signature de la requête, un saut de ligne, le corps
function signedFor(requestSig: string, path: string, json: unknown): Reply {
  const body = JSON.stringify(json)
  const ts   = Math.floor(Date.now() / 1000)
  return { body, headers: { 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-signature': hmac(ts +'.RESPONSE.'+ path +'.'+ requestSig +'\n'+ body) } }
}

// le verdict d'une authentification : l'identité rendue, ou 'refus'
async function verdict(auth: (hello: any, meta: any) => Promise<unknown>, token: string): Promise<unknown> {
  try { return await auth({ protocol: 1, auth: { token } }, {}) }
  catch { return 'refus' }
}

const ALICE = { ok: true, identity: { id: 'alice', role: 'admin' } }

describe('proxy de décisions : verifyResponse lie la réponse à sa requête', () => {
  it('une réponse signée pour cette requête (signature de la requête comprise) est acceptée', async () => {
    const back = await startBack((requestSig, path) => signedFor(requestSig, path, ALICE))
    try {
      const auth = creerAuthProxy({ url: back.url, secret: SECRET, verifyResponse: true }, () => {})
      assert.deepEqual(await verdict(auth, 'jeton-d-alice'), ALICE.identity)
    }
    finally { await back.close() }
  })

  it('une réponse signée sans la signature de la requête, rejouable telle quelle, est refusée', async () => {
    const body = JSON.stringify(ALICE)
    const ts   = Math.floor(Date.now() / 1000)
    const sig  = hmac(ts +'.RESPONSE./decide.'+ body)
    const back = await startBack(() => ({ body, headers: { 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-signature': sig } }))
    try {
      const warnings: string[] = []
      const auth = creerAuthProxy({ url: back.url, secret: SECRET, verifyResponse: true }, (level, message) => { if (level === 'warn') warnings.push(message) })
      assert.equal(await verdict(auth, 'jeton-d-alice'), 'refus')
      assert.equal(await verdict(auth, 'n-importe-quoi'), 'refus', 'la même réponse rejouée pour Mallory')
      assert.equal(warnings.length, 2, JSON.stringify(warnings))
    }
    finally { await back.close() }
  })

  it('la réponse d\'Alice, capturée puis rejouée pour la requête de Mallory, est refusée', async () => {
    let captured: Reply | null = null
    const back = await startBack((requestSig, path) => {
      if (captured) return captured
      captured = signedFor(requestSig, path, ALICE)
      return captured
    })
    try {
      const auth = creerAuthProxy({ url: back.url, secret: SECRET, verifyResponse: true }, () => {})
      assert.deepEqual(await verdict(auth, 'jeton-d-alice'), ALICE.identity, 'la réponse d\'origine, pour Alice')
      assert.equal(await verdict(auth, 'n-importe-quoi'), 'refus', 'la même réponse, rejouée pour une autre requête')
    }
    finally { await back.close() }
  })
})
