// µ.Autoloader — une page déjà remplie par le serveur démarre d'un seul geste. Chaque composant que cette page affiche jette son contenu
// préparé (sa « photo ») au premier rendu pour bâtir le sien : un enfant qui prendrait la main avant son parent s'afficherait avec ses
// réglages par défaut (le parent lui passe ceux que le serveur n'a pas écrits), un parent qui la prendrait avant ses enfants laisserait
// son sous-bloc manquer à l'écran le temps que son fichier arrive.
// - tous les fichiers des composants de la photo partent ensemble ; aucune balise n'est définie avant qu'ils soient tous arrivés ;
// - puis toutes les balises sont définies d'un seul geste, du parent vers les enfants (de proche en proche), quel que soit l'ordre des fichiers ;
// - les enfants de TOUTES les occurrences d'un composant comptent, pas ceux de la première seulement ;
// - jamais de blocage : un fichier qui n'arrive pas retient la page jusqu'au plafond, pas au-delà, et prend la main à son arrivée ; un
//   fichier qui échoue ne retient personne et l'échec est dit en console ; un composant absent du manifeste, déjà défini, ou deux
//   composants qui se contiennent l'un l'autre, ne retiennent personne ;
// - sans photo (`load(nom)` direct, composant sans rendu serveur) : aucune attente, comportement inchangé.
// Doublures happy-dom : l'ombre d'une photo s'y pose par `attachShadow` (le HTML n'y active pas l'ombre déclarative) ; le cœur est
// remplacé par `_def` et `_al`, par où passent les modules compilés pour enregistrer leur balise (mjs_dom.ts, mjs_alias.ts).

import { strict as assert } from 'node:assert'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname      = dirname(fileURLToPath(import.meta.url))
const AUTOLOADER_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_autoloader.ts'), 'utf-8')

const GLOBALES = ['document', 'customElements', 'MutationObserver', 'HTMLElement', '__evalue', '__portes', '__noyau']

type Porte = { promesse: Promise<void>; ouvrir: () => void }

describe('mjs_autoloader — la page préparée par le serveur part d\'un seul geste, du parent vers les enfants', function () {
  let dir: string
  let saved: Record<string, any>
  let window: any
  let noyau: any
  let n = 0
  let erreurs: any[][]
  let definitions: string[]
  let lot: number

  before(function () {
    dir = mjsTmp('autoloader-enfants')
  })
  after(function () {
    rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(function () {
    saved = {}
    for (const k of GLOBALES) saved[k] = (globalThis as any)[k]
    window = new Window({ url: 'http://localhost/' })
    const g: any = globalThis
    g.document         = window.document
    g.customElements   = window.customElements
    g.MutationObserver = window.MutationObserver
    g.HTMLElement      = window.HTMLElement
    g.__evalue         = []
    g.__portes         = {}
    erreurs            = []
    definitions        = []
    lot                = 0
  })
  afterEach(function () {
    for (const k of GLOBALES) {
      if (saved[k] === undefined) delete (globalThis as any)[k]
      else (globalThis as any)[k] = saved[k]
    }
    window.close()
  })

  // un composant dont le module attend sa porte, puis définit la balise (et, en plus, celles de `aussi`) par le cœur, comme un module compilé
  function module(tag: string, aussi: string[] = []): string {
    const fichier = join(dir, `${tag}-${++n}.mjs`)
    const definir = [tag, ...aussi].map((t) => `globalThis.__evalue.push('${t}'); globalThis.__noyau._def('${t}', class extends globalThis.HTMLElement {});`).join('\n')
    writeFileSync(fichier, `const porte = globalThis.__portes['${tag}'];\nif (porte) await porte;\n${definir}\n`)
    return fichier
  }

  // le module d'un composant à alias court : la balise longue par `_def`, l'alias par `_al` (clé du manifeste = le tag sans `mjs-`)
  function moduleAlias(longue: string, courte: string): string {
    const fichier = join(dir, `${longue}-${++n}.mjs`)
    writeFileSync(fichier, `globalThis.__noyau._def('${longue}', class extends globalThis.HTMLElement {});\nglobalThis.__noyau._al('${courte}', '${courte.replace('mjs-', '')}', class extends globalThis.HTMLElement {});\n`)
    return fichier
  }

  // un module qui enregistre sa balise sans passer par le cœur
  function moduleDirect(tag: string): string {
    const fichier = join(dir, `${tag}-${++n}.mjs`)
    writeFileSync(fichier, `globalThis.customElements.define('${tag}', class extends globalThis.HTMLElement {});\n`)
    return fichier
  }

  // une porte fermée devant le module d'une balise : rien n'est défini tant qu'on ne l'a pas ouverte
  function fermer(tag: string): Porte {
    let ouvrir!: () => void
    const promesse = new Promise<void>((r) => { ouvrir = r })
    ;(globalThis as any).__portes[tag] = promesse
    return { promesse, ouvrir }
  }

  function autoloader(modules: Record<string, string>) {
    const paths: Record<string, string> = {}
    for (const [tag, fichier] of Object.entries(modules)) paths[tag.replace('mjs-', '')] = fichier
    const µ: any = { log() {}, warn() {}, error: (...a: any[]) => erreurs.push(a), paths }
    // le cœur : l'enregistrement d'une balise note l'ordre des définitions, et combien tombent dans le même geste que la première
    const noter = (tag: string) => {
      definitions.push(tag)
      if (definitions.length === 1) queueMicrotask(() => { lot = definitions.length })
    }
    µ._def = (tag: string, C: any) => { if (!(globalThis as any).customElements.get(tag)) { (globalThis as any).customElements.define(tag, C); noter(tag) } }
    µ._al  = (tag: string, _cle: string, C: any) => { if (!(globalThis as any).customElements.get(tag)) { (globalThis as any).customElements.define(tag, class extends C {}); noter(tag) } }
    poserMessages(µ)
    noyau = µ
    ;(globalThis as any).__noyau = µ
    new Function('µ', AUTOLOADER_SRC)(µ)
    return µ.Autoloader
  }

  // une balise déjà remplie par le serveur : `mjs-ssr`, une ombre ouverte dont les enfants sont les balises données
  function photo(tag: string, enfants: HTMLElement[] = []): HTMLElement {
    const el: any = window.document.createElement(tag)
    el.setAttribute('mjs-ssr', '')
    el.attachShadow({ mode: 'open' })
    el.shadowRoot.appendChild(window.document.createElement('p'))
    for (const e of enfants) el.shadowRoot.appendChild(e)
    return el
  }

  const vide    = (tag: string): HTMLElement => photo(tag)
  const poser   = (...els: HTMLElement[]) => { for (const el of els) window.document.body.appendChild(el) }
  const definis = (tag: string): boolean => !!(globalThis as any).customElements.get(tag)
  const dormir  = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const ordre   = (): string[] => definitions
  const evalues = (): string[] => (globalThis as any).__evalue

  it('aucune balise de la page n\'est définie avant que tous ses fichiers soient arrivés', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    const porte = fermer('mjs-b')
    poser(photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(60)
    assert.deepEqual(evalues(), ['mjs-a'], 'le fichier du parent est arrivé, pas celui de l\'enfant')
    assert.equal(definis('mjs-a'), false, 'le parent attend le fichier de son enfant : il ne prend pas la main avant')
    assert.deepEqual(ordre(), [], 'aucune balise définie')
    porte.ouvrir()
    await dormir(60)
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b'], 'le parent d\'abord, puis son enfant')
    assert.equal(lot, 2, 'les deux dans le même geste, avant que la moindre tâche ou microtâche suivante ne passe')
  })

  it('du parent vers les enfants, de proche en proche : le parent, l\'enfant, puis le petit-enfant', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b'), 'mjs-c': module('mjs-c') })
    const porte = fermer('mjs-c')
    poser(photo('mjs-a', [photo('mjs-b', [vide('mjs-c')])]))
    A.observe(window.document.body)
    await dormir(60)
    assert.deepEqual(ordre(), [], 'rien n\'est défini tant que le petit-enfant n\'est pas là')
    porte.ouvrir()
    await dormir(80)
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b', 'mjs-c'])
    assert.equal(lot, 3, 'les trois dans le même geste')
  })

  it('l\'ordre est celui de la page, pas celui des fichiers : le fichier du petit-enfant arrive le premier', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b'), 'mjs-c': module('mjs-c') })
    const portes = [fermer('mjs-a'), fermer('mjs-b')]
    poser(photo('mjs-a', [photo('mjs-b', [vide('mjs-c')])]))
    A.observe(window.document.body)
    await dormir(40)
    assert.deepEqual(evalues(), ['mjs-c'], 'le petit-enfant est arrivé le premier')
    portes[1].ouvrir()
    await dormir(40)
    portes[0].ouvrir()
    await dormir(60)
    assert.deepEqual(evalues(), ['mjs-c', 'mjs-b', 'mjs-a'], 'les fichiers sont arrivés du petit-enfant au parent')
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b', 'mjs-c'], 'les balises, du parent au petit-enfant')
  })

  it('les frères et les pages voisines gardent l\'ordre de la page : chaque parent avant ses enfants, le premier avant le second', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b'), 'mjs-c': module('mjs-c'), 'mjs-d': module('mjs-d'), 'mjs-e': module('mjs-e') })
    poser(photo('mjs-a', [vide('mjs-b'), photo('mjs-c', [vide('mjs-d')])]), photo('mjs-e'))
    A.observe(window.document.body)
    await dormir(80)
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b', 'mjs-c', 'mjs-d', 'mjs-e'])
  })

  it('les enfants de toutes les occurrences comptent : la deuxième seule affiche l\'enfant attendu', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    const porte = fermer('mjs-b')
    poser(photo('mjs-a'), photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(60)
    assert.equal(definis('mjs-a'), false, 'une occurrence affiche <mjs-b> : la page attend <mjs-b>')
    porte.ouvrir()
    await dormir(60)
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b'])
  })

  it('une seconde observation pendant l\'attente (une racine d\'ombre, le document de nouveau) ne lance pas la page une seconde fois', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    const porte = fermer('mjs-b')
    poser(photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    A.observe(window.document.body)
    await dormir(60)
    porte.ouvrir()
    await dormir(60)
    assert.deepEqual(evalues(), ['mjs-a', 'mjs-b'], 'chaque fichier est importé une fois')
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b'], 'chaque balise est définie une fois, le parent d\'abord')
    assert.deepEqual(erreurs, [])
  })

  it('un fichier qui n\'arrive jamais retient la page jusqu\'au plafond, pas au-delà', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    A._mjs_pageWait = 150
    fermer('mjs-b')
    poser(photo('mjs-a', [vide('mjs-b')]))
    const depart = Date.now()
    A.observe(window.document.body)
    await dormir(80)
    assert.equal(definis('mjs-a'), false, 'avant le plafond, la page attend encore')
    await dormir(250)
    assert.equal(definis('mjs-a'), true, 'au plafond, la page prend la main sans le fichier perdu')
    assert.equal(definis('mjs-b'), false)
    assert.ok(Date.now() - depart >= 140, 'jamais avant le plafond')
  })

  it('le fichier qui arrive après le plafond prend la main à son arrivée, et le cœur retrouve ses fonctions', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    const def = noyau._def
    const al  = noyau._al
    A._mjs_pageWait = 100
    const porte = fermer('mjs-b')
    poser(photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(250)
    assert.deepEqual(ordre(), ['mjs-a'], 'la page est partie sans lui')
    assert.equal(noyau._def, def, '`_def` est celle du cœur, la page partie')
    assert.equal(noyau._al, al, '`_al` aussi')
    porte.ouvrir()
    await dormir(80)
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b'], 'il est défini à son arrivée')
    assert.equal(A.pendingComponents.size, 0, 'plus rien en attente')
    assert.deepEqual(erreurs, [], 'aucune erreur : sa balise est bien enregistrée')
  })

  it('le plafond posé par le cœur est une demi-seconde', function () {
    assert.equal(autoloader({})._mjs_pageWait, 500)
  })

  it('un fichier qui échoue ne retient pas la page : elle part aussitôt, et l\'échec est dit en console', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': join(dir, 'absent.mjs') })
    A._mjs_pageWait = 5000
    poser(photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(300)
    assert.equal(definis('mjs-a'), true, 'la page prend la main sans attendre le plafond (5 s ici)')
    assert.ok(erreurs.some((e) => /Failed to import b/.test(String(e[0]))), 'l\'échec du fichier est dit en console')
  })

  it('deux composants qui se contiennent l\'un l\'autre ne s\'attendent pas : aucun ne reste en attente', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    A._mjs_pageWait = 5000
    poser(photo('mjs-a', [photo('mjs-b', [vide('mjs-a')])]))
    A.observe(window.document.body)
    await dormir(120)
    assert.deepEqual(ordre().slice().sort(), ['mjs-a', 'mjs-b'], 'les deux sont définis bien avant le plafond')
  })

  it('un composant qui se contient lui-même ne s\'attend pas', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a') })
    A._mjs_pageWait = 5000
    poser(photo('mjs-a', [vide('mjs-a')]))
    A.observe(window.document.body)
    await dormir(100)
    assert.deepEqual(ordre(), ['mjs-a'])
  })

  it('un enfant absent du manifeste ne retient personne', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a') })
    A._mjs_pageWait = 5000
    poser(photo('mjs-a', [vide('mjs-inconnu')]))
    A.observe(window.document.body)
    await dormir(100)
    assert.deepEqual(ordre(), ['mjs-a'])
    assert.deepEqual(erreurs, [], 'ni rejet ni erreur pour la balise que personne ne peut charger')
  })

  it('un enfant déjà défini ne retient personne', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    A._mjs_pageWait = 5000
    window.customElements.define('mjs-b', class extends window.HTMLElement {})
    poser(photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(100)
    assert.deepEqual(ordre(), ['mjs-a'])
  })

  it('un seul fichier pour plusieurs balises de la page (fichier de page ou de groupe) : importé une fois, balises rangées dans l\'ordre de la page', async function () {
    const fichier = module('mjs-b', ['mjs-a'])
    const A = autoloader({ 'mjs-a': fichier, 'mjs-b': fichier })
    poser(photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(100)
    assert.deepEqual(evalues(), ['mjs-b', 'mjs-a'], 'le fichier liste l\'enfant d\'abord')
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b'], 'la page range le parent d\'abord')
    assert.deepEqual(erreurs, [], 'aucune erreur')
    assert.equal(A.pendingComponents.size, 0, 'plus rien en attente')
  })

  it('l\'alias court d\'un composant (`_al`) est retenu et rangé comme sa balise : la page l\'affiche par son alias', async function () {
    const A = autoloader({ 'mjs-court': moduleAlias('mjs-long', 'mjs-court'), 'mjs-b': module('mjs-b') })
    const porte = fermer('mjs-b')
    poser(photo('mjs-court', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(60)
    assert.equal(definis('mjs-court'), false, 'l\'alias attend le fichier de l\'enfant, comme la balise longue le ferait')
    porte.ouvrir()
    await dormir(60)
    assert.deepEqual(ordre().filter((t) => t !== 'mjs-long'), ['mjs-court', 'mjs-b'], 'l\'alias avant son enfant')
    assert.deepEqual(erreurs, [])
  })

  it('une balise enregistrée sans passer par le cœur n\'est pas retenue : définie à l\'arrivée de son fichier, sans erreur', async function () {
    const A = autoloader({ 'mjs-a': moduleDirect('mjs-a'), 'mjs-b': module('mjs-b') })
    const porte = fermer('mjs-b')
    poser(photo('mjs-a', [vide('mjs-b')]))
    A.observe(window.document.body)
    await dormir(60)
    assert.equal(definis('mjs-a'), true, 'sa balise est définie dès l\'arrivée de son fichier')
    porte.ouvrir()
    await dormir(60)
    assert.equal(definis('mjs-b'), true)
    assert.deepEqual(erreurs, [], 'ni « jamais enregistré » ni autre erreur')
  })

  it('sans photo (load direct) : aucune attente, le fichier est importé tout de suite', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a') })
    fermer('mjs-b')
    await A.load('mjs-a')
    assert.deepEqual(ordre(), ['mjs-a'])
  })

  it('une balise sans rendu serveur (ni mjs-ssr ni ombre) se charge sans attente', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    fermer('mjs-b')
    const nu: any = window.document.createElement('mjs-a')
    nu.appendChild(window.document.createElement('mjs-b'))
    poser(nu)
    A.observe(window.document.body)
    await dormir(80)
    assert.equal(definis('mjs-a'), true, 'le contenu écrit à la main dans la balise n\'est pas une photo du serveur')
  })

  it('un composant sans rendu serveur, à côté de la page préparée, n\'attend personne', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b'), 'mjs-c': module('mjs-c') })
    const porte = fermer('mjs-b')
    poser(photo('mjs-a', [vide('mjs-b')]), window.document.createElement('mjs-c'))
    A.observe(window.document.body)
    await dormir(60)
    assert.deepEqual(ordre(), ['mjs-c'], 'le composant libre est défini, la page préparée attend son dernier fichier')
    porte.ouvrir()
    await dormir(60)
    assert.deepEqual(ordre(), ['mjs-c', 'mjs-a', 'mjs-b'])
  })

  it('composant léger rendu par le serveur : ses enfants sont ses enfants directs', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    const porte = fermer('mjs-b')
    const leger: any = window.document.createElement('mjs-a')
    leger.setAttribute('mjs-ssr', '')
    leger.setAttribute('mjs-light', '')
    leger.appendChild(window.document.createElement('mjs-b'))
    poser(leger)
    A.observe(window.document.body)
    await dormir(60)
    assert.equal(definis('mjs-a'), false, 'le parent léger attend le fichier de l\'enfant écrit dans sa photo')
    porte.ouvrir()
    await dormir(60)
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b'])
  })

  it('composant léger sans l\'attribut `mjs-light` (déclaré par sa classe seule) : ses enfants directs sont aussi sa photo', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    const porte = fermer('mjs-b')
    const leger: any = window.document.createElement('mjs-a')
    leger.setAttribute('mjs-ssr', '')
    leger.appendChild(window.document.createElement('mjs-b'))
    poser(leger)
    A.observe(window.document.body)
    await dormir(60)
    assert.equal(definis('mjs-a'), false, 'le serveur n\'écrit pas `mjs-light` pour ce composant : la page attend quand même le fichier de l\'enfant de sa photo')
    porte.ouvrir()
    await dormir(60)
    assert.deepEqual(ordre(), ['mjs-a', 'mjs-b'])
  })

  it('léger sans attribut `mjs-light` dont le fichier de l\'enfant n\'arrive jamais : la page prend la main au plafond, pas avant', async function () {
    const A = autoloader({ 'mjs-a': module('mjs-a'), 'mjs-b': module('mjs-b') })
    A._mjs_pageWait = 150
    fermer('mjs-b')
    const leger: any = window.document.createElement('mjs-a')
    leger.setAttribute('mjs-ssr', '')
    leger.appendChild(window.document.createElement('mjs-b'))
    poser(leger)
    A.observe(window.document.body)
    await dormir(80)
    assert.equal(definis('mjs-a'), false, 'avant le plafond, la page attend encore')
    await dormir(250)
    assert.equal(definis('mjs-a'), true, 'au plafond, la page prend la main sans le fichier perdu')
  })
})
