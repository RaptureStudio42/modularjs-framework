// module cœur <@@chart> : une série écrite `axis: 'right'` sur une forme écrite qui n'a qu'une échelle, ou aucune (barres empilées,
// histogramme, anneau, carte, radar, calendrier) — le module l'ignore et le dit en développement ; la construction le dit aussi, par un
// avertissement qui nomme le fichier, la forme et les séries, en français et en anglais, sans s'arrêter, une fois par message. Rien quand
// la forme a deux échelles, quand la forme, la série, sa clé, son axe ou sa sorte viennent d'une variable, sous un étalement, pour une série
// de mots, ni pour un radar dont les lignes écrites sont 1 ou 2 (une courbe le remplace). Un mot inconnu reste une erreur, sans avertissement.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import * as coreChart from '../src/bundler/core-chart.js'

async function construire(etiquette: string, page: string): Promise<{ fichier: string, erreurs: string, avertissements: string[] }> {
  const root   = mjsTmp(etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gk-page.mjs'), page)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { fichier: join(srcDir, 'gk-page.mjs'), erreurs: stats.errors.map((e: any) => String(e?.message ?? e)).join('\n'), avertissements: stats.warnings.map(String) }
}

const DONNEES = `<script>\n  $lignes = [{ x: 'a', v: 1, p: 2 }]\n  $series = [{ key: 'v' }, { key: 'p', axis: 'right' }]\n  $forme = 'stack'\n  $cote = 'right'\n  $sorte = 'text'\n  $cle = 'p'\n  $base = { key: 'p' }\n  $vrai = true\n  $reglages = { shape: 'line' }\n</script>\n`
const DEUX    = 'line area dots bar'
const axeDroit = (l: string) => l.includes('axis « right »') || l.includes('axis "right"')

const AVERTIS = DONNEES + [
  '<@@chart rows={$lignes} series={[{ key: \'temperature\', unit: \'°C\' }, { key: \'pluie\', unit: \'mm\', axis: \'right\' }]} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'temperature\', unit: \'°C\' }, { key: \'pluie\', unit: \'mm\', axis: \'right\' }]} shape="stack"></@@chart>',
  '<mjs-core-chart rows={$lignes} series={[{ key: \'a\', axis: \'right\' }, { "key": "b", "axis": " right " }, { key: \'c\', axis: \'right\', kind: \'text\' }, { key: \'d\', axis: \'left\' }, { key: \'e\', axis: \'right\', kind: \'number\' }]} shape="pie"></mjs-core-chart>',
  '<@@chart rows={$lignes} series={[{ key: 1, axis: \'right\' }, { key: \'\', axis: \'right\' }]} shape=" histogram "></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'h\', name: \'Humidité\', axis: \'right\', color: \'green\' }]} shape="heatmap"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'r\', axis: \'right\' }]} shape="radar"></@@chart>',
  '<@@chart rows={[{ x: \'2026-10-01\', v: 1 }, { x: \'2026-10-02\', v: 2 }, { x: \'2026-10-03\', v: 3 }]} series={[{ key: \'v\', axis: \'right\', axis: \'left\' }, { key: \'w\', axis: \'left\', axis: \'right\' }]} shape="radar"></@@chart>',
  '<@@chart rows={$lignes} series={[...$series, { key: \'k\', axis: \'right\' }, $vrai ? { key: \'q\', axis: \'right\' } : { key: \'q\' }, { ...$base, axis: \'right\' }]} shape="calendar"></@@chart>',
].join('\n') + '\n'

const ATTENDUS = [
  `<@@chart shape="stack" series={…}> — la forme stack n'a qu'une échelle, axis « right » est ignoré pour pluie (formes à deux échelles : ${DEUX}). Retirez axis: 'right' ou changez de forme.`,
  `<mjs-core-chart shape="pie" series={…}> — la forme pie n'a qu'une échelle, axis « right » est ignoré pour a b e (formes à deux échelles : ${DEUX}). Retirez axis: 'right' ou changez de forme.`,
  `<@@chart shape="histogram" series={…}> — la forme histogram n'a qu'une échelle, axis « right » est ignoré pour 1 (formes à deux échelles : ${DEUX}). Retirez axis: 'right' ou changez de forme.`,
  `<@@chart shape="heatmap" series={…}> — la forme heatmap n'a qu'une échelle, axis « right » est ignoré pour h (formes à deux échelles : ${DEUX}). Retirez axis: 'right' ou changez de forme.`,
  `<@@chart shape="radar" series={…}> — la forme radar n'a qu'une échelle, axis « right » est ignoré pour r (formes à deux échelles : ${DEUX}). Retirez axis: 'right' ou changez de forme.`,
  `<@@chart shape="radar" series={…}> — la forme radar n'a qu'une échelle, axis « right » est ignoré pour w (formes à deux échelles : ${DEUX}). Retirez axis: 'right' ou changez de forme.`,
  `<@@chart shape="calendar" series={…}> — la forme calendar n'a qu'une échelle, axis « right » est ignoré pour k (formes à deux échelles : ${DEUX}). Retirez axis: 'right' ou changez de forme.`,
]

// rien à dire : une forme à deux échelles (écrite ou par défaut), une forme, des séries, une clé, un axe ou une sorte venus d'une variable,
// un étalement sur la balise ou dans la série, une série de mots, une clé vide, une interpolation, une expression qui n'est pas un tableau
// d'objets écrits, un objet qui n'est pas un élément du tableau
const RIEN = DONNEES + [
  ...['line', 'area', 'dots', 'bar'].map((f) => `<@@chart rows={$lignes} series={[{ key: 'p', axis: 'right' }]} shape="${f}"></@@chart>`),
  '<@@chart rows={$lignes} series={[{ key: \'p\', axis: \'right\' }]}></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'p\', axis: \'right\' }]} shape={$forme}></@@chart>',
  '<@@chart rows={$lignes} series={$series} shape="stack"></@@chart>',
  '<@@chart {...$reglages} rows={$lignes} series={[{ key: \'p\', axis: \'right\' }]} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'t\', axis: \'right\', kind: \'text\' }, { key: \'u\', axis: \'right\', kind: $sorte }, { key: \'w\', axis: $cote }, { key: $cle, axis: \'right\' }, { key: $cle + \'x\', axis: \'right\' }]} shape="pie"></@@chart>',
  '<@@chart rows={$lignes} series={[{ ...$base, axis: \'right\' }, { key: \'\', axis: \'right\' }, { key: \'z\', axis: $cote + \'\' }, { key: \'y\', axis: \'right\'.trim() }]} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'z\', axis: \'right\', name: "#{$cle}" }]} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={$vrai ? [{ key: \'q\', axis: \'right\' }] : []} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'q\', axis: \'right\' }].concat($series)} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={[$vrai ? { key: \'q\', axis: \'right\' } : { key: \'q\' }]} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'q\', name: "le champ axis: \'right\'", meta: { axis: \'right\' } }]} shape="stack"></@@chart>',
].join('\n') + '\n'

// fautes : un mot inconnu de l'axe ou de la forme reste une erreur (une forme inconnue devient une courbe, à deux échelles) ; un radar
// de 2 lignes écrites est une erreur, et une courbe le remplace : pas d'avertissement d'axe
const FAUTES = DONNEES + [
  '<@@chart rows={$lignes} series={[{ key: \'p\', axis: \'droite\' }]} shape="stack"></@@chart>',
  '<@@chart rows={$lignes} series={[{ key: \'p\', axis: \'right\' }]} shape="courbe"></@@chart>',
  '<@@chart rows={[{ x: \'a\', v: 1 }, { x: \'b\', v: 2 }]} series={[{ key: \'v\', axis: \'right\' }]} shape="radar"></@@chart>',
].join('\n') + '\n'

describe('<@@chart> — axis: \'right\' sur une forme à une seule échelle, dit à la construction', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une série écrite axis: \'right\' sur une forme écrite à une seule échelle : un avertissement par message, la construction continue', async () => {
    const { fichier, erreurs, avertissements } = await construire('graphique-axe-droite', AVERTIS)
    assert.equal(erreurs, '', erreurs)
    for (const attendu of ATTENDUS) assert.ok(avertissements.includes(`[bundler] ${fichier} : ${attendu}`), `avertissement absent : ${attendu}\n--- avertissements :\n${avertissements.join('\n')}`)
    const lignes = avertissements.filter(axeDroit)
    assert.equal(lignes.length, ATTENDUS.length, `un avertissement par message, rien de plus :\n${lignes.join('\n')}`)
  })

  it('une forme à deux échelles, une valeur venue d\'une variable ou incertaine, un étalement, une série de mots : aucun avertissement', async () => {
    const { erreurs, avertissements } = await construire('graphique-axe-droite-rien', RIEN)
    assert.equal(erreurs, '', erreurs)
    assert.deepEqual(avertissements.filter(axeDroit), [])
  })

  it('un mot inconnu reste une erreur, sans avertissement d\'axe ; un radar de 2 lignes écrites devient une courbe', async () => {
    const { fichier, erreurs, avertissements } = await construire('graphique-axe-droite-fautes', FAUTES)
    assert.ok(erreurs.includes(`[bundler] ${fichier} : <@@chart series={…}> — axis « droite » d'une série n'est pas une valeur connue (valeurs connues : left right). Corrigez la faute de frappe.`), erreurs)
    assert.ok(erreurs.includes(`[bundler] ${fichier} : <@@chart shape="courbe"> — « courbe » n'est pas une valeur connue de shape`), erreurs)
    assert.ok(erreurs.includes(`[bundler] ${fichier} : <@@chart shape="radar" rows={…}> — un radar demande au moins 3 lignes, une par axe : 2 sont écrites.`), erreurs)
    assert.deepEqual(avertissements.filter(axeDroit), [])
  })

  it('en anglais aussi', async () => {
    setMessagesLang('en')
    try {
      const { fichier, erreurs, avertissements } = await construire('graphique-axe-droite-en', DONNEES + '<@@chart rows={$lignes} series={[{ key: \'v\' }, { key: \'rain\', axis: \'right\' }, { key: \'wind\', axis: \'right\' }]} shape="stack"></@@chart>\n')
      assert.equal(erreurs, '', erreurs)
      const attendu = `[bundler] ${fichier}: <@@chart shape="stack" series={…}> — the stack shape has a single scale, axis "right" is ignored for rain wind (shapes with two scales: ${DEUX}). Remove axis: 'right' or change the shape.`
      assert.ok(avertissements.includes(attendu), `avertissement absent : ${attendu}\n--- avertissements :\n${avertissements.join('\n')}`)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('les formes à deux échelles du contrôle sont celles du module', () => {
    const module = readFileSync(new URL('../src/core-modules/chart.mjs', import.meta.url), 'utf-8')
    assert.deepEqual((coreChart as Record<string, unknown>).CHART_TWIN_SHAPES, [.../^ {2}TWIN_SHAPES\s*= \[([^\]]*)\]/m.exec(module)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
  })
})
