// une transition posée directement (`on: view`) est jugée à sa place, jamais à la place où l'emporte son mouvement, dans Chromium
// et Firefox réels :
//   · `once: false` près d'un bord de l'écran : *fly (sa sortie la redescend de 40 px) et *volet (sa sortie le déplace vers
//     l'écran, ce que Firefox voit) posés juste au-delà du bord sortent une fois et s'arrêtent — ils entraient et sortaient sans fin,
//     l'observateur voyant la boîte déplacée revenir à l'écran ; ramenés à l'écran, ils rentrent et finissent à leur place ;
//   · une première image qui sort la balise d'un parent qui rogne (`overflow: hidden`, *fly venu de 100 % de sa largeur) : la
//     balise attend cachée à sa place, l'observateur la voit, elle entre — elle restait invisible pour toujours.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
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

const IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22200%22%3E%3Crect width=%22300%22 height=%22200%22 fill=%22%23e11d48%22/%3E%3C/svg%3E'

const SOURCE = [
  '<div class="cadre"><div id="rogne" class="bande" *fly(direction: left, distance: 100%, duration: 300ms)>a</div></div>',
  '<div class="cadre"><div id="temoin" class="bande" *fly(direction: left, distance: 60%, duration: 300ms)>b</div></div>',
  '<div class="marge"></div>',
  `<img class="el" id="down" src="${IMAGE}" alt="" *volet(once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="up" src="${IMAGE}" alt="" *volet(direction: up, once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="fly" src="${IMAGE}" alt="" *fly(once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="fade" src="${IMAGE}" alt="" *fade(once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  '<style>', ':host', '  display: block', '.cadre', '  width: 300px', '  height: 60px', '  overflow: hidden', '  margin: 10px', '.bande', '  height: 60px', '  background: teal',
  '.el', '  display: block', '  width: 150px', '  height: 100px', '.marge', '  height: 2400px', '</style>', ''
].join('\n')

// [balise, bord, au-delà du bord en px]
const BORDS: Array<[string, 'top' | 'bottom', number]> = [['fly', 'top', 10], ['down', 'bottom', 20], ['up', 'top', 20], ['fade', 'top', 20]]

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`transitions on: view — jugées à leur place, sans boucle au bord ni attente sans fin (${nom} réel)`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-transitions-bord-sans-boucle-browser-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fx-bord.mjs'), SOURCE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    it('rognée par son parent, posée près d\'un bord : jouée une fois, à sa place', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-fx-bord></mjs-fx-bord><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-bord') as any)?._shadow?.querySelector('#fade'))
        const r = await page.evaluate(async (bords: Array<[string, string, number]>) => {
          const µ: any = (globalThis as any).µ
          const sh = (document.querySelector('mjs-fx-bord') as any)._shadow
          const el = (id: string) => sh.querySelector('#' + id)
          const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
          const etat = (id: string) => {
            const cs = getComputedStyle(el(id))
            return 'opacity=' + cs.opacity + ' transform=' + cs.transform + ' anims=' + el(id).getAnimations().length
          }
          // les jeux de chaque balise
          const jeux: string[] = []
          const jouer = µ._mjs_playTransition
          µ._mjs_playTransition = function (this: any, ...args: any[]) {
            jeux.push(args[0].id + ':' + args[2])
            return jouer.apply(this, args)
          }
          await attendre(1200)
          const rognees = { rogne: etat('rogne'), temoin: etat('temoin') }
          const bord: Record<string, string[]> = {}
          const retour: Record<string, string> = {}
          for (const [id, cote, d] of bords) {
            // vue au milieu de l'écran, son entrée jouée
            let b = el(id).getBoundingClientRect()
            window.scrollBy(0, b.top - 300)
            await attendre(900)
            // posée `d` px au-delà du bord, immobile
            b = el(id).getBoundingClientRect()
            if (cote === 'bottom') window.scrollBy(0, b.top - (innerHeight + d))
            else window.scrollBy(0, b.bottom + d)
            jeux.length = 0
            await attendre(2000)
            bord[id] = jeux.filter((j) => j.startsWith(id + ':'))
            // ramenée à l'écran : elle rentre et finit à sa place
            b = el(id).getBoundingClientRect()
            window.scrollBy(0, b.top - 300)
            await attendre(900)
            retour[id] = etat(id)
            window.scrollTo(0, 0)
            await attendre(300)
          }
          return { rognees, bord, retour }
        }, BORDS as Array<[string, string, number]>)
        // toutes les fautes relevées d'un coup
        const PLACE  = 'opacity=1 transform=none anims=0'
        const fautes: string[] = []
        if (r.rognees.rogne !== PLACE) fautes.push('la balise dont la première image sort de son cadre attend encore : ' + r.rognees.rogne)
        if (r.rognees.temoin !== PLACE) fautes.push('témoin rogné : ' + r.rognees.temoin)
        for (const [id, cote, d] of BORDS) {
          if (r.bord[id].length > 1) fautes.push(`${id} posée ${d} px au-delà du bord ${cote} : ${r.bord[id].length} jeux en 2 s (${r.bord[id].slice(0, 6).join(' ')})`)
          if (r.retour[id] !== PLACE) fautes.push(`${id} ramenée à l'écran : ${r.retour[id]}`)
        }
        assert.deepEqual(fautes, [])
      } finally {
        await browser.close()
      }
    })
  })
}
