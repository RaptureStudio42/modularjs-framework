// µ.modal.notify — glisser pour fermer (swipe, µ.config.notifySwipe) dans Chromium, Firefox et WebKit réels, à la souris ; et au doigt dans
// Chromium (événements tactiles du protocole) : ce que happy-dom ne sait pas montrer.
// - le toast suit la souris, revient en deçà du seuil, sort puis se ferme au-delà, et la file de notifyMax avance ; la sortie va jusqu'au bout
//   (le toast quitte entièrement la fenêtre, à gauche comme à droite) ;
// - le pointeur est capturé : sorti du toast, le toast le suit encore et le lâcher le ferme ; un toast repris en main pendant son retour n'est
//   pas défait par la fin de ce retour ;
// - un appui qui n'a jamais été un glisser (sorti du toast avant 8 px, relâché dehors) ne laisse rien : le survol qui suit ne tire pas le toast ;
// - le sens permis se lit sur la position EFFECTIVE de la pile : préréglages, position libre à variables CSS (left/right/bottom), pile centrée
//   par left: 50 % et un translate, pile posée d'un seul côté lue sur sa place dans la fenêtre ;
// - un simple clic marche toujours (couverture, lien) ; après un vrai glisser le clic qui suit le lâcher est avalé ;
// - pas de glisser natif d'un lien, pas de sélection de texte, touch-action: pan-y sur le toast qui glisse ;
// - la barre de vie est en pause pendant le glisser et repart si le toast revient ;
// - prefers-reduced-motion: reduce : le toast suit encore, mais ni sortie ni retour animés ;
// - au doigt (Chromium) : un geste horizontal glisse sans faire défiler la page, un geste vertical reste un défilement, un second doigt (non
//   primaire) ne tire pas un second toast.
// Les attentes sont des CONDITIONS (le retour est fini, une image est rendue, le pointeur est immobile sur l'horloge de la page, le toast est
// fermé) et jamais des durées devinées : sous charge, une machine lente ne fait pas tomber un test qui n'a aucune raison de tomber.
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
const PAGE    = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>page</title></head><body style="margin:0"><p id="texte" style="position:absolute;left:0;top:300px;width:400px">Un texte de la page, derrière la pile des toasts, qui ne doit jamais se sélectionner.</p></body></html>'

// la page note l'instant de chaque déplacement du pointeur : l'immobilité se constate sur son horloge
const MOUVEMENTS = `document.addEventListener('pointermove', () => { window.__mouv = performance.now() }, true)`
const IMMOBILE   = `performance.now() - (window.__mouv || 0) > 130`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`µ.modal.notify — glisser pour fermer (${nom} réel)`, function () {
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

  const boite  = (n = 0): Promise<{ x: number; y: number; width: number; height: number }> => page.evaluate(`(() => { const r = document.querySelectorAll('.mjs-toast')[${n}].getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  const nombre = (): Promise<number> => page.evaluate(`document.querySelectorAll('.mjs-toast').length`)
  const marque = (classe: string, n = 0): Promise<boolean> => page.evaluate(`document.querySelectorAll('.mjs-toast')[${n}].classList.contains('${classe}')`)
  const barre  = (): Promise<string> => page.evaluate(`document.querySelector('.mjs-toast-barre').getAnimations()[0].playState`)
  const proche = (a: number, b: number, msg: string, ecart = 3) => assert.ok(Math.abs(a - b) <= ecart, `${msg} : ${a} contre ${b} (écart permis ${ecart})`)
  // deux images rendues : le style et la mise en page posés par ce qui précède sont à jour
  const image  = (): Promise<void> => page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))`)
  // le retour (ou la sortie) en glissant est fini : la marque de glisse est retirée à sa fin, 250 ms après le lâcher
  const retour = (n = 0): Promise<void> => page.waitForFunction(`!document.querySelectorAll('.mjs-toast')[${n}].classList.contains('mjs-toast-sliding')`)
  const ferme  = (): Promise<void> => page.waitForFunction(`document.querySelectorAll('.mjs-toast').length === 0`)
  // espionne les décalages posés (--mjs-toast-dx) : le dernier est la cible de la sortie, lue sans attendre la fin de l'animation
  const ESPION = `window.__dx = []; (() => { const sp = CSSStyleDeclaration.prototype.setProperty; CSSStyleDeclaration.prototype.setProperty = function (n, v, p) { if (n === '--mjs-toast-dx') __dx.push(parseFloat(v)); return sp.call(this, n, v, p) } })()`

  // prise au centre du n-ième toast ; rend le point de départ
  const prendre = async (n = 0): Promise<{ x: number; y: number; x0: number }> => {
    const b = await boite(n)
    const x = b.x + b.width / 2
    const y = b.y + b.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    return { x, y, x0: b.x }
  }
  // déplace le pointeur à x (relatif à la prise), en plusieurs pas, puis attend que l'image soit posée
  const tirerA = async (prise: { x: number; y: number }, dx: number): Promise<void> => {
    await page.mouse.move(prise.x + dx, prise.y, { steps: 8 })
    await image()
  }
  // pointeur immobile avant le lâcher : plus aucune vitesse, seul le seuil de distance compte
  const lacher = async (): Promise<void> => {
    await page.waitForFunction(IMMOBILE)
    await page.mouse.up()
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

  // page neuve : aucun toast, le pointeur loin de la pile, l'animation d'entrée raccourcie
  const reinit = async (): Promise<void> => {
    erreurs.length = 0
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto(`${ORIGINE}/`)
    await page.addScriptTag({ content: SCRIPT })
    await page.addStyleTag({ content: ':root{--mjs-toast-entree-duree:.01s}' })
    await page.evaluate(MOUVEMENTS)
    await page.mouse.move(2, 2)
  }

  beforeEach(async function () {
    if (!present) return
    await reinit()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  describe('suivre, revenir, sortir', function () {
    it('le toast suit la souris vers la droite, dans les deux sens, jusqu\'à sa place', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Suivre', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 60)
      proche((await boite()).x, p.x0 + 60, 'il suit la souris')
      assert.equal(await marque('mjs-toast-dragging'), true)
      await tirerA(p, 25)
      proche((await boite()).x, p.x0 + 25, 'et revient avec elle')
      await tirerA(p, -40)
      proche((await boite()).x, p.x0, 'vers la gauche il ne bouge pas : la pile est ancrée à droite')
      await lacher()
    })

    it('relâché en deçà du seuil : il revient à sa place en glissant, sans rien laisser', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Revenir', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 50)
      await lacher()
      await retour()
      proche((await boite()).x, p.x0, 'revenu à sa place')
      assert.equal(await nombre(), 1)
      assert.equal(await page.evaluate(`document.querySelector('.mjs-toast').className.includes('dragging') || document.querySelector('.mjs-toast').className.includes('sliding')`), false)
      const style = await page.evaluate(`document.querySelector('.mjs-toast').getAttribute('style')`)
      assert.ok(!style, `plus aucun CSS inline sur le toast (attribut absent ou vide ; trouvé : ${JSON.stringify(style)})`)
    })

    it('relâché au-delà du seuil : il sort de l\'écran en glissant puis se ferme, et la file avance', async function () {
      if (!present) { this.skip(); return }
      // la page note l'instant du lâcher et celui du retrait du premier toast : la sortie animée se lit sur SON horloge, pas sur celle du test
      await poser(`${ESPION}; window.__t = {};
        document.addEventListener('pointerup', () => { __t.leve = performance.now() }, true);
        new MutationObserver((l) => { for (const r of l) for (const n of r.removedNodes) if (n.classList && n.classList.contains('mjs-toast') && !__t.retire) __t.retire = performance.now() }).observe(document.documentElement, { childList: true, subtree: true });
        µ.config.notifyMax = 1; µ.modal.notify('Premier', { duration: 0 }); µ.modal.notify('Second', { duration: 0 })`)
      assert.equal(await nombre(), 1, 'le second attend')
      const p = await prendre()
      await tirerA(p, 140)
      await page.mouse.up()
      await page.waitForFunction(`document.querySelector('.mjs-toast-message') && document.querySelector('.mjs-toast-message').textContent === 'Second'`)
      const m = await page.evaluate(`({ leve: __t.leve, retire: __t.retire, dx: __dx })`)
      assert.ok(m.retire - m.leve >= 150, `la sortie est animée : le premier toast est resté ${Math.round(m.retire - m.leve)} ms après le lâcher`)
      assert.ok(m.dx[m.dx.length - 1] > 140, `il continue vers le bord droit : dernier décalage ${m.dx[m.dx.length - 1]}`)
      assert.equal(await nombre(), 1, 'le premier est parti, le second a pris la place')
    })

    it('vers la droite, le toast sort entièrement de la fenêtre : son bord gauche la dépasse de 32 px', async function () {
      if (!present) { this.skip(); return }
      await poser(`${ESPION}; µ.modal.notify('Droite', { duration: 0 })`)
      const b = await boite()
      const p = await prendre()
      await tirerA(p, 150)
      await page.mouse.up()
      await ferme()
      proche(b.x + await page.evaluate(`__dx[__dx.length - 1]`), 900 + 32, 'sa dernière position', 1.5)
    })

    it('vers la gauche, le toast sort entièrement de la fenêtre : son bord droit la dépasse de 32 px', async function () {
      if (!present) { this.skip(); return }
      await poser(`${ESPION}; µ.config.notifyPosition = 'bottom-left'; µ.modal.notify('Gauche', { duration: 0 })`)
      const b = await boite()
      const p = await prendre()
      await tirerA(p, -150)
      await page.mouse.up()
      await ferme()
      proche(b.x + b.width + await page.evaluate(`__dx[__dx.length - 1]`), -32, 'sa dernière position', 1.5)
    })

    it('le pointeur est capturé : sorti du toast, le toast le suit encore, et le lâcher dehors le ferme', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Capture', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 60)
      await page.mouse.move(p.x + 100, p.y + 400, { steps: 6 })
      await image()
      proche((await boite()).x, p.x0 + 100, 'loin sous le toast, il suit encore la souris')
      await page.mouse.up()
      await ferme()
    })

    it('un toast repris en main pendant son retour n\'est pas défait par la fin de ce retour', async function () {
      if (!present) { this.skip(); return }
      // le minuteur de fin de retour (250 ms) est retenu par la page : il part quand le test le décide, après la reprise, et seulement
      // s'il n'a pas été annulé — la reprise en main est sensée l'annuler
      await poser(`window.__fins = new Map(); (() => {
        const poser = window.setTimeout, annuler = window.clearTimeout; let n = 1e6
        window.setTimeout = function (fn, ms, ...a) { if (ms === 250) { n++; __fins.set(n, fn); return n } return poser.call(this, fn, ms, ...a) }
        window.clearTimeout = function (id) { if (__fins.has(id)) { __fins.delete(id); return } return annuler.call(this, id) }
      })(); µ.modal.notify('Reprise', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 60)
      await lacher()
      assert.equal(await page.evaluate(`__fins.size`), 1, 'le retour attend son minuteur de fin')
      const mi = await boite()
      const x = mi.x + mi.width / 2
      await page.mouse.move(x, p.y)
      await page.mouse.down()
      await page.mouse.move(x + 30, p.y, { steps: 4 })
      await image()
      assert.equal(await marque('mjs-toast-dragging'), true, 'repris en main')
      await page.evaluate(`[...__fins.values()].forEach((f) => f())`)
      assert.equal(await marque('mjs-toast-dragging'), true, 'la fin du retour interrompu n\'a pas défait la prise')
      proche((await boite()).x, p.x0 + 30, 'trente pixels depuis le nouvel appui')
      await lacher()
    })

    it('une pile ancrée à gauche : on tire vers la gauche, pas vers la droite', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.config.notifyPosition = 'bottom-left'; µ.modal.notify('Gauche', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 60)
      proche((await boite()).x, p.x0, 'vers la droite : rien')
      await tirerA(p, -150)
      assert.ok((await boite()).x < p.x0 - 100, 'vers la gauche : il suit')
      await page.mouse.up()
      await ferme()
    })

    it('un geste d\'abord vertical n\'est pas un glisser', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Vertical', { duration: 0 })`)
      const p = await prendre()
      await page.mouse.move(p.x + 2, p.y + 40, { steps: 5 })
      await page.mouse.move(p.x + 100, p.y + 41, { steps: 5 })
      assert.equal(await marque('mjs-toast-dragging'), false)
      proche((await boite()).x, p.x0, 'il n\'a pas bougé')
      await page.mouse.up()
    })

    it('un toast permanent se glisse aussi', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Permanent', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 150)
      await page.mouse.up()
      await ferme()
    })
  })

  describe('un appui qui n\'a jamais été un glisser', function () {
    it('sorti du toast avant 8 px et relâché dehors : le survol qui suit ne tire pas le toast, et le geste suivant part de son appui', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Périmé', { duration: 0 })`)
      const b = await boite()
      const y = b.y + b.height / 2
      await page.mouse.move(b.x + 4, y)
      await page.mouse.down()
      await page.mouse.move(b.x + 2, y)
      await page.mouse.move(b.x - 20, y)
      await page.mouse.move(b.x - 40, y)
      await page.mouse.up()
      await page.mouse.move(b.x + 100, y, { steps: 4 })
      await page.mouse.move(b.x + 250, y, { steps: 4 })
      await image()
      assert.equal(await marque('mjs-toast-dragging'), false, 'aucun bouton enfoncé : rien à tirer')
      proche((await boite()).x, b.x, 'le toast n\'a pas suivi le simple survol')
      const p = { x: b.x + 300, y }
      await page.mouse.move(p.x, p.y)
      await page.mouse.down()
      await tirerA(p, 10)
      proche((await boite()).x, b.x + 10, 'dix pixels depuis son propre appui, pas depuis l\'ancien')
      await lacher()
      await retour()
      assert.equal(await nombre(), 1, 'dix pixels ne ferment pas le toast')
      proche((await boite()).x, b.x, 'revenu à sa place')
    })

    it('puis un nouvel appui HORS du toast, bouton tenu et traîné à travers lui : le toast ne suit pas un geste qui n\'a pas commencé sur lui', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Fantôme', { duration: 0 })`)
      const b = await boite()
      const y = b.y + b.height / 2
      await page.mouse.move(b.x + 4, y)
      await page.mouse.down()
      await page.mouse.move(b.x + 2, y)
      await page.mouse.move(b.x - 20, y)
      await page.mouse.move(b.x - 40, y)
      await page.mouse.up()
      await page.mouse.move(b.x - 150, y)
      await page.mouse.down()
      await page.mouse.move(b.x + 100, y, { steps: 12 })
      await image()
      assert.equal(await marque('mjs-toast-dragging'), false, 'le bouton est tenu depuis l\'extérieur : le toast ne se tire pas')
      proche((await boite()).x, b.x, 'le toast n\'a pas suivi ce geste')
      await page.mouse.move(b.x + 300, y, { steps: 8 })
      await image()
      assert.equal(await marque('mjs-toast-dragging'), false, 'même 300 px plus loin')
      proche((await boite()).x, b.x, 'toujours à sa place')
      await page.mouse.up()
      await image()
      assert.equal(await nombre(), 1, 'le lâcher ne ferme pas le toast')
      // un vrai appui sur le toast tire de nouveau, depuis son propre point de départ
      const p = { x: b.x + 150, y }
      await page.mouse.move(p.x, p.y)
      await page.mouse.down()
      await tirerA(p, 10)
      proche((await boite()).x, b.x + 10, 'dix pixels depuis son propre appui')
      await lacher()
      await retour()
      proche((await boite()).x, b.x, 'revenu à sa place')
    })

    it('le survol qui suit ne gèle pas le décompte : le toast se ferme à son heure', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Heure', { duration: 3000, pause: false })`)
      const b = await boite()
      const y = b.y + b.height / 2
      await page.mouse.move(b.x + 4, y)
      await page.mouse.down()
      await page.mouse.move(b.x - 40, y, { steps: 3 })
      await page.mouse.up()
      await page.mouse.move(b.x + 200, y, { steps: 4 })
      await image()
      assert.equal(await barre(), 'running', 'la barre court, rien ne la tient')
      await ferme()
    })
  })

  describe('le sens permis se lit sur la position effective de la pile', function () {
    // pose une position libre à variables CSS (l'exemple d'une application) puis un toast ; la prise va à gauche puis à droite
    const essai = async (vars: Record<string, string>): Promise<{ gauche: number; droite: number }> => {
      const decl = Object.entries(vars).map(([k, v]) => `document.documentElement.style.setProperty('${k}', '${v}')`).join(';')
      await poser(`${decl}; µ.config.notifyPosition = { bottom: 'var(--toasts-bottom)', left: 'var(--toasts-left)', right: 'var(--toasts-right)' }; µ.modal.notify('Libre', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, -60)
      const gauche = (await boite()).x - p.x0
      await tirerA(p, 60)
      const droite = (await boite()).x - p.x0
      await tirerA(p, 0)
      await lacher()
      return { gauche, droite }
    }
    // pile posée par des longueurs (sans variable) et, au besoin, déplacée par une règle de la page ; même prise
    const posee = async (position: string, css = ''): Promise<{ gauche: number; droite: number }> => {
      if (css) await page.addStyleTag({ content: css })
      await poser(`µ.config.notifyPosition = ${position}; µ.modal.notify('Posée', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, -60)
      const gauche = (await boite()).x - p.x0
      await tirerA(p, 60)
      const droite = (await boite()).x - p.x0
      await tirerA(p, 0)
      await lacher()
      return { gauche, droite }
    }

    it('ancrée à droite par ses variables (left: auto) : vers la droite seulement', async function () {
      if (!present) { this.skip(); return }
      const r = await essai({ '--toasts-bottom': '16px', '--toasts-left': 'auto', '--toasts-right': '16px' })
      proche(r.gauche, 0, 'gauche interdite')
      proche(r.droite, 60, 'droite permise')
    })

    it('ancrée à gauche par ses variables (right: auto) : vers la gauche seulement', async function () {
      if (!present) { this.skip(); return }
      const r = await essai({ '--toasts-bottom': '16px', '--toasts-left': '16px', '--toasts-right': 'auto' })
      proche(r.gauche, -60, 'gauche permise')
      proche(r.droite, 0, 'droite interdite')
    })

    it('left et right posés tous deux : les deux sens', async function () {
      if (!present) { this.skip(); return }
      const r = await essai({ '--toasts-bottom': '16px', '--toasts-left': '16px', '--toasts-right': '16px' })
      proche(r.gauche, -60, 'gauche permise')
      proche(r.droite, 60, 'droite permise')
    })

    it('ni left ni right : les deux sens', async function () {
      if (!present) { this.skip(); return }
      const r = await essai({ '--toasts-bottom': '16px', '--toasts-left': 'auto', '--toasts-right': 'auto' })
      proche(r.gauche, -60, 'gauche permise')
      proche(r.droite, 60, 'droite permise')
    })

    it('variables absentes (jamais déclarées) : les deux sens', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.config.notifyPosition = { bottom: '16px' }; µ.modal.notify('Libre', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, -60)
      proche((await boite()).x - p.x0, -60, 'gauche permise')
      await tirerA(p, 60)
      proche((await boite()).x - p.x0, 60, 'droite permise')
      await tirerA(p, 0)
      await lacher()
    })

    it('une pile centrée par left: 50 % et translateX(-50 %) : les deux sens, bien qu\'un seul côté soit posé', async function () {
      if (!present) { this.skip(); return }
      const r = await posee(`{ top: '16px', left: '50%' }`, '.mjs-toasts-custom{transform:translateX(-50%)}')
      proche(r.gauche, -60, 'gauche permise')
      proche(r.droite, 60, 'droite permise')
    })

    it('left: 50 % sans translate : la pile est dans le tiers droit, vers la droite seulement', async function () {
      if (!present) { this.skip(); return }
      const r = await posee(`{ top: '16px', left: '50%' }`)
      proche(r.gauche, 0, 'gauche interdite')
      proche(r.droite, 60, 'droite permise')
    })

    it('un seul côté posé, la pile dans le tiers gauche : vers la gauche seulement', async function () {
      if (!present) { this.skip(); return }
      const r = await posee(`{ top: '16px', left: '4%' }`)
      proche(r.gauche, -60, 'gauche permise')
      proche(r.droite, 0, 'droite interdite')
    })

    it('un seul côté posé, la pile dans le tiers droit : vers la droite seulement', async function () {
      if (!present) { this.skip(); return }
      const r = await posee(`{ top: '16px', right: '4%' }`)
      proche(r.gauche, 0, 'gauche interdite')
      proche(r.droite, 60, 'droite permise')
    })

    it('left et right à zéro, marges automatiques (pile centrée par l\'application) : les deux sens', async function () {
      if (!present) { this.skip(); return }
      const r = await posee(`{ top: '16px', left: '0', right: '0' }`, '.mjs-toasts-custom{margin:0 auto}')
      proche(r.gauche, -60, 'gauche permise')
      proche(r.droite, 60, 'droite permise')
    })

    it('les huit préréglages gardent le côté de leur nom', async function () {
      if (!present) { this.skip(); return }
      for (const [position, permis] of [['top-right', 1], ['top-left', -1], ['bottom-right', 1], ['bottom-left', -1], ['quarter-top-right', 1], ['quarter-top-left', -1], ['quarter-bottom-right', 1], ['quarter-bottom-left', -1]] as const) {
        await poser(`µ.config.notifyPosition = '${position}'; window.__h = µ.modal.notify('Préréglage', { duration: 0 })`)
        const p = await prendre()
        await tirerA(p, 60 * permis)
        proche((await boite()).x - p.x0, 60 * permis, `${position} : le sens du nom`)
        await tirerA(p, -60 * permis)
        proche((await boite()).x - p.x0, 0, `${position} : le sens contraire`)
        await tirerA(p, 0)
        await lacher()
        await retour()
        await page.evaluate(`__h.close()`)
      }
    })
  })

  describe('le clic, avant et après le glisser', function () {
    it('un clic sans bouger déclenche la couverture comme avant', async function () {
      if (!present) { this.skip(); return }
      await poser(`window.__n = 0; µ.modal.notify('Clic', { duration: 0, onClick: () => { __n++ } })`)
      const b = await boite()
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
      assert.equal(await page.evaluate(`__n`), 1)
      assert.equal(await nombre(), 0)
    })

    it('un geste de moins de 8 px est encore un clic', async function () {
      if (!present) { this.skip(); return }
      await poser(`window.__n = 0; µ.modal.notify('Presque', { duration: 0, onClick: () => { __n++ } })`)
      const p = await prendre()
      await page.mouse.move(p.x + 4, p.y + 1, { steps: 2 })
      await page.mouse.up()
      assert.equal(await page.evaluate(`__n`), 1)
    })

    it('après un vrai glisser, le clic qui suit le lâcher est avalé : ni onClick ni lien ; le toast reste cliquable ensuite', async function () {
      if (!present) { this.skip(); return }
      await poser(`window.__n = 0; µ.modal.notify('Avalé', { duration: 0, onClick: () => { __n++ }, href: '#/suite' })`)
      const p = await prendre()
      await tirerA(p, 30)
      await tirerA(p, 0)
      await page.mouse.up()
      await retour()
      assert.equal(await page.evaluate(`__n`), 0, 'onClick n\'est pas appelée')
      assert.equal(await page.evaluate(`location.hash`), '', 'le lien n\'est pas suivi')
      assert.equal(await nombre(), 1, 'le toast est resté')
      const b = await boite()
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
      assert.equal(await page.evaluate(`__n`), 1, 'le clic suivant, franc, passe')
      assert.equal(await page.evaluate(`location.hash`), '#/suite')
    })

    it('la croix ferme toujours, au clic', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Croix', { duration: 0 })`)
      await page.locator('.mjs-toast-close').click()
      assert.equal(await nombre(), 0)
    })

    it('un toast à lien se tire à la souris sans glisser natif du lien', async function () {
      if (!present) { this.skip(); return }
      await poser(`window.__d = 0; document.addEventListener('dragstart', () => { __d++ }, true); µ.modal.notify('Lien', { duration: 0, href: '#/lien' })`)
      const p = await prendre()
      await tirerA(p, 70)
      proche((await boite()).x, p.x0 + 70, 'le toast suit, le lien n\'a pas été emporté')
      assert.equal(await page.evaluate(`__d`), 0, 'aucun glisser natif')
      await tirerA(p, 0)
      await page.mouse.up()
    })
  })

  describe('pendant qu\'on tire', function () {
    it('aucune sélection de texte, ni dans le toast ni dans la page derrière', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.config.notifyPosition = 'top-left'; µ.modal.notify('Un message assez long pour être sélectionné à la souris', { duration: 0, title: false })`)
      const m = await page.evaluate(`(() => { const r = document.querySelector('.mjs-toast-message').getBoundingClientRect(); return [r.x + 10, r.y + 6] })()`)
      await page.mouse.move(m[0], m[1])
      await page.mouse.down()
      await page.mouse.move(m[0] - 20, m[1], { steps: 3 })
      await page.mouse.move(m[0] + 300, m[1] + 280, { steps: 10 })
      assert.equal(await page.evaluate(`getSelection().toString()`), '', 'rien de sélectionné')
      const us = await page.evaluate(`(() => { const cs = getComputedStyle(document.querySelector('.mjs-toast')); return cs.userSelect || cs.webkitUserSelect })()`)
      assert.equal(us, 'none', 'le toast tiré n\'est pas sélectionnable')
      await page.mouse.up()
      assert.equal(await page.evaluate(`getSelection().toString()`), '')
    })

    it('aucune sélection de texte non plus sur un toast cliquable (lien), ni glisser natif d\'une icône image', async function () {
      if (!present) { this.skip(); return }
      const ICONE = 'data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"30\\" height=\\"30\\"><rect width=\\"30\\" height=\\"30\\" fill=\\"red\\"/></svg>'
      await poser(`window.__d = 0; document.addEventListener('dragstart', () => { __d++ }, true); µ.config.notifyPosition = 'top-left'; µ.modal.notify('Lien et image', { duration: 0, href: '#/lien', icon: '${ICONE}' }); µ.modal.notify('Autre', { duration: 0, icon: '${ICONE}' })`)
      const m = await page.evaluate(`(() => { const r = document.querySelector('.mjs-toast-action').getBoundingClientRect(); return [r.x + 150, r.y + 20] })()`)
      await page.mouse.move(m[0], m[1])
      await page.mouse.down()
      await page.mouse.move(m[0] - 20, m[1], { steps: 3 })
      await page.mouse.move(m[0] + 300, m[1] + 280, { steps: 10 })
      assert.equal(await page.evaluate(`getSelection().toString()`), '', 'rien de sélectionné (lien)')
      await page.mouse.up()
      const i = await page.evaluate(`(() => { const r = document.querySelectorAll('.mjs-toast-icon img')[1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
      await page.mouse.move(i[0], i[1])
      await page.mouse.down()
      await page.mouse.move(i[0] - 30, i[1], { steps: 4 })
      await page.mouse.move(i[0] + 200, i[1], { steps: 8 })
      assert.equal(await page.evaluate(`__d`), 0, 'aucun glisser natif, ni du lien ni de l\'image')
      await page.mouse.up()
    })

    it('touch-action: pan-y sur le toast qui glisse, la valeur d\'origine sur celui qui ne glisse pas', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Glisse', { duration: 0 }); µ.modal.notify('Fixe', { duration: 0, swipe: false })`)
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelectorAll('.mjs-toast')[0]).touchAction`), 'pan-y')
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelectorAll('.mjs-toast')[1]).touchAction`), 'auto')
    })

    it('la barre de vie est en pause pendant le glisser, et repart si le toast revient', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Barre', { duration: 30000 })`)
      assert.equal(await barre(), 'running')
      const p = await prendre()
      await tirerA(p, 40)
      assert.equal(await barre(), 'paused', 'le décompte est figé pendant qu\'on tient le toast')
      assert.equal(await marque('mjs-toast-paused'), true)
      await lacher()
      await retour()
      assert.equal(await barre(), 'paused', 'le toast est revenu mais la souris est encore dessus : la pause du survol prend le relais')
      await page.mouse.move(2, 2)
      await page.waitForFunction(`document.querySelector('.mjs-toast-barre').getAnimations()[0].playState === 'running'`)
    })

    it('swipe: false — rien ne se passe : le toast ne bouge pas, la souris reste libre', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.modal.notify('Fixe', { duration: 0, swipe: false })`)
      const p = await prendre()
      await tirerA(p, 150)
      proche((await boite()).x, p.x0, 'immobile')
      assert.equal(await marque('mjs-toast-dragging'), false)
      await page.mouse.up()
      assert.equal(await nombre(), 1)
    })

    it('µ.config.notifySwipe = false — aucun toast ne glisse ; swipe: true par appel l\'emporte', async function () {
      if (!present) { this.skip(); return }
      await poser(`µ.config.notifySwipe = false; µ.modal.notify('Global', { duration: 0 }); µ.modal.notify('Appel', { duration: 0, swipe: true })`)
      assert.equal(await marque('mjs-toast-swipe', 0), false)
      assert.equal(await marque('mjs-toast-swipe', 1), true)
      const p = await prendre(1)
      await tirerA(p, 60)
      proche((await boite(1)).x, p.x0 + 60, 'celui de l\'appel suit')
      await tirerA(p, 0)
      await page.mouse.up()
    })
  })

  describe('prefers-reduced-motion: reduce', function () {
    it('le toast suit encore la souris, mais ne revient pas en glissant : d\'un coup', async function () {
      if (!present) { this.skip(); return }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await poser(`µ.modal.notify('Calme', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 50)
      proche((await boite()).x, p.x0 + 50, 'il suit')
      await lacher()
      proche((await boite()).x, p.x0, 'revenu d\'un coup, sans les 200 ms de glisse')
      assert.equal(await page.evaluate(`document.querySelector('.mjs-toast').className.includes('sliding')`), false)
    })

    it('au-delà du seuil il se ferme sans mouvement : aucune sortie animée', async function () {
      if (!present) { this.skip(); return }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await poser(`µ.modal.notify('Calme', { duration: 0 })`)
      const p = await prendre()
      await tirerA(p, 140)
      await lacher()
      assert.equal(await nombre(), 0, 'fermé tout de suite, sans attendre la glisse')
    })
  })

  if (nom === 'chromium') describe('au doigt (événements tactiles du protocole)', function () {
    let contexte: any
    let tactile: any
    let cdp: any

    before(async function () {
      if (!present) return
      contexte = await browser.newContext({ viewport: { width: 900, height: 700 }, hasTouch: true })
      tactile  = await contexte.newPage()
      tactile.setDefaultTimeout(8000)
      tactile.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      await tactile.route(`${ORIGINE}/**`, (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE.replace('<body style="margin:0">', '<body style="margin:0;width:3000px;height:2000px">') }))
      cdp = await contexte.newCDPSession(tactile)
    })

    after(async () => { if (contexte) await contexte.close() })

    const doigts = async (type: string, points: Array<{ x: number; y: number; id: number }>): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : points })
    }
    const doigt = (type: string, x: number, y: number): Promise<void> => doigts(type, [{ x, y, id: 1 }])
    const geste = async (x0: number, y0: number, x1: number, y1: number, pas = 8): Promise<void> => {
      await doigt('touchStart', x0, y0)
      for (let i = 1; i <= pas; i++) await doigt('touchMove', x0 + ((x1 - x0) * i) / pas, y0 + ((y1 - y0) * i) / pas)
      await tactile.waitForFunction(IMMOBILE)
      await doigt('touchEnd', x1, y1)
    }
    // page neuve avec n toasts posés, rendus et validés par la mise en page (un doigt posé avant la première image tomberait sur la page) ;
    // rend le centre de chacun
    const depart = async (n = 1): Promise<Array<{ x: number; y: number; x0: number }>> => {
      await tactile.goto(`${ORIGINE}/`)
      await tactile.addScriptTag({ content: SCRIPT })
      await tactile.addStyleTag({ content: ':root{--mjs-toast-entree-duree:.01s}' })
      await tactile.evaluate(MOUVEMENTS)
      await tactile.evaluate(`(async () => {
        for (let i = 0; i < ${n}; i++) µ.modal.notify('Doigt ' + i, { duration: 0 })
        await Promise.all(document.getAnimations().filter((a) => a.animationName === 'mjs-toast-entree').map((a) => a.finished.catch(() => 0)))
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })()`)
      const boites = await tactile.evaluate(`[...document.querySelectorAll('.mjs-toast')].map((t) => { const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })`)
      return boites.map((b: any) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, x0: b.x }))
    }

    it('un geste horizontal glisse le toast et le ferme, sans faire défiler la page', async function () {
      if (!present) { this.skip(); return }
      const [p] = await depart()
      await geste(p.x, p.y, p.x + 160, p.y)
      await tactile.waitForFunction(`document.querySelectorAll('.mjs-toast').length === 0`)
      assert.equal(await tactile.evaluate(`window.scrollX`), 0, 'la page n\'a pas défilé à l\'horizontale (touch-action: pan-y)')
    })

    it('un geste vertical reste un défilement : le toast ne bouge pas', async function () {
      if (!present) { this.skip(); return }
      const [p] = await depart()
      await geste(p.x, p.y, p.x + 2, p.y + 120)
      const b = await tactile.evaluate(`document.querySelector('.mjs-toast').getBoundingClientRect().x`)
      proche(b, p.x0, 'immobile')
      assert.equal(await tactile.evaluate(`document.querySelectorAll('.mjs-toast').length`), 1)
    })

    it('un geste horizontal trop court ramène le toast à sa place', async function () {
      if (!present) { this.skip(); return }
      const [p] = await depart()
      await geste(p.x, p.y, p.x + 40, p.y)
      await tactile.waitForFunction(`!document.querySelector('.mjs-toast').classList.contains('mjs-toast-sliding')`)
      const b = await tactile.evaluate(`document.querySelector('.mjs-toast').getBoundingClientRect().x`)
      proche(b, p.x0, 'revenu')
      assert.equal(await tactile.evaluate(`document.querySelectorAll('.mjs-toast').length`), 1)
    })

    it('un second doigt (non primaire) est ignoré : deux toasts ne se tirent pas à la fois', async function () {
      if (!present) { this.skip(); return }
      const [a, b] = await depart(2)
      const f1 = { x: a.x, y: a.y, id: 1 }
      const f2 = { x: b.x, y: b.y, id: 2 }
      await doigts('touchStart', [f1])
      await doigts('touchStart', [f1, f2])
      for (let i = 1; i <= 8; i++) await doigts('touchMove', [{ ...f1, x: f1.x + 15 * i }, { ...f2, x: f2.x + 15 * i }])
      await tactile.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))`)
      const xs = await tactile.evaluate(`[...document.querySelectorAll('.mjs-toast')].map((t) => t.getBoundingClientRect().x)`)
      proche(xs[0], a.x0 + 120, 'le premier doigt tire le premier toast')
      proche(xs[1], b.x0, 'le second doigt ne tire pas le second toast')
      assert.equal(await tactile.evaluate(`document.querySelectorAll('.mjs-toast')[1].classList.contains('mjs-toast-dragging')`), false)
      await doigts('touchEnd', [])
    })
  })
})
