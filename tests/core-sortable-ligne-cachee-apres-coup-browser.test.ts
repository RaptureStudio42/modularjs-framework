// module cœur sortable (<@@sortable>) dans Chromium réel : la page cache après coup la ligne qui tient l'arrêt de tabulation (un
// filtre qui pose `hidden`, une classe, un style, `inert`). L'arrêt restait sur cette ligne, que Tab ne peut plus atteindre : Tab
// sautait toute la liste. Il passe désormais à la première ligne visible dès que la ligne change. Une liste cachée tout entière
// (`visibility: hidden` héritée d'un parent) garde son arrêt : quand elle reparaît, Tab y entre.

import assert from 'node:assert/strict'
import { construire, essayer, navigateurPresent, focaliser, actif } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'sa-page.mjs': `<script>
  $a = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  $p = [{ id: 'p' }, { id: 'q' }]
</script>
<button class="avant">avant</button>
<@@sortable class="l1" value=!{$a}>
  {for l in $a by id}
    <div class="ligne" data-id={l.id}>{l.id}</div>
  {end}
</@@sortable>
<button class="b1">b1</button>
<div class="boite invisible">
  <@@sortable class="l2" value=!{$p}>
    {for l in $p by id}
      <div class="ligne" data-id={l.id}>{l.id}</div>
    {end}
  </@@sortable>
</div>
<button class="fin">fin</button>
<style>
  :host
    display: block
  .ligne
    height: 30px
    border: 1px solid #999
  .cachee
    display: none
  .invisible
    visibility: hidden
</style>
`,
}

const TAG = 'mjs-sa-page'

// les façons de cacher une ligne après coup, telles qu'un script de la page les écrit
const FACONS: Record<string, string> = {
  'hidden':                 'l.hidden = true',
  'classe (display: none)': 'l.classList.add("cachee")',
  'style display: none':    'l.style.display = "none"',
  'visibility: hidden':     'l.style.visibility = "hidden"',
  'inert':                  'l.inert = true',
}

describe('<@@sortable> : une ligne cachée après coup rend l\'arrêt de tabulation (chromium réel)', function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) return
    built   = await construire('sortable-cachee-apres-coup', SOURCES, false)
    browser = await (await import('playwright')).chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  const tabindex = (page: any, liste: string) => page.evaluate(([t, l]: string[]) => [...(document.querySelector(t) as any)._shadow.querySelectorAll('.' + l + ' > .ligne')].map((n: any) => n.dataset.id + ':' + n.getAttribute('tabindex')).join(' '), [TAG, liste])
  const tab      = async (page: any, depuis: string) => {
    await focaliser(page, TAG, '.' + depuis)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(120)
    return String(await actif(page, TAG))
  }

  for (const [nom, script] of Object.entries(FACONS)) {
    it(`ligne qui tient l'arrêt cachée après coup (${nom}) : l'arrêt passe à la première ligne visible, Tab y entre`, async () => {
      await essayer(browser, built, false, TAG, async (page) => {
        assert.equal(await tabindex(page, 'l1'), 'a:0 b:-1 c:-1')
        await page.evaluate(([t, s]: string[]) => { const l = (document.querySelector(t) as any)._shadow.querySelector('.l1 > .ligne[data-id="a"]'); new Function('l', s)(l) }, [TAG, script])
        await page.waitForTimeout(150)
        assert.equal(await tabindex(page, 'l1'), 'a:-1 b:0 c:-1', 'l\'arrêt quitte la ligne cachée')
        assert.equal(await tab(page, 'avant'), 'b', 'Tab entre dans la liste par la première ligne visible')
      }, { listes: 2 })
    })
  }

  it('liste cachée tout entière par un parent (visibility: hidden) : elle garde son arrêt, Tab y entre quand elle reparaît', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      assert.equal(await tabindex(page, 'l2'), 'p:0 q:-1')
      await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.boite').classList.remove('invisible'), TAG)
      await page.waitForTimeout(150)
      assert.equal(await tab(page, 'b1'), 'p')
    }, { listes: 2 })
  })
})
