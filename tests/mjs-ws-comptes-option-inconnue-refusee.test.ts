// Comptes de MJS-WS (src/mjs-ws/accounts.ts) : une clé inconnue dans les options d'accountsPackage est refusée dès la
// construction, comme pour jwtAuth.
// - `accountsPackage({ secret, audiance: 'boutique' })` lève, avec la plus proche en suggestion (`audience`) et la liste
//   des options valides, en français puis en anglais : sans ce refus, ses jetons partaient sans `aud`, et
//   accountsAuth(secret, { audience }) refusait ensuite chaque élévation sans un mot au journal.
// - Les autres fautes de frappe aussi, `secret` compris ; une clé sans voisine proche donne seulement la liste ; une clé
//   mal écrite reste refusée même sans valeur.
// - Rien de valable n'est refusé : les onze options du paquet passent ensemble et servent toutes, et la liste des options
//   valides est exactement celle des clés que le paquet lit dans son code.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { setMessagesLang } from '../src/messages/index.js'
import { connecter, requete } from './helpers/comptes-brut.js'

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECRET = 'secret-test-comptes-option-inconnue'
const SITE   = { audience: 'boutique', issuer: 'https://boutique.fr' }

const payloadOf = (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))

// message de l'erreur levée par `fn`, '' si rien n'est levé
function messageOf(fn: () => unknown): string {
  try { fn(); return '' }
  catch (err) { return (err as Error).message }
}

// options valides annoncées par le message d'une clé inconnue, en français ou en anglais
function knownOf(message: string): string[] {
  const m = /(?:Options valides :|Valid options:) (.+)$/m.exec(message)
  return m ? m[1].split(', ') : []
}

describe('comptes : une clé inconnue d\'accountsPackage est refusée dès la construction', () => {
  afterEach(() => setMessagesLang('fr'))

  it('audiance : refusée, avec la plus proche en suggestion et la liste des options valides, en français puis en anglais', () => {
    const texts: Record<string, string> = {}
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      const message = messageOf(() => accountsPackage({ secret: SECRET, audiance: 'boutique', onLog: () => {} } as never))
      assert.ok(message.includes('accountsPackage'), `${lang} : ${message}`)
      assert.ok(message.includes('\'audiance\''), `${lang} : ${message}`)
      assert.match(message, lang === 'fr' ? /vouliez-vous dire 'audience' \?/ : /did you mean 'audience'\?/)
      assert.ok(knownOf(message).includes('audience'), `${lang} : ${message}`)
      texts[lang] = message
    }
    assert.notEqual(texts.fr, texts.en)
  })

  it('les autres fautes de frappe aussi, secret compris ; sans valeur, une clé mal écrite reste refusée', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ secrte: SECRET }, 'secret'],
      [{ secret: SECRET, persit: new MemoryAccountsPersistAdapter() }, 'persist'],
      [{ secret: SECRET, tll: 3600 }, 'ttl'],
      [{ secret: SECRET, issuers: 'https://boutique.fr' }, 'issuer'],
      [{ secret: SECRET, role: () => [] }, 'roles'],
      [{ secret: SECRET, bruteforce: { capacity: 3 } }, 'bruteForce'],
      [{ secret: SECRET, createPerIP: { capacity: 3 } }, 'createPerIp'],
      [{ secret: SECRET, nameCheckPerIP: { capacity: 3 } }, 'nameCheckPerIp'],
      [{ secret: SECRET, maxAcounts: 10 }, 'maxAccounts'],
      [{ secret: SECRET, onlog: () => {} }, 'onLog'],
      [{ secret: SECRET, audiance: undefined }, 'audience']
    ]
    for (const [opts, suggestion] of cases) {
      const key     = Object.keys(opts).find(k => k !== 'secret') ?? 'secrte'
      const message = messageOf(() => accountsPackage({ onLog: () => {}, ...opts } as never))
      assert.ok(message.includes('\''+ key +'\''), `${key} : ${message}`)
      assert.ok(message.includes('vouliez-vous dire \''+ suggestion +'\' ?'), `${key} : ${message}`)
    }
  })

  it('une clé sans voisine proche donne seulement la liste des options valides', () => {
    for (const key of ['maxComptes', 'leeway']) {
      const message = messageOf(() => accountsPackage({ secret: SECRET, onLog: () => {}, [key]: 10 } as never))
      assert.ok(message.includes('\''+ key +'\''), `${key} : ${message}`)
      assert.ok(!message.includes('vouliez-vous dire'), `${key} : ${message}`)
      assert.ok(knownOf(message).length > 0, `${key} : ${message}`)
    }
  })

  it('le secret absent ou vide reste refusé par son propre message', () => {
    assert.throws(() => accountsPackage({} as never), /opts\.secret manquant/)
    assert.throws(() => accountsPackage({ secret: '' } as never), /opts\.secret manquant/)
    assert.throws(() => accountsPackage(undefined as never), /opts\.secret manquant/)
  })
})

describe('comptes : rien de valable n\'est refusé', () => {
  it('les onze options du paquet passent ensemble, et servent : le jeton émis porte le site, l\'émetteur, les rôles et la durée', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET, SITE), onLog: () => {} })
    app.use(accountsPackage({
      secret: SECRET,
      persist: new MemoryAccountsPersistAdapter(),
      ttl: 3600,
      audience: SITE.audience,
      issuer: SITE.issuer,
      roles: () => ['membre'],
      bruteForce: { capacity: 5, windowMs: 60000 },
      createPerIp: { capacity: 3, windowMs: 60000 },
      nameCheckPerIp: { capacity: 10, windowMs: 60000 },
      maxAccounts: 10,
      onLog: () => {}
    }))
    await app.listen()
    try {
      const c     = await connecter(transport)
      const ack   = await requete(c, 'account:create', { name: 'zora', secret: 'motdepasse123' })
      assert.equal(ack.e, undefined, JSON.stringify(ack))
      const claims = payloadOf(ack.p.token)
      assert.equal(claims.aud, 'boutique')
      assert.equal(claims.iss, 'https://boutique.fr')
      assert.deepEqual(claims.roles, ['membre'])
      assert.equal((claims.exp as number) - (claims.iat as number), 3600)
    } finally {
      await app.stop()
    }
  })

  it('la liste des options valides est celle des clés que le paquet lit dans son code, ni plus ni moins', () => {
    const source = readFileSync(join(ROOT, 'src/mjs-ws/accounts.ts'), 'utf8')
    const start  = source.indexOf('export function accountsPackage(')
    assert.ok(start > 0, 'accountsPackage introuvable dans accounts.ts')
    const body   = source.slice(start, source.indexOf('\n}\n', start) + 2)
    const read   = new Set([...body.matchAll(/\bopts\??\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))
    assert.doesNotMatch(body, /\}\s*=\s*opts\b/, 'aucune lecture par déstructuration, que ce relevé ne verrait pas')
    assert.ok(read.has('secret') && read.has('maxAccounts'), 'le relevé voit les lectures du paquet : '+ [...read].join(', '))
    const known  = knownOf(messageOf(() => accountsPackage({ secret: SECRET, inconnue: 1, onLog: () => {} } as never)))
    assert.deepEqual([...known].sort(), [...read].sort())
  })
})
