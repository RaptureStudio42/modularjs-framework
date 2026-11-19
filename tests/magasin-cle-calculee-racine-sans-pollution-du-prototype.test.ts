// `µ.store[k].valeur = v`, la forme que la page des magasins conseille pour une clé calculée : l'objet atteint passe le refus des
// écritures profondes. Avec `k` venu de données et valant `__proto__`, ni `=`, ni `++`, ni `+=`, ni `delete` ne touchent le modèle
// commun de tous les objets de la page (Object.prototype) ; une clé juste écrit la fiche du magasin. Vraie construction, mode strict

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'
import { COMPOSANT_MAGASIN, CLE_MAGASIN, scenario, ATTENDU } from './helpers/cle-calculee-racine.js'

describe('clé calculée à la racine du magasin (`µ.store[k].x`) : une clé `__proto__` venue de données n\'écrit rien dans Object.prototype', function () {
  this.timeout(120000)
  let page: any

  before(async () => {
    page = await monterStrict('cle-racine-magasin', { 'cle-magasin': COMPOSANT_MAGASIN })
  })

  after(async () => {
    await page?.window.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  it('`=`, `++`, `+=` et `delete` par la clé `__proto__` : Object.prototype intact ; par une clé juste, la fiche du magasin est écrite', async () => {
    assert.deepEqual(JSON.parse(page.window.eval(scenario('mjs-cle-magasin', CLE_MAGASIN))), ATTENDU)
  })
})
