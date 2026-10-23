// *behind — le texte passe derrière le sujet d'une photo : le calque du sujet posé et retiré, la taille et la place du fond
// reprises ou écrites, le relief (une copie du fond qui bouge à l'opposé et ne répète pas un fond en cover), le bord que le relief découvre
// (`edge` : le zoom commun du fond et du sujet, relu quand la balise change de taille ; le calque du flou ou de la couleur, sous la copie),
// « réduire les animations », les refus de compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { compter, garde, avecBoite, avecTaille, observateurs, rendreTout } from './helpers/happy-dom-espions.js'

const COMPOSANTS: Record<string, string> = {
  'fx-behind-base':    '<header class="a" *behind(\'/sujet.png\')><h1>T</h1></header>',
  'fx-behind-regles':  '<header class="a" *behind(\'/sujet.png\', size: contain, position: top-left, depth: 14)><h1>T</h1></header>',
  'fx-behind-vide':    '<header class="a" *behind><h1>T</h1></header>',
  'fx-behind-enfant':  '<p class="c">dedans</p>',
  'fx-behind-compo':   '<@fx-behind-enfant class="a" *behind(\'/sujet.png\')></@fx-behind-enfant>',
  'fx-behind-variable': '<script>\n$d = 0\n$t = \'cover\'\n$i = \'a.png\'\n</script>\n<header class="a" *behind($i, depth: $d, size: $t)><h1>T</h1></header>\n<button class="d" @click={$d = 20}>d</button>\n<button class="z" @click={$d = 0}>z</button>\n<button class="s" @click={$t = \'contain\'}>s</button>\n<button class="i" @click={$i = \'b.png\'}>i</button>',
  'fx-behind-retrait': '<script>\n$on = true\n</script>\n{if $on}<header class="a" *behind(\'/sujet.png\', depth: 10)><h1>T</h1></header>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-behind-bord':    '<header class="a" *behind(\'/sujet.png\', depth: 14)><h1>T</h1></header>',
  'fx-behind-flou':    '<header class="a" *behind(\'/sujet.png\', depth: 14, edge: blur)><h1>T</h1></header>',
  'fx-behind-sans-depth': '<header class="a" *behind(\'/sujet.png\', edge: blur)><h1>T</h1></header>',
  'fx-behind-bord-variable': '<script>\n$e = \'zoom\'\n</script>\n<header class="a" *behind(\'/sujet.png\', depth: 14, edge: $e)><h1>T</h1></header>\n<button class="f" @click={$e = \'blur\'}>f</button>\n<button class="c" @click={$e = \'#101014\'}>c</button>\n<button class="z" @click={$e = \'zoom\'}>z</button>',
  'fx-behind-bord-noir': '<header class="a" *behind(\'/sujet.png\', depth: 14, edge: black)><h1>T</h1></header>',
  'fx-behind-bord-faute': '<header class="a" *behind(\'/sujet.png\', depth: 14, edge: zooom)><h1>T</h1></header>',
  'fx-behind-bord-nom': '<script>\n$e = \'black\'\n</script>\n<header class="a" *behind(\'/sujet.png\', depth: 14, edge: $e)><h1>T</h1></header>\n<button class="n" @click={$e = \'black\'}>n</button>\n<button class="x" @click={$e = \'zooom\'}>x</button>\n<button class="f" @click={$e = \'blur\'}>f</button>',
  'fx-behind-bord-casse': '<script>\n$e = \' Blur \'\n</script>\n<header class="a" *behind(\'/sujet.png\', depth: 14, edge: $e)><h1>T</h1></header>',
  'fx-behind-retrait-flou': '<script>\n$on = true\n</script>\n{if $on}<header class="a" *behind(\'/sujet.png\', depth: 10, edge: blur)><h1>T</h1></header>{end}\n<button class="t" @click={$on = !$on}>t</button>'
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *behind', function () {
  this.timeout(60000)
  let window: any
  let code = ''

  before(async () => {
    const root   = mjsTmp('effets-behind')
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

  // le navigateur joué : happy-dom répond oui à tout (CSS.supports), un vrai navigateur connaît les noms, #hex et les fonctions de couleur,
  // et refuse le reste (zooom, blakc) ; la méthode se remplace sur le prototype de `CSS` (qui rend un objet neuf à chaque lecture), puis est rendue
  const rendus: Array<() => void> = []
  afterEach(() => { for (const f of rendus.splice(0)) f() })
  function jugeCouleurs(w: any) {
    const proto    = Object.getPrototypeOf(w.CSS)
    const ancien   = Object.getOwnPropertyDescriptor(proto, 'supports')
    proto.supports = (prop: string, val: string) => prop === 'color' && /^(?:black|gold|#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(.+\)|var\(.+\))$/i.test(String(val))
    rendus.push(() => { if (ancien) Object.defineProperty(proto, 'supports', ancien); else delete proto.supports })
  }

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

  const sujet = (el: any) => el.querySelector('[mjs-fx-layer="behind"]')
  const fond  = (el: any) => el.querySelector('[mjs-fx-layer="behind-bg"]')
  const image = (l: any) => l.style.backgroundImage

  it('le calque du sujet : dernier enfant de la balise, inerte, caché des lecteurs d\'écran, avec l\'image écrite', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-base')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    assert.ok(l, 'le calque')
    assert.equal(l.getAttribute('aria-hidden'), 'true')
    assert.ok(el.lastChild === l, 'dernier enfant : par-dessus le contenu')
    assert.match(image(l), /^url\("\/sujet\.png"\)$/)
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-image'), '', 'l\'image est écrite en littéral sur le calque, aucune variable ne la porte')
    assert.ok((el.getAttribute('mjs-fx') ?? '').split(' ').includes('behind'))
    assertAbsent(fond(el), 'sans relief, pas de copie du fond')
    assert.ok(!el.hasAttribute('mjs-fx-behind-relief'))
    // une balise sans fond en url(…) : le sujet est cadré `cover`, au centre
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-size'), 'cover')
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-pos'), '50% 50%')
    // avec un fond en url(…) (le premier de la liste, après un dégradé) : la taille et la place du fond sont héritées
    el.style.backgroundImage = 'linear-gradient(red, blue), url("fond.png")'
    await attendre(() => !l.hasAttribute('mjs-fx-behind-size'))
    assert.ok(!l.hasAttribute('mjs-fx-behind-size') && !l.hasAttribute('mjs-fx-behind-pos'), 'taille et place : celles du fond de la balise (héritées)')
    assert.match(image(l), /^none,\s*url\("\/sujet\.png"\)$/, 'le sujet prend, dans la liste des fonds, la place de la photo (après le dégradé) ; le style en ligne relit la liste avec une espace après la virgule')
  })

  it('le CSS : ni clic, ni lecteur d\'écran, ni isolation ni z-index géant, taille et place héritées, relief seulement avec la marque', async () => {
    fenetre()
    const css = window.µ._mjs_fxDefs.behind.css
    assert.doesNotMatch(css, /\[mjs-fx~="behind"\]\{/, 'aucune règle sur la balise seule : elle n\'est pas un contexte d\'empilement (un menu qui déborde n\'est pas enfermé)')
    assert.doesNotMatch(css, /2147483647/, 'pas de z-index géant : un enfant à z-index positif reste devant le sujet')
    assert.doesNotMatch(css, /\[mjs-fx-layer="behind"\]\{[^}]*z-index/, 'le sujet est à z-index auto, dernier enfant positionné')
    assert.match(css, /\[mjs-fx-layer="behind"\],\[mjs-fx-layer="behind-bg"\]\{position:absolute;pointer-events:none\}/)
    assert.match(css, /\[mjs-fx-layer="behind"\]\{inset:0;[^}]*background-size:inherit;background-position:inherit/)
    assert.doesNotMatch(css, /\[mjs-fx-layer="behind"\]\{[^}]*background-image/, 'l\'image du sujet n\'est pas dans la feuille : écrite en littéral sur le calque, jamais derrière une variable que le relief réécrit (elle serait redonnée neuve à chaque image)')
    assert.match(css, /\[mjs-fx-layer="behind"\]\{[^}]*border-radius:inherit/, 'les coins de la balise arrondie rognent aussi le sujet')
    assert.match(css, /\[mjs-fx-layer="behind"\]\{[^}]*padding:inherit;[^}]*background-origin:inherit;background-clip:inherit\}/, 'l\'origine et le rognage du fond (et le padding qui donne sa boîte de contenu au calque) sont ceux de la balise')
    assert.match(css, /\[mjs-fx-layer="behind"\]\{[^}]*background-repeat:no-repeat/, 'posé une fois par défaut')
    assert.match(css, /\[mjs-fx-layer="behind"\]:not\(\[mjs-fx-behind-size\]\):not\(\[mjs-fx-behind-pos\]\)\{background-repeat:inherit\}/, 'la répétition du fond, tant que la taille et la place sont celles du fond')
    assert.match(css, /\[mjs-fx~="behind"\]\[mjs-fx-behind-relief\]\{overflow:clip;isolation:isolate\}/, 'avec le relief seulement : la copie du fond passe sous le contenu et au-dessus du fond de la balise')
    assert.match(css, /\[mjs-fx-layer="behind-bg"\]\{inset:calc\(var\(--mjs-behind-depth,0px\) \* -1\);z-index:-1;/)
    assert.match(css, /\[mjs-fx-layer="behind-bg"\]\{[^}]*;padding:var\(--mjs-behind-depth,0px\);background-origin:content-box;/, 'la copie du fond déborde de depth px mais place son fond sur la boîte de la balise (padding de depth px, origine à la boîte de contenu) : au repos il tombe là où tombe celui de la balise')
    assert.match(css, /\[mjs-fx-layer="behind-bg"\]\[mjs-fx-behind-repeat\]\{background-repeat:var\(--mjs-fx-behind-repeat\)\}/, 'la répétition de la copie du fond est écrite, couche par couche, quand une couche est en cover')
    assert.match(css, /\[mjs-fx-layer="behind"\]\[mjs-fx-relief\]\{transform:translate3d\([^}]*\) scale\(var\(--mjs-fx-behind-zoom,1\)\)\}/, 'le sujet : le décalage, puis le zoom (nul : 1)')
    assert.match(css, /\[mjs-fx-layer="behind-bg"\]\[mjs-fx-relief\]\{transform:translate3d\([^}]*\) scale\(var\(--mjs-fx-behind-zoom,1\)\)\}/, 'la copie du fond : le décalage, puis le même zoom')
    assert.match(css, /\[mjs-fx-layer="behind-edge"\]\{position:absolute;pointer-events:none;z-index:-2;inset:0;opacity:clamp\(0,calc\(max\(/, 'le calque du bord : sous la copie du fond (z-index -2), invisible tant qu\'elle n\'a pas glissé')
    assert.match(css, /\[mjs-fx-layer="behind-edge"\]\[mjs-fx-behind-edge="blur"\]\{[^}]*background-image:inherit;background-size:cover;[^}]*background-repeat:no-repeat;filter:blur\(/, 'le flou : la même photo, en cover, sans répétition')
    assert.match(css, /\[mjs-fx-layer="behind-edge"\]\[mjs-fx-behind-edge="color"\]\{background-color:var\(--mjs-fx-behind-edge\)\}/, 'la couleur unie')
    assert.match(css, /\[mjs-fx-layer="behind-bg"\]\[mjs-fx-relief\]\{transform:translate3d\(calc\(var\(--mjs-fx-behind-x,0\) \* var\(--mjs-behind-depth,0px\) \* -1\)/, 'le fond va à l\'opposé')
    assert.match(css, /\[mjs-fx-moving\]\{will-change:transform\}/)
    assert.match(css, /\[mjs-fx-layer="behind-edge"\]\[mjs-fx-moving\]\{will-change:opacity\}/, 'le calque du bord est composé pendant le mouvement : son opacité suit le décalage sans repeindre son flou')
    assert.doesNotMatch(css, /animation:|transition:/, 'rien ne bouge tout seul')
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transform:none/)
  })

  it('*behind(\'/sujet.png\', size: contain, position: top-left, depth: 14) : taille et place écrites, copie du fond, relief armé', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-regles')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-size'), 'contain')
    assert.ok(l.hasAttribute('mjs-fx-behind-size'))
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-pos'), '0% 0%')
    assert.ok(l.hasAttribute('mjs-fx-behind-pos'))
    assert.equal(el.style.getPropertyValue('--mjs-behind-depth'), '14px')
    const b = fond(el)
    assert.ok(b, 'la copie du fond')
    assert.ok(el.firstChild === b, 'premier enfant : sous le contenu')
    assert.equal(b.getAttribute('aria-hidden'), 'true')
    assert.ok(el.hasAttribute('mjs-fx-behind-relief'), 'la balise rogne ce qui déborde')
    assert.ok(l.hasAttribute('mjs-fx-relief') && b.hasAttribute('mjs-fx-relief'))
  })

  it('sans image : aucun sujet (`none`), rien ne plante', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-vide')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(image(sujet(el)), 'none')
  })

  it('sur un composant : le calque est dans le shadow root du composant, qui reçoit la feuille', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-compo')
    const hote = comp._shadow.querySelector('.a')
    const l    = sujet(hote._shadow)
    assert.ok(l, 'calque dans le composant')
    assert.match(image(l), /sujet\.png/)
    assert.ok(hote._shadow.adoptedStyleSheets.length > 0, 'la feuille de l\'effet est adoptée dans le composant')
  })

  it('les réglages tenus par une variable suivent sur place : relief allumé, éteint, taille, image', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-variable')
    const el   = comp._shadow.querySelector('.a')
    const off  = el._mjs_fxOff.behind
    const l    = sujet(el)
    assertAbsent(fond(el), 'depth: 0 — pas de copie')
    comp._shadow.querySelector('.d').click()
    await attendre(() => !!fond(el))
    assert.ok(fond(el), 'depth: 20 — le relief s\'allume')
    assert.equal(el.style.getPropertyValue('--mjs-behind-depth'), '20px')
    assert.ok(el.hasAttribute('mjs-fx-behind-relief'))
    comp._shadow.querySelector('.z').click()
    await attendre(() => !fond(el))
    assertAbsent(fond(el), 'depth: 0 — le relief s\'éteint')
    assert.ok(!el.hasAttribute('mjs-fx-behind-relief'))
    assert.ok(!l.hasAttribute('mjs-fx-relief'))
    comp._shadow.querySelector('.s').click()
    await attendre(() => l.style.getPropertyValue('--mjs-fx-behind-size') === 'contain')
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-size'), 'contain')
    comp._shadow.querySelector('.i').click()
    await attendre(() => /b\.png/.test(image(l)))
    assert.match(image(l), /^url\("b\.png"\)$/)
    assert.ok(el._mjs_fxOff.behind === off, 'le même effet : rien n\'a été reposé')
    assert.ok(sujet(el) === l, 'le même calque')
  })

  it('off.set : depth, image, size, position suivis sur place ; un autre réglage rend false', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-base')
    const el   = comp._shadow.querySelector('.a')
    const hot  = el._mjs_fxOff.behind._hot
    const l    = sujet(el)
    // le fond de la balise a une image : taille et place sont héritées tant qu'elles ne sont pas écrites
    el.style.backgroundImage = 'url("fond.png")'
    await attendre(() => !l.hasAttribute('mjs-fx-behind-pos'))
    assert.equal(hot('depth', 30), undefined)
    assert.ok(fond(el))
    assert.equal(hot('depth', undefined), undefined)
    assertAbsent(fond(el), 'depth retiré : le relief s\'éteint')
    hot('position', '20% 80%')
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-pos'), '20% 80%')
    hot('position', undefined)
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-pos'), '')
    assert.ok(!l.hasAttribute('mjs-fx-behind-pos'))
    hot('size', 'auto')
    assert.equal(l.style.getPropertyValue('--mjs-fx-behind-size'), 'auto')
    hot('image', 'autre.png')
    assert.match(image(l), /^url\("autre\.png"\)$/)
    assert.equal(hot('couleur', 1), false)
  })

  it('depth : la copie du fond ne se répète pas là où le fond est en cover (couche par couche) ; relu quand size ou le style du fond changent', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-base')
    const el   = comp._shadow.querySelector('.a')
    const hot  = el._mjs_fxOff.behind._hot
    const rep  = () => fond(el).style.getPropertyValue('--mjs-fx-behind-repeat')
    el.style.backgroundImage = 'url("fond.png")'
    el.style.backgroundSize  = 'cover'
    await pause(50)
    hot('depth', 30)
    assert.equal(rep(), 'no-repeat', 'un fond en cover : la copie ne se répète pas')
    assert.ok(fond(el).hasAttribute('mjs-fx-behind-repeat'))
    // le fond devient un motif (style en ligne) : relu, la copie reprend la répétition de la balise
    el.style.backgroundSize = '60px 40px'
    await attendre(() => rep() === '')
    assert.equal(rep(), '', 'un motif en tuiles : la répétition de la balise')
    assert.ok(!fond(el).hasAttribute('mjs-fx-behind-repeat'))
    // `size: cover` écrit sur l'effet : la couche de la photo ne se répète pas, même si le fond de la balise est un motif ; non écrit, la copie reprend la répétition
    hot('size', 'cover')
    assert.equal(rep(), 'no-repeat', 'size: cover écrit sur l\'effet')
    hot('size', undefined)
    assert.equal(rep(), '', 'size retiré')
    // deux fonds : le dégradé (taille auto) garde sa répétition, la photo en cover ne se répète pas
    el.style.backgroundImage  = 'linear-gradient(red, blue), url("fond.png")'
    el.style.backgroundSize   = 'auto, cover'
    el.style.backgroundRepeat = 'repeat, repeat'
    await attendre(() => rep() !== '')
    assert.equal(rep(), 'repeat, no-repeat', 'deux fonds : couche par couche')
    // le relief s'éteint : la copie s'en va avec sa marque
    hot('depth', undefined)
    assertAbsent(fond(el), 'depth retiré : plus de copie')
  })

  it('« réduire les animations » : le sujet reste, mais le relief ne s\'arme pas', async () => {
    fenetre((w) => { w.matchMedia = (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {} }) })
    const comp = await monter('mjs-fx-behind-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(sujet(el), 'le sujet est posé')
    assertAbsent(fond(el), 'pas de copie du fond')
    assert.ok(!el.hasAttribute('mjs-fx-behind-relief'))
    const hot = el._mjs_fxOff.behind._hot
    hot('depth', 20)
    assertAbsent(fond(el), 'une variable de depth ne l\'arme pas non plus')
  })

  it('le retrait ({if} refermé) : les deux calques s\'en vont, ni marque, ni variable, la position est rendue', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-retrait')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    const b    = fond(el)
    assert.ok(l && b)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.ok(l.parentNode === null && b.parentNode === null, 'les calques sont retirés')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''), 'variable restée')
    assert.equal(el.style.position, '')
    assert.equal(el._mjs_fxOff ?? null, null)
  })

  // la balise a une boîte (avecBoite) : la souris peut la viser, le relief part
  const souris = (type: string) => new window.PointerEvent(type, { clientX: 150, clientY: 50, pointerType: 'mouse', bubbles: true })
  const retirer = async (comp: any) => {
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
  }

  it('le retrait débranche l\'écoute de la souris du relief (pointermove, pointerleave) : plus rien ne part quand elle bouge sur la balise retirée', async () => {
    fenetre((w) => { espion = compter(w); avecBoite(w) })
    const comp = await monter('mjs-fx-behind-retrait')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    assert.equal(espion.vivants('pointermove', el), 1, 'le relief écoute la souris sur la balise')
    assert.equal(espion.vivants('pointerleave', el), 1)
    await retirer(comp)
    assert.equal(espion.vivants('pointermove', el), 0, 'pointermove retiré avec l\'effet')
    assert.equal(espion.vivants('pointerleave', el), 0, 'pointerleave retiré avec l\'effet')
    el.dispatchEvent(souris('pointermove'))
    assert.ok(!l.hasAttribute('mjs-fx-moving'), 'la souris sur la balise retirée ne lance plus rien')
    assert.equal(espion.vivants('scroll', window), 0)
  })

  it('le défilement de la fenêtre n\'est suivi que tant que la souris est sur la balise ; le retrait le débranche aussi', async () => {
    fenetre((w) => { espion = compter(w); avecBoite(w) })
    const comp = await monter('mjs-fx-behind-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(espion.vivants('scroll', window), 0, 'au repos : aucun écouteur de défilement')
    el.dispatchEvent(souris('pointermove'))
    assert.equal(espion.vivants('scroll', window), 1, 'la souris est sur la balise : sa boîte se périme au défilement')
    el.dispatchEvent(souris('pointerleave'))
    assert.equal(espion.vivants('scroll', window), 0, 'la souris sort : le défilement n\'est plus suivi')
    el.dispatchEvent(souris('pointermove'))
    assert.equal(espion.vivants('scroll', window), 1)
    await retirer(comp)
    assert.equal(espion.vivants('scroll', window), 0, 'retiré avec l\'effet, même la souris dessus')
  })

  it('le retrait débranche l\'observateur du fond : après lui, un fond qui change n\'écrit plus rien dans le sujet retiré', async () => {
    fenetre()
    const comp = await monter('mjs-fx-behind-retrait')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    assert.match(image(l), /^url\("\/sujet\.png"\)$/)
    // l'effet est défait (comme le fait le moteur), la balise reste dans la page : son style se calcule encore
    el._mjs_fxOff.behind()
    assert.ok(l.parentNode === null, 'le sujet est retiré')
    el.style.backgroundImage = 'linear-gradient(red, blue), url("fond.png")'
    await pause(50)
    assert.match(image(l), /^url\("\/sujet\.png"\)$/, 'le fond change après le retrait : le sujet n\'est pas réécrit')
  })

  const zoomDe = (n: any) => n.style.getPropertyValue('--mjs-fx-behind-zoom')
  const bordDe = (el: any) => el.querySelector('[mjs-fx-layer="behind-edge"]')

  it('edge: zoom (le défaut) — 1 + 2 × depth / le petit côté de la balise, écrit sur le sujet et sur la copie ; relu quand la balise change de taille et quand depth change', async () => {
    let taille: any
    let obs: any
    fenetre((w) => { taille = avecTaille(w, 960, 285); obs = observateurs(w) })
    const comp = await monter('mjs-fx-behind-bord')
    const el   = comp._shadow.querySelector('.a')
    const hot  = el._mjs_fxOff.behind._hot
    const l    = sujet(el)
    const b    = fond(el)
    assert.equal(obs.vivants(el), 1, 'la taille de la balise est observée')
    obs.declencher()
    assert.equal(zoomDe(l), '1.0982', '960 × 285, depth: 14 : 1 + 28 / 285')
    assert.equal(zoomDe(b), '1.0982', 'la copie du fond prend le même zoom que le sujet')
    assertAbsent(bordDe(el), 'le zoom n\'a pas de calque du bord')
    taille.largeur = 1200
    taille.hauteur = 600
    obs.declencher()
    assert.equal(zoomDe(l), '1.0467', '1200 × 600 : 1 + 28 / 600 — relu quand la balise change de taille')
    assert.equal(zoomDe(b), '1.0467')
    hot('depth', 20)
    assert.equal(zoomDe(l), '1.0667', 'depth: 20 : 1 + 40 / 600 — relu quand depth change')
    taille.largeur = 0
    taille.hauteur = 0
    obs.declencher()
    assert.equal(zoomDe(l), '', 'une balise sans taille (cachée) : pas de zoom')
    taille.largeur = 1200
    taille.hauteur = 600
    obs.declencher()
    assert.equal(zoomDe(l), '1.0667', 'la taille revient : le zoom revient')
    hot('depth', undefined)
    assertAbsent(fond(el), 'depth retiré : plus de copie')
    assert.equal(zoomDe(l), '', 'depth retiré : plus de zoom')
    assert.equal(obs.vivants(el), 0, 'depth retiré : la taille n\'est plus observée')
  })

  it('edge: zoom — sans ResizeObserver : la taille est lue à la pose et à chaque redimensionnement de la fenêtre, jamais après le retrait', async () => {
    let taille: any
    fenetre((w) => { taille = avecTaille(w, 960, 285); w.eval('window.ResizeObserver = undefined'); espion = compter(w) })
    const comp = await monter('mjs-fx-behind-retrait')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    assert.equal(zoomDe(l), '1.0702', '960 × 285, depth: 10 : 1 + 20 / 285, lu à la pose')
    // le moteur écoute lui aussi le redimensionnement : on compte ce que l'effet ajoute
    const avant = espion.vivants('resize', window)
    assert.ok(avant >= 1, 'l\'effet écoute le redimensionnement de la fenêtre')
    taille.largeur = 400
    taille.hauteur = 200
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(zoomDe(l), '1.1', '400 × 200 : 1 + 20 / 200, relu au redimensionnement')
    await retirer(comp)
    assert.equal(espion.vivants('resize', window), avant - 1, 'l\'écouteur de l\'effet est retiré avec lui')
  })

  it('edge: blur ou une couleur — le calque du bord est entre la copie du fond et le sujet, sans zoom ; on passe de l\'un à l\'autre et au zoom sur place, il s\'en va avec le relief', async () => {
    let obs: any
    fenetre((w) => { avecTaille(w, 960, 285); obs = observateurs(w); avecBoite(w) })
    const comp = await monter('mjs-fx-behind-flou')
    const el   = comp._shadow.querySelector('.a')
    const hot  = el._mjs_fxOff.behind._hot
    const l    = sujet(el)
    assert.ok(bordDe(el), 'le calque du bord')
    assert.equal(bordDe(el).getAttribute('mjs-fx-behind-edge'), 'blur')
    assert.equal(bordDe(el).getAttribute('aria-hidden'), 'true')
    assert.ok(el.firstChild === fond(el) && fond(el).nextSibling === bordDe(el) && el.lastChild === l, 'dans l\'ordre : la copie du fond, le bord, le contenu, le sujet')
    assert.equal(obs.vivants(el), 0, 'sans zoom : la taille n\'est pas observée')
    assert.equal(zoomDe(l), '', 'sans zoom : aucune variable de zoom')
    // la souris le long du relief : les deux variables sont aussi écrites sur le calque du bord (son opacité les suit)
    el.dispatchEvent(souris('pointermove'))
    await attendre(() => bordDe(el).style.getPropertyValue('--mjs-fx-behind-x') !== '')
    assert.notEqual(bordDe(el).style.getPropertyValue('--mjs-fx-behind-x'), '', 'le bord suit le relief')
    // une couleur
    hot('edge', '#101014')
    assert.equal(bordDe(el).getAttribute('mjs-fx-behind-edge'), 'color')
    assert.equal(bordDe(el).style.getPropertyValue('--mjs-fx-behind-edge'), '#101014')
    // le zoom : le calque s'en va, la taille est observée
    hot('edge', 'zoom')
    assertAbsent(bordDe(el), 'le zoom n\'a pas de calque du bord')
    assert.equal(obs.vivants(el), 1)
    obs.declencher()
    assert.equal(zoomDe(l), '1.0982')
    // retour au flou : le zoom s'en va, le calque revient, la taille n'est plus observée
    hot('edge', 'blur')
    assert.ok(bordDe(el))
    assert.equal(zoomDe(l), '', 'le zoom est retiré du sujet')
    assert.equal(zoomDe(fond(el)), '', 'et de la copie')
    assert.equal(obs.vivants(el), 0)
    // un réglage retiré : le défaut, le zoom
    hot('edge', undefined)
    assertAbsent(bordDe(el), 'edge retiré : le zoom, le défaut')
    assert.equal(obs.vivants(el), 1)
    // le relief s'éteint : tout s'en va
    hot('edge', 'blur')
    hot('depth', undefined)
    assertAbsent(bordDe(el), 'depth retiré : le calque du bord s\'en va avec la copie')
    assertAbsent(fond(el))
    assert.deepEqual([...el.children].map((n: any) => n.getAttribute('mjs-fx-layer')).filter(Boolean), ['behind'], 'ne reste que le sujet')
    // le relief revient : le bord choisi, que `depth` n'a pas effacé
    hot('depth', 14)
    assert.equal(bordDe(el)?.getAttribute('mjs-fx-behind-edge'), 'blur', 'le bord écrit est gardé quand le relief revient')
  })

  it('edge sans depth : rien ne change — ni copie, ni calque du bord, ni observateur ; il reste prêt pour le jour où depth viendra', async () => {
    let obs: any
    fenetre((w) => { avecTaille(w, 960, 285); obs = observateurs(w) })
    const comp = await monter('mjs-fx-behind-sans-depth')
    const el   = comp._shadow.querySelector('.a')
    assert.deepEqual([...el.querySelectorAll('[mjs-fx-layer]')].map((n: any) => n.getAttribute('mjs-fx-layer')), ['behind'], 'le sujet seul')
    assert.ok(!el.hasAttribute('mjs-fx-behind-relief'))
    assert.equal(obs.vivants(), 0, 'aucun observateur')
    assert.equal(el._mjs_fxOff.behind._hot('edge', 'zoom'), undefined)
    assert.equal(obs.vivants(), 0, 'edge change, depth reste nul : rien')
    el._mjs_fxOff.behind._hot('edge', 'blur')
    assertAbsent(bordDe(el), 'edge seul : toujours rien')
    el._mjs_fxOff.behind._hot('depth', 14)
    assert.equal(bordDe(el)?.getAttribute('mjs-fx-behind-edge'), 'blur', 'depth vient : le relief prend le bord écrit')
    el._mjs_fxOff.behind._hot('depth', undefined)
    assertAbsent(bordDe(el), 'depth retiré : le bord s\'en va')
  })

  it('edge tenu par une variable : le flou, une couleur, le zoom suivent sur place', async () => {
    fenetre((w) => { avecTaille(w, 960, 285); observateurs(w) })
    const comp = await monter('mjs-fx-behind-bord-variable')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    assertAbsent(bordDe(el), 'zoom au départ')
    comp._shadow.querySelector('.f').click()
    await attendre(() => !!bordDe(el))
    assert.equal(bordDe(el).getAttribute('mjs-fx-behind-edge'), 'blur')
    comp._shadow.querySelector('.c').click()
    await attendre(() => bordDe(el)?.getAttribute('mjs-fx-behind-edge') === 'color')
    assert.equal(bordDe(el).style.getPropertyValue('--mjs-fx-behind-edge'), '#101014')
    comp._shadow.querySelector('.z').click()
    await attendre(() => !bordDe(el))
    assertAbsent(bordDe(el), 'zoom')
    assert.ok(sujet(el) === l, 'le même calque : rien n\'a été reposé')
  })

  it('edge: black — un nom de couleur est accepté à la compilation ; le bord est noir, sans avertissement', async () => {
    const msgs: string[] = []
    fenetre((w) => { avecTaille(w, 960, 285); observateurs(w) })
    jugeCouleurs(window)
    window.µ.warn = (m: string) => msgs.push(String(m))
    const comp = await monter('mjs-fx-behind-bord-noir')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(bordDe(el).getAttribute('mjs-fx-behind-edge'), 'color')
    assert.equal(bordDe(el).style.getPropertyValue('--mjs-fx-behind-edge'), 'black')
    assert.deepEqual(msgs, [], 'une couleur que le navigateur connaît : aucun avertissement')
  })

  it('edge: zooom (une faute de frappe) — le zoom est pris, et un seul avertissement, au vouvoiement, le dit', async () => {
    const msgs: string[] = []
    let obs: any
    fenetre((w) => { avecTaille(w, 960, 285); obs = observateurs(w) })
    jugeCouleurs(window)
    window.µ.warn = (m: string) => msgs.push(String(m))
    const comp = await monter('mjs-fx-behind-bord-faute')
    const el   = comp._shadow.querySelector('.a')
    obs.declencher()
    assert.equal(zoomDe(sujet(el)), '1.0982', 'le zoom')
    assertAbsent(bordDe(el), 'pas de calque du bord')
    assert.equal(msgs.length, 1, msgs.join(' | '))
    assert.match(msgs[0], /^\[ModularJS\] \*behind : edge = zooom n'est ni zoom, ni blur, ni une couleur que votre navigateur connaît — le zoom est pris\. Vérifiez comment vous l'avez écrit\.$/)
  })

  it('edge tenu par une variable : black, puis zooom (un avertissement, le zoom), puis blur (rien de plus)', async () => {
    const msgs: string[] = []
    fenetre((w) => { avecTaille(w, 960, 285); observateurs(w) })
    jugeCouleurs(window)
    window.µ.warn = (m: string) => msgs.push(String(m))
    const comp = await monter('mjs-fx-behind-bord-nom')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(bordDe(el).style.getPropertyValue('--mjs-fx-behind-edge'), 'black')
    assert.deepEqual(msgs, [], 'black au départ : aucun avertissement')
    comp._shadow.querySelector('.x').click()
    await attendre(() => !bordDe(el))
    assertAbsent(bordDe(el), 'zooom : le zoom, donc plus de calque du bord')
    assert.equal(msgs.length, 1, msgs.join(' | '))
    assert.match(msgs[0], /\*behind : edge = zooom n'est ni zoom, ni blur, ni une couleur que votre navigateur connaît/)
    comp._shadow.querySelector('.f').click()
    await attendre(() => bordDe(el)?.getAttribute('mjs-fx-behind-edge') === 'blur')
    assert.equal(bordDe(el).getAttribute('mjs-fx-behind-edge'), 'blur')
    assert.equal(msgs.length, 1, 'blur : aucun avertissement de plus')
    comp._shadow.querySelector('.n').click()
    await attendre(() => bordDe(el)?.getAttribute('mjs-fx-behind-edge') === 'color')
    assert.equal(bordDe(el).style.getPropertyValue('--mjs-fx-behind-edge'), 'black')
    assert.equal(msgs.length, 1, 'black de nouveau : aucun avertissement de plus')
  })

  it('edge: un texte refusé n\'est dit qu\'une fois tant qu\'il reste écrit ; un autre texte refusé, ou le même après une valeur juste, le dit de nouveau ; une valeur juste ne dit rien', async () => {
    const msgs: string[] = []
    fenetre((w) => { avecTaille(w, 960, 285); observateurs(w) })
    jugeCouleurs(window)
    window.µ.warn = (m: string) => msgs.push(String(m))
    const comp = await monter('mjs-fx-behind-bord')
    const el   = comp._shadow.querySelector('.a')
    const hot  = el._mjs_fxOff.behind._hot
    assert.deepEqual(msgs, [], 'le défaut : aucun avertissement')
    hot('edge', 'zooom')
    hot('edge', 'zooom')
    assert.equal(msgs.length, 1, 'le même texte, écrit deux fois de suite : une fois')
    hot('edge', 'bluur')
    assert.equal(msgs.length, 2, 'un autre texte refusé')
    assert.match(msgs[1], /\*behind : edge = bluur n'est ni zoom/)
    for (const v of ['blur', undefined, '', 'zoom', '#101014', 'rgb(10 10 20)', 'black', 'gold']) hot('edge', v)
    assert.equal(msgs.length, 2, 'des valeurs justes : rien de plus')
    hot('edge', 'bluur')
    assert.equal(msgs.length, 3, 'le même texte que le dernier refusé, après des valeurs justes : de nouveau')
    hot('edge', 'zooom')
    assert.equal(msgs.length, 4, 'un autre texte refusé')
    assertAbsent(bordDe(el), 'le zoom est pris')
  })

  it('edge tenu par une variable aux espaces et à la casse libres (\' Blur \') : c\'est blur, sans avertissement', async () => {
    const msgs: string[] = []
    fenetre((w) => { avecTaille(w, 960, 285); observateurs(w) })
    jugeCouleurs(window)
    window.µ.warn = (m: string) => msgs.push(String(m))
    const comp = await monter('mjs-fx-behind-bord-casse')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(bordDe(el)?.getAttribute('mjs-fx-behind-edge'), 'blur', 'les espaces et la majuscule de « Blur » le font prendre pour une faute de frappe')
    assert.deepEqual(msgs, [], 'blur, écrit avec une majuscule et des espaces : aucun avertissement')
  })

  it('edge changé en route : les espaces autour du mot et sa casse ne comptent pas (zoom, blur), ni ceux d\'un nom de couleur ; aucun avertissement', async () => {
    const msgs: string[] = []
    fenetre((w) => { avecTaille(w, 960, 285); observateurs(w) })
    jugeCouleurs(window)
    window.µ.warn = (m: string) => msgs.push(String(m))
    const comp = await monter('mjs-fx-behind-bord')
    const el   = comp._shadow.querySelector('.a')
    const hot  = el._mjs_fxOff.behind._hot
    const vu   = (v: string) => { hot('edge', v); return bordDe(el)?.getAttribute('mjs-fx-behind-edge') ?? 'zoom' }
    assert.equal(vu(' zoom '), 'zoom', 'espaces autour de zoom')
    assert.deepEqual(msgs, [], '« zoom » entre espaces n\'est pas une faute de frappe : aucun avertissement (il dirait « edge = zoom n\'est ni zoom… »)')
    assert.equal(vu('Blur'), 'blur', 'majuscule à blur')
    assert.equal(vu(' BLUR '), 'blur', 'majuscules et espaces à blur')
    assert.equal(vu('ZOOM'), 'zoom', 'majuscules à zoom')
    assert.equal(vu('blur'), 'blur')
    assert.equal(vu(' Zoom'), 'zoom', 'espace et majuscule à zoom')
    assert.equal(vu('  '), 'zoom', 'des espaces seuls : rien d\'écrit, le zoom')
    assert.equal(vu(' Black '), 'color', 'une couleur entourée d\'espaces')
    assert.equal(bordDe(el).style.getPropertyValue('--mjs-fx-behind-edge'), 'Black')
    assert.deepEqual(msgs, [], 'des mots justes, écrits autrement : aucun avertissement (sinon il dit « edge = zoom n\'est ni zoom… »)')
    vu('zooom')
    assert.equal(msgs.length, 1, 'une vraie faute de frappe, elle, est dite')
  })

  it('le retrait débranche l\'observateur de taille du zoom ; le retrait d\'un flou ne laisse ni calque ni variable', async () => {
    let obs: any
    fenetre((w) => { avecTaille(w, 960, 285); obs = observateurs(w); espion = compter(w) })
    const comp = await monter('mjs-fx-behind-retrait')
    const el   = comp._shadow.querySelector('.a')
    const l    = sujet(el)
    assert.equal(obs.vivants(el), 1, 'le zoom observe la balise')
    await retirer(comp)
    assert.equal(obs.vivants(el), 0, 'observateur débranché avec l\'effet')
    assert.ok(l.parentNode === null, 'le sujet est retiré')
    fenetre((w) => { avecTaille(w, 960, 285); obs = observateurs(w) })
    const flou = await monter('mjs-fx-behind-retrait-flou')
    const hf   = flou._shadow.querySelector('.a')
    const bord = bordDe(hf)
    assert.ok(bord, 'le calque du bord')
    await retirer(flou)
    assert.ok(bord.parentNode === null, 'le calque du bord est retiré')
    assert.deepEqual(hf.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.ok(!/--mjs-/.test(hf.getAttribute('style') ?? ''), 'variable restée')
  })

  it('depth: 101, size: stretch, position: ailleurs sont refusés ; sur une image : refusé, la balise doit dessiner', async () => {
    await assert.rejects(compiler('<header *behind(\'a.png\', depth: 101)>x</header>'), /\*behind : depth = 101 — permis : int 0\.\.100/)
    await assert.rejects(compiler('<header *behind(\'a.png\', size: stretch)>x</header>'), /\*behind : size = stretch/)
    await assert.rejects(compiler('<header *behind(\'a.png\', position: ailleurs)>x</header>'), /\*behind : position = ailleurs/)
    await assert.rejects(compiler('<header *behind(\'a.png\', lueur: 2)>x</header>'), /\*behind/)
    await assert.rejects(compiler('<img *behind(\'a.png\') src="a.png" alt="">'), /\*behind[\s\S]*dessine à l'intérieur/)
    await compiler('<header *behind(\'a.png\', size: cover, position: 20% 80%, depth: 100)>x</header>')
    await compiler('<header *behind>x</header>')
    // edge : zoom, blur, ou une couleur — comme pour toute couleur de MJS, seul le navigateur la juge : un nom (black, gold), #hex, rgb(), hsl(), var()…
    for (const bord of ['zoom', 'blur', 'black', 'gold', '\'black\'', '\'#101014\'', '#101014', '#fff', 'rgb(10 10 20)', 'rgb(16 16 20)', 'rgba(16, 16, 20, .9)', 'hsl(240 10% 7%)', 'var(--fond)']) await compiler(`<header *behind('a.png', depth: 14, edge: ${bord})>x</header>`)
    // … un texte que le navigateur ne reconnaît pas passe la compilation aussi (une faute de frappe, une couleur mal écrite) : l'exécution le dit une fois dans la console
    for (const bord of ['zooom', 'bluur', 'blakc', '#12', '#12345']) await compiler(`<header *behind('a.png', depth: 14, edge: ${bord})>x</header>`)
    // … seul ce qui ne peut pas être une valeur CSS (`;`, `{`, `}`) est refusé
    for (const bord of ['rgb(1;2)', 'a;b', 'a}b', 'a{b']) await assert.rejects(compiler(`<header *behind('a.png', depth: 14, edge: ${bord})>x</header>`), /\*behind : edge = /, 'edge: ' + bord)
  })
})
