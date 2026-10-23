// *count : les nombres INTERMÉDIAIRES d'un décompte peuvent être plus larges que ses deux bouts (chiffres proportionnels : « 10 523 » est plus
// large que « 11 111 » ; le noyau « 11 » étrécit aussi un nombre de 1). Pendant un décompte la balise garde donc la place du nombre le plus large
// possible du même gabarit — le plus long des deux bouts mis en forme, chaque chiffre de sa partie nombre (ni préfixe ni suffixe) remplacé par
// le chiffre le plus large de la police —, puis, à la dernière image, la place du nombre final. Les dix chiffres se lisent une seule fois par
// police (la clé suit la police et le nombre de polices web arrivées), jamais par balise ni par image ; la place du nombre final se lit d'avance,
// au départ du décompte, parce que le gabarit tenu pendant le décompte est plus large que lui (chiffres de largeurs inégales, noyau « 11 »).
// happy-dom ne met rien en page : la boîte d'un Range reçoit une largeur fictive (un chiffre 12 px, le « 1 » 4 px dans la police A ; la police B a un
// « 7 » de 14 px), ce qui éprouve QUELS textes sont mesurés, QUAND, et la place qui en résulte ; les largeurs réelles se voient au banc
// navigateur (effets-compteur-gabarit-browser.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// attend que `cond` soit vraie ; un délai dépassé est une erreur (une attente muette ferait passer un test qui n'a rien vu)
async function attendre(cond: () => boolean, quoi: string, ms = 8000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 4))
  if (!cond()) throw new Error(`délai dépassé : ${quoi}`)
}

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

// l'espace fine insécable (U+202F) que le séparateur par défaut écrit entre les milliers
const FINE = ' '

// b : 12 480 qui monte de 0 (police A) ; f : préfixe et suffixe qui portent des chiffres ; g : un compte à rebours de 11 111 vers 888 joué au clic ;
// h : un compte à rebours sans boîte (caché) ; z : 12 480 jamais joué, passé dans la police B par le test
const SOURCE = `<b class="b" *count(on: load, duration: 400ms)>12480</b>
<b class="f" *count(on: load, duration: 400ms, prefix: "N1 ", suffix: " m2")>12480</b>
<b class="g" *count(on: click, duration: 300ms, from: 11111)>888</b>
<b class="h" *count(on: click, duration: 300ms, from: 1000)>5</b>
<b class="z" *count(on: click, duration: 400ms)>12480</b>
`

// la largeur fictive d'un caractère dans une police : 12 px un chiffre, 4 px une espace fine ou une ponctuation, 8 px le reste
const LARGEURS: Record<string, (c: string) => number> = {
  A: (c) => /\d/.test(c) ? (c === '1' ? 4 : 12) : /[ ,.]/.test(c) ? 4 : 8,
  B: (c) => /\d/.test(c) ? (c === '7' ? 14 : c === '1' ? 6 : 12) : /[ ,.]/.test(c) ? 4 : 8
}

describe('*count — la place d\'un décompte est celle du nombre le plus large possible de son gabarit', function () {
  this.timeout(60000)
  let window: any
  let rendreRects: (() => void) | undefined

  // chaque appel de l'aide de mesure : la balise (sa classe) et les textes qu'on lui demande de mesurer (une valeur → son texte mis en forme)
  const appels: { classe: string, textes: string[] }[] = []
  // les lectures de la boîte d'un chiffre seul (un Range sur un nœud texte d'un calque), hors balise cachée
  let chiffres = 0
  // `document.fonts` d'essai : des polices web qui arrivent (leur `status` passe à `loaded`) et l'événement qui le dit
  const polices: any = {}
  // la lecture des chiffres se garde d'un test à l'autre (une page, une lecture par police) : chaque test a sa clé, par le nombre de polices web déjà arrivées
  let epoque = 0

  const police = (n: any): string => {
    for (let e = n; e; e = e.parentNode) {
      const f = e.style && e.style.fontFamily
      if (f) return f
    }
    return 'A'
  }
  const cache = (n: any): boolean => {
    for (let e = n; e; e = e.parentNode) if (e.className === 'h') return true
    return false
  }

  before(async () => {
    const root   = mjsTmp('effets-compteur-gabarit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-gabarit.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // `document.fonts` : un jeu de deux polices web, chargées ou non
    const cible = new window.EventTarget()
    polices.faces   = []
    polices.status  = 'loaded'
    polices.ready   = Promise.resolve()
    polices.forEach = (f: any) => polices.faces.forEach(f)
    polices.addEventListener    = cible.addEventListener.bind(cible)
    polices.removeEventListener = cible.removeEventListener.bind(cible)
    polices.dispatchEvent       = cible.dispatchEvent.bind(cible)
    Object.defineProperty(window.document, 'fonts', { value: polices, configurable: true })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    // les boîtes : la balise en a une (sauf la balise cachée) ; un Range a la largeur de son texte dans la police de son nœud, nulle si la balise est cachée
    // (le prototype des éléments est celui de toutes les fenêtres de happy-dom : la mesure y est rendue telle qu'elle était à la fin du groupe ; celui de Range est à la seule fenêtre du groupe)
    const proto = window.Element.prototype
    const avant = Object.getOwnPropertyDescriptor(proto, 'getClientRects')
    rendreRects = () => {
      if (avant) Object.defineProperty(proto, 'getClientRects', avant)
      else delete proto.getClientRects
    }
    proto.getClientRects = function () { return cache(this) ? [] : [{ left: 0, top: 0, width: 10, height: 10 }] }
    window.Range.prototype.getBoundingClientRect = function () {
      const n = this.commonAncestorContainer
      if (cache(n)) return { width: 0 }
      if (n.nodeType === 3 && /^\d$/.test(this.toString())) chiffres++
      const f = LARGEURS[police(n)] || LARGEURS.A
      let w = 0
      for (const c of this.toString()) w += f(c)
      return { width: w }
    }
    // l'aide de mesure d'origine, espionnée : les textes qu'on lui fait mesurer
    const reel = window.µ._mjs_fxNumWidth
    window.µ._mjs_fxNumWidth = function (this: any, el: any, node: any, vals: any[], fmt: any) {
      appels.push({ classe: el.className, textes: vals.map((v: any) => fmt(v)) })
      return reel.call(this, el, node, vals, fmt)
    }
  })

  after(async () => {
    rendreRects?.()
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // le composant monté, ses compteurs posés ; deux polices web restent à arriver (dix polices déjà arrivées de plus à chaque test : une clé neuve)
  async function pose() {
    appels.length = 0
    chiffres = 0
    epoque++
    polices.faces = [...Array(epoque * 10).fill(0).map(() => ({ status: 'loaded' })), { status: 'unloaded' }, { status: 'unloaded' }]
    window.document.body.innerHTML = '<mjs-fx-gabarit></mjs-fx-gabarit>'
    const comp = window.document.querySelector('mjs-fx-gabarit')
    await attendre(() => comp._shadow?.querySelectorAll('[mjs-fx-layer="text"]').length === 5, 'les cinq compteurs posés')
    const balise = (c: string) => comp._shadow.querySelector('.' + c)
    const calque = (c: string) => balise(c).querySelector('[mjs-fx-layer="text"]')
    const texte  = (c: string) => calque(c).textContent
    const place  = (c: string) => balise(c).style.minWidth
    const fini   = (c: string, final: string) => attendre(() => texte(c) === final, `le texte final « ${final} » de la balise ${c}`)
    // la place relevée à chaque tour tant que le calque n'a pas son texte final (le calque vide entre deux constructions n'est pas compté)
    const suit   = async (c: string, final: string) => {
      const vues = new Set<string>()
      const fin  = Date.now() + 8000
      while (texte(c) !== final && Date.now() < fin) {
        if (texte(c) !== '') vues.add(place(c))
        await dort(4)
      }
      if (texte(c) !== final) throw new Error(`délai dépassé : le texte final « ${final} » de la balise ${c}`)
      return [...vues]
    }
    // les mesures d'une balise
    const mesures = (c: string) => appels.filter((x) => x.classe === c)
    // une police arrive : ses faces passent à « chargées » et l'événement part
    const arrive = (faces = 2) => {
      polices.faces.slice(-2).forEach((f: any, i: number) => { if (i < faces) f.status = 'loaded' })
      polices.dispatchEvent(new window.Event('loadingdone'))
    }
    const change = (c: string, f: string) => { balise(c).style.fontFamily = f }
    return { comp, balise, calque, texte, place, fini, suit, mesures, arrive, change, police }
  }

  it('11 111 → 888 : la balise mesure « 00 000 » (le plus long des deux bouts, chaque chiffre au plus large), jamais « 11 111 », et garde sa place jusqu\'à la dernière image', async () => {
    const { comp, place, mesures, suit } = await pose()
    const textes = mesures('g').map((x) => x.textes.join(' | '))
    assert.deepEqual(textes.slice(0, 2), ['888', `00${FINE}000`], 'la place de l\'arrivée seule, lue d\'avance, puis celle du gabarit du plus long des deux bouts')
    assert.ok(!textes.some((t) => t.includes(`11${FINE}111`)), 'le nombre de départ tel quel n\'est jamais mesuré : il est plus étroit que ses voisins')
    assert.equal(place('g'), '4.0000em', 'au repos, la place de « 00 000 » (64 px)')
    comp._shadow.querySelector('.g').dispatchEvent(new window.Event('click'))
    assert.deepEqual(await suit('g', '888'), ['4.0000em'], 'à chaque image du décompte, la place de « 00 000 »')
    await dort(30)
    assert.equal(place('g'), '2.2500em', 'à la fin, la place de « 888 » (36 px)')
  })

  it('0 → 12 480 : la place tenue pendant le décompte est celle de « 00 000 », puis, à la fin, celle de « 12 480 » lue d\'avance — pas plus large que le nombre', async () => {
    const { place, mesures, suit, fini } = await pose()
    const textes = mesures('b').map((x) => x.textes.join(' | '))
    assert.deepEqual(textes.slice(0, 2), [`12${FINE}480`, `00${FINE}000`], 'la place de l\'arrivée seule, puis celle du gabarit du plus long des deux bouts (« 0 » est plus court)')
    assert.deepEqual(await suit('b', `12${FINE}480`), ['4.0000em'], 'pendant le décompte, la place de « 00 000 »')
    await fini('b', `12${FINE}480`)
    await dort(30)
    assert.equal(place('b'), '3.5000em', 'à la fin, la place de « 12 480 » (56 px) — pas celle de « 00 000 » (64 px)')
  })

  it('le préfixe et le suffixe ne sont jamais touchés : seuls les chiffres de la partie nombre prennent le chiffre le plus large', async () => {
    const { mesures } = await pose()
    const textes = mesures('f').map((x) => x.textes.join(' | '))
    assert.deepEqual(textes.slice(0, 2), [`N1 12${FINE}480 m2`, `N1 00${FINE}000 m2`], `le « 1 » et le « 2 » des affixes restent (« ${textes.join(' ; ')} »)`)
  })

  it('le chiffre le plus large se lit dans la police de la balise : « 7 » dans la police B, « 0 » (le premier des plus larges) dans la police A', async () => {
    const { mesures, change, arrive } = await pose()
    assert.ok(mesures('b').some((x) => x.textes.join(' | ') === `00${FINE}000`), 'la police A prend le « 0 », le premier des chiffres les plus larges')
    change('z', 'B')
    const avant = mesures('z').length
    arrive()
    const apres = mesures('z').slice(avant).map((x) => x.textes.join(' | '))
    assert.ok(apres.includes(`77${FINE}777`), `la police B a son « 7 » pour gabarit (« ${apres.join(' ; ')} »)`)
  })

  it('les dix chiffres se lisent une seule fois par police : cinq balises, deux polices — vingt lectures ; un événement de police sans police nouvelle n\'en relit aucune ; une police qui arrive les relit une fois par police', async () => {
    const { change, arrive } = await pose()
    assert.equal(chiffres, 10, 'à la pose : les dix chiffres de la police A, pas dix par balise')
    change('z', 'B')
    window.document.fonts.dispatchEvent(new window.Event('loadingdone'))
    assert.equal(chiffres, 20, 'la police B : dix chiffres de plus')
    window.document.fonts.dispatchEvent(new window.Event('loadingdone'))
    assert.equal(chiffres, 20, 'un événement sans police nouvelle ne relit rien')
    arrive()
    assert.equal(chiffres, 40, 'une police qui arrive : les dix chiffres de chacune des deux polices, relus une fois (pas une fois par balise)')
  })

  it('un décompte ne lit aucun chiffre : ni à l\'image, ni à sa fin', async () => {
    const { comp, fini } = await pose()
    const lus = chiffres
    comp._shadow.querySelector('.g').dispatchEvent(new window.Event('click'))
    await fini('g', '888')
    await fini('b', `12${FINE}480`)
    await dort(30)
    assert.equal(chiffres, lus)
  })

  it('un compte à rebours sans boîte (balise cachée) : la place déjà écrite n\'est pas effacée à la fin du décompte, la place de l\'arrivée n\'étant pas connue', async () => {
    const { comp, balise, texte, fini } = await pose()
    balise('h').style.minWidth = '99em'
    comp._shadow.querySelector('.h').dispatchEvent(new window.Event('click'))
    await attendre(() => texte('h') !== `1${FINE}000`, 'le décompte part')
    await fini('h', '5')
    await dort(30)
    assert.equal(balise('h').style.minWidth, '99em', 'la place écrite avant que la boîte disparaisse est gardée')
  })
})
