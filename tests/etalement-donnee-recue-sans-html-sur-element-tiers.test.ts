// un étalement `{...$data}` dont les clés viennent d'une donnée reçue : les clés `innerHTML` et `outerHTML` ne posent de HTML ni sur une
// balise native (simple attribut) ni sur un élément tiers (prop refusée, dite par un avertissement) ; les autres clés passent
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const PAGE  = `<script>
  $data = {}
  @recevoir = (json) -> $data = JSON.parse(json)
</script>
<div class="natif" {...$data}>natif</div>
<x-tiers class="tiers" {...$data}>tiers</x-tiers>
`

describe('étalement d\'une donnée reçue — innerHTML et outerHTML sur un élément tiers', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la clé innerHTML ou outerHTML d\'une donnée reçue ne pose de HTML ni sur une balise native, ni sur un élément tiers', async () => {
    const root = mjsTmp('etale-tiers-html')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'page.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(join(root, 'out')).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    const code  = ordre.map((f) => stripEsm(readFileSync(join(root, 'out', f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval(code + '\nglobalThis.µ = µ;')
    const avis: string[] = []
    window.µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    window.document.body.innerHTML = '<mjs-page></mjs-page>'
    await pause(150)
    const el = window.document.querySelector('mjs-page')
    el.recevoir('{"title":"ok","innerHTML":"<img src=x onerror=alert(1)>","outerHTML":"<p id=remplace>x</p>","onclick":"alert(2)"}')
    await pause(100)
    const natif = el._shadow.querySelector('.natif')
    const tiers = el._shadow.querySelector('.tiers')
    const vu = {
      natif: natif ? natif.querySelectorAll('img').length + ' img, onclick=' + natif.getAttribute('onclick') + ', title=' + natif.getAttribute('title') : 'balise native remplacée',
      tiers: tiers ? tiers.querySelectorAll('img').length + ' img, texte=' + tiers.textContent + ', title=' + tiers.title : 'élément tiers remplacé, #remplace=' + el._shadow.querySelectorAll('#remplace').length
    }
    assert.deepEqual(vu, { natif: '0 img, onclick=null, title=ok', tiers: '0 img, texte=tiers, title=ok' })
    assert.ok(avis.some((a) => a.includes('<x-tiers>') && a.includes('innerHTML')), 'avertissement pour innerHTML — vus : ' + JSON.stringify(avis))
    assert.ok(avis.some((a) => a.includes('<x-tiers>') && a.includes('outerHTML')), 'avertissement pour outerHTML — vus : ' + JSON.stringify(avis))
  })
})
