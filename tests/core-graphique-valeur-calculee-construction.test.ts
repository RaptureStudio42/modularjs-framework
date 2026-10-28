// module cœur <@@chart> : dans une série écrite sur la balise, la construction ne lit que ce qui y est écrit à coup sûr, un texte ou un
// nombre seul. Une valeur de `axis` ou de `color` qui commence par un texte et continue en expression (`'x' == $mode ? 'right' : 'left'`,
// `'droite' + $suffixe`, `'gauche' if $vrai`, `'Right'.toLowerCase()`, `'bleu' + $nuance`) est calculée : elle n'arrête pas la
// construction et ne fait dire aucun avertissement, le module la vérifie à l'exécution. Écrite seule, la même valeur reste une faute
// (`axis: 'droite'`, `color: 'bleu'`), et `axis: 'right'` sur une forme qui n'a qu'une échelle, un avertissement

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { chartProblems, chartWarnings } from '../src/bundler/core-chart.js'

const ref = (series: string) => ({ file: 'gk-page.mjs', kind: 'coeur', attrs: { texts: { shape: 'stack' }, exprs: { series } } })

// des valeurs calculées qui commencent par un texte, ou le comparent
const CALCULEES = [
  '[{ key: \'p\', axis: \'x\' == $mode ? \'right\' : \'left\' }]',
  '[{ key: \'p\', axis: $mode == \'x\' ? \'right\' : \'left\' }]',
  '[{ key: \'p\', axis: \'droite\' + $suffixe }]',
  '[{ key: \'p\', axis: \'gauche\' if $vrai }]',
  '[{ key: \'p\', axis: \'Right\'.toLowerCase() }]',
  '[{ key: \'p\', axis: \'right\' or $cote }]',
  '[{ key: \'p\', axis: \'droite\' ?? \'left\', color: \'url(x)\' + $nuance }]',
  '[{ key: \'p\', color: \'bleu\' + $nuance }, { key: \'q\', color: \'#12345\' || $nuance }]',
]

// les mêmes, écrites seules : [série, fautes, avertissements]
const ECRITES: Array<[string, number, number]> = [
  ['[{ key: \'p\', axis: \'droite\' }]', 1, 0],
  ['[{ key: \'p\', axis: \'Right\' }, { key: \'q\', axis: \'right\' }]', 1, 1],
  ['[{ key: \'p\', color: \'bleu\' }, { key: \'q\', color: \'#12345\' }]', 2, 0],
  ['[{ key: \'p\', axis: \'right\' }]', 0, 1],
]

describe('<@@chart> — une valeur de série calculée qui commence par un texte n\'est pas lue comme écrite', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('ni faute ni avertissement de construction pour une valeur calculée', () => {
    for (const series of CALCULEES) {
      assert.deepEqual(chartProblems(ref(series)), [], series)
      assert.deepEqual(chartWarnings(ref(series)), [], series)
    }
  })

  it('écrite seule, la même valeur reste une faute ou un avertissement', () => {
    for (const [series, fautes, avertissements] of ECRITES) {
      assert.equal(chartProblems(ref(series)).length, fautes, series)
      assert.equal(chartWarnings(ref(series)).length, avertissements, series)
    }
  })

  it('la vraie construction d\'une page qui les porte toutes ne s\'arrête pas et ne dit rien du graphique', async () => {
    const root   = mjsTmp('chart-valeur-calculee')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    const script = '<script>\n  $lignes = [{ x: \'a\', p: 1, q: 2 }]\n  $mode = \'x\'\n  $suffixe = \'\'\n  $vrai = true\n  $cote = \'left\'\n  $nuance = \'\'\n</script>\n'
    writeFileSync(join(srcDir, 'gk-page.mjs'), script + CALCULEES.map((s) => `<@@chart rows={$lignes} series={${s}} shape="stack"></@@chart>`).join('\n') + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => String(e?.message ?? e)), [])
    assert.deepEqual(stats.warnings.map(String).filter((w: string) => w.includes('@@chart')), [])
  })
})

// derrière une valeur écrite seule, un commentaire (`// …`, `/* … */`) ou la fin de la ligne, quand la suivante ouvre la clé suivante au
// même retrait (Civet y pose la virgule), la laissent seule : la faute arrête toujours la construction. Une ligne suivante plus en retrait
// (Civet en fait un appel : `'droite'({ color: 'red' })`), une ligne qui continue l'expression (`.replace(…)`, `+ $suffixe`, `and $cote`) et
// un `#` derrière le texte (Civet en fait `this.length`, un appel aussi : le gabarit n'a pas de commentaire `#`) la rendent calculée
const SEULES: Array<[string, number]> = [
  ['[{ key: \'p\', axis: \'droite\' // à revoir\n}]', 1],
  ['[{ key: \'p\', axis: \'droite\' /* à revoir */ }]', 1],
  ['[{ key: \'p\', color: \'bleu\' /* à revoir */, axis: \'left\' }]', 1],
  ['[{\n  key: \'p\', axis: \'droite\'\n  color: \'red\'\n}]', 1],
  ['[{\n  key: \'p\', axis: \'droite\' // à revoir\n  color: \'red\'\n}]', 1],
  ['[{\n  key: \'p\', color: \'bleu\'\n  \'axis\': \'left\'\n}]', 1],
]
const CALCULEES_SUR_DEUX_LIGNES = [
  '[{\n  key: \'p\', color: \'bleu\'\n  .replace(\'bleu\', \'blue\')\n}]',
  '[{\n  key: \'p\', axis: \'droite\'\n  + $suffixe\n}]',
  '[{\n  key: \'p\', axis: \'droite\'\n  and $cote\n}]',
  '[{ key: \'p\', axis: \'droite\'\n  color: \'red\' }]',
  '[{ key: \'p\', axis: \'droite\' # x\n}]',
]

describe('<@@chart> — une valeur de série écrite seule le reste derrière un commentaire ou en fin de ligne', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('commentaire `//` ou `/* */`, fin de ligne suivie de la clé suivante au même retrait : la faute est relevée', () => {
    for (const [series, fautes] of SEULES) assert.equal(chartProblems(ref(series)).length, fautes, series)
  })

  it('ligne suivante plus en retrait, ligne qui continue l\'expression, `#` derrière le texte : valeur calculée, aucune faute', () => {
    for (const series of CALCULEES_SUR_DEUX_LIGNES) assert.deepEqual(chartProblems(ref(series)), [], series)
  })

  it('la vraie construction : les valeurs seules l\'arrêtent, les valeurs calculées sur deux lignes la laissent passer', async () => {
    const construire = async (nom: string, toutes: string[]) => {
      const root   = mjsTmp(nom)
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      const script = '<script>\n  $lignes = [{ x: \'a\', p: 1 }]\n  $suffixe = \'\'\n  $cote = \'left\'\n</script>\n'
      writeFileSync(join(srcDir, 'gk-page.mjs'), script + toutes.map((s) => `<@@chart rows={$lignes} series={${s}} shape="stack"></@@chart>`).join('\n') + '\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
      const stats   = await bundler.compile()
      await bundler.close()
      return stats.errors.map((e: any) => String(e?.message ?? e)).join('\n')
    }
    const refus = await construire('chart-valeur-seule', SEULES.map(([s]) => s))
    assert.match(refus, /droite/, refus)
    assert.match(refus, /bleu/, refus)
    assert.equal(await construire('chart-valeur-calculee-deux-lignes', CALCULEES_SUR_DEUX_LIGNES), '')
  })
})
