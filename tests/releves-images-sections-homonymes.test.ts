// Les relevés d'images du bundler (`<@@img>`, réglages d'image des effets) lisent le composant comme le compilateur : une
// balise dont le nom commence par celui d'une section (`<theme-toggle>`, `<effects-demo>`, `<routes-nav>`, `<vars-panel>`,
// `<types-list>`) est une balise du gabarit, pas une section, et une ligne de texte qui commence par `@nom` n'est pas une
// directive. Les images qu'elles portent, ou qui les suivent, sont copiées et récrites comme les autres : sans quoi la page
// publiée pointe vers un fichier jamais copié.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanImgTags } from '../src/transpiler/img-tag.js'
import { scanEffectImages } from '../src/transpiler/effect-images.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

function projet(prefix: string, page: string, images: string[]) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const image of images) writeFileSync(join(srcDir, image), validPng(32, 32))
  writeFileSync(join(srcDir, 'page.mjs'), page)
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

type Projet = ReturnType<typeof projet>

async function construire(p: Projet) {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, urlPrefix: '/mjs', sourceMap: 'never', a11y: false })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats
}

function codeDe(p: Projet): string {
  const fichier = readdirSync(p.outDir).find(f => /^page-[0-9a-z]+\.js$/.test(f))
  assert.ok(fichier, `page-<empreinte>.js attendu, sortie : ${readdirSync(p.outDir).join(', ')}`)
  return readFileSync(join(p.outDir, fichier!), 'utf-8')
}

describe('relevés d\'images — balises homonymes d\'une section, lignes de texte en @', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('une <@@img> dans un <theme-toggle> est copiée et récrite', async () => {
    const p     = projet('releve-theme', '<div>\n  <theme-toggle>\n    <@@img src="lune.png" alt="">\n  </theme-toggle>\n</div>\n', ['lune.png'])
    const stats = await construire(p)
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
    assert.match(codeDe(p), /\/mjs\/lune-[a-f0-9]{8}\.png/)
    assert.ok(readdirSync(p.outDir).some(f => /^lune-[a-f0-9]{8}\.png$/.test(f)), `lune.png copiée attendue : ${readdirSync(p.outDir).join(', ')}`)
  })

  it('après un <theme-toggle /> : une <@@img> introuvable arrête encore la construction', async () => {
    const p     = projet('releve-theme-auto', '<div>\n  <theme-toggle />\n  <@@img src="absente.png" alt="">\n</div>\n', [])
    const stats = await construire(p)
    assert.ok(stats.errors.some(e => /absente\.png/.test(e.message)), `erreur sur absente.png attendue, reçu : ${stats.errors.map(e => e.message).join(' | ') || 'aucune'}`)
  })

  it('le réglage d\'image d\'un effet posé dans un <effects-demo> est copié et récrit', async () => {
    const p     = projet('releve-effets-demo', '<section>\n  <effects-demo>\n    <div *behind(\'fond.png\')></div>\n  </effects-demo>\n</section>\n', ['fond.png'])
    const stats = await construire(p)
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
    assert.ok(readdirSync(p.outDir).some(f => /^fond-[a-f0-9]{8}\.png$/.test(f)), `fond.png copiée attendue : ${readdirSync(p.outDir).join(', ')}`)
  })

  it('relevés directs : <routes-nav>, <vars-panel>, <types-list>, ligne de racine en @', () => {
    const nav = '<nav>\n  <routes-nav>\n    <@@img src="a.png" alt="">\n  </routes-nav>\n  <vars-panel>\n    <div *blend(image: \'b.png\')></div>\n  </vars-panel>\n  <types-list>\n    <@@img src="c.png" alt="">\n  </types-list>\n</nav>\n'
    assert.deepEqual(scanImgTags(nav).map(t => t.src), ['a.png', 'c.png'])
    assert.deepEqual(scanEffectImages(nav).map(e => e.path), ['b.png'])
    assert.deepEqual(scanImgTags('<p>Suivez :</p>\n@rapturestudio <@@img src="d.png" alt="">\n').map(t => t.src), ['d.png'])
  })
})
