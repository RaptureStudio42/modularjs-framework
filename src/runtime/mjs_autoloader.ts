// mjs_autoloader.coffee
µ.Autoloader = {
  pendingComponents: new Set(),
  // tags du manifeste (`mjs-<clé>`) pas encore définis dans
  // customElements. Ensemble VIDE ⇒ l'observer n'a plus rien à charger et
  // court-circuite en O(1), au lieu de sérialiser `outerHTML` pour CHAQUE
  // nœud inséré (poste caché majeur de create1k/runlots : 1000 tr insérés =
  // 1000 sérialisations). `µ.paths` est figé après le boot (émis une seule
  // fois dans le manifeste, jamais muté au runtime) → ce cache est sûr.
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
  _mjs_reloadOnStale: function(fileName, err) {
    var flagVal, stored;
    if (µ.config && µ.config.staleReload === false) {
      return false;
    }
    if (!(typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function')) {
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
  },
  load: async function(tag) {
    var err, fileName, path;
    tag = tag.toLowerCase();
    if (!customElements.get(tag) && !this.pendingComponents.has(tag)) {
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
      µ.log(`[Autoloader] 🚀 Downloading ${fileName} -> ${path}`);
      // ses effets partent en même temps que lui (il les importe aussi : même fichier, chargé une
      // fois) — sans attendre qu'il arrive pour les découvrir
      if (typeof µ._mjs_fxPrefetch === 'function') µ._mjs_fxPrefetch(fileName);
      try {
        // 3. Import dynamique via le chemin public haché absolu
        await import(path);
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
        // fichier de page désigné par une navigation interne et resté introuvable : le composant
        // retrouve son fichier séparé, une seule fois — celui que la navigation a gardé pour lui (clé
        // propre), jamais un chemin lu sur un prototype pollué
        if (µ._mjs_pagePrev && Object.prototype.hasOwnProperty.call(µ._mjs_pagePrev, fileName) && µ._mjs_pagePrev[fileName] != null && µ._mjs_pagePrev[fileName] !== µ.paths[fileName]) {
          µ.paths[fileName] = µ._mjs_pagePrev[fileName];
          this.pendingComponents.delete(tag);
          return this.load(tag);
        }
        µ.error(`[Autoloader] ❌ Failed to import ${fileName}:`, err);
        this._mjs_reloadOnStale(fileName, err);
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
    if (this._mjs_pending === null) {
      this._mjs_refreshPending();
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
