// `mjs dev` : le navigateur était notifié (canal HMR, message `{type:'reload'}`) AVANT que le
// prérendu (`render.routes` en mode `prerender`) ait fini de réécrire le fichier HTML figé sur
// disque — un reload déclenché à la réception du message pouvait donc recharger sur le contenu
// PÉRIMÉ d'avant l'édition. Le fix fait attendre la fin de la passe de prérendu (cf.
// cli/dev-prerender.ts, createDevPrerenderScheduler) AVANT de notifier.
//
// Sous-processus RÉEL (`mjs dev`, watcher actif) + un VRAI client WebSocket sur le canal HMR :
// dès réception du message de rechargement suivant l'édition, on lit IMMÉDIATEMENT (readFileSync,
// aucun délai) le fichier prérendu sur disque.
//
// Le tout PREMIER build (au démarrage de `mjs dev`, avant même notre édition) diffuse LUI AUSSI un
// message de rechargement, une fois son propre prérendu terminé — un test qui se contenterait
// d'examiner le PREMIER message reçu confondrait parfois celui-ci avec celui de l'édition qui nous
// intéresse (course dépendant de l'instant où la connexion WS atterrit, aggravée sous charge :
// l'ordre relatif entre « le fichier prérendu du build initial devient lisible » et « son message de
// rechargement est réellement envoyé sur le socket » n'est pas garanti côté observateur externe).
// Fix DÉTERMINISTE, sans dépendre d'aucun minutage : la connexion WS est établie DÈS le lancement du
// process (avant même la fin du premier build — le serveur HTTP/WS démarre avant toute compilation,
// cf. cli.ts, `server.start()` puis `bundler.watch()`), ce qui garantit de ne JAMAIS rater son
// message ; le 1ᵉʳ message reçu est alors FORCÉMENT celui du build initial (consommé sans examen), le
// 2ᵉ FORCÉMENT celui de notre édition (seule celle-ci peut déclencher un 3ᵉ recompile) — identification
// par RANG, jamais par horodatage relatif à notre propre écriture.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

function composant(titre: string): string {
  return `<script>\n$titre = '${titre}'\n</script>\n\n<h1 class="t">{$titre}</h1>\n`
}

function fixtureProject(): { root: string; composantPath: string; pagePath: string } {
  const root = mjsTmp('dev-hmr-attend-prerendu')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  const composantPath = join(srcDir, 'app-home.mjs')
  writeFileSync(composantPath, composant('Accueil-v1'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'public/modularjs',
    render: { default: 'prerender', routes: { '/': { component: 'mjs-app-home' } } },
  }, null, 2))
  // pagesDir par défaut : dirname(outputDir)/mjs_pages, cf. server/render-request.ts
  const pagePath = join(root, 'public', 'mjs_pages', 'index.html')
  return { root, composantPath, pagePath }
}

interface DevProc { port: number; stdout(): string; kill(): Promise<void> }

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

/** Connecte le canal HMR en boucle de réessai (le serveur peut ne pas encore écouter à l'instant
 *  du tout 1er essai) — appelée EN PARALLÈLE du lancement du process (cf. l'appelant), jamais après
 *  coup, pour ne rater aucun message diffusé tôt (cf. en-tête de fichier). */
function connecterHMRTot(port: number, delaiMaxMs: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const debut = Date.now()
    const essaie = () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`)
      ws.once('open', () => resolve(ws))
      ws.once('error', () => {
        ws.terminate()
        if (Date.now() - debut > delaiMaxMs) { reject(new Error("connexion au canal HMR jamais établie")); return }
        setTimeout(essaie, 20)
      })
    }
    essaie()
  })
}

describe("cli.ts — 'mjs dev' : le rechargement HMR attend la fin du prérendu", function () {
  this.timeout(60000)

  it('le fichier prérendu est DÉJÀ à jour au moment où le navigateur reçoit le signal de recharger', async () => {
    const { root, composantPath, pagePath } = fixtureProject()
    const port = 21000 + Math.floor(Math.random() * 9000)
    // Lancées EN PARALLÈLE (aucun `await` entre les deux) : la connexion HMR démarre AVANT même
    // que le premier build ne débute, cf. en-tête de fichier.
    const devPromise = lancerDevVivant(root, port)
    const wsPromise = connecterHMRTot(port, 30000)
    const dev = await devPromise
    const ws = await wsPromise

    try {
      // Compte les messages de rechargement REÇUS DANS L'ORDRE — le rang identifie sans ambiguïté
      // le build initial (1er) vs notre édition (2ᵉ), cf. en-tête de fichier : jamais de dépendance
      // à un horodatage relatif à notre propre écriture.
      let recus = 0
      const attendreRang = (rang: number, delaiMs: number): Promise<void> => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.off('message', surMessage); reject(new Error(`message HMR de rang ${rang} jamais reçu à temps. dev :\n${dev.stdout()}`)) }, delaiMs)
        function surMessage(data: WebSocket.RawData): void {
          const msg = JSON.parse(data.toString())
          if (msg.type !== 'reload' && msg.type !== 'css-update') return
          recus++
          if (recus !== rang) return
          clearTimeout(timer)
          ws.off('message', surMessage)
          resolve()
        }
        ws.on('message', surMessage)
      })

      // 1er message : celui du build INITIAL — jamais examiné (pas notre affaire ICI), juste
      // consommé pour ne pas le confondre avec le 2ᵉ.
      await attendreRang(1, 20000)

      // édite le composant SOURCE pendant que le serveur tourne — déclenche recompile + prérendu.
      writeFileSync(composantPath, composant('Accueil-v2'))

      // 2ᵉ message : ne peut être QUE celui de CETTE édition (rien d'autre ne recompile ici).
      // Lecture IMMÉDIATE, sans le moindre délai — c'est exactement ce qu'un vrai navigateur
      // ferait en enchaînant sur location.reload() dès réception de CE message.
      await attendreRang(2, 20000)
      const contenu = readFileSync(pagePath, 'utf-8')
      // BUG confirmé si le fichier prérendu contient ENCORE Accueil-v1 (ou n'importe quoi d'autre
      // que Accueil-v2) au moment précis où le signal de rechargement arrive : le navigateur aurait
      // rechargé sur du contenu périmé.
      assert.match(contenu, /Accueil-v2/, `BUG confirmé si le fichier prérendu n'est pas encore à jour au moment du signal HMR. contenu lu :\n${contenu}\ndev :\n${dev.stdout()}`)
      ws.close()
    } finally {
      await dev.kill()
    }
  })
})
