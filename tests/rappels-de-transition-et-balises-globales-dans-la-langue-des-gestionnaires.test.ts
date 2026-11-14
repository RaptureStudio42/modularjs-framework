// un rappel de transition (`@introstart`, `@introend`, `@outrostart`, `@outroend`) s'écrit dans la langue des gestionnaires et se compile
// comme eux : Civet par défaut (`t := $o`, `if` en fin de ligne, plusieurs lignes), CoffeeScript quand le projet règle les gestionnaires
// en `js`, quelle que soit la langue du script ; la sortie est du JavaScript lisible, avec et sans le réglage `proxy: false`. Un rappel
// qui déclare le nom de la variable du `{for}` qui l'entoure (variable locale, paramètre) n'écrit pas l'élément : aucun avertissement
// pour lui, l'élément vraiment écrit reste signalé. Les gestionnaires et liaisons de `<@window>`, `<@document>` et `<@body>` d'un
// composant au script JavaScript ou TypeScript se compilent eux aussi dans la langue des gestionnaires. Dans le fichier d'un magasin,
// `µ$c++`, `µ$c--`, `++µ$c` remplaceraient l'objet du magasin : refusés comme `µ$c = …` ; un champ (`µ$c.n++`) reste permis

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'
import { applyMjsSugarToScript } from '../src/transpiler/sugar.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const RAPPELS_CIVET = `<script>
$o = { c: 0 }
$v = true
</script>
{if $v}
  <p :transition=*fade @introend={t := $o; t.c = 3} @outroend={
    u := $o
    u.c = 4 if $v
  }>x</p>
{end}
{for x in [{ n: 1 }]}<p :transition=*fade @introstart={w := x; w.n++}>{x.n}</p>{end}
<p>{$o.c}</p>
`

const RAPPELS_SCRIPT_JS = `<script lang="js">
$o = { c: 0 };
</script>
<p :transition=*fade @introend={t := $o; t.c = 3 if t.c == 0}>x</p>
`

const MASQUES = `<script>
$l = [{ n: 0 }]
</script>
{for x in $l}<p :transition=*fade @introend={x := { n: 0 }; x.n = 1}>{x.n}</p>{end}
{for x in $l}<p :transition=*fade @introstart={[{ n: 1 }].forEach((x) => x.n++)}>{x.n}</p>{end}
{for x in $l}<p :transition=*fade @outroend={x.n++}>{x.n}</p>{end}
`

const GLOBALES_JS = `<script lang="js">
let fois = 0;
$n = 0;
$y = 0;
function compter(e) { fois++; }
</script>
<@window @resize={$n++} @keydown=compter scrollY=!{$y} />
<@document @click={fois = 2} />
<@body @keyup={
  $n = 5 if fois
} />
<p>{$n} {$y}</p>
`

const GLOBALES_TS = `<script lang="ts">
let fois: number = 0;
$n = 0;
</script>
<@window @resize={$n++} />
<@document @keydown={fois = 2} />
<@body @click={$n = 3} />
<p>{$n}</p>
`

const net     = (a: unknown) => String(a).replace(/\x1b\[[0-9;]*m/g, '')
const ligne   = (source: string, marque: string) => source.split('\n').findIndex((l) => l.includes(marque)) + 1
const lisible = (sortie: string) => acorn.parse(sortie.replace(/µ\.asset\(('[^']+')\)/g, '$1'), { ecmaVersion: 'latest', sourceType: 'module' })
const rappels = (sortie: string) => (sortie.match(/_mjs_cb_\w+ = \(\) => \{[^\n]*/g) ?? []).join('\n')

async function compiler(source: string, nom: string, opts: Record<string, unknown> = {}) {
  const r: any = await transpile(source, { moduleName: nom, ...opts } as any)
  return { sortie: String(r.output), avis: (r.data?.sectionWarnings ?? []).map(net).filter((a: string) => a.includes('µrefresh')) as string[] }
}

describe('rappels de transition et balises globales : compilés dans la langue des gestionnaires', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  for (const [reglage, opts] of [['défaut', {}], ['proxy: false', { proxy: false }]] as const) {
    it(`rappel écrit en Civet (\`:=\`, \`if\` en fin de ligne, plusieurs lignes, dans un {for}) : JavaScript lisible (${reglage})`, async () => {
      const { sortie } = await compiler(RAPPELS_CIVET, 'rappelsCivet', opts)
      assert.doesNotThrow(() => lisible(sortie), rappels(sortie))
      assert.ok(!rappels(sortie).includes(':='), rappels(sortie))
      assert.match(sortie, /_mjs_cb_introend = \(\) => \{/)
      assert.match(sortie, /_mjs_cb_outroend = \(\) => \{/)
      assert.match(sortie, /_mjs_cb_introstart = \(\) => \{/)
    })

    it(`script en JavaScript, rappel en Civet : compilé comme ses gestionnaires (${reglage})`, async () => {
      const { sortie } = await compiler(RAPPELS_SCRIPT_JS, 'rappelsScriptJs', opts)
      assert.doesNotThrow(() => lisible(sortie), rappels(sortie))
    })

  }

  it('variable du {for} masquée par une variable locale ou un paramètre du rappel : aucun avertissement ; l\'élément écrit reste signalé', async () => {
    const { avis } = await compiler(MASQUES, 'masques', { proxy: false })
    const surL = (marque: string) => avis.filter((a) => a.includes(`ligne ${ligne(MASQUES, marque)} :`) && a.includes('qui tient une partie de `$l`'))
    assert.deepEqual(surL('x := { n: 0 }'), [], JSON.stringify(avis))
    assert.deepEqual(surL('forEach((x)'), [], JSON.stringify(avis))
    assert.equal(surL('@outroend={x.n++}').length, 1, JSON.stringify(avis))
    assert.ok(surL('@outroend={x.n++}')[0].includes('écriture par `x`'), JSON.stringify(avis))
  })

  for (const [nom, source, opts] of [['script JavaScript', GLOBALES_JS, {}], ['script TypeScript', GLOBALES_TS, {}]] as const) {
    it(`<@window>, <@document>, <@body> d'un ${nom} : construit, écouteurs posés, la variable du script écrite (pas une copie locale)`, async () => {
      const { sortie } = await compiler(source, 'globales', opts)
      assert.doesNotThrow(() => lisible(sortie))
      for (const ev of ['resize', 'keydown', 'click']) assert.ok(sortie.includes(`addEventListener('${ev}'`), ev)
      assert.equal((sortie.match(/\b(?:let|var|const) fois\b/g) ?? []).length, 1, 'une seule déclaration de `fois` : celle du script')
    })
  }

  for (const [cas, corps] of [['µ$c++', 'window.__f = -> µ$c++'], ['µ$c--', 'window.__f = -> µ$c--'], ['++µ$c', 'window.__f = -> ++µ$c'], ['µ$$c++', 'window.__f = -> µ$$c++'], ['µ$c ++ seul sur sa ligne', 'window.__f = ->\n  µ$c ++']] as const) {
    it(`fichier d'un magasin : ${cas} refusé, avec sa ligne`, () => {
      assert.throws(() => applyMjsSugarToScript(`export µ$$c = { p: 1 }\n${corps}\n`, 'civet'), (e: any) => {
        const m = net(e.message)
        assert.ok(m.includes('« µ$$c »') && m.includes('µ$c.cle = valeur'), m)
        assert.ok(m.includes(`ligne ${corps.includes('\n') ? 3 : 2} :`), m)
        return true
      })
    })
  }

  it('fichier d\'un magasin : un champ incrémenté (`µ$c.n++`, `++µ$c.n`, `µ$$c.p--`, `µ$c[k]++`) reste permis', () => {
    assert.doesNotThrow(() => applyMjsSugarToScript('export µ$$c = { p: 1, n: 0 }\nwindow.__f = -> µ$c.n++\nwindow.__g = -> ++µ$c.n\nwindow.__h = -> µ$$c.p--\nwindow.__i = (k) -> µ$c[k]++\n', 'civet'))
  })
})
