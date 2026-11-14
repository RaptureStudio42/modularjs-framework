// Le réveil paresseux d'une balise sans boîte qui affiche du texte et des éléments tous cachés.
// Une balise sans boîte (`@display="contents"`) paraît par les éléments qu'elle affiche ; d'un texte, le navigateur ne sait pas dire quand il
// paraît. Du texte avec des éléments tous cachés (`hidden`, `display: none`) n'a donc rien à observer, comme du texte seul : la balise se
// réveille tout de suite, et la console du développement le dit, une fois par balise — que le texte et les éléments cachés soient les siens
// ou ceux d'un enfant sans boîte, et quand son seul élément affiché se cache pendant l'attente. Restent paresseux : des éléments cachés sans
// texte (réveil quand l'un d'eux paraît), du texte avec un élément visible plus bas dans la page (réveil au défilement). Un élément de
// taille nulle ou `hidden="until-found"` à l'écran, à côté du texte, la réveille au démarrage.
// Modes `ssr` (`replace`) et `ssr:markers`, en développement et en production (un fichier par composant), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const ENVS  = ['dev', 'prod'] as const
const MODES = ['replace', 'markers'] as const

// une balise sans boîte : son crochet de montage note son nom, puis son contenu
function sansBoite(corps: string): string {
  return `<script>
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<style :display="contents">
  .n
    display: none
  .dc
    display: contents
  .z
    width: 0
    height: 0
  .loin
    margin-top: 3000px
</style>

${corps}
`
}

const SOURCES: Record<string, string> = {
  'tc-cache.mjs': sansBoite(`Cache {$quoi}
<p hidden>cache</p>
<div class="n">aussi</div>`),
  'tc-imbrique.mjs': sansBoite(`Imbrique {$quoi}
<div class="dc">
  <p hidden>cache</p>
</div>`),
  'tc-enfant.mjs': sansBoite(`<div class="dc">
  Enfant {$quoi}
  <p hidden>cache</p>
</div>`),
  'tc-trouve.mjs': sansBoite(`Trouve {$quoi}
<p hidden="until-found">trouvé</p>`),
  'tc-zero.mjs': sansBoite(`Zero {$quoi}
<div class="z"></div>`),
  'tc-montre.mjs': sansBoite(`<p class="h" hidden>Montre {$quoi}</p>`),
  'tc-perd.mjs': sansBoite(`Perd {$quoi}
<p class="v loin">visible</p>`),
  'tc-mixte.mjs': sansBoite(`Mixte {$quoi}
<p hidden>cache</p>
<p class="v">visible</p>`),
  'tc-page.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push('page')
</script>

<style>
  .espace
    height: 2600px
</style>

<@tc-mixte quoi="tot"></@tc-mixte>
<@tc-cache :wake=view quoi="cacheA"></@tc-cache>
<@tc-cache :wake=view quoi="cacheB"></@tc-cache>
<@tc-imbrique :wake=view quoi="imbrique"></@tc-imbrique>
<@tc-enfant :wake=view quoi="enfant"></@tc-enfant>
<@tc-trouve :wake=view quoi="trouve"></@tc-trouve>
<@tc-zero :wake=view quoi="zero"></@tc-zero>
<@tc-montre :wake=view quoi="montre"></@tc-montre>
<@tc-perd :wake=view quoi="perd"></@tc-perd>
<div class="espace"></div>
<@tc-mixte :wake=view quoi="mixte"></@tc-mixte>
`
}

// `__comp(q)` : la balise de la page dont le contenu porte « q » ; `__attend(q)` : elle attend encore son réveil
const SONDE = `(() => {
  window.__ordre = window.__ordre || [];
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  window.__comp = (q) => { const r = racine(document.querySelector('mjs-tc-page')); return r ? [...r.querySelectorAll('*')].find((c) => c.localName.startsWith('mjs-tc-') && racine(c) && racine(c).textContent.includes(' ' + q)) : null; };
  window.__racine = (q) => racine(window.__comp(q));
  window.__attend = (q) => { const c = window.__comp(q); return !!c && c.hasAttribute('mjs-wake'); };
})()`

type Construit = { pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-texte-caches')
    const srcDir = join(root, 'src')
    const pages: Record<string, string> = {}
    const fichiers: Record<string, Map<string, Buffer>> = {}
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      for (const mode of MODES) {
        const r = await renderer.renderToString('mjs-tc-page', { ssrMode: mode } as any)
        pages[mode] = r.html + '\n' + (r.hydrateScript || '')
      }
    }
    finally {
      await renderer.close()
    }
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
    }
    return { pages, fichiers }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`le réveil d'une balise sans boîte qui affiche du texte et des éléments cachés : ${nom}, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let fait: Construit

  before(async function () {
    this.timeout(180000)
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // `avis` : les avertissements de la console qui parlent de `@wake`
  async function ouvrir(corps: string) {
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page    = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const erreurs: string[] = []
    const avis: string[]    = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300))
      else if (m.type() === 'warning' && m.text().includes(':wake')) avis.push(m.text())
    })
    await page.addInitScript(SONDE)
    await page.route('http://textecache.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fait.fichiers[env].get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    await page.goto('http://textecache.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`!!customElements.get('mjs-tc-page') && window.__ordre.includes('tot')`, null, { timeout: 15000 })
    await page.waitForTimeout(400)
    return { page, erreurs, avis }
  }

  // les balises de `liste` réveillées (leur crochet de montage joué), après `ms` au plus
  async function reveilles(page: any, liste: string[], ms: number): Promise<Record<string, boolean>> {
    await page.waitForFunction(`${JSON.stringify(liste)}.every((q) => window.__ordre.includes(q))`, null, { timeout: ms }).catch(() => null)
    return page.evaluate(`Object.fromEntries(${JSON.stringify(liste)}.map((q) => [q, window.__ordre.includes(q)]))`)
  }

  for (const mode of MODES) it(`${mode} : du texte et des éléments tous cachés réveillent au démarrage, comme du texte seul — les siens ou ceux d'un enfant sans boîte, ou cachés pendant l'attente ; sans texte ou avec un élément visible plus bas, la balise attend`, async function () {
    if (!present) this.skip()
    const { page, erreurs, avis } = await ouvrir(fait.pages[mode])
    try {
      const vu: any = {}
      vu.debut     = await reveilles(page, ['cacheA', 'cacheB', 'imbrique', 'enfant', 'trouve', 'zero'], 3000)
      vu.attendent = await page.evaluate(`['montre', 'perd', 'mixte'].map((q) => window.__attend(q) && !window.__ordre.includes(q))`)
      await page.evaluate(`window.__racine('montre').querySelector('.h').hidden = false`)
      vu.montre = await reveilles(page, ['montre'], 3000)
      await page.evaluate(`window.__racine('perd').querySelector('.v').hidden = true`)
      vu.perd        = await reveilles(page, ['perd'], 3000)
      vu.mixteAttend = await page.evaluate(`window.__attend('mixte')`)
      await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
      vu.mixte = await reveilles(page, ['mixte'], 3000)
      await page.waitForTimeout(200)
      vu.avis    = Object.fromEntries(['cache', 'imbrique', 'enfant', 'perd', 'montre', 'mixte'].map((b) => [b, avis.filter((a) => a.includes(`<mjs-tc-${b}>`) && a.includes('display: contents') && a.includes('entourez')).length]))
      vu.erreurs = erreurs
      const dit = env === 'dev' ? 1 : 0
      assert.deepEqual(vu, {
        debut: { cacheA: true, cacheB: true, imbrique: true, enfant: true, trouve: true, zero: true },
        attendent: [true, true, true],
        montre: { montre: true },
        perd: { perd: true },
        mixteAttend: true,
        mixte: { mixte: true },
        avis: { cache: dit, imbrique: dit, enfant: dit, perd: dit, montre: 0, mixte: 0 },
        erreurs: []
      }, JSON.stringify({ ...vu, avis }))
    }
    finally {
      await page.close()
    }
  })
})
