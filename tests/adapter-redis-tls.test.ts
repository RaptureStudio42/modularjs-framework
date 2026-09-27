// adapter-redis.ts — rediss:// était accepté au parsing puis le "s" se perdait : aucune info TLS
// ne survivait, le seul transport câblé était net.connect (texte en clair, MÊME sous rediss://).
// parseRedisUrl distingue désormais le schéma (tls: boolean) ; planConnect (pur) décide net vs tls
// et pose systématiquement servername = hôte ; RedisConnection.connect() ouvre réellement un socket
// TLS (node:tls) sous tls:true, jamais un vrai handshake ici (aucun serveur réel dans ce test) — la
// preuve porte sur le PLAN calculé et le connecteur INJECTÉ (même patron que accounts.ts::genId),
// jamais sur un socket réseau réel.
import assert from 'node:assert/strict'
import { parseRedisUrl, planConnect, RedisConnection, RedisAdapter } from '../src/mjs-ws/adapter-redis.js'
import type { RedisConnectPlan } from '../src/mjs-ws/adapter-redis.js'

describe('adapter-redis — parseRedisUrl distingue rediss:// de redis://', () => {
  it('rediss:// → tls:true ; redis:// → tls:false — plus aucune information perdue au parsing', () => {
    const withTls    = parseRedisUrl('rediss://user:pw@exemple.local:6390/2')
    const withoutTls = parseRedisUrl('redis://user:pw@exemple.local:6390/2')
    assert.equal(withTls.tls, true)
    assert.equal(withoutTls.tls, false)
    assert.deepEqual({ ...withTls, tls: undefined }, { ...withoutTls, tls: undefined }, 'seul le champ tls diffère, le reste du parsing est identique')
  })
})

describe('adapter-redis — planConnect (pur, aucun I/O)', () => {
  it('sans tls → net en clair, aucun servername ajouté', () => {
    assert.deepEqual(planConnect('exemple.local', 6390, undefined), { secure: false, options: { host: 'exemple.local', port: 6390 } })
  })

  it('tls: true → secure, servername = hôte, aucune option supplémentaire', () => {
    assert.deepEqual(planConnect('exemple.local', 6390, true), { secure: true, options: { host: 'exemple.local', port: 6390, servername: 'exemple.local' } })
  })

  it('tls: {…options} → options transmises telles quelles, servername TOUJOURS = hôte', () => {
    const plan = planConnect('exemple.local', 6390, { rejectUnauthorized: false, ca: 'xyz' })
    assert.deepEqual(plan, { secure: true, options: { rejectUnauthorized: false, ca: 'xyz', host: 'exemple.local', port: 6390, servername: 'exemple.local' } })
  })

  it('servername JAMAIS écrasable par une option tls qui tenterait de le redéfinir', () => {
    const plan = planConnect('exemple.local', 6390, { servername: 'attaquant.example' } as any)
    assert.equal(plan.options.servername, 'exemple.local', 'identité vérifiée = TOUJOURS l\'hôte de l\'URL, jamais une option transmise')
  })
})

describe('adapter-redis — RedisConnection.connect() choisit le bon connecteur (injection, sans socket réel)', () => {
  it('tls actif → dial() reçoit un plan secure=true, écoute "secureConnect" (jamais "connect")', () => {
    const plans: RedisConnectPlan[] = []
    const events: string[] = []
    const fakeSocket: any = { write() {}, destroy() {}, on: (ev: string) => { events.push(ev) } }
    const cmd = new RedisConnection({
      host: 'exemple.local', port: 6390, tls: true, role: 'command', onLog: () => {}, onConnected: () => {},
      dial: (plan) => { plans.push(plan); return fakeSocket },
    } as any)

    cmd.connect()
    assert.equal(plans.length, 1)
    assert.equal(plans[0].secure, true)
    assert.deepEqual(plans[0].options, { host: 'exemple.local', port: 6390, servername: 'exemple.local' })
    assert.ok(events.includes('secureConnect'), 'écoute bien la fin de la poignée de main TLS')
    assert.ok(!events.includes('connect'), 'jamais l\'event TCP nu — enverrait AUTH avant chiffrement')
  })

  it('sans tls → dial() reçoit un plan secure=false, écoute "connect" (comportement historique)', () => {
    const plans: RedisConnectPlan[] = []
    const events: string[] = []
    const fakeSocket: any = { write() {}, destroy() {}, on: (ev: string) => { events.push(ev) } }
    const cmd = new RedisConnection({
      host: 'exemple.local', port: 6390, role: 'command', onLog: () => {}, onConnected: () => {},
      dial: (plan) => { plans.push(plan); return fakeSocket },
    } as any)

    cmd.connect()
    assert.equal(plans[0].secure, false)
    assert.ok(events.includes('connect'))
    assert.ok(!events.includes('secureConnect'))
  })
})

describe('adapter-redis — RedisAdapter transmet rediss:// + tlsOptions à ses deux connexions', () => {
  it('url rediss:// sans tlsOptions → tls:true nu sur _cmd/_sub', () => {
    const adapter = new RedisAdapter({ url: 'rediss://exemple.local:6390', onLog: () => {} })
    assert.equal((adapter as any)._cmd._opts.tls, true)
    assert.equal((adapter as any)._sub._opts.tls, true)
  })

  it('url rediss:// + tlsOptions → objet transmis tel quel (jamais pour une URL redis:// en clair)', () => {
    const tlsOptions = { rejectUnauthorized: false }
    const secure = new RedisAdapter({ url: 'rediss://exemple.local:6390', tlsOptions, onLog: () => {} })
    assert.equal((secure as any)._cmd._opts.tls, tlsOptions)

    const clair = new RedisAdapter({ url: 'redis://exemple.local:6390', tlsOptions, onLog: () => {} })
    assert.equal((clair as any)._cmd._opts.tls, undefined, 'tlsOptions ignoré sous redis:// — jamais de TLS sans rediss://')
  })
})
