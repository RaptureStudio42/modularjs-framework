// *marquee CONSTRUIT EN PRODUCTION dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé), un build par pose : ce que le tri des sections laisse à l'application fait ce que
// le réglage demande. Sans rien écrire : le texte défile sur sa piste de deux copies, une balise qui n'a que des éléments pour enfants passe à la
// piste des enfants, une liste qui se remplit après la pose aussi (c'est le contenu qui la demande, pas un réglage). Avec un réglage : la main tire la
// piste, le défilement l'entraîne, la nappe se tire dans les deux sens, le sens inverse la renverse, le sens vertical la range en colonne, la pause
// l'arrête au survol, l'espace relit la taille d'un tour. Chaque pose ne contient que le code de son réglage : une section manquante qui casserait
// une pose se lit ici (une erreur de page, un avertissement, ou un geste sans effet).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

const STYLE = '\n<style>\n:host\n  display: block\ndiv\n  box-sizing: border-box\n.a\n  width: 400px\n  height: 60px\n  margin: 10px\n.logo\n  width: 100px\n  height: 40px\n.cale\n  height: 2400px\n</style>\n'
const LOGOS = '<div class="logo">A</div><div class="logo">B</div><div class="logo">C</div>'
const SCRIPT = '<script>\n$g = 10\n$l = []\n</script>\n'

// une pose = une page de production ; `verifie` lit la page et rend ce qu'elle a vu, `suite` compare deux poses
type Pose = { nom: string, source: string, verifie: (ctx: Ctx) => Promise<any> }
type Ctx = { page: any, tag: string, centre: () => Promise<{ x: number, y: number }>, lit: (js: string) => Promise<any> }

const translation = `(() => { const r = window.__racine(TAG).querySelector('.a [mjs-fx-marquee-run]'); return r ? getComputedStyle(r).translate : null })()`
const POSES: Pose[] = []
const poser = (nom: string, balise: string, contenu: string, verifie: Pose['verifie'], pied = '') => POSES.push({ nom, source: SCRIPT + `<div class="a" ${balise}>${contenu}</div>` + pied + STYLE, verifie })
const nombres = (translate: string | null) => (translate ?? '').split(' ').map((n) => parseFloat(n) || 0)

poser('texte seul : le calque et sa piste de deux copies', '*marquee(speed: 4s)', 'Un texte qui défile', async ({ lit }) => {
  const piste = await lit(`(() => { const t = window.__racine(TAG).querySelector('.a [mjs-fx-marquee-track]'); return t ? { copies: t.children.length, animation: getComputedStyle(t).animationName } : null })()`)
  assert.deepEqual(piste, { copies: 2, animation: 'mjs-fx-marquee' })
  assert.equal(await lit(`!!window.__racine(TAG).querySelector('.a [mjs-fx-marquee-run]')`), false, 'pas de piste d\'enfants')
})

poser('enfants seuls : la piste des enfants et ses copies', '*marquee(speed: 4s, gap: 10)', LOGOS, async ({ lit }) => {
  const vu = await lit(`(() => { const a = window.__racine(TAG).querySelector('.a'); const r = a.querySelector('[mjs-fx-marquee-run]'); return r ? { strip: a.getAttribute('mjs-fx-marquee-strip'), copies: r.querySelectorAll('[mjs-fx-marquee-copy]').length, animation: getComputedStyle(r).animationName } : null })()`)
  assert.ok(vu, 'la piste des enfants est posée')
  assert.equal(vu.strip, 'kids')
  assert.ok(vu.copies >= 1, 'des copies couvrent la balise : ' + vu.copies)
  assert.equal(vu.animation, 'mjs-fx-marquee-run')
})

poser('une liste qui se remplit après la pose : le texte passe à la piste', '*marquee(speed: 4s)', '{for i in $l}<div class="logo">{i}</div>{end}', async ({ page, lit }) => {
  assert.equal(await lit(`!!window.__racine(TAG).querySelector('.a [mjs-fx-marquee-track]')`), true, 'vide : le calque du texte')
  await page.evaluate(`window.__racine(TAG).querySelector('.remplir').click()`)
  await page.waitForFunction(`!!window.__racine(TAG).querySelector('.a > [mjs-fx-marquee-run]')`, null, { timeout: 8000 })
  assert.equal(await lit(`window.__racine(TAG).querySelector('.a').getAttribute('mjs-fx-marquee-strip')`), 'kids')
}, '<button class="remplir" @click={$l = [1, 2, 3]}>remplir</button>')

poser('drag : la main tire la piste', '*marquee(drag: true, speed: 600s, gap: 10)', LOGOS, async ({ page, centre, lit }) => {
  const avant = nombres(await lit(translation))
  const c = await centre()
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x - 120, c.y, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(80)
  const apres = nombres(await lit(translation))
  assert.ok(Math.abs(apres[0] - avant[0]) > 60, `la piste a suivi la main : ${avant} puis ${apres}`)
  assert.equal(await lit(`window.__racine(TAG).querySelector('.a').hasAttribute('mjs-fx-marquee-drag')`), true)
})

poser('axis: both : la nappe se tire dans les deux sens', '*marquee(axis: both, gap: 10)', LOGOS + LOGOS + LOGOS + LOGOS, async ({ page, centre, lit }) => {
  const c = await centre()
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x - 70, c.y - 30, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(80)
  const [x, y] = nombres(await lit(translation))
  assert.ok(Math.abs(x) > 30 && Math.abs(y) > 5, `les deux axes ont bougé : ${x} ${y}`)
  assert.equal(await lit(`window.__racine(TAG).querySelector('.a').getAttribute('mjs-fx-marquee-axis')`), 'both')
})

const defilement = async ({ page, lit }: Ctx) => {
  await page.waitForFunction(`!window.__racine(TAG).querySelector('.a').hasAttribute('mjs-fx-marquee-away')`, null, { timeout: 8000 })
  await page.evaluate('window.scrollTo(0, 300)')
  await page.waitForFunction(`getComputedStyle(window.__racine(TAG).querySelector('.a [mjs-fx-marquee-run]')).translate !== '0px'`, null, { timeout: 8000 })
  return nombres(await lit(translation))[0]
}
const resultats: Record<string, number> = {}

poser('on: scroll : la page entraîne la piste', '*marquee(on: scroll, speed: 10s, gap: 10)', LOGOS, async (ctx) => { resultats.scroll = await defilement(ctx) }, '<div class="cale"></div>')
poser('on: scroll et reverse : l\'autre sens', '*marquee(on: scroll, reverse: true, speed: 10s, gap: 10)', LOGOS, async (ctx) => {
  resultats.reverse = await defilement(ctx)
  // un tour pour 1 000 px : 300 px font 0,3 tour dans un sens (-0,3) ou dans l'autre (+0,3, ramené dans ]-tour, 0] : -0,7) ; 500 px feraient -0,5 des deux côtés
  assert.ok(resultats.scroll === undefined || Math.abs(resultats.scroll - resultats.reverse) > 50, `deux sens : ${resultats.scroll} et ${resultats.reverse}`)
}, '<div class="cale"></div>')

poser('direction: up : la piste en colonne', '*marquee(direction: up, speed: 4s, gap: 10)', LOGOS, async ({ lit }) => {
  const vu = await lit(`(() => { const a = window.__racine(TAG).querySelector('.a'); const r = a.querySelector('[mjs-fx-marquee-run]'); return { axe: a.getAttribute('mjs-fx-marquee-axis'), animation: getComputedStyle(r).animationName, sens: getComputedStyle(r).flexDirection } })()`)
  assert.deepEqual(vu, { axe: 'y', animation: 'mjs-fx-marquee-run-y', sens: 'column' })
})

poser('pause : la piste s\'arrête au survol', '*marquee(pause: true, speed: 4s)', 'Un texte qui défile', async ({ page, centre, lit }) => {
  const etat = `getComputedStyle(window.__racine(TAG).querySelector('.a [mjs-fx-marquee-track]')).animationPlayState`
  assert.equal(await lit(etat), 'running')
  const c = await centre()
  await page.mouse.move(c.x, c.y)
  await page.waitForFunction(`${etat} === 'paused'`, null, { timeout: 5000 })
})

poser('gap tenu par une variable : la taille d\'un tour est relue', '*marquee(gap: $g, speed: 4s)', LOGOS, async ({ page, lit }) => {
  const tour = `parseFloat(window.__racine(TAG).querySelector('.a [mjs-fx-marquee-run]').style.getPropertyValue('--mjs-fx-marquee-tour'))`
  const avant = await lit(tour)
  await page.evaluate(`window.__racine(TAG).querySelector('.grand').click()`)
  await page.waitForFunction(`${tour} > ${avant} + 100`, null, { timeout: 8000 })
}, '<button class="grand" @click={$g = 60}>grand</button>')

poser('tous les réglages ensemble', '*marquee(drag: true, axis: both, on: scroll, reverse: true, direction: up, pause: true, gap: 10, speed: 10s)', LOGOS + LOGOS + LOGOS, async ({ page, centre, lit }) => {
  const c = await centre()
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x - 40, c.y - 20, { steps: 6 })
  await page.mouse.up()
  await page.evaluate('window.scrollTo(0, 300)')
  await page.waitForTimeout(200)
  assert.equal(await lit(`!!window.__racine(TAG).querySelector('.a [mjs-fx-marquee-run]')`), true)
}, '<div class="cale"></div>')

describe('*marquee en production — chaque pose construite avec le seul code de ses réglages', function () {
  this.timeout(1800000)
  const scripts: string[] = []

  before(async () => {
    for (const [i, pose] of POSES.entries()) {
      const root   = mjsTmp('marquee-prod-' + i)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 't-' + i + '.mjs'), pose.source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], pose.nom)
      scripts.push(stripEsm(readFileSync(manifeste, 'utf-8')))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      POSES.forEach((pose, i) => {
        it(pose.nom, async () => {
          const tag     = 'mjs-t-' + i
          const page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
          await page.addInitScript(`window.__racine = (tag) => {
            const el = document.querySelector(tag)
            if (!el) return null
            if (el.shadowRoot) return el.shadowRoot
            for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
            return el
          }`)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><${tag}></${tag}><script>${scripts[i]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('.a')`, null, { timeout: 20000 })
          await page.waitForTimeout(300)
          // TAG est remplacé par la balise du composant dans chaque expression lue dans la page
          const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
          const evaluate = page.evaluate.bind(page)
          page.evaluate = (js: any, ...args: any[]) => evaluate(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const waitForFunction = page.waitForFunction.bind(page)
          page.waitForFunction = (js: any, ...args: any[]) => waitForFunction(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const centre = () => lit(`(() => { const r = window.__racine(TAG).querySelector('.a').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
          try {
            await pose.verifie({ page, tag, centre, lit })
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })
      })
    })
  }
})
