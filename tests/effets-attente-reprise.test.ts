// Un effet en attente — son fichier n'est pas arrivé, ou le composant qui porte sa balise n'est pas
// encore défini — doit survivre à ce qui se passe pendant l'attente :
//   - plusieurs composants posent le même effet sur la même balise (<@document *ripple>) : quand le
//     plus récent part avant l'arrivée, le plus ancien, toujours affiché, a son effet ;
//   - la balise hors du document quand son composant arrive (page mise de côté par le cache de pages),
//     remise ensuite : son effet se pose à sa reconnexion ;
//   - un composant qui n'arrive jamais n'empile pas une attente par rendu, le retrait de la balise
//     annule l'attente, et ni la balise ni son composant ne sont retenus ;
//   - une erreur au setup d'un effet posé à son arrivée sort par la console, pas par un rejet non géré.
// happy-dom ne met pas une balise à niveau sur place : les scénarios de balise détachée posent son
// shadow root à la main, comme le ferait le navigateur à sa réinsertion.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// un ramasse-miettes appelable sans lancer node avec --expose-gc
v8.setFlagsFromString('--expose-gc')
const gc: () => void = vm.runInNewContext('gc')

async function liberee(ref: WeakRef<object>): Promise<boolean> {
  for (let i = 0; i < 40 && ref.deref(); i++) {
    await new Promise((r) => setTimeout(r, 5))
    gc()
  }
  return ref.deref() === undefined
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const REGLE = { color: ['c', 'color'] }

describe('effet en attente — plusieurs appels, balise mise de côté, composant qui n\'arrive jamais', function () {
  this.timeout(120000)
  let files: string[] = []
  let lire: (f: string) => string
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2

  before(async () => {
    const root   = mjsTmp('effets-attente-reprise')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-neon.mjs'), '<b class="n" *neon(#0ff)>x</b>')
    for (const n of ['pa', 'pb']) writeFileSync(join(srcDir, n + '.mjs'), '<@document *ripple(#f00, size: 60)></@document>\n<p>' + n + '</p>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  // une page : le cœur, les fichiers d'effets et les composants, sauf ceux qui ne sont pas encore arrivés
  function fenetre(sauf: RegExp | null = null) {
    const window: any = new Window({ url: 'http://localhost/' })
    const code = files.filter((f) => !(sauf && sauf.test(f))).sort((a, b) => rang(a) - rang(b)).map(lire).join('\n')
    window.eval(`${code}\nglobalThis.µ = µ;`)
    return window
  }

  // le fichier de l'effet `neon` en route : l'effet n'est pas encore connu du moteur, `arrive()` le rend
  function enRoute(window: any) {
    const µ    = window.µ
    const def  = µ._mjs_fxDefs.neon
    const need = µ._mjs_fxNeed
    let fin: () => void = () => {}
    const promesse = new Promise<void>((ok) => { fin = ok })
    delete µ._mjs_fxDefs.neon
    µ._mjs_fxNeed = () => promesse
    return { arrive: () => { µ._mjs_fxDefs.neon = def; µ._mjs_fxNeed = need; fin() } }
  }

  // la définition du composant `mjs-x`, comme le navigateur la rend : la balise est mise à niveau (son
  // shadow root) avant que `whenDefined` ne passe
  function definir(window: any, balises: any[]) {
    window.customElements.define('mjs-x', class extends window.HTMLElement {})
    for (const b of balises) b._shadow = b.attachShadow({ mode: 'open' })
  }

  const couleur = (el: any) => el.style.getPropertyValue('--mjs-neon-color').trim().toLowerCase()

  for (const annule of ['dernier', 'premier', 'milieu'] as const) {
    it(`fichier en route, trois composants posent le même effet, le ${annule} part avant l'arrivée : l'effet est posé, tenu par ceux qui restent`, async () => {
      const window = fenetre()
      try {
        const µ = window.µ
        const { arrive } = enRoute(window)
        const b = window.document.createElement('b')
        window.document.body.appendChild(b)
        const cs: any[] = [{}, {}, {}]
        const hs = cs.map((c, i) => µ._mjs_fx(c, b, 'neon', {}, { color: ['#ff0000', '#00ff00', '#0000ff'][i] }, REGLE))
        const part = { dernier: [2], premier: [0], milieu: [1] }[annule]
        for (const i of part) hs[i]()
        arrive()
        await pause(20)
        assert.equal(b.getAttribute('mjs-fx'), 'neon', 'l\'effet est posé')
        const restent = [0, 1, 2].filter((i) => !part.includes(i))
        for (const i of restent) assert.equal(cs[i]._mjs_attachments?.size, 1, `le composant ${i} tient l'effet`)
        for (const i of part) assert.equal(cs[i]._mjs_attachments?.size ?? 0, 0, `le composant ${i}, parti, ne le tient pas`)
        assert.equal(couleur(b), ['#ff0000', '#00ff00', '#0000ff'][restent[restent.length - 1]], 'les valeurs du dernier appel resté')
        // le dernier composant qui reste le lâche : l'effet part
        for (const i of restent) hs[i]()
        assert.equal(b.hasAttribute('mjs-fx'), false, 'plus personne : l\'effet est retiré')
      }
      finally {
        window.close()
      }
    })
  }

  it('fichier en route : un composant qui rappelle l\'effet à chaque rendu garde UNE attente, avec ses dernières valeurs', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      const { arrive } = enRoute(window)
      const b = window.document.createElement('b')
      window.document.body.appendChild(b)
      const c: any = {}
      for (let i = 0; i < 50; i++) µ._mjs_fx(c, b, 'neon', {}, { color: i % 2 ? '#111111' : '#222222' }, REGLE)
      µ._mjs_fxSet(b, 'neon', { color: '#333333' }, REGLE)
      assert.equal(Object.keys(b._mjs_fxWait).length, 1, 'une seule attente pour l\'effet')
      arrive()
      await pause(20)
      assert.equal(couleur(b), '#333333', 'la dernière valeur écrite')
      assert.equal(c._mjs_attachments.size, 1, 'une seule poignée')
    }
    finally {
      window.close()
    }
  })

  it('deux composants posent <@document *ripple> ; le second part avant l\'arrivée du fichier : le premier a son effet', async () => {
    const window = fenetre(/^mjs_fx_ripple/)
    try {
      const µ = window.µ
      let arrive: () => void = () => {}
      const promesse = new Promise<void>((ok) => { arrive = ok })
      µ.paths = { mjs_fx_ripple: 'r.js' }
      µ._mjs_fxImport = () => promesse
      window.document.body.innerHTML = '<mjs-pa></mjs-pa><mjs-pb></mjs-pb>'
      await pause(50)
      window.document.querySelector('mjs-pb').remove()
      window.eval(files.filter((f) => /^mjs_fx_ripple/.test(f)).map(lire).join('\n'))
      arrive()
      await pause(50)
      assert.ok((window.document.documentElement.getAttribute('mjs-fx') || '').includes('ripple'), 'le composant resté affiché a son effet')
    }
    finally {
      window.close()
    }
  })

  it('composant pas encore défini, deux composants posent le même effet, le dernier part avant la définition : l\'effet est posé pour le premier', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      const c1: any = {}
      const c2: any = {}
      µ._mjs_fx(c1, el, 'neon', {}, { color: '#ff0000' }, REGLE)
      const h2 = µ._mjs_fx(c2, el, 'neon', {}, { color: '#0000ff' }, REGLE)
      assert.equal(el.hasAttribute('mjs-fx'), false, 'rien de posé tant que le composant n\'est pas là')
      h2()
      definir(window, [el])
      await pause(20)
      assert.equal(el.getAttribute('mjs-fx'), 'neon', 'l\'effet est posé')
      assert.equal(couleur(el), '#ff0000', 'avec les valeurs du composant resté')
      assert.equal(c1._mjs_attachments?.size, 1, 'le premier le tient')
    }
    finally {
      window.close()
    }
  })

  it('fichier de l\'effet en route ET composant pas encore défini : l\'effet attend les deux, puis il est posé, tenu par les deux composants', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const { arrive } = enRoute(window)
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      const c1: any = {}
      const c2: any = {}
      µ._mjs_fx(c1, el, 'neon', {}, { color: '#ff0000' }, REGLE)
      µ._mjs_fx(c2, el, 'neon', {}, { color: '#0000ff' }, REGLE)
      arrive()
      await pause(20)
      assert.equal(el.hasAttribute('mjs-fx'), false, 'le fichier est là, pas le composant : rien de posé')
      assert.equal(Object.keys(el._mjs_fxWait).length, 1, 'une seule attente, toujours là')
      definir(window, [el])
      await pause(20)
      assert.equal(el.getAttribute('mjs-fx'), 'neon', 'l\'effet est posé')
      assert.equal(couleur(el), '#0000ff', 'avec les valeurs du plus récent appel')
      assert.equal(c1._mjs_attachments?.size, 1, 'le premier le tient')
      assert.equal(c2._mjs_attachments?.size, 1, 'le second aussi')
    }
    finally {
      window.close()
    }
  })

  it('balise hors du document quand son composant arrive, remise ensuite : *neon se pose à sa reconnexion, avec la dernière valeur de sa variable', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      µ._mjs_fx(null, el, 'neon', {}, { color: '#ff0000' }, REGLE)
      el.remove()
      window.customElements.define('mjs-x', class extends window.HTMLElement {})
      await pause(20)
      assert.equal(el.hasAttribute('mjs-fx'), false, 'rien de posé tant que la balise est hors du document')
      µ._mjs_fxSet(el, 'neon', { color: '#00ff00' }, REGLE)
      window.document.body.appendChild(el)
      await pause(20)
      assert.equal(el.getAttribute('mjs-fx'), 'neon', 'l\'effet se pose à la reconnexion')
      assert.equal(couleur(el), '#00ff00', 'la dernière valeur de la variable')
    }
    finally {
      window.close()
    }
  })

  it('balise hors du document qui ne revient jamais : rien n\'est posé, rien n\'est retenu', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      let el: any = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      let comp: any = { nom: 'parent' }
      const refEl = new WeakRef(el)
      const refComp = new WeakRef(comp)
      µ._mjs_fx(comp, el, 'neon', {})
      el.remove()
      window.customElements.define('mjs-x', class extends window.HTMLElement {})
      await pause(20)
      el = null
      comp = null
      assert.equal(await liberee(refEl), true, 'la balise est libérée')
      assert.equal(await liberee(refComp), true, 'son composant aussi')
    }
    finally {
      window.close()
    }
  })

  it('composant qui n\'arrive jamais : 200 rendus = UNE attente accrochée à la définition', () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      let pendants = 0
      const orig = window.customElements.whenDefined.bind(window.customElements)
      window.customElements.whenDefined = (n: string) => {
        const p = orig(n)
        return { then(a: any, b: any) { pendants++; return p.then(a, b) } }
      }
      for (let i = 0; i < 200; i++) µ._mjs_fx(null, el, 'neon', {})
      assert.equal(pendants, 1, `rappels accrochés à whenDefined : ${pendants}`)
    }
    finally {
      window.close()
    }
  })

  it('µ._mjs_fxClear annule l\'attente : rien n\'est posé à l\'arrivée du composant', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      for (let i = 0; i < 5; i++) µ._mjs_fx(null, el, 'neon', {})
      µ._mjs_fxClear(el)
      assert.equal(Object.keys(el._mjs_fxWait || {}).length, 0, 'plus d\'attente sur la balise')
      definir(window, [el])
      await pause(20)
      assert.equal(el.hasAttribute('mjs-fx'), false, 'aucun effet posé')
      assert.equal(!!(el._mjs_fxOff && el._mjs_fxOff.neon), false, 'aucun effet vivant')
    }
    finally {
      window.close()
    }
  })

  it('µ._mjs_fxClear : le composant parent n\'est plus retenu par l\'attente', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      let parent: any = { nom: 'parent' }
      const ref = new WeakRef(parent)
      for (let i = 0; i < 200; i++) µ._mjs_fx(parent, el, 'neon', {})
      µ._mjs_fxClear(el)
      parent = null
      assert.equal(await liberee(ref), true, 'le composant parent est libéré')
    }
    finally {
      window.close()
    }
  })

  it('balise retirée sans passer par µ._mjs_fxClear : ni elle ni son composant ne sont retenus par l\'attente', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      let el: any = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      let parent: any = { nom: 'parent' }
      const refEl = new WeakRef(el)
      const refParent = new WeakRef(parent)
      for (let i = 0; i < 200; i++) µ._mjs_fx(parent, el, 'neon', {})
      el.remove()
      el = null
      parent = null
      assert.equal(await liberee(refEl), true, 'la balise est libérée')
      assert.equal(await liberee(refParent), true, 'son composant aussi')
    }
    finally {
      window.close()
    }
  })

  it('erreur au setup d\'un effet posé à l\'arrivée de son fichier : aucun rejet non géré, l\'erreur sort par µ.error', async () => {
    const window = fenetre()
    const rejets: unknown[] = []
    const anciens = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', (e) => { rejets.push(e) })
    try {
      const µ = window.µ
      const erreurs: any[][] = []
      µ.error = (...a: any[]) => { erreurs.push(a) }
      let arrive: () => void = () => {}
      const promesse = new Promise<void>((ok) => { arrive = ok })
      µ._mjs_fxNeed = () => promesse
      const b = window.document.createElement('b')
      window.document.body.appendChild(b)
      µ._mjs_fx({}, b, 'boum', {})
      µ._mjs_fxDefs.boum = { css: '', setup() { throw new Error('boum de setup') } }
      arrive()
      await pause(40)
      assert.deepEqual(rejets, [], 'aucun rejet non géré')
      assert.equal(erreurs.some((a) => a.some((x) => x instanceof Error && x.message === 'boum de setup')), true, 'l\'erreur est écrite par µ.error')
    }
    finally {
      process.removeAllListeners('unhandledRejection')
      for (const f of anciens) process.on('unhandledRejection', f as any)
      window.close()
    }
  })

  it('erreur au setup d\'un effet posé à la définition de son composant : aucun rejet non géré, l\'erreur sort par µ.error', async () => {
    const window = fenetre()
    const rejets: unknown[] = []
    const anciens = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', (e) => { rejets.push(e) })
    try {
      const µ = window.µ
      const erreurs: any[][] = []
      µ.error = (...a: any[]) => { erreurs.push(a) }
      µ._mjs_fxDefs.boum = { css: '', setup() { throw new Error('boum de setup') } }
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      µ._mjs_fx({}, el, 'boum', {})
      definir(window, [el])
      await pause(40)
      assert.deepEqual(rejets, [], 'aucun rejet non géré')
      assert.equal(erreurs.some((a) => a.some((x) => x instanceof Error && x.message === 'boum de setup')), true, 'l\'erreur est écrite par µ.error')
    }
    finally {
      process.removeAllListeners('unhandledRejection')
      for (const f of anciens) process.on('unhandledRejection', f as any)
      window.close()
    }
  })

  // un composant qui réécrit sa balise à chaque rendu : un seul enregistrement par composant, la poignée
  // rendue est toujours la même, et elle annule tout ce que le composant avait demandé
  it('fichier en route : 200 appels du même composant = UN enregistrement, et sa poignée annule toute sa demande', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      const { arrive } = enRoute(window)
      const b = window.document.createElement('b')
      window.document.body.appendChild(b)
      const c: any = {}
      const poignees: any[] = []
      for (let i = 0; i < 200; i++) poignees.push(µ._mjs_fx(c, b, 'neon', {}, { color: '#111111' }, REGLE))
      assert.equal(b._mjs_fxWait.neon.calls.length, 1, 'un enregistrement pour 200 appels du même composant')
      assert.equal(new Set(poignees).size, 1, 'la même poignée à chaque appel')
      poignees[199]()
      arrive()
      await pause(20)
      assert.equal(b.hasAttribute('mjs-fx'), false, 'le composant a annulé : rien n\'est posé')
    }
    finally {
      window.close()
    }
  })

  // la valeur qui change en attendant se range sur l'appel dont les valeurs poseront l'effet : le plus récent
  it('fichier en route, deux composants posent le même effet : une variable qui change en attendant est suivie sur le dernier appel', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      const { arrive } = enRoute(window)
      const b = window.document.createElement('b')
      window.document.body.appendChild(b)
      µ._mjs_fx({}, b, 'neon', {}, { color: '#ff0000' }, REGLE)
      µ._mjs_fx({}, b, 'neon', {}, { color: '#0000ff' }, REGLE)
      µ._mjs_fxSet(b, 'neon', { color: '#00ff00' }, REGLE)
      arrive()
      await pause(20)
      assert.equal(b.getAttribute('mjs-fx'), 'neon', 'l\'effet est posé')
      assert.equal(couleur(b), '#00ff00', 'la valeur écrite en attendant, pas celle du dernier appel')
    }
    finally {
      window.close()
    }
  })

  // le fichier arrive mais ne définit pas l'effet (un autre nom, un module vide) : l'attente est
  // abandonnée, la reprise ne redemande pas sans fin la promesse déjà tenue
  it('le fichier de l\'effet arrive sans le définir : l\'attente est abandonnée, la reprise ne boucle pas', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      const erreurs: any[][] = []
      µ.error = (...a: any[]) => { erreurs.push(a) }
      let arrive: () => void = () => {}
      const promesse = new Promise<void>((ok) => { arrive = ok })
      delete µ._mjs_fxDefs.neon
      let demandes = 0
      µ._mjs_fxNeed = () => {
        demandes++
        // une reprise qui boucle redemande le fichier à chaque tour de microtâche : coupée à vingt tours
        if (demandes > 20) throw new Error('la reprise boucle')
        return promesse
      }
      const b = window.document.createElement('b')
      window.document.body.appendChild(b)
      µ._mjs_fx({}, b, 'neon', {})
      arrive()
      await pause(20)
      assert.equal(demandes, 1, `le fichier a été redemandé ${demandes} fois`)
      assert.equal(Object.keys(b._mjs_fxWait || {}).length, 0, 'plus d\'attente sur la balise')
      assert.equal(b.hasAttribute('mjs-fx'), false, 'aucun effet posé')
      assert.deepEqual(erreurs, [], 'aucune erreur écrite')
    }
    finally {
      window.close()
    }
  })

  // les observateurs que la reprise branche sur le document, pour dire s'il en reste un vivant
  function espionnerObservateurs(window: any) {
    const vivants = new Set<any>()
    const Origine = window.MutationObserver
    window.MutationObserver = class extends Origine {
      observe(cible: any, ...a: any[]) {
        if (cible === window.document) vivants.add(this)
        return super.observe(cible, ...a)
      }
      disconnect() {
        vivants.delete(this)
        return super.disconnect()
      }
    }
    return vivants
  }

  it('balise retirée pour de bon par un bloc avant l\'arrivée de son composant : l\'attente est abandonnée, rien n\'est mis de côté', async () => {
    const window = fenetre()
    const vivants = espionnerObservateurs(window)
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      µ._mjs_fx({}, el, 'neon', {}, { color: '#ff0000' }, REGLE)
      // le bloc qui portait la balise la retire et marque mort ce qui s'est détaché avec elle
      el._mjs_dead = true
      el.remove()
      definir(window, [el])
      await pause(20)
      assert.equal(vivants.size, 0, 'aucun observateur du document : la balise ne reviendra pas')
      assert.equal(Object.keys(el._mjs_fxWait || {}).length, 0, 'plus d\'attente sur la balise')
      window.document.body.appendChild(el)
      await pause(20)
      assert.equal(el.hasAttribute('mjs-fx'), false, 'réinsérée par la suite, elle n\'a pas d\'effet : celui du bloc qui l\'a retirée est fini')
    }
    finally {
      window.close()
    }
  })

  it('l\'observateur du document ne vit que tant qu\'une balise mise de côté est attendue : débranché à son retour', async () => {
    const window = fenetre()
    const vivants = espionnerObservateurs(window)
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      µ._mjs_fx(null, el, 'neon', {}, { color: '#ff0000' }, REGLE)
      el.remove()
      window.customElements.define('mjs-x', class extends window.HTMLElement {})
      await pause(20)
      assert.equal(vivants.size, 1, 'un observateur du document tant que la balise est mise de côté')
      window.document.body.appendChild(el)
      await pause(20)
      assert.equal(el.getAttribute('mjs-fx'), 'neon', 'l\'effet se pose à la reconnexion')
      assert.equal(vivants.size, 0, 'plus rien n\'est attendu : l\'observateur est débranché')
    }
    finally {
      window.close()
    }
  })

  it('composant défini sans shadow root (mise à niveau en échec) : rien n\'est posé, l\'attente est abandonnée', async () => {
    const window = fenetre()
    try {
      const µ = window.µ
      µ.paths = { x: 'x.js' }
      const el = window.document.createElement('mjs-x')
      window.document.body.appendChild(el)
      µ._mjs_fx({}, el, 'neon', {}, { color: '#ff0000' }, REGLE)
      window.customElements.define('mjs-x', class extends window.HTMLElement {})
      await pause(20)
      assert.equal(el.hasAttribute('mjs-fx'), false, 'rien de posé : pas de shadow root pour son calque')
      assert.equal(Object.keys(el._mjs_fxWait || {}).length, 0, 'plus d\'attente sur la balise')
    }
    finally {
      window.close()
    }
  })
})
