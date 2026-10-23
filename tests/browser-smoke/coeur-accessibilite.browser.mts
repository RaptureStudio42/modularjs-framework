// BANC navigateur RÉEL des modules cœur au clavier et à l'œil (Chromium + Firefox, build dev puis
// prod, via playwright) — hors de `npm test`, lancé comme les autres bancs `*.browser.mts` :
//   - <@@field> : le champ enveloppé porte le nom du libellé (arbre d'accessibilité de Chromium, moteur
//     de rôles de playwright sur un hôte sans shadow — il ne traverse pas un shadow fermé), un clic sur
//     le libellé y met le focus ;
//   - <@@tabs> : un Tab mène à l'onglet actif, les flèches passent au suivant, Tab sort de la liste ;
//   - <@@radio> : un seul arrêt de tabulation pour le groupe (le bouton coché), les flèches cochent
//     le voisin et y mettent le focus, en bouclant ;
//   - <@@menu> rond : ouvert, Tab mène à la première entrée ; Échap referme et rend le focus au bouton ;
//   - <@@carousel>, <@@number>, <@@field layout="float"> rempli : la zone focalisée au clavier se voit ;
//   - <@@deck layout="spread"> : les cartes du fond restent peintes au-dessus du fond d'une section ;
//   - <@@clock layout="timer"> : arrêté puis relancé, l'aiguille et le point suivent le chiffre.
// La page d'essai est écrite à la volée, compilée par bin/mjs en dev puis en prod.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { assertDistFrais } from '../helpers/dist-frais.js'
import { mjsTmp } from '../helpers/tmp.js'

const __dirname      = dirname(fileURLToPath(import.meta.url))
const MODULARJS_ROOT = join(__dirname, '..', '..')
const BIN_MJS        = join(MODULARJS_ROOT, 'bin', 'mjs')
const HOST           = 'mjs-banc-coeur'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
}

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createServer()
    srv.on('error', ko)
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address()
      const p = a && typeof a === 'object' ? a.port : 0
      srv.close(() => ok(p))
    })
  })
}

function ecrireFixture(dir: string): void {
  mkdirSync(join(dir, 'composants'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet' }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>MJS — modules cœur au clavier</title>\n<style>html,body{margin:0;background:#eee;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-banc-coeur></mjs-banc-coeur>\n<mjs-banc-libelle mjs-light></mjs-banc-libelle>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  writeFileSync(join(dir, 'composants', 'banc-libelle.mjs'), '<@@field label="Courriel"><input type="email" name="courriel"></@@field>\n')
  writeFileSync(join(dir, 'composants', 'banc-coeur.mjs'), [
    '<script>',
    "  $tab  = 'b'",
    "  $size = 'm'",
    '  $open = false',
    '  $run  = true',
    '</script>',
    '',
    '<button id="avant-field">avant</button>',
    '<@@field id="fe" label="Email"><input type="email" name="email"></@@field>',
    '<button id="avant-float">avant</button>',
    '<@@field id="ff" layout="float" label="Nom"><input name="nom" value="Ada"></@@field>',
    '',
    '<button id="avant-tabs">avant</button>',
    '<@@tabs id="tabs" value=!{$tab}><span value="a">A</span><span value="b">B</span><span value="c">C</span></@@tabs>',
    '<button id="apres-tabs">après</button>',
    '<p id="tab-val">{$tab}</p>',
    '',
    '<button id="avant-radio">avant</button>',
    '<@@radio id="ra" name="size" value="s" group=!{$size}>S</@@radio>',
    '<@@radio id="rb" name="size" value="m" group=!{$size}>M</@@radio>',
    '<@@radio id="rc" name="size" value="l" group=!{$size}>L</@@radio>',
    '<button id="apres-radio">après</button>',
    '<p id="size-val">{$size}</p>',
    '',
    '<button id="avant-menu">avant</button>',
    '<@@menu id="menu" open=!{$open}><a href="#1" id="m1">1</a><a href="#2" id="m2">2</a><a href="#3" id="m3">3</a></@@menu>',
    '<button id="apres-menu">après</button>',
    '',
    '<button id="avant-car">avant</button>',
    '<@@carousel id="car" buttons="false"><div>1</div><div>2</div><div>3</div></@@carousel>',
    '<button id="avant-nb">avant</button>',
    '<@@gauge id="nb" value="3"></@@gauge>',
    '',
    '<section id="fond">',
    '  <@@deck id="deck" layout="spread"><div class="carte cache"></div><div class="carte cache"></div><div class="carte rouge"></div></@@deck>',
    '</section>',
    '',
    '<@@clock id="tm" layout="timer" seconds="5" running={$run}></@@clock>',
    '<button id="stop" @click={$run = false}>stop</button>',
    '<button id="go" @click={$run = true}>go</button>',
    '<button id="avant-champ">avant</button>',
    '<@@number id="champ" value="3" min="0" max="9" label="Quantité"></@@number>',
    '',
    '<style>',
    '  #fond',
    '    padding: 20px',
    '    background: #fff',
    '  .carte.cache',
    '    visibility: hidden',
    '  .carte.rouge',
    '    background: rgb(255, 0, 0)',
    '</style>',
  ].join('\n'))
}

function serveDir(dir: string, port: number): Promise<any> {
  const server = createServer((req, res) => {
    const url  = new URL(req.url || '/', 'http://x')
    const rel  = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(dir, rel)
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('absent'); return }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    createReadStream(file).pipe(res)
  })
  return new Promise((ok, ko) => {
    server.on('error', ko)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

// dans la page : la racine d'un composant (shadow fermé, gardé par MJS), la chaîne des éléments actifs
// jusqu'au plus profond, décrite par id ou balise.classe
function outilsPage(): void {
  const w: any = window
  w.__root = (el: any) => el && (el._shadow || el.shadowRoot)
  w.__hote = () => w.__root(document.querySelector('mjs-banc-coeur'))
  w.__dans = (id: string, sel: string) => w.__root(w.__hote().querySelector('#' + id)).querySelector(sel)
  w.__actif = () => {
    const chaine: string[] = []
    let a: any = document.activeElement
    while (a) {
      chaine.push(a.id ? '#' + a.id : a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className ? '.' + a.className.split(' ')[0] : ''))
      const r = w.__root(a)
      a = r && r.activeElement ? r.activeElement : null
    }
    return chaine.join(' > ')
  }
}

describe('banc navigateur réel : modules cœur au clavier et à l\'œil (dev + prod)', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-coeur')
    port = await freePort()
    ecrireFixture(dir)
    server = await serveDir(dir, port)
  })

  after(async function () {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  for (const mode of ['dev', 'prod'] as const) {
    describe(`build ${mode}`, function () {
      before(function () {
        rmSync(join(dir, 'sortie'), { recursive: true, force: true })
        const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', dir, mode === 'prod' ? '--prod' : '--dev'], { encoding: 'utf-8', timeout: 120000 })
        assert.equal(r.status, 0, `mjs build --${mode} en échec :\n${r.stdout}\n${r.stderr}`)
        copyFileSync(join(dir, 'index.html'), join(dir, 'sortie', 'index.html'))
      })

      for (const engine of [chromium, firefox]) {
        describe(`moteur ${engine.name()}`, function () {
          let browser: any = null
          let page: any = null
          const issues: string[] = []

          const focusSur = (sel: string) => page.evaluate((s: string) => (window as any).__hote().querySelector(s).focus(), sel)
          const actif    = () => page.evaluate(() => (window as any).__actif())

          before(async function () {
            browser = await engine.launch()
            page    = await browser.newPage({ viewport: { width: 1200, height: 900 } })
            await page.addInitScript(outilsPage)
            page.on('console', (m: any) => { if (m.type() === 'error') issues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await page.goto(`http://127.0.0.1:${port}/sortie/index.html`, { waitUntil: 'load' })
            await page.waitForFunction(() => {
              const w: any = window
              const h = w.__hote && w.__hote()
              return !!(h && h.querySelector('#tm') && w.__root(h.querySelector('#tm')) && w.__root(h.querySelector('#deck')) && w.__root(h.querySelector('#fe')) && document.querySelector('mjs-banc-libelle mjs-core-field input'))
            }, null, { timeout: 30000 })
            await page.bringToFront()
            await page.waitForTimeout(300)
          })

          after(async function () {
            if (browser) await browser.close()
          })

          it('<@@field> : le champ enveloppé porte le nom du libellé', async function () {
            assert.equal(await page.evaluate(() => (window as any).__hote().querySelector('#fe input').getAttribute('aria-label')), 'Email')
            if (engine.name() === 'chromium') {
              const cdp = await page.context().newCDPSession(page)
              await cdp.send('Accessibility.enable')
              const { nodes } = await cdp.send('Accessibility.getFullAXTree')
              const noms = nodes.filter((n: any) => n.role?.value === 'textbox').map((n: any) => n.name?.value)
              assert.ok(noms.includes('Email'), `arbre d'accessibilité de Chromium : ${JSON.stringify(noms)}`)
              await cdp.detach()
            }
            assert.equal(await page.getByRole('textbox', { name: 'Courriel' }).count(), 1, 'moteur de rôles de playwright')
          })

          it('<@@field> : un clic sur le libellé met le focus dans le champ', async function () {
            const b = await page.evaluate(() => {
              const r = (window as any).__dans('fe', 'label').getBoundingClientRect()
              return { x: r.left + 3, y: r.top + r.height / 2 }
            })
            await focusSur('#avant-field')
            await page.mouse.click(b.x, b.y)
            const dedans = await page.evaluate(() => (window as any).__hote().activeElement === (window as any).__hote().querySelector('#fe input'))
            assert.equal(dedans, true, `le focus est dans le champ : ${await actif()}`)
          })

          it('<@@field layout="float"> rempli : le champ focalisé au clavier se voit', async function () {
            await focusSur('#avant-float')
            await page.keyboard.press('Tab')
            await page.waitForTimeout(300)
            const vu = await page.evaluate(() => {
              const w: any = window
              const i  = w.__hote().querySelector('#ff input')
              const cs = getComputedStyle(i)
              return { actif: w.__hote().activeElement === i, anneau: cs.outlineStyle + ' | ' + cs.boxShadow }
            })
            assert.equal(vu.actif, true, 'préalable : le focus est dans le champ')
            assert.match(vu.anneau, /59, 130, 246/, `anneau de focus : ${vu.anneau}`)
          })

          it('<@@tabs> : un Tab mène à l\'onglet actif, la flèche au suivant, Tab sort de la liste', async function () {
            await focusSur('#avant-tabs')
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > span', 'focus sur un onglet')
            assert.equal(await page.evaluate(() => (document.activeElement as any)._shadow.activeElement.getAttribute('value')), 'b', 'l\'onglet actif')
            await page.keyboard.press('ArrowRight')
            await page.waitForFunction(() => (window as any).__hote().querySelector('#tab-val').textContent === 'c', null, { timeout: 3000 })
            assert.equal(await page.evaluate(() => (document.activeElement as any)._shadow.activeElement.getAttribute('value')), 'c', 'le focus suit la flèche')
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #apres-tabs', 'Tab sort de la liste')
          })

          it('<@@radio> : un arrêt de tabulation (le bouton coché), les flèches cochent le voisin et y mènent le focus', async function () {
            await focusSur('#avant-radio')
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #rb > input.native', 'Tab mène au bouton coché')
            await page.keyboard.press('ArrowRight')
            await page.waitForFunction(() => (window as any).__hote().querySelector('#size-val').textContent === 'l', null, { timeout: 3000 })
            assert.equal(await actif(), 'mjs-banc-coeur > #rc > input.native', 'le focus suit la flèche')
            const coches = await page.evaluate(() => ['ra', 'rb', 'rc'].map((id) => (window as any).__dans(id, 'input.native').checked))
            assert.deepEqual(coches, [false, false, true])
            await page.keyboard.press('ArrowDown')
            await page.waitForFunction(() => (window as any).__hote().querySelector('#size-val').textContent === 's', null, { timeout: 3000 })
            assert.equal(await actif(), 'mjs-banc-coeur > #ra > input.native', 'au bout, on repart du premier')
            await page.keyboard.press('ArrowLeft')
            await page.waitForFunction(() => (window as any).__hote().querySelector('#size-val').textContent === 'l', null, { timeout: 3000 })
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #apres-radio', 'Tab sort du groupe')
          })

          it('<@@menu> rond : ouvert, Tab mène à la première entrée ; Échap referme et rend le focus au bouton', async function () {
            await focusSur('#avant-menu')
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #menu > button.toggle', 'Tab mène au bouton')
            await page.keyboard.press('Enter')
            await page.waitForFunction(() => !!(window as any).__dans('menu', '.radial.open'), null, { timeout: 3000 })
            await page.waitForTimeout(600)
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #m1', 'Tab mène à la première entrée')
            await page.keyboard.press('Escape')
            await page.waitForFunction(() => !(window as any).__dans('menu', '.radial.open'), null, { timeout: 3000 })
            assert.equal(await actif(), 'mjs-banc-coeur > #menu > button.toggle', 'le focus revient au bouton')
          })

          it('<@@carousel>, <@@number> : la zone focalisée au clavier se voit', async function () {
            await focusSur('#avant-car')
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #car > div.carousel')
            const car = await page.evaluate(() => {
              const cs = getComputedStyle((window as any).__dans('car', '.carousel'))
              return cs.outlineStyle + ' | ' + cs.boxShadow
            })
            assert.match(car, /59, 130, 246/, `anneau de focus du carrousel : ${car}`)
            await focusSur('#avant-nb')
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #nb > div.spinner')
            const nb = await page.evaluate(() => {
              const cs = getComputedStyle((window as any).__dans('nb', '.box'))
              return cs.outlineStyle + ' | ' + cs.boxShadow
            })
            assert.match(nb, /59, 130, 246/, `anneau de focus du compteur : ${nb}`)
            // le champ nombre : Tab va droit à la saisie (ses boutons sont hors de l'ordre), et la pilule s'entoure
            await focusSur('#avant-champ')
            await page.keyboard.press('Tab')
            assert.equal(await actif(), 'mjs-banc-coeur > #champ > input.input')
            await page.waitForTimeout(300)
            const champ = await page.evaluate(() => getComputedStyle((window as any).__dans('champ', '.field')).boxShadow)
            assert.match(champ, /59, 130, 246/, `anneau de focus du champ nombre : ${champ}`)
            await page.keyboard.press('ArrowUp')
            assert.equal(await page.evaluate(() => (window as any).__dans('champ', '.input').value), '4')
          })

          it('<@@deck layout="spread"> : la carte du fond reste peinte au-dessus du fond de la section', async function () {
            const c = await page.evaluate(() => {
              const cartes = Array.from((window as any).__hote().querySelector('#deck').children) as any[]
              cartes[2].scrollIntoView({ block: 'center' })
              const b = cartes[2].getBoundingClientRect()
              return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), z: getComputedStyle(cartes[2]).zIndex }
            })
            assert.equal(c.z, '-1', 'préalable : la carte du fond est à z-index -1')
            const png = await page.screenshot({ clip: { x: c.x - 2, y: c.y - 2, width: 4, height: 4 } })
            const px  = await page.evaluate((b64: string) => new Promise((ok) => {
              const im = new Image()
              im.onload = () => {
                const cv = document.createElement('canvas')
                cv.width  = 4
                cv.height = 4
                const x = cv.getContext('2d')!
                x.drawImage(im, 0, 0)
                ok(Array.from(x.getImageData(1, 1, 1, 1).data))
              }
              im.src = 'data:image/png;base64,' + b64
            }), png.toString('base64'))
            assert.deepEqual(px, [255, 0, 0, 255], 'le pixel au centre de la carte du fond est le sien')
          })

          it('<@@clock layout="timer"> : arrêté puis relancé, l\'aiguille et le point suivent le chiffre', async function () {
            const lire = () => page.evaluate(() => {
              const w: any = window
              const t  = Number(w.__dans('tm', '.number b').textContent)
              const o  = parseFloat(getComputedStyle(w.__dans('tm', '.hand')).strokeDashoffset)
              const m  = /matrix\(([^)]*)\)/.exec(getComputedStyle(w.__dans('tm', '.dot')).transform)
              const v  = m ? m[1].split(',').map(parseFloat) : [1, 0]
              const an = (Math.round(Math.atan2(v[1], v[0]) * 180 / Math.PI) + 360) % 360
              return { t, offset: Math.round(o), angle: an }
            })
            await page.waitForTimeout(1200)
            await page.evaluate(() => (window as any).__hote().querySelector('#stop').click())
            await page.waitForTimeout(100)
            const arret = await lire()
            assert.deepEqual({ offset: arret.offset, angle: arret.angle }, { offset: Math.round(440 - 440 * arret.t / 5), angle: (arret.t * 72) % 360 }, `arrêté : ${JSON.stringify(arret)}`)
            await page.waitForTimeout(1200)
            assert.deepEqual(await lire(), arret, 'arrêté : rien ne bouge')
            await page.evaluate(() => (window as any).__hote().querySelector('#go').click())
            await page.waitForTimeout(1150)
            const reprise = await lire()
            assert.equal(reprise.t, (arret.t + 1) % 5, `le chiffre reprend où il s'était arrêté : ${JSON.stringify([arret, reprise])}`)
            assert.deepEqual({ offset: reprise.offset, angle: reprise.angle }, { offset: Math.round(440 - 440 * reprise.t / 5), angle: (reprise.t * 72) % 360 }, `relancé : ${JSON.stringify(reprise)}`)
          })

          it('aucune erreur console ni pageerror', function () {
            assert.deepEqual(issues, [])
          })
        })
      }
    })
  }
})
