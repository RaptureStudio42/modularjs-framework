// Effets de texte — ce qu'ils lisent et laissent dans la balise reste fidèle à son texte : *cycle
// (machine à écrire) garde le même curseur, qui clignote, et ne réécrit rien tant qu'aucune lettre ne
// change ; *scramble annonce la durée de SON texte (pas celle des calques des autres effets), tire des
// caractères entiers (un emoji n'est pas coupé en deux), et rend les vraies lettres quand il est retiré
// en plein brouillage d'un calque que garde un autre effet ; *split recopie le texte de la balise, pas
// celui des calques posés dessus. Vrais composants, chargés dans happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-frappe-curseur':  '<span class="t" *cycle(style: type, speed: 3s, delay: 0s)>Alpha</span>',
  'fx-brouille-duree':  '<p class="s" *scramble(on: click)>Bonjour le monde</p>',
  'fx-brouille-emoji':  '<p class="s" *scramble(chars: "🎲🎯", on: load, speed: 30)>Bonjour</p>',
  'fx-brouille-retire': '<script>\n$v = 400\n</script>\n<p class="s" *scramble(on: hover, speed: $v) *rainbow(animate: false)>Bonjour</p>\n<button class="b" @click={$v = 300}>b</button>',
  'fx-moities-arc':     '<p class="m" *split *rainbow(animate: false)>Bonjour</p>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('effets de texte — fidèles au texte de la balise', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-texte-fidele')
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
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
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
    await pause(20)
    return comp._shadow.querySelector(sel)
  }

  const lettres = (el: any) => [...el.querySelectorAll('[mjs-fx-letter]')].map((l: any) => l.textContent)

  it('*cycle(style: type) : le mot entier affiché, le curseur reste le même nœud (il clignote) et rien n\'est réécrit', async () => {
    const t = await monter('mjs-fx-frappe-curseur', '.t')
    const mot = () => t.querySelector('[mjs-fx-cycle-word]')?.textContent
    await attendre(() => mot() === 'Alpha', 2500)
    assert.equal(mot(), 'Alpha', 'le mot est tapé en entier')
    const curseur = t.querySelector('[mjs-fx-cycle-caret]')
    let ecritures = 0
    const mo = new window.MutationObserver((l: any[]) => { ecritures += l.length })
    mo.observe(t, { subtree: true, childList: true, characterData: true })
    await pause(400)
    mo.disconnect()
    assert.equal(curseur === t.querySelector('[mjs-fx-cycle-caret]'), true, 'le même curseur, pas un nouveau toutes les 40 ms')
    assert.equal(ecritures, 0, 'aucune réécriture tant que le nombre de lettres ne change pas')
  })

  it('*scramble : la durée annoncée (celle qu\'une sortie `@out=*scramble` attend) compte le texte de la balise, pas les lettres de son calque', async () => {
    const s = await monter('mjs-fx-brouille-duree', '.s')
    assert.ok(s.querySelector('[mjs-fx-layer="text"]'), 'le calque de lettres est posé')
    // 14 lettres hors espaces, plus deux pas, à 40 ms le pas
    assert.equal(window.µ._mjs_fxDefs.scramble.span(s, {}), 640)
  })

  it('*scramble(chars: "🎲🎯") : les caractères tirés sont entiers — jamais une moitié d\'emoji', async () => {
    const s = await monter('mjs-fx-brouille-emoji', '.s')
    const vus = new Set<string>()
    for (let i = 0; i < 20; i++) {
      for (const l of lettres(s)) vus.add(l)
      await pause(10)
    }
    const coupes = [...vus].filter((c) => /^[\uD800-\uDFFF]$/.test(c))
    assert.ok([...vus].some((c) => c === '🎲' || c === '🎯'), `des emoji tirés : ${[...vus].join(' ')}`)
    assert.deepEqual(coupes.map((c) => c.charCodeAt(0).toString(16)), [], 'aucune moitié d\'emoji')
  })

  it('*scramble retiré en plein brouillage (relancé par une variable) sur un calque que garde *rainbow : les vraies lettres reviennent', async () => {
    const s = await monter('mjs-fx-brouille-retire', '.s')
    assert.equal(lettres(s).join(''), 'Bonjour')
    s.dispatchEvent(new window.PointerEvent('pointerenter', { bubbles: false }))
    await pause(450)
    assert.notEqual(lettres(s).join(''), 'Bonjour', 'en plein brouillage')
    s.getRootNode().querySelector('.b').click()
    await pause(50)
    assert.equal(lettres(s).join(''), 'Bonjour', 'le brouillage coupé rend le vrai texte')
  })

  it('*split avec un effet de lettres sur la même balise : les moitiés recopient le texte de la balise, pas le calque de lettres', async () => {
    const m = await monter('mjs-fx-moities-arc', '.m')
    assert.ok(m.querySelector('[mjs-fx-layer="text"]'), 'le calque de *rainbow est posé')
    await pause(20)
    assert.equal(m.getAttribute('mjs-fx-split-text'), 'Bonjour')
  })
})
