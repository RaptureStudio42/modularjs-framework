// Mise au banc — un client EXPULSÉ pour abus (débit, messages invalides, file pleine, charge trop
// lourde) revenait aussitôt : nouvelle connexion, compteurs neufs, seul le plafond par IP le
// freinait. Au-delà de `ban.after` expulsions en `ban.within` ms, sa cible est refusée
// `ban.duration` ms. `ban.by` choisit la cible : 'account' (le compte ; sans compte, l'IP), 'ip',
// ou 'both' (le compte ET son IP — contre le multi-compte). Un silence (chien de garde) ou un
// réseau lent ne comptent jamais. Défaut ACTIF : 3 expulsions en 1 min → 5 min, par compte et IP.
//
// MemoryTransport (aucune IP) pour le compte ; socket RÉEL en boucle locale (127.0.0.1) pour l'IP,
// même technique que tests/mjs-ws-connection-cap.test.ts.
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsWs, DEFAULT_BAN, resolveBanOption } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// plage propre à ce fichier (cf. le commentaire de randomPort dans mjs-ws-connection-cap.test.ts)
function randomPort(): number { return 60000 + Math.floor(Math.random() * 4000) }

// débit minimal : le hello prend l'unique jeton, le message suivant est une faute, expulsion aussitôt
const LIMITES_STRICTES = { rate: 1, burst: 1, kickAfter: 0 }

async function startApp(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, limits: LIMITES_STRICTES, auth: (hello: any) => (hello.auth?.uid ? { id: hello.auth.uid } : {}), onLog: () => {}, ...opts })
  await app.listen()
  return { transport, app }
}

async function rawHello(transport: MemoryTransport, uid?: string): Promise<{ ws: any; frames: any[]; fermeture: Promise<number> }> {
  const ws = transport.connect({ url: 'memory://banc' })
  const frames: any[] = []
  const fermeture = new Promise<number>(r => { ws.onclose = (ev: any) => r(ev.code) })
  ws.onmessage = (ev: any) => frames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, ...(uid ? { auth: { uid } } : {}) } }))
  await tick()
  return { ws, frames, fermeture }
}

// un hello accueilli puis une rafale : expulsion pour débit (code 1008)
async function seFaireExpulser(transport: MemoryTransport, uid?: string): Promise<void> {
  const c = await rawHello(transport, uid)
  assert.ok(c.frames.some(f => f.t === 'µ:welcome'), 'le hello doit être accueilli avant la rafale')
  c.ws.send(JSON.stringify({ t: 'x' }))
  c.ws.send(JSON.stringify({ t: 'x' }))
  assert.equal(await c.fermeture, 1008, 'la rafale doit valoir une expulsion pour débit')
  await tick()
}

// --- socket réel (IP 127.0.0.1) ---------------------------------------------------------------

function connectReal(port: number): { ws: WebSocket; ouverte: Promise<void>; fermeture: Promise<{ code: number; raison: string }> } {
  const ws        = new WebSocket(`ws://127.0.0.1:${port}/`)
  const ouverte   = new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
  const fermeture = new Promise<{ code: number; raison: string }>(r => ws.once('close', (code: number, raison: Buffer) => r({ code, raison: String(raison) })))
  return { ws, ouverte, fermeture }
}

async function expulsionReelle(port: number): Promise<void> {
  const c = connectReal(port)
  await c.ouverte
  c.ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  c.ws.send(JSON.stringify({ t: 'x' }))
  c.ws.send(JSON.stringify({ t: 'x' }))
  assert.equal((await c.fermeture).code, 1008)
  await tick(50)   // laisse cleanupClient tourner côté serveur
}

// ============================================================================================

describe('MJS-WS — mise au banc : résolution de l’option', () => {
  it('défaut ACTIF : 3 expulsions en 1 min → 5 min de refus, par compte et par IP', () => {
    assert.deepEqual(DEFAULT_BAN, { after: 3, within: 60000, duration: 300000, by: 'both' })
    assert.deepEqual(resolveBanOption(undefined), DEFAULT_BAN)
    assert.deepEqual(resolveBanOption(true), DEFAULT_BAN)
  })

  it('`false` désactive ; un objet partiel complète les défauts', () => {
    assert.equal(resolveBanOption(false), null)
    assert.deepEqual(resolveBanOption({ by: 'ip', duration: 1000 }), { after: 3, within: 60000, duration: 1000, by: 'ip' })
  })

  it('valeur fausse = erreur claire au démarrage, jamais un réglage ignoré', () => {
    assert.throws(() => resolveBanOption({ by: 'compte' as any }), /ban\.by/)
    assert.throws(() => resolveBanOption({ after: 0 }), /ban\.after/)
    assert.throws(() => resolveBanOption({ within: -5 }), /ban\.within/)
    assert.throws(() => resolveBanOption({ duration: 1.5 }), /ban\.duration/)
    assert.throws(() => mjsWs({ transport: new MemoryTransport(), ban: { by: 'x' as any } }), /ban\.by/)
  })
})

describe('MJS-WS — mise au banc par compte', () => {
  it('2 expulsions du même compte → son hello suivant est refusé (µ:denied), un autre compte passe', async () => {
    const { transport, app } = await startApp({ ban: { after: 2, by: 'account' } })
    try {
      await seFaireExpulser(transport, 'u1')
      await seFaireExpulser(transport, 'u1')

      const refuse = await rawHello(transport, 'u1')
      const denied = refuse.frames.find(f => f.t === 'µ:denied')
      assert.ok(denied, 'le compte au banc doit recevoir un µ:denied')
      assert.match(denied.p.message, /banc|banned/i)
      assert.ok(!refuse.frames.some(f => f.t === 'µ:welcome'), 'jamais accueilli')

      const autre = await rawHello(transport, 'u2')
      assert.ok(autre.frames.some(f => f.t === 'µ:welcome'), 'un autre compte n’est pas concerné')
      autre.ws.close()

      const s = app.stats()
      assert.equal(s.garde.misesAuBanc, 1)
      assert.equal(s.connexions.refuseesBan, 1)
    } finally {
      await app.stop()
    }
  })

  it('un seul abus ne suffit pas : sous le seuil, le compte revient normalement', async () => {
    const { transport, app } = await startApp({ ban: { after: 2, by: 'account' } })
    try {
      await seFaireExpulser(transport, 'u1')
      const retour = await rawHello(transport, 'u1')
      assert.ok(retour.frames.some(f => f.t === 'µ:welcome'))
      assert.equal(app.stats().garde.misesAuBanc, 0)
      retour.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('le refus prend fin avec sa durée', async () => {
    const { transport, app } = await startApp({ ban: { after: 1, duration: 150, by: 'account' } })
    try {
      await seFaireExpulser(transport, 'u1')
      const pendant = await rawHello(transport, 'u1')
      assert.ok(pendant.frames.some(f => f.t === 'µ:denied'), 'au banc juste après')
      await tick(200)
      const apres = await rawHello(transport, 'u1')
      assert.ok(apres.frames.some(f => f.t === 'µ:welcome'), 'accueilli une fois la durée écoulée')
      apres.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('la reprise de session ne contourne pas le banc', async () => {
    const { transport, app } = await startApp({ resume: true, ban: { after: 1, by: 'account' } })
    try {
      const c = await rawHello(transport, 'u1')
      const session = c.frames.find(f => f.t === 'µ:welcome')?.p?.session
      assert.ok(session, 'la reprise doit émettre une session')
      c.ws.send(JSON.stringify({ t: 'x' }))
      c.ws.send(JSON.stringify({ t: 'x' }))
      assert.equal(await c.fermeture, 1008)
      await tick()

      const ws = transport.connect({ url: 'memory://banc' })
      const frames: any[] = []
      ws.onmessage = (ev: any) => frames.push(JSON.parse(ev.data))
      await tick()
      ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { uid: 'u1' }, session } }))
      await tick()
      assert.ok(frames.some(f => f.t === 'µ:denied'), 'une reprise d’un compte au banc est refusée comme un hello frais')
      assert.ok(!frames.some(f => f.t === 'µ:welcome'))
    } finally {
      await app.stop()
    }
  })

  it('un silence (chien de garde) n’est pas un abus : jamais de banc', async () => {
    const { transport, app } = await startApp({ heartbeat: 20, ban: { after: 1, by: 'account' } })
    try {
      for (let i = 0; i < 3; i++) {
        const c = await rawHello(transport, 'u1')
        assert.ok(c.frames.some(f => f.t === 'µ:welcome'), `hello nº${i + 1} accueilli`)
        assert.equal(await c.fermeture, 4000, 'expulsé pour silence')
        await tick()
      }
      assert.equal(app.stats().garde.misesAuBanc, 0)
    } finally {
      await app.stop()
    }
  })

  it('`ban: false` : aucune mise au banc, quel que soit le nombre d’expulsions', async () => {
    const { transport, app } = await startApp({ ban: false })
    try {
      for (let i = 0; i < 4; i++) await seFaireExpulser(transport, 'u1')
      const retour = await rawHello(transport, 'u1')
      assert.ok(retour.frames.some(f => f.t === 'µ:welcome'))
      retour.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('défaut ACTIF sans rien régler : 3 expulsions → le compte est refusé', async () => {
    const { transport, app } = await startApp()
    try {
      for (let i = 0; i < 3; i++) await seFaireExpulser(transport, 'u1')
      const refuse = await rawHello(transport, 'u1')
      assert.ok(refuse.frames.some(f => f.t === 'µ:denied'))
    } finally {
      await app.stop()
    }
  })

  it('sans compte ni IP connue (transport en mémoire, identité anonyme) : rien à mettre au banc', async () => {
    const { transport, app } = await startApp({ ban: { after: 1, by: 'both' } })
    try {
      await seFaireExpulser(transport)
      const retour = await rawHello(transport)
      assert.ok(retour.frames.some(f => f.t === 'µ:welcome'))
      assert.equal(app.stats().garde.misesAuBanc, 0)
      retour.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('mémoire bornée : fautes et refus expirés sont oubliés', async () => {
    const { transport, app } = await startApp({ ban: { after: 2, within: 100, duration: 100, by: 'account' } })
    try {
      await seFaireExpulser(transport, 'u1')                       // une faute, sous le seuil
      await seFaireExpulser(transport, 'u2')
      await seFaireExpulser(transport, 'u2')                       // u2 au banc
      assert.deepEqual((app as any)._banc(), { fautes: 1, bannis: 1 })
      await tick(150)
      const c = await rawHello(transport, 'u3')                    // toute nouvelle arrivée balaie l'expiré
      assert.deepEqual((app as any)._banc(), { fautes: 0, bannis: 0 })
      c.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('plusieurs processus : un banc prononcé sur l’un est appliqué par les autres', async () => {
    const bus = createMemoryAdapterBus()
    const a = await startApp({ adapter: new MemoryAdapter({ bus }), ban: { after: 1, by: 'account' } })
    const b = await startApp({ adapter: new MemoryAdapter({ bus }), ban: { after: 1, by: 'account' } })
    try {
      await seFaireExpulser(a.transport, 'u1')
      await tick(10)
      const refuse = await rawHello(b.transport, 'u1')
      assert.ok(refuse.frames.some(f => f.t === 'µ:denied'), 'le 2e processus refuse aussi le compte au banc')
    } finally {
      await a.app.stop()
      await b.app.stop()
    }
  })
})

describe('MJS-WS — mise au banc par IP (socket réel, 127.0.0.1)', function () {
  this.timeout(10000)

  it('by: \'ip\' — 2 expulsions depuis l’IP → la connexion suivante est refusée dès l’arrivée (1008)', async () => {
    const port = randomPort()
    const app  = mjsWs({ transport: 'ws', port, host: '127.0.0.1', limits: LIMITES_STRICTES, ban: { after: 2, by: 'ip' }, onLog: () => {} })
    await app.listen()
    try {
      await expulsionReelle(port)
      await expulsionReelle(port)
      const refusee = connectReal(port)
      const { code, raison } = await refusee.fermeture
      assert.equal(code, 1008, 'refus à l’admission, avant tout hello')
      assert.match(raison, /banni|banned/i)
      assert.equal(app.stats().connexions.refuseesBan, 1)
    } finally {
      await app.stop()
    }
  })

  it('une trame trop lourde coupée par le transport lui-même (1009) compte comme un abus', async () => {
    const port = randomPort()
    const app  = mjsWs({ transport: 'ws', port, host: '127.0.0.1', limits: { maxPayload: 100 }, ban: { after: 2, by: 'ip' }, onLog: () => {} })
    await app.listen()
    try {
      for (let i = 0; i < 2; i++) {
        const c = connectReal(port)
        await c.ouverte
        c.ws.send('x'.repeat(500))
        assert.equal((await c.fermeture).code, 1009, 'trame coupée par la bibliothèque WebSocket')
        await tick(50)
      }
      const refusee = connectReal(port)
      assert.equal((await refusee.fermeture).code, 1008, 'l’IP est au banc après 2 trames trop lourdes')
      assert.equal(app.stats().garde.misesAuBanc, 1)
    } finally {
      await app.stop()
    }
  })

  it('by: \'account\' — une IP mise au banc pour un anonyme ne ferme pas la porte aux comptes de cette IP', async () => {
    const port = randomPort()
    const app  = mjsWs({ transport: 'ws', port, host: '127.0.0.1', limits: LIMITES_STRICTES, auth: (hello: any) => (hello.auth?.uid ? { id: hello.auth.uid } : {}), ban: { after: 2, by: 'account' }, onLog: () => {} })
    await app.listen()
    try {
      await expulsionReelle(port)
      await expulsionReelle(port)

      const anonyme = connectReal(port)
      const tramesAnonyme: any[] = []
      anonyme.ws.on('message', (d: Buffer) => tramesAnonyme.push(JSON.parse(String(d))))
      await anonyme.ouverte
      anonyme.ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      await anonyme.fermeture
      assert.ok(tramesAnonyme.some(f => f.t === 'µ:denied'), 'un anonyme de cette IP est refusé au hello')

      const compte = connectReal(port)
      const tramesCompte: any[] = []
      compte.ws.on('message', (d: Buffer) => tramesCompte.push(JSON.parse(String(d))))
      await compte.ouverte
      compte.ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { uid: 'u9' } } }))
      await tick(100)
      assert.ok(tramesCompte.some(f => f.t === 'µ:welcome'), 'un compte de la même IP est accueilli')
      compte.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('by: \'both\' — un compte expulsé met aussi son IP au banc (contre le multi-compte)', async () => {
    const port = randomPort()
    const app  = mjsWs({ transport: 'ws', port, host: '127.0.0.1', limits: LIMITES_STRICTES, auth: (hello: any) => (hello.auth?.uid ? { id: hello.auth.uid } : {}), ban: { after: 1, by: 'both' }, onLog: () => {} })
    await app.listen()
    try {
      const c = connectReal(port)
      await c.ouverte
      c.ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { uid: 'u1' } } }))
      await tick(100)
      c.ws.send(JSON.stringify({ t: 'x' }))
      c.ws.send(JSON.stringify({ t: 'x' }))
      assert.equal((await c.fermeture).code, 1008)
      await tick(50)

      const autreCompte = connectReal(port)
      assert.equal((await autreCompte.fermeture).code, 1008, 'toute nouvelle connexion de cette IP est refusée, même pour un autre compte')
    } finally {
      await app.stop()
    }
  })
})
