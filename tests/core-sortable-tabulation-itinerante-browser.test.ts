// module cœur sortable (<@@sortable>) dans Chromium réel : une seule ligne dans l'ordre de tabulation (Tab traverse la liste d'un coup,
// au lieu d'un arrêt par ligne), les flèches haut et bas vont de ligne en ligne hors geste, la liste se souvient de la dernière ligne
// visitée ; chaque ligne dit aux lecteurs d'écran qu'elle se déplace (aria-roledescription) et comment (aria-description), en
// français ou en anglais selon la page. Le geste au clavier ne change pas : Espace saisit, les flèches déplacent, Espace pose, Échap annule.

import assert from 'node:assert/strict'
import { construire, essayer, navigateurPresent, actif, texte, STYLE } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'sr-page.mjs': `<script>
  $l = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  $sorts = []
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify(e.data)])
</script>
<button class="avant">avant</button>
<@@sortable class="liste" value=!{$l} @sort={keep(e)}>
  {for x in $l by id}
    <div class="ligne" data-id={x.id}>{x.id}</div>
  {end}
</@@sortable>
<button class="apres">après</button>
<p class="ordre">{$l.map((x)-> x.id).join('')}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
}

const TAG = 'mjs-sr-page'

describe('<@@sortable> : tabulation itinérante, rôle et consigne des lignes (chromium réel)', function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) return
    built   = await construire('sortable-itinerante', SOURCES, false)
    browser = await (await import('playwright')).chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  const attributs = (page: any) => page.evaluate((t: string) => [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')].map((n: any) => [n.dataset.id, n.getAttribute('role'), n.getAttribute('tabindex'), n.getAttribute('aria-roledescription'), n.getAttribute('aria-description')]), TAG)
  const ordres    = (page: any) => page.evaluate((t: string) => [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')].map((n: any) => n.dataset.id + ':' + n.getAttribute('tabindex')).join(' '), TAG)
  const touche    = async (page: any, k: string) => {
    await page.keyboard.press(k)
    await page.waitForTimeout(120)
  }

  it('une seule ligne dans l\'ordre de tabulation ; chaque ligne porte son rôle, sa description de rôle et sa consigne (français)', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      const R = 'ligne déplaçable'
      const C = 'Espace pour saisir la ligne et la déplacer'
      assert.deepEqual(await attributs(page), [['a', 'listitem', '0', R, C], ['b', 'listitem', '-1', R, C], ['c', 'listitem', '-1', R, C]])
      await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.avant').focus(), TAG)
      await touche(page, 'Tab')
      assert.equal(await actif(page, TAG), 'a', 'Tab entre dans la liste par sa ligne itinérante')
      await touche(page, 'Tab')
      assert.equal(await actif(page, TAG), 'apres', 'un second Tab sort de la liste : un seul arrêt pour toute la liste')
    })
  })

  it('les flèches vont de ligne en ligne, sans boucler ; la liste se souvient de la dernière ligne visitée', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.avant').focus(), TAG)
      await touche(page, 'Tab')
      await touche(page, 'ArrowDown')
      assert.equal(await actif(page, TAG), 'b')
      assert.equal(await ordres(page), 'a:-1 b:0 c:-1', 'la ligne visitée devient la ligne itinérante')
      await touche(page, 'ArrowDown')
      await touche(page, 'ArrowDown')
      assert.equal(await actif(page, TAG), 'c', 'au bout, la flèche basse ne boucle pas')
      await touche(page, 'ArrowUp')
      assert.equal(await actif(page, TAG), 'b')
      await touche(page, 'Shift+Tab')
      assert.equal(await actif(page, TAG), 'avant')
      await touche(page, 'Tab')
      assert.equal(await actif(page, TAG), 'b', 'Tab revient à la dernière ligne visitée')
      assert.equal(await texte(page, TAG, 'ordre'), 'abc', 'se déplacer de ligne en ligne ne trie rien')
      assert.equal(await texte(page, TAG, 'sorts'), '')
    })
  })

  it('le geste au clavier reste : Espace saisit, flèche, Espace pose (un seul sort, focus gardé) ; Échap annule', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.avant').focus(), TAG)
      await touche(page, 'Tab')
      await touche(page, 'ArrowDown')
      await touche(page, 'Space')
      await touche(page, 'ArrowDown')
      await touche(page, 'Space')
      await page.waitForTimeout(250)
      assert.equal(await texte(page, TAG, 'ordre'), 'acb')
      assert.equal((await texte(page, TAG, 'sorts')).split('|').length, 1, 'un seul sort')
      assert.equal(await actif(page, TAG), 'b', 'le focus reste sur la ligne déplacée')
      assert.equal(await ordres(page), 'a:-1 c:-1 b:0', 'la ligne déplacée reste la ligne itinérante')
      await touche(page, 'Space')
      await touche(page, 'ArrowUp')
      await touche(page, 'Escape')
      await page.waitForTimeout(250)
      assert.equal(await texte(page, TAG, 'ordre'), 'acb', 'Échap annule')
      assert.equal(await actif(page, TAG), 'b')
    })
  })

  it('page en anglais : la description du rôle et la consigne sont en anglais', async () => {
    await essayer(browser, built, false, TAG, async (page) => {
      const R = 'movable row'
      const C = 'Press Space to grab the row and move it'
      assert.deepEqual((await attributs(page)).map((l: any[]) => l.slice(3)), [[R, C], [R, C], [R, C]])
    }, { lang: 'en' })
  })
})
