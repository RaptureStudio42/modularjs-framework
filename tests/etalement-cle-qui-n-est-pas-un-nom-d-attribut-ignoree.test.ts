// un étalement `{...$data}` dont les clés viennent d'une donnée reçue : une clé qui n'est pas un nom d'attribut (espace, chevron) est
// ignorée et dite par un avertissement, sans arrêter le composant ; les autres clés de la même donnée passent
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

describe('étalement d\'une donnée reçue — clé qui n\'est pas un nom d\'attribut', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une clé qui n\'est pas un nom d\'attribut (espace, chevron) est ignorée et dite, le composant continue', async () => {
    const root = mjsTmp('etale-cle-nom')
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
    const erreurs: string[] = []
    const err = window.console.error
    window.console.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ').slice(0, 200)) }
    const out: string[] = []
    for (const json of ['{"a b":"espace","title":"deux"}', '{"<x>":"chevron","title":"trois"}', '{"c d":true,"title":"cinq"}', '{"title":"quatre"}']) {
      try { el.recevoir(json) } catch (e: any) { out.push('LÈVE ' + e.name) }
      await pause(80)
      const natif = el._shadow.querySelector('.natif')
      out.push(json + ' → ' + (natif ? 'title=' + natif.getAttribute('title') : 'vue vidée') + (el._mjs_has_crashed ? ' (composant arrêté)' : ''))
    }
    window.console.error = err
    assert.deepEqual(out, ['{"a b":"espace","title":"deux"} → title=deux', '{"<x>":"chevron","title":"trois"} → title=trois', '{"c d":true,"title":"cinq"} → title=cinq', '{"title":"quatre"} → title=quatre'], 'erreurs : ' + JSON.stringify(erreurs))
    assert.deepEqual(erreurs, [])
    for (const cle of ['a b', '<x>', 'c d']) assert.ok(avis.some((a) => a.includes('« ' + cle + ' »') || a.includes('"' + cle + '"')), 'avertissement pour « ' + cle + ' » — vus : ' + JSON.stringify(avis))
  })
})
