// une valeur qui attend typée par le <vars> (`$r int 0..100`) : une réponse que sa règle refuse (un texte) est un échec de la demande —
// la valeur d'avant reste, µpending($r) repasse à faux, µfailed($r) donne l'erreur ; en développement la console dit le refus du type,
// comme pour toute écriture refusée. Une réponse hors de la plage (300) est ramenée dans la plage, comme toute écriture. Méthode : le vrai Bundler (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, repondre, texte, pause } from './helpers/derivee-await-banc.js'

const TYPEE = (b: string) => `<vars>
  $r int 0..100
</vars>
<script>
  $q = 0
  f  = (q) -> fetch("/api/${b}-#{q}").then((r) -> r.json())
  $r = await f($q)
  @chercher = (q) -> $q = q
</script>
<b class="v">{$r}</b><i class="att">{µpending($r)}</i><u class="err">{µfailed($r)?.message}</u>
`
const vu = (el: any) => texte(el, '.v') + '|' + texte(el, '.att') + '|' + (texte(el, '.err') ? 'erreur' : '')

describe('dérivée qui attend — une réponse refusée par son type est un échec de la demande', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un texte pour int 0..100 : la valeur d\'avant reste, µpending repasse à faux, µfailed donne l\'erreur, la console dit le refus', async () => {
    const w  = await monter('await-type-refus', { 'typee.mjs': TYPEE('t') }, '<mjs-typee></mjs-typee>')
    const el = w.document.querySelector('mjs-typee')
    // le mode des types du développement, que le manifeste pose dans une vraie page
    w.µ._typesMode = 'warn'
    await repondre(w, '/api/t-0', 50)
    assert.equal(vu(el), '50|false|')
    el.chercher(1)
    await pause(60)
    assert.equal(vu(el), '50|true|')
    await repondre(w, '/api/t-1', 'abc')
    assert.equal(vu(el), '50|false|erreur', 'la valeur d\'avant reste, l\'attente finie, l\'erreur lue')
    assert.match(texte(el, '.err'), /\$r/, texte(el, '.err'))
    assert.ok(w.__avis.some((a: string) => /\$r refuse/.test(a)), 'le message du refus de type — ' + w.__avis.join(' | '))
    el.chercher(2)
    await pause(60)
    await repondre(w, '/api/t-2', 70)
    assert.equal(vu(el), '70|false|', 'la réponse juste suivante s\'écrit et efface l\'erreur')
    el.chercher(3)
    await pause(60)
    await repondre(w, '/api/t-3', 300)
    assert.equal(vu(el), '100|false|', '300 est ramené dans la plage, comme toute écriture')
    w.close()
  })

  it('la première réponse refusée : rien n\'est écrit, l\'attente finit, l\'erreur se lit', async () => {
    const w  = await monter('await-type-refus-1', { 'typee.mjs': TYPEE('u') }, '<mjs-typee></mjs-typee>')
    const el = w.document.querySelector('mjs-typee')
    assert.equal(texte(el, '.att'), 'true')
    await repondre(w, '/api/u-0', 'abc')
    assert.equal(texte(el, '.att'), 'false')
    assert.equal(el._state.r, undefined)
    assert.ok(texte(el, '.err'), 'µfailed($r) donne l\'erreur')
    w.close()
  })
})
