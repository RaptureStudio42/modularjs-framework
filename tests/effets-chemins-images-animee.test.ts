// une image animée (GIF, WebP animé, PNG animé, AVIF animé) garde son animation quand `sharp` fabrique les variantes de
// largeur : `sharp` ne lit que la première image d'un fichier si on ne le lui demande pas, et la variante `.webp` d'UNE
// image, que le navigateur choisit dans le `srcset`, figeait l'animation. Un GIF ou un WebP animé a des variantes WebP
// animées (le seul format de sharp qui garde les images) ; un PNG ou un AVIF animé, que sharp ne lit pas image par image,
// n'a aucune variante : le fichier passe tel quel. Une image fixe est traitée comme toujours.
// Le faux `sharp` des premiers essais note ses appels ; les derniers tournent avec le vrai (sauté s'il n'est pas installé).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { gifAnime, apngAnime, pngFixe, avifAnime } from './helpers/gif-anime.js'
import { generateVariants, resolveSharp } from '../src/bundler/image.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// un faux sharp : il note chaque fabrication (options de lecture, formats demandés) dans appels.jsonl, au dossier courant
const FAUX_SHARP = [
  'const fs = require(\'node:fs\')',
  'module.exports = function sharp(entree, options) {',
  '  const appel = { longueur: entree.length, options: options === undefined ? null : options, ops: [] }',
  '  const chain = {',
  '    resize(o) { appel.ops.push(\'resize:\' + o.width); return chain },',
  '    webp() { appel.ops.push(\'webp\'); return chain },',
  '    avif() { appel.ops.push(\'avif\'); return chain },',
  '    png() { appel.ops.push(\'png\'); return chain },',
  '    jpeg() { appel.ops.push(\'jpeg\'); return chain },',
  '    toBuffer() {',
  '      fs.appendFileSync(process.cwd() + \'/appels.jsonl\', JSON.stringify(appel) + \'\\n\')',
  '      return Promise.resolve({ data: Buffer.from(\'variante \' + appel.ops.join(\',\')), info: { width: Number(appel.ops[0].slice(7)) } })',
  '    },',
  '  }',
  '  return chain',
  '}',
].join('\n') + '\n'

const SCENARIO = [
  'import { existsSync, readFileSync, readdirSync, writeFileSync } from \'node:fs\'',
  'import { join } from \'node:path\'',
  'const [root, bundlerUrl, options] = process.argv.slice(2)',
  'process.chdir(join(root, \'cwd\'))',
  'const { Bundler, terminateSharedWorkerPool } = await import(bundlerUrl)',
  'const { resolveSharp } = await import(bundlerUrl.replace(/index\\.ts$/, \'image.ts\'))',
  'const out     = join(root, \'out\')',
  'const bundler = new Bundler({ sourceDir: join(root, \'src\'), outputDir: out, manifestPath: join(root, \'bundle.js\'), ...JSON.parse(options) })',
  'const stats   = await bundler.compile()',
  'const files   = readdirSync(out)',
  'const fichiers = [...files.filter(f => f.endsWith(\'.js\')).map(f => join(out, f)), join(root, \'bundle.js\')]',
  'const code    = fichiers.filter(f => existsSync(f)).map(f => readFileSync(f, \'utf8\')).join(\'\\n\')',
  'const appels  = existsSync(join(root, \'cwd\', \'appels.jsonl\')) ? readFileSync(join(root, \'cwd\', \'appels.jsonl\'), \'utf8\').split(\'\\n\').filter(Boolean).map(l => JSON.parse(l)) : []',
  'const sharpPresent = !!(await resolveSharp())',
  'await bundler.close()',
  'await terminateSharedWorkerPool()',
  'writeFileSync(join(root, \'resultat.json\'), JSON.stringify({ errors: stats.errors.map(e => e.message), files, code, appels, sharpPresent }))',
  'process.exit(0)',
].join('\n') + '\n'

const SOURCES: Record<string, Buffer> = {
  'fixe.png':        pngFixe(),
  'gif-anime.gif':   gifAnime(3, 400, 4),
  'apng-anime.png':  apngAnime(),
  'avif-anime.avif': avifAnime()
}

const COMPOSANTS: Record<string, string> = {
  'fx-fixe.mjs': "<div class=\"a\" *behind('fixe.png', depth: 81)></div>",
  'fx-gif.mjs':  "<div class=\"a\" *behind('gif-anime.gif', depth: 82)></div>",
  'fx-apng.mjs': "<div class=\"a\" *behind('apng-anime.png', depth: 83)></div>",
  'fx-avif.mjs': "<div class=\"a\" *behind('avif-anime.avif', depth: 84)></div>",
  'fx-img-gif.mjs':  '<@@img src="gif-anime.gif" alt="essai"></@@img>',
  'fx-img-apng.mjs': '<@@img src="apng-anime.png" alt="essai"></@@img>'
}

interface Resultat { errors: string[], files: string[], code: string, appels: Array<{ longueur: number, options: unknown, ops: string[] }>, sharpPresent: boolean, out: string }

// le projet construit dans un autre processus, avec un faux sharp (`faux`) ou sans aucun sharp
function construire(etiquette: string, faux: boolean): Resultat {
  const root = mjsTmp('chemins-images-animee-' + etiquette)
  mkdirSync(join(root, 'cwd'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  if (faux) {
    mkdirSync(join(root, 'cwd/node_modules/sharp'), { recursive: true })
    writeFileSync(join(root, 'cwd/node_modules/sharp/index.js'), FAUX_SHARP)
  }
  for (const [fichier, octets] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', fichier), octets)
  for (const [fichier, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(root, 'src', fichier), texte)
  writeFileSync(join(root, 'scenario.mts'), SCENARIO)
  const options = JSON.stringify({ image: { widths: [320], formats: ['avif', 'webp'] } })
  const env     = { ...process.env, NODE_PATH: '' }
  const run     = spawnSync('npx', ['tsx', join(root, 'scenario.mts'), root, pathToFileURL(join(repoRoot, 'src/bundler/index.ts')).href, options], { cwd: repoRoot, encoding: 'utf-8', timeout: 100000, env })
  assert.ok(existsSync(join(root, 'resultat.json')), `le scénario n'a rien rendu : ${run.stderr}`)
  return { ...JSON.parse(readFileSync(join(root, 'resultat.json'), 'utf-8')), out: join(root, 'out') }
}

// la valeur du réglage image du *behind marqué par son depth
function imageDe(code: string, depth: number): any {
  const m = new RegExp(`"behind", \\{"image":(\\{[^}]*\\}|"[^"]*"),"depth":${depth}\\}`).exec(code)
  return m ? JSON.parse(m[1]) : undefined
}

describe('une image animée garde son animation — ce que le build demande à sharp', function () {
  this.timeout(240000)
  let res: Resultat

  before(() => { res = construire('faux', true) })

  const appelsDe = (octets: Buffer) => res.appels.filter((a) => a.longueur === octets.length)

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(res.errors, [])
  })

  it('une image fixe : lue comme toujours (aucune option), une variante par format demandé', () => {
    const appels = appelsDe(SOURCES['fixe.png'])
    assert.deepEqual(appels.map((a) => a.options), [null, null])
    assert.deepEqual(appels.map((a) => a.ops.join(',')).sort(), ['resize:320,avif', 'resize:320,webp'])
    assert.ok(res.files.some((f) => /^fixe-320-[0-9a-f]{8}\.avif$/.test(f)), res.files.join(', '))
    assert.ok(res.files.some((f) => /^fixe-320-[0-9a-f]{8}\.webp$/.test(f)), res.files.join(', '))
  })

  it('un GIF animé : lu image par image (animated), réécrit en WebP seulement — l\'AVIF perdrait les images', () => {
    const appels = appelsDe(SOURCES['gif-anime.gif'])
    assert.ok(appels.length >= 1, 'le GIF est lu (par *behind, et par <@@img> : chaque lecture fait la même demande)')
    assert.deepEqual([...new Set(appels.map((a) => JSON.stringify(a.options)))], ['{"animated":true}'])
    assert.deepEqual([...new Set(appels.map((a) => a.ops.join(',')))], ['resize:320,webp'])
    assert.ok(res.files.some((f) => /^gif-anime-320-[0-9a-f]{8}\.webp$/.test(f)), res.files.join(', '))
    assert.ok(!res.files.some((f) => /^gif-anime-320-[0-9a-f]{8}\.avif$/.test(f)), res.files.join(', '))
    assert.match(imageDe(res.code, 82).srcset, /gif-anime-320-[0-9a-f]{8}\.webp 320w/)
  })

  it('un PNG animé et un AVIF animé : sharp n\'en lit que la première image, il n\'est pas appelé, aucune variante', () => {
    assert.deepEqual(appelsDe(SOURCES['apng-anime.png']), [])
    assert.deepEqual(appelsDe(SOURCES['avif-anime.avif']), [])
    assert.ok(!res.files.some((f) => /^apng-anime-320-/.test(f) || /^avif-anime-320-/.test(f)), res.files.join(', '))
    for (const [depth, nom] of [[83, 'apng-anime'], [84, 'avif-anime']] as Array<[number, string]>) {
      assert.match(imageDe(res.code, depth), new RegExp(`^/[\\w/-]*${nom}-[0-9a-f]{8}\\.(png|avif)$`), 'l\'effet reçoit le fichier lui-même, sans srcset')
    }
  })
})

describe('une image animée passée à <@@img> — la balise suit ce que le build a publié', function () {
  this.timeout(240000)

  it('un GIF animé : le srcset de ses variantes WebP ; un PNG animé, sans variante : ni srcset ni sizes', () => {
    const res = construire('img', true)
    const balise = (fichier: RegExp) => new RegExp(`<mjs-core-img src='[^']*${fichier.source}'[^>]*>`).exec(res.code)?.[0] ?? ''
    const gif    = balise(/gif-anime-[0-9a-f]{8}\.gif/)
    const apng   = balise(/apng-anime-[0-9a-f]{8}\.png/)
    assert.match(gif, /srcset='[^']*gif-anime-320-[0-9a-f]{8}\.webp 320w'/, gif)
    assert.match(gif, /sizes='100vw'/, gif)
    assert.notEqual(apng, '', 'la balise du PNG animé est dans le script')
    assert.doesNotMatch(apng, /srcset=|sizes=/, apng)
  })
})

describe('sans sharp, une image animée passe telle quelle', function () {
  this.timeout(240000)

  it('le GIF animé est publié octet pour octet, sans variante', function () {
    const res = construire('sans', false)
    if (res.sharpPresent) return this.skip()
    assert.deepEqual(res.errors, [])
    assert.deepEqual(res.files.filter((f) => /-320-/.test(f)), [])
    const gif = res.files.find((f) => /^gif-anime-[0-9a-f]{8}\.gif$/.test(f))
    assert.ok(gif, res.files.join(', '))
    assert.ok(readFileSync(join(res.out, gif!)).equals(SOURCES['gif-anime.gif']), 'le fichier publié est celui des sources')
  })
})

describe('avec le vrai sharp — un GIF animé garde ses images', function () {
  this.timeout(240000)
  let sharp: any = null

  before(async function () {
    sharp = await resolveSharp()
    if (!sharp) return this.skip()
  })

  after(async () => { await terminateSharedWorkerPool() })

  const pages = async (octets: Buffer) => sharp(octets, { animated: true }).metadata()

  it('generateVariants : un GIF de trois images donne un WebP de trois images, mêmes délais, boucle sans fin', async () => {
    const v = await generateVariants({ bytes: gifAnime(3, 64, 16, 10), baseName: 'anim', widths: [32], formats: ['webp'], quality: 80 })
    assert.equal(v?.length, 1)
    const m = await pages(v![0].bytes)
    assert.equal(m.pages, 3, 'trois images')
    assert.equal(m.pageHeight, 8, 'chacune de 32 × 8')
    assert.deepEqual(m.delay, [100, 100, 100])
    assert.equal(m.loop, 0)
  })

  it('generateVariants : parmi les formats demandés, seul le WebP garde les images (ni AVIF, ni PNG, ni JPEG empilés)', async () => {
    const v = await generateVariants({ bytes: gifAnime(3, 64, 16, 10), baseName: 'anim', widths: [32], formats: ['avif', 'webp', 'png', 'jpeg'], quality: 80 })
    assert.deepEqual(v?.map((x) => x.format), ['webp'])
  })

  it('generateVariants : une image fixe garde ses variantes de toujours, une image chacune', async () => {
    const fixe = await sharp({ create: { width: 64, height: 16, channels: 3, background: '#c33' } }).png().toBuffer()
    const v    = await generateVariants({ bytes: fixe, baseName: 'fixe', widths: [32], formats: ['webp', 'png'], quality: 80 })
    assert.deepEqual(v?.map((x) => x.format), ['webp', 'png'])
    for (const x of v!) assert.equal((await pages(x.bytes)).height, 8)
  })

  it('generateVariants : un PNG animé n\'a aucune variante', async () => {
    assert.deepEqual(await generateVariants({ bytes: apngAnime(), baseName: 'apng', widths: [32], formats: ['webp'], quality: 80 }), [])
  })

  it('le build d\'un projet : la variante publiée pour <@@img> et pour *behind a ses trois images, le GIF est publié aussi', async () => {
    const root   = mjsTmp('chemins-images-animee-vrai')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'anim.gif'), gifAnime(3, 64, 16, 10))
    writeFileSync(join(srcDir, 'a.mjs'), '<@@img src="anim.gif" alt="essai"></@@img>')
    writeFileSync(join(srcDir, 'b.mjs'), "<div class=\"a\" *behind('anim.gif', depth: 91)></div>")
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), image: { widths: [32], formats: ['webp'] } } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
    const fichiers = readdirSync(outDir)
    const webps    = fichiers.filter((f) => /^anim-32-[0-9a-f]{8}\.webp$/.test(f))
    assert.equal(webps.length, 1, fichiers.join(', '))
    assert.equal((await pages(readFileSync(join(outDir, webps[0])))).pages, 3, 'la variante garde les trois images')
    assert.ok(fichiers.some((f) => /^anim-[0-9a-f]{8}\.gif$/.test(f)), 'le GIF reste publié, repli du src')
  })
})
