// *spotlight en production dans Chromium, Firefox et WebKit réels : le voile posé sur la page entière (`<@document>`) quand la fenêtre change de taille.
// `<html>` garde sa taille quand seule la hauteur de la fenêtre change (une page haute, ou un contenu qui ne la remplit pas) : l'observateur de sa taille
// n'avertit de rien, et ce que l'effet sait de la fenêtre est relu à l'entrée de la souris et à chaque mouvement. Deux choses en dépendent.
// - La lumière toujours allumée avec un retard, la fenêtre redimensionnée pendant que la souris est dehors (la lumière est rentrée au centre, que la
//   feuille lui donne) : à la nouvelle entrée elle part de là où elle est affichée au repos, le centre d'aujourd'hui, et ne saute pas vers le centre d'avant.
//   Si la souris revient avant qu'elle ait fini de rentrer, elle repart de là où elle est — y compris quand la souris était restée sur la zone jusqu'à
//   l'arrivée complète de la lumière avant de sortir (la boucle de la lumière s'est alors arrêtée dessus).
// - Cette seconde entrée est la même pour le voile d'une balise, le liseré et le halo (trois balises d'une même page, dont la largeur suit celle de la fenêtre).
// - Le rayon de l'ombre du voile (`--mjs-fx-veil-r`, la plus grande dimension de la fenêtre) suit la fenêtre, sur la page en survol comme sur la page
//   toujours allumée, et ne s'écrit que lorsqu'il change : jamais une écriture de plus par mouvement de la souris.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// une page haute : son contenu ne dépend pas de la fenêtre, `<html>` garde sa taille quand seule la hauteur de la fenêtre change
const STYLE = '\n<style>\n:host\n  display: block\n.b\n  width: 300px\n  height: 200px\n  margin: 10px\n  background: #fa0\n.haut\n  height: 3000px\n</style>\n'
const CORPS = '<div class="b">Un cadre</div>\n<div class="haut"></div>\n'
// trois balises d'une même page, une par façon d'allumer la lumière (le voile, le liseré, le halo), toujours allumées avec un retard : leur largeur suit celle de la fenêtre
const STYLE_BALISES = '\n<style>\n:host\n  display: block\n.a\n  width: 50vw\n  height: 80px\n</style>\n'
const CORPS_BALISES = [
  '<div class="a voile" *spotlight(where: veil, on: always, smooth: .15)>Un cadre</div>',
  '<div class="a bord" *spotlight(where: border, on: always, smooth: .15)>Un cadre</div>',
  '<div class="a halo" *spotlight(where: fill, on: always, smooth: .15)>Un cadre</div>'
].join('\n') + '\n'
const POSES: Record<string, string> = {
  toujours: CORPS + '<@document *spotlight(where: veil, on: always, smooth: .15)>' + STYLE,
  survol:   CORPS + '<@document *spotlight(where: veil)>' + STYLE,
  balises:  CORPS_BALISES + STYLE_BALISES
}

// le calque du voile de la page (posé dans `<body>`), la place de son disque (le `translate` du disque, relatif au centre du calque) et son rayon
const CALQUE   = `document.body.querySelector('[mjs-fx-layer="spotlight"]')`
const DISQUE   = `(() => { const c = ${CALQUE}; if (!c) return null; const t = getComputedStyle(c.firstChild).translate; const v = t === 'none' ? [] : t.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`
const RAYON    = `(() => { const c = ${CALQUE}; return c ? c.style.getPropertyValue('--mjs-fx-veil-r') : null })()`
const AU_REPOS = `(() => { const c = ${CALQUE}; return !!c && getComputedStyle(c.firstChild).translate === 'none' })()`

// les trois balises (dans le composant `mjs-r-balises`) : leur centre, et la place de leur lumière relative à ce centre — `null` quand la lumière est chez elle
// (la feuille la pose au centre, aucune place écrite) : le disque du voile, les deux variables du liseré, la translation du pseudo-élément du halo
const BALISE = (classe: string) => `document.querySelector('mjs-r-balises')?._shadow?.querySelector('.${classe}')`
const CENTRE = (classe: string) => `(() => { const r = ${BALISE(classe)}.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`
const PLACE: Record<string, string> = {
  voile: `(() => { const b = ${BALISE('voile')}; const c = b.querySelector('[mjs-fx-layer="spotlight"]'); if (!c) return null; const t = getComputedStyle(c.firstChild).translate; if (t === 'none') return null; const v = t.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`,
  bord:  `(() => { const b = ${BALISE('bord')}; const x = b.style.getPropertyValue('--mjs-fx-spot-x'); const y = b.style.getPropertyValue('--mjs-fx-spot-y'); return x === '' ? null : [parseFloat(x) - b.clientWidth / 2, parseFloat(y) - b.clientHeight / 2] })()`,
  halo:  `(() => { const b = ${BALISE('halo')}; const t = getComputedStyle(b, '::after').translate; if (!t || t === 'none') return null; const v = t.split(' ').map(parseFloat); return [(v[0] || 0) - b.clientWidth / 2, (v[1] || 0) - b.clientHeight / 2] })()`
}

// un relevé à chaque image de la lecture `lire` (par défaut la place du disque du voile de la page)
const FILM_DE = (lire: string) => `(() => { const f = window.__film = { v: [], fin: false }; const b = () => { if (f.fin) return; f.v.push(${lire}); requestAnimationFrame(b) }; requestAnimationFrame(b) })()`
const FILM    = FILM_DE(DISQUE)
const FINI    = '(() => { window.__film.fin = true; return window.__film.v })()'

// chaque écriture du rayon de l'ombre sur un style en ligne, posée avant la page
const ESPION_RAYON = `(() => {
  window.__rayons = []
  const pose = CSSStyleDeclaration.prototype.setProperty
  CSSStyleDeclaration.prototype.setProperty = function(nom, valeur, priorite) {
    if (nom === '--mjs-fx-veil-r') window.__rayons.push(String(valeur))
    return pose.call(this, nom, valeur, priorite)
  }
})()`

const sombre = (p: number[]) => p[0] < 70 && p[1] < 70 && p[2] < 70

describe('*spotlight, voile de la page entière : la fenêtre change de taille', function () {
  this.timeout(1800000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [nom, source] of Object.entries(POSES)) {
      const root   = mjsTmp('spotlight-redim-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'r-' + nom + '.mjs'), source)
      // un seul fichier (le manifeste) : la pose est celle d'une application de production
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], nom)
      scripts[nom] = stripEsm(readFileSync(manifeste, 'utf-8'))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
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

      // une page neuve de 340 × 300, le composant monté ; la fenêtre se redimensionne avec `setViewportSize`
      async function ouvre(pose: string) {
        const tag      = 'mjs-r-' + pose
        const contexte = await browser.newContext({ viewport: { width: 340, height: 300 } })
        const page     = await contexte.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
        await page.addInitScript(ESPION_RAYON)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${scripts[pose]}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(`!!document.querySelector('${tag}')`, null, { timeout: 20000 })
        // la lumière toujours allumée a son calque dès la pose ; celle du survol n'en a pas avant la souris
        if (pose === 'toujours') await page.waitForFunction(`!!${CALQUE}`, null, { timeout: 20000 })
        if (pose === 'balises') await page.waitForFunction(`!!${BALISE('voile')}?.querySelector('[mjs-fx-layer="spotlight"]')`, null, { timeout: 20000 })
        await page.waitForTimeout(400)
        const redimensionne = async (largeur: number, hauteur: number) => {
          await page.setViewportSize({ width: largeur, height: hauteur })
          await page.waitForFunction(`document.documentElement.clientWidth === ${largeur} && document.documentElement.clientHeight === ${hauteur}`, null, { timeout: 10000 })
          await page.waitForTimeout(400)
        }
        const pixel = async (x: number, y: number): Promise<number[]> => {
          const shot = await page.screenshot()
          return page.evaluate(`(async ([b64, px, py]) => {
            const img = new Image()
            img.src = 'data:image/png;base64,' + b64
            await img.decode()
            const cv = document.createElement('canvas')
            cv.width = img.width
            cv.height = img.height
            const c = cv.getContext('2d', { willReadFrequently: true })
            c.drawImage(img, 0, 0)
            return Array.from(c.getImageData(px, py, 1, 1).data).slice(0, 3)
          })(${JSON.stringify([shot.toString('base64'), x, y])})`)
        }
        return { page, contexte, erreurs, redimensionne, pixel }
      }

      // la première visite de la lumière toujours allumée : elle naît sous la souris, au centre de la fenêtre ; `coin` : elle suit la souris vers le coin haut droit
      // (130, -120 du centre) et rentre en glissant à la sortie ; sans `coin`, elle est déjà au centre à la sortie et y rentre d'un coup
      async function visite(page: any, coin = true) {
        await page.mouse.move(170, 150, { steps: 1 })
        await page.waitForFunction(`!${AU_REPOS}`, null, { timeout: 10000 })
        if (!coin) return
        await page.mouse.move(300, 30, { steps: 2 })
        await page.waitForFunction(`(() => { const t = ${DISQUE}; return !!t && Math.abs(t[0] - 130) < 0.6 && Math.abs(t[1] + 120) < 0.6 })()`, null, { timeout: 10000 })
      }

      for (const [titre, largeur, hauteur] of [['la hauteur change seule (340 × 300 → 340 × 250)', 340, 250], ['la largeur change seule (340 × 300 → 400 × 300)', 400, 300]] as const) {
        for (const [depart, coin] of [['rentrée du coin en glissant', true], ['déjà au centre à la sortie', false]] as const) {
          it(`toujours allumé avec un retard, ${titre} pendant que la souris est dehors (${depart}) : à la nouvelle entrée la lumière part du centre d'aujourd'hui, sans saut`, async function () {
            if (!browser) { this.skip(); return }
            const { page, contexte, erreurs, redimensionne } = await ouvre('toujours')
            try {
              await visite(page, coin)
              // la souris sort : la lumière rentre au centre et y reste (la feuille la pose, aucune place écrite)
              await page.evaluate(`document.documentElement.dispatchEvent(new PointerEvent('pointerleave'))`)
              await page.waitForFunction(AU_REPOS, null, { timeout: 10000 })
              await redimensionne(largeur, hauteur)
              // la souris rentre au centre d'aujourd'hui : la lumière est déjà dessous, elle n'a nulle part où aller
              await page.evaluate(FILM)
              await page.mouse.move(largeur / 2, hauteur / 2, { steps: 1 })
              await page.waitForTimeout(700)
              const film: Array<[number, number] | null> = await page.evaluate(FINI)
              assert.ok(film.length >= 5 && film.every((v) => v), `des images relevées, le calque présent sur toutes (${film.length})`)
              const vus = film as Array<[number, number]>
              const ecart = Math.max(...vus.map((v) => Math.hypot(v[0], v[1])))
              assert.ok(ecart <= 1, `la lumière ne quitte pas sa place au repos : écart de ${ecart.toFixed(1)} px (images : ${vus.slice(0, 5).map((v) => v.map((x) => x.toFixed(1)).join(' ')).join(' | ')})`)
              assert.deepEqual(erreurs, [])
            }
            finally {
              await contexte.close()
            }
          })
        }
      }

      // la sortie, deux images de glissement, puis le retour de la souris au même coin, d'un trait dans la page : la place est lue avant et juste après
      async function sortieEtRetour(page: any) {
        const vu: { avant: number[], apres: number[] } = await page.evaluate(`new Promise((fin) => {
          const lire = () => ${DISQUE}
          document.documentElement.dispatchEvent(new PointerEvent('pointerleave'))
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const avant = lire()
            document.documentElement.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 30 }))
            fin({ avant, apres: lire() })
          }))
        })`)
        const loin = Math.hypot(vu.avant[0], vu.avant[1])
        assert.ok(loin > 10 && loin < 170, `la lumière glisse encore vers le centre (${vu.avant.map((x) => x.toFixed(1)).join(' ')})`)
        assert.ok(Math.hypot(vu.apres[0] - vu.avant[0], vu.apres[1] - vu.avant[1]) <= 1, `elle repart de là où elle est : ${vu.avant.map((x) => x.toFixed(1)).join(' ')} avant, ${vu.apres.map((x) => x.toFixed(1)).join(' ')} après`)
      }

      it('toujours allumé avec un retard : la souris revient avant que la lumière ait fini de rentrer — elle repart de là où elle est, ni au centre ni ailleurs', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs } = await ouvre('toujours')
        try {
          await visite(page)
          await sortieEtRetour(page)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('toujours allumé avec un retard : la souris reste jusqu\'à l\'arrivée complète de la lumière, sort, puis revient avant que la lumière ait fini de rentrer — elle repart de là où elle est, ni au centre ni ailleurs', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs } = await ouvre('toujours')
        try {
          await visite(page)
          // la boucle de la lumière s'arrête quand elle a rejoint la souris : le disque est alors exactement à la place de la souris (130, -120 du centre) ; avant cela, la boucle l'écrit à 0,1 px ou plus de là
          await page.waitForFunction(`(() => { const t = ${DISQUE}; return !!t && Math.abs(t[0] - 130) < 0.05 && Math.abs(t[1] + 120) < 0.05 })()`, null, { timeout: 10000 })
          await sortieEtRetour(page)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      // la seconde entrée après un redimensionnement, pour une balise : le voile posé dans la balise, le liseré, le halo
      for (const [classe, titre] of [['voile', 'le voile d\'une balise'], ['bord', 'le liseré'], ['halo', 'le halo']] as const) {
        it(`toujours allumé avec un retard, ${titre} : la largeur de la fenêtre change pendant que la souris est dehors — à la nouvelle entrée la lumière part du centre d'aujourd'hui, sans saut`, async function () {
          if (!browser) { this.skip(); return }
          const { page, contexte, erreurs, redimensionne } = await ouvre('balises')
          try {
            const centre = (): Promise<[number, number]> => page.evaluate(CENTRE(classe))
            // la première visite : la lumière naît sous la souris, au centre de la balise, puis rejoint un point à 50 px à droite et 30 px plus haut (la lecture est vivante)
            const [cx, cy] = await centre()
            await page.mouse.move(cx, cy, { steps: 1 })
            await page.waitForFunction(`${PLACE[classe]} !== null`, null, { timeout: 10000 })
            await page.mouse.move(cx + 50, cy - 30, { steps: 2 })
            await page.waitForFunction(`(() => { const t = ${PLACE[classe]}; return !!t && Math.abs(t[0] - 50) < 0.6 && Math.abs(t[1] + 30) < 0.6 })()`, null, { timeout: 10000 })
            // la souris sort de la balise : la lumière rentre au centre et y reste (la feuille la pose, aucune place écrite)
            await page.mouse.move(10, 290, { steps: 1 })
            await page.waitForFunction(`${PLACE[classe]} === null`, null, { timeout: 10000 })
            await redimensionne(600, 300)
            // la souris rentre au centre d'aujourd'hui : la lumière est déjà dessous, elle n'a nulle part où aller
            const [nx, ny] = await centre()
            await page.evaluate(FILM_DE(PLACE[classe]))
            await page.mouse.move(nx, ny, { steps: 1 })
            await page.waitForTimeout(700)
            const film: Array<[number, number] | null> = await page.evaluate(FINI)
            const vus = film.filter((v) => v) as Array<[number, number]>
            assert.ok(vus.length >= 5, `la lumière se lit après l'entrée (${vus.length} images lues sur ${film.length})`)
            const ecart = Math.max(...vus.map((v) => Math.hypot(v[0], v[1])))
            assert.ok(ecart <= 1, `la lumière ne quitte pas le centre d'aujourd'hui : écart de ${ecart.toFixed(1)} px (images : ${vus.slice(0, 5).map((v) => v.map((x) => x.toFixed(1)).join(' ')).join(' | ')})`)
            assert.deepEqual(erreurs, [])
          }
          finally {
            await contexte.close()
          }
        })
      }

      it('toujours allumé : la fenêtre devient plus haute (la hauteur seule change) — le rayon de l\'ombre suit, le bas de la fenêtre est voilé, et le rayon ne s\'écrit qu\'une fois', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, redimensionne, pixel } = await ouvre('toujours')
        try {
          assert.equal(await page.evaluate(RAYON), '340px', 'à la pose, le rayon est la plus grande dimension de la fenêtre')
          const avant = (await page.evaluate('window.__rayons.length')) as number
          await redimensionne(340, 900)
          await page.mouse.move(60, 20, { steps: 2 })
          await page.waitForFunction(`${RAYON} === '900px'`, null, { timeout: 8000 }).catch(() => {})
          assert.equal(await page.evaluate(RAYON), '900px', 'le rayon suit la plus grande dimension de la fenêtre (900 de haut)')
          await page.waitForTimeout(500)
          const bas = await pixel(170, 888)
          assert.ok(sombre(bas), `le bas de la fenêtre (170, 888) est voilé : ${bas}`)
          const ecrit = ((await page.evaluate('window.__rayons')) as string[]).slice(avant)
          assert.deepEqual(ecrit, ['900px'], 'une seule écriture quand la fenêtre a changé')
          // des mouvements de la souris, la fenêtre ne change plus : aucune écriture de plus
          for (let i = 0; i < 12; i++) await page.mouse.move(60 + i * 12, 20 + i * 6, { steps: 1 })
          await page.waitForTimeout(150)
          assert.equal(await page.evaluate('window.__rayons.length'), avant + 1, 'le rayon ne s\'écrit pas à chaque mouvement de la souris')
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('au survol : la fenêtre devient plus haute pendant que la souris est dessus — le rayon de l\'ombre suit au mouvement suivant, et ne s\'écrit qu\'une fois', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, redimensionne, pixel } = await ouvre('survol')
        try {
          await page.mouse.move(60, 20, { steps: 2 })
          await page.waitForFunction(`${RAYON} === '340px'`, null, { timeout: 8000 })
          const avant = (await page.evaluate('window.__rayons.length')) as number
          await redimensionne(340, 900)
          await page.mouse.move(80, 40, { steps: 2 })
          await page.waitForFunction(`${RAYON} === '900px'`, null, { timeout: 8000 }).catch(() => {})
          assert.equal(await page.evaluate(RAYON), '900px', 'le rayon suit la plus grande dimension de la fenêtre (900 de haut)')
          await page.waitForTimeout(500)
          const bas = await pixel(170, 888)
          assert.ok(sombre(bas), `le bas de la fenêtre (170, 888) est voilé : ${bas}`)
          assert.deepEqual(((await page.evaluate('window.__rayons')) as string[]).slice(avant), ['900px'], 'une seule écriture quand la fenêtre a changé')
          for (let i = 0; i < 12; i++) await page.mouse.move(60 + i * 12, 20 + i * 6, { steps: 1 })
          await page.waitForTimeout(150)
          assert.equal(await page.evaluate('window.__rayons.length'), avant + 1, 'le rayon ne s\'écrit pas à chaque mouvement de la souris')
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })
    })
  }
})
