// effects-app — les effets qu'une appli déclare dans ses fichiers `*.effects.mjs` (un bloc <effects>), lus sans VS Code
// (extension.js lit les fichiers de l'espace de travail, et les relit à chaque enregistrement) :
//
//   *titre = *scramble(311, on: click)         un effet de la bibliothèque réglé une fois pour toutes
//   *grand_titre = *titre(order: center)       un effet de l'appli réglé à son tour
//   *filter.net = *filter(sepia, amount: 0.5)  un alias, rattaché à son effet (il remplace celui de ModularJS de même nom)
//   *halo(color: #0ff, size: 12px) =           un effet CSS : ses réglages et leur défaut, puis ses déclarations
//     box-shadow: 0 0 $size $color
//
// La lecture ne lève jamais : une déclaration que le build refuserait est sautée, les autres restent connues

const EFFECTS = require('./effects.json');

// l'entrée `k` de `o`, null s'il ne la porte pas lui-même : `toString`, `constructor` viennent d'Object
function entry(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null;
}

/** un fichier d'effets, d'après son chemin : `titres.effects.mjs` */
function isEffectsFile(path) {
  return /\.effects\.mjs$/.test(path);
}

// la parenthèse qui ferme celle ouverte en `i` (guillemets respectés), -1 sinon
function closing(s, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (quote) {
      if (ch === '\\') j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return j;
  }
  return -1;
}

/** des réglages écrits, coupés aux virgules de premier niveau (hors parenthèses, crochets, guillemets) */
function splitTop(raw) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur   = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < raw.length) cur += raw[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

// une ligne qui n'est qu'un commentaire (`// …`, `/* … */`), retirée comme le fait SASS
function isComment(text) {
  const t = text.trim();
  return t.startsWith('//') || /^\/\*[\s\S]*\*\/$/.test(t);
}

// une déclaration sans son commentaire `//` de fin, écrit hors des parenthèses et des guillemets
function withoutComment(text) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '/' && text[i + 1] === '/' && depth === 0) return text.slice(0, i).trimEnd();
  }
  return text;
}

// une ligne de déclaration → { name, target, args } (un effet réglé), { name, params } (un effet CSS), null si elle ne se lit pas
function declaration(text) {
  const m = /^\*([A-Za-z][\w-]*)(?:\.([^\s=(]*))?\s*([\s\S]*)$/.exec(text);
  if (!m) return null;
  if (m[2] !== undefined && !/^[a-z][a-z0-9_]*$/.test(m[2])) return null;
  const name = m[2] === undefined ? m[1] : m[1] + '.' + m[2];
  let rest   = m[3];
  let params = null;
  if (rest.startsWith('(')) {
    const end = closing(rest, 0);
    if (end < 0) return null;
    params = rest.slice(1, end);
    rest   = rest.slice(end + 1).trim();
  }
  if (!rest.startsWith('=')) return null;
  rest = rest.slice(1).trim();
  if (rest === '') {
    // un effet CSS : chacun de ses réglages a son nom et sa valeur par défaut
    const pairs = [];
    for (const item of params === null ? [] : splitTop(params)) {
      const pm = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]+)$/.exec(item);
      if (!pm) return null;
      pairs.push([pm[1], pm[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')]);
    }
    return m[2] === undefined ? { name: name, params: pairs } : null;
  }
  if (params !== null) return null;
  const target = /^\*([A-Za-z][\w-]*)([\s\S]*)$/.exec(rest);
  if (!target) return null;
  if (target[2] === '') return { name: name, target: target[1], args: '' };
  if (!target[2].startsWith('(') || closing(target[2], 0) !== target[2].length - 1) return null;
  return { name: name, target: target[1], args: target[2].slice(1, -1).trim() };
}

/** les effets déclarés dans le bloc <effects> d'un fichier, dans leur ordre : leur nom, leur ligne (comptée depuis 1), l'effet qu'ils
 * règlent et leurs réglages écrits, ou, pour un effet CSS, ses réglages et leur défaut, et s'il porte des `@keyframes` (`animated`) */
function readEffectsFile(text) {
  const open = /<effects\b[^>]*>/.exec(text);
  if (!open) return [];
  const from  = open.index + open[0].length;
  const close = text.indexOf('</effects', from);
  const first = text.slice(0, from).split('\n').length;
  const lines = text.slice(from, close < 0 ? text.length : close).split('\n').map(function(t, i) {
    return { text: t.replace(/\s+$/, ''), indent: /^[ \t]*/.exec(t)[0].replace(/\t/g, '  ').length, line: first + i };
  }).filter(function(l) { return l.text.trim() !== '' && !isComment(l.text); });
  if (lines.length === 0) return [];
  const base = lines[0].indent;
  const out  = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indent !== base) continue;
    const d = declaration(withoutComment(lines[i].text.trim()));
    if (!d) continue;
    // ce qui suit, plus en retrait : le CSS d'un effet CSS, rien sous un effet réglé
    const body = [];
    for (let j = i + 1; j < lines.length && lines[j].indent > base; j++) body.push(lines[j].text.trim());
    if (d.params ? body.length === 0 : body.length > 0) continue;
    const found = { name: d.name, line: lines[i].line };
    if (d.params) {
      found.params   = d.params;
      found.animated = body.some(function(l) { return withoutComment(l) === '@keyframes'; });
    }
    else {
      found.target = d.target;
      found.args   = d.args;
    }
    out.push(found);
  }
  return out;
}

// les réglages écrits `args` d'un effet de la bibliothèque, par nom (un nom qu'il n'a pas est laissé : le build le refuse) ; une valeur
// sans nom va au premier des réglages `alt` dont elle est un mot permis (ou l'image, pour un réglage d'image), sinon au principal
function settingsOf(fx, args) {
  const out = {};
  for (const item of splitTop(args)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/.exec(item);
    if (kv) {
      if (entry(fx.settings, kv[1])) out[kv[1]] = kv[2].trim();
      continue;
    }
    const alt = (fx.alt || []).find(function(k) {
      const st = entry(fx.settings, k);
      if (!st) return false;
      return st.values ? st.values.includes(item.replace(/^(['"])([\s\S]*)\1$/, '$2')) : /\.(?:apng|avif|bmp|gif|ico|jfif|jpe?g|png|svg|tiff?|webp)\b|^µ/i.test(item);
    });
    out[alt || fx.main] = item;
  }
  return out;
}

/** les effets de l'appli, résolus, d'après le texte de chacun de ses fichiers d'effets (`{ chemin: texte }`) : par nom, l'effet de
 * la bibliothèque qu'ils règlent (`base`, à travers d'autres effets de l'appli) et les valeurs qu'ils lui donnent (`set`), ou, pour un
 * effet CSS, ses réglages (`params`) ; un effet qui ne se résout pas (cible inconnue, boucle) n'a que son écriture. Comme au build :
 * un nom pris par la bibliothèque, ou déjà défini (fichiers dans l'ordre de leur chemin), est écarté — la première définition reste */
function appEffects(files) {
  const written = Object.create(null);
  for (const file of Object.keys(files).sort()) {
    for (const d of readEffectsFile(files[file])) {
      if (entry(EFFECTS, d.name) || written[d.name]) continue;
      // un alias se rattache à l'effet de la bibliothèque qu'il règle : `*filter.net = *filter(…)`
      const dot = d.name.indexOf('.');
      if (dot > 0 && (!entry(EFFECTS, d.name.slice(0, dot)) || d.target !== d.name.slice(0, dot))) continue;
      written[d.name] = Object.assign({ file: file }, d);
    }
  }
  const out     = Object.create(null);
  const resolve = function(name, chain) {
    if (out[name]) return out[name];
    const d = written[name];
    const e = { name: name, file: d.file, line: d.line };
    if (d.params) return (out[name] = Object.assign(e, { params: d.params, animated: d.animated }));
    e.written = '*' + d.target + (d.args === '' ? '' : '(' + d.args + ')');
    const fx = entry(EFFECTS, d.target);
    if (fx) return (out[name] = Object.assign(e, { base: d.target, set: settingsOf(fx, d.args) }));
    if (!written[d.target] || chain.includes(d.target)) return (out[name] = e);
    const under = resolve(d.target, chain.concat(name));
    if (under.base) return (out[name] = Object.assign(e, { base: under.base, set: Object.assign({}, under.set, settingsOf(EFFECTS[under.base], d.args)) }));
    if (under.params) {
      // un effet CSS réglé : ses valeurs par défaut changées, une valeur sans nom pour son premier réglage
      const params = under.params.map(function(p) { return p.slice(); });
      for (const item of splitTop(d.args)) {
        const kv  = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/.exec(item);
        const key = kv ? kv[1] : params.length > 0 ? params[0][0] : null;
        const at  = params.findIndex(function(p) { return p[0] === key; });
        if (at >= 0) params[at][1] = (kv ? kv[2] : item).trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
      }
      return (out[name] = Object.assign(e, { params: params, animated: under.animated }));
    }
    return (out[name] = e);
  };
  for (const name of Object.keys(written)) resolve(name, [name]);
  return out;
}

/** les effets de l'appli d'un espace de travail, tenus à jour fichier par fichier : `put` quand un fichier d'effets est lu ou
 * enregistré, `drop` quand il disparaît ; `effects()` les rend résolus (cf. appEffects) */
function createStore() {
  const texts = Object.create(null);
  let effects = Object.create(null);
  return {
    put: function(file, text) {
      texts[file] = text;
      effects = appEffects(texts);
    },
    drop: function(file) {
      if (!(file in texts)) return;
      delete texts[file];
      effects = appEffects(texts);
    },
    effects: function() {
      return effects;
    }
  };
}

module.exports = { readEffectsFile: readEffectsFile, appEffects: appEffects, createStore: createStore, isEffectsFile: isEffectsFile };
