// *hologram, styles simples (rainbow, foil, galaxy, prism, gold) : au repos, rien ne tourne (Chromium et Firefox réels).
// Sans courbe à suivre (`speed: 0`) ou la souris posée sur la carte, le reflet arrivé ne bouge plus : la boucle ne s'arrêtait pourtant jamais, une image demandée à chaque
// rafraîchissement pour réécrire les mêmes valeurs (vingt cartes : environ 2 500 images en 2 s). Elle s'arrête maintenant, et le premier geste la relance ; la courbe
// de `speed` tourne toujours. Un contenu réécrit au repos par un script emportait le reflet, que seule la boucle rattachait : il revient sans geste, en un seul
// exemplaire, à sa place (une mise à jour du contenu par MJS le laisse en place) ; l'observateur qui le rattache, un par carte, part avec l'effet. Sous « réduire les animations », rien ne change : aucune boucle,
// le reflet va droit à la souris.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { navigateurPresent, construireProd, ouvrir, boite, type Construit } from './helpers/hologramme-zoom.js'

const STYLE = `<style>
.carte
  display: inline-block
  width: 120px
  height: 160px
  margin: 4px
  border-radius: 8px
  background: #345
  color: #fff
</style>
`
const SIMPLES = ['rainbow', 'foil', 'galaxy', 'prism', 'gold']

const SOURCES: Record<string, string> = {
  'hr-vingt.mjs':   Array.from({ length: 20 }, (_, i) => `<div class="carte" *hologram(${SIMPLES[i % 5]}, speed: 0)><b>${i}</b></div>`).join('\n') + '\n' + STYLE,
  'hr-une.mjs':     `<div class="carte" *hologram(rainbow)><b>A</b></div>\n${STYLE}`,
  'hr-reecrit.mjs': `<script>\n$h = '<b>A</b>'\n</script>\n<div class="carte" *hologram(foil, speed: 0)><b>A</b></div>\n<div class="carte" *hologram(prism, speed: 0)><b>B</b></div>\n<div class="carte" *hologram(galaxy, speed: 0)>{{$h}}</div>\n<button class="h" @click={$h = '<i>neuf</i>'}>h</button>\n${STYLE}`,
  'hr-retrait.mjs': `<script>\n$on = true\n</script>\n{if $on}<div class="carte a" *hologram(gold, speed: 0)><b>A</b></div>{end}\n<div class="carte b" *hologram(rainbow, speed: 0)><b>B</b></div>\n<button class="t" @click={$on = !$on}>t</button>\n${STYLE}`
}

let construction: Promise<Construit> | null = null
const construit = () => construction ??= construireProd(SOURCES, 'effets-hologramme-repos')

// posé avant la page : chaque image demandée est comptée, chaque observateur des changements du DOM noté avec ce qu'il observe (et débranché ou non)
const COMPTEURS = `
window.__images = 0;
var __raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = function (f) { window.__images++; return __raf(f); };
window.__observes = [];
var __observe = MutationObserver.prototype.observe;
var __debranche = MutationObserver.prototype.disconnect;
MutationObserver.prototype.observe = function (n, o) { window.__observes.push({ mo: this, n: n, actif: true }); return __observe.call(this, n, o); };
MutationObserver.prototype.disconnect = function () { for (var i = 0; i < window.__observes.length; i++) if (window.__observes[i].mo === this) window.__observes[i].actif = false; return __debranche.call(this); };
`

type Reflet = { calques: number, x: number, y: number, texte: string }

// la carte `i` du composant : ses calques de reflet, la place du reflet, son texte
const lire = (p: any, tag: string, i: number): Promise<Reflet> => p.evaluate(([t, n]: any[]) => {
  const carte   = (document.querySelector(t) as any)._shadow.querySelectorAll('.carte')[n] as HTMLElement
  const calques = [...carte.children].filter((c) => c.getAttribute('mjs-fx-layer') === 'hologram') as HTMLElement[]
  const lit     = (v: string) => calques[0] ? parseFloat(calques[0].style.getPropertyValue(v) || 'NaN') : NaN
  return { calques: calques.length, x: lit('--mjs-fx-hologram-x'), y: lit('--mjs-fx-hologram-y'), texte: carte.textContent || '' }
}, [tag, i])

// les images demandées pendant `ms` millisecondes
const compte = (p: any, ms: number): Promise<number> => p.evaluate((d: number) => new Promise((fin) => {
  const w = window as any
  const a = w.__images
  setTimeout(() => fin(w.__images - a), d)
}), ms)

// attend (au plus `delai` ms) 600 ms de suite sans aucune image demandée ; rend false si la boucle tourne encore
const calme = (p: any, delai = 10000): Promise<boolean> => p.evaluate((d: number) => new Promise((fin) => {
  const w  = window as any
  const t0 = Date.now()
  let n    = w.__images
  let vu   = Date.now()
  const tour = () => {
    if (w.__images !== n) {
      n  = w.__images
      vu = Date.now()
    }
    if (Date.now() - vu >= 600) return fin(true)
    if (Date.now() - t0 > d) return fin(false)
    setTimeout(tour, 50)
  }
  tour()
}), delai)

// les observateurs encore branchés sur la carte `sel` du composant (ou sur la carte gardée dans `window.__gardee`)
const observes = (p: any, tag: string, sel: string): Promise<number> => p.evaluate(([t, s]: string[]) => {
  const w = window as any
  const c = s === 'gardee' ? w.__gardee : (document.querySelector(t) as any)._shadow.querySelector(s)
  return w.__observes.filter((v: any) => v.n === c && v.actif).length
}, [tag, sel])

const NAVIGATEURS = (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox']) as Array<'chromium' | 'firefox'>

describe('*hologram : au repos, la boucle du reflet s\'arrête et le reflet revient seul après une réécriture (navigateurs réels)', function () {
  this.timeout(600000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of NAVIGATEURS) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      it('vingt cartes au repos (`speed: 0`, la souris dehors) : aucune image demandée en 2 s, le reflet reste au centre', async function () {
        const tag = 'mjs-hr-vingt'
        const { p, erreurs } = await ouvrir(browser, await construit(), tag, {}, COMPTEURS)
        try {
          await p.mouse.move(690, 790)
          await p.waitForTimeout(1500)
          const n = await compte(p, 2000)
          console.log(`    ${nom} : ${n} images demandées en 2 s par vingt cartes au repos`)
          assert.equal(n, 0, `${n} images demandées en 2 s par vingt cartes au repos`)
          for (let i = 0; i < 20; i++) {
            const e = await lire(p, tag, i)
            assert.deepEqual([e.calques, e.x, e.y], [1, 0.5, 0.5], `carte ${i} : ${e.calques} calque(s), reflet en ${e.x} ${e.y}`)
          }
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await p.close()
        }
      })

      it('la souris posée : la boucle s\'arrête quand le reflet l\'a rejointe, le geste suivant la relance ; sans souris, la courbe tourne', async function () {
        const tag = 'mjs-hr-une'
        const { p, erreurs } = await ouvrir(browser, await construit(), tag, {}, COMPTEURS)
        try {
          await p.mouse.move(690, 790)
          await p.waitForTimeout(300)
          const a  = await lire(p, tag, 0)
          const n0 = await compte(p, 600)
          const b  = await lire(p, tag, 0)
          assert.ok(n0 > 5 && (a.x !== b.x || a.y !== b.y), `sans souris, le reflet ne suit plus sa courbe : ${n0} images, reflet en ${a.x} ${a.y} puis ${b.x} ${b.y}`)
          const r = await boite(p, tag, '.carte')
          await p.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.35)
          assert.ok(await calme(p), 'la souris posée, la boucle tourne encore')
          const e1 = await lire(p, tag, 0)
          assert.ok(Math.abs(e1.x - 0.3) < 0.02 && Math.abs(e1.y - 0.35) < 0.02, `le reflet n'a pas rejoint la souris : ${e1.x} ${e1.y}`)
          const n1 = await compte(p, 1000)
          assert.equal(n1, 0, `${n1} images demandées en 1 s, la souris posée`)
          await p.mouse.move(r.x + r.w * 0.7, r.y + r.h * 0.65)
          const n2 = await compte(p, 300)
          assert.ok(n2 > 0, 'le geste n\'a pas relancé la boucle')
          assert.ok(await calme(p), 'la souris de nouveau posée, la boucle tourne encore')
          const e2 = await lire(p, tag, 0)
          assert.ok(Math.abs(e2.x - 0.7) < 0.02 && Math.abs(e2.y - 0.65) < 0.02, `le reflet n'a pas suivi la souris : ${e2.x} ${e2.y}`)
          await p.mouse.move(690, 790)
          const n3 = await compte(p, 600)
          assert.ok(n3 > 5, `la souris sortie, la courbe n'a pas repris : ${n3} images`)
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await p.close()
        }
      })

      it('contenu réécrit au repos par un script (`textContent =`, `innerHTML +=`) ou par MJS (`{{…}}`) : le reflet est là sans geste, en un seul exemplaire, à sa place', async function () {
        const tag = 'mjs-hr-reecrit'
        const { p, erreurs } = await ouvrir(browser, await construit(), tag, {}, COMPTEURS)
        try {
          await p.mouse.move(690, 790)
          assert.ok(await calme(p), 'les cartes au repos, la boucle tourne encore')
          // les deux écritures du script emportent bien le reflet de leur carte (le témoin le voit partir) ; MJS écrit le HTML brut `{{…}}` dans une balise à lui,
          // dans la carte : le reflet reste
          await p.evaluate((t: string) => {
            const w = window as any
            w.__partis = [false, false, false]
            const cartes = (document.querySelector(t) as any)._shadow.querySelectorAll('.carte')
            cartes.forEach((c: HTMLElement, i: number) => new MutationObserver((l) => {
              for (const m of l) for (const n of m.removedNodes) if (n.nodeType === 1 && (n as HTMLElement).getAttribute('mjs-fx-layer') === 'hologram') w.__partis[i] = true
            }).observe(c, { childList: true }))
            cartes[0].textContent = 'Un autre texte'
            cartes[1].innerHTML += '<i>x</i>'
            ;((document.querySelector(t) as any)._shadow.querySelector('.h') as HTMLElement).click()
          }, tag)
          await p.waitForTimeout(400)
          assert.deepEqual(await p.evaluate(() => (window as any).__partis), [true, true, false], 'une écriture du script n\'a pas emporté le reflet (l\'essai ne prouve rien), ou MJS l\'a emporté')
          const textes = ['Un autre texte', 'Bx', 'neuf']
          for (let i = 0; i < 3; i++) {
            const e = await lire(p, tag, i)
            assert.deepEqual([e.calques, e.x, e.y], [1, 0.5, 0.5], `carte ${i} : ${e.calques} calque(s), reflet en ${e.x} ${e.y}`)
            assert.equal(e.texte, textes[i], `carte ${i} : le texte neuf n'est pas resté`)
          }
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await p.close()
        }
      })

      it('un observateur par carte, débranché quand l\'effet part (la carte retirée par `{if}`) : une réécriture ne ramène plus rien', async function () {
        const tag = 'mjs-hr-retrait'
        const { p, erreurs } = await ouvrir(browser, await construit(), tag, {}, COMPTEURS)
        try {
          assert.equal(await observes(p, tag, '.a'), 1, 'la carte a n\'a pas un observateur, un seul')
          assert.equal(await observes(p, tag, '.b'), 1, 'la carte b n\'a pas un observateur, un seul')
          await p.evaluate((t: string) => {
            const sh = (document.querySelector(t) as any)._shadow
            ;(window as any).__gardee = sh.querySelector('.a')
            ;(sh.querySelector('.t') as HTMLElement).click()
          }, tag)
          await p.waitForFunction(() => !(window as any).__gardee.isConnected, null, { polling: 50, timeout: 10000 })
          await p.waitForTimeout(300)
          assert.equal(await observes(p, tag, 'gardee'), 0, 'l\'observateur de la carte retirée est toujours branché')
          await p.evaluate(() => { (window as any).__gardee.textContent = 'Un autre texte' })
          await p.waitForTimeout(400)
          const reste = await p.evaluate(() => (window as any).__gardee.querySelectorAll('[mjs-fx-layer]').length)
          assert.equal(reste, 0, 'un calque est revenu dans la carte retirée')
          assert.equal(await observes(p, tag, '.b'), 1, 'la carte restée a perdu son observateur')
          await p.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.t') as HTMLElement).click() }, tag)
          await p.waitForFunction((t: string) => !!(document.querySelector(t) as any)._shadow.querySelector('.a [mjs-fx-layer="hologram"]'), tag, { polling: 50, timeout: 10000 })
          assert.equal(await observes(p, tag, '.a'), 1, 'la carte reposée n\'a pas un observateur, un seul')
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await p.close()
        }
      })

      it('« réduire les animations » : aucune boucle, le reflet va droit à la souris, comme avant', async function () {
        const tag = 'mjs-hr-une'
        const { p, erreurs } = await ouvrir(browser, await construit(), tag, { reducedMotion: 'reduce' }, COMPTEURS)
        try {
          await p.mouse.move(690, 790)
          await p.waitForTimeout(300)
          assert.equal(await compte(p, 1000), 0, 'une boucle tourne sous « réduire les animations »')
          const r = await boite(p, tag, '.carte')
          await p.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.35)
          await p.waitForTimeout(100)
          const e = await lire(p, tag, 0)
          assert.ok(Math.abs(e.x - 0.3) < 0.02 && Math.abs(e.y - 0.35) < 0.02, `le reflet n'est pas allé droit à la souris : ${e.x} ${e.y}`)
          assert.equal(await compte(p, 600), 0, 'une boucle tourne sous « réduire les animations », la souris sur la carte')
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await p.close()
        }
      })
    })
  }
})
