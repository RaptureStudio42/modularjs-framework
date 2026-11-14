// `mjs dev` avec `minify: true` : le cœur de développement est minifié, ses champs internes (`_mjs_*`) raccourcis. La garde du
// rechargement à chaud laisse de côté les champs que le cœur pose sur une instance ; sa liste gardait les noms longs, elle ne
// reconnaissait donc plus aucun champ interne : chaque échange rechargeait la page (« le champ « Ie » de l'instance a changé »),
// l'état perdu. La liste suit maintenant les noms raccourcis : un composant modifié se redessine en gardant son état, comme sans
// minification.

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

const compteur = (titre: string) => [
  '<script>',
  '$count = 0',
  'inc = -> $count++',
  '</script>',
  '',
  `<h2 class="titre">${titre}</h2>`,
  '<button class="plus" @click={inc}>+</button>',
  '<span class="val">{$count}</span>',
].join('\n')

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-coeur-minifie')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', minify: true }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-compteur id="a"></mjs-compteur></body></html>')
  writeFileSync(join(src, 'compteur.mjs'), compteur('Compteur v1'))
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

const LIRE = (sel: string) => `(() => { const h = document.querySelector('#a'); const n = h && h._shadow && h._shadow.querySelector(${JSON.stringify(sel)}); return n ? n.textContent.trim() : null })()`

describe('mjs dev, cœur minifié — un composant modifié se redessine en gardant son état (trois navigateurs)', function () {
  this.timeout(180000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : la page ne se recharge pas, le compteur garde sa valeur`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port    = 22000 + Math.floor(Math.random() * 8000)
      const dev     = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page    = await browser.newPage()
        const console_: string[] = []
        page.on('console', (m) => console_.push(m.text()))
        const lire    = (sel: string) => page.evaluate(LIRE(sel)).catch(() => null) as Promise<string | null>
        const attendre = async (sel: string, attendu: string, quoi: string) => {
          const fin = Date.now() + 20000
          let vu: string | null = null
          while (Date.now() < fin) {
            vu = await lire(sel)
            if (vu === attendu) return
            await new Promise(r => setTimeout(r, 50))
          }
          assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${dev.stdout()}\n--- console ---\n${console_.join('\n')}`)
        }

        await page.goto(`http://127.0.0.1:${port}/`)
        await attendre('.titre', 'Compteur v1', 'premier rendu')
        // le cœur est bien minifié : ses champs internes n'ont plus leur nom long
        assert.equal(await page.evaluate('"_mjs_is_mounted" in document.querySelector("#a")'), false, 'cœur non minifié : le test ne prouve rien')
        await page.evaluate('window.__marque = 1')
        await page.evaluate('document.querySelector("#a")._shadow.querySelector(".plus").click()')
        await page.evaluate('document.querySelector("#a")._shadow.querySelector(".plus").click()')
        await attendre('.val', '2', 'deux clics')

        writeFileSync(join(src, 'compteur.mjs'), compteur('Compteur v2'))
        await attendre('.titre', 'Compteur v2', 'gabarit modifié')
        assert.equal(await page.evaluate('window.__marque'), 1, `la page a été rechargée\n--- console ---\n${console_.join('\n')}`)
        assert.equal(await lire('.val'), '2', 'le compteur garde sa valeur')
        assert.deepEqual(console_.filter((t) => /de l'instance a changé/.test(t)), [], 'aucun champ interne pris pour un champ de l\'appli')
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
