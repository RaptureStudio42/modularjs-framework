// Une donnée reçue (réseau, dictionnaire aux clés choisies par un utilisateur…) qui porte la clé `_mjs_c` — le
// marqueur qu'emploie MJS pour reconnaître une valeur dérivée compilée (`{ _mjs_c: true, f: () => … }`) — n'est pas
// prise pour un dérivé. Défaut garanti absent : rangée à la racine d'un `µ.state` ou d'un `$$x`, elle faisait planter
// chaque lecture (`TypeError … reading 'call'`, composant en erreur pour tous ceux qui l'affichent), et une variable
// typée qui la recevait échappait à sa règle du `<vars>`. Un vrai dérivé porte une fonction `f` : une donnée JSON jamais.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterHote } from './helpers/coeur-monter.js'
import { makeMu, composant } from './helpers/types-runtime.js'

// valeur venue de la fenêtre happy-dom (autre contexte JS) : recopiée en objets ordinaires pour la comparaison
const brut = (x: any) => JSON.parse(JSON.stringify(x))

const ICI = dirname(fileURLToPath(import.meta.url))
const RT  = join(ICI, '../src/runtime/')

describe('donnée qui porte la clé `_mjs_c`', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    ({ window } = await monterHote('<p class="p">{$$profil}</p>', 'marqueur-derive'))
    if (!window.eval('typeof µ.state === "function"')) window.eval(readFileSync(RT + 'mjs_state.ts', 'utf-8'))
  })

  it('µ.state et $$x la rendent intacte, sans erreur ; un vrai dérivé reste calculé', () => {
    const r = window.eval(`(function() {
      var r = {};
      var data = function() { return JSON.parse('{"_mjs_c":1,"nom":"x","f":{"call":1}}'); };
      try { var s = µ.state({ profil: data(), fiche: { sous: data() } }); r.state = s.profil.nom + '/' + s.fiche.sous.nom; } catch (e) { r.state = String(e); }
      try { µ._storeSet('profil', data()); r.store = µ.store.profil.nom; } catch (e) { r.store = String(e); }
      var d = µ.state({ a: 2, double: { _mjs_c: true, f: function() { return this.a * 2; } } });
      r.derive = d.double;
      µ._storeSet('derive', { _mjs_c: true, f: function() { return 21 * 2; } });
      r.deriveStore = µ.store.derive;
      return r;
    })()`)
    assert.deepEqual(brut(r), { state: 'x/x', store: 'x', derive: 4, deriveStore: 42 })
  })

  it('une variable typée qui la reçoit passe sa règle du <vars> (refusée ici)', () => {
    const µ  = makeMu()
    const el = composant({ volume: 'int 0..100' })
    const recu = JSON.parse('{"_mjs_c":true,"f":1}')
    assert.equal(µ._mjs_tset(el, 'volume', recu), µ._mjs_TNO, 'un objet n’est pas un entier : refusé')
    const derive = { _mjs_c: true, f: () => 5 }
    assert.equal(µ._mjs_tset(el, 'volume', derive), derive, 'un vrai dérivé passe : sa valeur arrive plus tard')
  })
})
