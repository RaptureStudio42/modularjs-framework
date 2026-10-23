// Effets au rendu serveur : aucun. Un effet habille la balise au premier rendu du navigateur
// (render-then-replace), jamais dans le HTML prérendu — sa feuille est adoptée par la page, pas
// sérialisée : ses calques de texte partiraient sans elle (« Simple. » écrit trois fois, texte triplé
// pour un robot sans JavaScript). Deux moteurs de prérendu : happy-dom (`µ._isServer` et `µ.server`)
// et le navigateur (`µ.server` seul).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString, stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'vitrine': '<script>\n$c = \'#ff00ff\'\n</script>\n<p class="a" *scramble(on: load)>Bonjour</p>\n<p class="b" *cycle.frame(on: always)>Simple.</p>\n<h2 class="c" *neon($c)>Lueur</h2>\n<p class="d" *fade(on: view)>Fondu</p>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets au rendu serveur : aucun dans le HTML prérendu', function () {
  this.timeout(60000)
  let srcDir = ''
  let code   = ''

  before(async () => {
    const root   = mjsTmp('effets-rendu-serveur')
    const outDir = join(root, 'out')
    srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  // la page montée dans une fenêtre happy-dom ; `serveur` : le drapeau posé par le moteur de prérendu
  // du navigateur (µ.server seul, sans µ._isServer)
  async function monter(serveur: boolean) {
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;${serveur ? ' µ.server = true;' : ''}`)
    window.document.body.innerHTML = '<mjs-vitrine></mjs-vitrine>'
    const comp = window.document.querySelector('mjs-vitrine')
    await attendre(() => !!comp._shadow?.querySelector('.d'))
    await new Promise((r) => setTimeout(r, 30))
    const marques = Array.from(comp._shadow.querySelectorAll('[mjs-fx]')).map((el: any) => el.className + ':' + el.getAttribute('mjs-fx'))
    const calques = comp._shadow.querySelectorAll('[mjs-fx-layer]').length
    const texte   = String(comp._shadow.querySelector('.b').textContent)
    window.close()
    return { marques, calques, texte }
  }

  it('renderToString (happy-dom) : ni marque mjs-fx, ni calque, ni variable d\'effet ; le texte une seule fois', async () => {
    const res = await renderToString({ sourceDir: srcDir, tag: 'mjs-vitrine' })
    assert.match(res.html, /Bonjour/, 'le rendu a bien eu lieu')
    assert.doesNotMatch(res.html, /mjs-fx/, 'aucun attribut ni calque d\'effet dans le HTML prérendu')
    assert.doesNotMatch(res.html, /--mjs-neon-color/, 'aucune variable CSS d\'effet')
    assert.equal(res.html.split('Simple.').length - 1, 1, 'le texte de *cycle une seule fois')
  })

  it('moteur navigateur (µ.server seul) : aucun effet posé pendant le rendu serveur', async () => {
    const r = await monter(true)
    assert.deepEqual(r.marques, [])
    assert.equal(r.calques, 0)
    assert.equal(r.texte, 'Simple.')
  })

  it('dans le navigateur (hors rendu serveur) : les effets se posent', async () => {
    const r = await monter(false)
    assert.ok(r.marques.some((m) => m === 'a:scramble'), r.marques.join(' '))
    assert.ok(r.marques.some((m) => m === 'c:neon'), r.marques.join(' '))
    assert.ok(r.calques > 0, 'les calques de texte sont là')
  })
})
