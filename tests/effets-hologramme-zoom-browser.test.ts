// *hologram(zoom: true), dans Chromium et Firefox réels : la carte agrandie reste au-dessus de tout (attribut
// `mjs-fx-hologram-up`, z-index) jusqu'à la fin de son retour À L'ŒIL — place et taille revenues —, quelle que soit la
// façon de finir le zoom (clic à côté, clic sur un champ, Échap, second clic, autre carte agrandie) et où que soit la
// souris ; des voisins positionnés sur le trajet du retour, dont deux champs <@@select> du cœur et une boîte `z-index: 1`,
// sont survolés par la carte. La pente d'`*tilt` (une transition d'une seconde sur la balise) ne retarde plus la carte derrière le
// ressort pendant le vol (voir le test du vol) : le premier plan tient jusqu'à la fin du retour. Le zoom simple ne tourne jamais : la
// rotation reste à zéro à l'aller comme au retour. Chaque relevé est pris à chaque image d'animation.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { navigateurPresent, construire, ouvrir, boite, agrandit, releve, exige, page, PENTE, type Construit } from './helpers/hologramme-zoom.js'

const SOURCES = {
  'hz-page.mjs':  page('zoom: true'),
  'hz-pente.mjs': page('zoom: true', PENTE)
}

let compile: Promise<Construit> | null = null

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*hologram(zoom: true), le premier plan et le zoom simple (${nom} réel)`, function () {
    this.timeout(240000)
    let present = false
    let construit: Construit

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du zoom sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      compile ??= construire(SOURCES, 'effets-hologramme-zoom-browser')
      construit = await compile
    })

    after(async () => { await terminateSharedWorkerPool() })

    // un geste pour finir le zoom, la carte `.a` agrandie d'abord ; la souris reste où le premier clic l'a mise
    async function finit(tag: string, quoi: string, geste: (p: any) => Promise<void>, tol = 0.5) {
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { p, erreurs } = await ouvrir(browser, construit, tag)
        const repos = await agrandit(p, tag, '.a')
        const points = await releve(p, tag, repos, () => geste(p))
        exige(points, quoi, tol)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    }

    for (const [tag, titre] of [['mjs-hz-page', ''], ['mjs-hz-pente', ' (avec la pente d\'*tilt, une seconde de transition)']]) {
      it('clic à côté : la carte reste au-dessus de tout jusqu\'à la fin du retour' + titre, async function () {
        if (!present) { this.skip(); return }
        await finit(tag, 'clic à côté', (p) => p.mouse.click(650, 785), tag === 'mjs-hz-pente' ? 12 : 0.5)
      })

      it('Échap : la carte reste au-dessus de tout jusqu\'à la fin du retour' + titre, async function () {
        if (!present) { this.skip(); return }
        await finit(tag, 'Échap', (p) => p.keyboard.press('Escape'), tag === 'mjs-hz-pente' ? 12 : 0.5)
      })

      it('second clic sur la carte : elle se referme et reste au-dessus de tout jusqu\'à la fin du retour' + titre, async function () {
        if (!present) { this.skip(); return }
        await finit(tag, 'second clic', (p) => p.mouse.click(350, 400), tag === 'mjs-hz-pente' ? 12 : 0.5)
      })
    }

    it('clic sur un champ à côté : la carte reste au-dessus de tout, le champ ne passe pas devant', async function () {
      if (!present) { this.skip(); return }
      await finit('mjs-hz-page', 'clic sur un champ', async (p) => {
        const champ = await boite(p, 'mjs-hz-page', '.s3')
        await p.mouse.click(champ.x + champ.w / 2, champ.y + champ.h / 2)
      })
    })

    it('autre carte agrandie : la première reste au-dessus des voisins jusqu\'à la fin de son retour', async function () {
      if (!present) { this.skip(); return }
      await finit('mjs-hz-page', 'autre carte agrandie', async (p) => {
        const b = await boite(p, 'mjs-hz-page', '.b')
        await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
      })
    })

    it('le zoom simple ne tourne jamais : la rotation reste à zéro à l\'aller comme au retour, dès le premier zoom', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-page'
        const { p, erreurs } = await ouvrir(browser, construit, tag)
        const z = await boite(p, tag, '.a')
        // le cosinus de l'angle, lu dans la matrice (m11 / m22 : la rotation autour de l'axe vertical), à chaque image pendant deux secondes et demie
        const cosinus = () => p.evaluate(async ([t, duree]: [string, number]) => {
          const carte = (document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement
          const mini = { v: 1 }
          const fin  = performance.now() + duree
          await new Promise<void>((ok) => {
            const image = () => {
              const tr = getComputedStyle(carte).transform
              if (tr !== 'none') {
                const m = new DOMMatrix(tr)
                mini.v = Math.min(mini.v, m.m11 / m.m22)
              }
              if (performance.now() > fin) ok()
              else requestAnimationFrame(image)
            }
            requestAnimationFrame(image)
          })
          return mini
        }, [tag, 2500] as [string, number])
        const aller = cosinus()
        await p.waitForTimeout(100)
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        const ra = await aller
        assert.ok(ra.v > 0.999, `à l'aller la carte ne tourne pas — cosinus le plus bas ${ra.v} (−1 : un tour)`)
        const retour = cosinus()
        await p.waitForTimeout(100)
        await p.keyboard.press('Escape')
        const rr = await retour
        assert.ok(rr.v > 0.999, `au retour la carte ne tourne pas — cosinus le plus bas ${rr.v}`)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
}
