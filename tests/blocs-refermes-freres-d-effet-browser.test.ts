// un bloc refermé retire TOUT son contenu, dans Chromium et Firefox réels, même quand un effet pose
// un frère à côté de sa balise : le reflet de *reflect (une boîte -moz-element dans Firefox, une copie
// quand on demande du flou), la bulle de *guard. Le nettoyage de l'effet retire ce frère pendant que le
// bloc détruit ses nœuds : la marche de destruction ne doit pas s'y arrêter et laisser en place les
// balises qui suivent (avec, dessous, leurs effets encore actifs). Les trois lieux : {if} à la
// racine, {if} dans un {for}, {key} à la racine. *reflect sans réglage ne pose rien dans Chromium
// (reflet natif) : ce cas sert de témoin, il ne change pas de forme d'un navigateur à l'autre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SUITE  = '<div class="m" *magnet>aimant</div><div class="z">fin</div>'
const FLOU   = `<div class="r" *reflect(blur: 2)>reflet</div>${SUITE}`
const BOUTON = '<button class="t" @click={$on = !$on}>t</button>'

const COMPOSANTS: Record<string, string> = {
  'fx-bloc-reflet': `<script>\n$on = true\n</script>\n{if $on}<div class="r" *reflect>reflet</div>${SUITE}{end}\n${BOUTON}`,
  'fx-bloc-flou':   `<script>\n$on = true\n</script>\n{if $on}${FLOU}{end}\n${BOUTON}`,
  'fx-bloc-garde':  `<script>\n$on = true\n</script>\n{if $on}<input class="g" type="number" min="1" max="10" aria-label="nombre" *guard(delay: 0, duration: 30s)>${SUITE}{end}\n${BOUTON}`,
  'fx-bloc-pour':   `<script>\n$on = true\n$l = [1, 2]\n</script>\n{for i in $l}<p class="row">{if $on}${FLOU}{end}</p>{end}\n${BOUTON}`,
  'fx-bloc-cle':    `<script>\n$on = true\n</script>\n{key $on}${FLOU}{end}\n${BOUTON}`,
}

describe('blocs — un bloc refermé après un effet qui pose un frère (navigateurs réels)', function () {
  this.timeout(120000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('blocs-refermes-freres-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis le runtime, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let browser: any
      let page: any
      let erreurs: string[]

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
        erreurs = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const balises = Object.keys(COMPOSANTS).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${balises}<script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((tags: string[]) => tags.every((t) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.t')), Object.keys(COMPOSANTS).map((c) => 'mjs-' + c))
        await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
      })

      after(async () => { await browser?.close() })

      // les balises d'un composant (ou de chaque ligne `.row`), en texte : la boîte d'un reflet se lit
      // « calque », la bulle de *guard « bulle »
      const lire = (tag: string, lignes = false): Promise<string> => page.evaluate(([tag, lignes]: [string, boolean]) => {
        const noms   = (parent: Element) => Array.from(parent.children).map((c: any) => c.getAttribute('mjs-fx-layer') ? 'calque' : c.hasAttribute('mjs-fx-guard-tip') ? 'bulle' : c.localName + '.' + (c.getAttribute('class') ?? '')).join(' ')
        const racine = (document.querySelector(tag) as any)._shadow
        return lignes ? Array.from(racine.querySelectorAll('.row')).map((p: any) => '[' + noms(p) + ']').join(' ') : noms(racine)
      }, [tag, lignes])

      const actifs  = (tag: string): Promise<number> => page.evaluate((tag: string) => (document.querySelector(tag) as any)._shadow.querySelectorAll('[mjs-fx]').length, tag)
      const cliquer = (tag: string) => page.evaluate((tag: string) => new Promise<void>((fin) => {
        (document.querySelector(tag) as any)._shadow.querySelector('.t').click()
        setTimeout(fin, 400)
      }), tag)

      // la boîte du reflet simple : Firefox en pose une (-moz-element), Chromium aucune (reflet natif)
      const reflet = nom === 'firefox' ? 'div.r calque' : 'div.r'

      it('{if} à la racine, *reflect sans réglage : refermé, il ne reste que le bouton ; rouvert, le contenu revient une seule fois', async () => {
        assert.equal(await lire('mjs-fx-bloc-reflet'), reflet + ' div.m div.z button.t', 'au départ')
        await cliquer('mjs-fx-bloc-reflet')
        assert.equal(await lire('mjs-fx-bloc-reflet'), 'button.t', 'refermé : plus aucune balise du bloc')
        assert.equal(await actifs('mjs-fx-bloc-reflet'), 0, 'plus aucun effet actif')
        await cliquer('mjs-fx-bloc-reflet')
        assert.equal(await lire('mjs-fx-bloc-reflet'), reflet + ' div.m div.z button.t', 'rouvert : une seule fois')
      })

      it('{if} à la racine, *reflect(blur: 2) : la copie du reflet est un frère, refermé il ne reste que le bouton', async () => {
        assert.equal(await lire('mjs-fx-bloc-flou'), 'div.r calque div.m div.z button.t', 'au départ')
        await cliquer('mjs-fx-bloc-flou')
        assert.equal(await lire('mjs-fx-bloc-flou'), 'button.t', 'refermé : plus aucune balise du bloc')
        assert.equal(await actifs('mjs-fx-bloc-flou'), 0, 'plus aucun effet actif')
        await cliquer('mjs-fx-bloc-flou')
        assert.equal(await lire('mjs-fx-bloc-flou'), 'div.r calque div.m div.z button.t', 'rouvert : une seule fois')
      })

      it('{if} à la racine, *guard : la bulle du refus est un frère, refermé il ne reste que le bouton', async () => {
        await page.evaluate(() => {
          const g = (document.querySelector('mjs-fx-bloc-garde') as any)._shadow.querySelector('.g')
          g.value = '99'
          g.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        })
        assert.equal(await lire('mjs-fx-bloc-garde'), 'input.g bulle div.m div.z button.t', 'une valeur refusée : la bulle est posée à côté du champ')
        await cliquer('mjs-fx-bloc-garde')
        assert.equal(await lire('mjs-fx-bloc-garde'), 'button.t', 'refermé : plus aucune balise du bloc, bulle comprise')
        assert.equal(await actifs('mjs-fx-bloc-garde'), 0, 'plus aucun effet actif')
      })

      it('{if} dans un {for} : chaque ligne se vide, rouvert chaque ligne se remplit une fois', async () => {
        const plein = '[div.r calque div.m div.z] [div.r calque div.m div.z]'
        assert.equal(await lire('mjs-fx-bloc-pour', true), plein, 'au départ')
        await cliquer('mjs-fx-bloc-pour')
        assert.equal(await lire('mjs-fx-bloc-pour', true), '[] []', 'refermé : deux lignes vides')
        assert.equal(await actifs('mjs-fx-bloc-pour'), 0, 'plus aucun effet actif')
        await cliquer('mjs-fx-bloc-pour')
        assert.equal(await lire('mjs-fx-bloc-pour', true), plein, 'rouvert : deux lignes pleines, une fois')
      })

      it('{key} à la racine : la clé change, l\'ancien contenu part en entier et le neuf arrive seul', async () => {
        await cliquer('mjs-fx-bloc-cle')
        assert.equal(await lire('mjs-fx-bloc-cle'), 'div.r calque div.m div.z button.t', 'le contenu neuf seul, aucun reste de l\'ancien')
        assert.equal(await actifs('mjs-fx-bloc-cle'), 2, 'les deux effets du contenu neuf, pas ceux de l\'ancien')
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
