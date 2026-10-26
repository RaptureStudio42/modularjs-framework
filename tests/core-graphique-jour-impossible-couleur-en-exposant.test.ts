// module cœur <@@chart>, sans navigateur. Sur un axe de jours (`AAAA-MM-JJ` seul), un jour impossible (le 31 novembre, le 29 février d'une
// année ordinaire, le mois 13 ou 0, le jour 0 ou 32) n'est pas un jour : il s'affiche tel quel, comme sur l'axe des heures, au lieu de devenir
// une autre date (« 2026-11-31 » s'affichait « 1 déc. 2026 »). Une couleur de série écrite en nombre à exposant (`'1e-7'`, `1e-7`, `'1E3'`)
// n'est pas une couleur : la construction la refuse, comme le module (le navigateur ne la lit pas), au lieu de la laisser passer

import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { unknownColor, writtenColors } from '../src/bundler/core-chart.js'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url)), 'utf-8')
const µ: any = {}
new Function('µ', SOURCE)(µ)
const C = µ._mjs_chart

async function construire(etiquette: string, page: string): Promise<string> {
  const root   = mjsTmp(etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gx-page.mjs'), page)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => String(e?.message ?? e)).join('\n')
}

describe('<@@chart> — jour impossible sur l\'axe des jours, couleur écrite en nombre à exposant', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un jour impossible n\'est pas un jour : il reste tel quel, sans devenir une autre date', () => {
    for (const ecrit of ['2026-11-31', '2026-13-01', '2026-00-10', '2026-02-29', '2026-04-31', '2026-10-00', '2026-10-32', '2100-02-29']) {
      assert.equal(C.parseX('date', ecrit), null, `« ${ecrit} » n'est pas un jour`)
      assert.equal(C.formatX('date', ecrit, 'fr'), ecrit, `« ${ecrit} » s'affiche tel quel`)
      assert.equal(C.formatX('date', ecrit, 'en', true), ecrit, `« ${ecrit} » s'affiche tel quel, en court`)
    }
  })

  it('témoin : un jour possible se lit et s\'écrit en date, fin de mois et 29 février des années bissextiles compris', () => {
    assert.equal(C.parseX('date', '2026-11-30'), Date.UTC(2026, 10, 30))
    assert.equal(C.parseX('date', '2028-02-29'), Date.UTC(2028, 1, 29))
    assert.equal(C.parseX('date', '2000-02-29'), Date.UTC(2000, 1, 29))
    assert.equal(C.parseX('date', '2026-12-31'), Date.UTC(2026, 11, 31))
    assert.equal(C.parseX('date', '2026-01-01'), Date.UTC(2026, 0, 1))
    assert.equal(C.formatX('date', '2026-11-30', 'fr'), '30 nov. 2026')
    assert.equal(C.formatX('date', '2026-12-31', 'en'), 'Dec 31, 2026')
  })

  it('une couleur écrite en nombre à exposant n\'est pas une couleur, à coup sûr', () => {
    assert.deepEqual(writtenColors(`[{ key: 'v', color: '1e-7' }]`), ['1e-7'], 'en texte')
    assert.deepEqual(writtenColors(`[{ key: 'v', color: 1e-7 }]`), ['1e-7'], 'en nombre, relevée comme le module la lit (String(1e-7))')
    for (const nombre of ['1e-7', '1E3', '-2e5', '.5e1', '1e+2']) assert.equal(unknownColor(nombre), true, `« ${nombre} »`)
    for (const couleur of ['red', '-webkit-link', '#1e3', 'rgb(1e2 0 0)', 'var(--e1)']) assert.equal(unknownColor(couleur), false, `« ${couleur} » n'est pas refusée`)
  })

  it('à la construction, une couleur en nombre à exposant arrête la construction, en texte (\'1e-7\') comme en nombre (2e-9) ; 1e3 écrit en nombre vaut 1000, une teinte', async () => {
    const donnees = '<script>\n  $lignes = [{ x: \'a\', v: 1 }]\n</script>\n'
    const fautes  = await construire('graphique-couleur-exposant', donnees + '<@@chart rows={$lignes} series={[{ key: \'a\', color: \'1e-7\' }, { key: \'b\', color: 2e-9 }, { key: \'c\', color: \'1E3\' }]}></@@chart>\n')
    for (const couleur of ['1e-7', '2e-9', '1E3']) assert.ok(fautes.includes(`la couleur « ${couleur} » est refusée`), `« ${couleur} » refusée :\n${fautes}`)
    assert.equal(fautes.split('\n').filter((l) => l.includes('est refusée')).length, 3, `une ligne par couleur refusée :\n${fautes}`)
    const juste = await construire('graphique-couleur-exposant-juste', donnees + '<@@chart rows={$lignes} series={[{ key: \'a\', color: 1e3 }, { key: \'b\', color: \'#1e3\' }]}></@@chart>\n')
    assert.equal(juste, '', juste)
  })
})
