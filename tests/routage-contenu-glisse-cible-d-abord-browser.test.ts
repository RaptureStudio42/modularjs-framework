// Le contenu glissé dans un composant (écrit entre ses balises, affiché par son `<@slot>`) est routé une fois sa
// cible atteinte, après les écouteurs natifs de celle-ci. Défauts garantis absents (ce contenu se routait à la
// capture, avant la cible) : `@click.stop` sur un ancêtre privait le bouton glissé de ses propres écouteurs ;
// `@click.stop` posé sur un composant glissé tuait les gestionnaires du composant lui-même ; un champ à masque de
// saisie glissé gardait dans sa variable la valeur d'avant le masque ; un `stopPropagation()` natif posé sur le
// bouton glissé n'arrêtait pas le `@click` d'un ancêtre ; le gestionnaire posé sur la balise d'un composant glissé
// jouait avant ceux du composant. Chaque cas est comparé à l'ordre natif (mêmes arbres, écouteurs posés à la main).
// Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, moteurPresent, compilerScript, ouvrirPage } from './helpers/navigateurs-compiles.js'

const NOTE = 'note = (x) -> window.__note(x)'

const SOURCES: Record<string, string> = {
  'tst-rcg-nu.mjs': '<div class="nu"><@slot/></div>\n',
  'tst-rcg-btn.mjs': `<script>\n${NOTE}\n</script>\n<button class="ib" @click={note('btn-interne')}>b</button>\n`,
  'tst-rcg-p2.mjs': `<script>\n${NOTE}\n</script>\n<div class="anc" @click={note('auteur-anc')}><@tst-rcg-nu><button class="lib">x</button></@tst-rcg-nu></div>\n`,
  'tst-rcg-p3.mjs': `<script>\n${NOTE}\n</script>\n<div class="anc" @click.stop={note('auteur-anc-stop')}><@tst-rcg-nu><button class="lib2">x</button></@tst-rcg-nu></div>\n`,
  'tst-rcg-p4.mjs': `<script>\n${NOTE}\n</script>\n<@tst-rcg-nu><@tst-rcg-btn @click={note('auteur-sur-btn')}/></@tst-rcg-nu>\n`,
  'tst-rcg-p5.mjs': `<script>\n${NOTE}\n</script>\n<@tst-rcg-nu><@tst-rcg-btn @click.stop={note('auteur-stop-sur-btn')}/></@tst-rcg-nu>\n`,
  'tst-rcg-champ.mjs': '<label class="champ"><span>T</span><@slot/></label>\n',
  'tst-rcg-form.mjs': "<script>\n$glisse = ''\nmasque = (el) ->\n  el.addEventListener('input', -> el.value = el.value.toUpperCase())\n  -> null\n</script>\n<@tst-rcg-champ><input class=\"g\" value=!{$glisse} @attach={masque}></@tst-rcg-champ>\n",
}

const CORPS = ['p2', 'p3', 'p4', 'p5', 'form'].map((p) => `<mjs-tst-rcg-${p}></mjs-tst-rcg-${p}>`).join('')

describe('contenu glissé routé après les écouteurs de sa cible (navigateurs réels)', function () {
  this.timeout(120000)
  let script = ''

  before(async () => {
    script = await compilerScript('routage-glisse-cible', SOURCES)
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
          return !!w.__trouve(document.querySelector('mjs-tst-rcg-p2'), '.lib') && !!w.__trouve(document.querySelector('mjs-tst-rcg-p3'), '.lib2') && !!w.__trouve(document.querySelector('mjs-tst-rcg-p4'), '.ib') && !!w.__trouve(document.querySelector('mjs-tst-rcg-p5'), '.ib') && !!w.__trouve(document.querySelector('mjs-tst-rcg-form'), '.g')
        }, null, { timeout: 30000 })
        // écouteurs natifs d'une bibliothèque sur les boutons glissés, et de la page au-dessus de l'auteur
        await page.evaluate(() => {
          const w: any = window
          w.__trouve(document.querySelector('mjs-tst-rcg-p2'), '.lib').addEventListener('click', (e: any) => { w.__note('lib'); e.stopPropagation() })
          w.__trouve(document.querySelector('mjs-tst-rcg-p3'), '.lib2').addEventListener('click', () => w.__note('lib2'))
          document.querySelector('mjs-tst-rcg-p3')!.addEventListener('click', () => w.__note('page'))
        })
      })

      after(async () => {
        if (browser) await browser.close()
      })

      const clic = (hote: string, sel: string) => page.evaluate(([h, s]: string[]) => (window as any).__clic(h, s), [hote, sel])

      it('`@click.stop` sur un ancêtre : le bouton glissé garde ses écouteurs, la page au-dessus ne reçoit rien', async function () {
        if (!present) { this.skip(); return }
        assert.deepEqual(await clic('mjs-tst-rcg-p3', '.lib2'), ['lib2', 'auteur-anc-stop'])
      })

      it('composant glissé : ses gestionnaires jouent avant celui que son auteur pose sur sa balise, `.stop` compris', async function () {
        if (!present) { this.skip(); return }
        assert.deepEqual(await clic('mjs-tst-rcg-p4', '.ib'), ['btn-interne', 'auteur-sur-btn'])
        assert.deepEqual(await clic('mjs-tst-rcg-p5', '.ib'), ['btn-interne', 'auteur-stop-sur-btn'])
      })

      it('`stopPropagation()` natif sur le bouton glissé : le `@click` de l\'ancêtre ne joue pas', async function () {
        if (!present) { this.skip(); return }
        assert.deepEqual(await clic('mjs-tst-rcg-p2', '.lib'), ['lib'])
      })

      it('champ à masque glissé, lié en double sens : la variable reçoit la valeur masquée', async function () {
        if (!present) { this.skip(); return }
        const r = await page.evaluate(async () => {
          const w: any = window
          const c: any = document.querySelector('mjs-tst-rcg-form')
          const el = w.__trouve(c, '.g')
          el.value = 'abc'
          el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: 'c', inputType: 'insertText' }))
          await new Promise((res) => setTimeout(res, 30))
          return { champ: el.value, variable: c._state.glisse }
        })
        assert.deepEqual(r, { champ: 'ABC', variable: 'ABC' })
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
