// Un composant `@lightDom` paresseux (`@wake=view`) que le navigateur recrée lui-même, dans une page servie sous Trusted Types
// (`Content-Security-Policy: require-trusted-types-for 'script'; trusted-types mjs`, l'en-tête du chapitre de la sécurité) : il reçoit la
// page de l'instance du serveur sans qu'aucun HTML soit écrit en chaîne (la page le refuserait), et se réveille sans erreur — dans un bloc
// `{if}` d'une page reprise (`ssr:markers`, avec repère), dans une page rendue en `ssr` (sans repère), dans une page reprise par position
// dont le contenu glissé n'est fait que de cartes. Avant le défilement, il attend, son contenu glissé affiché une seule fois ; après, le
// réveil est fait, le contenu glissé reste, les cartes répondent, et l'arbre final est celui de la même page bâtie par le navigateur seul.
// Pages rendues par `createRenderHandler`, en développement et en production, dans Chromium et Firefox

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { createRenderHandler } from '../src/server/render-request.js'

const ENVS    = ['dev', 'prod'] as const
const MOTEURS = ['chromium', 'firefox'] as const
const CSP     = { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types mjs" }

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
const DEUX    = '<@wr-fente :lightDom :wake=view><@wr-carte quoi="w"></@wr-carte><@wr-carte quoi="v"></@wr-carte></@wr-fente>'
const SOURCES: Record<string, string> = {
  'wr-carte.mjs':  CARTE,
  'wr-fente.mjs':  '<div class="boite"><slot></slot></div>\n',
  // le composant léger dans un bloc `{if}`, que le navigateur refait au premier rendu
  'pg-wr-si.mjs':  '<script>\n  $ok = true\n</script>\n\n' + HAUT + '{if $ok}' + FENTE + '{end}' + ESPACE,
  'pg-wr-vue.mjs': HAUT + FENTE + ESPACE,
  'pg-wr-c2.mjs':  HAUT + DEUX + ESPACE
}
const RENDER = { default: 'ssr:markers', routes: { '/si': { component: 'mjs-pg-wr-si' }, '/ssr': { component: 'mjs-pg-wr-vue', mode: 'ssr' }, '/c2-pos': { component: 'mjs-pg-wr-c2', mode: 'ssr:positional' } } }

// ce que la page glisse dans le composant léger (paragraphes, cartes), et les cartes de la page une fois cliquées ; par défaut un paragraphe
// et une carte
const GLISSE: Record<string, { g: number; cartes: number; lire: string }> = {
  'mjs-pg-wr-c2': { g: 0, cartes: 2, lire: 'Carte a 1,Carte w 1,Carte v 1' }
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

// le projet construit et ses pages rendues, par environnement
function construire(): Promise<Record<string, Projet>> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-leger-tt')
    const script = '<script type="module" src="/mjs/bundle.js"></script>'
    const out: Record<string, Projet> = {}
    for (const env of ENVS) {
      const config = { sourceDir: 'src', outputDir: 'public/mjs', js: 'split', render: RENDER }
      const dir    = join(root, env)
      mkdirSync(join(dir, 'src'), { recursive: true })
      for (const [f, src] of Object.entries(SOURCES)) writeFileSync(join(dir, 'src', f), src)
      writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify(config))
      const found   = findConfig(dir)
      const bundler = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      const pages: Record<string, string> = {}
      const h: any = await createRenderHandler(config as any, dir, undefined, env)
      for (const r of Object.keys(RENDER.routes)) {
        const body = String(((await h.handle(r, {})) as any).body || '')
        pages[r] = body.includes('<html') ? (body.includes('bundle.js') ? body : body.replace('</body>', script + '</body>')) : `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${body}\n${script}</body></html>`
      }
      if (typeof h.close === 'function') await h.close()
      out[env] = { pages, sortie: join(dir, 'public/mjs') }
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

// la page servie sous Trusted Types (rendue par le serveur, ou la balise seule : bâtie par le navigateur), démarrée (la carte du haut montée)
async function ouvrir(browser: any, p: Projet, chemin: string, tag: string, csr: boolean) {
  const ctx  = await browser.newContext({ viewport: { width: 1000, height: 900 } })
  const page = await ctx.newPage()
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message)))
  await page.route('http://page.test/**', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.pathname === chemin) return route.fulfill({ status: 200, contentType: 'text/html', headers: CSP, body: csr ? `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${tag}></${tag}>\n<script type="module" src="/mjs/bundle.js"></script></body></html>` : p.pages[chemin] })
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

for (const nom of MOTEURS) describe(`composant léger paresseux recréé, page sous Trusted Types — ${nom}`, function () {
  this.timeout(120000)
  let browser: any
  // l'arbre de la page bâtie par le navigateur seul, ses cartes cliquées une fois, par environnement et par page
  const temoins = new Map<string, string>()

  before(async function () {
    this.timeout(300000)
    const playwright: any = await import('playwright')
    await construire()
    browser = await playwright[nom].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const env of ENVS) for (const [chemin, { component: tag }] of Object.entries(RENDER.routes)) {
    it(`${env} ${chemin} : réveil sans erreur, contenu glissé affiché une fois avant, gardé après, cartes vivantes, arbre du navigateur seul`, async function () {
      const p   = (await construire())[env]
      const cle = env + ' ' + tag
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
        const vu                  = { avant, reveil, apres, cartes: await s.page.evaluate(LIRE), arbre: await s.page.evaluate('window.__plan()'), erreurs: s.erreurs }
        const { g, cartes, lire } = GLISSE[tag] || { g: 1, cartes: 1, lire: 'Carte a 1,Carte w 1' }
        const compte              = 'g=' + g + ' cartes=' + cartes
        assert.deepEqual(vu, { avant: 'attend ' + compte, reveil: true, apres: 'reveille ' + compte, cartes: lire, arbre: temoins.get(cle), erreurs: [] })
      }
      finally {
        await s.ctx.close()
      }
    })
  }
})
