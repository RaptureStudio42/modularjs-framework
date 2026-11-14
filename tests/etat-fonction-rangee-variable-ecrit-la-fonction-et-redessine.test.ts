// une fonction de l'appli rangée dans un objet de l'état, lue par l'enveloppe et gardée par une variable (`f := $outil.format`), s'écrit
// comme un objet gardé ainsi : `f.appels = 10`, `delete`, `Object.defineProperty` écrivent dans la vraie fonction et l'écran suit
// (10, puis 13 après trois `$outil.format.appels += 1`). Elle reste une fonction comme avant : appelée seule ou passée en rappel
// (`liste.map($outil.double)`), son `this` est l'objet de l'état, et `this.n += 1` y redessine ; `$outil.format === $outil.format`,
// `typeof`, `name` (celui de la fonction), `length`, `call`, `apply`, `bind`, `new`, `instanceof` ; relue puis rangée ailleurs (`$fr`,
// `$outil.copieF`, `$$g`), elle s'écrit encore. Son prototype (`__proto__`, `Object.getPrototypeOf`) est la fonction même : une clé
// `__proto__` venue de l'extérieur n'atteint pas `Function.prototype`. Une classe qui en hérite (`class B extends $outil.K`) garde le
// sens de JavaScript (`B.t = 5` se pose sur `B`, un accesseur reçoit `B`) ; remplacée par le chemin, la fonction relue est la nouvelle.
// Même règle pour un magasin
// `µ.Store` (la fonction lue par `store.data`) et pour le miroir vivant d'un composant (`µ.clone(el, { mirror: true })`). Une fonction du
// navigateur (`Object`, amené par une clé `constructor`) garde sa copie sans lien : rien n'atteint `Object` ni `Object.prototype`. Avec
// `"proxy": false`, `f.appels = 10` suit le chemin fixe de `f` : aucun avertissement à sa ligne, et l'écran montre 10 sans `µrefresh`.
// Développement et production ; Chromium, Firefox et WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { charger } from './helpers/liaison-navigateur.js'

const SOURCE = `<script>
  $$series = { a: 1 }
  $outil = { format: (n) -> n, n: 2 }
  $outil.format.appels = 0
  $outil.double = function() { return this.n * 2 }
  $outil.monte = function() { this.n += 1 }
  $outil.Pt = function(x) { this.x = x }
  @ecrireVar = ->
    f := $outil.format
    f.appels = 10
  @plus = -> $outil.format.appels += 1
  @lire = -> $outil.format.appels
  @seul = ->
    g := $outil.double
    g()
  @rappel = -> [1, 2].map($outil.double)
  @monteSeul = ->
    m := $outil.monte
    m()
  @meme = -> $outil.format is $outil.format
  @infos = ->
    f := $outil.format
    [typeof f, f.name, f.length, f.call(null, 7), f.apply(null, [8]), f.bind(null)(9), [3, 1, 2].map(f).join('')]
  @nouveau = ->
    P := $outil.Pt
    p := new P(3)
    [p.x, p instanceof P, p instanceof $outil.Pt]
  @efface = ->
    f := $outil.format
    delete f.appels
  @definit = ->
    f := $outil.format
    Object.defineProperty(f, 'appels', { value: 42, writable: true, configurable: true, enumerable: true })
  @natif = (cle) ->
    $outil.nat = $$series[cle]
    n := $outil.nat
    n.values = [1]
    n.polluN = 1
    n.prototype?.polluP = 1
  @rangeRacine = ->
    $fr = $outil.format
    $fr.appels = 20
  @rangeObjet = ->
    $outil.copieF = $outil.format
    $outil.copieF.appels = 21
  @rangeMagasin = ->
    $$g = $outil.format
    $$g.appels = 22
  $outil.triple = (n) -> n * 2
  @porteCle = (cle) -> Object.assign($outil.format[cle], { polluQ: 1 })
  @porteProto = ->
    p := Object.getPrototypeOf($outil.format)
    p.polluG = 1
  @ranger = (k, v) -> $outil[k] = v
  @relire = (k) -> $outil[k]
  @appelTriple = (x) -> $outil.triple(x)
  @remplacerTriple = -> $outil.triple = (n) -> n * 3
  @magasin = (init) -> new µ.Store(init)
  @copie = (o) -> µ.clone(this, o)
</script>

<p class="o">{$outil.format.appels}</p>
<p class="n">{$outil.n}</p>
`

async function construire(prefixe: string, prod: boolean, opts: any = {}): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'fn-var.mjs'), SOURCE)
  const base: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler({ ...base, ...opts })
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

// la scène, jouée telle quelle dans happy-dom et dans les trois navigateurs : rend la liste des écarts
const SCENE = `(async () => {
  const c = document.querySelector('mjs-fn-var')
  const avis = []
  // production : µ n'est pas une globale de la page, et rien n'avertit
  if (typeof µ !== 'undefined') µ.warn = (m) => avis.push(String(m))
  const ecarts = []
  const pause = () => new Promise((r) => setTimeout(r, 30))
  const vu = (el, k) => el._shadow.querySelector('.' + k).textContent
  const voir = (el, k, v, quand) => { if (vu(el, k) !== v) ecarts.push(quand + ' : .' + k + ' montre « ' + vu(el, k) + ' », attendu « ' + v + ' »') }
  const egal = (a, b, quand) => { if (JSON.stringify(a) !== JSON.stringify(b)) ecarts.push(quand + ' : ' + JSON.stringify(a) + ', attendu ' + JSON.stringify(b)) }
  const essai = (quand, f) => { try { return f() } catch (e) { ecarts.push(quand + ' : ' + e.name + ': ' + e.message) } }
  voir(c, 'o', '0', 'départ')
  essai('ecrireVar', () => c.ecrireVar())
  await pause()
  voir(c, 'o', '10', 'f.appels = 10')
  egal(c.lire(), 10, 'lu après f.appels = 10')
  for (let i = 0; i < 3; i++) essai('plus', () => c.plus())
  await pause()
  voir(c, 'o', '13', 'trois += 1')
  egal(c.lire(), 13, 'lu après trois += 1')
  egal(essai('seul', () => c.seul()), 4, 'méthode appelée seule')
  egal(essai('rappel', () => c.rappel()), [4, 4], 'rappel')
  essai('monteSeul', () => c.monteSeul())
  await pause()
  voir(c, 'n', '3', 'this.n += 1 dans la méthode appelée seule')
  egal(essai('meme', () => c.meme()), true, 'même fonction relue')
  egal(essai('infos', () => c.infos()), ['function', 'format', 1, 7, 8, 9, '312'], 'typeof, name, length, call, apply, bind, rappel')
  egal(essai('nouveau', () => c.nouveau()), [3, true, true], 'new, instanceof')
  essai('efface', () => c.efface())
  await pause()
  egal(c.lire(), undefined, 'delete f.appels')
  essai('definit', () => c.definit())
  await pause()
  voir(c, 'o', '42', 'Object.defineProperty(f, …)')
  // la fonction relue rangée ailleurs (variable, objet, magasin $$) : on y écrit encore, sans avertissement
  essai('rangeRacine', () => c.rangeRacine())
  await pause()
  voir(c, 'o', '20', '$fr = $outil.format ; $fr.appels = 20')
  essai('rangeObjet', () => c.rangeObjet())
  await pause()
  voir(c, 'o', '21', '$outil.copieF = $outil.format ; $outil.copieF.appels = 21')
  essai('rangeMagasin', () => c.rangeMagasin())
  await pause()
  voir(c, 'o', '22', '$$g = $outil.format ; $$g.appels = 22')
  // magasin µ.Store : la fonction lue par store.data, gardée par une variable
  const s = c.magasin({ outil: { format: (n) => n, n: 2, double: function () { return this.n * 2 } }, format: (n) => n, nat: null })
  // qui est prévenu : lu par un espion, en développement seulement (la production raccourcit le nom de la méthode)
  const prevenus = []
  const notif = s._mjs_notifyMutation
  const espion = typeof notif === 'function'
  s._mjs_notifyMutation = function (b, r, p) { prevenus.push(r === null ? p : r); return notif.apply(this, arguments) }
  const sf = s.data.outil.format
  essai('magasin f.appels = 10', () => { sf.appels = 10 })
  egal([s._state.outil.format.appels, s.data.outil.format.appels], [10, 10], 'magasin : f.appels = 10')
  for (let i = 0; i < 3; i++) essai('magasin += 1', () => { s.data.outil.format.appels += 1 })
  egal([s._state.outil.format.appels, s.data.outil.format.appels], [13, 13], 'magasin : trois += 1')
  const rf = s.data.format
  essai('magasin racine', () => { rf.appels = 5 })
  egal([s._state.format.appels, !espion || prevenus.includes('outil'), !espion || prevenus.includes('format')], [5, true, true], 'magasin : écritures prévenues')
  egal(s.data.outil.format === s.data.outil.format, true, 'magasin : même fonction relue')
  const sd = s.data.outil.double
  egal(essai('magasin seul', () => sd()), 4, 'magasin : méthode appelée seule')
  s.data.nat = Object
  const sn = s.data.nat
  essai('magasin natif', () => { sn.values = [1]; sn.polluS = 1 })
  // miroir vivant : il partage l'état, l'écriture par sa variable redessine les deux
  const k = c.copie({ mirror: true })
  document.body.append(k)
  const fin = Date.now() + 3000
  while (!k._shadow?.querySelector('.o') && Date.now() < fin) await pause()
  await pause()
  essai('miroir ecrireVar', () => k.ecrireVar())
  await pause()
  voir(k, 'o', '10', 'miroir : f.appels = 10')
  voir(c, 'o', '10', 'original après l’écriture du miroir')
  if (avis.length) ecarts.push('avis ' + JSON.stringify(avis))
  // une clé __proto__ venue de l'extérieur, Object.getPrototypeOf : la fonction même, jamais Function.prototype
  const FP = Object.getPrototypeOf(function () {})
  essai('porteCle', () => c.porteCle('__proto__'))
  essai('porteProto', () => c.porteProto())
  if (Object.prototype.hasOwnProperty.call(FP, 'polluQ') || Object.prototype.hasOwnProperty.call(FP, 'polluG')) ecarts.push('Function.prototype écrit')
  // classe rangée puis étendue : l'écriture se pose sur la sous-classe, l'accesseur la reçoit pour this
  class Kraw { static get qui () { return this.name } }
  essai('ranger K', () => c.ranger('K', Kraw))
  const K = c.relire('K')
  essai('sous-classe', () => {
    class Sub extends K {}
    Sub.t = 5
    egal([Object.prototype.hasOwnProperty.call(Sub, 't'), Object.prototype.hasOwnProperty.call(Kraw, 't'), Sub.qui, K.qui, new Sub() instanceof K], [true, false, 'Sub', 'Kraw', true], 'sous-classe')
  })
  // fonction remplacée par le chemin : la nouvelle est appelée
  egal(essai('triple', () => c.appelTriple(2)), 4, 'avant remplacement')
  essai('remplacerTriple', () => c.remplacerTriple())
  egal(essai('triple remplacée', () => c.appelTriple(2)), 6, 'fonction remplacée par le chemin')
  // fonction du navigateur rangée par une clé : copie sans lien, rien n'atteint Object ni Object.prototype
  essai('natif', () => c.natif('constructor'))
  if (!/\\[native code\\]/.test(Function.prototype.toString.call(Object.values)) || Object.values({ a: 1 })[0] !== 1) ecarts.push('Object.values remplacé')
  if (Object.hasOwn(Object, 'polluN') || Object.hasOwn(Object, 'polluS') || Object.prototype.hasOwnProperty('polluP')) ecarts.push('Object ou Object.prototype écrits')
  return ecarts
})()`

describe('fonction rangée dans un objet de l\'état, gardée par une variable : l\'écriture va à la fonction, l\'écran suit', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(480000)
    for (const prod of [false, true]) codes[String(prod)] = await construire(`fn-var-${prod ? 'prod' : 'dev'}`, prod)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const prod of [false, true]) {
    it(`${prod ? 'production' : 'développement'} : f := $outil.format ; f.appels = 10 puis trois += 1 → l'écran montre 10 puis 13 ; this, rappel, new, magasin, miroir ; Object intact`, async () => {
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.eval(codes[String(prod)])
        window.document.body.innerHTML = '<mjs-fn-var></mjs-fn-var>'
        const c = window.document.querySelector('mjs-fn-var')
        const fin = Date.now() + 3000
        while (!c._shadow?.querySelector('.o') && Date.now() < fin) await new Promise((r) => setTimeout(r, 20))
        await new Promise((r) => setTimeout(r, 20))
        // liste faite dans la page (un autre royaume) : recopiée avant la comparaison stricte
        const ecarts = Array.from(await window.eval(SCENE), String)
        assert.deepEqual(ecarts, [])
      }
      finally {
        window.close()
      }
    })
  }

  it('"proxy": false — f.appels = 10 suit le chemin fixe de f : aucun avis à sa ligne ; sans le réglage, rien', async () => {
    const net    = (a: unknown) => String(a).replace(/\x1b\[[0-9;]*m/g, '')
    const ligne  = SOURCE.split('\n').findIndex((l) => l.includes('f.appels = 10')) + 1
    const sans: any   = await transpile(SOURCE, { moduleName: 'fn-var', proxy: false } as any)
    const defaut: any = await transpile(SOURCE, { moduleName: 'fn-var' } as any)
    const avisSans    = (sans.data?.sectionWarnings ?? []).map(net)
    const avisDefaut  = (defaut.data?.sectionWarnings ?? []).map(net)
    assert.ok(!avisSans.some((a: string) => a.includes(`ligne ${ligne} :`)), JSON.stringify(avisSans))
    assert.ok(!avisDefaut.some((a: string) => a.includes('µrefresh(')), JSON.stringify(avisDefaut))
  })

  it('"proxy": false, développement — f := $outil.format ; f.appels = 10 : l\'écran montre 10 sans µrefresh', async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(await construire('fn-var-sans', false, { proxy: false }))
      window.document.body.innerHTML = '<mjs-fn-var></mjs-fn-var>'
      const c   = window.document.querySelector('mjs-fn-var')
      const fin = Date.now() + 3000
      while (!c._shadow?.querySelector('.o') && Date.now() < fin) await new Promise((r) => setTimeout(r, 20))
      c.ecrireVar()
      await new Promise((r) => setTimeout(r, 30))
      assert.deepEqual([c._shadow.querySelector('.o').textContent, c.lire()], ['10', 10])
    }
    finally {
      window.close()
    }
  })

  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : développement — la même scène`, async () => {
      const playwright: any = await import('playwright')
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const ecarts: string[] = []
      try {
        const cible = { mode: 'dev-parents-avant' as const, racine: mjsTmp('fn-var-page'), document: () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-fn-var></mjs-fn-var><script>${codes.false}</script></body></html>` }
        const o     = await charger(browser, cible, 'mjs-fn-var')
        try {
          await o.page.waitForFunction(`!!document.querySelector('mjs-fn-var')?._shadow?.querySelector('.o')`, null, { timeout: 15000 }).catch(() => undefined)
          for (const e of await o.page.evaluate(SCENE)) ecarts.push(e)
          if (o.erreurs.length) ecarts.push(`erreurs ${o.erreurs.join(' | ')}`)
        }
        finally {
          await o.fermer()
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(ecarts, [])
    })
  }
})
