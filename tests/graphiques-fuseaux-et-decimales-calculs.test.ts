// les calculs des graphiques (src/runtime/mjs_chart.ts) pour les deux réglages de <@@chart> : l'heure affichée (`timezone`) et le nombre de
// chiffres après la virgule (`decimals`). Une heure est ramenée une fois à l'heure qu'elle affiche (`wallTime` : telle qu'écrite, son fuseau
// ignoré, ou dans une zone IANA), puis lue en UTC partout où une heure compte (écriture, jour, semaine, grille jour × heure, calendrier) :
// le même résultat quel que soit le fuseau du processus. `decimals` écrit chaque mesure avec exactement N chiffres après la virgule et
// espace les graduations et les classes d'au moins 10^-N, toujours d'un pas qui s'écrit en N chiffres. Le fichier runtime est chargé brut
// (`new Function`, objet µ nu)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url)), 'utf-8')
const µ: any = {}
new Function('µ', SOURCE)(µ)
const C = µ._mjs_chart

const fixe = (lang: string, n: number, d: number) => new Intl.NumberFormat(lang, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)

describe('graphiques : l\'heure affichée et les chiffres après la virgule, sans DOM', () => {
  it('une heure telle qu\'écrite : son fuseau est ignoré, sans conversion', () => {
    assert.equal(C.wallTime('2026-10-19T08:15:00Z', ''), '2026-10-19T08:15:00.000Z')
    assert.equal(C.wallTime('2026-10-19T23:30:00+02:00', ''), '2026-10-19T23:30:00.000Z')
    assert.equal(C.wallTime('2026-10-20T15:45-0700', ''), '2026-10-20T15:45:00.000Z')
    assert.equal(C.wallTime('2026-10-19 08:15', ''), '2026-10-19T08:15:00.000Z', 'un blanc entre le jour et l\'heure')
    assert.equal(C.wallTime('2026-10-19T08:15:30.5Z', ''), '2026-10-19T08:15:30.500Z', 'les fractions de seconde')
    assert.equal(C.wallTime('Oct 19 2026 08:15', ''), 'Oct 19 2026 08:15', 'ni ISO 8601, ni Time#to_s, ni RFC 2822 : pas une heure, elle reste telle quelle')
    assert.equal(C.wallTime('pas une heure', ''), 'pas une heure', 'ce qui ne se lit pas reste tel quel')
    assert.equal(C.wallTime('2026-13-40T08:15:00Z', ''), '2026-13-40T08:15:00Z', 'un mois ou un jour impossible reste tel quel')
  })

  it('une heure dans une zone IANA : l\'instant écrit, ramené à l\'heure de la zone ; sans fuseau écrit, l\'heure est déjà celle de la zone', () => {
    assert.equal(C.wallTime('2026-10-19T08:15:00Z', 'Europe/Paris'), '2026-10-19T10:15:00.000Z', 'heure d\'été, UTC+2')
    assert.equal(C.wallTime('2026-10-20T15:45:00-07:00', 'Europe/Paris'), '2026-10-21T00:45:00.000Z', 'le lendemain à Paris')
    assert.equal(C.wallTime('2026-10-19T23:30:00+02:00', 'Asia/Tokyo'), '2026-10-20T06:30:00.000Z')
    assert.equal(C.wallTime('2026-10-25T01:30:00Z', 'Europe/Paris'), '2026-10-25T02:30:00.000Z', 'après le retour à l\'heure d\'hiver, UTC+1')
    assert.equal(C.wallTime('2026-10-19T08:15', 'Europe/Paris'), '2026-10-19T08:15:00.000Z', 'sans fuseau écrit : l\'heure de la zone')
    assert.equal(C.wallTime('2026-10-19T08:15:00Z', 'UTC'), '2026-10-19T08:15:00.000Z')
  })

  it('lue en UTC : l\'heure écrite, son jour, sa semaine, sa case jour × heure et son calendrier ne dépendent plus du fuseau du processus', () => {
    const tard = '2026-10-19T23:30:00.000Z'
    assert.match(C.formatX('datetime', tard, 'fr', false, true), /19.*23:30/)
    assert.match(C.formatX('datetime', tard, 'en', true, true), /11:30\s?PM/)
    assert.equal(C.periodStart('datetime', tard, 'day', true), '2026-10-19')
    assert.equal(C.periodStart('datetime', '2026-10-25T23:30:00.000Z', 'week', true), '2026-10-19', 'dimanche 25 : la semaine du lundi 19')
    const grille = C.weekHours([{ x: tard, y: 4 }, { x: '2026-10-20T00:10:00.000Z', y: 2 }], 'mean', true)
    assert.equal(grille[0][23], 4, 'lundi 23 h')
    assert.equal(grille[1][0], 2, 'mardi 0 h')
    const lignes = [{ id: 'a', x: tard, readings: { v: 1 } }, { id: 'b', x: '2026-10-19T00:05:00.000Z', readings: { v: 3 } }, { id: 'c', x: '2026-10-20T00:05:00.000Z', readings: { v: 5 } }]
    assert.deepEqual(C.groupRows(lignes, [{ key: 'v' }], 'datetime', 'day', true).rows.map((r: any) => [r.x, r.count, r.readings.v]), [['2026-10-19', 2, 2], ['2026-10-20', 1, 5]])
    const jours = C.calendarModel([{ x: tard, y: 3 }, { x: '2026-10-20T00:05:00.000Z', y: 1 }], { kind: 'datetime', step: 'day', columns: 1, utc: true })
    assert.deepEqual(jours.cells.filter((c: any) => c.count).map((c: any) => c.from), ['2026-10-19', '2026-10-20'])
  })

  it('decimals : chaque mesure avec exactement N chiffres après la virgule ; sans decimals, l\'écriture automatique ne change pas', () => {
    assert.equal(C.formatNumber(2.5, 'fr', undefined, 2), fixe('fr', 2.5, 2))
    assert.equal(C.formatNumber(1234.5, 'fr', undefined, 0), fixe('fr', 1234.5, 0))
    assert.equal(C.formatNumber(0.00003, 'en', undefined, 2), '0.00', 'pas de notation scientifique')
    assert.equal(C.formatNumber(3, 'en', 0.001, 1), '3.0', 'decimals l\'emporte sur le pas des classes')
    assert.equal(C.formatNumber(null, 'fr', undefined, 2), '—')
    assert.equal(C.formatNumber(2.5, 'en'), '2.5', 'sans decimals')
    assert.equal(C.axisNumber(12000, 'en', 1), '12,000.0', 'une graduation écrite en entier, sans abréviation')
    assert.equal(C.axisNumber(12000, 'en'), '12K', 'sans decimals, l\'abréviation reste')
    assert.deepEqual(C.statsText({ mean: 2, median: 2.25, q1: 1, q3: 3, min: 1, max: 3.5, deviation: 0.5 }, 'en', 1), { mean: '2.0', median: '2.3', q1: '1.0', q3: '3.0', range: '1.0 – 3.5', deviation: '0.5', next: '—', slope: '—' })
  })

  it('decimals : les graduations et les classes s\'espacent d\'au moins 10^-N, d\'un pas qui s\'écrit en N chiffres', () => {
    assert.deepEqual(C.niceScale(0, 1.4, 4, false, 0).ticks, [0, 1, 2], 'decimals="0" : des graduations entières')
    assert.deepEqual(C.niceScale(0, 1, 4, false, 1).ticks, [0, 0.5, 1], 'un pas de 0,25 s\'écrirait 0,3 : 0,5')
    assert.deepEqual(C.niceScale(0, 1, 4, false, 2).ticks, [0, 0.25, 0.5, 0.75, 1])
    assert.deepEqual(C.niceScale(0, 1, 4, false).ticks, [0, 0.25, 0.5, 0.75, 1], 'sans decimals')
    assert.deepEqual(C.scaleOf([0.001, 0.003], { places: 2 }).ticks, [0, 0.01])
    for (const d of [0, 1, 2, 3]) {
      const ticks = C.niceScale(0.12, 0.13, 4, false, d).ticks
      const texts = ticks.map((t: number) => C.axisNumber(t, 'en', d))
      assert.equal(new Set(texts).size, texts.length, `decimals="${d}" : ${texts.join(' ')}`)
    }
    const modele = C.plotModel(C.fromRows([{ x: 'a', readings: { v: 0.2 } }, { x: 'b', readings: { v: 1.4 } }], [{ key: 'v' }]), { kind: 'category', shape: 'line', places: 0 })
    assert.deepEqual(modele.scale.ticks, [0, 1, 2])
    const pile = C.stackModel(C.fromRows([{ x: 'a', readings: { v: 0.2, w: 0.3 } }], [{ key: 'v' }, { key: 'w' }]), { kind: 'category', places: 0 })
    assert.deepEqual(pile.scale.ticks, [0, 1])
    const classes = C.histogramBins([1.02, 1.07, 1.31, 1.48, 1.52, 1.9, 2.05, 2.4], undefined, 0)
    assert.deepEqual(classes.map((b: any) => [b.from, b.to, b.count]), [[1, 2, 6], [2, 3, 2]], 'des classes d\'une unité au moins')
    assert.deepEqual(C.histogramBins([1.02, 1.07, 1.31, 1.48], undefined, 1).map((b: any) => b.to - b.from).every((w: number) => Math.abs(w - 0.5) < 1e-9 || Math.abs(w - 0.1) < 1e-9 || Math.abs(w - 0.2) < 1e-9), true)
  })
})
