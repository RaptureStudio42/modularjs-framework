// un nom à 8 chiffres ou 8 hexadécimaux avant l'extension était cru sur sa seule forme : `facture-20241019.pdf`, posé à la main dans
// le dossier de sortie, partait en cache d'un an immuable — remplacé sous le même nom, le navigateur gardait l'ancien un an. Cette
// empreinte-là se vérifie maintenant sur le contenu, comme l'empreinte courte (début du md5 du contenu, avec ou sans la ligne
// `sourceMappingURL` ajoutée après coup) ; les morceaux d'un fichier unique, nommés par le build, sont crus sur le registre des sorties

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { isBuildFingerprinted, startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const md5 = (s: string | Buffer): string => createHash('md5').update(s).digest('hex').slice(0, 8)

describe('cache d\'un an — empreinte à 8 hexadécimaux vérifiée sur le contenu', function () {
  after(async () => { await terminateSharedWorkerPool() })

  it('un nom d\'auteur à 8 chiffres ou 8 hexadécimaux n\'est pas immuable ; une vraie sortie du build l\'est', () => {
    const d = mjsTmp('empreinte-8hex')
    const image  = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4])
    const code   = 'export const a = 1\n'
    const nomMap = `unite-${md5(code)}.js`
    const fichiers: Record<string, [string | Buffer, boolean]> = {
      'facture-20241019.pdf':              ['%PDF facture', false],
      'menu-12345678.json':                ['{"plat":"soupe"}', false],
      'feuille-0a1b2c3d.css':              ['.a{}', false],
      [`photo-640-${md5(image)}.webp`]:    [image, true],
      [`logo-${md5('<svg/>')}.svg`]:       ['<svg/>', true],
      [nomMap]:                            [`${code}\n//# sourceMappingURL=${nomMap}.map\n`, true],
    }
    for (const [nom, [contenu]] of Object.entries(fichiers)) writeFileSync(join(d, nom), contenu)
    for (const [nom, [, attendu]] of Object.entries(fichiers)) assert.equal(isBuildFingerprinted(join(d, nom)), attendu, nom)
  })

  it('un morceau du fichier unique consigné par le build est immuable, le même nom non consigné ne l\'est pas', () => {
    const d = mjsTmp('empreinte-morceau')
    const nom = `chunk-${md5('chunk-ABCD1234.js')}.js`
    writeFileSync(join(d, nom), 'export const b = 2\n')
    assert.equal(isBuildFingerprinted(join(d, nom)), false)
    const e = mjsTmp('empreinte-morceau-consigne')
    writeFileSync(join(e, nom), 'export const b = 2\n')
    writeFileSync(join(e, '.mjs-outputs.json'), JSON.stringify({ extensions: ['.js'], chunks: [nom] }))
    assert.equal(isBuildFingerprinted(join(e, nom)), true)
  })

  it('mjs serve : la facture posée à la main part avec no-cache', async function () {
    this.timeout(60000)
    const root = mjsTmp('serve-empreinte-8hex')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'src', 'page.mjs'), '<p>page</p>\n')
    writeFileSync(join(root, 'out', 'facture-20241019.pdf'), '%PDF facture')
    const config: any = { sourceDir: 'src', outputDir: 'out', render: { routes: { '/page': { component: 'mjs-page', mode: 'csr' } } } }
    const serveur = await startRenderServer(config, root, { port: 0, host: '127.0.0.1', env: 'prod' })
    try {
      const res = await fetch(`http://127.0.0.1:${serveur.port}/facture-20241019.pdf`)
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('cache-control'), 'no-cache')
      await res.text()
    } finally {
      await serveur.close()
    }
  })
})
