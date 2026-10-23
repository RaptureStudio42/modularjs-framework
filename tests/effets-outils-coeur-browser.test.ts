// les outils du cœur des effets (runtime/mjs_fx_tool*.ts) dans des navigateurs réels : ce que happy-dom ne mesure pas — la boîte d'une
// balise bordée dans un parent mis à l'échelle, relue après un défilement (dans le document et dans un composant), l'observateur de
// visibilité réel, le <svg> caché dans une ombre, la variable enregistrée sans héritage.
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté).

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const CODE    = ['mjs_fx.ts', 'mjs_fx_toolup.ts', 'mjs_fx_toolroots.ts', 'mjs_fx_toolbox.ts', 'mjs_fx_toolwatch.ts', 'mjs_fx_toolregister.ts', 'mjs_fx_toolvisible.ts', 'mjs_fx_toolsvg.ts'].map((f) => readFileSync(join(RUNTIME, f), 'utf-8')).join('\n')

// une scène : un cadre qui défile, un parent mis à l'échelle (1.5 en largeur, 1.25 en hauteur), la balise bordée de 12 px, et un repère
// posé à (40, 30) dans son cadre intérieur ; la même balise dans l'ombre d'un composant ; une balise loin sous la page
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}
.cadre{width:500px;height:300px;overflow:auto;position:relative}
.long{height:900px}
.echelle{width:300px;margin:10px;transform:scale(1.5,1.25);transform-origin:0 0}
.balise{position:relative;width:200px;height:100px;border:12px solid #333;background:#222}
.repere{position:absolute;left:40px;top:30px;width:0;height:0}
.loin{margin-top:2000px;height:40px;background:#ccc}
</style></head><body>
<div class="cadre" id="cadre"><div class="long"><div class="echelle"><div class="balise" id="b"><i class="repere" id="r"></i></div></div></div></div>
<div id="hote"></div><div class="loin" id="loin"></div>
<script>var µ = {};\n${CODE.replace(/<\/script>/g, '<\\/script>')}\n</script></body></html>`

describe('les outils du cœur des effets (navigateurs réels)', function () {
  this.timeout(120000)

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
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

      beforeEach(function () { if (!present) this.skip() })

      async function avec<T>(fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        try {
          await page.setContent(PAGE)
          const r = await fn(page)
          assert.deepEqual(erreurs, [])
          return r
        } finally {
          await page.close()
        }
      }

      it('la boîte : un point de la fenêtre rendu dans le repère intérieur de la balise bordée et mise à l\'échelle (le repère posé à 40, 30)', async function () {
        await avec(async (page) => {
          const r = await page.evaluate(() => {
            const el = document.getElementById('b')!
            const b = (window as any).µ._mjs_fxBox(el)
            const p = document.getElementById('r')!.getBoundingClientRect()
            return { x: (p.left - b.l) / b.sx - el.clientLeft, y: (p.top - b.t) / b.sy - el.clientTop }
          })
          assert.ok(Math.abs(r.x - 40) < 0.05, 'x : ' + r.x)
          assert.ok(Math.abs(r.y - 30) < 0.05, 'y : ' + r.y)
        })
      })

      it('watch : la boîte est relue après un défilement du cadre ; sans watch elle reste celle de l\'entrée', async function () {
        await avec(async (page) => {
          const r = await page.evaluate(async () => {
            const µ = (window as any).µ
            const el = document.getElementById('b')!
            const cadre = document.getElementById('cadre')!
            const attend = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))
            let suivie = µ._mjs_fxBox(el)
            const aveugle = µ._mjs_fxBox(el)
            const off = µ._mjs_fxWatch(el, () => { suivie = µ._mjs_fxBox(el) })
            const t0 = suivie.t
            cadre.scrollTop = 50
            await attend()
            const t1 = suivie.t
            const t2 = aveugle.t
            off()
            cadre.scrollTop = 0
            await attend()
            return { t0, t1, t2, apres: suivie.t }
          })
          assert.ok(Math.abs((r.t0 - r.t1) - 50) < 0.5, 'la boîte suivie a bougé de 50 px avec le défilement : ' + r.t0 + ' → ' + r.t1)
          assert.equal(r.t2, r.t0, 'sans surveillance, la boîte reste celle de la première lecture')
          assert.equal(r.apres, r.t1, 'unwatch : plus rien ne la périme')
        })
      })

      it('watch à travers une ombre : le défilement du cadre qui contient le composant périme la boîte de la balise du composant', async function () {
        await avec(async (page) => {
          const r = await page.evaluate(async () => {
            const µ = (window as any).µ
            const cadre = document.getElementById('cadre')!
            const hote = document.createElement('div')
            cadre.querySelector('.long')!.appendChild(hote)
            const ombre = hote.attachShadow({ mode: 'open' })
            ombre.innerHTML = '<div id="dedans" style="width:100px;height:40px;background:#444"></div>'
            const el = ombre.getElementById('dedans')!
            let box = µ._mjs_fxBox(el)
            const off = µ._mjs_fxWatch(el, () => { box = µ._mjs_fxBox(el) })
            const t0 = box.t
            cadre.scrollTop = 80
            await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))
            const t1 = box.t
            off()
            return { t0, t1 }
          })
          assert.ok(Math.abs((r.t0 - r.t1) - 80) < 0.5, 'la boîte a suivi le défilement de 80 px : ' + r.t0 + ' → ' + r.t1)
        })
      })

      it('watch sans surveillance de taille (3e paramètre vrai) : redimensionner la balise n\'appelle pas f, un défilement l\'appelle ; sans le paramètre la taille est surveillée', async function () {
        await avec(async (page) => {
          const r = await page.evaluate(async () => {
            const µ = (window as any).µ
            const el = document.getElementById('b')!
            const cadre = document.getElementById('cadre')!
            const attend = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))
            let surveillee = 0
            let fixe = 0
            // un `resize` de la fenêtre réveille f, c'est voulu, mais ne dit rien de la balise : le WebKit de Playwright en envoie un peu après
            // la pose de la page, au milieu de la séance. Seuls les appels qui n'en viennent pas sont comptés (f reçoit l'évènement quand il en est un)
            const compte = (e: any) => !e || e.type !== 'resize'
            const offA = µ._mjs_fxWatch(el, (e: any) => { if (compte(e)) surveillee++ })
            const offB = µ._mjs_fxWatch(el, (e: any) => { if (compte(e)) fixe++ }, true)
            await attend()
            await attend()
            el.style.width = '230px'
            await attend()
            await attend()
            const apresTaille = { surveillee, fixe }
            cadre.scrollTop = 50
            await attend()
            const apresDefilement = { surveillee, fixe }
            offA()
            offB()
            cadre.scrollTop = 0
            el.style.width = '260px'
            await attend()
            await attend()
            return { apresTaille, apresDefilement, fin: { surveillee, fixe } }
          })
          assert.deepEqual(r.apresTaille, { surveillee: 1, fixe: 0 }, 'la taille de la balise ne réveille que la surveillance qui la suit')
          assert.deepEqual(r.apresDefilement, { surveillee: 2, fixe: 1 }, 'le défilement du cadre réveille les deux')
          assert.deepEqual(r.fin, r.apresDefilement, 'plus rien après off')
        })
      })

      it('visible : une balise loin sous la page est dite sortie, entre quand on la montre, sort quand on s\'en va', async function () {
        await avec(async (page) => {
          const r = await page.evaluate(async () => {
            const µ = (window as any).µ
            const journal: string[] = []
            const attend = () => new Promise((ok) => setTimeout(ok, 150))
            const off = µ._mjs_fxVisible(document.getElementById('loin'), '0px', () => journal.push('entre'), () => journal.push('sort'))
            await attend()
            document.getElementById('loin')!.scrollIntoView()
            await attend()
            window.scrollTo(0, 0)
            await attend()
            off()
            document.getElementById('loin')!.scrollIntoView()
            await attend()
            return journal
          })
          assert.deepEqual(r, ['sort', 'entre', 'sort'])
        })
      })

      it('svg caché : posé dans l\'ombre du composant, nul ; dans le <body> pour une balise du document', async function () {
        await avec(async (page) => {
          const r = await page.evaluate(() => {
            const µ = (window as any).µ
            const hote = document.getElementById('hote')!
            const ombre = hote.attachShadow({ mode: 'open' })
            const el = ombre.appendChild(document.createElement('div'))
            const svg = µ._mjs_fxSvgDefs(el)
            const dehors = µ._mjs_fxSvgDefs(document.getElementById('b'))
            const q = svg.getBoundingClientRect()
            return { dansOmbre: svg.parentNode === ombre, taille: q.width + q.height, dansBody: dehors.parentNode === document.body }
          })
          assert.equal(r.dansOmbre, true)
          assert.equal(r.taille, 0)
          assert.equal(r.dansBody, true)
        })
      })

      it('variable enregistrée : sans héritage, un enfant ne voit pas la valeur du parent ; sans enregistrement elle est héritée', async function () {
        await avec(async (page) => {
          const r = await page.evaluate(() => {
            const µ = (window as any).µ
            µ._mjs_fxRegister('--mjs-fx-essai-d', '<number>', '0')
            µ._mjs_fxRegister('--mjs-fx-essai-d', '<number>', '0')
            const parent = document.body.appendChild(document.createElement('div'))
            const enfant = parent.appendChild(document.createElement('div'))
            parent.style.setProperty('--mjs-fx-essai-d', '5')
            parent.style.setProperty('--mjs-fx-essai-libre', '5')
            return { enregistree: getComputedStyle(enfant).getPropertyValue('--mjs-fx-essai-d'), libre: getComputedStyle(enfant).getPropertyValue('--mjs-fx-essai-libre') }
          })
          assert.equal(r.enregistree, '0')
          assert.equal(r.libre, '5')
        })
      })
    })
  }
})
