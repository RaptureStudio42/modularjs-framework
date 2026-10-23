// Un prototype pollué (`Object.prototype.nom = …`) ne doit casser ni le chargeur des composants ni le démarrage de la page.
// Le chargeur dresse la liste des balises qu'il attend d'après la table des fichiers (`µ.paths`) : il y prenait aussi les
// noms hérités, et un nom qui n'est pas celui d'une balise (`piege(`) rendait faux le sélecteur de cette liste — plus aucun
// composant inséré n'était chargé. Le manifeste, au démarrage, suit les dépendances des balises déjà dans la page : pour
// une balise inconnue, il lisait une dépendance héritée, et une valeur qui n'est pas une liste faisait lever le bloc de
// préchargement, donc tout le démarrage
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  'carte.mjs': '<article class="carte">carte</article>\n',
  'hote.mjs': '<p class="pret">pret</p>\n<mjs-carte></mjs-carte>\n',
}

async function construire(prefixe: string, prod: boolean): Promise<{ code: string, manifeste: string }> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), src)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  // production en fichiers séparés : le cœur minifié seul (le chargeur y vit), ses exports posés sur la fenêtre
  // (`export{n as µ}` : le nom s'écrit échappé)
  if (prod) {
    const coeur = readdirSync(outDir).find((f) => /^mjs_core-.*\.js$/.test(f))!
    const code = readFileSync(join(outDir, coeur), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'")
      .replace(/export\s*\{([^}]*)\}\s*;?/g, (_m, l: string) => l.split(',').map((x) => x.trim().split(/\s+as\s+/)).map(([a, b]) => `globalThis[${JSON.stringify(JSON.parse('"' + (b || a) + '"'))}] = ${a};`).join('\n'))
    return { manifeste: readFileSync(join(outDir, 'bundle.js'), 'utf-8'), code }
  }
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return { manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8'), code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))
const polluer = (window: any, cles: Record<string, string>) => window.eval(Object.keys(cles).map((k) => `Object.prototype[${JSON.stringify(k)}] = ${JSON.stringify(cles[k])};`).join('\n'))
const nettoyer = (window: any, cles: Record<string, string>) => window.eval(Object.keys(cles).map((k) => `delete Object.prototype[${JSON.stringify(k)}];`).join('\n'))
// le rechargement de la garde « bundle périmé » (un import qui échoue) est compté, jamais fait
const SANS_RECHARGEMENT = 'window.__recharge = 0; try { window.location.reload = function() { window.__recharge++; }; } catch (e) {}'

describe('prototype pollué : le chargeur et le manifeste ne suivent que les clés propres', function () {
  this.timeout(180000)
  const builds: Record<string, { code: string, manifeste: string }> = {}
  before(async function () {
    this.timeout(240000)
    builds.developpement = await construire('chargeur-propre-dev', false)
    builds.production = await construire('chargeur-propre-prod', true)
  })
  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['developpement', 'production']) {
    it(mode + ' : un nom hérité n\'entre pas dans le sélecteur du chargeur, un composant inséré est toujours chargé', async () => {
      const window: any = new Window({ url: 'http://localhost/' })
      const cles = { 'piege(': 'x' }
      try {
        window.eval(SANS_RECHARGEMENT)
        window.eval(builds[mode].code)
        window.eval(`globalThis.__erreurs = []; µ.error = function() { globalThis.__erreurs.push(Array.prototype.map.call(arguments, String).join(' ')); }; µ.config.staleReload = false; µ.paths = { carte: 'carte-12345.js', fiche: 'fiche-12345.js' };`)
        polluer(window, cles)
        let leve: any = null
        try {
          window.eval('µ.Autoloader.observe(document.body)')
        }
        catch (e) {
          leve = e
        }
        assert.equal(leve, null, 'le chargeur démarre : ' + leve)
        window.document.body.innerHTML = '<div class="zone"><mjs-fiche></mjs-fiche></div>'
        await attendre(150)
        const erreurs: string[] = window.eval('globalThis.__erreurs')
        assert.equal(erreurs.filter((e) => /Failed to import/.test(e) && /fiche/.test(e)).length, 1, 'le composant inséré, que rien ne définit encore, est demandé une fois\n' + erreurs.join('\n'))
      }
      finally {
        nettoyer(window, cles)
        await window.happyDOM.close()
      }
    })

    it(mode + ' : le préchargement du manifeste ignore la dépendance héritée d\'une balise inconnue', async () => {
      const manifeste = builds[mode].manifeste
      const fin = manifeste.indexOf('const µReady = ')
      assert.ok(fin > 0, 'le manifeste démarre le cœur après sa tête')
      const tete = manifeste.slice(0, fin)
      assert.ok(tete.includes('µWalkDeps'), 'la tête porte le bloc de préchargement')
      const window: any = new Window({ url: 'http://localhost/' })
      const cles = { piege: 'x' }
      try {
        window.document.body.innerHTML = '<mjs-piege></mjs-piege><mjs-carte></mjs-carte>'
        polluer(window, cles)
        let leve: any = null
        try {
          window.eval(tete)
        }
        catch (e) {
          leve = e
        }
        assert.equal(leve, null, 'le bloc de préchargement ne lève pas : ' + leve)
        const liens = Array.from(window.document.head.querySelectorAll('link[rel="modulepreload"]')).map((l: any) => l.getAttribute('href'))
        assert.equal(liens.some((h: string) => /carte/.test(h)), true, 'le composant propre est préchargé : ' + liens.join(', '))
      }
      finally {
        nettoyer(window, cles)
        await window.happyDOM.close()
      }
    })
  }
})
