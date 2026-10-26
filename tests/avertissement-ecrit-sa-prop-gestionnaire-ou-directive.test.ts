// avertissement de développement « écrit sa prop » : la balise d'un enfant qui porte un gestionnaire d'événement qui
// exécute du code (`@change={…}`, `@ferme={…}`, un événement des transitions `@introstart={…}`) le tait, le parent ayant un
// canal pour suivre ; une directive écrite avec un `@` (`@attach`, `@class{…}`, `@this`, `@emit.x`, `@lightDom`, une prop
// booléenne) ne le tait pas, ni un `@…` écrit sans valeur, qui n'exécute rien (`@persist`). La règle se lit
// dans le code émis en développement : `µ._mjs_oneWay` posé ou non sur la balise

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// nom du cas, attribut posé à côté de la prop, avertissement attendu
const CAS: [string, string, boolean][] = [
  ['aucun attribut', '', true],
  ['gestionnaire', '@change={$v = e.data}', false],
  ['gestionnaire et modificateur', '@change.propagate={$v = e.data}', false],
  ['événement du composant', '@ferme={$v = null}', false],
  ['événement de transition @introstart', '@introstart={$v = 2}', false],
  ['événement de transition @outroend', '@outroend={$v = 3}', false],
  ['@persist sans valeur', '@persist', true],
  ['@attach', '@attach={(el) -> null}', true],
  ['@class{}', '@class{actif: $v}', true],
  ['@style.color', '@style.color={$v}', true],
  ['@lightDom', '@lightDom', true],
  ['@emit.change', '@emit.change', true],
  ['@this à deux sens', '@this=!{ref}', true],
  ['prop booléenne @disabled', '@disabled={$v}', true],
]

describe('avertissement « écrit sa prop » : un gestionnaire d\'événement le tait, une directive non', function () {
  this.timeout(240000)
  let emis: Record<number, string> = {}

  before(async function () {
    this.timeout(240000)
    const root   = mjsTmp('ecrit-sa-prop')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'c-ecrit.mjs'), '<script>\n$x = 0\n@ecrire = -> $x = 9\n</script>\n<p>{$x}</p>\n')
    CAS.forEach(([, a], i) => writeFileSync(join(srcDir, `pw-${i}.mjs`), `<script>\n$v = 1\nref = null\n</script>\n<@c-ecrit x={$v} ${a}></@c-ecrit>\n`))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    emis = Object.fromEntries(CAS.map((_c, i) => {
      const f = files.find((x) => x.startsWith(`pw-${i}-`) || x === `pw-${i}.js`)
      return [i, f ? readFileSync(join(outDir, f), 'utf-8') : '']
    }))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('dev : chaque balise avertit ou se tait selon ce qu\'elle porte', () => {
    const vu      = CAS.map(([nom, a], i) => `${nom} (${a || '—'}) : ${emis[i].includes('_mjs_oneWay') ? 'avertit' : 'se tait'}`)
    const attendu = CAS.map(([nom, a, avertit]) => `${nom} (${a || '—'}) : ${avertit ? 'avertit' : 'se tait'}`)
    assert.deepEqual(vu, attendu)
  })
})
