// Manifeste externe (`#= require`, `#= require_tree`) :
// - un chemin qui sortait du projet (`#= require ../../dehors/creds.js`) était lu et publié en clair dans
//   `mjs_external-<empreinte>.js`, sans un mot. Viser hors de sourceDir reste permis (vendor/, lib/ du projet),
//   hors du projet non : erreur de construction qui nomme la directive
// - `#= require_tree` sur un dossier qui contient un lien vers lui-même redescendait jusqu'à la limite du système
//   (plusieurs secondes puis ELOOP brut) : chaque dossier réel n'est plus parcouru qu'une fois

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

function publie(out: string): string {
  const ext = readdirSync(out).find(f => f.startsWith('mjs_external-') && f.endsWith('.js'))
  return ext ? readFileSync(join(out, ext), 'utf-8') : ''
}

describe('manifeste externe : rien hors du projet, lien qui boucle', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const directive of ['require ../../dehors/creds.js', 'require_tree ../../dehors']) {
    it(`#= ${directive} : erreur qui nomme la directive, rien de publié`, async () => {
      const root = mjsTmp('manifeste-hors-projet')
      const src  = join(root, 'proj', 'src')
      const out  = join(root, 'proj', 'out')
      mkdirSync(src, { recursive: true })
      mkdirSync(join(root, 'dehors'), { recursive: true })
      writeFileSync(join(root, 'dehors', 'creds.js'), 'globalThis.CLE = "sk_live_HORS_PROJET";\n')
      writeFileSync(join(src, 'a.mjs'), '<p>a</p>\n')
      writeFileSync(join(src, 'manifest.js'), `#= ${directive}\nconsole.log(1)\n`)
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), manifestExternal: join(src, 'manifest.js') } as any)
      const s = await b.compile()
      await b.close()
      const messages = s.errors.map((e: any) => e.message)
      assert.ok(messages.some(m => m.includes(directive.split(' ')[1]) && m.includes('manifest.js')), JSON.stringify(messages))
      assert.ok(!publie(out).includes('sk_live_HORS_PROJET'), 'le fichier hors du projet ne doit pas être publié')
    })
  }

  it('#= require d\'un fichier du projet hors de sourceDir : toujours permis', async () => {
    const root = mjsTmp('manifeste-vendor')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    mkdirSync(join(root, 'vendor', 'lib'), { recursive: true })
    writeFileSync(join(root, 'vendor', 'lib', 'outil.js'), 'globalThis.OUTIL = "VENDOR_DU_PROJET";\n')
    writeFileSync(join(src, 'a.mjs'), '<p>a</p>\n')
    writeFileSync(join(src, 'manifest.js'), '#= require ../vendor/lib/outil.js\n#= require_tree ../vendor\n')
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), manifestExternal: join(src, 'manifest.js') } as any)
    const s = await b.compile()
    await b.close()
    assert.equal(s.errors.length, 0, s.errors.map((e: any) => e.message).join('\n'))
    assert.ok(publie(out).includes('VENDOR_DU_PROJET'))
  })

  it('#= require_tree sur un dossier qui contient un lien vers lui-même : rapide, fichier inclus une fois', async () => {
    const root = mjsTmp('manifeste-boucle')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(join(src, 'lib'), { recursive: true })
    writeFileSync(join(src, 'lib', 'x.js'), 'globalThis.X = "MARQUE_X";\n')
    symlinkSync('.', join(src, 'lib', 'boucle'))
    writeFileSync(join(src, 'a.mjs'), '<p>a</p>\n')
    writeFileSync(join(src, 'manifest.js'), '#= require_tree ./lib\n')
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), manifestExternal: join(src, 'manifest.js') } as any)
    const debut = Date.now()
    const s     = await b.compile()
    const duree = Date.now() - debut
    await b.close()
    assert.equal(s.errors.length, 0, s.errors.map((e: any) => e.message).join('\n'))
    assert.ok(duree < 5000, `construction trop lente : ${duree} ms`)
    assert.equal(publie(out).split('MARQUE_X').length - 1, 1, 'x.js inclus une seule fois')
  })
})
