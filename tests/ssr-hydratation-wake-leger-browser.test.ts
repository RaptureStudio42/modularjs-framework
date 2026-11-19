// En `ssr:markers`, une instance paresseuse (`@wake=view`) reprise d'une page du serveur garde, à son réveil, le contenu que sa page a glissé
// dans un composant `@lightDom` : le réveil jette la page du composant léger comme le ferait son constructeur (jusqu'au repère `<!--mjs-l-->`
// compris) et garde la suite. Trois pages : un hôte statique paresseux qui contient un composant léger à contenu glissé (un paragraphe et une
// carte), le même hôte réactif, un composant léger lui-même paresseux à contenu glissé. Avant le défilement, rien ne se réveille ; après, le
// réveil est fait, la carte glissée se monte et répond, le contenu glissé garde ses nœuds du serveur, et l'arbre final est celui de la même
// page bâtie par le navigateur seul. Vraie chaîne : construction par le bloc `render` du projet (la configuration que lit `mjs build`), pages
// rendues par `createRenderHandler` (le rendu par requête de `mjs serve`), en développement et en production, dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { createRenderHandler } from '../src/server/render-request.js'
import { playTogether } from './helpers/engines-together.js'

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

// la partie paresseuse sous l'écran, derrière un espace haut ; le composant léger et le contenu que sa page lui glisse
const ESPACE = '\n\n<style>\n  .espace\n    height: 2600px\n</style>\n'
const FENTE  = '<@wl-fente :lightDom><p class="gh">glisse</p><@wl-carte quoi="w"></@wl-carte></@wl-fente>'

const SOURCES: Record<string, string> = {
  'wl-carte.mjs':         CARTE,
  'wl-fente.mjs':         '<div class="boite"><slot></slot></div>\n',
  'wl-hote.mjs':          `<div class="hote">${FENTE}</div>\n`,
  'wl-hote-r.mjs':        `<script>\n  $h = 'h'\n</script>\n\n<p class="hr">{$h}</p>\n<div class="hote">${FENTE}</div>\n`,
  'wl-hote-page.mjs':     '<@wl-carte quoi="a"></@wl-carte>\n<div class="espace"></div>\n<@wl-hote :wake=view></@wl-hote>' + ESPACE,
  'wl-hote-r-page.mjs':   '<@wl-carte quoi="a"></@wl-carte>\n<div class="espace"></div>\n<@wl-hote-r :wake=view></@wl-hote-r>' + ESPACE,
  'wl-leger-page.mjs':    '<@wl-carte quoi="a"></@wl-carte>\n<div class="espace"></div>\n' + FENTE.replace(':lightDom', ':lightDom :wake=view') + ESPACE,
}

const ROUTES: Record<string, string> = { '/hote-paresseux': 'mjs-wl-hote-page', '/hote-paresseux-reactif': 'mjs-wl-hote-r-page', '/leger-paresseux': 'mjs-wl-leger-page' }
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
    const root    = mjsTmp('wake-leger')
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
        assert.equal((body.match(/<!--mjs-l-->/g) || []).length, 1, `${env} ${r} : le serveur sépare le contenu glissé de la page du composant léger par un repère`)
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
const TAMPON = (tag: string) => `(() => { const t = (r) => { const w = document.createTreeWalker(r, 5); let x; while ((x = w.nextNode())) { x.__srv = 1; if (x.shadowRoot) t(x.shadowRoot) } }; const r = document.querySelector(${JSON.stringify(tag)}); r.__srv = 1; t(r.shadowRoot) })()`

// outils de la page : le premier élément d'une classe et les cartes, racines d'ombre comprises ; l'arbre de la page (balise et classe,
// `#[…]` pour une racine d'ombre, `(…)` pour les enfants, textes compris, commentaires et styles exclus)
const OUTILS = (tag: string) => `(() => {
  const ombre  = (n) => n.shadowRoot || (n._shadow && n._shadow !== n ? n._shadow : null)
  const tous   = (n, acc) => { const r = ombre(n); for (const c of [...(r ? r.childNodes : []), ...n.childNodes]) if (c.nodeType === 1) { acc.push(c); tous(c, acc) } return acc }
  const racine = () => document.querySelector(${JSON.stringify(tag)})
  const plan   = (n) => {
    if (n.nodeType === 3) return n.data.trim() ? JSON.stringify(n.data.trim()) : ''
    if (n.nodeType !== 1 || ['style', 'script', 'link'].includes(n.localName)) return ''
    const r = ombre(n), l = [...n.childNodes].map(plan).filter(Boolean).join(' ')
    return n.localName + (n.classList.length ? '.' + n.classList[0] : '') + (r ? '#[' + [...r.childNodes].map(plan).filter(Boolean).join(' ') + ']' : '') + (l ? '(' + l + ')' : '')
  }
  window.__classe = (k) => tous(racine(), []).find((e) => e.classList.contains(k)) || null
  window.__cartes = () => tous(racine(), []).filter((e) => e.localName === 'mjs-wl-carte')
  window.__plan   = () => plan(racine())
})()`

// le texte de chaque carte, dans l'ordre du document ; d'où vient chaque carte (`gardee` : la balise du serveur)
const LIRE    = `window.__cartes().map((c) => { const s = c._shadow || c.shadowRoot; const q = s && s.querySelector('.c'); return q ? q.textContent.trim() : '?' }).join(',')`
const ORIGINE = `window.__cartes().map((c) => c.__srv === 1 ? 'gardee' : 'neuve').join(',')`
const CLICS   = `window.__cartes().forEach((c) => { const s = c._shadow || c.shadowRoot; const b = s && s.querySelector('.plus'); if (b) b.click() })`

after(async () => {
  await terminateSharedWorkerPool()
})

for (const nom of MOTEURS) for (const env of ENVS) playTogether(describe(`réveil d'une instance paresseuse reprise en markers, contenu glissé d'un composant léger gardé : ${nom}, ${env}`, function () {
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

  // la page du serveur, le code retenu le temps de poser le tampon, puis le code part et la page démarre ; `client` : le témoin, la même
  // page bâtie par le navigateur seul (sa balise dans une page vide)
  async function charger(chemin: string, client = false) {
    const fait    = (await construire())[env]
    const tag     = ROUTES[chemin]
    const html    = client ? `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${tag}></${tag}>\n<script type="module" src="/mjs/bundle.js"></script></body></html>` : fait.pages[chemin]
    const ctx     = await browser.newContext({ viewport: { width: 1000, height: 900 } })
    const page    = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push('console : ' + m.text().slice(0, 300)) })
    let lacher: () => void = () => {}
    const retenu = new Promise<void>((r) => { lacher = r })
    if (client) lacher()
    await page.route('http://wake-leger.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === chemin) return route.fulfill({ status: 200, contentType: 'text/html', body: html })
      const f = fichier(fait.sortie, url.pathname)
      if (!f) return route.fulfill({ status: 404, body: '' })
      if (url.pathname.endsWith('/bundle.js')) await retenu
      return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
    })
    await page.goto('http://wake-leger.test' + chemin, { waitUntil: 'commit' })
    if (!client) {
      await page.waitForFunction((t: string) => { const p = document.querySelector(t); return !!p && !!p.shadowRoot && document.readyState !== 'loading' }, tag, { timeout: 15000 })
      await page.evaluate(TAMPON(tag))
      lacher()
    }
    await page.waitForFunction(() => ((window as any).__ordre || []).includes('a'), null, { timeout: 15000 })
    await page.evaluate(OUTILS(tag))
    await page.waitForTimeout(300)
    return { ctx, page, erreurs }
  }

  // défilement jusqu'à la partie paresseuse : true si la carte glissée se monte ; puis chaque carte reçoit un clic
  async function reveiller(page: any) {
    await page.evaluate('window.scrollTo(0, 99999)')
    const vu = await page.waitForFunction(() => ((window as any).__ordre || []).includes('w'), null, { timeout: 10000 }).then(() => true, () => false)
    await page.waitForTimeout(300)
    await page.evaluate(CLICS)
    await page.waitForTimeout(300)
    return vu
  }

  // avant le défilement, rien ne se réveille ; au réveil, le contenu glissé reste sur ses nœuds du serveur, les deux cartes répondent, et
  // l'arbre final est celui du témoin
  async function cas(chemin: string) {
    const s = await charger(chemin)
    let fin = ''
    try {
      assert.equal(await s.page.evaluate(`(window.__ordre || []).join(',')`), 'a', 'avant le défilement, la partie paresseuse attend son réveil')
      assert.equal(await s.page.evaluate(`!!window.__classe('gh')`), true, 'avant le réveil, le contenu glissé est affiché')
      assert.equal(await reveiller(s.page), true, 'au défilement, le réveil est fait : la carte glissée dans le composant léger se monte')
      assert.equal(await s.page.evaluate(`(window.__classe('gh') || {}).__srv === 1`), true, 'le paragraphe glissé garde son nœud du serveur')
      assert.equal(await s.page.evaluate(ORIGINE), 'gardee,gardee', 'les deux cartes gardent leur balise du serveur')
      assert.equal(await s.page.evaluate(LIRE), 'Carte a 1,Carte w 1', 'les deux cartes restent et répondent')
      assert.deepEqual(s.erreurs, [], 'aucune erreur ni avertissement')
      fin = await s.page.evaluate('window.__plan()')
    } finally {
      await s.ctx.close()
    }
    const c = await charger(chemin, true)
    try {
      assert.equal(await reveiller(c.page), true, 'témoin : la carte glissée se monte')
      assert.equal(fin, await c.page.evaluate('window.__plan()'), 'même arbre que la même page bâtie par le navigateur seul')
    } finally {
      await c.ctx.close()
    }
  }

  it('hôte statique paresseux : au réveil, le composant léger qu’il contient garde le contenu glissé, la carte glissée se monte et répond', async function () {
    if (!present) this.skip()
    await cas('/hote-paresseux')
  })

  it('hôte réactif paresseux : au réveil, le composant léger qu’il contient garde le contenu glissé, la carte glissée se monte et répond', async function () {
    if (!present) this.skip()
    await cas('/hote-paresseux-reactif')
  })

  it('composant léger paresseux : à son réveil, il garde le contenu que sa page lui a glissé, la carte glissée se monte et répond', async function () {
    if (!present) this.skip()
    await cas('/leger-paresseux')
  })
}))
