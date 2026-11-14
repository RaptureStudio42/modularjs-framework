// Le réveil paresseux (`@wake`) : l'ordre des crochets et les limites.
// - les crochets (`µawake`, `µmount`, props reçues avant `µawake`) d'un parent réveillé et de ses enfants jouent dans l'ordre de la même page
//   sans `@wake` : frères, petit-enfant, dans un `{if}`, dans un `{for}` (sauf en `ssr:markers`, où sa ligne reprise du serveur démarre, sans
//   `@wake`, ses enfants avant elle) ; un enfant qui a son propre `@wake` attend ensuite le sien ;
// - un enfant à `@wake` dont la page du serveur n'existe plus au démarrage (son parent reconstruit au client) se réveille au démarrage, et le
//   développement le dit, une fois par balise ; en `ssr:markers`, le parent repris du serveur lui garde sa page.
// Modes `ssr` (`replace`), `ssr:markers`, `ssr:positional`, `ssr:diff` et `prerender`, en développement et en production (un fichier par
// composant), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { prerenderPages } from '../src/server/prerender.js'

const ENVS  = ['dev', 'prod'] as const
const MODES = ['replace', 'markers', 'positional', 'diff', 'prerender'] as const

const CROCHETS = `  µawake ->
    (window.__crochets ||= []).push('awake ' + $quoi)
  µmount ->
    (window.__crochets ||= []).push('mount ' + $quoi)
`

const ESPACE = `<style>
  .espace
    height: 2600px
</style>
`

const SOURCES: Record<string, string> = {
  'rj-seul.mjs': `<script>
${CROCHETS}</script>

<p class="s">Seul {$quoi}</p>
`,
  'rj-mid.mjs': `<script>
${CROCHETS}</script>

<p class="m">Mid {$quoi}</p>
<@rj-seul quoi={$quoi + '-s'}></@rj-seul>
`,
  'rj-boite.mjs': `<script>
${CROCHETS}</script>

${ESPACE}
<p class="bo">Boite {$quoi}</p>
<@rj-seul quoi={$quoi + '-s1'}></@rj-seul>
<@rj-mid quoi={$quoi + '-m'}></@rj-mid>
<@rj-seul quoi={$quoi + '-s2'}></@rj-seul>
<div class="espace"></div>
<@rj-seul :wake=view quoi={$quoi + '-lz'}></@rj-seul>
`,
  'rj-env.mjs': `<div class="env"><slot></slot></div>
`,
  'rj-page.mjs': `<script>
  $montre = true
</script>

${ESPACE}
<@rj-boite quoi="B2"></@rj-boite>
{if $montre}
  <@rj-boite quoi="B0"></@rj-boite>
{end}
{for q in ['F0']}
  <@rj-boite quoi={q}></@rj-boite>
{end}
<div class="espace"></div>
<@rj-env><@rj-seul :wake=view quoi="sl"></@rj-seul></@rj-env>
<@rj-boite :wake=view quoi="B3"></@rj-boite>
{if $montre}
  <@rj-boite :wake=view quoi="B1"></@rj-boite>
{end}
{for q in ['F1']}
  <@rj-boite :wake=view quoi={q}></@rj-boite>
{end}
`
}

// posée avant tout script de la page : retrouve un composant par le nom affiché dans sa vue (page du serveur ou vue neuve)
const SONDE = `(() => {
  window.__crochets = [];
  const R = (el) => el && (el._shadow || el.shadowRoot || (el.hasAttribute('mjs-light') ? el : null));
  const tous = (r, out) => { for (const el of r.querySelectorAll('*')) if (el.tagName.startsWith('MJS-')) { out.push(el); if (R(el) && R(el) !== el) tous(R(el), out); } return out; };
  window.__comp = (q) => tous(document, []).find((el) => { const r = R(el); const p = r && [...r.children].find((x) => x.matches('.s, .bo, .m')); return !!p && p.textContent.trim().split(' ')[1] === q; });
  window.__in = (q, sel) => { const c = window.__comp(q); return c && R(c).querySelector(sel); };
  window.__attend = (q) => { const c = window.__comp(q); return !!c && c.hasAttribute('mjs-wake'); };
  window.__rv = (q) => window.__crochets.filter((x) => x === 'mount ' + q).length;
})()`

type Construit = { root: string; pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-ordre-limites')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const pages: Record<string, string> = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      for (const mode of ['replace', 'markers', 'positional', 'diff']) {
        const r = await renderer.renderToString('mjs-rj-page', { ssrMode: mode } as any)
        pages[mode] = r.html + '\n' + (r.hydrateScript || '')
      }
    }
    finally {
      await renderer.close()
    }
    const config: any = { sourceDir: srcDir, outputDir: join(root, 'fige'), render: { default: 'prerender', outDir: join(root, 'pages'), routes: { '/': { component: 'mjs-rj-page' } } } }
    const rapport = await prerenderPages(config, root)
    assert.deepEqual(rapport.skipped, [], 'la page est prérendue')
    pages.prerender = readFileSync(join(root, 'pages', 'index.html'), 'utf-8')
    for (const mode of MODES) assert.match(pages[mode], /<mjs-rj-boite\b[^>]*\bmjs-wake="view"/, `le serveur écrit l'attribut du réveil (${mode})`)
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
    }
    return { root, pages, fichiers }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`le réveil paresseux, ordre et limites : ${nom}, ${env}`, function () {
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

  for (const mode of MODES) it(`${mode} : crochets dans l'ordre de la page sans @wake ; un enfant sans page du serveur se réveille au démarrage et le développement le dit`, async function () {
    if (!present) { this.skip(); return }
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.pages[mode]}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    const page    = await context.newPage()
    const erreurs: string[] = []
    const avertis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300))
      if (m.type() === 'warning' && m.text().includes(':wake')) avertis.push(m.text())
    })
    await page.addInitScript(SONDE)
    await page.route('http://reveil-ordre.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      // la feuille partagée que lie la page prérendue (`/fige/…css`), servie depuis la construction
      if (url.pathname.endsWith('.css')) { const f = join(fait.root, url.pathname); await route.fulfill({ status: 200, contentType: 'text/css', body: existsSync(f) ? readFileSync(f) : '' }); return }
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fait.fichiers[env].get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    const ev     = (s: string) => page.evaluate(s)
    const echecs: string[] = []
    const verifie = (ok: boolean, quoi: string) => { if (!ok) echecs.push(quoi) }
    // les crochets d'une boîte et de ses enfants (son enfant paresseux mis à part), le nom de la boîte remplacé par `*`
    const groupe = async (b: string): Promise<string[]> => (await ev('window.__crochets.slice()')).filter((x: string) => x.split(' ')[1].startsWith(b) && !x.endsWith('-lz')).map((x: string) => x.replace(b, '*'))
    try {
      await page.goto('http://reveil-ordre.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`!!customElements.get('mjs-rj-page') && !!customElements.get('mjs-rj-seul') && window.__rv('B2-s2') === 1`, null, { timeout: 15000 })
      await page.waitForTimeout(500)
      const garde = mode === 'markers'
      for (const q of ['B3', 'B1', 'F1']) verifie(await ev(`window.__attend('${q}') && window.__rv('${q}') === 0`), `${q} attend son réveil`)
      for (const q of ['B2-lz', 'sl']) verifie(await ev(`window.__attend('${q}') === ${garde} && window.__rv('${q}') === ${garde ? 0 : 1}`), `${q} ${garde ? 'attend (parent repris du serveur)' : 'se réveille au démarrage (parent reconstruit au client)'}`)
      verifie(await ev(`!window.__attend('B0-lz') && window.__rv('B0-lz') === 1`), 'B0-lz (parent bâti par un {if}) se réveille au démarrage')
      // l'ordre des crochets : chaque boîte réveillée à la vue joue comme sa jumelle sans @wake. En `ssr:markers`, la ligne d'un `{for}`
      // reprise du serveur fait exception : sans @wake, ses enfants démarrent avant elle, sans leurs props ; réveillée, elle démarre avant eux
      for (const [b, temoin] of (mode === 'markers' ? [['B3', 'B2'], ['B1', 'B0']] : [['B3', 'B2'], ['B1', 'B0'], ['F1', 'F0']])) {
        await ev(`window.__in('${b}', '.bo').scrollIntoView({ block: 'start' })`)
        await page.waitForFunction(`window.__rv('${b}-s2') === 1`, null, { timeout: 3000 }).catch(() => null)
        await page.waitForTimeout(300)
        const avec = await groupe(b)
        const sans = await groupe(temoin)
        verifie(JSON.stringify(avec) === JSON.stringify(sans), `ordre de ${b} = celui de ${temoin} : ${JSON.stringify(avec)} contre ${JSON.stringify(sans)}`)
        verifie(await ev(`window.__attend('${b}-lz') && window.__rv('${b}-lz') === 0`), `${b}-lz attend son propre réveil`)
      }
      // (un petit-enfant bâti par le client monte avant d'avoir ses props, sans @wake aussi : son nom manque, il est mis à part)
      verifie(await ev(`window.__crochets.filter((q, i, a) => q.startsWith('mount') && q !== 'mount undefined' && a.indexOf(q) !== i).length === 0`), 'aucun µmount en double')
      // l'avertissement du développement : une fois par balise, avec la raison ; rien en production
      const lus = avertis.filter((m) => m.includes('<mjs-rj-seul>'))
      verifie(env === 'dev' ? lus.length === 1 && /sans effet/.test(lus[0]) && /reconstruit au client/.test(lus[0]) : avertis.length === 0, `avertissement (${env}) : ${JSON.stringify(avertis.map((m) => m.slice(0, 60)))}`)
      verifie(erreurs.length === 0, `aucune erreur : ${JSON.stringify(erreurs)}`)
      assert.deepEqual(echecs, [], `${nom} ${env} ${mode}`)
    }
    finally {
      await context.close()
    }
  })
})
