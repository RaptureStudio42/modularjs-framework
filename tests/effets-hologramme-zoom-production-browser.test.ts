// *hologram(zoom) CONSTRUIT EN PRODUCTION (minifié, en un seul fichier), dans Chromium et Firefox réels : le tri des sections n'agit qu'en production, et c'est là
// qu'un morceau mal entouré casserait. Le tour et le dos (`zoom: spin`, `back`) sont une section du fichier de l'effet, gardée seulement quand l'un des deux est écrit
// (ou tenu par une variable) ; la marque de vol, le retour du premier plan et la sortie de la carte sont dans le moteur de carte, que toute carte embarque. Cinq
// applications, une construction chacune — le zoom simple, le tour, le tour avec une image de dos, `back` écrit sans tour, `zoom` tenu par une variable — et pour
// chacune le même geste : la carte vient, puis repart. Ce qui est relevé : le tour (jamais pour le zoom simple), le dos (jamais sans tour), le premier plan, aucune
// transition de `transform` pendant le vol malgré la pente d'`*tilt`, aucune erreur de page.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { navigateurPresent, construireProd, ouvrir, boite, fly, measure, page, PENTE, PILOTE, couleurs, type Construit } from './helpers/hologramme-zoom.js'

const DOS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" fill="#e8c020"/><circle cx="100" cy="140" r="60" fill="#a01030"/></svg>'
const FACE    = [[42, 74, 106], [122, 90, 154]]

const POSES: Record<string, Record<string, string>> = {
  simple:   { 'hp-simple.mjs': page('zoom: true', PENTE) },
  spin:     { 'hp-spin.mjs': page('zoom: spin', PENTE) },
  dos:      { 'hp-dos.mjs': page('zoom: spin', PENTE, ', back: \'dos.svg\''), 'dos.svg': DOS_SVG },
  back:     { 'hp-back.mjs': page('zoom: true', PENTE, ', back: \'dos.svg\''), 'dos.svg': DOS_SVG },
  variable: { 'hp-variable.mjs': `<script>\n$zoom = true\n$back = ''\n</script>\n<div class="carte a" *hologram(rays, zoom: $zoom, back: $back) ${PENTE}><b>A</b></div>\n<button class="bs" @click={$zoom = 'spin'}>s</button>\n<style>\n.carte\n  width: 200px\n  height: 280px\n  margin: 60px 0 0 60px\n  border-radius: 10px\n  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)\n.bs\n  position: absolute\n  top: 700px\n  left: 600px\n</style>` }
}

const compilations: Record<string, Promise<Construit>> = {}
const construit = (pose: string) => compilations[pose] ??= construireProd(POSES[pose], 'effets-hologramme-zoom-production-' + pose)

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*hologram(zoom) en production, une construction par application (${nom} réel)`, function () {
    this.timeout(300000)
    let present = false

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) console.log(`  ℹ️  ${nom} non installé, test du zoom en production sauté. Activer : \`npx playwright install ${nom}\``)
    })

    after(async () => { await terminateSharedWorkerPool() })

    // la carte `.a` vient (clic sur elle) puis repart (clic ailleurs) ; chaque vol est relevé, la carte posée entre les deux
    async function roundTrip(pose: string, tag: string, avant = async (_p: any) => {}) {
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { p, erreurs } = await ouvrir(browser, await construit(pose), tag)
        await avant(p)
        const z = await boite(p, tag, '.a')
        const aller  = measure(await fly(p, tag, 'click', () => p.mouse.click(z.x + z.w / 2, z.y + z.h / 2), '.a', 4200))
        const retour = measure(await fly(p, tag, 'pointerdown', () => p.mouse.click(650, 785), '.a', 4200))
        assert.deepEqual(erreurs, [], `${pose} : aucune erreur de page`)
        return { aller, retour }
      } finally {
        await browser.close()
      }
    }

    // le dos montré entre un quart et trois quarts de tour : la fenêtre dure environ 190 ms, une image y tombe si elles se suivent de moins de 150 ms (une machine très chargée en rend moins)
    const montre = (m: ReturnType<typeof measure>) => m.showed || m.grain > 150

    // ce que tout vol doit tenir, avec ou sans tour : la carte part, le premier plan tient, aucune transition de `transform` ne court pendant le vol
    function tient(m: ReturnType<typeof measure>, quoi: string) {
      assert.ok(m.start <= 4, `${quoi} : la carte a commencé à bouger à l'image ${m.start} (au plus la quatrième)`)
      assert.equal(m.transitions, 0, `${quoi} : ${m.transitions} images où une transition de transform court pendant le vol`)
      assert.equal(m.bare, 0, `${quoi} : ${m.bare} images du vol sans le premier plan`)
      assert.ok(m.duration < 2400 + 6 * m.grain, `${quoi} : la carte met ${m.duration} ms (moins de 2,4 s, plus six intervalles entre images de ${m.grain} ms : une machine chargée en rend peu)`)
      assert.equal(m.flyAtRest, false, `${quoi} : la marque de vol reste après l'arrivée`)
    }

    it('zoom: true : la carte vient et repart sans tour ni dos, malgré la pente', async function () {
      if (!present) { this.skip(); return }
      const { aller, retour } = await roundTrip('simple', 'mjs-hp-simple')
      for (const [m, sens] of [[aller, 'aller'], [retour, 'retour']] as const) {
        tient(m, sens)
        assert.equal(m.turn, 0, `${sens} : le zoom simple ne tourne pas`)
        assert.equal(m.backSeen, false, `${sens} : le zoom simple n'a pas de dos`)
      }
    })

    it('zoom: spin : le tour à l\'aller et au retour, le dos montré entre un quart et trois quarts de tour puis retiré', async function () {
      if (!present) { this.skip(); return }
      const { aller, retour } = await roundTrip('spin', 'mjs-hp-spin')
      for (const [m, sens] of [[aller, 'aller'], [retour, 'retour']] as const) {
        tient(m, sens)
        assert.ok(m.turn >= 359, `${sens} : un tour complet (étendue de l'angle ${m.turn}°)`)
        assert.ok(m.backSeen && montre(m), `${sens} : le dos naît et se montre à mi-tour (existé ${m.backSeen}, montré ${m.showed}, images à ${m.grain} ms au plus)`)
      }
      assert.equal(retour.backAtRest, false, 'revenue, la carte n\'a plus de dos')
    })

    it('zoom: spin avec une image de dos : le tour et le dos comme sans image', async function () {
      if (!present) { this.skip(); return }
      const { aller, retour } = await roundTrip('dos', 'mjs-hp-dos')
      for (const [m, sens] of [[aller, 'aller'], [retour, 'retour']] as const) {
        tient(m, sens)
        assert.ok(m.turn >= 359 && montre(m), `${sens} : le tour et le dos (étendue de l'angle ${m.turn}°, dos montré ${m.showed}, images à ${m.grain} ms au plus)`)
      }
      assert.equal(retour.backAtRest, false, 'revenue, la carte n\'a plus de dos')
    })

    it('zoom: spin avec une image de dos : à 180 degrés la capture montre l\'image copiée par la construction et aucun pixel de la face', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hp-dos'
        const { p, erreurs } = await ouvrir(browser, await construit('dos'), tag, {}, PILOTE)
        const z = await boite(p, tag, '.a')
        await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
        await p.mouse.move(690, 790)
        let angle = 0
        for (let i = 0; i < 200 && Math.cos(angle * Math.PI / 180) >= -0.99; i++) {
          await p.evaluate(() => (window as any).__pas(1))
          angle = await p.evaluate((t: string) => parseFloat(((document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement).style.getPropertyValue('--mjs-fx-hologram-rx') || '0'), tag)
        }
        assert.ok(Math.cos(angle * Math.PI / 180) < -0.99, `la carte est de dos (angle ${angle})`)
        await p.waitForTimeout(400)
        const b   = await boite(p, tag, '.a')
        const png = await p.screenshot({ clip: { x: b.x + b.w * 0.05, y: b.y + b.h * 0.05, width: b.w * 0.9, height: b.h * 0.9 } })
        const [or, rouge, f1, f2] = await couleurs(p, png, [[232, 192, 32], [160, 16, 48], ...FACE])
        assert.ok(or > 0.3 && rouge > 0.1, `l'image du dos est là : fond doré ${(or * 100).toFixed(1)} %, disque ${(rouge * 100).toFixed(1)} %`)
        assert.ok(f1 + f2 < 0.005, `aucun pixel de la face : ${((f1 + f2) * 100).toFixed(2)} %`)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('zoom: true avec back écrit : la section du tour est gardée, le zoom reste simple, sans tour ni dos', async function () {
      if (!present) { this.skip(); return }
      const { aller, retour } = await roundTrip('back', 'mjs-hp-back')
      for (const [m, sens] of [[aller, 'aller'], [retour, 'retour']] as const) {
        tient(m, sens)
        assert.equal(m.turn, 0, `${sens} : pas de tour`)
        assert.equal(m.backSeen, false, `${sens} : pas de dos`)
      }
    })

    it('zoom tenu par une variable : la section du tour est gardée, la carte tourne quand la variable vaut spin', async function () {
      if (!present) { this.skip(); return }
      const { aller, retour } = await roundTrip('variable', 'mjs-hp-variable', async (p) => {
        const b = await boite(p, 'mjs-hp-variable', '.bs')
        await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
        await p.waitForTimeout(300)
      })
      for (const [m, sens] of [[aller, 'aller'], [retour, 'retour']] as const) {
        tient(m, sens)
        assert.ok(m.turn >= 359 && montre(m), `${sens} : le tour et le dos (étendue de l'angle ${m.turn}°, dos montré ${m.showed}, images à ${m.grain} ms au plus)`)
      }
    })
  })
}
