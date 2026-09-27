// Déstructuration Civet (`{...} := expr` / `[...] := expr`) PUIS réaffectation d'un nom déjà
// lié (`w = 10`) : le sucre qui convertit une affectation nue `IDENT = expr` en déclaration
// `IDENT .= expr` (auto-déclaration scope-aware, cf. bandeau détaillé dans
// applyCivetDialectSugar) reconnaît un nom déjà lié par une déstructuration `:=`/`.=` — plus de
// double déclaration du même nom dans le même scope (« Identifier already declared »).
//
// `:=` reste réservé par Civet au `const` (immuable, cf. docs/03-reactivite.md) : réaffecter nu
// un nom ainsi lié — simple (`x := 0` puis `x = 10`) ou déstructuré (`{w, h} := f()` puis
// `w = 10`), sur une ou plusieurs lignes — refuse désormais de COMPILER, avec un message qui
// nomme l'identifiant, la ligne fautive et la solution (`.=` au lieu de `:=`) : plus de build vert
// suivi d'un `TypeError: Assignment to constant variable` silencieux au chargement. Pour une
// déstructuration réellement mutable, `.=` (au lieu de `:=`) donne un `let` et la réaffectation
// aboutit normalement — vérifié plus bas de bout en bout, par EXÉCUTION réelle.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function outDirEsm(outDir: string) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'package.json'), '{"type":"module"}')
}

describe('déstructuration `:=` puis réaffectation — module .civet autonome (build réel)', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  const cas: { nom: string; identifiant: string; corps: string }[] = [
    { nom: 'objet simple', identifiant: 'w', corps: '{w, h} := {w: 3, h: 4}\n  w = 10\n  w' },
    { nom: 'tableau', identifiant: 'a', corps: '[a, b] := [1, 2]\n  a = 1\n  a' },
    { nom: 'clé renommée', identifiant: 'w', corps: '{x: w} := {x: 5}\n  w = 10\n  w' },
    { nom: 'valeur par défaut', identifiant: 'w', corps: '{w = 1} := {}\n  w = 10\n  w' },
    { nom: 'reste (...)', identifiant: 'r', corps: "{...r} := {a: 1, b: 2}\n  r = 1\n  r" },
    { nom: 'clé chaîne', identifiant: 'w', corps: "{'a-b': w} := {'a-b': 7}\n  w = 10\n  w" },
  ]

  for (const { nom, identifiant, corps } of cas) {
    it(`${nom} : \`${corps.split('\n')[0]}\` puis réaffectation → refus à la compilation, jamais un TypeError silencieux au chargement`, async () => {
      const root = mjsTmp('destr-reaffect')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      outDirEsm(outDir)
      writeFileSync(join(srcDir, 'm.module.civet'), `export essai = ->\n  ${corps}\n`)

      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 1, `devrait échouer avec UNE erreur claire, pas ${stats.errors.length} : ${stats.errors.map(e => e.message).join('\n')}`)
      assert.match(stats.errors[0].message, new RegExp(`« ${identifiant} »`), 'nomme l\'identifiant fautif')
      assert.match(stats.errors[0].message, /ligne \d+/, 'nomme la ligne fautive')
      assert.match(stats.errors[0].message, /:=.*constante.*\.=/, 'indique la solution : `.=` pour pouvoir réaffecter')

      await bundler.close()
    })
  }
})

describe('déstructuration `.=` (mutable) puis réaffectation — bout en bout, valeur correcte', function () {
  this.timeout(30000)

  it('{w, h} .= f() puis w = 10 : build réussi ET exécution reflète la réaffectation', async () => {
    const root = mjsTmp('destr-reaffect-mutable')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'export essai = ->\n  {w, h} .= {w: 3, h: 4}\n  w = 10\n  w + h\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.essai(), 14, 'w réaffecté à 10 (h=4 inchangé) : 10 + 4 = 14')

    await bundler.close()
  })
})

describe('déstructuration puis réaffectation — <script> de composant (transpile réel)', () => {
  it("{w, h} := f() puis w = 10, dans le <script> d'un composant : la compilation échoue avec un message clair", async () => {
    const src = '<script>\n{w, h} := {w: 3, h: 4}\nw = 10\n</script>\n<p>{w}</p>'
    await assert.rejects(transpile(src, { moduleName: 'destr-reaffect-composant' }), /« w »[\s\S]*:=.*constante.*\.=/)
  })
})

// Motif OUVERT sur sa propre ligne et refermé plus bas (mise en forme multi-lignes) : la détection
// qui enregistre les noms d'un `:=`/`.=` déjà lié ne regardait qu'UNE ligne physique — un motif qui
// ne se referme pas sur cette même ligne lui échappait entièrement, reproduisant le bogue d'origine
// (double déclaration, « Identifier already declared ») malgré le correctif ci-dessus. Même
// couverture que le motif sur une seule ligne (objet, tableau, imbriqué, défaut, reste), plus le cas
// imbriqué qui s'étale lui-même sur plusieurs lignes.
describe('déstructuration `:=` MULTI-LIGNES puis réaffectation — module .civet autonome (build réel)', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  const casMultiLignes: { nom: string; identifiant: string; corps: string }[] = [
    { nom: 'objet multi-lignes', identifiant: 'w', corps: '{\n    w,\n    h\n  } := {w: 3, h: 4}\n  w = 10\n  w' },
    { nom: 'tableau multi-lignes', identifiant: 'a', corps: '[\n    a,\n    b\n  ] := [1, 2]\n  a = 1\n  a' },
    { nom: 'imbriqué multi-lignes', identifiant: 'b', corps: '{\n    a: {\n      b\n    }\n  } := {a: {b: 9}}\n  b = 1\n  b' },
    { nom: 'valeur par défaut multi-lignes', identifiant: 'w', corps: '{\n    w = 1\n  } := {}\n  w = 10\n  w' },
    { nom: 'reste (...) multi-lignes', identifiant: 'r', corps: "{\n    ...r\n  } := {a: 1, b: 2}\n  r = 1\n  r" },
  ]

  for (const { nom, identifiant, corps } of casMultiLignes) {
    it(`${nom} : motif ouvert sur sa propre ligne, refermé plus bas, puis réaffectation → refus à la compilation`, async () => {
      const root = mjsTmp('destr-reaffect-multiligne')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      outDirEsm(outDir)
      writeFileSync(join(srcDir, 'm.module.civet'), `export essai = ->\n  ${corps}\n`)

      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 1, `devrait échouer avec UNE erreur claire, pas ${stats.errors.length} : ${stats.errors.map(e => e.message).join('\n')}`)
      assert.match(stats.errors[0].message, new RegExp(`« ${identifiant} »`), 'nomme l\'identifiant fautif')
      assert.match(stats.errors[0].message, /ligne \d+/, 'nomme la ligne fautive')
      assert.match(stats.errors[0].message, /:=.*constante.*\.=/, 'indique la solution : `.=` pour pouvoir réaffecter')

      await bundler.close()
    })
  }
})

describe('déstructuration `.=` MULTI-LIGNES (mutable) puis réaffectation — bout en bout, valeur correcte', function () {
  this.timeout(30000)

  it('motif ouvert sur sa propre ligne .= f() puis w = 10 : build réussi ET exécution reflète la réaffectation', async () => {
    const root = mjsTmp('destr-reaffect-multiligne-mutable')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'export essai = ->\n  {\n    w,\n    h\n  } .= {w: 3, h: 4}\n  w = 10\n  w + h\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.essai(), 14, 'w réaffecté à 10 (h=4 inchangé) : 10 + 4 = 14')

    await bundler.close()
  })
})

describe('déstructuration MULTI-LIGNES puis réaffectation — <script> de composant (transpile réel)', () => {
  it("motif ouvert sur sa propre ligne puis w = 10, dans le <script> d'un composant : la compilation échoue avec un message clair", async () => {
    const src = '<script>\n{\n  w,\n  h\n} := {w: 3, h: 4}\nw = 10\n</script>\n<p>{w}</p>'
    await assert.rejects(transpile(src, { moduleName: 'destr-reaffect-composant-multiligne' }), /« w »[\s\S]*:=.*constante.*\.=/)
  })
})
