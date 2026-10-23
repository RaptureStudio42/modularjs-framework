// *react : un bouton sans scène autour pose d'office la scène de la page ; quand un `<@document *react>` arrive
// ensuite (un composant monté plus tard), il n'y a plus qu'une scène de page — sinon les deux écoutent la
// connexion, et chaque émoji reçu d'un autre visiteur vole deux fois.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-rt-bouton': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<button class="b" *react(🎉)>🎉</button>\n',
  'fx-rt-page':   '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<@document *react></@document>\n<p class="z">x</p>\n',
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*react — la scène de la page posée après celle d\'un bouton', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-reaction-scene-de-page-tardive')
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

  it('un seul émoji vole par message reçu, une seule scène de page reste', async () => {
    const doc = window.document
    doc.body.appendChild(doc.createElement('mjs-fx-rt-bouton'))
    await pause(300)
    assert.equal(doc.querySelectorAll('[mjs-fx-react-stage="page"]').length, 1, 'le bouton seul pose la scène de la page')
    doc.body.appendChild(doc.createElement('mjs-fx-rt-page'))
    await pause(300)
    const sock   = window.µ._mjs_sockets['wss://x.fr/ws']
    assert.ok(sock, 'la connexion partagée des deux composants')
    const salon  = Object.keys(sock._mjs_rooms || {}).find((k) => k.indexOf('reactions:') === 0)
    assert.ok(salon, 'le salon des réactions est rejoint')
    const scenes = doc.querySelectorAll('[mjs-fx-react-stage="page"]').length
    const ecoute = (sock._mjs_handlers['reactions:send'] || []).length
    // un émoji d'un autre visiteur arrive
    sock._mjs_dispatch('reactions:send', { p: { room: salon.slice('reactions:'.length), e: '🎉' } })
    const vols = doc.querySelectorAll('[mjs-fx-react-emoji]').length
    assert.deepEqual({ scenes, ecoute, vols }, { scenes: 1, ecoute: 1, vols: 1 })
    // le bouton part : la scène de <@document> reste et reçoit toujours
    doc.querySelector('mjs-fx-rt-bouton').remove()
    await pause(100)
    sock._mjs_dispatch('reactions:send', { p: { room: salon.slice('reactions:'.length), e: '🎉' } })
    assert.equal(doc.querySelectorAll('[mjs-fx-react-stage="page"]').length, 1)
    assert.equal(doc.querySelectorAll('[mjs-fx-react-emoji]').length, 2)
  })
})
