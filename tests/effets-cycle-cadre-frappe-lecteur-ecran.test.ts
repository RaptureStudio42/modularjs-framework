// *cycle, l'effet des mots qui se relaient, porte aussi le cadre lumineux (style frame) et la machine
// à écrire (style type), avec leurs réglages (color, delay, cursor, outside) ; *cycle.frame et
// *cycle.typewriter les règlent tout prêts. Un lecteur d'écran entend tous les mots, pas seulement
// celui écrit dans la balise (le calque qui les montre lui est caché). L'ancien nom *typing arrête le
// build et dit quoi écrire à la place ; la transition *typewriter reste un autre effet, intact.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// les composants compilés en un seul script, ou les erreurs du build
async function construire(nom: string, composants: Record<string, string>) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, src] of Object.entries(composants)) writeFileSync(join(srcDir, n + '.mjs'), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  const erreurs = stats.errors.map((e: any) => String(e.message))
  if (erreurs.length > 0) return { code: '', erreurs }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  return { code, erreurs }
}

function fenetre(code: string) {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

async function monter(window: any, tag: string, sel: string) {
  window.document.body.innerHTML = `<${tag}></${tag}>`
  const comp = window.document.querySelector(tag)
  await attendre(() => !!comp._shadow?.querySelector(sel))
  await new Promise((r) => setTimeout(r, 20))
  return comp._shadow.querySelector(sel)
}

// ce qu'un lecteur d'écran lit d'une balise : son texte, hors de ce qui lui est caché (aria-hidden)
function lu(el: any): string {
  let t = ''
  for (const c of el.childNodes) {
    if (c.nodeType === 3) t += c.textContent
    else if (c.nodeType === 1 && c.getAttribute('aria-hidden') !== 'true') t += lu(c)
  }
  return t.replace(/\s+/g, ' ').trim()
}

after(async () => { await terminateSharedWorkerPool() })

describe('*cycle — un lecteur d\'écran entend tous les mots, pas seulement celui de la balise', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const b = await construire('effets-cycle-lecteur-ecran', {
      'fx-relais':  '<h2>Nous créons des <span class="c" *cycle([applis, logos])>sites</span></h2>',
      'fx-sansmot': '<p><span class="v" *cycle(words: [Un, Deux], style: fade)></span></p>',
    })
    assert.deepEqual(b.erreurs, [])
    window = fenetre(b.code)
  })

  after(() => { window?.close?.() })

  it('les mots donnés suivent celui de la balise, dans un texte que seul le lecteur d\'écran lit', async () => {
    const c = await monter(window, 'mjs-fx-relais', '.c')
    assert.equal(lu(c.parentNode), 'Nous créons des sites, applis, logos')
    const dit = c.querySelector('[mjs-fx-layer="words"]')
    assert.ok(dit, 'le texte dit est un calque de l\'effet : le texte propre de la balise reste « sites »')
    assert.equal(dit.getAttribute('aria-hidden'), null)
  })

  it('sans mot dans la balise : tous les mots donnés', async () => {
    const v = await monter(window, 'mjs-fx-sansmot', '.v')
    assert.equal(lu(v), 'Un, Deux')
  })

  it('la balise réécrite (textContent, puis innerHTML +=) : les mots dits suivent, jamais en double', async () => {
    const c = await monter(window, 'mjs-fx-relais', '.c')
    c.textContent = 'apps'
    await attendre(() => lu(c) === 'apps, applis, logos')
    assert.equal(lu(c), 'apps, applis, logos')
    assert.equal(c.lastElementChild.getAttribute('mjs-fx-layer'), 'text', 'le calque de texte reste le dernier enfant de la balise')
    c.innerHTML += ''
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(lu(c), 'apps, applis, logos')
    assert.equal(c.querySelectorAll('[mjs-fx-layer="words"]').length, 1)
  })

  it('l\'effet retiré emporte son texte dit', async () => {
    const c = await monter(window, 'mjs-fx-relais', '.c')
    window.µ._mjs_fxClear(c)
    assertAbsent(c.querySelector('[mjs-fx-layer="words"]'))
    assert.equal(lu(c), 'sites')
  })
})

describe('*cycle — le cadre lumineux (frame) et la machine à écrire (type)', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const b = await construire('effets-cycle-cadre-frappe', {
      'fx-frappe':  '<h2>Je suis <span class="t" *cycle.typewriter([Coder., Designer.])>Youtuber.</span></h2>',
      'fx-cadre':   '<h2>Je suis <span class="f" *cycle.frame([Coder.], outside: hollow, color: #f0f)>Youtuber.</span></h2>',
      'fx-pause':   '<p><span class="p" *cycle([B], style: type, speed: 300ms, delay: 250ms, cursor: false)>A</span></p>',
    })
    assert.deepEqual(b.erreurs, [])
    window = fenetre(b.code)
  })

  after(() => { window?.close?.() })

  it('*cycle.typewriter : les mots tapés lettre à lettre avec leur curseur, après la ligne vide de delay (3 s par mot, comme avant)', async () => {
    const t = await monter(window, 'mjs-fx-frappe', '.t')
    assert.equal(t.getAttribute('mjs-fx-cycle-style'), 'type')
    assert.equal(t.style.getPropertyValue('--mjs-cycle-speed'), '3s')
    assert.ok(t.querySelector('[mjs-fx-cycle-word] [mjs-fx-cycle-caret]'), 'le curseur')
    const mot = () => t.querySelector('[mjs-fx-cycle-word]')?.firstChild?.textContent ?? ''
    assert.equal(mot(), '', 'la ligne vide de delay (500 ms)')
    await attendre(() => mot().length > 0, 2000)
    assert.ok(mot().length > 0 && 'Youtuber.'.startsWith(mot()), `le mot se tape depuis son début : « ${mot()} »`)
    assert.equal(lu(t.parentNode), 'Je suis Youtuber., Coder., Designer.')
  })

  it('*cycle.frame : le mot en creux qu\'un cadre lumineux ouvre ; color et outside comptent', async () => {
    const f = await monter(window, 'mjs-fx-cadre', '.f')
    assert.equal(f.getAttribute('mjs-fx-cycle-style'), 'frame')
    assert.equal(f.getAttribute('mjs-fx-cycle-outside'), 'hollow')
    assert.equal(f.style.getPropertyValue('--mjs-cycle-color'), '#f0f')
    assert.equal(f.style.getPropertyValue('--mjs-cycle-speed'), '3s')
    const mot = f.querySelector('[mjs-fx-cycle-word]')
    assert.equal(mot.firstChild.textContent, 'Youtuber.')
    assert.equal(mot.querySelector('[mjs-fx-cycle-fill] [mjs-fx-cycle-ink]')?.textContent, 'Youtuber.', 'le cadre porte le mot plein')
    assert.equal(lu(f.parentNode), 'Je suis Youtuber., Coder.')
  })

  it('style: type réglé à la main : delay (la ligne vide), speed (le mot), cursor: false (sans curseur)', async () => {
    const p = await monter(window, 'mjs-fx-pause', '.p')
    assert.equal(p.style.getPropertyValue('--mjs-cycle-delay'), '250ms')
    assertAbsent(p.querySelector('[mjs-fx-cycle-caret]'))
    const mot = () => p.querySelector('[mjs-fx-cycle-word]')?.firstChild?.textContent ?? ''
    // un mot dure delay + speed = 550 ms : A, puis B
    await attendre(() => mot() === 'A', 1000)
    assert.equal(mot(), 'A')
    await attendre(() => mot() === 'B', 1500)
    assert.equal(mot(), 'B')
  })

  it('la transition *typewriter reste un autre effet : posée avec *cycle.typewriter dans le même composant, sans erreur', async () => {
    assert.equal(EFFECTS.typewriter?.family, 'transition')
    const b = await construire('effets-cycle-machine-transition', { 'fx-deux': '<p *typewriter(on: load)>Bonjour</p>\n<p><span *cycle.typewriter([B])>A</span></p>' })
    assert.deepEqual(b.erreurs, [])
    assert.deepEqual(parseEffect('cycle', '[B], style: frame, color: #f0f, delay: 200ms, cursor: false, outside: visible').fixed, { words: ['B'], style: 'frame', color: '#f0f', delay: '200ms', cursor: false, outside: 'visible' })
  })
})

describe('*typing n\'existe plus : le build dit quoi écrire à la place', function () {
  this.timeout(60000)

  it('plus dans le catalogue', () => {
    assert.equal(EFFECTS.typing, undefined)
  })

  for (const [ecrit, reglages, attendu] of [['typing', '', '*cycle.frame'], ['typing', '[Coder.], style: type, speed: 2s', '*cycle.typewriter(words: [Coder.], speed: 2s)'], ['typing.typewriter', '', '*cycle.typewriter']]) {
    it(`*${ecrit}${reglages ? `(${reglages})` : ''} : l'erreur donne ${attendu}, et dit où est la machine à écrire`, () => {
      assert.throws(() => parseEffect(ecrit, reglages), (e: any) => /n'existe plus/.test(e.message) && e.message.includes('écrivez ' + attendu) && /style: type → \*cycle\.typewriter/.test(e.message))
    })
  }

  it('dans un composant : le build s\'arrête sur ce message', async () => {
    const b = await construire('effets-typing-retire', { 'fx-ancien': '<span *typing([Coder.])>Youtuber.</span>' })
    assert.ok(b.erreurs.length > 0, 'une erreur de build')
    assert.match(b.erreurs.join('\n'), /\*typing.*n'existe plus.*écrivez \*cycle\.frame\(words: \[Coder\.\]\).*style: type → \*cycle\.typewriter/s)
  })
})
