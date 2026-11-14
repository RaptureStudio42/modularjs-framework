// Le réveil paresseux d'une balise sans boîte, et celui d'un attribut `mjs-wake` écrit à la main qui n'est pas `view`.
// Une balise sans boîte (`@display="contents"` : `:host { display: contents }`) ne paraît jamais elle-même à l'écran : `view` se lit sur ce
// qu'elle contient, le premier de ses enfants qui paraît la réveille ; plus bas dans la page, elle attend que son contenu paraisse. Sans
// enfant à observer (du texte seul), elle se réveille au démarrage, et la console du développement le dit, une fois par balise. Une boîte
// perdue pendant l'attente (une règle `@media` au redimensionnement, un style posé) ne laisse jamais attendre pour toujours : la balise qui
// n'affiche que du texte se réveille tout de suite, l'élément observé à la place d'une balise sans boîte passe la main à ses enfants. Un
// attribut `mjs-wake` écrit à la main, vide (`mjs-wake=""`) ou nu (`mjs-wake`), se réveille au démarrage, comme toute valeur autre que
// `view` : dans la racine de la page, au niveau du document, et dans une application sans `@wake` qui demande le module
// (`"runtime": ["wake"]`).
// Modes `ssr` (`replace`) et `ssr:markers`, en développement et en production (un fichier par composant), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const ENVS  = ['dev', 'prod'] as const
const MODES = ['replace', 'markers'] as const

const SOURCES: Record<string, string> = {
  'sb-carte.mjs': `<script>
  $n = 0
  @plus = -> $n++
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<p class="c">Carte {$quoi} {$n}</p>
<button type="button" class="plus" @click=@plus>plus</button>
`,
  'sb-contenu.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<style :display="contents">
  .c
    color: teal
</style>

<p class="c">Contenu {$quoi}</p>
<p class="d">suite</p>
`,
  'sb-texte.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<style :display="contents">
  .c
    color: teal
</style>

Texte {$quoi}
`,
  'sb-mot.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

Mot {$quoi}
`,
  'sb-bloc.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<style :display="contents">
  .c
    color: teal
</style>

<div class="b">
  <p class="c">Bloc {$quoi}</p>
  <p class="d">suite</p>
</div>
`,
  'sb-page.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push('page')
</script>

<style>
  .espace
    height: 2600px
  @media (max-width: 800px)
    mjs-sb-mot
      display: contents
</style>

<@sb-contenu :wake=view quoi="haut"></@sb-contenu>
<@sb-carte quoi="tot"></@sb-carte>
<@sb-carte :wake=view quoi="ecrit"></@sb-carte>
<div class="espace"></div>
<@sb-contenu :wake=view quoi="bas"></@sb-contenu>
<div class="espace"></div>
<@sb-texte :wake=view quoi="texte"></@sb-texte>
<@sb-texte :wake=view quoi="deux"></@sb-texte>
<div class="espace"></div>
<@sb-carte :wake=view quoi="perd"></@sb-carte>
<div class="espace"></div>
<@sb-mot :wake=view quoi="mot"></@sb-mot>
<div class="espace"></div>
<@sb-bloc :wake=view quoi="loin"></@sb-bloc>
<div class="espace"></div>
<@sb-bloc :wake=view quoi="ecran"></@sb-bloc>
`
}

// `?tenir` : la vue n'est jamais rapportée (l'IntersectionObserver ne rappelle pas), une carte `view` attend pour toujours
const SONDE = `(() => {
  window.__ordre = window.__ordre || [];
  if (location.search.includes('tenir')) { window.IntersectionObserver = function() { return { observe() {}, unobserve() {}, disconnect() {} }; }; }
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  window.__comp = (q) => { const r = racine(document.querySelector('mjs-sb-page')); return r ? [...r.querySelectorAll('mjs-sb-carte, mjs-sb-contenu, mjs-sb-texte, mjs-sb-mot, mjs-sb-bloc')].find((c) => racine(c) && racine(c).textContent.includes(' ' + q)) : null; };
  window.__attend = (q) => { const c = window.__comp(q); return !!c && c.hasAttribute('mjs-wake'); };
  window.__clic = (id) => { const r = racine(document.getElementById(id)); r.querySelector('.plus').click(); return / 1$/.test(r.querySelector('.c').textContent.trim()); };
})()`

type Construit = { pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

async function bundles(srcDir: string, root: string, jeu: string, runtime: string[], fichiers: Record<string, Map<string, Buffer>>) {
  for (const env of ENVS) {
    const dossier = join(root, 'out-' + jeu + env)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime, js: 'split', env } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    fichiers[jeu + env] = new Map<string, Buffer>()
    for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[jeu + env].set(n, readFileSync(join(dossier, n)))
  }
}

async function rendre(srcDir: string, root: string, runtime: string[], modes: readonly string[], pages: Record<string, string>, prefixe = '') {
  const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu' + prefixe), bundlerOpts: { runtime } } as any)
  try {
    for (const mode of modes) {
      const r = await renderer.renderToString('mjs-sb-page', { ssrMode: mode } as any)
      pages[prefixe || mode] = r.html + '\n' + (r.hydrateScript || '')
    }
  }
  finally {
    await renderer.close()
  }
}

// l'application du réveil, et la même sans `@wake` qui demande le module (`force`)
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-sans-boite')
    const srcDir = join(root, 'src')
    const srcF   = join(root, 'src-force')
    const pages: Record<string, string> = {}
    const fichiers: Record<string, Map<string, Buffer>> = {}
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(srcF, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) {
      writeFileSync(join(srcDir, nom), source)
      writeFileSync(join(srcF, nom), source.replace(/ :wake=view/g, ''))
    }
    await rendre(srcDir, root, ['hydrate'], MODES, pages)
    await rendre(srcF, root, ['hydrate', 'wake'], ['replace'], pages, 'force')
    await bundles(srcDir, root, '', ['hydrate'], fichiers)
    await bundles(srcF, root, 'force-', ['hydrate', 'wake'], fichiers)
    return { pages, fichiers }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`le réveil d'une balise sans boîte : ${nom}, ${env}`, function () {
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

  // `jeu` : `force-` pour l'application sans `@wake` qui demande le module ; `avis` : les avertissements de la console qui parlent de `@wake`
  async function ouvrir(corps: string, recherche = '', jeu = '') {
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>.loin { height: 3000px }</style></head><body>${corps}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page    = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const erreurs: string[] = []
    const avis: string[]    = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300))
      else if (m.type() === 'warning' && m.text().includes(':wake')) avis.push(m.text())
    })
    await page.addInitScript(SONDE)
    await page.route('http://sansboite.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fait.fichiers[jeu + env].get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    await page.goto('http://sansboite.test/page' + recherche, { waitUntil: 'load' })
    await page.waitForFunction(`!!customElements.get('mjs-sb-page') && window.__ordre.includes('tot')`, null, { timeout: 15000 })
    await page.waitForTimeout(400)
    return { page, erreurs, avis }
  }

  async function attendre(page: any, q: string, ms: number): Promise<boolean> {
    try {
      await page.waitForFunction(`window.__ordre.includes(${JSON.stringify(q)})`, null, { timeout: ms })
      return true
    }
    catch {
      return false
    }
  }

  // une carte du serveur (sans `mjs-wake`) recopiée au niveau du document, avec un id et l'attribut écrit à la main
  function copie(html: string, id: string, attr: string): string {
    const carte = html.match(/<mjs-sb-carte\b(?![^>]*mjs-wake)[^>]*>[\s\S]*?<\/mjs-sb-carte>/)
    assert.ok(carte, 'carte du serveur trouvée')
    return carte[0].replace('<mjs-sb-carte', `<mjs-sb-carte id="${id}"${attr}`)
  }

  for (const mode of MODES) it(`${mode} : une balise sans boîte se réveille quand son contenu paraît — à l'écran au démarrage, plus bas au défilement ; du texte seul, au démarrage`, async function () {
    if (!present) this.skip()
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    try {
      const vu: any = {}
      vu.display   = await page.evaluate(`getComputedStyle(window.__comp('bas')).display`)
      vu.haut      = await attendre(page, 'haut', 3000)
      vu.texte     = await attendre(page, 'texte', 3000)
      vu.basAttend = await page.evaluate(`window.__attend('bas')`)
      await page.evaluate(`(window.__comp('bas').shadowRoot || window.__comp('bas')).querySelector('.d').scrollIntoView()`)
      vu.bas     = await attendre(page, 'bas', 3000)
      vu.erreurs = erreurs
      assert.deepEqual(vu, { display: 'contents', haut: true, texte: true, basAttend: true, bas: true, erreurs: [] }, JSON.stringify(vu))
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : une balise qui perd sa boîte pendant qu'elle attend, hors de l'écran, se réveille quand son contenu paraît`, async function () {
    if (!present) this.skip()
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    try {
      const vu: any = {}
      vu.avant = await page.evaluate(`getComputedStyle(window.__comp('perd')).display`)
      await page.evaluate(`window.__comp('perd').style.display = 'contents'`)
      await page.waitForTimeout(300)
      vu.attend = await page.evaluate(`window.__attend('perd')`)
      await page.evaluate(`window.__comp('perd').shadowRoot.querySelector('.plus').scrollIntoView()`)
      vu.perd    = await attendre(page, 'perd', 3000)
      vu.erreurs = erreurs
      assert.deepEqual(vu, { avant: 'block', attend: true, perd: true, erreurs: [] }, JSON.stringify(vu))
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : une balise qui n'affiche que du texte et perd sa boîte pendant qu'elle attend, hors de l'écran (règle @media au redimensionnement), se réveille tout de suite — dit par la console du développement`, async function () {
    if (!present) this.skip()
    const { page, erreurs, avis } = await ouvrir(fait.pages[mode])
    try {
      const vu: any = {}
      vu.avant  = await page.evaluate(`getComputedStyle(window.__comp('mot')).display`)
      vu.attend = await page.evaluate(`window.__attend('mot')`)
      await page.setViewportSize({ width: 700, height: 700 })
      vu.apres   = await page.evaluate(`getComputedStyle(window.__comp('mot')).display`)
      vu.mot     = await attendre(page, 'mot', 3000)
      vu.avis    = avis.filter((a) => a.includes('<mjs-sb-mot>')).length
      vu.erreurs = erreurs
      assert.deepEqual(vu, { avant: 'block', attend: true, apres: 'contents', mot: true, avis: env === 'dev' ? 1 : 0, erreurs: [] }, JSON.stringify({ ...vu, avis }))
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : un élément observé à la place d'une balise sans boîte, qui perd sa boîte pendant qu'elle attend, passe la main à ses enfants — plus bas au défilement, ou déjà à l'écran`, async function () {
    if (!present) this.skip()
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    const bloc = (q: string) => `(window.__comp('${q}').shadowRoot || window.__comp('${q}')).querySelector('.b')`
    try {
      const vu: any = {}
      vu.attend = await page.evaluate(`window.__attend('loin') && window.__attend('ecran')`)
      await page.evaluate(`${bloc('loin')}.style.display = 'contents'`)
      await page.waitForTimeout(300)
      vu.loinAttend = await page.evaluate(`window.__attend('loin')`)
      await page.evaluate(`${bloc('loin')}.querySelector('.d').scrollIntoView()`)
      vu.loin = await attendre(page, 'loin', 3000)
      await page.evaluate(`${bloc('ecran')}.style.display = 'contents'; ${bloc('ecran')}.querySelector('.c').scrollIntoView()`)
      vu.ecran   = await attendre(page, 'ecran', 3000)
      vu.erreurs = erreurs
      assert.deepEqual(vu, { attend: true, loinAttend: true, loin: true, ecran: true, erreurs: [] }, JSON.stringify(vu))
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : une balise sans boîte qui n'affiche que du texte se réveille au démarrage — la console du développement le dit, une fois par balise, avec la raison`, async function () {
    if (!present) this.skip()
    const { page, erreurs, avis } = await ouvrir(fait.pages[mode])
    try {
      const vu: any = {}
      vu.texte = await attendre(page, 'texte', 3000)
      vu.deux  = await attendre(page, 'deux', 3000)
      await page.waitForTimeout(200)
      vu.avis    = avis.map((a) => a.includes('<mjs-sb-texte>') && a.includes('display: contents') && a.includes('entourez'))
      vu.erreurs = erreurs
      assert.deepEqual(vu, { texte: true, deux: true, avis: env === 'dev' ? [true] : [], erreurs: [] }, JSON.stringify({ ...vu, avis }))
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : un attribut mjs-wake écrit à la main, vide ou nu, se réveille au démarrage — dans la racine de la page et au niveau du document`, async function () {
    if (!present) this.skip()
    const html = fait.pages[mode]
    // la carte `ecrit` de la racine de la page : son attribut du serveur vidé à la main
    const videe = html.replace(/<mjs-sb-carte\b[^>]*>/g, (t) => t.includes('ecrit') ? t.replace('mjs-wake="view"', 'mjs-wake=""') : t)
    assert.ok(videe !== html, 'carte ecrit du serveur trouvée')
    const corps = videe + '\n<div class="loin"></div>\n' + copie(html, 'vide', ' mjs-wake=""') + '\n' + copie(html, 'nu', ' mjs-wake')
    const { page, erreurs } = await ouvrir(corps, '?tenir')
    try {
      const vu: any = {}
      vu.ecrit   = await attendre(page, 'ecrit', 3000)
      vu.vide    = await page.evaluate(`window.__clic('vide')`)
      vu.nu      = await page.evaluate(`window.__clic('nu')`)
      vu.erreurs = erreurs
      assert.deepEqual(vu, { ecrit: true, vide: true, nu: true, erreurs: [] }, JSON.stringify(vu))
    }
    finally {
      await page.close()
    }
  })

  it('une application sans @wake qui demande le module ("runtime": ["wake"]) : mjs-wake vide ou nu écrit à la main se réveille au démarrage, view à la vue', async function () {
    if (!present) this.skip()
    const html = fait.pages.force
    assert.ok(!html.includes('mjs-wake'), 'page du serveur sans mjs-wake')
    const corps = copie(html, 'vue', ' mjs-wake="view"') + '\n' + html + '\n<div class="loin"></div>\n' + copie(html, 'vide', ' mjs-wake=""') + '\n' + copie(html, 'nu', ' mjs-wake')
    const { page, erreurs } = await ouvrir(corps, '', 'force-')
    try {
      const vu: any = {}
      vu.vue     = await page.evaluate(`window.__clic('vue')`)
      vu.vide    = await page.evaluate(`window.__clic('vide')`)
      vu.nu      = await page.evaluate(`window.__clic('nu')`)
      vu.erreurs = erreurs
      assert.deepEqual(vu, { vue: true, vide: true, nu: true, erreurs: [] }, JSON.stringify(vu))
    }
    finally {
      await page.close()
    }
  })
})
