// l'état du composant pris comme valeur, dans Chromium réel (production : bundle chargé en module, donc en mode strict, noms
// internes raccourcis) : `s = $` ou une fonction qui reçoit `$` chez le parent, `s = $` chez l'enfant, et la prop objet de
// l'enfant prise par un nom, puis une écriture par des clés venues du dehors (`s[k1][k2] = v`, et sur trois niveaux) : ni
// `Object.prototype`, ni `Object`, ni les fonctions héritées de la page ne gardent rien ; après `s['hasOwnProperty']['call'] = v`,
// la page ne lève pas et l'écran suit. Témoin : les lectures ordinaires de l'état pris comme valeur restent justes

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, type Ouverture } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-mur-parent'

const SOURCES: Record<string, string> = {
  'mur-parent.mjs': `<script>
  $x = 1
  $double = $x * 2
  $o = { a: 1 }
  $liste = [1, 2, 3]
  $m = new Map([['a', 1]])
  @plus = -> $x++
  @percer = (k1, k2, v) ->
    s = $
    s[k1][k2] = v
    0
  @percer3 = (k1, k2, k3, v) ->
    s = $
    s[k1][k2][k3] = v
    0
  @confier = (f, cles, v) ->
    f($, cles, v)
    0
  @lire = ->
    s = $
    [s.x, s.double, s.liste.map((n) -> n * 2).join(','), s.m.get('a'), s.hasOwnProperty('x'), s.toString(), s.valueOf() is s, 'x' in s].join(' ')
</script>
<p class="x">{$x}</p>
<@mur-enfant cfg={$o}></@mur-enfant>
`,
  'mur-enfant.mjs': `<script>
  $cfg = { a: 0 }
  @percer = (k1, k2, v) ->
    s = $
    s[k1][k2] = v
    0
  @percerProp = (k1, k2, v) ->
    o = $cfg
    o[k1][k2] = v
    0
</script>
<p class="c">{$cfg.a}</p>
`
}

// chaque voie × chaque jeu de clés, la page remise après chaque scène : seules les traces laissées sont rendues
const BANC = `(() => {
  const p = document.querySelector('${BALISE}'), e = p._shadow.querySelector('mjs-mur-enfant'), r = {}
  const poser = (o, cles, v) => { const d = cles.pop(); cles.reduce((x, k) => x[k], o)[d] = v }
  const traces = () => JSON.stringify([Object.prototype.pollue, Object.pollue, Object.prototype.toString.pollue, Object.getOwnPropertyDescriptor(Object.prototype.hasOwnProperty, 'call') ? 'call écrit' : 'intact'])
  const nettoyer = () => { delete Object.prototype.pollue; delete Object.pollue; delete Object.prototype.toString.pollue; delete Object.prototype.hasOwnProperty.call }
  const jouer = (nom, ecrire) => {
    try { ecrire() }
    catch (x) { /* une clé qui ne mène à rien lève, comme en JavaScript */ }
    const t = traces()
    if (t !== '[null,null,null,"intact"]') r[nom] = t
    nettoyer()
  }
  for (const [a, b] of [['__proto__', 'pollue'], ['constructor', 'pollue'], ['prototype', 'pollue'], ['toString', 'pollue'], ['hasOwnProperty', 'call']]) {
    jouer('parent, s = $ [' + a + '][' + b + ']', () => p.percer(a, b, 'oui'))
    jouer('parent, fonction qui reçoit $ [' + a + '][' + b + ']', () => p.confier(poser, [a, b], 'oui'))
    jouer('enfant, s = $ [' + a + '][' + b + ']', () => e.percer(a, b, 'oui'))
    jouer('enfant, prop prise par un nom [' + a + '][' + b + ']', () => e.percerProp(a, b, 'oui'))
  }
  jouer('parent, s = $ [constructor][prototype][pollue]', () => p.percer3('constructor', 'prototype', 'pollue', 'oui'))
  jouer('parent, fonction qui reçoit $ [constructor][prototype][pollue]', () => p.confier(poser, ['constructor', 'prototype', 'pollue'], 'oui'))
  return r
})()`

describe('état pris comme valeur, Chromium réel (production, mode strict) : clés venues du dehors, ni prototype, ni Object, ni fonction de la page atteints', function () {
  this.timeout(120000)
  let browser: any = null
  let o: Ouverture

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) {
      console.log('  ℹ️  chromium non installé, test de l\'état pris comme valeur en production sauté. Activer : `npx playwright install chromium`')
      this.skip()
    }
    browser = await playwright.chromium.launch()
    o = await charger(browser, await construire('bundle', SOURCES, [BALISE]), BALISE)
    await o.page.waitForFunction(`!!((document.querySelector('${BALISE}') || {})._shadow || {}).querySelector && !!document.querySelector('${BALISE}')._shadow.querySelector('mjs-mur-enfant')`, null, { timeout: 10000 })
    await o.page.waitForTimeout(200)
  })

  after(async () => {
    if (o) await o.fermer()
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('témoin : les lectures ordinaires de l\'état pris comme valeur restent justes', async () => {
    assert.equal(await o.page.evaluate(`document.querySelector('${BALISE}').lire()`), '1 2 2,4,6 1 true [object Object] true true')
  })

  it('parent, fonction qui reçoit $, enfant, prop de l\'enfant : aucune trace dans la page, à deux et trois niveaux', async () => {
    assert.deepEqual(await o.page.evaluate(BANC), {})
  })

  it('après s[\'hasOwnProperty\'][\'call\'] = v, la page ne lève pas : hasOwnProperty.call répond, l\'écran suit', async () => {
    await o.page.evaluate(`(() => { try { document.querySelector('${BALISE}').percer('hasOwnProperty', 'call', 'cassé') } catch (x) { /* seul compte ce que la page en garde */ } })()`)
    assert.equal(await o.page.evaluate('(() => { try { return String(Object.prototype.hasOwnProperty.call({ a: 1 }, "a")) } catch (e) { return "levé " + e.message } })()'), 'true')
    await o.page.evaluate(`document.querySelector('${BALISE}').plus()`)
    await o.page.waitForFunction(`document.querySelector('${BALISE}')._shadow.querySelector('.x').textContent === '2'`, null, { timeout: 5000 })
    assert.deepEqual(graves(o), [])
  })
})
