// Un modèle en fichier qui porte aussi le marqueur de page (`carte.compacte.page.mjs`, qui a droit à
// <routes>/@routes/<@view>) reste un modèle de `carte` : `<@carte layout="compacte">` prend sa balise,
// comme pour `carte.compacte.mjs`. Un marqueur de page en double reste refusé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(etiquette: string, fichiers: Record<string, string>) {
  const root   = mjsTmp('modele-page-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  const lire    = (debut: string) => readdirSync(outDir).filter((f) => f.startsWith(debut + '-') && f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { stats, lire, erreurs: stats.errors.map((e: any) => e.message).join('\n') }
}

describe('un modèle en fichier qui est aussi une page', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('carte.compacte.page.mjs : <@carte layout="compacte"> prend la balise du modèle', async () => {
    const b = await construire('ok', {
      'carte.mjs':               '<article class="normale">{$titre}</article>\n',
      'carte.compacte.page.mjs': '<p class="compacte">{$titre}</p>\n',
      'hote.mjs':                '<@carte layout="compacte" titre="B"></@carte>\n',
    })
    assert.equal(b.erreurs, '')
    assert.ok(Object.keys(b.stats.manifest).includes('carte--compacte'))
    assert.match(b.lire('hote'), /mjs-carte--compacte/)
  })

  it('le modèle-page sans son composant : refusé comme un modèle', async () => {
    const b = await construire('seul', { 'fiche.compacte.page.mjs': '<b>x</b>\n' })
    assert.match(b.erreurs, /fiche\.compacte\.page\.mjs/)
  })
})
