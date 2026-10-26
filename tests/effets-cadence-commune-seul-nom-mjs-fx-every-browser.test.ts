// la cadence commune des effets qui se répètent s'écrit `$$mjs-fx-every` (la propriété CSS `--mjs-mjs-fx-every`), dans les trois navigateurs
// réels, en production et en développement : posée dans un `<theme>` ou un `<style>`, elle règle *shine, *glitch, *attention et *annotate. La
// variable est neuve de la 3.0.0 : l'ancien nom `$$fx-every` (la propriété `--mjs-fx-every`) n'agit plus, sans alias ni avis — chaque effet
// garde son défaut. Une valeur refusée de `$$mjs-fx-every` donne, en développement, un avis qui la nomme, en français comme en anglais.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// les quatre effets qui se répètent, sans `every` écrit : la cadence vient de la variable, sinon du défaut (3 s, 5 s pour *glitch)
const EFFETS = '<button class="s" *shine(on: always)>S</button>\n<h1 class="g" *glitch(burst: 50ms)>G</h1>\n<button class="a" *attention(on: always, duration: 100ms)>A</button>\n<span class="n" *annotate(on: always, duration: 100ms)>N</span>\n'
const HOTE   = '<style>\n:host\n  display: block\n</style>\n'
const THEME  = (ligne: string) => `<theme>\n  ${ligne}\n</theme>\n`
// posée dans un <style>, pour la descendance
const STYLE  = (ligne: string) => `<style>\n:host\n  display: block\n  ${ligne}\n</style>\n`

const COMPOSANTS: Record<string, string> = {
  // le nom de la variable : 300 ms pour les quatre
  'cn-theme': THEME('$$mjs-fx-every: 300ms') + EFFETS + HOTE,
  'cn-style': EFFETS + STYLE('$$mjs-fx-every: 300ms'),
  // la propriété écrite telle quelle, comme une appli qui change varPrefix
  'cn-propriete': EFFETS + STYLE('--mjs-mjs-fx-every: 300ms'),
  // l'ancien nom, et l'ancienne propriété : sans effet
  'cn-ancien-theme': THEME('$$fx-every: 300ms') + EFFETS + HOTE,
  'cn-ancien-style': EFFETS + STYLE('$$fx-every: 300ms'),
  'cn-ancienne-propriete': EFFETS + STYLE('--mjs-fx-every: 300ms'),
  // une valeur refusée : sous le nom de la variable, un avis en développement ; sous l'ancien nom, rien
  'cn-refus': THEME('$$mjs-fx-every: abc') + EFFETS + HOTE,
  'cn-ancien-refus': THEME('$$fx-every: xyz') + EFFETS + HOTE
}
const NOMS    = Object.keys(COMPOSANTS)
const REGLES  = ['cn-theme', 'cn-style', 'cn-propriete']
const ANCIENS = ['cn-ancien-theme', 'cn-ancien-style', 'cn-ancienne-propriete', 'cn-ancien-refus']

// ce qui marque un passage : l'attribut qui apparaît sur la balise
const MARQUES: Record<string, string> = { s: 'mjs-fx-play', a: 'mjs-fx-play', n: 'mjs-fx-play', g: 'mjs-fx-glitch-burst' }

// le code de la page : production (le fichier unique minifié), ou développement (les avis du développement compris)
async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('cadence-seul-nom-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
  const manifeste = join(outDir, 'bundle.js')
  const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', ...(env === 'prod' ? { env: 'prod' } : {}) } as any)
  const stats     = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  return stripEsm(readFileSync(manifeste, 'utf-8'))
}

describe('effets — la cadence commune s\'écrit $$mjs-fx-every : les messages', () => {
  it('l\'avis d\'une valeur refusée nomme $$mjs-fx-every, en français comme en anglais, jamais l\'ancien $$fx-every', () => {
    for (const lang of ['fr', 'en'] as const) {
      const texte = (RUNTIME_LABELS[lang].err as Record<string, string>).fxEveryRefused
      assert.ok(texte.includes('$$mjs-fx-every'), `${lang} : ${texte}`)
      assert.equal(texte.includes('$$fx-every'), false, `${lang} : ${texte}`)
    }
  })
})

describe('effets — la cadence commune s\'écrit $$mjs-fx-every, l\'ancien $$fx-every n\'agit plus (navigateurs réels, production et développement)', function () {
  this.timeout(300000)
  const code = { dev: '', prod: '' }

  before(async () => {
    code.prod = await construire('prod')
    code.dev  = await construire('dev')
  })

  after(async () => { await terminateSharedWorkerPool() })

  // une page : les composants, les passages vus depuis le départ du suivi ([qui, quand]), les avis de la console
  async function ouvrir(browser: any, script: string, lang = '') {
    const page    = await (await browser.newContext({ viewport: { width: 400, height: 2400 } })).newPage()
    const erreurs: string[] = []
    const avis: string[]    = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push(m.text())
      if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
    })
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head><meta charset="utf-8"></head><body>${NOMS.map((n) => `<mjs-${n} id="${n}"></mjs-${n}>`).join('')}<script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(`${JSON.stringify(NOMS)}.every((n) => ['s', 'g', 'a', 'n'].every((c) => document.querySelector('#' + n)?._shadow?.querySelector('.' + c)?.hasAttribute('mjs-fx')))`, null, { timeout: 60000, polling: 20 })
    await page.evaluate(`(() => {
      window.__vus = []
      const marques = ${JSON.stringify(MARQUES)}
      for (const n of ${JSON.stringify(NOMS)}) {
        const hote = document.querySelector('#' + n)
        for (const [classe, attr] of Object.entries(marques)) {
          const e = hote._shadow.querySelector('.' + classe)
          new MutationObserver((l) => {
            for (const m of l) if (m.oldValue === null && e.hasAttribute(attr)) window.__vus.push(n + '.' + classe)
          }).observe(e, { attributes: true, attributeFilter: [attr], attributeOldValue: true })
        }
      }
    })()`)
    return { page, erreurs, avis }
  }

  // sur 1,6 s : au moins trois passages de chacun au tour de 300 ms (400 ms pour *attention et *annotate, l'appel de 100 ms et la pause) ;
  // au plus un au défaut (3 s ; 5 s pour *glitch, dont la première salve part 2 s après la pose)
  async function passages(page: any): Promise<Record<string, number>> {
    await page.waitForTimeout(1600)
    const vus: string[] = await page.evaluate('window.__vus')
    const n: Record<string, number> = {}
    for (const h of NOMS) for (const c of ['s', 'g', 'a', 'n']) n[h + '.' + c] = vus.filter((v) => v === h + '.' + c).length
    return n
  }
  function verifier(n: Record<string, number>) {
    for (const h of REGLES) for (const c of ['s', 'g', 'a', 'n']) assert.ok(n[h + '.' + c] >= 3, `${h}.${c} : $$mjs-fx-every règle la cadence, au moins trois passages en 1,6 s attendus, vus ${n[h + '.' + c]}`)
    for (const h of ANCIENS) for (const c of ['s', 'g', 'a', 'n']) assert.ok(n[h + '.' + c] <= 1, `${h}.${c} : l'ancien nom n'agit plus, le défaut reste (un passage au plus en 1,6 s), vus ${n[h + '.' + c]}`)
  }

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(nom, function () {
    let browser: any = null

    before(async function () {
      if (!(await navigateurPresent(nom))) {
        console.log(`  ℹ️  ${nom} non installé, test de la cadence commune sauté. Activer : \`npx playwright install ${nom}\``)
        return this.skip()
      }
      browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    })

    after(async () => { await browser?.close() })

    it('production : $$mjs-fx-every règle les quatre effets (dans un <theme>, un <style>, ou --mjs-mjs-fx-every écrit tel quel) ; $$fx-every et --mjs-fx-every n\'agissent plus', async () => {
      const p = await ouvrir(browser, code.prod)
      try {
        verifier(await passages(p.page))
        assert.deepEqual(p.erreurs, [])
      }
      finally {
        await p.page.context().close()
      }
    })

    it('développement : la même cadence ; une valeur refusée de $$mjs-fx-every donne un avis qui la nomme, l\'ancien nom aucun', async () => {
      const p = await ouvrir(browser, code.dev)
      try {
        verifier(await passages(p.page))
        const sur = p.avis.filter((a) => a.includes('fx-every'))
        assert.equal(sur.length, 1, `un seul avis, aucun pour l'ancien nom : ${JSON.stringify(sur)}`)
        assert.ok(sur[0].startsWith('[ModularJS] la variable de thème $$mjs-fx-every vaut \'abc\', une valeur refusée'), sur[0])
        assert.equal(p.avis.some((a) => a.includes('xyz')), false, `l'ancien nom n'est pas lu, sa valeur refusée ne dit rien : ${JSON.stringify(p.avis)}`)
        assert.deepEqual(p.erreurs, [])
      }
      finally {
        await p.page.context().close()
      }
    })

    it('développement, page en anglais : l\'avis nomme $$mjs-fx-every', async () => {
      const p = await ouvrir(browser, code.dev, 'en')
      try {
        await p.page.waitForTimeout(400)
        const sur = p.avis.filter((a) => a.includes('fx-every'))
        assert.equal(sur.length, 1, JSON.stringify(sur))
        assert.ok(sur[0].startsWith('[ModularJS] the theme variable $$mjs-fx-every is \'abc\', a refused value'), sur[0])
        assert.deepEqual(p.erreurs, [])
      }
      finally {
        await p.page.context().close()
      }
    })
  })
})
