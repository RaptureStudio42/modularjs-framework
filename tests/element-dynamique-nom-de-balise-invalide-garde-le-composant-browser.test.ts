// `<@element $t>` et `<@module $c>` dont le nom vient de l'état (une donnée d'un CMS) : un nom qui n'est pas un nom de balise ('h 3', '1x',
// 'pas un nom') laisse la balise en place, le dit en développement, et le composant continue (il se met à jour, un nom valide passe ensuite).
// Vrai navigateur : happy-dom crée n'importe quel nom, Chromium et Firefox lèvent
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const MOTEURS = ['chromium', 'firefox'] as const
const ENVS    = ['dev', 'prod'] as const
const PAGE    = `<script>
  $t = 'h2'
  $c = 'dyn-a'
  $n = 0
  @balise = (t) -> $t = t
  @module = (c) -> $c = c
  @plus   = -> $n++
</script>
<@element $t class="el">titre</@element>
<@module $c class="mo"></@module>
<p class="n">{$n}</p>
`

// le fichier de la sortie que demande une adresse de la page (le bundle, un morceau)
function fichier(sortie: string, chemin: string): string | null {
  const segs = chemin.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const f = join(sortie, ...segs.slice(i))
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

// le projet construit une fois par environnement
const construits = new Map<string, Promise<string>>()
function construire(env: string): Promise<string> {
  if (!construits.has(env)) construits.set(env, (async () => {
    const dir = join(mjsTmp('dyn-nom-invalide'), env)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'page.mjs'), PAGE)
    writeFileSync(join(dir, 'src', 'dyn-a.mjs'), '<p>module a</p>\n')
    writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/mjs', manifestPath: 'public/mjs/bundle.js', js: 'split' }))
    const found   = findConfig(dir)
    const bundler = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), env } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return dir
  })())
  return construits.get(env)!
}

after(async () => { await terminateSharedWorkerPool() })

for (const nom of MOTEURS) describe(`<@element> et <@module> : un nom de balise invalide venu de l'état — ${nom}`, function () {
  this.timeout(120000)
  let browser: any
  before(async function () {
    const playwright: any = await import('playwright')
    browser = await playwright[nom].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const env of ENVS) it(`${env} : la balise en place reste, le composant continue, un nom valide passe ensuite`, async () => {
    const dir  = await construire(env)
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    const erreurs: string[] = []
    const avis: string[]    = []
    page.on('pageerror', (e: any) => erreurs.push('page : ' + String(e.message).slice(0, 160)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 160))
      if (m.type() === 'warning') avis.push(m.text())
    })
    await page.route('http://page.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-page></mjs-page>\n<script type="module" src="/mjs/bundle.js"></script></body></html>' })
      const f = fichier(join(dir, 'public/mjs'), url.pathname) || fichier(join(dir, 'public'), url.pathname)
      if (!f) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
    })
    try {
      await page.goto('http://page.test/')
      await page.waitForFunction(() => { const e: any = document.querySelector('mjs-page'); return !!(e && e._shadow && e._shadow.querySelector('.n')) }, null, { timeout: 10000 })
      const out: string[] = []
      const etat = `(() => { const o = document.querySelector('mjs-page')._shadow, e = o.querySelector('.el'), m = o.querySelector('.mo'), n = o.querySelector('.n'); return (e ? e.localName : 'sans balise') + ' / ' + (m ? m.localName : 'sans module') + ' / n=' + (n ? n.textContent : 'vue vidée') })()`
      out.push('départ → ' + await page.evaluate(etat))
      for (const [quoi, v] of [['balise', 'h 3'], ['balise', '1x'], ['balise', 'h4'], ['module', 'pas un nom'], ['module', 'dyn-a']]) {
        await page.evaluate(`document.querySelector('mjs-page').${quoi}(${JSON.stringify(v)})`).catch((e: any) => out.push('LÈVE ' + String(e.message).split('\n')[0].slice(0, 120)))
        await page.waitForTimeout(120)
        await page.evaluate(`document.querySelector('mjs-page').plus()`).catch((e: any) => out.push('plus LÈVE ' + String(e.message).split('\n')[0].slice(0, 120)))
        await page.waitForTimeout(120)
        out.push(quoi + ' ' + JSON.stringify(v) + ' → ' + await page.evaluate(etat))
      }
      assert.deepEqual(out, [
        'départ → h2 / mjs-dyn-a / n=0',
        'balise "h 3" → h2 / mjs-dyn-a / n=1',
        'balise "1x" → h2 / mjs-dyn-a / n=2',
        'balise "h4" → h4 / mjs-dyn-a / n=3',
        'module "pas un nom" → h4 / mjs-dyn-a / n=4',
        'module "dyn-a" → h4 / mjs-dyn-a / n=5'
      ], 'erreurs : ' + JSON.stringify(erreurs))
      assert.deepEqual(erreurs, [])
      if (env === 'dev') for (const v of ['h 3', '1x', 'pas un nom']) assert.ok(avis.some((a) => a.includes(v)), 'avertissement pour « ' + v + ' » — vus : ' + JSON.stringify(avis))
    }
    finally {
      await ctx.close()
    }
  })
})
