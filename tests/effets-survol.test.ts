// Les transitions au survol (`on: hover`), sans navigateur : le catalogue (le mot `hover` et le réglage `of` pour toutes
// les transitions, aucun pour celles du cycle de vie seul), et le comportement dans happy-dom, qui n'a ni `animate()` ni
// souris : un faux `animate` note chaque jeu, les événements partent à la main. La balise est cachée au repos (la marque
// `mjs-fx-hover`, quatre écouteurs passifs sur le parent, rien d'autre) ; l'arrivée de la souris joue son entrée, son départ sa
// sortie ; un retournement repart de l'avancée courante ; le focus, l'appui du doigt, `of`, la balise posée sous la souris,
// celle de la racine d'un composant, « réduire les animations », le réglage suivi sans reposer l'effet, le retrait ({if}
// refermé) qui ne laisse ni écouteur ni marque.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const TRANSITIONS = Object.keys(EFFECTS).filter((n) => EFFECTS[n].transition && !EFFECTS[n].life)

const COMPOSANTS: Record<string, string> = {
  'survol-carte': "<script>\n$d = '300ms'\n$o = 'hover'\n</script>\n<article class=\"carte\"><p class=\"l\" *fade(on: hover, duration: $d)>légende</p></article>\n<article class=\"autre\"><p class=\"m\" *fade(on: $o)>variable</p></article>",
  'survol-if': '<script>\n$vu = true\n</script>\n<article class="carte">{if $vu}<p class="l" *fly(up, on: hover)>légende</p>{end}</article>',
  'survol-of': "<div class=\"ligne\"><div class=\"actions\"><button class=\"b\" *scale(on: hover, of: '.ligne')>b</button><button class=\"c\" *scale(on: hover, of: '.absent')>c</button><button class=\"d\" *scale(on: hover, of: '..')>d</button></div></div>",
  'survol-racine': '<p class="r" *fade(on: hover)>racine</p>',
  'survol-direct': '<p class="n" *fade(on: load)>direct</p>',
  'survol-ignores': "<article class=\"carte\"><p class=\"l\" *fade(on: hover, once: false, zone: '70% 40%')>x</p><p class=\"m\" *fade(on: hover, duration: 200ms)>y</p></article>",
  'survol-of-seul': "<article class=\"carte\"><p class=\"l\" *fade(of: '.carte')>x</p><p class=\"m\" *fade(duration: 200ms)>y</p></article>",
  'survol-dix': '<article class="carte">' + Array.from({ length: 10 }, (_, i) => `<p class="l${i}" *fade(on: hover)>l${i}</p>`).join('') + '</article>',
  'survol-deux': '<script>\n$a = true\n$b = true\n</script>\n<article class="carte">{if $a}<p class="a" *fade(on: hover)>a</p>{end}{if $b}<p class="b" *fade(on: hover)>b</p>{end}</article>'
}

// attend que `cond` soit vraie ; un délai dépassé est une erreur, jamais un silence
async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  assert.ok(cond(), `condition jamais vérifiée : ${cond.toString()}`)
}

describe('transitions au survol : le catalogue', () => {
  it('`on: hover` et `of` pour toutes les transitions qui se posent directement, aucun pour celles du cycle de vie seul', () => {
    assert.ok(TRANSITIONS.length >= 20, `${TRANSITIONS.length} transitions`)
    for (const nom of TRANSITIONS) {
      const s = EFFECTS[nom].settings
      assert.match(s.on.rule, /'hover'/, `*${nom} : on ne connaît pas hover`)
      assert.equal(s.on.dflt, 'view', `*${nom} : le défaut de on ne change pas`)
      assert.equal(s.of?.rule, 'string 1..200', `*${nom} : le réglage of`)
      assert.equal(s.of?.dflt, undefined, `*${nom} : of n'a pas de défaut`)
    }
    for (const nom of Object.keys(EFFECTS).filter((n) => EFFECTS[n].transition && EFFECTS[n].life)) {
      assert.equal('on' in EFFECTS[nom].settings, false, `*${nom} : réservée au cycle de vie, pas de on`)
      assert.equal('of' in EFFECTS[nom].settings, false, `*${nom} : réservée au cycle de vie, pas de of`)
    }
  })

  it('les mots de on d\'avant restent, dans le même ordre', () => {
    for (const nom of TRANSITIONS) assert.match(EFFECTS[nom].settings.on.rule, /^'view' \| 'scroll' \| 'load' \| 'success' \| 'error'/, `*${nom}`)
  })
})

describe('transitions au survol : le comportement', function () {
  this.timeout(120000)
  let window: any
  let animateAvant: any
  let matchMediaAvant: any
  let reduit = false
  // happy-dom partage ses classes, donc leurs prototypes, entre toutes les fenêtres du processus : ce que ce groupe y remplace est rendu à sa fin
  // (l'espion d'écouteurs garde chaque nœud touché dans `ecouteurs`, il retiendrait ceux de tous les fichiers suivants)
  const rendus: Array<() => void> = []
  const anims: any[] = []
  const avertissements: string[] = []
  // les écouteurs posés sur chaque nœud, par type : { ajouts, retraits, passifs }
  const ecouteurs = new Map<any, { ajoute: string[], retire: string[], passif: boolean[] }>()
  const survolees = new Set<any>()

  before(async () => {
    const root   = mjsTmp('effets-survol')
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
    animateAvant = window.Element.prototype.animate
    // un faux `animate` : la tenue de départ (durée zéro) finit d'elle-même, un jeu qui dure attend `finish()` ; son avancée se lit et se règle
    window.Element.prototype.animate = function (keyframes: any, opts: any) {
      let fin: any
      let rate: any
      const a: any = {
        el: this, keyframes, opts, progress: 0, cancelled: false, done: false,
        finished: new Promise((r, j) => { fin = r; rate = j }),
        effect: { getComputedTiming: () => ({ progress: a.progress }) },
        // comme une vraie animation : annulée, sa promesse `finished` est rejetée
        cancel() { a.cancelled = true; rate(new Error('AbortError')) },
        pause() {}, play() {},
        finish() { a.done = true; a.progress = 1; fin(a) },
      }
      a.finished.catch(() => {})
      anims.push(a)
      if (!((typeof opts === 'number' ? opts : opts?.duration) > 0)) setTimeout(() => { a.done = true; fin(a) }, 2)
      return a
    }
    matchMediaAvant = window.matchMedia
    window.matchMedia = (q: string) => ({ media: q, matches: reduit && /prefers-reduced-motion:\s*reduce/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    // les écouteurs, comptés sur tous les nœuds : posés par le prototype qui définit addEventListener (celui des éléments, celui du
    // document), une seule fois chacun
    const poseurs = new Set<any>()
    for (const depart of [window.Element.prototype, window.document]) {
      let proto = depart
      while (proto && !Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto)
      if (!proto || poseurs.has(proto)) continue
      poseurs.add(proto)
      const ajoute = proto.addEventListener
      const retire = proto.removeEventListener
      proto.addEventListener = function (type: string, fn: any, o?: any) {
        const e = ecouteurs.get(this) ?? { ajoute: [], retire: [], passif: [] }
        e.ajoute.push(type)
        e.passif.push(typeof o === 'object' && !!o?.passive)
        ecouteurs.set(this, e)
        return ajoute.call(this, type, fn, o)
      }
      proto.removeEventListener = function (type: string, fn: any, o?: any) {
        const e = ecouteurs.get(this) ?? { ajoute: [], retire: [], passif: [] }
        e.retire.push(type)
        ecouteurs.set(this, e)
        return retire.call(this, type, fn, o)
      }
      rendus.push(() => { proto.addEventListener = ajoute; proto.removeEventListener = retire })
    }
    // :hover et :focus-within n'existent pas dans happy-dom : un nœud « survolé » le dit
    const matches = window.Element.prototype.matches
    window.Element.prototype.matches = function (sel: string) {
      if (sel === ':hover') return survolees.has(this)
      if (sel === ':focus-within') return false
      return matches.call(this, sel)
    }
    rendus.push(() => { window.Element.prototype.matches = matches })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.µ.warn = (...a: any[]) => { avertissements.push(a.map(String).join(' ')) }
  })

  after(async () => {
    while (rendus.length) rendus.pop()!()
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    if (window && matchMediaAvant) window.matchMedia = matchMediaAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  beforeEach(() => {
    reduit = false
    anims.length = 0
    avertissements.length = 0
    survolees.clear()
  })

  // un composant posé dans la page : sa balise, son shadow root
  async function pose(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    // la pose de l'effet suit l'insertion d'une microtâche
    await new Promise((r) => setTimeout(r, 20))
    return { comp, el: comp._shadow.querySelector(sel) }
  }
  const evenement = (type: string, extra: Record<string, any> = {}) => {
    const e = new window.Event(type, { bubbles: type === 'pointerdown' || type === 'focusin' || type === 'focusout' })
    for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v })
    return e
  }
  const envoie = (cible: any, type: string, extra: Record<string, any> = {}) => cible.dispatchEvent(evenement(type, extra))
  const jeux = (el: any) => anims.filter((a) => a.el === el && a.keyframes.length > 2)
  const tenues = (el: any) => anims.filter((a) => a.el === el && a.keyframes.length === 2)
  const marque = (el: any) => el.getAttribute('mjs-fx-hover')
  const typesPosesSur = (n: any) => (ecouteurs.get(n)?.ajoute ?? []).slice().sort()

  it('au repos : cachée par la marque, aucune animation ; quatre écouteurs passifs sur le parent, rien sur la page', async () => {
    ecouteurs.clear()
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    assert.equal(marque(el), 'rest', 'la marque de repos')
    assert.equal(anims.length, 0, 'aucune animation au repos')
    assert.deepEqual(typesPosesSur(carte), ['focusin', 'focusout', 'pointerenter', 'pointerleave'])
    assert.ok(ecouteurs.get(carte)!.passif.every(Boolean), 'écouteurs passifs')
    assert.equal((ecouteurs.get(window.document)?.ajoute ?? []).includes('pointerdown'), false, 'aucun écouteur de l\'appui sur la page au repos')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')).sort(), ['mjs-fx', 'mjs-fx-hover'])
  })

  it('arrivée de la souris : l\'entrée de la transition joue, la marque part ; départ : sa sortie, puis la balise se cache de nouveau', async () => {
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    envoie(carte, 'pointerenter', { pointerType: 'mouse' })
    assert.equal(marque(el), null, 'visible dès l\'arrivée')
    await attendre(() => jeux(el).length === 1)
    assert.equal(jeux(el).length, 1)
    const entree = jeux(el)[0]
    assert.equal(entree.keyframes[0].opacity, 0, 'part de cachée')
    assert.equal(entree.keyframes[entree.keyframes.length - 1].opacity, 1, 'finit nette')
    assert.equal(entree.opts.duration, 300, 'la durée du réglage')
    entree.finish()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(marque(el), null, 'entrée finie : reste visible')
    assert.equal(entree.cancelled, true, 'la tenue de l\'entrée est rendue')
    envoie(carte, 'pointerleave', { pointerType: 'mouse' })
    await attendre(() => jeux(el).length === 2)
    const sortie = jeux(el)[1]
    assert.equal(sortie.keyframes[0].opacity, 1, 'part de nette')
    assert.equal(sortie.keyframes[sortie.keyframes.length - 1].opacity, 0, 'finit cachée')
    assert.equal(marque(el), null, 'visible tant qu\'elle sort')
    sortie.finish()
    await attendre(() => marque(el) === 'rest')
    assert.equal(marque(el), 'rest', 'cachée de nouveau')
    assert.equal(sortie.cancelled, true, 'la tenue de la sortie est rendue : l\'entrée suivante lit la balise telle qu\'elle est')
  })

  it('un retournement en cours de route repart de l\'avancée courante : la souris qui revient pendant la sortie reprend d\'où elle en était', async () => {
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    envoie(carte, 'pointerenter')
    await attendre(() => jeux(el).length === 1)
    const entree = jeux(el)[0]
    entree.progress = 0.4
    envoie(carte, 'pointerleave')
    await attendre(() => jeux(el).length === 2)
    // la sortie part de 0,4 et va vers 0 ; sa tenue de départ (deux images) est à 0,4
    const tenue = tenues(el).pop()
    assert.ok(Math.abs(tenue.keyframes[0].opacity - 0.4) < 0.001, `la sortie part de 0,4 : ${tenue.keyframes[0].opacity}`)
    const sortie = jeux(el)[1]
    assert.ok(Math.abs(sortie.keyframes[0].opacity - 0.4) < 0.001)
    assert.ok(Math.abs(sortie.opts.duration - 0.4 * 300) < 0.5, `durée proportionnelle : ${sortie.opts.duration}`)
    assert.equal(entree.cancelled, true, 'l\'entrée interrompue est coupée')
    // la sortie en est à 0,25 : la souris revient, l'entrée repart de 0,25
    sortie.progress = 0.375
    envoie(carte, 'pointerenter')
    await attendre(() => jeux(el).length === 3)
    const reprise = jeux(el)[2]
    assert.ok(Math.abs(reprise.keyframes[0].opacity - 0.25) < 0.001, `l'entrée repart de 0,25 : ${reprise.keyframes[0].opacity}`)
    assert.equal(reprise.keyframes[reprise.keyframes.length - 1].opacity, 1)
    assert.equal(marque(el), null)
    // la sortie interrompue n'a pas fini : la suite de sa fin ne cache pas la balise
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(marque(el), null, 'la sortie coupée ne cache pas')
  })

  it('le focus compte : il entre dans le parent, la balise entre ; il en sort, elle sort ; d\'une balise du parent à une autre, rien ne bouge', async () => {
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    envoie(carte, 'focusin')
    await attendre(() => jeux(el).length === 1)
    assert.equal(jeux(el).length, 1)
    assert.equal(marque(el), null)
    jeux(el)[0].finish()
    await new Promise((r) => setTimeout(r, 10))
    // le focus passe à une balise du parent : le parent en garde le focus
    envoie(carte, 'focusout', { relatedTarget: el })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(jeux(el).length, 1, 'aucune sortie')
    // le focus quitte le parent
    envoie(carte, 'focusout', { relatedTarget: window.document.body })
    await attendre(() => jeux(el).length === 2)
    assert.equal(jeux(el)[1].keyframes[0].opacity, 1, 'la sortie joue')
    jeux(el)[1].finish()
    await attendre(() => marque(el) === 'rest')
    // la fenêtre perd le focus (relatedTarget absent) : même chose
    envoie(carte, 'focusin')
    await attendre(() => jeux(el).length === 3)
    assert.equal(jeux(el).length, 3)
    jeux(el)[2].finish()
    await new Promise((r) => setTimeout(r, 10))
    envoie(carte, 'focusout', { relatedTarget: null })
    await attendre(() => jeux(el).length === 4)
    assert.equal(jeux(el).length, 4)
  })

  it('souris et focus se cumulent : la balise ne sort que quand ni l\'un ni l\'autre ne la tient', async () => {
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    envoie(carte, 'pointerenter')
    envoie(carte, 'focusin')
    await attendre(() => jeux(el).length === 1)
    assert.equal(jeux(el).length, 1)
    jeux(el)[0].finish()
    await new Promise((r) => setTimeout(r, 10))
    envoie(carte, 'pointerleave')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(jeux(el).length, 1, 'le focus la tient')
    envoie(carte, 'focusout', { relatedTarget: null })
    await attendre(() => jeux(el).length === 2)
    assert.equal(jeux(el).length, 2, 'ni la souris ni le focus : elle sort')
  })

  it('au toucher : l\'appui sur le parent la fait entrer, le doigt levé n\'est pas une sortie, l\'appui ailleurs la fait sortir', async () => {
    ecouteurs.clear()
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    envoie(carte, 'pointerenter', { pointerType: 'touch' })
    await attendre(() => jeux(el).length === 1)
    assert.equal(marque(el), null, 'entrée à l\'appui')
    assert.ok(typesPosesSur(carte).includes('pointerdown'), 'les écouteurs de l\'appui ne sont posés que maintenant')
    assert.ok((ecouteurs.get(window.document)?.ajoute ?? []).includes('pointerdown'))
    jeux(el)[0].finish()
    await new Promise((r) => setTimeout(r, 10))
    // le doigt est levé : le navigateur dit `pointerleave` (toucher), rien ne sort
    envoie(carte, 'pointerleave', { pointerType: 'touch' })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(jeux(el).length, 1, 'le doigt levé n\'est pas une sortie')
    // un appui sur le parent : il reste ouvert (l'appui est celui du parent)
    envoie(el, 'pointerdown', { pointerType: 'touch' })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(jeux(el).length, 1, 'un appui dedans ne referme pas')
    // un appui ailleurs : elle sort, et les écouteurs de l'appui partent
    envoie(window.document.body, 'pointerdown', { pointerType: 'touch' })
    await attendre(() => jeux(el).length === 2)
    assert.equal(jeux(el)[1].keyframes[0].opacity, 1, 'la sortie joue')
    const retraits = (ecouteurs.get(carte)?.retire ?? []).filter((t) => t === 'pointerdown').length
    assert.equal(retraits, 1, 'l\'écouteur de l\'appui est retiré du parent')
    assert.ok((ecouteurs.get(window.document)?.retire ?? []).includes('pointerdown'), 'et de la page')
  })

  it('`of` : l\'ancêtre le plus proche qui vérifie le sélecteur tient lieu de parent ; sans ancêtre, ou illisible : le parent direct, et le dit', async () => {
    ecouteurs.clear()
    const { comp, el } = await pose('mjs-survol-of', '.b')
    const ligne   = comp._shadow.querySelector('.ligne')
    const actions = comp._shadow.querySelector('.actions')
    const c = comp._shadow.querySelector('.c')
    const d = comp._shadow.querySelector('.d')
    assert.deepEqual(typesPosesSur(ligne), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], '.b écoute la ligne')
    // les deux autres se rabattent sur leur parent direct, qui n'est autre que la boîte d'actions : un seul jeu d'écouteurs pour les deux
    assert.deepEqual(typesPosesSur(actions), ['focusin', 'focusout', 'pointerenter', 'pointerleave'])
    assert.equal(avertissements.length, 2, avertissements.join(' | '))
    assert.match(avertissements[0], /\.absent/)
    assert.match(avertissements[0], /^\[ModularJS\] \*scale : aucun ancêtre/)
    assert.match(avertissements[1], /\.\./)
    envoie(actions, 'pointerenter')
    await attendre(() => jeux(c).length === 1 && jeux(d).length === 1)
    assert.equal(jeux(el).length, 0, '.b ne suit pas sa boîte d\'actions')
    envoie(ligne, 'pointerenter')
    await attendre(() => jeux(el).length === 1)
  })

  it('une balise posée alors que le parent est déjà survolé entre aussitôt', async () => {
    window.document.body.innerHTML = '<mjs-survol-if></mjs-survol-if>'
    const comp = window.document.querySelector('mjs-survol-if')
    await attendre(() => !!comp._shadow?.querySelector('.l'))
    await new Promise((r) => setTimeout(r, 20))
    const carte = comp._shadow.querySelector('.carte')
    // la souris est sur la carte quand le bloc se referme puis se rouvre
    survolees.add(carte)
    comp._set('vu', false)
    await attendre(() => !comp._shadow.querySelector('.l'))
    anims.length = 0
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.l'))
    const el = comp._shadow.querySelector('.l')
    await attendre(() => jeux(el).length === 1)
    assert.equal(marque(el), null, 'visible, elle n\'attend pas un nouveau survol')
    assert.equal(jeux(el)[0].keyframes[0].opacity, 0, 'son entrée joue de cachée à nette')
  })

  it('une balise à la racine du composant : son parent est le composant', async () => {
    const { comp, el } = await pose('mjs-survol-racine', '.r')
    assert.equal(marque(el), 'rest')
    envoie(comp, 'pointerenter')
    await attendre(() => jeux(el).length === 1)
    assert.equal(marque(el), null)
    jeux(el)[0].finish()
    await new Promise((r) => setTimeout(r, 10))
    envoie(comp, 'pointerleave')
    await attendre(() => jeux(el).length === 2)
  })

  it('« réduire les animations » : elle apparaît et disparaît d\'un coup, aucune animation', async () => {
    reduit = true
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    envoie(carte, 'pointerenter')
    assert.equal(marque(el), null, 'visible tout de suite')
    envoie(carte, 'pointerleave')
    assert.equal(marque(el), 'rest', 'cachée tout de suite')
    envoie(carte, 'focusin')
    assert.equal(marque(el), null)
    envoie(carte, 'focusout', { relatedTarget: null })
    assert.equal(marque(el), 'rest')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(anims.filter((a) => a.el === el).length, 0, 'aucune animation, pas même une tenue')
  })

  it('le réglage tenu par une variable : le prochain jeu le prend, sans rejouer ; le déclencheur changé, l\'effet repart', async () => {
    const { comp, el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    const off = el._mjs_fxOff.fade
    comp._set('d', '900ms')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(el._mjs_fxOff.fade, off, 'même effet : rien ne repart')
    assert.equal(anims.length, 0, 'rien ne joue')
    envoie(carte, 'pointerenter')
    await attendre(() => jeux(el).length === 1)
    assert.equal(jeux(el)[0].opts.duration, 900, 'la durée nouvelle')
    // la variable change en plein jeu : le jeu en cours continue, ses suites prennent la nouvelle valeur
    comp._set('d', '100ms')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(jeux(el).length, 1)
    assert.equal(off._hot('on', 'view'), false, 'on : l\'effet doit repartir')
    assert.equal(off._hot('of', '.x'), false, 'of : l\'effet doit repartir')
    assert.equal(off._hot('once', false), true, 'once ne dit rien au survol')
    assert.equal(off._hot('zone', '70% 40%'), true, 'zone non plus')
    assert.equal(off._hot('range', '0 100px'), true, 'ni range')
  })

  it('le déclencheur tenu par une variable : passer de hover à view repose l\'effet, sans marque ni écouteur de survol', async () => {
    ecouteurs.clear()
    const { comp, el } = await pose('mjs-survol-carte', '.m')
    // posé d'abord sur `hover` (la valeur de départ de $o)
    assert.equal(marque(el), 'rest')
    assert.deepEqual(typesPosesSur(el.parentNode), ['focusin', 'focusout', 'pointerenter', 'pointerleave'])
    comp._set('o', 'load')
    await attendre(() => marque(el) === null)
    assert.equal(marque(el), null, 'la marque de repos est partie')
    const retire = ecouteurs.get(el.parentNode)!.retire.slice().sort()
    assert.deepEqual(retire, ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'les quatre écouteurs sont retirés du parent')
  })

  it('le retrait : un bloc {if} refermé pendant le survol ne laisse ni écouteur, ni marque, ni animation, ni suite qui cache la balise', async () => {
    ecouteurs.clear()
    const { comp, el } = await pose('mjs-survol-if', '.l')
    const carte = el.parentNode
    envoie(carte, 'pointerenter', { pointerType: 'touch' })
    await attendre(() => jeux(el).length === 1)
    comp._set('vu', false)
    await attendre(() => !comp._shadow.querySelector('.l'))
    await new Promise((r) => setTimeout(r, 40))
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [], 'ni marque ni attribut mjs-fx')
    assertAbsent(el._mjs_fxOff ?? null, 'l\'effet est retiré')
    assertAbsent(el._mjs_transition_state ?? null, 'plus de jeu en cours')
    const e = ecouteurs.get(carte)!
    // chaque écouteur posé est retiré : les quatre du repos, celui de l'appui
    assert.deepEqual(e.retire.slice().sort(), e.ajoute.slice().sort())
    assert.ok((ecouteurs.get(window.document)!.retire).includes('pointerdown'), 'celui de la page aussi')
    // plus aucun événement n'a de suite : la carte n'écoute plus
    const avant = anims.length
    envoie(carte, 'pointerleave')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(anims.length, avant)
  })

  it('dix balises dans la même carte : un seul jeu de quatre écouteurs sur la carte, et toutes suivent le survol', async () => {
    ecouteurs.clear()
    const { comp } = await pose('mjs-survol-dix', '.l9')
    const carte = comp._shadow.querySelector('.carte')
    assert.deepEqual(typesPosesSur(carte), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'dix balises, quatre écouteurs')
    assert.ok(ecouteurs.get(carte)!.passif.every(Boolean), 'écouteurs passifs')
    const balises = Array.from({ length: 10 }, (_, i) => comp._shadow.querySelector('.l' + i))
    envoie(carte, 'pointerenter', { pointerType: 'mouse' })
    await attendre(() => balises.every((b) => jeux(b).length === 1))
    assert.deepEqual(balises.map((b) => marque(b)), Array(10).fill(null), 'les dix sont ouvertes')
    balises.forEach((b) => jeux(b)[0].finish())
    await new Promise((r) => setTimeout(r, 20))
    envoie(carte, 'pointerleave', { pointerType: 'mouse' })
    await attendre(() => balises.every((b) => jeux(b).length === 2))
  })

  it('deux balises, un jeu : les écouteurs de la carte partent avec la dernière, pas avant', async () => {
    ecouteurs.clear()
    const { comp } = await pose('mjs-survol-deux', '.b')
    const carte = comp._shadow.querySelector('.carte')
    const b = comp._shadow.querySelector('.b')
    assert.deepEqual(typesPosesSur(carte), ['focusin', 'focusout', 'pointerenter', 'pointerleave'])
    comp._set('a', false)
    await attendre(() => !comp._shadow.querySelector('.a'))
    await new Promise((r) => setTimeout(r, 30))
    assert.deepEqual(ecouteurs.get(carte)!.retire, [], 'la première partie : la seconde écoute encore')
    envoie(carte, 'pointerenter', { pointerType: 'mouse' })
    await attendre(() => jeux(b).length === 1)
    comp._set('b', false)
    await attendre(() => !comp._shadow.querySelector('.b'))
    await new Promise((r) => setTimeout(r, 30))
    assert.deepEqual(ecouteurs.get(carte)!.retire.slice().sort(), ['focusin', 'focusout', 'pointerenter', 'pointerleave'], 'la dernière partie : les quatre sont retirés')
  })

  it('un effet retiré avant que la balise soit dans la page ne pose rien sur le parent', async () => {
    const { comp } = await pose('mjs-survol-carte', '.l')
    // une balise et un parent hors de la page : l'effet attend la mise en page de la balise
    const parent = window.document.createElement('div')
    window.document.body.appendChild(parent)
    const neuve = window.document.createElement('p')
    ecouteurs.clear()
    const stop = window.µ._mjs_fxDefs.fade.setup(neuve, { on: 'hover' }, comp)
    stop()
    // la balise entre dans la page après le retrait : personne ne l'attend plus
    parent.appendChild(neuve)
    await new Promise((r) => setTimeout(r, 120))
    assert.deepEqual(typesPosesSur(parent), [], 'aucun écouteur posé sur le parent après le retrait')
    assert.equal(marque(neuve), null, 'ni marque')
  })

  it('once, range et zone ne disent rien au survol : un avertissement, un seul, qui nomme ceux qui sont écrits', async () => {
    await pose('mjs-survol-ignores', '.l')
    assert.equal(avertissements.length, 1, avertissements.join(' | '))
    assert.match(avertissements[0], /^\[ModularJS\] \*fade : /)
    assert.match(avertissements[0], /once, zone/)
    assert.doesNotMatch(avertissements[0], /range/)
    assert.match(avertissements[0], /on: hover/)
  })

  it('of sans on: hover ne sert à rien : un avertissement, un seul, sur la balise qui l\'écrit', async () => {
    await pose('mjs-survol-of-seul', '.l')
    assert.equal(avertissements.length, 1, avertissements.join(' | '))
    assert.match(avertissements[0], /^\[ModularJS\] \*fade : /)
    assert.match(avertissements[0], /of/)
    assert.match(avertissements[0], /on: hover/)
  })

  it('souris et doigt ensemble : le doigt qui se lève, puis un appui ailleurs, ne retirent pas la souris', async () => {
    const { el } = await pose('mjs-survol-carte', '.l')
    const carte = el.parentNode
    envoie(carte, 'pointerenter', { pointerType: 'mouse' })
    await attendre(() => jeux(el).length === 1)
    jeux(el)[0].finish()
    await new Promise((r) => setTimeout(r, 10))
    // un doigt se pose sur la carte et se lève, la souris y est toujours
    envoie(carte, 'pointerenter', { pointerType: 'touch' })
    envoie(carte, 'pointerleave', { pointerType: 'touch' })
    // un appui ailleurs referme celui du doigt : la souris la tient encore
    envoie(window.document.body, 'pointerdown', { pointerType: 'touch' })
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(jeux(el).length, 1, 'aucune sortie : la souris est dans la carte')
    envoie(carte, 'pointerleave', { pointerType: 'mouse' })
    await attendre(() => jeux(el).length === 2)
  })

  it('sans `on: hover` rien ne change : une transition posée à l\'apparition ne pose ni marque ni écouteur sur son parent', async () => {
    ecouteurs.clear()
    const { el } = await pose('mjs-survol-direct', '.n')
    await attendre(() => anims.some((a) => a.el === el))
    assert.equal(marque(el), null)
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), ['mjs-fx'])
    assert.equal(typesPosesSur(el.parentNode).some((t) => /^(pointer|focus)/.test(t)), false, 'aucun écouteur de survol ni de focus')
  })
})
