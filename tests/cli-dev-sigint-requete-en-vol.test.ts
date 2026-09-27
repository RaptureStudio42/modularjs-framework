// cli.ts — `mjs dev` : à l'arrêt (SIGINT), une requête HTTP RÉELLEMENT en vol (le composant SSR
// est encore en train de se stabiliser, moteur navigateur) ne doit jamais être coupée net.
//
// Avant correctif (cli/dev-lock.ts) : `shutdown()` enchaînait `await onShutdown?.()` (ferme le
// RenderHandler) puis `process.exit(0)` SANS AUCUNE borne — un `onShutdown` qui traînerait (ou une
// régression qui lui ferait perdre sa garantie d'attendre le rendu actif, cf. render-browser.ts/
// render-request.ts) n'avait alors plus aucun filet : `process.exit(0)` termine le process
// IMMÉDIATEMENT, la socket HTTP de la réponse en cours d'écriture avec elle.
//
// Sous-processus RÉEL (`mjs dev`, moteur navigateur, vrai Chromium) : lance le serveur, démarre une
// requête SSR volontairement lente, envoie SIGINT PENDANT qu'elle est en vol, vérifie la réponse
// complète ET l'arrêt propre et borné du process.

import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

async function isChromiumAvailable(): Promise<boolean> {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
}

// composant volontairement LENT (~1s) : garantit que la requête est encore EN VOL (page.evaluate
// en cours côté navigateur) au moment où le signal arrive, sans dépendre d'un minutage serré.
function fixtureProjectLent(): string {
  const root = mjsTmp('dev-sigint-en-vol')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'lente.mjs'),
    '<script lang="coffee">\n' +
    '$p = new Promise (resolve) -> setTimeout((-> resolve(\'OK\')), 1000)\n' +
    '</script>\n' +
    '<div class="wrap">\n{await $p}\n  <p class="pending">chargement…</p>\n{success val}\n  <p class="done">{val}</p>\n{end}\n</div>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'public/modularjs',
    render: { default: 'ssr', engine: { request: 'browser' }, routes: { '/': { component: 'mjs-lente', mode: 'ssr', settleMs: 3000 } } },
  }, null, 2))
  return root
}

interface DevProc {
  stdout(): string
  envoyerSigint(): void
  attendreArret(delaiMaxMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null; dureeMs: number }>
}

/** PID du VRAI process Node qui exécute cli.ts — `tsx <fichier>` (le binaire lancé par `spawn`
 *  plus bas, même sous-processus que `bin/mjs` utilise en développement) n'est qu'un lanceur fin :
 *  il exécute lui-même un ENFANT Node avec ses hooks de chargement TS (`--import
 *  .../tsx/dist/loader.mjs`), constaté par inspection réelle de l'arbre de process. Un SIGINT
 *  envoyé au LANCEUR ne relaie PAS ici de façon fiable vers cet enfant hors terminal interactif
 *  (aucun TTY, aucun groupe de process partagé par la simple invocation `proc.kill()`) — il faut
 *  cibler ce PID enfant pour que le VRAI gestionnaire SIGINT (`cli/dev-lock.ts`, celui que ce test
 *  vérifie) le reçoive.
 */
function trouverPidEnfant(pidLanceur: number): number {
  const sortie = execSync(`ps --ppid ${pidLanceur} -o pid= --no-headers`).toString().trim()
  const pid = parseInt(sortie.split('\n')[0]?.trim() ?? '', 10)
  if (!Number.isFinite(pid)) throw new Error(`aucun process enfant trouvé pour le lanceur tsx (pid ${pidLanceur}) : ${JSON.stringify(sortie)}`)
  return pid
}

/** `mjs dev` (vrai sous-processus tsx, comme bin/mjs en fait usage en développement) sur un projet
 *  jetable, laissé VIVANT après son premier build — même patron que
 *  tests/dev-ssr-invalidation-recompile.test.ts. */
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

describe("cli.ts — 'mjs dev' (moteur navigateur) : arrêt SIGINT pendant une requête HTTP en vol", function () {
  this.timeout(60000)

  it('une réponse SSR en train de se calculer au moment du SIGINT aboutit intégralement, et le process termine en quelques secondes', async function () {
    const chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) { this.skip(); }
    const root = fixtureProjectLent()
    const port = 20000 + Math.floor(Math.random() * 10000)
    const dev = await lancerDevVivant(root, port)

    // Un premier rendu COMPLET d'abord : Chromium est lancé (ici ~800 ms), donc Playwright a
    // posé ses propres gestionnaires de signaux (il les installe au lancement du navigateur,
    // `handleSIGINT` vrai par défaut). Sans cette mise en chauffe, un SIGINT envoyé avant ne
    // testait que l'instant qui évite le défaut, jamais l'arrêt ordonné réclamé ici.
    const chaud = await fetch(`http://127.0.0.1:${port}/`)
    await chaud.text()
    assert.equal(chaud.status, 200, `premier rendu attendu avant l'envoi du signal : status=${chaud.status}\n--- sortie dev ---\n${dev.stdout()}`)

    // requête HTTP RÉELLEMENT en vol — laisse le temps au rendu de VRAIMENT démarrer (acquisition
    // du pool + navigation Playwright) avant d'envoyer SIGINT, largement avant sa fin (~1s).
    const enVol = fetch(`http://127.0.0.1:${port}/`).catch(e => {
      throw new Error(`BUG confirmé si la requête en vol est coupée net (connexion perdue) : ${e?.message || e}\n--- sortie dev ---\n${dev.stdout()}`)
    })
    await new Promise(r => setTimeout(r, 200))
    dev.envoyerSigint()

    const reponse = await enVol
    const corps = await reponse.text()
    assert.equal(reponse.status, 200,
      `BUG confirmé si la réponse en vol au moment du SIGINT est coupée net : status=${reponse.status}\n${corps}\n--- sortie dev ---\n${dev.stdout()}`)
    assert.match(corps, /OK/, `réponse incomplète/coupée : ${JSON.stringify(corps)}`)

    const { code, signal, dureeMs } = await dev.attendreArret(10000)
    assert.ok(dureeMs < 10000, `le process doit terminer en quelques secondes après SIGINT, mesuré ${dureeMs}ms`)
    // sortie propre attendue : `process.exit(0)` (dev-lock.ts) après le délai de grâce borné —
    // jamais le comportement PAR DÉFAUT du signal (qui laisserait `signal` renseigné, `code` nul).
    assert.equal(signal, null, `sortie via process.exit(0) attendue, pas par le signal brut : signal=${signal} code=${code}\n${dev.stdout()}`)
    assert.equal(code, 0, `sortie propre attendue (code 0) : code=${code} signal=${signal}\n${dev.stdout()}`)
  })
})
