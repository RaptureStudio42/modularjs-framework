// Types et valeurs permises — exécution : de vrais composants compilés, chargés dans happy-dom. Toute
// écriture passe la règle de sa variable, quelle que soit sa voie : valeur de départ, bouton, champ
// lié, fonction qui reçoit l'objet, clé calculée, méthode d'une liste, remplacement entier, prop
// d'un parent (valeur ou attribut texte), enfant lié en deux sens, store. Une valeur refusée
// n'est pas écrite ; en développement, un avertissement le dit.

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

const TYPES = ['<types>', '  Percent  int 0..100', '</types>'].join('\n')

const REGLAGES = [
  '<vars>',
  '  $volume    Percent',
  "  $color     'red' | 'green' | 'blue'",
  '  $settings  { volume: Percent, bass?: int -10..10 }',
  '  $tags      string[] 0..3',
  "  $nick      string 3..10 ! 'admin' | 'root'",
  '</vars>',
  '',
  '<script>',
  '  $volume   = 150',
  "  $color    = 'red'",
  '  $settings = { volume: 50, bass: 0 }',
  "  $tags     = ['a']",
  "  $nick     = 'ann'",
  '  regler = (r) -> r.volume = 500',
  '  poser  = (cle, v) -> $settings[cle] = v',
  '</script>',
  '',
  '<p class="v">{$volume}</p>',
  '<p class="c">{$color}</p>',
  '<p class="s">{$settings.volume}</p>',
  '<input class="i" aria-label="volume" value=!{$volume}>',
  '<button class="plus" @click={$volume += 20}>+</button>',
  "<button class=\"violet\" @click={$color = 'purple'}>v</button>",
  '<button class="fonction" @click={regler($settings)}>f</button>',
  "<button class=\"cle\" @click={poser('volume', 999)}>c</button>",
  "<button class=\"cle-bass\" @click={poser('bass', 'x')}>cb</button>",
  '<button class="push" @click={$tags.push(7)}>p</button>',
  '<button class="remplacer" @click={$settings = { volume: -5 }}>r</button>',
  "<button class=\"admin\" @click={$nick = 'admin'}>n</button>",
].join('\n')

const ENFANT = ['<vars>', '  $level  int 1..5', '</vars>', '', '<p class="l">{$level}</p>'].join('\n')
const PARENT = ['<@enfant class="a" level={9}></@enfant>', '<@enfant class="b" level="3"></@enfant>'].join('\n')

// l'enfant modifie l'objet reçu ; le parent, lié en deux sens, le corrige des deux côtés
const REGLAGE  = ['<button class="b" @click={$data.volume = 50}>b</button>', '<p class="e">{$data.volume}</p>'].join('\n')
const DEUXSENS = ['<vars>', '  $x  { volume: int 0..10 }', '</vars>', '', '<script>', '  $x = { volume: 5 }', '</script>', '', '<@reglage data=!{$x}></@reglage>', '<p class="p">{$x.volume}</p>'].join('\n')

const PANIER = [
  '<vars>',
  '  $$cart  { quantity: int 1..99 }',
  '</vars>',
  '',
  '<script>',
  '  $$cart = { quantity: 1 }',
  '</script>',
  '',
  '<p class="q">{$$cart.quantity}</p>',
  '<button class="trop" @click={$$cart.quantity = 500}>t</button>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('types — exécution', function () {
  this.timeout(30000)
  let window: any
  let el: any
  const avertissements: string[] = []

  before(async () => {
    const root   = mjsTmp('types-execution')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app.types.mjs'), TYPES)
    writeFileSync(join(srcDir, 'reglages.mjs'), REGLAGES)
    writeFileSync(join(srcDir, 'enfant.mjs'), ENFANT)
    writeFileSync(join(srcDir, 'parent.mjs'), PARENT)
    writeFileSync(join(srcDir, 'reglage.mjs'), REGLAGE)
    writeFileSync(join(srcDir, 'deuxsens.mjs'), DEUXSENS)
    writeFileSync(join(srcDir, 'panier.mjs'), PANIER)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.filter((f) => f.startsWith('mjs_'))
    const code  = [...coeur, ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // le mode que pose le manifeste de développement, et une console qui garde ce qu'on lui dit
    window.eval(`${code}\nglobalThis.µ = µ; µ._typesMode = 'warn';`)
    window.µ.warn = (...a: any[]) => { avertissements.push(a.join(' ')) }
    window.document.body.innerHTML = '<mjs-reglages></mjs-reglages><mjs-parent></mjs-parent><mjs-deuxsens></mjs-deuxsens><mjs-panier></mjs-panier>'
    el = window.document.body.querySelector('mjs-reglages')
    await attendre(() => !!el._shadow?.querySelector('.v'))
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const texte   = (sel: string) => el._shadow.querySelector(sel).textContent
  const cliquer = async (sel: string) => { el._shadow.querySelector(sel).click(); await new Promise((r) => setTimeout(r, 20)) }

  it('la valeur de départ passe la règle : 150 devient 100, avec un avertissement', async () => {
    assert.equal(el._state.volume, 100)
    await attendre(() => texte('.v') === '100')
    assert.equal(texte('.v'), '100')
    assert.ok(avertissements.some(a => /\$volume : 150 ramené à 100 — permis : Percent \(<mjs-reglages>\)/.test(a)), avertissements.join('\n'))
  })

  it('bouton : $volume += 20 reste à 100', async () => {
    await cliquer('.plus')
    assert.equal(el._state.volume, 100)
  })

  it('valeur refusée : $color garde « red », l’avertissement nomme la valeur et la règle', async () => {
    await cliquer('.violet')
    assert.equal(el._state.color, 'red')
    assert.equal(texte('.c'), 'red')
    assert.ok(avertissements.some(a => a.includes("$color refuse 'purple' — permis : 'red' | 'green' | 'blue'")), avertissements.join('\n'))
  })

  it('champ lié : le texte tapé devient un entier, arrondi ; hors de la plage, ramené à la sortie du champ (*guard d\'office)', async () => {
    const input = el._shadow.querySelector('.i')
    for (const [tape, attendu] of [['42', 42], ['7.6', 8], ['250', 8]] as const) {
      input.value = tape
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 20))
      assert.equal(el._state.volume, attendu, tape)
    }
    assert.equal(input.value, '250', 'le champ garde ce qu\'on tape')
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
    await attendre(() => input.value === '100')
    assert.equal(el._state.volume, 100, 'ramené à la borne à la sortie du champ')
    assert.equal(input.value, '100', 'le champ affiche la valeur ramenée')
  })

  it('fonction qui reçoit l’objet : regler($settings) est ramené à 100', async () => {
    await cliquer('.fonction')
    assert.equal(el._state.settings.volume, 100)
    await attendre(() => texte('.s') === '100')
  })

  it('clé calculée : $settings[cle] = v est contrôlée à l’écriture — ramenée, ou refusée', async () => {
    el._state.settings.volume = 50
    await cliquer('.cle')
    assert.equal(el._state.settings.volume, 100)
    await cliquer('.cle-bass')
    assert.equal(el._state.settings.bass, 0, "'x' n'est pas un entier : bass garde sa valeur")
  })

  it('méthode d’une liste : push convertit, et au-delà de 3 éléments, la liste revient en arrière', async () => {
    await cliquer('.push')
    assert.deepEqual([...el._state.tags], ['a', '7'])
    await cliquer('.push')
    await cliquer('.push')
    assert.deepEqual([...el._state.tags], ['a', '7', '7'], 'le 4e élément est refusé')
  })

  it('remplacement entier : l’objet reçu est corrigé sur place', async () => {
    await cliquer('.remplacer')
    assert.equal(el._state.settings.volume, 0)
    await attendre(() => texte('.s') === '0')
  })

  it('valeur interdite : $nick refuse « admin »', async () => {
    await cliquer('.admin')
    assert.equal(el._state.nick, 'ann')
  })

  it('prop d’un parent : valeur ramenée (9 → 5), attribut texte converti ("3" → 3)', async () => {
    const parent: any = window.document.body.querySelector('mjs-parent')
    await attendre(() => !!parent._shadow?.querySelector('.b')?._shadow?.querySelector('.l'))
    const a: any = parent._shadow.querySelector('.a')
    const b: any = parent._shadow.querySelector('.b')
    await attendre(() => a._shadow.querySelector('.l').textContent === '5')
    assert.equal(a._state.level, 5)
    assert.equal(b._state.level, 3)
  })

  it('enfant lié en deux sens : son écriture est corrigée par le parent, des deux côtés', async () => {
    const parent: any = window.document.body.querySelector('mjs-deuxsens')
    await attendre(() => !!parent._shadow?.querySelector('mjs-reglage')?._shadow?.querySelector('.b'))
    const enfant: any = parent._shadow.querySelector('mjs-reglage')
    enfant._shadow.querySelector('.b').click()
    await attendre(() => enfant._shadow.querySelector('.e').textContent === '10')
    assert.equal(parent._state.x.volume, 10)
    assert.equal(parent._shadow.querySelector('.p').textContent, '10')
    assert.equal(enfant._shadow.querySelector('.e').textContent, '10')
  })

  it('store : la règle vaut partout ; une écriture profonde est ramenée', async () => {
    const panier: any = window.document.body.querySelector('mjs-panier')
    await attendre(() => !!panier._shadow?.querySelector('.trop'))
    panier._shadow.querySelector('.trop').click()
    await attendre(() => panier._shadow.querySelector('.q').textContent === '99')
    assert.equal(window.µ.store.cart.quantity, 99)
    window.µ.store.cart = { quantity: 0 }
    assert.equal(window.µ.store.cart.quantity, 1)
  })
})

describe('types — exécution en production (fichier unique, noms internes raccourcis)', function () {
  this.timeout(60000)

  it('mêmes règles, aucun message : valeur de départ, bouton, fonction, clé calculée, liste, refus', async () => {
    const root   = mjsTmp('types-execution-prod')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app.types.mjs'), TYPES)
    writeFileSync(join(srcDir, 'reglages.mjs'), REGLAGES)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', js: 'bundle' })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const code = readFileSync(join(root, 'bundle.js'), 'utf-8')
      .replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+(?:µ|\\u00B5)\s*\};?/, 'globalThis.µ = $1;')
      .replace(/import\.meta\.url/g, "'http://localhost/'")
    assert.ok(!/_mjs_tset|_mjs_types/.test(code), 'noms internes raccourcis')
    const window: any = new Window({ url: 'http://localhost/' })
    const dits: string[] = []
    try {
      window.eval(code)
      window.µ.warn = (...a: any[]) => { dits.push(a.join(' ')) }
      window.document.body.innerHTML = '<mjs-reglages></mjs-reglages>'
      const el: any  = window.document.body.querySelector('mjs-reglages')
      const racine   = () => el.shadowRoot ?? el._shadow
      const texte    = (sel: string) => racine().querySelector(sel).textContent
      const cliquer  = async (sel: string) => { racine().querySelector(sel).click(); await new Promise((r) => setTimeout(r, 20)) }
      await attendre(() => !!racine()?.querySelector('.v') && texte('.v') === '100')
      assert.equal(texte('.v'), '100', 'valeur de départ ramenée')
      await cliquer('.plus')
      assert.equal(texte('.v'), '100')
      await cliquer('.violet')
      assert.equal(texte('.c'), 'red', 'valeur refusée')
      await cliquer('.fonction')
      await attendre(() => texte('.s') === '100')
      assert.equal(texte('.s'), '100', 'fonction qui reçoit l’objet')
      await cliquer('.remplacer')
      await attendre(() => texte('.s') === '0')
      assert.equal(texte('.s'), '0', 'remplacement entier')
      await cliquer('.cle')
      await attendre(() => texte('.s') === '100')
      assert.equal(texte('.s'), '100', 'clé calculée')
      assert.deepEqual(dits, [], 'en production, rien ne s’affiche')
    } finally {
      window.close?.()
      await terminateSharedWorkerPool()
    }
  })
})
