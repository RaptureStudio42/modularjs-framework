// Clé calculée qui n'est pas un texte : `$[$k] = v` avec `$k` un nombre, un booléen, `null`, `undefined` ou un objet écrit la
// variable que désigne la clé convertie en texte (`$[true]` est `$['true']`, comme en JavaScript) ; tout ce qui la lit suit —
// gabarit, valeur dérivée, µeffect. Une liste `['__proto__']` désigne `__proto__` : refusée comme lui, l'état garde son
// prototype. Développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CLES = `<script>
$k = 'a'
$a = 0
$true = 0
$null = 0
$undefined = 0
$vu = [$[$k]]
$copie = ''
µeffect -> $copie = "#{$true} #{$null} #{$undefined} #{$a}"
@choisir = (c) -> $k = c
@ecrire = (v) -> $[$k] = v
</script>
<p class="t">{$true} {$null} {$undefined} {$a}</p>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

async function monter(prod: boolean) {
  const root   = mjsTmp('cle-non-textuelle')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'cle-non-textuelle.mjs'), CLES)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  window.document.body.innerHTML = '<mjs-cle-non-textuelle></mjs-cle-non-textuelle>'
  const el = window.document.querySelector('mjs-cle-non-textuelle')
  await attendre(() => el._shadow?.querySelector('.t')?.textContent === '0 0 0 0')
  return { window, el }
}

const texte = (el: any) => el._shadow.querySelector('.t').textContent

describe('clé calculée qui n\'est pas un texte : $[$k] = v écrit la variable que désigne la clé', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let m: any
      before(async () => { m = await monter(prod) })

      it('booléen, null, undefined : la variable écrite, le gabarit, la valeur dérivée et le µeffect suivent', async () => {
        const el = m.el
        const cas: [unknown, string, number, string, string][] = [
          [true, 'true', 5, '5 0 0 0', '5 0 0 0'],
          [null, 'null', 6, '5 6 0 0', '5 6 0 0'],
          [undefined, 'undefined', 7, '5 6 7 0', '5 6 7 0'],
        ]
        for (const [cle, nom, v, affiche, copie] of cas) {
          el.choisir(cle)
          el.ecrire(v)
          assert.equal(el._state[nom], v, `$${nom}`)
          assert.deepEqual(Array.from(el._state.vu), [v], `valeur dérivée qui lit $[$k], clé ${nom}`)
          await attendre(() => texte(el) === affiche && el._state.copie === copie)
          assert.equal(texte(el), affiche, `gabarit, clé ${nom}`)
          assert.equal(el._state.copie, copie, `µeffect qui lit $${nom}`)
        }
      })

      it('nombre et objet : la clé convertie en texte', async () => {
        const el = m.el
        el.choisir(1)
        el.ecrire(8)
        assert.equal(el._state['1'], 8)
        el.choisir({ toString: () => 'a' })
        el.ecrire(9)
        assert.equal(el._state.a, 9)
        assert.deepEqual(Array.from(el._state.vu), [9])
        await attendre(() => texte(el).endsWith(' 9') && el._state.copie.endsWith(' 9'))
        assert.match(texte(el), / 9$/)
        assert.match(el._state.copie, / 9$/, 'µeffect qui lit $a')
      })

      it('liste [\'__proto__\'] : refusée comme la clé qu\'elle désigne, l\'état garde son prototype', () => {
        const el    = m.el
        const proto = Object.getPrototypeOf(el._state)
        el.choisir(['__proto__'])
        el.ecrire({ pollue: 1 })
        assert.equal(Object.getPrototypeOf(el._state), proto)
        assert.equal(el._state.pollue, undefined)
        el.choisir(['constructor'])
        el.ecrire(1)
        assert.notEqual(el._state.constructor, 1)
      })
    })
  }
})
