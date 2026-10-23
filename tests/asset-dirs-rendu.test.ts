// assetDirs et le rendu côté serveur : le rendu serveur (happy-dom) et le prérendu du build compilent avec les options du
// projet (`resolveBundlerOpts`) — une image d'un dossier de la liste y est résolue comme au build : la page écrite porte
// l'adresse hachée de l'image, et le fichier est copié dans la sortie.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBundlerOpts } from '../src/bundler/config.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { prerenderPages } from '../src/server/prerender.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const ACCUEIL = '<script>\nphoto = µimage(\'hero.png\')\n</script>\n<h1>Accueil</h1>\n<img class="p" src={photo.src} width={photo.width} height={photo.height}>\n<@@img src="bandeau.png" alt="bandeau"></@@img>'

// un projet : sources, dossier d'images en dehors de sourceDir, config à la façon de mjs.config.json
function projet(prefix: string) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const imgDir = join(root, 'images')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(imgDir, { recursive: true })
  writeFileSync(join(imgDir, 'hero.png'), validPng(1600, 900))
  writeFileSync(join(imgDir, 'bandeau.png'), validPng(800, 200))
  writeFileSync(join(srcDir, 'accueil.mjs'), ACCUEIL)
  return { root, srcDir, imgDir }
}

describe('assetDirs — rendu côté serveur', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('le rendu serveur (createSSRRenderer avec les options du projet) résout les images de la liste', async () => {
    const p      = projet('assetdirs-rendu-serveur')
    const config = { sourceDir: 'src', outputDir: 'public/out', assetDirs: ['images'] }
    const outDir = join(p.root, 'public/out')
    const renderer = await createSSRRenderer({ sourceDir: p.srcDir, outputDir: outDir, bundlerOpts: resolveBundlerOpts(config, p.root) } as any)
    let html = ''
    try {
      html = (await renderer.renderToString('mjs-accueil', { ssrMode: 'markers' } as any)).html
    } finally {
      await renderer.close()
    }
    assert.match(html, /hero-[a-f0-9]{8}\.png/, `l'image de µimage est dans la page :\n${html.slice(0, 800)}`)
    assert.match(html, /bandeau-[a-f0-9]{8}\.png/, `l'image de <@@img> est dans la page :\n${html.slice(0, 800)}`)
    assert.match(html, /width="1600"/, `les dimensions natives sont écrites :\n${html.slice(0, 800)}`)
    assert.ok(readdirSync(outDir).some(f => /^hero-[a-f0-9]{8}\.png$/.test(f)), `l'image est copiée dans la sortie : ${readdirSync(outDir).join(', ')}`)
  })

  it('le prérendu du build résout les images de la liste', async () => {
    const p      = projet('assetdirs-rendu-prerendu')
    const config = {
      sourceDir: 'src',
      outputDir: 'public/out',
      assetDirs: ['images'],
      render:    { default: 'prerender' as const, routes: { '/': { component: 'mjs-accueil' } } },
    }
    const rapport = await prerenderPages(config, p.root)
    const accueil = rapport.generated.find(g => g.url === '/')
    assert.ok(accueil, `la page d'accueil est prérendue (ignorées : ${JSON.stringify(rapport.skipped)})`)
    assert.ok(existsSync(accueil!.file), 'le fichier de la page existe')
    const page = readFileSync(accueil!.file, 'utf-8')
    assert.match(page, /hero-[a-f0-9]{8}\.png/, `l'image de µimage est dans la page prérendue :\n${page.slice(0, 800)}`)
    assert.match(page, /bandeau-[a-f0-9]{8}\.png/, `l'image de <@@img> est dans la page prérendue :\n${page.slice(0, 800)}`)
    assert.ok(readdirSync(join(p.root, 'public/out')).some(f => /^hero-[a-f0-9]{8}\.png$/.test(f)), 'l\'image est copiée dans la sortie du projet')
  })
})
