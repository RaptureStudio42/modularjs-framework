// les effets pour l'extension VS Code (editors/vscode/effects.json) : chaque effet du catalogue, sa
// famille, son réglage principal, ce qu'il fait (la table du chapitre 38 de la doc), ses réglages —
// leur règle, leur défaut, les mots permis — et les alias que ModularJS livre (src/effects/aliases-mjs.ts :
// ce qu'on voit, d'après la table des alias du chapitre 38, leur écriture et les valeurs qu'ils donnent) ;
// la famille et la règle aussi en anglais (les messages du framework, src/messages/en.ts), et ce que fait
// l'effet, ce qu'on voit de l'alias, en anglais, d'editors/vscode/effects-help-en.json (cf. copyEnglish).
// Et, dans editors/vscode/effects-app.json, les réglages que tout effet CSS d'une appli reçoit. À relancer
// quand le catalogue, les alias, le chapitre 38 ou les textes anglais changent (un test le vérifie) :
//   node --import tsx/esm script/vscode-effects.mjs
// Les textes anglais se recopient du site du framework quand il les change, ou qu'un effet ou un alias
// s'ajoute ; la construction de l'extension, elle, ne lit jamais le site :
//   node --import tsx/esm script/vscode-effects.mjs --site <racine du site>

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECTS, devCatalog, effectSpec, withProjectEffects } from '../src/effects/catalog.ts';
import { parseEffectsBlock, resolveProjectEffects } from '../src/effects/project.ts';
import { MJS_ALIASES, MJS_ALIASES_FILE } from '../src/effects/aliases-mjs.ts';
import { parseRule } from '../src/transpiler/var-types.ts';
import { t, getMessagesLang, setMessagesLang } from '../src/messages/index.ts';

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT  = join(ROOT, 'editors', 'vscode', 'effects.json');
const APP     = join(ROOT, 'editors', 'vscode', 'effects-app.json');
const ENGLISH = join(ROOT, 'editors', 'vscode', 'effects-help-en.json');

// les familles, comme la doc les titre, et en anglais
const FAMILIES = {
  text:       ['Texte', 'Text'],
  transition: ['Transitions', 'Transitions'],
  button:     ['Boutons', 'Buttons'],
  card:       ['Cartes', 'Cards'],
  border:     ['Bordures', 'Borders'],
  background: ['Fonds', 'Backgrounds'],
  cursor:     ['Souris', 'Mouse'],
  loader:     ['Chargement', 'Loading'],
  icon:       ['Icônes', 'Icons'],
  image:      ['Images', 'Images'],
  shape:      ['Formes', 'Shapes'],
  scroll:     ['Défilement', 'Scrolling'],
  live:       ['En direct', 'Live']
};

// ce que fait chaque effet, ce qu'on voit de chaque alias : la deuxième colonne des tables du chapitre 38
function descriptions() {
  const doc = readFileSync(join(ROOT, 'docs', '38-effets.md'), 'utf-8');
  const out = {};
  for (const m of doc.matchAll(/^\| `\*([a-z][a-z0-9-]*)` \| (.+?) \| /gm)) out[m[1]] = m[2].trim();
  for (const m of doc.matchAll(/^\| `\*([a-z][a-z0-9-]*\.[a-z][a-z0-9_]*)` \| (.+?) \|\s*$/gm)) out[m[1]] = m[2].trim();
  return out;
}

// ce que fait chaque effet, ce qu'on voit de chaque alias, en anglais : un texte par nom (effects-help-en.json)
function english() {
  return JSON.parse(readFileSync(ENGLISH, 'utf-8'));
}

/** les textes anglais, recopiés du site du framework (`site`, sa racine) : chaque fiche de démonstration du site
 * (app/assets/modularJS/doc/effets/fx-demo-*.mjs) porte en titre le nom d'un effet ou d'un alias livré
 * (`<h3 class="nom">*longshadow.<wbr>lamp</h3>`) et dit ce qu'il fait par une clé (`µt('desc_longshadow_lampe')`), traduite dans
 * app/assets/modularJS/i18n/en/effets.yml. Les balises et les effets cités passent entre accents graves (`<path>`, `*neon`), comme
 * au chapitre 38 : l'aide est du Markdown. Un nom sans fiche, ou dont la fiche n'est pas traduite, n'y figure pas : son aide anglaise
 * garde la phrase française ; à deux fiches, la première par nom de fichier */
export async function copyEnglish(site) {
  const YAML  = await import('yaml');
  const texts = YAML.parse(readFileSync(join(site, 'app', 'assets', 'modularJS', 'i18n', 'en', 'effets.yml'), 'utf-8'));
  const cards = join(site, 'app', 'assets', 'modularJS', 'doc', 'effets');
  const names = new Set([...Object.keys(EFFECTS), ...Object.keys(parseEffectsBlock(MJS_ALIASES, 1, MJS_ALIASES_FILE))]);
  const found = {};
  for (const file of readdirSync(cards).filter((f) => /^fx-demo-.*\.mjs$/.test(f)).sort()) {
    const src    = readFileSync(join(cards, file), 'utf-8');
    const keys   = [...new Set([...src.matchAll(/µt\('(desc_[a-z0-9_]+)'\)/g)].map((m) => m[1]))];
    const titles = [...new Set([...src.matchAll(/<h3 class="nom">\*([^<]*(?:<wbr>[^<]*)*)<\/h3>/g)].map((m) => m[1].replace(/<wbr>/g, '').trim()))];
    if (keys.length !== 1 || titles.length !== 1 || !names.has(titles[0]) || typeof texts[keys[0]] !== 'string') continue;
    found[titles[0]] ??= texts[keys[0]].replace(/<[^<>\s][^<>]*>|\*[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_]*)?/g, (m) => '`' + m + '`');
  }
  const out = {};
  for (const name of Object.keys(found).sort()) out[name] = found[name];
  return out;
}

// `run` avec les messages du framework dans la langue `lang`, celle d'avant rétablie ensuite
function inLang(lang, run) {
  const before = getMessagesLang();
  setMessagesLang(lang);
  try {
    return run();
  }
  finally {
    setMessagesLang(before);
  }
}

// les mots qu'un réglage permet, pour la complétion : ceux d'une liste (`'text' | 'box'`), true et false d'un booléen, et ceux
// d'une règle qui mêle les deux ou un type (`bool | 'spin'`, `'zoom' | 'blur' | string`) ; aucun pour un nombre, un texte, une
// règle propre aux effets (une durée, une couleur…)
function wordsOf(ast) {
  if (ast.k === 'lit') return ast.values.map(String);
  if (ast.k === 'bool') return ['true', 'false'];
  if (ast.k === 'union') return [...new Set(ast.alts.flatMap(wordsOf))];
  return [];
}

function wordsOfRule(rule) {
  const words = wordsOf(parseRule(rule, { bloc: 'effet', ligne: 0 }));
  return words.length > 0 ? words : null;
}

// une valeur, écrite comme la doc l'écrit : une liste entre crochets, `[a, b]`
function shown(value) {
  if (Array.isArray(value)) return '[' + value.join(', ') + ']';
  if (value !== null && typeof value === 'object') throw new Error('vscode-effects : valeur illisible — ' + JSON.stringify(value));
  return String(value);
}

// la règle de chaque réglage de chaque effet, comme le catalogue l'affiche dans la langue `lang` : une liste de mots se lit comme
// dans la doc, `text, box, both`
function rules(lang) {
  return inLang(lang, () => {
    const catalog = devCatalog(Object.keys(EFFECTS));
    const out     = {};
    for (const name of Object.keys(catalog)) {
      out[name] = {};
      for (const [key, [spec]] of Object.entries(catalog[name].s)) out[name][key] = spec[0] === 'l' ? spec[1].join(', ') : String(spec[spec.length - 1]);
    }
    return out;
  });
}

// les alias que ModularJS livre, par effet : ce qu'on voit (et en anglais, quand il est traduit), leur écriture (`*filter(style: none, …)`)
// et les valeurs qu'ils donnent
function aliases(help, en) {
  const written  = parseEffectsBlock(MJS_ALIASES, 1, MJS_ALIASES_FILE);
  const resolved = resolveProjectEffects([]);
  const out      = {};
  for (const name of Object.keys(written).sort()) {
    const [effect, alias] = name.split('.');
    const set = {};
    for (const [key, value] of Object.entries(resolved[name].fixed)) set[key] = shown(value);
    (out[effect] ??= {})[alias] = { help: help[name] || '', ...Object.hasOwn(en, name) && { help_en: en[name] }, written: '*' + written[name].target + '(' + written[name].args + ')', set: set };
  }
  return out;
}

/** les effets, tels que l'extension les propose et les explique */
export function buildEffects() {
  const help    = descriptions();
  const helpEn  = english();
  const catalog = devCatalog(Object.keys(EFFECTS));
  const fr      = rules('fr');
  const en      = rules('en');
  const shipped = aliases(help, helpEn);
  const out     = {};
  for (const name of Object.keys(EFFECTS).sort()) {
    const fx       = EFFECTS[name];
    const family   = FAMILIES[fx.family] || [fx.family, fx.family];
    const settings = {};
    for (const [key, [spec, dflt]] of Object.entries(catalog[name].s)) {
      // une règle des types qui n'est ni une liste de mots ni un booléen (`x` pour le moteur) : une union peut en porter
      const values  = spec[0] === 'l' ? spec[1].map(String) : spec[0] === 'b' ? ['true', 'false'] : spec[0] === 'x' ? wordsOfRule(fx.settings[key].rule) : null;
      // la règle en anglais, quand elle change
      const english = en[name][key] !== fr[name][key] ? { rule_en: en[name][key] } : {};
      settings[key] = { rule: fr[name][key], ...english, default: dflt === null ? null : shown(dflt), values: values };
    }
    out[name] = { family: family[0], family_en: family[1], main: fx.main, help: help[name] || '', ...Object.hasOwn(helpEn, name) && { help_en: helpEn[name] }, lifecycle: !!fx.life, settings: settings };
    if (fx.alt) out[name].alt = fx.alt;
    if (shipped[name]) out[name].aliases = shipped[name];
  }
  return out;
}

// la règle d'un réglage d'effet CSS de l'appli dans la langue `lang`, comme le catalogue l'affiche : une durée, une valeur CSS, ses mots
function customRule(rule, lang) {
  if (rule === 'time') return inLang(lang, () => t('effets.regle-duree'));
  if (rule === 'css') return inLang(lang, () => t('effets.regle-css'));
  const words = wordsOfRule(rule);
  if (!words) throw new Error('vscode-effects : règle d\'effet CSS inattendue — ' + rule);
  return words.join(', ');
}

function customSetting(st) {
  const fr = customRule(st.rule, 'fr');
  const en = customRule(st.rule, 'en');
  return { rule: fr, ...en !== fr && { rule_en: en }, default: st.dflt === undefined ? null : shown(st.dflt), values: st.rule === 'time' || st.rule === 'css' ? null : wordsOfRule(st.rule) };
}

/** les réglages que tout effet CSS d'une appli reçoit (`*halo(color: #0ff) =` puis son CSS) : la règle d'un réglage qu'il déclare
 * (`css`), et ceux qu'il a sans les déclarer — sans `@keyframes` (`still`) et avec (`animated`) */
export function buildAppEffects() {
  const spec     = (keyframes) => withProjectEffects({ effet: { params: [['reglage', 'x']], decls: [], keyframes: keyframes, file: '', line: 0 } }, () => effectSpec('effet'));
  const settings = (keyframes) => {
    const out = {};
    for (const [key, st] of Object.entries(spec(keyframes).settings)) {
      if (key !== 'reglage') out[key] = customSetting(st);
    }
    return out;
  };
  const css = customSetting(spec([]).settings.reglage);
  return { css: { rule: css.rule, rule_en: css.rule_en }, still: settings([]), animated: settings([['50%', []]]) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--site');
  if (at > 0) {
    if (!process.argv[at + 1]) throw new Error('vscode-effects : --site attend la racine du site du framework');
    const texts = await copyEnglish(process.argv[at + 1]);
    writeFileSync(ENGLISH, JSON.stringify(texts, null, 2) + '\n');
    console.log('editors/vscode/effects-help-en.json : '+ Object.keys(texts).length +' textes anglais recopiés du site');
  }
  const effects = buildEffects();
  writeFileSync(OUTPUT, JSON.stringify(effects, null, 2) + '\n');
  writeFileSync(APP, JSON.stringify(buildAppEffects(), null, 2) + '\n');
  const count = Object.values(effects).reduce((n, fx) => n + Object.keys(fx.aliases || {}).length, 0);
  console.log('editors/vscode/effects.json : '+ Object.keys(EFFECTS).length +' effets, '+ count +' alias livrés ; editors/vscode/effects-app.json');
}
