// Ce que le gabarit affiche d'un accès calculé `$[$k]` — lu en direct (texte, attribut, condition d'un `{if}`) ou par
// une valeur dérivée (`$cle = $[$k]`, et celle qui la lit) — suit la variable que `$k` nomme : la clé n'est connue
// qu'à l'exécution, l'affichage se relance à toute écriture du composant. Clé qui ne nomme aucune variable déclarée
// (`$[$i] = v`, `$i` un nombre) comprise. Seulement pour ce qui ne lit que l'état : une expression, ou une valeur
// dérivée qu'elle lit, qui appelle une fonction garde ses dépendances connues à la compilation — une requête n'est
// pas refaite à chaque écriture. Les valeurs dérivées du runtime (`_mjs_computedDeps`, qui relancent les µeffect) ne
// changent pas, un composant sans accès calculé n'a rien de plus, et `µderived` garde les dépendances qu'il nomme.
// Développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const DYN = `<script>
$a = 1
$b = 2
$k = 'a'
$i = 0
$cle = $[$k]
$cle2 = $cle * 10
@ecrireI = (v) -> $[$i] = v
</script>
<p class="c">{$cle}</p><p class="c2">{$cle2}</p><p class="d" title={$[$k]}>{$[$k]}</p><p class="i">{$[$i]}</p>{if $[$k] > 3}<b class="grand">g</b>{end}
`

const DYN_JS = `<script lang="js">
$a = 1
$b = 2
$k = 'a'
$cle = $[$k]
</script>
<p class="c">{$cle}</p><p class="d">{$[$k]}</p>
`

// valeur dérivée qui lit `$[$k]` ET appelle une fonction : affichée par un `{await}`, elle n'est pas refaite à chaque écriture
const APPEL = `<script module>
appels = {n: 0}
charger = (v) ->
  appels.n += 1
  Promise.resolve(v)
</script>
<script>
$a = 1
$z = 0
$k = 'a'
$user = charger($[$k])
@nb = -> appels.n
</script>
<p class="z">{$z}</p>{await $user}<p class="att">attente</p>{success u}<p class="u">{u}</p>{end}
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prod: boolean) {
  const root   = mjsTmp('gabarit-cle')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gabarit-cle.mjs'), DYN)
  writeFileSync(join(srcDir, 'gabarit-cle-js.mjs'), DYN_JS)
  writeFileSync(join(srcDir, 'gabarit-cle-appel.mjs'), APPEL)
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
  window.document.body.innerHTML = '<mjs-gabarit-cle></mjs-gabarit-cle><mjs-gabarit-cle-js></mjs-gabarit-cle-js><mjs-gabarit-cle-appel></mjs-gabarit-cle-appel>'
  const el    = window.document.querySelector('mjs-gabarit-cle')
  const js    = window.document.querySelector('mjs-gabarit-cle-js')
  const appel = window.document.querySelector('mjs-gabarit-cle-appel')
  await attendre(() => el._shadow?.querySelector('.c2')?.textContent === '10' && js._shadow?.querySelector('.d')?.textContent === '1' && appel._shadow?.querySelector('.u')?.textContent === '1')
  await pause(20)
  return { window, el, js, appel }
}

const q = (el: any, c: string) => el._shadow.querySelector(c)

describe('gabarit : un accès calculé $[$k] suit la variable que $k nomme', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let m: any
      before(async () => { m = await monter(prod) })

      it('valeur dérivée qui lit $[$k], et celle qui la lit ; texte et attribut lus en direct ; condition d\'un {if}', async () => {
        const el  = m.el
        const txt = () => `${q(el, '.c').textContent} ${q(el, '.c2').textContent} ${q(el, '.d').textContent} ${q(el, '.d').getAttribute('title')} ${q(el, '.grand') ? 'g' : '-'}`
        assert.equal(txt(), '1 10 1 1 -')
        el._set('a', 5)
        await attendre(() => txt() !== '1 10 1 1 -')
        assert.equal(txt(), '5 50 5 5 g')
        el._set('k', 'b')
        await attendre(() => txt() !== '5 50 5 5 g')
        assert.equal(txt(), '2 20 2 2 -')
        el._set('a', 7)
        await pause(20)
        assert.equal(txt(), '2 20 2 2 -', '$a n\'est plus lue')
        el._set('b', 4)
        await attendre(() => txt() !== '2 20 2 2 -')
        assert.equal(txt(), '4 40 4 4 g')
      })

      it('clé qui ne nomme aucune variable déclarée : $[$i] = v, $i un nombre', async () => {
        const el = m.el
        assert.equal(q(el, '.i').textContent, '')
        el.ecrireI(9)
        await attendre(() => q(el, '.i').textContent === '9')
        assert.equal(q(el, '.i').textContent, '9')
      })

      it('valeur dérivée qui appelle une fonction ({await $user}, $user = charger($[$k])) : pas refaite à chaque écriture', async () => {
        const a = m.appel
        assert.equal(a.nb(), 1)
        for (let i = 1; i <= 5; i++) {
          a._set('z', i)
          await pause(10)
        }
        await attendre(() => q(a, '.z').textContent === '5')
        assert.equal(q(a, '.z').textContent, '5')
        assert.equal(a.nb(), 1, 'charger appelée à chaque écriture sans rapport')
        assert.equal(q(a, '.u').textContent, '1')
      })

      it('JavaScript : mêmes règles', async () => {
        const js  = m.js
        const txt = () => `${q(js, '.c').textContent} ${q(js, '.d').textContent}`
        assert.equal(txt(), '1 1')
        js._set('a', 3)
        await attendre(() => txt() !== '1 1')
        assert.equal(txt(), '3 3')
      })
    })
  }

  it('compilateur : la dépendance « toute écriture » ne touche ni les valeurs dérivées du runtime, ni un composant sans accès calculé', async () => {
    const avec = (await transpile(DYN, { moduleName: 'gabarit-cle' })).output
    assert.match(avec, /_mjs_effectsByVar = \{[^\n]*"\*": \[/)
    const cd = /this\._mjs_computedDeps = (\{[^\n]*\});/.exec(avec)
    assert.ok(cd, '_mjs_computedDeps émis')
    assert.ok(!cd[1].includes('*'), cd[1])
    const sans = (await transpile('<script>\n$a = 1\n$d = $a * 2\n</script>\n<p>{$d}</p>', { moduleName: 'gabarit-sans-cle' })).output
    assert.ok(!sans.includes('"*"'), 'aucune dépendance « toute écriture »')
    // `µderived` nomme les dépendances que l'affichage suit : la sienne ne reçoit pas « toute écriture »
    const nommees = (await transpile('<script>\n$a = 1\n$k = \'a\'\nµderived $v = $[$k], $a\n</script>\n<p>{$v}</p>', { moduleName: 'gabarit-cle-nommee' })).output
    assert.ok(!nommees.includes('"*"'), 'µderived : les dépendances nommées seulement')
    assert.match(nommees, /_mjs_effectsByVar = \{[^\n]*"a": \[/)
    // une valeur dérivée qui appelle une fonction, et celle qui la lit : leurs dépendances connues ; `{$cle}` seule reçoit `*`
    const chaine = (await transpile('<script module>\nfmt = (v) -> v\n</script>\n<script>\n$a = 1\n$k = \'a\'\n$cle = $[$k]\n$f = fmt($cle)\n$g = $f + 1\n</script>\n<p>{$cle}</p><p>{$f}</p><p>{$g}</p>', { moduleName: 'gabarit-cle-appel-compile' })).output
    assert.match(chaine, /"\*": \[_mjs_eff\[\d+\]\]/, 'une seule expression relancée à toute écriture')
  })
})
