// valeur précise et accesseur posé après coup sur la liste qu'elle lit, ou sur un élément objet de cette liste. Posé par la
// variable (`Object.defineProperty($liste, 0, …)`) : MJS le voit à l'écriture, la valeur rend celle de la règle de toujours
// (refaite après toute écriture du composant), et l'écran la même chose. Posé sur l'objet brut gardé ailleurs, ou porté par un
// objet que la variable reçoit tout fait (élément poussé, liste neuve, ancienne liste remise) : ce que l'accesseur rend change
// hors de MJS (il lit ici une donnée de la page), la lecture ne le regarde pas ; `µrefresh($liste)` juste après le changement
// le signale, et la valeur rend alors celle de la règle de toujours. Sans ce signal, la valeur garde son dernier calcul : ni
// l'écriture d'une autre variable (`$pos = {x}`) ni une méthode appelée par la variable (`$liste.push(9)`) n'y changent rien.
// `µrefresh($liste)` après un changement fait hors de MJS refait la valeur et redessine ce qui affiche la variable, sans autre
// écriture ; les valeurs qui lisent la variable repassent alors à la règle de toujours, pour toujours (un changement fait
// ensuite hors de MJS se voit à la lecture suivante), les autres gardent leur précision. Développement et production ;
// happy-dom, Chromium, Firefox et WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FRONTIERE = `<script>
$n = 0
$pos = null
$liste = [1, 2, 3]
$noms = $liste.map((x) -> x).join(',')
$vs = $liste.map((x) -> x?.v ?? x).join(',')
$po = [$pos?.x ?? 0].join('')
@autre = -> $n += 1
@bouger = -> $pos = {x: $n}
@poser = (o) -> $pos = o
@choisirListe = (x) -> $liste = x
@reaffecterListe = -> µrefresh($liste)
@pousser = (x) -> $liste.push(x)
@defIndice = -> Object.defineProperty($liste, 0, {get: (-> window.__f1.a), enumerable: true, configurable: true})
@defElem = -> Object.defineProperty($liste[0], 'v', {get: (-> window.__f7.a), enumerable: true, configurable: true})
</script>
<p class="lx">{$noms + '|' + $n}</p>
<p class="vx">{$vs + '|' + $n}</p>
<p class="seul">{$noms}</p>
<p class="long">{$liste.length}</p>
<p class="px">{$po + '|' + $n}</p>
`

// joué dans la page : une instance neuve par cas (le doute d'une valeur précise dure) ; poser, lire, changer, écrire une autre
// variable ($n, que l'écran lit aussi), relire : « avant → après | écran »
const SCENARIO = `(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 20))
  const R = {}
  const neuf = async () => {
    const x = document.createElement('mjs-derive-frontiere')
    document.body.appendChild(x)
    const fin = Date.now() + 4000
    while (!x._shadow?.querySelector('.lx') && Date.now() < fin) await pause()
    return x
  }
  const cas = async (nom, cle, cls, poser, changer) => {
    try {
      const x = await neuf()
      x.autre(); await pause()
      poser(x); await pause()
      const avant = String(x._state[cle])
      await changer(x); await pause()
      x.autre(); await pause()
      R[nom] = avant + ' → ' + String(x._state[cle]) + ' | écran ' + String(x._shadow?.querySelector('.' + cls)?.textContent ?? 'perdu').split('|')[0]
    }
    catch (err) { R[nom] = 'lève : ' + String(err.message).slice(0, 80) }
  }
  const acc = (o, k, g) => Object.defineProperty(o, k, {get: () => g.a, enumerable: true, configurable: true})
  window.__f1 = {a: 1}
  await cas('indicePoseParLaVariable', 'noms', 'lx', (x) => x.choisirListe([0, 2, 3]), async (x) => { x.defIndice(); await pause(); String(x._state.noms); window.__f1.a = 5 })
  const f2 = {a: 1}
  await cas('indicePoseSurLeBrutSansEcriture', 'noms', 'lx', (x) => { window.__r2 = [0, 2, 3]; x.choisirListe(window.__r2) }, (x) => { acc(window.__r2, 0, f2); String(x._state.noms); f2.a = 5 })
  const f3 = {a: 1}
  await cas('indicePoseSurLeBrutPuisReaffecteeUneFois', 'noms', 'lx', (x) => { window.__r3 = [0, 2, 3]; x.choisirListe(window.__r3) }, async (x) => { acc(window.__r3, 0, f3); x.reaffecterListe(); await pause(); String(x._state.noms); f3.a = 5 })
  const f4 = {a: 1}
  await cas('indicePoseSurLeBrutPuisReaffecteeChaqueFois', 'noms', 'lx', (x) => { window.__r4 = [0, 2, 3]; x.choisirListe(window.__r4) }, async (x) => { acc(window.__r4, 0, f4); x.reaffecterListe(); await pause(); String(x._state.noms); f4.a = 5; x.reaffecterListe() })
  const f5 = {a: 1}
  await cas('elementAccesseurPousseParLaVariable', 'vs', 'vx', (x) => x.choisirListe([1, 2]), async (x) => { x.pousser(acc({}, 'v', f5)); await pause(); String(x._state.vs); f5.a = 5; x.reaffecterListe() })
  const f5b = {a: 1}
  await cas('elementAccesseurPousseSurLeBrutPuisReaffectee', 'vs', 'vx', (x) => { window.__r5 = [1, 2]; x.choisirListe(window.__r5) }, async (x) => { window.__r5.push(acc({}, 'v', f5b)); x.reaffecterListe(); await pause(); String(x._state.vs); f5b.a = 5 })
  const f6 = {a: 1}
  await cas('remplaceeParUneListeAAccesseur', 'noms', 'lx', (x) => x.choisirListe([0, 2, 3]), async (x) => { const l = acc([0, 2, 3], 0, f6); x.choisirListe(l); await pause(); String(x._state.noms); f6.a = 5; x.reaffecterListe() })
  const f6c = {a: 1}
  await cas('ancienneListeRemiseApresUnAccesseurSurLeBrut', 'noms', 'lx', (x) => { window.__A = [0, 2, 3]; x.choisirListe(window.__A) }, async (x) => { x.choisirListe([7, 8]); await pause(); String(x._state.noms); acc(window.__A, 0, f6c); x.choisirListe(window.__A); await pause(); String(x._state.noms); f6c.a = 5; x.reaffecterListe() })
  window.__f7 = {a: 1}
  await cas('elementAccesseurPoseParLaVariable', 'vs', 'vx', (x) => x.choisirListe([{v: 1}, 2]), async (x) => { x.defElem(); await pause(); String(x._state.vs); window.__f7.a = 5 })
  const f8 = {a: 1}
  await cas('elementAccesseurPoseSurLeBrutPuisReaffecteeUneFois', 'vs', 'vx', (x) => { window.__e8 = {v: 1}; x.choisirListe([window.__e8, 2]) }, async (x) => { acc(window.__e8, 'v', f8); x.reaffecterListe(); await pause(); String(x._state.vs); f8.a = 5 })
  const f10 = {a: 1}
  await cas('indicePoseSurLeBrutPuisAutreObjetEcrit', 'noms', 'lx', (x) => { window.__r10 = [0, 2, 3]; x.choisirListe(window.__r10) }, async (x) => { acc(window.__r10, 0, f10); x.bouger(); x.pousser(9); await pause(); String(x._state.noms); f10.a = 5 })
  await cas('reecritureRepasseALHorloge', 'noms', 'lx', (x) => { window.__r12 = [1, 2]; x.choisirListe(window.__r12) }, async (x) => { x.reaffecterListe(); await pause(); String(x._state.noms); window.__r12.push(3) })
  await cas('autreValeurGardeSaPrecision', 'po', 'px', (x) => { window.__p13 = {x: 1}; x.poser(window.__p13) }, async (x) => { window.__r13 = [1, 2]; x.choisirListe(window.__r13); x.reaffecterListe(); await pause(); String(x._state.po); window.__p13.x = 7 })
  // \`µrefresh($liste)\` après un changement fait hors de MJS, sans autre écriture : la valeur se refait, l'écran se redessine
  try {
    const x = await neuf()
    window.__r11 = [1, 2]
    x.choisirListe(window.__r11); await pause()
    const ecran = () => x._shadow.querySelector('.seul').textContent + ' | ' + x._shadow.querySelector('.long').textContent
    const avant = ecran()
    window.__r11.push(3)
    x.reaffecterListe(); await pause()
    R.reecritureRedessine = avant + ' → ' + ecran()
  }
  catch (err) { R.reecritureRedessine = 'lève : ' + String(err.message).slice(0, 80) }
  return R
})()`

// la valeur de la règle de toujours partout, sauf l'accesseur posé sur le brut sans écriture ni signal : changement fait hors
// de MJS, la valeur garde son dernier calcul ; un accesseur que la variable reçoit tout fait lit une donnée de la page, changée
// hors de MJS : le scénario le signale par `µrefresh($liste)` juste après
const ATTENDU = {
  indicePoseParLaVariable: '0,2,3 → 5,2,3 | écran 5,2,3',
  indicePoseSurLeBrutSansEcriture: '0,2,3 → 0,2,3 | écran 0,2,3',
  indicePoseSurLeBrutPuisReaffecteeUneFois: '0,2,3 → 5,2,3 | écran 5,2,3',
  indicePoseSurLeBrutPuisReaffecteeChaqueFois: '0,2,3 → 5,2,3 | écran 5,2,3',
  elementAccesseurPousseParLaVariable: '1,2 → 1,2,5 | écran 1,2,5',
  elementAccesseurPousseSurLeBrutPuisReaffectee: '1,2 → 1,2,5 | écran 1,2,5',
  remplaceeParUneListeAAccesseur: '0,2,3 → 5,2,3 | écran 5,2,3',
  ancienneListeRemiseApresUnAccesseurSurLeBrut: '0,2,3 → 5,2,3 | écran 5,2,3',
  elementAccesseurPoseParLaVariable: '1,2 → 5,2 | écran 5,2',
  elementAccesseurPoseSurLeBrutPuisReaffecteeUneFois: '1,2 → 5,2 | écran 5,2',
  indicePoseSurLeBrutPuisAutreObjetEcrit: '0,2,3 → 1,2,3,9 | écran 1,2,3,9',
  reecritureRedessine: '1,2 | 2 → 1,2,3 | 3',
  reecritureRepasseALHorloge: '1,2 → 1,2,3 | écran 1,2,3',
  autreValeurGardeSaPrecision: '1 → 1 | écran 1',
}

async function construire(prod: boolean): Promise<string> {
  const root   = mjsTmp('derive-frontiere')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-frontiere.mjs'), FRONTIERE)
  // la précision des valeurs calculées est une option d'appli (`derived: "precise"`, mjs.config.json)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  if (!prod) {
    // les deux valeurs sont précises : le compilateur nomme leurs sources
    const sortie = readFileSync(join(outDir, files.find((f) => f.startsWith('derive-frontiere'))!), 'utf-8')
    assert.match(sortie, /_mjs_setComputed\(_mjsThis, ?['"]noms['"], ?[^;]*?, ?\[["']liste["']\]\)/)
    assert.match(sortie, /_mjs_setComputed\(_mjsThis, ?['"]vs['"], ?[^;]*?, ?\[["']\.v["'], ?["']liste["']\]\)/)
  }
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('valeur précise : un accesseur posé après coup, puis une vraie écriture de la variable, rendent la valeur de toujours', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let code: string
      before(async () => { code = await construire(prod) })

      it('happy-dom : la valeur de toujours après une vraie écriture, la dernière valeur sans écriture', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(code)
        const r = await window.eval(SCENARIO)
        // objets de la fenêtre de happy-dom : comparés par leur texte
        assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
        await window.happyDOM.close()
      })

      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : la valeur de toujours après une vraie écriture, la dernière valeur sans écriture`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          try {
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
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
