// *hologram(zoom: spin), dans Chromium et Firefox réels : la carte fait un tour complet autour de son axe vertical en venant et un tour dans
// l'autre sens en repartant, à CHAQUE zoom ; à mi-tour son dos se voit et sa face non (un dos uni sombre, ou l'image du réglage `back`) ;
// le dos n'existe dans la page que le temps du zoom ; « réduire les animations » : pas de tour ; un zoom simple n'a ni tour ni dos ; le retour
// garde le premier plan ; le retrait de l'effet ne laisse rien ; `zoom` et `back` tenus par une variable. Le mouvement se joue image par
// image avec un pilote d'images (le même à chaque essai) ; le premier plan se relève en temps réel.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { navigateurPresent, construire, ouvrir, boite, agrandit, releve, exige, page, PILOTE, REGISTRE, COSINUS, couleurs, type Construit } from './helpers/hologramme-zoom.js'

const DOS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" fill="#e8c020"/><circle cx="100" cy="140" r="60" fill="#a01030"/></svg>'
const DATA    = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22%2320c060%22/%3E%3C/svg%3E'
const BOUTONS = `<button class="bzf" @click={$zoom = false}>f</button><button class="bzt" @click={$zoom = true}>t</button><button class="bzs" @click={$zoom = 'spin'}>s</button><button class="bdos" @click={$back = '${DATA}'}>d</button>`

const SOURCES = {
  'hz-spin.mjs':    page('zoom: spin'),
  'hz-dos.mjs':     page('zoom: spin', '', ', back: \'dos.svg\''),
  'hz-simple.mjs':  page('zoom: true', '', ', back: \'dos.svg\''),
  'hz-pente-spin.mjs': page('zoom: spin', '*tilt(max: 14.29, scale: 1, perspective: 600, follow: 130ms, duration: 1000ms, wait: 650ms, bounce: 0.28)'),
  'hz-var.mjs':     `<script>\n$zoom = 'spin'\n$back = ''\n</script>\n<div class="carte a" *hologram(rays, zoom: $zoom, back: $back)><b>A</b></div>\n<div class="barre">${BOUTONS}</div>\n<style>\n.carte\n  width: 200px\n  height: 280px\n  margin: 60px 0 0 60px\n  border-radius: 10px\n  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)\n.barre\n  position: absolute\n  top: 700px\n  left: 10px\n</style>`,
  'hz-retrait.mjs': `<script>\n$on = false\n</script>\n{if $on}<div class="carte a" *hologram(rays, zoom: spin, back: 'dos.svg')><b>A</b></div>{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>\n.carte\n  width: 200px\n  height: 280px\n  margin: 60px 0 0 60px\n  border-radius: 10px\n  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)\n.t\n  position: absolute\n  top: 700px\n  left: 600px\n</style>`,
  'dos.svg':        DOS_SVG
}

let compile: Promise<Construit> | null = null

// la couleur du dos uni, et les deux de la face
const DOS_UNI = [29, 34, 48]
const FACE    = [[42, 74, 106], [122, 90, 154]]

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*hologram(zoom: spin), le tour, le dos et le premier plan (${nom} réel)`, function () {
    this.timeout(240000)
    let present = false
    let construit: Construit

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du tour sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      compile ??= construire(SOURCES, 'effets-hologramme-zoom-spin-browser')
      construit = await compile
    })

    after(async () => { await terminateSharedWorkerPool() })

    // la carte jouée image par image : `jusque` rend les relevés (cosinus, dos, face) jusqu'à ce que le test d'arrêt soit vrai ou que la file des images soit vide
    const etat = (p: any, tag: string) => p.evaluate(([t, s]: string[]) => {
      const racine = (document.querySelector(t) as any)._shadow as ShadowRoot
      const carte  = racine.querySelector(s) as HTMLElement
      const dos    = racine.querySelector('[mjs-fx-layer="hologram-back"]') as HTMLElement | null
      const tr     = getComputedStyle(carte).transform
      const m      = tr === 'none' ? null : new DOMMatrix(tr)
      // l'angle que l'effet écrit (le cosinus de la matrice, lui, mêle la translation à la perspective : il ne vaut le cosinus de l'angle que sans translation)
      const rx = parseFloat(carte.style.getPropertyValue('--mjs-fx-hologram-rx') || '0')
      return { rx, cos: Math.cos(rx * Math.PI / 180), mat: m ? m.m11 / m.m22 : 1, dos: !!dos, tourne: !!dos && dos.hasAttribute('mjs-fx-hologram-turned'), visible: dos ? getComputedStyle(dos).visibility : '', marques: carte.getAttributeNames().filter((n) => n.startsWith('mjs-fx-hologram')).sort().join(' ') }
    }, [tag, '.a'])

    async function joue(p: any, tag: string, jusque: (e: any) => boolean = () => false, max = 400) {
      const vus: any[] = []
      for (let i = 0; i < max; i++) {
        const restantes = await p.evaluate(() => (window as any).__pas(1))
        const e = await etat(p, tag)
        vus.push(e)
        if (jusque(e) || (restantes === 0 && i > 5)) break
      }
      return vus
    }

    async function ouvreCarte(browser: any, tag: string, options: any = {}, avant = PILOTE) {
      const r = await ouvrir(browser, construit, tag, options, avant)
      const z = await boite(r.p, tag, '.a')
      return { ...r, z }
    }

    it('le tour joue à chaque zoom, aller et retour ; à mi-tour le dos uni se voit et la face non ; il disparaît au repos', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-spin'
        const { p, z, erreurs } = await ouvreCarte(browser, tag)
        assert.deepEqual(await etat(p, tag), { rx: 0, cos: 1, mat: 1, dos: false, tourne: false, visible: '', marques: 'mjs-fx-hologram-shadow mjs-fx-hologram-zoom' }, 'au repos : pas de dos, pas de transformation')
        for (const tour of [1, 2]) {
          // l'aller
          await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
          assert.equal((await etat(p, tag)).dos, true, `zoom ${tour} : le dos naît avec le tour`)
          let milieu: any = null
          const aller = await joue(p, tag, (e) => {
            if (e.cos < -0.98 && !milieu) milieu = e
            return false
          }, 120)
          assert.ok(milieu, `zoom ${tour} : la carte se retourne de face à dos (cosinus le plus bas ${Math.min(...aller.map((e) => e.cos)).toFixed(3)})`)
          assert.ok(milieu.tourne && milieu.visible === 'visible', `zoom ${tour} : à mi-tour le dos est montré`)
          for (const e of aller) {
            if (e.cos < -0.1) assert.ok(e.tourne, `zoom ${tour} : de dos (cosinus ${e.cos.toFixed(2)}), le dos est montré — ${JSON.stringify(aller.slice(0, 24).map((x) => [x.rx, +x.cos.toFixed(2), x.tourne ? 1 : 0]))}`)
            if (e.cos > 0.1) assert.ok(!e.tourne, `zoom ${tour} : de face (cosinus ${e.cos.toFixed(2)}), le dos est caché`)
          }
          assert.ok(aller[aller.length - 1].cos > 0.999, `zoom ${tour} : la carte finit de face`)
          assert.equal((await etat(p, tag)).dos, true, `zoom ${tour} : le dos reste tant que la carte est agrandie`)
          // le retour, dans l'autre sens
          await p.keyboard.press('Escape')
          const retour = await joue(p, tag, undefined, 600)
          assert.ok(Math.min(...retour.map((e) => e.cos)) < -0.99, `retour ${tour} : la carte refait le tour (cosinus le plus bas ${Math.min(...retour.map((e) => e.cos)).toFixed(3)})`)
          const fin = await etat(p, tag)
          assert.deepEqual(fin, { rx: 0, cos: 1, mat: 1, dos: false, tourne: false, visible: '', marques: 'mjs-fx-hologram-shadow mjs-fx-hologram-zoom' }, `retour ${tour} : revenue, sans dos`)
        }
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('à 180 degrés la capture montre le dos uni et aucun pixel de la face', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-spin'
        const { p, z } = await ouvreCarte(browser, tag)
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        await p.mouse.move(690, 790)
        const vus = await joue(p, tag, (e) => e.cos < -0.99)
        assert.ok(vus[vus.length - 1].cos < -0.99, 'la carte est de dos')
        const b = await boite(p, tag, '.a')
        const png = await p.screenshot({ clip: { x: b.x + b.w * 0.2, y: b.y + b.h * 0.2, width: b.w * 0.6, height: b.h * 0.6 } })
        const [dos, f1, f2] = await couleurs(p, png, [DOS_UNI, ...FACE])
        assert.ok(dos > 0.9, `le dos uni couvre la carte : ${(dos * 100).toFixed(1)} %`)
        assert.ok(f1 + f2 < 0.005, `aucun pixel de la face : ${((f1 + f2) * 100).toFixed(2)} %`)
        if (process.env.MJS_CAPTURES) await p.screenshot({ path: `${process.env.MJS_CAPTURES}/${nom}-dos-uni.png` })
      } finally {
        await browser.close()
      }
    })

    it('back : l\'image du dos, copiée par la construction, se montre à mi-tour', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-dos'
        const { p, z, erreurs } = await ouvreCarte(browser, tag)
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        await p.mouse.move(690, 790)
        const vus = await joue(p, tag, (e) => e.cos < -0.99)
        assert.ok(vus[vus.length - 1].cos < -0.99, 'la carte est de dos')
        await p.waitForTimeout(400)
        const b = await boite(p, tag, '.a')
        const png = await p.screenshot({ clip: { x: b.x + b.w * 0.05, y: b.y + b.h * 0.05, width: b.w * 0.9, height: b.h * 0.9 } })
        const [or, rouge, f1, f2] = await couleurs(p, png, [[232, 192, 32], [160, 16, 48], ...FACE])
        assert.ok(or > 0.3 && rouge > 0.1, `l'image du dos est là : fond doré ${(or * 100).toFixed(1)} %, disque ${(rouge * 100).toFixed(1)} %`)
        assert.ok(f1 + f2 < 0.005, `aucun pixel de la face : ${((f1 + f2) * 100).toFixed(2)} %`)
        if (process.env.MJS_CAPTURES) await p.screenshot({ path: `${process.env.MJS_CAPTURES}/${nom}-dos-image.png` })
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('le zoom simple n\'a ni tour ni dos, même avec un réglage back écrit', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-simple'
        const { p, z } = await ouvreCarte(browser, tag)
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        const aller = await joue(p, tag, undefined, 200)
        await p.keyboard.press('Escape')
        const retour = await joue(p, tag, undefined, 400)
        for (const e of [...aller, ...retour]) assert.ok(e.cos > 0.9999 && e.mat > 0.9999 && !e.dos, `ni tour ni dos (angle ${e.rx}, matrice ${e.mat}, dos ${e.dos})`)
      } finally {
        await browser.close()
      }
    })

    it('« réduire les animations » : pas de tour, pas de dos', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-spin'
        const { p, z } = await ouvreCarte(browser, tag, { reducedMotion: 'reduce' })
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        const aller = await joue(p, tag, undefined, 100)
        assert.match(aller[aller.length - 1].marques, /zoomed/, 'la carte est agrandie')
        await p.keyboard.press('Escape')
        const retour = await joue(p, tag, undefined, 100)
        for (const e of [...aller, ...retour]) assert.ok(e.cos > 0.9999 && e.mat > 0.9999 && !e.dos, `ni tour ni dos (angle ${e.rx}, matrice ${e.mat}, dos ${e.dos})`)
      } finally {
        await browser.close()
      }
    })

    for (const [tag, titre, tol] of [['mjs-hz-spin', '', 0.5], ['mjs-hz-pente-spin', ' (avec la pente d\'*tilt)', 12]] as const) {
      it('zoom spin : la carte reste au-dessus de tout jusqu\'à la fin de son retour, tour compris' + titre, async function () {
        if (!present) { this.skip(); return }
        const playwright = await import('playwright')
        const browser = await playwright[nom].launch()
        try {
          const { p, erreurs } = await ouvrir(browser, construit, tag)
          const repos = await agrandit(p, tag, '.a')
          const points = await releve(p, tag, repos, () => p.mouse.click(650, 785))
          exige(points, 'clic à côté', tol)
          assert.ok(points.every((x: any) => !(x.dos && !/-up/.test(x.marques))), 'le dos ne survit pas au premier plan')
          assert.ok(!points[points.length - 1].dos, 'au repos, plus de dos')
          assert.deepEqual(erreurs, [])
        } finally {
          await browser.close()
        }
      })
    }

    it('retrait : l\'effet ôté en plein tour ne laisse ni dos, ni écouteur, ni attribut', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-retrait'
        const r = await ouvrir(browser, construit, tag, {}, REGISTRE, '.t')
        const p = r.p
        const avant = await p.evaluate(() => (window as any).__ecouteurs())
        const bouton = await boite(p, tag, '.t')
        await p.mouse.click(bouton.x + bouton.w / 2, bouton.y + bouton.h / 2)
        await p.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.a'), tag, { polling: 100 })
        const z = await boite(p, tag, '.a')
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        await p.waitForTimeout(250)
        const plein = await p.evaluate(([t]: string[]) => ({ dos: !!(document.querySelector(t) as any)._shadow.querySelector('[mjs-fx-layer="hologram-back"]'), ecouteurs: (window as any).__ecouteurs() }), [tag])
        assert.equal(plein.dos, true, 'en plein tour, le dos est là')
        assert.notDeepEqual(plein.ecouteurs, avant, 'et des écouteurs sont posés')
        await p.mouse.click(bouton.x + bouton.w / 2, bouton.y + bouton.h / 2)
        await p.waitForTimeout(500)
        const apres = await p.evaluate(([t]: string[]) => ({ carte: !!(document.querySelector(t) as any)._shadow.querySelector('.a'), dos: !!(document.querySelector(t) as any)._shadow.querySelector('[mjs-fx-layer="hologram-back"]'), couches: (document.querySelector(t) as any)._shadow.querySelectorAll('[mjs-fx-layer]').length, ecouteurs: (window as any).__ecouteurs() }), [tag])
        assert.equal(apres.carte, false, 'la carte est ôtée')
        assert.equal(apres.dos, false, 'plus de dos')
        assert.equal(apres.couches, 0, 'plus de calque')
        assert.deepEqual(apres.ecouteurs, avant, 'les écouteurs du document et de la fenêtre sont ceux d\'avant la pose')
        assert.deepEqual(r.erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('off.set : zoom tenu par une variable repose l\'effet (spin, true, false) ; back suit sa variable sans le reposer', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hz-var'
        const { p, z, erreurs } = await ouvreCarte(browser, tag)
        const clic = async (s: string) => {
          const b = await boite(p, tag, s)
          await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
          await p.waitForTimeout(150)
        }
        const tourne = async () => {
          await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
          const aller = await joue(p, tag, undefined, 140)
          const bas = Math.min(...aller.map((e) => e.cos))
          await p.keyboard.press('Escape')
          await joue(p, tag, undefined, 600)
          return bas
        }
        assert.ok(await tourne() < -0.99, 'zoom: spin : la carte tourne')
        // spin -> true : l'effet est reposé, plus de tour
        await clic('.bzt')
        assert.ok(await tourne() > 0.9999, 'zoom: true : la carte ne tourne plus')
        // true -> spin : le tour revient
        await clic('.bzs')
        assert.ok(await tourne() < -0.99, 'zoom: spin de nouveau : la carte tourne')
        // spin -> false : plus de zoom du tout
        await clic('.bzf')
        const sans = await etat(p, tag)
        assert.doesNotMatch(sans.marques, /-zoom/, 'plus de marque de zoom')
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        await joue(p, tag, undefined, 40)
        assert.doesNotMatch((await etat(p, tag)).marques, /zoomed/, 'un clic n\'agrandit plus la carte')
        await clic('.bzs')
        // back : suivi sur place — le même calque, une autre image, sans reposer l'effet
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        await joue(p, tag, undefined, 6)
        await p.evaluate(([t]: string[]) => { ((document.querySelector(t) as any)._shadow.querySelector('[mjs-fx-layer="hologram-back"]') as any).__temoin = 1 }, [tag])
        await clic('.bdos')
        const apres = await p.evaluate(([t]: string[]) => {
          const d = (document.querySelector(t) as any)._shadow.querySelector('[mjs-fx-layer="hologram-back"]') as any
          return d ? { temoin: d.__temoin, image: d.style.getPropertyValue('--mjs-fx-hologram-back') } : null
        }, [tag])
        assert.ok(apres, 'le dos est encore là (le retour n\'est pas fini)')
        assert.equal(apres!.temoin, 1, 'le même calque : l\'effet n\'a pas été reposé')
        assert.match(apres!.image, /^url\("data:image\/svg\+xml/, 'la nouvelle image du dos : ' + apres!.image.slice(0, 40))
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
}
