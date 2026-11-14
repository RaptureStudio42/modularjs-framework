// mjs_hotswap — rechargement à chaud des composants (µ._hotSwap), développement seulement.
//
// N'EST PAS DANS LE BUNDLE DE PRODUCTION : même règle que mjs_hotcss (cf. bundler/index.ts, bundleRuntime()) — seul le client
// de rechargement de `mjs dev` (server/hmr.ts) appelle `µ._hotSwap`, sur un message 'hot-update' : un recompile où seuls des
// composants déjà connus ont changé, sans changer de nature (crochets de vie, règles des variables, slots), dont le script tient dans
// la liste blanche du bundler (premier tri, cf. hotScriptFacts, bundler/transpile-msg.ts) et dont les variables gardent leur valeur de
// départ (bundler, CompileStats.hot). Le dernier mot revient à la page : la GARDE de chaque instance (cf. _mjsHotEcrit) et la veille
// des plantages pendant l'échange. Inséré après mjs_debug, dont il lit le registre des instances vivantes (`µ.instances`). Un échange
// à la fois, dans l'ordre des messages.
//
// Un élément personnalisé ne se redéfinit pas (`customElements.define` deux fois est refusé). En développement, chaque balise est
// donc enregistrée sous une COQUILLE, `class extends C {}` (la balise courte d'un alias en est déjà une, mjs_alias.ts) : un
// rechargement fait pointer la coquille et son prototype vers la nouvelle classe — les instances à venir sont construites par
// le nouveau code. Les instances vivantes se redessinent en place, le même élément gardé (le parent, la liste d'un {for}, le
// routeur le tiennent) :
//   - départ, comme un retrait de la page (observateur d'attributs, @attach, magasin, reffets, µsleep), puis µdestroy ;
//   - anciens écouteurs de l'ombre et ancien dessin retirés (ses composants enfants partent comme d'un retrait) ;
//   - champs du rendu remis à neuf, d'après une construction du nouveau code arrêtée avant son script (la SONDE) ;
//   - nouveau gabarit, nouveaux écouteurs, nouveau script joué sur l'état gardé : l'état `$` passe tel quel (les valeurs de départ ne
//     s'écrivent que sur les variables nouvelles, les variables retirées disparaissent) ; une dérivée dont le texte n'a pas changé
//     garde sa valeur sans être réévaluée tant qu'aucune de ses sources (variables `$`, clés du magasin, langue d'une traduction) n'a
//     changé depuis son dernier calcul, une dérivée modifiée,
//     nouvelle ou périmée par une source se calcule à sa première lecture (cf. _mjsHotDerivees) ;
//   - retour, comme une arrivée : props du parent relues, µawake, premier rendu (le gabarit relit ses valeurs), µmount rejoué.
// Avant tout cela, la garde : un champ propre de l'instance (ni l'état `$`, ni un champ que le cœur ou le code compilé pose, cf.
// _mjsHotInternes) réécrit, retiré ou apparu depuis la fin de sa construction (son script joué, cf. _mjsHotFin), du dedans comme du
// dehors, recharge la page — le nouveau script le remettrait à son départ.
// Une instance tenue hors de la page pendant l'échange (page quittée gardée par le routeur) se redessine de même à son retour, avant
// d'y entrer : chaque instance porte le numéro du dernier échange de sa balise, construite ou redessinée.
// Chaque import reçoit une adresse à lui (`?mjs-hot=<n>`) : un fichier déjà chargé, revenu au texte d'une version antérieure, se rejoue
// et enregistre de nouveau sa balise. Rend une promesse de `false` au moindre doute (balise jamais enregistrée par ce cœur, import en échec, fichier qui n'enregistre
// pas sa balise, instance légère `mjs-light`, slots indexés, champ de l'instance changé depuis sa construction, erreur, plantage ou promesse
// rejetée sans traitement pendant la veille de l'échange, même pris par le rendu, cf. _mjsHotApres) : le client recharge alors la page.
var _mjsHotShells = new Map();
var _mjsHotWaiting = null;
var _mjsHotObserved = new WeakSet();
var _mjsHotStop = {};
// balise → dernier échange { n, probe } ; file des échanges ; vrai dès qu'un échange a demandé le rechargement complet
var _mjsHotGen = new Map();
var _mjsHotQueue = Promise.resolve();
var _mjsHotDead = false;
// échanges importés : chaque import reçoit une adresse à lui, un module déjà chargé (texte revenu à une version antérieure) se rejoue
var _mjsHotImports = 0;

// relevé des champs propres de chaque instance, pris à la fin de sa construction (cf. _mjsHotFin), puis après chaque script rejoué par
// un échange
var _mjsHotSnaps = new WeakMap();
// veilles des plantages ouvertes ({ tag } dès le premier) : celle d'un échange, celle d'une instance redessinée à son retour
var _mjsHotVeilles = [];
// texte de chaque dérivée telle que le script la pose, par instance : la table des dérivées peut n'en tenir qu'une enveloppe, la même
// pour toutes (µload, mjs_load.ts). Relevé posé au premier enregistrement d'une balise, le cœur entier chargé (`µ._mjs_setComputed`
// vient d'un fichier qui suit celui-ci)
var _mjsHotTextes = new WeakMap();
var _mjsHotCalc = null;
function _mjsHotPoseCalc() {
  if (_mjsHotCalc || typeof µ._mjs_setComputed !== 'function') return;
  _mjsHotCalc = µ._mjs_setComputed;
  µ._mjs_setComputed = function(el, k, fn) {
    var t = _mjsHotTextes.get(el);
    if (!t) _mjsHotTextes.set(el, t = Object.create(null));
    t[k] = String(fn);
    return _mjsHotCalc.apply(this, arguments);
  };
}

// méthodes de liste qu'une dérivée peut appeler (cf. hotMethodes, bundler/transpile-msg.ts) et celles du langage, prises au chargement
// du cœur, avant tout code de l'appli (listes, chaînes, espèce des listes)
var _mjsHotMethodes = 'filter map toSorted slice toReversed toSpliced with find findIndex findLast findLastIndex some every reduce reduceRight includes indexOf lastIndexOf at join'.split(' ');
var _mjsHotPropre = function(o, k) {
  var d = Object.getOwnPropertyDescriptor(o, k);
  return d && hasProp.call(d, 'value') ? d.value : d;
};
var _mjsHotOrig    = _mjsHotMethodes.map(function(m) { return [_mjsHotPropre(Array.prototype, m), _mjsHotPropre(String.prototype, m)]; });
var _mjsHotEspece  = (Object.getOwnPropertyDescriptor(Array, Symbol.species) || {}).get;
var _mjsHotListeRe = new RegExp('\\.(?:' + _mjsHotMethodes.join('|') + ')\\s*\\(');

// les méthodes de liste du langage, intactes : aucune remplacée (listes, chaînes), aucune posée sur les autres prototypes du langage,
// l'espèce des listes celle du langage
function _mjsHotLangueSure() {
  var protos = [Object.prototype, Function.prototype, Number.prototype, Boolean.prototype, Symbol.prototype, BigInt.prototype], i, j;
  if (_mjsHotPropre(Array.prototype, 'constructor') !== Array || (Object.getOwnPropertyDescriptor(Array, Symbol.species) || {}).get !== _mjsHotEspece) return false;
  for (i = 0; i < _mjsHotMethodes.length; i++) {
    if (_mjsHotPropre(Array.prototype, _mjsHotMethodes[i]) !== _mjsHotOrig[i][0] || _mjsHotPropre(String.prototype, _mjsHotMethodes[i]) !== _mjsHotOrig[i][1]) return false;
    for (j = 0; j < protos.length; j++) if (hasProp.call(protos[j], _mjsHotMethodes[i])) return false;
  }
  return true;
}

// valeur lue par une dérivée qui appelle une méthode de liste, qui n'appelle rien de l'appli par elle : valeur simple, vraie liste (du
// prototype du langage, sans méthode ni `constructor` à elle), objet qui ne porte aucune de ces méthodes (l'appel échouerait : la page
// se recharge) ; ni accesseur, ni dérivée du magasin
function _mjsHotValeurSure(v) {
  var o, i;
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return true;
  if (Array.isArray(v) && (Object.getPrototypeOf(v) !== Array.prototype || hasProp.call(v, 'constructor'))) return false;
  if (hasProp.call(v, '_mjs_c')) return false;
  for (o = v; o && o !== Array.prototype && o !== Object.prototype && o !== Function.prototype; o = Object.getPrototypeOf(o)) {
    for (i = 0; i < _mjsHotMethodes.length; i++) if (hasProp.call(o, _mjsHotMethodes[i])) return false;
  }
  return true;
}

// chaque dérivée du nouveau script (`neufs`, nom → texte) qui appelle une méthode de liste ne lit, directement, par une autre dérivée
// ou par la valeur de départ d'une variable nouvelle (`inits`), que des valeurs sûres (variables `$` de l'instance, clés du magasin et
// leurs champs, cf. _mjsHotValeurSure), les méthodes du langage intactes ; sinon faux et la page se recharge. Un receveur ne lit rien
// d'autre (cf. hotListe) : aucune méthode de l'appli n'est appelée par l'échange. Une liste enveloppée d'un Proxy (`Array.isArray` vrai)
// ne s'inspecte pas sans appeler ses trappes, ni un élément sans son accesseur
function _mjsHotListesSures(el, neufs, inits) {
  var st = el._state || {}, vus = Object.create(null), langue = null, k;
  if (!neufs) return true;
  var lu = function(o, cle) {
    for (; o != null; o = Object.getPrototypeOf(Object(o))) {
      var d = Object.getOwnPropertyDescriptor(Object(o), cle);
      if (d) return hasProp.call(d, 'value') ? { v: d.value } : null;
    }
    return { v: void 0 };
  };
  var sure = function(k, txt) {
    var i, j, x, d, chemin, o;
    if (vus[k]) return true;
    vus[k] = 1;
    var etat = txt.match(/\$\??\.[A-Za-z_$][\w$]*/g) || [];
    for (i = 0; i < etat.length; i++) {
      x = etat[i].replace(/^\$\??\./, '');
      d = Object.getOwnPropertyDescriptor(st, x);
      if (typeof neufs[x] === 'string') {
        if (!sure(x, neufs[x])) return false;
      }
      else if (d && hasProp.call(d, 'value')) {
        if (!_mjsHotValeurSure(d.value)) return false;
      }
      else if (inits && typeof inits[x] === 'string') {
        if (!sure('=' + x, inits[x])) return false;
      }
      else if (d) return false;
    }
    var magasin = txt.match(/µ\.store(?:\??\.[A-Za-z_$][\w$]*(?![\w$]|\s*\())+/g) || [];
    for (i = 0; i < magasin.length; i++) {
      chemin = magasin[i].slice(7).replace(/\?/g, '').split('.').slice(1);
      o = { v: µ._mjs_storeRaw || {} };
      for (j = 0; j < chemin.length && o; j++) {
        o = lu(o.v, chemin[j]);
        if (o && !_mjsHotValeurSure(o.v)) return false;
      }
      if (!o) return false;
    }
    return true;
  };
  for (k in neufs) {
    if (!hasProp.call(neufs, k) || !_mjsHotListeRe.test(neufs[k])) continue;
    if (langue === null) langue = _mjsHotLangueSure();
    if (!langue || !sure(k, neufs[k])) return false;
  }
  return true;
}

// dernier argument de chaque appel `appel(_mjsThis, 'nom', …)` du texte d'un script, par nom (parenthèses comptées hors des chaînes)
function _mjsHotArgs(txt, appel) {
  var out = Object.create(null), motif = appel + '(_mjsThis, \'', i = 0, j, nom, prof, q, c;
  while ((i = txt.indexOf(motif, i)) >= 0) {
    i += motif.length;
    j = txt.indexOf('\'', i);
    if (j < 0) break;
    nom = txt.slice(i, j);
    for (i = j + 1, prof = 1, q = ''; i < txt.length && prof > 0; i++) {
      c = txt[i];
      if (q) {
        if (c === '\\') i++;
        else if (c === q) q = '';
      }
      else if (c === '\'' || c === '"' || c === '`') q = c;
      else if (c === '(') prof++;
      else if (c === ')') prof--;
    }
    out[nom] = txt.slice(j + 1, i);
  }
  return out;
}

// la même vérification avant le départ de l'ancienne instance (ni `µsleep` ni `µdestroy` ne jouent) : dérivées et valeurs de départ
// du nouveau script lues dans son texte (`probe.nt`, cf. _mjsHotSwapAll), valeurs de l'état d'avant l'échange
function _mjsHotAvant(el, probe) {
  return !probe.nt || _mjsHotListesSures(el, probe.nt[0], probe.nt[1]);
}

// écritures du magasin (bascule de langue comprise, clé `__mjsLang`) faites pendant le redessin d'une instance — son départ (ancien
// `µsleep`, ancien `µdestroy`), le script rejoué, son retour : désabonnée, l'instance ne les compte pas ; relevées ici (`$$clé`,
// `_awaits_`, `$$*`), elles refont les dérivées qui les lisent (cf. _mjsHotDerivees, _mjsHotGarder)
function _mjsHotEcoute() {
  var vu = new Set(), nk = µ._mjs_storeNotifyKey, ns = µ._mjs_storeNotifyStruct, rw = µ._mjs_storeRawWrite;
  var note = function(key) {
    vu.add('$$' + String(key));
    if (key === '__mjsLang') vu.add('_awaits_');
  };
  if (nk) µ._mjs_storeNotifyKey = function(key) { note(key); return nk.apply(this, arguments); };
  if (ns) µ._mjs_storeNotifyStruct = function() { vu.add('$$*'); return ns.apply(this, arguments); };
  if (rw) µ._mjs_storeRawWrite = new Proxy(rw, { set: function(t, key, v) { note(key); rw[key] = v; return true; } });
  return { vu: vu, fin: function() {
    if (nk) µ._mjs_storeNotifyKey = nk;
    if (ns) µ._mjs_storeNotifyStruct = ns;
    if (rw) µ._mjs_storeRawWrite = rw;
  } };
}

// champs hors garde : les noms que le cœur et le code compilé écrivent sur une instance, et eux seuls (liste relue dans leurs sources
// par tests/hmr-champs-internes.test.ts). Les écouteurs de `<@window>` (`_gl_<n>`) et les fonctions de l'instance sont posés par le
// script, avant le relevé : gardés comme tout champ de l'appli, même au nom qui ressemble à un interne. Les noms sont des clés nues :
// un cœur de développement minifié (`minify: true`) raccourcit les champs `_mjs_*`, et ces clés avec eux, de la même façon ; une
// liste de textes garderait les noms longs et ne reconnaîtrait plus aucun champ interne
var _mjsHotInternes = { _mjsSkelBusy: 1, _mjs_a: 1, _mjs_acquireKeyframes: 1, _mjs_adopted: 1, _mjs_ae: 1, _mjs_afterStop: 1, _mjs_anim_mode: 1, _mjs_arrive: 1, _mjs_att: 1, _mjs_attachments: 1, _mjs_attempt: 1, _mjs_awaitCtrls: 1, _mjs_awaitFors: 1, _mjs_awaitFresh: 1, _mjs_awaitLastRender: 1, _mjs_awaitMap: 1, _mjs_awaitStates: 1, _mjs_awaitStop: 1, _mjs_awake_cbs: 1, _mjs_basc: 1, _mjs_baseCss: 1, _mjs_before: 1, _mjs_beforeIn: 1, _mjs_beforeVars: 1, _mjs_beforeW: 1, _mjs_bindEpochs: 1, _mjs_bindEvents: 1, _mjs_bindOpen: 1, _mjs_binds: 1, _mjs_br: 1, _mjs_bw: 1, _mjs_by: 1, _mjs_cached: 1, _mjs_chgd: 1, _mjs_coalesce: 1, _mjs_computedDeps: 1, _mjs_computedKeys: 1, _mjs_computedSrc: 1, _mjs_computeds: 1, _mjs_contexts: 1, _mjs_cssPending: 1, _mjs_ctMode: 1, _mjs_custom: 1, _mjs_dbgPrev: 1, _mjs_dbgTimer: 1, _mjs_dead: 1, _mjs_debounce: 1, _mjs_destroy_cbs: 1, _mjs_destroy_scheduled: 1, _mjs_dir: 1, _mjs_dropKids: 1, _mjs_dv: 1, _mjs_dupKeyWarned: 1, _mjs_dying: 1, _mjs_dynEls: 1, _mjs_effects: 1, _mjs_effectsAll: 1, _mjs_effectsByVar: 1, _mjs_ev: 1, _mjs_evd: 1, _mjs_f: 1, _mjs_failed: 1, _mjs_failedKey: 1, _mjs_fallback: 1, _mjs_filt: 1, _mjs_filtIdxKeys: 1, _mjs_fineNote: 1, _mjs_flashAnim: 1, _mjs_flipping_cids: 1, _mjs_form: 1, _mjs_formBump: 1, _mjs_formShown: 1, _mjs_fxDrops: 1, _mjs_fxFilterWarn: 1, _mjs_fxFixed: 1, _mjs_fxGooPos: 1, _mjs_fxHeatShare: 1, _mjs_fxHoloClose: 1, _mjs_fxKeepN: 1, _mjs_fxMov: 1, _mjs_fxOff: 1, _mjs_fxOverN: 1, _mjs_fxPileHad: 1, _mjs_fxPileWarn: 1, _mjs_fxPl: 1, _mjs_fxReactStage: 1, _mjs_fxRel: 1, _mjs_fxResult: 1, _mjs_fxResultN: 1, _mjs_fxTra: 1, _mjs_fxTx: 1, _mjs_fxWait: 1, _mjs_fxWritten: 1, _mjs_gid: 1, _mjs_global: 1, _mjs_h: 1, _mjs_ha: 1, _mjs_haw: 1, _mjs_hk: 1, _mjs_has_crashed: 1, _mjs_has_dynamic_slots: 1, _mjs_headNodes: 1, _mjs_headTitle: 1, _mjs_headTitleSet: 1, _mjs_helloSent: 1, _mjs_hold: 1, _mjs_hooks: 1, _mjs_hotEv: 1, _mjs_hotGen: 1, _mjs_html: 1, _mjs_hydrated: 1, _mjs_i18n: 1, _mjs_i18nBootWaitPromise: 1, _mjs_i18nBootWaitResolve: 1, _mjs_i18nLoader: 1, _mjs_i18nPremier: 1, _mjs_i18nProv: 1, _mjs_i18nRedo: 1, _mjs_i18nRescue: 1, _mjs_i18nTard: 1, _mjs_i18nTimer: 1, _mjs_i18n_hold: 1, _mjs_idx_0: 1, _mjs_idx_1: 1, _mjs_idx_2: 1, _mjs_idx_3: 1, _mjs_inRenderStruct: 1, _mjs_init: 1, _mjs_initial_render: 1, _mjs_injectSlots: 1, _mjs_inline: 1, _mjs_inspectAll: 1, _mjs_inspectPaths: 1, _mjs_inspectPathsPrev: 1, _mjs_inspections: 1, _mjs_intro: 1, _mjs_invalidate: 1, _mjs_isLight: 1, _mjs_is_interpolator: 1, _mjs_is_mounted: 1, _mjs_is_router_aware: 1, _mjs_it: 1, _mjs_ix: 1, _mjs_kb: 1, _mjs_keep: 1, _mjs_kf: 1, _mjs_key_cache: 1, _mjs_key_set: 1, _mjs_l: 1, _mjs_lastMutedVars: 1, _mjs_lastNavPath: 1, _mjs_lastNavQuery: 1, _mjs_lay: 1, _mjs_layoutName: 1, _mjs_layoutSeq: 1, _mjs_layoutSsr: 1, _mjs_layouts: 1, _mjs_ldG: 1, _mjs_ldH: 1, _mjs_ldN: 1, _mjs_ldW: 1, _mjs_leaveTimer: 1, _mjs_lifeRun: 1, _mjs_link: 1, _mjs_list_anchor: 1, _mjs_list_cache: 1, _mjs_list_order: 1, _mjs_minuteries: 1, _mjs_mjsAccepted: 1, _mjs_mjsBusy: 1, _mjs_mjsConfirmGated: 1, _mjs_mjsConfirmPending: 1, _mjs_mjsDisplayAvant: 1, _mjs_mjsGlCl: 1, _mjs_mjsGlClCnt: 1, _mjs_mjsInitialized: 1, _mjs_mjsLightSheets: 1, _mjs_mjsMasque: 1, _mjs_mjsNoUjsMethodWarned: 1, _mjs_mjsPermanentNoIdWarned: 1, _mjs_mjsTitleHandled: 1, _mjs_mjsUjsBound: 1, _mjs_mod: 1, _mjs_modFresh: 1, _mjs_modLive: 1, _mjs_modName: 1, _mjs_modOrig: 1, _mjs_mods: 1, _mjs_mount: 1, _mjs_mountReal: 1, _mjs_mount_cbs: 1, _mjs_mounted: 1, _mjs_mq: 1, _mjs_mt: 1, _mjs_mtE: 1, _mjs_mtN: 1, _mjs_n: 1, _mjs_navTags: 1, _mjs_navWaiting: 1, _mjs_nom: 1, _mjs_noms: 1, _mjs_noMatchHref: 1, _mjs_noMatchPath: 1, _mjs_noMatchPending: 1, _mjs_nodes: 1, _mjs_notifyMutation: 1, _mjs_notifyMutationAliased: 1, _mjs_old: 1, _mjs_old_branch: 1, _mjs_old_key: 1, _mjs_onLeftCb: 1, _mjs_once_fired: 1, _mjs_outro: 1, _mjs_page_cached: 1, _mjs_pairedWith: 1, _mjs_pathSegs: 1, _mjs_pathSegsKey: 1, _mjs_pending: 1, _mjs_pendingFillRelease: 1, _mjs_pendingLightFragment: 1, _mjs_pendingMount: 1, _mjs_pendingSel: 1, _mjs_pending_full: 1, _mjs_pending_struct_dirty: 1, _mjs_posFixed: 1, _mjs_preload: 1, _mjs_propObserver: 1, _mjs_r: 1, _mjs_raf: 1, _mjs_rawProxy: 1, _mjs_rctx: 1, _mjs_rctx_cache: 1, _mjs_rdp: 1, _mjs_rfl: 1, _mjs_ref: 1, _mjs_ref_td: 1, _mjs_refs: 1, _mjs_refuses: 1, _mjs_releaseKeyframes: 1, _mjs_renderCount: 1, _mjs_renderStruct: 1, _mjs_renderStructDirty: 1, _mjs_renderStructVars: 1, _mjs_render_scheduled: 1, _mjs_reqs: 1, _mjs_reset: 1, _mjs_rfE: 1, _mjs_rfN: 1, _mjs_rooms: 1, _mjs_rootsByTarget: 1, _mjs_routeErrorSheet: 1, _mjs_route_key: 1, _mjs_rows: 1, _mjs_runShared: 1, _mjs_rw: 1, _mjs_said: 1, _mjs_setComputed: 1, _mjs_sharedCss: 1, _mjs_sigBoxes: 1, _mjs_sigBurst: 1, _mjs_sigNodes: 1, _mjs_sigRuns: 1, _mjs_sleep_cbs: 1, _mjs_slotIdx: 1, _mjs_slotsFixed: 1, _mjs_slotsRendered: 1, _mjs_spk: 1, _mjs_spm: 1, _mjs_srv: 1, _mjs_srvWait: 1, _mjs_ssrAdopt: 1, _mjs_stableTimer: 1, _mjs_stateProxy: 1, _mjs_state_methods: 1, _mjs_storeKeys: 1, _mjs_storeSubKeys: 1, _mjs_store_unsubs: 1, _mjs_struct_dispatched_in_tick: 1, _mjs_sv: 1, _mjs_taken: 1, _mjs_td: 1, _mjs_text_cache: 1, _mjs_text_last: 1, _mjs_tick_cfgs: 1, _mjs_torn: 1, _mjs_transition_init: 1, _mjs_transition_state: 1, _mjs_treg: 1, _mjs_twinIn: 1, _mjs_twinNew: 1, _mjs_twins: 1, _mjs_tx_id: 1, _mjs_types: 1, _mjs_u: 1, _mjs_ue_pending: 1, _mjs_ujsAuthor: 1, _mjs_ujsDry: 1, _mjs_ujsDryWarn: 1, _mjs_ujsGateOnly: 1, _mjs_ujsTaken: 1, _mjs_ujsWatch: 1, _mjs_ujsWatched: 1, _mjs_univ_targets: 1, _mjs_userEffectVars: 1, _mjs_v: 1, _mjs_var_bits: 1, _mjs_viewTransition: 1, _mjs_viewTransitionPriority: 1, _mjs_vtOwner: 1, _mjs_vtPrev: 1, _mjs_vu: 1, _mjs_vw: 1, _mjs_w: 1, _mjs_waited: 1, _mjs_wakeArmed: 1, _mjs_wakeAt: 1, _mjs_wakeCalls: 1, _mjs_wakeSeen: 1, _mjs_wakeStop: 1, _mjs_wakeTook: 1, _mjs_warnedOpts: 1, _mjs_wave: 1, _mjs_withFx: 1, _mjs_wr: 1, _mjs_wrapDeep: 1, _mjs_xfPeer: 1, _mjs_xfRect: 1, _shadow: 1, _state: 1, _mjs_wakePg: 1 };
// <routes-repos>
// les champs de l'attente d'une page pas encore chargée (mjs_router.ts, navigate) : retirés du cœur avec elle
Object.assign(_mjsHotInternes, { _mjs_navBusy: 1, _mjs_navReady: 1, _mjs_navWait: 1, _mjs_navWaitKey: 1 });
// </routes-repos>
// <familles>
// la note des fiches d'un état partagé ou d'un magasin que tiennent les variables (mjs_element.ts) : retirée du cœur sans état ni magasin
Object.assign(_mjsHotInternes, { _mjs_fil: 1 });
// </familles>
// <boucles>
// les champs de la file des boucles qui écrivent l'état (mjs_element.ts) : retirés du cœur avec elle quand aucune boucle n'est enveloppée
Object.assign(_mjsHotInternes, { _mjs_lqb: 1, _mjs_lqk: 1 });
// </boucles>
// <fin>
// les champs de la mise à jour fine (mjs_deep.ts) : la table posée par le code compilé, les lignes en attente de la microtâche, les
// liaisons de champs en attente de la sortie d'une boucle et l'état propre ou sale de chaque liste (mjs_for.ts) ; retirés du cœur avec
// elle quand aucune unité n'a de table
Object.assign(_mjsHotInternes, { _mjs_fine: 1, _mjs_fineIds: 1, _mjs_fq: 1, _mjs_lqf: 1, _mjs_selfW: 1 });
// </fin>
function _mjsHotInterne(k) {
  return hasProp.call(_mjsHotInternes, k);
}

// champs propres de l'instance qui ne sont ni l'état `$` ni internes : leurs descripteurs, sans appeler d'accesseur
function _mjsHotReleve(el) {
  var r = new Map();
  Reflect.ownKeys(el).forEach(function(k) { if (!_mjsHotInterne(k)) r.set(k, Object.getOwnPropertyDescriptor(el, k)); });
  return r;
}

// la garde : premier champ propre changé depuis le relevé (valeur ou descripteur, fonction réaffectée comprise), retiré, ou apparu
// (accesseur compris), quel que soit le chemin de l'écriture ; null : aucun
function _mjsHotEcrit(el) {
  var avant = _mjsHotSnaps.get(el), now = _mjsHotReleve(el), champ = null;
  if (!avant) return '?';
  avant.forEach(function(a, k) { if (champ === null && !now.has(k)) champ = String(k); });
  now.forEach(function(d, k) {
    var a = avant.get(k);
    if (champ === null && (!a || !Object.is(a.value, d.value) || a.get !== d.get || a.set !== d.set || a.writable !== d.writable || a.enumerable !== d.enumerable || a.configurable !== d.configurable)) champ = String(k);
  });
  return champ;
}

function _mjsHotGarde(el) {
  var champ = _mjsHotEcrit(el);
  if (champ !== null) µ.warn(µ._mjs_msg('dev.hotswapField', { tag: el.localName, champ: champ }, '<{tag}> : le champ « {champ} » de l\'instance a changé depuis sa construction (écrit, retiré ou ajouté), la page se recharge pour ne pas garder un état faux'));
  return champ === null;
}

// plantage d'un composant, pris par le rendu, un crochet, une minuterie (`_mjs_catchError`) ou jamais pris (erreur de la fenêtre, promesse
// rejetée sans traitement) : pendant une veille, il la fait échouer
var _mjsHotCatch = µ.Element.prototype._mjs_catchError;
µ.Element.prototype._mjs_catchError = function(err) {
  _mjsHotPlante(this.localName);
  return _mjsHotCatch.apply(this, arguments);
};
function _mjsHotPlante(tag) {
  for (var i = 0; i < _mjsHotVeilles.length; i++) if (!_mjsHotVeilles[i].tag) _mjsHotVeilles[i].tag = tag;
}
function _mjsHotOnError() {
  _mjsHotPlante('?');
}
function _mjsHotOuvre() {
  var v = { tag: null };
  if (_mjsHotVeilles.push(v) === 1) {
    window.addEventListener('error', _mjsHotOnError);
    window.addEventListener('unhandledrejection', _mjsHotOnError);
  }
  return v;
}
// rend la balise qui a planté pendant la veille ('?' : erreur ou rejet hors d'un composant), null sinon
function _mjsHotFerme(v) {
  var i = _mjsHotVeilles.indexOf(v);
  if (i >= 0) _mjsHotVeilles.splice(i, 1);
  if (!_mjsHotVeilles.length) {
    window.removeEventListener('error', _mjsHotOnError);
    window.removeEventListener('unhandledrejection', _mjsHotOnError);
  }
  return v.tag;
}

// fin de la veille, fenêtre fixe : une tâche (microtâches de l'échange vidées : premier rendu, crochets rejoués), une minuterie de
// délai 0 (celles de délai 0 que les crochets ont posées passent avant elle, dans l'ordre où elles ont été posées), une tâche encore
// (le rejet d'une promesse sans traitement se signale par une tâche posée dès la fin des microtâches qui l'ont vu). Une minuterie plus
// longue, même d'1 ms, une image (requestAnimationFrame), un événement plus tardif tombent hors de la veille
function _mjsHotTache(fn) {
  var c = new MessageChannel();
  c.port1.onmessage = function() {
    c.port1.close();
    fn();
  };
  c.port2.postMessage(0);
}
function _mjsHotApres() {
  return new Promise(function(r) {
    _mjsHotTache(function() {
      setTimeout(function() { _mjsHotTache(r); }, 0);
    });
  });
}

// la fin de la construction : le constructeur généré finit par le script (`this.init($)`), qu'un réveil (`@wake`, mjs_wake.ts) rejoue
// tel quel ; le relevé suit le script, avant toute écriture venue de dehors ou de ses crochets. Posé sur la coquille avant son
// enregistrement : les balises déjà dans la page, mises à niveau par l'enregistrement, l'ont aussi
function _mjsHotFin(P) {
  P.init = function($) {
    var r = Object.getPrototypeOf(P).init.call(this, $);
    _mjsHotSnaps.set(this, _mjsHotReleve(this));
    return r;
  };
}

// champs posés par la construction que l'échange garde : l'ombre (la balise même pour un léger), l'état, les nœuds du dessin
var _mjsHotKeep = { _shadow: 1, _mjs_isLight: 1, _mjs_ssrAdopt: 1, _state: 1, _mjs_nodes: 1 };

// champs du rendu et du cycle de vie qu'un composant pose de lui-même après sa construction (blocs {if} {for} {await} {key}, slots,
// crochets de vie, reffets, inspections, magasin, @attach, montage) : retirés avant le nouveau script, qui les pose à neuf. La
// description des gestionnaires de chaque liste (`_mjs_evd`) suit le gabarit d'avant : gardée, elle donnerait aux lignes refaites
// des identifiants décalés dès qu'une balise de la ligne gagne ou perd un gestionnaire ; des clés
// nues, comme _mjsHotInternes et _mjsHotKeep : un cœur minifié les raccourcit comme les champs
var _mjsHotReset = { _mjs_old: 1, _mjs_list_anchor: 1, _mjs_list_cache: 1, _mjs_list_order: 1, _mjs_evd: 1, _mjs_renderStructDirty: 1, _mjs_rw: 1, _mjs_dupKeyWarned: 1, _mjs_awaitLastRender: 1, _mjs_awaitMap: 1, _mjs_awaitStates: 1, _mjs_key_cache: 1, _mjs_slotsFixed: 1, _mjs_slotsRendered: 1, _mjs_hooks: 1, _mjs_awake_cbs: 1, _mjs_sleep_cbs: 1, _mjs_destroy_cbs: 1, _mjs_mount_cbs: 1, _mjs_minuteries: 1, _mjs_fallback: 1, _mjs_mounted: 1, _mjs_pendingMount: 1, _mjs_torn: 1, _mjs_initial_render: 1, _mjs_effects: 1, _mjs_userEffectVars: 1, _mjs_inspections: 1, _mjs_inspectAll: 1, _mjs_inspectPaths: 1, _mjs_inspectPathsPrev: 1, _mjs_effectsByVar: 1, _mjs_effectsAll: 1, _mjs_renderStruct: 1, _mjs_renderStructVars: 1, _mjs_lastMutedVars: 1, _mjs_storeKeys: 1, _mjs_store_unsubs: 1, _mjs_storeSubKeys: 1, _mjs_attachments: 1, _mjs_i18n: 1, _mjs_once_fired: 1, _mjs_rctx_cache: 1, _mjs_has_crashed: 1, _mjs_destroy_scheduled: 1, _mjs_computeds: 1, _mjs_computedKeys: 1, _mjs_has_dynamic_slots: 1, _mjs_state_methods: 1, _mjs_types: 1, _mjs_layouts: 1, _mjs_lay: 1, _mjs_sharedCss: 1, _mjs_hotEv: 1 };
// <fin>
// la table de la mise à jour fine et ses files : le nouveau script ne la pose que s'il en a une — gardée, l'ancienne rejouerait les
// liaisons d'avant (leur état, leurs nœuds) à la place de celles du nouveau gabarit ; l'état des listes est refait d'après la nouvelle
// table, sale (ses listes sont relues entières à leur première passe)
Object.assign(_mjsHotReset, { _mjs_fine: 1, _mjs_fineIds: 1, _mjs_fq: 1, _mjs_lqf: 1 });
// </fin>

// enregistrement d'une balise : sous une coquille la première fois ; pendant un rechargement, la nouvelle classe est seulement notée
var _mjsHotDef = µ._def;
µ._def = function(tag, C) {
  _mjsHotPoseCalc();
  if (_mjsHotWaiting && _mjsHotWaiting.has(tag)) {
    _mjsHotWaiting.set(tag, C);
    return;
  }
  if (!_mjsHotShells.has(tag) && typeof customElements !== 'undefined' && !customElements.get(tag)) {
    var shell = class extends C {};
    _mjsHotFin(shell.prototype);
    _mjsHotShells.set(tag, shell);
    return _mjsHotDef(tag, shell);
  }
  return _mjsHotDef(tag, C);
};

// balise courte d'un alias : déjà enregistrée sous `class extends C {}`, retrouvée après coup
var _mjsHotAlias = µ._al;
if (typeof _mjsHotAlias === 'function') {
  µ._al = function(tag, key, C) {
    _mjsHotPoseCalc();
    if (_mjsHotWaiting && _mjsHotWaiting.has(tag)) {
      _mjsHotWaiting.set(tag, C);
      return;
    }
    var had = typeof customElements !== 'undefined' && customElements.get(tag), def = had === undefined && customElements.define;
    var propre = def && hasProp.call(customElements, 'define');
    // la coquille de l'alias reçoit sa fin de construction avant son enregistrement (cf. _mjsHotFin)
    if (def) customElements.define = function(t, K) {
      if (t === tag && !_mjsHotShells.has(tag)) _mjsHotFin(K.prototype);
      return def.apply(this, arguments);
    };
    try {
      _mjsHotAlias(tag, key, C);
    }
    finally {
      if (propre) customElements.define = def;
      else if (def) delete customElements.define;
    }
    var made = !had && typeof customElements !== 'undefined' && customElements.get(tag);
    if (made && !_mjsHotShells.has(tag)) _mjsHotShells.set(tag, made);
  };
}

// écouteurs que le gabarit pose sur l'ombre, notés pour être retirés au rechargement suivant (sans quoi chaque échange en ajouterait)
var _mjsHotBind = µ.Element.prototype._mjs_bindEvents;
µ.Element.prototype._mjs_bindEvents = function(routes, passive) {
  var root = this._shadow, list = this._mjs_hotEv || (this._mjs_hotEv = []), add = root.addEventListener;
  root.addEventListener = function(type, fn, opts) {
    list.push([type, fn, opts]);
    return add.call(this, type, fn, opts);
  };
  try {
    return _mjsHotBind.call(this, routes, passive);
  }
  finally {
    delete root.addEventListener;
  }
};

// numéro du dernier échange de sa balise, posé à la construction (la sonde a son propre _mjs_mount)
var _mjsHotMount = µ.Element.prototype._mjs_mount;
µ.Element.prototype._mjs_mount = function() {
  var cur = _mjsHotGen.get(this.localName);
  if (cur) this._mjs_hotGen = cur.n;
  return _mjsHotMount.apply(this, arguments);
};

// une instance qui revient dans la page avec un numéro plus ancien que celui de sa balise était tenue hors de la page pendant un
// échange (cache du routeur) : redessinée avec le nouveau code avant d'y entrer, son état gardé ; au moindre doute, la page se recharge
var _mjsHotConnect = µ.Element.prototype.connectedCallback;
µ.Element.prototype.connectedCallback = function() {
  var cur = _mjsHotGen.get(this.localName);
  if (!cur || this._mjs_hotGen === cur.n) return _mjsHotConnect.apply(this, arguments);
  this._mjs_hotGen = cur.n;
  if (this._mjs_isLight || this._mjs_has_dynamic_slots || !_mjsHotGarde(this) || !_mjsHotAvant(this, cur.probe)) return location.reload();
  var veille = _mjsHotOuvre();
  try {
    _mjsHotRebuild(this, cur.probe, true);
  }
  catch (err) {
    _mjsHotFerme(veille);
    if (err !== _mjsHotStop) µ.warn(µ._mjs_msg('dev.hotswapFailed', { tag: this.localName }, '<{tag}> : le rechargement à chaud a échoué, la page se recharge :'), err);
    return location.reload();
  }
  // même veille que pour un échange (cf. _mjsHotApres)
  _mjsHotApres().then(function() {
    var tag = _mjsHotFerme(veille);
    if (!tag) return;
    µ.warn(µ._mjs_msg('dev.hotswapCrash', { tag: tag }, '<{tag}> : le composant a planté pendant le rechargement à chaud, la page se recharge'));
    location.reload();
  });
};

// ombres déjà guettées par l'Autoloader : un second guetteur sur la même ombre serait de trop
if (µ.Autoloader && typeof µ.Autoloader.observe === 'function') {
  var _mjsHotObserve = µ.Autoloader.observe;
  µ.Autoloader.observe = function(root) {
    if (root) _mjsHotObserved.add(root);
    return _mjsHotObserve.apply(this, arguments);
  };
}

// construction du nouveau code arrêtée avant son script : rend la fonction du gabarit, les routes des écouteurs et l'élément
// construit (ses champs de départ), ou null
function _mjsHotProbe(shell) {
  var P = shell.prototype, cap = {}, fin = hasProp.call(P, 'init') ? P.init : null;
  P._mjs_mount = function(factory) { cap.factory = factory; };
  P._mjs_bindEvents = function(routes, passive) { cap.events = [routes, passive]; };
  P.init = function() {
    cap.el = this;
    throw _mjsHotStop;
  };
  try {
    new shell();
  }
  catch (err) {
    if (err !== _mjsHotStop) cap.el = null;
  }
  finally {
    delete P._mjs_mount;
    delete P._mjs_bindEvents;
    if (fin) P.init = fin;
    else delete P.init;
  }
  return cap.el && typeof cap.factory === 'function' ? cap : null;
}

// une instance redessinée par le nouveau code, en gardant son état (cf. en-tête) ; `asleep` : tenue hors de la page, son départ
// (µsleep, désabonnements) déjà fait quand elle l'a quittée
function _mjsHotRebuild(el, probe, asleep, ecrites) {
  var src = probe.el, st = el._state || {}, saved = Object.create(null), derivees = el._mjs_computeds, textes = _mjsHotTextes.get(el), k, d, i;
  _mjsHotTextes.delete(el);
  for (k in st) {
    d = Object.getOwnPropertyDescriptor(st, k);
    if (d && hasProp.call(d, 'value')) saved[k] = d.value;
  }
  // sources du dehors que l'instance suivait jusqu'à l'échange (cf. _mjsHotDerivees) : les clés du magasin auxquelles elle est abonnée,
  // les bascules de langue ; tenue hors de la page, elle n'en suivait aucune
  var dehors = asleep ? null : { abo: new Set(el._mjs_storeSubKeys || []), i18n: !!(µ._mjs_i18nComps && µ._mjs_i18nComps.has(el)), ecrites: ecrites || new Set() };
  if (!asleep) el.disconnectedCallback();
  if (typeof el._mjs_runDestroyCallbacks === 'function') el._mjs_runDestroyCallbacks();
  var ev = el._mjs_hotEv;
  if (ev) for (i = 0; i < ev.length; i++) el._shadow.removeEventListener(ev[i][0], ev[i][1], ev[i][2]);
  // ses composants enfants, sortis de la page avec elle, sont détruits comme ceux d'une page évincée du cache
  if (asleep && µ._mjs_destroyEvictedTree) for (i = el._shadow.children.length - 1; i >= 0; i--) µ._mjs_destroyEvictedTree(el._shadow.children[i]);
  el._shadow.replaceChildren();
  // <signaux>
  // nœuds du graphe des signaux (reffets, valeurs précises) : ils renaissent avec le nouveau code, les anciens quittent leurs sources
  if (el._mjs_sigNodes) µ._mjs_sigDrop(el);
  // </signaux>
  for (k in _mjsHotReset) if (hasProp.call(_mjsHotReset, k)) delete el[k];
  for (k in src) if (hasProp.call(src, k) && !hasProp.call(_mjsHotKeep, k)) el[k] = src[k];
  el._mjs_ssrAdopt = false;
  // état gardé : les variables que le nouveau code déclare encore, hors dérivées (recalculées)
  var bits = el._mjs_var_bits || {}, derived = el._mjs_computedDeps || {}, kept = {};
  for (k in saved) if (hasProp.call(bits, k) && !hasProp.call(derived, k)) kept[k] = saved[k];
  el._state = kept;
  // noms des variables gardées, pris avant que le script rejoué n'y pose les accesseurs de ses dérivées
  var noms = Object.create(null);
  for (k in kept) noms[k] = 1;
  var built = probe.factory();
  el._mjs_nodes = built.refs;
  el._mjs_registerRefs(built.refs);
  if (probe.events) el._mjs_bindEvents(probe.events[0], probe.events[1]);
  // nouveau script : ses valeurs de départ (écritures, listes et objets modifiés au premier niveau) ne touchent pas l'état gardé ; elles
  // passent à côté de la garde des props du développement (mjs_debug) : comme à une construction, elles viennent avant toute valeur du
  // parent, relue au retour
  var setProto = Object.getPrototypeOf(el)._set, sg = µ._set, ds = µ._mjs_deepSet, dc = µ._mjs_deepCall, dd = µ._mjs_deepDelete;
  var garde = function(e, path) { return e === el && path && hasProp.call(kept, path[0]); };
  el._set = function(key, v) { return hasProp.call(kept, key) ? v : setProto.call(this, key, v); };
  µ._set = function(e, key, v) { return e === el ? el._set(key, v) : sg(e, key, v); };
  if (ds) µ._mjs_deepSet = function(e, p, v) { return garde(e, p) ? v : ds(e, p, v); };
  if (dc) µ._mjs_deepCall = function(e, p, f, a) { return garde(e, p) ? void 0 : dc(e, p, f, a); };
  if (dd) µ._mjs_deepDelete = function(e, p) { return garde(e, p) ? true : dd(e, p); };
  try {
    el.init(el._state);
  }
  finally {
    delete el._set;
    µ._set = sg;
    if (ds) µ._mjs_deepSet = ds;
    if (dc) µ._mjs_deepCall = dc;
    if (dd) µ._mjs_deepDelete = dd;
  }
  var gardees = _mjsHotDerivees(el, derivees, textes, noms, dehors);
  // filet de la vérification faite avant le départ (cf. _mjsHotAvant), sur les textes posés par le script rejoué
  if (!_mjsHotListesSures(el, _mjsHotTextes.get(el), null)) throw _mjsHotStop;
  _mjsHotSnaps.set(el, _mjsHotReleve(el));
  // un composant routeur (layout) remplit ses vues à sa connexion (µ.Router.register) : son nouveau dessin entre dans l'ombre avant,
  // comme à une construction, sinon le routeur ne trouve pas la vue et la page de l'adresse ne revient pas
  var routeur = !!el._mjs_is_router_aware;
  if (routeur) el._shadow.appendChild(built.fragment);
  el.connectedCallback();
  // la reconnexion compte `_awaits_` (mjs_element.ts) sans que la langue ait changé : seule une bascule venue après périme une dérivée
  // gardée qui traduit
  for (i = 0; i < gardees.length; i++) gardees[i].aw = Math.max(gardees[i].aw, gardees[i].h.v._awaits_ || 0);
  if (!routeur) el._shadow.appendChild(built.fragment);
  if (µ.Autoloader && !_mjsHotObserved.has(el._shadow)) µ.Autoloader.observe(el._shadow);
  if (µ._mjs_maybeScanEager) µ._mjs_maybeScanEager(el);
}

// dérivées du nouveau script dont le texte n'a pas changé, dont chaque source `$` passe telle quelle (variable gardée, ou dérivée gardée
// elle-même) et dont le dernier calcul reste juste (aucune de ses sources écrite depuis : les autres écritures du composant l'ont
// seulement périmée, cf. _MJS_HORLOGE, mjs_element.ts) : leur valeur passe, rien n'est réévalué (cf. _mjsHotGarder). Une dérivée
// modifiée, nouvelle, jamais calculée ou qui lit une source changée se calcule à sa première lecture, une fois. Texte et sources lus
// dans la fonction que le script a posée (`$.nom`, `$?.nom`) : un nom de trop ne fait que recalculer. Sources du dehors, que l'échange
// n'écrit pas : une clé du magasin (`µ.store.x`, comptée `$$x` à l'horloge de l'instance abonnée), la langue (`µ.t(`, comptée
// `_awaits_` à chaque bascule, mjs_i18n.ts) ; une dérivée qui en lit une n'est gardée que si l'instance la suivait (`dehors`, cf.
// _mjsHotRebuild). Rend les dérivées gardées (cf. _mjsHotGarder)
function _mjsHotDerivees(el, avant, textes, noms, dehors) {
  var cs = el._mjs_computeds, neufs = _mjsHotTextes.get(el), vu = Object.create(null), gardees = [], k;
  if (!cs || !avant || !textes || !neufs) return gardees;
  var lues = function(k) {
    return (neufs[k].match(/\$\??\.[A-Za-z_$][\w$]*/g) || []).map(function(x) { return x.replace(/^\$\??\./, ''); });
  };
  var autres = function(k) {
    var s = (neufs[k].match(/µ\.store\.[A-Za-z_$][\w$]*/g) || []).map(function(x) { return '$$' + x.slice(8); });
    if (neufs[k].indexOf('µ.t(') >= 0) s.push('_awaits_');
    return s;
  };
  var suivie = function(x) {
    if (dehors && dehors.ecrites.has(x)) return false;
    if (x === '_awaits_') return !!dehors && dehors.i18n;
    return x.slice(0, 2) === '$$' ? !!dehors && dehors.abo.has(x.slice(2)) : true;
  };
  // ses sources variables, celles des dérivées gardées qu'elle lit comprises
  var plates = function(k, acc, vus) {
    acc.push.apply(acc, autres(k));
    lues(k).forEach(function(x) {
      if (vus[x]) return;
      vus[x] = 1;
      if (noms[x] === 1) acc.push(x);
      else if (typeof neufs[x] === 'string') plates(x, acc, vus);
    });
    return acc;
  };
  var gardee = function(k) {
    if (noms[k] === 1) return true;
    if (k in vu) return vu[k];
    vu[k] = false;
    var a = avant[k], n = cs[k], txt = neufs[k];
    if (!a || !n || !a._mjs_h || !(a._mjs_vu >= 0) || typeof txt !== 'string' || textes[k] !== txt || !lues(k).every(gardee)) return false;
    return (vu[k] = plates(k, [], Object.create(null)).every(function(x) { return suivie(x) && !(a._mjs_h.v[x] > a._mjs_vu); }));
  };
  for (k in cs) {
    if (hasProp.call(cs, k) && gardee(k)) gardees.push(_mjsHotGarder(cs[k], avant[k]._mjs_cached, plates(k, [], Object.create(null)), dehors && dehors.ecrites));
  }
  return gardees;
}

// dérivée gardée : toute écriture du composant périme ses dérivées (cf. _MJS_HORLOGE, mjs_element.ts), le premier rendu compris ; à sa
// première lecture, la valeur d'avant l'échange sert tant qu'aucune de ses sources n'a été écrite depuis, son calcul reprend ensuite ;
// la langue (`_awaits_`) se compte depuis la reconnexion de l'instance (`aw`, posé par _mjsHotRebuild)
function _mjsHotGarder(e, val, sources, ecrites) {
  var f = e.f, h = e._mjs_h, n0 = h.n, g = { h: h, aw: n0 };
  e._mjs_cached = val;
  e._mjs_vu     = n0;
  e.f = function() {
    e.f = f;
    for (var i = 0; i < sources.length; i++) if (h.v[sources[i]] > (sources[i] === '_awaits_' ? g.aw : n0) || (ecrites && ecrites.has(sources[i]))) return f.apply(this, arguments);
    // <signaux>
    // valeur précise (nœud du graphe des signaux, mjs_element.ts) : la valeur gardée vient de ces sources, notées comme les aurait
    // notées son calcul — la prochaine écriture de l'une d'elles la refait
    if (e._mjs_n) for (i = 0; i < sources.length; i++) µ._mjs_sigRead(e._mjs_n.owner, sources[i]);
    // </signaux>
    return val;
  };
  return g;
}

function _mjsHotSwapAll(waiting) {
  var ok = true;
  waiting.forEach(function(C, tag) {
    if (!ok) return;
    var shell = _mjsHotShells.get(tag), live = [], i;
    if (typeof C !== 'function' || !shell) {
      ok = false;
      return;
    }
    µ.instances.forEach(function(el) { if (el.localName === tag) live.push(el); });
    for (i = 0; i < live.length; i++) {
      if (live[i]._mjs_isLight || live[i]._mjs_has_dynamic_slots || !_mjsHotGarde(live[i])) {
        ok = false;
        return;
      }
    }
    Object.setPrototypeOf(shell, C);
    Object.setPrototypeOf(shell.prototype, C.prototype);
    var probe = _mjsHotProbe(shell);
    if (!probe || probe.el._mjs_has_dynamic_slots) {
      ok = false;
      return;
    }
    // texte du nouveau script : l'`init` de la classe importée (celui de la coquille l'enveloppe) ; une dérivée à méthode de liste qui
    // lirait une valeur qui n'est pas sûre : la page se recharge avant tout départ
    var script = String((C.prototype && C.prototype.init) || '');
    probe.nt = [_mjsHotArgs(script, 'µ._mjs_setComputed'), _mjsHotArgs(script, 'µ._set')];
    for (i = 0; i < live.length; i++) {
      if (!_mjsHotAvant(live[i], probe)) {
        ok = false;
        return;
      }
    }
    var cur = { n: (_mjsHotGen.has(tag) ? _mjsHotGen.get(tag).n : 0) + 1, probe: probe };
    _mjsHotGen.set(tag, cur);
    for (i = 0; i < live.length; i++) {
      // une instance retirée par l'échange d'une autre (composant qui se contient lui-même) n'est plus à redessiner
      if (!live[i].isConnected) continue;
      live[i]._mjs_hotGen = cur.n;
      var ecoute = _mjsHotEcoute();
      try {
        _mjsHotRebuild(live[i], probe, false, ecoute.vu);
      }
      catch (err) {
        if (err !== _mjsHotStop) µ.warn(µ._mjs_msg('dev.hotswapFailed', { tag: tag }, '<{tag}> : le rechargement à chaud a échoué, la page se recharge :'), err);
        ok = false;
        return;
      }
      finally {
        ecoute.fin();
      }
    }
  });
  return ok;
}

// traductions réécrites (`.yml` ou `.json` de `i18n/`) : la page importe le nouveau fichier de chaque langue, en reprend les textes de
// la racine, relit les sections changées qu'elle a déjà chargées, puis redessine les composants qui traduisent ; au moindre doute
// (traductions absentes de la page, fichier qui ne s'importe pas), le rechargement complet
function _mjsHotI18n(langues) {
  var noms = Object.keys(langues);
  if (typeof µ._i18nLang !== 'function' || !µ._i18nLangs || !µ._i18nDict || !µ._i18nCache || !µ._mjs_i18nComps || !µ.i18n) return Promise.resolve(false);
  return Promise.all(noms.map(function(l) { return import(langues[l]); })).then(function(mods) {
    var relire = [];
    noms.forEach(function(l, i) {
      var data = mods[i] && mods[i].default, avant = hasProp.call(µ._i18nLangs, l) ? µ._i18nLangs[l] : null, d = hasProp.call(µ._i18nDict, l) ? µ._i18nDict[l] : null, k;
      if (!data || typeof data !== 'object') throw new Error(langues[l]);
      if (avant && d) {
        // textes de la racine retirés du dictionnaire : la langue reçue les y remet, nouveaux
        for (k in avant.root) if (hasProp.call(avant.root, k)) delete d[k];
        for (k in avant.sections) {
          if (!hasProp.call(avant.sections, k) || (data.sections && data.sections[k] === avant.sections[k]) || !µ._i18nCache.has(l + '/' + k)) continue;
          µ._i18nCache.delete(l + '/' + k);
          delete d[k];
          relire.push([l, k]);
        }
      }
      if (µ._i18nData && µ._i18nData.files) µ._i18nData.files[l] = langues[l];
      µ._i18nLang(l, data);
    });
    return Promise.all(relire.map(function(r) { return µ.i18n._ensure(r[0], r[1]); }));
  }).then(function() {
    µ._mjs_i18nComps.forEach(function(c) { c._mjs_invalidate('_awaits_'); });
    return true;
  }, function(err) {
    µ.warn(µ._mjs_msg('dev.hotswapImport', null, 'rechargement à chaud : le nouveau fichier ne s\'importe pas, la page se recharge :'), err);
    return false;
  });
}

function _mjsHotSwapNow(payload) {
  var langues = payload && payload.i18n && typeof payload.i18n === 'object' ? payload.i18n : null;
  if (!langues) return _mjsHotSwapComps(payload);
  return _mjsHotI18n(langues).then(function(ok) {
    return ok && _mjsHotSwapComps(payload, true);
  });
}

// `seulTexte` : les traductions déjà reprises, un lot sans composant est fait
function _mjsHotSwapComps(payload, seulTexte) {
  var comps = payload && payload.components, tags = new Map(), urls = [], tag;
  if (!comps || typeof comps !== 'object' || !µ.instances) return Promise.resolve(false);
  for (tag in comps) {
    if (!hasProp.call(comps, tag)) continue;
    if (!_mjsHotShells.has(tag) || typeof comps[tag] !== 'string') return Promise.resolve(false);
    tags.set(tag, null);
    if (urls.indexOf(comps[tag]) < 0) urls.push(comps[tag]);
  }
  if (!urls.length) return Promise.resolve(!!seulTexte);
  _mjsHotWaiting = tags;
  return Promise.all(urls.map(function(u) { return import(u + (u.indexOf('?') < 0 ? '?' : '&') + 'mjs-hot=' + (++_mjsHotImports)); })).then(function() {
    _mjsHotWaiting = null;
    var veille = _mjsHotOuvre(), ok = false;
    try {
      ok = _mjsHotSwapAll(tags);
    }
    catch (err) {
      var noms = Array.from(tags.keys()).join('> <');
      µ.warn(µ._mjs_msg('dev.hotswapFailed', { tag: noms }, '<{tag}> : le rechargement à chaud a échoué, la page se recharge :'), err);
    }
    return (ok ? _mjsHotApres() : Promise.resolve()).then(function() {
      var tag = _mjsHotFerme(veille);
      if (!ok) return false;
      if (!tag) return true;
      µ.warn(µ._mjs_msg('dev.hotswapCrash', { tag: tag }, '<{tag}> : le composant a planté pendant le rechargement à chaud, la page se recharge'));
      return false;
    });
  }, function(err) {
    _mjsHotWaiting = null;
    µ.warn(µ._mjs_msg('dev.hotswapImport', null, 'rechargement à chaud : le nouveau fichier ne s\'importe pas, la page se recharge :'), err);
    return false;
  });
};

// un échange à la fois, dans l'ordre des messages (deux sauvegardes rapprochées) ; après un échange qui a demandé le rechargement
// complet, les suivants n'échangent plus rien
µ._hotSwap = function(payload) {
  var run = _mjsHotQueue.then(function() {
    return _mjsHotDead ? false : _mjsHotSwapNow(payload);
  }).then(function(ok) {
    if (ok !== true) _mjsHotDead = true;
    return ok;
  });
  _mjsHotQueue = run.then(null, function() { _mjsHotDead = true; });
  return run;
};
