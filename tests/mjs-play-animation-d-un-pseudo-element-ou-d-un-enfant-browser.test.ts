// `µplay(nœud, classe)` dans un vrai navigateur (Chromium) quand l'animation lancée par la classe est portée par
// un pseudo-élément (`.classe::after { animation: … }`, le cas courant d'un « shake » ou d'une onde) ou par un
// enfant (`.classe .icone { animation: … }`) : la classe reste posée le temps de l'animation et la promesse se
// résout à sa fin. Défaut garanti absent : la classe était retirée 1 ms après sa pose, l'animation ne jouait
// jamais. Une animation déjà en cours dans un enfant (un indicateur qui tourne sans fin) ne fait pas attendre ;
// le nœud et son pseudo-élément animés ensemble : la promesse attend la plus longue des deux.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI  = dirname(fileURLToPath(import.meta.url))
const PLAY = readFileSync(join(ICI, '../src/runtime/mjs_play.ts'), 'utf-8')

const PAGE = `<style>
  @keyframes secoue { from { transform: translateX(0) } to { transform: translateX(20px) } }
  .pseudo::after { content: '!'; display: inline-block; animation: secoue 600ms linear }
  .parent .enfant { display: inline-block; animation: secoue 600ms linear }
  .propre { animation: secoue 600ms linear }
  .bref { animation: secoue 300ms linear }
  .sans-fin { display: inline-block; animation: secoue 400ms linear infinite }
  .mixte { animation: secoue 200ms linear }
  .mixte::after { content: '!'; display: inline-block; animation: secoue 600ms linear }
</style><div id="a">a</div><div id="b"><span class="enfant">b</span></div><div id="c">c</div><div id="d"><span class="sans-fin">d</span></div><div id="e">e</div>`

describe('µplay — animation portée par un pseudo-élément ou un enfant (Chromium)', function () {
  this.timeout(60000)
  let nav: any

  before(async function () {
    const { chromium } = await import('playwright')
    if (!existsSync(chromium.executablePath())) this.skip()
    nav = await chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => { if (nav) await nav.close() })

  it('la classe reste posée le temps de l’animation, la promesse se résout à sa fin', async () => {
    const page = await nav.newPage()
    try {
      await page.setContent(PAGE)
      await page.addScriptTag({ content: 'window.µ = {};\n' + PLAY })
      const r = await page.evaluate(async () => {
        const w: any = window
        const t0 = performance.now()
        const res: any = {}
        const suivre = (id: string, cls: string) => {
          const el = document.getElementById(id)!
          setTimeout(() => { res[cls + 'A300'] = el.classList.contains(cls) }, 300)
          return w.µ.play(el, cls).then(() => { res[cls] = Math.round(performance.now() - t0); res[cls + 'Retiree'] = !el.classList.contains(cls) })
        }
        await Promise.all([suivre('a', 'pseudo'), suivre('b', 'parent'), suivre('c', 'propre'), suivre('d', 'bref'), suivre('e', 'mixte')])
        return res
      })
      assert.ok(r.pseudo >= 550 && r.pseudo < 1500, `animation du pseudo-élément attendue jusqu’à sa fin (${r.pseudo} ms)`)
      assert.equal(r.pseudoA300, true, 'à 300 ms, la classe qui anime le pseudo-élément est toujours posée')
      assert.ok(r.parent >= 550 && r.parent < 1500, `animation de l’enfant attendue jusqu’à sa fin (${r.parent} ms)`)
      assert.equal(r.parentA300, true, 'à 300 ms, la classe qui anime l’enfant est toujours posée')
      assert.ok(r.propre >= 550 && r.propre < 1500, `animation du nœud lui-même : inchangé (${r.propre} ms)`)
      assert.ok(r.bref >= 250 && r.bref < 1000, `un enfant qui tourne sans fin ne fait pas attendre (${r.bref} ms)`)
      assert.ok(r.mixte >= 550 && r.mixte < 1500, `nœud (200 ms) et pseudo-élément (600 ms) : la plus longue est attendue (${r.mixte} ms)`)
      for (const cls of ['pseudo', 'parent', 'propre', 'bref', 'mixte']) assert.equal(r[cls + 'Retiree'], true, `la classe ${cls} est retirée à la fin`)
    }
    finally {
      await page.close()
    }
  })
})
