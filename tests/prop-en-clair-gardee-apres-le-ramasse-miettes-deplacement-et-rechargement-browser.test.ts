// Une prop écrite en clair (`compte="3"`, `titre="Bonjour"`) que le composant a changée garde sa valeur quand le composant est déplacé
// (développement et production) et quand il est rechargé à chaud (`mjs dev` réel), même après le passage du ramasse-miettes : WebKit
// oublie ce qui est noté sur le nœud d'un attribut quand il le reprend, la marque du dernier texte lu est tenue par l'élément. Un attribut
// changé pendant l'absence du composant, ou changé ensuite, est toujours relu. Chromium, Firefox et WebKit

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

const num = (v: string) => `<script>\n$compte = 0\n@plus = -> $compte = Number($compte) + 1\n</script>\n\n<i class="n">${v} {$compte}</i>`
const dep = (v: string) => `<script>\n$titre = 'vide'\n@changer = (x) -> $titre = x\n</script>\n\n<i class="d">${v} {$titre}</i>`

const CORPS_DEV  = '<mjs-hq-num id="a" compte="3"></mjs-hq-num><mjs-hq-num id="b" compte="3"></mjs-hq-num><mjs-hq-dep id="c" titre="Bonjour"></mjs-hq-dep><mjs-hq-num id="e" compte="3"></mjs-hq-num><div id="ailleurs"></div>'
const CORPS_PROD = '<mjs-hq-num id="a" compte="3"></mjs-hq-num><mjs-hq-num id="e" compte="3"></mjs-hq-num><div id="ailleurs"></div>'

// de quoi faire passer le ramasse-miettes : WebKit y reprend les nœuds d'attribut que plus rien ne tient
const PRESSION = '(async () => { for (let k = 0; k < 6; k++) { let t = []; for (let i = 0; i < 300; i++) t.push(new Array(20000).fill(i)); t = null; await new Promise((r) => setTimeout(r, 150)) } return 1 })()'
const TXT      = (id: string) => `(() => { const e = document.querySelector('#${id}'); const o = e && (e._shadow || e.shadowRoot || e); return o && o.querySelector('i') ? o.querySelector('i').textContent : null })()`
// retiré de la page, l'attribut changé pendant l'absence, puis remis ailleurs
const CHANGE_ABSENT = '(() => { const e = document.querySelector("#e"); e.remove(); e.setAttribute("compte", "7"); document.querySelector("#ailleurs").appendChild(e); return 1 })()'
const DEPLACER      = 'document.querySelector("#ailleurs").appendChild(document.querySelector("#a")); 1'

// le texte d'une balise une fois `ok`, relu un temps après : une relecture tardive de l'attribut ne passe pas inaperçue
async function lire(page: any, id: string, ok: (t: string | null) => boolean, ms = 5000): Promise<string> {
  const fin = Date.now() + ms
  let t: string | null = null
  while (Date.now() < fin) {
    t = await page.evaluate(TXT(id)).catch(() => null)
    if (ok(t)) break
    await new Promise((r) => setTimeout(r, 50))
  }
  await new Promise((r) => setTimeout(r, 300))
  return String(await page.evaluate(TXT(id)).catch(() => null))
}

interface Dev { stdout(): string, kill(): Promise<void> }

function lancerDev(root: string, port: number): Promise<Dev> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port), '--host', '127.0.0.1'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
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
        })
      })
    })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    proc.on('error', (e) => {
      if (fini) return
      fini = true
      clearTimeout(abandon)
      reject(e)
    })
  })
}

describe('prop écrite en clair gardée au déplacement et au rechargement à chaud, même après le passage du ramasse-miettes', function () {
  this.timeout(240000)
  let code = ''

  // vraie construction de production, un seul fichier
  before(async () => {
    const root = mjsTmp('prop-en-clair-ramasse-miettes-prod')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'hq-num.mjs'), num('p'))
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    code = '"use strict";\n' + readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} — développement : déplacé puis rechargé à chaud, le composant garde ce qu'il a écrit ; un attribut changé est relu`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const root = mjsTmp('prop-en-clair-ramasse-miettes-dev')
      const src  = join(root, 'src')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
      writeFileSync(join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body>${CORPS_DEV}</body></html>`)
      writeFileSync(join(src, 'hq-num.mjs'), num('v1'))
      writeFileSync(join(src, 'hq-dep.mjs'), dep('v1'))
      const port    = 22000 + Math.floor(Math.random() * 8000)
      const dev     = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        const vus: string[] = []
        await page.goto(`http://127.0.0.1:${port}/`)
        vus.push('depart:' + await lire(page, 'b', (t) => t === 'v1 3', 20000))
        await page.evaluate('["a", "b", "e"].forEach((id) => document.querySelector("#" + id).plus()); document.querySelector("#c").changer("Autre"); 1')
        vus.push('ecrit:' + await lire(page, 'a', (t) => t === 'v1 4') + '/' + await lire(page, 'c', (t) => t === 'v1 Autre'))
        await page.evaluate(PRESSION)
        await page.evaluate(DEPLACER)
        vus.push('deplace:' + await lire(page, 'a', (t) => t === 'v1 4'))
        await page.evaluate(CHANGE_ABSENT)
        vus.push('change-absent:' + await lire(page, 'e', (t) => t === 'v1 7'))
        await page.evaluate('document.querySelector("#e").plus(); 1')
        vus.push('ecrit-apres:' + await lire(page, 'e', (t) => t === 'v1 8'))
        await page.evaluate(PRESSION)
        writeFileSync(join(src, 'hq-num.mjs'), num('v2'))
        writeFileSync(join(src, 'hq-dep.mjs'), dep('v2'))
        const recharge: string[] = []
        for (const id of ['a', 'b', 'c', 'e']) recharge.push(await lire(page, id, (t) => !!t && t.startsWith('v2 '), 20000))
        vus.push('recharge:' + recharge.join('/'))
        await page.evaluate('document.querySelector("#b").setAttribute("compte", "9"); document.querySelector("#c").setAttribute("titre", "Fin"); 1')
        vus.push('change-apres:' + await lire(page, 'b', (t) => t === 'v2 9') + '/' + await lire(page, 'c', (t) => t === 'v2 Fin'))
        console.log(`      ${moteur} ${JSON.stringify(vus)}`)
        assert.deepEqual(vus, ['depart:v1 3', 'ecrit:v1 4/v1 Autre', 'deplace:v1 4', 'change-absent:v1 7', 'ecrit-apres:v1 8', 'recharge:v2 4/v2 4/v2 Autre/v2 8', 'change-apres:v2 9/v2 Fin'])
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })

    it(`${moteur} — production : déplacé, le composant garde ce qu'il a écrit ; un attribut changé est relu`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        await page.setContent(`<!doctype html><html><head></head><body>${CORPS_PROD}</body></html>`)
        await page.addScriptTag({ content: code })
        const vus: string[] = []
        vus.push('depart:' + await lire(page, 'a', (t) => t === 'p 3', 10000))
        await page.evaluate('document.querySelector("#a").plus(); document.querySelector("#e").plus(); 1')
        vus.push('ecrit:' + await lire(page, 'a', (t) => t === 'p 4') + '/' + await lire(page, 'e', (t) => t === 'p 4'))
        await page.evaluate(PRESSION)
        await page.evaluate(DEPLACER)
        vus.push('deplace:' + await lire(page, 'a', (t) => t === 'p 4'))
        await page.evaluate(CHANGE_ABSENT)
        vus.push('change-absent:' + await lire(page, 'e', (t) => t === 'p 7'))
        await page.evaluate('document.querySelector("#a").setAttribute("compte", "5"); 1')
        vus.push('change-apres:' + await lire(page, 'a', (t) => t === 'p 5'))
        console.log(`      ${moteur} ${JSON.stringify(vus)}`)
        assert.deepEqual(vus, ['depart:p 3', 'ecrit:p 4/p 4', 'deplace:p 4', 'change-absent:p 7', 'change-apres:p 5'])
      }
      finally {
        await browser.close()
      }
    })
  }
})
