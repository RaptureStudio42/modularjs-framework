// Nombre, jauge et bouton rotatif du cœur (<@@number>, <@@gauge>, <@@knob>) dans une page RENDUE PAR LE SERVEUR puis hydratée,
// dans un navigateur réel, pour chacun des quatre modes de reprise (`ssrMode` : markers, replace, positional, diff).
// - Le serveur écrit le champ du formulaire de chaque module (un `<input type="hidden">` dans sa balise, toujours vide de contenu) :
//   après l'hydratation, chaque module porte UN seul champ, jamais le sien en plus de celui du serveur, que la valeur soit posée
//   en dur ou liée à une variable de la page.
// - Le formulaire dit toujours la valeur réelle : un vrai geste (clic sur « + », sur « − », flèche du clavier) change la valeur, et
//   `new FormData(form)` comme un vrai envoi portent la valeur courante, jamais celle écrite par le serveur en plus.
// - `form.reset()` rend au nombre, à la jauge et au bouton rotatif leur valeur de départ, avec un seul champ caché par module.
// Chromium et Firefox réels : de vrais clics, de vraies touches, un vrai envoi du formulaire.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const MODES = ['markers', 'replace', 'positional', 'diff'] as const

// deux formulaires : les valeurs posées en dur (`value="3"`), puis liées à des variables de la page (`value=!{…}`)
const HOTE = `<script>
  $n = 3
  $g = 4
  $k = 30
</script>

<form class="f-fixe" method="get" action="/envoi" @noUJS>
  <@@number class="n" name="n" value="3"></@@number>
  <@@gauge class="g" name="gg" value="4"></@@gauge>
  <@@knob class="k" name="k" value="30"></@@knob>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-lie" method="get" action="/envoi" @noUJS>
  <@@number class="n" name="n" value=!{$n}></@@number>
  <@@gauge class="g" name="gg" value=!{$g}></@@gauge>
  <@@knob class="k" name="k" value=!{$k}></@@knob>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>
`

const FORMULAIRES = ['.f-fixe', '.f-lie']
const DEPART      = ['n=3', 'gg=4', 'k=30']
const MODULES     = 'mjs-core-number, mjs-core-gauge, mjs-core-knob'

// chaque geste de l'utilisateur et ce que le formulaire doit envoyer juste après
const GESTES: Array<[string, string[]]> = [
  ['plus-n', ['n=4', 'gg=4', 'k=30']],
  ['plus-g', ['n=4', 'gg=5', 'k=30']],
  ['haut-k', ['n=4', 'gg=5', 'k=31']],
  ['plus-n', ['n=5', 'gg=5', 'k=31']],
  ['moins-g', ['n=5', 'gg=4', 'k=31']]
]

// la valeur que chaque module AFFICHE : ce que le formulaire DOIT envoyer
const VERITE = `window.__verite = (f) => Array.from(__q(f).querySelectorAll('${MODULES}')).map((m) => {
  const s = m._shadow
  const v = m.localName === 'mjs-core-number' ? s.querySelector('input.input').value : m.localName === 'mjs-core-gauge' ? s.querySelector('output').textContent : s.querySelector('.knob').getAttribute('aria-valuenow')
  return m.getAttribute('name') + '=' + v
})`

let construit: Promise<{ rendus: Record<string, { html: string; hydrateScript: string }>; bundle: string }> | null = null

// le rendu serveur dans chaque mode et le script concaténé, une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('valeurs-hydratation')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendus: Record<string, { html: string; hydrateScript: string }> = {}
    for (const mode of MODES) {
      const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: mode } as any)
      rendus[mode] = { html, hydrateScript }
    }
    await renderer.close()
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    return { rendus, bundle: stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox'] as const) describe(`nombre, jauge, bouton rotatif : page rendue par le serveur puis hydratée (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let rendus: Record<string, { html: string; hydrateScript: string }> = {}
  let bundle  = ''
  const envois: string[]  = []
  const erreurs: string[] = []

  const attendre = (ms = 150) => page.waitForTimeout(ms)
  const champs   = (f: string): Promise<string[]> => page.evaluate(`Array.from(new FormData(__q('${f}'))).map((p) => p[0] + '=' + p[1])`)
  const caches   = (f: string): Promise<string[]> => page.evaluate(`Array.from(__q('${f}').querySelectorAll('input[type=hidden]')).map((i) => i.name + '=' + i.value)`)
  const verite   = (f: string): Promise<string[]> => page.evaluate(`__verite('${f}')`)
  // le nombre de champs cachés que porte chaque module, dans l'ordre du formulaire
  const parModule = (f: string): Promise<string[]> => page.evaluate(`Array.from(__q('${f}').querySelectorAll('${MODULES}')).map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`)

  // le centre d'une pièce visible d'un module, pour de vrais clics
  async function cliquerPiece(f: string, cls: string, piece: string, rang = 0) {
    const { x, y } = await page.evaluate(`(() => {
      const r = __q('${f} .${cls}')._shadow.querySelectorAll('${piece}')[${rang}].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
    await attendre()
  }

  // un geste de l'utilisateur : « + » / « − » du nombre ou de la jauge (vrai clic), flèche haute du bouton rotatif (vraie touche)
  async function geste(f: string, nomGeste: string) {
    if (nomGeste === 'plus-n') return cliquerPiece(f, 'n', 'button.step.more')
    if (nomGeste === 'plus-g') return cliquerPiece(f, 'g', 'button.btn', 0)
    if (nomGeste === 'moins-g') return cliquerPiece(f, 'g', 'button.btn', 1)
    await page.evaluate(`__q('${f} .k')._shadow.querySelector('.knob').focus()`)
    await page.keyboard.press('ArrowUp')
    await attendre()
  }

  async function cliquerBouton(f: string, cls: string) {
    const { x, y } = await page.evaluate(`(() => {
      const r = __q('${f} .${cls}').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
  }

  // la page rendue par le serveur dans ce mode, le bundle chargé après elle, puis l'attente de l'hydratation des six modules
  async function charger(mode: string) {
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendus[mode].html}\n${rendus[mode].hydrateScript}\n<script>${bundle}</script></body></html>`
    await page.goto('http://hydratation.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote-ssr')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
      return m.length === 6 && m.every((x) => x._mjs_is_mounted && x._shadow.querySelector('.input, .btn, .knob'))
    })()`)
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote-ssr')._shadow.querySelector(s)`)
    await page.evaluate(VERITE)
    await page.waitForTimeout(400)
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construire()
      rendus  = fait.rendus
      bundle  = fait.bundle
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1100, height: 900 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      await page.route('http://hydratation.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/envoi') {
          envois.push(url.pathname + url.search)
          await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) describe(`hydratation « ${mode} »`, function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      envois.length  = 0
      erreurs.length = 0
      await charger(mode)
    })

    it('la page est bien reprise dans ce mode, sans erreur ; chaque module porte UN seul champ caché, le formulaire envoie la valeur de départ', async function () {
      if (!present) { this.skip(); return }
      assert.equal(await page.evaluate(`document.querySelector('mjs-hote-ssr')._mjs_hydrated === true`), mode !== 'replace', 'le mode demandé est celui qui a joué')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      for (const f of FORMULAIRES) {
        assert.deepEqual(await parModule(f), ['n:1', 'g:1', 'k:1'], `${f} : un champ par module`)
        assert.deepEqual(await caches(f), DEPART, `${f} : les champs cachés du formulaire`)
        assert.deepEqual(await champs(f), DEPART, `${f} : FormData`)
        assert.deepEqual(await verite(f), DEPART, `${f} : la valeur affichée par les modules`)
      }
    })

    it('un geste réel change la valeur : le formulaire envoie la valeur réelle après chaque geste (FormData), sans champ resté du serveur', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        for (const [nomGeste, attendu] of GESTES) {
          await geste(f, nomGeste)
          assert.deepEqual(await champs(f), attendu, `${f} : FormData après « ${nomGeste} »`)
          assert.deepEqual(await caches(f), attendu, `${f} : les champs cachés après « ${nomGeste} »`)
          assert.deepEqual(await verite(f), attendu, `${f} : la valeur affichée après « ${nomGeste} »`)
        }
      }
    })

    it('un vrai envoi du formulaire porte la valeur de départ, puis la valeur réelle après des gestes', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        await charger(mode)
        envois.length = 0
        await cliquerBouton(f, 'go')
        await page.waitForFunction(`location.pathname === '/envoi'`)
        assert.deepEqual(envois, ['/envoi?n=3&gg=4&k=30'], `${f} : envoi sans geste`)

        await charger(mode)
        envois.length = 0
        await geste(f, 'plus-n')
        await geste(f, 'plus-g')
        await geste(f, 'haut-k')
        await cliquerBouton(f, 'go')
        await page.waitForFunction(`location.pathname === '/envoi'`)
        assert.deepEqual(envois, ['/envoi?n=4&gg=5&k=31'], `${f} : envoi après un geste sur chaque module`)
      }
    })

    it('form.reset() rend au nombre, à la jauge et au bouton rotatif leur valeur de départ, avec un seul champ caché par module, chacun à la valeur qu\'affiche son module', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        await geste(f, 'plus-n')
        await geste(f, 'plus-g')
        await geste(f, 'haut-k')
        assert.deepEqual(await champs(f), ['n=4', 'gg=5', 'k=31'], `${f} : avant la remise à zéro`)
        await cliquerBouton(f, 'rz')
        await attendre(400)
        assert.deepEqual(await parModule(f), ['n:1', 'g:1', 'k:1'], `${f} : un champ par module après la remise à zéro`)
        assert.deepEqual(await verite(f), DEPART, `${f} : le nombre, la jauge et le bouton rotatif ont retrouvé leur valeur de départ`)
        assert.deepEqual(await champs(f), DEPART, `${f} : FormData dit la valeur affichée par chaque module après la remise à zéro`)
      }
    })
  })
})
