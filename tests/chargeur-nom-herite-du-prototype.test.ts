// Chargeur de composants : une balise dont le nom est hérité d'`Object.prototype` (`<mjs-constructor>`,
// `<mjs-__proto__>`, `<mjs-tostring>`…) — HTML du serveur, contenu inséré, composant tiers — est rejetée comme
// « absente du manifeste », comme toute balise inconnue. Défaut garanti absent : `µ.pathOf` lisait la table des
// fichiers sans tester la propriété propre, rendait le texte d'une fonction native, le chargeur tentait de
// l'importer, échouait, et RECHARGEAIT la page (garde « bundle périmé »).

import assert from 'node:assert/strict'
import { monterHote, pause } from './helpers/coeur-monter.js'

// valeur venue de la fenêtre happy-dom (autre contexte JS) : recopiée en objets ordinaires pour la comparaison
const brut = (x: any) => JSON.parse(JSON.stringify(x))

describe('chargeur — nom de balise hérité du prototype', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    ({ window } = await monterHote('<p>x</p>', 'chargeur-prototype'))
  })

  it('µ.pathOf rend « inconnu » (chaîne vide) pour un nom hérité, le chemin entier pour un nom du manifeste', () => {
    const r = window.eval(`(function() {
      var avant = µ.paths, prefixe = µ.pathsPrefix;
      µ.paths = { carte: 'carte.123.js' };
      µ.pathsPrefix = '/assets/';
      try {
        return [µ.pathOf('constructor'), µ.pathOf('__proto__'), µ.pathOf('toString'), µ.pathOf('hasOwnProperty'), µ.pathOf('inconnu'), µ.pathOf('carte')];
      } finally { µ.paths = avant; µ.pathsPrefix = prefixe; }
    })()`)
    assert.deepEqual(brut(r), ['', '', '', '', '', '/assets/carte.123.js'])
  })

  it('<mjs-constructor> est rejetée comme absente du manifeste, sans recharger la page', async () => {
    window.eval(`globalThis.__erreurs.length = 0; globalThis.__avant = µ.paths; µ.paths = { carte: 'carte.123.js' }; window.sessionStorage.removeItem('mjs-stale-reload'); µ.Autoloader.load('mjs-constructor'); µ.Autoloader.load('mjs-__proto__');`)
    await pause(200)
    const erreurs: string[] = window.eval('globalThis.__erreurs')
    window.eval('µ.paths = globalThis.__avant')
    assert.equal(erreurs.filter((e) => /absent du manifeste/.test(e)).length, 2, erreurs.join('\n'))
    assert.equal(erreurs.filter((e) => /Failed to import/.test(e)).length, 0, erreurs.join('\n'))
    assert.equal(window.sessionStorage.getItem('mjs-stale-reload'), null, 'aucun rechargement demandé')
  })
})
