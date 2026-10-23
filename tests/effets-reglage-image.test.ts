// un réglage d'effet de type « image » (*ink, *blend, *gradient, *scratch, *peel) accepte quatre
// écritures : une adresse, µasset('…'), µimage('…') (un objet { src, srcset, … } posé au build) et une
// variable qui tient l'une des deux formes. Ce test couvre la lecture des réglages, la chaîne complète
// du build (vrai fichier image, vrai Bundler) et le choix de la variante par le moteur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect, devCatalog } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

// un PNG en niveaux de gris, 64 × 8
function png(): Buffer {
  const w = 64, h = 8
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(w, 0); tete.writeUInt32BE(h, 4); tete[8] = 8; tete[9] = 0
  const brut = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) brut[y * (w + 1) + 1 + x] = Math.round(x / (w - 1) * 255)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
}

const OBJET = '{"src":"/assets/m-abc.png","srcset":"/assets/m-32.png 32w, /assets/m-48.png 48w","sizes":"100vw","width":64,"height":8}'

describe('réglage image — la lecture des réglages', () => {
  it('une adresse écrite reste une chaîne', () => {
    assert.deepEqual(parseEffect('ink', "image: '/masques/logo.png'").fixed, { image: '/masques/logo.png' })
    assert.deepEqual(parseEffect('ink', 'image: /m.png').fixed, { image: '/m.png' })
  })

  it('un objet sans srcset garde l\'adresse seule (une chaîne)', () => {
    const o = '{"src":"/assets/m-abc.png","srcset":"","sizes":"","width":64,"height":8}'
    assert.deepEqual(parseEffect('ink', `image: ${o}`).fixed, { image: '/assets/m-abc.png' })
  })

  it('un objet avec srcset garde src et srcset seulement', () => {
    assert.deepEqual(parseEffect('ink', `image: ${OBJET}`).fixed, { image: { src: '/assets/m-abc.png', srcset: '/assets/m-32.png 32w, /assets/m-48.png 48w' } })
  })

  it('les virgules de l\'objet ne coupent pas la liste des réglages', () => {
    assert.deepEqual(parseEffect('ink', `image: ${OBJET}, invert: true, duration: 2s`).fixed, { image: { src: '/assets/m-abc.png', srcset: '/assets/m-32.png 32w, /assets/m-48.png 48w' }, invert: true, duration: '2s' })
  })

  it('l\'objet peut s\'écrire seul, sans nom : il va à l\'image (*gradient)', () => {
    assert.deepEqual(parseEffect('gradient', OBJET).fixed, { image: { src: '/assets/m-abc.png', srcset: '/assets/m-32.png 32w, /assets/m-48.png 48w' } })
  })

  it('un objet sans src, un src vide ou mal formé est refusé', () => {
    assert.throws(() => parseEffect('ink', 'image: {"srcset":"a 1w"}'), /\*ink : image/)
    assert.throws(() => parseEffect('ink', 'image: {"src":""}'), /\*ink : image/)
    assert.throws(() => parseEffect('ink', 'image: {"src":12}'), /\*ink : image/)
    assert.throws(() => parseEffect('ink', 'image: {"src":"a.png"'), /\*ink : image/)
    assert.throws(() => parseEffect('ink', 'image: {oups}'), /\*ink : image/)
  })

  it('un µimage(…) resté tel quel (non résolu) est refusé en le disant', () => {
    assert.throws(() => parseEffect('ink', "image: µimage('m.png')"), /µimage/)
    assert.throws(() => parseEffect('ink', "image: µimage('m.png', 480, 960)"), /µimage/)
  })

  it('une valeur { … } sur un réglage qui n\'est pas une image garde son erreur', () => {
    assert.throws(() => parseEffect('ink', 'duration: {1}'), /pas d'accolades/)
    assert.throws(() => parseEffect('ink', 'color: {"src":"a"}'), /pas d'accolades|color/)
  })

  it('une variable est suivie, sa règle laisse passer une chaîne ou un objet intacts', () => {
    const p = parseEffect('ink', 'image: $masque')
    assert.deepEqual(p.dynamic, { image: '$masque' })
    assert.deepEqual(p.fixed, {})
  })

  it('le panneau de développement liste le réglage image sans le casser', () => {
    const c = devCatalog(['ink', 'blend'])
    assert.equal(c.ink.s.image[0][0], 'x')
    assert.equal(c.ink.s.image[1], null)
    JSON.stringify(c)
  })
})

describe('réglage image — le build complet', function () {
  this.timeout(120000)
  let code = ''
  let fenetre: any

  before(async () => {
    const root   = mjsTmp('effets-reglage-image')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'm.png'), png())
    writeFileSync(join(srcDir, 'fx-ecrite.mjs'), '<div class="a" *ink(image: \'/masques/logo.png\', on: load)>a</div>')
    writeFileSync(join(srcDir, 'fx-asset.mjs'), '<div class="b" *ink(image: µasset(\'m.png\'), on: load)>b</div>')
    writeFileSync(join(srcDir, 'fx-image.mjs'), '<div class="c" *ink(image: µimage(\'m.png\'), on: load)>c</div>')
    writeFileSync(join(srcDir, 'fx-largeurs.mjs'), '<div class="d" *ink(image: µimage(\'m.png\', 32, 48), on: load)>d</div>')
    writeFileSync(join(srcDir, 'fx-variable.mjs'), '<script>\n$masque = µimage(\'m.png\')\n</script>\n<div class="e" *ink(image: $masque, on: load)>e</div>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    fenetre = new Window({ url: 'http://localhost/' })
    fenetre.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    fenetre?.close?.()
    await terminateSharedWorkerPool()
  })

  it('l\'adresse écrite part telle quelle dans le code compilé', () => {
    assert.match(code, /"ink", \{"image":"\/masques\/logo\.png","on":"load"\}/)
  })

  it('µasset(…) : l\'adresse publiée, une chaîne', () => {
    assert.match(code, /"ink", \{"image":"\/[^"]*m[^"]*\.png","on":"load"\}/)
  })

  it('µimage(…) : l\'adresse publiée (chaîne s\'il n\'y a pas de variante), jamais sizes, width ni height', () => {
    assert.match(code, /"ink", \{"image":(?:"\/[^"]*m[^"]*\.png"|\{"src":"[^"]+"(?:,"srcset":"[^"]+")?\}),"on":"load"\}/)
    assert.doesNotMatch(code, /"sizes":"100vw"[^}]*"on":"load"/)
    assert.doesNotMatch(code, /"image":\{[^}]*"(?:width|height|sizes)"/)
    assert.doesNotMatch(code, /"image":\s*µimage/)
  })

  it('µimage(…, 32, 48) : compile, avec ou sans sharp', () => {
    const m = /"ink", \{"image":(\{[^}]*\}|"[^"]*"),"on":"load"\}/g
    const tous = [...code.matchAll(m)].map((x) => JSON.parse(x[1]))
    assert.ok(tous.length >= 4, `quatre effets *ink attendus : ${tous.length}`)
    for (const v of tous) {
      if (typeof v === 'string') continue
      assert.equal(typeof v.src, 'string')
      assert.deepEqual(Object.keys(v).filter((k) => !['src', 'srcset'].includes(k)), [])
    }
  })

  it('une variable : µimage(…) dans le <script> devient un objet, la règle du moteur le laisse intact', () => {
    assert.match(code, /\$masque|masque/)
    const regle = parseEffect('ink', 'image: $masque').spec.image
    const obj   = { src: '/a.png', srcset: '/a-480.png 480w' }
    const r1    = fenetre.µ._mjs_fxNorm(obj, regle)
    assert.deepEqual(JSON.parse(JSON.stringify(r1)), [obj, 0])
    assert.strictEqual(r1[0], obj)
    assert.deepEqual(JSON.parse(JSON.stringify(fenetre.µ._mjs_fxNorm('/b.png', regle))), ['/b.png', 0])
    assert.deepEqual(JSON.parse(JSON.stringify(fenetre.µ._mjs_fxNorm('', regle))), [null, 0])
  })

  it('µimage(…) sans fichier : le placeholder du build est gardé (même comportement que µasset)', async () => {
    const js = (await transpile("<div *ink(image: µimage('m.png'))>x</div>", { moduleName: 'fx-essai', resolveAsset: async (c: string) => c, preResolvedImages: { "µimage('m.png')": JSON.stringify({ src: '/MISSING_MJS_ASSET:m.png', srcset: '', sizes: '', width: null, height: null }) } })).output
    assert.match(js, /"image":"\/MISSING_MJS_ASSET:m\.png"/)
  })
})

describe('réglages — une accolade dans un texte ne retient pas les réglages suivants', () => {
  it('une accolade seule, sans guillemets, dans un mot', () => {
    assert.deepEqual(parseEffect('matrix', 'chars: AB{CD, speed: 3').fixed, { chars: 'AB{CD', speed: 3 })
    assert.deepEqual(parseEffect('matrix', 'chars: }, speed: 3').fixed, { chars: '}', speed: 3 })
    assert.deepEqual(parseEffect('scratch', 'text: Gratte{, brush: 40').fixed, { text: 'Gratte{', brush: 40 })
  })

  it('une accolade dans une liste de mots', () => {
    assert.deepEqual(parseEffect('cycle', '[a, {b], speed: 300ms').fixed, { words: ['a', '{b'], speed: '300ms' })
  })

  it('une accolade qui ouvre la valeur sans jamais se fermer : un texte comme un autre', () => {
    assert.deepEqual(parseEffect('matrix', 'chars: {AB, speed: 3').fixed, { chars: '{AB', speed: 3 })
    assert.deepEqual(parseEffect('scratch', 'text: {a, brush: 40').fixed, { text: '{a', brush: 40 })
    assert.deepEqual(parseEffect('cycle', '[{a, b], speed: 300ms').fixed, { words: ['{a', 'b'], speed: '300ms' })
  })

  it('un objet µimage (virgules dedans) et, plus loin, une accolade jamais fermée : l\'objet reste entier', () => {
    assert.deepEqual(parseEffect('scratch', `image: ${OBJET}, text: {Gratte`).fixed, { image: { src: '/assets/m-abc.png', srcset: '/assets/m-32.png 32w, /assets/m-48.png 48w' }, text: '{Gratte' })
  })
})

describe('µ._mjs_fxImage — la variante à charger', () => {
  let fenetre: any
  const SRCSET = '/a-480.png 480w, /a-960.png 960w'
  const balise = (largeur: number) => ({ getBoundingClientRect: () => ({ width: largeur }) })

  before(async function () {
    this.timeout(120000)
    const root   = mjsTmp('effets-reglage-image-moteur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-m.mjs'), '<div class="a" *ink(on: load)>a</div>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    fenetre = new Window({ url: 'http://localhost/' })
    fenetre.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    fenetre?.close?.()
    await terminateSharedWorkerPool()
  })

  const image = (v: unknown, el: unknown, densite = 1) => {
    fenetre.devicePixelRatio = densite
    return fenetre.µ._mjs_fxImage(v, el)
  }

  it('une chaîne : telle quelle', () => {
    assert.equal(image('/a.png', balise(300)), '/a.png')
  })

  it('un objet sans srcset : son src', () => {
    assert.equal(image({ src: '/a.png' }, balise(300)), '/a.png')
    assert.equal(image({ src: '/a.png', srcset: '' }, balise(300)), '/a.png')
  })

  it('un objet avec srcset : la plus petite variante qui couvre la balise × la densité', () => {
    const o = { src: '/a.png', srcset: SRCSET }
    assert.equal(image(o, balise(300), 1), '/a-480.png')
    assert.equal(image(o, balise(300), 2), '/a-960.png')
    assert.equal(image(o, balise(480), 1), '/a-480.png')
  })

  it('une balise plus large que toutes les variantes : l\'image d\'origine, comme sans variante', () => {
    assert.equal(image({ src: '/a.png', srcset: SRCSET }, balise(2000), 1), '/a.png')
    assert.equal(image({ src: '/a.png', srcset: SRCSET }, balise(600), 2), '/a.png')
    assert.equal(image({ src: '/a.png', srcset: '' }, balise(600), 2), '/a.png')
  })

  it('une balise pas encore mise en page (largeur 0) : la largeur de la fenêtre fait foi, jamais la plus petite variante', () => {
    const o = { src: '/a.png', srcset: SRCSET }
    fenetre.innerWidth = 900
    assert.equal(image(o, balise(0), 1), '/a-960.png')
    fenetre.innerWidth = 400
    assert.equal(image(o, balise(0), 1), '/a-480.png')
  })

  it('null, undefined, chaîne vide : une chaîne vide', () => {
    assert.equal(image(null, balise(300)), '')
    assert.equal(image(undefined, balise(300)), '')
    assert.equal(image('', balise(300)), '')
  })
})
