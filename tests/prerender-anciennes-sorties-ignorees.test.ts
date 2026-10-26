// Le prérendu n'évalue que ce que SA compilation vient de produire.
//
// Le dossier de sortie d'un vrai projet garde des fichiers de builds antérieurs que le ménage des empreintes ne retire jamais : il
// ne touche qu'aux fichiers que son registre des sorties consigne, et les sorties d'un build d'avant ce registre (celles d'une 2.5,
// par exemple) restent là. Le rendu relisait tout le dossier : il prenait pour cœur le premier `mjs_core-*` par ordre alphabétique,
// et évaluait comme fichier du runtime tout `mjs_*` qui traînait. Après une migration depuis la 2.5, l'ancien `mjs_anims` importait
// l'ancien cœur, classé après lui : « Cannot access '_mjsF_mjs_u_core_45_…' before initialization » sur chaque page, build en échec.
//
// Règle : le cœur du rendu est celui que sa compilation vient d'écrire, et un `mjs_*` n'est évalué que s'il sort de cette compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { prerenderPages } from '../src/server/prerender.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

// projet d'une page ; les restes d'un build d'avant sont posés à la main dans son dossier de sortie, donc absents du registre
function projet(etiquette: string, restes: Record<string, string>): { root: string, config: any } {
  const root   = mjsTmp('anciennes-sorties-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'public', 'out')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(srcDir, 'home.mjs'), '<h1 class="t">accueil du build neuf</h1>\n')
  for (const [nom, code] of Object.entries(restes)) writeFileSync(join(outDir, nom), code)
  return { root, config: { sourceDir: 'src', outputDir: 'public/out', urlPrefix: '/out', render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-home' } } } } }
}

async function pageRendue(root: string, config: any): Promise<string> {
  const report = await prerenderPages(config, root)
  assert.deepEqual(report.skipped, [], 'aucune page ne doit échouer')
  const home = report.generated.find(g => g.url === '/')
  assert.ok(home, 'la page / est rendue')
  return readFileSync(home!.file, 'utf-8')
}

describe('prérendu — les sorties d\'un build antérieur restées dans le dossier de sortie ne sont jamais évaluées', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un ancien fichier du runtime qui importe un ancien cœur classé après le neuf : la page se rend (avant : « Cannot access … before initialization »)', async () => {
    const { root, config } = projet('runtime', {
      'mjs_core-zzzzzzzz.js':  'const µ = { ancien: true }\nexport { µ }\n',
      'mjs_anims-aaaaaaaa.js': 'import { µ } from \'/out/mjs_core-zzzzzzzz.js\'\nµ.animsAnciennes = true\n',
    })
    assert.match(await pageRendue(root, config), /accueil du build neuf/)
  })

  it('un ancien cœur classé avant le neuf n\'est pas pris pour le cœur du rendu', async () => {
    const { root, config } = projet('coeur', {
      'mjs_core-00000000.js': 'const µ = {}\nexport { µ }\n',
    })
    assert.match(await pageRendue(root, config), /accueil du build neuf/)
  })
})
