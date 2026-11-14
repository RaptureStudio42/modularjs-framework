// Dernier retrait d'une balise qui sort (`_mjs_destroyWithHooks`, mjs_destroy_hooks.ts) : une fois tout le groupe résolu, l'état de
// SORTIE de chaque balise du groupe est défait (`abort`), rien ne reste sur la balise retirée. Un état d'ENTRÉE, lui, n'est pas défait :
// un descendant `.global` encore en train d'entrer quand son ancêtre part garde le sien, que sa propre transition libère

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { assertAbsent } from './helpers/dom-assert.js'

const win: any = new Window({ url: 'http://localhost/' })
// fusion sur le `µ` global partagé par les fichiers de test du process (cf. transition-shared-mode-abort.test.ts)
;(globalThis as any).µ = (globalThis as any).µ || {}
const µ: any = (globalThis as any).µ
µ.debug   = µ.debug ?? false
µ.warn    = µ.warn || (() => {})
µ.log     = µ.log || (() => {})
µ.error   = µ.error || (() => {})
µ.Element = µ.Element || class {}
await import('../src/runtime/mjs_destroy_hooks.js')
// fichier déjà chargé par un autre test avant que `µ.Element` existe : il n'a rien posé, on le relit à neuf
if (typeof µ.Element.prototype._mjs_destroyWithHooks !== 'function') await import('../src/runtime/mjs_destroy_hooks.js?garde-sortie' as any)

describe('dernier retrait d\'une balise qui sort : seul l\'état de sortie est défait', function () {
  let avant: any
  beforeEach(() => { avant = µ._mjs_playTransition })
  afterEach(() => { µ._mjs_playTransition = avant })

  it('l\'état de sortie de la balise retirée est défait ; l\'état d\'entrée de son descendant `.global` est laissé', async () => {
    const appels: string[] = []
    const parent = win.document.createElement('div')
    const node: any   = win.document.createElement('section')
    const enfant: any = win.document.createElement('span')
    node.appendChild(enfant)
    parent.appendChild(node)
    node._mjs_outro              = {}
    enfant._mjs_global           = true
    enfant._mjs_transition_state = { direction: 'in', abort: () => appels.push('entrée défaite') }
    µ._mjs_playTransition = (el: any) => {
      el._mjs_transition_state = { direction: 'out', abort: () => appels.push('sortie défaite') }
      return Promise.resolve()
    }
    const hote = { _mjs_mjsPurgeSubtreeState() {} }
    await µ.Element.prototype._mjs_destroyWithHooks.call(hote, node, false)
    assert.deepEqual(appels, ['sortie défaite'])
    assertAbsent(node.parentNode, 'la balise sortie est retirée de son parent')
  })
})
