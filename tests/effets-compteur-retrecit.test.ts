// *count : un nombre qui perd des chiffres (12 480 → 9). Pendant le décompte, le calque montre encore l'ancien
// nombre : la balise garde la place du plus large du départ et de l'arrivée (sans quoi le nombre déborde sur la suite
// du texte), puis prend d'un coup, à la dernière image, la place du nombre final — lue d'avance, au départ du
// décompte, jamais dans la boucle. Une nouvelle cible en plein décompte part du nombre affiché à cet instant.
// happy-dom ne met rien en page : l'aide de mesure est remplacée par une largeur fictive (un signe = 1em), ce qui
// éprouve QUELS nombres sont mesurés et QUAND la place s'écrit ; les largeurs réelles se voient au banc navigateur
// (effets-compteur-retrecit-browser.test.ts). La place est relevée à chaque tour tant que le calque n'a pas son texte
// final : aucune attente d'un instant précis, seulement ce qui doit être vrai à chaque image du décompte.

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
const FINE = '\u202f'

// a : 12 480 ; f : préfixe, suffixe et séparateur ; d : décimales ; g : un nombre qui gagne des chiffres (9 → 12 480) ;
// c : un compte à rebours dont le départ est plus long que l'arrivée, joué au clic puis rejoué ; w : un décompte joué au clic après un délai ;
// e : un départ aussi long que l'arrivée (1 000 → 5 000)
const SOURCE = `<b class="a" *count(on: load, duration: 400ms)>12480</b>
<b class="f" *count(on: load, duration: 400ms, separator: ".", prefix: "~ ", suffix: " €")>12480</b>
<b class="d" *count(on: load, duration: 400ms)>12480.5</b>
<b class="g" *count(on: load, duration: 400ms)>9</b>
<b class="c" *count(on: click, duration: 300ms, from: 1000)>5</b>
<b class="w" *count(on: click, delay: 200ms, duration: 100ms, from: 1000)>5</b>
<b class="e" *count(on: click, duration: 300ms, from: 1000)>5000</b>
`

describe('*count — un nombre qui perd des chiffres garde la place de l\'ancien jusqu\'à la fin du décompte', function () {
  this.timeout(60000)
  let window: any
  let rendreRects: (() => void) | undefined

  // chaque appel de l'aide de mesure : la balise (sa classe) et les nombres qu'on lui demande
  const appels: { classe: string, vals: number[] }[] = []
  const nombre = (classe: string) => appels.filter((x) => x.classe === classe).length

  before(async () => {
    const root   = mjsTmp('effets-compteur-retrecit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-retrecit.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    // la balise a toujours une boîte ; l'aide de mesure écrit la largeur du plus long des nombres, un signe = 1em
    // (le prototype des éléments est celui de toutes les fenêtres de happy-dom : la mesure y est rendue telle qu'elle était à la fin du groupe)
    const proto = window.Element.prototype
    const avant = Object.getOwnPropertyDescriptor(proto, 'getClientRects')
    rendreRects = () => {
      if (avant) Object.defineProperty(proto, 'getClientRects', avant)
      else delete proto.getClientRects
    }
    proto.getClientRects = function () { return [{ left: 0, top: 0, width: 10, height: 10 }] }
    window.µ._mjs_fxNumWidth = function (el: any, _node: any, vals: any[], fmt: any) {
      appels.push({ classe: el.className, vals: vals.slice() })
      let w = 0
      for (const v of vals) if (v !== null && v !== undefined) w = Math.max(w, fmt(v).length)
      if (w) el.style.minWidth = w + 'em'
    }
  })

  after(async () => {
    rendreRects?.()
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // le composant monté, ses compteurs posés
  async function pose() {
    appels.length = 0
    window.document.body.innerHTML = '<mjs-fx-retrecit></mjs-fx-retrecit>'
    const comp = window.document.querySelector('mjs-fx-retrecit')
    await attendre(() => comp._shadow?.querySelectorAll('[mjs-fx-layer="text"]').length === 7, 'les sept compteurs posés')
    const balise = (c: string) => comp._shadow.querySelector('.' + c)
    const calque = (c: string) => balise(c).querySelector('[mjs-fx-layer="text"]')
    const texte  = (c: string) => calque(c).textContent
    const place  = (c: string) => balise(c).style.minWidth
    // la balise change de nombre : le texte d'origine est réécrit, happy-dom en prévient l'effet au micro-tour qui suit (le calque est reconstruit)
    const ecrit  = async (c: string, v: string) => {
      balise(c).firstChild.nodeValue = v
      await Promise.resolve()
    }
    // le compte est arrivé au bout : le calque montre le texte final
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
    return { comp, balise, calque, texte, place, ecrit, fini, suit }
  }

  it('12 480 → 9 : la balise garde la place de « 12 480 » jusqu\'à la fin du décompte, puis prend d\'un coup celle de « 9 » — sans mesurer dans la boucle', async () => {
    const { place, ecrit, fini, suit } = await pose()
    await fini('a', `12${FINE}480`)
    await dort(20)
    assert.equal(place('a'), '6em', 'au repos, la place de « 12 480 »')
    await ecrit('a', '9')
    const mesures = nombre('a')
    assert.deepEqual(await suit('a', '9'), ['6em'], 'à chaque image du décompte, la balise garde la place de l\'ancien nombre')
    await dort(30)
    assert.equal(place('a'), '1em', 'à la fin, la place de « 9 »')
    assert.equal(nombre('a'), mesures, 'aucune mesure pendant le décompte ni à sa fin')
  })

  it('les mises en forme : préfixe, suffixe, séparateur et décimales se gardent aussi jusqu\'à la fin', async () => {
    const { place, ecrit, fini, suit } = await pose()
    await fini('f', '~ 12.480 €')
    await fini('d', `12${FINE}480,5`)
    await dort(20)
    assert.equal(place('f'), '10em')
    assert.equal(place('d'), '8em')
    await ecrit('f', '9')
    await ecrit('d', '9.5')
    // les deux décomptes se suivent ensemble : relevés l'un après l'autre, le second serait fini avant son premier tour
    const [pf, pd] = await Promise.all([suit('f', '~ 9 €'), suit('d', '9,5')])
    assert.deepEqual(pf, ['10em'], 'préfixe, suffixe et séparateur : la place de « ~ 12.480 € » pendant le décompte')
    assert.deepEqual(pd, ['8em'], 'décimales : la place de « 12 480,5 » pendant le décompte')
    await dort(30)
    assert.equal(place('f'), '5em', 'à la fin, la place de « ~ 9 € »')
    assert.equal(place('d'), '3em', 'à la fin, la place de « 9,5 »')
  })

  it('un nombre qui gagne des chiffres (9 → 12 480) : la place suit le nouveau nombre dès le départ du décompte, puis ne bouge plus', async () => {
    const { place, ecrit, fini, suit } = await pose()
    await fini('g', '9')
    await dort(20)
    assert.equal(place('g'), '1em')
    await ecrit('g', '12480')
    const mesures = nombre('g')
    assert.deepEqual(await suit('g', `12${FINE}480`), ['6em'], 'la place est celle de l\'arrivée dès le départ')
    await dort(30)
    assert.equal(place('g'), '6em', 'et elle ne change pas à la fin')
    assert.equal(nombre('g'), mesures, 'aucune mesure pendant le décompte')
  })

  it('une cible plus courte donnée en plein décompte : la place du plus large entre le nombre affiché à cet instant et la nouvelle arrivée', async () => {
    const { texte, place, ecrit, fini } = await pose()
    await fini('a', `12${FINE}480`)
    await ecrit('a', '9')
    // le décompte descend : on attend un nombre de cinq signes
    await attendre(() => texte('a').length === 5, 'un nombre de cinq signes')
    const affiche = texte('a')
    assert.equal(affiche.length, 5, 'un nombre de cinq signes est affiché')
    await ecrit('a', '3')
    assert.equal(place('a'), '5em', `la balise garde la place du nombre affiché (« ${affiche} »), plus large que « 3 », plus étroite que « 12 480 »`)
    const mesures = nombre('a')
    await fini('a', '3')
    await dort(30)
    assert.equal(place('a'), '1em', 'à la fin, la place de « 3 »')
    assert.equal(nombre('a'), mesures, 'aucune mesure pendant le décompte ni à sa fin')
  })

  it('une cible plus longue donnée en plein décompte : la place de la nouvelle arrivée, gardée jusqu\'à la fin', async () => {
    const { texte, place, ecrit, fini, suit } = await pose()
    await fini('a', `12${FINE}480`)
    await ecrit('a', '9')
    await attendre(() => texte('a').length === 5, 'un nombre de cinq signes')
    await ecrit('a', '500000')
    assert.equal(place('a'), '7em', 'la place de « 500 000 » dès le départ du nouveau décompte')
    assert.deepEqual(await suit('a', `500${FINE}000`), ['7em'], 'et pendant tout le décompte')
    await dort(30)
    assert.equal(place('a'), '7em', 'et elle ne change pas à la fin')
  })

  it('un départ plus long que l\'arrivée dès le premier décompte (1 000 → 5) : la place du départ, puis celle de l\'arrivée à la fin ; rejoué, la place du départ est reprise', async () => {
    const { comp, texte, place, suit } = await pose()
    const clic = () => comp._shadow.querySelector('.c').dispatchEvent(new window.Event('click'))
    assert.equal(texte('c'), `1${FINE}000`, 'avant le clic, le calque montre le départ')
    assert.equal(place('c'), '5em', 'la balise a la place de « 1 000 »')
    clic()
    assert.deepEqual(await suit('c', '5'), ['5em'], 'pendant le premier décompte')
    await dort(30)
    assert.equal(place('c'), '1em', 'à la fin, la place de « 5 »')
    const mesures = nombre('c')
    clic()
    await attendre(() => texte('c') !== '5', 'le rejeu quitte « 5 »')
    assert.equal(place('c'), '5em', 'le rejeu repart de « 1 000 » : la place du départ est reprise')
    const reprises = nombre('c')
    assert.ok(reprises > mesures, 'et elle est mesurée au départ du rejeu')
    assert.deepEqual(await suit('c', '5'), ['5em'], 'pendant le rejeu')
    await dort(30)
    assert.equal(place('c'), '1em', 'à la fin du rejeu, la place de « 5 »')
    assert.equal(nombre('c'), reprises, 'aucune mesure pendant le rejeu ni à sa fin')
  })

  it('un départ aussi long que l\'arrivée (1 000 → 5 000) : la place de l\'arrivée seule n\'est pas lue — la comparaison est « strictement plus long »', async () => {
    const { place } = await pose()
    assert.equal(place('e'), '5em', 'la place de « 1 000 » et de « 5 000 »')
    assert.deepEqual(appels.filter((x) => x.classe === 'e' && x.vals.length === 1), [], 'aucune lecture de l\'arrivée seule : le départ n\'est pas plus long')
    assert.ok(nombre('e') >= 1, 'la balise est bien mesurée')
  })

  it('une police qui arrive en plein décompte, puis après sa fin : la mesure reprise suit l\'état du décompte — l\'ancien nombre ne reprend pas la place une fois le décompte fini', async () => {
    const polices: any = new window.EventTarget()
    polices.ready = Promise.resolve()
    Object.defineProperty(window.document, 'fonts', { value: polices, configurable: true })
    try {
      const { texte, place, ecrit, fini } = await pose()
      await fini('a', `12${FINE}480`)
      await ecrit('a', '9')
      await attendre(() => texte('a').length === 5, 'un nombre de cinq signes')
      const mesures = nombre('a')
      polices.dispatchEvent(new window.Event('loadingdone'))
      assert.ok(nombre('a') > mesures, 'la police fait reprendre la mesure')
      assert.equal(place('a'), '6em', 'en plein décompte, la balise a toujours la place de l\'ancien nombre')
      await fini('a', '9')
      await dort(30)
      assert.equal(place('a'), '1em', 'la fin du décompte a rendu la place')
      polices.dispatchEvent(new window.Event('loadingdone'))
      assert.equal(place('a'), '1em', 'une police arrivée après la fin ne rend pas à la balise la place de l\'ancien nombre')
    }
    finally {
      Object.defineProperty(window.document, 'fonts', { value: undefined, configurable: true })
    }
  })

  it('« réduire les animations » : le nombre final tout de suite, à sa largeur', async () => {
    const calme = window.µ._mjs_fxCalm
    window.µ._mjs_fxCalm = () => true
    try {
      const { texte, place, ecrit, fini } = await pose()
      await fini('a', `12${FINE}480`)
      await dort(20)
      assert.equal(place('a'), '6em')
      await ecrit('a', '9')
      await fini('a', '9')
      await dort(20)
      assert.equal(place('a'), '1em', 'le nombre final est écrit, la balise a sa largeur')
      assert.equal(texte('a'), '9')
    }
    finally {
      window.µ._mjs_fxCalm = calme
    }
  })

  it('retiré pendant le délai d\'un décompte joué au clic : la minuterie est annulée, le nombre ne change pas et rien ne se mesure', async () => {
    const { comp, balise, calque, place } = await pose()
    const el = balise('w')
    const ca = calque('w')
    assert.equal(ca.textContent, `1${FINE}000`, 'avant le clic, le calque montre le départ')
    assert.equal(place('w'), '5em', 'la place du départ est tenue')
    comp._shadow.querySelector('.w').dispatchEvent(new window.Event('click'))
    window.document.body.innerHTML = ''
    await dort(30)
    const mesures = nombre('w')
    await dort(350)
    assert.equal(ca.textContent, `1${FINE}000`, 'le délai écoulé, aucun décompte ne part')
    assert.equal(el.style.minWidth, '', 'la place est rendue')
    assert.equal(nombre('w'), mesures, 'et rien ne se mesure')
  })

  it('retiré en plein décompte : plus de mesure, plus d\'image, la place d\'origine rendue', async () => {
    const { balise, calque, texte, place, ecrit, fini } = await pose()
    await fini('a', `12${FINE}480`)
    await ecrit('a', '9')
    await attendre(() => texte('a').length === 5, 'un nombre de cinq signes')
    assert.notEqual(place('a'), '', 'en plein décompte, une place est écrite')
    const el = balise('a')
    const ca = calque('a')
    window.document.body.innerHTML = ''
    await dort(30)
    const mesures = nombre('a')
    const vu      = ca.textContent
    await dort(150)
    assert.equal(el.style.minWidth, '', 'la place est rendue')
    assert.equal(el.style.cssText, '', 'aucun style en ligne ne reste')
    assert.deepEqual(Array.from(el.attributes).map((a: any) => a.name).filter((n: string) => n.startsWith('mjs-fx')), [], 'aucune marque ne reste')
    assert.equal(ca.textContent, vu, 'le décompte ne tourne plus')
    assert.equal(nombre('a'), mesures, 'plus aucune mesure')
  })
})
