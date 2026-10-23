// Feuilles partagées en `css: 'split'` et `'lazy'` :
// - une feuille nommée `root` à côté de `mjs_root` prenait le même nom de fichier que la feuille racine : le composant
//   qui la déclarait (`@css="root"`) importait la feuille racine à sa place, et personne n'importait celle qui pose
//   `µ.CSS['root']` — construction verte, styles absents
// - les variables déclarées par les feuilles partagées (`mjs_root.scss`, feuilles nommées) n'existaient pas pour le
//   registre des variables : chaque lecture `$$nom` sortait un faux « personne ne le déclare » (muet en `css: 'bundle'`)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('css split / lazy : feuille « root », variables des feuilles partagées', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('css: split, root.scss à côté de mjs_root.scss : @css="root" importe la feuille qui pose µ.CSS["root"]', async () => {
    const root   = mjsTmp('css-split-feuille-root')
    const src    = join(root, 'src')
    const styles = join(src, 'styles')
    const out    = join(root, 'out')
    mkdirSync(styles, { recursive: true })
    writeFileSync(join(styles, 'mjs_root.scss'), ':root { --fond: #fff; }\n')
    writeFileSync(join(styles, 'root.scss'), '.r { color: red; }\n')
    writeFileSync(join(src, 'carte.mjs'), '<style @css="root"></style>\n<p class="r">carte</p>\n')
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), stylesheetsDir: styles, css: 'split' } as any)
    const s = await b.compile()
    await b.close()
    assert.equal(s.errors.length, 0, s.errors.map((e: any) => e.message).join('\n'))
    const fichiers = readdirSync(out)
    const carte    = fichiers.find(f => /^carte-.*\.js$/.test(f))!
    const imports  = [...readFileSync(join(out, carte), 'utf-8').matchAll(/import\s*['"]([^'"]+)['"]/g)].map(m => m[1].split('/').pop()!)
    const posent   = imports.filter(f => f.startsWith('mjs_style_') && readFileSync(join(out, f), 'utf-8').includes('"root"'))
    assert.equal(posent.length, 1, `carte.js importe : ${JSON.stringify(imports)}`)
    // la feuille racine garde son fichier, toujours importé par le manifeste
    const racine = fichiers.filter(f => f.startsWith('mjs_style_') && readFileSync(join(out, f), 'utf-8').includes('adoptedStyleSheets'))
    assert.equal(racine.length, 1)
    assert.ok(readFileSync(join(out, 'bundle.js'), 'utf-8').includes(racine[0]))
  })

  // les feuilles compilées sont reprises d'un tour à l'autre tant que leur texte ne bouge pas : une feuille modifiée doit
  // pourtant repartir compilée au tour suivant, dans chaque mode
  for (const css of ['bundle', 'split', 'lazy'] as const) {
    it(`css: ${css} — feuille modifiée entre deux compile() : le nouveau CSS est publié`, async () => {
      const root   = mjsTmp('css-feuille-modifiee')
      const src    = join(root, 'src')
      const styles = join(src, 'styles')
      const out    = join(root, 'out')
      mkdirSync(styles, { recursive: true })
      writeFileSync(join(styles, 'base.scss'), '.cadre { color: #a1a1a1; }\n')
      writeFileSync(join(src, 'a.mjs'), '<style @css="base"></style>\n<p class="cadre">x</p>\n')
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), stylesheetsDir: styles, css } as any)
      const publie = () => readdirSync(out).filter(f => /^mjs_style/.test(f) || /^mjs_styles-/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
      assert.equal((await b.compile()).errors.length, 0)
      assert.ok(publie().includes('#a1a1a1'))
      writeFileSync(join(styles, 'base.scss'), '.cadre { color: #b2b2b2; }\n')
      assert.equal((await b.compile()).errors.length, 0)
      await b.close()
      assert.ok(publie().includes('#b2b2b2'), 'nouvelle couleur publiée')
    })
  }

  for (const css of ['split', 'lazy'] as const) {
    it(`css: ${css} — variables de mjs_root.scss et d'une feuille nommée : aucun faux « personne ne le déclare »`, async () => {
      const root   = mjsTmp('css-variables-partagees')
      const src    = join(root, 'src')
      const styles = join(src, 'styles')
      const out    = join(root, 'out')
      mkdirSync(styles, { recursive: true })
      writeFileSync(join(styles, 'mjs_root.scss'), ':root { --mjs-fondsite: #fff; }\n')
      writeFileSync(join(styles, 'base.scss'), '.cadre { --mjs-autre: 2px; }\n')
      writeFileSync(join(src, 'a.mjs'), '<style @css="base">\n  p\n    color: $$fondsite\n    margin: $$autre\n</style>\n<p>x</p>\n')
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), stylesheetsDir: styles, css } as any)
      const s = await b.compile()
      await b.close()
      assert.equal(s.errors.length, 0, s.errors.map((e: any) => e.message).join('\n'))
      assert.deepEqual(s.warnings.filter((w: string) => w.includes('themeUnknown')), [])
    })
  }
})
