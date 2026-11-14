// Le réveil à l'intention (`:wake=interaction`) sur une page rendue en `ssr` : un champ dont la balise reçoit au montage un attribut posé
// par le runtime — une classe conditionnelle (`:class{…}="…"`), un effet (`*underline`) sur son parent, la portée d'un composant léger
// (`mjs-light`) — reste le même champ. La saisie faite dans la page du serveur passe au champ de la vue, son `@input` est appelé une fois, et
// la console ne dit rien. Rendu `ssr`, développement et production, dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'vr-classe.mjs': `<script>
  $on = true
</script>

<p class="c">Classe</p>
<input class="q" :class{$on}="vif" aria-label="q" @input={window.__log.push('classe:' + e.target.value)}>
`,
  'vr-effet.mjs': `<p class="c">Effet</p>
<div class="cadre" *underline><input class="q" aria-label="q" @input={window.__log.push('effet:' + e.target.value)}></div>
`,
  'vr-leger.mjs': `<p class="c">Léger</p>
<input class="q" aria-label="q" @input={window.__log.push('leger:' + e.target.value)}>
`,
  'vr-page.mjs': `<@vr-classe :wake=interaction></@vr-classe>
<@vr-effet :wake=interaction></@vr-effet>
<@vr-leger mjs-light :wake=interaction></@vr-leger>
`
}
const CARTES = ['classe', 'effet', 'leger']

const SONDE = `(() => {
  window.__log = [];
  window.__avertis = [];
  const avertir = console.warn;
  console.warn = function (...a) { window.__avertis.push(a.join(' ')); return avertir.apply(this, a); };
  const racine = (el) => el && (el._shadow || el.shadowRoot || el);
  const ombre  = (el) => el && (el._shadow || el.shadowRoot);
  const tous   = (nom) => { const out = [], fouille = (r) => r.querySelectorAll('*').forEach((e) => { if (e.localName === nom) out.push(e); if (ombre(e) && ombre(e) !== e) fouille(ombre(e)); }); fouille(document); return out; };
  window.__carte = (q) => tous('mjs-vr-' + q)[0];
  window.__champ = (q) => racine(window.__carte(q)).querySelector('.q');
  window.__vus = () => ${JSON.stringify(CARTES)}.map((q) => q + '=' + (window.__champ(q) ? window.__champ(q).value : '?'));
  window.__wake = () => window.__avertis.filter((a) => a.includes(':wake'));
})()`

type Construit = { page: string; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-intention-attributs')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    let page = ''
    try {
      const r = await renderer.renderToString('mjs-vr-page', { ssrMode: 'replace' } as any)
      page = r.html + '\n' + (r.hydrateScript || '')
    }
    finally {
      await renderer.close()
    }
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ['dev', 'prod']) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env, render: { default: 'ssr' } } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], `construction ${env}`)
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
    }
    return { page, fichiers }
  })()
  return construit
}

const NAVIGATEURS = (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>

for (const nom of NAVIGATEURS) describe(`le réveil à l'intention en ssr, attributs posés par le runtime au montage : ${nom}`, function () {
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

  for (const env of ['dev', 'prod'] as const) for (const q of CARTES) it(`ssr ${env}, ${q} : la saisie faite avant le réveil passe au champ, son @input est appelé une fois`, async function () {
    if (!present) { this.skip(); return }
    let lacher = () => {}
    const code     = new Promise<void>((r) => { lacher = r })
    const fichiers = fait.fichiers[env]
    const contenu  = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.page}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page     = await browser.newPage({ viewport: { width: 1000, height: 1200 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    await page.addInitScript(SONDE)
    await page.route('http://intention-attributs.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fichiers.get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      if (url.pathname === '/out/bundle.js') await code
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    try {
      await page.goto('http://intention-attributs.test/page', { waitUntil: 'commit' })
      await page.waitForFunction(`!!window.__champ('leger')`, null, { timeout: 15000 })
      await page.mouse.move(990, 1190)
      assert.deepEqual(await page.evaluate('window.__vus()'), ['classe=', 'effet=', 'leger='], 'la page du serveur')
      await page.evaluate(`window.__champ('${q}').focus()`)
      await page.keyboard.type('xy')
      lacher()
      await page.waitForFunction(`window.__log.length >= 1 || window.__wake().length > 0`, null, { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(300)
      assert.deepEqual(await page.evaluate(`window.__champ('${q}').value`), 'xy', 'le champ garde sa saisie')
      assert.deepEqual(await page.evaluate('window.__log.slice()'), [q + ':xy'], 'son @input appelé une fois')
      assert.deepEqual(await page.evaluate('window.__wake()'), [], 'aucun avertissement')
      assert.deepEqual(erreurs, [])
    }
    finally {
      lacher()
      await page.close()
    }
  })
})
