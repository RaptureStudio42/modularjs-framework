// `mjs dev` réel et trois navigateurs : à l'échange à chaud d'un composant, ses minuteries µevery suivent son ancienne instance.
// Celle qu'un gestionnaire a lancée s'arrête (le nouveau code ne la relance pas : son déclencheur, le clic, n'a pas eu lieu) ; celle
// de la racine du <script> repart avec le nouveau code, une seule fois (l'ancienne ne tire plus) ; l'état `$` passe tel quel.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

// la racine ajoute `pas` à $fond toutes les 40 ms ; le bouton lance un chronomètre qui compte dans $chrono
const chrono = (titre: string, pas: number) => [
  '<script>',
  '$fond = 0',
  '$chrono = 0',
  `µevery 40, immediate: false, -> $fond += ${pas}`,
  'demarrer = ->',
  '  µevery 40, immediate: false, -> $chrono++',
  '</script>',
  '',
  `<p class="titre">${titre}</p>`,
  '<button class="go" @click={demarrer}>Démarrer</button>',
  '<p class="vu">{$fond} {$chrono}</p>',
].join('\n') + '\n'

function projet(): { root: string, src: string } {
  const root = mjsTmp('minuteries-a-chaud')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-chrono id="a"></mjs-chrono></body></html>')
  writeFileSync(join(src, 'chrono.mjs'), chrono('Chrono v1', 1))
  return { root, src }
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
    }, 60000)
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('mjs dev — minuteries µevery à l\'échange à chaud d\'un composant (trois navigateurs)', function () {
  this.timeout(180000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : celle du gestionnaire s'arrête, celle de la racine repart avec le nouveau code, l'état reste`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port          = 22000 + Math.floor(Math.random() * 8000)
      const dev           = await lancerDev(root, port)
      const browser       = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e) => erreurs.push(String(e)))
        const lire  = (js: string) => page.evaluate(js) as Promise<any>
        const etat  = (k: string) => lire(`document.querySelector('#a')._state[${JSON.stringify(k)}]`) as Promise<number>
        const titre = () => lire('document.querySelector(\'#a\')._shadow?.querySelector(\'.titre\')?.textContent ?? null') as Promise<string | null>
        const attendre = async (cond: () => Promise<boolean>, quoi: string) => {
          const fin = Date.now() + 20000
          while (Date.now() < fin) {
            if (await cond().catch(() => false)) return
            await pause(30)
          }
          assert.fail(`${quoi}\n--- mjs dev ---\n${dev.stdout()}\n--- erreurs de la page ---\n${erreurs.join('\n')}`)
        }

        await page.goto(`http://127.0.0.1:${port}/`)
        await attendre(async () => await titre() === 'Chrono v1', 'premier rendu')
        await lire('window.__marque = 1')
        await attendre(async () => await etat('fond') >= 2, 'la minuterie de la racine tourne')
        await lire('document.querySelector(\'#a\')._shadow.querySelector(\'.go\').click()')
        await attendre(async () => await etat('chrono') >= 2, 'le chronomètre lancé par le gestionnaire tourne')
        const fondAvant   = await etat('fond')
        const chronoAvant = await etat('chrono')

        writeFileSync(join(src, 'chrono.mjs'), chrono('Chrono v2', 1000))
        await attendre(async () => await titre() === 'Chrono v2', 'le composant modifié se redessine')
        assert.equal(await lire('window.__marque'), 1, 'échange à chaud, sans rechargement de la page\n' + dev.stdout())

        // chronomètre du gestionnaire : arrêté à l'échange, sa valeur gardée
        const chronoApres = await etat('chrono')
        await pause(300)
        assert.ok(chronoApres >= chronoAvant, `état gardé : $chrono ne repart pas de 0 (${chronoAvant} → ${chronoApres})`)
        assert.equal(await etat('chrono'), chronoApres, 'la minuterie lancée par le gestionnaire est arrêtée à l\'échange')

        // racine : relancée une seule fois, avec le nouveau code (+1000 par tir) ; le compte de l'ancien code reste dans les unités
        await attendre(async () => await etat('fond') >= 1000, 'la minuterie de la racine repart avec le nouveau code')
        const fond1 = await etat('fond')
        await attendre(async () => await etat('fond') >= fond1 + 2000, 'la minuterie du nouveau code continue de tirer')
        const fond2 = await etat('fond')
        assert.ok(fond1 % 1000 >= fondAvant, `état gardé : le compte de l'ancien code reste (${fondAvant} → ${fond1})`)
        assert.equal(fond2 % 1000, fond1 % 1000, `seule la minuterie du nouveau code tire, l'ancienne est arrêtée (${fond1} → ${fond2})`)
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
