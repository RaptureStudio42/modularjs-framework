// Main d'arrêt d'une minuterie rendue par un gestionnaire du gabarit.
// En CoffeeScript comme en Civet, une fonction rend sa dernière expression : `tard = (e) -> µafter 15, -> …` rend la
// main d'arrêt de sa minuterie. Donnée en gestionnaire sous la forme d'un appel (`@click={tard(e)}`), cette main était
// prise pour un gestionnaire rendu (forme `@click={save}`, que le routeur appelle) : la minuterie s'annulait aussitôt,
// sans message. La main porte la marque du passage qui l'a vue naître, comme la fonction de retrait de `µon` : rendue
// par ce même passage, le routeur ne l'appelle pas. Rangée puis donnée à un clic suivant (`@click={$arret}`), elle
// arrête toujours sa minuterie, et les autres formes de gestionnaire ne changent pas.
// Montage réel (happy-dom) : clic sur la balise, puis lecture de l'état après le délai.

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

// compile un composant unique et rend une fenêtre happy-dom qui le connaît
async function fenetre(nom: string, source: string) {
  const root   = mjsTmp('main-arret')
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
  return win
}

// pose une balise neuve du composant (état neuf) et attend son montage
async function monter(win: any, nom: string) {
  const el: any = win.document.createElement('mjs-' + nom)
  win.document.body.appendChild(el)
  await attendre(20)
  return el
}

const cliquer = (el: any, classe: string) => el._shadow.querySelector('button.' + classe).click()

const RENDUE = `<button class="tard" @click={tard(e)}>a</button>
<button class="tard-options" @click={tardOptions(e)}>b</button>
<button class="tard-methode" @click={@tardM()}>k</button>
<button class="repete" @click={repete(e)}>c</button>
<button class="repete-sans" @click={repeteSans(e)}>d</button>
<button class="ref" @click={plusTard}>e</button>
<button class="fleche" @click={-> $fleche++}>f</button>
<button class="methode" @click={@compter}>g</button>
<button class="fabrique" @click={choisir(7)}>h</button>
<button class="lancer" @click={lancer}>i</button>
<button class="arreter" @click={$arret}>j</button>

<script>
$a       = 0
$ao      = 0
$am      = 0
$r       = 0
$rs      = 0
$ref     = 0
$fleche  = 0
$methode = 0
$choix   = 0
$n       = 0
$arret   = null

tard        = (e) -> µafter 15, -> $a++
tardOptions = (e) -> µafter 15, pause: true, -> $ao++
repete      = (e) -> µevery 15, times: 3, -> $r++
repeteSans  = (e) -> µevery 15, -> $rs++
plusTard    = -> µafter 15, -> $ref++
@tardM      = -> µafter 15, -> $am++
@compter    = -> $methode++
choisir     = (k) -> (e) -> $choix = k
lancer      = -> $arret = µevery 15, -> $n++
</script>`

const DIRECTE = `<button class="direct" @click={µafter 15, -> $d++}>d</button>

<script>
$d = 0
</script>`

describe('main d\'arrêt d\'une minuterie rendue par un gestionnaire du gabarit', function () {
  this.timeout(40000)

  let win: any
  before(async () => { win = await fenetre('rendue', RENDUE) })
  after(async () => { await terminateSharedWorkerPool() })

  it('une fonction qui finit par µafter, appelée par le gestionnaire (`@click={tard(e)}`) : le tir part', async function () {
    const el = await monter(win, 'rendue')
    cliquer(el, 'tard')
    cliquer(el, 'tard-options')
    cliquer(el, 'tard-methode')
    await attendre(150)
    assert.equal(el._state.a, 1, 'chemin court de µafter : la main rendue par le gestionnaire n\'est pas appelée')
    assert.equal(el._state.ao, 1, 'µafter avec options : idem')
    assert.equal(el._state.am, 1, '`@click={@tardM()}`, méthode d\'instance appelée comme dans la doc : idem')
    el.remove()
  })

  it('mêmes formes pour µevery : la répétition continue', async function () {
    const el = await monter(win, 'rendue')
    cliquer(el, 'repete')
    cliquer(el, 'repete-sans')
    await attendre(200)
    assert.equal(el._state.r, 3, '`times: 3` va au bout de ses trois tirs')
    assert.ok(el._state.rs >= 3, 'µevery sans options continue de tirer (reçu ' + el._state.rs + ')')
    el.remove()
  })

  it('µafter écrit dans le gestionnaire lui-même (`@click={µafter 15, -> …}`) : le tir part', async function () {
    const w  = await fenetre('directe', DIRECTE)
    const el = await monter(w, 'directe')
    cliquer(el, 'direct')
    await attendre(150)
    assert.equal(el._state.d, 1)
    el.remove()
  })

  it('les autres formes de gestionnaire ne changent pas', async function () {
    const el = await monter(win, 'rendue')
    cliquer(el, 'ref')
    cliquer(el, 'fleche')
    cliquer(el, 'methode')
    cliquer(el, 'fabrique')
    assert.equal(el._state.fleche, 1, '`@click={-> …}`')
    assert.equal(el._state.methode, 1, '`@click={@nom}`')
    assert.equal(el._state.choix, 7, '`@click={choisir(7)}` qui rend une fonction voulue : elle est appelée')
    await attendre(150)
    assert.equal(el._state.ref, 1, '`@click={plusTard}` (référence) : le tir part')
    el.remove()
  })

  it('une main d\'arrêt rangée puis donnée à un clic suivant (`@click={$arret}`) arrête sa minuterie', async function () {
    const el = await monter(win, 'rendue')
    cliquer(el, 'lancer')
    await attendre(80)
    assert.ok(el._state.n >= 2, 'la répétition tourne (reçu ' + el._state.n + ')')
    cliquer(el, 'arreter')
    const vu = el._state.n
    await attendre(120)
    assert.equal(el._state.n, vu, 'arrêtée par sa main, donnée en gestionnaire à un autre clic')
    el.remove()
  })
})
