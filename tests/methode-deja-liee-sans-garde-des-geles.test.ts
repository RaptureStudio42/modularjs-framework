// Lecture d'une méthode par l'enveloppe réactive de l'état (`$sel.includes(row)` dans chaque ligne d'une liste) : la garde
// des objets gelés (µ._mjs_fixed) était appelée à CHAQUE lecture, avant même de chercher la méthode déjà liée — un appel de
// plus par ligne, qui ralentissait le rendu d'une sélection dans une longue liste. Une méthode du prototype déjà liée se
// rend maintenant sans payer la garde ; un objet gelé après une première lecture rend toujours sa propre valeur, brute
// (la règle des Proxy l'exige).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = [
  '<script lang="js">',
  '  $sel = [{id: 1}, {id: 2}];',
  '  $o = {n: 2, double() { return this.n * 2; }};',
  '  @prendre = function() { return $sel[1]; };',
  '  @chercher = function(n, x) { let t = 0; for (let i = 0; i < n; i++) if ($sel.includes(x)) t++; return t; };',
  '  @doubler = function() { return $o.double(); };',
  '  @geler = function() { Object.freeze(µ._mjs_toRaw($o)); };',
  '  @lireMethode = function() { return $o.double === µ._mjs_toRaw($o).double; };',
  '</script>',
  '<p class="v">{$sel.length}</p>',
].join('\n')

describe('enveloppe réactive — une méthode déjà liée ne paie pas la garde des objets gelés', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    const root = mjsTmp('methode-liee-garde')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-mlg.mjs'), SOURCE)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    app = await createHarness({ root })
  })

  after(async () => { if (app) await app.destroy() })

  it('1 000 lectures de `$sel.includes`, méthode déjà liée : la garde n\'est plus appelée', async () => {
    const c = await app.mount('tst-mlg')
    const µ = app.window.µ
    const x = c.el.prendre()
    assert.equal(c.el.chercher(1, x), 1, 'première lecture : la méthode est liée')
    const garde = µ._mjs_fixed
    let appels = 0
    µ._mjs_fixed = (o: any, k: any) => { appels++; return garde(o, k) }
    try {
      assert.equal(c.el.chercher(1000, x), 1000)
    }
    finally {
      µ._mjs_fixed = garde
    }
    assert.equal(appels, 0, 'appels de la garde pour 1 000 lectures : ' + appels)
    c.destroy()
  })

  it('objet gelé après une première lecture de sa méthode : la lecture suivante rend sa valeur brute, sans erreur', async () => {
    const c = await app.mount('tst-mlg')
    assert.equal(c.el.doubler(), 4)
    assert.equal(c.el.lireMethode(), false, 'ouvert aux ajouts : méthode liée à l\'enveloppe')
    c.el.geler()
    assert.equal(c.el.lireMethode(), true, 'gelé : la méthode propre, brute')
    assert.equal(c.el.doubler(), 4)
    c.destroy()
  })
})
