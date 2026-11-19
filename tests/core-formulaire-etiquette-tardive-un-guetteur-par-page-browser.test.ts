// des modules du cœur posés dans la page (hors de toute ombre) dont `aria-labelledby` cite un élément qui manque encore : un seul guetteur
// pour la page, quel que soit le nombre de modules qui attendent, et seul le module dont un élément cité paraît ou s'en va relit son nom ;
// l'étiquette arrive toujours, qu'elle paraisse à côté du module ou ailleurs dans la page :
// - vingt modules qui attendent, dix changements de la page sans rapport avec eux : un guetteur, dix rappels, aucun nom relu
// - l'élément cité qui s'en va n'est plus cité, et il l'est de nouveau quand il revient ; celui qui paraît à côté du module, ou loin de lui
//   dans la page, le nomme
// - tous nommés, plus rien n'est guetté
// Chromium, Firefox et WebKit réels (`ariaLabelledByElements`), en développement comme en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<@@number class="n1" aria-label="Nombre"></@@number>
`

// les guetteurs posés sur toute la page (`document`, en profondeur) pendant `__mo.tag`, leurs rappels, et les noms relus (`ariaLabelledByElements`
// lu sur un module qui attend, `__read` : lu au moins une fois, au montage)
const COMPTEUR = `(() => {
  const MO = window.MutationObserver, d = Object.getOwnPropertyDescriptor(Element.prototype, 'ariaLabelledByElements')
  window.__mo = { tag: false, vifs: 0, rappels: 0, lus: 0 }
  window.MutationObserver = class extends MO {
    constructor(f) {
      super(function(l, o) {
        if (o.__page) window.__mo.rappels++
        return f.call(this, l, o)
      })
    }
    observe(t, o) {
      if (window.__mo.tag && t === document && o && o.subtree && !this.__page) {
        this.__page = true
        window.__mo.vifs++
      }
      return super.observe(t, o)
    }
    disconnect() {
      if (this.__page) {
        this.__page = false
        window.__mo.vifs--
      }
      return super.disconnect()
    }
  }
  if (d && d.get) Object.defineProperty(Element.prototype, 'ariaLabelledByElements', { ...d, get() {
    if (this.classList && this.classList.contains('attend')) {
      window.__mo.lus++
      this.__read = true
    }
    return d.get.call(this)
  } })
})()`

const AIDES = `(() => {
  window.__att = () => Array.from(document.querySelectorAll('mjs-core-number.attend'))
  window.__cit = (m) => { const e = m._shadow.querySelector('.input').ariaLabelledByElements; return e ? Array.from(e).map((x) => x.textContent) : null }
  window.__tic = () => new Promise((r) => setTimeout(r, 0))
  window.__el  = (id, t) => Object.assign(document.createElement('span'), { id: id, textContent: t })
})()`

// un module à côté de son étiquette à venir (`.zone`), dix-huit dont l'étiquette paraîtra loin d'eux, un qui cite un élément déjà là et un autre à venir
const MONTER = `(async () => {
  await customElements.whenDefined('mjs-core-number')
  __mo.tag = true
  const mk = (ids, ou) => {
    const m = document.createElement('mjs-core-number')
    m.className = 'attend'
    m.setAttribute('aria-labelledby', ids)
    ou.append(m)
  }
  mk('pres', document.querySelector('.zone'))
  for (let i = 0; i < 18; i++) mk('loin', document.body)
  mk('ici loin', document.body)
})()`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement et les morceaux du build de production, une seule fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('formulaire-etiquette-tardive-guetteur')
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
    assert.ok(prod.has('bundle.js') && [...prod.keys()].some((f) => /^core-number-/.test(f)), 'le build de production sépare un morceau par module')
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`étiquette attendue par des modules de la page : un guetteur pour la page (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let build: 'dev' | 'prod' = 'dev'
  const erreurs: string[] = []

  const lire = (expr: string) => page.evaluate(expr)

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
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><div class="zone"></div><span id="ici">Ici</span><footer></footer>${script}</body></html>` })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const b of ['dev', 'prod'] as const) describe(b === 'dev' ? 'développement' : 'production', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      build          = b
      erreurs.length = 0
      await page.goto('http://guet.test/page', { waitUntil: 'load' })
      await page.evaluate(AIDES)
      await page.evaluate(MONTER)
      await page.waitForFunction(`__att().length === 20 && __att().every((m) => m.__read && m._shadow && m._shadow.querySelector('.input'))`, undefined, { timeout: 60000 })
      await page.evaluate('__tic().then(__tic).then(() => { __mo.tag = false })')
    })

    // le script de développement est collé dans la page : son manifeste peut tenter d'importer des morceaux qui n'existent pas à part
    afterEach(function () {
      if (present) assert.deepEqual(erreurs.filter((e) => b === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('vingt modules qui attendent, dix changements de la page sans rapport avec eux : un guetteur, dix rappels, aucun nom relu', async function () {
      const c = await lire(`(async () => {
        const vifs = __mo.vifs
        __mo.rappels = 0
        __mo.lus     = 0
        for (let i = 0; i < 10; i++) {
          document.body.append(document.createElement('hr'))
          await __tic()
        }
        return { vifs: vifs, rappels: __mo.rappels, lus: __mo.lus, cites: __att().map((m) => __cit(m)) }
      })()`)
      console.log(`      ${nom} ${b} : guetteurs de la page ${c.vifs}, rappels ${c.rappels}, noms relus ${c.lus}`)
      assert.deepEqual(c.cites, [...Array(19).fill(null), ['Ici']], 'rien de cité tant qu\'il manque ; le module qui cite deux éléments cite celui qui est là')
      assert.deepEqual({ vifs: c.vifs, rappels: c.rappels, lus: c.lus }, { vifs: 1, rappels: 10, lus: 0 }, 'un guetteur pour la page, un rappel par changement, aucun nom relu')
    })

    it('l\'élément cité qui s\'en va n\'est plus cité ; celui qui paraît à côté du module ou ailleurs dans la page le nomme ; tous nommés, plus rien n\'est guetté', async function () {
      const c = await lire(`(async () => {
        const out = {}
        document.getElementById('ici').remove()
        await __tic()
        out.parti = __cit(__att()[19])
        document.querySelector('.zone').append(__el('pres', 'Près'))
        await __tic()
        out.pres = __cit(__att()[0])
        document.querySelector('footer').append(__el('loin', 'Loin'))
        await __tic()
        out.loin = __att().slice(1).map((m) => __cit(m))
        document.querySelector('footer').append(__el('ici', 'Ici de retour'))
        await __tic()
        out.retour   = __cit(__att()[19])
        out.vifs     = __mo.vifs
        __mo.rappels = 0
        document.body.append(document.createElement('hr'))
        await __tic()
        out.rappels = __mo.rappels
        return out
      })()`)
      assert.equal(c.parti, null, 'l\'élément cité qui s\'en va n\'est plus cité')
      assert.deepEqual(c.pres, ['Près'], 'paru à côté du module, il le nomme')
      assert.deepEqual(c.loin, Array(19).fill(['Loin']), 'paru ailleurs dans la page, il nomme les modules qui le citent')
      assert.deepEqual(c.retour, ['Ici de retour', 'Loin'], 'l\'élément revenu est cité de nouveau, dans l\'ordre de aria-labelledby')
      assert.deepEqual({ vifs: c.vifs, rappels: c.rappels }, { vifs: 0, rappels: 0 }, 'tous nommés : plus rien n\'est guetté')
    })
  })
})
