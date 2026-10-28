// *skeleton(height) : une hauteur nulle ou négative (`height: 0`, `height: -20`, `0px`, `-2em`) passe la vérification des réglages (une
// longueur), mais ne donne rien à la silhouette. La construction le dit, par un avertissement au vouvoiement, une fois par réglage écrit, en
// développement comme en production ; une hauteur positive ou tenue par une variable ne dit rien

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE = `<script>
  $h = -20
</script>
<div class="a" *skeleton(lines: 2, height: -20)></div>
<div class="b" *skeleton(height: 0)></div>
<div class="c" *skeleton(height: 0px)></div>
<div class="d" *skeleton(lines: 1, height: -2em)></div>
<div class="e" *skeleton(height: 120)></div>
<div class="f" *skeleton(height: 50%)></div>
<div class="g" *skeleton(height: 0.5rem)></div>
<div class="i" *skeleton(height: $h)></div>
<div class="j" *skeleton></div>
`

async function avertissements(env: 'dev' | 'prod', lint?: Record<string, boolean>): Promise<string[]> {
  const root = mjsTmp('squelette-hauteur-' + env)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'p-sq.mjs'), PAGE)
  const b     = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), minify: false, ...(env === 'prod' ? { env: 'prod' } : {}), ...(lint ? { lint } : {}) } as any)
  const stats = await b.compile()
  await b.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [], 'la construction passe')
  return stats.warnings.map(String).filter((w: string) => /\*skeleton/.test(w) && /height/.test(w))
}

describe('*skeleton(height) : une hauteur nulle ou négative a son avertissement de construction', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) it(`${env === 'dev' ? 'développement' : 'production'} : -20, 0, 0px et -2em le disent, une fois chacun ; 120, 50 %, 0.5rem et $h se taisent`, async () => {
    const w = await avertissements(env)
    const valeurs = w.map((l) => /height = (\S+)/.exec(l)?.[1] ?? l)
    assert.deepEqual(valeurs.sort(), ['-20', '-2em', '0', '0px'].sort(), w.join('\n'))
    for (const l of w) {
      assert.match(l, /p-sq/, 'le fichier est nommé')
      assert.match(l, /écrivez une longueur positive/, 'au vouvoiement, avec la façon de faire')
      assert.doesNotMatch(l, /\b(tu|ton|ta|tes)\b/, 'jamais de tutoiement')
    }
  })

  it('coupé par "lint": { "syntax": false }, comme les autres avertissements de sa sorte', async () => {
    assert.deepEqual(await avertissements('prod', { syntax: false }), [])
  })
})
