// Un .js copié qui importe un voisin par chemin relatif (`import './rgn.js'`) alors que ce fichier
// n'existe pas sous le dossier des sources : le build réussit (l'import reste tel quel) mais dit, dans
// ses avertissements, quel composant cite ce .js et quel chemin manque — sinon la faute de frappe ne se
// découvre qu'au 404 de l'exécution. Rien à dire pour un voisin présent, ni pour un voisin hors du
// dossier des sources (laissé tel quel, volontairement).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const hote = (cible: string) => ['<script>', '  go = ->', `    m = await µimport('${cible}')`, '    m', '</script>', '<p>x</p>'].join('\n')

function projet(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

const concernes = (avertissements: string[]) => avertissements.filter(w => /rgn\.js/.test(w))

describe('bundler — un voisin .js absent est signalé par un avertissement', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('import \'./rgn.js\' qui n\'existe pas : le build réussit et l\'avertissement nomme le composant et le chemin', async () => {
    const p = projet('js-voisin-absent', { 'hote.mjs': hote('lib/main.js'), 'lib/main.js': "import { r } from './rgn.js'\nexport const d = r\n", 'lib/rng.js': 'export const r = 1\n' })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      const stats = await bundler.compile()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      const dits = concernes(stats.warnings)
      assert.equal(dits.length, 1, `un avertissement attendu, reçu : ${JSON.stringify(stats.warnings)}`)
      assert.match(dits[0], /hote\.mjs/, 'nomme le composant')
      assert.match(dits[0], /lib\/main\.js/, 'nomme le fichier qui importe')
      assert.match(dits[0], /lib\/rgn\.js/, 'nomme le chemin qui manque')
      const main = readdirSync(p.outDir).find(f => /^main-[a-f0-9]{8}\.js$/.test(f))!
      assert.match(readFileSync(join(p.outDir, main), 'utf8'), /from '\.\/rgn\.js'/, 'l\'import reste tel quel')
    }
    finally {
      await bundler.close()
    }
  })

  it('à la recompilation (composant resté en cache), l\'avertissement est encore dit', async () => {
    const p = projet('js-voisin-absent-cache', { 'hote.mjs': hote('lib/main.js'), 'autre.mjs': '<p>a</p>\n', 'lib/main.js': "import { r } from './rgn.js'\nexport const d = r\n" })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      assert.equal(concernes((await bundler.compile()).warnings).length, 1)
      writeFileSync(join(p.srcDir, 'autre.mjs'), '<p>b</p>\n')
      const dits = concernes((await bundler.compile()).warnings)
      assert.equal(dits.length, 1, 'le composant en cache garde son avertissement')
      assert.match(dits[0], /hote\.mjs/)
    }
    finally {
      await bundler.close()
    }
  })

  it('voisin présent, voisin hors du dossier des sources : aucun avertissement', async () => {
    const p = projet('js-voisin-present', { 'hote.mjs': hote('lib/main.js'), 'lib/main.js': "import { r } from './rgn.js'\nimport { h } from '../../hors.js'\nexport const d = [r, h]\n", 'lib/rgn.js': 'export const r = 1\n' })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      const stats = await bundler.compile()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      assert.deepEqual(stats.warnings.filter(w => /rgn\.js|hors\.js/.test(w)), [])
    }
    finally {
      await bundler.close()
    }
  })
})
