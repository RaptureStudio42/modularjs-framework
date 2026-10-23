// Alias livrés par ModularJS dans Chromium, Firefox et WebKit réels : quatre d'entre eux (une image, un titre découpé en mots, une
// balise qui voyage vers une cible donnée à l'usage, un néon) posés dans une page se comportent comme la même page qui écrit les
// réglages en clair — mêmes réglages reçus par l'effet (en développement), même marque posée, même style calculé, même découpage
// du texte. Construite en développement puis en production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MJS_ALIASES } from '../src/effects/aliases-mjs.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const PIXEL = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c33"/></svg>')

// les réglages d'un alias livré, tels que le fichier les écrit : l'écriture en clair en part
const REGLAGES = Object.fromEntries(MJS_ALIASES.split('\n').map((l) => /^\*(\S+) = \*[a-z-]+\((.*)\)$/.exec(l)!.slice(1, 3)))
const clair    = (alias: string) => `*${alias.split('.')[0]}(${REGLAGES[alias]})`

// la même page, deux fois : par alias, puis en clair
const AVEC = [
  `<img class="i1" src="${PIXEL}" alt="" *filter.frosted_glass>`,
  '<h2 class="t1" *stagger.title_words>Un titre en quatre mots</h2>',
  '<div class="d1" *travel.spin_path(\'.d2\')>un</div>',
  '<div class="d2">deux</div>',
  '<div class="d3" *neon.pink_frame>trois</div>'
].join('\n')
const SANS = [
  `<img class="i1" src="${PIXEL}" alt="" ${clair('filter.frosted_glass')}>`,
  `<h2 class="t1" ${clair('stagger.title_words')}>Un titre en quatre mots</h2>`,
  `<div class="d1" ${clair('travel.spin_path').replace(')', ', to: \'.d2\')')}>un</div>`,
  '<div class="d2">deux</div>',
  `<div class="d3" ${clair('neon.pink_frame')}>trois</div>`
].join('\n')

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
describe(`alias livrés par ModularJS (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  const scripts = {} as Record<'dev' | 'prod', string>

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test des alias livrés sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    for (const mode of ['dev', 'prod'] as const) {
      const root   = mjsTmp(`effets-alias-livres-browser-${nom}-${mode}`)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fb-lv-avec.mjs'), AVEC + '\n')
      writeFileSync(join(srcDir, 'fb-lv-sans.mjs'), SANS + '\n')
      // production : un seul fichier (le manifeste), pour que les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: mode === 'prod' ? manifeste : join(root, 'bundle.js'), ...mode === 'prod' && { env: 'prod', js: 'bundle' } } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      if (mode === 'prod') scripts[mode] = stripEsm(readFileSync(manifeste, 'utf-8'))
      else scripts[mode] = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  // ce que la page fait de chaque balise : marque posée, réglages reçus par l'effet (développement), style calculé, découpage du texte
  async function relever(browser: any, tag: string, mode: 'dev' | 'prod') {
    const page    = await browser.newPage({ viewport: { width: 500, height: 500 } })
    const erreurs: string[] = []
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><${tag}></${tag}><script>${scripts[mode]}</script></body></html>` })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => {
      const r = (document.querySelector(t) as any)?._shadow
      return !!r && ['.i1', '.t1', '.d1', '.d3'].every((c) => r.querySelector(c)?.hasAttribute('mjs-fx'))
    }, tag, { timeout: 30000 }).catch(async (err: any) => {
      const vu = await page.evaluate((t: string) => { const r = (document.querySelector(t) as any)?._shadow; return r ? r.innerHTML.slice(0, 1500) : 'pas de shadow' }, tag)
      throw new Error(err.message + '\n' + vu + '\n' + erreurs.join('\n'))
    })
    // le titre a fini de se découper et de monter
    await page.waitForTimeout(2500)
    const etat = await page.evaluate(({ t, dev }: { t: string, dev: boolean }) => {
      const r   = (document.querySelector(t) as any)._shadow
      const out: Record<string, unknown> = {}
      for (const c of ['i1', 't1', 'd1', 'd3']) {
        const el  = r.querySelector('.' + c)
        const fx  = el.getAttribute('mjs-fx')
        out[c] = {
          fx,
          marques:  el.getAttributeNames().filter((a: string) => a.startsWith('mjs-')).sort().map((a: string) => a + '=' + el.getAttribute(a)),
          reglages: dev ? { ...el._mjs_fxOff[fx]._s } : null,
          filtre:   c === 'i1' ? getComputedStyle(el).filter : null,
          texte:    c === 't1' ? el.textContent : null,
          elements: c === 't1' ? el.querySelectorAll('*').length : null
        }
      }
      return out
    }, { t: tag, dev: mode === 'dev' })
    await page.close()
    return { etat, erreurs }
  }

  for (const mode of ['dev', 'prod'] as const) {
    it(`construite en ${mode === 'dev' ? 'développement' : 'production'}, par alias ou en clair : les mêmes réglages, la même marque, le même style, aucune erreur`, async function () {
      if (!present) return this.skip()
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-sandbox'] } : {})
      try {
        const avec = await relever(browser, 'mjs-fb-lv-avec', mode)
        const sans = await relever(browser, 'mjs-fb-lv-sans', mode)
        assert.deepEqual(avec.erreurs, [])
        assert.deepEqual(sans.erreurs, [])
        assert.deepEqual(avec.etat, sans.etat)
        const e: any = avec.etat
        assert.equal(e.i1.fx, 'filter')
        assert.equal(e.t1.fx, 'stagger')
        assert.equal(e.d1.fx, 'travel')
        assert.equal(e.d3.fx, 'neon')
        assert.notEqual(e.i1.filtre, 'none', 'l\'image est dépolie au repos')
        assert.ok(e.t1.texte.includes('Un titre en quatre mots'), e.t1.texte)
        assert.ok(e.t1.elements >= 5, `le titre est découpé en mots : ${e.t1.elements} élément(s) sous la balise`)
        if (mode === 'dev') assert.equal(e.d1.reglages.to, '.d2', 'la cible donnée à l\'usage est reçue par l\'effet')
      }
      finally {
        await browser.close()
      }
    })
  }
})
}
