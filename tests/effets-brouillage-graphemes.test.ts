// `*scramble` remet en place des caractères perçus : à la fin d'un brouillage, chaque lettre du calque
// retrouve SON caractère — un drapeau, un emoji à teinte de peau, une lettre suivie de son accent
// décomposé restent entiers et à leur place, comme les lettres du calque. La durée d'un jeu (qu'une
// sortie `@out=*scramble` attend) compte aussi les caractères perçus, pas les unités du texte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const DRAPEAU   = '\u{1F1EB}\u{1F1F7}'
const TEINTE    = '\u{1F44D}\u{1F3FD}'
const DECOMPOSE = 'é'
// une espace suivie d'un signe combinant (l'accent aigu seul) : le calque les sépare, comme le fait son découpage par mots
const ESPACE_ACCENT = 'a \u0301b'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*scramble : des caractères perçus remis à leur place', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-brouillage-graphemes')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-brouille.mjs'), `<p class="t" *scramble(on: load, speed: 10)>${DRAPEAU} ${TEINTE} ${DECOMPOSE}cole</p>`)
    writeFileSync(join(srcDir, 'fx-brouille-espace.mjs'), `<p class="u" *scramble(on: load, speed: 10)>${ESPACE_ACCENT}</p>`)
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

  it('à la fin du brouillage, chaque lettre du calque porte son caractère perçu, à sa place', async () => {
    window.document.body.innerHTML = '<mjs-fx-brouille></mjs-fx-brouille>'
    const comp = window.document.querySelector('mjs-fx-brouille')
    await attendre(() => !!comp._shadow?.querySelector('.t [mjs-fx-letter]'))
    const lues    = () => Array.from(comp._shadow.querySelectorAll('.t [mjs-fx-letter]')).map((l: any) => l.textContent)
    const attendu = [DRAPEAU, TEINTE, DECOMPOSE, 'c', 'o', 'l', 'e']
    // le brouillage a commencé (une lettre a changé), puis il a eu le temps de finir (9 pas de 10 ms)
    await attendre(() => JSON.stringify(lues()) !== JSON.stringify(attendu), 2000)
    assert.notDeepEqual(lues(), attendu, 'le brouillage a commencé')
    await new Promise((r) => setTimeout(r, 600))
    assert.deepEqual(lues(), attendu)
  })

  it('une espace suivie d\'un signe combinant : le brouillage remet autant de caractères que le calque a de lettres, chacun à sa place', async () => {
    window.document.body.innerHTML = '<mjs-fx-brouille-espace></mjs-fx-brouille-espace>'
    const comp = window.document.querySelector('mjs-fx-brouille-espace')
    await attendre(() => !!comp._shadow?.querySelector('.u [mjs-fx-letter]'))
    const lues    = () => Array.from(comp._shadow.querySelectorAll('.u [mjs-fx-letter]')).map((l: any) => l.textContent)
    const attendu = ['a', '\u0301', 'b']
    assert.equal(lues().length, 3, 'trois lettres au calque : a, le signe, b')
    await attendre(() => JSON.stringify(lues()) !== JSON.stringify(attendu), 2000)
    assert.notDeepEqual(lues(), attendu, 'le brouillage a commencé')
    await new Promise((r) => setTimeout(r, 600))
    assert.deepEqual(lues(), attendu)
  })

  it('la durée d\'un jeu compte les lettres du calque : une espace suivie d\'un signe combinant n\'en change pas le compte', () => {
    const p = window.document.createElement('p')
    p.textContent = ESPACE_ACCENT
    window.document.body.appendChild(p)
    // 3 lettres (a, le signe, b), plus 2 pas, à 10 ms
    assert.equal(window.µ._mjs_fxDefs.scramble.span(p, { speed: 10 }), (3 + 2) * 10)
    p.remove()
  })

  it('la durée d\'un jeu compte les caractères perçus du texte', () => {
    const p = window.document.createElement('p')
    p.textContent = `${DRAPEAU} ${TEINTE} ${DECOMPOSE}cole`
    window.document.body.appendChild(p)
    // 7 caractères perçus hors espaces, plus 2 pas, à 10 ms
    assert.equal(window.µ._mjs_fxDefs.scramble.span(p, { speed: 10 }), (7 + 2) * 10)
    p.remove()
  })
})
