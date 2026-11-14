// minuteries d'un composant (µafter, µevery) : une minuterie tirée ou arrêtée ne laisse rien derrière elle sur son
// composant — ni dans sa liste de destruction, ni dans ses files de sommeil et de réveil, ni en mémoire — et le retrait du
// composant arrête toujours ce qui tourne encore. Montage RÉEL (happy-dom) : un gestionnaire cliqué 10 000 fois, puis les
// appels du runtime tels que le compilateur les écrit (`µ.after(composant, délai, fonction)`)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const N = 10000

// ramasse-miettes appelable depuis le test : mémoire mesurée après deux passes
setFlagsFromString('--expose_gc')
const gc  = runInNewContext('gc') as () => void
const tas = () => { gc(); gc(); return process.memoryUsage().heapUsed }

// octets gardés par minuterie, au plus ; la plus petite de trois mesures au plus : sous charge, une allocation étrangère au
// test (autre fichier du même processus, ramassage en retard) gonfle une mesure seule, une vraie fuite revient à chaque essai
const GARDE_MAX    = 60
const parMinuterie = async (poser: () => unknown) => {
  let garde = Infinity
  for (let essai = 0; essai < 3 && garde >= GARDE_MAX; essai++) {
    const m0 = tas()
    await poser()
    garde = Math.min(garde, (tas() - m0) / N)
  }
  return garde
}

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
const jusqua   = async (cond: () => boolean, quoi: string) => {
  const fin = Date.now() + 10000
  while (!cond()) {
    if (Date.now() > fin) assert.fail(quoi + ' : délai dépassé')
    await attendre(10)
  }
}
const bouton = (el: any, classe: string) => {
  const b = (el._shadow ?? el.shadowRoot ?? el).querySelector('button.' + classe)
  if (!b) throw new Error(`bouton .${classe} introuvable : ${el.outerHTML}`)
  return b
}

// tailles des listes que porte l'instance (tableau, Set, Map) : ce qui grossirait d'une entrée par minuterie
const listes = (el: any) => {
  const t: Record<string, number> = {}
  for (const k of Object.keys(el)) {
    const v = el[k]
    if (Array.isArray(v)) t[k] = v.length
    else if (v && typeof v === 'object' && typeof v.size === 'number' && typeof v.has === 'function') t[k] = v.size
  }
  return t
}
const grossies = (avant: Record<string, number>, apres: Record<string, number>) => Object.keys(apres).filter(k => apres[k] - (avant[k] ?? 0) >= 100).map(k => `${k} : ${avant[k] ?? 0} → ${apres[k]}`)

// compile un composant unique et rend une fenêtre happy-dom prête à le monter
async function monterComposant(nom: string, source: string) {
  const root   = mjsTmp('minuteries-accumulation')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const win: any = new Window({ url: 'http://localhost/' })
  const files    = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  const compFile = files.find((f: string) => new RegExp('^' + nom + '-').test(f))
  assert.ok(coreFile && compFile, 'cœur + composant compilés')
  win.eval(`${stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))}`)
  const doc: any = win.document
  const el: any  = doc.createElement('mjs-' + nom)
  doc.body.appendChild(el)
  await attendre(20)
  return { win, doc, el }
}

// recherche « à la frappe » : chaque frappe annule la recherche prévue et en prévoit une autre
const FRAPPE = [
  '<p>{$tir}</p>',
  '<button class="frappe" @click={-> frapper()}>Frappe</button>',
  '<script>',
  '$tir = 0',
  'annuler = null',
  'frapper = ->',
  '  annuler?()',
  '  annuler = µafter 300, -> $tir = $tir + 1',
  '</script>'
].join('\n')

describe('minuteries — rien ne reste sur le composant après le tir ou l\'arrêt', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('µafter relancé à chaque frappe, 10 000 frappes : la liste de destruction garde sa taille de départ', async function () {
    const { el } = await monterComposant('frappe', FRAPPE)
    const b      = bouton(el, 'frappe')
    b.click()                                     // première minuterie : ce que le composant garde pour ses minuteries est en place
    const avant  = listes(el)
    const depart = (el._mjs_destroy_cbs ?? []).length
    for (let i = 0; i < N; i++) b.click()
    const fin = (el._mjs_destroy_cbs ?? []).length
    assert.ok(fin <= depart, `liste de destruction : ${depart} entrées au départ, ${fin} après ${N} frappes`)
    assert.deepEqual(grossies(avant, listes(el)), [], 'aucune liste du composant ne grossit d\'une entrée par frappe')
    await attendre(450)
    assert.equal(el._state.tir, 1, 'seule la dernière frappe tire')
  })

  it('10 000 µafter arrêtés par leur main, puis 10 000 tirés : listes revenues, mémoire retombée', async function () {
    const { win, el } = await monterComposant('arretes', FRAPPE)
    const f = () => {}
    win.µ.after(el, 600000, f)()                  // mise en place, hors mesure
    const avant = listes(el)
    const garde = await parMinuterie(() => {
      const mains = Array.from({ length: N }, () => win.µ.after(el, 600000, f))
      for (const main of mains) main()
    })
    assert.deepEqual(grossies(avant, listes(el)), [], 'après l\'arrêt par la main')
    assert.ok(garde < GARDE_MAX, `mémoire gardée après l'arrêt : ${garde.toFixed(0)} o par minuterie`)
    let tirs     = 0
    const g      = () => { tirs++ }
    const garde2 = await parMinuterie(async () => {
      tirs = 0
      for (let i = 0; i < N; i++) win.µ.after(el, 0, g)
      await jusqua(() => tirs === N, `les ${N} tirs (${tirs})`)
    })
    assert.deepEqual(grossies(avant, listes(el)), [], 'après le tir')
    assert.ok(garde2 < GARDE_MAX, `mémoire gardée après le tir : ${garde2.toFixed(0)} o par minuterie`)
    await attendre(30)
    assert.equal(tirs, N, 'un seul tir chacun')
  })

  it('µevery arrêté par sa main, par times, par while, avec pause ou onStop : listes revenues, mémoire retombée', async function () {
    const { win, el } = await monterComposant('every', FRAPPE)
    let tirs = 0, arrets = 0
    const f  = () => { tirs++ }
    const fs = () => { arrets++ }
    const sortes: Array<[string, () => void, number, number]> = [
      ['main d\'arrêt', () => { win.µ.every(el, 600000, f)() }, 1, 0],
      ['times: 1', () => { win.µ.every(el, 600000, { times: 1 }, f) }, 1, 0],
      ['while faux', () => { win.µ.every(el, 600000, { while: () => false }, f) }, 0, 0],
      ['pause: true, main d\'arrêt', () => { win.µ.every(el, 600000, { pause: true, immediate: false }, f)() }, 0, 0],
      ['onStop, main d\'arrêt', () => { win.µ.every(el, 600000, { onStop: fs }, f)() }, 1, 1]
    ]
    for (const [sorte, poser, parTir, parArret] of sortes) {
      poser()                                     // mise en place, hors mesure
      const avant = listes(el)
      const t0    = tirs
      const a0    = arrets
      let poses   = 0
      const garde = await parMinuterie(() => {
        for (let i = 0; i < N; i++) poser()
        poses += N
      })
      assert.deepEqual(grossies(avant, listes(el)), [], sorte)
      assert.ok(garde < GARDE_MAX, `${sorte} : ${garde.toFixed(0)} o gardés par minuterie`)
      assert.equal(tirs - t0, poses * parTir, `${sorte} : tirs`)
      assert.equal(arrets - a0, poses * parArret, `${sorte} : onStop`)
    }
  })

  it('le retrait du composant arrête ce qui tourne encore ; remis dans la page, il le relance, et le retire de nouveau', async function () {
    const { win, doc, el } = await monterComposant('retrait', FRAPPE)
    let apres = 0, tours = 0, enPause = 0
    for (let i = 0; i < 1000; i++) win.µ.after(el, 300, () => { apres++ })
    for (let i = 0; i < 50; i++) win.µ.every(el, 10, { immediate: false }, () => { tours++ })
    for (let i = 0; i < 50; i++) win.µ.every(el, 10, { immediate: false, pause: true }, () => { enPause++ })
    const annulee = win.µ.after(el, 300, () => { apres += 1000000 })
    annulee()
    doc.body.removeChild(el)
    await attendre(20)
    const figes = [apres, tours, enPause]
    await attendre(400)
    assert.deepEqual([apres, tours, enPause], figes, 'plus rien ne part après le retrait')
    assert.equal(apres, 0, 'les µafter en attente sont annulés')
    doc.body.appendChild(el)
    await jusqua(() => apres >= 1000, `remis dans la page, chaque µafter en attente part (${apres})`)
    await attendre(60)
    assert.equal(apres, 1000, 'une fois chacun ; celui arrêté par sa main ne part jamais')
    assert.ok(tours > figes[1] && enPause > figes[2], `les µevery repartent (${tours}, ${enPause})`)
    doc.body.removeChild(el)
    await attendre(20)
    const figes2 = [apres, tours, enPause]
    await attendre(100)
    assert.deepEqual([apres, tours, enPause], figes2, 'arrêtés de nouveau au retrait suivant')
  })
})
