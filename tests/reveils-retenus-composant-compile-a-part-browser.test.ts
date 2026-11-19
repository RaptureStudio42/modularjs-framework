// une ligne de `{for}` qui porte une directive lisant sa balise dans le document (`@attach`, `@this=!`) et livre des props à un composant
// enfant marque ses composants avant leur insertion (`µ._mjs_waitRow`, bloc `<retained-wakes>` de runtime/mjs_for.ts), bloc qui n'entre
// au cœur que si le code compilé par la construction en a une. Un composant compilé à part (seul, hors de la construction, comme l'atelier
// de thème) branché sur le cœur d'une appli qui n'en a pas : l'appel reste sans effet, ses composants se réveillent à leur insertion,
// comme sans ce bloc — jamais d'exception
// - le cœur de l'appli n'a pas le bloc ; la liste rend ses deux lignes et leurs enfants, sans erreur
// - un enfant déjà défini quand sa ligne entre dans la page (`bundle`) se réveille avant de recevoir ses props (`µawake -> $n += 1` ne
//   les voit pas), puis montre celle de sa ligne ; un enfant dont le fichier arrive après (`split`) les a reçues à son réveil
// construction de développement (en production, les propriétés internes du cœur sont renommées : un composant compilé à part ne s'y
// branche pas), en fichiers séparés (`split`, le composant importe le cœur) et en un seul (`bundle`, il importe le manifeste) ;
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
const LISTE  = (ligne: string) => `<script>\n  $l = [{ id: 'a', n: 1 }, { id: 'b', n: 10 }]\n  refs = {}\n  noter = (el) -> el\n</script>\n{for p in $l by id}<div class="r"${ligne}><@enfant n=!{p.n}></@enfant></div>{end}\n`

const LIGNES: Record<string, string> = { ':attach': ' :attach={noter(el)}', ':this=!': ' :this=!{refs[p.id]}' }

const VU = `(() => {
  const l = document.querySelector('mjs-liste')
  const o = l && l._shadow
  const r = o ? Array.from(o.querySelectorAll('.r')) : []
  return { waitRow: typeof window.µ._mjs_waitRow, lignes: r.length, enfants: r.map((x) => { const e = x.querySelector('mjs-enfant'); const t = e && e._shadow && e._shadow.querySelector('.e'); return t ? t.textContent : null }) }
})()`

const serveurs: Server[] = []
const bases = new Map<string, Promise<string>>()

// l'appli (sans directive) construite, puis chaque liste compilée seule et branchée sur son cœur ; une construction par mode, partagée
// par les trois moteurs
function servir(js: 'split' | 'bundle'): Promise<string> {
  if (!bases.has(js)) bases.set(js, (async () => {
    const root   = mjsTmp('reveils-compile-a-part-' + js)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'enfant.mjs'), ENFANT)
    writeFileSync(join(srcDir, 'appli.mjs'), APPLI)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js, env: 'dev' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const manifeste = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
    const coeur     = (/const µCore = '([^']+)';/.exec(manifeste) ?? [])[1] ?? '/out/bundle.js'
    const pages: Record<string, string> = {}
    mkdirSync(join(outDir, 'ext'), { recursive: true })
    for (const [i, nom] of Object.keys(LIGNES).entries()) {
      const { output } = await transpile(LISTE(LIGNES[nom]), { moduleName: 'liste' })
      writeFileSync(join(outDir, 'ext', `liste${i}.js`), output.replace("µ.asset('mjs_core.js')", JSON.stringify(coeur)))
      pages['/p' + i] = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script><script type="module" src="/out/ext/liste${i}.js"></script></head><body><mjs-appli></mjs-appli><mjs-liste></mjs-liste></body></html>`
    }
    const server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (pages[chemin]) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(pages[chemin])
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
  return bases.get(js)!
}

after(async () => {
  for (const s of serveurs) s.close()
  await terminateSharedWorkerPool()
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`un composant compilé à part, à ligne qui attend ses props, sur un cœur sans les réveils retenus (${nom} réel)`, function () {
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

  for (const js of ['split', 'bundle'] as const) it(`développement, ${js} : @attach et @this=! sur la ligne — deux lignes, leurs enfants rendus, aucune exception`, async function () {
    if (!present) { this.skip(); return }
    const base = await servir(js)
    for (const [i, cas] of Object.keys(LIGNES).entries()) {
      const page    = await browser.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 160)))
      // le chargeur signale en fichiers séparés la balise d'un composant que le manifeste ne connaît pas : attendu ici, la liste vient d'ailleurs
      page.on('console', (m: any) => { if (m.type() === 'error' && !/'liste'.*manifest/.test(m.text())) erreurs.push(m.text().slice(0, 160)) })
      await page.goto(base + '/p' + i, { waitUntil: 'load' })
      await page.waitForFunction(`(() => { const l = document.querySelector('mjs-liste'); return !!(l && l._mjs_is_mounted) })()`, null, { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(300)
      const vu = await page.evaluate(VU)
      await page.close()
      assert.equal(vu.waitRow, 'undefined', `${cas} : le cœur de l'appli n'a pas les réveils retenus (${JSON.stringify(vu)})`)
      assert.deepEqual(erreurs, [], `${cas} (${nom}, ${js}) : ${JSON.stringify(vu)}`)
      assert.equal(vu.lignes, 2, `${cas} (${nom}, ${js}) : ${JSON.stringify(vu)}`)
      assert.deepEqual(vu.enfants, js === 'bundle' ? ['1', '10'] : ['2', '11'], `${cas} (${nom}, ${js}) : ${JSON.stringify(vu)}`)
    }
  })
})
