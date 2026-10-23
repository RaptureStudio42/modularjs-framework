// la cadence commune des effets qui se répètent (`$$fx-every`), dans les trois navigateurs réels : la variable passe la règle de `every` écrit
// sur la balise (une durée : 300ms, 1.5s, 0) — une valeur qu'elle refuse (-1s, 2 sans unité, abc) est ignorée, chaque effet garde son défaut, et la
// console du développement le dit une fois par valeur ; `0` vaut `every: 0` écrit sur la balise. La cadence est relue à chaque passage, au moment
// de programmer le suivant : un thème qui change en cours de route vaut à partir de là (le passage déjà programmé garde son heure). Le premier
// passage part tout de suite (on: always à la pose, on: view à l'arrivée à l'écran) ; la première salve de *glitch, comme avant l'horloge
// commune, 2 s après (un tour, s'il est plus court) ; les suivants se calent sur l'horloge commune, un tour entier au moins après le premier.
// Retiré de la page, l'effet arrête son horloge.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLE  = '<style>\n:host\n  display: block\n</style>\n'
// les quatre effets qui se répètent ; `every` : écrit sur chacun
const EFFETS = (every = '') => `<button class="s" *shine(on: always${every})>S</button>\n<h1 class="g" *glitch(burst: 50ms${every})>G</h1>\n<button class="a" *attention(on: always, duration: 100ms${every})>A</button>\n<span class="n" *annotate(on: always, duration: 100ms${every})>N</span>\n`
const THEME  = (v: string) => `<theme>\n  $$fx-every: ${v}\n</theme>\n`

const COMPOSANTS: Record<string, string> = {
  // des valeurs que la règle de `every` refuse : chaque effet garde son défaut
  'cv-neg': THEME('-1s') + EFFETS() + STYLE,
  'cv-nu': THEME('2') + EFFETS() + STYLE,
  'cv-abc': THEME('abc') + EFFETS() + STYLE,
  // `0` : comme `every: 0` écrit sur la balise
  'cv-zero': THEME('0') + EFFETS() + STYLE,
  'cv-zero-ecrit': EFFETS(', every: 0') + STYLE,
  // un thème qui change en cours de route : 1 s, puis 200 ms
  'cv-bascule': THEME('1s') + '<theme name="vite">\n  $$fx-every: 200ms\n</theme>\n' + EFFETS() + STYLE,
  // retiré de la page : plus aucun passage
  'cv-retrait': EFFETS(', every: 300ms') + STYLE,
  // posé plus tard, au début d'un tour de 500 ms : le premier passage tout de suite, les suivants sur l'horloge
  'cv-premier': '<button class="s" *shine(on: always, every: 500ms)>S</button>\n<button class="v" *shine(on: view, every: 500ms)>V</button>\n<button class="a" *attention(on: always, duration: 100ms, every: 400ms)>A</button>\n<button class="av" *attention(on: view, duration: 100ms, every: 400ms)>A</button>\n<span class="n" *annotate(on: always, duration: 100ms, every: 400ms)>N</span>\n' + STYLE,
  // posés plus tard, au début d'un tour de 2,6 s : la première salve 2 s après la pose (ou l'arrivée à l'écran), les suivantes sur l'horloge ;
  // retiré avant sa première salve, plus rien
  'cv-glitch': '<h1 class="g" *glitch(every: 2600ms, burst: 50ms)>G</h1>\n<h1 class="gv" *glitch(on: view, every: 2600ms, burst: 50ms)>G</h1>\n' + STYLE,
  'cv-glitch-tot': '<h1 class="g" *glitch(every: 2600ms, burst: 50ms)>G</h1>\n' + STYLE
}
// les composants de la page dès le départ (cv-premier, cv-glitch et cv-glitch-tot sont posés plus tard)
const DEPART = Object.keys(COMPOSANTS).filter((n) => !['cv-premier', 'cv-glitch', 'cv-glitch-tot'].includes(n))

// ce qui marque un passage : l'attribut qui apparaît sur la balise
const MARQUES: Record<string, string> = { s: 'mjs-fx-play', v: 'mjs-fx-play', a: 'mjs-fx-play', av: 'mjs-fx-play', n: 'mjs-fx-play', g: 'mjs-fx-glitch-burst', gv: 'mjs-fx-glitch-burst' }

// le code de la page : production (le fichier unique minifié), ou développement (même fichier, les avis du développement compris)
async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('cadence-valeur-relue-' + env)
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

describe('effets — la cadence commune : la valeur de $$fx-every passe la règle de every, relue à chaque passage, arrêtée au retrait (navigateurs réels)', function () {
  this.timeout(300000)
  const code = { dev: '', prod: '' }

  before(async () => {
    code.prod = await construire('prod')
    code.dev  = await construire('dev')
  })

  after(async () => { await terminateSharedWorkerPool() })

  // une page : les composants du départ, les passages vus ([qui, quand], l'horloge de la page), les avis de la console
  async function ouvrir(browser: any, script: string) {
    const page    = await (await browser.newContext({ viewport: { width: 400, height: 3000 } })).newPage()
    const erreurs: string[] = []
    const avis: string[]    = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push(m.text())
      if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
    })
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${DEPART.map((n) => `<mjs-${n} id="${n}"></mjs-${n}>`).join('')}<script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(`${JSON.stringify(DEPART)}.every((n) => ['s', 'g', 'a', 'n'].every((c) => document.querySelector('#' + n)?._shadow?.querySelector('.' + c)?.hasAttribute('mjs-fx')))`, null, { timeout: 60000, polling: 20 })
    await page.evaluate(`(() => {
      window.__vus = []
      window.__suivre = (hote, cle) => {
        const marques = ${JSON.stringify(MARQUES)}
        for (const [classe, attr] of Object.entries(marques)) {
          const e = hote._shadow && hote._shadow.querySelector('.' + classe)
          if (!e) continue
          if (e.hasAttribute(attr)) window.__vus.push([cle + '.' + classe, performance.now()])
          new MutationObserver((l) => {
            const t = performance.now()
            for (const m of l) if (m.oldValue === null && e.hasAttribute(attr)) window.__vus.push([cle + '.' + classe, t])
          }).observe(e, { attributes: true, attributeFilter: [attr], attributeOldValue: true })
        }
      }
      for (const n of ${JSON.stringify(DEPART)}) window.__suivre(document.querySelector('#' + n), n)
    })()`)
    return { page, erreurs, avis }
  }

  const instants = (vus: [string, number][], cle: string) => vus.filter(([c]) => c === cle).map(([, t]) => t)
  const compte   = (vus: [string, number][], cle: string, t0: number, t1: number) => instants(vus, cle).filter((t) => t >= t0 && t < t1).length
  const ecart    = (t: number, tour: number) => Math.min(t % tour, tour - (t % tour))
  const allume   = (page: any, hote: string, classe: string) => page.evaluate(`document.querySelector('#${hote}')._shadow.querySelector('.${classe}').hasAttribute('mjs-fx-glitch-burst')`)
  // allumé sans fin : allumé à deux instants plus éloignés qu'une salve (50 ms)
  const sansFin  = async (page: any, hote: string, classe: string) => {
    if (!(await allume(page, hote, classe))) return false
    await page.waitForTimeout(150)
    return allume(page, hote, classe)
  }

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(nom, function () {
    let browser: any = null
    let page: any    = null
    let erreurs: string[] = []

    before(async function () {
      if (!(await navigateurPresent(nom))) {
        console.log(`  ℹ️  ${nom} non installé, test de la cadence commune sauté. Activer : \`npx playwright install ${nom}\``)
        return this.skip()
      }
      browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const ouverte = await ouvrir(browser, code.prod)
      page    = ouverte.page
      erreurs = ouverte.erreurs
    })

    after(async () => { await browser?.close() })

    it('une valeur que la règle de every refuse (-1s, 2 sans unité, abc) est ignorée : chaque effet garde son défaut', async () => {
      await page.waitForTimeout(1500)
      const t1: number = await page.evaluate('performance.now()')
      const vus: [string, number][] = await page.evaluate('window.__vus')
      for (const hote of ['cv-neg', 'cv-nu', 'cv-abc']) {
        // 3 s pour *shine, *attention et *annotate (le premier passage, puis un tour entier au moins) ; 5 s pour *glitch
        for (const c of ['s', 'a', 'n']) assert.ok(compte(vus, hote + '.' + c, 0, t1) <= 1, `${hote}.${c} : un passage au plus depuis la pose (défaut de 3 s), vus ${compte(vus, hote + '.' + c, 0, t1)}`)
        assert.ok(compte(vus, hote + '.g', 0, t1) <= 1, `${hote}.g : une salve au plus (défaut de 5 s), vues ${compte(vus, hote + '.g', 0, t1)}`)
        assert.equal(await sansFin(page, hote, 'g'), false, `${hote}.g : *glitch n'est pas allumé sans fin`)
      }
      assert.deepEqual(erreurs, [])
    })

    it('`0` vaut every: 0 écrit sur la balise', async () => {
      const vus: [string, number][] = await page.evaluate('window.__vus')
      const t1: number = await page.evaluate('performance.now()')
      for (const hote of ['cv-zero', 'cv-zero-ecrit']) assert.equal(await allume(page, hote, 'g'), true, `${hote}.g : every 0, *glitch sans arrêt`)
      for (const c of ['s', 'a', 'n']) {
        const v = compte(vus, 'cv-zero.' + c, 0, t1)
        const e = compte(vus, 'cv-zero-ecrit.' + c, 0, t1)
        assert.ok(v >= 5 && Math.abs(v - e) <= 3, `cv-zero.${c} : le rythme de every: 0 écrit (tour de 100 ms), vus ${v} par la variable, ${e} écrits`)
      }
    })

    it('la cadence est relue à chaque passage, au moment de programmer le suivant : un thème qui change en cours de route vaut à partir de là', async () => {
      const tb: number = await page.evaluate(`(() => { document.querySelector('#cv-bascule').setAttribute('theme', 'vite'); return performance.now() })()`)
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#cv-bascule')._shadow.querySelector('.s')).getPropertyValue('--mjs-fx-every').trim()`), '200ms', 'témoin : le thème « vite » pose 200 ms')
      await page.waitForTimeout(2400)
      const vus: [string, number][] = await page.evaluate('window.__vus')
      // le passage déjà programmé (tour de 1 s) tombe dans la première seconde ; ensuite, 200 ms (le tour de *attention et *annotate : l'appel
      // de 100 ms et la pause)
      const attendus: Record<string, number> = { s: 4, g: 4, a: 3, n: 3 }
      for (const [c, min] of Object.entries(attendus)) {
        const n = compte(vus, 'cv-bascule.' + c, tb + 1100, tb + 2300)
        assert.ok(n >= min, `cv-bascule.${c} : au moins ${min} passages en 1,2 s à la nouvelle cadence, vus ${n}`)
      }
      assert.deepEqual(erreurs, [])
    })

    it('le premier passage part tout de suite (on: always à la pose, on: view à l\'arrivée à l\'écran), les suivants se calent sur l\'horloge commune', async () => {
      // posé au début d'un tour de 500 ms : calé sur l'horloge, le premier passage attendrait presque un tour
      const pose: number = await page.evaluate(`new Promise((ok) => { const go = () => { const r = performance.now() % 500; if (r > 20 && r < 60) { const p = document.createElement('mjs-cv-premier'); p.id = 'cv-premier'; document.body.prepend(p); const t = performance.now(); const voir = () => { if (p._shadow && p._shadow.querySelector('.n')) { window.__suivre(p, 'cv-premier'); ok(t) } else requestAnimationFrame(voir) }; voir() } else setTimeout(go, 2) }; go() })`)
      await page.waitForTimeout(1800)
      const vus: [string, number][] = await page.evaluate('window.__vus')
      for (const c of ['s', 'v', 'a', 'av', 'n']) {
        const ts = instants(vus, 'cv-premier.' + c)
        assert.ok(ts.length >= 3, `cv-premier.${c} : au moins trois passages, vus ${ts.length}`)
        assert.ok(ts[0] - pose < 250, `cv-premier.${c} : le premier passage tout de suite, vu ${Math.round(ts[0] - pose)} ms après la pose`)
        assert.ok(ts[1] - ts[0] >= 450, `cv-premier.${c} : le deuxième un tour entier au moins après le premier, vu ${Math.round(ts[1] - ts[0])} ms après`)
        const loin = ts.slice(1).map((t) => Math.round(ecart(t, 500))).filter((d) => d > 60)
        assert.deepEqual(loin, [], `cv-premier.${c} : les passages suivants tombent sur un multiple de 500 ms compté depuis le début de la page (écarts : ${ts.slice(1).map((t) => Math.round(t % 500)).join(', ')})`)
      }
      assert.deepEqual(erreurs, [])
    })

    it('la première salve de *glitch part comme avant l\'horloge commune (min(2 s, every) après la pose, ou l\'arrivée à l\'écran), les suivantes se calent sur l\'horloge, un tour entier au moins après elle', async () => {
      // posés au début d'un tour de 2,6 s : calée sur l'horloge, la première salve attendrait presque un tour ; le second, retiré au bout de 300 ms
      const pose: number = await page.evaluate(`new Promise((ok) => { const go = () => { const r = performance.now() % 2600; if (r > 20 && r < 60) { const p = document.createElement('mjs-cv-glitch'); p.id = 'cv-glitch'; const q = document.createElement('mjs-cv-glitch-tot'); q.id = 'cv-glitch-tot'; document.body.prepend(p, q); const t = performance.now(); setTimeout(() => q.remove(), 300); const voir = () => { if (p._shadow && p._shadow.querySelector('.gv') && q._shadow && q._shadow.querySelector('.g')) { window.__suivre(p, 'cv-glitch'); window.__suivre(q, 'cv-glitch-tot'); ok(t) } else requestAnimationFrame(voir) }; voir() } else setTimeout(go, 2) }; go() })`)
      await page.waitForTimeout(5600)
      const vus: [string, number][] = await page.evaluate('window.__vus')
      for (const c of ['g', 'gv']) {
        const ts = instants(vus, 'cv-glitch.' + c)
        assert.ok(ts.length >= 2, `cv-glitch.${c} : au moins deux salves, vues ${ts.length}`)
        assert.ok(ts[0] - pose >= 1900 && ts[0] - pose < 2300, `cv-glitch.${c} : la première salve 2 s après la pose, vue ${Math.round(ts[0] - pose)} ms après`)
        assert.ok(ts[1] - ts[0] >= 2590, `cv-glitch.${c} : la deuxième un tour entier au moins après la première, vue ${Math.round(ts[1] - ts[0])} ms après`)
        const loin = ts.slice(1).map((t) => Math.round(ecart(t, 2600))).filter((d) => d > 60)
        assert.deepEqual(loin, [], `cv-glitch.${c} : les salves suivantes tombent sur un multiple de 2,6 s compté depuis le début de la page (écarts : ${ts.slice(1).map((t) => Math.round(t % 2600)).join(', ')})`)
      }
      assert.equal(instants(vus, 'cv-glitch-tot.g').length, 0, 'retiré avant sa première salve : aucune salve')
      assert.deepEqual(erreurs, [])
    })

    it('retiré de la page, l\'effet arrête son horloge : plus aucun passage', async () => {
      // témoin : deux passages de chacun avant le retrait
      await page.waitForFunction(`['s', 'g', 'a', 'n'].every((c) => window.__vus.filter(([k]) => k === 'cv-retrait.' + c).length >= 2)`, null, { timeout: 5000, polling: 20 })
      const tr: number = await page.evaluate(`(() => { document.querySelector('#cv-retrait').remove(); return performance.now() })()`)
      await page.waitForTimeout(1200)
      const vus: [string, number][] = await page.evaluate('window.__vus')
      for (const c of ['s', 'g', 'a', 'n']) assert.equal(compte(vus, 'cv-retrait.' + c, tr + 100, Infinity), 0, `cv-retrait.${c} : aucun passage après le retrait`)
      assert.deepEqual(erreurs, [])
    })

    it('en développement, la console dit une fois chaque valeur refusée, aucune pour 0', async () => {
      const dev = await ouvrir(browser, code.dev)
      try {
        await dev.page.waitForTimeout(1200)
        const sur = dev.avis.filter((a) => a.includes('$$fx-every'))
        for (const v of ['-1s', '2', 'abc']) assert.equal(sur.filter((a) => a.includes(`'${v}'`)).length, 1, `'${v}' : un avis, vus ${JSON.stringify(sur)}`)
        assert.equal(sur.length, 3, `un avis par valeur refusée, aucun pour 0 ni 1s : ${JSON.stringify(sur)}`)
        assert.deepEqual(dev.erreurs, [])
      }
      finally {
        await dev.page.context().close()
      }
    })
  })
})
