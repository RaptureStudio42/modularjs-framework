// `µplay(nœud, classe)` dans un vrai navigateur (Chromium) : la promesse attend la vraie fin de l'animation posée
// par la classe, et rend la main tout de suite quand il n'y a rien à jouer. Défauts garantis absents : une
// animation de plus de 2 s était coupée net à 2 s (classe retirée en pleine animation, l'élément sautait à son
// état final, promesse résolue trop tôt) ; et avec « réduire les animations » (le CSS du site met
// `animation: none`), `await µplay(…)` faisait attendre 2 s pour rien tout ce qui suivait.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI  = dirname(fileURLToPath(import.meta.url))
const PLAY = readFileSync(join(ICI, '../src/runtime/mjs_play.ts'), 'utf-8')

const PAGE = `<style>
  @keyframes tourne { from { transform: rotate(0) } to { transform: rotate(360deg) } }
  .long { animation: tourne 3s linear }
  .court { animation: tourne 300ms linear }
  .retard { animation: tourne 200ms linear 2.2s }
  @media (prefers-reduced-motion: reduce) { .long, .court { animation: none } }
</style><div id="a">a</div><div id="b">b</div><div id="c">c</div><div id="d">d</div>`

describe('µplay — durée réelle de l’animation, mouvement réduit (Chromium)', function () {
  this.timeout(60000)
  let nav: any

  before(async function () {
    const { chromium } = await import('playwright')
    if (!existsSync(chromium.executablePath())) this.skip()
    nav = await chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => { if (nav) await nav.close() })

  async function jouer(reduit: boolean): Promise<any> {
    const ctx  = await nav.newContext({ reducedMotion: reduit ? 'reduce' : 'no-preference' })
    const page = await ctx.newPage()
    try {
      await page.setContent(PAGE)
      await page.addScriptTag({ content: 'window.µ = {};\n' + PLAY })
      return await page.evaluate(async () => {
        const w: any = window
        const t0 = performance.now()
        const fin = (p: Promise<void>) => p.then(() => Math.round(performance.now() - t0))
        let classeLongueA2100: any = null
        setTimeout(() => { classeLongueA2100 = document.getElementById('a')!.classList.contains('long') }, 2100)
        const [long, court, sansAnimation, retard] = await Promise.all([
          fin(w.µ.play(document.getElementById('a'), 'long')),
          fin(w.µ.play(document.getElementById('b'), 'court')),
          fin(w.µ.play(document.getElementById('c'), 'sans-keyframes')),
          fin(w.µ.play(document.getElementById('d'), 'retard')),
        ])
        return { long, court, sansAnimation, retard, classeLongueA2100, classeRetiree: !document.getElementById('a')!.classList.contains('long') }
      })
    }
    finally {
      await ctx.close()
    }
  }

  it('animation de 3 s : la promesse attend sa fin, la classe reste posée jusque-là', async () => {
    const r = await jouer(false)
    assert.equal(r.classeLongueA2100, true, 'à 2,1 s, l’animation de 3 s joue encore : sa classe est toujours posée')
    assert.ok(r.long >= 2900, `résolue à la fin de l’animation, pas coupée à 2 s (${r.long} ms)`)
    assert.ok(r.retard >= 2300, `le délai de l’animation compte dans l’attente (${r.retard} ms)`)
    assert.ok(r.court >= 250 && r.court < 1500, `une animation courte se résout à sa fin (${r.court} ms)`)
    assert.ok(r.sansAnimation < 200, `une classe sans animation rend la main tout de suite (${r.sansAnimation} ms)`)
    assert.equal(r.classeRetiree, true, 'la classe est retirée à la fin')
  })

  it('mouvement réduit (animation: none) : la promesse se résout tout de suite', async () => {
    const r = await jouer(true)
    assert.ok(r.court < 200, `rien à jouer : aucune attente (${r.court} ms)`)
    assert.ok(r.long < 200, `rien à jouer : aucune attente (${r.long} ms)`)
  })
})
