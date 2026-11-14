// `responsiveFontSize` dans mjs.config.json : true, false ou un objet de réglages (base, breakpoint, factor, unit). Toute autre
// valeur est refusée à la lecture, par un message qui nomme la clé et la valeur reçue, en français comme en anglais

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { findConfig } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'

function projet(reglage: unknown, lang = 'fr'): string {
  const root = mjsTmp('taille-texte-config')
  write(join(root, 'mjs.config.json'), `{ "sourceDir": "app", "outputDir": "public/m", "manifestPath": "public/m/bundle.js", "lang": "${lang}", "responsiveFontSize": ${typeof reglage === 'string' && reglage.startsWith('@') ? reglage.slice(1) : JSON.stringify(reglage)} }\n`)
  return root
}

function refus(reglage: unknown, lang: string): string {
  try {
    findConfig(projet(reglage, lang))
  } catch (e: any) {
    return String(e?.message ?? e)
  }
  assert.fail(`refus attendu pour ${JSON.stringify(reglage)}`)
}

// valeur fausse → ce que le message doit dire (français, puis anglais : la clé `lang` de la configuration choisit la langue)
const FAUSSES: Array<[unknown, RegExp, RegExp]> = [
  ['oui',                      /responsiveFontSize .*true, false ou un objet.*oui/s,                 /responsiveFontSize .*true, false or an object.*oui/s],
  [1,                          /responsiveFontSize .*true, false ou un objet.*1/s,                   /responsiveFontSize .*true, false or an object.*1/s],
  [null,                       /responsiveFontSize .*true, false ou un objet.*null/s,                /responsiveFontSize .*true, false or an object.*null/s],
  [[14],                       /responsiveFontSize .*true, false ou un objet/s,                      /responsiveFontSize .*true, false or an object/s],
  [{ taille: 14 },             /responsiveFontSize\.taille : clé inconnue.*base, breakpoint, factor, unit/s, /responsiveFontSize\.taille: unknown key.*base, breakpoint, factor, unit/s],
  [{ base: 0 },                /responsiveFontSize\.base .*plus grand que 0.*0/s,                    /responsiveFontSize\.base .*greater than 0.*0/s],
  [{ base: -2 },               /responsiveFontSize\.base .*plus grand que 0.*-2/s,                   /responsiveFontSize\.base .*greater than 0.*-2/s],
  [{ base: '14' },             /responsiveFontSize\.base .*plus grand que 0.*14/s,                   /responsiveFontSize\.base .*greater than 0.*14/s],
  ['@{ "base": 1e999 }',       /responsiveFontSize\.base .*plus grand que 0.*Infinity/s,             /responsiveFontSize\.base .*greater than 0.*Infinity/s],
  [{ breakpoint: 0 },          /responsiveFontSize\.breakpoint .*plus grand que 0/s,                 /responsiveFontSize\.breakpoint .*greater than 0/s],
  [{ breakpoint: true },       /responsiveFontSize\.breakpoint .*plus grand que 0.*true/s,           /responsiveFontSize\.breakpoint .*greater than 0.*true/s],
  [{ factor: 1 },              /responsiveFontSize\.factor .*plus grand que 1.*1/s,                  /responsiveFontSize\.factor .*greater than 1.*1/s],
  [{ factor: 0.5 },            /responsiveFontSize\.factor .*plus grand que 1.*0\.5/s,               /responsiveFontSize\.factor .*greater than 1.*0\.5/s],
  [{ unit: 'em' },             /responsiveFontSize\.unit invalide : 'em'.*rem, px/s,                 /invalid responsiveFontSize\.unit: 'em'.*rem, px/s],
]

describe('responsiveFontSize — validation de mjs.config.json', () => {
  afterEach(() => setMessagesLang('fr'))

  it('true, false, absent et un objet juste sont acceptés', () => {
    for (const bon of [true, false, {}, { base: 14 }, { base: 18.5, breakpoint: 1024, factor: 4, unit: 'px' }, { unit: 'rem' }]) {
      assert.doesNotThrow(() => findConfig(projet(bon)), JSON.stringify(bon))
    }
  })

  for (const [faux, fr, en] of FAUSSES) {
    it(`refusé : ${typeof faux === 'string' && faux.startsWith('@') ? faux.slice(1) : JSON.stringify(faux)}`, () => {
      assert.match(refus(faux, 'fr'), fr)
      assert.match(refus(faux, 'en'), en)
    })
  }
})
