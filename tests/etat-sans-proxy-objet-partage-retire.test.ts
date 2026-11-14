// sans l'enveloppe de l'état (réglage `proxy: false`), un objet rangé dans une variable `$` note la clé qui l'atteint (`_mjs_wrapDeep`,
// mjs_element.ts), pour que l'écriture faite par une variable prévienne aussi les autres qui tiennent le même objet
// (`_mjs_notifyMutationAliased`). Ces notes ne servent qu'aux mutations profondes, à `µrefresh`, aux valeurs dérivées et au carnet des
// objets gardés : une construction de production qui n'en a aucun ne les emporte pas — l'objet est rangé tel quel, seule la clé écrite
// est prévenue, et la page du journal d'erreurs, qui joint les mutations profondes, trouve encore la méthode qu'elles appellent. Tout
// autre build garde le cœur d'avant

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as acorn from 'acorn'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

// un objet rangé, puis remplacé : ni mutation profonde, ni µrefresh, ni valeur dérivée
const RANGE     = '<script>\n$o = { a: 1 }\n$n = 1\n@changer = -> $o = { a: $n + 1 }\n</script>\n<p class="v">{$o.a}</p>\n<button class="b" @click={@changer()}>b</button>\n'
const PROFOND   = '<script>\n$o = { a: { b: 1 } }\n@ecrire = -> $o.a.b = 2\n</script>\n<p>{$o.a.b}</p>\n'
const RAFRAICHI = '<script>\n$o = { a: 1 }\n@relire = -> µrefresh($o)\n</script>\n<p>{$o.a}</p>\n'

// les signaux du code compilé d'un composant, comme le build les relève
const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)

// le cœur assemblé, non minifié
const coeur = async (used: Set<string>, opts: Record<string, unknown> = {}) => {
  const out     = mjsTmp('objet-partage')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const chemin  = await bundler.bundleRuntime(used)
  return chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(chemin)), 'utf-8')
}

// les notes et leur lecture complète, par le début de leur définition
const NOTES     = ['_mjs_wrapDeep(target, rootKey) {', 'parsed = this._mjs_wrapDeep(__raw, k);', 'var f = this._mjs_rootsByTarget && this._mjs_rootsByTarget.get(obj)']
// ce qui les remplace : l'objet rangé tel quel, la seule clé écrite prévenue
const SANS      = ['parsed = __raw;', '_mjs_notifyMutationAliased(obj, rootKey, oldValue, rw) {\n    this._mjs_notifyMutation(rootKey, oldValue, rw);\n  }']

const tous    = (texte: string, jalons: string[], quoi: string) => { for (const j of jalons) assert.ok(texte.includes(j), `${quoi} : « ${j} » manque`) }
const aucun   = (texte: string, jalons: string[], quoi: string) => { for (const j of jalons) assert.ok(!texte.includes(j), `${quoi} : « ${j} » est encore là`) }
const valide  = (texte: string) => assert.doesNotThrow(() => acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' }), 'le cœur n\'est plus du JavaScript valide')
const marques = (texte: string) => assert.doesNotMatch(texte, /^[ \t]*\/\/ <\/?(?:sans-)?objet-partage>$/m, 'une marque du bloc objet-partage est restée')

describe('notes des clés qui atteignent un même objet, sans l\'enveloppe de l\'état', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  it('production, proxy: false, ni mutation profonde ni µrefresh : ni les notes ni leur lecture, le cœur reste du JavaScript valide', async () => {
    const texte = await coeur(await signaux(RANGE), { env: 'prod', proxy: false })
    aucun(texte, NOTES, 'production sans lecteur')
    assert.doesNotMatch(texte, /_mjs_rootsByTarget/, 'production sans lecteur : une note est encore lue ou posée')
    tous(texte, SANS, 'production sans lecteur')
    marques(texte)
    valide(texte)
  })

  it('production, proxy: false, avec une mutation profonde ou µrefresh : les notes restent', async () => {
    for (const [cas, source] of [['mutation profonde', PROFOND], ['µrefresh', RAFRAICHI]] as const) {
      const texte = await coeur(await signaux(source), { env: 'prod', proxy: false })
      tous(texte, NOTES, `production, ${cas}`)
      aucun(texte, SANS, `production, ${cas}`)
      marques(texte)
    }
  })

  it('avec l\'enveloppe (défaut), ou en développement : le cœur d\'avant, sans marque ni remplaçant', async () => {
    const used = await signaux(RANGE)
    for (const [cas, opts] of [['production, enveloppe', { env: 'prod' }], ['développement, proxy: false', { proxy: false }]] as const) {
      const texte = await coeur(used, opts)
      assert.ok(texte.includes('parsed = this._mjs_wrapDeep(__raw, k);'), `${cas} : l'objet n'est plus confié à _mjs_wrapDeep`)
      aucun(texte, SANS, cas)
      marques(texte)
    }
  })

  it('production, proxy: false, sans lecteur : l\'objet remplacé se redessine (happy-dom)', async () => {
    const root   = mjsTmp('objet-partage-rendu')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'boite.mjs'), RANGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', minify: false, proxy: false, defaultScriptLang: 'coffee', lint: { a11y: false } } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const paquet = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
    assert.ok(paquet.includes('parsed = __raw;'), 'le paquet de production garde les notes')
    assert.ok(readdirSync(outDir).includes('bundle.js'))
    const win: any = new Window({ url: 'http://localhost/' })
    win.eval(`${stripEsm(paquet)}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-boite></mjs-boite>'
    const tic   = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }
    await tic()
    const hote  = win.document.querySelector('mjs-boite')
    const ombre = hote._shadow || hote
    assert.equal(ombre.querySelector('.v').textContent, '1')
    ombre.querySelector('.b').dispatchEvent(new win.Event('click', { bubbles: true }))
    await tic()
    assert.equal(ombre.querySelector('.v').textContent, '2')
    await win.happyDOM.close()
  })
})
