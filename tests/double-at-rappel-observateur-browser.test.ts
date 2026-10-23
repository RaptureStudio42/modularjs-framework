// le rappel d'un observateur natif reçoit l'observateur pour `this` : `@x` y lit l'observateur (`@disconnect()` l'arrête),
// `@@x` lit le composant (`_mjsThis.x`, référence capturée à l'initialisation, insensible au site d'appel), comme dans
// toute fonction appelée nue
// ResizeObserver et IntersectionObserver dans Chromium, Firefox et WebKit réels (si Playwright les a installés), en
// développement comme en production minifiée : `@@_shadow` et une variable que le <script> pose (`@mesures`, `@regards`)
// se lisent et s'écrivent sans rien lever ; `@disconnect()` arrête l'observateur qui l'appelle, pendant qu'un témoin
// voisin, qui ne se déconnecte pas, est rappelé à chaque changement

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const TAG = 'mjs-guetteurs-doubles'

// `mesurer` et `voir` se déconnectent au deuxième rappel ; `noterTaille` et `noterVue` sont les témoins
const SOURCE = [
  '<script>',
  '$largeur    = 0',
  '$nbMesures  = 0',
  '$visible    = -1',
  '$nbRegards  = 0',
  '$nbTailles  = 0',
  '$nbVues     = 0',
  '@mesures    = 0',
  '@regards    = 0',
  'mesurer = ->',
  '  @@mesures++',
  '  $nbMesures = @@mesures',
  '  $largeur   = @@_shadow.querySelector(\'nav\').clientWidth',
  '  @disconnect() if @@mesures >= 2',
  'voir = ->',
  '  @@regards++',
  '  $nbRegards = @@regards',
  '  $visible   = @@_shadow.querySelector(\'nav\').offsetWidth',
  '  @disconnect() if @@regards >= 2',
  'noterTaille = ->',
  '  $nbTailles++',
  'noterVue = ->',
  '  $nbVues++',
  'µmount ->',
  '  nav = @_shadow.querySelector(\'nav\')',
  '  new ResizeObserver(mesurer).observe(nav)',
  '  new ResizeObserver(noterTaille).observe(nav)',
  '  new IntersectionObserver(voir).observe(nav)',
  '  new IntersectionObserver(noterVue).observe(nav)',
  '</script>',
  '<nav></nav>',
  '<p class="l">{$largeur}</p><p class="m">{$nbMesures}</p><p class="v">{$visible}</p><p class="r">{$nbRegards}</p><p class="t">{$nbTailles}</p><p class="u">{$nbVues}</p>',
  '<style>',
  'nav',
  '  display: block',
  '  width: 120px',
  '  height: 20px',
  '</style>',
  ''
].join('\n')

// le code que la page charge : en développement les fichiers émis mis bout à bout (le runtime en clair), en production le
// fichier unique minifié, que la page charge comme un module
async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('double-at-rappel-observateur-browser-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'guetteurs-doubles.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(env === 'prod' ? { env: 'prod', js: 'bundle' } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  if (env === 'prod') {
    const prod = readFileSync(join(root, 'bundle.js'), 'utf-8')
    assert.equal(prod.includes('_mjsThis'), false, 'le build de production est minifié : la référence au composant porte un nom court')
    return prod
  }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const dev   = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  assert.equal(dev.includes('_mjsThis'), true, 'le build de développement garde la référence au composant en clair')
  return dev
}

describe('@@x dans le rappel d\'un observateur natif (navigateurs réels)', function () {
  this.timeout(180000)
  const code = { dev: '', prod: '' }

  before(async () => {
    code.dev  = await construire('dev')
    code.prod = await construire('prod')
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ['dev', 'prod'] as const) {
    it(`${nom}, build de ${env === 'prod' ? 'production' : 'développement'} : ResizeObserver et IntersectionObserver rappellent le composant par @@x, @disconnect() les arrête`, async function () {
      if (!(await navigateurPresent(nom))) {
        console.log(`  ℹ️  ${nom} non installé, test de @@x dans un observateur sauté. Activer : \`npx playwright install ${nom}\``)
        this.skip()
        return
      }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 600, height: 400 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        await page.route('http://t.test/**', (route: any) => {
          const url = route.request().url()
          if (env === 'prod' && url === 'http://t.test/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: code.prod })
          if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          const script = env === 'prod' ? '<script type="module" src="/bundle.js"></script>' : `<script>${code.dev}</script>`
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><${TAG}></${TAG}>${script}</body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        const lire     = (sel: string) => page.evaluate(([t, s]: string[]) => (document.querySelector(t) as any)._shadow.querySelector(s).textContent, [TAG, sel])
        const attendre = async (sel: string, attendu: string) => {
          try {
            await page.waitForFunction(([t, s, a]: string[]) => (document.querySelector(t) as any)?._shadow?.querySelector(s)?.textContent === a, [TAG, sel, attendu], { timeout: 6000 })
          } catch {
            throw new Error(`« ${sel} » n'a jamais valu « ${attendu} » (il vaut « ${await lire(sel)} ») ; erreurs levées dans la page : ${JSON.stringify(erreurs)}`)
          }
        }
        const style = (prop: string, valeur: string) => page.evaluate(([t, p, v]: string[]) => { ((document.querySelector(t) as any)._shadow.querySelector('nav') as any).style[p] = v }, [TAG, prop, valeur])

        // premier rappel de chacun : @@_shadow lu, @@mesures et @@regards posés par le script
        await attendre('.l', '120')
        await attendre('.m', '1')
        await attendre('.v', '120')
        await attendre('.r', '1')
        await attendre('.t', '1')
        await attendre('.u', '1')

        // ResizeObserver : deuxième rappel, qui se déconnecte ; le témoin voisin, lui, continue
        await style('width', '200px')
        await attendre('.l', '200')
        await attendre('.m', '2')
        await attendre('.t', '2')
        await style('width', '300px')
        await attendre('.t', '3')
        await page.waitForTimeout(150)
        assert.equal(await lire('.l'), '200', 'ResizeObserver : @disconnect() l\'a arrêté, plus aucun rappel')
        assert.equal(await lire('.m'), '2', 'ResizeObserver : @@mesures n\'a pas bougé depuis l\'arrêt')

        // IntersectionObserver : même chose avec la visibilité de la balise
        await style('display', 'none')
        await attendre('.v', '0')
        await attendre('.r', '2')
        await attendre('.u', '2')
        await style('display', 'block')
        await attendre('.u', '3')
        await page.waitForTimeout(150)
        assert.equal(await lire('.v'), '0', 'IntersectionObserver : @disconnect() l\'a arrêté, plus aucun rappel')
        assert.equal(await lire('.r'), '2', 'IntersectionObserver : @@regards n\'a pas bougé depuis l\'arrêt')

        assert.deepEqual(erreurs, [], 'aucune erreur levée dans les rappels')
      } finally {
        await browser.close()
      }
    })
  }
})
