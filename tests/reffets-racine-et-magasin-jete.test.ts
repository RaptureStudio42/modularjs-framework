// `µeffect.root` et `magasin.destroy()`. Une racine lance des reffets à la demande, dans un gestionnaire (Civet, CoffeeScript,
// JavaScript), au premier niveau d'un `<script>` (JavaScript, TypeScript), dans une fonction d'un module appelée plus tard ou au premier niveau
// d'un module : ils passent une fois, puis à chaque changement de ce qu'ils lisent ; la fonction rendue les arrête tous (plus aucun
// passage, nettoyage joué une fois, un deuxième appel ne fait rien) ; une racine ouverte dans une autre s'arrête avec elle ; le fichier
// d'un module exécuté de nouveau arrête les racines ouvertes à son premier niveau. Un magasin jeté arrête les reffets de la racine qui
// l'a créé, ou de son module, ne prévient plus personne et reste lisible ; une clé de données nommée `destroy` ne gêne rien. Hors
// racine, un `µeffect` dans une fonction appelée plus tard reste refusé, et le refus cite `µeffect.root`. Reste de la suite des
// reffets : un gestionnaire de `<@window>` déclenché par un reffet lit pour lui seul.
// Côté serveur, aucune racine ne lève et aucun de ses reffets ne tourne.
// Les passages sont comptés pas à pas, en production non minifiée puis en développement. happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import { lintEffectTopLevel } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'rc-js': `<script lang="js">
$n = 0;
let arret = null;
let double = null;
@ouvrir = function() { arret = µeffect.root(() => { µeffect(() => { window.__n.js++; window.__v.js = $n + ':' + $$panier; return () => { window.__n.jsFin++; }; }); µeffect.before(() => { window.__n.jsAvant++; window.__v.jsAvant = $n; }); }); };
@fermer = function() { arret(); };
@ouvrirDouble = function() { double = µeffect.root(() => { µeffect.root(() => { µeffect(() => { window.__n.dedans++; window.__v.dedans = $n; }); }); }); };
@fermerDouble = function() { double(); };
@ecrire = function(v) { $n = v; };
@ecrirePanier = function(v) { $$panier = v; };
</script>
<p>{$n}</p>
`,
  'rc-civet': `<script>
$n = 0
arret = null
@ouvrir = ->
  arret = µeffect.root ->
    µeffect ->
      window.__n.civet++
      window.__v.civet = $n
@fermer = -> arret()
@ecrire = (v) -> $n = v
</script>
<p>{$n}</p>
`,
  'rc-coffee': `<script lang="coffee">
$n = 0
arret = null
@ouvrir = ->
  arret = µeffect.root ->
    µeffect ->
      window.__n.coffee++
      window.__v.coffee = $n
      return
    return
  return
@fermer = -> arret()
@ecrire = (v) -> $n = v
</script>
<p>{$n}</p>
`,
  'rc-ts': `<script lang="ts">
µeffect((): void => { (window as any).__n.tsTemoin++; });
const arret: () => void = µeffect.root((): void => { µeffect((): void => { (window as any).__n.ts++; (window as any).__v.ts = $$cleTs; }); });
(window as any).__arretTs = arret;
</script>
<p>t</p>
`,
  'rc-haut': `<script lang="js">
$x = 0;
const arretHaut = µeffect.root(() => { µeffect(() => { window.__n.haut++; window.__v.haut = $x; }); });
@ecrire = function(v) { $x = v; };
@fermer = function() { arretHaut(); };
</script>
<p>{$x}</p>
`,
  'rc-module': `<script lang="js">
@import suivre 'rc-outils.module.civet.mjs'
@import sansRacine 'rc-outils.module.civet.mjs'
@import µ$$compteur 'rc-outils.module.civet.mjs'
@import arretModule 'rc-outils.module.civet.mjs'
let arret = null;
@demarrer = function() { arret = suivre(); };
@arreter = function() { arret(); };
@incrementer = function() { µ$$compteur.v++; };
@ecrireModule = function(v) { $$panierModule = v; };
@ecrireHaut = function(v) { $$panierHaut = v; };
@essayerSansRacine = function() { sansRacine(); };
@arreterModule = function() { arretModule(); };
</script>
<p>m</p>
`,
  'rc-salon': `<script lang="js">
@import ouvrirSalon 'rc-salon.module.civet.mjs'
@import panneau 'rc-salon.module.civet.mjs'
let salon = null;
@ouvrir = function() { salon = ouvrirSalon(); };
@poster = function() { salon.data.messages++; };
@jeter = function() { salon.destroy(); };
@lireCle = function() { return salon.data.destroy + ':' + salon.data.messages; };
@ecrireCle = function(v) { salon.data.destroy = v; };
@ecrirePanneau = function(v) { panneau.data.ouvert = v; };
@jeterPanneau = function() { panneau.destroy(); };
</script>
<p>{panneau.data.ouvert}</p>
`,
  'rc-fenetre': `<script>
$total = 0
$n = 0
µeffect ->
  window.__n.fenetre++
  window.__v.fenetre = $n
  window.dispatchEvent new window.Event 'resize'
@pousser = -> $n += 1
@lireTotal = -> $total
</script>
<@window @resize={$total = $total + 1}></@window>
<p>{$total}</p>
`,
}

const MODULES: Record<string, string> = {
  'rc-outils.module.civet.mjs': [
    'export µ$$compteur = { v: 0 }',
    '',
    'export suivre = ->',
    '  µeffect.root ->',
    '    µeffect ->',
    '      window.__n.module++',
    '      window.__v.module = µ$$compteur.v + \':\' + $$panierModule',
    '',
    'export sansRacine = ->',
    '  µeffect ->',
    '    window.__n.sansRacine++',
    '',
    'export arretModule = µeffect.root ->',
    '  µeffect ->',
    '    window.__n.premierNiveau++',
    '    window.__v.premierNiveau = $$panierHaut',
    '',
  ].join('\n'),
  'rc-salon.module.civet.mjs': [
    'export ouvrirSalon = ->',
    '  salon = null',
    '  µeffect.root ->',
    '    salon = new µStore(messages: 0, destroy: \'cle\')',
    '    µeffect ->',
    '      window.__n.salon++',
    '      window.__v.salon = salon.data.messages',
    '  salon',
    '',
    'export panneau = new µStore(ouvert: 0)',
    '',
    'µeffect ->',
    '  window.__n.panneau++',
    '  window.__v.panneau = panneau.data.ouvert',
    '',
  ].join('\n'),
}

const PAGE  = Object.keys(COMPOSANTS)
const CORPS = PAGE.map((n) => `<mjs-${n}></mjs-${n}>`).join('')
const COMPTES = ['js', 'jsFin', 'jsAvant', 'dedans', 'civet', 'coffee', 'ts', 'tsTemoin', 'haut', 'module', 'sansRacine', 'premierNiveau', 'salon', 'panneau', 'fenetre']

// joué dans la page, pas à pas : un geste, puis les passages de chaque reffet depuis le pas précédent
const SCENARIO = `(async () => {
  const el = (n) => document.querySelector('mjs-' + n)
  const attendre = () => new Promise((r) => setTimeout(r, 0))
  const R = []
  const pas = async (nom, geste) => {
    for (const k in window.__n) window.__n[k] = 0
    geste()
    await attendre()
    await attendre()
    const vus = {}
    for (const k in window.__n) if (window.__n[k] !== 0) vus[k] = window.__n[k]
    R.push([nom, vus])
  }
  await pas('js : ouverture dans un gestionnaire', () => el('rc-js').ouvrir())
  await pas('js : variable lue', () => el('rc-js').ecrire(5))
  await pas('js : clé du magasin lue', () => el('rc-js').ecrirePanier(3))
  await pas('js : arrêt', () => el('rc-js').fermer())
  await pas('js : variable lue après l’arrêt', () => el('rc-js').ecrire(6))
  await pas('js : second arrêt', () => el('rc-js').fermer())
  await pas('racine dans une racine : ouverture', () => el('rc-js').ouvrirDouble())
  await pas('racine dans une racine : variable lue', () => el('rc-js').ecrire(7))
  await pas('racine dans une racine : arrêt de la première', () => el('rc-js').fermerDouble())
  await pas('racine dans une racine : variable lue après l’arrêt', () => el('rc-js').ecrire(8))
  await pas('civet : ouverture', () => el('rc-civet').ouvrir())
  await pas('civet : variable lue', () => el('rc-civet').ecrire(2))
  await pas('civet : arrêt puis variable lue', () => { el('rc-civet').fermer(); el('rc-civet').ecrire(3) })
  await pas('coffee : ouverture', () => el('rc-coffee').ouvrir())
  await pas('coffee : variable lue', () => el('rc-coffee').ecrire(2))
  await pas('coffee : arrêt puis variable lue', () => { el('rc-coffee').fermer(); el('rc-coffee').ecrire(3) })
  await pas('ts : clé du magasin lue', () => { µ.store.cleTs = 2 })
  await pas('ts : arrêt puis clé lue', () => { window.__arretTs(); µ.store.cleTs = 3 })
  await pas('premier niveau du script : variable lue', () => el('rc-haut').ecrire(4))
  await pas('premier niveau du script : arrêt puis variable lue', () => { el('rc-haut').fermer(); el('rc-haut').ecrire(5) })
  await pas('module : ouverture par une fonction appelée plus tard', () => el('rc-module').demarrer())
  await pas('module : µ$$ lu', () => el('rc-module').incrementer())
  await pas('module : clé du magasin lue', () => el('rc-module').ecrireModule(2))
  await pas('module : arrêt puis µ$$ lu', () => { el('rc-module').arreter(); el('rc-module').incrementer() })
  await pas('module : µeffect dans une fonction, sans racine', () => el('rc-module').essayerSansRacine())
  await pas('premier niveau d’un module : clé lue', () => el('rc-module').ecrireHaut(1))
  await pas('premier niveau d’un module : fichier exécuté de nouveau, clé lue', () => { µ._mjs_magOpen('rc-outils.module.civet.mjs'); µ._mjs_magClose(); el('rc-module').ecrireHaut(2) })
  await pas('magasin : salon ouvert', () => el('rc-salon').ouvrir())
  await pas('magasin : message posté', () => el('rc-salon').poster())
  await pas('magasin : clé destroy écrite', () => el('rc-salon').ecrireCle('x'))
  await pas('magasin : salon jeté', () => el('rc-salon').jeter())
  await pas('magasin : message posté après', () => el('rc-salon').poster())
  await pas('magasin : salon jeté une seconde fois', () => el('rc-salon').jeter())
  await pas('magasin du fichier : écrit', () => el('rc-salon').ecrirePanneau(1))
  await pas('magasin du fichier : jeté puis écrit', () => { el('rc-salon').jeterPanneau(); el('rc-salon').ecrirePanneau(2) })
  await pas('<@window> déclenché par un reffet, gestionnaire qui cumule', () => el('rc-fenetre').pousser())
  window.__v.cleSalon = el('rc-salon').lireCle()
  window.__v.total = el('rc-fenetre').lireTotal()
  window.__v.ecran = el('rc-salon')._shadow.querySelector('p').textContent
  return { pas: R, valeurs: window.__v }
})()`

const PASSAGES: [string, Record<string, number>][] = [
  ['js : ouverture dans un gestionnaire', { js: 1, jsAvant: 1 }],
  ['js : variable lue', { js: 1, jsFin: 1, jsAvant: 1 }],
  ['js : clé du magasin lue', { js: 1, jsFin: 1 }],
  ['js : arrêt', { jsFin: 1 }],
  ['js : variable lue après l’arrêt', {}],
  ['js : second arrêt', {}],
  ['racine dans une racine : ouverture', { dedans: 1 }],
  ['racine dans une racine : variable lue', { dedans: 1 }],
  ['racine dans une racine : arrêt de la première', {}],
  ['racine dans une racine : variable lue après l’arrêt', {}],
  ['civet : ouverture', { civet: 1 }],
  ['civet : variable lue', { civet: 1 }],
  ['civet : arrêt puis variable lue', {}],
  ['coffee : ouverture', { coffee: 1 }],
  ['coffee : variable lue', { coffee: 1 }],
  ['coffee : arrêt puis variable lue', {}],
  ['ts : clé du magasin lue', { ts: 1, tsTemoin: 1 }],
  ['ts : arrêt puis clé lue', { tsTemoin: 1 }],
  ['premier niveau du script : variable lue', { haut: 1 }],
  ['premier niveau du script : arrêt puis variable lue', {}],
  ['module : ouverture par une fonction appelée plus tard', { module: 1 }],
  ['module : µ$$ lu', { module: 1 }],
  ['module : clé du magasin lue', { module: 1 }],
  ['module : arrêt puis µ$$ lu', {}],
  ['module : µeffect dans une fonction, sans racine', {}],
  ['premier niveau d’un module : clé lue', { premierNiveau: 1 }],
  ['premier niveau d’un module : fichier exécuté de nouveau, clé lue', {}],
  ['magasin : salon ouvert', { salon: 1 }],
  ['magasin : message posté', { salon: 1 }],
  ['magasin : clé destroy écrite', {}],
  ['magasin : salon jeté', {}],
  ['magasin : message posté après', {}],
  ['magasin : salon jeté une seconde fois', {}],
  ['magasin du fichier : écrit', { panneau: 1 }],
  ['magasin du fichier : jeté puis écrit', {}],
  ['<@window> déclenché par un reffet, gestionnaire qui cumule', { fenetre: 1 }],
]

async function construire(env: 'prod' | 'dev'): Promise<string> {
  const root   = mjsTmp('reffets-racine-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), texte)
  for (const [nom, texte] of Object.entries(MODULES)) writeFileSync(join(srcDir, nom), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

type Jeu = { montage: Record<string, number>, pas: [string, Record<string, number>][], valeurs: Record<string, unknown>, avertissements: string[] }

async function jouer(code: string): Promise<Jeu> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const avertissements: string[] = []
  window.console.warn = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
  try {
    window.__n = Object.fromEntries(COMPTES.map((k) => [k, 0]))
    window.__v = {}
    window.eval(code)
    window.document.body.innerHTML = CORPS
    const fin = Date.now() + 5000
    while (PAGE.some((n) => !window.document.querySelector('mjs-' + n)?._mjs_is_mounted) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 20))
    const montage: Record<string, number> = {}
    for (const k of COMPTES) if (window.__n[k] !== 0) montage[k] = window.__n[k]
    const r = await window.eval(SCENARIO)
    return JSON.parse(JSON.stringify({ montage, pas: r.pas, valeurs: r.valeurs, avertissements }))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('µeffect.root et magasin.destroy() : reffets lancés à la demande, arrêtés, magasin jeté', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  let prod: Jeu
  let dev: Jeu
  before(async () => {
    prod = await jouer(await construire('prod'))
    dev  = await jouer(await construire('dev'))
  })

  it('au montage : la racine du premier niveau du script et celle du module passent une fois, le reffet du fichier du magasin aussi', () => {
    assert.deepEqual(prod.montage, { ts: 1, tsTemoin: 1, haut: 1, premierNiveau: 1, panneau: 1, fenetre: 1 })
    assert.deepEqual(dev.montage, prod.montage)
  })

  it('passages comptés pas à pas, en production puis en développement', () => {
    assert.deepEqual(prod.pas, PASSAGES)
    assert.deepEqual(dev.pas, PASSAGES)
  })

  it('valeurs lues : dernière valeur vue avant l’arrêt, magasin jeté encore lisible, clé destroy intacte', () => {
    assert.deepEqual(prod.valeurs, { js: '5:3', jsAvant: 5, dedans: 7, civet: 2, coffee: 2, ts: 2, haut: 4, module: '1:2', premierNiveau: 1, salon: 1, panneau: 1, fenetre: 1, cleSalon: 'x:2', total: 2, ecran: '1' })
    assert.deepEqual(dev.valeurs, prod.valeurs)
  })

  it('développement : le refus hors racine cite µeffect.root ; magasin jeté écrit, magasin jeté encore lu : un avertissement chacun', () => {
    const avis = dev.avertissements
    assert.equal(avis.filter((a) => /µeffect/.test(a) && /µeffect\.root/.test(a)).length, 1, avis.join('\n'))
    assert.equal(avis.filter((a) => /µeffect/.test(a) && !/µeffect\.root/.test(a)).length, 0, avis.join('\n'))
    assert.equal(avis.filter((a) => /jeté \(destroy\(\)\) : l'écriture/.test(a)).length, 2, avis.join('\n'))
    assert.equal(avis.filter((a) => /alors que <mjs-rc-salon> le lit encore/.test(a)).length, 1, avis.join('\n'))
    assert.equal(avis.filter((a) => /Boucle/.test(a)).length, 0, avis.join('\n'))
  })
})

describe('µeffect.root à la construction : permis partout, son rappel tient lieu de premier niveau', () => {
  it('acceptés : racine dans un gestionnaire (Civet, JavaScript), reffet écrit directement dans son rappel, sur sa ligne ou dessous', () => {
    assert.doesNotThrow(() => lintEffectTopLevel('@ouvrir = ->\n  arret = µeffect.root ->\n    µeffect ->\n      µ.log $n\n    µeffect.before ->\n      µ.log $n'))
    assert.doesNotThrow(() => lintEffectTopLevel('@ouvrir = -> arret = µeffect.root -> µeffect -> µ.log $n'))
    assert.doesNotThrow(() => lintEffectTopLevel('@ouvrir = function() {\n  arret = µeffect.root(() => {\n    if (x) {\n      µeffect(() => { µ.log($n) })\n    }\n  })\n}'))
    assert.doesNotThrow(() => lintEffectTopLevel('µmount ->\n  µeffect.root ->\n    for x in liste\n      µeffect ->\n        µ.log x'))
    assert.doesNotThrow(() => lintEffectTopLevel('suivre = -> µeffect.root(-> µeffect(-> µ.log $n))', true))
  })
  it('refusés, et le refus cite µeffect.root : reffet dans une fonction hors racine, dans un rappel écrit dans la racine, µinspect', () => {
    assert.throws(() => lintEffectTopLevel('@ouvrir = ->\n  µeffect ->\n    µ.log $n'), /µeffect\.root/)
    assert.throws(() => lintEffectTopLevel('@ouvrir = ->\n  µeffect.root ->\n    setTimeout (->\n      µeffect -> µ.log $n\n    ), 10'), /imbriqué/)
    assert.throws(() => lintEffectTopLevel('@o = function() { µeffect.root(() => { setTimeout(() => { µeffect(() => {}) }) }) }'), /imbriqué/)
    assert.throws(() => lintEffectTopLevel('@ouvrir = ->\n  µeffect.root ->\n    µinspect $n'), /imbriqué/)
  })
})

// rendu serveur : une racine au premier niveau d'un `<script>` et d'un module ne lève pas, et aucun de ses reffets ne tourne (ils
// écriraient une clé que le rendu affiche)
describe('µeffect.root au rendu serveur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })
  it('aucune erreur, aucun reffet de racine passé', async () => {
    const src = mjsTmp('reffets-racine-ssr')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'r.module.civet.mjs'), "export arret = µeffect.root ->\n  µeffect ->\n    $$vuModule = 'module'\n")
    writeFileSync(join(src, 'carte.mjs'), `<script lang="js">
@import arret 'r.module.civet.mjs'
$n = 7;
const fin = µeffect.root(() => { µeffect(() => { $$vuScript = 'script'; }); });
</script>
<p class="r">{$n}-{$$vuScript}-{$$vuModule}</p>
`)
    writeFileSync(join(src, 'page.mjs'), '<@carte></@carte>\n')
    const res = await renderToString({ sourceDir: src, tag: 'mjs-page' })
    assert.match(res.html, /<p class="r">7--<\/p>/)
  })
})

// une racine ouverte dans un gestionnaire suit ce que suit un reffet du premier niveau : un `µStore` et un `µ$$x` qu'elle lit (son
// premier passage, en microtâche, les lit pour le composant, qui s'y abonne) ; un composant qui cite `µeffect` dans une chaîne, sans
// aucun reffet dans l'appli, et qui écoute `<@window>` se construit
const COMPOSANTS_LUS: Record<string, string> = {
  'rl-racine': `<script lang="js">
@import mag 'rl-mag.module.civet.mjs'
@import µ$$etat 'rl-mag.module.civet.mjs'
let arret = null;
@ouvrir = function() { arret = µeffect.root(() => { µeffect(() => { window.__n.mag++; window.__v.mag = mag.data.v; }); µeffect(() => { window.__n.etat++; window.__v.etat = µ$$etat.v; }); }); };
@fermer = function() { arret(); };
</script>
<p>r</p>
`,
  'rl-temoin': `<script lang="js">
@import mag2 'rl-mag.module.civet.mjs'
@import µ$$etat2 'rl-mag.module.civet.mjs'
µeffect(() => { window.__n.mag2++; window.__v.mag2 = mag2.data.v; });
µeffect(() => { window.__n.etat2++; window.__v.etat2 = µ$$etat2.v; });
</script>
<p>t</p>
`,
  'rl-ecrivain': `<script lang="js">
@import mag 'rl-mag.module.civet.mjs'
@import mag2 'rl-mag.module.civet.mjs'
@import µ$$etat 'rl-mag.module.civet.mjs'
@import µ$$etat2 'rl-mag.module.civet.mjs'
@ecrire = function(v) { mag.data.v = v; mag2.data.v = v; µ$$etat.v = v; µ$$etat2.v = v; };
</script>
<p>e</p>
`,
}
const MODULES_LUS: Record<string, string> = {
  'rl-mag.module.civet.mjs': 'export mag = new µStore(v: 0)\nexport mag2 = new µStore(v: 0)\nexport µ$$etat = { v: 0 }\nexport µ$$etat2 = { v: 0 }\n',
}

async function construireAvec(nom: string, env: 'prod' | 'dev', composants: Record<string, string>, modules: Record<string, string>): Promise<{ erreurs: string[], code: string }> {
  const root   = mjsTmp(nom + '-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, texte] of Object.entries(composants)) writeFileSync(join(srcDir, n + '.mjs'), texte)
  for (const [n, texte] of Object.entries(modules)) writeFileSync(join(srcDir, n), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  const erreurs = stats.errors.map((e: any) => String(e.message))
  return { erreurs, code: erreurs.length ? '' : readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '') }
}

async function jouerLus(code: string): Promise<[string, Record<string, number>][]> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  try {
    window.__n = { mag: 0, etat: 0, mag2: 0, etat2: 0 }
    window.__v = {}
    window.eval(code)
    window.document.body.innerHTML = Object.keys(COMPOSANTS_LUS).map((n) => `<mjs-${n}></mjs-${n}>`).join('')
    const fin = Date.now() + 5000
    while (Object.keys(COMPOSANTS_LUS).some((n) => !window.document.querySelector('mjs-' + n)?._mjs_is_mounted) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 20))
    return JSON.parse(JSON.stringify(await window.eval(`(async () => {
      const el = (n) => document.querySelector('mjs-' + n)
      const R = []
      const pas = async (nom, geste) => {
        for (const k in window.__n) window.__n[k] = 0
        geste()
        await new Promise((r) => setTimeout(r, 0))
        await new Promise((r) => setTimeout(r, 0))
        const vus = {}
        for (const k in window.__n) if (window.__n[k] !== 0) vus[k] = window.__n[k]
        R.push([nom, vus])
      }
      await pas('ouverture', () => el('rl-racine').ouvrir())
      await pas('écriture', () => el('rl-ecrivain').ecrire(1))
      await pas('réécriture', () => el('rl-ecrivain').ecrire(2))
      await pas('arrêt puis écriture', () => { el('rl-racine').fermer(); el('rl-ecrivain').ecrire(3) })
      return R
    })()`)))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('µeffect.root dans un gestionnaire : un µStore et un µ$$x lus le relancent comme un reffet du premier niveau', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const env of ['prod', 'dev'] as const) {
    it(env + ' : mêmes passages que le témoin du premier niveau, plus aucun après l’arrêt', async () => {
      const b = await construireAvec('reffets-racine-lus', env, COMPOSANTS_LUS, MODULES_LUS)
      assert.deepEqual(b.erreurs, [])
      assert.deepEqual(await jouerLus(b.code), [
        ['ouverture', { mag: 1, etat: 1 }],
        ['écriture', { mag: 1, etat: 1, mag2: 1, etat2: 1 }],
        ['réécriture', { mag: 1, etat: 1, mag2: 1, etat2: 1 }],
        ['arrêt puis écriture', { mag2: 1, etat2: 1 }],
      ])
    })
  }
  it('un composant qui cite µeffect dans une chaîne et écoute <@window>, sans aucun reffet dans l’appli, se construit', async () => {
    const b = await construireAvec('reffets-racine-chaine', 'prod', { 'rl-chaine': `<script>
$w = 0
µ.log 'pas de µeffect ici' if false
</script>
<@window @resize={$w = $w + 1}></@window>
<p>{$w}</p>
` }, {})
    assert.deepEqual(b.erreurs, [])
  })
})
