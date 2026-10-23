// `mjs dev` (Bundler.watch) et assetDirs : une image ajoutée, modifiée ou retirée dans un dossier de la liste est vue comme une
// image de sourceDir — le dossier est surveillé, le composant qui l'utilise est recompilé avec la bonne image ; l'ordre de
// recherche vaut aussi en direct (une image ajoutée dans un dossier prioritaire prend la place de celle d'un dossier suivant).

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const PAGE = '<script>\nphoto = µimage(\'hero.png\')\n</script>\n\n<img src={photo.src} width={photo.width} height={photo.height}>'

function projet(prefix: string) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const imgA   = join(root, 'images-a')
  const imgB   = join(root, 'images-b')
  for (const dossier of [srcDir, imgA, imgB]) mkdirSync(dossier, { recursive: true })
  writeFileSync(join(srcDir, 'page.mjs'), PAGE)
  return { root, srcDir, imgA, imgB, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

type Projet = ReturnType<typeof projet>

// la largeur native que porte le composant publié, ou null (pas encore publié, ou en erreur)
function largeurPubliee(p: Projet): number | null {
  try {
    const fichier = readdirSync(p.outDir).find(f => /^page-[0-9a-z]+\.js$/.test(f))
    if (!fichier) return null
    const m = /"width":\s*(\d+)/.exec(readFileSync(join(p.outDir, fichier), 'utf-8'))
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

// attend, au plus `ms`, que la condition soit vraie ; dit ce qui manquait sinon
async function attendre(condition: () => boolean, ms: number, ce: string): Promise<void> {
  const debut = Date.now()
  while (!condition()) {
    if (Date.now() - debut > ms) throw new Error(`jamais vu : ${ce} (après ${ms} ms)`)
    await new Promise(r => setTimeout(r, 40))
  }
}

describe('assetDirs — mjs dev surveille les dossiers de la liste', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('une image modifiée dans un dossier de la liste recompile le composant avec la nouvelle image', async () => {
    const p = projet('assetdirs-dev-modifiee')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [p.imgA] } as any)
    const evenements: string[] = []
    await bundler.watch({ onRecompile: (chemin) => evenements.push(chemin) })
    assert.equal(largeurPubliee(p), 1600, 'build initial')

    writeFileSync(join(p.imgA, 'hero.png'), validPng(800, 400))
    await attendre(() => largeurPubliee(p) === 800, 8000, 'le composant recompilé avec la nouvelle image')
    assert.ok(evenements.some(e => e.endsWith('hero.png')), `l'événement vient de l'image : ${evenements.join(', ')}`)
    await bundler.close()
  })

  it('une image ajoutée dans un dossier de la liste répare le composant qui la citait en vain', async () => {
    const p = projet('assetdirs-dev-ajoutee')
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [p.imgA] } as any)
    let derniere: { errors: Error[] } | undefined
    await bundler.watch({ onRecompile: (_chemin, stats) => { derniere = stats } })
    assert.ok(derniere && derniere.errors.length > 0, 'build initial : l\'image manque, le build échoue')

    writeFileSync(join(p.imgA, 'hero.png'), validPng(1200, 600))
    await attendre(() => largeurPubliee(p) === 1200, 8000, 'le composant compilé une fois l\'image ajoutée')
    await attendre(() => derniere !== undefined && derniere.errors.length === 0, 8000, 'un build sans erreur')
    await bundler.close()
  })

  it('une image ajoutée dans un dossier prioritaire prend la place de celle d\'un dossier suivant', async () => {
    const p = projet('assetdirs-dev-priorite')
    writeFileSync(join(p.imgB, 'hero.png'), validPng(800, 450))
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [p.imgA, p.imgB], lint: { image: false } } as any)
    await bundler.watch({})
    assert.equal(largeurPubliee(p), 800, 'build initial : le seul hero.png est dans le second dossier')

    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    await attendre(() => largeurPubliee(p) === 1600, 8000, 'le hero.png du premier dossier de la liste')
    await bundler.close()
  })

  it('une image retirée de sourceDir laisse la place à l\'homonyme d\'un dossier de la liste', async () => {
    const p = projet('assetdirs-dev-retiree')
    writeFileSync(join(p.srcDir, 'hero.png'), validPng(400, 225))
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [p.imgA], lint: { image: false } } as any)
    await bundler.watch({})
    assert.equal(largeurPubliee(p), 400, 'build initial : sourceDir gagne')

    rmSync(join(p.srcDir, 'hero.png'))
    await attendre(() => largeurPubliee(p) === 1600, 8000, 'le hero.png du dossier de la liste, une fois celui de sourceDir retiré')
    await bundler.close()
  })

  // un dossier que le projet NOMME dans la liste est surveillé quel que soit l'endroit où il vit : les motifs d'exclusion (segment
  // qui commence par un point, node_modules, .git) se testent sur le chemin RELATIF au dossier, pas sur son chemin complet
  for (const [cas, segments] of [['sous node_modules/', ['node_modules', 'paquet', 'img']], ['sous un dossier caché (.assets/)', ['.assets', 'img']]] as Array<[string, string[]]>) {
    it(`un dossier de la liste situé ${cas} est surveillé : une image modifiée recompile le composant`, async () => {
      const p = projet('assetdirs-dev-chemin-' + segments[0].replace(/\W/g, ''))
      const dossier = join(p.root, ...segments)
      mkdirSync(dossier, { recursive: true })
      writeFileSync(join(dossier, 'hero.png'), validPng(1600, 900))
      const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [dossier], lint: { image: false } } as any)
      await bundler.watch({})
      assert.equal(largeurPubliee(p), 1600, 'build initial')

      writeFileSync(join(dossier, 'hero.png'), validPng(800, 400))
      try { await attendre(() => largeurPubliee(p) === 800, 8000, 'le composant recompilé avec la nouvelle image') }
      finally { await bundler.close() }
    })
  }

  it('ce qui est caché reste ignoré, dans sourceDir comme DANS un dossier de la liste (segment caché, node_modules, .git)', async () => {
    const p = projet('assetdirs-dev-caches-ignores')
    writeFileSync(join(p.imgA, 'hero.png'), validPng(1600, 900))
    const dehors = [join(p.srcDir, '.cache'), join(p.imgA, '.cache'), join(p.imgA, 'node_modules', 'paquet'), join(p.imgA, '.git')]
    for (const d of dehors) mkdirSync(d, { recursive: true })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, assetDirs: [p.imgA], lint: { image: false } } as any)
    const evenements: string[] = []
    await bundler.watch({ onRecompile: (chemin) => evenements.push(chemin) })
    assert.equal(largeurPubliee(p), 1600, 'build initial')
    const initial = evenements.length

    for (const d of dehors) writeFileSync(join(d, 'note.txt'), 'x')
    await new Promise(r => setTimeout(r, 1500))
    assert.equal(evenements.length, initial, `aucune recompilation pour ce qui est caché : ${evenements.slice(initial).join(', ')}`)

    writeFileSync(join(p.imgA, 'hero.png'), validPng(800, 400))
    try { await attendre(() => largeurPubliee(p) === 800, 8000, 'le watcher est vivant : une image visible recompile') }
    finally { await bundler.close() }
  })
})
