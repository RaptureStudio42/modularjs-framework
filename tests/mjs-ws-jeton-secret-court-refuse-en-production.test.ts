// Secret des jetons : en production (NODE_ENV=production), moins de 32 octets est refusé par signToken, verifyToken et
// jwtAuth, avec le même message que l'avertissement donné une fois en développement ; ce sont les octets qui comptent
import assert from 'node:assert/strict'
import { signToken, verifyToken, jwtAuth } from '../src/mjs-ws/index.js'
import { t } from '../src/messages/index.js'

describe('MJS-WS — secret de jeton court : refusé en production, averti en développement', () => {
  const before = process.env.NODE_ENV
  afterEach(() => {
    if (before === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before
  })

  it('en production, un secret d\'un octet est refusé par signToken, verifyToken et jwtAuth', () => {
    process.env.NODE_ENV = 'production'
    const calls: Array<[string, () => unknown]> = [['signToken', () => signToken({ id: 1 }, 'a')], ['verifyToken', () => verifyToken('a.b.c', 'a')], ['jwtAuth', () => jwtAuth('a')]]
    for (const [fn, call] of calls) assert.throws(call, (err: unknown) => (err as Error).message === t('ws.token.secret-short', { fn, length: 1, min: 32 }))
  })

  it('en production, les octets comptent : 16 « é » (32 octets) passent, 31 octets sont refusés', () => {
    process.env.NODE_ENV = 'production'
    assert.doesNotThrow(() => signToken({ id: 1 }, 'é'.repeat(16)))
    assert.throws(() => signToken({ id: 1 }, 'x'.repeat(31)), (err: unknown) => (err as Error).message === t('ws.token.secret-short', { fn: 'signToken', length: 31, min: 32 }))
  })

  it('en développement, le secret court passe', () => {
    delete process.env.NODE_ENV
    const warn = console.warn
    console.warn = () => {}
    try { assert.doesNotThrow(() => signToken({ id: 1 }, 'a')) }
    finally { console.warn = warn }
  })
})
