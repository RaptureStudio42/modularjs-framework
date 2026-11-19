// une page sans manifeste où des composants compilés à part montent puis quittent la page : le chargeur garde chaque racine observée
// avant `µ.paths`, pour la relire à son départ, qui n'arrive jamais ici. La liste ne grandit pas sans fin : elle se resserre quand le
// moteur a ramassé la moitié de ses racines, et une racine encore dans la page y reste
// - 20 000 feuilles montées puis retirées par paquets de 500, le ramasse-miettes forcé à la fin seulement : 1 100 références au plus
//   une fois les racines ramassées (20 001 sans le tri), la feuille restée dans la page toujours gardée
// - de même, le ramasse-miettes forcé entre deux paquets : la liste ne dépasse 1 100 références après aucun paquet
// - Chromium réel seul : lui seul laisse la page forcer le ramasse-miettes (`--expose-gc`) ; ailleurs, le moment où une référence meurt
//   dépend du moteur, et le compte ne prouverait rien

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'

const ENFANT  = '<script>\n  µawake -> $n += 1\n</script>\n<p class="e">{$n}</p>\n'
const FEUILLE = '<div class="f"><@enfant></@enfant></div>\n'
const PAGE    = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/ext/enfant.js"></script><script type="module" src="/out/ext/feuille.js"></script></head><body></body></html>'
// deux paquets de 500 et la feuille gardée, avec une marge
const PLAFOND = 1100

// la page compte la liste après chaque paquet, puis une fois les racines ramassées ; le cœur servi se laisse lire par `window.__mu`
const VU = (entre: boolean) => `(async () => {
  const mu = window.__mu, pause = () => new Promise((r) => setTimeout(r, 0))
  const ramasser = async () => { gc(); await pause(); gc(); await pause() }
  const gardee = document.createElement('mjs-feuille')
  document.body.appendChild(gardee)
  await pause()
  let plus = 0
  for (let b = 0; b < 40; b++) {
    const els = []
    for (let i = 0; i < 500; i++) { const e = document.createElement('mjs-feuille'); document.body.appendChild(e); els.push(e) }
    await pause()
    els.forEach((e) => e.remove())
    els.length = 0
    await ${entre ? 'ramasser()' : 'pause()'}
    plus = Math.max(plus, mu._mjs_early ? mu._mjs_early.length : -1)
  }
  await ramasser()
  // le moteur signale les racines ramassées peu après son passage : la liste a deux secondes pour se resserrer
  for (let t = 0; t < 40 && mu._mjs_early && mu._mjs_early.length > ${PLAFOND}; t++) await new Promise((r) => setTimeout(r, 50))
  const early = mu._mjs_early || []
  return { paths: !!mu.paths, rendue: !!(gardee._shadow && gardee._shadow.querySelector('.f')), references: early.length, plus, vivantes: early.filter((w) => w.deref()).length, gardee: early.some((w) => w.deref() === gardee._shadow) }
})()`

const serveurs: Server[] = []

// une construction de développement en fichiers séparés, pour son cœur seul : la page n'écrit pas son manifeste ; les deux composants
// sont compilés à part et branchés sur ce cœur. Une construction, partagée par les deux cas
let base: Promise<string> | undefined
const servir = () => (base ||= construire())
async function construire(): Promise<string> {
  const root   = mjsTmp('page-sans-manifeste-racines-bornees')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'enfant.mjs'), ENFANT)
  writeFileSync(join(srcDir, 'appli.mjs'), '<p>appli</p>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const coeur = (/const µCore\s*=\s*["']([^"']+)["']/.exec(readFileSync(join(outDir, 'bundle.js'), 'utf-8')) ?? [])[1]
  assert.ok(coeur, 'le manifeste nomme son cœur')
  mkdirSync(join(outDir, 'ext'), { recursive: true })
  for (const [nom, source] of [['enfant', ENFANT], ['feuille', FEUILLE]]) {
    const { output } = await transpile(source, { moduleName: nom })
    writeFileSync(join(outDir, 'ext', nom + '.js'), output.replace("µ.asset('mjs_core.js')", JSON.stringify(coeur)))
  }
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }
    const fichier = join(outDir, normalize(chemin.replace(/^\/out\//, '/')))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    const corps = chemin === coeur ? Buffer.concat([readFileSync(fichier), Buffer.from('\n;window.__mu = µ;\n')]) : readFileSync(fichier)
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
    res.end(corps)
  })
  serveurs.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(server.address() as any).port}`
}

describe('page sans manifeste : la liste des racines que garde le chargeur reste bornée (chromium réel)', function () {
  this.timeout(180000)
  let present = false
  let browser: any

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) return
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server', '--js-flags=--expose-gc'] })
  })

  after(async () => {
    if (browser) await browser.close()
    for (const s of serveurs) s.close()
    await terminateSharedWorkerPool()
  })

  for (const entre of [false, true]) it(`20 000 feuilles montées puis retirées, le ramasse-miettes forcé ${entre ? 'entre deux paquets' : 'à la fin seulement'} : ${PLAFOND} références au plus, la feuille restée dans la page gardée, aucune erreur`, async function () {
    if (!present) { this.skip(); return }
    const base    = await servir()
    const page    = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 160)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 160)) })
    await page.goto(base + '/', { waitUntil: 'load' })
    await page.waitForFunction('!!(window.__mu && customElements.get("mjs-feuille"))', null, { timeout: 5000 })
    const vu = await page.evaluate(VU(entre))
    await page.close()
    const etat = JSON.stringify(vu)
    assert.deepEqual(erreurs, [], etat)
    assert.equal(vu.paths, false, `la page n'a pas de manifeste (${etat})`)
    assert.equal(vu.rendue, true, `la feuille restée dans la page est rendue (${etat})`)
    if (entre) assert.ok(vu.plus <= PLAFOND, `la liste ne dépasse ${PLAFOND} références après aucun paquet (${etat})`)
    assert.ok(vu.references <= PLAFOND, `${PLAFOND} références au plus, les racines ramassées (${etat})`)
    assert.equal(vu.gardee, true, `la racine de la feuille restée dans la page est toujours gardée (${etat})`)
  })
})
