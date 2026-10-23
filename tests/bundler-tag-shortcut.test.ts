// Test neuf — bundler/index.ts : `<@nom>` désigne un composant du PROJET, `<@@nom>` un
// module de la bibliothèque CŒUR (balise mjs-core-nom) ; <@mjs-nom> (ancienne notation
// dédiée au cœur) est une ERREUR DE MIGRATION ; balises littérales mjs-*/mjs-core-* écrites
// à la main ; gardes sur les noms de fichiers projet (réservé / préfixe core-) ; compilation
// TRANSITIVE des modules cœur référencés, sous la clé core-<nom>. Patron `buildProject`
// calqué sur tests/mjs-modal-bundler-integration.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function buildProject(files: Record<string, string>, extraOpts: any = {}): Promise<{ root: string; srcDir: string; outDir: string; stats: any }> {
  const root = mjsTmp('tagshortcut')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(srcDir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...extraOpts })
  const stats = await bundler.compile()
  return { root, srcDir, outDir, stats }
}

function messages(stats: any): string {
  return stats.errors.map((e: any) => e.message).join('\n')
}

function readComponent(outDir: string, name: string): string {
  const files = readdirSync(outDir)
  const f = files.find((f) => new RegExp(`^${name}-[0-9a-z]{5}\\.js$`).test(f))
  assert.ok(f, `${name}-*.js doit exister dans ${outDir} (trouvés : ${files.join(', ')})`)
  return readFileSync(join(outDir, f!), 'utf-8')
}

function makeCoreCatalog(root: string, files: Record<string, string>): string {
  const coreDir = join(root, 'core-modules')
  mkdirSync(coreDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(coreDir, rel), content)
  return coreDir
}

describe('bundler — raccourci-dev <@nom> valide → build vert, <mjs-nom> dans le gabarit', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('self-close <@panier/> + panier.mjs présent → <mjs-panier></mjs-panier>', async () => {
    const { outDir, stats } = await buildProject({
      'hote.mjs': '<div><@panier/></div>',
      'panier.mjs': '<p>panier</p>',
    })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.match(readComponent(outDir, 'hote'), /<mjs-panier><\/mjs-panier>/)
  })

  it('forme ouvrante+fermante <@panier>…</@panier> → même réécriture', async () => {
    const { outDir, stats } = await buildProject({
      'hote.mjs': '<div><@panier></@panier></div>',
      'panier.mjs': '<p>panier</p>',
    })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.match(readComponent(outDir, 'hote'), /<mjs-panier><\/mjs-panier>/)
  })

  it('multi-tiret <@rt-x> valide via ALIAS court (doc/doc-rt-x.mjs) → <mjs-rt-x>', async () => {
    const { outDir, stats } = await buildProject({
      'hote.mjs': '<div><@rt-x/></div>',
      'doc/doc-rt-x.mjs': '<p>rt-x</p>',
    })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.match(readComponent(outDir, 'hote'), /<mjs-rt-x><\/mjs-rt-x>/)
  })
})

describe('bundler — <@nom> INCONNU → erreur agrégée + suggestion levenshtein', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('<@slect> (typo, select.mjs présent) → « balise <@slect> inconnue » + « <@select> (composant du projet) »', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, {})  // catalogue cœur DE TEST vide — isolé du vrai src/core-modules/
    const { stats } = await buildProject({
      'hote.mjs': '<div><@slect/></div>',
      'select.mjs': '<p>select</p>',
    }, { coreModulesDir })
    assert.ok(stats.errors.length > 0, 'le build doit échouer')
    const msg = messages(stats)
    assert.match(msg, /balise <@slect> inconnue/)
    assert.match(msg, /ni balise du langage, ni composant du projet/)
    assert.match(msg, /<@select>/)
    assert.match(msg, /composant du projet/)
  })

  it('<@selct> (typo) sans composant du projet, select au cœur → suggestion « <@@select> (module cœur) »', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'select.mjs': '<p>cœur select</p>' })
    const { stats } = await buildProject({ 'hote.mjs': '<div><@selct/></div>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /<@@select> \(module cœur\)/)
  })

  it('<@slect> — distance ÉGALE projet/cœur (select.mjs des deux côtés) → départage gagné par le PROJET', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'select.mjs': '<p>cœur select</p>' })  // même nom que le projet → distances Levenshtein à égalité
    const { stats } = await buildProject({
      'hote.mjs': '<div><@slect/></div>',
      'select.mjs': '<p>select</p>',
    }, { coreModulesDir })
    assert.ok(stats.errors.length > 0, 'le build doit échouer')
    assert.match(messages(stats), /<@select> \(composant du projet\)/)
  })

  it('<@slott> (typo d\'une réservée) → suggestion « <@slot> (balise réservée) »', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, {})  // isolé du vrai src/core-modules/
    const { stats } = await buildProject({ 'hote.mjs': '<div><@slott/></div>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0)
    const msg = messages(stats)
    assert.match(msg, /<@slot>/)
    assert.match(msg, /balise réservée/)
  })
})

describe('bundler — <@@nom> : la bibliothèque cœur (catalogue de test coreModulesDir)', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('<@@tst> + tst.mjs au catalogue → build vert, clé core-tst, chunk core-tst-*.js, <mjs-core-tst> dans le gabarit', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'tst.mjs': '<p>cœur tst</p>' })
    const { outDir, stats } = await buildProject({ 'hote.mjs': '<div><@@tst/></div>' }, { coreModulesDir })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.ok(stats.manifest['core-tst'], 'le manifeste expose la clé core-tst')
    assert.equal(stats.manifest['tst'], undefined, 'le nom nu tst reste libre pour le projet')
    assert.match(readComponent(outDir, 'hote'), /<mjs-core-tst><\/mjs-core-tst>/)
    assert.match(readComponent(outDir, 'core-tst'), /µ\._def\("mjs-core-tst"/)
  })

  it('<@tst> (un seul @) : aucun composant tst au projet, tst au cœur → erreur qui dit d’écrire <@@tst>', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'tst.mjs': '<p>cœur tst</p>' })
    const { stats } = await buildProject({ 'hote.mjs': '<div><@tst/></div>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0, 'le build doit échouer : <@tst> ne désigne plus le cœur')
    const msg = messages(stats)
    assert.match(msg, /« <@tst> » : aucun composant « tst » dans le projet/)
    assert.match(msg, /« <@@tst> »/)
    assert.equal(stats.manifest['core-tst'], undefined, 'le module cœur n’est pas compilé en douce')
  })

  it('<@@tsst> (typo) → erreur + suggestion <@@tst>', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'tst.mjs': '<p>cœur tst</p>' })
    const { stats } = await buildProject({ 'hote.mjs': '<div><@@tsst/></div>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0)
    const msg = messages(stats)
    assert.match(msg, /« <@@tsst> » : aucun module cœur « tsst »/)
    assert.match(msg, /<@@tst> \(module cœur\)/)
  })

  it('<@@panier> alors que panier est un composant du PROJET → erreur qui dit d’écrire <@panier>', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, {})
    const { stats } = await buildProject({ 'hote.mjs': '<div><@@panier/></div>', 'panier.mjs': '<p>panier</p>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /« <@@panier> » : aucun module cœur « panier » — le composant du projet s'écrit « <@panier> »/)
  })

  it('<@@slot> : une balise du langage garde un seul @', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, {})
    const { stats } = await buildProject({ 'hote.mjs': '<div><@@slot/></div>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /« <@@slot> » : une balise du langage s'écrit avec un seul @ — « <@slot> »/)
  })

  it('transitivité : tst.mjs référence <@@tst2> → core-tst2 aussi au manifeste', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, {
      'tst.mjs': '<div><p>cœur tst</p><@@tst2/></div>',
      'tst2.mjs': '<p>cœur tst2</p>',
    })
    const { stats } = await buildProject({ 'hote.mjs': '<div><@@tst/></div>' }, { coreModulesDir })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.ok(stats.manifest['core-tst'], 'core-tst attendu au manifeste')
    assert.ok(stats.manifest['core-tst2'], 'core-tst2 (référencé TRANSITIVEMENT par tst.mjs) attendu au manifeste')
  })

  // les deux espaces de noms sont séparés : un composant du projet ne masque plus un module
  // cœur, et un module cœur ne réserve plus aucun nom au projet
  it('projet et cœur ont chacun un « panier » : <@panier> = projet, <@@panier> = cœur, les deux coexistent', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'panier.mjs': '<p>panier CŒUR</p>' })
    const { outDir, stats } = await buildProject({
      'hote.mjs': '<div><@panier/><@@panier/></div>',
      'panier.mjs': '<p>panier PROJET</p>',
    }, { coreModulesDir })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.match(readComponent(outDir, 'panier'), /panier PROJET/)
    assert.match(readComponent(outDir, 'core-panier'), /panier CŒUR/)
    const hote = readComponent(outDir, 'hote')
    assert.match(hote, /<mjs-panier><\/mjs-panier>/)
    assert.match(hote, /<mjs-core-panier><\/mjs-core-panier>/)
  })

  it('<@mjs-tst/> (ANCIENNE notation retirée) → erreur de migration qui dit d’écrire <@@tst> quand tst est au cœur', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'tst.mjs': '<p>cœur tst</p>' })
    const { stats } = await buildProject({ 'hote.mjs': '<div><@mjs-tst/></div>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0, 'le build doit échouer (notation retirée), même si tst.mjs existe')
    const msg = messages(stats)
    assert.match(msg, /« <@mjs-tst> » est retirée/)
    assert.match(msg, /écrivez « <@@tst> »/)
  })

  it('<@mjs-core-tst/> (ancienne notation et nouvelle balise mêlées) → écris « <@@tst> »', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, { 'tst.mjs': '<p>cœur tst</p>' })
    const { stats } = await buildProject({ 'hote.mjs': '<div><@mjs-core-tst/></div>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /écrivez « <@@tst> »/)
  })

  it('<@mjs-panier/> alors que panier est au projet → écris « <@panier> »', async () => {
    const root = mjsTmp('tagshortcut-core')
    const coreModulesDir = makeCoreCatalog(root, {})
    const { stats } = await buildProject({ 'hote.mjs': '<div><@mjs-panier/></div>', 'panier.mjs': '<p>panier</p>' }, { coreModulesDir })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /écrivez « <@panier> »/)
  })
})

describe('bundler — gardes sur les fichiers du projet (nom réservé / préfixe core-)', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('fichier head.mjs (basename réservé) → erreur', async () => {
    const { stats } = await buildProject({ 'head.mjs': '<p>x</p>' })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /RÉSERVÉE/)
  })

  it('fichier core-x.mjs (préfixe core- réservé) → erreur', async () => {
    const { stats } = await buildProject({ 'core-x.mjs': '<p>x</p>' })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /préfixe RÉSERVÉ aux modules cœur \(balise <mjs-core-nom>, écrite <@@nom>\)/)
  })

  // un ALIAS court n'est qu'un confort : contrairement au basename (guards ci-dessus,
  // erreur dure inchangée), une collision d'ALIAS avec une réservée/core- cède en silence
  // (avertissement) plutôt que de bloquer tout le build pour un simple raccourci.
  it('alias court en collision avec une réservée (doc/doc-view.mjs → alias "view") → build VERT + avertissement, nom long fonctionne, <@view> garde son sens réservé', async () => {
    const { outDir, stats } = await buildProject({
      'doc/doc-view.mjs': '<p>x</p>',
      // <@view> exige le marqueur .page.mjs sur son hôte ; le
      // stripping (pageAwareBaseName) laisse l'identité 'hote' inchangée (readComponent
      // ci-dessous continue de chercher hote-<hash>.js, jamais hote.page-<hash>.js).
      'hote.page.mjs': '<div><@doc-view/></div>\n<@view app-content>',
    })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.ok(stats.warnings.some((w: string) => w.includes("'view'")), `un avertissement doit mentionner l'alias 'view' (reçu : ${stats.warnings.join(' | ')})`)
    const out = readComponent(outDir, 'hote')
    assert.match(out, /<mjs-doc-view><\/mjs-doc-view>/)  // le nom long continue de marcher
    assert.match(out, /metamjs-view/)  // <@view> reste réécrite en metamjs-view, jamais vers le composant
    assert.equal(stats.manifest['view'], undefined, `la clé courte 'view' (alias abandonné) ne doit pas résoudre vers doc-view.mjs (reçu : ${stats.manifest['view']})`)
  })

  it('alias court en collision avec le préfixe core- (x/x-core-thing.mjs → alias "core-thing") → build VERT + avertissement, nom long fonctionne', async () => {
    const { outDir, stats } = await buildProject({
      'x/x-core-thing.mjs': '<p>y</p>',
      'hote2.mjs': '<div><@x-core-thing/></div>',
    })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.ok(stats.warnings.some((w: string) => w.includes("'core-thing'")), `un avertissement doit mentionner l'alias 'core-thing' (reçu : ${stats.warnings.join(' | ')})`)
    assert.match(readComponent(outDir, 'hote2'), /<mjs-x-core-thing><\/mjs-x-core-thing>/)  // le nom long continue de marcher
    assert.equal(stats.manifest['core-thing'], undefined, `la clé courte 'core-thing' (alias abandonné) ne doit pas résoudre vers x-core-thing.mjs (reçu : ${stats.manifest['core-thing']})`)
  })
})

describe('bundler — balises littérales mjs-*/mjs-core-* écrites à la main', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('<mjs-core-x> littéral : aucun module cœur « x » → erreur (le préfixe mjs-core- est réservé au cœur)', async () => {
    const { stats } = await buildProject({ 'hote.mjs': '<div><mjs-core-x></mjs-core-x></div>' })
    assert.ok(stats.errors.length > 0)
    assert.match(messages(stats), /<mjs-core-x> : aucun module cœur « x »/)
  })

  it('<mjs-core-select> littéral (catalogue réel) → compile le module cœur, sans avertissement', async () => {
    const { outDir, stats } = await buildProject({ 'hote.mjs': '<div><mjs-core-select></mjs-core-select></div>' })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.equal(stats.warnings.some((w: string) => w.includes('mjs-core-select')), false, stats.warnings.join(' | '))
    assert.ok(stats.manifest['core-select'], 'le module cœur select doit être compilé')
    assert.match(readComponent(outDir, 'hote'), /<mjs-core-select>/)
  })

  it('<mjs-typo> littéral inconnu → build VERT + avertissement dans stats.warnings', async () => {
    const { stats } = await buildProject({ 'hote.mjs': '<div><mjs-typo></mjs-typo></div>' })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.ok(stats.warnings.some((w: string) => w.includes('mjs-typo')), `un avertissement doit mentionner mjs-typo (reçu : ${stats.warnings.join(' | ')})`)
  })

  it('<mjs-panier> littéral CONNU (panier.mjs présent) → aucun avertissement', async () => {
    const { stats } = await buildProject({
      'hote.mjs': '<div><mjs-panier></mjs-panier></div>',
      'panier.mjs': '<p>panier</p>',
    })
    assert.equal(stats.errors.length, 0, messages(stats))
    assert.equal(stats.warnings.some((w: string) => w.includes('mjs-panier')), false, `aucun avertissement ne doit mentionner mjs-panier (reçu : ${stats.warnings.join(' | ')})`)
  })

  // une balise littérale `mjs-select` désignait le module cœur quand il se compilait sous ce nom :
  // il s'appelle maintenant `mjs-core-select`, l'ancienne balise ne mène plus à rien
  it('<mjs-select> littéral INCONNU du projet mais CONNU du cœur (catalogue réel) → erreur qui dit d’écrire <@@select>', async () => {
    const { stats } = await buildProject({ 'hote.mjs': '<div><mjs-select></mjs-select></div>' })
    assert.ok(stats.errors.length > 0)
    const msg = messages(stats)
    assert.match(msg, /<mjs-select> : aucun composant « select » dans le projet/)
    assert.match(msg, /« <@@select> » \(balise <mjs-core-select>\)/)
  })
})

describe('bundler — les 12 balises réservées restent INTACTES à travers tout le pipeline', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('<@slot>/<@include>/<@head>/<@window>/<@view>/<@failed>/<@element>/<@module> ensemble → build vert, rien remonté en avertissement', async () => {
    const { outDir, stats } = await buildProject({
      // <@view app-content> en toute fin exige le marqueur .page.mjs.
      'hote.page.mjs': [
        '<script>',
        '@onScroll = ->',
        '@onEnter = (err, reset) ->',
        '</script>',
        '<@window @scroll={@onScroll} />',
        '<@head><title>Titre</title></@head>',
        '<article>',
        '  <@include partiel>',
        '  <header><@slot title/></header>',
        '  <@element $tag>texte</@element>',
        '  <@module $comp>repli</@module>',
        '</article>',
        '<@failed err reset>',
        '  <p>💥 {err.message}</p>',
        '</@failed>',
        '<@view app-content>',
      ].join('\n'),
      '_partiel.mjs': '<p>partiel inclus</p>',
    })
    assert.equal(stats.errors.length, 0, messages(stats))
    const out = readComponent(outDir, 'hote')
    // le partiel <@include> est inliné TEXTUELLEMENT — son contenu doit être présent
    assert.match(out, /partiel inclus/)
    // <@view> reste réécrite en metamjs-view (comportement historique, cf. parser)
    assert.match(out, /metamjs-view/)
    // <@slot> reste réécrite en slot
    assert.match(out, /<slot/)
    // aucune des 12 balises réservées ne doit jamais remonter comme un warning
    // (« ne correspond à aucun composant » — signature du canal litteral-dev-inconnue)
    assert.equal(stats.warnings.some((w: string) => /ne correspond à aucun composant/.test(w)), false, `aucun avertissement attendu (reçu : ${stats.warnings.join(' | ')})`)
  })
})
