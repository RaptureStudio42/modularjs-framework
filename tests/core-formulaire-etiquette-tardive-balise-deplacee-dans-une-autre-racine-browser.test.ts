// un module du cœur posé dans la page, dont `aria-labelledby` cite un élément qui manque encore, déplacé pendant son attente dans une autre
// racine (une ombre de la page) : il y est guetté, et l'élément cité qui y paraît le nomme ; l'ancienne racine n'est plus guettée pour lui,
// et la nouvelle cesse de l'être une fois le nom trouvé. Avant le correctif, il restait guetté dans la page, et l'étiquette parue dans
// l'ombre ne le nommait jamais. Chromium, Firefox et WebKit réels (`ariaLabelledByElements`), en développement comme en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<@@number class="n1" aria-label="Nombre"></@@number>
`

// les guetteurs en profondeur posés pendant `__mo.tag` sur la page (`document`) et sur l'ombre de `.hote-ombre`, encore branchés
const COMPTEUR = `(() => {
  const MO = window.MutationObserver
  window.__mo = { tag: false, page: 0, ombre: 0 }
  window.MutationObserver = class extends MO {
    observe(t, o) {
      if (window.__mo.tag && o && o.subtree && !this.__c) {
        const c = t === document ? 'page' : t && t.host && t.host.classList && t.host.classList.contains('hote-ombre') ? 'ombre' : ''
        if (c) {
          this.__c = c
          window.__mo[c]++
        }
      }
      return super.observe(t, o)
    }
    disconnect() {
      if (this.__c) {
        window.__mo[this.__c]--
        this.__c = ''
      }
      return super.disconnect()
    }
  }
})()`

const SCENE = `(async () => {
  const tic = () => new Promise((r) => setTimeout(r, 0))
  const vifs = () => ({ page: __mo.page, ombre: __mo.ombre })
  await customElements.whenDefined('mjs-core-number')
  __mo.tag = true
  const m = document.createElement('mjs-core-number')
  m.setAttribute('aria-labelledby', 'loin')
  document.body.append(m)
  for (let i = 0; i < 300 && !(__mo.page && m._shadow && m._shadow.querySelector('.input')); i++) await new Promise((r) => setTimeout(r, 20))
  const out = { avant: vifs() }
  const ombre = document.querySelector('.hote-ombre').attachShadow({ mode: 'open' })
  ombre.append(m)
  await tic()
  await tic()
  out.deplace = vifs()
  ombre.append(Object.assign(document.createElement('span'), { id: 'loin', textContent: 'Loin' }))
  await tic()
  await tic()
  const e = m._shadow.querySelector('.input').ariaLabelledByElements
  out.cite = e ? Array.from(e).map((x) => x.textContent) : null
  out.fin = vifs()
  return out
})()`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement et les morceaux du build de production, une seule fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('formulaire-etiquette-balise-deplacee')
    const compiler = async (nom: string, opts: Record<string, unknown>, manifeste: string) => {
      const srcDir = join(root, nom, 'src')
      const outDir = join(root, nom, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste || join(outDir, 'bundle.js'), ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return outDir
    }
    const manifeste = join(root, 'dev', 'bundle.js')
    const dev       = assembler(await compiler('dev', {}, manifeste), manifeste)
    const prodDir   = await compiler('prod', { js: 'split', env: 'prod' }, '')
    const prod      = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) prod.set(f, readFileSync(join(prodDir, f)))
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`étiquette attendue par un module déplacé dans une autre racine : guetté là où il est (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let build: 'dev' | 'prod' = 'dev'
  const erreurs: string[] = []

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    await page.addInitScript(COMPTEUR)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.route('http://guet.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/out/')) {
        const corps = fait.prod.get(url.pathname.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      const script = build === 'dev' ? `<script>${fait.dev.replace(/<\/script/gi, '<\\/script')}</script>` : '<script type="module" src="/out/bundle.js"></script>'
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><div class="hote-ombre"></div>${script}</body></html>` })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const b of ['dev', 'prod'] as const) it(`${b === 'dev' ? 'développement' : 'production'} : guetté dans l'ombre où il est allé, nommé par l'étiquette qui y paraît, plus rien de guetté ensuite`, async function () {
    if (!present) { this.skip(); return }
    build          = b
    erreurs.length = 0
    await page.goto('http://guet.test/page', { waitUntil: 'load' })
    const c = await page.evaluate(SCENE)
    console.log(`      ${nom} ${b} : ${JSON.stringify(c)}`)
    assert.deepEqual(c.avant, { page: 1, ombre: 0 }, 'dans la page, l\'étiquette manque : la page est guettée')
    assert.deepEqual(c.deplace, { page: 0, ombre: 1 }, 'déplacé dans l\'ombre, l\'étiquette manque encore : l\'ombre est guettée, la page ne l\'est plus')
    assert.deepEqual(c.cite, ['Loin'], 'l\'étiquette parue dans l\'ombre nomme le module')
    assert.deepEqual(c.fin, { page: 0, ombre: 0 }, 'nommé : plus rien n\'est guetté')
    assert.deepEqual(erreurs.filter((e) => b === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
  })
})
