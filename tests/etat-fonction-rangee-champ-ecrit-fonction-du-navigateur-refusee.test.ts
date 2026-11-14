// une fonction de l'appli rangée dans l'état accepte qu'on écrive un champ dessus : `$format = (n) -> n.toFixed(2)`, puis
// `$format.appels = 0`, `+= 1`, `++`, `||=` (Civet), `or=`, `?=`, `and=` (CoffeeScript), `delete`, et l'écran suit — `{$format.appels}`
// dans le gabarit, une valeur dérivée et un reffet qui le lisent —, avec et sans `"proxy": false`, dans un composant et dans un magasin
// (`$$outils.format.appels`), rangée dans un objet (`$outil.format.appels` : la lecture par l'enveloppe et l'écriture touchent la même
// fonction), en développement et en production, sans avertissement. Toute fonction de l'appli : flèche, `function`,
// classe, `async`, génératrice, fonction d'une bibliothèque, fonction liée (`f.bind(…)`, dont le code est natif). Seule une fonction
// du navigateur (`Object`, `Array`, `Map`), qu'une clé venue de l'extérieur range dans l'état (`$serie = $$series['constructor']`),
// reste refusée : rien n'est écrit (`Object.values` marche encore) et, en développement, la console explique le piège, avec le chemin
// écrit et le nom de la fonction. Un nom réservé écrit dans le chemin et un prototype atteint par une lecture gardent leur message.
// La reconnaissance du code natif se vérifie aussi dans Chromium, Firefox et WebKit. Une fonction du navigateur rangée dans un objet de
// l'état (`$outil.nat = $$series['constructor']`) se lit par l'enveloppe en copie liée qui ne la prend pas pour prototype : ni
// `Object.prototype` (`$outil.nat.prototype`) ni `Object` (`Object.getPrototypeOf($outil.nat)`) ne s'atteignent par elle, même passée à une
// fonction ou gardée par une variable. Une clé symbole écrite dans une fonction du navigateur rangée est refusée sans faire lever le message

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { charger } from './helpers/liaison-navigateur.js'

const CIVET = `<script>
  $$outils = { format: (n) -> n }
  $$series = { a: 1, l: [], m: new Map() }
  $$sel = null
  $racine = null
  $format = (n) -> n.toFixed(2)
  $o = { a: 1 }
  $outil = { format: (n) -> n }
  $format.appels = 0
  $$outils.format.appels = 0
  $double = $format.appels * 2
  $vus = -1
  µeffect ->
    $vus = $format.appels
  @egal = -> $format.appels = 5
  @plus = -> $format.appels += 1
  @incr = -> $format.appels++
  @efface = -> delete $format.appels
  @ou = -> $format.appels ||= 9
  @magEgal = -> $$outils.format.appels = 5
  @magPlus = -> $$outils.format.appels += 1
  @magIncr = -> $$outils.format.appels++
  @magEfface = -> delete $$outils.format.appels
  @magOu = -> $$outils.format.appels ||= 9
  @outilEgal = -> $outil.format.appels = 4
  @outilPlus = -> $outil.format.appels += 1
  @genre = (f) ->
    $g = f
    $g.appels = 1
    $g.appels += 1
    $g.appels++
    $g.vide = 0
    delete $g.vide
    $g.appels
  @piege = (cle) ->
    $serie = $$series[cle]
    $serie.values = [1]
  @piegeListe = (cle) ->
    $serie = $$series.l[cle]
    $serie.values = [1]
  @piegeMap = (cle) ->
    $serie = $$series.m[cle]
    $serie.values = [1]
  @magPiege = (cle) ->
    $$sel = $$series[cle]
    $$sel.values = [1]
  @reserve = -> $o['constructor'] = 1
  @proto = -> $o.__proto__.x = 1
  @protoLu = ->
    $p = $$series['__proto__']
    $p.x = 1
  ecrireProto = (f) -> f.prototype.polluP = 1
  @rangeOutil = (cle) -> $outil.nat = $$series[cle]
  @porteFonction = -> ecrireProto($outil.nat)
  @porteAssign = -> Object.assign($outil.nat.prototype, { polluA: 1 })
  @porteAlias = ->
    p := $outil.nat.prototype
    p.polluQ = 1
  @porteParent = -> Object.getPrototypeOf($outil.nat).values = [1]
  @symbole = (s) ->
    $racine = $$series['constructor']
    $racine[s] = 1
  @magSymbole = (s) ->
    $$sel = $$series['constructor']
    $$sel[s] = 1
</script>

<p class="a">{$format.appels}</p>
<p class="d">{$double}</p>
<p class="v">{$vus}</p>
<p class="m">{$$outils.format.appels}</p>
<p class="o">{$outil.format.appels}</p>
`

const COFFEE = `<script lang="coffee">
$$outilsC = { format: (n) -> n }
$$seriesC = { a: 1 }
$format = (n) -> n.toFixed(2)
$o = { n: 0 }
$format.appels = 0
$$outilsC.format.appels = 0
@egal = -> $format.appels = 5
@plus = -> $format.appels += 1
@incr = -> $format.appels++
@et = -> $format.appels and= 4
@efface = -> delete $format.appels
@ou = -> $format.appels or= 9
@existe = ->
  delete $format.appels
  $format.appels ?= 3
@objOu = -> $o.n or= 7
@objEt = -> $o.n and= 8
@magEgal = -> $$outilsC.format.appels = 5
@magPlus = -> $$outilsC.format.appels += 1
@magIncr = -> $$outilsC.format.appels++
@magEfface = -> delete $$outilsC.format.appels
@magOu = -> $$outilsC.format.appels or= 9
@genre = (f) ->
  $g = f
  $g.appels = 1
  $g.appels += 1
  $g.appels++
  $g.appels
@piege = (cle) ->
  $serie = $$seriesC[cle]
  $serie.values = [1]
@piegeOu = (cle) ->
  $serie = $$seriesC[cle]
  $serie.polluK or= 1
@reserve = -> $o['constructor'] = 1
@proto = -> $o.__proto__.x = 1
</script>

<p class="a">{$format.appels}</p>
<p class="o">{$o.n}</p>
<p class="m">{$$outilsC.format.appels}</p>
`

// fonctions de l'appli, faites dans la page (le royaume de ses fonctions du navigateur) : aucune n'a le code natif, sauf la fonction liée
const GENRES: Record<string, string> = {
  'flèche': '(n) => n',
  'function': '(function format(n) { return n })',
  'classe': '(class Compteur {})',
  'async': '(async function charger() {})',
  'génératrice': '(function* suite() {})',
  'génératrice async': '(async function* flux() {})',
  'bibliothèque': 'new Function("n", "return n")',
  'liée': '(function lie() {}).bind(null)',
  'flèche liée': '((n) => n).bind(null)',
}

const NAVIGATEUR = (chemin: string, fn: string, nom: string) => `[ModularJS] ${chemin} : ${fn} contient la fonction ${nom} du navigateur, sans doute amenée par une clé venue de l'extérieur (adresse, formulaire, données reçues) ; rien n'est écrit. Vérifiez cette clé.`
const SEGMENT    = (seg: string) => `[ModularJS] chemin d'état refusé (segment « ${seg} ») — mutation ignorée.`

// écritures permises et ce que l'écran montre après chacune (classe → texte) ; `efface` n'est vérifié que par l'écriture qui suit
const PERMIS: Record<string, [string, Record<string, string>][]> = {
  Civet: [
    ['', { a: '0', d: '0', v: '0', m: '0' }],
    ['egal', { a: '5', d: '10', v: '5' }], ['plus', { a: '6', d: '12', v: '6' }], ['incr', { a: '7', d: '14', v: '7' }],
    ['efface', {}], ['ou', { a: '9', d: '18', v: '9' }],
    ['magEgal', { m: '5' }], ['magPlus', { m: '6' }], ['magIncr', { m: '7' }], ['magEfface', {}], ['magOu', { m: '9' }],
    ['outilEgal', { o: '4' }], ['outilPlus', { o: '5' }],
  ],
  CoffeeScript: [
    ['', { a: '0', o: '0', m: '0' }],
    ['egal', { a: '5' }], ['plus', { a: '6' }], ['incr', { a: '7' }], ['et', { a: '4' }], ['efface', {}], ['ou', { a: '9' }],
    ['existe', { a: '3' }], ['objOu', { o: '7' }], ['objEt', { o: '8' }],
    ['magEgal', { m: '5' }], ['magPlus', { m: '6' }], ['magIncr', { m: '7' }], ['magEfface', {}], ['magOu', { m: '9' }],
  ],
}

// écritures refusées et l'avertissement attendu (développement)
const REFUS: Record<string, [string, string[], string][]> = {
  Civet: [
    ['piege', ['constructor'], NAVIGATEUR('$serie.values', '$serie', 'Object')],
    ['piegeListe', ['constructor'], NAVIGATEUR('$serie.values', '$serie', 'Array')],
    ['piegeMap', ['constructor'], NAVIGATEUR('$serie.values', '$serie', 'Map')],
    ['magPiege', ['constructor'], NAVIGATEUR('$$sel.values', '$$sel', 'Object')],
    ['reserve', [], SEGMENT('constructor')], ['proto', [], SEGMENT('__proto__')], ['protoLu', [], SEGMENT('__proto__')],
  ],
  CoffeeScript: [
    ['piege', ['constructor'], NAVIGATEUR('$serie.values', '$serie', 'Object')],
    ['piegeOu', ['constructor'], NAVIGATEUR('$serie.polluK', '$serie', 'Object')],
    ['reserve', [], SEGMENT('constructor')], ['proto', [], SEGMENT('__proto__')],
  ],
}

async function construire(prefixe: string, prod: boolean, proxy: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'fn-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'fn-coffee.mjs'), COFFEE)
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

const pause = () => new Promise((r) => setTimeout(r, 20))

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(code)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = '<mjs-fn-civet></mjs-fn-civet><mjs-fn-coffee></mjs-fn-coffee>'
  const comps: Record<string, any> = { Civet: window.document.querySelector('mjs-fn-civet'), CoffeeScript: window.document.querySelector('mjs-fn-coffee') }
  const fin = Date.now() + 3000
  while (!(comps.Civet._shadow?.querySelector('.a') && comps.CoffeeScript._shadow?.querySelector('.a')) && Date.now() < fin) await pause()
  await pause()
  return { window, comps, avis }
}

// scène jouée dans un vrai navigateur : chaque genre de fonction de l'appli écrit, l'écran suit, les fonctions du navigateur refusées
const SCENE = `(async () => {
  const c = document.querySelector('mjs-fn-civet')
  const avis = []
  µ.warn = (m) => avis.push(String(m))
  const ecarts = []
  for (const [nom, src] of Object.entries(${JSON.stringify(GENRES)})) {
    const f = (0, eval)(src)
    const r = c.genre(f)
    if (r !== 3 || f.appels !== 3) ecarts.push(nom + ' : ' + r + ' / ' + f.appels)
  }
  c.plus()
  await new Promise((r) => setTimeout(r, 50))
  const vu = ['a', 'd', 'v'].map((k) => c._shadow.querySelector('.' + k).textContent).join(' ')
  if (vu !== '1 2 1') ecarts.push('écran ' + vu)
  if (avis.length) ecarts.push('avis ' + JSON.stringify(avis))
  avis.length = 0
  c.piege('constructor')
  c.piegeListe('constructor')
  c.piegeMap('constructor')
  const noms = avis.map((a) => (/contient la fonction (\\w+) du navigateur/.exec(a) || [])[1]).join(' ')
  if (noms !== 'Object Array Map') ecarts.push('refus ' + JSON.stringify(avis))
  if (!/\\[native code\\]/.test(Function.prototype.toString.call(Object.values)) || Object.hasOwn(Array, 'values') || Object.hasOwn(Map, 'values')) ecarts.push('fonction du navigateur écrite')
  return ecarts
})()`

describe('fonction rangée dans l\'état : celles de l\'appli acceptent l\'écriture d\'un champ, celles du navigateur restent refusées', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(480000)
    for (const prod of [false, true]) {
      for (const proxy of [true, false]) codes[`${prod}-${proxy}`] = await construire(`fn-champ-${prod ? 'prod' : 'dev'}-${proxy ? 'p' : 'sp'}`, prod, proxy)
    }
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const prod of [false, true]) {
    for (const proxy of [true, false]) {
      const nom = `${prod ? 'production' : 'développement'}${proxy ? '' : ', proxy: false'}`

      it(`${nom} : une fonction de l'appli reçoit =, +=, ++, ||=, or=, ?=, and=, delete, et l'écran suit (composant, magasin, valeur dérivée, reffet) ; tous les genres de fonction`, async () => {
        const m = await monter(codes[`${prod}-${proxy}`], prod)
        try {
          const ecarts: string[] = []
          for (const [langue, etapes] of Object.entries(PERMIS)) {
            const c = m.comps[langue]
            for (const [forme, vue] of etapes) {
              try {
                if (forme) c[forme]()
              }
              catch (e: any) {
                ecarts.push(`${langue} ${forme}() : ${e.name}: ${e.message}`)
              }
              await pause()
              for (const [k, v] of Object.entries(vue)) {
                const vu = c._shadow.querySelector('.' + k)?.textContent
                if (vu !== v) ecarts.push(`${langue} ${forme || 'départ'} : .${k} montre « ${vu} », attendu « ${v} »`)
              }
            }
            for (const [genre, src] of Object.entries(GENRES)) {
              const f = m.window.eval(src)
              const r = c.genre(f)
              if (r !== 3 || f.appels !== 3) ecarts.push(`${langue} ${genre} : ${r} / ${f.appels}`)
            }
          }
          if (m.avis.length) ecarts.push(`avertissements ${JSON.stringify(m.avis)}`)
          assert.deepEqual(ecarts, [])
        }
        finally {
          m.window.close()
        }
      })

      it(`${nom} : Object, Array, Map amenés par une clé refusés et intacts, message qui explique le piège ; nom réservé et prototype inchangés`, async () => {
        const m = await monter(codes[`${prod}-${proxy}`], prod)
        try {
          const ecarts: string[] = []
          for (const [langue, cas] of Object.entries(REFUS)) {
            for (const [forme, args, avis] of cas) {
              m.avis.length = 0
              try {
                m.comps[langue][forme](...args)
              }
              catch (e: any) {
                ecarts.push(`${langue} ${forme}() : ${e.name}: ${e.message}`)
              }
              const voulu = prod ? [] : [avis]
              if (JSON.stringify(m.avis) !== JSON.stringify(voulu)) ecarts.push(`${langue} ${forme}() : ${JSON.stringify(m.avis)}`)
            }
          }
          const w = m.window
          if (!/\[native code\]/.test(w.Function.prototype.toString.call(w.Object.values)) || w.Object.values({ a: 1 })[0] !== 1) ecarts.push('Object.values touché')
          if (w.Object.hasOwn(w.Array, 'values') || w.Object.hasOwn(w.Map, 'values') || w.Object.hasOwn(w.Object, 'polluK')) ecarts.push('Array, Map ou Object écrits')
          if (w.eval('Object.prototype.hasOwnProperty("x")')) ecarts.push('Object.prototype.x écrit')
          assert.deepEqual(ecarts, [])
        }
        finally {
          m.window.close()
        }
      })
    }
  }

  for (const prod of [false, true]) {
    for (const proxy of [true, false]) {
      const nom = `${prod ? 'production' : 'développement'}${proxy ? '' : ', proxy: false'}`

      if (proxy) {
        it(`${nom} : Object rangé dans un objet de l'état par une clé, lu par l'enveloppe — ni Object.prototype ni Object atteints par sa copie (fonction, Object.assign, variable, prototype de la copie)`, async () => {
          const m = await monter(codes[`${prod}-${proxy}`], prod)
          const w = m.window
          try {
            const c = m.comps.Civet
            const ecarts: string[] = []
            c.rangeOutil('constructor')
            for (const forme of ['porteFonction', 'porteAssign', 'porteAlias', 'porteParent']) {
              try {
                c[forme]()
              }
              catch (e: any) {
                if (e.name !== 'TypeError') ecarts.push(`${forme}() : ${e.name}: ${e.message}`)
              }
            }
            const pollue = ['polluP', 'polluA', 'polluQ'].filter((k) => w.Object.prototype.hasOwnProperty(k))
            for (const k of pollue) delete w.Object.prototype[k]
            if (pollue.length) ecarts.push(`Object.prototype écrit : ${pollue.join(', ')}`)
            const valeurs = w.Object.values
            if (typeof valeurs !== 'function' || !/\[native code\]/.test(w.Function.prototype.toString.call(valeurs))) ecarts.push(`Object.values remplacé : ${typeof valeurs}`)
            // `Object.getPrototypeOf(f)` d'une fonction mène à Function.prototype, comme en JavaScript : retiré après coup
            delete w.Function.prototype.values
            assert.deepEqual(ecarts, [])
          }
          finally {
            m.window.close()
          }
        })
      }

      it(`${nom} : une clé symbole écrite dans une fonction du navigateur rangée (composant, magasin) est refusée, sans erreur ; en développement, le message la montre`, async () => {
        const m = await monter(codes[`${prod}-${proxy}`], prod)
        const w = m.window
        try {
          const c = m.comps.Civet
          const ecarts: string[] = []
          for (const forme of ['symbole', 'magSymbole']) {
            m.avis.length = 0
            try {
              c[forme](w.Symbol('s'))
            }
            catch (e: any) {
              ecarts.push(`${forme}() : ${e.name}: ${e.message}`)
            }
            const voulu = prod ? [] : [NAVIGATEUR(forme === 'symbole' ? '$racine.Symbol(s)' : '$$sel.Symbol(s)', forme === 'symbole' ? '$racine' : '$$sel', 'Object')]
            if (JSON.stringify(m.avis) !== JSON.stringify(voulu)) ecarts.push(`${forme}() : ${JSON.stringify(m.avis)}`)
          }
          if (w.Object.getOwnPropertySymbols(w.Object).length) ecarts.push('Object écrit')
          assert.deepEqual(ecarts, [])
        }
        finally {
          m.window.close()
        }
      })
    }
  }

  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : développement, avec et sans proxy: false — genres de fonction, écran, fonctions du navigateur refusées`, async () => {
      const playwright: any = await import('playwright')
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const ecarts: string[] = []
      try {
        for (const proxy of [true, false]) {
          const code  = codes[`false-${proxy}`]
          const cible = { mode: 'dev-parents-avant' as const, racine: mjsTmp('fn-champ-page'), document: () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-fn-civet></mjs-fn-civet><script>${code}</script></body></html>` }
          const o     = await charger(browser, cible, 'mjs-fn-civet')
          try {
            await o.page.waitForFunction(`!!document.querySelector('mjs-fn-civet')?._shadow?.querySelector('.a')`, null, { timeout: 15000 }).catch(() => undefined)
            for (const e of await o.page.evaluate(SCENE)) ecarts.push(`${proxy ? '' : 'proxy: false, '}${e}`)
            if (o.erreurs.length) ecarts.push(`erreurs ${o.erreurs.join(' | ')}`)
          }
          finally {
            await o.fermer()
          }
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(ecarts, [])
    })
  }
})
