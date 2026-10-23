// Cycle de vie d'un composant retiré du DOM puis remis plus tard (panneau gardé en mémoire, défilement
// virtuel, déplacement après un `await`). Défaut garanti absent : le composant était détruit à la
// microtâche (nettoyage de µmount, µevery arrêté) puis revenait affiché sans que µmount ne reparte —
// horloge figée, abonnements de µmount perdus, sans un mot ; et µdestroy ne jouait qu'une fois.
// Et une erreur dans µsleep (ou µawake) ne sort plus de `disconnectedCallback` : `el.remove()` levait
// chez l'appelant, et la suite (destruction différée, arrêt de µevery) n'avait jamais lieu — la
// minuterie tournait après le retrait.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const HORLOGE = [
  '<script>',
  '  $m = 0',
  '  µmount ->',
  '    id = setInterval((-> $m++), 10)',
  '    -> clearInterval(id)',
  '  µdestroy ->',
  '    @_detruit = (@_detruit ?? 0) + 1',
  '</script>',
  '<p class="m">{$m}</p>',
].join('\n')

const DORT = [
  '<script>',
  '  $n = 0',
  '  µevery 10, -> $n++',
  '  µsleep ->',
  "    throw new Error('sommeil')",
  '</script>',
  '<p>{$n}</p>',
].join('\n')

const REVEIL = [
  '<script>',
  '  $n = 0',
  '  µawake ->',
  "    throw new Error('réveil')",
  '</script>',
  '<p class="n">{$n}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('remis-apres-retrait')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'cv-horloge.mjs'), HORLOGE)
  writeFileSync(join(srcDir, 'cv-dort.mjs'), DORT)
  writeFileSync(join(srcDir, 'cv-reveil.mjs'), REVEIL)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// attente bornée d'une condition : une machine chargée retarde les minuteries, jamais au-delà de quelques secondes
async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

describe('cycle de vie — composant remis après sa destruction, µsleep / µawake qui jettent', function () {
  this.timeout(180000)

  let app: any
  let avis: any[]

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    avis = []
    app.µ.warn = (...a: any[]) => { avis.push(a) }
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('retiré, détruit, puis remis : µmount repart, son nettoyage et µdestroy rejouent à chaque destruction', async () => {
    const c = await app.mount('cv-horloge')
    const el = c.el
    const hote = el.parentNode
    await attendre(() => c.state.m > 0)
    assert.ok(c.state.m > 0, 'µmount a démarré sa minuterie')
    el.remove()
    await pause(50)
    const fige = c.state.m
    await pause(40)
    assert.equal(c.state.m, fige, 'détruit : la minuterie de µmount est coupée par son nettoyage')
    assert.equal(el._detruit, 1, 'µdestroy a joué une fois')
    hote.appendChild(el)
    await attendre(() => c.state.m > fige)
    assert.ok(c.state.m > fige, `remis : µmount a relancé sa minuterie (${fige} → ${c.state.m})`)
    el.remove()
    await pause(30)
    const fige2 = c.state.m
    await pause(40)
    assert.equal(c.state.m, fige2, 'retiré une seconde fois : le nettoyage du second µmount tourne aussi')
    assert.equal(el._detruit, 2, 'µdestroy rejoue à la seconde destruction')
  })

  it('µsleep qui jette : `remove()` ne lève pas, l\'erreur est signalée, µevery s\'arrête', async () => {
    const c = await app.mount('cv-dort')
    const el = c.el
    await pause(50)
    avis.length = 0
    assert.doesNotThrow(() => el.remove(), 'remove() ne lève pas chez l\'appelant')
    assert.ok(avis.some((a) => a.some((x: any) => x && x.message === 'sommeil')), 'l\'erreur de µsleep est signalée par un avertissement')
    await pause(30)
    const n1 = c.state.n
    await pause(60)
    assert.equal(c.state.n, n1, 'la minuterie µevery est coupée après le retrait')
  })

  it('µawake qui jette : la connexion va au bout, le composant s\'affiche', async () => {
    avis.length = 0
    const c = await app.mount('cv-reveil')
    assert.equal(c.text('.n'), '0', 'le composant est rendu malgré l\'erreur de µawake')
    assert.ok(avis.some((a) => a.some((x: any) => x && x.message === 'réveil')), 'l\'erreur de µawake est signalée par un avertissement')
  })
})
