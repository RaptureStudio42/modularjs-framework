// Avertissement du développement d'une valeur précise restée sur son dernier calcul, et `Proxy` de la page. (A) un changement
// fait hors de MJS (`window.objetA.items.push(3)`) sur un objet qui porte un accesseur propre que la valeur ne lit pas :
// l'avertissement parle d'un changement fait hors de MJS et ne nomme pas cet accesseur. (B) `Proxy` de la page dont un champ
// absent de l'objet lit un objet qu'une autre variable écrit (`$autreB.prix = 10`, par MJS) : la lecture le regarde, la valeur
// suit. (C) accesseur propre qui lit le même objet par `this` : la valeur suit, aucun avertissement. (D) accesseur propre qui lit
// un objet qu'une autre variable écrit (`$autreD.prix = 10`, par MJS) : la valeur peut garder son dernier calcul (la limite
// écrite, docs/03), et l'avertissement nomme l'accesseur lu, sans parler d'un changement fait hors de MJS. (E) un changement fait
// hors de MJS (`window.objetE.prix = 10`), lu à côté d'un accesseur propre qui rend toujours la même valeur (composant à part) :
// l'avertissement parle d'un changement fait hors de MJS et n'accuse pas cet accesseur, qui rend ce qu'il rendait. Français et anglais
// (`<html lang>`, libellés du cœur posés comme par le manifeste), au vouvoiement ; avec l'enveloppe et avec `"proxy": false`, en développement et en production (happy-dom)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANT = `<script>
$k = 0
$oA = window.objetA
$vA = $oA.items.map((i) -> i * 2).join(',')
autreB = {prix: 2}
$autreB = autreB
$pB = new Proxy({}, {get: (t, c) -> if c is 'prix' then autreB.prix else t[c]})
$vB = [$pB.prix].join('')
$oC = {n: 1, get double() { return this.n * 2 }}
$vC = [$oC.double].join('')
autreD = {prix: 2}
$autreD = autreD
$oD = Object.defineProperty({}, 'p', {get: (-> autreD.prix), enumerable: true})
$vD = [$oD.p].join('')
@wA = ->
  window.objetA.items.push(3)
  $k += 1
@wB = -> $autreB.prix = 10
@wC = -> $oC.n = 5
@wD = ->
  $autreD.prix = 10
  $k += 1
@lire = -> [$vA, $vB, $vC, $vD].join('|')
</script>
<p class="v">{[$k, $vA, $vB, $vC, $vD].join('|')}</p>
`

// objet de la page à accesseur propre, et avertissements du cœur relevés avant son chargement
const PAGE = `window.__W = [];
window.objetA = Object.defineProperty({ items: [1, 2] }, 'x', { get: () => 0, enumerable: true });
window.objetE = { prix: 2 };
window.constanteE = () => Object.defineProperty({}, 'total', { get: () => 1, enumerable: true });
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`

const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const el = document.createElement('mjs-avert')
  document.body.appendChild(el)
  await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const R = [['depart', el.lire()]]
  for (const c of ['A', 'B', 'C', 'D']) {
    el['w' + c]()
    await pause(60)
    R.push([c, el.lire()])
  }
  return { R, W: window.__W.filter((w) => w.includes('[ModularJS]')) }
})()`

// textes des deux avertissements, par langue : changement fait hors de MJS ; accesseur lu
const TEXTES: Record<string, { dehors: string, accesseur: string }> = {
  fr: { dehors: 'a sans doute été changée hors de MJS', accesseur: 'elle lit un accesseur posé sur un objet (' },
  en: { dehors: 'was probably changed outside MJS', accesseur: 'it reads an accessor set on an object (' },
}

async function construire(prod: boolean, proxy: boolean, derived: string, composants: Record<string, string> = { avert: COMPOSANT }): Promise<string> {
  const root   = mjsTmp('avert-accesseur')
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

async function jouer(code: string, langue: string, scenario = SCENARIO): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.document.documentElement.lang = langue
  window.eval(PAGE)
  window.eval(code)
  // libellés du cœur, comme les pose le manifeste d'une appli : la langue se choisit à l'affichage, par `<html lang>` ; le
  // paquet de production, qui n'avertit de rien, ne laisse pas `µ` dans la page
  window.eval('if (typeof µ !== \'undefined\') µ._runtimeLabels = ' + JSON.stringify(RUNTIME_LABELS))
  const r = JSON.parse(JSON.stringify(await window.eval(scenario)))
  await window.happyDOM.close()
  return r
}

describe('valeurs précises : l\'avertissement ne nomme qu\'un accesseur lu, le Proxy de la page reste regardé', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le compilateur classe les quatre valeurs précises', async () => {
    const code = await construire(false, true, 'precise')
    for (const n of ['vA', 'vB', 'vC', 'vD']) {
      const ligne = code.split('\n').find((l) => l.includes('_mjs_setComputed(_mjsThis, \'' + n + '\''))
      assert.ok(ligne && /\]\)\s*;?\s*$/.test(ligne), n + ' n\'est pas précise : ' + ligne)
    }
  })

  for (const proxy of [true, false]) {
    for (const prod of [false, true]) {
      for (const langue of ['fr', 'en']) {
        it(`${proxy ? 'enveloppe' : '"proxy": false'}, ${prod ? 'production' : 'développement'}, ${langue} : (B) et (C) suivent, chaque avertissement dit le vrai`, async () => {
          const horloge = await jouer(await construire(prod, proxy, 'clock'), langue)
          const precise = await jouer(await construire(prod, proxy, 'precise'), langue)
          const t       = TEXTES[langue]
          const col     = (r: any, i: number) => r.R.map((e: string[]) => e[1].split('|')[i])
          // (B) et (C) : les valeurs de l'horloge
          assert.deepEqual(col(precise, 1), col(horloge, 1))
          assert.deepEqual(col(precise, 2), col(horloge, 2))
          assert.deepEqual(col(horloge, 1), ['2', '2', '10', '10', '10'])
          assert.deepEqual(col(horloge, 2), ['2', '2', '2', '10', '10'])
          // (A) et (D) : la valeur de l'horloge, ou son dernier calcul (changement fait hors de MJS ; accesseur propre) avec, en
          // développement, l'avertissement qui dit le vrai ; la production n'avertit de rien
          const W = precise.W
          if (prod) assert.deepEqual(W, [])
          assert.ok(!W.some((w: string) => w.includes('$oA.x')), 'accesseur que la valeur ne lit pas nommé :\n' + W.join('\n'))
          for (const [i, v, attendu] of [[0, '$vA', 'dehors'], [3, '$vD', 'accesseur']] as Array<[number, string, 'dehors' | 'accesseur']>) {
            const lus = col(precise, i), justes = col(horloge, i)
            const avis = W.filter((w: string) => w.includes(langue === 'fr' ? '« ' + v + ' »' : '"' + v + '"'))
            if (prod || lus.join() === justes.join()) continue
            assert.ok(avis.length === 1, v + ' sur son dernier calcul sans avertissement du développement :\n' + W.join('\n'))
            assert.ok(avis[0].includes(t[attendu]), v + ' : ' + avis[0])
            if (attendu === 'accesseur') assert.ok(avis[0].includes('`$oD.p`') && !avis[0].includes(t.dehors), avis[0])
          }
          // (B) et (C) n'avertissent de rien
          assert.ok(!W.some((w: string) => /« \$v[BC] »|"\$v[BC]"/.test(w)), W.join('\n'))
        })
      }
    }
  }
})

// (E) : composant à part, la donnée de `b` changée hors de MJS, l'accesseur constant de `k` lu à côté
const COMPOSANT_E = `<script>
$k = 0
$oE = {k: window.constanteE(), b: window.objetE}
$vE = [$oE.k.total, $oE.b.prix].join(',')
@wE = ->
  window.objetE.prix = 10
  $k += 1
@lire = -> String($vE)
</script>
<p class="v">{[$k, $vE].join('|')}</p>
`

const SCENARIO_E = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const el = document.createElement('mjs-avert-e')
  document.body.appendChild(el)
  await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const R = [el.lire()]
  el.wE()
  await pause(60)
  R.push(el.lire())
  return { R, W: window.__W.filter((w) => w.includes('[ModularJS]')) }
})()`

describe('valeurs précises : un changement fait hors de MJS lu à côté d\'un accesseur qui rend toujours la même valeur', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le compilateur classe la valeur précise', async () => {
    const ligne = (await construire(false, true, 'precise', { 'avert-e': COMPOSANT_E })).split('\n').find((l) => l.includes('_mjs_setComputed(_mjsThis, \'vE\''))
    assert.ok(ligne && /\]\)\s*;?\s*$/.test(ligne), 'vE n\'est pas précise : ' + ligne)
  })

  for (const langue of ['fr', 'en']) {
    it(`enveloppe, développement, ${langue} : la valeur garde son dernier calcul, l'avertissement parle d'un changement fait hors de MJS et n'accuse pas l'accesseur`, async () => {
      const precise = await jouer(await construire(false, true, 'precise', { 'avert-e': COMPOSANT_E }), langue, SCENARIO_E)
      const t       = TEXTES[langue]
      assert.deepEqual(precise.R, ['1,2', '1,2'])
      assert.equal(precise.W.length, 1, precise.W.join('\n'))
      assert.ok(precise.W[0].includes(t.dehors) && !precise.W[0].includes(t.accesseur) && !precise.W[0].includes('total'), precise.W[0])
    })
  }
})
