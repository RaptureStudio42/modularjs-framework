// `mjs dev` réel et trois navigateurs : le composant qui porte les routes et leur garde `µurlChange`, modifié pendant la visite, rejoue
// sa garde sur la page affichée ; la garde, qui refuse désormais cette page, renvoie ailleurs, et la page de renvoi prend la place de
// son entrée. L'historique reste juste après le rechargement : aucune entrée de plus, le retour ramène à la page d'avant, et une garde qui
// renvoie ailleurs prend toujours la place de la page gardée

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
const PAGES         = ['a', 'b', 'c', 'g']

// la garde renvoie `/g` vers B, et `/c` quand la page le demande (`window.refus`) ; d'une version à l'autre, seul le texte change
const app = (v: number) => `<routes target="vue">\n  /   pagea\n  /b  pageb\n  /c  pagec\n  /g  pageg\n</routes>\n<script>\n  µurlChange (path)->\n    µRouter.to('/b') if path === '/g'\n    µRouter.to('/b') if path === '/c' and window.refus\n</script>\n<p class="v">App v${v}</p>\n<nav><a id="vc" href="#/c">C</a> <a id="vg" href="#/g">G</a></nav>\n<@view vue>\n`

const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__texte = function(sel) { var x = window.__chercher(document, sel); return x ? x.textContent.trim() : null; };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  `window.__vue = function() { return ${JSON.stringify(PAGES)}.filter(function(k) { return window.__trouve("." + k); }).join(""); };`,
].join('\n')

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-garde-historique')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>')
  writeFileSync(join(src, 'app.page.mjs'), app(1))
  for (const p of PAGES) writeFileSync(join(src, `page${p}.mjs`), `<p class="${p}">${p.toUpperCase()}</p>\n`)
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

describe('mjs dev — le composant qui porte une garde de route, modifié, garde un historique juste (trois navigateurs)', function () {
  this.timeout(120000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : garde rejouée au rechargement, page de renvoi à la place de la page refusée, retour vers la page d'avant`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port = 22000 + Math.floor(Math.random() * 8000)
      const dev  = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page    = await browser.newPage()
        const erreurs = [] as string[]
        const consoles = [] as string[]
        page.on('pageerror', (e) => erreurs.push(String(e)))
        page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoles.push(m.text()) })
        await page.addInitScript({ content: SONDE })
        await page.goto(`http://127.0.0.1:${port}/#/`)
        await page.waitForFunction("__trouve('.a') && __texte('.v') === 'App v1'", null, { timeout: 20000 })
        await page.evaluate('window.__marque = 1')
        const n = await page.evaluate('history.length') as number
        // [adresse, vue, entrées de plus qu'à l'arrivée] une fois `vue` à l'écran
        const etat = async (vue: string) => {
          await page.waitForFunction(`__trouve('.${vue}')`, null, { timeout: 20000 }).catch(() => {})
          await page.waitForTimeout(300)
          return page.evaluate(`[location.hash, __vue(), history.length - ${n}]`)
        }
        const aller  = async (sel: string, vue: string) => { await page.evaluate(`__clic('${sel}')`); return etat(vue) }
        const retour = async () => { await page.goBack(); return etat('a') }

        assert.deepEqual(await aller('#vg', 'b'), ['#/b', 'b', 1], 'avant le rechargement : B prend la place de G')
        assert.deepEqual(await retour(), ['#/', 'a', 1])
        assert.deepEqual(await aller('#vc', 'c'), ['#/c', 'c', 1], 'la garde laisse passer C')

        // C refusé désormais, composant modifié : sa garde, rejouée sur C, renvoie vers B, qui prend la place de C, sans entrée de plus
        await page.evaluate('window.refus = true')
        writeFileSync(join(src, 'app.page.mjs'), app(2))
        await page.waitForFunction("__texte('.v') === 'App v2'", null, { timeout: 20000 })
        assert.deepEqual(await etat('b'), ['#/b', 'b', 1], 'la garde rejouée renvoie vers B, à la place de C')
        assert.deepEqual(await retour(), ['#/', 'a', 1], 'le retour ramène à A')

        // après le rechargement, la règle tient toujours
        assert.deepEqual(await aller('#vg', 'b'), ['#/b', 'b', 1], 'après le rechargement : B prend la place de G')
        assert.deepEqual(await retour(), ['#/', 'a', 1])
        assert.equal(await page.evaluate('window.__marque'), 1, `la page a été rechargée\n${consoles.join('\n')}\n${dev.stdout()}`)
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
