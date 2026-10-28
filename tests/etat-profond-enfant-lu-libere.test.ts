// un objet de l'état lu par l'enveloppe de son conteneur, puis retiré de l'état, part au ramasse-miettes dès le tour suivant : écriture
// compilée (`$big.res = null`), suppression (`delete $sup.res`), écriture par une enveloppe échappée, liste vidée. L'enveloppe du
// conteneur ne le retient pas, même quand plus rien n'est relu dans ce conteneur. Dans un même tour, la relecture rend l'enveloppe déjà
// faite sans la redemander ; d'un tour à l'autre, c'est toujours la même enveloppe

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import { runInNewContext } from 'node:vm'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

// un ramasse-miettes complet, sans lancer node avec --expose-gc : le drapeau n'est levé que le temps de prendre la fonction
function collectGarbage(): void {
  v8.setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc')
  v8.setFlagsFromString('--no-expose-gc')
  gc()
}

async function liberee(ref: WeakRef<object>): Promise<boolean> {
  for (let i = 0; i < 20 && ref.deref(); i++) {
    await pause(10)
    collectGarbage()
  }
  return ref.deref() === undefined
}

const HOTE = `<script lang="js">
  $big = {res: {poids: 1}};
  $sup = {res: {poids: 2}};
  $esc = {res: {poids: 3}};
  $l = [{poids: 4}];
  $r = {k: {v: 1}};
  @vider = function() { const r = µ._mjs_toRaw($big.res); $big.res = null; return r; };
  @supprimer = function() { const r = µ._mjs_toRaw($sup.res); delete $sup.res; return r; };
  @regler = function(f) { return f($esc); };
  @retirer = function() { const r = µ._mjs_toRaw($l[0]); $l.pop(); return r; };
  @lireR = function() { return $r.k; };
  @lire = function(n) { let s = 0; for (let i = 0; i < n; i++) { s += $r.k.v; } return s; };
</script>
<p class="big">{$big.res ? $big.res.poids : 'vide'}</p><p class="sup">{$sup.res ? $sup.res.poids : 'vide'}</p><p class="esc">{$esc.res ? $esc.res.poids : 'vide'}</p><p class="l">{$l.length ? $l[0].poids : 'vide'}</p>
`

describe('état profond : un enfant lu puis retiré de l\'état n\'est pas retenu par l\'enveloppe de son conteneur', function () {
  this.timeout(60000)

  let window: any, hote: any, erreurs: string[]
  const texte = (sel: string) => hote._shadow.querySelector(sel).textContent

  before(async () => {
    ({ window, hote, erreurs } = await monterHote(HOTE, 'etat-enfant-libere'))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('écriture compilée : $big.res = null', async () => {
    assert.equal(texte('.big'), '1')
    const ref = new WeakRef(hote.vider())
    await pause(30)
    assert.equal(texte('.big'), 'vide')
    assert.ok(await liberee(ref), 'l\'objet retiré est libéré')
  })

  it('suppression : delete $sup.res', async () => {
    assert.equal(texte('.sup'), '2')
    const ref = new WeakRef(hote.supprimer())
    await pause(30)
    assert.equal(texte('.sup'), 'vide')
    assert.ok(await liberee(ref), 'l\'objet supprimé est libéré')
  })

  it('écriture par une enveloppe échappée : e.res = null', async () => {
    assert.equal(texte('.esc'), '3')
    const ref = new WeakRef(hote.regler((e: any) => { const r = window.µ._mjs_toRaw(e.res); e.res = null; return r }))
    await pause(30)
    assert.equal(texte('.esc'), 'vide')
    assert.ok(await liberee(ref), 'l\'objet retiré par l\'enveloppe échappée est libéré')
  })

  it('liste vidée : $l.pop()', async () => {
    assert.equal(texte('.l'), '4')
    const ref = new WeakRef(hote.retirer())
    await pause(30)
    assert.equal(texte('.l'), 'vide')
    assert.ok(await liberee(ref), 'la ligne retirée est libérée')
  })

  it('relu dans un même tour : l\'enveloppe déjà faite, sans la redemander ; d\'un tour à l\'autre, la même enveloppe', async () => {
    const proto = window.µ.Element.prototype
    const avant = proto._mjs_wrapDeep
    let appels = 0
    proto._mjs_wrapDeep = function(...a: any[]) { appels++; return avant.apply(this, a) }
    try {
      assert.equal(hote.lire(1000), 1000)
    }
    finally {
      proto._mjs_wrapDeep = avant
    }
    assert.ok(appels <= 2, `enveloppes demandées pendant 1 000 lectures : ${appels}`)
    const env = hote.lireR()
    await pause(10)
    assert.ok(hote.lireR() === env, 'même enveloppe au tour suivant')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })
})
