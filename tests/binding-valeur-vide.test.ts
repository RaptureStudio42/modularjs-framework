// Liaison two-way `value=!{$x}` sur une variable encore vide (jamais écrite, ou remise à `null`) :
// le champ reste VIDE. Le code posait `node.value = $.x` tel quel — `input.value = undefined`
// écrit la chaîne « undefined » dans le champ, que l'utilisateur voit (et qui repartait dans la
// variable au premier caractère tapé). À la racine, dans un {for}, dans un {if}.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('liaison value=!{$x} — une variable vide laisse le champ vide', function () {
  this.timeout(60000)
  let window: any
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('jamais écrite, remise à null, puis écrite : vide, vide, la valeur', async () => {
    const root   = mjsTmp('binding-vide')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'champ-vide.mjs'), [
      '<script>',
      '$ok = true',
      '$items = [1]',
      '</script>',
      '<input class="a" type="text" value=!{$texte}>',
      '<textarea class="b" value=!{$note}></textarea>',
      '<input class="c" type="number" value=!{$nombre}>',
      '{for i in $items by i}<input class="d" type="text" value=!{$ligne}>{end}',
      '{if $ok}<input class="e" type="text" value=!{$branche}>{end}',
      '<button class="vider" @click={$texte = null}>v</button>',
      '<button class="remplir" @click={$texte = "bonjour"}>r</button>',
    ].join('\n'))
    const b     = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await b.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await b.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-champ-vide></mjs-champ-vide>'
    const comp = window.document.querySelector('mjs-champ-vide')
    await attendre(() => !!comp._shadow?.querySelector('.e'))
    await new Promise((r) => setTimeout(r, 20))
    const val = (sel: string) => comp._shadow.querySelector(sel).value
    for (const sel of ['.a', '.b', '.c', '.d', '.e']) assert.equal(val(sel), '', `${sel} : « ${val(sel)} »`)
    comp._shadow.querySelector('.remplir').click()
    await attendre(() => val('.a') === 'bonjour')
    assert.equal(val('.a'), 'bonjour')
    comp._shadow.querySelector('.vider').click()
    await attendre(() => val('.a') !== 'bonjour')
    assert.equal(val('.a'), '', 'remise à null : vide, pas « null »')
  })
})
