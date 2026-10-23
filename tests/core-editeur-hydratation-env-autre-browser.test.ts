// Reprise d'une page rendue par le serveur en mode « markers » quand le serveur et le navigateur n'ont pas été construits de la même façon (le serveur
// en développement, `createSSRRenderer` sans `env`, et le navigateur en production qui a retiré des morceaux des modules, ou l'inverse) : la
// numérotation des repères que le serveur écrit n'est plus celle que le navigateur attend. Dans Chromium, Firefox et WebKit réels :
// - un composant dont les repères ne correspondent pas est reconstruit proprement, sans erreur, et un avertissement dit la cause probable
//   (le serveur et le navigateur construits différemment), une seule fois par balise ;
// - l'éditeur (barre restreinte) et la liste (sans « Autre ») marchent ensuite : la frappe remonte vers la variable, la liste s'ouvre ;
// - serveur et navigateur construits de la même façon : aucun avertissement, la reprise garde son gain.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, assembler } from './helpers/editeur-riche.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

type Env = 'dev' | 'prod'

const HOTE = `<script>
  $texte = '<p>Un <b>mot</b></p>'
  $choix = '1'
</script>

<form class="f" @noUJS>
  <@@editor class="e" name="contrat" toolbar="bold italic" value=!{$texte}></@@editor>
  <@@select class="s" name="choix" value=!{$choix}><@@option value="1">Un</@@option><@@option value="2">Deux</@@option></@@select>
</form>
<pre class="o">{$texte}</pre>
<pre class="v">{$choix}</pre>
`

type Construit = { rendus: Record<Env, { html: string; hydrateScript: string }>; prod: Map<string, Buffer>; dev: string }

let construit: Promise<Construit> | null = null

// le rendu serveur « markers » dans chaque environnement, le build de production (morceaux servis par adresse) et le script de développement
// (un seul script), une seule fois pour tous les moteurs
function construire() {
  construit ??= (async () => {
    const root    = mjsTmp('editeur-reprise-env-autre')
    const srcDir  = join(root, 'src')
    const prodDir = join(root, 'out')
    const devDir  = join(root, 'dev')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    const rendus: any = {}
    for (const env of ['dev', 'prod'] as Env[]) {
      const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] }, env } as any)
      rendus[env] = await renderer.renderToString('mjs-hote', { ssrMode: 'markers' } as any)
      await renderer.close()
    }
    const production = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const statsProd  = await production.compile()
    await production.close()
    assert.equal(statsProd.errors.length, 0, statsProd.errors.map((e: any) => e.message).join('\n'))
    const developpement = new Bundler({ sourceDir: srcDir, outputDir: devDir, manifestPath: join(root, 'bundle.js'), runtime: ['hydrate'] } as any)
    const statsDev      = await developpement.compile()
    await developpement.close()
    assert.equal(statsDev.errors.length, 0, statsDev.errors.map((e: any) => e.message).join('\n'))
    const prod = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) prod.set(f, readFileSync(join(prodDir, f)))
    return { rendus, prod, dev: assembler(devDir, join(root, 'bundle.js')) }
  })()
  return construit
}

// serveur de cet environnement, navigateur de celui-là : la reprise tombe sur des repères différents quand ils diffèrent
const COMBINAISONS: { serveur: Env; client: Env; pareil: boolean }[] = [
  { serveur: 'dev',  client: 'prod', pareil: false },
  { serveur: 'prod', client: 'dev',  pareil: false },
  { serveur: 'prod', client: 'prod', pareil: true },
  { serveur: 'dev',  client: 'dev',  pareil: true },
]

for (const nom of MOTEURS) describe(`reprise en mode « markers », serveur et navigateur construits (ou non) de la même façon (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let fait: Construit
  let logs: string[] = []

  const E     = (expr: string): Promise<any> => page.evaluate(expr)
  const pause = (ms = 150) => page.waitForTimeout(ms)

  async function charger(c: { serveur: Env; client: Env }) {
    const { html, hydrateScript } = fait.rendus[c.serveur]
    const corps = c.client === 'prod' ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${fait.dev.replace(/<\/script/gi, '<\\/script')}</script>`
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${html}\n${hydrateScript}\n${corps}</body></html>`
    await page.goto('http://localhost/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const out = []
      const walk = (r) => { r.querySelectorAll('mjs-core-editor, mjs-core-select').forEach((e) => out.push(e)); r.querySelectorAll('*').forEach((e) => { const s = e._shadow || e.shadowRoot; if (s) walk(s) }) }
      walk(document)
      return out.length === 2 && out.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow)
    })()`, null, { timeout: 60000 })
    await pause(800)
  }

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const c of COMBINAISONS) describe(`serveur ${c.serveur}, navigateur ${c.client}`, function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      logs = []
      page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('console', (m: any) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ' : ' + m.text().slice(0, 400)) })
      page.on('pageerror', (e: any) => logs.push('PAGEERROR : ' + String(e).slice(0, 300)))
      await page.route('http://localhost/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const corps = fait.prod.get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
      await charger(c)
    })

    afterEach(async () => {
      if (page) await page.close()
      page = null
    })

    it('aucune erreur, et l\'avertissement dit la cause quand les deux ne sont pas construits pareil', async function () {
      if (!present) { this.skip(); return }
      const erreurs      = logs.filter((l) => !l.startsWith('warning'))
      const avertissemts = logs.filter((l) => l.startsWith('warning'))
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      if (c.pareil) {
        assert.deepEqual(avertissemts, [], 'construits de la même façon : aucun avertissement')
        return
      }
      // en production la table des messages arrive après coup : un message d'avant son arrivée s'écrit d'abord par sa clé, puis en toutes lettres
      const dits = avertissemts.filter((a) => a.includes('construits différemment'))
      assert.ok(dits.length >= 1, 'un avertissement qui dit la cause probable (construits différemment) : ' + JSON.stringify(logs))
      for (const balise of ['mjs-core-editor', 'mjs-core-select']) {
        const n = dits.filter((a) => a.includes('<' + balise + '>')).length
        assert.equal(n, 1, `une seule fois pour <${balise}> : ${JSON.stringify(dits)}`)
      }
    })

    it('l\'éditeur marche après la reprise : la frappe remonte vers la variable', async function () {
      if (!present) { this.skip(); return }
      await E(`(() => {
        const out = []
        const walk = (r) => { r.querySelectorAll('mjs-core-editor').forEach((e) => out.push(e)); r.querySelectorAll('*').forEach((e) => { const s = e._shadow || e.shadowRoot; if (s) walk(s) }) }
        walk(document)
        const sf = out[0]._shadow.querySelector('.surface')
        sf.focus()
        const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
        let n
        while ((n = w.nextNode())) if (n.nodeValue.includes('mot')) break
        document.getSelection().setBaseAndExtent(n, 1, n, 1)
      })()`)
      await page.keyboard.type('XY')
      await pause(300)
      assert.match(await E(`document.querySelector('mjs-hote')._shadow.querySelector('.o').textContent`), /mXYot/, 'la variable de la page porte la frappe')
    })

    it('la liste marche après la reprise : elle s\'ouvre et montre ses deux choix', async function () {
      if (!present) { this.skip(); return }
      await E(`document.querySelector('mjs-hote')._shadow.querySelector('.s')._shadow.querySelector('.select-btn').click()`)
      await pause(300)
      assert.equal(await E(`document.querySelector('mjs-hote')._shadow.querySelector('.s')._shadow.querySelector('.select-btn').getAttribute('aria-expanded')`), 'true')
      assert.equal(await E(`document.querySelector('mjs-hote')._shadow.querySelector('.s')._shadow.querySelectorAll('.select-option').length`), 2)
    })
  })
})
