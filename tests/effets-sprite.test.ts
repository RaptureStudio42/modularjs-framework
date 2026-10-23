// *sprite — une planche de poses animée par à-coups : le calque (la planche entière sous la balise qui
// rogne), les images clés de chaque planche (une ligne, plusieurs lignes, dernière ligne incomplète), les
// réglages lus, le déclencheur, la pause hors écran et onglet caché, les réglages qui suivent sans reposer
// l'effet, un composant, les refus de compilation, le retrait sans reste, les feuilles d'images clés rendues avec
// leur dernier usager, will-change retiré à la fin d'un tour, la densité de l'écran (un écouteur partagé).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const VARIABLES = '<script>\n$v = \'500ms\'\n$d = \'normal\'\n$n = 0\n$f = 4\n$s = 0\n</script>\n'
const BOUTONS   = '<button class="bv" @click={$v = \'2s\'}>v</button><button class="bd" @click={$d = \'reverse\'}>d</button><button class="bn" @click={$n = 3}>n</button><button class="bf" @click={$f = 6}>f</button>'

const COMPOSANTS: Record<string, string> = {
  'fx-sp':          '<div class="a" *sprite(\'/marche.png\', frames: 8)></div>',
  'fx-sp-grille':   '<div class="a" *sprite(\'/grille.png\', frames: 10, columns: 4, start: 5, speed: 2s, repeat: 3, direction: alternate, pixel: true)></div>',
  'fx-sp-survol':   '<div class="a" *sprite(\'/m.png\', frames: 4, on: hover)></div>',
  'fx-sp-clic':     '<div class="a" *sprite(\'/m.png\', frames: 4, on: click, repeat: 1)></div>',
  'fx-sp-vue':      '<div class="a" *sprite(\'/m.png\', frames: 4, on: view)></div>',
  'fx-sp-seule':    '<div class="a" *sprite(\'/m.png\')></div>',
  'fx-sp-sans':     '<div class="a" *sprite(frames: 4)>texte</div>',
  'fx-sp-haut':     '<div class="a" *sprite(\'/m.png\', frames: 6, start: 99)></div>',
  'fx-sp-colonnes': '<div class="a" *sprite(\'/m.png\', frames: 3, columns: 5)></div>',
  'fx-sp-mille':    '<div class="a" *sprite(\'/m.png\', frames: 1000, columns: 40)></div>',
  'fx-sp-liste':    '<div class="a" *sprite(\'/m.png\', frames: 4)></div><div class="b" *sprite(\'/m.png\', frames: 4)></div><div class="c" *sprite(\'/m.png\', frames: 4)></div>',
  'fx-sp-tard':     '<script>\n$i = \'\'\n</script>\n<div class="a" *sprite(image: $i, frames: 4)></div><button class="bi" @click={$i = \'/arrivee.png\'}>i</button>',
  'fx-sp-vars':     VARIABLES + '<div class="a" *sprite(\'/m.png\', frames: $f, speed: $v, direction: $d, repeat: $n)></div>' + BOUTONS,
  'fx-sp-boite':    '<div class="b">dedans</div>',
  'fx-sp-hote':     '<@fx-sp-boite class="h" *sprite(\'/m.png\', frames: 4, columns: 2)></@fx-sp-boite>',
  'fx-sp-retrait':  '<script>\n$on = true\n</script>\n{if $on}<span class="a" *sprite(\'/m.png\', frames: 4)></span>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-sp-fps':      '<div class="a" *sprite(\'/m.png\', frames: 8, fps: 16)></div>',
  'fx-sp-fps-deux': '<div class="a" *sprite(\'/m.png\', frames: 8, fps: 10, speed: 2s)></div>',
  'fx-sp-fps-var':  '<script>\n$f = 10\n</script>\n<div class="a" *sprite(\'/m.png\', frames: 5, fps: $f)></div><button class="bf" @click={$f = 20}>f</button><button class="bx" @click={$f = \'\'}>x</button>',
  'fx-sp-poses':    '<div class="a" *sprite(\'/m.png\', columns: 3, rows: 4, row: 2, poses: [1, 2, 1, 0], fps: 5, start: 1)></div>',
  'fx-sp-poses-nu': '<div class="a" *sprite(\'/m.png\', frames: 6, columns: 3, poses: [4, 0, 5, 9])></div>',
  'fx-sp-rows':     '<script>\n$cap = 1\n</script>\n<div class="a" *sprite(\'/m.png\', columns: 3, rows: 4, row: $cap)></div><button class="bc" @click={$cap = 3}>c</button><button class="bh" @click={$cap = 9}>h</button>',
  'fx-sp-row-seul': '<div class="a" *sprite(\'/m.png\', frames: 4, row: 2)></div>',
  'fx-sp-row-zero': '<div class="a" *sprite(\'/m.png\', frames: 4, row: 0)></div>',
  'fx-sp-mauvaise': '<div class="a" *sprite(\'/m.png\', columns: 3, rows: 2, poses: [0, a, 1])></div>',
  'fx-sp-animate':  '<script>\n$en = true\n</script>\n<div class="a" *sprite(\'/m.png\', frames: 6, start: 2, animate: $en)></div><button class="bo" @click={$en = !$en}>o</button>',
  'fx-sp-hold':     '<script>\n$h = true\n</script>\n<div class="a" *sprite(\'/m.png\', frames: 6, repeat: 1, hold: $h)></div><button class="bh" @click={$h = !$h}>h</button>',
  'fx-sp-signal':   '<script>\n$fini = 0\n</script>\n<div class="a" *sprite(\'/m.png\', frames: 6, repeat: 2) @mjs:sprite-end={$fini++}></div><p class="n">{$fini}</p>',
  'fx-sp-row-un':   '<div class="a" *sprite(\'/m.png\', frames: 4, row: 1)></div>',
  'fx-sp-rows-fixe':'<div class="a" *sprite(\'/m.png\', columns: 3, rows: 4, row: 99)></div>',
  'fx-sp-poses-cap':'<div class="a" *sprite(\'/m.png\', columns: 3, rows: 4, poses: [1, 2, 7])></div>',
  'fx-sp-arret':    '<div class="a" *sprite(\'/m.png\', frames: 6, start: 4, animate: false)></div>',
  'fx-sp-fin-retrait': '<script>\n$on = true\n$fini = 0\n</script>\n{if $on}<div class="a" *sprite(\'/m.png\', frames: 4, repeat: 2) @mjs:sprite-end={$fini++}></div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-sp-feuilles': '<script>\n$on = true\n$fr = 4\n</script>\n{if $on}<div class="a" *sprite(\'/m.png\', frames: $fr)></div><div class="b" *sprite(\'/m.png\', frames: 4)></div>{end}\n<button class="t" @click={$on = !$on}>t</button><button class="bf" @click={$fr = 3}>f</button>'
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *sprite', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-sprite')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel = '.a') {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp
  }

  const calque = (el: any) => el.querySelector('[mjs-fx-layer="sprite"]')
  const reglage = (layer: any, nom: string) => layer.style.getPropertyValue('--mjs-fx-sprite-' + nom)
  // les images clés adoptées par une racine : nom → nombre d'images clés
  const cles = (racine: any) => {
    const out: Record<string, any> = {}
    for (const feuille of racine.adoptedStyleSheets) for (const r of Array.from(feuille.cssRules) as any[]) if (r.name) out[r.name] = r
    return out
  }

  it('*sprite : un calque aussi grand que la planche, au-dessus du contenu, muet pour la lecture d\'écran et la souris', async () => {
    const comp  = await monter('mjs-fx-sp')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.ok(layer, 'le calque de la planche')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.ok(el.lastElementChild === layer, 'dernier enfant : au-dessus du contenu')
    assert.equal(el.hasAttribute('mjs-fx-sprite-clip'), true, 'la balise rogne le calque')
    assert.equal(reglage(layer, 'img'), 'url("/marche.png")')
    assert.equal(reglage(layer, 'c'), '8', 'une seule ligne : autant de colonnes que de poses')
    assert.equal(reglage(layer, 'r'), '1')
    assert.equal(reglage(layer, 'at'), '0% 0%', 'la pose de repos : la première')
    assert.equal(reglage(layer, 'name'), 'mjs-fx-sprite-8-8')
    assert.equal(reglage(layer, 'count'), 'infinite', 'sans fin par défaut')
    assert.equal(layer.hasAttribute('mjs-fx-sprite-pixel'), false)
    assert.equal(el.style.getPropertyValue('--mjs-fx-sprite-go'), '', 'on: always : rien ne coupe l\'animation')
  })

  it('les images clés : une par pose (tenue d\'un bond), la dernière tenue aussi à 100 %, pas de background-position', async () => {
    const comp = await monter('mjs-fx-sp')
    const k    = cles(comp._shadow)['mjs-fx-sprite-8-8']
    assert.ok(k, 'les images clés de la planche, adoptées par la racine du composant')
    const textes = Array.from(k.cssRules).map((r: any) => `${r.keyText} ${r.style.getPropertyValue('translate')}`)
    assert.equal(textes.length, 9, 'huit poses et le 100 %')
    assert.equal(textes[0], '0% 0% 0%')
    assert.equal(textes[1], '12.5% -12.5% 0%')
    assert.equal(textes[7], '87.5% -87.5% 0%')
    assert.equal(textes[8], '100% -87.5% 0%', 'le sens inverse commence sur la dernière pose')
    const css = window.µ._mjs_fxDefs.sprite.css
    assert.ok(!/background-position/.test(css), 'le calque glisse (translate), le fond ne se repeint pas')
    assert.match(css, /animation:var\(--mjs-fx-sprite-go,var\(--mjs-fx-sprite-name,none\)\) var\(--mjs-sprite-speed,1s\) step-end 0s var\(--mjs-fx-sprite-count,infinite\) var\(--mjs-sprite-direction,normal\)/)
  })

  it('une planche à plusieurs lignes, dernière ligne incomplète : frames 10 sur 4 colonnes, 3 lignes, jamais une case vide', async () => {
    const comp  = await monter('mjs-fx-sp-grille')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(reglage(layer, 'c'), '4')
    assert.equal(reglage(layer, 'r'), '3', 'dix poses sur quatre colonnes : trois lignes')
    const k = cles(comp._shadow)['mjs-fx-sprite-10-4']
    const textes = Array.from(k.cssRules).map((r: any) => r.style.getPropertyValue('translate'))
    assert.equal(textes.length, 11, 'dix poses et le 100 %')
    assert.equal(textes[3], '-75% 0%', 'la quatrième pose : dernière colonne de la première ligne')
    assert.equal(textes[4], '0% -33.3333%', 'la cinquième : première colonne de la deuxième ligne')
    assert.equal(textes[9], '-25% -66.6667%', 'la dixième : deuxième colonne de la dernière ligne (elle n\'en a que deux)')
    assert.equal(textes[10], textes[9], 'le 100 % tient la dernière pose, pas la case vide d\'après')
  })

  it('mille poses (la limite) sur quarante colonnes : vingt-cinq lignes, mille images clés et le 100 %', async () => {
    const comp  = await monter('mjs-fx-sp-mille')
    const layer = calque(comp._shadow.querySelector('.a'))
    assert.equal(reglage(layer, 'c'), '40')
    assert.equal(reglage(layer, 'r'), '25')
    const k = cles(comp._shadow)['mjs-fx-sprite-1000-40']
    assert.equal(k.cssRules.length, 1001)
    assert.equal(k.cssRules[999].style.getPropertyValue('translate'), '-97.5% -96%', 'la millième pose : dernière colonne, dernière ligne')
    assert.equal(k.cssRules[1000].style.getPropertyValue('translate'), '-97.5% -96%')
  })

  it('l\'écriture de la spécification : µasset en réglage principal, résolu au build ; les trois exemples compilent', async () => {
    const resolveAsset = async (chemin: string) => '/assets/' + chemin.replace('.', '-abc123.')
    const js = (await transpile('<span *sprite(µasset(\'marche.png\'), frames: 6)></span>', { moduleName: 'fx-essai', resolveAsset })).output
    assert.ok(js.includes('/assets/marche-abc123.png'), 'l\'adresse du fichier, résolue au build')
    await transpile('<div *sprite(µasset(\'oiseau.png\'), frames: 2, speed: 200ms, on: hover)></div>', { moduleName: 'fx-essai', resolveAsset })
    await transpile('<i *sprite(µasset(\'explosion.png\'), frames: 24, columns: 6, on: click, repeat: 1)></i>', { moduleName: 'fx-essai', resolveAsset })
  })

  it('plusieurs balises de même planche partagent une seule feuille d\'images clés par racine', async () => {
    const comp = await monter('mjs-fx-sp-liste', '.c')
    for (const c of ['a', 'b', 'c']) assert.ok(calque(comp._shadow.querySelector('.' + c)), 'calque de la balise ' + c)
    const feuilles = comp._shadow.adoptedStyleSheets.filter((f: any) => Array.from(f.cssRules).some((r: any) => r.name === 'mjs-fx-sprite-4-4'))
    assert.equal(feuilles.length, 1)
  })

  it('image, frames, columns, speed, repeat, direction, start, pixel : chaque réglage lu', async () => {
    const comp  = await monter('mjs-fx-sp-grille')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(reglage(layer, 'img'), 'url("/grille.png")')
    assert.equal(reglage(layer, 'at'), '-25% -33.3333%', 'start: 5 : deuxième colonne de la deuxième ligne')
    assert.equal(reglage(layer, 'count'), '3', 'repeat: 3')
    assert.equal(el.style.getPropertyValue('--mjs-sprite-speed'), '2s')
    assert.equal(el.style.getPropertyValue('--mjs-sprite-direction'), 'alternate')
    assert.equal(layer.hasAttribute('mjs-fx-sprite-pixel'), true, 'pixel: true')
  })

  it('une planche trop courte pour start, un seul passage de colonnes plus large que frames, une seule pose', async () => {
    let comp = await monter('mjs-fx-sp-haut')
    assert.equal(reglage(calque(comp._shadow.querySelector('.a')), 'at'), '-83.3333% 0%', 'start: 99 sur 6 poses : la dernière')
    comp = await monter('mjs-fx-sp-colonnes')
    const layer = calque(comp._shadow.querySelector('.a'))
    assert.equal(reglage(layer, 'c'), '5', 'columns plus grand que frames : la planche a cinq cases par ligne')
    assert.equal(reglage(layer, 'r'), '1')
    assert.equal(reglage(layer, 'name'), 'mjs-fx-sprite-3-5')
    comp = await monter('mjs-fx-sp-seule')
    const seule = calque(comp._shadow.querySelector('.a'))
    assert.equal(reglage(seule, 'name'), '', 'une seule pose : rien à animer')
    assert.equal(reglage(seule, 'wc'), 'auto', 'ni promotion de calque')
    assert.equal(reglage(seule, 'at'), '0% 0%')
  })

  it('sans image : la marque seule, ni calque ni rognage', async () => {
    const comp = await monter('mjs-fx-sp-sans')
    const el   = comp._shadow.querySelector('.a')
    assert.ok((el.getAttribute('mjs-fx') ?? '').split(' ').includes('sprite'))
    assertAbsent(calque(el), 'calque sans image')
    assert.equal(el.hasAttribute('mjs-fx-sprite-clip'), false)
    assert.equal(el.textContent, 'texte')
  })

  it('une image qui arrive plus tard (variable d\'abord vide) : le calque se pose à son arrivée', async () => {
    const comp = await monter('mjs-fx-sp-tard')
    const el   = comp._shadow.querySelector('.a')
    assertAbsent(calque(el), 'calque avant l\'image')
    assert.equal(el.hasAttribute('mjs-fx-sprite-clip'), false)
    comp._shadow.querySelector('.bi').click()
    await attendre(() => !!calque(el))
    assert.equal(reglage(calque(el), 'img'), 'url("/arrivee.png")')
    assert.equal(reglage(calque(el), 'name'), 'mjs-fx-sprite-4-4')
    assert.equal(el.hasAttribute('mjs-fx-sprite-clip'), true)
  })

  it('on: hover — l\'animation est coupée au repos (la pose start), part au survol, repart au repos à la sortie', async () => {
    const comp = await monter('mjs-fx-sp-survol')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.style.getPropertyValue('--mjs-fx-sprite-go'), 'none')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(el.style.getPropertyValue('--mjs-fx-sprite-go'), '', 'survol : l\'animation est rendue')
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    assert.equal(el.style.getPropertyValue('--mjs-fx-sprite-go'), 'none')
  })

  it('on: click, repeat: 1 — un tour par clic : le moteur coupe puis rend l\'animation, le tour vient du réglage repeat', async () => {
    const comp  = await monter('mjs-fx-sp-clic')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(el.style.getPropertyValue('--mjs-fx-sprite-go'), 'none')
    assert.equal(reglage(layer, 'count'), '1')
    el.click()
    assert.equal(el.style.getPropertyValue('--mjs-fx-sprite-go'), '', 'après le clic l\'animation est rendue')
  })

  it('hors écran, l\'animation se met en pause (will-change retiré) ; à l\'écran, elle repart', async () => {
    const instances: any[] = []
    const vrai = window.IntersectionObserver
    window.IntersectionObserver = class { cb: any; constructor(cb: any) { this.cb = cb; instances.push(this) } observe() {} disconnect() { this.cb = null } unobserve() {} takeRecords() { return [] } }
    try {
      const comp  = await monter('mjs-fx-sp')
      const layer = calque(comp._shadow.querySelector('.a'))
      const io    = instances[instances.length - 1]
      assert.ok(io, 'un observateur pose la pause hors écran')
      assert.equal(reglage(layer, 'play'), '', 'avant tout : en marche')
      io.cb([{ isIntersecting: false }])
      assert.equal(reglage(layer, 'play'), 'paused')
      assert.equal(reglage(layer, 'wc'), 'auto')
      io.cb([{ isIntersecting: true }])
      assert.equal(reglage(layer, 'play'), '')
      assert.equal(reglage(layer, 'wc'), '')
    } finally {
      window.IntersectionObserver = vrai
    }
  })

  it('hors écran : la pause passe par l\'outil de visibilité du cœur, avec une marge de 100 px autour de la balise', async () => {
    const options: any[] = []
    const appels: any[]  = []
    const vrai  = window.IntersectionObserver
    const outil = window.µ._mjs_fxVisible
    window.IntersectionObserver = class { cb: any; constructor(cb: any, opts: any) { this.cb = cb; options.push(opts) } observe() {} disconnect() {} unobserve() {} takeRecords() { return [] } }
    window.µ._mjs_fxVisible = function(this: any, ...a: any[]) { appels.push(a); return outil.apply(this, a) }
    try {
      const comp = await monter('mjs-fx-sp')
      const el   = comp._shadow.querySelector('.a')
      assert.equal(appels.length, 1, 'un seul appel de l\'outil : l\'effet ne fabrique pas son propre observateur')
      assert.ok(appels[0][0] === el, 'l\'outil observe la balise')
      assert.equal(appels[0][1], '100px', 'la marge : 100 px autour de la balise')
      assert.ok(options.some((o) => o && o.rootMargin === '100px'), 'l\'observateur du navigateur porte cette marge : ' + JSON.stringify(options))
    } finally {
      window.IntersectionObserver = vrai
      window.µ._mjs_fxVisible = outil
    }
  })

  it('on: view — le moteur coupe déjà hors écran : pas de second observateur', async () => {
    const instances: any[] = []
    const vrai = window.IntersectionObserver
    window.IntersectionObserver = class { cb: any; constructor(cb: any) { this.cb = cb; instances.push(this) } observe() {} disconnect() {} unobserve() {} takeRecords() { return [] } }
    try {
      await monter('mjs-fx-sp-vue')
      assert.equal(instances.length, 1, 'un seul observateur : celui du déclencheur')
    } finally {
      window.IntersectionObserver = vrai
    }
  })

  it('onglet caché : en pause ; de retour : en marche — un seul écouteur pour tous les sprites, retiré avec le dernier', async () => {
    const ajouts: string[] = []
    const retraits: string[] = []
    const ajoute  = window.document.addEventListener.bind(window.document)
    const retire  = window.document.removeEventListener.bind(window.document)
    window.document.addEventListener = (t: string, ...r: any[]) => { if (t === 'visibilitychange') ajouts.push(t); return ajoute(t, ...r) }
    window.document.removeEventListener = (t: string, ...r: any[]) => { if (t === 'visibilitychange') retraits.push(t); return retire(t, ...r) }
    let cache = false
    Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => cache })
    try {
      const comp  = await monter('mjs-fx-sp')
      const layer = calque(comp._shadow.querySelector('.a'))
      assert.equal(ajouts.length, 1)
      // le retrait du sprite du test d'avant, parti avec le corps de page remplacé, ne compte pas
      retraits.length = 0
      cache = true
      window.document.dispatchEvent(new window.Event('visibilitychange'))
      assert.equal(reglage(layer, 'play'), 'paused')
      assert.equal(reglage(layer, 'wc'), 'auto')
      cache = false
      window.document.dispatchEvent(new window.Event('visibilitychange'))
      assert.equal(reglage(layer, 'play'), '')
      window.document.body.innerHTML = ''
      await pause(60)
      assert.equal(retraits.length, 1, 'plus de sprite : plus d\'écouteur')
    } finally {
      delete (window.document as any).hidden
      window.document.addEventListener = ajoute
      window.document.removeEventListener = retire
    }
  })

  it('« réduire les animations » : l\'animation et le will-change sont coupés, la pose start reste', () => {
    const css = window.µ._mjs_fxDefs.sprite.css
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\[mjs-fx-layer="sprite"\]\{animation:none;will-change:auto\}\}/)
    assert.match(css, /\[mjs-fx-layer="sprite"\]\{[^}]*pointer-events:none/)
    assert.match(css, /translate:var\(--mjs-fx-sprite-at,0 0\)/, 'au repos le calque est sur la pose start')
    assert.match(css, /:where\(\[mjs-fx~="sprite"\]\[mjs-fx-sprite-sized\]\)\{width:var\(--mjs-fx-sprite-w\);max-width:100%;aspect-ratio:var\(--mjs-fx-sprite-ratio\)\}/, 'la taille d\'une pose ne pèse rien face à celle de l\'auteur')
  })

  it('speed, direction et repeat suivent sans reposer l\'effet ; frames repose le calque', async () => {
    const comp  = await monter('mjs-fx-sp-vars')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(el.style.getPropertyValue('--mjs-sprite-speed'), '500ms')
    assert.equal(reglage(layer, 'count'), 'infinite')
    comp._shadow.querySelector('.bv').click()
    await pause(40)
    assert.equal(el.style.getPropertyValue('--mjs-sprite-speed'), '2s', 'speed suit')
    comp._shadow.querySelector('.bd').click()
    await pause(40)
    assert.equal(el.style.getPropertyValue('--mjs-sprite-direction'), 'reverse', 'direction suit')
    comp._shadow.querySelector('.bn').click()
    await pause(40)
    assert.equal(reglage(layer, 'count'), '3', 'repeat suit')
    assert.ok(calque(el) === layer, 'le même calque : rien n\'a été reposé')
    comp._shadow.querySelector('.bf').click()
    await pause(60)
    const neuf = calque(el)
    assert.ok(neuf && neuf !== layer, 'frames change : le calque est reposé')
    assert.equal(el.querySelectorAll('[mjs-fx-layer="sprite"]').length, 1, 'un seul calque')
    assert.equal(reglage(neuf, 'name'), 'mjs-fx-sprite-6-6')
    assert.equal(reglage(neuf, 'count'), '3', 'les autres réglages gardés')
    assert.equal(el.style.getPropertyValue('--mjs-sprite-speed'), '2s')
  })

  it('posé sur un composant : le calque est dans son shadow, avec les images clés et la feuille', async () => {
    const comp  = await monter('mjs-fx-sp-hote', '.h')
    const hote  = comp._shadow.querySelector('.h')
    await attendre(() => !!hote._shadow?.querySelector('.b'))
    await pause(40)
    const layer = hote._shadow.querySelector('[mjs-fx-layer="sprite"]')
    assert.ok(layer, 'le calque dans le shadow du composant')
    assertAbsent(hote.querySelector('[mjs-fx-layer="sprite"]'), 'calque dans le DOM clair du composant')
    assert.equal(reglage(layer, 'c'), '2')
    assert.equal(reglage(layer, 'r'), '2')
    const interieur = window.µ._mjs_fxInner(hote)
    assert.ok(interieur.adoptedStyleSheets.length > 0)
    assert.ok(cles(interieur)['mjs-fx-sprite-4-2'], 'les images clés dans le composant, là où le calque les cherche')
    assert.equal(hote.hasAttribute('mjs-fx-sprite-clip'), true)
  })

  it('frames: 0, 1001, direction: sideways, on: scroll, times, columns: 0 sont refusés à la compilation', async () => {
    await assert.rejects(compiler('<div *sprite(\'a.png\', frames: 0)>x</div>'), /\*sprite : frames = 0 — permis : int 1\.\.1000/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', frames: 1001)>x</div>'), /\*sprite : frames = 1001/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', columns: 0)>x</div>'), /\*sprite : columns = 0/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', direction: sideways)>x</div>'), /\*sprite : direction = sideways/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', on: scroll)>x</div>'), /\*sprite : on = scroll/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', speed: vite)>x</div>'), /\*sprite : speed = vite/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', times: 2)>x</div>'), /times[\s\S]*repeat/)
    await compiler('<div *sprite(\'a.png\', frames: 1000, columns: 1000, repeat: 1000, start: 999, direction: reverse, on: hover, pixel: true)>x</div>')
  })

  it('*sprite sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *sprite(\'a.png\', frames: 2) src="a.png" alt="a">'), /\*sprite[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève le calque, les marques et les variables', async () => {
    const comp = await monter('mjs-fx-sp-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(calque(el), 'calque posé')
    assert.equal(el.hasAttribute('mjs-fx-sprite-clip'), true)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.equal(el.style.cssText, '', 'variables restées : ' + el.style.cssText)
    assert.equal(el._mjs_fxOff ?? null, null)
  })

  it('les images clés quittent la racine avec leur dernier usager : changement de frames, retrait', async () => {
    const comp = await monter('mjs-fx-sp-feuilles', '.b')
    const noms = () => Object.keys(cles(comp._shadow)).sort()
    assert.deepEqual(noms(), ['mjs-fx-sprite-4-4'], 'deux balises de même planche : une seule feuille')
    comp._shadow.querySelector('.bf').click()
    await pause(60)
    assert.deepEqual(noms(), ['mjs-fx-sprite-3-3', 'mjs-fx-sprite-4-4'], 'frames 3 : la seconde balise garde la feuille des quatre poses')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(60)
    assert.deepEqual(noms(), [], 'plus aucun usager : plus aucune feuille d\'images clés')
  })

  it('un tour fini : will-change est retiré à la fin du dernier tour, remis au tour suivant', async () => {
    const comp  = await monter('mjs-fx-sp')
    const layer = calque(comp._shadow.querySelector('.a'))
    assert.equal(reglage(layer, 'wc'), '', 'en marche : will-change posé')
    layer.dispatchEvent(new window.Event('animationend'))
    assert.equal(reglage(layer, 'wc'), 'auto', 'tour fini : plus de will-change')
    layer.dispatchEvent(new window.Event('animationstart'))
    assert.equal(reglage(layer, 'wc'), '', 'tour suivant : will-change remis')
  })

  // un avertissement du moteur de messages, relevé pendant `corps`
  async function avertissements(corps: () => Promise<void>): Promise<string[]> {
    const vus: string[] = []
    const vrai = window.µ.warn
    window.µ.warn = (...a: any[]) => { vus.push(a.map(String).join(' ')) }
    try {
      await corps()
    } finally {
      window.µ.warn = vrai
    }
    return vus
  }

  const durees = (el: any) => el.querySelector('[mjs-fx-layer="sprite"]').style.getPropertyValue('--mjs-fx-sprite-dur')

  it('fps : la cadence fixe la durée d\'un tour (poses ÷ fps), le calque la lit avant speed', async () => {
    const comp  = await monter('mjs-fx-sp-fps')
    const el    = comp._shadow.querySelector('.a')
    assert.equal(durees(el), '0.5s', 'huit poses à seize par seconde : une demi-seconde')
    assert.match(window.µ._mjs_fxDefs.sprite.css, /\[mjs-fx-layer="sprite"\]\{animation-duration:var\(--mjs-fx-sprite-dur,var\(--mjs-sprite-speed,1s\)\)\}/, 'la durée du calque, posée après le raccourci animation')
  })

  it('fps et speed écrits tous les deux : un avertissement clair, fps l\'emporte', async () => {
    const vus = await avertissements(async () => {
      const comp = await monter('mjs-fx-sp-fps-deux')
      const el   = comp._shadow.querySelector('.a')
      assert.equal(durees(el), '0.8s', 'huit poses à dix par seconde')
      assert.equal(el.style.getPropertyValue('--mjs-sprite-speed'), '2s', 'speed reste posé : fps le recouvre')
    })
    assert.equal(vus.length, 1, 'un seul avertissement : ' + JSON.stringify(vus))
    assert.match(vus[0], /\*sprite : fps et speed sont écrits tous les deux — fps l'emporte/)
  })

  it('fps tenu par une variable : suit sans reposer le calque ; vidé, speed reprend', async () => {
    const comp  = await monter('mjs-fx-sp-fps-var')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(durees(el), '0.5s')
    comp._shadow.querySelector('.bf').click()
    await pause(40)
    assert.equal(durees(el), '0.25s', 'fps 20 : cinq poses en un quart de seconde')
    assert.ok(calque(el) === layer, 'le même calque')
    comp._shadow.querySelector('.bx').click()
    await pause(40)
    assert.equal(durees(el), '', 'plus de fps : la durée revient à speed')
  })

  it('poses : l\'ordre libre [1, 2, 1, 0], les images clés suivent la liste ; rows et row : une ligne, le calque en porte toutes', async () => {
    const comp  = await monter('mjs-fx-sp-poses')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(reglage(layer, 'c'), '3')
    assert.equal(reglage(layer, 'r'), '4', 'quatre lignes dans la planche')
    assert.equal(reglage(layer, 'row'), '2', 'la ligne montrée')
    assert.equal(reglage(layer, 'at'), '-33.3333% 0%', 'start: 1 : la deuxième colonne')
    assert.equal(durees(el), '0.8s', 'quatre entrées à cinq par seconde')
    const nom = reglage(layer, 'name')
    assert.match(nom, /^mjs-fx-sprite-/)
    const k = cles(comp._shadow)[nom]
    const textes = Array.from(k.cssRules).map((r: any) => `${r.keyText} ${r.style.getPropertyValue('translate')}`)
    assert.deepEqual(textes, ['0% -33.3333% 0%', '25% -66.6667% 0%', '50% -33.3333% 0%', '75% 0% 0%', '100% 0% 0%'], 'cases 1, 2, 1, 0 ; le 100 % tient la dernière entrée')
  })

  it('poses sans rows : ce sont des numéros de case de la planche entière, ramenés dans la planche ; sans frames, la planche va jusqu\'au plus grand numéro', async () => {
    const comp  = await monter('mjs-fx-sp-poses-nu')
    const layer = calque(comp._shadow.querySelector('.a'))
    assert.equal(reglage(layer, 'r'), '2')
    const k = cles(comp._shadow)[reglage(layer, 'name')]
    const textes = Array.from(k.cssRules).map((r: any) => r.style.getPropertyValue('translate'))
    assert.deepEqual(textes, ['-33.3333% -50%', '0% 0%', '-66.6667% -50%', '-66.6667% -50%', '-66.6667% -50%'], '4, 0, 5, 9 (ramené à 5) ; le 100 % tient la dernière')
  })

  it('row tenu par une variable : la ligne suit sans reposer le calque ni les images clés, bornée à rows', async () => {
    const comp  = await monter('mjs-fx-sp-rows')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    const noms  = Object.keys(cles(comp._shadow)).sort()
    assert.equal(reglage(layer, 'row'), '1')
    comp._shadow.querySelector('.bh').click()
    await pause(40)
    assert.equal(reglage(layer, 'row'), '3', 'row: 9 sur quatre lignes : ramené à la dernière, comme start')
    comp._shadow.querySelector('.bc').click()
    await pause(40)
    assert.equal(reglage(layer, 'row'), '3')
    assert.ok(calque(el) === layer, 'le même calque : rien n\'a été reposé')
    assert.deepEqual(Object.keys(cles(comp._shadow)).sort(), noms, 'les mêmes images clés')
  })

  it('row sans rows : ignoré avec un avertissement (row: 0, le défaut du catalogue, n\'en fait pas) ; une entrée de poses qui n\'est pas un numéro : écartée avec un avertissement', async () => {
    const vus = await avertissements(async () => {
      const seul = await monter('mjs-fx-sp-row-seul')
      assert.equal(reglage(calque(seul._shadow.querySelector('.a')), 'row'), '', 'pas de rows : pas de ligne')
      await monter('mjs-fx-sp-row-zero')
      const mauvaise = await monter('mjs-fx-sp-mauvaise')
      const k = cles(mauvaise._shadow)[reglage(calque(mauvaise._shadow.querySelector('.a')), 'name')]
      assert.equal(k.cssRules.length, 3, 'deux numéros valables et le 100 %')
    })
    assert.equal(vus.length, 2, JSON.stringify(vus))
    assert.match(vus[0], /\*sprite : row sans rows — row est ignoré/)
    assert.match(vus[1], /\*sprite : poses : « a » n'est pas un numéro de case — écarté/)
  })

  it('row: 1 sans rows avertit aussi (seul row: 0, le défaut du catalogue, se tait)', async () => {
    const vus = await avertissements(async () => {
      const comp = await monter('mjs-fx-sp-row-un')
      assert.equal(reglage(calque(comp._shadow.querySelector('.a')), 'row'), '')
    })
    assert.equal(vus.length, 1, JSON.stringify(vus))
    assert.match(vus[0], /row sans rows/)
  })

  it('row écrit en dur, au montage : borné à la dernière ligne (99 sur quatre lignes : 3)', async () => {
    const comp = await monter('mjs-fx-sp-rows-fixe')
    assert.equal(reglage(calque(comp._shadow.querySelector('.a')), 'row'), '3')
  })

  it('poses avec rows : une entrée au-delà des colonnes d\'une ligne est ramenée à la dernière colonne (7 sur trois colonnes : 2)', async () => {
    const comp = await monter('mjs-fx-sp-poses-cap')
    const k    = cles(comp._shadow)[reglage(calque(comp._shadow.querySelector('.a')), 'name')]
    const textes = Array.from(k.cssRules).map((r: any) => r.style.getPropertyValue('translate'))
    assert.deepEqual(textes, ['-33.3333% 0%', '-66.6667% 0%', '-66.6667% 0%', '-66.6667% 0%'], '1, 2, 7 (ramené à 2) ; le 100 % tient la dernière')
  })

  it('animate: false écrit au montage : la planche ne démarre pas, elle montre la pose start', async () => {
    const comp  = await monter('mjs-fx-sp-arret')
    const layer = calque(comp._shadow.querySelector('.a'))
    assert.equal(reglage(layer, 'go'), 'none', 'aucune animation dès le montage')
    assert.equal(reglage(layer, 'wc'), 'auto')
    assert.equal(reglage(layer, 'at'), '-66.6667% 0%', 'la pose start')
  })

  it('le retrait de l\'effet : plus aucun mjs:sprite-end, ni à la fin d\'un tour, ni à la fin de la dernière répétition', async () => {
    const comp  = await monter('mjs-fx-sp-fin-retrait')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    let vus     = 0
    el.addEventListener('mjs:sprite-end', () => { vus++ })
    layer.dispatchEvent(new window.Event('animationiteration'))
    assert.equal(vus, 1, 'posé : un signal par tour fini')
    comp._shadow.querySelector('.t').click()
    await pause(40)
    assert.ok(!comp._shadow.querySelector('.a'), 'retiré')
    layer.dispatchEvent(new window.Event('animationiteration'))
    layer.dispatchEvent(new window.Event('animationend'))
    assert.equal(vus, 1, 'retiré : plus aucun signal')
  })

  it('animate : faux, le calque revient à la pose start et ne défile plus ; vrai, il repart — sans reposer le calque', async () => {
    const comp  = await monter('mjs-fx-sp-animate')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(reglage(layer, 'go'), '', 'il joue')
    comp._shadow.querySelector('.bo').click()
    await pause(40)
    assert.equal(reglage(layer, 'go'), 'none', 'à l\'arrêt : aucune animation')
    assert.equal(reglage(layer, 'wc'), 'auto', 'ni will-change')
    assert.equal(reglage(layer, 'at'), '-33.3333% 0%', 'la pose start')
    assert.ok(calque(el) === layer)
    comp._shadow.querySelector('.bo').click()
    await pause(40)
    assert.equal(reglage(layer, 'go'), '')
    assert.equal(reglage(layer, 'wc'), '')
  })

  it('hold : la dernière pose est gardée à la fin d\'un tour (animation-fill-mode), le réglage suit sans reposer', async () => {
    const comp  = await monter('mjs-fx-sp-hold')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(layer.hasAttribute('mjs-fx-sprite-hold'), true)
    assert.match(window.µ._mjs_fxDefs.sprite.css, /\[mjs-fx-layer="sprite"\]\[mjs-fx-sprite-hold\]\{animation-fill-mode:forwards\}/)
    comp._shadow.querySelector('.bh').click()
    await pause(40)
    assert.equal(layer.hasAttribute('mjs-fx-sprite-hold'), false)
    assert.ok(calque(el) === layer)
  })

  it('un tour fini : l\'événement mjs:sprite-end part de la balise (un par tour), l\'auteur l\'écoute par @mjs:sprite-end', async () => {
    const comp  = await monter('mjs-fx-sp-signal')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    layer.dispatchEvent(new window.Event('animationiteration'))
    await pause(40)
    assert.equal(comp._shadow.querySelector('.n').textContent, '1', 'le premier tour fini')
    layer.dispatchEvent(new window.Event('animationend'))
    await pause(40)
    assert.equal(comp._shadow.querySelector('.n').textContent, '2', 'le dernier tour fini')
  })

  it('fps, rows, row, poses, animate, hold : les valeurs hors plage sont refusées à la compilation', async () => {
    await assert.rejects(compiler('<div *sprite(\'a.png\', fps: 0)>x</div>'), /\*sprite : fps = 0/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', fps: 500)>x</div>'), /\*sprite : fps = 500/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', rows: 0)>x</div>'), /\*sprite : rows = 0/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', rows: 2, row: -1)>x</div>'), /\*sprite : row = -1/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', animate: 2)>x</div>'), /\*sprite : animate = 2/)
    await assert.rejects(compiler('<div *sprite(\'a.png\', hold: oui)>x</div>'), /\*sprite : hold = oui/)
    await compiler('<div *sprite(\'a.png\', columns: 3, rows: 4, row: 3, poses: [1, 2, 1, 0], fps: 5.5, animate: true, hold: true)>x</div>')
  })

  it('la densité de l\'écran : chaque pose est arrondie au pixel de l\'écran, relu quand la densité change — un seul écouteur pour tous les sprites, retiré avec le dernier', async () => {
    window.document.body.innerHTML = ''
    await pause(60)
    const requetes: any[] = []
    const vrai    = window.matchMedia
    const densite = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    let dpr = 1.25
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr })
    window.matchMedia = (q: string) => {
      const r: any = { q, ecouteurs: [] as any[], addEventListener(_: string, f: any) { r.ecouteurs.push(f) }, removeEventListener(_: string, f: any) { r.ecouteurs = r.ecouteurs.filter((x: any) => x !== f) } }
      requetes.push(r)
      return r
    }
    try {
      const comp = await monter('mjs-fx-sp-liste', '.c')
      const calques = ['a', 'b', 'c'].map((c) => calque(comp._shadow.querySelector('.' + c)))
      for (const l of calques) {
        assert.equal(l.hasAttribute('mjs-fx-sprite-snap'), true, 'plusieurs poses : le calque est arrondi')
        assert.equal(reglage(l, 'px'), '0.8px', 'un pixel de l\'écran à la densité 1,25')
      }
      assert.equal(requetes.length, 1, 'une seule requête de densité pour trois sprites')
      assert.equal(requetes[0].q, '(resolution: 1.25dppx)')
      assert.equal(requetes[0].ecouteurs.length, 1)
      // la densité change (zoom de la page) : la requête est refaite, chaque calque relit
      dpr = 1.5
      requetes[0].ecouteurs[0]()
      assert.equal(requetes.length, 2)
      assert.equal(requetes[1].q, '(resolution: 1.5dppx)')
      assert.equal(requetes[0].ecouteurs.length, 0, 'l\'ancienne requête ne prévient plus')
      assert.equal(requetes[1].ecouteurs.length, 1)
      for (const l of calques) assert.equal(reglage(l, 'px'), '0.666667px')
      window.document.body.innerHTML = ''
      await pause(60)
      assert.equal(requetes[requetes.length - 1].ecouteurs.length, 0, 'plus de sprite : plus d\'écouteur de densité')
      // une seule pose : rien à arrondir, rien à suivre
      const seule = await monter('mjs-fx-sp-seule')
      const unique = calque(seule._shadow.querySelector('.a'))
      assert.equal(unique.hasAttribute('mjs-fx-sprite-snap'), false)
      assert.equal(reglage(unique, 'px'), '')
      assert.equal(requetes[requetes.length - 1].ecouteurs.length, 0)
    } finally {
      window.matchMedia = vrai
      if (densite) Object.defineProperty(window, 'devicePixelRatio', densite)
      else delete (window as any).devicePixelRatio
    }
  })
})
