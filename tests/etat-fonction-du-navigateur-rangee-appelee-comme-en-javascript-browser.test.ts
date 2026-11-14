// une fonction du navigateur rangée dans un objet de l'état s'appelle comme en JavaScript : `t = $o.attendre; t(f)`,
// `$o.attendre.call(null, f)`, `$o.slice.call(l, 1)`, `$o.has.call(x, k)`, `apply`, `bind` reçoivent le `this` qu'on leur donne ;
// `$o.attendre(f)` (setTimeout appelé comme méthode de l'objet qui le range) marche sous l'enveloppe, et lève sans elle (`"proxy": false`,
// `$$mag`, `µ.state`) comme `o.attendre(f)` en JavaScript nu ; un autre `this` donné par `call` est passé tel quel. Dans un composant
// (développement et production, avec et sans `"proxy": false`), un magasin (`$$mag`), un `µ.state` et un `µ.Store`, dans Chromium, Firefox et
// WebKit, chaque scène rend ce que rend JavaScript nu, sauf le mur de l'enveloppe (composant et `µ.Store`) : la fonction lue n'est
// pas l'originale, n'a pas de `prototype`, une classe n'en hérite pas, ce qu'on y écrit n'atteint ni elle, ni `Object`, ni `Map`.
// `$$mag` et `µ.state` rendent la fonction telle quelle, comme JavaScript. Une `Map`, un `Set`, un objet gelé de l'état la rendent telle quelle

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { charger } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

const CIVET = `<script>
  $o = { a: 1 }
  $$mag = { o: { a: 1 } }
  $m = new Map()
  $s = new Set()
  $g = null
  etat = µ.state({ o: { a: 1 } })
  boite = new µ.Store({ o: { a: 1 } })
  @range = (n) ->
    Object.assign($o, n)
    Object.assign($$mag.o, n)
    Object.assign(etat.o, n)
    Object.assign(boite.data.o, n)
    $m.set('t', n.attendre)
    $s.add(n.attendre)
    $g = Object.freeze({ t: n.attendre })
  @lire = -> $o
  @lireMag = -> $$mag.o
  @lireEtat = -> etat.o
  @lireStore = -> boite.data.o
  @lireM = -> $m
  @lireS = -> $s
  @lireG = -> $g
</script>
<p class="a">{$o.a}</p>
`

async function construire(prefixe: string, prod: boolean, proxy: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'nav-fn.mjs'), CIVET)
  const base: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(proxy ? base : { ...base, proxy: false })
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

// les scènes, jouées sur un objet `o` : JavaScript nu, l'objet du composant, celui du magasin, celui d'un µ.state ; chacune rend
// sa valeur ou « LÈVE » (le texte de l'erreur change d'un moteur à l'autre)
const SCENE = `(async (sujet) => {
  const c = document.querySelector('mjs-nav-fn')
  class Pt {}
  const n = { attendre: setTimeout, charge: fetch, slice: [].slice, has: Object.prototype.hasOwnProperty, nat: Map, obj: Object, Pt, moi: function () { return this } }
  let o, m, s, g
  if (sujet === 'nu') {
    o = { a: 1, ...n }
    m = new Map([['t', setTimeout]]); s = new Set([setTimeout]); g = Object.freeze({ t: setTimeout })
  }
  else {
    c.range(n)
    o = sujet === 'store' ? c.lireStore() : sujet === 'mag' ? c.lireMag() : sujet === 'etat' ? c.lireEtat() : c.lire()
    m = c.lireM(); s = c.lireS(); g = c.lireG()
  }
  const r = {}
  const jouer = async (nom, f) => { try { r[nom] = String(await f()) } catch (e) { r[nom] = 'LÈVE' } }
  await jouer('1 o.attendre(f, 0)', () => typeof o.attendre(() => 0, 0))
  await jouer('2 t = o.attendre ; t(f, 0)', () => { const t = o.attendre; return typeof t(() => 0, 0) })
  await jouer('3 o.charge(data:)', async () => (await o.charge('data:,x')).status)
  await jouer('4 o.slice.call([1,2,3], 1)', () => o.slice.call([1, 2, 3], 1).join(','))
  await jouer('5 o.has(a)', () => o.has('a'))
  await jouer('6 o.has.call({b:1}, b)', () => o.has.call({ b: 1 }, 'b'))
  await jouer('7 new o.nat() instanceof Map', () => new o.nat() instanceof Map)
  await jouer('8 new Map() instanceof o.nat', () => new Map() instanceof o.nat)
  await jouer('9 o.nat.prototype', () => o.nat.prototype === Map.prototype ? 'Map.prototype' : o.nat.prototype)
  await jouer('10 o.attendre === o.attendre', () => o.attendre === o.attendre)
  await jouer('11 o.attendre === setTimeout', () => o.attendre === setTimeout)
  await jouer('12 n = o.nat ; n.polluN = 1 → Map.polluN', () => { const x = o.nat; try { x.polluN = 1 } catch (e) {} const v = Map.polluN; delete Map.polluN; return v })
  await jouer('13 o.nat.prototype.polluP = 1 → Map.prototype', () => { try { o.nat.prototype.polluP = 1 } catch (e) {} const v = Map.prototype.polluP; delete Map.prototype.polluP; return v })
  await jouer('14 m.get(t) === setTimeout', () => m.get('t') === setTimeout)
  await jouer('15 m.get(t)(f, 0)', () => typeof m.get('t')(() => 0, 0))
  await jouer('16 g.t === setTimeout', () => g.t === setTimeout)
  await jouer('17 o.attendre.call(null, f, 0)', () => typeof o.attendre.call(null, () => 0, 0))
  await jouer('18 o.attendre.name', () => o.attendre.name)
  await jouer('19 class D extends o.nat', () => { const D = class extends o.nat {}; return new D() instanceof Map })
  await jouer('20 Object.getPrototypeOf(o.nat) === Function.prototype', () => Object.getPrototypeOf(o.nat) === Function.prototype)
  await jouer('21 o.slice.apply([4,5], [1])', () => o.slice.apply([4, 5], [1]).join(','))
  await jouer('22 o.has.bind({z:1})(z)', () => o.has.bind({ z: 1 })('z'))
  await jouer('23 x = o.obj ; x.polluX = 1 → Object.polluX', () => { const x = o.obj; try { x.polluX = 1 } catch (e) {} const v = Object.polluX; delete Object.polluX; return v })
  await jouer('24 class D extends o.Pt ; D.marque = 1 → Pt.marque', () => { const D = class extends o.Pt {}; D.marque = 1; return Pt.marque })
  await jouer('25 [...s][0] === setTimeout', () => [...s][0] === setTimeout)
  await jouer('26 o.moi() === o (fonction de votre appli)', () => o.moi() === o)
  await jouer('27 o.attendre.call({}, f, 0)', () => typeof o.attendre.call({}, () => 0, 0))
  await jouer('29 length de chaque fonction rangée', () => ['attendre', 'charge', 'slice', 'has', 'nat', 'obj'].map((k) => k + '=' + o[k].length).join(' '))
  await jouer('28 o.attendre.call(o, f, 0)', () => typeof o.attendre.call(o, () => 0, 0))
  return r
})`

// ce que rend une enveloppe (composant sous l'enveloppe, µ.Store) à la place de JavaScript nu : son mur, et l'appel en méthode d'une
// fonction de la fenêtre
const MUR: Record<string, string> = {
  '9 o.nat.prototype': 'undefined',
  '11 o.attendre === setTimeout': 'false',
  '12 n = o.nat ; n.polluN = 1 → Map.polluN': 'undefined',
  '13 o.nat.prototype.polluP = 1 → Map.prototype': 'undefined',
  '19 class D extends o.nat': 'LÈVE',
  '23 x = o.obj ; x.polluX = 1 → Object.polluX': 'undefined',
  // une fonction propre à la fenêtre appelée comme méthode de l'objet qui la range marche, là où JavaScript lève
  '1 o.attendre(f, 0)': 'number',
  '3 o.charge(data:)': '200',
  '28 o.attendre.call(o, f, 0)': 'number',
}

describe('fonction du navigateur rangée dans un objet de l\'état : appelée comme en JavaScript, derrière le mur de l\'enveloppe', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}
  before(async function () {
    this.timeout(480000)
    for (const prod of [false, true]) for (const proxy of [true, false]) codes[`${prod}-${proxy}`] = await construire(`navfn-${prod ? 'prod' : 'dev'}-${proxy ? 'p' : 'sp'}`, prod, proxy)
  })
  after(async () => {
    await terminateSharedWorkerPool()
  })
  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    playTogether(describe(moteur, function () {
      it('composant, magasin, µ.state, en développement et en production, avec et sans "proxy": false : JavaScript nu, mur à part', async function () {
        const playwright: any = await import('playwright')
        const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        const ecarts: string[] = []
        try {
          const jouer = async (code: string, sujet: string) => {
            const cible = { mode: 'dev-parents-avant' as const, racine: mjsTmp('navfn-page'), document: () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-nav-fn></mjs-nav-fn><script>${code}</script></body></html>` }
            const o     = await charger(browser, cible, 'mjs-nav-fn')
            try {
              await o.page.waitForFunction(`!!document.querySelector('mjs-nav-fn')?._shadow?.querySelector('.a')`, null, { timeout: 15000 }).catch(() => undefined)
              return await o.page.evaluate(`${SCENE}(${JSON.stringify(sujet)})`) as Record<string, string>
            }
            finally {
              await o.fermer()
            }
          }
          const nu = await jouer(codes['false-true'], 'nu')
          for (const [cle, code] of Object.entries(codes)) {
            const proxy = cle.endsWith('true')
            for (const sujet of ['comp', 'mag', 'etat', 'store']) {
              const vu  = await jouer(code, sujet)
              const mur = sujet === 'store' || (sujet === 'comp' && proxy)
              for (const [scene, js] of Object.entries(nu)) {
                const attendu = mur && scene in MUR ? MUR[scene] : js
                if (vu[scene] !== attendu) ecarts.push(`${cle.startsWith('true') ? 'prod' : 'dév'}${proxy ? '' : ' sans proxy'} ${sujet} ${scene} : ${vu[scene]}, attendu ${attendu}`)
              }
            }
          }
        }
        finally {
          await browser.close()
        }
        assert.deepEqual(ecarts, [])
      })
    }))
  }
})
