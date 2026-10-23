// *follow et *cursors dans Chromium et Firefox réels (la mise en page est vraie) :
//   - *follow chez qui suit, avec la douceur par défaut : le public arrive sur la cible, et
//     requestAnimationFrame s'arrête au repos ; sous `scroll-behavior: smooth` (page ou zone), chaque pas est
//     instantané ; une cible hors d'atteinte n'empêche pas de suivre la suivante, et l'arrêt se mesure sur
//     une horloge qui ne recule jamais ; la route qui change en plein suivi abandonne la cible en cours ;
//   - le calque des curseurs est rogné à la boîte visible de la zone : la barre de défilement de la
//     page ne la décale pas (le calque mesure la fenêtre sans elle), et une zone posée dans une zone qui
//     découpe est rognée à leur intersection — celle des parents qui la contiennent vraiment (une zone fixe
//     n'est découpée par aucun, une zone absolue par son bloc conteneur et ceux qui le contiennent, un
//     parent absolu échappe à ce qui ne le contient pas, un parent sans boîte ne découpe rien) ; un parent
//     sans position mais qui retient les zones fixes et absolues (transformation, filtre, perspective,
//     confinement de la mise en page ou du dessin, `will-change` de ces propriétés) les contient, donc les
//     découpe — la règle du moteur des effets, sauf le conteneur de requêtes (`container-type`), que Chromium et
//     Firefox ne traitent pas comme un bloc englobant : une zone fixe sous lui reste à la fenêtre, il ne la découpe pas ;
//   - l'anneau de la balise active d'un autre visiteur EXISTE (le test échoue sans lui), puis, la zone
//     défilée, il est hors de sa boîte visible — découpé, pas visible.
// Le calque est lu par sa géométrie : le bord de la découpe, en coordonnées de la fenêtre.

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
  }
  catch {
    return false
  }
}

const PARTIES = '{for n in [1..12]}<section class="s"><button class="b">Partie {n}</button></section>{end}'

const SOURCES: Record<string, string> = {
  // qui suit, la page entière : un en-tête de 100 px, puis la cible
  'fx-cb-page.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<@document *follow></@document>\n',
  // qui suit, une zone qui défile
  'fx-cb-zone.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow>' + PARTIES + '</div>\n<style>\n.z\n  height: 240px\n  overflow: auto\n.s\n  height: 160px\n  margin: 0 0 12px\n</style>\n',
  // les curseurs d\'une zone qui défile, dans une page qui défile aussi (la barre de défilement de la page)
  'fx-cb-barre.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div>\n<div class="long"></div>\n<style>\n.z\n  width: 300px\n  height: 200px\n  overflow: auto\n  margin: 0 0 0 20px\n.s\n  height: 60px\n.long\n  height: 3000px\n</style>\n',
  // une zone qui défile dans une zone qui découpe
  'fx-cb-double.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="outer"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div>\n<style>\n.outer\n  overflow: hidden\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n.z\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  // une zone qui défile, posée hors du flux dans une zone qui découpe : fixe (à la fenêtre), absolue sans parent positionné (à la page)
  'fx-cb-fixe.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="outer"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div>\n<style>\n.outer\n  overflow: hidden\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n.z\n  position: fixed\n  top: 200px\n  left: 400px\n  width: 300px\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  'fx-cb-abs.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="outer"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div>\n<style>\n.outer\n  overflow: hidden\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n.z\n  position: absolute\n  top: 200px\n  left: 400px\n  width: 300px\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  // une zone absolue dans un parent positionné qui découpe : il la contient, il la découpe
  'fx-cb-abs-pos.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="outer"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div>\n<style>\n.outer\n  position: relative\n  overflow: hidden\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n.z\n  position: absolute\n  top: 0\n  left: 0\n  width: 300px\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  // une zone absolue : son bloc conteneur (.cb) est sous une zone qui découpe (.o, qui la contient) et au-dessus d\'une autre (.m, qui ne la contient pas)
  'fx-cb-abs-chaine.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="o"><div class="cb"><div class="m"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div></div></div>\n<style>\n.o\n  position: absolute\n  left: 20px\n  top: 20px\n  width: 300px\n  height: 200px\n  overflow: hidden\n.cb\n  position: relative\n  width: 300px\n  height: 200px\n.m\n  width: 300px\n  height: 40px\n  overflow: hidden\n.z\n  position: absolute\n  top: 0\n  left: 0\n  width: 300px\n  height: 400px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  // une zone sans position dans un parent absolu, lui-même dans une zone qui découpe sans le contenir : le parent absolu échappe à la zone qui découpe, la zone aussi
  'fx-cb-parent-abs.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="outer"><div class="a"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div></div>\n<style>\n.outer\n  overflow: hidden\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n.a\n  position: absolute\n  top: 200px\n  left: 400px\n  width: 300px\n  height: 300px\n.z\n  width: 300px\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  // une zone dans un parent fixe qui découpe (une fenêtre de dialogue) : il la contient, il la découpe
  'fx-cb-modale.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="d"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div>\n<style>\n.d\n  position: fixed\n  top: 200px\n  left: 400px\n  width: 300px\n  height: 100px\n  overflow: hidden\n.z\n  width: 300px\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  // une zone sous un parent sans boîte (display: contents) : il ne découpe rien
  'fx-cb-contenu.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="outer"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div>\n<style>\n.outer\n  display: contents\n  overflow: hidden\n.z\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n  overflow: auto\n.s\n  height: 60px\n</style>\n',
  // qui suit : une zone qui défile, longue (4 000 px)
  'fx-cb-zone-longue.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow>{for n in [1..40]}<section class="s"><button class="b">Partie {n}</button></section>{end}</div>\n<style>\n.z\n  height: 240px\n  overflow: auto\n.s\n  height: 100px\n</style>\n',
}

// un parent sans position mais qui retient les zones fixes et absolues, et découpe : il contient la zone, il la découpe (une zone fixe ou absolue de 300 × 300 dans un parent de 300 × 100)
const RETIENT: Record<string, string> = {
  'transform':       'transform: translateX(0)',
  'filter':          'filter: opacity(1)',
  'perspective':     'perspective: 500px',
  'backdrop-filter': 'backdrop-filter: blur(1px)',
  'contain-layout':  'contain: layout',
  'contain-paint':   'contain: paint',
  'will-change':     'will-change: transform'
}

const retenue = (declaration: string, position: string) => `<script>\n@sock = µsocket 'wss://x.fr/ws'\n</script>\n<div class="outer"><div class="z" *cursors(cursor: none, selection: false)>${PARTIES}</div></div>\n<style>\n.outer\n  ${declaration}\n  overflow: hidden\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n.z\n  position: ${position}\n  top: 0\n  left: 0\n  width: 300px\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n`

// la zone fixe sous chacun des parents qui retiennent ; la zone absolue sous deux d'entre eux (la règle est la même)
const RETENUES: Array<[string, string, string]> = [
  ...Object.keys(RETIENT).map((cle): [string, string, string] => [cle, 'fixed', 'fixe']),
  ['transform', 'absolute', 'abs'],
  ['filter', 'absolute', 'abs']
]

for (const [cle, position, court] of RETENUES) SOURCES[`fx-cb-retenue-${cle}-${court}.mjs`] = retenue(RETIENT[cle], position)

// une zone sans position dans un parent fixe (.d), lui-même retenu par un parent qui découpe (.t, transformé) : la retenue se poursuit de parent en parent
SOURCES['fx-cb-retenue-chaine.mjs'] = '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="t"><div class="d"><div class="z" *cursors(cursor: none, selection: false)>' + PARTIES + '</div></div></div>\n<style>\n.t\n  transform: translateX(0)\n  overflow: hidden\n  width: 300px\n  height: 100px\n  margin: 20px 0 0 20px\n.d\n  position: fixed\n  top: 0\n  left: 0\n  width: 300px\n.z\n  height: 300px\n  overflow: auto\n.s\n  height: 60px\n</style>\n'

// un conteneur de requêtes qui découpe, sans position : il ne retient pas la zone fixe (elle reste à la fenêtre)
SOURCES['fx-cb-conteneur.mjs'] = retenue('container-type: inline-size', 'fixed')

// une page de 1 100 px dans une fenêtre de 600 : elle ne défile que jusqu'à 500 px — B (à 200 px) est atteignable, F (à 1 000 px) hors d'atteinte
const PAGE_COURTE = '<div style="height:200px"></div><div style="height:100px">B</div><div style="height:700px"></div><div style="height:100px">F</div>'

// la connexion simulée, posée dans la page avant les composants : ce que l'effet envoie, ce qu'il reçoit
const STUB = `(() => {
  window.__raf = 0
  const o = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (f) => { window.__raf++; return o(f) }
  const ec = {}
  const s  = {
    _mjs_refs: 1,
    send() {},
    on(type, f) { (ec[type] = ec[type] || []).push(f); return () => {} },
    room() { return { presence: () => ({ '7': true }), leave() {} } },
    destroy() {}, request() { return Promise.resolve(null) }, release() {},
    recoit(type, p) { (ec[type] = ec[type] || []).forEach((f) => f(p)) }
  }
  window.__s = s
  µ.socket = () => s
  µ._mjs_sockets = { 'wss://x.fr/ws': s }
  // le chemin d'une balise depuis une zone : les rangs des enfants, -1 pour entrer dans un composant
  window.__pathOf = (n, zone) => { const out = []; for (let i = 0; n && n !== zone && i < 64; i++) { const p = n.parentNode; if (!p) return null; out.push(Array.prototype.indexOf.call(p.childNodes, n)); if (p.nodeType === 11) { out.push(-1); n = p.host } else n = p } return n === zone ? out.reverse() : null }
  // la découpe du calque : ses quatre bords, en coordonnées de la fenêtre, et le calque lui-même
  window.__decoupe = () => {
    const l = document.querySelector('[mjs-fx-cursors-layer]')
    if (!l) return null
    const lb = l.getBoundingClientRect()
    const m  = /inset\\(([^)]*)\\)/.exec(getComputedStyle(l).clipPath)
    if (!m) return { sans: true }
    const v            = m[1].split(/[\\s,]+/).filter(Boolean).map(parseFloat)
    const [t, r, b, g] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]]
    return { haut: lb.top + t, droite: lb.right - r, bas: lb.bottom - b, gauche: lb.left + g, largeur: lb.width, texte: getComputedStyle(l).clipPath }
  }
})()`

describe('*follow, *cursors — navigateurs réels', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('curseurs-navigateur-browser')
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

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test des curseurs sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const lanceur = (await import('playwright'))[nom]
        // Chromium cache ses barres de défilement par défaut : on les veut classiques
        browser = await lanceur.launch(nom === 'chromium' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {})
      })

      after(async () => { await browser?.close() })

      // la page : le corps (hors composant), la connexion simulée, puis le composant
      async function ouvre(tag: string, corps = '', sel = '.z') {
        const page              = await browser.newPage({ viewport: { width: 900, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${corps}<script>${script}</script></body></html>`, { waitUntil: 'load' })
        await page.evaluate(STUB)
        await page.evaluate((t: string) => { document.body.appendChild(document.createElement(t)) }, tag)
        if (sel) await page.waitForFunction(([t, s]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector(s), [tag, sel])
        await page.waitForTimeout(150)
        return { page, erreurs }
      }

      // le curseur d'un autre visiteur : sa balise active (le bouton n° `n` de la zone)
      const focus = (page: any, tag: string, n: number, type: string) => page.evaluate(([t, k, ty]: [string, number, string]) => {
        const sh: any = (document.querySelector(t) as any)._shadow
        const z: any  = sh.querySelector('.z')
        const b: any  = z.querySelectorAll('.b')[k]
        ;(window as any).__s.recoit(ty, { room: (window as any).µ._mjs_fxRoomName({}), p: null, t: null, f: (window as any).__pathOf(b, z), c: 0, from: { id: '7', name: 'Prof' } })
      }, [tag, n, type])

      // l'anneau de la balise active d'un autre visiteur (le bouton n° `n` de la zone), une fois dessiné : sa boîte, la découpe du calque, ce qui reste visible
      // de l'anneau (l'aire de leur intersection ; tout l'anneau si le calque n'est pas découpé), la boîte de la zone et celle d'un parent (`.parent`, s'il est donné)
      async function anneau(page: any, tag: string, n: number, parent = '') {
        await focus(page, tag, n, 'cursors:move')
        await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))))
        return page.evaluate(([t, p]: string[]) => {
          const sh: any = (document.querySelector(t) as any)._shadow
          const boite   = (r: DOMRect) => ({ haut: r.top, bas: r.bottom, gauche: r.left, droite: r.right })
          const f: any  = document.querySelector('[mjs-fx-cursor-focus]')
          const q       = f ? f.getBoundingClientRect() : null
          const d       = (window as any).__decoupe()
          let aire      = 0
          if (q) {
            aire = q.width * q.height
            if (d && !d.sans) aire = Math.max(0, Math.min(q.right, d.droite) - Math.max(q.left, d.gauche)) * Math.max(0, Math.min(q.bottom, d.bas) - Math.max(q.top, d.haut))
          }
          return { zone: boite(sh.querySelector('.z').getBoundingClientRect()), parent: p ? boite(sh.querySelector(p).getBoundingClientRect()) : null, anneau: q && boite(q), d, aire: Math.round(aire) }
        }, [tag, parent])
      }
      const egale = (d: any, b: any) => !!d && !d.sans && Math.abs(d.haut - b.haut) <= 1 && Math.abs(d.bas - b.bas) <= 1 && Math.abs(d.gauche - b.gauche) <= 1 && Math.abs(d.droite - b.droite) <= 1

      it('*follow, la douceur par défaut : le public arrive sur la cible (pas à quelques pixels) et requestAnimationFrame s\'arrête au repos', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-page', '<div style="height:100px"></div><div style="height:100px">cible</div><div style="height:3000px"></div>', '')
        await page.waitForTimeout(300)
        await page.evaluate("__s.recoit('follow:at', { room: µ._mjs_fxRoomName({}), a: [1], y: 0, from: { id: '7', name: 'Prof' } })")
        await page.waitForFunction(() => Math.abs(window.scrollY - 100) < 0.5, null, { timeout: 15000 }).catch(() => {})
        const arrive = await page.evaluate(() => window.scrollY)
        assert.ok(Math.abs(arrive - 100) < 0.5, `scrollY final ${arrive}, la cible est à 100`)
        await page.waitForTimeout(300)
        await page.evaluate(() => { (window as any).__raf = 0 })
        await page.waitForTimeout(700)
        const rafs = await page.evaluate(() => (window as any).__raf)
        assert.equal(rafs, 0, `requestAnimationFrame au repos : ${rafs} appels en 0,7 s`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // le défilement lissé du navigateur (scroll-behavior: smooth, souvent posé sur <html>) relance son animation à chaque pas du public : chaque pas
      // doit être instantané. Sans cela, 5 000 px prennent de 9 à plus de 20 s selon le navigateur ; instantané, quelques secondes au plus. Le test
      // compte des IMAGES, pas des secondes (la charge de la machine ne change pas leur nombre) : après quatre images, les pas instantanés ont fait plus du
      // tiers du chemin ; un défilement lissé, quelques pixels. L'échéance de 15 s pour l'arrivée est un filet large, pas la mesure
      it('*follow, la page défile en douceur (scroll-behavior: smooth) : le public franchit 5 000 px en quelques secondes — chaque pas est instantané', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-page', '<div style="height:100px"></div><div style="height:5000px"></div><div style="height:100px">cible</div><div style="height:3000px"></div>', '')
        await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'smooth' })
        await page.waitForTimeout(300)
        const depart = Date.now()
        await page.evaluate("__s.recoit('follow:at', { room: µ._mjs_fxRoomName({}), a: [2], y: 0, from: { id: '7', name: 'Prof' } })")
        const quatre = await page.evaluate(() => new Promise((ok) => { let n = 0; const f = () => (++n >= 4 ? ok(window.scrollY) : requestAnimationFrame(f)); requestAnimationFrame(f) }))
        assert.ok((quatre as number) > 1000, `après quatre images, scrollY ${quatre} : les pas ne sont pas instantanés (attendu plus de 1000 sur 5100)`)
        await page.waitForFunction(() => Math.abs(window.scrollY - 5100) < 0.5, null, { timeout: 15000 }).catch(() => {})
        const arrive = await page.evaluate(() => window.scrollY)
        assert.ok(Math.abs(arrive - 5100) < 0.5, `scrollY ${arrive} après ${Date.now() - depart} ms, la cible est à 5100`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*follow, une zone qui défile en douceur (scroll-behavior: smooth sur la zone) : le public franchit 3 600 px en quelques secondes — chaque pas est instantané', async function () {
        if (!present) { this.skip(); return }
        const tag               = 'mjs-fx-cb-zone-longue'
        const { page, erreurs } = await ouvre(tag)
        await page.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.z') as HTMLElement).style.scrollBehavior = 'smooth' }, tag)
        await page.waitForTimeout(300)
        const depart = Date.now()
        await page.evaluate((t: string) => {
          const z: any = (document.querySelector(t) as any)._shadow.querySelector('.z')
          const b: any = z.querySelectorAll('.s')[36]
          ;(window as any).__s.recoit('follow:at', { room: (window as any).µ._mjs_fxRoomName({}), a: (window as any).__pathOf(b, z), y: 0, from: { id: '7', name: 'Prof' } })
        }, tag)
        const quatre = await page.evaluate((t: string) => new Promise((ok) => { let n = 0; const f = () => (++n >= 4 ? ok(((document.querySelector(t) as any)._shadow.querySelector('.z') as HTMLElement).scrollTop) : requestAnimationFrame(f)); requestAnimationFrame(f) }), tag)
        assert.ok((quatre as number) > 800, `après quatre images, scrollTop ${quatre} : les pas ne sont pas instantanés (attendu plus de 800 sur 3600)`)
        await page.waitForFunction((t: string) => Math.abs(((document.querySelector(t) as any)._shadow.querySelector('.z') as HTMLElement).scrollTop - 3600) < 0.5, tag, { timeout: 15000 }).catch(() => {})
        const arrive = await page.evaluate((t: string) => ((document.querySelector(t) as any)._shadow.querySelector('.z') as HTMLElement).scrollTop, tag)
        assert.ok(Math.abs(arrive - 3600) < 0.5, `scrollTop ${arrive} après ${Date.now() - depart} ms, la cible est à 3600`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // la page de 1 100 px : F, hors d'atteinte, mène la page à son bout (500 px) puis l'effet s'arrête ; B est atteignable
      it('*follow, une cible hors d\'atteinte puis une cible atteignable : le public suit la seconde (la position vue à l\'image d\'avant est oubliée à chaque cible)', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-page', PAGE_COURTE, '')
        await page.waitForTimeout(300)
        await page.evaluate("__s.recoit('follow:at', { room: µ._mjs_fxRoomName({}), a: [3], y: 0, from: { id: '7', name: 'Prof' } })")
        await page.waitForTimeout(2500)
        const bout = await page.evaluate(() => window.scrollY)
        assert.ok(Math.abs(bout - 500) < 1, `la première cible est hors d'atteinte : la page va à son bout (500), elle est à ${bout}`)
        await page.evaluate("__s.recoit('follow:at', { room: µ._mjs_fxRoomName({}), a: [1], y: 0, from: { id: '7', name: 'Prof' } })")
        await page.waitForFunction(() => Math.abs(window.scrollY - 200) < 0.5, null, { timeout: 8000 }).catch(() => {})
        const arrive = await page.evaluate(() => window.scrollY)
        assert.ok(Math.abs(arrive - 200) < 0.5, `scrollY ${arrive} : la seconde cible (200) est ignorée`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*follow, une cible hors d\'atteinte : la position ne bouge plus depuis une demi-seconde, l\'animation s\'arrête — plus aucun appel de requestAnimationFrame au repos', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-page', PAGE_COURTE, '')
        await page.waitForTimeout(300)
        await page.evaluate("__s.recoit('follow:at', { room: µ._mjs_fxRoomName({}), a: [3], y: 0, from: { id: '7', name: 'Prof' } })")
        await page.waitForTimeout(3000)
        await page.evaluate(() => { (window as any).__raf = 0 })
        await page.waitForTimeout(1000)
        const rafs = await page.evaluate(() => (window as any).__raf)
        assert.equal(rafs, 0, `requestAnimationFrame au repos sur une cible hors d'atteinte : ${rafs} appels en 1 s`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*follow, l\'arrêt se mesure sur une horloge qui ne recule jamais : l\'heure murale remise en arrière ne fait pas tourner l\'animation sans fin', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-page', PAGE_COURTE, '')
        await page.waitForTimeout(300)
        // l'horloge murale recule d'une seconde à chaque lecture (une correction d'horloge) ; performance.now() n'y est pas soumise
        await page.evaluate(() => { let t = Date.now(); Date.now = () => (t -= 1000) })
        await page.evaluate("__s.recoit('follow:at', { room: µ._mjs_fxRoomName({}), a: [3], y: 0, from: { id: '7', name: 'Prof' } })")
        await page.waitForTimeout(3000)
        await page.evaluate(() => { (window as any).__raf = 0 })
        await page.waitForTimeout(1000)
        const rafs = await page.evaluate(() => (window as any).__raf)
        assert.equal(rafs, 0, `requestAnimationFrame au repos, l'heure murale reculant : ${rafs} appels en 1 s`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*follow, la route change en plein suivi (le salon de la page change) : la cible en cours est abandonnée — le public ne continue pas vers une position du salon d\'avant', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-page', '<div style="height:100px"></div><div style="height:5000px"></div><div style="height:100px">cible</div><div style="height:3000px"></div>', '')
        await page.waitForTimeout(300)
        await page.evaluate("__s.recoit('follow:at', { room: µ._mjs_fxRoomName({}), a: [2], y: 0, from: { id: '7', name: 'Prof' } })")
        await page.evaluate(() => new Promise((ok) => { let n = 0; const f = () => (++n >= 3 ? ok(null) : requestAnimationFrame(f)); requestAnimationFrame(f) }))
        const avant = await page.evaluate(() => window.scrollY)
        assert.ok(avant > 100 && avant < 4000, `le public glisse vers la cible (5100) : ${avant}`)
        await page.evaluate(() => { location.hash = '#/ailleurs' })
        await page.waitForTimeout(150)
        const quitte = await page.evaluate(() => window.scrollY)
        await page.waitForTimeout(800)
        const apres = await page.evaluate(() => window.scrollY)
        assert.ok(Math.abs(apres - quitte) < 1, `la page bouge encore après le changement de salon : ${quitte} puis ${apres} (la cible d'avant, 5100, est poursuivie)`)
        assert.ok(apres < 5000, `la page est arrivée à la cible d'avant : ${apres}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('le calque est rogné à la zone sans décalage quand la page a une barre de défilement : son bord droit tombe sur celui de la zone', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-barre')
        const barre             = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)
        if (barre === 0) { console.log(`    ℹ️  ${nom} : pas de barre de défilement classique ici (barres superposées) — mesure sautée`); await page.close(); this.skip(); return }
        await focus(page, 'mjs-fx-cb-barre', 1, 'cursors:move')
        await page.waitForFunction(() => !!document.querySelector('[mjs-fx-cursor-focus]'))
        const z = await page.evaluate(() => { const r = ((document.querySelector('mjs-fx-cb-barre') as any)._shadow.querySelector('.z') as HTMLElement).getBoundingClientRect(); return { haut: r.top, droite: r.right, bas: r.bottom, gauche: r.left } })
        const d = await page.evaluate(() => (window as any).__decoupe())
        assert.ok(d && !d.sans, 'le calque est découpé : ' + JSON.stringify(d))
        assert.ok(Math.abs(d.droite - z.droite) <= 1, `bord droit de la découpe ${d.droite}, celui de la zone ${z.droite} (barre de ${barre} px) — ${d.texte}`)
        assert.ok(Math.abs(d.gauche - z.gauche) <= 1 && Math.abs(d.haut - z.haut) <= 1 && Math.abs(d.bas - z.bas) <= 1, `les autres bords : ${JSON.stringify(d)} contre ${JSON.stringify(z)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('une zone qui défile dans une zone qui découpe : l\'anneau d\'une balise hors de la partie visible du parent est découpé — l\'anneau existe, il n\'est pas visible', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-double')
        await focus(page, 'mjs-fx-cb-double', 4, 'cursors:move')
        await page.waitForFunction(() => !!document.querySelector('[mjs-fx-cursor-focus]'), null, { timeout: 5000 }).catch(() => {})
        const mesure = await page.evaluate(() => {
          const sh: any = (document.querySelector('mjs-fx-cb-double') as any)._shadow
          const o       = sh.querySelector('.outer').getBoundingClientRect()
          const f: any  = document.querySelector('[mjs-fx-cursor-focus]')
          const q       = f ? f.getBoundingClientRect() : null
          return { parent: { haut: o.top, bas: o.bottom, gauche: o.left, droite: o.right }, anneau: q && { haut: q.top, bas: q.bottom }, d: (window as any).__decoupe() }
        })
        assert.ok(mesure.anneau, 'l\'anneau de la balise active existe : ' + JSON.stringify(mesure))
        assert.ok(mesure.d && !mesure.d.sans, 'le calque est découpé : ' + JSON.stringify(mesure.d))
        assert.ok(mesure.anneau.haut >= mesure.parent.bas, `le bouton est sous la partie visible du parent : ${JSON.stringify(mesure)}`)
        assert.ok(mesure.d.bas <= mesure.parent.bas + 1, `le bas de la découpe (${mesure.d.bas}) ne passe pas celui du parent (${mesure.parent.bas}) : ${mesure.d.texte}`)
        assert.ok(mesure.anneau.haut >= mesure.d.bas, `l'anneau est hors de la découpe : ${JSON.stringify(mesure)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // une zone posée hors du flux n'est découpée que par ce qui la contient vraiment : fixe, par aucun parent (sa boîte seule) ; absolue, par son bloc
      // conteneur (le premier parent positionné) et ceux qui le contiennent — pas par les parents d'entre les deux
      for (const [tag, titre] of [['mjs-fx-cb-fixe', 'fixe'], ['mjs-fx-cb-abs', 'absolue (aucun parent positionné)'], ['mjs-fx-cb-parent-abs', 'sans position dans un parent absolu (qui échappe à la zone qui découpe)']]) {
        it(`une zone ${titre} dans une zone qui découpe sans la contenir : le calque est rogné à la zone seule, l'anneau de sa balise active se voit`, async function () {
          if (!present) { this.skip(); return }
          const { page, erreurs } = await ouvre(tag)
          const m                 = await anneau(page, tag, 2, '.outer')
          assert.ok(m.anneau, 'l\'anneau de la balise active existe : ' + JSON.stringify(m))
          assert.ok(m.aire > 0, `l'anneau, dans la zone, est invisible (découpé par un parent qui ne la contient pas) : ${JSON.stringify(m)}`)
          assert.ok(egale(m.d, m.zone), `la découpe est la boîte de la zone : ${JSON.stringify(m)}`)
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }

      it('une zone absolue dans un parent positionné qui découpe : il la contient, il la découpe — l\'anneau d\'une balise hors de sa boîte est caché, celui d\'une balise dedans se voit', async function () {
        if (!present) { this.skip(); return }
        const tag               = 'mjs-fx-cb-abs-pos'
        const { page, erreurs } = await ouvre(tag)
        const dedans            = await anneau(page, tag, 0, '.outer')
        assert.ok(dedans.anneau && dedans.aire > 0, 'le bouton du haut est dans la partie visible : ' + JSON.stringify(dedans))
        const dehors = await anneau(page, tag, 4, '.outer')
        assert.ok(dehors.anneau, 'l\'anneau existe : ' + JSON.stringify(dehors))
        assert.ok(dehors.anneau.haut >= dehors.parent.bas, `le bouton est sous la partie visible du parent : ${JSON.stringify(dehors)}`)
        assert.equal(dehors.aire, 0, `l'anneau sort du parent : il est visible (${dehors.aire} px²) — ${JSON.stringify(dehors)}`)
        assert.ok(dehors.d && !dehors.d.sans && dehors.d.bas <= dehors.parent.bas + 1, `le bas de la découpe ne passe pas celui du parent : ${JSON.stringify(dehors)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('une zone absolue : son bloc conteneur est sous la zone qui la contient et au-dessus de celle qui ne la contient pas — la première la découpe, pas la seconde', async function () {
        if (!present) { this.skip(); return }
        const tag               = 'mjs-fx-cb-abs-chaine'
        const { page, erreurs } = await ouvre(tag)
        // le bouton n° 1 est sous la boîte de .m (40 px) et dans celle de .o (200 px) : visible
        const dedans = await anneau(page, tag, 1, '.o')
        assert.ok(dedans.anneau, 'l\'anneau existe : ' + JSON.stringify(dedans))
        assert.ok(dedans.aire > 0, `l'anneau, hors de .m mais dans .o, est invisible (découpé par une zone qui ne contient pas la zone) : ${JSON.stringify(dedans)}`)
        // le bouton n° 4 est sous la boîte de .o : caché
        const dehors = await anneau(page, tag, 4, '.o')
        assert.ok(dehors.anneau && dehors.anneau.haut >= dehors.parent.bas, 'le bouton est sous la partie visible de .o : ' + JSON.stringify(dehors))
        assert.equal(dehors.aire, 0, `l'anneau sort de .o : il est visible (${dehors.aire} px²) — ${JSON.stringify(dehors)}`)
        assert.ok(dehors.d && !dehors.d.sans && Math.abs(dehors.d.bas - dehors.parent.bas) <= 1, `le bas de la découpe est celui de .o : ${JSON.stringify(dehors)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('une zone dans un parent fixe qui découpe (une fenêtre de dialogue) : le parent fixe la découpe — l\'anneau d\'une balise hors de sa boîte est caché, celui d\'une balise dedans se voit', async function () {
        if (!present) { this.skip(); return }
        const tag               = 'mjs-fx-cb-modale'
        const { page, erreurs } = await ouvre(tag)
        const dedans            = await anneau(page, tag, 0, '.d')
        assert.ok(dedans.anneau && dedans.aire > 0, 'le bouton du haut est dans la fenêtre : ' + JSON.stringify(dedans))
        const dehors = await anneau(page, tag, 4, '.d')
        assert.ok(dehors.anneau && dehors.anneau.haut >= dehors.parent.bas, 'le bouton est sous la fenêtre : ' + JSON.stringify(dehors))
        assert.equal(dehors.aire, 0, `l'anneau sort de la fenêtre : il est visible (${dehors.aire} px²) — ${JSON.stringify(dehors)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // un parent sans position qui retient la zone (transformation, filtre…) la contient : il la découpe, comme un parent positionné
      for (const [cle, position, court] of RETENUES) {
        it(`une zone ${position} dans un parent sans position qui la retient (${RETIENT[cle]}) et qui découpe : il la contient, il la découpe — l'anneau d'une balise hors de sa boîte est caché, celui d'une balise dedans se voit`, async function () {
          if (!present) { this.skip(); return }
          const tag               = `mjs-fx-cb-retenue-${cle}-${court}`
          const { page, erreurs } = await ouvre(tag)
          const dedans            = await anneau(page, tag, 0, '.outer')
          assert.ok(dedans.anneau && dedans.aire > 0, 'le bouton du haut est dans la partie visible : ' + JSON.stringify(dedans))
          const dehors = await anneau(page, tag, 4, '.outer')
          assert.ok(dehors.zone.haut >= dehors.parent.haut && dehors.zone.gauche >= dehors.parent.gauche, 'la zone est posée dans la boîte du parent, qui la retient : ' + JSON.stringify(dehors))
          assert.ok(dehors.anneau && dehors.anneau.haut >= dehors.parent.bas, 'le bouton est sous la partie visible du parent : ' + JSON.stringify(dehors))
          assert.equal(dehors.aire, 0, `l'anneau sort du parent : il est visible (${dehors.aire} px²) — ${JSON.stringify(dehors)}`)
          assert.ok(dehors.d && !dehors.d.sans && dehors.d.bas <= dehors.parent.bas + 1, `le bas de la découpe ne passe pas celui du parent : ${JSON.stringify(dehors)}`)
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }

      it('une zone dans un parent fixe, lui-même retenu par un parent transformé qui découpe : la retenue se poursuit — l\'anneau d\'une balise hors de la boîte du parent transformé est caché, celui d\'une balise dedans se voit', async function () {
        if (!present) { this.skip(); return }
        const tag               = 'mjs-fx-cb-retenue-chaine'
        const { page, erreurs } = await ouvre(tag)
        const dedans            = await anneau(page, tag, 0, '.t')
        assert.ok(dedans.anneau && dedans.aire > 0, 'le bouton du haut est dans la partie visible : ' + JSON.stringify(dedans))
        const dehors = await anneau(page, tag, 4, '.t')
        assert.ok(dehors.zone.haut >= dehors.parent.haut, 'la zone est posée dans la boîte du parent transformé : ' + JSON.stringify(dehors))
        assert.ok(dehors.anneau && dehors.anneau.haut >= dehors.parent.bas, 'le bouton est sous la partie visible du parent transformé : ' + JSON.stringify(dehors))
        assert.equal(dehors.aire, 0, `l'anneau sort du parent transformé : il est visible (${dehors.aire} px²) — ${JSON.stringify(dehors)}`)
        assert.ok(dehors.d && !dehors.d.sans && dehors.d.bas <= dehors.parent.bas + 1, `le bas de la découpe ne passe pas celui du parent transformé : ${JSON.stringify(dehors)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('une zone fixe dans un conteneur de requêtes (container-type: inline-size) qui découpe : il ne la retient pas (elle reste à la fenêtre) — le calque est rogné à la zone seule, l\'anneau d\'une balise hors de la boîte du parent se voit', async function () {
        if (!present) { this.skip(); return }
        const tag               = 'mjs-fx-cb-conteneur'
        const { page, erreurs } = await ouvre(tag)
        const m                 = await anneau(page, tag, 4, '.outer')
        assert.ok(m.anneau, 'l\'anneau de la balise active existe : ' + JSON.stringify(m))
        assert.ok(m.zone.haut < m.parent.haut, `la zone fixe est à la fenêtre, pas dans la boîte du parent : ${JSON.stringify(m)}`)
        assert.ok(m.aire > 0, `l'anneau, dans la zone, est invisible (découpé par un parent qui ne la retient pas) : ${JSON.stringify(m)}`)
        assert.ok(egale(m.d, m.zone), `la découpe est la boîte de la zone : ${JSON.stringify(m)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('une zone sous un parent sans boîte (display: contents) : il ne découpe rien — le calque est rogné à la zone seule, l\'anneau de sa balise active se voit', async function () {
        if (!present) { this.skip(); return }
        const tag               = 'mjs-fx-cb-contenu'
        const { page, erreurs } = await ouvre(tag)
        const m                 = await anneau(page, tag, 0)
        assert.ok(m.anneau, 'l\'anneau de la balise active existe : ' + JSON.stringify(m))
        assert.ok(m.aire > 0, `l'anneau, dans la zone, est invisible (découpé par un parent sans boîte) : ${JSON.stringify(m)}`)
        assert.ok(egale(m.d, m.zone), `la découpe est la boîte de la zone : ${JSON.stringify(m)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*follow, la zone défile chez qui suit : l\'anneau de la balise active existe d\'abord, puis sort de la zone — découpé à la zone, jamais visible dehors', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs } = await ouvre('mjs-fx-cb-zone')
        await focus(page, 'mjs-fx-cb-zone', 0, 'follow:cursor')
        await page.waitForFunction(() => !!document.querySelector('[mjs-fx-cursor-focus]'), null, { timeout: 5000 }).catch(() => {})
        const avant = await page.evaluate(() => {
          const z      = ((document.querySelector('mjs-fx-cb-zone') as any)._shadow.querySelector('.z') as HTMLElement).getBoundingClientRect()
          const f: any = document.querySelector('[mjs-fx-cursor-focus]')
          const q      = f ? f.getBoundingClientRect() : null
          return { zone: { haut: z.top, bas: z.bottom }, anneau: q && { haut: q.top, bas: q.bottom } }
        })
        assert.ok(avant.anneau, 'l\'anneau existe avant le défilement : ' + JSON.stringify(avant))
        assert.ok(avant.anneau.haut >= avant.zone.haut - 4 && avant.anneau.bas <= avant.zone.bas + 4, 'il est dans la zone : ' + JSON.stringify(avant))
        await page.evaluate(() => { ((document.querySelector('mjs-fx-cb-zone') as any)._shadow.querySelector('.z') as HTMLElement).scrollTop = 800 })
        await page.waitForTimeout(300)
        const apres = await page.evaluate(() => {
          const z      = ((document.querySelector('mjs-fx-cb-zone') as any)._shadow.querySelector('.z') as HTMLElement).getBoundingClientRect()
          const f: any = document.querySelector('[mjs-fx-cursor-focus]')
          const q      = f ? f.getBoundingClientRect() : null
          return { zone: { haut: z.top, bas: z.bottom }, anneau: q && { haut: q.top, bas: q.bottom }, d: (window as any).__decoupe() }
        })
        assert.ok(apres.anneau, 'l\'anneau existe toujours (découpé, pas retiré) : ' + JSON.stringify(apres))
        assert.ok(apres.anneau.bas <= apres.zone.haut || apres.anneau.haut >= apres.zone.bas, 'le bouton est sorti de la zone : ' + JSON.stringify(apres))
        assert.ok(apres.d && !apres.d.sans, 'le calque est découpé à la zone : ' + JSON.stringify(apres.d))
        assert.ok(Math.abs(apres.d.haut - apres.zone.haut) <= 1 && Math.abs(apres.d.bas - apres.zone.bas) <= 1, `la découpe suit la zone : ${JSON.stringify(apres)}`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    })
  }
})
