// Types — dans <vars>, un objet s'écrit en retrait sous sa variable, un champ par ligne, valeurs de départ comprises, au navigateur
// réel : le champ absent prend sa valeur de départ, un texte de nombre est converti, une valeur hors plage ramenée à sa borne, un objet
// imbriqué contrôlé sous son nom. Joué sur le build de développement (fichiers séparés) et sur celui de production en un seul
// fichier, minifié.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, moteurPresent, compilerScript } from './helpers/navigateurs-compiles.js'

const SOURCE = `<vars>
  $user
    name  string 1..40
    age = 18  int 0..
    adr
      city  string
  $texte
    age = 18  int 0..
  $bas
    age = 18  int 0..
</vars>

<script>
  $user  = { name: 'Ana', adr: { city: 'Lyon' } }
  $texte = { age: '42' }
  $bas   = { age: -5 }
</script>

<p id="json">{JSON.stringify($user)}</p>
<p id="ville">{$user.adr.city}</p>
<p id="texte">{$texte.age}</p>
<p id="bas">{$bas.age}</p>
`

// le build de production en un seul fichier, minifié, cœur réduit à ce que l'appli lit
async function compilerProduction(): Promise<string> {
  const root = mjsTmp('vars-en-retrait-prod')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.mjs'), SOURCE)
  const out     = join(root, 'dist')
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/dist', defaultScriptLang: 'js', forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(out, 'bundle.js'), 'utf-8')
}

describe('<vars> : un objet en retrait sous sa variable, au navigateur réel', function () {
  this.timeout(120000)
  const scripts: Record<string, { script: string, module: boolean }> = {}

  before(async () => {
    scripts.developpement = { script: await compilerScript('vars-en-retrait-dev', { 'main.mjs': SOURCE }), module: false }
    scripts.production    = { script: await compilerProduction(), module: true }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of MOTEURS) {
    for (const mode of ['developpement', 'production']) {
      it(`${nom}, ${mode} : valeur de départ, conversion, borne, objet imbriqué`, async function () {
        if (!await moteurPresent(nom)) this.skip()
        const playwright: any = await import('playwright')
        const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        try {
          const page = await browser.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          const { script, module } = scripts[mode]
          const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-main></mjs-main><script${module ? ' type="module" src="/dist/bundle.js">' : '>' + script}</script></body></html>`
          await page.route('http://mjs.test/**', (route: any) => {
            const url = route.request().url()
            if (url.endsWith('/dist/bundle.js')) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: script })
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
          })
          await page.goto('http://mjs.test/')
          const lire = (id: string) => page.evaluate((id: string) => {
            const hote = document.querySelector('mjs-main') as any
            const racine = hote && (hote._shadow || hote.shadowRoot || hote)
            const p = racine && racine.querySelector('#' + id)
            return p ? p.textContent : null
          }, id)
          await page.waitForFunction(() => {
            const hote = document.querySelector('mjs-main') as any
            const racine = hote && (hote._shadow || hote.shadowRoot || hote)
            const p = racine && racine.querySelector('#bas')
            return !!(p && p.textContent)
          }, null, { timeout: 15000 })
          assert.deepEqual(erreurs, [])
          assert.deepEqual(JSON.parse(await lire('json')), { name: 'Ana', age: 18, adr: { city: 'Lyon' } })
          assert.equal(await lire('ville'), 'Lyon')
          assert.equal(await lire('texte'), '42')
          assert.equal(await lire('bas'), '0')
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
