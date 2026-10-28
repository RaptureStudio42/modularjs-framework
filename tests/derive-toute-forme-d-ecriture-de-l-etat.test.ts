// Valeurs dérivées : toute écriture de l'état les périme, quelle que soit sa forme — l'état passé tel quel (`Object.assign($, …)`,
// `Reflect.set`, `Object.defineProperty`, `Reflect.defineProperty`, `Object.defineProperties`, un alias, l'argument d'une
// fonction, un gestionnaire du gabarit), la suppression (`delete $[$k]`, `Reflect.deleteProperty`, par un alias), la tête d'une
// boucle `for…of` ou `for…in`, une écriture dans une boucle `for…in` sur l'état, `µwrite` (qui ne redessine rien). Relue
// aussitôt, la valeur dérivée est juste ; l'écran suit, sauf après `µwrite`. L'état lu tel quel (`Object.keys($)`,
// `JSON.stringify($)`, `$ === $`) reste celui du composant. JavaScript et Civet ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FORMES_JS = `<script lang="js">
  $x = 1;
  $k = 'x';
  $y = $x * 2;
  @setX = function(v) { $x = v; };
  @assign = function(v) { Object.assign($, {x: v}); };
  @reflectSet = function(v) { Reflect.set($, 'x', v); };
  @defineProp = function(v) { Object.defineProperty($, 'x', {value: v, writable: true, configurable: true, enumerable: true}); };
  @reflectDefine = function(v) { Reflect.defineProperty($, 'x', {value: v, writable: true, configurable: true, enumerable: true}); };
  @defineProps = function(v) { Object.defineProperties($, {x: {value: v, writable: true, configurable: true, enumerable: true}}); };
  @alias = function(v) { const s = $; s.x = v; };
  @argument = function(v) { const f = (o) => { o.x = v; }; f($); };
  @forOf = function(v) { for ($x of [v]) {} };
  @forIn = function(v) { const o = {}; o[v] = 1; for ($x in o) {} };
  @forInBody = function(v) { for (const c in $) { if (c === 'x') $[c] = v; } };
  @deleteKey = function() { delete $[$k]; };
  @reflectDelete = function() { Reflect.deleteProperty($, 'x'); };
  @deleteAlias = function() { const s = $; delete s.x; };
  @raw = function(v) { µwrite $x, v; };
  @read = function() { return $y; };
  @same = function() { return $ === $ && Object.keys($).includes('x') && JSON.parse(JSON.stringify($)).y === $y; };
</script>
<p class="v">{$x}|{$y}</p>
<button class="b" @click={Object.assign($, {x: 9})}>a</button>
`

const FORMES_CIVET = `<script>
$x = 1
$k = 'x'
$y = $x * 2
@setX = (v) -> $x = v
@assign = (v) -> Object.assign $, {x: v}
@argument = (v) -> remplir $, v
remplir = (o, v) -> o.x = v
@deleteKey = -> delete $[$k]
@raw = (v) -> µwrite $x, v
@read = -> $y
</script>
<p class="v">{$x}|{$y}</p>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prod: boolean) {
  const root   = mjsTmp('derive-formes')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-formes.mjs'), FORMES_JS)
  writeFileSync(join(srcDir, 'derive-formes-civet.mjs'), FORMES_CIVET)
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
  window.document.body.innerHTML = '<mjs-derive-formes></mjs-derive-formes><mjs-derive-formes-civet></mjs-derive-formes-civet>'
  const js    = window.document.querySelector('mjs-derive-formes')
  const civet = window.document.querySelector('mjs-derive-formes-civet')
  await attendre(() => !!js._shadow && !!civet._shadow && texte(js) === '1|2' && texte(civet) === '1|2')
  return { window, js, civet }
}

const texte = (el: any) => el._shadow?.querySelector('.v')?.textContent

// remet `$x` à 1 par une écriture ordinaire, l'écran compris
async function remettre(el: any) {
  el.setX(1)
  await attendre(() => texte(el) === '1|2')
  assert.equal(el.read(), 2)
  assert.equal(texte(el), '1|2')
}

describe('valeurs dérivées : toute forme d\'écriture de l\'état les périme', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let m: any
      before(async () => { m = await monter(prod) })

      for (const forme of ['assign', 'reflectSet', 'defineProp', 'reflectDefine', 'defineProps', 'alias', 'argument', 'forOf', 'forIn', 'forInBody']) {
        it(`JavaScript, ${forme} : la valeur dérivée relue aussitôt, puis l'écran`, async () => {
          await remettre(m.js)
          m.js[forme](7)
          assert.equal(m.js.read(), 14, 'relue aussitôt après l\'écriture')
          await attendre(() => texte(m.js) === '7|14')
          assert.equal(texte(m.js), '7|14')
        })
      }

      for (const forme of ['deleteKey', 'reflectDelete', 'deleteAlias']) {
        it(`JavaScript, ${forme} : la variable supprimée, la valeur dérivée relue aussitôt, puis l'écran`, async () => {
          await remettre(m.js)
          m.js[forme]()
          assert.ok(Number.isNaN(m.js.read()), 'relue aussitôt après la suppression : ' + m.js.read())
          await attendre(() => texte(m.js) === '|NaN')
          assert.equal(texte(m.js), '|NaN')
        })
      }

      it('JavaScript, gestionnaire du gabarit qui passe l\'état à Object.assign', async () => {
        await remettre(m.js)
        m.js._shadow.querySelector('.b').dispatchEvent(new m.window.Event('click', { bubbles: true, composed: true }))
        await attendre(() => texte(m.js) === '9|18')
        assert.equal(m.js.read(), 18)
        assert.equal(texte(m.js), '9|18')
      })

      it('JavaScript, µwrite : la valeur dérivée relue est juste, l\'écran ne bouge pas', async () => {
        await remettre(m.js)
        m.js.raw(7)
        assert.equal(m.js.read(), 14)
        await pause(30)
        assert.equal(texte(m.js), '1|2', 'µwrite seul ne redessine pas')
      })

      it('JavaScript, l\'état lu tel quel reste celui du composant', async () => {
        await remettre(m.js)
        assert.equal(m.js.same(), true)
      })

      for (const forme of ['assign', 'argument']) {
        it(`Civet, ${forme}`, async () => {
          await remettre(m.civet)
          m.civet[forme](7)
          assert.equal(m.civet.read(), 14, 'relue aussitôt après l\'écriture')
          await attendre(() => texte(m.civet) === '7|14')
          assert.equal(texte(m.civet), '7|14')
        })
      }

      it('Civet, delete $[$k]', async () => {
        await remettre(m.civet)
        m.civet.deleteKey()
        assert.ok(Number.isNaN(m.civet.read()), 'relue aussitôt après la suppression : ' + m.civet.read())
        await attendre(() => texte(m.civet) === '|NaN')
        assert.equal(texte(m.civet), '|NaN')
      })

      it('Civet, µwrite : la valeur dérivée relue est juste, l\'écran ne bouge pas', async () => {
        await remettre(m.civet)
        m.civet.raw(7)
        assert.equal(m.civet.read(), 14)
        await pause(30)
        assert.equal(texte(m.civet), '1|2', 'µwrite seul ne redessine pas')
      })
    })
  }
})
