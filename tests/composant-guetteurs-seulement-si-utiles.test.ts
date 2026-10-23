// Chaque composant installait DEUX guetteurs (`MutationObserver`) à sa création, même sans en avoir
// l'usage : un guetteur de balises `mjs-*` pas encore définies dans son ombre (`µ.Autoloader.observe`,
// émis dans le constructeur), et un guetteur d'attributs de l'hôte (`_mjs_propObserver`). Mesuré dans
// Chromium sur 1 000 composants créés dans une liste : 2 `new MutationObserver`, 2 `observe`, 3 rappels
// d'observateur par instance, dont un rappel pour RIEN — le retrait de l'attribut `mjs-loading`, posé
// puis retiré par le moteur lui-même, réveillait le guetteur d'attributs qui relisait puis ignorait ce nom.
//
// Ce que ce fichier garde :
//  - un composant dont le gabarit est « fermé » (aucune balise de composant, aucun `<slot>`, aucun
//    `{{html}}`, aucun module dynamique, aucun code qui écrit du DOM) n'installe plus le guetteur de
//    balises : 1 guetteur par instance au lieu de 2, et le retrait de `mjs-loading` ne réveille plus rien ;
//  - tout ce qui pouvait faire apparaître une balise `mjs-*` non définie garde son guetteur et charge
//    toujours le composant : enfant dans un `{if}`, `<@module $comp>` qui change, contenu glissé, `{{html}}` ;
//  - le guetteur d'attributs reste (thème, `layout`, relecture des props en dépendent) : un attribut
//    changé de l'extérieur met toujours la prop à jour, un attribut posé avant la définition aussi ;
//  - un composant léger (`mjs-light`, sans ombre) garde ses deux guetteurs : son contenu glissé vit dans
//    SON sous-arbre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // feuille : texte et attributs seulement
  'feuille.mjs':    '<script>\n  $titre = "x"\n  $monTitre = "y"\n  $actif = false\n</script>\n<p class="t">{$titre}|{$monTitre}|{$actif}</p>\n',
  'nombre.mjs':     '<vars>\n  $n  int 0..100\n</vars>\n<p class="n">{$n}</p>\n',
  'nue.mjs':        '<p class="t">nue</p>\n<style>\n.t\n  color: red\n</style>\n<style name="bandeau">\n.t\n  color: blue\n</style>\n',
  'enfant.mjs':     '<p class="e">enfant</p>\n',
  'vide.mjs':       '<p class="v">vide</p>\n',
  'avecenfant.mjs': '<script>\n  $show = false\n</script>\n{if $show}<@enfant></@enfant>{end}\n',
  'dyn.mjs':        '<script>\n  $c = "mjs-vide"\n</script>\n<@module $c>x</@module>\n',
  'boite.mjs':      '<div class="b"><slot></slot></div>\n',
  'glisse.mjs':     '<script>\n  $show = false\n</script>\n{if $show}<@boite><@enfant></@enfant></@boite>{end}\n',
  'htmlinj.mjs':    '<script>\n  $h = ""\n</script>\n<div class="h">{{$h}}</div>\n',
  'liste.mjs':      '<script>\n  $v = "a"\n  $liste = Array.from({ length: 1000 }, (_, i) => i)\n</script>\n{for i, n in $liste}<@feuille titre={$v}></@feuille>{end}\n',
}

let racine = ''
let sortie = ''
let fichiers: string[] = []

const attendre = async (cond: () => boolean, ms = 3000) => {
  const fin = Date.now() + ms
  while(!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const fichierDe = (nom: string) => fichiers.find((f) => f.startsWith(nom + '-'))!
const lire = (f: string) => stripEsm(readFileSync(join(sortie, f), 'utf-8'))

type Compte = { crees: number, observes: number, rappelsMjsLoading: number }

// fenêtre happy-dom : le cœur évalué, les composants demandés évalués ensuite (les autres restent
// non définis, leurs balises sont « jamais vues »), `MutationObserver` compté, `µ.Autoloader.load` espionné
function monter(composants: string[], opts: { avant?: string, definir?: boolean } = {}) {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const compte: Compte = { crees: 0, observes: 0, rappelsMjsLoading: 0 }
  const natif = window.MutationObserver
  window.MutationObserver = class extends natif {
    constructor(cb: any) {
      super((records: any[], obs: any) => {
        if(records.length && records.every((r: any) => r.attributeName === 'mjs-loading')) compte.rappelsMjsLoading++
        return cb(records, obs)
      })
      compte.crees++
    }
    observe(...a: any[]) { compte.observes++; return super.observe(...a) }
  }
  window.eval(lire(fichierDe('mjs_core')) + '\nglobalThis.µ = µ;')
  const charges: string[] = []
  window.eval('µ.paths = { enfant: "enfant.js", vide: "vide.js" }; globalThis.__charges = [];')
  window.µ.Autoloader.load = (tag: string) => { charges.push(String(tag).toLowerCase()) }
  if(opts.avant) window.document.body.innerHTML = opts.avant
  for(const c of composants) window.eval(lire(fichierDe(c)))
  return { window, compte, charges }
}

describe('guetteurs — installés seulement quand ils servent', function () {
  this.timeout(120000)

  before(async () => {
    racine = mjsTmp('guetteurs-utiles')
    const srcDir = join(racine, 'src')
    sortie = join(racine, 'out')
    mkdirSync(srcDir, { recursive: true })
    for(const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: sortie, manifestPath: join(racine, 'bundle.js'), runtime: ['layout_variant', 'theme'] })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    fichiers = readdirSync(sortie).filter((f) => f.endsWith('.js'))
  })
  after(async () => { await terminateSharedWorkerPool() })

  describe('ce qui était installé pour rien', () => {
    it('100 instances d\'une feuille (texte et attributs seulement) : un seul guetteur et un seul `observe` par instance', async () => {
      const { window, compte } = monter(['feuille'])
      window.document.body.innerHTML = '<mjs-feuille></mjs-feuille>'.repeat(100)
      await pause(100)
      assert.equal(window.document.querySelectorAll('mjs-feuille').length, 100)
      assert.equal(compte.crees, 100, `MutationObserver créés : ${compte.crees} (attendu 100, 1 par instance)`)
      assert.equal(compte.observes, 100, `appels observe : ${compte.observes} (attendu 100, 1 par instance)`)
    })

    it('le retrait de `mjs-loading` ne réveille plus le guetteur d\'attributs (aucun rappel pour ce seul nom)', async () => {
      const { window, compte } = monter(['feuille'])
      window.document.body.innerHTML = '<mjs-feuille></mjs-feuille>'.repeat(20)
      await pause(100)
      assert.equal(window.document.querySelector('mjs-feuille').hasAttribute('mjs-loading'), false, 'mjs-loading bien retiré')
      assert.equal(compte.rappelsMjsLoading, 0, `rappels déclenchés par mjs-loading : ${compte.rappelsMjsLoading}`)
    })

    it('le composant léger garde ses deux guetteurs (son contenu glissé vit dans son propre sous-arbre)', async () => {
      // la légèreté se décide au constructeur : `µ._mjs_lightNext` la désigne pour la prochaine création
      // (happy-dom ne pose pas les attributs avant le constructeur, un vrai navigateur à la mise à niveau si)
      const { window, compte } = monter(['feuille'])
      for(let i = 0; i < 10; i++) {
        window.µ._mjs_lightNext = 'mjs-feuille'
        window.document.body.appendChild(window.document.createElement('mjs-feuille'))
      }
      await pause(100)
      assert.equal(window.document.querySelector('mjs-feuille')._mjs_isLight, true, 'instance bien légère')
      assert.equal(compte.crees, 20, `MutationObserver créés : ${compte.crees} (attendu 20, 2 par composant léger)`)
      assert.equal(compte.observes, 20)
    })
  })

  describe('gardes — une balise de composant qui apparaît plus tard est toujours chargée', () => {
    it('un `{if}` fait apparaître un enfant `<@enfant>` jamais vu : il est chargé', async () => {
      const { window, charges } = monter(['avecenfant'])
      window.document.body.innerHTML = '<mjs-avecenfant></mjs-avecenfant>'
      await pause(60)
      assert.deepEqual(charges, [], 'rien à charger tant que le bloc est fermé')
      window.document.querySelector('mjs-avecenfant')._set('show', true)
      await attendre(() => charges.includes('mjs-enfant'))
      assert.deepEqual(charges, ['mjs-enfant'])
    })

    it('un enfant défini plus tard, une fois chargé, se monte dans le gabarit du parent', async () => {
      const { window } = monter(['avecenfant', 'enfant'])
      window.document.body.innerHTML = '<mjs-avecenfant></mjs-avecenfant>'
      await pause(60)
      const hote = window.document.querySelector('mjs-avecenfant')
      hote._set('show', true)
      await attendre(() => !!hote._shadow.querySelector('mjs-enfant')?._shadow?.querySelector('.e'))
      assert.ok(hote._shadow.querySelector('mjs-enfant')._shadow.querySelector('.e'), 'enfant monté')
    })

    it('`<@module $comp>` qui change : chaque nouvelle balise non définie est chargée', async () => {
      const { window, charges } = monter(['dyn'])
      window.document.body.innerHTML = '<mjs-dyn></mjs-dyn>'
      await attendre(() => charges.includes('mjs-vide'))
      assert.ok(charges.includes('mjs-vide'), `chargés : ${charges.join(',')}`)
      window.document.querySelector('mjs-dyn')._set('c', 'mjs-enfant')
      await attendre(() => charges.includes('mjs-enfant'))
      assert.ok(charges.includes('mjs-enfant'), `chargés : ${charges.join(',')}`)
    })

    it('contenu glissé dans un `<slot>` : un composant non défini posé dans le document est chargé', async () => {
      const { window, charges } = monter(['boite'])
      window.µ.Autoloader.observe(window.document.body)
      window.document.body.innerHTML = '<mjs-boite><mjs-enfant></mjs-enfant></mjs-boite>'
      await attendre(() => charges.includes('mjs-enfant'))
      assert.ok(charges.includes('mjs-enfant'), `chargés : ${charges.join(',')}`)
    })

    it('contenu glissé dans un `<slot>` par un parent à `{if}` : le composant non défini est chargé', async () => {
      const { window, charges } = monter(['glisse', 'boite'])
      window.document.body.innerHTML = '<mjs-glisse></mjs-glisse>'
      await pause(60)
      window.document.querySelector('mjs-glisse')._set('show', true)
      await attendre(() => charges.includes('mjs-enfant'))
      assert.ok(charges.includes('mjs-enfant'), `chargés : ${charges.join(',')}`)
    })

    it('`{{html}}` qui injecte une balise `mjs-*` : elle est chargée', async () => {
      const { window, charges } = monter(['htmlinj'])
      window.document.body.innerHTML = '<mjs-htmlinj></mjs-htmlinj>'
      await pause(60)
      window.document.querySelector('mjs-htmlinj')._set('h', '<mjs-enfant></mjs-enfant>')
      await attendre(() => charges.includes('mjs-enfant'))
      assert.deepEqual(charges, ['mjs-enfant'])
    })

    it('composant cœur `<@@nom>` dans le gabarit : l\'appel du guetteur de balises reste émis', async () => {
      const { output } = await transpile('<@@button>ok</@@button>', { moduleName: 'demo-coeur' })
      assert.ok(output.includes('Autoloader?.observe'), 'le guetteur de balises doit rester pour un gabarit qui porte un composant cœur')
    })

    it('gabarit fermé : l\'appel du guetteur de balises disparaît du code compilé ; gabarit à enfant : il reste', async () => {
      const ferme = await transpile(SOURCES['feuille.mjs'], { moduleName: 'demo-ferme' })
      assert.equal(ferme.output.includes('\n    µ?.Autoloader?.observe?.'), false, 'feuille fermée : plus d\'appel direct')
      assert.ok(ferme.output.includes('if(this._mjs_isLight) µ?.Autoloader?.observe?.'), 'feuille fermée : le guetteur ne reste que pour l\'instance légère')
      for(const nom of ['avecenfant', 'dyn', 'boite', 'htmlinj']) {
        const { output } = await transpile(SOURCES[nom + '.mjs'], { moduleName: 'demo-' + nom })
        assert.ok(output.includes('\n    µ?.Autoloader?.observe?.'), nom + ' : l\'appel direct doit rester')
      }
    })
  })

  describe('gardes — un attribut changé de l\'extérieur met toujours la prop à jour', () => {
    it('chaîne : `setAttribute(\'titre\', \'x\')` après coup', async () => {
      const { window } = monter(['feuille'])
      window.document.body.innerHTML = '<mjs-feuille></mjs-feuille>'
      await pause(60)
      const el = window.document.querySelector('mjs-feuille')
      el.setAttribute('titre', 'bonjour')
      await attendre(() => el._state.titre === 'bonjour')
      assert.equal(el._state.titre, 'bonjour')
      await attendre(() => el._shadow.querySelector('.t').textContent.startsWith('bonjour'))
      assert.ok(el._shadow.querySelector('.t').textContent.startsWith('bonjour'), 'le texte suit')
    })

    it('kebab-case vers camelCase : `mon-titre` met `monTitre` à jour', async () => {
      const { window } = monter(['feuille'])
      window.document.body.innerHTML = '<mjs-feuille></mjs-feuille>'
      await pause(60)
      const el = window.document.querySelector('mjs-feuille')
      el.setAttribute('mon-titre', 'zed')
      await attendre(() => el._state.monTitre === 'zed')
      assert.equal(el._state.monTitre, 'zed')
    })

    it('booléen : `actif="true"` puis `actif="false"`', async () => {
      const { window } = monter(['feuille'])
      window.document.body.innerHTML = '<mjs-feuille></mjs-feuille>'
      await pause(60)
      const el = window.document.querySelector('mjs-feuille')
      el.setAttribute('actif', 'true')
      await attendre(() => el._state.actif === true)
      assert.strictEqual(el._state.actif, true)
      el.setAttribute('actif', 'false')
      await attendre(() => el._state.actif === false)
      assert.strictEqual(el._state.actif, false)
    })

    it('nombre : prop typée `int`, l\'attribut « 12 » donne le nombre 12', async () => {
      const { window } = monter(['nombre'])
      window.document.body.innerHTML = '<mjs-nombre></mjs-nombre>'
      await pause(60)
      const el = window.document.querySelector('mjs-nombre')
      el.setAttribute('n', '12')
      await attendre(() => el._state.n === 12)
      assert.strictEqual(el._state.n, 12)
    })

    it('attribut posé AVANT la définition du composant (mise à niveau) : la prop part de lui', async () => {
      const { window } = monter([], { avant: '<mjs-feuille titre="avant" mon-titre="deux" actif="true"></mjs-feuille>' })
      window.eval(lire(fichierDe('feuille')))
      const el = window.document.querySelector('mjs-feuille')
      await attendre(() => !!el._shadow)
      await pause(60)
      assert.equal(el._state.titre, 'avant')
      assert.equal(el._state.monTitre, 'deux')
      assert.strictEqual(el._state.actif, true)
    })

    it('composant sans prop déclarée : `layout` appliqué, `theme`/`class`/`data-*`/`aria-*` posés sans erreur ni fausse prop', async () => {
      const { window } = monter(['nue'])
      const demandes: string[] = []
      window.fetch = (url: string) => { demandes.push(String(url)); return Promise.resolve({ ok: true, status: 200, text: async () => '.t{color:blue}' }) }
      window.document.body.innerHTML = '<mjs-nue></mjs-nue>'
      await pause(60)
      const el = window.document.querySelector('mjs-nue')
      el.setAttribute('theme', 'gold')
      el.setAttribute('class', 'a b')
      el.setAttribute('data-x', '1')
      el.setAttribute('aria-label', 'nue')
      el.setAttribute('layout', 'bandeau')
      await attendre(() => demandes.some((u) => /nue\.bandeau\.css/.test(u)))
      assert.ok(demandes.some((u) => /nue\.bandeau\.css/.test(u)), `layout non appliqué, requêtes : ${demandes.join(',')}`)
      assert.equal(el.getAttribute('theme'), 'gold')
      for(const k of ['class', 'data-x', 'dataX', 'aria-label', 'ariaLabel']) assert.equal(el._state[k], undefined, `${k} ne devient pas une prop`)
    })

    it('un composant feuille dans une liste de 1 000 reçoit le changement de prop du parent', async () => {
      const { window } = monter(['liste', 'feuille'])
      window.document.body.innerHTML = '<mjs-liste></mjs-liste>'
      const hote = window.document.querySelector('mjs-liste')
      await attendre(() => hote._shadow?.querySelectorAll('mjs-feuille').length === 1000, 20000)
      const feuilles = Array.from(hote._shadow.querySelectorAll('mjs-feuille')) as any[]
      assert.equal(feuilles.length, 1000)
      hote._set('v', 'b')
      await attendre(() => feuilles.every((f) => f._state.titre === 'b'), 20000)
      assert.equal(feuilles.filter((f) => f._state.titre !== 'b').length, 0)
    })
  })
})
