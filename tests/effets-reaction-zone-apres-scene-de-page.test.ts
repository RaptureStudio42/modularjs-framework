// *react : un bouton sans scène autour pose d'office la scène de la page ; quand une zone `*react(stage: true)` est posée
// ensuite AUTOUR de lui (son effet arrivé plus tard), le bouton passe à la zone et la scène d'office, qui ne sert plus à
// personne, part — sinon les deux écoutent la connexion, et chaque émoji reçu d'un autre visiteur vole deux fois (une fois
// dans la zone, une fois sur toute la page). Une scène d'office qui sert encore à un bouton hors de la zone reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-rz-zone':  '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="zone"><button class="b" *react(🎉)>🎉</button></div>\n',
  'fx-rz-dehors': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<button class="b" *react(👍)>👍</button>\n',
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*react — une zone posée autour d\'un bouton après la scène d\'office', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-reaction-zone-apres-scene-de-page')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/page' })
    // aucune vraie connexion : le navigateur simulé n'en ouvre pas
    window.WebSocket = class { readyState = 0; send() {} close() {} }
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.documentElement.lang = 'fr'
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('un seul émoji vole par message reçu : dans la zone ; la scène d\'office part, ou reste pour un bouton hors de la zone', async () => {
    const doc  = window.document
    const recu = (sock: any, salon: string) => sock._mjs_dispatch('reactions:send', { p: { room: salon.slice('reactions:'.length), e: '🎉' } })
    const zoneDe = (comp: any) => comp._shadow.querySelector('.zone')
    // 1) le bouton seul : scène d'office ; puis la zone autour de lui
    const a = doc.createElement('mjs-fx-rz-zone')
    doc.body.appendChild(a)
    await pause(300)
    assert.equal(doc.querySelectorAll('[mjs-fx-react-stage="page"]').length, 1, 'le bouton seul pose la scène de la page')
    window.µ._mjs_fx(a, zoneDe(a), 'react', { stage: true })
    await pause(300)
    const sock  = window.µ._mjs_sockets['wss://x.fr/ws']
    assert.ok(sock, 'la connexion du composant')
    const salon = Object.keys(sock._mjs_rooms || {}).find((k) => k.indexOf('reactions:') === 0) as string
    assert.ok(salon, 'le salon des réactions est rejoint')
    recu(sock, salon)
    const vu1 = { page: doc.querySelectorAll('[mjs-fx-react-stage="page"]').length, ecoute: (sock._mjs_handlers['reactions:send'] || []).length, dansLaZone: zoneDe(a).querySelectorAll('[mjs-fx-react-emoji]').length, surLaPage: doc.querySelectorAll('[mjs-fx-react-stage="page"] [mjs-fx-react-emoji]').length }
    assert.deepEqual(vu1, { page: 0, ecoute: 1, dansLaZone: 1, surLaPage: 0 })
    // 2) un bouton hors de la zone garde la scène d'office
    a.remove()
    await pause(100)
    const b = doc.createElement('mjs-fx-rz-dehors')
    const c = doc.createElement('mjs-fx-rz-zone')
    doc.body.appendChild(b)
    doc.body.appendChild(c)
    await pause(300)
    window.µ._mjs_fx(c, zoneDe(c), 'react', { stage: true })
    await pause(300)
    assert.equal(doc.querySelectorAll('[mjs-fx-react-stage="page"]').length, 1, 'la scène d\'office sert encore au bouton du dehors')
  })
})
