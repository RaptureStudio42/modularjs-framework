// *follow et *cursors contre un vrai serveur MJS WS (MemoryTransport) et la vraie connexion de l'appli :
// à la première ouverture, chaque effet demande UNE fois ce qu'il lui faut (la dernière position du
// salon, soi) — pas deux ; à chaque reconnexion, par l'accueil (`welcome`), une fois de plus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsWs, followPackage, cursorsPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-ca-accueil': '<script>\n@sock = µsocket \'memory://accueil\'\n</script>\n<div class="z" *follow><section>Un</section></div>\n<div class="c" *cursors><section>Un</section></div>',
}

async function attendre(cond: () => boolean, ms = 5000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*follow, *cursors — ce qu\'ils demandent au serveur à l\'accueil', function () {
  this.timeout(60000)
  let window: any
  let app: any
  const demandes: string[] = []

  before(async () => {
    const root   = mjsTmp('curseurs-demande-a-l-accueil')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    // le serveur : chaque requête reçue est notée avant d'être traitée
    const transport = new MemoryTransport()
    app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth ?? { id: 'anon' }, onLog: () => {} } as any)
    const serve = app.serve.bind(app)
    app.serve = (type: string, h: any) => serve(type, (p: any, c: any) => { demandes.push(type); return h(p, c) })
    app.use(followPackage())
    app.use(cursorsPackage())
    await app.listen()
    window = new Window({ url: 'http://localhost/' })
    window.WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.documentElement.lang = 'fr'
  })

  after(async () => {
    window?.document?.body && (window.document.body.innerHTML = '')
    window?.µ?._mjs_sockets && Object.values(window.µ._mjs_sockets).forEach((s: any) => s.destroy())
    window?.close?.()
    await app?.stop()
    await terminateSharedWorkerPool()
  })

  const compte = (type: string) => demandes.filter((d) => d === type).length

  it('à la première ouverture : une demande de la dernière position, une pour se connaître — pas deux ; à chaque reconnexion, une de plus (par l\'accueil)', async () => {
    window.document.body.innerHTML = '<mjs-fx-ca-accueil></mjs-fx-ca-accueil>'
    await attendre(() => compte('follow:last') > 0 && compte('cursors:me') > 0)
    await pause(400)
    assert.equal(compte('follow:last'), 1, 'follow:last à la première ouverture : ' + JSON.stringify(demandes))
    assert.equal(compte('cursors:me'), 1, 'cursors:me à la première ouverture : ' + JSON.stringify(demandes))
    // la connexion tombe : elle se rouvre d'elle-même, l'accueil redemande
    const sock = window.µ._mjs_sockets['memory://accueil']
    assert.equal(sock.state, 'open', 'la connexion est ouverte')
    sock._mjs_ws.close()
    await attendre(() => compte('follow:last') > 1 && compte('cursors:me') > 1, 8000)
    await pause(400)
    assert.equal(compte('follow:last'), 2, 'follow:last après la reconnexion : ' + JSON.stringify(demandes))
    assert.equal(compte('cursors:me'), 2, 'cursors:me après la reconnexion : ' + JSON.stringify(demandes))
  })
})
