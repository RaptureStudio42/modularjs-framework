// Réaffectation nue d'un IDENTIFIANT SIMPLE lié par `:=` (`x := 0` puis `x = 10`, ou composée
// `x += 1`) dans un `<script>` de composant ou un module `.civet` autonome — même famille de
// bogue que la déstructuration (transpiler-destructuration-puis-reaffectation.test.ts), pour la
// forme la plus simple. `:=` compile en `const` (Civet, cf. docs/03-reactivite.md) : avant, le
// sucre d'auto-déclaration (applyCivetDialectSugar) voyait `x` comme déjà déclaré et laissait la
// réaffectation nue passer telle quelle — build vert, puis `TypeError: Assignment to constant
// variable` seulement au chargement. Refuse désormais de COMPILER, avec un message qui nomme
// l'identifiant, la ligne fautive et la solution (`.=` au lieu de `:=`).
//
// `.=` (mutable, compile en `let`) reste réaffectable normalement — vérifié ici par EXÉCUTION
// réelle, jamais par la seule absence d'erreur. Une affectation de PROPRIÉTÉ (`x.a = 5`) et un
// homonyme déclaré par une fonction IMBRIQUÉE (qui masque le `:=` externe dans son propre corps)
// ne sont jamais des réaffectations de l'identifiant externe : jamais concernés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { applyMjsSugarToScript, transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function outDirEsm(outDir: string) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'package.json'), '{"type":"module"}')
}

describe('x := 0 puis réaffectation nue — refus à la compilation (applyMjsSugarToScript)', () => {
  it('x = 10 : erreur claire qui nomme l\'identifiant, la ligne et la solution', () => {
    assert.throws(
      () => applyMjsSugarToScript('x := 0\nx = 10', 'civet'),
      /« x »[\s\S]*ligne 2[\s\S]*:=.*constante.*\.=/
    )
  })

  it('x += 10 (affectation composée) : même refus', () => {
    assert.throws(
      () => applyMjsSugarToScript('x := 0\nx += 10', 'civet'),
      /« x »[\s\S]*:=.*constante.*\.=/
    )
  })

  it('x++ (incrément) : même refus', () => {
    assert.throws(() => applyMjsSugarToScript('x := 0\nx++', 'civet'), /« x »/)
  })

  it('--x (décrément préfixe) : même refus', () => {
    assert.throws(() => applyMjsSugarToScript('x := 0\n--x', 'civet'), /« x »/)
  })

  it('if a then x = 5 (réaffectation en ligne après `then`) : même refus', () => {
    assert.throws(() => applyMjsSugarToScript('x := 0\nif a then x = 5', 'civet'), /« x »/)
  })

  it("dans le <script> d'un composant : la compilation échoue avec ce message", async () => {
    const src = '<script>\nx := 0\nx = 10\n</script>\n<p>{x}</p>'
    await assert.rejects(transpile(src, { moduleName: 'reaffect-const-composant' }), /« x »[\s\S]*:=.*constante.*\.=/)
  })
})

describe('x := 0 puis réaffectation — module .civet autonome (build réel)', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('x = 10 : refus à la compilation, jamais un TypeError silencieux au chargement', async () => {
    const root = mjsTmp('reaffect-const-module')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'x := 0\nx = 10\nexport final = x\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 1, `devrait échouer avec UNE erreur claire : ${stats.errors.map(e => e.message).join('\n')}`)
    assert.match(stats.errors[0].message, /« x »/)
    assert.match(stats.errors[0].message, /ligne \d+/)
    assert.match(stats.errors[0].message, /:=.*constante.*\.=/)

    await bundler.close()
  })
})

describe('x .= 0 (mutable) puis réaffectation — bout en bout, valeur EXÉCUTÉE exacte', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('x = 10 : build réussi ET exécution reflète la réaffectation', async () => {
    const root = mjsTmp('reaffect-mutable-simple')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'x .= 0\nx = 10\nexport final = x\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.final, 10)

    await bundler.close()
  })

  it('x += 10 (composée) : build réussi ET exécution reflète la réaffectation', async () => {
    const root = mjsTmp('reaffect-mutable-composee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'x .= 0\nx += 10\nexport final = x\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.final, 10)

    await bundler.close()
  })
})

describe('portée — un homonyme déclaré par une fonction IMBRIQUÉE n\'est jamais une réaffectation externe', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('applyMjsSugarToScript : x := 1 ; inner = -> (x .= 5 ; x = 6) ; return x — ne lève pas', () => {
    assert.doesNotThrow(() => applyMjsSugarToScript('x := 1\ninner = ->\n  x .= 5\n  x = 6\n  return x', 'civet'))
  })

  it('exécution réelle (module .civet autonome) : le `:=` externe survit, l\'homonyme interne est réaffecté', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-homonyme-imbrique')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), [
      'x := 1',
      'inner = ->',
      '  x .= 5',
      '  x = 6',
      '  return x',
      'export final = inner() + x',
    ].join('\n') + '\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.final, 7, 'inner() retourne 6 (son propre x local, mutable), x externe reste 1 : 6 + 1 = 7')

    await bundler.close()
  })
})

describe('affectation de PROPRIÉTÉ sur un identifiant lié par `:=` — jamais concernée', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('applyMjsSugarToScript : x := {a: 1} ; x.a = 5 — ne lève pas', () => {
    assert.doesNotThrow(() => applyMjsSugarToScript('x := {a: 1}\nx.a = 5', 'civet'))
  })

  it('exécution réelle (module .civet autonome) : x.a = 5 modifie bien la propriété', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-propriete-const')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'x := {a: 1}\nx.a = 5\nexport final = x.a\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.final, 5)

    await bundler.close()
  })
})

// Contrôle par résolution de portée (post-compilation Civet, commun aux deux chemins) : ferme ce
// qu'une détection ligne à ligne ne peut pas voir — une réaffectation depuis une fonction
// IMBRIQUÉE qui ne déclare AUCUN homonyme local (rien à confondre avec le `:=` externe, cf.
// describe précédent où `inner` déclare bien SON PROPRE `x`).
describe('fonction imbriquée SANS homonyme local — réaffectation externe refusée à la compilation', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it("dans le <script> d'un composant : la compilation échoue avec un message clair", async () => {
    const src = '<script>\nx := 1\ninner = ->\n  x = 6\n  return x\n</script>\n<p>{inner()}</p>'
    await assert.rejects(transpile(src, { moduleName: 'reaffect-const-fn-imbriquee' }), /« x »[\s\S]*ligne \d+[\s\S]*:=.*constante.*\.=/)
  })

  it('module .civet autonome (build réel) : refus à la compilation, jamais un TypeError silencieux au chargement', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-fn-imbriquee-module')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'x := 1\ninner = ->\n  x = 6\n  return x\nexport final = inner() + x\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 1, `devrait échouer avec UNE erreur claire : ${stats.errors.map(e => e.message).join('\n')}`)
    assert.match(stats.errors[0].message, /'x'/)
    assert.match(stats.errors[0].message, /ligne \d+/)
    assert.match(stats.errors[0].message, /:=.*constante.*\.=/)

    await bundler.close()
  })
})

// Bloc INDENTÉ (pas une fonction) qui réaffecte une constante externe — accumulateur `for...of`,
// motif courant. Refusé à la compilation dans les deux chemins.
describe('bloc indenté (for...of) — accumulateur sur une constante refusé à la compilation', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it("dans le <script> d'un composant : la compilation échoue avec un message clair", async () => {
    const src = '<script>\ntotal := 0\nfor n of [1, 2, 3]\n  total += n\n</script>\n<p>{total}</p>'
    await assert.rejects(transpile(src, { moduleName: 'reaffect-const-accumulateur' }), /« total »[\s\S]*ligne \d+[\s\S]*:=.*constante.*\.=/)
  })

  it('module .civet autonome (build réel) : refus à la compilation, jamais un TypeError silencieux au chargement', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-accumulateur-module')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'total := 0\nfor n of [1, 2, 3]\n  total += n\nexport final = total\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 1, `devrait échouer avec UNE erreur claire : ${stats.errors.map(e => e.message).join('\n')}`)
    assert.match(stats.errors[0].message, /« total »|'total'/)
    assert.match(stats.errors[0].message, /ligne \d+/)
    assert.match(stats.errors[0].message, /:=.*constante.*\.=/)

    await bundler.close()
  })
})

// Faux positifs à écarter — un PARAMÈTRE de fonction homonyme d'un `:=` externe n'est jamais une
// réaffectation de ce dernier (portée disjointe, comme un `.=`/`:=` local) : vérifié par
// EXÉCUTION réelle, jamais par la seule absence d'erreur.
describe('paramètre de fonction homonyme d\'un `:=` externe — jamais une réaffectation externe', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it("dans le <script> d'un composant : la compilation réussit (le paramètre masque le `:=` externe)", async () => {
    const src = '<script>\nx := 1\nf = (x) ->\n  x = 99\n  return x\n</script>\n<p>{f(5) + x}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'reaffect-param-homonyme' }))
  })

  it('exécution réelle (module .civet autonome) : le paramètre est réaffecté, le `:=` externe survit', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-param-homonyme-module')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'x := 1\nf = (x) ->\n  x = 99\n  return x\nexport final = f(5) + x\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.final, 100, 'f(5) réaffecte SON paramètre à 99 (peu importe l\'argument reçu), x externe reste 1 : 99 + 1 = 100')

    await bundler.close()
  })
})

// Faux positifs à écarter — `for (const x of …)` : nouvelle liaison à CHAQUE tour, jamais une
// réaffectation d'un `:=` externe homonyme (lecture seule dans le corps, ici). Vérifié par
// EXÉCUTION réelle.
describe('for (const x of …) homonyme d\'un `:=` externe, lecture seule — jamais une réaffectation externe', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it("dans le <script> d'un composant : la compilation réussit", async () => {
    const src = '<script>\nx := 1\nresult = []\nfor x of [10, 20, 30]\n  result.push x\n</script>\n<p>{result.join(",")} {x}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'reaffect-forconst-lecture' }))
  })

  it('exécution réelle (module .civet autonome) : la boucle ne touche jamais le `:=` externe', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-forconst-lecture-module')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'x := 1\nresult = []\nfor x of [10, 20, 30]\n  result.push x\nexport final = result\nexport outer = x\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.deepEqual(mod.final, [10, 20, 30])
    assert.equal(mod.outer, 1, 'la liaison `x` de la boucle est FRAÎCHE à chaque tour, jamais le `:=` externe')

    await bundler.close()
  })
})

// Faux positif à écarter — `catch e` lie une NOUVELLE variable, propre au bloc du catch : la
// réaffecter dans ce bloc ne touche jamais le `:=` externe homonyme. Après le bloc, le `:=`
// externe reste protégé. Vérifié par EXÉCUTION réelle.
describe('`catch e` homonyme d\'un `:=` externe — la variable du catch reste réaffectable', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('applyMjsSugarToScript : e := 1 ; try … catch e ; e = 5 ; e += 1 — ne lève pas', () => {
    assert.doesNotThrow(() => applyMjsSugarToScript('e := 1\ntry\n  JSON.parse("{")\ncatch e\n  e = 5\n  e += 1', 'civet'))
  })

  it('catch en forme parenthésée `catch (e)` : ne lève pas non plus', () => {
    assert.doesNotThrow(() => applyMjsSugarToScript('e := 1\ntry\n  JSON.parse("{")\ncatch (e)\n  e = 5', 'civet'))
  })

  it('catch déstructuré `catch {message}` : ne lève pas', () => {
    assert.doesNotThrow(() => applyMjsSugarToScript('message := "x"\ntry\n  JSON.parse("{")\ncatch {message}\n  message = "y"', 'civet'))
  })

  it('réaffecter le `:=` externe APRÈS le bloc du catch reste refusé', () => {
    assert.throws(() => applyMjsSugarToScript('e := 1\ntry\n  JSON.parse("{")\ncatch e\n  e = 5\ne = 7', 'civet'), /« e »[\s\S]*ligne 6/)
  })

  it("dans le <script> d'un composant : la compilation réussit", async () => {
    const src = '<script>\ne := 1\nmsg .= ""\ntry\n  JSON.parse("{")\ncatch e\n  e = "attrapée"\n  msg = e\n</script>\n<p>{msg} {e}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'reaffect-catch-homonyme' }))
  })

  it('exécution réelle (module .civet autonome) : la variable du catch est réaffectée, le `:=` externe survit', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-catch-homonyme-module')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'e := 1\nresult .= 0\ntry\n  JSON.parse("{")\ncatch e\n  e = 5\n  result = e\nexport final = result\nexport outer = e\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.final, 5, 'la variable du catch est réaffectée à 5')
    assert.equal(mod.outer, 1, 'le `:=` externe homonyme reste 1')

    await bundler.close()
  })
})

// Faux positifs à écarter — un paramètre de MÉTHODE ou de fonction écrite sans flèche
// (`constructor(width)`, méthode de classe, `function f(x)`, méthode raccourcie d'objet) homonyme
// d'un `:=` externe n'est jamais une réaffectation de ce dernier (exemple de docs/18-pieges.md).
describe('méthode ou fonction sans flèche, paramètre homonyme d\'un `:=` externe — jamais une réaffectation externe', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  it("constructor(width, height) dans un <script> de composant : la compilation réussit", async () => {
    const src = '<script>\nwidth := 300\nclass Box\n  constructor(width, height)\n    width = width * 2\n    @width  = width\n    @height = height\nb = new Box(10, 20)\n</script>\n<p>{width} {b.width}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'reaffect-constructeur-homonyme' }))
  })

  it('méthode de classe, `function f(x)` et méthode raccourcie d\'objet : applyMjsSugarToScript ne lève pas', () => {
    assert.doesNotThrow(() => applyMjsSugarToScript('x := 1\nclass Foo\n  bar(x)\n    x = 9\n    x\n', 'civet'))
    assert.doesNotThrow(() => applyMjsSugarToScript('x := 1\nfunction f(x)\n  x = 9\n  x\n', 'civet'))
    assert.doesNotThrow(() => applyMjsSugarToScript('x := 1\no = {\n  bar(x)\n    x += 9\n    x\n}\n', 'civet'))
  })

  it('exécution réelle (module .civet autonome) : le paramètre du constructeur est réaffecté, le `:=` externe survit', async function () {
    this.timeout(30000)
    const root = mjsTmp('reaffect-constructeur-homonyme-module')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    outDirEsm(outDir)
    writeFileSync(join(srcDir, 'm.module.civet'), 'width := 300\nclass Box\n  constructor(width)\n    width = width * 2\n    @width = width\nexport final = new Box(10).width\nexport outer = width\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))

    const modPath = bundler.manifest['m.module']
    const mod: any = await import(pathToFileURL(modPath).href)
    assert.equal(mod.final, 20, 'le paramètre `width` du constructeur vaut 10 × 2')
    assert.equal(mod.outer, 300, 'le `:=` externe homonyme reste 300')

    await bundler.close()
  })

  it('une vraie réaffectation dans le corps d\'une méthode reste refusée (contrôle sur le code compilé)', async () => {
    const src = '<script>\nx := 1\nclass Foo\n  bar(y)\n    x = y\nf = new Foo()\n</script>\n<p>{x}</p>'
    await assert.rejects(transpile(src, { moduleName: 'reaffect-methode-vraie' }), /« x »/)
  })
})
