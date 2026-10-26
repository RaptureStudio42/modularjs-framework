// les calculs des graphiques (src/runtime/mjs_chart.ts) : échelles, places sur l'axe x, étiquettes, regroupement par période, tendance,
// statistiques, histogramme, camembert, formats, table neutre et adaptateur des lignes de données. Le fichier runtime est chargé brut
// (`new Function`, objet µ nu) : il ne touche jamais au DOM. Les cas repris de l'application qui l'a vu naître gardent leurs valeurs ; les
// statistiques sont comparées à celles que rend la méthode du serveur de cette application (Ruby, valeurs relevées telles quelles)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { Bundler } from '../src/bundler/index.js'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url)), 'utf-8')
const µ: any = {}
new Function('µ', SOURCE)(µ)
const C = µ._mjs_chart

const near = (got: number, want: number, message?: string) => assert.ok(Math.abs(got - want) < 1e-9, (message || 'écart') + ' : ' + got + ' au lieu de ' + want)

const ROWS = [
  { x: 'a', readings: { s1: 1, s2: 10 } },
  { x: 'b', readings: { s1: 2 } },
  { x: 'c', readings: { s1: 3, s2: 30 } }
]

// le modèle d'un graphique à axes depuis des lignes de données, par l'adaptateur
const plotRows = (rows: any[], series: any[], hidden: string[], options: any) => C.plotModel(C.fromRows(rows, series), Object.assign({ hidden }, options))

describe('graphiques : les calculs, sans DOM', () => {
  it('une échelle aux bornes rondes couvre les valeurs, avec ou sans le zéro', () => {
    assert.deepEqual(C.niceScale(70, 74, 4), { min: 70, max: 74, ticks: [70, 71, 72, 73, 74] })
    assert.deepEqual(C.niceScale(0, 97, 4), { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] })
    assert.deepEqual(C.niceScale(5, 9, 4, true), { min: 0, max: 10, ticks: [0, 2.5, 5, 7.5, 10] }, 'les barres partent de zéro')
    assert.deepEqual(C.niceScale(-3, 5, 4), { min: -4, max: 6, ticks: [-4, -2, 0, 2, 4, 6] })
    const flat = C.niceScale(3, 3, 4)
    assert.ok(flat.min < 3 && flat.max > 3, 'une série plate a une épaisseur')
    assert.equal(C.niceScale(0, 0, 4, true).min, 0)
    assert.equal(C.niceScale(0, 0, 4, true).max, 1)
    assert.deepEqual(C.niceScale(NaN, 4), { min: 0, max: 1, ticks: [0, 1] })
  })

  it('des bornes imposées : l\'axe ne se resserre pas en deçà, une valeur ou une tendance qui les dépasse l\'élargit', () => {
    assert.deepEqual(C.scaleOf([2, 3], { min: 1, max: 5 }), { min: 1, max: 5, ticks: [1, 2, 3, 4, 5] }, 'une humeur de 2 à 3 garde son échelle de 1 à 5')
    assert.deepEqual(C.scaleOf([2, 3]), C.niceScale(2, 3, 4), 'sans bornes, l\'axe suit les valeurs')
    assert.ok(C.scaleOf([2, 7], { min: 1, max: 5 }).max >= 7, 'une valeur au-dessus élargit l\'axe')
    assert.deepEqual(C.scaleOf([], { min: 1, max: 5 }), { min: 1, max: 5, ticks: [1, 2, 3, 4, 5] }, 'sans valeur, les bornes restent')
    assert.deepEqual(C.scaleOf([]), { min: 0, max: 1, ticks: [0, 1] })
    assert.deepEqual(C.scaleOf(['x', null, '', 3, '4']), C.niceScale(3, 4, 4), 'les mots et les cases vides ne comptent pas')
    const rows = [{ x: '2026-10-01', readings: { m: 3 } }, { x: '2026-10-02', readings: { m: 4 } }]
    const series = [{ key: 'm', name: 'Humeur', unit: '', color: 'gold' }]
    assert.deepEqual([plotRows(rows, series, [], { kind: 'date', shape: 'line', bounds: { min: 1, max: 5 } }).scale.min, plotRows(rows, series, [], { kind: 'date', shape: 'line', bounds: { min: 1, max: 5 } }).scale.max], [1, 5])
    const rising = [3, 4, 5, 5].map((v, i) => ({ x: '2026-10-0' + (i + 1), readings: { m: v } }))
    const model = plotRows(rising, series, [], { kind: 'date', shape: 'line', bounds: { min: 1, max: 5 }, trend: true })
    assert.ok(model.scale.max >= model.lines[0].trend.next, 'la tendance qui sort des bornes les élargit')
    assert.deepEqual(plotRows(rows, series, [], { kind: 'date', shape: 'line', bounds: null }).scale, plotRows(rows, series, [], { kind: 'date', shape: 'line' }).scale, 'des bornes nulles : l\'axe suit les valeurs')
  })

  it('la position d\'une valeur dans un domaine', () => {
    assert.equal(C.ratio(5, 0, 10), 0.5)
    assert.equal(C.ratio(3, 3, 3), 0.5, 'un domaine sans épaisseur donne le milieu')
  })

  it('l\'abscisse se lit selon l\'axe : jour, instant, nombre, libellé', () => {
    assert.equal(C.parseX('date', '2026-03-10'), Date.UTC(2026, 2, 10))
    assert.equal(C.parseX('datetime', '2026-03-10T08:00:00Z'), Date.UTC(2026, 2, 10, 8))
    assert.equal(C.parseX('number', '2,5'), 2.5)
    assert.equal(C.parseX('number', 'abc'), null)
    assert.equal(C.parseX('number', ''), null)
    assert.equal(C.parseX('category', 'Lundi'), null)
  })

  it('la place des colonnes sur l\'axe x : à l\'échelle du temps et des nombres, égale pour des libellés, en cases pour des barres', () => {
    assert.deepEqual(C.xFractions(['a', 'b', 'c'], 'category', false), [0, 0.5, 1])
    assert.deepEqual(C.xFractions(['a'], 'category', false), [0.5])
    assert.deepEqual(C.xFractions(['2026-01-01', '2026-01-02', '2026-01-11'], 'date', false), [0, 0.1, 1], 'deux jours séparés de neuf : l\'écart se voit')
    assert.deepEqual(C.xFractions(['0', '5', '10'], 'number', false), [0, 0.5, 1])
    assert.deepEqual(C.xFractions(['a', 'b', 'c', 'd'], 'category', true), [0.125, 0.375, 0.625, 0.875])
    assert.deepEqual(C.xFractions(['2026-01-01', 'oups'], 'date', false), [0, 1], 'une abscisse illisible retombe sur des intervalles égaux')
    assert.deepEqual(C.xFractions(['2026-03-10T08:00:00Z', '2026-03-10T09:00:00Z', '2026-03-10T12:00:00Z'], 'datetime', false), [0, 0.25, 1], 'les instants à l\'échelle du temps')
  })

  it('la colonne la plus proche d\'un toucher', () => {
    assert.equal(C.nearestIndex([0, 0.1, 1], 0.08), 1)
    assert.equal(C.nearestIndex([0, 0.1, 1], 0.52), 1)
    assert.equal(C.nearestIndex([0, 0.1, 1], 0.6), 2)
    assert.equal(C.nearestIndex([], 0.5), -1)
  })

  it('les étiquettes de l\'axe x ne se chevauchent pas, la première et la dernière restent', () => {
    assert.deepEqual(C.labelPicks([0, 0.25, 0.5, 0.75, 1], ['a', 'b', 'c', 'd', 'e']), [0, 1, 2, 3, 4])
    const long = 'x'.repeat(40)
    assert.deepEqual(C.labelPicks([0, 0.25, 0.5, 0.75, 1], [long, long, long, long, long]), [0, 2, 4], 'de longs libellés : moins d\'étiquettes, entières')
    const fractions = Array.from({ length: 40 }, (_, i) => i / 39)
    const picks = C.labelPicks(fractions, fractions.map(() => 'ab'))
    assert.equal(picks[0], 0)
    assert.equal(picks[picks.length - 1], 39)
    for (let i = 1; i < picks.length; i++) assert.ok(fractions[picks[i]] - fractions[picks[i - 1]] >= 0.14 - 1e-9, 'écart suffisant entre ' + picks[i - 1] + ' et ' + picks[i])
    assert.deepEqual(C.labelPicks([0.5], ['seule']), [0])
    assert.deepEqual(C.labelPicks([], []), [])
  })

  it('à 390 px, deux dates voisines de l\'axe ne se touchent plus : chaque étiquette a sa largeur et sa place réelles', () => {
    // un point par jour pendant huit jours, écrits « 21 sept. » ; la zone de tracé d'un écran de 390 px (moins l'axe y et les marges) fait
    // 300 px, une lettre de 10,5 px en fait 6 ; l'axe pose la première étiquette au bord gauche, la dernière au bord droit, les autres centrées
    const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']
    const fractions = C.xFractions(days, 'date', false)
    const texts: string[] = days.map((d) => C.formatX('date', d, 'fr', true))
    assert.equal(texts[0], '21 sept.')
    const boxes = (picks: number[], width: number) => picks.map((i) => {
      const at = fractions[i] * width
      const size = texts[i].length * 6
      if (i === 0) return [at, at + size]
      if (i === days.length - 1) return [at - size, at]
      return [at - size / 2, at + size / 2]
    })
    const picks = C.labelPicks(fractions, texts, { width: 300, charWidth: 6, gap: 6 })
    assert.equal(picks[0], 0, 'la première reste')
    assert.equal(picks[picks.length - 1], days.length - 1, 'la dernière reste')
    const b = boxes(picks, 300)
    for (let k = 1; k < b.length; k++) assert.ok(b[k][0] - b[k - 1][1] >= 6, 'les étiquettes ' + picks[k - 1] + ' et ' + picks[k] + ' se touchent : ' + JSON.stringify([b[k - 1], b[k]]))
    assert.deepEqual(C.labelPicks(fractions, texts, { width: 1000, charWidth: 6, gap: 6 }), [0, 1, 2, 3, 4, 5, 6, 7], 'avec la place, toutes restent')
    assert.deepEqual(C.labelPicks(fractions, texts, { width: 300, gap: 6, measure: (t: string) => t.length * 6 }), picks, 'une largeur mesurée par l\'écran donne le même choix')
    assert.deepEqual(C.labelPicks([0, 1], ['21 sept.', '28 sept.'], { width: 60, charWidth: 6, gap: 6 }), [0], 'trop étroit pour deux : la première seule, jamais deux étiquettes l\'une sur l\'autre')
  })

  it('les classes d\'un histogramme : bornes rondes, tout le monde compté, la dernière fermée à droite', () => {
    const bins = C.histogramBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(bins.map((b: any) => [b.from, b.to]), [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]])
    assert.deepEqual(bins.map((b: any) => b.count), [1, 2, 2, 2, 3], 'le 10 tombe dans la dernière classe')
    const skewed = C.histogramBins([1, 1, 1, 2, 10])
    assert.deepEqual(skewed.map((b: any) => b.count), [4, 0, 0, 1])
    assert.equal(skewed.reduce((sum: number, b: any) => sum + b.count, 0), 5)
    assert.deepEqual(C.histogramBins([5, 5, 5]), [{ from: 5, to: 5, count: 3 }])
    assert.deepEqual(C.histogramBins([]), [])
    assert.deepEqual(C.histogramBins(['x', null]), [])
    assert.equal(C.histogramBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2).length, 2, 'le nombre de classes demandé')
    assert.deepEqual(C.histogramBins([0.1, 0.2, 0.3]).map((b: any) => b.count).reduce((a: number, b: number) => a + b, 0), 3, 'les décimales ne perdent personne')
    const many = C.histogramBins(Array.from({ length: 5000 }, (_, i) => i % 97))
    assert.ok(many.length >= 3 && many.length <= 12, 'Sturges : de 3 à 12 classes')
    assert.equal(many.reduce((sum: number, b: any) => sum + b.count, 0), 5000, 'une longue série : tout le monde compté')
  })

  it('les parts d\'un camembert : seules les valeurs positives, la somme fait un tour', () => {
    const { total, slices } = C.pieShares([{ key: 'a', value: 2 }, { key: 'b', value: 1 }, { key: 'c', value: 1 }, { key: 'd', value: 0 }, { key: 'e', value: -3 }])
    assert.equal(total, 4)
    assert.deepEqual(slices.map((s: any) => s.key), ['a', 'b', 'c'])
    assert.deepEqual(slices.map((s: any) => s.percent), [50, 25, 25])
    assert.deepEqual(slices.map((s: any) => [s.from, s.to]), [[0, 0.5], [0.5, 0.75], [0.75, 1]])
    assert.deepEqual(C.pieShares([{ key: 'a', value: 1 }, { key: 'b', value: 1 }, { key: 'c', value: 1 }]).slices.map((s: any) => s.percent), [33.3, 33.3, 33.3])
    assert.deepEqual(C.pieShares([{ key: 'a', value: 0 }]), { total: 0, slices: [] })
  })

  it('les parts tirées de points : une abscisse additionnée, rangées de la plus grande, sept parts et « autres »', () => {
    const points = [{ x: 'a', y: 5 }, { x: 'b', y: 9 }, { x: 'a', y: 5 }, { x: 'c', y: 1 }, { x: 'd', y: 8 }, { x: 'e', y: 7 }, { x: 'f', y: 6 }, { x: 'g', y: 3 }, { x: 'h', y: 2 }, { x: 'i', y: -4 }, { x: 'j', y: 'mot' }, { x: 'k', y: 1 }]
    const pie = C.pieParts(points)
    assert.deepEqual(pie.slices.map((s: any) => s.key), ['a', 'b', 'd', 'e', 'f', 'g', 'h', '#others'], 'a (5 + 5) passe devant b, à égalité c et k gardent leur ordre d\'arrivée dans « autres »')
    const others = pie.slices[7]
    assert.deepEqual([others.others, others.count, others.value], [true, 2, 2], 'c et k fondus : 1 + 1')
    assert.equal(others.label, undefined, 'le libellé « autres » vient de l\'écran, jamais du calcul')
    assert.equal(pie.total, 10 + 9 + 8 + 7 + 6 + 3 + 2 + 2, 'le négatif et le mot ne comptent pas')
    near(pie.slices[pie.slices.length - 1].to, 1, 'la dernière part ferme le tour')
    assert.deepEqual(C.pieParts([{ x: 'a', y: 1 }, { x: 'b', y: 2 }]).slices.map((s: any) => s.key), ['b', 'a'], 'sous sept parts, pas d\'« autres »')
    assert.deepEqual(C.pieParts(points, 3).slices.map((s: any) => s.key), ['a', 'b', 'd', '#others'], 'le nombre de parts gardées se règle')
    assert.deepEqual(C.pieParts([]), { total: 0, slices: [] })
  })

  it('un secteur de camembert part du haut et tourne dans le sens des aiguilles', () => {
    assert.equal(C.arcPath(50, 50, 50, 0, 0, 0.25), 'M 50.00 0.00 A 50 50 0 0 1 100.00 50.00 L 50 50 Z')
    assert.ok(C.arcPath(50, 50, 50, 0, 0, 0.6).includes('A 50 50 0 1 1'), 'plus d\'un demi-tour : grand arc')
    assert.equal(C.arcPath(50, 50, 50, 0, 0.5, 0.5), '', 'une part vide ne trace rien')
    const full = C.arcPath(50, 50, 50, 20, 0, 1)
    assert.equal((full.match(/A /g) || []).length, 4, 'un anneau plein : deux arcs dehors, deux dedans')
    assert.ok(C.arcPath(50, 50, 50, 0, 0, 1).endsWith('Z'))
  })

  it('les nombres, les abscisses et les périodes s\'écrivent dans la langue donnée, en français comme en anglais', () => {
    assert.equal(C.formatNumber(72.4, 'fr'), '72,4')
    assert.equal(C.formatNumber(72.4, 'en'), '72.4')
    assert.equal(C.formatNumber(null, 'fr'), '—')
    assert.equal(C.formatNumber(1.23456, 'en'), '1.23')
    assert.equal(C.formatNumber(1234.5, 'fr'), '1 234,5')
    assert.equal(C.formatNumber(1234.5, 'en'), '1,234.5')
    assert.match(C.formatX('date', '2026-03-10', 'fr'), /^10 mars 2026$/)
    assert.match(C.formatX('date', '2026-03-10', 'fr', true), /^10 mars$/)
    assert.match(C.formatX('date', '2026-03-10', 'en'), /^Mar 10, 2026$/)
    assert.match(C.formatX('date', '2026-03-10', 'en', true), /^Mar 10$/)
    assert.equal(C.formatX('number', '2,5', 'fr'), '2,5')
    assert.equal(C.formatX('number', '2.5', 'en'), '2.5')
    assert.equal(C.formatX('category', 'Séance A', 'fr'), 'Séance A')
    assert.match(C.formatX('datetime', '2026-03-10T08:00:00Z', 'en'), /2026/)
    assert.doesNotMatch(C.formatX('datetime', '2026-03-10T08:00:00Z', 'fr', true), /2026/, 'court : sans l\'année')
    assert.match(C.axisNumber(12000, 'fr'), /^12\sk$/u)
    assert.equal(C.axisNumber(12000, 'en'), '12K')
    assert.match(C.axisNumber(1500000, 'fr'), /^1,5\sM$/u)
    assert.equal(C.axisNumber(1500000, 'en'), '1.5M')
    assert.equal(C.axisNumber(2.5, 'fr'), '2,5')
    assert.equal(C.formatPeriod('month', '2026-10-01', 'en', false), 'October 2026')
    assert.equal(C.formatPeriod('month', '2026-10-01', 'en', true), 'Oct 2026')
  })

  it('un graphique à axes : une échelle commune quand les unités sont les mêmes, une par série sinon', () => {
    const same = plotRows(ROWS, [{ key: 's1', unit: 'kg', color: 'gold', name: 'A' }, { key: 's2', unit: 'kg', color: 'blue', name: 'B' }], [], { kind: 'category', shape: 'line' })
    assert.equal(same.own, false)
    assert.deepEqual([same.scale.min, same.scale.max], [0, 30], 'une seule échelle pour les deux séries')
    const mixed = plotRows(ROWS, [{ key: 's1', unit: 'kg', color: 'gold', name: 'A' }, { key: 's2', unit: 'cm', color: 'blue', name: 'B' }], [], { kind: 'category', shape: 'line' })
    assert.equal(mixed.own, true)
    assert.equal(mixed.scale, null)
    assert.equal(mixed.lines[0].points[0].y, 1, 'le plus petit de s1 est en bas de SON échelle')
    assert.equal(mixed.lines[0].points[2].y, 0, 'le plus grand de s1 est en haut')
  })

  it('une série visible sans aucune valeur ne décide pas d\'une échelle par série', () => {
    const rows = [{ x: 'a', readings: { s1: 1 } }, { x: 'b', readings: { s1: 3, s3: 9 } }]
    const empty = plotRows(rows, [{ key: 's1', unit: 'kg', name: 'A' }, { key: 's2', unit: 'cm', name: 'B' }], [], { kind: 'category', shape: 'line' })
    assert.equal(empty.own, false, 'la série vide, d\'une autre unité, n\'impose pas une échelle par série')
    assert.ok(empty.scale && empty.scale.max >= 3, 'une échelle commune, celle des valeurs présentes')
    const filled = plotRows(rows, [{ key: 's1', unit: 'kg', name: 'A' }, { key: 's2', unit: 'cm', name: 'B' }, { key: 's3', unit: 'cm', name: 'C' }], [], { kind: 'category', shape: 'line' })
    assert.equal(filled.own, true, 'une seule valeur suffit à compter la série')
  })

  it('une case vide coupe la courbe, une série masquée disparaît', () => {
    const series = [{ key: 's1', unit: 'u', color: 'gold', name: 'A' }, { key: 's2', unit: 'u', color: 'blue', name: 'B' }]
    const model = plotRows(ROWS, series, [], { kind: 'category', shape: 'line' })
    const gap = model.lines.find((l: any) => l.key === 's2')
    assert.equal(gap.points[1], null)
    assert.equal((gap.d.match(/M/g) || []).length, 2, 'deux tronçons')
    assert.equal((model.lines.find((l: any) => l.key === 's1').d.match(/M/g) || []).length, 1)
    const hidden = plotRows(ROWS, series, ['s2'], { kind: 'category', shape: 'line' })
    assert.deepEqual(hidden.lines.map((l: any) => l.key), ['s1'])
    assert.ok(hidden.scale.max < 10, 'l\'échelle suit les séries visibles')
  })

  it('une série de mots ne se dessine pas, même quand une valeur ressemble à un nombre', () => {
    const rows = [{ x: 'a', readings: { s1: 1, s2: '12' } }, { x: 'b', readings: { s1: 3, s2: 'gai' } }]
    const series = [{ key: 's1', unit: 'u', color: 'gold', name: 'A' }, { key: 's2', unit: '', color: 'blue', name: 'Humeur', kind: 'text' }]
    const line = plotRows(rows, series, [], { kind: 'category', shape: 'line' })
    assert.deepEqual(line.lines.map((l: any) => l.key), ['s1'])
    assert.ok(line.scale.max < 5, 'l\'échelle ne voit pas le "12" du texte')
    assert.equal(line.own, false, 'une série de mots ne rend pas les unités différentes')
    const bars = plotRows(rows, series, [], { kind: 'category', shape: 'bar' })
    assert.ok(bars.bars.length > 0 && bars.bars.every((b: any) => b.key === 's1'), 'pas une barre pour un mot')
    const words = plotRows(rows, [series[1]], [], { kind: 'category', shape: 'line' })
    assert.deepEqual(words.lines, [], 'que des mots : rien à tracer')
  })

  it('des barres groupées par case partent de zéro, une par mesure', () => {
    const model = plotRows(ROWS, [{ key: 's1', unit: 'u', color: 'gold', name: 'A' }, { key: 's2', unit: 'u', color: 'blue', name: 'B' }], [], { kind: 'date', shape: 'bar' })
    assert.equal(model.slots, true)
    assert.equal(model.scale.min, 0)
    assert.equal(model.bars.length, 5, 'cinq mesures, cinq barres')
    assert.ok(model.bars.every((b: any) => b.height > 0 && b.width > 0 && b.left >= 0 && b.left + b.width <= 1))
    const first = model.bars.filter((b: any) => b.i === 0)
    assert.equal(first.length, 2)
    assert.ok(first[1].left > first[0].left, 'les barres d\'une case se suivent')
    assert.ok(model.lines[0].area.startsWith('M'), 'une aire se ferme sur la ligne de base')
  })

  it('la droite de tendance est celle du serveur : la pente, la valeur au rang 0 et le point suivant estimé', () => {
    const fit = C.trendFit([72, 73.5, 73, 74])
    near(fit.slope, 0.55, 'la série monte de 0.55 par point')
    near(fit.first, 72.3)
    near(fit.next, 74.5, 'point suivant estimé')
    assert.equal(fit.count, 4)
    assert.equal(fit.direction, 'up')
    assert.deepEqual(C.trendFit([72, null, 73.5, '', 73, 74]), fit, 'une case vide ne compte pas dans les rangs')
    assert.equal(C.trendFit([5]), null, 'une seule valeur : pas de droite')
    assert.equal(C.trendFit([null, null]), null)
    const flat = C.trendFit([4, 4, 4])
    near(flat.slope, 0)
    near(flat.next, 4)
    assert.equal(flat.direction, 'flat')
    assert.ok(C.trendFit([9, 7, 5]).slope < 0, 'une série qui descend a une pente négative')
    assert.equal(C.trendFit([9, 7, 5]).direction, 'down')
  })

  it('une place de plus après la dernière colonne : un écart moyen sur le temps, une case de plus aux barres, un intervalle aux libellés', () => {
    assert.deepEqual(C.xFractionsAhead(['2026-01-01', '2026-01-02', '2026-01-11'], 'date', false), { fractions: [0, 0.066667, 0.666667], next: 1 }, 'cinq jours d\'écart moyen avant le point suivant')
    assert.deepEqual(C.xFractionsAhead(['a', 'b', 'c'], 'category', false), { fractions: [0, 0.333333, 0.666667], next: 1 })
    assert.deepEqual(C.xFractionsAhead(['a', 'b', 'c'], 'category', true), { fractions: [0.125, 0.375, 0.625], next: 0.875 })
    assert.deepEqual(C.xFractionsAhead(['2026-01-01', '2026-01-01'], 'date', false), { fractions: [0, 0.5], next: 1 }, 'deux colonnes au même instant : des intervalles égaux')
  })

  it('avec la tendance, la droite part de la première valeur et finit au point suivant estimé, dans l\'échelle ; sans elle, rien ne change', () => {
    const rows = [{ x: '2026-10-01', readings: { s1: 72 } }, { x: '2026-10-02', readings: { s1: 73.5 } }, { x: '2026-10-03', readings: { s1: 73 } }, { x: '2026-10-04', readings: { s1: 74 } }]
    const series = [{ key: 's1', name: 'Poids', unit: 'kg', color: 'gold' }]
    const plain = plotRows(rows, series, [], { kind: 'date', shape: 'line' })
    assert.equal(plain.lines[0].trend, null, 'la tendance est une option : éteinte, aucune droite')
    assert.deepEqual(plain.fractions, [0, 1 / 3, 2 / 3, 1].map((v) => Math.round(v * 1e6) / 1e6))
    const model = plotRows(rows, series, [], { kind: 'date', shape: 'line', trend: true })
    const trend = model.lines[0].trend
    assert.deepEqual(model.fractions, [0, 0.25, 0.5, 0.75], 'la place du point suivant est réservée à droite')
    assert.equal(trend.to.x, 1)
    assert.equal(trend.from.x, 0)
    near(trend.next, 74.5)
    assert.ok(model.scale.max >= 74.5 && model.scale.min <= 72.3, 'l\'échelle couvre la droite')
    near(trend.from.y, 1 - (72.3 - model.scale.min) / (model.scale.max - model.scale.min))
    near(trend.to.y, 1 - (74.5 - model.scale.min) / (model.scale.max - model.scale.min))
    assert.match(trend.d, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
    const bars = plotRows(rows, series, [], { kind: 'date', shape: 'bar', trend: true })
    assert.equal(bars.fractions.length, 4)
    assert.equal(bars.lines[0].trend.to.x, 0.9, 'les barres gagnent une case pour le point suivant')
  })

  it('la tendance ne se trace ni pour une série masquée, ni pour une série de mots, ni sous deux valeurs', () => {
    const rows = [{ x: '2026-10-01', readings: { s1: 72, s2: 'bien', s3: 5 } }, { x: '2026-10-02', readings: { s1: 73, s2: 'mal' } }, { x: '2026-10-03', readings: { s1: 74, s2: 'bien' } }]
    const series = [{ key: 's1', name: 'Poids', unit: 'kg', color: 'gold' }, { key: 's2', name: 'Humeur', kind: 'text', color: 'blue' }, { key: 's3', name: 'Rare', unit: 'kg', color: 'pink' }]
    const model = plotRows(rows, series, [], { kind: 'date', shape: 'line', trend: true })
    assert.deepEqual(model.lines.map((l: any) => l.key), ['s1', 's3'], 'les mots ne se dessinent pas')
    assert.ok(model.lines[0].trend, 'la série de nombres a sa droite')
    assert.equal(model.lines[1].trend, null, 'une série à une valeur n\'a pas de droite')
    const masked = plotRows(rows, series, ['s1'], { kind: 'date', shape: 'line', trend: true })
    assert.deepEqual(masked.lines.map((l: any) => l.key), ['s3'])
    assert.equal(masked.lines[0].trend, null)
    assert.deepEqual(masked.fractions, plotRows(rows, series, ['s1'], { kind: 'date', shape: 'line' }).fractions, 'sans droite, l\'axe ne réserve aucune place')
  })

  it('la période d\'une abscisse : le jour, le lundi de la semaine, le premier du mois, le premier de l\'année', () => {
    assert.deepEqual(C.STEPS, ['auto', 'day', 'week', 'month', 'year'])
    assert.equal(C.periodStart('date', '2026-10-21', 'day'), '2026-10-21')
    assert.equal(C.periodStart('date', '2026-10-21', 'week'), '2026-10-19', 'un mercredi retombe sur son lundi')
    assert.equal(C.periodStart('date', '2026-10-25', 'week'), '2026-10-19', 'le dimanche ferme la semaine du lundi')
    assert.equal(C.periodStart('date', '2026-10-19', 'week'), '2026-10-19')
    assert.equal(C.periodStart('date', '2026-01-01', 'week'), '2025-12-29', 'une semaine à cheval sur deux années')
    assert.equal(C.periodStart('date', '2026-10-21', 'month'), '2026-10-01')
    assert.equal(C.periodStart('date', '2026-10-21', 'year'), '2026-01-01')
    const evening = new Date(2026, 9, 21, 23, 30)
    assert.equal(C.periodStart('datetime', evening.toISOString(), 'day'), '2026-10-21', 'un instant se range à l\'heure de l\'écran, pas en UTC')
    assert.equal(C.periodStart('date', 'oups', 'week'), null)
  })

  it('le regroupement des lignes donne la moyenne par période, le nombre de lignes regroupées, et laisse l\'axe et les mots tels qu\'ils doivent être', () => {
    const series = [{ key: 's1', name: 'Poids' }, { key: 's2', name: 'Humeur', kind: 'text' }]
    const rows = [
      { id: 1, x: '2026-10-05', readings: { s1: 72, s2: 'a' } },
      { id: 2, x: '2026-10-07', readings: { s1: 74, s2: 'b' } },
      { id: 3, x: '2026-10-09', readings: { s2: 'c' } },
      { id: 4, x: '2026-10-14', readings: { s1: 70 } },
      { id: 5, x: '2026-11-02', readings: { s1: 71 } }
    ]
    const weeks = C.groupRows(rows, series, 'date', 'week')
    assert.equal(weeks.grouped, true)
    assert.equal(weeks.kind, 'date')
    assert.deepEqual(weeks.rows.map((r: any) => r.x), ['2026-10-05', '2026-10-12', '2026-11-02'])
    assert.deepEqual(weeks.rows.map((r: any) => r.count), [3, 1, 1], 'la bulle dit combien de lignes la semaine regroupe')
    assert.deepEqual(weeks.rows.map((r: any) => r.readings.s1), [73, 70, 71], 'la moyenne des seules valeurs présentes : (72 + 74) / 2')
    assert.deepEqual(weeks.rows.map((r: any) => r.id), [null, 4, 5], 'une ligne seule garde son numéro, on peut encore l\'ouvrir')
    assert.ok(weeks.rows.every((r: any) => !('s2' in r.readings)), 'un mot ne se moyenne pas : il disparaît')
    const months = C.groupRows(rows, series, 'date', 'month')
    assert.deepEqual(months.rows.map((r: any) => [r.x, r.count]), [['2026-10-01', 4], ['2026-11-01', 1]])
    near(months.rows[0].readings.s1, 72, '(72 + 74 + 70) / 3')
    const years = C.groupRows(rows, series, 'date', 'year')
    assert.deepEqual(years.rows.map((r: any) => [r.x, r.count]), [['2026-01-01', 5]])
    assert.equal(C.groupRows(rows, series, 'date', 'auto').rows, rows, 'auto : les lignes telles quelles')
    assert.equal(C.groupRows(rows, series, 'date', 'auto').grouped, false)
    assert.equal(C.groupRows(rows, series, 'category', 'week').rows, rows, 'un axe qui n\'est pas le temps ne se regroupe pas')
    assert.equal(C.groupRows(rows, series, 'number', 'week').grouped, false)
    assert.equal(C.groupRows(rows, series, 'date', 'fortnight').grouped, false, 'un pas inconnu ne regroupe rien')
    const instants = [{ id: 7, x: new Date(2026, 9, 5, 8).toISOString(), readings: { s1: 60 } }, { id: 8, x: new Date(2026, 9, 5, 20).toISOString(), readings: { s1: 64 } }]
    assert.deepEqual(C.groupRows(instants, series, 'datetime', 'day').rows.map((r: any) => [r.x, r.count, r.readings.s1]), [['2026-10-05', 2, 62]], 'deux instants du même jour')
  })

  it('une période s\'écrit pour l\'écran : le mois en toutes lettres, l\'année seule, le jour comme l\'axe', () => {
    assert.equal(C.formatPeriod('month', '2026-10-01', 'fr', false), 'octobre 2026')
    assert.equal(C.formatPeriod('month', '2026-10-01', 'fr', true), 'oct. 2026')
    assert.equal(C.formatPeriod('year', '2026-01-01', 'fr'), '2026')
    assert.equal(C.formatPeriod('week', '2026-10-19', 'fr', true), C.formatX('date', '2026-10-19', 'fr', true))
    assert.equal(C.formatPeriod('day', 'oups', 'fr'), 'oups')
  })

  it('les chiffres d\'une série s\'écrivent dans la langue donnée, comme les axes : virgule en français, point en anglais, pente signée', () => {
    const figures = { n: 12, mean: 5.93, median: 6, q1: 5.5, q3: 6.4, min: 4.2, max: 1234.5, deviation: 0.87, next: 6.01, slope: -0.23 }
    const fr = C.statsText(figures, 'fr')
    const en = C.statsText(figures, 'en')
    assert.equal(fr.mean, '5,93')
    assert.equal(en.mean, '5.93')
    assert.deepEqual([fr.median, fr.q1, fr.q3, fr.deviation, fr.next], ['6', '5,5', '6,4', '0,87', '6,01'])
    assert.deepEqual([en.median, en.q1, en.q3, en.deviation, en.next], ['6', '5.5', '6.4', '0.87', '6.01'])
    assert.equal(fr.slope, C.formatNumber(-0.23, 'fr'), 'la pente suit le même formateur que les axes')
    assert.equal(fr.slope, '-0,23')
    assert.equal(en.slope, '-0.23')
    assert.equal(fr.range, '4,2 – 1 234,5', 'l\'étendue : les deux bornes dans la langue, le groupe de milliers du français')
    assert.equal(en.range, '4.2 – 1,234.5')
    assert.ok(Object.values(C.statsText({}, 'fr')).every((text: any) => text.includes('—')), 'une valeur absente s\'écrit « — », jamais « undefined »')
  })

  it('chaque chiffre de la lecture statistique et de la tendance trouve son écriture : rien n\'est affiché tel quel', () => {
    const values = [72, 73.5, 73, 74]
    const fit = C.trendFit(values)
    const text = C.statsText(Object.assign({}, C.stats(values), { next: fit.next, slope: fit.slope }), 'fr')
    assert.deepEqual(Object.keys(text).sort(), ['deviation', 'mean', 'median', 'next', 'q1', 'q3', 'range', 'slope'])
    assert.deepEqual([text.mean, text.median, text.q1, text.q3, text.range, text.next, text.slope], ['73,13', '73,25', '72,5', '73,75', '72 – 74', '74,5', '0,55'])
    assert.ok(Object.values(text).every((t: any) => typeof t === 'string' && !/undefined|NaN/.test(t)))
  })
})

describe('graphiques : les statistiques sont celles du serveur', () => {
  // valeurs rendues par la méthode du serveur (Statistiques.de et Statistiques.tendance, Ruby) pour ces mêmes séries : quartiles par les
  // moitiés exclusives, sans interpolation ; chiffres arrondis à deux décimales, la moitié loin de zéro
  const CAS: any[] = [
    { valeurs: [5], serveur: { n: 1, somme: 5, moyenne: 5, mediane: 5, q1: null, q3: null, min: 5, max: 5, etendue: 0, ecartType: 0 }, tendance: { pente: null, prochain: null, sens: 'plat' } },
    { valeurs: [3, 1], serveur: { n: 2, somme: 4, moyenne: 2, mediane: 2, q1: 1, q3: 3, min: 1, max: 3, etendue: 2, ecartType: 1.41 }, tendance: { pente: -2, prochain: -1, sens: 'baisse' } },
    { valeurs: [7, 1, 4], serveur: { n: 3, somme: 12, moyenne: 4, mediane: 4, q1: 1, q3: 7, min: 1, max: 7, etendue: 6, ecartType: 3 }, tendance: { pente: -1.5, prochain: 1, sens: 'baisse' } },
    { valeurs: [4, 1, 3, 2], serveur: { n: 4, somme: 10, moyenne: 2.5, mediane: 2.5, q1: 1.5, q3: 3.5, min: 1, max: 4, etendue: 3, ecartType: 1.29 }, tendance: { pente: -0.4, prochain: 1.5, sens: 'baisse' } },
    { valeurs: [10, 2, 8, 4, 6], serveur: { n: 5, somme: 30, moyenne: 6, mediane: 6, q1: 3, q3: 9, min: 2, max: 10, etendue: 8, ecartType: 3.16 }, tendance: { pente: -0.6, prochain: 4.2, sens: 'baisse' } },
    { valeurs: [1, 2, 2, 2, 3, 9], serveur: { n: 6, somme: 19, moyenne: 3.17, mediane: 2, q1: 2, q3: 3, min: 1, max: 9, etendue: 8, ecartType: 2.93 }, tendance: { pente: 1.23, prochain: 7.47, sens: 'hausse' } },
    { valeurs: [-3, -1, -7, 0, 2, -1, 5], serveur: { n: 7, somme: -5, moyenne: -0.71, mediane: -1, q1: -3, q3: 2, min: -7, max: 5, etendue: 12, ecartType: 3.77 }, tendance: { pente: 1.18, prochain: 4, sens: 'hausse' } },
    { valeurs: [2, 2, 2, 2, 2, 2, 2], serveur: { n: 7, somme: 14, moyenne: 2, mediane: 2, q1: 2, q3: 2, min: 2, max: 2, etendue: 0, ecartType: 0 }, tendance: { pente: 0, prochain: 2, sens: 'plat' } },
    { valeurs: [-5, -2], serveur: { n: 2, somme: -7, moyenne: -3.5, mediane: -3.5, q1: -5, q3: -2, min: -5, max: -2, etendue: 3, ecartType: 2.12 }, tendance: { pente: 3, prochain: 1, sens: 'hausse' } },
    { valeurs: [-4.5, -0.5, -2.5], serveur: { n: 3, somme: -7.5, moyenne: -2.5, mediane: -2.5, q1: -4.5, q3: -0.5, min: -4.5, max: -0.5, etendue: 4, ecartType: 2 }, tendance: { pente: 1, prochain: -0.5, sens: 'hausse' } },
    { valeurs: [3, 7, 8, 5, 12, 14, 21, 13, 18], serveur: { n: 9, somme: 101, moyenne: 11.22, mediane: 12, q1: 6, q3: 16, min: 3, max: 21, etendue: 18, ecartType: 6 }, tendance: { pente: 1.88, prochain: 20.64, sens: 'hausse' } },
    { valeurs: [1.5, -2.25, 0.125, 7, 7, 3.333], serveur: { n: 6, somme: 16.71, moyenne: 2.78, mediane: 2.42, q1: 0.13, q3: 7, min: -2.25, max: 7, etendue: 9.25, ecartType: 3.74 }, tendance: { pente: 1.25, prochain: 7.16, sens: 'hausse' } },
    { valeurs: [-1.255, -1.245, 2.675, 0.145], serveur: { n: 4, somme: 0.32, moyenne: 0.08, mediane: -0.55, q1: -1.25, q3: 1.41, min: -1.25, max: 2.68, etendue: 3.93, ecartType: 1.85 }, tendance: { pente: 0.81, prochain: 2.11, sens: 'hausse' } },
    { valeurs: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], serveur: { n: 7, somme: 2.8, moyenne: 0.4, mediane: 0.4, q1: 0.2, q3: 0.6, min: 0.1, max: 0.7, etendue: 0.6, ecartType: 0.22 }, tendance: { pente: 0.1, prochain: 0.8, sens: 'hausse' } },
    { valeurs: [], serveur: { n: 0, somme: 0, moyenne: null, mediane: null, q1: null, q3: null, min: null, max: null, etendue: null, ecartType: null }, tendance: { pente: null, prochain: null, sens: 'plat' } },
    { valeurs: ['12', 'x', null, '', 4, '1e1', ' 7 '], serveur: { n: 4, somme: 33, moyenne: 8.25, mediane: 8.5, q1: 5.5, q3: 11, min: 4, max: 12, etendue: 8, ecartType: 3.5 }, tendance: { pente: -0.9, prochain: 6, sens: 'baisse' } }
  ]
  const DIRECTIONS: Record<string, string> = { hausse: 'up', baisse: 'down', plat: 'flat' }
  const arrondi = (v: number) => (Math.sign(v * 100) * Math.round(Math.abs(v * 100))) / 100 || 0

  for (const c of CAS) {
    it('série ' + JSON.stringify(c.valeurs) + ' : effectif, moyenne, médiane, quartiles, extrêmes, étendue, écart type et tendance identiques', () => {
      const s = c.serveur
      assert.deepEqual(C.stats(c.valeurs, 2), { n: s.n, sum: s.somme, mean: s.moyenne, median: s.mediane, q1: s.q1, q3: s.q3, min: s.min, max: s.max, range: s.etendue, deviation: s.ecartType })
      const fit = C.trendFit(c.valeurs)
      if (c.tendance.pente === null) assert.equal(fit, null, 'sous deux valeurs, pas de tendance')
      else assert.deepEqual([arrondi(fit.slope), arrondi(fit.next), fit.direction], [c.tendance.pente, c.tendance.prochain, DIRECTIONS[c.tendance.sens]])
    })
  }

  it('les quartiles sans arrondi : médiane de la moitié basse et de la moitié haute, la médiane d\'un effectif impair n\'appartient à aucune', () => {
    const odd = C.stats([9, 1, 7, 3, 5])
    assert.deepEqual([odd.q1, odd.median, odd.q3], [2, 5, 8], '1 3 | 5 | 7 9')
    const even = C.stats([8, 2, 6, 4, 10, 12])
    assert.deepEqual([even.q1, even.median, even.q3], [4, 7, 10], '2 4 6 | 8 10 12')
    const one = C.stats([4])
    assert.deepEqual([one.q1, one.median, one.q3], [null, 4, null], 'une seule valeur : pas de quartile, plutôt qu\'un chiffre inventé')
    near(C.stats([1, 2, 2, 2, 3, 9]).mean, 19 / 6, 'sans arrondi demandé, la valeur exacte')
    near(C.stats([1, 2]).deviation, Math.SQRT1_2, 'écart type de l\'échantillon (n − 1)')
  })
})

describe('graphiques : le regroupement et le changement d\'heure', () => {
  let before: string | undefined
  beforeEach(() => {
    before = process.env.TZ
    process.env.TZ = 'Europe/Paris'
  })
  afterEach(() => {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  })

  it('un instant se range dans le jour et la semaine de l\'heure locale, de part et d\'autre du passage à l\'heure d\'été et d\'hiver', () => {
    assert.equal(C.periodStart('datetime', '2026-03-29T01:30:00+01:00', 'week'), '2026-03-23', 'dimanche 29 mars, avant le passage')
    assert.equal(C.periodStart('datetime', '2026-03-29T03:30:00+02:00', 'week'), '2026-03-23', 'le même dimanche, après')
    assert.equal(C.periodStart('datetime', '2026-03-30T00:30:00+02:00', 'week'), '2026-03-30', 'lundi 0 h 30, encore dimanche en UTC : la semaine suivante')
    assert.equal(C.periodStart('datetime', '2026-10-25T00:30:00+02:00', 'day'), '2026-10-25', 'retour à l\'heure d\'hiver : 0 h 30 locale, encore la veille en UTC')
    assert.equal(C.periodStart('datetime', '2026-10-25T23:30:00+01:00', 'day'), '2026-10-25', 'le soir du jour de 25 heures')
  })

  it('les points regroupés par semaine du lundi : la moyenne et le nombre de valeurs, la semaine du changement d\'heure entière', () => {
    const noon = (day: number) => new Date(2026, 2, day, 12).toISOString()
    const series = [
      { key: 'p', name: 'Poids', unit: 'kg', points: [{ x: noon(23), y: 70 }, { x: noon(26), y: 72 }, { x: noon(29), y: 74 }, { x: '2026-03-30T00:30:00+02:00', y: 80 }, { x: noon(31), y: 'mot' }] },
      { key: 'h', name: 'Humeur', kind: 'text', points: [{ x: noon(23), y: 'bien' }] }
    ]
    const weeks = C.groupPoints(series, 'datetime', 'week')
    assert.deepEqual([weeks.grouped, weeks.kind], [true, 'date'])
    assert.deepEqual(weeks.series[0].points, [{ x: '2026-03-23', y: 72, count: 3 }, { x: '2026-03-30', y: 80, count: 1 }], 'du lundi 23 au dimanche 29 : (70 + 72 + 74) / 3 ; le mot ne compte pas')
    assert.deepEqual(weeks.series[1].points, [], 'une série de mots ne se moyenne pas')
    assert.equal(C.groupPoints(series, 'datetime', 'auto').series, series, 'auto : les séries telles quelles')
    assert.equal(C.groupPoints(series, 'category', 'week').grouped, false)
  })
})

describe('graphiques : l\'entrée neutre et l\'adaptateur des lignes', () => {
  it('les séries de points passent en table : une colonne par abscisse, dans l\'ordre du temps, une case vide où la série n\'a rien', () => {
    const table = C.tableOf([
      { key: 'a', name: 'A', points: [{ x: '2026-01-03', y: 3 }, { x: '2026-01-01', y: 1 }, { x: 'oups', y: 9 }] },
      { key: 'b', name: 'B', points: [{ x: '2026-01-02', y: '2' }, { x: '2026-01-01', y: 'x' }] },
      { key: 'h', name: 'Humeur', kind: 'text', points: [{ x: '2026-01-02', y: 'bien' }] }
    ], 'date')
    assert.deepEqual(table.xs, ['2026-01-01', '2026-01-02', '2026-01-03', 'oups'], 'le temps d\'abord, l\'illisible ensuite')
    assert.deepEqual(table.series.map((s: any) => s.values), [[1, null, 3, 9], [null, 2, null, null], [null, 'bien', null, null]], 'un mot reste un mot dans sa série, une case illisible reste vide')
    assert.equal(table.series[0].cells[2].y, 3, 'cells : le point d\'où vient la valeur')
    assert.equal(table.series[0].points, undefined)
    const twice = C.tableOf([{ key: 'a', points: [{ x: 'lun', y: 1 }, { x: 'lun', y: 2 }] }, { key: 'b', points: [{ x: 'mar', y: 5 }, { x: 'lun', y: 4 }] }], 'category')
    assert.deepEqual(twice.xs, ['lun', 'lun', 'mar'], 'deux mesures du même jour restent deux colonnes ; des libellés gardent leur ordre d\'arrivée')
    assert.deepEqual(twice.series.map((s: any) => s.values), [[1, 2, null], [4, null, 5]])
    assert.deepEqual(C.tableOf([], 'date'), { xs: [], series: [] })
  })

  it('les mêmes mesures, en points ou en lignes, donnent le même graphique', () => {
    const rows = [{ id: 1, x: '2026-10-01', readings: { s1: 72, s2: 10 } }, { id: 2, x: '2026-10-02', readings: { s1: 73.5 } }, { id: 3, x: '2026-10-04', readings: { s1: 74, s2: 30 } }]
    const series = [{ key: 's1', name: 'Poids', unit: 'kg', color: 'gold' }, { key: 's2', name: 'Pas', unit: 'kg', color: 'blue' }]
    const points = series.map((s) => Object.assign({}, s, { points: rows.filter((r: any) => r.readings[s.key] !== undefined).map((r: any) => ({ x: r.x, y: r.readings[s.key] })) }))
    for (const shape of ['line', 'bar', 'area']) {
      const options = { kind: 'date', shape, trend: true, bounds: { min: 0, max: 50 } }
      const viaRows = C.plotModel(C.fromRows(rows, series), options)
      const viaPoints = C.plotModel(C.tableOf(points, 'date'), options)
      assert.deepEqual(viaPoints.fractions, viaRows.fractions, shape + ' : les mêmes places')
      assert.deepEqual(viaPoints.scale, viaRows.scale, shape + ' : la même échelle')
      assert.deepEqual(viaPoints.lines.map((l: any) => [l.d, l.area, l.trend.d]), viaRows.lines.map((l: any) => [l.d, l.area, l.trend.d]), shape + ' : les mêmes tracés')
      assert.deepEqual(viaPoints.bars, viaRows.bars, shape + ' : les mêmes barres')
    }
    assert.equal(C.reading({ readings: { a: '12' } }, 'a'), 12)
    assert.equal(C.reading({ readings: { a: '' } }, 'a'), null, 'une case vide n\'est pas un zéro')
    assert.equal(C.reading({ readings: {} }, 'a'), null)
    assert.equal(C.fromRows(rows, series).series[0].cells[1].id, 2, 'cells : la ligne elle-même')
  })
})

describe('graphiques : le fichier ne part que chez une application qui s\'en sert', () => {
  it('le code compilé qui écrit `µ._mjs_chart` demande la clé « chart » ; sans lui, rien', async () => {
    const avec = await transpile('<script>\n$v = µ._mjs_chart.stats([1, 2, 3]).median\n</script>\n<p>{$v}</p>')
    assert.ok(scanCompiledFeatures(avec.output, avec.data).has('chart'))
    const sans = await transpile('<script>\n$v = [1, 2, 3].length\n</script>\n<p>{$v}</p>')
    assert.equal(scanCompiledFeatures(sans.output, sans.data).has('chart'), false)
  })

  it('la sélection du cœur : une application sans graphique ne reçoit pas mjs_chart.ts, la clé « chart » l\'apporte', () => {
    const b = new Bundler({ runtime: 'all', i18n: { default: 'fr' } })
    assert.equal(b.resolveRuntimeFiles(new Set()).files.includes('mjs_chart.ts'), false)
    assert.ok(b.resolveRuntimeFiles(new Set(['chart'])).files.includes('mjs_chart.ts'))
  })
})

describe('graphiques : les statistiques de chaque série sur ce qui est affiché', () => {
  const series = [{ key: 'p', name: 'Poids', unit: 'kg', color: 'gold' }, { key: 'r', name: 'Rare', unit: 'kg', color: 'blue' }, { key: 'h', name: 'Humeur', kind: 'text', color: 'pink' }]
  const rows = [
    { id: 1, x: '2026-10-05', readings: { p: 72, h: 'bien' } },
    { id: 2, x: '2026-10-07', readings: { p: 74, r: 9 } },
    { id: 3, x: '2026-10-14', readings: { p: 70 } },
    { id: 4, x: '2026-11-02', readings: { p: 71 } }
  ]

  it('une lecture par série visible, sur les lignes montrées : regroupées par semaine, ce sont les moyennes de semaine qui comptent', () => {
    const shown = C.groupRows(rows, series, 'date', 'week').rows
    const figures = C.rowsStats(shown, series, { kind: 'date', shape: 'line' })
    assert.deepEqual(figures.map((f: any) => f.key), ['p', 'r'], 'une série de mots n\'a pas de statistique')
    const p = figures[0]
    assert.deepEqual([p.stats.n, p.stats.median, p.stats.q1, p.stats.q3, p.stats.min, p.stats.max], [3, 71, 70, 73, 70, 73], 'les semaines : 73, 70, 71')
    near(p.stats.mean, 214 / 3)
    assert.equal(C.rowsStats(rows, series, { kind: 'date', shape: 'line' })[0].stats.n, 4, 'sans regroupement, les quatre lignes')
    near(p.trend.slope, -1, 'la tendance des semaines')
    const model = C.plotModel(C.fromRows(shown, series), { kind: 'date', shape: 'line' })
    for (const name of ['mean', 'median', 'q1', 'q3']) {
      near(p.marks[name].y, 1 - (p.stats[name] - model.scale.min) / (model.scale.max - model.scale.min), name + ' : à sa hauteur dans l\'échelle de la série')
      assert.match(p.marks[name].d, /^M 0 [\d.]+ L 1000 [\d.]+$/, name + ' : un trait d\'un bord à l\'autre')
    }
    assert.equal(p.marks.trend, undefined, 'la droite n\'est un trait que si la tendance est demandée')
    assert.ok(C.rowsStats(shown, series, { kind: 'date', shape: 'line', trend: true })[0].marks.trend.d.startsWith('M '))
    const r = figures[1]
    assert.deepEqual([r.stats.n, r.stats.q1, r.stats.q3, r.trend], [1, null, null, null], 'une seule valeur : ni quartile ni tendance')
    assert.deepEqual(Object.keys(r.marks).sort(), ['mean', 'median'], 'pas de trait pour un quartile qui n\'existe pas')
    assert.deepEqual(C.rowsStats(shown, series, { kind: 'date', shape: 'line', hidden: ['p'] }).map((f: any) => f.key), ['r'], 'une série masquée n\'est pas lue')
    const own = C.seriesStats(C.fromRows(rows, [series[0], { key: 'r', name: 'Pas', unit: 'pas', color: 'blue' }]), { kind: 'date', shape: 'line' })
    near(own[1].marks.mean.y, 0.5, 'unités différentes : le trait suit l\'échelle propre de la série')
  })

  it('les traits de moyenne et de médiane d\'un histogramme se placent sur la largeur des classes', () => {
    const bins = C.histogramBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const values = C.stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(C.histogramMarks(bins, values), { mean: 0.55, median: 0.55 })
    assert.deepEqual(C.histogramMarks(bins, { mean: null }), { mean: null, median: null })
    assert.deepEqual(C.histogramMarks([], values), { mean: null, median: null })
  })
})

describe('graphiques : barres empilées, carte jour × heure, radar, calendrier', () => {
  let before: string | undefined
  beforeEach(() => {
    before = process.env.TZ
    process.env.TZ = 'Europe/Paris'
  })
  afterEach(() => {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  })

  it('des barres empilées : chaque segment part du cumul des précédents, l\'échelle couvre le plus haut total', () => {
    const table = C.tableOf([
      { key: 'a', color: 'gold', points: [{ x: 'lun', y: 1 }, { x: 'mar', y: 3 }, { x: 'mer', y: 2 }] },
      { key: 'b', color: 'blue', points: [{ x: 'lun', y: 2 }, { x: 'mer', y: 4 }, { x: 'mar', y: -5 }] },
      { key: 'm', kind: 'text', points: [{ x: 'lun', y: 'mot' }] }
    ], 'category')
    const stack = C.stackModel(table, { kind: 'category' })
    assert.deepEqual(stack.totals, [3, 3, 6], 'une valeur négative n\'empile rien')
    assert.deepEqual(stack.scale, C.niceScale(0, 6, 4, true))
    assert.deepEqual(stack.segments.map((s: any) => [s.i, s.key, s.base, s.value]), [[0, 'a', 0, 1], [0, 'b', 1, 2], [1, 'a', 0, 3], [2, 'a', 0, 2], [2, 'b', 2, 4]])
    const top = stack.segments[4]
    near(top.top, 0, 'le plus haut total touche le haut de l\'échelle')
    near(top.height, 4 / 6)
    near(stack.segments[1].top + stack.segments[1].height, stack.segments[0].top, 'le segment suivant se pose sur le précédent')
    assert.deepEqual(stack.fractions, [1 / 6, 0.5, 5 / 6])
    assert.ok(stack.segments.every((s: any) => s.left >= 0 && s.left + s.width <= 1))
    assert.deepEqual(C.stackModel(table, { kind: 'category', hidden: ['b'] }).totals, [1, 3, 2], 'une série masquée sort du total')
    assert.equal(C.stackModel(table, { kind: 'category', bounds: { max: 10 } }).scale.max, 10)
    assert.deepEqual(C.stackModel(C.fromRows([{ x: 'a', readings: { s: 2 } }], [{ key: 's' }]), {}).segments.length, 1, 'depuis des lignes, par l\'adaptateur')
  })

  it('la grille jour × heure : lundi en première ligne, l\'heure locale, le compte, la somme ou la moyenne', () => {
    const points = [
      { x: new Date(2026, 9, 19, 8, 15).toISOString(), y: 2 },
      { x: new Date(2026, 9, 19, 8, 50).toISOString(), y: 4 },
      { x: '2026-10-25T23:30:00+01:00', y: 5 },
      { x: 'oups', y: 1 },
      { x: new Date(2026, 9, 21, 13, 0).toISOString(), y: 'mot' }
    ]
    const counts = C.weekHours(points)
    assert.equal(counts.length, 7)
    assert.ok(counts.every((row: number[]) => row.length === 24))
    assert.equal(counts[0][8], 2, 'deux points le lundi entre 8 h et 9 h')
    assert.equal(counts[6][23], 1, 'dimanche 23 h 30, le jour du retour à l\'heure d\'hiver')
    assert.equal(counts[2][13], 1, 'compter ne lit pas la valeur')
    assert.equal(counts.flat().reduce((a: number, b: number) => a + b, 0), 4, 'une date illisible ne compte pas')
    assert.equal(C.weekHours(points, 'sum')[0][8], 6)
    assert.equal(C.weekHours(points, 'mean')[0][8], 3)
    assert.equal(C.weekHours(points, 'mean')[2][13], null, 'une moyenne sans valeur reste vide')
  })

  it('une grille en cases d\'intensité : cinq niveaux aux graduations rondes, la graduation la plus proche, la case vide à part, la case la plus haute', () => {
    const heat = C.heatModel([[0, 3, 10], [null, 7, 1]])
    assert.deepEqual(heat.scale.ticks, [0, 2.5, 5, 7.5, 10])
    assert.deepEqual(heat.cells.map((c: any) => c.level), [1, 2, 5, 0, 4, 1], 'seule la case vide est au niveau 0 ; une valeur nulle est au premier niveau ; 3 est plus près de 2,5 que de 5')
    assert.deepEqual([heat.rows, heat.cols], [2, 3])
    assert.deepEqual(heat.peak, { row: 0, col: 2, value: 10 })
    assert.equal(heat.cells[1].share, 0.3)
    assert.equal(C.heatModel([[1, 2], [3, 4]], { classes: 2 }).scale.ticks.length, 3, 'le nombre de classes se règle')
    assert.equal(C.heatModel([[null, null]]).peak, null, 'tout est vide : pas de sommet')
    assert.deepEqual(C.heatModel([[2, 4.6]], { bounds: { min: 1, max: 5 } }).cells.map((c: any) => c.level), [2, 5], 'des bornes de 1 à 5 : l\'arrondi')
    const week = C.heatModel(C.weekHours([{ x: new Date(2026, 9, 20, 9).toISOString() }]))
    assert.equal(week.cells.length, 7 * 24)
    assert.deepEqual(week.peak, { row: 1, col: 9, value: 1 }, 'mardi, 9 h')
  })

  it('l\'échelle des niveaux : cinq graduations rondes, la plus haute juste au-dessus de la plus grande valeur, des bornes qu\'une valeur élargit', () => {
    assert.deepEqual(C.levelScale([1, 2.5, 2.8]).ticks, [1, 1.5, 2, 2.5, 3])
    assert.deepEqual(C.levelScale([2, 5]).ticks, [1, 2, 3, 4, 5], 'la plus grande valeur atteint le cinquième niveau')
    assert.deepEqual(C.levelScale([1, 12]).ticks, [0, 3, 6, 9, 12])
    assert.deepEqual(C.levelScale([2, 3], { min: 1, max: 5 }).ticks, [1, 2, 3, 4, 5])
    assert.deepEqual(C.levelScale([0, 7], { min: 1, max: 5 }).ticks, [0, 2, 4, 6, 8], 'une valeur hors des bornes les élargit')
    const humeur = C.levelScale([], { min: 1, max: 5 })
    assert.deepEqual([1, 2.5, 3.4, 4.6, 5, 9].map((v) => C.level(v, humeur)), [1, 3, 3, 5, 5, 5], 'une humeur de 1 à 5 : son arrondi')
    assert.equal(C.level(null, humeur), 0, 'sans valeur : niveau 0')
    assert.equal(C.level(3, C.levelScale([3, 3])), 3, 'des valeurs toutes égales tombent au milieu')
    assert.equal(C.levelScale([]), null)
    assert.equal(C.level(3, null), 0)
  })

  it('un radar : un axe par colonne depuis le haut dans le sens des aiguilles, une échelle commune, un polygone par série', () => {
    const table = C.fromRows([{ x: 'Force', readings: { a: 100, b: 20 } }, { x: 'Souplesse', readings: { a: 50, b: 40 } }, { x: 'Endurance', readings: { b: 60 } }, { x: 'Vitesse', readings: { a: 25, b: 80 } }], [{ key: 'a', color: 'gold' }, { key: 'b', color: 'blue' }, { key: 'm', kind: 'text' }])
    const radar = C.radarModel(table, { bounds: { min: 0, max: 100 } })
    assert.deepEqual(radar.scale.ticks, [0, 25, 50, 75, 100])
    assert.deepEqual(radar.rings.map((r: any) => r.value), [25, 50, 75, 100], 'un anneau par graduation, sans le centre')
    assert.deepEqual(radar.axes.map((a: any) => [Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100, a.label.anchor]), [[50, 16, 'middle'], [84, 50, 'start'], [50, 84, 'middle'], [16, 50, 'end']])
    assert.equal(radar.shapes[0].points, '50.00,16.00 67.00,50.00 50.00,50.00 41.50,50.00', 'une valeur absente revient au centre')
    assert.deepEqual(radar.shapes.map((s: any) => s.key), ['a', 'b'], 'une série de mots n\'a pas de polygone')
    assert.equal(radar.rings[3].points, '50.00,16.00 84.00,50.00 50.00,84.00 16.00,50.00')
    assert.deepEqual(C.radarModel(table).scale, C.niceScale(0, 100, 4, true), 'sans bornes : de 0 à la plus grande valeur')
    const small = C.radarModel(table, { cx: 100, cy: 100, radius: 80, hidden: ['a'] })
    assert.deepEqual(small.shapes.map((s: any) => s.key), ['b'])
    assert.equal(Math.round(small.axes[0].y), 20, 'le centre et le rayon se règlent')
    assert.deepEqual(C.radarModel(C.tableOf([], 'category')).shapes, [])
  })

  it('un calendrier par jour : des semaines en colonnes du lundi au dimanche, la moyenne du jour, son niveau, les jours à venir', () => {
    const points = [{ x: '2026-10-06', y: 2 }, { x: '2026-10-06', y: 3 }, { x: '2026-10-20', y: 4.6 }, { x: '2026-10-14', y: 'mot' }, { x: '2026-09-01', y: 1 }]
    const cal = C.calendarModel(points, { today: '2026-10-21', columns: 3, bounds: { min: 1, max: 5 } })
    assert.equal(cal.cells.length, 21)
    assert.deepEqual([cal.cells[0].from, cal.cells[20].from], ['2026-10-05', '2026-10-25'], 'du lundi d\'il y a deux semaines au dimanche de cette semaine')
    assert.deepEqual(cal.scale.ticks, [1, 2, 3, 4, 5])
    const tuesday = cal.cells[1]
    assert.deepEqual([tuesday.col, tuesday.row, tuesday.count, tuesday.value, tuesday.level], [0, 1, 2, 2.5, 3], 'mardi 6 : moyenne 2,5, niveau 3 comme son arrondi')
    assert.deepEqual([cal.cells[15].from, cal.cells[15].level], ['2026-10-20', 5])
    assert.deepEqual(cal.cells.filter((c: any) => c.future).map((c: any) => c.from), ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    assert.equal(cal.cells[9].level, 0, 'un jour sans valeur (le mot ne compte pas) : niveau 0')
    assert.deepEqual(C.calendarModel(points, { today: '2026-10-21', columns: 6 }).months, [{ col: 0, month: '2026-09-01' }, { col: 3, month: '2026-10-01' }], 'les colonnes où un mois commence')
    assert.deepEqual(C.calendarModel(points, { today: '2026-10-07', columns: 2 }).months, [{ col: 1, month: '2026-10-01' }], 'la première tête tombe quand la deuxième la suit aussitôt')
    assert.equal(C.calendarModel(points, { columns: 1 }).cells[1].from, '2026-10-20', 'sans `today` : la semaine du dernier point')
    assert.deepEqual(C.calendarModel([], {}), { step: 'day', scale: null, cells: [], months: [] })
  })

  it('un calendrier par semaine ou par mois : les dernières périodes jusqu\'à aujourd\'hui, la moyenne, la somme ou le compte', () => {
    const points = [{ x: '2026-10-06', y: 2 }, { x: '2026-10-08', y: 4 }, { x: '2026-10-20', y: 5 }, { x: '2026-09-15', y: 1 }]
    const weeks = C.calendarModel(points, { step: 'week', size: 3, today: '2026-10-21' })
    assert.deepEqual(weeks.cells.map((c: any) => [c.from, c.to, c.value, c.count]), [['2026-10-05', '2026-10-11', 3, 2], ['2026-10-12', '2026-10-18', null, 0], ['2026-10-19', '2026-10-25', 5, 1]])
    const months = C.calendarModel(points, { step: 'month', size: 2, today: '2026-10-21', measure: 'sum' })
    assert.deepEqual(months.cells.map((c: any) => [c.from, c.to, c.value]), [['2026-09-01', '2026-09-30', 1], ['2026-10-01', '2026-10-31', 11]])
    const counts = C.calendarModel(points.concat([{ x: '2026-10-07', y: null } as any]), { step: 'week', size: 3, today: '2026-10-21', measure: 'count' })
    assert.deepEqual(counts.cells.map((c: any) => c.value), [3, null, 1], 'compter : chaque point daté, même sans valeur')
    assert.ok(counts.cells.every((c: any) => c.level >= 0 && c.future === false))
    assert.deepEqual(C.calendarModel(points, { step: 'week', size: 6, today: '2026-10-21' }).months, [{ col: 0, month: '2026-09-01' }, { col: 3, month: '2026-10-01' }], 'par semaine aussi, les colonnes où un mois commence')
    assert.deepEqual(C.calendarModel(points, { step: 'month', size: 2, today: '2026-10-21' }).months, [], 'par mois : chaque case est un mois')
    const instants = C.calendarModel([{ x: '2026-10-25T00:30:00+02:00', y: 3 }], { kind: 'datetime', step: 'day', columns: 1 })
    assert.equal(instants.cells[6].value, 3, 'un instant se range au jour de l\'heure locale')
  })

  it('les jours de la semaine s\'écrivent dans la langue donnée, lundi en premier ; les points d\'une série se tirent des lignes', () => {
    assert.equal(C.formatWeekday(0, 'fr'), 'lun.')
    assert.equal(C.formatWeekday(6, 'en', 'long'), 'Sunday')
    assert.equal(C.formatWeekday(2, 'en', 'short'), 'Wed')
    assert.deepEqual([C.formatHour(8, 'fr'), C.formatHour(21, 'en')], ['08 h', '9 PM'], 'une heure du jour')
    assert.equal(C.formatDay('2026-10-05', 'fr', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), 'lundi 5 octobre 2026')
    assert.equal(C.formatDay('2026-09-01', 'en', { month: 'short' }), 'Sep')
    const rows = [{ x: '2026-10-01', readings: { a: 3, m: 'bien' } }, { x: '2026-10-02', readings: { a: '' } }, { x: '2026-10-03', readings: {} }]
    assert.deepEqual(C.pointsOf(rows, 'a').map((p: any) => [p.x, p.y]), [['2026-10-01', 3]])
    assert.deepEqual(C.pointsOf(rows, 'm', true).map((p: any) => p.y), ['bien'])
    assert.equal(C.pointsOf(rows, 'a')[0].row, rows[0])
  })
})
