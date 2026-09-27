// getViewerScript (viewer-page.ts) détecte le mode strict CSP du projet via CSP_FLAG_RE, un
// littéral figé (`µ._csp = true;`, espaces et `true` en dur). `manifestBodyLines()`
// (bundler/index.ts) émet cette même ligne dans le manifeste 'bundle' — qui, en prod, passe par
// une VRAIE minification esbuild : `µ` devient l'identifiant court que le mangler lui a donné,
// les espaces autour du « = » disparaissent, et `true` devient `!0`. CSP_FLAG_RE ne matchait plus
// rien dans ce cas — la visionneuse repartait en mode NON strict (script inline) sur un projet
// qui l'interdit (`style-src`/`script-src` sans 'unsafe-inline').

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getViewerScript, viewerScriptElement, THEME_VIEWER } from '../src/server/viewer-page.js'
import { mjsTmp } from './helpers/tmp.js'

function manifestAt(content: string): string {
  const root = mjsTmp('viewer-csp-flag')
  const outDir = join(root, 'out')
  mkdirSync(outDir, { recursive: true })
  const manifestPath = join(outDir, 'bundle.js')
  writeFileSync(manifestPath, content)
  return manifestPath
}

describe('getViewerScript — détection du mode CSP robuste à la minification', function () {
  it('µ._csp = true; (forme non minifiée) : toujours détecté (pas de régression)', async function () {
    const manifestPath = manifestAt('µ._csp = true;\nµ.paths = { "greet": import.meta.url };\nexport { µ };\n')
    const js = await getViewerScript(manifestPath, THEME_VIEWER)
    const html = viewerScriptElement(js, THEME_VIEWER)
    assert.match(html, /<script type="module" src="/, `csp:true doit rester détecté en forme non minifiée : ${html}`)
  })

  it('n._csp=!0; (récepteur mangled, sans espace, true→!0) : détecté quand même', async function () {
    const manifestPath = manifestAt('n._csp=!0;n.paths={"greet":import.meta.url};export{n as µ};')
    const js = await getViewerScript(manifestPath, THEME_VIEWER)
    const html = viewerScriptElement(js, THEME_VIEWER)
    assert.match(html, /<script type="module" src="/, `csp:true doit être détecté même minifié (µ renommé, espaces retirés, true→!0) : ${html}`)
  })

  it('absence du flag : mode non strict, script inline (pas de régression du défaut)', async function () {
    const manifestPath = manifestAt('n.paths={"greet":import.meta.url};export{n as µ};')
    const js = await getViewerScript(manifestPath, THEME_VIEWER)
    const html = viewerScriptElement(js, THEME_VIEWER)
    assert.match(html, /<script type="module">/, `sans le flag, le script doit rester en ligne : ${html}`)
  })
})
