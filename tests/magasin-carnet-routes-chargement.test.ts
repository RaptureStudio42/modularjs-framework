// Une appli qui garde un objet du magasin dans une variable `$` (le carnet des objets gardés entre au cœur) et qui a des routes : le
// routeur écrit `µ.url` dès le chargement du cœur, avant le fichier des composants. Le cœur se charge sans erreur et entier, en
// développement et en production, runtime repéré ou liste `runtime` explicite, et au rendu serveur ; l'objet gardé suit ensuite
// l'écriture du magasin
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'app.page.mjs':     '<routes target="main">\n/  accueil-page\n</routes>\n<@view main>\n',
  'accueil-page.mjs': "<script>\n  $$m = [{ nom: 'a' }]\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $$m[0]}>s</button>\n<button class=\"p\" type=\"button\" @click={$$m[0].nom = 'Z'}>p</button>\n"
}

function projet(nom: string): { root: string, srcDir: string, outDir: string } {
  const root   = mjsTmp('carnet-routes-' + nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  return { root, srcDir, outDir: join(root, 'out') }
}

// construit l'appli, charge le cœur puis les composants dans happy-dom, à l'adresse de la route : l'erreur du chargement, ou rien. En
// production, le fichier unique (`js: 'bundle'`) : les fichiers minifiés d'une construction en plusieurs fichiers ne se mettent pas bout à bout
async function charger(nom: string, opts: Record<string, unknown>): Promise<{ window: any, erreur: string, coeur: string }> {
  const { root, srcDir, outDir } = projet(nom)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coeur  = files.filter((f) => f.startsWith('mjs_')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  const code   = opts.js === 'bundle'
    ? stripEsm(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    : [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  let erreur = ''
  try {
    window.eval(code)
  }
  catch (e: any) {
    erreur = String(e && e.stack || e)
  }
  return { window, erreur, coeur }
}

describe('magasin : le carnet des objets gardés dans une appli qui a des routes', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  const CAS: Record<string, Record<string, unknown>> = {
    'développement':                    {},
    'production':                       { env: 'prod', js: 'bundle' },
    'développement, runtime explicite': { runtime: ['router', 'vault'] },
    'production, runtime explicite':    { runtime: ['router', 'vault'], env: 'prod', js: 'bundle' }
  }
  for (const [nom, opts] of Object.entries(CAS)) it(`le cœur se charge entier et l'objet gardé suit le magasin : ${nom}`, async () => {
    const { window, erreur, coeur } = await charger(nom.replace(/\W+/g, '-'), opts)
    try {
      if (opts.env !== 'prod') assert.ok(coeur.includes('µ._mjs_ledgerSees = function'), 'le carnet est au cœur')
      assert.equal(erreur, '', 'le cœur se charge sans erreur')
      assert.equal(window.eval('typeof µ.Element'), 'function', 'le cœur est entier')
      assert.equal(window.eval('µ.url.path'), '/', 'le routeur a écrit µ.url au chargement')
      window.document.body.innerHTML = '<mjs-accueil-page></mjs-accueil-page>'
      const page = window.document.querySelector('mjs-accueil-page')
      await attendre(() => !!page._shadow)
      const vu = () => page._shadow.querySelector('.vu').textContent
      page._shadow.querySelector('.s').click()
      await attendre(() => vu() === 'a')
      page._shadow.querySelector('.p').click()
      await attendre(() => vu() === 'Z')
      assert.equal(vu(), 'Z', "l'objet gardé suit l'écriture du magasin")
    }
    finally {
      await pause(20)
      await window.happyDOM.close()
    }
  })

  it('le rendu serveur charge le même cœur sans erreur', async () => {
    const { srcDir, outDir } = projet('serveur')
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir } as any)
    try {
      const r = await renderer.renderToString('mjs-accueil-page', { ssrMode: 'markers' } as any)
      assert.ok(r.html.includes('class="s"'), r.html)
    }
    finally {
      await renderer.close()
    }
  })
})
