// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé) : ce que les copies suivent, et ce qu'elles lâchent. Une bande
// `unit: child` porte deux cartes (`<@carte>`, un composant), un champ et un composant qui ne rend rien, en développement et en production (le cœur et l'effet
// minifiés ensemble).
//   1. une feuille collée par `µ.adoptSheet` dans l'ombre d'une carte gagne ses copies, et les quitte quand elle est retirée ; le texte tapé dans le
//      champ d'origine gagne ses copies ; un changement d'une carte (son texte, un attribut, un nœud qui arrive puis repart) gagne ses copies ;
//   2. une carte sortie de la bande (déplacée ailleurs dans la page) n'est plus observée par l'effet, l'autre carte l'est toujours et ses copies la
//      suivent ; aucun observateur n'est posé dans une copie, l'effet n'observe l'ombre d'aucune carte (son miroir se dessine lui-même) ; (développement)
//      le registre des composants (`µ.instances`) compte les originaux et leurs miroirs ; un composant créé après les copies est une vraie instance (montée,
//      rendue). Le `µmount` de la carte se garde des miroirs (`@@isMirror`) : il ne compte que les originaux.

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

const SOURCES: Record<string, string> = {
  'vitrine.mjs': [
    '<div class="a" *marquee(unit: child, speed: 900s)>',
    '  <@carte></@carte>',
    '  <@carte></@carte>',
    '  <input class="champ" value="départ" aria-label="champ">',
    '  <@vide></@vide>',
    '</div>',
    '<div class="ailleurs"></div>',
    '<style>',
    '.a',
    '  width: 900px',
    '  height: 56px',
    '.champ',
    '  width: 120px',
    '</style>',
    ''
  ].join('\n'),
  'carte.mjs': [
    '<script>',
    '  $t = 0',
    '  @tic = -> $t++',
    '  µmount ->',
    '    return if @@isMirror',
    '    moi = @',
    '    window.__cartes = (window.__cartes || []).concat([moi])',
    '    window.__cadre = (c) -> µ.adoptSheet(c, \'.photo { outline: 5px solid rgb(0, 128, 0) }\')',
    '    return',
    '</script>',
    '<span class="photo" data-t={$t}>{$t}</span>',
    '{if $t == 2}',
    '  <i class="deux">deux</i>',
    '{end}',
    '<style>',
    ':host',
    '  display: inline-block',
    '  width: 140px',
    '</style>',
    ''
  ].join('\n'),
  // un composant sans gabarit (son ombre reste vide) : posé en dernier, c'est le dernier miroir construit (après lui, le crochet du cœur doit être retombé)
  'vide.mjs': [
    '<script>',
    '  $plein = false',
    '</script>',
    ''
  ].join('\n')
}

// les aides de la page : l'ombre d'une balise (ouverte, ou tenue par le composant), la bande, ses copies, les observateurs de changements en vie
const AIDES = `(() => {
  window.__ombre = (el) => {
    if (!el) return null
    if (el.shadowRoot) return el.shadowRoot
    for (const k of Object.getOwnPropertyNames(el)) { try { if (el[k] && el[k].nodeType === 11) return el[k] } catch (e) {} }
    return null
  }
  window.__v = () => window.__ombre(document.querySelector('mjs-vitrine'))
  window.__bande = () => window.__v().querySelector('.a')
  window.__run = () => window.__bande().querySelector(':scope > [mjs-fx-marquee-run]')
  window.__copies = () => [...window.__bande().querySelectorAll(':scope > [mjs-fx-marquee-run] > [mjs-fx-marquee-copy]')]
  window.__dansCopie = (n) => { for (let x = n; x; x = x.parentNode || x.host) if (x.nodeType === 1 && x.hasAttribute('mjs-fx-marquee-copy')) return true; return false }
  // ce que montre une carte (l'original ou son miroir) : le texte, l'attribut, le nœud conditionnel, le style du contour posé par la feuille collée
  window.__lire = (h) => {
    const r = window.__ombre(h)
    const p = r && r.querySelector('.photo')
    return p ? p.textContent + '/' + p.getAttribute('data-t') + '/' + (r.querySelector('.deux') ? 'deux' : '-') + '/' + getComputedStyle(p).outlineStyle : null
  }
  // le miroir d'une carte dans chaque copie : à sa place parmi les enfants d'origine (les noms internes sont raccourcis en production)
  window.__miroirs = (h) => {
    const i = [...window.__run().children].filter(n => !n.hasAttribute('mjs-fx-marquee-copy')).indexOf(h)
    return window.__copies().map(k => i >= 0 ? k.children[i] || null : null)
  }
  window.__suivis = []
  const observe = MutationObserver.prototype.observe
  const disconnect = MutationObserver.prototype.disconnect
  MutationObserver.prototype.observe = function(n, o) { window.__suivis.push([this, n]); return observe.call(this, n, o) }
  MutationObserver.prototype.disconnect = function() { window.__suivis = window.__suivis.filter(s => s[0] !== this); return disconnect.call(this) }
})()`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

const scripts: Record<string, Promise<string>> = {}
function construire(appli: Appli): Promise<string> {
  scripts[appli.env] ??= (async () => {
    const root   = mjsTmp('marquee-suivi-' + appli.env)
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
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    assert.ok(fichiers.includes('bundle.js'), fichiers.join(' '))
    return stripEsm(readFileSync(manifeste, 'utf-8'))
  })()
  return scripts[appli.env]
}

describe('*marquee — ce que les copies suivent, et ce qu\'elles lâchent (navigateurs réels)', function () {
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

      async function ouvrir(appli: Appli) {
        const script  = await construire(appli)
        const page    = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        await page.addInitScript(AIDES)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><mjs-vitrine></mjs-vitrine><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(`(window.__cartes || []).length === 2 && window.__copies().length > 0 && window.__miroirs(window.__cartes[0]).every(m => m && window.__lire(m))`, null, { timeout: 20000 })
        await page.waitForTimeout(400)
        return { page, erreurs }
      }

      for (const appli of APPLIS) {
        it(`${appli.nom} : les copies suivent la feuille collée, le texte tapé et chaque changement d'une carte`, async () => {
          const { page, erreurs } = await ouvrir(appli)
          const echecs: string[] = []
          const ok  = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
          const lit = (js: string) => page.evaluate(js)
          const etat = () => lit(`({ original: window.__lire(window.__cartes[0]), copies: window.__miroirs(window.__cartes[0]).map(m => m && window.__lire(m)) })`)
          try {
            // la feuille collée, puis retirée
            await lit('window.__retirer = window.__cadre(window.__cartes[0])')
            await page.waitForTimeout(300)
            let e = await etat()
            ok(e.original === '0/0/-/solid' && e.copies.length > 0 && e.copies.every((c: any) => c === e.original), `la feuille collée par µ.adoptSheet gagne les copies : ${JSON.stringify(e)}`)
            await lit('window.__retirer()')
            await page.waitForTimeout(300)
            e = await etat()
            ok(e.original === '0/0/-/none' && e.copies.every((c: any) => c === e.original), `la feuille retirée quitte les copies : ${JSON.stringify(e)}`)

            // le texte tapé dans le champ d'origine
            const champ = await lit(`(() => { const r = window.__run().querySelector(':scope > .champ').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
            await page.mouse.click(champ.x, champ.y)
            await page.keyboard.press('End')
            await page.keyboard.type('XYZ')
            await page.waitForTimeout(300)
            const valeurs = await lit(`({ original: window.__run().querySelector(':scope > .champ').value, copies: window.__copies().map(k => k.querySelector('.champ').value) })`)
            ok(valeurs.original === 'départXYZ' && valeurs.copies.length > 0 && valeurs.copies.every((v: string) => v === 'départXYZ'), `le texte tapé dans le champ d'origine gagne les copies : ${JSON.stringify(valeurs)}`)
            await lit('document.activeElement && document.activeElement.blur && document.activeElement.blur()')

            // un changement d'une carte : son texte et son attribut, un nœud qui arrive (t = 2) puis repart (t = 3)
            await lit('window.__cartes[0].tic(); window.__cartes[0].tic()')
            await page.waitForTimeout(300)
            e = await etat()
            ok(e.original === '2/2/deux/none' && e.copies.every((c: any) => c === e.original), `le texte, l'attribut et le nœud qui arrive gagnent les copies : ${JSON.stringify(e)}`)
            await lit('window.__cartes[0].tic()')
            await page.waitForTimeout(300)
            e = await etat()
            ok(e.original === '3/3/-/none' && e.copies.every((c: any) => c === e.original), `le nœud qui repart quitte les copies : ${JSON.stringify(e)}`)
            ok(erreurs.length === 0, `aucune erreur dans la page : ${erreurs.join(' | ')}`)
            assert.deepEqual(echecs, [])
          }
          finally {
            await page.context().close()
          }
        })

        it(`${appli.nom} : une carte sortie de la bande n'est plus suivie, rien n'observe une copie, les miroirs sont au registre`, async () => {
          const { page, erreurs } = await ouvrir(appli)
          const echecs: string[] = []
          const ok  = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
          const lit = (js: string) => page.evaluate(js)
          try {
            // l'effet ne pose aucun observateur sur un nœud d'une copie (un miroir, instance montée, a les siens, ceux de tout composant)
            const dansCopies = await lit(`(() => { const effet = new Set(window.__suivis.filter(s => s[1] === window.__run()).map(s => s[0])); return window.__suivis.filter(s => effet.has(s[0]) && window.__dansCopie(s[1])).map(s => s[1].localName || s[1].nodeName) })()`)
            ok(dansCopies.length === 0, `aucun observateur de l'effet posé dans une copie : ${dansCopies.join(' ')}`)

            // (développement) le registre des composants : les deux cartes et chacun de leurs miroirs
            if (appli.env === 'dev') {
              const reg = await lit(`({ miroirs: [...window.µ.instances].filter(e => e.localName === 'mjs-carte' && e.isMirror === true).length, cartes: [...window.µ.instances].filter(e => e.localName === 'mjs-carte' && !e.isMirror).length, enCopie: window.__copies().reduce((n, k) => n + k.querySelectorAll('mjs-carte').length, 0) })`)
              ok(reg.cartes === 2 && reg.enCopie > 0 && reg.miroirs === reg.enCopie, `le registre compte les originaux et chacun de leurs miroirs : ${JSON.stringify(reg)}`)
            }

            // l'effet n'observe l'ombre d'aucune carte ; la première sort de la bande, la seconde est toujours suivie
            const suivie = `(() => {
              const run = window.__run()
              const effet = new Set(window.__suivis.filter(s => s[1] === run).map(s => s[0]))
              return window.__cartes.map(c => window.__suivis.some(s => effet.has(s[0]) && s[1] === window.__ombre(c)))
            })()`
            const avant = await lit(suivie)
            ok(avant[0] === false && avant[1] === false, `l'effet n'observe l'ombre d'aucune carte (leurs miroirs se dessinent eux-mêmes) : ${JSON.stringify(avant)}`)
            await lit(`window.__v().querySelector('.ailleurs').appendChild(window.__cartes[0])`)
            await page.waitForTimeout(400)
            await lit('for (let i = 0; i < 5; i++) window.__cartes[0].tic()')
            await page.waitForTimeout(300)
            const apres = await lit(suivie)
            ok(apres[0] === false && apres[1] === false, `après, l'effet n'observe toujours aucune ombre de carte : ${JSON.stringify(apres)}`)
            await lit('window.__cartes[1].tic()')
            await page.waitForTimeout(300)
            const autre = await lit(`({ original: window.__lire(window.__cartes[1]), copies: window.__miroirs(window.__cartes[1]).map(m => m && window.__lire(m)) })`)
            ok(autre.original === '1/1/-/none' && autre.copies.length > 0 && autre.copies.every((c: any) => c === autre.original), `les copies suivent toujours l'autre carte : ${JSON.stringify(autre)}`)

            // un composant créé après les copies est une vraie instance : monté, rendu
            await lit(`document.body.appendChild(document.createElement('mjs-carte'))`)
            await page.waitForTimeout(300)
            const neuve = await lit(`(() => { const c = document.body.querySelector(':scope > mjs-carte'); return { montees: window.__cartes.length, miroir: c.isMirror, rendu: window.__lire(c) } })()`)
            ok(neuve.montees === 3 && !neuve.miroir && neuve.rendu === '0/0/-/none', `un composant créé après les copies est une vraie instance : ${JSON.stringify(neuve)}`)
            ok(erreurs.length === 0, `aucune erreur dans la page : ${erreurs.join(' | ')}`)
            assert.deepEqual(echecs, [])
          }
          finally {
            await page.context().close()
          }
        })
      }
    })
  }
})
