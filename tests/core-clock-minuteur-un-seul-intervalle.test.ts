// module cœur clock (<@@clock layout="timer">, le minuteur) :
// - l'intervalle d'une seconde est posé UNE fois, au départ ; il n'était reposé à chaque tick que parce que
//   l'effet qui le pose relisait le chiffre qu'il venait d'écrire — chaque seconde coupait puis relançait un
//   intervalle neuf (des ticks de 1 004 à 1 129 ms sous charge) ;
// - le chiffre se lit sur l'horloge (monotone), pas sur le nombre de passages de l'intervalle : un passage en
//   retard (page chargée, onglet ralenti) rattrape les secondes écoulées au lieu de les perdre pour de bon, et
//   chaque seconde écoulée annonce son `tick` ;
// - arrêté puis relancé, il repart du chiffre où il s'était arrêté, sans compter l'attente.
// L'intervalle d'une seconde et l'heure monotone sont tenus à la main (happy-dom, bundler réel) : le test dit
// quand le temps passe, et quand les passages de l'intervalle ont lieu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

const HOTE = [
  '<script>',
  '  $run = true',
  '  $sec = 60',
  '</script>',
  '<@@clock class="tm" layout="timer" seconds={$sec} running={$run}></@@clock>',
  '<button class="stop" @click={$run = false}>stop</button>',
  '<button class="go" @click={$run = true}>go</button>',
  '<button class="dix" @click={$sec = 10}>dix</button>',
].join('\n')

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
    window, hote, intervalles,
    vivants: () => intervalles.filter((i) => i.vivant),
    chiffre: () => tm()._shadow.querySelector('.number b').textContent,
    avancer: (ms: number) => { maintenant += ms },
    // le temps passe de `ms`, puis chaque intervalle vivant passe UNE fois
    passer: async (ms: number) => { maintenant += ms; for (const i of intervalles.filter((x) => x.vivant)) i.f(); await pause(60) },
    ticks:   (() => { const vus: number[] = []; tm().addEventListener('tick', (e: any) => vus.push(e.data)); return vus })()
  }
}

describe('mjs-core-clock minuteur — un seul intervalle, un chiffre lu sur l\'horloge', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('l\'intervalle est posé une fois : quatre secondes plus tard, et après un changement de seconds, c\'est toujours le même', async () => {
    const m = await monter(HOTE, 'clock-un-intervalle')
    assert.equal(m.intervalles.length, 1, 'posé au départ')
    for (let i = 0; i < 4; i++) await m.passer(1000)
    assert.equal(m.chiffre(), '04')
    assert.equal(m.intervalles.length, 1, `jamais reposé (posés : ${m.intervalles.length})`)
    assert.equal(m.vivants().length, 1)
    m.hote._shadow.querySelector('.dix').click()
    await pause(80)
    await m.passer(1000)
    assert.equal(m.chiffre(), '05')
    assert.equal(m.intervalles.length, 1, `ni quand seconds change (posés : ${m.intervalles.length})`)
    m.window.close()
  })

  it('un passage en retard rattrape les secondes écoulées : un seul passage 3,4 s après le départ affiche 3, avec ses trois ticks', async () => {
    const m = await monter(HOTE, 'clock-retard')
    await m.passer(3400)
    assert.equal(m.chiffre(), '03')
    assert.deepEqual(m.ticks, [1, 2, 3], 'une seconde écoulée, un tick')
    await m.passer(1000)
    assert.equal(m.chiffre(), '04')
    assert.deepEqual(m.ticks, [1, 2, 3, 4])
    m.window.close()
  })

  it('arrêté puis relancé : plus d\'intervalle à l\'arrêt, l\'attente ne compte pas, le chiffre repart d\'où il était', async () => {
    const m = await monter(HOTE, 'clock-reprise')
    await m.passer(1000)
    await m.passer(1000)
    assert.equal(m.chiffre(), '02')
    m.hote._shadow.querySelector('.stop').click()
    await pause(80)
    assert.equal(m.vivants().length, 0, 'arrêté : plus d\'intervalle')
    m.avancer(9000)
    m.hote._shadow.querySelector('.go').click()
    await pause(80)
    assert.equal(m.vivants().length, 1, 'relancé : un intervalle')
    assert.equal(m.chiffre(), '02', 'repris où il s\'était arrêté')
    await m.passer(1000)
    assert.equal(m.chiffre(), '03', 'et la seconde suivante vient une seconde après la reprise')
    m.window.close()
  })

  it('le compte repart à zéro au bout de seconds, et chaque seconde annonce son tick, même quand le chiffre ne bouge pas', async () => {
    const trois = await monter('<@@clock class="tm" layout="timer" seconds="3"></@@clock>', 'clock-tour')
    for (let i = 0; i < 4; i++) await trois.passer(1000)
    assert.equal(trois.chiffre(), '01')
    assert.deepEqual(trois.ticks, [1, 2, 0, 1])
    trois.window.close()
    const une = await monter('<@@clock class="tm" layout="timer" seconds="1"></@@clock>', 'clock-une-seconde')
    for (let i = 0; i < 3; i++) await une.passer(1000)
    assert.equal(une.chiffre(), '00')
    assert.deepEqual(une.ticks, [0, 0, 0])
    une.window.close()
  })
})
