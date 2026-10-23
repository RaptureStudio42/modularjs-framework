// *stagger au défilement (`on: scroll`) dans Chromium et Firefox réels : l'avancée est écrite sur chaque unité qui s'anime
// (mot, lettre, enfant), jamais sur la balise, et sans héritage — écrite sur la balise, la variable force le recalcul du
// style de TOUS les descendants à chaque image (144 éléments pour un paragraphe de cinq lignes). Et les mots d'une ligne
// et les enfants ont leur calque pendant l'arrivée seulement (l'avancée entre 0 et 1 ; `will-change: transform, opacity`),
// chacun tant que SA propre arrivée est en cours (début et fin de son animation) : sans lui, l'animation en pause dont le
// délai change à chaque image repeint le calque du parent (10 tuiles par image mesurées) ; avant l'arrivée, une fois
// finie et au repos (ligne finie, enfant démarqué) le calque n'est pas là. Une lettre ou un mot n'en a pas. Et l'avancée
// n'est écrite que si elle change : rien hors de l'arrivée.

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

const TEXTE = 'Un paragraphe qui tient sur plusieurs lignes dans une boîte étroite, pour que la mise en page fasse tomber les mots où elle veut.'

const scene = (corps: string) => `<div class="haut"></div>\n${corps}\n<div class="bas"></div>\n<style>\n.haut\n  height: 700px\n.bas\n  height: 1800px\n.texte\n  width: 300px\n  margin: 0\n  font: 20px/28px sans-serif\n.menu\n  display: flex\n  flex-direction: column\n  align-items: flex-start\n  margin: 0\n  padding: 0\n  list-style: none\n  font: 20px/28px sans-serif\n</style>\n`

const SOURCES: Record<string, string> = {
  'gpu-ligne.mjs':   scene(`<p class="texte" *stagger(unit: line, clip: true, opacity: 1, easing: linear, duration: 600ms, step: 200ms, distance: 52, on: scroll)>${TEXTE}</p>`),
  'gpu-mot.mjs':     scene(`<p class="texte" *stagger(unit: word, opacity: 0.2, on: scroll)>${TEXTE}</p>`),
  'gpu-lettre.mjs':  scene(`<p class="texte" *stagger(opacity: 0.2, on: scroll)>${TEXTE}</p>`),
  'gpu-enfant.mjs':  scene('<ul class="menu" *stagger(unit: child, opacity: 1, duration: 500ms, step: 150ms, on: scroll)><li>Accueil</li><li>Projets</li><li>Journal</li><li>Contact</li></ul>')
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function jusqua<T>(lire: () => Promise<T>, bon: (v: T) => boolean, ms = 4000): Promise<T> {
  const fin = Date.now() + ms
  let v = await lire()
  while (!bon(v) && Date.now() < fin) {
    await attendre(50)
    v = await lire()
  }
  return v
}

describe('*stagger au défilement (navigateurs réels) — l\'avancée sur chaque unité, sans héritage, un calque par unité pendant l\'arrivée', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox'))) return
    const root   = mjsTmp('effets-stagger-gpu')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
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
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function avec<T>(tag: string, fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        try {
          // chaque écriture de l'avancée sur une unité, comptée à la source
          await page.addInitScript(() => {
            const w = window as any
            w.__ecrit = 0
            const ecrire = CSSStyleDeclaration.prototype.setProperty
            CSSStyleDeclaration.prototype.setProperty = function (this: any, nom: any, ...reste: any[]) {
              if (String(nom) === '--mjs-fx-stagger-p') w.__ecrit++
              return (ecrire as any).call(this, nom, ...reste)
            }
          })
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx~="stagger"][mjs-fx-stagger-scroll]'), tag)
          await page.waitForTimeout(300)
          const rendu = await fn(page)
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
          return rendu
        }
        finally {
          await page.close()
        }
      }

      // ce qu'on lit sur la balise et sur ses unités (mots, lettres, enfants) : l'avancée écrite, le calque demandé, ce que voit un descendant
      const lire = (page: any, tag: string, unites: string) => page.evaluate(([t, u]: [string, string]) => {
        const sh    = (document.querySelector(t) as any)._shadow
        const el    = sh.querySelector('[mjs-fx~="stagger"]')
        const us    = Array.from(sh.querySelectorAll(u)) as any[]
        const fond  = us.length > 0 ? us[0].querySelector('[mjs-fx-letter]') || us[0].firstElementChild : null
        return {
          balise:   el.style.getPropertyValue('--mjs-fx-stagger-p'),
          nombre:   us.length,
          ecrites:  us.map((n) => n.style.getPropertyValue('--mjs-fx-stagger-p')),
          calque:   us.map((n) => getComputedStyle(n).willChange),
          fils:     fond ? getComputedStyle(fond).getPropertyValue('--mjs-fx-stagger-p').trim() : null
        }
      }, [tag, unites])
      const defile = (page: any, y: number) => page.evaluate((v: number) => scrollTo(0, v), y)

      for (const cas of [
        { nom: 'ligne',  tag: 'mjs-gpu-ligne',  unites: '[mjs-fx-word]',  calque: true },
        { nom: 'mot',    tag: 'mjs-gpu-mot',    unites: '[mjs-fx-word]',  calque: true },
        { nom: 'lettre', tag: 'mjs-gpu-lettre', unites: '[mjs-fx-letter]', calque: false },
        { nom: 'enfant', tag: 'mjs-gpu-enfant', unites: '[mjs-fx-child]', calque: true }
      ]) {
        it(`unit ${cas.nom} : l'avancée est écrite sur chaque unité et pas sur la balise ; ses descendants ne la voient pas`, async function () {
          if (!present) { this.skip(); return }
          await avec(cas.tag, async (page) => {
            if (!(await page.evaluate(() => typeof (window as any).CSS?.registerProperty === 'function'))) { this.skip(); return }
            await defile(page, 250)
            const r = await jusqua(() => lire(page, cas.tag, cas.unites), (x: any) => x.nombre > 0 && x.ecrites.every((e: string) => e !== ''), 3000)
            assert.ok(r.nombre > 0, 'des unités sont posées')
            assert.equal(r.balise, '', 'rien n\'est écrit sur la balise')
            assert.ok(r.ecrites.every((e: string) => e !== '' && !isNaN(Number(e))), `chaque unité porte l'avancée : ${JSON.stringify(r.ecrites.slice(0, 4))}`)
            assert.equal(new Set(r.ecrites).size, 1, 'la même avancée sur chaque unité')
            const p = Number(r.ecrites[0])
            assert.ok(p > 0 && p < 1, `l'arrivée est en cours : ${p}`)
            // un descendant d'une unité voit la valeur de départ de la variable enregistrée, pas celle de l'unité
            if (r.fils !== null) assert.equal(r.fils, '0', 'la variable n\'est pas héritée par les descendants')
            // le défilement la fait avancer
            await defile(page, 320)
            const s = await jusqua(() => lire(page, cas.tag, cas.unites), (x: any) => Number(x.ecrites[0]) > p, 3000)
            assert.ok(Number(s.ecrites[0]) > p, `l'avancée suit le défilement : ${p} puis ${s.ecrites[0]}`)
            assert.equal(s.balise, '', 'toujours rien sur la balise')
          })
        })
      }

      for (const cas of [
        { nom: 'ligne', tag: 'mjs-gpu-ligne', unites: '[mjs-fx-word]' },
        { nom: 'enfant', tag: 'mjs-gpu-enfant', unites: '[mjs-fx-child]' }
      ]) {
        it(`unit ${cas.nom} : des unités ont leur calque tant que l'arrivée est en cours, aucune avant`, async function () {
          if (!present) { this.skip(); return }
          await avec(cas.tag, async (page) => {
            const avant = await jusqua(() => lire(page, cas.tag, cas.unites), (x: any) => x.nombre > 0, 3000)
            assert.ok(avant.calque.every((c: string) => c === 'auto'), `avant l'arrivée : will-change: auto — ${JSON.stringify(avant.calque.slice(0, 3))}`)
            await defile(page, 250)
            const r = await jusqua(() => lire(page, cas.tag, cas.unites), (x: any) => x.nombre > 0 && x.ecrites.every((e: string) => e !== '') && x.calque.some((c: string) => /transform/.test(c)), 3000)
            assert.ok(r.nombre > 0, 'des unités sont posées')
            // celles dont l'arrivée est en cours (le détail, unité par unité : « SA propre arrivée », plus bas)
            assert.ok(r.calque.some((c: string) => /transform/.test(c) && /opacity/.test(c)), `pendant l'arrivée : will-change: transform, opacity sur les unités en cours d'arrivée — ${JSON.stringify(r.calque.slice(0, 3))}`)
          })
        })
      }

      for (const cas of [
        { nom: 'lettre', tag: 'mjs-gpu-lettre', unites: '[mjs-fx-letter]' },
        { nom: 'mot', tag: 'mjs-gpu-mot', unites: '[mjs-fx-word]' }
      ]) {
        it(`unit ${cas.nom} : pas de calque par ${cas.nom} (des centaines de calques, sans repos pour les rendre)`, async function () {
          if (!present) { this.skip(); return }
          await avec(cas.tag, async (page) => {
            await defile(page, 250)
            const r = await jusqua(() => lire(page, cas.tag, cas.unites), (x: any) => x.nombre > 0 && x.ecrites.every((e: string) => e !== ''), 3000)
            assert.ok(r.calque.every((c: string) => c === 'auto'), `will-change: auto sur chaque unité : ${JSON.stringify(r.calque.slice(0, 3))}`)
          })
        })
      }

      // les écritures de l'avancée pendant `n` images de défilement de 1 px à partir de `y` (l'état se pose d'abord)
      const ecritures = (page: any, y: number, n: number) => page.evaluate(([haut, k]: [number, number]) => new Promise<number>((ok) => {
        const w = window as any
        scrollTo(0, haut)
        setTimeout(() => {
          w.__ecrit = 0
          let i = 0
          const image = () => {
            if (i >= k) { ok(w.__ecrit); return }
            i++
            scrollBy(0, 1)
            requestAnimationFrame(image)
          }
          requestAnimationFrame(image)
        }, 500)
      }), [y, n])

      for (const cas of [
        { nom: 'ligne',  tag: 'mjs-gpu-ligne',  unites: '[mjs-fx-word]' },
        { nom: 'mot',    tag: 'mjs-gpu-mot',    unites: '[mjs-fx-word]' },
        { nom: 'lettre', tag: 'mjs-gpu-lettre', unites: '[mjs-fx-letter]' },
        { nom: 'enfant', tag: 'mjs-gpu-enfant', unites: '[mjs-fx-child]' }
      ]) {
        it(`unit ${cas.nom} : hors de l'arrivée (avant, après) le défilement n'écrit rien sur les unités ; pendant, chaque image l'écrit`, async function () {
          if (!present) { this.skip(); return }
          await avec(cas.tag, async (page) => {
            const avant   = await ecritures(page, 0, 30)
            const apres   = await ecritures(page, 1500, 30)
            const posees  = await lire(page, cas.tag, cas.unites)
            const pendant = await ecritures(page, 250, 30)
            assert.equal(avant, 0, 'avant l\'arrivée : 30 images de défilement, aucune écriture de l\'avancée')
            assert.equal(apres, 0, 'après l\'arrivée : 30 images de défilement, aucune écriture de l\'avancée')
            // lettres et mots n'ont pas de repos : leur état d'arrivée finie (l'avancée à 1) est posé une fois et y reste
            if (cas.nom === 'lettre' || cas.nom === 'mot') assert.ok(posees.nombre > 0 && posees.ecrites.every((e: string) => e === '1'), `l'avancée au bout est posée sur chaque unité : ${JSON.stringify(posees.ecrites.slice(0, 3))}`)
            assert.ok(pendant >= 30, `témoin : pendant l'arrivée, l'avancée est écrite à chaque image (${pendant} écritures en 30 images)`)
          })
        })
      }

      for (const cas of [
        { nom: 'ligne', tag: 'mjs-gpu-ligne', unites: '[mjs-fx-word]' },
        { nom: 'enfant', tag: 'mjs-gpu-enfant', unites: '[mjs-fx-child]' }
      ]) {
        it(`unit ${cas.nom} : chaque unité garde son calque tant que SA propre arrivée est en cours, pas avant son tour, plus une fois finie`, async function () {
          if (!present) { this.skip(); return }
          await avec(cas.tag, async (page) => {
            await defile(page, 250)
            // la phase de l'animation de chaque unité (avant son tour, en cours, finie) et son calque, relevés au repos
            const lireUnites = () => page.evaluate(([t, u]: [string, string]) => {
              const sh = (document.querySelector(t) as any)._shadow
              return (Array.from(sh.querySelectorAll(u)) as any[]).map((n) => {
                const a = n.getAnimations().find((x: any) => (x.animationName || '').indexOf('mjs-fx-stagger') === 0)
                const t = a ? a.effect.getComputedTiming() : null
                const phase = !t || t.localTime === null ? 'aucune' : t.localTime < t.delay ? 'before' : t.localTime < t.delay + t.activeDuration ? 'active' : 'after'
                return { phase, calque: getComputedStyle(n).willChange !== 'auto' }
              })
            }, [cas.tag, cas.unites])
            const r = await jusqua(lireUnites, (x: any[]) => x.length > 0 && x.every((n) => n.calque === (n.phase === 'active')), 3000)
            assert.ok(r.some((n: any) => n.phase === 'active'), `des unités sont en cours d'arrivée : ${JSON.stringify(r.map((n: any) => n.phase))}`)
            assert.ok(r.some((n: any) => n.phase !== 'active'), `des unités sont finies ou attendent leur tour : ${JSON.stringify(r.map((n: any) => n.phase))}`)
            assert.ok(r.every((n: any) => n.calque === (n.phase === 'active')), `le calque de chaque unité suit sa propre arrivée : ${JSON.stringify(r.map((n: any) => n.phase + (n.calque ? ' + calque' : '')))}`)
          })
        })
      }

      it('au bout du défilement, une ligne est au repos : plus de calque', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-ligne', async (page) => {
          await defile(page, 1400)
          const r = await jusqua(() => lire(page, 'mjs-gpu-ligne', '[mjs-fx-word]'), (x: any) => x.nombre > 0 && x.calque.every((c: string) => c === 'auto'), 3000)
          assert.ok(r.calque.every((c: string) => c === 'auto'), `au repos : will-change: auto — ${JSON.stringify(r.calque.slice(0, 3))}`)
        })
      })
    })
  }
})
