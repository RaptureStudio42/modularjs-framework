// Toute écriture du composant périme toutes ses valeurs dérivées : relue ensuite, chacune se recalcule une fois, puis
// sert sa valeur en mémoire jusqu'à la prochaine écriture. Une liaison du gabarit ne se relance qu'avec les variables
// qu'elle lit, directement ou à travers une valeur dérivée. Les valeurs relues sont justes, qu'elles lisent l'état en
// toutes lettres ou à travers une fonction du `<script>`, une fermeture, une méthode, un accès calculé, une autre valeur
// dérivée, le magasin `$$`, un chemin profond ou une prop. Le compilateur ne marque aucune valeur dérivée : le recalcul
// ciblé (seules les valeurs qui lisent la variable écrite périmées) dort, son analyse ne voyait pas toutes les lectures
// cachées. Civet, CoffeeScript et JavaScript ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const GABARIT = `
<p class="l">{compte('lien', $lourd)}</p>
<p class="m">{$double + $b}</p>
`

const CIVET = `<script module>
compte = (nom, v) ->
  window.comptes[nom] = (window.comptes[nom] ?? 0) + 1
  v
</script>
<script>
$a = 1
$b = 1
$x = 1
$y = 1
$k = 'x'
$p = 0
$o = {a: {b: 1}}
$$s = 1
lit = -> $x * 2
fois = (v) -> v * $x
$lourd = compte 'lourd', $a * 10
$double = compte 'double', $lourd * 2
$chemin = compte 'chemin', $o.a.b * 2
$base = compte 'base', $x + 1
$viaDerive = compte 'viaDerive', $base * 2
$viaFonction = compte 'viaFonction', lit() + $y
$viaFermeture = compte 'viaFermeture', [$y].map(fois)[0]
$viaMethode = compte 'viaMethode', @lire() + $y
$viaCle = compte 'viaCle', $[$k] + $y
$viaMagasin = compte 'viaMagasin', $$s * 2
$viaProp = compte 'viaProp', $p + 1
$viaInstable = compte 'viaInstable', $viaFonction + $y
@lire = -> $x
@ecrireA = (v) -> $a = v
@ecrireB = (v) -> $b = v
@ecrireX = (v) -> $x = v
@ecrireS = (v) -> $$s = v
@ecrireChemin = (v) -> $o.a.b = v
@boucleX = (n) ->
  for i of [1..n]
    $x = i
</script>
${GABARIT}`

const COFFEE = `<script module lang="coffee">
compte = (nom, v) ->
  window.comptes[nom] = (window.comptes[nom] or 0) + 1
  v
</script>
<script lang="coffee">
$a = 1
$b = 1
$x = 1
$y = 1
$k = 'x'
$p = 0
$o = {a: {b: 1}}
$$s = 1
lit = -> $x * 2
fois = (v) -> v * $x
$lourd = compte('lourd', $a * 10)
$double = compte('double', $lourd * 2)
$chemin = compte('chemin', $o.a.b * 2)
$base = compte('base', $x + 1)
$viaDerive = compte('viaDerive', $base * 2)
$viaFonction = compte('viaFonction', lit() + $y)
$viaFermeture = compte('viaFermeture', [$y].map(fois)[0])
$viaMethode = compte('viaMethode', @lire() + $y)
$viaCle = compte('viaCle', $[$k] + $y)
$viaMagasin = compte('viaMagasin', $$s * 2)
$viaProp = compte('viaProp', $p + 1)
$viaInstable = compte('viaInstable', $viaFonction + $y)
@lire = -> $x
@ecrireA = (v) -> $a = v
@ecrireB = (v) -> $b = v
@ecrireX = (v) -> $x = v
@ecrireS = (v) -> $$s = v
@ecrireChemin = (v) -> $o.a.b = v
@boucleX = (n) ->
  for i in [1..n]
    $x = i
  return
</script>
${GABARIT}`

const JS = `<script module lang="js">
function compte(nom, v) {
  window.comptes[nom] = (window.comptes[nom] || 0) + 1
  return v
}
</script>
<script lang="js">
$a = 1
$b = 1
$x = 1
$y = 1
$k = 'x'
$p = 0
$o = { a: { b: 1 } }
$$s = 1
const lit = () => $x * 2
const fois = (v) => v * $x
$lourd = compte('lourd', $a * 10)
$double = compte('double', $lourd * 2)
$chemin = compte('chemin', $o.a.b * 2)
$base = compte('base', $x + 1)
$viaDerive = compte('viaDerive', $base * 2)
$viaFonction = compte('viaFonction', lit() + $y)
$viaFermeture = compte('viaFermeture', [$y].map(fois)[0])
$viaMethode = compte('viaMethode', this.lire() + $y)
$viaCle = compte('viaCle', $[$k] + $y)
$viaMagasin = compte('viaMagasin', $$s * 2)
$viaProp = compte('viaProp', $p + 1)
$viaInstable = compte('viaInstable', $viaFonction + $y)
@lire = function() { return $x }
@ecrireA = function(v) { $a = v }
@ecrireB = function(v) { $b = v }
@ecrireX = function(v) { $x = v }
@ecrireS = function(v) { $$s = v }
@ecrireChemin = function(v) { $o.a.b = v }
@boucleX = function(n) { for (let i = 1; i <= n; i++) { $x = i } }
</script>
${GABARIT}`

const PARENT = `<script>
$v = 0
@ecrireV = (v) -> $v = v
</script>
<mjs-derive-hote p={$v}></mjs-derive-hote>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(hote: string, prod: boolean) {
  const root   = mjsTmp('derive-perime')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-hote.mjs'), hote)
  writeFileSync(join(srcDir, 'derive-parent.mjs'), PARENT)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  // production : un seul fichier, `bundle.js`
  const code  = prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.comptes = {}
  window.eval(code)
  window.document.body.innerHTML = '<mjs-derive-parent></mjs-derive-parent>'
  const parent = window.document.querySelector('mjs-derive-parent')
  await attendre(() => !!parent._shadow && !!parent._shadow.querySelector('mjs-derive-hote')?._shadow)
  const el = parent._shadow.querySelector('mjs-derive-hote')
  await attendre(() => el._shadow.querySelector('.m')?.textContent === '3')
  await pause(30)
  return { window, parent, el }
}

const SOURCES: [string, string][] = [['Civet', CIVET], ['CoffeeScript', COFFEE], ['JavaScript', JS]]

describe('valeurs dérivées : toute écriture les périme, chacune se recalcule quand on la relit', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [langue, source] of SOURCES) {
    for (const prod of [false, true]) {
      const mode = prod ? 'production' : 'développement'
      describe(`${langue}, ${mode}`, function () {
        let m: any
        before(async () => { m = await monter(source, prod) })
        const lire = (nom: string) => m.el._state[nom]
        const vus  = (nom: string) => m.window.comptes[nom] ?? 0
        const texte = (c: string) => m.el._shadow.querySelector(c).textContent

        it('une écriture de $b périme aussi $lourd et $double : relues, elles se recalculent une fois ; la liaison qui ne lit que $lourd ne se relance pas', async () => {
          for (const n of ['lourd', 'double', 'chemin', 'base', 'viaDerive', 'viaMagasin', 'viaProp']) lire(n)
          m.window.comptes = {}
          m.el.ecrireB(2)
          await pause(20)
          assert.equal(texte('.m'), '22', 'la liaison qui lit $b est à jour')
          assert.equal(lire('lourd'), 10)
          assert.equal(lire('double'), 20)
          assert.equal(lire('chemin'), 2)
          assert.equal(lire('viaDerive'), 4)
          assert.deepEqual({ lourd: vus('lourd'), double: vus('double'), chemin: vus('chemin'), base: vus('base'), viaDerive: vus('viaDerive'), viaMagasin: vus('viaMagasin'), viaProp: vus('viaProp') }, { lourd: 1, double: 1, chemin: 1, base: 1, viaDerive: 1, viaMagasin: 0, viaProp: 0 }, 'chaque valeur relue se recalcule une fois, les autres attendent leur lecture')
          assert.equal(vus('lien'), 0, 'la liaison qui ne lit que $lourd ne s\'est pas relancée')
        })

        it('une écriture de $a recalcule $lourd et $double une fois chacun, et leurs liaisons', async () => {
          m.window.comptes = {}
          m.el.ecrireA(3)
          await pause(20)
          assert.equal(texte('.l'), '30')
          assert.equal(texte('.m'), '62')
          assert.equal(lire('lourd'), 30)
          assert.equal(lire('double'), 60)
          assert.equal(vus('lourd'), 1)
          assert.equal(vus('double'), 1)
          assert.equal(vus('lien'), 1)
        })

        it('garde : lue à travers une fonction du <script>, une fermeture, une méthode, un accès calculé, une autre valeur dérivée', async () => {
          for (const n of ['viaFonction', 'viaFermeture', 'viaMethode', 'viaCle', 'viaDerive', 'viaInstable']) lire(n)
          m.el.ecrireX(5)
          await pause(20)
          assert.equal(lire('viaFonction'), 11, 'fonction du <script> qui lit $x')
          assert.equal(lire('viaFermeture'), 5, 'fermeture du <script> passée à map')
          assert.equal(lire('viaMethode'), 6, 'méthode du composant qui lit $x')
          assert.equal(lire('viaCle'), 6, 'accès calculé $[$k]')
          assert.equal(lire('viaDerive'), 12, 'à travers $base')
          assert.equal(lire('viaInstable'), 12, 'à travers une valeur dérivée aux lectures inconnues')
        })

        it('garde : écritures dans une boucle, puis lecture', async () => {
          m.el.boucleX(3)
          assert.equal(lire('viaDerive'), 8)
          assert.equal(lire('viaFonction'), 7)
          assert.equal(lire('viaMethode'), 4)
        })

        it('garde : magasin $$, chemin profond, prop reçue du parent', async () => {
          for (const n of ['viaMagasin', 'chemin', 'viaProp']) lire(n)
          m.el.ecrireS(4)
          m.el.ecrireChemin(6)
          m.parent.ecrireV(9)
          await pause(30)
          assert.equal(lire('viaMagasin'), 8, 'magasin $$s')
          assert.equal(lire('chemin'), 12, 'chemin profond $o.a.b')
          assert.equal(lire('viaProp'), 10, 'prop p reçue du parent')
        })
      })
    }
  }
})

describe('compilateur : aucune valeur dérivée n\'est marquée « lectures connues »', function () {
  const marquees = async (script: string, module = '') => {
    const src = `${module ? `<script module>\n${module}\n</script>\n` : ''}<script>\n${script}\n</script>\n<p>{$a}</p>`
    const { output } = await transpile(src, { moduleName: 'derive-marques' })
    const out: Record<string, boolean> = {}
    // une instruction par ligne, point-virgule final selon le langage
    for (const l of output.split('\n')) {
      const r = /µ\._mjs_setComputed\(_mjsThis, '(\w+)', (.*)\);?$/.exec(l)
      if (r) out[r[1]] = /, 1$/.test(r[2])
    }
    return out
  }

  it('même celles qui ne lisent que l\'état, le magasin, Math, des tableaux, des chaînes, une fonction du <script module>, une donnée du <script> ou une autre valeur dérivée', async () => {
    const out = await marquees([
      '$a = 1', '$l = [1, 2]', 'reglage = {n: 2}',
      '$somme = $a + 1', '$magasin = $$m * 2', '$borne = Math.max($a, 3)', '$liste = $l.filter((v) -> v > $a).map((v) -> String(v)).join(\',\')',
      '$mod = fmt($a, reglage)', '$chaine = $somme * 2', '$temp = if $a in [1, 2] then 1 else 0',
    ].join('\n'), 'fmt = (v, r) -> v * r.n')
    assert.deepEqual(out, { somme: false, magasin: false, borne: false, liste: false, mod: false, chaine: false, temp: false })
  })

  it('inconnues : fonction du <script>, fermeture, méthode, @@, accès calculé, rune, méthode inconnue, définie deux fois, lue par une autre', async () => {
    const out = await marquees([
      '$a = 1', 'f = -> $a', 'g = (v) -> v * $a', 'obj = {m: -> 1}',
      '$fn = f() + $a', '$fer = [$a].map(g)', '$meth = @m() + $a', '$deux = @@m() + $a', '$cle = $[$a] + $a',
      '$rune = µread($a) + $a', '$inc = obj.m() + $a', '$doubl = $a + 1', '$doubl = $a + 2', '$suit = $fn + 1', '$fen = window.x + $a',
    ].join('\n'))
    assert.deepEqual(out, { fn: false, fer: false, meth: false, deux: false, cle: false, rune: false, inc: false, doubl: false, suit: false, fen: false })
  })
})
