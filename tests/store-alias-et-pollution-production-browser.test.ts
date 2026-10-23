// magasin `$$`, dans Chromium réel (production : bundle chargé en module, noms internes raccourcis) :
// - un alias écrit dans l'objet qu'il tient, comme JavaScript (`sous := $$cfg.a` puis `$$cfg = autre`, `premier :=
//   $$liste[0]` puis `unshift`), puis redessine ; jamais pris, il lève la TypeError de l'écriture ;
// - l'objet relu par `++` est tenu par un paramètre local : un accesseur qui écrit par find pendant la lecture ne
//   détourne pas l'écriture ; `delete` rend `true` ;
// - une clé calculée se lit comme JavaScript la lit : après un élément trouvé, après un alias, dans sa valeur, dans la
//   variable de travail de CoffeeScript (`||=`, `?=`), avec `'__proto__'`, `['__proto__']`, un objet dont `toString`
//   rend `'__proto__'`, `'constructor'`, `'prototype'` — chaque forme est jouée sur le magasin puis sur sa jumelle, la
//   même source où chaque `$$x` est un objet ordinaire de la page : le prototype ou la fonction où mènent `__proto__` et
//   `constructor` ne reçoivent rien du magasin (aucune trace), la jumelle laisse celle de JavaScript (prototypes écrits
//   ou effacés, erreur levée, données) ; `prototype` mène à `undefined`, et les deux laissent la même trace ; par un
//   chemin qui part de la racine (`$$taches[0][k1][k2] = v`, `delete`), la clé est refusée : le magasin ne garde aucune
//   trace, la jumelle celle de JavaScript

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

// formes d'écriture par une clé calculée, jouées sur le magasin et sur leur jumelle (cf. jumelle)
const FORMES_CIVET = `  $$taches = [{ id: 1, meta: { vu: false }, tags: [] }]
  @remettre = -> $$taches = [{ id: 1, meta: { vu: false }, tags: [] }]
  @lire = -> JSON.stringify($$taches)
  @fEgal = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2] = 'pollue'
  @fPlus = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2] += 'pollue'
  @fPousse = (k1) -> $$taches.find((x) -> x.id == 1).tags[k1].push('pollue')
  @fOptEgal = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1]?[k2] = 'pollue'
  @cEgal = (k1, k2) -> $$taches[0][k1][k2] = 'pollue'
  @cEfface = (k1, k2) -> delete $$taches[0][k1][k2]
  @cOptEgal = (k1, k2) -> $$taches[0][k1]?[k2] = 'pollue'
  @aEgal = (k1, k2) ->
    s := $$taches[0]
    s[k1][k2] = 'pollue'
  @aValeur = (k1, k2) ->
    pris := $$taches[0][k1]
    pris[k2] = 'pollue'
`
const FORMES_COFFEE = `$$cliste = [{ id: 1, meta: { vu: false }, tags: [] }]
@remettre = -> $$cliste = [{ id: 1, meta: { vu: false }, tags: [] }]
@lire = -> JSON.stringify($$cliste)
@fOu = (k1, k2) -> $$cliste.find((x) -> x.id == 1)[k1][k2] ||= 'pollue'
@fNul = (k1, k2) -> $$cliste.find((x) -> x.id == 1)[k1][k2] ?= 'pollue'
@cOu = (k1, k2) -> $$cliste[0][k1][k2] ||= 'pollue'
`

// la jumelle : la même source, chaque `$$x` remplacé par un objet ordinaire de la page — du JavaScript que MJS ne
// réécrit pas, compilé par Civet ou CoffeeScript comme le composant
const jumelle = (script: string) => script.replace(/\$\$(\w+)/g, 'globalThis.j_$1')

const SOURCES: Record<string, string> = {
  'prod-alias.mjs': `<script>
  $$liste = [{ id: 1, fait: false }, { id: 2, fait: false }]
  $$cfg = { a: { b: 0 } }
  $$a = [{ id: 1, get n() { $$b.find((x) -> x.id == 1).n += 0; return this._n }, set n(v) { this._n = v }, _n: 1 }]
  $$b = [{ id: 1, n: 5 }]
  @apresCle = ->
    sous := $$cfg.a
    $$cfg = { a: { b: 100 } }
    sous.b = 1
    window.__ancien = JSON.stringify(sous)
  @apresUnshift = ->
    premier := $$liste[0]
    $$liste.unshift({ id: 0, fait: false })
    premier.fait = true
  @sansValeur = (c) ->
    let s1
    if c
      s1 = $$cfg.a
    s1.b = 7
  @caseLocale = -> window.__v = $$a.find((x) -> x.id == 1).n++
  @etatA = -> JSON.stringify([$$a[0]._n, $$b[0].n])
  @effaceFind = -> delete $$taches.find((x) -> x.id == 1).vieux
${FORMES_CIVET}</script>

<p class="etat">{JSON.stringify($$liste)} {JSON.stringify($$cfg)} {JSON.stringify($$taches)}</p>
`,
  'prod-alias-coffee.mjs': `<script lang="coffee">
${FORMES_COFFEE}@cond = (c) ->
  s2 = $$cliste[0] if c
  s2.vu = 1
</script>

<p class="etat">{JSON.stringify($$cliste)}</p>
`,
  'prod-alias-js.mjs': `<script>\n${jumelle(FORMES_CIVET)}</script>\n\n<p class="etat">jumelle</p>\n`,
  'prod-alias-coffee-js.mjs': `<script lang="coffee">\n${jumelle(FORMES_COFFEE)}</script>\n\n<p class="etat">jumelle</p>\n`,
}
const BALISE = 'mjs-prod-alias'

// le banc joué dans la page : chaque forme, chaque clé, sur le composant puis sur sa jumelle — trace de chacun
// (prototypes écrits ou effacés, erreur levée, données), tout retiré ensuite, les données remises
const BANC = `(() => {
  const ecarts  = []
  const temoins = [Object.prototype, Object, Array.prototype, Function.prototype]
  const noms    = ['Object.prototype', 'Object', 'Array.prototype', 'Function.prototype']
  const cles    = [['__proto__', () => '__proto__'], ['[__proto__]', () => ['__proto__']], ['toString', () => ({ toString: () => '__proto__' })], ['constructor', () => 'constructor'], ['prototype', () => 'prototype']]
  const formes  = [['mjs-prod-alias', 'mjs-prod-alias-js', ['fEgal', 'fPlus', 'fPousse', 'fOptEgal', 'cEgal', 'cEfface', 'cOptEgal', 'aEgal', 'aValeur']], ['mjs-prod-alias-coffee', 'mjs-prod-alias-coffee-js', ['fOu', 'fNul', 'cOu']]]
  // formes par un chemin qui part de la racine : la clé passe le refus d'un nom réservé
  const refusees = new Set(['cEgal', 'cEfface'])
  const tracer  = (c, forme, cle) => {
    for (const t of temoins) Object.defineProperty(t, 'polluD', { value: 1, configurable: true, writable: true })
    let erreur = ''
    try {
      if (forme) c[forme](cle, forme.includes('Efface') ? 'polluD' : 'polluK')
    }
    catch (e) {
      erreur = e.name + ' ' + String(e.message).replace(/^.*?([\\w$]+) is not a function$/, '$1 is not a function')
    }
    const pollue = []
    temoins.forEach((t, i) => {
      if (Object.prototype.hasOwnProperty.call(t, 'polluK')) pollue.push(noms[i] + '.polluK')
      if (!Object.prototype.hasOwnProperty.call(t, 'polluD')) pollue.push(noms[i] + '.polluD retiré')
      delete t.polluK
      delete t.polluD
    })
    if (Array.prototype.length) pollue.push('Array.prototype[0]')
    Array.prototype.length = 0
    const donnees = c.lire()
    c.remettre()
    return JSON.stringify({ pollue, erreur, donnees })
  }
  let ecrits = 0
  for (const [balise, jum, liste] of formes) {
    const c = document.querySelector(balise)
    const j = document.querySelector(jum)
    const intact = tracer(c, '', null)
    for (const forme of liste) {
      for (const [nom, cle] of cles) {
        const magasin = tracer(c, forme, cle())
        const js      = tracer(j, forme, cle())
        const attendu = refusees.has(forme) || nom !== 'prototype' ? intact : js
        if (magasin !== attendu) ecarts.push(forme + '(' + nom + ') : magasin ' + magasin + ' ≠ ' + (attendu === js ? 'JavaScript ' : 'refus ') + attendu)
        if (JSON.parse(js).pollue.length) ecrits++
      }
    }
  }
  return { ecarts, ecrits }
})()`

const etat = (page: any, balise = BALISE): Promise<string> => page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('.etat').textContent`)

describe('magasin $$, Chromium réel (production) : alias à l\'objet tenu, aucune case partagée, une clé calculée refusée par le chemin, le prototype ou la fonction atteints refusés ailleurs', function () {
  this.timeout(120000)
  let browser: any = null

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) {
      console.log('  ℹ️  chromium non installé, test du magasin en production sauté. Activer : `npx playwright install chromium`')
      this.skip()
    }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('alias, ++ par find, delete, puis le banc des formes × clés : refus par le chemin ou de l\'objet atteint, trace de JavaScript pour prototype', async () => {
    const o = await charger(browser, await construire('bundle', SOURCES, [BALISE]), BALISE)
    try {
      await o.page.waitForFunction(`!!(document.querySelector('${BALISE}') || {})._shadow`, null, { timeout: 10000 })
      await o.page.evaluate(`document.body.appendChild(document.createElement('mjs-prod-alias-coffee'))`)
      await o.page.waitForFunction(`!!((document.querySelector('mjs-prod-alias-coffee') || {})._shadow || {}).textContent`, null, { timeout: 10000 })
      for (const jum of ['mjs-prod-alias-js', 'mjs-prod-alias-coffee-js']) {
        await o.page.evaluate(`document.body.appendChild(document.createElement('${jum}'))`)
        await o.page.waitForFunction(`!!((document.querySelector('${jum}') || {})._shadow || {}).textContent`, null, { timeout: 10000 })
      }
      await o.page.waitForTimeout(200)
      await o.page.evaluate(`(() => { const c = document.querySelector('${BALISE}'); c.apresCle(); c.apresUnshift(); c.caseLocale() })()`)
      await o.page.waitForTimeout(100)
      assert.equal(await o.page.evaluate('window.__ancien'), '{"b":1}', 'sous := $$cfg.a : l\'ancien objet est écrit')
      assert.equal(await etat(o.page), '[{"id":0,"fait":false},{"id":1,"fait":true},{"id":2,"fait":false}] {"a":{"b":100}} [{"id":1,"meta":{"vu":false},"tags":[]}]')
      assert.equal(await o.page.evaluate(`document.querySelector('${BALISE}').etatA()`), '[2,5]', '++ par find : l\'élément trouvé reçoit l\'incrément, l\'autre rien')
      assert.equal(await o.page.evaluate('window.__v'), 1)
      assert.match(await o.page.evaluate(`(() => { try { document.querySelector('${BALISE}').sansValeur(false); return 'rien' } catch (e) { return e.name + ' ' + e.message } })()`) as string, /^TypeError Cannot set properties of undefined \(setting 'b'\)$/)
      assert.match(await o.page.evaluate(`(() => { try { document.querySelector('mjs-prod-alias-coffee').cond(false); return 'rien' } catch (e) { return e.name + ' ' + e.message } })()`) as string, /^TypeError Cannot set properties of undefined \(setting 'vu'\)$/)
      assert.equal(await o.page.evaluate(`document.querySelector('${BALISE}').effaceFind()`), true, 'delete par find rend true')
      const avant  = await etat(o.page)
      const avantC = await etat(o.page, 'mjs-prod-alias-coffee')
      const banc = await o.page.evaluate(BANC) as { ecarts: string[], ecrits: number }
      assert.deepEqual(banc.ecarts, [])
      assert.ok(banc.ecrits >= 20, `la jumelle écrit dans un prototype ou une fonction (${banc.ecrits} fois) : la comparaison porte`)
      await o.page.waitForTimeout(100)
      assert.equal(await etat(o.page), avant, 'données remises : l\'écran revient à son état')
      assert.equal(await etat(o.page, 'mjs-prod-alias-coffee'), avantC)
      assert.deepEqual(graves(o), [])
    }
    finally {
      await o.fermer()
    }
  })
})
