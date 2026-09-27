// server/index.ts — `StaticServer.stop()` : arrêt en douceur (les envois en cours vont au bout)
// et sûr face à des appels répétés. Deux arrêts concurrents (double Ctrl+C, SIGINT puis SIGTERM)
// partagent le même arrêt : aucun des deux ne reste en attente pour toujours.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { StaticServer } from '../src/server/index.js'

const TAILLE = 32 * 1024 * 1024
const pause  = (ms: number) => new Promise(r => setTimeout(r, ms))

async function serveurAvecGrosFichier(prefixe: string): Promise<{ serveur: StaticServer; port: number }> {
  const root = mjsTmp(prefixe)
  writeFileSync(join(root, 'gros.bin'), Buffer.alloc(TAILLE, 7))
  const port    = 20000 + Math.floor(Math.random() * 10000)
  const serveur = new StaticServer({ rootDir: join(root, 'out'), projectRoot: root, port })
  await serveur.start()
  return { serveur, port }
}

describe('StaticServer.stop() — envois en cours et appels répétés', function () {
  this.timeout(20000)

  it('deux stop() concurrents pendant un envoi en cours : les deux se terminent une fois l’envoi fini, fichier reçu en entier', async () => {
    const { serveur, port } = await serveurAvecGrosFichier('stop-concurrent')
    let recu = 0
    const sock    = connect(port, '127.0.0.1')
    const premier = new Promise<void>(r => sock.once('data', () => r()))
    const fin     = new Promise<void>(r => sock.on('close', () => r()))
    sock.on('data', (d: Buffer) => { recu += d.length })
    sock.on('error', () => {})
    sock.write(`GET /gros.bin HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)
    await premier
    sock.pause()

    const a = serveur.stop().then(() => 'A')
    const b = serveur.stop().then(() => 'B')
    await pause(200)
    sock.resume()
    const verdict = await Promise.race([Promise.all([a, b]), pause(10000).then(() => 'bloqué')])
    await fin
    assert.deepEqual(verdict, ['A', 'B'], 'les deux arrêts doivent se terminer')
    assert.ok(recu > TAILLE, `fichier reçu en entier attendu, ${recu} octets`)
  })

  it('stop() rappelé après un arrêt complet se termine aussitôt', async () => {
    const { serveur } = await serveurAvecGrosFichier('stop-repete')
    await serveur.stop()
    const verdict = await Promise.race([serveur.stop().then(() => 'fini'), pause(2000).then(() => 'bloqué')])
    assert.equal(verdict, 'fini')
  })
})
