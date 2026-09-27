// cli.ts — `mjs dev` sans bloc `render` : à l'arrêt (SIGINT), un fichier du projet en cours
// d'envoi doit arriver en entier, et l'arrêt doit rester immédiat quand rien n'est en vol.
//
// Le rappel d'arrêt fermait le moteur de rendu et le chargeur d'actions, jamais le serveur HTTP
// lui-même : `process.exit(0)` coupait net une réponse encore en cours d'écriture (client lent,
// gros fichier), sans aucun rendu serveur en jeu.
//
// Sous-processus RÉEL (`mjs dev`), aucun navigateur : le client TCP lit le début de la réponse,
// se met en pause (l'envoi reste en vol côté serveur), puis reprend la lecture après le signal.

import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/
const TAILLE        = 48 * 1024 * 1024

function fixtureProjet(prefixe: string): string {
  const root = mjsTmp(prefixe)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.mjs'), '<p>app</p>\n')
  writeFileSync(join(root, 'gros.bin'), Buffer.alloc(TAILLE, 7))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs' }, null, 2))
  return root
}

interface DevProc {
  stdout(): string
  envoyerSigint(): void
  attendreArret(delaiMaxMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null; dureeMs: number }>
}

// `tsx <fichier>` lance un enfant Node qui exécute cli.ts : le signal doit viser cet enfant (cf.
// tests/cli-dev-sigint-requete-en-vol.test.ts, même patron)
function trouverPidEnfant(pidLanceur: number): number {
  const sortie = execSync(`ps --ppid ${pidLanceur} -o pid= --no-headers`).toString().trim()
  const pid = parseInt(sortie.split('\n')[0]?.trim() ?? '', 10)
  if (!Number.isFinite(pid)) throw new Error(`aucun process enfant trouvé pour le lanceur tsx (pid ${pidLanceur}) : ${JSON.stringify(sortie)}`)
  return pid
}

function lancerDevVivant(root: string, port: number): Promise<DevProc> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie  = ''
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
          envoyerSigint: () => { process.kill(trouverPidEnfant(proc.pid!), 'SIGINT') },
          attendreArret: (delaiMaxMs) => new Promise((done, fail) => {
            const debut = Date.now()
            const watchdog = setTimeout(() => {
              proc.kill('SIGKILL')
              fail(new Error(`le process 'mjs dev' n'a jamais quitté ${delaiMaxMs}ms après SIGINT.\n--- sortie ---\n${sortie}`))
            }, delaiMaxMs)
            proc.once('close', (code, signal) => { clearTimeout(watchdog); done({ code, signal, dureeMs: Date.now() - debut }) })
          }),
        })
      }
    })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    proc.on('error', (e) => { if (!settled) { settled = true; clearTimeout(abandon); reject(e) } })
  })
}

describe("cli.ts — 'mjs dev' sans rendu serveur : arrêt SIGINT et serveur HTTP", function () {
  this.timeout(60000)

  it('un gros fichier en cours d’envoi au moment du SIGINT arrive en entier, puis le process sort proprement', async function () {
    const root = fixtureProjet('dev-sigint-fichier')
    const port = 20000 + Math.floor(Math.random() * 10000)
    const dev  = await lancerDevVivant(root, port)

    const recu = await new Promise<{ entete: string; corps: number }>((resolve) => {
      const sock      = connect(port, '127.0.0.1')
      const morceaux: Buffer[] = []
      let signale     = false
      sock.on('connect', () => sock.write(`GET /gros.bin HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`))
      sock.on('data', (d: Buffer) => {
        morceaux.push(d)
        if (signale) return
        signale = true
        // client lent : l'envoi reste en vol côté serveur pendant l'arrêt
        sock.pause()
        dev.envoyerSigint()
        setTimeout(() => sock.resume(), 800)
      })
      // coupure nette = ECONNRESET possible : le constat se fait sur la taille reçue
      sock.on('error', () => {})
      sock.on('close', () => {
        const tout = Buffer.concat(morceaux)
        const fin  = tout.indexOf('\r\n\r\n')
        resolve({ entete: tout.subarray(0, Math.max(fin, 0)).toString(), corps: fin < 0 ? 0 : tout.length - fin - 4 })
      })
    })

    assert.match(recu.entete, /^HTTP\/1\.1 200/, `réponse inattendue : ${recu.entete}\n--- sortie dev ---\n${dev.stdout()}`)
    assert.equal(recu.corps, TAILLE, `fichier coupé net à l'arrêt : ${recu.corps} octets reçus sur ${TAILLE}`)

    const { code, signal } = await dev.attendreArret(15000)
    assert.equal(signal, null, `sortie via process.exit(0) attendue : signal=${signal}\n${dev.stdout()}`)
    assert.equal(code, 0, `sortie propre attendue : code=${code}\n${dev.stdout()}`)
  })

  it('page ouverte (canal de rechargement) et connexion gardée ouverte : l’arrêt reste immédiat', async function () {
    const root = fixtureProjet('dev-sigint-repos')
    const port = 20000 + Math.floor(Math.random() * 10000)
    const dev  = await lancerDevVivant(root, port)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`, { headers: { Origin: `http://127.0.0.1:${port}` } })
    await new Promise<void>((resolve, reject) => {
      ws.once('message', () => resolve())
      ws.once('error', reject)
    })
    // connexion HTTP restée ouverte au repos après sa réponse (keep-alive de fetch)
    const reponse = await fetch(`http://127.0.0.1:${port}/app-absente.txt`)
    await reponse.text()

    dev.envoyerSigint()
    const { code, signal, dureeMs } = await dev.attendreArret(15000)
    ws.terminate()
    assert.equal(signal, null, `sortie via process.exit(0) attendue : signal=${signal}\n${dev.stdout()}`)
    assert.equal(code, 0, `sortie propre attendue : code=${code}\n${dev.stdout()}`)
    assert.ok(dureeMs < 3000, `l'arrêt doit rester immédiat sans requête en vol, mesuré ${dureeMs}ms`)
  })
})
