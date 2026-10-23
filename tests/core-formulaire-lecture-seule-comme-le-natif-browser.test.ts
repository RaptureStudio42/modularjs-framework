// `readonly` et `disabled` sur les modules de saisie du cœur, comme sur le champ natif que chacun remplace :
// - `readonly={$x ? true : null}` et `disabled={$x ? true : null}` avec `$x` faux laissent le nombre modifiable et actif (null = absent)
// - un nombre `required readonly={…}` vide, figé, sort de la validation : le formulaire part, comme avec `<input type="number" required readonly>`
// - la case, l'interrupteur, le radio, le bouton rotatif et la jauge en `readonly` sortent de la validation comme la case, le radio et la
//   glissière natifs (`willValidate` faux), sans rien changer à leur maniement ; la liste reste validée, comme `<select>`, qui ignore `readonly`
//   (Chromium donne `:valid` à tout élément associé hors de la validation, jamais à un champ natif : la balise suit la règle du moteur)
// - `readonly` et `disabled` posés puis ôtés par un script : le module suit l'attribut dans les deux sens, comme le champ natif
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

<form class="f2" method="get" action="/envoi" @noUJS>
  <@@number class="nN" name="nN" value="5" readonly={$verrou ? true : null}></@@number>
  <@@number class="nD" name="nD" value="5" disabled={$verrou ? true : null}></@@number>
</form>

<form class="f3" method="get" action="/envoi" @noUJS>
  <@@number class="nV" name="nV" required readonly={$lecture}></@@number>
  <button type="submit" class="go3">envoyer</button>
</form>

<form class="f4" method="get" action="/envoi" @noUJS>
  <@@checkbox class="c" name="c" required readonly>c</@@checkbox>
  <@@switch class="w" name="w" required readonly>w</@@switch>
  <@@radio class="r" name="r" value="1" required readonly>r</@@radio>
  <@@radio class="ra" name="q" value="1" required readonly>a</@@radio>
  <@@radio class="rb" name="q" value="2">b</@@radio>
  <@@knob class="k" name="k" readonly></@@knob>
  <@@gauge class="g" name="g" readonly></@@gauge>
  <@@select class="s" name="s" required readonly>${OPT}</@@select>
  <@@checkbox class="cF" name="cF" required readonly="FALSE">f</@@checkbox>
  <input type="checkbox" class="xc" required readonly aria-label="xc">
  <input type="checkbox" role="switch" class="xw" required readonly aria-label="xw">
  <input type="radio" class="xr" name="xr" value="1" required readonly aria-label="xr">
  <input type="radio" class="xra" name="xq" value="1" required readonly aria-label="xra">
  <input type="radio" class="xrb" name="xq" value="2" aria-label="xrb">
  <input type="range" class="xk" readonly aria-label="xk">
  <input type="range" class="xg" readonly aria-label="xg">
  <select class="xs" required readonly aria-label="xs"><option value="">-</option><option value="a">A</option></select>
</form>

<form class="f8" method="get" action="/envoi" @noUJS>
  <@@number class="nA" name="nA" value="5"></@@number>
  <@@checkbox class="cA" name="cA" value="oui" checked>a</@@checkbox>
</form>
`

const MODULES = 'mjs-core-number, mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-knob, mjs-core-gauge, mjs-core-select'
const AIDES   = `(() => {
  window.__h  = () => document.querySelector('mjs-hote')
  window.__q  = (s) => __h()._shadow.querySelector(s)
  window.__sh = (c, s) => __q('.' + c)._shadow.querySelector(s)
  window.__lu = (c) => __sh(c, '.input').value + '|' + String(__q('.' + c)._state.value)
  window.__va = (c) => { const e = __q('.' + c); return [e.willValidate, e.checkValidity(), e.matches(':invalid'), e.matches(':valid')] }
  window.__fd = (f) => Array.from(new FormData(__q('.' + f))).map((p) => p[0] + '=' + p[1])
})()`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement et les morceaux du build de production, une seule fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('formulaire-lecture-seule-natif')
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`readonly et disabled des modules de saisie, comme le champ natif (${nom} réel)`, function () {
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
    await page.route('http://lecture.test/**', async (route: any) => {
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
      await page.goto('http://lecture.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => {
        const h = document.querySelector('mjs-hote')
        const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
        return m.length === 14 && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
      })()`, undefined, { timeout: 60000 })
      await page.evaluate(AIDES)
      await pause(300)
    })

    // le script de développement est collé dans la page : son manifeste peut tenter d'importer des morceaux qui n'existent pas à part
    afterEach(function () {
      if (present) assert.deepEqual(erreurs.filter((e) => b === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('readonly={$x ? true : null} et disabled={$x ? true : null}, $x faux : le nombre reste modifiable et actif ; $x vrai : figé, désactivé', async function () {
      assert.deepEqual(await lire(`[__sh('nN', '.input').readOnly, __sh('nD', '.input').disabled]`), [false, false], 'null : attribut absent')
      await presser('nN', '.input', 'ArrowUp')
      await presser('nD', '.input', 'ArrowUp')
      assert.deepEqual(await lire(`[__lu('nN'), __lu('nD')]`), ['6|6', '6|6'], 'la flèche change les deux valeurs')
      await page.evaluate(`__h()._set('verrou', true)`)
      await pause()
      assert.deepEqual(await lire(`[__sh('nN', '.input').readOnly, __sh('nD', '.input').disabled]`), [true, true], 'vrai : figé, désactivé')
      await presser('nN', '.input', 'ArrowUp')
      assert.equal(await lire(`__lu('nN')`), '6|6', 'figé')
      await page.evaluate(`__h()._set('verrou', false)`)
      await pause()
      await presser('nN', '.input', 'ArrowUp')
      assert.deepEqual(await lire(`[__lu('nN'), __sh('nD', '.input').disabled]`), ['7|7', false], 'de nouveau modifiable et actif')
    })

    it('un nombre required readonly={…} vide sort de la validation : le formulaire part ; readonly levé, il redevient obligatoire', async function () {
      assert.deepEqual(await lire(`[__q('.nV').checkValidity(), __q('.f3').checkValidity(), __q('.nV').matches(':invalid')]`), [true, true, false], 'figé et vide : rien ne bloque')
      await page.evaluate(`__h()._set('lecture', false)`)
      await pause()
      assert.deepEqual(await lire(`[__q('.nV').checkValidity(), __q('.f3').checkValidity(), __q('.nV').validity.valueMissing]`), [false, false, true], 'modifiable : obligatoire de nouveau')
      await page.evaluate(`__h()._set('lecture', true)`)
      await pause()
      assert.equal(await lire(`__q('.f3').checkValidity()`), true, 'figé de nouveau : hors de la validation')
      await page.evaluate(`__q('.go3').click()`)
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.deepEqual(envois, ['?nV='], 'le vrai envoi part')
    })

    it('la case, l\'interrupteur, le radio, le bouton rotatif et la jauge en readonly sortent de la validation comme leur champ natif, la liste reste validée comme <select> ; « FALSE » est ôté', async function () {
      // `:valid` d'un élément associé quelconque hors de la validation : la règle du moteur (Chromium le lui donne, pas à un champ natif)
      const brut = await lire(`(() => {
        if (!customElements.get('x-brut')) customElements.define('x-brut', class extends HTMLElement { static formAssociated = true; constructor() { super(); this.i = this.attachInternals() } })
        const x = document.createElement('x-brut')
        x.setAttribute('readonly', '')
        __q('.f4').appendChild(x)
        const r = [x.i.willValidate, x.matches(':valid')]
        x.remove()
        return r
      })()`)
      assert.equal(brut[0], false, 'un élément associé qui porte readonly sort de la validation')
      const paires: [string, string][] = [['c', 'xc'], ['w', 'xw'], ['r', 'xr'], ['ra', 'xra'], ['rb', 'xrb'], ['k', 'xk'], ['g', 'xg'], ['s', 'xs']]
      for (const [m, x] of paires) {
        const mod = await lire(`__va('${m}')`)
        const nat = await lire(`__va('${x}')`)
        assert.deepEqual(mod.slice(0, 3), nat.slice(0, 3), `${m} comme ${x} : [willValidate, checkValidity(), :invalid]`)
        assert.equal(mod[3], nat[0] ? nat[3] : brut[1], `${m} : :valid comme ${nat[0] ? x : 'tout élément associé hors de la validation'}`)
      }
      assert.deepEqual(await lire(`['c', 'w', 'r', 'k', 'g', 's'].map((c) => __q('.' + c).hasAttribute('readonly'))`), [true, true, true, true, true, false], 'gardé sur la balise, sauf sur la liste')
      assert.deepEqual(await lire(`[__q('.cF').hasAttribute('readonly'), __va('cF')]`), [false, [true, false, true, false]], 'readonly="FALSE" ôté : la case obligatoire reste validée')
    })

    it('readonly ne change rien au maniement : la case et l\'interrupteur se cochent, le radio se choisit, le bouton rotatif et la jauge se règlent, comme les champs natifs', async function () {
      await page.evaluate(`__q('.c').click(); __q('.w').click(); __q('.r').click()`)
      await pause()
      assert.deepEqual(await lire(`['c', 'w', 'r'].map((c) => !!__q('.' + c)._state.checked)`), [true, true, true], 'cochés')
      await presser('k', '.knob', 'ArrowRight')
      await presser('g', '.spinner', 'ArrowUp')
      assert.deepEqual(await lire(`[String(__q('.k')._state.value), String(__q('.g')._state.value)]`), ['51', '1'], 'réglés')
      assert.deepEqual(await lire(`__fd('f4').filter((p) => /^[cwrkg]=/.test(p))`), ['c=on', 'w=on', 'r=1', 'k=51', 'g=1'], 'les valeurs partent')
    })

    it('readonly et disabled posés puis ôtés par un script : le module suit l\'attribut dans les deux sens', async function () {
      await presser('nA', '.input', 'ArrowUp')
      assert.equal(await lire(`__lu('nA')`), '6|6', 'modifiable au départ')
      await page.evaluate(`__q('.nA').setAttribute('readonly', '')`)
      await pause()
      await presser('nA', '.input', 'ArrowUp')
      assert.deepEqual(await lire(`[__lu('nA'), __sh('nA', '.input').readOnly, __q('.nA').willValidate]`), ['6|6', true, false], 'posé : figé, hors de la validation')
      await page.evaluate(`__q('.nA').removeAttribute('readonly')`)
      await pause()
      await presser('nA', '.input', 'ArrowUp')
      assert.deepEqual(await lire(`[__lu('nA'), __sh('nA', '.input').readOnly, __q('.nA').willValidate]`), ['7|7', false, true], 'ôté : modifiable, validé')
      await page.evaluate(`__q('.nA').setAttribute('disabled', ''); __q('.cA').setAttribute('disabled', '')`)
      await pause()
      assert.deepEqual(await lire(`[__sh('nA', '.input').disabled, __fd('f8')]`), [true, []], 'désactivés : rien ne part')
      await page.evaluate(`__q('.nA').removeAttribute('disabled'); __q('.cA').removeAttribute('disabled')`)
      await pause()
      await presser('nA', '.input', 'ArrowUp')
      assert.deepEqual(await lire(`[__lu('nA'), __sh('nA', '.input').disabled, __sh('cA', 'input').disabled, __q('.nA').matches(':disabled'), __fd('f8')]`), ['8|8', false, false, false, ['nA=8', 'cA=oui']], 'réactivés : modifiables, les valeurs partent')
    })
  })
})
