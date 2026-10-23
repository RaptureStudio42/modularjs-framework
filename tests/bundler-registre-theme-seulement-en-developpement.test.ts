// Le registre des variables de thème (`.mjs-theme-vars.json`) sert l'atelier `/__mjs/theme` de `mjs dev`, fermé en production. Il
// partait pourtant dans le dossier publié par un build de production, avec le chemin des fichiers sources du projet et les
// commentaires des composants. Il n'est plus écrit qu'en développement ; les avertissements de thème, eux, restent dans les deux.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANT = '<style>\n  // couleur interne du panneau de remboursement manuel\n  :host\n    --mjs-alerte: red\n  p\n    color: var(--mjs-alerte, blue)\n</style>\n<p>a</p>\n'

async function construire(prefixe: string, env: 'dev' | 'prod') {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src', 'admin')
  const out  = join(root, 'public')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'admin-paiements.mjs'), COMPOSANT)
  const b = new Bundler({ sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(out, 'bundle.js'), env })
  try {
    const stats = await b.compile()
    assert.deepEqual(stats.errors.map(e => e.message), [])
    return { registre: join(out, '.mjs-theme-vars.json'), manifeste: join(out, 'bundle.js') }
  }
  finally {
    await b.close()
  }
}

describe('bundler — registre des variables de thème : développement seulement', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('production : aucun registre dans le dossier publié', async () => {
    const { registre, manifeste } = await construire('registre-theme-prod', 'prod')
    assert.ok(existsSync(manifeste), 'le build a bien publié')
    assert.equal(existsSync(registre), false, 'registre écrit en production')
  })

  it('développement : le registre est écrit pour l\'atelier, avec la variable déclarée', async () => {
    const { registre } = await construire('registre-theme-dev', 'dev')
    assert.ok(existsSync(registre))
    assert.deepEqual(JSON.parse(readFileSync(registre, 'utf-8')).alerte.readBy, ['admin-paiements'])
  })
})
