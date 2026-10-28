// effects-help — la complétion et l'aide au survol des effets `*nom(réglages)` d'un composant ModularJS, sans VS Code (extension.js
// les branche) : les effets et les alias que ModularJS livre (`*filter.frosted_glass`) viennent d'effects.json, tiré du catalogue du
// framework (script/vscode-effects.mjs) ; ceux de l'appli, de ses fichiers `*.effects.mjs` (cf. effects-app.js). Chaque fonction
// prend un contexte facultatif : `lang`, la langue de l'aide (fr par défaut, en), et `app`, les effets de l'appli (appEffects)

const EFFECTS = require('./effects.json');
const CUSTOM  = require('./effects-app.json');

// les textes de l'aide ; ce que fait un effet et ce qu'on voit d'un alias viennent, en français, du chapitre 38 de la doc du framework
// et, en anglais, des fiches de son site (effects-help-en.json, recopié dans effects.json) : sans texte anglais, l'aide anglaise les
// garde en français
const TEXTS = {
  fr: {
    setting:   'réglage',
    rule:      'règle',
    dflt:      'défaut',
    colon:     ' : ',
    theMain:   'le principal',
    mainNote:  ' (le principal : il s\'écrit sans son nom)',
    mainLine:  'le réglage principal s\'écrit sans son nom.',
    lifeOnly:  'Sur le cycle de vie seulement : ',
    settingOf: 'réglage de',
    shipped:   'alias livré par ModularJS',
    appAlias:  'alias de l\'appli',
    appEffect: 'effet de l\'appli',
    appCss:    'effet CSS de l\'appli',
    line:      'ligne'
  },
  en: {
    setting:   'setting',
    rule:      'rule',
    dflt:      'default',
    colon:     ': ',
    theMain:   'the main one',
    mainNote:  ' (the main one: written without its name)',
    mainLine:  'the main setting is written without its name.',
    lifeOnly:  'Lifecycle only: ',
    settingOf: 'setting of',
    shipped:   'alias shipped with ModularJS',
    appAlias:  'app alias',
    appEffect: 'app effect',
    appCss:    'app CSS effect',
    line:      'line'
  }
};

// un effet commence après une espace, un `=` (`@in=*fly`), un guillemet, une parenthèse, une virgule
// ou deux-points (`fx: *scramble`) — jamais au milieu d'un calcul (`{$a*$b}`, `{$a * 2}`)
const BEFORE_STAR = /(?:^|[\s="'(,:])$/;

/** la langue de l'aide d'après celle de VS Code (`vscode.env.language`) : le français pour une langue française (`fr`, `fr-ca`) ou
 * quand VS Code n'en dit rien, l'anglais pour toute autre */
function language(code) {
  return !code || /^fr(?:[-_]|$)/i.test(code) ? 'fr' : 'en';
}

// le contexte d'un appel : la langue de l'aide, les effets de l'appli
function context(ctx) {
  return { lang: ctx && ctx.lang === 'en' ? 'en' : 'fr', app: ctx && ctx.app ? ctx.app : null };
}

// l'effet ouvert avant le curseur : `*nom(` ou `*effet.alias(` dont la parenthèse n'est pas refermée — son nom et ce qui est déjà
// écrit entre ses parenthèses ; null hors d'un effet
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
      const m = /^\*([A-Za-z][\w-]*(?:\.[a-z][a-z0-9_]*)?)\(/.exec(before.slice(i));
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

// la famille d'un effet de la bibliothèque, dans la langue de l'aide
function family(fx, lang) {
  return lang === 'en' && fx.family_en ? fx.family_en : fx.family;
}

// la règle d'un réglage, dans la langue de l'aide
function ruleOf(st, lang) {
  return lang === 'en' && st.rule_en ? st.rule_en : st.rule;
}

// ce que fait un effet, ce qu'on voit d'un alias livré, dans la langue de l'aide
function helpOf(o, lang) {
  return lang === 'en' && o.help_en ? o.help_en : o.help;
}

// les réglages d'un effet de la bibliothèque tels que l'aide les montre : leur règle, leur défaut — la valeur que `set` (un alias, un
// effet de l'appli) leur donne quand il en donne une (`alias`) —, leurs mots permis
function settingsView(settings, set, lang) {
  const out = Object.create(null);
  for (const k of Object.keys(settings)) {
    const st = settings[k];
    const v  = entry(set, k);
    out[k] = { rule: ruleOf(st, lang), default: v !== null ? v : st.default, values: st.values, alias: v !== null };
  }
  return out;
}

// un effet de l'appli : l'effet de la bibliothèque qu'il règle et ses valeurs, ou ses réglages d'effet CSS (ceux qu'il déclare, puis
// ceux que tout effet CSS reçoit) ; un effet qui ne se résout pas n'a que son écriture
function appView(app, lang) {
  const T     = TEXTS[lang];
  const where = '`' + app.file.slice(app.file.lastIndexOf('/') + 1) + '`, ' + T.line + ' ' + app.line;
  if (app.base) {
    const fx = EFFECTS[app.base];
    return { family: family(fx, lang), origin: app.name.includes('.') ? T.appAlias : T.appEffect, where: where, help: '', written: app.written, main: fx.main, lifecycle: fx.lifecycle, settings: settingsView(fx.settings, app.set, lang) };
  }
  if (app.params) {
    const settings = Object.create(null);
    for (const [k, v] of app.params) settings[k] = { rule: ruleOf(CUSTOM.css, lang), default: v, values: null, alias: false };
    const common = app.animated ? CUSTOM.animated : CUSTOM.still;
    for (const k of Object.keys(common)) {
      if (!entry(settings, k)) settings[k] = { rule: ruleOf(common[k], lang), default: common[k].default, values: common[k].values, alias: false };
    }
    return { family: null, origin: T.appCss, where: where, help: '', written: null, main: app.params.length > 0 ? app.params[0][0] : 'on', lifecycle: false, settings: settings };
  }
  return { family: null, origin: T.appEffect, where: where, help: '', written: app.written, main: null, lifecycle: false, settings: Object.create(null) };
}

// la fiche d'un nom d'effet écrit, telle que l'aide la montre : un effet de la bibliothèque, un effet de l'appli (le sien remplace
// l'alias que ModularJS livre sous le même nom), un alias livré ; null pour un nom inconnu
function view(name, c) {
  const fx = entry(EFFECTS, name);
  if (fx) return { family: family(fx, c.lang), origin: null, where: null, help: helpOf(fx, c.lang), written: null, main: fx.main, lifecycle: fx.lifecycle, settings: settingsView(fx.settings, {}, c.lang) };
  const app = c.app && entry(c.app, name);
  if (app) return appView(app, c.lang);
  const dot   = name.indexOf('.');
  const base  = dot > 0 ? entry(EFFECTS, name.slice(0, dot)) : null;
  const alias = base && base.aliases ? entry(base.aliases, name.slice(dot + 1)) : null;
  if (!alias) return null;
  return { family: family(base, c.lang), origin: TEXTS[c.lang].shipped, where: null, help: helpOf(alias, c.lang), written: alias.written, main: base.main, lifecycle: base.lifecycle, settings: settingsView(base.settings, alias.set, c.lang) };
}

// une cellule de tableau Markdown : ses `|` échappés
function cell(text) {
  return text.replace(/\|/g, '\\|');
}

/** l'aide d'un effet, d'un alias ou d'un effet de l'appli, en Markdown : sa famille, d'où il vient, ce qu'il fait, son écriture, son
 * réglage principal, ses réglages */
function effectHelp(name, ctx) {
  const c = context(ctx);
  const v = view(name, c);
  if (!v) return null;
  const T     = TEXTS[c.lang];
  const lines = ['**\\*' + name + '**' + [v.family, v.origin].filter(Boolean).map(function(s) { return ' · ' + s; }).join(''), ''];
  if (v.where) lines.push(v.where, '');
  if (v.help) lines.push(v.help, '');
  if (v.written) lines.push('`*' + name + '` = `' + v.written + '`', '');
  if (v.main === null) return lines.join('\n').trim();
  lines.push(v.lifecycle ? T.lifeOnly + '`@in=*' + name + '`, `@out=*' + name + '`, `@transition=*' + name + '`.' : '`*' + name + '(' + v.main + ')` — ' + T.mainLine, '');
  lines.push('| ' + T.setting + ' | ' + T.rule + ' | ' + T.dflt + ' |', '|---|---|---|');
  const rows = Object.keys(v.settings).map(function(k) {
    const st = v.settings[k];
    return '| ' + (k === v.main ? '**' + k + '**' : k) + ' | ' + cell(st.rule) + ' | ' + (st.default === null ? '' : cell(st.default + (st.alias ? ' (alias)' : ''))) + ' |';
  });
  return lines.concat(rows).join('\n');
}

/** l'aide d'un réglage, en Markdown : sa règle, son défaut (ou la valeur que l'alias lui donne), s'il est le principal */
function settingHelp(name, key, ctx) {
  const c  = context(ctx);
  const v  = view(name, c);
  const st = v && entry(v.settings, key);
  if (!st) return null;
  const T = TEXTS[c.lang];
  return '**' + key + '** — ' + T.settingOf + ' `*' + name + '`' + (key === v.main ? T.mainNote : '') + '\n\n' + st.rule + (st.default === null ? '' : ' · ' + (st.alias ? 'alias' : T.dflt) + T.colon + '`' + st.default + '`');
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

/** ce qu'il y a à proposer au curseur, `before` étant le texte de la ligne avant lui : des effets après `*`, les alias d'un effet après
 * `*effet.`, des réglages dans `*nom(`, des mots permis après `réglage:` */
function suggest(before, ctx) {
  const c = context(ctx);
  const T = TEXTS[c.lang];
  // après `*effet.` : ses alias, ceux que ModularJS livre et ceux de l'appli
  const dot = /\*([A-Za-z][\w-]*)\.([a-z0-9_]*)$/.exec(before);
  if (dot && BEFORE_STAR.test(before.slice(0, dot.index))) {
    const fx = entry(EFFECTS, dot[1]);
    if (!fx || inExpression(before.slice(0, dot.index))) return [];
    const names = Object.keys(fx.aliases || {});
    for (const n of Object.keys(c.app || {})) {
      if (n.startsWith(dot[1] + '.')) names.push(n.slice(dot[1].length + 1));
    }
    return Array.from(new Set(names)).sort().map(function(alias) {
      const v = view(dot[1] + '.' + alias, c);
      return { kind: 'effect', label: alias, detail: v.help || [v.origin, v.written].filter(Boolean).join(' — '), help: effectHelp(dot[1] + '.' + alias, c), insert: alias };
    });
  }
  const star = /\*([A-Za-z][\w-]*)?$/.exec(before);
  if (star && BEFORE_STAR.test(before.slice(0, star.index))) {
    if (inExpression(before.slice(0, star.index))) return [];
    const out = Object.keys(EFFECTS).map(function(name) {
      const fx = EFFECTS[name];
      const what = helpOf(fx, c.lang);
      return { kind: 'effect', label: name, detail: family(fx, c.lang) + (what ? ' — ' + what : ''), help: effectHelp(name, c), insert: name };
    });
    // les effets de l'appli ; ses alias se proposent après le point
    for (const name of Object.keys(c.app || {}).sort()) {
      if (name.includes('.')) continue;
      const v = view(name, c);
      out.push({ kind: 'effect', label: name, detail: [v.origin, v.written].filter(Boolean).join(' — '), help: effectHelp(name, c), insert: name });
    }
    return out;
  }
  const open = openEffect(before);
  const v    = open && view(open.name, c);
  if (!v || v.main === null) return [];
  const parts   = splitArgs(open.args);
  const current = parts[parts.length - 1];
  // après `réglage:` : ses mots permis
  const kv = /^\s*([A-Za-z][\w-]*)\s*:\s*([\w-]*)$/.exec(current);
  if (kv) {
    const st = entry(v.settings, kv[1]);
    return st && st.values ? st.values.map(function(w) { return { kind: 'value', label: w, detail: kv[1] + ' — ' + st.rule, help: settingHelp(open.name, kv[1], c), insert: w }; }) : [];
  }
  if (!/^\s*[A-Za-z]*$/.test(current)) return [];
  // les réglages pas encore écrits ; une première valeur sans nom est le principal
  const written = new Set();
  parts.slice(0, -1).forEach(function(p, i) {
    const m = KEY.exec(p);
    if (m) written.add(m[1]);
    else if (i === 0 && p.trim() !== '') written.add(v.main);
  });
  const out = Object.keys(v.settings).filter(function(k) { return !written.has(k); }).map(function(k) {
    const st   = v.settings[k];
    const dflt = st.default === null ? '' : st.alias ? ' (alias' + T.colon + st.default + ')' : ' (' + T.dflt + ' ' + st.default + ')';
    return { kind: 'setting', label: k, detail: st.rule + dflt + (k === v.main ? ' — ' + T.theMain : ''), help: settingHelp(open.name, k, c), insert: k + ': ', retrigger: !!st.values };
  });
  // en premier, sans nom : les mots permis du réglage principal
  const main = entry(v.settings, v.main);
  if (parts.length === 1 && main && main.values) {
    main.values.forEach(function(w) { out.push({ kind: 'value', label: w, detail: v.main + ' — ' + main.rule, help: settingHelp(open.name, v.main, c), insert: w }); });
  }
  return out;
}

/** l'aide au survol du mot sous le curseur (colonne `col` de `line`) : un effet `*nom` ou un alias `*effet.nom` (survolé sur l'une ou
 * l'autre partie : le nom pointé se lit d'un seul tenant), ou un réglage dans ses parenthèses ; null sinon */
function hover(line, col, ctx) {
  let start = col;
  let end   = col;
  while (start > 0 && /[\w-]/.test(line[start - 1])) start--;
  while (end < line.length && /[\w-]/.test(line[end])) end++;
  if (start === end) return null;
  const word = line.slice(start, end);
  // le nom pointé : l'effet devant le point, l'alias derrière
  let from = start;
  let to   = end;
  if (line[from - 1] === '.') {
    let k = from - 1;
    while (k > 0 && /[\w-]/.test(line[k - 1])) k--;
    if (k < from - 1 && line[k - 1] === '*') from = k;
  }
  else if (line[to] === '.' && line[from - 1] === '*') {
    let k = to + 1;
    while (k < line.length && /[\w-]/.test(line[k])) k++;
    if (k > to + 1) to = k;
  }
  if (line[from - 1] === '*' && BEFORE_STAR.test(line.slice(0, from - 1))) {
    const md = effectHelp(line.slice(from, to), ctx);
    // un alias inconnu (`*filter.inconnu`) : l'aide de l'effet, survolé sur son nom
    return md || (from === start ? effectHelp(word, ctx) : null);
  }
  const open = openEffect(line.slice(0, start));
  if (open && /^\s*:/.test(line.slice(end))) return settingHelp(open.name, word, ctx);
  return null;
}

module.exports = { suggest: suggest, hover: hover, effectHelp: effectHelp, settingHelp: settingHelp, openEffect: openEffect, language: language };
