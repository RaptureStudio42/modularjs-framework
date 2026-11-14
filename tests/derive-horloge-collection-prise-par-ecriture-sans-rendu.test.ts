// Une `Map` à la racine d'une variable, lue par une valeur à l'horloge montrée, est tenue aussi par un second composant qui l'a prise par
// une écriture sans rendu (`µwrite $m, …`) et qui l'écrit par son code compilé (`$m.set('f', f)`) : après une frappe sans rapport dans le
// premier composant, son écran suit la fonction rangée — `µwrite` note le composant parmi ceux qui tiennent la collection, comme une
// affectation ordinaire (le témoin). Cœur construit, monté dans happy-dom, développement et production
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const preneur = (prendre: string): string => `<script>
$m = null
@prendre = ->
  ${prendre}
  0
@ajout = ->
  $m.set('f', window.__fn)
  0
</script>
<p class="e">-</p>
`
const COMPOSANTS: Record<string, string> = {
  'r-hote': "<script>\n$f = window.__ext\n$m = window.__partage\n$form = {q: ''}\n$v = window.lire($m.get('f'))\n@w = (x) -> $form.q = x\n@nom = (x) -> $f.nom = x\n@r = ->\n  µrefresh($m)\n  0\n</script>\n<p class=\"v\">{$v}</p><p class=\"q\">{$form.q}</p>\n",
  'r-muet': preneur('µwrite $m, window.__partage'),
  'r-pris': preneur('$m = window.__partage'),
  'r-nomme': "<script>\n$autre = new Map([['a', 1]])\n</script>\n<p class=\"v\">{$autre.size}</p>\n"
}
const PAGE = `window.__ext = { nom: 'a' }; window.__fn = () => window.__ext.nom; window.__partage = new Map([['a', 1]]);
window.lire = (x) => typeof x === 'function' ? String(x()) : '-';`
const scenario = (second: string): string => `(async () => {
  const pause = (ms = 50) => new Promise((r) => setTimeout(r, ms))
  const hote = document.body.appendChild(document.createElement('mjs-r-hote')), autre = document.body.appendChild(document.createElement('mjs-${second}'))
  const fin = Date.now() + 4000; while (!(hote._shadow && hote._shadow.querySelector('.v') && autre.prendre) && Date.now() < fin) await pause(10)
  await pause(80)
  const ecran = () => hote._shadow.querySelector('.v').textContent, o = []
  autre.prendre(); await pause()
  hote.w('a'); await pause(); hote.w('ab'); await pause()
  autre.ajout(); await pause()
  hote.w('abc'); await pause(); o.push(ecran())
  hote.nom('z'); await pause(); o.push(ecran())
  hote.r(); await pause(); hote.nom('y'); await pause(); o.push(ecran())
  return o
})()`

for (const prod of [false, true]) {
  describe('collection écrite par un second composant, frappe sans rapport dans le premier — ' + (prod ? 'production' : 'développement'), function () {
    this.timeout(120000)
    let code = ''
    before(async () => {
      const root = mjsTmp('collection-prise-sans-rendu'), srcDir = join(root, 'src'), outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [n, s] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, n + '.mjs'), s)
      const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
      if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
      const bundler = new Bundler(opts)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
      code = prod
        ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
        : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    })
    after(async () => { await terminateSharedWorkerPool() })
    for (const [second, titre] of [['r-pris', 'collection prise par une affectation ordinaire (témoin)'], ['r-muet', 'collection prise par une écriture sans rendu (µwrite)']]) {
      it(titre + ' : l\'écran suit la fonction rangée par le second composant', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        try {
          window.eval(PAGE)
          window.eval(code)
          const r = JSON.parse(JSON.stringify(await window.eval(scenario(second))))
          assert.deepEqual(r, ['a', 'z', 'y'], '[après la frappe sans rapport, après l\'écriture de ce que lit la fonction, après µrefresh($m) puis une autre écriture]')
        }
        finally {
          await window.happyDOM.close()
        }
      })
    }
  })
}
