// l'alias de symbole (`sigil: 'mjs'`) se pose dans les expressions `{…}` du HTML (sigilAliasHtml, src/transpiler/index.ts) : chaque `{` qui ne
// se refermait pas relançait la lecture jusqu'à la fin du texte (finExpression), un temps quadratique sur un gabarit aux accolades non
// refermées (en cours de frappe) — 8 000 lignes : plus de deux secondes. Les accolades sans fin déjà lues ne sont plus relues (même mémoire
// que la fin de balise, scanTagClose). La fonction, interne, est relue dans le source et tourne seule, ses aides importées.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { finExpression } from '../src/sigils.js'
import { sigilAliasCode } from '../src/transpiler/index.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(ICI, '../src/transpiler/index.ts'), 'utf-8')
const debut  = SOURCE.indexOf('function sigilAliasHtml(')
const corps  = transformSync(SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut) + 3), { loader: 'ts' }).code
const alias  = new Function('finExpression', 'sigilAliasCode', 'SIGIL_ALIASES', 'ALIAS_APPEL_EN_CLAIR_RE', corps + '\nreturn sigilAliasHtml')(
  finExpression, sigilAliasCode, { mjs: /(?<![\w$])mjs(?=[.$])/g }, /(?<![\w$])mjs(?=\.(?:asset|image)\s*\()/g
) as (html: string, sigil: string) => string

describe('alias de symbole — un gabarit aux accolades non refermées se lit en temps linéaire', () => {
  it('l\'alias se pose dans les expressions, jamais dans le texte', () => {
    assert.equal(alias('<p>mjs.x {mjs.y} {a</p>', 'mjs'), '<p>mjs.x {µ.y} {a</p>')
  })

  it('8 000 lignes aux accolades ouvertes : bien moins de 300 ms, la même sortie', () => {
    const html = '<p>mjs.x</p>\n' + '<p>{a b</p>\n'.repeat(8000)
    const t0   = performance.now()
    const r    = alias(html, 'mjs')
    const ms   = performance.now() - t0
    assert.equal(r, html)
    assert.ok(ms < 300, `${Math.round(ms)} ms`)
  })
})
