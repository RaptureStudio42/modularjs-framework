// les effets pour l'extension VS Code (editors/vscode/effects.json) : chaque effet du catalogue, sa
// famille, son réglage principal, ce qu'il fait (la table du chapitre 38 de la doc) et ses réglages —
// leur règle, leur défaut, les mots permis. À relancer quand le catalogue ou le chapitre 38 change
// (un test le vérifie) :
//   node --import tsx/esm script/vscode-effects.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECTS, devCatalog } from '../src/effects/catalog.ts';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'editors', 'vscode', 'effects.json');

// les familles, comme la doc les titre
const FAMILIES = {
  text:       'Texte',
  transition: 'Transitions',
  button:     'Boutons',
  card:       'Cartes',
  border:     'Bordures',
  background: 'Fonds',
  cursor:     'Souris',
  loader:     'Chargement',
  icon:       'Icônes',
  image:      'Images',
  shape:      'Formes',
  scroll:     'Défilement',
  live:       'En direct'
};

// ce que fait chaque effet : la deuxième colonne des tables du chapitre 38
function descriptions() {
  const doc = readFileSync(join(ROOT, 'docs', '38-effets.md'), 'utf-8');
  const out = {};
  for (const m of doc.matchAll(/^\| `\*([a-z][a-z0-9-]*)` \| (.+?) \| /gm)) out[m[1]] = m[2].trim();
  return out;
}

/** les effets, tels que l'extension les propose et les explique */
export function buildEffects() {
  const help    = descriptions();
  const catalog = devCatalog(Object.keys(EFFECTS));
  const out     = {};
  for (const name of Object.keys(EFFECTS).sort()) {
    const fx       = EFFECTS[name];
    const settings = {};
    for (const [key, [spec, dflt]] of Object.entries(catalog[name].s)) {
      const values = spec[0] === 'l' ? spec[1].map(String) : spec[0] === 'b' ? ['true', 'false'] : null;
      // une liste de mots se lit comme dans la doc : `text, box, both`
      const rule   = spec[0] === 'l' ? spec[1].join(', ') : String(spec[spec.length - 1]);
      settings[key] = { rule: rule, default: dflt === null ? null : Array.isArray(dflt) ? '[' + dflt.join(', ') + ']' : String(dflt), values: values };
    }
    out[name] = { family: FAMILIES[fx.family] || fx.family, main: fx.main, help: help[name] || '', lifecycle: !!fx.life, settings: settings };
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OUTPUT, JSON.stringify(buildEffects(), null, 2) + '\n');
  console.log('editors/vscode/effects.json : '+ Object.keys(EFFECTS).length +' effets');
}
