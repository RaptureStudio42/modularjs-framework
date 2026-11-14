// le chargeur des messages part, en production, dans son propre fichier (`mjs_msg-<empreinte>.js`), qu'un module importe à la
// demande ; un outil qui colle TOUS les `.js` du dossier de sortie en un script (tests, rendu fait main) doit pouvoir le lire :
// sa fonction porte un nom, sans quoi `export default function(µ, q)`, une fois l'export ôté, n'est plus du JavaScript valide
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = ['<script lang="js">', '  $n = 0;', '  @plus = function() { $n++; };', '</script>', '<p>{$n}</p>'].join('\n')

describe('chargeur des messages : un script valide une fois collé aux autres sorties', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, opts] of [['production', { env: 'prod', minify: false }], ['production minifiée', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', minify: false, proxy: false }]] as Array<[string, any]>) {
    it(nom, async () => {
      const root   = mjsTmp('chargeur-colle')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'compte.mjs'), SOURCE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const chargeur = fichiers.find((f) => f.startsWith('mjs_msg-'))
      assert.ok(chargeur, 'le fichier du chargeur est écrit en production : ' + fichiers.join(' '))
      const seul = stripEsm(readFileSync(join(outDir, chargeur!), 'utf-8'))
      assert.doesNotThrow(() => new Function(seul), 'le chargeur seul, l\'export ôté')
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      const colle = fichiers.sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
      assert.doesNotThrow(() => new Function(colle), 'toutes les sorties collées')
    })
  }
})
