// Les transitions au survol (`on: hover`) dans des navigateurs réels : la balise est cachée au repos sans quitter
// la mise en page (ni clic ni lecture d'écran), entre quand la souris arrive sur son parent et sort quand elle le
// quitte, avec la transition de son nom (*fade, *fly, *scale, *iris, *blocks) ; la souris qui revient en route
// repart de l'état courant, sans saut ; le clavier, `of`, un bloc {if} ouvert sous la souris, la balise à la racine
// d'un composant, « réduire les animations » et l'écran tactile ; une fois fini, la balise n'a plus ni animation ni
// style, et le parent exactement les quatre écouteurs du repos (aucun de plus, aucun après le retrait).
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// cinq cartes dont la légende suit le survol de sa carte, chacune avec une transition d'une autre nature (un fondu,
// un glissement, un zoom, un cercle qui s'ouvre, des tuiles) ; un lien et son « Voir » (le clavier) ; une ligne dont
// le bouton suit toute la ligne (`of`) et un autre qui suit seulement sa boîte d'actions ; un {if} ; une balise à la
// racine du composant (son parent est le composant lui-même)
const SOURCE = [
  '<script>',
  '$ouvert = true',
  '$img = \'data:image/svg+xml,\' + encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#6366f1"/><circle cx="105" cy="32" r="20" fill="#fde047"/></svg>\')',
  '</script>',
  '<div class="rangee">',
  '  <article class="carte" id="c-fade"><img src={$img} alt=""><p class="legende" id="e-fade" *fade(on: hover, duration: 400ms, easing: linear)>fade</p></article>',
  '  <article class="carte" id="c-fly"><img src={$img} alt=""><p class="legende" id="e-fly" *fly(up, on: hover, distance: 60, duration: 400ms, easing: linear)>fly</p></article>',
  '  <article class="carte" id="c-scale"><img src={$img} alt=""><p class="legende" id="e-scale" *scale(on: hover, start: .2, duration: 400ms, easing: linear)>scale</p></article>',
  '  <article class="carte" id="c-iris"><img src={$img} alt=""><p class="legende" id="e-iris" *iris(on: hover, duration: 400ms, easing: linear)>iris</p></article>',
  '  <article class="carte" id="c-blocks"><img src={$img} alt=""><p class="legende" id="e-blocks" *blocks(on: hover, duration: 400ms)>blocks</p></article>',
  '</div>',
  '<div class="rangee">',
  '  <button id="avant">avant</button>',
  '  <a class="tuile" id="t-lien" href="#t"><img src={$img} alt=""><b class="legende" id="e-lien" *fade(on: hover, duration: 200ms)>Voir</b></a>',
  '  <button id="apres">après</button>',
  '  <div class="ligne" id="l-ligne"><span id="nom">Nom</span><div class="actions" id="actions"><button id="e-of" *scale(on: hover, of: \'.ligne\', duration: 200ms)>of</button><button id="e-sans" *scale(on: hover, duration: 200ms)>sans</button></div></div>',
  '</div>',
  '<div class="rangee">',
  '  <article class="carte" id="c-if">{if $ouvert}<p class="legende" id="e-if" *fly(up, on: hover, duration: 200ms)>if</p>{end}</article>',
  '  <button id="bascule" @click={$ouvert = !$ouvert}>bascule</button>',
  '</div>',
  '<p class="racine" id="e-racine" *fade(on: hover, duration: 200ms)>racine</p>',
  '<style>',
  ':host',
  '  display: block',
  '  padding: 10px',
  '.rangee',
  '  display: flex',
  '  gap: 14px',
  '  margin-bottom: 14px',
  '  align-items: flex-start',
  '.carte, .tuile',
  '  position: relative',
  '  display: block',
  '  width: 150px',
  '  height: 100px',
  '  background: #1e293b',
  '.carte img, .tuile img',
  '  display: block',
  '.legende',
  '  position: absolute',
  '  left: 0',
  '  right: 0',
  '  bottom: 0',
  '  margin: 0',
  '  padding: 6px',
  '  background: rgba(15, 23, 42, .85)',
  '  color: #fff',
  '.ligne',
  '  display: flex',
  '  gap: 20px',
  '  width: 330px',
  '  height: 60px',
  '  padding: 8px',
  '  background: #334155',
  '  color: #fff',
  '.actions',
  '  display: flex',
  '  gap: 8px',
  '  margin-left: auto',
  '.racine',
  '  margin: 0',
  '  padding: 6px',
  '  background: #475569',
  '  color: #fff',
  '</style>',
  ''
].join('\n')

// toutes les transitions qui se posent directement, chacune sur sa balise dans sa carte (le tracé de *draw est un <path>, le texte
// de *typewriter un nœud texte seul)
const TOUTES = ['fade', 'fly', 'slide', 'scale', 'rotate', 'blur', 'draw', 'iris', 'wheel', 'volet', 'reveal', 'flip', 'cube', 'turn', 'swipe', 'bars', 'blocks', 'shatter', 'pixelate', 'ink', 'typewriter']
const SOURCE_TOUTES = [
  '<script>',
  '$img = \'data:image/svg+xml,\' + encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#6366f1"/><circle cx="105" cy="32" r="20" fill="#fde047"/></svg>\')',
  '</script>',
  '<div class="grille">',
  ...TOUTES.map((n) => n === 'draw'
    ? '  <div class="carte" id="k-draw"><svg width="150" height="100" viewBox="0 0 150 100"><path id="t-draw" d="M10 10 L140 90" stroke="#fff" stroke-width="6" fill="none" *draw(on: hover, duration: 300ms)></path></svg></div>'
    : n === 'typewriter'
      ? '  <div class="carte" id="k-typewriter"><img src={$img} alt=""><p class="legende" id="t-typewriter" *typewriter(on: hover)>Un texte qui s\'écrit</p></div>'
      : `  <div class="carte" id="k-${n}"><img src={$img} alt=""><p class="legende" id="t-${n}" *${n}(on: hover, duration: 300ms)>${n}</p></div>`),
  '</div>',
  '<style>',
  ':host',
  '  display: block',
  '  padding: 10px',
  '.grille',
  '  display: flex',
  '  flex-wrap: wrap',
  '  gap: 14px',
  '.carte',
  '  position: relative',
  '  width: 150px',
  '  height: 100px',
  '  background: #1e293b',
  '.carte img',
  '  display: block',
  '.legende',
  '  position: absolute',
  '  left: 0',
  '  right: 0',
  '  bottom: 0',
  '  margin: 0',
  '  padding: 6px',
  '  background: rgba(15, 23, 42, .85)',
  '  color: #fff',
  '</style>',
  ''
].join('\n')

// le saut : chaque transition dans sa boîte, en flux normal, entre deux paragraphes (celui d'après dit si la page saute) ; le tracé de
// *draw est un <path> dans un <svg>, le texte de *typewriter un nœud texte seul, l'image de *shatter une <img> ; un *typewriter dont le
// texte est lié à une variable qu'un bouton change, et un autre qui joue à l'arrivée à l'écran, tout en bas de la page
const SOURCE_SAUT = [
  '<script>',
  '$img = \'data:image/svg+xml,\' + encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#6366f1"/><circle cx="105" cy="20" r="14" fill="#fde047"/></svg>\')',
  '$txt = \'Alpha\'',
  '$vu = \'Un\'',
  '</script>',
  '<div class="grille">',
  ...TOUTES.map((n) => {
    const fx = n === 'typewriter' ? '*typewriter(on: hover, duration: 60s)' : `*${n}(on: hover, duration: 60s, easing: linear)`
    const cible = n === 'draw'
      ? `<svg class="trace" id="s-draw" width="150" height="40" viewBox="0 0 150 40"><path id="t-draw" d="M5 5 L145 35" stroke="#fff" stroke-width="6" fill="none" ${fx}></path></svg>`
      : n === 'typewriter'
        ? `<p class="cible" id="t-typewriter" ${fx}>Un texte qui s'écrit</p>`
        : n === 'shatter'
          ? `<img class="cible" id="t-shatter" src={$img} alt="" ${fx}>`
          : `<p class="cible" id="t-${n}" ${fx}>${n}</p>`
    return `  <div class="boite" id="k-${n}"><p class="avant">avant</p>${cible}<p class="apres" id="a-${n}">après</p></div>`
  }),
  '  <div class="boite" id="k-lie"><p class="avant">avant</p><p class="cible" id="t-lie" *typewriter(on: hover, speed: 15)>{$txt}</p><p class="apres" id="a-lie">après</p></div>',
  '  <div class="rangee-x" id="k-slide-x"><span class="avant">avant</span><span class="cible" id="t-slide-x" *slide(axis: x, on: hover, duration: 60s, easing: linear)>glisse</span><span class="apres" id="a-slide-x">après</span></div>',
  '</div>',
  '<button id="change" @click={$txt = \'Beta plus long\'}>change</button>',
  '<button id="change-vu" @click={$vu = \'Deux mots\'}>change vu</button>',
  '<div class="vide"></div>',
  '<p class="cible" id="t-vu" *typewriter(once: false, speed: 15)>{$vu}</p>',
  '<style>',
  ':host',
  '  display: block',
  '  padding: 10px',
  '.grille',
  '  display: flex',
  '  flex-wrap: wrap',
  '  gap: 14px',
  '.boite',
  '  width: 170px',
  '  height: 130px',
  '  background: #1e293b',
  '  color: #fff',
  '.avant, .apres',
  '  margin: 0',
  '  padding: 2px 4px',
  '  font: 12px/16px sans-serif',
  '.cible',
  '  margin: 6px 0',
  '  padding: 8px 4px',
  '  border: 2px solid #64748b',
  '  background: #0f172a',
  '  color: #fff',
  '  font: 12px/16px sans-serif',
  'img.cible',
  '  display: block',
  '  width: 150px',
  '  height: 50px',
  '.trace',
  '  display: block',
  '  margin: 6px 0',
  '.rangee-x',
  '  display: flex',
  '  width: 400px',
  '  height: 60px',
  '  background: #1e293b',
  '  color: #fff',
  '.vide',
  '  height: 1500px',
  '</style>',
  ''
].join('\n')

// dix légendes dans la même carte, que deux boutons réduisent à six puis à aucune
const SOURCE_MULTI = [
  '<script>',
  '$items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }]',
  '</script>',
  '<article class="carte" id="c-multi">{for it in $items by id}<p class="legende" id={\'m\' + it.id} *fade(on: hover, duration: 150ms)>{it.id}</p>{end}</article>',
  '<button id="six" @click={$items = $items.slice(0, 6)}>six</button>',
  '<button id="aucune" @click={$items = []}>aucune</button>',
  '<style>',
  ':host',
  '  display: block',
  '  padding: 10px',
  '.carte',
  '  width: 150px',
  '  height: 220px',
  '  background: #1e293b',
  '  color: #fff',
  '.legende',
  '  margin: 0',
  '  height: 20px',
  '</style>',
  ''
].join('\n')

describe('transitions au survol, `on: hover` (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('effets-survol-navigateur-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vue-survol.mjs'), SOURCE)
    writeFileSync(join(srcDir, 'vue-survol-toutes.mjs'), SOURCE_TOUTES)
    writeFileSync(join(srcDir, 'vue-survol-saut.mjs'), SOURCE_SAUT)
    writeFileSync(join(srcDir, 'vue-survol-multi.mjs'), SOURCE_MULTI)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null
      let page: any = null
      const erreurs: string[] = []

      // la page : le composant, et ses outils de lecture (le shadow root est fermé : on y entre par `_shadow`) ; un compteur
      // d'écouteurs posé AVANT le moteur (chaque addEventListener / removeEventListener passe par lui)
      const ouvre = async (ctx: any, tag = 'mjs-vue-survol', pret = '#e-blocks') => {
        const p = await ctx.newPage()
        p.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        await p.addInitScript(() => {
          const w = window as any
          const ajoute = EventTarget.prototype.addEventListener
          const retire = EventTarget.prototype.removeEventListener
          const capture = (o: any) => typeof o === 'object' && o ? !!o.capture : !!o
          w.__ec = []
          EventTarget.prototype.addEventListener = function (type: string, fn: any, o?: any) {
            w.__ec.push({ t: this, type, fn, capture: capture(o) })
            return ajoute.call(this, type, fn, o)
          }
          EventTarget.prototype.removeEventListener = function (type: string, fn: any, o?: any) {
            const i = w.__ec.findIndex((x: any) => x.t === this && x.type === type && x.fn === fn && x.capture === capture(o))
            if (i >= 0) w.__ec.splice(i, 1)
            return retire.call(this, type, fn, o)
          }
        })
        await p.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        })
        await p.goto('http://t.test/', { waitUntil: 'load' })
        await p.waitForFunction(([t, sel]: string[]) => {
          const sh = (document.querySelector(t) as any)?._shadow
          return !!sh && !!sh.querySelector(sel)
        }, [tag, pret])
        await p.evaluate((tag: string) => {
          const w = window as any
          w.__el = (id: string) => (document.querySelector(tag) as any)._shadow.querySelector('#' + id)
          // ce qu'on voit de la balise : visibilité, opacité, transformation, découpe, animations en cours, marque, style
          w.__etat = (id: string) => {
            const e = w.__el(id)
            if (!e) return null
            const cs = getComputedStyle(e)
            return { vis: cs.visibility, op: Number(cs.opacity), tf: cs.transform, clip: cs.clipPath, filtre: cs.filter, texte: e.textContent, anims: e.getAnimations().length, jeu: !!e._mjs_transition_state, marque: e.getAttribute('mjs-fx-hover'), style: e.getAttribute('style'), attrs: e.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-')) }
          }
          // les <svg> de la scène (celui du tracé de *draw compris) : un filtre laissé derrière lui s'y verrait
          w.__svgs = () => (document.querySelector(tag) as any)._shadow.querySelectorAll('svg').length
          // le nombre d'écouteurs posés sur la balise `id`, et leurs types
          w.__ecouteurs = (id: string) => w.__ec.filter((x: any) => x.t === w.__el(id)).map((x: any) => x.type).sort()
          w.__centre = (id: string) => { const r = w.__el(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
          // gèle le jeu en cours de la balise à la part `p` de sa durée (pas la tenue de départ, qui ne dure pas) ; faux tant
          // qu'il n'a pas commencé
          w.__gele = (id: string, p: number) => {
            const a = w.__el(id).getAnimations().find((x: any) => x.effect.getComputedTiming().duration > 100)
            if (!a) return false
            a.pause()
            a.currentTime = (a.effect.getComputedTiming().duration as number) * p
            return true
          }
          // la souris quitte la carte `carte` : l'événement part dans la même tâche que la lecture de la balise `id`, qui
          // donne donc l'état exact où la sortie démarre
          w.__quitte = (carte: string, id: string) => {
            w.__el(carte).dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
            const cs = getComputedStyle(w.__el(id))
            return { vis: cs.visibility, op: Number(cs.opacity), tf: cs.transform, clip: cs.clipPath }
          }
        }, tag)
        return p
      }

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test du survol sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page = await ouvre(await browser.newContext({ viewport: { width: 900, height: 1000 } }))
      })

      after(async () => {
        if (browser) await browser.close()
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
      })

      const etat = (id: string) => page.evaluate((i: string) => (window as any).__etat(i), id)
      const centre = (id: string) => page.evaluate((i: string) => (window as any).__centre(i), id)
      const vers = async (id: string) => { const c = await centre(id); await page.mouse.move(c.x, c.y) }
      // hors du composant : en bas de la page, sous tout ce qu'il porte
      const dehors = async () => { await page.mouse.move(850, 990) }
      // attend que l'état de la balise `id` vérifie `cond` ; sinon dit où elle en est
      const attend = async (cond: string, id: string, ms = 5000) => {
        try {
          await page.waitForFunction(`(${cond})(window.__etat(${JSON.stringify(id)}))`, null, { timeout: ms })
        }
        catch {
          throw new Error(`${id} n'a jamais vérifié ${cond} : ${JSON.stringify(await etat(id))}`)
        }
      }
      const repos = 'e => e && e.vis === "hidden" && e.marque === "rest" && e.anims === 0'
      const entree = 'e => e && e.vis === "visible" && e.marque === null && e.anims === 0 && e.op === 1'
      const nombres = (css: string) => (css.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)

      // la valeur qu'une transition fait varier, lue sur la balise : une opacité, un zoom, ou les nombres de sa découpe
      const lecture = async (id: string) => {
        const e = await etat(id)
        return { vis: e.vis, op: e.op, tf: e.tf, clip: e.clip }
      }

      for (const [t, juge] of [
        ['fade', (m: any) => m.op > 0.3 && m.op < 0.7],
        ['fly', (m: any) => m.op > 0.3 && m.op < 0.7 && m.tf !== 'none'],
        ['scale', (m: any) => m.op > 0.3 && m.op < 0.7 && nombres(m.tf)[0] > 0.3 && nombres(m.tf)[0] < 0.9],
        ['iris', (m: any) => /^circle\(/.test(m.clip)],
        ['blocks', (m: any) => /^polygon\(/.test(m.clip)]
      ] as Array<[string, (m: any) => boolean]>) {
        it(`*${t} : cachée au repos, hors de portée ; entre au survol, repart d'où elle en est, sort au départ, sans rien laisser`, async function () {
          if (!present) { this.skip(); return }
          const id = 'e-' + t
          // au repos : cachée mais à sa place, aucun clic ne l'atteint, quatre écouteurs sur la carte et aucune animation
          let e = await etat(id)
          assert.equal(e.vis, 'hidden', 'cachée au repos')
          assert.equal(e.marque, 'rest')
          assert.equal(e.anims, 0, 'rien ne joue au repos')
          assert.ok(await page.evaluate((i: string) => (window as any).__el(i).offsetHeight > 0, id), 'la place est gardée')
          assert.equal(await page.evaluate((i: string) => { const c = (window as any).__centre(i); const dessus = (window as any).__el(i).getRootNode().elementFromPoint(c.x, c.y); return dessus === (window as any).__el(i) }, id), false, 'un clic ne l\'atteint pas')
          assert.deepEqual(await page.evaluate((i: string) => (window as any).__ecouteurs(i), 'c-' + t), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'quatre écouteurs sur la carte')
          // le survol de la carte la fait entrer ; gelée à mi-course, elle est entre le caché et le net
          await vers('c-' + t)
          await page.waitForFunction(`window.__gele(${JSON.stringify(id)}, 0.5)`)
          const mi = await lecture(id)
          assert.equal(mi.vis, 'visible', 'visible dès qu\'elle entre')
          assert.ok(juge(mi), `à mi-course : ${JSON.stringify(mi)}`)
          // la souris repart pendant l'entrée : la sortie part de cet état, sans saut
          const apres = await page.evaluate(([c, i]: string[]) => (window as any).__quitte(c, i), ['c-' + t, id])
          assert.equal(apres.vis, 'visible')
          const proches = (a: number[], b: number[], quoi: string) => {
            assert.equal(a.length, b.length, quoi)
            a.forEach((x, k) => assert.ok(Math.abs(x - b[k]) < 0.5, `${quoi} (valeur ${k} : ${x} au lieu de ${b[k]})`))
          }
          if (/^circle|^polygon/.test(mi.clip)) proches(nombres(apres.clip), nombres(mi.clip), `la découpe ne saute pas : ${mi.clip} → ${apres.clip}`)
          else {
            assert.ok(Math.abs(apres.op - mi.op) < 0.02, `l'opacité ne saute pas : ${mi.op} → ${apres.op}`)
            if (mi.tf !== 'none') proches(nombres(apres.tf), nombres(mi.tf), `la transformation ne saute pas : ${mi.tf} → ${apres.tf}`)
          }
          // elle finit de sortir (la vraie souris quitte la carte à son tour : rien de plus à faire) : cachée de nouveau, rien
          // d'animé, rien laissé sur la balise
          await dehors()
          await attend(repos, id)
          e = await etat(id)
          assert.equal(e.style, null, 'aucun style en ligne')
          assert.equal(await page.evaluate((i: string) => (window as any).__ecouteurs(i).length, 'c-' + t), 4, 'toujours quatre écouteurs')
          // la souris revient : l'entrée va jusqu'au bout, la balise est alors une balise comme une autre
          await vers('c-' + t)
          await attend(entree, id)
          e = await etat(id)
          assert.equal(e.style, null, 'aucun style en ligne')
          assert.equal(e.clip, 'none', 'aucune découpe')
          assert.equal(e.tf, 'none', 'aucune transformation')
          await dehors()
          await attend(repos, id)
        })
      }

      it('le clavier compte : le focus qui entre dans le lien la fait entrer, le focus qui en sort la fait sortir', async function () {
        if (!present) { this.skip(); return }
        await dehors()
        await attend(repos, 'e-lien')
        await page.evaluate(() => (window as any).__el('avant').focus())
        await page.keyboard.press('Tab')
        await attend(entree, 'e-lien')
        assert.equal(await page.evaluate(() => (window as any).__el('t-lien') === ((document.querySelector('mjs-vue-survol') as any)._shadow.activeElement)), true, 'le focus est bien sur le lien')
        // le focus qui passe à une balise voisine du parent : il n'en sort pas ; il en sort vers « après »
        await page.keyboard.press('Tab')
        await attend(repos, 'e-lien')
        await page.keyboard.press('Shift+Tab')
        await attend(entree, 'e-lien')
        await page.evaluate(() => (window as any).__el('avant').focus())
        await attend(repos, 'e-lien')
        // le focus reste dans le composant : celui-ci est le parent de la balise à la racine, il la tiendrait ouverte
        await page.evaluate(() => (window as any).__el('avant').blur())
      })

      it('`of` : le bouton suit toute la ligne, celui qui n\'en dit rien suit sa boîte d\'actions', async function () {
        if (!present) { this.skip(); return }
        await dehors()
        await attend(repos, 'e-of')
        await attend(repos, 'e-sans')
        // la souris sur le nom, hors de la boîte d'actions : seul celui qui regarde la ligne entre
        await vers('nom')
        await attend(entree, 'e-of')
        assert.equal((await etat('e-sans')).vis, 'hidden', 'sans `of`, le parent est la boîte d\'actions : le nom n\'y est pas')
        assert.deepEqual(await page.evaluate(() => (window as any).__ecouteurs('l-ligne')), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'les écouteurs sont sur la ligne')
        // la souris dans la boîte d'actions : les deux sont ouverts
        await vers('actions')
        await attend(entree, 'e-sans')
        assert.equal((await etat('e-of')).vis, 'visible')
        await dehors()
        await attend(repos, 'e-of')
        await attend(repos, 'e-sans')
      })

      it('un bloc {if} refermé pendant le survol ne laisse ni écouteur ni marque ; rouvert sous la souris, la balise entre', async function () {
        if (!present) { this.skip(); return }
        await dehors()
        await attend(repos, 'e-if')
        await vers('c-if')
        await attend(entree, 'e-if')
        assert.equal(await page.evaluate(() => (window as any).__ecouteurs('c-if').length), 4)
        await page.evaluate(() => { (window as any).__garde = (window as any).__el('e-if'); (window as any).__el('bascule').click() })
        await page.waitForFunction(() => !(window as any).__el('e-if'))
        const reste = await page.evaluate(() => { const g = (window as any).__garde; return { attrs: g.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), style: g.getAttribute('style'), anims: g.getAnimations().length, ecouteurs: (window as any).__ecouteurs('c-if').length } })
        assert.deepEqual(reste, { attrs: [], style: null, anims: 0, ecouteurs: 0 }, 'ni marque, ni style, ni animation sur la balise retirée, ni écouteur sur la carte')
        // rouvert alors que la souris est encore sur la carte : elle entre sans attendre un nouveau survol
        await page.evaluate(() => (window as any).__el('bascule').click())
        await page.waitForFunction(() => !!(window as any).__el('e-if'))
        await attend(entree, 'e-if')
        assert.equal(await page.evaluate(() => (window as any).__ecouteurs('c-if').length), 4)
        await dehors()
        await attend(repos, 'e-if')
      })

      it('une balise à la racine du composant suit le survol du composant', async function () {
        if (!present) { this.skip(); return }
        await dehors()
        await attend(repos, 'e-racine')
        await page.mouse.move(870, 20)
        await attend(entree, 'e-racine')
        await dehors()
        await attend(repos, 'e-racine')
      })

      it('« réduire les animations » : elle apparaît et disparaît d\'un coup, sans animation', async function () {
        if (!present) { this.skip(); return }
        await page.emulateMedia({ reducedMotion: 'reduce' })
        try {
          await dehors()
          await attend(repos, 'e-fade')
          await vers('c-fade')
          await page.waitForFunction(`window.__etat("e-fade").vis === "visible"`)
          // la lecture suit l'événement de très près : aucune animation n'a été posée, elle est tout de suite nette
          const e = await etat('e-fade')
          assert.deepEqual({ vis: e.vis, op: e.op, anims: e.anims, marque: e.marque }, { vis: 'visible', op: 1, anims: 0, marque: null })
          await dehors()
          await page.waitForFunction(`window.__etat("e-fade").vis === "hidden"`)
          const f = await etat('e-fade')
          assert.deepEqual({ anims: f.anims, marque: f.marque, style: f.style }, { anims: 0, marque: 'rest', style: null })
        }
        finally {
          await page.emulateMedia({ reducedMotion: 'no-preference' })
        }
      })

      it('aucun éclair : à la première image qui suit l\'arrivée de la souris, la balise est déjà au départ de son entrée, pas nette', async function () {
        if (!present) { this.skip(); return }
        for (const [t, lit] of [
          ['fade', () => Number(getComputedStyle((window as any).__el('e-fade')).opacity)],
          ['scale', () => Number(getComputedStyle((window as any).__el('e-scale')).opacity)]
        ] as Array<[string, () => number]>) {
          await dehors()
          await attend(repos, 'e-' + t)
          // l'image qui suit l'événement est celle qui se peint : on la lit dans le rappel de requestAnimationFrame posé à l'arrivée
          const premiere = page.evaluate(`new Promise((ok) => window.addEventListener('pointerenter', () => requestAnimationFrame(() => ok((${lit.toString()})())), { capture: true, once: true }))`)
          await vers('c-' + t)
          const op = await premiere
          assert.ok(op < 0.6, `*${t} : la première image montre la balise à ${op} d'opacité, elle devrait partir de cachée`)
          await dehors()
          await attend(repos, 'e-' + t)
        }
      })

      it('rien ne tourne au repos : aucune animation, aucune image demandée, quatre écouteurs par carte', async function () {
        if (!present) { this.skip(); return }
        await dehors()
        await attend(repos, 'e-fade')
        const rien = await page.evaluate(() => new Promise((ok) => {
          const w = window as any
          let images = 0
          const raf = window.requestAnimationFrame
          window.requestAnimationFrame = function (f: any) { images++; return raf.call(window, f) }
          setTimeout(() => {
            window.requestAnimationFrame = raf
            const sh = (document.querySelector('mjs-vue-survol') as any)._shadow
            ok({ images, animations: sh.getAnimations ? sh.getAnimations().length : -1, cartes: ['c-fade', 'c-fly', 'c-scale', 'c-iris', 'c-blocks', 'c-if', 'l-ligne', 't-lien'].map((i) => w.__ecouteurs(i).length) })
          }, 500)
        }))
        assert.deepEqual(rien, { images: 0, animations: 0, cartes: [4, 4, 4, 4, 4, 4, 4, 4] })
      })

      it('toutes les transitions suivent le survol : cachée au repos, nette quand elle est entrée, cachée de nouveau à la sortie, rien laissé derrière elle', async function () {
        if (!present) { this.skip(); return }
        const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } })
        const p = await ouvre(ctx, 'mjs-vue-survol-toutes', '#t-typewriter')
        try {
          const lire = (id: string) => p.evaluate((i: string) => (window as any).__etat(i), id)
          const point = (id: string) => p.evaluate((i: string) => (window as any).__centre(i), id)
          const attendre = async (cond: string, id: string) => {
            try {
              await p.waitForFunction(`(${cond})(window.__etat(${JSON.stringify(id)}))`, null, { timeout: 8000 })
            }
            catch {
              throw new Error(`*${id} n'a jamais vérifié ${cond} : ${JSON.stringify(await lire(id))}`)
            }
          }
          const base = await p.evaluate(() => (window as any).__svgs())
          // ce que la balise ne doit pas porter une fois posée ou revenue : découpe, transformation, filtre, animation, <svg> de plus ;
          // *ink garde, cachée, le masque de sa dernière image : un style en ligne qui ne se voit pas
          const propre = async (t: string, quoi: string) => {
            const e = await lire('t-' + t)
            assert.equal(e.clip, 'none', `*${t} ${quoi} : découpe laissée`)
            assert.equal(e.tf, 'none', `*${t} ${quoi} : transformation laissée`)
            assert.equal(e.filtre, 'none', `*${t} ${quoi} : filtre laissé`)
            assert.equal(e.anims, 0, `*${t} ${quoi} : animation laissée`)
            if (t !== 'ink') assert.equal(e.style, null, `*${t} ${quoi} : style en ligne laissé`)
            assert.equal(await p.evaluate(() => (window as any).__svgs()), base, `*${t} ${quoi} : un <svg> de plus`)
          }
          for (const t of TOUTES) {
            const id = 't-' + t
            await attendre('e => e && e.vis === "hidden" && e.marque === "rest"', id)
            await propre(t, 'au repos')
            const c = await point('k-' + t)
            await p.mouse.move(c.x, c.y)
            // entrée finie : visible, nette, plus rien de posé (une transition menée image par image n'a pas d'animation à attendre :
            // c'est le style, ou le texte, qui dit qu'elle a fini)
            await attendre(`e => e && e.vis === "visible" && e.marque === null && e.anims === 0 && e.op === 1 && e.clip === "none" && e.tf === "none" && e.filtre === "none"${t === 'ink' ? '' : ' && e.style === null'}${t === 'typewriter' ? ' && e.texte === "Un texte qui s\'écrit"' : ''}`, id)
            await propre(t, 'entrée')
            await p.mouse.move(850, 990)
            await attendre('e => e && e.vis === "hidden" && e.marque === "rest" && e.anims === 0', id)
            await propre(t, 'sortie')
          }
        }
        finally {
          await ctx.close()
        }
      })

      // la page des essais de saut et de texte lié, dans son propre contexte (à refermer) ; `attendre` dit où en est la balise quand elle
      // n'a jamais vérifié la condition
      const saut = async () => {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } })
        const p = await ouvre(ctx, 'mjs-vue-survol-saut', '#t-typewriter')
        const lire = (id: string) => p.evaluate((i: string) => (window as any).__etat(i), id)
        const point = (id: string) => p.evaluate((i: string) => (window as any).__centre(i), id)
        const attendre = async (cond: string, id: string, ms = 8000) => {
          try {
            await p.waitForFunction(`(${cond})(window.__etat(${JSON.stringify(id)}))`, null, { timeout: ms })
          }
          catch {
            throw new Error(`${id} n'a jamais vérifié ${cond} : ${JSON.stringify(await lire(id))}`)
          }
        }
        return { ctx, p, point, attendre }
      }

      it('[saut] aucun saut à la première image : ce qui suit la balise ne bouge pas à l\'arrivée de la souris, ni à la fin de la sortie (les 21 noms)', async function () {
        if (!present) { this.skip(); return }
        const { ctx, p, point, attendre } = await saut()
        try {
          const haut = (id: string) => p.evaluate((i: string) => Math.round((window as any).__el(i).getBoundingClientRect().top * 100) / 100, id)
          const sauts: Record<string, any> = {}
          for (const t of TOUTES) {
            const id = 't-' + t
            await attendre(repos, id)
            const repose = await haut('a-' + t)
            // les deux images qui suivent l'arrivée, lues dans des rappels posés APRÈS celui du moteur (pointermove vient après pointerenter
            // dans la même distribution)
            await p.evaluate((apres: string) => {
              const w = window as any
              const lit = () => Math.round(w.__el(apres).getBoundingClientRect().top * 100) / 100
              w.__cadres = []
              window.addEventListener('pointermove', () => requestAnimationFrame(() => { w.__cadres.push(lit()); requestAnimationFrame(() => w.__cadres.push(lit())) }), { capture: true, once: true })
            }, 'a-' + t)
            const c = await point(t === 'draw' ? 's-draw' : 'k-' + t)
            await p.mouse.move(c.x - 4, c.y - 4)
            await p.mouse.move(c.x, c.y)
            await p.waitForFunction(() => (window as any).__cadres.length === 2)
            // la première image ne doit pas sauter (à 4 px près : sur une machine chargée, elle peut être peinte un peu après l'arrivée, et les
            // bordures de *slide passent alors de zéro à un pixel de chaque côté dès que sa taille n'est plus nulle ; les sauts qu'on cherche
            // font 16 px et plus). La deuxième image n'est pas jugée : une transition qui grandit bouge légitimement dès qu'elle joue
            const [premiere, deuxieme] = await p.evaluate(() => (window as any).__cadres)
            // la souris repart aussitôt (la durée est longue : la sortie est courte, elle part de l'état courant)
            await p.mouse.move(850, 990)
            await attendre(repos, id)
            const fin = await haut('a-' + t)
            const ecart = (a: number, b: number) => Math.abs(a - b)
            if (ecart(premiere, repose) > 4 || ecart(fin, repose) > 0.5) sauts[t] = { repose, premiere, deuxieme, fin }
          }
          assert.deepEqual(sauts, {}, `la balise change la place de ce qui la suit : ${JSON.stringify(sauts)}`)
        }
        finally {
          await ctx.close()
        }
      })

      it('[saut] *slide sur l\'axe x : sans largeur au repos, et ce qui le suit ne bouge pas à l\'arrivée de la souris', async function () {
        if (!present) { this.skip(); return }
        const { ctx, p, point, attendre } = await saut()
        try {
          const gauche = () => p.evaluate(() => Math.round((window as any).__el('a-slide-x').getBoundingClientRect().left * 100) / 100)
          await attendre(repos, 't-slide-x')
          assert.equal(await p.evaluate(() => (window as any).__el('t-slide-x').getBoundingClientRect().width), 0, 'sans largeur au repos : c\'est la première image de son entrée')
          const repose = await gauche()
          await p.evaluate(() => {
            const w = window as any
            w.__cadres = []
            window.addEventListener('pointermove', () => requestAnimationFrame(() => w.__cadres.push(Math.round(w.__el('a-slide-x').getBoundingClientRect().left * 100) / 100)), { capture: true, once: true })
          })
          const c = await point('k-slide-x')
          await p.mouse.move(c.x - 4, c.y - 4)
          await p.mouse.move(c.x, c.y)
          await p.waitForFunction(() => (window as any).__cadres.length === 1)
          const [premiere] = await p.evaluate(() => (window as any).__cadres)
          await p.mouse.move(850, 990)
          await attendre(repos, 't-slide-x')
          assert.ok(Math.abs(premiere - repose) <= 4, `à la première image, ce qui suit a bougé de ${premiere - repose} px (${repose} → ${premiere})`)
          assert.ok(Math.abs((await gauche()) - repose) <= 0.5, 'à la fin de la sortie, ce qui suit est revenu à sa place')
        }
        finally {
          await ctx.close()
        }
      })

      it('[texte] un *typewriter lié à une variable tape, à chaque entrée, le texte courant', async function () {
        if (!present) { this.skip(); return }
        const { ctx, p, point, attendre } = await saut()
        try {
          const entre = (texte: string) => `e => e && e.vis === "visible" && e.marque === null && e.anims === 0 && e.jeu === false && e.texte === ${JSON.stringify(texte)}`
          const survole = async () => { const c = await point('k-lie'); await p.mouse.move(c.x, c.y) }
          await attendre(repos, 't-lie')
          await survole()
          await attendre(entre('Alpha'), 't-lie')
          await p.mouse.move(850, 990)
          await attendre(repos, 't-lie')
          // la variable change pendant qu'elle est cachée : la liaison réécrit le texte de la balise
          await p.evaluate(() => (window as any).__el('change').click())
          await p.waitForFunction(() => (window as any).__el('t-lie').textContent === 'Beta plus long')
          await survole()
          await attendre(entre('Beta plus long'), 't-lie')
          // la variable n'a pas changé : le survol suivant tape le même texte
          await p.mouse.move(850, 990)
          await attendre(repos, 't-lie')
          await survole()
          await attendre(entre('Beta plus long'), 't-lie')
          await p.mouse.move(850, 990)
          await attendre(repos, 't-lie')
        }
        finally {
          await ctx.close()
        }
      })

      it('[texte] « réduire les animations » demandé après la pose : le *typewriter, vide au repos, apparaît d\'un coup avec son texte entier', async function () {
        if (!present) { this.skip(); return }
        const { ctx, p, point, attendre } = await saut()
        try {
          await attendre(repos, 't-lie')
          await p.emulateMedia({ reducedMotion: 'reduce' })
          const c = await point('k-lie')
          await p.mouse.move(c.x, c.y)
          await attendre('e => e && e.vis === "visible" && e.marque === null && e.anims === 0 && e.jeu === false && e.texte === "Alpha"', 't-lie')
          await p.mouse.move(850, 990)
          await attendre('e => e && e.vis === "hidden" && e.marque === "rest" && e.anims === 0', 't-lie')
        }
        finally {
          await ctx.close()
        }
      })

      it('[texte] un *typewriter posé à l\'arrivée à l\'écran (once: false) tape lui aussi le texte courant à chaque retour', async function () {
        if (!present) { this.skip(); return }
        const { ctx, p } = await saut()
        try {
          // le texte de la balise, noté à chaque écriture ; fini quand elle a écrit, que son texte est celui attendu et qu'aucun jeu ne tient
          const joue = async (texte: string) => {
            try {
              await p.waitForFunction((t: string) => { const e = (window as any).__el('t-vu'); return (window as any).__ecrit.length > 0 && e.textContent === t && !e._mjs_transition_state }, texte, { timeout: 8000 })
            }
            catch {
              throw new Error(`le texte « ${texte} » n'a jamais été tapé : ${JSON.stringify(await p.evaluate(() => { const t = (window as any).__el('t-vu'); return { ecrit: (window as any).__ecrit, texte: t.textContent, jeu: !!t._mjs_transition_state, haut: Math.round(t.getBoundingClientRect().top), fenetre: window.innerHeight } }))}`)
            }
          }
          const observe = () => p.evaluate(() => {
            const w = window as any
            w.__ecrit = []
            if (w.__obs) w.__obs.disconnect()
            w.__obs = new MutationObserver(() => w.__ecrit.push(w.__el('t-vu').textContent))
            w.__obs.observe(w.__el('t-vu'), { subtree: true, characterData: true, childList: true })
          })
          const bas = () => p.evaluate(() => (window as any).__el('t-vu').scrollIntoView({ block: 'center' }))
          await observe()
          await bas()
          await joue('Un')
          // elle repart de l'écran : le texte s'efface
          await observe()
          await p.evaluate(() => window.scrollTo(0, 0))
          await joue('')
          // la variable change pendant qu'elle est partie, puis elle revient
          await p.evaluate(() => (window as any).__el('change-vu').click())
          await p.waitForFunction(() => (window as any).__el('t-vu').textContent === 'Deux mots')
          await observe()
          await bas()
          await joue('Deux mots')
        }
        finally {
          await ctx.close()
        }
      })

      it('[partage] dix légendes dans la même carte : un seul jeu de quatre écouteurs sur la carte, retiré avec la dernière légende', async function () {
        if (!present) { this.skip(); return }
        const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } })
        const p = await ouvre(ctx, 'mjs-vue-survol-multi', '#m10')
        try {
          const ecouteurs = () => p.evaluate(() => (window as any).__ecouteurs('c-multi'))
          const tous = (cond: string, n = 10) => p.waitForFunction(`Array.from({ length: ${n} }, (_, i) => window.__etat('m' + (i + 1))).every(${cond})`, null, { timeout: 8000 })
          await tous(repos)
          assert.deepEqual(await ecouteurs(), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'dix légendes, quatre écouteurs sur la carte')
          const c = await p.evaluate(() => (window as any).__centre('c-multi'))
          await p.mouse.move(c.x, c.y)
          await tous(entree)
          await p.mouse.move(850, 990)
          await tous(repos)
          await p.evaluate(() => (window as any).__el('six').click())
          await p.waitForFunction(() => !(window as any).__el('m7'))
          assert.deepEqual(await ecouteurs(), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'six légendes : toujours quatre')
          await p.evaluate(() => (window as any).__el('aucune').click())
          await p.waitForFunction(() => !(window as any).__el('m1'))
          assert.deepEqual(await ecouteurs(), [], 'plus de légende : plus un écouteur sur la carte')
        }
        finally {
          await ctx.close()
        }
      })

      it('au toucher : un appui sur le parent la fait entrer, le doigt levé ne la fait pas sortir, un appui ailleurs la fait sortir', async function () {
        if (!present) { this.skip(); return }
        let ctx: any
        try {
          ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, hasTouch: true })
        }
        catch (e) {
          console.log(`  ℹ️  ${nom} : pas d'écran tactile simulé, test du toucher sauté (${String((e as any).message ?? e).split('\n')[0]})`)
          this.skip()
          return
        }
        const tactile = await ouvre(ctx)
        try {
          const point = (id: string) => tactile.evaluate((i: string) => (window as any).__centre(i), id)
          const lire = (id: string) => tactile.evaluate((i: string) => (window as any).__etat(i), id)
          const c1 = await point('c-fade')
          await tactile.touchscreen.tap(c1.x, c1.y)
          await tactile.waitForFunction(`window.__etat("e-fade").vis === "visible" && window.__etat("e-fade").anims === 0`)
          // le doigt est levé depuis longtemps : la carte reste ouverte
          await new Promise((r) => setTimeout(r, 700))
          assert.equal((await lire('e-fade')).vis, 'visible', 'le doigt levé n\'est pas une sortie')
          // un appui sur la carte elle-même ne la referme pas
          await tactile.touchscreen.tap(c1.x + 10, c1.y - 10)
          await new Promise((r) => setTimeout(r, 700))
          assert.equal((await lire('e-fade')).vis, 'visible', 'un appui dedans la laisse ouverte')
          // un appui sur une autre carte : la première se referme, la seconde s'ouvre
          const c2 = await point('c-fly')
          await tactile.touchscreen.tap(c2.x, c2.y)
          await tactile.waitForFunction(`window.__etat("e-fly").vis === "visible" && window.__etat("e-fly").anims === 0`)
          await tactile.waitForFunction(`window.__etat("e-fade").vis === "hidden"`)
          // un appui ailleurs (le fond de la page) : elle se referme
          await tactile.touchscreen.tap(850, 990)
          await tactile.waitForFunction(`window.__etat("e-fly").vis === "hidden"`)
          assert.deepEqual(await tactile.evaluate(() => (window as any).__ecouteurs('c-fly')), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'les écouteurs de l\'appui sont retirés avec lui')
        }
        finally {
          await ctx.close()
        }
      })
    })
  }
})
