// Effets — les réglages communs et ceux de chaque effet, sur de vrais composants chargés dans
// happy-dom : le brouillage rend toujours le vrai texte (même relancé en plein brouillage), le
// compteur écrit ses séparateurs, l'arc-en-ciel prend ses couleurs, les mots de *cycle se lisent
// dans l'ordre, le loader dessine son style, `where`/`direction`/`on` se traduisent en attributs
// propres à chaque effet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-brouille': '<p class="s" *scramble(on: hover, speed: 10)>SCRAMBLE ça</p>',
  'fx-compte':   '<span class="c" *count(0s, on: load, separator: ".", decimal: ",", prefix: "€ ")>12480.5</span>',
  'fx-arc':      '<h2 class="r" *rainbow([red, blue], animate: false)>ABCD</h2>',
  'fx-mots':     '<h2>Je suis <span class="t" *cycle.frame([Coder., Designer.], on: click)>Youtuber.</span></h2>',
  'fx-charge':   '<span class="l" *loader(bloom, size: 62)></span>\n<span class="d" *loader></span>',
  'fx-mots-var': '<script>\n$liste = ["Un", "Deux"]\n</script>\n<span class="t" *cycle.frame($liste)>Zéro</span>',
  'fx-mots-pause': '<h2>Je suis <span class="t" *cycle.frame([B], speed: 300ms, delay: 250ms)>A</span></h2>',
  'fx-mots-creux': '<h2><span class="t" *cycle.frame([B], outside: hollow)>A</span> <span class="u" *cycle.frame([B])>A</span> <span class="v" *cycle.frame([B], outside: visible)>A</span></h2>',
  'fx-attrs':    '<button class="p" *pulse(where: text, direction: in)>P</button>\n<p class="n" *neon(where: both, on: hover)>N</p>\n<p class="f" *float(direction: left)>F</p>\n<p class="g" *gradient(direction: down)>G</p>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pointeur = (el: any, type: string) => el.dispatchEvent(new el.ownerDocument.defaultView.PointerEvent(type, { bubbles: true }))

describe('effets — réglages', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-reglages')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await new Promise((r) => setTimeout(r, 20))
    return comp._shadow.querySelector(sel)
  }

  const lettres = (el: any) => [...el.querySelectorAll('[mjs-fx-letter]')].map((l: any) => l.textContent).join('')

  it('*scramble relancé en plein brouillage : chaque lettre revient à la vraie, jamais un caractère tiré', async () => {
    const s = await monter('mjs-fx-brouille', '.s')
    pointeur(s, 'pointerenter')
    await new Promise((r) => setTimeout(r, 35))
    pointeur(s, 'pointerenter')
    await attendre(() => lettres(s) === 'SCRAMBLEça', 3000)
    assert.equal(lettres(s), 'SCRAMBLEça')
  })

  it('*count : séparateurs des milliers et des décimales choisis, préfixe', async () => {
    const c = await monter('mjs-fx-compte', '.c')
    const calque = () => c.querySelector('[mjs-fx-layer="text"]')?.textContent
    await attendre(() => calque() === '€ 12.480,5')
    assert.equal(calque(), '€ 12.480,5')
  })

  it('*rainbow : chaque lettre prend une couleur de la liste, dans l\'ordre', async () => {
    const r = await monter('mjs-fx-arc', '.r')
    const couleurs = [...r.querySelectorAll('[mjs-fx-letter]')].map((l: any) => l.style.getPropertyValue('color'))
    assert.deepEqual(couleurs, ['red', 'blue', 'red', 'blue'])
  })

  it('*cycle : le texte de la balise d\'abord, puis les mots donnés entre crochets', async () => {
    const t = await monter('mjs-fx-mots', '.t')
    // le mot lui-même : le premier nœud (le calque qui balaie le mot en porte une copie)
    const mot = () => t.querySelector('[mjs-fx-cycle-word]')?.firstChild?.textContent
    assert.equal(mot(), 'Youtuber.')
    assert.deepEqual(parseEffect('cycle', "[Coder., 'Designer, web.']").fixed, { words: ['Coder.', 'Designer, web.'] })
  })

  it('*cycle : une liste tenue par une variable', async () => {
    const t = await monter('mjs-fx-mots-var', '.t')
    assert.deepEqual(Array.from(t._mjs_fxOff.cycle._s.words), ['Un', 'Deux'])
  })

  it('*cycle : `delay` = le temps où le cadre reste fermé avant chaque mot — un mot dure speed + delay', async () => {
    const t = await monter('mjs-fx-mots-pause', '.t')
    const mot = () => t.querySelector('[mjs-fx-cycle-word]')?.firstChild?.textContent
    assert.equal(t.style.getPropertyValue('--mjs-cycle-delay'), '250ms')
    await new Promise((r) => setTimeout(r, 380))
    assert.equal(mot(), 'A', 'à 380 ms le premier mot est encore là (300 + 250 ms)')
    await attendre(() => mot() === 'B', 1000)
    assert.equal(mot(), 'B')
  })

  it('*cycle (cadre) : `outside` — hors du cadre, le mot ne se voit pas (hidden), en creux comme la démo (hollow), ou plein (visible)', async () => {
    const t = await monter('mjs-fx-mots-creux', '.t')
    const u = t.getRootNode().querySelector('.u')
    const v = t.getRootNode().querySelector('.v')
    assert.equal(t.getAttribute('mjs-fx-cycle-outside'), 'hollow', 'outside: hollow — le mot en creux')
    assert.equal(u.getAttribute('mjs-fx-cycle-outside'), null, 'sans réglage : hidden, rien hors du cadre')
    assert.equal(v.getAttribute('mjs-fx-cycle-outside'), 'visible', 'outside: visible — le mot plein')
    const css = window.µ._mjs_fxDefs.cycle.css.split('}')
    // le contour du mot (hors du cadre) n'existe qu'en creux
    const contour = css.filter((r: string) => /text-stroke:1px/.test(r))
    assert.ok(contour.length > 0)
    for (const r of contour) assert.match(r, /\[mjs-fx-cycle-outside="hollow"\]/, `contour posé hors de hollow : ${r}`)
    // visible : le mot garde la couleur de son texte, le cadre passe dessus
    assert.ok(css.some((r: string) => /\[mjs-fx-cycle-outside="visible"\]/.test(r) && /text-fill-color:currentColor/.test(r)), 'visible : le mot plein hors du cadre')
  })

  it('*cycle : `hollow` n\'est plus un réglage (remplacé par outside: hollow)', () => {
    assert.throws(() => parseEffect('cycle', '[B], hollow: true'), /hollow/)
    assert.deepEqual(parseEffect('cycle', '[B], outside: visible').fixed, { words: ['B'], outside: 'visible' })
  })

  it('*loader : le style dessiné à sa taille d\'origine puis réduit ; dots par défaut', async () => {
    const l = await monter('mjs-fx-charge', '.l')
    const calque = l.querySelector('[mjs-fx-layer="loader"]')
    assert.equal(calque.getAttribute('mjs-fx-loader-style'), 'bloom')
    assert.equal(calque.style.width, '62px')
    assert.equal(calque.querySelectorAll('[mjs-fx-p="sq"]').length, 80)
    assert.match(calque.querySelector('[mjs-fx-loader-box]').style.transform, /scale\(0\.1\d*\)/)
    const d = l.getRootNode().querySelector('.d [mjs-fx-layer="loader"]')
    assert.equal(d.getAttribute('mjs-fx-loader-style'), 'dots')
    assert.equal(d.querySelectorAll('[mjs-fx-p="arm"]').length, 20)
  })

  it('where, direction, on : un attribut propre à chaque effet, jamais partagé', async () => {
    const p = await monter('mjs-fx-attrs', '.p')
    const root = p.getRootNode()
    assert.equal(p.getAttribute('mjs-fx-pulse-where'), 'text')
    assert.equal(p.style.getPropertyValue('--mjs-fx-pulse-dir'), 'reverse')
    const n = root.querySelector('.n')
    assert.equal(n.getAttribute('mjs-fx-neon-where'), 'both')
    assert.equal(n.getAttribute('mjs-fx-on'), null, 'on: hover — éteint au repos')
    pointeur(n, 'pointerenter')
    assert.equal(n.getAttribute('mjs-fx-on'), 'neon')
    assert.equal(root.querySelector('.f').style.getPropertyValue('--mjs-fx-float-x'), '-1')
    const g = root.querySelector('.g')
    assert.match(g.style.getPropertyValue('--mjs-fx-gradient'), /^linear-gradient\(180deg,/)
  })
})
