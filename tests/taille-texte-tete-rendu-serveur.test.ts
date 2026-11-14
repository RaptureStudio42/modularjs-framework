// la tête posée par le serveur (rendu serveur, avant le script) porte le même CSS des tailles du texte que la feuille racine
// bâtie : la déclaration de mjs_root convertie avec les réglages de la configuration, et le bloc :root de toutes les tailles de
// l'appli (ici celle d'un composant et celle de mjs_root), que la construction écrit à côté du manifeste. Même contenu en mode
// `csp` (fichier `mjs_ssr_head-….css`). `"responsiveFontSize": false` : la tête d'avant, à l'octet

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { buildSsrHead, FRAMEWORK_THEME_CSS } from '../src/server/ssr-head.js'
import { compileCss } from '../src/transpiler/css.js'

const BLOC   = ':root{--mjs-fs-41_5:calc(1.384375rem + 1.6125vw);--mjs-fs-64:calc(1.525rem + 3.3vw)}@media (min-width:1200px){:root{--mjs-fs-41_5:2.59375rem;--mjs-fs-64:4rem}}'
const RACINE = 'body { font-size: 12px; }\n.grand { font-size: 64px; }\n'

// un composant à 41.5px, mjs_root à 12px et 64px
function projet(prefix: string, extra: Record<string, unknown>): string {
  const root = mjsTmp(prefix)
  const conf = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', stylesheetsDir: 'app/styles', ...extra }
  write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
  write(join(root, 'app/titre.mjs'), '<h1 class="t">Titre</h1>\n<style>\n  .t\n    font-size: 41.5px\n</style>\n')
  write(join(root, 'app/styles/mjs_root.scss'), RACINE)
  return root
}

// l'appli bâtie, puis la tête que le serveur pose
async function teteServeur(root: string): Promise<string> {
  const found   = findConfig(root)!
  const bundler = new Bundler(resolveBundlerOpts(found.config, found.configDir) as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return buildSsrHead(found.config, found.configDir, join(root, 'public/m/bundle.js'))
}

describe('taille du texte adaptée à l\'écran — tête posée par le serveur', function () {
  this.timeout(300_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('réglage par défaut : le bloc :root de toutes les tailles et la déclaration convertie de mjs_root', async () => {
    const tete = await teteServeur(projet('taille-texte-tete', {}))
    assert.ok(tete.startsWith('<style data-mjs-ssr-head>'), tete)
    assert.equal(tete.split(BLOC).length, 2, `bloc :root attendu une fois\n${tete}`)
    assert.match(tete, /\.grand\{font-size:var\(--mjs-fs-64\)\}/)
    assert.match(tete, /body\{font-size:12px\}/)
  })

  it('csp: true (css: split) : le même contenu dans le fichier mjs_ssr_head-….css', async () => {
    const root = projet('taille-texte-tete-csp', { csp: true, css: 'split' })
    const tete = await teteServeur(root)
    const m    = /^<link rel="stylesheet" href="\/m\/(mjs_ssr_head-[a-f0-9]{8}\.css)">$/.exec(tete)
    assert.ok(m !== null, tete)
    const css  = readFileSync(join(root, 'public/m', m[1]), 'utf-8')
    assert.equal(css.split(BLOC).length, 2, `bloc :root attendu une fois\n${css}`)
    assert.match(css, /\.grand\{font-size:var\(--mjs-fs-64\)\}/)
  })

  it('"responsiveFontSize": false : aucune variable, la tête d\'avant à l\'octet', async () => {
    const tete = await teteServeur(projet('taille-texte-tete-coupee', { responsiveFontSize: false }))
    assert.ok(!tete.includes('--mjs-fs-'), tete)
    assert.equal(tete, '<style data-mjs-ssr-head>' + FRAMEWORK_THEME_CSS + '\n' + compileCss(RACINE, 'scss') + '</style>')
  })
})
