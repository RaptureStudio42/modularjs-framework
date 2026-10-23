// Effets — exécution : de vrais composants compilés, chargés dans happy-dom. Un effet se pose au
// montage (marque `mjs-fx`, variables CSS de ses réglages, feuille adoptée par le shadow root du
// composant), réagit (souris, défilement, minuteries), et se retire quand l'élément part —
// bloc {if}/{for} refermé ou composant détruit. Seuls les effets écrits sont construits, chacun dans
// son propre fichier (importé par les composants qui l'écrivent) : le cœur ne garde que le moteur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mesurer } from './helpers/mesure-balise.js'

const COMPOSANTS: Record<string, string> = {
  'fx-neon':   '<h1 class="t" *neon(#f0f, flicker: true)>Néon</h1>',
  'fx-glitch': '<script>\n$titre = "MJS"\n</script>\n<h1 class="g" *glitch(every: 0)>{$titre}</h1>\n<button class="b" @click={$titre = "ABC"}>b</button>',
  'fx-tilt':   '<div class="c" *tilt(15, glare: true)>carte</div>',
  'fx-ripple': '<button class="r" *ripple(#fff)>OK</button>\n<div class="m" *ripple(on: move)>carte</div>',
  'fx-bloc':   '<script>\n$ok = true\n</script>\n{if $ok}<p class="p" *neon>x</p>{end}\n<button class="t" @click={$ok = !$ok}>t</button>',
  'fx-liste':  '<script>\n$items = [1, 2, 3]\n</script>\n<ul>{for i in $items by i}<li class="l" *ripple>{i}</li>{end}</ul>\n<button class="moins" @click={$items.pop()}>-</button>',
  'fx-enfant': '<div class="in">contenu</div>',
  'fx-parent': '<@fx-enfant class="r" *ripple(#fff)></@fx-enfant>\n<@fx-enfant class="g" *glitch(0)></@fx-enfant>\n<h2 class="gt" *glitch(0)>MJS</h2>\n<img class="gi" *glitch(0) src="a.png" alt="a">',
  'fx-var':    '<script>\n$c = "#f0f"\n$max = 10\n$cible = "text"\n</script>\n<h1 class="h" *neon($c, where: $cible)>x</h1>\n<div class="t" *tilt($max)>t</div>\n<button class="b1" @click={$c = "#0f0"}>b</button>\n<button class="b2" @click={$max = 30}>b</button>\n<button class="b3" @click={$max = 99}>b</button>\n<button class="b4" @click={$cible = "boxx"}>b</button>\n<button class="b5" @click={$cible = "box"}>b</button>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

const boite    = (el: any) => { mesurer(el.ownerDocument.defaultView, el, () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })) }
const pointeur = (el: any, type: string, x = 0, y = 0) => el.dispatchEvent(new el.ownerDocument.defaultView.PointerEvent(type, { clientX: x, clientY: y, bubbles: true }))

describe('effets — exécution', function () {
  this.timeout(60000)
  let window: any
  let coeur = ''
  let fichiers: string[] = []
  const vus: any[] = []

  before(async () => {
    const root   = mjsTmp('effets-execution')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    coeur = readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8')
    fichiers = files.map((f) => f + '\n' + readFileSync(join(outDir, f), 'utf-8'))
    const code = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // un IntersectionObserver qu'on déclenche à la main
    window.eval(`globalThis.IntersectionObserver = class { constructor(cb, o) { this.cb = cb; this.o = o; globalThis.__io = this } observe(el) { this.el = el } disconnect() { this.off = true } }`)
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const el = window.document.querySelector(tag)
    await attendre(() => !!el._shadow?.firstElementChild)
    await pause()
    vus.push(el)
    return el
  }


  it('*neon : marque, réglages en variables CSS, grésillement, feuille adoptée par le shadow root', async () => {
    const comp = await monter('mjs-fx-neon')
    const t    = comp._shadow.querySelector('.t')
    assert.equal(t.getAttribute('mjs-fx'), 'neon')
    assert.equal(t.style.getPropertyValue('--mjs-neon-color'), '#f0f')
    assert.ok(t.hasAttribute('mjs-fx-neon-flicker'))
    const regles = [...comp._shadow.adoptedStyleSheets].flatMap((s: any) => [...s.cssRules].map((r: any) => r.cssText)).join('\n')
    assert.match(regles, /mjs-fx~="neon"/)
  })

  it('une seconde pose du même effet sur le même nœud ne refait rien', async () => {
    const comp = await monter('mjs-fx-neon')
    const t    = comp._shadow.querySelector('.t')
    const off  = t._mjs_fxOff.neon
    // la même poignée rendue au même composant, la pose d'origine intacte (comparées par ===, jamais
    // par assert.equal : un échec inspecterait le composant accroché à la poignée)
    const h1   = window.µ._mjs_fx(comp, t, 'neon', {})
    assert.ok(h1 === window.µ._mjs_fx(comp, t, 'neon', {}), 'même poignée')
    assert.ok(t._mjs_fxOff.neon === off, 'même pose')
    assert.equal(t.getAttribute('mjs-fx'), 'neon')
  })

  it('*glitch : les calques recopient le texte, même quand il change ; every: 0 = sans arrêt', async () => {
    const comp = await monter('mjs-fx-glitch')
    const g    = comp._shadow.querySelector('.g')
    assert.equal(g.getAttribute('mjs-fx-glitch-text'), 'MJS')
    assert.ok(g.hasAttribute('mjs-fx-glitch-burst'))
    comp._shadow.querySelector('.b').click()
    await attendre(() => g.getAttribute('mjs-fx-glitch-text') === 'ABC')
    assert.equal(g.getAttribute('mjs-fx-glitch-text'), 'ABC')
  })

  it('*tilt : le coin sous le pointeur vient vers soi (le pointeur reste sur la carte), puis tout revient en place', async () => {
    const comp = await monter('mjs-fx-tilt')
    const c    = comp._shadow.querySelector('.c')
    boite(c)
    assert.ok(c.hasAttribute('mjs-fx-tilt-glare'))
    pointeur(c, 'pointerenter')
    pointeur(c, 'pointermove', 100, 0)
    assert.ok(c.hasAttribute('mjs-fx-tilt-active'))
    // coin haut droit : rotateX négatif (le haut avance), rotateY négatif (la droite avance)
    assert.equal(c.style.getPropertyValue('--mjs-fx-tilt-rx'), '-15.00deg')
    assert.equal(c.style.getPropertyValue('--mjs-fx-tilt-ry'), '-15.00deg')
    pointeur(c, 'pointermove', 0, 100)
    assert.equal(c.style.getPropertyValue('--mjs-fx-tilt-rx'), '15.00deg', 'coin bas gauche : le bas avance')
    assert.equal(c.style.getPropertyValue('--mjs-fx-tilt-ry'), '15.00deg', 'coin bas gauche : la gauche avance')
    pointeur(c, 'pointerleave')
    assert.ok(!c.hasAttribute('mjs-fx-tilt-active'))
    assert.equal(c.style.getPropertyValue('--mjs-fx-tilt-rx'), '')
  })

  it('*ripple : une onde naît au point touché, dans un calque, et disparaît à la fin de son animation', async () => {
    const comp = await monter('mjs-fx-ripple')
    const r    = comp._shadow.querySelector('.r')
    boite(r)
    pointeur(r, 'pointerdown', 10, 10)
    const goutte = r.querySelector('[mjs-fx-layer="ripple"] [mjs-fx-drop]')
    assert.ok(goutte, 'une onde')
    assert.equal(r.style.getPropertyValue('--mjs-ripple-color'), '#fff')
    goutte.dispatchEvent(new window.Event('animationend'))
    assertAbsent(r.querySelector('[mjs-fx-drop]'), 'l\'onde est retirée')
  })

  it('*ripple(on: move) : une onde douce à chaque mouvement du pointeur, au plus une par image', async () => {
    const comp = await monter('mjs-fx-ripple')
    const m    = comp._shadow.querySelector('.m')
    boite(m)
    pointeur(m, 'pointermove', 10, 10)
    await new Promise((r) => setTimeout(r, 40))
    pointeur(m, 'pointermove', 30, 20)
    await new Promise((r) => setTimeout(r, 40))
    const gouttes = m.querySelectorAll('[mjs-fx-layer="ripple"] [mjs-fx-drop]')
    assert.equal(gouttes.length, 2)
    assert.ok(gouttes[0].hasAttribute('mjs-fx-soft'), 'onde douce')
    pointeur(m, 'pointerdown', 5, 5)
    assert.equal(m.querySelectorAll('[mjs-fx-drop]').length, 2, 'le clic ne lance rien en mode move')
  })

  it('{if} refermé : l\'effet du nœud retiré est défait', async () => {
    const comp = await monter('mjs-fx-bloc')
    const p    = comp._shadow.querySelector('.p')
    assert.ok(p._mjs_fxOff)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.p'))
    await pause(50)
    assert.equal(p._mjs_fxOff, null)
    assert.equal(p.getAttribute('mjs-fx'), null)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !!comp._shadow.querySelector('.p'))
    assert.equal(comp._shadow.querySelector('.p').getAttribute('mjs-fx'), 'neon', 'le nœud recréé retrouve son effet')
  })

  it('{for} : la ligne retirée perd son effet et son calque', async () => {
    const comp  = await monter('mjs-fx-liste')
    const lignes = [...comp._shadow.querySelectorAll('.l')]
    assert.equal(lignes.length, 3)
    const derniere = lignes[2]
    boite(derniere)
    pointeur(derniere, 'pointerdown', 5, 5)
    assert.ok(derniere.querySelector('[mjs-fx-layer]'))
    comp._shadow.querySelector('.moins').click()
    await attendre(() => comp._shadow.querySelectorAll('.l').length === 2)
    await pause(50)
    assert.equal(derniere._mjs_fxOff, null)
    assertAbsent(derniere.querySelector('[mjs-fx-layer]'), 'le calque est retiré')
  })

  it('composant détruit : ses effets sont défaits', async () => {
    const comp = await monter('mjs-fx-glitch')
    const g    = comp._shadow.querySelector('.g')
    assert.ok(g._mjs_fxOff)
    window.document.body.innerHTML = ''
    await attendre(() => g._mjs_fxOff === null, 2000)
    assert.equal(g._mjs_fxOff, null)
    assert.equal(g.getAttribute('mjs-fx-glitch-burst'), null, 'la salve s\'arrête')
  })

  it('une variable comme valeur : lue à la pose, suivie sur place pour une couleur (l\'effet ne repart pas)', async () => {
    const comp = await monter('mjs-fx-var')
    const h    = comp._shadow.querySelector('.h')
    assert.equal(h.style.getPropertyValue('--mjs-neon-color'), '#f0f')
    const off = h._mjs_fxOff.neon
    comp._shadow.querySelector('.b1').click()
    await attendre(() => h.style.getPropertyValue('--mjs-neon-color') === '#0f0')
    assert.equal(h.style.getPropertyValue('--mjs-neon-color'), '#0f0')
    assert.equal(h._mjs_fxOff.neon, off, 'même pose : rien ne repart de zéro')
  })

  it('une variable de comportement relance l\'effet ; hors plage, elle est ramenée avec un message en développement', async () => {
    const comp = await monter('mjs-fx-var')
    const t    = comp._shadow.querySelector('.t')
    const coin = () => { boite(t); pointeur(t, 'pointerenter'); pointeur(t, 'pointermove', 100, 0); return t.style.getPropertyValue('--mjs-fx-tilt-rx') }
    assert.equal(coin(), '-10.00deg')
    comp._shadow.querySelector('.b2').click()
    await attendre(() => t._mjs_fxOff?.tilt?._s?.max === 30)
    assert.equal(coin(), '-30.00deg')
    const vus: string[] = []
    const avant = window.µ.warn
    const mode  = window.µ._typesMode
    window.µ._typesMode = 'warn'
    window.µ.warn = (m: string) => vus.push(m)
    try {
      comp._shadow.querySelector('.b3').click()
      await attendre(() => t._mjs_fxOff?.tilt?._s?.max === 45)
    }
    finally {
      window.µ.warn     = avant
      window.µ._typesMode = mode
    }
    assert.equal(coin(), '-45.00deg')
    assert.ok(vus.some(m => /\*tilt : max = 99 ramené à 45 — permis : float 0\.\.45/.test(m)), vus.join(' | '))
  })

  it('une valeur écartée par sa règle rend la valeur par défaut ; la bonne valeur revient ensuite', async () => {
    const comp = await monter('mjs-fx-var')
    const h    = comp._shadow.querySelector('.h')
    comp._shadow.querySelector('.b5').click()
    await attendre(() => h.getAttribute('mjs-fx-neon-where') === 'box')
    assert.equal(h.getAttribute('mjs-fx-neon-where'), 'box')
    comp._shadow.querySelector('.b4').click()
    await attendre(() => !h.hasAttribute('mjs-fx-neon-where'))
    assert.equal(h.getAttribute('mjs-fx-neon-where'), null, "'boxx' écarté : le texte, par défaut")
    assert.equal(h.getAttribute('mjs-fx'), 'neon')
  })

  it('*ripple sur un composant : l\'onde naît DANS le composant (son shadow root), qui reçoit la feuille de l\'effet', async () => {
    const comp  = await monter('mjs-fx-parent')
    const hote  = comp._shadow.querySelector('.r')
    await attendre(() => !!hote._shadow?.querySelector('.in'))
    boite(hote)
    pointeur(hote, 'pointerdown', 10, 10)
    const calque = hote._shadow.querySelector('[mjs-fx-layer="ripple"]')
    assert.ok(calque, 'le calque est dans le composant')
    assert.ok(calque.querySelector('[mjs-fx-drop]'), 'une onde')
    assertAbsent(hote.querySelector('[mjs-fx-layer]'), 'rien dans le contenu passé au composant')
    const regles = [...hote._shadow.adoptedStyleSheets].flatMap((x: any) => [...x.cssRules].map((r: any) => r.cssText)).join(' ')
    assert.match(regles, /mjs-fx-layer="ripple"/)
  })

  it('*glitch : un texte → deux calques qui recopient le texte ; un composant ou une image → la balise elle-même est secouée', async () => {
    const comp = await monter('mjs-fx-parent')
    const gt   = comp._shadow.querySelector('.gt')
    assert.equal(gt.getAttribute('mjs-fx-glitch-text'), 'MJS')
    assert.equal(gt.getAttribute('mjs-fx-glitch-mode'), null)
    for (const sel of ['.g', '.gi']) {
      const el = comp._shadow.querySelector(sel)
      assert.equal(el.getAttribute('mjs-fx-glitch-mode'), 'box', sel)
      assert.equal(el.getAttribute('mjs-fx-glitch-text'), null, sel)
      assert.ok(el.hasAttribute('mjs-fx-glitch-burst'), sel)
    }
  })

  it('chaque effet écrit dans les gabarits a son fichier ; le cœur n\'en garde aucun', () => {
    for (const nom of ['neon', 'glitch', 'tilt', 'ripple']) {
      assert.doesNotMatch(coeur, new RegExp(`_mjs_fxDefs\\.${nom}\\s*=`), nom)
      assert.ok(fichiers.some((f) => f.startsWith(`mjs_fx_${nom}-`) && new RegExp(`_mjs_fxDefs\\.${nom}\\s*=`).test(f)), nom)
    }
    assert.doesNotMatch(coeur, /_mjs_fxAnimOpts/, 'aucune transition écrite : pas de pont des transitions')
  })
})

describe('effets — « réduire les animations » du système', function () {
  this.timeout(60000)
  let window: any
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('plus aucun mouvement : ni grésillement, ni salve animée, ni inclinaison, ni onde, et une apparition laisse l\'élément à sa place', async () => {
    const root   = mjsTmp('effets-reduit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-calme.mjs'), [
      '<h1 class="n" *neon(flicker: true)>n</h1>',
      '<h2 class="g" *glitch(0)>g</h2>',
      '<img class="gb" *glitch(0) src="a.png" alt="a">',
      '<div class="t" *tilt>t</div>',
      '<p class="l" *fly(left, on: view)>l</p>',
      '<p class="u" *fly(up, on: view)>u</p>',
      '<p class="z" *scale(.5, on: view)>z</p>',
      '<p class="b" *blur(12, on: view)>b</p>',
      '<button class="r" *ripple>r</button>',
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/', settings: { device: { prefersReducedMotion: 'reduce' } } })
    window.eval(`globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} }`)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-fx-calme></mjs-fx-calme>'
    const comp = window.document.querySelector('mjs-fx-calme')
    await attendre(() => !!comp._shadow?.querySelector('.b'))
    await pause()
    const cs = (sel: string) => window.getComputedStyle(comp._shadow.querySelector(sel))
    assert.ok(!/mjs-fx-neon-flicker/.test(cs('.n').animation || ''), 'le néon ne grésille plus')
    assert.ok(!/mjs-fx-glitch/.test(cs('.g').animation || ''), 'la salve ne tremble plus')
    assert.ok(!/mjs-fx-glitch/.test(cs('.gb').animation || ''), 'la balise secouée ne tremble plus')
    assert.ok(['', 'none'].includes(cs('.t').transform), `le tilt ne s'incline plus : ${cs('.t').transform}`)
    const r = comp._shadow.querySelector('.r')
    boite(r)
    pointeur(r, 'pointerdown', 5, 5)
    // aucune goutte : cachée sans s'animer, elle ne serait jamais retirée (son retrait attend la fin de
    // son animation)
    assertAbsent(r.querySelector('[mjs-fx-drop]'), 'l\'onde ne part plus')
    for (const sel of ['.l', '.u', '.z', '.b']) {
      const st = cs(sel)
      assert.ok(comp._shadow.querySelector(sel).hasAttribute('mjs-fx'), sel + ' : l\'effet est posé')
      assert.ok(['', '1'].includes(st.opacity), sel + ' visible')
      assert.ok(['', 'none'].includes(st.transform), `${sel} à sa place : ${st.transform}`)
      assert.ok(['', 'none'].includes(st.filter), `${sel} net : ${st.filter}`)
    }
  })
})

describe('effets — tri au build et production', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un projet qui n\'écrit que *neon : son seul fichier d\'effet, ni le glitch ni les autres', async () => {
    const root   = mjsTmp('effets-tri')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'seul.mjs'), '<p *neon>x</p>')
    writeFileSync(join(srcDir, 'rien.mjs'), '<p>rien</p>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const coeur = readFileSync(join(outDir, readdirSync(outDir).find((f) => /^mjs_core-.*\.js$/.test(f))!), 'utf-8')
    assert.deepEqual(readdirSync(outDir).filter((f) => /^mjs_fx_.*\.js$/.test(f)).map((f) => f.replace(/-[0-9a-z]{5}\.js$/, '')), ['mjs_fx_neon'])
    for (const nom of ['neon', 'glitch', 'tilt', 'ripple']) assert.doesNotMatch(coeur, new RegExp(`_mjs_fxDefs\\.${nom}\\s*=`), nom)
    assert.doesNotMatch(coeur, /_mjs_fxAnimOpts/, 'ni le pont des transitions')
  })

  it('un projet sans effet n\'embarque pas le moteur', async () => {
    const root   = mjsTmp('effets-aucun')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'rien.mjs'), '<p>rien</p>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0)
    await bundler.close()
    const coeur = readFileSync(join(outDir, readdirSync(outDir).find((f) => /^mjs_core-.*\.js$/.test(f))!), 'utf-8')
    // le panneau d'inspection (cœur de développement) lit le registre s'il existe : seule sa
    // DÉFINITION dit que le moteur est là
    assert.doesNotMatch(coeur, /µ\._mjs_fxDefs\s*=/)
    assert.doesNotMatch(coeur, /_mjs_fxCatalog\s*=/, 'ni les réglages des effets du panneau')
  })

  it('production (fichier unique, noms internes raccourcis) : l\'effet se pose', async () => {
    const root   = mjsTmp('effets-prod')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-neon.mjs'), COMPOSANTS['fx-neon'])
    writeFileSync(join(srcDir, 'fx-var.mjs'), COMPOSANTS['fx-var'])
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', js: 'bundle' })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const code = readFileSync(join(root, 'bundle.js'), 'utf-8')
      .replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+(?:µ|\\u00B5)\s*\};?/, 'globalThis.µ = $1;')
      .replace(/import\.meta\.url/g, "'http://localhost/'")
    assert.ok(!/_mjs_fx\b|_mjs_fxDefs/.test(code), 'noms internes raccourcis')
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(code)
      window.document.body.innerHTML = '<mjs-fx-neon></mjs-fx-neon>'
      const el: any = window.document.body.querySelector('mjs-fx-neon')
      const racine  = () => el.shadowRoot ?? el._shadow
      await attendre(() => !!racine()?.querySelector('.t'))
      const t = racine().querySelector('.t')
      assert.equal(t.getAttribute('mjs-fx'), 'neon')
      assert.equal(t.style.getPropertyValue('--mjs-neon-color'), '#f0f')
      // une variable suivie, noms internes raccourcis compris
      window.document.body.innerHTML = '<mjs-fx-var></mjs-fx-var>'
      const v: any    = window.document.body.querySelector('mjs-fx-var')
      const rv        = () => v.shadowRoot ?? v._shadow
      await attendre(() => !!rv()?.querySelector('.h'))
      const h = rv().querySelector('.h')
      assert.equal(h.style.getPropertyValue('--mjs-neon-color'), '#f0f')
      rv().querySelector('.b1').click()
      await attendre(() => h.style.getPropertyValue('--mjs-neon-color') === '#0f0')
      assert.equal(h.style.getPropertyValue('--mjs-neon-color'), '#0f0')
    } finally {
      window.close?.()
    }
  })
})
