// mjs_debug.coffee
var originalConnected, originalDisconnected, originalRunEffects;

µ.debugMode = false;

µ.instances = new Set();

// 4. Avertissements du développement (ce fichier ne part jamais en production : ni ce code, ni le texte du groupe `dev`)
// - une prop que le parent livre à sens unique (`dialog={$dialog}`) et que l'enfant écrit ensuite lui-même : le parent garde sa propre
//   valeur, un `{if}` qui la lit ne bouge pas. Le code de développement du parent note chaque livraison (`µ._mjs_oneWay`, cf.
//   generator/attributes) ; l'enfant écrit son état par `µ._set`. Une livraison faite avant la définition de l'enfant (registre
//   `µ._mjs_pend`) ne compte qu'une fois versée, à sa connexion : le défaut que le script de l'enfant pose à sa construction vient avant
//   toute valeur du parent et n'est jamais dit. Rien pour une prop liée à deux sens (`_mjs_binds`) ni pour une écriture qui ne change rien
//   (une liste copiée aux mêmes éléments compte pour rien : la remise à zéro d'un formulaire rend ainsi les cases de départ d'un module cœur),
//   ni quand la balise porte un gestionnaire d'événement (`@change={…}` : le parent suit par l'événement, le compilateur ne note rien). Dit
//   une fois par composant et par nom, sous la balise telle que l'auteur l'écrit (`<@@select>`, `<@fenetre>`)
// - une attache (`@attach`) qui rend autre chose qu'une fonction ou que rien : la valeur est ignorée, ce n'est pas un nettoyage. Dit une
//   fois par composant, balise et ligne, sous les balises telles que l'auteur les écrit
// recues : élément → { prop: 1 } (versée dans l'état), ou 2 (en attente de la mise à niveau de l'enfant)
var _mjsRecues = new WeakMap();
var _mjsDejaDit = Object.create(null);

function _mjsUneFois(cle) {
  if (_mjsDejaDit[cle]) return false;
  _mjsDejaDit[cle] = 1;
  return true;
}

// `mjs-core-select` → `@@select` (module cœur), `mjs-fenetre` → `@fenetre` (composant du projet)
function _mjsBaliseEcrite(nom) {
  return nom.indexOf('mjs-core-') === 0 ? '@@' + nom.slice(9) : nom.indexOf('mjs-') === 0 ? '@' + nom.slice(4) : nom;
}

// deux listes aux mêmes éléments, dans le même ordre (`liste.slice()`) : l'écriture de l'une à la place de l'autre ne change rien
function _mjsMemeListe(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function _mjsRecuesVersees(el) {
  var r = _mjsRecues.get(el);
  if (!r) return;
  for (var k in r) {
    if (r[k] === 2) r[k] = 1;
  }
}

µ._mjs_oneWay = function(el, k) {
  var r = _mjsRecues.get(el);
  if (!r) {
    r = Object.create(null);
    _mjsRecues.set(el, r);
  }
  r[k] = typeof el._set === 'function' ? 1 : 2;
};

var _mjsSetPropre = µ._set;
µ._set = function(el, k, v) {
  var r = _mjsRecues.get(el);
  if (r && r[k] === 1 && !(el._mjs_binds && el._mjs_binds.has(k)) && el._state && el._state[k] !== v && !_mjsMemeListe(el._state[k], v) && _mjsUneFois('p ' + el.localName + ' ' + k)) {
    µ.warn(µ._mjs_msg('dev.propOneWay', { tag: _mjsBaliseEcrite(el.localName), prop: k }, '<{tag}> écrit sa prop « {prop} » : cette valeur vient du parent ; liez-la par !{…} ou envoyez un événement. Le parent garde sa propre valeur, il ne voit pas ce changement.'));
  }
  return _mjsSetPropre(el, k, v);
};

µ._mjs_attachNotFn = function(el, node, v, line) {
  var tag = (el && el.localName) || '?';
  var nom = (node && node.localName) || '?';
  if (!_mjsUneFois('a ' + tag + ' ' + nom + ' ' + line)) return;
  µ.warn(µ._mjs_msg('dev.attachNotFn', { tag: _mjsBaliseEcrite(tag), node: _mjsBaliseEcrite(nom), line: line, type: typeof v }, '<{tag}> : l\'@attach de <{node}> (ligne {line}) a rendu une valeur de type {type}, pas une fonction : elle est ignorée. Rendez une fonction de nettoyage, appelée quand la balise disparaît, ou rien.'));
};

if (µ.debug) console.log("🧪 [ModularJS] Introspection module armed. Type 'µ.debugMode = true' for visual telemetry.");

if (µ.Element) {
  // 1. Global Registry (Tracks births and deaths)
  originalConnected = µ.Element.prototype.connectedCallback;
  µ.Element.prototype.connectedCallback = function() {
    // un miroir (µclone, copies de *marquee) est une instance : il entre au registre comme les autres
    µ.instances.add(this);
    if (originalConnected) {
      var ret = originalConnected.apply(this, arguments);
      _mjsRecuesVersees(this);
      return ret;
    }
  };
  originalDisconnected = µ.Element.prototype.disconnectedCallback;
  µ.Element.prototype.disconnectedCallback = function() {
    µ.instances.delete(this);
    if (originalDisconnected) {
      return originalDisconnected.apply(this, arguments);
    }
  };
  // 2. Visual Telemetry (Render highlighting)
  // V2 : la méthode vivante est `_mjs_runEffectsV2` (`_runEffects` legacy retirée)
  // — sans cette migration, originalRunEffects était undefined et le wrapper
  // aurait posé un _runEffects mort.
  originalRunEffects = µ.Element.prototype._mjs_runEffectsV2;
  µ.Element.prototype._mjs_runEffectsV2 = function(d, full) {
    var el = this;
    if (µ.debugMode && !this._mjs_has_crashed) {
      // le style du composant n'est lu qu'au premier rendu d'un clignotement : un 2e rendu rapproché ne prend pas le
      // vert pour l'original ; un seul minuteur par composant, réarmé à chaque rendu
      if (!el._mjs_dbgPrev) el._mjs_dbgPrev = { outline: el.style.outline, transition: el.style.transition };
      clearTimeout(el._mjs_dbgTimer);
      el.style.transition = 'none';
      el.style.outline = '2px solid rgba(0, 255, 0, 0.9)';
      el._mjs_dbgTimer = setTimeout(() => {
        el.style.transition = 'outline 0.3s ease-out';
        el.style.outline = el._mjs_dbgPrev.outline;
        el._mjs_dbgTimer = setTimeout(() => {
          el.style.transition = el._mjs_dbgPrev.transition;
          el._mjs_dbgPrev = null;
        }, 300);
      }, 50);
    }
    return originalRunEffects.call(this, d, full);
  };
}

// 3. Custom Chrome Formatters — push (pas d'écrasement : d'autres libs
// — immutable.js, etc. — posent aussi leurs formatters).
(window.devtoolsFormatters || (window.devtoolsFormatters = [])).push(
  {
    header: function(obj) {
      var ref;
      if (obj instanceof HTMLElement && ((ref = obj.tagName) != null ? ref.startsWith('MJS-') : void 0)) {
        return [
          "div",
          {
            style: "color: #e36209; font-weight: bold; background: #fff0f0; padding: 2px 5px; border-radius: 3px;"
          },
          `<${obj.tagName.toLowerCase()}>`
        ];
      }
      return null;
    },
    hasBody: function() {
      return true;
    },
    body: function(obj) {
      return [
        "div",
        {
          style: "padding: 5px 0 5px 20px; background: #f8f9fa; border-left: 3px solid #e36209;"
        },
        [
          "div",
          {},
          [
            "span",
            {
              style: "color: #6f42c1; font-weight: bold;"
            },
            "🧠 Reactive State (@_state): "
          ],
          [
            "object",
            {
              object: obj._state
            }
          ]
        ],
        [
          "div",
          {},
          [
            "span",
            {
              style: "color: #005cc5; font-weight: bold;"
            },
            "🏷️ DOM Nodes (@_mjs_nodes): "
          ],
          [
            "object",
            {
              object: obj._mjs_nodes
            }
          ]
        ],
        [
          "div",
          {},
          [
            "span",
            {
              style: "color: #22863a; font-weight: bold;"
            },
            "🧩 Props & Masks (@_mjs_var_bits): "
          ],
          [
            "object",
            {
              object: obj._mjs_var_bits
            }
          ]
        ]
      ];
    }
  }
);
