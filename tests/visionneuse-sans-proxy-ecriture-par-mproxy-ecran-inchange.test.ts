// Une visionneuse (page du journal, atelier du thème) se compile à la volée et partage le cœur de l'application. Ce test montre ce
// que fait aujourd'hui `p = µproxy $o.a` puis `p.b = 2` dans une page compilée comme elles : sur le cœur d'une appli `"proxy": false`,
// rien ne lève, la donnée change, l'écran garde l'ancienne valeur — comme toute écriture par un nom sous ce réglage, qui demande
// `µrefresh` ; sur un cœur avec l'enveloppe, l'écran suit. Un composant de l'appli bâti sous `"proxy": false` fait de même. Aucune
// visionneuse n'écrit `µproxy` (tests/journal-page-sans-proxy-n-appelle-pas-mproxy.test.ts le garde).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { getViewerScript } from '../src/server/viewer-page.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE = "<script>\n$o = { a: { b: 1 } }\n@ecrire = ->\n  p = µproxy $o.a\n  p.b = 2\n  return\n</script>\n<p class=\"v\">{$o.a.b}</p>\n"

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// construit l'appli (`hop.mjs`, plus `page` si elle en fait partie), puis joue `ecrire()` sur la balise `tag` : ce que montre l'écran,
// ce que tient l'état, ce qui a levé
async function jouer(nom: string, proxy: boolean, commeVisionneuse: boolean) {
  const root   = mjsTmp('visionneuse-mproxy-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hop.mjs'), '<script>\n$t = \'ok\'\n</script>\n<p>{$t}</p>\n')
  const page = join(commeVisionneuse ? root : srcDir, 'essai-viewer.mjs')
  writeFileSync(page, PAGE)
  const manifeste = join(outDir, 'bundle.js')
  const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, proxy } as any)
  const stats     = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang     = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  let code       = [...fichiers].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  if (commeVisionneuse) {
    // compilée par le chemin des visionneuses (`getViewerScript`) : le nom du fichier remonte à la racine, puis descend à la page du test
    const script = await getViewerScript(manifeste, { fileName: '../'.repeat(40) + page.slice(1), moduleName: 'essai-viewer' })
    assert.match(script, /_mjs_makeDeepProxy/, 'la page compilée appelle l\'aide de `µproxy`')
    code += '\n' + stripEsm(script)
  }
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = '<mjs-essai-viewer></mjs-essai-viewer>'
  const comp = window.document.querySelector('mjs-essai-viewer')
  await attendre(() => !!comp._shadow?.querySelector('.v'))
  const avant = comp._shadow.querySelector('.v').textContent
  let leve    = ''
  try { comp.ecrire() } catch (e: any) { leve = String(e?.message) }
  await new Promise((r) => setTimeout(r, 50))
  const ecran = comp._shadow.querySelector('.v').textContent
  const etat  = window.µ._mjs_toRaw(comp._state.o).a.b
  window.close()
  return { avant, ecran, etat, leve }
}

describe('µproxy $o.a dans une page compilée comme une visionneuse : ce qu\'il fait aujourd\'hui', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('cœur d\'une appli "proxy": false : rien ne lève, la donnée change, l\'écran garde l\'ancienne valeur', async () => {
    const r = await jouer('sans', false, true)
    assert.deepEqual(r, { avant: '1', ecran: '1', etat: 2, leve: '' })
  })

  it('cœur avec l\'enveloppe : l\'écran suit l\'écriture', async () => {
    const r = await jouer('avec', true, true)
    assert.deepEqual(r, { avant: '1', ecran: '2', etat: 2, leve: '' })
  })

  it('le même composant dans une appli "proxy": false : même sort qu\'une écriture par un nom (µrefresh)', async () => {
    const r = await jouer('appli-sans', false, false)
    assert.deepEqual(r, { avant: '1', ecran: '1', etat: 2, leve: '' })
  })
})
