// effects-help — la complétion et l'aide au survol des effets `*nom(réglages)` d'un composant
// ModularJS, sans VS Code (extension.js les branche) : les effets viennent d'effects.json, tiré du
// catalogue du framework (script/vscode-effects.mjs)

const EFFECTS = require('./effects.json');

// un effet commence après une espace, un `=` (`@in=*fly`), un guillemet, une parenthèse, une virgule
// ou deux-points (`fx: *scramble`) — jamais au milieu d'un calcul (`{$a*$b}`, `{$a * 2}`)
const BEFORE_STAR = /(?:^|[\s="'(,:])$/;

// l'effet ouvert avant le curseur : `*nom(` dont la parenthèse n'est pas refermée — son nom et ce qui
// est déjà écrit entre ses parenthèses ; null hors d'un effet
function openEffect(before) {
  const stack = [];
  let quote = null;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    const top = stack[stack.length - 1];
    // les guillemets ne comptent que dans un effet (un attribut HTML en porte partout)
    if (top && (ch === '\'' || ch === '"')) {
      quote = ch;
      continue;
    }
    if (ch === '*' && BEFORE_STAR.test(before.slice(0, i))) {
      const m = /^\*([A-Za-z][\w-]*)\(/.exec(before.slice(i));
      if (m) {
        stack.push({ name: m[1], start: i + m[0].length, depth: 0 });
        i += m[0].length - 1;
        continue;
      }
    }
    if (!top) continue;
    if (ch === '(' || ch === '[') top.depth++;
    else if (ch === ')' || ch === ']') {
      if (top.depth > 0) top.depth--;
      else stack.pop();
    }
  }
  const last = stack[stack.length - 1];
  return last ? { name: last.name, args: before.slice(last.start) } : null;
}

// les réglages écrits, coupés aux virgules de premier niveau (hors parenthèses, crochets, guillemets)
function splitArgs(raw) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur   = '';
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
    }
    else if (ch === '\'' || ch === '"') quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const KEY = /^\s*([A-Za-z][\w-]*)\s*:/;

// l'entrée `k` de `o`, null s'il ne la porte pas lui-même : `toString`, `constructor` viennent d'Object, ni effets ni réglages
function entry(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null;
}

/** l'aide d'un effet, en Markdown : sa famille, ce qu'il fait, son réglage principal, ses réglages */
function effectHelp(name) {
  const fx = entry(EFFECTS, name);
  if (!fx) return null;
  const rows = Object.keys(fx.settings).map(function(k) {
    const st = fx.settings[k];
    return '| ' + (k === fx.main ? '**' + k + '**' : k) + ' | ' + st.rule.replace(/\|/g, '\\|') + ' | ' + (st.default === null ? '' : st.default.replace(/\|/g, '\\|')) + ' |';
  });
  const lines = ['**\\*' + name + '** · ' + fx.family, ''];
  if (fx.help) lines.push(fx.help, '');
  lines.push(fx.lifecycle ? 'Sur le cycle de vie seulement : `@in=*' + name + '`, `@out=*' + name + '`, `@transition=*' + name + '`.' : '`*' + name + '(' + fx.main + ')` — le réglage principal s\'écrit sans son nom.', '');
  lines.push('| réglage | règle | défaut |', '|---|---|---|');
  return lines.concat(rows).join('\n');
}

/** l'aide d'un réglage, en Markdown : sa règle, son défaut, s'il est le principal */
function settingHelp(name, key) {
  const fx = entry(EFFECTS, name);
  const st = fx && entry(fx.settings, key);
  if (!st) return null;
  return '**' + key + '** — réglage de `*' + name + '`' + (key === fx.main ? ' (le principal : il s\'écrit sans son nom)' : '') + '\n\n' + st.rule + (st.default === null ? '' : ' · défaut : `' + st.default + '`');
}

// un `{` resté ouvert avant le curseur : le calcul d'une accolade (`{$a * 2}`), où l'étoile multiplie
function inExpression(before) {
  let depth = 0;
  for (const ch of before) {
    if (ch === '{') depth++;
    else if (ch === '}' && depth > 0) depth--;
  }
  return depth > 0;
}

/** ce qu'il y a à proposer au curseur, `before` étant le texte de la ligne avant lui :
 * des effets après `*`, des réglages dans `*nom(`, des mots permis après `réglage:` */
function suggest(before) {
  const star = /\*([A-Za-z][\w-]*)?$/.exec(before);
  if (star && BEFORE_STAR.test(before.slice(0, star.index))) {
    if (inExpression(before.slice(0, star.index))) return [];
    return Object.keys(EFFECTS).map(function(name) {
      const fx = EFFECTS[name];
      return { kind: 'effect', label: name, detail: fx.family + (fx.help ? ' — ' + fx.help : ''), help: effectHelp(name), insert: name };
    });
  }
  const open = openEffect(before);
  const fx   = open && entry(EFFECTS, open.name);
  if (!fx) return [];
  const parts   = splitArgs(open.args);
  const current = parts[parts.length - 1];
  // après `réglage:` : ses mots permis
  const kv = /^\s*([A-Za-z][\w-]*)\s*:\s*([\w-]*)$/.exec(current);
  if (kv) {
    const st = entry(fx.settings, kv[1]);
    return st && st.values ? st.values.map(function(v) { return { kind: 'value', label: v, detail: kv[1] + ' — ' + st.rule, help: settingHelp(open.name, kv[1]), insert: v }; }) : [];
  }
  if (!/^\s*[A-Za-z]*$/.test(current)) return [];
  // les réglages pas encore écrits ; une première valeur sans nom est le principal
  const written = new Set();
  parts.slice(0, -1).forEach(function(p, i) {
    const m = KEY.exec(p);
    if (m) written.add(m[1]);
    else if (i === 0 && p.trim() !== '') written.add(fx.main);
  });
  const out = Object.keys(fx.settings).filter(function(k) { return !written.has(k); }).map(function(k) {
    const st = fx.settings[k];
    return { kind: 'setting', label: k, detail: st.rule + (st.default === null ? '' : ' (défaut ' + st.default + ')') + (k === fx.main ? ' — le principal' : ''), help: settingHelp(open.name, k), insert: k + ': ', retrigger: !!st.values };
  });
  // en premier, sans nom : les mots permis du réglage principal
  const main = fx.settings[fx.main];
  if (parts.length === 1 && main && main.values) {
    main.values.forEach(function(v) { out.push({ kind: 'value', label: v, detail: fx.main + ' — ' + main.rule, help: settingHelp(open.name, fx.main), insert: v }); });
  }
  return out;
}

/** l'aide au survol du mot sous le curseur (colonne `col` de `line`) : un effet `*nom`, ou un réglage
 * dans ses parenthèses ; null sinon */
function hover(line, col) {
  let start = col;
  let end   = col;
  while (start > 0 && /[\w-]/.test(line[start - 1])) start--;
  while (end < line.length && /[\w-]/.test(line[end])) end++;
  if (start === end) return null;
  const word = line.slice(start, end);
  if (line[start - 1] === '*' && BEFORE_STAR.test(line.slice(0, start - 1))) return effectHelp(word);
  const open = openEffect(line.slice(0, start));
  if (open && /^\s*:/.test(line.slice(end))) return settingHelp(open.name, word);
  return null;
}

module.exports = { suggest: suggest, hover: hover, effectHelp: effectHelp, settingHelp: settingHelp, openEffect: openEffect };
