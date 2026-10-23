// Une liste donnée à une méthode qui range (`$groupes.push(l)`, `$ouverts.add(l)`, `$carte.set(k, l)`) est rangée
// telle quelle : la liste donnée la retrouve (`indexOf`, `includes`, `has`) et `delete` la retire. Défaut garanti
// absent : la méthode rangeait une copie de la liste, que la recherche ne connaissait pas — `$groupes.indexOf(l)`
// rendait -1, et `$groupes.splice($groupes.indexOf(l), 1)` retirait le dernier groupe. Même chose pour `add` et `set`
// appelés sur une variable passée à une fonction.
// La recherche d'un élément absent (`includes`, `indexOf`) ne relit aucun élément : elle recopiait toute la liste à
// chaque recherche ratée (une ligne de {for} marquée par `$sel.includes(row)` coûtait quatre fois plus à redessiner).
// Deux composants qui reçoivent la même liste en ont chacun leur copie : l'écriture de l'un ne change pas la donnée
// de l'autre, dont l'affichage reste d'accord avec sa donnée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COEUR = `<script lang="js">
  $items = [{n: 1}, {n: 2}, {n: 3}];
  $groupes = [];
  $ouverts = new Set();
  $carte = new Map();
  $ens = new Set();
  $dico = new Map();
  $sel = [];
  $a = [];
  @direct = function() {
    const l = $items.filter(() => true);
    $groupes.push(l);
    $groupes.push([{n: 9}]);
    $ouverts.add(l);
    $carte.set('l', l);
    const r = [$groupes.indexOf(l), $groupes.includes(l), $ouverts.has(l)];
    $groupes.splice($groupes.indexOf(l), 1);
    r.push($groupes.length, $groupes[0][0].n, $ouverts.delete(l), $ouverts.size);
    return [r.join(','), l];
  };
  @echappe = function() {
    const mettre = (s, x) => s.add(x);
    const poser = (m, x) => m.set('k', x);
    const l = $items.filter(() => true);
    mettre($ens, l);
    poser($dico, l);
    const r = [$ens.has(l)];
    r.push($ens.delete(l), $ens.size);
    return [r.join(','), l];
  };
</script>
<p class="a">{$a.length}</p>
`

describe('état réactif — une liste rangée par une méthode reste celle qu\'on a donnée, une recherche ratée ne recopie rien', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    const root = mjsTmp('liste-poussee-telle-quelle')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-lpt-coeur.mjs'), COEUR)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('push, add et set écrits directement : la liste donnée se retrouve, splice et delete la retirent', async () => {
    const c = await app.mount('tst-lpt-coeur')
    try {
      const µ = app.window.µ
      const [r, l] = c.el.direct()
      assert.equal(r, '0,true,true,1,9,true,0')
      assert.equal(µ._mjs_toRaw(c.el._state.carte).get('l'), l, 'Map : la liste donnée elle-même')
    }
    finally {
      c.destroy()
    }
  })

  it('add et set appelés sur une variable passée à une fonction : la liste donnée se retrouve', async () => {
    const c = await app.mount('tst-lpt-coeur')
    try {
      const µ = app.window.µ
      const [r, l] = c.el.echappe()
      assert.equal(r, 'true,true,0')
      assert.equal(µ._mjs_toRaw(c.el._state.dico).get('k'), l, 'Map : la liste donnée elle-même')
    }
    finally {
      c.destroy()
    }
  })

  it('une recherche ratée ne relit aucun élément de la liste', async () => {
    const c = await app.mount('tst-lpt-coeur')
    try {
      let lus = 0
      const espion = { get(t: any, k: any) { lus++; return Reflect.get(t, k) } }
      c.el._set('sel', [1, 2, 3, 4, 5].map((id) => new Proxy({ id }, espion)))
      const sel = c.el._state.sel
      const absent = { id: 0 }
      lus = 0
      const r = [sel.includes(absent), sel.indexOf(absent), sel.lastIndexOf(absent)]
      assert.deepEqual(r, [false, -1, -1])
      assert.equal(lus, 0, 'éléments relus : ' + lus)
    }
    finally {
      c.destroy()
    }
  })

  it('deux composants reçoivent la même liste : chacun sa copie, donnée et affichage d\'accord', async () => {
    const c1 = await app.mount('tst-lpt-coeur')
    const c2 = await app.mount('tst-lpt-coeur')
    try {
      const l = c1.el._state.items.filter(() => true)
      c1.el._set('a', l)
      c2.el._set('a', l)
      await c1.tick()
      c2.el._state.a.push({n: 4})
      await c1.tick()
      await c2.tick()
      assert.equal(c2.el._state.a.length, 4)
      assert.equal(c1.el._state.a.length, 3, 'la donnée de l\'autre composant ne change pas')
      assert.equal(c1.find('p.a').textContent, '3')
      assert.equal(c2.find('p.a').textContent, '4')
    }
    finally {
      c1.destroy()
      c2.destroy()
    }
  })
})
