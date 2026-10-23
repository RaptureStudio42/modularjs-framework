// *tilt(wait, bounce) — l'attente avant le retour et le rebond du retour, réglables.
// wait : durée (0ms) pendant laquelle la carte reste inclinée après que le pointeur est parti ;
// bounce : le dépassement du retour, en part du chemin (0 : aucun ; 0.3 : la carte passe de 30 % de son
// inclinaison de l'autre côté du repos avant de s'y poser), un ressort sous-amorti écrit en courbe CSS.
// Sans l'un ni l'autre rien ne change : mêmes durées, même courbe, aucune variable posée. Au repos après
// le retour, plus aucune animation en cours.
// Le ressort pose une crête de 1 + bounce et un premier creux de 1 - bounce² (la courbe échantillonnée est
// vérifiée sans navigateur) ; un navigateur sans `linear()` garde la courbe d'avant (simulé, avec et sans objet
// CSS) ; une carte reprise pendant son attente ou son retour est mesurée sur sa boîte à plat, celle d'une carte
// revenue à plat est relue. Le navigateur essayé est Chromium, ou Firefox ou WebKit avec NAVIGATEUR.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

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

const STYLE = `<style>
.t
  width: 200px
  height: 120px
  margin: 30px
  background: #234
  color: #fff
</style>`

const SOURCES: Record<string, string> = {
  'rb-defaut.mjs':  `<div class="t" *tilt(max: 20, scale: 1, duration: 400ms)>Carte</div>\n${STYLE}`,
  'rb-attente.mjs': `<div class="t" *tilt(max: 20, scale: 1, duration: 400ms, wait: 500ms)>Carte</div>\n${STYLE}`,
  'rb-rebond.mjs':  `<div class="t" *tilt(max: 20, scale: 1, duration: 800ms, bounce: 0.3)>Carte</div>\n${STYLE}`,
  'rb-atelier.mjs': `<div class="t" *tilt(max: 14.29, scale: 1, perspective: 600, follow: 130ms, duration: 1000ms, wait: 650ms, bounce: 0.28)>Carte</div>\n${STYLE}`,
  'rb-reentree.mjs': `<div class="t" *tilt(max: 20, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`,
  'rb-centre.mjs':  `<div class="t" *tilt(max: 20, scale: 1, duration: 800ms, wait: 2000ms)>Carte</div>\n${STYLE}`,
  'rb-zero.mjs':    `<div class="t" *tilt(max: 20, scale: 1, duration: 400ms, wait: 0)>Carte</div>\n${STYLE}`,
  'rb-var.mjs':     `<script>\n$b = 0.1\n$w = '100ms'\n</script>\n<div class="t" *tilt(bounce: $b, wait: $w)>Carte</div>\n<button class="b" @click={$b = 0.4; $w = '300ms'}>b</button>\n${STYLE}`,
  'rb-bloc.mjs':    `<script>\n$on = true\n</script>\n{if $on}\n<div class="t" *tilt(bounce: 0.3, wait: 200ms)>Carte</div>\n{end}\n<button class="b" @click={$on = !$on}>b</button>\n${STYLE}`
}

describe('*tilt(wait, bounce) — attente et rebond du retour', function () {
  this.timeout(120000)
  let script  = ''
  let fichier = ''
  let present = false

  before(async () => {
    present = await navigateurPresent()
    const root   = mjsTmp('effets-tilt-rebond')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script  = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    fichier = readFileSync(join(process.cwd(), 'src/runtime/mjs_fx_tilt.ts'), 'utf-8')
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('le catalogue : wait 0ms (durée), bounce 0 (0..0.5)', () => {
    assert.equal(EFFECTS.tilt.settings.wait.rule, 'time')
    assert.equal(EFFECTS.tilt.settings.wait.dflt, '0ms')
    assert.equal(EFFECTS.tilt.settings.bounce.dflt, 0)
    assert.match(String(EFFECTS.tilt.settings.bounce.rule), /float 0\.\.0\.5/)
  })

  it('la feuille lit l\'attente et la courbe sous le même repli qu\'avant', () => {
    assert.match(fichier, /transition-delay:var\(--mjs-tilt-wait,0ms\)/)
    assert.match(fichier, /var\(--mjs-tilt-ease,cubic-bezier\(\.2,\.8,\.2,1\)\)/)
    assert.match(fichier, /vars: \{[^}]*wait: ''/)
  })

  describe('dans un composant (happy-dom)', () => {
    let window: any
    before(() => {
      window = new Window({ url: 'http://localhost/' })
      window.eval(script)
    })
    after(() => { window?.close?.() })

    const monte = async (tag: string, fenetre: any = window) => {
      fenetre.document.body.innerHTML = `<${tag}></${tag}>`
      const comp = fenetre.document.querySelector(tag)
      const fin  = Date.now() + 3000
      while (!comp._shadow?.querySelector('.t') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      return comp
    }

    it('sans réglage : aucune variable d\'attente ni de courbe', async () => {
      const el = (await monte('mjs-rb-defaut'))._shadow.querySelector('.t')
      assert.equal(el.style.getPropertyValue('--mjs-tilt-wait'), '')
      assert.equal(el.style.getPropertyValue('--mjs-tilt-ease'), '')
    })

    it('wait : la variable porte l\'attente ; bounce : une courbe linear() qui finit à 1', async () => {
      const a = (await monte('mjs-rb-attente'))._shadow.querySelector('.t')
      assert.equal(a.style.getPropertyValue('--mjs-tilt-wait'), '500ms')
      assert.equal(a.style.getPropertyValue('--mjs-tilt-ease'), '')
      const r = (await monte('mjs-rb-rebond'))._shadow.querySelector('.t')
      const courbe = r.style.getPropertyValue('--mjs-tilt-ease')
      assert.match(courbe, /^linear\(0,/)
      assert.match(courbe, /,1\)$/)
      assert.ok(courbe.split(',').some((v: string) => parseFloat(v) > 1.2), 'la courbe dépasse 1')
    })

    it('un navigateur sans linear() (ou sans objet CSS) : aucune courbe de rebond n\'est posée, ni à la pose ni quand la variable change — la courbe d\'avant reste', async () => {
      const sans = async (prepare: (w: any) => void) => {
        const w = new Window({ url: 'http://localhost/' })
        prepare(w)
        w.eval(script)
        try {
          const comp = await monte('mjs-rb-rebond', w)
          assert.equal(comp._shadow.querySelector('.t').style.getPropertyValue('--mjs-tilt-ease'), '')
          const v = await monte('mjs-rb-var', w)
          const el = v._shadow.querySelector('.t')
          assert.equal(el.style.getPropertyValue('--mjs-tilt-ease'), '')
          v._shadow.querySelector('.b').click()
          const fin = Date.now() + 3000
          while (el.style.getPropertyValue('--mjs-tilt-wait') !== '300ms' && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
          assert.equal(el.style.getPropertyValue('--mjs-tilt-wait'), '300ms', 'le réglage a bien changé')
          assert.equal(el.style.getPropertyValue('--mjs-tilt-ease'), '', 'rebond 0.4 écrit, toujours aucune courbe')
        }
        finally {
          w.close?.()
        }
      }
      // linear() refusé par CSS.supports
      await sans((w) => Object.defineProperty(w, 'CSS', { value: { supports: (_p: string, v: string) => !/linear\(/.test(v) }, configurable: true }))
      // aucun objet CSS
      await sans((w) => Object.defineProperty(w, 'CSS', { value: undefined, configurable: true }))
    })

    // les échantillons de la courbe `linear(0,…,1)` posée pour un rebond
    const courbe = async (tag: string) => {
      const el = (await monte(tag))._shadow.querySelector('.t')
      const v = el.style.getPropertyValue('--mjs-tilt-ease')
      return v.replace(/^linear\(|\)$/g, '').split(',').map(Number)
    }

    it('le ressort : la crête vaut 1 + bounce (au pas d\'échantillonnage près) et le premier creux 1 − bounce², pour deux rebonds ; 49 points, de 0 à 1', async () => {
      for (const [tag, b] of [['mjs-rb-rebond', 0.3], ['mjs-rb-atelier', 0.28]] as const) {
        const p = await courbe(tag)
        assert.equal(p.length, 49, tag + ' : 48 pas puis 1')
        assert.equal(p[0], 0)
        assert.equal(p[48], 1)
        const crete = Math.max(...p)
        const i = p.indexOf(crete)
        let j = i
        while (j + 1 < p.length && p[j + 1] <= p[j]) j++
        let k = j
        while (k + 1 < p.length && p[k + 1] >= p[k]) k++
        let m = j
        while (m + 1 < p.length && p[m + 1] <= p[m]) m++
        assert.ok(Math.abs(crete - (1 + b)) < 0.01, `${tag} : crête ${crete} pour ${(1 + b).toFixed(2)}`)
        assert.ok(Math.abs(p[m] - (1 - b * b)) < 0.01, `${tag} : premier creux ${p[m]} pour ${(1 - b * b).toFixed(3)}`)
      }
    })

    it('des variables de l\'appli : la courbe et l\'attente suivent sans reposer l\'effet', async () => {
      const comp = await monte('mjs-rb-var')
      const el   = comp._shadow.querySelector('.t')
      const off  = el._mjs_fxOff.tilt
      const avant = el.style.getPropertyValue('--mjs-tilt-ease')
      assert.equal(el.style.getPropertyValue('--mjs-tilt-wait'), '100ms')
      comp._shadow.querySelector('.b').click()
      const fin = Date.now() + 3000
      while (el.style.getPropertyValue('--mjs-tilt-wait') !== '300ms' && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      assert.equal(el.style.getPropertyValue('--mjs-tilt-wait'), '300ms')
      assert.notEqual(el.style.getPropertyValue('--mjs-tilt-ease'), avant, 'la courbe a changé')
      assert.ok(el._mjs_fxOff.tilt === off, 'le même effet : rien n\'a été reposé')
    })

    it('retiré avec sa balise : ni marque ni variable', async () => {
      const comp = await monte('mjs-rb-bloc')
      const el   = comp._shadow.querySelector('.t')
      assert.notEqual(el.style.getPropertyValue('--mjs-tilt-ease'), '')
      comp._shadow.querySelector('.b').click()
      const fin = Date.now() + 3000
      while (comp._shadow.querySelector('.t') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
      assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''), 'variable restée : ' + el.getAttribute('style'))
    })
  })

  describe(`navigateur réel (${NAVIGATEUR})`, () => {
    const lance = async () => ((await import('playwright')) as any)[NAVIGATEUR].launch()

    // `sansLinear` : un navigateur qui ne connaît pas la courbe `linear()` (la page l'apprend de `CSS.supports`, comme l'effet)
    async function ouvre(browser: any, tag: string, sansLinear = false) {
      const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      if (sansLinear) {
        await page.addInitScript(() => {
          const vrai = CSS.supports.bind(CSS)
          ;(CSS as any).supports = (a: string, b?: string) => /linear\(/.test(String(b ?? a)) ? false : vrai(a, b as string)
        })
      }
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.t'), tag)
      await page.waitForTimeout(300)
      return { page, erreurs }
    }

    // survole le bord gauche à mi-hauteur (l'inclinaison est alors en Y seulement), sort, et relève
    // l'angle Y à chaque image pendant `duree` ms : [{ t: ms depuis la sortie, a: degrés }]
    async function retour(page: any, tag: string, duree: number, dx = 20) {
      const r = await page.evaluate((t: string) => {
        const b = (document.querySelector(t) as any)._shadow.querySelector('.t').getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      }, tag)
      await page.mouse.move(2, 2)
      await page.waitForTimeout(200)
      await page.mouse.move(r.x + 10, r.y + r.h / 2)
      await page.mouse.move(r.x + dx, r.y + r.h / 2)
      await page.waitForTimeout(300)
      await page.evaluate(([t, d]: [string, number]) => {
        const el = (document.querySelector(t) as any)._shadow.querySelector('.t')
        const w = window as any
        w.__s = []
        const angle = () => {
          const m = new DOMMatrix(getComputedStyle(el).transform)
          return Math.atan2(-m.m13, m.m11) * 180 / Math.PI
        }
        w.__s.push({ t: -1, a: angle() })
        let t0 = 0
        el.addEventListener('pointerleave', () => { t0 = performance.now() })
        const boucle = () => {
          if (t0) w.__s.push({ t: performance.now() - t0, a: angle() })
          if (!t0 || performance.now() - t0 < d) requestAnimationFrame(boucle)
        }
        requestAnimationFrame(boucle)
      }, [tag, duree])
      await page.mouse.move(2, 2)
      await page.waitForTimeout(duree + 200)
      return page.evaluate(() => (window as any).__s as { t: number, a: number }[])
    }

    const animations = (page: any, tag: string) => page.evaluate((t: string) => {
      const el = (document.querySelector(t) as any)._shadow.querySelector('.t')
      const cs = getComputedStyle(el)
      return { n: el.getAnimations().length, delai: cs.transitionDelay, courbe: cs.transitionTimingFunction, duree: cs.transitionDuration }
    }, tag)

    it('défaut : repli inchangé (0,4 s, courbe d\'avant, sans délai), retour direct sans dépassement, zéro animation au repos', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-defaut')
        const repos = await animations(page, 'mjs-rb-defaut')
        assert.equal(repos.delai, '0s')
        assert.equal(repos.courbe, 'cubic-bezier(0.2, 0.8, 0.2, 1)')
        assert.equal(repos.duree, '0.4s')
        const s = await retour(page, 'mjs-rb-defaut', 800)
        const depart = s[0].a
        assert.ok(Math.abs(depart) > 15, 'inclinée : ' + depart)
        const apres = s.filter((p) => p.t >= 0)
        assert.ok(apres.every((p) => p.a * depart >= -0.01), 'aucun dépassement')
        assert.ok(apres.some((p) => p.t < 120 && Math.abs(p.a) < Math.abs(depart) - 1), 'le retour part tout de suite')
        assert.ok(Math.abs(apres[apres.length - 1].a) < 0.01, 'à plat')
        assert.equal((await animations(page, 'mjs-rb-defaut')).n, 0, 'zéro animation au repos')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('wait : rien ne bouge pendant l\'attente, puis la carte revient et se pose', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-attente')
        assert.equal((await animations(page, 'mjs-rb-attente')).delai, '0.5s')
        const s = await retour(page, 'mjs-rb-attente', 1400)
        const depart = s[0].a
        assert.ok(Math.abs(depart) > 15, 'inclinée : ' + depart)
        const attente = s.filter((p) => p.t >= 0 && p.t < 450)
        assert.ok(attente.length > 3, 'des images relevées pendant l\'attente')
        assert.ok(attente.every((p) => Math.abs(p.a - depart) < 0.3), 'rien ne bouge pendant l\'attente')
        assert.ok(s.some((p) => p.t > 700 && Math.abs(p.a) < Math.abs(depart) - 3), 'le retour a eu lieu après l\'attente')
        assert.ok(Math.abs(s[s.length - 1].a) < 0.01, 'à plat')
        assert.equal((await animations(page, 'mjs-rb-attente')).n, 0, 'zéro animation au repos')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('wait: 0 (sans unité) est accepté : le délai calculé vaut 0s et la carte revient aussitôt', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-zero')
        assert.equal((await animations(page, 'mjs-rb-zero')).delai, '0s')
        const s = await retour(page, 'mjs-rb-zero', 800)
        const depart = s[0].a
        assert.ok(Math.abs(depart) > 15, 'inclinée : ' + depart)
        assert.ok(s.filter((p) => p.t >= 0).some((p) => p.t < 120 && Math.abs(p.a) < Math.abs(depart) - 1), 'le retour part tout de suite')
        assert.ok(Math.abs(s[s.length - 1].a) < 0.01, 'à plat')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // survole le bord gauche à mi-hauteur, sort, FIGE la transition de retour dès qu'elle existe, puis relève l'angle à des instants
    // donnés de sa propre ligne de temps (de 0 à la fin, toutes les 5 ms) : [{ t: ms depuis le début de la transition, a: degrés }].
    // Rien ne dépend du nombre d'images que la machine chargée laisse passer : le navigateur calcule la valeur à l'instant demandé.
    async function retourFige(page: any, tag: string, dx: number) {
      const r = await page.evaluate((t: string) => {
        const el = (document.querySelector(t) as any)._shadow.querySelector('.t')
        const w = window as any
        w.__carte = el
        w.__angle = () => { const m = new DOMMatrix(getComputedStyle(el).transform); return Math.atan2(-m.m13, m.m11) * 180 / Math.PI }
        const b = el.getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      }, tag)
      await page.mouse.move(2, 2)
      await page.waitForTimeout(200)
      await page.mouse.move(r.x + 10, r.y + r.h / 2)
      await page.mouse.move(r.x + dx, r.y + r.h / 2)
      // la carte a fini de suivre le pointeur (plus de transition de transform) avant qu'il parte
      await page.waitForFunction(() => !(window as any).__carte.getAnimations().some((a: any) => a.transitionProperty === 'transform'), null, { timeout: 10000 })
      await page.mouse.move(2, 2)
      const fige = await page.evaluate(() => {
        const a = (window as any).__carte.getAnimations().find((x: any) => x.transitionProperty === 'transform')
        if (!a) return false
        a.pause()
        ;(window as any).__fige = a
        return true
      })
      assert.ok(fige, 'la transition de retour existe à la sortie du pointeur')
      return page.evaluate(() => {
        const angle = (window as any).__angle as () => number
        const a = (window as any).__fige
        const fin = a.effect.getComputedTiming().endTime as number
        const serie: { t: number, a: number }[] = []
        for (let t = 0; t < fin; t += 5) {
          a.currentTime = t
          serie.push({ t, a: angle() })
        }
        a.currentTime = fin
        serie.push({ t: fin, a: angle() })
        return { serie, delai: a.effect.getTiming().delay, duree: a.effect.getTiming().duration }
      })
    }

    it('réglage de l\'atelier : pic de l\'ordre de 14,3°, attente de 650 ms, creux de l\'ordre de -4°, puis le repos (angles lus à des instants donnés de la transition, pas par image)', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-atelier')
        const { serie: s, delai, duree } = await retourFige(page, 'mjs-rb-atelier', 0.2)
        assert.equal(delai, 650, 'le délai de la transition est l\'attente')
        assert.equal(duree, 1000, 'sa durée est le retour')
        const depart = s[0].a
        const bouge  = s.find((p) => Math.abs(p.a - depart) > 0.3)
        const creux  = s.reduce((m, p) => p.a * Math.sign(depart) < m.a * Math.sign(depart) ? p : m, s[0])
        console.log('atelier : pic ' + depart.toFixed(2) + '°, premier mouvement à ' + (bouge ? bouge.t.toFixed(0) : '-') + ' ms, creux ' + creux.a.toFixed(2) + '° à ' + creux.t.toFixed(0) + ' ms, fin ' + s[s.length - 1].a.toFixed(3) + '°')
        assert.ok(Math.abs(depart) > 14.1 && Math.abs(depart) < 14.4, 'pic ' + depart)
        assert.ok(s.filter((p) => p.t < 640).every((p) => Math.abs(p.a - depart) < 0.001), 'rien ne bouge pendant l\'attente')
        assert.ok(bouge && bouge.t >= 640 && bouge.t < 800, 'attente ' + (bouge && bouge.t))
        assert.ok(-creux.a * Math.sign(depart) > 3.4 && -creux.a * Math.sign(depart) < 4.6, 'creux ' + creux.a)
        assert.ok(Math.abs(s[s.length - 1].a) < 0.01, 'à plat')
        // la transition menée à son terme : la carte est à plat et plus rien ne tourne
        await page.evaluate(() => (window as any).__fige.finish())
        assert.equal((await animations(page, 'mjs-rb-atelier')).n, 0, 'zéro animation au repos')
        assert.ok(Math.abs(await page.evaluate(() => (window as any).__angle())) < 0.01, 'à plat au repos')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('navigateur sans linear() (simulé) : le rebond demandé garde la courbe d\'avant — aucune variable de courbe, le retour ne dépasse pas', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-rebond', true)
        assert.equal(await page.evaluate(() => CSS.supports('transition-timing-function', 'linear(0,1)')), false, 'la page ne connaît pas linear()')
        const repos = await animations(page, 'mjs-rb-rebond')
        assert.equal(repos.courbe, 'cubic-bezier(0.2, 0.8, 0.2, 1)')
        assert.equal(await page.evaluate(() => ((document.querySelector('mjs-rb-rebond') as any)._shadow.querySelector('.t') as HTMLElement).style.getPropertyValue('--mjs-tilt-ease')), '')
        const s = await retour(page, 'mjs-rb-rebond', 1500)
        const depart = s[0].a
        assert.ok(Math.abs(depart) > 15, 'inclinée : ' + depart)
        assert.ok(s.filter((p) => p.t >= 0).every((p) => p.a * depart >= -0.01), 'aucun dépassement')
        assert.ok(Math.abs(s[s.length - 1].a) < 0.01, 'à plat')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // ce que la carte `tag` a posé (les variables du suivi) et ce qu'elle montre (l'angle du matriciel), avec le dernier point du pointeur noté par la page
    const angles = (page: any, tag: string) => page.evaluate((t: string) => {
      const el = (document.querySelector(t) as any)._shadow.querySelector('.t')
      const m = new DOMMatrix(getComputedStyle(el).transform)
      return { p: (window as any).__p as number[], rx: parseFloat(el.style.getPropertyValue('--mjs-fx-tilt-rx')), ry: parseFloat(el.style.getPropertyValue('--mjs-fx-tilt-ry')), vu: Math.atan2(-m.m13, m.m11) * 180 / Math.PI }
    }, tag)
    const noter = (page: any) => page.evaluate(() => {
      const w = window as any
      w.__p = null
      window.addEventListener('pointermove', (e: any) => { w.__p = [e.clientX, e.clientY] }, true)
    })
    const plate = (page: any, tag: string) => page.evaluate((t: string) => { const b = (document.querySelector(t) as any)._shadow.querySelector('.t').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }, tag)
    // l'angle qu'un pointeur réclame à cet endroit d'une carte à plat de boîte `plat` (max 20, sens toward)
    const attendu = (p: number[], plat: any) => {
      const x = Math.min(1, Math.max(0, (p[0] - plat.x) / plat.w))
      const y = Math.min(1, Math.max(0, (p[1] - plat.y) / plat.h))
      return { rx: (y - 0.5) * 2 * 20, ry: (0.5 - x) * 2 * 20 }
    }
    const compare = (a: any, e: any, quand: string) => {
      assert.ok(Math.abs(a.ry - e.ry) < 0.05, `${quand} : ry ${a.ry} pour ${e.ry.toFixed(2)}`)
      assert.ok(Math.abs(a.rx - e.rx) < 0.05, `${quand} : rx ${a.rx} pour ${e.rx.toFixed(2)}`)
      assert.ok(Math.abs(a.vu - e.ry) < 0.1, `${quand} : l'angle vu ${a.vu.toFixed(2)} pour ${e.ry.toFixed(2)}`)
    }

    it('ré-entrée pendant l\'attente : la carte encore inclinée se mesure comme à plat — au centre l\'angle est nul, à 90 % de la largeur il vaut le réglage, et la boîte se lit au plus une fois', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-reentree')
        const plat = await plate(page, 'mjs-rb-reentree')
        const cy = plat.y + plat.h / 2
        await noter(page)
        // entrée à plat par le bord : la carte s'incline ; elle sort (attente de 2 s) ; reprise 0,3 s plus tard, encore inclinée
        await page.mouse.move(2, 2)
        await page.waitForTimeout(200)
        await page.mouse.move(plat.x + 10, cy)
        await page.mouse.move(plat.x + 20, cy)
        await page.waitForTimeout(300)
        const incline = (await angles(page, 'mjs-rb-reentree')).vu
        assert.ok(Math.abs(incline) > 15, 'inclinée : ' + incline)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        await page.evaluate(() => {
          const w = window as any
          w.__lectures = 0
          const o = Element.prototype.getBoundingClientRect
          Element.prototype.getBoundingClientRect = function (this: any) { w.__lectures++; return o.call(this) }
        })
        for (const part of [0.5, 0.9]) {
          await page.mouse.move(plat.x + plat.w * part, cy)
          await page.waitForTimeout(450)
          const a = await angles(page, 'mjs-rb-reentree')
          console.log(`ré-entrée à ${part * 100} % : angle posé ${a.ry.toFixed(2)}° (attendu ${attendu(a.p, plat).ry.toFixed(2)}°), vu ${a.vu.toFixed(2)}°`)
          compare(a, attendu(a.p, plat), `à ${part * 100} %`)
        }
        assert.ok(await page.evaluate(() => (window as any).__lectures) <= 1, 'la boîte se lit au plus une fois, à l\'entrée')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('ré-entrée d\'une carte revenue à plat qui a bougé depuis (une autre animation tourne sur elle) : la boîte est relue, l\'angle vient de sa place d\'aujourd\'hui', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-attente')
        await page.evaluate(() => {
          const el = (document.querySelector('mjs-rb-attente') as any)._shadow.querySelector('.t')
          el.animate([{ opacity: 1 }, { opacity: 0.9 }], { duration: 1000, iterations: Infinity, direction: 'alternate' })
        })
        await noter(page)
        // deux passages : à sa place, puis plus bas de 40 px (la mise en page a changé entre les deux entrées)
        for (const decalage of [0, 40]) {
          await page.evaluate((d: number) => { ((document.querySelector('mjs-rb-attente') as any)._shadow.querySelector('.t') as HTMLElement).style.marginTop = (30 + d) + 'px' }, decalage)
          await page.mouse.move(2, 2)
          // revenue à plat : attente (0,5 s) et retour (0,4 s) finis
          await page.waitForTimeout(1300)
          const plat = await plate(page, 'mjs-rb-attente')
          await page.mouse.move(plat.x + plat.w * 0.75, plat.y + plat.h * 0.5)
          await page.waitForTimeout(450)
          const a = await angles(page, 'mjs-rb-attente')
          compare(a, attendu(a.p, plat), `carte décalée de ${decalage} px`)
        }
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('ré-entrée PILE au centre pendant l\'attente avec scale: 1 (la cible du pointeur vaut celle du repos) : le suivi reprend aussitôt, délai remis à zéro, et la carte rejoint l\'angle du pointeur', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-centre')
        const plat = await plate(page, 'mjs-rb-centre')
        const cy = plat.y + plat.h / 2
        await noter(page)
        // la carte s'incline par le bord, le pointeur sort (attente de 2 s), il revient 0,3 s plus tard PILE au centre
        await page.mouse.move(2, 2)
        await page.waitForTimeout(200)
        await page.mouse.move(plat.x + 10, cy)
        await page.mouse.move(plat.x + 20, cy)
        // la carte a fini de suivre le pointeur avant qu'il parte
        await page.waitForFunction(() => {
          const el = (document.querySelector('mjs-rb-centre') as any)._shadow.querySelector('.t')
          const m = new DOMMatrix(getComputedStyle(el).transform)
          return Math.abs(Math.atan2(-m.m13, m.m11) * 180 / Math.PI) > 15
        }, null, { timeout: 10000 })
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        // le délai et la durée de chaque transition de `transform` qui naît à la ré-entrée, lus à sa naissance
        await page.evaluate(() => {
          const el = (document.querySelector('mjs-rb-centre') as any)._shadow.querySelector('.t')
          const w = window as any
          w.__naissances = []
          el.addEventListener('transitionrun', (e: any) => {
            const a = el.getAnimations().find((x: any) => x.transitionProperty === 'transform')
            if (e.propertyName === 'transform' && a) w.__naissances.push({ delai: a.effect.getTiming().delay, duree: a.effect.getTiming().duration })
          })
        })
        await page.mouse.move(plat.x + plat.w / 2, cy)
        // la carte rejoint le pointeur dans la seconde qui suit (l'attente de 2 s l'aurait laissée inclinée jusqu'à 1,7 s plus tard)
        const rejoint = await page.waitForFunction(() => {
          const el = (document.querySelector('mjs-rb-centre') as any)._shadow.querySelector('.t')
          const m = new DOMMatrix(getComputedStyle(el).transform)
          return Math.abs(Math.atan2(-m.m13, m.m11) * 180 / Math.PI) < 0.1
        }, null, { timeout: 1000 }).then(() => true, () => false)
        const a = await angles(page, 'mjs-rb-centre')
        console.log(`ré-entrée au centre, scale 1 : angle posé ${a.ry.toFixed(2)}°, vu ${a.vu.toFixed(2)}°, rejoint ${rejoint}`)
        assert.equal(a.p[0], plat.x + plat.w / 2, 'le pointeur est pile au centre')
        assert.equal(a.ry, 0, 'le pointeur au centre demande un angle nul')
        assert.ok(rejoint, `la carte est encore inclinée (${a.vu.toFixed(2)}°) une seconde après la ré-entrée : le délai de l'attente la tient`)
        assert.ok(Math.abs(a.vu) < 0.1, 'à plat sous le pointeur')
        await page.waitForFunction(() => (window as any).__naissances.length > 0, null, { timeout: 5000 })
        const n = await page.evaluate(() => (window as any).__naissances as { delai: number, duree: number }[])
        assert.deepEqual(n[n.length - 1], { delai: 0, duree: 100 }, 'la transition qui la ramène est celle du suivi : sans délai, en 100 ms')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('bounce : la carte dépasse son repos du signe opposé (de l\'ordre du réglage), puis s\'y pose sans reste', async function () {
      if (!present) { this.skip(); return }
      const browser = await lance()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-rb-rebond')
        const s = await retour(page, 'mjs-rb-rebond', 1500)
        const depart = s[0].a
        assert.ok(Math.abs(depart) > 15, 'inclinée : ' + depart)
        const signe = Math.sign(depart)
        const dep = Math.max(...s.filter((p) => p.t >= 0).map((p) => -signe * p.a))
        assert.ok(dep > 0.15 * Math.abs(depart) && dep < 0.5 * Math.abs(depart), 'dépassement de ' + dep.toFixed(2) + '° sur ' + Math.abs(depart).toFixed(2) + '°')
        assert.ok(Math.abs(s[s.length - 1].a) < 0.01, 'à plat')
        assert.equal((await animations(page, 'mjs-rb-rebond')).n, 0, 'zéro animation au repos')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
})
