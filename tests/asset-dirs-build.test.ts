// assetDirs : des dossiers d'images EN PLUS de sourceDir. `µimage`, `µasset` (et ses alias `µ.asset`, `mjsasset`, `mjs.asset`)
// et `<@@img>` y cherchent une image quand sourceDir ne la porte pas : sourceDir d'abord, puis chaque dossier de la liste, dans
// l'ordre. Tout se joue au build — empreinte, copie et adresse comme pour une image de sourceDir ; rien de plus n'est envoyé au
// navigateur. Un même nom dans deux dossiers : le premier gagne et le build avertit en nommant les deux fichiers. Un nom
// introuvable partout : le build s'arrête et nomme les dossiers fouillés. Le code (.mjs, .civet, .coffee, .js) reste sous sourceDir.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const SVG = '<svg width="200" height="50" xmlns="http://www.w3.org/2000/svg"></svg>'

// un projet jetable : sourceDir (src), deux dossiers d'images (images-a, images-b), la sortie et le manifeste
function projet(prefix: string) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const imgA   = join(root, 'images-a')
  const imgB   = join(root, 'images-b')
  for (const dossier of [srcDir, imgA, imgB]) mkdirSync(dossier, { recursive: true })
  return { root, srcDir, imgA, imgB, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

type Projet = ReturnType<typeof projet>

// un build ; `assetDirs` absent = l'appli n'a pas la clé
async function construire(p: Projet, assetDirs?: string[], options: Record<string, unknown> = {}) {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, urlPrefix: '/mjs', sourceMap: 'never', a11y: false, ...(assetDirs ? { assetDirs } : {}), ...options } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  return stats
}

const erreurs = (stats: { errors: Error[] }) => stats.errors.map(e => e.message).join('\n')

// le code publié d'un composant : `<nom>-<empreinte>.js`
function codeDe(p: Projet, nom: string): string {
  const fichier = readdirSync(p.outDir).find(f => new RegExp(`^${nom}-[0-9a-z]+\\.js$`).test(f))
  assert.ok(fichier, `${nom}-<empreinte>.js attendu, sortie : ${readdirSync(p.outDir).join(', ')}`)
  return readFileSync(join(p.outDir, fichier!), 'utf-8')
}

// tout ce qu'un build écrit : nom de fichier → empreinte du contenu, manifeste compris
function sortieDe(p: Projet): Record<string, string> {
  const sortie: Record<string, string> = {}
  const empreinte = (f: string) => createHash('md5').update(readFileSync(f)).digest('hex')
  for (const e of readdirSync(p.outDir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) if (e.isFile()) sortie[e.name] = empreinte(join(p.outDir, e.name))
  if (existsSync(p.manifest)) sortie['<manifeste>'] = empreinte(p.manifest)
  return sortie
}

const PAGE_IMAGE = '<script>\nphoto = µimage(\'hero.png\')\n</script>\n\n<img src={photo.src} width={photo.width} height={photo.height}>'

describe('assetDirs — une image cherchée dans les dossiers de la liste', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('µimage trouve l\'image d\'un dossier de la liste : adresse hachée, dimensions natives, fichier copié', async () => {
    const p = projet('assetdirs-image')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.srcDir, 'page.mjs'), PAGE_IMAGE)
    const stats = await construire(p, [p.imgA])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const code = codeDe(p, 'page')
    assert.ok(!/µimage/.test(code), `l'appel doit avoir disparu :\n${code.slice(0, 400)}`)
    assert.match(code, /"width":\s*1600/)
    assert.match(code, /"height":\s*900/)
    assert.match(code, /\/mjs\/hero-[a-f0-9]{8}\.png/)
    assert.ok(readdirSync(p.outDir).some(f => /^hero-[a-f0-9]{8}\.png$/.test(f)), `l'image est copiée dans la sortie : ${readdirSync(p.outDir).join(', ')}`)
  })

  it('µasset et ses alias µ.asset, mjsasset, mjs.asset trouvent l\'image d\'un dossier de la liste', async () => {
    for (const sigil of ['µ', 'mjs'] as const) {
      const p = projet('assetdirs-asset-' + (sigil === 'µ' ? 'mu' : 'mjs'))
      writeFileSync(join(p.imgA, 'logo.svg'), SVG)
      writeFileSync(join(p.imgB, 'fond.png'), validPng(64, 64))
      const [direct, point] = sigil === 'µ' ? ['µasset', 'µ.asset'] : ['mjsasset', 'mjs.asset']
      writeFileSync(join(p.srcDir, 'page.mjs'), `<script>\nlogo = ${direct}('logo.svg')\nfond = ${point}('fond.png')\n</script>\n<img src={logo}>\n<img src={fond}>`)
      const stats = await construire(p, [p.imgA, p.imgB], { sigil })
      assert.equal(stats.errors.length, 0, `${sigil} : ${erreurs(stats)}`)
      const code = codeDe(p, 'page')
      assert.match(code, /\/mjs\/logo-[a-f0-9]{8}\.svg/, `${sigil} : ${code.slice(0, 400)}`)
      assert.match(code, /\/mjs\/fond-[a-f0-9]{8}\.png/, `${sigil} : ${code.slice(0, 400)}`)
      assert.ok(!/MISSING_MJS_ASSET/.test(code))
      assert.ok(readdirSync(p.outDir).some(f => /^logo-[a-f0-9]{8}\.svg$/.test(f)) && readdirSync(p.outDir).some(f => /^fond-[a-f0-9]{8}\.png$/.test(f)), 'les deux fichiers sont copiés')
    }
  })

  it('<@@img src="…"> trouve l\'image d\'un dossier de la liste : balise complète, comme pour une image de sourceDir', async () => {
    const p = projet('assetdirs-img-balise')
    writeFileSync(join(p.imgB, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.srcDir, 'page.mjs'), '<@@img src="hero.png" alt="x"></@@img>')
    const stats = await construire(p, [p.imgA, p.imgB])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const code = codeDe(p, 'page')
    assert.match(code, /hero-[a-f0-9]{8}\.png/, code.slice(0, 400))
    assert.match(code, /width=.1600./, code.slice(0, 400))
    assert.match(code, /height=.900./, code.slice(0, 400))
    assert.match(code, /alt=.x./, code.slice(0, 400))
  })

  it('l\'image d\'un réglage d\'effet (`*behind(\'hero.png\')`) se cherche dans les mêmes dossiers', async () => {
    const p = projet('assetdirs-effet')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.srcDir, 'fx-fond.mjs'), '<div class="a" *behind(\'hero.png\', depth: 1)></div>')
    const stats = await construire(p, [p.imgA])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(codeDe(p, 'fx-fond'), /\/mjs\/hero-[a-f0-9]{8}\.png/)
  })

  it('une image d\'un sous-dossier se cherche par son chemin sous le dossier de la liste', async () => {
    const p = projet('assetdirs-sous-dossier')
    mkdirSync(join(p.imgA, 'icones'), { recursive: true })
    writeFileSync(join(p.imgA, 'icones', 'etoile.png'), validPng(32, 32))
    writeFileSync(join(p.srcDir, 'page.mjs'), '<script>\nicone = µimage(\'icones/etoile.png\')\n</script>\n<img src={icone.src}>')
    const stats = await construire(p, [p.imgA])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(codeDe(p, 'page'), /\/mjs\/etoile-[a-f0-9]{8}\.png/)
  })

  it('une image posée dans un dossier de la liste donne EXACTEMENT la sortie d\'une image posée dans sourceDir', async () => {
    const page = '<script>\nphoto = µimage(\'hero.png\')\nlogo = µasset(\'logo.svg\')\n</script>\n<img src={photo.src} width={photo.width} height={photo.height}>\n<img src={logo}>\n<@@img src="bandeau.png" alt="bandeau"></@@img>'
    const images: Array<[string, Buffer | string]> = [['hero.png', validPng(1600, 900)], ['logo.svg', SVG], ['bandeau.png', validPng(800, 200)]]

    const dedans = projet('assetdirs-equiv-source')
    for (const [nom, contenu] of images) writeFileSync(join(dedans.srcDir, nom), contenu)
    writeFileSync(join(dedans.srcDir, 'page.mjs'), page)
    const stats1 = await construire(dedans)
    assert.equal(stats1.errors.length, 0, erreurs(stats1))

    const dehors = projet('assetdirs-equiv-liste')
    for (const [nom, contenu] of images) writeFileSync(join(dehors.imgA, nom), contenu)
    writeFileSync(join(dehors.srcDir, 'page.mjs'), page)
    const stats2 = await construire(dehors, [dehors.imgA])
    assert.equal(stats2.errors.length, 0, erreurs(stats2))

    assert.deepEqual(sortieDe(dehors), sortieDe(dedans))
  })
})

describe('assetDirs — l\'ordre de recherche', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('sourceDir passe d\'abord, puis chaque dossier de la liste dans l\'ordre', async () => {
    const largeurChoisie = async (prefix: string, avecSource: boolean, ordre: string[]): Promise<number> => {
      const p = projet(prefix)
      writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
      writeFileSync(join(p.imgB, 'hero.png'), validPng(800, 450))
      if (avecSource) writeFileSync(join(p.srcDir, 'hero.png'), validPng(400, 225))
      writeFileSync(join(p.srcDir, 'page.mjs'), PAGE_IMAGE)
      const dossiers = ordre.map(nom => nom === 'a' ? p.imgA : p.imgB)
      const stats = await construire(p, dossiers, { lint: { image: false } })
      assert.equal(stats.errors.length, 0, erreurs(stats))
      return Number(/"width":\s*(\d+)/.exec(codeDe(p, 'page'))![1])
    }
    assert.equal(await largeurChoisie('assetdirs-ordre-ab', false, ['a', 'b']), 1600, 'le premier dossier de la liste')
    assert.equal(await largeurChoisie('assetdirs-ordre-ba', false, ['b', 'a']), 800, 'la liste dans l\'ordre écrit')
    assert.equal(await largeurChoisie('assetdirs-ordre-source', true, ['a', 'b']), 400, 'sourceDir avant toute la liste')
    assert.equal(await largeurChoisie('assetdirs-ordre-source-ba', true, ['b', 'a']), 400, 'sourceDir avant toute la liste, quel que soit l\'ordre')
  })
})

describe('assetDirs — un même nom dans deux dossiers', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  // les lignes d'avertissement qui parlent de l'image
  const doublons = (stats: { warnings: string[] }) => stats.warnings.filter(w => w.includes('hero.png'))

  it('sourceDir et un dossier de la liste : celui de sourceDir gagne, le build avertit en nommant les deux fichiers', async () => {
    const p = projet('assetdirs-doublon-source')
    writeFileSync(join(p.srcDir, 'hero.png'), validPng(400, 225))
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.srcDir, 'page.mjs'), PAGE_IMAGE)
    const stats = await construire(p, [p.imgA])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(codeDe(p, 'page'), /"width":\s*400/, 'l\'image de sourceDir est celle qui sert')
    const lignes = doublons(stats)
    assert.equal(lignes.length, 1, `un seul avertissement attendu : ${stats.warnings.join(' | ')}`)
    assert.ok(lignes[0].includes(join(p.srcDir, 'hero.png')), `nomme le fichier retenu : ${lignes[0]}`)
    assert.ok(lignes[0].includes(join(p.imgA, 'hero.png')), `nomme le fichier écarté : ${lignes[0]}`)
    assert.ok(lignes[0].includes('[lint.image]'), 'étiqueté comme les autres avertissements d\'image')
  })

  it('deux dossiers de la liste : le premier gagne, le build avertit en nommant les deux fichiers', async () => {
    const p = projet('assetdirs-doublon-liste')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.imgB, 'hero.png'), validPng(800, 450))
    writeFileSync(join(p.srcDir, 'page.mjs'), PAGE_IMAGE)
    const stats = await construire(p, [p.imgA, p.imgB])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(codeDe(p, 'page'), /"width":\s*1600/)
    const lignes = doublons(stats)
    assert.equal(lignes.length, 1, `un seul avertissement attendu : ${stats.warnings.join(' | ')}`)
    assert.ok(lignes[0].includes(join(p.imgA, 'hero.png')) && lignes[0].includes(join(p.imgB, 'hero.png')), lignes[0])
  })

  it('l\'avertissement ne se répète pas quand plusieurs composants citent la même image', async () => {
    const p = projet('assetdirs-doublon-une-fois')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.imgB, 'hero.png'), validPng(800, 450))
    for (const nom of ['un', 'deux', 'trois']) writeFileSync(join(p.srcDir, `${nom}.mjs`), PAGE_IMAGE)
    const stats = await construire(p, [p.imgA, p.imgB])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.equal(doublons(stats).length, 1, stats.warnings.join(' | '))
  })

  it('aucun avertissement quand un seul dossier porte le nom, ni quand le même dossier est écrit deux fois', async () => {
    const p = projet('assetdirs-pas-de-doublon')
    writeFileSync(join(p.imgB, 'hero.png'), validPng(800, 450))
    writeFileSync(join(p.srcDir, 'page.mjs'), PAGE_IMAGE)
    const stats = await construire(p, [p.imgA, p.imgB, p.imgB, p.srcDir])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.deepEqual(doublons(stats), [])
  })

  it('un homonyme que personne ne cite ne fait pas d\'avertissement', async () => {
    const p = projet('assetdirs-homonyme-non-cite')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.imgB, 'hero.png'), validPng(800, 450))
    writeFileSync(join(p.srcDir, 'page.mjs'), '<p>sans image</p>')
    const stats = await construire(p, [p.imgA, p.imgB])
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.deepEqual(doublons(stats), [])
  })

  it('`lint.image: false` coupe l\'avertissement, l\'image retenue ne change pas', async () => {
    const p = projet('assetdirs-doublon-coupe')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.imgB, 'hero.png'), validPng(800, 450))
    writeFileSync(join(p.srcDir, 'page.mjs'), PAGE_IMAGE)
    const stats = await construire(p, [p.imgA, p.imgB], { lint: { image: false } })
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.deepEqual(doublons(stats), [])
    assert.match(codeDe(p, 'page'), /"width":\s*1600/)
  })
})

describe('assetDirs — introuvable partout', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  const CITATIONS: Array<[string, string]> = [
    ['µimage', '<script>\nphoto = µimage(\'nexistepas.png\')\n</script>\n<p>x</p>'],
    ['µasset', '<script>\nchemin = µasset(\'nexistepas.png\')\n</script>\n<p>x</p>'],
    ['<@@img>', '<@@img src="nexistepas.png" alt="x"></@@img>'],
    ['réglage d\'effet', '<div class="a" *behind(\'nexistepas.png\', depth: 1)></div>'],
  ]

  for (const [forme, composant] of CITATIONS) {
    it(`${forme} : le build s'arrête et nomme les dossiers fouillés, dans l'ordre`, async () => {
      const p = projet('assetdirs-introuvable')
      writeFileSync(join(p.srcDir, 'page.mjs'), composant)
      const stats = await construire(p, [p.imgA, p.imgB])
      assert.ok(stats.errors.length > 0, 'une image introuvable partout fait échouer le build')
      const message = erreurs(stats)
      assert.match(message, /nexistepas\.png/)
      const places = [p.srcDir, p.imgA, p.imgB].map(d => message.indexOf(d))
      assert.ok(places.every(i => i >= 0), `le message nomme sourceDir et chaque dossier de la liste :\n${message}`)
      assert.ok(places[0] < places[1] && places[1] < places[2], `dans l'ordre de recherche :\n${message}`)
    })
  }

  it('sans la clé, le message d\'introuvable ne change pas : il finit sur la même phrase, aucun dossier nommé', async () => {
    const p = projet('assetdirs-introuvable-sans-cle')
    writeFileSync(join(p.srcDir, 'page.mjs'), '<script>\nchemin = µasset(\'nexistepas.png\')\n</script>\n<p>x</p>')
    const stats = await construire(p)
    const message = erreurs(stats)
    assert.match(message, /Asset introuvable : 'nexistepas\.png'/)
    assert.ok(message.endsWith('Vérifiez le chemin ou que le fichier existe.'), message)
    assert.ok(!/fouill/i.test(message), message)
  })

  it('avec la clé, une liste vide est la même chose que pas de clé', async () => {
    const p = projet('assetdirs-introuvable-liste-vide')
    writeFileSync(join(p.srcDir, 'page.mjs'), '<script>\nchemin = µasset(\'nexistepas.png\')\n</script>\n<p>x</p>')
    const stats = await construire(p, [])
    assert.ok(!/fouill/i.test(erreurs(stats)), erreurs(stats))
  })
})

describe('assetDirs — ce qui reste sous sourceDir', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('un fichier de code (.js) n\'est jamais cherché dans la liste : introuvable', async () => {
    const p = projet('assetdirs-code-js')
    writeFileSync(join(p.imgA, 'lib.js'), 'export const a = 1\n')
    writeFileSync(join(p.srcDir, 'page.mjs'), '<script>\nlib = µasset(\'lib.js\')\n</script>\n<p>x</p>')
    const stats = await construire(p, [p.imgA])
    assert.ok(stats.errors.length > 0, 'le code ne se prend pas dans un dossier d\'images')
    assert.match(erreurs(stats), /lib\.js/)
    assert.ok(!readdirSync(p.outDir).some(f => /^lib-/.test(f)), 'jamais copié')
  })

  it('un chemin qui sort du dossier de la liste n\'est pas suivi : introuvable, rien n\'est copié', async () => {
    const p = projet('assetdirs-evasion')
    writeFileSync(join(p.root, 'secret.png'), validPng(10, 10))
    writeFileSync(join(p.srcDir, 'page.mjs'), '<script>\nchemin = µasset(\'../secret.png\')\n</script>\n<p>x</p>')
    const stats = await construire(p, [p.imgA])
    assert.ok(stats.errors.length > 0, 'un chemin qui remonte hors des dossiers est refusé')
    assert.ok(!readdirSync(p.outDir).some(f => /^secret-/.test(f)), 'le fichier hors des dossiers n\'est jamais copié')
  })

  it('un lien symbolique d\'un dossier de la liste qui pointe hors de ce dossier fait échouer le build, jamais une copie', async () => {
    const p = projet('assetdirs-lien')
    writeFileSync(join(p.root, 'secret.png'), validPng(10, 10))
    symlinkSync(join(p.root, 'secret.png'), join(p.imgA, 'lien.png'))
    writeFileSync(join(p.srcDir, 'page.mjs'), '<script>\nchemin = µasset(\'lien.png\')\n</script>\n<p>x</p>')
    const stats = await construire(p, [p.imgA])
    assert.ok(stats.errors.length > 0, 'un lien qui sort du dossier est refusé')
    assert.match(erreurs(stats), /assetDirs/)
    assert.ok(!readdirSync(p.outDir).some(f => /^(secret|lien)-/.test(f)), 'jamais copié')
  })
})

describe('assetDirs — l\'image est une dépendance du composant', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('modifier l\'image d\'un dossier de la liste recompile le composant qui l\'utilise', async () => {
    const p = projet('assetdirs-dependance')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.srcDir, 'page.mjs'), PAGE_IMAGE)
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [p.imgA] } as any)
    try {
      const premier = await bundler.compile()
      assert.equal(premier.errors.length, 0, erreurs(premier))
      assert.match(codeDe(p, 'page'), /"width":\s*1600/)

      writeFileSync(join(p.imgA, 'hero.png'), validPng(800, 400))
      const second = await bundler.compile()
      assert.equal(second.errors.length, 0, erreurs(second))
      assert.match(codeDe(p, 'page'), /"width":\s*800/, 'le composant porte les NOUVELLES dimensions')
      assert.equal(readdirSync(p.outDir).filter(f => /^hero-[a-f0-9]{8}\.png$/.test(f)).length, 1, `un seul hero publié : ${readdirSync(p.outDir).join(', ')}`)
    }
    finally {
      await bundler.close()
    }
  })

  it('un module .civet qui cite l\'image d\'un dossier de la liste suit l\'image, lui et le composant qui l\'importe', async () => {
    const p = projet('assetdirs-module')
    writeFileSync(join(p.imgA, 'logo.png'), validPng(64, 64))
    writeFileSync(join(p.srcDir, 'util.civet'), 'export logo = µasset(\'logo.png\')\n')
    writeFileSync(join(p.srcDir, 'a.mjs'), '@import logo \'util.civet\'\n<script>\n  go = -> logo\n</script>\n<p>a</p>\n')
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [p.imgA] } as any)
    try {
      const premier = await bundler.compile()
      assert.equal(premier.errors.length, 0, erreurs(premier))
      assert.match(codeDe(p, 'util'), /logo-[a-f0-9]{8}\.png/)

      writeFileSync(join(p.imgA, 'logo.png'), validPng(128, 128))
      const second = await bundler.compile()
      assert.equal(second.errors.length, 0, erreurs(second))
      const util = readdirSync(p.outDir).filter(f => /^util-[0-9a-z]+\.js$/.test(f))
      assert.equal(util.length, 1, `un seul util publié : ${util.join(', ')}`)
      assert.ok(codeDe(p, 'a').includes(util[0]), `le composant vise le util à jour (${util[0]}) :\n${codeDe(p, 'a').slice(0, 400)}`)
    }
    finally {
      await bundler.close()
    }
  })
})

describe('assetDirs — une appli sans la clé a la même sortie, à l\'octet', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  const PAGE = '<script>\nphoto = µimage(\'hero.png\')\nlogo = µasset(\'logo.svg\')\n</script>\n<img src={photo.src} width={photo.width} height={photo.height}>\n<img src={logo}>\n<@@img src="bandeau.png" alt="bandeau"></@@img>'

  it('pas de clé, liste vide, liste d\'un dossier sans rapport, liste avec un homonyme : même sortie', async () => {
    const p = projet('assetdirs-identique')
    writeFileSync(join(p.srcDir, 'hero.png'), validPng(1600, 900))
    writeFileSync(join(p.srcDir, 'logo.svg'), SVG)
    writeFileSync(join(p.srcDir, 'bandeau.png'), validPng(800, 200))
    writeFileSync(join(p.srcDir, 'page.mjs'), PAGE)
    writeFileSync(join(p.imgA, 'autre.png'), validPng(10, 10))
    writeFileSync(join(p.imgB, 'hero.png'), validPng(50, 50))   // un homonyme : sourceDir gagne

    const stats0 = await construire(p)
    assert.equal(stats0.errors.length, 0, erreurs(stats0))
    const reference = sortieDe(p)
    assert.ok(Object.keys(reference).length >= 5, `la sortie de référence n'est pas vide : ${Object.keys(reference).join(', ')}`)

    for (const [etiquette, liste] of [['liste vide', []], ['dossier sans rapport', [p.imgA]], ['homonyme écarté', [p.imgB]]] as Array<[string, string[]]>) {
      rmSync(p.outDir, { recursive: true, force: true })
      rmSync(p.manifest, { force: true })
      const stats = await construire(p, liste)
      assert.equal(stats.errors.length, 0, `${etiquette} : ${erreurs(stats)}`)
      assert.deepEqual(sortieDe(p), reference, etiquette)
    }
  })
})
