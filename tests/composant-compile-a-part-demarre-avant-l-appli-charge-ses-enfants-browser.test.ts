// un composant compilé à part (seul, hors de la construction, comme l'atelier de thème) qui démarre avant l'appli : son fichier est écrit
// avant le manifeste dans la page, il importe le cœur et monte avant que le manifeste ne pose la table des fichiers (`µ.paths`). Son
// ombre est observée par le chargeur à ce moment-là ; les composants de ses lignes se chargent quand même, au départ du chargeur, où que
// la liste soit posée : dans la page, ou dans l'ombre d'un élément ordinaire, fermée ou ouverte, que le chargeur ne sait pas parcourir
// - fichiers séparés (`split`) : la liste importe le cœur ; ses deux enfants sont demandés, définis et rendus, sans erreur. Les modules
//   s'exécutent dans l'ordre de la page : la liste démarre avant l'appli à coup sûr, dans les trois moteurs. Construction de développement,
//   et de production sans minification (`minify: false`) : un cœur minifié raccourcit ses noms internes, un composant compilé à part ne
//   s'y branche pas
// - fichier unique (`bundle`) : la liste importe le manifeste, qui définit tous les composants avant elle ; ses enfants sont rendus
// Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'

const ENFANT = '<script>\n  µawake -> $n += 1\n</script>\n<p class="e">{$n}</p>\n'
const APPLI  = '<p>appli</p>\n'
const LISTE  = `<script>\n  $l = [{ id: 'a', n: 1 }, { id: 'b', n: 10 }]\n</script>\n{for p in $l by id}<div class="r"><@enfant n=!{p.n}></@enfant></div>{end}\n`
const TETE   = '<script type="module" src="/out/ext/liste.js"></script><script type="module" src="/out/bundle.js"></script>'

// la liste dans la page, ou dans l'ombre d'un élément ordinaire posée par un script de la page avant les modules : la racine gardée sur
// `window.__r` est la seule prise du test sur une ombre fermée
const OMBRE = (mode: string) => `<div id="h"></div><script>window.__r = document.getElementById('h').attachShadow({ mode: '${mode}' }); window.__r.innerHTML = '<mjs-liste></mjs-liste>'</script>`
const LIEUX: [string, string, string][] = [
  ['dans la page', '/', '<mjs-liste></mjs-liste>'],
  ['dans l\'ombre fermée d\'un élément ordinaire', '/fermee', OMBRE('closed')],
  ['dans l\'ombre ouverte d\'un élément ordinaire', '/ouverte', OMBRE('open')]
]
// fichiers séparés en développement et en production sans minification, la liste branchée sur le cœur, aux trois places ; fichier unique
// en développement, la liste dans la page
const MODES: { js: 'split' | 'bundle', env: 'dev' | 'prod', nom: string, lieux: [string, string, string][] }[] = [
  { js: 'split',  env: 'dev',  nom: 'développement, split',                lieux: LIEUX },
  { js: 'split',  env: 'prod', nom: 'production sans minification, split', lieux: LIEUX },
  { js: 'bundle', env: 'dev',  nom: 'développement, bundle',               lieux: LIEUX.slice(0, 1) }
]

const VU = `(() => {
  const l = (window.__r || document).querySelector('mjs-liste')
  const r = l && l._shadow ? Array.from(l._shadow.querySelectorAll('.r')) : []
  return { defini: !!customElements.get('mjs-enfant'), lignes: r.length, enfants: r.map((x) => { const e = x.querySelector('mjs-enfant'); const t = e && e._shadow && e._shadow.querySelector('.e'); return t ? t.textContent : null }) }
})()`

const serveurs: Server[] = []
const bases = new Map<string, Promise<string>>()

// l'appli construite, puis la liste compilée seule et branchée sur son cœur (`split`) ou sur son manifeste (`bundle`) ; une construction
// par mode, partagée par les trois moteurs et les trois places. L'appli a sa propre liste (`ordi`, absente des pages) : un cœur de
// production retire ce qu'aucun composant de sa construction n'emploie, et la liste compilée à part s'y arrêterait sur ce qui manque
function servir(js: 'split' | 'bundle', env: 'dev' | 'prod'): Promise<string> {
  const cle = js + '-' + env
  if (!bases.has(cle)) bases.set(cle, (async () => {
    const root   = mjsTmp('compile-a-part-avant-l-appli-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'enfant.mjs'), ENFANT)
    writeFileSync(join(srcDir, 'appli.mjs'), APPLI)
    writeFileSync(join(srcDir, 'ordi.mjs'), LISTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js, env, ...(env === 'prod' ? { minify: false } : {}) } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const manifeste = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
    const coeur     = (/const µCore\s*=\s*["']([^"']+)["']/.exec(manifeste) ?? [])[1] ?? '/out/bundle.js'
    const { output } = await transpile(LISTE, { moduleName: 'liste' })
    mkdirSync(join(outDir, 'ext'), { recursive: true })
    writeFileSync(join(outDir, 'ext', 'liste.js'), output.replace("µ.asset('mjs_core.js')", JSON.stringify(coeur)))
    const server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      const lieu   = LIEUX.find((l) => l[1] === chemin)
      if (lieu) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8">${TETE}</head><body><mjs-appli></mjs-appli>${lieu[2]}</body></html>`)
        return
      }
      const fichier = join(outDir, normalize(chemin.replace(/^\/out\//, '/')))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : (extname(fichier) === '.css' ? 'text/css' : 'application/json') })
      res.end(readFileSync(fichier))
    })
    serveurs.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    return `http://127.0.0.1:${(server.address() as any).port}`
  })())
  return bases.get(cle)!
}

after(async () => {
  for (const s of serveurs) s.close()
  await terminateSharedWorkerPool()
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`un composant compilé à part qui démarre avant l'appli charge les composants de ses lignes (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (browser) await browser.close()
  })

  for (const mode of MODES) for (const [lieu, chemin] of mode.lieux) it(`${mode.nom}, ${lieu} : la liste monte avant le manifeste — ses deux enfants demandés, définis et rendus, aucune erreur`, async function () {
    if (!present) { this.skip(); return }
    const base    = await servir(mode.js, mode.env)
    const page    = await browser.newPage()
    const erreurs: string[] = []
    const fichiers: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 160)))
    // le chargeur signale en fichiers séparés la balise d'un composant que le manifeste ne connaît pas : attendu ici, la liste vient d'ailleurs
    page.on('console', (m: any) => { if (m.type() === 'error' && !/'liste'.*manifest/.test(m.text())) erreurs.push(m.text().slice(0, 160)) })
    page.on('requestfinished', (q: any) => fichiers.push(q.url().replace(/^http:..[^/]+/, '')))
    await page.goto(base + chemin, { waitUntil: 'load' })
    await page.waitForFunction(`(() => { const l = (window.__r || document).querySelector('mjs-liste'); const r = l && l._shadow ? Array.from(l._shadow.querySelectorAll('.r mjs-enfant')) : []; return r.length === 2 && r.every((e) => e._shadow && e._shadow.querySelector('.e')) })()`, null, { timeout: 5000 }).catch(() => {})
    const vu = await page.evaluate(VU)
    await page.close()
    const etat = `${nom}, ${mode.nom}, ${lieu} : ${JSON.stringify(vu)}`
    assert.deepEqual(erreurs, [], etat)
    if (mode.js === 'split') assert.ok(fichiers.some((f) => /^\/out\/enfant[^/]*\.js$/.test(f)), `le fichier de l'enfant est demandé (${etat} ; demandés : ${fichiers.join(' ')})`)
    assert.equal(vu.defini, true, etat)
    assert.equal(vu.lignes, 2, etat)
    // chaque enfant a reçu la prop de sa ligne à son réveil (`µawake -> $n += 1` la voit)
    assert.deepEqual(vu.enfants, ['2', '11'], etat)
  })
})
