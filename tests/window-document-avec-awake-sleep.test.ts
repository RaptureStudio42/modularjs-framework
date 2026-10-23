// <@window> et <@document> posent leurs écouteurs au réveil et les retirent au sommeil, enchaînés
// derrière les µawake/µsleep du composant. Le défaut : un composant qui déclarait déjà µawake (ou
// µsleep) et posait un <@window>/<@document> échouait au build (« déclare µawake deux fois »), alors
// que rien n'y était déclaré deux fois. Le build doit passer, et au montage comme au démontage les
// deux doivent tourner ; deux µawake écrits à la main restent refusés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CLAVIER = '<script>\n$touches = 0\nµawake ->\n  window.__reveils = (window.__reveils ?? 0) + 1\n  @_eveil = true\n</script>\n<@window @keydown={$touches++}>\n<p class="t">{$touches}</p>\n'
const SOURIS  = '<script>\nµsleep ->\n  window.__sommeils = (window.__sommeils ?? 0) + 1\n</script>\n<@document @click={window.__clics = (window.__clics ?? 0) + 1}>\n<@window @resize={window.__tailles = (window.__tailles ?? 0) + 1}>\n<p>s</p>\n'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('<@window>/<@document> à côté de µawake/µsleep', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('window-document-avec-awake-sleep')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'clavier.mjs'), CLAVIER)
    writeFileSync(join(srcDir, 'souris.mjs'), SOURIS)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('µawake + <@window> : le build passe, le réveil et l\'écouteur tournent', async () => {
    window.document.body.innerHTML = '<mjs-clavier></mjs-clavier>'
    const comp = window.document.querySelector('mjs-clavier')
    await attendre(() => comp._shadow?.querySelector('.t')?.textContent === '0')
    assert.equal(window.__reveils, 1, 'le µawake du composant')
    assert.equal(comp._eveil, true, 'son `@` désigne le composant')
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }))
    await attendre(() => comp._shadow.querySelector('.t').textContent === '1')
    assert.equal(comp._shadow.querySelector('.t').textContent, '1', 'l\'écouteur de <@window>')
  })

  it('µsleep + <@document>/<@window> : au démontage, le sommeil tourne et les écouteurs partent', async () => {
    window.document.body.innerHTML = '<mjs-souris></mjs-souris>'
    const comp = window.document.querySelector('mjs-souris')
    await attendre(() => !!comp._shadow?.querySelector('p'))
    window.document.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    assert.equal(window.__clics, 1, 'l\'écouteur de <@document>')
    comp.remove()
    await attendre(() => window.__sommeils === 1)
    assert.equal(window.__sommeils, 1, 'le µsleep du composant')
    window.document.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(window.__clics, 1, 'écouteur de <@document> retiré')
    assert.equal(window.__tailles, undefined, 'écouteur de <@window> retiré')
  })

  it('deux µawake écrits à la main restent refusés', async () => {
    await assert.rejects(transpile('<script>\nµawake ->\n  1\nµawake ->\n  2\n</script>\n<p>x</p>\n', { moduleName: 'double' }), /µawake deux fois/)
  })
})
