// Trois effets de texte et d'enfants, vus dans happy-dom :
// - un <br> du texte de la balise est un saut de ligne pour les effets : le texte lu le porte (« Ligne un\nLigne deux », pas
//   « Ligne unLigne deux »), le calque de lettres de *stagger le rend par un <br> entre les deux mots, *split le garde dans le
//   texte de ses moitiés ;
// - *stagger(unit: child) : un enfant DÉPLACÉ (une liste triée) garde sa place sans rejouer son arrivée ; un enfant ajouté
//   plus tard arrive toujours seul ;
// - *spoiler(on: hover) au doigt : rien ne survole, un toucher montre le texte et le suivant le recache ; à la souris, le
//   survol montre et la sortie recache, comme avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// les effets et leurs sections partent avec une page qui les écrit
const COMPOSANTS: Record<string, string> = {
  'texte-lettres':  '<h1 *stagger(on: load)>Titre</h1>\n<h2 *split>Titre</h2>',
  'texte-enfants':  '<ul *stagger(unit: child, on: click)><li>a</li></ul>',
  'texte-masque':   '<p *spoiler(on: hover, again: true)>Indice</p>'
}

const attendre = (ms = 25) => new Promise((r) => setTimeout(r, ms))

describe('effets de texte : le <br> du texte, l\'enfant déplacé de *stagger, *spoiler au doigt', function () {
  this.timeout(90000)
  let window: any
  let doc: any
  let µ: any

  before(async () => {
    const root   = mjsTmp('effets-lettres-saut')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    doc = window.document
    µ = window.µ
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const balise = (tag: string, html: string) => {
    const el = doc.createElement(tag)
    el.innerHTML = html
    doc.body.appendChild(el)
    return el
  }

  it('le texte lu par les effets garde le <br> comme un saut de ligne, aussi dans une balise du texte', () => {
    const el = balise('p', 'Ligne un<br>Ligne deux')
    const dedans = balise('p', '<b>Ligne un<br>Ligne deux</b> !')
    assert.equal(µ._mjs_fxOwnText(el), 'Ligne un\nLigne deux')
    assert.equal(µ._mjs_fxOwnText(dedans), 'Ligne un\nLigne deux !')
    el.remove()
    dedans.remove()
  })

  it('*stagger : le calque de lettres a quatre mots et un <br> entre « un » et « Ligne »', () => {
    const el = balise('h1', 'Ligne un<br>Ligne deux')
    const off = µ._mjs_fx(null, el, 'stagger', { on: 'load' })
    const calque = el.querySelector('[mjs-fx-layer="text"]')
    const mots = [...calque.querySelectorAll('[mjs-fx-word]')].map((m: any) => m.textContent)
    const suite = [...calque.childNodes].filter((n: any) => n.nodeType === 1).map((n: any) => n.localName === 'br' ? '<br>' : n.textContent)
    off()
    el.remove()
    assert.deepEqual(mots, ['Ligne', 'un', 'Ligne', 'deux'])
    assert.deepEqual(suite, ['Ligne', 'un', '<br>', 'Ligne', 'deux'])
  })

  it('*split : le texte de ses moitiés garde le saut de ligne', () => {
    const el = balise('h2', 'Ligne un<br>Ligne deux')
    const off = µ._mjs_fx(null, el, 'split', {})
    const texte = el.getAttribute('mjs-fx-split-text')
    off()
    el.remove()
    assert.equal(texte, 'Ligne un\nLigne deux')
  })

  // la fin de l'arrivée d'un enfant
  const fin = (cible: any) => {
    const e = new window.Event('animationend', { bubbles: true })
    e.animationName = 'mjs-fx-stagger-move'
    cible.dispatchEvent(e)
  }

  it('*stagger(unit: child) : un enfant déplacé ne rejoue pas son arrivée, un enfant ajouté arrive seul', async () => {
    const el = balise('ul', '<li>a</li><li>b</li><li>c</li><li>d</li>')
    const off = µ._mjs_fx(null, el, 'stagger', { unit: 'child', on: 'click' })
    el.click()
    for (const c of [...el.children]) fin(c)
    assert.deepEqual([...el.children].map((n: any) => n.hasAttribute('mjs-fx-child')), [false, false, false, false], 'arrivée finie')
    // un tri : le dernier passe en tête, comme le fait un {for} à clés qui réordonne
    el.insertBefore(el.lastElementChild, el.firstElementChild)
    await attendre()
    const apresTri = [...el.children].map((n: any) => n.textContent + ':' + (n.hasAttribute('mjs-fx-child') ? 'rejoue' : 'en place'))
    const neuf = doc.createElement('li')
    neuf.textContent = 'e'
    el.appendChild(neuf)
    await attendre()
    const ajoute = neuf.hasAttribute('mjs-fx-child')
    off()
    el.remove()
    assert.deepEqual(apresTri, ['d:en place', 'a:en place', 'b:en place', 'c:en place'])
    assert.ok(ajoute, 'l\'enfant ajouté arrive')
  })

  it('*spoiler(on: hover) : au doigt, un toucher montre le texte, le suivant le recache ; à la souris, comme avant', () => {
    const el = balise('p', 'Indice secret')
    const off = µ._mjs_fx(null, el, 'spoiler', { on: 'hover' })
    const cache = () => el.hasAttribute('mjs-fx-spoiler-hidden')
    // la suite qu'un navigateur émet pour un toucher : pointerleave suit pointerup (un doigt ne survole pas), puis le clic
    const toucher = () => {
      const ev = (t: string) => new window.PointerEvent(t, { pointerType: 'touch', bubbles: t !== 'pointerenter' && t !== 'pointerleave' })
      for (const t of ['pointerover', 'pointerenter', 'pointerdown', 'pointerup', 'pointerout', 'pointerleave']) el.dispatchEvent(ev(t))
      el.dispatchEvent(new window.PointerEvent('click', { pointerType: 'touch', bubbles: true, detail: 1 }))
    }
    const vu: string[] = [cache() ? 'caché' : 'visible']
    toucher()
    vu.push(cache() ? 'caché' : 'visible')
    toucher()
    vu.push(cache() ? 'caché' : 'visible')
    const souris = (t: string) => el.dispatchEvent(new window.PointerEvent(t, { pointerType: 'mouse' }))
    souris('pointerenter')
    vu.push(cache() ? 'caché' : 'visible')
    souris('pointerleave')
    vu.push(cache() ? 'caché' : 'visible')
    off()
    el.remove()
    assert.deepEqual(vu, ['caché', 'visible', 'caché', 'visible', 'caché'])
  })
})
