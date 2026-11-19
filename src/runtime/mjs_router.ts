// mjs_router.ts
µ.Router = {
  // Cache de vues PAR INSTANCE (WeakMap composant → Map clé → élément) :
  // l'ancienne Map globale keyée par TAG faisait que deux instances
  // simultanées du même composant se VOLAIENT l'élément caché (appendChild
  // = déplacement), et retenait les éléments à vie. La WeakMap libère le
  // cache à la mort du composant hôte.
  cache: new WeakMap(),
  _mjs_awareComponents: new Set(),
  // pages écrites par le serveur, sorties de la page avec leur vue quand un `{if}` rebâtit sa branche à la reprise : clé
  // `<view-tag>-<module>`, reprises par la vue neuve (_mjs_viewOut, _mjs_injectView)
  _mjs_ssrPages: new Map(),
  // Compteur de génération anti-ré-entrance de `navigate()` (cf. son propre
  // commentaire) — bumpé à CHAQUE appel, pas seulement les racines.
  _mjs_navGen: 0,
  // la dernière navigation partie quand l'entrée courante de l'historique était la sienne (cf. `navigate`, `own`) ; 0 :
  // l'ouverture de la page
  _mjs_ownGen: 0,
  // posé par mjs_ujs.ts juste avant une navigation que le navigateur a déjà faite (Précédent, Suivant, adresse changée, page
  // reçue) : l'entrée courante de l'historique est celle de la destination ; repris par `navigate`
  _mjs_follow: 0,
  // la navigation dont une garde `µurlChange` joue en ce moment (cf. `_mjs_runGuard`), -1 hors de toute garde, ou quand l'entrée
  // courante de l'historique n'est pas celle de la page gardée
  _mjs_guardGen: -1,
  // PERF — mémo du tri des motifs de
  // route PAR OBJET `routeMap` (les motifs sont STATIQUES après compilation).
  // WeakMap : un `comp.routes` remplacé (nouvel objet) régénère naturellement
  // l'entrée ; aucune rétention au-delà de la vie du composant.
  _mjs_routeSortCache: new WeakMap(),
  // PERF — segments découpés, gardés : ceux d'un motif (même découpage à chaque essai, sur toutes les passes de
  // chaque navigation), et ceux de la dernière adresse essayée (une navigation l'essaie contre toutes les routes)
  _mjs_routeSegs: new Map(),
  _mjs_pathSegsKey: null,
  _mjs_pathSegs: null,
  // sous `µ._csp` : feuille constructible unique (le CSS du panneau est statique, pas besoin d'un
  // <style> par appel), adoptée par chaque racine où le panneau se pose — l'ombre du routeur, ou `document`.
  _mjs_routeErrorSheet: null,
  register: function(comp) {
    µ._mjs_logger()?.('🚦 [Router] ' + µ._mjs_txt('routerLogRegister', { tag: comp.tagName.toLowerCase() }, 'Enregistrement de : <{tag}>'));
    // Parité <routes>/@routes — `validateRoutePath` (transpiler/sections.ts)
    // refuse un `*` catch-all qui n'est pas en dernière position, mais SEULEMENT pour le bloc
    // <routes> : la table `@routes` calculée en script n'est jamais validée, et `_matchSegs`
    // absorbe tout le reste du chemin dès le `*` quelle que soit sa position — les segments
    // après lui ne sont plus jamais lus, en silence. Vérifié ICI, au runtime, à l'enregistrement
    // (la table est déjà résolue) — même voie que le nom de variant de style inconnu
    // (mjs_element.ts::_mjs_applyLayout) : `_mjs_catchError` remonte à la boundary `<@failed>` la plus
    // proche ou affiche le panneau fatal ; `mjs-light` (pas de shadow) : log seul.
    var wildcardErr = this._mjs_findMidRouteWildcard(comp);
    if (wildcardErr) {
      if (comp._mjs_isLight || typeof comp._mjs_catchError !== 'function') { µ.error(wildcardErr.message); }
      else if (!comp._mjs_has_crashed) { comp._mjs_catchError(wildcardErr); }
      return;
    }
    this._mjs_awareComponents.add(comp);
    return this.initComponent(comp);
  },
  unregister: function(comp) {
    return this._mjs_awareComponents.delete(comp);
  },
  // cherche un `*` catch-all qui N'EST PAS le dernier segment dans les routes du composant
  // retourne une Error prête à afficher, ou `null` si tout va bien.
  _mjs_findMidRouteWildcard: function(comp) {
    var targetId, routeMap, path, segs, i;
    if (!comp.routes) { return null; }
    for (targetId in comp.routes) {
      routeMap = comp.routes[targetId];
      for (path in routeMap) {
        segs = path.split('/').filter(Boolean);
        for (i = 0; i < segs.length; i++) {
          if (segs[i] === '*' && i !== segs.length - 1) {
            return new Error('[Router] ' + µ._mjs_txt('routerCatchAllLast', { tag: comp.tagName.toLowerCase(), path: path, seg: segs[i + 1] }, '<{tag}> : route \'{path}\' invalide — le \'*\' catch-all doit être en DERNIÈRE position (segment \'{seg}\' et la suite ne seraient jamais atteints).'));
          }
        }
      }
    }
    return null;
  },
  initComponent: function(comp) {
    var matchPath, gen;
    // Nettoie un éventuel slash final de l'URL de départ (`#/about/` tapé à la
    // main ou lien codé en dur) dès le premier composant routé qui monte.
    this._mjs_canonicalizeUrl();
    // On se base sur l'URL complète du navigateur pour extraire le hash
    matchPath = this._mjs_getMatchPath(window.location.href);
    µ._mjs_logger()?.('🚦 [Router] ' + µ._mjs_txt('routerLogInit', { tag: comp.tagName.toLowerCase(), matchPath: matchPath }, 'Init <{tag}> avec le Hash Path : \'{matchPath}\''));
    // garde de RÉ-ENTRANCE au
    // MONTAGE, jumelle de celle de `navigate()` : si le `@urlChange` de CE
    // composant redirige (`to('/login')`, garde d'auth canonique), le `navigate`
    // imbriqué traite DÉJÀ tous les `_mjs_awareComponents` (dont celui-ci, inscrit
    // par `register` juste avant cet appel) avec le VRAI chemin final. Sans
    // garde, `initComponent` reprend ensuite avec son `matchPath` PÉRIMÉ :
    // `_mjs_updateUrlStore` ferait retomber `µ.url.path` sur l'ancienne route et
    // `_injectViews` ré-injecterait la vue interdite PAR-DESSUS celle posée par
    // le redirect (la page que la garde voulait précisément interdire).
    gen = this._mjs_navGen;
    if (typeof comp._mjs_hooks?.urlChange === "function") {
      this._mjs_runGuard(comp, matchPath, gen);
    }
    if (gen !== this._mjs_navGen) { return; }
    // Un composant routé vient de monter : rafraîchit `µ.url` (ses params de
    // route deviennent disponibles maintenant que ses @routes sont enregistrées).
    this._mjs_updateUrlStore(matchPath);
    // Contrôle « aucune route » DIFFÉRÉ (cf. `_mjs_scheduleNoMatchCheck`) : les
    // composants routés montent l'un après l'autre au démarrage, l'état n'est
    // complet qu'à la frame suivante.
    this._mjs_scheduleNoMatchCheck(matchPath);
    return this._mjs_injectViewsForComponent(comp, matchPath);
  },
  // joue le `µurlChange` d'un composant, garde de la navigation `gen` (au montage : celle du moment) : pendant son appel, une
  // adresse ajoutée sans `replace` écrit est une redirection de garde (cf. `navigate`), si cette navigation est partie quand
  // l'entrée courante de l'historique était la sienne (`_mjs_ownGen`) ; sinon (`µRouter.to(route, false)`, `{ push: false }`), elle
  // ajoute la sienne. Une navigation lancée depuis la garde a sa propre génération : ce qu'y écrit le montage d'une page n'est pas
  // une redirection de garde. La valeur d'avant revient ensuite, même si la garde lève
  _mjs_runGuard: function(comp, matchPath, gen) {
    var before         = this._mjs_guardGen;
    this._mjs_guardGen = this._mjs_ownGen === gen ? gen : -1;
    try { comp._mjs_hooks.urlChange.call(comp, matchPath, this._mjs_extractParams(comp, matchPath)); }
    finally { this._mjs_guardGen = before; }
  },
  // Sucre de navigation programmatique : `µ.Router.to '/success'`.
  // Le routeur MJS travaille TOUJOURS sur la partie hash de l'URL → l'API
  // publique ne demande QUE la route (`/success`), jamais le `#` (qui est
  // implicite puisqu'on parle du routeur MJS). On le préfixe ici avant de
  // déléguer à `navigate` (qui reste l'implémentation bas-niveau, aussi
  // appelée par mjs_ujs avec des URLs complètes lors des back/forward).
  to: function(route, pushHistory = true) {
    var dest, replace;
    // `to(route, {replace: true})` remplace l'entrée courante au lieu d'en ajouter une, `{replace: false}` l'ajoute toujours ;
    // `replace` non écrit : `navigate` décide (ajoutée, ou remplacée par une garde `µurlChange` qui renvoie ailleurs).
    // `to(route, false)`, `{push: false}` : ni ajout ni remplacement, l'entrée courante n'est pas celle de la route (cf. `navigate`)
    if (pushHistory && typeof pushHistory === 'object') {
      replace     = pushHistory.replace;
      pushHistory = pushHistory.push !== false;
    }
    if (typeof route !== 'string' || route.length === 0) {
      dest = '#/';
    } else if (route.charAt(0) === '#') {
      dest = route;                 // déjà un hash complet
    } else if (route.charAt(0) === '/') {
      dest = '#' + route;           // '/success' -> '#/success'
    } else {
      dest = '#/' + route;          // 'success'  -> '#/success'
    }
    return this.navigate(dest, pushHistory, replace);
  },
  // Reflète l'URL courante dans l'objet réactif dédié `µ.url` (namespace
  // FRAMEWORK, PAS le store applicatif `$$`/µ.store — on ne pollue pas l'espace
  // de noms du dev). Lisible partout sans import : `µ.url.path`, `µ.url.params.id`,
  // `µ.url.query.tri`, `µ.url.hash`, `µ.url.href`. `µ.url` est un `µ.state` à part
  // entière → lire un champ pendant le rendu enregistre le composant comme
  // dépendant (universal deps), et l'écriture par champ ici le re-rend. Appelé
  // par `navigate`, `initComponent` et au boot.
  _mjs_updateUrlStore: function(matchPath) {
    var comp, hashRaw, loc, params, path, qi, qs, query, ref, usp;
    if (typeof window === 'undefined' || typeof µ.state !== 'function') { return; }
    if (!µ.url) { µ.url = µ.state({}); }
    loc = window.location;
    path = matchPath != null ? matchPath : this._mjs_getMatchPath(loc.href);
    // Query : `_mjs_getMatchPath` a déjà strippé le `?…` du path → on la relit sur le
    // hash BRUT (`#/x?a=1` → `a=1`), avec repli sur `loc.search` (`/?a=1#/x`).
    query = {};
    hashRaw = loc.hash || '';
    qi = hashRaw.indexOf('?');
    qs = qi !== -1 ? hashRaw.slice(qi + 1) : loc.search.slice(1);
    try {
      if (qs) {
        usp = new URLSearchParams(qs);
        usp.forEach(function(v, k) { query[k] = v; });
      }
    } catch {}
    // Params de route : union de toutes les vues routées qui matchent l'URL.
    params = {};
    try {
      ref = this._mjs_awareComponents;
      for (comp of ref) {
        this._mjs_mergeParams(params, this._mjs_extractParams(comp, path));
      }
    } catch {}
    // `µ.url.path` exposait le
    // chemin ENCODÉ (`/caf%C3%A9`) alors que le matching interne décode déjà
    // (`:param` et littéraux) : un `µ.url.path === '/café'` applicatif échouait
    // en silence. Décodage SEGMENT PAR SEGMENT (le `path` ENCODÉ, lui, reste
    // celui passé à `_mjs_extractParams` plus haut → pas de double-décodage dans le
    // matching). Tolérant : un `%` mal formé ressort brut.
    var pathDecoded = path;
    try {
      pathDecoded = path.split('/').map(this._mjs_dec).join('/');
    } catch {}
    // Écriture PAR CHAMP : chaque clé notifie ses propres lecteurs. `href`/`path`/
    // `hash` (chaînes) sont court-circuités par `µ.state` si identiques.
    µ.url.href = loc.href;
    µ.url.path = pathDecoded;
    // PERF — `params`/`query` sont des
    // objets NEUFS à chaque nav : réassigner notifiait TOUS leurs lecteurs
    // (`&id`, layouts) à CHAQUE navigation, même quand rien n'avait changé (hash
    // pure d'une autre zone, rafales de montage au boot). Comparaison
    // superficielle avant écriture : mêmes clés + valeurs `===` ⇒ on garde
    // l'objet en place (identité inchangée, aucun lecteur réveillé).
    if (!this._mjs_shallowEq(µ.url.params, params)) { µ.url.params = params; }
    if (!this._mjs_shallowEq(µ.url.query, query)) { µ.url.query = query; }
    µ.url.hash = loc.hash;
  },
  // Égalité superficielle (mêmes clés, mêmes valeurs `===`) — cf. 07-23. Évite
  // `JSON.stringify` (coût + ordre des clés) : une simple boucle for.
  _mjs_shallowEq: function(a, b) {
    if (a === b) { return true; }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') { return false; }
    var ka = Object.keys(a), kb = Object.keys(b), i, k;
    if (ka.length !== kb.length) { return false; }
    for (i = 0; i < ka.length; i++) { k = ka[i]; if (a[k] !== b[k]) { return false; } }
    return true;
  },
  _mjs_getMatchPath: function(destination) {
    var hashIdx, hashPart, matchPath;
    // On extrait UNIQUEMENT ce qui se trouve après le PREMIER `#` —
    // `split('#')[1]` tronquait au 2e `#` (`'/p#/a#b'` → '/a' au lieu de '/a#b').
    hashIdx = destination.indexOf('#');
    hashPart = hashIdx === -1 ? null : destination.slice(hashIdx + 1);
    // Sans hash, ou avec une ancre ordinaire (`#installation`, sans le `/` des routes — la règle du
    // clic, du Précédent et de hashchange), le composant est considéré à sa racine '/'
    matchPath = (hashPart && hashPart.charAt(0) === '/') ? hashPart : '/';
    // Retire la query collée au hash (`#/settings?tab=x` → `/settings`) : sinon
    // `_mjs_matchRoute` compare `settings?tab=x` et une route statique ne matche plus.
    // (La query est lue à part par `_mjs_updateUrlStore`, sur `loc.hash`/`loc.search`.)
    matchPath = matchPath.split('?')[0];
    if (matchPath.length > 1) {
      matchPath = matchPath.replace(/\/$/, '');
    }
    return matchPath;
  },
  // Canonicalise la PARTIE ROUTE d'un hash en retirant le(s) '/' final(s)
  // superflu(s) : `#/about/` → `#/about`, `#/a/?tri=x` → `#/a?tri=x`. La racine
  // `#/` est préservée et la query après `?` est conservée. Idempotent (une
  // string déjà canonique ressort telle quelle) → aucune boucle de redirection.
  // NB : `_mjs_getMatchPath` normalisait DÉJÀ le slash pour le MATCH (pas de 404),
  // mais laissait l'URL VISIBLE sale ; cette fonction nettoie la barre d'adresse.
  _mjs_canonHash: function(hash) {
    var body, pathPart, qi, queryPart, end;
    if (!hash || hash.charAt(0) !== '#') { return hash; }
    body = hash.slice(1);
    qi = body.indexOf('?');
    pathPart = qi === -1 ? body : body.slice(0, qi);
    queryPart = qi === -1 ? '' : body.slice(qi);
    if (pathPart.length > 1 && pathPart.charAt(pathPart.length - 1) === '/') {
      // boucle et non `/\/+$/` : sur un lien piégé (`#////…////a/`), l'expression régulière repart de chaque
      // `/` de la suite — temps quadratique, onglet gelé dès le chargement
      end = pathPart.length;
      while (end > 0 && pathPart.charCodeAt(end - 1) === 47) { end--; }
      pathPart = end === 0 ? '/' : pathPart.slice(0, end);
    }
    return '#' + pathPart + queryPart;
  },
  // Réécrit l'URL COURANTE vers sa forme canonique (slash final retiré) SANS
  // créer d'entrée d'historique (`replaceState`) : la redirection est invisible
  // pour le bouton Précédent. `replaceState` n'émet PAS `hashchange` → pas de
  // ré-entrée. Ne touche qu'aux hash de ROUTE (`#/…`) : une ancre `#section`
  // garde son slash. Appelée au boot (initComponent) et sur hashchange.
  _mjs_canonicalizeUrl: function() {
    var canon, hash, loc;
    if (typeof window === 'undefined' || !window.history) { return; }
    loc = window.location;
    hash = loc.hash || '';
    if (hash.slice(0, 2) !== '#/') { return; }
    canon = this._mjs_canonHash(hash);
    if (canon === hash) { return; }
    try {
      window.history.replaceState(window.history.state, '', loc.pathname + loc.search + canon);
    } catch (e) {
      µ.warn('[Router] ' + µ._mjs_txt('routerSlashRefused', { hash: hash }, 'canonicalisation du slash refusée pour \'{hash}\' :'), e);
    }
  },
  // Matche un chemin courant contre un motif de route pouvant contenir des
  // segments paramétrés `:param`. Match EXACT : tous les segments de la route ET
  // tous ceux de l'URL doivent être consommés — un segment d'URL en trop fait
  // ÉCHOUER la route (cf. `_matchSegs`). Un sous-arbre se déclare explicitement
  // avec `*` (`/admin/*`). Retourne {ok, params}.
  _mjs_matchRoute: function(matchPath, routePath) {
    var rp, mp;
    // tableaux partagés, jamais modifiés (`_matchSegs` ne fait que les lire)
    rp = this._mjs_routeSegs.get(routePath);
    if (!rp) {
      rp = routePath.split('/').filter(Boolean);
      this._mjs_routeSegs.set(routePath, rp);
    }
    if (matchPath !== this._mjs_pathSegsKey) {
      this._mjs_pathSegs = matchPath.split('/').filter(Boolean);
      this._mjs_pathSegsKey = matchPath;
    }
    mp = this._mjs_pathSegs;
    if (rp.length === 0) {
      return { ok: mp.length === 0, params: {} };
    }
    return this._matchSegs(rp, 0, mp, 0, {});
  },
  // Correspondance récursive AVEC RETOUR ARRIÈRE (backtracking).
  //
  // nécessaire dès qu'un segment
  // optionnel `(:x)` façon Rails n'est PAS en toute fin de route
  // (`/a/(:x)/b`) : l'ancienne boucle linéaire, position par position,
  // associait le segment optionnel au premier segment d'URL venu SANS
  // jamais revenir sur ce choix si la suite échouait ensuite — `/a/(:x)/b`
  // contre `/a/b` consommait `b` comme valeur de `:x`, puis échouait sur le
  // littéral `b` manquant en fin de route, alors que `/a/b` DOIT matcher
  // (x = undefined, exactement comme un `:x` optionnel EN FIN de route).
  // Stratégie : à chaque segment optionnel, essaie d'abord PRÉSENT (glouton,
  // comme avant — couvre l'immense majorité des cas dès le 1er essai), puis
  // ABSENT si la suite échoue.
  // mémoire par position : PRÉSENT n'est choisi que si la suite peut réussir ainsi (`_mjs_canMatchSegs`, chaque couple segment
  // de route, segment d'adresse calculé une fois) — le chemin même que trouvait l'essai PRÉSENT puis ABSENT, réussite ou échec,
  // paramètres compris, sans rejouer ses impasses. Sans elle, chaque segment facultatif doublait les essais de la suite :
  // vingt-quatre segments facultatifs devant un lien que la route ne prend pas figeaient la page près de deux minutes
  _matchSegs: function(rp, ri, mp, mi, params, seen) {
    var seg, opt, name, all, withVal;
    if (ri >= rp.length) {
      // MATCH EXACT — la route est épuisée : elle ne
      // matche QUE si l'URL l'est aussi. Un segment d'URL en trop signifie que
      // l'adresse ne désigne PAS cette route ; l'absorber silencieusement
      // (comportement d'avant) masquait les fautes de frappe et rendait `&all`
      // inatteignable dans une table `{'/a': X, '/a/*': Y}` — `/a`, préfixe,
      // captait `/a/b` avant que `/a/*` ne soit essayé. Un sous-arbre (layout
      // imbriqué) se déclare désormais EXPLICITEMENT avec `*` : `'/admin/*'`.
      // Le retour `false` alimente aussi le retour arrière des segments
      // optionnels plus haut dans la pile (branche « absent »).
      return { ok: mi >= mp.length, params: params };
    }
    seg = rp[ri];
    // Segment OPTIONNEL façon Rails : `(:id)` (ou `(segment)`). Les parenthèses
    // le rendent facultatif → `/posts/(:id)` matche `/posts` ET `/posts/42`, sans
    // écrire deux routes. Absent → le param vaut `undefined`.
    opt = seg.charCodeAt(0) === 40 && seg.charCodeAt(seg.length - 1) === 41; // '(' … ')'
    if (opt) { seg = seg.slice(1, -1); }
    if (seg === '*') { // catch-all → capture tout le reste du path : `all` (&all) et `rest` (&rest)
      all = Object.assign({}, params);
      // segments décodés un à un
      // (comme `:param`) : `/files/a%2Fb` → `['a/b']`, cohérent avec la doc
      // « la valeur capturée est décodée ». Tolérant au `%` mal formé.
      // le joker pose DEUX clés : `all` le
      // TABLEAU des segments décodés (itérer, compter), `rest` ce même tableau
      // rejoint par `/` (reconstruire une URL — exactement ce que rendait `all`
      // avant cette décision). Un seul point de vérité : le tableau, `rest` en
      // découle.
      all.all = mp.slice(mi).map(this._mjs_dec);
      all.rest = all.all.join('/');
      return { ok: true, params: all };
    }
    if (opt) {
      if (mi < mp.length) {
        // mémoire née au premier segment facultatif : rien ne se ramifie avant lui ; une case par position (`_mjs_canMatchSegs`)
        seen ||= new Uint8Array((rp.length + 1) * (mp.length + 1));
        if (seg.charCodeAt(0) === 58) { // ':' → segment paramétré → capture
          if (this._mjs_canMatchSegs(rp, ri + 1, mp, mi + 1, seen)) {
            withVal       = Object.assign({}, params);
            name          = seg.slice(1);
            withVal[name] = this._mjs_dec(mp[mi]);
            return this._matchSegs(rp, ri + 1, mp, mi + 1, withVal, seen);
          }
        } else {
          // Littéral optionnel : décoder le segment URL avant comparaison
          // (parité avec le littéral NON optionnel) → `/(café)` matche
          // `/caf%C3%A9`.
          if (seg === this._mjs_dec(mp[mi]) && this._mjs_canMatchSegs(rp, ri + 1, mp, mi + 1, seen)) {
            return this._matchSegs(rp, ri + 1, mp, mi + 1, params, seen);
          }
        }
      }
      // ABSENT : le param nommé (s'il y en a un) vaut explicitement undefined.
      withVal = Object.assign({}, params);
      if (seg.charCodeAt(0) === 58) { withVal[seg.slice(1)] = void 0; }
      return this._matchSegs(rp, ri + 1, mp, mi, withVal, seen);
    }
    if (mi >= mp.length) {
      // Plus de segments dans l'URL alors que CE segment n'est pas optionnel.
      return { ok: false, params: params };
    }
    if (seg.charCodeAt(0) === 58) { // ':' → segment paramétré → capture
      name          = seg.slice(1);
      withVal       = Object.assign({}, params);
      withVal[name] = this._mjs_dec(mp[mi]);
      return this._matchSegs(rp, ri + 1, mp, mi + 1, withVal, seen);
    }
    // un segment LITTÉRAL de route (ex.
    // `/café`) était comparé tel quel à `mp[mi]`, qui peut être ENCODÉ si
    // l'URL a été construite/tapée avec des caractères non-ASCII
    // (`/caf%C3%A9`) — le littéral (déjà décodé, écrit en clair dans le
    // code source) ne matchait alors jamais l'URL réelle, contrairement aux
    // segments `:param` déjà décodés depuis le tout premier commit de cette
    // fonction. Décodage tolérant (`_mjs_dec`) : un `%` mal formé dans l'URL
    // ne doit pas faire planter le routeur, juste comparer la valeur brute
    // (échoue proprement au pire, comme avant ce fix).
    if (seg !== this._mjs_dec(mp[mi])) { return { ok: false, params: {} }; }
    return this._matchSegs(rp, ri + 1, mp, mi + 1, params, seen);
  },
  // décode un segment d'adresse ; un `%` mal formé ressort brut
  _mjs_dec: function(s) {
    try { return decodeURIComponent(s); } catch { return s; }
  },
  // la suite de la route (depuis `ri`) peut-elle prendre la suite de l'adresse (depuis `mi`) ? Mêmes règles que `_matchSegs`,
  // sans les paramètres ; chaque position (segment de route, segment d'adresse) ne se calcule qu'une fois. `vu` : une case par
  // position (0 pas encore, 1 non, 2 oui), dans un tableau d'octets — ni tableau creux (sous V8, il ralentit d'un coup passé un
  // millier de segments), ni objet (une clé numérique posée sur Object.prototype par une fusion de JSON portant `__proto__` s'y
  // lirait comme une réponse)
  _mjs_canMatchSegs: function(rp, ri, mp, mi, seen) {
    var seg, opt, can, pos;
    if (ri >= rp.length) { return mi >= mp.length; }
    pos = ri * (mp.length + 1) + mi;
    if (seen[pos]) { return seen[pos] === 2; }
    seg = rp[ri];
    opt = seg.charCodeAt(0) === 40 && seg.charCodeAt(seg.length - 1) === 41; // '(' … ')'
    if (opt) { seg = seg.slice(1, -1); }
    can = seg === '*';
    if (!can && mi < mp.length) {
      // même comparaison que `_matchSegs` : `:param` prend tout segment, un littéral se compare au segment décodé
      can = (seg.charCodeAt(0) === 58 || seg === this._mjs_dec(mp[mi])) && this._mjs_canMatchSegs(rp, ri + 1, mp, mi + 1, seen);
    }
    if (!can && opt) { can = this._mjs_canMatchSegs(rp, ri + 1, mp, mi, seen); }
    seen[pos] = can ? 2 : 1;
    return can;
  },
  // PERF — motifs triés par SPÉCIFICITÉ,
  // mémoïsés par `routeMap` : avant, chaque navigation refaisait
  // `Object.keys(map).sort(...)` (le comparateur re-splittant chaque motif via
  // `_mjs_staticSegs`) 3× par composant — O(R log R) splits × 3 × K composants au
  // boot. Ici : calculé UNE fois par table de routes.
  _mjs_sortedPaths: function(routeMap) {
    var cached = this._mjs_routeSortCache.get(routeMap);
    if (cached) { return cached; }
    var paths = Object.keys(routeMap).sort(function(a, b) {
      return µ.Router._mjs_staticSegs(b) - µ.Router._mjs_staticSegs(a) || µ.Router._mjs_wildSegs(a) - µ.Router._mjs_wildSegs(b) || b.length - a.length;
    });
    this._mjs_routeSortCache.set(routeMap, paths);
    return paths;
  },
  // Mesure de SPÉCIFICITÉ d'un motif : nombre de segments LITTÉRAUX (ni `:param`,
  // ni `*`, ni optionnel `(…)`). Sert au tri des routes — plus de littéraux = plus
  // spécifique (`/posts/new` l'emporte sur `/posts/(:id)`).
  _mjs_staticSegs: function(p) {
    return p.split('/').filter(function(s) {
      return s && s.charAt(0) !== ':' && s.charAt(0) !== '(' && s !== '*';
    }).length;
  },
  // Départage wildcard : à spécificité statique ÉGALE, un motif
  // SANS catch-all passe AVANT un motif qui en contient. Sans ça, la racine `/`
  // (0 littéral, longueur 1) perdait le tie-break de LONGUEUR face à `/*`
  // (0 littéral, longueur 2) : le catch-all matchant tout, la route racine était
  // INATTEIGNABLE dès qu'un `/*` existait dans la même table (`'/'` →
  // not-found systématique, vu sur app cliente). Compter les `*` et trier croissant
  // rétablit `/` avant `/*` sans toucher aux autres égalités (0 partout → même
  // ordre qu'avant). NB : depuis le passage au match EXACT, une table
  // `{'/a': X, '/a/*': Y}` ne se dispute plus `/a/b` — `/a` n'y matche plus du
  // tout, `/a/*` prend seul. Ce tri ne départage donc que les URLs réellement
  // ambiguës (ici `/a` nu, que les DEUX motifs matchent : `/a` gagne).
  _mjs_wildSegs: function(p) {
    return p.split('/').filter(function(s) { return s === '*'; }).length;
  },
  // fusion tolérante aux `undefined` :
  // `µ.url.params` est une UNION à plat des params de TOUTES les vues
  // routées de la page (cf. commentaire de `_mjs_updateUrlStore`) — deux
  // composants indépendants peuvent légitimement nommer un param pareil
  // (`:id` est un nom courant). Avec `Object.assign` brut, un composant B
  // dont le `:id` est OPTIONNEL et ABSENT sur l'URL courante écrivait
  // `id: undefined`, qui ÉCRASAIT la vraie valeur déjà posée par un
  // composant A pour qui `:id` EST présent — l'ordre d'itération de
  // `_mjs_awareComponents`/`comp.routes` (non garanti) décidait silencieusement
  // laquelle des deux valeurs survivait. Une valeur DÉFINIE ne doit jamais
  // être effacée par une absence venue d'ailleurs.
  _mjs_mergeParams: function(target, source) {
    var k;
    for (k in source) {
      if (source[k] === void 0 && target[k] !== void 0) { continue; }
      target[k] = source[k];
    }
    return target;
  },
  // Agrège les params de TOUTES les routes du composant qui matchent l'URL
  // courante (au plus une route par vue), pour les passer à `@urlChange`.
  _mjs_extractParams: function(comp, matchPath) {
    var m, params, paths, pi, routeMap, routePath, targetId;
    params = {};
    if (!comp.routes) {
      return params;
    }
    for (targetId in comp.routes) {
      routeMap = comp.routes[targetId];
      paths = this._mjs_sortedPaths(routeMap);
      for (pi = 0; pi < paths.length; pi++) {
        routePath = paths[pi];
        m = this._mjs_matchRoute(matchPath, routePath);
        if (m.ok) {
          this._mjs_mergeParams(params, m.params);
          break;
        }
      }
    }
    return params;
  },
  // `fresh` : l'appelant vient de poser lui-même une entrée neuve (lien `#/…` suivi par la navigation, mjs_ujs.ts) —
  // comme une entrée que `navigate` ajoute (`pushHistory` sans `replaceHistory`), la route part du haut de la page ;
  // le retour arrière, lui, rend sa position (mjs_ujs.ts, popstate). `own` : l'entrée courante de l'historique est celle de la
  // destination (rejeu d'une navigation qui attendait le code d'une page)
  navigate: function(destination, pushHistory = true, replaceHistory, fresh = false, own) {
    var comp, matchPath, ref, results, gen, toTop;
    // une adresse ajoutée pendant la garde `µurlChange` de la navigation en cours (montage compris), sans `replace` écrit, prend
    // la place de l'entrée de la page gardée quand l'entrée courante est la sienne : le retour ramène à la page d'avant, sans
    // rejouer la garde (cf. `_mjs_runGuard`)
    if (replaceHistory === undefined) { replaceHistory = !!pushHistory && this._mjs_guardGen === this._mjs_navGen; }
    toTop = fresh || (pushHistory && !replaceHistory);
    // l'entrée courante de l'historique est-elle celle de la destination ? oui si cette navigation l'écrit, si un lien suivi vient
    // de la poser (`fresh`) ou si le navigateur y est déjà (`_mjs_follow`) ; non pour `µRouter.to(route, false)`, `{ push: false }`
    // et `µRouter.navigate(adresse, false)`, qui n'écrivent aucune entrée
    own = own || this._mjs_follow || fresh || !!pushHistory || replaceHistory;
    this._mjs_follow = 0;
    // <routes-idle>
    // une page de la destination dont le code n'est pas arrivé : rien ne change encore (adresse, µ.url, crochets, vues) — elle est
    // demandée et attendue, au plus 1,5 s, l'ancienne page reste à l'écran ; puis la navigation se joue en entier, comme sans
    // attente. Une navigation suivante l'emporte (jeton) ; l'appel rejoué ne réattend pas ; la même destination redemandée pendant
    // l'attente (le `hashchange` qui suit un retour arrière ou une adresse changée à la main) ne la relance pas. `_mjs_navWait`
    // rend vrai à la bascule, faux à l'abandon : la position du retour arrière l'attend (mjs_ujs.ts, popstate)
    var _mjsReady = this._mjs_navReady, _mjsKey = this._mjs_getMatchPath(destination) + '?' + ((destination.split('#')[1] || '').split('?')[1] || '');
    this._mjs_navReady = false;
    if (!_mjsReady && this._mjs_navWait && this._mjs_navWaitKey === _mjsKey) { return []; }
    var _mjsLate = (_mjsReady || this._mjs_navBusy || typeof customElements === 'undefined' || !µ.Autoloader || typeof µ.pathOf !== 'function') ? [] : this._mjs_resolveModules(destination).filter((n) => µ.pathOf(n) && !customElements.get('mjs-' + n));
    this._mjs_navWait = null;
    // une visite sans attente (page déjà là, garde qui renvoie ailleurs) n'est plus la visite attendue d'avant : une page ratée
    // pendant celle-ci se redemande à son montage (mjs_autoloader.ts)
    if (!_mjsReady) { this._mjs_navWaitKey = null; }
    if (_mjsLate.length) {
      var _mjsGen = ++this._mjs_navGen;
      // la note aussi pendant l'attente : une garde qui monte avant l'arrivée du code compte avec elle (cf. `_mjs_runGuard`)
      if (own) { this._mjs_ownGen = _mjsGen; }
      this._mjs_navWaitKey = _mjsKey;
      // µ.Router.to() : l'adresse change dès l'appel, comme au clic sur un lien — `location` la dit aussitôt, un retour du navigateur
      // pendant l'attente revient à la page affichée, et un rechargement de la page du navigateur (fichier périmé) se fait sur la destination
      if (pushHistory || replaceHistory) {
        var _mjsDest = destination, _mjsHi = destination.indexOf('#');
        if (_mjsHi !== -1) { _mjsDest = destination.slice(0, _mjsHi) + this._mjs_canonHash(destination.slice(_mjsHi)); }
        try {
          if (replaceHistory) { window.history.replaceState({}, '', _mjsDest); }
          else {
            if (typeof µ._mjs_saveScroll === 'function') { µ._mjs_saveScroll(window.location.pathname + window.location.search + (window.location.hash || '#')); }
            window.history.pushState({}, '', _mjsDest);
          }
        } catch (e) {
          µ.warn('[Router] ' + µ._mjs_txt('routerHistoryRefused', { dest: _mjsDest }, '(r)emplacement d\'historique refusé pour \'{dest}\' :'), e);
        }
        fresh = toTop;
        pushHistory = replaceHistory = false;
      }
      // les pages attendues, comme celles d'une vue posée : un échec du chargement au repos les redemande (mjs_autoloader.ts)
      this._mjs_navWaiting = _mjsLate.map((n) => 'mjs-' + n);
      if (typeof µ._mjs_navProgressStart === 'function') { µ._mjs_navProgressStart(); }
      // chaque visite a droit à son essai, même pour une page ratée à la visite d'avant (mjs_autoloader.ts)
      if (µ.Autoloader._mjs_failedKey) { _mjsLate.forEach((n) => delete µ.Autoloader._mjs_failedKey['mjs-' + n]); }
      _mjsLate.forEach((n) => µ.Autoloader.load('mjs-' + n));
      this._mjs_navWait = Promise.race([Promise.all(_mjsLate.map((n) => customElements.whenDefined('mjs-' + n))), new Promise((d) => setTimeout(d, 1500))]).then(() => {
        if (_mjsGen !== this._mjs_navGen) { return false; }
        this._mjs_navWait = null;
        this._mjs_navReady = true;
        this.navigate(destination, pushHistory, replaceHistory, fresh, own);
        return true;
      });
      return [];
    }
    // </routes-idle>
    // garde de RÉ-ENTRANCE : un `@urlChange`
    // qui redirige (garde d'authentification typique : "si pas connecté →
    // navigate('/login')") ré-entre dans CETTE MÊME fonction PENDANT que la
    // boucle plus bas (sur `_mjs_awareComponents`) est encore en cours. L'appel
    // imbriqué tourne à son terme (pushState, met à jour TOUS les composants
    // avec le VRAI chemin final) puis rend la main à la boucle EXTÉRIEURE, qui
    // continuait alors d'itérer ses composants restants avec son `matchPath`
    // à elle — PÉRIMÉ, plus le chemin courant réel — leur injectant la
    // MAUVAISE vue. `gen` détecte qu'une navigation plus récente a pris le
    // dessus et abandonne : les composants restants ont de toute façon déjà
    // été traités par l'appel imbriqué (sa boucle couvre TOUT `_mjs_awareComponents`).
    gen = ++this._mjs_navGen;
    // la navigation note, en partant, si l'entrée courante de l'historique est la sienne (cf. `_mjs_runGuard`)
    if (own) { this._mjs_ownGen = gen; }
    // la barre de navigation (mjs_nav_progress.ts) : armée ici, elle part quand les composants des
    // vues nouvelles sont arrivés (cf. `_mjs_navProgressEnd`) — rien à l'écran si c'est rapide
    this._mjs_navWaiting = [];
    if (typeof µ._mjs_navProgressStart === 'function') { µ._mjs_navProgressStart(); }
    matchPath = this._mjs_getMatchPath(destination);
    // Mémorise le dernier chemin routé : le listener `hashchange` (mjs_ujs)
    // s'en sert pour ne PAS re-router quand un back/forward a déjà navigué
    // (popstate émet aussi hashchange sur une route hash).
    this._mjs_lastNavPath = matchPath;
    // la query est mémorisée À PART :
    // sans elle, le garde-fou hashchange (mjs_ujs.ts, `matchPath ===
    // _mjs_lastNavPath`) ne compare QUE le chemin — un changement de query SEUL
    // (même route, ex. `#/liste?tri=nom` → `#/liste?tri=prix` posé
    // programmatiquement) laisse `matchPath` inchangé → le garde-fou sautait
    // `navigate()` en entier, donc `_mjs_updateUrlStore` n'était JAMAIS rappelé
    // → `µ.url.query` restait figé sur l'ANCIENNE query à vie, malgré une
    // barre d'adresse déjà à jour.
    var _hi2 = destination.indexOf('#');
    var _hashPart2 = _hi2 !== -1 ? destination.slice(_hi2 + 1) : '';
    var _qi2 = _hashPart2.indexOf('?');
    this._mjs_lastNavQuery = _qi2 !== -1 ? _hashPart2.slice(_qi2 + 1) : '';
    µ._mjs_logger()?.('🚦 [Router] ' + µ._mjs_txt('routerLogNavigate', { matchPath: matchPath }, 'Navigation locale vers : \'{matchPath}\''));
    if (pushHistory || replaceHistory) {
      // Canonicalise le slash final AVANT de (r)emplacer (`to('/about/')` ou
      // `<a href="#/about/">` → l'historique n'enregistre que `#/about`). On ne
      // touche qu'à la partie hash de la destination (une URL peut être complète
      // lors d'un back/forward relayé par mjs_ujs).
      var _dest = destination, _hi = destination.indexOf('#');
      if (_hi !== -1) {
        _dest = destination.slice(0, _hi) + this._mjs_canonHash(destination.slice(_hi));
      }
      try {
        // DURCISSEMENT — un redirect de garde passe `replaceHistory` :
        // il remplace l'entrée courante au lieu d'en empiler une (sinon le
        // bouton Précédent reste piégé sur la route redirigée).
        if (replaceHistory) {
          window.history.replaceState({}, '', _dest);
        } else {
          // position de la route quittée, rendue au Précédent par la navigation (mjs_ujs.ts, popstate) qui
          // coupe le défilement natif ; sans elle, le navigateur s'en charge seul
          if (typeof µ._mjs_saveScroll === 'function') { µ._mjs_saveScroll(window.location.pathname + window.location.search + (window.location.hash || '#')); }
          window.history.pushState({}, '', _dest);
        }
      } catch (e) {
        // SecurityError sur URL cross-origin passée à l'API publique.
        µ.warn('[Router] ' + µ._mjs_txt('routerHistoryRefused', { dest: _dest }, '(r)emplacement d\'historique refusé pour \'{dest}\' :'), e);
      }
    }
    // `_mjs_updateUrlStore` APRÈS le
    // (r)emplacement d'historique : il relit `loc.hash`/`loc.href`/`loc.search`
    // pour `query`/`hash`/`href`. Appelé AVANT le pushState (comme avant ce fix),
    // il lisait l'ANCIENNE URL → sur un `to('/liste?tri=prix')` programmatique,
    // `µ.url.query` restait figé sur l'ancienne query À VIE (pushState n'émet
    // jamais `hashchange` pour rafraîchir ensuite). Les appelants
    // `pushHistory=false` (popstate/hashchange/clic) ont déjà une `location` à
    // jour → aucun changement pour eux.
    this._mjs_updateUrlStore(matchPath);
    // Convention MJS : `e.data` (pas `e.detail`). CustomEvent natif ne
    // connaît que `detail` au constructor → on définit `data` manuellement
    // après la construction (idem `_mjs_emit`).
    // la transition de cette navigation (posée plus bas) : celle d'une navigation précédente ne compte plus
    µ._mjs_vtLast = null;
    const _routeEv = new CustomEvent('mjs-route-changed');
    Object.defineProperty(_routeEv, 'data', { value: matchPath, enumerable: true });
    window.dispatchEvent(_routeEv);
    ref = this._mjs_awareComponents;
    results = [];
    var _mjsInject = () => {
      // route neuve : le haut de la page, posé avec les vues qui changent (sous une transition, l'image de départ garde
      // la position quittée)
      if (toTop && typeof window.scrollTo === 'function') { window.scrollTo({ left: 0, top: 0, behavior: 'instant' }); }
      // la navigation finit (barre de navigation) même si un `urlChange` ou une vue lève : l'erreur
      // reste visible, la barre ne reste pas à l'écran jusqu'à la navigation suivante
      // <routes-idle>
      // une navigation demandée pendant que celle-ci joue ses crochets et pose ses vues (garde `µurlChange`, renvoi depuis un `µawake`) s'applique dans le tour, sans attente
      this._mjs_navBusy = (this._mjs_navBusy || 0) + 1;
      // </routes-idle>
      try {
        for (comp of ref) {
          if (gen !== this._mjs_navGen) {
            // Une navigation plus RÉCENTE a pris le dessus pendant cette boucle
            // (redirect dans un @urlChange déjà traité) — elle a déjà mis à jour
            // TOUS les composants avec le VRAI chemin final ; continuer ici
            // écraserait ce travail avec notre `matchPath` périmé.
            break;
          }
          if (typeof comp._mjs_hooks?.urlChange === "function") {
            this._mjs_runGuard(comp, matchPath, gen);
            // sa propre garde a renvoyé ailleurs (jumelle de celle du montage) : ses vues sont déjà celles du vrai chemin, la
            // page gardée ne repasse pas par-dessus
            if (gen !== this._mjs_navGen) break;
          }
          results.push(this._mjs_injectViewsForComponent(comp, matchPath));
        }
      } finally {
        // <routes-idle>
        this._mjs_navBusy--;
        // </routes-idle>
        if (gen === this._mjs_navGen) { this._mjs_navProgressEnd(gen); }
      }
      // Après la salve : l'URL a-t-elle trouvé preneur quelque part ? (cf.
      // `_mjs_scheduleNoMatchCheck` — retire aussi un panneau d'erreur précédent.)
      this._mjs_scheduleNoMatchCheck(matchPath);
    };
    // @viewTransition : cascade DÉPART vs ARRIVÉE, la plus grosse priorité gagne (égalité →
    // le départ gagne), cf. `_mjs_vtResolveNavigation`/`_mjs_vtWinner`. Garde d'environnement
    // (_mjs_vtEnabled) ET résolution — deux conditions SÉPARÉES (cf. leurs commentaires respectifs).
    // `!µ._mjs_vtPageSwapping` : ce navigate() peut être appelé SYNCHRONEMENT depuis l'intérieur
    // du updateCallback d'une transition de PAGE déjà démarrée (mjs_ujs.ts, µ._mjs_vtWrapSwap, cf.
    // son bandeau — les 6 sites d'échange de page finissent par ce navigate()) : sans cette garde,
    // document.startViewTransition() était rappelé DEPUIS L'INTÉRIEUR du 1er, avant même que celui-ci
    // n'ait rendu son objet ViewTransition à SON appelant (réentrance prouvée par sonde). Drapeau
    // PARTAGÉ, même mécanique que µ._mjs_vtAttrSeq (posé/levé par µ._mjs_vtWrapSwap).
    var vtWinner = (this._mjs_vtEnabled() && !µ._mjs_vtPageSwapping) ? this._mjs_vtResolveNavigation(matchPath) : null;
    if (vtWinner && vtWinner.value) {
      // RIDEAUX « à travers le noir » (vrai DOM, µ._mjs_vtCurtainRun) : pris en
      // charge AVANT l'API View Transitions — pas de pseudo, pas de lévitation
      // (sous le noir, un morph serait invisible)
      if (typeof µ._mjs_vtCurtainRun === 'function' && typeof vtWinner.value === 'string' && µ._mjs_vtCurtainRun(vtWinner.value, _mjsInject)) {
        µ._mjs_logger()?.('🎬 [Router] ' + µ._mjs_txt('routerLogCurtain', { value: vtWinner.value, priority: vtWinner.priority }, 'Permutation de vues sous RIDEAU ({value}, priorité {priority})'));
        return results;
      }
      // navigateur sans l'API View Transitions : permutation directe, silencieuse (seuls les rideaux jouent sans elle)
      if (typeof document.startViewTransition !== 'function') { _mjsInject(); return results; }
      if (typeof µ._mjs_vtApplyPreset === 'function') { µ._mjs_vtApplyPreset(vtWinner.value); }
      µ._mjs_logger()?.('🎬 [Router] ' + µ._mjs_txt('routerLogViewTransition', { value: typeof vtWinner.value === 'string' ? vtWinner.value : µ._mjs_txt('routerLogNative', null, 'natif'), priority: vtWinner.priority }, 'Permutation de vues sous View Transition ({value}, priorité {priority})'));
      // couche de lévitation (éléments nommés en shadow) : cf. son bloc dans mjs_vt_presets.ts
      var _vtHoist = (typeof µ._mjs_vtHoistStart === 'function') ? µ._mjs_vtHoistStart() : null;
      // pose html[data-mjs-vt] (docs/17-router.md:420) : un CSS de PROJET peut cibler
      // le nom de préréglage pendant la transition ; 'on' pour une résolution booléenne (fondu natif) ;
      // garde sur µ._mjs_vtParse (comme µ._mjs_vtApplyPreset juste au-dessus) : runtime tree-shaké sans
      // 'vt_presets' malgré un nom de préréglage résolu → repli 'on', jamais un crash. Garde sur
      // document.documentElement lui-même : de nombreux tests (vt-presets-ujs.test.ts et consorts)
      // stubbent `document` par un objet minimal { startViewTransition }, sans documentElement.
      // JETON DE SÉQUENCE, partagé avec mjs_ujs.ts (même
      // compteur µ._mjs_vtAttrSeq, même attribut html[data-mjs-vt]) : deux transitions chevauchées — le
      // retrait à `finished` d'une transition PÉRIMÉE ne doit RETIRER l'attribut QUE si aucune pose
      // plus récente n'a eu lieu depuis (sinon il efface celui de la transition ACTIVE, prouvé
      // Chromium).
      var _mjs_vtAttrSeq = (µ._mjs_vtAttrSeq = (µ._mjs_vtAttrSeq || 0) + 1);
      if (document.documentElement) { document.documentElement.dataset.mjsVt = (typeof vtWinner.value === 'string' && typeof µ._mjs_vtParse === 'function') ? µ._mjs_vtParse(vtWinner.value).base : 'on'; }
      var _vtTrans;
      try {
        _vtTrans = document.startViewTransition(_vtHoist ? () => { _mjsInject(); return µ._mjs_vtHoistSwapSettled(_vtHoist); } : _mjsInject);
      } catch (e) {
        // startViewTransition peut lever (état invalide) : l'attribut ne reste pas collé
        if (document.documentElement) { delete document.documentElement.dataset.mjsVt; }
        throw e;
      }
      // mémorisée pour ceux qui attendent la permutation des vues (les effets en direct) : `activeViewTransition`
      // est déjà vide quand la transition est sautée
      µ._mjs_vtLast = _vtTrans || null;
      // retrait à finished, y compris en échec, SEULEMENT si le compteur n'a pas bougé.
      var _vtClearAttr = function() { if (µ._mjs_vtAttrSeq === _mjs_vtAttrSeq && document.documentElement) { delete document.documentElement.dataset.mjsVt; } };
      if (_vtTrans && _vtTrans.finished) { _vtTrans.finished.then(_vtClearAttr, _vtClearAttr); }
      // une transition SAUTÉE (navigations enchaînées avant la fin) rejette
      // `ready`, que personne ne consomme ici → « Unhandled Promise Rejection »
      // en console pour un déroulé pourtant normal ; on l'absorbe
      if (_vtTrans && _vtTrans.ready && typeof _vtTrans.ready.catch === 'function') { _vtTrans.ready.catch(() => {}); }
      // nettoyage à FINISHED, jamais ready : le pseudo new(nom) est une image
      // VIVANTE du fantôme — retiré à ready, la moitié ENTRANTE du morph
      // disparaissait pendant toute l'animation (cf. _mjs_vtHoistEnd)
      if (_vtHoist && _vtTrans && _vtTrans.finished) { var _vtDone = () => µ._mjs_vtHoistEnd(_vtHoist); _vtTrans.finished.then(_vtDone, _vtDone); }
      // même absorption pour `finished` sans lévitation (le then ci-dessus couvre l'autre cas)
      if (!_vtHoist && _vtTrans && _vtTrans.finished && typeof _vtTrans.finished.catch === 'function') { _vtTrans.finished.catch(() => {}); }
    }
    else {
      _mjsInject();
    }
    return results;
  },
  // les balises des vues posées par la navigation en cours dont le code n'est pas encore arrivé
  _mjs_navWaiting: [],
  // celles qu'elle attend une fois ses vues posées (cf. `_mjs_navProgressEnd`)
  _mjs_navTags: [],
  // la fin d'une navigation, pour la barre de navigation : quand les composants de ses vues nouvelles
  // sont définis (tout de suite s'ils l'étaient déjà) — seulement si aucune navigation plus récente ne
  // l'a remplacée ; un composant qui n'arrive jamais, l'autoloader la retire en y renonçant
  _mjs_navProgressEnd: function(gen) {
    var tags = this._mjs_navWaiting;
    var stop = () => { if (gen === this._mjs_navGen && typeof µ._mjs_navProgressStop === 'function') { µ._mjs_navProgressStop(); } };
    this._mjs_navWaiting = [];
    // les balises que la navigation attend encore : l'autoloader n'éteint la barre que pour l'une d'elles
    this._mjs_navTags = tags;
    if (tags.length === 0 || typeof customElements === 'undefined' || typeof customElements.whenDefined !== 'function') { return stop(); }
    Promise.all(tags.map((t) => customElements.whenDefined(t))).then(stop, stop);
  },
  // ──────────────────────────────────────────────────────────────────────────
  // TRANSITIONS DE PAGE (@viewTransition) — la permutation des <@view> peut être enveloppée dans
  // l'API View Transitions du navigateur (cascade et priorité : `_mjs_vtResolveWithPriority`, plus bas).
  // Garde D'ENVIRONNEMENT pure (accessibilité) — SANS
  // rapport avec la résolution de cascade (_mjs_vtResolveWithPriority, cf. _mjs_vtResolveNavigation plus bas,
  // seule consommatrice réelle de cette cascade pour navigate()). PARTAGÉE : mjs_ujs.ts l'appelle
  // telle quelle (`µ.Router._mjs_vtEnabled()`) pour ses propres transitions de PAGE (swap de
  // #app-root, cascade lien/config distincte de celle-ci) — mjs_router.ts est chargé AVANT
  // mjs_ujs.ts (ordre CANONICAL, bundler/index.ts), donc atteignable sans dupliquer cette garde.
  // l'API View Transitions n'y est pas : un rideau (vrai DOM, µ._mjs_vtCurtainRun) joue sans elle, les
  // préréglages natifs la vérifient au moment de s'en servir (sans elle : permutation directe)
  _mjs_vtEnabled: function() {
    if (typeof document === 'undefined') { return false; }
    // accessibilité : « réduire les animations » ⇒ permutation directe, jamais de transition
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return false; }
    return true;
  },
  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITÉ DÉPART/ARRIVÉE (@viewTransition <nom> [priorité]) — un 2ᵉ argument
  // numérique façon z-index (défaut 1) départage deux pages qui demandent chacune
  // un nom DIFFÉRENT lors d'une même navigation. Règle : la plus grosse priorité
  // gagne (qu'elle soit posée sur la page de DÉPART ou celle d'ARRIVÉE) ; à
  // égalité (le cas le plus courant : 1 partout par défaut), c'est TOUJOURS la
  // page de DÉPART qui gagne. Résolution en {value, priority} plutôt qu'une
  // simple valeur : `value` vaut `false` (désactivé), `true` (fondu natif du navigateur) ou une CHAÎNE,
  // nom de préréglage de la bibliothèque (mjs_vt_presets.ts, cf. µ._mjs_vtApplyPreset) ; chaque niveau
  // pose 'on'/'off' OU un nom ('zoom', 'cube={ dir: left }'…) tel quel, `'none'` ≡ `'off'` partout.
  // « Rien de configuré » (`null`) n'est pas un « off » explicite : ce côté NE PARTICIPE PAS au
  // départage, cf. `_mjs_vtSideResolve`/`_mjs_vtWinner`.
  //
  // Cascade (du plus au moins spécifique) : attribut `data-mjs-vt`/`-p` de la
  // balise `<@view>` > directive racine `@viewTransition` du composant ROUTEUR >
  // défaut global `µ.viewTransition` (priorité toujours 1, cf. bundler/config.ts).
  // Renvoie `null` si RIEN n'est configuré à aucun niveau (ne participe pas).
  _mjs_vtResolveWithPriority: function(comp, viewNode) {
    var attr, attrP, mod, modP, cfg, cfgP;
    attr = viewNode && viewNode.getAttribute ? viewNode.getAttribute('data-mjs-vt') : null;
    if (attr) {
      attrP = viewNode.getAttribute('data-mjs-vt-p');
      return { value: attr === 'on' ? true : (attr === 'off' || attr === 'none') ? false : attr, priority: attrP ? parseInt(attrP, 10) : 1 };
    }
    mod = comp ? comp._mjs_viewTransition : null;
    if (mod) {
      modP = comp._mjs_viewTransitionPriority;
      return { value: mod === 'on' ? true : (mod === 'off' || mod === 'none') ? false : mod, priority: modP || 1 };
    }
    cfg = µ.viewTransition;
    if (cfg && cfg !== 'none') {
      // La config globale n'a pas de canal de priorité SÉPARÉ (contrairement
      // à attr/mod, où le compilateur extrait TOUJOURS `priority:` vers data-mjs-vt-p/
      // _mjs_viewTransitionPriority) : secours en relisant la chaîne elle-même
      // (`cube={ priority: 2 }`) via µ._mjs_vtParse, si le module est chargé.
      cfgP = (typeof µ._mjs_vtParse === 'function') ? µ._mjs_vtParse(cfg).priority : null;
      return { value: cfg, priority: cfgP || 1 };
    }
    return null;
  },
  // Résout la préférence @viewTransition d'un côté (départ OU arrivée) d'une
  // navigation. `leaf` = la PAGE routée elle-même — soit une INSTANCE déjà
  // montée (`viewNode.firstElementChild`, côté départ), soit la CLASSE d'un
  // module pas encore monté (`customElements.get(nom)`, côté arrivée : seuls
  // ses champs STATIQUES `_mjs_vt`/`_mjs_vtp` sont lisibles avant montage,
  // cf. template.ts). Sa PROPRE directive @viewTransition (si elle en pose une)
  // est le niveau le PLUS spécifique — au-dessus même de l'attribut <@view> et
  // de la directive du composant ROUTEUR, qui ne servent que de repli commun
  // aux DEUX côtés (cf. `_mjs_vtResolveWithPriority`).
  _mjs_vtSideResolve: function(leaf, comp, viewNode) {
    var v, p;
    if (leaf) {
      v = leaf._mjs_viewTransition !== undefined ? leaf._mjs_viewTransition : leaf._mjs_vt;
      if (v) {
        p = (leaf._mjs_viewTransitionPriority !== undefined ? leaf._mjs_viewTransitionPriority : leaf._mjs_vtp) || 1;
        return { value: v === 'on' ? true : (v === 'off' || v === 'none') ? false : v, priority: p };
      }
    }
    return this._mjs_vtResolveWithPriority(comp, viewNode);
  },
  // Départage deux résolutions {value, priority}|null. `null` = ce côté n'a
  // rien à dire, l'autre gagne d'office. La plus grosse priorité gagne ; à
  // égalité (le cas par défaut, 1 partout) c'est TOUJOURS `fromSide` (départ)
  // qui gagne — exactement la règle demandée : « peu importe, c'est toujours
  // la page d'où on part qui gagne », sauf si `toSide` (arrivée) porte une
  // priorité STRICTEMENT plus grande.
  _mjs_vtWinner: function(fromSide, toSide) {
    if (!fromSide && !toSide) { return null; }
    if (!fromSide) { return toSide; }
    if (!toSide) { return fromSide; }
    return toSide.priority > fromSide.priority ? toSide : fromSide;
  },
  // Point d'entrée appelé par `navigate()` : pour CHAQUE <@view> qui va CHANGER
  // lors de cette navigation, calcule le gagnant départ/arrivée (`_mjs_vtWinner`),
  // puis retient le gagnant de plus grosse priorité TOUS OUTLETS confondus —
  // l'API View Transitions est UNIQUE par document, une seule transition active
  // à la fois même si plusieurs <@view> changent dans la même navigation. Une
  // vue dont le module résolu est DÉJÀ celui affiché (même dérivation de tag
  // que `_mjs_injectView`, juste en dessous) ne participe PAS au vote — même si
  // elle porte elle-même une directive @viewTransition active : sinon deux
  // composants routés sur une même page se disputent une transition pour une
  // vue qui ne bouge pas (prouvé Chromium : un clic dans
  // l'un change le hash, l'autre se résout sur `/*` vers son module déjà
  // affiché, et faisait quand même voter — cf. docs/17-router.md § Bon à savoir).
  _mjs_vtResolveNavigation: function(matchPath) {
    var comp, targetId, ref, best, routeMap, paths, pi, routePath, m, matchedModule, viewNode, fromLeaf, toLeaf, fromSide, toSide, winner;
    ref = this._mjs_awareComponents;
    best = null;
    for (comp of ref) {
      if (!comp.routes) { continue; }
      for (targetId in comp.routes) {
        routeMap = comp.routes[targetId];
        viewNode = this._mjs_findView(comp, targetId);
        matchedModule = null;
        paths = this._mjs_sortedPaths(routeMap);
        for (pi = 0; pi < paths.length; pi++) {
          routePath = paths[pi];
          m = this._mjs_matchRoute(matchPath, routePath);
          if (m.ok) { matchedModule = routeMap[routePath]; break; }
        }
        fromLeaf = viewNode ? viewNode.firstElementChild : null;
        // même dérivation de tag que l'injection (`mjs-${moduleName}`, cf.
        // _mjs_injectView) — le registre custom elements ne connaît QUE le tag
        // préfixé, jamais le nom de module nu des @routes
        if (matchedModule && fromLeaf && fromLeaf.tagName.toLowerCase() === `mjs-${matchedModule}`.toLowerCase()) { continue; } // vue déjà sur ce module : ne vote pas
        toLeaf = (matchedModule && typeof customElements !== 'undefined') ? customElements.get(`mjs-${matchedModule}`.toLowerCase()) : null;
        fromSide = this._mjs_vtSideResolve(fromLeaf, comp, viewNode);
        toSide = this._mjs_vtSideResolve(toLeaf, comp, viewNode);
        winner = this._mjs_vtWinner(fromSide, toSide);
        if (winner && (!best || winner.priority > best.priority)) { best = winner; }
      }
    }
    return best;
  },
  // Résout une DESTINATION (`#/produit/42`) vers la liste des noms de composants
  // qui SERAIENT injectés — SANS rien injecter. Même logique de match/spécificité
  // que `_mjs_injectViewsForComponent`, mais en lecture seule. Sert au PRÉCHARGEMENT
  // (précharger le module d'un lien routé au survol / à l'apparition).
  _mjs_resolveModules: function(destination) {
    var comp, matchPath, paths, pi, ref, routeMap, routeMapAll, targetId, _m;
    var modules = new Set();
    matchPath = this._mjs_getMatchPath(destination);
    ref = this._mjs_awareComponents;
    for (comp of ref) {
      if (!comp.routes) { continue; }
      routeMapAll = comp.routes;
      for (targetId in routeMapAll) {
        routeMap = routeMapAll[targetId];
        paths = this._mjs_sortedPaths(routeMap);
        for (pi = 0; pi < paths.length; pi++) {
          _m = this._mjs_matchRoute(matchPath, paths[pi]);
          if (_m.ok) { modules.add(routeMap[paths[pi]]); break; }
        }
      }
    }
    return Array.from(modules);
  },
  _mjs_injectViewsForComponent: function(comp, matchPath) {
    var injections, ref, targetId;
    if (!comp.routes) {
      µ._mjs_logger()?.('   ↳ ⚠️ [Router] ' + µ._mjs_txt('routerLogNoRoutes', { tag: comp.tagName.toLowerCase() }, 'Aucun objet @routes trouvé dans <{tag}>'));
      return;
    }
    µ._mjs_logger()?.('   ↳ 🔍 [Router] ' + µ._mjs_txt('routerLogAnalyze', { tag: comp.tagName.toLowerCase() }, 'Analyse des @routes pour <{tag}>...'));
    injections = 0;
    ref = comp.routes;
    for (targetId in ref) {
      if (this._mjs_injectTarget(comp, targetId, matchPath)) { injections++; }
    }
    if (injections === 0) {
      return µ._mjs_logger()?.('      🚫 ' + µ._mjs_txt('routerLogNothingToInject', { matchPath: matchPath }, 'Aucun composant à injecter pour le path \'{matchPath}\'.'));
    }
  },
  // ──────────────────────────────────────────────────────────────────────────
  // AUCUNE ROUTE POUR L'URL COURANTE — « vraie » 404.
  // Une adresse que PLUS AUCUNE route de PLUS AUCUN composant routé ne matche
  // n'est pas un état normal : avant, toutes les <@view> se vidaient et l'écran
  // restait blanc, sans un mot. On le dit maintenant, en console ET à l'écran.
  //
  // PÉRIMÈTRE VOLONTAIREMENT GLOBAL (pas par zone) : une page à plusieurs
  // <@view> aux tables INDÉPENDANTES a parfaitement le droit de n'en remplir
  // qu'une (barre latérale routée sur les seules pages qui la méritent) — le
  // vidage d'UNE zone reste donc silencieux, comme avant. Seul le cas « rien
  // nulle part » est une erreur.
  //
  // ÉCHAPPATOIRE : déclarer une route de repli (`'/*': 'not-found-page'`) rend
  // ce cas structurellement inatteignable — c'est la façon recommandée de
  // servir sa propre 404. Sinon, `µ.config.routeNotFound` :
  //   'error' (défaut) console + panneau à l'écran · 'warn' console seule ·
  //   'silent' comportement d'avant (trace de debug seulement).
  // ──────────────────────────────────────────────────────────────────────────
  // µ._runtimeLabels porte désormais TOUTES les langues : le choix de la
  // langue AFFICHÉE se fait via µ._mjs_label (mjs_init.ts), jamais figé au build.
  _mjs_routerLabel: function(key) {
    var fallback = { notFound: 'Page introuvable', noRoute: 'Aucune route ne correspond à cette adresse.', declared: 'Routes déclarées' };
    var v = typeof µ._mjs_label === 'function' ? µ._mjs_label('router', key) : undefined;
    return v || fallback[key];
  },
  // Toutes les routes déclarées, tous composants et toutes zones confondus —
  // sert au message d'erreur (et seulement à lui : jamais au matching).
  _mjs_declaredRoutes: function() {
    var comp, targetId, out = [];
    for (comp of this._mjs_awareComponents) {
      if (!comp.routes) { continue; }
      for (targetId in comp.routes) {
        for (var p in comp.routes[targetId]) { if (out.indexOf(p) === -1) { out.push(p); } }
      }
    }
    return out.sort();
  },
  _mjs_anyRouteMatches: function(matchPath) {
    var comp, targetId, paths, pi, routeMap, any = false;
    for (comp of this._mjs_awareComponents) {
      if (!comp.routes) { continue; }
      for (targetId in comp.routes) {
        routeMap = comp.routes[targetId];
        paths = this._mjs_sortedPaths(routeMap);
        if (paths.length > 0) { any = true; }
        for (pi = 0; pi < paths.length; pi++) {
          if (this._mjs_matchRoute(matchPath, paths[pi]).ok) { return true; }
        }
      }
    }
    // Aucune table non vide = application sans routage déclaré (composant routé
    // monté avant que ses @routes ne soient peuplées, ou table vide assumée) :
    // rien à reprocher, on ne crie pas.
    return any ? false : true;
  },
  // Première <@view> trouvée (ordre d'enregistrement) : c'est là que le contenu
  // de la page serait allé, donc là que le message doit s'afficher.
  _mjs_firstViewNode: function() {
    var comp, targetId, node;
    for (comp of this._mjs_awareComponents) {
      if (!comp.routes) { continue; }
      for (targetId in comp.routes) {
        node = (comp._shadow && comp._shadow.querySelector(`metamjs-view#${targetId}`)) || (comp.querySelector && comp.querySelector(`metamjs-view#${targetId}`));
        if (node) { return node; }
      }
    }
    return null;
  },
  _mjs_clearNoMatch: function() {
    var comp, targetId, node, old;
    for (comp of this._mjs_awareComponents) {
      if (!comp.routes) { continue; }
      for (targetId in comp.routes) {
        node = (comp._shadow && comp._shadow.querySelector(`metamjs-view#${targetId}`)) || (comp.querySelector && comp.querySelector(`metamjs-view#${targetId}`));
        old = node && node.querySelector ? node.querySelector('[data-mjs-route-error]') : null;
        if (old) { node.textContent = ''; }
      }
    }
  },
  // Panneau visible. Lisible par un utilisateur final d'abord (titre + adresse) ;
  // le détail développeur (liste des routes déclarées) n'apparaît que sous
  // `µ.debug`. Styles portés par un <style> voisin (jamais d'attribut style) :
  // le panneau vit dans le shadow du composant routeur, la CSS de l'application
  // ne l'atteint pas — il doit donc s'habiller seul.
  _mjs_showNoMatch: function(matchPath) {
    var node = this._mjs_firstViewNode();
    if (!node || typeof document === 'undefined') { return; }
    if (node.querySelector && node.querySelector('[data-mjs-route-error]')) { return; }
    var box = document.createElement('div');
    box.setAttribute('data-mjs-route-error', '');
    box.className = 'mjs-route-error';
    var h = document.createElement('strong');
    var p = document.createElement('p');
    var code = document.createElement('code');
    code.textContent = matchPath;
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(code);
    var list   = null;
    var routes = '';
    if (µ.debug) {
      list = document.createElement('p');
      list.className = 'mjs-route-error-list';
      routes = this._mjs_declaredRoutes().join('  ·  ');
      box.appendChild(list);
    }
    // les libellés : récrits à l'arrivée du fichier de la langue s'il les surcharge, le panneau encore affiché (µ._mjs_labelKeep,
    // mjs_i18n.ts)
    var self  = this;
    var write = function() {
      h.textContent = self._mjs_routerLabel('notFound');
      p.textContent = self._mjs_routerLabel('noRoute');
      if (list) { list.textContent = self._mjs_routerLabel('declared') + ' : ' + routes; }
    };
    if (µ._mjs_labelKeep) { µ._mjs_labelKeep(write); }
    else { write(); }
    node.textContent = '';
    node.appendChild(box);
    if (µ._csp) {
      // adoptée par la racine du panneau (une feuille adoptée par `document` ne traverse pas une ombre),
      // une fois par racine
      var errorRoot = typeof node.getRootNode === 'function' ? node.getRootNode() : document;
      if (!errorRoot || !errorRoot.adoptedStyleSheets) { errorRoot = document; }
      if (!this._mjs_routeErrorSheet) {
        this._mjs_routeErrorSheet = new CSSStyleSheet();
        this._mjs_routeErrorSheet.replaceSync(µ._mjs_routeErrorCss);
      }
      if (errorRoot.adoptedStyleSheets.indexOf(this._mjs_routeErrorSheet) === -1) {
        errorRoot.adoptedStyleSheets = [...errorRoot.adoptedStyleSheets, this._mjs_routeErrorSheet];
      }
    } else {
      var style = document.createElement('style');
      style.textContent = µ._mjs_routeErrorCss;
      // marquée pour la règle qui la cache (cf. _mjs_routeErrorCss) : une règle du composant hôte
      // qui rend visibles tous les enfants de la zone (`> * { display: block }`) afficherait sinon
      // son CSS en texte sous le message
      style.setAttribute('data-mjs-route-error-css', '');
      // <style> à CÔTÉ du panneau, pas dedans : sinon la feuille se retrouve dans
      // le `textContent` du message (copier-coller pollué). Les deux partent
      // ensemble — `_mjs_clearView` comme `_mjs_injectView` vident la zone entière.
      node.appendChild(style);
    }
  },
  // Contrôle DIFFÉRÉ d'une frame : au démarrage, les composants routés
  // s'enregistrent un par un — le premier `initComponent` verrait un état
  // partiel (« rien ne matche » alors que le composant qui matche n'a pas
  // encore monté). Un seul contrôle par salve, sur le DERNIER chemin demandé.
  // un composant routé dont le montage attend encore (premier rendu gelé par l'attente des textes traduits) peut rediriger
  // dans son `µmount` : le contrôle attend qu'il ait monté, puis juge l'adresse où l'on est arrivé ; sans montage en attente,
  // il passe à l'image qui suit, comme avant. Tant que des textes sont en route (sous `*loader`, le gel dure jusqu'à la fin du
  // chargement, sans secours), il ne demande aucune image : la fin d'un chargement, le montage d'un composant ou une nouvelle
  // demande le réveillent. « Aucune route » ne se juge ainsi jamais avant le montage d'un composant qui attend ses textes
  _mjs_scheduleNoMatchCheck: function(matchPath) {
    if (µ._isServer || typeof document === 'undefined') { return; }
    var self = this;
    this._mjs_noMatchPath = matchPath;
    // l'adresse de la demande : changée d'ici le contrôle, c'est la nouvelle qui compte
    this._mjs_noMatchHref = window.location.href;
    // contrôle en attente des textes : la nouvelle demande le réveille (la vue a pu changer)
    this._mjs_noMatchWake?.();
    if (this._mjs_noMatchPending) { return; }
    this._mjs_noMatchPending = true;
    var waiting = function(comp) { return comp._mjs_pendingMount && !comp._mjs_mounted && comp.isConnected && !comp._mjs_has_crashed; };
    var run = function() {
      var comp, path, hash;
      for (comp of self._mjs_awareComponents) {
        if (waiting(comp)) { return hold(); }
      }
      self._mjs_noMatchPending = false;
      path = self._mjs_noMatchPath;
      hash = window.location.hash;
      // redirection au montage (`location.replace('#/…')`) dont le `hashchange` n'est pas encore passé : l'adresse
      // courante — sauf une ancre ordinaire, que le routeur ne suit pas
      if (window.location.href !== self._mjs_noMatchHref && (!hash || hash.slice(0, 2) === '#/')) { path = self._mjs_getMatchPath(window.location.href); }
      // pages du serveur qu'aucune vue neuve n'a reprises : remises dans la page entre-temps, elles vivent ; sinon (le `{if}`
      // du navigateur est resté fermé, le composant qui les montrait est parti) détruites pour de bon
      self._mjs_ssrPages.forEach(function(el) {
        if (el.isConnected) { el._mjs_page_cached = false; }
        else { µ._mjs_destroyEvictedTree?.(el); }
      });
      self._mjs_ssrPages.clear();
      self._mjs_checkNoMatch(path);
    };
    var arm = function() {
      if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(run); }
      else { setTimeout(run, 0); }
    };
    // un montage attend : textes en route, réveil à la fin d'un chargement (arrivée ou échec) ou au montage d'un composant
    // qui attend ; sinon l'image qui suit
    var hold = function() {
      var comp;
      var wake = function() {
        if (self._mjs_noMatchWake !== wake) { return; }
        self._mjs_noMatchWake = null;
        arm();
      };
      if (!µ.i18n?._mjs_inFlight?.(wake)) { return arm(); }
      self._mjs_noMatchWake = wake;
      for (comp of self._mjs_awareComponents) {
        if (waiting(comp)) { (comp._mjs_mount_cbs ||= []).push(wake); }
      }
      // filet : un composant qui attend peut quitter la page sans navigation ni montage, et aucun réveil ne vient ; l'attente
      // est revue à l'échéance de l'attente des textes (`i18n.timeout`, 3 s par défaut), sans juger si elle tient encore
      setTimeout(wake, µ._i18nData?.timeout > 0 ? µ._i18nData.timeout : 3000);
    };
    arm();
  },
  _mjs_checkNoMatch: function(matchPath) {
    if (this._mjs_anyRouteMatches(matchPath)) { return this._mjs_clearNoMatch(); }
    var mode = (µ.config && µ.config.routeNotFound) || 'error';
    if (mode === 'silent') { return µ._mjs_logger()?.('   ↳ 🚫 [Router] ' + µ._mjs_txt('routerNoRouteLog', { matchPath: matchPath }, 'Aucune route pour \'{matchPath}\'.')); }
    var msg = '[Router] ' + µ._mjs_txt('routerNoRoute', { matchPath: matchPath, routes: this._mjs_declaredRoutes().join(', ') || µ._mjs_txt('routerNoneDeclared', null, '(aucune)') }, 'Aucune route ne correspond à \'{matchPath}\'. Routes déclarées : {routes} — déclarez une route de repli (\'/*\') pour servir votre propre page 404.');
    if (mode === 'warn') { return µ.warn(msg); }
    µ.error(msg);
    return this._mjs_showNoMatch(matchPath);
  },
  _mjs_clearView: function(comp, targetId) {
    var targetNode = this._mjs_findView(comp, targetId);
    if (targetNode && targetNode.firstElementChild) {
      // Hibernation : l'élément reste dans le cache de vues et sera ré-inséré.
      // Sans ce flag, la destruction différée tirait (@destroy exécuté) puis
      // le cache ressuscitait un composant DÉTRUIT — onMount étant one-shot,
      // ses timers/abonnements n'étaient jamais relancés.
      this._mjs_hibernateView(comp, targetNode.firstElementChild);
      µ._mjs_logger()?.('      🚫 [Router] ' + µ._mjs_txt('routerLogViewCleared', { targetId: targetId }, 'Aucune route pour <@view {targetId}> — vue vidée.'));
      targetNode.textContent = '';
    }
  },
  // ne poser le flag
  // d'hibernation (exemption de destruction différée) QUE si l'élément est
  // ENCORE le titulaire de sa clé d'`instCache`. Évincé du LRU pendant qu'il
  // était affiché (une AUTRE vue du même composant a fait défiler >10 modules),
  // il n'est plus réinsérable : le flag le rendrait ORPHELIN (jamais réinséré
  // car cache-miss ⇒ élément neuf, jamais détruit car le flag l'exempte →
  // timers/abonnements de `@mount` fuyant à vie — exactement ce que le LRU
  // devait borner). Sans clé de route (élément hors instCache), comportement
  // historique.
  _mjs_hibernateView: function(comp, el) {
    if (!el) { return; }
    var instCache = this.cache.get(comp);
    if (el._mjs_route_key && instCache && instCache.get(el._mjs_route_key) !== el) {
      return; // évincé du cache : laisse la destruction différée normale opérer
    }
    el._mjs_page_cached = true;
  },
  // un layout que le cache de vues rend à la page revient avec les pages de l'adresse où on l'a quitté : celle qui n'est
  // plus la page de l'adresse sort de sa vue AVANT ce retour, hibernée comme à un remplacement — sinon, dans la page, elle
  // se réveillerait (`µawake`) avec les paramètres de l'adresse nouvelle avant que le routeur du layout ne la remplace ; ce
  // routeur pose la page de l'adresse à la connexion du layout, après son `µurlChange`. Une page restée la bonne est
  // gardée, et ses propres vues passent au même tri (layout dans le layout)
  _mjs_dropStaleViews: function(comp, matchPath) {
    var el, matched, paths, pi, routeMap, targetId, view;
    for (targetId in comp.routes) {
      view = this._mjs_findView(comp, targetId);
      el   = view && view.firstElementChild;
      if (!el) { continue; }
      routeMap = comp.routes[targetId];
      paths    = this._mjs_sortedPaths(routeMap);
      matched  = null;
      for (pi = 0; pi < paths.length && !matched; pi++) {
        if (this._mjs_matchRoute(matchPath, paths[pi]).ok) { matched = routeMap[paths[pi]]; }
      }
      if (matched && el.tagName.toLowerCase() === `mjs-${matched}`.toLowerCase()) {
        if (el.routes) { this._mjs_dropStaleViews(el, matchPath); }
        continue;
      }
      this._mjs_hibernateView(comp, el);
      // évincée du cache pendant qu'elle était affichée : elle ne reviendra plus, sa destruction (suspendue par
      // l'hibernation du layout) a lieu maintenant
      if (!el._mjs_page_cached && typeof µ._mjs_destroyEvictedTree === 'function') { µ._mjs_destroyEvictedTree(el); }
      view.textContent = '';
    }
  },
  // la page de l'adresse pour une vue du composant : posée, ou la vue vidée quand aucune route ne lui correspond ; rend vrai
  // quand une route lui correspond
  _mjs_injectTarget: function(comp, targetId, matchPath) {
    var matchedModule = null, paths, pi, routeMap = comp.routes[targetId], routePath;
    // Tri par SPÉCIFICITÉ : d'abord le plus de segments LITTÉRAUX, puis à
    // égalité la chaîne la plus longue. Sinon `/posts/:id` (plus long) masquait
    // `/posts/new` (littéral, pourtant le plus spécifique) ; et avant, l'ordre
    // d'insertion gagnait (`/a` déclaré avant `/a/b` captait `/a/b`, glouton).
    paths = this._mjs_sortedPaths(routeMap);
    for (pi = 0; pi < paths.length; pi++) {
      routePath = paths[pi];
      if (this._mjs_matchRoute(matchPath, routePath).ok) {
        matchedModule = routeMap[routePath];
        break;
      }
    }
    if (matchedModule) {
      µ._mjs_logger()?.('      🎯 ' + µ._mjs_txt('routerLogMatch', { routePath: routePath, module: matchedModule, targetId: targetId }, 'Match ! [{routePath}] -> Module [{module}] injecté dans <@view {targetId}>'));
      this._mjs_injectView(comp, targetId, matchedModule, matchPath);
      return true;
    }
    // Aucune route ne matche cette vue : on la VIDE — avant, l'ancien
    // module restait affiché sous une URL qui ne lui correspondait plus.
    this._mjs_clearView(comp, targetId);
    return false;
  },
  // la <@view> `targetId` d'un composant routé : dans son ombre, sinon dans le contenu qu'il reçoit (un layout qui la glisse
  // dans son `<slot>`)
  _mjs_findView: function(comp, targetId) {
    return (comp._shadow && comp._shadow.querySelector(`metamjs-view#${targetId}`)) || (comp.querySelector && comp.querySelector(`metamjs-view#${targetId}`));
  },
  // une <@view> qui paraît dans la page (le `{if}` qui la porte s'ouvre ; balise suivie par mjs_init.ts) sans page posée par le
  // routeur — vide, avec son contenu d'attente ou la page du serveur : le composant routé qui la trouve y montre la page de
  // l'adresse en cours, à part (microtâche), hors du rendu du bloc qui l'insère ; une vue servie entre-temps (premier
  // affichage) ou remise avec sa page (sous-arbre déplacé, layout rendu par le cache) la garde, reprise vivante
  _mjs_viewIn: function(view) {
    var self = this;
    queueMicrotask(function() {
      var comp, el = view.firstElementChild;
      if (!view.isConnected) { return; }
      if (el && el._mjs_route_key) { el._mjs_page_cached = false; return; }
      for (comp of self._mjs_awareComponents) {
        if (comp.routes && comp.routes[view.id] && self._mjs_findView(comp, view.id) === view) { self._mjs_injectTarget(comp, view.id, self._mjs_getMatchPath(window.location.href)); }
      }
    });
  },
  // la vue qui sort de la page (le `{if}` se referme) : sa page part en hibernation, comme à un remplacement, et revient avec
  // la vue sans second montage ; une page évincée du cache de vues suit la destruction ordinaire. La page que le serveur a
  // écrite (jamais posée par le routeur : sans clé de route) sort quand un `{if}` rebâtit sa branche à la reprise de la page :
  // gardée de même, elle attend la vue neuve qui la reprend telle quelle (_mjs_injectView), au plus jusqu'au contrôle qui suit
  // l'affichage (_mjs_scheduleNoMatchCheck) ; une page mise de côté avec tout ce qui la porte (cache des liens, layout
  // hiberné) reviendra avec lui, elle reste où elle est
  _mjs_viewOut: function(view) {
    var comp, el = view.firstElementChild;
    if (!el) { return; }
    if (!el._mjs_route_key) {
      if (el.tagName.slice(0, 4) === 'MJS-' && !µ._mjs_isPageCached?.(view)) { el._mjs_page_cached = true; this._mjs_ssrPages.set(view.id + '-' + el.tagName.slice(4).toLowerCase(), el); }
      return;
    }
    for (comp of this._mjs_awareComponents) {
      if (this.cache.get(comp)?.get(el._mjs_route_key) === el) { el._mjs_page_cached = true; }
    }
  },
  _mjs_injectView: function(comp, targetId, moduleName, matchPath) {
    var cacheKey, currentElement, el, expectedTagName, instCache, newComponent, targetNode;
    targetNode = this._mjs_findView(comp, targetId);
    // vue absente de la page (sous un `{if}` fermé) : rien à poser, l'adresse reste la route en cours, que la vue montrera
    // quand elle paraîtra (_mjs_viewIn)
    if (!targetNode) { return; }
    instCache = this.cache.get(comp);
    if (!instCache) {
      // `new Map()` SANS BORNE :
      // une session SPA longue durée qui affiche, l'un après l'autre dans le
      // MÊME <@view>, de nombreux composants routés DISTINCTS (navigation
      // libre, pas juste "10 pages" comme pageCache — ici CHAQUE combinaison
      // (targetId, moduleName) déjà vue) accumule un ARBRE DOM COMPLET
      // hiberné par entrée, POUR TOUJOURS — même dérive mémoire que
      // pageCache/_mjs_scrollPos/_mjs_preloadCache avant leur passage en LRU (cf.
      // mjs_ujs.ts). `µ._mjs_destroyEvictedTree` (mjs_page_cache.ts) mentionne DÉJÀ
      // explicitement "vues du routeur" dans son propre commentaire comme
      // consommateur visé — jamais câblé jusqu'ici. Fix : même bornage que
      // pageCache (10, portée comparable : un arbre DOM+composants complet
      // par entrée), même hook onEvict (relance les teardowns différés par
      // l'hibernation, sinon chaque timer posé en @mount d'une vue évincée
      // fuyait à vie).
      instCache = typeof µ.LRUCache === 'function' ? new µ.LRUCache(10) : new Map();
      if (typeof µ._mjs_destroyEvictedTree === 'function') {
        instCache.onEvict = function(_key, el) { µ._mjs_destroyEvictedTree(el); };
        // le composant détruit pour de bon (sorti de la page sans y être gardé : évincé du cache de son parent pendant
        // qu'il était affiché, un `{if}` qui se referme) : les pages hibernées dans ses vues, hors de son DOM, partent
        // avec lui ; le nettoyage se réinscrit, comme celui de µevery — remis dans la page, il garde son cache, vide, et
        // une destruction suivante le vide de même
        const purge = () => { instCache.clear(); comp._mjs_onDestroy(purge); };
        comp._mjs_onDestroy?.(purge);
      }
      this.cache.set(comp, instCache);
    }
    cacheKey = `${targetId}-${moduleName}`;
    expectedTagName = `mjs-${moduleName}`.toLowerCase();
    currentElement = targetNode.firstElementChild;
    if (currentElement && currentElement.tagName.toLowerCase() === expectedTagName) {
      // Même composant déjà affiché (`/posts/42` → `/posts/77`, même
      // <mjs-post-page>) : rien à re-poser. Les params vivent dans `µ.url.params`
      // (mis à jour par _mjs_updateUrlStore) → le composant se re-rend via sa
      // dépendance à `µ.url`. Plus d'injection d'attribut = zéro collision avec
      // un attribut natif `id`/`class`.
      // La page écrite par le serveur (sans clé de route) entre au cache de vues comme une page posée par le routeur : une
      // navigation la met en hibernation, le retour la rend avec son état, une éviction la détruit
      if (!currentElement._mjs_route_key && !instCache.has(cacheKey)) { currentElement._mjs_route_key = cacheKey; instCache.set(cacheKey, currentElement); }
      return;
    }
    // absente du cache : la page que le serveur a écrite pour cette vue, sortie quand un `{if}` a rebâti sa branche à la
    // reprise (_mjs_viewOut), reprise telle quelle ; sinon un élément neuf
    newComponent = instCache.has(cacheKey) ? (µ._mjs_logger()?.('      ⚡ [Router] ' + µ._mjs_txt('routerLogCacheHit', { tag: expectedTagName }, 'Restauration depuis le cache : <{tag}>')), instCache.get(cacheKey)) : (µ._mjs_logger()?.('      🏗️ [Router] ' + µ._mjs_txt('routerLogCreate', { tag: expectedTagName }, 'Création DOM : <{tag}>')), el = this._mjs_ssrPages.get(cacheKey) || document.createElement(expectedTagName), this._mjs_ssrPages.delete(cacheKey), el._mjs_route_key = cacheKey, instCache.set(cacheKey, el), el);
    // un composant dont le code n'est pas arrivé : la navigation l'attend (barre de navigation)
    if (typeof customElements !== 'undefined' && !customElements.get(expectedTagName) && this._mjs_navWaiting) { this._mjs_navWaiting.push(expectedTagName); }
    // un layout rendu par le cache : ce qui n'est plus la page de l'adresse sort de ses vues avant son retour dans la page
    if (newComponent.routes) { this._mjs_dropStaleViews(newComponent, matchPath); }
    // L'élément remplacé part en hibernation (il reste dans instCache) ;
    // celui qui revient en sort. Hibernation gardée — pas d'orphelin si
    // l'élément a été évincé du LRU pendant qu'il était affiché.
    if (currentElement) {
      this._mjs_hibernateView(comp, currentElement);
    }
    newComponent._mjs_page_cached = false;
    targetNode.textContent = '';
    // <routes-idle>
    // la page montée est demandée par le routeur lui-même, sans attendre le guetteur de l'ombre ; sans effet si elle est déjà en vol
    if (typeof customElements !== 'undefined' && !customElements.get(expectedTagName) && µ.Autoloader) { µ.Autoloader.load(expectedTagName); }
    // </routes-idle>
    return targetNode.appendChild(newComponent);
  },
  // (_applyRouteParams RETIRÉ : les params de route ne sont plus injectés en
  //  ATTRIBUTS DOM — fini la collision `:id` ↔ attribut natif `id`/`class`. On
  //  les lit via le sigil `&id` (≡ `µ.url.params.id`), maintenu par
  //  _mjs_updateUrlStore ; l'ancien `$id`-par-attribut n'existe plus.)
};

// <routes-idle>
// les pages d'une table de routes (réglage routes.preload, liste émise par le compilateur), préchargées une à la fois, chacune après
// l'attente commune des files du repos (µ._idle, mjs_autoloader.ts : après load, plus rien en vol, puis un repos), par un lien
// modulepreload : le fichier est téléchargé, jamais exécuté ici — rien ne se définit avant la visite, qui l'importe sans le
// redemander, même pendant son vol. Sautée : une page déjà définie, déjà en vol (visite, survol), déjà ratée (la visite suivante la
// redemande), absente du manifeste, ou qui importe un module ou porte un effet (µ.deps, publié par le manifeste) : celle-là part à
// sa visite, un préchargement coupé laisserait l'échec du module dans la table des modules du navigateur. Un échec ne dit rien et
// ne recharge rien : le navigateur garde l'échec à cette adresse, la visite redemande la page sous une adresse neuve
// (`?mjs-retry=<n>`, µ.Autoloader.load). Un layout monté plus tard range ses pages dans la file. Rien sur le serveur ni dans le
// navigateur de prérendu (µ.server) : la page s'y prend sans elles
µ._mjs_routesIdle = function(names) {
  var queue = µ._mjs_routesQ || (µ._mjs_routesQ = []), first = queue.length === 0 && !µ._mjs_routesRun, A = µ.Autoloader;
  names.forEach(function(n) { n = n.toLowerCase(); if (queue.indexOf(n) < 0) { queue.push(n); } });
  if (!first || queue.length === 0 || typeof window === 'undefined' || !A || !µ._idle || µ._isServer || µ.server === true) { return; }
  µ._mjs_routesRun = true;
  var skip = function(n) {
    var deps = µ.deps && Object.prototype.hasOwnProperty.call(µ.deps, n) ? µ.deps[n] : [];
    return customElements.get('mjs-' + n) || A.pendingComponents.has('mjs-' + n) || (A._mjs_failed && A._mjs_failed['mjs-' + n]) || !µ.pathOf(n) || deps.some(function(d) { return /[.]|^mjs_/.test(d); });
  };
  var next = function() {
    var n = queue.shift(), link;
    while (n && skip(n)) { n = queue.shift(); }
    if (!n) { µ._mjs_routesRun = false; return; }
    link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = µ.pathOf(n);
    // la page en vol : une visite partie pendant ce vol le partage, et redemande la page aussitôt s'il échoue (mjs_autoloader.ts)
    µ._mjs_routesPre = 'mjs-' + n;
    link.onload = function() { µ._mjs_routesPre = null; µ._idle(next); };
    link.onerror = function() { var f = A._mjs_failed = A._mjs_failed || {}; µ._mjs_routesPre = null; f['mjs-' + n] = (f['mjs-' + n] || 0) + 1; µ._idle(next); };
    document.head.appendChild(link);
  };
  µ._idle(next);
};
// </routes-idle>
// Boot : snapshot initial de `µ.url` dès le chargement du runtime. `µ.state`
// (défini dans mjs_runes, concaténé AVANT mjs_router) est déjà là ; les params
// restent vides tant qu'aucune vue routée n'a monté, puis complétés par
// `initComponent`.
if (typeof window !== 'undefined' && typeof µ.state === 'function') {
  µ.Router._mjs_canonicalizeUrl();
  µ.Router._mjs_updateUrlStore();
}
