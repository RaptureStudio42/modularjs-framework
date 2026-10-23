// module cœur sortable (<@@sortable>) dans Chromium réel : l'unique arrêt de tabulation de la liste va à une ligne que Tab peut atteindre.
// Une ligne cachée (`hidden`, `display: none`) ou à laquelle l'auteur a donné `tabindex="-1"` ne le prend pas : il passe à la première
// ligne visible, et le tabindex de l'auteur reste le sien ; la dernière ligne visitée le garde tant qu'elle peut le porter ; sans aucune
// ligne qui le puisse, la liste n'a pas d'arrêt. Hors geste, les flèches haut et bas sautent une ligne cachée.

import assert from 'node:assert/strict'
import { construire, essayer, navigateurPresent, actif, focaliser } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'sc-page.mjs': `<script>
  $a = [{ id: 'a', cache: true }, { id: 'b' }, { id: 'c', cache: true }, { id: 'd' }]
  $p = [{ id: 'p' }, { id: 'q' }, { id: 'r' }]
  $x = [{ id: 'x' }, { id: 'y' }]
  $m = [{ id: 'm' }, { id: 'n' }]
  masquer = -> $a = [{ id: 'a', cache: true }, { id: 'b' }, { id: 'c', cache: true }, { id: 'd', cache: true }, { id: 'e' }]
</script>
<button class="avant">avant</button>
<@@sortable class="l1" value=!{$a}>
  {for l in $a by id}
    <div class="ligne" data-id={l.id} hidden={l.cache ? true : null}>{l.id}</div>
  {end}
</@@sortable>
<button class="b1">b1</button>
<@@sortable class="l2" value=!{$p}>
  {for l in $p by id}
    <div class="ligne" data-id={l.id} tabindex={l.id is 'p' ? '-1' : null}>{l.id}</div>
  {end}
</@@sortable>
<button class="b2">b2</button>
<@@sortable class="l3" value=!{$x}>
  {for l in $x by id}
    <div class="ligne" data-id={l.id} @class{l.id is 'x'}="cachee">{l.id}</div>
  {end}
</@@sortable>
<button class="b3">b3</button>
<@@sortable class="l4" value=!{$m}>
  {for l in $m by id}
    <div class="ligne" data-id={l.id} hidden={l.id is 'm' ? true : null} tabindex={l.id is 'n' ? '-1' : null}>{l.id}</div>
  {end}
</@@sortable>
<button class="fin">fin</button>
<button class="masquer" @click={masquer()}>masquer</button>
<style>
  :host
    display: block
  .ligne
    height: 30px
    border: 1px solid #999
  .cachee
    display: none
</style>
`,
}

const TAG = 'mjs-sc-page'

describe('<@@sortable> : l\'arrêt de tabulation va à une ligne que Tab atteint (chromium réel)', function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) return
    built   = await construire('sortable-ligne-cachee', SOURCES, false)
    browser = await (await import('playwright')).chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  const tabindex = (page: any) => page.evaluate((t: string) => [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')].map((n: any) => n.dataset.id + ':' + n.getAttribute('tabindex')).join(' '), TAG)
  const touche   = async (page: any, k: string) => {
    await page.keyboard.press(k)
    await page.waitForTimeout(120)
  }
  const tabs     = async (page: any, depuis: string, n: number) => {
    await focaliser(page, TAG, '.' + depuis)
    const vus: string[] = []
    for (let i = 0; i < n; i++) {
      await touche(page, 'Tab')
      vus.push(String(await actif(page, TAG)))
    }
    return vus.join(' > ')
  }

  it('première ligne cachée (hidden, display: none) ou au tabindex="-1" de l\'auteur : la première ligne visible porte l\'arrêt ; aucune ligne qui le puisse, aucun arrêt', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      assert.equal(await tabindex(page), 'a:-1 b:0 c:-1 d:-1 p:-1 q:0 r:-1 x:-1 y:0 m:-1 n:-1', 'une seule ligne visible à 0 par liste, le -1 de l\'auteur gardé')
      assert.equal(await tabs(page, 'avant', 7), 'b > b1 > q > b2 > y > b3 > fin', 'Tab entre dans chaque liste par sa première ligne visible et saute la liste qui n\'en a aucune')
    }, { listes: 4 })
  })

  it('les flèches sautent une ligne cachée, sans boucler ; la ligne visitée garde l\'arrêt, et le perd quand la page la cache', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      await focaliser(page, TAG, '.avant')
      await touche(page, 'Tab')
      await touche(page, 'ArrowDown')
      assert.equal(await actif(page, TAG), 'd', 'la flèche basse saute la ligne cachée c')
      await touche(page, 'ArrowDown')
      assert.equal(await actif(page, TAG), 'd', 'au bout, la flèche basse ne boucle pas')
      await touche(page, 'ArrowUp')
      assert.equal(await actif(page, TAG), 'b', 'la flèche haute saute la ligne cachée c')
      await touche(page, 'ArrowUp')
      assert.equal(await actif(page, TAG), 'b', 'au-dessus de b, seule la ligne cachée a : la flèche haute ne va nulle part')
      await touche(page, 'ArrowDown')
      assert.equal(await tabs(page, 'avant', 1), 'd', 'Tab revient à la dernière ligne visitée')
      await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.masquer').click(), TAG)
      await page.waitForTimeout(250)
      assert.equal(await tabindex(page), 'a:-1 b:0 c:-1 d:-1 e:-1 p:-1 q:0 r:-1 x:-1 y:0 m:-1 n:-1', 'la ligne visitée, cachée par la page, rend l\'arrêt à la première ligne visible')
      assert.equal(await tabs(page, 'avant', 1), 'b')
    }, { listes: 4 })
  })

  it('le focus posé sur une ligne au tabindex="-1" de l\'auteur ne retire pas l\'arrêt de la liste', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      await focaliser(page, TAG, '.ligne[data-id="p"]')
      await page.waitForTimeout(120)
      assert.equal(await actif(page, TAG), 'p')
      assert.equal(await tabindex(page), 'a:-1 b:0 c:-1 d:-1 p:-1 q:0 r:-1 x:-1 y:0 m:-1 n:-1', 'la ligne de l\'auteur garde son -1, q garde l\'arrêt')
      assert.equal(await tabs(page, 'b1', 1), 'q', 'Tab entre encore dans la liste')
    }, { listes: 4 })
  })
})
