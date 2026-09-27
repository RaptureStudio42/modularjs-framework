// Régression — `µ.play(node, classe)` retire puis repose une classe CSS et
// attend `animationend`/`animationcancel` pour résoudre sa promesse. Si la
// classe ne déclenche AUCUNE animation (mouvement réduit désactivé par média
// query, classe sans `@keyframes` associée, faute de frappe sur le nom), ces
// events ne partent JAMAIS : la promesse restait pendante pour toujours.
//
// Fix : un délai de repli (même doctrine que le filet setTimeout du pipeline
// de transitions central, cf. mjs_vt_presets.ts _mjs_vtCurtainRun) force la
// résolution après un délai borné, sans attendre indéfiniment un event qui
// peut ne jamais partir.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadRareRunes(win: any) {
  const initSrc = readFileSync(join(__dirname, '../src/runtime/mjs_init.ts'), 'utf-8')
    .replace(/export\s*\{[^}]*\}/, '')
  const rareRunesSrc = readFileSync(join(__dirname, '../src/runtime/mjs_rare_runes.ts'), 'utf-8')
  const sandbox = `
    ${initSrc}
    ${rareRunesSrc}
    return µ;
  `
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', sandbox)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet,
  )
}

describe('µ.play — délai de repli quand l\'animation ne démarre jamais', function () {
  this.timeout(15000)

  it('classe sans animation associée : la promesse reste pendante un moment PUIS se résout par le filet', async () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const µ: any = loadRareRunes(win)
    const node = win.document.createElement('div')
    win.document.body.appendChild(node)

    let settled = false
    const played = µ.play(node, 'anim-sans-keyframes').then(() => { settled = true })

    await new Promise((r) => setTimeout(r, 300))
    assert.equal(settled, false, 'sanity : sans animationend/animationcancel, rien ne doit résoudre avant le filet')

    await played
    assert.equal(settled, true, 'AVANT le fix : la promesse ne se terminait JAMAIS sans event')
    assert.equal(node.classList.contains('anim-sans-keyframes'), false, 'le filet doit nettoyer la classe, comme un animationend normal')

    win.close?.()
  })

  it('animationend normal : résout SANS attendre le filet (témoin de non-régression)', async () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const µ: any = loadRareRunes(win)
    const node = win.document.createElement('div')
    win.document.body.appendChild(node)

    const t0 = Date.now()
    const played = µ.play(node, 'anim-ok').then(() => Date.now() - t0)

    await new Promise((r) => setTimeout(r, 20))
    node.dispatchEvent(new win.Event('animationend'))

    const elapsed = await played
    assert.ok(elapsed < 500, `doit résoudre bien avant le filet de repli (résolu en ${elapsed}ms)`)
    assert.equal(node.classList.contains('anim-ok'), false)

    win.close?.()
  })
})
