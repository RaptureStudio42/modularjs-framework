// Une page rendue par le serveur dans un environnement, reprise par un navigateur qui porte la construction de l'autre : les parties que
// la construction ôte quand aucune page ne les demande (la réponse libre « Autre » de <@@select>, le mode « répondre » de <@@editor>, les
// outils de sa barre <@@toolbar>, les groupes de <@@sortable>) se tranchent pareil en développement et en production. Le gabarit servi
// est celui du navigateur, et la reprise garde les nœuds écrits par le serveur, comme quand le serveur et le navigateur ont le même
// environnement ; aucun composant n'est reconstruit en silence, aucun ne dit que les repères ne correspondent pas.
// Dans Chromium, Firefox et WebKit réels ; le détail de la décision : bundler-coeur-parties-tranchees-partout.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const PAGE = `<script>
  $choix  = null
  $texte  = '<p>Bonjour <b>vous</b></p>'
  $etapes = [{ id: 1, t: 'un' }, { id: 2, t: 'deux' }, { id: 3, t: 'trois' }]
</script>
<@@select class="liste" value=!{$choix}>
  <@@option value="a">Alpha</@@option>
  <@@option value="b">Bêta</@@option>
</@@select>
<@@editor class="ed" name="e" toolbar="bold italic" value=!{$texte}></@@editor>
<@@sortable class="tri" value=!{$etapes}>
  {for et in $etapes by id}
    <div class="ligne">{et.t}</div>
  {end}
</@@sortable>
<p class="fin">fin</p>
`
const SUIVIS = ['mjs-core-select', 'mjs-core-editor', 'mjs-core-sortable']

// avant tout script : les nœuds des modules cœur que le serveur a écrits, dans leurs ombres ; relu après la reprise
const RELEVE = `window.__voir = function () { var out = []; var voir = function (r, m) { r.querySelectorAll('*').forEach(function (el) { if (el.shadowRoot) voir(el.shadowRoot, el.localName); if (m.indexOf('mjs-core-') === 0) out.push([el, m]) }) }; voir(document, ''); return out }; window.__avant = window.__voir()`

const fichiers = (d: string, base = d, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) fichiers(p, base, out)
    else out.push(relative(base, p).split(sep).join('/'))
  }
  return out
}

type Env    = 'dev' | 'prod'
type Rendu  = { html: string, sharedScript: string, hydrateScript: string, out: string, servis: string[] }
type Compte = { avant: number, gardes: number }

// le serveur rend la page dans chaque environnement ; le dossier de sortie de chacun porte aussi la construction du navigateur
let rendus: Promise<Record<Env, Rendu>> | null = null
function rendre(): Promise<Record<Env, Rendu>> {
  return (rendus ??= (async () => {
    const root = mjsTmp('reprise-croisee')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'rp-page.mjs'), PAGE)
    const out = {} as Record<Env, Rendu>
    for (const env of ['dev', 'prod'] as const) {
      const dir = join(root, 'out-' + env)
      const r   = await createSSRRenderer({ sourceDir: join(root, 'src'), outputDir: dir, ...(env === 'prod' ? { env: 'prod' } : {}), bundlerOpts: { runtime: ['hydrate'] } } as any)
      try {
        out[env] = { ...(await r.renderToString('mjs-rp-page', { ssrMode: 'markers' } as any)), out: dir, servis: [] }
      }
      finally {
        await r.close()
      }
      out[env].servis = fichiers(dir)
    }
    return out
  })())
}

/** la page rendue par le serveur `serveur`, reprise par la construction `client` : nœuds écrits par le serveur et gardés, par module ; console */
async function reprendre(browser: any, rendu: Record<Env, Rendu>, serveur: Env, client: Env): Promise<{ par: Record<string, Compte>, avis: string[], fin: string }> {
  const html   = rendu[serveur]
  const sortie = rendu[client].out
  const servis = rendu[client].servis
  const ctx    = await browser.newContext()
  const page   = await ctx.newPage()
  const avis: string[] = []
  page.on('pageerror', (e: any) => avis.push('erreur ' + String(e).slice(0, 300)))
  page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.type() + ' ' + m.text().slice(0, 300)) })
  const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${html.sharedScript}\n${html.html}\n<script>${RELEVE}</script>\n${html.hydrateScript}\n<script type="module" src="/out/bundle.js"></script></body></html>`
  await page.route('http://reprise.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: contenu })
    const f = servis.filter((x) => chemin.endsWith('/' + x)).sort((a, b) => b.length - a.length)[0]
    if (f) return route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(join(sortie, f)) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://reprise.test/', { waitUntil: 'load' })
  await page.waitForFunction((n: string[]) => ['mjs-rp-page', ...n].every((x) => !!customElements.get(x)), SUIVIS, { timeout: 20000 }).catch(() => { throw new Error(`la page ne démarre pas (${serveur} / ${client}) : ${avis.join(' | ') || 'rien en console'}`) })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  const etat = await page.evaluate(() => {
    const w = window as any
    const par: Record<string, { avant: number, gardes: number }> = {}
    w.__avant.forEach((x: any) => { par[x[1]] = par[x[1]] || { avant: 0, gardes: 0 }; par[x[1]].avant++; if (x[0].isConnected) par[x[1]].gardes++ })
    const hote = document.querySelector('mjs-rp-page') as any
    return { par, fin: String(hote?.shadowRoot?.querySelector('.fin')?.textContent) }
  })
  await ctx.close()
  return { ...etat, avis }
}

for (const nom of NAVIGATEURS) describe(`<@@select>, <@@editor> et <@@sortable> repris d'un serveur d'un autre environnement (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    await rendre()
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  for (const [serveur, client, temoin] of [['dev', 'prod', 'prod'], ['prod', 'dev', 'dev']] as const) {
    it(`serveur en ${serveur === 'dev' ? 'développement' : 'production'}, navigateur en ${client === 'dev' ? 'développement' : 'production'} : les nœuds du serveur sont gardés, comme sans croisement`, async () => {
      const rendu  = await rendre()
      const croise = await reprendre(browser, rendu, serveur, client)
      const meme   = await reprendre(browser, rendu, temoin, client)
      for (const m of SUIVIS) {
        assert.ok(meme.par[m] && meme.par[m].gardes > 0, `${m} : la reprise sans croisement garde des nœuds (${JSON.stringify(meme.par[m])})`)
        assert.deepEqual(croise.par[m], meme.par[m], `${m} : nœuds écrits par le serveur et gardés à la reprise`)
      }
      assert.equal(croise.par['mjs-core-select'].gardes, croise.par['mjs-core-select'].avant, 'la liste garde tous ses nœuds')
      assert.equal(croise.fin, 'fin')
      assert.deepEqual(croise.avis, [], 'ni erreur, ni repères qui ne correspondent pas')
    })
  }
})
