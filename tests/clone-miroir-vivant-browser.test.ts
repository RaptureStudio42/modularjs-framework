// µclone el, mirror: true dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé), construction de développement et de
// production (noms d'exécution renommés) : le miroir d'une carte, posé dans la page par le composant qui l'a demandé, partage l'état de
// l'original — un clic « +1 » dans le miroir fait monter le compteur partout (dérivé compris), la saisie liée et la prop du parent passent
// d'une instance à l'autre, comme une liste et un objet profond ; un miroir d'un miroir rejoint le même état ; l'enfant rendu dans le gabarit
// garde son état propre ; µmount joue dans chaque instance, `isMirror` les distingue ; l'original retiré, les miroirs gardent l'état et se
// préviennent ; une option inconnue est refusée. Mille miroirs créés puis retirés : une écriture redevient aussi rapide qu'avant eux (le
// groupe ne les tient plus) et, dans Chromium, le ramasse-miettes les reprend tous. Ni erreur ni avertissement dans la page.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { SOURCES_MIROIR } from './helpers/composants-miroir.js'

// un composant léger en calcul, pour les mille miroirs
const SOURCES = { ...SOURCES_MIROIR, 'pastille.mjs': ['<script>', '  $n = 0', '</script>', '<b class="n">{$n}</b>', ''].join('\n') }

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// l'ombre d'un composant, sans dépendre du nom (renommé en production) de la propriété qui la tient
const AIDES = `
  window.__monte = []
  window.__vus = []
  window.__miroirs = []
  window.__ombre = (el) => {
    if (!el) return null
    for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
    return null
  }
  window.__hote = () => document.querySelector('mjs-liste')
  window.__zone = () => window.__ombre(window.__hote()).querySelector('.zone')
  window.__original = () => { const r = window.__ombre(window.__hote()); return r ? [...r.querySelectorAll('mjs-carte')].find((e) => !e.closest('.zone')) : null }
  window.__lit = (el, sel) => window.__ombre(el)?.querySelector(sel)?.textContent ?? null
  window.__plus = (el, sel) => window.__ombre(el).querySelector(sel || '.plus').click()
  window.__poser = (de) => { const m = window.__hote().miroir(de); window.__zone().append(m); window.__miroirs.push(m); return true }
  window.__tous = (sel) => [window.__o, ...window.__miroirs].filter((x) => x && x.isConnected).map((x) => window.__lit(x, sel))
  window.__pareils = (sel, v) => window.__tous(sel).every((x) => x === v)
  window.__ecrire = (el, fois) => { const t = performance.now(); for (let i = 0; i < fois; i++) µ._set(el, 'n', i + 1); return performance.now() - t }
`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

const scripts: Record<string, Promise<string>> = {}
function construire(appli: Appli): Promise<string> {
  scripts[appli.env] ??= (async () => {
    const root   = mjsTmp('clone-miroir-vivant-' + appli.env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const manifeste = join(outDir, 'bundle.js')
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle' }
    if (appli.env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [], appli.nom)
    const code = stripEsm(readFileSync(manifeste, 'utf-8'))
    // production : le miroir part renommé comme le reste ; ses noms internes ne restent pas en clair, `isMirror` (public) si
    if (appli.env === 'prod') {
      assert.equal(code.includes('_mjs_twins'), false, 'noms d\'exécution renommés')
      assert.equal(code.includes('isMirror'), true)
    }
    return code
  })()
  return scripts[appli.env]
}

describe('µclone mirror: true — le miroir vivant partage l\'état de l\'original (navigateurs réels)', function () {
  this.timeout(600000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => { await browser?.close() })

      for (const appli of APPLIS) {
        it(appli.nom, async () => {
          const script = await construire(appli)
          const page   = await (await browser.newContext()).newPage()
          const erreurs: string[] = []
          const avis: string[]    = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => {
            if (m.type() === 'error') erreurs.push(m.text())
            else if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
          })
          await page.addInitScript(AIDES)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-liste></mjs-liste><script>${script}</script></body></html>` })
          })
          const lit   = (js: string) => page.evaluate(js)
          const voir  = (js: string) => page.waitForFunction(js, null, { timeout: 8000 })
          try {
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await voir('window.__lit(window.__original(), \'.n\') === \'0\'')
            await page.waitForTimeout(150)
            await lit('window.__o = window.__original(); for (let i = 0; i < 5; i++) window.__plus(window.__o); window.__o.ajouter(\'b\')')
            await voir('window.__lit(window.__o, \'.n\') === \'5\' && window.__lit(window.__o, \'.noms\') === \'a,b\'')

            // le miroir, demandé par la rune et posé dans la page : l'état du moment, son script ne remet rien à zéro
            await lit('window.__poser(window.__o)')
            await voir('window.__lit(window.__miroirs[0], \'.n\') !== null')
            await page.waitForTimeout(100)
            assert.deepEqual(await lit('[\'.n\', \'.double\', \'.titre\', \'.noms\', \'.remplie\'].map((s) => window.__lit(window.__miroirs[0], s))'), ['5', '10', 'Bonjour', 'a,b', '1,2'])
            assert.equal(await lit('window.__lit(window.__o, \'.remplie\')'), '1,2')
            assert.deepEqual(await lit('[window.__miroirs[0].isMirror, window.__o.isMirror]'), [true, false])

            // +1 dans le miroir : tout le monde monte, dérivé compris
            await lit('window.__plus(window.__miroirs[0])')
            await voir('window.__pareils(\'.n\', \'6\') && window.__pareils(\'.double\', \'12\')')

            // saisie liée dans le miroir, prop du parent de l'original
            await lit('(() => { const i = window.__ombre(window.__miroirs[0]).querySelector(\'.saisie\'); i.value = \'salut\'; i.dispatchEvent(new Event(\'input\', { bubbles: true })) })()')
            await voir('window.__pareils(\'.texte\', \'salut\')')
            await lit('window.__hote().titrer(\'Salut\')')
            await voir('window.__pareils(\'.titre\', \'Salut\')')

            // liste et objet profond, d'une instance à l'autre
            await lit('window.__miroirs[0].ajouter(\'c\')')
            await voir('window.__pareils(\'.noms\', \'a,b,c\')')
            await lit('window.__o.creuser()')
            await voir('window.__pareils(\'.profond\', \'2\')')

            // le miroir d'un miroir rejoint le même état
            await lit('window.__poser(window.__miroirs[0])')
            await voir('window.__lit(window.__miroirs[1], \'.n\') === \'6\'')
            await lit('window.__plus(window.__miroirs[1])')
            await voir('window.__pareils(\'.n\', \'7\') && window.__tous(\'.n\').length === 3')

            // l'enfant rendu dans le gabarit : instance neuve, état propre, prop venue de l'état commun
            await lit('window.__plus(window.__ombre(window.__miroirs[0]).querySelector(\'mjs-compteur\'), \'.propre-plus\')')
            await voir('window.__lit(window.__ombre(window.__miroirs[0]).querySelector(\'mjs-compteur\'), \'.propre\') === \'1\'')
            assert.equal(await lit('window.__lit(window.__ombre(window.__o).querySelector(\'mjs-compteur\'), \'.propre\')'), '0')
            assert.deepEqual(await lit('[window.__o, ...window.__miroirs].map((x) => window.__lit(window.__ombre(x).querySelector(\'mjs-compteur\'), \'.base\'))'), ['7', '7', '7'])

            // µmount : une fois dans chaque instance, `@@isMirror` les distingue
            const monte = await lit('window.__monte.map((x) => x[1])')
            assert.deepEqual([...monte].sort(), [false, true, true], JSON.stringify(monte))

            // l'original retiré : les miroirs gardent l'état, écrivent et se préviennent
            await lit('window.__o.remove()')
            await page.waitForTimeout(50)
            await lit('window.__plus(window.__miroirs[1])')
            await voir('window.__pareils(\'.n\', \'8\') && window.__pareils(\'.double\', \'16\') && window.__tous(\'.n\').length === 2')
            await lit('window.__miroirs[0].ajouter(\'d\')')
            await voir('window.__pareils(\'.noms\', \'a,b,c,d\')')

            // une option inconnue ; en production, sans la table des messages (la page d'essai ne la charge pas), la clé du texte et ses valeurs
            const message = await lit('(() => { try { µ.clone(window.__miroirs[0], { miroir: 1 }); return \'aucune erreur\' } catch (e) { return e.message } })()')
            if (appli.env === 'dev') assert.equal(message, '[ModularJS] µclone : option « miroir » inconnue — la seule option est mirror : µclone el, mirror: true rend un miroir vivant, qui partage l\'état de l\'original.')
            else assert.equal(message, '[ModularJS] cloneOption {"opt":"miroir"}')

            // mille miroirs créés puis retirés : une écriture redevient aussi rapide qu'avant eux
            await lit('window.__p = document.createElement(\'mjs-pastille\'); document.body.append(window.__p)')
            await voir('window.__lit(window.__p, \'.n\') === \'0\'')
            const seul = await lit('window.__ecrire(window.__p, 300)') as number
            await lit('window.__boite = document.createElement(\'div\'); document.body.append(window.__boite); window.__mp = Array.from({ length: 1000 }, () => µ.clone(window.__p, { mirror: true })); window.__boite.append(...window.__mp)')
            await page.waitForFunction('window.__mp.every((m) => window.__lit(m, \'.n\') !== null)', null, { timeout: 30000 })
            const avecMille = await lit('window.__ecrire(window.__p, 300)') as number
            await voir('window.__lit(window.__mp[999], \'.n\') === \'300\'')
            await lit('window.__refs = window.__mp.map((m) => new WeakRef(m)); window.__boite.remove(); window.__boite = null; window.__mp = null')
            await page.waitForTimeout(100)
            const apres = await lit('window.__ecrire(window.__p, 300)') as number
            assert.ok(apres * 4 < avecMille, `écriture : seul ${seul.toFixed(1)} ms, avec mille miroirs ${avecMille.toFixed(1)} ms, après leur retrait ${apres.toFixed(1)} ms`)
            if (nom === 'chromium') {
              const cdp = await page.context().newCDPSession(page)
              await cdp.send('HeapProfiler.collectGarbage')
              await page.waitForTimeout(100)
              await cdp.send('HeapProfiler.collectGarbage')
              assert.equal(await lit('window.__refs.filter((r) => r.deref()).length'), 0, 'les miroirs retirés sont repris par le ramasse-miettes')
            }

            assert.deepEqual(erreurs, [], appli.nom)
            assert.deepEqual(avis, [], appli.nom)
          } finally {
            await page.context().close()
          }
        })
      }
    })
  }
})
