// l'état du composant pris comme valeur (`s = $`, ou une fonction qui reçoit `$`), puis une écriture par des clés venues du dehors
// (`s[k1][k2] = v`, et sur trois niveaux) : sous un nom réservé hérité (`__proto__`, `constructor`, `prototype`), l'état ne rend
// rien, ni `Object.prototype` ni `Object` ne reçoivent la valeur ; une fonction héritée (`toString`, `hasOwnProperty`) sort en copie
// liée, ce qu'on y écrit ne touche pas celle de la page, qui ne lève pas après `s['hasOwnProperty']['call'] = v`. Mêmes écritures
// par les autres voies de la famille : un objet, une liste, une `Map` de l'état (`o = $o`), le magasin (`g = $$g`), `µ.state` et `µ.Store`, à la racine
// et plus bas. Témoin : les lectures ordinaires de l'état pris comme valeur (variable, valeur dérivée, méthode de liste, `Map`,
// méthodes héritées, `s.valueOf() === s`) restent justes

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const HOTE = `<script>
  $x = 1
  $double = $x * 2
  $o = { a: 1 }
  $liste = [1, 2, 3]
  $m = new Map([['a', 1]])
  $$g = { a: 1 }
  @etat = µ.state({})
  @magasin = new µ.Store({})
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
  @percerObjet = (k1, k2, v) ->
    o = $o
    o[k1][k2] = v
    0
  @percerListe = (k1, k2, v) ->
    l = $liste
    l[k1][k2] = v
    0
  @percerMap = (k1, k2, v) ->
    m = $m
    m[k1][k2] = v
    0
  @percerMagasin = (k1, k2, v) ->
    g = $$g
    g[k1][k2] = v
    0
  @lire = ->
    s = $
    [s.x, s.double, s.liste.map((n) -> n * 2).join(','), s.m.get('a'), s.hasOwnProperty('x'), s.toString(), s.valueOf() is s, 'x' in s].join(' ')
</script>
<p class="x">{$x}</p>
`

// clés venues du dehors ; ce que la page en garderait, puis la page remise après chaque scène
const SCENES: [string, string][] = [['__proto__', 'pollue'], ['constructor', 'pollue'], ['prototype', 'pollue'], ['toString', 'pollue'], ['hasOwnProperty', 'call']]
const TRACES   = 'JSON.stringify([Object.prototype.pollue, Object.pollue, Object.prototype.toString.pollue, Object.getOwnPropertyDescriptor(Object.prototype.hasOwnProperty, "call") ? "call écrit" : "intact"])'
const PROPRE   = '[null,null,null,"intact"]'
const NETTOYER = 'delete Object.prototype.pollue; delete Object.pollue; delete Object.prototype.toString.pollue; delete Object.prototype.hasOwnProperty.call'

// autres voies : ce que chacune tient, pris dans la page
const VOIES: [string, string][] = [
  ['µ.state, racine', 'µ.state({ a: 1, cfg: { b: 1 } })'],
  ['µ.state, objet plus bas', 'µ.state({ a: 1, cfg: { b: 1 } }).cfg'],
  ['µ.state, liste plus bas', 'µ.state({ l: [1] }).l'],
  ['µ.state, Map plus bas', 'µ.state({ m: new Map() }).m'],
  ['µ.Store, racine', 'new µ.Store({ a: 1, cfg: { b: 1 } }).data'],
  ['µ.Store, objet plus bas', 'new µ.Store({ a: 1, cfg: { b: 1 } }).data.cfg'],
  ['µ.Store, liste plus bas', 'new µ.Store({ l: [1] }).data.l'],
  ['µ.Store, Map plus bas', 'new µ.Store({ m: new Map() }).data.m']
]

describe('état pris comme valeur, écrit par des clés venues du dehors : ni prototype, ni Object, ni fonction de la page atteints', function () {
  this.timeout(60000)

  let window: any, hote: any, erreurs: string[]
  const jouer = (ecrire: () => unknown): string => {
    try { ecrire() }
    catch { /* une clé qui ne mène à rien lève, comme en JavaScript */ }
    const traces = window.eval(TRACES)
    window.eval(NETTOYER)
    return traces
  }

  before(async () => {
    ({ window, hote, erreurs } = await monterHote(HOTE, 'etat-valeur-mur'))
    window.eval('globalThis.__poser = (o, cles, v) => { const d = cles.pop(); cles.reduce((x, k) => x[k], o)[d] = v }')
  })

  afterEach(() => window.eval(NETTOYER))

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('témoin : les lectures ordinaires de l\'état pris comme valeur restent justes', () => {
    assert.equal(hote.lire(), '1 2 2,4,6 1 true [object Object] true true')
  })

  for (const [k1, k2] of SCENES) {
    it(`s = $ puis s['${k1}']['${k2}'] = v : la page ne garde rien`, () => {
      assert.equal(jouer(() => hote.percer(k1, k2, 'oui')), PROPRE)
    })

    it(`une fonction qui reçoit $ écrit ['${k1}']['${k2}'] : la page ne garde rien`, () => {
      assert.equal(jouer(() => hote.confier(window.eval('__poser'), [k1, k2], 'oui')), PROPRE)
    })
  }

  it('trois niveaux, [\'constructor\'][\'prototype\'][\'pollue\'] : Object.prototype ne reçoit rien', () => {
    assert.equal(jouer(() => hote.percer3('constructor', 'prototype', 'pollue', 'oui')), PROPRE, 's = $')
    assert.equal(jouer(() => hote.confier(window.eval('__poser'), ['constructor', 'prototype', 'pollue'], 'oui')), PROPRE, 'une fonction qui reçoit $')
  })

  for (const [k1, k2] of SCENES) {
    it(`autres voies, ['${k1}']['${k2}'] : un objet, une liste, une Map de l'état, le magasin, µ.state et µ.Store ne laissent rien à la page`, () => {
      const vu: Record<string, string> = {}
      vu['objet de l\'état (o = $o)']     = jouer(() => hote.percerObjet(k1, k2, 'oui'))
      vu['liste de l\'état (l = $liste)'] = jouer(() => hote.percerListe(k1, k2, 'oui'))
      vu['Map de l\'état (m = $m)']       = jouer(() => hote.percerMap(k1, k2, 'oui'))
      vu['magasin (g = $$g)']             = jouer(() => hote.percerMagasin(k1, k2, 'oui'))
      for (const [voie, prise] of VOIES) vu[voie] = jouer(() => window.eval(`__poser(${prise}, ['${k1}', '${k2}'], 'oui')`))
      assert.deepEqual(Object.entries(vu).filter(([, t]) => t !== PROPRE), [])
    })
  }

  it('après s[\'hasOwnProperty\'][\'call\'] = v, la page ne lève pas : hasOwnProperty.call répond, l\'écran suit', async () => {
    try { hote.percer('hasOwnProperty', 'call', 'cassé') }
    catch { /* rien à faire : seul compte ce que la page en garde */ }
    assert.equal(window.eval('(() => { try { return String(Object.prototype.hasOwnProperty.call({ a: 1 }, "a")) } catch (e) { return "levé " + e.message } })()'), 'true')
    hote.plus()
    await attendre(() => hote._shadow.querySelector('.x').textContent === '2')
    assert.equal(hote._shadow.querySelector('.x').textContent, '2')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })

  it('µ.state : une méthode de classe lue deux fois rend la même fonction, removeEventListener retrouve l\'écouteur posé', () => {
    assert.equal(window.eval(`(() => {
      class C { h() { this.n = (this.n || 0) + 1 } }
      const st = µ.state({ c: new C() }), el = document.createElement('div')
      el.addEventListener('x', st.c.h)
      el.removeEventListener('x', st.c.h)
      el.dispatchEvent(new Event('x'))
      return [st.c.h === st.c.h, st.c.n === undefined, st.c.toString === st.c.toString].join(' ')
    })()`), 'true true true')
  })
})
