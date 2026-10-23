// *react : une zone `*react(stage: true)` posée autour d'un bouton lui prend la scène (celle de la page, posée d'office, part).
// Quand la zone repart (son effet retiré, le bouton reste), le bouton retrouve tout de suite la scène de la page — sans elle,
// les émojis des autres visiteurs ne volaient plus chez lui jusqu'à son prochain clic. Une zone reposée aussitôt (ses réglages
// changent) reprend le bouton, sans scène de page ; un composant retiré en entier, zone et bouton, n'en laisse aucune.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-rr-zone': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="zone"><button class="b" *react(🎉)>🎉</button></div>\n',
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*react — la zone repart : le bouton retrouve la scène de la page', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-reaction-zone-retiree-scene-de-page')
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

  it('zone retirée → scène de la page sans clic ; zone reposée → pas de scène de page ; tout retiré → aucune', async () => {
    const doc    = window.document
    const pages  = () => doc.querySelectorAll('[mjs-fx-react-stage="page"]').length
    const zoneDe = (comp: any) => comp._shadow.querySelector('.zone')
    const a = doc.createElement('mjs-fx-rr-zone')
    doc.body.appendChild(a)
    await pause(300)
    assert.equal(pages(), 1, 'le bouton seul pose la scène de la page')
    const off = window.µ._mjs_fx(a, zoneDe(a), 'react', { stage: true })
    await pause(300)
    assert.equal(pages(), 0, 'la zone prend le bouton')
    off()
    await pause(300)
    assert.equal(pages(), 1, 'la zone repartie, le bouton retrouve la scène de la page, sans clic')
    // la zone revient : elle reprend le bouton, la scène d'office part
    const off2 = window.µ._mjs_fx(a, zoneDe(a), 'react', { stage: true })
    await pause(300)
    assert.equal(pages(), 0, 'la zone revenue reprend le bouton')
    // reposée aussitôt (retirée puis remise dans le même tour) : le bouton y reste
    off2()
    window.µ._mjs_fx(a, zoneDe(a), 'react', { stage: true })
    await pause(300)
    assert.equal(pages(), 0, 'zone reposée : pas de scène de page')
    a.remove()
    await pause(300)
    assert.equal(pages(), 0, 'le composant retiré en entier ne laisse aucune scène')
  })
})
