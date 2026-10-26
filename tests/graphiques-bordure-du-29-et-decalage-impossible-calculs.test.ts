// graphiques, sans navigateur : les heures que lit le runtime du module cœur <@@chart>. Le 29 février d'une année ordinaire n'est pas un jour,
// sous la forme exacte que Date.parse lit tout droit (24 caractères, « 2026-02-29T10:00:00.000Z », la lecture rapide) comme sous les autres
// formes : certains moteurs le passent au 1er mars, le graphique l'affichait « 1 mars 2026, 10:00 ». Un décalage horaire impossible
// (heures au-delà de 23, minutes au-delà de 59 : « +25:00 », « +02:60 », « +99 », « +2500 ») n'est pas un fuseau : l'écriture n'est pas une
// heure, elle s'affiche telle quelle comme toute heure impossible, au lieu d'être lue comme un instant décalé. Les décalages justes
// (« +02:00 », « -05:30 », « Z », « +0200 ») ne changent pas

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url)), 'utf-8')
const µ: any = {}
new Function('µ', SOURCE)(µ)
const C = µ._mjs_chart

// une écriture qui n'est pas une heure : elle ne se lit pas, s'affiche telle quelle, et n'est ramenée dans aucune zone
function assertLibelle(ecrit: string) {
  assert.equal(C.parseX('datetime', ecrit), null, `« ${ecrit} » n'est pas une heure`)
  assert.equal(C.formatX('datetime', ecrit, 'fr'), ecrit, `« ${ecrit} » s'affiche tel quel`)
  assert.equal(C.wallTime(ecrit, 'Europe/Paris'), ecrit, `« ${ecrit} » n'est pas ramené dans une zone`)
  assert.equal(C.wallTime(ecrit, null), ecrit, `« ${ecrit} » n'est pas ramené sans zone`)
}

describe('graphiques — le 29 février, les décalages horaires impossibles', () => {
  it('le 29 février d\'une année ordinaire reste un libellé, sous la forme à 24 caractères que Date.parse lit tout droit', () => {
    assert.ok(!Number.isNaN(Date.parse('2026-02-29T10:00:00.000Z')), 'ce moteur passe le 29 février d\'une année ordinaire au 1er mars (sans cela, l\'essai ne prouve rien)')
    for (const ecrit of ['2026-02-29T10:00:00.000Z', '2027-02-29T00:00:00.000Z', '1900-02-29T12:00:00.000Z', '2100-02-29T23:59:59.999Z']) assertLibelle(ecrit)
  })

  it('le 29 février d\'une année bissextile, le 29 des autres mois et la veille de ces bords sont des heures', () => {
    const justes: [string, number][] = [
      ['2028-02-29T10:00:00.000Z', Date.UTC(2028, 1, 29, 10)],
      ['2000-02-29T00:00:00.000Z', Date.UTC(2000, 1, 29)],
      ['2026-03-29T10:00:00.000Z', Date.UTC(2026, 2, 29, 10)],
      ['2026-02-28T23:59:59.999Z', Date.UTC(2026, 1, 28, 23, 59, 59, 999)],
      ['2026-04-30T10:00:00.000Z', Date.UTC(2026, 3, 30, 10)],
    ]
    for (const [ecrit, instant] of justes) {
      assert.equal(C.parseX('datetime', ecrit), instant, `« ${ecrit} » est une heure`)
      assert.equal(C.wallTime(ecrit, 'UTC'), new Date(instant).toISOString(), `« ${ecrit} » est ramené dans sa zone`)
    }
  })

  it('un décalage horaire impossible n\'est pas un fuseau : l\'écriture reste un libellé (ISO 8601, Time#to_s de Rails, RFC 2822)', () => {
    const decalages = ['+25:00', '+24:00', '-24:00', '+02:60', '+99:99', '-00:99', '+99', '+2500', '-2400', '+0260', '+2360']
    for (const decalage of decalages) {
      assertLibelle(`2026-10-19T10:00:00${decalage}`)
      assertLibelle(`2026-10-19 10:00:00 ${decalage}`)
      assertLibelle(`Mon, 19 Oct 2026 10:00:00 ${decalage}`)
    }
    assertLibelle('19 Oct 2026 10:15 +0260')
  })

  it('les décalages justes ne changent pas : l\'instant se lit en retranchant le décalage de l\'heure écrite', () => {
    const fuseaux: [string, number][] = [['Z', 0], ['UTC', 0], ['GMT', 0], ['+00:00', 0], ['+02:00', 120], ['+0200', 120], ['+02', 120], ['-05:30', -330], ['-0530', -330], ['+23:59', 1439], ['-23:59', -1439]]
    for (const [fuseau, minutes] of fuseaux) {
      const instant = Date.UTC(2026, 9, 19, 10) - minutes * 60000
      for (const ecrit of [`2026-10-19T10:00:00${fuseau}`, `2026-10-19 10:00:00 ${fuseau}`, `Mon, 19 Oct 2026 10:00:00 ${fuseau}`]) {
        assert.equal(C.parseX('datetime', ecrit), instant, `« ${ecrit} » est une heure`)
        assert.equal(C.wallTime(ecrit, 'UTC'), new Date(instant).toISOString(), `« ${ecrit} » est ramené dans sa zone`)
      }
    }
  })
})
