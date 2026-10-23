// µclone dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé), construction de développement et de production (noms
// d'exécution renommés) : la copie d'une carte, posée dans la page par le composant qui l'a demandée, monte avec l'état de l'original
// (compteur à 5, la prop reçue, le contenu glissé), puis vit seule — ses clics, son µmount, son reffet, la fonction rangée dans son état sont les siens. Une prop
// posée en propriété sur une balise pas encore montée (`el.titre = …`) passe dans la copie, comme dans l'original à son montage. Ni erreur ni
// avertissement dans la page.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { SOURCES_CLONE } from './helpers/composants-clone.js'

// un composant qui copie la balise qu'on lui donne
const SOURCES = { ...SOURCES_CLONE, 'copieur.mjs': ['<script>', '  @cloner = (el) -> µclone el', '</script>', '<p class="copieur"></p>', ''].join('\n') }

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
  window.__ombre = (el) => {
    if (!el) return null
    for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
    return null
  }
  window.__hote = () => document.querySelector('mjs-liste')
  window.__copieur = () => document.querySelector('mjs-copieur')
  window.__original = () => { const r = window.__ombre(window.__hote()); return r ? [...r.querySelectorAll('mjs-carte')].find((e) => !e.closest('.zone')) : null }
  window.__copie = () => window.__ombre(window.__hote())?.querySelector('.zone > mjs-carte')
  window.__lit = (el) => el && window.__ombre(el)?.querySelector('.n') ? { n: window.__ombre(el).querySelector('.n').textContent, titre: window.__ombre(el).querySelector('.titre').textContent, glisse: el.querySelector('.glisse')?.textContent ?? null } : null
  window.__plus = (el, fois) => { for (let i = 0; i < fois; i++) window.__ombre(el).querySelector('.plus').click() }
  window.__valider = (el) => window.__ombre(el).querySelector('.valider').click()
`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

const scripts: Record<string, Promise<string>> = {}
function construire(appli: Appli): Promise<string> {
  scripts[appli.env] ??= (async () => {
    const root   = mjsTmp('clone-copie-vivante-' + appli.env)
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
    // production : le fichier de µclone part, renommé comme le reste ; ses noms internes ne restent pas en clair
    if (appli.env === 'prod') assert.equal(code.includes('_mjs_pending'), false, 'noms d\'exécution renommés')
    return code
  })()
  return scripts[appli.env]
}

describe('µclone — la copie d\'un composant monte avec son état puis vit seule (navigateurs réels)', function () {
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
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-liste></mjs-liste><mjs-copieur></mjs-copieur><script>${script}</script></body></html>` })
          })
          const lit = (js: string) => page.evaluate(js)
          try {
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction('!!window.__lit(window.__original())', null, { timeout: 20000 })
            await page.waitForTimeout(150)
            await lit('window.__plus(window.__original(), 5)')
            await page.waitForFunction('window.__lit(window.__original()).n === \'5\'', null, { timeout: 5000 })
            const uidOriginal = await lit('window.__original().uid')

            // la copie, demandée par la rune µclone et posée dans la page par le composant
            await lit('window.__hote().dupliquer()')
            await page.waitForFunction('!!window.__lit(window.__copie())', null, { timeout: 5000 })
            await page.waitForTimeout(150)
            assert.deepEqual(await lit('window.__lit(window.__copie())'), { n: '5', titre: 'Bonjour', glisse: 'glissé' })
            const uidCopie = await lit('window.__copie().uid')
            assert.notEqual(uidCopie, uidOriginal)

            // chacun vit de son côté
            await lit('window.__plus(window.__copie(), 1)')
            await page.waitForFunction('window.__lit(window.__copie()).n === \'6\'', null, { timeout: 5000 })
            assert.equal((await lit('window.__lit(window.__original())')).n, '5')
            await lit('window.__plus(window.__original(), 2)')
            await page.waitForFunction('window.__lit(window.__original()).n === \'7\'', null, { timeout: 5000 })
            await page.waitForTimeout(100)
            assert.equal((await lit('window.__lit(window.__copie())')).n, '6')

            // la prop : le parent ne pilote que l'original
            await lit('window.__hote().titrer(\'Salut\')')
            await page.waitForFunction('window.__lit(window.__original()).titre === \'Salut\'', null, { timeout: 5000 })
            await page.waitForTimeout(100)
            assert.equal((await lit('window.__lit(window.__copie())')).titre, 'Bonjour')

            // µmount : une fois par instance ; le reffet de la copie part de l'état copié et ne suit que sa variable
            const monte = await lit('window.__monte')
            assert.equal(monte.filter((u: number) => u === uidCopie).length, 1, JSON.stringify(monte))
            assert.equal(monte.filter((u: number) => u === uidOriginal).length, 1, JSON.stringify(monte))
            const vus = (await lit('window.__vus')).filter((x: string) => x.startsWith(uidCopie + ':'))
            assert.deepEqual(vus, [uidCopie + ':5', uidCopie + ':6'])

            // une fonction rangée dans l'état (`$valider = -> $n++`) : celle de la copie agit sur la copie
            await lit('window.__valider(window.__copie())')
            await page.waitForFunction('window.__lit(window.__copie()).n === \'7\'', null, { timeout: 5000 })
            await page.waitForTimeout(100)
            assert.equal((await lit('window.__lit(window.__original())')).n, '7')
            await lit('window.__valider(window.__original())')
            await page.waitForFunction('window.__lit(window.__original()).n === \'8\'', null, { timeout: 5000 })
            await page.waitForTimeout(100)
            assert.equal((await lit('window.__lit(window.__copie())')).n, '7')

            // une prop posée en propriété sur une balise pas encore montée : la copie la reçoit, comme l'original à son montage
            await lit('(() => { const e = document.createElement(\'mjs-carte\'); e.titre = \'PROP\'; window.__nm = e; window.__nmc = window.__copieur().cloner(e); document.body.append(e, window.__nmc) })()')
            await page.waitForFunction('!!window.__lit(window.__nm) && !!window.__lit(window.__nmc)', null, { timeout: 5000 })
            await page.waitForTimeout(100)
            assert.deepEqual([(await lit('window.__lit(window.__nm)')).titre, (await lit('window.__lit(window.__nmc)')).titre], ['PROP', 'PROP'])

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
