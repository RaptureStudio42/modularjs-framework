// Un effet choisi par une variable (`*delta(fx: $effet)`) peut nommer n'importe quel effet qui se joue
// une fois, même écrit nulle part ailleurs dans l'appli : en construction découpée, le build prépare
// le fichier de chacun (publié au manifeste, `µ.paths`), que le moteur importe à la demande quand la
// variable le nomme. Aucun n'est importé ni préchargé par le composant : il ne coûte rien à la page
// tant qu'il n'est pas nommé. Sans effet choisi par une variable, rien de plus qu'avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPTEUR = '<script>\n$n = 1\n$fx = \'none\'\n</script>\n<span class="e" *delta(fx: $fx)>{$n}</span>\n<button class="b" @click={$fx = \'*float\'}>b</button>\n<button class="p" @click={$n = $n + 1}>+</button>\n'

async function construire(etiquette: string, fichiers: Record<string, string>, opts: Record<string, unknown> = {}) {
  const root   = mjsTmp('fx-variable-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const lire  = (f: string) => readFileSync(join(outDir, f), 'utf-8')
  const un    = (re: RegExp) => { const f = files.find((x) => re.test(x)); assert.ok(f, `${re} attendu parmi ${files.join(' ')}`); return f! }
  return { files, lire, un, manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8') }
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// la page telle que le navigateur la charge : le cœur, puis les fichiers d'effets et les composants,
// chacun dans sa portée ; `sauf` : des fichiers pas encore arrivés
function page(b: Awaited<ReturnType<typeof construire>>, sauf: RegExp) {
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const [coeur, ...reste] = [...b.files].filter((f) => !sauf.test(f)).sort((a, c) => rang(a) - rang(c))
  const paths = /const µPaths = (\{.*\});/.exec(b.manifeste)![1]
  const pre   = /const µPathsPrefix = ("[^"]*");/.exec(b.manifeste)![1]
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${stripEsm(b.lire(coeur))}\nglobalThis.µ = µ; µ.paths = ${paths}; µ.pathsPrefix = ${pre};`)
  for (const f of reste) window.eval(`(function() {\n${stripEsm(b.lire(f))}\n})();`)
  return window
}

describe('un effet choisi par une variable : chaque effet qu\'elle peut nommer a son fichier', function () {
  this.timeout(120000)
  let b: Awaited<ReturnType<typeof construire>>

  before(async () => { b = await construire('split', { 'compteur.mjs': COMPTEUR }) })
  after(async () => { await terminateSharedWorkerPool() })

  it('les effets qui se jouent une fois ont leur fichier, publié au manifeste ; pas les autres', () => {
    const paths = JSON.parse(/const µPaths = (\{.*\});/.exec(b.manifeste)![1])
    for (const nom of ['float', 'scramble', 'confetti', 'shake']) {
      b.un(new RegExp(`^mjs_fx_${nom}-[0-9a-z]{5}\\.js$`))
      assert.match(paths['mjs_fx_' + nom], new RegExp(`mjs_fx_${nom}-[0-9a-z]{5}\\.js$`))
    }
    assert.equal(b.files.some((f) => /^mjs_fx_neon-/.test(f)), false, '*neon ne se joue pas une fois : une variable ne peut pas le nommer')
  })

  it('le composant n\'importe ni ne précharge que son propre effet', () => {
    const imports = [...b.lire(b.un(/^compteur-[0-9a-z]{5}\.js$/)).matchAll(/^import '[^']*\/(mjs_fx_[a-z_]+)-[0-9a-z]{5}\.js';$/gm)].map((m) => m[1])
    assert.deepEqual(imports, ['mjs_fx_delta'])
    const deps = JSON.parse(/const µDeps = (\{.*\});/.exec(b.manifeste)![1])
    assert.deepEqual(deps.compteur, ['mjs_fx_delta'])
  })

  it('dans la page : l\'effet nommé par la variable, écrit nulle part ailleurs, arrive à la demande et se joue', async () => {
    const window  = page(b, /^mjs_fx_float-/)
    const appels: string[] = []
    const code    = stripEsm(b.lire(b.un(/^mjs_fx_float-[0-9a-z]{5}\.js$/)))
    window.µ._mjs_fxImport = (url: string) => {
      appels.push(url)
      return new Promise((r) => setTimeout(() => { window.eval(code); r(null) }, 20))
    }
    window.document.body.innerHTML = '<mjs-compteur></mjs-compteur>'
    const c = window.document.querySelector('mjs-compteur')
    await attendre(() => !!c._shadow?.querySelector('.e'))
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(typeof window.µ._mjs_fxDefs.float, 'undefined', 'pas encore là')
    c._shadow.querySelector('.b').click()
    await new Promise((r) => setTimeout(r, 10))
    c._shadow.querySelector('.p').click()
    const val = () => c._shadow.querySelector('.e [mjs-fx-delta-val]')
    await attendre(() => (val()?.getAttribute('mjs-fx') || '').includes('float'))
    assert.equal(appels.length, 1, 'un seul chargement')
    assert.match(appels[0], /mjs_fx_float-[0-9a-z]{5}\.js$/)
    assert.ok((val()?.getAttribute('mjs-fx') || '').includes('float'), 'joué dès son arrivée')
    window.close()
  })

  it('sans effet choisi par une variable : aucun fichier de plus', async () => {
    const s = await construire('fixe', { 'carte.mjs': '<p *delta(fx: *scramble(10))>1</p>\n' })
    const fx = s.files.filter((f) => f.startsWith('mjs_fx_')).map((f) => f.replace(/-[0-9a-z]{5}\.js$/, '')).sort()
    assert.deepEqual(fx, ['mjs_fx_delta', 'mjs_fx_scramble'])
  })
})
