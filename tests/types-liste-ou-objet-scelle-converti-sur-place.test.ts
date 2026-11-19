// une liste ou un objet SCELLÉ (Object.seal) sous une règle du `<vars>` : ses cases et ses champs s'écrivent, la conversion se fait sur la
// valeur même, y compris quand une méthode comme `fill` repasse la règle sur la liste ; seul un objet GELÉ passe dans une copie. Une copie
// prise pour une liste scellée était perdue après `fill` : la liste `int[]` gardait des chaînes
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const NOTES = `<vars>
  $notes int[]
  $fiche
    nom  string
    age  int
</vars>
<script>
  $notes = [1]
  $fiche = { nom: 'Ada', age: 3 }
  @poser   = (l) -> $notes = l
  @remplir = (x) -> $notes.fill(x)
  @ficher  = (o) -> $fiche = o
</script>
<p class="n">{$notes.join(',')}</p><p class="t">{typeof $notes[0]} {typeof $notes[1]} {typeof $fiche.age}</p>
`

describe('types du <vars> : une liste ou un objet scellé est converti sur place', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('liste scellée remplie par fill, liste et objet scellés reçus : conversions faites sur la valeur même, qui reste scellée', async () => {
    const root = mjsTmp('types-scelle')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'notes.mjs'), NOTES)
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(join(root, 'out')).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    const code  = ordre.map((f) => stripEsm(readFileSync(join(root, 'out', f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    try {
      window.eval(code + '\nglobalThis.µ = µ;')
      window.document.body.innerHTML = '<mjs-notes></mjs-notes>'
      await pause(150)
      const el  = window.document.querySelector('mjs-notes'), o = el._shadow
      const raw = (k: string) => window.µ._mjs_toRaw(el._state[k])
      const liste = Object.seal([1, 2])
      el.poser(liste)
      await pause(60)
      el.remplir('7')
      await pause(80)
      const apresFill = [raw('notes') === liste, raw('notes').map((x: any) => typeof x).join(','), o.querySelector('.n').textContent]
      const recue = Object.seal(['2', '3'])
      el.poser(recue)
      const fiche = Object.seal({ nom: 'Bob', age: '7' })
      el.ficher(fiche)
      await pause(80)
      const vu = { apresFill, recue: [raw('notes') === recue, Object.isSealed(recue), recue.map((x: any) => typeof x).join(',')], fiche: [raw('fiche') === fiche, typeof fiche.age], ecran: o.querySelector('.t').textContent }
      assert.deepEqual(vu, { apresFill: [true, 'number,number', '7,7'], recue: [true, true, 'number,number'], fiche: [true, 'number'], ecran: 'number number number' })
    }
    finally { await window.happyDOM.close() }
  })
})
