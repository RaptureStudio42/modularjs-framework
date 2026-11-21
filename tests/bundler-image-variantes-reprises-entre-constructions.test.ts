// Chaque construction réencodait avec sharp toutes les variantes des images, même inchangées : la mémoire des variantes ne vivait
// que le temps d'un processus, et `mjs build`, le premier passage de `mjs dev` ou le prérendu repartaient de zéro. Les variantes
// déjà encodées sont maintenant reprises du dossier de sortie d'une construction à l'autre, tant que l'image, les réglages et la
// version de sharp ne changent pas (index `.mjs-images.json`, à côté des sorties), chaque fichier repris vérifié par l'empreinte
// de son nom. Une construction = un processus, comme deux `mjs build` (compilation puis purge) ; `sharp` est un sharp factice qui
// compte ses encodages (dossier courant du processus), sauf dans le dernier cas : le vrai, quand il est installé.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'
import { resolveSharp } from '../src/bundler/image.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ses octets disent le format, la largeur et la qualité demandés : mêmes réglages, mêmes fichiers ; `versions` vient de
// l'environnement (FAUX_SHARP_VERSION), absent sous FAUX_SHARP_SANS_VERSIONS
const FAUX_SHARP = [
  'globalThis.encodages = 0',
  'function sharp(bytes) {',
  '  let width   = 0',
  '  let format  = \'\'',
  '  let quality = 0',
  '  const chain = {',
  '    resize(options) { width = options.width; return chain },',
  '    webp(options) { format = \'webp\'; quality = options.quality; return chain },',
  '    avif(options) { format = \'avif\'; quality = options.quality; return chain },',
  '    toBuffer() { globalThis.encodages++; return Promise.resolve({ data: Buffer.concat([Buffer.from(`variante ${format} ${width} ${quality} `), bytes]), info: { width } }) },',
  '  }',
  '  return chain',
  '}',
  'if (!process.env.FAUX_SHARP_SANS_VERSIONS) sharp.versions = { sharp: process.env.FAUX_SHARP_VERSION || \'1.0.0\', vips: \'8.0.0\' }',
  'module.exports = sharp',
].join('\n') + '\n'

// une construction comme `mjs build` : compilation (rien de publié en échec), puis la purge après une construction sans erreur ;
// `compter` : les encodages du vrai sharp, comptés à son `toBuffer`
const SCENARIO = [
  'import { writeFileSync } from \'node:fs\'',
  'import { join } from \'node:path\'',
  'const [root, bundlerUrl, imageUrl, optionsJson] = process.argv.slice(2)',
  'const options = JSON.parse(optionsJson)',
  'process.chdir(join(root, \'cwd\'))',
  'const { Bundler, terminateSharedWorkerPool } = await import(bundlerUrl)',
  'if (options.compter) {',
  '  const { resolveSharp } = await import(imageUrl)',
  '  const sharp    = await resolveSharp()',
  '  const toBuffer = sharp.prototype.toBuffer',
  '  globalThis.encodages = 0',
  '  sharp.prototype.toBuffer = function (...args) { globalThis.encodages++; return toBuffer.apply(this, args) }',
  '}',
  'const out     = join(root, options.out ?? \'out\')',
  'const bundler = new Bundler({ sourceDir: join(root, \'src\'), outputDir: out, manifestPath: join(out, \'bundle.js\'), keepFailedComponents: false, image: options.image, ...(options.env ? { env: options.env } : {}), ...(options.prune === false ? { prune: false } : {}) })',
  'const errors  = (await bundler.compile()).errors.map(e => e.message)',
  'const removed = errors.length === 0 ? bundler.pruneOrphans().removed : []',
  'await bundler.close()',
  'await terminateSharedWorkerPool()',
  'writeFileSync(join(root, \'resultat.json\'), JSON.stringify({ errors, encodages: globalThis.encodages ?? 0, removed }))',
  'process.exit(0)',
].join('\n') + '\n'

interface Construction { errors: string[], encodages: number, removed: string[] }

const REGLAGES = { widths: [320, 640], formats: ['webp'], quality: 78 }

const composant = (image: string): string => `<script>\n  photo = µimage('${image}')\n</script>\n<p>${image}</p>\n`

// un projet de deux images (deux largeurs chacune), un composant par image ; `sharp` : 'faux', 'vrai' (celui qu'on trouve) ou 'absent'
function projet(etiquette: string, sharp: 'faux' | 'vrai' | 'absent' = 'faux'): string {
  const root = mjsTmp('image-reprises-' + etiquette)
  mkdirSync(join(root, 'cwd'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  if (sharp === 'faux') {
    mkdirSync(join(root, 'cwd/node_modules/sharp'), { recursive: true })
    writeFileSync(join(root, 'cwd/node_modules/sharp/index.js'), FAUX_SHARP)
  }
  writeFileSync(join(root, 'src/a.png'), validPng(1200, 800))
  writeFileSync(join(root, 'src/b.png'), validPng(1000, 700))
  writeFileSync(join(root, 'src/ca.mjs'), composant('a.png'))
  writeFileSync(join(root, 'src/cb.mjs'), composant('b.png'))
  writeFileSync(join(root, 'scenario.mts'), SCENARIO)
  return root
}

// une construction dans un processus neuf ; `env` : réglages du faux sharp (le vrai, lui, se trouve par NODE_PATH)
function construire(root: string, options: { image?: object, compter?: boolean, env?: string, prune?: boolean, out?: string } = {}, env: Record<string, string> = {}, vrai = false): Construction {
  rmSync(join(root, 'resultat.json'), { force: true })
  const args = [join(root, 'scenario.mts'), root, pathToFileURL(join(repoRoot, 'src/bundler/index.ts')).href, pathToFileURL(join(repoRoot, 'src/bundler/image.ts')).href, JSON.stringify({ image: REGLAGES, ...options })]
  const run  = spawnSync('npx', ['tsx', ...args], { cwd: repoRoot, encoding: 'utf-8', timeout: 100000, env: { ...process.env, ...(vrai ? {} : { NODE_PATH: '' }), ...env } })
  assert.ok(existsSync(join(root, 'resultat.json')), `le scénario n'a rien rendu : ${run.stderr}${run.stdout}`)
  return JSON.parse(readFileSync(join(root, 'resultat.json'), 'utf-8'))
}

// chaque fichier du dossier de sortie (sous-dossiers compris) et l'empreinte de ses octets
function empreintes(dir: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const rel of (readdirSync(dir, { recursive: true }) as string[]).sort()) {
    if (statSync(join(dir, rel)).isFile()) found[rel] = createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')
  }
  return found
}

const variantes = (root: string, image: string): string[] => readdirSync(join(root, 'out')).filter(f => f.startsWith(`${image}-`) && /-[a-f0-9]{8}\.(?:webp|avif)$/.test(f)).sort()
const cheminIndex = (root: string): string => join(root, 'out/.mjs-images.json')
const lireIndex   = (root: string): Record<string, { filename: string, width: number, format: string }[]> => JSON.parse(readFileSync(cheminIndex(root), 'utf-8'))

// chaque fichier que l'index cite est dans le dossier de sortie
function indexJuste(root: string): void {
  for (const [cle, liste] of Object.entries(lireIndex(root))) {
    for (const v of liste) assert.ok(existsSync(join(root, 'out', v.filename)), `l'index cite ${v.filename} (${cle}), absent du dossier de sortie`)
  }
}

describe('bundler — les variantes d\'image déjà encodées sont reprises d\'une construction à l\'autre', function () {
  this.timeout(240000)

  it('deux constructions de suite : la seconde n\'encode aucune variante, le dossier de sortie reste identique à l\'octet', () => {
    const root     = projet('deux-fois')
    const premiere = construire(root)
    const avant    = empreintes(join(root, 'out'))
    const seconde  = construire(root)
    assert.deepEqual([premiere.errors, seconde.errors], [[], []])
    assert.deepEqual([premiere.encodages, seconde.encodages], [4, 0], 'encodages de la première puis de la seconde construction')
    assert.deepEqual(empreintes(join(root, 'out')), avant)
    assert.ok(avant['.mjs-images.json'], 'l\'index des images est écrit à côté des sorties')
    assert.equal(Object.keys(lireIndex(root)).length, 2)
    assert.deepEqual(seconde.removed, [])
    // aucun chemin du poste dans ce fichier servi avec les sorties
    assert.ok(!readFileSync(cheminIndex(root), 'utf-8').includes(root), 'l\'index ne cite aucun chemin absolu')
  })

  it('une variante coupée ou retirée : seule son image se réencode, et le fichier revient juste', () => {
    const root  = projet('abimee')
    assert.equal(construire(root).encodages, 4)
    const avant = empreintes(join(root, 'out'))
    const coupe = join(root, 'out', variantes(root, 'a')[0])
    writeFileSync(coupe, readFileSync(coupe).subarray(0, 20))
    const apresCoupe = construire(root)
    assert.deepEqual([apresCoupe.errors, apresCoupe.encodages], [[], 2], 'une variante de a.png coupée : ses deux variantes réencodées, rien pour b.png')
    assert.deepEqual(empreintes(join(root, 'out')), avant)
    rmSync(join(root, 'out', variantes(root, 'b')[1]))
    const apresRetrait = construire(root)
    assert.deepEqual([apresRetrait.errors, apresRetrait.encodages], [[], 2], 'une variante de b.png retirée : ses deux variantes réencodées, rien pour a.png')
    assert.deepEqual(empreintes(join(root, 'out')), avant)
  })

  it('qualité, formats ou largeurs changés : l\'image se réencode', () => {
    const root = projet('reglages')
    assert.equal(construire(root).encodages, 4)
    assert.equal(construire(root, { image: { ...REGLAGES, quality: 60 } }).encodages, 4, 'qualité changée')
    assert.equal(construire(root, { image: { ...REGLAGES, quality: 60, formats: ['webp', 'avif'] } }).encodages, 8, 'formats changés')
    assert.equal(construire(root, { image: { widths: [320, 480], formats: ['webp', 'avif'], quality: 60 } }).encodages, 8, 'largeurs changées')
    assert.equal(construire(root, { image: { widths: [320, 480], formats: ['webp', 'avif'], quality: 60 } }).encodages, 0, 'mêmes réglages qu\'à la construction d\'avant')
    indexJuste(root)
  })

  it('une autre version de sharp : tout se réencode', () => {
    const root = projet('version')
    assert.equal(construire(root, {}, { FAUX_SHARP_VERSION: '1.0.0' }).encodages, 4)
    assert.equal(construire(root, {}, { FAUX_SHARP_VERSION: '1.0.1' }).encodages, 4, 'version de sharp changée')
    assert.equal(construire(root, {}, { FAUX_SHARP_VERSION: '1.0.1' }).encodages, 0)
  })

  it('un index illisible ou mal formé : la construction passe, tout est encodé, l\'index est réécrit lisible', () => {
    const root = projet('index-illisible')
    assert.equal(construire(root).encodages, 4)
    const juste = readFileSync(cheminIndex(root))
    for (const abime of ['{ pas du json', '[1, 2]', JSON.stringify({ cle: [{ filename: '../../a-320-00000000.webp', width: 320, format: 'webp' }] })]) {
      writeFileSync(cheminIndex(root), abime)
      const apres = construire(root)
      assert.deepEqual([apres.errors, apres.encodages], [[], 4], `index ${abime}`)
      assert.ok(readFileSync(cheminIndex(root)).equals(juste), `index réécrit après ${abime}`)
    }
    assert.equal(construire(root).encodages, 0)
  })

  it('une image retirée : son entrée quitte l\'index avec la purge de ses variantes', () => {
    const root = projet('image-retiree')
    assert.equal(construire(root).encodages, 4)
    const parti = variantes(root, 'b')
    assert.equal(parti.length, 2)
    rmSync(join(root, 'src/b.png'))
    rmSync(join(root, 'src/cb.mjs'))
    const apres = construire(root)
    assert.deepEqual([apres.errors, apres.encodages], [[], 0])
    for (const f of parti) assert.ok(apres.removed.includes(f), `${f} retiré par la purge`)
    const index = lireIndex(root)
    assert.equal(Object.keys(index).length, 1)
    assert.deepEqual(Object.values(index)[0].map(v => v.filename), variantes(root, 'a'))
    indexJuste(root)
  })

  it('une construction en échec : l\'index ne cite aucun fichier qu\'elle n\'a pas publié', () => {
    const root = projet('echec')
    assert.equal(construire(root).encodages, 4)
    const juste = readFileSync(cheminIndex(root))
    writeFileSync(join(root, 'src/c.png'), validPng(900, 600))
    writeFileSync(join(root, 'src/cc.mjs'), composant('c.png'))
    writeFileSync(join(root, 'src/casse.mjs'), composant('absente.png'))
    const echec = construire(root)
    assert.ok(echec.errors.length > 0, 'une image introuvable fait échouer la construction')
    assert.deepEqual(variantes(root, 'c'), [], 'rien de publié')
    assert.ok(readFileSync(cheminIndex(root)).equals(juste), 'l\'index est celui de la construction d\'avant')
    rmSync(join(root, 'src/casse.mjs'))
    const reprise = construire(root)
    assert.deepEqual([reprise.errors, reprise.encodages], [[], 2], 'seule c.png s\'encode')
    assert.equal(Object.keys(lireIndex(root)).length, 3)
    indexJuste(root)
  })

  it('deux environnements dans le même dossier de sortie : la production reprend les variantes du développement, et l\'inverse', () => {
    const root = projet('environnements')
    assert.equal(construire(root, { env: 'dev' }).encodages, 4)
    const prod = construire(root, { env: 'prod' })
    assert.deepEqual([prod.errors, prod.encodages], [[], 0])
    assert.equal(construire(root, { env: 'dev' }).encodages, 0)
    indexJuste(root)
  })

  it('`prune: false` : les variantes d\'avant restent sur le disque, leur entrée aussi, et resservent', () => {
    const root = projet('sans-purge')
    assert.equal(construire(root, { prune: false }).encodages, 4)
    assert.equal(construire(root, { prune: false, image: { ...REGLAGES, quality: 60 } }).encodages, 4)
    assert.equal(Object.keys(lireIndex(root)).length, 4, 'les entrées des deux qualités, leurs fichiers sont tous là')
    assert.equal(construire(root, { prune: false }).encodages, 0, 'retour à la qualité d\'avant : ses variantes resservent')
    indexJuste(root)
  })

  it('sortie placée dans les sources : un `.mjs-images.json` de l\'auteur n\'est jamais réécrit, et l\'index du build y sert', () => {
    const root   = projet('fichier-auteur')
    const auteur = '{ "note": "fichier de l\'auteur" }\n'
    mkdirSync(join(root, 'src/sortie'))
    writeFileSync(join(root, 'src/sortie/.mjs-images.json'), auteur)
    for (let i = 0; i < 2; i++) {
      const c = construire(root, { out: 'src/sortie' })
      assert.deepEqual([c.errors, c.encodages], [[], 4], 'rien de repris : ce fichier n\'est pas l\'index')
    }
    assert.equal(readFileSync(join(root, 'src/sortie/.mjs-images.json'), 'utf-8'), auteur)
    rmSync(join(root, 'src/sortie/.mjs-images.json'))
    assert.equal(construire(root, { out: 'src/sortie' }).encodages, 4)
    assert.equal(construire(root, { out: 'src/sortie' }).encodages, 0, 'l\'index écrit par le build est repris')
  })

  it('sans sharp, ou un sharp qui ne dit pas ses versions : aucun index, et tout s\'encode comme avant', () => {
    const absent = projet('sans-sharp', 'absent')
    for (let i = 0; i < 2; i++) assert.deepEqual(construire(absent).errors, [])
    assert.ok(!existsSync(cheminIndex(absent)), 'sans sharp, aucun index')
    const muet = projet('sans-versions')
    assert.equal(construire(muet, {}, { FAUX_SHARP_SANS_VERSIONS: '1' }).encodages, 4)
    assert.equal(construire(muet, {}, { FAUX_SHARP_SANS_VERSIONS: '1' }).encodages, 4, 'versions illisibles : aucune reprise')
    assert.ok(!existsSync(cheminIndex(muet)), 'versions illisibles, aucun index')
  })
})

// `mjs build --cache=verify` : sur place, l'index de la construction servie garde l'image d'une construction d'avant tant que ses
// variantes sont là (la purge vient après) ; celui de la construction complète faite à part ne la cite pas — aucun écart pour autant
describe('mjs build --cache=verify — l\'index des images ne fait pas d\'écart', function () {
  this.timeout(240000)

  // un projet de deux images (un composant chacune, une page qui les porte), construit par `mjs build --cache=verify`
  function projetVerifier(etiquette: string): { root: string, app: string, mjs: () => { status: number | null, out: string }, index: () => Record<string, unknown[]> } {
    const root = mjsTmp('image-reprises-' + etiquette)
    const app  = join(root, 'app/modularjs')
    mkdirSync(join(root, 'node_modules/sharp'), { recursive: true })
    mkdirSync(app, { recursive: true })
    writeFileSync(join(root, 'node_modules/sharp/index.js'), FAUX_SHARP)
    writeFileSync(join(app, 'a.png'), validPng(1200, 800))
    writeFileSync(join(app, 'b.png'), validPng(1000, 700))
    writeFileSync(join(app, 'accueil.mjs'), '<h1>accueil</h1>\n<mjs-ca></mjs-ca>\n<mjs-cb></mjs-cb>\n')
    writeFileSync(join(app, 'ca.mjs'), composant('a.png'))
    writeFileSync(join(app, 'cb.mjs'), composant('b.png'))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', image: REGLAGES }, null, 2) + '\n')
    const mjs   = (): { status: number | null, out: string } => {
      const run = spawnSync(process.execPath, [join(repoRoot, 'bin/mjs'), 'build', '--root', root, '--cache=verify'], { cwd: root, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', NODE_PATH: '' }, maxBuffer: 64 * 1024 * 1024 })
      return { status: run.status, out: `${run.stdout ?? ''}\n${run.stderr ?? ''}` }
    }
    const index = (): Record<string, unknown[]> => JSON.parse(readFileSync(join(root, 'public/modularjs/.mjs-images.json'), 'utf-8'))
    return { root, app, mjs, index }
  }

  it('une image retirée entre deux constructions : cache vérifié, code 0, puis son entrée quitte l\'index', () => {
    const { app, mjs, index } = projetVerifier('verifier')
    const premiere = mjs()
    assert.equal(premiere.status, 0, premiere.out)
    assert.match(premiere.out, /^cache vérifié : \d+ fichiers identiques à l'octet$/m)
    assert.equal(Object.keys(index()).length, 2)
    rmSync(join(app, 'b.png'))
    rmSync(join(app, 'cb.mjs'))
    writeFileSync(join(app, 'accueil.mjs'), '<h1>accueil</h1>\n<mjs-ca></mjs-ca>\n')
    const seconde = mjs()
    assert.equal(seconde.status, 0, seconde.out)
    assert.match(seconde.out, /^cache vérifié : \d+ fichiers identiques à l'octet$/m)
    assert.equal(Object.keys(index()).length, 1, 'l\'entrée de b.png part avec la purge de ses variantes')
  })

  it('l\'index retiré alors que le cache sert toutes ses images : aucun écart, code 0', () => {
    const { root, mjs } = projetVerifier('verifier-index-retire')
    const premiere = mjs()
    assert.equal(premiere.status, 0, premiere.out)
    rmSync(join(root, 'public/modularjs/.mjs-images.json'))
    const seconde = mjs()
    assert.equal(seconde.status, 0, seconde.out)
    assert.match(seconde.out, /^cache vérifié : \d+ fichiers identiques à l'octet$/m)
  })
})

describe('avec le vrai sharp — la seconde construction n\'encode rien', function () {
  this.timeout(240000)

  before(async function () {
    if (!await resolveSharp()) this.skip()
  })

  it('deux constructions de suite : 0 encodage la seconde fois, octets identiques', () => {
    const root     = projet('vrai-sharp', 'vrai')
    const premiere = construire(root, { compter: true }, {}, true)
    const avant    = empreintes(join(root, 'out'))
    const seconde  = construire(root, { compter: true }, {}, true)
    assert.deepEqual([premiere.errors, seconde.errors], [[], []])
    assert.deepEqual([premiere.encodages, seconde.encodages], [4, 0], 'encodages du vrai sharp, première puis seconde construction')
    assert.equal(variantes(root, 'a').length + variantes(root, 'b').length, 4)
    assert.deepEqual(empreintes(join(root, 'out')), avant)
  })
})
