// {for} — une valeur que choisit la ligne sélectionnée (`title={$sel is x.id ? $t : 'c'}`) suit AUSSI la variable que lit sa branche :
// quand `$t` change, la ligne sélectionnée prend la nouvelle valeur, pour un titre, une classe et un `:style` ; quand `$sel` change, la
// valeur passe à la nouvelle ligne sélectionnée. Avant ce correctif, l'index par valeur ne réveillait la ligne que sur `$sel` : la
// ligne sélectionnée gardait l'ancienne valeur de `$t`, sans message.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const HEAD = `<script>
  $sel = 1
  $t   = 'VALEUR'
  $l   = [{id: 1}, {id: 2}]
</script>
`
const FORMS: Record<string, string> = {
  titre:  `<ul>{for x in $l}<li title={$sel is x.id ? $t : 'c'}>{x.id}</li>{end}</ul>`,
  classe: `<ul>{for x in $l}<li class={$sel is x.id ? $t : ''}>{x.id}</li>{end}</ul>`,
  style:  `<ul>{for x in $l}<li :style.color={$sel is x.id ? $t : 'black'}>{x.id}</li>{end}</ul>`
}
const READ: Record<string, (li: any) => string> = {
  titre:  li => li.getAttribute('title'),
  classe: li => li.getAttribute('class') ?? '',
  style:  li => li.style.color
}
const VALUES: Record<string, [string, string]> = { titre: ['actif', 'autre'], classe: ['actif', 'autre'], style: ['red', 'blue'] }

const stripEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '').replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '').replace(/import\.meta\.url/g, "'http://localhost/'")
const pause    = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

describe('{for} — la valeur de la ligne sélectionnée suit la variable que lit sa branche', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const form of Object.keys(FORMS)) it(`${form} : la ligne sélectionnée suit $t, puis la sélection passe à l'autre ligne`, async function () {
    const [initial, changed] = VALUES[form]

    const root   = mjsTmp('filtered-branche-' + form)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'zs.mjs'), HEAD.replace('VALEUR', initial) + '\n' + FORMS[form] + '\n')
    const stats = await new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }).compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
    const files = readdirSync(outDir)
    const core  = stripEsm(readFileSync(join(outDir, files.find(f => /^mjs_core-/.test(f))!), 'utf-8'))
    const comp  = stripEsm(readFileSync(join(outDir, files.find(f => /^zs-.*\.js$/.test(f))!), 'utf-8'))
    const win: any = new Window({ url: 'http://localhost/' })
    try {
      win.eval(`${core}\nglobalThis.µ = µ;\n${comp}`)
      win.document.body.innerHTML = '<mjs-zs></mjs-zs>'
      const el: any = win.document.body.firstElementChild
      await pause(100)
      const read = (): string[] => Array.from(el._shadow.querySelectorAll('li')).map(READ[form])
      assert.equal(read()[0], initial, 'au départ, la ligne sélectionnée')
      el._set('t', changed)
      await pause(60)
      assert.equal(read()[0], changed, `après $t = '${changed}', la ligne sélectionnée`)
      el._set('sel', 2)
      await pause(60)
      assert.equal(read()[1], changed, 'après $sel = 2, la nouvelle ligne sélectionnée')
      assert.notEqual(read()[0], changed, 'après $sel = 2, l\'ancienne ligne sélectionnée')
    }
    finally {
      win.close?.()
    }
  })
})
