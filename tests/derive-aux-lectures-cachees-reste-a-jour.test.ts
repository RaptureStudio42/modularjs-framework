// Une valeur dérivée aux lectures cachées reste juste quand on la relit : toute écriture du composant la périme, elle se
// recalcule à la lecture suivante. Lectures cachées : méthode d'un nom ordinaire (`get`, `map`, `format`…) appelée sur
// un objet de l'utilisateur qui lit l'état par une fermeture, fonction du `<script>` qui lit l'état, valeur dérivée qui
// en lit une autre. Ce que le gabarit en affiche ne se relance qu'avec les variables qu'elle lit en toutes lettres :
// l'écran garde l'ancienne valeur jusque-là (la relancer après chaque écriture refaisait la requête d'un `{await}` et
// les lignes d'un `{for}` à chaque frappe). Le remède est `µderived` avec ses dépendances : le gabarit suit alors. Le
// compilateur n'enveloppe aucun receveur.
// L'objet de l'utilisateur est fait par une fonction : écrit en toutes lettres dans le `<script>`, il serait lui-même
// une valeur dérivée de `$dict` (sa fermeture lit `$dict`), refaite à chaque écriture de `$dict`.
// Civet, CoffeeScript et JavaScript ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const GABARIT = `
<p class="titre">{$titre}</p>
<p class="maj">{$majuscules}</p>
<p class="fmt">{$formate}</p>
<p class="fn">{$viaFonction}</p>
<p class="suit">{$suit}</p>
<p class="suitfn">{$suitFonction}</p>
<p class="mag">{$viaMagasin}</p>
<p class="rem">{$remede}</p>
{if $titre == 'b'}<p class="si">oui</p>{end}
<p class="gardes">{$somme} {$parCarte} {$nombre} {$annee}</p>
`

const CIVET = `<script module>
compte = (nom, v) ->
  window.comptes[nom] = (window.comptes[nom] ?? 0) + 1
  v
</script>
<script>
$dict = {titre: 'a'}
$n = 1
$autre = 0
$$sel = 'x'
$l = [1, 2, 3]
$carte = new Map([['a', 1]])
$nf = new Intl.NumberFormat('en-US')
$jour = new Date(Date.UTC(2020, 0, 2))
creerTrad = -> ({get: (k) -> $dict[k]})
creerListe = -> ({map: (f) -> [f($dict.titre)]})
creerFormat = -> ({format: (v) -> $dict.titre + v})
lire = (k) -> $dict[k]
lireMagasin = -> $$sel
$trad = creerTrad()
$liste = creerListe()
$format = creerFormat()
$titre = $trad.get('titre')
$majuscules = $liste.map((v) -> v.toUpperCase())[0]
$formate = $format.format($n)
$viaFonction = lire('titre') + $n
$suit = $titre.repeat(2)
$suitFonction = $viaFonction + '!'
$viaMagasin = lireMagasin() + $n
µderived $remede = lire('titre') + $n, $dict
$somme = compte 'somme', $l.map((v) -> v * 2).join(',')
$parCarte = compte 'parCarte', $carte.get('a') + $n
$nombre = compte 'nombre', $nf.format($n * 1000)
$annee = compte 'annee', $jour.getUTCFullYear() + $n
journal = []
µeffect ->
  journal.push $titre + '|' + $viaFonction + '|' + $autre
@journal = -> journal
@valeurs = -> [$titre, $majuscules, $formate, $viaFonction, $suit, $suitFonction].join(' ')
@ecrireDict = (v) -> $dict = {titre: v}
@ecrireAutre = (v) -> $autre = v
@ecrireN = (v) -> $n = v
@ecrireSel = (v) -> $$sel = v
@lireMag = -> $viaMagasin
@boucleDict = (n) ->
  for i of [1..n]
    $dict = {titre: 'v' + i}
</script>
${GABARIT}`

const COFFEE = `<script module lang="coffee">
compte = (nom, v) ->
  window.comptes[nom] = (window.comptes[nom] or 0) + 1
  v
</script>
<script lang="coffee">
$dict = {titre: 'a'}
$n = 1
$autre = 0
$$sel = 'x'
$l = [1, 2, 3]
$carte = new Map([['a', 1]])
$nf = new Intl.NumberFormat('en-US')
$jour = new Date(Date.UTC(2020, 0, 2))
creerTrad = -> {get: (k) -> $dict[k]}
creerListe = -> {map: (f) -> [f($dict.titre)]}
creerFormat = -> {format: (v) -> $dict.titre + v}
lire = (k) -> $dict[k]
lireMagasin = -> $$sel
$trad = creerTrad()
$liste = creerListe()
$format = creerFormat()
$titre = $trad.get('titre')
$majuscules = $liste.map((v) -> v.toUpperCase())[0]
$formate = $format.format($n)
$viaFonction = lire('titre') + $n
$suit = $titre.repeat(2)
$suitFonction = $viaFonction + '!'
$viaMagasin = lireMagasin() + $n
µderived $remede = lire('titre') + $n, $dict
$somme = compte('somme', $l.map((v) -> v * 2).join(','))
$parCarte = compte('parCarte', $carte.get('a') + $n)
$nombre = compte('nombre', $nf.format($n * 1000))
$annee = compte('annee', $jour.getUTCFullYear() + $n)
journal = []
µeffect ->
  journal.push $titre + '|' + $viaFonction + '|' + $autre
  return
@journal = -> journal
@valeurs = -> [$titre, $majuscules, $formate, $viaFonction, $suit, $suitFonction].join(' ')
@ecrireDict = (v) -> $dict = {titre: v}
@ecrireAutre = (v) -> $autre = v
@ecrireN = (v) -> $n = v
@ecrireSel = (v) -> $$sel = v
@lireMag = -> $viaMagasin
@boucleDict = (n) ->
  for i in [1..n]
    $dict = {titre: 'v' + i}
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
$dict = { titre: 'a' }
$n = 1
$autre = 0
$$sel = 'x'
$l = [1, 2, 3]
$carte = new Map([['a', 1]])
$nf = new Intl.NumberFormat('en-US')
$jour = new Date(Date.UTC(2020, 0, 2))
const creerTrad = () => ({ get: (k) => $dict[k] })
const creerListe = () => ({ map: (f) => [f($dict.titre)] })
const creerFormat = () => ({ format: (v) => $dict.titre + v })
const lire = (k) => $dict[k]
const lireMagasin = () => $$sel
$trad = creerTrad()
$liste = creerListe()
$format = creerFormat()
$titre = $trad.get('titre')
$majuscules = $liste.map((v) => v.toUpperCase())[0]
$formate = $format.format($n)
$viaFonction = lire('titre') + $n
$suit = $titre.repeat(2)
$suitFonction = $viaFonction + '!'
$viaMagasin = lireMagasin() + $n
µderived $remede = lire('titre') + $n, $dict
$somme = compte('somme', $l.map((v) => v * 2).join(','))
$parCarte = compte('parCarte', $carte.get('a') + $n)
$nombre = compte('nombre', $nf.format($n * 1000))
$annee = compte('annee', $jour.getUTCFullYear() + $n)
const journal = []
µeffect(() => { journal.push($titre + '|' + $viaFonction + '|' + $autre) })
@journal = function() { return journal }
@valeurs = function() { return [$titre, $majuscules, $formate, $viaFonction, $suit, $suitFonction].join(' ') }
@ecrireDict = function(v) { $dict = { titre: v } }
@ecrireAutre = function(v) { $autre = v }
@ecrireN = function(v) { $n = v }
@ecrireSel = function(v) { $$sel = v }
@lireMag = function() { return $viaMagasin }
@boucleDict = function(n) { for (let i = 1; i <= n; i++) { $dict = { titre: 'v' + i } } }
</script>
${GABARIT}`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(hote: string, prod: boolean) {
  const root   = mjsTmp('derive-cache')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-cache.mjs'), hote)
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
  window.document.body.innerHTML = '<mjs-derive-cache></mjs-derive-cache>'
  const el = window.document.querySelector('mjs-derive-cache')
  await attendre(() => el._shadow?.querySelector('.gardes')?.textContent === '2,4,6 2 1,000 2021')
  await pause(30)
  return { window, el }
}

const SOURCES: [string, string][] = [['Civet', CIVET], ['CoffeeScript', COFFEE], ['JavaScript', JS]]

describe('valeurs dérivées aux lectures cachées : la valeur et l\'affichage restent à jour', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [langue, source] of SOURCES) {
    for (const prod of [false, true]) {
      const mode = prod ? 'production' : 'développement'
      describe(`${langue}, ${mode}`, function () {
        let m: any
        before(async () => { m = await monter(source, prod) })
        const lire  = (nom: string) => m.el._state[nom]
        const texte = (c: string) => m.el._shadow.querySelector(c)?.textContent ?? null
        const textes = () => ['.titre', '.maj', '.fmt', '.fn', '.suit', '.suitfn'].map(texte).join(' ')

        it('au montage : valeurs et textes de départ', () => {
          assert.equal(m.el.valeurs(), 'a A a1 a1 aa a1!')
          assert.equal(textes(), 'a A a1 a1 aa a1!')
          assert.equal(texte('.si'), null)
          assert.equal(texte('.mag'), 'x1')
        })

        it('objet de l\'utilisateur (get, map, format) : la valeur relue par un gestionnaire suit l\'état que lit sa méthode', async () => {
          for (const n of ['somme', 'parCarte', 'nombre', 'annee']) lire(n)
          m.window.comptes = {}
          m.el.ecrireDict('b')
          await pause(30)
          assert.equal(m.el.valeurs(), 'b B b1 b1 bb b1!', 'get, map, format, fonction du <script>, et les valeurs dérivées qui les lisent')
        })

        it('gabarit : un texte aux lectures cachées attend une variable qu\'il lit en toutes lettres ; µderived le fait suivre', () => {
          assert.equal(textes(), 'a A a1 a1 aa a1!', 'textes et bloc ne se relancent pas pour $dict, lue en cachette')
          assert.equal(texte('.si'), null)
          assert.equal(texte('.rem'), 'b1', 'µderived $remede = lire(\'titre\') + $n, $dict : le texte suit $dict')
        })

        it('reffet : la valeur relue quand il se relance est à jour', async () => {
          m.el.ecrireAutre(1)
          await pause(30)
          const j = m.el.journal()
          assert.equal(j[j.length - 1], 'b|b1|1')
        })

        it('tableau, Map, Intl.NumberFormat et date : valeurs et textes à jour après une écriture qu\'ils lisent', async () => {
          m.el.ecrireN(2)
          await pause(30)
          assert.equal(texte('.gardes'), '2,4,6 3 2,000 2022')
          assert.deepEqual([lire('somme'), lire('parCarte'), lire('nombre'), lire('annee')].map(String), ['2,4,6', '3', '2,000', '2022'])
          assert.equal(textes(), 'a A b2 b2 aa b2!', 'les textes qui lisent $n en toutes lettres se relancent, à jour')
        })

        it('écritures dans une boucle, puis magasin $$ lu par une fonction du <script>', async () => {
          m.el.boucleDict(3)
          assert.equal(m.el.valeurs(), 'v3 V3 v32 v32 v3v3 v32!')
          await pause(30)
          assert.equal(textes(), 'a A b2 b2 aa b2!')
          assert.equal(texte('.rem'), 'v32')
          m.el.ecrireSel('y')
          await pause(30)
          assert.equal(texte('.mag'), 'x2', 'le texte attend $n, seule variable lue en toutes lettres')
          assert.equal(m.el.lireMag(), 'y2', 'la valeur relue par un gestionnaire est à jour')
        })
      })
    }
  }
})

describe('compilateur : aucun receveur enveloppé', function () {
  const sortie = async (script: string) => {
    const { output } = await transpile(`<script>\n${script}\n</script>\n<p>{$a}</p>`, { moduleName: 'derive-receveur' })
    const out: Record<string, string> = {}
    for (const l of output.split('\n')) {
      const r = /µ\._mjs_setComputed\(_mjsThis, '(\w+)', (.*)\);?$/.exec(l)
      if (r) out[r[1]] = r[2]
    }
    return out
  }

  it('valeur de l\'état, littéral, valeur aux lectures inconnues, chaîne optionnelle : ni enveloppe ni marque', async () => {
    const out = await sortie(['$a = {b: null}', '$t = null', 'f = -> $a', '$titre = $t.get(\'x\')', '$lit = [1, 2].map((v) -> v * $a).join(\',\')', '$inc = $t.get(f())', '$opt = $a?.b.toString()', '$appel = $a.b?.toString()'].join('\n'))
    for (const k of ['titre', 'lit', 'inc', 'opt', 'appel']) {
      assert.ok(out[k], k)
      assert.doesNotMatch(out[k], /_mjs_rcv|, 1$/, k)
    }
    assert.match(out.titre, /^\(\) => \(\$\.t\.get\('x'\)\)$/)
  })
})
