// Éditeur de texte riche du cœur (<@@editor>) dans une page RENDUE PAR LE SERVEUR puis hydratée, chargée comme en PRODUCTION : un vrai build
// `env: 'prod'` (minifié, un morceau par module, manifeste `bundle.js` et chargeur à la demande), servi tel quel à Chromium, Firefox et WebKit
// réels, pour chacun des quatre modes de reprise (`ssrMode` : markers, replace, positional, diff) et dans les deux ordres où les morceaux peuvent arriver :
//   · « la page d'abord » : le morceau de la page est évalué avant celui de l'éditeur et de sa barre ;
//   · « les modules d'abord » : les morceaux des modules sont déjà évalués quand celui de la page arrive.
// Dans chaque cas, comme en développement (core-editeur-hydratation-browser.test.ts) : la reprise ne défait rien, un seul champ par valeur,
// et l'éditeur marche après la reprise (frappe, case cochée en mode « répondre », form.reset()).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS } from './helpers/editeur-riche.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const MODES  = ['markers', 'replace', 'positional', 'diff'] as const
const ORDRES = ['la page d\'abord', 'les modules d\'abord'] as const

const TEXTE  = '<h2>Titre</h2><p>Un <b>mot</b></p><ul data-checklist><li data-checked>fait</li><li>à faire</li></ul>'
const PROPRE = '<h2>Titre</h2><p>Un <strong>mot</strong></p><ul data-checklist><li data-checked>fait</li><li>à faire</li></ul>'

const HOTE = `<script>
  $texte  = '${TEXTE}'
  $modele = '<p>Cochez</p><ul data-checklist><li>un</li><li>deux</li><li>trois</li></ul>'
  $coches = [0, 2]
</script>

<form class="f" method="get" action="/envoi" @noUJS>
  <@@editor class="e" name="contrat" value=!{$texte}></@@editor>
  <@@editor class="r" name="reps[]" answer value={$modele} checked=!{$coches}></@@editor>
  <button type="reset" class="rz">remise à zéro</button>
</form>
<pre class="o">{$texte}</pre>
<pre class="c">{JSON.stringify($coches)}</pre>
`

type Construit = { rendus: Record<string, { html: string; hydrateScript: string }>; fichiers: Map<string, Buffer> }

let construit: Promise<Construit> | null = null

// le rendu serveur dans chaque mode et le build de production (jamais servi depuis le disque : tout est lu en mémoire), une seule fois pour tous les moteurs
function construire() {
  construit ??= (async () => {
    const root    = mjsTmp('editeur-hydratation-prod')
    const srcDir  = join(root, 'src')
    const prodDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] }, env: 'prod' } as any)
    const rendus: Record<string, { html: string; hydrateScript: string }> = {}
    for (const mode of MODES) {
      const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: mode } as any)
      rendus[mode] = { html, hydrateScript }
    }
    await renderer.close()
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(prodDir, f)))
    assert.ok([...fichiers.keys()].some((f) => /^core-editor-/.test(f)) && [...fichiers.keys()].some((f) => /^core-toolbar-/.test(f)), 'le build de production sépare un morceau par module')
    return { rendus, fichiers }
  })()
  return construit
}

for (const nom of MOTEURS) describe(`éditeur riche : build de production, page rendue par le serveur puis hydratée (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let ordre: typeof ORDRES[number] = ORDRES[0]
  let fichiers = new Map<string, Buffer>()
  let rendus: Record<string, { html: string; hydrateScript: string }> = {}
  const erreurs: string[] = []

  const E       = (expr: string): Promise<any> => page.evaluate(expr)
  const pause   = (ms = 150) => page.waitForTimeout(ms)
  const champs  = (): Promise<string[]> => E(`Array.from(new FormData(__q('.f'))).map((p) => p[0] + '=' + p[1])`)
  const parEdit = (): Promise<string[]> => E(`Array.from(__q('.f').querySelectorAll('mjs-core-editor')).map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`)

  // la page rendue par le serveur dans ce mode, le build de production chargé après elle, puis l'attente du montage des deux éditeurs
  async function charger(mode: string) {
    const pre = `<script>(function () { document.querySelector('mjs-hote-ssr').shadowRoot.querySelectorAll('form').forEach(function (f) { f.__srv = true }) })()</script>`
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendus[mode].html}\n${pre}\n${rendus[mode].hydrateScript}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    await page.goto('http://localhost/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote-ssr')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-editor')) : []
      return m.length === 2 && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.querySelector('.surface'))
    })()`, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote-ssr')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  }

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const fait = await construire()
    fichiers = fait.fichiers
    rendus   = fait.rendus
    browser  = await playwright[nom].launch()
    page     = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    page.on('console', (m: any) => { if (['error', 'warning'].includes(m.type())) erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.route('http://localhost/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/envoi') {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
        return
      }
      if (url.pathname.startsWith('/out/')) {
        const f = url.pathname.slice(5)
        let corps = fichiers.get(f)
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        // « les modules d'abord » : avant de lancer le chargeur, le manifeste évalue le morceau de chaque module du cœur, l'un après l'autre
        if (f === 'bundle.js' && ordre === ORDRES[1]) {
          const texte = corps.toString('utf-8')
          const lance = 'if (µ.Autoloader) {'
          assert.ok(texte.includes(lance), 'le manifeste lance le chargeur à cet endroit')
          corps = Buffer.from(texte.replace(lance, 'for (const n of Object.keys(µPaths).filter((k) => k.startsWith(\'core-\'))) { await import(µPathsPrefix + µPaths[n]); }\n  ' + lance), 'utf-8')
        }
        await route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const ord of ORDRES) for (const mode of MODES) describe(`hydratation « ${mode} », ${ord}`, function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      ordre          = ord
      erreurs.length = 0
      await charger(mode)
    })

    it('la reprise ne défait rien : surface, champs, variable de la page, console', async function () {
      if (!present) { this.skip(); return }
      assert.equal(await E(`__q('.f').__srv === true`), mode !== 'replace', 'le mode demandé est celui qui a joué : les nœuds de la page sont repris, sauf en « replace »')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      assert.equal(await E(`__q('.e')._shadow.querySelector('.surface').innerHTML.replace(/ aria-description="[^"]*"/g, '').replace(/=""/g, '')`), PROPRE, 'la surface porte le HTML propre')
      assert.equal(await E(`__q('.o').textContent`), TEXTE, 'la variable de la page n\'est pas réécrite tant que rien n\'a été modifié')
      assert.deepEqual(await parEdit(), ['e:1', 'r:2'], 'un champ pour le texte, un par case cochée, jamais doublés')
      assert.deepEqual(await champs(), ['contrat=' + PROPRE, 'reps[]=0', 'reps[]=2'])
      assert.equal(await E(`Array.from(__q('.r')._shadow.querySelectorAll('.line')).map((l) => l.getAttribute('aria-checked')).join()`), 'true,false,true', 'les cases cochées par le serveur le restent')
    })

    it('après la reprise : la frappe remonte, une case se coche, form.reset() rend l\'état de départ', async function () {
      if (!present) { this.skip(); return }
      await E(`(() => { const sf = __q('.e')._shadow.querySelector('.surface'); sf.focus(); const w = document.createTreeWalker(sf, 4); let n; while ((n = w.nextNode())) if (n.nodeValue.includes('Un ')) break; const o = n.nodeValue.length; document.getSelection().setBaseAndExtent(n, o, n, o) })()`)
      await page.keyboard.type('!')
      await pause()
      assert.match(await E(`__q('.o').textContent`), /<p>Un !<strong>mot<\/strong><\/p>/, 'la frappe remonte vers la variable, nettoyée')
      assert.ok((await champs())[0].includes('!'), 'le champ suit la frappe')
      assert.equal((await parEdit())[0], 'e:1', 'toujours un seul champ')
      const p = await E(`(() => { const li = __q('.r')._shadow.querySelectorAll('.line')[1].parentNode; li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 12 } })()`)
      await page.mouse.click(p.x, p.y)
      await pause()
      assert.equal(await E(`__q('.c').textContent`), '[0,1,2]')
      assert.deepEqual((await champs()).filter((c) => c.startsWith('reps[]')), ['reps[]=0', 'reps[]=1', 'reps[]=2'])
      await E(`__q('.rz').click()`)
      await pause(500)
      assert.equal(await E(`__q('.c').textContent`), '[0,2]', 'les cases de départ')
      assert.deepEqual(await champs(), ['contrat=' + PROPRE, 'reps[]=0', 'reps[]=2'], 'le texte et les cases de départ, un champ chacun')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })
  })
})
