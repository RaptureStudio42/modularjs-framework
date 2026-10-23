// µ.modal.notify — la pause du décompte (pause, µ.config.notifyPause) dans Chromium, Firefox et WebKit réels : ce que happy-dom ne sait pas montrer.
// - le survol réel du pointeur met la barre de vie en pause (état et temps de l'animation), le départ la relance, sans repartir de zéro ;
// - le toast survolé survit à sa durée, puis se ferme au bout du temps RESTANT (mesuré dans la page, sur l'horloge du navigateur) ;
// - le focus au clavier (Tab) sur la couverture d'un toast cliquable ou sur la croix fige de même, le focus qui sort relance ;
// - passer d'un enfant du toast à un autre (texte, croix) ne relance pas ; le survol de la couverture d'un toast cliquable compte ;
// - `pause: false` et `µ.config.notifyPause = false` rendent l'ancien comportement : la barre continue ;
// - chaque toast a sa propre pause ;
// - le conteneur des toasts qui change d'élément (plein écran) : Firefox et WebKit n'envoient alors ni pointerleave ni focusout, la pause est relue.
// Les attentes sont des CONDITIONS (l'état de la barre, une image rendue, un minuteur de la page) et jamais des durées devinées : sous charge, une
// machine lente ne fait pas tomber un test qui n'a aucune raison de tomber.
// Le runtime est chargé tel quel dans la page (init, cache de pages, modale), comme le font les tests voisins.

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
const SCRIPT = `${stripEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\nglobalThis.µ = µ;`

const ORIGINE = 'http://mjs.test'
const PAGE    = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>page</title></head><body><button id="ailleurs" type="button">ailleurs</button></body></html>'

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`µ.modal.notify — pause du décompte au survol et au focus (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  // exécute du code dans la page puis attend la fin de l'animation d'entrée des toasts (la barre de vie, elle, dure des secondes) et deux images rendues
  const poser = (code: string): Promise<any> => page.evaluate(`(async () => {
    ${code}
    await Promise.all(document.getAnimations().filter((a) => a.animationName === 'mjs-toast-entree').map((a) => a.finished.catch(() => 0)))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })()`)

  // état de l'animation de la barre du n-ième toast : en marche ou en pause, son temps écoulé, et l'instant de la mesure (horloge de la page)
  const vie = (n = 0): Promise<{ etat: string; t: number; maintenant: number }> => page.evaluate(`(() => {
    const a = document.querySelectorAll('.mjs-toast-barre')[${n}].getAnimations()[0]
    return { etat: a.playState, t: Number(a.currentTime), maintenant: performance.now() }
  })()`)

  const nombre   = (): Promise<number> => page.evaluate(`document.querySelectorAll('.mjs-toast').length`)
  const ailleurs = (): Promise<void> => page.mouse.move(2, 2)
  // le pointeur au centre de l'élément, d'un seul mouvement (hover() attend un élément « stable », et un toast à durée courte part pendant l'attente)
  const sur = async (sel: string): Promise<void> => {
    const c = await page.evaluate(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
    await page.mouse.move(c[0], c[1])
  }
  // deux images rendues : le style et la mise en page posés par ce qui précède sont à jour
  const image = (): Promise<void> => page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))`)
  // du temps qui passe sur l'horloge de la PAGE : un minuteur posé après un autre, d'une durée au moins égale, ne part jamais avant lui — le
  // minuteur d'un toast qui aurait échappé à la pause est donc parti avant que cette attente ne rende la main, quelle que soit la charge
  const ecouler = (ms: number): Promise<void> => page.evaluate(`new Promise((r) => setTimeout(r, ${ms}))`)
  // la barre du n-ième toast est dans l'état dit, et il n'est plus « en attente » : une animation qu'on vient de mettre en pause continue
  // jusqu'à l'image suivante, son temps n'est figé qu'ensuite (le message dit ce qui manque sinon)
  const barreEn = async (etat: string, msg: string, n = 0): Promise<void> => {
    try { await page.waitForFunction(`(() => { const a = document.querySelectorAll('.mjs-toast-barre')[${n}].getAnimations()[0]; return a.playState === '${etat}' && !a.pending })()`, null, { timeout: 5000 }) } catch { /* le test dit ce qui manque */ }
    assert.equal((await vie(n)).etat, etat, msg)
  }
  // le temps écoulé de la barre atteint t (la barre court en vrai : on attend sa progression)
  const jusqua   = (t: number, n = 0): Promise<void> => page.waitForFunction(`document.querySelectorAll('.mjs-toast-barre')[${n}].getAnimations()[0].currentTime >= ${t}`)
  const proche   = (a: number, b: number, msg: string, ecart: number) => assert.ok(Math.abs(a - b) <= ecart, `${msg} : ${a} contre ${b} (écart permis ${ecart})`)

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

  // page neuve : aucun toast, aucun focus, le pointeur loin de la pile
  const reinit = async (): Promise<void> => {
    erreurs.length = 0
    await page.goto(`${ORIGINE}/`)
    await page.addScriptTag({ content: SCRIPT })
    await page.addStyleTag({ content: ':root{--mjs-toast-entree-duree:.01s}' })
    await ailleurs()
  }

  beforeEach(async function () {
    if (!present) return
    await reinit()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  it('le survol met la barre en pause et la fige ; le départ du pointeur la relance, là où elle en était', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Survol', { duration: 30000 })`)
    assert.equal((await vie()).etat, 'running', 'au repos, la barre court')
    await jusqua(300)
    await sur('.mjs-toast')
    await barreEn('paused', 'survolée, la barre est en pause')
    const a = await vie()
    await ecouler(500)
    const b = await vie()
    assert.equal(b.etat, 'paused')
    proche(b.t, a.t, 'le temps de la barre est figé pendant le survol', 5)
    await page.evaluate(`window.__m = {}; document.querySelector('.mjs-toast').addEventListener('pointerleave', () => { __m.sortie = performance.now() })`)
    await ailleurs()
    await barreEn('running', 'le pointeur parti, la barre repart')
    await jusqua(b.t + 100)
    const c = await vie()
    const m = await page.evaluate(`__m`)
    assert.ok(c.t >= b.t + 100, `le temps reprend où il en était, pas depuis zéro (${c.t} contre ${b.t})`)
    assert.ok(c.t - b.t <= c.maintenant - m.sortie + 50, `il ne rattrape rien : ${c.t - b.t} ms de barre en ${Math.round(c.maintenant - m.sortie)} ms de départ du pointeur`)
  })

  it('le toast survolé survit à sa durée, puis se ferme au bout du temps RESTANT', async function () {
    if (!present) { this.skip(); return }
    const DUREE = 4000
    await poser(`µ.modal.notify('Reste', { duration: ${DUREE} })`)
    await jusqua(1500)
    await sur('.mjs-toast')
    await barreEn('paused', 'survolée, la barre est en pause')
    const fige = await vie()
    await ecouler(DUREE + 100)
    assert.equal(await nombre(), 1, 'toujours là bien après sa durée, tant qu\'il est survolé')
    await page.evaluate(`window.__m = {}; (() => {
      const el = document.querySelector('.mjs-toast')
      el.addEventListener('pointerleave', () => { __m.sortie = performance.now() })
      new MutationObserver((l, o) => { if (!el.isConnected) { __m.retire = performance.now(); o.disconnect() } }).observe(document.querySelector('.mjs-toasts'), { childList: true })
    })()`)
    await ailleurs()
    await page.waitForFunction(`window.__m.retire`, null, { timeout: 8000 })
    const m = await page.evaluate(`__m`)
    const attendu = DUREE - fige.t
    const mesure = m.retire - m.sortie
    assert.ok(mesure < DUREE - 500, `le toast ne repart pas de zéro : fermé ${Math.round(mesure)} ms après le départ du pointeur, durée pleine ${DUREE} ms`)
    assert.ok(mesure >= attendu - 100, `il attend le temps restant : fermé ${Math.round(mesure)} ms après le départ du pointeur, il en restait ${Math.round(attendu)}`)
  })

  it('un toast cliquable : le survol de la couverture fige aussi, et passer au texte puis à la croix ne relance pas', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Cliquable', { duration: 30000, onClick: () => {} })`)
    assert.equal(await page.evaluate(`(() => { const r = document.querySelector('.mjs-toast-action').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).className })()`), 'mjs-toast-action', 'le pointeur est sur la couverture')
    await sur('.mjs-toast-action')
    await barreEn('paused', 'la couverture survolée fige')
    await sur('.mjs-toast-close')
    await image()
    assert.equal((await vie()).etat, 'paused', 'aller de la couverture à la croix reste dans le toast')
    await ailleurs()
    await barreEn('running', 'le pointeur parti, la barre repart')
  })

  it('le focus au clavier fige la barre — la couverture, puis la croix — et le focus qui sort la relance', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Clavier', { duration: 30000, onClick: () => {} })`)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const dans = await page.evaluate(`document.activeElement.className`)
    assert.equal(dans, 'mjs-toast-close', 'le focus est sur la croix du toast')
    await barreEn('paused', 'le focus dans le toast fige')
    await page.focus('#ailleurs')
    await barreEn('running', 'le focus sorti du toast relance')
  })

  it('le focus donné à la croix d\'un toast ordinaire fige, le pointeur absent', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Croix', { duration: 30000 })`)
    await page.focus('.mjs-toast-close')
    await barreEn('paused', 'le focus fige')
    const a = await vie()
    await ecouler(300)
    proche((await vie()).t, a.t, 'temps figé', 5)
    await page.evaluate(`document.activeElement.blur()`)
    await barreEn('running', 'le focus perdu relance')
  })

  it('pointeur et focus ensemble : la barre ne repart que lorsque les deux sont partis', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Les deux', { duration: 30000 })`)
    await sur('.mjs-toast')
    await page.focus('.mjs-toast-close')
    await barreEn('paused', 'le pointeur et le focus figent')
    await ailleurs()
    await image()
    assert.equal((await vie()).etat, 'paused', 'le focus tient encore le toast')
    await page.focus('#ailleurs')
    await barreEn('running', 'les deux sont partis')
  })

  it('pause: false — le survol et le focus ne figent rien, la barre court', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Sans pause', { duration: 30000, pause: false })`)
    await sur('.mjs-toast')
    await page.focus('.mjs-toast-close')
    await image()
    const a = await vie()
    assert.equal(a.etat, 'running')
    await jusqua(a.t + 150)
    assert.equal((await vie()).etat, 'running', 'le temps avance malgré le survol et le focus')
  })

  it('µ.config.notifyPause = false — la barre court au survol ; pause: true par appel l\'emporte', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.config.notifyPause = false; µ.modal.notify('Global', { duration: 30000 }); µ.modal.notify('Appel', { duration: 30000, pause: true })`)
    await sur('.mjs-toast:nth-child(1)')
    await image()
    assert.equal((await vie(0)).etat, 'running', 'réglage global : pas de pause')
    await sur('.mjs-toast:nth-child(2)')
    await barreEn('paused', 'pause: true par appel l\'emporte sur le réglage', 1)
    assert.equal((await vie(0)).etat, 'running', 'le premier toast n\'est plus survolé')
  })

  it('chaque toast a sa pause : survoler l\'un laisse courir la barre de l\'autre', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Un', { duration: 30000 }); µ.modal.notify('Deux', { duration: 30000 })`)
    await sur('.mjs-toast:nth-child(2)')
    await barreEn('paused', 'le second est survolé', 1)
    assert.equal((await vie(0)).etat, 'running')
    await ailleurs()
    await sur('.mjs-toast:nth-child(1)')
    await barreEn('paused', 'le premier est survolé', 0)
    await barreEn('running', 'le second n\'est plus survolé', 1)
  })

  it('duration: 0 — un toast permanent se survole sans erreur et reste sans barre', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Permanent', { duration: 0 })`)
    await sur('.mjs-toast')
    await page.focus('.mjs-toast-close')
    await image()
    assert.equal(await page.evaluate(`document.querySelectorAll('.mjs-toast-barre').length`), 0, 'pas de barre')
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toast').classList.contains('mjs-toast-paused')`), false, 'rien à figer, rien de marqué')
    assert.equal(await nombre(), 1)
  })

  it('la pause ne passe que par une classe : aucun style inline posé sur le toast', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Classe', { duration: 30000 })`)
    await sur('.mjs-toast')
    await barreEn('paused', 'survolée, la barre est en pause')
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toast').hasAttribute('style')`), false)
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toast').classList.contains('mjs-toast-paused')`), true)
  })

  describe('le conteneur change d\'élément (plein écran)', function () {
    // le plein écran est simulé : le document rend l'élément plein écran et reçoit fullscreenchange — le conteneur des toasts le suit, et
    // Firefox et WebKit n'envoient alors ni pointerleave ni focusout aux toasts qu'il emporte (le plein écran réel est essayé plus bas)
    const PREPARER = `document.body.insertAdjacentHTML('beforeend', '<div id="plein"></div>')`
    const ENTRER   = `Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.getElementById('plein') }); document.dispatchEvent(new Event('fullscreenchange'))`
    const suivi    = (): Promise<boolean> => page.evaluate(`document.querySelector('.mjs-toasts').parentNode.id === 'plein'`)

    it('le pointeur posé sur le toast, le conteneur déplacé, puis le pointeur parti : la barre court', async function () {
      if (!present) { this.skip(); return }
      await poser(`${PREPARER}; µ.modal.notify('Survol', { duration: 30000 })`)
      await sur('.mjs-toast')
      await barreEn('paused', 'survolée, la barre est en pause')
      await page.evaluate(ENTRER)
      assert.equal(await suivi(), true, 'le conteneur a suivi le plein écran')
      await ailleurs()
      await barreEn('running', 'le navigateur a oublié le survol : la barre repart')
    })

    it('le focus perdu au déplacement du conteneur : le toast se ferme à son heure, il ne reste pas figé', async function () {
      if (!present) { this.skip(); return }
      await poser(`${PREPARER}; µ.modal.notify('Focus', { duration: 1500 })`)
      await page.focus('.mjs-toast-close')
      await barreEn('paused', 'le focus fige')
      await page.evaluate(ENTRER)
      assert.equal(await suivi(), true, 'le conteneur a suivi le plein écran')
      await barreEn('running', 'le focus a disparu avec le déplacement : la barre repart')
      await page.waitForFunction(`document.querySelectorAll('.mjs-toast').length === 0`)
    })

    it('le plein écran réel, la croix ayant le focus : le toast se ferme à son heure', async function () {
      if (!present) { this.skip(); return }
      await poser(`${PREPARER}; document.addEventListener('keydown', (e) => { if (e.key === 'f') document.getElementById('plein').requestFullscreen().catch(() => {}) }); µ.modal.notify('Plein écran', { duration: 2500 })`)
      if (!(await page.evaluate(`document.fullscreenEnabled`))) { this.skip(); return }
      await page.focus('.mjs-toast-close')
      await barreEn('paused', 'le focus fige')
      try {
        await page.keyboard.press('f')
        await page.waitForFunction(`document.querySelector('.mjs-toasts').parentNode.id === 'plein'`)
        await page.waitForFunction(`document.querySelectorAll('.mjs-toast').length === 0`)
      } finally {
        await page.evaluate(`document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : 0`)
      }
    })
  })
})
