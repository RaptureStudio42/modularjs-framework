// Le ménage des anciennes empreintes ne protège que les fichiers que le build cite encore. Un fichier copié tel
// quel (image, son, .js) dont la source existe toujours mais que plus aucun composant ne cite part au ménage
// suivant, comme celui dont la source a disparu ; l'homonyme encore cité d'un autre dossier, lui, reste.
// Une source supprimée sort aussi de la table des fichiers publiés que l'instance garde d'un tour à l'autre.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG      = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const withByte = (byte: number) => Buffer.concat([PNG, Buffer.from([byte])])
const digest   = (bytes: Buffer) => createHash('md5').update(bytes).digest('hex').slice(0, 8)
const logoOf   = (byte: number) => `logo-${digest(withByte(byte))}.png`
const hostOf   = (path: string) => `<img src="µasset('${path}')">\n<p>x</p>\n`

function project(prefix: string) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const files: Record<string, string | Buffer> = { 'hote-a.mjs': hostOf('a/logo.png'), 'hote-b.mjs': hostOf('b/logo.png'), 'a/logo.png': withByte(1), 'b/logo.png': withByte(2) }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(srcDir, path)), { recursive: true })
    writeFileSync(join(srcDir, path), content)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

const logos = (outDir: string) => readdirSync(outDir).filter(f => /^logo-[a-f0-9]{8}\.png$/.test(f))

async function rebuild(bundler: Bundler): Promise<void> {
  assert.deepEqual((await bundler.compile()).errors.map(e => e.message), [])
}

describe('bundler — le ménage des anciennes empreintes ne garde que ce qui est encore cité', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une source qui existe encore mais que plus aucun composant ne cite : son fichier part au ménage suivant', async () => {
    const p       = project('assets-non-cite')
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      await rebuild(bundler)
      assert.equal(logos(p.outDir).length, 2, 'les deux logos à froid')
      writeFileSync(join(p.srcDir, 'hote-a.mjs'), '<p>a ne cite plus son logo</p>\n')
      await rebuild(bundler)
      writeFileSync(join(p.srcDir, 'b/logo.png'), withByte(3))
      await rebuild(bundler)
      assert.deepEqual(logos(p.outDir), [logoOf(3)], 'seul le logo de b/ reste : celui de a/ n\'est plus cité')
    }
    finally {
      await bundler.close()
    }
  })

  it('une source supprimée sort de la table des fichiers publiés, et son fichier part', async () => {
    const p       = project('assets-supprime')
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    const table   = () => (bundler as any).publishedAssets as Map<string, unknown>
    const source  = join(p.srcDir, 'a/logo.png')
    try {
      await rebuild(bundler)
      assert.ok(table().has(source), 'la table connaît la source publiée')
      unlinkSync(source)
      unlinkSync(join(p.srcDir, 'hote-a.mjs'))
      await rebuild(bundler)
      assert.equal(table().has(source), false, 'la source supprimée n\'est plus dans la table')
      writeFileSync(join(p.srcDir, 'b/logo.png'), withByte(3))
      await rebuild(bundler)
      assert.deepEqual(logos(p.outDir), [logoOf(3)], 'seul le logo de b/ reste')
    }
    finally {
      await bundler.close()
    }
  })

  it('l\'homonyme encore cité d\'un autre dossier reste, même quand l\'autre est republié', async () => {
    const p       = project('assets-homonyme-cite')
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      await rebuild(bundler)
      writeFileSync(join(p.srcDir, 'a/logo.png'), withByte(4))
      await rebuild(bundler)
      assert.deepEqual(logos(p.outDir).sort(), [logoOf(2), logoOf(4)].sort(), 'le logo de b/ (encore cité) et le nouveau logo de a/')
    }
    finally {
      await bundler.close()
    }
  })
})
