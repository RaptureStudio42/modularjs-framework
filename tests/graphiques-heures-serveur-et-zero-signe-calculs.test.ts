// les calculs des graphiques (src/runtime/mjs_chart.ts) : la lecture des heures qu'écrit un serveur, et le zéro des décimales. Une heure
// se lit sans Date.parse, dont le résultat change d'un moteur à l'autre (WebKit ne lit ni « 2026-10-19 08:15:00 UTC » ni « … +0200 ») :
// ISO 8601 (avec ou sans fuseau, un « T » ou un blanc), Time#to_s de Ruby et de Rails (« 2026-10-19 08:15:00 UTC », « 2026-10-19 10:15:00
// +0200 ») et RFC 2822 (« Mon, 19 Oct 2026 08:15:00 GMT ») donnent la même heure, quel que soit le fuseau du processus : chaque calcul tourne
// dans un processus réglé sur Tokyo, puis dans un autre réglé sur Los Angeles. Une autre écriture n'est pas une heure : elle reste telle
// quelle. Avec `decimals`, une petite valeur négative s'écrit 0 (« 0,00 »), jamais « -0 »

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const FICHIER = fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url))
const µ: any = {}
new Function('µ', readFileSync(FICHIER, 'utf-8'))(µ)
const C = µ._mjs_chart

// pour chaque texte : l'heure affichée sans timezone, l'heure affichée à Paris, l'instant (null : pas une heure), l'écriture à l'heure locale
const CALCUL = `
const µ = {}
new Function('µ', require('node:fs').readFileSync(process.argv[1], 'utf-8'))(µ)
const C = µ._mjs_chart
const iso = (n) => n === null ? null : new Date(n).toISOString()
console.log(JSON.stringify(JSON.parse(process.argv[2]).map((t) => ({ mur: C.wallTime(t, ''), paris: C.wallTime(t, 'Europe/Paris'), instant: iso(C.parseX('datetime', t)), local: C.formatX('datetime', t, 'fr', false, false) }))))
`

function calculer(zone: string, textes: string[]): any[] {
  const fait = spawnSync(process.execPath, ['-e', CALCUL, FICHIER, JSON.stringify(textes)], { env: { ...process.env, TZ: zone }, encoding: 'utf-8' })
  assert.equal(fait.status, 0, fait.stderr)
  return JSON.parse(fait.stdout)
}

// [ texte, l'heure écrite, l'heure de Paris, l'instant ]
const HEURES: [string, string, string, string][] = [
  ['2026-10-19 08:15:00 UTC', '2026-10-19T08:15:00.000Z', '2026-10-19T10:15:00.000Z', '2026-10-19T08:15:00.000Z'],
  ['2026-10-19 10:15:00 +0200', '2026-10-19T10:15:00.000Z', '2026-10-19T10:15:00.000Z', '2026-10-19T08:15:00.000Z'],
  ['2026-10-19 08:15:00.123456789 +0200', '2026-10-19T08:15:00.123Z', '2026-10-19T08:15:00.123Z', '2026-10-19T06:15:00.123Z'],
  ['2026-10-19 08:15:00 utc', '2026-10-19T08:15:00.000Z', '2026-10-19T10:15:00.000Z', '2026-10-19T08:15:00.000Z'],
  ['Mon, 19 Oct 2026 08:15:00 GMT', '2026-10-19T08:15:00.000Z', '2026-10-19T10:15:00.000Z', '2026-10-19T08:15:00.000Z'],
  ['Mon, 19 Oct 2026 10:15:00 +0200', '2026-10-19T10:15:00.000Z', '2026-10-19T10:15:00.000Z', '2026-10-19T08:15:00.000Z'],
  ['19 Oct 2026 08:15 +0000', '2026-10-19T08:15:00.000Z', '2026-10-19T10:15:00.000Z', '2026-10-19T08:15:00.000Z'],
  ['Tue, 20 Oct 2026 22:45:00 GMT', '2026-10-20T22:45:00.000Z', '2026-10-21T00:45:00.000Z', '2026-10-20T22:45:00.000Z'],
  ['2026-10-19T08:15:00Z', '2026-10-19T08:15:00.000Z', '2026-10-19T10:15:00.000Z', '2026-10-19T08:15:00.000Z'],
  ['2026-10-19T10:15:00.250+02:00', '2026-10-19T10:15:00.250Z', '2026-10-19T10:15:00.250Z', '2026-10-19T08:15:00.250Z'],
  ['2026-10-20T15:45-0700', '2026-10-20T15:45:00.000Z', '2026-10-21T00:45:00.000Z', '2026-10-20T22:45:00.000Z'],
]
// ni ISO 8601, ni Time#to_s, ni RFC 2822 : pas une heure, quel que soit le moteur
const AUTRES = ['Oct 19 2026 08:15', 'pas une heure', '2026-13-40T08:15:00Z', 'Mon, 19 Foo 2026 08:15:00 GMT', '2026-10-19 08:15:00 CEST', '1729325700000']
// sans fuseau écrit : l'heure telle qu'écrite, celle de la zone choisie, et l'instant à l'heure locale du processus
const SANS = '2026-10-19 08:15'

describe('graphiques : les heures écrites par un serveur se lisent pareil partout, sans Date.parse', () => {
  const tokyo = calculer('Asia/Tokyo', [...HEURES.map((h) => h[0]), ...AUTRES, SANS])
  const losAngeles = calculer('America/Los_Angeles', [...HEURES.map((h) => h[0]), ...AUTRES, SANS])

  it('ISO 8601, Time#to_s de Ruby et de Rails, RFC 2822 : l\'heure écrite, l\'heure d\'une zone IANA et l\'instant, à Tokyo comme à Los Angeles', () => {
    HEURES.forEach(([texte, mur, paris, instant], i) => {
      for (const [ville, lu] of [['Tokyo', tokyo[i]], ['Los Angeles', losAngeles[i]]]) {
        assert.deepEqual({ mur: lu.mur, paris: lu.paris, instant: lu.instant }, { mur, paris, instant }, `${texte} (${ville})`)
      }
    })
  })

  it('timezone="local" : l\'instant écrit, à l\'heure de l\'écran (Tokyo puis Los Angeles)', () => {
    assert.match(tokyo[0].local, /19.*17:15/, '08:15 UTC à Tokyo')
    assert.match(losAngeles[0].local, /19.*01:15/, '08:15 UTC à Los Angeles')
    assert.match(tokyo[4].local, /19.*17:15/, 'RFC 2822 à Tokyo')
    assert.match(losAngeles[1].local, /19.*01:15/, '10:15 +0200 à Los Angeles')
  })

  it('une autre écriture n\'est pas une heure : elle reste telle quelle, partout', () => {
    AUTRES.forEach((texte, k) => {
      const i = HEURES.length + k
      for (const lu of [tokyo[i], losAngeles[i]]) assert.deepEqual({ mur: lu.mur, paris: lu.paris, instant: lu.instant }, { mur: texte, paris: texte, instant: null }, texte)
    })
  })

  it('sans fuseau écrit : l\'heure telle qu\'écrite, déjà celle de la zone choisie ; l\'instant à l\'heure locale', () => {
    const i = HEURES.length + AUTRES.length
    for (const lu of [tokyo[i], losAngeles[i]]) assert.deepEqual({ mur: lu.mur, paris: lu.paris }, { mur: '2026-10-19T08:15:00.000Z', paris: '2026-10-19T08:15:00.000Z' })
    assert.equal(tokyo[i].instant, '2026-10-18T23:15:00.000Z')
    assert.equal(losAngeles[i].instant, '2026-10-19T15:15:00.000Z')
  })
})

describe('graphiques : avec decimals, une petite valeur négative s\'écrit 0', () => {
  it('« 0 » et « 0,00 », jamais « -0 » ni « -0,00 » ; une valeur qui s\'arrondit loin de zéro garde son signe', () => {
    assert.equal(C.formatNumber(-0.4, 'fr', undefined, 0), '0')
    assert.equal(C.formatNumber(-0.001, 'fr', undefined, 2), '0,00')
    assert.equal(C.formatNumber(-0, 'en', undefined, 1), '0.0')
    assert.equal(C.axisNumber(-0.001, 'en', 2), '0.00', 'une graduation aussi')
    assert.match(C.formatNumber(-0.006, 'fr', undefined, 2), /^[-−]0,01$/)
    assert.match(C.formatNumber(-1.2, 'fr', undefined, 0), /^[-−]1$/)
    assert.match(C.formatNumber(-0.5, 'en', undefined, 0), /^[-−]1$/)
  })
})
