// `mjs serve`/`mjs dev --output/--manifest` : le build principal (`new Bundler({...})` dans
// cli.ts) respecte déjà ces overrides, mais `createRenderHandler`/`startRenderServer` recevaient
// `found.config` BRUT — sans le moindre `outputDir`/`manifestPath` déclaré dans mjs.config.json,
// ils recalculaient leurs propres défauts ('dist', 'public/modularjs/bundle.js'), ignorant où le
// build a RÉELLEMENT écrit. Le prérendu (mjs build), lui, reçoit déjà ces overrides
// (cli-build-prerender-overrides.test.ts) — même correctif ici, pour le rendu par requête.
//
// Sous-processus RÉEL (cli.ts exécute `run(process.argv)` à son chargement), même patron que
// tests/serve-prefixe-public.test.ts (spawn + bannière + fetch + arrêt propre).

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const COMPOSANT = [
  '<script>',
  "$titre = 'Accueil-redirige'",
  '</script>',
  '',
  '<h1 class="t">{$titre}</h1>',
].join('\n') + '\n'

function fixtureProject(prefix: string): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app-home.mjs'), COMPOSANT)
  // AUCUN outputDir/manifestPath déclaré ici : seuls --output/--manifest en ligne de commande
  // redirigent la sortie — exactement le scénario du constat.
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src',
    render: { default: 'ssr', engine: { request: 'happy-dom' }, routes: { '/': { component: 'mjs-app-home' } } },
  }, null, 2))
  return root
}

/** Lance `mjs serve --output/--manifest redirigés` et rend le port réel + une fonction d'arrêt.
 *  `mjs serve` annonce son port RÉEL sur stdout (utile si `--port 0`). */
async function lanceServe(root: string, redirectedOutput: string, redirectedManifest: string): Promise<{ port: number; sortie: () => string; arreter: () => Promise<void> }> {
  const enfant = spawn(tsxBin, [
    cliPath, 'serve', '--root', root, '--port', '0',
    '--output', redirectedOutput, '--manifest', redirectedManifest,
  ], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  let sortie = ''
  enfant.stdout.on('data', (d: Buffer) => { sortie += d.toString() })
  enfant.stderr.on('data', (d: Buffer) => { sortie += d.toString() })
  const fini = new Promise<void>(resolve => enfant.on('exit', () => resolve()))
  const debut = Date.now()
  while (Date.now() - debut < 30000 && !/127\.0\.0\.1:(\d+)/.test(sortie) && enfant.exitCode === null) await new Promise(r => setTimeout(r, 100))
  assert.match(sortie, /127\.0\.0\.1:(\d+)/, `mjs serve doit démarrer. Sortie :\n${sortie}`)
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(sortie)![1])
  return {
    port,
    sortie: () => sortie,
    arreter: async () => {
      enfant.kill('SIGINT')
      await Promise.race([fini, new Promise<void>(r => setTimeout(r, 8000))])
      if (enfant.exitCode === null) { enfant.kill('SIGKILL'); await fini }
    },
  }
}

describe("cli.ts — 'mjs serve --output/--manifest' : le rendu par requête respecte les overrides", function () {
  this.timeout(60000)

  it('bundle servi (/__mjs/bundle.js) ET rendu SSR (/) viennent tous deux du dossier REDIRIGÉ, jamais des défauts dist/public', async () => {
    const root = fixtureProject('serve-override')
    const redirectDir = mjsTmp('serve-override-redirect')
    const redirectedOutput = join(redirectDir, 'out-there')
    const redirectedManifest = join(redirectedOutput, 'bundle.js')

    const { port, sortie, arreter } = await lanceServe(root, redirectedOutput, redirectedManifest)
    try {
      // BUG confirmé si /__mjs/bundle.js répond 404 : startRenderServer aurait cherché le
      // manifeste par défaut (public/modularjs/bundle.js), absent (build entièrement redirigé).
      const repBundle = await fetch(`http://127.0.0.1:${port}/__mjs/bundle.js`)
      assert.equal(repBundle.status, 200, `bundle attendu depuis le dossier redirigé, sortie :\n${sortie()}`)

      // BUG confirmé si le corps ne contient pas "Accueil-redirige" : createRenderHandler
      // aurait recompilé/cherché dans 'dist' (défaut interne, distinct de 'public/modularjs')
      // au lieu du dossier --output redirigé.
      const repPage = await fetch(`http://127.0.0.1:${port}/`)
      assert.equal(repPage.status, 200, `page attendue en 200, sortie :\n${sortie()}`)
      const html = await repPage.text()
      assert.match(html, /Accueil-redirige/, `le rendu SSR doit venir du composant compilé, html :\n${html.slice(0, 500)}`)

      // Aucun dossier "dist" parasite : preuve que le renderer SSR n'a pas recompilé vers son
      // défaut interne ('dist') À CÔTÉ du dossier réellement redirigé.
      assert.ok(!existsSync(join(root, 'dist')), "AVANT le fix : un dossier 'dist' parasite apparaissait dans le projet (défaut interne de createRenderHandler, jamais transmis --output)")
    } finally {
      await arreter()
    }
  })
})
