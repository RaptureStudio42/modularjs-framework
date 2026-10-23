// `@this=!{root}` : la référence reste lisible pendant `µsleep`, `µdestroy` et le nettoyage rendu par
// `µmount`. Défaut garanti absent : elle était vidée en premier, et un nettoyage qui se garde par elle
// (`return unless PROPRIETAIRE is root`) ne faisait plus rien — un plein écran restait allumé.
// Gardes : la référence est bien vidée une fois le composant parti ; un composant seulement déplacé la garde.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const PAGE  = '<script>\nroot = null\nnote = (quoi) -> (globalThis.__journal ||= []).push(quoi + \' \' + (if root then \'la\' else \'vide\'))\n@etat = -> if root then \'la\' else \'vide\'\nµmount ->\n  note(\'mount\')\n  -> note(\'nettoyage\')\nµsleep -> note(\'sleep\')\nµdestroy -> note(\'destroy\')\n</script>\n<div class="r" @this=!{root}>x</div>\n'

describe('@this=!{root} — lisible au sommeil et au nettoyage', function () {
  this.timeout(60000)
  let script = ''
  before(async () => {
    const root   = mjsTmp('this-sommeil')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'page.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const order = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })
  after(async () => { await terminateSharedWorkerPool() })

  const mount = async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(script)
    window.document.body.innerHTML = '<mjs-page></mjs-page>'
    const page = window.document.querySelector('mjs-page')
    for (let i = 0; i < 100 && !page._shadow?.querySelector('.r'); i++) await pause(20)
    await pause(60)
    return { window, page }
  }

  it('composant retiré : µsleep, µdestroy et le nettoyage de µmount lisent la référence, vidée ensuite', async () => {
    const { window, page } = await mount()
    page.remove()
    await pause(80)
    assert.equal(JSON.stringify(window.__journal), '["mount la","sleep la","nettoyage la","destroy la"]')
    assert.equal(page.etat(), 'vide', 'une fois parti, le composant ne retient plus la balise')
  })

  it('composant déplacé dans la page : la référence reste', async () => {
    const { window, page } = await mount()
    const ailleurs = window.document.createElement('section')
    window.document.body.appendChild(ailleurs)
    ailleurs.appendChild(page)
    await pause(80)
    assert.equal(page.etat(), 'la')
  })
})
