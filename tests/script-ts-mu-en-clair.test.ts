// script TypeScript : le code compilé écrit `µ` et les textes accentués en clair, comme un script Civet ou JavaScript. Sous `@i18n
// 'section'`, `µt('clé')`, `µt?.('clé')` et `µ.t('clé')` reçoivent le préfixe de la section ; µeffect, µload, µ.modal, µlang et µ$x
// gardent leur forme ; la ligne d'une erreur et la carte de lignes ne bougent pas

import assert from 'node:assert/strict'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { transpile } from '../src/transpiler/index.js'

const compiler = async (source: string, nom: string): Promise<{ output: string, sourceMap?: unknown }> => (await transpile(source, { moduleName: nom })) as any
const ts       = (tete: string, corps: string, gabarit: string): string => `${tete}<script lang="ts">\n  const k: number = 2\n  ${corps}\n</script>\n${gabarit}\n`
const echappe  = /\\u(?:00[bB]5|\{0*[bB]5\})/

describe('script TypeScript : µ et textes accentués écrits en clair dans le code compilé', function () {
  this.timeout(60000)

  describe('préfixe de la section sous @i18n', () => {
    const appels: [string, RegExp][] = [
      ["µt('x')", /µ\.t\((['"])sec\.x\1\)/],
      ["µt?.('x')", /µ\.t\?\.\((['"])sec\.x\1\)/],
      ["µ.t('x')", /µ\.t\((['"])sec\.x\1\)/],
    ]
    appels.forEach(([appel, attendu], i) => {
      it(`\`$m = ${appel}\` reçoit la clé \`sec.x\``, async () => {
        const sortie = (await compiler(ts("@i18n 'sec'\n", `$m = ${appel}`, '<b>{$m}</b>'), `essai-ts-section-${i}`)).output
        assert.match(sortie, attendu, sortie.split('\n').filter((l) => /\.t\??\.?\(/.test(l)).join('\n'))
      })
    })
  })

  describe('les autres formes en µ', () => {
    const formes: [string, string, string, RegExp][] = [
      ['µeffect', '$n = 1\n  µeffect(() => { console.log($n + k) })', '<b>{$n}</b>', /µ\.effect\([^]*?, \["n"\]\)/],
      ['µload', "$q = 'a'\n  $r = µload(`/api/s?q=${$q}`)", '<b>{$q}</b>', /µ\.load\(`\/api\/s\?q=\$\{\$\.q\}`,null,'[0-9a-f]{4}\.0'\)/],
      ['µ.modal', "$n = 1\n  const ouvrir = (): void => { µ.modal('m') }", '<b>{$n}</b>', /µ\.modal\((['"])m\1\)/],
      ['µlang', '$l = µlang', '<b>{$l}</b>', /µ\.store\.__mjsLang/],
      ['µ$x', '$v = µ$x\n  const poser = (): void => { µ$x = k }', '<b>{$v}</b>', /µ_state = \(?µ\._mjs_univ \?\?= µ\.state\(/],
    ]
    formes.forEach(([nom, corps, gabarit, attendu], i) => {
      it(`${nom} : \`µ\` écrit en clair, aucune forme échappée`, async () => {
        const sortie = (await compiler(ts('', corps, gabarit), `essai-ts-forme-${i}`)).output
        assert.ok(!echappe.test(sortie), sortie.split('\n').filter((l) => echappe.test(l)).join('\n'))
        assert.match(sortie, attendu)
      })
    })
  })

  it('textes accentués : écrits tels quels', async () => {
    const sortie = (await compiler(ts('', "$s = 'été à Noël — ½'", '<b>{$s} déjà</b>'), 'essai-ts-accents')).output
    assert.match(sortie, /(['"])été à Noël — ½\1/, sortie.split('\n').filter((l) => /No/.test(l)).join('\n'))
  })

  it('la ligne d\'une erreur reste celle du fichier', async () => {
    await assert.rejects(compiler("<script lang=\"ts\">\n  $n = 1\n  const k: number = 2\n  const a: string = µt('x') + 'é'\n  const = 2\n</script>\n<b>{$n}</b>\n", 'essai-ts-erreur'), /\.mjs:5:\d+/)
  })

  it('carte de lignes : un repère écrit après un `µ` et des accents sur la même ligne retrouve sa ligne et sa colonne', async () => {
    const r     = await compiler("@i18n 'sec'\n<script lang=\"ts\">\n  $n = 1\n  const k: number = 2\n  $m = µt('é') + 'à'; const repere = 'MARQUEUR'\n</script>\n<b>{$m}{$n}</b>\n", 'essai-ts-carte')
    const avant = r.output.slice(0, r.output.indexOf('MARQUEUR')).split('\n')
    const carte = typeof r.sourceMap === 'string' ? JSON.parse(r.sourceMap) : r.sourceMap
    const p     = originalPositionFor(new TraceMap(carte), { line: avant.length, column: avant[avant.length - 1].length })
    assert.deepEqual([p.line, p.column], [5, 37])
  })
})
