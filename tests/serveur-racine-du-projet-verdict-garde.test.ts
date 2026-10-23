// `mjs dev` qui sert la racine du projet (pages, feuilles, images hors du préfixe des fichiers compilés) refaisait, à CHAQUE demande
// d'un même fichier, toute la chaîne de ses contrôles : quatre résolutions de chemin réel (deux par la forme JavaScript, deux par la
// forme native) pour `/css/site.css`. Son verdict est maintenant gardé comme celui des fichiers compilés : repris seulement si le
// chemin demandé et la racine du projet mènent toujours au même endroit réel, au même fichier inchangé. Un lien posé après coup
// (sur le fichier, sur un dossier du chemin, vers un dossier privé du projet) est refusé comme avant ; un fichier réécrit est
// revérifié.

import { strict as assert } from 'node:assert'
import fs, { mkdirSync, writeFileSync, symlinkSync, renameSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { StaticServer } from '../src/server/index.js'
import { mjsTmp } from './helpers/tmp.js'

// résolutions de chemin réel pendant une demande : par la forme JavaScript (vérification complète) et par la forme native
const vrai = fs.realpathSync
let completes = 0
let natives   = 0
function espionner(): void {
  const espion: any = (p: fs.PathLike, o?: any) => { completes++; return vrai(p, o) }
  espion.native = (p: fs.PathLike, o?: any) => { natives++; return vrai.native(p, o) }
  ;(fs as any).realpathSync = espion
  syncBuiltinESMExports()
}
function relacher(): void {
  ;(fs as any).realpathSync = vrai
  syncBuiltinESMExports()
}

async function lire(port: number, chemin: string): Promise<{ status: number, body: string, completes: number, natives: number }> {
  completes = 0
  natives   = 0
  const res  = await fetch(`http://127.0.0.1:${port}${chemin}`)
  const body = await res.text()
  return { status: res.status, body, completes, natives }
}

describe('mjs dev, racine du projet — le verdict d\'un fichier servi est gardé, jamais pour un chemin devenu dangereux', function () {
  this.timeout(30000)

  let root: string, dehors: string, serveur: any, port: number

  beforeEach(async () => {
    // le projet et, à côté de lui, un dossier `dehors` hors de toute racine servie
    const base = mjsTmp('racine-verdict')
    root   = join(base, 'projet')
    dehors = join(base, 'dehors')
    const out = join(root, 'public', 'modularjs')
    mkdirSync(out, { recursive: true })
    mkdirSync(join(root, 'css'))
    mkdirSync(join(root, 'config'))
    mkdirSync(dehors)
    writeFileSync(join(root, 'css', 'site.css'), 'body{}')
    writeFileSync(join(root, 'config', 'secret.css'), 'SECRET DU PROJET')
    writeFileSync(join(dehors, 'secret.css'), 'CONTENU HORS DU PROJET')
    serveur = new StaticServer({ rootDir: out, projectRoot: root, port: 0, host: '127.0.0.1' })
    await serveur.start()
    port = serveur.server.address().port
    espionner()
  })

  afterEach(async () => {
    relacher()
    await serveur.stop()
  })

  it('un fichier demandé deux fois : la seconde demande ne refait pas la vérification complète', async () => {
    const a = await lire(port, '/css/site.css')
    assert.equal(a.status, 200)
    assert.equal(a.body, 'body{}')
    assert.ok(a.completes > 0, 'la première demande vérifie le chemin réel')
    const b = await lire(port, '/css/site.css')
    assert.equal(b.status, 200)
    assert.equal(b.body, 'body{}')
    assert.equal(b.completes, 0, 'verdict repris : aucune vérification complète')
    assert.ok(b.natives <= 2, 'au plus le chemin demandé et la racine du projet relus : ' + b.natives)
  })

  it('un lien posé sur le fichier après une première vérification, vers un fichier hors du projet : refusé', async () => {
    assert.equal((await lire(port, '/css/site.css')).status, 200)
    renameSync(join(root, 'css', 'site.css'), join(root, 'css', 'ancien.css'))
    symlinkSync(join(dehors, 'secret.css'), join(root, 'css', 'site.css'))
    const r = await lire(port, '/css/site.css')
    assert.equal(r.status, 404)
    assert.doesNotMatch(r.body, /HORS DU PROJET/)
  })

  it('un dossier du chemin remplacé par un lien vers un dossier privé du projet : refusé', async () => {
    writeFileSync(join(root, 'css', 'secret.css'), 'body{}')
    assert.equal((await lire(port, '/css/secret.css')).status, 200)
    renameSync(join(root, 'css'), join(root, 'css-ancien'))
    symlinkSync(join(root, 'config'), join(root, 'css'))
    const r = await lire(port, '/css/secret.css')
    assert.equal(r.status, 404)
    assert.doesNotMatch(r.body, /SECRET DU PROJET/)
  })

  it('un dossier du chemin déplacé hors du projet puis remplacé par un lien : le fichier déjà servi est refusé', async () => {
    assert.equal((await lire(port, '/css/site.css')).status, 200)
    renameSync(join(root, 'css'), join(dehors, 'css-deplace'))
    symlinkSync(join(dehors, 'css-deplace'), join(root, 'css'))
    assert.equal((await lire(port, '/css/site.css')).status, 404)
  })

  it('un fichier réécrit est revérifié, puis servi neuf', async () => {
    assert.equal((await lire(port, '/css/site.css')).body, 'body{}')
    writeFileSync(join(root, 'css', 'site.css'), 'body{color:red}')
    const r = await lire(port, '/css/site.css')
    assert.equal(r.status, 200)
    assert.equal(r.body, 'body{color:red}')
    assert.ok(r.completes > 0, 'autre taille, autres dates : vérifié de nouveau')
  })
})
