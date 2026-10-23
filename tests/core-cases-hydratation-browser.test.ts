// Cases, interrupteurs et boutons radio du cœur (<@@checkbox>, <@@switch>, <@@radio>) dans une page RENDUE PAR LE SERVEUR puis
// hydratée, dans un navigateur réel, pour chacun des quatre modes de reprise (`ssrMode` : markers, replace, positional, diff).
// - Le serveur écrit le champ du formulaire de chaque module coché (un `<input type="hidden">` dans la balise du module) :
//   après l'hydratation, chaque module coché porte UN seul champ, jamais le sien en plus de celui du serveur, qu'il ait
//   ou non un libellé entre ses balises (un module vide n'a rien à réaligner : `positional` et `diff` ne retirent pas le champ du serveur).
// - Le formulaire dit toujours l'état réel : décocher, éteindre ou changer de bouton radio retire le champ posé par le
//   serveur (`new FormData(form)` ET un vrai envoi), et `form.reset()` ramène l'état de départ, un champ par module coché.
// - Un champ caché que la page elle-même pose dans la balise d'un module, sous un autre nom, n'est jamais repris ni retiré par lui.
// Chromium et Firefox réels : de vrais clics, un vrai envoi du formulaire.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const MODES = ['markers', 'replace', 'positional', 'diff'] as const

// quatre formulaires : l'état posé en dur (`checked`), l'état lié à des variables de la page (`checked=!{…}`, `group=!{…}`), des modules sans libellé, puis une case qui porte un champ caché de la page
const HOTE = `<script>
  $a = true
  $b = true
  $r = 'x'
</script>

<form class="f-fixe" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked={true}>case</@@checkbox>
  <@@switch class="sw" name="sw" checked={true}>interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" checked>x</@@radio>
  <@@radio class="r2" name="g" value="y">y</@@radio>
  <@@radio class="r3" name="g" value="z">z</@@radio>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-lie" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked=!{$a}>case</@@checkbox>
  <@@switch class="sw" name="sw" checked=!{$b}>interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" group=!{$r}>x</@@radio>
  <@@radio class="r2" name="g" value="y" group=!{$r}>y</@@radio>
  <@@radio class="r3" name="g" value="z" group=!{$r}>z</@@radio>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-nu" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked={true}></@@checkbox>
  <@@switch class="sw" name="sw" checked={true}></@@switch>
  <@@radio class="r1" name="g" value="x" checked></@@radio>
  <@@radio class="r2" name="g" value="y"></@@radio>
  <@@radio class="r3" name="g" value="z"></@@radio>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-page" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked={true}><input type="hidden" name="autre" value="1">case</@@checkbox>
</form>
`

const FORMULAIRES = ['.f-fixe', '.f-lie', '.f-nu']
const DEPART      = ['cb=on', 'sw=on', 'g=x']
const MODULES     = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio'

// la pièce visible sur laquelle on clique, pour chaque module
const PIECE: Record<string, string> = { cb: '.box', sw: '.pill', r1: '.ring', r2: '.ring', r3: '.ring' }

// chaque geste de l'utilisateur et ce que le formulaire doit envoyer juste après
const GESTES: Array<[string, string[]]> = [
  ['cb', ['sw=on', 'g=x']],
  ['cb', ['cb=on', 'sw=on', 'g=x']],
  ['sw', ['cb=on', 'g=x']],
  ['sw', ['cb=on', 'sw=on', 'g=x']],
  ['r2', ['cb=on', 'sw=on', 'g=y']],
  ['r3', ['cb=on', 'sw=on', 'g=z']],
  ['r1', ['cb=on', 'sw=on', 'g=x']]
]

// l'état réel des modules d'un formulaire, lu sur leurs cases natives : ce que le formulaire DOIT envoyer
const VERITE = `window.__verite = (f) => Array.from(__q(f).querySelectorAll('${MODULES}')).filter((m) => { const n = m._shadow.querySelector('input.native'); return n.checked && !n.disabled }).map((m) => m.getAttribute('name') + '=' + (m.getAttribute('value') ?? 'on'))`

let construit: Promise<{ rendus: Record<string, { html: string; hydrateScript: string }>; bundle: string }> | null = null

// le rendu serveur dans chaque mode et le script concaténé, une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('cases-hydratation')
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

for (const nom of ['chromium', 'firefox'] as const) describe(`cases, interrupteurs, radios : page rendue par le serveur puis hydratée (${nom} réel)`, function () {
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

  // le centre d'une pièce visible d'un module (la case, la pastille, l'anneau), pour de vrais clics
  async function cliquer(f: string, cls: string) {
    const { x, y } = await page.evaluate(`(() => {
      const r = __q('${f} .${cls}')._shadow.querySelector('${PIECE[cls]}').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
    await attendre()
  }

  async function cliquerBouton(f: string, cls: string) {
    const { x, y } = await page.evaluate(`(() => {
      const r = __q('${f} .${cls}').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
  }

  // la page rendue par le serveur dans ce mode, le bundle chargé après elle, puis l'attente de l'hydratation des seize modules
  async function charger(mode: string) {
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendus[mode].html}\n${rendus[mode].hydrateScript}\n<script>${bundle}</script></body></html>`
    await page.goto('http://hydratation.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote-ssr')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
      return m.length === 16 && m.every((x) => x._mjs_is_mounted && x._shadow.querySelector('input.native'))
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

    it('la page est bien reprise dans ce mode, sans erreur ; chaque module coché porte UN seul champ caché, le formulaire envoie l\'état de départ', async function () {
      if (!present) { this.skip(); return }
      assert.equal(await page.evaluate(`document.querySelector('mjs-hote-ssr')._mjs_hydrated === true`), mode !== 'replace', 'le mode demandé est celui qui a joué')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      for (const f of FORMULAIRES) {
        assert.deepEqual(await parModule(f), ['cb:1', 'sw:1', 'r1:1', 'r2:0', 'r3:0'], `${f} : un champ par module coché, aucun pour les autres`)
        assert.deepEqual(await caches(f), DEPART, `${f} : les champs cachés du formulaire`)
        assert.deepEqual(await champs(f), DEPART, `${f} : FormData`)
        assert.deepEqual(await verite(f), DEPART, `${f} : l'état réel des modules`)
      }
    })

    it('décocher, éteindre, changer de bouton : le formulaire envoie l\'état réel après chaque geste (FormData), sans champ resté du serveur', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        for (const [cls, attendu] of GESTES) {
          await cliquer(f, cls)
          assert.deepEqual(await champs(f), attendu, `${f} : FormData après un clic sur .${cls}`)
          assert.deepEqual(await caches(f), attendu, `${f} : les champs cachés après un clic sur .${cls}`)
          assert.deepEqual(await verite(f), attendu, `${f} : l'état réel après un clic sur .${cls}`)
        }
      }
    })

    it('un vrai envoi du formulaire porte l\'état de départ, puis l\'état réel après des gestes', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        await charger(mode)
        envois.length = 0
        await cliquerBouton(f, 'go')
        await page.waitForFunction(`location.pathname === '/envoi'`)
        assert.deepEqual(envois, ['/envoi?cb=on&sw=on&g=x'], `${f} : envoi sans geste`)

        await charger(mode)
        envois.length = 0
        await cliquer(f, 'cb')
        await cliquer(f, 'r3')
        await cliquerBouton(f, 'go')
        await page.waitForFunction(`location.pathname === '/envoi'`)
        assert.deepEqual(envois, ['/envoi?sw=on&g=z'], `${f} : envoi après décoche de la case et choix du troisième bouton`)
      }
    })

    it('un champ caché de la page, posé dans la balise du module sous un autre nom, n\'est jamais touché', async function () {
      if (!present) { this.skip(); return }
      assert.deepEqual(await parModule('.f-page'), ['cb:2'], 'le champ de la page et celui du module')
      assert.deepEqual(await champs('.f-page'), ['autre=1', 'cb=on'])
      await cliquer('.f-page', 'cb')
      assert.deepEqual(await champs('.f-page'), ['autre=1'], 'la case décochée retire son champ, pas celui de la page')
      await cliquer('.f-page', 'cb')
      assert.deepEqual(await champs('.f-page'), ['autre=1', 'cb=on'])
    })

    it('form.reset() ramène l\'état de départ, avec un seul champ caché par module coché', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        await cliquer(f, 'cb')
        await cliquer(f, 'sw')
        await cliquer(f, 'r3')
        assert.deepEqual(await champs(f), ['g=z'], `${f} : avant la remise à zéro`)
        await cliquerBouton(f, 'rz')
        await attendre(400)
        assert.deepEqual(await parModule(f), ['cb:1', 'sw:1', 'r1:1', 'r2:0', 'r3:0'], `${f} : un champ par module coché après la remise à zéro`)
        assert.deepEqual(await champs(f), DEPART, `${f} : FormData après la remise à zéro`)
        assert.deepEqual(await verite(f), DEPART, `${f} : l'état réel après la remise à zéro`)
      }
    })
  })
})
