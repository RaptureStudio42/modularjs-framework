// les petites valeurs et la lecture des nombres dans les calculs des graphiques (src/runtime/mjs_chart.ts) : des graduations distinctes et
// lisibles à toute grandeur (du milliardième au billion), sans graduation en double (elles servent de clés au rendu), une bulle et des
// classes qui gardent leurs chiffres significatifs, des moyennes par période qui ne tombent pas à zéro, des statistiques qui gardent
// l'arrondi du serveur, et des mesures écrites en texte lues comme les lit le serveur (Float de Ruby). Le fichier runtime est chargé brut
// (`new Function`, objet µ nu) : il ne touche jamais au DOM

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url)), 'utf-8')
const µ: any = {}
new Function('µ', SOURCE)(µ)
const C = µ._mjs_chart

const near = (got: number, want: number, message?: string) => assert.ok(Math.abs(got - want) < 1e-9, (message || 'écart') + ' : ' + got + ' au lieu de ' + want)

// les espaces d'Intl (insécable, fine) ramenées à une espace simple : les attentes restent lisibles
const plain = (text: string) => text.replace(/\s/gu, ' ')

const lowest = (values: number[]) => values.reduce((a, b) => Math.min(a, b))
const highest = (values: number[]) => values.reduce((a, b) => Math.max(a, b))

// une échelle bien formée : des graduations finies, strictement croissantes (donc distinctes), qui couvrent les valeurs (à un milliardième de
// l'étendue près : la tolérance qui absorbe la poussière des flottants), en nombre raisonnable
const wellFormed = (scale: any, values: number[], label: string) => {
  assert.ok(scale.ticks.length >= 2 && scale.ticks.length <= 12, label + ' : ' + scale.ticks.length + ' graduations')
  scale.ticks.forEach((t: number, i: number) => {
    assert.ok(Number.isFinite(t), label + ' : graduation ' + t)
    if (i) assert.ok(t > scale.ticks[i - 1], label + ' : ' + JSON.stringify(scale.ticks) + ' ne croît pas strictement')
  })
  assert.equal(scale.min, scale.ticks[0], label)
  assert.equal(scale.max, scale.ticks[scale.ticks.length - 1], label)
  const slack = (scale.max - scale.min) * 1e-9
  assert.ok(scale.min <= lowest(values) + slack && scale.max >= highest(values) - slack, label + ' : les valeurs sortent de ' + JSON.stringify(scale.ticks))
}

const GRANDEURS = [
  { nom: 'millièmes', valeurs: [0.001, 0.002, 0.003, 0.004] },
  { nom: 'dix-millièmes', valeurs: [0.0004, 0.0007, 0.0009] },
  { nom: 'cent-millièmes', valeurs: [3.2e-5, 3.5e-5, 4.1e-5] },
  { nom: 'dix-millionièmes', valeurs: [1e-7, 3e-7, 5e-7] },
  { nom: 'milliardièmes', valeurs: [1e-9, 2.5e-9, 4e-9] },
  { nom: 'négatives minuscules', valeurs: [-3e-7, -2e-7, -1e-7] },
  { nom: 'de part et d\'autre de zéro', valeurs: [-2e-9, 1e-9, 3e-9] },
  { nom: 'un écart d\'un millième autour de 1', valeurs: [1.001, 1.002, 1.004] },
  { nom: 'billions', valeurs: [1e12, 2e12, 3e12] },
  { nom: 'billions à l\'unité près', valeurs: [1e12, 1e12 + 2, 1e12 + 4] }
]

describe('graphiques : les petites valeurs, à toute grandeur', () => {
  it('les graduations sont distinctes, croissantes et couvrent les valeurs, du milliardième au billion, avec ou sans le zéro', () => {
    for (const g of GRANDEURS) {
      wellFormed(C.scaleOf(g.valeurs), g.valeurs, g.nom)
      wellFormed(C.scaleOf(g.valeurs, { zero: true }), g.valeurs.concat(0), g.nom + ', avec le zéro')
    }
  })

  it('les graduations s\'écrivent toutes différemment, en français comme en anglais', () => {
    for (const g of GRANDEURS) {
      for (const lang of ['fr', 'en']) {
        const texts = C.scaleOf(g.valeurs).ticks.map((t: number) => C.axisNumber(t, lang))
        assert.equal(new Set(texts).size, texts.length, g.nom + ' (' + lang + ') : ' + JSON.stringify(texts))
      }
    }
  })

  it('une graduation écrit ses chiffres : en décimales jusqu\'au dix-millième, en notation scientifique en deçà, en abrégé pour les grands nombres', () => {
    const axis = (values: number[], lang = 'fr') => C.scaleOf(values).ticks.map((t: number) => plain(C.axisNumber(t, lang)))
    assert.deepEqual(axis([0.001, 0.004]), ['0,001', '0,002', '0,003', '0,004'], 'de 0,001 à 0,004 : plus de « 0, 0, 0, 0 »')
    assert.deepEqual(axis([0.0004, 0.0008]), ['0,0004', '0,0005', '0,0006', '0,0007', '0,0008'])
    assert.deepEqual(axis([1e-7, 5e-7]), ['1E-7', '2E-7', '3E-7', '4E-7', '5E-7'])
    assert.deepEqual(axis([1e-7, 5e-7], 'en'), ['1E-7', '2E-7', '3E-7', '4E-7', '5E-7'])
    assert.deepEqual(axis([1.001, 1.004]), ['1,001', '1,002', '1,003', '1,004'], 'un écart d\'un millième autour de 1')
    assert.deepEqual(axis([1e12, 3e12]), ['1 Bn', '1,5 Bn', '2 Bn', '2,5 Bn', '3 Bn'])
    assert.deepEqual(axis([1e12, 3e12], 'en'), ['1T', '1.5T', '2T', '2.5T', '3T'])
    assert.equal(plain(C.axisNumber(1250000, 'fr')), '1,25 M', 'une graduation abrégée garde ses chiffres')
    assert.deepEqual(axis([0, 97]), ['0', '25', '50', '75', '100'], 'les grandeurs courantes ne changent pas')
    assert.deepEqual(axis([5, 9]), ['5', '6', '7', '8', '9'])
  })

  it('sous 0,1, la bulle garde trois chiffres significatifs ; au-delà, deux décimales comme avant (l\'écriture des statistiques ne change pas)', () => {
    const fr = (v: number) => plain(C.formatNumber(v, 'fr'))
    assert.equal(fr(0.004), '0,004', 'la bulle de 0,004 ne dit plus « 0 »')
    assert.equal(fr(0.0049), '0,0049')
    assert.equal(fr(0.0004), '0,0004')
    assert.equal(fr(0.0123456), '0,0123')
    assert.equal(fr(-0.004), '-0,004')
    assert.equal(fr(3.2e-5), '3,2E-5', 'en deçà du dix-millième : la notation scientifique, comme l\'axe')
    assert.equal(fr(-3.2e-5), '-3,2E-5')
    assert.equal(fr(1e-9), '1E-9')
    assert.equal(fr(1.23456e-7), '1,23E-7')
    assert.equal(plain(C.formatNumber(3.2e-5, 'en')), '3.2E-5')
    assert.equal(fr(72.456), '72,46', 'deux décimales au-delà de 0,1, comme avant')
    assert.equal(fr(0.125), '0,13')
    assert.equal(fr(0.5678), '0,57')
    assert.equal(fr(1e12), '1 000 000 000 000', 'un très grand nombre s\'écrit en entier dans la bulle')
    assert.equal(fr(0), '0')
  })

  it('les classes d\'un histogramme ont des bornes rondes et distinctes, qui s\'écrivent différemment au pas de la classe (des classes d\'un millième autour de 1 comprises)', () => {
    for (const g of GRANDEURS) {
      const bins = C.histogramBins(g.valeurs)
      assert.ok(bins.length >= 2, g.nom + ' : ' + JSON.stringify(bins))
      assert.equal(bins.reduce((sum: number, b: any) => sum + b.count, 0), g.valeurs.length, g.nom + ' : personne ne se perd')
      assert.ok(bins[0].from <= lowest(g.valeurs) && bins[bins.length - 1].to >= highest(g.valeurs), g.nom + ' : ' + JSON.stringify(bins))
      bins.forEach((b: any, i: number) => {
        assert.ok(b.to > b.from, g.nom + ' : une classe « de ' + b.from + ' à ' + b.to + ' »')
        if (i) assert.equal(b.from, bins[i - 1].to, g.nom + ' : les classes se suivent')
      })
      const texts = bins.map((b: any) => C.formatNumber(b.from, 'fr', b.to - b.from) + ' → ' + C.formatNumber(b.to, 'fr', b.to - b.from))
      assert.ok(bins.every((b: any) => C.formatNumber(b.from, 'fr', b.to - b.from) !== C.formatNumber(b.to, 'fr', b.to - b.from)), g.nom + ' : ' + JSON.stringify(texts))
      assert.equal(new Set(texts).size, texts.length, g.nom + ' : ' + JSON.stringify(texts))
    }
    assert.deepEqual(C.histogramBins([1e-7, 2e-7, 3e-7, 4e-7, 5e-7]).map((b: any) => [b.from, b.to]), [[1e-7, 2e-7], [2e-7, 3e-7], [3e-7, 4e-7], [4e-7, 5e-7]], 'des classes de 1E-7, plus « de 0 à 0 »')
    // le pas est facultatif : sans lui, l'écriture ne change pas ; avec lui, assez de décimales pour séparer deux bornes voisines, sans poussière
    assert.deepEqual([C.formatNumber(1.0025, 'fr'), C.formatNumber(1.0025, 'fr', 0.0025), C.formatNumber(1.001, 'fr', 1.002 - 1.001), C.formatNumber(1, 'fr', 0.001), C.formatNumber(62.5, 'fr', 2.5), C.formatNumber(1200, 'fr', 100)], ['1', '1,0025', '1,001', '1', '62,5', '1\u202f200'])
    assert.deepEqual([C.formatNumber(1.00002e-5, 'fr', 1e-10), C.formatNumber(1.00003e-5, 'fr', 1e-10)], ['1,00002E-5', '1,00003E-5'], 'en notation scientifique aussi')
  })

  it('l\'échelle des niveaux reste du côté des valeurs et les sépare, à toute grandeur', () => {
    const scale = C.levelScale([1e-7, 3e-7])
    assert.ok(scale.min >= 0, 'des valeurs positives ne font pas descendre l\'échelle sous zéro : ' + scale.min)
    assert.deepEqual(scale.ticks, [1e-7, 1.5e-7, 2e-7, 2.5e-7, 3e-7])
    assert.deepEqual([C.level(1e-7, scale), C.level(2e-7, scale), C.level(3e-7, scale)], [1, 3, 5])
    for (const g of GRANDEURS) {
      const s = C.levelScale(g.valeurs)
      assert.equal(s.ticks.length, 5, g.nom)
      s.ticks.forEach((t: number, i: number) => { if (i) assert.ok(t > s.ticks[i - 1], g.nom + ' : ' + JSON.stringify(s.ticks)) })
      assert.ok(s.step > 0 && s.min <= lowest(g.valeurs) && s.max >= highest(g.valeurs), g.nom + ' : ' + JSON.stringify(s))
      if (lowest(g.valeurs) >= 0) assert.ok(s.min >= 0, g.nom + ' : ' + JSON.stringify(s.ticks))
      if (highest(g.valeurs) <= 0) assert.ok(s.max <= 0, g.nom + ' : ' + JSON.stringify(s.ticks))
      assert.ok(C.level(lowest(g.valeurs), s) < C.level(highest(g.valeurs), s), g.nom + ' : la plus petite et la plus grande valeur au même niveau')
    }
  })

  it('aucune graduation en double : ni sur l\'axe d\'une courbe ou de barres, ni dans les anneaux d\'un radar', () => {
    const rows = [{ x: 'a', readings: { v: 1e-7 } }, { x: 'b', readings: { v: 3e-7 } }, { x: 'c', readings: { v: 5e-7 } }]
    const table = C.fromRows(rows, [{ key: 'v' }])
    const line = C.plotModel(table, { kind: 'category', shape: 'line' })
    assert.equal(new Set(line.scale.ticks).size, line.scale.ticks.length, JSON.stringify(line.scale.ticks))
    line.lines[0].points.map((p: any) => p.y).forEach((y: number, i: number) => near(y, [1, 0.5, 0][i], 'les points occupent toute la hauteur'))
    const bars = C.plotModel(table, { kind: 'category', shape: 'bar' })
    assert.equal(new Set(bars.scale.ticks).size, bars.scale.ticks.length, JSON.stringify(bars.scale.ticks))
    const rings = C.radarModel(C.fromRows(rows, [{ key: 'v' }])).rings.map((r: any) => r.value)
    assert.ok(rings.length >= 2 && new Set(rings).size === rings.length, JSON.stringify(rings))
  })

  it('deux valeurs qui ne diffèrent que par la poussière des flottants : une échelle plate et bornée, jamais une boucle sans fin', () => {
    for (const pair of [[0.3, 0.1 + 0.2], [1, 1 + Number.EPSILON], [1e-7, 1e-7 * (1 + 4 * Number.EPSILON)], [1e12, 1e12 + 0.0001]]) {
      wellFormed(C.scaleOf(pair), pair, JSON.stringify(pair))
      assert.equal(C.histogramBins(pair).length, 1, JSON.stringify(pair) + ' : une seule classe')
      assert.equal(C.levelScale(pair).ticks.length, 5, JSON.stringify(pair))
      assert.equal(C.level(pair[0], C.levelScale(pair)), C.level(pair[1], C.levelScale(pair)), JSON.stringify(pair) + ' : un même niveau')
    }
  })

  it('une moyenne par période garde les chiffres des petites valeurs, sans la poussière des flottants', () => {
    const rows = [{ x: '2026-10-05', readings: { v: 1e-7 } }, { x: '2026-10-06', readings: { v: 3e-7 } }]
    assert.equal(C.groupRows(rows, [{ key: 'v' }], 'date', 'week').rows[0].readings.v, 2e-7, 'la semaine de 1E-7 et 3E-7 ne vaut pas 0')
    const series = [{ key: 'v', points: [{ x: '2026-10-05', y: 1e-7 }, { x: '2026-10-06', y: 3e-7 }] }]
    assert.equal(C.groupPoints(series, 'date', 'week').series[0].points[0].y, 2e-7)
    const nine = (minutes: number) => new Date(2026, 9, 19, 9, minutes).toISOString()
    assert.equal(C.weekHours([{ x: nine(0), y: 1e-7 }, { x: nine(30), y: 3e-7 }], 'mean')[0][9], 2e-7, 'la case du lundi 9 h')
    const cal = C.calendarModel([{ x: '2026-10-19', y: 1e-7 }, { x: '2026-10-19', y: 3e-7 }], { today: '2026-10-19', columns: 1 })
    assert.equal(cal.cells[0].value, 2e-7, 'la case du lundi 19 octobre')
    const dust = [{ x: '2026-10-05', readings: { v: 0.1 } }, { x: '2026-10-06', readings: { v: 0.2 } }]
    assert.equal(C.groupRows(dust, [{ key: 'v' }], 'date', 'week').rows[0].readings.v, 0.15, '(0,1 + 0,2) / 2 vaut 0,15, pas 0,15000000000000002')
  })

  it('les statistiques gardent l\'arrondi du serveur : deux décimales, la moitié loin de zéro, même pour de petites valeurs', () => {
    const pick = (s: any) => ({ n: s.n, median: s.median, q1: s.q1, q3: s.q3 })
    assert.deepEqual(pick(C.stats([1.005, 1.015, 2.675, 0.125], 2)), { n: 4, median: 1.01, q1: 0.56, q3: 1.84 }, 'les valeurs du serveur pour cette série')
    assert.deepEqual(pick(C.stats([1, 1.01], 2)), { n: 2, median: 1, q1: 1, q3: 1.01 })
    const tiny = C.stats([1e-7, 3e-7], 2)
    assert.deepEqual([tiny.n, tiny.sum, tiny.mean, tiny.median, tiny.deviation], [2, 0, 0, 0, 0], 'le serveur arrondit aussi les petites valeurs à deux décimales')
    near(C.stats([1e-7, 3e-7]).mean, 2e-7, 'sans arrondi demandé, la valeur exacte')
  })
})

// la lecture de Float() de Ruby 3.4 (la méthode du serveur lit chaque mesure par `Float(v) rescue nil`), relevée telle quelle pour chaque texte
const RUBY: [string, number | null][] = [
  ['0b101', null], ['0B101', null], ['0o17', null], ['0O17', null], ['1_000', 1000], ['-1_000', -1000], ['1_000.5', 1000.5], ['1.0_5', 1.05],
  ['1_000e3', 1000000], ['1e1_0', 10000000000], [' 1_0 ', 10], ['0_17', 17], ['1__000', null], ['_1000', null], ['1000_', null], ['1._5', null],
  ['1_.5', null], ['1_e3', null], ['1e_10', null], ['0x1A', 26], ['0X1a', 26], ['-0x1A', -26], ['+0x1A', 26], [' 0x1A ', 26], ['0x1_0', 16],
  ['0x_10', null], ['0x10_', null], ['0x1.8p1', 3], ['0x1p3', 8], ['0x1P-2', 0.25], ['0x.8', 0.5], ['0x1.8', 1.5], ['0x1A.5', 26.3125],
  ['0x1p1_0', 1024], ['0x', null], ['0xp1', null], ['0x1p', null], ['0xg', null], ['0x-1', null], ['1e3', 1000], ['1E3', 1000], ['1e-3', 0.001],
  ['1e', null], ['e3', null], ['1e3.5', null], [' 12 ', 12], ['\t8\n', 8], ['\u000b8', 8], ['\f8', 8], ['\r8\r', 8], [' 8', null],
  ['8 ', null], [' 8', null], ['﻿8', null], ['1,5', null], ['1 000', null], ['Infinity', null], ['-Infinity', null],
  ['inf', null], ['NaN', null], ['', null], [' ', null], ['+5', 5], ['-5', -5], ['+-5', null], ['--5', null], ['+', null], ['-', null],
  ['.', null], ['.5', 0.5], ['-.5', -0.5], ['+.5', 0.5], ['.5e1', 5], ['5.', 5], ['-5.', -5], ['5.e3', 5000], ['5. ', 5], ['017', 17],
  ['0017.5', 17.5], ['12abc', null], ['abc', null], ['1.5.3', null], ['1e-400', 0], ['0.1', 0.1], ['٣', null], ['１２', null],
  ['12\u0000', null], ['true', null], ['null', null]
]

describe('graphiques : une mesure écrite en texte se lit comme la lit le serveur', () => {
  it('chaque texte donne le nombre de Float() de Ruby, ou rien quand Ruby le refuse', () => {
    for (const [text, want] of RUBY) assert.equal(C.number(text), want, JSON.stringify(text))
  })

  it('les trois écritures qui s\'écartaient : binaire et octal refusés, souligné entre deux chiffres accepté', () => {
    assert.equal(C.number('0b101'), null)
    assert.equal(C.number('0o17'), null)
    assert.equal(C.number('1_000'), 1000)
  })

  it('les statistiques comptent les mêmes mesures que le serveur', () => {
    const pick = (s: any) => ({ n: s.n, median: s.median, max: s.max })
    assert.deepEqual(pick(C.stats(['1_000', 5, 6], 2)), { n: 3, median: 6, max: 1000 })
    assert.deepEqual(pick(C.stats(['0b101', 1, 2], 2)), { n: 2, median: 1.5, max: 2 })
    assert.deepEqual(pick(C.stats(['0o17', 1, 2], 2)), { n: 2, median: 1.5, max: 2 })
  })

  it('un nombre fini passe tel quel ; l\'infini, un texte qui dépasse les flottants et tout le reste sont écartés', () => {
    assert.equal(C.number(5), 5)
    assert.equal(C.number(-0.5), -0.5)
    assert.equal(C.number(Infinity), null)
    assert.equal(C.number(NaN), null)
    assert.equal(C.number('1e400'), null, 'le serveur lit l\'infini puis échoue ; le graphique l\'écarte')
    assert.equal(C.number('0x1p1024'), null)
    for (const other of [true, false, null, undefined, [1], { v: 1 }]) assert.equal(C.number(other), null, JSON.stringify(other))
  })
})
