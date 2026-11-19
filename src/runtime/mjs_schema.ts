// mjs_schema — µschema côté CLIENT : registre binaire à schéma, patch externe de MjsSocket.prototype
// (même patron que mjs_game.ts) + une poignée de points d'extension MINIMES dans mjs_socket.ts (hello,
// binaryType, réception binaire — SIGNALÉS dans LEURS propres commentaires). mjs_socket.ts
// DOIT être chargé AVANT ce fichier (ordre canonique du bundler, cf. src/bundler/index.ts
// resolveRuntimeFiles) pour que ces points d'extension trouvent µ._mjschemaXxx déjà posés — sans lui,
// µ.schema()/µ.list()/µ.bits() restent quand même utilisables (registre pur, zéro dépendance à
// MjsSocket) : seul le branchement réseau reste inerte (cf. bundler — avertissement 'schema' sans
// 'socket', même esprit que 'game' sans 'socket').
//
// PORT FIDÈLE de src/schema/core.ts — PAS un import : les fichiers src/runtime/mjs_*.ts sont
// concaténés tels quels (JS pur, zéro import/export, cf. bundler/index.ts::bundleRuntime « on peut
// concaténer directement, esbuild passerait en mode ESM avec wrapping qui collisionne ») et exécutés
// via `new Function('µ', src)` dans les tests (cf. tests/socket-game.test.ts) — aucune résolution de
// module n'a jamais lieu ici. Même compromis que le protocole µ: tout entier : client (ici) et serveur
// (src/mjs-ws/schema.ts, qui LUI importe réellement core.ts) sont deux implémentations INDÉPENDANTES
// d'accord sur un même contrat, jamais un fichier partagé à l'exécution. Algorithme, enveloppe fil
// ([u8 idSchéma][charge], DataView little-endian, chaînes préfixées en OCTETS UTF-8) et hash FNV-1a
// copiés depuis core.ts — hashRegistry() DOIT produire EXACTEMENT le même hash qu'un registre serveur
// miroir (mêmes noms/types/ORDRE), sinon le serveur croit à un désaccord et pousse µ:schema à CHAQUE
// hello. Simplification volontaire vs core.ts : pas de suggestion Levenshtein sur un type de champ
// inconnu (poids mort pour un module client, message d'erreur simple à la place) — tout le reste
// (garde AJOUT-SEUL, tolérance champ manquant → zéro, throw structurel sur schéma/id inconnu,
// définition copiée profondément et gelée à la déclaration, nom de champ refusé s'il ne survit pas à
// un objet ordinaire) identique.
//
//   µ.schema('pos', { x: 'i16', y: 'i16' })        # déclare/complète le registre CLIENT — UN SEUL
//                                                     par appli, jamais par socket (µ._mjs_mjschemaRegistry)
//   µ.list('str8') / µ.bits(['vivant', 'vip'])      # mêmes helpers que côté serveur (modularjs-framework/ws)
//   sock = µ.socket(url)                             # hello porte schemaHash si un registre existe
//   sock.send('pos', { x: 1, y: 2 })                 # binaire AUTOMATIQUE si 'pos' a un schéma déclaré
//   sock.on('pos', (p) -> …)                          # AUCUNE différence, binaire ou JSON — invisible
//
// Déclaration PARTAGÉE (recommandé) : un fichier .mjs/.civet/.js commun à l'appli, importé À LA FOIS
// par l'entry serveur (`app.schema(...)`, cf. docs/23-mjs-ws.md §3.1) et un composant client
// (`µ.schema(...)`) — MÊMES noms/types/ORDRE des deux côtés ⇒ MÊME hash ⇒ jamais de µ:schema poussée.
// Alternative paresseuse : ne rien déclarer côté client — hello porte quand même un schemaHash (celui
// du registre VIDE, cf. µ._mjs_mjschemaHelloHash), qui ne concordera JAMAIS avec un serveur qui a des
// schémas → celui-ci pousse µ:schema à CHAQUE connexion (1 aller-retour de plus, zéro fichier à tenir
// synchronisé à la main).
//
// binary:false — coupe-circuit ENVOI SEUL (cf. µ._mjs_mjschemaEncode) : `sock.send()` reste TOUJOURS JSON
// pour CE socket, quel que soit le schéma du type. La RÉCEPTION, elle, décode TOUJOURS une trame
// binaire entrante — l'encodage SORTANT est une décision 100% SERVEUR (`ws.codec`, cf.
// mjs-ws/core.ts::sendRaw), indépendante de ce que ce client annonce dans son hello ; un client qui
// arrêterait AUSSI de décoder deviendrait sourd aux messages légitimes dès que le serveur encode en
// binaire — seul l'envoi est un choix local sûr à couper.
//
// Limite ACTÉE (cf. src/schema/core.ts) : l'enveloppe binaire ne porte AUCUN id de
// corrélation → jamais utilisée pour sock.request() (accusés de réception, rares) — un frame avec
// `id` reste TOUJOURS JSON, même si son type a un schéma déclaré (cf. µ._mjs_mjschemaEncode).
//
// Fichier AUTONOME : il s'évalue aussi seul, sans le cœur (`new Function('µ', source)(µ)`, test Node d'une application qui
// éprouve son fil binaire). Ce qu'il demande au cœur, il le pose lui-même quand il manque : le texte des messages
// (`µ._mjs_txt`, mjs_init.ts : sans la table, le texte français de secours, variables posées) et le journal (`µ.error`,
// `µ.warn` : la console). Dans un build, le cœur est toujours évalué avant lui : rien de tout cela ne sert.
if (typeof µ._mjs_txt !== 'function') {
  µ._mjs_txt = function(key, vars, fr) {
    return String(fr == null ? key : fr).replace(/\{(\w+)\}/g, function(m, n) { return vars && Object.prototype.hasOwnProperty.call(vars, n) ? String(vars[n]) : m; });
  };
}
if (typeof µ.error !== 'function') { µ.error = function(...args) { console.error(...args); }; }
if (typeof µ.warn !== 'function') { µ.warn = function(...args) { console.warn(...args); }; }

// --- registre pur (port de src/schema/core.ts) ---------------------------------------------------

var MJSCHEMA_SCALARS = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f32', 'f64', 'bool', 'str8', 'str16'];

// un nom de champ doit survivre à `{}[nom] = valeur` (objet ORDINAIRE) — sinon il serait perdu en
// silence quelque part en aval (décalage d'offset au décodage, jamais signalé) : '__proto__'
// déclenche le setter hérité d'Object.prototype (qui tente de changer le PROTOTYPE de l'objet
// plutôt que d'y créer une propriété) au lieu de survivre comme un nom normal. Sonde générique (pas
// une liste figée de noms interdits) — DOIT rester en accord avec validateFieldName
// (src/schema/core.ts, MÊME principe).
function _mjschemaValidFieldName(name) {
  var probe = {};
  probe[name] = 1;
  return Object.prototype.hasOwnProperty.call(probe, name);
}

// copie PROFONDE + gel — `champs` (et les objets list()/bits() qu'il contient) est fourni par
// l'appelant, qui peut le muter APRÈS coup (objet littéral réutilisé, partagé, relu ailleurs) : sans
// clone, mjschemaDefSchema stockait la RÉFÉRENCE telle quelle, une mutation externe changeait le
// format encodé/le hash EN SILENCE, sans jamais repasser par la garde ajout-seul. MÊME principe que
// clonerChamps (src/schema/core.ts).
function _mjschemaCloneType(type) {
  if (typeof type === 'string') { return type; }
  if (type.kind === 'list') { return Object.freeze({ kind: 'list', of: type.of }); }
  return Object.freeze({ kind: 'bits', names: Object.freeze(type.names.slice()) });
}

function _mjschemaCloneFields(fields) {
  var copy = Object.create(null), keys = Object.keys(fields), i;
  for (i = 0; i < keys.length; i++) { copy[keys[i]] = _mjschemaCloneType(fields[keys[i]]); }
  return Object.freeze(copy);
}

function _mjschemaCheckType(schemaName, fieldName, type) {
  if (typeof type === 'string') {
    if (MJSCHEMA_SCALARS.indexOf(type) !== -1) { return; }
    throw new Error('[µ.schema] ' + µ._mjs_txt('schemaUnknownType', { schemaName: schemaName, fieldName: fieldName, type: type, scalars: MJSCHEMA_SCALARS.join(', ') }, 'schéma \'{schemaName}\', champ \'{fieldName}\' : type inconnu \'{type}\' — types valides : {scalars}, list(type), bits([noms])'));
  }
  if (type.kind === 'list') {
    if (MJSCHEMA_SCALARS.indexOf(type.of) === -1) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaListType', { schemaName: schemaName, fieldName: fieldName, scalars: MJSCHEMA_SCALARS.join(', '), of: type.of }, 'schéma \'{schemaName}\', champ \'{fieldName}\' : list() attend un type scalaire ({scalars}) — sous-schémas/list imbriquée non supportés, reçu \'{of}\'')); }
    return;
  }
  if (type.kind === 'bits') {
    if (!Array.isArray(type.names) || type.names.length === 0) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaBitsEmpty', { schemaName: schemaName, fieldName: fieldName }, 'schéma \'{schemaName}\', champ \'{fieldName}\' : bits() attend un tableau de noms non vide')); }
    if (type.names.length > 8) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaBitsMax', { schemaName: schemaName, fieldName: fieldName, count: type.names.length }, 'schéma \'{schemaName}\', champ \'{fieldName}\' : bits() accepte au plus 8 booléens (reçu {count})')); }
    // parité serveur (src/schema/core.ts::validateType) — des noms en double étaient
    // acceptés ICI et refusés côté serveur : même refus, même id attribué en vain sinon.
    if (new Set(type.names).size !== type.names.length) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaBitsDup', { schemaName: schemaName, fieldName: fieldName }, 'schéma \'{schemaName}\', champ \'{fieldName}\' : bits() — noms en double')); }
    // un nom de bits() devient une clé de l'objet décodé : même garde qu'un nom de champ (parité serveur)
    for (var i = 0; i < type.names.length; i++) {
      if (!_mjschemaValidFieldName(type.names[i])) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaFieldName', { name: schemaName, field: type.names[i] }, 'schéma \'{name}\' : nom de champ invalide \'{field}\' — ne survit pas à un objet ordinaire ({}[nom] = valeur), ex. \'__proto__\'')); }
    }
    return;
  }
  throw new Error('[µ.schema] ' + µ._mjs_txt('schemaFieldInvalid', { schemaName: schemaName, fieldName: fieldName }, 'schéma \'{schemaName}\', champ \'{fieldName}\' : type de champ invalide (ni chaîne scalaire, ni list(), ni bits())'));
}

function _mjschemaSameType(a, b) {
  if (typeof a === 'string' || typeof b === 'string') { return a === b; }
  if (a.kind !== b.kind) { return false; }
  if (a.kind === 'list') { return a.of === b.of; }
  if (a.names.length !== b.names.length) { return false; }
  for (var i = 0; i < a.names.length; i++) { if (a.names[i] !== b.names[i]) { return false; } }
  return true;
}

function _mjschemaSameShape(a, b) {
  var ka = Object.keys(a), kb = Object.keys(b), i;
  if (ka.length !== kb.length) { return false; }
  for (i = 0; i < ka.length; i++) { if (ka[i] !== kb[i] || !_mjschemaSameType(a[ka[i]], b[kb[i]])) { return false; } }
  return true;
}

// bits(names) DOIT lui aussi passer par JSON.stringify (jamais une jointure '+' brute) — MÊME raison
// que le hash des noms de champs plus bas : bits(['a+b','c']) (2 sous-champs), bits(['a','b','c'])
// (3 sous-champs) et bits(['a','b+c']) donnaient AUPARAVANT le MÊME texte joint ('a+b+c') malgré des
// découpages/sémantiques différents — DOIT rester caractère pour caractère identique à
// src/schema/core.ts::decrireType.
function _mjschemaDescribeType(t) {
  if (typeof t === 'string') { return t; }
  return t.kind === 'list' ? ('list(' + t.of + ')') : ('bits(' + JSON.stringify(t.names) + ')');
}

function mjschemaCreateRegistry() {
  return { byName: new Map(), byId: [] };
}

/** cf. defineSchema (src/schema/core.ts) — même garde AJOUT-SEUL, mêmes ids u8 attribués dans l'ORDRE
 *  de déclaration ; ré-affirmation IDENTIQUE = no-op silencieux (composant remonté/HMR), forme
 *  DIFFÉRENTE = throw clair. `inputFields` est copié PROFONDÉMENT et gelé AVANT toute validation/
 *  stockage (cf. _mjschemaCloneFields) — la définition retenue est désormais IMMUABLE, indépendante
 *  de l'objet appelant. */
function mjschemaDefSchema(registry, name, inputFields) {
  var fields = _mjschemaCloneFields(inputFields), order = Object.freeze(Object.keys(fields)), i, existing, def;
  for (i = 0; i < order.length; i++) {
    if (!_mjschemaValidFieldName(order[i])) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaFieldName', { name: name, field: order[i] }, 'schéma \'{name}\' : nom de champ invalide \'{field}\' — ne survit pas à un objet ordinaire ({}[nom] = valeur), ex. \'__proto__\'')); }
    _mjschemaCheckType(name, order[i], fields[order[i]]);
  }

  existing = registry.byName.get(name);
  if (existing) {
    if (!_mjschemaSameShape(existing.fields, fields)) {
      throw new Error('[µ.schema] ' + µ._mjs_txt('schemaRedeclared', { name: name }, 'schéma \'{name}\' déjà déclaré avec une forme différente — garde AJOUT-SEUL : un schéma existant est IMMUABLE, déclarez un NOM neuf pour faire évoluer le protocole.'));
    }
    return existing;
  }
  if (registry.byId.length >= 256) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaRegistryFull', { name: name }, 'registre plein — 256 schémas déjà déclarés (id u8 épuisé), impossible d\'ajouter \'{name}\'')); }
  def = { id: registry.byId.length, name: name, fields: fields, order: order };
  registry.byName.set(name, def);
  registry.byId.push(def);
  return def;
}

// --- encodage/décodage bas niveau — DataView little-endian, deux passes (mesure puis écriture) ----

var _mjschemaUtf8Encoder = new TextEncoder();
var _mjschemaUtf8Decoder = new TextDecoder('utf-8');

function _mjschemaFixedScalarSize(t) {
  switch (t) {
    case 'u8': case 'i8': case 'bool': return 1;
    case 'u16': case 'i16': return 2;
    case 'u32': case 'i32': case 'f32': return 4;
    case 'f64': return 8;
    default: return null;
  }
}

// nombre fini par défaut — une valeur absente/non numérique s'encode en 0 plutôt que de faire planter
// l'envoi (même politique de tolérance que src/schema/core.ts::numOr0).
function _mjschemaNumOr0(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

// un champ flottant écrit tout nombre, Infinity, -Infinity et NaN compris (même règle que src/schema/core.ts::flottant)
function _mjschemaFloat(v) {
  return typeof v === 'number' ? v : _mjschemaNumOr0(v);
}

// propriété lue sur l'objet à encoder — jamais celle qu'Object.prototype prête à tout objet (cf. lireCle,
// src/schema/core.ts) ; un getter posé par une classe reste lu
function _mjschemaReadKey(o, key) {
  if (o == null) { return undefined; }
  if (key in Object.prototype && !Object.prototype.hasOwnProperty.call(o, key)) { return undefined; }
  return o[key];
}

// plage de chaque entier : une valeur hors plage lève au lieu d'arriver repliée (cf. verifierPlage, src/schema/core.ts)
var _MJSCHEMA_RANGES = { u8: [0, 255], i8: [-128, 127], u16: [0, 65535], i16: [-32768, 32767], u32: [0, 4294967295], i32: [-2147483648, 2147483647] };

function _mjschemaCheckRange(schemaName, field, index, t, value) {
  var range = _MJSCHEMA_RANGES[t], n;
  if (!range) { return; }
  n = Math.trunc(_mjschemaNumOr0(value));
  // infini ou NaN : hors plage aussi (cf. verifierPlage, src/schema/core.ts)
  if (n < range[0] || n > range[1] || Math.abs(Number(value)) === Infinity || Number.isNaN(value)) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaOutOfRange', { schemaName: schemaName, fieldName: index >= 0 ? field + '[' + index + ']' : field, value: String(value), t: t, min: range[0], max: range[1] }, 'schéma \'{schemaName}\', champ \'{fieldName}\' : {value} est hors de la plage de {t} ({min} à {max}) — la valeur arriverait repliée. Choisissez un type plus large, ou bornez la valeur avant l\'envoi.')); }
}

// `chaines` : octets UTF-8 encodés UNE fois à la mesure, recopiés à l'écriture (cf. Chaines, src/schema/core.ts)
function _mjschemaMeasureScalar(t, value, strings, schemaName, field, index) {
  var fixed = _mjschemaFixedScalarSize(t), bytes, max;
  if (fixed != null) {
    _mjschemaCheckRange(schemaName, field, index, t, value);
    return fixed;
  }
  bytes = _mjschemaUtf8Encoder.encode(String(value == null ? '' : value));
  max = t === 'str8' ? 255 : 65535;
  if (bytes.byteLength > max) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaStringTooLong', { t: t, bytes: bytes.byteLength, max: max }, 'chaîne trop longue pour {t} ({bytes} octets UTF-8, max {max})')); }
  strings.bytes.push(bytes);
  return (t === 'str8' ? 1 : 2) + bytes.byteLength;
}

function _mjschemaMeasureField(type, value, strings, schemaName, field) {
  var arr, total, i;
  if (typeof type === 'string') { return _mjschemaMeasureScalar(type, value, strings, schemaName, field, -1); }
  if (type.kind === 'bits') { return 1; }
  arr = Array.isArray(value) ? value : [];
  if (arr.length > 65535) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaListTooLong', { of: type.of, count: arr.length }, 'list({of}) : {count} éléments, max 65535 (compteur u16)')); }
  total = 2;
  for (i = 0; i < arr.length; i++) { total += _mjschemaMeasureScalar(type.of, arr[i], strings, schemaName, field, i); }
  return total;
}

function _mjschemaWriteScalar(view, offset, t, value, strings) {
  var bytes;
  switch (t) {
    case 'u8':   view.setUint8(offset, _mjschemaNumOr0(value) & 0xFF); return offset + 1;
    case 'i8':   view.setInt8(offset, _mjschemaNumOr0(value)); return offset + 1;
    case 'bool': view.setUint8(offset, value ? 1 : 0); return offset + 1;
    case 'u16':  view.setUint16(offset, _mjschemaNumOr0(value), true); return offset + 2;
    case 'i16':  view.setInt16(offset, _mjschemaNumOr0(value), true); return offset + 2;
    case 'u32':  view.setUint32(offset, _mjschemaNumOr0(value), true); return offset + 4;
    case 'i32':  view.setInt32(offset, _mjschemaNumOr0(value), true); return offset + 4;
    case 'f32':  view.setFloat32(offset, _mjschemaFloat(value), true); return offset + 4;
    case 'f64':  view.setFloat64(offset, _mjschemaFloat(value), true); return offset + 8;
    case 'str8': case 'str16':
      bytes = strings.bytes[strings.i++];
      if (t === 'str8') { view.setUint8(offset, bytes.byteLength); offset += 1; }
      else { view.setUint16(offset, bytes.byteLength, true); offset += 2; }
      new Uint8Array(view.buffer, view.byteOffset + offset, bytes.byteLength).set(bytes);
      return offset + bytes.byteLength;
  }
}

function _mjschemaWriteField(view, offset, type, value, strings) {
  var octet, i, arr;
  if (typeof type === 'string') { return _mjschemaWriteScalar(view, offset, type, value, strings); }
  if (type.kind === 'bits') {
    octet = 0;
    for (i = 0; i < type.names.length; i++) { if (_mjschemaReadKey(value, type.names[i])) { octet |= (1 << i); } }
    view.setUint8(offset, octet);
    return offset + 1;
  }
  arr = Array.isArray(value) ? value : [];
  view.setUint16(offset, arr.length, true);
  offset += 2;
  for (i = 0; i < arr.length; i++) { offset = _mjschemaWriteScalar(view, offset, type.of, arr[i], strings); }
  return offset;
}

// SÉCURITÉ — port de bornerLecture (src/schema/core.ts) : `vue` peut être la
// fenêtre d'un buffer PLUS GRAND (transport WebSocket, tampon partagé) — sans cette garde, un str8/
// str16 dont la longueur annoncée dépasse la fenêtre lit des octets VOISINS hors trame (fuite heap),
// et un compteur de list trop grand lève un RangeError brut du DataView, non nommé.
function _mjschemaBoundRead(offset, size, view) {
  if (offset + size > view.byteLength) { throw new RangeError('[µ.schema] ' + µ._mjs_txt('schemaDecodeOutOfFrame', { offset: offset, size: size, frame: view.byteLength }, 'decode() : lecture hors de la trame (offset {offset}, {size} octets, trame de {frame})')); }
}

function _mjschemaReadScalar(view, offset, t) {
  var len, bytes;
  switch (t) {
    case 'u8':   _mjschemaBoundRead(offset, 1, view); return [view.getUint8(offset), offset + 1];
    case 'i8':   _mjschemaBoundRead(offset, 1, view); return [view.getInt8(offset), offset + 1];
    case 'bool': _mjschemaBoundRead(offset, 1, view); return [view.getUint8(offset) !== 0, offset + 1];
    case 'u16':  _mjschemaBoundRead(offset, 2, view); return [view.getUint16(offset, true), offset + 2];
    case 'i16':  _mjschemaBoundRead(offset, 2, view); return [view.getInt16(offset, true), offset + 2];
    case 'u32':  _mjschemaBoundRead(offset, 4, view); return [view.getUint32(offset, true), offset + 4];
    case 'i32':  _mjschemaBoundRead(offset, 4, view); return [view.getInt32(offset, true), offset + 4];
    case 'f32':  _mjschemaBoundRead(offset, 4, view); return [view.getFloat32(offset, true), offset + 4];
    case 'f64':  _mjschemaBoundRead(offset, 8, view); return [view.getFloat64(offset, true), offset + 8];
    case 'str8': case 'str16':
      if (t === 'str8') { _mjschemaBoundRead(offset, 1, view); len = view.getUint8(offset); offset += 1; }
      else { _mjschemaBoundRead(offset, 2, view); len = view.getUint16(offset, true); offset += 2; }
      _mjschemaBoundRead(offset, len, view);
      bytes = new Uint8Array(view.buffer, view.byteOffset + offset, len);
      return [_mjschemaUtf8Decoder.decode(bytes), offset + len];
  }
}

function _mjschemaReadField(view, offset, type) {
  var octet, out, i, n, res;
  if (typeof type === 'string') { return _mjschemaReadScalar(view, offset, type); }
  if (type.kind === 'bits') {
    _mjschemaBoundRead(offset, 1, view);
    octet = view.getUint8(offset);
    out = {};
    for (i = 0; i < type.names.length; i++) { out[type.names[i]] = !!(octet & (1 << i)); }
    return [out, offset + 1];
  }
  _mjschemaBoundRead(offset, 2, view);
  n = view.getUint16(offset, true);
  offset += 2;
  out = [];
  for (i = 0; i < n; i++) {
    res = _mjschemaReadScalar(view, offset, type.of);
    out.push(res[0]);
    offset = res[1];
  }
  return [out, offset];
}

// --- API haut niveau — encode(nom, objet) / decode(bytes), enveloppe [u8 id][charge] --------------

function mjschemaEncode(registry, name, object) {
  var def = registry.byName.get(name), o, size, i, c, buffer, view, offset, strings = { bytes: [], i: 0 };
  if (!def) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaEncodeUnknown', { name: name }, 'encode() : schéma inconnu \'{name}\' — déclarez-le d\'abord (µ.schema)')); }
  o = object || {};
  size = 1;
  for (i = 0; i < def.order.length; i++) { c = def.order[i]; size += _mjschemaMeasureField(def.fields[c], _mjschemaReadKey(o, c), strings, name, c); }
  buffer = new ArrayBuffer(size);
  view = new DataView(buffer);
  view.setUint8(0, def.id);
  offset = 1;
  for (i = 0; i < def.order.length; i++) { c = def.order[i]; offset = _mjschemaWriteField(view, offset, def.fields[c], _mjschemaReadKey(o, c), strings); }
  return new Uint8Array(buffer);
}

/** `bytes` peut être une VUE (sous-tableau) d'un buffer plus grand — DataView construite avec
 *  byteOffset/byteLength explicites, jamais `bytes.buffer` seul (cf. src/schema/core.ts::decode). */
function mjschemaDecode(registry, bytes) {
  var id, def, view, offset, object, i, c, res;
  if (bytes.byteLength < 1) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaDecodeEmpty', null, 'decode() : trame vide, octet id de schéma attendu')); }
  id = bytes[0];
  def = registry.byId[id];
  if (!def) { throw new Error('[µ.schema] ' + µ._mjs_txt('schemaDecodeUnknownId', { id: id }, 'decode() : id de schéma inconnu ({id}) — registre local incomplet ou désynchronisé')); }
  view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  offset = 1;
  object = {};
  for (i = 0; i < def.order.length; i++) {
    c = def.order[i];
    res = _mjschemaReadField(view, offset, def.fields[c]);
    object[c] = res[0];
    offset = res[1];
  }
  return { name: def.name, object: object };
}

// --- hash stable du registre — FNV-1a 32 bits, hex — dépend des noms + types + ORDRE de déclaration,
// DOIT rester caractère pour caractère identique à src/schema/core.ts::fnv1a/hashRegistry (cf. tête
// de fichier : un désaccord d'algorithme entre client et serveur produirait un hash différent même
// pour des schémas IDENTIQUES, et le serveur pousserait µ:schema à CHAQUE hello sans raison réelle) --

function _mjschemaFnv1a(s) {
  var h = 0x811c9dc5, i;
  for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// hashé sur une sérialisation JSON (jamais une concaténation brute par ':'/'='/','/'|') — un nom de
// SCHÉMA ou de CHAMP peut contenir n'importe quel caractère, y compris ceux utilisés comme
// séparateurs : { 'b=u8,c': 'u8' } (1 champ) et { b: 'u8', c: 'u8' } (2 champs) donnaient AUPARAVANT
// le MÊME texte concaténé malgré des trames de 2 et 3 octets — collision structurelle qui trompait
// la vérification de compatibilité client/serveur. JSON.stringify échappe nativement guillemets/
// antislashs DANS chaque chaîne — DOIT rester caractère pour caractère identique à
// src/schema/core.ts::hashRegistry (MÊME structure imbriquée [nom, [[champ, type], ...]] passée à
// JSON.stringify), cf. commentaire de tête de fichier.
function mjschemaHashRegistry(registry) {
  var parts = [], i, def, pairs, j;
  for (i = 0; i < registry.byId.length; i++) {
    def = registry.byId[i];
    pairs = [];
    for (j = 0; j < def.order.length; j++) { pairs.push([def.order[j], _mjschemaDescribeType(def.fields[def.order[j]])]); }
    parts.push(JSON.stringify([def.name, pairs]));
  }
  return _mjschemaFnv1a(parts.join('|'));
}

// --- réception d'un µ:schema — reconstruit un registre COMPLET depuis des définitions JSON-safe (cf.
// mjs-ws/schema.ts::serializeDefinitions côté serveur) : `fields` voyage en tableau de paires
// [nom, type] (pas un objet — les clés d'un message réseau ne sont jamais indexées aveuglément sur un
// objet PLAT), rechargé via mjschemaDefSchema (mêmes gardes, mêmes ids puisque `schemas` est déjà
// dans l'ordre d'origine). Un nom de champ fautif (__proto__) est refusé par mjschemaDefSchema —
// _mjs_mjschemaOnPush (plus bas) capte alors l'erreur et laisse le registre local INCHANGÉ, jamais
// remplacé par une définition amputée du champ fautif. ---------------------------------------------

function mjschemaLoadDefinitions(json) {
  // Object.create(null) (pas `{}`) — l'affectation `champs[...] = ...` juste en dessous ne doit
  // jamais activer le setter '__proto__' hérité d'Object.prototype : une clé '__proto__' reçue du
  // réseau doit survivre TELLE QUELLE jusqu'à mjschemaDefSchema (qui la refusera avec une erreur
  // claire, cf. _mjschemaValidFieldName) — la filtrer ICI en silence (ancien _mjschemaSafeKey)
  // installait un registre AMPUTÉ du champ fautif au lieu de refuser la définition entière, MÊME
  // principe que loadDefinitions, src/schema/core.ts.
  var registry = mjschemaCreateRegistry(), i, s, fields, j, pair;
  for (i = 0; i < json.schemas.length; i++) {
    s = json.schemas[i];
    fields = Object.create(null);
    for (j = 0; j < s.fields.length; j++) {
      pair = s.fields[j];
      fields[pair[0]] = pair[1];
    }
    mjschemaDefSchema(registry, s.name, fields);
  }
  return registry;
}

// --- API applicative — µ.schema()/µ.list()/µ.bits(), UN SEUL registre CLIENT partagé par toute
// l'appli (jamais par socket, cf. tête de fichier) ---------------------------------------------

µ._mjs_mjschemaRegistry = null;

/** µ.schema(name, fields) — déclare/complète le registre CLIENT (mêmes gardes que app.schema côté
 *  serveur, cf. docs/23-mjs-ws.md §3.1) : ré-affirmer À L'IDENTIQUE est un no-op (composant remonté),
 *  une forme DIFFÉRENTE lève clair. */
µ.schema = function(name, fields) {
  if (!µ._mjs_mjschemaRegistry) { µ._mjs_mjschemaRegistry = mjschemaCreateRegistry(); }
  return mjschemaDefSchema(µ._mjs_mjschemaRegistry, name, fields);
};

/** mêmes helpers que `import { list, bits } from 'modularjs-framework/ws'` côté serveur — cf. docs/23-mjs-ws.md
 *  §3.1 pour le vocabulaire complet des types de champ. */
µ.list = function(of) { return { kind: 'list', of: of }; };
µ.bits = function(names) { return { kind: 'bits', names: names }; };

// --- points d'extension consommés par mjs_socket.ts (cf. ses propres commentaires « extension
// MINIME » — absents si ce fichier n'est pas chargé, chaque call-site garde `if (µ._mjschemaXxx)`) --

// hello — hash du registre CLIENT courant, TOUJOURS une chaîne (même « rien de déclaré » a un hash —
// celui du registre VIDE) dès que ce module est chargé. VÉRIFIÉ AU BANC contre le serveur réel
// (mjs-ws/core.ts::pushSchemaIfMismatch) : `if (!schemaEngine.hasSchemas || clientHash == null) return`
// — le serveur ne pousse JAMAIS µ:schema si `clientHash` est ABSENT (« jamais de µ:schema pour rien »,
// cf. son propre commentaire), MÊME s'il a des schémas à offrir. Un client qui n'aurait rien déclaré
// et omettrait purement et simplement `schemaHash` resterait donc à vie SANS le registre serveur — le
// scénario de bootstrap paresseux (cf. tête de fichier « alternative paresseuse ») exige donc
// d'ANNONCER un hash MÊME vide, pour que le serveur détecte le désaccord et pousse sa définition.
µ._mjs_mjschemaHelloHash = function() {
  return mjschemaHashRegistry(µ._mjs_mjschemaRegistry || mjschemaCreateRegistry());
};

// envoi — `null` = rester JSON (comportement historique, cf. mjs_socket.ts::_mjs_rawSend). Binaire SSI : pas
// de coupe-circuit (sock.opts.binary !== false), jamais un frame à `id` (sock.request) ni `seq` (delta
// de flux — le fil binaire ne porte AUCUNE corrélation ni numéro de séquence, cf. tête de fichier),
// jamais une trame µ: de contrôle, ET le type a un schéma déclaré dans le registre CLIENT courant.
µ._mjs_mjschemaEncode = function(sock, obj) {
  var t, registry;
  if (sock.opts && sock.opts.binary === false) { return null; }
  if (obj.id != null || obj.seq != null) { return null; }
  t = obj.t;
  if (typeof t !== 'string' || t.indexOf('µ:') === 0) { return null; }
  registry = µ._mjs_mjschemaRegistry;
  if (!registry || !registry.byName.has(t)) { return null; }
  try { return mjschemaEncode(registry, t, obj.p); }
  catch (e) { µ.error('[µ.schema] ' + µ._mjs_txt('schemaEncodeFailed', null, 'encodage en échec, envoi en JSON'), e); return null; }
};

// id de schéma inconnu à la réception — averti UNE SEULE FOIS par id (pas 1 fois par trame, sinon un
// flux continu de trames illisibles spammerait la console), même esprit que le throttle serveur
// (mjs-ws/schema.ts::sendThrottledError) mais côté client (pas de fenêtre temporelle : juste jamais 2×).
var _mjschemaWarnedIds = {};
function _mjschemaWarnUnknownId(id) {
  if (_mjschemaWarnedIds[id]) { return; }
  _mjschemaWarnedIds[id] = true;
  µ.warn('[µ.schema] ' + µ._mjs_txt('schemaUnknownIdReceived', { id: id }, 'id de schéma inconnu ({id}) reçu — registre local désynchronisé (en attente d\'un µ:schema ?)'));
}

// réception — trame BINAIRE (ArrayBuffer natif navigateur avec binaryType='arraybuffer', ou Uint8Array
// déjà normalisé par un transport de test, cf. mjs-ws/transport.ts) → décodée puis dispatchée dans le
// circuit sock.on NORMAL, EXACTEMENT comme un message texte (cf. MjsSocket.prototype._mjs_dispatch) —
// invisible pour l'appli. Aucun registre local, ou id hors registre : trame illisible, silence (même
// politique que le serveur en mode 'auto'/'json', cf. mjs-ws/schema.ts) plutôt qu'un crash.
µ._mjs_mjschemaOnBinary = function(sock, data) {
  var registry, bytes, id, decoded;
  if (µ._mjs_mjschemaSwapping) { µ._mjs_mjschemaBuffered.push({ sock: sock, data: data }); return; }
  registry = µ._mjs_mjschemaRegistry;
  if (!registry) { return; }
  bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 1) { return; }
  id = bytes[0];
  if (!registry.byId[id]) { _mjschemaWarnUnknownId(id); return; }
  try { decoded = mjschemaDecode(registry, bytes); }
  catch (e) { µ.error('[µ.schema] ' + µ._mjs_txt('schemaDecodeFailed', null, 'décodage en échec (trame corrompue ?)'), e); return; }
  sock._mjs_dispatch(decoded.name, { t: decoded.name, p: decoded.object });
};

// µ:schema reçu — remplace le registre CLIENT en bloc (loadDefinitions reconstruit à partir de
// zéro, MÊMES ids que le serveur puisque `definitions.schemas` est déjà dans l'ordre d'origine). Court
// tampon anti-course : toute trame binaire reçue PENDANT le remplacement est rejouée juste
// après plutôt que perdue — en pratique JS est mono-thread et ce remplacement est 100% synchrone, donc
// aucune trame ne peut matériellement arriver entre les deux lignes ; filet de sécurité qui ne coûte
// rien plutôt qu'une course réellement observée au banc.
µ._mjs_mjschemaSwapping = false;
µ._mjs_mjschemaBuffered  = [];

µ._mjs_mjschemaOnPush = function(sock, msg) {
  var p = msg.p || {}, buffered, i;
  µ._mjs_mjschemaSwapping = true;
  try { µ._mjs_mjschemaRegistry = mjschemaLoadDefinitions(p.definitions); }
  catch (e) { µ.error('[µ.schema] ' + µ._mjs_txt('schemaDefsInvalid', null, 'définitions µ:schema invalides, registre local INCHANGÉ'), e); }
  µ._mjs_mjschemaSwapping = false;
  buffered = µ._mjs_mjschemaBuffered;
  µ._mjs_mjschemaBuffered = [];
  for (i = 0; i < buffered.length; i++) { µ._mjs_mjschemaOnBinary(buffered[i].sock, buffered[i].data); }
};
