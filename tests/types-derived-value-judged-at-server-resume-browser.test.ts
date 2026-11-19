// rendu serveur puis reprise dans un vrai navigateur (les quatre modes de reprise : markers, positional, diff, replace), trois moteurs,
// développement : une variable dérivée hors de sa règle du <vars> le dit au réveil de la page, une fois, et pas de nouveau à un recalcul
// qui la laisse dehors — calculée seulement de ses variables (`$total = $a * 2`) comme d'une valeur qui attend et que la page servie a
// rangée (`$half = $r * $k`, `$r = await load()` : le navigateur reprend la réponse du serveur sans refaire la demande). La page porte le
// mode des règles que pose le manifeste de développement (`µ._typesMode`)

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { VARIANTES, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const OUT_OF_RULE = /sort de sa règle|is outside its rule/

const SOURCES: Record<string, string> = {
  'der-plain.mjs': `<vars>
  $total int 0..100
</vars>

<script>
$a     = 80
$total = $a * 2
@more  = -> $a++
</script>

<b class="v">{$total}</b>
`,
  'der-await.mjs': `<vars>
  $half int 0..100
</vars>

<script>
load  = -> Promise.resolve(300)
$k    = 2
$r    = await load()
$half = $r * $k
@more = -> $k++
</script>

<b class="v">{$half}</b>
`
}
const TAGS = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

// la page servie, avec la ligne du manifeste de développement qui règle le contrôle des règles (le harnais ne charge pas le manifeste)
async function served(): Promise<Cible> {
  const cible = await construire('ssr', SOURCES, TAGS)
  const line  = /µ\._typesMode = "\w+";/.exec(readFileSync(join(cible.racine, 'out', 'bundle.js'), 'utf-8'))?.[0]
  assert.ok(line, 'garde muette : le manifeste de développement règle le contrôle des règles')
  return { ...cible, document: (tag, variant) => cible.document(tag, variant).replace('\nglobalThis.µ = µ;\n', `\nglobalThis.µ = µ;\n${line}\n`) }
}

let built: Promise<Cible> | null = null
const target = (): Promise<Cible> => (built ??= served())

for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
  describe('types — a derived value out of its rule, server rendered then resumed: the browser says it at wake, once (' + engine + ')', function () {
    this.timeout(180000)
    let browser: any = null

    before(async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[engine].executablePath())) { this.skip(); return }
      browser = await playwright[engine].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    for (const tag of TAGS) {
      for (const variant of VARIANTES.ssr) {
        it(`${tag}, ${variant}: one warning at wake, the value served stays; none more at a recompute that leaves it out`, async () => {
          const open = await charger(browser, await target(), tag, variant, 400)
          try {
            const shown  = () => open.page.evaluate(`document.querySelector('${tag}')?._shadow?.querySelector('.v')?.textContent ?? '∅'`)
            const warned = () => open.avis.filter((a) => OUT_OF_RULE.test(a))
            const end    = Date.now() + 5000
            while (Date.now() < end && warned().length === 0) await open.page.waitForTimeout(50)
            await open.page.waitForTimeout(300)
            assert.equal(await open.page.evaluate('typeof µ._mjs_tderived'), 'function', 'garde muette : le cœur repris est celui du développement')
            assert.equal(await shown(), tag === 'mjs-der-plain' ? '160' : '600')
            assert.equal(warned().length, 1, warned().join(' | ') || 'aucun avertissement au réveil')
            assert.ok(warned()[0].includes('<' + tag + '>'), warned()[0])
            await open.page.evaluate(`document.querySelector('${tag}').more()`)
            await open.page.waitForTimeout(500)
            assert.equal(await shown(), tag === 'mjs-der-plain' ? '162' : '900')
            assert.equal(warned().length, 1, 'toujours dehors : rien de plus — ' + warned().join(' | '))
            assert.deepEqual(graves(open), [])
          }
          finally {
            await open.fermer()
          }
        })
      }
    }
  })
}
