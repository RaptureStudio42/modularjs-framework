// *longshadow dans Chromium et Firefox réels : des pixels d'une capture. La lampe (`light: true`) reste
// dans la zone de la balise — le premier ancêtre qui rogne son contenu, la fenêtre sans lui — : éteinte
// quand le pointeur est dans la boîte voisine, allumée dans la zone, son halo rogné au bord de la zone
// (coins arrondis suivis) ; sans zone, allumée comme avant, hors de la balise comprise ; dans une zone
// qui défile, ou quand la page défile sous un pointeur immobile, elle suit. Le retrait ne laisse rien
// (lampe, fenêtre, écouteur de défilement, image d'animation) ; hors de l'écran, rien n'est écrit. La
// zone se cherche par-dessus un shadow root (la balise dans un composant dont l'hôte rogne), et ne compte que les
// ancêtres qui contiennent vraiment la balise : aucun pour une balise `fixed`, le bloc conteneur et ceux qui le
// contiennent pour une balise `absolute`, un parent `absolute` échappe à ce qui ne le contient pas, une fenêtre de
// dialogue `fixed` est la zone de ce qu'elle contient, un parent sans boîte (display: contents) ne rogne rien, un parent sans
// position mais qui retient les balises fixes et absolues (transformation, filtre, confinement…) est leur zone — la règle du
// moteur des effets, sauf le conteneur de requêtes (`container-type`), que Chromium et Firefox ne traitent pas comme un bloc
// englobant : il ne retient pas une balise fixe, sa zone est la fenêtre. La couleur
// `currentColor` se lit juste sur un composant sans <slot> (la sonde ne tombe pas dans l'arbre aplati),
// sur une balise dont le shadow root est hors de portée, et garde la transparence d'une couleur écrite.

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

// une feuille SASS écrite depuis un objet : sélecteur → propriétés
function sass(blocs: Record<string, Record<string, string>>): string {
  return '<style>\n' + Object.entries(blocs).map(([sel, props]) => [sel, ...Object.entries(props).map(([k, v]) => `  ${k}: ${v}`)].join('\n')).join('\n') + '\n</style>\n'
}

const px = (n: number) => n + 'px'

// la balise : un titre en gras, posé à la main dans sa zone
const texte = (gauche: number, haut: number) => ({ position: 'absolute', left: px(gauche), top: px(haut), margin: '0', font: '700 32px/40px sans-serif', color: '#f1faee' })

// une boîte posée à la main
const boite = (gauche: number, haut: number, large: number, haute: number, plus: Record<string, string> = {}) => ({ position: 'absolute', left: px(gauche), top: px(haut), width: px(large), height: px(haute), background: '#1d3557', ...plus })

const BALISE = '<h2 class="t" *longshadow(light: true, length: 100)>Ombre</h2>'

const SOURCES: Record<string, string> = {
  // la balise dans une zone qui rogne (300 × 200), une boîte voisine à côté
  'ol-voisine.mjs': `<div class="a">${BALISE}</div>\n<div class="b"></div>\n` + sass({ '.a': boite(20, 20, 300, 200, { overflow: 'hidden' }), '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }), '.t': texte(150, 20) }),
  // la balise dans un composant, dont l'hôte (dans la page) rogne : la zone se cherche par-dessus le shadow root
  'ol-carte.mjs': `${BALISE}\n` + sass({ '.t': texte(150, 20) }),
  'ol-hote.mjs': '<@ol-carte class="c"></@ol-carte>\n<div class="b"></div>\n' + sass({ '.c': boite(20, 20, 300, 200, { display: 'block', overflow: 'hidden' }), '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }) }),
  // une zone aux coins arrondis
  'ol-arrondi.mjs': `<div class="a">${BALISE}</div>\n` + sass({ '.a': boite(20, 20, 300, 200, { overflow: 'hidden', 'border-radius': '60px' }), '.t': texte(100, 60) }),
  // la balise sans ancêtre qui rogne, une boîte qui rogne à côté (sans la contenir)
  'ol-libre.mjs': `${BALISE}\n<div class="n"></div>\n` + sass({ '.t': texte(250, 150), '.n': boite(420, 120, 150, 100, { overflow: 'hidden', background: '#6d2e46' }) }),
  // la balise `fixed` dans une zone qui rogne : la zone ne l'atteint pas, la balise s'affiche par-dessus la boîte voisine ; la balise `absolute` dont le bloc conteneur est plus haut que la zone
  'ol-fixe.mjs': `<div class="a">${BALISE}</div>\n<div class="b"></div>\n` + sass({ '.a': boite(20, 20, 300, 200, { overflow: 'hidden' }), '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }), '.t': { ...texte(380, 80), position: 'fixed' } }),
  'ol-conteneur.mjs': `<div class="a">${BALISE}</div>\n<div class="b"></div>\n` + sass({ '.a': { margin: '20px 0 0 20px', width: '300px', height: '200px', overflow: 'hidden', background: '#1d3557', 'container-type': 'inline-size' }, '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }), '.t': { ...texte(380, 80), position: 'fixed' } }),
  'ol-absolu.mjs': `<div class="a">${BALISE}</div>\n<div class="b"></div>\n` + sass({ '.a': { margin: '20px 0 0 20px', width: '300px', height: '200px', overflow: 'hidden', background: '#1d3557' }, '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }), '.t': texte(380, 80) }),
  // la balise sans position dans un parent `absolute` (.a), lui-même dans une zone qui rogne sans le contenir (.o) : le parent échappe à la zone, la balise aussi
  'ol-parent-absolu.mjs': `<div class="o"><div class="a">${BALISE}</div></div>\n` + sass({ '.o': { margin: '20px 0 0 20px', width: '300px', height: '200px', overflow: 'hidden', background: '#1d3557' }, '.a': { position: 'absolute', left: '380px', top: '80px', width: '200px', height: '60px' }, '.t': { margin: '0', font: '700 32px/40px sans-serif', color: '#f1faee' } }),
  // la balise `absolute` : son bloc conteneur (.cb) est sous la zone qui la contient (.o) et au-dessus d'une zone qui rogne sans la contenir (.m)
  'ol-chaine.mjs': `<div class="o"><div class="cb"><div class="m">${BALISE}</div></div></div>\n` + sass({ '.o': boite(20, 20, 300, 200, { overflow: 'hidden' }), '.cb': { position: 'relative', width: '300px', height: '200px' }, '.m': { width: '120px', height: '60px', overflow: 'hidden', background: '#6d2e46' }, '.t': texte(130, 100) }),
  // la balise dans une fenêtre de dialogue `fixed` qui rogne : la fenêtre la contient, c'est sa zone
  'ol-modale.mjs': `<div class="a">${BALISE}</div>\n<div class="b"></div>\n` + sass({ '.a': boite(20, 20, 300, 200, { position: 'fixed', overflow: 'hidden' }), '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }), '.t': texte(150, 20) }),
  // la balise sans position sous un parent sans boîte (display: contents) qui rogne : il ne rogne rien, la zone est la boîte qui le contient
  'ol-sans-boite.mjs': `<div class="a"><div class="w">${BALISE}</div></div>\n` + sass({ '.a': boite(20, 20, 300, 200, { overflow: 'hidden' }), '.w': { display: 'contents', overflow: 'hidden' }, '.t': { margin: '0', font: '700 32px/40px sans-serif', color: '#f1faee' } }),
  // une zone qui défile (contenu de 600 px dans 200), sous une page qui défile
  'ol-defile.mjs': `<div class="z"><div class="long">${BALISE}</div></div>\n<div class="pied"></div>\n` + sass({ '.z': boite(20, 120, 300, 200, { overflow: 'auto' }), '.long': { position: 'relative', height: '600px' }, '.t': texte(100, 150), '.pied': { position: 'absolute', left: '0', top: '2000px', width: '10px', height: '10px' } }),
  // une zone qui défile dans son shadow root, la balise à portée courte (60 px) : trop loin du pointeur, puis la zone la lui amène
  'ol-glisse.mjs': '<div class="z"><div class="long"><h2 class="t" *longshadow(light: true, length: 30)>Ombre</h2></div></div>\n' + sass({ '.z': boite(20, 120, 300, 200, { overflow: 'auto' }), '.long': { position: 'relative', height: '600px' }, '.t': texte(100, 150) }),
  // la balise posée et retirée par un bloc
  'ol-retrait.mjs': `<script>\n$on = false\n</script>\n{if $on}<div class="a">${BALISE}</div>{end}\n<button class="b" @click={$on = !$on}>t</button>\n` + sass({ '.a': boite(20, 20, 300, 200, { overflow: 'hidden' }), '.t': texte(100, 60), '.b': { position: 'absolute', left: '600px', top: '340px' } }),
  // un composant sans <slot>, un composant dont le <slot> est dans une boîte bleue
  'ol-sans-slot.mjs': '<p class="x">Dans le composant</p>\n' + sass({ '.x': { margin: '0' } }),
  'ol-avec-slot.mjs': '<div class="b"><slot></slot></div>\n' + sass({ '.b': { color: '#0000ff' } }),
  // la couleur de la balise (rouge) lue par `currentColor` : composant sans <slot>, avec <slot>, balise au shadow root fermé hors de portée, balise ordinaire ; une couleur écrite avec sa transparence
  'ol-couleur.mjs': [
    '<@ol-sans-slot class="s" *longshadow(color: currentColor, follow: fixed)>texte</@ol-sans-slot>',
    '<@ol-avec-slot class="a" *longshadow(color: currentColor, follow: fixed)>texte</@ol-avec-slot>',
    '<x-ferme class="f" *longshadow(color: currentColor, follow: fixed)>texte</x-ferme>',
    '<div class="r" *longshadow(color: currentColor, follow: fixed)>texte</div>',
    '<div class="al" *longshadow(color: #0000ff33, follow: fixed)>texte</div>',
    sass({ '.s, .a, .f, .r': { display: 'block', color: '#ff0000' } })
  ].join('\n')
}

// la balise `fixed` ou `absolute` dans une zone (.a) sans position mais qui la retient (transformation, confinement de la mise en page, filtre) et qui rogne : la zone contient la balise, c'est sa zone
const RETENUES: Array<[string, string, string, string]> = [
  ['transform', 'fixed', 'transform', 'translateX(0)'],
  ['transform-abs', 'absolute', 'transform', 'translateX(0)'],
  ['contain-layout', 'fixed', 'contain', 'layout'],
  ['filter-abs', 'absolute', 'filter', 'opacity(1)']
]

// la balise sans position dans un parent fixe (.d), lui-même retenu par une zone transformée qui rogne (.a) : la retenue se poursuit de parent en parent, la zone est .a
SOURCES['ol-retenue-chaine.mjs'] = `<div class="a"><div class="d">${BALISE}</div></div>\n<div class="b"></div>\n` + sass({ '.a': { margin: '20px 0 0 20px', width: '300px', height: '200px', overflow: 'hidden', background: '#1d3557', transform: 'translateX(0)' }, '.d': { position: 'fixed', left: '0', top: '0', padding: '20px 0 0 150px' }, '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }), '.t': { margin: '0', font: '700 32px/40px sans-serif', color: '#f1faee' } })

for (const [cle, position, propriete, valeur] of RETENUES) {
  SOURCES[`ol-retenue-${cle}.mjs`] = `<div class="a">${BALISE}</div>\n<div class="b"></div>\n` + sass({ '.a': { margin: '20px 0 0 20px', width: '300px', height: '200px', overflow: 'hidden', background: '#1d3557', [propriete]: valeur }, '.b': boite(340, 20, 300, 200, { background: '#6d2e46' }), '.t': { ...texte(150, 20), position } })
}

// une balise qui a un shadow root fermé, sans <slot>, que le moteur ne connaît pas (ni `_shadow`, ni `shadowRoot`)
const ENTETE_FERME = '<script>customElements.define("x-ferme", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "closed" }).innerHTML = "<p>dans le shadow</p>" } })</script>'

// espion posé avant la page : les écouteurs `scroll` vivants (ajoutés moins retirés, même cible, même fonction, même phase) et les images d'animation en attente
const ESPION = `(() => {
  const vivants = []
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  const phase = (o) => o === true || !!(o && o.capture)
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (type === 'scroll' && fn && !vivants.some((v) => v.t === this && v.f === fn && v.c === phase(o))) vivants.push({ t: this, f: fn, c: phase(o) })
    return ajoute.call(this, type, fn, o)
  }
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    if (type === 'scroll') {
      const i = vivants.findIndex((v) => v.t === this && v.f === fn && v.c === phase(o))
      if (i >= 0) vivants.splice(i, 1)
    }
    return retire.call(this, type, fn, o)
  }
  window.__scroll = () => vivants.length
  const attend = new Set()
  const raf = window.requestAnimationFrame.bind(window)
  const caf = window.cancelAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => { const id = raf((t) => { attend.delete(id); cb(t) }); attend.add(id); return id }
  window.cancelAnimationFrame = (id) => { attend.delete(id); caf(id) }
  window.__raf = () => Array.from(attend)
})()`

type Rect = { x: number, y: number, w: number, h: number }

const FOND_PAGE = [16, 24, 32]

const blanc = (c: number[]) => c.every((v) => v >= 245)
const egal = (a: number[], b: number[], tol = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*longshadow, la lampe et la couleur (${nom} réel) — des pixels`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de *longshadow sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-ombre-longue-browser-' + nom)
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
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    // la page `tag`, ouverte dans un navigateur neuf : 700 × 400, fond sombre ; `reduire` : « réduire les animations » ; `entete` : un script posé avant le code ; `espion` : voir ESPION
    async function ouvre(browser: any, tag: string, classe: string, o: { reduire?: boolean, entete?: string, espion?: boolean } = {}) {
      const page = await browser.newPage({ viewport: { width: 700, height: 400 }, reducedMotion: o.reduire ? 'reduce' : 'no-preference' })
      const erreurs: string[] = []
      // les exceptions de la page, et tout message qui nomme l'effet
      page.on('console', (m: any) => { if (m.text().includes('longshadow')) erreurs.push(m.text()) })
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      if (o.espion) await page.addInitScript(ESPION)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:rgb(${FOND_PAGE.join(',')})}</style></head><body><${tag}></${tag}>${o.entete ?? ''}<script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c), [tag, classe])
      await page.waitForTimeout(400)
      return { page, erreurs }
    }

    async function essai(tag: string, classe: string, fn: (page: any, erreurs: string[]) => Promise<void>, o: { reduire?: boolean, entete?: string, espion?: boolean } = {}) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page, erreurs } = await ouvre(browser, tag, classe, o)
        await fn(page, erreurs)
      } finally {
        await browser.close()
      }
    }

    // le rectangle d'une balise du composant, dans la fenêtre
    const rect = (page: any, tag: string, classe: string): Promise<Rect> => page.evaluate(([t, c]: string[]) => {
      const r = (document.querySelector(t) as any)._shadow.querySelector('.' + c).getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }, [tag, classe])

    // le pointeur ici, la lampe a le temps d'être dessinée, puis la capture de la fenêtre
    async function pointeur(page: any, x: number, y: number): Promise<Buffer> {
      await page.mouse.move(x, y)
      await page.waitForTimeout(350)
      return page.screenshot()
    }

    // les pixels `[x, y]` d'une capture
    async function lire(page: any, png: Buffer, points: number[][]): Promise<number[][]> {
      return page.evaluate(async ([b64, ps]: [string, number[][]]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        return ps.map(([x, y]) => Array.from(c.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
      }, [png.toString('base64'), points])
    }

    // le pixel `[x, y]` d'une capture
    const un = async (page: any, png: Buffer, x: number, y: number): Promise<number[]> => (await lire(page, png, [[x, y]]))[0]

    // les pixels qui diffèrent d'une capture à l'autre HORS du rectangle `zone` : leur nombre, l'écart le plus grand, leur boîte
    async function dehors(page: any, a: Buffer, b: Buffer, zone: Rect): Promise<{ n: number, max: number, boite: number[] | null }> {
      return page.evaluate(async ([ba, bb, z]: [string, string, Rect]) => {
        const charge = async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const c = cv.getContext('2d') as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          return c.getImageData(0, 0, img.width, img.height)
        }
        const A = await charge(ba)
        const B = await charge(bb)
        let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
        for (let y = 0; y < A.height; y++) {
          for (let x = 0; x < A.width; x++) {
            if (x >= Math.round(z.x) && x < Math.round(z.x + z.w) && y >= Math.round(z.y) && y < Math.round(z.y + z.h)) continue
            const i = (y * A.width + x) * 4
            const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]))
            if (d > max) max = d
            if (d > 6) {
              n++
              if (x < x0) x0 = x
              if (y < y0) y0 = y
              if (x > x1) x1 = x
              if (y > y1) y1 = y
            }
          }
        }
        return { n, max, boite: n ? [x0, y0, x1, y1] : null }
      }, [a.toString('base64'), b.toString('base64'), zone])
    }

    const LOIN = [695, 395]

    it('dans une zone qui rogne : éteinte quand le pointeur est dans la boîte voisine (à 100 px de la balise), allumée dans la zone, son halo rogné au bord de la zone', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-voisine', 't', async (page, erreurs) => {
        const zone   = await rect(page, 'mjs-ol-voisine', 'a')
        const balise = await rect(page, 'mjs-ol-voisine', 't')
        const base   = await pointeur(page, LOIN[0], LOIN[1])
        // dans la boîte voisine, à 100 px du bord de la balise : à moins de la portée de l'ombre (200), hors de la zone
        const vx = balise.x + balise.w + 100
        const vy = balise.y + balise.h / 2
        const voisine = await pointeur(page, vx, vy)
        const dansVoisine = await un(page, voisine, vx, vy)
        const sansPointeur = await un(page, base, vx, vy)
        assert.ok(egal(dansVoisine, sansPointeur), `la lampe brille dans la boîte voisine : ${JSON.stringify(dansVoisine)} (sans pointeur ${JSON.stringify(sansPointeur)})`)
        const ecartVoisine = await dehors(page, base, voisine, zone)
        assert.equal(ecartVoisine.n, 0, `pointeur dans la boîte voisine : ${ecartVoisine.n} pixels changés hors de la zone (écart ${ecartVoisine.max}, boîte ${JSON.stringify(ecartVoisine.boite)})`)
        // dans la zone, près de son bord droit : la lampe est allumée, et son halo s'arrête au bord de la zone
        const ix = zone.x + zone.w - 10
        const iy = balise.y + balise.h / 2
        const dedans = await pointeur(page, ix, iy)
        const dansZone = await un(page, dedans, ix, iy)
        assert.ok(blanc(dansZone), `pointeur dans la zone : la lampe n'est pas allumée (${JSON.stringify(dansZone)})`)
        const ecart = await dehors(page, base, dedans, zone)
        assert.equal(ecart.n, 0, `le halo sort de la zone : ${ecart.n} pixels changés dehors (écart ${ecart.max}, boîte ${JSON.stringify(ecart.boite)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    it('la zone se cherche par-dessus un shadow root : la balise dans un composant dont l\'hôte rogne — éteinte dans la boîte voisine, allumée dans l\'hôte, halo rogné', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-hote', 'c', async (page, erreurs) => {
        await page.waitForFunction(() => !!(document.querySelector('mjs-ol-hote') as any)._shadow.querySelector('.c')._shadow?.querySelector('.t'))
        await page.waitForTimeout(300)
        const zone   = await rect(page, 'mjs-ol-hote', 'c')
        const balise: Rect = await page.evaluate(() => { const r = (document.querySelector('mjs-ol-hote') as any)._shadow.querySelector('.c')._shadow.querySelector('.t').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
        const base   = await pointeur(page, LOIN[0], LOIN[1])
        const vx = balise.x + balise.w + 100
        const vy = balise.y + balise.h / 2
        const voisine = await pointeur(page, vx, vy)
        const dansVoisine = await un(page, voisine, vx, vy)
        const sansPointeur = await un(page, base, vx, vy)
        assert.ok(egal(dansVoisine, sansPointeur), `la lampe brille dans la boîte voisine : ${JSON.stringify(dansVoisine)} (sans pointeur ${JSON.stringify(sansPointeur)})`)
        const ecartVoisine = await dehors(page, base, voisine, zone)
        assert.equal(ecartVoisine.n, 0, `pointeur dans la boîte voisine : ${ecartVoisine.n} pixels changés hors de la zone (boîte ${JSON.stringify(ecartVoisine.boite)})`)
        const ix = zone.x + zone.w - 10
        const iy = balise.y + balise.h / 2
        const dedans = await pointeur(page, ix, iy)
        const dansZone = await un(page, dedans, ix, iy)
        assert.ok(blanc(dansZone), `pointeur dans l'hôte : la lampe n'est pas allumée (${JSON.stringify(dansZone)})`)
        const ecart = await dehors(page, base, dedans, zone)
        assert.equal(ecart.n, 0, `le halo sort de l'hôte : ${ecart.n} pixels changés dehors (boîte ${JSON.stringify(ecart.boite)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    it('les coins arrondis de la zone sont suivis : le halo ne remplit pas le coin coupé', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-arrondi', 't', async (page) => {
        const zone = await rect(page, 'mjs-ol-arrondi', 'a')
        const base = await pointeur(page, LOIN[0], LOIN[1])
        // dans la zone, près de son coin haut gauche (rayon 60) : le pixel du coin extrême est hors de la zone
        const ix = zone.x + 40
        const iy = zone.y + 40
        const allume = await pointeur(page, ix, iy)
        const pointe = await un(page, allume, ix, iy)
        const coinAllume = await un(page, allume, zone.x + 3, zone.y + 3)
        const coinBase = await un(page, base, zone.x + 3, zone.y + 3)
        assert.ok(blanc(pointe), `la lampe n'est pas allumée dans la zone (${JSON.stringify(pointe)})`)
        assert.ok(egal(coinAllume, coinBase, 6), `le coin coupé de la zone est éclairé : ${JSON.stringify(coinAllume)} au lieu de ${JSON.stringify(coinBase)}`)
        const ecart = await dehors(page, base, allume, zone)
        assert.equal(ecart.n, 0, `le halo sort de la zone : ${ecart.n} pixels changés dehors (boîte ${JSON.stringify(ecart.boite)})`)
      })
    })

    it('sans ancêtre qui rogne : la lampe s\'allume comme avant — à moins de la portée de l\'ombre, hors du rectangle de la balise, par-dessus une boîte voisine ; plus loin, éteinte', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-libre', 't', async (page, erreurs) => {
        const balise  = await rect(page, 'mjs-ol-libre', 't')
        const voisine = await rect(page, 'mjs-ol-libre', 'n')
        const base    = await pointeur(page, LOIN[0], LOIN[1])
        // à 60 px à droite de la balise : hors de son rectangle, à moins de 200 px
        const ax = balise.x + balise.w + 60
        const ay = balise.y + balise.h / 2
        const proche = await un(page, await pointeur(page, ax, ay), ax, ay)
        assert.ok(blanc(proche), `à 60 px de la balise : la lampe n'est pas allumée (${JSON.stringify(proche)})`)
        // par-dessus la boîte voisine qui rogne mais ne contient pas la balise
        const bx = voisine.x + voisine.w / 2
        const by = voisine.y + voisine.h / 2
        const surVoisine = await un(page, await pointeur(page, bx, by), bx, by)
        assert.ok(blanc(surVoisine), `par-dessus la boîte voisine : la lampe n'est pas allumée (${JSON.stringify(surVoisine)})`)
        // à 250 px : plus loin que la portée (200), éteinte
        const lx = balise.x + balise.w + 250
        const ly = balise.y + balise.h / 2
        const loin = await un(page, await pointeur(page, lx, ly), lx, ly)
        const sansPointeur = await un(page, base, lx, ly)
        assert.ok(egal(loin, sansPointeur), `à 250 px de la balise : la lampe brille (${JSON.stringify(loin)} au lieu de ${JSON.stringify(sansPointeur)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    // la zone de la lampe est le premier ancêtre qui rogne ET qui contient vraiment la balise : une balise `fixed` n'a pas de zone (la fenêtre) ; une balise `absolute`, seulement son
    // bloc conteneur (le premier ancêtre positionné) et ceux qui le contiennent — pas les ancêtres d'entre les deux
    for (const [tag, boiteZone, titre] of [['mjs-ol-fixe', 'a', 'une balise `fixed` dans une zone qui rogne'], ['mjs-ol-absolu', 'a', 'une balise `absolute` (la zone qui rogne, sans position, ne la contient pas)'], ['mjs-ol-parent-absolu', 'o', 'une balise dans un parent `absolute` qui échappe à la zone qui rogne'], ['mjs-ol-conteneur', 'a', 'une balise `fixed` sous un conteneur de requêtes (container-type) qui rogne et ne la retient pas']]) {
      it(`${titre} : la zone ne l'atteint pas — la lampe s'allume dans la fenêtre, à côté de la balise, hors de la zone`, async function () {
        if (!present) { this.skip(); return }
        await essai(tag, 't', async (page, erreurs) => {
          const zone   = await rect(page, tag, boiteZone)
          const balise = await rect(page, tag, 't')
          const base   = await pointeur(page, LOIN[0], LOIN[1])
          // à 60 px à droite de la balise : à moins de la portée (200), hors de la zone qui rogne
          const ax = balise.x + balise.w + 60
          const ay = balise.y + balise.h / 2
          assert.ok(ax > zone.x + zone.w, `le point est hors de la zone : ${JSON.stringify([zone, balise])}`)
          const proche = await un(page, await pointeur(page, ax, ay), ax, ay)
          assert.ok(blanc(proche), `à 60 px de la balise, hors de la zone qui rogne sans la contenir : la lampe n'est pas allumée (${JSON.stringify(proche)})`)
          // à 210 px, à gauche (dans la zone, plus loin que la portée) : éteinte
          const lx   = balise.x - 210
          const loin = await un(page, await pointeur(page, lx, ay), lx, ay)
          assert.ok(egal(loin, await un(page, base, lx, ay)), `à 210 px de la balise : la lampe brille (${JSON.stringify(loin)})`)
          assert.deepEqual(erreurs, [])
        })
      })
    }

    it('une balise `absolute` : son bloc conteneur est sous la zone qui la contient et au-dessus d\'une zone qui rogne sans la contenir — sa zone est la première (halo rogné à son bord), pas la seconde', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-chaine', 't', async (page, erreurs) => {
        const zone   = await rect(page, 'mjs-ol-chaine', 'o')
        const balise = await rect(page, 'mjs-ol-chaine', 't')
        const petite = await rect(page, 'mjs-ol-chaine', 'm')
        const base   = await pointeur(page, LOIN[0], LOIN[1])
        // à 40 px à droite de la balise : dans la zone qui la contient, hors de la boîte qui rogne sans la contenir
        const ax = balise.x + balise.w + 40
        const ay = balise.y + balise.h / 2
        assert.ok(ax > petite.x + petite.w && ax < zone.x + zone.w, `le point est dans la zone, hors de la petite boîte : ${JSON.stringify([zone, petite, balise])}`)
        const allume = await pointeur(page, ax, ay)
        const p      = await un(page, allume, ax, ay)
        assert.ok(blanc(p), `dans la zone qui contient la balise : la lampe n'est pas allumée (${JSON.stringify(p)})`)
        const ecart = await dehors(page, base, allume, zone)
        assert.equal(ecart.n, 0, `le halo sort de la zone : ${ecart.n} pixels changés dehors (écart ${ecart.max}, boîte ${JSON.stringify(ecart.boite)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    it('une balise dans une fenêtre de dialogue `fixed` qui rogne : la fenêtre la contient, c\'est sa zone — éteinte dans la boîte voisine, allumée dedans, halo rogné au bord de la fenêtre', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-modale', 't', async (page, erreurs) => {
        const zone    = await rect(page, 'mjs-ol-modale', 'a')
        const balise  = await rect(page, 'mjs-ol-modale', 't')
        const base    = await pointeur(page, LOIN[0], LOIN[1])
        const vx      = balise.x + balise.w + 100
        const vy      = balise.y + balise.h / 2
        const voisine = await pointeur(page, vx, vy)
        assert.ok(egal(await un(page, voisine, vx, vy), await un(page, base, vx, vy)), `la lampe brille dans la boîte voisine : ${JSON.stringify(await un(page, voisine, vx, vy))}`)
        const ecartVoisine = await dehors(page, base, voisine, zone)
        assert.equal(ecartVoisine.n, 0, `pointeur dans la boîte voisine : ${ecartVoisine.n} pixels changés hors de la fenêtre (boîte ${JSON.stringify(ecartVoisine.boite)})`)
        const ix     = zone.x + zone.w - 10
        const iy     = balise.y + balise.h / 2
        const dedans = await pointeur(page, ix, iy)
        assert.ok(blanc(await un(page, dedans, ix, iy)), 'pointeur dans la fenêtre : la lampe n\'est pas allumée')
        const ecart = await dehors(page, base, dedans, zone)
        assert.equal(ecart.n, 0, `le halo sort de la fenêtre : ${ecart.n} pixels changés dehors (boîte ${JSON.stringify(ecart.boite)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    // un parent sans position qui retient la balise (transformation, filtre, confinement…) la contient : c'est sa zone, comme un parent positionné
    for (const [cle, titre] of [...RETENUES.map(([c, position, propriete, valeur]): [string, string] => [c, `une balise ${position} dans une zone sans position qui la retient (${propriete}: ${valeur}) et qui rogne`]), ['chaine', 'une balise dans un parent fixe, lui-même retenu par une zone transformée qui rogne (la retenue se poursuit de parent en parent)'] as [string, string]]) {
      it(`${titre} : la zone la contient, c'est sa zone — éteinte dans la boîte voisine, allumée dedans, halo rogné à son bord`, async function () {
        if (!present) { this.skip(); return }
        const tag = `mjs-ol-retenue-${cle}`
        await essai(tag, 't', async (page, erreurs) => {
          const zone    = await rect(page, tag, 'a')
          const balise  = await rect(page, tag, 't')
          const base    = await pointeur(page, LOIN[0], LOIN[1])
          const vx      = balise.x + balise.w + 100
          const vy      = balise.y + balise.h / 2
          assert.ok(vx > zone.x + zone.w, `le point est dans la boîte voisine, hors de la zone : ${JSON.stringify([zone, balise])}`)
          const voisine = await pointeur(page, vx, vy)
          assert.ok(egal(await un(page, voisine, vx, vy), await un(page, base, vx, vy)), `la lampe brille dans la boîte voisine : ${JSON.stringify(await un(page, voisine, vx, vy))}`)
          const ecartVoisine = await dehors(page, base, voisine, zone)
          assert.equal(ecartVoisine.n, 0, `pointeur dans la boîte voisine : ${ecartVoisine.n} pixels changés hors de la zone (boîte ${JSON.stringify(ecartVoisine.boite)})`)
          const ix     = zone.x + zone.w - 10
          const iy     = balise.y + balise.h / 2
          const dedans = await pointeur(page, ix, iy)
          assert.ok(blanc(await un(page, dedans, ix, iy)), 'pointeur dans la zone : la lampe n\'est pas allumée')
          const ecart = await dehors(page, base, dedans, zone)
          assert.equal(ecart.n, 0, `le halo sort de la zone : ${ecart.n} pixels changés dehors (boîte ${JSON.stringify(ecart.boite)})`)
          assert.deepEqual(erreurs, [])
        })
      })
    }

    it('une balise sous un parent sans boîte (display: contents) qui rogne : il ne rogne rien — sa zone est la boîte qui le contient, la lampe s\'allume dedans, halo rogné à son bord', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-sans-boite', 't', async (page, erreurs) => {
        const zone   = await rect(page, 'mjs-ol-sans-boite', 'a')
        const balise = await rect(page, 'mjs-ol-sans-boite', 't')
        const base   = await pointeur(page, LOIN[0], LOIN[1])
        // dans la zone, à 60 px sous la balise : à moins de la portée de l'ombre (200)
        const ix = zone.x + 200
        const iy = balise.y + balise.h + 60
        assert.ok(iy < zone.y + zone.h, `le point est dans la zone : ${JSON.stringify([zone, balise])}`)
        const allume = await pointeur(page, ix, iy)
        const p      = await un(page, allume, ix, iy)
        assert.ok(blanc(p), `dans la zone : la lampe n'est pas allumée (${JSON.stringify(p)}) — le parent sans boîte a été pris pour la zone`)
        const ecart = await dehors(page, base, allume, zone)
        assert.equal(ecart.n, 0, `le halo sort de la zone : ${ecart.n} pixels changés dehors (écart ${ecart.max}, boîte ${JSON.stringify(ecart.boite)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    it('une zone qui défile : la lampe suit le pointeur dans la zone, rognée à son bord ; la page qui défile sous un pointeur immobile déplace la zone, et la lampe avec elle', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-defile', 't', async (page, erreurs) => {
        await page.evaluate(() => { ((document.querySelector('mjs-ol-defile') as any)._shadow.querySelector('.z') as any).scrollTop = 80 })
        await page.waitForTimeout(200)
        const zone   = await rect(page, 'mjs-ol-defile', 'z')
        const balise = await rect(page, 'mjs-ol-defile', 't')
        // la balise a glissé de 80 px dans la zone
        assert.equal(Math.round(balise.y - zone.y), 70, `la balise n'a pas glissé de 80 px : ${JSON.stringify([zone, balise])}`)
        const base = await pointeur(page, LOIN[0], LOIN[1])
        const x1 = zone.x + zone.w - 30
        const y1 = balise.y + balise.h / 2
        const premier = await pointeur(page, x1, y1)
        const p1 = await un(page, premier, x1, y1)
        assert.ok(blanc(p1), `zone défilée de 80 px : la lampe n'est pas allumée (${JSON.stringify(p1)})`)
        const ecart1 = await dehors(page, base, premier, zone)
        assert.equal(ecart1.n, 0, `zone défilée : le halo sort de la zone (${ecart1.n} pixels, boîte ${JSON.stringify(ecart1.boite)})`)
        // la lampe suit le pointeur : un autre endroit de la zone, l'ancien est éteint
        const x2 = balise.x + 20
        const y2 = balise.y + balise.h + 40
        const second = await pointeur(page, x2, y2)
        const p2 = await un(page, second, x2, y2)
        const ancien = await un(page, second, x1, y1)
        assert.ok(blanc(p2), `la lampe n'a pas suivi le pointeur (${JSON.stringify(p2)})`)
        assert.ok(Math.min(...ancien) < 200, `la lampe est restée à l'ancien endroit (${JSON.stringify(ancien)})`)
        // le pointeur au bas de la zone, puis la page défile de 80 px sans qu'il bouge : la zone monte, le pointeur est sous elle
        const x3 = zone.x + zone.w - 30
        const y3 = zone.y + zone.h - 20
        const p3 = await un(page, await pointeur(page, x3, y3), x3, y3)
        assert.ok(blanc(p3), `au bas de la zone : la lampe n'est pas allumée (${JSON.stringify(p3)})`)
        await page.evaluate(() => window.scrollTo(0, 80))
        await page.waitForTimeout(400)
        const zone2 = await rect(page, 'mjs-ol-defile', 'z')
        assert.equal(Math.round(zone.y - zone2.y), 80, `la page n'a pas défilé de 80 px : ${JSON.stringify([zone, zone2])}`)
        const defile = await page.screenshot()
        const sous = await un(page, defile, x3, y3)
        const base2 = await pointeur(page, LOIN[0], LOIN[1])
        assert.ok(egal(sous, await un(page, base2, x3, y3)), `la page a défilé : la lampe reste allumée sous la zone (${JSON.stringify(sous)})`)
        const ecart2 = await dehors(page, base2, defile, zone2)
        assert.equal(ecart2.n, 0, `la page a défilé : le halo reste là où était la zone (${ecart2.n} pixels hors de la zone, boîte ${JSON.stringify(ecart2.boite)})`)
        // le pointeur sous la zone, la page revient : la zone remonte sous lui, la lampe se rallume sans qu'il bouge
        await page.mouse.move(x3, y3)
        await page.waitForTimeout(300)
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForTimeout(400)
        const p4 = await un(page, await page.screenshot(), x3, y3)
        assert.ok(blanc(p4), `la page est revenue : la lampe ne s'est pas rallumée (${JSON.stringify(p4)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    it('balise hors de l\'écran : ni le pointeur ni le défilement ne font écrire quoi que ce soit (ni la balise, ni la fenêtre, ni la lampe) ; revenue à l\'écran, ça repart', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-defile', 't', async (page, erreurs) => {
        const balise = await rect(page, 'mjs-ol-defile', 't')
        await pointeur(page, balise.x + balise.w + 40, balise.y + balise.h / 2)
        await page.evaluate(() => window.scrollTo(0, 700))
        await page.waitForTimeout(500)
        await page.evaluate(() => {
          const w = window as any
          const sh = (document.querySelector('mjs-ol-defile') as any)._shadow
          w.__ecritures = 0
          w.__mo = new MutationObserver((m) => { w.__ecritures += m.length })
          for (const n of [sh.querySelector('.t'), document.querySelector('[mjs-fx-longshadow-window]'), document.querySelector('[mjs-fx-longshadow-light]')]) w.__mo.observe(n, { attributes: true })
        })
        for (let i = 0; i < 12; i++) await page.mouse.move(100 + i * 30, 80 + i * 10)
        for (let i = 0; i < 3; i++) {
          await page.evaluate((k: number) => window.scrollBy(0, k), 5 + i)
          await page.waitForTimeout(60)
        }
        await page.waitForTimeout(300)
        const hors = await page.evaluate(() => { const w = window as any; w.__mo.takeRecords(); return w.__ecritures })
        assert.equal(hors, 0, 'hors de l\'écran : des écritures de style')
        // revenue à l'écran : le pointeur près d'elle, ailleurs qu'avant, l'ombre est repeinte
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForTimeout(500)
        const retour = await rect(page, 'mjs-ol-defile', 't')
        await page.mouse.move(retour.x + 20, retour.y - 20)
        await page.waitForTimeout(400)
        const dedans = await page.evaluate(() => { const w = window as any; w.__mo.takeRecords(); return w.__ecritures })
        assert.ok(dedans > 0, 'à l\'écran : rien ne s\'écrit, le repère de ce test ne voit rien')
        assert.deepEqual(erreurs, [])
      })
    })

    it('une zone qui défile dans son shadow root amène la balise sous un pointeur immobile : la lampe s\'allume (le défilement d\'un shadow root ne sort pas de lui)', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-glisse', 't', async (page, erreurs) => {
        const zone = await rect(page, 'mjs-ol-glisse', 'z')
        const base = await pointeur(page, LOIN[0], LOIN[1])
        // dans la zone, en haut : la balise (tout en bas de la zone) est à plus de 60 px
        const x = zone.x + 80
        const y = zone.y + 10
        const loin = await un(page, await pointeur(page, x, y), x, y)
        const sansPointeur = await un(page, base, x, y)
        assert.ok(egal(loin, sansPointeur), `la balise est trop loin, la lampe brille (${JSON.stringify(loin)} au lieu de ${JSON.stringify(sansPointeur)})`)
        // la zone défile de 100 px, le pointeur ne bouge pas : la balise arrive à moins de 60 px
        await page.evaluate(() => { ((document.querySelector('mjs-ol-glisse') as any)._shadow.querySelector('.z') as any).scrollTop = 100 })
        await page.waitForTimeout(500)
        const balise = await rect(page, 'mjs-ol-glisse', 't')
        assert.ok(Math.abs(balise.y - (zone.y + 50)) < 2, `la zone n'a pas défilé de 100 px : ${JSON.stringify([zone, balise])}`)
        const apres = await un(page, await page.screenshot(), x, y)
        assert.ok(blanc(apres), `la zone a défilé sous le pointeur : la lampe ne s'est pas allumée (${JSON.stringify(apres)})`)
        assert.deepEqual(erreurs, [])
      })
    })

    it('« réduire les animations » : pas de lampe, pas de fenêtre', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-voisine', 't', async (page) => {
        const balise = await rect(page, 'mjs-ol-voisine', 't')
        await pointeur(page, balise.x + balise.w + 20, balise.y + balise.h / 2)
        const n = await page.evaluate(() => document.querySelectorAll('[mjs-fx-longshadow-light],[mjs-fx-longshadow-window]').length)
        assert.equal(n, 0)
      }, { reduire: true })
    })

    it('le retrait par un bloc ne laisse rien : ni lampe, ni fenêtre, ni écouteur de défilement ; la pose en a posé', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-retrait', 'b', async (page, erreurs) => {
        const etat = () => page.evaluate(() => ({ lampes: document.querySelectorAll('[mjs-fx-longshadow-light]').length, fenetres: document.querySelectorAll('[mjs-fx-longshadow-window]').length, defile: (window as any).__scroll() }))
        const clic = () => page.evaluate(() => (document.querySelector('mjs-ol-retrait') as any)._shadow.querySelector('.b').click())
        const avant = await etat()
        assert.deepEqual([avant.lampes, avant.fenetres], [0, 0], 'avant la pose')
        await clic()
        await page.waitForFunction(() => !!(document.querySelector('mjs-ol-retrait') as any)._shadow.querySelector('.t'))
        await page.waitForTimeout(200)
        const pose = await etat()
        assert.deepEqual([pose.lampes, pose.fenetres], [1, 1], 'après la pose : une lampe dans une fenêtre')
        assert.ok(pose.defile > avant.defile, `la pose n'a posé aucun écouteur de défilement (${avant.defile} avant, ${pose.defile} après)`)
        await clic()
        await page.waitForFunction(() => !(document.querySelector('mjs-ol-retrait') as any)._shadow.querySelector('.t'))
        await page.waitForTimeout(200)
        const apres = await etat()
        assert.deepEqual([apres.lampes, apres.fenetres], [0, 0], 'après le retrait : la lampe ou sa fenêtre reste')
        assert.equal(apres.defile, avant.defile, `après le retrait : ${apres.defile - avant.defile} écouteur(s) de défilement restent`)
        assert.deepEqual(erreurs, [])
      }, { espion: true })
    })

    it('l\'effet retiré par le moteur, une image d\'animation en attente : elle est annulée, et ni le pointeur ni le défilement ne refont rien', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-retrait', 'b', async (page, erreurs) => {
        await page.evaluate(() => (document.querySelector('mjs-ol-retrait') as any)._shadow.querySelector('.b').click())
        await page.waitForFunction(() => !!(document.querySelector('mjs-ol-retrait') as any)._shadow.querySelector('.t'))
        await page.waitForTimeout(200)
        const r = await page.evaluate(() => {
          const w = window as any
          const el = (document.querySelector('mjs-ol-retrait') as any)._shadow.querySelector('.t')
          const avant = new Set(w.__raf())
          document.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 60 }))
          const miennes = w.__raf().filter((id: number) => !avant.has(id))
          w.µ._mjs_fxClear(el)
          const restantes = w.__raf().filter((id: number) => miennes.includes(id))
          const lampes = document.querySelectorAll('[mjs-fx-longshadow-light],[mjs-fx-longshadow-window]').length
          return { demandees: miennes.length, restantes: restantes.length, lampes, defile: w.__scroll() }
        })
        assert.equal(r.demandees, 1, 'le pointeur demande une image d\'animation')
        assert.equal(r.restantes, 0, 'l\'image d\'animation en attente n\'est pas annulée')
        assert.equal(r.lampes, 0, 'lampe ou fenêtre restée')
        const apres = await page.evaluate(async () => {
          const w = window as any
          const avant = new Set(w.__raf())
          document.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 70 }))
          document.dispatchEvent(new Event('scroll'))
          window.scrollTo(0, 40)
          await new Promise((ok) => setTimeout(ok, 150))
          return { neuves: w.__raf().filter((id: number) => !avant.has(id)).length, lampes: document.querySelectorAll('[mjs-fx-longshadow-light],[mjs-fx-longshadow-window]').length, defile: w.__scroll() }
        })
        assert.equal(apres.lampes, 0, 'une lampe est revenue après le retrait')
        assert.equal(apres.neuves, 0, 'une image d\'animation demandée après le retrait')
        assert.equal(r.defile, apres.defile, 'un écouteur de défilement posé après le retrait')
        assert.deepEqual(erreurs, [])
      }, { espion: true })
    })

    it('currentColor lue dans la balise : un composant sans <slot> (rouge), avec <slot> (la boîte bleue du slot), une balise au shadow root fermé hors de portée, une balise ordinaire', async function () {
      if (!present) { this.skip(); return }
      await essai('mjs-ol-couleur', 's', async (page, erreurs) => {
        const ombre = (classe: string): Promise<string> => page.evaluate((c: string) => (document.querySelector('mjs-ol-couleur') as any)._shadow.querySelector('.' + c).style.getPropertyValue('--mjs-fx-longshadow'), classe)
        const [sans, avec, ferme, ordinaire] = [await ombre('s'), await ombre('a'), await ombre('f'), await ombre('r')]
        const premiere = (v: string) => v.split(/,(?![^(]*\))/)[0]
        const noir = /rgba?\(0,\s*0,\s*0\b/
        // sans <slot> : le rouge de la balise (ou `color-mix` sur currentColor, qui se résout en rouge), jamais le noir par défaut
        assert.ok(!noir.test(sans), `composant sans <slot> : ombre noire — ${premiere(sans)}`)
        assert.ok(/rgba\(255,\s*0,\s*0,/.test(sans) || /color-mix\([^)]*currentColor/i.test(sans), `composant sans <slot> : ni rouge ni currentColor — ${premiere(sans)}`)
        // avec <slot> : le texte projeté est dans la boîte bleue, c'est sa couleur
        assert.match(premiere(avec), /rgba\(0,\s*0,\s*255,/, `composant avec <slot> : la couleur du texte projeté (bleu) — ${premiere(avec)}`)
        // un shadow root fermé hors de portée : la couleur reste à CSS, sur currentColor
        assert.ok(!noir.test(ferme), `balise au shadow root fermé : ombre noire — ${premiere(ferme)}`)
        assert.match(premiere(ferme), /color-mix\([^)]*currentColor/i, `balise au shadow root fermé : currentColor attendu — ${premiere(ferme)}`)
        // une balise ordinaire : le rouge lu
        assert.match(premiere(ordinaire), /rgba\(255,\s*0,\s*0,/, `balise ordinaire : ${premiere(ordinaire)}`)
        // la transparence d'une couleur écrite est gardée
        const alpha = await ombre('al')
        assert.match(premiere(alpha), /rgba\(0,\s*0,\s*255,\s*0?\.20*\)/, `#0000ff33 : la transparence gardée (0.2) — ${premiere(alpha)}`)
        assert.deepEqual(erreurs, [])
      }, { entete: ENTETE_FERME })
    })
  })
}
