// Valeurs dérivées précises qui lisent, par du code de l'application ou par une collection, un objet qu'une autre variable du
// composant écrit (`$reglages.devise = 'USD'`, `$ligne.prix = 10`) : `toString` d'une classe, conversion `Symbol.toPrimitive`
// d'une classe, `toString` posé sur un prototype fait par `Object.create`, `join` d'une sous-classe de liste, objet rangé dans un
// champ propre d'une `Map`, objet étiqueté (`Symbol.toStringTag`) sorti d'un `Set`. La donnée est changée par MJS : chaque valeur
// rend celle de la règle de toujours (l'horloge), sans `µrefresh`, sans avertissement. Avec l'enveloppe (le défaut) et avec
// `"proxy": false`, en développement et en production (happy-dom). Le compilateur classe chaque valeur précise (vérifié ici) :
// elles passent par les contrôles de la lecture. Même règle pour un champ absent au départ, venu d'une classe (accesseur qui rend
// `undefined`) ou d'un prototype fait par `Object.create`, qu'une autre variable écrit ensuite (`$ligne.prix = 10`,
// `$base.prix = 10`) : lu par `join`, `??`, `>` ou `?.`, dans une liste parcourue par `map`, il suit ; de même pour l'accesseur de
// symbole d'une classe (`Symbol.toStringTag`, `Symbol.isConcatSpreadable`), pour une fonction rangée dans une `Map` ou un `Set`,
// rendue telle quelle par un parcours (`[...$m]`), et pour une clé objet d'une `Map`, qui en sort enveloppée : sa valeur reste
// précise, `get`, `has`, `set` et `delete` la retrouvent sous ses deux formes, une écriture par une clé sortie fait suivre l'écran ;
// une `Map` de chaînes ou de nombres reste précise. Une `Map` ou un `Set` qui tient des objets de l'état sous leur enveloppe, rangé
// dans l'état, reste la même collection pour tous ceux qui la tiennent (liste, enfants, magasin, autre composant), une seule entrée par
// objet ; `WeakMap` et `WeakSet` retrouvent l'entrée par la clé enveloppée comme par la brute, dans un composant, `µ.state` et `µ.Store`,
// et `µraw` en rend la vraie collection à une bibliothèque. L'index des clés d'une collection oublie ce que `delete` et `clear` retirent :
// rien n'y reste retenu (ramasse-miettes forcé). L'écran, dans les trois navigateurs : derive-precise-classe-prototype-map-set-ecran-browser

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { FAMILLES, SCENARIO_FAMILLES, familles } from './helpers/familles-cles-map.js'
import { PARTAGE, PAGE_PARTAGE, SCENARIO_PARTAGE, partage } from './helpers/partage-collections.js'

const COMPOSANT = `<script>
$reglages1 = window.reglages1
$prix1 = new window.Prix1(5)
$v1 = [$prix1].join('')
$reglages3 = window.reglages3
$prix3 = new window.Prix3(5)
$v3 = [$prix3].join('')
$reglages4 = window.reglages4
$prix4 = window.prix4(5)
$v4 = [$prix4].join('')
l5 = {prix: 2}
$ligne5 = l5
$map5 = window.mapChamp(l5)
$v5 = [$map5.meta.prix].join('')
l7 = window.etiquete(2)
$ligne7 = l7
$set7 = new Set([l7])
$v7 = [...$set7].map((x) -> x.prix).join(',')
l8 = {prix: 2}
$ligne8 = l8
$liste8 = window.listeFermee(l8)
$v8 = $liste8.join(',')
@w1 = -> $reglages1.devise = 'USD'
@w3 = -> $reglages3.devise = 'USD'
@w4 = -> $reglages4.devise = 'USD'
@w5 = -> $ligne5.prix = 10
@w7 = -> $ligne7.prix = 10
@w8 = -> $ligne8.prix = 10
@lire = -> [$v1, $v3, $v4, $v5, $v7, $v8].join('|')
</script>
<p class="v">{$v1}|{$v3}|{$v4}|{$v5}|{$v7}|{$v8}</p>
`

// classes et objets de la page, et avertissements du cœur relevés avant son chargement
const PAGE = `window.__W = [];
window.reglages1 = { devise: 'EUR' };
window.Prix1 = class { constructor(n) { this.n = n } toString() { return this.n + ' ' + window.reglages1.devise } };
window.reglages3 = { devise: 'EUR' };
window.Prix3 = class { constructor(n) { this.n = n } [Symbol.toPrimitive]() { return this.n + ' ' + window.reglages3.devise } };
window.reglages4 = { devise: 'EUR' };
window.prix4 = (n) => { const o = Object.create({ toString() { return this.n + ' ' + window.reglages4.devise } }); o.n = n; return o };
window.mapChamp = (l) => { const m = new Map(); m.meta = l; return m };
window.etiquete = (p) => ({ prix: p, [Symbol.toStringTag]: 'Ligne' });
window.listeFermee = (l) => { class L extends Array { join(s) { return 'L' + l.prix } }; const x = new L(); x.push(1); return x };
window.prixBrut = (l) => new (class { get prix() { return l.prix } })();
window.etiquetteBrute = (t) => new (class { get [Symbol.toStringTag]() { return t.tag } })();
window.etaleBrut = (l) => new (class { get [Symbol.isConcatSpreadable]() { return !!l.on } get length() { return 2 } })();
window.MaMap = class extends Map {};
window.Nom = class { constructor(n) { this.n = n } toString() { return this.n } };
window.fnNom = () => { const f = () => 1; f.nom = 'a'; return f };
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`

const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const el = document.createElement('mjs-sonde')
  document.body.appendChild(el)
  await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const ecran = () => el._shadow.querySelector('.v').textContent
  const R = [['depart', el.lire(), ecran()]]
  for (const c of ['1', '3', '4', '5', '7', '8']) {
    el['w' + c]()
    await pause(60)
    R.push([c, el.lire(), ecran()])
  }
  return { R, W: window.__W.filter((w) => w.includes('a servi son dernier calcul')) }
})()`

// valeurs lues après chaque écriture : celles de l'horloge, qui refait toutes les valeurs dérivées après toute écriture
const ATTENDU = [['depart', '5 EUR|5 EUR|5 EUR|2|2|L2'], ['1', '5 USD|5 EUR|5 EUR|2|2|L2'], ['3', '5 USD|5 USD|5 EUR|2|2|L2'], ['4', '5 USD|5 USD|5 USD|2|2|L2'], ['5', '5 USD|5 USD|5 USD|10|2|L2'], ['7', '5 USD|5 USD|5 USD|10|10|L2'], ['8', '5 USD|5 USD|5 USD|10|10|L10']]

async function construire(prod: boolean, proxy: boolean, derived: string, composants: Record<string, string> = { sonde: COMPOSANT }): Promise<string> {
  const root   = mjsTmp('classe-map-set')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: derived }
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

async function jouer(code: string, scenario = SCENARIO, page = PAGE): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(page)
  window.eval(code)
  const r = JSON.parse(JSON.stringify(await window.eval(scenario)))
  await window.happyDOM.close()
  return r
}

describe('valeurs précises : classe, prototype, sous-classe de liste, champ d\'une Map, objet sorti d\'un Set — donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le compilateur classe les six valeurs précises : elles passent par les contrôles de la lecture', async () => {
    const code = await construire(false, true, 'precise')
    for (const n of ['v1', 'v3', 'v4', 'v5', 'v7', 'v8']) {
      const ligne = code.split('\n').find((l) => l.includes('_mjs_setComputed(_mjsThis, \'' + n + '\''))
      assert.ok(ligne && /\]\)\s*;?\s*$/.test(ligne), n + ' n\'est pas précise : ' + ligne)
    }
  })

  for (const proxy of [true, false]) {
    for (const prod of [false, true]) {
      it(`${proxy ? 'enveloppe' : '"proxy": false'}, ${prod ? 'production' : 'développement'} : valeurs de l'horloge, aucun avertissement`, async () => {
        const horloge = await jouer(await construire(prod, proxy, 'clock'))
        const precise = await jouer(await construire(prod, proxy, 'precise'))
        assert.deepEqual(horloge.R.map((e: string[]) => [e[0], e[1]]), ATTENDU)
        assert.deepEqual(precise.R, horloge.R)
        assert.deepEqual(precise.W, [])
      })
    }
  }
})

// champ absent au départ, venu d'une classe (accesseur qui rend `undefined`) ou d'un prototype fait par `Object.create`, et
// accesseur de symbole d'une classe, écrits ensuite par une autre variable du composant : [nom, cas, déclarations, valeur dérivée,
// écriture faite par MJS, valeur lue au départ, valeur lue après l'écriture]. Un composant par cas : le doute de l'un ne déteint
// pas sur l'autre
const ABSENTS: string[][] = [
  ['classe-join', 'accesseur de classe qui rend `undefined` au départ, lu par `[$c.prix].join(\'\')`', 'l = {}\n$ligne = l\n$c = window.prixBrut(l)', '[$c.prix].join(\'\')', '$ligne.prix = 10', '', '10'],
  ['classe-defaut', 'accesseur de classe qui rend `undefined` au départ, lu par `[$c.prix ?? 0].join(\'\')`', 'l = {}\n$ligne = l\n$c = window.prixBrut(l)', '[$c.prix ?? 0].join(\'\')', '$ligne.prix = 10', '0', '10'],
  ['classe-comparaison', 'accesseur de classe qui rend `undefined` au départ, lu par `[$c.prix > 5].join(\'\')`', 'l = {}\n$ligne = l\n$c = window.prixBrut(l)', '[$c.prix > 5].join(\'\')', '$ligne.prix = 10', 'false', 'true'],
  ['prototype-join', 'champ absent d\'un objet fait par `Object.create`, lu par `[$o.prix].join(\'\')`', 'b = {}\n$base = b\n$o = Object.create(b)', '[$o.prix].join(\'\')', '$base.prix = 10', '', '10'],
  ['prototype-chainage', 'champ absent d\'un objet fait par `Object.create`, lu par `$o.prix?.toFixed(1)`', 'b = {}\n$base = b\n$o = Object.create(b)', '$o.prix?.toFixed(1)', '$base.prix = 10', 'undefined', '10.0'],
  ['liste-classe', 'accesseur de classe qui rend `undefined` au départ, dans une liste parcourue par `map`', 'l = {}\n$ligne = l\n$liste = [window.prixBrut(l)]', '$liste.map((x) -> x.prix).join(\',\')', '$ligne.prix = 10', '', '10'],
  ['classe-etiquette', 'accesseur `Symbol.toStringTag` de classe qui rend `undefined` au départ, lu par `[$c].join(\'\')`', 't = {}\n$reglages = t\n$c = window.etiquetteBrute(t)', '[$c].join(\'\')', '$reglages.tag = \'USD\'', '[object Object]', '[object USD]'],
  ['classe-concat', 'accesseur `Symbol.isConcatSpreadable` de classe qui rend `false` au départ, lu par `[].concat($c).length`', 'l = {}\n$ligne = l\n$c = window.etaleBrut(l)', '[].concat($c).length', '$ligne.on = true', '1', '2']
]
const COMPOSANTS_ABSENTS = Object.fromEntries(ABSENTS.map(([nom, , d, v, w]) => ['absent-' + nom, '<script>\n$n = 0\n' + d + '\n$v = ' + v + '\n@w = ->\n  ' + w + '\n  $n += 1\n@lire = -> String($v)\n</script>\n<p class="v">{[$n, $v].join(\'|\')}</p>\n']))

// chaque pas (le départ, puis l'écriture de chaque cas) : la valeur lue et l'écran de chaque composant
const SCENARIO_ABSENTS = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const els = ${JSON.stringify(ABSENTS.map(([nom]) => nom))}.map((nom) => document.body.appendChild(document.createElement('mjs-absent-' + nom)))
  for (const el of els) await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const tout = () => els.map((el) => [el.lire(), el._shadow.querySelector('.v').textContent])
  const R = [tout()]
  for (const el of els) {
    el.w()
    await pause(60)
    R.push(tout())
  }
  return { R, W: window.__W.filter((w) => w.includes('dernier calcul')) }
})()`

describe('valeurs précises : champ absent au départ ou accesseur de symbole, venus d\'une classe ou d\'un prototype — donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  // horloge et précise, une construction par mode pour tous les cas
  const faits: Record<string, any> = {}
  async function jouerMode(cle: string, proxy: boolean, prod: boolean): Promise<any> {
    faits[cle] ??= { horloge: await jouer(await construire(prod, proxy, 'clock', COMPOSANTS_ABSENTS), SCENARIO_ABSENTS), precise: await jouer(await construire(prod, proxy, 'precise', COMPOSANTS_ABSENTS), SCENARIO_ABSENTS) }
    return faits[cle]
  }

  it(`le compilateur classe les ${ABSENTS.length} valeurs précises : elles passent par les contrôles de la lecture`, async () => {
    const code   = await construire(false, true, 'precise', COMPOSANTS_ABSENTS)
    const lignes = code.split('\n').filter((l) => l.includes('_mjs_setComputed(_mjsThis, \'v\''))
    assert.equal(lignes.length, ABSENTS.length)
    for (const ligne of lignes) assert.ok(/\]\)\s*;?\s*$/.test(ligne), 'valeur non précise : ' + ligne)
  })

  ABSENTS.forEach(([nom, cas, , , , depart, apres], i) => {
    it(`${cas} : valeurs de l'horloge, avec l'enveloppe et avec "proxy": false, en développement et en production, aucun avertissement`, async () => {
      const vus: any[] = [], attendus: any[] = []
      for (const proxy of [true, false]) {
        for (const prod of [false, true]) {
          const cle = (proxy ? 'enveloppe' : '"proxy": false') + ', ' + (prod ? 'production' : 'développement')
          const { horloge, precise } = await jouerMode(cle, proxy, prod)
          vus.push([cle, horloge.R.map((pas: string[][]) => pas[i][0]), precise.R.map((pas: string[][]) => pas[i]), precise.W.filter((w: string) => w.includes('<mjs-absent-' + nom + '>'))])
          attendus.push([cle, horloge.R.map((_: any, j: number) => j > i ? apres : depart), horloge.R.map((pas: string[][]) => pas[i]), []])
        }
      }
      assert.deepEqual(vus, attendus)
    })
  })
})

// clé objet d'une `Map`, et fonction rangée dans une `Map` ou un `Set`, que la valeur précise reçoit telles quelles d'un parcours
// (`[...$m]`, puis `map`, `find`, `at`, `flat`, `reduce`…), écrites ensuite par une autre variable du composant : [nom, cas,
// déclarations, valeur dérivée, écriture faite par MJS, valeur lue au départ, valeur lue après l'écriture]. Un composant par cas
const SORTIES: string[][] = [
  ['cle-map', 'clé objet d\'une `Map`, lue par `[...$m].map((e) -> e[0].prix)`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-nom-et-valeur', 'clé objet d\'une `Map` et sa valeur, lues par `[...$m].map((e) -> e[0].nom + e[1])`', 'k = {nom: \'a\'}\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e) -> e[0].nom + e[1]).join(\',\')', '$cle.nom = \'z\'', 'a1', 'z1'],
  ['cle-map-lignes-choisies', 'ligne d\'une liste rangée en clé d\'une `Map` (`$choix.set($rows[0], 1)`), écrite par la liste', '$rows = [{nom: \'a\'}, {nom: \'b\'}]\n$choix = new Map()\n$choix.set($rows[0], 1)', '[...$choix].map((e) -> e[0].nom + e[1]).join(\',\')', '$rows[0].nom = \'z\'', 'a1', 'z1'],
  ['cle-map-indice', 'clé objet d\'une `Map`, lue par `[...$m][0][0].prix`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m][0][0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-at', 'clé objet d\'une `Map`, lue par `at`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].at(0)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-find', 'clé objet d\'une `Map`, lue par `find`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].find((e) -> e[1] == 1)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-findlast', 'clé objet d\'une `Map`, lue par `findLast`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].findLast((e) -> e[1] == 1)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-flat', 'clé objet d\'une `Map`, lue par `flat`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].flat()[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-flatmap', 'clé objet d\'une `Map`, lue par `flatMap`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].flatMap((e) -> e)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-reduce', 'clé objet d\'une `Map`, lue par `reduce`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].reduce(((a, e) -> a + e[0].prix), 0)].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-filter', 'clé objet d\'une `Map`, lue par `filter`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].filter((e) -> e[0].prix > 5).length].join(\'\')', '$cle.prix = 10', '0', '1'],
  ['cle-map-some', 'clé objet d\'une `Map`, lue par `some`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].some((e) -> e[0].prix > 5)].join(\'\')', '$cle.prix = 10', 'false', 'true'],
  ['cle-map-every', 'clé objet d\'une `Map`, lue par `every`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].every((e) -> e[0].prix < 5)].join(\'\')', '$cle.prix = 10', 'true', 'false'],
  ['cle-map-findindex', 'clé objet d\'une `Map`, lue par `findIndex`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].findIndex((e) -> e[0].prix > 5)].join(\'\')', '$cle.prix = 10', '-1', '0'],
  ['cle-map-slice', 'clé objet d\'une `Map`, lue par `slice`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].slice(0)[0][0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-concat', 'clé objet d\'une `Map`, lue par `concat`', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[].concat([...$m])[0][0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-etalee-dans-un-appel', 'clé objet d\'une `Map`, lue dans une liste étalée dans un appel (`Math.max(...)`)', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[Math.max(...[...$m].map((e) -> e[0].prix))].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-liste-du-rappel', 'clé objet d\'une `Map`, lue dans la liste reçue en 3e paramètre du rappel', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e, i, a) -> a[0][0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-tostring', 'clé d\'une `Map`, instance d\'une classe dont `toString` lit un champ, lue par `join`', 'k = new window.Nom(\'a\')\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].join(\';\')', '$cle.n = \'z\'', 'a,1', 'z,1'],
  ['cle-map-liste', 'liste rangée en clé d\'une `Map`, poussée par une autre variable', 'k = [1, 2]\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e) -> e[0].length).join(\',\')', '$cle.push(3)', '2', '3'],
  ['cle-map-fonction', 'fonction rangée en clé d\'une `Map`, dont une autre variable écrit un champ', 'f = window.fnNom()\n$f = f\n$m = new Map([[f, 1]])', '[...$m].map((e) -> e[0].nom).join(\',\')', '$f.nom = \'z\'', 'a', 'z'],
  ['cle-sous-classe-map', 'clé objet d\'une sous-classe de `Map`', 'k = {prix: 2}\n$cle = k\n$m = new window.MaMap([[k, 1]])', '[...$m].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-dans-un-objet', 'clé objet d\'une `Map` rangée dans un objet (`$o.m`)', 'k = {prix: 2}\n$cle = k\n$o = {m: new Map([[k, 1]])}', '[...$o.m].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-dans-une-liste', 'clé objet d\'une `Map` rangée dans une liste', 'k = {prix: 2}\n$cle = k\n$l = [new Map([[k, 1]])]', '[...$l[0]].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-valeur-d-une-map', 'clé objet d\'une `Map` rangée en valeur d\'une autre `Map`', 'k = {prix: 2}\n$cle = k\n$mm = new Map([[\'a\', new Map([[k, 1]])]])', '[...[...$mm][0][1]].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-dans-un-set', 'clé objet d\'une `Map` rangée dans un `Set`', 'k = {prix: 2}\n$cle = k\n$s = new Set([new Map([[k, 1]])])', '[...[...$s][0]].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-cle-d-une-map', '`Map` rangée en clé d\'une autre `Map`, sa valeur objet écrite par une autre variable', 'l = {prix: 2}\n$ligne = l\n$mm = new Map([[new Map([[\'a\', l]]), 1]])', '[...[...$mm][0][0]].map((e) -> e[1].prix).join(\',\')', '$ligne.prix = 10', '2', '10'],
  ['valeur-fonction-map', 'fonction rangée en valeur d\'une `Map`, dont une autre variable écrit un champ', 'f = window.fnNom()\n$f = f\n$m = new Map([[\'a\', f]])', '[...$m].map((e) -> e[1].nom).join(\',\')', '$f.nom = \'z\'', 'a', 'z'],
  ['element-fonction-set', 'fonction rangée dans un `Set`, dont une autre variable écrit un champ', 'f = window.fnNom()\n$f = f\n$s = new Set([f])', '[...$s].map((x) -> x.nom).join(\',\')', '$f.nom = \'z\'', 'a', 'z']
]
// appli ordinaire, sans objet rendu tel quel (`Map` de chaînes ou de nombres, `Set` de chaînes) : la valeur reste précise
const ORDINAIRES: string[][] = [
  ['map-de-chaines', '$m = new Map([[\'a\', 1], [\'b\', 2]])', '[...$m].map((e) -> e[0] + e[1]).join(\',\')', '$m.set(\'a\', 10)', 'a1,b2', 'a10,b2'],
  ['map-de-nombres', '$m = new Map([[1, {n: \'a\'}]])', '[...$m].map((e) -> e[0] + e[1].n).join(\',\')', '$m.get(1).n = \'z\'', '1a', '1z'],
  ['set-de-chaines', '$s = new Set([\'a\'])', '[...$s].join(\',\')', '$s.add(\'b\')', 'a', 'a,b'],
  ['map-dans-un-objet', '$o = {m: new Map([[2, \'b\']])}', '[...$o.m].map((e) -> e[0] + e[1]).join(\',\')', '$o.m.set(3, \'c\')', '2b', '2b,3c'],
  ['map-de-listes', '$m = new Map([[\'x\', [1, 2]]])', '[...$m].map((e) -> e[1].length).join(\',\')', '$m.get(\'x\').push(3)', '2', '3']
]
const COMPOSANTS_SORTIES = Object.fromEntries([...SORTIES.map(([nom, , d, v, w]) => ['sortie-' + nom, d, v, w]), ...ORDINAIRES.map(([nom, d, v, w]) => ['ordinaire-' + nom, d, v, w])].map(([nom, d, v, w]) => [nom, '<script>\n$n = 0\n' + d + '\n$v = ' + v + '\n@w = ->\n  ' + w + '\n  $n += 1\n@lire = -> String($v)\n</script>\n<p class="v">{[$n, $v].join(\'|\')}</p>\n']))

// chaque pas (le départ, puis l'écriture de chaque cas) : la valeur lue et l'écran de chaque composant ; la classe de chaque valeur
// au départ et à la fin (P précise, H repassée à l'horloge, ? hors développement)
const SCENARIO_SORTIES = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const els = ${JSON.stringify(Object.keys(COMPOSANTS_SORTIES))}.map((nom) => document.body.appendChild(document.createElement('mjs-' + nom)))
  for (const el of els) await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const tout = () => els.map((el) => [el.lire(), el._shadow.querySelector('.v').textContent])
  const classe = () => els.map((el) => { const v = el._mjs_computeds?.v; return v ? (v._mjs_src === null ? 'H' : 'P') : '?' })
  const R = [tout()], E0 = classe()
  for (const el of els) {
    el.w()
    await pause(60)
    R.push(tout())
  }
  return { R, E0, E1: classe(), W: window.__W.filter((w) => w.includes('dernier calcul')) }
})()`

describe('valeurs précises : clé objet d\'une Map, sortie enveloppée, fonction rangée dans une Map ou un Set, rendue telle quelle par un parcours — donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  // horloge et précise, une construction par mode pour tous les cas
  const faits: Record<string, any> = {}
  async function jouerMode(cle: string, proxy: boolean, prod: boolean): Promise<any> {
    faits[cle] ??= { horloge: await jouer(await construire(prod, proxy, 'clock', COMPOSANTS_SORTIES), SCENARIO_SORTIES), precise: await jouer(await construire(prod, proxy, 'precise', COMPOSANTS_SORTIES), SCENARIO_SORTIES) }
    return faits[cle]
  }
  const MODES = [[true, false], [true, true], [false, false], [false, true]].map(([proxy, prod]) => [(proxy ? 'enveloppe' : '"proxy": false') + ', ' + (prod ? 'production' : 'développement'), proxy, prod] as [string, boolean, boolean])

  it(`le compilateur classe les ${SORTIES.length + ORDINAIRES.length} valeurs précises : elles passent par les contrôles de la lecture`, async () => {
    const code   = await construire(false, true, 'precise', COMPOSANTS_SORTIES)
    const lignes = code.split('\n').filter((l) => l.includes('_mjs_setComputed(_mjsThis, \'v\''))
    assert.equal(lignes.length, SORTIES.length + ORDINAIRES.length)
    for (const ligne of lignes) assert.ok(/\]\)\s*;?\s*$/.test(ligne), 'valeur non précise : ' + ligne)
  })

  SORTIES.forEach(([nom, cas, , , , depart, apres], i) => {
    it(`${cas} : valeurs de l'horloge, avec l'enveloppe et avec "proxy": false, en développement et en production, aucun avertissement`, async () => {
      const vus: any[] = [], attendus: any[] = []
      for (const [cle, proxy, prod] of MODES) {
        const { horloge, precise } = await jouerMode(cle, proxy, prod)
        vus.push([cle, horloge.R.map((pas: string[][]) => pas[i][0]), precise.R.map((pas: string[][]) => pas[i]), precise.W.filter((w: string) => w.includes('<mjs-sortie-' + nom + '>'))])
        attendus.push([cle, horloge.R.map((_: any, j: number) => j > i ? apres : depart), horloge.R.map((pas: string[][]) => pas[i]), []])
      }
      assert.deepEqual(vus, attendus)
    })
  })

  it('appli ordinaire (`Map` de chaînes ou de nombres, `Set` de chaînes, `Map` rangée dans un objet) : valeurs de l\'horloge, et, avec l\'enveloppe, la valeur reste précise en développement', async () => {
    const vus: any[] = [], attendus: any[] = []
    for (const [cle, proxy, prod] of MODES) {
      const { horloge, precise } = await jouerMode(cle, proxy, prod)
      ORDINAIRES.forEach(([nom, , , , depart, apres], j) => {
        const i = SORTIES.length + j
        const classe = prod ? '?' : (proxy ? 'P' : 'H')
        vus.push([cle, nom, horloge.R.map((pas: string[][]) => pas[i][0]), precise.R.map((pas: string[][]) => pas[i]), precise.E0[i], precise.E1[i]])
        attendus.push([cle, nom, horloge.R.map((_: any, k: number) => k > i ? apres : depart), horloge.R.map((pas: string[][]) => pas[i]), classe, classe])
      })
    }
    assert.deepEqual(vus, attendus)
  })
})

// clé objet d'une `Map` : elle sort ENVELOPPÉE de tout parcours, comme la valeur — rangée sous la clé de la variable, une écriture
// faite par une autre variable prévient la valeur, qui reste PRÉCISE : après une écriture sans rapport dans le composant
// (`$autre += 1`), elle n'est pas recalculée. Le compteur : `join` de la page, relevé par séparateur (`¦0`, `¦1`…) avant que MJS
// le lise. En développement, la valeur qui va servir son dernier calcul est refaite à part pour contrôle : la classe (P précise,
// H horloge) y dit la précision, le compteur la dit en production. Une clé fonction garde le doute : juste à la lecture, recalculée
// après l'écriture sans rapport ; son écran attend le prochain rendu du composant, comme avant (non regardé ici). [nom, cas,
// déclarations, valeur dérivée sans son `join`, écriture faite par MJS, valeur au départ, valeur après, doute gardé]
const PRECISES: string[][] = [
  ['lignes-choisies', 'ligne d\'une liste rangée en clé (`$choix.set($rows[0], 1)`), écrite par la liste', '$rows = [{nom: \'a\'}, {nom: \'b\'}]\n$choix = new Map()\n$choix.set($rows[0], 1)', '[...$choix].map((e) -> e[0].nom + e[1])', '$rows[0].nom = \'z\'', 'a1', 'z1', ''],
  ['cle-tenue', 'clé tenue par une variable (`$cle = k`, `$m = new Map([[k, 1]])`), écrite par elle', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e) -> e[0].prix)', '$cle.prix = 10', '2', '10', ''],
  ['sous-classe', 'clé d\'une sous-classe de `Map`', 'k = {prix: 2}\n$cle = k\n$m = new window.MaMap([[k, 1]])', '[...$m].map((e) -> e[0].prix)', '$cle.prix = 10', '2', '10', ''],
  ['dans-un-objet', 'clé d\'une `Map` rangée dans un objet (`$o.m`)', 'k = {prix: 2}\n$cle = k\n$o = {m: new Map([[k, 1]])}', '[...$o.m].map((e) -> e[0].prix)', '$cle.prix = 10', '2', '10', ''],
  ['cle-d-une-map', 'clé d\'une `Map` rangée en clé d\'une autre `Map`', 'k = {prix: 2}\n$cle = k\n$mm = new Map([[new Map([[k, 1]]), 1]])', '[...[...$mm][0][0]].map((e) -> e[0].prix)', '$cle.prix = 10', '2', '10', ''],
  ['cle-fonction', 'clé fonction, dont une autre variable écrit un champ : le doute est gardé', 'f = window.fnNom()\n$f = f\n$m = new Map([[f, 1]])', '[...$m].map((e) -> e[0].nom)', '$f.nom = \'z\'', 'a', 'z', '1']
]
const COMPOSANTS_PRECISES = Object.fromEntries(PRECISES.map(([nom, , d, v, w], i) => ['precise-' + nom, '<script>\n$autre = 0\n' + d + '\n$v = ' + v + '.join(\'¦' + i + '\')\n@sans = -> $autre += 1\n@w = ->\n  ' + w + '\n@lire = -> String($v)\n</script>\n<p class="v">{[$autre, $v].join(\'|\')}</p>\n']))
// `join` compté par séparateur, posé avant MJS : il reste une fonction du langage pour lui
const PAGE_JOIN = `window.__J = {};
(function () {
  var j = Array.prototype.join;
  Array.prototype.join = function (s) { if (typeof s === 'string' && s.charAt(0) === '¦') window.__J[s] = (window.__J[s] || 0) + 1; return j.apply(this, arguments); };
})();`
// chaque cas : écran au départ, après l'écriture sans rapport, après l'écriture faite par MJS ; valeur lue ; calculs faits par chacune
// des deux écritures ; classe de la valeur à la fin
const SCENARIO_PRECISES = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const els = ${JSON.stringify(Object.keys(COMPOSANTS_PRECISES))}.map((nom) => document.body.appendChild(document.createElement('mjs-' + nom)))
  for (const el of els) await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const compte = (i) => window.__J['¦' + i] || 0
  const ecran = (el) => el._shadow.querySelector('.v').textContent
  const classe = (el) => { const v = el._mjs_computeds?.v; return v ? (v._mjs_src === null ? 'H' : 'P') : '?' }
  const R = []
  for (const [i, el] of els.entries()) {
    const c0 = compte(i), e0 = ecran(el)
    el.sans()
    await pause(60)
    const c1 = compte(i), e1 = ecran(el)
    el.w()
    await pause(60)
    const c2 = compte(i), e2 = ecran(el)
    R.push([e0, e1, e2, el.lire(), c1 - c0, c2 - c1, classe(el)])
  }
  return { R, W: window.__W.filter((w) => w.includes('dernier calcul')) }
})()`

// déballage, identité, écriture par une clé sortie : état d'un composant (`$mk` rangée brute, `$op.m` rangée enveloppée : une `Map`
// rangée dans un objet, qu'une affectation ne copie pas), µ.state, µ.Store ; une `Map` qui tient une clé sous ses deux formes. Appel direct (`$m.set(k, v)`) et par un alias
// (`a = $m`, puis `a.set(k, v)`)
const CLES = `<script>
km = {prix: 2}
r0 = {nom: 'a'}
$cle = km
$rows = [r0, {nom: 'b'}]
$mk = new Map([[km, 1]])
$op = {m: new Map()}
$o2 = {m: new Map()}
$mc = new Map([[{nom: 'a'}, 1]])
$md = new Map([[{nom: 'a'}, 1]])
$me = new Map([[{nom: 'a'}, 1]])
@P = -> $cle
@K = -> km
@RP = -> $rows[0]
@keysK = -> [...$mk.keys()]
@entK = -> [...$mk]
@feK = ->
  r = []
  $mk.forEach((v, k) -> r.push(k))
  r
@getK = (x) -> $mk.get(x)
@hasK = (x) -> $mk.has(x)
@delK = (x) -> $mk.delete(x)
@setK = (x, v) -> $mk.set(x, v)
@aDelK = (x) ->
  a = $mk
  a.delete(x)
@aSetK = (x, v) ->
  a = $mk
  a.set(x, v)
@sizeK = -> $mk.size
@getP = (x) -> $op.m.get(x)
@hasP = (x) -> $op.m.has(x)
@delP = (x) -> $op.m.delete(x)
@setP = (x, v) -> $op.m.set(x, v)
@aDelP = (x) ->
  a = $op.m
  a.delete(x)
@aSetP = (x, v) ->
  a = $op.m
  a.set(x, v)
@sizeP = -> $op.m.size
@neuves = ->
  $mk = new Map([[km, 1]])
  $op = {m: new Map([[$rows[0], 1]])}
@deuxFormes = -> $o2 = {m: new Map([[r0, 1], [$rows[0], 2]])}
@deuxGet = -> $o2.m.get($rows[0])
@ecrireKeys = ->
  for k of $mc.keys()
    k.nom = 'z'
@ecrireEntree = -> [...$md][0][0].nom = 'z'
@ecrireForEach = -> $me.forEach((v, k) -> k.nom = 'z')
@etat = (m, c) -> µ.state({m, c})
@magasin = (m, c) -> new µ.Store({m, c}).data
</script>
<p class="c1">{[...$mc.keys()].map((k) -> k.nom).join(',')}</p>
<p class="c2">{[...$md.keys()].map((k) -> k.nom).join(',')}</p>
<p class="c3">{[...$me.keys()].map((k) -> k.nom).join(',')}</p>
`
const SCENARIO_CLES = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const el = document.body.appendChild(document.createElement('mjs-cles-map'))
  await attendre(() => el._shadow?.querySelector('.c1'))
  await pause(50)
  const essai = (f) => { try { return String(f()) } catch (e) { return 'ERREUR ' + e.message } }
  const R = []
  const P = el.P(), K = el.K()
  el.neuves()
  const RP = el.RP()
  R.push(['clé sortie de keys() === $cle', essai(() => el.keysK()[0] === P)], ['clé sortie de keys() === objet brut gardé hors de l\\'état', essai(() => el.keysK()[0] === K)], ['clé sortie de [...$m] === $cle', essai(() => el.entK()[0][0] === P)], ['clé de forEach === $cle', essai(() => el.feK()[0] === P)])
  R.push(['rangée brute : get(enveloppée)', essai(() => el.getK(P))], ['rangée brute : get(brute)', essai(() => el.getK(K))], ['rangée brute : has(enveloppée)', essai(() => el.hasK(P))], ['rangée brute : has(brute)', essai(() => el.hasK(K))], ['rangée brute : get(clé sortie)', essai(() => el.getK(el.keysK()[0]))], ['rangée brute : has(clé sortie)', essai(() => el.hasK(el.keysK()[0]))])
  R.push(['rangée enveloppée : get(enveloppée)', essai(() => el.getP(RP))], ['rangée enveloppée : has(enveloppée)', essai(() => el.hasP(RP))])
  const ecrit = (lib, f, apres) => { el.neuves(); R.push([lib, essai(() => f() + ' ; ' + apres())]) }
  ecrit('rangée brute : delete(enveloppée), appel direct', () => el.delK(P), () => 'size ' + el.sizeK())
  ecrit('rangée brute : delete(clé sortie), par un alias', () => el.aDelK(el.keysK()[0]), () => 'size ' + el.sizeK())
  ecrit('rangée enveloppée : delete(enveloppée), appel direct', () => el.delP(RP), () => 'size ' + el.sizeP())
  ecrit('rangée enveloppée : delete(enveloppée), par un alias', () => el.aDelP(RP), () => 'size ' + el.sizeP())
  ecrit('rangée brute : set(enveloppée, 5), appel direct', () => el.setK(P, 5).size, () => 'get(brute) ' + el.getK(K))
  ecrit('rangée brute : set(enveloppée, 5), par un alias', () => el.aSetK(P, 5).size, () => 'get(brute) ' + el.getK(K))
  ecrit('rangée enveloppée : set(enveloppée, 5), appel direct', () => el.setP(RP, 5).size, () => 'get(enveloppée) ' + el.getP(RP))
  ecrit('rangée enveloppée : set(enveloppée, 5), par un alias', () => el.aSetP(RP, 5).size, () => 'get(enveloppée) ' + el.getP(RP))
  for (const [lib, fab] of [['µ.state', (m, c) => el.etat(m, c)], ['µ.Store', (m, c) => el.magasin(m, c)]]) {
    const k = { s: 1 }
    let st = fab(new Map([[k, 1]]), k)
    R.push([lib + ' : get(enveloppée), has(enveloppée)', essai(() => st.m.get(st.c) + ' ' + st.m.has(st.c))], [lib + ' : clé sortie, get(clé sortie)', essai(() => st.m.get([...st.m.keys()][0]) + ' ' + st.m.get([...st.m][0][0]))])
    R.push([lib + ' : set(enveloppée, 5)', essai(() => st.m.set(st.c, 5).size + ' ; get(brute) ' + st.m.get(k))])
    st = fab(new Map([[k, 1]]), k)
    R.push([lib + ' : delete(enveloppée)', essai(() => st.m.delete(st.c) + ' ; size ' + st.m.size)])
  }
  el.ecrireKeys()
  el.ecrireEntree()
  el.ecrireForEach()
  await pause(80)
  R.push(['écran après k.nom = \\'z\\' : for k of $m.keys()', el._shadow.querySelector('.c1').textContent], ['écran : [...$m][0][0].nom = \\'z\\'', el._shadow.querySelector('.c2').textContent], ['écran : $m.forEach((v, k) -> k.nom = \\'z\\')', el._shadow.querySelector('.c3').textContent])
  window.__W.length = 0
  el.deuxFormes()
  el.deuxGet()
  el.deuxGet()
  return { R, deux: window.__W.filter((w) => w.includes('deux formes')).length }
})()`
const ATTENDU_CLES = [
  ['clé sortie de keys() === $cle', 'true'], ['clé sortie de keys() === objet brut gardé hors de l\'état', 'false'], ['clé sortie de [...$m] === $cle', 'true'], ['clé de forEach === $cle', 'true'],
  ['rangée brute : get(enveloppée)', '1'], ['rangée brute : get(brute)', '1'], ['rangée brute : has(enveloppée)', 'true'], ['rangée brute : has(brute)', 'true'], ['rangée brute : get(clé sortie)', '1'], ['rangée brute : has(clé sortie)', 'true'],
  ['rangée enveloppée : get(enveloppée)', '1'], ['rangée enveloppée : has(enveloppée)', 'true'],
  ['rangée brute : delete(enveloppée), appel direct', 'true ; size 0'], ['rangée brute : delete(clé sortie), par un alias', 'true ; size 0'], ['rangée enveloppée : delete(enveloppée), appel direct', 'true ; size 0'], ['rangée enveloppée : delete(enveloppée), par un alias', 'true ; size 0'],
  ['rangée brute : set(enveloppée, 5), appel direct', '1 ; get(brute) 5'], ['rangée brute : set(enveloppée, 5), par un alias', '1 ; get(brute) 5'], ['rangée enveloppée : set(enveloppée, 5), appel direct', '1 ; get(enveloppée) 5'], ['rangée enveloppée : set(enveloppée, 5), par un alias', '1 ; get(enveloppée) 5'],
  ...['µ.state', 'µ.Store'].flatMap((lib) => [[lib + ' : get(enveloppée), has(enveloppée)', '1 true'], [lib + ' : clé sortie, get(clé sortie)', '1 1'], [lib + ' : set(enveloppée, 5)', '1 ; get(brute) 5'], [lib + ' : delete(enveloppée)', 'true ; size 0']]),
  ['écran après k.nom = \'z\' : for k of $m.keys()', 'z'], ['écran : [...$m][0][0].nom = \'z\'', 'z'], ['écran : $m.forEach((v, k) -> k.nom = \'z\')', 'z']
]

describe('clé objet d\'une Map : sortie enveloppée comme la valeur, déballée pour get, has, set, delete — valeur précise, donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const faits: Record<string, any> = {}
  const precises = async (prod: boolean): Promise<any> => faits['p' + prod] ??= await jouer(await construire(prod, true, 'precise', COMPOSANTS_PRECISES), SCENARIO_PRECISES, PAGE_JOIN + '\n' + PAGE)
  const cles = async (prod: boolean): Promise<any> => faits['c' + prod] ??= await jouer(await construire(prod, true, 'precise', { 'cles-map': CLES }), SCENARIO_CLES)

  PRECISES.forEach(([nom, cas, , , , depart, apres, garde], i) => {
    it(`${cas} : juste, et ${garde ? 'recalculée' : 'pas recalculée'} après une écriture sans rapport (production : ${garde ? 1 : 0} calcul ; développement : classe ${garde ? 'H' : 'P'}), aucun avertissement`, async () => {
      const vus: any[] = [], attendus: any[] = []
      for (const prod of [false, true]) {
        const { R, W } = await precises(prod)
        const [e0, e1, e2, lu, c1, c2, classe] = R[i]
        vus.push([prod ? 'production' : 'développement', e0, e1, garde ? '-' : e2, lu, prod ? (garde ? [c1] : [c1, c2]) : classe, W.filter((w: string) => w.includes('<mjs-precise-' + nom + '>'))])
        attendus.push([prod ? 'production' : 'développement', '0|' + depart, '1|' + depart, garde ? '-' : '1|' + apres, apres, prod ? (garde ? [1] : [0, 1]) : (garde ? 'H' : 'P'), []])
      }
      assert.deepEqual(vus, attendus)
    })
  })

  it('get, has, delete retrouvent l\'entrée par la clé enveloppée comme par la brute, rangée brute ou enveloppée ; set d\'une clé enveloppée que la Map ne tient pas telle quelle range la brute, une seule entrée ; la clé sortie est l\'enveloppe ; µ.state et µ.Store de même ; une écriture par une clé sortie fait suivre l\'écran — développement et production', async () => {
    for (const prod of [false, true]) assert.deepEqual([prod, ...(await cles(prod)).R], [prod, ...ATTENDU_CLES])
  })

  it('`Map` rangée dans un objet qui tient une clé sous ses deux formes : un avertissement en développement, une seule fois pour elle ; aucun en production', async () => {
    assert.deepEqual([(await cles(false)).deux, (await cles(true)).deux], [1, 0])
  })
})


describe('clé d\'une Map, élément d\'un Set rangés sous l\'enveloppe d\'une autre famille, copie new Map($m), add d\'un objet déjà tenu : l\'entrée retrouvée quelle que soit la forme rangée', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [mode, prod, proxy] of [['enveloppe, développement', false, true], ['enveloppe, production', true, true], ['"proxy": false, développement', false, false], ['"proxy": false, production', true, false]] as [string, boolean, boolean][]) {
    it(`${mode} : composant, parent et enfant, Map dérivée du parent, µ.state, µ.Store, magasin $$, Map rangée dans un objet, copie, Set — get, has, delete, set, add justes, une seule entrée`, async () => {
      const [vu, attendu] = familles(await jouer(await construire(prod, proxy, 'precise', FAMILLES), SCENARIO_FAMILLES), prod, proxy)
      assert.deepEqual(vu, attendu)
    })
  }
})


// une `Map` ou un `Set` qui tient des objets de l'état sous leur enveloppe, rangé dans l'état, reste la même collection : choisi dans une
// liste, donné à deux enfants, tenu par un magasin et un composant, par deux composants, signalé par `µrefresh`, rangé dans un objet, avec
// ses champs et son gel (helpers/partage-collections) ; `WeakMap` et `WeakSet` retrouvent l'entrée par la clé enveloppée comme par la brute
describe('Map, Set rangés dans l\'état : la même collection pour tous ceux qui la tiennent, une seule entrée par objet ; WeakMap et WeakSet retrouvent l\'entrée sous ses deux formes', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [mode, prod, proxy] of [['enveloppe, développement', false, true], ['enveloppe, production', true, true], ['"proxy": false, développement', false, false], ['"proxy": false, production', true, false]] as [string, boolean, boolean][]) {
    it(`${mode} : liste, parent et enfants, µ.Store, deux composants, µrefresh, objet, champ et gel, deux variables, même collection rangée trois fois, deux formes, WeakMap et WeakSet`, async () => {
      const [vu, attendu] = partage(await jouer(await construire(prod, proxy, 'precise', PARTAGE), SCENARIO_PARTAGE, PAGE_PARTAGE), prod, proxy)
      assert.deepEqual(vu, attendu)
    })
  }
})


// index des clés d'une collection de l'état, fait au premier objet qu'elle ne tient sous aucune de ses formes (`has` raté) : une écriture
// de MJS qui retire une entrée (`delete`) ou vide la collection (`clear`) l'oublie, et la liste remplacée part au ramasse-miettes —
// `Set` appelé directement, par un alias, par un chemin, `Map`, `delete` de chaque ligne, `µ.state`, `µ.Store` ; le témoin ne rate rien
const LIGNES = (k: string, avant: string, s: string, apres: string) => `<script>\n${avant}window.__lignes('${k}')${s}\n</script>\n<p class="v">${apres}</p>\n`
const SET    = (k: string, vider: string) => LIGNES(k, '$rows = ', `\n$s = new Set()\n@monter = -> $s = new Set($rows)\n@rater = -> $s.has({i: -1})\n@vider = ->\n  ${vider}\n@remplacer = -> $rows = []`, '{$s.size}')
const OUBLI: Record<string, string> = {
  'ou-set': SET('set', '$s.clear()'),
  'ou-alias': SET('alias', 's = $s\n  s.clear()'),
  'ou-del': SET('del', '$rows.forEach((r) -> $s.delete(r))'),
  'ou-temoin': SET('temoin', '$s.clear()'),
  'ou-chemin': LIGNES('chemin', '$rows = ', '\n$o = {s: new Set()}\n@monter = -> $o.s = new Set($rows)\n@rater = -> $o.s.has({i: -1})\n@vider = -> $o.s.clear()\n@remplacer = -> $rows = []', '{$o.s.size}'),
  'ou-map': LIGNES('map', '$rows = ', '\n$m = new Map()\n@monter = -> $m = new Map($rows.map((r) -> [r, 1]))\n@rater = -> $m.get({i: -1})\n@vider = -> $m.clear()\n@remplacer = -> $rows = []', '{$m.size}'),
  'ou-state': LIGNES('state', 'st = µ.state({s: null, rows: ', '})\n@monter = -> st.s = new Set(st.rows)\n@rater = -> st.s.has({i: -1})\n@vider = -> st.s.clear()\n@remplacer = -> st.rows = []', '-'),
  'ou-store': LIGNES('store', 'sto = new µ.Store({s: null, rows: ', '}).data\n@monter = -> sto.s = new Set(sto.rows)\n@rater = -> sto.s.has({i: -1})\n@vider = -> sto.s.clear()\n@remplacer = -> sto.rows = []', '-')
}
// noms de la page à deux soulignés : le paquet de production, évalué comme un script, déclare ses noms courts sur `window`
const PAGE_OUBLI = `window.__oubli = {}; window.__lignes = (k) => window.__oubli[k] = Array.from({ length: 10000 }, (_, i) => ({ i }));`
// une ligne de chaque liste, suivie par une référence faible : encore en vie après deux passes du ramasse-miettes ?
const SCENARIO_OUBLI = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const R = {}
  for (const n of ${JSON.stringify(Object.keys(OUBLI))}) {
    const el = document.body.appendChild(document.createElement('mjs-' + n))
    await attendre(() => el._shadow?.querySelector('.v'))
    el.monter(); await pause()
    if (n !== 'ou-temoin') el.rater()
    el.vider(); await pause()
    const k = n.slice(3)
    let wr = new WeakRef(window.__oubli[k][5])
    window.__oubli[k] = null
    el.remplacer(); await pause(60)
    window.__gc(); await pause(); window.__gc(); await pause()
    R[n] = String(wr.deref() !== undefined)
    wr = null
  }
  return R
})()`

describe('index des clés d\'une collection de l\'état : delete et clear l\'oublient, rien n\'y reste retenu (ramasse-miettes forcé)', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })
  setFlagsFromString('--expose_gc')
  const gc = runInNewContext('gc')

  for (const [mode, prod, proxy] of [['enveloppe, développement', false, true], ['enveloppe, production', true, true], ['"proxy": false, développement', false, false], ['"proxy": false, production', true, false]] as [string, boolean, boolean][]) {
    it(`${mode} : Set (direct, alias, chemin, delete de chaque ligne), Map, µ.state, µ.Store — après un has raté puis clear ou delete, la liste remplacée ne reste pas en mémoire`, async () => {
      const code   = await construire(prod, proxy, 'precise', OUBLI)
      const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
      window.__gc = gc
      window.eval(PAGE_OUBLI)
      window.eval(code)
      const vu = JSON.parse(JSON.stringify(await window.eval(SCENARIO_OUBLI)))
      await window.happyDOM.close()
      assert.deepEqual(vu, Object.fromEntries(Object.keys(OUBLI).map((n) => [n, 'false'])))
    })
  }
})
