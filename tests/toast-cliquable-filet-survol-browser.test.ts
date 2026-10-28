// toast cliquable (µ.modal.notify avec `href` ou `onClick`) : au survol, un filet de 1px borde le toast, de la couleur de
// `--mjs-toast-hover-border` ; sans elle (défaut transparent), le survol peint exactement ce qu'il peignait, pixel pour pixel. Le filet
// garde sa couleur sous une feuille d'appli qui habille la bordure et le fond de `a:hover` et `button:hover` ; une ombre que cette feuille
// pose elle-même au survol reste la sienne, comme avant. Chromium, Firefox et WebKit réels ; la feuille du module est aussi relue

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function stripEsm(s: string): string {
  return s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
}

const lire   = (f: string) => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const MODAL  = lire('mjs_modal.ts')
const SCRIPT = `${stripEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${MODAL}\nglobalThis.µ = µ;`

const ORIGINE = 'http://mjs.test'
const PAGE    = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>page</title></head><body></body></html>'

// le survol d'avant : aucune ombre sur la couverture (spécificité plus forte que la feuille du module, qui passe sinon après)
const SANS_FILET = '.mjs-toast-action:hover{box-shadow:none!important}'

// règles de balise d'une feuille d'appli ordinaire : bordure et fond des liens, des boutons et de leurs états
const CSS_APPLI = `button{border:1px solid #888;background:#e0e0e0}
  button:hover,button:active{border-color:#444;border-width:3px;background:#d0d0d0}
  a{border:1px solid #00e;background:#eef}
  a:hover{border:2px dashed yellow;background:yellow}`

// une feuille d'appli qui pose sa propre ombre au survol des liens et des boutons
const CSS_OMBRE = 'a:hover,button:hover{box-shadow:inset 0 0 0 3px rgb(0, 128, 0)}'

describe('toast cliquable — la feuille du module pose le filet du survol', function () {
  it('le survol de la couverture pose une ombre intérieure de 1px, transparente sans `--mjs-toast-hover-border`, hors !important', function () {
    const m   = MODAL.match(/µ\._mjs_modalSheet\.replaceSync\(`([\s\S]*?)`\);/)
    const css = m ? m[1] : ''
    const survols = [...css.matchAll(/:where\(\.mjs-toast-action:hover\)\{([^}]*)\}/g)].map((r) => r[1])
    assert.ok(survols.includes('box-shadow:inset 0 0 0 1px var(--mjs-toast-hover-border, transparent)'), `règles du survol : ${JSON.stringify(survols)}`)
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`toast cliquable — filet au survol (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  // exécute du code dans la page puis attend la fin de l'animation d'entrée des toasts
  const poser = (code: string): Promise<any> => page.evaluate(`(async () => {
    ${code}
    await Promise.all(document.getAnimations().filter((a) => a.animationName === 'mjs-toast-entree').map((a) => a.finished.catch(() => 0)))
  })()`)

  // l'ombre calculée de la couverture
  const ombre = (): Promise<string> => page.evaluate(`getComputedStyle(document.querySelector('.mjs-toast-action')).boxShadow`)

  // le toast tel qu'il est peint
  const cliche = async (): Promise<Buffer> => {
    const r = await page.evaluate(`(() => { const r = document.querySelector('.mjs-toast').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
    return page.screenshot({ clip: r })
  }

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.route(`${ORIGINE}/**`, (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }))
  })

  after(async () => {
    if (browser) await browser.close()
  })

  beforeEach(async function () {
    if (!present) return
    erreurs.length = 0
    await page.goto(`${ORIGINE}/`)
    await page.addScriptTag({ content: SCRIPT })
    await page.addStyleTag({ content: ':root{--mjs-toast-entree-duree:.01s}' })
    await page.mouse.move(2, 2)
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  for (const [qui, opts] of [['bouton', `{ onClick: () => {} }`], ['lien', `{ href: '#/x' }`]] as const) {
    it(`${qui} : sans \`--mjs-toast-hover-border\`, le survol peint ce qu'il peignait, pixel pour pixel`, async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Un message à lire', Object.assign({ duration: 0 }, ${opts}))`)
      await page.hover('.mjs-toast-action')
      const avec = await cliche()
      await page.addStyleTag({ content: SANS_FILET })
      assert.ok(avec.equals(await cliche()), 'le défaut ne change rien au survol')
    })

    it(`${qui} : \`--mjs-toast-hover-border\` posé, un filet de 1px de sa couleur au survol, aucun au repos`, async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-hover-border', 'rgb(255, 0, 0)')`)
      await poser(`µ.modal.notify('Un message à lire', Object.assign({ duration: 0 }, ${opts}))`)
      assert.equal(await ombre(), 'none', 'au repos, aucun filet')
      await page.hover('.mjs-toast-action')
      assert.equal(await ombre(), 'rgb(255, 0, 0) 0px 0px 0px 1px inset')
      const avec = await cliche()
      await page.addStyleTag({ content: SANS_FILET })
      assert.ok(!avec.equals(await cliche()), 'le filet se voit')
    })

    it(`${qui} : sous une feuille d'appli qui habille la bordure et le fond de \`a:hover\` et \`button:hover\`, le filet garde sa couleur, et rien ne paraît sans elle`, async function () {
      if (!present) { this.skip(); return }
      await page.addStyleTag({ content: CSS_APPLI })
      await poser(`µ.modal.notify('Un message à lire', Object.assign({ duration: 0 }, ${opts}))`)
      await page.hover('.mjs-toast-action')
      const avec = await cliche()
      await page.addStyleTag({ content: SANS_FILET })
      assert.ok(avec.equals(await cliche()), 'sans la variable, rien ne borde le toast')
      await page.mouse.move(2, 2)
      await page.evaluate(`document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('box-shadow:none!important')) s.remove() }); document.documentElement.style.setProperty('--mjs-toast-hover-border', 'rgb(0, 0, 255)')`)
      await page.hover('.mjs-toast-action')
      assert.equal(await ombre(), 'rgb(0, 0, 255) 0px 0px 0px 1px inset')
    })

    it(`${qui} : une ombre que la feuille d'appli pose sur \`a:hover\` et \`button:hover\` reste la sienne, comme avant`, async function () {
      if (!present) { this.skip(); return }
      await page.addStyleTag({ content: CSS_OMBRE })
      await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-hover-border', 'rgb(255, 0, 0)')`)
      await poser(`µ.modal.notify('Un message à lire', Object.assign({ duration: 0 }, ${opts}))`)
      await page.hover('.mjs-toast-action')
      assert.equal(await ombre(), 'rgb(0, 128, 0) 0px 0px 0px 3px inset')
    })
  }
})
