// <select> dont les <option> arrivent après la valeur liée (liste chargée ensuite) : la valeur se réapplique quand
// les options changent, en liaison simple comme en double sens, un tableau pour `multiple` — sans écraser un choix
// de l'utilisateur fait depuis la dernière écriture de la variable. Défaut garanti absent : seule la liaison simple
// se réappliquait ; `<select value=!{$v}>` montrait la première option alors que `$v` valait « b », `multiple`
// restait sans choix, et en liaison simple le choix de l'utilisateur était écrasé dès qu'une option arrivait.
// Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, moteurPresent, compilerScript, ouvrirPage } from './helpers/navigateurs-compiles.js'

const OPTIONS = '{for o in $opts}<option value={o}>{o}</option>{end}'

const SOURCES: Record<string, string> = {
  'tst-svo-choix.mjs': [
    '<script>',
    '$opts = []',
    "$v = 'b'",
    "$v2 = 'b'",
    "$vm = ['b', 'c']",
    "$vm2 = ['a', 'c']",
    "charge = -> $opts = ['a', 'b', 'c']",
    "ajoute = -> $opts = [...$opts, 'o' + $opts.length]",
    "remet = -> $v = 'a'",
    '</script>',
    `<select class="a" value={$v}>${OPTIONS}</select>`,
    `<select class="b" value=!{$v2}>${OPTIONS}</select>`,
    `<select class="c" multiple value={$vm}>${OPTIONS}</select>`,
    `<select class="d" multiple value=!{$vm2}>${OPTIONS}</select>`,
    '<button class="ch" @click={charge()}>c</button><button class="aj" @click={ajoute()}>a</button><button class="re" @click={remet()}>r</button>',
  ].join('\n') + '\n',
}

describe('<select> : valeur liée réappliquée quand les options arrivent (navigateurs réels)', function () {
  this.timeout(120000)
  let script = ''

  before(async () => {
    script = await compilerScript('select-options-tardives', SOURCES)
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
        ({ browser, page, erreurs } = await ouvrirPage(nom, '<mjs-tst-svo-choix></mjs-tst-svo-choix>', script))
        await page.waitForFunction(() => !!(document.querySelector('mjs-tst-svo-choix') as any)?._shadow?.querySelector('.ch'), null, { timeout: 30000 })
      })

      after(async () => {
        if (browser) await browser.close()
      })

      const etat = () => page.evaluate(() => {
        const c: any = document.querySelector('mjs-tst-svo-choix')
        const sh = c._shadow
        const choisies = (s: string) => [...sh.querySelector(s).selectedOptions].map((o: any) => o.value).join('+')
        return { a: sh.querySelector('.a').value, b: sh.querySelector('.b').value, c: choisies('.c'), d: choisies('.d'), v2: c._state.v2 }
      })
      const bouton = async (sel: string) => {
        await page.evaluate((s: string) => (document.querySelector('mjs-tst-svo-choix') as any)._shadow.querySelector(s).click(), sel)
        await page.waitForTimeout(100)
      }

      it('options chargées après la valeur : chaque <select> montre sa variable', async function () {
        if (!present) { this.skip(); return }
        await bouton('.ch')
        assert.deepEqual(await etat(), { a: 'b', b: 'b', c: 'b+c', d: 'a+c', v2: 'b' })
      })

      it('choix de l\'utilisateur puis une option de plus : le choix reste ; une écriture de la variable se réapplique', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => {
          const sh = (document.querySelector('mjs-tst-svo-choix') as any)._shadow
          for (const s of ['.a', '.b']) {
            const el = sh.querySelector(s)
            el.value = 'c'
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
          }
        })
        await page.waitForTimeout(60)
        assert.deepEqual(await etat(), { a: 'c', b: 'c', c: 'b+c', d: 'a+c', v2: 'c' })
        await bouton('.aj')
        assert.deepEqual(await etat(), { a: 'c', b: 'c', c: 'b+c', d: 'a+c', v2: 'c' }, 'le choix de l\'utilisateur reste')
        await bouton('.re')
        await bouton('.aj')
        assert.equal((await etat()).a, 'a', 'la variable écrite depuis se réapplique')
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
