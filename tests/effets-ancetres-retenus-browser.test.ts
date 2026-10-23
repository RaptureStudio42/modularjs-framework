// Quels ancêtres RETIENNENT une balise `fixed` ou `absolute`, dans Chromium, Firefox et WebKit réels (la mise en page est vraie) :
//   - `container-type` (inline-size, size) ne retient rien : mesuré dans les trois navigateurs, une balise fixe ou absolue
//     dessous reste à la fenêtre ou à la page ; `on: view` la juge sur l'écran, pas sur ce conteneur qui rogne sans la contenir ;
//   - `translate`, `rotate`, `scale`, `offset-path`, et `will-change` de ces quatre noms, retiennent comme `transform`, la valeur
//     neutre comprise (la balise ne bouge pas, sa boîte est celle de l'ancêtre) : il la contient, il la rogne ; `on: view`, la
//     découpe du calque de `*cursors` et la zone de la lampe de `*longshadow` le comptent ;
//   - `transform-style: preserve-3d`, `will-change: contain`, `content-visibility: auto` et `content-visibility: hidden` retiennent
//     aussi (mesuré dans les trois navigateurs) ;
//   - `will-change: offset-rotate` ne retient pas (aucun des trois) : `rotate` n'est compté que seul.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'
type Cas    = { cle: string, decl: string, retient: boolean, position: 'fixed' | 'absolute' }

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// ce que les trois navigateurs ne traitent pas comme un bloc englobant
const NE_RETIENT_PAS: Record<string, string> = {
  'container-inline':          'container-type: inline-size',
  'container-size':            'container-type: size',
  'will-change-offset-rotate': 'will-change: offset-rotate'
}

// ce qu'ils retiennent, la valeur neutre comprise ; le chemin neutre laisse la boîte où la mise en page l'a mise
const RETIENT: Record<string, string> = {
  'translate':               'translate: 0px',
  'rotate':                  'rotate: 0deg',
  'scale':                   'scale: 1',
  'offset-path':             'offset-path: path(\'M 0 0 L 1 0\'); offset-rotate: 0deg; offset-anchor: 0 0',
  'will-change-translate':   'will-change: translate',
  'will-change-rotate':      'will-change: rotate',
  'will-change-scale':       'will-change: scale',
  'will-change-offset-path': 'will-change: offset-path',
  'transform-style':         'transform-style: preserve-3d',
  'will-change-contain':     'will-change: contain',
  'content-visibility-auto': 'content-visibility: auto',
  'content-visibility-hidden': 'content-visibility: hidden'
}

// les lignes d'une déclaration (plusieurs, séparées par « ; »), au retrait donné
const lignes = (decl: string, retrait: string) => decl.split('; ').map((d) => retrait + d)

// `on: view` : toutes les balises, une section de 1 500 px chacune, la zone qui rogne (200 × 100) à 1 000 px de son haut
const MOTEUR: Cas[] = [
  ...Object.entries(NE_RETIENT_PAS).map(([cle, decl]): Cas => ({ cle, decl, retient: false, position: 'fixed' })),
  ...Object.entries(RETIENT).map(([cle, decl]): Cas => ({ cle, decl, retient: true, position: 'fixed' })),
  { cle: 'abs-container-inline', decl: NE_RETIENT_PAS['container-inline'], retient: false, position: 'absolute' },
  { cle: 'abs-translate',        decl: RETIENT['translate'],               retient: true,  position: 'absolute' }
]

const sourceVue = () => [
  ...MOTEUR.map((c) => `<div class="s"><div class="c c-${c.cle}" id="c-${c.cle}"><div class="${c.position} ${c.retient ? 'dedans' : 'dehors'}" id="f-${c.cle}" *stagger>balise</div></div></div>`),
  '<style>',
  '.s',
  '  box-sizing: border-box',
  '  height: 1500px',
  '  padding-top: 1000px',
  '.c',
  '  overflow: hidden',
  '  width: 200px',
  '  height: 100px',
  ...MOTEUR.flatMap((c) => ['.c-' + c.cle, ...lignes(c.decl, '  ')]),
  '.fixed',
  '  position: fixed',
  '.absolute',
  '  position: absolute',
  '.dedans, .dehors',
  '  left: 0',
  '  width: 200px',
  '  height: 3000px',
  '.dedans',
  '  top: 0',
  '.dehors',
  '  top: 744px',
  '</style>',
  ''
].join('\n')

// les curseurs et la lampe : une page par cas, la zone (300 × 100 pour les curseurs, 300 × 200 pour la lampe) sous l'ancêtre à l'essai
const COPIES: Cas[] = [
  ...['translate', 'rotate', 'scale', 'offset-path', 'will-change-translate', 'transform-style', 'will-change-contain', 'content-visibility-auto'].map((cle): Cas => ({ cle, decl: RETIENT[cle], retient: true, position: 'fixed' })),
  { cle: 'abs-translate',  decl: RETIENT['translate'],               retient: true,  position: 'absolute' },
  { cle: 'container-size', decl: NE_RETIENT_PAS['container-size'], retient: false, position: 'fixed' }
]

const sourceCurseurs = (c: Cas) => [
  '<script>',
  '@sock = µsocket \'wss://x.fr/ws\'',
  '</script>',
  '<div class="outer"><div class="z" *cursors(cursor: none, selection: false)></div></div>',
  '<style>',
  '.outer',
  ...lignes(c.decl, '  '),
  '  overflow: hidden',
  '  width: 300px',
  '  height: 100px',
  '  margin: 20px 0 0 20px',
  '.z',
  '  position: ' + c.position,
  '  top: 0',
  '  left: 0',
  '  width: 300px',
  '  height: 300px',
  '  overflow: auto',
  '</style>',
  ''
].join('\n')

const sourceLampe = (c: Cas) => [
  '<div class="a"><h2 class="t" *longshadow(light: true, length: 100)>Ombre</h2></div>',
  '<style>',
  '.a',
  ...lignes(c.decl, '  '),
  '  overflow: hidden',
  '  width: 300px',
  '  height: 200px',
  '  margin: 20px 0 0 20px',
  '.t',
  '  position: ' + c.position,
  '  top: 60px',
  '  left: 100px',
  '  margin: 0',
  '  font: 700 32px/40px sans-serif',
  '</style>',
  ''
].join('\n')

// la connexion simulée des curseurs, posée dans la page avant le composant
const STUB = `(() => {
  const s = {
    _mjs_refs: 1,
    send() {},
    on() { return () => {} },
    room() { return { presence: () => ({ '7': true }), leave() {} } },
    destroy() {}, request() { return Promise.resolve(null) }, release() {}
  }
  µ.socket = () => s
  µ._mjs_sockets = { 'wss://x.fr/ws': s }
})()`

describe('les ancêtres qui retiennent une balise fixe ou absolue (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('effets-ancetres-retenus-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vue-ancetres.mjs'), sourceVue())
    for (const c of COPIES) {
      writeFileSync(join(srcDir, `cq-${c.cle}.mjs`), sourceCurseurs(c))
      writeFileSync(join(srcDir, `ol-${c.cle}.mjs`), sourceLampe(c))
    }
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async () => {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test des ancêtres retenus sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      describe('on: view', function () {
        let page: any = null

        before(async () => {
          if (!present) return
          page = await browser.newPage({ viewport: { width: 390, height: 844 } })
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-vue-ancetres></mjs-vue-ancetres><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((n: number) => {
            const sh = (document.querySelector('mjs-vue-ancetres') as any)?._shadow
            return !!sh && sh.querySelectorAll('[id^="f-"]').length === n && sh.querySelectorAll('[id^="f-"]:not([mjs-fx])').length === 0
          }, MOTEUR.length)
          await page.evaluate(() => {
            (window as any).__trouve = (id: string) => (document.querySelector('mjs-vue-ancetres') as any)._shadow.querySelector('#' + id)
          })
        })

        after(async () => { if (page) await page.close() })

        // la balise est vue (la marque d'attente que pose `on: view` est retirée) avant `delai` ms ?
        const vue = (id: string, delai: number): Promise<boolean> => page.waitForFunction((i: string) => !(window as any).__trouve(i).hasAttribute('mjs-fx-wait'), id, { timeout: delai }).then(() => true, () => false)

        // la zone remontée de `reste` px au-dessus du bas de l'écran (`reste` px seulement visibles)
        async function montrer(id: string, reste: number) {
          await page.evaluate(([i, r]: [string, number]) => {
            window.scrollBy(0, (window as any).__trouve(i).getBoundingClientRect().top - (window.innerHeight - r))
          }, [id, reste])
        }

        // ce que jugerait `on: view` si l'observateur rendait `visible` px de la zone (sur 100) : `µ._mjs_fxSeen` sur une entrée faite de la géométrie réelle
        const juge = (id: string, visible: number): Promise<boolean> => page.evaluate(([i, v]: [string, number]) => {
          const el = (window as any).__trouve(i)
          const b  = el.getBoundingClientRect()
          return (window as any).µ._mjs_fxSeen({ isIntersecting: true, intersectionRatio: v / b.height, target: el, boundingClientRect: { width: b.width, height: b.height }, intersectionRect: { width: b.width, height: v }, rootBounds: { width: window.innerWidth, height: window.innerHeight } }, 0.2)
        }, [id, visible])

        for (const c of MOTEUR) {
          if (c.retient) {
            it(`une balise ${c.position} sous « ${c.decl} » : l'ancêtre la retient, il la rogne — à peine entrée elle n'est pas vue, à 30 px de ses 100 elle l'est`, async function () {
              if (!present) { this.skip(); return }
              // WebKit ne signale pas l'intersection d'une balise fixe sous un ancêtre à `will-change` qui rogne (même sous `will-change: transform` :
              // mesuré, `isIntersecting` reste faux) : le jugement du moteur se contrôle alors sur une entrée faite de la géométrie réelle
              // sous `content-visibility: hidden`, aucun navigateur ne dessine la balise : l'observateur ne la voit jamais, et WebKit ne
              // signale pas non plus celle sous `content-visibility: auto` ni sous `transform-style: preserve-3d` qui rogne
              if (c.decl === 'content-visibility: hidden' || (nom === 'webkit' && /^(will-change|content-visibility|transform-style)/.test(c.decl))) {
                assert.equal(await juge('f-' + c.cle, 5), false, '5 px sur 100 : à peine entrée')
                assert.equal(await juge('f-' + c.cle, 30), true, `30 px sur 100 : la zone de 100 px, qui retient la balise, borne ce qu'elle montre (${c.decl})`)
                return
              }
              await montrer('c-' + c.cle, 5)
              assert.equal(await vue('f-' + c.cle, 800), false, '5 px sur 100 : à peine entrée')
              await montrer('c-' + c.cle, 30)
              assert.equal(await vue('f-' + c.cle, 15000), true, `30 px sur 100 : la zone de 100 px, qui retient la balise, borne ce qu'elle montre (${c.decl})`)
            })
          }
          else {
            it(`une balise ${c.position} sous « ${c.decl} » qui rogne : l'ancêtre ne la retient pas, elle est jugée sur l'écran — 100 px de ses 3 000 en bas de l'écran ne la font pas voir, 244 px la font voir`, async function () {
              if (!present) { this.skip(); return }
              // fixe : à la fenêtre ; absolue : à la page, posée là où ses 100 premiers px sont au bas de l'écran
              const pose = (reste: number) => page.evaluate(([i, p, r]: [string, string, number]) => {
                const el     = (window as any).__trouve(i)
                el.style.top = (p === 'absolute' ? window.scrollY : 0) + window.innerHeight - r + 'px'
              }, ['f-' + c.cle, c.position, reste] as [string, string, number])
              await pose(100)
              assert.equal(await vue('f-' + c.cle, 1200), false, `100 px de ses 3 000 en bas de l'écran : 12 % de l'écran, pas 100 % de la boîte de 100 px qui ne la rogne pas (${c.decl})`)
              await pose(244)
              assert.equal(await vue('f-' + c.cle, 15000), true, 'témoin : 244 px en bas de l\'écran, 29 % de l\'écran, la balise est vue')
            })
          }
        }
      })

      // la page d'un composant (le corps hors composant, la connexion simulée, puis le composant)
      async function ouvre(tag: string, largeur: number, hauteur: number) {
        const page              = await browser.newPage({ viewport: { width: largeur, height: hauteur } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${script}</script></body></html>`, { waitUntil: 'load' })
        await page.evaluate(STUB)
        await page.evaluate((t: string) => { document.body.appendChild(document.createElement(t)) }, tag)
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.z, .t'), tag)
        return { page, erreurs }
      }

      for (const c of COPIES) {
        it(`*cursors, une zone ${c.position} sous « ${c.decl} » qui rogne : ${c.retient ? 'l\'ancêtre la retient, le calque est rogné à sa boîte' : 'l\'ancêtre ne la retient pas, le calque est rogné à la zone seule'}`, async function () {
          if (!present) { this.skip(); return }
          const tag               = 'mjs-cq-' + c.cle
          const { page, erreurs } = await ouvre(tag, 900, 600)
          try {
            // un redimensionnement fait dessiner : la découpe du calque, ses quatre bords en coordonnées de la fenêtre
            const m = await page.evaluate((t: string) => new Promise((fin) => {
              window.dispatchEvent(new Event('resize'))
              requestAnimationFrame(() => requestAnimationFrame(() => {
                const sh: any = (document.querySelector(t) as any)._shadow
                const boite   = (r: DOMRect) => ({ haut: r.top, bas: r.bottom, gauche: r.left, droite: r.right })
                const calque  = document.querySelector('[mjs-fx-cursors-layer]') as HTMLElement | null
                const inset   = calque ? /inset\(([^)]*)\)/.exec(calque.style.clipPath) : null
                let decoupe   = null as any
                if (inset) {
                  const v            = inset[1].split(/[\s,]+/).filter(Boolean).map(parseFloat)
                  const [h, d, b, g] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]]
                  const de           = document.documentElement
                  decoupe = { haut: h, bas: de.clientHeight - b, gauche: g, droite: de.clientWidth - d }
                }
                fin({ decoupe, zone: boite(sh.querySelector('.z').getBoundingClientRect()), parent: boite(sh.querySelector('.outer').getBoundingClientRect()) })
              }))
            }), tag) as any
            assert.ok(m.decoupe, 'le calque est rogné : ' + JSON.stringify(m))
            if (c.retient) {
              assert.ok(m.zone.haut >= m.parent.haut - 1 && m.zone.gauche >= m.parent.gauche - 1, 'la zone est posée dans la boîte du parent, qui la retient : ' + JSON.stringify(m))
              assert.ok(m.decoupe.bas <= m.parent.bas + 1, `le bas de la découpe ne passe pas celui du parent (la zone de 300 px dépasse le parent de 100 px) : ${JSON.stringify(m)}`)
              assert.ok(m.decoupe.haut >= m.parent.haut - 1 && m.decoupe.gauche >= m.parent.gauche - 1, 'la découpe commence dans le parent : ' + JSON.stringify(m))
            }
            else {
              assert.ok(m.zone.haut < m.parent.haut, 'la zone fixe est à la fenêtre, pas dans la boîte du parent : ' + JSON.stringify(m))
              assert.ok(Math.abs(m.decoupe.bas - m.zone.bas) <= 1 && Math.abs(m.decoupe.haut - m.zone.haut) <= 1, 'la découpe est la boîte de la zone : ' + JSON.stringify(m))
            }
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })
      }

      for (const c of COPIES) {
        it(`*longshadow, une balise ${c.position} sous « ${c.decl} » qui rogne : ${c.retient ? 'l\'ancêtre la retient, la lampe reste dans sa boîte' : 'l\'ancêtre ne la retient pas, la lampe a la fenêtre pour zone'}`, async function () {
          if (!present) { this.skip(); return }
          const tag               = 'mjs-ol-' + c.cle
          const { page, erreurs } = await ouvre(tag, 700, 500)
          try {
            const centre = await page.evaluate((t: string) => {
              const b = ((document.querySelector(t) as any)._shadow.querySelector('.t') as HTMLElement).getBoundingClientRect()
              return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
            }, tag)
            // le pointeur sur la balise : la lampe s'allume dans sa zone, sa fenêtre se cale sur elle
            await page.mouse.move(centre.x - 20, centre.y)
            await page.mouse.move(centre.x, centre.y)
            await page.waitForFunction(() => {
              const p = document.querySelector('[mjs-fx-longshadow-window]') as HTMLElement | null
              return !!p && p.style.display !== 'none'
            }, null, { timeout: 15000 }).catch(() => {})
            const m = await page.evaluate((t: string) => {
              const p = document.querySelector('[mjs-fx-longshadow-window]') as HTMLElement | null
              const a = ((document.querySelector(t) as any)._shadow.querySelector('.a') as HTMLElement).getBoundingClientRect()
              const r = p ? p.getBoundingClientRect() : null
              return { allumee: !!p && p.style.display !== 'none', fenetre: r && { x: r.left, y: r.top, w: r.width, h: r.height }, zone: { x: a.left, y: a.top, w: a.width, h: a.height }, ecran: { w: window.innerWidth, h: window.innerHeight } }
            }, tag)
            assert.ok(m.allumee && m.fenetre, 'la lampe est allumée, pointeur sur la balise : ' + JSON.stringify(m))
            const egale = (a: any, b: any) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1
            if (c.retient) assert.ok(egale(m.fenetre, m.zone), `la fenêtre de la lampe est la boîte de l'ancêtre qui retient la balise : ${JSON.stringify(m)}`)
            else assert.ok(egale(m.fenetre, { x: 0, y: 0, w: m.ecran.w, h: m.ecran.h }), `la fenêtre de la lampe est celle de l'écran (l'ancêtre ne retient pas la balise) : ${JSON.stringify(m)}`)
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })
      }
    })
  }
})
