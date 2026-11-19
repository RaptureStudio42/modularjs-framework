// le composant d'une valeur qui attend quitte la page : sa demande en vol est coupée (µsignal) et n'écrit plus, même sans signal ; une
// variable citée qui change ensuite ne relance rien. Déplacé (retiré puis remis dans la page, ou ligne d'un {for} réordonnée), la demande
// coupée repart et sa réponse s'écrit. Méthode : le vrai Bundler (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, repondre, demandes, texte, pause } from './helpers/derivee-await-banc.js'

const FICHE = (b: string, sig: boolean) => `<script>
  $id     = 0
  charger = (id, signal) -> fetch("/api/${b}-#{id}"${sig ? ', { signal }' : ''}).then((r) -> r.json())
  $fiche  = await charger($id${sig ? ', µsignal' : ''})
  @voir   = (id) -> $id = id
</script>
<i class="f">{$fiche and $fiche.nom}</i><b class="att">{µpending($fiche)}</b>
`
const LISTE = `<script>
  $items    = [{ id: 1 }, { id: 2 }]
  @inverser = -> $items = [...$items].reverse()
</script>
{for it in $items by id}<@c-fiche id={it.id}></@c-fiche>{end}
`

describe('dérivée qui attend — composant retiré, composant déplacé', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('retiré : la demande en vol est coupée, n\'écrit pas ; une variable citée changée ensuite ne relance rien', async () => {
    const w  = await monter('await-retire', { 'c-fiche.mjs': FICHE('r', true) }, '<mjs-c-fiche></mjs-c-fiche>')
    const el = w.document.querySelector('mjs-c-fiche')
    assert.deepEqual(demandes(w), ['/api/r-0'])
    el.remove()
    await pause(30)
    assert.equal(w.__req[0].aborted, true, 'la demande en vol est coupée')
    el.voir(5)
    await pause(60)
    assert.deepEqual(demandes(w), ['/api/r-0'], 'aucune demande après le retrait')
    assert.equal(el._state.fiche, undefined)
    w.close()
  })

  it('retiré : sans µsignal, la réponse arrivée après le retrait n\'est pas écrite', async () => {
    const w  = await monter('await-retire-sans-signal', { 'c-fiche.mjs': FICHE('s', false) }, '<mjs-c-fiche></mjs-c-fiche>')
    const el = w.document.querySelector('mjs-c-fiche')
    el.remove()
    await pause(30)
    await repondre(w, '/api/s-0', { nom: 'Ann' })
    assert.equal(el._state.fiche, undefined, 'rien n\'est écrit')
    w.close()
  })

  it('déplacé dans la page : la demande coupée repart, sa réponse s\'écrit', async () => {
    const w  = await monter('await-deplace', { 'c-fiche.mjs': FICHE('d', true) }, '<div id="a"><mjs-c-fiche></mjs-c-fiche></div><div id="b"></div>')
    const el = w.document.querySelector('mjs-c-fiche')
    assert.deepEqual(demandes(w), ['/api/d-0'])
    w.document.getElementById('b').appendChild(el)
    await pause(60)
    assert.equal(w.__req[0].aborted, true, 'la demande d\'avant le déplacement est coupée')
    assert.deepEqual(demandes(w), ['/api/d-0', '/api/d-0'], 'la demande repart une fois')
    await repondre(w, '/api/d-0', { nom: 'Ann' })
    assert.equal(texte(el, '.f') + '|' + texte(el, '.att'), 'Ann|false')
    w.close()
  })

  it('ligne d\'un {for} réordonnée pendant l\'attente : chaque fiche finit par montrer sa réponse', async () => {
    const w  = await monter('await-deplace-for', { 'c-fiche.mjs': FICHE('k', true), 'liste.mjs': LISTE }, '<mjs-liste></mjs-liste>')
    const el = w.document.querySelector('mjs-liste')
    assert.deepEqual(demandes(w).sort(), ['/api/k-1', '/api/k-2'])
    el.inverser()
    await pause(80)
    for (const r of w.__req.filter((x: any) => !x.fini && !x.aborted)) r.reply({ nom: 'n' + r.url.slice(-1) })
    await pause(80)
    const fiches = Array.from(el._shadow.querySelectorAll('mjs-c-fiche')).map((f: any) => texte(f, '.f') + '/' + texte(f, '.att'))
    assert.deepEqual(fiches, ['n2/false', 'n1/false'], 'demandes vues : ' + demandes(w).join(', '))
    w.close()
  })
})
