// *skeleton(height) réglé par un alias du fichier d'effets de l'appli (`*squelette = *skeleton(height: 0)`) : une hauteur nulle a le même
// avertissement de construction qu'écrite en clair — portée par l'alias, donnée à la pose d'un alias, ou par un alias d'alias. Le build ne
// cherchait que `*skeleton` écrit dans la page : un alias de l'appli ne disait rien. Une hauteur positive se tait toujours

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const EFFETS = `<effects>
  *squelette = *skeleton(height: 0)
  *plein = *skeleton(lines: 2)
  *vide = *squelette
</effects>
`

const PAGE = `<div class="a" *squelette></div>
<div class="b" *plein(height: 0)></div>
<div class="c" *vide></div>
<div class="d" *plein(height: 40)></div>
<div class="e" *plein></div>
<div class="f" *squelette(height: 120)></div>
`

describe('*skeleton(height) : une hauteur nulle passée par un alias de l\'appli a son avertissement de construction', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('`*squelette`, `*plein(height: 0)` et `*vide` le disent, une fois chacun, sous le nom écrit ; 40, `*plein` et `*squelette(height: 120)` se taisent', async () => {
    const root = mjsTmp('squelette-alias')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'app.effects.mjs'), EFFETS)
    writeFileSync(join(root, 'src', 'p-sq.mjs'), PAGE)
    const b     = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), minify: false } as any)
    const stats = await b.compile()
    await b.close()
    assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [], 'la construction passe')
    const avis = stats.warnings.map(String).filter((w: string) => /height = /.test(w))
    assert.equal(avis.length, 3, avis.join('\n'))
    assert.ok(avis.some(w => /\*squelette : height = 0 — une hauteur nulle ou négative ne donne rien/.test(w)), avis.join('\n'))
    assert.ok(avis.some(w => /\*plein : height = 0/.test(w)), avis.join('\n'))
    assert.ok(avis.some(w => /\*vide : height = 0/.test(w)), avis.join('\n'))
  })
})
