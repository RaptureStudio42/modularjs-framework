// Paquet construit : dist/mjs-server.js embarque sa propre copie du cœur de MJS-WS. Une MjsWsError importée de
// 'modularjs-framework/ws' (dist/mjs-ws.js), comme le dit la doc, n'était pas reconnue par ce cœur : `instanceof` ne
// reconnaît pas la classe d'une autre copie, et en production le joueur recevait « erreur interne du serveur » au lieu de
// la phrase. Même chose pour MjsWsAuthDenied levée par le `auth` d'une appli MJS-Server. Les deux classes portent une
// marque commune à toutes les copies. Le test construit les deux paquets comme `npm run build:self`, dans un dossier
// temporaire
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function attendre(trames: any[], pred: (f: any) => boolean): Promise<any> {
  for (let i = 0; i < 500; i++) {
    const f = trames.find(pred)
    if (f) return f
    await tick(2)
  }
  throw new Error('trame attendue jamais reçue : ' + JSON.stringify(trames))
}

describe('MJS-WS — paquet construit : MjsWsError et MjsWsAuthDenied reconnues par le cœur embarqué de MJS-Server', function () {
  this.timeout(60000)
  const nodeEnv = process.env.NODE_ENV
  let dossier = ''
  let wsPkg: any
  let srvPkg: any

  before(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'mjs-paquet-'))
    const commun = { bundle: true, platform: 'node' as const, target: 'node20', format: 'esm' as const, packages: 'external' as const, logLevel: 'silent' as const }
    await build({ ...commun, entryPoints: [join(RACINE, 'src/mjs-ws/index.ts')], outfile: join(dossier, 'mjs-ws.mjs') })
    await build({ ...commun, entryPoints: [join(RACINE, 'src/mjs-server/index.ts')], outfile: join(dossier, 'mjs-server.mjs') })
    wsPkg  = await import(pathToFileURL(join(dossier, 'mjs-ws.mjs')).href)
    srvPkg = await import(pathToFileURL(join(dossier, 'mjs-server.mjs')).href)
  })

  after(() => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
    if (dossier) rmSync(dossier, { recursive: true, force: true })
  })

  it('production : la phrase d’une MjsWsError part au joueur d’une appli MJS-Server, comme dans une appli MJS-WS', async () => {
    process.env.NODE_ENV = 'production'
    const fabriques: Array<[string, (o: any) => any]> = [['MJS-WS', (o) => wsPkg.mjsWs(o)], ['MJS-Server', (o) => srvPkg.mjsServer(o)]]
    for (const [nom, fabrique] of fabriques) {
      const transport = new wsPkg.MemoryTransport()
      const app = fabrique({ transport, heartbeat: 0, onLog: () => {} })
      app.serve('profil:changer', () => { throw new wsPkg.MjsWsError('ce pseudo est déjà pris') })
      await app.listen()
      try {
        const s: any = transport.connect({})
        const trames: any[] = []
        s.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
        await tick()
        s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
        await attendre(trames, f => f.t === 'µ:welcome')
        s.send(JSON.stringify({ t: 'profil:changer', p: {}, id: 1 }))
        const ack = await attendre(trames, f => f.t === 'µ:ack' && f.id === 1)
        assert.equal(ack.p, 'ce pseudo est déjà pris', `appli ${nom}`)
      } finally {
        await app.stop()
      }
    }
  })

  it('MjsWsAuthDenied levée par le `auth` d’une appli MJS-Server : son message part dans µ:denied', async () => {
    const transport = new wsPkg.MemoryTransport()
    const app = srvPkg.mjsServer({ transport, heartbeat: 0, onLog: () => {}, auth: () => { throw new wsPkg.MjsWsAuthDenied('mot de passe incorrect') } })
    await app.listen()
    try {
      const s: any = transport.connect({})
      const trames: any[] = []
      s.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
      await tick()
      s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: 'jeton' } }))
      const refus = await attendre(trames, f => f.t === 'µ:denied')
      assert.equal(refus.p.message, 'mot de passe incorrect')
    } finally {
      await app.stop()
    }
  })
})
