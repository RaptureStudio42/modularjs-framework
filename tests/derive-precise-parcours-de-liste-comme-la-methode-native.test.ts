// Valeurs dérivées précises (le défaut) : la liste parcourue d'un bloc pendant le calcul d'une valeur
// précise (`filter`, `map`, `find`…) se comporte comme la méthode de JavaScript lue par la variable, donc comme le même
// paquet bâti à l'horloge (`derived: "clock"`) : liste gelée par le rappel pendant le parcours (directement ou par la variable : les éléments
// lus ensuite sont figés, rendus bruts), même méthode d'une lecture à l'autre (`$rows.filter == $rows.filter`),
// constructeur des listes remplacé par la page (`map` rend un `Array`), rappel qui porte sa propre méthode `call` ou
// `Function.prototype.call` remplacé par la page (le rappel n'y passe pas), donnée définie par la variable avec
// `Object.defineProperty` (une écriture, comme `$rows[1].sel = …` : la valeur suit dès sa lecture suivante). Happy-dom en développement et en production ; Chromium, Firefox et WebKit en production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// une seule valeur dérivée : aucune valeur sœur ne fait douter la liste à sa place
const SEULE = `<script>
$rows = []
$pos = {x: 0}
$vis = $rows.filter((r) -> r.sel)
@choisir = (x) -> $rows = x
@bouger = (i) -> $pos = {x: i}
@editer = (i) -> $rows[i].sel = not $rows[i].sel
</script>
<p class="v">{$vis.length}</p>
`

const METHODES = `<script>
$rows = []
$pos = {x: 0}
$vis = $rows.filter((r) -> r.sel)
$noms = $rows.map((r) -> r.l)
$meme = [$rows.filter == $rows.filter, $rows.map == $rows.map, $rows.find == $rows.find]
@choisir = (x) -> $rows = x
@bouger = (i) -> $pos = {x: i}
@editer = (i) -> $rows[i].sel = not $rows[i].sel
</script>
<p class="v">{$vis.length}|{$noms.length}</p>
`

const CRITERE = `<script>
$rows = []
$crit = null
$pos = {x: 0}
$fc = $rows.filter($crit)
@choisir = (x) -> $rows = x
@critere = (f) -> $crit = f
@bouger = (i) -> $pos = {x: i}
</script>
<p class="v">{$pos.x}</p>
`

const TAGS = 'mjs-derive-native-seule, mjs-derive-native-methodes, mjs-derive-native-critere'
const CORPS = ['gel-brut', 'gel-enveloppe', 'definie'].map((i) => `<mjs-derive-native-seule id="${i}"></mjs-derive-native-seule>`).join('')
  + ['meme', 'species', 'ctor'].map((i) => `<mjs-derive-native-methodes id="${i}"></mjs-derive-native-methodes>`).join('')
  + ['call-propre', 'call-page'].map((i) => `<mjs-derive-native-critere id="${i}"></mjs-derive-native-critere>`).join('')

const SCENARIO = `(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 15))
  const R = {}
  const el = (id) => document.getElementById(id)
  const mk = (n) => Array.from({length: n}, (_, i) => ({id: i, l: 'l' + i, sel: i % 2 === 0}))
  const un = (x) => x == null ? '_' : typeof x === 'object' ? '#' + x.id : String(x)
  const fmt = (v) => Array.isArray(v) ? '[' + Array.from(v, un).join(',') + ']' : un(v)
  const lire = (m, ...ks) => {
    try {
      return (ks.length ? ks : ['vis']).map((k) => k + '=' + fmt(m._state[k])).join(' ') + ' écran=' + m._shadow.querySelector('.v').textContent
    }
    catch (e) {
      return 'ERR ' + e.name + ' ' + e.message
    }
  }
  const bruts = (m, arr) => { const v = m._state.vis; return v.filter((x) => arr.includes(x)).length + '/' + v.length + ' bruts' }
  const proto = (v, L) => { const p = Object.getPrototypeOf(v); return p === Array.prototype ? 'Array' : p === L.prototype ? 'L' : 'autre' }
  const cas = async (nom, fn) => { try { await fn() } catch (e) { R[nom + ' !'] = 'EXC ' + e.message } }
  // élément Proxy de l'application qui rend les données de sa cible et joue, à sa lecture de sel, l'action armée
  window.__arme = null
  const pieger = (o, nom) => new Proxy(o, {get: (t, k, rc) => {
    if (k === 'sel' && window.__arme) { const f = window.__arme; window.__arme = null; f(); R[nom + ' action'] = 'jouée' }
    return Reflect.get(t, k, rc)
  }})
  // liste gelée par le rappel pendant le parcours, directement ou par la variable
  for (const [nom, parVariable] of [['gel-brut', false], ['gel-enveloppe', true]]) await cas(nom, async () => {
    const m = el(nom), arr = mk(6)
    arr[0] = pieger(arr[0], nom)
    m.choisir(arr); await pause(); R[nom + '.0'] = lire(m)
    const env = m._state.rows
    window.__arme = () => Object.freeze(parVariable ? env : arr)
    m.editer(1); await pause(); R[nom + '.1 gelée pendant le parcours'] = lire(m) + ' ' + bruts(m, arr)
    m.editer(2); await pause(); R[nom + '.2 édition'] = lire(m) + ' ' + bruts(m, arr)
    m.bouger(1); await pause(); R[nom + '.3 autre écriture'] = lire(m) + ' ' + bruts(m, arr)
  })
  // même méthode d'une lecture à l'autre
  await cas('meme', async () => {
    const m = el('meme')
    m.choisir(mk(4)); await pause(); R['meme.0'] = lire(m, 'vis', 'noms', 'meme')
    m.editer(1); await pause(); R['meme.1 recalcul'] = lire(m, 'vis', 'noms', 'meme')
  })
  // constructeur des listes remplacé par la page, par Array[Symbol.species] ou par Array.prototype.constructor
  for (const [nom, cible, cle] of [['species', Array, Symbol.species], ['ctor', Array.prototype, 'constructor']]) await cas(nom, async () => {
    const m = el(nom), d = Object.getOwnPropertyDescriptor(cible, cle)
    class L extends Array {}
    m.choisir(mk(4)); await pause(); R[nom + '.0'] = lire(m, 'vis', 'noms')
    try {
      Object.defineProperty(cible, cle, cle === 'constructor' ? {value: L, writable: true, configurable: true} : {get: () => L, configurable: true})
      m.editer(1)
      R[nom + '.1 remplacé'] = lire(m, 'vis', 'noms') + ' vis:' + proto(m._state.vis, L) + ' noms:' + proto(m._state.noms, L)
    }
    finally {
      Object.defineProperty(cible, cle, d)
    }
    await pause(); R[nom + '.2 rendu'] = lire(m, 'vis', 'noms')
  })
  // rappel qui porte sa propre méthode call
  await cas('call-propre', async () => {
    const m = el('call-propre'), f = (r) => r.sel
    f.call = () => true
    m.choisir(mk(4))
    m.critere(f); await pause(); R['call-propre.0 premier calcul'] = lire(m, 'fc')
    m.bouger(1); await pause(); R['call-propre.1 autre écriture'] = lire(m, 'fc')
  })
  // Function.prototype.call remplacé par la page : le rappel n'y passe pas
  await cas('call-page', async () => {
    const m = el('call-page'), f = (r) => r.sel, orig = Function.prototype.call
    let n = 0
    m.choisir(mk(4))
    try {
      Function.prototype.call = function (...a) { if (this === f) n++; return orig.apply(this, a) }
      m.critere(f)
      R['call-page.0 premier calcul'] = lire(m, 'fc')
    }
    finally {
      Function.prototype.call = orig
    }
    R['call-page.0 rappel passé par call'] = n
  })
  // donnée définie par la variable
  await cas('definie', async () => {
    const m = el('definie'), arr = mk(4)
    m.choisir(arr); await pause(); R['definie.0'] = lire(m)
    Object.defineProperty(m._state.rows[1], 'sel', {value: !arr[1].sel, writable: true, enumerable: true, configurable: true})
    R['definie.1 relue aussitôt'] = lire(m)
    await pause(); R['definie.2 après une pause'] = lire(m)
    m.bouger(1); await pause(); R['definie.3 autre écriture'] = lire(m)
    m.editer(2); await pause(); R['definie.4 édition'] = lire(m)
  })
  return R
})()`

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('derive-native')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-native-seule.mjs'), SEULE)
  writeFileSync(join(srcDir, 'derive-native-methodes.mjs'), METHODES)
  writeFileSync(join(srcDir, 'derive-native-critere.mjs'), CRITERE)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  opts.derivedMode = precise ? 'precise' : 'clock'
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

// tous les composants de la page dessinés
const PRETS = (tags: string) => [...document.querySelectorAll(tags)].every((e: any) => !!e._shadow?.querySelector('.v'))

async function jouerHappyDom(code: string): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  window.document.body.innerHTML = CORPS
  const fin = Date.now() + 5000
  while (![...window.document.querySelectorAll(TAGS)].every((e: any) => !!e._shadow?.querySelector('.v')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  // objets de la fenêtre de happy-dom : comparés par leur texte
  const r = JSON.parse(JSON.stringify(await window.eval(SCENARIO)))
  await window.happyDOM.close()
  return r
}

async function jouerMoteur(moteur: string, code: string): Promise<any> {
  const playwright: any = await import('playwright')
  const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  try {
    const page = await browser.newPage()
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${CORPS}<script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
    await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
    await page.goto('http://mjs.test/')
    await page.waitForFunction(PRETS, TAGS)
    return await page.evaluate(SCENARIO)
  }
  finally {
    await browser.close()
  }
}

// la valeur précise rend ce que rend le paquet à l'horloge ; repères : le scénario a joué jusqu'au bout, l'action armée
// a joué pendant le parcours, l'horloge rend ce qu'on attend d'elle
function verifier(precise: any, horloge: any) {
  assert.ok(!Object.keys(horloge).some((k) => k.endsWith(' !')), JSON.stringify(horloge))
  assert.equal(horloge['gel-brut action'], 'jouée')
  assert.equal(horloge['gel-enveloppe action'], 'jouée')
  assert.match(horloge['gel-brut.1 gelée pendant le parcours'], /^vis=\[#0,#1,#2,#4\] .* 3\/4 bruts$/)
  assert.match(horloge['gel-enveloppe.1 gelée pendant le parcours'], /^vis=\[#0,#1,#2,#4\] .* 3\/4 bruts$/)
  assert.match(horloge['meme.1 recalcul'], / meme=\[true,true,true\] /)
  assert.match(horloge['species.1 remplacé'], / vis:Array noms:Array$/)
  assert.match(horloge['ctor.1 remplacé'], / vis:Array noms:Array$/)
  assert.match(horloge['call-propre.0 premier calcul'], /^fc=\[#0,#2\] /)
  assert.match(horloge['call-page.0 premier calcul'], /^fc=\[#0,#2\] /)
  assert.equal(horloge['call-page.0 rappel passé par call'], 0)
  assert.match(horloge['definie.1 relue aussitôt'], /^vis=\[#0,#1,#2\] /)
  assert.match(horloge['definie.3 autre écriture'], /^vis=\[#0,#1,#2\] /)
  assert.deepEqual(precise, horloge)
}

describe('valeurs dérivées précises : la liste parcourue d\'un bloc se comporte comme la méthode de JavaScript', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let precise: string
      let horloge: string
      before(async () => {
        precise = await construire(prod, true)
        horloge = await construire(prod, false)
      })

      it('happy-dom : même résultat que sans l\'option', async () => {
        verifier(await jouerHappyDom(precise), await jouerHappyDom(horloge))
      })

      if (!prod) return
      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : même résultat qu'à l'horloge`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          verifier(await jouerMoteur(moteur, precise), await jouerMoteur(moteur, horloge))
        })
      }
    })
  }
})
