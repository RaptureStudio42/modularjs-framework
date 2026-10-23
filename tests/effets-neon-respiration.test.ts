// *neon(breathe) — le halo respire : il va et vient entre un quart de sa taille et sa taille, un aller-retour
// par `speed`, sans jamais s'éteindre. Avec les défauts, `*neon` reste ce qu'il était (les règles d'avant sont
// dans la feuille mot pour mot, les valeurs calculées dans Chromium sont celles d'avant). Côté texte, la partie
// large de la lueur est un calque (la copie du texte, sous le texte) dont seule l'opacité bouge ; côté cadre
// (box, both), la lueur entière est un second calque (::after) dont seule l'opacité bouge, la balise gardant le
// quart ; au plus fort de la respiration, le halo est celui du néon fixe (comparé pixel à pixel, hors du texte) ;
// au plus faible, il est resserré. Aucune image n'est recalculée ni peinte pendant la respiration (trace de
// Chromium). Un champ, un composant, un cadre que son overflow rogne : l'ombre elle-même respire (un calque
// dedans serait coupé). Une balise sans texte n'anime aucun texte. Rien ne tourne au repos (néon allumé au
// survol, balise hors de l'écran), « réduire les animations » fige le halo à sa taille, le retrait ne laisse rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const FICHIER = readFileSync(join(ICI, '../src/runtime/mjs_fx_neon.ts'), 'utf-8')

async function navigateurPresent(nom: 'chromium' | 'firefox' = 'chromium'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// les règles du néon sans la respiration, telles qu'elles sont écrites (sa transition s'ajoute à celle de l'auteur)
const REGLES_D_AVANT = [
  '[mjs-fx~="neon"]{--mjs-fx-neon:0 0 calc(4px * var(--mjs-neon-size,1)) var(--mjs-neon-core,#fff),0 0 calc(10px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(22px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(44px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff)}',
  '[mjs-fx~="neon"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}',
  '[mjs-fx~="neon"][mjs-fx-on~="neon"]:not([mjs-fx-neon-where="box"]){color:var(--mjs-neon-core,#fff);text-shadow:var(--mjs-fx-neon)}',
  '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-where="box"],[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-where="both"]{box-shadow:var(--mjs-fx-neon)}',
  '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-flicker]{animation:mjs-fx-neon-flicker var(--mjs-neon-speed,3s) infinite}',
  '@keyframes mjs-fx-neon-flicker{0%,18%,22%,25%,53%,57%,100%{opacity:1}20%,24%,55%{opacity:.4}}'
]

const STYLE = `<style>
.fond
  display: flex
  gap: 170px
  padding: 70px 60px
  background: #05060a
  align-items: flex-start
.n
  margin: 0
  padding: 0 14px
  height: 44px
  box-sizing: border-box
  font: 700 28px/44px sans-serif
  color: #fff
.btn
  display: flex
  align-items: center
  justify-content: center
  width: 160px
  height: 60px
  border: 0
  background: transparent
.multi
  width: 200px
  height: auto
  font: 700 22px/30px sans-serif
.haut
  height: 3000px
.bord
  width: 150px
  border: 3px solid #889
  border-radius: 10px
.rogne
  overflow: hidden
  border-radius: 10px
</style>`

const LONG = 'Un texte néon assez long pour passer sur plusieurs lignes dans sa boîte'
const deux = (a: string, b: string, classe = 'n', contenu = 'Respire', balise = 'h2') => `<div class="fond"><${balise} class="${classe} a" ${a}>${contenu}</${balise}><${balise} class="${classe} b" ${b}>${contenu}</${balise}></div>\n${STYLE}`

const SOURCES: Record<string, string> = {
  'nr-texte.mjs':   deux('*neon(#f00)', '*neon(#f00, breathe: true, speed: 1.5s)'),
  'nr-bouton.mjs':  deux('*neon(#0ff)', '*neon(#0ff, breathe: true)', 'n btn', 'Centré', 'button'),
  'nr-multi.mjs':   deux('*neon(#fa0)', '*neon(#fa0, breathe: true)', 'n multi', LONG, 'p'),
  'nr-cadre.mjs':   deux('*neon(#f00, where: box)', '*neon(#f00, where: box, breathe: true)'),
  'nr-deux.mjs':    deux('*neon(#f00, where: both)', '*neon(#f00, where: both, breathe: true)'),
  'nr-champ.mjs':   `<div class="fond"><input class="n a" *neon(#0ff) aria-label="a" value="champ"><input class="n b" *neon(#0ff, breathe: true) aria-label="b" value="champ"></div>\n${STYLE}`,
  'nr-vide.mjs':    `<div class="fond"><div class="n a" *neon(#0ff)><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div><div class="n b" *neon(#0ff, breathe: true)><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div></div>\n${STYLE}`,
  'nr-survol.mjs':  deux('*neon(#f0f, on: hover)', '*neon(#f0f, breathe: true, on: hover)'),
  'nr-loin.mjs':    `<div class="haut"></div><div class="fond"><h2 class="n a" *neon(#f00)>Loin</h2><h2 class="n b" *neon(#f00, breathe: true)>Loin</h2></div>\n${STYLE}`,
  'nr-grille.mjs':  deux('*neon(#f00, flicker: true)', '*neon(#f00, breathe: true, flicker: true)'),
  'nr-cadre-grille.mjs': deux('*neon(#f00, where: box, flicker: true)', '*neon(#f00, where: box, breathe: true, flicker: true)'),
  'nr-var.mjs':     `<script>\n$titre = 'Un'\n$vitesse = '3s'\n$resp = false\n</script>\n<div class="fond"><h2 class="n b" *neon(#f00, breathe: $resp, speed: $vitesse)>{$titre}</h2></div>\n<button class="t" @click={$titre = 'Deux mots'}>t</button><button class="v" @click={$vitesse = '2s'}>v</button><button class="r" @click={$resp = true}>r</button>\n${STYLE}`,
  'nr-cadre-bord.mjs':  deux('*neon(#f00, where: box)', '*neon(#f00, where: box, breathe: true)', 'n bord'),
  'nr-deux-bord.mjs':   deux('*neon(#f00, where: both)', '*neon(#f00, where: both, breathe: true)', 'n bord'),
  'nr-cadre-rogne.mjs': deux('*neon(#f00, where: box)', '*neon(#f00, where: box, breathe: true)', 'n rogne'),
  'nr-vide-cadre.mjs':  `<div class="fond"><div class="n a" *neon(#0ff, where: both)></div><div class="n b" *neon(#0ff, where: both, breathe: true)></div></div>\n${STYLE}`,
  'nr-tard.mjs':        `<script>\n$titre = ''\n</script>\n<div class="fond"><h2 class="n b" *neon(#f00, breathe: true)>{$titre}</h2></div>\n<button class="t" @click={$titre = 'Arrivé'}>t</button>\n${STYLE}`,
  'nr-bloc.mjs':    `<script>\n$on = true\n</script>\n{if $on}\n<span class="n b" *neon(#f00, where: both, breathe: true)>Texte</span>\n{end}\n<button class="t" @click={$on = !$on}>t</button>\n${STYLE}`
}

// ce que le néon d'avant écrivait, au repos et allumé (valeurs calculées lues dans Chromium sur l'arbre d'avant)
// l'écart moyen toléré (trois canaux) entre un cadre qui respire, au plus fort, et le cadre fixe
const SEUIL_CADRE = 6

const OMBRE_NEON = 'rgb(255, 255, 255) 0px 0px 4px, rgb(0, 255, 255) 0px 0px 10px, rgb(0, 255, 255) 0px 0px 22px, rgb(0, 255, 255) 0px 0px 44px'

describe('*neon(breathe) — le halo qui respire', function () {
  this.timeout(180000)
  let script  = ''
  let present = false

  before(async () => {
    present = await navigateurPresent()
    const root   = mjsTmp('effets-neon-respiration')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  describe('le catalogue et la feuille de l\'effet', () => {
    it('breathe : un booléen faux par défaut ; les règles d\'avant sont dans la feuille, mot pour mot ; les images clés restent dans l\'espace mjs-fx-', () => {
      const r = EFFECTS.neon.settings.breathe
      assert.equal(r.rule, 'bool')
      assert.equal(r.dflt, false)
      assert.ok(!r.inside, 'une balise sans texte (un champ, un cadre) respire aussi : pas de refus au build')
      for (const regle of REGLES_D_AVANT) assert.ok(FICHIER.includes(regle), 'règle modifiée : ' + regle.slice(0, 60))
      const noms = [...FICHIER.matchAll(/@keyframes (\S+?)\{/g)].map((m) => m[1])
      assert.deepEqual(noms.sort(), ['mjs-fx-neon-breathe', 'mjs-fx-neon-breathe-box', 'mjs-fx-neon-breathe-text', 'mjs-fx-neon-flicker'])
    })
  })

  describe('dans un composant (happy-dom)', () => {
    let window: any
    before(() => {
      window = new Window({ url: 'http://localhost/' })
      window.eval(script)
    })
    after(() => { window?.close?.() })

    const monte = async (tag: string, classe = 'b') => {
      window.document.body.innerHTML = `<${tag}></${tag}>`
      const comp = window.document.querySelector(tag)
      const fin  = Date.now() + 3000
      while (!comp._shadow?.querySelector('.' + classe) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      return comp
    }
    const marques = (el: any) => ({ respire: el.getAttribute('mjs-fx-neon-breathe'), texte: el.getAttribute('mjs-fx-neon-text') })

    it('sans breathe : aucune marque de respiration ; avec : le mode suit où se pose le halo et ce que la balise porte', async () => {
      const a = (await monte('mjs-nr-texte', 'a'))._shadow.querySelector('.a')
      assert.deepEqual(marques(a), { respire: null, texte: null })
      assert.equal(a.hasAttribute('mjs-fx-neon-away'), false)
      assert.deepEqual(marques((await monte('mjs-nr-texte'))._shadow.querySelector('.b')), { respire: 'layer', texte: 'Respire' }, 'du texte propre : un calque')
      assert.deepEqual(marques((await monte('mjs-nr-cadre'))._shadow.querySelector('.b')), { respire: 'frame', texte: null }, 'le cadre : un calque')
      assert.deepEqual(marques((await monte('mjs-nr-deux'))._shadow.querySelector('.b')), { respire: 'layer frame', texte: 'Respire' }, 'les deux : le calque du texte et celui du cadre')
      assert.deepEqual(marques((await monte('mjs-nr-champ'))._shadow.querySelector('.b')), { respire: 'text', texte: null }, 'un champ : son ombre')
      assert.deepEqual(marques((await monte('mjs-nr-vide'))._shadow.querySelector('.b')), { respire: '', texte: '' }, 'aucun texte propre : rien à faire respirer')
      assert.deepEqual(marques((await monte('mjs-nr-vide-cadre'))._shadow.querySelector('.b')), { respire: 'frame', texte: '' }, 'sans texte, les deux : le seul cadre')
    })

    it('un cadre sans bordure n\'écrit aucune variable de décalage (celui qui rogne, et celui qui a une bordure, se prouvent dans les navigateurs réels)', async () => {
      const sans = (await monte('mjs-nr-cadre'))._shadow.querySelector('.b')
      assert.equal(sans.style.getPropertyValue('--mjs-fx-neon-inset'), '', 'aucune bordure, aucune variable')
    })

    it('une balise vide qui reçoit son texte plus tard : rien ne respire d\'abord, le calque du texte apparaît avec lui', async () => {
      const comp = await monte('mjs-nr-tard')
      const el   = comp._shadow.querySelector('.b')
      assert.deepEqual(marques(el), { respire: '', texte: '' }, 'vide : aucun calque')
      comp._shadow.querySelector('.t').click()
      const fin = Date.now() + 3000
      while (el.getAttribute('mjs-fx-neon-breathe') !== 'layer' && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      assert.deepEqual(marques(el), { respire: 'layer', texte: 'Arrivé' })
    })

    it('une variable de l\'appli : speed suit sur place sans reposer l\'effet ; breathe reprend l\'effet, et le texte copié suit le texte', async () => {
      const comp = await monte('mjs-nr-var')
      const el   = comp._shadow.querySelector('.b')
      const off  = el._mjs_fxOff.neon
      assert.equal(el.getAttribute('mjs-fx-neon-breathe'), null)
      assert.equal(el.style.getPropertyValue('--mjs-neon-speed'), '3s')
      comp._shadow.querySelector('.v').click()
      let fin = Date.now() + 3000
      while (el.style.getPropertyValue('--mjs-neon-speed') !== '2s' && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      assert.equal(el.style.getPropertyValue('--mjs-neon-speed'), '2s')
      assert.ok(el._mjs_fxOff.neon === off, 'la vitesse change sans reposer l\'effet')
      comp._shadow.querySelector('.r').click()
      fin = Date.now() + 3000
      while (el.getAttribute('mjs-fx-neon-breathe') === null && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      assert.equal(el.getAttribute('mjs-fx-neon-breathe'), 'layer')
      assert.equal(el.getAttribute('mjs-fx-neon-text'), 'Un')
      comp._shadow.querySelector('.t').click()
      fin = Date.now() + 3000
      while (el.getAttribute('mjs-fx-neon-text') !== 'Deux mots' && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      assert.equal(el.getAttribute('mjs-fx-neon-text'), 'Deux mots', 'le texte réactif est recopié')
    })

    it('retiré avec sa balise ({if} refermé) : ni marque, ni variable, ni position ou affichage changés', async () => {
      const comp = await monte('mjs-nr-bloc')
      const el   = comp._shadow.querySelector('.b')
      assert.equal(el.getAttribute('mjs-fx-neon-breathe'), 'layer frame')
      comp._shadow.querySelector('.t').click()
      const fin = Date.now() + 3000
      while (comp._shadow.querySelector('.b') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
      assert.ok(!/--mjs-|position|display/.test(el.getAttribute('style') ?? ''), 'reste : ' + el.getAttribute('style'))
    })
  })

  describe('navigateurs réels', () => {
    async function ouvre(browser: any, tag: string, reduit = false) {
      const page = await browser.newPage({ viewport: { width: 700, height: 500 }, reducedMotion: reduit ? 'reduce' : 'no-preference' })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#05060a;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.b'), tag)
      await page.waitForTimeout(400)
      return { page, erreurs }
    }

    // les valeurs calculées d'une balise (ou de son ::before), lues d'un coup
    const lit = (page: any, tag: string, classe: string, pseudo?: string) => page.evaluate(([t, c, p]: [string, string, string | undefined]) => {
      const el = (document.querySelector(t) as any)._shadow.querySelector('.' + c)
      const cs = getComputedStyle(el, p)
      return { ombreTexte: cs.textShadow, ombreCadre: cs.boxShadow, animation: cs.animationName, duree: cs.animationDuration, etat: cs.animationPlayState, position: cs.position, isolation: cs.isolation, opacite: cs.opacity, contenu: cs.content, transition: cs.transitionProperty, couleur: cs.color }
    }, [tag, classe, pseudo])

    // les animations en cours dans le composant : leur nom, leur cible, leur durée
    const animations = (page: any, tag: string, classe?: string) => page.evaluate(([t, c]: [string, string | undefined]) => (document.querySelector(t) as any)._shadow.getAnimations({ subtree: true }).filter((a: any) => a.animationName && (!c || a.effect.target.classList.contains(c))).map((a: any) => `${a.animationName}@${a.effect.pseudoElement || 'balise'}:${a.effect.getComputedTiming().duration}`).sort(), [tag, classe])

    // fige les respirations à une fraction de leur aller-retour (0 : le plus faible, 0,5 : le plus fort)
    const fige = (page: any, tag: string, f: number) => page.evaluate(([t, fr]: [string, number]) => {
      for (const a of (document.querySelector(t) as any)._shadow.getAnimations({ subtree: true })) {
        a.pause()
        a.currentTime = /breathe/.test(a.animationName) ? a.effect.getComputedTiming().duration * fr : 0
      }
    }, [tag, f])

    // l'écart moyen et maximal des pixels du halo (hors de la boîte de la balise, où est le texte) entre
    // la balise fixe `.a` et la balise `.b` : chacune dans sa clip, avec 60 px de halo autour
    // zone 'bord' : la bande de 3 px à l'intérieur de la boîte (la bordure, hors des coins arrondis), où la lueur ne doit jamais passer
    async function ecartHalo(page: any, tag: string, zone: 'dehors' | 'bord' = 'dehors') {
      const boite = (c: string) => page.evaluate(([t, k]: string[]) => { const r = (document.querySelector(t) as any)._shadow.querySelector('.' + k).getBoundingClientRect(); return { x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height) } }, [tag, c])
      const clip = (b: any) => ({ x: b.x - 60, y: b.y - 60, width: b.w + 120, height: b.h + 120 })
      const a = await boite('a')
      const b = await boite('b')
      const pa = await page.screenshot({ clip: clip(a) })
      const pb = await page.screenshot({ clip: clip(b) })
      return page.evaluate(async ([x, y, w, h, z]: [string, string, number, number, string]) => {
        const lire = async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const c = cv.getContext('2d') as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          return { d: c.getImageData(0, 0, cv.width, cv.height).data, l: cv.width }
        }
        const p = await lire(x)
        const q = await lire(y)
        let n = 0, somme = 0, max = 0
        for (let i = 0; i < p.d.length; i += 4) {
          const px = (i / 4) % p.l, py = Math.floor(i / 4 / p.l)
          const dedans = px >= 60 && px < 60 + w && py >= 60 && py < 60 + h
          const liseré = dedans && (px < 63 || px >= 57 + w || py < 63 || py >= 57 + h)
          // la bande ne compte pas les coins arrondis : l'arête du calque y est adoucie d'un autre pas que celle de la bordure
          const coin = (px < 72 || px >= 48 + w) && (py < 72 || py >= 48 + h)
          if (z === 'dehors' ? dedans : !liseré || coin) continue
          const e = Math.abs(p.d[i] - q.d[i]) + Math.abs(p.d[i + 1] - q.d[i + 1]) + Math.abs(p.d[i + 2] - q.d[i + 2])
          somme += e; n++
          if (e > max) max = e
        }
        return { moyenne: somme / n, max }
      }, [pa.toString('base64'), pb.toString('base64'), a.w, a.h, zone])
    }

    // la luminosité (rouge + vert + bleu) d'un pixel de la page, à gauche de la balise `.b`, au milieu de sa hauteur
    async function lueur(page: any, tag: string, ecart: number) {
      const r = await page.evaluate((t: string) => { const b = (document.querySelector(t) as any)._shadow.querySelector('.b').getBoundingClientRect(); return { x: Math.floor(b.left), y: Math.floor(b.top + b.height / 2) } }, tag)
      const png = await page.screenshot({ clip: { x: r.x - ecart, y: r.y, width: 1, height: 1 } })
      return page.evaluate(async (b64: string) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = 1; cv.height = 1
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const d = c.getImageData(0, 0, 1, 1).data
        return d[0] + d[1] + d[2]
      }, png.toString('base64'))
    }

    const navigateur = async (nom: 'chromium' | 'firefox' = 'chromium') => { const playwright = await import('playwright'); return playwright[nom].launch() }

    it('sans breathe : les valeurs calculées sont celles d\'avant (ombres, couleur, transitions, animation du grésillement)', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-nr-texte')
        const a = await lit(page, 'mjs-nr-texte', 'a')
        assert.equal(a.ombreTexte, 'rgb(255, 255, 255) 0px 0px 4px, rgb(255, 0, 0) 0px 0px 10px, rgb(255, 0, 0) 0px 0px 22px, rgb(255, 0, 0) 0px 0px 44px')
        assert.equal(a.ombreCadre, 'none')
        assert.equal(a.animation, 'none')
        assert.equal(a.transition, 'text-shadow, box-shadow, color')
        assert.equal(a.position, 'static')
        assert.equal(a.isolation, 'auto')
        assert.equal((await lit(page, 'mjs-nr-texte', 'a', '::before')).contenu, 'none', 'aucun pseudo-élément')
        assert.deepEqual(await animations(page, 'mjs-nr-texte', 'a'), [], 'le néon fixe n\'a aucune animation')
        const g = await ouvre(browser, 'mjs-nr-grille')
        assert.equal((await lit(g.page, 'mjs-nr-grille', 'a')).animation, 'mjs-fx-neon-flicker')
        assert.equal((await lit(g.page, 'mjs-nr-grille', 'a')).duree, '3s')
        const c = await ouvre(browser, 'mjs-nr-cadre')
        assert.equal((await lit(c.page, 'mjs-nr-cadre', 'a')).ombreCadre, 'rgb(255, 255, 255) 0px 0px 4px 0px, rgb(255, 0, 0) 0px 0px 10px 0px, rgb(255, 0, 0) 0px 0px 22px 0px, rgb(255, 0, 0) 0px 0px 44px 0px')
        assert.equal((await lit(c.page, 'mjs-nr-cadre', 'a')).ombreTexte, 'none')
        assert.deepEqual([...erreurs, ...g.erreurs, ...c.erreurs], [])
      } finally {
        await browser.close()
      }
    })

    it('texte : la lueur est coupée en deux — le cœur sur la balise, la partie large dans un calque sous le texte dont l\'opacité va de 0 à 1 et revient en `speed`', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-nr-texte')
        const b = await lit(page, 'mjs-nr-texte', 'b')
        assert.equal(b.ombreTexte, 'rgb(255, 255, 255) 0px 0px 4px, rgb(255, 0, 0) 0px 0px 10px', 'le cœur de la lueur reste sur la balise')
        assert.equal(b.isolation, 'isolate')
        assert.equal(b.position, 'relative')
        assert.equal(b.animation, 'none', 'la balise elle-même n\'est pas animée')
        const calque = await lit(page, 'mjs-nr-texte', 'b', '::before')
        assert.equal(calque.ombreTexte, 'rgb(255, 0, 0) 0px 0px 22px, rgb(255, 0, 0) 0px 0px 44px', 'la partie large est sur le calque')
        assert.match(calque.contenu, /^"Respire"/)
        assert.equal(calque.animation, 'mjs-fx-neon-breathe')
        assert.equal(calque.duree, '1.5s')
        assert.deepEqual(await animations(page, 'mjs-nr-texte'), ['mjs-fx-neon-breathe@::before:1500'])
        const images = await page.evaluate(() => (document.querySelector('mjs-nr-texte') as any)._shadow.getAnimations({ subtree: true })[0].effect.getKeyframes().map((k: any) => `${k.offset}:${k.opacity}`))
        assert.deepEqual(images, ['0:0', '0.5:1', '1:0'], 'un aller-retour : de rien à tout, et retour')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('au plus fort de la respiration, le halo est celui du néon fixe — texte (une ligne, plusieurs lignes, bouton centré), cadre, les deux ; au plus faible, il est resserré', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const mesures: Record<string, any> = {}
        for (const tag of ['mjs-nr-texte', 'mjs-nr-bouton', 'mjs-nr-multi', 'mjs-nr-cadre', 'mjs-nr-deux']) {
          const { page, erreurs } = await ouvre(browser, tag)
          await fige(page, tag, 0.5)
          await page.waitForTimeout(150)
          const fort = await ecartHalo(page, tag)
          await fige(page, tag, 0)
          await page.waitForTimeout(150)
          const faible = await ecartHalo(page, tag)
          mesures[tag] = { fort, faible }
          assert.deepEqual(erreurs, [])
        }
        // l'écart du plus fort est du bruit d'arrondi (moins de 3 sur trois canaux, en moyenne) ; celui du plus faible,
        // où la partie large de la lueur manque, est nettement au-dessus (le maximal n'est pas comparé : sur un cadre,
        // le bord de la boîte tombe à une fraction de pixel différente d'une balise à l'autre)
        for (const [tag, m] of Object.entries(mesures)) {
          // un cadre : la petite ombre de la balise transparaît de quelques niveaux sous le calque (6 % au bord)
          const seuil = /cadre|deux/.test(tag) ? SEUIL_CADRE : 3
          assert.ok(m.fort.moyenne < seuil, `${tag} : au plus fort, le halo doit être celui du néon fixe (écart moyen ${m.fort.moyenne.toFixed(2)})`)
          assert.ok(m.faible.moyenne > 1.5 * m.fort.moyenne && m.faible.moyenne > 0.7, `${tag} : au plus faible, le halo doit être nettement plus petit (écart moyen ${m.faible.moyenne.toFixed(2)} contre ${m.fort.moyenne.toFixed(2)})`)
        }
      } finally {
        await browser.close()
      }
    })

    it('la lueur gonfle puis se resserre : loin du texte, le pixel est éteint au plus faible et allumé au plus fort, et rien ne s\'éteint tout à fait près du texte', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const { page } = await ouvre(browser, 'mjs-nr-texte')
        await fige(page, 'mjs-nr-texte', 0)
        await page.waitForTimeout(150)
        const loinFaible = await lueur(page, 'mjs-nr-texte', 0)
        const presFaible = await lueur(page, 'mjs-nr-texte', -11)
        await fige(page, 'mjs-nr-texte', 0.5)
        await page.waitForTimeout(150)
        const loinFort = await lueur(page, 'mjs-nr-texte', 0)
        const presFort = await lueur(page, 'mjs-nr-texte', -11)
        const fond = 5 + 6 + 10
        assert.ok(loinFaible <= fond + 3, `à 14 px du texte, la lueur est éteinte au plus faible (${loinFaible})`)
        assert.ok(loinFort >= loinFaible + 8, `à 14 px du texte, la lueur est là au plus fort (${loinFort} contre ${loinFaible})`)
        assert.ok(presFaible >= fond + 8, `à 3 px du texte, la lueur ne s'éteint jamais (${presFaible})`)
        assert.ok(presFort > presFaible, `à 3 px du texte, le plus fort l'est plus (${presFort} contre ${presFaible})`)
      } finally {
        await browser.close()
      }
    })

    it('un champ, ou un cadre que son overflow rogne : l\'ombre elle-même respire, du quart de la lueur à la lueur entière ; une balise sans texte ne fait respirer aucun texte', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const champ = await ouvre(browser, 'mjs-nr-champ')
        assert.deepEqual(await animations(champ.page, 'mjs-nr-champ'), ['mjs-fx-neon-breathe-text@balise:3000'])
        await fige(champ.page, 'mjs-nr-champ', 0.5)
        assert.equal((await lit(champ.page, 'mjs-nr-champ', 'b')).ombreTexte, OMBRE_NEON, 'au plus fort : la lueur entière')
        await fige(champ.page, 'mjs-nr-champ', 0)
        assert.equal((await lit(champ.page, 'mjs-nr-champ', 'b')).ombreTexte, 'rgb(255, 255, 255) 0px 0px 1px, rgb(0, 255, 255) 0px 0px 2.5px, rgb(0, 255, 255) 0px 0px 5.5px, rgb(0, 255, 255) 0px 0px 11px', 'au plus faible : un quart')
        const vide = await ouvre(browser, 'mjs-nr-vide')
        assert.deepEqual(await animations(vide.page, 'mjs-nr-vide'), [], 'aucun texte à faire respirer : aucune animation')
        const rogne = await ouvre(browser, 'mjs-nr-cadre-rogne')
        assert.deepEqual(await animations(rogne.page, 'mjs-nr-cadre-rogne'), ['mjs-fx-neon-breathe-box@balise:3000'])
        await fige(rogne.page, 'mjs-nr-cadre-rogne', 0)
        assert.equal((await lit(rogne.page, 'mjs-nr-cadre-rogne', 'b')).ombreCadre, 'rgb(255, 255, 255) 0px 0px 1px 0px, rgb(255, 0, 0) 0px 0px 2.5px 0px, rgb(255, 0, 0) 0px 0px 5.5px 0px, rgb(255, 0, 0) 0px 0px 11px 0px')
        await fige(rogne.page, 'mjs-nr-cadre-rogne', 0.5)
        assert.equal((await lit(rogne.page, 'mjs-nr-cadre-rogne', 'b')).ombreCadre, 'rgb(255, 255, 255) 0px 0px 4px 0px, rgb(255, 0, 0) 0px 0px 10px 0px, rgb(255, 0, 0) 0px 0px 22px 0px, rgb(255, 0, 0) 0px 0px 44px 0px')
        assert.equal((await lit(rogne.page, 'mjs-nr-cadre-rogne', 'b')).ombreTexte, 'none', 'un néon de cadre ne touche pas au texte')
        assert.deepEqual([...champ.erreurs, ...vide.erreurs, ...rogne.erreurs], [])
      } finally {
        await browser.close()
      }
    })

    it('avec flicker, les deux jouent ensemble au même rythme : texte, cadre et les deux', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const texte = await ouvre(browser, 'mjs-nr-grille')
        assert.deepEqual(await animations(texte.page, 'mjs-nr-grille', 'b'), ['mjs-fx-neon-breathe@::before:3000', 'mjs-fx-neon-flicker@balise:3000'])
        assert.equal((await lit(texte.page, 'mjs-nr-grille', 'a')).animation, 'mjs-fx-neon-flicker', 'le néon fixe grésille comme avant')
        const cadre = await ouvre(browser, 'mjs-nr-cadre-grille')
        assert.deepEqual(await animations(cadre.page, 'mjs-nr-cadre-grille', 'b'), ['mjs-fx-neon-breathe@::after:3000', 'mjs-fx-neon-flicker@balise:3000'])
        const deux = await ouvre(browser, 'mjs-nr-deux')
        assert.deepEqual(await animations(deux.page, 'mjs-nr-deux', 'b'), ['mjs-fx-neon-breathe@::after:3000', 'mjs-fx-neon-breathe@::before:3000'])
        assert.deepEqual([...texte.erreurs, ...cadre.erreurs, ...deux.erreurs], [])
      } finally {
        await browser.close()
      }
    })

    it('rien ne tourne au repos : allumé au survol, il ne joue qu\'au survol ; hors de l\'écran, la respiration est en pause', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-nr-survol')
        assert.deepEqual(await animations(page, 'mjs-nr-survol'), [], 'au repos : aucune animation')
        const p = await page.evaluate(() => { const r = (document.querySelector('mjs-nr-survol') as any)._shadow.querySelector('.b').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 } })
        await page.mouse.move(p.x, p.y)
        await page.waitForTimeout(500)
        assert.deepEqual(await animations(page, 'mjs-nr-survol'), ['mjs-fx-neon-breathe@::before:3000'], 'survolé : il respire')
        await page.mouse.move(2, 2)
        await page.waitForTimeout(700)
        assert.deepEqual(await animations(page, 'mjs-nr-survol'), [], 'sorti : plus rien')
        const loin = await ouvre(browser, 'mjs-nr-loin')
        assert.equal((await lit(loin.page, 'mjs-nr-loin', 'b', '::before')).etat, 'paused', 'hors de l\'écran : en pause')
        assert.equal(await loin.page.evaluate(() => (document.querySelector('mjs-nr-loin') as any)._shadow.querySelector('.b').hasAttribute('mjs-fx-neon-away')), true)
        await loin.page.evaluate(() => (document.querySelector('mjs-nr-loin') as any)._shadow.querySelector('.b').scrollIntoView())
        await loin.page.waitForTimeout(500)
        assert.equal((await lit(loin.page, 'mjs-nr-loin', 'b', '::before')).etat, 'running', 'de retour à l\'écran : il repart')
        assert.equal(await loin.page.evaluate(() => (document.querySelector('mjs-nr-loin') as any)._shadow.querySelector('.b').hasAttribute('mjs-fx-neon-away')), false)
        assert.deepEqual([...erreurs, ...loin.erreurs], [])
      } finally {
        await browser.close()
      }
    })

    it('« réduire les animations » : plus rien ne bouge, la lueur reste à sa taille (la grande), texte comme cadre', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const t = await ouvre(browser, 'mjs-nr-texte', true)
        assert.deepEqual(await animations(t.page, 'mjs-nr-texte'), [])
        assert.equal((await lit(t.page, 'mjs-nr-texte', 'b', '::before')).opacite, '1', 'le calque montre la partie large')
        await t.page.waitForTimeout(100)
        t.page.setDefaultTimeout(5000)
        await fige(t.page, 'mjs-nr-texte', 0.5)
        const fort = await ecartHalo(t.page, 'mjs-nr-texte')
        assert.ok(fort.moyenne < 3, `figé, le halo est celui du néon fixe (écart moyen ${fort.moyenne.toFixed(2)})`)
        const c = await ouvre(browser, 'mjs-nr-cadre', true)
        assert.deepEqual(await animations(c.page, 'mjs-nr-cadre'), [])
        assert.equal((await lit(c.page, 'mjs-nr-cadre', 'b', '::after')).opacite, '1', 'le calque du cadre montre la lueur entière')
        c.page.setDefaultTimeout(5000)
        await fige(c.page, 'mjs-nr-cadre', 0.5)
        const cadreFort = await ecartHalo(c.page, 'mjs-nr-cadre')
        assert.ok(cadreFort.moyenne < SEUIL_CADRE, `figé, le cadre est celui du néon fixe (écart moyen ${cadreFort.moyenne.toFixed(2)})`)
        const r = await ouvre(browser, 'mjs-nr-cadre-rogne', true)
        assert.equal((await lit(r.page, 'mjs-nr-cadre-rogne', 'b')).ombreCadre, (await lit(r.page, 'mjs-nr-cadre-rogne', 'a')).ombreCadre, 'un cadre qui rogne : l\'ombre entière')
        const ch = await ouvre(browser, 'mjs-nr-champ', true)
        assert.equal((await lit(ch.page, 'mjs-nr-champ', 'b')).ombreTexte, (await lit(ch.page, 'mjs-nr-champ', 'a')).ombreTexte)
        assert.deepEqual([...t.erreurs, ...c.erreurs, ...ch.erreurs], [])
      } finally {
        await browser.close()
      }
    })

    it('le texte copié suit le texte, la vitesse suit sa variable : l\'animation prend la nouvelle durée sans repartir de zéro', async function () {
      if (!present) { this.skip(); return }
      const browser = await navigateur()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-nr-var')
        await page.evaluate(() => (document.querySelector('mjs-nr-var') as any)._shadow.querySelector('.r').click())
        await page.waitForTimeout(200)
        assert.deepEqual(await animations(page, 'mjs-nr-var'), ['mjs-fx-neon-breathe@::before:3000'])
        await page.evaluate(() => (document.querySelector('mjs-nr-var') as any)._shadow.querySelector('.v').click())
        await page.waitForTimeout(200)
        assert.deepEqual(await animations(page, 'mjs-nr-var'), ['mjs-fx-neon-breathe@::before:2000'])
        await page.evaluate(() => (document.querySelector('mjs-nr-var') as any)._shadow.querySelector('.t').click())
        await page.waitForTimeout(200)
        assert.match((await lit(page, 'mjs-nr-var', 'b', '::before')).contenu, /^"Deux mots"/)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // ------------------------------------------------------------------------------------------------
    // le cadre (box, both) : un calque dont seule l'opacité bouge, dans les deux navigateurs
    // ------------------------------------------------------------------------------------------------
    for (const nom of ['chromium', 'firefox'] as const) {
      describe(`${nom} — le cadre respire par l'opacité d'un calque`, () => {
        let ici = false
        before(async () => { ici = await navigateurPresent(nom) })

        it('cadre, les deux : seul un calque (::after pour le cadre, ::before pour le texte) est animé, en opacité ; la balise elle-même ne bouge pas', async function () {
          if (!ici) { this.skip(); return }
          const browser = await navigateur(nom)
          try {
            const c = await ouvre(browser, 'mjs-nr-cadre')
            assert.deepEqual(await animations(c.page, 'mjs-nr-cadre', 'b'), ['mjs-fx-neon-breathe@::after:3000'])
            const b = await lit(c.page, 'mjs-nr-cadre', 'b')
            assert.equal(b.animation, 'none', 'la balise n\'est pas animée')
            assert.equal(b.isolation, 'isolate')
            assert.equal(b.position, 'relative')
            assert.equal(b.ombreCadre, 'rgb(255, 255, 255) 0px 0px 1px 0px, rgb(255, 0, 0) 0px 0px 2.5px 0px, rgb(255, 0, 0) 0px 0px 5.5px 0px, rgb(255, 0, 0) 0px 0px 11px 0px', 'la balise garde le quart de la lueur')
            const calque = await lit(c.page, 'mjs-nr-cadre', 'b', '::after')
            assert.equal(calque.ombreCadre, 'rgb(255, 255, 255) 0px 0px 4px 0px, rgb(255, 0, 0) 0px 0px 10px 0px, rgb(255, 0, 0) 0px 0px 22px 0px, rgb(255, 0, 0) 0px 0px 44px 0px', 'le calque porte la lueur entière')
            assert.equal(calque.animation, 'mjs-fx-neon-breathe')
            const images = await c.page.evaluate(() => (document.querySelector('mjs-nr-cadre') as any)._shadow.querySelector('.b').getAnimations({ subtree: true })[0].effect.getKeyframes().map((k: any) => `${k.offset}:${k.opacity}`))
            assert.deepEqual(images, ['0:0', '0.5:1', '1:0'], 'de rien à tout, et retour : seule l\'opacité')
            const d = await ouvre(browser, 'mjs-nr-deux')
            assert.deepEqual(await animations(d.page, 'mjs-nr-deux', 'b'), ['mjs-fx-neon-breathe@::after:3000', 'mjs-fx-neon-breathe@::before:3000'])
            assert.deepEqual([...c.erreurs, ...d.erreurs], [])
          } finally {
            await browser.close()
          }
        })

        it('au plus fort le cadre est le néon fixe, au plus faible il est resserré — sans bordure, avec une bordure de 3 px (le calque part du bord extérieur), les deux', async function () {
          if (!ici) { this.skip(); return }
          const browser = await navigateur(nom)
          try {
            const mesures: Record<string, any> = {}
            for (const tag of ['mjs-nr-cadre', 'mjs-nr-cadre-bord', 'mjs-nr-deux-bord', 'mjs-nr-cadre-rogne']) {
              const { page, erreurs } = await ouvre(browser, tag)
              await fige(page, tag, 0.5)
              await page.waitForTimeout(150)
              const fort = await ecartHalo(page, tag)
              await fige(page, tag, 0)
              await page.waitForTimeout(150)
              const faible = await ecartHalo(page, tag)
              mesures[tag] = { fort, faible }
              assert.deepEqual(erreurs, [])
            }
            for (const [tag, m] of Object.entries(mesures)) {
              assert.ok(m.fort.moyenne < SEUIL_CADRE, `${nom} ${tag} : au plus fort, le halo doit être celui du néon fixe (écart moyen ${m.fort.moyenne.toFixed(2)})`)
              assert.ok(m.faible.moyenne > 1.5 * m.fort.moyenne && m.faible.moyenne > 0.7, `${nom} ${tag} : au plus faible, le halo doit être nettement plus petit (écart moyen ${m.faible.moyenne.toFixed(2)} contre ${m.fort.moyenne.toFixed(2)})`)
            }
            // la bordure de 3 px reste celle du cadre fixe : le calque part de son bord extérieur, la lueur ne la recouvre pas
            // (un cadre seul : la lueur du texte, plus bas, se pose en Chromium d'un autre pas que celle du texte fixe)
            const { page } = await ouvre(browser, 'mjs-nr-cadre-bord')
            await fige(page, 'mjs-nr-cadre-bord', 0.5)
            await page.waitForTimeout(150)
            const bord = await ecartHalo(page, 'mjs-nr-cadre-bord', 'bord')
            assert.ok(bord.moyenne < 1, `${nom} : la bordure doit rester celle du cadre fixe (écart moyen ${bord.moyenne.toFixed(2)})`)
          } finally {
            await browser.close()
          }
        })

        it('une balise sans texte ne fait respirer aucun texte : rien (texte), le seul cadre (les deux) ; son texte arrivé plus tard respire', async function () {
          if (!ici) { this.skip(); return }
          const browser = await navigateur(nom)
          try {
            const v = await ouvre(browser, 'mjs-nr-vide')
            assert.deepEqual(await animations(v.page, 'mjs-nr-vide'), [], 'texte, rien dedans : aucune animation')
            const vc = await ouvre(browser, 'mjs-nr-vide-cadre')
            assert.deepEqual(await animations(vc.page, 'mjs-nr-vide-cadre', 'b'), ['mjs-fx-neon-breathe@::after:3000'], 'les deux, rien dedans : le seul cadre')
            assert.equal((await lit(vc.page, 'mjs-nr-vide-cadre', 'b')).ombreTexte !== 'none', true)
            const t = await ouvre(browser, 'mjs-nr-tard')
            assert.deepEqual(await animations(t.page, 'mjs-nr-tard'), [], 'vide : aucune animation')
            await t.page.evaluate(() => (document.querySelector('mjs-nr-tard') as any)._shadow.querySelector('.t').click())
            await t.page.waitForTimeout(300)
            assert.deepEqual(await animations(t.page, 'mjs-nr-tard'), ['mjs-fx-neon-breathe@::before:3000'], 'le texte est arrivé : il respire')
            assert.deepEqual([...v.erreurs, ...vc.erreurs, ...t.erreurs], [])
          } finally {
            await browser.close()
          }
        })
      })
    }

    // ------------------------------------------------------------------------------------------------
    // la trace de Chromium : pendant la respiration, aucune image n'est recalculée ni peinte
    // ------------------------------------------------------------------------------------------------
    describe('Chromium — la trace de la respiration', () => {
      // ce que Chromium fait pendant `ms` : recalculs de style, mises en page, pré-peintures et peintures
      async function trace(browser: any, page: any, ms: number) {
        await browser.startTracing(page, { categories: ['devtools.timeline'] })
        await page.waitForTimeout(ms)
        const octets = await browser.stopTracing()
        const n: Record<string, number> = { UpdateLayoutTree: 0, Layout: 0, PrePaint: 0, Paint: 0 }
        for (const e of JSON.parse(octets.toString()).traceEvents) if (e.ph !== 'E' && e.name in n) n[e.name]++
        return n
      }

      it('texte (calque), cadre, les deux : zéro recalcul de style et zéro peinture pendant 2 s de respiration ; le champ (l\'ombre elle-même) en fait des dizaines — la mesure voit bien ce qu\'elle compte', async function () {
        if (!present) { this.skip(); return }
        const browser = await navigateur()
        try {
          const n: Record<string, Record<string, number>> = {}
          for (const tag of ['mjs-nr-texte', 'mjs-nr-cadre', 'mjs-nr-deux', 'mjs-nr-cadre-bord', 'mjs-nr-champ']) {
            const { page, erreurs } = await ouvre(browser, tag)
            await page.waitForTimeout(700)
            n[tag] = await trace(browser, page, 2000)
            assert.deepEqual(erreurs, [])
            await page.close()
          }
          for (const tag of ['mjs-nr-texte', 'mjs-nr-cadre', 'mjs-nr-deux', 'mjs-nr-cadre-bord']) {
            const m = n[tag]
            assert.ok(m.UpdateLayoutTree + m.Layout + m.PrePaint + m.Paint <= 6, `${tag} : la respiration ne doit rien recalculer ni peindre (${JSON.stringify(m)})`)
          }
          assert.ok(n['mjs-nr-champ'].Paint >= 20, `le témoin : l'ombre réécrite d'un champ se peint à chaque image (${JSON.stringify(n['mjs-nr-champ'])})`)
        } finally {
          await browser.close()
        }
      })
    })
  })
})
