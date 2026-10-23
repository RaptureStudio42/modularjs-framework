// µasset dans une feuille de style — pourquoi ce test existe.
//
// `url(µasset('fonts/x.woff2'))` écrit dans un `<style>` de composant (sass, scss ou css), dans sa déclinaison nommée
// (`<style name="bandeau">`) ou dans une feuille partagée de stylesheetsDir restait tel quel dans le CSS livré : le fichier
// était bien copié, l'adresse n'y était jamais écrite, et rien ne le disait. L'appel est maintenant remplacé comme dans le
// script et le HTML : sourceDir d'abord, puis les dossiers de assetDirs, adresse à empreinte, fichier copié ; un fichier
// introuvable arrête la construction en nommant les dossiers fouillés.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const POLICE = Buffer.from('wOF2fakefont')

// un projet jetable : sourceDir (src), un dossier d'images (images), des feuilles partagées (styles), la sortie et le manifeste
function projet(prefix: string, police: 'src' | 'images') {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const images = join(root, 'images')
  const styles = join(root, 'styles')
  for (const dossier of [srcDir, images, styles]) mkdirSync(dossier, { recursive: true })
  mkdirSync(join(police === 'src' ? srcDir : images, 'fonts'), { recursive: true })
  writeFileSync(join(police === 'src' ? srcDir : images, 'fonts', 'x.woff2'), POLICE)
  return { root, srcDir, images, styles, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

type Projet = ReturnType<typeof projet>

async function construire(p: Projet, options: Record<string, unknown> = {}) {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, stylesheetsDir: p.styles, urlPrefix: '/mjs', sourceMap: 'never', a11y: false, lint: { image: false, cssTrap: false }, ...options } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  return stats
}

const erreurs = (stats: { errors: Error[] }) => stats.errors.map(e => e.message).join('\n')

// tout le texte émis (JavaScript, feuilles de layout…) : les noms à empreinte ne sont pas à connaître
function emis(p: Projet): string {
  return readdirSync(p.outDir).filter(f => /\.(js|css)$/.test(f)).map(f => readFileSync(join(p.outDir, f), 'utf-8')).join('\n')
}

const policeCopiee = (p: Projet) => readdirSync(p.outDir).filter(f => /^x-[a-f0-9]{8}\.woff2$/.test(f))

// l'adresse écrite dans le CSS : /mjs/x-<empreinte>.woff2, et rien ne reste de l'appel
function verifier(p: Projet, texte: string): void {
  assert.ok(!/µasset|µ\.asset/.test(texte), `l'appel doit avoir disparu :\n${texte.slice(0, 600)}`)
  const copies = policeCopiee(p)
  assert.equal(copies.length, 1, `la police est copiée, une fois : ${readdirSync(p.outDir).join(', ')}`)
  assert.ok(texte.includes(`/mjs/${copies[0]}`), `l'adresse /mjs/${copies[0]} est écrite dans le CSS :\n${texte.slice(0, 600)}`)
}

const COMPOSANT: Record<string, string> = {
  sass: '<p>x</p>\n<style lang="sass">\n@font-face\n  font-family: Y\n  src: url(µasset(\'fonts/x.woff2\'))\n</style>\n',
  scss: '<p>x</p>\n<style lang="scss">\n@font-face { font-family: Y; src: url(µasset(\'fonts/x.woff2\')); }\n</style>\n',
  css:  '<p>x</p>\n<style lang="css">\n@font-face { font-family: Y; src: url(µasset(\'fonts/x.woff2\')); }\n</style>\n',
}

describe('µasset dans une feuille de style', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const police of ['src', 'images'] as const) {
    const ou = police === 'src' ? 'dans sourceDir' : 'dans un dossier de assetDirs'

    for (const lang of ['sass', 'scss', 'css']) {
      it(`<style lang="${lang}"> d'un composant, police ${ou} : l'adresse à empreinte est écrite, la police est copiée`, async () => {
        const p = projet(`assetdirs-style-${lang}-${police}`, police)
        writeFileSync(join(p.srcDir, 'comp.mjs'), COMPOSANT[lang])
        const stats = await construire(p, police === 'images' ? { assetDirs: [p.images] } : {})
        assert.equal(stats.errors.length, 0, erreurs(stats))
        verifier(p, emis(p))
      })
    }

    it(`<style name="bandeau" lang="sass"> d'un composant (déclinaison), image ${ou} : même remplacement`, async () => {
      const p = projet(`assetdirs-style-nommee-${police}`, police)
      writeFileSync(join(p.srcDir, 'comp.mjs'), '<p>x</p>\n<style>\np\n  color: red\n</style>\n<style name="bandeau" lang="sass">\n@font-face\n  font-family: Y\n  src: url(µasset(\'fonts/x.woff2\'))\n</style>\n')
      const stats = await construire(p, police === 'images' ? { assetDirs: [p.images] } : {})
      assert.equal(stats.errors.length, 0, erreurs(stats))
      verifier(p, emis(p))
    })

    for (const mode of ['bundle', 'split', 'lazy']) {
      it(`feuilles partagées (stylesheetsDir, css: '${mode}'), police ${ou} : mjs_root.sass et une feuille nommée sont remplacées`, async () => {
        const p = projet(`assetdirs-partagee-${mode}-${police}`, police)
        writeFileSync(join(p.srcDir, 'comp.mjs'), '<style @css="base">\n</style>\n<p>x</p>\n')
        writeFileSync(join(p.styles, 'mjs_root.sass'), "@font-face\n  font-family: Y\n  src: url(µasset('fonts/x.woff2'))\n")
        writeFileSync(join(p.styles, 'base.scss'), "@font-face { font-family: Z; src: url(µasset(\"fonts/x.woff2\")); }\n")
        const stats = await construire(p, { css: mode, ...(police === 'images' ? { assetDirs: [p.images] } : {}) })
        assert.equal(stats.errors.length, 0, erreurs(stats))
        const texte = emis(p)
        verifier(p, texte)
        assert.equal(texte.split(`/mjs/${policeCopiee(p)[0]}`).length - 1, 2, 'les deux feuilles portent l\'adresse')
      })
    }
  }

  it('image introuvable dans un <style> de composant : la construction s\'arrête, les dossiers fouillés sont nommés', async () => {
    const p = projet('assetdirs-style-manquante', 'src')
    writeFileSync(join(p.srcDir, 'comp.mjs'), '<p>x</p>\n<style lang="sass">\n@font-face\n  font-family: Y\n  src: url(µasset(\'fonts/absente.woff2\'))\n</style>\n')
    const stats = await construire(p, { assetDirs: [p.images] })
    assert.ok(stats.errors.length > 0, 'une erreur de construction')
    assert.match(erreurs(stats), /fonts\/absente\.woff2/)
    assert.match(erreurs(stats), new RegExp(p.images.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })

  for (const mode of ['bundle', 'split', 'lazy']) {
    it(`image introuvable dans une feuille partagée (css: '${mode}') : la construction s'arrête, la feuille et les dossiers fouillés sont nommés`, async () => {
      const p = projet(`assetdirs-partagee-manquante-${mode}`, 'src')
      writeFileSync(join(p.srcDir, 'comp.mjs'), '<p>x</p>\n')
      writeFileSync(join(p.styles, 'mjs_root.sass'), "@font-face\n  font-family: Y\n  src: url(µasset('fonts/absente.woff2'))\n")
      const stats = await construire(p, { css: mode, assetDirs: [p.images] })
      assert.ok(stats.errors.length > 0, 'une erreur de construction')
      assert.match(erreurs(stats), /fonts\/absente\.woff2/)
      assert.match(erreurs(stats), /mjs_root\.sass/)
      assert.match(erreurs(stats), new RegExp(p.images.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    })
  }
})
