// Chargeur des fichiers serveur `.server.mjs` :
// - un module importé par deux fichiers (en diamant) était chargé en DEUX exemplaires (une URL
//   neuve à chaque import) : un magasin, un cache, un pool partagé ne l'était plus, sans erreur ;
// - du Civet ordinaire était refusé : `@n = 0` (this.n) dans une classe pris pour une directive,
//   un `<style>` dans une chaîne de gabarit de courriel pris pour du markup de composant ;
// - sans `node_modules`, le cache vivait dans un dossier au nom prévisible du dossier temporaire
//   commun, réutilisé tel quel : un autre utilisateur qui le crée d'avance y dépose le code que
//   le serveur exécute. Le dossier est désormais créé en 0700, son propriétaire et ses droits
//   vérifiés, refusé sinon.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, chmodSync, statSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { compileServerFile, serverCacheDir } from '../src/cli/server-entry.js'

describe('server-entry — un module par fichier, Civet ordinaire accepté, cache sûr', () => {
  it('module importé par deux fichiers : un seul exemplaire, état partagé', async function () {
    this.timeout(30000)
    const d = mjsTmp('server-entry-diamant')
    mkdirSync(join(d, 'node_modules'))
    writeFileSync(join(d, 'c.mjs'), 'export compteur := { n: 0 }\n')
    writeFileSync(join(d, 'a.mjs'), "@import compteur './c.mjs'\nexport incremente := -> compteur.n++\n")
    writeFileSync(join(d, 'b.mjs'), "@import compteur './c.mjs'\nexport lire := -> compteur.n\n")
    writeFileSync(join(d, 'entree.server.mjs'), "@import incremente './a.mjs'\n@import lire './b.mjs'\nexport default\n  resultat: ->\n    incremente()\n    lire()\n")
    const mod = await import(await compileServerFile(join(d, 'entree.server.mjs'), d))
    assert.equal(mod.default.resultat(), 1)
  })

  it('classe avec `@n = 0` et gabarit contenant `<style>` : compilés', async function () {
    this.timeout(30000)
    const d = mjsTmp('server-entry-civet')
    mkdirSync(join(d, 'node_modules'))
    writeFileSync(join(d, 'classe.server.mjs'), 'class Compteur\n  constructor()\n    @n = 0\n  plus()\n    @n++\n\nexport default\n  setup: -> new Compteur().plus()\n')
    writeFileSync(join(d, 'courriel.server.mjs'), 'courriel = """\n<style>p { color: red }</style>\n<p>Bonjour</p>\n"""\n\nexport default\n  texte: -> courriel\n')
    const classe = await import(await compileServerFile(join(d, 'classe.server.mjs'), d))
    assert.equal(classe.default.setup(), 0)
    const courriel = await import(await compileServerFile(join(d, 'courriel.server.mjs'), d))
    assert.match(courriel.default.texte(), /<style>/)
  })

  it('une vraie directive reste refusée', async function () {
    const d = mjsTmp('server-entry-directive')
    mkdirSync(join(d, 'node_modules'))
    writeFileSync(join(d, 'x.server.mjs'), "@css './x.css'\nexport default {}\n")
    await assert.rejects(compileServerFile(join(d, 'x.server.mjs'), d), /@css/)
  })

  it('cache hors projet : dossier 0700 ; dossier pré-créé ouvert à tous ou lien : refusé', function () {
    if (typeof process.getuid !== 'function') this.skip()
    const avant = process.env.TMPDIR
    const tmp = mjsTmp('server-entry-cache')
    const projet = mjsTmp('server-entry-cache-projet')
    process.env.TMPDIR = tmp
    try {
      const dir = serverCacheDir(projet)
      assert.equal(statSync(dir).mode & 0o777, 0o700)
      chmodSync(dir, 0o777)
      assert.throws(() => serverCacheDir(projet), /cache/i)
      const tmp2 = mjsTmp('server-entry-cache-lien')
      process.env.TMPDIR = tmp2
      const cible = join(tmp2, 'ailleurs')
      mkdirSync(cible, { mode: 0o700 })
      symlinkSync(cible, join(tmp2, `mjs-server-cache-${process.getuid!()}`))
      assert.throws(() => serverCacheDir(projet), /cache/i)
    } finally {
      // `process.env.X = undefined` écrit la chaîne 'undefined' : tmpdir() rendrait alors un chemin relatif
      if (avant === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = avant
    }
  })
})
