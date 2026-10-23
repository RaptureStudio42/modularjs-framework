// Seul un fichier `<clé du manifeste>.<nom>.css` posé au premier niveau du dossier de sortie demande le module des
// variantes de mise en page : une feuille tierce (`vendor/bootstrap.min.css`, `app.min.css`) ne l'ajoute plus au cœur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARQUE = '_mjs_applyLayoutVariant = async function'

async function coeur(deposes: Record<string, string>): Promise<string> {
  const root = mjsTmp('variante-niveau')
  const src = join(root, 'src')
  const out = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'carte.mjs'), '<p>x</p>\n')
  for (const [nom, contenu] of Object.entries(deposes)) {
    mkdirSync(join(out, nom, '..'), { recursive: true })
    writeFileSync(join(out, nom), contenu)
  }
  const s = await new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), runtime: [] }).compile()
  assert.equal(s.errors.length, 0, s.errors.map(e => e.message).join('\n'))
  const f = readdirSync(out).find(n => /^mjs_core-/.test(n))!
  return readFileSync(join(out, f), 'utf-8')
}

describe('variantes de mise en page : seul le premier niveau, au nom d\'un composant', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('vendor/bootstrap.min.css n\'embarque pas le module des variantes', async () => {
    assert.ok(!(await coeur({ 'vendor/bootstrap.min.css': 'a{}' })).includes(MARQUE))
  })

  it('app.min.css au premier niveau (pas un composant) non plus', async () => {
    assert.ok(!(await coeur({ 'app.min.css': 'a{}' })).includes(MARQUE))
  })

  it('carte.compact.css (clé du manifeste) l\'embarque toujours', async () => {
    assert.ok((await coeur({ 'carte.compact.css': '.t{color:green}' })).includes(MARQUE))
  })
})
