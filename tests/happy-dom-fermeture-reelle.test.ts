// close() d'une fenêtre happy-dom faite par `new Window()` dans un test : la fermeture est réelle. happy-dom seul n'y
// fait rien (il ne ferme que les fenêtres ouvertes par window.open()), et la fenêtre « fermée » tournait jusqu'à la fin
// du processus : 31 tours de minuterie et 128 391 images en 200 ms mesurés après close(). C'est l'aide
// tests/helpers/happy-dom-fermeture.ts, chargée par tout run, qui la rend réelle.

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('fenêtre happy-dom fermée par un test', () => {
  it('close() coupe minuteries et boucles d\'images, et closed vaut true dès le retour', async () => {
    const win: any = new Window({ url: 'http://localhost/' })
    let ticks  = 0
    let frames = 0
    win.setInterval(() => { ticks++ }, 5)
    const loop = () => { frames++; win.requestAnimationFrame(loop) }
    win.requestAnimationFrame(loop)
    await pause(40)
    assert.ok(ticks > 0 && frames > 0, `la fenêtre tournait avant close() (tours : ${ticks}, images : ${frames})`)
    win.close()
    assert.equal(win.closed, true, 'closed vaut true dès le retour de close()')
    const ticksAtClose  = ticks
    const framesAtClose = frames
    await pause(150)
    assert.equal(ticks - ticksAtClose, 0, 'plus un tour de minuterie après close()')
    assert.equal(frames - framesAtClose, 0, 'plus une image après close()')
  })

  it('un second close() ne fait rien et ne lève rien', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    win.close()
    win.close()
    assert.equal(win.closed, true)
  })
})
