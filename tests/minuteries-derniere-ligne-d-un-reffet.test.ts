// Minuterie écrite en dernière ligne d'un reffet.
// Une fonction rend sa dernière ligne, en Civet comme en CoffeeScript, et un reffet prend la fonction qu'il rend pour son
// nettoyage, sauf la main d'arrêt d'une minuterie (marque de minuterie) : où que soit la ligne, la minuterie posée pendant
// un passage appartient à ce passage, et le passage suivant l'arrête — seul le dernier passage tire. `always: true` n'est
// arrêté ni par le passage suivant ni par la disparition du composant ; un nettoyage écrit (`arret = µafter …` puis
// `-> arret()`) annule toujours, au passage suivant comme à la disparition du composant.
// Montage réel (happy-dom) : trois clics relancent les reffets, puis lecture des tirs après le délai.

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

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// délai des minuteries : bien plus long que les passages, pour qu'aucun tir ne parte entre deux
const DELAI = 400

// compteur de tirs posé sur la fenêtre, lisible même composant disparu
const tir = (nom: string) => `window.${nom} = (window.${nom} or 0) + 1`

// les mêmes reffets, en Civet (langue par défaut) et en CoffeeScript
const places = (lang: string) => `<button class="plus" @click={-> $n++}>+</button>

<script${lang}>
$n = 0

µeffect ->
  $n
  ${tir('__passes')}

µeffect ->
  $n
  µafter ${DELAI}, -> ${tir('__dernier')}

µeffect ->
  µafter ${DELAI}, -> ${tir('__ailleurs')}
  $n

µeffect ->
  $n
  µevery ${DELAI}, immediate: false, times: 1, -> ${tir('__repDernier')}

µeffect ->
  µevery ${DELAI}, immediate: false, times: 1, -> ${tir('__repAilleurs')}
  $n

µeffect ->
  $n
  arret = µafter ${DELAI}, -> ${tir('__annule')}
  -> arret()

µeffect ->
  $n
  repet = µevery ${DELAI}, immediate: false, times: 1, -> ${tir('__repAnnule')}
  -> repet()
</script>`

const TOUJOURS = `<p>{$n}</p>

<script>
$n = 0

µeffect ->
  $n
  µafter ${DELAI}, always: true, -> ${tir('__toujours')}

µeffect ->
  $n
  fin = µafter ${DELAI}, always: true, -> ${tir('__toujoursAnnule')}
  -> fin()
</script>`

// compile les composants d'un coup ; rend le cœur et le code de chacun, sans ESM
async function compiler(composants: Record<string, string>) {
  const root   = mjsTmp('reffet-minuterie')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const nom in composants) writeFileSync(join(srcDir, nom + '.mjs'), composants[nom])

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const files = readdirSync(outDir)
  const lire  = (motif: RegExp) => {
    const f = files.find((x: string) => motif.test(x))
    assert.ok(f, 'fichier compilé : ' + motif)
    return stripEsm(readFileSync(join(outDir, f!), 'utf-8'))
  }
  const code: Record<string, string> = { coeur: lire(/^mjs_core-/) }
  for (const nom in composants) code[nom] = lire(new RegExp('^' + nom + '-'))
  return code
}

// fenêtre happy-dom neuve (compteurs à zéro) qui connaît le cœur et un composant
function fenetre(code: Record<string, string>, nom: string) {
  const win: any = new Window({ url: 'http://localhost/' })
  win.eval(`${code.coeur}\nglobalThis.µ = µ;\n${code[nom]}`)
  return win
}

// pose une balise neuve du composant et attend son montage
async function monter(win: any, nom: string) {
  const el: any = win.document.createElement('mjs-' + nom)
  win.document.body.appendChild(el)
  await attendre(20)
  return el
}

describe('minuterie écrite en dernière ligne d\'un reffet', function () {
  this.timeout(40000)

  let code: Record<string, string>
  before(async () => { code = await compiler({ 'places-civet': places(''), 'places-coffee': places(' lang="coffee"'), toujours: TOUJOURS }) })
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, langue] of [['places-civet', 'Civet'], ['places-coffee', 'CoffeeScript']]) {
    it(`µafter et µevery, en dernière ligne comme ailleurs : le passage suivant arrête la minuterie du précédent, seul le dernier passage tire ; un nettoyage écrit annule aussi (${langue})`, async function () {
      const win = fenetre(code, nom)
      const el  = await monter(win, nom)
      for (let i = 0; i < 3; i++) {
        el._shadow.querySelector('button.plus').click()
        await attendre(5)
      }
      await attendre(DELAI + 300)
      const passes = win.__passes
      assert.ok(passes >= 2, 'les clics relancent les reffets (passages : ' + passes + ')')
      assert.equal(win.__ailleurs, 1, 'µafter suivi d\'une ligne : seul le dernier passage tire')
      assert.equal(win.__dernier, 1, 'µafter en dernière ligne : seul le dernier passage tire, comme ailleurs')
      assert.equal(win.__repAilleurs, 1, 'µevery suivi d\'une ligne : seule la répétition du dernier passage tire')
      assert.equal(win.__repDernier, 1, 'µevery en dernière ligne : seule la répétition du dernier passage tire, comme ailleurs')
      assert.equal(win.__annule, 1, 'nettoyage écrit (`-> arret()`) : le tir de chaque passage précédent est annulé')
      assert.equal(win.__repAnnule, 1, 'nettoyage écrit pour µevery : idem')
      el.remove()
    })
  }

  it('`always: true` en dernière ligne : le tir part quand le composant disparaît ; un nettoyage écrit l\'annule', async function () {
    const win = fenetre(code, 'toujours')
    const el  = await monter(win, 'toujours')
    el.remove()
    await attendre(DELAI + 300)
    assert.equal(win.__toujours, 1, 'always: true en dernière ligne : le tir part, composant disparu')
    assert.equal(win.__toujoursAnnule ?? 0, 0, 'nettoyage écrit (`-> fin()`) : joué à la disparition, il annule, always: true compris')
  })
})
