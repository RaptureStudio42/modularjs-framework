// <@@select> : le panneau défile jusqu'à la ligne qu'on doit voir, avec de vraies touches et une vraie souris, dans Chromium, Firefox et WebKit réels (le défilement
// ne se teste pas en happy-dom), en développement comme avec un vrai build de production (avec, puis sans, le morceau « Autre »).
// - à l'ouverture, le panneau montre l'option choisie (la première choisie en `multiple`), qui est aussi la ligne active, vers le bas comme vers le haut ;
// - au clavier (flèches, Début, Fin), la ligne active reste visible, au plus près : le panneau ne défile que du nécessaire, sous le champ de recherche collant,
//   et le titre d'un groupe se montre avec sa première ligne ;
// - pendant une recherche, la ligne active (la première du résultat) reste visible aussi, même après un défilement à la molette ;
// - la page ne défile jamais, et la souris ne fait pas défiler le panneau.
// Toutes les mesures sont des rectangles lus dans la page (aucun test de vitesse).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const COUNT = 90

const options = (prefix: string, key: string, count: number) => Array.from({ length: count }, (_, i) => `<@@option value="${key}${i + 1}">${prefix}${i + 1}</@@option>`).join('')

const LONG   = options('Option ', 'o', COUNT)
const GROUPS = ['A', 'B', 'C'].map((g) => `<@@optgroup label="Groupe ${g}">${options(g, g.toLowerCase(), 20)}</@@optgroup>`).join('')

// les listes du haut s'ouvrent vers le bas, celles du bas vers le haut (moins de 280 px sous elles), celle du milieu est agrandie par une transformation ; la page, elle, est plus haute que la fenêtre
const hostSource = (withOther: boolean) => `<div class="zone c1"><@@select class="simple" name="simple" value="o25">${LONG}</@@select></div>
<div class="zone c2"><@@select class="search" name="search" search value="o70">${LONG}</@@select></div>
<div class="zone c3"><@@select class="multiple" name="multiple" multiple value={['o40', 'o70']}>${LONG}</@@select></div>
<div class="zone c4"><@@select class="groups" name="groups" value="c10">${GROUPS}</@@select></div>
<div class="zone b1"><@@select class="up" name="up" value="o30">${LONG}</@@select></div>
<div class="zone b2"><@@select class="mouse" name="mouse">${LONG}</@@select></div>
<div class="zone s1"><@@select class="scaled" name="scaled" value="o25">${LONG}</@@select></div>${withOther ? `
<div class="zone b3"><@@select class="free" name="free" other>${LONG}</@@select></div>` : ''}

<style>
  .zone
    position: fixed
    width: 200px
  .c1, .b1
    left: 20px
  .c2, .b2
    left: 240px
  .c3, .b3
    left: 460px
  .c4
    left: 680px
  .c1, .c2, .c3, .c4
    top: 20px
  .b1, .b2, .b3
    top: 400px
  .s1
    left: 20px
    top: 220px
    transform: scale(1.4)
    transform-origin: 0 0
</style>
`

type Scenario = { name: string; build: 'dev' | 'prod'; other: boolean }

const SCENARIOS: Scenario[] = [
  { name: 'développement', build: 'dev', other: true },
  { name: 'production, une page écrit other', build: 'prod', other: true },
  { name: 'production, aucune page n\'écrit other', build: 'prod', other: false }
]

type Built = { dev: string; prod: Record<'with' | 'without', Map<string, Buffer>> }
let built: Promise<Built> | null = null

// le script de développement et les deux builds de production, une seule fois pour les trois navigateurs
function build(): Promise<Built> {
  built ??= (async () => {
    const root = mjsTmp('select-defilement')
    const compile = async (name: string, source: string, opts: Record<string, unknown>) => {
      const srcDir = join(root, name, 'src')
      const outDir = join(root, name, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return outDir
    }
    const devDir = await compile('dev', hostSource(true), {})
    const files  = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const order  = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const dev    = order.map((f) => stripEsm(readFileSync(join(devDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(devDir, 'bundle.js'))
    const prod: Built['prod'] = { with: new Map(), without: new Map() }
    for (const [key, other] of [['with', true], ['without', false]] as const) {
      const dir = await compile(`prod-${key}`, hostSource(other), { runtime: ['hydrate'], js: 'split', env: 'prod' })
      for (const f of readdirSync(dir)) if (/\.(js|json)$/.test(f)) prod[key].set(f, readFileSync(join(dir, f)))
      const chunk = [...prod[key].keys()].find((f) => /^core-select-/.test(f))
      assert.ok(chunk, 'le build de production sépare un morceau par module')
      assert.equal(/select-other-edit/.test(prod[key].get(chunk!)!.toString('utf-8')), other, other ? 'une page écrit other : le morceau « Autre » est là' : 'aucune page n\'écrit other : le morceau « Autre » est retiré')
    }
    return { dev, prod }
  })()
  return built
}

for (const name of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> — défilement du panneau (${name} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let content = ''
  let made: Built
  let current: Scenario = SCENARIOS[0]
  const errors: string[] = []

  const read  = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const shell = (cls: string) => `__q('.${cls}')._shadow`
  const state = (cls: string, key: string) => read(`__q('.${cls}')._state.${key}`)
  const panel = (cls: string) => `${shell(cls)}.querySelector('.select-panel')`

  // ce qui se voit d'une ligne (l'active ou la choisie) : dans la partie visible du panneau, sous le champ de recherche collant, ET dans la fenêtre ;
  // `top` et `bottom` sont les distances de la ligne (avec le titre de son groupe s'il la précède) aux bords de la partie visible
  const measure = (cls: string, which = 'active') => read(`(() => {
    const sh = ${shell(cls)}, pan = sh.querySelector('.select-panel'), row = sh.querySelector('.select-option.${which}')
    if (!pan || !row) return { seen: false, titleSeen: false, text: null, top: null, bottom: null, scrolled: pan ? pan.scrollTop : null }
    const pr = pan.getBoundingClientRect(), r = row.getBoundingClientRect(), sticky = sh.querySelector('.select-search')
    const k = pr.height / pan.offsetHeight, visibleTop = pr.top + (pan.clientTop + (sticky ? sticky.offsetHeight : 0)) * k, visibleBottom = pr.top + (pan.clientTop + pan.clientHeight) * k
    const lead = row.previousElementSibling, title = lead && lead.classList.contains('select-group-label') ? lead.getBoundingClientRect() : null
    const inside = (b) => b.top >= visibleTop - 1 && b.bottom <= visibleBottom + 1 && b.top >= -1 && b.bottom <= innerHeight + 1
    return { seen: inside(r), titleSeen: title ? inside(title) : true, text: row.querySelector('.select-option-label').textContent.trim(), top: (title || r).top - visibleTop, bottom: visibleBottom - r.bottom, scrolled: pan.scrollTop }
  })()`)

  const activeIs = (cls: string, text: string) => `(() => { const r = ${shell(cls)}.querySelector('.select-option.active'); return !!r && r.querySelector('.select-option-label').textContent.trim() === ${JSON.stringify(text)} })()`

  // la liste prend le focus du clavier comme après un Tab, puis la flèche basse l'ouvre sur l'option choisie
  async function open(cls: string) {
    await page.evaluate(`${shell(cls)}.querySelector('.select-btn').focus()`)
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(`!!${panel(cls)} && !!${shell(cls)}.querySelector('.select-option.active')`, null, { timeout: 30000 })
    if (await read(`!!${shell(cls)}.querySelector('.select-search')`)) await page.waitForFunction(`${shell(cls)}.activeElement === ${shell(cls)}.querySelector('.select-search')`, null, { timeout: 30000 })
  }

  // un clic dans un coin vide de la page referme toute liste ouverte et laisse le pointeur hors des panneaux
  async function closeAll() {
    await page.mouse.click(895, 695)
    await page.waitForFunction(`Array.from(document.querySelector('mjs-hote')._shadow.querySelectorAll('mjs-core-select')).every((s) => s._shadow && !s._shadow.querySelector('.select-panel'))`, null, { timeout: 30000 })
  }

  // une touche, puis la mesure de la ligne qui doit être devenue l'active ; `moved` dit si le panneau a défilé
  async function step(cls: string, key: string, text: string) {
    const before = await read(`${panel(cls)}.scrollTop`)
    await page.keyboard.press(key)
    await page.waitForFunction(activeIs(cls, text), null, { timeout: 30000 })
    const m = await measure(cls)
    return { ...m, moved: m.scrolled !== before }
  }

  // une suite de pas : la ligne attendue est visible à chaque pas, et quand le panneau défile, la ligne touche le bord vers lequel on va
  async function walk(cls: string, key: 'ArrowDown' | 'ArrowUp', texts: string[]) {
    for (const text of texts) {
      const m = await step(cls, key, text)
      const dit = `${cls}, ${key} → « ${text} » : ${JSON.stringify(m)}`
      assert.ok(m.seen, `la ligne active est hors de vue — ${dit}`)
      assert.ok(m.titleSeen, `le titre du groupe est hors de vue — ${dit}`)
      if (m.moved) assert.ok(Math.abs(key === 'ArrowDown' ? m.bottom : m.top) < 1.5, `le panneau a défilé plus que nécessaire — ${dit}`)
    }
  }

  const numbers = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + (to >= from ? i : -i))
  const labels  = (from: number, to: number) => numbers(from, to).map((n) => `Option ${n}`)

  async function load(sc: Scenario) {
    current = sc
    const script = sc.build === 'dev' ? `<script>${made.dev}</script>` : '<script type="module" src="/out/bundle.js"></script>'
    content = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body { margin: 0; min-height: 3000px }</style></head><body><mjs-hote></mjs-hote>\n${script}</body></html>`
    errors.length = 0
    await page.goto('http://select.test/page', { waitUntil: 'load' })
    const expected = 7 + (sc.other ? 1 : 0)
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-select')) : []
      return m.length === ${expected} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.querySelector('.select-btn'))
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.waitForTimeout(400)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[name].executablePath())
    if (!present) return
    made    = await build()
    browser = await playwright[name].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => errors.push(String(e.message).slice(0, 200)))
    await page.route('http://select.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/out/')) {
        const body = made.prod[current.other ? 'with' : 'without'].get(url.pathname.slice(5))
        if (!body) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: content })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const sc of SCENARIOS) describe(sc.name, function () {
    before(async function () {
      if (!present) { this.skip(); return }
      await load(sc)
    })

    // chaque cas part d'une page au repos : aucune liste ouverte, la page en haut
    beforeEach(async function () {
      if (!present) return
      await page.evaluate('window.scrollTo(0, 0)')
      await closeAll()
    })

    // le script de développement est collé dans la page : son manifeste tente d'importer ses morceaux, qui n'existent pas à part (comme dans les tests voisins)
    afterEach(function () {
      if (present) assert.deepEqual(errors.filter((e) => sc.build === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('à l\'ouverture, le panneau montre l\'option choisie, qui est la ligne active : liste simple, avec recherche, groupée, ouverte vers le haut', async function () {
      if (!present) { this.skip(); return }
      for (const [cls, text, index] of [['simple', 'Option 25', 24], ['search', 'Option 70', 69], ['groups', 'C10', 49], ['up', 'Option 30', 29]] as const) {
        await open(cls)
        const chosen = await measure(cls, 'selected')
        assert.equal(chosen.text, text, `${cls} : l'option choisie`)
        assert.ok(chosen.seen, `${cls} : « ${text} » est hors de la partie visible du panneau — ${JSON.stringify(chosen)}`)
        assert.equal(await state(cls, 'activeIndex'), index, `${cls} : la ligne active est l'option choisie`)
        const active = await measure(cls)
        assert.equal(active.text, text, `${cls} : la ligne active est visible`)
        assert.ok(active.seen, `${cls} : la ligne active est hors de vue — ${JSON.stringify(active)}`)
        await closeAll()
      }
    })

    it('ouverte à la souris, la liste montre aussi l\'option choisie', async function () {
      if (!present) { this.skip(); return }
      for (const [cls, text] of [['simple', 'Option 25'], ['search', 'Option 70']] as const) {
        const spot = await read(`(() => { const r = ${shell(cls)}.querySelector('.select-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
        await page.mouse.click(spot.x, spot.y)
        await page.waitForFunction(activeIs(cls, text), null, { timeout: 30000 })
        const chosen = await measure(cls, 'selected')
        assert.equal(chosen.text, text, `${cls} : l'option choisie`)
        assert.ok(chosen.seen, `${cls} : « ${text} » est hors de la partie visible du panneau — ${JSON.stringify(chosen)}`)
        await closeAll()
      }
    })

    it('30 flèches bas : la ligne active est visible à chaque pas, et le panneau ne défile que du nécessaire', async function () {
      if (!present) { this.skip(); return }
      await open('simple')
      await walk('simple', 'ArrowDown', labels(26, 55))
      const bottom = (await measure('simple')).scrolled
      assert.ok(bottom > 0, 'sanity : le panneau a bien défilé')
    })

    it('liste ouverte vers le haut : les flèches bas puis haut gardent la ligne active en vue', async function () {
      if (!present) { this.skip(); return }
      await open('up')
      assert.equal(await read(`${panel('up')}.classList.contains('up')`), true, 'sanity : le panneau est au-dessus de la liste')
      await walk('up', 'ArrowDown', labels(31, 50))
      await walk('up', 'ArrowUp', labels(49, 20))
    })

    it('sous une transformation (échelle 1,4), la ligne active reste en vue, au plus près', async function () {
      if (!present) { this.skip(); return }
      await open('scaled')
      const ratio = await read(`(() => { const b = ${shell('scaled')}.querySelector('.select-btn'); return b.getBoundingClientRect().width / b.offsetWidth })()`)
      assert.ok(Math.abs(ratio - 1.4) < .02, `sanity : la liste est agrandie par un parent transformé (rapport ${ratio})`)
      const chosen = await measure('scaled', 'selected')
      assert.ok(chosen.seen, `la liste ouverte est hors de vue — ${JSON.stringify(chosen)}`)
      await walk('scaled', 'ArrowDown', labels(26, 45))
      await walk('scaled', 'ArrowUp', labels(44, 30))
    })

    it('Fin puis Début : la dernière, puis la première option sont visibles, et Début remet le panneau en haut', async function () {
      if (!present) { this.skip(); return }
      await open('simple')
      const last = await step('simple', 'End', 'Option 90')
      assert.ok(last.seen, `Fin : la dernière option est hors de vue — ${JSON.stringify(last)}`)
      assert.ok(Math.abs(last.bottom) < 1.5, `Fin : au plus près, le bas de la ligne touche le bas du panneau — ${JSON.stringify(last)}`)
      assert.ok(last.scrolled > 0, 'sanity : le panneau a défilé')
      const first = await step('simple', 'Home', 'Option 1')
      assert.ok(first.seen, `Début : la première option est hors de vue — ${JSON.stringify(first)}`)
      assert.equal(first.scrolled, 0, 'Début : le panneau revient en haut')
    })

    it('30 flèches haut depuis la fin : la ligne active est visible à chaque pas, aussi sous le champ de recherche collant', async function () {
      if (!present) { this.skip(); return }
      for (const cls of ['simple', 'search']) {
        await open(cls)
        await step(cls, 'End', 'Option 90')
        await walk(cls, 'ArrowUp', labels(89, 60))
        await closeAll()
      }
    })

    it('recherche : après un défilement à la molette, une saisie remet la première ligne du résultat en vue, et les flèches la suivent', async function () {
      if (!present) { this.skip(); return }
      await open('search')
      await page.evaluate(`(() => { const p = ${panel('search')}; p.scrollTop = p.scrollHeight })()`)
      await page.keyboard.type('option')
      await page.waitForFunction(activeIs('search', 'Option 1'), null, { timeout: 30000 })
      const first = await measure('search')
      assert.ok(first.seen, `la première ligne du résultat est hors de vue — ${JSON.stringify(first)}`)
      assert.equal(first.scrolled, 0, 'le panneau revient en haut')
      await walk('search', 'ArrowDown', labels(2, 20))
      await page.evaluate(`(() => { const s = ${shell('search')}.querySelector('.select-search'); s.select() })()`)
      await page.keyboard.type('5')
      const withFive = numbers(1, COUNT).filter((n) => String(n).includes('5'))
      await page.waitForFunction(activeIs('search', `Option ${withFive[0]}`), null, { timeout: 30000 })
      const filtered = await measure('search')
      assert.ok(filtered.seen, `le premier résultat de « 5 » est hors de vue — ${JSON.stringify(filtered)}`)
      await walk('search', 'ArrowDown', withFive.slice(1, 14).map((n) => `Option ${n}`))
      await walk('search', 'ArrowUp', withFive.slice(0, 13).reverse().map((n) => `Option ${n}`))
    })

    it('choix multiple : le panneau montre la première option choisie, qui est la ligne active, et les flèches partent de là sans rien cocher', async function () {
      if (!present) { this.skip(); return }
      await open('multiple')
      const chosen = await measure('multiple', 'selected')
      assert.equal(chosen.text, 'Option 40', 'la première option choisie')
      assert.ok(chosen.seen, `la première option choisie est hors de vue — ${JSON.stringify(chosen)}`)
      assert.equal(await state('multiple', 'activeIndex'), 39, 'la ligne active est la première option choisie')
      await walk('multiple', 'ArrowDown', labels(41, 60))
      const last = await step('multiple', 'End', 'Option 90')
      assert.ok(last.seen, `Fin : la dernière option est hors de vue — ${JSON.stringify(last)}`)
      assert.deepEqual(await state('multiple', 'value'), ['o40', 'o70'], 'aucune option cochée ni décochée')
    })

    it('liste groupée : le titre d\'un groupe se montre avec sa première ligne, en montant comme avec Début', async function () {
      if (!present) { this.skip(); return }
      await open('groups')
      const downs = Array.from({ length: 10 }, (_, i) => `C${11 + i}`)
      await walk('groups', 'ArrowDown', downs)
      const ups = [...Array.from({ length: 19 }, (_, i) => `C${19 - i}`), ...Array.from({ length: 20 }, (_, i) => `B${20 - i}`), 'A20']
      await walk('groups', 'ArrowUp', ups)
      const first = await step('groups', 'Home', 'A1')
      assert.ok(first.seen && first.titleSeen, `Début : la première option et le titre de son groupe se voient — ${JSON.stringify(first)}`)
      assert.equal(first.scrolled, 0, 'Début : le panneau revient en haut')
    })

    it('la page ne défile jamais : ni à l\'ouverture, ni aux flèches, ni à Fin et Début, ni à la saisie', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate('window.scrollTo(0, 150)')
      assert.equal(await read('window.scrollY'), 150, 'sanity : la page est défilée de 150 px')
      await open('simple')
      await walk('simple', 'ArrowDown', labels(26, 45))
      await step('simple', 'End', 'Option 90')
      await step('simple', 'Home', 'Option 1')
      assert.equal(await read('window.scrollY'), 150, 'liste simple : la page n\'a pas bougé')
      await closeAll()
      await page.evaluate('window.scrollTo(0, 150)')
      await open('search')
      await page.keyboard.type('5')
      await page.waitForFunction(activeIs('search', 'Option 5'), null, { timeout: 30000 })
      await walk('search', 'ArrowDown', ['Option 15', 'Option 25', 'Option 35', 'Option 45'])
      assert.equal(await read('window.scrollY'), 150, 'liste avec recherche : la page n\'a pas bougé')
      assert.ok((await measure('search')).scrolled >= 0)
    })

    it('la souris ne fait pas défiler le panneau : survoler une ligne coupée par le bas du panneau la rend active sans rien bouger', async function () {
      if (!present) { this.skip(); return }
      await open('mouse')
      const target = await read(`(() => {
        const sh = ${shell('mouse')}, pan = sh.querySelector('.select-panel'), pr = pan.getBoundingClientRect()
        const bottom = pr.top + pan.clientTop + pan.clientHeight
        const rows = Array.from(sh.querySelectorAll('.select-option'))
        const i = rows.findIndex((r) => r.getBoundingClientRect().bottom > bottom + 1)
        const r = rows[i].getBoundingClientRect()
        return { i, x: r.left + r.width / 2, y: (r.top + bottom) / 2, cut: r.bottom - bottom }
      })()`)
      assert.ok(target.i > 0 && target.cut > 2, `sanity : une ligne est coupée par le bas du panneau — ${JSON.stringify(target)}`)
      await page.mouse.move(target.x, target.y)
      await page.waitForFunction(`__q('.mouse')._state.activeIndex === ${target.i}`, null, { timeout: 30000 })
      await page.waitForTimeout(400)
      assert.equal(await read(`${panel('mouse')}.scrollTop`), 0, 'le survol n\'a pas fait défiler le panneau')
      assert.equal(await state('mouse', 'activeIndex'), target.i, 'la ligne survolée est restée l\'active')
    })

    it('un pointeur immobile sur le panneau ne reprend pas la ligne active quand le clavier fait défiler : chaque flèche avance d\'une ligne', async function () {
      if (!present) { this.skip(); return }
      await open('simple')
      const spot = await read(`(() => { const pr = ${panel('simple')}.getBoundingClientRect(); return { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 } })()`)
      await page.mouse.move(spot.x, spot.y)
      await page.waitForTimeout(300)
      let expected = await state('simple', 'activeIndex') as number
      const start  = expected
      for (let k = 0; k < 20; k++) {
        expected++
        await page.keyboard.press('ArrowDown')
        await page.waitForFunction(`__q('.simple')._state.activeIndex === ${expected}`, null, { timeout: 30000 })
        await page.waitForTimeout(150)
        assert.equal(await state('simple', 'activeIndex'), expected, `la ligne sous le pointeur a repris la ligne active à la ${k + 1}e flèche (départ ${start})`)
      }
      assert.ok((await measure('simple')).seen, 'la ligne active est visible')
    })

    if (sc.other) it('« Autre… » : Fin amène la ligne « Autre… » en vue, et Début la première option', async function () {
      if (!present) { this.skip(); return }
      await open('free')
      await page.keyboard.press('End')
      await page.waitForFunction(`!!${shell('free')}.querySelector('.select-option.select-other.active')`, null, { timeout: 30000 })
      const other = await read(`(() => {
        const sh = ${shell('free')}, pan = sh.querySelector('.select-panel'), pr = pan.getBoundingClientRect(), r = sh.querySelector('.select-option.select-other.active').getBoundingClientRect()
        return { seen: r.top >= pr.top + pan.clientTop - 1 && r.bottom <= pr.top + pan.clientTop + pan.clientHeight + 1 && r.bottom <= innerHeight + 1, scrolled: pan.scrollTop }
      })()`)
      assert.ok(other.seen, `Fin : la ligne « Autre… » est hors de vue — ${JSON.stringify(other)}`)
      assert.ok(other.scrolled > 0, 'sanity : le panneau a défilé')
      const first = await step('free', 'Home', 'Option 1')
      assert.ok(first.seen, `Début : la première option est hors de vue — ${JSON.stringify(first)}`)
      assert.equal(first.scrolled, 0, 'Début : le panneau revient en haut')
    })
  })
})
