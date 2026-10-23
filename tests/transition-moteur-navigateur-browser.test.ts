// moteur des transitions dans des navigateurs réels (Chromium, Firefox, WebKit) : sans bundle, le fichier mjs_easing.ts est chargé tel quel sur un µ privé
// - épinglage d'une balise sortante (µ._mjs_fixPosition) : positions mesurées pour une sortie d'élément de liste, avec et sans rectangle d'origine
// - pas de flash à l'entrée : la valeur de départ est déjà lue avant la première image, y compris pendant le délai
// - coupure en route : la valeur lue juste après la coupure est celle d'avant, dans les deux sens
// un moteur absent de la machine saute son cas

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'mjs_easing.ts'), 'utf-8')

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 8px; font: 14px sans-serif }
#liste { position: relative; width: 300px; border: 5px solid #333; padding: 10px; margin-left: 20px }
#liste li { list-style: none; height: 30px; margin: 4px 0 4px 6px; background: #c63 }
#nu { width: 200px }
#nu li { list-style: none; height: 20px; background: #36c }
#cube { width: 120px; height: 40px; margin: 12px 0 0 30px; background: #369 }
.cible { width: 100px; height: 40px; background: #369 }
</style></head><body>
<ul id="liste"><li id="a">a</li><li id="b">b</li><li id="c">c</li></ul>
<ul id="nu"><li id="x">x</li><li id="y">y</li><li id="z">z</li></ul>
<div id="cube" style="transform: perspective(300px) rotateY(40deg)"></div>
<div id="t1" class="cible"></div><div id="t2" class="cible"></div><div id="t3" class="cible"></div><div id="t4" class="cible"></div>
</body></html>`

describe('moteur des transitions : navigateurs réels', function () {
  this.timeout(60000)

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    // la continuité se juge à la milliseconde près dans WebKit, qui relit l'horloge de la page à chaque lecture du style : une milliseconde (1/600 d'une transition de 600 ms)
    // peut passer entre deux lectures d'une même tâche ; Chromium et Firefox figent l'horloge le temps de la tâche, la tolérance y reste fine
    const continuite = nom === 'webkit' ? 2 / 600 : 0.0001
    describe(nom, function () {
      let browser: any, page: any
      before(async function () {
        if (!(await navigateurPresent(nom))) return this.skip()
        const playwright: any = await import('playwright')
        browser = await playwright[nom].launch()
        page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
        const erreurs: string[] = []
        ;(page as any)._erreurs = erreurs
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.setContent(PAGE)
        await page.evaluate((src: string) => {
          const µ: any = { debug: false, avertissements: [], Ticker: { add() {} } }
          µ.warn = (...a: any[]) => { µ.avertissements.push(a.map(String).join(' ')) }
          µ.log = () => {}
          µ._mjs_txt = (_k: string, _p: any, defaut: string) => defaut
          ;(window as any).µ = µ
          new Function('µ', src)(µ)
        }, SRC)
      })
      after(async function () {
        if (browser) await browser.close()
      })

      it('épinglage avec le rectangle d\'origine (sortie d\'un élément de liste déplacé en bas) : même place à l\'image près', async function () {
        const r = await page.evaluate(() => {
          const µ: any = (window as any).µ
          const liste = document.getElementById('liste') as HTMLElement
          const b = document.getElementById('b') as HTMLElement
          const rect = b.getBoundingClientRect()
          const avant = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          liste.appendChild(b)
          µ._mjs_fixPosition(b, { left: avant.left, top: avant.top })
          const apres = b.getBoundingClientRect()
          const st = getComputedStyle(b)
          const suiveurs = [...liste.children].filter((c) => c !== b).map((c) => Math.round((c as HTMLElement).getBoundingClientRect().top))
          return { avant, apres: { left: apres.left, top: apres.top, width: apres.width, height: apres.height }, position: st.position, margin: st.margin, flag: (b as any)._mjs_posFixed, left: b.style.left, top: b.style.top, w: b.style.width, h: b.style.height, suiveurs }
        })
        assert.equal(r.position, 'absolute')
        assert.equal(r.margin, '0px')
        assert.equal(r.flag, true)
        assert.ok(Math.abs(r.apres.left - r.avant.left) < 0.01, nom + ' : gauche ' + JSON.stringify(r))
        assert.ok(Math.abs(r.apres.top - r.avant.top) < 0.01, nom + ' : haut ' + JSON.stringify(r))
        assert.equal(r.apres.width, r.avant.width)
        assert.equal(r.apres.height, r.avant.height)
        // valeurs mesurées, relatives au bord de remplissage de la liste : remplissage 10 + marge gauche 6 ; haut = 10 + 4 (marge) + 30 + 4 (marge commune) ; largeur = 300 - marge gauche
        assert.deepEqual({ left: r.left, top: r.top, w: r.w, h: r.h }, { left: '16px', top: '48px', w: '294px', h: '30px' })
        assert.equal(r.suiveurs[1] - r.suiveurs[0], 34, 'les frères se resserrent')
      })

      it('retrait de l\'épinglage : tout ce qui a été posé est enlevé', async function () {
        const r = await page.evaluate(() => {
          const µ: any = (window as any).µ
          const b = document.getElementById('b') as HTMLElement
          µ._mjs_unfixPosition(b)
          return { css: b.getAttribute('style') || '', flag: (b as any)._mjs_posFixed, position: getComputedStyle(b).position }
        })
        assert.equal(r.css, '')
        assert.equal(r.flag, false)
        assert.equal(r.position, 'static')
      })

      it('épinglage sans rectangle, parent non positionné : sur la boîte de mise en page, un transform posé ne décale rien', async function () {
        const r = await page.evaluate(() => {
          const µ: any = (window as any).µ
          const y = document.getElementById('y') as HTMLElement
          const rect = y.getBoundingClientRect()
          const avant = { left: rect.left, top: rect.top }
          y.style.transform = 'perspective(200px) rotateX(30deg) translateY(4px)'
          µ._mjs_fixPosition(y)
          y.style.transform = ''
          const apres = y.getBoundingClientRect()
          return { avant, apres: { left: apres.left, top: apres.top }, left: y.style.left, top: y.style.top }
        })
        assert.ok(Math.abs(r.apres.left - r.avant.left) < 0.01, nom + ' : ' + JSON.stringify(r))
        assert.ok(Math.abs(r.apres.top - r.avant.top) < 0.01, nom + ' : ' + JSON.stringify(r))
      })

      it('épinglage sans rectangle dans un parent positionné et bordé : la marge gauche est perdue (6px), le haut ne bouge pas', async function () {
        const r = await page.evaluate(() => {
          const µ: any = (window as any).µ
          const c = document.getElementById('c') as HTMLElement
          const rect = c.getBoundingClientRect()
          const avant = { left: rect.left, top: rect.top }
          µ._mjs_fixPosition(c)
          const apres = c.getBoundingClientRect()
          return { avant, apres: { left: apres.left, top: apres.top }, left: c.style.left, top: c.style.top }
        })
        // la marge est mise à 0 avant la lecture de la boîte de mise en page : la marge gauche de la balise (6px) disparaît du décalage mesuré ;
        // comportement conservé tel quel (seuls les éléments sans marge gauche restent exactement en place)
        assert.equal(r.avant.left - r.apres.left, 6, nom + ' : ' + JSON.stringify(r))
        assert.equal(r.apres.top, r.avant.top, nom + ' : ' + JSON.stringify(r))
        assert.deepEqual({ left: r.left, top: r.top }, { left: '10px', top: '48px' })
      })

      it('épinglage : déjà positionné en absolu ou en fixe, un node sans style ou un nœud texte : rien posé', async function () {
        const r = await page.evaluate(() => {
          const µ: any = (window as any).µ
          const a = document.createElement('div')
          a.style.position = 'absolute'
          document.body.appendChild(a)
          const f = document.createElement('div')
          f.style.position = 'fixed'
          document.body.appendChild(f)
          µ._mjs_fixPosition(a)
          µ._mjs_fixPosition(f)
          µ._mjs_fixPosition(null)
          µ._mjs_fixPosition(document.createTextNode('x'))
          const sortie = { a: a.getAttribute('style'), f: f.getAttribute('style'), fa: (a as any)._mjs_posFixed, ff: (f as any)._mjs_posFixed }
          a.remove()
          f.remove()
          return sortie
        })
        assert.deepEqual(r, { a: 'position: absolute;', f: 'position: fixed;', fa: undefined, ff: undefined })
      })

      it('pas de flash à l\'entrée : la valeur de départ est lue avant la première image, pendant le délai, puis ça monte et le naturel revient', async function () {
        const r = await page.evaluate(async () => {
          const µ: any = (window as any).µ
          const n = document.getElementById('t1') as HTMLElement
          const lire = () => getComputedStyle(n).opacity
          const cfg = { css: (t: number, u: number) => ({ opacity: String(t) }), delay: 120, duration: 240, easing: 'linear' }
          const p = µ._mjs_runTransition(n, cfg, 'in')
          const sync = lire()
          const premiere = await new Promise<string>((res) => requestAnimationFrame(() => res(lire())))
          await new Promise((res) => setTimeout(res, 60))
          const delai = lire()
          await new Promise((res) => setTimeout(res, 180))
          const milieu = parseFloat(lire())
          const dir = await p
          return { sync, premiere, delai, milieu, dir, fin: lire(), actives: n.getAnimations().length, etat: (n as any)._mjs_transition_state }
        })
        assert.equal(r.sync, '0', nom + ' : lu tout de suite')
        assert.equal(r.premiere, '0', nom + ' : première image')
        assert.equal(r.delai, '0', nom + ' : pendant le délai')
        assert.ok(r.milieu > 0.05 && r.milieu < 1, nom + ' : en route, ' + r.milieu)
        assert.equal(r.dir, 'in')
        assert.equal(r.fin, '1')
        assert.equal(r.actives, 0, 'plus aucune animation tenue')
        assert.equal(r.etat, null)
      })

      it('intro coupée par une sortie : la valeur juste après la coupure est celle d\'avant, la sortie tient le 0 jusqu\'à la libération', async function () {
        const r = await page.evaluate(async () => {
          const µ: any = (window as any).µ
          const n = document.getElementById('t2') as HTMLElement
          const lire = () => parseFloat(getComputedStyle(n).opacity)
          const cfg = { css: (t: number, u: number) => ({ opacity: String(t) }), duration: 600, easing: 'linear' }
          const p1 = µ._mjs_runTransition(n, cfg, 'in')
          await new Promise((res) => setTimeout(res, 250))
          const avant = lire()
          const p2 = µ._mjs_runTransition(n, cfg, 'out')
          const apres = lire()
          const d1 = await p1
          const enCours = lire()
          const d2 = await p2
          const tenu = lire()
          const crochet = typeof (n as any)._mjs_pendingFillRelease
          ;(n as any)._mjs_pendingFillRelease()
          return { avant, apres, d1, enCours, d2, tenu, crochet, libere: lire(), actives: n.getAnimations().length }
        })
        assert.ok(r.avant > 0.1 && r.avant < 0.9, nom + ' : à la coupure ' + r.avant)
        assert.ok(Math.abs(r.avant - r.apres) < continuite, nom + ' : continuité ' + r.avant + ' → ' + r.apres)
        assert.equal(r.d1, 'in')
        // même tolérance que la continuité : dans WebKit, l'intro peut avancer d'une milliseconde entre la lecture de `avant` et la coupure
        assert.ok(r.enCours <= r.avant + continuite, nom + ' : redescend ' + r.avant + ' → ' + r.enCours)
        assert.equal(r.d2, 'out')
        assert.equal(r.tenu, 0)
        assert.equal(r.crochet, 'function')
        assert.equal(r.libere, 1, 'naturel une fois le crochet appelé')
        assert.equal(r.actives, 0)
      })

      it('sortie coupée par une intro : même continuité, retour au naturel à la fin', async function () {
        const r = await page.evaluate(async () => {
          const µ: any = (window as any).µ
          const n = document.getElementById('t3') as HTMLElement
          const lire = () => parseFloat(getComputedStyle(n).opacity)
          const cfg = { css: (t: number, u: number) => ({ opacity: String(t) }), duration: 600, easing: 'linear' }
          const p1 = µ._mjs_runTransition(n, cfg, 'out')
          await new Promise((res) => setTimeout(res, 250))
          const avant = lire()
          const p2 = µ._mjs_runTransition(n, cfg, 'in')
          const apres = lire()
          const d1 = await p1
          const d2 = await p2
          return { avant, apres, d1, d2, fin: lire(), actives: n.getAnimations().length, crochet: typeof (n as any)._mjs_pendingFillRelease }
        })
        assert.ok(r.avant > 0.1 && r.avant < 0.9, nom + ' : à la coupure ' + r.avant)
        assert.ok(Math.abs(r.avant - r.apres) < continuite, nom + ' : continuité ' + r.avant + ' → ' + r.apres)
        assert.equal(r.d1, 'out')
        assert.equal(r.d2, 'in')
        assert.equal(r.fin, 1)
        assert.equal(r.actives, 0)
        assert.equal(r.crochet, 'undefined')
      })

      it('coupure pendant le délai d\'une intro par une sortie : rien ne bouge, les deux promesses se rendent', async function () {
        const r = await page.evaluate(async () => {
          const µ: any = (window as any).µ
          const n = document.getElementById('t4') as HTMLElement
          const lire = () => getComputedStyle(n).opacity
          const cfg = { css: (t: number, u: number) => ({ opacity: String(t) }), delay: 400, duration: 200, easing: 'linear' }
          const p1 = µ._mjs_runTransition(n, cfg, 'in')
          await new Promise((res) => setTimeout(res, 80))
          const avant = lire()
          const p2 = µ._mjs_runTransition(n, cfg, 'out')
          const d1 = await p1
          const d2 = await p2
          return { avant, d1, d2, fin: lire(), actives: n.getAnimations().length }
        })
        assert.equal(r.avant, '0')
        assert.equal(r.d1, 'in')
        assert.equal(r.d2, undefined)
        assert.equal(r.fin, '1', 'la bidon est libérée : le naturel revient')
        assert.equal(r.actives, 0)
      })

      it('aucune erreur de page', function () {
        assert.deepEqual((page as any)._erreurs, [])
      })
    })
  }
})
