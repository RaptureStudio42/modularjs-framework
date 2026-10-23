// Le contrôle de l'en-tête Host de `mjs dev` (parade au rebinding DNS) n'avait aucune échappatoire :
// un sous-domaine de localhost (`app.localhost`, toujours en boucle locale), le nom de la machine
// (`monpc`, `monpc.local`), un tunnel (`abc.ngrok-free.app`) ou un proxy de développement qui garde
// l'en-tête Host recevaient tous 403, sans réglage pour les ouvrir. Désormais : `*.localhost` et le
// nom de la machine sont acceptés d'office, et `dev.allowedHosts` ouvre d'autres noms (`.domaine`
// pour un domaine et ses sous-domaines, `true` pour tout permettre). Le 403 dit quoi écrire.

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { hostname } from 'node:os'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { StaticServer } from '../src/server/index.js'
import { createDevHostCheck } from '../src/server/hmr.js'
import { findConfig } from '../src/bundler/config.js'

function get(port: number, host: string): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/', method: 'GET', headers: { host } }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('mjs dev — noms sûrs acceptés d\'office, dev.allowedHosts', () => {
  const machine = hostname().toLowerCase()
  const court = machine.split('.')[0]

  it('sous-domaines de localhost et nom de la machine : acceptés, en local comme sur 0.0.0.0', () => {
    for (const verif of [createDevHostCheck('127.0.0.1'), createDevHostCheck('0.0.0.0', ['192.168.1.20'])]) {
      for (const h of ['app.localhost:3939', 'a.b.localhost', `${machine}:3939`, `${court}.local:3939`, 'localhost:3939', '[::1]:3939']) {
        assert.equal(verif(h), true, h)
      }
      for (const h of ['attaquant.example:3939', 'abc.ngrok-free.app', 'localhost.attaquant.example', 'monlocalhost:3939']) {
        assert.equal(verif(h), false, h)
      }
    }
  })

  it('dev.allowedHosts : nom exact, `.domaine` pour ses sous-domaines, `true` pour tout permettre', () => {
    const exact = createDevHostCheck('127.0.0.1', undefined, ['ABC.ngrok-free.app'])
    assert.equal(exact('abc.ngrok-free.app'), true)
    assert.equal(exact('autre.ngrok-free.app'), false)
    const domaine = createDevHostCheck('127.0.0.1', undefined, ['.ngrok-free.app'])
    assert.equal(domaine('abc.ngrok-free.app'), true)
    assert.equal(domaine('ngrok-free.app:443'), true)
    assert.equal(domaine('ngrok-free.app.attaquant.example'), false)
    assert.equal(domaine('attaquant.example'), false)
    const tout = createDevHostCheck('127.0.0.1', undefined, true)
    assert.equal(tout('nimporte.quoi'), true)
  })

  it('serveur : tunnel déclaré servi, hôte étranger refusé avec la ligne à écrire', async function () {
    this.timeout(15000)
    const root = mjsTmp('dev-hote-permis')
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><body>Accueil</body></html>')
    const server = new StaticServer({ rootDir: join(root, 'out'), port: 0, host: '127.0.0.1', projectRoot: root, config: { dev: { allowedHosts: ['abc.ngrok-free.app'] } } as any })
    await server.start()
    try {
      const port = (server.server!.address() as any).port
      assert.equal((await get(port, 'abc.ngrok-free.app')).status, 200)
      assert.equal((await get(port, `app.localhost:${port}`)).status, 200)
      const refus = await get(port, `attaquant.example:${port}`)
      assert.equal(refus.status, 403)
      assert.match(refus.body, /allowedHosts/)
      assert.match(refus.body, /attaquant\.example/)
    } finally {
      await server.stop()
    }
  })

  it('configuration : `true` et une liste de noms admis ; tout le reste refusé avec la forme attendue', () => {
    const essai = (dev: unknown): void => {
      const root = mjsTmp('dev-hote-config')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ dev }))
      findConfig(root)
    }
    assert.doesNotThrow(() => essai({ allowedHosts: true }))
    assert.doesNotThrow(() => essai({ allowedHosts: ['abc.ngrok-free.app', '.exemple.fr', 'monpc.local'] }))
    for (const faux of ['abc.ngrok-free.app', false, [''], ['http://abc.ngrok-free.app'], ['abc.ngrok-free.app:443'], [42], ['a b']]) {
      assert.throws(() => essai({ allowedHosts: faux }), /allowedHosts/, JSON.stringify(faux))
    }
  })
})
