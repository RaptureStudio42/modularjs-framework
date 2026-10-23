// *focus — la mise au point sur un groupe, côté logique : l'entrée du catalogue (réglages, défauts,
// réglage principal), la feuille (aucune boucle, que filter / opacity / scale, le survol réservé aux
// appareils à survol, will-change jamais au repos ni sur l'enfant mis au point, scale et z-index de
// l'enfant mis au point seulement sous la marque de grow, pas de transition en « réduire les
// animations », un *focus dans un autre qui repart des défauts), puis l'effet posé dans un vrai
// composant (happy-dom) : la marque et les variables des seuls réglages écrits, la marque de grow
// (posée seulement quand grow n'est pas 1, suivie sur place), aucun écouteur sur le parent ni sur ses
// enfants, un réglage suivi par une variable change sur place sans reposer l'effet, le retrait ({if}
// refermé) ne laisse rien.
// Puis un composant dont les enfants vivent dans son gabarit : un seul avertissement, dans la langue de la
// page, et rien pour un composant qui reçoit ses enfants par un slot (même un bloc encore vide).
// Ce qui se voit (flou, estompage, grossissement, clavier, tactile) est dans effets-focus-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'
import { DETECTED_CORE_MODULES } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '../src/runtime')
const MOTEUR  = readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8')
const pause   = (ms: number) => new Promise((r) => setTimeout(r, ms))

// la définition de l'effet, chargée avec le moteur seul
function definition(): any {
  const µ: any = {}
  new Function('µ', MOTEUR + '\n' + readFileSync(join(RUNTIME, 'mjs_fx_focus.ts'), 'utf-8'))(µ)
  return µ._mjs_fxDefs.focus
}

// les règles de la feuille, avec la condition @media qui les enveloppe (un niveau d'imbrication)
function regles(css: string): Array<{ media: string, sel: string, corps: string }> {
  const plat: Array<{ media: string, sel: string, corps: string }> = []
  const re = /(@media[^{]*)\{((?:[^{}]*\{[^{}]*\})*)\}|([^{}@][^{}]*)\{([^{}]*)\}/g
  for (const m of css.matchAll(re)) {
    if (m[1]) for (const r of m[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)) plat.push({ media: m[1].trim(), sel: r[1], corps: r[2] })
    else plat.push({ media: '', sel: m[3], corps: m[4] })
  }
  return plat
}

describe('*focus — catalogue et feuille', () => {
  it('famille des cartes, réglage principal blur, sept réglages avec leurs défauts', () => {
    const fx = EFFECTS.focus
    assert.ok(fx, '*focus absent du catalogue')
    assert.equal(fx.family, 'card')
    assert.equal(fx.main, 'blur')
    assert.ok(!fx.inside && !fx.text && !fx.field && !fx.transition, 'ni calque, ni texte, ni champ, ni transition')
    assert.deepEqual(Object.keys(fx.settings), ['blur', 'opacity', 'grayscale', 'scale', 'grow', 'duration', 'easing'])
    const vu: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fx.settings)) vu[k] = [v.rule, v.dflt]
    assert.deepEqual(vu, {
      blur:      ['int 0..40', 8],
      opacity:   ['float 0..1', 1],
      grayscale: ['float 0..1', 0],
      scale:     ['float 0.5..1.5', 1],
      grow:      ['float 1..2', 1],
      duration:  ['time', '500ms'],
      easing:    ["'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'", 'ease']
    })
  })

  it('le code de l\'effet est un module du cœur déclaré', () => {
    assert.ok((DETECTED_CORE_MODULES as readonly string[]).includes('fx_focus'))
  })

  it('CSS pour l\'essentiel : un setup court (la marque de grow, la transition propre de chaque enfant), ni animation, ni propriété de mise en page — seulement filter, opacity et scale', () => {
    const def = definition()
    assert.ok(def, 'µ._mjs_fxDefs.focus absent')
    assert.equal(typeof def.setup, 'function', 'le setup pose la marque de grow')
    assert.ok(!/addEventListener|setTimeout|setInterval|requestAnimationFrame|IntersectionObserver|ResizeObserver/.test(String(def.setup)), 'ni écouteur, ni minuterie, ni observateur de taille ou de visibilité')
    assert.match(String(def.setup), /observe\(el, \{ childList: true \}\)/, 'un seul observateur, des enfants directs : la transition propre d\'un enfant ajouté est gardée aussi')
    assert.ok(!/@keyframes|animation/.test(def.css), 'aucune animation CSS : des transitions')
    // la transition de chaque enfant : la sienne, puis filter, opacity et scale (écrite par le setup)
    assert.match(def.css, /[{;]transition:var\(--mjs-fx-tr\)\}/)
    assert.match(String(def.setup), /'filter ' \+ d \+ ',opacity ' \+ d \+ ',scale ' \+ d/)
    for (const prop of ['top', 'left', 'right', 'bottom', 'width', 'height', 'margin', 'padding', 'display', 'position', 'transform']) {
      assert.ok(!new RegExp(`[;{]${prop}:`).test(def.css), `${prop} ne doit pas être écrit par la feuille`)
    }
  })

  it('chacun des sept réglages est une variable --mjs-focus-<réglage>, lue avec le défaut du catalogue en repli', () => {
    const def = definition()
    assert.deepEqual(Object.keys(def.vars), Object.keys(EFFECTS.focus.settings))
    for (const [k, unite] of Object.entries(def.vars) as Array<[string, string]>) {
      const dflt = EFFECTS.focus.settings[k].dflt
      assert.ok((def.css + String(def.setup)).includes(`var(--mjs-focus-${k},${dflt}${unite})`), `--mjs-focus-${k} : repli ${dflt}${unite} absent de la feuille et de la transition des enfants`)
    }
  })

  it('le survol n\'agit que sur un appareil à survol, will-change n\'est jamais posé au repos, « réduire les animations » coupe la transition', () => {
    const def = definition()
    const tout = regles(def.css)
    assert.ok(tout.length >= 8, `${tout.length} règles lues`)
    // le parent survolé : jamais hors de @media (hover:hover)
    const survol = tout.filter((r) => /\[mjs-fx~="focus"\](\[mjs-fx-focus-grow\])?:hover/.test(r.sel))
    assert.ok(survol.length >= 3, 'les autres, l\'enfant mis au point et la promotion des enfants')
    for (const r of survol) assert.match(r.media, /hover:hover/, `${r.sel} hors d'un appareil à survol`)
    // will-change : seulement quand le groupe est mis au point, et pas en « réduire les animations »
    const promus = tout.filter((r) => /will-change/.test(r.corps))
    assert.equal(promus.length, 2)
    for (const r of promus) {
      assert.match(r.media, /prefers-reduced-motion:no-preference/)
      assert.match(r.sel, /\]:(hover|has\(:focus-visible\)) > /)
      assert.match(r.sel, /> :not\(\[mjs-fx-layer\],:hover,:focus-visible,/, `${r.sel} promeut aussi l'enfant mis au point : un will-change: filter en ferait le bloc conteneur de ses descendants absolus`)
    }
    // au repos : la transition seule (la leur, puis celle de l'effet), sur les enfants qui ne sont pas des calques d'effets
    const repos = tout.filter((r) => r.media === '' && /transition:var\(--mjs-fx-tr\)/.test(r.corps))
    assert.equal(repos.length, 1)
    assert.equal(repos[0].sel, '[mjs-fx~="focus"] > [mjs-fx-tr]:not([mjs-fx-layer])')
    assert.ok(!/will-change|filter:|opacity:|scale:/.test(repos[0].corps.replace(/transition:[^;]*/, '')), 'rien d\'autre au repos')
    // « réduire les animations » : la même sélection, sans transition
    const calme = tout.filter((r) => /prefers-reduced-motion:reduce/.test(r.media))
    assert.equal(calme.length, 1)
    assert.equal(calme[0].sel, repos[0].sel)
    assert.match(calme[0].corps, /transition:none/)
  })

  it('l\'enfant mis au point ne reçoit scale ni z-index que sous la marque de grow (le défaut ne transforme rien)', () => {
    const def = definition()
    const toutes = regles(def.css)
    const haut   = toutes.filter((r) => /z-index|--mjs-focus-grow/.test(r.corps))
    assert.equal(haut.length, 2, 'le survol et le clavier')
    for (const r of haut) {
      assert.match(r.sel, /^\[mjs-fx~="focus"\]\[mjs-fx-focus-grow\]:(hover|has\(:focus-visible\)) > /, `${r.sel} vaut sans la marque de grow`)
      assert.match(r.corps, /scale:var\(--mjs-focus-grow,1\);z-index:1/)
    }
    // et rien d'autre n'écrit le scale de l'enfant mis au point : les autres enfants seuls prennent scale (le leur)
    for (const r of toutes) {
      if (haut.includes(r) || !/(^|[;{])scale:/.test(r.corps)) continue
      assert.match(r.corps, /scale:var\(--mjs-focus-scale,1\)/)
      assert.match(r.sel, /:not\(\[mjs-fx-layer\],:hover,/, `${r.sel} écrit un scale sur l'enfant mis au point`)
    }
  })

  it('un *focus dans un autre : ses enfants repartent des défauts pour chaque réglage qu\'il n\'écrit pas (jamais lui-même)', () => {
    const def = definition()
    const tout = regles(def.css)
    for (const k of ['blur', 'opacity', 'grayscale', 'scale', 'duration', 'easing']) {
      const r = tout.filter((x) => x.corps === `--mjs-focus-${k}:initial`)
      assert.equal(r.length, 1, `une règle de remise à zéro pour ${k}`)
      assert.equal(r[0].media, '')
      // sur les ENFANTS du parent imbriqué (le parent lui-même garde ce qu'il hérite : il est un enfant de l'extérieur), et seulement si le parent n'a pas écrit ce réglage
      assert.equal(r[0].sel, `[mjs-fx~="focus"] [mjs-fx~="focus"]:not([style*="--mjs-focus-${k}"]) > *`)
    }
    assert.equal(tout.filter((x) => /:initial/.test(x.corps)).length, 6, 'grow n\'en a pas : il ne vaut que sous la marque du parent lui-même')
  })

  it('les calques d\'effets ne sont jamais pris pour des enfants (aucune règle n\'en cible un)', () => {
    const def = definition()
    for (const r of regles(def.css)) {
      if (!r.sel.includes('[mjs-fx~="focus"]')) continue
      // une variable remise à zéro sur tous les enfants d'un groupe imbriqué n'est pas une allure : un calque n'en lit aucune
      if (/^--mjs-focus-[a-z]+:initial$/.test(r.corps)) continue
      assert.ok(r.sel.includes('[mjs-fx-layer]'), `${r.sel} peut atteindre un calque`)
    }
  })
})

describe('*focus — posé puis retiré dans un composant', function () {
  this.timeout(90000)
  let window: any
  let comp: any
  const ecouteurs: Array<{ cible: any, type: string }> = []

  before(async () => {
    const root   = mjsTmp('effets-focus')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fo-pose.mjs'), [
      '<script>',
      '$on = true',
      '$flou = 6',
      '$niveau = 0.5',
      '$croit = 1',
      '</script>',
      '{if $on}',
      '<ul class="g" *focus($flou, opacity: $niveau, grow: 1.1)><li class="a"><b>a</b></li><li class="b">b</li></ul>',
      '<ul class="h" *focus><li class="c">c</li></ul>',
      '<ul class="k" *focus(grow: $croit)><li class="d">d</li></ul>',
      '{end}',
      '<button class="t" @click={$on = !$on}>t</button>',
      '<button class="v" @click={$flou = 20}>v</button>',
      '<button class="w" @click={$croit = 1.4}>w</button>',
      '<button class="x" @click={$croit = 1}>x</button>'
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // chaque écouteur posé à partir d'ici est relevé
    const ajoute = window.EventTarget.prototype.addEventListener
    window.EventTarget.prototype.addEventListener = function (type: string, ...reste: any[]) {
      ecouteurs.push({ cible: this, type })
      return ajoute.call(this, type, ...reste)
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-fo-pose></mjs-fo-pose>'
    comp = window.document.querySelector('mjs-fo-pose')
    const debut = Date.now()
    while (!comp._shadow?.querySelector('.g') && Date.now() - debut < 3000) await pause(10)
    await pause(60)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('pose : la marque mjs-fx, et les variables des seuls réglages écrits', () => {
    const g = comp._shadow.querySelector('.g')
    const h = comp._shadow.querySelector('.h')
    assert.ok(g && h)
    assert.deepEqual((g.getAttribute('mjs-fx') ?? '').split(' '), ['focus'])
    assert.equal(g.style.getPropertyValue('--mjs-focus-blur'), '6px')
    assert.equal(g.style.getPropertyValue('--mjs-focus-opacity'), '0.5')
    assert.equal(g.style.getPropertyValue('--mjs-focus-grow'), '1.1')
    for (const k of ['grayscale', 'scale', 'duration', 'easing']) assert.equal(g.style.getPropertyValue('--mjs-focus-' + k), '', `${k} non écrit : pas de variable (le repli du CSS vaut le défaut)`)
    assert.deepEqual((h.getAttribute('mjs-fx') ?? '').split(' '), ['focus'])
    assert.ok(!/--mjs-/.test(h.getAttribute('style') ?? ''), 'aucun réglage écrit : aucune variable')
  })

  it('aucun écouteur sur le parent ni sur ses enfants ; sur chaque enfant, la seule marque de sa transition', () => {
    const g = comp._shadow.querySelector('.g')
    const h = comp._shadow.querySelector('.h')
    const k = comp._shadow.querySelector('.k')
    const noeuds = [g, h, k, ...Array.from(g.querySelectorAll('*')), ...Array.from(h.querySelectorAll('*')), ...Array.from(k.querySelectorAll('*'))]
    const sur = ecouteurs.filter((e) => noeuds.some((n) => n === e.cible))
    assert.deepEqual(sur.map((e) => e.type), [], 'aucun écouteur sur le parent ni sur ses enfants')
    for (const li of [...Array.from(g.children), ...Array.from(h.children), ...Array.from(k.children)] as any[]) {
      assert.deepEqual(li.getAttributeNames().sort(), ['class', 'mjs-fx-tr', 'style'], 'un enfant garde ses attributs, plus la marque de sa transition')
      assert.deepEqual(Array.from(li.style as any), ['--mjs-fx-tr'], 'et sa transition, seule écrite dans son style')
    }
    assertAbsent(g.querySelector('[mjs-fx-layer]'), 'aucun calque')
  })

  it('la marque de grow : posée quand grow n\'est pas 1, jamais au défaut ; elle suit une variable sur place', async () => {
    const g = comp._shadow.querySelector('.g')
    const h = comp._shadow.querySelector('.h')
    const k = comp._shadow.querySelector('.k')
    assert.equal(g.hasAttribute('mjs-fx-focus-grow'), true, 'grow: 1.1 — la marque est posée')
    assert.equal(h.hasAttribute('mjs-fx-focus-grow'), false, 'aucun réglage — pas de marque')
    assert.equal(k.hasAttribute('mjs-fx-focus-grow'), false, 'grow: 1 — pas de marque')
    assert.deepEqual(h.getAttributeNames().sort(), ['class', 'mjs-fx'], 'au repos le parent n\'a que sa marque mjs-fx de plus')
    const avant = k._mjs_fxOff.focus
    comp._shadow.querySelector('.w').click()
    await pause(40)
    assert.equal(k.hasAttribute('mjs-fx-focus-grow'), true, 'grow passé à 1.4 — la marque est posée sur place')
    assert.equal(k.style.getPropertyValue('--mjs-focus-grow'), '1.4')
    assert.ok(k._mjs_fxOff.focus === avant, 'le même effet : rien n\'est reposé')
    comp._shadow.querySelector('.x').click()
    await pause(40)
    assert.equal(k.hasAttribute('mjs-fx-focus-grow'), false, 'grow revenu à 1 — la marque est retirée')
    assert.ok(k._mjs_fxOff.focus === avant, 'toujours le même effet')
    // la marque reste posée pour le retrait ci-dessous
    comp._shadow.querySelector('.w').click()
    await pause(40)
    assert.equal(k.hasAttribute('mjs-fx-focus-grow'), true)
  })

  it('un réglage tenu par une variable change sur place, sans reposer l\'effet', async () => {
    const g     = comp._shadow.querySelector('.g')
    const avant = g._mjs_fxOff.focus
    assert.ok(avant)
    comp._shadow.querySelector('.v').click()
    await pause(40)
    assert.equal(g.style.getPropertyValue('--mjs-focus-blur'), '20px', 'la variable suit')
    assert.ok(g._mjs_fxOff.focus === avant, 'le même effet : rien n\'est reposé')
    assert.equal(g.style.getPropertyValue('--mjs-focus-opacity'), '0.5', 'les autres réglages ne bougent pas')
  })

  it('retrait ({if} refermé) : ni marque, ni variable, ni calque, et les enfants ne portent rien', async () => {
    const g = comp._shadow.querySelector('.g')
    const h = comp._shadow.querySelector('.h')
    const k = comp._shadow.querySelector('.k')
    assert.equal(g.hasAttribute('mjs-fx-focus-grow') && k.hasAttribute('mjs-fx-focus-grow'), true, 'deux marques de grow posées avant le retrait')
    comp._shadow.querySelector('.t').click()
    const debut = Date.now()
    while (comp._shadow.querySelector('.g') && Date.now() - debut < 3000) await pause(10)
    await pause(50)
    for (const el of [g, h, k]) {
      assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [], 'aucune marque')
      assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''), 'aucune variable')
      assert.equal(el._mjs_fxOff ?? null, null, 'retrait inscrit')
      assertAbsent(el.querySelector('[mjs-fx-layer]'), 'aucun calque après le retrait')
    }
  })
})

describe('*focus — sur un composant dont les enfants vivent dans son gabarit', function () {
  this.timeout(90000)
  const fenetres: any[] = []
  let sources: string[] = []
  let libelles = ''

  before(async () => {
    const root   = mjsTmp('effets-focus-hote')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    // une coque (ses enfants sont dans son gabarit), une fente (elle reçoit ses enfants par un slot)
    writeFileSync(join(srcDir, 'fo-coque.mjs'), '<div class="gz"><div class="c">1</div><div class="c">2</div></div>\n')
    writeFileSync(join(srcDir, 'fo-fente.mjs'), '<div class="gz"><slot></slot></div>\n')
    writeFileSync(join(srcDir, 'fo-hote.mjs'), [
      '<script>',
      '$items = []',
      '$oui = false',
      '</script>',
      '<@fo-coque class="a" *focus></@fo-coque>',
      '<@fo-fente class="b" *focus><div class="c">1</div><div class="c">2</div></@fo-fente>',
      '<@fo-fente class="d" *focus>{for i in $items by i}<div class="c">{i}</div>{end}</@fo-fente>',
      '<@fo-fente class="e" *focus>{if $oui}<div class="c">x</div>{end}</@fo-fente>',
      '<div class="f" *focus></div>'
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    sources  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8')))
    libelles = libellesDuManifeste(join(root, 'bundle.js'))
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // les avertissements de *focus reçus par une page de cette langue, et la page elle-même
  async function avertissements(lang: string): Promise<{ recus: string[], window: any }> {
    const window: any = new Window({ url: 'http://localhost/' })
    if (lang) window.document.documentElement.setAttribute('lang', lang)
    fenetres.push(window)
    window.eval(`${sources.join('\n')}\nglobalThis.µ = µ;`)
    window.eval(libelles)
    const recus: string[] = []
    window.µ.warn = (...a: any[]) => { recus.push(String(a[0])) }
    window.document.body.innerHTML = '<mjs-fo-hote></mjs-fo-hote>'
    const hote  = window.document.querySelector('mjs-fo-hote')
    const debut = Date.now()
    while (!hote._shadow?.querySelector('.f') && Date.now() - debut < 3000) await pause(10)
    await pause(100)
    return { recus: recus.filter((m) => m.includes('*focus')), window }
  }

  it('un composant sans enfant glissé : un seul avertissement (français), qui dit où poser *focus ; les autres balises n\'en reçoivent pas', async () => {
    for (const lang of ['', 'fr']) {
      const { recus } = await avertissements(lang)
      assert.deepEqual(recus, ['[ModularJS] *focus : le composant <mjs-fo-coque> n\'a aucun enfant glissé — ses enfants vivent dans son gabarit, où *focus ne les atteint pas. Posez *focus dans le gabarit du composant, sur le parent de ses enfants.'])
    }
  })

  it('page en anglais : le même avertissement sort en anglais', async () => {
    const { recus } = await avertissements('en')
    assert.deepEqual(recus, ['[ModularJS] *focus: the component <mjs-fo-coque> has no slotted children — its children live in its own template, where *focus cannot reach them. Put *focus in the component\'s template, on the parent of its children.'])
  })

  it('l\'effet est posé malgré l\'avertissement, et un composant à slot (même un bloc encore vide) n\'en reçoit aucun', async () => {
    const { window } = await avertissements('')
    const racine = window.document.querySelector('mjs-fo-hote')._shadow
    for (const k of ['.a', '.b', '.d', '.e', '.f']) assert.deepEqual((racine.querySelector(k).getAttribute('mjs-fx') ?? '').split(' '), ['focus'], `*focus posé sur ${k}`)
  })
})
