// mjs_runes.coffee
// ==========================================================
// RÉACTIVITÉ UNIVERSELLE (Runes hors-composant)
// ==========================================================
// Clé-sentinelle de STRUCTURE d'un store. Lire les *clés* d'un store (énumération :
// `Object.keys`, `Object.values`, `for…in`, un `{for … in @store}`) ne passe PAS par
// le trap `get` clé-à-clé → sans ceci, aucun abonnement n'était posé sur « l'ensemble
// des clés », donc ajouter/retirer une entrée ne re-rendait jamais la vue (stream /
// présence / rooms morts). L'énumération s'abonne à cette sentinelle (trap `ownKeys`),
// et toute mutation (set/delete) la notifie en plus de la clé touchée.
µ._mjs_STRUCT ||= Symbol('mjs:struct');

// Stockage des dépendances : WeakMap<TargetObject, { key: Set<Component> }>
µ._mjs_universalDeps = new WeakMap();

µ._mjs_registerUniversalDep = function(target, key) {
  // Skip activeComponent lookup ; check direct sur stack.
  // Évite le getter Proxy push/pop chain.
  const stack = µ._mjs_initStack;
  if (stack.length === 0) return;
  const comp = stack[stack.length - 1];
  // Réduction des allocations : ne re-set le WeakMap entry que si nouveau.
  // Object.create(null) — PAS `{}` : une clé nommée toString/constructor/valueOf
  // (donnée métier légitime) retombait sur la fonction HÉRITÉE d'Object.prototype
  // (`deps[key] == null` faux car la fonction n'est pas nulle), puis `deps[key].add`
  // levait TypeError. Un registre sans prototype n'hérite plus rien.
  let deps = µ._mjs_universalDeps.get(target);
  if (!deps) {
    deps = Object.create(null);
    µ._mjs_universalDeps.set(target, deps);
  }
  deps[key] ??= new Set();
  deps[key].add(comp);
  comp._mjs_univ_targets ??= new Set();
  return comp._mjs_univ_targets.add(target);
};

µ._mjs_notifyUniversalChange = function(target, key) {
  // Cache local + early-return + simplify (skip ternary chain Coffee).
  const deps = µ._mjs_universalDeps.get(target);
  if (!deps) return;
  const subs = deps[key];
  if (!subs || subs.size === 0) return;
  // Le signal abstrait '_awaits_' est indispensable.
  // commentaire périmé corrigé :
  // décrivait encore la traduction V1 en bitmask (-1/-1n), retirée depuis.
  // V2 — `_mjs_invalidate` prend directement le NOM de var (ou ce signal abstrait),
  // dispatch direct via `_mjs_effectsByVar`, aucune traduction bitmask nulle part.
  for (const comp of subs) {
    // `_u` : un {await} qui lit un état partagé ou un contexte (mjs_await.ts, marque posée par le générateur) est relu ;
    // `_awaits_`, que pose aussi la résolution d'une attente, ne relit aucune expression
    comp._mjs_chgd?.add('_u');
    comp._mjs_invalidate('_awaits_');
  }
};

// Nettoyage des dépendances universelles (`µ.state()` partagés).
// Avant le fix : on retirait juste `component` des subscribers, mais on
// laissait les Set vides ET l'entry target dans la WeakMap → si un composant
// se ré-enregistrait, on créait des doublons. Maintenant on nettoie en
// cascade : Set vide → delete entry de deps ; deps {} → delete target de
// `µ._mjs_universalDeps`. La WeakMap se vide proprement.
µ._mjs_cleanupUniversalDeps = function(component) {
  var deps, i, key, keys, len, subscribers;
  if (!component._mjs_univ_targets) return;
  component._mjs_univ_targets.forEach((target) => {
    deps = µ._mjs_universalDeps.get(target);
    if (!deps) return;
    // Reflect.ownKeys (PAS for…in/Object.keys) : voit aussi la clé Symbol
    // µ._mjs_STRUCT (énumération) — sinon, quand elle est la SEULE clé restante
    // mais encore abonnée par d'AUTRES composants, `Object.keys(deps).length===0`
    // mentait (les Symbols n'y comptent jamais) et le registre ENTIER était
    // supprimé (leurs abonnements perdus), tandis que l'abonnement de CE
    // composant sur cette même clé n'était jamais retiré (fuite : invoqué après
    // son propre nettoyage).
    keys = Reflect.ownKeys(deps);
    for (i = 0, len = keys.length; i < len; i++) {
      key = keys[i];
      subscribers = deps[key];
      subscribers.delete(component);
      if (subscribers.size === 0) {
        delete deps[key];
      }
    }
    if (Reflect.ownKeys(deps).length === 0) {
      µ._mjs_universalDeps.delete(target);
    }
  });
};
