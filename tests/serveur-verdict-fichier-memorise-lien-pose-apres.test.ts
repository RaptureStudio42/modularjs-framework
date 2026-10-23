// Un fichier servi passait à CHAQUE demande par toute la chaîne de ses contrôles (chemin réel dans le dossier servi, secrets d'un
// dossier de sortie qui serait la racine du projet) : deux à six résolutions de chemin réel, 70 à 90 µs, pour un fichier qui ne
// change presque jamais. Le verdict est désormais gardé par chemin demandé, et repris seulement si ce chemin mène toujours au même
// endroit réel et au même fichier, inchangé (deux chemins réels relus par la forme native, jamais la vérification complète par la
// forme JavaScript) : un lien symbolique posé APRÈS une première vérification, sur le fichier lui-même ou sur un dossier du chemin,
// est refusé comme avant, un fichier réécrit est revérifié, et la mémoire garde au plus 4096 verdicts. Vaut pour `mjs serve`, pour
// `mjs dev` et pour les pages prérendues.

import { strict as assert } from 'node:assert'
import fs, { mkdirSync, writeFileSync, symlinkSync, renameSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { startRenderServer } from '../src/server/render-server.js'
import { createRenderHandler } from '../src/server/render-request.js'
import { StaticServer } from '../src/server/index.js'
import { mjsTmp } from './helpers/tmp.js'

// compte les résolutions de chemin réel pendant une demande : par la forme JavaScript (la vérification complète), et par la forme
// native (le chemin demandé et le dossier servi, relus à chaque reprise du verdict)
const vrai = fs.realpathSync
let resolutions = 0
let natives     = 0
function espionner(): void {
  const espion: any = (p: fs.PathLike, o?: any) => { resolutions++; return vrai(p, o) }
  espion.native = (p: fs.PathLike, o?: any) => { natives++; return vrai.native(p, o) }
  ;(fs as any).realpathSync = espion
  syncBuiltinESMExports()
}
function relacher(): void {
  ;(fs as any).realpathSync = vrai
  syncBuiltinESMExports()
}

async function lire(port: number, chemin: string): Promise<{ status: number, body: string, resolutions: number, natives: number }> {
  resolutions = 0
  natives     = 0
  const res  = await fetch(`http://127.0.0.1:${port}${chemin}`)
  const body = await res.text()
  return { status: res.status, body, resolutions, natives }
}

interface Lance { port: number, prefixe: string, fermer(): Promise<void> }

// un projet : dossier de sortie `out` (servi), un dossier `dehors` à côté, hors de tout dossier servi
function projet(nom: string): { root: string, out: string, dehors: string } {
  const root   = mjsTmp(nom)
  const out    = join(root, 'out')
  const dehors = join(root, 'dehors')
  mkdirSync(join(root, 'src'))
  mkdirSync(join(out, 'lib'), { recursive: true })
  mkdirSync(join(dehors, 'lib'), { recursive: true })
  writeFileSync(join(out, 'app.js'), 'console.log("app")')
  writeFileSync(join(out, 'lib', 'x.js'), 'console.log("x")')
  writeFileSync(join(out, 'neuf.js'), 'console.log("v1")')
  writeFileSync(join(dehors, 'secret.txt'), 'CONTENU HORS DU DOSSIER SERVI')
  writeFileSync(join(dehors, 'lib', 'x.js'), 'CONTENU HORS DU DOSSIER SERVI')
  return { root, out, dehors }
}

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
  describe(`${serveur.nom} — le verdict d'un fichier servi est gardé, jamais pour un chemin devenu dangereux`, function () {
    this.timeout(30000)

    let p: ReturnType<typeof projet>, lance: Lance

    beforeEach(async () => {
      p     = projet('verdict-fichier')
      lance = await serveur.lancer(p.root, p.out)
      espionner()
    })

    afterEach(async () => {
      relacher()
      await lance.fermer()
    })

    it('un fichier demandé deux fois : la seconde demande ne refait pas la vérification complète', async () => {
      const a = await lire(lance.port, lance.prefixe + '/app.js')
      assert.equal(a.status, 200)
      assert.equal(a.body, 'console.log("app")')
      assert.ok(a.resolutions > 0, 'la première demande vérifie le chemin réel')
      const b = await lire(lance.port, lance.prefixe + '/app.js')
      assert.equal(b.status, 200)
      assert.equal(b.body, 'console.log("app")')
      assert.equal(b.resolutions, 0, 'fichier inchangé : verdict repris sans la vérification complète')
      assert.ok(b.natives <= 2, 'au plus le chemin demandé et le dossier servi relus : ' + b.natives)
    })

    it('un lien posé sur le fichier APRÈS une première vérification est refusé', async () => {
      assert.equal((await lire(lance.port, lance.prefixe + '/app.js')).status, 200)
      renameSync(join(p.out, 'app.js'), join(p.out, 'app-ancien.js'))
      symlinkSync(join(p.dehors, 'secret.txt'), join(p.out, 'app.js'))
      const r = await lire(lance.port, lance.prefixe + '/app.js')
      assert.equal(r.status, 404)
      assert.doesNotMatch(r.body, /HORS DU DOSSIER SERVI/)
    })

    it('un lien posé sur un dossier du chemin APRÈS une première vérification est refusé', async () => {
      assert.equal((await lire(lance.port, lance.prefixe + '/lib/x.js')).status, 200)
      renameSync(join(p.out, 'lib'), join(p.out, 'lib-ancien'))
      symlinkSync(join(p.dehors, 'lib'), join(p.out, 'lib'))
      const r = await lire(lance.port, lance.prefixe + '/lib/x.js')
      assert.equal(r.status, 404)
      assert.doesNotMatch(r.body, /HORS DU DOSSIER SERVI/)
    })

    it('un fichier réécrit (sortie reconstruite) est revérifié, puis servi neuf', async () => {
      assert.equal((await lire(lance.port, lance.prefixe + '/neuf.js')).body, 'console.log("v1")')
      writeFileSync(join(p.out, 'neuf.js'), 'console.log("version 2")')
      const r = await lire(lance.port, lance.prefixe + '/neuf.js')
      assert.equal(r.status, 200)
      assert.equal(r.body, 'console.log("version 2")')
      assert.ok(r.resolutions > 0, 'autre taille, autres dates : vérifié de nouveau')
    })
  })
}

describe('mjs serve — la mémoire des verdicts est bornée', function () {
  this.timeout(60000)

  it('au-delà de 4096 fichiers vérifiés, le plus ancien verdict sort et se revérifie', async () => {
    const p = projet('verdict-borne')
    for (let i = 0; i < 4096; i++) writeFileSync(join(p.out, 'f' + i + '.js'), String(i))
    const lance = await serveurs[0].lancer(p.root, p.out)
    espionner()
    try {
      assert.equal((await lire(lance.port, '/assets/app.js')).status, 200)
      assert.equal((await lire(lance.port, '/assets/app.js')).resolutions, 0, 'gardé')
      for (let i = 0; i < 4096; i++) assert.equal((await lire(lance.port, '/assets/f' + i + '.js')).status, 200)
      const r = await lire(lance.port, '/assets/app.js')
      assert.equal(r.status, 200)
      assert.ok(r.resolutions > 0, 'le plus ancien verdict est sorti de la mémoire : vérifié de nouveau')
    }
    finally {
      relacher()
      await lance.fermer()
    }
  })
})

describe('page prérendue — le verdict de son fichier est gardé, jamais pour un chemin devenu dangereux', function () {
  this.timeout(60000)

  it('seconde lecture sans résolution ; un lien posé ensuite sur le fichier de la page est refusé', async () => {
    const p = projet('verdict-prerendu')
    mkdirSync(join(p.root, 'pages'))
    writeFileSync(join(p.root, 'pages', 'a.html'), '<p>page figée</p>')
    const config: any = { sourceDir: 'src', outputDir: 'out', render: { outDir: 'pages', routes: { '/a': { component: 'mjs-a', mode: 'prerender' } } } }
    const handler = await createRenderHandler(config, p.root)
    espionner()
    try {
      const a = await handler.handle('/a')
      assert.equal(a.kind, 'prerender')
      assert.equal(a.body, '<p>page figée</p>')
      resolutions = 0
      const b = await handler.handle('/a')
      assert.equal(b.kind, 'prerender')
      assert.equal(resolutions, 0, 'fichier inchangé : verdict repris sans la vérification complète')
      renameSync(join(p.root, 'pages', 'a.html'), join(p.root, 'pages', 'a-ancien.html'))
      symlinkSync(join(p.dehors, 'secret.txt'), join(p.root, 'pages', 'a.html'))
      const c = await handler.handle('/a')
      assert.notEqual(c.kind, 'prerender')
      assert.doesNotMatch(c.body, /HORS DU DOSSIER SERVI/)
    }
    finally {
      relacher()
      await handler.close()
    }
  })
})
