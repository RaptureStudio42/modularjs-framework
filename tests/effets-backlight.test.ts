// *backlight — une lueur aux couleurs de l'image : le double posé juste avant la balise, ses réglages recopiés, l'état (always,
// hover…), l'image suivie, la boîte relue par un seul observateur partagé, `legend` (le parent isolé, le double sous tout ce qu'il contient,
// le parent rendu tel quel au retrait), le retrait sans reste, les refus de compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { compter, garde, statique, rendreTout } from './helpers/happy-dom-espions.js'

const COMPOSANTS: Record<string, string> = {
  'fx-backlight-base':    '<div class="p"><img class="a" *backlight src="a.png" alt=""></div>',
  'fx-backlight-regles':  '<div class="p"><img class="a" *backlight(40, opacity: 0.6, saturate: 2, size: 1.5, x: 10, y: 24, duration: 500ms, on: hover) src="a.png" alt=""></div>',
  'fx-backlight-fond':    '<div class="p"><div class="a" *backlight>x</div></div>',
  'fx-backlight-mode':    '<script>\n$m = \'hover\'\n</script>\n<div class="p"><img class="a" *backlight(on: $m) src="a.png" alt=""></div>\n<button class="t" @click={$m = \'always\'}>t</button>',
  'fx-backlight-clic':    '<div class="p"><img class="a" *backlight(on: click) src="a.png" alt=""></div>',
  'fx-backlight-variable': '<script>\n$f = 24\n$o = 0.8\n</script>\n<div class="p"><img class="a" *backlight($f, opacity: $o) src="a.png" alt=""></div>\n<button class="f" @click={$f = 60}>f</button>\n<button class="o" @click={$o = 0.3}>o</button>',
  'fx-backlight-deux':    '<script>\n$on = true\n</script>\n{if $on}<div class="p"><img class="a" *backlight src="a.png" alt=""><img class="b" *backlight src="b.png" alt=""></div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-backlight-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="p"><img class="a" *backlight(on: hover) src="a.png" alt=""></div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-backlight-un-seul': '<script>\n$a = true\n</script>\n<div class="p">{if $a}<img class="a" *backlight src="a.png" alt="">{end}<img class="b" *backlight src="b.png" alt=""></div>\n<button class="t" @click={$a = !$a}>t</button>',
  'fx-backlight-fond-retrait': '<div class="p"><div class="f" *backlight>x</div></div>',
  'fx-backlight-legende':      '<figure class="p"><img class="a" *backlight(legend: true) src="a.png" alt=""><figcaption class="c">texte</figcaption></figure>',
  'fx-backlight-legende-deux': '<script>\n$a = true\n$b = true\n</script>\n<figure class="p">{if $a}<img class="a" *backlight(legend: true) src="a.png" alt="">{end}{if $b}<img class="b" *backlight(legend: true) src="b.png" alt="">{end}</figure>\n<button class="ta" @click={$a = !$a}>ta</button>\n<button class="tb" @click={$b = !$b}>tb</button>',
  'fx-backlight-legende-style': '<script>\n$on = true\n</script>\n<figure class="p" style="color: red">{if $on}<img class="a" *backlight(legend: true) src="a.png" alt="">{end}</figure>\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-backlight-legende-avant': '<script>\n$on = true\n</script>\n<figure class="p" style="isolation: auto">{if $on}<img class="a" *backlight(legend: true) src="a.png" alt="">{end}</figure>\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-backlight-legende-variable': '<script>\n$l = false\n</script>\n<figure class="p"><img class="a" *backlight(legend: $l) src="a.png" alt=""></figure>\n<button class="o" @click={$l = true}>o</button>\n<button class="n" @click={$l = false}>n</button>',
  'fx-backlight-legende-racine': '<img class="a" *backlight(legend: true) src="a.png" alt="">',
  'fx-backlight-legende-z':    '<figure class="p"><img class="a" style="position: relative; z-index: -3" *backlight(legend: true) src="a.png" alt=""><img class="b" style="position: relative; z-index: 5" *backlight(legend: true) src="b.png" alt=""></figure>',
  'fx-backlight-legende-deja':   '<figure class="p" style="isolation: isolate"><img class="a" *backlight(legend: true) src="a.png" alt=""></figure>'
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *backlight', function () {
  this.timeout(60000)
  let window: any
  let code = ''

  before(async () => {
    const root   = mjsTmp('effets-backlight')
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
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  // une fenêtre neuve par test : un observateur de taille factice, des messages relevés
  let espion: ReturnType<typeof compter>

  function fenetre(avant?: (w: any) => void) {
    rendreTout()
    window?.close?.()
    window = new Window({ url: 'http://localhost/' })
    garde(window)
    avant?.(window)
    window.eval(`${code}\nglobalThis.µ = µ;`)
  }

  // happy-dom partage ses prototypes : ce qu'un essai a remplacé est rendu avant le suivant
  afterEach(rendreTout)

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

  const calque = (el: any) => el.previousSibling

  it('le double est un frère juste avant la balise : inerte, caché des lecteurs d\'écran, la balise reste par-dessus', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-base')
    const img  = comp._shadow.querySelector('.a')
    const l    = calque(img)
    assert.equal(l.getAttribute('mjs-fx-layer'), 'backlight')
    assert.equal(l.getAttribute('aria-hidden'), 'true')
    assert.ok(l.parentNode === img.parentNode, 'même parent que la balise')
    assert.ok((img.getAttribute('mjs-fx') ?? '').split(' ').includes('backlight'))
    assert.equal(img.getAttribute('mjs-fx-on'), 'backlight', 'on: always — allumé dès la pose')
    assertAbsent(img.querySelector('[mjs-fx-layer]'), 'rien dans la balise elle-même')
  })

  it('le CSS : aucun clic capté, flou et saturation calculés une fois, seule l\'opacité se transitionne, aucun fondu si on réduit les animations', async () => {
    fenetre()
    const css = window.µ._mjs_fxDefs.backlight.css
    assert.match(css, /\[mjs-fx-layer="backlight"\]\{[^}]*pointer-events:none!important/)
    assert.match(css, /filter:blur\(var\(--mjs-backlight-blur,24px\)\) saturate\(var\(--mjs-backlight-saturate,1\.4\)\)/)
    assert.match(css, /transition:opacity var\(--mjs-backlight-duration,300ms\) ease/)
    assert.doesNotMatch(css, /transition:[^;}]*(transform|filter|left|top|width|height)/, 'seule l\'opacité bouge')
    assert.doesNotMatch(css, /will-change|animation:/, 'rien ne tourne au repos')
    assert.match(css, /\[mjs-fx-layer="backlight"\]:has\(\+ \[mjs-fx-on~="backlight"\]\)\{opacity:var\(--mjs-backlight-opacity,0\.8\)\}/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\[mjs-fx-layer="backlight"\]\{transition:none\}\}/)
  })

  it('*backlight(40, opacity: 0.6, saturate: 2, size: 1.5, x: 10, y: 24, duration: 500ms, on: hover) : chaque réglage recopié sur le double', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-regles')
    const img  = comp._shadow.querySelector('.a')
    const l    = calque(img)
    const v    = (n: string) => l.style.getPropertyValue('--mjs-backlight-' + n)
    assert.equal(v('blur'), '40px')
    assert.equal(v('opacity'), '0.6')
    assert.equal(v('saturate'), '2')
    assert.equal(v('size'), '1.5')
    assert.equal(v('x'), '10px')
    assert.equal(v('y'), '24px')
    assert.equal(v('duration'), '500ms')
    // la balise porte les siens aussi (le moteur les pose) : le thème et les variables les suivent
    assert.equal(img.style.getPropertyValue('--mjs-backlight-blur'), '40px')
  })

  it('on: hover — éteint au repos, allumé pendant le survol de la balise, éteint à la sortie', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-regles')
    const img  = comp._shadow.querySelector('.a')
    assert.equal(img.getAttribute('mjs-fx-on'), null)
    img.dispatchEvent(new window.Event('pointerenter'))
    assert.equal(img.getAttribute('mjs-fx-on'), 'backlight')
    img.dispatchEvent(new window.Event('pointerleave'))
    assert.equal(img.getAttribute('mjs-fx-on'), null)
  })

  it('on: click — chaque clic bascule l\'état', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-clic')
    const img  = comp._shadow.querySelector('.a')
    assert.equal(img.getAttribute('mjs-fx-on'), null)
    img.click()
    assert.equal(img.getAttribute('mjs-fx-on'), 'backlight')
    img.click()
    assert.equal(img.getAttribute('mjs-fx-on'), null)
  })

  it('`on` tenu par une variable : l\'effet repart avec le nouveau mode, sans laisser un second double', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-mode')
    const img  = comp._shadow.querySelector('.a')
    assert.equal(img.getAttribute('mjs-fx-on'), null, 'hover : éteint au repos')
    const avant = calque(img)
    comp._shadow.querySelector('.t').click()
    await attendre(() => img.getAttribute('mjs-fx-on') === 'backlight')
    assert.equal(img.getAttribute('mjs-fx-on'), 'backlight', 'always : allumé')
    assert.equal(comp._shadow.querySelectorAll('[mjs-fx-layer="backlight"]').length, 1, 'un seul double')
    assert.ok(avant.parentNode === null, 'l\'ancien double est parti')
    assert.equal(calque(img).getAttribute('mjs-fx-layer'), 'backlight')
  })

  it('l\'image est suivie : appelée seulement une fois la balise chargée, relue à chaque `load`', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-base')
    const img  = comp._shadow.querySelector('.a')
    const l    = calque(img)
    const src  = () => l.style.getPropertyValue('--mjs-fx-backlight-src')
    const etat = (complete: boolean, url: string) => {
      Object.defineProperty(img, 'complete', { value: complete, configurable: true })
      Object.defineProperty(img, 'currentSrc', { value: url, configurable: true })
      img.dispatchEvent(new window.Event('load'))
    }
    etat(false, 'http://localhost/lourde.png')
    assert.equal(src(), '', 'pas chargée (loading="lazy" loin de l\'écran) : le double n\'appelle pas l\'image')
    etat(true, 'http://localhost/a.png')
    assert.equal(src(), 'url("http://localhost/a.png")')
    etat(true, 'http://localhost/b.png')
    assert.equal(src(), 'url("http://localhost/b.png")', 'le `src` change : le double suit')
    etat(true, 'http://localhost/c"d\\e.png')
    assert.equal(src(), 'url("http://localhost/c\\"d\\\\e.png")', 'guillemets et barres échappés')
  })

  it('une balise à image de fond : le premier fond en url(…) est copié, les autres fonds (dégradé) non ; il suit le style', async () => {
    const msgs: string[] = []
    fenetre()
    window.µ.warn = (m: string) => msgs.push(String(m))
    const comp = await monter('mjs-fx-backlight-fond')
    const div  = comp._shadow.querySelector('.a')
    const l    = calque(div)
    assert.equal(msgs.length, 1, 'sans image ni fond : un avertissement')
    assert.match(msgs[0], /\*backlight : la balise <div> n'a ni image ni image de fond — le halo n'a rien à copier/)
    div.style.backgroundImage = 'linear-gradient(red, blue), url("http://localhost/fond.png")'
    await attendre(() => l.style.getPropertyValue('--mjs-fx-backlight-src') !== '')
    assert.match(l.style.getPropertyValue('--mjs-fx-backlight-src'), /^url\("http:\/\/localhost\/fond\.png"\)$/)
    div.style.backgroundImage = 'url("http://localhost/autre.png")'
    await attendre(() => /autre/.test(l.style.getPropertyValue('--mjs-fx-backlight-src')))
    assert.match(l.style.getPropertyValue('--mjs-fx-backlight-src'), /autre\.png/)
    // la balise a un z-index : le double passe juste dessous
    div.style.zIndex = '5'
    await attendre(() => l.style.getPropertyValue('--mjs-fx-backlight-z') === '4')
    assert.equal(l.style.getPropertyValue('--mjs-fx-backlight-z'), '4')
    div.style.zIndex = ''
    await attendre(() => l.style.getPropertyValue('--mjs-fx-backlight-z') === '')
    assert.equal(l.style.getPropertyValue('--mjs-fx-backlight-z'), '', 'sans z-index (auto) : rien')
    assert.equal(msgs.length, 1, 'un seul avertissement')
  })

  it('un réglage tenu par une variable suit sur place (le double et la balise), sans reposer l\'effet', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-variable')
    const img  = comp._shadow.querySelector('.a')
    const l    = calque(img)
    const off  = img._mjs_fxOff.backlight
    comp._shadow.querySelector('.f').click()
    await attendre(() => l.style.getPropertyValue('--mjs-backlight-blur') === '60px')
    assert.equal(l.style.getPropertyValue('--mjs-backlight-blur'), '60px')
    assert.equal(img.style.getPropertyValue('--mjs-backlight-blur'), '60px')
    comp._shadow.querySelector('.o').click()
    await attendre(() => l.style.getPropertyValue('--mjs-backlight-opacity') === '0.3')
    assert.equal(l.style.getPropertyValue('--mjs-backlight-opacity'), '0.3')
    assert.ok(img._mjs_fxOff.backlight === off, 'le même effet : rien n\'a été reposé')
    assert.ok(calque(img) === l, 'le même double')
  })

  it('off.set suit chacun des sept réglages visuels sur le double, rend false pour `on` (l\'effet repart)', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-base')
    const img  = comp._shadow.querySelector('.a')
    const l    = calque(img)
    const hot  = img._mjs_fxOff.backlight._hot
    const essais: Array<[string, any, string]> = [['blur', 80, '80px'], ['opacity', 0.4, '0.4'], ['saturate', 3, '3'], ['size', 1.7, '1.7'], ['x', -30, '-30px'], ['y', 40, '40px'], ['duration', '1s', '1s']]
    for (const [k, v, attendu] of essais) {
      assert.equal(hot(k, v), undefined, k)
      assert.equal(l.style.getPropertyValue('--mjs-backlight-' + k), attendu, k)
      hot(k, undefined)
      assert.equal(l.style.getPropertyValue('--mjs-backlight-' + k), '', k + ' retiré : le CSS reprend son repli')
    }
    assert.equal(hot('on', 'hover'), false)
  })

  // un observateur de taille factice : il note ce qu'il observe et s'il est débranché
  const fauxObservateur = () => {
    const vies: any[] = []
    class Faux {
      cible = new Set<any>()
      off = false
      constructor(public cb: (e: any[]) => void) { vies.push(this) }
      observe(t: any) { this.cible.add(t) }
      unobserve(t: any) { this.cible.delete(t) }
      disconnect() { this.off = true; this.cible.clear() }
    }
    return { vies, Faux }
  }

  it('un seul ResizeObserver pour tous les halos : la boîte de chaque balise est relue d\'un coup, puis écrite', async () => {
    const { vies, Faux } = fauxObservateur()
    fenetre((w) => { w.ResizeObserver = Faux })
    const comp = await monter('mjs-fx-backlight-deux')
    const a = comp._shadow.querySelector('.a')
    const b = comp._shadow.querySelector('.b')
    assert.equal(vies.length, 1, 'un seul observateur')
    assert.equal(vies[0].cible.size, 3, 'les deux balises et leur parent')
    const boite = (n: any, l: number, t: number, w: number, h: number) => {
      for (const [k, v] of Object.entries({ offsetLeft: l, offsetTop: t, offsetWidth: w, offsetHeight: h })) Object.defineProperty(n, k, { value: v, configurable: true })
    }
    boite(a, 10, 20, 200, 100)
    boite(b, 300, 20, 50, 60)
    const lit = (n: any) => ['l', 't', 'w', 'h'].map((k) => calque(n).style.getPropertyValue('--mjs-fx-backlight-' + k)).join(' ')
    vies[0].cb([{ target: a }])
    assert.equal(lit(a), '10px 20px 200px 100px')
    assert.equal(lit(b), '0px 0px 0px 0px', 'la balise b n\'a pas changé : pas relue')
    vies[0].cb([{ target: a.parentNode }])
    assert.equal(lit(b), '300px 20px 50px 60px', 'le parent change : toutes les balises sont relues')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(30)
    assert.ok(vies[0].off, 'la dernière retirée débranche l\'observateur')
  })

  it('les enfants du parent changent (liste réordonnée) : le double revient juste avant sa balise', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-deux')
    const a = comp._shadow.querySelector('.a')
    const b = comp._shadow.querySelector('.b')
    const p = a.parentNode
    const la = calque(a)
    // la balise passe en dernier (une ligne de liste réordonnée) : son double reste en arrière, il doit la rejoindre
    p.appendChild(a)
    assert.ok(calque(a) !== la, 'la balise a quitté son double')
    await attendre(() => calque(a) === la)
    assert.ok(calque(a) === la, 'le double a suivi la balise')
    assert.ok(la.parentNode === p)
  })

  it('le retrait ({if} refermé) : le double s\'en va, ni marque, ni variable, la position est rendue', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-retrait')
    const img  = comp._shadow.querySelector('.a')
    const l    = calque(img)
    assert.equal(l.getAttribute('mjs-fx-layer'), 'backlight')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.ok(l.parentNode === null, 'le double est retiré')
    assert.deepEqual(img.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.ok(!/--mjs-/.test(img.getAttribute('style') ?? ''), 'variable restée')
    assert.equal(img.style.position, '')
    assert.equal(img._mjs_fxOff ?? null, null)
  })

  // le retrait (le bloc {if} se referme) défait tout ce que la pose a branché : un test par branchement
  const retirer = async (comp: any) => {
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
  }

  it('le retrait débranche l\'écoute du `load` de l\'image : une image qui charge après lui n\'écrit plus dans le double retiré', async () => {
    fenetre((w) => { espion = compter(w) })
    const comp = await monter('mjs-fx-backlight-retrait')
    const img  = comp._shadow.querySelector('.a')
    const l    = calque(img)
    const src  = () => l.style.getPropertyValue('--mjs-fx-backlight-src')
    const avant = src()
    assert.equal(espion.vivants('load', img), 1, 'posée avec l\'effet')
    await retirer(comp)
    assert.equal(espion.vivants('load', img), 0, 'retirée avec lui')
    Object.defineProperty(img, 'complete', { value: true, configurable: true })
    Object.defineProperty(img, 'currentSrc', { value: 'http://localhost/tard.png', configurable: true })
    img.dispatchEvent(new window.Event('load'))
    assert.equal(src(), avant, 'le double retiré n\'est pas réécrit')
    assert.doesNotMatch(src(), /tard\.png/)
  })

  it('le retrait rend la position de la balise : `relative` à la pose, rendue telle qu\'elle était', async () => {
    fenetre(statique)
    const comp = await monter('mjs-fx-backlight-retrait')
    const img  = comp._shadow.querySelector('.a')
    assert.equal(img.style.position, 'relative', 'la balise passe par-dessus son double')
    await retirer(comp)
    assert.equal(img.style.position, '', 'la position est rendue')
  })

  it('le retrait débranche l\'état de la balise : plus d\'écoute du survol, et plus de marque d\'allumage', async () => {
    fenetre((w) => { espion = compter(w) })
    const survol = await monter('mjs-fx-backlight-retrait')
    const img    = survol._shadow.querySelector('.a')
    assert.equal(espion.vivants('pointerenter', img), 1, 'on: hover — le survol est écouté')
    assert.equal(espion.vivants('pointerleave', img), 1)
    await retirer(survol)
    assert.equal(espion.vivants('pointerenter', img), 0, 'pointerenter retiré avec l\'effet')
    assert.equal(espion.vivants('pointerleave', img), 0, 'pointerleave retiré avec l\'effet')
    // toujours allumé : la marque d'allumage de la balise part avec l'effet
    fenetre()
    const toujours = await monter('mjs-fx-backlight-deux')
    const a        = toujours._shadow.querySelector('.a')
    assert.equal(a.getAttribute('mjs-fx-on'), 'backlight', 'on: always — allumé à la pose')
    await retirer(toujours)
    assert.equal(a.getAttribute('mjs-fx-on'), null, 'plus allumé une fois l\'effet retiré')
  })

  it('le retrait désabonne la balise de l\'observateur de taille partagé : seule la balise retirée part, celles qui restent sont encore suivies', async () => {
    const { vies, Faux } = fauxObservateur()
    fenetre((w) => { w.ResizeObserver = Faux })
    const comp = await monter('mjs-fx-backlight-un-seul')
    const a    = comp._shadow.querySelector('.a')
    assert.equal(vies.length, 1, 'un seul observateur')
    assert.equal(vies[0].cible.size, 3, 'les deux balises et leur parent')
    await retirer(comp)
    assert.equal(vies[0].cible.has(a), false, 'la balise retirée n\'est plus observée')
    assert.equal(vies[0].cible.size, 2, 'la balise qui reste et le parent le sont encore')
    assert.equal(vies[0].off, false, 'l\'observateur reste branché pour celle qui reste')
  })

  it('le retrait débranche l\'observateur du fond d\'une balise : un fond qui change après lui n\'écrit plus dans le double retiré', async () => {
    fenetre()
    window.µ.warn = () => {}
    const comp = await monter('mjs-fx-backlight-fond-retrait', '.f')
    const div  = comp._shadow.querySelector('.f')
    const l    = calque(div)
    assert.equal(l.style.getPropertyValue('--mjs-fx-backlight-src'), '', 'sans fond : rien à copier')
    // l'effet est défait (comme le fait le moteur), la balise reste dans la page : son style se calcule encore
    div._mjs_fxOff.backlight()
    assert.ok(l.parentNode === null, 'le double est retiré')
    div.style.backgroundImage = 'url("http://localhost/autre.png")'
    await pause(50)
    assert.equal(l.style.getPropertyValue('--mjs-fx-backlight-src'), '', 'le fond change après le retrait : le double n\'est pas réécrit')
  })

  it('sans ResizeObserver : la boîte est lue à la pose et à chaque redimensionnement de la fenêtre', async () => {
    fenetre((w) => { w.ResizeObserver = undefined })
    const comp = await monter('mjs-fx-backlight-base')
    const img  = comp._shadow.querySelector('.a')
    assert.equal(calque(img).style.getPropertyValue('--mjs-fx-backlight-w'), '0px')
    Object.defineProperty(img, 'offsetWidth', { value: 120, configurable: true })
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(calque(img).style.getPropertyValue('--mjs-fx-backlight-w'), '120px')
  })

  // `legend: true` : le parent devient un contexte d'empilement (`isolation: isolate`, posée en ligne) et le double passe à z-index -1
  const zDe = (img: any) => calque(img).style.getPropertyValue('--mjs-fx-backlight-z')

  it('legend: true — le parent est isolé (isolation: isolate) et le double passe à z-index -1 ; sans legend, ni le parent ni le z-index ne sont touchés', async () => {
    fenetre()
    const sans = await monter('mjs-fx-backlight-base')
    const p0   = sans._shadow.querySelector('.p')
    assert.equal(p0.style.getPropertyValue('isolation'), '', 'sans legend : le parent n\'est pas isolé')
    assert.ok(!p0.hasAttribute('style'), 'sans legend : le parent n\'a pas de style')
    assert.equal(zDe(sans._shadow.querySelector('.a')), '', 'sans legend : le double garde z-index auto')
    fenetre()
    const avec = await monter('mjs-fx-backlight-legende')
    const p    = avec._shadow.querySelector('.p')
    const img  = avec._shadow.querySelector('.a')
    assert.equal(p.style.getPropertyValue('isolation'), 'isolate', 'le parent est un contexte d\'empilement')
    assert.equal(zDe(img), '-1', 'le double passe sous tout ce que le parent contient')
    assert.equal(img.style.getPropertyValue('isolation'), '', 'l\'image n\'est pas touchée')
    assert.ok(!avec._shadow.querySelector('.c').hasAttribute('style'), 'la légende n\'est pas touchée')
  })

  it('legend — le retrait rend le parent tel quel (son style d\'avant, ou aucun style) ; une autre balise dans le parent le garde isolé jusqu\'à son retrait', async () => {
    fenetre()
    const st = await monter('mjs-fx-backlight-legende-style')
    const ps = st._shadow.querySelector('.p')
    assert.equal(ps.style.getPropertyValue('isolation'), 'isolate')
    assert.equal(ps.style.getPropertyValue('color'), 'red', 'son style d\'avant est gardé')
    await retirer(st)
    assert.equal(ps.style.getPropertyValue('isolation'), '', 'rendu : plus d\'isolation')
    assert.equal(ps.style.getPropertyValue('color'), 'red', 'son style d\'avant est rendu tel quel')
    assert.ok(!/isolation/.test(ps.getAttribute('style') ?? ''), 'aucune trace dans l\'attribut style')
    // une valeur d'isolation que l'auteur avait écrite (autre que isolate) : isolé le temps de l'effet, puis rendue telle quelle
    fenetre()
    const av = await monter('mjs-fx-backlight-legende-avant')
    const pa = av._shadow.querySelector('.p')
    assert.equal(pa.style.getPropertyValue('isolation'), 'isolate', 'isolé le temps de l\'effet')
    await retirer(av)
    assert.equal(pa.style.getPropertyValue('isolation'), 'auto', 'la valeur écrite avant l\'effet est rendue telle quelle')
    fenetre()
    const deux = await monter('mjs-fx-backlight-legende-deux')
    const p    = deux._shadow.querySelector('.p')
    assert.equal(p.style.getPropertyValue('isolation'), 'isolate', 'isolé une seule fois pour les deux balises')
    deux._shadow.querySelector('.ta').click()
    await attendre(() => !deux._shadow.querySelector('.a'))
    await pause(50)
    assert.equal(p.style.getPropertyValue('isolation'), 'isolate', 'une balise reste : le parent reste isolé')
    deux._shadow.querySelector('.tb').click()
    await attendre(() => !deux._shadow.querySelector('.b'))
    await pause(50)
    assert.equal(p.style.getPropertyValue('isolation'), '', 'la dernière est partie : le parent est rendu')
    assert.ok(!p.hasAttribute('style'), 'sans style, comme avant')
  })

  it('legend avec un z-index sur la balise : le double reste sous elle, et sous tout ce que le parent contient (-1 au plus haut)', async () => {
    fenetre()
    const comp = await monter('mjs-fx-backlight-legende-z')
    assert.equal(zDe(comp._shadow.querySelector('.a')), '-4', 'la balise à z-index -3 : le double passe dessous, à -4')
    assert.equal(zDe(comp._shadow.querySelector('.b')), '-1', 'la balise à z-index 5 : le double reste à -1, sous le texte voisin')
    assert.equal(comp._shadow.querySelector('.p').style.getPropertyValue('isolation'), 'isolate')
  })

  it('legend suivi sur place par une variable ; à la racine d\'un composant : son hôte est isolé ; un parent déjà isolé par l\'auteur : laissé tel quel', async () => {
    fenetre()
    const v = await monter('mjs-fx-backlight-legende-variable')
    const pv = v._shadow.querySelector('.p')
    const iv = v._shadow.querySelector('.a')
    assert.equal(pv.style.getPropertyValue('isolation'), '', 'legend: false')
    assert.equal(zDe(iv), '')
    v._shadow.querySelector('.o').click()
    await attendre(() => pv.style.getPropertyValue('isolation') === 'isolate')
    assert.equal(pv.style.getPropertyValue('isolation'), 'isolate', 'legend passe à vrai : le parent est isolé')
    assert.equal(zDe(iv), '-1')
    assert.ok(calque(iv) === iv.previousSibling && calque(iv).parentNode === pv, 'le même double, rien n\'a été reposé')
    v._shadow.querySelector('.n').click()
    await attendre(() => pv.style.getPropertyValue('isolation') === '')
    assert.equal(pv.style.getPropertyValue('isolation'), '', 'legend repasse à faux : le parent est rendu')
    assert.equal(zDe(iv), '')
    assert.ok(!pv.hasAttribute('style'))
    fenetre()
    const racine = await monter('mjs-fx-backlight-legende-racine')
    assert.equal(racine.style.getPropertyValue('isolation'), 'isolate', 'à la racine d\'un composant : l\'hôte est isolé')
    assert.equal(zDe(racine._shadow.querySelector('.a')), '-1')
    racine._shadow.querySelector('.a')._mjs_fxOff.backlight()
    assert.equal(racine.style.getPropertyValue('isolation'), '', 'l\'hôte est rendu')
    assert.ok(!racine.hasAttribute('style'))
    fenetre()
    const deja = await monter('mjs-fx-backlight-legende-deja')
    deja._shadow.querySelector('.a')._mjs_fxOff.backlight()
    assert.equal(deja._shadow.querySelector('.p').style.getPropertyValue('isolation'), 'isolate', 'ce que l\'auteur a écrit reste')
  })

  it('blur: 201, opacity: 2, size: 3, x: 600 sont refusés, on: load aussi, un réglage inconnu aussi', async () => {
    await assert.rejects(compiler('<img *backlight(blur: 201) src="a.png" alt="">'), /\*backlight : blur = 201 — permis : int 0\.\.200/)
    await assert.rejects(compiler('<img *backlight(opacity: 2) src="a.png" alt="">'), /\*backlight : opacity = 2 — permis : float 0\.\.1/)
    await assert.rejects(compiler('<img *backlight(size: 3) src="a.png" alt="">'), /\*backlight : size = 3 — permis : float 0\.5\.\.2/)
    await assert.rejects(compiler('<img *backlight(x: 600) src="a.png" alt="">'), /\*backlight : x = 600 — permis : int -500\.\.500/)
    await assert.rejects(compiler('<img *backlight(on: load) src="a.png" alt="">'), /\*backlight : on/)
    await assert.rejects(compiler('<img *backlight(lueur: 2) src="a.png" alt="">'), /\*backlight/)
    await compiler('<img *backlight(40, opacity: 0.6, saturate: 4, size: 2, x: -500, y: 500, duration: 1s, on: view) src="a.png" alt="">')
    await compiler('<div class="fond" *backlight(on: click)>x</div>')
    // legend : un booléen
    await compiler('<img *backlight(legend: true) src="a.png" alt="">')
    await compiler('<img *backlight(legend: false) src="a.png" alt="">')
    await assert.rejects(compiler('<img *backlight(legend: oui) src="a.png" alt="">'), /\*backlight : legend = oui/)
    await assert.rejects(compiler('<img *backlight(legend: 1) src="a.png" alt="">'), /\*backlight : legend = 1/)
  })
})
