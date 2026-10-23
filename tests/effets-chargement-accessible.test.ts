// *loader : l'indicateur dessiné est muet (un décor, `aria-hidden`) — la balise qui le porte, elle, dit
// aux lecteurs d'écran qu'un chargement est en cours : une région `role="status"` dont le texte, réservé aux
// lecteurs d'écran, arrive après elle (« Chargement », dans la langue affichée ; un libellé écrit par l'auteur est
// gardé, et dit à sa place) ; au retrait, elle retrouve ses attributs.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*loader — un chargement que les lecteurs d\'écran entendent', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-chargement-accessible')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-attente.mjs'), '<script>\n$la = true\n</script>\n{if $la}<span class="l" *loader(bloom)></span>{end}\n<span class="m" aria-label="Envoi du panier" *loader></span>\n<button class="k" @click={$la = false}>k</button>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;${libelles ? ` µ._runtimeLabels = ${libelles[1]};` : ''}`)
    window.document.documentElement.lang = 'fr'
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('la balise s\'annonce « Chargement » ; un libellé de l\'auteur est gardé ; retirée, rien ne reste', async () => {
    window.document.body.innerHTML = '<mjs-fx-attente></mjs-fx-attente>'
    const comp = window.document.querySelector('mjs-fx-attente')
    await attendre(() => !!comp._shadow?.querySelector('.l [mjs-fx-layer="loader"]'))
    const l = comp._shadow.querySelector('.l')
    const m = comp._shadow.querySelector('.m')
    assert.equal(l.getAttribute('role'), 'status')
    await attendre(() => l.textContent.trim() === 'Chargement' && m.textContent.trim() === 'Envoi du panier')
    assert.equal(l.textContent.trim(), 'Chargement', 'le texte de la région')
    assert.equal(l.getAttribute('aria-label'), null, 'pas de nom en plus : le texte suffit')
    assert.equal(l.querySelector('[mjs-fx-loader-box]').getAttribute('aria-hidden'), 'true', 'le dessin reste muet')
    assert.equal(m.getAttribute('aria-label'), 'Envoi du panier', 'le libellé écrit est gardé')
    assert.equal(m.textContent.trim(), 'Envoi du panier', 'et dit par la région')
    assert.equal(m.getAttribute('role'), 'status')
    comp._shadow.querySelector('.k').click()
    await attendre(() => !comp._shadow.querySelector('.l'))
    assert.ok(!comp._shadow.querySelector('.l'))
  })
})
