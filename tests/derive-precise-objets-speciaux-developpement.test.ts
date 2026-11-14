// Valeurs précises et objets que l'enveloppe ne suit pas sûrement. Liste gelée, `Proxy` de la page (champ qui n'est pas une
// donnée de l'objet), `size` d'une `Map`, objet brut (`µraw`) : la lecture les regarde, la valeur qui les lit garde la règle
// de toujours (refaite après toute écriture du composant), sans avertissement. Seule limite : un accesseur propre, posé sur
// l'objet lui-même (`Object.defineProperty(o, 'n', {get})`), que la lecture ne regarde pas — sur un objet de l'état comme sur
// une ligne d'une liste. Quand ce qu'il lit change, hors de MJS (une donnée de la page) ou par MJS (une autre variable qui
// écrit l'objet qu'il lit), la valeur précise garde son dernier calcul, en production comme en développement ; en
// développement, la relecture (la valeur refaite à part et comparée quand l'horloge l'aurait refaite) nomme l'accesseur et
// dit d'écrire `µrefresh($x)`, sans parler d'un changement fait hors de MJS. Le code qui suit la règle (`µrefresh($x)` juste
// après le changement) a des valeurs justes dans les deux modes. Chaque valeur lit un champ de nom différent : le doute d'une
// valeur passe aux valeurs qui lisent un champ du même nom. Happy-dom en développement et en production ; Chromium, Firefox
// et WebKit en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// chaque objet est donné par la page, qui le garde et le change ensuite elle-même : un changement fait hors de MJS ; la ligne
// à accesseur (`$lig`) lit un objet que le composant écrit par une autre variable (`$ligSel.prix = n`) : un changement fait par MJS
const SOURCE = `<script>
$gel = []
$acc = {}
$px = {}
$mp = new Map()
$cfg = { r: {} }
$lig = []
$k = 0
$vGel = $gel.map((x) -> x.ng).join(',')
$vAcc = [$acc.na].join(',')
$vPx = [$px.np].join(',')
$vMap = [$mp.size].join(',')
$vRaw = [$cfg.r.m].join(',')
$vLig = $lig.map((x) -> x.p).join(',')
@gel = (o) -> $gel = o
@acc = (o) -> $acc = o
@px = (o) -> $px = o
@mp = (o) -> $mp = o
@cfg = (o) -> $cfg = { r: µraw(o) }
@ligne = ->
  o = {prix: 1}
  $ligSel = o
  $lig = [Object.defineProperty({}, 'p', {get: (-> o.prix), enumerable: true})]
@ligEcrire = (n) -> $ligSel.prix = n
@inck = -> $k += 1
@raf = ->
  µrefresh($gel)
  µrefresh($acc)
  µrefresh($px)
  µrefresh($mp)
  µrefresh($lig)
</script>
<p class="v">{$vGel + '|' + $vAcc + '|' + $vPx + '|' + $vMap + '|' + $vRaw + '|' + $vLig + '|' + $k}</p>
`

// avertissements du cœur, relevés avant son chargement
const RELEVE = `window.__W = [];
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`

const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const el = document.createElement('mjs-speciaux')
  document.body.appendChild(el)
  await attendre(() => el._shadow?.querySelector('.v'))
  await pause(200)
  const txt = () => el._shadow.querySelector('.v').textContent
  const pas = async (f) => { f(); await pause(200) }
  const ext = { v: 1 }
  const gel = Object.freeze([{ ng: 1 }])
  const carte = new Map([['a', 1]])
  const brut = { m: 1 }
  const ecrans = []
  await pas(() => {
    el.gel(gel)
    el.acc(Object.defineProperty({}, 'na', { get: () => ext.v, enumerable: true }))
    el.px(new Proxy({}, { get: (t, k) => k === 'np' ? ext.v : t[k] }))
    el.mp(carte)
    el.cfg(brut)
    el.ligne()
  })
  ecrans.push(txt())
  const changer = (n) => { gel[0].ng = n; ext.v = n; carte.set('k' + n, n); brut.m = n; el.ligEcrire(n) }
  // changé (hors de MJS, et par MJS pour la ligne), puis une écriture sans rapport : les accesseurs propres gardent leur
  // dernier calcul ; le reste suit
  await pas(() => { changer(2); el.inck() }); ecrans.push(txt())
  // la règle : µrefresh juste après le changement
  await pas(() => el.raf()); ecrans.push(txt())
  // repassées à l'horloge pour toujours : elles suivent à l'écriture suivante
  await pas(() => { changer(3); el.inck() }); ecrans.push(txt())
  return { ecrans, avertissements: window.__W.filter((w) => w.includes('µrefresh')) }
})()`

async function construire(prod: boolean): Promise<string> {
  const root   = mjsTmp('speciaux')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'speciaux.mjs'), SOURCE)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
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

function verifier(r: any, prod: boolean) {
  assert.deepEqual(r.ecrans, ['1|1|1|1|1|1|0', '2|1|2|2|2|1|1', '2|2|2|2|2|2|1', '3|3|3|3|3|3|2'])
  // développement : un avertissement par valeur précise restée sur son dernier calcul, qui nomme l'accesseur et la variable à
  // signaler ; aucun ne parle d'un changement fait hors de MJS
  const attendus = prod ? [] : [['$vAcc', '`$acc.na`', 'µrefresh($acc)'], ['$vLig', '`$lig[0].p`', 'µrefresh($lig)']]
  assert.equal(r.avertissements.length, attendus.length, r.avertissements.join('\n'))
  for (const [valeur, accesseur, remede] of attendus) {
    assert.ok(r.avertissements.some((w: string) => w.includes('« ' + valeur + ' »') && w.includes('accesseur posé sur un objet (' + accesseur + ')') && w.includes(remede) && w.includes('mjs-speciaux')), 'aucun avertissement pour ' + valeur + ' : ' + r.avertissements.join('\n'))
  }
  assert.ok(!r.avertissements.some((w: string) => w.includes('hors de MJS')), r.avertissements.join('\n'))
}

describe('valeurs précises : objets que l\'enveloppe ne suit pas sûrement, la règle de toujours ; accesseur propre, signalé en développement', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let code: string
      before(async () => { code = await construire(prod) })

      it('happy-dom : accesseur propre sur son dernier calcul, µrefresh remet d\'aplomb, avertissements du développement', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(RELEVE)
        window.eval(code)
        verifier(JSON.parse(JSON.stringify(await window.eval(SCENARIO))), prod)
        await window.happyDOM.close()
      })

      if (!prod) {
        it('le cœur ne porte plus les contrôles de lecture des objets', () => {
          for (const nom of ['_mjsSimple', '_mjsControleTard', '_mjsReecrite']) assert.ok(!code.includes(nom), nom + ' encore dans le cœur')
          assert.ok(code.includes('_mjsRelecture'), 'la relecture du développement manque')
        })
        return
      }
      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : accesseur propre sur son dernier calcul, µrefresh remet d'aplomb, aucun avertissement`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          try {
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${RELEVE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            verifier(await page.evaluate(SCENARIO), prod)
          }
          finally {
            await browser.close()
          }
        })
      }
    })
  }
})
