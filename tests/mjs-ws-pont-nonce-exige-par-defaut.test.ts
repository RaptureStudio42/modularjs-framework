// pont universel (src/mjs-ws/bridge.ts) — le nonce anti-rejeu est exigé par défaut : une requête bien signée mais sans
// en-tête x-mjs-ws-nonce est refusée, avec un message qui dit quoi ajouter ; une requête noncée passe une fois, et une
// seule ; `nonce: false` rend le comportement d'avant (la fenêtre de ± 300 s seule), sans rien de plus au démarrage
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { resolveBridgeOptions } from '../src/mjs-ws/bridge.js'
import { setMessagesLang } from '../src/messages/index.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const SECRET = 'secret-de-test-nonce-par-defaut-1234567890'
const CORPS  = JSON.stringify({ type: 'x' })

const lp         = (champ: string) => champ.length +':'+ champ
const maintenant = () => Math.floor(Date.now() / 1000)

async function demarrer(bridge: MjsWsOptions['bridge']): Promise<{ app: MjsWsApp; port: number; journal: string[] }> {
  const journal: string[] = []
  let port                = 0
  const app               = mjsWs({
    transport: new MemoryTransport(), heartbeat: 0, bridge,
    onLog: (niveau, message, meta: any) => {
      journal.push(niveau +' '+ message)
      if (meta && typeof meta.port === 'number' && /pont universel en écoute|universal bridge listening/.test(message)) port = meta.port
    },
  })
  await app.listen()
  return { app, port, journal }
}

// requête signée à la main, comme la recette de la doc ; `nonce` absent : l'ancienne recette, sans en-tête ni dernier champ
function entetes(ts: number, nonce?: string): Record<string, string> {
  const champs = ['in', String(ts), 'POST', '/broadcast', CORPS]
  if (nonce != null) champs.push(nonce)
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'x-mjs-ws-timestamp': String(ts),
    'x-mjs-ws-signature': createHmac('sha256', SECRET).update(champs.map(lp).join('')).digest('hex'),
  }
  if (nonce != null) h['x-mjs-ws-nonce'] = nonce
  return h
}

async function poster(port: number, h: Record<string, string>): Promise<{ status: number; json: any }> {
  const res = await fetch('http://127.0.0.1:'+ port +'/broadcast', { method: 'POST', headers: h, body: CORPS })
  return { status: res.status, json: await res.json() }
}

describe('MJS-WS — pont universel : nonce anti-rejeu exigé par défaut', function () {
  this.timeout(10000)

  it('options résolues : nonce actif sans rien écrire, coupé seulement par nonce: false', () => {
    assert.equal(resolveBridgeOptions({ secret: SECRET }, 4000).nonce, true)
    assert.equal(resolveBridgeOptions({ secret: SECRET, nonce: true }, 4000).nonce, true)
    assert.equal(resolveBridgeOptions({ secret: SECRET, nonce: false }, 4000).nonce, false)
  })

  it('sans nonce, une requête bien signée est refusée (401) par un message qui dit quoi ajouter', async () => {
    const { app, port, journal } = await demarrer({ port: 0, secret: SECRET })
    try {
      const r = await poster(port, entetes(maintenant()))
      assert.equal(r.status, 401)
      assert.match(r.json.error, /ajoutez l'en-tête x-mjs-ws-nonce/)
      assert.match(r.json.error, /dernier champ de la chaîne signée/)
      assert.ok(journal.some(l => /^info pont universel en écoute sur http:\/\/127\.0\.0\.1:\d+ \(nonce : exigé\)$/.test(l)), journal.join('\n'))
    }
    finally {
      await app.stop()
    }
  })

  it('en anglais, le même refus dit aussi quoi ajouter', async () => {
    setMessagesLang('en')
    try {
      const { app, port } = await demarrer({ port: 0, secret: SECRET })
      try {
        const r = await poster(port, entetes(maintenant()))
        assert.equal(r.status, 401)
        assert.match(r.json.error, /add the x-mjs-ws-nonce header/)
        assert.match(r.json.error, /last field of the signed string/)
      }
      finally {
        await app.stop()
      }
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('avec un nonce neuf, la requête passe ; la même, rejouée, est refusée (nonce-rejoué)', async () => {
    const { app, port } = await demarrer({ port: 0, secret: SECRET })
    try {
      const h        = entetes(maintenant(), randomBytes(16).toString('hex'))
      const premiere = await poster(port, h)
      const rejeu    = await poster(port, h)
      assert.equal(premiere.status, 200)
      assert.deepEqual(premiere.json, { ok: true })
      assert.equal(rejeu.status, 401)
      assert.equal(rejeu.json.error, 'nonce-rejoué')
    }
    finally {
      await app.stop()
    }
  })

  it('nonce: false — la requête sans nonce passe, son rejeu dans la fenêtre aussi, et le démarrage ne dit rien de plus', async () => {
    const { app, port, journal } = await demarrer({ port: 0, secret: SECRET, nonce: false })
    try {
      const h = entetes(maintenant())
      const a = await poster(port, h)
      const b = await poster(port, h)
      assert.equal(a.status, 200)
      assert.equal(b.status, 200)
      assert.ok(journal.some(l => /^info pont universel en écoute sur http:\/\/127\.0\.0\.1:\d+$/.test(l)), journal.join('\n'))
      assert.ok(!journal.some(l => /nonce/i.test(l)), journal.join('\n'))
    }
    finally {
      await app.stop()
    }
  })
})
