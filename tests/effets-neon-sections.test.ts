// *neon : la respiration (`breathe`) est une SECTION marquée du fichier. Une appli qui écrit `*neon` avec les réglages d'avant (color, where, size,
// core, flicker, speed, on) embarque le néon d'avant, sa feuille mot pour mot, sans une ligne de la respiration ; celle qui écrit `breathe` (fixe, à sa
// valeur par défaut, tenu par une variable, sur une seule des balises de la page) l'embarque en entier. Trois gardes tiennent la table des témoins (les
// jetons des étiquettes du fichier sont ceux des pages, chaque section porte un témoin, chaque témoin part avec ses pages et elles seules), puis des
// navigateurs réels (Chromium, Firefox) montent l'appli construite en production : sans `breathe`, le néon d'avant ; avec, la respiration.

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

// la feuille du néon d'avant la respiration, règle par règle
const REGLES_D_AVANT = [
  '[mjs-fx~="neon"]{--mjs-fx-neon:0 0 calc(4px * var(--mjs-neon-size,1)) var(--mjs-neon-core,#fff),0 0 calc(10px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(22px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(44px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff)}',
  '[mjs-fx~="neon"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}',
  '[mjs-fx~="neon"][mjs-fx-on~="neon"]:not([mjs-fx-neon-where="box"]){color:var(--mjs-neon-core,#fff);text-shadow:var(--mjs-fx-neon)}',
  '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-where="box"],[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-where="both"]{box-shadow:var(--mjs-fx-neon)}',
  '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-flicker]{animation:mjs-fx-neon-flicker var(--mjs-neon-speed,3s) infinite}',
  '@keyframes mjs-fx-neon-flicker{0%,18%,22%,25%,53%,57%,100%{opacity:1}20%,24%,55%{opacity:.4}}',
  '@media (prefers-reduced-motion:reduce){[mjs-fx~="neon"]{transition:none}[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-flicker]{animation:none}}'
]
const MEDIA_RESPIRE = '@media (prefers-reduced-motion:reduce){[mjs-fx~="neon"]{transition:none}[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-flicker]{animation:none}[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe]{animation:none}'

type Page   = { source: string, jetons: string[] }
type Temoin = { texte: string, pages: string[] }

const REF = 'rien'
const NU  = '<div class="a" *neon>x</div>'
const D_AVANT = '*neon(#f0f, where: both, size: 2, core: #fff, flicker: true, speed: 2s, on: hover)'

// chaque page n'écrit qu'un cas ; une seule étiquette (`breathe`)
const PAGES: Record<string, Page> = {
  [REF]:      { source: NU, jetons: [] },
  d_avant:    { source: `<div class="a" ${D_AVANT}>x</div>`, jetons: [] },
  box:        { source: '<div class="a" *neon(where: box)>x</div>', jetons: [] },
  fixe:       { source: '<div class="a" *neon(breathe: true)>x</div>', jetons: ['breathe'] },
  defaut:     { source: '<div class="a" *neon(breathe: false)>x</div>', jetons: ['breathe'] },
  variable:   { source: '<script>\n$r = true\n</script>\n<div class="a" *neon(breathe: $r)>x</div>', jetons: ['breathe'] },
  cadre:      { source: '<div class="a" *neon(where: both, breathe: true, flicker: true)>x</div>', jetons: ['breathe'] },
  une_sur_deux: { source: '<div class="a" *neon>x</div><div class="b" *neon(#0ff, breathe: true)>y</div>', jetons: ['breathe'] }
}

// des lignes du fichier, une par section et plus : la feuille de la respiration, celle de « réduire les animations », le programme de la pose
const TEMOINS: Temoin[] = [
  { texte: '@keyframes mjs-fx-neon-breathe{0%,100%{opacity:0}50%{opacity:1}}',                     pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: '[mjs-fx~="neon"][mjs-fx-neon-breathe~="layer"]{isolation:isolate}',                    pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: 'µ._mjs_fxPlaceCss(function(a) {',                                                      pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: 'animation-play-state:paused}',                                                         pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: '[mjs-fx-neon-breathe~="layer"]::before{animation:none;opacity:1}',                     pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: '[mjs-fx-neon-breathe~="box"]{box-shadow:var(--mjs-fx-neon)}',                          pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: 'var calm = function() {};',                                                            pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: 'if (s.breathe) {',                                                                     pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: 'var boxy  = µ._mjs_fxBoxy(el);',                                                       pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: 'watch = µ._mjs_fxOnText(el, sync);',                                                   pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: "el.style.removeProperty('--mjs-fx-neon-inset');",                                      pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] },
  { texte: 'calm();',                                                                              pages: ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux'] }
]

describe('*neon — la respiration est une section du fichier', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_neon.ts'), 'utf-8')

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : rend le module du néon et tout le JavaScript émis
  async function construire(nom: string, source: string): Promise<{ module: string, tout: string }> {
    const root   = mjsTmp('neon-sections-' + nom)
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
    return { module: fichiers.filter((f) => f.startsWith('mjs_fx_neon-')).map(lire).join('\n'), tout: fichiers.map(lire).join('\n') }
  }

  // la feuille que le module pose (le module est évalué avec un `µ` de banc : ce que la pose lirait du cœur y est une copie)
  const feuille = (module: string): string => {
    const code = module.replace(/^import .*$/m, '')
    return new Function('µ', code + '\nreturn µ._mjs_fxDefs.neon.css')({ _mjs_fxDefs: {}, _mjs_fxPlaceCss: (f: (a: string) => string) => f('') + f(':hover') })
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
      assert.deepEqual(dansLeFichier, ['breathe'])
    })

    it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
      const liste = unites(src)
      assert.ok(liste.length >= 3, 'la feuille de la respiration, celle de « réduire les animations » et le programme de la pose : trois sections au moins')
      for (const u of liste) assert.ok(TEMOINS.some((t) => u.propres.join('\n').includes(t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
      for (const t of TEMOINS) assert.ok(liste.some((u) => u.propres.join('\n').includes(t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
    })

    it('aucune marque ne sort, et chaque page porte les témoins de la respiration si elle écrit breathe, et seulement alors', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        assert.equal(sortie.tout.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
        for (const t of TEMOINS) {
          const delta = compte(sortie.tout, t.texte) - compte(sorties[REF].tout, t.texte)
          assert.equal(delta, t.pages.includes(nom) ? 1 : 0, `page « ${nom} » (${PAGES[nom].source}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
        }
      }
    })

    it('sans breathe, le module est celui d\'avant : sa feuille est la même, mot pour mot, et rien de la respiration ne reste', () => {
      for (const nom of [REF, 'd_avant', 'box']) {
        const m = sorties[nom].module
        acorn.parse(m, { ecmaVersion: 'latest', sourceType: 'module' })
        assert.equal(feuille(m), REGLES_D_AVANT.join(''), `${nom} : la feuille d'avant`)
        assert.equal(/breathe/i.test(m.replace(/^\s*\/\/.*$/gm, '')), false, `${nom} : un mot de la respiration reste dans le code`)
      }
    })

    it('avec breathe, le module est valide, la feuille d\'avant y est (dans le même ordre) et la règle « réduire les animations » est refermée, pour tous les cas écrits', () => {
      for (const nom of ['fixe', 'defaut', 'variable', 'cadre', 'une_sur_deux']) {
        const m = sorties[nom].module
        acorn.parse(m, { ecmaVersion: 'latest', sourceType: 'module' })
        const css = feuille(m)
        for (const regle of REGLES_D_AVANT.slice(0, 5)) assert.ok(css.includes(regle), `${nom} : règle d'avant perdue : ${regle.slice(0, 50)}`)
        assert.ok(css.includes(MEDIA_RESPIRE), `${nom} : la règle « réduire les animations » commence par celle d'avant puis ajoute celles de la respiration`)
        assert.ok(css.endsWith('{box-shadow:var(--mjs-fx-neon)}}'), `${nom} : la règle « réduire les animations » est refermée`)
        assert.equal(compte(css, '{'), compte(css, '}'), `${nom} : accolades équilibrées`)
      }
    })
  })

  // l'appli construite en production, ouverte dans de vrais navigateurs
  const STYLE = '\n<style>\n.a, .b\n  margin: 20px\n  width: 260px\n  height: 60px\n  font: 700 32px/60px sans-serif\n  color: #fff\n  background: #05060a\n</style>\n'
  const APPLIS: Record<string, Record<string, string>> = {
    defauts: {
      'n-defaut': `<h2 class="a" *neon(#0ff, where: both, flicker: true)>Néon</h2><h2 class="b" *neon(#f0f, on: hover)>Survol</h2>${STYLE}`
    },
    ecrits: {
      'n-defaut':  `<h2 class="a" *neon(#0ff, where: both, flicker: true)>Néon</h2><h2 class="b" *neon(#f0f, on: hover)>Survol</h2>${STYLE}`,
      'n-respire': `<h2 class="a" *neon(#f00, breathe: true, speed: 1.5s)>Respire</h2><h2 class="b" *neon(#f00, where: both, breathe: true)>Cadre</h2>${STYLE}`
    }
  }
  const OMBRE_NEON = 'rgb(255, 255, 255) 0px 0px 4px, rgb(0, 255, 255) 0px 0px 10px, rgb(0, 255, 255) 0px 0px 22px, rgb(0, 255, 255) 0px 0px 44px'
  const CADRE_NEON = 'rgb(255, 255, 255) 0px 0px 4px 0px, rgb(0, 255, 255) 0px 0px 10px 0px, rgb(0, 255, 255) 0px 0px 22px 0px, rgb(0, 255, 255) 0px 0px 44px 0px'
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [appli, composants] of Object.entries(APPLIS)) {
      const root   = mjsTmp('neon-sections-navigateur-' + appli)
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

      async function ouvrir(appli: string, reduit = false): Promise<{ page: any, erreurs: string[] }> {
        const page    = await (await browser.newContext({ viewport: { width: 800, height: 600 }, reducedMotion: reduit ? 'reduce' : 'no-preference' })).newPage()
        const erreurs: string[] = []
        await page.addInitScript(() => {
          (window as any).__racine = (tag: string) => {
            const el: any = document.querySelector(tag)
            if (!el) return null
            if (el.shadowRoot) return el.shadowRoot
            for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
            return el
          }
        })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const balises = Object.keys(APPLIS[appli]).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body>${balises}<script>${scripts[appli]}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((tags: string[]) => tags.every((t) => !!(window as any).__racine(t)?.firstElementChild), Object.keys(APPLIS[appli]).map((c) => 'mjs-' + c), { timeout: 20000 })
        return { page, erreurs }
      }

      // ce que le navigateur dit d'une balise du composant : ses ombres, ses animations (balise et pseudo-éléments), ses marques
      const lire = (page: any, tag: string, sel: string): Promise<{ texte: string, cadre: string, anims: string[], respire: string | null, avant: string, apres: string }> => page.evaluate(([tag, sel]: [string, string]) => {
        const el: any = (window as any).__racine(tag).querySelector(sel)
        const cs = getComputedStyle(el)
        return {
          texte:   cs.textShadow,
          cadre:   cs.boxShadow,
          anims:   el.getAnimations({ subtree: true }).map((a: any) => a.animationName).sort(),
          respire: el.getAttribute('mjs-fx-neon-breathe'),
          avant:   getComputedStyle(el, '::before').opacity,
          apres:   getComputedStyle(el, '::after').opacity
        }
      }, [tag, sel])

      it('sans breathe écrit : le néon d\'avant (ombres, cadre, grésillement), aucune marque ni animation de respiration, aucune erreur', async () => {
        const { page, erreurs } = await ouvrir('defauts')
        const a = await lire(page, 'mjs-n-defaut', '.a')
        assert.equal(a.texte, OMBRE_NEON)
        assert.equal(a.cadre, CADRE_NEON)
        assert.deepEqual(a.anims, ['mjs-fx-neon-flicker'])
        assert.equal(a.respire, null)
        const b = await lire(page, 'mjs-n-defaut', '.b')
        assert.equal(b.texte, 'none', 'au survol : éteint tant que le pointeur n\'y est pas')
        const r = await page.evaluate(() => { const c = (window as any).__racine('mjs-n-defaut').querySelector('.b').getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 } })
        await page.mouse.move(r.x, r.y)
        await page.waitForFunction(() => { const el: any = (window as any).__racine('mjs-n-defaut').querySelector('.b'); return getComputedStyle(el).textShadow !== 'none' }, null, { timeout: 5000 })
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('sans breathe écrit et « réduire les animations » : le grésillement est coupé, la lueur reste (la règle d\'avant est refermée)', async () => {
        const { page, erreurs } = await ouvrir('defauts', true)
        const a = await lire(page, 'mjs-n-defaut', '.a')
        assert.deepEqual(a.anims, [])
        assert.equal(a.texte, OMBRE_NEON)
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('avec breathe écrit sur une balise : celle-là respire, la voisine garde le néon d\'avant', async () => {
        const { page, erreurs } = await ouvrir('ecrits')
        const neuf = await lire(page, 'mjs-n-respire', '.a')
        assert.equal(neuf.respire, 'layer')
        assert.ok(neuf.anims.includes('mjs-fx-neon-breathe'), neuf.anims.join(' '))
        const cadre = await lire(page, 'mjs-n-respire', '.b')
        assert.equal(cadre.respire, 'layer frame')
        assert.ok(cadre.anims.filter((n) => n === 'mjs-fx-neon-breathe').length === 2, cadre.anims.join(' '))
        const vieux = await lire(page, 'mjs-n-defaut', '.a')
        assert.deepEqual(vieux.anims, ['mjs-fx-neon-flicker'])
        assert.equal(vieux.respire, null)
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('avec breathe écrit et « réduire les animations » : plus aucune animation, la lueur reste à sa grande taille', async () => {
        const { page, erreurs } = await ouvrir('ecrits', true)
        const neuf = await lire(page, 'mjs-n-respire', '.a')
        assert.deepEqual(neuf.anims, [])
        assert.equal(neuf.avant, '1', 'le calque du texte est à pleine opacité')
        const cadre = await lire(page, 'mjs-n-respire', '.b')
        assert.deepEqual(cadre.anims, [])
        assert.equal(cadre.apres, '1', 'le calque du cadre est à pleine opacité')
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })
    })
  }
})
