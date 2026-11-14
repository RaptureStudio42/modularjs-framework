// L'écran des valeurs précises de derive-precise-classe-prototype-map-set-donnee-ecrite-par-mjs (`toString` et
// `Symbol.toPrimitive` d'une classe, `toString` d'un prototype fait par `Object.create`, `join` d'une sous-classe de liste, champ
// objet d'une `Map`, objet étiqueté sorti d'un `Set`) : chaque écriture faite par MJS est suivie de `$n += 1`, le rendu relit les
// valeurs. Chromium, Firefox et WebKit sans fenêtre, avec l'enveloppe et avec `"proxy": false`, en développement et en
// production : l'écran montre les valeurs écrites, et le développement n'avertit de rien. De même pour un champ absent au
// départ, venu d'une classe (accesseur qui rend `undefined`) ou d'un prototype fait par `Object.create`, qu'une autre variable
// écrit ensuite (`$ligne.prix = 10`, `$base.prix = 10`), lu par `join`, `??`, `>`, `?.` ou dans une liste parcourue par `map`,
// et pour l'accesseur de symbole d'une classe (`Symbol.toStringTag`, `Symbol.isConcatSpreadable`), pour une clé objet d'une `Map`
// et pour une fonction rangée dans une `Map` ou un `Set`, rendues telles quelles par un parcours (`[...$m]`). Une clé objet d'une
// `Map` en sort enveloppée : la valeur qui la lit reste précise et son écran suit l'écriture faite par une autre variable, sans
// recalcul après une écriture sans rapport (production) ; `get`, `has`, `set`, `delete` la retrouvent sous ses deux formes, et une
// écriture par une clé sortie (`for k of $m.keys()`, `[...$m][0][0]`, `forEach`) fait suivre l'écran

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { FAMILLES, SCENARIO_FAMILLES, familles } from './helpers/familles-cles-map.js'
import { PARTAGE, PAGE_PARTAGE, SCENARIO_PARTAGE, partage } from './helpers/partage-collections.js'

const COMPOSANT = `<script>
$n = 0
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
@w1 = -> $reglages1.devise = 'USD'; $n += 1
@w3 = -> $reglages3.devise = 'USD'; $n += 1
@w4 = -> $reglages4.devise = 'USD'; $n += 1
@w5 = -> $ligne5.prix = 10; $n += 1
@w7 = -> $ligne7.prix = 10; $n += 1
@w8 = -> $ligne8.prix = 10; $n += 1
@lire = -> [$v1, $v3, $v4, $v5, $v7, $v8].join('|')
</script>
<p class="v">{[$n, $v1, $v3, $v4, $v5, $v7, $v8].join('|')}</p>
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
  const el = document.createElement('mjs-ecran')
  document.body.appendChild(el)
  await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const ecran = () => el._shadow.querySelector('.v').textContent
  const depart = [el.lire(), ecran()]
  for (const c of ['1', '3', '4', '5', '7', '8']) {
    el['w' + c]()
    await pause(60)
  }
  return { depart, fin: [el.lire(), ecran()], W: window.__W.filter((w) => w.includes('a servi son dernier calcul')) }
})()`

const DEPART = ['5 EUR|5 EUR|5 EUR|2|2|L2', '0|5 EUR|5 EUR|5 EUR|2|2|L2']
const FIN    = ['5 USD|5 USD|5 USD|10|10|L10', '6|5 USD|5 USD|5 USD|10|10|L10']

async function construire(prod: boolean, proxy: boolean, composants: Record<string, string> = { ecran: COMPOSANT }): Promise<string> {
  const root   = mjsTmp('classe-map-set-ecran')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), source)
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

describe('valeurs précises, l\'écran : classe, prototype, sous-classe de liste, Map, Set — donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const codes: Record<string, string> = {}
  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : enveloppe et "proxy": false, développement et production, l'écran suit, aucun avertissement`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const vus: any[] = []
      try {
        for (const proxy of [true, false]) {
          for (const prod of [false, true]) {
            const cle  = (proxy ? 'enveloppe' : '"proxy": false') + ', ' + (prod ? 'production' : 'développement')
            const code = codes[cle] ??= await construire(prod, proxy)
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${PAGE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            const r = await page.evaluate(SCENARIO)
            vus.push([cle, r.depart, r.fin, r.W])
            await page.close()
          }
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(vus, vus.map(([cle]) => [cle, DEPART, FIN, []]))
    })
  }
})

// champ absent au départ, venu d'une classe (accesseur qui rend `undefined`) ou d'un prototype fait par `Object.create`, et
// accesseur de symbole d'une classe, écrits ensuite par une autre variable du composant : [nom, déclarations, valeur dérivée,
// écriture faite par MJS]. Un composant par cas : le doute de l'un ne déteint pas sur l'autre
const ABSENTS: string[][] = [
  ['classe-join', 'l = {}\n$ligne = l\n$c = window.prixBrut(l)', '[$c.prix].join(\'\')', '$ligne.prix = 10'],
  ['classe-defaut', 'l = {}\n$ligne = l\n$c = window.prixBrut(l)', '[$c.prix ?? 0].join(\'\')', '$ligne.prix = 10'],
  ['classe-comparaison', 'l = {}\n$ligne = l\n$c = window.prixBrut(l)', '[$c.prix > 5].join(\'\')', '$ligne.prix = 10'],
  ['prototype-join', 'b = {}\n$base = b\n$o = Object.create(b)', '[$o.prix].join(\'\')', '$base.prix = 10'],
  ['prototype-chainage', 'b = {}\n$base = b\n$o = Object.create(b)', '$o.prix?.toFixed(1)', '$base.prix = 10'],
  ['liste-classe', 'l = {}\n$ligne = l\n$liste = [window.prixBrut(l)]', '$liste.map((x) -> x.prix).join(\',\')', '$ligne.prix = 10'],
  ['classe-etiquette', 't = {}\n$reglages = t\n$c = window.etiquetteBrute(t)', '[$c].join(\'\')', '$reglages.tag = \'USD\''],
  ['classe-concat', 'l = {}\n$ligne = l\n$c = window.etaleBrut(l)', '[].concat($c).length', '$ligne.on = true']
]
const COMPOSANTS_ABSENTS = Object.fromEntries(ABSENTS.map(([nom, d, v, w]) => ['absent-' + nom, '<script>\n$n = 0\n' + d + '\n$v = ' + v + '\n@w = ->\n  ' + w + '\n  $n += 1\n@lire = -> String($v)\n</script>\n<p class="v">{[$n, $v].join(\'|\')}</p>\n']))

const SCENARIO_ABSENTS = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const els = ${JSON.stringify(ABSENTS.map(([nom]) => nom))}.map((nom) => document.body.appendChild(document.createElement('mjs-absent-' + nom)))
  for (const el of els) await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const tout = () => els.map((el) => el.lire() + ' ' + el._shadow.querySelector('.v').textContent)
  const depart = tout()
  for (const el of els) {
    el.w()
    await pause(60)
  }
  return { depart, fin: tout(), W: window.__W.filter((w) => w.includes('dernier calcul')) }
})()`

// valeur lue et écran de chaque cas, au départ puis après toutes les écritures
const DEPART_ABSENTS = [' 0|', '0 0|0', 'false 0|false', ' 0|', 'undefined 0|', ' 0|', '[object Object] 0|[object Object]', '1 0|1']
const FIN_ABSENTS    = ['10 1|10', '10 1|10', 'true 1|true', '10 1|10', '10.0 1|10.0', '10 1|10', '[object USD] 1|[object USD]', '2 1|2']

describe('valeurs précises, l\'écran : champ absent au départ ou accesseur de symbole, venus d\'une classe ou d\'un prototype — donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const codes: Record<string, string> = {}
  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : accesseur de classe qui rend \`undefined\` au départ et champ absent d'un objet fait par \`Object.create\`, lus par \`join\`, \`??\`, \`>\`, \`?.\`, \`map\`, accesseurs \`Symbol.toStringTag\` et \`Symbol.isConcatSpreadable\` d'une classe — l'écran suit, aucun avertissement, enveloppe et "proxy": false, développement et production`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const vus: any[] = []
      try {
        for (const proxy of [true, false]) {
          for (const prod of [false, true]) {
            const cle  = (proxy ? 'enveloppe' : '"proxy": false') + ', ' + (prod ? 'production' : 'développement')
            const code = codes[cle] ??= await construire(prod, proxy, COMPOSANTS_ABSENTS)
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${PAGE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            const r = await page.evaluate(SCENARIO_ABSENTS)
            vus.push([cle, r.depart, r.fin, r.W])
            await page.close()
          }
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(vus, vus.map(([cle]) => [cle, DEPART_ABSENTS, FIN_ABSENTS, []]))
    })
  }
})

// clé objet d'une `Map`, et fonction rangée dans une `Map` ou un `Set`, que la valeur précise reçoit telles quelles d'un parcours
// (`[...$m]`, puis `map`, `find`, `at`, `flat`, `reduce`…), écrites ensuite par une autre variable du composant : [nom,
// déclarations, valeur dérivée, écriture faite par MJS, valeur lue au départ, valeur lue après l'écriture]. Un composant par cas
const SORTIES: string[][] = [
  ['cle-map', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-nom-et-valeur', 'k = {nom: \'a\'}\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e) -> e[0].nom + e[1]).join(\',\')', '$cle.nom = \'z\'', 'a1', 'z1'],
  ['cle-map-lignes-choisies', '$rows = [{nom: \'a\'}, {nom: \'b\'}]\n$choix = new Map()\n$choix.set($rows[0], 1)', '[...$choix].map((e) -> e[0].nom + e[1]).join(\',\')', '$rows[0].nom = \'z\'', 'a1', 'z1'],
  ['cle-map-indice', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m][0][0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-at', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].at(0)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-find', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].find((e) -> e[1] == 1)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-findlast', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].findLast((e) -> e[1] == 1)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-flat', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].flat()[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-flatmap', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].flatMap((e) -> e)[0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-reduce', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].reduce(((a, e) -> a + e[0].prix), 0)].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-filter', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].filter((e) -> e[0].prix > 5).length].join(\'\')', '$cle.prix = 10', '0', '1'],
  ['cle-map-some', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].some((e) -> e[0].prix > 5)].join(\'\')', '$cle.prix = 10', 'false', 'true'],
  ['cle-map-every', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].every((e) -> e[0].prix < 5)].join(\'\')', '$cle.prix = 10', 'true', 'false'],
  ['cle-map-findindex', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].findIndex((e) -> e[0].prix > 5)].join(\'\')', '$cle.prix = 10', '-1', '0'],
  ['cle-map-slice', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[...$m].slice(0)[0][0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-concat', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[[].concat([...$m])[0][0].prix].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-etalee-dans-un-appel', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[Math.max(...[...$m].map((e) -> e[0].prix))].join(\'\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-liste-du-rappel', 'k = {prix: 2}\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e, i, a) -> a[0][0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-tostring', 'k = new window.Nom(\'a\')\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].join(\';\')', '$cle.n = \'z\'', 'a,1', 'z,1'],
  ['cle-map-liste', 'k = [1, 2]\n$cle = k\n$m = new Map([[k, 1]])', '[...$m].map((e) -> e[0].length).join(\',\')', '$cle.push(3)', '2', '3'],
  ['cle-map-fonction', 'f = window.fnNom()\n$f = f\n$m = new Map([[f, 1]])', '[...$m].map((e) -> e[0].nom).join(\',\')', '$f.nom = \'z\'', 'a', 'z'],
  ['cle-sous-classe-map', 'k = {prix: 2}\n$cle = k\n$m = new window.MaMap([[k, 1]])', '[...$m].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-dans-un-objet', 'k = {prix: 2}\n$cle = k\n$o = {m: new Map([[k, 1]])}', '[...$o.m].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-dans-une-liste', 'k = {prix: 2}\n$cle = k\n$l = [new Map([[k, 1]])]', '[...$l[0]].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-valeur-d-une-map', 'k = {prix: 2}\n$cle = k\n$mm = new Map([[\'a\', new Map([[k, 1]])]])', '[...[...$mm][0][1]].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-dans-un-set', 'k = {prix: 2}\n$cle = k\n$s = new Set([new Map([[k, 1]])])', '[...[...$s][0]].map((e) -> e[0].prix).join(\',\')', '$cle.prix = 10', '2', '10'],
  ['cle-map-cle-d-une-map', 'l = {prix: 2}\n$ligne = l\n$mm = new Map([[new Map([[\'a\', l]]), 1]])', '[...[...$mm][0][0]].map((e) -> e[1].prix).join(\',\')', '$ligne.prix = 10', '2', '10'],
  ['valeur-fonction-map', 'f = window.fnNom()\n$f = f\n$m = new Map([[\'a\', f]])', '[...$m].map((e) -> e[1].nom).join(\',\')', '$f.nom = \'z\'', 'a', 'z'],
  ['element-fonction-set', 'f = window.fnNom()\n$f = f\n$s = new Set([f])', '[...$s].map((x) -> x.nom).join(\',\')', '$f.nom = \'z\'', 'a', 'z']
]
const COMPOSANTS_SORTIES = Object.fromEntries([...SORTIES.map(([nom, d, v, w]) => ['sortie-' + nom, d, v, w])].map(([nom, d, v, w]) => [nom, '<script>\n$n = 0\n' + d + '\n$v = ' + v + '\n@w = ->\n  ' + w + '\n  $n += 1\n@lire = -> String($v)\n</script>\n<p class="v">{[$n, $v].join(\'|\')}</p>\n']))

const SCENARIO_SORTIES = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const els = ${JSON.stringify(Object.keys(COMPOSANTS_SORTIES))}.map((nom) => document.body.appendChild(document.createElement('mjs-' + nom)))
  for (const el of els) await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const tout = () => els.map((el) => el.lire() + ' ' + el._shadow.querySelector('.v').textContent)
  const depart = tout()
  for (const el of els) {
    el.w()
    await pause(60)
  }
  return { depart, fin: tout(), W: window.__W.filter((w) => w.includes('dernier calcul')) }
})()`

// valeur lue et écran de chaque cas, au départ puis après toutes les écritures
const DEPART_SORTIES = SORTIES.map(([, , , , d]) => d + ' 0|' + d)
const FIN_SORTIES    = SORTIES.map(([, , , , , f]) => f + ' 1|' + f)

describe('valeurs précises, l\'écran : clé objet d\'une Map, fonction rangée dans une Map ou un Set, rendues telles quelles par un parcours — donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const codes: Record<string, string> = {}
  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : clé objet d'une \`Map\` lue par \`map\`, un indice, \`at\`, \`find\`, \`flat\`, \`reduce\`…, sous-classe, \`Map\` rangée dans un objet, une liste, une autre \`Map\` ou un \`Set\`, fonction rangée dans une \`Map\` ou un \`Set\` — l'écran suit, aucun avertissement, enveloppe et "proxy": false, développement et production`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const vus: any[] = []
      try {
        for (const proxy of [true, false]) {
          for (const prod of [false, true]) {
            const cle  = (proxy ? 'enveloppe' : '"proxy": false') + ', ' + (prod ? 'production' : 'développement')
            const code = codes[cle] ??= await construire(prod, proxy, COMPOSANTS_SORTIES)
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${PAGE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            const r = await page.evaluate(SCENARIO_SORTIES)
            vus.push([cle, r.depart, r.fin, r.W])
            await page.close()
          }
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(vus, vus.map(([cle]) => [cle, DEPART_SORTIES, FIN_SORTIES, []]))
    })
  }
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

// valeurs précises, écran et compteur ; déballage, identité, écran après une écriture par une clé sortie : l'enveloppe, en
// développement et en production
describe('l\'écran : clé objet d\'une Map sortie enveloppée comme la valeur, déballée pour get, has, set, delete — valeur précise, donnée écrite par MJS', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const codes: Record<string, string> = {}
  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : clé d'une \`Map\` lue par \`[...$m]\` (ligne choisie, clé tenue, sous-classe, \`Map\` rangée dans un objet ou en clé), précise et juste à l'écran ; clé fonction qui doute ; get, has, set, delete sous les deux formes ; écran après une écriture par une clé sortie — développement et production, aucun avertissement`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const vus: any[] = [], attendus: any[] = []
      try {
        for (const prod of [false, true]) {
          const mode = prod ? 'production' : 'développement'
          const code = codes[mode] ??= await construire(prod, true, { ...COMPOSANTS_PRECISES, 'cles-map': CLES })
          const page = await browser.newPage()
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${PAGE_JOIN}\n${PAGE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
          await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
          await page.goto('http://mjs.test/')
          const p = await page.evaluate(SCENARIO_PRECISES)
          const c = await page.evaluate(SCENARIO_CLES)
          PRECISES.forEach(([nom, , , , , depart, apres, garde], i) => {
            const [e0, e1, e2, lu, c1, c2, classe] = p.R[i]
            vus.push([mode, nom, e0, e1, garde ? '-' : e2, lu, prod ? (garde ? [c1] : [c1, c2]) : classe])
            attendus.push([mode, nom, '0|' + depart, '1|' + depart, garde ? '-' : '1|' + apres, apres, prod ? (garde ? [1] : [0, 1]) : (garde ? 'H' : 'P')])
          })
          vus.push([mode, c.R, c.deux, p.W])
          attendus.push([mode, ATTENDU_CLES, prod ? 0 : 1, []])
          await page.close()
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(vus, attendus)
    })
  }
})

// clé d'une `Map`, élément d'un `Set` rangés sous l'enveloppe d'une autre famille (composant parent, `µ.state`, `µ.Store`, magasin `$$`),
// copie `new Map($m)`, `add` d'un objet que le `Set` tient déjà : mêmes composants et mêmes valeurs que la série happy-dom
// (helpers/familles-cles-map) — l'écran de l'enfant, de la `Map` dérivée du parent et de la copie montre les valeurs, `get`, `has`,
// `delete`, `set`, `add` retrouvent l'entrée quelle que soit la forme rangée
describe('l\'écran : clé d\'une Map, élément d\'un Set rangés sous l\'enveloppe d\'une autre famille, copie new Map($m), add d\'un objet déjà tenu', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const codes: Record<string, string> = {}
  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : composant, parent et enfant, Map dérivée du parent, µ.state, µ.Store, magasin $$, Map rangée dans un objet, copie, Set — l'écran et les valeurs justes, enveloppe et "proxy": false, développement et production`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const vus: any[] = [], attendus: any[] = []
      try {
        for (const proxy of [true, false]) {
          for (const prod of [false, true]) {
            const cle  = (proxy ? 'enveloppe' : '"proxy": false') + ', ' + (prod ? 'production' : 'développement')
            const code = codes[cle] ??= await construire(prod, proxy, FAMILLES)
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${PAGE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            const [vu, attendu] = familles(await page.evaluate(SCENARIO_FAMILLES), prod, proxy)
            vus.push([cle, vu])
            attendus.push([cle, attendu])
            await page.close()
          }
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(vus, attendus)
    })
  }
})

// une `Map` ou un `Set` qui tient des objets de l'état sous leur enveloppe, rangé dans l'état, reste la même collection pour tous ceux qui
// la tiennent ; `WeakMap` et `WeakSet` retrouvent l'entrée sous ses deux formes : mêmes composants et mêmes valeurs que la série happy-dom
// (helpers/partage-collections)
describe('l\'écran : Map, Set rangés dans l\'état, la même collection pour tous ceux qui la tiennent ; WeakMap et WeakSet', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const codes: Record<string, string> = {}
  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : liste, parent et enfants, µ.Store, deux composants, µrefresh, objet, champ et gel, deux variables, deux formes, WeakMap et WeakSet — les valeurs et l'écran justes, enveloppe et "proxy": false, développement et production`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const vus: any[] = [], attendus: any[] = []
      try {
        for (const proxy of [true, false]) {
          for (const prod of [false, true]) {
            const cle  = (proxy ? 'enveloppe' : '"proxy": false') + ', ' + (prod ? 'production' : 'développement')
            const code = codes[cle] ??= await construire(prod, proxy, PARTAGE)
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${PAGE_PARTAGE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            const [vu, attendu] = partage(await page.evaluate(SCENARIO_PARTAGE), prod, proxy)
            vus.push([cle, vu])
            attendus.push([cle, attendu])
            await page.close()
          }
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(vus, attendus)
    })
  }
})
