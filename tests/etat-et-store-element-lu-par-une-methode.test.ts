// Un élément d'une liste rangée dans un `µ.state` ou un `µ.Store`, obtenu par une méthode de lecture (`find`,
// `filter`, `forEach`, `for…of`, `at`, `map`) puis modifié, prévient les lecteurs exactement comme une écriture
// par indice (`st.list[0].done = …`). Défaut garanti absent : ces méthodes travaillaient sur la liste brute et
// rendaient l'élément brut — la donnée changeait, l'écran restait figé, sans un mot. L'élément rendu est la même
// enveloppe que celle de la lecture par indice, et une recherche par élément (`indexOf`) le retrouve.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterHote } from './helpers/coeur-monter.js'

// valeur venue de la fenêtre happy-dom (autre contexte JS) : recopiée en objets ordinaires pour la comparaison
const brut = (x: any) => JSON.parse(JSON.stringify(x))

const ICI = dirname(fileURLToPath(import.meta.url))
const RT  = join(ICI, '../src/runtime/')

// chaque écriture compte ses notifications : celle par indice sert d'étalon
const SCENARIO = `
  var r = {};
  var compte = function(nom, fn) { var a = n; fn(); r[nom] = n - a; };
  compte('indice', function() { L().list[0].done = 'i'; });
  compte('find', function() { L().list.find(function(x) { return x.id === 1; }).done = 'f'; });
  compte('filter', function() { L().list.filter(function(x) { return x.id === 2; })[0].done = 'fi'; });
  compte('forEach', function() { L().list.forEach(function(x) { x.done = 'fe'; }); });
  compte('forOf', function() { for (var x of L().list) x.done = 'fo'; });
  compte('at', function() { L().list.at(-1).done = 'at'; });
  compte('map', function() { L().list.map(function(x) { x.done = 'm'; return x; }); });
  r.meme = L().list.find(function(x) { return x.id === 1; }) === L().list[0];
  r.rang = L().list.indexOf(L().list[1]);
  r.valeur = L().list.map(function(x) { return x.done; }).join(',');
`

const ATTENDU = { indice: 1, find: 1, filter: 1, forEach: 2, forOf: 2, at: 1, map: 2, meme: true, rang: 1, valeur: 'm,m' }

describe('µ.state / µ.Store — élément d’une liste lu par une méthode, puis modifié', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    ({ window } = await monterHote('<p>x</p>', 'etat-element-methode'))
    if (!window.eval('typeof µ.state === "function"')) window.eval(readFileSync(RT + 'mjs_state.ts', 'utf-8'))
    if (!window.eval('typeof µ.Store === "function"')) window.eval(readFileSync(RT + 'mjs_store.ts', 'utf-8'))
  })

  it('µ.state : find, filter, forEach, for…of, at, map notifient comme une écriture par indice', () => {
    const r = window.eval(`(function() {
      var n = 0, orig = µ._mjs_notifyUniversalChange;
      µ._mjs_notifyUniversalChange = function(t, k) { if (k !== µ._mjs_STRUCT) n++; return orig.apply(this, arguments); };
      var s = µ.state({ list: [{ id: 1, done: 0 }, { id: 2, done: 0 }] });
      var L = function() { return s; };
      try { ${SCENARIO} } finally { µ._mjs_notifyUniversalChange = orig; }
      return r;
    })()`)
    assert.deepEqual(brut(r), ATTENDU)
  })

  it('µ.Store : find, filter, forEach, for…of, at, map notifient comme une écriture par indice', () => {
    const r = window.eval(`(function() {
      var S = new µ.Store({ list: [{ id: 1, done: 0 }, { id: 2, done: 0 }] });
      var n = 0, o = S._mjs_notify.bind(S);
      S._mjs_notify = function(k) { n++; return o(k); };
      var L = function() { return S.data; };
      ${SCENARIO}
      return r;
    })()`)
    assert.deepEqual(brut(r), ATTENDU)
  })

  it('les méthodes qui modifient la liste notifient toujours une fois, et une liste typée garde ses méthodes natives', () => {
    const r = window.eval(`(function() {
      var n = 0, orig = µ._mjs_notifyUniversalChange;
      µ._mjs_notifyUniversalChange = function(t, k) { if (k !== µ._mjs_STRUCT) n++; return orig.apply(this, arguments); };
      var s = µ.state({ list: [{ id: 1 }], octets: new Uint8Array([3, 1, 2]) });
      try {
        s.list.push({ id: 2 });
        var apresPush = n;
        var somme = s.octets.reduce(function(a, b) { return a + b; }, 0);
        return { apresPush: apresPush, longueur: s.list.length, somme: somme, tri: Array.from(s.octets.slice().sort()).join('') };
      } finally { µ._mjs_notifyUniversalChange = orig; }
    })()`)
    assert.deepEqual(brut(r), { apresPush: 1, longueur: 2, somme: 6, tri: '123' })
  })
})
