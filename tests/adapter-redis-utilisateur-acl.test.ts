// `redis://utilisateur:motdepasse@hôte` : le nom d'utilisateur (ACL de Redis 6 et plus) était ignoré, AUTH partait avec
// le seul mot de passe, donc au nom de l'utilisateur `default`. AUTH part maintenant avec le nom et le mot de passe ;
// un Redis antérieur à la version 6 (AUTH à un seul argument) est réessayé avec le mot de passe seul, avec un avertissement
import assert from 'node:assert/strict'
import { RedisConnection, RespError, encodeCommand, parseRedisUrl } from '../src/mjs-ws/adapter-redis.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function connexion(opts: Record<string, unknown>, logs: Array<[string, string]>): { cmd: any; ecrits: string[] } {
  const ecrits: string[] = []
  const cmd: any = new RedisConnection({ host: 'x', port: 1, role: 'command', onLog: (niveau: string, message: string) => { logs.push([niveau, message]) }, onConnected: () => {}, ...opts } as any)
  cmd._socket = { write: (data: string) => { ecrits.push(data) }, destroy() {}, on() {} }
  return { cmd, ecrits }
}

describe('adapter-redis — utilisateur ACL de l’URL', () => {
  it('l’URL donne le nom d’utilisateur (décodé) à côté du mot de passe ; sans nom, aucun', () => {
    const avec = parseRedisUrl('redis://alice:s%40cret@h:6380/2')
    assert.equal(avec.username, 'alice')
    assert.equal(avec.password, 's@cret')
    assert.equal(parseRedisUrl('redis://:motdepasse@h').username, undefined)
    assert.equal(parseRedisUrl('redis://h').username, undefined)
  })

  it('AUTH part avec le nom et le mot de passe', async () => {
    const logs: Array<[string, string]> = []
    const { cmd, ecrits } = connexion({ username: 'alice', password: 'secret' }, logs)
    const ping = cmd.send(['PING'])
    void cmd._onSocketConnected()
    assert.equal(ecrits[0], encodeCommand(['AUTH', 'alice', 'secret']))
    cmd._onValue('OK')
    await tick()
    assert.equal(ecrits[1], encodeCommand(['PING']))
    cmd._onValue('PONG')
    assert.equal(await ping, 'PONG')
  })

  it('Redis antérieur à la version 6 : réessai avec le mot de passe seul, et un avertissement', async () => {
    const logs: Array<[string, string]> = []
    const { cmd, ecrits } = connexion({ username: 'alice', password: 'secret' }, logs)
    const ping = cmd.send(['PING'])
    void cmd._onSocketConnected()
    cmd._onValue(new RespError("ERR wrong number of arguments for 'auth' command"))
    await tick()
    assert.equal(ecrits[1], encodeCommand(['AUTH', 'secret']), 'second AUTH, mot de passe seul')
    cmd._onValue('OK')
    await tick()
    assert.equal(ecrits[2], encodeCommand(['PING']))
    cmd._onValue('PONG')
    assert.equal(await ping, 'PONG')
    assert.ok(logs.some(([niveau, message]) => niveau === 'warn' && message.includes('alice')), 'avertissement : ' + JSON.stringify(logs))
  })

  it('nom ou mot de passe refusé (WRONGPASS) : aucun réessai sans le nom', async () => {
    const logs: Array<[string, string]> = []
    const { cmd, ecrits } = connexion({ username: 'alice', password: 'faux' }, logs)
    const ping = cmd.send(['PING']).catch((e: Error) => e)
    void cmd._onSocketConnected()
    cmd._onValue(new RespError('WRONGPASS invalid username-password pair or user is disabled.'))
    await tick()
    assert.equal(ecrits.length, 1, 'un seul AUTH')
    assert.ok((await ping) instanceof Error, 'la commande en attente est rejetée')
  })
})
