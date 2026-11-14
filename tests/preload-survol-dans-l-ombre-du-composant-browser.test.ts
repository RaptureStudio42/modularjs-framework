// Un lien `:preload="hover"` écrit dans l'ombre d'un composant (ombre fermée : le document ne voit que l'hôte) est préchargé
// quand la souris passe dessus, qu'il soit là au premier rendu ou posé plus tard (branche qui s'ouvre). Vrais navigateurs : la
// souris est menée au milieu du lien, les demandes de préchargement sont relevées sur le réseau.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'p-survol.mjs': '<script>\n$on = false\n@ouvrir = -> $on = true\n</script>\n<a class="tot" href="/app/tot" :preload="hover">x</a>{if $on}<a class="tard" href="/app/tard" :preload="hover">y</a>{end}\n'
}

// milieu d'un lien de l'ombre, lu par la référence que le composant garde de son ombre
const centre = (classe: string): string => `(() => { const r = document.querySelector('mjs-p-survol')._shadow.querySelector('a.${classe}').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`

describe('préchargement au survol : un lien dans l\'ombre d\'un composant', function () {
  this.timeout(120000)
  const fichiers = new Map<string, Buffer>()

  before(async () => {
    const root = mjsTmp('preload-survol-ombre')
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
    it(`${moteur} : le survol précharge le lien du premier rendu et celui d'une branche ouverte plus tard`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const navigateur = await playwright[moteur].launch()
      try {
        const page = await navigateur.newPage()
        const demandes: string[] = []
        await page.route('http://survol.test/**', async (route: any) => {
          const chemin = new URL(route.request().url()).pathname
          if (chemin.startsWith('/app/')) {
            demandes.push(chemin.slice(5))
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><p>page</p></body>' })
          }
          else if (chemin.startsWith('/out/')) {
            const corps = fichiers.get(chemin.slice(5))
            await route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
          }
          else await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><mjs-p-survol></mjs-p-survol><script type="module" src="/out/bundle.js"></script></body>' })
        })
        await page.goto('http://survol.test/page')
        await page.waitForFunction('(() => { const e = document.querySelector("mjs-p-survol"); return !!(e && e._mjs_is_mounted && e._shadow.querySelector("a.tot")) })()', null, { timeout: 30000 })
        await page.waitForTimeout(300)
        assert.equal(demandes.length, 0, `rien avant le survol — demandes : ${demandes.join(' ')}`)

        const [x, y] = await page.evaluate(centre('tot')) as number[]
        await page.mouse.move(x, y)
        await page.waitForTimeout(500)
        assert.deepEqual(demandes, ['tot'], 'le lien du premier rendu est préchargé au survol')

        await page.evaluate('document.querySelector("mjs-p-survol").ouvrir(); 0')
        await page.waitForFunction('!!document.querySelector("mjs-p-survol")._shadow.querySelector("a.tard")', null, { timeout: 10000 })
        const [x2, y2] = await page.evaluate(centre('tard')) as number[]
        await page.mouse.move(x2, y2)
        await page.waitForTimeout(500)
        assert.deepEqual(demandes, ['tot', 'tard'], 'le lien posé plus tard est préchargé au survol')
      }
      finally {
        await navigateur.close()
      }
    })
  }
})
