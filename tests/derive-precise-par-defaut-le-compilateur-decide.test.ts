// Valeurs dérivées précises avec l'option `derived: "precise"` (mjs.config.json) : le compilateur décide. Une valeur dérivée faite de variables `$` du composant, de
// littéraux, d'opérateurs, de champs lus sur ces variables et d'appels de la liste courte (méthodes de liste et de chaîne,
// `Math.*`…) suit ses sources, sauf quand elle repasse à l'horloge : la boutique (un filtre de 1 000 articles à côté d'un
// panier) ne refait plus le filtre à chaque clic. Seulement là où la précision peut épargner un calcul coûteux : une valeur
// faite de lectures, de `.length` et d'opérateurs reste à l'horloge (la refaire coûte moins que la vérifier), sauf lue par
// une valeur précise ; une valeur précise dont une source est écrite avant chaque lecture reste précise : relue après une
// écriture sans rapport, elle sert la même valeur, sans calcul. Tout le reste garde la
// règle de toujours : refaite à sa lecture après toute écriture du composant. Dans le doute à l'exécution (accesseur d'une
// classe, Proxy de la page, conversion d'un objet gelé, objet tenu par un autre composant ou par `µ.state`, objet brut,
// accesseur posé par la variable), la valeur repasse à cette règle, sans plantage : relue après une écriture sans rapport,
// elle rend la valeur d'avant ; l'affichage, qui ne suit que ses sources, reste celui d'avant lui aussi, sauf pour un objet
// que tient aussi un autre composant : quand celui-ci l'écrit, le composant qui le garde se redessine et l'écran suit, comme sans l'option. Un accesseur propre
// à l'objet (posé avant que la variable le reçoive) ne se regarde pas à la lecture : quand ce qu'il rend change (ici une
// donnée de la page, changée hors de MJS), `µrefresh($sel)` juste après le changement rend la valeur de la règle de toujours,
// et l'écran la suit. Développement et production ; happy-dom, Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BOUTIQUE = `<script module>
fabriquer = (n) -> [0...n].map((i) -> ({id: i + 1, name: 'article ' + i}))
</script>
<script>
$items = fabriquer(1000)
$search = ''
$cart = 0
$found = $items.filter((a) -> a.name.includes($search))
$banner = "#{$cart} au panier, #{$found.length} trouvés"
$total = $items.length + $cart
$max = $cart + 500
$sous = $items.filter((a) -> a.id < $max).length
$borne = 3
$premiers = $items.filter((a) -> a.id <= $borne)
@borner = -> $borne += 1
@ajouter = -> $cart += 1
@chercher = (q) -> $search = q
@renommer = (i, n) -> $items[i].name = n
</script>
<p class="b">{$banner}</p>
`

const DOUTE = `<script module>
window.__mjsEtat = µ.state({g: 1})
</script>
<script>
$n = 0
$sel = null
$d = 'v' + [$sel?.g ?? 0].join('')
$conv = 'c' + [$sel ?? ''].join('')
$paire = [$n, 1]
$horloge = window.innerWidth + $n
@autre = -> $n += 1
@choisir = (x) -> $sel = x
@brut = (x) -> $sel = µraw(x)
@ecrireAlias = ->
  t = $sel
  t.g = 5
@poserAcc = -> Object.defineProperty($sel, 'g', {get: (-> window.__ext5.a), configurable: true, enumerable: true})
$liste = [1, 2, 3]
$noms = $liste.map((x) -> x).join(',')
$tot = [$liste.total ?? 0].join('')
@choisirListe = (x) -> $liste = x
@reaffecter = -> µrefresh($sel)
@rafraichirListe = -> µrefresh($liste)
</script>
<p class="d">{$d}</p>
<p class="dx">{$d + '|' + $n}</p>
<p class="lx">{$noms + '|' + $n}</p>
<p class="tx">{$tot + '|' + $n}</p>
`

// un magasin : le cœur porte aussi ses écritures (mjs_store_globals.ts), et la machinerie des dérivées s'y ajoute
const AUTRE = `<script>
$o = {g: 1}
$p = null
@objet = -> $o
@changer = -> $o.g = 9
@tenir = (x) -> $p = x
@changerTenu = -> $p.g = 9
@tenirBrut = (x) -> $p = µraw(x)
$$visites = 0
</script>
<p>{$o.g} {$$visites}</p>
`

// joué dans la page : chaque cas rend la valeur lue après une écriture sans rapport (`autre`), et le texte affiché
const SCENARIO = `(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 20))
  const b = document.querySelector('mjs-derive-defaut-boutique')
  const e = document.querySelector('mjs-derive-defaut-doute')
  const a = document.querySelector('mjs-derive-defaut-autre')
  const R = {}
  const avant = b._state.found
  for (let i = 0; i < 100; i++) b.ajouter()
  R.boutiqueMeme = b._state.found === avant
  R.banniere = b._state.banner
  b.chercher('article 7')
  R.trouves = b._state.found.length
  b.renommer(0, 'article 7x')
  R.trouvesApresRenommage = b._state.found.length
  R.sous = b._state.sous + ' ' + b._state.total
  const p0 = b._state.premiers
  b.ajouter()
  R.premiersGarde = b._state.premiers === p0
  for (let i = 0; i < 7; i++) { b.borner(); b._state.premiers }
  const p7 = b._state.premiers
  b.ajouter()
  R.septRatesGarde = b._state.premiers === p7
  for (let i = 0; i < 8; i++) { b.borner(); b._state.premiers }
  const p8 = b._state.premiers
  b.ajouter()
  const p9 = b._state.premiers
  R.huitRatesGarde = p9 === p8 && p9.length === 18
  b.ajouter()
  R.repriseGarde = b._state.premiers === p9
  const paire = e._state.paire
  e.choisir({g: 2})
  R.paireMeme = e._state.paire === paire
  e.autre()
  R.paireRefaite = e._state.paire !== paire && e._state.paire[0] === 1
  const cas = async (nom, poser, changer, cle = 'd') => {
    try {
      e.autre(); await pause()
      poser(); await pause()
      const avant = String(e._state[cle])
      changer(); await pause()
      e.autre(); await pause()
      R[nom] = avant + ' → ' + String(e._state[cle]) + ' | écran ' + (e._shadow?.querySelector('.d')?.textContent ?? 'perdu')
    }
    catch (err) { R[nom] = 'lève : ' + String(err.message).slice(0, 80) }
  }
  window.__ext2 = {a: 1}
  class V { get g() { return window.__ext2.a } }
  await cas('classe', () => e.choisir(new V()), () => { window.__ext2.a = 5 })
  window.__ext3 = {a: 1}
  await cas('proxy', () => e.choisir(new Proxy({}, {get: (t, k) => k === 'g' ? window.__ext3.a : undefined})), () => { window.__ext3.a = 5 })
  await cas('proxyCles', () => e.choisir(new Proxy({}, {ownKeys: () => ['g'], get: (t, k) => k === 'g' ? 7 : undefined})), () => {})
  window.__ext4 = {a: 1}
  await cas('gele', () => e.choisir(Object.freeze({[Symbol.toPrimitive]: () => 'P' + window.__ext4.a})), () => { window.__ext4.a = 5 }, 'conv')
  await cas('autreComposant', () => e.choisir(a.objet()), () => a.changer())
  await cas('tenuEnsuite', () => { window.__o = {g: 1}; e.choisir(window.__o); a.tenir(window.__o) }, () => a.changerTenu())
  await cas('etat', () => e.choisir(window.__mjsEtat), () => { window.__mjsEtat.g = 4 })
  await cas('brut', () => { window.__b = {g: 1}; e.brut(window.__b) }, () => { window.__b.g = 3 })
  await cas('brutParUnAutre', () => { window.__b2 = {g: 1}; e.choisir(window.__b2); a.tenirBrut(window.__b2) }, () => e.ecrireAlias())
  window.__ext5 = {a: 1}
  await cas('accesseurPoseEnsuite', () => { e.choisir({g: 1}); e.poserAcc() }, () => { window.__ext5.a = 8 })
  // une instance neuve par cas (le doute d'une valeur précise dure) ; l'écran lit aussi $n, que l'écriture sans rapport change
  const neuf = async () => {
    const x = document.createElement('mjs-derive-defaut-doute')
    document.body.appendChild(x)
    const fin = Date.now() + 4000
    while (!x._shadow?.querySelector('.lx') && Date.now() < fin) await pause()
    return x
  }
  const casNeuf = async (nom, cle, cls, poser, changer) => {
    try {
      const x = await neuf()
      x.autre(); await pause()
      poser(x); await pause()
      const avant = String(x._state[cle])
      changer(x); await pause()
      x.autre(); await pause()
      R[nom] = avant + ' → ' + String(x._state[cle]) + ' | écran ' + String(x._shadow?.querySelector('.' + cls)?.textContent ?? 'perdu').split('|')[0]
    }
    catch (err) { R[nom] = 'lève : ' + String(err.message).slice(0, 80) }
  }
  // accesseur posé sur la liste brute avant de la donner à la variable : il lit une donnée de la page, signalée par
  // µrefresh($liste)
  window.__x1 = {a: 1}
  await casNeuf('listeAccesseurIndice', 'noms', 'lx', (x) => { const l = [0, 2, 3]; Object.defineProperty(l, 0, {get: () => window.__x1.a, enumerable: true, configurable: true}); x.choisirListe(l) }, (x) => { window.__x1.a = 5; x.rafraichirListe() })
  window.__x2 = {a: 1}
  await casNeuf('listeAccesseurChamp', 'tot', 'tx', (x) => { const l = [1]; Object.defineProperty(l, 'total', {get: () => window.__x2.a, configurable: true}); x.choisirListe(l) }, (x) => { window.__x2.a = 5; x.rafraichirListe() })
  await casNeuf('reaffecterAutreVariable', 'noms', 'lx', (x) => { window.__l2 = [1, 2]; x.choisirListe(window.__l2); x.choisir(window.__l2) }, (x) => { window.__l2.push(3); x.reaffecter() })
  // accesseur propre à l'objet, que la lecture ne regarde pas : il lit ici une donnée de la page, changée hors de MJS ;
  // µrefresh($sel) juste après le rend à la règle de toujours, et l'écran suit
  window.__ext = {a: 1}
  await casNeuf('accesseur', 'd', 'd', (x) => x.choisir(Object.defineProperty({}, 'g', {get: () => window.__ext.a, enumerable: true})), (x) => { window.__ext.a = 5; x.reaffecter() })
  return R
})()`

const ATTENDU = {
  boutiqueMeme: true,
  banniere: '100 au panier, 1000 trouvés',
  trouves: 111,
  trouvesApresRenommage: 112,
  sous: '599 1100',
  premiersGarde: true,
  septRatesGarde: true,
  huitRatesGarde: true,
  repriseGarde: true,
  paireMeme: true,
  paireRefaite: true,
  accesseur: 'v1 → v5 | écran v5',
  classe: 'v1 → v5 | écran v1',
  proxy: 'v1 → v5 | écran v1',
  proxyCles: 'v7 → v7 | écran v7',
  gele: 'cP1 → cP5 | écran v0',
  autreComposant: 'v1 → v9 | écran v9',
  tenuEnsuite: 'v1 → v9 | écran v9',
  etat: 'v1 → v4 | écran v1',
  brut: 'v1 → v3 | écran v1',
  brutParUnAutre: 'v1 → v5 | écran v1',
  accesseurPoseEnsuite: 'v1 → v8 | écran v1',
  listeAccesseurIndice: '1,2,3 → 5,2,3 | écran 5,2,3',
  listeAccesseurChamp: '1 → 5 | écran 5',
  reaffecterAutreVariable: '1,2 → 1,2,3 | écran 1,2,3',
}

const CORPS = '<mjs-derive-defaut-boutique></mjs-derive-defaut-boutique><mjs-derive-defaut-doute></mjs-derive-defaut-doute><mjs-derive-defaut-autre></mjs-derive-defaut-autre>'

async function construire(prod: boolean): Promise<{ code: string, sortie: string }> {
  const root   = mjsTmp('derive-defaut')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-defaut-boutique.mjs'), BOUTIQUE)
  writeFileSync(join(srcDir, 'derive-defaut-doute.mjs'), DOUTE)
  writeFileSync(join(srcDir, 'derive-defaut-autre.mjs'), AUTRE)
  // la précision des valeurs calculées est une option d'appli (`derived: "precise"`, mjs.config.json)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
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
  const sortie = files.filter((f) => f.startsWith('derive-defaut-doute') || f.startsWith('derive-defaut-boutique') || f === 'bundle.js').map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { code, sortie }
}

describe('valeurs dérivées précises, option derived precise : le compilateur décide, la règle de toujours dans le doute', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let construit: { code: string, sortie: string }
      before(async () => { construit = await construire(prod) })

      // le paquet de production renomme les fonctions du cœur : les sources se lisent dans le code de développement
      if (!prod) it('le compilateur nomme les sources d\'une valeur précise, et seulement d\'elle', () => {
        assert.doesNotMatch(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]horloge['"][^;\n]*?\[/)
        assert.match(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]paire['"], ?[^;]*?, ?\[["']n["']\]\)/)
        assert.match(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]d['"], ?[^;]*?, ?\[["']\.g["'], ?["']sel["']\]\)/)
      })

      // la refaire coûte moins que la vérifier : lectures, `.length`, opérateurs restent à l'horloge, sauf lus par une valeur précise
      if (!prod) it('une valeur au calcul simple reste à l\'horloge, sauf lue par une valeur précise', () => {
        assert.doesNotMatch(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]total['"][^;\n]*?\[["']/)
        assert.doesNotMatch(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]banner['"][^;\n]*?\[["']/)
        assert.match(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]total['"]/)
        assert.match(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]max['"], ?[^;]*?, ?\[["']cart["']\]\)/)
        assert.match(construit.sortie, /_mjs_setComputed\(_mjsThis, ?['"]sous['"], ?[^;]*?, ?\[["']\.id["'], ?["']cart["'], ?["']items["'], ?["']max["']\]\)/)
      })

      it('happy-dom : le gain là où il est prouvé, la valeur de toujours dans le doute, aucun écran perdu', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(construit.code)
        window.document.body.innerHTML = CORPS
        const fin = Date.now() + 5000
        while (!window.document.querySelector('mjs-derive-defaut-doute')?._shadow?.querySelector('.d') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        // objets de la fenêtre de happy-dom : comparés par leur texte
        const r = await window.eval(SCENARIO)
        assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
        await window.happyDOM.close()
      })

      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : le gain là où il est prouvé, la valeur de toujours dans le doute, aucun écran perdu`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          try {
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${CORPS}<script>${construit.code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            await page.waitForFunction(() => !!(document.querySelector('mjs-derive-defaut-doute') as any)?._shadow?.querySelector('.d'))
            assert.deepEqual(await page.evaluate(SCENARIO), ATTENDU)
          }
          finally {
            await browser.close()
          }
        })
      }
    })
  }
})
