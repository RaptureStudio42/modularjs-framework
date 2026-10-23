// un réglage d'image d'effet qui reçoit un chemin local écrit en clair (`*behind('photo.png')`, un élément de
// `*scrub(images: [...])`) est résolu au build comme s'il était écrit `µimage('photo.png')` : même validation, même
// empreinte, mêmes variantes. Une adresse complète, `data:`, `blob:`, une adresse qui part de la racine, une variable
// et un appel µimage / µasset déjà écrit restent tels quels. Un fichier absent fait échouer le build en nommant le chemin.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { parseEffect } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

// un PNG en niveaux de gris, w × 8
function png(w = 64): Buffer {
  const h = 8
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

// un projet : les images posées dans les sources, les composants écrits, le build ; rend le code publié et les erreurs
async function construire(nom: string, composants: Record<string, string>, options: Record<string, unknown> = {}): Promise<{ code: string, erreurs: string[], sortie: string[] }> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'img'), { recursive: true })
  writeFileSync(join(srcDir, 'photo.png'), png())
  writeFileSync(join(srcDir, 'img', 'photo.png'), png())
  for (const [fichier, texte] of Object.entries(composants)) writeFileSync(join(srcDir, fichier), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...options } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  // les scripts : un fichier par composant, ou (js: 'bundle') le fichier du manifeste
  const fichiers = [...readdirSync(outDir).filter((f) => f.endsWith('.js')).sort().map((f) => join(outDir, f)), join(root, 'bundle.js')]
  const code     = fichiers.filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf-8')).join('\n')
  return { code, erreurs: stats.errors.map((e: any) => String(e.message)), sortie: readdirSync(outDir) }
}

// la valeur du réglage `image` du *behind marqué par son `depth` (chaque composant a le sien)
function imageDe(code: string, depth: number): unknown {
  const m = new RegExp(`"behind", \\{"image":(\\{[^}]*\\}|"[^"]*"),"depth":${depth}\\}`).exec(code)
  return m ? JSON.parse(m[1]) : undefined
}

const ADRESSE = /^\/[\w/-]*photo-[0-9a-f]{8}\.png$/

const PROJET: Record<string, string> = {
  'fx-ecrit.mjs':      "<div class=\"a\" *behind('photo.png', depth: 1)></div>",
  'fx-image.mjs':      "<div class=\"a\" *behind(µimage('photo.png'), depth: 2)></div>",
  'fx-asset.mjs':      "<div class=\"a\" *behind(µasset('photo.png'), depth: 3)></div>",
  'fx-double.mjs':     '<div class="a" *behind("photo.png", depth: 4)></div>',
  'fx-nomme.mjs':      "<div class=\"a\" *behind(image: 'img/photo.png', depth: 5)></div>",
  'fx-point.mjs':      "<div class=\"a\" *behind('./photo.png', depth: 6)></div>",
  'fx-http.mjs':       "<div class=\"a\" *behind('https://exemple.test/p.png', depth: 7)></div>",
  'fx-protocole.mjs':  "<div class=\"a\" *behind('//exemple.test/p.png', depth: 8)></div>",
  'fx-data.mjs':       "<div class=\"a\" *behind('data:image/png;base64,AAAA', depth: 9)></div>",
  'fx-blob.mjs':       "<div class=\"a\" *behind('blob:http://localhost/abc', depth: 10)></div>",
  'fx-racine.mjs':     "<div class=\"a\" *behind('/photo.png', depth: 11)></div>",
  'fx-variable.mjs':   "<script>\n$img = 'photo.png'\n</script>\n<div class=\"a\" *behind($img, depth: 12)></div>",
  'fx-boucle.mjs':     "<script>\n$items = [{ src: 'photo.png' }]\n</script>\n{for item in $items}\n<div class=\"a\" *behind(item.src, depth: 13)></div>\n{end}",
  'fx-transition.mjs': "<div class=\"a\" @in=*ink(image: 'photo.png', style: brush)>x</div>",
  'fx-gradient.mjs':   "<h1 class=\"a\" *gradient('photo.png', size: 301)>M</h1>",
  'fx-hologram.mjs':   "<div class=\"a\" *hologram(image: 'photo.png', mask: 'img/photo.png', seed: 14)>x</div>",
  'fx-liste.mjs':      "<div class=\"a\" *scrub(images: ['photo.png', img/photo.png, 'data:image/png;base64,AAAA', 'https://exemple.test/p.png', '/photo.png', µasset('photo.png')], first: 15)></div>",
  'fx-exemples.mjs':   "<pre><div class=\"a\" *behind('absente.png', depth: 17)></div></pre>\n<!-- <div *behind('absente.png', depth: 18)></div> -->\n<p>Écrivez *behind('absente.png', depth: 19) sur une balise</p>"
}

describe('effets — un chemin local écrit en clair dans un réglage d\'image : le build le résout comme µimage', function () {
  this.timeout(180000)
  let code = ''
  let erreurs: string[] = []

  before(async () => {
    ({ code, erreurs } = await construire('effets-chemins-images', PROJET))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(erreurs, [])
    assert.match(code, /"behind"/, 'les scripts sont lus')
  })

  it('*behind(\'photo.png\') : l\'adresse publiée, avec son empreinte, pas le chemin écrit', () => {
    const v = imageDe(code, 1)
    assert.equal(typeof v, 'string', `le code publié ne porte pas la valeur attendue : ${code.match(/"behind", [^\n]{0,120}/)}`)
    assert.match(v as string, ADRESSE)
  })

  it('même valeur que µimage(\'photo.png\') écrit à la main, et que µasset(\'photo.png\')', () => {
    assert.deepEqual(imageDe(code, 1), imageDe(code, 2))
    assert.deepEqual(imageDe(code, 1), imageDe(code, 3))
  })

  it('guillemets doubles, réglage nommé, dossier, ./ : tous résolus', () => {
    for (const depth of [4, 5, 6]) assert.match(imageDe(code, depth) as string, ADRESSE, `depth ${depth}`)
  })

  it('une adresse complète, //, data:, blob: et une adresse qui part de la racine restent telles quelles', () => {
    assert.equal(imageDe(code, 7), 'https://exemple.test/p.png')
    assert.equal(imageDe(code, 8), '//exemple.test/p.png')
    assert.equal(imageDe(code, 9), 'data:image/png;base64,AAAA')
    assert.equal(imageDe(code, 10), 'blob:http://localhost/abc')
    assert.equal(imageDe(code, 11), '/photo.png')
  })

  it('une variable et la variable d\'une boucle restent des variables : le chemin qu\'elles tiennent n\'est pas touché', () => {
    for (const depth of [12, 13]) assert.match(code, new RegExp(`"behind", \\{"depth":${depth}\\}, \\{"image": \\(`), `depth ${depth} : l'image est suivie à part, pas une valeur fixe`)
    assert.doesNotMatch(code, /"image":"photo\.png"/, 'aucun chemin brut ne part dans une valeur fixe')
  })

  it('une transition (@in=*ink(image: \'photo.png\')) : résolue', () => {
    assert.match(code, /"ink", \{"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png","style":"brush"\}/)
  })

  it('une image sans nom, à côté du réglage principal d\'un effet (*gradient(\'photo.png\')) : résolue', () => {
    assert.match(code, /"gradient", \{"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png","size":301\}/)
  })

  it('deux réglages d\'image dans le même effet (*hologram : image et mask) : tous deux résolus', () => {
    assert.match(code, /"hologram", \{"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png","mask":"\/[\w/-]*photo-[0-9a-f]{8}\.png","seed":14\}/)
  })

  it('*scrub(images: [...]) : chaque chemin local de la liste est résolu, le reste de la liste est intact', () => {
    const m = /"scrub", \{"images":(\[[^\n]*?\]),"first":15\}/.exec(code)
    assert.ok(m, `la liste n'est pas dans le code publié : ${code.match(/"scrub", [^\n]{0,200}/)}`)
    const liste = JSON.parse(m![1]) as string[]
    assert.equal(liste.length, 6)
    // les deux chemins locaux : l'adresse publiée, avec son empreinte (l'effet ne lit pas les variantes de largeur)
    for (const i of [0, 1]) assert.match(liste[i], ADRESSE, `élément ${i} : ${liste[i]}`)
    assert.equal(liste[2], 'data:image/png;base64,AAAA')
    assert.equal(liste[3], 'https://exemple.test/p.png')
    assert.equal(liste[4], '/photo.png')
    assert.match(liste[5], ADRESSE, 'µasset(...) déjà écrit : une adresse')
  })

  it('un exemple dans <pre>, dans un commentaire ou dans du texte n\'est ni résolu ni refusé', () => {
    assert.equal(imageDe(code, 17), 'absente.png')
    assert.equal(imageDe(code, 18), undefined, 'le commentaire ne devient pas une balise')
    assert.match(code, /\*behind\((?:'|&#39;)absente\.png(?:'|&#39;), depth: 19\)/, 'le texte reste tel qu\'écrit')
  })
})

describe('effets — un chemin local absent : une erreur de build qui le nomme', function () {
  this.timeout(180000)
  let erreurs: string[] = []

  before(async () => {
    ({ erreurs } = await construire('effets-chemins-images-absents', {
      'fx-bon.mjs':         "<div class=\"a\" *behind('photo.png')></div>",
      'fx-absent.mjs':      "<div class=\"a\" *behind('absente.png')></div>",
      'fx-liste.mjs':       "<div class=\"a\" *scrub(images: ['photo.png', absente-liste.png])></div>",
      'fx-hors-racine.mjs': "<div class=\"a\" *behind('../hors-racine.png')></div>",
      'fx-ecrit.mjs':       "<div class=\"a\" *behind(µimage('absente-image.png'))></div>",
      'app.effects.mjs':    "<effects>\n  *fond = *behind('absente-alias.png')\n</effects>\n"
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('*behind(\'absente.png\') : l\'erreur nomme le chemin et l\'effet', () => {
    assert.ok(erreurs.some((m) => /absente\.png/.test(m) && /\*behind/.test(m)), erreurs.join('\n'))
  })

  it('un élément absent d\'une liste : l\'erreur nomme ce chemin et l\'effet', () => {
    assert.ok(erreurs.some((m) => /absente-liste\.png/.test(m) && /\*scrub/.test(m)), erreurs.join('\n'))
  })

  it('un chemin qui sort du dossier source : refusé, jamais publié', () => {
    assert.ok(erreurs.some((m) => /hors-racine\.png/.test(m)), erreurs.join('\n'))
  })

  it('µimage(\'absente-image.png\') écrit à la main : la même clarté (il nomme le chemin)', () => {
    assert.ok(erreurs.some((m) => /absente-image\.png/.test(m)), erreurs.join('\n'))
  })

  it('un chemin absent fixé par un effet de l\'appli : l\'erreur nomme le chemin, l\'effet, son fichier et sa ligne', () => {
    assert.ok(erreurs.some((m) => /absente-alias\.png/.test(m) && /\*fond/.test(m) && /app\.effects\.mjs/.test(m) && /ligne 2/.test(m)), erreurs.join('\n'))
  })

  it('le composant dont le chemin existe ne produit aucune erreur', () => {
    assert.ok(!erreurs.some((m) => /fx-bon/.test(m)), erreurs.join('\n'))
  })
})

describe('effets — le transpileur seul, sans disque', () => {
  const OBJET = JSON.stringify({ src: '/assets/photo-abc12345.png', srcset: '', sizes: '', width: 64, height: 8 })
  const OPTIONS = { moduleName: 'fx-essai', resolveAsset: async (c: string) => c, preResolvedImages: { "µimage('photo.png')": OBJET } }

  it('*behind(\'photo.png\') avec le résultat du build : l\'adresse publiée', async () => {
    const js = (await transpile("<div class=\"a\" *behind('photo.png')></div>", OPTIONS)).output
    assert.match(js, /"image":"\/assets\/photo-abc12345\.png"/)
    assert.doesNotMatch(js, /"image":"photo\.png"/)
  })

  it('sans résolution d\'assets (appel hors d\'un build) : le chemin écrit part tel quel, comme avant', async () => {
    const js = (await transpile("<div class=\"a\" *behind('photo.png')></div>", { moduleName: 'fx-essai' })).output
    assert.match(js, /"image":"photo\.png"/)
  })

  it('la lecture des réglages seule ne touche pas au chemin', () => {
    assert.deepEqual(parseEffect('behind', "'photo.png'").fixed, { image: 'photo.png' })
  })
})

// ---- les écritures qui construisaient avant ce réglage construisent encore

const ENCORE: Record<string, string> = {
  'r1-scrub-nu.mjs':     '<canvas class="a" *scrub(images: photo.png, first: 32)></canvas>',
  'r1-scrub-seul.mjs':   "<canvas class=\"a\" *scrub(images: 'photo.png', first: 33)></canvas>",
  'r2-scrub-boucle.mjs': "<script>\n$g = [{ frames: ['a.png'] }]\n</script>\n{for g in $g}<canvas class=\"a\" *scrub(images: g.frames, first: 34)></canvas>{end}"
}

describe('effets — une liste d\'images à valeur seule, ou tenue par une variable de boucle : le build passe, comme avant', function () {
  this.timeout(180000)
  let code = ''
  let erreurs: string[] = []

  before(async () => {
    ({ code, erreurs } = await construire('effets-chemins-images-encore', ENCORE))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(erreurs, [])
  })

  it('*scrub(images: photo.png), écrit nu : une liste d\'un élément, l\'adresse publiée', () => {
    const m = /"scrub", \{"images":(\[[^\n]*?\]),"first":32\}/.exec(code)
    assert.ok(m, `${code.match(/"scrub", [^\n]{0,160}/)}`)
    const liste = JSON.parse(m![1]) as string[]
    assert.equal(liste.length, 1)
    assert.match(liste[0], ADRESSE)
  })

  it('*scrub(images: \'photo.png\') : une liste d\'un élément, l\'adresse publiée', () => {
    const m = /"scrub", \{"images":(\[[^\n]*?\]),"first":33\}/.exec(code)
    assert.ok(m, `${code.match(/"scrub", [^\n]{0,160}/)}`)
    const liste = JSON.parse(m![1]) as string[]
    assert.equal(liste.length, 1)
    assert.match(liste[0], ADRESSE)
  })

  it('la liste d\'une variable de boucle (images: g.frames, images: g.src) reste une liste suivie à part : jamais prise pour un fichier', () => {
    assert.match(code, /"scrub", \{"first":34\}, \{"images": \(/)
  })
})

describe('effets — *pixels(swap, image:) et *offline(logo:) : des réglages d\'image, résolus comme les autres', function () {
  this.timeout(180000)
  let code = ''
  let erreurs: string[] = []

  before(async () => {
    ({ code, erreurs } = await construire('effets-chemins-images-pixels', {
      'r4-pixels.mjs':        "<div class=\"a\" *pixels(swap, image: 'photo.png', spread: 41)>x</div>",
      'r4-pixels-css.mjs':    "<div class=\"a\" *pixels(swap, image: 'linear-gradient(red, blue)', spread: 42)>x</div>",
      'r4-pixels-racine.mjs': "<div class=\"a\" *pixels(swap, image: '/photo.png', spread: 43)>x</div>",
      'r4-offline.mjs':       "<@document *offline(logo: 'photo.png', delay: 44ms)></@document>\n<p>x</p>",
      'r4-offline-texte.mjs': "<@document *offline(logo: '📡', delay: 45ms)></@document>\n<p>x</p>",
      'r4-offline-racine.mjs': "<@document *offline(logo: '/photo.png', delay: 46ms)></@document>\n<p>x</p>"
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(erreurs, [])
  })

  it('*pixels(swap, image: \'photo.png\') : l\'adresse publiée, pas le chemin écrit', () => {
    assert.match(code, /"pixels", \{"mode":"swap","image":"\/[\w/-]*photo-[0-9a-f]{8}\.png","spread":41\}/)
  })

  it('*pixels : un dégradé CSS et une adresse de la racine restent tels quels', () => {
    assert.match(code, /"pixels", \{"mode":"swap","image":"linear-gradient\(red, blue\)","spread":42\}/)
    assert.match(code, /"pixels", \{"mode":"swap","image":"\/photo\.png","spread":43\}/)
  })

  it('*offline(logo: \'photo.png\') : l\'adresse publiée ; un émoji et une adresse de la racine restent tels quels', () => {
    assert.match(code, /"offline", \{"logo":"\/[\w/-]*photo-[0-9a-f]{8}\.png","delay":"44ms"\}/)
    assert.match(code, /"offline", \{"logo":"📡","delay":"45ms"\}/)
    assert.match(code, /"offline", \{"logo":"\/photo\.png","delay":"46ms"\}/)
  })
})

describe('effets — un chemin écrit nu : résolu quand il finit par une extension d\'image, laissé quand c\'est une expression', function () {
  this.timeout(180000)
  let code = ''
  let erreurs: string[] = []

  before(async () => {
    ({ code, erreurs } = await construire('effets-chemins-images-nu', {
      'r3-nu.mjs':        '<div class="a" *behind(photo.png, depth: 51)></div>',
      'r3-nu-nomme.mjs':  '<h1 class="a" *gradient(image: photo.png, size: 302)>M</h1>',
      'r3-sans-ext.mjs':  '<div class="a" *behind(photo, depth: 52)></div>',
      'r3-boucle.mjs':    "<script>\n$items = [{ src: 'photo.png' }]\n</script>\n{for item in $items}<div class=\"a\" *behind(item.src, depth: 53)></div>{end}"
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(erreurs, [])
  })

  it('*behind(photo.png) et *gradient(image: photo.png) : l\'adresse publiée', () => {
    assert.match(imageDe(code, 51) as string, ADRESSE)
    assert.match(code, /"gradient", \{"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png","size":302\}/)
  })

  it('un mot sans extension d\'image, une propriété de boucle : laissés tels quels', () => {
    assert.equal(imageDe(code, 52), 'photo')
    assert.match(code, /"behind", \{"depth":53\}, \{"image": \(/)
  })
})

describe('effets — un partiel <@include>, un effet de l\'appli : leurs chemins sont lus aussi', function () {
  this.timeout(180000)
  let code = ''
  let erreurs: string[] = []

  before(async () => {
    ({ code, erreurs } = await construire('effets-chemins-images-partiel', {
      'fx-inclut.mjs':   '<@include fx-partiel>\n<p>x</p>',
      '_fx-partiel.mjs': "<div class=\"a\" *behind('photo.png', depth: 61)></div>",
      'app.effects.mjs': "<effects>\n  *fond = *behind('photo.png', depth: 62)\n  *cadre = *behind(depth: 63)\n</effects>\n",
      'fx-fond.mjs':     '<div class="a" *fond></div>',
      'fx-cadre.mjs':    "<div class=\"a\" *cadre('photo.png')></div>"
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(erreurs, [])
  })

  it('un chemin écrit dans un partiel inclus est résolu', () => {
    assert.match(imageDe(code, 61) as string, ADRESSE)
  })

  it('un chemin donné à la pose d\'un effet de l\'appli (*cadre(\'photo.png\')) est résolu avec les réglages de l\'effet qu\'il règle', () => {
    assert.match(code, /"behind", \{"depth":63,"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png"\}/)
  })

  it('un chemin fixé dans le fichier d\'effets de l\'appli (*fond = *behind(\'photo.png\')) est résolu aussi', () => {
    assert.match(code, /"behind", \{"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png","depth":62\}/)
  })
})

describe('effets — en production, les scripts en un fichier ou séparés : les mêmes adresses publiées', function () {
  this.timeout(240000)
  const PROJET_PROD: Record<string, string> = {
    'fx-behind.mjs':  "<div class=\"a\" *behind('photo.png', depth: 91)></div>",
    'fx-nu.mjs':      '<h1 class="a" *gradient(photo.png)>M</h1>',
    'fx-liste.mjs':   "<div class=\"a\" *scrub(images: ['photo.png', img/photo.png], first: 92)></div>",
    'fx-scrub.mjs':   "<canvas class=\"a\" *scrub(images: 'photo.png', first: 93)></canvas>",
    'fx-pixels.mjs':  "<div class=\"a\" *pixels(swap, image: 'photo.png', spread: 94)>x</div>",
    'fx-logo.mjs':    "<@document *offline(logo: 'photo.png', delay: 95ms)></@document>\n<p>x</p>"
  }

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const js of ['bundle', 'split']) {
    it(`js: ${js} : aucune erreur, le fichier copié sous empreinte, plus aucun chemin brut dans les scripts`, async () => {
      const { code, erreurs, sortie } = await construire('effets-chemins-images-prod-' + js, PROJET_PROD, { env: 'prod', js })
      assert.deepEqual(erreurs, [])
      assert.match(code, /"behind"|behind/, 'les scripts sont lus')
      assert.ok(sortie.some((f) => /^photo-[0-9a-f]{8}\.png$/.test(f)), sortie.join(', '))
      assert.deepEqual([...new Set(code.match(/photo-[0-9a-f]{8}\.png/g) ?? [])].length, 1, 'une seule adresse à empreinte dans les scripts : celle du fichier copié')
      assert.doesNotMatch(code, /["'`]\.?\/?(?:img\/)?photo\.png["'`]/, 'aucun chemin brut ne part dans les scripts')
    })
  }
})

describe('effets — l\'image d\'un effet est une dépendance du composant : changée, il est recompilé', function () {
  this.timeout(180000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('la suite d\'un même Bundler (mjs dev) : la nouvelle empreinte est dans le composant, l\'ancienne n\'y est plus — image à variantes, image seule, image d\'un effet de l\'appli', async () => {
    const root   = mjsTmp('effets-chemins-images-dev')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const image of ['photo', 'suite', 'fond']) writeFileSync(join(srcDir, image + '.png'), png())
    writeFileSync(join(srcDir, 'carte.mjs'), "<div class=\"a\" *behind('photo.png', depth: 81)></div>")
    writeFileSync(join(srcDir, 'suite.mjs'), "<canvas class=\"a\" *scrub(images: ['suite.png'], first: 82)></canvas>")
    writeFileSync(join(srcDir, 'app.effects.mjs'), "<effects>\n  *fond = *behind('fond.png', depth: 83)\n</effects>\n")
    writeFileSync(join(srcDir, 'alias.mjs'), '<div class="a" *fond></div>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const empreintes = (image: string) => readdirSync(outDir).filter((f) => new RegExp('^' + image + '-[0-9a-f]{8}\\.png$').test(f))
    const composant  = (nom: string) => readdirSync(outDir).filter((f) => new RegExp('^' + nom + '-.*\\.js$').test(f)).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    const stats1 = await bundler.compile()
    assert.deepEqual(stats1.errors.map((e: any) => String(e.message)), [])
    const avant: Record<string, string> = {}
    for (const image of ['photo', 'suite', 'fond']) {
      assert.equal(empreintes(image).length, 1, image)
      avant[image] = empreintes(image)[0]
    }
    for (const image of ['photo', 'suite', 'fond']) writeFileSync(join(srcDir, image + '.png'), png(32))
    const stats2 = await bundler.compile()
    assert.deepEqual(stats2.errors.map((e: any) => String(e.message)), [])
    for (const [composantNom, image] of [['carte', 'photo'], ['suite', 'suite'], ['alias', 'fond']]) {
      const apres = empreintes(image)
      assert.equal(apres.length, 1, image)
      assert.notEqual(apres[0], avant[image], image + ' : le fichier a une autre empreinte')
      const code = composant(composantNom)
      assert.ok(code.includes(apres[0]), composantNom + ' : le composant porte la nouvelle adresse')
      assert.ok(!code.includes(avant[image]), composantNom + ' : et plus l\'ancienne')
    }
    await bundler.close()
  })
})

// une adresse de `n` caractères
const adresse = (n: number) => 'data:image/svg+xml,' + 'x'.repeat(n - 'data:image/svg+xml,'.length)

describe('effets — le logo de *offline et la seconde image de *pixels : une adresse data: longue et la valeur vide passent le build', function () {
  this.timeout(180000)
  let code = ''
  let erreurs: string[] = []

  before(async () => {
    ({ code, erreurs } = await construire('effets-chemins-images-libres', {
      'fx-logo-long.mjs':   `<@document *offline(logo: '${adresse(2500)}', delay: 71ms)></@document>\n<p>x</p>`,
      'fx-pixels-long.mjs': `<div class="a" *pixels(swap, image: '${adresse(5000)}', spread: 72)>x</div>`,
      'fx-logo-vide.mjs':   "<@document *offline(logo: '', delay: 73ms)></@document>\n<p>x</p>",
      'fx-pixels-vide.mjs': "<div class=\"a\" *pixels(swap, image: '', spread: 74)>x</div>"
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(erreurs, [])
  })

  it('les adresses longues sont publiées telles qu\'écrites, les valeurs vides aussi', () => {
    assert.ok(code.includes(adresse(2500)), 'le logo de 2 500 caractères')
    assert.ok(code.includes(adresse(5000)), 'la seconde image de 5 000 caractères')
    assert.match(code, /"offline", \{"logo":"","delay":"73ms"\}/)
    assert.match(code, /"pixels", \{"mode":"swap","image":"","spread":74\}/)
  })
})

describe('effets — un effet de l\'appli qui fixe une image lue seule (*scrub), ou un mot qui n\'est pas un fichier', function () {
  this.timeout(180000)
  let code = ''
  let erreurs: string[] = []

  before(async () => {
    ({ code, erreurs } = await construire('effets-chemins-images-alias-seule', {
      'app.effects.mjs': "<effects>\n  *suite = *scrub(images: ['photo.png', 'img/photo.png'], first: 91)\n  *mot = *behind('sans-extension', depth: 92)\n</effects>\n",
      'fx-suite.mjs':    '<canvas class="a" *suite></canvas>',
      'fx-mot.mjs':      '<div class="a" *mot></div>'
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('le projet se construit sans erreur : un mot sans extension d\'image n\'est pas pris pour un fichier', () => {
    assert.deepEqual(erreurs, [])
  })

  it('*mot garde le mot tel qu\'écrit', () => {
    assert.match(code, /"behind", \{"image":"sans-extension","depth":92\}/)
  })

  it('*suite : l\'effet lit l\'adresse seule — le fichier sous empreinte, pas l\'objet de µimage', () => {
    assert.match(code, /"scrub", \{"images":\["\/[\w/-]*photo-[0-9a-f]{8}\.png","\/[\w/-]*photo-[0-9a-f]{8}\.png"\],"first":91\}/)
  })
})

describe('effets — un fichier absent fixé par un effet de l\'appli pour une image lue seule : une erreur de build qui le nomme', function () {
  this.timeout(180000)
  let erreursListe: string[] = []
  let erreursLogo: string[] = []

  before(async () => {
    ({ erreurs: erreursListe } = await construire('effets-chemins-images-alias-seule-absente', {
      'app.effects.mjs': "<effects>\n  *bon = *behind('photo.png', depth: 1)\n  *suite = *scrub(images: ['photo.png', 'absente-liste.png'], first: 2)\n</effects>\n",
      'fx-suite.mjs':    '<canvas class="a" *suite></canvas>'
    }))
    ;({ erreurs: erreursLogo } = await construire('effets-chemins-images-alias-logo-absent', {
      'app.effects.mjs': "<effects>\n  *bon = *behind('photo.png', depth: 1)\n  *logo = *offline(logo: 'absent-logo.png')\n</effects>\n",
      'fx-bon.mjs':      '<div class="a" *bon></div>'
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('un élément absent de la liste de *scrub : l\'erreur nomme le chemin, l\'effet, son fichier et sa ligne', () => {
    assert.ok(erreursListe.some((m) => /absente-liste\.png/.test(m) && /\*suite/.test(m) && /app\.effects\.mjs/.test(m) && /ligne 3/.test(m)), erreursListe.join('\n'))
  })

  it('le logo absent de *offline : l\'erreur nomme le chemin, l\'effet, son fichier et sa ligne', () => {
    assert.ok(erreursLogo.some((m) => /absent-logo\.png/.test(m) && /\*logo/.test(m) && /app\.effects\.mjs/.test(m) && /ligne 3/.test(m)), erreursLogo.join('\n'))
  })
})
