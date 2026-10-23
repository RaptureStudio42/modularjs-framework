// Barre d'outils posée à part (<@@toolbar for>) de l'éditeur riche du cœur, jouée dans happy-dom :
// - `for` calculé par la page (`for={$id}`), qui n'arrive qu'après le réveil de la barre : la barre se branche sur l'éditeur désigné, jamais sur la page qui la porte ;
// - `for` changé ensuite : la barre quitte l'ancien éditeur (il ne la compte plus parmi ses barres) et pilote le nouveau ;
// - `tools` changé après une flèche, alors que le bouton qui avait la tabulation n'est plus dans la barre : un bouton, et un seul, reste atteignable par Tab.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monter } from './helpers/editeur-riche.js'

const HOTE = `<script>
  $cible  = 'ed2'
  $outils = 'bold link'

  µmount ->
    window.__cible  = (x)-> $cible = x
    window.__outils = (x)-> $outils = x
</script>
<@@editor id="ed1" class="ed1" toolbar="none" name="a" value="<p>un</p>"></@@editor>
<@@editor id="ed2" class="ed2" toolbar="none" name="b" value="<p>deux</p>"></@@editor>
<@@toolbar class="tb" for={$cible} tools={$outils}></@@toolbar>
`

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('éditeur riche : la barre posée à part suit un `for` calculé et garde un arrêt de tabulation (happy-dom)', function () {
  this.timeout(120000)
  let window: any
  let hote: any

  const el      = (c: string) => hote._shadow.querySelector('.' + c)
  const boutons = (): any[] => Array.from(el('tb')._shadow.querySelectorAll('button'))
  const bouton  = (t: string) => boutons().find((b) => b.dataset.tool === t)
  const barres  = (x: any): number => x._mjsBars?.size ?? 0

  // les commandes qu'un éditeur reçoit de la barre, relevées sans être jouées
  const espion = (c: string): string[] => {
    const vus: string[] = []
    el(c)._mjsExec = (n: string) => { vus.push(n) }
    return vus
  }

  before(async () => {
    ;({ window, hote } = await monter(HOTE, 'barre-for-calcule'))
    await attendre(() => boutons().length === 2, 10000)
    await pause(250)
  })

  after(async () => {
    await window?.happyDOM?.close()
    await terminateSharedWorkerPool()
  })

  it('for calculé : la barre pilote l\'éditeur désigné, pas la page qui la porte', async function () {
    assert.equal(barres(hote), 0, 'la page n\'est pas un éditeur : la barre ne s\'y inscrit pas')
    assert.equal(barres(el('ed2')), 1, 'la barre est inscrite auprès de l\'éditeur désigné')
    assert.equal(bouton('bold').getAttribute('aria-disabled'), 'false', 'branchée, la barre n\'est pas grisée')
    const vus = espion('ed2')
    bouton('bold').click()
    await pause(30)
    assert.deepEqual(vus, ['bold'], 'le clic arrive à l\'éditeur désigné')
  })

  it('for changé : la barre quitte l\'ancien éditeur et pilote le nouveau', async function () {
    const vus1 = espion('ed1')
    const vus2 = espion('ed2')
    window.__cible('ed1')
    await pause(120)
    bouton('bold').click()
    await pause(30)
    assert.deepEqual(vus1, ['bold'], 'le nouvel éditeur reçoit la commande')
    assert.deepEqual(vus2, [], 'l\'ancien ne reçoit plus rien')
    assert.equal(barres(el('ed1')), 1, 'la barre est inscrite auprès du nouvel éditeur')
    assert.equal(barres(el('ed2')), 0, 'l\'ancien ne la compte plus (le raccourci du lien ne suit plus cette barre)')
  })

  it('tools changé après une flèche : un seul bouton reste atteignable par Tab', async function () {
    bouton('bold').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }))
    await pause(30)
    assert.equal(bouton('link').getAttribute('tabindex'), '0', 'la flèche droite passe la tabulation à « link »')
    window.__outils('bold italic')
    await pause(60)
    const atteints = boutons().filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.dataset.tool)
    assert.deepEqual(atteints, ['bold'], '« link » n\'est plus là : la tabulation revient au premier bouton')
  })
})
