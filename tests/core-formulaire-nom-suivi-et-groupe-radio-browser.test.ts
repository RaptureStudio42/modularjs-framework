// le nom du champ de l'ombre suit l'ordre natif du nom accessible (`aria-labelledby`, puis `aria-label` ou la prop `label`, puis `<label>`),
// même quand il change après le montage, et deux clics enchaînés dans un groupe radio n'y laissent qu'un bouton coché :
// - la prop `label` posée après le montage passe devant une `<label for>` (le nombre, le bouton rotatif), ôtée elle lui rend la place
// - l'élément cité par `aria-labelledby` qui paraît après le montage (dans un {if}) nomme le champ, comme pour un champ natif
// - la liste dont `aria-labelledby` cite sa propre `<label for>` garde ce nom quand la page ôte `aria-labelledby`
// - deux `click()` dans la même tâche sur deux radios d'un groupe : le second décoche le premier aussitôt, une seule valeur part
// Chromium (arbre d'accessibilité), Firefox et WebKit réels (`ariaLabelledByElements`), en développement comme en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<script>
  $labN = null
  $labK = null
  $tard = false
</script>

<form class="f" method="get" action="/envoi" @noUJS>
  <label for="n5">Années</label><@@number id="n5" class="n5" label={$labN}></@@number>
  <label for="k5">Angle</label><@@knob id="k5" class="k5" label={$labK}></@@knob>
  <@@number class="n6" aria-labelledby="tard6"></@@number>
  <input type="number" class="x6" aria-labelledby="tard6x">
  {if $tard}<span id="tard6">Plus tard</span><span id="tard6x">Plus tard natif</span>{end}
  <label id="labp" for="ps">Pays</label><@@select id="ps" class="ps" aria-labelledby="labp"><@@option value="a">A</@@option></@@select>
</form>

<form class="fg" method="get" action="/envoi" @noUJS>
  <@@radio class="g1" name="g" value="1" checked>1</@@radio>
  <@@radio class="g2" name="g" value="2">2</@@radio>
  <@@radio class="g3" name="g" value="3">3</@@radio>
  <input type="radio" class="k1" name="k" value="1" checked aria-label="k1">
  <input type="radio" class="k2" name="k" value="2" aria-label="k2">
  <input type="radio" class="k3" name="k" value="3" aria-label="k3">
</form>
`

const MODULES = 'mjs-core-number, mjs-core-knob, mjs-core-select, mjs-core-radio'
const AIDES   = `(() => {
  window.__h   = () => document.querySelector('mjs-hote')
  window.__q   = (s) => __h()._shadow.querySelector(s)
  window.__sh  = (c, s) => __q('.' + c)._shadow.querySelector(s)
  window.__cit = (e) => e.ariaLabelledByElements ? Array.from(e.ariaLabelledByElements).map((x) => x.textContent) : null
  window.__ck  = () => ['g1', 'g2', 'g3'].map((c) => __sh(c, 'input').checked)
  window.__st  = () => ['g1', 'g2', 'g3'].map((c) => !!__q('.' + c)._state.checked)
  window.__fd  = () => Array.from(new FormData(__q('.fg'))).map((p) => p[0] + '=' + p[1])
})()`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement et les morceaux du build de production, une seule fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('formulaire-nom-suivi-radio')
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
    assert.ok(prod.has('bundle.js') && [...prod.keys()].some((f) => /^core-radio-/.test(f)), 'le build de production sépare un morceau par module')
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`nom du champ suivi après le montage, groupe radio exclusif aussitôt (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let build: 'dev' | 'prod' = 'dev'
  const erreurs: string[] = []

  const lire  = (expr: string) => page.evaluate(expr)
  const pause = (ms = 200) => page.waitForTimeout(ms)

  // Chromium : le rôle et le nom que l'arbre d'accessibilité donne à l'élément ; ailleurs, rien à lire
  async function nomAx(expr: string) {
    if (nom !== 'chromium') return null
    const cdp = await page.context().newCDPSession(page)
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: expr })
      const { nodes }  = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false })
      return nodes[0].role?.value + ' « ' + (nodes[0].name?.value ?? '') + ' »'
    }
    finally {
      await cdp.detach()
    }
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
    await page.route('http://nom.test/**', async (route: any) => {
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
      await page.goto('http://nom.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => {
        const h = document.querySelector('mjs-hote')
        const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
        return m.length === 7 && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
      })()`, undefined, { timeout: 60000 })
      await page.evaluate(AIDES)
      await pause(300)
    })

    // le script de développement est collé dans la page : son manifeste peut tenter d'importer des morceaux qui n'existent pas à part
    afterEach(function () {
      if (present) assert.deepEqual(erreurs.filter((e) => b === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('la prop label posée après le montage passe devant la <label for>, ôtée elle lui rend la place', async function () {
      assert.deepEqual(await lire(`[__cit(__sh('n5', '.input')), __cit(__sh('k5', '.knob'))]`), [['Années'], ['Angle']], 'au départ, l\'étiquette nomme le champ')
      await page.evaluate(`__h()._set('labN', 'Années (prop)'); __h()._set('labK', 'Angle (prop)')`)
      await pause()
      assert.deepEqual(await lire(`[__cit(__sh('n5', '.input')), __sh('n5', '.input').getAttribute('aria-label'), __cit(__sh('k5', '.knob')), __sh('k5', '.knob').getAttribute('aria-label')]`), [null, 'Années (prop)', null, 'Angle (prop)'], 'la prop nomme le champ, plus rien n\'est cité')
      const ax = await nomAx(`document.querySelector('mjs-hote')._shadow.querySelector('.n5')._shadow.querySelector('.input')`)
      if (ax !== null) assert.equal(ax, 'spinbutton « Années (prop) »', 'nom de Chromium')
      await page.evaluate(`__h()._set('labN', null); __h()._set('labK', null)`)
      await pause()
      assert.deepEqual(await lire(`[__cit(__sh('n5', '.input')), __cit(__sh('k5', '.knob'))]`), [['Années'], ['Angle']], 'prop ôtée : l\'étiquette revient')
    })

    it('l\'élément cité par aria-labelledby qui paraît après le montage nomme le champ, comme pour un champ natif', async function () {
      assert.equal(await lire(`__cit(__sh('n6', '.input'))`), null, 'rien de cité tant qu\'il manque')
      await page.evaluate(`__h()._set('tard', true)`)
      await pause()
      assert.deepEqual(await lire(`__cit(__sh('n6', '.input'))`), ['Plus tard'], 'cité dès qu\'il paraît')
      const ax  = await nomAx(`document.querySelector('mjs-hote')._shadow.querySelector('.n6')._shadow.querySelector('.input')`)
      const axX = await nomAx(`document.querySelector('mjs-hote')._shadow.querySelector('.x6')`)
      if (ax !== null) assert.deepEqual([ax, axX], ['spinbutton « Plus tard »', 'spinbutton « Plus tard natif »'], 'noms de Chromium, module et natif')
    })

    it('la liste dont aria-labelledby cite sa propre <label for> garde ce nom quand la page ôte aria-labelledby', async function () {
      assert.deepEqual(await lire(`__cit(__sh('ps', 'button'))`), ['Pays'], 'au départ')
      await page.evaluate(`__q('.ps').removeAttribute('aria-labelledby')`)
      await pause()
      assert.deepEqual(await lire(`__cit(__sh('ps', 'button'))`), ['Pays'], 'aria-labelledby ôté : l\'étiquette nomme toujours le bouton')
      const ax = await nomAx(`document.querySelector('mjs-hote')._shadow.querySelector('.ps')._shadow.querySelector('button')`)
      if (ax !== null) assert.equal(ax, 'combobox « Pays »', 'nom de Chromium')
    })

    it('deux click() dans la même tâche sur deux radios d\'un groupe : le second décoche le premier aussitôt, une seule valeur part', async function () {
      const tout = await lire(`(() => {
        __q('.g2').click(); __q('.g3').click(); __q('.k2').click(); __q('.k3').click()
        return { natifs: __ck(), etat: __st(), fd: __fd() }
      })()`)
      assert.deepEqual(tout, { natifs: [false, false, true], etat: [false, false, true], fd: ['g=3', 'k=3'] }, 'aussitôt, dans la même tâche')
      await pause(300)
      assert.deepEqual(await lire(`({ natifs: __ck(), etat: __st(), fd: __fd() })`), { natifs: [false, false, true], etat: [false, false, true], fd: ['g=3', 'k=3'] }, 'après la réactivité')
      await page.evaluate(`__q('.g1').click()`)
      await pause()
      assert.deepEqual(await lire(`({ natifs: __ck(), etat: __st(), fd: __fd() })`), { natifs: [true, false, false], etat: [true, false, false], fd: ['g=1', 'k=3'] }, 'un clic plus tard : le groupe suit')
    })
  })
})
