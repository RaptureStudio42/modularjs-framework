// Un objet affecté à l'état y est rangé TEL QUEL : ni copié, ni parcouru. Défauts garantis absents : l'affectation
// parcourait toute la donnée à la recherche d'enveloppes réactives, et copiait l'objet qui en tenait. Un accesseur
// (`get total()`) était lu et figé en valeur (le total ne suivait plus la liste), un accesseur qui lève faisait lever
// l'affectation, une donnée profonde (liste chaînée de 50 000 maillons) débordait la pile, deux variables qui
// recevaient le même objet ne désignaient plus la même donnée, un objet gelé devenait modifiable, et une donnée neuve
// (réponse JSON) était parcourue jusqu'au fond. Une liste affectée range ses éléments bruts, dans une copie faite à
// chaque affectation : la liste donnée reste intacte, une liste gelée donne une copie gelée, deux variables qui
// reçoivent la même liste ont chacune la leur. Une liste rangée plus bas (`{list: $items.filter(…)}`) garde les
// enveloppes reçues, que la méthode qui l'a rangée soit écrite directement (`$carte.set(…)`, `$items.push(…)`) ou
// appelée sur une variable passée à une fonction : sa recherche par un élément ne les retrouve pas, une donnée si.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COEUR = `<script lang="js">
  $list = [{n: 1}, {n: 2}, {n: 3}];
  $box = null; $plain = null; $bad = null; $chain = null; $cyc = null; $a = null; $b = null; $g = null;
  $la = null; $lb = null; $lg = null; $big = null; $bigo = null;
  @panier = function() { $box = { items: $list.filter(() => true), get count() { return this.items.length; } }; };
  @ajouter = function() { $box.items.push({n: 4}); };
  @lecture = function() { window.__lu = 0; $plain = { n: 1, get lu() { window.__lu++; return 1; } }; return window.__lu; };
  @leve = function() { $bad = { n: 1, get plusTard() { throw new Error('pas prêt'); } }; return 'ok'; };
  @chaine = function(n) { let c = null; for (let i = 0; i < n; i++) c = { next: c, i: i }; $chain = c; return $chain.i; };
  @cycle = function() { const o = { list: $list.filter(() => true) }; o.self = o; $cyc = o; return o; };
  @partage = function() { const s = { list: $list.filter(() => true), tag: 'x' }; $a = s; $b = s; return s; };
  @ecrire = function() { $a.tag = 'y'; };
  @gele = function() { $g = Object.freeze({ list: $list.filter(() => true), n: 1 }); };
  @partageListe = function() { const l = $list.filter(() => true); $la = l; $lb = l; return l; };
  @pousser = function() { $la.push({n: 9}); };
  @geleListe = function() { $lg = Object.freeze($list.filter(() => true)); };
  @espion = function() {
    window.__lus = 0;
    const compte = { get(t, k) { window.__lus++; return Reflect.get(t, k); }, ownKeys(t) { window.__lus++; return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { window.__lus++; return Reflect.getOwnPropertyDescriptor(t, k); } };
    $big = [{ id: 1, meta: new Proxy({ x: 1 }, compte) }];
    $bigo = { id: 2, meta: new Proxy({ x: 2 }, compte) };
    return window.__lus;
  };
</script>
<p class="c">{$box ? $box.count : '-'}</p>
<p class="a">{$a ? $a.tag : '-'}</p><p class="b">{$b ? $b.tag : '-'}</p>
<p class="lb">{$lb ? $lb.length : '-'}</p>
`

const DIRECT = `<script>
$list = [{n: 1}, {n: 2}]
$carte = new Map()
$items = []
$r = ''
essai = ->
  $carte.set('l', {list: $list.filter(-> true)})
  $items.push({list: $list.filter(-> true)})
  poser = (m, x) -> m.set('e', x)
  poser($carte, {list: $list.filter(-> true)})
  $r = [$carte.get('l').list.indexOf($list[0]), $items[0].list.indexOf($list[1]), $carte.get('e').list.indexOf($list[0]), $items[0].list.includes($list[0]), $carte.get('l').list.lastIndexOf($list[1]), $carte.get('l').list.findIndex((x) -> x.n == 2), $items[0].list.findIndex((x) -> x == $list[1])].join(',')
</script>
<p class="r">{$r}</p>
<button class="go" @click={essai()}>go</button>
`

describe('état réactif — un objet affecté est rangé tel quel, une liste affectée par une copie de ses données brutes', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    const root = mjsTmp('objet-range-tel-quel')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-rtq-coeur.mjs'), COEUR)
    writeFileSync(join(root, 'src', 'tst-rtq-direct.mjs'), DIRECT)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  const monter = async (nom: string, jeu: (c: any, el: any, µ: any) => Promise<void>) => {
    const c = await app.mount(nom)
    try {
      await jeu(c, c.el, app.window.µ)
    } finally {
      c.destroy()
    }
  }

  it('un accesseur reste un accesseur : jamais lu à l\'affectation, il suit la liste qu\'il compte', () => monter('tst-rtq-coeur', async (c, el, µ) => {
    el.panier()
    await c.tick()
    assert.equal(typeof Object.getOwnPropertyDescriptor(µ._mjs_toRaw(el._state.box), 'count')?.get, 'function', 'accesseur gardé')
    assert.equal(c.find('p.c').textContent, '3')
    el.ajouter()
    await c.tick()
    assert.equal(c.find('p.c').textContent, '4', 'le total suit la liste')
    assert.equal(el.lecture(), 0, 'accesseur jamais lu à l\'affectation')
    assert.equal(el.leve(), 'ok', 'un accesseur qui lève ne fait pas lever l\'affectation')
  }))

  it('une donnée profonde (50 000 maillons) se range sans déborder la pile', () => monter('tst-rtq-coeur', async (_c, el) => {
    assert.equal(el.chaine(50000), 49999)
  }))

  it('le même objet donné à deux variables : une seule donnée, une écriture par l\'une se voit par l\'autre', () => monter('tst-rtq-coeur', async (c, el, µ) => {
    const s = el.partage()
    await c.tick()
    assert.equal(µ._mjs_toRaw(el._state.a), s, 'l\'objet donné lui-même')
    assert.equal(µ._mjs_toRaw(el._state.b), s)
    el.ecrire()
    await c.tick()
    assert.equal(el._state.b.tag, 'y')
    assert.equal(c.find('p.b').textContent, 'y', 'le lecteur de l\'autre variable est redessiné')
    const o = el.cycle()
    assert.equal(µ._mjs_toRaw(el._state.cyc), o, 'objet qui se désigne lui-même : rangé tel quel')
    assert.equal(µ._mjs_toRaw(el._state.cyc).self, o)
  }))

  it('un objet gelé reste gelé', () => monter('tst-rtq-coeur', async (_c, el, µ) => {
    el.gele()
    assert.equal(Object.isFrozen(µ._mjs_toRaw(el._state.g)), true)
    try {
      el._state.g.n = 2
    } catch {
      // écriture refusée par l'objet gelé
    }
    assert.equal(el._state.g.n, 1, 'écriture refusée')
  }))

  it('la même liste donnée à deux variables : chacune sa copie brute, gelée si la liste l\'était ; la liste donnée intacte', () => monter('tst-rtq-coeur', async (c, el, µ) => {
    const l = el.partageListe()
    await c.tick()
    const la = µ._mjs_toRaw(el._state.la)
    assert.notStrictEqual(la, µ._mjs_toRaw(el._state.lb), 'deux copies')
    assert.equal(la.some((e: any) => e !== µ._mjs_toRaw(e)), false, 'éléments rangés bruts')
    assert.equal(la.indexOf(µ._mjs_toRaw(el._state.list[1])), 1)
    assert.equal(l.some((e: any) => e !== µ._mjs_toRaw(e)), true, 'la liste donnée garde ce qu\'elle tenait')
    el.pousser()
    await c.tick()
    assert.equal(el._state.la.length, 4)
    assert.equal(el._state.lb.length, 3, 'l\'ajout par l\'une ne touche pas l\'autre')
    assert.equal(c.find('p.lb').textContent, '3', 'affichage d\'accord avec la donnée')
    el.geleListe()
    assert.equal(Object.isFrozen(µ._mjs_toRaw(el._state.lg)), true, 'liste gelée : copie gelée')
    assert.equal(el._state.lg.indexOf(el._state.list[2]), 2)
  }))

  it('une donnée neuve n\'est pas parcourue : rien n\'est lu sous ses éléments', () => monter('tst-rtq-coeur', async (_c, el) => {
    assert.equal(el.espion(), 0)
  }))

  it('liste rangée dans un objet par une méthode écrite directement ou appelée par une fonction : elle garde ses enveloppes, une donnée la retrouve', () => monter('tst-rtq-direct', async (c) => {
    await c.click('.go')
    assert.equal(c.find('p.r').textContent, '-1,-1,-1,false,-1,1,1')
  }))
})
