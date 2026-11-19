// Construction de production : les fichiers JS émis ne portent plus aucun caractère au-delà de U+00FF quand ils peuvent s'écrire en
// échappements (fichier unique, dictionnaire de traduction, manifeste), et l'appli affiche les mêmes textes. Une bibliothèque `.js` reste
// copiée telle quelle, à l'octet près.
// Un fichier qui porte un tel caractère dans un gabarit étiqueté ou une expression régulière sort tel quel, en entier ; un dictionnaire
// dense en texte non latin aussi (plafond de poids). L'empreinte du nom reste celle du contenu écrit, deux constructions rendent les
// mêmes octets, une construction reprise du cache (`mjs build --prod --cache`) aussi, et le développement garde ses caractères tels quels.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { shortFingerprint } from '../src/bundler/fingerprint.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { build as buildCli, write } from './helpers/construction-cache.js'

const TITRE   = 'Bientôt… l’œuvre à 5 € 😀'
const STATIQUE = 'Prix… l’œuf à 3 € 😀'
const LIBELLE = 'Suite… l’œil à 2 € 😀'
const CARTE   = `<script lang="js">\n@import { libelle grec } 'textes.js'\n$titre = '${TITRE}'\n$grec  = grec.αβγ\n$lib   = libelle()\n</script>\n<p class="a">{$titre}</p>\n<p class="b">${STATIQUE}</p>\n<p class="c">{$grec}</p>\n<p class="d">{$lib}</p>\n`
// le même composant sans bibliothèque, pour le fichier unique
const CARTE_SEULE = `<script lang="js">\nconst grec = { αβγ: 'grec' }\n$titre = '${TITRE}'\n$grec  = grec.αβγ\n$lib   = '${LIBELLE}'\n</script>\n<p class="a">{$titre}</p>\n<p class="b">${STATIQUE}</p>\n<p class="c">{$grec}</p>\n<p class="d">{$lib}</p>\n`
const BRUT    = '<script lang="js">\n$brut   = String.raw`brut… \\n`\n$source = /…’/u.source\n$plain  = \'simple…\'\n</script>\n<p class="brut">{$brut}</p>\n<p class="source">{$source}</p>\n<p class="plain">{$plain}</p>\n'
// une bibliothèque copiée telle quelle
const TEXTES  = `export const grec = { αβγ: 'grec' }\nexport function libelle() { return '${LIBELLE}' }\nexport const remplissage = '${'a'.repeat(2400)}'\n`
const FR      = Object.fromEntries([['titre', TITRE], ...Array.from({ length: 60 }, (_, i) => [`cle_${i}`, `un texte ordinaire, sans rien de large, numéro ${i}`])])
const RU      = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`cle_${i}`, `Привет, мир, доброе утро, номер ${i}`]))

const wide = (text: string): number => [...text].filter(c => c.codePointAt(0)! > 0xFF).length

interface Built { out: string, files: Record<string, string> }

async function build(name: string, sources: Record<string, string>, opts: Record<string, unknown>, i18n = false): Promise<Built> {
  const root = mjsTmp(`un-octet-${name}`)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [file, code] of Object.entries(sources)) writeFileSync(join(src, file), code)
  if (i18n) {
    mkdirSync(join(src, 'i18n'), { recursive: true })
    writeFileSync(join(src, 'i18n', 'fr.json'), JSON.stringify(FR))
    writeFileSync(join(src, 'i18n', 'ru.json'), JSON.stringify(RU))
  }
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', ...(i18n ? { i18n: { default: 'fr' } } : {}), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [], name)
  const files: Record<string, string> = {}
  for (const n of readdirSync(out).sort()) if (n.endsWith('.js')) files[n] = readFileSync(join(out, n), 'utf-8')
  return { out, files }
}

// le nom de chaque fichier à empreinte porte l'empreinte du contenu écrit : 5 caractères pour un fichier compilé, 8 pour un fichier copié
function assertFingerprints(files: Record<string, string>): number {
  let seen = 0
  for (const [name, content] of Object.entries(files)) {
    const copied   = /-([0-9a-f]{8})\.js$/.exec(name)
    const compiled = /-([0-9a-z]{5})\.js$/.exec(name)
    if (copied) assert.equal(createHash('md5').update(content).digest('hex').slice(0, 8), copied[1], name)
    else if (compiled) assert.equal(shortFingerprint(content), compiled[1], name)
    else continue
    seen++
  }
  return seen
}

describe('production : fichiers JS gardés sur un octet par caractère', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  it('fichier unique (js: bundle) : plus aucun caractère au-delà de U+00FF, les accents restent tels quels', async () => {
    const { files } = await build('unique', { 'carte.mjs': CARTE_SEULE }, { env: 'prod', js: 'bundle' })
    assert.ok(files['bundle.js'], Object.keys(files).join(', '))
    for (const [name, content] of Object.entries(files)) if (!/^textes-/.test(name)) assert.equal(wide(content), 0, name)
    const all = Object.values(files).join('\n')
    assert.ok(all.includes('Bientôt\\u2026 l\\u2019\\u0153uvre à 5 \\u20AC \\uD83D\\uDE00'), 'le titre est écrit en échappements, ses accents tels quels')
    assert.ok(all.includes('\\u03B1\\u03B2\\u03B3'), 'le nom grec est écrit en échappements')
    assertFingerprints(files)
  })

  it('fichiers séparés : dictionnaire et manifeste convertis ; expression régulière, gabarit étiqueté, dictionnaire dense et bibliothèque copiée tels quels', async () => {
    const { files } = await build('separes', { 'carte.mjs': CARTE, 'brut.mjs': BRUT, 'textes.js': TEXTES }, { env: 'prod', js: 'split' }, true)
    const names  = Object.keys(files)
    const one    = (re: RegExp): string => { const found = names.filter(n => re.test(n)); assert.equal(found.length, 1, `${re} : ${names.join(', ')}`); return found[0] }
    const brut   = one(/^brut-/)
    const russe  = one(/^mjs_i18n-ru-/)
    const fr     = one(/^mjs_i18n-fr-/)
    const textes = one(/^textes-/)
    for (const [name, content] of Object.entries(files)) if (name !== brut && name !== russe && name !== textes) assert.equal(wide(content), 0, name)
    // le dictionnaire français rend les mêmes valeurs, écrites en échappements ; la bibliothèque est copiée à l'octet près
    const values = (file: string): unknown[] => Object.values(JSON.parse(files[file].replace(/^export default /, '').replace(/;\s*$/, '')).root)
    assert.ok(values(fr).includes(TITRE), files[fr].slice(0, 200))
    assert.ok(files[fr].includes('Bientôt\\u2026 l\\u2019\\u0153uvre à 5 \\u20AC \\uD83D\\uDE00'), files[fr].slice(0, 200))
    assert.equal(files[textes], TEXTES)
    // expression régulière et gabarit étiqueté : le fichier garde ces caractères tels quels
    assert.ok(files[brut].includes('String.raw`brut… \\n`') && files[brut].includes('/…’/u'), files[brut])
    // dictionnaire dense : laissé tel quel par le plafond de poids
    assert.equal(wide(files[russe]), 20 * 24)
    assert.ok(values(russe).includes('Привет, мир, доброе утро, номер 3'), files[russe].slice(0, 200))
    assert.ok(assertFingerprints(files) >= 6)
  })

  it('fichier unique qui porte un gabarit étiqueté et une expression régulière : tel quel, en entier', async () => {
    const { files } = await build('unique-brut', { 'brut.mjs': BRUT }, { env: 'prod', js: 'bundle' })
    const bundle = files['bundle.js']
    assert.ok(bundle.includes('String.raw`brut… \\n`') && bundle.includes('/…’/u'), 'gabarit étiqueté et expression régulière tels quels')
    assert.ok(bundle.includes('"simple…"'), 'pas de demi-mesure : la chaîne voisine reste telle quelle')
  })

  it('deux constructions rendent les mêmes octets, et une seconde compilation du même Bundler aussi', async () => {
    const sources = { 'carte.mjs': CARTE, 'textes.js': TEXTES }
    const first   = await build('octets-1', sources, { env: 'prod', js: 'split' }, true)
    const second  = await build('octets-2', sources, { env: 'prod', js: 'split' }, true)
    assert.deepEqual(second.files, first.files)
    const root = mjsTmp('un-octet-deux-tours')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'carte.mjs'), CARTE_SEULE)
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } as any)
    const read    = (): Record<string, string> => Object.fromEntries(readdirSync(out).filter(n => n.endsWith('.js')).sort().map(n => [n, readFileSync(join(out, n), 'utf-8')]))
    assert.deepEqual((await bundler.compile()).errors, [])
    const once = read()
    assert.deepEqual((await bundler.compile()).errors, [])
    await bundler.close()
    assert.deepEqual(read(), once)
    assert.equal(wide(Object.entries(once).filter(([n]) => !/^textes-/.test(n)).map(([, c]) => c).join('')), 0)
  })

  it('mjs build --prod --cache : la construction reprise du cache rend les octets d\'une construction complète', () => {
    const root = mjsTmp('un-octet-cache')
    // le cache se range sous node_modules/.cache : sans ce dossier, la construction est complète
    mkdirSync(join(root, 'node_modules'))
    write(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', js: 'bundle' }))
    write(join(root, 'src', 'carte.mjs'), CARTE_SEULE)
    const first = buildCli(root, ['--prod', '--cache'])
    assert.equal(first.status, 0, first.out)
    assert.equal(wide(readFileSync(join(root, 'out', 'bundle.js'), 'utf-8')), 0)
    // la seconde reprend le cache, puis se compare d'elle-même à une construction complète faite à part
    const second = buildCli(root, ['--prod', '--cache=verify'])
    assert.equal(second.status, 0, second.out)
    assert.ok(second.served > 0, second.out)
    assert.equal(wide(readFileSync(join(root, 'out', 'bundle.js'), 'utf-8')), 0)
  })

  it('carte de source en production : le fichier se convertit, sa carte reste lisible et nomme les mêmes sources', async () => {
    const { out, files } = await build('carte', { 'carte.mjs': CARTE_SEULE }, { env: 'prod', js: 'bundle', sourceMap: 'always' })
    assert.equal(wide(files['bundle.js']), 0)
    assert.match(files['bundle.js'], /\/\/# sourceMappingURL=bundle\.js\.map\n$/)
    const map = JSON.parse(readFileSync(join(out, 'bundle.js.map'), 'utf-8'))
    assert.equal(map.version, 3)
    assert.ok(typeof map.mappings === 'string' && map.mappings.length > 100)
  })

  it('mode csp : mêmes fichiers convertis, empreintes justes', async () => {
    const { files } = await build('csp', { 'carte.mjs': CARTE + '<style>\np\n  color: red\n</style>\n', 'textes.js': TEXTES }, { env: 'prod', js: 'split', csp: true, css: 'split' }, true)
    for (const [name, content] of Object.entries(files)) if (!/^(?:mjs_i18n-ru|textes)-/.test(name)) assert.equal(wide(content), 0, name)
    assert.ok(assertFingerprints(files) >= 5)
  })

  it('développement : les caractères restent tels quels', async () => {
    const { files } = await build('dev', { 'carte.mjs': CARTE_SEULE }, { env: 'dev', js: 'bundle' })
    assert.ok(files['bundle.js'].includes(TITRE) && files['bundle.js'].includes(STATIQUE), 'le fichier unique de développement garde ses textes')
    const split = await build('dev-separes', { 'carte.mjs': CARTE, 'textes.js': TEXTES }, { env: 'dev', js: 'split' }, true)
    const textes = Object.keys(split.files).find(n => /^textes-/.test(n))!
    assert.equal(split.files[textes], TEXTES)
    assert.ok(Object.entries(split.files).some(([n, c]) => /^mjs_i18n-fr-/.test(n) && c.includes(TITRE)))
  })

  it('production lisible ("minify": false) : rien n\'est échappé', async () => {
    const { files } = await build('lisible', { 'carte.mjs': CARTE_SEULE }, { env: 'prod', js: 'bundle', minify: false })
    assert.ok(files['bundle.js'].includes(TITRE), 'le fichier unique lisible garde ses textes')
  })

  it('la page rendue par le serveur (happy-dom) affiche les mêmes textes', async () => {
    const root = mjsTmp('un-octet-serveur')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (const [file, code] of Object.entries({ 'carte.mjs': CARTE, 'brut.mjs': BRUT, 'textes.js': TEXTES })) writeFileSync(join(src, file), code)
    const renderer = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'out'), env: 'prod' })
    try {
      const carte = (await renderer.renderToString('mjs-carte', {})).html
      for (const text of [TITRE, STATIQUE, 'grec', LIBELLE]) assert.ok(carte.includes(text), `${text} absent de ${carte}`)
      const brut = (await renderer.renderToString('mjs-brut', {})).html
      for (const text of ['brut… \\n', '…’', 'simple…']) assert.ok(brut.includes(text), `${text} absent de ${brut}`)
    }
    finally {
      await renderer.close()
    }
  })
})
