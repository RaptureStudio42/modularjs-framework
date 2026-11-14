// mjs_types_ajax — la réponse d'un appel `µajax '/app/rewards', type: Reward[]` : le compilateur écrit `type: µ._mjs_tajax({…}, 'mjs-x')`,
// la règle nommée résolue (transpiler/var-types.ts, compileAjaxTypes) et le composant qui appelle, puis mjs_ajax.ts appelle la fonction
// rendue à l'arrivée de la réponse. Lit le contrôle des types (mjs_types.ts : _mjsTChk, _mjsTMsg, la µTypeError et le
// gestionnaire de l'appli, gardés pour lui), qu'il entraîne. Fichier détecté (clé 'types_ajax') sur `µ._mjs_tajax(` : une appli qui
// n'écrit `type:` dans aucun appel µajax n'en paie pas un octet

// contrôlée UNE fois — conversions, bornes et valeurs de départ écrites sur place —, puis plus rien, aucun registre. Refusée : `typeError`
// de l'appel rend la réponse à sa place ; sans lui, le gestionnaire de l'appli (`µtypes.onError`) décide : 'warn' l'écrit en
// avertissement et la promesse rend undefined, sinon une µTypeError la rejette (une réponse n'a pas de valeur d'avant à garder). Le
// gestionnaire passe avant tout, le signal au serveur (production, `typesReport`) ensuite. Le chemin est celui de la valeur DANS la
// réponse (`[4].id`, vide pour la réponse entière) ; le signal y joint l'adresse de la requête, coupée avant `?` et `#`. Une erreur du
// serveur (pas de réponse, code 4xx / 5xx, délai dépassé) ne passe jamais ici : `error:` de l'appel la reçoit (mjs_ajax.ts)
µ._mjs_tajax = function(r, c) {
  return function(v, o) {
    var note = {};
    var x    = _mjsTChk(r, v, null, note, '');
    var n, rendu;
    if (x[0] < 0) {
      n     = note.refus;
      n     = new µ.TypeError(n.p, n.d, n.v, c);
      // un gestionnaire qui lève n'empêche pas le signal : il part, puis l'erreur remonte
      try {
        rendu = o.typeError ? o.typeError(n) : µ._mjs_tonErr && µ._mjs_tonErr(n);
      }
      finally {
        // <types-signal>
        _mjsTSignal(n, o.url);
        // </types-signal>
      }
      if (o.typeError) return rendu;
      if (rendu !== 'warn') throw n;
      µ.warn(n.message);
      return void 0;
    }
    if (x[0] === 2) _mjsTMsg(null, 1, note.borne);
    return r.t === 'a' || r.t === 'o' || r.t === 'u' ? _mjsTChk(r, v, new WeakMap(), null, '')[1] : x[1];
  };
};
