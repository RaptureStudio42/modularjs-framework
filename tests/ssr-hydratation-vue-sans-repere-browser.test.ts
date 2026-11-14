// En `ssr:markers`, une vue sans nœud réactif (une page qui ne contient que des balises de composants, un composant qui n'a qu'une `<slot>`)
// ne reçoit aucun repère du serveur : le navigateur la reprend telle que le serveur l'a écrite, avec ses composants enfants. Aucun n'est
// recréé, le champ qui avait le focus le garde avec sa saisie, et une carte `@wake=view` attend puis se réveille sur ses nœuds du serveur.
// Vraie chaîne : construction par le bloc `render` du projet (la configuration que lit `mjs build`), pages rendues par `createRenderHandler`
// (le rendu par requête de `mjs serve`), en développement et en production, dans Chromium, Firefox et WebKit. Témoins : la vue réactive et
// la vue qui ne porte qu'un gestionnaire, reprises comme avant ; la vue dont le serveur et le navigateur diffèrent vraiment (sans nœud
// réactif au serveur, avec au navigateur), toujours reconstruite, sans erreur.

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
<input class="u" aria-label="u">

<style>
  :host
    display: block
</style>
`

// des cartes, une carte glissée dans un composant qui n'a qu'une `<slot>`, une carte qui attend de paraître
const CORPS = `<@vs-carte quoi="a"></@vs-carte>
<@vs-fente><@vs-carte quoi="f"></@vs-carte></@vs-fente>
<div class="espace"></div>
<@vs-carte :wake=view quoi="loin"></@vs-carte>

<style>
  .espace
    height: 2600px
</style>
`

const SOURCES: Record<string, string> = {
  'vs-carte.mjs':    CARTE,
  'vs-fente.mjs':    '<div class="boite"><slot></slot></div>\n',
  'vs-statique.mjs': CORPS,
  'vs-reactive.mjs': '<script>\n  $titre = \'Cartes\'\n</script>\n\n<h1>{$titre}</h1>\n' + CORPS,
  'vs-geste.mjs':    '<script>\n  @geste = -> window.__geste = (window.__geste || 0) + 1\n</script>\n\n<button type="button" class="g" @click=@geste>geste</button>\n<@vs-carte quoi="a"></@vs-carte>\n',
  'vs-autre.mjs':    '<script>\n  $d = \'navigateur\'\n</script>\n\n<p class="d">{$d}</p>\n<@vs-carte quoi="a"></@vs-carte>\n',
}

// le serveur construit sur une autre version de `vs-autre` : la même page, sans nœud réactif
const AUTRE_SERVEUR = '<p class="d">serveur</p>\n<@vs-carte quoi="a"></@vs-carte>\n'

const ROUTES: Record<string, string> = { '/statique': 'mjs-vs-statique', '/reactive': 'mjs-vs-reactive', '/geste': 'mjs-vs-geste', '/autre': 'mjs-vs-autre' }
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

// par env : le projet construit comme par `mjs build`, puis ses pages rendues comme par `mjs serve` ; `/autre` vient d'un serveur construit sur l'autre version
function construire() {
  construit ??= (async () => {
    const root    = mjsTmp('vue-sans-repere')
    const projets: Record<string, Projet> = {}
    for (const env of ENVS) {
      const dir   = join(root, env)
      const autre = join(root, env + '-serveur-autre')
      for (const [d, sources] of [[dir, SOURCES], [autre, { ...SOURCES, 'vs-autre.mjs': AUTRE_SERVEUR }]] as const) {
        mkdirSync(join(d, 'src'), { recursive: true })
        for (const [nom, src] of Object.entries(sources)) writeFileSync(join(d, 'src', nom), src)
        writeFileSync(join(d, 'mjs.config.json'), JSON.stringify(CONFIG))
      }
      const found   = findConfig(dir)
      assert.ok(found, 'mjs.config.json doit être trouvé')
      const bundler = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      const pages: Record<string, string> = {}
      const script = '<script type="module" src="/mjs/bundle.js"></script>'
      for (const [d, routes] of [[dir, ['/statique', '/reactive', '/geste']], [autre, ['/autre']]] as const) {
        const h: any = await createRenderHandler(CONFIG as any, d, undefined, env)
        for (const r of routes) {
          const res: any = await h.handle(r, {})
          const body     = String(res.body || '')
          assert.match(body, /__mjs_ssrHydrate="a"|data-mjs-ssr-hydrate="a"/, `${env} ${r} : la page est rendue en markers`)
          pages[r] = body.includes('<html') ? (body.includes('bundle.js') ? body : body.replace('</body>', script + '</body>')) : `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${body}\n${script}</body></html>`
        }
        if (typeof h.close === 'function') await h.close()
      }
      // la racine de la page statique ne porte aucun repère : c'est le cas que ce fichier éprouve
      const s = pages['/statique']
      assert.ok(!/mjs-[he][=:]/.test(s.slice(s.indexOf('<template'), s.indexOf('<mjs-vs-carte'))), `${env} : la racine statique est écrite sans repère`)
      projets[env] = { pages, sortie: join(dir, 'public/mjs') }
    }
    return projets
  })()
  return construit
}

// avant le code : chaque nœud de la page du serveur (racines d'ombre comprises) reçoit un tampon, pour voir ensuite s'il a été gardé
const TAMPON = `(() => { const t = (r) => { const w = document.createTreeWalker(r, 5); let x; while ((x = w.nextNode())) { x.__srv = 1; if (x.shadowRoot) t(x.shadowRoot) } }; window.__racine = document.querySelector('[mjs-ssr]'); window.__racine.__srv = 1; t(window.__racine.shadowRoot) })()`

// la page gardée ou rebâtie : sa racine, chaque carte (sa balise et son paragraphe), la boîte du composant à `<slot>`
const VUE = `(() => {
  const r = (e) => e && (e._shadow || e.shadowRoot)
  const s = r(window.__racine)
  const cartes = [...s.querySelectorAll('mjs-vs-carte')].map((c) => { const q = r(c) && r(c).querySelector('.c'); return (q ? q.textContent.trim().split(' ')[1] : '?') + ':' + (c.__srv ? 'balise-gardee' : 'balise-neuve') + ':' + (q && q.__srv ? 'p-garde' : 'p-neuf') })
  const f = s.querySelector('mjs-vs-fente'), b = f && r(f) && r(f).querySelector('.boite')
  return 'racine=' + ([...s.childNodes].some((x) => x.__srv) ? 'gardee' : 'neuve') + ' cartes=' + cartes.join(',') + (f ? ' fente=' + (b && b.__srv ? 'gardee' : 'neuve') : '')
})()`

// le chemin du focus, d'une racine d'ombre à l'autre, et la valeur du champ qui l'a
const FOCUS = `(() => { let a = document.activeElement; const c = []; while (a) { c.push(a.localName + (typeof a.className === 'string' && a.className ? '.' + a.className : '')); const r = a._shadow || a.shadowRoot; if (!r || !r.activeElement) break; a = r.activeElement } return c.join('>') + ' valeur=' + (a && typeof a.value === 'string' ? a.value : '') })()`

// la carte de rang i de la page (a, f, loin)
const carte = (i: number) => `[...(window.__racine._shadow || window.__racine.shadowRoot).querySelectorAll('mjs-vs-carte')][${i}]`

const TOUT_GARDE = 'racine=gardee cartes=a:balise-gardee:p-garde,f:balise-gardee:p-garde,loin:balise-gardee:p-garde fente=gardee'

after(async () => {
  await terminateSharedWorkerPool()
})

for (const nom of MOTEURS) for (const env of ENVS) describe(`vue sans nœud réactif reprise en markers : ${nom}, ${env}`, function () {
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

  // la page du serveur, le code retenu : tampon, focus et saisie dans le champ de la carte « a », puis le code part et la page démarre
  async function charger(chemin: string) {
    const fait    = (await construire())[env]
    const ctx     = await browser.newContext({ viewport: { width: 1000, height: 900 } })
    const page    = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    let lacher: () => void = () => {}
    const retenu = new Promise<void>((r) => { lacher = r })
    await page.route('http://sans-repere.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === chemin) return route.fulfill({ status: 200, contentType: 'text/html', body: fait.pages[chemin] })
      const f = fichier(fait.sortie, url.pathname)
      if (!f) return route.fulfill({ status: 404, body: '' })
      if (url.pathname.endsWith('/bundle.js')) await retenu
      return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
    })
    await page.goto('http://sans-repere.test' + chemin, { waitUntil: 'commit' })
    await page.waitForFunction(() => { const p = document.querySelector('[mjs-ssr]'); return !!p && !!p.shadowRoot && document.readyState !== 'loading' }, null, { timeout: 15000 })
    await page.evaluate(TAMPON)
    await page.evaluate(`(${carte(0)}).shadowRoot.querySelector('.u').focus()`)
    await page.keyboard.type('ab')
    lacher()
    await page.waitForFunction(() => ((window as any).__ordre || []).includes('a'), null, { timeout: 15000 })
    await page.waitForTimeout(300)
    return { ctx, page, erreurs }
  }

  // un clic sur le bouton de la carte de rang i : son compteur passe à 1, la vue répond
  async function cliquer(page: any, i: number, quoi: string) {
    await page.evaluate(`(${carte(i)})._shadow.querySelector('.plus').click()`)
    await page.waitForFunction(`(${carte(i)})._shadow.querySelector('.c').textContent.trim() === 'Carte ${quoi} 1'`, null, { timeout: 5000 }).catch(() => {})
    assert.equal(await page.evaluate(`(${carte(i)})._shadow.querySelector('.c').textContent.trim()`), `Carte ${quoi} 1`, `le bouton de la carte « ${quoi} » répond`)
  }

  // gardée, focus et saisie compris ; la carte qui attend se réveille sur ses nœuds du serveur
  async function toutGarde(chemin: string, racine: string) {
    const { ctx, page, erreurs } = await charger(chemin)
    try {
      assert.equal(await page.evaluate(VUE), TOUT_GARDE, 'la page du serveur et ses composants enfants sont gardés')
      assert.equal(await page.evaluate(FOCUS), `${racine}>mjs-vs-carte>input.u valeur=ab`, 'le champ garde le focus et la saisie')
      assert.equal(await page.evaluate(`(${carte(2)}).hasAttribute('mjs-wake')`), true, 'la carte du bas attend de paraître')
      await cliquer(page, 0, 'a')
      await page.evaluate(`(${carte(2)}).scrollIntoView()`)
      await page.waitForFunction(() => ((window as any).__ordre || []).includes('loin'), null, { timeout: 15000 })
      assert.equal(await page.evaluate(VUE), TOUT_GARDE, 'la carte réveillée garde ses nœuds du serveur')
      await cliquer(page, 2, 'loin')
      assert.deepEqual(erreurs, [], 'aucune erreur')
    } finally {
      await ctx.close()
    }
  }

  it('une page sans nœud réactif est reprise avec ses composants enfants : aucun recréé, focus et saisie gardés, la carte qui attend aussi', async function () {
    if (!present) this.skip()
    await toutGarde('/statique', 'mjs-vs-statique')
  })

  it('témoin : la même page avec un nœud réactif, reprise de la même façon', async function () {
    if (!present) this.skip()
    await toutGarde('/reactive', 'mjs-vs-reactive')
  })

  it('une page dont le seul repère est un gestionnaire est reprise, son gestionnaire répond', async function () {
    if (!present) this.skip()
    const { ctx, page, erreurs } = await charger('/geste')
    try {
      assert.equal(await page.evaluate(VUE), 'racine=gardee cartes=a:balise-gardee:p-garde', 'la page et sa carte sont gardées')
      assert.equal(await page.evaluate(FOCUS), 'mjs-vs-geste>mjs-vs-carte>input.u valeur=ab', 'le champ garde le focus et la saisie')
      await page.evaluate(`(window.__racine._shadow || window.__racine.shadowRoot).querySelector('.g').click()`)
      assert.equal(await page.evaluate('window.__geste'), 1, 'le gestionnaire de la page répond')
      await cliquer(page, 0, 'a')
      assert.deepEqual(erreurs, [], 'aucune erreur')
    } finally {
      await ctx.close()
    }
  })

  it('serveur sans nœud réactif, navigateur avec : la vue est reconstruite, sans erreur', async function () {
    if (!present) this.skip()
    const { ctx, page, erreurs } = await charger('/autre')
    try {
      const d = `(() => { const p = (window.__racine._shadow || window.__racine.shadowRoot).querySelector('.d'); return p.textContent + ':' + (p.__srv ? 'garde' : 'neuf') })()`
      assert.equal(await page.evaluate(d), 'navigateur:neuf', 'la vue du navigateur remplace celle du serveur')
      assert.equal((await page.evaluate(VUE)).split(' ')[0], 'racine=neuve', 'la racine est reconstruite')
      await cliquer(page, 0, 'a')
      assert.deepEqual(erreurs, [], 'aucune erreur')
    } finally {
      await ctx.close()
    }
  })
})
