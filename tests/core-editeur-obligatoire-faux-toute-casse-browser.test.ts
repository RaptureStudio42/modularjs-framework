// l'éditeur (<@@editor>) dans une application où aucune page n'écrit `answer` : la production l'envoie sans le mode « répondre ».
// `required="FALSE"`, `required="False"` et `required={…}` lié au texte « FALSE » ne le disent pas obligatoire (`aria-required` absent de sa
// zone d'écriture), dans la page rendue par le client, dans la page servie par le serveur et dans la page hydratée ; `required` écrit vide et
// `required={…}` lié à vrai le disent (témoins), et la valeur liée reste suivie après la reprise, « False » compris.
// Chromium, Firefox et WebKit réels, en développement et en production (le serveur construit dans le même environnement que le client)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS } from './helpers/editeur-riche.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const EDITEURS: Array<[string, string]> = [
  ['se', 'required="FALSE"'], ['se2', 'required="False"'], ['sle', 'required={$haut}'], ['te', 'required'], ['tle', 'required={$vrai}']
]

// `aria-required` de la zone d'écriture de chaque éditeur
const ATTENDU = [null, null, null, 'true', 'true']

const PAGE = `<script>
  $haut = 'FALSE'
  $vrai = true
</script>

<form class="f" method="get" action="/envoi" @noUJS>
${EDITEURS.map(([c, a]) => `  <@@editor class="${c}" name="${c}" toolbar="none" ${a}></@@editor>`).join('\n')}
</form>
`

const LIRE = `${JSON.stringify(EDITEURS.map(([c]) => c))}.map((c) => {
  const h = document.querySelector('mjs-hote-ssr'), r = h.shadowRoot || h._shadow
  const e = r.querySelector('.' + c), o = e.shadowRoot || e._shadow, s = o && o.querySelector('.surface')
  return s ? s.getAttribute('aria-required') : 'aucune zone'
})`

type Rendu = { html: string, hydrateScript: string }
type Construit = { rendus: Record<'dev' | 'prod', Rendu>, dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le rendu du serveur en développement et en production, le script de développement et les morceaux du build de production, une fois pour les trois moteurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('editeur-obligatoire-faux')
    const srcDir = join(root, 'src')
    const devDir = join(root, 'dev')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), PAGE)
    const compilateur = await createSSRRenderer({ sourceDir: srcDir, outputDir: devDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    await compilateur.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
    await compilateur.close()
    const files  = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    // chaque composant a sa propre portée, comme au vrai chargement où chaque fichier est un module
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => {
      const code = stripEsm(readFileSync(join(devDir, f), 'utf-8'))
      return f.startsWith('mjs_') ? code : `{\n${code}\n}`
    }).join('\n')
    const dev    = stripEsm(readFileSync(join(devDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres
    const rendus = {} as Record<'dev' | 'prod', Rendu>
    for (const build of ['dev', 'prod'] as const) {
      const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'], ...(build === 'prod' ? { env: 'prod' } : {}) } } as any)
      const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
      rendus[build] = { html, hydrateScript }
      await renderer.close()
    }
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const prod = new Map<string, Buffer>()
    for (const f of readdirSync(outDir)) if (/\.(js|json)$/.test(f)) prod.set(f, readFileSync(join(outDir, f)))
    const editeur = [...prod.keys()].find((f) => /^core-editor-/.test(f))
    assert.ok(editeur, 'le build de production sépare le morceau de l\'éditeur')
    assert.doesNotMatch(prod.get(editeur)!.toString('utf-8'), /aria-checked/, 'la production envoie l\'éditeur sans le mode « répondre »')
    return { rendus, dev, prod }
  })()
  return construit
}

for (const nom of MOTEURS) describe(`éditeur sans le mode « répondre » : required « false » (toute casse), écrit ou lié, ne le dit pas obligatoire (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let contenu = ''
  const erreurs: string[] = []

  // la page dans ce mode : rendue par le client (la balise seule et le script), servie sans script, ou servie puis hydratée
  async function charger(build: 'dev' | 'prod', mode: 'client' | 'servie' | 'hydratee') {
    const r      = fait.rendus[build]
    const script = build === 'dev' ? `<script>${fait.dev.replace(/<\/script/gi, '<\\/script')}</script>` : '<script type="module" src="/out/bundle.js"></script>'
    const corps  = mode === 'client' ? `<mjs-hote-ssr></mjs-hote-ssr>\n${script}` : mode === 'servie' ? r.html : `${r.html}\n${r.hydrateScript}\n${script}`
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
    erreurs.length = 0
    await page.goto('http://obligatoire.test/page', { waitUntil: 'load' })
    if (mode !== 'servie') {
      await page.waitForFunction(`(() => {
        const h = document.querySelector('mjs-hote-ssr')
        const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-editor')) : []
        return m.length === ${EDITEURS.length} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.querySelector('.surface'))
      })()`, undefined, { timeout: 60000 })
    }
    await page.waitForTimeout(400)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.route('http://obligatoire.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/out/')) {
        const corps = fait.prod.get(url.pathname.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const build of ['dev', 'prod'] as const) describe(build === 'dev' ? 'développement' : 'production', function () {
    beforeEach(function () { if (!present) this.skip() })

    it('rendue par le client, servie sans script, hydratée : « FALSE », « False » ou lié au texte « FALSE », la zone ne dit pas aria-required ; écrit vide ou lié à vrai, elle le dit', async function () {
      await charger(build, 'client')
      assert.deepEqual(await page.evaluate(LIRE), ATTENDU, 'rendue par le client')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page rendue par le client')
      await charger(build, 'servie')
      assert.deepEqual(await page.evaluate(LIRE), ATTENDU, 'servie sans script')
      await charger(build, 'hydratee')
      assert.deepEqual(await page.evaluate(LIRE), ATTENDU, 'hydratée')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page hydratée')
    })

    it('après la reprise, la valeur liée reste suivie : « False » ôte aria-required, vrai le remet', async function () {
      await charger(build, 'hydratee')
      const tle = () => page.evaluate(`${LIRE}[4]`)
      assert.equal(await tle(), 'true', 'repris obligatoire')
      await page.evaluate(`document.querySelector('mjs-hote-ssr')._set('vrai', 'False')`)
      await page.waitForTimeout(250)
      assert.equal(await tle(), null, '$vrai lié au texte « False » : plus obligatoire')
      await page.evaluate(`document.querySelector('mjs-hote-ssr')._set('vrai', true)`)
      await page.waitForTimeout(250)
      assert.equal(await tle(), 'true', '$vrai vrai : de nouveau obligatoire')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })
  })
})
