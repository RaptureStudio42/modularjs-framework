// module cœur clock (<@@clock layout="timer">, le minuteur) : les deux bornes du rattrapage des secondes.
// - la marge d'un quart de seconde : un intervalle ne tombe jamais pile sur la seconde (il peut passer un peu
//   avant), la seconde est annoncée dès 750 ms écoulées — pas avant, pas après ;
// - le plafond : un passage très en retard (onglet gelé, page chargée) ne rejoue pas plus d'un tour de compteur,
//   soit `seconds` ticks au plus, et les valeurs annoncées restent celles de la fin du rattrapage ; un passage
//   suivant reprend là où le précédent s'est arrêté.
// L'intervalle d'une seconde et l'heure monotone sont tenus à la main (happy-dom, bundler réel).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

async function monter(source: string, prefixe: string) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const intervalles: Array<{ f: () => void; vivant: boolean }> = []
  let maintenant = 5000
  const poser  = window.setInterval.bind(window)
  const couper = window.clearInterval.bind(window)
  window.setInterval   = (f: any, t?: number, ...r: any[]) => { if (t !== 1000) return poser(f, t, ...r); const i = { f, vivant: true }; intervalles.push(i); return i }
  window.clearInterval = (i: any) => { if (i && typeof i === 'object' && 'vivant' in i) i.vivant = false; else couper(i) }
  Object.defineProperty(window, 'performance', { value: { now: () => maintenant }, configurable: true })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow)
  await pause(120)
  const tm = () => hote._shadow.querySelector('.tm')
  return {
    window,
    chiffre: () => tm()._shadow.querySelector('.number b').textContent,
    // le temps passe de `ms`, puis chaque intervalle vivant passe UNE fois
    passer: async (ms: number) => { maintenant += ms; for (const i of intervalles.filter((x) => x.vivant)) i.f(); await pause(60) },
    ticks:   (() => { const vus: number[] = []; tm().addEventListener('tick', (e: any) => vus.push(e.data)); return vus })()
  }
}

describe('mjs-core-clock minuteur — la marge d\'un quart de seconde et le plafond du rattrapage', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la seconde est annoncée dès 750 ms écoulées : un passage à 740 ms ne dit rien, un passage à 760 ms annonce la première seconde', async () => {
    const m = await monter('<@@clock class="tm" layout="timer" seconds="60"></@@clock>', 'clock-marge')
    await m.passer(740)
    assert.deepEqual(m.ticks, [], 'à 740 ms, aucune seconde n\'est écoulée, même avec le quart de seconde d\'avance')
    assert.equal(m.chiffre(), '00')
    await m.passer(20)
    assert.deepEqual(m.ticks, [1], 'à 760 ms, la première seconde est annoncée (un intervalle passe parfois un peu avant)')
    assert.equal(m.chiffre(), '01')
    m.window.close()
  })

  it('un passage très en retard ne rejoue qu\'un tour de compteur : seconds ticks au plus, les derniers', async () => {
    const m = await monter('<@@clock class="tm" layout="timer" seconds="5"></@@clock>', 'clock-plafond')
    await m.passer(12000)
    assert.deepEqual(m.ticks, [3, 4, 0, 1, 2], 'douze secondes écoulées pour un compteur de cinq : les cinq dernières, pas les douze')
    assert.equal(m.chiffre(), '02', 'le chiffre est celui de la douzième seconde')
    m.window.close()
  })

  it('le passage suivant reprend là où le rattrapage s\'est arrêté, sans rejouer ce qui a été sauté', async () => {
    const m = await monter('<@@clock class="tm" layout="timer" seconds="5"></@@clock>', 'clock-plafond-suite')
    await m.passer(12000)
    await m.passer(1000)
    assert.deepEqual(m.ticks, [3, 4, 0, 1, 2, 3], 'une seconde de plus, un tick de plus')
    assert.equal(m.chiffre(), '03')
    m.window.close()
  })
})
