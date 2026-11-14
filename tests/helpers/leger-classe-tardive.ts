// banc commun : un composant léger que le navigateur définit APRÈS la reprise de la page qui lui glisse une carte et un champ de saisie,
// par position (`ssr:positional`), et par marqueurs (`ssr:markers`) sur une page qui glisse dans ce contenu un second composant léger.
// Le composant est léger par sa seule classe (rien ne le dit léger à l'endroit où la page le pose), sous chaque forme : `static mjsLight
// = true` (champ), `static get mjsLight()` (accesseur), sous-classe d'une base légère (héritage) ; ou par `@lightDom`. Les cartes glissées
// restent à l'écran avant comme après la définition, le champ garde ce qu'on y a tapé (et, par marqueurs, le curseur ; par position, le curseur suit la page bâtie
// par le navigateur seul), les cartes répondent, et l'arbre
// final est celui de la même page bâtie par le navigateur seul. Le serveur rend les mêmes pages, avec la même classe, par le moteur
// demandé (`happy-dom` ou `browser`) : c'est lui qui écrit `mjs-light` sur la balise de chaque composant léger, à toute profondeur, et,
// par marqueurs, le repère qui sépare sa page du contenu glissé. Vraie chaîne : construction par le bloc `render` du projet (la
// configuration que lit `mjs build`), page rendue par `createRenderHandler` (le rendu par requête de `mjs serve`), dans Chromium, Firefox
// et WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../../src/bundler/config.js'
import { createRenderHandler } from '../../src/server/render-request.js'

type MoteurServeur = 'happy-dom' | 'browser'
type Env           = 'dev' | 'prod'
type Forme         = 'champ' | 'accesseur' | 'heritage' | 'lightDom'
const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
// par position, la page qui glisse une carte au composant léger ; par marqueurs, celle qui glisse aussi un second composant léger dans ce contenu
const ROUTES  = { '/pos': { component: 'mjs-pg-ct-leger', mode: 'ssr:positional' }, '/mrk': { component: 'mjs-pg-ct-profond', mode: 'ssr:markers' } } as const
type Chemin   = keyof typeof ROUTES

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

// les pages posent le composant léger sans rien qui le dise léger, au serveur comme au navigateur, sauf en `@lightDom` ; la première
// fente reçoit aussi un champ de saisie
const LEGER   = `<@ct-carte quoi="a"></@ct-carte>\n<@ct-fente><@ct-carte quoi="w"></@ct-carte><input type="text" class="saisie"></@ct-fente>\n`
const PROFOND = `<@ct-carte quoi="a"></@ct-carte>\n<@ct-fente><@ct-carte quoi="w"></@ct-carte><input type="text" class="saisie"><@ct-fente><@ct-carte quoi="z"></@ct-carte></@ct-fente></@ct-fente>\n`
const sources = (forme: Forme) => {
  const pose = (s: string) => forme === 'lightDom' ? s.replace(/<@ct-fente>/g, '<@ct-fente :lightDom>') : s
  return { 'ct-carte.mjs': CARTE, 'ct-fente.mjs': '<div class="boite"><slot></slot></div>\n', 'pg-ct-leger.mjs': pose(LEGER), 'pg-ct-profond.mjs': pose(PROFOND) }
}
// ce que montre chaque route : les marques du serveur, les cartes glissées dans le premier composant léger, les cartes une fois cliquées
const ATTENDU = { '/pos': { serveur: 'mjs-light 1/1', glissees: 1, cartes: 'Carte a 1,Carte w 1' }, '/mrk': { serveur: 'mjs-light 2/2, repères 2', glissees: 2, cartes: 'Carte a 1,Carte w 1,Carte z 1' } }

// la classe du composant léger telle que la déclare chaque forme : `static mjsLight = true` (champ), `static get mjsLight()` (accesseur),
// sous-classe d'une base légère (héritage) ; en `@lightDom`, la classe reste telle quelle, la page pose l'attribut
const LEGERE: Record<Forme, string> = {
  champ:     '(c) => { c.mjsLight = true; return c }',
  accesseur: "(c) => { Object.defineProperty(c, 'mjsLight', { get() { return true }, configurable: true }); return c }",
  heritage:  '(c) => { c.mjsLight = true; return class extends c {} }',
  lightDom:  '(c) => c',
}
// au navigateur du visiteur, la classe du composant léger, déclarée selon la forme, attend `__definir()`
const retard = (forme: Forme) => `(() => {
  const legere  = ${LEGERE[forme]}
  const definir = customElements.define.bind(customElements)
  customElements.define = (nom, classe, options) => {
    if (nom !== 'mjs-ct-fente') return definir(nom, classe, options)
    const k = legere(classe)
    window.__definir = () => definir(nom, k, options)
  }
})()`
// au navigateur du rendu serveur (moteur `browser`), la même classe est définie sans attendre
const legerServeur = (forme: Forme) => `(() => {
  const legere  = ${LEGERE[forme]}
  const definir = customElements.define.bind(customElements)
  customElements.define = (nom, classe, options) => definir(nom, nom === 'mjs-ct-fente' ? legere(classe) : classe, options)
})()`

type Projet = { pages: Record<string, string>; sortie: string }

// le fichier de la sortie que demande une adresse de la page (le bundle, un morceau, une feuille)
function fichier(sortie: string, chemin: string): string | null {
  const segs = chemin.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const f = join(sortie, ...segs.slice(i))
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

// le rendu du serveur avec la même classe que le navigateur, déclarée selon la forme, dans la fenêtre happy-dom du
// rendu comme dans chaque page du navigateur de rendu (moteur `browser`, tout contexte ouvert pendant le rendu)
async function avecClasseLegere<T>(serveur: MoteurServeur, forme: Forme, f: () => Promise<T>): Promise<T> {
  if (serveur === 'browser') {
    const playwright: any = await import('playwright')
    const essai: any      = await playwright.chromium.launch()
    const proto: any      = Object.getPrototypeOf(essai)
    const newContext      = proto.newContext
    await essai.close()
    proto.newContext = async function (this: any, ...args: any[]) {
      const ctx = await newContext.apply(this, args)
      await ctx.addInitScript(legerServeur(forme))
      return ctx
    }
    try {
      return await f()
    }
    finally {
      proto.newContext = newContext
    }
  }
  const fenetre: any = new Window()
  const proto: any   = Object.getPrototypeOf(fenetre.customElements)
  const define       = proto.define
  await fenetre.happyDOM.close()
  const legere       = new Function('return ' + LEGERE[forme])()
  proto.define = function (nom: string, classe: any, options: any) {
    return define.call(this, nom, nom === 'mjs-ct-fente' ? legere(classe) : classe, options)
  }
  try {
    return await f()
  }
  finally {
    proto.define = define
  }
}

// le projet construit et ses pages rendues par le serveur (une par route), par environnement
function construire(serveur: MoteurServeur, envs: readonly Env[], forme: Forme): Promise<Record<string, Projet>> {
  const routes = Object.fromEntries(Object.entries(ROUTES).map(([chemin, r]) => [chemin, serveur === 'browser' ? { ...r, engine: 'browser' } : r]))
  return avecClasseLegere(serveur, forme, async () => {
    const root   = mjsTmp('leger-classe-tardive')
    const script = '<script type="module" src="/mjs/bundle.js"></script>'
    const out: Record<string, Projet> = {}
    for (const env of envs) {
      const config = { sourceDir: 'src', outputDir: 'public/mjs', js: 'split', render: { default: 'ssr:markers', routes } }
      const dir    = join(root, env)
      mkdirSync(join(dir, 'src'), { recursive: true })
      for (const [f, src] of Object.entries(sources(forme))) writeFileSync(join(dir, 'src', f), src)
      writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify(config))
      const found   = findConfig(dir)
      const bundler = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      // le rendu par requête écrit aussi l'entrée `bundle.js` dans la sortie
      const h: any = await createRenderHandler(config as any, dir, undefined, env)
      const pages: Record<string, string> = {}
      try {
        for (const chemin of Object.keys(ROUTES)) {
          const body = String(((await h.handle(chemin, {})) as any).body || '')
          pages[chemin] = body.includes('<html') ? (body.includes('bundle.js') ? body : body.replace('</body>', script + '</body>')) : `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${body}\n${script}</body></html>`
        }
      }
      finally {
        if (typeof h.close === 'function') await h.close()
      }
      if (!existsSync(join(dir, 'public/mjs/bundle.js'))) throw new Error('bundle.js absent de la sortie : ' + readdirSync(dir, { recursive: true } as any).join(','))
      out[env] = { pages, sortie: join(dir, 'public/mjs') }
    }
    return out
  })
}

// les composants légers dans la page du serveur (feuilles abrégées), et ce que le serveur y écrit : le moteur qui l'a rendue (le moteur
// `browser` marque ses feuilles `data-mjs-ssr`), `mjs-light` sur chaque balise, et par marqueurs les repères `<!--mjs-l-->`
function balise(page: string): string {
  return (page.match(/<mjs-ct-fente[\s\S]*<\/mjs-ct-fente>/) || ['absente'])[0].replace(/<style([^>]*)>[^<]*<\/style>/g, '<style$1>…</style>')
}
function marque(page: string, chemin: Chemin): string {
  const tags = page.match(/<mjs-ct-fente[^>]*>/g) || []
  const attr = (/<style data-mjs-ssr/.test(page) ? 'browser' : 'happy-dom') + ', mjs-light ' + tags.filter((t) => /\smjs-light[\s>=]/.test(t)).length + '/' + tags.length
  return ROUTES[chemin].mode === 'ssr:markers' ? attr + ', repères ' + (page.match(/<!--mjs-l-->/g) || []).length : attr
}

// dans la page : le composant léger (classe définie ou non, cartes glissées qu'il affiche), les cartes, et l'arbre de la page en texte,
// racines d'ombre comprises (commentaires, feuilles et scripts mis à part)
const outils = (tag: string) => `(() => {
  const tous = (n, f, acc) => { const k = n.shadowRoot || (n._shadow && n._shadow !== n ? n._shadow : null); for (const c of [...(k ? k.childNodes : []), ...n.childNodes]) { if (c.nodeType === 1 && f(c)) acc.push(c); tous(c, f, acc) } return acc }
  const racine = () => document.querySelector('${tag}')
  window.__fente  = () => tous(racine(), (e) => e.localName === 'mjs-ct-fente', [])[0]
  window.__cartes = () => tous(racine(), (e) => e.localName === 'mjs-ct-carte', [])
  window.__saisie = () => tous(racine(), (e) => e.localName === 'input' && e.classList.contains('saisie'), [])[0]
  window.__etat   = () => { const f = window.__fente(); return f ? (customElements.get('mjs-ct-fente') ? 'defini' : 'non-defini') + ' glissees=' + f.querySelectorAll('mjs-ct-carte').length : 'sans-fente' }
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
// le champ de saisie glissé : rempli et pris par le curseur avant la définition de la classe, relu après
const SAISIR = `(() => { const i = window.__saisie(); if (i) { i.focus(); i.value = 'xyz' } })()`
const SAISIE = `(() => { const i = window.__saisie(); return i ? i.value + (i.matches(':focus') ? ' focus' : ' sans-focus') : 'sans-saisie' })()`

// la page servie (rendue par le serveur, ou la balise seule : bâtie par le navigateur), démarrée : la carte du haut montée, la classe du
// composant léger chargée mais pas encore définie
async function ouvrir(browser: any, p: Projet, chemin: Chemin, csr: boolean, forme: Forme) {
  const tag = ROUTES[chemin].component
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } })
  await ctx.addInitScript(retard(forme))
  const page = await ctx.newPage()
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message)))
  const journal: string[] = []
  const manquants: string[] = []
  page.on('console', (m: any) => journal.push(m.type() + ': ' + m.text()))
  await page.route('http://page.test/**', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.pathname === chemin) return route.fulfill({ status: 200, contentType: 'text/html', body: csr ? `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${tag}></${tag}>\n<script type="module" src="/mjs/bundle.js"></script></body></html>` : p.pages[chemin] })
    const f = fichier(p.sortie, url.pathname)
    if (!f) { manquants.push(url.pathname); return route.fulfill({ status: 404, body: '' }) }
    return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
  })
  await page.goto('http://page.test' + chemin)
  const pret = await page.waitForFunction(() => ((window as any).__ordre || []).includes('a') && typeof (window as any).__definir === 'function', null, { timeout: 15000 }).then(() => true, () => false)
  if (!pret) {
    const etat = await page.evaluate(`JSON.stringify({ ordre: window.__ordre || [], definir: typeof window.__definir, page: !!customElements.get('${tag}'), carte: !!customElements.get('mjs-ct-carte') })`)
    await ctx.close()
    assert.fail('page démarrée, classe du composant léger chargée : ' + etat + ' manquants=' + manquants.join(',') + ' sortie=' + readdirSync(p.sortie, { recursive: true } as any).join(',') + ' ' + erreurs.concat(journal.slice(0, 6)).join(' | '))
  }
  await page.evaluate(outils(tag))
  return { ctx, page, erreurs }
}

// la page démarrée puis la classe définie : l'état avant et après, les cartes une fois cliquées, l'arbre final
async function jouer(browser: any, p: Projet, chemin: Chemin, csr: boolean, forme: Forme) {
  const c = await ouvrir(browser, p, chemin, csr, forme)
  try {
    await c.page.waitForTimeout(300)
    const avant = await c.page.evaluate('window.__etat()')
    await c.page.evaluate(SAISIR)
    await c.page.evaluate('window.__definir()')
    await c.page.waitForTimeout(300)
    const apres  = await c.page.evaluate('window.__etat()')
    const saisie = await c.page.evaluate(SAISIE)
    await c.page.evaluate(CLICS)
    await c.page.waitForTimeout(300)
    return { avant, apres, saisie, cartes: await c.page.evaluate(LIRE), arbre: await c.page.evaluate('window.__plan()'), erreurs: c.erreurs }
  }
  finally {
    await c.ctx.close()
  }
}

// les deux routes, rendues par le moteur `serveur`, dans les trois navigateurs, pour chaque environnement de `envs`
export function suiteLegerClasseTardive(serveur: MoteurServeur, formes: Partial<Record<Forme, readonly Env[]>>): void {
  const construits: Partial<Record<Forme, Promise<Record<string, Projet>>>> = {}
  after(async () => { await terminateSharedWorkerPool() })

  for (const [forme, envs] of Object.entries(formes) as [Forme, readonly Env[]][]) for (const nom of MOTEURS) describe(`composant léger [${forme}], défini après la reprise de la page, rendu serveur ${serveur} — ${nom}`, function () {
    this.timeout(120000)
    let browser: any
    // chaque page bâtie par le navigateur seul, une fois par environnement
    const temoins: Record<string, Promise<any>> = {}

    before(async function () {
      this.timeout(300000)
      const playwright: any = await import('playwright')
      await (construits[forme] ??= construire(serveur, envs, forme))
      browser = await playwright[nom].launch()
    })
    after(async () => { if (browser) await browser.close() })

    for (const env of envs) for (const chemin of Object.keys(ROUTES) as Chemin[]) {
      it(`${env}, ${ROUTES[chemin].mode} : le serveur marque les composants légers, cartes glissées gardées avant et après la définition de la classe, saisie et curseur gardés, cartes vivantes, arbre du navigateur seul`, async function () {
        const p      = (await construits[forme]!)[env]
        const a      = ATTENDU[chemin]
        temoins[env + chemin] ??= jouer(browser, p, chemin, true, forme)
        const temoin = await temoins[env + chemin]
        const vu     = { serveur: marque(p.pages[chemin], chemin), ...(await jouer(browser, p, chemin, false, forme)) }
        assert.deepEqual(temoin.erreurs, [], 'page bâtie par le navigateur seul sans erreur')
        assert.match(String(temoin.saisie), /^xyz /, 'champ glissé gardé par le navigateur seul')
        try {
          assert.deepEqual(vu, { serveur: serveur + ', ' + a.serveur, avant: 'non-defini glissees=' + a.glissees, apres: 'defini glissees=' + a.glissees, saisie: ROUTES[chemin].mode === 'ssr:markers' ? 'xyz focus' : temoin.saisie, cartes: a.cartes, arbre: temoin.arbre, erreurs: [] })
        }
        catch (e: any) {
          e.message += '\nbalise du serveur : ' + balise(p.pages[chemin])
          throw e
        }
      })
    }
  })
}
