// Chargeur des fichiers serveur `.server.mjs` :
// - avec un umask 002 (défaut Debian, Ubuntu), le dossier de cache hors projet laissé par la version
//   précédente est en 775 : il était refusé, et `mjs ws`, `mjs serveur` ne démarraient plus. Ce qui
//   compte : un vrai dossier, à l'utilisateur, que les AUTRES ne peuvent pas écrire ; ses droits
//   sont alors refermés en 0700 ;
// - du Civet ordinaire était encore pris pour une directive dès qu'une propriété nommée comme elle
//   ouvrait la ligne avant un mot-opérateur : `@lang or "fr"`, `@display if @display?`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, chmodSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { compileServerFile, serverCacheDir } from '../src/cli/server-entry.js'

describe('server-entry — cache ouvert au groupe accepté et refermé, Civet à mots-opérateurs compilé', () => {
  it('dossier de cache à soi en 0775 : accepté, refermé en 0700 ; ouvert en écriture aux autres : refusé', function () {
    if (typeof process.getuid !== 'function') this.skip()
    const avant = process.env.TMPDIR
    const tmp = mjsTmp('server-entry-cache-groupe')
    const projet = mjsTmp('server-entry-cache-groupe-projet')
    process.env.TMPDIR = tmp
    try {
      const dir = join(tmp, `mjs-server-cache-${process.getuid!()}`)
      mkdirSync(dir)
      chmodSync(dir, 0o775)
      assert.equal(serverCacheDir(projet), dir)
      assert.equal(statSync(dir).mode & 0o777, 0o700)
      chmodSync(dir, 0o757)
      assert.throws(() => serverCacheDir(projet), /cache/i)
    } finally {
      // `process.env.X = undefined` écrit la chaîne 'undefined' : tmpdir() rendrait alors un chemin relatif
      if (avant === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = avant
    }
  })

  it('`@lang or "fr"` et `@display if @display?` : compilés, valeurs rendues', async function () {
    this.timeout(30000)
    const d = mjsTmp('server-entry-civet-operateurs')
    mkdirSync(join(d, 'node_modules'))
    writeFileSync(join(d, 'ou.server.mjs'), 'class Prefs\n  constructor()\n    @lang = null\n  langue()\n    @lang or "fr"\n\nexport default\n  setup: -> new Prefs().langue()\n')
    writeFileSync(join(d, 'si.server.mjs'), 'class Vue\n  constructor()\n    @display = 1\n  montrer()\n    @display if @display?\n\nexport default\n  setup: -> new Vue().montrer()\n')
    const ou = await import(await compileServerFile(join(d, 'ou.server.mjs'), d))
    assert.equal(ou.default.setup(), 'fr')
    const si = await import(await compileServerFile(join(d, 'si.server.mjs'), d))
    assert.equal(si.default.setup(), 1)
  })

  it('les vraies directives restent refusées : `@css "x.css"`, `@css boutons`, `@lang "fr"`', async function () {
    this.timeout(30000)
    const d = mjsTmp('server-entry-directives-vraies')
    mkdirSync(join(d, 'node_modules'))
    for (const [nom, ligne, motif] of [['a', '@css "x.css"', /@css/], ['b', '@css boutons', /@css/], ['c', '@lang "fr"', /@lang/]] as const) {
      writeFileSync(join(d, `${nom}.server.mjs`), `${ligne}\nexport default {}\n`)
      await assert.rejects(compileServerFile(join(d, `${nom}.server.mjs`), d), motif, ligne)
    }
  })
})
