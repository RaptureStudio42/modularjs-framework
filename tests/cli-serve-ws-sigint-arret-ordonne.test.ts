// cli.ts (`mjs serve`), cli/ws.ts (`mjs ws`) — Ctrl+C déclenche un arrêt ORDONNÉ : la requête en
// vol aboutit, le process sort en 0 une fois tout refermé.
//
// Les écouteurs de signal se retiraient dès l'entrée dans l'arrêt, avant la fermeture asynchrone.
// Sous tsx (lancement depuis les sources, `bin/mjs` sans `dist/`), un gestionnaire de signaux posé
// par tsx voyait alors « plus aucun écouteur » et sortait aussitôt en 130 : requête coupée, serveur
// jamais refermé.
//
// Sous-processus RÉELS lancés par le binaire tsx, comme `bin/mjs` en développement ; le signal vise
// l'enfant Node qui exécute cli.ts (cf. tests/cli-dev-sigint-requete-en-vol.test.ts).

import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

interface Lance {
  sortie(): string
  envoyerSigint(): void
  attendreFin(delaiMaxMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

function trouverPidEnfant(pidLanceur: number): number {
  const sortie = execSync(`ps --ppid ${pidLanceur} -o pid= --no-headers`).toString().trim()
  const pid = parseInt(sortie.split('\n')[0]?.trim() ?? '', 10)
  if (!Number.isFinite(pid)) throw new Error(`aucun process enfant trouvé pour le lanceur tsx (pid ${pidLanceur}) : ${JSON.stringify(sortie)}`)
  return pid
}

function lancer(args: string[], pret: RegExp): Promise<Lance> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, ...args], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie  = ''
    let settled = false
    const abandon = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error(`démarrage jamais confirmé.\n--- sortie ---\n${sortie}`))
    }, 40000)
    const lire = (d: Buffer) => {
      sortie += String(d)
      if (settled || !pret.test(sortie)) return
      settled = true
      clearTimeout(abandon)
      resolve({
        sortie: () => sortie,
        envoyerSigint: () => { process.kill(trouverPidEnfant(proc.pid!), 'SIGINT') },
        attendreFin: (delaiMaxMs) => new Promise((done, fail) => {
          const garde = setTimeout(() => { proc.kill('SIGKILL'); fail(new Error(`jamais sorti ${delaiMaxMs}ms après SIGINT.\n--- sortie ---\n${sortie}`)) }, delaiMaxMs)
          proc.once('close', (code, signal) => { clearTimeout(garde); done({ code, signal }) })
        }),
      })
    }
    proc.stdout!.on('data', lire)
    proc.stderr!.on('data', lire)
    proc.on('error', (e) => { if (!settled) { settled = true; clearTimeout(abandon); reject(e) } })
  })
}

describe('Ctrl+C sur `mjs serve` et `mjs ws` lancés par tsx : arrêt ordonné', function () {
  this.timeout(90000)

  it('mjs serve : la requête en vol au moment du SIGINT aboutit, le process sort en 0', async () => {
    const root = mjsTmp('serve-sigint-en-vol')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'lente.mjs'),
      '<script lang="coffee">\n' +
      '$p = new Promise (resolve) -> setTimeout((-> resolve(\'OK\')), 1000)\n' +
      '</script>\n' +
      '<div class="wrap">\n{await $p}\n  <p class="pending">chargement…</p>\n{success val}\n  <p class="done">{val}</p>\n{end}\n</div>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'dist',
      render: { default: 'ssr', engine: { request: 'happy-dom' }, routes: { '/': { component: 'mjs-lente', mode: 'ssr', settleMs: 3000 } } },
    }, null, 2))
    const port  = 20000 + Math.floor(Math.random() * 10000)
    const serve = await lancer(['serve', '--root', root, '--port', String(port)], /mjs serve — rendu par requ/)

    const enVol = fetch(`http://127.0.0.1:${port}/`)
    await new Promise(r => setTimeout(r, 300))
    serve.envoyerSigint()

    const reponse = await enVol.catch((e: any) => { throw new Error(`requête coupée net : ${e?.message || e}\n--- sortie ---\n${serve.sortie()}`) })
    const corps   = await reponse.text()
    assert.equal(reponse.status, 200, corps)
    assert.match(corps, /OK/)
    const { code, signal } = await serve.attendreFin(30000)
    assert.equal(signal, null, `sortie via process.exit attendue : signal=${signal}\n${serve.sortie()}`)
    assert.equal(code, 0, `arrêt ordonné attendu (code 0), reçu ${code}\n${serve.sortie()}`)
  })

  it("mjs serve : un 2e SIGINT plus d'une seconde après le premier coupe tout de suite, même avec un rendu encore en vol", async () => {
    const root = mjsTmp('serve-sigint-force')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tres-lente.mjs'),
      '<script lang="coffee">\n' +
      '$p = new Promise (resolve) -> setTimeout((-> resolve(\'OK\')), 12000)\n' +
      '</script>\n' +
      '<div class="wrap">\n{await $p}\n  <p class="pending">chargement…</p>\n{success val}\n  <p class="done">{val}</p>\n{end}\n</div>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'dist',
      render: { default: 'ssr', engine: { request: 'happy-dom' }, routes: { '/': { component: 'mjs-tres-lente', mode: 'ssr', settleMs: 14000 } } },
    }, null, 2))
    const port  = 20000 + Math.floor(Math.random() * 10000)
    const serve = await lancer(['serve', '--root', root, '--port', String(port)], /mjs serve — rendu par requ/)

    const enVol = fetch(`http://127.0.0.1:${port}/`).catch(() => null)   // coupée par l'arrêt forcé : voulu
    await new Promise(r => setTimeout(r, 300))
    serve.envoyerSigint()
    // l'indice paraît une seconde après le TRAITEMENT du 1er signal (retardé si le rendu occupe la
    // boucle à cet instant) : l'attendre garantit que le 2e tombe au-delà de la fenêtre du doublon
    const echeance = Date.now() + 8000
    while (!/Ctrl\+C (à nouveau|again)/.test(serve.sortie()) && Date.now() < echeance) await new Promise(r => setTimeout(r, 50))
    assert.match(serve.sortie(), /Ctrl\+C (à nouveau|again)/, `l'arrêt qui attend doit dire comment couper tout de suite\n${serve.sortie()}`)
    await new Promise(r => setTimeout(r, 100))
    const avantSecond = Date.now()
    serve.envoyerSigint()
    const { code, signal } = await serve.attendreFin(30000)
    const delai = Date.now() - avantSecond
    assert.ok(delai < 4000, `sortie attendue aussitôt après le 2e SIGINT, mesuré ${delai}ms (le rendu, lui, dure 12 s)\n${serve.sortie()}`)
    assert.equal(signal, null, `sortie via process.exit attendue : signal=${signal}\n${serve.sortie()}`)
    assert.equal(code, 0, `sortie en 0 attendue, reçu ${code}\n${serve.sortie()}`)
    await enVol
  })

  it('mjs ws : SIGINT referme le serveur et sort en 0', async () => {
    const root = mjsTmp('ws-sigint')
    writeFileSync(join(root, 'ws.server.mjs'), 'export default {\n  setup: (app) -> null\n}\n')
    const port = 20000 + Math.floor(Math.random() * 10000)
    const ws   = await lancer(['ws', '--root', root, '--port', String(port)], /Ctrl-C pour arrêter/)

    ws.envoyerSigint()
    const { code, signal } = await ws.attendreFin(30000)
    assert.equal(signal, null, `sortie via process.exit attendue : signal=${signal}\n${ws.sortie()}`)
    assert.equal(code, 0, `arrêt ordonné attendu (code 0), reçu ${code}\n${ws.sortie()}`)
  })
})
