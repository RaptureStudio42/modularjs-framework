// <@@select> nommé par une <label for> : le bouton de la liste (le combobox que lit un lecteur d'écran) garde ce nom quand un attribut
// `aria-*` de la balise change — une page qui marque `aria-invalid` la liste obligatoire d'un envoi bloqué, puis le lève quand elle est
// corrigée ; un `aria-label` posé puis ôté, après lequel la <label for> nomme de nouveau la liste. La validité seule ne touche pas au nom.
// Avec `aria-labelledby`, l'élément cité nomme la liste ; ôté, il ne la nomme plus, même paru après le montage.
// Chromium, Firefox et WebKit réels (les éléments cités par le bouton), et l'arbre d'accessibilité de Chromium (le nom du bouton), en
// développement comme avec un vrai build de production : de vrais clics, un vrai envoi bloqué puis passé

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const OPTIONS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option>'

const PAGE = `<form class="f" method="get" action="/envoi" @noUJS>
  <label for="pays">Pays</label>
  <@@select id="pays" class="pays" name="pays" required>${OPTIONS}</@@select>
  <label for="ville">Ville</label>
  <@@select id="ville" class="ville" name="ville" required>${OPTIONS}</@@select>
  <span id="cite">Langue</span>
  <@@select class="langue" name="langue" aria-labelledby="cite">${OPTIONS}</@@select>
  <@@select class="tard" name="tard" aria-labelledby="tardive">${OPTIONS}</@@select>
  <button type="submit" class="go">envoyer</button>
</form>
`

// `__cite` : ce que cite le bouton de la liste (`ariaLabelledByElements`), « sans » quand le navigateur ne le connaît pas ; la page marque
// d'`aria-invalid` la liste du pays que l'envoi trouve invalide, et le lève quand elle change
const AIDES = `(() => {
  window.__q    = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__sh   = (c, s) => __q('.' + c)._shadow.querySelector(s)
  window.__cite = (c) => { const l = __sh(c, '.select-btn').ariaLabelledByElements; return l === undefined ? 'sans' : (l || []).map((x) => x === __q('.' + c) ? 'balise' : x.textContent.trim()).join(' | ') }
  __q('.pays').addEventListener('invalid', (e) => e.target.setAttribute('aria-invalid', 'true'))
  __q('.pays').addEventListener('change', (e) => e.target.removeAttribute('aria-invalid'))
})()`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement (le cœur, les libellés du manifeste, les modules, l'hôte) et les morceaux du build de production, une seule
// fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('liste-nom-etiquette-for')
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
    assert.ok(prod.has('bundle.js') && [...prod.keys()].some((f) => /^core-select-/.test(f)), 'le build de production sépare un morceau par module')
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> nommé par une <label for> : le nom reste quand un attribut aria-* de la balise change (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let build: 'dev' | 'prod' = 'dev'
  let reflete = true
  const envois: string[]  = []
  const erreurs: string[] = []

  const lire  = (expr: string) => page.evaluate(expr)
  const pause = (ms = 300) => page.waitForTimeout(ms)

  // ce que cite le bouton ; un navigateur sans `ariaLabelledByElements` n'a rien à garder
  async function cite(c: string, attendu: string, message: string) {
    const lu = await lire(`__cite('${c}')`)
    if (lu === 'sans') { reflete = false; return }
    assert.equal(lu, attendu, message)
  }

  // les noms des listes dans l'arbre d'accessibilité de Chromium (rôle combobox)
  async function nomsChromium(): Promise<string[] | null> {
    if (nom !== 'chromium') return null
    const cdp = await page.context().newCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    await cdp.detach()
    return nodes.filter((n: any) => !n.ignored && n.role?.value === 'combobox').map((n: any) => n.name?.value ?? '')
  }

  async function cliquer(expr: string) {
    const p = await page.evaluate(`(() => {
      const el = ${expr}
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(p.x, p.y)
    await pause(200)
  }

  // la première option (France) choisie au clavier sur la liste fermée, d'une vraie flèche droite (dans Firefox, juste après l'envoi bloqué,
  // un vrai clic sur une option de la liste ouverte ne la choisit pas)
  async function choisir(c: string) {
    await page.evaluate(`__sh('${c}', '.select-btn').focus()`)
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(`__q('.${c}')._state.value === 'fr'`, undefined, { timeout: 30000 })
    await pause()
  }

  async function charger() {
    await page.goto('http://liste.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-select')) : []
      return m.length === 4 && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.querySelector('.select-btn'))
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(AIDES)
    await pause(400)
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
    await page.route('http://liste.test/**', async (route: any) => {
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

    it('envoi bloqué, la page marque aria-invalid sur la liste, puis la liste corrigée : le bouton garde le nom de sa <label for> ; la validité seule n\'y touche pas', async function () {
      await cite('pays', 'Pays', 'départ : la <label for> nomme le bouton')
      await cite('ville', 'Ville', 'départ')
      await cliquer(`__q('.go')`)
      assert.deepEqual(envois, [], 'l\'envoi est bloqué : les deux listes obligatoires sont vides')
      assert.deepEqual(await lire(`[__q('.pays').getAttribute('aria-invalid'), __sh('pays', '.select-btn').getAttribute('aria-invalid'), __q('.ville').hasAttribute('aria-invalid')]`), ['true', 'true', false], 'la page a marqué la liste du pays, le bouton le reprend')
      const bloque = await nomsChromium()
      if (bloque) assert.deepEqual(bloque, ['Pays', 'Ville', 'Langue', ''], 'Chromium : le nom des boutons après l\'envoi bloqué')
      await cite('pays', 'Pays', 'marquée aria-invalid : le bouton garde le nom de sa <label for>')
      await cite('ville', 'Ville', 'invalide sans marque : rien ne bouge')
      await choisir('pays')
      await choisir('ville')
      assert.deepEqual(await lire(`[__q('.pays').hasAttribute('aria-invalid'), __sh('pays', '.select-btn').hasAttribute('aria-invalid'), __q('.pays').matches(':invalid'), __q('.ville').matches(':invalid')]`), [false, false, false, false], 'corrigées : la marque est levée, les deux listes valides')
      const corrige = await nomsChromium()
      if (corrige) assert.deepEqual(corrige, ['Pays', 'Ville', 'Langue', ''], 'Chromium : le nom des boutons après la correction')
      await cite('pays', 'Pays', 'marque levée : le bouton garde le nom de sa <label for>')
      await cite('ville', 'Ville', 'corrigée : rien ne bouge')
      await cliquer(`__q('.go')`)
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.equal(envois.length, 1, 'l\'envoi passe')
      assert.match(envois[0], /pays=fr&ville=fr/)
      if (!reflete) this.skip()
    })

    it('aria-label posé puis ôté : il nomme le bouton, puis la <label for> le nomme de nouveau', async function () {
      await page.evaluate(`__q('.pays').setAttribute('aria-label', 'Pays de naissance')`)
      await pause()
      assert.equal(await lire(`__sh('pays', '.select-btn').getAttribute('aria-label')`), 'Pays de naissance')
      const pose = await nomsChromium()
      if (pose) assert.equal(pose[0], 'Pays de naissance', 'Chromium : aria-label de la balise')
      await page.evaluate(`__q('.pays').removeAttribute('aria-label')`)
      await pause()
      assert.equal(await lire(`__sh('pays', '.select-btn').hasAttribute('aria-label')`), false)
      const ote = await nomsChromium()
      if (ote) assert.equal(ote[0], 'Pays', 'Chromium : la <label for> après aria-label ôté')
      await cite('pays', 'Pays', 'aria-label ôté : la <label for> nomme de nouveau le bouton')
      if (!reflete) this.skip()
    })

    it('aria-labelledby : l\'élément cité nomme la liste, même marquée aria-invalid ; ôté, il ne la nomme plus, même paru après le montage', async function () {
      await cite('langue', 'Langue', 'départ : l\'élément cité')
      await page.evaluate(`__q('.langue').setAttribute('aria-invalid', 'true')`)
      await pause()
      await cite('langue', 'Langue', 'marquée aria-invalid : l\'élément cité reste')
      await page.evaluate(`__q('.langue').removeAttribute('aria-labelledby')`)
      await pause()
      await cite('langue', '', 'aria-labelledby ôté : plus rien de cité')
      await cite('tard', '', 'départ : l\'élément cité n\'existe pas encore')
      await page.evaluate(`__q('.f').insertAdjacentHTML('beforeend', '<span id="tardive">Tardive</span>')`)
      await pause()
      await cite('tard', 'Tardive', 'paru après le montage : cité')
      await page.evaluate(`__q('.tard').removeAttribute('aria-labelledby')`)
      await pause()
      await cite('tard', '', 'aria-labelledby ôté : plus rien de cité')
      const fin = await nomsChromium()
      if (fin) assert.deepEqual(fin.slice(2), ['', ''], 'Chromium : ni « Langue » ni « Tardive »')
      if (!reflete) this.skip()
    })
  })
})
