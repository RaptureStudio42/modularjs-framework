// Un objet rangé dans une `Map` ou un `Set` d'un `µ.state` ou d'un `µ.Store`, obtenu par `forEach`, `for…of`,
// `values()` ou `entries()` puis modifié, prévient les lecteurs comme s'il avait été lu par `get` — toutes les
// voies de lecture, comme pour une Map / un Set rangé dans une variable de composant. Défaut garanti absent :
// ces voies rendaient l'objet brut, la donnée changeait, l'écran restait figé, sans un mot. Les clés d'une Map
// restent brutes ; un élément de Set tenu par son enveloppe se retrouve (`has`) et se retire (`delete`).

import assert from 'node:assert/strict'
import { monterHote } from './helpers/coeur-monter.js'

// valeur venue de la fenêtre happy-dom (autre contexte JS) : recopiée en objets ordinaires pour la comparaison
const brut = (x: any) => JSON.parse(JSON.stringify(x))

// l'hôte écrit µ.state et µ.Store : sans clé `runtime`, le cœur ne porte que ce que le code compilé emploie, et c'est ainsi
// qu'il reçoit les deux avec le registre des dépendances (mjs_runes.ts) qu'ils appellent — un fichier du runtime évalué à
// part n'emmène pas ce registre
const HOTE = ['<script>', '@etat = µ.state({})', '@magasin = new µ.Store({})', '</script>', '<p>x</p>'].join('\n')

// chaque écriture compte ses notifications : celle faite après `get` sert d'étalon
const SCENARIO = `
  var r = {};
  var compte = function(nom, fn) { var a = n; fn(); r[nom] = n - a; };
  compte('mapGet', function() { L().m.get(1).done = 'g'; });
  compte('mapForEach', function() { L().m.forEach(function(v) { v.done = 'fe'; }); });
  compte('mapForOf', function() { for (var kv of L().m) kv[1].done = 'fo'; });
  compte('mapValues', function() { L().m.values().next().value.done = 'v'; });
  compte('mapEntries', function() { L().m.entries().next().value[1].done = 'e'; });
  compte('setForEach', function() { L().e.forEach(function(v) { v.done = 'sfe'; }); });
  compte('setForOf', function() { for (var v of L().e) v.done = 'sfo'; });
  compte('setValues', function() { L().e.values().next().value.done = 'sv'; });
  r.cle = typeof L().m.keys().next().value;
  var el = L().e.values().next().value;
  r.setHas = L().e.has(el);
  L().e.forEach(function(v) { L().e.delete(v); });
  r.setTailleApresRetrait = L().e.size;
`

const ATTENDU = { mapGet: 1, mapForEach: 1, mapForOf: 1, mapValues: 1, mapEntries: 1, setForEach: 1, setForOf: 1, setValues: 1, cle: 'number', setHas: true, setTailleApresRetrait: 0 }

describe('µ.state / µ.Store — objet d’une Map ou d’un Set lu par itération, puis modifié', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    ({ window } = await monterHote(HOTE, 'etat-map-set-iteration'))
    assert.ok(window.eval('typeof µ.state === "function" && typeof µ.Store === "function"'), 'le cœur d\'un hôte qui écrit µ.state et µ.Store les porte')
  })

  it('µ.state : forEach, for…of, values, entries notifient comme get', () => {
    const r = window.eval(`(function() {
      var n = 0, orig = µ._mjs_notifyUniversalChange;
      µ._mjs_notifyUniversalChange = function(t, k) { if (k !== µ._mjs_STRUCT) n++; return orig.apply(this, arguments); };
      var s = µ.state({ m: new Map([[1, { done: 0 }]]), e: new Set([{ done: 0 }]) });
      var L = function() { return s; };
      try { ${SCENARIO} } finally { µ._mjs_notifyUniversalChange = orig; }
      return r;
    })()`)
    assert.deepEqual(brut(r), ATTENDU)
  })

  it('µ.Store : forEach, for…of, values, entries notifient comme get', () => {
    const r = window.eval(`(function() {
      var S = new µ.Store({ m: new Map([[1, { done: 0 }]]), e: new Set([{ done: 0 }]) });
      var n = 0, o = S._mjs_notify.bind(S);
      S._mjs_notify = function(k) { n++; return o(k); };
      var L = function() { return S.data; };
      ${SCENARIO}
      return r;
    })()`)
    assert.deepEqual(brut(r), ATTENDU)
  })
})
