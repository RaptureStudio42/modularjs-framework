// Les transitions dans une appli construite avec `runtime: 'core'`, en production, dans un vrai Chromium. Le moteur qui les joue
// (mjs_easing.ts) n'est pas un module que la configuration nomme : il suit la transition écrite. La construction réussit, et
// chaque forme joue pour de bon, en un seul fichier (`js: 'bundle'`) comme en fichiers séparés :
//  1. une transition hors de tout bloc (`@in=*fade`), seule dans l'appli : la construction réussit, l'appli se monte sans erreur ;
//     la balise ne joue pas à son arrivée (une balise déjà là au montage n'anime rien), sauf en `.global` ;
//  2. l'entrée dans un `{if}` : `@in=*fade`, `@transition=*slide`, `@in=*fly(up)`, et sur un composant ;
//  3. la sortie d'un `{if}` : la balise reste le temps de son `@out=*fade`, puis part ;
//  4. l'entrée d'une rangée dans un `{for}`.
// Les animations se comptent par balise (`getAnimations()`) ; les durées sont longues pour qu'elles restent en vol à la lecture.
// Sauté, avec un message, quand le navigateur n'est pas installé.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'essai-app.mjs': `<script>
  $show  = false
  $vu    = true
  $items = ['a']
  @entrer  = -> $show = true
  @sortir  = -> $vu = false
  @ajouter = -> $items = [...$items, 'b']
</script>

<div class="racine" @in=*fade(duration: 3s)>bonjour</div>
<p class="global" @in.global=*fade(duration: 3s)>global</p>
{if $show}
  <div class="si-in" @in=*fade(duration: 3s)>entre</div>
  <div class="si-slide" @transition=*slide(duration: 3s)>glisse</div>
  <div class="si-fly" @in=*fly(up, duration: 3s)>vole</div>
  <@enfant class="si-comp" @in=*fade(duration: 3s)></@enfant>
{end}
{if $vu}<div class="si-out" @out=*fade(duration: 800ms)>sort</div>{end}
<ul>{for x in $items}<li class="pour" @in=*fade(duration: 3s)>{x}</li>{end}</ul>
`,
  'enfant.mjs': '<p>enfant</p>\n',
}

// l'appli la plus petite qui porte une transition hors de tout bloc
const MISSION: Record<string, string> = {
  'essai-app.mjs': '<div class="a" @in=*fade>bonjour</div>\n',
}

// le nombre d'animations de chaque balise repérée par sa classe (`-` quand elle n'est pas là), et le texte de la première
const LIRE = `(() => {
  const racine = document.querySelector('mjs-essai-app')._shadow
  const out = {}
  for (const c of ['racine', 'global', 'si-in', 'si-slide', 'si-fly', 'si-comp', 'si-out']) {
    const els = Array.from(racine.querySelectorAll('.' + c))
    out[c] = els.length ? els.map((el) => el.getAnimations().length).join(',') : '-'
  }
  out.pour = Array.from(racine.querySelectorAll('.pour')).map((el) => el.textContent.trim() + ':' + el.getAnimations().length).join(' ')
  out.texte = racine.querySelector('.racine') ? racine.querySelector('.racine').textContent.trim() : ''
  return out
})()`

type Site = { url: string, server: Server }

async function construire(js: 'split' | 'bundle', sources: Record<string, string>): Promise<Site> {
  const root   = mjsTmp('transitions-core')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', runtime: 'core', js, env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const html   = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-essai-app></mjs-essai-app></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as any).port}/`, server }
}

async function chromiumDisponible(): Promise<any> {
  try {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) return null
    return await playwright.chromium.launch()
  }
  catch {
    return null
  }
}

describe('transitions avec runtime: \'core\' — Chromium, production', function () {
  this.timeout(180000)
  let browser: any = null
  const sites = new Map<string, Site>()

  before(async function () {
    this.timeout(120000)
    browser = await chromiumDisponible()
    if (!browser) {
      console.log('  ℹ️  Chromium non installé : ces essais sont sautés. Activer : `npx playwright install chromium`')
      return
    }
    sites.set('un seul fichier (js: \'bundle\')', await construire('bundle', SOURCES))
    sites.set('fichiers séparés (js: \'split\')', await construire('split', SOURCES))
  })

  after(async () => {
    for (const s of sites.values()) s.server.close()
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const nom of ['un seul fichier (js: \'bundle\')', 'fichiers séparés (js: \'split\')']) {
    describe(nom, () => {
      // une page neuve, montée, et la liste des erreurs que la console et la page rapportent
      async function ouvrir(): Promise<{ page: any, erreurs: string[] }> {
        const page    = await browser.newPage()
        const erreurs = [] as string[]
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        await page.goto(sites.get(nom)!.url, { waitUntil: 'load' })
        await page.waitForFunction('!!customElements.get("mjs-essai-app") && !!document.querySelector("mjs-essai-app")._shadow && !!document.querySelector("mjs-essai-app")._shadow.querySelector(".racine")', null, { timeout: 15000 })
        await page.waitForTimeout(250)
        return { page, erreurs }
      }

      it('la forme `.global` hors de tout bloc joue au montage, la forme sans `.global` n\'anime rien', async function () {
        if (!browser) this.skip()
        const { page, erreurs } = await ouvrir()
        try {
          const lu = await page.evaluate(LIRE)
          assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
          assert.equal(lu.texte, 'bonjour')
          assert.equal(lu.racine, '0', 'une balise déjà là au montage n\'anime rien')
          assert.equal(lu.global, '1', 'la transition `.global` joue au montage')
        }
        finally { await page.close() }
      })

      it('l\'entrée dans un {if} joue : fondu, glissement, vol, et un composant', async function () {
        if (!browser) this.skip()
        const { page, erreurs } = await ouvrir()
        try {
          await page.evaluate('document.querySelector("mjs-essai-app").entrer()')
          await page.waitForTimeout(150)
          const lu = await page.evaluate(LIRE)
          assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
          for (const c of ['si-in', 'si-slide', 'si-fly', 'si-comp']) assert.equal(lu[c], '1', `${c} doit jouer son entrée (animations : ${lu[c]})`)
        }
        finally { await page.close() }
      })

      it('la sortie d\'un {if} joue : la balise reste le temps de son `@out`, puis part', async function () {
        if (!browser) this.skip()
        const { page, erreurs } = await ouvrir()
        try {
          await page.evaluate('document.querySelector("mjs-essai-app").sortir()')
          await page.waitForTimeout(100)
          const pendant = await page.evaluate(LIRE)
          assert.equal(pendant['si-out'], '1', `la balise doit rester avec son animation de sortie (animations : ${pendant['si-out']})`)
          await page.waitForFunction('!document.querySelector("mjs-essai-app")._shadow.querySelector(".si-out")', null, { timeout: 5000 })
          assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
        }
        finally { await page.close() }
      })

      it('l\'entrée d\'une rangée dans un {for} joue, celles déjà là n\'animent rien', async function () {
        if (!browser) this.skip()
        const { page, erreurs } = await ouvrir()
        try {
          await page.evaluate('document.querySelector("mjs-essai-app").ajouter()')
          await page.waitForTimeout(150)
          const lu = await page.evaluate(LIRE)
          assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
          assert.equal(lu.pour, 'a:0 b:1')
        }
        finally { await page.close() }
      })
    })
  }

  // l'appli de la mission, seule : sa construction est ce qui est éprouvé, elle se fait dans l'essai lui-même
  for (const js of ['bundle', 'split'] as const) {
    it(`une transition hors de tout bloc, seule dans l'appli (js: '${js}') : la construction réussit et l'appli se monte sans erreur`, async function () {
      if (!browser) this.skip()
      const site    = await construire(js, MISSION)
      const page    = await browser.newPage()
      const erreurs = [] as string[]
      page.on('pageerror', (e: Error) => erreurs.push(e.message))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
      try {
        await page.goto(site.url, { waitUntil: 'load' })
        await page.waitForFunction('!!customElements.get("mjs-essai-app") && !!document.querySelector("mjs-essai-app")._shadow && !!document.querySelector("mjs-essai-app")._shadow.querySelector(".a")', null, { timeout: 15000 })
        await page.waitForTimeout(250)
        assert.equal(await page.evaluate('document.querySelector("mjs-essai-app")._shadow.querySelector(".a").textContent.trim()'), 'bonjour')
        assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
      }
      finally {
        await page.close()
        site.server.close()
      }
    })
  }
})
