// Un `<script>` écrit dans `<@head>` part dans le <head> comme contenu HTML (µ._setHead, mjs_head.ts) : le navigateur
// ne l'exécute jamais, et rien ne le disait — un SDK ou un script de mesure d'audience ne tournait pas, sans un mot.
// La construction l'annonce désormais par un avertissement qui cite la ligne du .mjs et dit quoi faire à la place.
// Un script de données (JSON-LD), un type inconnu ou un type calculé ne déclenchent rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { processGlobalMacros } from '../src/transpiler/macros.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('<@head> — un <script> qui ne s\'exécutera jamais est annoncé à la construction', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('script externe, script en ligne, module : un avertissement chacun, à sa ligne', () => {
    const html = [
      '<p>x</p>',
      '<@head>',
      '  <title>t</title>',
      '  <script src="https://cdn.example/sdk.js"></script>',
      '  <script>window.a = 1</script>',
      '  <script type="module">import x from "y"</script>',
      '</@head>',
    ].join('\n')
    const r = processGlobalMacros(html, { firstLine: 5 })
    assert.deepEqual(r.errors, [])
    assert.equal((r.warnings ?? []).length, 3, JSON.stringify(r.warnings))
    assert.match(r.warnings[0], /<@head> (ligne|line) 8\b/)
    assert.match(r.warnings[1], /<@head> (ligne|line) 9\b/)
    assert.match(r.warnings[2], /<@head> (ligne|line) 10\b/)
    assert.match(r.warnings[0], /index\.html/, 'le message dit quoi faire à la place')
  })

  it('script de données, type inconnu, type calculé : aucun avertissement', () => {
    const html = '<@head><script type="application/ld+json">{"@context": "https://schema.org"}</script><script type="text/template"><b>x</b></script><script type={$t}></script></@head>'
    const r = processGlobalMacros(html)
    assert.deepEqual(r.errors, [])
    assert.deepEqual(r.warnings ?? [], [])
  })

  it('la construction le compte dans ses avertissements, sans échouer', async () => {
    const root   = mjsTmp('head-script-averti')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'tete.mjs'), '<p>page</p>\n<@head>\n  <script src="/sdk.js"></script>\n</@head>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const textes = stats.warnings.map((w: any) => String(w?.message ?? w))
    assert.equal(textes.filter((w: string) => /<@head> (ligne|line) 3\b/.test(w) && w.includes('<script>')).length, 1, textes.join('\n'))
  })
})
