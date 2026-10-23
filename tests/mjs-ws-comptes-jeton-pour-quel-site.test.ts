// Comptes de MJS-WS (src/mjs-ws/accounts.ts) : des jetons qui disent pour quel site ils sont faits.
// - accountsPackage({ secret, audience, issuer }) pose `aud` et `iss` dans les jetons qu'il émet ; accountsAuth(secret,
//   { audience, issuer }) les vérifie : création, élévation par reconnexion et rafraîchissement passent.
// - Deux sites qui partagent le même secret : le compte de l'un n'ouvre pas de session chez l'autre, et un jeton signé
//   avec ce secret pour un autre site est refusé dès le hello.
// - Une audience en liste part telle quelle dans `aud` (verifyToken lit une liste) ; un émetteur en liste part par sa
//   première valeur (un `iss` est une seule chaîne).
// - Sans ces options, les jetons ne changent pas : ni `aud` ni `iss`.
// - Une audience ou un émetteur invalide fait lever accountsPackage dès sa construction, avec le message de jwtAuth.
// Même harnais que tests/mjs-ws-accounts.test.ts : vrai client µ.socket sur MemoryTransport.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, jwtAuth } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { signToken } from '../src/mjs-ws/token.js'
import { setMessagesLang } from '../src/messages/index.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'
import type { MjsWsAccountsOptions } from '../src/mjs-ws/accounts.js'
import type { VerifyTokenOpts } from '../src/mjs-ws/token.js'

const clientSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/runtime/mjs_socket.ts'), 'utf8')
const SECRET    = 'secret-test-comptes-pour-quel-site'
const PASSWORD  = 'motdepasse123'
const SITE      = { audience: 'boutique', issuer: 'https://boutique.fr' }

const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const payloadOf = (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(packageOpts: Partial<MjsWsAccountsOptions>, authOpts: VerifyTokenOpts): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET, authOpts), onLog: () => {} })
  app.use(accountsPackage({ secret: SECRET, onLog: () => {}, ...packageOpts } as MjsWsAccountsOptions))
  await app.listen()
  return { transport, app }
}

// connexion sans jeton (invité), ou avec un jeton dès le hello
function connect(transport: MemoryTransport, url: string, token?: string): any {
  const s = makeClient(transport).socket(url, { auth: () => token, reconnect: { enabled: false } })
  s.connect()
  return s
}

// élévation par reconnexion contrôlée — même technique que src/runtime/mjs_accounts.ts (cf. tests/mjs-ws-accounts.test.ts)
function elevate(s: any, token: string): Promise<void> {
  return new Promise(resolve => {
    s.opts.auth = () => token
    s.on('welcome', function onWelcome() { s.off('welcome', onWelcome); resolve() })
    s.close(); s.connect()
  })
}

const identityOf = (app: MjsWsApp): any => (Array.from(app.clients)[0] as any).identity

describe('comptes : des jetons qui disent pour quel site ils sont faits', () => {
  afterEach(() => setMessagesLang('fr'))

  it('accountsPackage pose aud et iss, accountsAuth les accepte : création, élévation par reconnexion, rafraîchissement', async () => {
    const { transport, app } = await startApp(SITE, SITE)
    const s = connect(transport, 'memory://site')
    await tick()
    const created = await s.request('account:create', { name: 'zora', secret: PASSWORD })
    assert.equal(created.ok, true)
    assert.equal(payloadOf(created.token).aud, 'boutique')
    assert.equal(payloadOf(created.token).iss, 'https://boutique.fr')
    await elevate(s, created.token)
    assert.equal(identityOf(app).name, 'zora', 'élevé par la reconnexion')
    const logged = await s.request('account:login', { name: 'zora', secret: PASSWORD })
    assert.equal(payloadOf(logged.token).aud, 'boutique', 'le jeton de la connexion aussi')
    await s.refresh(logged.token)
    assert.equal(s.state, 'open')
    assert.equal(identityOf(app).name, 'zora')
    s.destroy(); await app.stop()
  })

  it('deux sites, un même secret : le compte de l\'un n\'ouvre pas de session chez l\'autre, un jeton signé pour « autre » non plus', async () => {
    const blog     = await startApp({ audience: 'blog' }, { audience: 'blog' })
    const boutique = await startApp({ audience: 'boutique' }, { audience: 'boutique' })
    const s = connect(blog.transport, 'memory://blog')
    await tick()
    const { token } = await s.request('account:create', { name: 'zora', secret: PASSWORD })
    assert.equal(payloadOf(token).aud, 'blog')
    const fromBlog = connect(boutique.transport, 'memory://boutique-1', token)
    await tick()
    assert.notEqual(fromBlog.state, 'open', 'le jeton du blog est refusé par la boutique')
    const forOther = connect(boutique.transport, 'memory://boutique-2', signToken({ id: 'x1', name: 'zora', roles: [], aud: 'autre' }, SECRET, { ttl: 60 }))
    await tick()
    assert.notEqual(forOther.state, 'open', 'un jeton signé pour « autre » est refusé')
    const forShop = connect(boutique.transport, 'memory://boutique-3', signToken({ id: 'x1', name: 'zora', roles: [], aud: 'boutique' }, SECRET, { ttl: 60 }))
    await tick()
    assert.equal(forShop.state, 'open', 'un jeton fait pour la boutique passe')
    s.destroy(); fromBlog.destroy(); forOther.destroy(); forShop.destroy()
    await blog.app.stop(); await boutique.app.stop()
  })

  it('une audience en liste part telle quelle dans aud, un émetteur en liste part par sa première valeur', async () => {
    const { transport, app } = await startApp(
      { audience: ['boutique', 'boutique-admin'], issuer: ['https://boutique.fr', 'https://comptes.boutique.fr'] },
      { audience: 'boutique-admin', issuer: 'https://boutique.fr' },
    )
    const s = connect(transport, 'memory://liste')
    await tick()
    const { token } = await s.request('account:create', { name: 'zora', secret: PASSWORD })
    assert.deepEqual(payloadOf(token).aud, ['boutique', 'boutique-admin'])
    assert.equal(payloadOf(token).iss, 'https://boutique.fr')
    await elevate(s, token)
    assert.equal(identityOf(app).name, 'zora')
    s.destroy(); await app.stop()
  })

  it('sans audience ni issuer, les jetons ne changent pas : ni aud ni iss', async () => {
    const { transport, app } = await startApp({}, {})
    const s = connect(transport, 'memory://sans')
    await tick()
    const { token } = await s.request('account:create', { name: 'zora', secret: PASSWORD })
    assert.deepEqual(Object.keys(payloadOf(token)).sort(), ['exp', 'iat', 'id', 'name', 'roles'])
    await elevate(s, token)
    assert.equal(identityOf(app).name, 'zora')
    s.destroy(); await app.stop()
  })

  it('une audience ou un émetteur invalide fait lever accountsPackage dès sa construction, avec le message de jwtAuth', () => {
    const messageOf = (fn: () => unknown): string => {
      try { fn(); return '' }
      catch (err) { return (err as Error).message }
    }
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      for (const [option, bad] of [['audience', ''], ['audience', []], ['audience', 42], ['issuer', ['']], ['issuer', null]] as const) {
        const fromPackage = messageOf(() => accountsPackage({ secret: SECRET, onLog: () => {}, [option]: bad } as never))
        const fromAuth    = messageOf(() => jwtAuth(SECRET, { [option]: bad } as never))
        assert.ok(fromPackage.includes('accountsPackage'), `${lang} ${option} ${JSON.stringify(bad)} : ${fromPackage}`)
        assert.equal(fromPackage, fromAuth.replace('jwtAuth', 'accountsPackage'))
      }
    }
  })
})
