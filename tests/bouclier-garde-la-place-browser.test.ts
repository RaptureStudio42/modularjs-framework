// Un module encore en route reste INVISIBLE mais garde sa place : à son arrivée, le reste de la page ne saute plus. Vrais
// navigateurs (Chromium, Firefox, WebKit), vrai build en fichiers séparés servi par HTTP, modules du cœur retenus par le serveur.
//
// Pourquoi ce test existe : le bouclier anti-FOUC du cœur (`µ._mjs_shield`, mjs_init.ts) posait `display:none!important` sur
// toute balise pas encore définie, puis sur `[mjs-loading]` jusqu'au premier rendu. Un module arrivé après sa page (application
// sans fichier unique, modules chargés à la demande) n'occupait donc AUCUNE place pendant l'attente — ni celle de son contenu, ni
// celle que la page lui réservait (un `display:none!important` écrase toute règle de la page) — et poussait tout ce qui le suit à
// son apparition. Le bouclier cache désormais par `visibility` : rien n'est peint, la place reste.
//
// Ce que le test garde, pour `<@@code>` (un bloc écrit dans la balise) et `<@@number>` (une balise vide dont la page réserve la
// hauteur) : pendant l'attente, ni le module ni son contenu brut ne se voient ; à l'arrivée, ce qui suit `<@@number>` ne bouge pas
// d'un pixel, et ce qui suit `<@@code>` bouge de moins de la moitié de sa hauteur (seul l'habillage du bloc s'ajoute) ; à la fin
// tout est visible. Le décalage de mise en page (Chromium, `layout-shift`) est relevé dans la sortie du test.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const CODE  = ['ligne 1', 'ligne 2', 'ligne 3', 'ligne 4', 'ligne 5', 'ligne 6'].join('\n')
const CORPS = `<p id="avant">avant</p><mjs-core-code><pre><code>${CODE}</code></pre></mjs-core-code><p id="entre">entre</p><mjs-core-number name="n" value="3"></mjs-core-number><p id="apres">après</p>`
const TETE  = '<style>body{margin:0;font:16px/1.4 sans-serif} mjs-core-number{display:block;height:48px}</style>'

interface Serveur { base: string, server: Server, vus: Set<string>, liberer: () => void, retenir: () => void }

async function construire(): Promise<Serveur> {
  const root   = mjsTmp('bouclier-place')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'refs.mjs'), ['<@@code><pre><code>a</code></pre></@@code>', '<@@number name="n"></@@number>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out' }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  let attente: Array<() => void> = []
  let ouvert  = false
  const vus   = new Set<string>()
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><meta charset="utf-8">${TETE}<script type="module" src="/out/bundle.js"></script></head><body>${CORPS}</body></html>`)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
      res.end(readFileSync(fichier))
    }
    const module = /^core-(code|number)-/.exec(basename(fichier))
    if (module && !ouvert) { vus.add(module[1]); attente.push(envoyer); return }
    envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const liberer = () => { ouvert = true; attente.forEach((f) => f()); attente = [] }
  const retenir = () => { ouvert = false; vus.clear() }
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server, vus, liberer, retenir }
}

// posée avant tout script : les décalages de mise en page que le navigateur mesure (Chromium seulement)
function poserSonde(): void {
  const w = window as any
  w.__cls = 0
  try { new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) w.__cls += e.value }).observe({ type: 'layout-shift', buffered: true } as any) } catch {}
}

// l'état de la page, en chaînes et nombres seulement
function relever(): any {
  const haut  = (s: string) => Math.round(document.querySelector(s)!.getBoundingClientRect().top)
  const vu    = (el: Element | null) => !!el && (el as any).checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })
  const code  = document.querySelector('mjs-core-code')!
  const num   = document.querySelector('mjs-core-number')!
  return {
    entre: haut('#entre'), apres: haut('#apres'),
    codeH: Math.round(code.getBoundingClientRect().height), numH: Math.round(num.getBoundingClientRect().height),
    codeVu: vu(code), contenuVu: vu(code.querySelector('pre')), numVu: vu(num),
    definis: !!customElements.get('mjs-core-code') && !!customElements.get('mjs-core-number'),
    cls: Math.round(((window as any).__cls || 0) * 1000) / 1000
  }
}

async function navigateurPresent(nom: string): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

let serveur: Promise<Serveur> | null = null

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`bouclier du cœur : un module en route garde sa place — ${nom} réel`, function () {
    this.timeout(120000)
    let browser: any = null
    let s: Serveur

    before(async function () {
      if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté`); this.skip() }
      serveur ??= construire()
      s = await serveur
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => { await browser?.close() })

    it('pendant l\'attente rien ne se voit ; à l\'arrivée, la page ne saute pas', async () => {
      s.retenir()
      const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
      try {
        await page.addInitScript(poserSonde)
        await page.goto(s.base + '/', { waitUntil: 'commit' })
        await page.waitForFunction(() => document.adoptedStyleSheets.some((f) => Array.from(f.cssRules).some((r) => r.cssText.includes(':not(:defined)'))), null, { timeout: 15000 })
        const debut = Date.now()
        while (s.vus.size < 2 && Date.now() - debut < 15000) await page.waitForTimeout(50)
        assert.equal(s.vus.size, 2, 'les deux modules du cœur sont demandés, et retenus')
        await page.waitForTimeout(300)
        const attente = await page.evaluate(relever)
        s.liberer()
        await page.waitForFunction(() => ['mjs-core-code', 'mjs-core-number'].every((t) => customElements.get(t) && !document.querySelector(t)!.hasAttribute('mjs-loading')), null, { timeout: 15000 })
        await page.waitForTimeout(300)
        const fin = await page.evaluate(relever)
        console.log(`      ${nom} — attente ${JSON.stringify(attente)}\n      ${nom} — arrivée ${JSON.stringify(fin)}`)

        assert.equal(attente.definis, false, 'relevé pris pendant l\'attente')
        assert.equal(attente.codeVu, false, 'le module en route ne se voit pas')
        assert.equal(attente.contenuVu, false, 'son contenu brut non plus')
        assert.equal(attente.numVu, false, 'le module vide en route ne se voit pas')
        assert.equal(fin.codeVu && fin.numVu, true, 'à la fin, les deux modules se voient')
        const sautNumber = (fin.apres - fin.entre) - (attente.apres - attente.entre)
        assert.ok(Math.abs(sautNumber) <= 1, `ce qui suit <@@number> ne bouge pas à son arrivée (la page lui réserve 48 px) : ${sautNumber} px`)
        const sautCode = fin.entre - attente.entre
        assert.ok(sautCode < fin.codeH / 2, `ce qui suit <@@code> bouge de moins de la moitié de sa hauteur (${fin.codeH} px) : ${sautCode} px`)
      }
      finally {
        s.liberer()
        await page.close()
      }
    })
  })
}

after(async () => {
  if (serveur) (await serveur).server.close()
  await terminateSharedWorkerPool()
})
