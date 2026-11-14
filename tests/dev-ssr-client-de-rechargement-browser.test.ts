// `mjs dev` : une page servie par un bloc `render` (rendu serveur, client seul, prérendu, page en flux)
// reçoit le client de rechargement, comme une page HTML de la racine du projet. Sans lui, la page
// ouverte ne réagissait à aucune sauvegarde (ni échange à chaud, ni rechargement) : il fallait
// recharger à la main. `mjs serve` ne le pose jamais.
//
// Sous-processus RÉEL (`mjs dev`, watcher actif), puis la page rendue par le serveur ouverte dans
// les trois navigateurs : le client s'y connecte, une sauvegarde du composant enfant s'y voit.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const repoRoot      = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin        = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath       = join(repoRoot, 'src', 'cli.ts')
const CLIENT        = '<script src="/__mjs_hmr/client.js"></script>'
const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/
const CONNECTE      = /^\[HMR\] (connecté|connected)/

const ROUTES = {
  '/':     { component: 'mjs-app-page', mode: 'ssr' },
  '/csr':  { component: 'mjs-app-page', mode: 'csr' },
  '/pre':  { component: 'mjs-app-page', mode: 'prerender' },
  '/flux': { component: 'mjs-app-page', mode: 'ssr', stream: true },
}

// texte du composant enfant, lu au travers des deux racines d'ombre
const LIRE_ENFANT = `(() => {
  const page = document.querySelector('mjs-app-page')
  const r1   = page && (page._shadow || page.shadowRoot)
  const e    = r1 && r1.querySelector('mjs-app-enfant')
  const r2   = e && (e._shadow || e.shadowRoot)
  const p    = r2 && r2.querySelector('p')
  return p ? p.textContent : null
})()`

const enfant = (texte: string) => `<p class="e">${texte}</p>\n`

function projet(): { root: string; config: any; enfantPath: string } {
  const root = mjsTmp('dev-ssr-client-rechargement')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  const enfantPath = join(src, 'app-enfant.mjs')
  writeFileSync(enfantPath, enfant('Enfant-0'))
  writeFileSync(join(src, 'app-page.mjs'), '<h1 class="t">Page</h1>\n<mjs-app-enfant></mjs-app-enfant>\n')
  const config = { sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/manifest.js', render: { default: 'ssr', routes: ROUTES } }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return { root, config, enfantPath }
}

interface DevProc { port: number; stdout(): string; kill(): Promise<void> }

function lancerDev(root: string, port: number): Promise<DevProc> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie  = ''
    let settled = false
    const abandon = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error(`'mjs dev' n'a jamais fini son premier build.\n--- sortie ---\n${sortie}`))
    }, 45000)
    proc.stdout!.on('data', (d) => {
      sortie += String(d)
      if (!settled && PREMIER_BUILD.test(sortie)) {
        settled = true
        clearTimeout(abandon)
        resolve({
          port,
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

describe('mjs dev — une page rendue par le serveur reçoit le client de rechargement', function () {
  this.timeout(90000)
  let dev: DevProc | null = null
  let root: string, config: any, enfantPath: string
  let version = 0

  before(async function () {
    this.timeout(60000)
    ;({ root, config, enfantPath } = projet())
    dev = await lancerDev(root, 22000 + Math.floor(Math.random() * 8000))
  })

  after(async () => {
    if (dev) await dev.kill()
    await terminateSharedWorkerPool()
  })

  it('rendu serveur, client seul, prérendu, page en flux : le client est posé une fois, avant </body>', async () => {
    for (const chemin of Object.keys(ROUTES)) {
      const res  = await fetch(`http://127.0.0.1:${dev!.port}${chemin}`)
      const html = await res.text()
      assert.equal(res.status, 200, `${chemin} : statut`)
      assert.equal(html.split(CLIENT).length - 1, 1, `${chemin} : client de rechargement attendu une fois dans la page\n${html}`)
      assert.ok(html.indexOf(CLIENT) < html.lastIndexOf('</body>'), `${chemin} : client attendu avant </body>\n${html}`)
    }
  })

  it('mjs serve ne pose jamais le client', async function () {
    this.timeout(30000)
    const serve = await startRenderServer(config, root, { port: 0 })
    try {
      for (const chemin of Object.keys(ROUTES)) {
        const html = await (await fetch(`http://127.0.0.1:${serve.port}${chemin}`)).text()
        assert.ok(html.includes('</body>'), `${chemin} : page attendue\n${html}`)
        assert.ok(!html.includes('__mjs_hmr'), `${chemin} : aucun client de rechargement sous mjs serve\n${html}`)
      }
    } finally {
      await serve.close()
    }
  })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : la page rendue par le serveur suit la sauvegarde d'un composant`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        let connecte = false
        page.on('console', (m) => { if (CONNECTE.test(m.text())) connecte = true })
        await page.goto(`http://127.0.0.1:${dev!.port}/`)
        const attendre = async (quoi: string, ok: () => Promise<boolean>, delaiMs: number) => {
          const fin = Date.now() + delaiMs
          while (Date.now() < fin) {
            if (await ok()) return
            await new Promise(r => setTimeout(r, 50))
          }
          assert.fail(`${moteur} : ${quoi}\n--- mjs dev ---\n${dev!.stdout()}`)
        }
        const lire = () => page.evaluate(LIRE_ENFANT).catch(() => null) as Promise<string | null>
        await attendre(`page ouverte sans Enfant-${version}`, async () => await lire() === `Enfant-${version}`, 15000)
        await attendre('client de rechargement jamais connecté dans la page rendue par le serveur', async () => connecte, 10000)
        version++
        writeFileSync(enfantPath, enfant(`Enfant-${version}`))
        await attendre(`sauvegarde sans effet dans la page ouverte (Enfant-${version} attendu, vu ${await lire()})`, async () => await lire() === `Enfant-${version}`, 20000)
      } finally {
        await browser.close()
      }
    })
  }
})
