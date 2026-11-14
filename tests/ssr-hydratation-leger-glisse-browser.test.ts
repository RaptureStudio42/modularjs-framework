// En `ssr:markers`, un composant `@lightDom` repris d'une page du serveur garde le contenu que son parent lui a glissé : le serveur écrit
// la page du composant léger, le repère `<!--mjs-l-->`, puis le contenu glissé, et le navigateur ne rebâtit que la page du composant
// léger, accrochée après le contenu glissé (le même ordre qu'un composant léger bâti par le navigateur). Le contenu glissé garde ses nœuds
// du serveur : une carte glissée se reprend par ses propres repères et répond, un texte réactif glissé suit la variable de son parent.
// Vraie chaîne : construction par le bloc `render` du projet (la configuration que lit `mjs build`), pages rendues par `createRenderHandler`
// (le rendu par requête de `mjs serve`), en développement et en production, dans Chromium, Firefox et WebKit. Pages : une page sans nœud
// réactif (reprise telle que le serveur l'a écrite), le même cas avec un paragraphe glissé, un composant léger sans `<slot>`, une page réactive.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { createRenderHandler } from '../src/server/render-request.js'

const ENVS    = ['dev', 'prod'] as const
const MOTEURS = ['chromium', 'firefox', 'webkit'] as const

const CARTE = `<script>
  $n = 0
  @plus = -> $n++
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<p class="c">Carte {$quoi} {$n}</p>
<button type="button" class="plus" @click=@plus>plus</button>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = {
  'lg-carte.mjs':     CARTE,
  'lg-fente.mjs':     '<div class="boite"><slot></slot></div>\n',
  'lg-titre.mjs':     '<h2 class="t2">Sous-titre</h2>\n',
  'lg-leger.mjs':     '<@lg-carte quoi="a"></@lg-carte>\n<@lg-titre :lightDom></@lg-titre>\n<@lg-fente :lightDom><@lg-carte quoi="l"></@lg-carte></@lg-fente>\n',
  'lg-texte.mjs':     '<@lg-carte quoi="a"></@lg-carte>\n<@lg-fente :lightDom><p class="g">glisse</p></@lg-fente>\n',
  'lg-sans-slot.mjs': '<@lg-carte quoi="a"></@lg-carte>\n<@lg-titre :lightDom><p class="g">glisse</p></@lg-titre>\n',
  'lg-reactive.mjs':  '<script>\n  $t = \'r\'\n  @change = -> $t = \'s\'\n</script>\n\n<p class="x">{$t}</p>\n<button type="button" class="br" @click=@change>change</button>\n<@lg-carte quoi="a"></@lg-carte>\n<@lg-fente :lightDom><p class="g">{$t}</p><@lg-carte quoi="l"></@lg-carte></@lg-fente>\n',
}

const ROUTES: Record<string, string> = { '/leger': 'mjs-lg-leger', '/leger-texte': 'mjs-lg-texte', '/leger-sans-slot': 'mjs-lg-sans-slot', '/leger-reactive': 'mjs-lg-reactive' }
const CONFIG = { sourceDir: 'src', outputDir: 'public/mjs', js: 'split', render: { default: 'ssr:markers', routes: Object.fromEntries(Object.entries(ROUTES).map(([r, c]) => [r, { component: c }])) } }

type Projet = { pages: Record<string, string>; sortie: string }
let construit: Promise<Record<string, Projet>> | null = null

// le fichier construit qui répond à une adresse : la fin de son chemin, sous le dossier de sortie
function fichier(sortie: string, chemin: string): string | null {
  const segs = chemin.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const f = join(sortie, ...segs.slice(i))
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

// par env : le projet construit comme par `mjs build`, puis ses pages rendues comme par `mjs serve`
function construire() {
  construit ??= (async () => {
    const root    = mjsTmp('leger-glisse')
    const projets: Record<string, Projet> = {}
    for (const env of ENVS) {
      const dir = join(root, env)
      mkdirSync(join(dir, 'src'), { recursive: true })
      for (const [nom, src] of Object.entries(SOURCES)) writeFileSync(join(dir, 'src', nom), src)
      writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify(CONFIG))
      const found   = findConfig(dir)
      assert.ok(found, 'mjs.config.json doit être trouvé')
      const bundler = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      const pages: Record<string, string> = {}
      const script = '<script type="module" src="/mjs/bundle.js"></script>'
      const h: any = await createRenderHandler(CONFIG as any, dir, undefined, env)
      for (const r of Object.keys(ROUTES)) {
        const res: any = await h.handle(r, {})
        const body     = String(res.body || '')
        assert.match(body, /__mjs_ssrHydrate="a"|data-mjs-ssr-hydrate="a"/, `${env} ${r} : la page est rendue en markers`)
        pages[r] = body.includes('<html') ? (body.includes('bundle.js') ? body : body.replace('</body>', script + '</body>')) : `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${body}\n${script}</body></html>`
      }
      if (typeof h.close === 'function') await h.close()
      projets[env] = { pages, sortie: join(dir, 'public/mjs') }
    }
    return projets
  })()
  return construit
}

// avant le code : chaque nœud de la page du serveur (racines d'ombre comprises) reçoit un tampon, pour voir ensuite s'il a été gardé
const TAMPON = `(() => { const t = (r) => { const w = document.createTreeWalker(r, 5); let x; while ((x = w.nextNode())) { x.__srv = 1; if (x.shadowRoot) t(x.shadowRoot) } }; window.__racine = document.querySelector('[mjs-ssr]'); window.__racine.__srv = 1; t(window.__racine.shadowRoot) })()`

// les enfants d'un composant léger de la page, dans l'ordre : balise et classe, `*` pour un nœud bâti par le navigateur, commentaires et textes compris
const ENFANTS = (balise: string) => `(() => {
  const s = window.__racine._shadow || window.__racine.shadowRoot
  const h = s.querySelector('${balise}')
  return [...h.childNodes].filter((x) => x.nodeType === 1 || x.nodeType === 8 || x.textContent.trim()).map((x) => x.nodeType === 8 ? '<!--' + x.data + '-->' : x.nodeType === 3 ? '"' + x.textContent.trim() + '"' + (x.__srv ? '' : '*') : x.localName + (typeof x.className === 'string' && x.className ? '.' + x.className : '') + (x.__srv ? '' : '*')).join('|')
})()`

// la carte glissée dans le composant léger : son texte, sa balise et son paragraphe gardés ou neufs
const CARTE_L = `(() => {
  const s = window.__racine._shadow || window.__racine.shadowRoot
  const c = s.querySelector('mjs-lg-fente mjs-lg-carte')
  if (!c) return 'absente'
  const q = (c._shadow || c.shadowRoot).querySelector('.c')
  return q.textContent.trim() + ':' + (c.__srv ? 'balise-gardee' : 'balise-neuve') + ':' + (q.__srv ? 'p-garde' : 'p-neuf')
})()`

after(async () => {
  await terminateSharedWorkerPool()
})

for (const nom of MOTEURS) for (const env of ENVS) describe(`composant léger repris en markers, contenu glissé gardé : ${nom}, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any

  before(async function () {
    this.timeout(180000)
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
  })

  // la page du serveur, le code retenu le temps de poser le tampon, puis le code part et la page démarre
  async function charger(chemin: string) {
    const fait    = (await construire())[env]
    const ctx     = await browser.newContext({ viewport: { width: 1000, height: 900 } })
    const page    = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push('console : ' + m.text().slice(0, 300)) })
    let lacher: () => void = () => {}
    const retenu = new Promise<void>((r) => { lacher = r })
    await page.route('http://leger-glisse.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === chemin) return route.fulfill({ status: 200, contentType: 'text/html', body: fait.pages[chemin] })
      const f = fichier(fait.sortie, url.pathname)
      if (!f) return route.fulfill({ status: 404, body: '' })
      if (url.pathname.endsWith('/bundle.js')) await retenu
      return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
    })
    await page.goto('http://leger-glisse.test' + chemin, { waitUntil: 'commit' })
    await page.waitForFunction(() => { const p = document.querySelector('[mjs-ssr]'); return !!p && !!p.shadowRoot && document.readyState !== 'loading' }, null, { timeout: 15000 })
    await page.evaluate(TAMPON)
    lacher()
    await page.waitForFunction(() => ((window as any).__ordre || []).includes('a'), null, { timeout: 15000 })
    await page.waitForTimeout(300)
    return { ctx, page, erreurs, html: fait.pages[chemin] }
  }

  // le contenu glissé d'abord (nœuds du serveur), puis la page du composant léger, rebâtie ; le repère du serveur ne reste pas
  async function glisseGarde(chemin: string, balise: string, attendu: string) {
    const { ctx, page, erreurs, html } = await charger(chemin)
    try {
      const vu = await page.evaluate(ENFANTS(balise))
      assert.equal(vu.replace(/\*/g, ''), attendu.replace(/\*/g, ''), `${balise} garde le contenu que sa page lui a glissé, avant sa propre page`)
      assert.equal(vu, attendu, `${balise} : le contenu glissé garde ses nœuds du serveur, la page du composant léger est rebâtie`)
      assert.equal((html.match(/<!--mjs-l-->/g) || []).length, 1, 'le serveur sépare le contenu glissé de la page du composant léger par un repère, une fois')
      return { ctx, page, erreurs }
    } catch (e) {
      await ctx.close()
      throw e
    }
  }

  it('page sans nœud réactif : la carte glissée dans un composant léger reste, se reprend et répond ; un composant léger sans contenu glissé n’a pas de repère', async function () {
    if (!present) this.skip()
    const { ctx, page, erreurs } = await glisseGarde('/leger', 'mjs-lg-fente', 'mjs-lg-carte|div.boite*')
    try {
      assert.equal(await page.evaluate(ENFANTS('mjs-lg-titre')), 'h2.t2*', 'le composant léger sans contenu glissé est rebâti seul')
      assert.equal(await page.evaluate(CARTE_L), 'Carte l 0:balise-gardee:p-garde', 'la carte glissée est reprise sur ses nœuds du serveur')
      await page.evaluate(`(window.__racine._shadow || window.__racine.shadowRoot).querySelector('mjs-lg-fente mjs-lg-carte')._shadow.querySelector('.plus').click()`)
      await page.waitForFunction(CARTE_L + `.startsWith('Carte l 1')`, null, { timeout: 5000 }).catch(() => {})
      assert.equal(await page.evaluate(CARTE_L), 'Carte l 1:balise-gardee:p-garde', 'le bouton de la carte glissée répond')
      assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement')
    } finally {
      await ctx.close()
    }
  })

  it('page sans nœud réactif : un paragraphe glissé dans un composant léger reste à sa place', async function () {
    if (!present) this.skip()
    const { ctx, erreurs } = await glisseGarde('/leger-texte', 'mjs-lg-fente', 'p.g|div.boite*')
    try {
      assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement')
    } finally {
      await ctx.close()
    }
  })

  it('page sans nœud réactif : un composant léger sans <slot> garde aussi son contenu glissé', async function () {
    if (!present) this.skip()
    const { ctx, erreurs } = await glisseGarde('/leger-sans-slot', 'mjs-lg-titre', 'p.g|h2.t2*')
    try {
      assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement')
    } finally {
      await ctx.close()
    }
  })

  it('page réactive : le contenu glissé reste, son texte réactif suit la variable de la page, la carte glissée répond', async function () {
    if (!present) this.skip()
    const { ctx, page, erreurs } = await glisseGarde('/leger-reactive', 'mjs-lg-fente', 'p.g|mjs-lg-carte|div.boite*')
    try {
      assert.equal(await page.evaluate(CARTE_L), 'Carte l 0:balise-gardee:p-garde', 'la carte glissée est reprise sur ses nœuds du serveur')
      await page.evaluate(`(window.__racine._shadow || window.__racine.shadowRoot).querySelector('.br').click()`)
      const texte = `(window.__racine._shadow || window.__racine.shadowRoot).querySelector('mjs-lg-fente .g').textContent + '/' + (window.__racine._shadow || window.__racine.shadowRoot).querySelector('.x').textContent`
      await page.waitForFunction(texte + ` === 's/s'`, null, { timeout: 5000 }).catch(() => {})
      assert.equal(await page.evaluate(texte), 's/s', 'le texte glissé suit la variable de la page, comme celui de la page')
      await page.evaluate(`(window.__racine._shadow || window.__racine.shadowRoot).querySelector('mjs-lg-fente mjs-lg-carte')._shadow.querySelector('.plus').click()`)
      await page.waitForFunction(CARTE_L + `.startsWith('Carte l 1')`, null, { timeout: 5000 }).catch(() => {})
      assert.equal(await page.evaluate(CARTE_L), 'Carte l 1:balise-gardee:p-garde', 'le bouton de la carte glissée répond')
      assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement')
    } finally {
      await ctx.close()
    }
  })
})
