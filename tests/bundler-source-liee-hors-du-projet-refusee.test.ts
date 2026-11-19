// Un fichier source de sourceDir (`lien.mjs`) qui est un lien symbolique vers un fichier hors du projet suit la règle des
// assets et des dossiers liés : la construction s'arrête sur un message qui nomme le lien et sa cible, et rien de son texte
// n'est publié. Un lien dont la cible reste dans sourceDir est toujours accepté.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, symlinkSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function publiesQuiPortent(out: string, texte: string): string[] {
  return existsSync(out) ? readdirSync(out).filter(n => n.endsWith('.js') && readFileSync(join(out, n), 'utf-8').includes(texte)) : []
}

describe('fichier source lié hors du projet', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    it(`${env} : lien.mjs vers un fichier hors de sourceDir — construction arrêtée, rien de publié`, async () => {
      const root = mjsTmp('source-liee-dehors')
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      mkdirSync(join(root, 'dehors'), { recursive: true })
      writeFileSync(join(root, 'dehors', 'secret.mjs'), '<p>SECRET-HORS-PROJET</p>\n')
      symlinkSync(join(root, 'dehors', 'secret.mjs'), join(src, 'lien.mjs'))
      writeFileSync(join(src, 'page.mjs'), '<p>page</p>\n')
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env })
      const s = await b.compile()
      await b.close()
      const msg = s.errors.map(e => e.message).join('\n')
      assert.match(msg, /lien\.mjs/, 'le message nomme le lien : ' + msg)
      assert.match(msg, /secret\.mjs/, 'le message nomme la cible : ' + msg)
      assert.deepEqual(publiesQuiPortent(out, 'SECRET-HORS-PROJET'), [], 'le texte du fichier hors du projet ne doit pas être publié')
    })
  }

  // un module MJS au nom en `_` (`_outil.js.mjs`, `.civet.mjs`, `.coffee.mjs`) n'est pas un partiel : il est compilé et publié
  const modules: Record<string, string> = {
    '_outil.js.mjs':     'export const marque = \'SECRET-HORS-PROJET\'\n',
    '_outil.civet.mjs':  'export marque := \'SECRET-HORS-PROJET\'\n',
    '_outil.coffee.mjs': 'export marque = \'SECRET-HORS-PROJET\'\n',
  }
  for (const env of ['dev', 'prod'] as const) {
    for (const [nom, texte] of Object.entries(modules)) {
      it(`${env} : module ${nom} lié hors de sourceDir — construction arrêtée, rien de publié`, async () => {
        const root = mjsTmp('module-lie-dehors')
        const src  = join(root, 'src')
        const out  = join(root, 'out')
        mkdirSync(src, { recursive: true })
        mkdirSync(join(root, 'dehors'), { recursive: true })
        writeFileSync(join(root, 'dehors', nom.slice(1)), texte)
        symlinkSync(join(root, 'dehors', nom.slice(1)), join(src, nom))
        writeFileSync(join(src, 'page.mjs'), '<p>page</p>\n')
        const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env })
        const s = await b.compile()
        await b.close()
        const msg = s.errors.map(e => e.message).join('\n')
        assert.ok(msg.includes(nom) && msg.includes(join('dehors', nom.slice(1))), 'le message nomme le lien et sa cible : ' + msg)
        assert.deepEqual(publiesQuiPortent(out, 'SECRET-HORS-PROJET'), [], 'le texte du module hors du projet ne doit pas être publié')
      })
    }
  }

  it('un lien vers un fichier de sourceDir reste accepté', async () => {
    const root = mjsTmp('source-liee-dedans')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(join(src, 'sous'), { recursive: true })
    writeFileSync(join(src, 'sous', 'vrai.mjs'), '<p>VRAI-DEDANS</p>\n')
    symlinkSync(join(src, 'sous', 'vrai.mjs'), join(src, 'alias.mjs'))
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod' })
    const s = await b.compile()
    await b.close()
    assert.deepEqual(s.errors.map(e => e.message), [])
    assert.ok(publiesQuiPortent(out, 'VRAI-DEDANS').length > 0)
  })
})
