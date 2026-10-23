// *hologram(zoom), le vol de la carte, dans Chromium et Firefox réels : tant que le ressort écrit la transformation de la balise à chaque image (l'aller comme le
// retour), aucune transition de `transform` ne s'y applique, d'où qu'elle vienne — la pente d'`*tilt` (une seconde, après une attente de 650 ms), une règle de
// l'auteur, même plus précise que la marque de vol —, parce que chaque écriture la relancerait et que la carte ne bougerait qu'à la fin du ressort. Quatre balises, mesurées de la même façon : la pente,
// une transition d'auteur, une règle d'auteur plus précise, rien (la référence). La carte part dans les deux images qui suivent le geste, revient à sa place dans le même temps que sans
// transition (à 20 % près), garde le premier plan jusqu'au bout et ne saute pas en arrivant. Hors du vol, ces transitions marchent comme avant : la pente
// d'`*tilt` suit la souris sur la carte revenue, attend, puis revient à plat ; la transition de l'auteur rejoue pour ses propres changements, sur la carte
// revenue comme sur la carte agrandie à l'arrêt. La lueur de la carte garde sa transition pendant le vol.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { navigateurPresent, construire, ouvrir, boite, agrandit, fly, measure, page, PENTE, type Construit } from './helpers/hologramme-zoom.js'

// la règle de l'auteur : une transition de `transform` (et une d'opacité), et deux états qui la jouent
const AUTEUR = '.carte\n  transition: transform .4s, opacity .5s\n.penche\n  transform: rotate(10deg)\n.pale\n  opacity: .3\n'

// une règle d'auteur plus précise que la marque de vol (un type, deux classes) : elle ne gagne pas non plus
const FORT = 'div.carte.a\n  transition: transform .4s\n'

const SOURCES: Record<string, string> = {
  'hv-var.mjs': `<script>\n$zoom = true\n</script>\n<div class="carte a" *hologram(rays, zoom: $zoom) ${PENTE}><b>A</b></div>\n<button class="bs" @click={$zoom = 'spin'}>s</button>\n<style>\n.carte\n  width: 200px\n  height: 280px\n  margin: 60px 0 0 60px\n  border-radius: 10px\n  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)\n.bs\n  position: absolute\n  top: 700px\n  left: 600px\n</style>`
}
for (const zoom of ['true', 'spin']) {
  SOURCES[`hv-${zoom}-pente.mjs`]  = page(`zoom: ${zoom}`, PENTE)
  SOURCES[`hv-${zoom}-auteur.mjs`] = page(`zoom: ${zoom}`, '', '', AUTEUR)
  SOURCES[`hv-${zoom}-fort.mjs`]   = page(`zoom: ${zoom}`, '', '', FORT)
  SOURCES[`hv-${zoom}-rien.mjs`]   = page(`zoom: ${zoom}`)
}

const CONFIGS = ['rien', 'pente', 'auteur', 'fort'] as const

let compile: Promise<Construit> | null = null

// les nombres d'une matrice CSS, et l'écart le plus grand entre deux matrices
const nombres  = (m: string) => (m === 'none' ? [1, 0, 0, 1, 0, 0] : (m.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number))
const distance = (a: string, b: string) => {
  const x = nombres(a)
  const y = nombres(b)
  return x.length !== y.length ? Infinity : Math.max(...x.map((v, i) => Math.abs(v - y[i])))
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*hologram(zoom), le vol de la carte (${nom} réel)`, function () {
    this.timeout(300000)
    let present = false
    let construit: Construit

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du vol sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      compile ??= construire(SOURCES, 'effets-hologramme-zoom-vol-browser')
      construit = await compile
    })

    after(async () => { await terminateSharedWorkerPool() })

    // le vol de la carte `.a` dans chacune des quatre balises : `retour` (clic à côté d'une carte agrandie), `aller` (clic sur la carte), `touche` (Entrée sur la
    // carte, la souris ailleurs : la pente est au repos, avec son attente)
    async function mesures(zoom: string, sens: 'retour' | 'aller' | 'touche') {
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      const out: Record<string, ReturnType<typeof measure> & { erreurs: string[] }> = {}
      try {
        for (const config of CONFIGS) {
          const tag = `mjs-hv-${zoom}-${config}`
          const { p, erreurs } = await ouvrir(browser, construit, tag)
          let vol
          if (sens === 'retour') {
            await agrandit(p, tag, '.a')
            vol = await fly(p, tag, 'pointerdown', () => p.mouse.click(650, 785), '.a', 4200)
          }
          else if (sens === 'aller') {
            const z = await boite(p, tag, '.a')
            vol = await fly(p, tag, 'click', () => p.mouse.click(z.x + z.w / 2, z.y + z.h / 2), '.a', 4200)
          }
          else {
            await p.mouse.move(650, 785)
            await p.evaluate((t: string) => ((document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement).focus(), tag)
            vol = await fly(p, tag, 'keydown', () => p.keyboard.press('Enter'), '.a', 4200)
          }
          out[config] = { ...measure(vol), erreurs }
          await p.close()
        }
      } finally {
        await browser.close()
      }
      return out
    }

    // ce que le vol doit tenir, pour chacune des quatre balises : ce qu'on voit (le départ, la durée, les transitions, le premier plan, l'arrivée, le tour), puis
    // la marque de vol, qui en est la cause. Tous les écarts sont rendus ensemble, balise par balise
    function exige(m: Awaited<ReturnType<typeof mesures>>, quoi: string, tour = false, retour = false) {
      const ref = m.rien
      const ecarts: string[] = []
      const verifie = (ok: boolean, config: string, ecart: string) => { if (!ok) ecarts.push(`${quoi}, balise « ${config} » : ${ecart}`) }
      for (const config of CONFIGS) {
        const x = m[config]
        // deux images pour le ressort (la première image de l'élan ne bouge pas la carte), deux de plus pour la lecture : l'ordre des rappels d'une image décide si elle
        // voit l'écriture de l'image même ou de la précédente ; avant la correction, la pente la faisait partir après 90 à 150 images
        verifie(x.start <= 4, config, `la carte a commencé à bouger à l'image ${x.start} après le geste (au plus la quatrième)`)
        verifie(x.transitions === 0, config, `${x.transitions} images où une transition de transform court sur la carte pendant son vol`)
        // à 20 % près, plus la résolution de la lecture : une machine chargée ne rend que quelques images par seconde, et la fin du mouvement tombe entre deux
        verifie(Math.abs(x.duration - ref.duration) <= 0.2 * ref.duration + Math.max(x.grain, ref.grain), config, `la carte met ${x.duration} ms, ${ref.duration} ms sans transition (à 20 % près, plus ${Math.max(x.grain, ref.grain)} ms d'intervalle entre images)`)
        verifie(x.bare === 0, config, `${x.bare} images du vol sans le premier plan`)
        verifie(!retour || (x.linger !== null && x.linger < 1700 + 4 * x.grain), config, `le premier plan part ${x.linger} ms après le retour de la carte (moins de 1,7 s, plus quatre intervalles entre images de ${x.grain} ms : la fin du ressort, qui avance de 30 pas au plus par image, pas celle d'une transition de la balise)`)
        verifie((x.turn >= 359) === tour, config, `${tour ? 'un tour complet attendu' : 'aucun tour attendu'} (étendue de l'angle ${x.turn}°)`)
        verifie(x.erreurs.length === 0, config, `erreurs de la page : ${x.erreurs.join(' | ')}`)
        verifie(x.unflown === 0, config, `${x.unflown} images où la carte bouge sans la marque de vol`)
        verifie(!x.flyAtRest, config, 'la marque de vol reste après l\'arrivée')
        verifie(x.arrival <= 1.5, config, `à la dernière image du vol la carte est à ${x.arrival} px de sa place de repos`)
      }
      assert.deepEqual(ecarts, [])
    }

    it('retour (zoom: true) : la carte repart à l\'instant et revient dans le même temps, quelle que soit la transition de la balise', async function () {
      if (!present) { this.skip(); return }
      exige(await mesures('true', 'retour'), 'retour', false, true)
    })

    it('retour (zoom: spin) : la carte repart à l\'instant, refait son tour et revient dans le même temps, quelle que soit la transition de la balise', async function () {
      if (!present) { this.skip(); return }
      exige(await mesures('spin', 'retour'), 'retour avec tour', true, true)
    })

    it('aller par un clic (zoom: true) : la carte part à l\'instant et arrive dans le même temps, quelle que soit la transition de la balise', async function () {
      if (!present) { this.skip(); return }
      exige(await mesures('true', 'aller'), 'aller')
    })

    it('aller par un clic (zoom: spin) : la carte part à l\'instant, fait son tour et arrive dans le même temps, quelle que soit la transition de la balise', async function () {
      if (!present) { this.skip(); return }
      exige(await mesures('spin', 'aller'), 'aller avec tour', true)
    })

    it('aller par la touche Entrée, la souris ailleurs (la pente est au repos, avec son attente) : la carte part à l\'instant', async function () {
      if (!present) { this.skip(); return }
      exige(await mesures('true', 'touche'), 'aller à la touche')
    })

    it('la lueur de la carte garde sa transition pendant le vol : elle se fond, elle ne saute pas', async function () {
      if (!present) { this.skip(); return }
      const m = await mesures('true', 'aller')
      assert.ok(m.rien.shadows >= 3, `sans transition sur la balise, la lueur passe par des valeurs intermédiaires (${m.rien.shadows} valeurs vues)`)
    })

    it('hors du vol, *tilt suit la souris sur la carte agrandie puis sur la carte revenue, attend, puis revient à plat', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hv-true-pente'
        const { p, erreurs } = await ouvrir(browser, construit, tag)
        const lit = () => p.evaluate((t: string) => {
          const c = (document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement
          return { transform: getComputedStyle(c).transform, rx: parseFloat(c.style.getPropertyValue('--mjs-fx-tilt-rx') || '0'), ry: parseFloat(c.style.getPropertyValue('--mjs-fx-tilt-ry') || '0'), marques: c.getAttributeNames().join(' ') }
        }, tag)
        const repos = (await lit()).transform
        const z = await agrandit(p, tag, '.a')
        // agrandie, la souris entre en bas puis en haut de la carte : la pente écrit encore ses angles, ils suivent la souris (elle lit toujours la boîte d'avant
        // le zoom, et le transform du zoom l'emporte sur le sien : la carte agrandie ne penche pas, comme avant)
        await p.mouse.move(350, 560, { steps: 3 })
        await p.waitForTimeout(400)
        const bas = await lit()
        await p.mouse.move(350, 250, { steps: 3 })
        await p.waitForTimeout(400)
        const haut = await lit()
        assert.ok(bas.rx !== haut.rx, `agrandie, la pente suit la souris : angles ${bas.rx}° en bas, ${haut.rx}° en haut`)
        // le retour, puis la carte revenue : la pente la penche, d'après la boîte à plat
        await p.keyboard.press('Escape')
        await p.waitForFunction(([t]: string[]) => !/-up|-3d|-fly/.test(((document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement).getAttributeNames().join(' ')), [tag], { polling: 100, timeout: 20000 })
        await p.waitForTimeout(200)
        await p.mouse.move(z.x + 40, z.y + z.h - 40, { steps: 3 })
        await p.waitForTimeout(500)
        const penche = await lit()
        assert.ok(Math.abs(penche.rx - 10.2) < 2.5 && Math.abs(penche.ry - 8.6) < 2.5, `revenue, la souris en bas à gauche : angles ${penche.rx}, ${penche.ry} (10,2 et 8,6 attendus)`)
        assert.ok(distance(penche.transform, repos) > 0.05, `et la carte est penchée : ${penche.transform}`)
        await p.mouse.move(z.x + z.w - 40, z.y + 40, { steps: 3 })
        await p.waitForTimeout(500)
        const autre = await lit()
        assert.ok(autre.rx < -5 && autre.ry < -5, `la souris en haut à droite : angles ${autre.rx}, ${autre.ry} (-10,2 et -8,6 attendus)`)
        // la souris part : la carte attend (650 ms) penchée, puis revient à plat en une seconde. C'est lu sur les événements de sa transition (lancée, partie après
        // l'attente, finie) et non sur la montre : une machine chargée retarde une lecture de plus de 650 ms, jamais ces événements d'avant leur heure
        await p.evaluate((t: string) => {
          const c = (document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement
          const trace: any[] = ((window as any).__transitions = [])
          for (const type of ['transitionrun', 'transitionstart', 'transitionend']) c.addEventListener(type, (e: any) => { if (e.propertyName === 'transform') trace.push({ type, t: e.timeStamp }) })
        }, tag)
        await p.mouse.move(650, 785)
        await p.waitForFunction(() => {
          const x = (window as any).__transitions
          const i = x.findIndex((e: any) => e.type === 'transitionrun')
          return i >= 0 && x.slice(i).some((e: any) => e.type === 'transitionend')
        }, null, { polling: 100, timeout: 30000 })
        const trace: { type: string, t: number }[] = await p.evaluate(() => (window as any).__transitions)
        const lance  = trace.findIndex((e) => e.type === 'transitionrun')
        const depart = trace.findIndex((e, i) => i > lance && e.type === 'transitionstart')
        const fini   = trace.findIndex((e, i) => i > depart && e.type === 'transitionend')
        assert.ok(lance >= 0 && depart > lance && fini > depart, `à la sortie, la transition de la pente se lance, part, puis finit : ${JSON.stringify(trace)}`)
        assert.ok(trace[depart].t - trace[lance].t >= 600, `à la sortie, la carte attend avant de revenir : ${Math.round(trace[depart].t - trace[lance].t)} ms entre le lancement et le départ de la transition (650 attendues)`)
        // le départ de la transition peut être signalé en retard (une image tardive), jamais sa fin avant l'heure : le total, attente comprise, ne descend pas sous 1,6 s
        assert.ok(trace[fini].t - trace[lance].t >= 1600, `et elle revient en une seconde, après son attente : ${Math.round(trace[fini].t - trace[lance].t)} ms au total (1 650 attendues)`)
        const plat = await lit()
        assert.ok(distance(plat.transform, repos) < 0.0001, `puis elle est à plat : ${plat.transform}, ${repos} au départ`)
        assert.doesNotMatch(plat.marques, /-up|-3d|-fly/)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('hors du vol, la transition de l\'auteur rejoue pour ses propres changements : l\'opacité sur la carte agrandie à l\'arrêt, la rotation sur la carte revenue', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hv-true-auteur'
        const { p, erreurs } = await ouvrir(browser, construit, tag)
        // la classe est posée, puis les transitions que le navigateur lance sur la carte sont lues (lire les animations applique le style)
        const joue = (classe: string) => p.evaluate(async ([t, c]: string[]) => {
          const carte = (document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement
          // la transition que la balise lance en retrouvant ses règles à l'arrivée (nulle : le ressort a posé la carte) est finie avant que l'auteur ne change quoi que ce soit
          for (let i = 0; i < 100 && carte.getAnimations().length > 0; i++) await new Promise((ok) => setTimeout(ok, 50))
          carte.classList.add(c)
          return carte.getAnimations().filter((a: any) => a.transitionProperty).map((a: any) => `${a.transitionProperty} ${a.effect.getTiming().duration}`).sort()
        }, [tag, classe])
        await agrandit(p, tag, '.a')
        assert.deepEqual(await joue('pale'), ['opacity 500'], 'agrandie à l\'arrêt, l\'opacité se fond en 500 ms')
        await p.keyboard.press('Escape')
        await p.waitForFunction(([t]: string[]) => !/-up|-3d|-fly/.test(((document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement).getAttributeNames().join(' ')), [tag], { polling: 100, timeout: 20000 })
        await p.waitForTimeout(600)
        assert.deepEqual(await joue('penche'), ['transform 400'], 'revenue, la rotation se fait en 400 ms')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('un réglage qui repose l\'effet en plein vol ne laisse pas la marque de vol : la pente retrouve ses transitions', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hv-var'
        const { p, erreurs } = await ouvrir(browser, construit, tag)
        const z = await boite(p, tag, '.a')
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        await p.waitForTimeout(250)
        const en = await p.evaluate((t: string) => ((document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement).hasAttribute('mjs-fx-hologram-fly'), tag)
        assert.equal(en, true, 'en plein vol, la marque est là')
        // le bouton est ailleurs : le clic ferme la carte, puis change `zoom`, ce qui repose l'effet pendant le retour
        const b = await boite(p, tag, '.bs')
        await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
        await p.waitForTimeout(600)
        const apres = await p.evaluate((t: string) => {
          const c = (document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement
          return { marques: c.getAttributeNames().filter((n) => n.startsWith('mjs-fx-hologram')).join(' '), transitions: getComputedStyle(c).transitionProperty }
        }, tag)
        assert.doesNotMatch(apres.marques, /-fly|-3d|-up/, 'l\'effet reposé ne laisse aucune marque de vol')
        assert.equal(apres.transitions, 'transform', 'et la pente a retrouvé sa transition')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
}
