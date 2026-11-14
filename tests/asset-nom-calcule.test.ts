// µasset au nom calculé : `µasset "sounds/chess/pick-#{n}.mp3"` (Civet, CoffeeScript), µasset avec un gabarit `${n}` (JavaScript), le
// même appel dans un attribut du gabarit, posé dans une chaîne ou un gabarit, ou écrit par un alias (`mjsasset`, `mjs.asset`). La
// construction lit le motif (`sounds/chess/pick-*.mp3`), n'emporte que la table des fichiers qui y répondent, dans le seul code de la
// page qui l'écrit, et l'adresse à empreinte se choisit à l'exécution. Un appel est résolu ou refusé à la construction, jamais laissé au
// navigateur : un nom calculé en entier, sans extension écrite, un nom pris comme valeur, un motif sans fichier ou qui ne vise que du
// code l'arrêtent, avec la bonne écriture et la ligne de l'appel. Un nom collé par `+` est lu comme un motif. Un nom absent de la table rend une adresse vide, avec un avertissement en développement ; sous
// `mjs dev`, un fichier ajouté, retiré ou modifié dans le dossier du motif refait la table.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SVG = (w: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10"></svg>`

// un projet jetable : trois sons du motif et deux voisins hors motif (un son, du code), deux habillages et un voisin, un son nommé `__proto__`
function projet(prefix: string) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  for (const dossier of ['sounds/chess', 'sounds/proto', 'images/habillage/bois', 'images/habillage/marbre']) mkdirSync(join(srcDir, dossier), { recursive: true })
  mkdirSync(outDir, { recursive: true })
  for (let i = 1; i <= 3; i++) writeFileSync(join(srcDir, `sounds/chess/pick-${i}.mp3`), `ID3son${i}`)
  writeFileSync(join(srcDir, 'sounds/chess/drop.mp3'), 'ID3drop')
  writeFileSync(join(srcDir, 'sounds/chess/pick-4.js'), 'export default 4\n')
  writeFileSync(join(srcDir, 'sounds/proto/__proto__.mp3'), 'ID3proto')
  writeFileSync(join(srcDir, 'sounds/proto/a.mp3'), 'ID3a')
  writeFileSync(join(srcDir, 'images/habillage/bois/corner.svg'), SVG(20))
  writeFileSync(join(srcDir, 'images/habillage/marbre/corner.svg'), SVG(30))
  writeFileSync(join(srcDir, 'images/habillage/marbre/edge.svg'), SVG(40))
  return { root, srcDir, outDir, manifest: join(root, 'bundle.js') }
}

type Projet = ReturnType<typeof projet>

const JEU             = '<script>\n$n = 1\n$skin = \'bois\'\n$son = µasset "sounds/chess/pick-#{$n}.mp3"\n</script>\n<audio src={$son}></audio><img src={µasset "images/habillage/#{$skin}/corner.svg"} alt="coin">\n'
const JEU_PARENTHESES = '<script>\n$n = 1\n$son = µasset("sounds/chess/pick-#{$n}.mp3")\n</script>\n<audio src={$son}></audio>\n'
const JEU_FORMES      = '<script>\n$n = 1\n$titre = "son : #{µasset "sounds/chess/pick-#{$n}.mp3"}"\n$son = mjsasset "sounds/chess/pick-#{$n}.mp3"\n</script>\n<p>{$titre}</p><audio src={$son}></audio>\n'
const ACCUEIL         = '<script>\n$titre = \'accueil\'\n</script>\n<h1>{$titre}</h1>\n'
const BONNE_ECRITURE  = /µasset "sounds\/chess\/pick-#\{n\}\.mp3"/

function bundler(p: Projet, options: Record<string, unknown> = {}) {
  return new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, urlPrefix: '/mjs', sourceMap: 'never', a11y: false, ...options } as any)
}

async function construire(p: Projet, options: Record<string, unknown> = {}) {
  const b     = bundler(p, options)
  const stats = await b.compile()
  await b.close()
  return stats
}

const erreurs = (stats: { errors: Error[] }) => stats.errors.map(e => e.message).join('\n')

// le code publié d'un composant : `<nom>-<empreinte>.js`, le plus récent
function codeDe(p: Projet, nom: string): string {
  const fichiers = readdirSync(p.outDir).filter(f => new RegExp(`^${nom}-[0-9a-z]+\\.js$`).test(f))
  assert.ok(fichiers.length > 0, `${nom}-<empreinte>.js attendu, sortie : ${readdirSync(p.outDir).join(', ')}`)
  const recent = fichiers.sort((a, b) => statSync(join(p.outDir, b)).mtimeMs - statSync(join(p.outDir, a)).mtimeMs)[0]
  return readFileSync(join(p.outDir, recent), 'utf-8')
}

// le texte rendu par la construction, joué comme un module : `x` pour le nom `n`, avertissements relevés
function jouer(js: string, n: unknown): { x: string, avis: string[] } {
  const avis: string[] = []
  const lire = new Function('n', 'console', js + '\nreturn x') as (n: unknown, c: unknown) => string
  return { x: lire(n, { warn: (m: string) => avis.push(m) }), avis }
}

async function attendre(cond: () => boolean, message: string): Promise<void> {
  const limite = Date.now() + 10000
  while (!cond()) {
    if (Date.now() > limite) assert.fail(message)
    await new Promise(r => setTimeout(r, 100))
  }
}

describe('µasset au nom calculé — le motif lu à la construction, l\'adresse choisie à l\'exécution', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('la page qui l\'écrit emporte la table des seuls fichiers du motif, les autres pages rien', async () => {
    const p = projet('asset-calc-table')
    writeFileSync(join(p.srcDir, 'jeu.mjs'), JEU)
    writeFileSync(join(p.srcDir, 'accueil.mjs'), ACCUEIL)
    const stats = await construire(p)
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const jeu = codeDe(p, 'jeu')
    for (const i of [1, 2, 3]) assert.match(jeu, new RegExp(`/mjs/pick-${i}-[0-9a-f]{8}\\.mp3`))
    assert.equal(jeu.match(/\/mjs\/corner-[0-9a-f]{8}\.svg/g)?.length, 2, jeu)
    assert.doesNotMatch(jeu, /drop|edge|pick-4/)
    assert.doesNotMatch(jeu, /asset\(/)
    const accueil = codeDe(p, 'accueil')
    assert.doesNotMatch(accueil, /pick-|corner|__proto__|console\.warn/)
    const sortie = readdirSync(p.outDir)
    assert.equal(sortie.filter(f => /^pick-[123]-[0-9a-f]{8}\.mp3$/.test(f)).length, 3, sortie.join(', '))
    assert.equal(sortie.filter(f => /^corner-[0-9a-f]{8}\.svg$/.test(f)).length, 2, sortie.join(', '))
    assert.equal(sortie.some(f => /^(drop|edge)-/.test(f)), false, sortie.join(', '))
  })

  it('Civet entre parenthèses : µasset("…#{n}…") est un nom calculé, jamais un chemin pris tel quel', async () => {
    const p = projet('asset-calc-paren')
    writeFileSync(join(p.srcDir, 'jeu.mjs'), JEU_PARENTHESES)
    const stats = await construire(p)
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const jeu = codeDe(p, 'jeu')
    assert.match(jeu, /\/mjs\/pick-2-[0-9a-f]{8}\.mp3/)
    assert.doesNotMatch(jeu, /#\{|MISSING_MJS_ASSET/)
  })

  for (const env of ['dev', 'prod']) {
    it(`${env} : l'appel posé dans une chaîne et l'alias mjsasset sont lus comme le motif, rien ne part au navigateur`, async () => {
      const p = projet(`asset-calc-formes-${env}`)
      writeFileSync(join(p.srcDir, 'jeu.mjs'), JEU_FORMES)
      const stats = await construire(p, { env })
      assert.equal(stats.errors.length, 0, erreurs(stats))
      const jeu = codeDe(p, 'jeu')
      assert.equal(jeu.match(/\/mjs\/pick-2-[0-9a-f]{8}\.mp3/g)?.length, 2, jeu)
      assert.doesNotMatch(jeu, /asset\(/)
    })
  }

  it('l\'appel posé dans un gabarit JavaScript, l\'alias mjs.asset, un chemin écrit dans un gabarit : tous résolus', async () => {
    const p  = projet('asset-calc-gabarit')
    const b  = bundler(p)
    const js = await b.resolveMagicAssets('const x = `son : ${µ.asset(`sounds/chess/pick-${n}.mp3`)} ${mjs.asset(`sounds/chess/pick-${n}.mp3`)} ${µ.asset(\'sounds/chess/drop.mp3\')}`;')
    await b.close()
    assert.match(jouer(js, 2).x, /^son : \/mjs\/pick-2-[0-9a-f]{8}\.mp3 \/mjs\/pick-2-[0-9a-f]{8}\.mp3 \/mjs\/drop-[0-9a-f]{8}\.mp3$/)
    assert.doesNotMatch(js, /asset\(/)
  })

  it('à l\'exécution : l\'adresse du nom choisi ; un nom absent rend une adresse vide et avertit en développement', async () => {
    const p  = projet('asset-calc-exec')
    const b  = bundler(p)
    const js = await b.resolveMagicAssets('const x = µ.asset(`sounds/chess/pick-${n}.mp3`);')
    await b.close()
    const deux = jouer(js, 2)
    assert.match(deux.x, /^\/mjs\/pick-2-[0-9a-f]{8}\.mp3$/)
    assert.equal(deux.avis.length, 0)
    const absent = jouer(js, 9)
    assert.equal(absent.x, '')
    assert.equal(absent.avis.length, 1)
    assert.match(absent.avis[0], /sounds\/chess\/pick-9\.mp3/)
    assert.equal(jouer(js, 'constructor').x, '')
  })

  it('en production : même table, un nom absent rend une adresse vide sans avertissement', async () => {
    const p  = projet('asset-calc-prod')
    const b  = bundler(p, { env: 'prod' })
    const js = await b.resolveMagicAssets('const x = µ.asset(`sounds/chess/pick-${n}.mp3`);')
    await b.close()
    assert.match(jouer(js, 3).x, /^\/mjs\/pick-3-[0-9a-f]{8}\.mp3$/)
    const absent = jouer(js, 9)
    assert.equal(absent.x, '')
    assert.equal(absent.avis.length, 0)
    assert.doesNotMatch(js, /console\.warn/)
  })

  for (const env of ['dev', 'prod']) {
    it(`${env} : un fichier nommé __proto__ est une clé comme une autre`, async () => {
      const p = projet(`asset-calc-proto-${env}`)
      writeFileSync(join(p.srcDir, 'jeu.mjs'), '<script>\n$x = \'a\'\n$son = µasset "sounds/proto/#{$x}.mp3"\n</script>\n<audio src={$son}></audio>\n')
      const stats = await construire(p, { env })
      assert.equal(stats.errors.length, 0, erreurs(stats))
      assert.match(codeDe(p, 'jeu'), /__proto__-[0-9a-f]{8}\.mp3/)
      const b  = bundler(p, { env })
      const js = await b.resolveMagicAssets('const x = µ.asset(`sounds/proto/${n}.mp3`);')
      await b.close()
      assert.match(jouer(js, '__proto__').x, /^\/mjs\/__proto__-[0-9a-f]{8}\.mp3$/)
      assert.match(jouer(js, 'a').x, /^\/mjs\/a-[0-9a-f]{8}\.mp3$/)
      assert.equal(jouer(js, 'toString').x, '')
    })
  }

  it('un nom calculé en entier, sans extension écrite ou passé tel quel arrête la construction, avec la bonne écriture', async () => {
    const p = projet('asset-calc-large')
    const b = bundler(p)
    for (const appel of ['µ.asset(`${x}`)', 'µ.asset(`${x}.mp3`)', 'µ.asset(`sounds/chess/${x}`)', 'µ.asset(nom)']) {
      await assert.rejects(b.resolveMagicAssets(`const y = ${appel};`), BONNE_ECRITURE, appel)
    }
    await b.close()
    writeFileSync(join(p.srcDir, 'large.mjs'), '<script>\n$x = \'a\'\n$s = µasset "#{$x}.mp3"\n</script>\n<p>{$s}</p>\n')
    const stats = await construire(p)
    assert.match(erreurs(stats), BONNE_ECRITURE)
    assert.match(erreurs(stats), /\$s = µasset "#\{\$x\}\.mp3"/)
  })

  it('un motif auquel aucun fichier ne répond arrête la construction ; un motif qui ne vise que du code le dit', async () => {
    const p = projet('asset-calc-vide')
    const b = bundler(p)
    await assert.rejects(b.resolveMagicAssets('const y = µ.asset(`sounds/piano/note-${n}.mp3`);'), /sounds\/piano\/note-/)
    await assert.rejects(b.resolveMagicAssets('const y = µ.asset(`sounds/chess/pick-${n}.js`);'), /fichiers de code[^]*pick-4\.js[^]*µimport/)
    await b.close()
  })

  it('un gabarit sans partie calculée est un chemin écrit : résolu comme µasset(\'…\')', async () => {
    const p  = projet('asset-calc-fixe')
    const b  = bundler(p)
    const js = await b.resolveMagicAssets('const x = µ.asset(`sounds/chess/drop.mp3`);')
    await b.close()
    assert.match(jouer(js, 0).x, /^\/mjs\/drop-[0-9a-f]{8}\.mp3$/)
  })

  it('mjs dev : un son ajouté, retiré ou modifié dans le dossier du motif refait la table du composant', async () => {
    const p = projet('asset-calc-dev')
    writeFileSync(join(p.srcDir, 'jeu.mjs'), JEU)
    const b = bundler(p)
    await b.watch()
    try {
      const table = () => codeDe(p, 'jeu')
      writeFileSync(join(p.srcDir, 'sounds/chess/pick-7.mp3'), 'ID3son7')
      await attendre(() => /"7":"\/mjs\/pick-7-[0-9a-f]{8}\.mp3"/.test(table()), 'pick-7.mp3 ajouté : absent de la table')
      rmSync(join(p.srcDir, 'sounds/chess/pick-3.mp3'))
      await attendre(() => !/"3":/.test(table()), 'pick-3.mp3 retiré : encore dans la table')
      const avant = table().match(/"2":"([^"]+)"/)![1]
      writeFileSync(join(p.srcDir, 'sounds/chess/pick-2.mp3'), 'ID3son2-modifie')
      await attendre(() => (table().match(/"2":"([^"]+)"/) ?? [])[1] !== avant, 'pick-2.mp3 modifié : même adresse')
    }
    finally {
      await b.close()
    }
  })

  it('un nom collé par + est lu comme un motif ; sans extension écrite, il est refusé', async () => {
    const p = projet('asset-calc-plus')
    writeFileSync(join(p.srcDir, 'jeu.mjs'), '<script>\n$n = 1\n$son = µasset(\'sounds/chess/pick-\' + $n + \'.mp3\')\n</script>\n<audio src={$son}></audio>\n')
    const stats = await construire(p)
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const jeu = codeDe(p, 'jeu')
    for (const i of [1, 2, 3]) assert.match(jeu, new RegExp(`/mjs/pick-${i}-[0-9a-f]{8}\\.mp3`))
    assert.doesNotMatch(jeu, /asset\(|drop/)
    const b  = bundler(p)
    const js = await b.resolveMagicAssets('const x = µ.asset(\'sounds/chess/pick-\' + n + \'.mp3\') + \'|\' + µ.asset("images/habillage/" + n + "/corner.svg");')
    assert.match(jouer(js, 2).x, /^\/mjs\/pick-2-[0-9a-f]{8}\.mp3\|$/)
    assert.match(jouer(js, 'bois').x, /^\|\/mjs\/corner-[0-9a-f]{8}\.svg$/)
    await assert.rejects(b.resolveMagicAssets('const y = µ.asset(\'sounds/chess/pick-\' + n);'), BONNE_ECRITURE)
    await b.close()
  })

  it('µasset?(…) et µasset?.(…) sont des appels : résolus comme µasset(…)', async () => {
    const p = projet('asset-calc-option')
    writeFileSync(join(p.srcDir, 'jeu.mjs'), '<script>\n$n = 1\n$son = µasset?("sounds/chess/pick-#{$n}.mp3")\n$fin = µasset?("sounds/chess/drop.mp3")\n</script>\n<audio src={$son}></audio><audio src={$fin}></audio>\n')
    const stats = await construire(p, { env: 'prod' })
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const jeu = codeDe(p, 'jeu')
    assert.match(jeu, /\/mjs\/pick-2-[0-9a-f]{8}\.mp3/)
    assert.match(jeu, /\/mjs\/drop-[0-9a-f]{8}\.mp3/)
    assert.doesNotMatch(jeu, /asset/)
    const b  = bundler(p)
    const js = await b.resolveMagicAssets('const x = µ.asset?.(`sounds/chess/pick-${n}.mp3`) + \'|\' + mjs.asset?.(\'sounds/chess/drop.mp3\');')
    await b.close()
    assert.match(jouer(js, 3).x, /^\/mjs\/pick-3-[0-9a-f]{8}\.mp3\|\/mjs\/drop-[0-9a-f]{8}\.mp3$/)
  })

  it('µasset pris comme valeur ou lu sur un autre objet arrête la construction, avec l\'appel direct à écrire', async () => {
    const p = projet('asset-calc-valeur')
    const b = bundler(p)
    for (const usage of ['[\'sounds/chess/drop.mp3\'].map(µ.asset)', 'µ.asset', 'µ.asset.call(null, \'sounds/chess/drop.mp3\')', 'µ[\'asset\'](\'sounds/chess/drop.mp3\')', 'window.mjs.asset(`sounds/chess/pick-${n}.mp3`)', 'globalThis.µ.asset(\'sounds/chess/drop.mp3\')']) {
      await assert.rejects(b.resolveMagicAssets(`const y = ${usage};`), /une rune s'appelle directement[^]*µasset "sounds\/chess\/pick-#\{n\}\.mp3"/, usage)
    }
    await b.close()
    writeFileSync(join(p.srcDir, 'valeur.mjs'), '<script>\nsons = [\'sounds/chess/drop.mp3\'].map(µasset)\n</script>\n<p>{sons}</p>\n')
    const stats = await construire(p)
    assert.match(erreurs(stats), /sons = \['sounds\/chess\/drop\.mp3'\]\.map\(µasset\)[^]*une rune s'appelle directement/)
  })

  it('le refus cite la ligne de l\'appel fautif, jamais une ligne d\'avant qui parle d\'asset', async () => {
    const p = projet('asset-calc-ligne')
    writeFileSync(join(p.srcDir, 'large.mjs'), '<script>\n$n = 1\n$ok = µasset "sounds/chess/pick-#{$n}.mp3"\n$son = µasset "#{$n}.mp3"\n</script>\n<p>{$ok}{$son}</p>\n')
    writeFileSync(join(p.srcDir, 'court.mjs'), '<script>\n# les assets du jeu : des .mp3 de sounds/chess/pick-\n$n = 1\n$ok = µasset "sounds/chess/pick-#{$n}.mp3"\n$son = µasset(\'sounds/chess/pick-\' + $n)\n</script>\n<p>{$ok}{$son}</p>\n')
    const stats = await construire(p)
    assert.equal(stats.errors.length, 2, erreurs(stats))
    const large = stats.errors.map(e => e.message).find(m => m.includes('large.mjs'))!
    const court = stats.errors.map(e => e.message).find(m => m.includes('court.mjs'))!
    assert.match(large, /µasset : \$son = µasset "#\{\$n\}\.mp3"/)
    assert.match(court, /µasset : \$son = µasset\('sounds\/chess\/pick-' \+ \$n\)/)
  })

  it('mjs dev : un son cité par un chemin écrit en dur, puis modifié, change d\'adresse', async () => {
    const p = projet('asset-calc-dev-ecrit')
    writeFileSync(join(p.srcDir, 'jeu.mjs'), '<script>\nson = µasset "sounds/chess/pick-2.mp3"\n</script>\n<p>{son}</p>\n')
    const b = bundler(p)
    await b.watch()
    try {
      const adresse = () => (codeDe(p, 'jeu').match(/\/mjs\/pick-2-[0-9a-f]{8}\.mp3/) ?? [''])[0]
      const avant   = adresse()
      assert.ok(avant !== '', 'adresse de départ attendue')
      writeFileSync(join(p.srcDir, 'sounds/chess/pick-2.mp3'), 'ID3son2-modifie')
      await attendre(() => adresse() !== avant, 'pick-2.mp3 modifié : même adresse')
    }
    finally {
      await b.close()
    }
  })
})
