// Effets à la demande — le code d'un effet arrive avec le composant qui l'écrit. Chaque effet écrit
// dans le projet a son propre fichier (`mjs_fx_<nom>-<empreinte>.js`), importé par les composants qui
// le posent ; le cœur ne garde que le moteur (mjs_fx.ts). Le manifeste les connaît (`µ.paths`,
// `µDeps`) : ils partent avec les composants de la page (préchargement au démarrage, en-tête d'une
// page prérendue), et avec un composant chargé plus tard, en même temps que lui. Un effet nommé
// pendant l'exécution (réglage tenu par une variable) arrive à la demande, en arrière-plan, puis se
// joue. Fichier unique (`js: 'bundle'`) : rien à découper, tout reste dans le fichier.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  'carte.mjs':    '<h1 class="t" *neon(#f0f)>titre</h1>\n',
  'vitrine.mjs':  '<p class="g" *glitch>g</p>\n<@carte></@carte>\n',
  'rien.mjs':     '<p class="r">rien</p>\n',
  'compteur.mjs': '<script>\n$n = 1\n$fx = \'none\'\n</script>\n<span class="e" *delta(fx: $fx)>{$n}</span>\n<button class="b" @click={$fx = \'*scramble\'}>b</button>\n<button class="p" @click={$n = $n + 1}>+</button>\n',
  'autre.mjs':    '<b class="s" *scramble>x</b>\n',
}

async function construire(etiquette: string, opts: Record<string, unknown> = {}) {
  const root   = mjsTmp('fx-demande-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const lire  = (f: string) => readFileSync(join(outDir, f), 'utf-8')
  const un    = (re: RegExp) => { const f = files.find((x) => re.test(x)); assert.ok(f, `${re} attendu parmi ${files.join(' ')}`); return f! }
  return { root, outDir, files, lire, un, manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8') }
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// la page telle que le navigateur la charge : le cœur, puis les fichiers d'effets et les autres
// fichiers du cœur, puis les composants — chacun dans sa portée, comme un module ; `sauf` : des
// fichiers pas encore arrivés
function page(b: Awaited<ReturnType<typeof construire>>, sauf: RegExp | null = null) {
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const [coeur, ...reste] = [...b.files].filter((f) => !(sauf && sauf.test(f))).sort((a, c) => rang(a) - rang(c))
  const paths = /const µPaths = (\{.*\});/.exec(b.manifeste)![1]
  const pre   = /const µPathsPrefix = ("[^"]*");/.exec(b.manifeste)![1]
  const deps  = /const µDeps = (\{.*\});/.exec(b.manifeste)![1]
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${stripEsm(b.lire(coeur))}\nglobalThis.µ = µ; µ.paths = ${paths}; µ.pathsPrefix = ${pre}; µ.deps = ${deps};`)
  // `import { µ as o }` (noms raccourcis de production) : le cœur est global, le nom local le rejoint
  const local = (code: string) => stripEsm(code.replace(/import\s*\{\s*(?:µ|\\u00[bB]5)\s+as\s+([\w$]+)\s*\}\s*from\s*(['"])[^'"]*\2;?/g, 'var $1 = µ;'))
  for (const f of reste) window.eval(`(function() {\n${local(b.lire(f))}\n})();`)
  return window
}

describe('effets à la demande — le code d\'un effet arrive avec le composant qui l\'écrit', function () {
  this.timeout(120000)
  let b: Awaited<ReturnType<typeof construire>>

  before(async () => { b = await construire('split') })
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque effet écrit a son propre fichier ; le cœur garde le moteur, sans le code d\'aucun effet', () => {
    const coeur = b.lire(b.un(/^mjs_core-[0-9a-z]{5}\.js$/))
    assert.match(coeur, /µ\._mjs_fxDefs = µ\._mjs_fxDefs \|\| \{\}/, 'le moteur')
    for (const nom of ['neon', 'glitch', 'delta', 'scramble']) {
      assert.doesNotMatch(coeur, new RegExp(`_mjs_fxDefs\\.${nom}\\s*=`), `${nom} hors du cœur`)
      const f = b.lire(b.un(new RegExp(`^mjs_fx_${nom}-[0-9a-z]{5}\\.js$`)))
      assert.match(f, new RegExp(`_mjs_fxDefs\\.${nom}\\s*=`), `${nom} dans son fichier`)
      assert.match(f, /^import \{ µ \} from '\/[^']*mjs_core-[0-9a-z]{5}\.js';/, `${nom} importe le cœur`)
    }
    assert.equal(b.files.some((f) => /^mjs_fx_tilt-/.test(f)), false, 'un effet que personne n\'écrit n\'a pas de fichier')
  })

  it('un composant importe les fichiers de SES effets, et d\'eux seuls', () => {
    const imports = (nom: string) => [...b.lire(b.un(new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`))).matchAll(/^import '[^']*\/(mjs_fx_[a-z_]+)-[0-9a-z]{5}\.js';$/gm)].map((m) => m[1])
    assert.deepEqual(imports('carte'), ['mjs_fx_neon'])
    assert.deepEqual(imports('vitrine'), ['mjs_fx_glitch'], 'l\'effet de l\'enfant part avec l\'enfant')
    assert.deepEqual(imports('rien'), [])
    assert.deepEqual(imports('compteur'), ['mjs_fx_delta'])
  })

  it('le manifeste les connaît : µ.paths, µDeps (composant → ses effets), et les publie au runtime (µ.deps)', () => {
    const paths = JSON.parse(/const µPaths = (\{.*\});/.exec(b.manifeste)![1])
    const deps  = JSON.parse(/const µDeps = (\{.*\});/.exec(b.manifeste)![1])
    assert.match(paths.mjs_fx_neon, /mjs_fx_neon-[0-9a-z]{5}\.js$/)
    assert.deepEqual(deps.carte, ['mjs_fx_neon'])
    assert.deepEqual(deps.vitrine, ['carte', 'mjs_fx_glitch'])
    assert.match(b.manifeste, /µ\.deps = µDeps;/)
  })

  it('dans la page : chaque composant pose son effet', async () => {
    const window = page(b)
    window.document.body.innerHTML = '<mjs-vitrine></mjs-vitrine>'
    const v = window.document.querySelector('mjs-vitrine')
    await attendre(() => !!v._shadow?.querySelector('mjs-carte')?._shadow?.querySelector('.t'))
    await new Promise((r) => setTimeout(r, 20))
    assert.ok((v._shadow.querySelector('.g').getAttribute('mjs-fx') || '').includes('glitch'))
    assert.ok((v._shadow.querySelector('mjs-carte')._shadow.querySelector('.t').getAttribute('mjs-fx') || '').includes('neon'))
    window.close()
  })

  it('un composant chargé plus tard : ses effets partent en même temps que lui, sans attendre qu\'il arrive', () => {
    const window  = page(b, /^carte-[0-9a-z]{5}\.js$/)
    const appels: string[] = []
    window.µ._mjs_fxImport = (url: string) => { appels.push(url); return Promise.resolve() }
    window.µ.Autoloader.load('mjs-carte')
    assert.equal(appels.length, 1, appels.join(' '))
    assert.match(appels[0], /mjs_fx_neon-[0-9a-z]{5}\.js$/)
    window.close()
  })

  it('un effet nommé pendant l\'exécution (fx: $fx) arrive à la demande, en arrière-plan, puis se joue', async () => {
    const window  = page(b, /^mjs_fx_scramble-/)
    const appels: string[] = []
    const code    = stripEsm(b.lire(b.un(/^mjs_fx_scramble-[0-9a-z]{5}\.js$/)))
    window.µ._mjs_fxImport = (url: string) => {
      appels.push(url)
      return new Promise((r) => setTimeout(() => { window.eval(code); r(null) }, 20))
    }
    window.document.body.innerHTML = '<mjs-compteur></mjs-compteur>'
    const c = window.document.querySelector('mjs-compteur')
    await attendre(() => !!c._shadow?.querySelector('.e'))
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(typeof window.µ._mjs_fxDefs.scramble, 'undefined', 'pas encore là')
    c._shadow.querySelector('.b').click()
    await new Promise((r) => setTimeout(r, 10))
    c._shadow.querySelector('.p').click()
    const val = () => c._shadow.querySelector('.e [mjs-fx-delta-val]')
    await attendre(() => (val()?.getAttribute('mjs-fx') || '').includes('scramble'))
    assert.equal(appels.length, 1, 'un seul chargement')
    assert.match(appels[0], /mjs_fx_scramble-[0-9a-z]{5}\.js$/)
    assert.ok((val()?.getAttribute('mjs-fx') || '').includes('scramble'), `joué dès son arrivée : ${c._shadow.innerHTML.slice(0, 300)}`)
    window.close()
  })

  it('production (noms internes raccourcis dans le cœur ET dans les fichiers d\'effets) : l\'effet se pose', async () => {
    const p = await construire('prod', { env: 'prod' })
    assert.ok(p.files.some((f) => /^mjs_fx_neon-/.test(f)))
    const window = page(p)
    window.document.body.innerHTML = '<mjs-vitrine></mjs-vitrine>'
    const v = window.document.querySelector('mjs-vitrine')
    await attendre(() => !!v._shadow?.querySelector('mjs-carte')?._shadow?.querySelector('.t'))
    await new Promise((r) => setTimeout(r, 20))
    assert.ok((v._shadow.querySelector('mjs-carte')._shadow.querySelector('.t').getAttribute('mjs-fx') || '').includes('neon'))
    window.close()
  })

  it('fichier unique (js: bundle) : aucun fichier d\'effet, tout reste dans le fichier', async () => {
    const u = await construire('unique', { js: 'bundle' })
    assert.equal(u.files.some((f) => /^mjs_fx_/.test(f)), false, u.files.join(' '))
    assert.match(u.manifeste, /_mjs_fxDefs\.neon\s*=/)
  })

  it('page prérendue : l\'en-tête précharge les fichiers d\'effets de ses composants, et d\'eux seuls', async () => {
    const root   = mjsTmp('fx-demande-rendu')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), src)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js',
      render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-vitrine' } } },
    }))
    const found   = findConfig(root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const report  = await prerenderPages(found.config, found.configDir, () => {}, { env: 'dev' })
    const startup = await emitStartup(bundler, found.config.render, report, { prod: false })
    await bundler.close()
    const accueil = report.generated.find((g) => g.url === '/')!
    const hrefs   = [...readFileSync(accueil.file, 'utf-8').matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => basename(m[1]))
    assert.ok(hrefs.some((h) => /^mjs_fx_glitch-/.test(h)), hrefs.join(' '))
    assert.ok(hrefs.some((h) => /^mjs_fx_neon-/.test(h)), 'celui de l\'enfant aussi')
    assert.equal(hrefs.some((h) => /^mjs_fx_(delta|scramble)-/.test(h)), false, 'rien des autres pages')
    for (const h of hrefs) assert.ok(existsSync(join(root, 'out', h)), h)
    assert.deepEqual(startup.pages[0].names.filter((n) => n.startsWith('mjs_fx_')), ['mjs_fx_glitch', 'mjs_fx_neon'])
  })
})
