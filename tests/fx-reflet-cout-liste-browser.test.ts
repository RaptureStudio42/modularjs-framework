// une liste `{for}` à clé de 1 000 lignes portant `*reflect(blur: 2)`, inversée, dans Chromium et Firefox réels : le suivi
// des lignes déplacées ne doit pas coûter plus qu'une passe groupée (un seul observateur par parent, toutes les lectures
// de mise en page puis toutes les écritures), et la fin de l'effet doit débrancher son abonnement au parent.
// Seuil large : le même ordre de grandeur que sans l'effet, mesuré dans la même passe, pas une mesure fine.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// coût rapporté à la vitesse de la machine, mesurée dans la même page et la même passe : un plafond en millisecondes
// rougissait sous charge sans que rien n'ait changé, et la liste sans l'effet ne sert pas d'étalon (son temps est surtout
// celui des deux images attendues, que la charge ne change guère). Étalon : un calcul fixe (du processeur pur, que la
// charge ralentit comme l'effet) et deux images sans travail (le plancher de la mesure). Trois mesures alternées, médianes.
// Seuil large : au calme, il retrouve les plafonds d'avant ; au calme comme processeur ralenti 4 ou 8 fois, l'effet se tient
// entre la moitié et les deux tiers du seuil
const mediane = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const RAPPORT = 16
const plafond = (v: { calcul: number; vide: number }) => Math.round(v.vide + RAPPORT * v.calcul)

const N     = 1000
const STYLE = '\n<style>\n:host\n  display: block\n.p\n  position: relative\n  width: 300px\n.row\n  box-sizing: border-box\n  width: 140px\n  margin: 0 0 30px\n  padding: 4px\n  font: 16px/20px sans-serif\n</style>\n'
const liste = (ligne: string) => `<script>\n$l = []\n</script>\n<div class="p">{for r in $l by id}${ligne}{end}</div>${STYLE}`

const COMPOSANTS: Record<string, string> = {
  'fx-cout-flou': liste('<p class="row" *reflect(blur: 2)>{r.t}</p>'),
  'fx-cout-nu':   liste('<p class="row">{r.t}</p>'),
}

// compte les observateurs de mutation branchés (observe sans disconnect), posé avant le moindre script
const ESPION = `(function() {
  var Vrai = window.MutationObserver;
  var actifs = new Set();
  window.__moActifs = function(cible) {
    var n = 0;
    actifs.forEach(function(o) { if (o.cibles.indexOf(cible) >= 0) n++; });
    return n;
  };
  window.MutationObserver = function(cb) {
    var o = new Vrai(cb);
    var f = { cibles: [] };
    var obs = o.observe.bind(o);
    var dis = o.disconnect.bind(o);
    o.observe = function(c, opt) { f.cibles.push(c); actifs.add(f); return obs(c, opt); };
    o.disconnect = function() { actifs.delete(f); return dis(); };
    return o;
  };
  window.MutationObserver.prototype = Vrai.prototype;
})();`

describe('{for} à clé de 1 000 lignes avec *reflect — coût de l\'inversion et fin de l\'effet (navigateurs réels)', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-reflet-cout-liste-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let browser: any
      let page: any
      let erreurs: string[]

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page    = await (await browser.newContext({ viewport: { width: 800, height: 700 } })).newPage()
        erreurs = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.addInitScript(ESPION)
        const balises = Object.keys(COMPOSANTS).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${balises}<script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-cout-flou') as any)?._shadow?.querySelector('.p'), null, { timeout: 90000 })
      })

      after(async () => { await browser?.close() })

      // pose les lignes, attend deux images (la passe groupée peut attendre la suivante), rend la durée en ms
      const poser = (tag: string, ids: number[]): Promise<number> => page.evaluate(([tag, ids]: [string, number[]]) => new Promise<number>((fin) => {
        const t0 = performance.now()
        ;(document.querySelector(tag) as any)._set('l', ids.map((i) => ({ id: i, t: 'ligne ' + i })))
        requestAnimationFrame(() => requestAnimationFrame(() => fin(Math.round(performance.now() - t0))))
      }), [tag, ids])

      // l'étalon (cf. RAPPORT) : durée du calcul fixe, puis de deux images sans travail
      const etalon = (): Promise<{ calcul: number; vide: number }> => page.evaluate(() => new Promise<{ calcul: number; vide: number }>((fin) => {
        const t0 = performance.now()
        let x    = 0
        for (let i = 0; i < 2000000; i++) x = (x * 31 + i) % 1000003
        const calcul = performance.now() - t0 + (x < 0 ? 1 : 0)
        const t1     = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => fin({ calcul, vide: performance.now() - t1 })))
      }))
      const vitesse = async () => {
        const v: Array<{ calcul: number; vide: number }> = []
        for (let i = 0; i < 3; i++) v.push(await etalon())
        return { calcul: mediane(v.map(e => e.calcul)), vide: mediane(v.map(e => e.vide)) }
      }

      const droit = Array.from({ length: N }, (_, i) => i + 1)

      it('inverser ' + N + ' lignes à *reflect(blur: 2) reste du même ordre que sans l\'effet', async function () {
        this.timeout(200000)
        await poser('mjs-fx-cout-nu', droit)
        await poser('mjs-fx-cout-flou', droit)
        // trois inversions de chaque liste, en alternance (nombre impair : les deux listes finissent inversées)
        const nus: number[]   = []
        const flous: number[] = []
        let ordre = droit
        for (let i = 0; i < 3; i++) {
          ordre = [...ordre].reverse()
          nus.push(await poser('mjs-fx-cout-nu', ordre))
          flous.push(await poser('mjs-fx-cout-flou', ordre))
        }
        const v    = await vitesse()
        const nu   = mediane(nus)
        const flou = mediane(flous)
        console.log(`    ${nom} : inversion de ${N} lignes — sans l'effet ${nus.join(' / ')} ms, avec *reflect(blur: 2) ${flous.join(' / ')} ms — étalon : calcul ${v.calcul.toFixed(1)} ms, deux images ${v.vide.toFixed(1)} ms, seuil ${plafond(v)} ms`)
        assert.ok(flou <= plafond(v), `inversion avec l'effet : ${flou} ms (sans : ${nu} ms, médianes), seuil ${plafond(v)} ms (deux images ${v.vide.toFixed(1)} ms + ${RAPPORT} × calcul ${v.calcul.toFixed(1)} ms)`)
      })

      it('après l\'inversion, chaque reflet est encore juste sous sa ligne', async () => {
        const faux = await page.evaluate(() => {
          const racine = (document.querySelector('mjs-fx-cout-flou') as any)._shadow
          const kids = Array.from(racine.querySelector('.p').children) as any[]
          let n = 0
          for (let i = 0; i < kids.length; i++) {
            const c = kids[i]
            if (c.getAttribute('mjs-fx-layer')) continue
            const f = kids[i + 1]
            if (!f || f.getAttribute('mjs-fx-layer') !== 'reflect') { n++; continue }
            if (Math.abs(f.getBoundingClientRect().top - c.getBoundingClientRect().bottom - 4) > 1.5) n++
          }
          return n
        })
        assert.equal(faux, 0, 'lignes dont le reflet n\'est pas à 4 px dessous')
      })

      it('quand l\'effet prend fin, plus aucun observateur ne reste branché sur le parent', async () => {
        const avant = await page.evaluate(() => (window as any).__moActifs((document.querySelector('mjs-fx-cout-flou') as any)._shadow.querySelector('.p')))
        assert.ok(avant >= 1, 'pendant l\'effet, le parent est observé (' + avant + ')')
        await poser('mjs-fx-cout-flou', [])
        const apres = await page.evaluate(() => (window as any).__moActifs((document.querySelector('mjs-fx-cout-flou') as any)._shadow.querySelector('.p')))
        assert.equal(apres, 0, 'observateurs encore branchés sur le parent après la fin des effets')
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
