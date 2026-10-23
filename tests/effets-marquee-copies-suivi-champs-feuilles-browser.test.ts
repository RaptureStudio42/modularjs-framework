// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé) : ce que les copies suivent encore, et ce qu'elles coûtent. En
// développement et en production (le cœur et l'effet minifiés ensemble).
//   1. une feuille collée par `µ.adoptSheet` dans l'ombre d'une carte AVANT la première piste de la page (la carte rejoint ensuite une bande) gagne les
//      copies, puis les quitte quand elle est retirée ;
//   2. un bouton radio décoché par un autre se reflète dans les copies ; une remise à zéro (bouton `type="reset"`, ou `form.reset()` par un script) aussi ;
//   3. un texte changé dans un original ne revoit que le miroir de ce texte : aucun attribut d'aucune balise n'est relu (la mise à jour est partielle) ;
//   4. l'effet n'observe l'ombre d'aucune carte (son miroir se dessine lui-même) ; une carte retirée de l'intérieur d'un enfant (pas un enfant de la piste)
//      quitte les copies avec ses miroirs ;
//   5. (construction découpée) un composant dont le module arrive après la pose des copies y devient un miroir vivant de l'original, monté une fois (les copies
//      ne se refont pas : aucun miroir remonté) ; (développement) le registre compte les originaux à part. Le `µmount` de la carte compte les miroirs à part.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
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

const CARTE = [
  '<script>',
  '  $t = 0',
  '  @tic = -> $t++',
  '  µmount ->',
  '    if @@isMirror',
  '      window.__miroirsMontes = (window.__miroirsMontes || 0) + 1',
  '      return',
  '    moi = @',
  '    window.__cartes = (window.__cartes || []).concat([moi])',
  '    window.__montages = (window.__montages || 0) + 1',
  '    window.__cadre = (c, coul) -> µ.adoptSheet(c, \'.photo { outline: 5px solid \' + coul + \' }\')',
  '    return',
  '</script>',
  '<span class="photo" data-t={$t}>{$t}</span>',
  '<style>',
  ':host',
  '  display: inline-block',
  '  width: 120px',
  '</style>',
  ''
].join('\n')

const SOURCES: Record<string, string> = {
  'vitrine.mjs': [
    '<script>',
    '  $on = false',
    '  @allumer = -> $on = true',
    '  µmount ->',
    '    moi = @',
    '    window.__allumer = -> moi.allumer()',
    '    return',
    '</script>',
    '<div class="ailleurs"><@carte class="avant"></@carte></div>',
    '{if $on}',
    '  <div class="a" *marquee(unit: child, speed: 900s)>',
    '    <@carte class="c1"></@carte>',
    '    <div class="boite"><span class="t">txt</span><b>gras</b><@carte class="c3"></@carte></div>',
    '    <form class="f"><input type="radio" class="ra" name="r" value="a" checked aria-label="ra"><input type="radio" class="rb" name="r" value="b" aria-label="rb"><input class="tx" value="v" aria-label="tx"><textarea class="ta" aria-label="ta">t</textarea><button class="rz" type="reset">RAZ</button></form>',
    '  </div>',
    '{end}',
    '<style>',
    '.a',
    '  width: 960px',
    '  height: 60px',
    '.tx',
    '  width: 60px',
    '.t',
    '  display: inline-block',
    '  width: 40px',
    '  overflow: hidden',
    // la boîte garde sa taille quand la carte en part : la piste ne change pas de taille, ses copies ne se refont pas d'elles-mêmes
    '.boite',
    '  display: inline-block',
    '  width: 260px',
    '  height: 40px',
    '  overflow: hidden',
    '</style>',
    ''
  ].join('\n'),
  'carte.mjs': CARTE
}

// la construction découpée : une bande de deux cartes, dont le module arrive à la demande
const DECOUPEE: Record<string, string> = {
  'vitrine.mjs': [
    '<div class="a" *marquee(unit: child, speed: 900s)>',
    '  <@carte class="c1"></@carte>',
    '  <@carte class="c2"></@carte>',
    '</div>',
    '<style>',
    '.a',
    '  width: 900px',
    '  height: 50px',
    '</style>',
    ''
  ].join('\n'),
  'carte.mjs': CARTE
}

// les aides de la page : l'ombre d'une balise (ouverte, ou tenue par le composant), la bande, ses copies, le contour posé par la feuille collée, les
// observateurs de changements en vie, les attributs relus
const AIDES = `(() => {
  window.__ombre = (el) => {
    if (!el) return null
    if (el.shadowRoot) return el.shadowRoot
    for (const k of Object.getOwnPropertyNames(el)) { try { if (el[k] && el[k].nodeType === 11) return el[k] } catch (e) {} }
    return null
  }
  window.__v = () => window.__ombre(document.querySelector('mjs-vitrine'))
  window.__run = () => window.__v().querySelector('.a > [mjs-fx-marquee-run]')
  window.__copies = () => [...window.__run().querySelectorAll(':scope > [mjs-fx-marquee-copy]')]
  window.__image = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))))
  window.__contour = (h) => { const r = window.__ombre(h); const p = r && r.querySelector('.photo'); return p ? getComputedStyle(p).outlineStyle : '?' }
  // le contour de la carte d'origine (par sa classe) et de son miroir dans chaque copie, à la même place parmi les enfants de la piste
  window.__contours = (cls) => {
    const kids = [...window.__run().children].filter(n => !n.hasAttribute('mjs-fx-marquee-copy'))
    const i = kids.findIndex(n => n.classList.contains(cls))
    return { original: window.__contour(kids[i]), copies: window.__copies().map(k => window.__contour(k.children[i])) }
  }
  // un champ d'origine et ses miroirs : coché pour une case, la valeur sinon
  window.__champ = (sel) => {
    const lire = (n) => n ? (n.type === 'radio' ? String(n.checked) : n.value) : '?'
    return { original: lire(window.__run().querySelector(':scope > form ' + sel)), copies: window.__copies().map(k => lire(k.querySelector('form ' + sel))) }
  }
  window.__lus = 0
  const noms = Element.prototype.getAttributeNames
  Element.prototype.getAttributeNames = function() { window.__lus++; return noms.call(this) }
  window.__suivis = []
  const observe = MutationObserver.prototype.observe
  const disconnect = MutationObserver.prototype.disconnect
  MutationObserver.prototype.observe = function(n, o) { window.__suivis.push([this, n]); return observe.call(this, n, o) }
  MutationObserver.prototype.disconnect = function() { window.__suivis = window.__suivis.filter(s => s[0] !== this); return disconnect.call(this) }
})()`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

function lister(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const f of readdirSync(dir)) {
    if (statSync(join(dir, f)).isDirectory()) out.push(...lister(join(dir, f), base + f + '/'))
    else out.push(base + f)
  }
  return out
}

type Construit = { bundle: string | null, fichiers: Map<string, Buffer> }
const construits: Record<string, Promise<Construit>> = {}
function construire(appli: Appli, js: 'bundle' | 'split'): Promise<Construit> {
  construits[appli.env + js] ??= (async () => {
    const root   = mjsTmp('marquee-suivi-champs-' + appli.env + '-' + js)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(js === 'split' ? DECOUPEE : SOURCES)) writeFileSync(join(srcDir, nom), source)
    const manifeste = join(outDir, 'bundle.js')
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js }
    if (appli.env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [], appli.nom)
    const fichiers = new Map<string, Buffer>()
    for (const f of lister(outDir)) fichiers.set(f, readFileSync(join(outDir, f)))
    return { bundle: js === 'bundle' ? stripEsm(readFileSync(manifeste, 'utf-8')) : null, fichiers }
  })()
  return construits[appli.env + js]
}

describe('*marquee — les copies suivent la feuille collée avant la pose, la radio, la remise à zéro ; une mise à jour partielle (navigateurs réels)', function () {
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

      async function ouvrir(appli: Appli, js: 'bundle' | 'split') {
        const c       = await construire(appli, js)
        const page    = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        await page.addInitScript(AIDES)
        // la première copie posée avant que la carte ne soit définie (le cas d'un module qui arrive à la demande)
        if (js === 'split') await page.addInitScript(`(() => { const t = setInterval(() => { const v = window.__v && document.querySelector('mjs-vitrine') && window.__v(); const run = v && v.querySelector('.a > [mjs-fx-marquee-run]'); if (run && run.querySelector('[mjs-fx-marquee-copy]')) { window.__avantLaCarte = !customElements.get('mjs-carte'); clearInterval(t) } }, 5) })()`)
        const script = js === 'bundle' ? `<script>${c.bundle}</script>` : '<script type="module" src="/out/bundle.js"></script>'
        // (construction découpée) le module de la carte arrive en retard : la bande pose ses copies avant que la carte ne soit définie
        await page.route('http://t.test/**', async (route: any) => {
          const url = new URL(route.request().url())
          if (/\/carte-[^/]*\.js$/.test(url.pathname)) await new Promise((ok) => setTimeout(ok, 700))
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><mjs-vitrine></mjs-vitrine>${script}</body></html>` })
          const f = url.pathname.startsWith('/out/') ? c.fichiers.get(url.pathname.slice(5)) : undefined
          if (!f) return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: f })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        return { page, erreurs }
      }

      for (const appli of APPLIS) {
        it(`${appli.nom} : la feuille collée avant la première piste, la radio, la remise à zéro ; un texte changé ne relit aucun attribut ; une carte retirée de l'intérieur n'est plus observée`, async () => {
          const { page, erreurs } = await ouvrir(appli, 'bundle')
          const echecs: string[] = []
          const ok  = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
          const lit = (js: string) => page.evaluate(js)
          try {
            // 1 : la feuille est collée avant toute piste, puis la bande paraît et la carte la rejoint
            await page.waitForFunction(`window.__allumer && window.__cadre && (window.__cartes || []).length === 1`, null, { timeout: 20000 })
            await lit(`window.__retirer = window.__cadre(window.__v().querySelector('.avant'), 'rgb(0, 0, 255)')`)
            await lit('window.__allumer()')
            await page.waitForFunction(`window.__run() && window.__copies().length > 0 && (window.__cartes || []).length === 3`, null, { timeout: 20000 })
            await page.waitForTimeout(300)
            await lit(`window.__run().appendChild(window.__v().querySelector('.avant'))`)
            await page.waitForTimeout(300)
            let e = await lit(`window.__contours('avant')`)
            ok(e.original === 'solid' && e.copies.length > 0 && e.copies.every((c: string) => c === 'solid'), `la feuille collée avant la première piste gagne les copies : ${JSON.stringify(e)}`)
            await lit('window.__retirer()')
            await lit('window.__image()')
            e = await lit(`window.__contours('avant')`)
            ok(e.original === 'none' && e.copies.every((c: string) => c === 'none'), `retirée, elle quitte les copies : ${JSON.stringify(e)}`)

            // 2 : la radio choisie à la souris décoche l'autre, dans l'original et dans les copies
            const rb = await lit(`(() => { const r = window.__run().querySelector(':scope > form .rb').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
            await page.mouse.click(rb.x, rb.y)
            await lit('window.__image()')
            const ra = await lit(`window.__champ('.ra')`)
            const rbv = await lit(`window.__champ('.rb')`)
            ok(ra.original === 'false' && rbv.original === 'true', `la radio choisie dans l'original : ${JSON.stringify({ ra, rb: rbv })}`)
            ok(ra.copies.length > 0 && ra.copies.every((v: string) => v === 'false') && rbv.copies.every((v: string) => v === 'true'), `la radio décochée par une autre se reflète dans les copies : ${JSON.stringify({ ra, rb: rbv })}`)

            // la remise à zéro : par son bouton, puis par un script
            for (const [quoi, faire] of [['bouton type="reset"', 'bouton'], ['form.reset()', 'script']]) {
              await lit(`window.__run().querySelector(':scope > form .tx').focus()`)
              await page.keyboard.press('End')
              await page.keyboard.type('W')
              await lit('document.activeElement && document.activeElement.blur && document.activeElement.blur()')
              await lit('window.__image()')
              const tape = await lit(`window.__champ('.tx')`)
              ok(tape.original === 'vW' && tape.copies.every((v: string) => v === 'vW'), `${quoi} : le texte tapé gagne les copies : ${JSON.stringify(tape)}`)
              if (faire === 'bouton') {
                const rz = await lit(`(() => { const r = window.__run().querySelector(':scope > form .rz').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
                await page.mouse.click(rz.x, rz.y)
              }
              else await lit(`window.__run().querySelector(':scope > form').reset()`)
              await lit('window.__image()')
              const tx = await lit(`window.__champ('.tx')`)
              const r2 = await lit(`window.__champ('.ra')`)
              ok(tx.original === 'v' && tx.copies.every((v: string) => v === 'v') && r2.original === 'true' && r2.copies.every((v: string) => v === 'true'), `${quoi} : la remise à zéro se reflète dans les copies : ${JSON.stringify({ tx, ra: r2 })}`)
            }

            // 3 : un texte changé dans un original : seul le miroir de ce texte se met à jour, aucun attribut n'est relu
            await lit('window.__image()')
            await lit(`window.__lus = 0; window.__run().querySelector(':scope > .boite .t').firstChild.data = 'T2'`)
            await lit('window.__image()')
            const lus = await lit('window.__lus')
            const t2  = await lit(`window.__copies().map(k => k.querySelector('.boite .t').textContent)`)
            ok(t2.length > 0 && t2.every((t: string) => t === 'T2'), `le texte changé gagne les copies : ${t2.join(' ')}`)
            ok(lus === 0, `un texte changé ne relit les attributs d'aucune balise : ${lus} lectures`)

            // 4 : une carte retirée de l'intérieur d'un enfant de la piste n'est plus observée par l'effet
            const suivie = `(() => {
              const effet = new Set(window.__suivis.filter(s => s[1] === window.__run()).map(s => s[0]))
              const c3 = window.__cartes.find(c => c.classList.contains('c3'))
              return window.__suivis.some(s => effet.has(s[0]) && s[1] === window.__ombre(c3))
            })()`
            ok((await lit(suivie)) === false, 'l\'effet n\'observe pas l\'ombre de la carte imbriquée (son miroir se dessine lui-même)')
            await lit(`window.__cartes.find(c => c.classList.contains('c3')).remove()`)
            await lit('window.__image()')
            ok((await lit(suivie)) === false, 'après son retrait non plus')
            const reste = await lit(`window.__copies().map(k => k.querySelectorAll('.boite mjs-carte').length)`)
            ok(reste.every((n: number) => n === 0), `ses miroirs quittent les copies : ${reste.join(' ')}`)
            ok(erreurs.length === 0, `aucune erreur dans la page : ${erreurs.join(' | ')}`)
            assert.deepEqual(echecs, [])
          }
          finally {
            await page.context().close()
          }
        })

        it(`${appli.nom} : construction découpée, un composant dont le module arrive après les copies y devient un miroir, monté une fois`, async () => {
          const { page, erreurs } = await ouvrir(appli, 'split')
          const echecs: string[] = []
          const ok  = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
          const lit = (js: string) => page.evaluate(js)
          try {
            await page.waitForFunction(`window.__v() && window.__run() && window.__copies().length > 0 && (window.__cartes || []).length >= 2 && window.__copies().every(k => k.querySelectorAll('mjs-carte').length === 2)`, null, { timeout: 20000 })
            await page.waitForTimeout(600)
            const n = await lit(`({ avantLaCarte: window.__avantLaCarte, montages: window.__montages, miroirsMontes: window.__miroirsMontes || 0, miroirs: window.__copies().flatMap(k => [...k.querySelectorAll('mjs-carte')]).map(h => h.isMirror === true), texte: window.__copies().map(k => [...k.querySelectorAll('mjs-carte')].map(h => window.__ombre(h) ? window.__ombre(h).textContent.trim() : '?').join(',')) })`)
            ok(n.montages === 2 && n.miroirsMontes === n.miroirs.length, `deux cartes d'origine montées, et chaque miroir une fois (aucun remonté) : ${JSON.stringify(n)}`)
            ok(n.avantLaCarte === true, `les copies étaient posées avant la définition de la carte : ${JSON.stringify(n)}`)
            ok(n.miroirs.length >= 2 && n.miroirs.every(Boolean), `les cartes des copies sont des miroirs : ${JSON.stringify(n)}`)
            ok(n.texte.every((t: string) => t === '0,0'), `les copies montrent les cartes en miroir : ${JSON.stringify(n)}`)
            if (appli.env === 'dev') {
              const reg = await lit(`window.µ && window.µ.instances ? [...window.µ.instances].filter(e => e.localName === 'mjs-carte' && !e.isMirror).length : 'sans registre visible'`)
              ok(reg === 2 || reg === 'sans registre visible', `le registre compte les deux cartes d'origine, leurs miroirs à part : ${reg}`)
            }
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
