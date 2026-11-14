// Un lien `:preload="on"` est préchargé dès qu'il paraît au premier rendu de son composant, où qu'il soit écrit : hors de tout
// bloc, dans une ligne de `{for}`, dans une branche de `{if}` ouverte, dans le gabarit d'un composant léger. Posé plus tard (branche
// qui s'ouvre, ligne ajoutée), il n'est pas préchargé à son apparition. Vrais navigateurs : les liens sont cherchés à l'image qui
// suit la construction du composant, une fois son premier rendu fait ; les demandes de préchargement sont relevées sur le réseau.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const sc   = (script: string, gabarit: string): string => `<script>\n${script}\n</script>\n${gabarit}\n`
const lien = (chemin: string): string => `<a class="lien" href="/app/${chemin}" :preload="on">x</a>`
const SOURCES: Record<string, string> = {
  'c-leger.mjs':   sc("$titre = ''", lien('leger') + '<p>{$titre}</p>'),
  'c-ombre.mjs':   sc("$titre = ''", lien('ombre') + '<p>{$titre}</p>'),
  'p-leger.mjs':   sc("$t = 't'", '<@c-leger :lightDom titre={$t}></@c-leger>'),
  'p-ombre.mjs':   sc("$t = 't'", '<@c-ombre titre={$t}></@c-ombre>'),
  'p-si.mjs':      sc('$on = true', '{if $on}' + lien('si') + '{end}<p>t</p>'),
  'p-si-tard.mjs': sc('$on = false\n@ouvrir = -> $on = true', '{if $on}' + lien('si-tard') + '{end}<p>t</p>'),
  'p-pour.mjs':    sc('$rows = [{ id: 1 }]\n@plus = -> $rows = [...$rows, { id: 2 }]', '{for r in $rows by id}<a class="lien" href="/app/pour{r.id}" :preload="on">x</a>{end}<p>t</p>'),
  'p-direct.mjs':  lien('direct') + '\n'
}
const PARENTS = ['p-leger', 'p-ombre', 'p-si', 'p-si-tard', 'p-pour', 'p-direct']

describe('préchargement `:preload="on"` : les liens du premier rendu, où qu\'ils soient écrits', function () {
  this.timeout(120000)
  const fichiers = new Map<string, Buffer>()

  before(async () => {
    const root = mjsTmp('preload-premier-rendu')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    for (const [nom, code] of Object.entries(SOURCES)) writeFileSync(join(src, nom), code)
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : ligne de {for}, branche de {if}, composant léger préchargés au premier rendu ; rien pour un lien posé plus tard`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const navigateur = await playwright[moteur].launch()
      try {
        const page = await navigateur.newPage()
        const demandes: string[] = []
        await page.route('http://precharge.test/**', async (route: any) => {
          const chemin = new URL(route.request().url()).pathname
          if (chemin.startsWith('/app/')) {
            demandes.push(chemin.slice(5))
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><p>page</p></body>' })
          }
          else if (chemin.startsWith('/out/')) {
            const corps = fichiers.get(chemin.slice(5))
            await route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
          }
          else await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body>${PARENTS.map((p) => `<mjs-${p}></mjs-${p}>`).join('')}<script type="module" src="/out/bundle.js"></script></body>` })
        })
        await page.goto('http://precharge.test/page')
        await page.waitForFunction(`(() => { const tous = ${JSON.stringify(PARENTS)}.map((p) => document.querySelector('mjs-' + p)); return tous.every((e) => e && e._shadow && e._mjs_is_mounted) && !!tous[0]._shadow.querySelector('mjs-c-leger a.lien') && !!tous[1]._shadow.querySelector('mjs-c-ombre') })()`, null, { timeout: 30000 })
        await page.waitForTimeout(700)
        for (const attendu of ['direct', 'ombre', 'pour1', 'si', 'leger']) assert.ok(demandes.includes(attendu), `« /app/${attendu} » préchargé au premier rendu — demandes : ${demandes.join(' ')}`)
        assert.ok(!demandes.includes('si-tard') && !demandes.includes('pour2'), `rien pour un lien qui n'est pas dans la page — demandes : ${demandes.join(' ')}`)

        // branche qui s'ouvre, ligne ajoutée : le lien posé après le premier rendu n'est pas cherché
        await page.evaluate('document.querySelector("mjs-p-si-tard").ouvrir(); document.querySelector("mjs-p-pour").plus(); 0')
        await page.waitForFunction('!!document.querySelector("mjs-p-si-tard")._shadow.querySelector("a.lien") && document.querySelector("mjs-p-pour")._shadow.querySelectorAll("a.lien").length === 2', null, { timeout: 10000 })
        await page.waitForTimeout(500)
        assert.ok(!demandes.includes('si-tard') && !demandes.includes('pour2'), `un lien posé plus tard n'est pas préchargé à son apparition — demandes : ${demandes.join(' ')}`)
        assert.equal(demandes.length, 5, `chaque lien du premier rendu demandé une seule fois — demandes : ${demandes.join(' ')}`)
      }
      finally {
        await navigateur.close()
      }
    })
  }
})
