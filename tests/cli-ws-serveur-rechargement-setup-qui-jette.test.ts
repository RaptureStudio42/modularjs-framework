// `mjs ws` / `mjs serveur` en rechargement à chaud : l'ancien serveur était arrêté AVANT le
// `setup()` du nouveau. Un fichier d'entrée remplacé dont le `setup()` jette (variable
// d'environnement manquante, faute de frappe) laissait le processus vivant sans plus rien
// écouter — aucun superviseur ne relance un processus vivant. Le `setup()` du nouveau tourne
// désormais avant l'arrêt de l'ancien : s'il jette, l'ancien reste en service.
// En production (NODE_ENV=production), le fichier d'entrée n'est plus surveillé du tout.

import assert from 'node:assert/strict'
import net from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { runWsCommand } from '../src/cli/ws.js'
import { runServeurCommand } from '../src/cli/server.js'

const sonde = (port: number) => new Promise<boolean>(r => {
  const c = net.connect({ host: '127.0.0.1', port }, () => { c.destroy(); r(true) })
  c.on('error', () => r(false))
})
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
async function attendreQue(cond: () => boolean | Promise<boolean>, ms = 5000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) { if (await cond()) return true; await attendre(50) }
  return false
}

for (const [nom, lancer, fichier] of [
  ['mjs ws', runWsCommand, 'ws.js'],
  ['mjs serveur', runServeurCommand, 'serveur.js'],
] as const) {
  describe(`${nom} — un setup() qui jette au rechargement garde l'ancien serveur`, function () {
    this.timeout(30000)

    it('port toujours ouvert après un setup() qui jette, nouvelle version prise après correction', async () => {
      const root = mjsTmp('reload-setup-jette')
      const port = 47000 + Math.floor(Math.random() * 3000)
      writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
      writeFileSync(join(root, fichier), 'export default { setup(app) {} }\n')
      const erreurs: string[] = []
      const errAvant = console.error
      console.error = (...a: any[]) => { erreurs.push(a.join(' ')) }
      let h: any
      try {
        h = await (lancer as any)({ root, port }, undefined)
        assert.equal(await sonde(port), true)
        const avant = h.app
        writeFileSync(join(root, fichier), "export default { setup(app) { throw new Error('variable manquante') } }\n")
        assert.ok(await attendreQue(() => erreurs.some(e => e.includes('variable manquante'))), 'échec du rechargement jamais signalé')
        await attendre(200)
        assert.equal(await sonde(port), true, 'le port doit rester ouvert')
        assert.equal(h.app, avant, "l'ancien serveur reste en service")
        writeFileSync(join(root, fichier), 'export default { setup(app) { } }\n// corrigé\n')
        assert.ok(await attendreQue(() => h.app !== avant), 'la version corrigée doit être chargée')
        assert.equal(await sonde(port), true)
      } finally {
        console.error = errAvant
        if (h) await h.stop()
      }
    })
  })
}

describe('mjs ws — pas de surveillance du fichier d\'entrée en production', function () {
  this.timeout(30000)
  it('NODE_ENV=production : une modification du fichier n\'est pas rechargée', async () => {
    const root = mjsTmp('reload-prod')
    const port = 47000 + Math.floor(Math.random() * 3000)
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
    writeFileSync(join(root, 'ws.js'), 'export default { setup(app) {} }\n')
    const avantEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    let h: any
    try {
      h = await runWsCommand({ root, port }, undefined)
      const avant = h.app
      writeFileSync(join(root, 'ws.js'), 'export default { setup(app) {} }\n// modifié\n')
      await attendre(1200)
      assert.equal(h.app, avant)
    } finally {
      process.env.NODE_ENV = avantEnv
      if (h) await h.stop()
    }
  })
})
