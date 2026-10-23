// l'observateur partagé de *reflect (un par parent, pour toutes les lignes d'une liste), dans Chromium et Firefox réels :
// retirer UNE ligne ne débranche pas l'observateur des autres (leur reflet suit encore la liste réordonnée) ; tout vider
// puis remplir rebranche un observateur neuf, un seul ; une ligne retirée à la main du DOM emporte sa boîte de reflet ;
// un désabonnement rappelé deux fois n'efface pas l'abonnement d'un observateur plus récent du même parent.

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

// quatre lignes de hauteurs différentes : une ligne qui change de place change de hauteur sous elle
const LIGNES: Record<number, { id: number, t: string }> = {
  1: { id: 1, t: 'un' },
  2: { id: 2, t: 'deux deux deux deux deux deux deux' },
  3: { id: 3, t: 'trois trois trois' },
  4: { id: 4, t: 'quatre' },
}
const STYLE = '\n<style>\n:host\n  display: block\n.p\n  position: relative\n  padding: 10px 10px 60px\n  width: 220px\n.row\n  box-sizing: border-box\n  width: 140px\n  margin: 0 0 30px\n  padding: 4px\n  background: #cde\n  font: 16px/20px sans-serif\n</style>\n'

const COMPOSANTS: Record<string, string> = {
  'fx-obs-liste': `<script>\n$l = []\n</script>\n<div class="p">{for r in $l by id}<p class="row" *reflect(blur: 2)>{r.t}</p>{end}</div>${STYLE}`,
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

describe('*reflect — l\'observateur partagé d\'un parent garde ses abonnés (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-reflet-observateur-partage-browser')
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
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><mjs-fx-obs-liste></mjs-fx-obs-liste><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-obs-liste') as any)?._shadow?.querySelector('.p'), null, { timeout: 90000 })
      })

      after(async () => { await browser?.close() })

      const poser = (ids: number[]) => page.evaluate((lignes: any[]) => new Promise<void>((fin) => {
        (document.querySelector('mjs-fx-obs-liste') as any)._set('l', lignes)
        setTimeout(fin, 400)
      }), ids.map((i) => LIGNES[i]))

      // chaque ligne du parent avec ses calques de reflet, lus à l'écran
      const lire = (): Promise<{ tete: string, bottom: number, left: number, height: number, calques: { top: number, left: number, height: number }[] }[]> => page.evaluate(() => {
        const racine = (document.querySelector('mjs-fx-obs-liste') as any)._shadow
        const r2     = (x: number) => Math.round(x * 100) / 100
        const out: any[] = []
        for (const c of Array.from(racine.querySelector('.p').children) as any[]) {
          const b = c.getBoundingClientRect()
          if (c.getAttribute('mjs-fx-layer') === 'reflect') out[out.length - 1].calques.push({ top: r2(b.top), left: r2(b.left), height: r2(b.height) })
          else if (!c.getAttribute('mjs-fx-layer')) out.push({ tete: c.textContent.split(' ')[0], bottom: r2(b.bottom), left: r2(b.left), height: r2(b.height), calques: [] })
        }
        return out
      })

      const proche = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1.5, `${msg} : ${a} au lieu de ${b}`)
      const refletsJustes = (groupes: Awaited<ReturnType<typeof lire>>) => {
        for (const g of groupes) {
          assert.equal(g.calques.length, 1, 'un seul reflet derrière la ligne ' + g.tete)
          proche(g.calques[0].top, g.bottom + 4, 'le reflet de la ligne ' + g.tete + ' est à 4 px sous elle')
          proche(g.calques[0].left, g.left, 'le reflet de la ligne ' + g.tete + ' est à son abscisse')
          proche(g.calques[0].height, g.height, 'le reflet de la ligne ' + g.tete + ' en a la hauteur')
        }
      }
      const observes = () => page.evaluate(() => (window as any).__moActifs((document.querySelector('mjs-fx-obs-liste') as any)._shadow.querySelector('.p')))

      it('retirer une seule ligne laisse les autres suivre le réordonnancement', async () => {
        await poser([1, 2, 3, 4])
        await poser([1, 2, 3])
        await poser([3, 1, 2])
        const g = await lire()
        assert.equal(g.map((x) => x.tete).join(','), 'trois,un,deux')
        refletsJustes(g)
        assert.equal(await observes(), 1, 'un seul observateur branché sur le parent')
      })

      it('tout vider puis remplir : les reflets suivent un réordonnancement, avec un seul observateur', async () => {
        await poser([])
        assert.equal(await observes(), 0, 'plus aucun observateur une fois la liste vide')
        await poser([1, 2, 3])
        await poser([3, 2, 1])
        const g = await lire()
        assert.equal(g.map((x) => x.tete).join(','), 'trois,deux,un')
        refletsJustes(g)
        assert.equal(await observes(), 1, 'un seul observateur branché sur le parent')
      })

      it('une ligne retirée à la main du DOM emporte sa boîte de reflet', async () => {
        await poser([1, 2, 3])
        await page.evaluate(() => {
          const racine = (document.querySelector('mjs-fx-obs-liste') as any)._shadow
          const rows = racine.querySelectorAll('.p .row:not([mjs-fx-layer])')
          rows[1].remove()
        })
        await page.evaluate(() => new Promise((r) => setTimeout(r, 200)))
        const n = await page.evaluate(() => {
          const p = (document.querySelector('mjs-fx-obs-liste') as any)._shadow.querySelector('.p')
          return { lignes: p.querySelectorAll('.row:not([mjs-fx-layer])').length, couches: p.querySelectorAll('[mjs-fx-layer="reflect"]').length }
        })
        assert.equal(`couches ${n.couches} lignes ${n.lignes}`, 'couches 2 lignes 2')
      })

      it('un désabonnement rappelé deux fois ne retire pas l\'abonnement d\'un observateur plus récent', async () => {
        await poser([])
        const n = await page.evaluate(() => new Promise<number[]>((fin) => {
          const g: any = globalThis
          const p = document.createElement('div')
          document.body.appendChild(p)
          const sub = () => ({ el: document.createElement('i'), fix() {}, read() {}, write() {} })
          const quitter1 = g._mjsFxReflectJoin(p, sub())
          quitter1()
          const quitter2 = g._mjsFxReflectJoin(p, sub())
          quitter1()
          const quitter3 = g._mjsFxReflectJoin(p, sub())
          const avant = (window as any).__moActifs(p)
          quitter2()
          quitter3()
          const apres = (window as any).__moActifs(p)
          p.remove()
          fin([avant, apres])
        }))
        assert.deepEqual(n, [1, 0], 'un seul observateur tant qu\'un abonné reste, aucun une fois tous partis')
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
