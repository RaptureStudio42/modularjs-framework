// Le verdict gardé d'un fichier servi n'était repris que sur l'identité du fichier (appareil, inode, taille, dates) : un dossier du
// chemin déplacé HORS du dossier servi, puis remplacé par un lien vers sa nouvelle place, laissait servir le fichier déjà demandé
// (même inode, mêmes dates), alors que son chemin réel avait quitté le dossier servi ; un voisin jamais demandé répondait 404.
// Même chose quand le dossier servi est lui-même un lien (déploiement `current -> releases/…`) basculé vers une version dont un
// dossier renvoie à l'ancienne. Le verdict n'est désormais repris que si le chemin demandé et le dossier servi mènent toujours au
// même endroit réel ; ce contrôle ne refait pas la vérification complète (aucune résolution de chemin par la forme JavaScript).

import { strict as assert } from 'node:assert'
import fs, { mkdirSync, writeFileSync, symlinkSync, renameSync, rmSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { startRenderServer, isServableFile } from '../src/server/render-server.js'
import { StaticServer } from '../src/server/index.js'
import { mjsTmp } from './helpers/tmp.js'

// résolutions de chemin réel : par la forme JavaScript (vérification complète) et par la forme native
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

async function lire(port: number, chemin: string): Promise<{ status: number, body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${chemin}`)
  return { status: res.status, body: await res.text() }
}

interface Lance { port: number, prefixe: string, fermer(): Promise<void> }

const serveurs: { nom: string, lancer(root: string, out: string): Promise<Lance> }[] = [
  {
    nom: 'mjs serve',
    async lancer(root) {
      const config: any = { sourceDir: 'src', outputDir: 'out', urlPrefix: '/assets', render: { routes: { '/': { component: 'mjs-home', mode: 'csr' } } } }
      const r = await startRenderServer(config, root, { port: 0 })
      return { port: r.port, prefixe: '/assets', fermer: () => r.close() }
    },
  },
  {
    nom: 'mjs dev',
    async lancer(_root, out) {
      const s: any = new StaticServer({ rootDir: out, port: 0, host: '127.0.0.1' })
      await s.start()
      return { port: s.server.address().port, prefixe: '/modularjs', fermer: () => s.stop() }
    },
  },
]

for (const serveur of serveurs) {
  describe(`${serveur.nom} — un dossier du chemin déplacé hors du dossier servi, puis remplacé par un lien`, function () {
    this.timeout(30000)

    it('le fichier déjà servi, désormais hors du dossier servi, est refusé comme son voisin', async () => {
      const root = mjsTmp('verdict-dossier-deplace')
      const out  = join(root, 'out')
      mkdirSync(join(root, 'src'))
      mkdirSync(join(out, 'lib'), { recursive: true })
      mkdirSync(join(root, 'dehors'))
      writeFileSync(join(out, 'lib', 'x.js'), 'console.log("x")')
      const lance = await serveur.lancer(root, out)
      try {
        assert.equal((await lire(lance.port, lance.prefixe + '/lib/x.js')).status, 200)
        renameSync(join(out, 'lib'), join(root, 'dehors', 'lib-deplace'))
        symlinkSync(join(root, 'dehors', 'lib-deplace'), join(out, 'lib'))
        writeFileSync(join(root, 'dehors', 'lib-deplace', 'y.js'), 'console.log("y")')
        const x = await lire(lance.port, lance.prefixe + '/lib/x.js')
        assert.equal(x.status, 404, 'fichier hors du dossier servi : ' + x.body.slice(0, 40))
        assert.equal((await lire(lance.port, lance.prefixe + '/lib/y.js')).status, 404)
      } finally {
        await lance.fermer()
      }
    })
  })
}

describe('isServableFile — le verdict gardé ne vaut que pour le même endroit réel', function () {
  afterEach(() => { relacher() })

  it('dossier servi derrière un lien basculé vers une version dont un dossier renvoie à l\'ancienne : refusé', () => {
    const root = mjsTmp('verdict-bascule')
    mkdirSync(join(root, 'v1', 'lib'), { recursive: true })
    mkdirSync(join(root, 'v2'))
    writeFileSync(join(root, 'v1', 'lib', 'x.js'), 'console.log("v1")')
    symlinkSync(join(root, 'v1'), join(root, 'current'))
    const dossier = join(root, 'current')
    const fichier = join(dossier, 'lib', 'x.js')
    assert.equal(isServableFile(fichier, dossier, null, null, null), true)
    // la nouvelle version renvoie à l'ancienne par un lien : même fichier, même chemin réel, mais hors du dossier servi
    symlinkSync(join(root, 'v1', 'lib'), join(root, 'v2', 'lib'))
    rmSync(dossier)
    symlinkSync(join(root, 'v2'), dossier)
    assert.equal(isServableFile(fichier, dossier, null, null, null), false)
  })

  it('rien n\'a bougé : le verdict est repris sans refaire la vérification complète', () => {
    const root = mjsTmp('verdict-repris')
    mkdirSync(join(root, 'out', 'lib'), { recursive: true })
    writeFileSync(join(root, 'out', 'lib', 'x.js'), 'console.log("x")')
    const dossier = join(root, 'out')
    const fichier = join(dossier, 'lib', 'x.js')
    espionner()
    assert.equal(isServableFile(fichier, dossier, root, null, root), true)
    assert.ok(completes > 0, 'la première demande fait la vérification complète')
    completes = 0
    natives   = 0
    assert.equal(isServableFile(fichier, dossier, root, null, root), true)
    assert.equal(completes, 0, 'verdict repris : aucune vérification complète')
    assert.ok(natives <= 2, 'au plus le chemin demandé et le dossier servi relus : ' + natives)
  })
})
