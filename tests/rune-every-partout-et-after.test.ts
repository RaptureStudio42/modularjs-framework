// µevery écrit partout (gestionnaire, méthode, µmount) et µafter, son tir unique : la minuterie part à l'appel, rend sa
// main d'arrêt et s'arrête toute seule quand le composant disparaît ; `always: true` fait partir le tir quand même ;
// `await µafter 300` attend, et ne rend jamais la main si le composant disparaît avant.
// Montage RÉEL (happy-dom), clics compris : pas de lecture de la sortie du compilateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
// le gabarit vit dans l'ombre du composant (`_shadow`, fermée) quand il en a une
const bouton   = (el: any, classe: string) => {
  const b = (el._shadow ?? el.shadowRoot ?? el).querySelector('button.' + classe)
  if (!b) throw new Error(`bouton .${classe} introuvable : ${el.outerHTML} | ombre : ${el._shadow?.innerHTML ?? 'aucune'}`)
  return b
}

// compile un composant unique et rend une fenêtre happy-dom prête à le monter
async function monterComposant(nom: string, source: string) {
  const root   = mjsTmp('every-partout')
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
  const poser    = () => {
    const el: any = doc.createElement('mjs-' + nom)
    doc.body.appendChild(el)
    return el
  }
  return { win, doc, poser }
}

const CHRONO = [
  '<p>{$n}</p>',
  '<button class="go" @click={-> arreter = µevery 30, -> $n = $n + 1}>Démarrer</button>',
  '<button class="stop" @click={-> arreter?()}>Arrêter</button>',
  '<button class="methode" @click={-> demarrer()}>Par une méthode</button>',
  '<script>',
  '$n = 0',
  '$m = 0',
  'arreter = null',
  'demarrer = ->',
  '  µevery 30, -> $m = $m + 1',
  '</script>'
].join('\n')

const UN_TIR = [
  '<p>{$tir}</p>',
  '<button class="a" @click={-> µafter 40, -> $tir = $tir + 1}>Un tir</button>',
  '<button class="b" @click={-> annuler = µafter 40, -> $tir = $tir + 10}>Un tir annulable</button>',
  '<button class="c" @click={-> annuler?()}>Annuler</button>',
  '<button class="d" @click={-> µafter 40, always: true, -> window.__annonce = (window.__annonce ?? 0) + 1}>Enregistrer</button>',
  '<button class="e" @click={-> attente()}>Attendre</button>',
  '<button class="f" @click={-> annuler = µafter 40, always: true, -> window.__toujours = 1}>Toujours, puis annulé</button>',
  '<script>',
  '$tir = 0',
  '$init = \'\'',
  '$monte = \'\'',
  'annuler = null',
  'µafter 30, -> $init = \'ok\'',
  'µmount ->',
  '  µafter 30, -> $monte = \'ok\'',
  'attente = async ->',
  '  await µafter 40',
  '  window.__suite = (window.__suite ?? 0) + 1',
  '</script>'
].join('\n')

describe('µevery partout et µafter — la minuterie suit son composant', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('µevery dans un gestionnaire : « Démarrer » lance, « Arrêter » coupe par la main d\'arrêt, le retrait coupe', async function () {
    const { poser, doc } = await monterComposant('chrono', CHRONO)
    const el: any        = poser()
    await attendre(20)
    assert.equal(el._state.n, 0, 'rien ne tourne avant le clic')
    bouton(el, 'go').click()
    await attendre(8)
    assert.equal(el._state.n, 1, `le premier tir part à l'appel, avant la fin de la première période (n = ${el._state.n})`)
    await attendre(110)
    const tourne = el._state.n
    assert.ok(tourne >= 3, `la minuterie tourne (n = ${tourne})`)
    bouton(el, 'stop').click()
    const arrete = el._state.n
    await attendre(100)
    assert.equal(el._state.n, arrete, 'la main d\'arrêt coupe la minuterie')
    bouton(el, 'go').click()
    bouton(el, 'methode').click()
    await attendre(100)
    assert.ok(el._state.n > arrete + 1 && el._state.m >= 2, `relancée par le gestionnaire et par la méthode (n = ${el._state.n}, m = ${el._state.m})`)
    doc.body.removeChild(el)
    await attendre(40)
    const figes = [el._state.n, el._state.m]
    await attendre(120)
    assert.deepEqual([el._state.n, el._state.m], figes, 'le composant retiré arrête les deux minuteries')
  })

  it('µafter : un seul tir, annulable par sa main d\'arrêt, posé aussi depuis le <script> et µmount', async function () {
    const { poser } = await monterComposant('untir', UN_TIR)
    const el: any   = poser()
    await attendre(20)
    bouton(el, 'a').click()
    await attendre(15)
    assert.equal(el._state.tir, 0, 'rien avant le délai')
    await attendre(80)
    assert.equal(el._state.tir, 1, 'un tir après le délai')
    await attendre(100)
    assert.equal(el._state.tir, 1, 'un seul tir')
    bouton(el, 'b').click()
    bouton(el, 'c').click()
    await attendre(100)
    assert.equal(el._state.tir, 1, 'annulé par la main d\'arrêt')
    assert.equal(el._state.init, 'ok', 'µafter du <script> : parti après le montage')
    assert.equal(el._state.monte, 'ok', 'µafter de µmount')
  })

  it('µafter : le retrait annule le tir ; always: true le fait partir quand même ; sa main d\'arrêt l\'annule toujours', async function () {
    const { poser, doc, win } = await monterComposant('retire', UN_TIR)
    const el: any             = poser()
    await attendre(20)
    bouton(el, 'a').click()
    bouton(el, 'd').click()
    bouton(el, 'f').click()
    bouton(el, 'c').click()
    doc.body.removeChild(el)
    await attendre(120)
    assert.equal(el._state.tir, 0, 'composant retiré : le tir ordinaire est annulé')
    assert.equal(win.__annonce, 1, 'always: true : le tir part même composant retiré')
    assert.equal(win.__toujours, undefined, 'always: true annulé par sa main d\'arrêt')
  })

  it('await µafter : la suite part après le délai ; composant retiré avant, elle ne part jamais', async function () {
    const { poser, doc, win } = await monterComposant('attente', UN_TIR)
    const el: any             = poser()
    await attendre(20)
    bouton(el, 'e').click()
    await attendre(15)
    assert.equal(win.__suite, undefined, 'l\'attente n\'est pas finie')
    await attendre(80)
    assert.equal(win.__suite, 1, 'la suite part après le délai')
    const autre: any = poser()
    await attendre(20)
    bouton(autre, 'e').click()
    doc.body.removeChild(autre)
    await attendre(120)
    assert.equal(win.__suite, 1, 'composant retiré : la suite ne part pas')
  })
})
