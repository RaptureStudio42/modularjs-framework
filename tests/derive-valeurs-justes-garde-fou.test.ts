// Garde-fou de justesse des valeurs dérivées : relue après une écriture du composant, une valeur dérivée rend toujours la
// bonne valeur — variables `$` lues, branche lue, accès calculé `$[$k]`, liste lue, lectures cachées (fonction, objet,
// classe, date, alias, conversion en texte d'un objet de l'état, heure, hasard), objet partagé entre instances ou passé
// par le parent, méthode ou membre que l'application ajoute à un natif, chaîne de valeurs dérivées, `µwrite` suivi d'une
// écriture, clé calculée numérique. Ce que le gabarit affiche d'une valeur dérivée qui lit `$[$k]` suit la variable que
// `$k` nomme. Civet et JavaScript ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SUIVI = `<script>
$a = 1
$b = 1
$c = true
$k = 'a'
$z = 0
$l = [1, 2]
$double = [$a * 2]
$base = $a + 1
$chaine = [$base * 2]
$choix = [$c ? $a : $b]
$cle = [$[$k]]
$texte = "a=#{$a}"
$borne = [Math.max($a, $b)]
$filtre = [[1, 2, 3].filter((v) -> v > $a).length]
$liste = [$l.length]
$inconnu = $l.length
$surInconnu = [$inconnu + 1]
@pousser = (v) -> $l.push v
</script>
<p class="d">{$double[0]}</p><p class="t">{$texte}</p>
`

const SUIVI_JS = `<script lang="js">
$a = 1
$b = 1
$k = 'a'
$z = 0
const lignes = [{ n: 1 }, { n: 2 }]
$double = [$a * 2]
$base = $a + 1
$chaine = [$base * 2]
$cle = [$[$k]]
$forOf = lignes.reduce((s, l) => s + l.n, 0) + $a
@agirForOf = function() { for (const l of lignes) l.n *= 10 }
@autre = function() { $z += 1 }
</script>
<p class="d">{$double[0]}</p>
`

const REPLI = `<script module>
class Compteur {
  n = 0
  incr() { this.n++ }
}
tirage = -> Math.random()
maintenant = -> Date.now()
incr = (s) -> s.n++
liste = []
remplir = (l, x) -> l.push x
STATS = {n: 0}
alias = STATS
changerAlias = -> alias.n++
PARTAGE = {n: 1}
TEXTE = {v: 1}
changerTexte = -> TEXTE.v = 2
</script>
<script>
$a = 0
$z = 0
lignesA = [{n: 1}, {n: 2}]
lignesB = [{n: 1}, {n: 2}]
lignesC = [{n: 1}, {n: 2}]
lignesG = [1, 2]
compteur = 1
d = new Date(2020, 0, 1)
c = new Compteur()
stats = {n: 1}
obj = {n: 1}
$o = obj
obj2 = {n: 1}
$o2 = obj2
$items = [{n: 1}]
ligne = $items[0]
cache = {}
$cle = 'a'
$p = PARTAGE
$t = {toString: -> 's' + TEXTE.v}
$forOf = lignesA.reduce(((s, l) -> s + l.n), 0) + $a
$forEach = lignesB.reduce(((s, l) -> s + l.n), 0) + $a
$find = lignesC.reduce(((s, l) -> s + l.n), 0) + $a
$classe = c.n + $a
$annee = d.getFullYear() + $a
$stats = stats.n + $a
$hasard = tirage() + $a
$heure = maintenant() + $a
$rempli = liste.length + $a
$alias = STATS.n + $a
$viaObj = obj.n + $a
$viaLigne = ligne.n + $a
$viaCache = (cache[$cle] or '?')
$etatBrut = $o2.n * 2
$partage = $p.n * 2
$conv = "#{$t}"
$gabarit = "#{compteur} #{lignesG.length} #{$a}"
@agirForOf = ->
  for l of lignesA
    l.n *= 10
  return
@agirForEach = -> lignesB.forEach (l) -> l.n *= 10
@agirFind = -> lignesC.find((l) -> l.n is 1).n = 100
@agirClasse = -> c.incr()
@agirDate = -> d.setFullYear(2030)
@agirStats = -> incr(stats)
@agirRemplir = -> remplir(liste, 3)
@agirAlias = -> changerAlias()
@agirObj = -> $o.n = 5
@agirLigne = -> $items[0].n = 5
@agirCache = ->
  cache.a = 'x'
  $cle = 'a'
@agirBrut = -> obj2.n = 7
@agirPartage = -> $p.n = 5
@agirTexte = -> changerTexte()
@autre = -> $z += 1
</script>
<button class="inc" @click={compteur += 1}>+</button>
<button class="pousse" @click={lignesG.push(3)}>p</button>
<p>{$a}</p>
`

const PARENT = `<script>
$cfg = {n: 1}
$vcfg = $cfg.n * 2
$pn = 2
$z = 0
@ecrirePn = (v) -> $pn = v
@autre = -> $z += 1
</script>
<mjs-derive-repli-enfant cfg={$cfg} n={$pn}></mjs-derive-repli-enfant>
`

const ENFANT = `<script>
$cfg = null
$n = 0
$z = 0
$dn = [$n * 2]
@ecrireCfg = -> $cfg.n = 5
@autre = -> $z += 1
</script>
<p class="n">{$n}</p>
`

// écriture sans notification (`µwrite`, script et gestionnaire du gabarit) : la valeur dérivée qui lit la case la relit
const BRUT = `<script>
$tva = 0.1
$prix = 100
$saisie = ''
$total = $prix * (1 + $tva)
$x = 0
$frame = 0
$label = "x=#{$x}"
@tvaBrute = (v) -> µwrite $tva, v
@taper = (t) -> $saisie = t
@envoyer = -> $total
@bouger = (v) -> µwrite $x, v
@tick = -> $frame += 1
</script>
<p class="f">{"#{$frame} #{$label}"}</p>
<button class="b" @click={µwrite $tva, 0.3}>b</button>
`

// méthode et membres posés par l'application sur un natif : ils lisent une variable du module en cachette
const NATIFS = `<script module>
taux = {v: 1}
Number.prototype.enEurosMjs = -> this * taux.v
changerTaux = (v) -> taux.v = v
Number.tauxMjs = 1
JSON.reglageMjs = {x: 1}
changerStatiques = (v) ->
  Number.tauxMjs = v
  JSON.reglageMjs.x = v
</script>
<script>
$montant = 10
$z = 0
$euros = $montant.enEurosMjs()
$statique = $montant * Number.tauxMjs
$json = $montant * JSON.reglageMjs.x
$natif = [$montant.toFixed(1)]
@maj = (v) ->
  changerTaux(v)
  $z += 1
@majStatiques = (v) ->
  changerStatiques(v)
  $z += 1
</script>
<p>{$z}</p>
`

// chaîne de 21 valeurs dérivées qui lisent deux fois la précédente
const CHAINE = `<script>
$a = 1
$z = 0
$x0 = $a + $a
${Array.from({ length: 20 }, (_, i) => `$x${i + 1} = $x${i} + $x${i}`).join('\n')}
</script>
<p>{$z}</p>
`

// clé calculée numérique (`$[$i] = v`), avec et sans valeur dérivée
const NUM = `<script>
$i = 0
$z = 0
$vu = [$[$i]]
@ecrireNum = (v) -> $[$i] = v
</script>
<p>{$z}</p>
`

// valeur dérivée affichée qui lit une variable par sa clé (`$[$k]`), et celle qui la lit
const DYN = `<script>
$a = 1
$b = 2
$k = 'a'
$cle = $[$k]
$cle2 = $cle * 10
</script>
<p class="c">{$cle}</p><p class="c2">{$cle2}</p>
`

const NUM_NUE = `<script>
$i = 1
@ecrireNum = (v) -> $[$i] = v
</script>
<p>{$i}</p>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prod: boolean) {
  const root   = mjsTmp('derive-justes')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-suivi.mjs'), SUIVI)
  writeFileSync(join(srcDir, 'derive-suivi-js.mjs'), SUIVI_JS)
  writeFileSync(join(srcDir, 'derive-repli.mjs'), REPLI)
  writeFileSync(join(srcDir, 'derive-repli-parent.mjs'), PARENT)
  writeFileSync(join(srcDir, 'derive-repli-enfant.mjs'), ENFANT)
  writeFileSync(join(srcDir, 'derive-brut.mjs'), BRUT)
  writeFileSync(join(srcDir, 'derive-natifs.mjs'), NATIFS)
  writeFileSync(join(srcDir, 'derive-chaine.mjs'), CHAINE)
  writeFileSync(join(srcDir, 'derive-num.mjs'), NUM)
  writeFileSync(join(srcDir, 'derive-num-nue.mjs'), NUM_NUE)
  writeFileSync(join(srcDir, 'derive-dyn.mjs'), DYN)
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
  window.eval(code)
  const doc = window.document
  doc.body.innerHTML = '<mjs-derive-suivi></mjs-derive-suivi><mjs-derive-suivi-js></mjs-derive-suivi-js><mjs-derive-repli id="r1"></mjs-derive-repli><mjs-derive-repli id="r2"></mjs-derive-repli><mjs-derive-repli-parent></mjs-derive-repli-parent><mjs-derive-brut></mjs-derive-brut><mjs-derive-natifs></mjs-derive-natifs><mjs-derive-chaine></mjs-derive-chaine><mjs-derive-num></mjs-derive-num><mjs-derive-num-nue></mjs-derive-num-nue><mjs-derive-dyn></mjs-derive-dyn>'
  const s      = doc.querySelector('mjs-derive-suivi')
  const sj     = doc.querySelector('mjs-derive-suivi-js')
  const r1     = doc.querySelector('#r1')
  const r2     = doc.querySelector('#r2')
  const parent = doc.querySelector('mjs-derive-repli-parent')
  const brut   = doc.querySelector('mjs-derive-brut')
  const natifs = doc.querySelector('mjs-derive-natifs')
  const chaine = doc.querySelector('mjs-derive-chaine')
  const num    = doc.querySelector('mjs-derive-num')
  const numNue = doc.querySelector('mjs-derive-num-nue')
  const dyn    = doc.querySelector('mjs-derive-dyn')
  await attendre(() => [s, sj, r1, r2, parent, brut, natifs, chaine, num, numNue, dyn].every((e) => !!e._shadow) && !!parent._shadow.querySelector('mjs-derive-repli-enfant')?._shadow)
  const enfant = parent._shadow.querySelector('mjs-derive-repli-enfant')
  await attendre(() => s._shadow.querySelector('.d')?.textContent === '2' && enfant._shadow.querySelector('.n')?.textContent === '2' && brut._shadow.querySelector('.f')?.textContent === '0 x=0' && dyn._shadow.querySelector('.c2')?.textContent === '10')
  await pause(30)
  return { window, s, sj, r1, r2, parent, enfant, brut, natifs, chaine, num, numNue, dyn }
}

// `tab` : liste de la fenêtre de happy-dom recopiée dans celle du test (autre prototype)
const lire    = (el: any, nom: string) => el._state[nom]
const tab     = (x: any) => Array.from(x)
const cliquer = (el: any, c: string) => el._shadow.querySelector(c).dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true, composed: true }))

describe('valeurs dérivées : toujours justes après une écriture du composant', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let m: any
      before(async () => { m = await monter(prod) })

      it('une écriture sans rapport : chaque valeur reste juste', () => {
        const s = m.s
        s._set('z', 1)
        assert.deepEqual(['double', 'chaine', 'choix', 'cle', 'borne', 'filtre'].map((n) => tab(lire(s, n))), [[2], [4], [1], [1], [1], [2]])
        assert.equal(lire(s, 'texte'), 'a=1')
      })

      it('l\'écriture d\'une variable lue la recalcule ; le gabarit suit', async () => {
        const s = m.s
        s._set('a', 3)
        assert.deepEqual(tab(lire(s, 'double')), [6])
        assert.deepEqual(tab(lire(s, 'chaine')), [8], 'à travers $base')
        assert.deepEqual(tab(lire(s, 'cle')), [3])
        assert.deepEqual(tab(lire(s, 'borne')), [3])
        assert.deepEqual(tab(lire(s, 'filtre')), [0])
        assert.deepEqual(tab(lire(s, 'choix')), [3])
        assert.equal(lire(s, 'texte'), 'a=3')
        await pause(20)
        assert.equal(s._shadow.querySelector('.d').textContent, '6')
        assert.equal(s._shadow.querySelector('.t').textContent, 'a=3')
        s._set('b', 5)
        assert.deepEqual(tab(lire(s, 'double')), [6])
        assert.deepEqual(tab(lire(s, 'choix')), [3])
        assert.deepEqual(tab(lire(s, 'borne')), [5])
      })

      it('branche lue : la valeur suit la variable que lit la branche du moment', () => {
        const s = m.s
        s._set('c', false)
        assert.deepEqual(tab(lire(s, 'choix')), [5])
        s._set('a', 7)
        assert.deepEqual(tab(lire(s, 'choix')), [5])
        s._set('b', 6)
        assert.deepEqual(tab(lire(s, 'choix')), [6])
      })

      it('accès calculé $[$k] : la clé lue et la variable qu\'elle nomme', () => {
        const s = m.s
        s._set('a', 1)
        assert.deepEqual(tab(lire(s, 'cle')), [1])
        s._set('b', 9)
        assert.deepEqual(tab(lire(s, 'cle')), [1])
        s._set('k', 'b')
        assert.deepEqual(tab(lire(s, 'cle')), [9])
        s._set('a', 2)
        assert.deepEqual(tab(lire(s, 'cle')), [9])
      })

      it('liste lue changée par une méthode : la valeur dérivée qui la lit, et celle qui lit cette dernière, restent justes', () => {
        const s = m.s
        s.pousser(3)
        assert.deepEqual(tab(lire(s, 'liste')), [3])
        assert.deepEqual(tab(lire(s, 'surInconnu')), [4])
      })

      it('JavaScript : mêmes valeurs ; boucle for…of qui change les éléments d\'une variable du <script>', () => {
        const sj = m.sj
        sj._set('z', 1)
        assert.deepEqual([lire(sj, 'double'), lire(sj, 'chaine'), lire(sj, 'cle')].map(tab), [[2], [4], [1]])
        sj._set('a', 2)
        assert.deepEqual([lire(sj, 'double'), lire(sj, 'chaine'), lire(sj, 'cle')].map(tab), [[4], [6], [2]])
        assert.equal(lire(sj, 'forOf'), 5)
        sj.agirForOf()
        sj.autre()
        assert.equal(lire(sj, 'forOf'), 32)
      })

      // forme qui change ce qu'une valeur dérivée lit en cachette, valeur attendue après une écriture sans rapport
      const CAS: [string, string, string, unknown][] = [
        ['boucle for…of de Civet qui change les éléments', 'forOf', 'agirForOf', 30],
        ['rappel de forEach qui change les éléments', 'forEach', 'agirForEach', 30],
        ['élément trouvé par find puis écrit', 'find', 'agirFind', 102],
        ['instance d\'une classe du <script module>', 'classe', 'agirClasse', 1],
        ['date changée par setFullYear', 'annee', 'agirDate', 2030],
        ['fonction du <script module> qui change son argument', 'stats', 'agirStats', 2],
        ['objet du <script module> rempli par une fonction du module', 'rempli', 'agirRemplir', 1],
        ['objet du <script module> changé par un alias du module', 'alias', 'agirAlias', 1],
        ['objet du <script> rangé dans l\'état, écrit par l\'état', 'viaObj', 'agirObj', 5],
        ['variable sans $ qui tient un objet de l\'état, écrit par l\'état', 'viaLigne', 'agirLigne', 5],
        ['changement suivi de l\'écriture de la même valeur', 'viaCache', 'agirCache', 'x'],
        ['objet de l\'état changé par la variable du <script> qui le tient', 'etatBrut', 'agirBrut', 14],
        ['conversion en texte d\'un objet de l\'état (toString)', 'conv', 'agirTexte', 's2'],
      ]
      for (const [titre, nom, agir, attendu] of CAS) {
        it(`lecture cachée : ${titre}`, () => {
          const r1 = m.r1
          lire(r1, nom)
          r1[agir]()
          r1.autre()
          assert.equal(lire(r1, nom), attendu)
        })
      }

      it('lecture cachée : gestionnaires du gabarit qui changent des variables sans $', async () => {
        const r1 = m.r1
        assert.equal(lire(r1, 'gabarit'), '1 2 0')
        cliquer(r1, '.inc')
        cliquer(r1, '.pousse')
        await pause(10)
        r1.autre()
        assert.equal(lire(r1, 'gabarit'), '2 3 0')
      })

      it('lecture cachée : heure et hasard lus par une fonction du <script module>', async () => {
        const r1     = m.r1
        const hasard = lire(r1, 'hasard'), heure = lire(r1, 'heure')
        await pause(5)
        r1.autre()
        assert.notEqual(lire(r1, 'hasard'), hasard)
        assert.notEqual(lire(r1, 'heure'), heure)
      })

      it('objet du <script module> rangé dans l\'état de deux instances, écrit par l\'autre', () => {
        assert.equal(lire(m.r2, 'partage'), 2)
        m.r1.agirPartage()
        m.r2.autre()
        assert.equal(lire(m.r2, 'partage'), 10)
      })

      it('objet passé par le parent que l\'enfant écrit ; prop simple chez l\'enfant', async () => {
        const { parent, enfant } = m
        assert.equal(lire(parent, 'vcfg'), 2)
        enfant.ecrireCfg()
        parent.autre()
        assert.equal(lire(parent, 'vcfg'), 10)
        assert.deepEqual(tab(lire(enfant, 'dn')), [4])
        enfant.autre()
        assert.deepEqual(tab(lire(enfant, 'dn')), [4], 'écriture sans rapport chez l\'enfant')
        parent.ecrirePn(4)
        await attendre(() => enfant._shadow.querySelector('.n').textContent === '4')
        assert.deepEqual(tab(lire(enfant, 'dn')), [8])
      })

      it('µwrite dans le script, puis une écriture : la valeur dérivée qui lit la case rend la valeur écrite', () => {
        const b = m.brut
        assert.equal(Math.round(lire(b, 'total')), 110)
        b.tvaBrute(0.2)
        b.taper('x')
        assert.equal(Math.round(b.envoyer()), 120)
      })

      it('µwrite dans un gestionnaire du gabarit, puis une écriture', async () => {
        const b = m.brut
        cliquer(b, '.b')
        await pause(10)
        b.taper('y')
        assert.equal(Math.round(b.envoyer()), 130)
      })

      it('µwrite ne redessine rien ; l\'écriture suivante montre la valeur dérivée relue', async () => {
        const b = m.brut
        b.bouger(42)
        await pause(20)
        assert.equal(b._shadow.querySelector('.f').textContent, '0 x=0', 'µwrite seul ne redessine pas')
        b.tick()
        await attendre(() => b._shadow.querySelector('.f').textContent !== '0 x=0')
        assert.equal(b._shadow.querySelector('.f').textContent, '1 x=42')
      })

      it('méthode posée par l\'application sur un natif (Number.prototype)', () => {
        const n = m.natifs
        assert.equal(lire(n, 'euros'), 10)
        n.maj(2)
        assert.equal(lire(n, 'euros'), 20)
      })

      it('membre posé par l\'application sur un global natif (Number, JSON)', () => {
        const n = m.natifs
        assert.equal(lire(n, 'statique'), 10)
        assert.equal(lire(n, 'json'), 10)
        n.majStatiques(3)
        assert.equal(lire(n, 'statique'), 30)
        assert.equal(lire(n, 'json'), 30)
      })

      it('méthode native d\'un nombre', () => {
        const n = m.natifs
        n._set('z', 99)
        assert.deepEqual(tab(lire(n, 'natif')), ['10.0'])
        n._set('montant', 12)
        assert.deepEqual(tab(lire(n, 'natif')), ['12.0'])
      })

      it('chaîne de 21 valeurs dérivées : juste après une écriture sans rapport, puis après celle de $a', () => {
        const c = m.chaine
        assert.equal(lire(c, 'x20'), 2 ** 21)
        c._set('z', 1)
        assert.equal(lire(c, 'x20'), 2 ** 21)
        c._set('a', 2)
        assert.equal(lire(c, 'x20'), 2 ** 22)
      })

      it('clé calculée numérique : $[$i] = v écrit la case, la valeur dérivée qui la lit suit', () => {
        const d = m.num
        assert.deepEqual(tab(lire(d, 'vu')), [undefined])
        d.ecrireNum(5)
        assert.equal(lire(d, '0'), 5)
        assert.deepEqual(tab(lire(d, 'vu')), [5])
        m.numNue.ecrireNum(7)
        assert.equal(lire(m.numNue, '1'), 7)
      })

      it('affichage d\'une valeur dérivée $[$k] : il suit la variable que $k nomme, et la valeur qui la lit aussi', async () => {
        const d   = m.dyn
        const txt = () => `${d._shadow.querySelector('.c').textContent} ${d._shadow.querySelector('.c2').textContent}`
        assert.equal(txt(), '1 10')
        d._set('a', 5)
        await attendre(() => txt() !== '1 10')
        assert.equal(txt(), '5 50')
        d._set('k', 'b')
        await attendre(() => txt() !== '5 50')
        assert.equal(txt(), '2 20')
        d._set('a', 7)
        await pause(20)
        assert.equal(txt(), '2 20', '$a n\'est plus lue')
        d._set('b', 3)
        await attendre(() => txt() !== '2 20')
        assert.equal(txt(), '3 30')
      })

      after(() => {
        const w = m?.window
        if (!w) return
        delete w.Number.prototype.enEurosMjs
        delete w.Number.tauxMjs
        delete w.JSON.reglageMjs
      })
    })
  }
})
