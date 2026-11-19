// option d'appli `reffets` de mjs.config.json : "precise" (défaut, un composant redessiné par un état partagé ne fait passer que ses reffets
// qui ont lu cet état, et ceux pour qui MJS ne peut pas le savoir) ou "all" (tous ses reffets passent à chaque changement de cet état) ;
// toute autre valeur est refusée avec un message qui donne les deux valeurs permises. Avec "all", le code produit et le cœur sont ceux de
// cette règle : le relevé ne pose aucune marque de doute, et le reffet qui se taisait à la navigation repasse (happy-dom) ; la clé va de
// mjs.config.json jusqu'au paquet bâti par `mjs build`.
import { describe, it } from 'mocha'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

function options(config: unknown) {
  const root  = mjsTmp('cfg-reffets')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
  const found = findConfig(root)
  assert.ok(found, 'mjs.config.json trouvé')
  return resolveBundlerOpts(found!.config, root)
}

describe('mjs.config.json — option reffets', () => {
  it('absente : rien n\'est transmis au bundler, qui prend la précision (défaut)', () => {
    assert.equal(options({}).reffetsMode, undefined)
  })

  it('"precise" et "all" sont acceptées et transmises au bundler', () => {
    assert.equal(options({ reffets: 'precise' }).reffetsMode, 'precise')
    assert.equal(options({ reffets: 'all' }).reffetsMode, 'all')
  })

  it('une valeur inconnue est refusée, dans la forme des messages voisins : la clé, « doit être », les deux valeurs permises, « reçu : » et la valeur reçue', () => {
    assert.throws(() => options({ reffets: 'tous' }), (e: Error) => /^\[mjs\.config\.json\] reffets doit être "precise" \(défaut : .+\) ou "all" \(.+\), reçu : "tous"$/.test(e.message))
  })

  it('une valeur qui n\'est pas un texte est refusée de même', () => {
    assert.throws(() => options({ reffets: true }), (e: Error) => /^\[mjs\.config\.json\] reffets doit être .+, reçu : true$/.test(e.message))
  })
})

// la coquille d'une appli : son gabarit affiche l'adresse, un reffet pose le thème d'après une clé du magasin, un autre lit l'adresse, un
// troisième la lit après coup (doute)
const COQUILLE = `<script>
  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
  $x = 0
  µeffect ->
    vu('theme')
    window.__v.theme = $$rel
  µeffect ->
    vu('adresse')
    window.__v.adresse = [$x, µurl.path].join()
  µeffect ->
    vu('apres')
    v = $x
    µafter 5, -> window.__v.apres = [v, µurl.path].join()
</script>
<p>{µurl.path}</p>
`

// la fin de l'appel `µ.effect(…)` du reffet nommé par `vu('nom')` dans le code bâti : vrai quand elle porte la marque du doute
function marque(code: string, nom: string): boolean {
  const fin = /\},\s*(\[[^\]]*\])(\s*,\s*1)?\s*\)/g
  fin.lastIndex = code.search(new RegExp(`vu\\((['"])${nom}\\1\\)`))
  return !!fin.exec(code)![2]
}

async function jouer(nom: string, opts: Record<string, unknown>): Promise<{ code: string, navigation: Record<string, number>, valeurs: Record<string, unknown> }> {
  const root   = mjsTmp('reffets-option-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ro-coquille.mjs'), COQUILLE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', minify: false, env: 'prod', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const code   = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
  const window: any = new Window({ url: 'http://localhost/#/page-a', settings: { disableCSSFileLoading: true } } as any)
  try {
    window.__n = {}
    window.__v = {}
    window.eval(code.replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''))
    window.document.body.innerHTML = '<mjs-ro-coquille></mjs-ro-coquille>'
    const fin = Date.now() + 5000
    while (!window.document.querySelector('mjs-ro-coquille')?._mjs_is_mounted && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 60))
    const avant = { ...window.__n }
    window.eval(`history.pushState(null, '', '#/page-b'); µ.Router._mjs_updateUrlStore()`)
    await new Promise((r) => setTimeout(r, 60))
    const navigation: Record<string, number> = {}
    for (const k of Object.keys(window.__n)) if (window.__n[k] !== avant[k]) navigation[k] = window.__n[k] - avant[k]
    return JSON.parse(JSON.stringify({ code, navigation, valeurs: window.__v }))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('option reffets : le composant redessiné par la navigation', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('"precise" (défaut) : le reffet du thème, qui ne lit qu\'une clé du magasin, ne repasse pas ; celui du doute porte sa marque', async () => {
    const jeu = await jouer('precise', {})
    assert.deepEqual(jeu.navigation, { adresse: 1, apres: 1 })
    assert.equal(jeu.valeurs.adresse, '0,/page-b')
    assert.equal(jeu.valeurs.apres, '0,/page-b')
    assert.deepEqual([marque(jeu.code, 'theme'), marque(jeu.code, 'adresse'), marque(jeu.code, 'apres')], [false, false, true])
  })

  it('"all" : tous les reffets du composant repassent, et le relevé ne pose aucune marque', async () => {
    const jeu = await jouer('all', { reffetsMode: 'all' })
    assert.deepEqual(jeu.navigation, { theme: 1, adresse: 1, apres: 1 })
    assert.equal(jeu.valeurs.adresse, '0,/page-b')
    assert.equal(jeu.valeurs.apres, '0,/page-b')
    assert.deepEqual([marque(jeu.code, 'theme'), marque(jeu.code, 'adresse'), marque(jeu.code, 'apres')], [false, false, false])
  })
})

// de mjs.config.json au paquet : la ligne de commande porte la clé jusqu'au bundler
describe('option reffets : le paquet bâti par `mjs build`', function () {
  this.timeout(240000)
  const depot = join(dirname(fileURLToPath(import.meta.url)), '..')

  function batir(nom: string, config: Record<string, unknown>): string {
    const root = mjsTmp('reffets-option-build-' + nom)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'dist/assets', manifestPath: 'dist/assets/bundle.js', urlPrefix: '/assets', js: 'bundle', minify: false, ...config }))
    writeFileSync(join(root, 'index.html'), '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>ro</title><script type="module" src="assets/bundle.js"></script></head><body><mjs-ro-coquille></mjs-ro-coquille></body></html>')
    writeFileSync(join(root, 'src', 'ro-coquille.mjs'), COQUILLE)
    const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root, '--prod'], { cwd: depot, encoding: 'utf-8' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    return readFileSync(join(root, 'dist/assets/bundle.js'), 'utf-8')
  }

  it('sans la clé, le reffet du doute porte sa marque et le cœur trie les reffets ; avec "all", ni marque ni tri', () => {
    const precis = batir('precise', {}), tous = batir('all', { reffets: 'all' })
    assert.deepEqual([marque(precis, 'apres'), marque(tous, 'apres')], [true, false])
    assert.ok(precis.length > tous.length, `le paquet "all" (${tous.length} o) ne porte pas le choix des reffets, celui du défaut (${precis.length} o) le porte`)
  })
})
