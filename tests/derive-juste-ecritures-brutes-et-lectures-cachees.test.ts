// Valeurs dérivées justes quand on les relit après une écriture du composant, même quand l'écriture précédente a contourné
// la réactivité ou que la valeur lit en cachette ce qu'aucune écriture ne change : écritures brutes (`µread($x) += 1`,
// `µread($x)++`, `@_state.x = v`, une fonction du `<script module>` qui reçoit `$` ou le composant, un gestionnaire du
// gabarit qui écrit par `µread`), `Object.assign $, …` suivi de l'écriture qui ouvre une branche du gabarit, donnée posée par
// l'application sur un prototype natif ou atteinte par `.constructor`, `RegExp.lastMatch`, objet de l'état converti par sa
// propre méthode (`toString`, `valueOf`) qui lit une variable du module, chaîne de 40 valeurs dérivées, variable dérivée
// réécrite, prop passée par le parent. Civet et JavaScript ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const BRUTES = `<script module>
remplirMod = (o, v) -> Object.assign o, v
ecrireEl = (el, v) -> el._state.prix = v
</script>
<script>
$prix = 100
$qte = 1
$z = 0
$charge = false
$total = $prix * $qte
@lire = -> $total
@aideMod = -> remplirMod $, {prix: 250, qte: 2}
@assignCivet = -> Object.assign $, {prix: 300, qte: 3}
@assignCharge = ->
  Object.assign $, {prix: 250, qte: 2}
  $charge = true
@lectureEcrite = -> µread($prix) += 1
@lectureIncr = -> µread($prix)++
@etatBrut = -> @_state.prix = 9
@aideEl = -> ecrireEl @, 7
@autre = -> $z += 1
@remettre = ->
  $prix = 100
  $qte = 1
  $charge = false
</script>
<p class="t">{$total}</p>
{if $charge}<p class="c">{$total}</p>{end}
<button class="g" @click={µread($qte) += 1}>g</button>
`

const BRUTES_JS = `<script lang="js">
$prix = 100;
$qte = 1;
$z = 0;
$total = $prix * $qte;
@lire = function() { return $total; };
@lectureEcrite = function() { µread($prix) += 1; };
@etatBrut = function() { this._state.prix = 9; };
@aide = function() { const f = (el) => { el._state.prix = 7; }; f(this); };
@autre = function() { $z += 1; };
@remettre = function() { $prix = 100; $qte = 1; };
</script>
<p class="t">{$total}</p>
`

// donnée posée par l'application sur un natif, lue comme un membre ; dernière correspondance d'une expression régulière
const NATIFS = `<script module>
Number.prototype.tauxMjsV = 1
String.prototype.sepMjsV = ','
Number.reglageMjsV = 1
changer = (v) ->
  Number.prototype.tauxMjsV = v
  String.prototype.sepMjsV = ';'
  Number.reglageMjsV = v
</script>
<script>
$montant = 10
$mot = 'a'
$z = 0
$proto = $montant * $montant.tauxMjsV
$sep = $mot + $mot.sepMjsV
$ctor = $montant * $montant.constructor.reglageMjsV
$zero = $montant * (0).constructor.reglageMjsV
$dernier = /q/.constructor.lastMatch + $mot
@maj = (v) ->
  changer(v)
  $z += 1
@autre = -> $z += 1
</script>
<p>{$z}</p>
`

// valeurs dérivées qui ne lisent que des variables de l'état, par des opérateurs : un objet de l'état converti par sa propre
// méthode, une chaîne de 40, une valeur dérivée réécrite
const FERMEES = `<script module>
TEXTE = {v: 1}
changerTexte = -> TEXTE.v = 2
compte = {n: 1}
class Prix {
  constructor(v) { this.v = v }
  valueOf() { return this.v * compte.n }
}
</script>
<script>
$a = 1
$b = 2
$z = 0
$t = {toString: -> 's' + TEXTE.v}
$p = new Prix(10)
$somme = $a + $b
$double = $somme * 2
$conv = "#{$t}"
$valeur = $p * 1
$c0 = $a + 1
${Array.from({ length: 39 }, (_, i) => `$c${i + 1} = $c${i} + 1`).join('\n')}
@texte = ->
  changerTexte()
  $z += 1
@prixMod = ->
  compte.n = 3
  $z += 1
@ecrireA = (v) -> $a = v
@ecrireB = (v) -> $b = v
@ecrireSomme = (v) -> $somme = v
@autre = -> $z += 1
</script>
<p class="d">{$double}</p>
`

const PARENT = `<script>
$pn = 2
@ecrirePn = (v) -> $pn = v
</script>
<mjs-derive-fermee-enfant n={$pn}></mjs-derive-fermee-enfant>
`

const ENFANT = `<script>
$n = 0
$z = 0
$dn = $n * 2
@autre = -> $z += 1
</script>
<p class="n">{$dn}</p>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

async function monter(prod: boolean) {
  const root   = mjsTmp('derive-brutes')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-brutes.mjs'), BRUTES)
  writeFileSync(join(srcDir, 'derive-brutes-js.mjs'), BRUTES_JS)
  writeFileSync(join(srcDir, 'derive-natifs-membres.mjs'), NATIFS)
  writeFileSync(join(srcDir, 'derive-fermees.mjs'), FERMEES)
  writeFileSync(join(srcDir, 'derive-fermee-parent.mjs'), PARENT)
  writeFileSync(join(srcDir, 'derive-fermee-enfant.mjs'), ENFANT)
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
  const doc = window.document
  doc.body.innerHTML = '<mjs-derive-brutes></mjs-derive-brutes><mjs-derive-brutes-js></mjs-derive-brutes-js><mjs-derive-natifs-membres></mjs-derive-natifs-membres><mjs-derive-fermees></mjs-derive-fermees><mjs-derive-fermee-parent></mjs-derive-fermee-parent>'
  const brutes = doc.querySelector('mjs-derive-brutes')
  const js     = doc.querySelector('mjs-derive-brutes-js')
  const natifs = doc.querySelector('mjs-derive-natifs-membres')
  const fer    = doc.querySelector('mjs-derive-fermees')
  const parent = doc.querySelector('mjs-derive-fermee-parent')
  await attendre(() => [brutes, js, natifs, fer, parent].every((e) => !!e._shadow) && !!parent._shadow.querySelector('mjs-derive-fermee-enfant')?._shadow)
  const enfant = parent._shadow.querySelector('mjs-derive-fermee-enfant')
  await attendre(() => texte(brutes, '.t') === '100' && texte(fer, '.d') === '6' && texte(enfant, '.n') === '4')
  return { window, brutes, js, natifs, fer, parent, enfant }
}

const lire  = (el: any, nom: string) => el._state[nom]
const texte = (el: any, c: string) => el._shadow?.querySelector(c)?.textContent

describe('valeurs dérivées : justes après une écriture brute ou une lecture cachée', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let m: any
      before(async () => { m = await monter(prod) })

      // la valeur lue avant (mémorisée), l'écriture brute, une écriture sans rapport, puis la valeur relue
      const formes: [string, string, number][] = [
        ['fonction du <script module> qui reçoit $', 'aideMod', 500],
        ['Object.assign $, … (Civet)', 'assignCivet', 900],
        ['µread($prix) += 1', 'lectureEcrite', 101],
        ['µread($prix)++', 'lectureIncr', 101],
        ['@_state.prix = v', 'etatBrut', 9],
        ['fonction du <script module> qui reçoit le composant', 'aideEl', 7]
      ]
      for (const [titre, geste, attendu] of formes) {
        it(`Civet, ${titre} : la valeur dérivée relue après une écriture sans rapport`, () => {
          const b = m.brutes
          b.remettre()
          assert.equal(b.lire(), 100)
          b[geste]()
          b.autre()
          assert.equal(b.lire(), attendu)
          assert.equal(lire(b, 'total'), attendu)
        })
      }

      it('Civet, gestionnaire du gabarit qui écrit par µread($qte) += 1', () => {
        const b = m.brutes
        b.remettre()
        assert.equal(b.lire(), 100)
        b._shadow.querySelector('.g').dispatchEvent(new m.window.Event('click', { bubbles: true, composed: true }))
        b.autre()
        assert.equal(b.lire(), 200)
      })

      it('Civet, Object.assign $, … puis l\'écriture qui ouvre une branche : la branche affiche la valeur juste', async () => {
        const b = m.brutes
        b.remettre()
        assert.equal(b.lire(), 100)
        await attendre(() => !b._shadow.querySelector('.c'))
        assertAbsent(b._shadow.querySelector('.c'))
        b.assignCharge()
        await attendre(() => texte(b, '.c') === '500')
        assert.equal(texte(b, '.c'), '500')
        assert.equal(texte(b, '.t'), '500')
      })

      for (const [titre, geste, attendu] of [['µread($prix) += 1', 'lectureEcrite', 101], ['this._state.prix = v', 'etatBrut', 9], ['fonction qui reçoit le composant', 'aide', 7]] as [string, string, number][]) {
        it(`JavaScript, ${titre} : la valeur dérivée relue après une écriture sans rapport`, () => {
          const j = m.js
          j.remettre()
          assert.equal(j.lire(), 100)
          j[geste]()
          j.autre()
          assert.equal(j.lire(), attendu)
        })
      }

      it('donnée posée sur un prototype natif, membre atteint par .constructor : la valeur suit le changement', () => {
        const n = m.natifs
        assert.deepEqual(['proto', 'sep', 'ctor', 'zero'].map((k) => lire(n, k)), [10, 'a,', 10, 10])
        n.maj(3)
        assert.deepEqual(['proto', 'sep', 'ctor', 'zero'].map((k) => lire(n, k)), [30, 'a;', 30, 30])
      })

      it('dernière correspondance d\'une expression régulière (RegExp.lastMatch) : relue après une écriture sans rapport', () => {
        const n = m.natifs
        m.window.eval("/q+/.exec('aqb')")
        const avant = lire(n, 'dernier')
        assert.equal(avant, m.window.eval('RegExp.lastMatch') + 'a')
        m.window.eval("/zz+/.exec('azzzb')")
        n.autre()
        const apres = lire(n, 'dernier')
        assert.equal(apres, m.window.eval('RegExp.lastMatch') + 'a')
        assert.equal(apres, 'zzza')
      })

      it('objet de l\'état converti par sa méthode qui lit le module (toString, valueOf) : la valeur suit', () => {
        const f = m.fer
        assert.equal(lire(f, 'conv'), 's1')
        assert.equal(lire(f, 'valeur'), 10)
        f.texte()
        assert.equal(lire(f, 'conv'), 's2')
        f.prixMod()
        assert.equal(lire(f, 'valeur'), 30)
      })

      it('valeurs dérivées qui ne lisent que l\'état : écriture lue, écriture sans rapport, chaîne de 40, valeur dérivée réécrite', async () => {
        const f = m.fer
        assert.deepEqual([lire(f, 'somme'), lire(f, 'double'), lire(f, 'c39')], [3, 6, 41])
        f.autre()
        assert.deepEqual([lire(f, 'somme'), lire(f, 'double'), lire(f, 'c39')], [3, 6, 41])
        f.ecrireA(10)
        assert.deepEqual([lire(f, 'somme'), lire(f, 'double'), lire(f, 'c39'), lire(f, 'c0')], [12, 24, 50, 11])
        f.autre()
        assert.deepEqual([lire(f, 'somme'), lire(f, 'double'), lire(f, 'c39')], [12, 24, 50])
        f.ecrireB(5)
        assert.deepEqual([lire(f, 'somme'), lire(f, 'double'), lire(f, 'c39')], [15, 30, 50])
        await attendre(() => texte(f, '.d') === '30')
        assert.equal(texte(f, '.d'), '30')
        f.ecrireSomme(4)
        assert.equal(lire(f, 'double'), 8)
        f.ecrireA(1)
        assert.deepEqual([lire(f, 'somme'), lire(f, 'double'), lire(f, 'c39')], [4, 8, 41])
        await attendre(() => texte(f, '.d') === '8')
        assert.equal(texte(f, '.d'), '8')
      })

      it('prop passée par le parent : la valeur dérivée de l\'enfant suit, l\'écran aussi', async () => {
        const e = m.enfant
        assert.equal(lire(e, 'dn'), 4)
        m.parent.ecrirePn(5)
        await attendre(() => texte(e, '.n') === '10')
        assert.equal(lire(e, 'dn'), 10)
        e.autre()
        assert.equal(lire(e, 'dn'), 10)
        assert.equal(texte(e, '.n'), '10')
      })

      after(() => {
        const w = m?.window
        if (!w) return
        delete w.Number.prototype.tauxMjsV
        delete w.String.prototype.sepMjsV
        delete w.Number.reglageMjsV
      })
    })
  }
})
