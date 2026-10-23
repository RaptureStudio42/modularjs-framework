// rune `µproxy` : enveloppe réactive d'un chemin de l'état, à passer à un code que le suivi des chemins ne voit pas.
// `µproxy $loc`, `µproxy $.loc.a`, `µproxy $loc.a`, `µproxy $loc.x.y` se compilent en
// `µ._mjs_makeDeepProxy(_mjsThis, ['loc', …])`, jamais en `µ.proxy(…)` (le sucre `µfoo` → `µ.foo`, absent du runtime :
// TypeError à l'appel) ; une écriture dans l'enveloppe rendue change l'état et redessine la vue. Civet et CoffeeScript,
// développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $loc = { a: { b: 0 }, x: { y: { z: 0 } } }
  @racine = -> µproxy $loc
  @point = -> µproxy $.loc.a
  @chemin = -> µproxy $loc.a
  @long = -> µproxy $loc.x.y
  @garder = (v) ->
    p := µproxy $loc.a
    p.b = v
</script>

<p class="v">{$loc.a.b} {$loc.x.y.z}</p>
`

const COFFEE = `<script lang="coffee">
$loc = { a: { b: 0 }, x: { y: { z: 0 } } }
@racine = -> µproxy $loc
@point = -> µproxy $.loc.a
@chemin = -> µproxy $loc.a
@long = -> µproxy $loc.x.y
@garder = (v) ->
  p = µproxy $loc.a
  p.b = v
</script>

<p class="v">{$loc.a.b} {$loc.x.y.z}</p>
`

async function construire(prefixe: string, prod: boolean): Promise<{ code: string, sorties: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'px-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'px-coffee.mjs'), COFFEE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return { code: readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), sorties: '' }
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const sorties = files.filter((f) => f.startsWith('px-')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), sorties }
}

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  // production : `µ` n'est pas exposé
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = '<mjs-px-civet></mjs-px-civet><mjs-px-coffee></mjs-px-coffee>'
  const civet  = window.document.querySelector('mjs-px-civet')
  const coffee = window.document.querySelector('mjs-px-coffee')
  const vue    = (c: any) => c._shadow?.querySelector('.v')?.textContent
  const fin    = Date.now() + 3000
  while (!(vue(civet) && vue(coffee)) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, vue }
}

const pause = () => new Promise((r) => setTimeout(r, 40))

describe('rune µproxy : enveloppe réactive d\'un chemin de l\'état, Civet et CoffeeScript', function () {
  this.timeout(180000)
  const construits: Record<string, { code: string, sorties: string }> = {}

  before(async function () {
    this.timeout(240000)
    construits.dev  = await construire('rune-proxy', false)
    construits.prod = await construire('rune-proxy-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('développement : chaque forme se compile en µ._mjs_makeDeepProxy avec le chemin entier, jamais en µ.proxy', () => {
    // guillemets ramenés à un seul style : chaque langue garde ou change les siens
    const s = construits.dev.sorties.replace(/"/g, '\'')
    assert.equal(/µ\.proxy\b/.test(s), false, 'µ.proxy dans la sortie')
    for (const chemin of ['\'loc\'', '\'loc\', \'a\'', '\'loc\', \'x\', \'y\'']) {
      // Civet et CoffeeScript : deux fois chacune ; `$.loc.a`, `$loc.a` et la variable gardée : six fois
      const n = s.split(`µ._mjs_makeDeepProxy(_mjsThis, [${chemin}])`).length - 1
      assert.equal(n, chemin === '\'loc\', \'a\'' ? 6 : 2, chemin)
    }
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : l'enveloppe rendue écrit dans l'état et redessine la vue, sans erreur`, async () => {
      const m = await monter(construits[mode].code, prod)
      try {
        const traces: string[] = []
        for (const [langue, c] of [['Civet', m.civet], ['CoffeeScript', m.coffee]] as [string, any][]) {
          const pas: [string, () => void][] = [
            ['racine', () => { c.racine().a.b = 1 }],
            ['point', () => { c.point().b = 2 }],
            ['chemin', () => { c.chemin().b = 3 }],
            ['long', () => { c.long().z = 4 }],
            ['garder', () => { c.garder(5) }],
          ]
          for (const [f, jouer] of pas) {
            let erreur = ''
            try {
              jouer()
            }
            catch (e: any) {
              erreur = `${e.name}: ${e.message}`
            }
            await pause()
            traces.push(`${langue} ${f} : ${erreur || m.vue(c)}`)
          }
        }
        assert.deepEqual(traces, [
          'Civet racine : 1 0', 'Civet point : 2 0', 'Civet chemin : 3 0', 'Civet long : 3 4', 'Civet garder : 5 4',
          'CoffeeScript racine : 1 0', 'CoffeeScript point : 2 0', 'CoffeeScript chemin : 3 0', 'CoffeeScript long : 3 4', 'CoffeeScript garder : 5 4',
        ])
      }
      finally {
        m.window.close()
      }
    })
  }
})
