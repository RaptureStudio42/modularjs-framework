// Le helper « tout-en-un » public renderToString({...}) construisait son renderer et son rendu
// avec une LISTE BLANCHE d'options écrite à la main : light, bundlerOpts, manifestPath,
// forwardedUrl, forwardedCookie n'atteignaient jamais createSSRRenderer/renderer.renderToString,
// contrairement à l'API interne (createSSRRenderer + renderer.renderToString) qui les honore.
// Un appelant qui passe light:true au wrapper public obtenait donc quand même un Shadow DOM
// déclaratif complet — silencieusement.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPONENT = [
  '<style>',
  ':host',
  '  display: block',
  '</style>',
  '<script>',
  "$titre = 'Accueil'",
  '</script>',
  '',
  '<h1 class="t">{$titre}</h1>',
].join('\n') + '\n'

describe('renderToString (wrapper public) — transmet toutes les options documentées', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('light:true honoré : aucun DSD, light:true dans le résultat', async function () {
    const root = mjsTmp('ssr-wrapper-light')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app-home.mjs'), COMPONENT)

    const res = await renderToString({ sourceDir: srcDir, tag: 'mjs-app-home', light: true })
    assert.equal(res.light, true, `light doit rester true — obtenu : ${res.light}`)
    assert.ok(!res.html.includes('<template shadowrootmode'), `aucun DSD attendu en mode léger — html : ${res.html}`)
  })

  it('manifestPath explicite honoré : le manifeste écrit au chemin demandé, pas au défaut', async function () {
    const root = mjsTmp('ssr-wrapper-manifest')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app-home.mjs'), COMPONENT)
    const manifestPath = join(outDir, 'mon-manifeste.js')

    const res = await renderToString({ sourceDir: srcDir, outputDir: outDir, manifestPath, tag: 'mjs-app-home' })
    assert.match(res.html, /Accueil/)
    const { existsSync } = await import('node:fs')
    assert.ok(existsSync(manifestPath), `le manifeste doit exister au chemin explicite : ${manifestPath}`)
  })

  it('bundlerOpts (csp:true) honoré : le style sort en <link>, jamais en <style> en ligne', async function () {
    const root = mjsTmp('ssr-wrapper-csp')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app-home.mjs'), COMPONENT)

    const res = await renderToString({ sourceDir: srcDir, outputDir: outDir, tag: 'mjs-app-home', bundlerOpts: { csp: true } })
    assert.ok(!res.html.includes('<style>'), `bundlerOpts.csp:true (transmis en bloc, pas via la clé csp explicite) doit produire un <link>, jamais de <style> en ligne : ${res.html}`)
    assert.match(res.html, /<link rel="stylesheet"/, `un <link> vers le CSS haché est attendu sous csp:true : ${res.html}`)
  })
})
