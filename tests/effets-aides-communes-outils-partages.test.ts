// les aides communes des effets — le moteur WebKit, la couleur lue sur la balise, la reprise à la fin d'un chargement de police, le
// libellé d'un effet dans la langue de la page — sont des outils partagés (runtime/mjs_fx_tool<nom>.ts, bundler/fx-tools.ts) : une appli
// ne les porte qu'avec un effet qui s'en sert. Une appli à un seul effet sans rapport (*neon) n'en paie pas un octet ; chaque effet qui
// en appelle une l'embarque, en production comme en développement

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler } from '../src/bundler/index.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const lire    = (f: string) => existsSync(join(RUNTIME, f)) ? readFileSync(join(RUNTIME, f), 'utf-8') : ''

// [aide, effets qui l'appellent]
const AIDES: Array<[string, string[]]> = [
  ['_mjs_fxWebkit', ['blend', 'filter']],
  ['_mjs_fxColorOn', ['blend', 'filter']],
  ['_mjs_fxOnFonts', ['weight', 'delta', 'annotate']],
  ['_mjs_fxLabel', ['guard', 'offline', 'loader']]
]
const NOMS     = AIDES.map(([a]) => a)
const definit  = (texte: string, aide: string) => new RegExp('^µ\\.' + aide + ' = ', 'm').test(texte)
const fichiers = (env: string, used: string[]) => new Bundler(env === 'prod' ? { i18n: { default: 'fr' }, env: 'prod' } as any : { i18n: { default: 'fr' } }).resolveRuntimeFiles(new Set(used)).files
const MODES    = [['dev', 'en développement'], ['prod', 'en production']]

describe('effets — les aides communes ne pèsent que sur les applis dont un effet s\'en sert', function () {
  this.timeout(60000)

  it('le moteur des effets n\'en définit aucune ; chacune est définie par un seul fichier', () => {
    assert.deepEqual(NOMS.filter((a) => definit(lire('mjs_fx.ts'), a)), [])
    for (const a of NOMS) {
      const outils = new Bundler({ runtime: 'all', i18n: { default: 'fr' } }).resolveRuntimeFiles().files.filter((f) => /^mjs_fx_tool[a-z]+\.ts$/.test(f) && definit(lire(f), a))
      assert.equal(outils.length, 1, a + ' : ' + outils.join(', '))
    }
  })

  for (const [env, dit] of MODES) {
    it(`une appli à un seul effet sans rapport (*neon), ${dit} : aucune aide dans son cœur`, () => {
      const f = fichiers(env, ['fx', 'fx_neon'])
      assert.ok(f.includes('mjs_fx.ts') && f.includes('mjs_fx_neon.ts'), 'le banc : le moteur et *neon')
      const texte = f.map(lire).join('\n')
      assert.deepEqual(NOMS.filter((a) => definit(texte, a)), [])
    })

    it(`chaque effet qui appelle une aide l'embarque, ${dit}`, () => {
      for (const [aide, effets] of AIDES) {
        for (const e of effets) {
          assert.ok(new RegExp('µ\\.' + aide + '(?![\\w$])').test(lire('mjs_fx_' + e + '.ts')), `le banc : *${e} appelle ${aide}`)
          const f = fichiers(env, ['fx', 'fx_' + e])
          assert.equal(f.filter((x) => definit(lire(x), aide)).length, 1, `*${e} : ${aide}`)
        }
      }
    })
  }
})
