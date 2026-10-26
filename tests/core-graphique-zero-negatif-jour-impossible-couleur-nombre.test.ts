// module cœur <@@chart>, sans navigateur. Un zéro négatif (« -0.0 », ce que Rails envoie pour `(-0.04).round(1)`) s'écrit « 0 » sans
// `decimals` comme avec : dans la bulle, le tableau, les graduations, les bornes d'un histogramme et les statistiques. Une date ou une heure
// impossible (le 31 novembre, le 30 février, 24:30, 61 secondes, le mois 13) n'est pas une heure : elle s'affiche telle quelle, au lieu de
// devenir une autre date ; « 24:00 », la fin du jour, reste minuit le lendemain. Une couleur de série écrite en nombre (`color: 0`) se
// vérifie à la construction comme le module la lit : refusée comme `'0'`, acceptée quand elle vaut un entier de 1 ou plus (`color: 1.0`)

import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { writtenColors } from '../src/bundler/core-chart.js'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url)), 'utf-8')
const µ: any = {}
new Function('µ', SOURCE)(µ)
const C = µ._mjs_chart

async function construire(etiquette: string, page: string): Promise<string> {
  const root   = mjsTmp(etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gn-page.mjs'), page)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => String(e?.message ?? e)).join('\n')
}

describe('<@@chart> — zéro négatif, dates impossibles, couleur écrite en nombre', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un zéro négatif s\'écrit 0, jamais « -0 » : mesure, graduation, borne d\'histogramme, statistiques', () => {
    for (const lu of [-0, C.number('-0.0'), C.number('-0'), JSON.parse('-0.0')]) {
      assert.ok(Object.is(lu, -0), 'la mesure lue est bien un zéro négatif (sinon l\'essai ne prouve rien)')
      assert.equal(C.formatNumber(lu, 'fr'), '0')
      assert.equal(C.formatNumber(lu, 'en'), '0')
      assert.equal(C.formatNumber(lu, 'fr', 0.5), '0', 'au pas d\'une classe d\'histogramme')
      assert.equal(C.formatNumber(lu, 'fr', undefined, 1), '0,0', 'avec decimals, comme avant')
      assert.equal(C.axisNumber(lu, 'fr'), '0', 'une graduation')
      assert.equal(C.axisNumber(lu, 'fr', 2), '0,00', 'une graduation avec decimals')
    }
    const stats = C.statsText({ mean: -0, median: -0, q1: -0, q3: -0, min: -0, max: -0, deviation: 0, next: -0, slope: -0 }, 'fr')
    assert.deepEqual(stats, { mean: '0', median: '0', q1: '0', q3: '0', range: '0 – 0', deviation: '0', next: '0', slope: '0' })
    assert.match(C.formatNumber(-1.5, 'fr'), /^[-−]1,5$/, 'une valeur négative garde son signe')
    assert.match(C.axisNumber(-2, 'fr'), /^[-−]2$/, 'une graduation négative garde son signe')
  })

  it('une date ou une heure impossible n\'est pas une heure : elle reste telle quelle, sans devenir une autre date', () => {
    const impossibles = [
      '2026-11-31 10:00', '2026-02-30T10:00:00Z', '2026-02-29 10:00', '2026-04-31T08:15:00+02:00', '2026-10-19 24:30', '2026-10-19 24:00:01',
      '2026-10-19T24:00:00.5Z', '2026-10-19 10:00:61', '2026-10-19 10:60', '2026-13-01 10:00', '2026-00-10 10:00', '2026-10-00 10:00',
      'Tue, 31 Nov 2026 10:00:00 GMT', '30 Feb 2026 10:00 +0200', '2026-02-30T10:00:00.000Z', '2026-11-31T10:00:00.000Z', '2026-10-19T24:30:00.000Z',
    ]
    for (const ecrit of impossibles) {
      assert.equal(C.parseX('datetime', ecrit), null, `« ${ecrit} » n'est pas une heure`)
      assert.equal(C.formatX('datetime', ecrit, 'fr'), ecrit, `« ${ecrit} » s'affiche tel quel`)
      assert.equal(C.wallTime(ecrit, 'Europe/Paris'), ecrit, `« ${ecrit} » n'est pas ramené dans une zone`)
      assert.equal(C.wallTime(ecrit, null), ecrit, `« ${ecrit} » n'est pas ramené sans zone`)
    }
    for (const juste of ['2028-02-29 10:00', '2026-12-31T23:59:59Z', '2026-04-30T08:15:00+02:00', 'Mon, 30 Nov 2026 10:00:00 GMT', '2026-10-19T08:15:00.000Z', '2028-02-29T10:00:00.000Z']) {
      assert.notEqual(C.parseX('datetime', juste), null, `« ${juste} » est une heure`)
    }
    assert.equal(C.parseX('datetime', '2026-10-19 24:00'), C.parseX('datetime', '2026-10-20 00:00'), '24:00, la fin du jour : minuit le lendemain')
    assert.equal(C.parseX('datetime', '2026-10-19T24:00:00.000Z'), Date.parse('2026-10-20T00:00:00.000Z'))
    assert.equal(C.wallTime('2026-10-19 24:00:00 UTC', 'UTC'), '2026-10-20T00:00:00.000Z')
  })

  it('une couleur écrite en nombre est relevée comme le module la lit', () => {
    const lues = (couleur: string) => writtenColors(`[{ key: 'v', color: ${couleur} }]`)
    assert.deepEqual(lues('0'), ['0'])
    assert.deepEqual(lues('-1'), ['-1'])
    assert.deepEqual(lues('1.5'), ['1.5'])
    assert.deepEqual(lues('-0'), ['0'])
    assert.deepEqual(lues('.5'), ['0.5'])
    assert.deepEqual(lues('1e-3'), ['0.001'])
    assert.deepEqual(lues('1.0'), ['1'])
    assert.deepEqual(lues('2e0'), ['2'])
    assert.deepEqual(lues('+3'), ['3'])
    assert.deepEqual(lues("'0'"), ['0'], 'le texte, comme avant')
    for (const incertaine of ['$teinte', '0 || 2', '1 + 1', 'n ? 1 : 2', '0x10', '-x', '1n']) assert.deepEqual(lues(incertaine), [], `« ${incertaine} » : dans le doute, rien`)
    assert.deepEqual(writtenColors('[{ key: \'a\', color: 0 }, { key: \'b\', color: 2, name: \'x\' }]'), ['0', '2'])
  })

  it('écrite en nombre, une couleur qui n\'est pas un entier de 1 ou plus arrête la construction ; 1.0 ou 2e0 passent', async () => {
    const donnees = '<script>\n  $lignes = [{ x: \'a\', v: 1 }]\n  $teinte = 2\n</script>\n'
    const fautes  = await construire('graphique-couleur-nombre', donnees + '<@@chart rows={$lignes} series={[{ key: \'a\', color: 0 }, { key: \'b\', color: -1 }, { key: \'c\', color: 1.5 }]}></@@chart>\n')
    for (const couleur of ['0', '-1', '1.5']) assert.ok(fautes.includes(`la couleur « ${couleur} » est refusée`), `« ${couleur} » refusée :\n${fautes}`)
    assert.equal(fautes.split('\n').filter((l) => l.includes('est refusée')).length, 3, `une ligne par couleur refusée :\n${fautes}`)
    const justes = await construire('graphique-couleur-nombre-juste', donnees + '<@@chart rows={$lignes} series={[{ key: \'a\', color: 1.0 }, { key: \'b\', color: 2e0 }, { key: \'c\', color: 7 }, { key: \'d\', color: $teinte }]}></@@chart>\n')
    assert.equal(justes, '', justes)
  })
})
