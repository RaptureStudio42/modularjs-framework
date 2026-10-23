// *tilt : le rebond (`bounce`) et l'attente (`wait`) sont des SECTIONS marquées du fichier (tri de la production, bundler/fx-sections.ts).
// Une appli qui écrit `*tilt` comme dans la V3 (max, scale, perspective, direction, glare, duration, depth, slide) n'embarque rien de plus qu'avant :
// ni le ressort du rebond, ni la lecture de la boîte à plat d'une carte qui revient, qui n'a de raison d'être qu'avec `wait` (c'est lui qui laisse la
// carte inclinée jusqu'à 1,65 s : l'attente, puis le retour). Trois gardes tiennent la table des témoins (les jetons des étiquettes du fichier sont ceux
// des pages, chaque section porte un témoin, chaque témoin part avec ses pages et elles seules), puis un navigateur réel (Chromium, ou Firefox ou
// WebKit avec NAVIGATEUR) monte l'appli construite en production, réduite : avec `wait`, une ré-entrée pendant l'attente ou le retour mesure la carte
// sur sa boîte à plat d'aujourd'hui (angle nul au centre, même si la page a défilé, un conteneur aussi, ou la mise en page glissé) et le suivi reprend
// aussitôt, de l'angle d'alors, même pile au centre avec `scale: 1` ; sans `wait`, la boîte se lit à chaque entrée, comme dans la V3.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const compte = (texte: string, motif: string) => texte.split(motif).length - 1

// le navigateur essayé : Chromium, ou Firefox ou WebKit avec NAVIGATEUR=firefox ou NAVIGATEUR=webkit
const NAVIGATEUR = process.env.NAVIGATEUR === 'firefox' ? 'firefox' : process.env.NAVIGATEUR === 'webkit' ? 'webkit' : 'chromium'

async function navigateurPresent(): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright[NAVIGATEUR].executablePath())
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

const REF     = 'rien'
const ATTENTE = ['attente', 'zero', 'variable', 'les_deux', 'une_sur_deux']
const REBOND  = ['rebond', 'rebond_var', 'les_deux']

// chaque page n'écrit qu'un cas ; deux étiquettes (`bounce`, `wait`)
const PAGES: Record<string, Page> = {
  [REF]:        { source: '<div class="a" *tilt>x</div>', jetons: [] },
  v3:           { source: '<div class="a" *tilt(max: 14, scale: 1.05, perspective: 600, direction: away, glare: true, duration: 300ms, depth: 20, slide: true)>x</div>', jetons: [] },
  duree:        { source: '<div class="a" *tilt(duration: 2000ms)>x</div>', jetons: [] },
  suivi:        { source: '<div class="a" *tilt(follow: 250ms)>x</div>', jetons: [] },
  rebond:       { source: '<div class="a" *tilt(bounce: 0.3)>x</div>', jetons: ['bounce'] },
  rebond_var:   { source: '<script>\n$b = 0.3\n</script>\n<div class="a" *tilt(bounce: $b)>x</div>', jetons: ['bounce'] },
  attente:      { source: '<div class="a" *tilt(wait: 650ms)>x</div>', jetons: ['wait'] },
  zero:         { source: '<div class="a" *tilt(wait: 0)>x</div>', jetons: ['wait'] },
  variable:     { source: '<script>\n$w = \'650ms\'\n</script>\n<div class="a" *tilt(wait: $w)>x</div>', jetons: ['wait'] },
  les_deux:     { source: '<div class="a" *tilt(wait: 650ms, bounce: 0.28)>x</div>', jetons: ['wait', 'bounce'] },
  une_sur_deux: { source: '<div class="a" *tilt>x</div><div class="b" *tilt(wait: 650ms)>y</div>', jetons: ['wait'] }
}

// des lignes du fichier, une par section et plus (le texte tel qu'il sort du filtre : sans la marque de fin de ligne)
const TEMOINS: Temoin[] = [
  { texte: 'var _mjsTiltSpring = function(b) {',                                    pages: REBOND },
  { texte: 'var bounce = function(v) {',                                            pages: REBOND },
  { texte: 'bounce(+s.bounce || 0);',                                               pages: REBOND },
  { texte: "el.style.removeProperty('--mjs-tilt-ease');",                           pages: REBOND, n: 2 },
  { texte: "else if (k === 'bounce') bounce(+v || 0);",                             pages: REBOND },
  { texte: 'var returning = function() {',                                          pages: ATTENTE },
  { texte: "return a.some(function(x) { return x.transitionProperty === 'transform'; });", pages: ATTENTE },
  { texte: 'var flatBox = function() {',                                            pages: ATTENTE },
  { texte: 'getComputedStyle(el).transform;',                             pages: ATTENTE },
  { texte: "el.style.setProperty('transition', 'all 0s', 'important');",            pages: ATTENTE },
  { texte: 'el.style.transform = was;',                                             pages: ATTENTE },
  { texte: "el.style.removeProperty('transition');",                                pages: ATTENTE },
  { texte: 'names.map(function(n) {',                                               pages: ATTENTE },
  { texte: 'if (!box && returning()) box = flatBox();',                             pages: ATTENTE }
]

// la lecture de la boîte à chaque entrée, celle de la V3 : sur toutes les pages, une fois, sous aucune condition
const LECTURE_V3 = 'if (!box) box = µ._mjs_dom.getBoundingClientRect(el);'

describe('*tilt — le rebond et l\'attente sont des sections du fichier', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_tilt.ts'), 'utf-8')

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : rend le module de l'effet et tout le JavaScript émis
  async function construire(nom: string, source: string): Promise<{ module: string, tout: string }> {
    const root   = mjsTmp('tilt-sections-' + nom)
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
    return { module: fichiers.filter((f) => f.startsWith('mjs_fx_tilt-')).map(lire).join('\n'), tout: fichiers.map(lire).join('\n') }
  }

  describe('le fichier et la table', () => {
    const sorties: Record<string, { module: string, tout: string }> = {}
    before(async () => {
      for (const [nom, page] of Object.entries(PAGES)) sorties[nom] = await construire(nom, page.source)
    })

    it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table : bounce et wait', () => {
      const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].sort()
      const dansLaTable   = [...new Set(Object.values(PAGES).flatMap((p) => p.jetons))].sort()
      assert.deepEqual(dansLeFichier, dansLaTable)
      assert.deepEqual(dansLeFichier, ['bounce', 'wait'])
    })

    it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
      const liste = unites(src)
      assert.ok(liste.length >= 6, 'le ressort, sa pose, son retrait, sa mise à jour, la lecture de la boîte à plat (ses deux fonctions, son appel)')
      for (const u of liste) assert.ok(TEMOINS.some((t) => u.propres.join('\n').includes(t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
      for (const t of TEMOINS) assert.ok(liste.some((u) => u.propres.join('\n').includes(t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
    })

    it('aucune marque ne sort, et chaque page porte les témoins de ses réglages écrits, et seulement eux', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        assert.equal(sortie.tout.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
        for (const t of TEMOINS) {
          const delta = compte(sortie.tout, t.texte) - compte(sorties[REF].tout, t.texte)
          assert.equal(delta, t.pages.includes(nom) ? (t.n ?? 1) : 0, `page « ${nom} » (${PAGES[nom].source}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
        }
      }
    })

    it('la boîte se lit à chaque entrée comme dans la V3 : cette ligne part sur toutes les pages, une fois, sans condition', () => {
      for (const [nom, sortie] of Object.entries(sorties)) assert.equal(compte(sortie.module, LECTURE_V3), 1, `page « ${nom} » : la lecture de la V3`)
    })

    it('sans wait, le module ne garde rien de la lecture de la boîte à plat, avec ou sans rebond ; avec wait il est valide', () => {
      const code = (m: string) => m.replace(/^\s*\/\/.*$/gm, '')
      for (const [nom, sortie] of Object.entries(sorties)) {
        acorn.parse(sortie.module.replace(/^import .*$/m, ''), { ecmaVersion: 'latest', sourceType: 'module' })
        if (ATTENTE.includes(nom)) continue
        for (const mot of ['getAnimations', 'transitionProperty', 'getComputedStyle', 'flatBox', 'returning', 'getPropertyPriority']) {
          assert.equal(new RegExp('\\b' + mot + '\\b').test(code(sortie.module)), false, `page « ${nom} » : « ${mot} » reste dans le module`)
        }
      }
    })
  })

  // l'appli construite en production (réduite, un seul fichier), ouverte dans un vrai navigateur
  const STYLE = '<style>\n.t\n  width: 200px\n  height: 120px\n  margin: 30px\n  background: #234\n  color: #fff\n</style>'
  // la carte de 200 × 120 px, avec de quoi la déplacer de 60 px : la page à défiler (.espace), un conteneur qui défile (.zone), un bloc au-dessus qui grandit (.haut)
  const STYLE_DECALE = '<style>\n.t\n  width: 200px\n  height: 120px\n  margin: 100px 30px\n  background: #234\n  color: #fff\n.espace\n  height: 3000px\n.zone\n  height: 300px\n  overflow: auto\n.haut\n  height: 30px\n</style>'
  // la carte dont l'auteur déclenche une transition d'opacité (la classe `p`)
  const STYLE_OPACITE = STYLE.replace('</style>', '.t.p\n  opacity: .4\n</style>')
  const APPLIS: Record<string, Record<string, string>> = {
    attente: {
      't-attente': `<div class="t" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`,
      't-centre':  `<div class="t" *tilt(max: 20, scale: 1, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`
    },
    decale: {
      't-page': `<div class="t" *tilt(max: 20, duration: 2500ms, wait: 1500ms)>Carte</div>\n<div class="espace"></div>\n${STYLE_DECALE}`,
      't-zone': `<div class="zone">\n<div class="t" *tilt(max: 20, duration: 2500ms, wait: 1500ms)>Carte</div>\n<div class="espace"></div>\n</div>\n${STYLE_DECALE}`,
      't-haut': `<div class="haut"></div>\n<div class="t" *tilt(max: 20, duration: 2500ms, wait: 1500ms)>Carte</div>\n${STYLE_DECALE}`
    },
    // une carte dont l'auteur anime aussi l'ombre (sa règle, plus précise que celles de l'effet, liste les deux propriétés dans tous les états) ;
    // avec wait : c'est lui qui embarque la lecture à plat, sans lui l'appli ne la contient pas et le test ne prouverait rien
    ombre: {
      't-ombre': `<div class="t" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n<style>\n.t\n  width: 200px\n  height: 120px\n  margin: 30px\n  background: #234\n  color: #fff\n.t.t.t\n  transition: transform 800ms, box-shadow 3s\n.t.ombre\n  box-shadow: 0 0 40px #f00\n</style>`
    },
    // le style en ligne de l'auteur : le raccourci `transition`, des propriétés séparées entre d'autres déclarations, une priorité `!important`, aucun style
    auteur: {
      't-court':     `<div class="t" style="transition: transform 1.3s ease 0s, box-shadow 2s" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`,
      't-separees':  `<div class="t" style="opacity: .9; transition-duration: 1.3s; transition-property: transform; color: #eee" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`,
      't-important': `<div class="t" style="transition: transform 1.3s ease 0s !important" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`,
      't-comportement': `<div class="t" style="transition: transform 1.3s, opacity 2s; transition-behavior: allow-discrete" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE_OPACITE}`,
      't-rien':      `<div class="t" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`
    },
    // un raccourci `transition` à deux propriétés suivi d'un champ plus court (le retard, la durée ou la courbe), et d'autres raccourcis à listes de longueurs différentes
    retard: {
      't-delai':  `<div class="t" style="transition: transform 1.3s, opacity 2s; transition-delay: 1s" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE_OPACITE}`,
      't-duree':  `<div class="t" style="transition: transform 1.3s, opacity 2s; transition-duration: 3s" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE_OPACITE}`,
      't-var':    `<div class="t" style="transition: transform var(--d, 1.3s), opacity var(--o, 2s)" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE_OPACITE}`,
      't-listes': `<div class="t" style="transition: transform 1.3s, opacity 2s; transition-timing-function: linear; animation: a 1s, b 2s; animation-duration: 3s; background: linear-gradient(#123, #456), linear-gradient(#789, #abc); background-size: 10px; --auteur: 7" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE_OPACITE}`
    },
    // la feuille de l'auteur : une transition de `transform` marquée `!important` (avec son délai), plus précise que les règles de l'effet
    feuille: {
      't-feuille': `<div class="t" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n<style>\n.t\n  width: 200px\n  height: 120px\n  margin: 30px\n  background: #234\n  color: #fff\n.t.t.t\n  transition: transform 800ms ease 1500ms !important\n</style>`
    },
    v3: {
      't-v3': `<div class="t" *tilt(max: 20, duration: 800ms)>Carte</div>\n${STYLE}`
    }
  }
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [appli, composants] of Object.entries(APPLIS)) {
      const root   = mjsTmp('tilt-sections-navigateur-' + appli)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, source] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      scripts[appli] = stripEsm(readFileSync(manifeste, 'utf-8'))
    }
  })

  describe(`${NAVIGATEUR} — l'appli construite en production`, function () {
    let present = false

    before(async function () {
      present = await navigateurPresent()
      if (!present) console.log(`  ℹ️  ${NAVIGATEUR} non installé, test sauté. Activer : \`npx playwright install ${NAVIGATEUR}\``)
    })

    async function ouvrir(browser: any, appli: string, tag: string) {
      const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
      const erreurs: string[] = []
      await page.addInitScript(() => {
        const w = window as any
        w.__racine = (t: string) => {
          const el: any = document.querySelector(t)
          if (!el) return null
          if (el.shadowRoot) return el.shadowRoot
          for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
          return el
        }
        w.__carte = (t: string) => w.__racine(t).querySelector('.t')
        w.__angles = (t: string) => {
          const el = w.__carte(t)
          const m = new DOMMatrix(getComputedStyle(el).transform)
          return { rx: parseFloat(el.style.getPropertyValue('--mjs-fx-tilt-rx')), ry: parseFloat(el.style.getPropertyValue('--mjs-fx-tilt-ry')), vu: Math.atan2(-m.m13, m.m11) * 180 / Math.PI, vx: Math.atan2(m.m23, m.m33) * 180 / Math.PI }
        }
      })
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${scripts[appli]}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(window as any).__racine(t)?.querySelector('.t'), tag, { timeout: 20000 })
      await page.waitForTimeout(300)
      return { page, erreurs }
    }

    const plate = (page: any, tag: string) => page.evaluate((t: string) => { const b = (window as any).__carte(t).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }, tag)

    // la carte s'incline par le bord gauche, le pointeur sort, la carte revient ; le pointeur reprend la carte 0,3 s plus tard (retour ou attente en cours)
    async function incline(page: any, tag: string) {
      const plat = await plate(page, tag)
      await page.mouse.move(2, 2)
      await page.waitForTimeout(200)
      await page.mouse.move(plat.x + 10, plat.y + plat.h / 2)
      await page.mouse.move(plat.x + 20, plat.y + plat.h / 2)
      // la carte a fini de suivre le pointeur avant qu'il parte
      await page.waitForFunction((t: string) => Math.abs((window as any).__angles(t).vu) > 15, tag, { timeout: 10000 })
      await page.mouse.move(2, 2)
      await page.waitForTimeout(300)
      return plat
    }

    it('avec wait : une ré-entrée pendant l\'attente mesure la carte sur sa boîte à plat — au centre l\'angle est nul, à 90 % de la largeur il vaut le réglage', async function () {
      if (!present) { this.skip(); return }
      const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
      try {
        const { page, erreurs } = await ouvrir(browser, 'attente', 'mjs-t-attente')
        const plat = await incline(page, 'mjs-t-attente')
        for (const [part, attendu] of [[0.5, 0], [0.9, -16]] as const) {
          await page.mouse.move(plat.x + plat.w * part, plat.y + plat.h / 2)
          // l'angle posé vient de la boîte à plat ; l'angle vu le rejoint à la fin du suivi
          const pose = await page.evaluate((t: string) => (window as any).__angles(t).ry, 'mjs-t-attente')
          assert.ok(Math.abs(pose - attendu) < 0.05, `à ${part * 100} % : ry ${pose} pour ${attendu}`)
          const rejoint = await page.waitForFunction(([t, e]: [string, number]) => Math.abs((window as any).__angles(t).vu - e) < 0.2, ['mjs-t-attente', attendu], { timeout: 5000 }).then(() => true, () => false)
          const a = await page.evaluate((t: string) => (window as any).__angles(t), 'mjs-t-attente')
          console.log(`appli de production, ré-entrée à ${part * 100} % : angle posé ${a.ry.toFixed(2)}° (attendu ${attendu}°), vu ${a.vu.toFixed(2)}°`)
          assert.ok(rejoint, `à ${part * 100} % : l'angle vu ${a.vu.toFixed(2)} pour ${attendu}`)
        }
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('avec wait : une ré-entrée pile au centre avec scale: 1 relance le suivi — la carte rejoint le pointeur dans la seconde, sans attendre la fin du délai', async function () {
      if (!present) { this.skip(); return }
      const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
      try {
        const { page, erreurs } = await ouvrir(browser, 'attente', 'mjs-t-centre')
        const plat = await incline(page, 'mjs-t-centre')
        await page.mouse.move(plat.x + plat.w / 2, plat.y + plat.h / 2)
        const rejoint = await page.waitForFunction(() => Math.abs((window as any).__angles('mjs-t-centre').vu) < 0.1, null, { timeout: 1000 }).then(() => true, () => false)
        const a = await page.evaluate((t: string) => (window as any).__angles(t), 'mjs-t-centre')
        console.log(`appli de production, pile au centre, scale 1 : angle posé ${a.ry.toFixed(2)}°, vu ${a.vu.toFixed(2)}°, rejoint ${rejoint}`)
        assert.equal(a.ry, 0)
        assert.ok(rejoint, `la carte est encore inclinée (${a.vu.toFixed(2)}°) une seconde après la ré-entrée`)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // la place de la carte change de 60 px pendant qu'elle attend (1,5 s) ou revient (2,5 s) : la page défile, le conteneur qui la porte défile, ou un bloc
    // au-dessus change de hauteur. Le pointeur revient alors au NOUVEAU centre de la carte : sa boîte est celle d'aujourd'hui, non celle de sa dernière
    // entrée à plat (60 px plus haut ou plus bas : le pointeur y serait au bord, à ±20° au lieu de 0°)
    const DECALAGES: Record<string, { tag: string, dy: number, pose: (page: any, tag: string) => Promise<unknown> }> = {
      'la page défile': { tag: 'mjs-t-page', dy: -60, pose: (page) => page.evaluate(() => scrollTo(0, 60)) },
      'le conteneur qui porte la carte défile': { tag: 'mjs-t-zone', dy: -60, pose: (page, tag) => page.evaluate((t: string) => { (window as any).__racine(t).querySelector('.zone').scrollTop = 60 }, tag) },
      'un bloc au-dessus change de hauteur': { tag: 'mjs-t-haut', dy: 60, pose: (page, tag) => page.evaluate((t: string) => { (window as any).__racine(t).querySelector('.haut').style.height = '90px' }, tag) }
    }
    for (const [quoi, d] of Object.entries(DECALAGES)) {
      for (const moment of ['attente', 'retour'] as const) {
        it(`avec wait : ${quoi} pendant ${moment === 'attente' ? 'l\'attente' : 'le retour'}, puis ré-entrée au nouveau centre — l'angle est nul, à 90 % de la largeur il vaut le réglage`, async function () {
          if (!present) { this.skip(); return }
          const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
          try {
            const { page, erreurs } = await ouvrir(browser, 'decale', d.tag)
            const plat = await incline(page, d.tag)
            // le retour commence après 1,5 s d'attente : 1,5 s de plus et la carte est à mi-chemin du début de son retour
            if (moment === 'retour') await page.waitForTimeout(1500)
            await d.pose(page, d.tag)
            await page.waitForTimeout(50)
            const cy = plat.y + d.dy + plat.h / 2
            for (const [part, attendu] of [[0.5, 0], [0.9, -16]] as const) {
              await page.mouse.move(plat.x + plat.w * part, cy)
              const a = await page.evaluate((t: string) => (window as any).__angles(t), d.tag)
              console.log(`${quoi}, ${moment}, ré-entrée à ${part * 100} % : rx ${a.rx.toFixed(2)}° ry ${a.ry.toFixed(2)}° (attendu 0° et ${attendu}°)`)
              assert.ok(Math.abs(a.rx) < 0.05, `à ${part * 100} % : rx ${a.rx} pour 0`)
              assert.ok(Math.abs(a.ry - attendu) < 0.05, `à ${part * 100} % : ry ${a.ry} pour ${attendu}`)
              const rejoint = await page.waitForFunction(([t, e]: [string, number]) => { const v = (window as any).__angles(t); return Math.abs(v.vu - e) < 0.2 && Math.abs(v.vx) < 0.2 }, [d.tag, attendu], { timeout: 5000 }).then(() => true, () => false)
              const v = await page.evaluate((t: string) => (window as any).__angles(t), d.tag)
              assert.ok(rejoint, `à ${part * 100} % : l'angle vu ${v.vu.toFixed(2)}° (X ${v.vx.toFixed(2)}°) pour ${attendu}°`)
            }
            assert.deepEqual(erreurs, [])
          } finally {
            await browser.close()
          }
        })
      }
    }

    it('avec wait : la ré-entrée repart de l\'angle où la carte était — la transition de suivi naît à cet angle, jamais à plat', async function () {
      if (!present) { this.skip(); return }
      const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
      try {
        const { page, erreurs } = await ouvrir(browser, 'attente', 'mjs-t-attente')
        const plat = await incline(page, 'mjs-t-attente')
        // l'angle de départ de chaque transition de `transform` qui naît à la ré-entrée : sa première image clé, que le navigateur a figée à sa naissance
        // (lue par ses images clés, pas par ce qu'on voit : un fil principal chargé retarde l'événement de quelques images)
        await page.evaluate(() => {
          const w = window as any
          const el = w.__carte('mjs-t-attente')
          w.__departs = []
          el.addEventListener('transitionrun', (e: any) => {
            const a = el.getAnimations().find((x: any) => x.transitionProperty === 'transform')
            if (e.propertyName !== 'transform' || !a) return
            const m = new DOMMatrix(String(a.effect.getKeyframes()[0].transform))
            w.__departs.push(Math.atan2(-m.m13, m.m11) * 180 / Math.PI)
          })
        })
        const avant = (await page.evaluate(() => (window as any).__angles('mjs-t-attente'))).vu
        await page.mouse.move(plat.x + plat.w / 2, plat.y + plat.h / 2)
        await page.waitForFunction(() => (window as any).__departs.length > 0, null, { timeout: 5000 })
        const departs = await page.evaluate(() => (window as any).__departs as number[])
        console.log(`départ du suivi : ${departs[0].toFixed(2)}° pour une carte à ${avant.toFixed(2)}°`)
        assert.ok(Math.abs(avant) > 15, 'inclinée : ' + avant)
        assert.ok(Math.abs(departs[0] - avant) < 0.5, `la transition de suivi part de ${departs[0].toFixed(2)}° pour une carte à ${avant.toFixed(2)}°`)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('avec wait : la carte revenue à plat se lit comme dans la V3 — l\'entrée ne pose ni transition ni transform en ligne, et ne laisse rien après elle', async function () {
      if (!present) { this.skip(); return }
      const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
      try {
        const { page, erreurs } = await ouvrir(browser, 'attente', 'mjs-t-attente')
        const plat = await plate(page, 'mjs-t-attente')
        // tout ce que l'attribut `style` a été pendant l'entrée : l'ancienne valeur de chaque écriture
        await page.evaluate(() => {
          const w = window as any
          w.__styles = []
          new MutationObserver((rs) => rs.forEach((r) => w.__styles.push(String(r.oldValue)))).observe(w.__carte('mjs-t-attente'), { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
        })
        await page.mouse.move(2, 2)
        await page.mouse.move(plat.x + plat.w / 2, plat.y + plat.h / 2)
        await page.waitForTimeout(300)
        const vu = await page.evaluate(() => ({ styles: (window as any).__styles as string[], reste: (window as any).__carte('mjs-t-attente').getAttribute('style') as string }))
        assert.ok(vu.styles.some((v) => /--mjs-fx-tilt-ry/.test(v)) || /--mjs-fx-tilt-ry/.test(vu.reste), 'la carte a bien suivi le pointeur')
        assert.ok(!vu.styles.concat(vu.reste).some((v) => /transition|transform/.test(v.replace(/--mjs-[a-z-]*/g, ''))), 'rien posé en ligne : ' + JSON.stringify(vu))
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('avec wait : la lecture à plat ne laisse rien en ligne et une transition d\'une autre propriété continue — la même, sans reprise', async function () {
      if (!present) { this.skip(); return }
      const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
      try {
        const { page, erreurs } = await ouvrir(browser, 'ombre', 'mjs-t-ombre')
        const plat = await incline(page, 'mjs-t-ombre')
        // l'ombre s'anime (3 s) pendant que la carte revient (0,8 s) ; le pointeur revient au centre
        const avant = await page.evaluate(async () => {
          const w = window as any
          const el = w.__carte('mjs-t-ombre')
          el.classList.add('ombre')
          await new Promise((ok) => setTimeout(ok, 60))
          w.__ombre = el.getAnimations().find((a: any) => a.transitionProperty === 'box-shadow')
          return { ombre: !!w.__ombre, retour: el.getAnimations().some((a: any) => a.transitionProperty === 'transform'), temps: w.__ombre ? w.__ombre.currentTime : -1 }
        })
        assert.ok(avant.ombre, 'une transition d\'ombre court')
        assert.ok(avant.retour, 'la carte revient encore : la lecture à plat a lieu')
        await page.mouse.move(plat.x + plat.w / 2, plat.y + plat.h / 2)
        const apres = await page.evaluate(() => {
          const w = window as any
          const el = w.__carte('mjs-t-ombre')
          return { vivante: el.getAnimations().includes(w.__ombre), etat: w.__ombre.playState, temps: w.__ombre.currentTime, transition: el.style.transition, transform: el.style.transform, ry: w.__angles('mjs-t-ombre').ry }
        })
        console.log(`transition d'ombre : ${avant.temps} ms avant, ${apres.temps} ms après (${apres.etat}), angle posé ${apres.ry}°`)
        assert.ok(Math.abs(apres.ry) < 0.05, `la boîte est bien lue à plat : au centre l'angle posé est nul (${apres.ry}°)`)
        assert.ok(apres.vivante && apres.etat === 'running', `la transition d'ombre a été interrompue (${apres.etat})`)
        assert.ok(apres.temps >= avant.temps, 'et elle n\'est pas repartie de zéro')
        assert.equal(apres.transition, '', 'aucune transition en ligne après la lecture')
        assert.equal(apres.transform, '', 'aucun transform en ligne après la lecture')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // la lecture à plat pose `transition` et `transform` en ligne le temps d'une lecture : l'attribut `style` de l'auteur doit en sortir tel qu'il y est entré,
    // quelle que soit sa forme (le raccourci, des propriétés séparées entre d'autres déclarations, une priorité `!important`, rien)
    // chaque déclaration en ligne, sans les variables que le suivi écrit : sa valeur et sa priorité. Le CSSOM n'a qu'une valeur par propriété : l'ordre entre
    // propriétés différentes n'a pas de sens pour le navigateur (Chromium et WebKit rangent d'ailleurs toujours les `!important` en dernier), il n'est pas exigé
    const enLigne = (page: any, tag: string) => page.evaluate((t: string) => {
      const w = window as any
      const el = w.__carte(t)
      const decl: Record<string, string> = {}
      for (let i = 0; i < el.style.length; i++) {
        const p = el.style[i]
        if (!/^--mjs-fx-tilt-/.test(p)) decl[p] = el.style.getPropertyValue(p) + ' | ' + el.style.getPropertyPriority(p)
      }
      return { decl, retour: el.getAnimations().some((a: any) => a.transitionProperty === 'transform'), ry: w.__angles(t).ry }
    }, tag)
    const AUTEUR: Record<string, string> = {
      'le raccourci':                             'mjs-t-court',
      'des propriétés séparées entre d\'autres':  'mjs-t-separees',
      'la priorité !important':                   'mjs-t-important',
      'transition-behavior: allow-discrete':      'mjs-t-comportement',
      'aucun style':                              'mjs-t-rien'
    }
    for (const [quoi, tag] of Object.entries(AUTEUR)) {
      it(`avec wait : la lecture à plat rend le style en ligne de l'auteur tel qu'il était — ${quoi}`, async function () {
        if (!present) { this.skip(); return }
        const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
        try {
          const { page, erreurs } = await ouvrir(browser, 'auteur', tag)
          const plat = await incline(page, tag)
          const lire = () => enLigne(page, tag)
          const avant = await lire()
          assert.ok(avant.retour, 'la carte revient encore : la lecture à plat a lieu')
          await page.mouse.move(plat.x + plat.w / 2, plat.y + plat.h / 2)
          const apres = await lire()
          console.log(`${quoi} : ${Object.keys(avant.decl).length} déclarations en ligne avant, ${Object.keys(apres.decl).length} après, angle posé ${apres.ry}°`)
          assert.ok(Math.abs(apres.ry) < 0.05, `la boîte est bien lue à plat : au centre l'angle posé est nul (${apres.ry}°)`)
          assert.deepEqual(apres.decl, avant.decl)
          assert.deepEqual(erreurs, [])
        } finally {
          await browser.close()
        }
      })
    }

    // l'auteur anime lui-même `transform` en ligne, avec ou sans priorité `!important` : la carte revient encore quand le pointeur rentre, la lecture à plat pose son
    // propre `transform` le temps d'une lecture, puis rend celui de l'auteur avec sa valeur et sa priorité. Jugé sur ce que l'auteur retrouve, pas sur le code de la lecture
    for (const [quoi, priorite] of [['sans priorité', ''], ['avec !important', 'important']]) {
      it(`avec wait : la lecture à plat rend le transform en ligne de l'auteur, valeur et priorité — ${quoi}`, async function () {
        if (!present) { this.skip(); return }
        const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
        try {
          const { page, erreurs } = await ouvrir(browser, 'auteur', 'mjs-t-rien')
          const plat = await incline(page, 'mjs-t-rien')
          await page.evaluate((p: string) => { (window as any).__carte('mjs-t-rien').style.setProperty('transform', 'translateX(30px)', p) }, priorite)
          const avant = await enLigne(page, 'mjs-t-rien')
          assert.ok(avant.retour, 'la carte revient encore : la lecture à plat a lieu')
          assert.equal(avant.decl.transform, 'translateX(30px) | ' + priorite, 'le transform de l\'auteur est en ligne avant la ré-entrée')
          await page.mouse.move(plat.x + plat.w / 2, plat.y + plat.h / 2)
          const apres = await enLigne(page, 'mjs-t-rien')
          assert.ok(Math.abs(apres.ry) < 0.05, `la boîte est bien lue à plat : au centre l'angle posé est nul (${apres.ry}°)`)
          assert.equal(apres.decl.transform, 'translateX(30px) | ' + priorite, 'le transform de l\'auteur est rendu, valeur et priorité')
          assert.deepEqual(apres.decl, avant.decl)
          assert.deepEqual(erreurs, [])
        } finally {
          await browser.close()
        }
      })
    }

    // une transition de `transform` marquée `!important` dans la FEUILLE de l'auteur l'emporte sur toute déclaration en ligne ordinaire : la lecture à plat écrit la sienne
    // avec la même priorité (une déclaration en ligne `!important` l'emporte sur une feuille `!important`), sinon la transition du retour continue et la boîte lue est inclinée
    it('avec wait : une transition de transform marquée !important dans la feuille de l\'auteur n\'empêche pas la pose à plat — au centre l\'angle est nul, à 90 % de la largeur il vaut le réglage', async function () {
      if (!present) { this.skip(); return }
      const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
      try {
        const { page, erreurs } = await ouvrir(browser, 'feuille', 'mjs-t-feuille')
        const plat = await incline(page, 'mjs-t-feuille')
        const attend = await page.evaluate(() => (window as any).__carte('mjs-t-feuille').getAnimations().some((a: any) => a.transitionProperty === 'transform'))
        assert.ok(attend, 'la carte attend encore avant de revenir : la lecture à plat a lieu')
        for (const [part, attendu] of [[0.5, 0], [0.9, -16]] as const) {
          await page.mouse.move(plat.x + plat.w * part, plat.y + plat.h / 2)
          const a = await page.evaluate((t: string) => (window as any).__angles(t), 'mjs-t-feuille')
          console.log(`feuille !important, ré-entrée à ${part * 100} % : rx ${a.rx}° ry ${a.ry}° (attendu 0° et ${attendu}°)`)
          assert.ok(Math.abs(a.rx) < 0.05, `à ${part * 100} % : rx ${a.rx} pour 0`)
          assert.ok(Math.abs(a.ry - attendu) < 0.05, `à ${part * 100} % : ry ${a.ry} pour ${attendu}`)
        }
        // rien ne reste en ligne après la lecture, ni la transition, ni le transform, ni la priorité
        const reste = await page.evaluate(() => { const el = (window as any).__carte('mjs-t-feuille'); return { transition: el.style.transition, transform: el.style.transform, priorite: el.style.getPropertyPriority('transition') } })
        assert.deepEqual(reste, { transition: '', transform: '', priorite: '' })
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // le COMPORTEMENT du navigateur, pas le texte de l'attribut (qui est lui-même la sérialisation du navigateur) : un raccourci à plusieurs propriétés suivi d'un champ plus court,
    // relu puis réécrit en texte, change de sens dans Chromium et WebKit ; la lecture à plat ne touche qu'à ce qu'elle écrit, le reste du style de l'auteur n'est jamais réécrit
    const RETARD: Record<string, { tag: string, attendu: { delay: number, duration: number, easing: string } }> = {
      'un raccourci suivi d\'un retard': { tag: 'mjs-t-delai', attendu: { delay: 1000, duration: 2000, easing: 'ease' } },
      'un raccourci suivi d\'une durée': { tag: 'mjs-t-duree', attendu: { delay: 0, duration: 3000, easing: 'ease' } },
      'un raccourci dont les durées sont des var()': { tag: 'mjs-t-var', attendu: { delay: 0, duration: 2000, easing: 'ease' } },
      'un raccourci suivi d\'une courbe, avec une animation et un fond à listes de longueurs différentes': { tag: 'mjs-t-listes', attendu: { delay: 0, duration: 2000, easing: 'linear' } }
    }
    for (const [quoi, { tag, attendu }] of Object.entries(RETARD)) {
      it(`avec wait : la ré-entrée ne change rien au comportement du style de l'auteur — ${quoi}`, async function () {
        if (!present) { this.skip(); return }
        const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
        try {
          const { page, erreurs } = await ouvrir(browser, 'retard', tag)
          // ce que le navigateur calcule pour la carte : les listes de transition, d'animation, de fond, et la variable de l'auteur
          const calcule = () => page.evaluate((t: string) => {
            const cs = getComputedStyle((window as any).__carte(t))
            const o: Record<string, string> = {}
            for (const n of ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'animation-name', 'animation-duration', 'background-size', 'background-image', '--auteur']) o[n] = cs.getPropertyValue(n)
            return o
          }, tag)
          const avant = await calcule()
          const plat = await incline(page, tag)
          await page.mouse.move(plat.x + plat.w / 2, plat.y + plat.h / 2)
          const apres = await calcule()
          // la transition d'opacité que l'auteur déclenche maintenant : son retard, sa durée, sa courbe
          const opacite = await page.evaluate(async (t: string) => {
            const el = (window as any).__carte(t)
            el.classList.add('p')
            await new Promise((ok) => setTimeout(ok, 60))
            const a = el.getAnimations().find((x: any) => x.transitionProperty === 'opacity')
            if (!a) return null
            const m = a.effect.getTiming()
            return { delay: m.delay, duration: m.duration, easing: m.easing }
          }, tag)
          console.log(`${quoi} : transition d'opacité ${JSON.stringify(opacite)} (attendu ${JSON.stringify(attendu)})`)
          assert.deepEqual(apres, avant)
          assert.deepEqual(opacite, attendu)
          assert.deepEqual(erreurs, [])
        } finally {
          await browser.close()
        }
      })
    }

    it('sans wait : la boîte se lit à chaque entrée, comme dans la V3 (une lecture à la ré-entrée pendant le retour) et la carte suit toujours le pointeur', async function () {
      if (!present) { this.skip(); return }
      const browser = await ((await import('playwright')) as any)[NAVIGATEUR].launch()
      try {
        const { page, erreurs } = await ouvrir(browser, 'v3', 'mjs-t-v3')
        const plat = await incline(page, 'mjs-t-v3')
        await page.evaluate(() => {
          const w = window as any
          w.__lectures = 0
          const o = Element.prototype.getBoundingClientRect
          Element.prototype.getBoundingClientRect = function (this: any) { w.__lectures++; return o.call(this) }
        })
        await page.mouse.move(plat.x + plat.w * 0.9, plat.y + plat.h / 2)
        assert.equal(await page.evaluate(() => (window as any).__lectures), 1, 'la boîte est relue à l\'entrée')
        await page.waitForFunction(() => Math.abs((window as any).__angles('mjs-t-v3').vu) > 10, null, { timeout: 5000 })
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
})
