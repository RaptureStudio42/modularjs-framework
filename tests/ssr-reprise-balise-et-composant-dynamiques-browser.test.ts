// POURQUOI CE FICHIER EXISTE
// Une page rendue au serveur puis reprise par le navigateur en `markers` ou en `positional` (le client garde les nœuds du
// serveur au lieu de les refaire) perdait deux choses :
// - `<@element $tag title={$t}>` : changer `$tag` ne changeait plus la balise (« section » restait « section ») et `title`
//   s'écrivait sur l'ancienne balise. Le gabarit rend d'abord un `<div mjs-el="N">` que le rendu remplace par la vraie balise,
//   sans recopier ce repère : le HTML du serveur ne le portait plus, et le client, qui retrouve la balise par lui, ne la
//   retrouvait pas ;
// - `<@module $comp n={$n}>` avec `$n = 1` montrait `A0` au lieu de `A1` : le composant écrit par le serveur est repris tel
//   quel, avec déjà la bonne balise, et ses props, posées seulement quand le client crée lui-même le composant, ne l'étaient
//   jamais ; une prop changée ensuite, avant tout changement de composant, n'arrivait pas non plus.
// - `<@module r.c n={r.n}>` dans une ligne de `{for … by id}` reprise en `markers` : le serveur posait le repère de la ligne sur le
//   `<div mjs-mod>` du gabarit, que le composant a remplacé ; ses props étaient perdues, et ajouter, réordonner ou retirer des lignes
//   mélangeait les composants (une ligne en double).
// Ce que ces tests gardent : dans les quatre modes du serveur, en développement et en production, avec Chromium, Firefox et
// WebKit (et le rendu par le moteur navigateur en `markers` et `positional`), la vue reprise suit chaque écriture de l'état
// comme sans rendu serveur ; en `markers` et `positional`, la balise et le composant de départ sont bien ceux du serveur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { parseEngines } from './helpers/engine-filter.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const MODES      = ['markers', 'replace', 'positional', 'diff'] as const
const ENVS       = ['dev', 'prod'] as const
const NAVIGATEUR = ['markers (moteur navigateur)', 'positional (moteur navigateur)']

const SOURCES: Record<string, string> = {
  'dyn-ca.mjs':  '<script>\n$n = 0\n</script>\n<p class="v">A{$n}</p>\n',
  'dyn-cb.mjs':  '<script>\n$n = 0\n</script>\n<p class="v">B{$n}</p>\n',
  'dyn-el.mjs':  '<script>\n$tag = \'section\'\n$t = \'a\'\n</script>\n<@element $tag data-t="el" title={$t}>texte</@element>\n<button class="titre" @click={$t = \'b\'}>t</button>\n<button class="tag" @click={$tag = \'article\'}>g</button>\n<button class="titre-c" @click={$t = \'c\'}>c</button>\n',
  'dyn-for.mjs': '<script>\n$rows = [{ id: 1, c: \'dyn-ca\', n: 1 }, { id: 2, c: \'dyn-cb\', n: 2 }]\n</script>\n{for r in $rows by id}<@module r.c data-t="mod" n={r.n}></@module>{end}\n<button class="inc" @click={$rows = $rows.map((x) -> Object.assign({}, x, { n: x.n + 10 }))}>i</button>\n<button class="add" @click={$rows = $rows.concat([{ id: 3, c: \'dyn-ca\', n: 3 }])}>a</button>\n<button class="rev" @click={$rows = $rows.slice().reverse()}>r</button>\n<button class="del" @click={$rows = $rows.slice(1)}>d</button>\n',
  'dyn-mod.mjs': '<script>\n$comp = \'dyn-ca\'\n$n = 1\n</script>\n<@module $comp data-t="mod" n={$n}></@module>\n<button class="plus" @click={$n++}>p</button>\n<button class="comp" @click={$comp = \'dyn-cb\'}>c</button>\n'
}

// [hôte, bouton cliqué (vide : l'état de départ), vue attendue juste après]
const ETAPES: Array<[string, string, string]> = [
  ['mjs-dyn-el', '', 'section a'],
  ['mjs-dyn-el', '.titre', 'section b'],
  ['mjs-dyn-el', '.tag', 'article b'],
  ['mjs-dyn-el', '.titre-c', 'article c'],
  ['mjs-dyn-mod', '', 'mjs-dyn-ca A1'],
  ['mjs-dyn-mod', '.plus', 'mjs-dyn-ca A2'],
  ['mjs-dyn-mod', '.comp', 'mjs-dyn-cb B2'],
  ['mjs-dyn-mod', '.plus', 'mjs-dyn-cb B3'],
  ['mjs-dyn-for', '', 'mjs-dyn-ca A1 | mjs-dyn-cb B2'],
  ['mjs-dyn-for', '.inc', 'mjs-dyn-ca A11 | mjs-dyn-cb B12'],
  ['mjs-dyn-for', '.add', 'mjs-dyn-ca A11 | mjs-dyn-cb B12 | mjs-dyn-ca A3'],
  ['mjs-dyn-for', '.rev', 'mjs-dyn-ca A3 | mjs-dyn-cb B12 | mjs-dyn-ca A11'],
  ['mjs-dyn-for', '.del', 'mjs-dyn-cb B12 | mjs-dyn-ca A11']
]

// la vue d'un hôte : pour chaque `[data-t]` (une ligne de `{for}` chacun), la balise et son `title` (balise dynamique), ou la balise
// du composant et son texte, joints par « | »
const LIRE = `window.__lire = function (hote) {
  var h = document.querySelector(hote), r = h && (h._shadow || h.shadowRoot), l = r ? Array.prototype.slice.call(r.querySelectorAll('[data-t]')) : []
  if (!l.length) return 'introuvable'
  return l.map(function (e) {
    if (e.getAttribute('data-t') === 'el') return e.localName + ' ' + e.getAttribute('title')
    var o = e._shadow || e.shadowRoot, v = o && o.querySelector('.v')
    return e.localName + ' ' + (v ? v.textContent : '?')
  }).join(' | ')
}`

// avant le bundle : chaque élément écrit par le serveur porte un tampon, pour voir ensuite s'il a été repris
const TAMPON = `<script>(function () { function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) } document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) }) })()</script>`

type Rendu = { html: string; hydrateScript: string }
type Fait  = { rendus: Record<string, Record<string, Rendu>>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Fait> | null = null

const rendreTout = async (rendre: (tag: string) => Promise<Rendu>): Promise<Rendu> => {
  let html = ''
  let hydrateScript = ''
  for (const tag of ['mjs-dyn-el', 'mjs-dyn-mod', 'mjs-dyn-for']) {
    const r = await rendre(tag)
    html += r.html + '\n'
    hydrateScript = r.hydrateScript
  }
  return { html, hydrateScript }
}

// les rendus du serveur (quatre modes, développement et production ; le moteur navigateur en développement) et les deux builds
// du client, une seule fois pour les trois navigateurs ; le navigateur du serveur se ferme avant que celui du client s'ouvre
function construire(navigateur: boolean): Promise<Fait> {
  construit ??= (async () => {
    const root = mjsTmp('reprise-dynamiques')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (const [n, s] of Object.entries(SOURCES)) writeFileSync(join(src, n), s)
    const rendus: Record<string, Record<string, Rendu>> = { dev: {}, prod: {} }
    for (const env of ENVS) {
      const renderer = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'ssr-' + env), bundlerOpts: { runtime: ['hydrate'], env } } as any)
      try {
        for (const mode of MODES) rendus[env][mode] = await rendreTout((tag) => renderer.renderToString(tag, { ssrMode: mode } as any))
      } finally {
        await renderer.close()
      }
    }
    if (navigateur) {
      const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur', runtime: ['hydrate'] } as any, { configDir: root })
      try {
        for (const variante of NAVIGATEUR) rendus.dev[variante] = await rendreTout((tag) => nav.renderPage(tag, { ssrMode: variante.split(' ')[0] } as any))
      } finally {
        await nav.close()
      }
    }
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: src, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
    }
    return { rendus, fichiers }
  })()
  return construit
}

const voulus = parseEngines(process.env.MJS_MOTEURS)

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) for (const mode of [...MODES, ...(nom === 'chromium' && env === 'dev' ? NAVIGATEUR : [])]) describe(`<@element> et <@module> après la reprise : ${nom}, ${env}, « ${mode} »`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []
  const adopte = mode.startsWith('markers') || mode.startsWith('positional')

  before(async function () {
    const playwright = await import('playwright')
    present = (!voulus || voulus.has(nom)) && existsSync(playwright[nom].executablePath())
    if (!present) { this.skip(); return }
    const fait     = await construire(!voulus || voulus.has('chromium'))
    const rendu    = fait.rendus[env][mode]
    const fichiers = fait.fichiers[env]
    const contenu  = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendu.html}\n${rendu.hydrateScript}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    browser = await playwright[nom].launch()
    page    = await browser.newPage()
    await page.addInitScript(`window.__name = (f) => f; ${LIRE}`)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push('console ' + m.type() + ' : ' + m.text().slice(0, 300)) })
    await page.route('http://reprise.test/**', async (route: any) => {
      const chemin = new URL(route.request().url()).pathname
      if (chemin.startsWith('/out/')) {
        const corps = fichiers.get(chemin.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
    })
    await page.goto('http://reprise.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`['mjs-dyn-el', 'mjs-dyn-mod', 'mjs-dyn-for'].every((t) => { const h = document.querySelector(t); return h && h.matches(':defined') && h._shadow && h._shadow.firstElementChild })`, null, { timeout: 60000 })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  if (adopte) it('la balise et le composant de départ sont ceux que le serveur a écrits', async function () {
    if (!present) { this.skip(); return }
    // un composant qui porte un `{for}` est rebâti en `positional` (docs/19-ssr.md) : ses lignes ne sont reprises qu'en `markers`
    for (const hote of ['mjs-dyn-el', 'mjs-dyn-mod', ...(mode.startsWith('markers') ? ['mjs-dyn-for'] : [])]) {
      assert.equal(await page.evaluate(`(() => { const h = document.querySelector('${hote}'); const e = h._shadow.querySelector('[data-t]'); return !!e && e.__srv === true })()`), true, `${hote} : [data-t] est le nœud du serveur`)
    }
  })

  for (const [quoi, h] of [['<@element>', 'mjs-dyn-el'], ['<@module>', 'mjs-dyn-mod'], ['<@module> dans un {for}', 'mjs-dyn-for']]) it(`${quoi} : la vue reprise suit chaque écriture de l'état, comme sans rendu serveur`, async function () {
    if (!present) { this.skip(); return }
    for (const [hote, bouton, attendu] of ETAPES.filter((e) => e[0] === h)) {
      if (bouton) await page.evaluate(`document.querySelector('${hote}')._shadow.querySelector('${bouton}').click()`)
      let vu = ''
      for (let i = 0; i < 100 && vu !== attendu; i++) {
        vu = await page.evaluate(`__lire('${hote}')`)
        if (vu !== attendu) await new Promise((r) => setTimeout(r, 30))
      }
      assert.equal(vu, attendu, `${hote} ${bouton ? 'après ' + bouton : 'au départ'}`)
    }
  })

  it('aucune erreur ni aucun avertissement dans la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [])
  })
})
