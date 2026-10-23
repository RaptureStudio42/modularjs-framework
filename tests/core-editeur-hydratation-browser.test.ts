// Éditeur de texte riche du cœur (<@@editor>) dans une page RENDUE PAR LE SERVEUR puis hydratée, dans Chromium, Firefox et WebKit réels, pour
// chacun des quatre modes de reprise (`ssrMode` : markers, replace, positional, diff). Le code des modules arrive avant celui de la page.
// - la reprise ne défait rien : la surface garde le HTML nettoyé que le serveur a écrit, la variable de la page n'est pas réécrite tant que
//   rien n'a été modifié, aucune erreur dans la page ;
// - chaque éditeur porte UN seul champ par valeur : le champ du serveur est repris, jamais doublé ni retiré (le HTML propre, ou un champ par
//   case cochée en mode « répondre ») ;
// - après la reprise l'éditeur marche : la frappe remonte vers la variable et vers le champ, une case cochée au clic met `checked` et
//   les champs à jour, `form.reset()` rend l'état de départ.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const MODES = ['markers', 'replace', 'positional', 'diff'] as const

const TEXTE = '<h2>Titre</h2><p>Un <b>mot</b></p><ul data-checklist><li data-checked>fait</li><li>à faire</li></ul>'
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

let construit: Promise<{ rendus: Record<string, { html: string; hydrateScript: string }>; bundle: string }> | null = null

// le rendu serveur dans chaque mode et le script concaténé (le cœur, puis les modules, puis la page), une seule fois pour tous les moteurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('editeur-hydratation')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendus: Record<string, { html: string; hydrateScript: string }> = {}
    for (const mode of MODES) {
      const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: mode } as any)
      rendus[mode] = { html, hydrateScript }
    }
    await renderer.close()
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    return { rendus, bundle: stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres }
  })()
  return construit
}

for (const nom of MOTEURS) describe(`éditeur riche : page rendue par le serveur puis hydratée (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let rendus: Record<string, { html: string; hydrateScript: string }> = {}
  let bundle  = ''
  const erreurs: string[] = []

  const E       = (expr: string): Promise<any> => page.evaluate(expr)
  const pause   = (ms = 150) => page.waitForTimeout(ms)
  const champs  = (): Promise<string[]> => E(`Array.from(new FormData(__q('.f'))).map((p) => p[0] + '=' + p[1])`)
  const parEdit = (): Promise<string[]> => E(`Array.from(__q('.f').querySelectorAll('mjs-core-editor')).map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`)

  // la page rendue par le serveur dans ce mode, le script chargé après elle, puis l'attente du montage des deux éditeurs
  async function charger(mode: string) {
    const pre = `<script>(function () { var h = document.querySelector('mjs-hote-ssr').shadowRoot; h.querySelectorAll('form').forEach(function (f) { f.__srv = true }) })()</script>`
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendus[mode].html}\n${pre}\n${rendus[mode].hydrateScript}\n<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
    await page.goto('http://localhost/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote-ssr')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-editor')) : []
      return m.length === 2 && m.every((x) => x._mjs_is_mounted && x._shadow && x._shadow.querySelector('.surface'))
    })()`, { timeout: 30000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote-ssr')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  }

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const fait = await construire()
    rendus  = fait.rendus
    bundle  = fait.bundle
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    page.on('console', (m: any) => { if (['error', 'warning'].includes(m.type())) erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.route('http://localhost/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/envoi') {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) describe(`hydratation « ${mode} »`, function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      erreurs.length = 0
      await charger(mode)
    })

    it('la reprise ne défait rien : surface, champs, variable de la page, console', async function () {
      if (!present) { this.skip(); return }
      assert.equal(await E(`document.querySelector('mjs-hote-ssr')._mjs_hydrated === true`), mode !== 'replace', 'le mode demandé est celui qui a joué')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      assert.equal(await E(`__q('.e')._shadow.querySelector('.surface').innerHTML.replace(/ aria-description="[^"]*"/g, '').replace(/=""/g, '')`), PROPRE, 'la surface porte le HTML propre')
      assert.equal(await E(`__q('.o').textContent`), TEXTE, 'la variable de la page n\'est pas réécrite tant que rien n\'a été modifié')
      assert.deepEqual(await parEdit(), ['e:1', 'r:2'], 'un champ pour le texte, un par case cochée, jamais doublés')
      assert.deepEqual(await champs(), ['contrat=' + PROPRE, 'reps[]=0', 'reps[]=2'])
      assert.equal(await E(`Array.from(__q('.r')._shadow.querySelectorAll('.line')).map((l) => l.getAttribute('aria-checked')).join()`), 'true,false,true', 'les cases cochées par le serveur le restent')
      if (mode !== 'replace') assert.equal(await E(`__q('.f').__srv === true`), true, 'les nœuds de la page sont repris, pas refaits')
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
