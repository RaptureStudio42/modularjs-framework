// POURQUOI CE FICHIER EXISTE
// Suite de tests/module-dynamique-nom-court-ou-complet.test.ts, pour ce que happy-dom ne sait pas
// faire : charger un build de PRODUCTION (découpage minifié, noms de propriétés raccourcis) et
// charger un composant À LA DEMANDE. Le défaut d'origine — `<@module 'fx-famille-text'>` créait
// `<fx-famille-text>`, une balise que rien ne définit — avait deux chemins possibles et on ne
// savait pas s'ils divergeaient : composant déjà chargé, composant pas encore chargé (le cas
// ordinaire : un `<@module>` ne nomme pas son composant à la compilation, le bundler ne peut donc
// pas le précharger). Ces tests montent les deux, en développement et en production, dans un vrai
// Chromium (sautés, avec un message, s'il n'est pas installé).
// Ils gardent aussi, en production, les deux autres défauts : le composant d'une ligne de `{for}`
// choisi par un champ de la ligne, et la liste passée en prop qui doit rester un tableau.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const CARTE = (lettre: string) => `<script>\n$titre = ''\n$ids = null\n</script>\n<p class="c">${lettre}:{$titre}|{Array.isArray($ids) ? 'tableau:' + $ids.join('+') : typeof $ids}</p>\n`

const HOTE_VARIABLE = (nom: string) => `<script>\n$comp = '${nom}'\n$trouvees = ['a', 'b']\n</script>\n<@module $comp titre="Démo" ids={$trouvees}></@module>\n`
const HOTE_LISTE    = '<script>\n$familles = [{ comp: \'tuto-card-a\', nom: \'Un\' }, { comp: \'mjs-tuto-card-b\', nom: \'Deux\' }]\n$trouvees = [\'x\', \'y\']\n</script>\n{for f in $familles}<@module f.comp titre={f.nom} ids={$trouvees}></@module>{end}\n'

async function construire(env: 'dev' | 'prod', hote: string): Promise<{ root: string; outDir: string }> {
  const root   = mjsTmp(`moddyn-nav-${env}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), hote)
  writeFileSync(join(srcDir, 'tuto-card-a.mjs'), CARTE('A'))
  writeFileSync(join(srcDir, 'tuto-card-b.mjs'), CARTE('B'))
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'split' })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return { root, outDir }
}

async function servir(root: string, outDir: string): Promise<{ url: string; server: Server }> {
  const html   = '<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if(chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(root, normalize(chemin))
    if(!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as any).port}/`, server }
}

// les composants montés dans l'ombre de <mjs-hote>, avec leur texte : des chaînes seulement
async function monter(browser: any, env: 'dev' | 'prod', hote: string): Promise<{ rendus: string[]; erreurs: string[] }> {
  const { root, outDir } = await construire(env, hote)
  const { url, server }  = await servir(root, outDir)
  const page             = await browser.newPage()
  const erreurs: string[] = []
  page.on('pageerror', (e: Error) => erreurs.push(e.message))
  page.on('console', (m: any) => { if(m.type() === 'error') erreurs.push(m.text()) })
  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => {
      const h: any = document.querySelector('mjs-hote')
      return !!h && !!h._shadow && [...h._shadow.querySelectorAll('mjs-tuto-card-a, mjs-tuto-card-b')].some((c: any) => c._shadow && c._shadow.querySelector('.c'))
    }, null, { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(150)
    const rendus = await page.evaluate(() => {
      const h: any = document.querySelector('mjs-hote')
      if(!h || !h._shadow) return []
      return [...h._shadow.querySelectorAll('*')].filter((c: any) => c.localName.startsWith('mjs-') || c.localName.indexOf('-') > 0).map((c: any) => c.localName + '=' + (c._shadow && c._shadow.querySelector('.c') ? c._shadow.querySelector('.c').textContent : '(rien)'))
    })
    return { rendus, erreurs }
  }
  finally {
    await page.close()
    await new Promise(resolve => server.close(() => resolve(null)))
  }
}

async function chromiumDisponible(): Promise<any> {
  try {
    const playwright = await import('playwright')
    if(!existsSync(playwright.chromium.executablePath())) return null
    return await playwright.chromium.launch()
  }
  catch {
    return null
  }
}

describe('<@module> — nom court ou complet, composant pas encore chargé, build de production (Chromium)', function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    this.timeout(30000)
    browser = await chromiumDisponible()
    if(!browser) console.log('  ℹ️  Chromium non installé : montages sautés. Activer : `npx playwright install chromium`')
  })

  after(async () => {
    if(browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for(const env of ['dev', 'prod'] as const) {
    describe(`build ${env}`, () => {
      it('nom COMPLET d\'un composant pas encore chargé : chargé à la demande, monté, props typées', async function () {
        if(!browser) return this.skip()
        const { rendus, erreurs } = await monter(browser, env, HOTE_VARIABLE('mjs-tuto-card-a'))
        assert.deepEqual(rendus, ['mjs-tuto-card-a=A:Démo|tableau:a+b'], `erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
      })

      it('nom COURT d\'un composant pas encore chargé : même résultat — AVANT le correctif, `<tuto-card-a>` restait inerte', async function () {
        if(!browser) return this.skip()
        const { rendus, erreurs } = await monter(browser, env, HOTE_VARIABLE('tuto-card-a'))
        assert.deepEqual(rendus, ['mjs-tuto-card-a=A:Démo|tableau:a+b'], `erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
      })

      it('dans un {for} : chaque ligne charge et monte SON composant (nom court et nom complet mêlés), liste en prop restée tableau', async function () {
        if(!browser) return this.skip()
        const { rendus, erreurs } = await monter(browser, env, HOTE_LISTE)
        assert.deepEqual(rendus.sort(), ['mjs-tuto-card-a=A:Un|tableau:x+y', 'mjs-tuto-card-b=B:Deux|tableau:x+y'], `erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
      })
    })
  }
})
