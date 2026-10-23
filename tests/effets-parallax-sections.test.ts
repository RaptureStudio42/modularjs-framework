// *parallax : l'élan (`smooth`) est une SECTION marquée du fichier. Une appli qui écrit `*parallax` avec les réglages d'avant (speed, axis, origin) embarque la
// pose sans l'élan : ni la boucle de rattrapage, ni `will-change`, ni l'écoute de l'onglet, ni `off.set`, ni les mesures qui ne servent qu'à savoir si la balise se
// voit ; celle qui écrit `smooth` (fixe, à sa valeur par défaut, tenu par une variable, sur une seule des balises de la page) l'embarque en entier. Trois gardes
// tiennent la table des témoins (les jetons des étiquettes du fichier sont ceux des pages, chaque section porte un témoin, chaque témoin part avec ses pages et
// elles seules), le module sans élan ne nomme plus rien de ce qui ne sert qu'à l'élan, puis des navigateurs réels (Chromium, Firefox) montent l'appli construite
// en production : sans `smooth`, la pose d'avant (valeurs de la formule, aucune lecture de la mise en page dans les images, retrait propre) ; avec, l'élan.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const compte = (texte: string, motif: string) => texte.split(motif).length - 1

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// la grammaire des marques, la même que celle du filtre (bundler/fx-sections.ts)
const LABEL = '[A-Za-z0-9 ._=,*-]+'
const BLOC  = new RegExp('^\\s*// @@(?: (' + LABEL + '))?\\s*$')
const FIN   = new RegExp('^(.*\\S)\\s+// @@ (' + LABEL + ')$')

type Unite = { jetons: string[], propres: string[], ligne: number }

// les sections marquées du fichier : leurs jetons et leurs lignes propres (sans celles des sections emboîtées)
function unites(src: string): Unite[] {
  const sortie: Unite[] = []
  const pile: Unite[]   = []
  src.split('\n').forEach((texte, i) => {
    const b = BLOC.exec(texte)
    if (b) {
      if (b[1]) {
        const u = { jetons: b[1].split(' '), propres: [], ligne: i + 1 }
        pile.push(u)
        sortie.push(u)
      }
      else pile.pop()
      return
    }
    const l = FIN.exec(texte)
    if (l) sortie.push({ jetons: l[2].split(' '), propres: [l[1]], ligne: i + 1 })
    else if (pile.length > 0) pile[pile.length - 1].propres.push(texte)
  })
  return sortie
}

type Page   = { source: string, jetons: string[] }
type Temoin = { texte: string, pages: string[], n?: number }

const REF   = 'rien'
const ELAN  = ['elan', 'defaut', 'variable', 'mixte']
const balise = (reglages: string) => `<div class="a" *parallax${reglages}>x</div>`

// chaque page n'écrit qu'un cas ; une seule étiquette (`smooth`)
const PAGES: Record<string, Page> = {
  [REF]:    { source: balise(''), jetons: [] },
  d_avant:  { source: balise('(0.3, axis: x, origin: page)'), jetons: [] },
  vitesse:  { source: balise('(-0.5)'), jetons: [] },
  elan:     { source: balise('(smooth: 0.1)'), jetons: ['smooth'] },
  defaut:   { source: balise('(smooth: 1)'), jetons: ['smooth'] },
  variable: { source: '<script>\n$s = 0.2\n</script>\n' + balise('(smooth: $s)'), jetons: ['smooth'] },
  mixte:    { source: balise('') + '<div class="b" *parallax(0.3, smooth: 0.05)>y</div>', jetons: ['smooth'] }
}

// des lignes du fichier, au moins une par section ; `n` : combien de fois la ligne est dans la sortie d'une page qui l'embarque (défaut 1)
const TEMOINS: Temoin[] = [
  { texte: 'var tame  = function(v) {',                                                                                            pages: ELAN },
  { texte: 'var calm  = µ._mjs_fxCalm();',                                                                                         pages: ELAN },
  { texte: 'var warm  = null;',                                                                                                    pages: ELAN },
  { texte: 'var sl    = 0;',                                                                                                       pages: ELAN },
  { texte: "el.style.setProperty('will-change', 'translate');",                                                                    pages: ELAN },
  { texte: 'var gaze = function() {',                                                                                              pages: ELAN },
  { texte: "return tamed() && near && !document.hidden && typeof requestAnimationFrame === 'function';",                          pages: ELAN },
  { texte: 'if (document.hidden && going()) jump();',                                                                              pages: ELAN },
  { texte: "µ._mjs_dom.addEventListener(document, 'visibilitychange', tab);",                                                      pages: ELAN },
  { texte: 'if (tabbed) {',                                                                                                        pages: ELAN },
  { texte: 'off.set = function(key, v) {',                                                                                         pages: ELAN },
  { texte: 'if (!box) box = tamed();',                                                                                             pages: ELAN },
  { texte: 'w: r.width, iw: innerWidth, left: r.left - (x ? cur : 0),',                                                            pages: ELAN },
  { texte: 'sx = geo.sx = window.scrollX || 0;',                                                                                   pages: ELAN },
  { texte: 'sl = geo.sl = p ? p.scrollLeft : 0;',                                                                                  pages: ELAN },
  { texte: 'sx = window.scrollX || 0;',                                                                                            pages: ELAN, n: 2 },
  { texte: 'sl = geo.p ? geo.p.scrollLeft : 0;',                                                                                   pages: ELAN },
  { texte: 'else if (!geo.box && (!page || tamed())) read();',                                                                     pages: ELAN },
  { texte: 'near  = !tamed() || gaze();',                                                                                          pages: ELAN },
  { texte: 'if (live()) f = 1 - Math.pow(1 - ease, Math.min(0.1, last ? (now - last) / 1000 : 1 / 60) * 60);',                     pages: ELAN },
  { texte: 'last = now;',                                                                                                          pages: ELAN },
  { texte: 'last = 0;',                                                                                                            pages: ELAN },
  { texte: 'hot();',                                                                                                               pages: ELAN },
  { texte: 'frame = requestAnimationFrame(tick);',                                                                               pages: ELAN },
  { texte: 'frame = 0;',                                                                                                         pages: ELAN },
  { texte: 'last  = 0;',                                                                                                         pages: ELAN, n: 2 },
  { texte: 'cool();',                                                                                                              pages: ELAN, n: 3 },
  { texte: 'follow();',                                                                                                            pages: ELAN, n: 2 },
  { texte: "if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);",                                pages: ELAN }
]

// ce qui ne sert qu'à l'élan : le module sans élan ne doit en nommer aucun
const NOMS_DE_L_ELAN = ['tame', 'ease', 'calm', 'tamed', 'last', 'near', 'warm', 'hot', 'cool', 'gaze', 'live', 'going', 'tab', 'tabbed', 'follow', 'sx', 'sl']

describe('*parallax — l\'élan est une section du fichier', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_parallax.ts'), 'utf-8')

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : rend le module du parallax et tout le JavaScript émis
  async function construire(nom: string, source: string): Promise<{ module: string, tout: string }> {
    const root   = mjsTmp('parallax-sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire     = (f: string) => readFileSync(join(outDir, f), 'utf-8')
    return { module: fichiers.filter((f) => f.startsWith('mjs_fx_parallax-')).map(lire).join('\n'), tout: fichiers.map(lire).join('\n') }
  }

  describe('le fichier et la table', () => {
    const sorties: Record<string, { module: string, tout: string }> = {}
    before(async () => {
      for (const [nom, page] of Object.entries(PAGES)) sorties[nom] = await construire(nom, page.source)
    })

    it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table', () => {
      const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].sort()
      const dansLaTable   = [...new Set(Object.values(PAGES).flatMap((p) => p.jetons))].sort()
      assert.deepEqual(dansLeFichier, dansLaTable)
      assert.deepEqual(dansLeFichier, ['smooth'])
    })

    it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
      const liste = unites(src)
      assert.ok(liste.length >= 10, 'les déclarations, les aides, la boucle, l\'onglet et le réglage en direct : au moins dix sections ou lignes marquées')
      for (const u of liste) assert.ok(TEMOINS.some((t) => u.propres.join('\n').includes(t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
      for (const t of TEMOINS) assert.ok(liste.some((u) => u.propres.join('\n').includes(t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
    })

    it('aucune marque ne sort, et chaque page porte les témoins de l\'élan si elle écrit smooth, et seulement alors', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        assert.equal(sortie.tout.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
        for (const t of TEMOINS) {
          const delta = compte(sortie.tout, t.texte) - compte(sorties[REF].tout, t.texte)
          assert.equal(delta, t.pages.includes(nom) ? (t.n ?? 1) : 0, `page « ${nom} » (${PAGES[nom].source}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
        }
      }
    })

    it('sans smooth, le module est du JavaScript valide qui ne nomme plus rien de ce qui ne sert qu\'à l\'élan', () => {
      for (const nom of [REF, 'd_avant', 'vitesse']) {
        const m = sorties[nom].module
        const noms = new Set<string>()
        for (const t of acorn.tokenizer(m, { ecmaVersion: 'latest', sourceType: 'module' })) if (t.type.label === 'name') noms.add(String(t.value))
        assert.deepEqual(NOMS_DE_L_ELAN.filter((n) => noms.has(n)), [], `${nom} : le module nomme encore des aides de l'élan`)
        acorn.parse(m, { ecmaVersion: 'latest', sourceType: 'module' })
      }
    })

    it('avec smooth, le module est du JavaScript valide et nomme toutes les aides de l\'élan, pour tous les cas écrits', () => {
      for (const nom of ELAN) {
        const m = sorties[nom].module
        acorn.parse(m, { ecmaVersion: 'latest', sourceType: 'module' })
        const noms = new Set<string>()
        for (const t of acorn.tokenizer(m, { ecmaVersion: 'latest', sourceType: 'module' })) if (t.type.label === 'name') noms.add(String(t.value))
        assert.deepEqual(NOMS_DE_L_ELAN.filter((n) => !noms.has(n)), [], `${nom} : des aides de l'élan manquent`)
      }
    })
  })

  // l'appli construite en production, ouverte dans de vrais navigateurs : la scène des tests de lectures (la page, un conteneur qui défile)
  const SCENE = (avecElan: boolean) => `<div class="page">
<div class="plan a" *parallax(0.3)>A</div>
${avecElan ? '<div class="plan b" *parallax(0.4, smooth: 0.1)>B</div>' : ''}
<div class="plan c" *parallax(0.5, origin: page)>C</div>
<div class="boite"><div class="long"><div class="plan d" *parallax(0.3)>D</div></div></div>
</div>
<style>
.page
  position: relative
  height: 3200px
.plan
  position: absolute
  left: 20px
  width: 100px
  height: 80px
  background: #357
.a
  top: 600px
.b
  top: 900px
  left: 160px
.c
  top: 1200px
  left: 300px
.boite
  position: absolute
  top: 1500px
  left: 450px
  width: 300px
  height: 300px
  overflow: auto
.long
  position: relative
  height: 1200px
.d
  top: 500px
  left: 20px
</style>
`
  const APPLIS: Record<string, string> = { defauts: SCENE(false), ecrits: SCENE(true) }
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [appli, source] of Object.entries(APPLIS)) {
      const root   = mjsTmp('parallax-sections-navigateur-' + appli)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'ps-scene.mjs'), source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      scripts[appli] = stripEsm(readFileSync(manifeste, 'utf-8'))
    }
  })

  // ce que la page compte : les lectures de mise en page faites PENDANT un rappel d'image d'animation
  const COMPTEURS = () => {
    const w = window as any
    w.__enImage  = 0
    w.__lectures = 0
    w.__detail   = {}
    const ra = w.requestAnimationFrame.bind(w)
    w.requestAnimationFrame = (f: any) => ra((t: number) => { w.__enImage++; try { return f(t) } finally { w.__enImage-- } })
    const note = (nom: string) => { if (w.__enImage > 0) { w.__lectures++; w.__detail[nom] = (w.__detail[nom] || 0) + 1 } }
    const surveille = (cible: any, nom: string) => {
      for (let o = cible; o; o = Object.getPrototypeOf(o)) {
        const d = Object.getOwnPropertyDescriptor(o, nom)
        if (!d) continue
        if (d.get) Object.defineProperty(o, nom, { ...d, get() { note(nom); return d.get!.call(this) } })
        else if (typeof d.value === 'function') Object.defineProperty(o, nom, { ...d, value: function (this: any, ...a: any[]) { note(nom); return d.value.apply(this, a) } })
        return
      }
    }
    for (const n of ['getBoundingClientRect', 'getClientRects', 'scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth', 'clientHeight', 'clientWidth', 'clientTop', 'clientLeft', 'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']) surveille(Element.prototype, n)
    for (const n of ['getComputedStyle', 'scrollY', 'scrollX', 'pageYOffset', 'pageXOffset', 'innerHeight', 'innerWidth']) surveille(w, n)
  }

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox']) as Array<'chromium' | 'firefox'>) {
    describe(nom + ' — l\'appli construite en production', function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { await browser?.close() })

      async function avec<T>(appli: string, fn: (page: any, erreurs: string[]) => Promise<T>): Promise<T> {
        const page    = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        try {
          await page.addInitScript(COMPTEURS)
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-ps-scene></mjs-ps-scene><script>${scripts[appli]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.addScriptTag({ content: `window.__racine = () => { const el = document.querySelector('mjs-ps-scene'); if (el.shadowRoot) return el.shadowRoot; for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]; return el }` })
          await page.waitForFunction(() => !!(window as any).__racine()?.querySelector?.('.plan.d')?.style.getPropertyValue('--mjs-fx-parallax-y'), null, { timeout: 20000 })
          await page.waitForTimeout(300)
          return await fn(page, erreurs)
        }
        finally {
          await page.close()
        }
      }

      const defile = async (page: any, y: number, haut?: number) => {
        await page.evaluate(([y, haut]: [number, number | undefined]) => {
          window.scrollTo(0, y)
          if (haut !== undefined) (window as any).__racine().querySelector('.boite').scrollTop = haut
        }, [y, haut])
        await page.waitForTimeout(260)
      }
      const valeur = (page: any, c: string): Promise<number> => page.evaluate((c: string) => parseFloat((window as any).__racine().querySelector('.' + c).style.getPropertyValue('--mjs-fx-parallax-y')), c)

      for (const appli of ['defauts', 'ecrits']) {
        it(`${appli} : la page et un conteneur défilent : zéro lecture de la mise en page pendant les images d'animation`, async () => {
          await avec(appli, async (page, erreurs) => {
            await page.evaluate(() => { (window as any).__lectures = 0; (window as any).__detail = {} })
            for (const y of [150, 420, 800, 1100, 1500, 1900, 1300]) await defile(page, y)
            for (const h of [120, 400, 250]) await defile(page, 1500, h)
            await page.waitForTimeout(1800)
            const r = await page.evaluate(() => ({ n: (window as any).__lectures, detail: (window as any).__detail }))
            assert.equal(r.n, 0, `lectures de la mise en page dans les rappels d'image : ${JSON.stringify(r.detail)}`)
            assert.deepEqual(erreurs, [])
          })
        })

        it(`${appli} : les valeurs écrites sont celles de la formule du réglage, lue sur la page vivante`, async () => {
          await avec(appli, async (page) => {
            await defile(page, 1500, 300)
            await page.waitForTimeout(1800)
            const r = await page.evaluate(() => {
              const sh  = (window as any).__racine()
              const lu  = (c: string) => { const el = sh.querySelector('.' + c); return el ? parseFloat(el.style.getPropertyValue('--mjs-fx-parallax-y')) : NaN }
              const box = (c: string) => sh.querySelector('.' + c).getBoundingClientRect()
              const mid = innerHeight / 2
              const pb  = sh.querySelector('.boite').getBoundingClientRect()
              const att = (c: string, k: number, milieu: number) => { const b = box(c); return (milieu - ((b.top - lu(c)) + b.height / 2)) * k }
              return {
                a: [lu('a'), att('a', 0.3, mid)],
                c: [lu('c'), scrollY * 0.5],
                d: [lu('d'), att('d', 0.3, pb.top + sh.querySelector('.boite').clientTop + sh.querySelector('.boite').clientHeight / 2)],
                ...(sh.querySelector('.b') ? { b: [lu('b'), att('b', 0.4, mid)] } : {})
              }
            })
            for (const [c, [valeurEcrite, attendu]] of Object.entries(r) as [string, number[]][]) {
              assert.ok(Math.abs(valeurEcrite - attendu) < 0.25, `balise ${c} : écrit ${valeurEcrite}, formule ${attendu.toFixed(2)}`)
            }
            assert.ok(Math.abs(r.a[0]) > 20 && Math.abs(r.d[0]) > 5, 'les balises ont bien bougé')
          })
        })

        it(`${appli} : le retrait va jusqu'au bout (les variables sont rendues) sans rien lever, puis la page défile sans erreur`, async () => {
          await avec(appli, async (page, erreurs) => {
            await defile(page, 900)
            const avant = await page.evaluate(() => {
              const w = window as any
              w.__plans = [...w.__racine().querySelectorAll('.plan')]
              return w.__plans.map((el: any) => el.style.getPropertyValue('--mjs-fx-parallax-y'))
            })
            assert.ok(avant.every((v: string) => v !== ''), `les balises sont posées : ${avant.join(' ')}`)
            await page.evaluate(() => { document.querySelector('mjs-ps-scene')!.remove() })
            await page.waitForTimeout(200)
            const apres = await page.evaluate(() => (window as any).__plans.map((el: any) => el.style.getPropertyValue('--mjs-fx-parallax-y')))
            assert.deepEqual(apres, avant.map(() => ''), 'le retrait rend la variable de chaque balise')
            await defile(page, 300)
            await defile(page, 1200)
            assert.deepEqual(erreurs, [])
          })
        })
      }

      it('ecrits : la balise à élan prend du retard sur celle qui n\'en a pas, `will-change` ne se pose que le temps du mouvement, et elle finit sur la formule', async () => {
        await avec('ecrits', async (page, erreurs) => {
          // un premier défilement remet les valeurs à la formule (à la pose la feuille de style n'est peut-être pas encore posée)
          const repos = () => page.waitForFunction(() => getComputedStyle((window as any).__racine().querySelector('.b')).willChange === 'auto', null, { timeout: 30000 })
          await defile(page, 40)
          await defile(page, 0)
          await repos()
          const b0 = await valeur(page, 'b')
          const a0 = await valeur(page, 'a')
          await page.evaluate(() => window.scrollTo(0, 900))
          await page.waitForTimeout(120)
          const a1 = await valeur(page, 'a')
          const b1 = await valeur(page, 'b')
          const w1 = await page.evaluate(() => getComputedStyle((window as any).__racine().querySelector('.b')).willChange)
          assert.ok(Math.abs((a1 - a0) - 900 * 0.3) < 0.25, `la balise sans élan est collée au défilement : ${a1 - a0}`)
          assert.ok(Math.abs(b1 - b0) < 900 * 0.4 * 0.9, `la balise à élan est en retard : ${b1 - b0} sur ${900 * 0.4}`)
          assert.equal(w1, 'translate', 'will-change pendant le mouvement')
          // le rattrapage s'arrête de lui-même : `will-change` est rendu (la machine est chargée, aucun délai fixe)
          await repos()
          const b2 = await valeur(page, 'b')
          assert.ok(Math.abs((b2 - b0) - 900 * 0.4) < 0.25, `elle finit sur la cible : ${b2 - b0}`)
          assert.equal(await page.evaluate(() => getComputedStyle((window as any).__racine().querySelector('.b')).willChange), 'auto', 'will-change rendu au repos')
          assert.deepEqual(erreurs, [])
        })
      })
    })
  }
})
