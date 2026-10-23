// Test — le code compilé d'un composant ne porte plus la constante de dossier `_dir_<Classe>`
// (`new URL('.', import.meta.url).href`) ni la double écriture de `_mjs_dir` / `_mjs_modName` :
// `init` les pose seul. Le dossier lu pour charger le CSS d'un modèle (`layout="…"`) reste juste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANT = [
  '<script lang="coffee">',
  '$titre = "salut"',
  '</script>',
  '<p class="t">{$titre}</p>',
  '<style>',
  '.t',
  '  color: red',
  '</style>',
  '<style name="bandeau">',
  '.t',
  '  color: blue',
  '</style>',
].join('\n')

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

describe('composant compilé — pas de constante de dossier morte', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucun `new URL(\'.\', import.meta.url)` ni `_dir_` dans la sortie, `_mjs_dir` et `_mjs_modName` écrits une seule fois', async () => {
    const { output } = await transpile(COMPOSANT, { moduleName: 'layout-demo' })
    assert.equal(/new URL\(\s*['"]\.['"]\s*,\s*import\.meta\.url/.test(output), false, 'constante de dossier encore émise')
    assert.equal(output.includes('_dir_'), false, 'variable _dir_ encore présente')
    assert.equal(output.split('this._mjs_dir =').length - 1, 1, '_mjs_dir écrit plus d\'une fois')
    assert.equal(output.split('this._mjs_modName =').length - 1, 1, '_mjs_modName écrit plus d\'une fois')
  })

  it('monté pour de vrai : le modèle demandé charge son CSS depuis le dossier posé par init', async () => {
    const root   = mjsTmp('dirmort')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'layout-demo.mjs'), COMPOSANT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['layout_variant', 'theme'] })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

    const window: any = new Window({ url: 'http://localhost/' })
    const fetchCalls: string[] = []
    window.fetch = (url: string) => { fetchCalls.push(url); return Promise.resolve({ ok: true, status: 200, text: async () => '.t{color:blue}' }) }
    const files = readdirSync(outDir)
    const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
    const compFile = files.find((f: string) => /^layout-demo-/.test(f))
    assert.ok(coreFile && compFile, `sortie du build inattendue : ${files.join(', ')}`)
    window.eval([
      stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8')),
      'globalThis.µ = µ;',
      stripEsm(readFileSync(join(outDir, compFile!), 'utf-8')),
    ].join('\n'))

    window.document.body.innerHTML = '<mjs-layout-demo layout="bandeau"></mjs-layout-demo>'
    const el: any = window.document.body.firstElementChild
    await new Promise(r => setTimeout(r, 80))
    assert.equal(typeof el._mjs_dir, 'string')
    assert.ok(el._mjs_dir.length > 0 && el._mjs_dir.endsWith('/'), `dossier inattendu : ${el._mjs_dir}`)
    assert.equal(el._mjs_modName, 'layout-demo')
    assert.equal(fetchCalls.length, 1, 'une seule requête')
    assert.match(fetchCalls[0], /^[^?]*layout-demo\.bandeau\.css\?v=[0-9a-f]{8}$/, fetchCalls[0])
    assert.equal(fetchCalls[0].startsWith(el._mjs_dir + 'layout-demo.bandeau.css'), true, fetchCalls[0])
    assert.equal(fetchCalls[0].includes('undefined'), false, fetchCalls[0])
  })
})
