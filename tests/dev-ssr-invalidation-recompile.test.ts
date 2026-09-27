// `mjs dev` + bloc `render` (mode SSR par requête) : le renderer SSR de createRenderHandler est
// mémoïsé pour ne compiler qu'une fois — pensé pour la PRODUCTION, où le code ne change jamais en
// cours de vie du process (cf. render-request.ts). En DÉVELOPPEMENT, une recompilation du watcher
// ne l'invalidait JAMAIS : le SSR continuait de servir la version compilée AVANT la modification,
// indéfiniment, tant que le process `mjs dev` restait vivant.
//
// Sous-processus RÉEL (`mjs dev`, watcher actif) : édite le composant source PENDANT que le
// serveur tourne, attend la recompilation, revérifie le rendu SSR.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

function composant(titre: string): string {
  return `<script>\n$titre = '${titre}'\n</script>\n\n<h1 class="t">{$titre}</h1>\n`
}

function fixtureProject(): { root: string; composantPath: string } {
  const root = mjsTmp('dev-ssr-invalidation')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  const composantPath = join(srcDir, 'app-home.mjs')
  writeFileSync(composantPath, composant('Accueil-v1'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'public/modularjs',
    render: { default: 'ssr', engine: { request: 'happy-dom' }, routes: { '/': { component: 'mjs-app-home' } } },
  }, null, 2))
  return { root, composantPath }
}

interface DevProc { stdout(): string; kill(): Promise<void> }

/** `mjs dev` sur un projet jetable, laissé VIVANT après le premier build. */
function lancerDevVivant(root: string, port: number): Promise<DevProc> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    let settled = false
    const abandon = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error(`'mjs dev' n'a jamais fini son premier build.\n--- sortie ---\n${sortie}`))
    }, 30000)
    proc.stdout!.on('data', (d) => {
      sortie += String(d)
      if (!settled && PREMIER_BUILD.test(sortie)) {
        settled = true
        clearTimeout(abandon)
        resolve({
          stdout: () => sortie,
          kill: () => new Promise((done) => {
            proc.once('close', () => done())
            proc.kill('SIGINT')
            setTimeout(() => proc.kill('SIGKILL'), 5000)
          }),
        })
      }
    })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    proc.on('error', (e) => { if (!settled) { settled = true; clearTimeout(abandon); reject(e) } })
  })
}

async function attendUnCorpsContenant(port: number, motif: RegExp, delaiMaxMs: number): Promise<string> {
  const debut = Date.now()
  let dernier = ''
  while (Date.now() - debut < delaiMaxMs) {
    const res = await fetch(`http://127.0.0.1:${port}/`)
    dernier = await res.text()
    if (motif.test(dernier)) return dernier
    await new Promise(r => setTimeout(r, 200))
  }
  return dernier
}

describe("cli.ts — 'mjs dev' : le rendu SSR par requête suit les recompilations du watcher", function () {
  this.timeout(60000)

  it('édition du composant PENDANT que `mjs dev` tourne → le SSR sert la NOUVELLE version, pas l\'ancienne mémoïsée', async () => {
    const { root, composantPath } = fixtureProject()
    const port = 20000 + Math.floor(Math.random() * 10000)
    const dev = await lancerDevVivant(root, port)
    try {
      const premier = await attendUnCorpsContenant(port, /Accueil-v1/, 10000)
      assert.match(premier, /Accueil-v1/, `1er rendu SSR attendu avec Accueil-v1. dev :\n${dev.stdout()}`)

      // édite le composant SOURCE pendant que le serveur tourne — le watcher doit recompiler.
      writeFileSync(composantPath, composant('Accueil-v2'))

      // BUG confirmé si ce polling n'obtient JAMAIS Accueil-v2 (timeout, sert indéfiniment
      // l'ancienne version mémoïsée par createRenderHandler).
      const second = await attendUnCorpsContenant(port, /Accueil-v2/, 20000)
      assert.match(second, /Accueil-v2/, `BUG confirmé si le SSR sert encore l'ancienne version après recompile. dernier corps reçu :\n${second}\ndev :\n${dev.stdout()}`)
      assert.doesNotMatch(second, /Accueil-v1/, "l'ancien contenu ne doit plus apparaître")
    } finally {
      await dev.kill()
    }
  })
})
