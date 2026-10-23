// Un effet qui dessine DANS sa balise (un calque : *annotate, *gauge, *goo…), posé sur un composant
// dont le code arrive à la demande — construction découpée : l'Autoloader l'importe quand sa balise
// apparaît, après le rendu de son parent. L'effet attend que le composant soit enregistré, puis se
// pose dans son shadow root. Posé avant, le calque tombait dans la balise elle-même, sous le shadow
// root qu'elle prend à sa mise à niveau : jamais affiché. Pendant l'attente, ses variables sont
// suivies, même quand le bloc qui porte la balise repasse (la valeur posée est la dernière écrite) ;
// retiré avant l'arrivée du composant (bloc {if} refermé), rien n'est posé ; une balise étrangère, qui
// ne sera peut-être jamais définie (autre bibliothèque, ou `mjs-` absente du manifeste), reçoit son
// effet tout de suite, comme avant. *skeleton, lui, se pose tout de suite sur la balise du composant
// qui arrive : sa silhouette est faite pour l'attente.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// un calque d'annotation posé directement dans `racine` (la balise, ou son shadow root)
const calque = (racine: any) => Array.from(racine.children).some((c: any) => c.getAttribute('mjs-fx-layer') === 'annotate')

const PARENT = [
  '<script>',
  '$on = true',
  '$autre = false',
  '$sq = false',
  '$teinte = \'#ff0000\'',
  '</script>',
  '{if $on}<@enfant class="e" *annotate(color: $teinte, on: load)>mot</@enfant>{end}',
  '{if $autre}<i class="autre"></i>{end}',
  '{if $sq}<@enfant class="s" *skeleton></@enfant>{end}',
  '<ma-lib-widget class="w" *annotate(on: load)>w</ma-lib-widget>',
  '<mjs-tiers class="t" *annotate(on: load)>t</mjs-tiers>',
  '<button class="ferme" @click={$on = false}>ferme</button>',
  '<button class="bascule" @click={$autre = true}>bascule</button>',
  '<button class="silhouette" @click={$sq = true}>silhouette</button>',
  '<button class="teinte" @click={$teinte = \'#0000ff\'}>teinte</button>',
].join('\n')

describe('effet posé sur un composant dont le code arrive à la demande', function () {
  this.timeout(60000)
  let page    = ''
  let enfant  = ''
  let chemins = ''
  let skels   = ''

  before(async () => {
    const root   = mjsTmp('effets-composant-pas-encore-defini')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'parent.mjs'), PARENT)
    writeFileSync(join(srcDir, 'enfant.mjs'), '<p class="dedans">dedans</p>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    // le cœur, l'effet et le parent sont là au rendu du parent ; le code de l'enfant arrive ensuite
    page    = files.filter((f) => !f.startsWith('enfant-')).sort((a, b) => rang(a) - rang(b)).map(lire).join('\n')
    enfant  = files.filter((f) => f.startsWith('enfant-')).map(lire).join('\n')
    const manifeste = readFileSync(join(root, 'bundle.js'), 'utf-8')
    chemins = /const µPaths = (\{.*?\});/.exec(manifeste)![1]
    skels   = /µ\._skels = (\{.*?\});/.exec(manifeste)![1]
    assert.ok(enfant, 'l\'enfant a son propre fichier (construction découpée)')
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  // une page neuve, le manifeste publié (µ.paths, les silhouettes) ; l'Autoloader note ce qu'il irait
  // importer, le code de l'enfant n'arrive que quand le cas le décide (cf. arriver)
  async function monter() {
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${page}\nglobalThis.µ = µ; µ.paths = ${chemins}; µ.pathsPrefix = '/out/'; µ._skels = ${skels};`)
    const demandes: string[] = []
    window.µ.Autoloader.load = (tag: string) => { demandes.push(tag.toLowerCase()) }
    window.document.body.innerHTML = '<mjs-parent></mjs-parent>'
    const parent = window.document.querySelector('mjs-parent')
    await attendre(() => !!parent._shadow?.querySelector('mjs-enfant'))
    return { window, sh: parent._shadow, demandes }
  }

  // l'arrivée du code de l'enfant, comme dans un navigateur : sa définition met à niveau SUR PLACE, d'un
  // trait, chaque balise déjà dans la page — constructeur (le shadow root), puis connectedCallback —
  // avant que les promesses de `whenDefined` ne passent. happy-dom (v20) ne le fait pas : il remplace la
  // balise par un nouvel élément, et le parent garde l'ancienne, vide. La mise à niveau est donc jouée
  // ici : la balise sortie de la page le temps de la définition (happy-dom ne la remplace pas), le
  // constructeur du composant joué sur elle (son constructeur de base la rend au lieu d'en créer une),
  // puis la balise remise à sa place (son connectedCallback). Une balise hors de la page n'est pas mise
  // à niveau, comme dans un navigateur
  function arriver(window: any, balises: any[]) {
    const places = balises.map((b) => ({ b, parent: b.parentNode, suivant: b.nextSibling }))
    for (const p of places) p.b.remove()
    window.eval(enfant)
    const C    = window.customElements.get('mjs-enfant')
    const base = Object.getPrototypeOf(window.µ.Element)
    let cible: any = null
    const relais: any = function (this: any) {
      if (cible) {
        const b = cible
        cible = null
        Object.setPrototypeOf(b, new.target.prototype)
        return b
      }
      return Reflect.construct(base, [], new.target)
    }
    relais.prototype = base.prototype
    Object.setPrototypeOf(window.µ.Element, relais)
    try {
      for (const p of places) {
        cible = p.b
        new C()
        p.parent.insertBefore(p.b, p.suivant)
      }
    }
    finally {
      Object.setPrototypeOf(window.µ.Element, base)
    }
  }

  it('l\'effet attend le composant, puis se pose dans son shadow root, avec la dernière valeur de sa variable', async () => {
    const { window, sh, demandes } = await monter()
    try {
      const b = sh.querySelector('mjs-enfant')
      await attendre(() => demandes.includes('mjs-enfant'))
      assert.ok(demandes.includes('mjs-enfant'), 'l\'Autoloader va chercher l\'enfant')
      assert.equal(window.customElements.get('mjs-enfant'), undefined, 'l\'enfant n\'est pas encore défini')
      assert.equal(calque(b), false, 'rien n\'est dessiné dans la balise tant que le composant n\'est pas là')
      assert.equal(b.hasAttribute('mjs-fx'), false, 'ni marqué')
      // pendant l'attente, le bloc qui porte la balise repasse (une autre variable de structure change :
      // l'effet est redemandé), puis la variable de l'effet change
      sh.querySelector('.bascule').click()
      await attendre(() => !!sh.querySelector('i.autre'))
      sh.querySelector('.teinte').click()
      await new Promise((r) => setTimeout(r, 20))
      arriver(window, [b])
      await attendre(() => !!b._shadow && calque(b._shadow))
      assert.ok(!!b._shadow, 'l\'enfant est mis à niveau')
      assert.equal(calque(b._shadow), true, 'le calque est dans le shadow root de l\'enfant')
      assert.equal(calque(b), false, 'pas dans sa balise, où il ne se verrait pas')
      assert.equal(b.getAttribute('mjs-fx'), 'annotate')
      assert.equal(b.style.getPropertyValue('--mjs-annotate-color'), '#0000ff', 'la dernière valeur de la variable')
    }
    finally {
      window.close()
    }
  })

  it('retiré avant l\'arrivée du composant (bloc {if} refermé) : rien n\'est posé à l\'arrivée', async () => {
    const { window, sh } = await monter()
    try {
      const b = sh.querySelector('mjs-enfant')
      assert.equal(calque(b), false, 'rien de posé pendant l\'attente')
      sh.querySelector('.ferme').click()
      await attendre(() => !b.isConnected)
      assert.equal(b.isConnected, false, 'le bloc a retiré la balise')
      arriver(window, [])
      await new Promise((r) => setTimeout(r, 30))
      assert.ok(window.customElements.get('mjs-enfant'), 'le composant est arrivé')
      assert.equal(calque(b), false, 'aucun calque dans la balise retirée')
      assert.equal(b.hasAttribute('mjs-fx'), false, 'aucune marque')
      assert.equal(!!(b._mjs_fxOff && b._mjs_fxOff.annotate), false, 'aucun effet posé')
      assert.equal(!!(b._mjs_fxWait && b._mjs_fxWait.annotate), false, 'plus rien en attente')
    }
    finally {
      window.close()
    }
  })

  it('une balise étrangère jamais définie (autre bibliothèque, `mjs-` absente du manifeste) reçoit son effet tout de suite', async () => {
    const { window, sh } = await monter()
    try {
      const w = sh.querySelector('ma-lib-widget')
      const t = sh.querySelector('mjs-tiers')
      await attendre(() => calque(w) && calque(t))
      for (const el of [w, t]) {
        assert.equal(el.getAttribute('mjs-fx'), 'annotate', `<${el.localName}> marquée`)
        assert.equal(calque(el), true, `<${el.localName}> : le calque dans la balise, comme avant`)
      }
    }
    finally {
      window.close()
    }
  })

  it('*skeleton, lui, se pose tout de suite sur la balise du composant qui arrive : sa silhouette est faite pour l\'attente', async () => {
    const { window, sh } = await monter()
    try {
      sh.querySelector('.silhouette').click()
      await attendre(() => !!sh.querySelector('mjs-enfant.s'))
      const s = sh.querySelector('mjs-enfant.s')
      assert.equal(!!s.querySelector('[mjs-skel-zone]'), true, 'la silhouette dans la balise pendant que le code arrive')
      assert.equal(s.hasAttribute('mjs-skel-host'), true, 'la balise épargnée par le bouclier du cœur')
      arriver(window, Array.from(sh.querySelectorAll('mjs-enfant')))
      await new Promise((r) => setTimeout(r, 30))
      assert.ok(!!s._shadow, 'le composant est arrivé')
      assert.equal(!!s.querySelector('[mjs-skel-zone]'), false, 'la silhouette part à son arrivée')
    }
    finally {
      window.close()
    }
  })
})
