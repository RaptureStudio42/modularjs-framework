// Ce que ce test garantit : un fichier .js que le build copie sous un nom à empreinte (cible d'un
// µimport, d'un @import ou d'un µasset) et qui importe un voisin par chemin relatif
// (`import … from './rng.js'`) garde, une fois publié, des imports qui mènent quelque part. Dans le
// dossier de sortie, le voisin n'existe (s'il existe) que sous SON nom à empreinte : l'import
// d'origine, recopié tel quel, menait à un 404 à l'exécution. Le build publie donc chaque voisin et
// réécrit l'import vers son nom publié ; l'empreinte du fichier qui importe se calcule après
// réécriture, pour qu'un voisin modifié change aussi le nom de celui qui l'importe (cache navigateur).
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const RNG  = 'export const rand = () => 4\n'
const MAIN = "import { rand } from './rng.js'\nexport const roll = () => rand()\n"

function projet(prefixe: string, fichiers: Record<string, string>): { srcDir: string; outDir: string; manifest: string } {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

function hoteQuiImporte(cible: string): string {
  return ['<script>', '  go = ->', `    m = await µimport('${cible}')`, '    m', '</script>', '<p>x</p>'].join('\n')
}

async function construire(p: { srcDir: string; outDir: string; manifest: string }): Promise<{ errors: string[] }> {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
  const stats   = await bundler.compile()
  await bundler.close()
  return { errors: stats.errors.map((e: any) => e.message) }
}

function publie(outDir: string, base: string): string[] {
  return readdirSync(outDir).filter(f => new RegExp(`^${base}-(?:[0-9a-z]{5}|[a-f0-9]{8})\\.js$`).test(f))
}

/** spécificateurs relatifs d'un .js publié : import/export … from, import nu, import() */
function relatifs(code: string): string[] {
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]+)\1/g)].map(m => m[2])
}

/** chaque import relatif d'un fichier publié mène à un fichier réellement présent à côté de lui */
function assertImportsJoignables(outDir: string, fichier: string): void {
  const code = readFileSync(join(outDir, fichier), 'utf8')
  const specs = relatifs(code)
  assert.ok(specs.length > 0, `${fichier} : aucun import relatif trouvé — ${JSON.stringify(code)}`)
  for (const s of specs) assert.ok(existsSync(join(outDir, s)), `${fichier} importe '${s}', absent du dossier publié (404 à l'exécution) — ${JSON.stringify(code)}`)
}

describe('bundler — un .js copié réécrit ses imports relatifs vers les noms publiés de ses voisins', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it("µimport('lib/main.js') qui importe './rng.js' : l'import publié mène au voisin publié, qui porte bien son code", async () => {
    const p = projet('js-voisins-muimport', { 'hote.mjs': hoteQuiImporte('lib/main.js'), 'lib/main.js': MAIN, 'lib/rng.js': RNG })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [main] = publie(p.outDir, 'main')
    assert.ok(main, 'main publié sous empreinte')
    assertImportsJoignables(p.outDir, main)
    const cible = relatifs(readFileSync(join(p.outDir, main), 'utf8'))[0]
    assert.equal(readFileSync(join(p.outDir, cible), 'utf8'), RNG, 'le voisin publié est bien rng.js')
  })

  it('voisin déjà publié sous son empreinte par un autre composant : l\'import mène à CE fichier, pas à une seconde copie', async () => {
    const p = projet('js-voisins-deja-publie', { 'hote.mjs': hoteQuiImporte('lib/main.js'), 'autre.mjs': hoteQuiImporte('lib/rng.js'), 'lib/main.js': MAIN, 'lib/rng.js': RNG })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [main] = publie(p.outDir, 'main')
    const rngs   = publie(p.outDir, 'rng')
    assert.equal(rngs.length, 1, `un seul rng publié : ${rngs.join(', ')}`)
    assert.deepEqual(relatifs(readFileSync(join(p.outDir, main), 'utf8')), ['./'+ rngs[0]])
    const autre = readdirSync(p.outDir).find(f => /^autre-[0-9a-z]{5}\.js$/.test(f))!
    assert.ok(readFileSync(join(p.outDir, autre), 'utf8').includes(rngs[0]), 'le composant qui µimporte rng.js vise le même fichier')
  })

  it("@import roll 'lib/main.js' : même réécriture pour un .js importé par la directive", async () => {
    const hote = ["@import roll 'lib/main.js'", '<script>', '  go = -> roll()', '</script>', '<p>x</p>'].join('\n')
    const p = projet('js-voisins-directive', { 'hote.mjs': hote, 'lib/main.js': MAIN, 'lib/rng.js': RNG })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    assertImportsJoignables(p.outDir, publie(p.outDir, 'main')[0])
  })

  it('toutes les formes : re-exports, import nu, import() littéral, dossier parent, chaîne transitive', async () => {
    const main = [
      "import './side.js'",
      "export * from './a.js'",
      "export { b } from './b.js'",
      "import { util } from '../shared/util.js'",
      "export const lazy = () => import('./lazy.js')",
      'export const u = util',
    ].join('\n') +'\n'
    const p = projet('js-voisins-formes', {
      'hote.mjs':        hoteQuiImporte('lib/main.js'),
      'lib/main.js':     main,
      'lib/side.js':     'globalThis.side = 1\n',
      'lib/a.js':        'export const a = 1\n',
      'lib/b.js':        'export const b = 2\n',
      'lib/lazy.js':     "import { seed } from './seed.js'\nexport const z = seed\n",
      'lib/seed.js':     'export const seed = 7\n',
      'shared/util.js':  'export const util = 3\n',
    })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [pub] = publie(p.outDir, 'main')
    assertImportsJoignables(p.outDir, pub)
    assert.equal(relatifs(readFileSync(join(p.outDir, pub), 'utf8')).length, 5, 'les cinq imports relatifs réécrits')
    assertImportsJoignables(p.outDir, publie(p.outDir, 'lazy')[0])
  })

  it('laissés tels quels : spécificateur nu, absolu, URL, voisin absent, texte qui ressemble à un import ; un .js sans import relatif garde le nom de sa copie brute', async () => {
    const main = [
      "import * as three from 'three'",
      "import '/vendor/abs.js'",
      "import 'https://cdn.example/x.js'",
      "import './absent.js'",
      "export const doc = \"import { x } from './rng.js'\"",
      "// import { y } from './rng.js'",
    ].join('\n') +'\n'
    const p = projet('js-voisins-intacts', { 'hote.mjs': hoteQuiImporte('lib/main.js'), 'lib/main.js': main, 'lib/rng.js': RNG })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [pub] = publie(p.outDir, 'main')
    assert.equal(readFileSync(join(p.outDir, pub), 'utf8'), main, 'contenu recopié octet pour octet')
    assert.deepEqual(publie(p.outDir, 'rng'), [], 'rng.js jamais importé pour de vrai : pas publié')
  })

  it('deux voisins homonymes dans deux dossiers (a/util.js, b/util.js) : tous deux publiés et encore là après la purge de fin de build', async () => {
    const p = projet('js-voisins-homonymes', {
      'hote.mjs':      hoteQuiImporte('lib/main.js'),
      'lib/main.js':   "import { a } from './a/util.js'\nimport { b } from './b/util.js'\nexport const ab = a + b\n",
      'lib/a/util.js': 'export const a = 1\n',
      'lib/b/util.js': 'export const b = 2\n',
    })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    assert.equal(publie(p.outDir, 'util').length, 2, `les deux util publiés : ${publie(p.outDir, 'util').join(', ')}`)
    assertImportsJoignables(p.outDir, publie(p.outDir, 'main')[0])
  })

  it('modules partagés en treillis (22 niveaux, 4 millions de chemins) : chaque voisin publié une seule fois, le build reste instantané', async () => {
    const fichiers: Record<string, string> = { 'hote.mjs': hoteQuiImporte('lib/n0a.js') }
    for (let i = 0; i < 22; i++) {
      for (const c of ['a', 'b']) {
        fichiers[`lib/n${i}${c}.js`] = i < 21 ? `import { v as x } from './n${i + 1}a.js'\nimport { v as y } from './n${i + 1}b.js'\nexport const v = x + y + '${c}'\n` : `export const v = '${c}'\n`
      }
    }
    const p = projet('js-voisins-treillis', fichiers)
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    assert.equal(readdirSync(p.outDir).filter(f => /^n\d+[ab]-[a-f0-9]{8}\.js$/.test(f)).length, 43, 'la racine et ses 42 voisins, chacun une fois')
    assertImportsJoignables(p.outDir, publie(p.outDir, 'n0a')[0])
  })

  it('un voisin modifié change le nom publié du fichier qui l\'importe (deux builds)', async () => {
    const p = projet('js-voisins-empreinte', { 'hote.mjs': hoteQuiImporte('lib/main.js'), 'lib/main.js': MAIN, 'lib/rng.js': RNG })
    assert.deepEqual((await construire(p)).errors, [])
    const avant = publie(p.outDir, 'main')[0]
    writeFileSync(join(p.srcDir, 'lib/rng.js'), 'export const rand = () => 5\n')
    assert.deepEqual((await construire(p)).errors, [])
    const apres = publie(p.outDir, 'main')
    assert.equal(apres.length, 1, `une seule version de main publiée : ${apres.join(', ')}`)
    assert.notEqual(apres[0], avant, 'main a changé de nom : son contenu (nom du voisin) a changé')
    assertImportsJoignables(p.outDir, apres[0])
  })

  it('build incrémental (même instance, comme mjs dev) : modifier le voisin seul republie la chaîne entière', async () => {
    const p = projet('js-voisins-incremental', { 'hote.mjs': hoteQuiImporte('lib/main.js'), 'lib/main.js': MAIN, 'lib/rng.js': RNG })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const avant = publie(p.outDir, 'main')[0]
      writeFileSync(join(p.srcDir, 'lib/rng.js'), 'export const rand = () => 6\n')
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const hote = readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!
      const vise = readFileSync(join(p.outDir, hote), 'utf8').match(/main-[a-f0-9]{8}\.js/)![0]
      assert.notEqual(vise, avant, 'le composant vise la nouvelle version de main')
      assertImportsJoignables(p.outDir, vise)
      const rng = relatifs(readFileSync(join(p.outDir, vise), 'utf8'))[0]
      assert.equal(readFileSync(join(p.outDir, rng), 'utf8'), 'export const rand = () => 6\n', 'et main vise le nouveau rng')
    }
    finally {
      await bundler.close()
    }
  })

  it('cycle entre fichiers copiés (a.js ↔ b.js) : erreur de build qui nomme la chaîne, jamais un import cassé en silence', async () => {
    const p = projet('js-voisins-cycle', {
      'hote.mjs': hoteQuiImporte('lib/a.js'),
      'lib/a.js': "import { b } from './b.js'\nexport const a = () => b\n",
      'lib/b.js': "import { a } from './a.js'\nexport const b = () => a\n",
    })
    const { errors } = await construire(p)
    assert.ok(errors.some(m => /lib\/a\.js → lib\/b\.js → lib\/a\.js/.test(m)), `erreur de cycle attendue, reçu : ${JSON.stringify(errors)}`)
  })
})
