// `required`, `disabled` et `readonly` des modules de formulaire du cœur, comme sur le champ natif que chacun remplace :
// - `required` ôté par un script : la case, l'interrupteur, le radio et le nombre ne sont plus obligatoires, comme le champ natif ; remis, ils
//   le redeviennent
// - `disabled={$x ? true : null}` avec `$x` faux laisse le bouton rotatif et la jauge actifs (null = absent) ; `$x` vrai les désactive
// - `readonly={$x}` posé en prop sur la case, l'interrupteur, le radio, le bouton rotatif et la jauge est suivi comme l'attribut écrit sur la
//   balise : `$x` vrai, hors de la validation ; faux, de nouveau validés ; la liste reste validée, comme `<select>`, qui ignore `readonly`
// Chromium, Firefox et WebKit réels, en développement comme avec un vrai build de production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const OPT  = '<@@option value="">-</@@option><@@option value="a">A</@@option>'
const PAGE = `<script>
  $verrou  = false
  $lecture = true
</script>

<form class="f1" method="get" action="/envoi" @noUJS>
  <@@checkbox class="c" name="c" required>c</@@checkbox>
  <@@switch class="w" name="w" required>w</@@switch>
  <@@radio class="r" name="r" value="1" required>r</@@radio>
  <@@number class="n" name="n" required></@@number>
  <input type="checkbox" class="xc" required aria-label="xc">
  <input type="checkbox" role="switch" class="xw" required aria-label="xw">
  <input type="radio" class="xr" name="xr" value="1" required aria-label="xr">
  <input type="number" class="xn" required aria-label="xn">
</form>

<form class="f2" method="get" action="/envoi" @noUJS>
  <@@knob class="k" name="k" disabled={$verrou ? true : null}></@@knob>
  <@@gauge class="g" name="g" disabled={$verrou ? true : null}></@@gauge>
</form>

<form class="f3" method="get" action="/envoi" @noUJS>
  <@@checkbox class="lc" name="lc" required readonly={$lecture}>c</@@checkbox>
  <@@switch class="lw" name="lw" required readonly={$lecture}>w</@@switch>
  <@@radio class="lr" name="lr" value="1" required readonly={$lecture}>r</@@radio>
  <@@knob class="lk" name="lk" readonly={$lecture}></@@knob>
  <@@gauge class="lg" name="lg" readonly={$lecture}></@@gauge>
  <@@select class="ls" name="ls" required readonly={$lecture}>${OPT}</@@select>
</form>
`

const MODULES = 'mjs-core-number, mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-knob, mjs-core-gauge, mjs-core-select'
const AIDES   = `(() => {
  window.__h  = () => document.querySelector('mjs-hote')
  window.__q  = (s) => __h()._shadow.querySelector(s)
  window.__sh = (c, s) => __q('.' + c)._shadow.querySelector(s)
  window.__va = (c) => { const e = __q('.' + c); return [e.willValidate, e.checkValidity(), e.validity.valueMissing] }
  window.__fd = (f) => Array.from(new FormData(__q('.' + f))).map((p) => p[0] + '=' + p[1])
})()`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement et les morceaux du build de production, une seule fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('formulaire-obligatoire-ote-lecture-liee')
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
    assert.ok(prod.has('bundle.js') && [...prod.keys()].some((f) => /^core-knob-/.test(f)), 'le build de production sépare un morceau par module')
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`required ôté, disabled à null et readonly lié des modules de formulaire, comme le champ natif (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let build: 'dev' | 'prod' = 'dev'
  const erreurs: string[] = []

  const lire  = (expr: string) => page.evaluate(expr)
  const pause = (ms = 200) => page.waitForTimeout(ms)

  async function presser(c: string, cible: string, ...touches: string[]) {
    await page.evaluate(`__sh('${c}', '${cible}').focus()`)
    for (const t of touches) {
      await page.keyboard.press(t)
      await pause(100)
    }
    await pause()
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.route('http://obligatoire.test/**', async (route: any) => {
      const url = new URL(route.request().url())
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
      erreurs.length = 0
      await page.goto('http://obligatoire.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => {
        const h = document.querySelector('mjs-hote')
        const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
        return m.length === 12 && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
      })()`, undefined, { timeout: 60000 })
      await page.evaluate(AIDES)
      await pause(300)
    })

    // le script de développement est collé dans la page : son manifeste peut tenter d'importer des morceaux qui n'existent pas à part
    afterEach(function () {
      if (present) assert.deepEqual(erreurs.filter((e) => b === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('required ôté par un script : la case, l\'interrupteur, le radio et le nombre ne sont plus obligatoires, comme le champ natif ; remis, ils le redeviennent', async function () {
      const paires: [string, string][] = [['c', 'xc'], ['w', 'xw'], ['r', 'xr'], ['n', 'xn']]
      const comparer = async (quand: string, attendu: boolean[]) => {
        for (const [m, x] of paires) {
          assert.deepEqual(await lire(`__va('${x}')`), attendu, `${x} ${quand} : [willValidate, checkValidity(), valueMissing]`)
          assert.deepEqual(await lire(`__va('${m}')`), attendu, `${m} ${quand}, comme ${x}`)
        }
      }
      await comparer('obligatoire', [true, false, true])
      await page.evaluate(`['c', 'w', 'r', 'n', 'xc', 'xw', 'xr', 'xn'].forEach((c) => __q('.' + c).removeAttribute('required'))`)
      await pause()
      await comparer('required ôté', [true, true, false])
      assert.equal(await lire(`__q('.f1').checkValidity()`), true, 'le formulaire part')
      await page.evaluate(`['c', 'w', 'r', 'n', 'xc', 'xw', 'xr', 'xn'].forEach((c) => __q('.' + c).setAttribute('required', ''))`)
      await pause()
      await comparer('required remis', [true, false, true])
    })

    it('disabled={$x ? true : null}, $x faux : le bouton rotatif et la jauge restent actifs, leurs valeurs partent ; $x vrai : désactivés', async function () {
      assert.deepEqual(await lire(`[__sh('k', '.knob').getAttribute('aria-disabled') === 'true', __sh('g', '.spinner').getAttribute('aria-disabled') === 'true', __fd('f2')]`), [false, false, ['k=50', 'g=0']], 'null : actifs')
      await presser('k', '.knob', 'ArrowRight')
      await presser('g', '.spinner', 'ArrowUp')
      assert.deepEqual(await lire(`[String(__q('.k')._state.value), String(__q('.g')._state.value), __fd('f2')]`), ['51', '1', ['k=51', 'g=1']], 'réglés')
      await page.evaluate(`__h()._set('verrou', true)`)
      await pause()
      assert.deepEqual(await lire(`[__sh('k', '.knob').getAttribute('aria-disabled') === 'true', __sh('g', '.spinner').getAttribute('aria-disabled') === 'true', __fd('f2')]`), [true, true, []], 'vrai : désactivés, rien ne part')
      await page.evaluate(`__h()._set('verrou', false)`)
      await pause()
      assert.deepEqual(await lire(`__fd('f2')`), ['k=51', 'g=1'], 'actifs de nouveau')
    })

    it('readonly={$x} sur la case, l\'interrupteur, le radio, le bouton rotatif et la jauge : suivi comme l\'attribut écrit sur la balise ; la liste reste validée', async function () {
      const etat = () => lire(`['lc', 'lw', 'lr', 'lk', 'lg', 'ls'].map((c) => [__q('.' + c).hasAttribute('readonly'), __q('.' + c).willValidate, __q('.' + c).checkValidity()])`)
      const fige = [[true, false, true], [true, false, true], [true, false, true], [true, false, true], [true, false, true], [false, true, false]]
      assert.deepEqual(await etat(), fige, '$x vrai au montage : hors de la validation (la liste, obligatoire et vide, reste invalide)')
      await page.evaluate(`__h()._set('lecture', false)`)
      await pause()
      assert.deepEqual(await etat(), [[false, true, false], [false, true, false], [false, true, false], [false, true, true], [false, true, true], [false, true, false]], '$x faux : de nouveau validés, la case, l\'interrupteur et le radio obligatoires manquent')
      await page.evaluate(`__h()._set('lecture', true)`)
      await pause()
      assert.deepEqual(await etat(), fige, '$x vrai de nouveau : hors de la validation')
    })
  })
})
