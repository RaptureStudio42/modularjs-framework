// la bulle de *guard et la largeur de la fenêtre, dans Chromium, Firefox et WebKit réels. Ouverte dans une fenêtre de 1 000 px, la
// fenêtre ramenée à 360 px : elle se replace sous son champ et la page ne déborde pas de côté (sa largeur de défilement égale sa
// largeur visible). La fenêtre tournée (360 × 780 puis 780 × 360) : elle suit encore son champ. Placée à droite d'un champ qui n'y
// laisse pas la place : elle passe sous lui, dans la fenêtre. Sous une case à cocher collée au bord droit : elle glisse vers
// l'intérieur, à 8 px du bord, au lieu de sortir de la fenêtre. Chaque mesure attend un état stable : l'animation d'entrée de la bulle
// finie, puis deux images de suite où rien ne bouge (jamais une durée fixe). Un script hors du framework retire le champ (ou son parent)
// pendant que la bulle est ouverte : la bulle se ferme et son écouteur de redimensionnement part avec elle

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Nom = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Nom): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const REGLAGES = 'delay: 0, duration: 60s, fx: none'
const COMPOSANTS: Record<string, string> = {
  'fx-gr-centre': `<div class="w"><input class="f" type="number" min="1" max="10" aria-label="nombre" *guard(${REGLAGES}, text: 'de 1 à 10')></div>\n<style>\n:host\n  display: block\n.w\n  width: 300px\n  margin: 20px auto\n.f\n  display: block\n  box-sizing: border-box\n  width: 120px\n</style>\n`,
  'fx-gr-droite': `<div class="w"><input class="f" type="number" min="1" max="10" aria-label="nombre" *guard(${REGLAGES}, text: 'de 1 à 10', place: right)></div>\n<style>\n:host\n  display: block\n.w\n  margin: 20px 10px\n.f\n  display: block\n  box-sizing: border-box\n  width: 100%\n</style>\n`,
  'fx-gr-case':   `<div class="w"><input class="f" type="checkbox" required aria-label="accord" *guard(${REGLAGES}, text: 'Cochez la case')></div>\n<style>\n:host\n  display: block\n.w\n  margin: 20px 10px\n.f\n  display: block\n  margin: 0 0 0 auto\n</style>\n`,
  'fx-gr-retire': `<div class="w"><div class="z1"><input class="f1" type="number" min="1" max="10" aria-label="un" *guard(${REGLAGES}, text: 'de 1 à 10')></div><div class="z2"><input class="f2" type="number" min="1" max="10" aria-label="deux" *guard(${REGLAGES}, text: 'de 1 à 10')></div></div>\n<style>\n:host\n  display: block\n.w\n  margin: 20px 10px\n</style>\n`,
}

// les écouteurs `resize` de la fenêtre, comptés (posés, retirés) avant que la page ne démarre
const ECOUTEURS = `(function() {
  var a = window.addEventListener, r = window.removeEventListener;
  window.__rs = new Set();
  window.addEventListener = function(t, f, o) { if (t === 'resize') window.__rs.add(f); return a.call(this, t, f, o); };
  window.removeEventListener = function(t, f, o) { if (t === 'resize') window.__rs.delete(f); return r.call(this, t, f, o); };
})();`

// les gestes, lus dans la page : ouvrir la bulle d'un composant (une valeur refusée), la refermer (une bonne valeur), attendre un
// état stable et rendre les boîtes à l'écran (le champ, la bulle) avec le débord de la page
const OUTIL = `
window.__g = (function() {
  var racine = function(tag) { return document.querySelector('mjs-' + tag)._shadow; };
  var champ  = function(tag) { return racine(tag).querySelector('input'); };
  var bulle  = function(tag) { return racine(tag).querySelector('[mjs-fx-guard-tip]'); };
  var image  = function() { return new Promise(function(r) { requestAnimationFrame(function() { r(null); }); }); };
  var boite  = function(e) { if (!e) return null; var b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  var lire   = function(tag) {
    return { champ: boite(champ(tag)), bulle: boite(bulle(tag)), deborde: document.scrollingElement.scrollWidth - document.documentElement.clientWidth, largeur: document.documentElement.clientWidth, fenetre: innerWidth };
  };
  var stable = async function(tag, largeur) {
    var avant = '';
    for (var i = 0; i < 300; i++) {
      await image();
      var b = bulle(tag);
      if (b && b.getAnimations) await Promise.all(b.getAnimations().map(function(a) { return a.finished.catch(function() {}); }));
      var ici = JSON.stringify(lire(tag));
      if (innerWidth === largeur && ici === avant) return lire(tag);
      avant = ici;
    }
    throw new Error('aucun état stable en 300 images');
  };
  var poser = function(tag, bon) {
    var c = champ(tag);
    if (c.type === 'checkbox') c.checked = bon;
    else c.value = bon ? '5' : '99';
    c.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  };
  return {
    stable: stable,
    ouvrir: function(tag, largeur) { poser(tag, false); return stable(tag, largeur); },
    fermer: function(tag) { poser(tag, true); return !bulle(tag); }
  };
})();
`

const ecart = (a: number, b: number) => Math.round(Math.abs(a - b) * 100) / 100

describe('*guard — la bulle suit la largeur de la fenêtre et ne fait jamais déborder la page (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-guard-bulle-redimension-browser')
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

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
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
        page    = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage()
        erreurs = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.addInitScript(ECOUTEURS)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          const balises = Object.keys(COMPOSANTS).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${balises}<script>${script}</script><script>${OUTIL}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((tags: string[]) => tags.every((t) => !!(document.querySelector(t) as any)?._shadow?.querySelector('input')), Object.keys(COMPOSANTS).map((c) => 'mjs-' + c), { timeout: 90000 })
      })

      after(async () => { await browser?.close() })

      // la bulle d'un composant ouverte dans une fenêtre `w` × `h`, refermée quoi qu'il arrive
      const avecBulle = async (tag: string, w: number, h: number, corps: (ouverte: any) => Promise<void>) => {
        await page.setViewportSize({ width: w, height: h })
        const ouverte = await page.evaluate(([t, l]: [string, number]) => (window as any).__g.ouvrir(t, l), [tag, w])
        let fermee = false
        try {
          assert.ok(ouverte.bulle, `${tag} : aucune bulle ouverte`)
          await corps(ouverte)
        }
        finally {
          fermee = await page.evaluate((t: string) => (window as any).__g.fermer(t), tag)
        }
        assert.ok(fermee, `${tag} : la bulle ne s'est pas refermée`)
      }
      const tourner = async (tag: string, w: number, h: number) => {
        await page.setViewportSize({ width: w, height: h })
        return page.evaluate(([t, l]: [string, number]) => (window as any).__g.stable(t, l), [tag, w])
      }
      const sousLeChamp = (tag: string, m: any) => {
        assert.ok(ecart(m.bulle.left, m.champ.left) <= 0.6, `${tag} : la bulle est à ${Math.round((m.bulle.left - m.champ.left) * 100) / 100} px du bord gauche de son champ (attendu 0)`)
        assert.ok(ecart(m.bulle.top, m.champ.bottom + 6) <= 0.6, `${tag} : la bulle est à ${Math.round((m.bulle.top - m.champ.bottom) * 100) / 100} px sous son champ (attendu 6)`)
      }

      it('ouverte à 1 000 px, la fenêtre ramenée à 360 px : la bulle suit son champ, la page ne déborde pas de côté', async () => {
        await avecBulle('fx-gr-centre', 1000, 700, async (ouverte) => {
          sousLeChamp('fx-gr-centre à 1 000 px', ouverte)
          const m = await tourner('fx-gr-centre', 360, 700)
          assert.ok(m.deborde <= 0, `à 360 px, la page déborde de ${m.deborde} px (bulle de ${Math.round(m.bulle.left)} à ${Math.round(m.bulle.right)} px, fenêtre de ${m.largeur} px)`)
          sousLeChamp('fx-gr-centre à 360 px', m)
        })
      })

      it('la fenêtre tournée (360 × 780 puis 780 × 360) : la bulle suit son champ', async () => {
        await avecBulle('fx-gr-centre', 360, 780, async (ouverte) => {
          sousLeChamp('fx-gr-centre en 360 × 780', ouverte)
          const m = await tourner('fx-gr-centre', 780, 360)
          assert.ok(m.deborde <= 0, `en 780 × 360, la page déborde de ${m.deborde} px`)
          sousLeChamp('fx-gr-centre en 780 × 360', m)
        })
      })

      it('place: right sans la place à droite du champ (360 px) : la bulle passe sous lui, la page ne déborde pas', async () => {
        await avecBulle('fx-gr-droite', 360, 700, async (m) => {
          assert.ok(m.deborde <= 0, `à 360 px, la page déborde de ${m.deborde} px (bulle de ${Math.round(m.bulle.left)} à ${Math.round(m.bulle.right)} px)`)
          sousLeChamp('fx-gr-droite', m)
        })
      })

      it('une case à cocher collée au bord droit (360 px) : la bulle glisse vers l\'intérieur, à 8 px du bord', async () => {
        await avecBulle('fx-gr-case', 360, 700, async (m) => {
          assert.ok(m.deborde <= 0, `à 360 px, la page déborde de ${m.deborde} px (bulle de ${Math.round(m.bulle.left)} à ${Math.round(m.bulle.right)} px)`)
          assert.ok(ecart(m.bulle.right, m.largeur - 8) <= 0.6, `la bulle finit à ${Math.round((m.largeur - m.bulle.right) * 100) / 100} px du bord droit (attendu 8)`)
          assert.ok(ecart(m.bulle.top, m.champ.bottom + 6) <= 0.6, `la bulle est à ${Math.round((m.bulle.top - m.champ.bottom) * 100) / 100} px sous la case (attendu 6)`)
        })
      })

      it('le champ retiré par un script hors du framework, bulle ouverte : la bulle se ferme et son écouteur `resize` part (le champ, puis le parent d\'un autre)', async () => {
        await page.setViewportSize({ width: 1000, height: 700 })
        const R = `document.querySelector('mjs-fx-gr-retire')._shadow`
        const base: number = await page.evaluate('window.__rs.size')
        const ouvrir = async (f: string, z: string) => {
          await page.evaluate(`(() => { const c = ${R}.querySelector('.${f}'); c.value = '99'; c.dispatchEvent(new Event('input', { bubbles: true, composed: true })) })()`)
          await page.waitForFunction(`!!${R}.querySelector('.${z} [mjs-fx-guard-tip]')`)
          assert.equal(await page.evaluate('window.__rs.size'), base + 1, `${f} : la bulle ouverte écoute le redimensionnement`)
        }
        const repos = (w: number) => page.evaluate(`(async () => { const vu = () => JSON.stringify([innerWidth, ${R}.querySelectorAll('[mjs-fx-guard-tip]').length, window.__rs.size]); const image = () => new Promise((r) => requestAnimationFrame(() => r(null))); let avant = ''; for (let i = 0; i < 300; i++) { await image(); const ici = vu(); if (innerWidth === ${w} && ici === avant) return { bulles: ${R}.querySelectorAll('[mjs-fx-guard-tip]').length, ecouteurs: window.__rs.size }; avant = ici } throw new Error('aucun état stable en 300 images') })()`)
        await ouvrir('f1', 'z1')
        await page.evaluate(`${R}.querySelector('.f1').remove()`)
        await page.setViewportSize({ width: 360, height: 700 })
        assert.deepEqual(await repos(360), { bulles: 0, ecouteurs: base }, 'le champ retiré : plus de bulle, plus d\'écouteur')
        await page.setViewportSize({ width: 1000, height: 700 })
        await ouvrir('f2', 'z2')
        await page.evaluate(`${R}.querySelector('.z2').remove()`)
        await page.setViewportSize({ width: 360, height: 700 })
        assert.deepEqual(await repos(360), { bulles: 0, ecouteurs: base }, 'le parent du champ retiré : plus d\'écouteur')
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
