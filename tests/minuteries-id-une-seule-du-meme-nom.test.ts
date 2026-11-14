// `id:` de µafter et µevery : poser une minuterie sous un nom encore en cours arrête d'abord l'ancienne (comme sa main
// d'arrêt), puis pose la neuve, dont la main est rendue. Portée : le composant ; hors composant (module, magasin), la page.
// µafter et µevery partagent les noms, `always: true` n'y échappe pas, le nom se libère quand la minuterie finit (pendant
// sa pose comprise), une seule minuterie du nom même quand l'onStop de l'ancienne le repose, rien ne part au rendu
// serveur ; un `id` qui n'est pas une chaîne non vide est signalé, puis ignoré. Hors de tout composant actif (module ou
// magasin appelé depuis un gestionnaire), la minuterie vit au niveau de la page, avec ou sans nom.
// Montage RÉEL (happy-dom), clics compris, en développement et en production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// la production minifie et renomme : `import{a as b}from"…";` et `export{a as b}` tiennent au milieu d'une ligne, leurs noms
// passent par `globalThis.__esm` (noms écrits en identifiants : `µ` y est échappé) ; les lignes d'import du développement,
// entières, partent comme avant
const lier     = (l: string) => l.split(',').map(x => x.trim().split(/\s+as\s+/))
const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/\bimport\s*\{([^}]*)\}\s*from\s*(['"])[^'"]+\2\s*;?/g, (_m, l) => 'var ' + lier(l).map(([a, b]) => `${b ?? a}=globalThis.__esm.${a}`).join(',') + ';')
  .replace(/\bexport\s*\{([^}]*)\}\s*;?/g, (_m, l) => 'globalThis.__esm=Object.assign(globalThis.__esm||{},{' + lier(l).map(([a, b]) => `${b ?? a}:${a}`).join(',') + '});')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
const bouton   = (el: any, classe: string) => {
  const b = (el._shadow ?? el.shadowRoot ?? el).querySelector('button.' + classe)
  if (!b) throw new Error(`bouton .${classe} introuvable : ${el.outerHTML}`)
  return b
}

// code de module (aucun composant en tête de l'appel, comme un magasin) : le nom vaut pour la page ; chaque appel se numérote ;
// `poserClic`, appelé depuis un gestionnaire, hors de tout composant actif : µafter, µevery et un µafter nommé
const MODULE = "window.poserPage = function() { var qui = window.__n = (window.__n || 0) + 1; return µ.after(30, { id: 'page' }, function() { (window.__page = window.__page || []).push(qui) }) };" +
  " window.poserClic = function() { µ.after(20, function() { window.__clic = (window.__clic || 0) + 1 }); µ.every(10, { times: 2 }, function() { window.__clicE = (window.__clicE || 0) + 1 }); µ.after(20, { id: 'clic' }, function() { window.__clicId = (window.__clicId || 0) + 1 }) };"

// tableaux nés dans la fenêtre happy-dom : comparés par Array.from (l'égalité stricte lit aussi le prototype)
// compile un composant unique (en production si demandé) et rend une fenêtre happy-dom prête à le monter, avertissements relevés
async function monterComposant(nom: string, source: string, prod = false) {
  const root   = mjsTmp('every-id')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler: any = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(prod ? { env: 'prod' } : {}) } as any)
  const stats        = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  assert.equal(bundler.isProd(), prod, prod ? 'construction de production' : 'construction de développement')
  const win: any       = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  win.console.warn     = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
  const files    = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  const compFile = files.find((f: string) => new RegExp('^' + nom + '-').test(f))
  assert.ok(coreFile && compFile, 'cœur + composant compilés')
  win.eval(`${stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))}\nglobalThis.µ = typeof µ !== 'undefined' ? µ : globalThis.__esm.µ;\n${MODULE}\n${stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))}`)
  const doc: any = win.document
  const poser    = () => {
    const el: any = doc.createElement('mjs-' + nom)
    doc.body.appendChild(el)
    return el
  }
  return { win, doc, poser, avis }
}

const FRAPPE = [
  '<p>{$tirs}</p>',
  '<button class="frappe" @click={-> mains.push(µafter 30, id: \'sauver\', -> $tirs = $tirs + 1)}>Frappe</button>',
  '<button class="vieille" @click={-> mains[mains.length - 2]()}>Avant-dernière main</button>',
  '<button class="horloge-a" @click={-> µevery 20, id: \'horloge\', -> $a = $a + 1}>Horloge A</button>',
  '<button class="horloge-b" @click={-> µevery 20, id: \'horloge\', -> $b = $b + 1}>Horloge B</button>',
  '<button class="apres" @click={-> µafter 20, id: \'horloge\', -> $c = $c + 1}>µafter du même nom</button>',
  '<button class="toujours" @click={-> µafter 30, id: \'annonce\', always: true, -> window.__toujours = (window.__toujours ?? 0) + 1}>Toujours</button>',
  '<button class="libre" @click={-> µafter 20, id: \'libre\', -> $libre = $libre + 1}>Libre</button>',
  '<button class="vide" @click={-> µafter 20, id: \'\', -> $vide = $vide + 1}>Nom vide</button>',
  '<button class="nombre" @click={-> µafter 20, id: 7, -> $vide = $vide + 1}>Nom nombre</button>',
  '<button class="fois" @click={-> µevery 10, id: \'fois\', times: 1, -> $fois = $fois + 1}>times 1</button>',
  '<button class="tantque" @click={-> µevery 10, id: \'tantque\', while: (-> false), -> $fois = $fois + 1}>while faux</button>',
  '<button class="zero" @click={-> µevery 10, id: \'zero\', times: 0, -> $fois = $fois + 1}>times 0</button>',
  '<button class="reentrant" @click={-> reentrant()}>onStop qui repose le nom</button>',
  '<button class="clic-module" @click={-> window.poserClic()}>Module depuis un gestionnaire</button>',
  '<script>',
  '$tirs = 0',
  '$a = 0',
  '$b = 0',
  '$c = 0',
  '$libre = 0',
  '$vide = 0',
  '$fois = 0',
  'mains = []',
  'relance = ->',
  '  window.__re = false',
  '  µafter 30, id: \'r\', -> window.__rOnStop = (window.__rOnStop ?? 0) + 1',
  'reentrant = -> µafter 30, id: \'r\', onStop: (-> relance() if window.__re), -> window.__rTir = (window.__rTir ?? 0) + 1',
  'µafter 30, id: \'local\', -> window.__local = (window.__local ?? 0) + 1',
  'window.poserPage()',
  '</script>'
].join('\n')

describe('µafter / µevery `id:` — une minuterie neuve du même nom arrête l\'ancienne', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('relancée à chaque frappe : 10 frappes, un seul tir ; la main de la remplacée, appelée après coup, laisse partir la neuve', async function () {
    const { poser } = await monterComposant('frappe', FRAPPE)
    const el: any   = poser()
    await attendre(20)
    for (let i = 0; i < 10; i++) bouton(el, 'frappe').click()
    await attendre(10)
    assert.equal(el._state.tirs, 0, 'rien avant le délai')
    await attendre(90)
    assert.equal(el._state.tirs, 1, `une seule sauvegarde pour 10 frappes (tirs = ${el._state.tirs})`)
    bouton(el, 'frappe').click()
    bouton(el, 'frappe').click()
    bouton(el, 'vieille').click()
    await attendre(90)
    assert.equal(el._state.tirs, 2, `la main de la minuterie remplacée ne touche pas la neuve (tirs = ${el._state.tirs})`)
  })

  it('µevery remplacé par un µevery du même nom, puis par un µafter du même nom : les deux runes partagent les noms', async function () {
    const { poser } = await monterComposant('horloge', FRAPPE)
    const el: any   = poser()
    await attendre(20)
    bouton(el, 'horloge-a').click()
    await attendre(50)
    assert.ok(el._state.a >= 2, `l'horloge A tourne (a = ${el._state.a})`)
    bouton(el, 'horloge-b').click()
    const a = el._state.a
    await attendre(70)
    assert.equal(el._state.a, a, 'l\'horloge A est arrêtée par la neuve du même nom')
    assert.ok(el._state.b >= 2, `l'horloge B tourne (b = ${el._state.b})`)
    bouton(el, 'apres').click()
    const b = el._state.b
    await attendre(70)
    assert.equal(el._state.b, b, 'le µafter du même nom arrête le µevery')
    assert.equal(el._state.c, 1, 'puis tire une fois')
  })

  it('portée : deux composants au même nom ne se gênent pas ; hors composant (module), le nom vaut pour la page', async function () {
    const { poser, win } = await monterComposant('portee', FRAPPE)
    poser()
    poser()
    await attendre(100)
    assert.equal(win.__local, 2, 'chaque composant garde sa minuterie du même nom')
    assert.deepEqual(Array.from(win.__page ?? []), [2], `la pose du module par le second composant arrête celle du premier (page = ${JSON.stringify(win.__page)})`)
  })

  it('always: true sous un nom : la neuve arrête quand même l\'ancienne, composant retiré compris', async function () {
    const { poser, doc, win } = await monterComposant('toujours', FRAPPE)
    const el: any             = poser()
    await attendre(20)
    bouton(el, 'toujours').click()
    bouton(el, 'toujours').click()
    doc.body.removeChild(el)
    await attendre(100)
    assert.equal(win.__toujours, 1, `une seule annonce (${win.__toujours})`)
  })

  it('le nom se libère quand la minuterie finit : après le tir, le même nom repart', async function () {
    const { poser } = await monterComposant('libre', FRAPPE)
    const el: any   = poser()
    await attendre(20)
    bouton(el, 'libre').click()
    assert.ok(el._mjs_minuteries.noms?.has('libre'), 'le nom est pris pendant l\'attente')
    await attendre(70)
    assert.equal(el._state.libre, 1, 'premier tir')
    assert.equal(el._mjs_minuteries.noms.has('libre'), false, 'le tir libère le nom')
    bouton(el, 'libre').click()
    await attendre(70)
    assert.equal(el._state.libre, 2, 'le même nom repart après le tir')
    assert.equal(el._mjs_minuteries.noms.size, 0, 'plus aucun nom pris une fois les minuteries finies')
  })

  it('le nom se libère aussi quand la minuterie finit pendant sa pose : `times: 1` et son tir immédiat, `while` faux, `times: 0`', async function () {
    const { poser } = await monterComposant('finie', FRAPPE)
    const el: any   = poser()
    await attendre(20)
    bouton(el, 'fois').click()
    bouton(el, 'tantque').click()
    bouton(el, 'zero').click()
    await attendre(40)
    assert.equal(el._state.fois, 1, '`times: 1` tire une fois, tout de suite ; `while` faux et `times: 0` jamais')
    const pris = Array.from(el._mjs_minuteries.noms?.keys() ?? []).filter((n: any) => ['fois', 'tantque', 'zero'].includes(n))
    assert.deepEqual(pris, [], `aucun nom gardé par une minuterie finie (${JSON.stringify(pris)})`)
  })

  it('l\'onStop de la remplacée repose le même nom : une seule minuterie de ce nom tourne, la neuve', async function () {
    const { poser, win } = await monterComposant('reentrant', FRAPPE)
    const el: any        = poser()
    await attendre(20)
    bouton(el, 'reentrant').click()
    win.__re = true
    bouton(el, 'reentrant').click()
    await attendre(100)
    assert.equal(win.__rTir, 1, 'la neuve tire')
    assert.equal(win.__rOnStop, undefined, 'celle que l\'onStop de la remplacée a posée sous ce nom est arrêtée')
    assert.equal(el._mjs_minuteries.noms.has('r'), false, 'nom libéré après le tir')
  })

  it('module appelé depuis un gestionnaire, hors de tout composant actif : la minuterie vit au niveau de la page, avec ou sans nom', async function () {
    const { poser, win, avis } = await monterComposant('clic', FRAPPE)
    const el: any              = poser()
    await attendre(20)
    bouton(el, 'clic-module').click()
    bouton(el, 'clic-module').click()
    await attendre(100)
    assert.equal(win.__clic, 2, `µafter sans nom : un tir par clic (${win.__clic})`)
    assert.equal(win.__clicE, 4, `µevery \`times: 2\` : deux tirs par clic (${win.__clicE})`)
    assert.equal(win.__clicId, 1, `µafter nommé : le second clic remplace le premier (${win.__clicId})`)
    // le code de module de ce banc est évalué tel quel, hors de la construction : l'avertissement de développement d'une
    // minuterie qu'elle n'a pas vue y part ; celui d'un appel qui ne ferait rien en développement, jamais
    assert.deepEqual(avis.filter(a => /il ne fait rien|does nothing/.test(a)), [], 'aucun avertissement « il ne fait rien »')
  })

  it('id qui n\'est pas une chaîne non vide : signalé, ignoré, la minuterie part quand même', async function () {
    const { poser, avis } = await monterComposant('vide', FRAPPE)
    const el: any         = poser()
    await attendre(20)
    bouton(el, 'vide').click()
    bouton(el, 'nombre').click()
    await attendre(70)
    assert.equal(el._state.vide, 2, 'les deux minuteries partent, sans nom')
    const sur = avis.filter(a => /« id »|"id"/.test(a))
    assert.ok(sur.length >= 1, `avertissement attendu : ${JSON.stringify(avis)}`)
    assert.ok(sur.every(a => /non vide|non-empty/.test(a) && !/inconnue|unknown/.test(a)), `l'avertissement dit ce qu'attend « id » : ${JSON.stringify(sur)}`)
  })

  it('rendu serveur : rien ne part, nom ou pas', async function () {
    const { poser, win } = await monterComposant('serveur', FRAPPE)
    win.µ._isServer = true
    poser()
    await attendre(80)
    assert.equal(win.__local, undefined, 'la minuterie nommée du composant ne part pas')
    assert.equal(win.__page, undefined, 'celle du module non plus')
  })

  it('production : 10 frappes, un seul tir ; le nom de la page aussi', async function () {
    const { poser, win } = await monterComposant('production', FRAPPE, true)
    const el: any        = poser()
    poser()
    await attendre(20)
    for (let i = 0; i < 10; i++) bouton(el, 'frappe').click()
    await attendre(100)
    assert.equal(el._state.tirs, 1, `une seule sauvegarde pour 10 frappes (tirs = ${el._state.tirs})`)
    assert.deepEqual(Array.from(win.__page ?? []), [2], `un seul tir pour la page (page = ${JSON.stringify(win.__page)})`)
  })
})
