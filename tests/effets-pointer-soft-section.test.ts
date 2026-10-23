// *pointer : les règles du bord progressif (`soft`) et leur code ne partent que dans une appli qui écrit `soft` (une section du fichier
// de l'effet, comme les carreaux de *liquid). Une appli qui n'écrit pas `soft` n'embarque aucune trace de la marque `mjs-fx-pointer-soft`
// ni du dégradé du bord ; une appli qui l'écrit (valeur fixe ou tenue par une variable) les reçoit, avec le correctif de Firefox.
// Aucune marque de section ne sort du build.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('*pointer(lens, soft) : une section du fichier, absente des applis qui n\'écrivent pas soft', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL de production dont le code reste lisible (`minify: false`) : le développement envoie les fichiers d'effets en entier, le tri des sections est celui de la production ; rend tout le JavaScript émis
  async function construire(nom: string, source: string): Promise<string> {
    const root   = mjsTmp('pointer-soft-section-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  }

  const MARQUE  = 'mjs-fx-pointer-soft'
  const BORD    = '@supports (-moz-orient'
  const REGLE   = 'closest-side'

  it('sans soft : ni la marque, ni le dégradé du bord, ni le correctif de Firefox (lentille, lentille inverse, disque)', async () => {
    for (const [nom, balise] of [['lens', '*pointer(lens)'], ['outside', '*pointer(lens, outside: true)'], ['disc', '*pointer(disc)'], ['reglages', '*pointer(lens, size: 80, grow: 3)']]) {
      const texte = await construire(nom, `<div class="a" ${balise}>x</div>`)
      assert.ok(texte.includes('mjs-fx-pointer-layer'), nom + ' : l\'effet est bien là')
      for (const m of [MARQUE, BORD, REGLE]) assert.equal(texte.includes(m), false, `${nom} : « ${m} » ne part pas sans soft`)
      assert.equal(texte.includes('// @@'), false, nom + ' : aucune marque de section ne sort')
    }
  })

  it('avec soft (fixe, à 0, ou tenu par une variable) : la marque, les deux dégradés et le correctif de Firefox partent', async () => {
    for (const [nom, source] of [
      ['fixe', '<div class="a" *pointer(lens, soft: 40)>x</div>'],
      ['zero', '<div class="a" *pointer(lens, soft: 0)>x</div>'],
      ['dehors', '<div class="a" *pointer(lens, outside: true, soft: 40)>x</div>'],
      ['variable', '<script>\n$s = 0\n</script>\n<div class="a" *pointer(lens, soft: $s)>x</div>']
    ]) {
      const texte = await construire(nom, source)
      for (const m of [MARQUE, BORD, REGLE]) assert.equal(texte.includes(m), true, `${nom} : « ${m} » part avec soft`)
      assert.equal(texte.includes('// @@'), false, nom + ' : aucune marque de section ne sort')
    }
  })
})
