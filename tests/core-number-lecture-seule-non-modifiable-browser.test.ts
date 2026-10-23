// <@@number readonly>, comme <input type="number" readonly> : la valeur se lit, se sélectionne et part avec le formulaire, mais personne ne la
// change — ni la frappe, ni les flèches, Page haut, Page bas, Début et Fin, ni « − » et « + » (clic, appui long, clic sans pointeur d'une aide
// technique), ni le grand pas, ni la molette ; la saisie prend le focus et dit sa lecture seule (`readonly`), « − » et « + » se disent inactifs ;
// `readonly="FALSE"` est ôté et le nombre reste modifiable ; posé plus tard, `readonly` le fige aussi. Dans l'arbre d'accessibilité de Chromium,
// un champ nombre natif en lecture seule n'est pas modifiable (`settable` absent) : la saisie du module se dit de même.
// Chromium, Firefox et WebKit réels, en développement comme avec un vrai build de production : de vrais clics, de vraies touches, un vrai envoi

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<form class="f" method="get" action="/envoi" @noUJS>
  <@@number class="nR" name="nR" value="5" min="0" max="10" label="Quantité lue" less-label="Moins lu" more-label="Plus lu" readonly></@@number>
  <@@number class="nG" name="nG" value="5" big readonly></@@number>
  <@@number class="nW" name="nW" value="5" min="0" max="10" label="Quantité libre" readonly="FALSE"></@@number>
  <@@number class="nL" name="nL" value="5" min="0" max="10"></@@number>
  <input type="number" class="natif" value="5" aria-label="Natif lu" readonly>
  <button type="submit" class="go">envoyer</button>
</form>
`

const AIDES = `(() => {
  window.__q  = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__sh = (c, s) => __q('.' + c)._shadow.querySelector(s)
  window.__lu = (c) => __sh(c, '.input').value + '|' + String(__q('.' + c)._state.value)
  window.__fd = () => Array.from(new FormData(__q('.f'))).map((p) => p[0] + '=' + p[1])
  window.__inactif = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true'
})()`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement (le cœur, les libellés du manifeste, les modules, l'hôte) et les morceaux du build de production, une seule
// fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('nombre-lecture-seule')
    const compiler = async (nom: string, opts: Record<string, unknown>, manifeste: string) => {
      const srcDir = join(root, nom, 'src')
      const outDir = join(root, nom, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste || join(outDir, 'bundle.js'), ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return outDir
    }
    const manifeste = join(root, 'dev', 'bundle.js')
    const dev       = assembler(await compiler('dev', {}, manifeste), manifeste)
    const prodDir   = await compiler('prod', { js: 'split', env: 'prod' }, '')
    const prod      = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) prod.set(f, readFileSync(join(prodDir, f)))
    assert.ok(prod.has('bundle.js') && [...prod.keys()].some((f) => /^core-number-/.test(f)), 'le build de production sépare un morceau par module')
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@number readonly>, comme un champ nombre natif en lecture seule (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let build: 'dev' | 'prod' = 'dev'
  const envois: string[]  = []
  const erreurs: string[] = []

  const lire  = (expr: string) => page.evaluate(expr)
  const pause = (ms = 200) => page.waitForTimeout(ms)

  // le centre de l'élément que donne l'expression, à l'écran
  async function centre(expr: string) {
    return page.evaluate(`(() => {
      const el = ${expr}
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
  }

  async function cliquer(expr: string) {
    const p = await centre(expr)
    await page.mouse.click(p.x, p.y)
    await pause(150)
  }

  async function presser(c: string, ...touches: string[]) {
    await page.evaluate(`__sh('${c}', '.input').focus()`)
    for (const t of touches) {
      await page.keyboard.press(t)
      await pause(100)
    }
  }

  async function charger() {
    await page.goto('http://nombre.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-number')) : []
      return m.length === 4 && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.querySelector('.input'))
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(AIDES)
    await pause(300)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.route('http://nombre.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/envoi') {
        envois.push(url.search)
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
        return
      }
      if (url.pathname.startsWith('/out/')) {
        const corps = fait.prod.get(url.pathname.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      const script = build === 'dev' ? `<script>${fait.dev.replace(/<\/script/gi, '<\\/script')}</script>` : '<script type="module" src="/out/bundle.js"></script>'
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote>${script}</body></html>` })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const b of ['dev', 'prod'] as const) describe(b === 'dev' ? 'développement' : 'production', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      build          = b
      envois.length  = 0
      erreurs.length = 0
      await charger()
    })

    // le script de développement est collé dans la page : son manifeste peut tenter d'importer des morceaux qui n'existent pas à part
    afterEach(function () {
      if (present) assert.deepEqual(erreurs.filter((e) => b === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('ni la frappe, ni les flèches, Page haut, Page bas, Début, Fin, ni « − » et « + » (clic, appui long, clic d\'une aide technique), ni le grand pas, ni la molette ne changent la valeur ; la saisie prend le focus et se sélectionne ; la valeur part avec le formulaire', async function () {
      assert.equal(await lire(`__lu('nR')`), '5|5', 'départ')
      assert.equal(await lire(`__q('.nR').willValidate`), false, 'hors de la validation, comme un champ nombre natif en lecture seule')
      const champ = await centre(`__sh('nR', '.input')`)
      await cliquer(`__sh('nR', '.input')`)
      assert.equal(await lire(`__q('.nR')._shadow.activeElement === __sh('nR', '.input')`), true, 'un clic donne le focus à la saisie')
      await page.keyboard.type('7')
      await pause()
      assert.equal(await lire(`__lu('nR')`), '5|5', 'la frappe ne change rien')
      await presser('nR', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End')
      assert.equal(await lire(`__lu('nR')`), '5|5', 'flèches, Page haut, Page bas, Début, Fin : rien')
      await page.mouse.dblclick(champ.x, champ.y)
      await pause()
      assert.deepEqual(await lire(`[__sh('nR', '.input').selectionStart, __sh('nR', '.input').selectionEnd, __lu('nR')]`), [0, 1, '5|5'], 'un double clic sélectionne le texte, sans rien changer')
      await cliquer(`__sh('nR', '.step.more')`)
      await cliquer(`__sh('nR', '.step.less')`)
      assert.equal(await lire(`__lu('nR')`), '5|5', 'clic sur « + » et « − » : rien')
      const plus = await centre(`__sh('nR', '.step.more')`)
      await page.mouse.move(plus.x, plus.y)
      await page.mouse.down()
      await pause(900)
      await page.mouse.up()
      await pause()
      assert.equal(await lire(`__lu('nR')`), '5|5', 'appui long sur « + » : rien')
      await page.evaluate(`__sh('nR', '.step.more').click(); __sh('nR', '.step.less').click()`)
      await pause()
      assert.equal(await lire(`__lu('nR')`), '5|5', 'le clic sans pointeur d\'une aide technique : rien')
      await cliquer(`__sh('nG', '.step.more.big')`)
      await cliquer(`__sh('nG', '.step.less.big')`)
      await presser('nG', 'PageUp', 'ArrowUp')
      assert.equal(await lire(`__lu('nG')`), '5|5', 'le grand pas non plus')
      await page.mouse.move(champ.x, champ.y)
      await page.mouse.wheel(0, -300)
      await pause(300)
      assert.equal(await lire(`__lu('nR')`), '5|5', 'la molette : rien')
      assert.deepEqual(await lire(`__fd()`), ['nR=5', 'nG=5', 'nW=5', 'nL=5'], 'la valeur part avec le formulaire')
      await cliquer(`__q('.go')`)
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.deepEqual(envois, ['?nR=5&nG=5&nW=5&nL=5'], 'le vrai envoi')
    })

    it('il dit sa lecture seule : la saisie porte readonly, « − », « + » et le grand pas se disent inactifs (et dans l\'arbre d\'accessibilité de Chromium)', async function () {
      assert.deepEqual(await lire(`['nR', 'nG'].map((c) => __sh(c, '.input').readOnly)`), [true, true], 'readonly sur la saisie')
      assert.deepEqual(await lire(`['nR', 'nG'].map((c) => Array.from(__q('.' + c)._shadow.querySelectorAll('.step')).map(__inactif))`), [[true, true], [true, true, true, true]], '« − », « + », « −− » et « ++ » inactifs')
      assert.deepEqual(await lire(`['nW', 'nL'].map((c) => [__sh(c, '.input').readOnly, Array.from(__q('.' + c)._shadow.querySelectorAll('.step')).map(__inactif)])`), [[false, [false, false]], [false, [false, false]]], 'sans readonly, rien de tout cela')
      if (nom === 'chromium') {
        const cdp = await page.context().newCDPSession(page)
        const { nodes } = await cdp.send('Accessibility.getFullAXTree')
        const prop = (n: any, k: string) => n?.properties?.find((p: any) => p.name === k)?.value?.value
        const noeud = (role: string, nomAx: string) => nodes.find((n: any) => !n.ignored && n.role?.value === role && n.name?.value === nomAx)
        assert.ok(noeud('spinbutton', 'Quantité lue') && noeud('spinbutton', 'Natif lu'), 'les deux saisies sont dans l\'arbre')
        assert.equal(prop(noeud('spinbutton', 'Natif lu'), 'settable'), undefined, 'le champ natif en lecture seule n\'est pas modifiable')
        assert.equal(prop(noeud('spinbutton', 'Quantité lue'), 'settable'), undefined, 'la saisie du module non plus')
        assert.equal(prop(noeud('spinbutton', 'Quantité libre'), 'settable'), true, 'sans readonly, elle l\'est')
        for (const bouton of ['Moins lu', 'Plus lu']) assert.equal(prop(noeud('button', bouton), 'disabled'), true, bouton + ' se dit inactif')
        await cdp.detach()
      }
    })

    it('readonly="FALSE" est ôté, le nombre reste modifiable ; posé plus tard, readonly le fige', async function () {
      assert.equal(await lire(`__q('.nW').hasAttribute('readonly')`), false, '« FALSE » ôté de la balise')
      await presser('nW', 'ArrowUp')
      assert.equal(await lire(`__lu('nW')`), '6|6', 'la flèche change la valeur')
      await presser('nL', 'ArrowUp')
      assert.equal(await lire(`__lu('nL')`), '6|6', 'modifiable avant')
      await page.evaluate(`__q('.nL').setAttribute('readonly', '')`)
      await pause()
      await presser('nL', 'ArrowUp', 'PageUp', 'End')
      await cliquer(`__sh('nL', '.step.more')`)
      assert.equal(await lire(`__lu('nL')`), '6|6', 'figé après')
      assert.equal(await lire(`__sh('nL', '.input').readOnly`), true)
      assert.deepEqual(await lire(`__fd()`), ['nR=5', 'nG=5', 'nW=6', 'nL=6'], 'les deux valeurs partent')
    })
  })
})
