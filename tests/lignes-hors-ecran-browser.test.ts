// `@offscreen` au navigateur réel, dans les trois moteurs : une liste de 2 000 lignes dont celles hors de l'écran ne sont ni mises en page ni
// peintes. Chaque ligne porte `content-visibility: auto` et sa place réservée (24px) : la liste a sa hauteur dès le départ, une ligne plus haute
// (deux lignes de texte) se mesure 24px tant qu'elle est sautée, sa vraie hauteur une fois vue, et la garde ensuite (le navigateur la retient) ;
// l'événement `contentvisibilityautostatechange` arrive à son gestionnaire `@…` ; l'effet `on: view` d'une ligne sautée attend qu'elle soit à
// l'écran ; le focus et la touche Tab atteignent une ligne sautée ; une liste à clé retournée garde ses lignes. La recherche de la page trouve une
// ligne sautée : elle se joue sur le composant monté sans ombre (`mjs-light`, la règle passe alors par la feuille du document), car `window.find`
// de WebKit ne fouille jamais une ombre, lignes sautées ou non. Les limites que la doc écrit : ce qui déborde de la balise est rogné (un badge à
// cheval sur son bord, la puce d'une balise `display: list-item`, une balise `position: fixed`, placée par rapport à la ligne), pas ce qui est
// posé sur une balise autour ni une bulle `popover` ; des lignes de même hauteur (réservée exactement, ou fixée en CSS) donnent la vraie hauteur
// dès le départ, et un saut au bout montre la dernière ligne ; des hauteurs différentes font grandir la liste à mesure qu'elle paraît, et de
// nouveaux sauts atteignent la dernière ligne. Les pixels se comptent sur une capture de la fenêtre, lue dans un canevas de la page. Et l'exemple
// de `docs/05-blocs.md`, compilé tel quel : la touche Fin y montre la dernière de ses 10 000 lignes, la hauteur de la liste inchangée
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, compilerScript, moteurPresent, ouvrirPage } from './helpers/navigateurs-compiles.js'

const SOURCE = `<script lang="coffee">
$rows = ({ id: i, n: "Ligne #{i}", deux: i is 1500, f: i is 1 or i is 1800 } for i in [1..2000])
inverser = -> $rows = $rows.slice().reverse()
noter = (id, s) -> window.__cv[id] = s
</script>
<style>
:host
  display: block
.liste
  margin: 0
  padding: 0
.ligne
  margin: 0
  padding: 0
  font: 16px/24px sans-serif
.f
  display: inline-block
  width: 20px
  height: 20px
  vertical-align: top
</style>
<button class="inv" @click={inverser()}>inverser</button>
<div class="liste">{for r in $rows by id}<div class="ligne" :offscreen data-id={r.id} @contentvisibilityautostatechange={noter(r.id, e.skipped)}><span class="t" *tracking(on: view)>{r.n}</span>{if r.deux}<br>suite{end}{if r.f}<span class="f" tabindex="0"></span>{end}</div>{end}</div>
`

// les limites : badges (témoin, sur la balise @offscreen, sur une balise autour), balise fixe et bulle popover (témoin, dans une ligne
// @offscreen), puce d'une balise `display: list-item` (témoin, avec @offscreen), trois listes défilantes de 3 000 lignes (48px réservés pour 48px, hauteur fixée en CSS, hauteurs de 24 et 60px pour 24 réservés)
const LIMITES = `<script lang="coffee">
$n = ({ id: i, t: "L#{i}", g: i % 2 is 0 } for i in [1..3000])
</script>
<style>
:host
  display: block
  font: 16px/20px sans-serif
.deb, .pos, .boites
  display: flex
.deb
  margin-top: 20px
.r
  position: relative
  width: 100px
  height: 24px
  margin: 0 10px 0 0
.badge
  position: absolute
  left: 60px
  top: -14px
  width: 30px
  height: 14px
  background: red
.r2
  width: 40px
  height: 24px
.fixe
  position: fixed
  width: 30px
  height: 30px
  background: blue
.fx0
  left: 700px
  top: 10px
.fx1
  left: 740px
  top: 10px
.pop
  position: fixed
  inset: auto
  margin: 0
  padding: 0
  border: 0
  width: 30px
  height: 30px
  background: green
.pp0
  left: 700px
  top: 60px
.pp1
  left: 740px
  top: 60px
.it
  display: list-item
  margin-left: 40px
  height: 24px
.boites
  margin-top: 10px
.boite
  width: 105px
  height: 300px
  overflow: auto
  margin-right: 5px
  white-space: nowrap
.l48
  display: block
  height: 48px
.w
  height: 48px
.l
  display: block
  height: 24px
.p
  display: block
  height: 36px
</style>
<div class="deb">
  <div class="r b0"><span class="badge"></span>A</div>
  <div class="r b1" :offscreen=24><span class="badge"></span>B</div>
  <div class="r b2"><span class="badge"></span><div :offscreen=24>C</div></div>
</div>
<div class="pos">
  <div class="r2"><span class="fixe fx0"></span><div popover="manual" class="pop pp0"></div></div>
  <div class="r2" :offscreen=24><span class="fixe fx1"></span><div popover="manual" class="pop pp1"></div></div>
</div>
<div class="items"><div class="it it0">x</div><div class="it it1" :offscreen=24>y</div></div>
<div class="boites">
  <div class="boite s1">{for r in $n by id}<div :offscreen=48><b class="l48">{r.t}</b></div>{end}</div>
  <div class="boite s2">{for r in $n by id}<div class="w" :offscreen>{r.t}</div>{end}</div>
  <div class="boite s3">{for r in $n by id}<div :offscreen><b class="l">{r.t}</b>{if r.g}<i class="p"></i>{end}</div>{end}</div>
</div>
`

// le premier exemple de la section « Longues listes » de la doc, tel qu'il y est écrit
const DOC     = readFileSync(new URL('../docs/05-blocs.md', import.meta.url), 'utf-8')
const SECTION = DOC.slice(DOC.indexOf('### Longues listes — `:offscreen`'))
const EXEMPLE = (/```html\n([\s\S]*?)```/.exec(SECTION) ?? [])[1] ?? ''

// pixels peints (ni blancs ni presque blancs) par zone [gauche, haut, largeur, hauteur], sur la capture passée ; sauts au bout d'une liste
// défilante, répétés jusqu'à voir sa dernière ligne
const OUTILS = `
  window.__hote   = (nom) => { const h = document.querySelector(nom); return h._shadow || h }
  window.__images = () => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(f, 250))))
  window.__compter = async (b64, zones) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width  = img.width
    c.height = img.height
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(img, 0, 0)
    const peints = (l, t, w, h) => { const d = x.getImageData(l, t, w, h).data; let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 600) k++; return k }
    const out = {}
    for (const [cle, liste] of Object.entries(zones)) out[cle] = liste.map((q) => peints(...q))
    return out
  }
  window.__vue   = (box) => { const d = box.lastElementChild.getBoundingClientRect(), b = box.getBoundingClientRect(); return d.top >= b.top - 1 && d.bottom <= b.bottom + 1 }
  window.__sauts = async (sel) => {
    const box = window.__hote('mjs-limites').querySelector(sel), h0 = box.scrollHeight, hs = []
    for (let i = 1; i <= 10; i++) {
      box.scrollTop = box.scrollHeight
      await window.__images()
      hs.push(box.scrollHeight)
      if (window.__vue(box)) {
        box.scrollTop = box.scrollHeight
        await window.__images()
        return { h0, hs, sauts: i, stable: box.scrollHeight === hs[hs.length - 1] && window.__vue(box) }
      }
    }
    return { h0, hs, sauts: null, stable: false }
  }
`

describe('@offscreen au navigateur : lignes hors de l\'écran sautées, sans rien perdre', function () {
  this.timeout(180000)
  let script = ''
  before(async () => { script = await compilerScript('lignes-hors-ecran', { 'longue.mjs': SOURCE, 'limites.mjs': LIMITES }) })
  after(async () => { await terminateSharedWorkerPool() })

  // la page du composant, avec ou sans ombre, ses 2 000 lignes posées ; `__ombre()` : là où vivent les lignes (l'hôte lui-même sans ombre)
  const monter = async (moteur: any, leger: boolean) => {
    const ouverte = await ouvrirPage(moteur, `<script>window.__cv = {}</script><mjs-longue${leger ? ' mjs-light' : ''}></mjs-longue>`, script)
    const page    = ouverte.page
    await page.setViewportSize({ width: 800, height: 600 })
    await page.addScriptTag({ content: `
      window.__ombre = () => { const h = document.querySelector('mjs-longue'); return h._shadow || h }
      window.__ligne = (id) => window.__ombre().querySelector('.ligne[data-id="' + id + '"]')
      window.__haut  = (id) => window.__ligne(id).getBoundingClientRect().height
      window.__liste = () => window.__ombre().querySelector('.liste').getBoundingClientRect().height
      window.__voir  = (id) => { const r = window.__ligne(id).getBoundingClientRect(); window.scrollBy(0, r.top - 100) }
    ` })
    await page.waitForFunction(() => (window as any).__ombre()?.querySelectorAll('.ligne').length === 2000)
    return ouverte
  }

  for (const moteur of MOTEURS) {
    it(`${moteur} : place réservée, taille retenue, événement, effet, focus, Tab, liste retournée, recherche`, async function () {
      if (!(await moteurPresent(moteur))) this.skip()
      let { browser, page, erreurs } = await monter(moteur, false)
      try {
        // la règle du composant est sur chaque ligne
        const style = await page.evaluate(() => {
          const s = getComputedStyle((window as any).__ligne(1000))
          return { cv: s.getPropertyValue('content-visibility'), cis: s.getPropertyValue('contain-intrinsic-height') }
        })
        assert.equal(style.cv, 'auto', 'content-visibility')
        assert.match(style.cis, /auto 24px/, 'contain-intrinsic-height')
        // la place réservée compte pour chaque ligne pas encore vue : 2 000 lignes de 24px, la ligne 1500, haute de deux lignes de texte, comptée
        // 24px tant qu'elle est sautée
        await page.waitForTimeout(300)
        assert.equal(await page.evaluate(() => (window as any).__liste()), 48000, 'hauteur de la liste au départ')
        assert.equal(await page.evaluate(() => (window as any).__haut(1500)), 24, 'getBoundingClientRect d\'une ligne sautée : la place réservée')
        await page.waitForFunction(() => (window as any).__cv[2000] === true)
        // l'effet `on: view` d'une ligne sautée attend ; celui d'une ligne à l'écran se joue
        await page.waitForFunction(() => !(window as any).__ligne(1).querySelector('.t').hasAttribute('mjs-fx-wait'))
        assert.equal(await page.evaluate(() => (window as any).__ligne(1500).querySelector('.t').hasAttribute('mjs-fx-wait')), true, 'effet d\'une ligne sautée en attente')
        // vue : sa vraie hauteur, l'événement dit « plus sautée », son effet se joue
        await page.evaluate(() => (window as any).__voir(1500))
        await page.waitForFunction(() => (window as any).__cv[1500] === false)
        await page.waitForFunction(() => (window as any).__haut(1500) === 48)
        await page.waitForFunction(() => !(window as any).__ligne(1500).querySelector('.t').hasAttribute('mjs-fx-wait'))
        assert.equal(await page.evaluate(() => (window as any).__liste()), 48024, 'la liste grandit de la vraie hauteur de la ligne vue, rien de plus')
        // de nouveau hors de l'écran : sautée, elle garde la hauteur vue (`auto`), la barre ne bouge plus
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForFunction(() => (window as any).__cv[1500] === true)
        assert.equal(await page.evaluate(() => (window as any).__haut(1500)), 48, 'taille retenue une fois vue')
        assert.equal(await page.evaluate(() => (window as any).__liste()), 48024, 'hauteur stable après le retour en haut')
        // focus : une ligne sautée reçoit le focus, elle est dessinée
        assert.equal(await page.evaluate(() => (window as any).__cv[1800]), true, 'la ligne 1800 est sautée avant le focus')
        await page.evaluate(() => (window as any).__ligne(1).querySelector('.f').focus())
        await page.keyboard.press('Tab')
        await page.waitForFunction(() => (window as any).__ombre().activeElement === (window as any).__ligne(1800).querySelector('.f'))
        await page.waitForFunction(() => (window as any).__cv[1800] === false)
        const vue = await page.evaluate(() => { const r = (window as any).__ligne(1800).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
        assert.equal(vue, true, 'la ligne atteinte par Tab est amenée à l\'écran')
        await page.evaluate(() => { (document.activeElement as any)?.blur?.(); window.scrollTo(0, 0) })
        // liste à clé retournée : les lignes restent les mêmes balises, sautées ou dessinées selon leur place
        const avant = await page.evaluateHandle(() => (window as any).__ligne(2000))
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.evaluate(() => (window as any).__ombre().querySelector('.inv').click())
        await page.waitForFunction(() => (window as any).__ombre().querySelector('.ligne').dataset.id === '2000')
        assert.ok(await page.evaluate((a: any) => a === (window as any).__ligne(2000), avant), 'la ligne 2000 est la même balise')
        await page.waitForFunction(() => (window as any).__cv[2000] === false && (window as any).__cv[1] === true)
        assert.equal(await page.evaluate(() => [...(window as any).__ombre().querySelectorAll('.ligne')].every((l: any) => l.getAttribute('mjs-offscreen') === '24px')), true, 'chaque ligne garde l\'attribut')
        assert.equal(await page.evaluate(() => (window as any).__liste()), 48024, 'hauteur stable après le retournement')
        assert.deepEqual(erreurs, [])
        await browser.close();
        ({ browser, page, erreurs } = await monter(moteur, true))
        // sans ombre : la règle vient de la feuille du document ; la recherche de la page trouve le texte d'une ligne sautée
        assert.equal(await page.evaluate(() => getComputedStyle((window as any).__ligne(1999)).getPropertyValue('content-visibility')), 'auto', 'content-visibility sans ombre')
        await page.waitForFunction(() => (window as any).__cv[1999] === true)
        assert.equal(await page.evaluate(() => (window as any).find('Ligne 1999')), true, 'window.find trouve le texte d\'une ligne sautée')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })

    it(`${moteur} : ce qui déborde est rogné, hauteurs fixes exactes, hauteurs différentes atteintes en sautant de nouveau`, async function () {
      if (!(await moteurPresent(moteur))) this.skip()
      const { browser, page, erreurs } = await ouvrirPage(moteur, '<mjs-limites></mjs-limites>', script)
      try {
        await page.setViewportSize({ width: 800, height: 600 })
        await page.addScriptTag({ content: OUTILS })
        await page.waitForFunction(() => (window as any).__hote('mjs-limites')?.querySelectorAll('.s3 > div').length === 3000)
        await page.evaluate(() => (window as any).__hote('mjs-limites').querySelectorAll('.pop').forEach((p: any) => p.showPopover()))
        await page.evaluate(() => (window as any).__images())
        await page.waitForTimeout(300)
        const capture = (await page.screenshot()).toString('base64')
        const n       = await page.evaluate(async (b64: string) => {
          const o     = (window as any).__hote('mjs-limites')
          const zone  = (sel: string) => { const r = o.querySelector(sel).getBoundingClientRect(); return [[Math.round(r.left), Math.round(r.top), 30, 14]] }
          const puce  = (sel: string) => { const r = o.querySelector(sel).getBoundingClientRect(); return [[Math.round(r.left) - 30, Math.round(r.top), 28, 24]] }
          const zones = { b0: zone('.b0 .badge'), b1: zone('.b1 .badge'), b2: zone('.b2 .badge'), it0: puce('.it0'), it1: puce('.it1'), fixe: [[700, 10, 30, 30], [740, 10, 30, 30]], pop: [[700, 60, 30, 30], [740, 60, 30, 30]] }
          return (window as any).__compter(b64, zones)
        }, capture)
        assert.ok(n.b0[0] > 0, `le badge témoin, sans @offscreen, se voit (${JSON.stringify(n)})`)
        assert.equal(n.b1[0], 0, 'le badge qui déborde de la balise @offscreen est rogné, la ligne à l\'écran')
        assert.equal(n.b2[0], n.b0[0], 'posé sur une balise autour de celle qui porte @offscreen, le badge se voit')
        assert.ok(n.it0[0] > 0, 'la puce témoin d\'une balise display: list-item se voit')
        assert.equal(n.it1[0], 0, 'la puce d\'une balise display: list-item qui porte @offscreen est rognée')
        assert.ok(n.fixe[0] > 0, 'la balise fixe témoin se voit')
        assert.equal(n.fixe[1], 0, 'une balise fixe dans une ligne @offscreen est rognée')
        const place = await page.evaluate(() => {
          const f = (window as any).__hote('mjs-limites').querySelector('.fx1')
          const a = f.getBoundingClientRect(), l = f.parentElement.getBoundingClientRect()
          return [Math.round(a.left - l.left), Math.round(a.top - l.top)]
        })
        assert.deepEqual(place, [740, 10], 'une balise fixe dans une ligne @offscreen se place par rapport à la ligne')
        assert.ok(n.pop[0] > 0, 'la bulle popover témoin se voit')
        assert.equal(n.pop[1], n.pop[0], 'une bulle popover ouverte dans une ligne @offscreen se voit')
        // même hauteur : réservée exactement, ou fixée en CSS (qui l'emporte sur les 24px réservés) — la vraie hauteur dès le départ
        const exacte = { h0: 144000, hs: [144000], sauts: 1, stable: true }
        assert.deepEqual(await page.evaluate(() => (window as any).__sauts('.s1')), exacte, 'lignes de 48px, 48px réservés')
        assert.deepEqual(await page.evaluate(() => (window as any).__sauts('.s2')), exacte, 'hauteur fixée en CSS, 24px réservés')
        // hauteurs différentes : la liste grandit à mesure que ses lignes paraissent, de nouveaux sauts atteignent la dernière, puis plus rien ne bouge
        const s3 = await page.evaluate(() => (window as any).__sauts('.s3'))
        assert.ok(s3.sauts !== null, `la dernière ligne atteinte en sautant de nouveau (${JSON.stringify(s3)})`)
        assert.ok(s3.hs[s3.hs.length - 1] > s3.h0, `la liste a grandi à mesure que ses lignes paraissaient (${JSON.stringify(s3)})`)
        assert.equal(s3.stable, true, 'une fois au bout, la hauteur ne bouge plus')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })

    it(`${moteur} : l'exemple de docs/05-blocs.md, tel quel`, async function () {
      if (!(await moteurPresent(moteur))) this.skip()
      assert.ok(EXEMPLE.includes(':offscreen'), 'exemple trouvé dans docs/05-blocs.md')
      const exemple = await compilerScript('lignes-hors-ecran-doc', { 'classement.mjs': EXEMPLE })
      const { browser, page, erreurs } = await ouvrirPage(moteur, '<mjs-classement></mjs-classement>', exemple)
      try {
        await page.setViewportSize({ width: 800, height: 600 })
        await page.waitForFunction(() => { const h: any = document.querySelector('mjs-classement'); return (h._shadow || h).querySelectorAll('[mjs-offscreen]').length === 10000 }, null, { timeout: 15000 })
        await page.evaluate(() => {
          const h: any = document.querySelector('mjs-classement')
          const w: any = window
          w.__lignes   = [...(h._shadow || h).querySelectorAll('[mjs-offscreen]')]
          w.__hauteur  = () => w.__lignes[9999].getBoundingClientRect().bottom - w.__lignes[0].getBoundingClientRect().top
          w.__vue      = () => { const d = w.__lignes[9999].getBoundingClientRect(); return d.top >= 0 && d.bottom <= innerHeight }
        })
        await page.waitForTimeout(300)
        assert.equal(await page.evaluate(() => (window as any).__hauteur()), 480000, 'la vraie hauteur dès le départ : 10 000 lignes de 48px')
        // la touche Fin : la dernière ligne se voit, la liste garde sa hauteur
        await page.keyboard.press('End')
        await page.waitForFunction(() => (window as any).__vue(), null, { timeout: 5000 })
        await page.waitForTimeout(300)
        const r = await page.evaluate(() => {
          const w: any = window
          return { premiere: w.__lignes[0].textContent.trim(), derniere: w.__lignes[9999].textContent.trim(), cv: getComputedStyle(w.__lignes[5000]).getPropertyValue('content-visibility'), h1: w.__hauteur(), vue: w.__vue() }
        })
        assert.deepEqual(r, { premiere: '1. Joueur 1', derniere: '10000. Joueur 10000', cv: 'auto', h1: 480000, vue: true })
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
