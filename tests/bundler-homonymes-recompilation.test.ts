// Deux fichiers homonymes de deux dossiers (a/logo.png et b/logo.png, ou deux .js voisins a/util.js et
// b/util.js) gardent chacun leur fichier publié quand la MÊME instance recompile, comme le fait
// `mjs dev` : modifier celui de a/ ne retire jamais celui de b/, dont le composant resté en cache ne
// réécrit rien. Le ménage des anciennes empreintes ne retire que l'ancien nom du MÊME chemin.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const avec = (octet: number) => Buffer.concat([PNG, Buffer.from([octet])])

function projet(prefixe: string, fichiers: Record<string, string | Buffer>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

const hoteImage  = (chemin: string) => `<img src="µasset('${chemin}')">\n<p>x</p>\n`
const hoteImport = (cible: string) => ['<script>', '  go = ->', `    m = await µimport('${cible}')`, '    m', '</script>', '<p>x</p>'].join('\n')
const publies    = (outDir: string, base: string, ext: string) => readdirSync(outDir).filter(f => new RegExp(`^${base}-(?:[0-9a-z]{5}|[a-f0-9]{8})\\.${ext}$`).test(f))
const relatifs   = (code: string) => [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]+)\1/g)].map(m => m[2])
const sortie     = (outDir: string, composant: string) => readFileSync(join(outDir, publies(outDir, composant, 'js')[0]), 'utf8')

async function recompiler(bundler: any): Promise<void> {
  const stats = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
}

describe('bundler — des homonymes de deux dossiers, sur la même instance qui recompile', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µasset(\'a/logo.png\') et µasset(\'b/logo.png\') : modifier a/ seul garde le fichier publié de b/', async () => {
    const p = projet('homonymes-asset', { 'hote-a.mjs': hoteImage('a/logo.png'), 'hote-b.mjs': hoteImage('b/logo.png'), 'a/logo.png': avec(1), 'b/logo.png': avec(2) })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      await recompiler(bundler)
      assert.equal(publies(p.outDir, 'logo', 'png').length, 2, 'les deux logos publiés à froid')
      writeFileSync(join(p.srcDir, 'a/logo.png'), avec(3))
      await recompiler(bundler)
      const logos = publies(p.outDir, 'logo', 'png')
      assert.equal(logos.length, 2, `le logo de b/ et le nouveau logo de a/ : ${logos.join(', ')}`)
      const viseB = sortie(p.outDir, 'hote-b').match(/logo-[a-f0-9]{8}\.png/)![0]
      assert.ok(existsSync(join(p.outDir, viseB)), `hote-b vise ${viseB}, absent du dossier publié`)
      const viseA = sortie(p.outDir, 'hote-a').match(/logo-[a-f0-9]{8}\.png/)![0]
      assert.ok(existsSync(join(p.outDir, viseA)), `hote-a vise ${viseA}, absent du dossier publié`)
      assert.notEqual(viseA, viseB)
    }
    finally {
      await bundler.close()
    }
  })

  it('l\'ancien nom du MÊME chemin est bien retiré : deux éditions de a/ ne laissent toujours que deux logos', async () => {
    const p = projet('homonymes-asset-ancien', { 'hote-a.mjs': hoteImage('a/logo.png'), 'hote-b.mjs': hoteImage('b/logo.png'), 'a/logo.png': avec(1), 'b/logo.png': avec(2) })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      await recompiler(bundler)
      for (const octet of [3, 4]) {
        writeFileSync(join(p.srcDir, 'a/logo.png'), avec(octet))
        await recompiler(bundler)
      }
      const logos = publies(p.outDir, 'logo', 'png')
      assert.equal(logos.length, 2, `le logo de b/ et la dernière version de a/, rien d'autre : ${logos.join(', ')}`)
    }
    finally {
      await bundler.close()
    }
  })

  it('deux logos de MÊME contenu (un seul fichier publié) : modifier a/ ne retire pas ce fichier, que b/ vise encore', async () => {
    const p = projet('homonymes-asset-identiques', { 'hote-a.mjs': hoteImage('a/logo.png'), 'hote-b.mjs': hoteImage('b/logo.png'), 'a/logo.png': avec(1), 'b/logo.png': avec(1) })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      await recompiler(bundler)
      const commun = publies(p.outDir, 'logo', 'png')
      assert.equal(commun.length, 1, `un seul fichier pour deux contenus identiques : ${commun.join(', ')}`)
      writeFileSync(join(p.srcDir, 'a/logo.png'), avec(9))
      await recompiler(bundler)
      const viseB = sortie(p.outDir, 'hote-b').match(/logo-[a-f0-9]{8}\.png/)![0]
      assert.equal(viseB, commun[0], 'hote-b n\'a pas changé de logo')
      assert.ok(existsSync(join(p.outDir, viseB)), `hote-b vise ${viseB}, absent du dossier publié`)
    }
    finally {
      await bundler.close()
    }
  })

  it('deux .js voisins homonymes (a/util.js, b/util.js) : modifier a/util.js seul laisse la chaîne de b/ joignable', async () => {
    const principal = "import { u } from './util.js'\nexport const m = () => u\n"
    const p = projet('homonymes-js', {
      'hote-a.mjs': hoteImport('a/main.js'), 'hote-b.mjs': hoteImport('b/main.js'),
      'a/main.js': principal, 'a/util.js': 'export const u = "A1"\n',
      'b/main.js': principal, 'b/util.js': 'export const u = "B1"\n',
    })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      await recompiler(bundler)
      writeFileSync(join(p.srcDir, 'a/util.js'), 'export const u = "A2"\n')
      await recompiler(bundler)
      const mains = publies(p.outDir, 'main', 'js')
      const casses: string[] = []
      for (const m of mains) for (const s of relatifs(readFileSync(join(p.outDir, m), 'utf8'))) if (!existsSync(join(p.outDir, s))) casses.push(`${m} → ${s}`)
      for (const h of ['hote-a', 'hote-b']) {
        const vise = sortie(p.outDir, h).match(/main-[a-f0-9]{8}\.js/)![0]
        if (!existsSync(join(p.outDir, vise))) casses.push(`${h} → ${vise}`)
      }
      assert.deepEqual(casses, [], 'des fichiers publiés sont absents après la recompilation')
      assert.equal(publies(p.outDir, 'util', 'js').length, 2, 'un util par dossier, jamais l\'ancien util de a/')
      assert.equal(mains.length, 2, 'un main par dossier')
    }
    finally {
      await bundler.close()
    }
  })
})
