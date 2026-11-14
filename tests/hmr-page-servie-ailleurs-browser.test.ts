// `mjs dev` réel, page servie par un AUTRE serveur (comme Rails : il sert la page et les sorties de `public/`, la page demande le client
// de rechargement au port de `mjs dev`), trois navigateurs : un composant, une feuille `.sass`, un `.yml` de traduction, un module
// importé et une classe changés passent à chaud, sans recharger la page — l'état du composant (`$n`) et l'adresse (la route) restent.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

const composant = (v: number) => ['@import { marque } \'outils.civet.mjs\'', '<script>', '$n = 0', '$d = µt(\'salut\', { n: $n })', 'plus = -> $n++', '</script>', '', '<button class="plus" @click={plus}>+</button>', `<p class="v">V${v} {$n} {marque()} {µTheme.nom} {µt('salut')}</p>`, '<p class="d">{$d}</p>', '<style :css="carte"></style>'].join('\n') + '\n'
const feuille   = (c: string) => `p\n  color: ${c}\n`
const module_   = (m: string) => `export const marque = -> '${m}'\n`
const classe    = (c: string) => `class Theme\n  nom = '${c}'\n`
const section   = ['@i18n \'admin\'', '<p class="s">S {µt(\'titre\')}</p>'].join('\n') + '\n'

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-page-servie-ailleurs')
  const src  = join(root, 'src')
  mkdirSync(join(src, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(src, 'styles'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', stylesheetsDir: 'src/styles', i18n: { default: 'fr' } }))
  writeFileSync(join(src, 'i18n', 'fr.yml'), 'salut: "Bonjour v1"\n')
  writeFileSync(join(src, 'styles', 'carte.sass'), feuille('rgb(1, 2, 3)'))
  writeFileSync(join(src, 'outils.civet.mjs'), module_('M1'))
  writeFileSync(join(src, 'Theme.class.mjs'), classe('C1'))
  writeFileSync(join(src, 'i18n', 'fr', 'admin.yml'), 'titre: "Titre v1"\n')
  writeFileSync(join(src, 'compteur.mjs'), composant(1))
  writeFileSync(join(src, 'section.mjs'), section)
  return { root, src }
}

// le serveur de l'appli (Rails) : la page à toute adresse, les fichiers de `public/` tels que `mjs dev` les écrit
function serveurAppli(root: string, portDev: number): Promise<{ port: number, close(): Promise<void> }> {
  const page = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script><script src="http://127.0.0.1:${portDev}/__mjs_hmr/client.js"></script></head><body><mjs-compteur id="c"></mjs-compteur><mjs-section id="s"></mjs-section></body></html>`
  const srv: Server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin.startsWith('/modularjs/')) {
      const fichier = normalize(join(root, 'public', chemin))
      if (!fichier.startsWith(join(root, 'public')) || !existsSync(fichier)) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': fichier.endsWith('.json') ? 'application/json' : fichier.endsWith('.css') ? 'text/css' : 'text/javascript' })
      res.end(readFileSync(fichier))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    const port = (srv.address() as any).port as number
    resolve({ port, close: () => new Promise<void>((done) => { srv.closeAllConnections(); srv.close(() => done()) }) })
  }))
}

interface Dev { stdout(): string, kill(): Promise<void> }

function lancerDev(root: string, port: number): Promise<Dev> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    let fini   = false
    const abandon = setTimeout(() => {
      if (fini) return
      fini = true
      proc.kill('SIGKILL')
      reject(new Error(`'mjs dev' n'a jamais fini son premier build.\n${sortie}`))
    }, 90000)
    proc.stdout!.on('data', (d) => {
      sortie += String(d)
      if (fini || !PREMIER_BUILD.test(sortie)) return
      fini = true
      clearTimeout(abandon)
      resolve({
        stdout: () => sortie,
        kill: () => new Promise((done) => {
          proc.once('close', () => done())
          proc.kill('SIGINT')
          setTimeout(() => proc.kill('SIGKILL'), 5000)
        }),
      })
    })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    proc.on('error', (e) => { if (!fini) { fini = true; clearTimeout(abandon); reject(e) } })
  })
}

const ADRESSE = '/compte/profil?onglet=2#bas'
const pause   = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('mjs dev — page servie par un autre serveur : composant, .sass, .yml, module et classe à chaud, état et route gardés ; section de traduction rechargée (trois navigateurs)', function () {
  this.timeout(300000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    describe(moteur, function () {
      let dev: Dev | null = null
      let appli: { port: number, close(): Promise<void> } | null = null
      let browser: any    = null
      let page: any       = null
      let src             = ''
      const sortie  = () => dev ? dev.stdout() : ''
      const texte   = (hote: string, sel: string) => page.evaluate(`(() => { const h = document.querySelector("${hote}"); const p = h && h._shadow && h._shadow.querySelector("${sel}"); return p ? p.textContent.trim() : null })()`).catch(() => null) as Promise<string | null>
      const lire    = () => texte('#c', '.v')
      const couleur = () => page.evaluate('(() => { const h = document.querySelector("#c"); const p = h && h._shadow && h._shadow.querySelector(".v"); return p ? getComputedStyle(p).color : null })()').catch(() => null) as Promise<string | null>
      const attendre = async (lu: () => Promise<string | null>, attendu: string, quoi: string) => {
        const fin = Date.now() + 20000
        let vu: string | null = null
        while (Date.now() < fin) {
          vu = await lu()
          if (vu === attendu) return
          await pause(50)
        }
        assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${sortie()}`)
      }
      // la page n'a pas été rechargée (sa marque reste) et son adresse n'a pas bougé
      const garde = async (quoi: string) => {
        assert.equal(await page.evaluate('window.__marque').catch(() => 'navigation'), 1, `${quoi} : la page a été rechargée\n--- mjs dev ---\n${sortie()}`)
        assert.equal(await page.evaluate('location.pathname + location.search + location.hash'), ADRESSE, `${quoi} : adresse changée`)
      }
      // un clic de plus avant chaque changement : un rechargement remettrait `$n` à 0
      const clic = async () => {
        const avant = await lire()
        await page.evaluate('window.__marque = 1; document.querySelector("#c")._shadow.querySelector(".plus").click()')
        const n = Number((avant ?? '').split(' ')[1]) + 1
        await attendre(lire, (avant ?? '').replace(/^(\S+) \d+/, `$1 ${n}`), 'clic')
        return n
      }

      before(async function () {
        const playwright = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) this.skip()
        const p    = projet()
        src        = p.src
        const port = 22000 + Math.floor(Math.random() * 8000)
        dev        = await lancerDev(p.root, port)
        appli      = await serveurAppli(p.root, port)
        browser    = await playwright[moteur].launch()
        page       = await browser.newPage()
        await page.goto(`http://localhost:${appli.port}${ADRESSE}`)
        await attendre(lire, 'V1 0 M1 C1 Bonjour v1', 'premier rendu')
        // client connecté au serveur de `mjs dev` avant le premier changement
        const fin = Date.now() + 10000
        while (Date.now() < fin && !/connect/i.test(sortie() + await page.evaluate('String(window.__mjsHmrOk || "")'))) await pause(100)
        await pause(300)
      })

      after(async () => {
        if (browser) await browser.close()
        if (appli) await appli.close()
        if (dev) await dev.kill()
      })

      it('composant changé : à chaud, `$n` et adresse gardés', async () => {
        const n = await clic()
        writeFileSync(join(src, 'compteur.mjs'), composant(2))
        await attendre(lire, `V2 ${n} M1 C1 Bonjour v1`, 'composant v2')
        await garde('composant v2')
      })

      it('feuille .sass changée : style remplacé, sans recharger', async () => {
        const n = await clic()
        assert.equal(await couleur(), 'rgb(1, 2, 3)')
        writeFileSync(join(src, 'styles', 'carte.sass'), feuille('rgb(4, 5, 6)'))
        await attendre(couleur, 'rgb(4, 5, 6)', 'feuille v2')
        await garde('feuille v2')
        assert.equal(await lire(), `V2 ${n} M1 C1 Bonjour v1`)
      })

      it('.yml de traduction changé : textes refaits, sans recharger', async () => {
        const n = await clic()
        writeFileSync(join(src, 'i18n', 'fr.yml'), 'salut: "Bonjour v2"\n')
        await attendre(lire, `V2 ${n} M1 C1 Bonjour v2`, 'traduction v2')
        await garde('traduction v2')
        await attendre(() => texte('#c', '.d'), 'Bonjour v2', 'dérivée qui traduit')
      })

      // limite : une section (`i18n/<langue>/<section>.yml`) garde son adresse d'un tour à l'autre, la page se recharge pour la relire
      it('section de traduction changée : textes refaits, la page rechargée', async () => {
        await clic()
        await attendre(() => texte('#s', '.s'), 'S Titre v1', 'section v1')
        writeFileSync(join(src, 'i18n', 'fr', 'admin.yml'), 'titre: "Titre v2"\n')
        await attendre(() => texte('#s', '.s'), 'S Titre v2', 'section v2')
        assert.equal(await page.evaluate('location.pathname + location.search + location.hash'), ADRESSE, 'section v2 : adresse changée')
      })

      it('module importé changé : le composant qui l\'importe refait, sans recharger', async () => {
        const n = await clic()
        writeFileSync(join(src, 'outils.civet.mjs'), module_('M2'))
        await attendre(lire, `V2 ${n} M2 C1 Bonjour v2`, 'module v2')
        await garde('module v2')
      })

      it('classe changée : le composant qui la cite refait, sans recharger', async () => {
        const n = await clic()
        writeFileSync(join(src, 'Theme.class.mjs'), classe('C2'))
        await attendre(lire, `V2 ${n} M2 C2 Bonjour v2`, 'classe v2')
        await garde('classe v2')
        await clic()
      })
    })
  }
})
