// Ce que ce test garantit : `µimport('chemin')` charge à la demande un module que MJS compile (`.civet`,
// `.coffee` : ce que `@import` accepte comme module autonome), comme il charge déjà un `.js`.
// Le module est compilé au build et publié dans SON fichier à empreinte ; l'appel devient un import
// dynamique de ce fichier, jamais un import statique du composant qui l'écrit. Les `@import` du module
// suivent, à toute profondeur ; un module `@import`é par un composant ET `µimport`é ailleurs reste UNE
// seule instance (même fichier visé des deux côtés). Valable en fichiers séparés (`js: 'split'`) et en
// fichier unique (`js: 'bundle'`, où le module sort dans son propre fichier), en développement comme en
// production. Un composant `.mjs` n'est pas un module : refus net au build.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PARTAGE = "window.__evaluations = (window.__evaluations ?? 0) + 1\nexport marque := 'partage'\nexport compteur := { n: 0 }\n"
const BOUGIE  = "@import marque 'partage.module.civet'\n@import compteur 'partage.module.civet'\n\nexport dessiner = -> \"flamme #{marque}\"\nexport lire = -> compteur.n\nexport default { nom: 'bougie' }\n"
const HOTE    = ["@import compteur 'partage.module.civet'", '', '<script>', '  $dessin = \'rien\'', '  @charger = ->', "    moteur = await µimport('moteurs/bougie.module.civet')", '    $dessin = moteur.dessiner()', '  @compter = -> compteur.n++', '</script>', '', '<button class="charger" @click=@charger>charger</button>', '<p class="d">{$dessin}</p>', ''].join('\n')

interface Projet { srcDir: string, outDir: string, manifest: string }
interface Options { env?: 'prod', js?: 'split' | 'bundle', dedupWaitTimeoutMs?: number }

function projet(prefixe: string, fichiers: Record<string, string>): Projet {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'out', 'bundle.js') }
}

async function construire(p: Projet, opts: Options = {}): Promise<{ errors: string[], warnings: string[] }> {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, urlPrefix: '/out', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  return { errors: stats.errors.map((e: any) => e.message), warnings: stats.warnings }
}

const echappe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** les fichiers publiés d'un module (`<base>-<empreinte>.js`), empreinte courte base 36 ou 8 hexadécimaux */
function publies(outDir: string, base: string): string[] {
  return readdirSync(outDir).filter(f => new RegExp(`^${echappe(base)}-(?:[0-9a-z]{5}|[a-f0-9]{8})\\.js$`).test(f))
}

const lire = (p: Projet, fichier: string): string => readFileSync(join(p.outDir, fichier), 'utf8')

/** une citation de `fichier` dans un import STATIQUE (`from '…'`, `import '…'`) */
const importStatique = (code: string, fichier: string): boolean => new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*)['"][^'"]*${echappe(fichier)}['"]`).test(code)

describe('µimport d\'un module MJS — fichiers séparés (js: split)', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('µimport(.civet) : le module est publié dans son fichier à empreinte, le composant ne le charge que par import dynamique', async () => {
    const p = projet('imm-split-dev', { 'hote.mjs': HOTE, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [bougie] = publies(p.outDir, 'bougie.module')
    assert.ok(bougie, `bougie.module-<empreinte>.js publié : ${readdirSync(p.outDir).join(', ')}`)
    const hote = readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!
    const code = lire(p, hote)
    assert.match(code, new RegExp(`µ\\._mjs_import\\('[^']*${echappe(bougie)}'\\)`), `le composant appelle µ._mjs_import sur le fichier du module :\n${code}`)
    assert.equal(importStatique(code, bougie), false, 'le composant n\'importe pas le module en statique')
    assert.match(lire(p, bougie), /export\b/, 'le module publié garde ses exports')
    assert.match(lire(p, bougie), /flamme/, 'et son code')
  })

  it('µimport(.coffee) : même publication, même chargement dynamique', async () => {
    const hote = ['<script>', '  go = ->', "    m = await µimport('lib/outil.module.coffee')", '    m', '</script>', '<p>x</p>', ''].join('\n')
    const p = projet('imm-coffee', { 'hote.mjs': hote, 'lib/outil.module.coffee': "export saluer = (nom) -> \"salut #{nom}\"\nexport default { nom: 'outil' }\n" })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [outil] = publies(p.outDir, 'outil.module')
    assert.ok(outil, `outil.module-<empreinte>.js publié : ${readdirSync(p.outDir).join(', ')}`)
    const code = lire(p, readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!)
    assert.match(code, new RegExp(`µ\\._mjs_import\\('[^']*${echappe(outil)}'\\)`))
    assert.equal(importStatique(code, outil), false)
  })

  it('l\'alias mjsimport, la forme sans parenthèses, un gestionnaire inline et un <script module> visent le même fichier', async () => {
    const hote = [
      '<script module>',
      "export charger = -> mjsimport('lib/a.module.civet')",
      '</script>',
      '<script>',
      "  go = -> µimport 'lib/a.module.civet'",
      '</script>',
      "<button @click={ µimport('lib/a.module.civet').then((m) => m) }>go</button>",
      '',
    ].join('\n')
    const p = projet('imm-formes', { 'hote.mjs': hote, 'lib/a.module.civet': 'export a := 1\n' })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [a] = publies(p.outDir, 'a.module')
    assert.ok(a, 'a.module publié')
    const code = lire(p, readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!)
    assert.equal(code.split(a).length - 1, 3, `les trois citations visent ${a} :\n${code}`)
    assert.equal(importStatique(code, a), false)
  })

  it('production (minifiée) : le fichier du module est cité par le composant, jamais en import statique', async () => {
    const p = projet('imm-split-prod', { 'hote.mjs': HOTE, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE })
    const { errors } = await construire(p, { env: 'prod' })
    assert.deepEqual(errors, [])
    const [bougie] = publies(p.outDir, 'bougie.module')
    assert.ok(bougie, 'bougie.module publié')
    const code = lire(p, readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!)
    assert.equal(code.split(bougie).length - 1, 1, 'le composant cite le fichier du module une fois')
    assert.equal(importStatique(code, bougie), false, 'et pas en statique')
  })

  it('les @import du module suivent, à toute profondeur : chaque maillon est publié et chaque import mène à un fichier présent', async () => {
    const hote = ['<script>', '  go = ->', "    m = await µimport('lib/a.module.civet')", '    m', '</script>', '<p>x</p>', ''].join('\n')
    const p = projet('imm-profondeur', {
      'hote.mjs':          hote,
      'lib/a.module.civet': "@import b 'lib/b.module.civet'\nexport a := -> b() + 'a'\n",
      'lib/b.module.civet': "@import c 'lib/c.module.civet'\nexport b := -> c() + 'b'\n",
      'lib/c.module.civet': "export c := -> 'c'\n",
    })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    for (const [nom, voisin] of [['a', 'b'], ['b', 'c']]) {
      const [fichier] = publies(p.outDir, `${nom}.module`)
      assert.ok(fichier, `${nom}.module publié`)
      const [attendu] = publies(p.outDir, `${voisin}.module`)
      assert.ok(attendu, `${voisin}.module publié`)
      assert.ok(lire(p, fichier).includes(attendu), `${nom}.module importe le fichier publié de ${voisin}.module (${attendu})`)
    }
  })

  it('un module qui µimporte un autre module : le second est publié et cité par le premier en import dynamique', async () => {
    const hote = ['<script>', '  go = ->', "    m = await µimport('lib/a.module.civet')", '    m', '</script>', '<p>x</p>', ''].join('\n')
    const p = projet('imm-module-vers-module', {
      'hote.mjs':           hote,
      'lib/a.module.civet': "export suite := -> µimport('lib/b.module.civet')\n",
      'lib/b.module.civet': "export b := 'b'\n",
    })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const [a] = publies(p.outDir, 'a.module')
    const [b] = publies(p.outDir, 'b.module')
    assert.ok(a && b, 'les deux modules sont publiés')
    const code = lire(p, a)
    assert.ok(code.includes(b), 'a.module cite le fichier de b.module')
    assert.equal(importStatique(code, b), false, 'en dynamique seulement')
  })

  it('un module @import-é par un composant ET µimport-é ailleurs : un seul fichier publié, visé des deux côtés', async () => {
    const autre = ['@import marque \'partage.module.civet\'', '<script>', '  go = ->', "    m = await µimport('partage.module.civet')", '    m', '</script>', '<p>{marque}</p>', ''].join('\n')
    const p = projet('imm-instance-unique', { 'hote.mjs': HOTE, 'autre.mjs': autre, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE })
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const partages = publies(p.outDir, 'partage.module')
    assert.equal(partages.length, 1, `un seul fichier partage.module : ${partages.join(', ')}`)
    const [partage] = partages
    const hote  = lire(p, readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!)
    const autreCode = lire(p, readdirSync(p.outDir).find(f => /^autre-[0-9a-z]{5}\.js$/.test(f))!)
    const bougie = lire(p, publies(p.outDir, 'bougie.module')[0])
    assert.equal(importStatique(hote, partage), true, 'l\'hôte l\'importe en statique')
    assert.equal(importStatique(bougie, partage), true, 'le module chargé à la demande l\'importe en statique, au même chemin')
    assert.ok(autreCode.includes(`_mjs_import('/out/${partage}')`) || new RegExp(`_mjs_import\\('[^']*${echappe(partage)}'\\)`).test(autreCode), 'et µimport vise ce même fichier')
  })

  it('trente-cinq moteurs chargés à la demande depuis un seul hôte : un fichier publié chacun, cités en import dynamique', async () => {
    const noms     = Array.from({ length: 35 }, (_, i) => 'moteur' + i)
    const fichiers: Record<string, string> = {
      'hote.mjs': ['<script>', ...noms.map(n => `  ${n} := -> µimport('flammes/${n}.module.civet')`), `  moteurs := { ${noms.join(', ')} }`, '</script>', '<p>x</p>', ''].join('\n'),
    }
    for (const n of noms) fichiers[`flammes/${n}.module.civet`] = `export dessiner = -> 'dessin-${n}'\n`
    const p = projet('imm-split-35', fichiers)
    const { errors } = await construire(p)
    assert.deepEqual(errors, [])
    const code = lire(p, readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!)
    for (const n of noms) {
      const [fichier] = publies(p.outDir, `${n}.module`)
      assert.ok(fichier, `${n}.module publié`)
      assert.equal(importStatique(code, fichier), false)
      assert.ok(code.includes(fichier), `l'hôte cite ${fichier}`)
    }
  })

  it('un cycle entre modules reste refusé avec le message du cycle d\'@import, qu\'il passe par µimport ou par @import', async () => {
    const hote = ['<script>', '  go = ->', "    m = await µimport('lib/a.module.civet')", '    m', '</script>', '<p>x</p>', ''].join('\n')
    const statique = projet('imm-cycle-import', {
      'hote.mjs':           hote,
      'lib/a.module.civet': "@import b 'lib/b.module.civet'\nexport a := -> b\n",
      'lib/b.module.civet': "@import a 'lib/a.module.civet'\nexport b := -> a\n",
    })
    const { errors: e1 } = await construire(statique, { dedupWaitTimeoutMs: 300 })
    assert.ok(e1.some(m => /Cycle @import\/µasset détecté/.test(m)), `cycle attendu, reçu : ${JSON.stringify(e1)}`)
    const paresseux = projet('imm-cycle-muimport', {
      'hote.mjs':           hote,
      'lib/a.module.civet': "export a := -> µimport('lib/b.module.civet')\n",
      'lib/b.module.civet': "export b := -> µimport('lib/a.module.civet')\n",
    })
    const { errors: e2 } = await construire(paresseux, { dedupWaitTimeoutMs: 300 })
    assert.ok(e2.some(m => /Cycle @import\/µasset détecté/.test(m)), `cycle attendu, reçu : ${JSON.stringify(e2)}`)
  })

  it('une fermeture qui change : le module d\'un maillon profond modifié renomme le fichier chargé, l\'hôte suit (même instance, deux builds)', async () => {
    const hote = ['<script>', '  go = ->', "    m = await µimport('lib/a.module.civet')", '    m', '</script>', '<p>x</p>', ''].join('\n')
    const p = projet('imm-invalidation', {
      'hote.mjs':           hote,
      'lib/a.module.civet': "@import b 'lib/b.module.civet'\nexport a := -> b() + 'a'\n",
      'lib/b.module.civet': "export b := -> 'v1'\n",
    })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, urlPrefix: '/out' } as any)
    try {
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const avant = publies(p.outDir, 'a.module')[0]
      writeFileSync(join(p.srcDir, 'lib/b.module.civet'), "export b := -> 'v2'\n")
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const apres = publies(p.outDir, 'a.module')
      assert.equal(apres.length, 1, `une seule version de a.module : ${apres.join(', ')}`)
      assert.notEqual(apres[0], avant, 'a.module a changé de nom : son import de b.module a changé')
      const code = lire(p, readdirSync(p.outDir).find(f => /^hote-[0-9a-z]{5}\.js$/.test(f))!)
      assert.ok(code.includes(apres[0]), `l'hôte vise la nouvelle version ${apres[0]}`)
      assert.equal(code.includes(avant), false, 'et plus l\'ancienne')
    }
    finally {
      await bundler.close()
    }
  })
})

describe('µimport d\'un module MJS — fichier unique (js: bundle)', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const env of [undefined, 'prod'] as const) it(`${env === 'prod' ? 'production' : 'développement'} : le module sort dans son propre fichier, le fichier unique ne porte pas son code`, async () => {
    const p = projet('imm-bundle-' + (env ?? 'dev'), { 'hote.mjs': HOTE, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE })
    const { errors } = await construire(p, { js: 'bundle', ...(env ? { env } : {}) })
    assert.deepEqual(errors, [])
    const fichiers = readdirSync(p.outDir)
    const bougies  = fichiers.filter(f => /^bougie-[a-f0-9]{8}\.js$/.test(f))
    assert.equal(bougies.length, 1, `le module est publié dans son fichier : ${fichiers.join(', ')}`)
    const entree = readFileSync(p.manifest, 'utf8')
    assert.equal(entree.includes('flamme'), false, 'le fichier unique ne porte pas le code du module')
    assert.match(entree, new RegExp(`import\\(\\s*["']\\./${echappe(bougies[0])}["']\\s*\\)`), 'il l\'importe à la demande, par son nom publié')
    assert.match(readFileSync(join(p.outDir, bougies[0]), 'utf8'), /flamme/, 'le fichier du module porte son code')
  })

  it('un module @import-é par un composant ET µimport-é : une seule instance, le fichier du module repart du code partagé', async () => {
    const p = projet('imm-bundle-instance', { 'hote.mjs': HOTE, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE })
    const { errors } = await construire(p, { js: 'bundle', env: 'prod' })
    assert.deepEqual(errors, [])
    const tout = readdirSync(p.outDir).filter(f => f.endsWith('.js')).map(f => readFileSync(join(p.outDir, f), 'utf8'))
    assert.equal(tout.filter(c => c.includes('__evaluations')).length, 1, 'le code du module partagé n\'existe que dans un seul fichier')
  })

  it('l\'alias mjsimport, la forme sans parenthèses, un gestionnaire inline et un <script module> sortent le même module dans le même fichier', async () => {
    const hote = [
      '<script module>',
      "export charger = -> mjsimport('lib/a.module.civet')",
      '</script>',
      '<script>',
      "  go = -> µimport 'lib/a.module.civet'",
      '</script>',
      "<button @click={ µimport('lib/a.module.civet').then((m) => m) }>go</button>",
      '',
    ].join('\n')
    const p = projet('imm-bundle-formes', { 'hote.mjs': hote, 'lib/a.module.civet': "export a := 'unique-a'\n" })
    const { errors } = await construire(p, { js: 'bundle' })
    assert.deepEqual(errors, [])
    const fichiers = readdirSync(p.outDir).filter(f => /^a-[a-f0-9]{8}\.js$/.test(f))
    assert.equal(fichiers.length, 1, `un seul fichier pour le module : ${readdirSync(p.outDir).join(', ')}`)
    const entree = readFileSync(p.manifest, 'utf8')
    // l'export `charger` du <script module> n'est lu par personne : l'assemblage du fichier unique le retire, comme tout export inutilisé
    assert.equal(entree.split(fichiers[0]).length - 1, 2, `la fonction et le gestionnaire visent ${fichiers[0]}`)
    assert.doesNotMatch(entree, /["']mjs:unit\//, 'aucun spécificateur virtuel ne reste en chaîne dans le fichier unique')
    assert.equal(entree.includes('unique-a'), false)
  })

  it('reconstruction (même instance, comme mjs dev) : le module modifié change de fichier, l\'ancien part, l\'entrée suit', async () => {
    const hote = ['<script>', '  go = ->', "    m = await µimport('lib/a.module.civet')", '    m', '</script>', '<p>x</p>', ''].join('\n')
    const p = projet('imm-bundle-incremental', { 'hote.mjs': hote, 'lib/a.module.civet': "export a := 'version-1'\n" })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, urlPrefix: '/out', js: 'bundle' } as any)
    const fichiersA = (): string[] => readdirSync(p.outDir).filter(f => /^a-[a-f0-9]{8}\.js$/.test(f))
    const cartesA   = (): string[] => readdirSync(p.outDir).filter(f => /^a-[a-f0-9]{8}\.js\.map$/.test(f))
    try {
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const avant = fichiersA()
      assert.equal(avant.length, 1, `un fichier au premier tour : ${readdirSync(p.outDir).join(', ')}`)
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      assert.deepEqual(fichiersA(), avant, 'rien ne change entre deux tours identiques (unités resservies par le cache)')
      writeFileSync(join(p.srcDir, 'lib/a.module.civet'), "export a := 'version-2'\n")
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const apres = fichiersA()
      assert.equal(apres.length, 1, `une seule version du module : ${apres.join(', ')}`)
      assert.notEqual(apres[0], avant[0], 'le module modifié change de fichier')
      assert.ok(readFileSync(p.manifest, 'utf8').includes(apres[0]), 'l\'entrée vise le nouveau fichier')
      assert.match(readFileSync(join(p.outDir, apres[0]), 'utf8'), /version-2/)
      assert.deepEqual(cartesA(), [`${apres[0]}.map`], 'et seule la carte de la version courante reste')
      // le µimport disparaît : le module redevient une unité du fichier unique (sans fichier à lui), le code partagé retourne dans l'entrée
      writeFileSync(join(p.srcDir, 'hote.mjs'), '<p>x</p>\n')
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      assert.deepEqual(readdirSync(p.outDir).filter(f => /^(?:a|chunk)-[a-f0-9]{8}\.js(?:\.map)?$/.test(f)), [], 'plus aucun fichier de module ni de code partagé')
    }
    finally {
      await bundler.close()
    }
  })

  it('un .js cité par µimport garde son comportement : copié sous empreinte, appel sur son URL, fichier unique intact', async () => {
    const hote = ['<script>', '  go = ->', "    m = await µimport('lib/outil.js')", '    m', '</script>', '<p>x</p>', ''].join('\n')
    const p = projet('imm-bundle-js', { 'hote.mjs': hote, 'lib/outil.js': 'export const outil = 1\n' })
    const { errors } = await construire(p, { js: 'bundle' })
    assert.deepEqual(errors, [])
    const js = readdirSync(p.outDir).filter(f => f.endsWith('.js')).sort()
    assert.equal(js.length, 2, `le fichier unique et la copie du .js : ${js.join(', ')}`)
    const copie = js.find(f => /^outil-[a-f0-9]{8}\.js$/.test(f))
    assert.ok(copie, `outil-<empreinte>.js : ${js.join(', ')}`)
    assert.match(readFileSync(p.manifest, 'utf8'), new RegExp(`_mjs_import\\(\\s*["']/out/${echappe(copie!)}["']\\s*\\)`), 'l\'appel vise l\'URL de la copie')
  })

  it('trente-cinq moteurs chargés à la demande depuis un seul hôte : un fichier chacun, rien d\'eux dans le fichier unique', async () => {
    const noms     = Array.from({ length: 35 }, (_, i) => 'moteur' + i)
    const fichiers: Record<string, string> = {
      'hote.mjs': ['<script>', ...noms.map(n => `  ${n} := -> µimport('flammes/${n}.module.civet')`), `  moteurs := { ${noms.join(', ')} }`, '</script>', '<p>x</p>', ''].join('\n'),
    }
    for (const n of noms) fichiers[`flammes/${n}.module.civet`] = `export dessiner = -> 'dessin-${n}'\n`
    const p = projet('imm-bundle-35', fichiers)
    const { errors } = await construire(p, { js: 'bundle', env: 'prod' })
    assert.deepEqual(errors, [])
    const sortis = readdirSync(p.outDir).filter(f => /^moteur\d+-[a-f0-9]{8}\.js$/.test(f))
    assert.equal(sortis.length, 35, `un fichier par moteur : ${readdirSync(p.outDir).join(', ')}`)
    assert.equal(/dessin-moteur\d+/.test(readFileSync(p.manifest, 'utf8')), false, 'aucun moteur dans le fichier unique')
  })

  it('un fichier unique sans µimport de module garde un fichier unique', async () => {
    const p = projet('imm-bundle-sans', { 'hote.mjs': '<p>x</p>\n', 'partage.module.civet': PARTAGE })
    const { errors } = await construire(p, { js: 'bundle', env: 'prod' })
    assert.deepEqual(errors, [])
    assert.deepEqual(readdirSync(p.outDir).filter(f => f.endsWith('.js')), ['bundle.js'])
  })
})

describe('µimport d\'un module MJS — application installable', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const js of ['split', 'bundle'] as const) it(`${js === 'split' ? 'fichiers séparés' : 'fichier unique'} : le fichier du module figure au précache, pour que l'application chargée hors ligne le trouve`, async () => {
    const p = projet('imm-precache-' + js, { 'hote.mjs': HOTE, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE })
    const { errors } = await construire(p, { js, env: 'prod' })
    assert.deepEqual(errors, [])
    const fichier = readdirSync(p.outDir).find(f => /^bougie(?:\.module)?-(?:[0-9a-z]{5}|[a-f0-9]{8})\.js$/.test(f))
    assert.ok(fichier, `le fichier du module est publié : ${readdirSync(p.outDir).join(', ')}`)
    const precache = JSON.parse(readFileSync(join(p.outDir, 'mjs-precache.json'), 'utf8')) as { assets: string[] }
    assert.ok(precache.assets.includes(`/out/${fichier}`), `précache : ${precache.assets.join(', ')}`)
  })
})

describe('µimport d\'un module MJS — mjs build --prod avec rendu serveur', function () {
  this.timeout(180000)

  const racine = join(dirname(fileURLToPath(import.meta.url)), '..')

  // le rendu serveur recompile le projet en fichiers séparés dans un dossier à lui, quel que soit le mode : le module chargé à la
  // demande y suit les règles de n'importe quel module, et le dossier de sortie du build garde son mode
  for (const js of ['split', 'bundle'] as const) it(`${js === 'split' ? 'fichiers séparés' : 'fichier unique'} : le build passe, le rendu serveur monte l'hôte, le module est publié`, () => {
    const root = mjsTmp('imm-cli-' + js)
    for (const [chemin, contenu] of Object.entries({ 'hote.mjs': HOTE, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE })) {
      mkdirSync(dirname(join(root, 'src', chemin)), { recursive: true })
      writeFileSync(join(root, 'src', chemin), contenu)
    }
    const config = { sourceDir: 'src', outputDir: 'dist', manifestPath: 'dist/bundle.js', urlPrefix: '/dist', js, runtime: 'core', render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-hote' } } } }
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
    const resultat = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root, '--prod'], { cwd: racine, encoding: 'utf-8' })
    assert.equal(resultat.status, 0, `build en échec :\n${resultat.stderr}\n${resultat.stdout}`)
    const fichiers = readdirSync(join(root, 'dist'))
    const attendu  = js === 'split' ? /^bougie\.module-[0-9a-z]{5}\.js$/ : /^bougie-[a-f0-9]{8}\.js$/
    assert.ok(fichiers.some(f => attendu.test(f)), `le module est publié : ${fichiers.join(', ')}`)
    if (js === 'bundle') assert.equal(readFileSync(join(root, 'dist', 'bundle.js'), 'utf8').includes('flamme'), false, 'le fichier unique ne porte pas le code du module')
  })
})

describe('µimport — cibles refusées au build', function () {
  this.timeout(60000)

  after(async () => {
    setMessagesLang('fr')
    await terminateSharedWorkerPool()
  })

  const hote = (cible: string): string => ['<script>', '  go = ->', `    m = await µimport('${cible}')`, '    m', '</script>', '<p>x</p>', ''].join('\n')

  it('un composant .mjs : refus net qui dit que ce n\'est pas un module (français)', async () => {
    setMessagesLang('fr')
    const p = projet('imm-refus-mjs-fr', { 'hote.mjs': hote('lib/carte.mjs'), 'lib/carte.mjs': '<p>carte</p>\n' })
    const { errors } = await construire(p)
    assert.ok(errors.some(m => /µimport ne charge pas un composant « \.mjs »/.test(m) && /lib\/carte\.mjs/.test(m)), `refus attendu, reçu : ${JSON.stringify(errors)}`)
  })

  it('un composant .mjs : même refus en anglais', async () => {
    setMessagesLang('en')
    const p = projet('imm-refus-mjs-en', { 'hote.mjs': hote('lib/carte.mjs'), 'lib/carte.mjs': '<p>carte</p>\n' })
    const { errors } = await construire(p)
    setMessagesLang('fr')
    assert.ok(errors.some(m => /µimport does not load an "\.mjs" component/.test(m) && /lib\/carte\.mjs/.test(m)), `refus attendu, reçu : ${JSON.stringify(errors)}`)
  })

  it('une extension qui n\'est pas un module (.css) : refus qui nomme les extensions acceptées, en français puis en anglais', async () => {
    setMessagesLang('fr')
    const p = projet('imm-refus-css', { 'hote.mjs': hote('style.css'), 'style.css': 'p { color: red }\n' })
    const { errors } = await construire(p)
    assert.ok(errors.some(m => /« \.js »/.test(m) && /« \.civet »/.test(m) && /« \.coffee »/.test(m) && /style\.css/.test(m)), `refus attendu, reçu : ${JSON.stringify(errors)}`)
    setMessagesLang('en')
    const q = projet('imm-refus-css-en', { 'hote.mjs': hote('style.css'), 'style.css': 'p { color: red }\n' })
    const { errors: anglais } = await construire(q)
    setMessagesLang('fr')
    assert.ok(anglais.some(m => /"\.js"/.test(m) && /"\.civet"/.test(m) && /"\.coffee"/.test(m) && /style\.css/.test(m)), `refus attendu, reçu : ${JSON.stringify(anglais)}`)
  })

  it('un chemin calculé reste refusé (littéral exigé), un module absent fait échouer le build', async () => {
    const calcule = projet('imm-refus-calcule', { 'hote.mjs': ['<script>', '  go = (nom) -> µimport(nom)', '</script>', '<p>x</p>', ''].join('\n') })
    const { errors: e1 } = await construire(calcule)
    assert.ok(e1.some(m => /µimport exige un chemin littéral/.test(m)), `refus attendu, reçu : ${JSON.stringify(e1)}`)
    const absent = projet('imm-refus-absent', { 'hote.mjs': hote('lib/inconnu.module.civet') })
    const { errors: e2 } = await construire(absent)
    assert.ok(e2.length > 0 && e2.some(m => /inconnu\.module\.civet/.test(m)), `build en échec attendu, reçu : ${JSON.stringify(e2)}`)
    assert.equal(existsSync(join(absent.outDir, 'inconnu.module.js')), false)
  })
})
