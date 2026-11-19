// mjs_autoloader.ts
µ.Autoloader = {
  pendingComponents: new Set(),
  // tags du manifeste (`mjs-<clé>`) pas encore définis dans
  // customElements. Ensemble VIDE ⇒ l'observer n'a plus rien à charger et
  // court-circuite en O(1), au lieu de sérialiser `outerHTML` pour CHAQUE
  // nœud inséré (poste caché majeur de create1k/runlots : 1000 tr insérés =
  // 1000 sérialisations). Les CLÉS de `µ.paths` sont figées après le boot (émises
  // une seule fois dans le manifeste) ; seules des valeurs changent au runtime (fichier
  // de page, adresse neuve après un préchargement raté au repos) → ce cache de balises est sûr.
  _mjs_pending: null,
  _mjs_pendingSel: '',
  _mjs_refreshPending: function() {
    var k, paths, tag;
    this._mjs_pending = new Set();
    paths = µ.paths;
    if (paths) {
      for (k in paths) {
        // `mjs_…` : un fichier d'effet (`mjs_fx_<nom>`), jamais une balise ; un nom hérité (prototype pollué) non plus : il
        // pourrait rendre faux le sélecteur des balises attendues
        if (k.slice(0, 4) === 'mjs_' || !Object.prototype.hasOwnProperty.call(paths, k)) continue;
        tag = 'mjs-' + k.toLowerCase();
        if (!customElements.get(tag)) {
          this._mjs_pending.add(tag);
        }
      }
    }
    this._mjs_pendingSel = this._mjs_pending.size ? Array.from(this._mjs_pending).join(',') : '';
    return this._mjs_pending;
  },
  // le bouclier du cœur (µ._mjs_shield, mjs_init.ts), règle 1 : `tag` ('mjs-carte'), une balise que ce chargeur va chercher —
  // cachée, elle et ce qu'elle contient, jusqu'à sa définition ; '*' à l'arrivée du chargeur, toute balise pas encore définie, le
  // temps qu'il ne sache pas encore lesquelles il va chercher (le manifeste pose `µ.paths` juste avant d'observer) — la balise
  // seule : happy-dom, où le rendu serveur fait tourner ce cœur, tient les balises natives pour non définies, et ` *` y cacherait
  // la page entière ; '' à la première observation, la règle de '*' s'en va. Une règle par balise, posée une fois, et seulement
  // pour les balises que la page charge : le moteur range les règles par nom de balise, mais chaque règle ` *` est essayée sur
  // chaque élément restylé. Une balise hors du manifeste (autre bibliothèque, nom mal écrit) n'est jamais touchée
  _mjs_shieldTags: new Set(),
  _mjs_shieldTag: function(tag) {
    var s = (tag === '*' ? '' : tag) + ':not(:defined):not([mjs-ssr]):not([mjs-skel-host])', i;
    if (tag) {
      if (this._mjs_shieldTags.has(tag)) { return; }
      this._mjs_shieldTags.add(tag);
    }
    // la même règle dans la feuille des ombres et dans celle de la page (µ._mjs_shield, µ._mjs_shieldDoc, mjs_init.ts)
    [µ._mjs_shield, µ._mjs_shieldDoc].forEach(function(f) {
      if (!f) { return; }
      if (!tag) {
        for (i = f.cssRules.length - 1; i >= 0; i--) { if (f.cssRules[i].selectorText.indexOf(':not(:defined)') === 0) { f.deleteRule(i); } }
        return;
      }
      // un nom que le moteur refuse (caractère hors des sélecteurs CSS) : la balise se montre telle quelle, le chargement continue
      try { f.insertRule(s + (tag === '*' ? '' : ',' + s + ' *') + '{visibility:hidden!important;transition:none!important}', 0); }
      catch { /* balise montrée telle quelle */ }
    });
  },
  _mjs_drop: function(tag) {
    // un tag vient d'être défini : le retirer + reconstruire le sélecteur ciblé
    if (this._mjs_pending && this._mjs_pending.delete(tag)) {
      this._mjs_pendingSel = this._mjs_pending.size ? Array.from(this._mjs_pending).join(',') : '';
    }
  },
  // GARDE « BUNDLE PÉRIMÉ » — writeHashed() (bundler) supprime physiquement les anciens
  // fichiers hachés à CHAQUE rebuild. Un onglet ouvert AVANT un rebuild/déploiement garde un
  // µ.paths qui pointe un hash disparu : le prochain import() d'un composant à la demande prend un
  // 404 (le serveur répond du text/html, le navigateur refuse de l'exécuter comme module) et load()
  // atterrit dans son catch, plus bas — X-MJS-Version ne couvre QUE les navigations, jamais un
  // import de module. Un SEUL rechargement par build : la clé sessionStorage stocke la VERSION DE
  // BUILD (pas un simple booléen) — après reload le client sert le NOUVEAU build donc un nouveau
  // µ.version, le drapeau du build précédent ne correspond plus et une future péremption pourra de
  // nouveau recharger ; dans un MÊME build, jamais deux fois, ce qui borne la boucle. Le try/catch
  // sur sessionStorage DÉSARME la garde (navigation privée Safari, harnais sans sessionStorage,
  // window absent) au lieu de la forcer : mieux vaut une page muette qu'une boucle de rechargement.
  // Opt-out : µ.config.staleReload = false.
  // LA PREUVE VIENT DU SERVEUR, JAMAIS DE L'ÉCHEC : Safari refuse tout fichier demandé pendant que la page s'en va (lien,
  // barre d'adresse), Firefox et Safari coupent ceux qui sont en route au départ, une connexion qui tombe échoue de même — un
  // rechargement remplaçait alors la navigation du visiteur. Le fichier est redemandé (`path`, sans cache) : seul un serveur
  // qui RÉPOND sans module JavaScript (404, page HTML de repli) dit le bundle périmé ; pas de réponse, pas de rechargement. Et
  // jamais après un départ annoncé (µ._mjs_left, mjs_init.ts), quel que soit le temps que met la page suivante. Rend la
  // promesse du verdict (true : rechargement lancé)
  _mjs_reloadOnStale: function(fileName, err, path) {
    if ((µ.config && µ.config.staleReload === false) || !(typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') || typeof fetch !== 'function') {
      return Promise.resolve(false);
    }
    return (µ._mjs_loading ? µ._mjs_loading(fetch(path, { cache: 'no-store' })) : fetch(path, { cache: 'no-store' })).then((r) => {
      var flagVal, stored;
      if ((r.ok && /javascript|ecmascript/i.test(r.headers.get('content-type') || '')) || (µ._mjs_left && µ._mjs_left())) {
        return false;
      }
      flagVal = µ.version || '1';
      try {
        stored = sessionStorage.getItem('mjs-stale-reload');
        if (stored === flagVal) {
          return false;
        }
        sessionStorage.setItem('mjs-stale-reload', flagVal);
      } catch {
        return false;
      }
      µ.warn('[Autoloader] ' + µ._mjs_txt('autoloaderStale', { fileName: fileName }, 'bundle périmé : \'{fileName}\' introuvable — rechargement de la page (une seule fois par build).'));
      window.location.reload();
      return true;
    }, () => false);
  },
  load: async function(tag) {
    var err, fileName, path;
    tag = tag.toLowerCase();
    if (!customElements.get(tag) && !this.pendingComponents.has(tag)) {
      // <routes-idle>
      // ratée pendant l'attente de la navigation en cours : ni le montage de la page ni le guetteur ne la redemandent, la visite
      // suivante le fera (un essai par visite, mjs_router.ts)
      if (this._mjs_failedKey && this._mjs_failedKey[tag] != null && µ.Router && this._mjs_failedKey[tag] === µ.Router._mjs_navWaitKey) { return; }
      // </routes-idle>
      this.pendingComponents.add(tag);
      fileName = tag.replace('mjs-', '');
      // 1. Interrogation du dictionnaire de hachage (Manifest) : le chemin entier se lit par
      // µ.pathOf, qui recolle le préfixe et, table compacte, le nom du fichier (cf. plus bas).
      path = µ.pathOf(fileName);
      // 2. Rejet immédiat si le composant n'est pas répertorié
      if (!path) {
        µ.error('[Autoloader] ' + µ._mjs_txt('autoloaderRejected', { fileName: fileName }, '❌ Rejet : Composant \'{fileName}\' absent du manifeste de distribution.'));
        this.pendingComponents.delete(tag);
        this._mjs_giveUp(tag);
        return;
      }
      // <routes-idle>
      // un import raté reste raté à la même adresse (le navigateur garde l'échec, Chromium, Firefox et WebKit) : après un échec, le
      // fichier est redemandé sous une adresse neuve, une par échec ; le premier essai n'a rien évalué, aucun double n'est possible
      if (this._mjs_failed && this._mjs_failed[tag]) { path += (path.indexOf('?') < 0 ? '?' : '&') + 'mjs-retry=' + this._mjs_failed[tag]; }
      // la page est préchargée au repos en ce moment (µ._mjs_routesIdle, mjs_router.ts) : cet import partage son vol
      var pre = µ._mjs_routesPre === tag;
      // </routes-idle>
      // la balise, et tout ce qu'elle contient, reste cachée jusqu'à sa définition (cf. _mjs_shieldTag)
      this._mjs_shieldTag(tag);
      µ.log(`[Autoloader] 🚀 Downloading ${fileName} -> ${path}`);
      // ses effets partent en même temps que lui (il les importe aussi : même fichier, chargé une
      // fois) — sans attendre qu'il arrive pour les découvrir
      if (typeof µ._mjs_fxPrefetch === 'function') µ._mjs_fxPrefetch(fileName);
      try {
        // 3. Import dynamique via le chemin public haché absolu, suivi tant qu'il est en vol (départ de la page : cf.
        // µ._mjs_loading, mjs_init.ts)
        await (µ._mjs_loading ? µ._mjs_loading(import(path)) : import(path));
        // un composant de la page préparée par le serveur est défini plus tard, d'un seul geste avec les autres (cf. _mjs_launch) : son
        // module est arrivé et sa définition retenue, il reste en attente jusque-là
        if (this._mjs_wave && this._mjs_wave.held.has(tag)) {
          return µ.log(`⚙️ ES6 Module instantiated: ${fileName}`);
        }
        // `pendingComponents` n'était
        // JAMAIS purgé sur CE chemin (import réussi) — seuls les 2 chemins
        // d'ÉCHEC ci-dessous/au-dessus le faisaient. Un import qui RÉUSSIT
        // mais dont le module ne fait PAS `customElements.define(tag)` (bug
        // de config du composant, mauvais tag) laissait le tag COINCÉ dans ce
        // Set à VIE : `load(tag)` exige `!customElements.get(tag) &&
        // !pendingComponents.has(tag)` — avec `get(tag)` toujours undefined
        // ET `pendingComponents.has(tag)` toujours true, cette condition ne
        // redevient JAMAIS vraie → plus AUCUNE tentative de rechargement,
        // SILENCIEUSEMENT (contrairement aux 2 autres échecs, qui logguent
        // via µ.error). Purger inconditionnellement + avertir si le module a
        // fini d'importer sans jamais enregistrer le tag attendu.
        this.pendingComponents.delete(tag);
        if (!customElements.get(tag)) {
          µ.error('[Autoloader] ' + µ._mjs_txt('autoloaderNotRegistered', { fileName: fileName, tag: tag }, '❌ Import de \'{fileName}\' réussi mais <{tag}> n\'a jamais été enregistré (customElements.define manquant dans le module ?).'));
          this._mjs_giveUp(tag);
        } else {
          // tag désormais défini : le retirer des tags en attente.
          this._mjs_drop(tag);
        }
        return µ.log(`⚙️ ES6 Module instantiated: ${fileName}`);
      } catch (error) {
        err = error;
        // <routes-idle>
        this._mjs_failed = this._mjs_failed || {};
        this._mjs_failed[tag] = (this._mjs_failed[tag] || 0) + 1;
        // le préchargement partagé a échoué : la page est redemandée aussitôt, sous une adresse neuve, comme une visite, une fois
        if (pre) { µ._mjs_routesPre = null; this.pendingComponents.delete(tag); return this.load(tag); }
        // </routes-idle>
        // fichier de page désigné par une navigation interne et resté introuvable : le composant
        // retrouve son fichier séparé, une seule fois — celui que la navigation a gardé pour lui (clé
        // propre), jamais un chemin lu sur un prototype pollué
        if (µ._mjs_pagePrev && Object.prototype.hasOwnProperty.call(µ._mjs_pagePrev, fileName) && µ._mjs_pagePrev[fileName] != null && µ._mjs_pagePrev[fileName] !== µ.paths[fileName]) {
          µ.paths[fileName] = µ._mjs_pagePrev[fileName];
          this.pendingComponents.delete(tag);
          return this.load(tag);
        }
        // un import coupé par le départ de la page n'est ni une panne ni un bundle périmé : rien n'est dit, rien n'est rechargé
        // (un rechargement remplaçait la navigation du visiteur) — cf. µ._mjs_loadFailed, mjs_init.ts ; le bundle ne se dit périmé
        // que sur la réponse du serveur (cf. _mjs_reloadOnStale)
        // <routes-idle>
        // échec d'une visite, pendant l'attente de sa navigation : retenu avec elle (cf. plus haut) ; un essai au repos ne compte pas
        this._mjs_failedKey = this._mjs_failedKey || {};
        this._mjs_failedKey[tag] = µ.Router && µ.Router._mjs_navWait ? µ.Router._mjs_navWaitKey : null;
        // </routes-idle>
        var report = () => {
          µ.error(`[Autoloader] ❌ Failed to import ${fileName}:`, err);
          this._mjs_reloadOnStale(fileName, err, path);
        };
        µ._mjs_loadFailed ? µ._mjs_loadFailed(err, report) : report();
        this._mjs_giveUp(tag);
        return this.pendingComponents.delete(tag);
      }
    }
  },
  // un composant qui n'arrivera pas : la navigation du routeur qui l'attendait est finie (barre de
  // navigation, mjs_nav_progress.ts) — la faute est dite en console. Un composant qu'elle n'attend pas
  // (chargé hors d'elle, pendant une navigation de page de mjs_ujs.ts) ne l'arrête pas
  _mjs_giveUp: function(tag) {
    var r       = µ.Router;
    var awaited = !!r && ((r._mjs_navWaiting && r._mjs_navWaiting.indexOf(tag) >= 0) || (r._mjs_navTags && r._mjs_navTags.indexOf(tag) >= 0));
    if (awaited && typeof µ._mjs_navProgressStop === 'function') { µ._mjs_navProgressStop(); }
  },
  // plafond de l'attente d'une page préparée (ms) : ses fichiers sont demandés tous ensemble, ils arrivent à quelques dizaines de ms d'écart
  // sur un bon réseau, quelques centaines sur un réseau mobile lent ; la page reste affichée pendant l'attente mais ne répond pas au clic,
  // un fichier perdu ne doit donc pas la retenir au-delà d'une demi-seconde. Un fichier qui échoue, lui, ne fait pas attendre du tout
  _mjs_pageWait: 500,
  // ce que le serveur a écrit dans `node` (ombre déclarative ouverte ; sans ombre, les enfants d'un composant léger, que l'attribut `mjs-light`
  // le dise ou non : un léger déclaré par sa classe seule n'a pas cet attribut), rangé par composant préparé dans `photos` : les composants
  // dont le fichier n'est pas encore là qu'il affiche (toutes ses occurrences réunies), puis, de proche en proche, ceux de la photo de chacun d'eux
  _mjs_photo: function(node, photos) {
    var tag, kids, root = node.shadowRoot || (node.hasAttribute('mjs-ssr') ? node : null);
    if (!root || !node.tagName.startsWith('MJS-')) { return; }
    tag  = node.tagName.toLowerCase();
    kids = photos[tag] || (photos[tag] = new Set());
    root.querySelectorAll(':not(:defined)').forEach((el) => {
      if (el.tagName.startsWith('MJS-')) {
        kids.add(el.tagName.toLowerCase());
        this._mjs_photo(el, photos);
      }
    });
  },
  // les composants de `photos`, clés et valeurs, chacun avant ceux que sa photo affiche, les frères dans l'ordre de la page (parcours en
  // profondeur à rebours, remis à l'endroit). Deux composants qui se contiennent ne s'attendent pas : le second parcouru passe après le premier
  _mjs_order: function(photos) {
    var out = [], seen = {}, visit = (tag) => {
      if (seen[tag]) { return; }
      seen[tag] = true;
      if (photos[tag]) { Array.from(photos[tag]).reverse().forEach(visit); }
      out.push(tag);
    };
    Object.keys(photos).reverse().forEach(visit);
    return out.reverse();
  },
  // la promesse qui se tient jusqu'à ce que le fichier de chacun des composants `tags` soit arrivé ou ait échoué, ou jusqu'au plafond
  _mjs_settle: function(tags) {
    return new Promise((done) => {
      var timer = setTimeout(done, this._mjs_pageWait), end = () => { clearTimeout(timer); done(); };
      Promise.all(tags.map((tag) => this.load(tag))).then(end, end);
    });
  },
  // la page préparée par le serveur, dans `nodes` (les balises `mjs-*` pas encore définies de la racine observée) : tous ses composants partent
  // ensemble — leurs fichiers sont demandés d'un coup — et aucun ne prend la main avant que le dernier fichier soit arrivé, ou que le plafond
  // soit atteint. Leurs balises sont alors définies d'un seul geste, du parent vers les enfants : pas une image entre elles.
  // Chaque composant jette sa photo au premier rendu pour bâtir la sienne. Un enfant qui prendrait la main seul, avant son parent, s'afficherait
  // avec ses réglages par défaut (le serveur n'écrit pas dans la page ceux que le parent lui passe), puis le parent le redessinerait ; un
  // parent qui la prendrait seul, avant ses enfants, laisserait son sous-bloc manquer à l'écran le temps que son fichier arrive. Le parent
  // défini le premier bâtit sa vue, et les enfants qu'elle contient sont mis à niveau dans la foulée, avec leurs réglages.
  // Les modules s'exécutent à mesure qu'ils arrivent, mais leur enregistrement de balise (`µ._def`, `µ._al`) est retenu jusqu'au départ : seules
  // les balises de la page sont retenues, les autres se définissent comme toujours. Rend l'ensemble des balises parties ensemble, ou rien
  // quand la page n'a rien de préparé à charger ; les autres balises de `nodes` se chargent chacune de leur côté
  _mjs_launch: function(nodes) {
    var photos = {}, tags, wave, def = µ._def, al = µ._al, keep;
    if (typeof def !== 'function') { return null; }
    nodes.forEach((node) => { this._mjs_photo(node, photos); });
    tags = this._mjs_order(photos).filter((tag) => this._mjs_pending.has(tag) && !this.pendingComponents.has(tag));
    if (!tags.length) { return null; }
    wave = this._mjs_wave = { tags: new Set(tags), held: new Map() };
    keep = (tag, run) => {
      if (!wave.held.has(tag)) { wave.held.set(tag, []); }
      wave.held.get(tag).push(run);
    };
    µ._def = function(tag, C) {
      if (wave.tags.has(tag)) { keep(tag, () => def.call(µ, tag, C)); } else { def.call(µ, tag, C); }
    };
    if (typeof al === 'function') {
      µ._al = function(tag, key, C) {
        if (wave.tags.has(tag)) { keep(tag, () => al.call(µ, tag, key, C)); } else { al.call(µ, tag, key, C); }
      };
    }
    this._mjs_settle(tags).then(() => {
      // le départ : le cœur reprend ses fonctions, puis les balises retenues sont définies dans l'ordre de la page, sans rendre la main entre deux
      µ._def = def;
      if (typeof al === 'function') { µ._al = al; }
      this._mjs_wave = null;
      wave.tags.forEach((tag) => {
        var runs = wave.held.get(tag);
        if (!runs) { return; }
        try {
          runs.forEach((run) => { run(); });
        } catch (err) {
          µ.error(`[Autoloader] ❌ Failed to import ${tag.replace('mjs-', '')}:`, err);
          this._mjs_giveUp(tag);
        }
        this.pendingComponents.delete(tag);
        this._mjs_drop(tag);
      });
    });
    return wave.tags;
  },
  // la silhouette d'une balise en attente (`"effects": { "skeleton": [..., "components"] }`) : cf.
  // µ._mjs_skelShow, mjs_fx_skeleton.ts
  _mjs_skel: function(node) {
    var c = µ._fxConf && µ._fxConf.skeleton;
    if (c && c.indexOf('components') >= 0 && µ._mjs_skelShow) µ._mjs_skelShow(node);
  },
  observe: function(root) {
    var nodes, observer, launched = null;
    // <wake-up>
    // la page d'une instance qui attend son réveil n'est observée qu'à son réveil (`@wake`, mjs_wake.ts)
    if (µ._mjs_wakeLater?.(root)) { return; }
    // </wake-up>
    // <early-loader>
    // un composant compilé à part qui démarre avant le manifeste fait observer son ombre avant `µ.paths`, ses enfants ne se chargeraient
    // jamais : sa racine est gardée puis relue au départ du chargeur, aucun parcours de la page n'atteignant l'ombre fermée d'un élément
    // ordinaire ; par une référence faible, la liste se resserrant quand la moitié en est ramassée : une page sans manifeste ne retient rien
    // (un navigateur sans WeakRef ni FinalizationRegistry garde la racine elle-même, sans resserrer la liste)
    if (!µ.paths) {
      var roots = µ._mjs_early;
      if (!roots) {
        roots      = µ._mjs_early = [];
        roots.dead = 0;
        roots.gone = typeof FinalizationRegistry === 'function' && new FinalizationRegistry(() => {
          if (++roots.dead * 2 < roots.length) { return; }
          var live = 0;
          roots.forEach((w) => { if (w.deref()) { roots[live++] = w; } });
          roots.length = live;
          roots.dead   = 0;
        });
      }
      roots.push(typeof WeakRef === 'function' ? new WeakRef(root) : { deref: () => root });
      if (roots.gone) { roots.gone.register(root, 0); }
    }
    else if (µ._mjs_early) {
      var early    = µ._mjs_early;
      µ._mjs_early = null;
      this._mjs_refreshPending();
      early.forEach((w) => w.deref()?.querySelectorAll(':not(:defined)').forEach((k) => {
        if (k.tagName.startsWith('MJS-')) {
          this._mjs_skel(k);
          this.load(k.tagName);
        }
      }));
    }
    // </early-loader>
    if (this._mjs_pending === null) {
      this._mjs_refreshPending();
      // le chargeur sait désormais quelles balises il va chercher : le bouclier du cœur ne cache plus qu'elles (cf. load), plus
      // toute balise pas encore définie (cf. _mjs_shieldTag)
      this._mjs_shieldTag('');
    }
    nodes = root.querySelectorAll(':not(:defined)');
    // la page préparée par le serveur d'abord, si une autre n'est pas déjà en route : ses composants partent ensemble (cf. _mjs_launch),
    // les autres se chargent chacun de leur côté
    if (nodes.length && !this._mjs_wave) {
      launched = this._mjs_launch(nodes);
    }
    nodes.forEach((node) => {
      if (node.tagName && node.tagName.startsWith('MJS-')) {
        this._mjs_skel(node);
        if (!launched || !launched.has(node.tagName.toLowerCase())) {
          return this.load(node.tagName);
        }
      }
    });
    observer = new MutationObserver((mutations) => {
      // no-op quand plus AUCUN tag du manifeste n'est en attente : on
      // n'inspecte même pas les nœuds insérés (0 outerHTML, 0 querySelector).
      // Cas du banc : `mjs-main` défini au boot ⇒ chaque insertion de rows
      // suivante court-circuite ici sans coût.
      if (this._mjs_pending.size === 0) {
        return;
      }
      return mutations.forEach((m) => {
        return m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.tagName.startsWith('MJS-')) {
              this._mjs_skel(node);
              this.load(node.tagName);
            }
            if (node.querySelectorAll && node.firstElementChild && this._mjs_pendingSel) {
              // querySelector natif ciblé sur les SEULS tags encore en
              // attente (early-exit natif dans le moteur DOM) au lieu de
              // `outerHTML.indexOf('<mjs-')` qui sérialisait tout le sous-arbre
              // inséré (O(taille HTML) par nœud, × chaque row).
              var pending = node.querySelectorAll(this._mjs_pendingSel);
              if (pending.length) {
                pending.forEach((child) => {
                  if (child.tagName && child.tagName.startsWith('MJS-')) {
                    this._mjs_skel(child);
                    this.load(child.tagName);
                  }
                });
              }
            }
          }
        });
      });
    });
    return observer.observe(root, {
      childList: true,
      subtree: true
    });
  }
};

// le bouclier du cœur, du démarrage à la première observation : toute balise pas encore définie — le chargeur ne sait pas encore
// lesquelles il va chercher (cf. _mjs_shieldTag)
µ.Autoloader._mjs_shieldTag('*');

// chemin entier du fichier d'une clé de `µ.paths` (préfixe commun `µ.pathsPrefix` recollé), '' si la clé
// est inconnue. UNE seule lecture pour tout le cœur (Autoloader, fichiers d'effets) : quand la table est
// compacte, le manifeste remplace cette fonction par son décodeur (cf. writeManifest, `µPath`). Seule une
// clé propre de la table, et seule une chaîne, est un chemin, comme dans ce décodeur : un nom hérité
// d'`Object.prototype` (`<mjs-constructor>`, `<mjs-__proto__>`, ou un nom posé par un prototype pollué) est
// inconnu, jamais le texte d'une fonction native ni une adresse que le chargeur importerait
µ.pathOf = function(name) {
  var v = µ.paths && Object.prototype.hasOwnProperty.call(µ.paths, name) ? µ.paths[name] : null;
  return v && typeof v === 'string' ? (µ.pathsPrefix || '') + v : '';
};

// <idle>
// l'attente commune des deux files du repos — pages d'une table de routes (µ._mjs_routesIdle, mjs_router.ts), composants écrits
// seulement sous un `{if}` fermé (`µIdle` du manifeste) : `f` part après l'événement load de la fenêtre, quand ce chargeur n'a plus
// rien en route et qu'aucune demande de MJS n'est en vol (µ._mjs_busy : µ.ajax, µload, navigation par les liens, mjs_ajax.ts),
// puis au repos (requestIdleCallback, 2 s au plus ; setTimeout à défaut). Plafond : 10 s après le premier passage qui suit load,
// plus rien en vol n'est attendu — une demande qui ne finit jamais ne retient pas les files pour toujours
// nom sans `_mjs_` : le manifeste, qui n'est pas raccourci comme le cœur, l'appelle par ce nom
var _mjsRestEnd = 0;
µ._idle = function(f) {
  var go = function() {
    _mjsRestEnd = _mjsRestEnd || Date.now() + 10000;
    if ((µ.Autoloader.pendingComponents.size || µ._mjs_busy) && Date.now() < _mjsRestEnd) { return setTimeout(go, 100); }
    window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 200);
  };
  document.readyState === 'complete' ? go() : window.addEventListener('load', go, { once: true });
};
// </idle>
