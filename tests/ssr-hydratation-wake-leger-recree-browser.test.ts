// Un composant `@lightDom` paresseux (`@wake=view`) que le navigateur recrée lui-même reçoit la page de l'instance du serveur qui occupait sa
// place et garde le contenu glissé que le navigateur a créé : dans un bloc `{if}` d'une page reprise (`ssr:markers`), dans une page dont le
// serveur a été construit sur une autre version (vue rebâtie), dans une page rendue en `ssr` ou en `prerender` (vue rebâtie), ces deux
// dernières aussi dans un projet sans aucune page reprise, et dans une page reprise par position (`ssr:positional`) dont le contenu glissé
// n'est fait que de cartes, une ou deux (vue rebâtie). Avant le défilement, le composant attend et son contenu glissé (un paragraphe et
// une carte, ou ces cartes seules) s'affiche une seule fois ; après, le réveil est fait, le contenu glissé reste, les cartes répondent, et l'arbre final est celui
// de la même page bâtie par le navigateur seul. Vraie chaîne : construction par le bloc `render` du projet (la configuration que lit
// `mjs build`), pages rendues par `createRenderHandler` (le rendu par requête de `mjs serve`), en développement et en production, dans
// Chromium, Firefox et WebKit.

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

// la partie paresseuse sous l'écran, derrière un espace haut ; le composant léger et le contenu que sa page lui glisse
const ESPACE  = '\n\n<style>\n  .espace\n    height: 2600px\n</style>\n'
const HAUT    = '<@wr-carte quoi="a"></@wr-carte>\n<div class="espace"></div>\n'
const FENTE   = '<@wr-fente :lightDom :wake=view><p class="g">glisse</p><@wr-carte quoi="w"></@wr-carte></@wr-fente>'
// un contenu glissé fait seulement de composants
const SEUL    = '<@wr-fente :lightDom :wake=view><@wr-carte quoi="w"></@wr-carte></@wr-fente>'
const DEUX    = '<@wr-fente :lightDom :wake=view><@wr-carte quoi="w"></@wr-carte><@wr-carte quoi="v"></@wr-carte></@wr-fente>'
const COMPTE  = '<script>\n  $n = 0\n  @inc = -> $n++\n</script>\n\n<p class="x">{$n}</p>\n'
const SOURCES: Record<string, string> = {
  'wr-carte.mjs':   CARTE,
  'wr-fente.mjs':   '<div class="boite"><slot></slot></div>\n',
  // le composant léger dans un bloc `{if}`, que le navigateur refait au premier rendu
  'pg-wr-si.mjs':   '<script>\n  $ok = true\n</script>\n\n' + HAUT + '{if $ok}' + FENTE + '{end}' + ESPACE,
  // une page dont le navigateur a une autre version que le serveur (un bouton de plus) : il rebâtit sa vue
  'pg-wr-ev.mjs':   COMPTE + '<button type="button" class="ev" @click=@inc>k</button>\n' + HAUT + FENTE + ESPACE,
  'pg-wr-vue.mjs':  HAUT + FENTE + ESPACE,
  // le contenu glissé fait seulement de cartes : une, puis deux
  'pg-wr-seul.mjs': HAUT + SEUL + ESPACE,
  'pg-wr-c2.mjs':   HAUT + DEUX + ESPACE,
}
const SERVEUR: Record<string, string> = { 'pg-wr-ev.mjs': COMPTE + HAUT + FENTE + ESPACE }
// la page `/ev` est rendue par un serveur construit sur `SERVEUR`
const PROJETS: Record<string, { default: string; routes: Record<string, { component: string; mode?: string }> }> = {
  reprise: { default: 'ssr:markers', routes: { '/si': { component: 'mjs-pg-wr-si' }, '/ev': { component: 'mjs-pg-wr-ev' }, '/ssr': { component: 'mjs-pg-wr-vue', mode: 'ssr' }, '/pre': { component: 'mjs-pg-wr-vue', mode: 'prerender' }, '/seul-pos': { component: 'mjs-pg-wr-seul', mode: 'ssr:positional' }, '/c2-pos': { component: 'mjs-pg-wr-c2', mode: 'ssr:positional' } } },
  simple:  { default: 'ssr', routes: { '/ssr': { component: 'mjs-pg-wr-vue' }, '/pre': { component: 'mjs-pg-wr-vue', mode: 'prerender' } } },
}

// l'état du composant léger avant le défilement : il attend son réveil, son contenu glissé affiché une seule fois. Sur `/ev`, l'instance du
// serveur n'est pas à la même place (le serveur n'a pas le bouton qui la précède) : sans page à reprendre, il se construit tout de suite
const AVANT: Record<string, string> = { '/ev': 'reveille g=1 cartes=1' }

// ce que la page glisse dans le composant léger, compté par `__etat` (paragraphes, cartes), et les cartes de la page une fois cliquées ; par
// défaut un paragraphe et une carte
const GLISSE: Record<string, { g: number; cartes: number; lire: string }> = {
  'mjs-pg-wr-seul': { g: 0, cartes: 1, lire: 'Carte a 1,Carte w 1' },
  'mjs-pg-wr-c2':   { g: 0, cartes: 2, lire: 'Carte a 1,Carte w 1,Carte v 1' },
}

type Projet = { pages: Record<string, string>; sortie: string }
let construit: Promise<Record<string, Projet>> | null = null

// le fichier de la sortie que demande une adresse de la page (le bundle, un morceau, une feuille)
function fichier(sortie: string, chemin: string): string | null {
  const segs = chemin.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const f = join(sortie, ...segs.slice(i))
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

// chaque projet construit et ses pages rendues, par environnement (clé `env projet`)
function construire(): Promise<Record<string, Projet>> {
  construit ??= (async () => {
    const root   = mjsTmp('wake-leger-recree')
    const script = '<script type="module" src="/mjs/bundle.js"></script>'
    const out: Record<string, Projet> = {}
    for (const env of ENVS) for (const [nom, render] of Object.entries(PROJETS)) {
      const config = { sourceDir: 'src', outputDir: 'public/mjs', js: 'split', render }
      const dir    = join(root, env, nom)
      const autre  = join(root, env, nom + '-serveur')
      const routes = Object.keys(render.routes)
      for (const [d, sources] of [[dir, SOURCES], [autre, { ...SOURCES, ...SERVEUR }]] as const) {
        mkdirSync(join(d, 'src'), { recursive: true })
        for (const [f, src] of Object.entries(sources)) writeFileSync(join(d, 'src', f), src)
        writeFileSync(join(d, 'mjs.config.json'), JSON.stringify(config))
      }
      const found   = findConfig(dir)
      const bundler = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      const pages: Record<string, string> = {}
      for (const [d, liste] of [[dir, routes.filter((r) => r !== '/ev')], [autre, routes.filter((r) => r === '/ev')]] as const) {
        if (!liste.length) continue
        const h: any = await createRenderHandler(config as any, d, undefined, env)
        for (const r of liste) {
          const body = String(((await h.handle(r, {})) as any).body || '')
          pages[r] = body.includes('<html') ? (body.includes('bundle.js') ? body : body.replace('</body>', script + '</body>')) : `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${body}\n${script}</body></html>`
        }
        if (typeof h.close === 'function') await h.close()
      }
      out[env + ' ' + nom] = { pages, sortie: join(dir, 'public/mjs') }
    }
    return out
  })()
  return construit
}

// dans la page : le composant léger paresseux, son état (en attente ou réveillé, paragraphes et cartes glissés qu'il affiche), les cartes,
// et l'arbre de la page en texte, racines d'ombre comprises (commentaires, feuilles et scripts mis à part)
const OUTILS = (tag: string) => `(() => {
  const tous = (n, f, acc) => { const k = n.shadowRoot || (n._shadow && n._shadow !== n ? n._shadow : null); for (const c of [...(k ? k.childNodes : []), ...n.childNodes]) { if (c.nodeType === 1 && f(c)) acc.push(c); tous(c, f, acc) } return acc }
  const racine = () => document.querySelector(${JSON.stringify(tag)})
  window.__fente  = () => tous(racine(), (e) => e.localName === 'mjs-wr-fente', [])[0]
  window.__cartes = () => tous(racine(), (e) => e.localName === 'mjs-wr-carte', [])
  window.__etat   = () => { const f = window.__fente(); return f ? (f.hasAttribute('mjs-wake') ? 'attend' : 'reveille') + ' g=' + f.querySelectorAll('p.g').length + ' cartes=' + f.querySelectorAll('mjs-wr-carte').length : 'sans-fente' }
  const out = (n) => {
    if (n.nodeType === 3) return n.data.trim() ? JSON.stringify(n.data.trim()) : ''
    if (n.nodeType !== 1 || ['style', 'script', 'link', 'template'].includes(n.localName)) return ''
    const k = n.shadowRoot || (n._shadow && n._shadow !== n ? n._shadow : null)
    let s = n.localName + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0] : '')
    if (k) s += '#[' + [...k.childNodes].map(out).filter(Boolean).join(' ') + ']'
    if (!k && !n.children.length) return s + (n.textContent.trim() ? '"' + n.textContent.trim().replace(/\\s+/g, ' ') + '"' : '')
    const l = [...n.childNodes].map(out).filter(Boolean).join(' ')
    return l ? s + '(' + l + ')' : s
  }
  window.__plan = () => out(racine())
})()`
const CLICS = `window.__cartes().forEach((c) => { const s = c._shadow || c.shadowRoot; const b = s && s.querySelector('.plus'); if (b) b.click() })`
const LIRE  = `window.__cartes().map((c) => { const s = c._shadow || c.shadowRoot; const q = s && s.querySelector('.c'); return q ? q.textContent.trim().replace(/\\s+/g, ' ') : '?' }).join(',')`

// la page servie (rendue par le serveur, ou la balise seule : bâtie par le navigateur), démarrée (la carte du haut montée)
async function ouvrir(browser: any, p: Projet, chemin: string, tag: string, csr: boolean) {
  const ctx  = await browser.newContext({ viewport: { width: 1000, height: 900 } })
  const page = await ctx.newPage()
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message)))
  await page.route('http://page.test/**', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.pathname === chemin) return route.fulfill({ status: 200, contentType: 'text/html', body: csr ? `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${tag}></${tag}>\n<script type="module" src="/mjs/bundle.js"></script></body></html>` : p.pages[chemin] })
    const f = fichier(p.sortie, url.pathname)
    if (!f) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
  })
  await page.goto('http://page.test' + chemin)
  await page.waitForFunction(() => ((window as any).__ordre || []).includes('a'), null, { timeout: 15000 })
  await page.evaluate(OUTILS(tag))
  return { ctx, page, erreurs }
}

after(async () => { await terminateSharedWorkerPool() })

for (const nom of MOTEURS) describe(`composant léger paresseux recréé par le navigateur — ${nom}`, function () {
  this.timeout(120000)
  let browser: any
  // l'arbre de la page bâtie par le navigateur seul, ses cartes cliquées une fois, par projet et par page
  const temoins = new Map<string, string>()

  before(async function () {
    this.timeout(300000)
    const playwright: any = await import('playwright')
    await construire()
    browser = await playwright[nom].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const env of ENVS) for (const [projet, { routes }] of Object.entries(PROJETS)) for (const [chemin, { component: tag }] of Object.entries(routes)) {
    it(`${env} ${projet} ${chemin} : contenu glissé affiché une fois avant le réveil, gardé après, cartes vivantes, arbre du navigateur seul`, async function () {
      const p   = (await construire())[env + ' ' + projet]
      const cle = env + ' ' + projet + ' ' + tag
      if (!temoins.has(cle)) {
        const c = await ouvrir(browser, p, chemin, tag, true)
        try {
          await c.page.waitForTimeout(300)
          await c.page.evaluate(CLICS)
          await c.page.waitForTimeout(300)
          assert.deepEqual(c.erreurs, [], 'page bâtie par le navigateur seul sans erreur')
          temoins.set(cle, await c.page.evaluate('window.__plan()'))
        }
        finally {
          await c.ctx.close()
        }
      }
      const s = await ouvrir(browser, p, chemin, tag, false)
      try {
        await s.page.waitForTimeout(300)
        const avant = await s.page.evaluate('window.__etat()')
        await s.page.evaluate('window.scrollTo(0, 99999)')
        const reveil = await s.page.waitForFunction(() => { const f = (window as any).__fente(); return !!f && !f.hasAttribute('mjs-wake') }, null, { timeout: 10000 }).then(() => true, () => false)
        await s.page.waitForTimeout(400)
        const apres = await s.page.evaluate('window.__etat()')
        await s.page.evaluate(CLICS)
        await s.page.waitForTimeout(300)
        const vu = { avant, reveil, apres, cartes: await s.page.evaluate(LIRE), arbre: await s.page.evaluate('window.__plan()'), erreurs: s.erreurs }
        const { g, cartes, lire } = GLISSE[tag] || { g: 1, cartes: 1, lire: 'Carte a 1,Carte w 1' }
        const compte              = 'g=' + g + ' cartes=' + cartes
        assert.deepEqual(vu, { avant: AVANT[chemin] || 'attend ' + compte, reveil: true, apres: 'reveille ' + compte, cartes: lire, arbre: temoins.get(cle), erreurs: [] })
      }
      finally {
        await s.ctx.close()
      }
    })
  }
})
