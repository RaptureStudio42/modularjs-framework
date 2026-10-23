// les libellés par défaut s'affichent toujours quand le manifeste ne pose que ceux des modules du cœur que le build emporte :
// <@@select> seul (texte d'attente du sélecteur) et <@@editor> avec la barre qu'il pose (étiquettes, texte d'attente, titre d'un
// bouton), en français et en anglais, dans Chromium réel. Développement et production, manifeste éclaté et fichier unique.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

type Env = 'dev' | 'prod'
type Js  = 'split' | 'bundle'
type Construction = { script: string, fichiers: Map<string, Buffer> }

const MODES: Array<[Env, Js]> = [['dev', 'split'], ['prod', 'split'], ['dev', 'bundle'], ['prod', 'bundle']]

// la page attendue prête : l'élément cherché a monté son ombre, avec le contenu dont on lit le libellé
const PAGES = {
  select: {
    source: '<@@select name="s"><@@option value="a">Alpha</@@option></@@select>',
    prete:  `document.querySelector('mjs-hote')?._shadow?.querySelector('mjs-core-select')?._shadow?.querySelector('button.select-btn')?.textContent`,
  },
  editor: {
    source: '<@@editor name="t"></@@editor>',
    prete:  `document.querySelector('mjs-hote')?._shadow?.querySelector('mjs-core-editor')?._shadow?.querySelector('mjs-core-toolbar')?._shadow?.querySelector('[data-tool="bold"]')`,
  },
}

// en développement et manifeste éclaté : le cœur, les libellés du manifeste, les modules puis l'hôte dans un seul script en ligne ;
// sinon le build servi par adresse, tel qu'il est écrit
async function construire(nom: keyof typeof PAGES, env: Env, js: Js): Promise<Construction> {
  const root   = mjsTmp(`libelles-par-module-nav-${nom}-${env}-${js}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), PAGES[nom].source + '\n')
  const enLigne      = env === 'dev' && js === 'split'
  const manifestPath = enLigne ? join(root, 'bundle.js') : join(outDir, 'bundle.js')
  const bundler      = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath, js, ...(env === 'prod' ? { env: 'prod' } : {}) } as any)
  const stats        = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  if (!enLigne) {
    for (const f of readdirSync(outDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(outDir, f)))
    assert.ok(fichiers.has('bundle.js'), 'le build pose bundle.js')
    return { script: '', fichiers }
  }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
  const [coeur, ...reste] = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8')))
  return { script: coeur + '\n' + libellesDuManifeste(manifestPath) + '\n' + reste.join('\n') + '\nglobalThis.µ = µ;', fichiers }
}

// la page ouverte dans Chromium avec cette langue ; rend aussi ce que la console a dit d'erreurs et d'avertissements
async function ouvrir(browser: any, fait: Construction, nom: keyof typeof PAGES, lang: string): Promise<{ page: any, ctx: any, logs: string[] }> {
  const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await ctx.newPage()
  const logs: string[] = []
  page.on('console', (m: any) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)) })
  page.on('pageerror', (e: any) => logs.push('PAGEERROR: ' + String(e).slice(0, 300)))
  const corps = fait.script === '' ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${fait.script.replace(/<\/script/gi, '<\\/script')}</script>`
  await page.route('http://localhost/**', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/out/')) {
      const f = fait.fichiers.get(url.pathname.slice(5))
      if (!f) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: f })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote>${corps}</body></html>` })
  })
  await page.goto('http://localhost/page', { waitUntil: 'load' })
  await page.waitForFunction(PAGES[nom].prete, null, { timeout: 60000 })
  await page.waitForTimeout(200)
  return { page, ctx, logs }
}

describe('libellés par module dans Chromium — les textes s\'affichent toujours', function () {
  this.timeout(240000)
  let browser: any = null

  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip(); return }
    browser = await playwright.chromium.launch({ headless: true })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [env, js] of MODES) {
    describe(`${env}, js: '${js}'`, () => {
      it('<@@select> seul : le texte d\'attente, en français puis en anglais', async function () {
        if (!browser) { this.skip(); return }
        const fait = await construire('select', env, js)
        for (const [lang, attendu] of [['fr', 'Choisir…'], ['en', 'Choose…']]) {
          const { page, ctx, logs } = await ouvrir(browser, fait, 'select', lang)
          const texte = await page.evaluate(PAGES.select.prete)
          assert.ok(String(texte).includes(attendu), `${lang} : « ${texte} » ne contient pas « ${attendu} »`)
          assert.deepEqual(logs, [], `${lang} : la console doit rester muette`)
          await ctx.close()
        }
      })

      it('<@@editor> : l\'étiquette de la surface, le texte d\'attente, l\'étiquette et les boutons de la barre qu\'il pose', async function () {
        if (!browser) { this.skip(); return }
        const fait = await construire('editor', env, js)
        const lire = `(() => {
          const ed  = document.querySelector('mjs-hote')._shadow.querySelector('mjs-core-editor')
          const sf  = ed._shadow.querySelector('.surface')
          const bar = ed._shadow.querySelector('mjs-core-toolbar')._shadow
          return { surface: sf.getAttribute('aria-label'), attente: sf.getAttribute('data-placeholder'), barre: bar.querySelector('[role=toolbar]').getAttribute('aria-label'), gras: bar.querySelector('[data-tool="bold"]').getAttribute('aria-label') || bar.querySelector('[data-tool="bold"]').title }
        })()`
        for (const [lang, attendu] of [['fr', { surface: 'Éditeur de texte', attente: 'Écrivez ici…', barre: 'Mise en forme', gras: 'Gras' }], ['en', { surface: 'Text editor', attente: 'Write here…', barre: 'Formatting', gras: 'Bold' }]] as const) {
          const { page, ctx, logs } = await ouvrir(browser, fait, 'editor', lang)
          const lu = await page.evaluate(lire)
          assert.equal(lu.surface, attendu.surface, lang)
          assert.equal(lu.attente, attendu.attente, lang)
          assert.equal(lu.barre, attendu.barre, lang)
          assert.ok(String(lu.gras).startsWith(attendu.gras), `${lang} : « ${lu.gras} » ne commence pas par « ${attendu.gras} »`)
          assert.deepEqual(logs, [], `${lang} : la console doit rester muette`)
          await ctx.close()
        }
      })
    })
  }
})
