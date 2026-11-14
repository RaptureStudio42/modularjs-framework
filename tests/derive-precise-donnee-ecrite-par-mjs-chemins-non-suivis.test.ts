// Valeurs dérivées précises qui lisent un objet que MJS change lui-même (une autre variable du composant l'écrit : `$sel.prix = 10`,
// `$m.set(…)`, `$d.setFullYear(…)`), par un chemin que l'enveloppe ne suit pas : accesseur d'une classe, objet hérité
// (`Object.create`), conteneur ou élément gelé, liste gelée dont une ligne est choisie puis écrite, `Error`, objet étiqueté
// (`Symbol.toStringTag`), méthode d'une classe, `Map`, date. Chaque valeur rend celle de la règle de toujours (refaite après toute
// écriture du composant), sans `µrefresh` : la donnée est changée par MJS. Avec l'enveloppe (le défaut) et avec `"proxy": false`,
// en développement et en production. En développement, aucun avertissement ne dit qu'une donnée a été changée hors de MJS.
// Le compilateur classe chaque valeur précise (vérifié ici) : toutes passent par les contrôles de la lecture. Un appel de méthode
// hors de sa liste courte (`get` d'une `Map`, `getFullYear`, méthode d'une classe) laisserait la valeur à l'horloge, et une
// lecture seule de champ aussi (elle coûte moins que sa vérification) : la `Map` se lit par son itération, la date par sa valeur
// numérique, la classe par sa conversion (`String(p)`, `[x].join('')`), le champ dans une liste (`[$o.p].join('')`).
// Valeurs lues par le composant ; l'écran, pour la liste gelée dont une ligne est renommée :
// derive-precise-liste-gelee-ligne-renommee-ecran. Seule limite, avec l'enveloppe : un accesseur propre posé sur l'objet lui-même
// avant que la variable le reçoive (`get` défini sur une ligne, `v2`, ou sur l'objet d'une variable, `vA`, `vJ`), qui lit un objet
// écrit par une autre variable ou l'état du composant (`$n`) ; la valeur garde son dernier calcul et l'avertissement du
// développement nomme l'accesseur (cf. derive-precise-objets-speciaux-developpement)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// valeurs qui parcourent une liste (`map`) : chaque ligne est atteinte par la liste et, par une autre variable, écrite
const LISTES = `<script>
$l1 = []
$l2 = []
$l3 = []
$l4 = []
$rows5 = []
$l6 = []
$l7 = []
$l8 = []
$l9 = []
$l10 = []
$l11 = []
$rows14 = []
$v1 = $l1.map((p) -> p.tot).join(',')
$v2 = $l2.map((x) -> x.p).join(',')
$v3 = $l3.map((x) -> x.prix).join(',')
$v4 = $l4.map((x) -> x.l.prix).join(',')
$v5 = $rows5.map((r) -> r.nom).join(',')
$v6 = $l6.map((x) -> x.message).join(',')
$v7 = $l7.map((x) -> x.e.message).join(',')
$v8 = $l8.map((x) -> x.prix).join(',')
$v9 = $l9.map((x) -> [...x].map((e) -> e[1]).join('')).join(',')
$v10 = $l10.map((x) -> +x).join(',')
$v11 = $l11.map((p) -> String(p)).join(',')
$v14 = $rows14.map((r) -> r.nom).join(',')
@i1 = ->
  o = {prix: 2}
  $sel1 = o
  $l1 = [new window.Panier(o)]
@w1 = -> $sel1.prix = 10
@i2 = ->
  o = {prix: 2}
  $sel2 = o
  $l2 = [Object.defineProperty({}, 'p', {get: (-> o.prix), enumerable: true})]
@w2 = -> $sel2.prix = 10
@i3 = ->
  b = {prix: 2}
  $base3 = b
  $l3 = [Object.create(b)]
@w3 = -> $base3.prix = 10
@i4 = ->
  o = {prix: 2}
  $sel4 = o
  $l4 = [Object.freeze({l: o})]
@w4 = -> $sel4.prix = 10
@i5 = ->
  $rows5 = Object.freeze([{nom: 'a'}, {nom: 'b'}])
  $sel5 = $rows5[1]
@w5 = -> $sel5.nom = 'z'
@i6 = ->
  e = new Error('a')
  $err6 = e
  $l6 = [e]
@w6 = -> $err6.message = 'b'
@i7 = ->
  e = new Error('a')
  $err7 = e
  $l7 = [{e: e}]
@w7 = -> $err7.message = 'b'
@i8 = ->
  o = {prix: 2}
  $sel8 = o
  $l8 = [o]
@w8 = -> $sel8.prix = 10
@i9 = ->
  m = new Map([['p', 2]])
  $m9 = m
  $l9 = [m]
@w9 = -> $m9.set('p', 10)
@i10 = ->
  d = new Date(Date.UTC(2020, 0, 1))
  $d10 = d
  $l10 = [d]
@w10 = -> $d10.setUTCFullYear(2030)
@i11 = ->
  o = {prix: 2}
  $sel11 = o
  $l11 = [new window.Panier(o)]
@w11 = -> $sel11.prix = 10
@i14 = ->
  $rows14 = [{nom: 'a'}]
  Object.freeze($rows14)
  $sel14 = $rows14[0]
@w14 = -> $sel14.nom = 'z'
@lire = -> [$v1, $v2, $v3, $v4, $v5, $v6, $v7, $v8, $v9, $v10, $v11, $v14].join('|')
</script>
<p class="v">{$v1}|{$v2}|{$v3}|{$v4}|{$v5}|{$v6}|{$v7}|{$v8}|{$v9}|{$v10}|{$v11}|{$v14}</p>
`

// valeurs qui lisent un champ : accesseur propre ou de classe, conteneur gelé, objet hérité ou étiqueté, `Map`, date, conversion
// d'une classe, conversion propre à un objet gelé (`Symbol.toPrimitive`)
const OBJETS = `<script>
$n = 0
la = {prix: 2}
$ligneA = la
$panierA = Object.defineProperty({}, 'total', {get: (-> la.prix * 3), enumerable: true})
$vA = [$panierA.total].join('')
lb = {prix: 2}
$ligneB = lb
$panierB = new window.Panier(lb)
$vB = [$panierB.tot].join('')
lc = {prix: 2}
$ligneC = lc
$cfgC = Object.freeze({ligne: lc})
$vC = [$cfgC.ligne.prix].join('')
be = {prix: 2}
$baseE = be
$objE = Object.create(be)
$vE = [$objE.prix].join('')
lf = {prix: 2}
lf[Symbol.toStringTag] = 'Ligne'
$ligneF = lf
$oF = {l: lf}
$vF = [$oF.l.prix].join('')
$listeG = [lf]
$vG = $listeG.map((x) -> x.prix).join(',')
$oJ = {}
$vJ = [$oJ.g].join('')
mk = {prix: 2}
$mapK = new Map([['a', mk]])
$ligneK = mk
$vK = [...$mapK].map((e) -> e[1].prix).join(',')
$dL = new Date(Date.UTC(2020, 0, 1))
$autreL = $dL
$vL = [+$dL].join('')
lm = {prix: 2}
$ligneM = lm
$panierM = new window.Panier(lm)
$vM = [$panierM].join('')
lq = {prix: 2}
$ligneQ = lq
$listeQ = Object.freeze([lq])
$vQ = $listeQ.map((x) -> x.prix).join(',')
lr = {prix: 2}
$ligneR = lr
$convR = window.Conv(lr)
$vR = [$convR].join('')
@wA = -> $ligneA.prix = 10
@wB = -> $ligneB.prix = 10
@wC = -> $ligneC.prix = 10
@wE = -> $baseE.prix = 10
@wF = -> $ligneF.prix = 10
@iJ = -> $oJ = Object.defineProperty({}, 'g', {get: (-> $n * 2), enumerable: true})
@wJ = -> $n += 1
@wK = -> $ligneK.prix = 10
@wL = -> $autreL.setUTCFullYear(2030)
@wM = -> $ligneM.prix = 10
@wQ = -> $ligneQ.prix = 10
@wR = -> $ligneR.prix = 10
@lire = -> [$vA, $vB, $vC, $vE, $vF, $vG, $vJ, $vK, $vL, $vM, $vQ, $vR].join('|')
</script>
<p class="v">{$vA}|{$vB}|{$vC}|{$vE}|{$vF}|{$vG}|{$vJ}|{$vK}|{$vL}|{$vM}|{$vQ}|{$vR}</p>
`

// classe et objet gelé de la page, et avertissements du cœur relevés avant son chargement
const RELEVE = `window.__W = [];
window.Panier = class { constructor(l) { this.l = l } toString() { return String(this.l.prix * 3) } get tot() { return this.l.prix * 3 } };
window.Conv = (l) => Object.freeze({ [Symbol.toPrimitive]: () => 'P' + l.prix });
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`

const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const monter = async (nom) => {
    const el = document.createElement(nom)
    document.body.appendChild(el)
    await attendre(() => el._shadow?.querySelector('.v'))
    await pause(100)
    return el
  }
  const listes = await monter('mjs-listes')
  const objets = await monter('mjs-objets')
  objets.iJ()
  await pause(60)
  const ecran = (el) => el._shadow.querySelector('.v').textContent
  const L = [['depart', listes.lire(), ecran(listes)]]
  for (const c of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '14']) {
    listes['i' + c]()
    await pause(60)
    L.push(['i' + c, listes.lire(), ecran(listes)])
    listes['w' + c]()
    await pause(60)
    L.push(['w' + c, listes.lire(), ecran(listes)])
  }
  const O = [['depart', objets.lire(), ecran(objets)]]
  for (const c of ['A', 'B', 'C', 'E', 'F', 'J', 'K', 'L', 'M', 'Q', 'R']) {
    objets['w' + c]()
    await pause(60)
    O.push([c, objets.lire(), ecran(objets)])
  }
  return { listes: L, objets: O, avertissements: window.__W.filter((w) => w.includes('a servi son dernier calcul')) }
})()`

// valeurs de la règle de toujours (l'horloge) : chaque écriture du composant refait toutes les valeurs dérivées
const ATTENDU_LISTES = [['depart', '|||||||||||'], ['i1', '6|||||||||||'], ['w1', '30|||||||||||'], ['i2', '30|2||||||||||'], ['w2', '30|10||||||||||'], ['i3', '30|10|2|||||||||'], ['w3', '30|10|10|||||||||'], ['i4', '30|10|10|2||||||||'], ['w4', '30|10|10|10||||||||'], ['i5', '30|10|10|10|a,b|||||||'], ['w5', '30|10|10|10|a,z|||||||'], ['i6', '30|10|10|10|a,z|a||||||'], ['w6', '30|10|10|10|a,z|b||||||'], ['i7', '30|10|10|10|a,z|b|a|||||'], ['w7', '30|10|10|10|a,z|b|b|||||'], ['i8', '30|10|10|10|a,z|b|b|2||||'], ['w8', '30|10|10|10|a,z|b|b|10||||'], ['i9', '30|10|10|10|a,z|b|b|10|2|||'], ['w9', '30|10|10|10|a,z|b|b|10|10|||'], ['i10', '30|10|10|10|a,z|b|b|10|10|1577836800000||'], ['w10', '30|10|10|10|a,z|b|b|10|10|1893456000000||'], ['i11', '30|10|10|10|a,z|b|b|10|10|1893456000000|6|'], ['w11', '30|10|10|10|a,z|b|b|10|10|1893456000000|30|'], ['i14', '30|10|10|10|a,z|b|b|10|10|1893456000000|30|a'], ['w14', '30|10|10|10|a,z|b|b|10|10|1893456000000|30|z']]
const ATTENDU_OBJETS = [['depart', '6|6|2|2|2|2|0|2|1577836800000|6|2|P2'], ['A', '30|6|2|2|2|2|0|2|1577836800000|6|2|P2'], ['B', '30|30|2|2|2|2|0|2|1577836800000|6|2|P2'], ['C', '30|30|10|2|2|2|0|2|1577836800000|6|2|P2'], ['E', '30|30|10|10|2|2|0|2|1577836800000|6|2|P2'], ['F', '30|30|10|10|10|10|0|2|1577836800000|6|2|P2'], ['J', '30|30|10|10|10|10|2|2|1577836800000|6|2|P2'], ['K', '30|30|10|10|10|10|2|10|1577836800000|6|2|P2'], ['L', '30|30|10|10|10|10|2|10|1893456000000|6|2|P2'], ['M', '30|30|10|10|10|10|2|10|1893456000000|30|2|P2'], ['Q', '30|30|10|10|10|10|2|10|1893456000000|30|10|P2'], ['R', '30|30|10|10|10|10|2|10|1893456000000|30|10|P10']]

// avec l'enveloppe, les colonnes de `v2`, `vA` et `vJ` (accesseur propre posé sur l'objet lui-même) ne sont pas comparées : la
// limite connue
const sans = (v: string, cols: number[]) => v.split('|').map((x, i) => cols.includes(i) ? '*' : x).join('|')

async function construire(prod: boolean, proxy: boolean): Promise<string> {
  const root   = mjsTmp('ecrite-par-mjs')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'listes.mjs'), LISTES)
  writeFileSync(join(srcDir, 'objets.mjs'), OBJETS)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
  if (!proxy) opts.proxy = false
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('valeurs précises : donnée changée par MJS par un chemin que l\'enveloppe ne suit pas, la valeur de la règle de toujours', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le compilateur classe les vingt-quatre valeurs précises : elles passent par les contrôles de la lecture', async () => {
    const code   = await construire(false, true)
    const noms   = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v14', 'vA', 'vB', 'vC', 'vE', 'vF', 'vG', 'vJ', 'vK', 'vL', 'vM', 'vQ', 'vR']
    const refus  = noms.filter((n) => {
      const ligne = code.split('\n').find((l) => l.includes('_mjs_setComputed(_mjsThis, \'' + n + '\''))
      return !ligne || !/\]\)\s*;?\s*$/.test(ligne)
    })
    assert.deepEqual(refus, [])
  })

  for (const proxy of [true, false]) {
    for (const prod of [false, true]) {
      it(`${proxy ? 'enveloppe' : '"proxy": false'}, ${prod ? 'production' : 'développement'} : valeurs justes, aucun « changée hors de MJS »`, async () => {
        const code   = await construire(prod, proxy)
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(RELEVE)
        window.eval(code)
        const r = JSON.parse(JSON.stringify(await window.eval(SCENARIO)))
        await window.happyDOM.close()
        const masque = (v: string, cols: number[]) => proxy ? sans(v, cols) : v
        assert.deepEqual(r.listes.map((e: string[]) => [e[0], masque(e[1], [1])]), ATTENDU_LISTES.map(([e, v]) => [e, masque(v, [1])]))
        assert.deepEqual(r.objets.map((e: string[]) => [e[0], masque(e[1], [0, 6])]), ATTENDU_OBJETS.map(([e, v]) => [e, masque(v, [0, 6])]))
        // développement : rien n'est attribué à un changement fait hors de MJS ; seules `$v2`, `$vA` et `$vJ` peuvent avertir,
        // avec l'enveloppe, en nommant l'accesseur qu'elles lisent
        const accesseurs: Record<string, string> = { '$v2': '`$l2[0].p`', '$vA': '`$panierA.total`', '$vJ': '`$oJ.g`' }
        assert.ok(!r.avertissements.some((w: string) => w.includes('changée hors de MJS')), r.avertissements.join('\n'))
        assert.ok(r.avertissements.every((w: string) => proxy && !prod && Object.entries(accesseurs).some(([v, a]) => w.includes('« ' + v + ' »') && w.includes('accesseur posé sur un objet (' + a + ')'))), r.avertissements.join('\n'))
      })
    }
  }
})
