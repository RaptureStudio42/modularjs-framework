// `mjs dev` réel et trois navigateurs : une liste propre (mise à jour fine) passe un rechargement à chaud de son composant. Le nouveau
// gabarit refait ses lignes et l'état des listes est refait d'après la nouvelle table : l'état `$` gardé, la passe suivante saute les
// lignes qui gardent leur objet, et un objet changé hors de MJS demande toujours `µrefresh($data)`

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

// `fin` : la marque de chaque ligne, changée par le rechargement
const liste = (fin: string) => [
  '<script lang="js">',
  '  $data = [{ id: 1, label: \'a\' }, { id: 2, label: \'b\' }, { id: 3, label: \'c\' }, { id: 4, label: \'d\' }];',
  '  @echanger = function() { const t = $data[1]; $data[1] = $data[2]; $data[2] = t; };',
  '  @fine = function() { $data[0].label += \'*\'; };',
  '  @rafraichir = function() { µrefresh($data); };',
  '</script>',
  '',
  `<ul>{for row in $data by id}<li>{row.label}${fin}</li>{end}</ul>`,
].join('\n')

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-lignes-propres')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-liste id="l"></mjs-liste></body></html>')
  writeFileSync(join(src, 'liste.mjs'), liste('.'))
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

// le geste `g` de la liste, puis l'écran et le nombre de lignes relues par la passe (fermeture appelée sans masque)
const GESTE = `async (g) => {
  const el = document.querySelector('#l')
  const c = { n: 0 }
  for (const cache of Object.values(el._mjs_list_cache)) {
    for (const en of cache.values()) {
      const f = en._mjs_updFn
      if (f) en._mjs_updFn = (it, ix, m) => { if (m === undefined) c.n++; return f(it, ix, m) }
    }
  }
  if (g === 'dehors') µ._mjs_toRaw(el._state.data)[3].label = 'h'
  else el[g]()
  await new Promise((r) => setTimeout(r, 30))
  return Array.from(el._shadow.querySelectorAll('li')).map((x) => x.textContent).join(' ') + ' | ' + c.n
}`

describe('mjs dev — une liste propre passe un rechargement à chaud (trois navigateurs)', function () {
  this.timeout(240000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : nouveau gabarit, lignes refaites puis sautées ; objet changé hors de MJS`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port = 22000 + Math.floor(Math.random() * 8000)
      const dev  = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e) => erreurs.push(String(e)))
        const lire = () => page.evaluate('Array.from(document.querySelector("#l")?._shadow?.querySelectorAll("li") ?? []).map((x) => x.textContent).join(" ")') as Promise<string>
        const attendre = async (attendu: string, quoi: string) => {
          const fin = Date.now() + 20000
          let vu = ''
          while (Date.now() < fin) {
            vu = await lire().catch(() => '')
            if (vu === attendu) return
            await new Promise(r => setTimeout(r, 50))
          }
          assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${dev.stdout()}\n--- erreurs de la page ---\n${erreurs.join('\n')}`)
        }
        const geste = (g: string) => page.evaluate(`(${GESTE})(${JSON.stringify(g)})`) as Promise<string>

        await page.goto(`http://127.0.0.1:${port}/`)
        await attendre('a. b. c. d.', 'premier rendu')
        await page.evaluate('window.__marque = 1')
        assert.equal(await geste('fine'), 'a*. b. c. d. | 0')
        assert.equal(await geste('echanger'), 'a*. c. b. d. | 0')

        writeFileSync(join(src, 'liste.mjs'), liste('!'))
        await attendre('a*! c! b! d!', 'gabarit modifié')
        assert.equal(await page.evaluate('window.__marque'), 1, `la page a été rechargée\n${dev.stdout()}`)
        assert.equal(await geste('echanger'), 'a*! b! c! d! | 0')
        assert.equal(await geste('echanger'), 'a*! c! b! d! | 0')
        assert.equal(await geste('dehors'), 'a*! c! b! d! | 0')
        assert.equal(await geste('echanger'), 'a*! b! c! d! | 0')
        assert.equal(await geste('rafraichir'), 'a*! b! c! h! | 4')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
