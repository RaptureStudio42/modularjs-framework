// `mjs dev` réel et trois navigateurs : un layout routé (composant qui porte une `<@view>`) modifié se redessine en gardant son état et
// remet la page de l'adresse dans sa vue, sans plantage du routeur ni rechargement ; la page modifiée seule garde son état, et le layout
// le sien

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

const app   = '<routes target="vue">\n  /sec/*  cadre\n</routes>\n\n<@view vue>\n'
const cadre = (v: number) => `<script>\n$c = 0\nincc = -> $c++\n</script>\n\n<routes target="int">\n  /sec/a  pagea\n</routes>\n\n<button class="bc" @click={incc}>Cadre v${v} {$c}</button>\n<@view int>\n`
const pagea = (v: number) => `<script>\n$n = 0\ninc = -> $n++\n</script>\n\n<button class="b" @click={inc}>Page v${v} {$n}</button>\n`

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-layout-vue')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>')
  writeFileSync(join(src, 'app.page.mjs'), app)
  writeFileSync(join(src, 'cadre.page.mjs'), cadre(1))
  writeFileSync(join(src, 'pagea.mjs'), pagea(1))
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

// nœud de l'ombre (fermée) d'un composant de la page : `chemin` = sélecteurs d'hôtes successifs, le dernier vise le nœud
const NOEUD = `(chemin) => {
  let racine = document
  for (let i = 0; i < chemin.length - 1; i++) {
    const hote = racine.querySelector(chemin[i])
    if (!hote || !hote._shadow) return null
    racine = hote._shadow
  }
  return racine.querySelector(chemin[chemin.length - 1])
}`

const CADRE = ['mjs-app', 'mjs-cadre', '.bc']
const PAGE  = ['mjs-app', 'mjs-cadre', 'mjs-pagea', '.b']

describe('mjs dev — un layout routé modifié garde son état et remet sa page dans sa vue (trois navigateurs)', function () {
  this.timeout(120000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : layout modifié puis page modifiée, sans rechargement ni plantage du routeur`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port = 22000 + Math.floor(Math.random() * 8000)
      const dev  = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        const routeur: string[] = []
        page.on('pageerror', (e) => erreurs.push(String(e)))
        page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && m.text().includes('[Router]')) routeur.push(m.text()) })
        const lire = (chemin: string[]) => page.evaluate(`(() => { const n = (${NOEUD})(${JSON.stringify(chemin)}); return n ? n.textContent.trim() : null })()`) as Promise<string | null>
        const cliquer = (chemin: string[]) => page.evaluate(`(${NOEUD})(${JSON.stringify(chemin)}).click()`)
        const attendre = async (chemin: string[], attendu: string | RegExp, quoi: string) => {
          const fin = Date.now() + 20000
          let vu: string | null = null
          while (Date.now() < fin) {
            vu = await lire(chemin).catch(() => null)
            if (vu !== null && (typeof attendu === 'string' ? vu === attendu : attendu.test(vu))) return
            await new Promise(r => setTimeout(r, 50))
          }
          assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${dev.stdout()}\n--- routeur ---\n${routeur.join('\n')}\n--- erreurs de la page ---\n${erreurs.join('\n')}`)
        }
        const sansRechargement = async (quoi: string) => assert.equal(await page.evaluate('window.__marque'), 1, `${quoi} : la page a été rechargée\n${dev.stdout()}`)

        await page.goto(`http://127.0.0.1:${port}/#/sec/a`)
        await attendre(CADRE, 'Cadre v1 0', 'premier rendu du layout')
        await attendre(PAGE, 'Page v1 0', 'premier rendu de la page')
        await page.evaluate('window.__marque = 1')
        await cliquer(CADRE)
        await attendre(CADRE, 'Cadre v1 1', 'clic sur le layout')

        // layout modifié : son état reste, la page de l'adresse revient dans sa vue
        writeFileSync(join(src, 'cadre.page.mjs'), cadre(2))
        await attendre(CADRE, 'Cadre v2 1', 'layout modifié, état gardé')
        await attendre(PAGE, /^Page v1 \d+$/, 'la page revient dans la vue du layout modifié')
        await sansRechargement('layout modifié')
        assert.deepEqual(routeur, [], 'le routeur trouve la vue du layout modifié')

        // page modifiée seule : son état reste, et celui du layout
        const n = Number((/(\d+)$/.exec(await lire(PAGE) ?? '') ?? [])[1])
        await cliquer(PAGE)
        await attendre(PAGE, `Page v1 ${n + 1}`, 'clic sur la page')
        writeFileSync(join(src, 'pagea.mjs'), pagea(2))
        await attendre(PAGE, `Page v2 ${n + 1}`, 'page modifiée, état gardé')
        assert.equal(await lire(CADRE), 'Cadre v2 1', 'le layout garde son état quand sa page change')
        await sansRechargement('page modifiée')
        assert.deepEqual(routeur, [], 'aucun message du routeur')
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
