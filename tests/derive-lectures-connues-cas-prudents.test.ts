// Une valeur dérivée dont une lecture échappe au texte de son expression reste juste quand on la relit : toute écriture
// du composant la périme, elle se recalcule à la lecture suivante :
//   - le parcours d'un objet de l'application (`[...$it]`, `Array.from($it)`) : son itérateur peut lire l'état ;
//   - un objet du `<script module>` que le `<script>` remplit (`Object.assign`, `push`) ;
//   - une variable ordinaire du `<script>` qu'une fonction change (`+=`, propriété écrite), suivie ou non de l'écriture
//     d'une variable `$` que la valeur lit ;
//   - une variable du `<script module>` que le module change lui-même (`Map` remplie par `set`).
// `µderived $v = expression, $a, $b` nomme les dépendances que l'affichage suit ; relue après l'écriture d'une autre
// variable, elle se recalcule une fois, comme toute valeur dérivée. Le compilateur ne marque aucune valeur dérivée,
// `µderived` comprise, et n'enveloppe aucun receveur. Civet, CoffeeScript et JavaScript ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const GABARIT = `<p class="t">{$total}</p><p class="a">{$autre}</p>
`

const CIVET = `<script module>
memo = new Map()
retenir = (k, v) -> memo.set(k, v)
lireCache = (c) -> c.v
lireChoix = (c, s) -> (c.x ?? 0) + s
</script>
<script>
$dict = {t: 'a'}
$n = 1
$autre = 0
$prix = 2
$qte = 3
$sel = 0
fabrique = -> ({[Symbol.iterator]: -> [$dict.t].values()})
$it = fabrique()
$etale = [...$it].join('') + $n
$tableau = Array.from($it).join('') + $n
compteur = 0
$parCompteur = compteur + $n
$parMemo = (memo.get('k') ?? 0) + $n
cache = {v: 1}
$parCache = lireCache(cache) + $n
choix = {}
$parChoix = lireChoix(choix, $sel) + $n
calculer = ->
  window.journal.push 'calc'
  $prix * $qte
µderived $total = calculer(), $prix, $qte
@lire = -> [$etale, $tableau, $parCompteur, $parMemo, $parCache, $parChoix].join(' ')
@ecrireDict = (v) -> $dict = {t: v}
@inc = ->
  compteur += 1
  $autre = 1
  return
@memoriser = (v) ->
  retenir('k', v)
  $autre = 2
  return
@changerCache = (v) ->
  cache.v = v
  $autre = 3
  return
@choisir = (v) ->
  choix.x = v
  $sel = v
  return
@ecrireAutre = (x) -> $autre = x
@ecrirePrix = (x) -> $prix = x
@lireTotal = -> $total
</script>
${GABARIT}`

const COFFEE = `<script module lang="coffee">
memo = new Map()
retenir = (k, v) -> memo.set(k, v)
lireCache = (c) -> c.v
lireChoix = (c, s) -> (c.x ? 0) + s
</script>
<script lang="coffee">
$dict = {t: 'a'}
$n = 1
$autre = 0
$prix = 2
$qte = 3
$sel = 0
fabrique = -> {[Symbol.iterator]: -> [$dict.t].values()}
$it = fabrique()
$etale = [...$it].join('') + $n
$tableau = Array.from($it).join('') + $n
compteur = 0
$parCompteur = compteur + $n
$parMemo = (memo.get('k') ? 0) + $n
cache = {v: 1}
$parCache = lireCache(cache) + $n
choix = {}
$parChoix = lireChoix(choix, $sel) + $n
calculer = ->
  window.journal.push 'calc'
  $prix * $qte
µderived $total = calculer(), $prix, $qte
@lire = -> [$etale, $tableau, $parCompteur, $parMemo, $parCache, $parChoix].join(' ')
@ecrireDict = (v) -> $dict = {t: v}
@inc = ->
  compteur += 1
  $autre = 1
  return
@memoriser = (v) ->
  retenir('k', v)
  $autre = 2
  return
@changerCache = (v) ->
  cache.v = v
  $autre = 3
  return
@choisir = (v) ->
  choix.x = v
  $sel = v
  return
@ecrireAutre = (x) -> $autre = x
@ecrirePrix = (x) -> $prix = x
@lireTotal = -> $total
</script>
${GABARIT}`

const JS = `<script module lang="js">
const memo = new Map()
function retenir(k, v) { memo.set(k, v) }
const lireCache = (c) => c.v
const lireChoix = (c, s) => (c.x ?? 0) + s
</script>
<script lang="js">
$dict = { t: 'a' }
$n = 1
$autre = 0
$prix = 2
$qte = 3
$sel = 0
const fabrique = () => ({ [Symbol.iterator]: () => [$dict.t].values() })
$it = fabrique()
$etale = [...$it].join('') + $n
$tableau = Array.from($it).join('') + $n
let compteur = 0
$parCompteur = compteur + $n
$parMemo = (memo.get('k') ?? 0) + $n
const cache = { v: 1 }
$parCache = lireCache(cache) + $n
const choix = {}
$parChoix = lireChoix(choix, $sel) + $n
const calculer = () => { window.journal.push('calc'); return $prix * $qte }
µderived $total = calculer(), $prix, $qte
@lire = function() { return [$etale, $tableau, $parCompteur, $parMemo, $parCache, $parChoix].join(' ') }
@ecrireDict = function(v) { $dict = { t: v } }
@inc = function() { compteur += 1; $autre = 1 }
@memoriser = function(v) { retenir('k', v); $autre = 2 }
@changerCache = function(v) { cache.v = v; $autre = 3 }
@choisir = function(v) { choix.x = v; $sel = v }
@ecrireAutre = function(x) { $autre = x }
@ecrirePrix = function(x) { $prix = x }
@lireTotal = function() { return $total }
</script>
${GABARIT}`

// un objet du `<script module>` rempli par le `<script>` : une fermeture qui lit l'état (`Object.assign`), un élément (`push`)
const OUTILS: [string, string][] = [
  ['Civet', `<script module>
outils = {}
etiquettes = []
</script>
<script>
$dict = {t: 'a'}
$n = 1
$autre = 0
Object.assign(outils, {lire: -> $dict.t})
$parOutil = outils.lire() + $n
$nb = etiquettes.length + $n
@ecrireDict = (v) -> $dict = {t: v}
@ajouter = ->
  etiquettes.push('x')
  $autre = 1
  return
@lire = -> [$parOutil, $nb].join(' ')
</script>
<p class="a">{$autre}</p>
`],
  ['CoffeeScript', `<script module lang="coffee">
outils = {}
etiquettes = []
</script>
<script lang="coffee">
$dict = {t: 'a'}
$n = 1
$autre = 0
Object.assign(outils, {lire: -> $dict.t})
$parOutil = outils.lire() + $n
$nb = etiquettes.length + $n
@ecrireDict = (v) -> $dict = {t: v}
@ajouter = ->
  etiquettes.push('x')
  $autre = 1
  return
@lire = -> [$parOutil, $nb].join(' ')
</script>
<p class="a">{$autre}</p>
`],
  ['JavaScript', `<script module lang="js">
const outils = {}
const etiquettes = []
</script>
<script lang="js">
$dict = { t: 'a' }
$n = 1
$autre = 0
Object.assign(outils, { lire: () => $dict.t })
$parOutil = outils.lire() + $n
$nb = etiquettes.length + $n
@ecrireDict = function(v) { $dict = { t: v } }
@ajouter = function() { etiquettes.push('x'); $autre = 1 }
@lire = function() { return [$parOutil, $nb].join(' ') }
</script>
<p class="a">{$autre}</p>
`],
]

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

async function monter(hote: string, prod: boolean) {
  const root   = mjsTmp('derive-prudent')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-prudent.mjs'), hote)
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
  window.journal = []
  window.eval(code)
  window.document.body.innerHTML = '<mjs-derive-prudent></mjs-derive-prudent>'
  const el = window.document.querySelector('mjs-derive-prudent')
  await attendre(() => el._shadow?.querySelector('.a')?.textContent != null)
  await pause(30)
  return { window, el }
}

const SOURCES: [string, string][] = [['Civet', CIVET], ['CoffeeScript', COFFEE], ['JavaScript', JS]]

describe('valeurs dérivées aux lectures connues : les lectures qui échappent à l\'analyse restent à jour', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [langue, source] of SOURCES) {
    for (const prod of [false, true]) {
      const mode = prod ? 'production' : 'développement'
      describe(`${langue}, ${mode}`, function () {
        let m: any
        before(async () => { m = await monter(source, prod) })
        const morceau = (i: number) => m.el.lire().split(' ')[i]

        it('au montage', () => {
          assert.equal(m.el.lire(), 'a1 a1 1 1 2 1')
        })

        it('parcours d\'un objet de l\'application (étalement, Array.from) : relu à jour', async () => {
          m.el.ecrireDict('b')
          await pause(20)
          assert.equal(morceau(0), 'b1')
          assert.equal(morceau(1), 'b1')
        })

        it('variable du <script> changée par += puis écriture sans rapport : relue à jour', async () => {
          m.el.inc()
          await pause(20)
          assert.equal(morceau(2), '2')
        })

        it('Map du <script module> remplie par une fonction du module : relue à jour', async () => {
          m.el.memoriser(5)
          await pause(20)
          assert.equal(morceau(3), '6')
        })

        it('objet du <script> dont une propriété change, puis écriture sans rapport : relu à jour', async () => {
          m.el.changerCache(7)
          await pause(20)
          assert.equal(morceau(4), '8')
        })

        it('objet du <script> changé puis variable lue écrite juste après : à jour', async () => {
          m.el.choisir(3)
          await pause(20)
          assert.equal(morceau(5), '7')
        })

        it('µderived : relue après trois écritures d\'une autre variable, elle se recalcule une fois ; une dépendance nommée relance son affichage', async () => {
          m.el.lireTotal()
          m.window.journal.length = 0
          for (const x of [11, 12, 13]) { m.el.ecrireAutre(x); await pause(10) }
          assert.deepEqual(m.window.journal, [], 'aucun calcul tant que personne ne la lit')
          assert.equal(m.el.lireTotal(), 6)
          assert.deepEqual(m.window.journal, ['calc'], 'relue, elle se recalcule une fois')
          m.window.journal.length = 0
          m.el.ecrirePrix(5)
          await pause(20)
          assert.equal(m.el._shadow.querySelector('.t')?.textContent, '15', 'l\'affichage suit $prix, dépendance nommée')
          assert.equal(m.el.lireTotal(), 15)
          assert.deepEqual(m.window.journal, ['calc'])
        })
      })
    }
  }

  for (const [langue, source] of OUTILS) {
    for (const prod of [false, true]) {
      it(`${langue}, ${prod ? 'production' : 'développement'} : objet du <script module> rempli par le <script> (Object.assign, push)`, async () => {
        const { el } = await monter(source, prod)
        assert.equal(el.lire(), 'a1 1')
        el.ecrireDict('b')
        await pause(20)
        assert.equal(el.lire().split(' ')[0], 'b1', 'méthode rangée par Object.assign')
        el.ajouter()
        await pause(20)
        assert.equal(el.lire().split(' ')[1], '2', 'élément ajouté par push')
      })
    }
  }
})

describe('compilateur : aucune valeur dérivée marquée, µderived comprise', function () {
  const sortie = async (script: string, lang = 'civet') => {
    const { output } = await transpile(`<script${lang === 'js' ? ' lang="js"' : ''}>\n${script}\n</script>\n<p>{$n}</p>`, { moduleName: 'derive-prudent' })
    const out: Record<string, string> = {}
    for (const l of output.split('\n')) {
      const r = /µ\._mjs_setComputed\(_mjsThis, '(\w+)', (.*)\);?$/.exec(l.trim())
      if (r) out[r[1]] = r[2]
    }
    return out
  }

  it('heure, hasard, date fixe, parcours, variable du <script> changée : ni marque ni receveur enveloppé', async () => {
    const lots = [
      await sortie(['$n = 1', '$heure = Date.now() + $n', '$hasard = Math.random() + $n', '$maintenant = new Date().getTime() + $n', '$jour = new Date(0).getTime() + $n', '$fixe = Date.UTC(2020, 0, 1) + $n'].join('\n')),
      await sortie(['$n = 1', '$l = [1, 2]', '$e = [...$l].length + $n', '$f = Array.from($l).length + $n', '$s = (() => { let s = 0; for (const x of $l) s += x; return s })() + $n', '$d = (() => { const [a, b] = $l; return a + b })() + $n', '$lit = [...[1, 2]].length + $n'].join('\n'), 'js'),
      await sortie(['$n = 1', '$sel = 0', '$autre = 0', 'choix = {}', 'cache = {}', 'compteur = 0', '$a = choix.x + $sel', '$b = cache.x + $n', '$c = compteur + $n', '@choisir = (v) ->', '  choix.x = v', '  $sel = v', '  return', '@vider = ->', '  cache.x = 1', '  $autre = 1', '  return', '@inc = ->', '  compteur++', '  $n = 2', '  return'].join('\n')),
    ]
    const noms = ['heure', 'hasard', 'maintenant', 'jour', 'fixe', 'e', 'f', 's', 'd', 'lit', 'a', 'b', 'c']
    const vues = Object.assign({}, ...lots)
    for (const k of noms) {
      assert.ok(vues[k], k)
      assert.doesNotMatch(vues[k], /_mjs_rcv|, 1$/, k)
    }
  })

  it('µderived : sa fonction telle quelle, sans marque', async () => {
    const out = await sortie(['$prix = 2', '$qte = 3', '$n = 1', 'calculer = -> $prix * $qte', 'µderived $total = calculer(), $prix, $qte', '$sans = calculer() + $n'].join('\n'))
    assert.match(out.total, /^\(\) => \(calculer\(\)\)$/)
    assert.doesNotMatch(out.sans, /, 1$/)
  })

  it('fonction du <script> ou du <script module> passée à map, filter, toSorted : sans marque', async () => {
    const { output } = await transpile(`<script module>\ndoubler = (x) -> x * 2\n</script>\n<script>\n$l = [3, 1, 2]\n$n = 1\nestPair = (x) -> x % 2 == 0\ncomparer = (a, b) -> a - b\n$a = $l.map(doubler).join(',') + $n\n$b = $l.filter(estPair).length + $n\n$c = $l.toSorted(comparer)[0] + $n\n</script>\n<p>{$a}{$b}{$c}</p>`, { moduleName: 'derive-rappel' })
    for (const k of ['a', 'b', 'c']) {
      assert.match(output, new RegExp(`_mjs_setComputed\\(_mjsThis, '${k}', `), k)
      assert.doesNotMatch(output, new RegExp(`_mjs_setComputed\\(_mjsThis, '${k}', .*, 1\\)`), k)
    }
  })
})
