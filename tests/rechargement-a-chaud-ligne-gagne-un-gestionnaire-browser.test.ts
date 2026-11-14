// rechargement à chaud (vrai `mjs dev`, trois moteurs) d'un composant dont la ligne de liste gagne un gestionnaire : la description
// des gestionnaires de chaque liste, faite une fois par composant (`_mjs_evd`), appartient à l'ancien gabarit et repart à neuf avec
// l'échange. Gardée, elle donnait aux lignes refaites les anciens identifiants : décalés par la balise neuve, le clic sur le lien qui
// marchait ne faisait plus rien, sans message, jusqu'au rechargement complet de la page
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

const v1 = ['<script>', '$rows = [{ id: 1 }, { id: 2 }]', '$n = 0', '$m = 0', '</script>', '',
  '<ul>{for row in $rows by id}<li><a class="x" @click={$n = row.id}>x{row.id}</a></li>{end}</ul>',
  '<p class="out">v1 {$n}|{$m}</p>'].join('\n')
const v2 = ['<script>', '$rows = [{ id: 1 }, { id: 2 }]', '$n = 0', '$m = 0', '</script>', '',
  '<ul>{for row in $rows by id}<li><b class="y" @click={$m = row.id}>y</b><a class="x" @click={$n = row.id}>x{row.id}</a></li>{end}</ul>',
  '<p class="out">v2 {$n}|{$m}</p>'].join('\n')

function lancerDev(root: string, port: number): Promise<{ stdout(): string, kill(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    let fini   = false
    const abandon = setTimeout(() => { if (fini) return; fini = true; proc.kill('SIGKILL'); reject(new Error('mjs dev sans premier build\n' + sortie)) }, 90000)
    proc.stdout!.on('data', (d) => {
      sortie += String(d)
      if (fini || !PREMIER_BUILD.test(sortie)) return
      fini = true
      clearTimeout(abandon)
      resolve({ stdout: () => sortie, kill: () => new Promise((done) => { proc.once('close', () => done()); proc.kill('SIGINT'); setTimeout(() => proc.kill('SIGKILL'), 5000) }) })
    })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    proc.on('error', (e) => { if (!fini) { fini = true; clearTimeout(abandon); reject(e) } })
  })
}
const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('rechargement à chaud — une ligne de liste qui gagne un gestionnaire garde des clics justes', function () {
  this.timeout(180000)
  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    describe(moteur, function () {
      let dev: any = null
      let browser: any = null
      let page: any = null
      let src = ''
      const lire = () => page.evaluate('(() => { const h = document.querySelector("mjs-liste"); const n = h && h._shadow ? h._shadow.querySelector(".out") : null; return n ? n.textContent.trim() : null })()').catch(() => null)
      const attendre = async (attendu: string, quoi: string) => {
        const fin = Date.now() + 20000
        let vu: any = null
        while (Date.now() < fin) { vu = await lire(); if (vu === attendu) return; await pause(50) }
        assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${dev ? dev.stdout() : ''}`)
      }
      const cliquer = (sel: string, i: number) => page.evaluate(`document.querySelector('mjs-liste')._shadow.querySelectorAll(${JSON.stringify(sel)})[${i}].click()`)

      before(async function () {
        const playwright = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) this.skip()
        const root = mjsTmp('chaud-ligne-gestionnaire')
        src = join(root, 'src')
        mkdirSync(src, { recursive: true })
        writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
        writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-liste></mjs-liste></body></html>')
        writeFileSync(join(src, 'liste.mjs'), v1)
        browser = await playwright[moteur].launch()
        const port = 22000 + Math.floor(Math.random() * 8000)
        dev = await lancerDev(root, port)
        page = await browser.newPage()
        await page.goto(`http://127.0.0.1:${port}/`)
        await attendre('v1 0|0', 'premier rendu')
        await page.evaluate('window.__marque = 1')
      })
      after(async () => { if (browser) await browser.close(); if (dev) await dev.kill() })

      it('après l\'échange, le gestionnaire neuf de la ligne joue, celui qu\'elle avait déjà aussi', async () => {
        await cliquer('.x', 1)
        await attendre('v1 2|0', 'clic avant l\'échange')
        writeFileSync(join(src, 'liste.mjs'), v2)
        await attendre('v2 2|0', 'échange à chaud, état gardé')
        assert.equal(await page.evaluate('window.__marque'), 1, 'la page a été rechargée : pas un échange à chaud')
        await cliquer('.y', 0)
        await attendre('v2 2|1', 'clic sur la balise qui a gagné un gestionnaire (ligne 1)')
        await cliquer('.x', 0)
        await attendre('v2 1|1', 'clic sur la balise qui avait déjà son gestionnaire (ligne 1)')
      })
    })
  }
})
