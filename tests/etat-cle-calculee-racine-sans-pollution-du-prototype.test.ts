// `$[c.nom].valeur = v` : une clé faite d'une expression, à la racine de l'état, passe le refus des écritures profondes comme à tout
// autre rang du chemin. Avec `c.nom` venu de données et valant `__proto__`, ni `=`, ni `++`, ni `+=`, ni `delete` ne touchent le
// modèle commun de tous les objets de la page (Object.prototype) ; une clé juste écrit et redessine. Vraie construction, mode strict

import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'
import { attendreEgal } from './helpers/attendre.js'
import { COMPOSANT_ETAT, CLE_ETAT, scenario, ecran, ATTENDU } from './helpers/cle-calculee-racine.js'

describe('clé calculée à la racine de l\'état (`$[c.nom].x`) : une clé `__proto__` venue de données n\'écrit rien dans Object.prototype', function () {
  this.timeout(120000)
  let page: any

  before(async () => {
    page = await monterStrict('cle-racine-etat', { 'cle-etat': COMPOSANT_ETAT })
  })

  after(async () => {
    await page?.window.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  it('`=`, `++`, `+=` et `delete` par la clé `__proto__` : Object.prototype intact ; par une clé juste, la fiche est écrite et redessinée', async () => {
    const vu = JSON.parse(page.window.eval(scenario('mjs-cle-etat', CLE_ETAT)))
    await attendreEgal(() => ({ ...vu, ecran: page.window.eval(ecran('mjs-cle-etat')) }), { ...ATTENDU, ecran: 'ok-3' }, 'formes par `__proto__`, puis écran', 2000)
  })
})
