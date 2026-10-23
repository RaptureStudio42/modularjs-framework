// Dans Chromium réel, avec le vrai plein écran (API Fullscreen) : des toasts affichés pendant le plein écran d'un élément,
// puis une navigation qui remplace le corps de la page — le navigateur quitte alors le plein écran de lui-même. Le toast
// suivant paraît sur la nouvelle page et les anciens ne reviennent pas à la sortie du plein écran. Une sortie ordinaire, où
// l'appli retire son élément plein écran dans son écouteur de fullscreenchange, ramène toujours les toasts dans le corps.
// Le runtime est chargé tel quel dans la page, avec l'extrait de µ._mjs_zoneFill (mjs_ujs.ts), comme les tests voisins.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
const UJS = lire('mjs_ujs.ts')
const REMPLIR = UJS.slice(UJS.indexOf('// >>> extrait-test _mjs_zoneFill'), UJS.indexOf('// <<< extrait-test _mjs_zoneFill'))
const SCRIPT = `${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\n${REMPLIR}\nglobalThis.µ = µ;`
const ORIGINE = 'http://mjs.test'
const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><div id="lecteur" style="background:#000;color:#fff">lecteur</div></body></html>'
const MESSAGES = `Array.from(document.querySelectorAll('.mjs-toast .mjs-toast-message')).map((t) => t.textContent)`

describe('toasts du plein écran et navigation (Chromium réel, vrai plein écran)', function () {
  this.timeout(120000)
  let browser: any
  let page: any

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip() }
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.setDefaultTimeout(10000)
    await page.route(`${ORIGINE}/**`, (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }))
  })

  after(async () => { if (browser) { await browser.close() } })

  // page neuve, runtime chargé, l'élément #lecteur mis en plein écran par une vraie touche (geste de l'utilisateur)
  const pleinEcran = async (avant = ''): Promise<boolean> => {
    await page.goto(ORIGINE + '/')
    await page.evaluate(SCRIPT)
    await page.evaluate(`${avant}; document.addEventListener('keydown', (e) => { if (e.key === 'f') { document.getElementById('lecteur').requestFullscreen().catch(() => {}) } }); 0`)
    if (!(await page.evaluate('document.fullscreenEnabled'))) { return false }
    await page.keyboard.press('f')
    await page.waitForFunction(`document.fullscreenElement && document.fullscreenElement.id === 'lecteur'`)
    return true
  }

  it('cinq permanents en plein écran, navigation : le suivant paraît, les anciens ne reviennent pas à la sortie', async function () {
    if (!(await pleinEcran())) { this.skip(); return }
    await page.evaluate(`for (let i = 1; i <= 5; i++) { µ.modal.notify('permanent ' + i, { duration: 0 }) }; 0`)
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toasts').parentNode.id`), 'lecteur', 'les toasts se posent dans l\'élément plein écran')
    const juste = await page.evaluate(`(() => {
      window.__sorties = 0
      document.addEventListener('fullscreenchange', () => { window.__sorties++ })
      const main = document.createElement('main')
      main.innerHTML = '<p>page suivante</p>'
      µ._mjs_zoneFill(document.body, [main])
      µ.modal.notify('après la navigation', { duration: 30000 })
      return ${MESSAGES}
    })()`)
    assert.deepEqual(juste, ['après la navigation'], 'le toast suivant paraît aussitôt')
    await page.waitForFunction(`window.__sorties > 0 && !document.fullscreenElement`)
    await page.waitForTimeout(100)
    assert.deepEqual(await page.evaluate(MESSAGES), ['après la navigation'], 'aucun ancien toast ne revient à la sortie du plein écran')
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toasts').parentNode === document.body`), true)
  })

  it('sortie ordinaire, l\'appli retire son élément plein écran dans son écouteur : les toasts reviennent dans le corps', async function () {
    const appli = `document.addEventListener('fullscreenchange', () => { const l = document.getElementById('lecteur'); if (!document.fullscreenElement && l) { l.remove() } })`
    if (!(await pleinEcran(appli))) { this.skip(); return }
    await page.evaluate(`µ.modal.notify('pendant le plein écran', { duration: 0 }); 0`)
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toasts').parentNode.id`), 'lecteur')
    await page.evaluate(`document.exitFullscreen()`)
    await page.waitForFunction(`!document.fullscreenElement && !document.getElementById('lecteur')`)
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toasts') && document.querySelector('.mjs-toasts').parentNode === document.body`), true, 'le conteneur est revenu dans le corps')
    assert.deepEqual(await page.evaluate(MESSAGES), ['pendant le plein écran'])
  })
})
