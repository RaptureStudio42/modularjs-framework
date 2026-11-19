// Le code serveur de la valeur dérivée qui attend (ce que lit le rendu, `µ._ssrAwait`, et l'échec qui ne s'écrit pas dans la page) ne
// part que dans une construction qui peut rendre côté serveur, comme celui de `µload` : une appli de production sans rendu serveur ne
// l'emporte pas ; avec un bloc `render` qui rend ses pages au serveur, il y est. La reprise d'une page servie part dans tout client (la
// page peut venir d'un serveur qui rend par l'API). Le poids du cœur, brut et `gzip -9`, est écrit pour chaque construction.
// Méthode : le vrai Bundler en production, un fichier par composant ; le texte du cœur construit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const SERVI = `<script>
  $q         = ''
  rechercher = (q, signal) -> fetch("/api/search?q=#{q}", { signal }).then((r) -> r.json())
  $resultats = await rechercher($q, µsignal)
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul>
`

async function coeur(prefixe: string, opts: any): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'servi.mjs'), SERVI)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), js: 'split', env: 'prod', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [])
  const f = readdirSync(outDir).find((n) => n.startsWith('mjs_core') && n.endsWith('.js'))
  assert.ok(f, 'le cœur est construit')
  const texte = readFileSync(join(outDir, f!), 'utf-8')
  console.log(`      cœur ${prefixe} : ${Buffer.byteLength(texte)} o, gzip -9 ${gzipSync(texte, { level: 9 }).length} o`)
  return texte
}

describe('valeur dérivée qui attend — le code serveur retiré d\'une appli sans rendu serveur', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('sans rendu serveur : ni `_ssrAwait` ni l\'échec du serveur ; la reprise de la page servie reste', async () => {
    const texte = await coeur('aw-poids-sans-ssr', {})
    assert.ok(texte.includes('__mjsAwait'), 'le module et la reprise d\'une page servie sont là')
    assert.ok(!texte.includes('_ssrAwait'), 'ce que lit le rendu serveur est retiré')
  })

  it('avec un bloc `render` qui rend au serveur : le code serveur y est', async () => {
    const texte = await coeur('aw-poids-avec-ssr', { render: { default: 'ssr' } })
    assert.ok(texte.includes('_ssrAwait'), 'ce que lit le rendu serveur est là')
  })
})
