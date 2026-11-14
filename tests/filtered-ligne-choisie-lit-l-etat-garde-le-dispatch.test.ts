// {for} de mille lignes — une valeur que choisit la ligne sélectionnée et qui lit l'état (`title={$sel is x.id ? $t : 'c'}`) garde le
// dispatch filtré : quand `$sel` change, seules l'ancienne et la nouvelle ligne sélectionnées sont récrites, les autres ne sont pas relues ;
// quand `$t` change, seule la ligne sélectionnée est récrite, avec la nouvelle valeur. La liaison ordinaire récrivait les mille lignes à
// chaque changement de `$sel` comme de `$t`

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script>
  $sel = 1
  $t   = 'actif'
  $l   = Array.from({ length: 1000 }, (_, i) -> ({ id: i + 1 }))
</script>

<ul>{for x in $l by id}<li title={$sel is x.id ? $t : 'c'}>{x.id}</li>{end}</ul>
`

const stripEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '').replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '').replace(/import\.meta\.url/g, "'http://localhost/'")
const pause    = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

describe('{for} — la ligne sélectionnée dont la valeur lit l\'état garde le dispatch filtré', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('mille lignes : `$sel` change, deux lignes récrites ; `$t` change, la seule ligne sélectionnée, avec la nouvelle valeur', async function () {
    const root   = mjsTmp('filtered-branche-mille')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'zm.mjs'), SOURCE)
    const stats = await new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }).compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
    const files = readdirSync(outDir)
    const core  = stripEsm(readFileSync(join(outDir, files.find(f => /^mjs_core-/.test(f))!), 'utf-8'))
    const comp  = stripEsm(readFileSync(join(outDir, files.find(f => /^zm-.*\.js$/.test(f))!), 'utf-8'))
    const win: any = new Window({ url: 'http://localhost/' })
    try {
      win.eval(`${core}\nglobalThis.µ = µ;\n${comp}`)
      win.document.body.innerHTML = '<mjs-zm></mjs-zm>'
      const el: any = win.document.body.firstElementChild
      await pause(100)
      // chaque écriture d'un attribut de ligne passe par `µ._mjs_updAttrNode` : on les compte
      const ecrire = win.µ._mjs_updAttrNode
      assert.equal(typeof ecrire, 'function', 'µ._mjs_updAttrNode, l\'écriture d\'un attribut de ligne')
      let n = 0
      win.µ._mjs_updAttrNode = function (...a: any[]) { n++; return ecrire.apply(this, a) }
      el._set('sel', 500)
      await pause(60)
      const auChoix = n
      el._set('t', 'neuf')
      await pause(60)
      const titres = Array.from(el._shadow.querySelectorAll('li')).map((li: any) => li.getAttribute('title'))
      const lu     = { ecrituresAuChoix: auChoix, ecrituresALaValeur: n - auChoix, ligne1: titres[0], ligne500: titres[499], ligne1000: titres[999] }
      assert.deepEqual(lu, { ecrituresAuChoix: 2, ecrituresALaValeur: 1, ligne1: 'c', ligne500: 'neuf', ligne1000: 'c' })
    }
    finally {
      win.close?.()
    }
  })
})
