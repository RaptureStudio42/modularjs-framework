// La navigation d'un lien écrit dans un composant ne part qu'une fois l'événement fini, comme l'action par défaut du
// navigateur : le `@click.prevent` qu'un parent pose sur la balise de l'enfant retient le lien de l'enfant, comme un
// écouteur de la page qui appelle `preventDefault()` sur cette balise. Défaut garanti absent : la navigation partait
// depuis la racine de l'enfant, avant le parent — l'adresse changeait alors que l'événement finissait retenu.
// Gardes : un lien nu, un `.stop` sur le lien et un `@click` du parent sans `.prevent` naviguent toujours.
// Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, moteurPresent, compilerScript, ouvrirPage } from './helpers/navigateurs-compiles.js'

const NOTE = 'note = (x) -> window.__note(x)'

const SOURCES: Record<string, string> = {
  'tst-lrp-enfant.mjs': '<a class="lien" href="#/enfant">ici</a>\n',
  'tst-lrp-parent.mjs': `<script>\n${NOTE}\n</script>\n<@tst-lrp-enfant @click.prevent={note('parent-prevent')}/>\n`,
  'tst-lrp-libre.mjs': `<script>\n${NOTE}\n</script>\n<@tst-lrp-enfant @click={note('parent')}/>\n`,
  'tst-lrp-liens.mjs': `<script>\n${NOTE}\n</script>\n<a class="ls" href="#/stop" @click.stop={note('lien-stop')}>s</a><a class="ln" href="#/nu">n</a>\n`,
}

const CORPS = '<mjs-tst-lrp-parent></mjs-tst-lrp-parent><mjs-tst-lrp-libre></mjs-tst-lrp-libre><mjs-tst-lrp-liens></mjs-tst-lrp-liens><mjs-tst-lrp-enfant id="natif"></mjs-tst-lrp-enfant>'

describe('lien d\'un enfant retenu par le `.prevent` du parent (navigateurs réels)', function () {
  this.timeout(120000)
  let script = ''

  before(async () => {
    script = await compilerScript('lien-retenu-parent', SOURCES)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of MOTEURS) {
    describe(nom, function () {
      let present = false
      let browser: any
      let page: any
      let erreurs: string[] = []

      before(async function () {
        present = await moteurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        ({ browser, page, erreurs } = await ouvrirPage(nom, CORPS, script))
        await page.waitForFunction(() => {
          const w: any = window
          return ['mjs-tst-lrp-parent', 'mjs-tst-lrp-libre', '#natif'].every((h) => !!w.__trouve(document.querySelector(h), '.lien')) && !!w.__trouve(document.querySelector('mjs-tst-lrp-liens'), '.ln')
        }, null, { timeout: 30000 })
        // écouteur de la page sur la balise d'un enfant : il retient le lien, comme au navigateur
        await page.evaluate(() => document.getElementById('natif')!.addEventListener('click', (e) => e.preventDefault()))
      })

      after(async () => {
        if (browser) await browser.close()
      })

      const clic = (hote: string, sel: string) => page.evaluate(async ([h, s]: string[]) => {
        const w: any = window
        history.replaceState({}, '', '/')
        w.__ordre = []
        const el = w.__trouve(document.querySelector(h), s)
        const libre = el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }))
        await new Promise((r) => setTimeout(r, 120))
        return { prevenu: !libre, hash: location.hash, ordre: w.__ordre.slice() }
      }, [hote, sel])

      it('`@click.prevent` du parent sur la balise de l\'enfant : le lien de l\'enfant ne part pas', async function () {
        if (!present) { this.skip(); return }
        assert.deepEqual(await clic('mjs-tst-lrp-parent', '.lien'), { prevenu: true, hash: '', ordre: ['parent-prevent'] })
        assert.deepEqual(await clic('#natif', '.lien'), { prevenu: true, hash: '', ordre: [] }, 'écouteur natif de la page')
      })

      it('gardes : `@click` du parent sans `.prevent`, `.stop` sur le lien, lien nu — la navigation part', async function () {
        if (!present) { this.skip(); return }
        assert.deepEqual(await clic('mjs-tst-lrp-libre', '.lien'), { prevenu: true, hash: '#/enfant', ordre: ['parent'] })
        assert.deepEqual(await clic('mjs-tst-lrp-liens', '.ls'), { prevenu: true, hash: '#/stop', ordre: ['lien-stop'] })
        assert.deepEqual(await clic('mjs-tst-lrp-liens', '.ln'), { prevenu: true, hash: '#/nu', ordre: [] })
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
