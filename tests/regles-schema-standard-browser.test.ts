// La rune `µrules(@)` dans un composant compilé, au navigateur réel : chaque règle du bloc <vars> expose `~standard`, ses refus
// parlent la langue de la page (`<html lang>`), la valeur rendue est convertie, celle du champ jamais touchée ; un FormData du
// navigateur se contrôle comme un objet. Joué sur le build de développement (fichiers séparés) et sur celui de production en un
// seul fichier, minifié (les noms internes du cœur y sont raccourcis).
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, moteurPresent, compilerScript } from './helpers/navigateurs-compiles.js'

const SOURCE = `<vars>
  $age   int 18..120
  $nick  string 3..20 ! 'admin' | 'root'
</vars>

<script>
  $age  = 30
  $nick = 'ann'
  const rs = µrules(this)
  $schema = rs.age['~standard'].version + ' ' + rs.age['~standard'].vendor
  $refus  = JSON.stringify(rs['~standard'].validate({ age: '150', nick: 'root' }).issues)
  $bon    = JSON.stringify(rs['~standard'].validate({ age: '42', nick: 'bob' }).value)
  const fd = new FormData()
  fd.append('age', '42')
  fd.append('nick', 'bob')
  $form   = JSON.stringify(rs['~standard'].validate(fd).value)
</script>

<p id="schema">{$schema}</p>
<p id="refus">{$refus}</p>
<p id="bon">{$bon}</p>
<p id="form">{$form}</p>
`

// le build de production en un seul fichier, minifié, cœur réduit à ce que l'appli lit (les réglages de l'appli du banc)
async function compilerProduction(): Promise<string> {
  const root = mjsTmp('regles-std-prod')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.mjs'), SOURCE)
  const out     = join(root, 'dist')
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/dist', defaultScriptLang: 'js', forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(out, 'bundle.js'), 'utf-8')
}

const ATTENDU_FR = [{ message: 'Saisissez un nombre entier de 18 à 120', path: ['age'] }, { message: 'Cette valeur n\'est pas permise', path: ['nick'] }]
const ATTENDU_EN = [{ message: 'Enter a whole number from 18 to 120', path: ['age'] }, { message: 'This value is not allowed', path: ['nick'] }]

describe('µrules(@) au navigateur réel — schémas standard des règles du composant', function () {
  this.timeout(120000)
  const scripts: Record<string, { script: string, module: boolean }> = {}

  before(async () => {
    scripts.developpement = { script: await compilerScript('regles-std-dev', { 'main.mjs': SOURCE }), module: false }
    scripts.production    = { script: await compilerProduction(), module: true }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of MOTEURS) {
    for (const mode of ['developpement', 'production']) {
      for (const lang of ['fr', 'en']) {
        it(`${nom}, ${mode}, page en ${lang}`, async function () {
          if (!await moteurPresent(nom)) this.skip()
          const playwright: any = await import('playwright')
          const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          try {
            const page = await browser.newPage()
            const erreurs: string[] = []
            page.on('pageerror', (e: any) => erreurs.push(String(e)))
            const { script, module } = scripts[mode]
            const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><mjs-main></mjs-main><script${module ? ' type="module" src="/dist/bundle.js">' : '>' + script}</script></body></html>`
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
              const p = racine && racine.querySelector('#bon')
              return !!(p && p.textContent)
            }, null, { timeout: 15000 })
            assert.deepEqual(erreurs, [])
            assert.equal(await lire('schema'), '1 mjs')
            assert.deepEqual(JSON.parse(await lire('refus')), lang === 'en' ? ATTENDU_EN : ATTENDU_FR)
            assert.deepEqual(JSON.parse(await lire('bon')), { age: 42, nick: 'bob' })
            assert.equal(await lire('form'), '{"age":42,"nick":"bob"}')
          }
          finally {
            await browser.close()
          }
        })
      }
    }
  }
})
