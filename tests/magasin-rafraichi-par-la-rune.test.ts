// `µrefresh($$x)` signale un changement fait hors de MJS dans l'objet que tient la clé `x` du magasin, comme `µrefresh($x)` pour une
// variable du composant, avec le même code partout : dans le script et dans un gestionnaire, en Civet, en
// CoffeeScript et en JavaScript, avec ou sans parenthèses, `µ.refresh` compris, et dans le fichier d'un magasin. Ce qui lit la clé se
// redessine, dans chaque composant qui la lit, et les valeurs dérivées qui la lisent se refont ; aucun reffet ne repart, ni d'un
// composant ni du fichier du magasin. Un reffet qui lit la clé et la signale ne se
// relance pas lui-même, et repart quand une autre partie de l'appli écrit la clé, comme un second reffet qui la signale de même. Restent
// refusés à la construction : un chemin, plusieurs arguments, la forme nue suivie d'une expression, l'interpolation du gabarit, un
// singleton importé écrit `$$x`, un état de module `µ$$x`, un `µStore`, un contexte `§§x`. Développement et production ; happy-dom,
// Chromium

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // l'objet de `$$rrcfg` changé hors de MJS (`µread($$rrcfg).n += 1`), puis signalé de chaque façon, dans chaque langue ; chaque
  // composant a sa valeur dérivée qui lit la clé, et son reffet
  'rr-civ.mjs': `<script>
@import µ$$rrmod 'rr-mod.module.civet.mjs'
$$rrcfg = {n: 1}
$d = $$rrcfg.n * 2
µeffect ->
  window.__rrE = (window.__rrE or 0) + 1
  window.__rrV = $$rrcfg.n
@brut = -> µread($$rrcfg).n += 1
@paren = ->
  µrefresh($$rrcfg)
  null
@nue = ->
  µrefresh $$rrcfg
  null
@point = ->
  µ.refresh($$rrcfg)
  null
@module = -> µ$$rrmod.v
</script>
<p class="s">{$$rrcfg.n}</p>
<p class="d">{$d}</p>
<button class="b" @click={µrefresh($$rrcfg)}>x</button>
`,
  // le fichier d'un magasin : son reffet suit la clé, sa fonction la signale
  'rr-mod.module.civet.mjs': `export µ$$rrmod = { v: 0 }

µeffect ->
  window.__rmE = (window.__rmE or 0) + 1
  window.__rmV = $$rrcfg?.n

window.__rrToucher = -> µrefresh($$rrcfg)
`,
  'rr-cof.mjs': `<script lang="coffee">
$e = $$rrcfg.n * 3
µeffect ->
  window.__rcE = (window.__rcE or 0) + 1
  window.__rcV = $$rrcfg.n
@paren = ->
  µrefresh($$rrcfg)
  null
@nue = ->
  µrefresh $$rrcfg
  null
</script>
<p class="s">{$$rrcfg.n}</p>
<p class="d">{$e}</p>
<button class="b" @click={µrefresh($$rrcfg)}>x</button>
`,
  'rr-js.mjs': `<script lang="js">
$f = $$rrcfg.n * 4
µeffect(() => {
  window.__rjE = (window.__rjE || 0) + 1
  window.__rjV = $$rrcfg.n
})
@paren = function() { µrefresh($$rrcfg); };
@point = function() { µ.refresh($$rrcfg); };
</script>
<p class="s">{$$rrcfg.n}</p>
<p class="d">{$f}</p>
<button class="b" @click={µrefresh($$rrcfg)}>x</button>
`,
  // un reffet qui lit la clé et la signale, à côté du même reffet écrit `µrefresh($$rrpan)`
  'rr-ref.mjs': `<script>
$$rrpan = {n: 1}
µeffect ->
  window.__rfE = (window.__rfE or 0) + 1
  window.__rfV = $$rrpan.n
  µrefresh($$rrpan)
  null
µeffect ->
  window.__rgE = (window.__rgE or 0) + 1
  window.__rgV = $$rrpan.n
  µrefresh($$rrpan)
  null
@ecrire = -> $$rrpan.n += 1
@signaler = ->
  µread($$rrpan).n += 10
  µrefresh($$rrpan)
  null
</script>
<p class="s">{$$rrpan.n}</p>
`,
}

const SCENARIO = `(async () => {
  const pause    = (ms) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { for (let i = 0; i < 300 && !f(); i++) await pause(10) }
  const racine   = (el) => el._shadow || el.shadowRoot || el
  const txt      = (el, c) => { const n = el && racine(el).querySelector('.' + c); return n ? n.textContent : '?' }
  const neuf     = async (tag) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => txt(el, 's') !== '?'); return el }
  const clic     = (el) => racine(el).querySelector('.b').click()
  const r  = {}
  const g  = await neuf('mjs-rr-civ')
  const c  = await neuf('mjs-rr-cof')
  const j  = await neuf('mjs-rr-js')
  await pause(50)
  const vu    = () => [g, c, j].map((el) => txt(el, 's') + '/' + txt(el, 'd')).join(' ')
  const e0    = [window.__rrE, window.__rcE, window.__rjE, window.__rmE]
  const s     = ['départ ' + vu()]
  const etape = async (nom, f) => { g.brut(); f(); await pause(30); s.push(nom + ' ' + vu()) }
  g.brut(); await pause(30); s.push('brut ' + vu())
  await etape('civet', () => g.paren())
  await etape('civet-nue', () => g.nue())
  await etape('civet-point', () => g.point())
  await etape('civet-clic', () => clic(g))
  await etape('coffee', () => c.paren())
  await etape('coffee-nue', () => c.nue())
  await etape('coffee-clic', () => clic(c))
  await etape('js', () => j.paren())
  await etape('js-point', () => j.point())
  await etape('js-clic', () => clic(j))
  await etape('magasin', () => window.__rrToucher())
  s.push('reffets ' + [window.__rrE, window.__rcE, window.__rjE, window.__rmE].map((n, i) => n - e0[i]).join(' '))
  r.rafraichir = s.join(' → ')
  const p  = await neuf('mjs-rr-ref')
  await pause(50)
  const vr = () => txt(p, 's') + ' rune ' + window.__rfE + '/' + window.__rfV + ' réécriture ' + window.__rgE + '/' + window.__rgV
  const t  = ['départ ' + vr()]
  p.signaler(); await pause(30); t.push('signalé ' + vr())
  p.ecrire(); await pause(30); t.push('écrit ' + vr())
  r.reffet = t.join(' → ')
  return r
})()`

const ATTENDU = {
  // les trois composants et leurs valeurs dérivées suivent chaque `µrefresh($$rrcfg)`, jamais le changement seul ; aucun reffet ne
  // repart, ni d'un composant ni du fichier du magasin
  rafraichir: 'départ 1/2 1/3 1/4 → brut 1/2 1/3 1/4 → civet 3/6 3/9 3/12 → civet-nue 4/8 4/12 4/16 → civet-point 5/10 5/15 5/20 → civet-clic 6/12 6/18 6/24 → coffee 7/14 7/21 7/28 → coffee-nue 8/16 8/24 8/32 → coffee-clic 9/18 9/27 9/36 → js 10/20 10/30 10/40 → js-point 11/22 11/33 11/44 → js-clic 12/24 12/36 12/48 → magasin 13/26 13/39 13/52 → reffets 0 0 0 0',
  // chaque reffet passe une fois au montage, sans se relancer par son signal ; le signal d'une méthode redessine sans relancer
  // personne ; l'écriture d'une méthode relance les deux, une fois, comme avec `µrefresh($$rrpan)`
  reffet: 'départ 1 rune 1/1 réécriture 1/1 → signalé 11 rune 1/1 réécriture 1/1 → écrit 12 rune 2/12 réécriture 2/12',
}

async function construire(sources: Record<string, string>, prod = false): Promise<{ code: string, erreurs: string[], unites: Record<string, string> }> {
  const root   = mjsTmp('mag-rune-rafraichir')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, nom), src)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  const erreurs = stats.errors.map((e: any) => String(e.message))
  if (erreurs.length > 0) return { code: '', erreurs, unites: {} }
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  // chaque unité sous son nom sans empreinte (`rr-id-79349.js` → `rr-id.js`), sans la ligne de sa carte des sources
  const unites = Object.fromEntries(files.filter((f) => !f.startsWith('mjs_')).map((f) => [f.replace(/-[a-z0-9]+\.js$/, '.js'), readFileSync(join(outDir, f), 'utf-8').replace(/\n\/\/# sourceMappingURL=.*$/gm, '')]))
  const code   = prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  return { code, erreurs, unites }
}

// le composant de la comparaison : la clé changée hors de MJS, puis signalée par `forme`, dans le script et dans un gestionnaire
function unite(lang: string, forme: string, gestionnaire: string): string {
  if (lang === 'js') return `<script lang="js">\n$$rrid = {n: 1}\n@f = function() {\n  µread($$rrid).n += 1\n  ${forme}\n  return null\n};\n</script>\n<p>{$$rrid.n}</p>\n<button @click={${gestionnaire}; null}>x</button>\n`
  return `<script${lang === 'coffee' ? ' lang="coffee"' : ''}>\n$$rrid = {n: 1}\n@f = ->\n  µread($$rrid).n += 1\n  ${forme}\n  null\n</script>\n<p>{$$rrid.n}</p>\n<button @click={${gestionnaire}; null}>x</button>\n`
}

describe('`µrefresh($$x)` signale un changement fait hors de MJS dans un magasin', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('le même code dans chaque langue et chaque forme', function () {
    const formes: Record<string, string[]> = {
      civet: ['µrefresh($$rrid)', 'µrefresh $$rrid', 'µ.refresh($$rrid)', 'µrefresh( $$rrid )'],
      coffee: ['µrefresh($$rrid)', 'µrefresh $$rrid', 'µ.refresh($$rrid)'],
      js: ['µrefresh($$rrid)', 'µrefresh $$rrid', 'µ.refresh($$rrid)'],
    }
    for (const [lang, liste] of Object.entries(formes)) {
      it(lang, async () => {
        const temoin = await construire({ 'rr-id.mjs': unite(lang, liste[0], liste[0]) })
        assert.deepEqual(temoin.erreurs, [])
        assert.ok((temoin.unites['rr-id.js'] ?? '').includes('µ._mjs_storeRefresh("rrid")'), Object.keys(temoin.unites).join(', '))
        for (const forme of liste.slice(1)) {
          const b = await construire({ 'rr-id.mjs': unite(lang, forme, forme) })
          assert.deepEqual(b.erreurs, [], forme)
          assert.equal(b.unites['rr-id.js'], temoin.unites['rr-id.js'], forme)
        }
      })
    }
  })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let code: string
      before(async () => {
        const b = await construire(SOURCES, prod)
        assert.deepEqual(b.erreurs, [])
        code = b.code
      })

      it('happy-dom : écrans, valeurs dérivées et reffets justes', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(code)
        const r = await window.eval(SCENARIO)
        assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
        await window.happyDOM.close()
      })

      it('chromium : écrans, valeurs dérivées et reffets justes', async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright.chromium.executablePath())) return this.skip()
        const browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
        try {
          const page = await browser.newPage()
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
          await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
          await page.goto('http://mjs.test/')
          assert.deepEqual(await page.evaluate(SCENARIO), ATTENDU)
        }
        finally {
          await browser.close()
        }
      })
    })
  }

  describe('les autres formes restent refusées, par un message qui dit quoi écrire', function () {
    const MODULE = 'export µ$$rrmod = { v: 0 }\n'
    const fautes: Record<string, [Record<string, string>, string]> = {
      chemin: [{ 'rr-f.mjs': '<script>\n$$rra = {b: []}\n@f = -> µrefresh($$rra.b)\n</script>\n<p>x</p>\n' }, 'µrefresh($$x)'],
      deux: [{ 'rr-f.mjs': '<script>\n$$rra = 1\n$$rrb = 2\n@f = -> µrefresh($$rra, $$rrb)\n</script>\n<p>x</p>\n' }, 'µrefresh($$x)'],
      mixte: [{ 'rr-f.mjs': '<script>\n$$rra = 1\n$b = 2\n@f = -> µrefresh($$rra, $b)\n</script>\n<p>{$b}</p>\n' }, 'µrefresh($$x)'],
      nueSuivie: [{ 'rr-f.mjs': '<script>\n$$rra = 1\n$b = 2\n@f = -> µrefresh $$rra or $b\n</script>\n<p>{$b}</p>\n' }, 'µrefresh($$rra)'],
      gabaritVariable: [{ 'rr-f.mjs': '<script>\n$rrx = {n: 1}\n</script>\n<p>{µrefresh($rrx)}</p>\n' }, 'gestionnaire'],
      gabarit: [{ 'rr-f.mjs': '<script>\n$$rra = {n: 1}\n</script>\n<p>{µrefresh($$rra)}</p>\n' }, 'gestionnaire'],
      attribut: [{ 'rr-f.mjs': '<script>\n$$rra = {n: 1}\n</script>\n<p title={µrefresh($$rra)}>x</p>\n' }, 'gestionnaire'],
      singletonImporte: [{ 'rr-f.mjs': '<script>\n@import µ$$rrmod \'rr-mod.module.civet.mjs\'\n@f = -> µrefresh($$rrmod)\n</script>\n<p>{µ$$rrmod.v}</p>\n', 'rr-mod.module.civet.mjs': MODULE }, 'µ$$rrmod'],
      etatDeModule: [{ 'rr-f.mjs': '<script>\n@import µ$$rrmod \'rr-mod.module.civet.mjs\'\n@f = -> µrefresh(µ$$rrmod)\n</script>\n<p>{µ$$rrmod.v}</p>\n', 'rr-mod.module.civet.mjs': MODULE }, 'µ$$x'],
      store: [{ 'rr-f.mjs': '<script>\ns = new µStore({ v: 0 })\n@f = -> µrefresh(s)\n</script>\n<p>x</p>\n' }, 'µStore'],
      contexte: [{ 'rr-f.mjs': '<script>\n§§rrc = {n: 1}\n@f = -> µrefresh(§§rrc)\n</script>\n<p>x</p>\n' }, '§§x'],
    }
    for (const [nom, [sources, fragment]] of Object.entries(fautes)) {
      it(nom, async () => {
        const b = await construire(sources)
        assert.ok(b.erreurs.some((e) => e.includes(fragment)), b.erreurs.join('\n') || 'aucune erreur')
      })
    }
  })
})
