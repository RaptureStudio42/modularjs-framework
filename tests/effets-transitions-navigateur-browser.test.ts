// les transitions neuves et leurs variantes dans des navigateurs réels (la mise en page, la peinture et les
// filtres SVG sont vrais) : *pixelate (au défilement, puis à l'entrée et à la sortie d'un {if}), *iris (penché,
// puis parti du dernier clic), *blocks (ordre au hasard), *fly (rotate) et *scale (start: 20) ; chaque réglage
// change ce qu'on lit à l'écran, et une fois la transition finie la balise n'a plus ni filtre, ni clip-path,
// ni attribut style, ni animation, et la page plus aucun <svg> de filtre ; la balise qui attend son tour n'en porte aucun, ni
// observateur de taille ; une entrée coupée par une sortie (ou rien) ne laisse pas de <svg> derrière la balise retirée ; le survol
// de l'iris qui part du pointeur n'est écouté que tant qu'une balise en a besoin
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Engine = 'chromium' | 'firefox' | 'webkit'

async function browserPresent(name: Engine): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[name].executablePath())
  } catch {
    return false
  }
}

// chaque scène défile dans sa boîte : `range: 0 400px` donne l'avancée exacte (scrollTop / 400), la balise reste en vue
// (collante) ; les zones du bas jouent les transitions du cycle de vie d'un {if}
const SOURCE = [
  '<script>',
  '$a = false',
  '$b = false',
  '$s = 0.2',
  '$g = 10',
  '$k = \'box\'',
  '$z = 40',
  '$c = false',
  '$d = false',
  '$e = false',
  '$f = false',
  '$img = \'data:image/svg+xml,\' + encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#e11d48"/><circle cx="150" cy="100" r="60" fill="#fde047"/><path d="M0 150 L300 50" stroke="#0f172a" stroke-width="6"/></svg>\')',
  '</script>',
  '<div class="vue" id="s-pixelate"><div class="rail"><div class="piece"><img class="el" id="e-pixelate" src={$img} alt="" *pixelate(size: 64, steps: 6, on: scroll, range: 0 400px)></div></div></div>',
  '<div class="vue" id="s-iris"><div class="rail"><div class="piece"><img class="el" id="e-iris" src={$img} alt="" *iris(shape: box, start: .2, angle: -11, on: scroll, range: 0 400px)></div></div></div>',
  '<div class="vue" id="s-blocks"><div class="rail"><div class="piece"><img class="el" id="e-blocks" src={$img} alt="" *blocks(cols: 8, rows: 6, order: random, seed: 5, on: scroll, range: 0 400px)></div></div></div>',
  '<div class="vue" id="s-fly"><div class="rail"><div class="piece"><div class="el" id="e-fly" *fly(up, distance: 100, rotate: 180, on: scroll, range: 0 400px)>fly</div></div></div></div>',
  '<div class="vue" id="s-scale"><div class="rail"><div class="piece"><h2 class="el" id="e-scale" *scale(start: 20, on: scroll, range: 0 400px)>zoom</h2></div></div></div>',
  '<img class="el" id="e-tenu" src={$img} alt="" *iris(shape: $k, start: $s, angle: $g, on: success)>',
  '<img class="el" id="e-tenu-px" src={$img} alt="" *pixelate(size: $z, on: success, duration: 6s)>',
  '<button id="b-pixelate" @click={$a = !$a}>pixelate</button>',
  '<div class="zone">{if $a}<img class="el" id="v-pixelate" src={$img} alt="" @transition=*pixelate(size: 32, steps: 4, duration: 900ms)>{end}</div>',
  '<button id="b-iris" @click={$b = !$b}>iris</button>',
  '<div class="zone">{if $b}<img class="el" id="v-iris" src={$img} alt="" @transition=*iris(origin: pointer, shape: box, duration: 4s)>{end}</div>',
  '<button id="b-in" @click={$c = !$c}>in</button>',
  '<div class="zone">{if $c}<div class="el" id="v-in" @in=*pixelate(size: 32, steps: 4, duration: 1200ms)>in</div>{end}</div>',
  '<button id="b-inout" @click={$d = !$d}>inout</button>',
  '<div class="zone">{if $d}<div class="el" id="v-inout" @in=*pixelate(size: 32, steps: 4, duration: 1200ms) @out=*pixelate(size: 32, steps: 4, duration: 1200ms)>inout</div>{end}</div>',
  '<button id="b-fade" @click={$e = !$e}>fade</button>',
  '<div class="zone">{if $e}<div class="el" id="v-fade" @in=*pixelate(size: 32, steps: 4, duration: 1200ms) @out=*fade(duration: 200ms)>fade</div>{end}</div>',
  '<button id="b-ptr" @click={$f = !$f}>ptr</button>',
  '<div class="zone">{if $f}<div class="el" id="v-ptr" @in=*iris(origin: pointer, duration: 300ms) @out=*iris(origin: pointer, duration: 300ms)>ptr</div>{end}</div>',
  '<style>',
  ':host',
  '  display: block',
  '.vue',
  '  width: 300px',
  '  height: 200px',
  '  overflow-y: auto',
  '.rail',
  '  height: 600px',
  '.piece',
  '  position: sticky',
  '  top: 0',
  '  width: 300px',
  '  height: 200px',
  '.el',
  '  display: block',
  '  width: 300px',
  '  height: 200px',
  '  margin: 0',
  '  font-size: 30px',
  '  line-height: 200px',
  '  text-align: center',
  '.zone',
  '  width: 300px',
  '  height: 200px',
  '  margin: 10px 0 0 200px',
  '</style>',
  ''
].join('\n')

describe('les transitions neuves et leurs variantes (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('effets-transitions-navigateur-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vue-transitions.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rank  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const name of ['chromium', 'firefox', 'webkit'] as const) {
    describe(name, function () {
      let present = false
      let browser: any = null
      let page: any = null
      const errors: string[] = []

      before(async () => {
        present = await browserPresent(name)
        if (!present) {
          console.log(`  ℹ️  ${name} non installé, test des transitions sauté. Activer : \`npx playwright install ${name}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[name].launch()
        page = await browser.newPage({ viewport: { width: 900, height: 3000 } })
        page.on('pageerror', (e: any) => errors.push(String(e.message ?? e)))
        // les observateurs de taille encore vivants et les écouteurs de survol de la page, comptés avant tout script
        await page.addInitScript(() => {
          const w: any = window
          const Native = w.ResizeObserver
          w.__roLive = new Set()
          w.ResizeObserver = class extends Native {
            constructor(callback: any) {
              super(callback)
              w.__roLive.add(this)
            }
            disconnect() {
              w.__roLive.delete(this)
              super.disconnect()
            }
          }
          w.__move = { add: 0, rem: 0 }
          const add = EventTarget.prototype.addEventListener
          const rem = EventTarget.prototype.removeEventListener
          EventTarget.prototype.addEventListener = function (this: any, type: string, f: any, o: any) {
            if (this === document && type === 'pointermove') w.__move.add++
            return add.call(this, type, f, o)
          }
          EventTarget.prototype.removeEventListener = function (this: any, type: string, f: any, o: any) {
            if (this === document && type === 'pointermove') w.__move.rem++
            return rem.call(this, type, f, o)
          }
        })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-vue-transitions></mjs-vue-transitions><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => {
          const sh = (document.querySelector('mjs-vue-transitions') as any)?._shadow
          return !!sh && !!sh.querySelector('#e-scale') && !!sh.querySelector('#e-pixelate')
        })
        await page.evaluate(() => {
          const sh = () => (document.querySelector('mjs-vue-transitions') as any)._shadow
          const w = window as any
          w.__el = (id: string) => sh().querySelector('#' + id)
          // la scène défile à `y` px (avancée y / 400), la balise est relue après deux images
          w.__defile = (scene: string, y: number) => new Promise((ok) => {
            w.__el(scene).scrollTop = y
            requestAnimationFrame(() => requestAnimationFrame(() => ok(true)))
          })
          w.__css = (id: string) => { const cs = getComputedStyle(w.__el(id)); return { filter: cs.filter, clip: cs.clipPath, transform: cs.transform, opacity: cs.opacity, willChange: cs.willChange } }
          w.__svgs = () => sh().querySelectorAll('svg').length
          // le rayon de feMorphology du filtre que la balise référence
          w.__rayon = (id: string) => {
            const m = /#([\w-]+)/.exec(getComputedStyle(w.__el(id)).filter)
            const f = m && sh().querySelector('#' + m[1])
            const r = f && /radius="(\d+)"/.exec(f.innerHTML)
            return r ? Number(r[1]) : null
          }
        })
      })

      after(async () => { if (browser) await browser.close() })

      // un clic de souris sur la balise `id` (le shadow root du composant est fermé : pas de sélecteur Playwright)
      const clickOn = async (id: string) => {
        const c = await page.evaluate((i: string) => { const r = (window as any).__el(i).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, id)
        await page.mouse.move(c.x - 20, c.y - 5)
        await page.mouse.click(c.x, c.y)
      }
      const numbers = (css: string) => (css.match(/-?\d+(?:\.\d+)?(?=%)/g) ?? []).map(Number)

      it('*pixelate au défilement : le palier suit l\'avancée, l\'image est nette en bas de course, le filtre part avec elle', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__defile('s-pixelate', 0))
        assert.equal(await page.evaluate(() => (window as any).__css('e-pixelate').filter), 'none', 'avancée 0 : la balise attend, aucun filtre')
        await page.evaluate(() => (window as any).__defile('s-pixelate', 4))
        assert.equal(await page.evaluate(() => (window as any).__rayon('e-pixelate')), 32, 'au premier pixel de défilement : le plus gros carreau (64 px, rayon 32)')
        assert.match(await page.evaluate(() => (window as any).__css('e-pixelate').filter), /^url\(/)
        await page.evaluate(() => (window as any).__defile('s-pixelate', 200))
        assert.equal(await page.evaluate(() => (window as any).__rayon('e-pixelate')), 4, 'avancée 0,5 : le quatrième palier sur six (8 px, rayon 4)')
        await page.evaluate(() => (window as any).__defile('s-pixelate', 396))
        assert.equal(await page.evaluate(() => (window as any).__rayon('e-pixelate')), 1, 'juste avant la fin : le plus fin (2 px)')
        await page.evaluate(() => (window as any).__defile('s-pixelate', 400))
        assert.equal(await page.evaluate(() => (window as any).__css('e-pixelate').filter), 'none', 'avancée 1 : l\'image nette, aucun filtre')
        assert.equal(await page.evaluate(() => (window as any).__svgs()), 0, 'aucun <svg> de filtre ne reste : ni celui du défilement, ni celui de la balise tenue (*pixelate(on: success), qui attend sa réussite)')
        assert.equal(await page.evaluate(() => (window as any).__el('e-pixelate').hasAttribute('style')), false)
        // on remonte : la mosaïque revient
        await page.evaluate(() => (window as any).__defile('s-pixelate', 100))
        assert.equal(await page.evaluate(() => (window as any).__rayon('e-pixelate')), 16, 'avancée 0,25 : deuxième palier sur six (32 px, rayon 16)')
        await page.evaluate(() => (window as any).__defile('s-pixelate', 400))
      })

      it('la balise qui attend son tour ne porte ni <svg>, ni filtre, ni observateur de taille : tenue (on: success) comme au défilement hors de sa bande', async function () {
        if (!present) { this.skip(); return }
        const svgs   = () => page.evaluate(() => (window as any).__svgs())
        const alive = () => page.evaluate(() => (window as any).__roLive.size)
        const view    = () => page.evaluate(() => { const cs = getComputedStyle((window as any).__el('e-pixelate')); return { filter: cs.filter, visibility: cs.visibility } })
        // tenue : cachée, rien d'autre
        assert.equal(await svgs(), 0, 'aucun <svg> au repos')
        assert.deepEqual(await page.evaluate(() => { const cs = getComputedStyle((window as any).__el('e-tenu-px')); return { filter: cs.filter, visibility: cs.visibility } }), { filter: 'none', visibility: 'hidden' })
        // au défilement : hors de sa bande (avancée 0) elle attend de même
        await page.evaluate(() => (window as any).__defile('s-pixelate', 0))
        const rest = await alive()
        assert.equal(await svgs(), 0)
        assert.deepEqual(await view(), { filter: 'none', visibility: 'hidden' })
        // dans sa bande : la mosaïque, son <svg> et son observateur naissent
        await page.evaluate(() => (window as any).__defile('s-pixelate', 4))
        assert.equal(await svgs(), 1)
        assert.equal(await alive(), rest + 1)
        assert.equal((await view()).visibility, 'visible')
        // de nouveau hors de sa bande, puis passée : ils repartent
        await page.evaluate(() => (window as any).__defile('s-pixelate', 0))
        assert.equal(await svgs(), 0)
        assert.equal(await alive(), rest)
        await page.evaluate(() => (window as any).__defile('s-pixelate', 4))
        await page.evaluate(() => (window as any).__defile('s-pixelate', 400))
        assert.equal(await svgs(), 0)
        assert.equal(await alive(), rest)
        assert.deepEqual(await view(), { filter: 'none', visibility: 'visible' })
      })

      // les huit nombres d'une fenêtre en boîte de 300 × 200 ouverte à `e` (de 0 à 1), tournée de `angle` × (1 - e) autour du centre
      const opening = (e: number, angle: number) => {
        const th  = (1 - e) * angle * Math.PI / 180
        const pts: number[] = []
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const dx = sx * 300 * e / 2
          const dy = sy * 200 * e / 2
          pts.push(50 + (dx * Math.cos(th) - dy * Math.sin(th)) / 300 * 100, 50 + (dx * Math.sin(th) + dy * Math.cos(th)) / 200 * 100)
        }
        return pts
      }
      const near = (read: number[], expected: number[], what: string) => {
        assert.equal(read.length, expected.length, what)
        read.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.05, `${what} : valeur ${i} = ${v}, attendu ${expected[i].toFixed(3)}`))
      }

      it('*iris(shape: box, start: .2, angle: -11) au défilement : un rectangle penché qui part du cinquième de la boîte et se redresse', async function () {
        if (!present) { this.skip(); return }
        const expected = (p: number) => {
          const e  = 0.2 + 0.8 * p
          const th = (1 - e) * -11 * Math.PI / 180
          const pts: number[] = []
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const dx = sx * 300 * e / 2
            const dy = sy * 200 * e / 2
            pts.push(50 + (dx * Math.cos(th) - dy * Math.sin(th)) / 300 * 100, 50 + (dx * Math.sin(th) + dy * Math.cos(th)) / 200 * 100)
          }
          return pts
        }
        for (const [y, p] of [[0, 0], [200, 0.5], [400, 1]] as Array<[number, number]>) {
          await page.evaluate((v: number) => (window as any).__defile('s-iris', v), y)
          const read = numbers(await page.evaluate(() => (window as any).__css('e-iris').clip))
          const at = expected(p)
          assert.equal(read.length, 8, `quatre sommets à l'avancée ${p}`)
          read.forEach((v, i) => assert.ok(Math.abs(v - at[i]) < 0.05, `avancée ${p} : valeur ${i} = ${v}, attendu ${at[i].toFixed(3)}`))
        }
      })

      it('*blocks(order: random, seed: 5) au défilement : toujours les mêmes sommets en nombre, toutes les tuiles posées à la fin', async function () {
        if (!present) { this.skip(); return }
        const count = async (y: number) => {
          await page.evaluate((v: number) => (window as any).__defile('s-blocks', v), y)
          return numbers(await page.evaluate(() => (window as any).__css('e-blocks').clip)).length / 2
        }
        // 8 × 6 = 48 tuiles : 5 sommets chacune, plus le retour de liaison
        assert.equal(await count(80), 5 * 48 + 46)
        assert.equal(await count(200), 5 * 48 + 46)
        assert.equal(await count(320), 5 * 48 + 46)
        assert.equal(await count(400), 5 * 48 + 46)
      })

      it('*blocks au défilement dans une boîte non carrée : les tuiles se tournent en pixels, jamais déformées', async function () {
        if (!present) { this.skip(); return }
        // boîte de 300 × 200, 8 × 6 tuiles : chaque tuile est un rectangle de 37,5 × 33,3 px (rapport 1,125) tourné, ses côtés restent
        // perpendiculaires ; dans une boîte prise pour 1 × 1 ils se déforment en parallélogramme
        for (const y of [80, 160]) {
          await page.evaluate((v: number) => (window as any).__defile('s-blocks', v), y)
          const clip = await page.evaluate(() => (window as any).__css('e-blocks').clip)
          const n = numbers(clip)
          let turned = 0
          for (let t = 0; t < 48; t++) {
            const q = n.slice(t * 10, t * 10 + 8).map((v, i) => i % 2 ? v * 2 : v * 3)
            const a = [q[2] - q[0], q[3] - q[1]]
            const b = [q[4] - q[2], q[5] - q[3]]
            const la = Math.hypot(a[0], a[1])
            const lb = Math.hypot(b[0], b[1])
            if (la < 6 || lb < 6) continue
            turned++
            const cos = (a[0] * b[0] + a[1] * b[1]) / (la * lb)
            assert.ok(Math.abs(cos) < 0.02, `défilement ${y}, tuile ${t} : côtés non perpendiculaires (cos ${cos.toFixed(3)})`)
            assert.ok(Math.abs(la / lb - 1.125) < 0.05, `défilement ${y}, tuile ${t} : rapport ${(la / lb).toFixed(3)}, attendu 1,125`)
          }
          assert.ok(turned >= 4, `défilement ${y} : assez de tuiles mesurées (${turned})`)
        }
      })

      it('*fly(rotate: 180) et *scale(start: 20) au défilement : la balise arrive tournée et se redresse ; le titre rétrécit de vingt fois à sa taille', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__defile('s-fly', 200))
        const m = (await page.evaluate(() => (window as any).__css('e-fly').transform)).match(/-?\d+(?:\.\d+)?/g).map(Number)
        // à mi-course : tournée de 90° (cos 0, sin 1) et à mi-chemin des 100 px de départ
        assert.ok(Math.abs(m[0]) < 1e-3 && Math.abs(m[1] - 1) < 1e-3 && Math.abs(m[2] + 1) < 1e-3 && Math.abs(m[3]) < 1e-3, `rotation de 90° (${m.join(' ')})`)
        assert.ok(Math.abs(m[5] - 50) < 0.01, `à mi-chemin de 100 px (${m[5]})`)
        await page.evaluate(() => (window as any).__defile('s-fly', 400))
        const f = (await page.evaluate(() => (window as any).__css('e-fly').transform)).match(/-?\d+(?:\.\d+)?/g).map(Number)
        assert.ok(Math.abs(f[0] - 1) < 1e-3 && Math.abs(f[1]) < 1e-3 && Math.abs(f[5]) < 0.01, `redressée à la fin (${f.join(' ')})`)
        await page.evaluate(() => (window as any).__defile('s-scale', 200))
        const s = (await page.evaluate(() => (window as any).__css('e-scale').transform)).match(/-?\d+(?:\.\d+)?/g).map(Number)
        assert.ok(Math.abs(s[0] - 10.5) < 0.01 && Math.abs(s[3] - 10.5) < 0.01, `échelle 10,5 à mi-course (${s.join(' ')})`)
        await page.evaluate(() => (window as any).__defile('s-scale', 0))
        const d = (await page.evaluate(() => (window as any).__css('e-scale').transform)).match(/-?\d+(?:\.\d+)?/g).map(Number)
        assert.ok(Math.abs(d[0] - 20) < 0.01, `vingt fois plus grand au départ (${d.join(' ')})`)
      })

      it('@transition=*pixelate dans un {if} : la mosaïque à l\'entrée et à la sortie, puis plus rien — ni filtre, ni style, ni <svg>, et la balise retirée emporte le sien', async function () {
        if (!present) { this.skip(); return }
        const base = await page.evaluate(() => (window as any).__svgs())
        await clickOn('b-pixelate')
        await page.waitForFunction(() => { const e = (window as any).__el('v-pixelate'); return !!e && /^url\(/.test(getComputedStyle(e).filter) }, null, { timeout: 4000 })
        assert.equal(await page.evaluate(() => (window as any).__svgs()), base + 1, 'un filtre pendant l\'entrée')
        await page.waitForFunction(() => { const e = (window as any).__el('v-pixelate'); return !!e && getComputedStyle(e).filter === 'none' }, null, { timeout: 5000 })
        assert.equal(await page.evaluate(() => (window as any).__svgs()), base, 'l\'entrée finie : le <svg> est retiré')
        assert.equal(await page.evaluate(() => (window as any).__el('v-pixelate').hasAttribute('style')), false, 'aucun attribut style')
        assert.equal(await page.evaluate(() => (window as any).__el('v-pixelate').getAnimations().length), 0)
        assert.equal(await page.evaluate(() => (window as any).__css('v-pixelate').willChange), 'auto')
        // la sortie
        await clickOn('b-pixelate')
        await page.waitForFunction(() => { const e = (window as any).__el('v-pixelate'); return !e || /^url\(/.test(getComputedStyle(e).filter) }, null, { timeout: 4000 })
        await page.waitForFunction(() => !(window as any).__el('v-pixelate'), null, { timeout: 5000 })
        assert.equal(await page.evaluate(() => (window as any).__svgs()), base, 'balise retirée : plus de <svg>')
      })

      it('*pixelate dans un {if} coupé en pleine entrée (sortie *pixelate, sortie *fade, pas de sortie) : une fois la balise retirée, aucun <svg> ne reste', async function () {
        if (!present) { this.skip(); return }
        const base = await page.evaluate(() => (window as any).__svgs())
        for (const k of ['inout', 'fade', 'in']) {
          for (let n = 1; n <= 2; n++) {
            await clickOn('b-' + k)
            await page.waitForFunction((id: string) => { const e = (window as any).__el(id); return !!e && /^url\(/.test(getComputedStyle(e).filter) }, 'v-' + k, { timeout: 4000 })
            await page.waitForTimeout(150)
            // la sortie coupe l'entrée
            await clickOn('b-' + k)
            await page.waitForTimeout(100)
            assert.ok(await page.evaluate(() => (window as any).__svgs()) <= base + 1, `${k} n° ${n} : un seul filtre pendant la sortie, jamais deux empilés`)
            await page.waitForFunction((id: string) => !(window as any).__el(id), 'v-' + k, { timeout: 6000 })
            await page.waitForTimeout(300)
            assert.equal(await page.evaluate(() => (window as any).__svgs()), base, `${k} n° ${n} : la balise est retirée, son <svg> aussi`)
          }
        }
      })

      it('*iris(origin: pointer) dans un {if} : l\'écouteur de survol est posé avec la première balise et retiré avec la dernière, à chaque fois', async function () {
        if (!present) { this.skip(); return }
        const bound = () => page.evaluate(() => { const m = (window as any).__move; return m.add - m.rem })
        assert.equal(await bound(), 0, 'rien avant la première balise')
        for (let n = 1; n <= 2; n++) {
          await clickOn('b-ptr')
          await page.waitForFunction(() => !!(window as any).__el('v-ptr'), null, { timeout: 4000 })
          assert.equal(await bound(), 1, `pose n° ${n} : un seul écouteur de survol`)
          await page.waitForTimeout(600)
          await clickOn('b-ptr')
          await page.waitForFunction(() => !(window as any).__el('v-ptr'), null, { timeout: 4000 })
          await page.waitForFunction(() => { const m = (window as any).__move; return m.add - m.rem === 0 }, null, { timeout: 3000 })
        }
        assert.equal(await page.evaluate(() => (window as any).__move.add), 2, 'posé une fois par pose, jamais deux')
      })

      it('@transition=*iris(origin: pointer) : l\'ouverture part du point où la souris vient de cliquer ; la transition finie, rien ne reste', async function () {
        if (!present) { this.skip(); return }
        const button = await page.evaluate(() => { const r = (window as any).__el('b-iris').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
        await page.mouse.move(button.x - 30, button.y - 5)
        await page.mouse.move(button.x - 3, button.y + 2)
        await page.mouse.click(button.x - 3, button.y + 2)
        await page.waitForFunction(() => { const e = (window as any).__el('v-iris'); return !!e && /^inset\(/.test(getComputedStyle(e).clipPath) }, null, { timeout: 4000 })
        const read = await page.evaluate(() => { const e = (window as any).__el('v-iris'); const r = e.getBoundingClientRect(); return { clip: getComputedStyle(e).clipPath, left: r.left, top: r.top, width: r.width, height: r.height } })
        const [insetTop, insetRight, insetBottom, insetLeft] = (read.clip.match(/-?\d+(?:\.\d+)?/g) as string[]).map(Number)
        // la fenêtre s'ouvre depuis le point du clic : les marges se répartissent comme le point dans la boîte
        const ox = (button.x - 3 - read.left) / read.width
        const oy = (button.y + 2 - read.top) / read.height
        assert.ok(ox < 0 && oy < 0, 'le bouton est à gauche et au-dessus de la balise')
        // le clic est hors de la balise : l'ouverture part du coin le plus proche, jamais de l'extérieur (où rien ne se verrait)
        assert.equal(insetLeft, 0, 'aucune marge à gauche : l\'ouverture part du bord gauche')
        assert.equal(insetTop, 0, 'aucune marge en haut : l\'ouverture part du bord haut')
        assert.ok(insetRight > 0 && Math.abs(insetRight - insetBottom) < 0.01, `les marges de droite (${insetRight}) et du bas (${insetBottom}) se referment ensemble`)
        await page.waitForFunction(() => getComputedStyle((window as any).__el('v-iris')).clipPath === 'none', null, { timeout: 8000 })
        assert.equal(await page.evaluate(() => (window as any).__el('v-iris').getAnimations().length), 0)
        assert.equal(await page.evaluate(() => (window as any).__el('v-iris').hasAttribute('style')), false)
      })

      it('des réglages tenus par des variables (start, angle, shape, size) : la paire se refait à chaque changement, l\'état tenu avant l\'arrivée les suit', async function () {
        if (!present) { this.skip(); return }
        const change = (k: string, v: any) => page.evaluate(([n, x]: [string, any]) => new Promise((ok) => {
          (window as any).µ._set(document.querySelector('mjs-vue-transitions'), n, x)
          requestAnimationFrame(() => requestAnimationFrame(() => ok(true)))
        }), [k, v])
        const clip = async () => numbers(await page.evaluate(() => (window as any).__css('e-tenu').clip))
        // la balise est tenue dans l'état de départ de son entrée, que `on: success` n'a pas encore jouée
        await change('s', 0.6)
        near(await clip(), opening(0.6, 10), 'start 0,6, angle 10')
        await change('s', 0.3)
        near(await clip(), opening(0.3, 10), 'start 0,3')
        await change('g', -30)
        near(await clip(), opening(0.3, -30), 'angle -30')
        await change('k', 'ellipse')
        assert.equal((await clip()).length / 2, 96, 'un ovale penché : 96 sommets')
        await change('k', 'diamond')
        assert.equal((await clip()).length / 2, 4, 'un losange penché : 4 sommets')
        await change('k', 'box')
        near(await clip(), opening(0.3, -30), 'retour à la boîte')
        // la mosaïque tenue n'a rien à l'écran tant qu'elle attend ; son carreau suit la variable, la réussite la joue à la taille écrite
        await change('z', 100)
        assert.equal(await page.evaluate(() => (window as any).__svgs()), 0, 'tenue : ni <svg>, ni filtre')
        await page.evaluate(() => (window as any).__el('e-tenu-px').dispatchEvent(new CustomEvent('mjs:success')))
        await page.waitForFunction(() => (window as any).__rayon('e-tenu-px') === 50, null, { timeout: 4000 })
      })

      it('aucune erreur de page', function () {
        if (!present) { this.skip(); return }
        assert.deepEqual(errors, [])
      })
    })
  }
})
