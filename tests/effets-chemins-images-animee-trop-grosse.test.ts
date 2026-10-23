// un GIF (ou WebP) animé dont l'ensemble des images dépasse la limite de pixels de `sharp` (1280 × 720 × 300 images, par
// exemple, dans un fichier de quelques octets) ne fait jamais échouer le build : l'image garde son fichier d'origine, sans
// variante, comme un PNG ou un AVIF animé, et un avertissement de build dit pourquoi. Avant, elle se construisait sans
// variante animée ; le premier essai de lecture image par image la faisait échouer. Le faux `sharp` refuse la lecture
// image par image comme le vrai ; le dernier essai tourne avec le vrai (sauté s'il n'est pas installé).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { gifAnime, gifEcranGeant } from './helpers/gif-anime.js'
import { resolveSharp } from '../src/bundler/image.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// un faux sharp qui refuse la lecture image par image (`animated`) d'un GIF dont l'écran logique fait 1000 pixels de large ou
// plus, avec le message du vrai ; les autres images passent
const FAUX_SHARP = [
  'module.exports = function sharp(entree, options) {',
  '  let largeur = 0',
  '  const chain = {',
  '    resize(o) { largeur = o.width; return chain },',
  '    webp() { return chain },',
  '    avif() { return chain },',
  '    toBuffer() {',
  '      if (options && options.animated && entree.readUInt16LE(6) >= 1000) return Promise.reject(new Error(\'Input image exceeds pixel limit\'))',
  '      return Promise.resolve({ data: Buffer.from(\'variante \' + largeur), info: { width: largeur } })',
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
  'const { setMessagesLang } = await import(bundlerUrl.replace(/bundler\\/index\\.ts$/, \'messages/index.ts\'))',
  'setMessagesLang(process.env.LANGUE_ESSAI)',
  'const out     = join(root, \'out\')',
  'const bundler = new Bundler({ sourceDir: join(root, \'src\'), outputDir: out, manifestPath: join(root, \'bundle.js\'), ...JSON.parse(options) })',
  'const stats   = await bundler.compile()',
  'const files   = readdirSync(out)',
  'const fichiers = [...files.filter(f => f.endsWith(\'.js\')).map(f => join(out, f)), join(root, \'bundle.js\')]',
  'const code    = fichiers.filter(f => existsSync(f)).map(f => readFileSync(f, \'utf8\')).join(\'\\n\')',
  'await bundler.close()',
  'await terminateSharedWorkerPool()',
  'writeFileSync(join(root, \'resultat.json\'), JSON.stringify({ errors: stats.errors.map(e => e.message), files, code }))',
  'process.exit(0)',
].join('\n') + '\n'

const GEANT = gifEcranGeant(300)
const PETIT = gifAnime(3, 400, 4)

const COMPOSANTS: Record<string, string> = {
  'fx-geant.mjs': "<div class=\"a\" *behind('geant.gif', depth: 81)></div>",
  'fx-petit.mjs': "<div class=\"a\" *behind('petit.gif', depth: 82)></div>",
  'fx-img.mjs':   '<@@img src="geant.gif" alt="essai"></@@img>'
}

interface Resultat { errors: string[], files: string[], code: string, stderr: string, out: string }

// le projet construit dans un autre processus ; `faux` : avec le faux sharp, sinon avec le sharp que NODE_PATH laisse voir
function construire(etiquette: string, faux: boolean, langue: string, projet: { fichiers: Record<string, Buffer | string>, sharp?: string } = { fichiers: { 'geant.gif': GEANT, 'petit.gif': PETIT, ...COMPOSANTS } }): Resultat {
  const root = mjsTmp('chemins-images-trop-grosse-' + etiquette)
  mkdirSync(join(root, 'cwd'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  if (faux) {
    mkdirSync(join(root, 'cwd/node_modules/sharp'), { recursive: true })
    writeFileSync(join(root, 'cwd/node_modules/sharp/index.js'), projet.sharp ?? FAUX_SHARP)
  }
  for (const [fichier, contenu] of Object.entries(projet.fichiers)) writeFileSync(join(root, 'src', fichier), contenu)
  writeFileSync(join(root, 'scenario.mts'), SCENARIO)
  const options = JSON.stringify({ image: { widths: [320], formats: ['webp'] } })
  const env     = { ...process.env, ...(faux ? { NODE_PATH: '' } : {}), LANGUE_ESSAI: langue }
  const run     = spawnSync('npx', ['tsx', join(root, 'scenario.mts'), root, pathToFileURL(join(repoRoot, 'src/bundler/index.ts')).href, options], { cwd: repoRoot, encoding: 'utf-8', timeout: 100000, env })
  assert.ok(existsSync(join(root, 'resultat.json')), `le scénario n'a rien rendu : ${run.stderr}`)
  return { ...JSON.parse(readFileSync(join(root, 'resultat.json'), 'utf-8')), stderr: run.stderr + run.stdout, out: join(root, 'out') }
}

const imageDe = (code: string, depth: number): any => {
  const m = new RegExp(`"behind", \\{"image":(\\{[^}]*\\}|"[^"]*"),"depth":${depth}\\}`).exec(code)
  return m ? JSON.parse(m[1]) : undefined
}

describe('une image animée trop grosse pour sharp — le build continue, le fichier d\'origine passe seul', function () {
  this.timeout(240000)
  let res: Resultat

  before(() => { res = construire('faux', true, 'fr') })

  it('le build ne s\'arrête pas', () => {
    assert.deepEqual(res.errors, [])
  })

  it('aucune variante n\'est publiée pour elle, le fichier d\'origine l\'est, octet pour octet', () => {
    assert.deepEqual(res.files.filter((f) => /^geant-320-/.test(f)), [])
    const gif = res.files.find((f) => /^geant-[0-9a-f]{8}\.gif$/.test(f))
    assert.ok(gif, res.files.join(', '))
    assert.ok(readFileSync(join(res.out, gif!)).equals(GEANT))
  })

  it('l\'effet reçoit le fichier lui-même, sans srcset ; <@@img> ne pose ni srcset ni sizes', () => {
    assert.match(imageDe(res.code, 81), /^\/[\w/-]*geant-[0-9a-f]{8}\.gif$/)
    const balise = /<mjs-core-img src='[^']*geant-[0-9a-f]{8}\.gif'[^>]*>/.exec(res.code)?.[0] ?? ''
    assert.notEqual(balise, '', 'la balise est dans le script')
    assert.doesNotMatch(balise, /srcset=|sizes=/, balise)
  })

  it('un avertissement de build, en français et au vouvoiement, nomme l\'image et dit pourquoi', () => {
    assert.match(res.stderr, /geant\.gif/, res.stderr)
    assert.match(res.stderr, /trop de pixels/, res.stderr)
    assert.match(res.stderr, /Input image exceeds pixel limit/, res.stderr)
    assert.match(res.stderr, /\[lint\.image\]/, res.stderr)
    assert.doesNotMatch(res.stderr, /ÉCHEC|échec de génération/, res.stderr)
  })

  it('l\'avertissement n\'est dit qu\'une fois par image, même lue par deux effets', () => {
    assert.equal((res.stderr.match(/trop de pixels/g) ?? []).length, 1, res.stderr)
  })

  it('un GIF animé qui passe la limite garde ses variantes WebP animées', () => {
    assert.ok(res.files.some((f) => /^petit-320-[0-9a-f]{8}\.webp$/.test(f)), res.files.join(', '))
  })

  it('l\'avertissement existe aussi en anglais', function () {
    const en = construire('faux-en', true, 'en')
    assert.deepEqual(en.errors, [])
    assert.match(en.stderr, /geant\.gif/, en.stderr)
    assert.match(en.stderr, /too many pixels/, en.stderr)
  })
})

describe('avec le vrai sharp — un GIF animé de 1280 × 720 × 300 images ne fait pas échouer le build', function () {
  this.timeout(240000)
  let sharp: any = null

  before(async function () {
    sharp = await resolveSharp()
    if (!sharp) return this.skip()
  })

  it('le build se termine sans erreur, sans variante pour lui, avec l\'avertissement', () => {
    const vrai = construire('vrai', false, 'fr')
    assert.deepEqual(vrai.errors, [])
    assert.deepEqual(vrai.files.filter((f) => /^geant-320-/.test(f)), [])
    assert.ok(vrai.files.some((f) => /^geant-[0-9a-f]{8}\.gif$/.test(f)), vrai.files.join(', '))
    assert.match(vrai.stderr, /trop de pixels/, vrai.stderr)
  })
})

// un GIF animé de trois images dont la dernière est abîmée (ses derniers octets sont écrasés) : sharp le refuse pour une tout autre raison que la
// limite de pixels ; l'avertissement dit la vraie raison, le fichier est publié tel quel
const ABIME   = (() => { const b = gifAnime(3, 400, 4); return Buffer.concat([b.subarray(0, b.length - 40), Buffer.alloc(40, 7)]) })()
const PROJET_ABIME = { fichiers: { 'abime.gif': ABIME, 'fx-abime.mjs': "<div class=\"a\" *behind('abime.gif', depth: 83)></div>" } }
// un faux sharp qui refuse la lecture image par image avec le message que le vrai donne pour une image abîmée
const FAUX_SHARP_ABIME = FAUX_SHARP.replace("Input image exceeds pixel limit", "gifload_buffer: Invalid frame data").replace(' >= 1000', ' >= 0')

describe('une image animée que sharp refuse pour une autre raison que la limite de pixels — l\'avertissement dit la vraie raison', function () {
  this.timeout(240000)

  const verifie = (res: Resultat, langue: string) => {
    assert.deepEqual(res.errors, [], 'le build ne s\'arrête pas')
    assert.deepEqual(res.files.filter((f) => /^abime-320-/.test(f)), [], 'aucune variante')
    const gif = res.files.find((f) => /^abime-[0-9a-f]{8}\.gif$/.test(f))
    assert.ok(gif, res.files.join(', '))
    assert.ok(readFileSync(join(res.out, gif!)).equals(ABIME), 'le fichier est publié tel quel')
    assert.match(res.stderr, /abime\.gif/, res.stderr)
    assert.match(res.stderr, /Invalid frame data/, res.stderr)
    assert.doesNotMatch(res.stderr, /trop de pixels|too many pixels/, res.stderr)
    assert.match(res.stderr, langue === 'fr' ? /n'a pas pu être lue/ : /could not be read/, res.stderr)
    assert.match(res.stderr, langue === 'fr' ? /vérifiez le fichier/i : /check the file/i, res.stderr)
  }

  it('avec un sharp qui dit « Invalid frame data » : la raison n\'est pas « trop de pixels », en français puis en anglais', () => {
    verifie(construire('abime-fr', true, 'fr', { ...PROJET_ABIME, sharp: FAUX_SHARP_ABIME }), 'fr')
    verifie(construire('abime-en', true, 'en', { ...PROJET_ABIME, sharp: FAUX_SHARP_ABIME }), 'en')
  })

  it('avec le vrai sharp : un GIF animé dont la dernière image est tronquée', async function () {
    if (!(await resolveSharp())) return this.skip()
    verifie(construire('abime-vrai', false, 'fr', PROJET_ABIME), 'fr')
  })
})
