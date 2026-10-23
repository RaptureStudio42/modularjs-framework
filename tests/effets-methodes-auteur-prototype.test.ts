// un effet n'appelle jamais une méthode de l'auteur : sur la balise d'un composant qui écrit `@focus`,
// `@contains`, `@getBoundingClientRect`, `@getAttribute`, `@setAttribute`, `@addEventListener`… (des noms
// naturels, laissés libres par le compilateur), chaque effet joué passe par la méthode de la balise
// elle-même, prise au prototype ; la méthode de l'auteur reste intacte, jamais appelée par le cadre.
// (*weight n'y figure pas : monté dans un composant, il fait échouer à coup sûr tests/effets-police-tardive.test.ts joué après dans le même processus, avec ou sans ce banc.)
// Le banc pose ces méthodes comme champs de l'élément (ce que fait un composant : elles masquent celles
// du prototype), les compte, puis joue chaque effet avec ses réglages par défaut et des événements réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const EFFETS = [
  'flipcard', 'tilt', 'ripple', 'spotlight', 'shine', 'lift', 'magnet', 'parallax', 'orbit', 'grid',
  'autosize', 'spoiler', 'glass', 'hologram', 'glitch', 'neon', 'pulse', 'shake', 'float', 'bounce',
  'attention', 'zoom', 'spin', 'underline', 'highlight', 'outline', 'dock', 'stagger', 'scrollprogress', 'react',
  'peel', 'marquee', 'reflect', 'cycle', 'count', 'filter', 'blend', 'heatmap', 'gallery',
  'pile', 'velocity'
]

const METHODES = [
  'contains', 'focus', 'blur', 'click', 'getBoundingClientRect', 'getClientRects', 'getAttribute',
  'setAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'closest', 'matches', 'querySelector', 'querySelectorAll', 'animate', 'getAnimations',
  'remove', 'replaceWith', 'appendChild', 'insertBefore', 'after', 'scrollIntoView', 'setPointerCapture', 'getRootNode'
]

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — jamais une méthode de l\'auteur sur la balise d\'un composant', function () {
  this.timeout(120000)
  let window: any
  let comp: any

  before(async () => {
    const root   = mjsTmp('effets-methodes-auteur-prototype')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), EFFETS.map((e) => `<div *${e}${e === 'heatmap' ? "(server: 'wss://h.invalid/ws')" : ''}>x</div>`).join('\n') + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // WebKit : *filter y relit l'encre de la balise (mesure, animations, observateurs, écouteurs) ; le banc s'y fait passer
    Object.defineProperty(window.navigator, 'vendor', { value: 'Apple Computer, Inc.' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-fx-banc></mjs-fx-banc>'
    comp = window.document.querySelector('mjs-fx-banc')
    await attendre(() => !!comp._shadow?.querySelector('div'))
    await pause()
  })

  // la main rendue propre, même après un échec : le composant retiré (ses effets s'arrêtent), puis la fenêtre fermée pour de
  // bon. `window.close()` ne ferme pas une fenêtre faite par `new Window()` (seulement celle qu'un script a ouverte) :
  // laissée ouverte, un effet y tournait encore pendant les fichiers suivants, des dizaines de milliers d'appels de
  // JSON.stringify par seconde (CSSStyleDeclaration.setProperty) ; `happyDOM.close()` coupe ses minuteries et ses images
  after(async () => {
    try { comp?.remove?.() }
    finally {
      try { await window?.happyDOM?.close?.() }
      finally { await terminateSharedWorkerPool() }
    }
  })

  // un élément dont chaque méthode du DOM est « écrite par l'auteur » : elle compte l'appel puis rend
  // ce que ferait la méthode de la balise (l'effet continue, le banc voit qui l'a appelée). Un appel
  // venu de happy-dom lui-même (sa mise en style, sa propagation d'événement lisent `this.getAttribute`)
  // n'est pas un effet : il ne compte pas
  function balise(appels: string[]) {
    const el = window.document.createElement('div')
    el.innerHTML = '<span>un</span><span>deux</span>'
    el.setAttribute('tabindex', '0')
    window.document.body.appendChild(el)
    const proto = window.HTMLElement.prototype
    for (const nom of METHODES) {
      const natif = proto[nom] || window.Element.prototype[nom] || window.Node.prototype[nom] || window.EventTarget.prototype[nom]
      if (typeof natif !== 'function') continue
      el[nom] = function (...args: any[]) {
        if (!/node_modules\/happy-dom/.test(String(new Error().stack).split('\n')[2])) appels.push(nom)
        return natif.apply(this, args)
      }
    }
    return el
  }

  const evenement = (el: any, type: string, init: any = {}) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(ev, { clientX: 5, clientY: 5, pointerId: 1, key: type === 'keydown' ? 'Escape' : undefined }, init)
    window.EventTarget.prototype.dispatchEvent.call(el, ev)
  }

  // `after`, `append`, `replaceWith` prennent n'importe quel nombre de nœuds : un argument de trop, même
  // `undefined`, devient un nœud texte « undefined » dans la page ; la méthode reçoit donc EXACTEMENT les
  // arguments donnés
  it('µ._mjs_dom passe à la méthode de la balise exactement les arguments reçus', () => {
    const el      = window.document.createElement('div')
    window.document.body.appendChild(el)
    const proto                             = window.Element.prototype
    const natives                           = {} as Record<string, any>
    const originaux                         = {} as Record<string, PropertyDescriptor | undefined>
    const longueurs: Record<string, number> = {}
    const cas: Array<[string, any[]]>       = [['after', [window.document.createElement('i')]], ['remove', []], ['setAttribute', ['a', 'b']], ['addEventListener', ['x', () => {}]], ['getBoundingClientRect', []], ['hasAttribute', ['a']]]
    // le prototype des éléments est celui de toutes les fenêtres de happy-dom : chaque méthode y revient telle qu'elle était, descripteur compris
    // (`addEventListener` n'y est pas propre, elle vient d'EventTarget : la remettre par une affectation la poserait sur Element pour de bon)
    try {
      for (const [nom] of cas) {
        natives[nom]   = proto[nom]
        originaux[nom] = Object.getOwnPropertyDescriptor(proto, nom)
        proto[nom]     = function (this: any, ...args: any[]) { longueurs[nom] = args.length; return natives[nom].apply(this, args) }
      }
      for (const [nom, args] of cas) window.µ._mjs_dom[nom](el, ...args)
    }
    finally {
      for (const nom of Object.keys(originaux)) {
        const avant = originaux[nom]
        if (avant) Object.defineProperty(proto, nom, avant)
        else delete proto[nom]
      }
    }
    for (const [nom, args] of cas) assert.equal(longueurs[nom], args.length, `${nom} : ${args.length} argument(s) donné(s)`)
  })

  for (const nom of EFFETS) {
    it(`*${nom} : aucune méthode de l'auteur appelée`, async () => {
      const appels: string[] = []
      const el = balise(appels)
      let off: any
      try { off = window.µ._mjs_fx(comp, el, nom, {}, {}, null) }
      catch (e: any) { assert.fail(`l'effet ne se pose pas : ${e.message}`) }
      for (const type of ['pointerenter', 'mouseover', 'pointermove', 'pointerdown', 'pointerup', 'click', 'focusin', 'focusout', 'keydown', 'scroll', 'pointerleave']) evenement(el, type)
      await pause(30)
      if (typeof off === 'function') off()
      window.document.body.removeChild(el)
      assert.deepEqual([...new Set(appels)], [], `*${nom} a appelé la méthode de l'auteur`)
    })
  }
})
