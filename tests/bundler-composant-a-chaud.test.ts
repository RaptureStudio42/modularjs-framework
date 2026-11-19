// Rechargement à chaud des composants sous `mjs dev` : verdict du bundler (`stats.hot`). Un recompile où seuls des composants déjà
// connus changent, sans changer de nature, rend la liste de leurs nouveaux fichiers (la page les importe et redessine ses instances en
// gardant leur état) ; au moindre doute, null : rechargement complet de la page, comme pour tout le reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import WebSocket from 'ws'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { hotScriptFacts } from '../src/bundler/transpile-msg.js'
import { StaticServer } from '../src/server/index.js'
import { hmrClientSnippet } from '../src/server/hmr.js'
import { extractMarked } from './helpers/extract-marked.js'

const COMP_V1 = [
  '<script>',
  '$count = 0',
  'inc = -> $count++',
  'µmount -> console.log("monté")',
  '</script>',
  '<button class="plus" @click={inc}>+</button>',
  '<p class="t">v1 {$count}</p>',
  '<style>',
  '.t',
  '  color: red',
  '</style>',
].join('\n')

function projet(prefixe: string, fichiers: Record<string, string>, opts: Record<string, unknown> = {}) {
  const root = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, code] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), code)
  const b = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'dev', ...opts } as any)
  ;(b as any).cssOnlyTracking = true
  return { b, srcDir, outDir }
}

describe('bundler — rechargement à chaud des composants (stats.hot)', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('hors watch : stats.hot reste undefined', async () => {
    const { b } = projet('chaud-hors-watch', { 'comp.mjs': COMP_V1 })
    ;(b as any).cssOnlyTracking = false
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.hot, undefined)
  })

  it('build initial : null (aucune version précédente)', async () => {
    const { b } = projet('chaud-initial', { 'comp.mjs': COMP_V1 })
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.hot, null)
  })

  it('gabarit et gestionnaire changés : la balise et l\'adresse de son nouveau fichier, écrit', async () => {
    const { b, srcDir, outDir } = projet('chaud-gabarit', { 'comp.mjs': COMP_V1, 'autre.mjs': '<p>autre</p>' })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('v1 {$count}', 'v2 {$count}').replace('$count++', '$count += 10'))
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.cssOnly, null)
    assert.ok(stats.hot, 'un composant seul changé se recharge à chaud')
    assert.deepEqual(Object.keys(stats.hot.components), ['mjs-comp'])
    const url = stats.hot.components['mjs-comp']
    assert.match(url, /^\/out\/comp-[^/]+\.js$/)
    assert.ok(existsSync(join(outDir, basename(url))), 'le fichier annoncé est écrit')
  })

  it('style seul : le rechargement du CSS garde la main (hot null)', async () => {
    const { b, srcDir } = projet('chaud-style', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('color: red', 'color: blue'))
    const stats: any = await b.compile()
    assert.ok(stats.cssOnly)
    assert.equal(stats.hot, null)
  })

  it('style et gabarit changés ensemble : à chaud', async () => {
    const { b, srcDir } = projet('chaud-style-gabarit', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('color: red', 'color: blue').replace('v1 {$count}', 'v2 {$count}'))
    const stats: any = await b.compile()
    assert.equal(stats.cssOnly, null)
    assert.deepEqual(Object.keys(stats.hot?.components ?? {}), ['mjs-comp'])
  })

  it('µmount changé : rechargement complet', async () => {
    const { b, srcDir } = projet('chaud-montage', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('"monté"', '"monté deux"'))
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.hot, null)
  })

  it('µdestroy ajouté : rechargement complet', async () => {
    const { b, srcDir } = projet('chaud-destruction', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('µmount', 'µdestroy -> console.log("fin")\nµmount'))
    const stats: any = await b.compile()
    assert.equal(stats.hot, null)
  })

  it('règle d\'une variable changée (<vars>) : rechargement complet', async () => {
    const avec = (r: string) => COMP_V1.replace('<script>', `<vars>\n  $count int ${r}\n</vars>\n<script>`)
    const { b, srcDir } = projet('chaud-types', { 'comp.mjs': avec('0..10') })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), avec('0..5'))
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.equal(stats.hot, null)
  })

  it('type d\'une variable changé (<vars>) : rechargement complet', async () => {
    const avec = (t: string) => COMP_V1.replace('<script>', `<vars>\n  $count ${t}\n</vars>\n<script>`)
    const { b, srcDir } = projet('chaud-type-change', { 'comp.mjs': avec('int') })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), avec('float'))
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.equal(stats.hot, null)
  })

  it('slot ajouté : rechargement complet', async () => {
    const { b, srcDir } = projet('chaud-slot', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('<p class="t">', '<slot name="tete"></slot><p class="t">'))
    const stats: any = await b.compile()
    assert.equal(stats.hot, null)
  })

  it('composant ajouté : rechargement complet', async () => {
    const { b, srcDir } = projet('chaud-ajout', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'neuf.mjs'), '<p>neuf</p>')
    const stats: any = await b.compile()
    assert.equal(stats.hot, null)
  })

  it('module partagé (.civet) changé : rechargement complet', async () => {
    const lib = (n: number) => `export prix := ${n}\n`
    const comp = "@import prix 'lib.civet.mjs'\n<script>\n$p = prix\n</script>\n<p>{$p}</p>\n"
    const { b, srcDir } = projet('chaud-module', { 'comp.mjs': comp, 'lib.civet.mjs': lib(1) })
    const s1: any = await b.compile()
    assert.equal(s1.errors.length, 0, s1.errors.map((e: any) => e.message).join('\n'))
    writeFileSync(join(srcDir, 'lib.civet.mjs'), lib(2))
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.equal(stats.hot, null)
  })

  it('erreur de compilation : null (la page garde sa version, l\'erreur s\'affiche)', async () => {
    const { b, srcDir } = projet('chaud-erreur', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('<p class="t">v1 {$count}</p>', '{if $count}<p class="t">v1</p>'))
    const stats: any = await b.compile()
    assert.ok(stats.errors.length > 0)
    assert.ok(!stats.hot)
  })

  it('erreur puis correction : le composant corrigé part à chaud, avec ce qui a changé pendant l\'erreur', async () => {
    const { b, srcDir } = projet('chaud-reprise', { 'comp.mjs': COMP_V1, 'autre.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('<p class="t">v1 {$count}</p>', '{if $count}<p class="t">v1</p>'))
    writeFileSync(join(srcDir, 'autre.mjs'), COMP_V1.replace('color: red', 'color: blue'))
    const enErreur: any = await b.compile()
    assert.ok(enErreur.errors.length > 0)
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('v1 {$count}', 'v2 {$count}'))
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.cssOnly, null, 'le style changé pendant l\'erreur rejoint le lot à chaud')
    assert.deepEqual(Object.keys(stats.hot?.components ?? {}).sort(), ['mjs-autre', 'mjs-comp'])
  })

  it('erreur, composant ajouté pendant l\'erreur, puis correction : rechargement complet', async () => {
    const { b, srcDir } = projet('chaud-reprise-ajout', { 'comp.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('<p class="t">v1 {$count}</p>', '{if $count}<p class="t">v1</p>'))
    writeFileSync(join(srcDir, 'neuf.mjs'), '<p>neuf</p>')
    assert.ok((await b.compile() as any).errors.length > 0)
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('v1 {$count}', 'v2 {$count}'))
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.hot, null)
  })

  it('js: "bundle" (un seul fichier pour tous les composants) : rechargement complet', async () => {
    const { b, srcDir } = projet('chaud-bundle', { 'comp.mjs': COMP_V1 }, { js: 'bundle' })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1.replace('v1 {$count}', 'v2 {$count}'))
    const stats: any = await b.compile()
    assert.equal(stats.hot, null)
  })
})

// composant au corps de script choisi : `corps` = lignes du script, `texte` = gabarit
const avecCorps = (corps: string[], texte = 'v1') => ['<script>', '$count = 0', ...corps, 'inc = -> $count++', '</script>', '<button class="plus" @click={inc}>+</button>', `<p class="t">${texte} {$count}</p>`].join('\n')

// verdict du second tour : v1 compilé, puis v2 écrit à sa place
async function verdict(prefixe: string, v1: string, v2: string): Promise<any> {
  const { b, srcDir } = projet(prefixe, { 'comp.mjs': v1 })
  const premier: any = await b.compile()
  assert.equal(premier.errors.length, 0, premier.errors.map((e: Error) => e.message).join('\n'))
  writeFileSync(join(srcDir, 'comp.mjs'), v2)
  const stats: any = await b.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  return stats
}

describe('bundler — à chaud seulement sans fuite ni état faux', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  const ouvrants: Record<string, string> = {
    'écouteur de document': 'document.addEventListener(\'mjs-ping\', -> window.__p = 1)',
    'variable globale écrite': 'window.__corps = (window.__corps or 0) + 1',
    'magasin écrit': '$$total = 0',
    'liste modifiée en place': '$items = []\n$items.push(1)',
    'appel d\'une fonction': 'demarre = -> 1\ndemarre()',
  }
  for (const [quoi, ligne] of Object.entries(ouvrants)) {
    it(`corps du script qui ouvre quelque chose (${quoi}) : rechargement complet, même pour le gabarit seul changé`, async () => {
      const stats = await verdict('chaud-corps-ouvre', avecCorps([ligne]), avecCorps([ligne], 'v2'))
      assert.equal(stats.hot, null, 'rejouer ce corps l\'ouvrirait une seconde fois')
      assert.equal(stats.cssOnly, null)
    })
  }

  // une minuterie posée à la main au haut du script ne passe plus la construction : la page garde sa version, rien n'est
  // échangé ni ouvert une seconde fois (sa remplaçante µevery, arrêtée avec l'ancienne instance, part à chaud : corps qui ne fait
  // que déclarer, plus bas)
  it('corps du script qui ouvre une minuterie à la main : refusé à la construction, rien n\'est échangé', async () => {
    const { b, srcDir } = projet('chaud-corps-minuterie', { 'comp.mjs': avecCorps(['µevery 50, immediate: false, -> $count++']) })
    const premier: any  = await b.compile()
    assert.equal(premier.errors.length, 0, premier.errors.map((e: Error) => e.message).join('\n'))
    writeFileSync(join(srcDir, 'comp.mjs'), avecCorps(['setInterval((-> window.__t = 1), 50)'], 'v2'))
    const refuse: any = await b.compile()
    assert.ok(refuse.errors.length === 1 && /setInterval/.test(refuse.errors[0].message), 'minuterie à la main refusée : ' + refuse.errors.map((e: Error) => e.message).join('\n'))
    assert.equal(refuse.hot, null, 'rien ne part à chaud : la page garde sa version')
  })

  it('variable ordinaire réécrite par un gestionnaire (compteur d\'identifiants) : rechargement complet', async () => {
    const corps = ['$items = []', 'prochain = 1', 'ajoute = -> $items = [...$items, { id: prochain++ }]']
    const stats = await verdict('chaud-variable-ordinaire', avecCorps(corps), avecCorps(corps, 'v2'))
    assert.equal(stats.hot, null, 'repartir de 1 donnerait deux fois le même identifiant')
  })

  it('variable ordinaire réécrite seulement par µmount et µdestroy : rechargement complet (une variable ordinaire au haut du script recharge)', async () => {
    const corps = ['t = null', 'µmount ->', '  t = µevery 50, immediate: false, -> window.__t = 1', 'µdestroy ->', '  t()']
    const stats = await verdict('chaud-variable-cycle', avecCorps(corps), avecCorps(corps, 'v2'))
    assert.equal(stats.hot, null)
  })

  it('µmount et µdestroy qui ne passent que par l\'état $ : à chaud, crochets rejoués', async () => {
    const corps = ['$t = 0', 'µmount ->', '  $t = µevery 50, immediate: false, -> window.__t = 1', 'µdestroy ->', '  $t()']
    const stats = await verdict('chaud-crochets-etat', avecCorps(corps), avecCorps(corps, 'v2'))
    assert.ok(stats.hot, 'les crochets sont rejoués, le reste ne fait que déclarer')
  })

  it('variable ordinaire posée par une référence @this du gabarit : rechargement complet', async () => {
    const v = (texte: string) => `<script>\ncanvas = null\nµmount ->\n  canvas.getContext('2d')\n</script>\n\n<canvas :this=!{canvas}></canvas>\n<p class="t">${texte}</p>\n`
    const stats = await verdict('chaud-reference', v('v1'), v('v2'))
    assert.equal(stats.hot, null)
  })

  it('reffet (µeffect), même avec son nettoyage : rechargement complet', async () => {
    const corps = ['µeffect ->', '  t = µevery 50, immediate: false, -> window.__k = 1', '  -> t()']
    const stats = await verdict('chaud-reffet', avecCorps(corps), avecCorps(corps, 'v2'))
    assert.equal(stats.hot, null)
  })

  it('corps qui ne fait que déclarer (variables, dérivée, fonctions, minuterie µevery, constante littérale) : à chaud, variable et fonction ajoutées comprises', async () => {
    const corps = ['$liste = [1, { a: \'b\' }]', '$double = $count * 2', 'MAX = 3', 'vide = -> $liste = []', 'µevery 1000, immediate: false, ->', '  $count++']
    const stats = await verdict('chaud-corps-declare', avecCorps(corps), avecCorps([...corps, '$neuve = \'départ\'', 'autre = -> $neuve = \'x\''], 'v2'))
    assert.ok(stats.hot, 'rien n\'est ouvert par ce corps')
  })

  it('@persist : à chaud', async () => {
    const v = (texte: string) => `@persist $brouillon\n\n<script>\n$brouillon = ''\n</script>\n\n<p class="p">${texte}</p>\n<input value=!{$brouillon}>\n`
    const stats = await verdict('chaud-persist', v('v1'), v('v2'))
    assert.ok(stats.hot)
  })

  it('valeur de départ qui change de type ($sel = 0 → { id: 7 }) : rechargement complet', async () => {
    const stats = await verdict('chaud-type', avecCorps(['$sel = 0']), avecCorps(['$sel = { id: 7 }'], 'v2'))
    assert.equal(stats.hot, null, 'l\'état gardé (0) ne serait plus de la forme que lit le nouveau code')
  })

  it('valeur de départ changée ($count = 0 → 5) : rechargement complet', async () => {
    const stats = await verdict('chaud-valeur', avecCorps([]), avecCorps([], 'v2').replace('$count = 0', '$count = 5'))
    assert.equal(stats.hot, null)
  })

  it('dérivée devenue variable ordinaire : rechargement complet', async () => {
    const stats = await verdict('chaud-derivee', avecCorps(['$d = $count * 2']), avecCorps(['$d = 0'], 'v2'))
    assert.equal(stats.hot, null)
  })

  it('sauvegarde sans changement : stats.unchanged, ni CSS ni échange', async () => {
    const stats = await verdict('chaud-identique', COMP_V1, COMP_V1)
    assert.equal(stats.unchanged, true, 'rien n\'a changé : la page ne bouge pas')
    assert.equal(stats.hot, null)
    assert.equal(stats.cssOnly, null)
  })

  it('un changement réel : stats.unchanged faux', async () => {
    const stats = await verdict('chaud-change', COMP_V1, COMP_V1.replace('v1 {$count}', 'v2 {$count}'))
    assert.notEqual(stats.unchanged, true)
  })

  it('tour suivi d\'un autre déjà demandé : ce qu\'il change part avec le suivant, en un seul échange', async () => {
    const { b, srcDir } = projet('chaud-report', { 'a.mjs': COMP_V1, 'b.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'a.mjs'), COMP_V1.replace('v1 {$count}', 'v2 {$count}'))
    const premier: any = await b.compile()
    assert.ok(premier.hot)
    ;(b as any).deferHotRound(premier)
    writeFileSync(join(srcDir, 'b.mjs'), COMP_V1.replace('v1 {$count}', 'v3 {$count}'))
    const second: any = await b.compile()
    assert.ok(second.hot, 'les deux composants partent à chaud')
    assert.deepEqual(Object.keys(second.hot.components).sort(), ['mjs-a', 'mjs-b'])
    // tour reporté puis tour sans changement : le report part quand même
    writeFileSync(join(srcDir, 'a.mjs'), COMP_V1.replace('v1 {$count}', 'v4 {$count}'))
    ;(b as any).deferHotRound(await b.compile())
    const troisieme: any = await b.compile()
    assert.notEqual(troisieme.unchanged, true)
    assert.deepEqual(Object.keys(troisieme.hot?.components ?? {}), ['mjs-a'])
  })

  it('tour reporté qui exigeait un rechargement : le tour suivant recharge', async () => {
    const { b, srcDir } = projet('chaud-report-recharge', { 'a.mjs': COMP_V1, 'b.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'a.mjs'), COMP_V1.replace('console.log("monté")', 'console.log("monté 2")'))
    ;(b as any).deferHotRound(await b.compile())
    writeFileSync(join(srcDir, 'b.mjs'), COMP_V1.replace('v1 {$count}', 'v2 {$count}'))
    const second: any = await b.compile()
    assert.equal(second.hot, null)
    assert.equal(second.cssOnly, null)
    assert.notEqual(second.unchanged, true)
  })

  it('message de la console : les noms des composants y sont', async () => {
    const { t, setMessagesLang } = await import('../src/messages/index.js')
    try {
      for (const lang of ['fr', 'en']) {
        setMessagesLang(lang)
        const ligne = t('cli.components-hot-reloaded' as any, { names: 'mjs-a, mjs-b' })
        assert.match(ligne, /mjs-a, mjs-b/, `${lang} : ${ligne}`)
        assert.doesNotMatch(ligne, /\{names\}/)
        // la page n'a pas pu échanger et s'est rechargée : jamais « état gardé »
        const recharge = t('cli.components-page-reloaded' as any, { names: 'mjs-a' })
        assert.match(recharge, /mjs-a/, `${lang} : ${recharge}`)
        assert.doesNotMatch(recharge, /état gardé|state kept|\{noms\}/)
      }
    }
    finally {
      setMessagesLang('fr')
    }
  })
})

const avecGabarit = (corps: string[], texte: string, gabarit: string) => ['<script>', '$count = 0', ...corps, 'inc = -> $count++', '</script>', '<button class="plus" @click={inc}>+</button>', `<p class="t">${texte} {$count}</p>`, gabarit].join('\n')

describe('bundler — lecture du script : ce qui fuit recharge, ce qui ne fait que déclarer reste à chaud', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  const ecoute = ['ecoute = (n) ->', '  document.addEventListener(\'mjs-x\', (-> window.__x = 1))', '  n']
  const rechargent: Record<string, [string[], string]> = {
    'valeur de départ qui lit le champ d\'un objet extérieur (un accesseur y joue à chaque échange)': [['$w = window.__obj.compte'], ''],
    'variable ordinaire qui lit le champ d\'un objet extérieur': [['w = window.__obj.compte'], ''],
    'dérivée qui appelle une fonction qui pose un écouteur': [['ecoute = (n) ->', '  document.addEventListener(\'mjs-x\', (-> window.__x = 1))', '  n', '$d = ecoute($count)'], ''],
    'liste ordinaire remplie en place par un gestionnaire': [['liste = []', 'ajoute = ->', '  liste.push(1)', '  $count = liste.length'], ''],
    'objet ordinaire dont un gestionnaire réécrit un champ': [['etat = { n: 0 }', 'ajoute = ->', '  etat.n += 1', '  $count = etat.n'], ''],
    'compteur d\'identifiants dans un écouteur posé par µmount': [['$items = []', 'prochain = 1', 'btn = null', 'µmount ->', '  btn.addEventListener \'click\', ->', '    $items = [...$items, { id: prochain++ }]'], '<button :this=!{btn}>a</button>'],
    'liste ordinaire remplie en place par le gabarit': [['liste = []'], '<i @click={liste.push(1)}>x</i>'],
    'dérivée : fonction qui pose un écouteur passée par référence à map': [[...ecoute, '$d = [$count].map(ecoute)'], ''],
    'dérivée : la même passée à filter': [[...ecoute, '$d = [$count].filter(ecoute)'], ''],
    'dérivée : fonction qui écrit le magasin passée à map': [['ecrit = (n) ->', '  $$total = n', '  n', '$d = [$count].map(ecrit)'], ''],
    'dérivée : magasin écrit directement': [['$d = ($$total = $count * 2)'], ''],
    'dérivée : accesseur d\'un objet $': [['$o = { get n() { document.addEventListener("mjs-x", () => { window.__x = 1 }); return 1 } }', '$y = $o.n'], ''],
    'valeur de départ : appel': [['calcul = -> 1', '$x = calcul()'], ''],
    'valeur de départ : new Date()': [['$d = new Date()'], ''],
    'variable ordinaire : new Map()': [['cache = new Map()'], ''],
    'valeur de départ : main d\'arrêt de µafter': [['$t = µafter 10, -> window.__k = 1'], ''],
    'valeur de départ : queueMicrotask': [['$t = queueMicrotask(-> window.__k = 1)'], ''],
    'valeur de départ : toString caché (coercition)': [['piege = { toString() { µevery(50, () => { window.__ct = (window.__ct || 0) + 1 }); return "a" } }', '$t = "" + piege'], ''],
    'valeur de départ : accesseur d\'une constante étalé': [['SRC = { get n() { window.__acc = (window.__acc || 0) + 1; return 1 } }', '$o = { ...SRC }'], ''],
    'liste ordinaire remplie par une aide': [['liste = []', 'pousser = (tab, v) -> tab.push(v)', 'ajoute = ->', '  pousser(liste, 1)', '  $count = liste.length'], ''],
    'liste ordinaire remplie par un alias local': [['liste = []', 'ajoute = ->', '  l = liste', '  l.push(1)', '  $count = liste.length'], ''],
    'objets d\'une liste ordinaire modifiés par un rappel': [['cpt = [{ n: 0 }]', 'ajoute = ->', '  cpt.map((c) -> c.n++)', '  $count = cpt[0].n'], ''],
    'liste ordinaire remplie par Array.prototype.push.call': [['liste = []', 'ajoute = ->', '  Array.prototype.push.call(liste, 1)', '  $count = liste.length'], ''],
    'constante à Symbol.iterator étalée': [['ITER = { [Symbol.iterator]: -> window.__it = (window.__it or 0) + 1; [1][Symbol.iterator]() }', '$a = [...ITER]'], ''],
    'générateur Symbol.iterator étalé': [['ITER = { *[Symbol.iterator]() { window.__it = (window.__it || 0) + 1; yield 1 } }', '$a = [...ITER]'], ''],
    'dérivée qui étale une $': [['$liste = []', '$copie = [...$liste]'], ''],
    'dérivée Array.from d\'une $': [['$liste = []', '$copie = Array.from($liste)'], ''],
    'dérivée Object.entries d\'une $': [['$o = {}', '$e = Object.entries($o)'], ''],
    'valeur de départ : valueOf caché (arithmétique)': [['piege = { valueOf() { window.__vo = (window.__vo || 0) + 1; return 1 } }', '$t = piege * 2'], ''],
    'valeur de départ : chaîne gabarit qui convertit un objet': [['piege = { toString() { window.__ts = 1; return "a" } }', '$t = "#{piege}"'], ''],
    'écouteur posé dans µawake qui écrit une variable ordinaire': [['n = 0', 'µawake ->', '  window.addEventListener \'mjs-k\', -> n++'], ''],
    'valeur de départ qui lit une constante': [['MAX = 3', '$limite = MAX * 2'], ''],
    'dérivée qui lit le champ d\'une $': [['$o = { n: 1 }', '$y = $o.n * $count'], ''],
  }
  const changent: Record<string, [string[], string[]]> = {
    'constante changée lue par une valeur de départ (MAX = 10 → 20)': [['MAX = 10', '$limite = MAX * 2'], ['MAX = 20', '$limite = MAX * 2']],
    'constante changée de forme ({} → [])': [['VIDE = {}', '$sel = VIDE'], ['VIDE = []', '$sel = VIDE']],
    'constante littérale changée (MAX = 3 → 4), lue par le gabarit seul': [['MAX = 3'], ['MAX = 4']],
  }
  for (const [quoi, [c1, c2]] of Object.entries(changent)) {
    it(`${quoi} : rechargement complet`, async () => {
      const stats = await verdict('chaud-constante-changee', avecGabarit(c1, 'v1', '<b>{MAX}</b>'.repeat(c1[0].startsWith('MAX') ? 1 : 0)), avecGabarit(c2, 'v2', '<b>{MAX}</b>'.repeat(c2[0].startsWith('MAX') ? 1 : 0)))
      assert.equal(stats.hot, null)
    })
  }

  for (const [quoi, [corps, gabarit]] of Object.entries(rechargent)) {
    it(`${quoi} : rechargement complet, même pour le gabarit seul changé`, async () => {
      const stats = await verdict('chaud-lecture-stricte', avecGabarit(corps, 'v1', gabarit), avecGabarit(corps, 'v2', gabarit))
      assert.equal(stats.hot, null, 'rejouer ce script fuirait ou fausserait l\'état gardé')
    })
  }

  it('valeur de départ qui calcule sur une $ ou lit une dérivée : hors de la liste blanche ; copiée telle quelle : à chaud', () => {
    const verdict = (js: string) => hotScriptFacts(js, 'export default 1')
    for (const v of ['[$.depart * 2]', '$.liste.length', '`${$.depart}`', '-$.depart']) assert.deepEqual([v, verdict(`µ._set(_mjsThis, 'x', ${v})`).reason], [v, 'valeur de départ : calcul sur une $'])
    assert.equal(verdict('µ._mjs_setComputed(_mjsThis, \'d\', () => ($.a * 2))\nµ._set(_mjsThis, \'x\', $.d)').reason, 'valeur de départ : calcul sur une $')
    for (const v of ['$.depart', '[1, $.depart]', '{ a: $.depart, b: 2 }', '$.depart ?? 0', '$.a ? $.b : !$.c', '$.a === null']) assert.equal(verdict(`µ._set(_mjsThis, 'x', ${v})`).pure, true, v)
  })

  it('dérivée qui traduit (µt) ou lit le magasin ($$x, µ.store.x et leurs champs) avec des arguments et des lectures de la grammaire : à chaud ; ailleurs ou autrement : hors de la liste blanche', () => {
    const verdict = (js: string, sortie = 'export default 1') => hotScriptFacts(js, sortie)
    const derivee = (e: string, sortie?: string) => verdict(`µ._mjs_setComputed(_mjsThis, 'd', () => (${e}))`, sortie)
    for (const e of ['µ.t("admin.titre")', 'µ.t("admin.n", { n: $.count, total: $.items.length })', 'µ.t(`${$.scope}.colonnes`)', 'µ.store.panier', 'µ.store.panier.total * $.count', 'µ.store.panier?.lignes.length', 'µ.store.__mjsLang === \'fr\' ? µ.t("a.fr") : µ.t("a.autre")', 'µ.t("admin.n", { n: µ.store.compte })']) assert.equal(derivee(e).pure, true, e)
    const refus: [string, string][] = [
      ['µ.t(cle)', 'dérivée : nom lu (constante, variable ordinaire ou fonction)'],
      ['µ.t("a", {}, "wait")', 'dérivée : call'],
      ['µ.t()', 'dérivée : call'],
      ['µ.t(...$.args)', 'dérivée : call'],
      ['µ.t.call(null, "a")', 'dérivée : call'],
      ['µ.tr("a")', 'dérivée : call'],
      ['µ.store.panier.somme()', 'dérivée : call'],
      ['µ.store[$.cle]', 'dérivée : champ lu'],
      ['µ.store?.panier', 'dérivée : champ lu'],
      ['µ?.store.panier', 'dérivée : champ lu'],
      ['µ?.t("a")', 'dérivée : call'],
      ['µ.t?.("a")', 'dérivée : call'],
      ['µ.store', 'dérivée : champ lu'],
      ['µ.t("a", { n: window.x })', 'dérivée : champ lu'],
    ]
    for (const [e, raison] of refus) assert.deepEqual([e, derivee(e).reason], [e, raison])
    // une valeur de départ se rejoue à chaque échange, même pour une variable gardée : ni traduction (elle peut demander une section), ni magasin
    assert.equal(verdict('µ._set(_mjsThis, \'x\', µ.t("a"))').reason, 'valeur de départ : call')
    assert.equal(verdict('µ._set(_mjsThis, \'x\', µ.store.panier)').reason, 'valeur de départ : champ lu')
    // un module qui réécrit µ.t ou µ.store
    for (const s of ['µ.t = (k) => k', 'µ.store = {}']) assert.equal(derivee('µ.t("a") + µ.store.n', `${s}\nexport default 1`).pure, false, s)
  })

  it('dérivée qui appelle une méthode de liste qui ne modifie rien, sur une liste, avec un rappel simple : à chaud ; rappel non simple, méthode qui modifie, receveur qui n\'est pas une liste : hors de la liste blanche', () => {
    const verdict = (js: string) => hotScriptFacts(js, 'export default 1')
    const derivee = (e: string, avant = '') => verdict(`${avant}µ._mjs_setComputed(_mjsThis, 'd', () => (${e}))`)
    const admis = [
      '$.items.filter(function(x) { return x.actif })',
      '$.items.map((x) => x.n * 2)',
      '(µ.store.lists || []).find(function(l) { return l.id === $.listId })',
      '$.items.some((s) => s.key)',
      '$.items.filter((x) => x.n > $.count).length',
      '$.items?.filter((x) => x?.tags[0] === "a").map((x) => x.n).slice(0, 3)',
      '$.items.reduce((s, x) => s + x.n, 0)',
      '$.items.toSorted((a, b) => a.n - b.n).at(-1)',
      '$.items.filter((x) => $.choix.includes(x.id)).length',
      'µ.t("admin.n", { n: $.items.filter((x) => x.actif).length })',
      '$.items.findIndex((x) => x.id === µ.store.courant) >= 0 ? $.items.join(", ") : ""',
      '[1, 2, $.count].every((n) => n > 0)',
    ]
    for (const e of admis) assert.deepEqual([e, derivee(e).reason], [e, undefined])
    const refus: [string, string][] = [
      ['$.items.filter((x) => x.n = 1)', 'dérivée : rappel : forme AssignmentExpression'],
      ['$.items.filter((x) => x.n++)', 'dérivée : rappel : forme UpdateExpression'],
      ['$.items.filter((x) => aide(x))', 'dérivée : rappel : call'],
      ['$.items.filter(function(x) { const y = x.n; return y > 1 })', 'dérivée : rappel : corps en bloc'],
      ['$.items.filter((x) => { window.__x = 1; return x })', 'dérivée : rappel : corps en bloc'],
      ['$.items.filter(async (x) => x)', 'dérivée : rappel : forme'],
      ['$.items.filter(({ actif }) => actif)', 'dérivée : rappel : paramètre'],
      ['$.items.map(($) => $.n)', 'dérivée : rappel : paramètre'],
      ['$.items.map(String)', 'dérivée : rappel : forme'],
      ['$.items.filter(Boolean)', 'dérivée : rappel : forme'],
      ['$.items.filter((x) => this.ok)', 'dérivée : rappel : champ lu'],
      ['$.items.filter((x) => x.tags.includes("a"))', 'dérivée : rappel : méthode de liste : receveur'],
      ['$.items.find((x) => x.ok).filter((y) => y)', 'dérivée : méthode de liste : receveur'],
      ['$.items.at(0).map((y) => y)', 'dérivée : méthode de liste : receveur'],
      ['window.liste.filter((x) => x)', 'dérivée : méthode de liste : receveur'],
      ...['sort()', 'reverse()', 'splice(0, 1)', 'push(1)', 'pop()', 'shift()', 'unshift(1)', 'fill(0)', 'copyWithin(0, 1)', 'concat([1])', 'flat()', 'flatMap((x) => x)', 'forEach((x) => x)'].map((m): [string, string] => [`$.items.${m}`, 'dérivée : call']),
      ['$.items["filter"]((x) => x)', 'dérivée : call'],
      ['$.items.filter?.((x) => x)', 'dérivée : call'],
      ['$.items.filter((x) => x, $.ctx)', 'dérivée : call'],
      ['$.items.filter(...$.f)', 'dérivée : call'],
    ]
    for (const [e, raison] of refus) assert.deepEqual([e, derivee(e).reason], [e, raison])
    // une dérivée qui rend une liste en est un receveur ; une dérivée qui rend un élément, non
    assert.equal(derivee('$.v.slice(0, 2)', 'µ._mjs_setComputed(_mjsThis, \'v\', () => ($.items.filter((x) => x.ok)))\n').reason, undefined)
    assert.equal(derivee('$.v.filter((y) => y)', 'µ._mjs_setComputed(_mjsThis, \'v\', () => ($.items.find((x) => x.ok)))\n').reason, 'dérivée : méthode de liste : receveur')
    // une valeur de départ, rejouée à chaque échange, n'en appelle aucune
    assert.equal(verdict('µ._set(_mjsThis, \'x\', $.items.filter((x) => x))').reason, 'valeur de départ : call')
  })

  it('dérivées qui appellent filter, map, find, some avec des rappels simples, mêlées à µt et au magasin, gabarit changé : à chaud', async () => {
    const corps = ['$items = [{ id: 1, ok: true }]', '$vis = $items.filter((x) -> x.ok)', '$ids = $items.map((x) -> x.id).join(\'-\')', '$item = ($$lists or []).find((l) -> l.id is $count)', '$aucun = not $items.some((x) -> x.id > $count)', '$titre = µt(\'admin.n\', { n: $vis.length })']
    const stats = await verdict('chaud-methodes-de-liste', avecCorps(corps), avecCorps(corps, 'v2'))
    assert.deepEqual(Object.keys(stats.hot?.components ?? {}), ['mjs-comp'])
  })

  it('dérivées qui traduisent et lisent le magasin ($titre = µt(…), $total = $$panier.total * $count, $t = $$total, µlang), gabarit changé : à chaud', async () => {
    const corps = ['$titre = µt(\'admin.titre\', { n: $count })', '$total = $$panier.total * $count', '$t = $$total', '$langue = µlang']
    const stats = await verdict('chaud-traduction-magasin', avecCorps(corps), avecCorps(corps, 'v2'))
    assert.deepEqual(Object.keys(stats.hot?.components ?? {}), ['mjs-comp'])
  })

  it('dérivée modifiée qui reste sans risque ($d = $count * 2 → $count * 3) : à chaud', async () => {
    const stats = await verdict('chaud-derivee-modifiee', avecCorps(['$d = $count * 2']), avecCorps(['$d = $count * 3'], 'v2'))
    assert.deepEqual(Object.keys(stats.hot?.components ?? {}), ['mjs-comp'])
  })

  it('dérivée qui lit une liste par ses méthodes (filter, map, join) avec des rappels simples : à chaud', async () => {
    const corps = (n: number) => ['$items = [1, 2, 3]', `$pairs = $items.filter((x) -> x % ${n} == 0).map((x) -> x * 10).join(',')`]
    const stats = await verdict('chaud-derivee-methodes', avecCorps(corps(2)), avecCorps(corps(2), 'v2'))
    assert.deepEqual(Object.keys(stats.hot?.components ?? {}), ['mjs-comp'])
  })

  it('dérivée qui passe par une fonction posée sur l\'instance : rechargement complet', async () => {
    const corps = ['@fmt = (x) -> String(x)', '$code = @fmt($count)']
    const stats = await verdict('chaud-derivee-instance', avecCorps(corps), avecCorps(corps, 'v2'))
    assert.equal(stats.hot, null)
  })

  it('fonction posée sur l\'instance (@fmt), lue par le gabarit seul : à chaud', async () => {
    const corps = ['@fmt = (x) -> String(x)']
    const stats = await verdict('chaud-fonction-instance', avecGabarit(corps, 'v1', '<b>{@fmt($count)}</b>'), avecGabarit(corps, 'v2', '<b>{@fmt($count)}</b>'))
    assert.ok(stats.hot)
  })

  it('dérivée qui lit le champ d\'un objet extérieur : rechargement complet', async () => {
    const stats = await verdict('chaud-derivee-magasin', avecCorps(['$d = window.__reglages.taille * $count']), avecCorps(['$d = window.__reglages.taille * $count'], 'v2'))
    assert.equal(stats.hot, null)
  })

  it('valeurs de départ et dérivées faites de littéraux, de lectures $ et de leur longueur, d\'opérateurs, de ternaires, de tableaux et d\'objets : à chaud', async () => {
    const corps = ['MAX = 3', '$copie = { max: 3, vide: undefined, liste: [1, \'a\', null, -2] }', '$items = [1, 2]', '$n = $items.length + $count * 2', '$etiquette = "#{$count} sur #{$items.length}"', '$grand = if $count > 2 then \'oui\' else \'non\'', '$ok = $count >= 0 and not ($count == 3) or $n != 1']
    const stats = await verdict('chaud-valeur-grammaire', avecGabarit(corps, 'v1', '<b>{MAX}</b>'), avecGabarit([...corps.slice(0, -1), '$ok = $count >= 1'], 'v2', '<b>{MAX}</b>'))
    assert.ok(stats.hot)
  })

  it('constante qui n\'est pas un littéral : rechargement complet', async () => {
    const corps = ['CONF = { pas: 2 }']
    const stats = await verdict('chaud-constante-objet', avecGabarit(corps, 'v1', '<b>{CONF.pas}</b>'), avecGabarit(corps, 'v2', '<b>{CONF.pas}</b>'))
    assert.equal(stats.hot, null)
  })

  it('<@window> avec un écouteur (chaînes µawake et µsleep posées par le compilateur), gabarit seul changé : à chaud', async () => {
    const v = (texte: string) => `<script>\n$n = 0\nf = -> $n++\n</script>\n\n<@window @resize={f()}>\n<p class="t">${texte} {$n}</p>\n`
    const stats = await verdict('chaud-fenetre', v('v1'), v('v2'))
    assert.ok(stats.hot)
  })

  it('table des routes posée par le compilateur : à chaud quand seul le gabarit change, rechargement complet quand la table change', async () => {
    const page = (cible: string, texte: string) => `<routes target="vue">\n  /      ${cible}\n</routes>\n\n<p class="t">${texte}</p>\n<@view vue>\n`
    const { b, srcDir } = projet('chaud-routes', { 'app.page.mjs': page('accueil', 'v1'), 'accueil.mjs': '<p>accueil</p>\n', 'autre.mjs': '<p>autre</p>\n' })
    const s0: any = await b.compile()
    assert.equal(s0.errors.length, 0, s0.errors.map((e: Error) => e.message).join('\n'))
    writeFileSync(join(srcDir, 'app.page.mjs'), page('accueil', 'v2'))
    const s1: any = await b.compile()
    assert.ok(s1.hot, 'la même table, rejouée, n\'ouvre rien')
    writeFileSync(join(srcDir, 'app.page.mjs'), page('autre', 'v3'))
    const s2: any = await b.compile()
    assert.equal(s2.errors.length, 0)
    assert.equal(s2.hot, null)
  })

  const V1 = ['<script>', '$count = 0', 'inc = -> $count++', '</script>', '<button class="plus" @click={inc}>+</button>', '<p class="t">v1 {$count}</p>'].join('\n')
  const erreurs: Record<string, string> = {
    'erreur de syntaxe du script': V1.replace('inc = -> $count++', 'inc = -> $count++ )('),
    'module cœur introuvable': V1 + '\n<@@inexistant></@@inexistant>',
    'effet inconnu': V1.replace('<p class="t">', '<p class="t" *inexistant>'),
  }
  for (const [quoi, casse] of Object.entries(erreurs)) {
    it(`${quoi} puis retour au texte d'avant : la page n'a rien à recharger`, async () => {
      const { b, srcDir } = projet('chaud-erreur-annulee', { 'comp.mjs': V1 })
      await b.compile()
      writeFileSync(join(srcDir, 'comp.mjs'), casse)
      const enErreur: any = await b.compile()
      assert.ok(enErreur.errors.length > 0)
      writeFileSync(join(srcDir, 'comp.mjs'), V1)
      const stats: any = await b.compile()
      assert.equal(stats.errors.length, 0)
      // la page a déjà ce texte : seul l'affichage de l'erreur part, ni échange (il rechargerait un module déjà chargé) ni rechargement
      assert.equal(stats.unchanged, true, `unchanged=${stats.unchanged}, hot=${JSON.stringify(stats.hot)}, cssOnly=${JSON.stringify(stats.cssOnly)}`)
      assert.equal(stats.hot, null)
      assert.equal(stats.cssOnly, null)
    })
  }

  it('deux erreurs de suite puis texte d\'avant : la page n\'a rien à recharger', async () => {
    const { b, srcDir } = projet('chaud-erreur-double', { 'comp.mjs': V1 })
    await b.compile()
    for (const casse of [erreurs['erreur de syntaxe du script'], erreurs['module cœur introuvable']]) {
      writeFileSync(join(srcDir, 'comp.mjs'), casse)
      assert.ok((await b.compile() as any).errors.length > 0)
    }
    writeFileSync(join(srcDir, 'comp.mjs'), V1)
    const stats: any = await b.compile()
    assert.equal(stats.unchanged, true)
  })

  it('erreur, un autre composant retiré pendant l\'erreur, puis texte d\'avant : rechargement complet', async () => {
    const { b, srcDir } = projet('chaud-erreur-retrait', { 'comp.mjs': V1, 'autre.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), erreurs['erreur de syntaxe du script'])
    assert.ok((await b.compile() as any).errors.length > 0)
    rmSync(join(srcDir, 'autre.mjs'))
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), V1)
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.unchanged, undefined)
    assert.equal(stats.hot, null)
  })

  it('feuille partagée en erreur puis texte d\'avant : la page n\'a rien à recharger', async () => {
    const styles = mjsTmp('chaud-feuille-styles')
    mkdirSync(styles, { recursive: true })
    writeFileSync(join(styles, 'theme.scss'), '.carte { color: red; }\n')
    const { b } = projet('chaud-feuille-annulee', { 'comp.mjs': V1 }, { stylesheetsDir: styles })
    assert.equal((await b.compile() as any).errors.length, 0)
    writeFileSync(join(styles, 'theme.scss'), '.carte { color: red;\n')
    assert.ok((await b.compile() as any).errors.length > 0)
    writeFileSync(join(styles, 'theme.scss'), '.carte { color: red; }\n')
    const stats: any = await b.compile()
    assert.equal(stats.errors.length, 0)
    assert.equal(stats.unchanged, true)
  })

  it('erreur, puis texte d\'avant avec un autre composant changé pendant l\'erreur : cet autre part à chaud', async () => {
    const { b, srcDir } = projet('chaud-erreur-annulee-autre', { 'comp.mjs': V1, 'autre.mjs': COMP_V1 })
    await b.compile()
    writeFileSync(join(srcDir, 'comp.mjs'), erreurs['erreur de syntaxe du script'])
    writeFileSync(join(srcDir, 'autre.mjs'), COMP_V1.replace('v1 {$count}', 'v2 {$count}'))
    assert.ok((await b.compile() as any).errors.length > 0)
    writeFileSync(join(srcDir, 'comp.mjs'), V1)
    const stats: any = await b.compile()
    assert.equal(stats.unchanged, undefined)
    assert.deepEqual(Object.keys(stats.hot?.components ?? {}), ['mjs-autre'])
  })
})

describe('HMR — hot-update (diffusion et client de rechargement)', () => {
  it('notifyHotUpdate(payload) diffuse {type:"hot-update", hot:{…}} tel quel', async function () {
    this.timeout(10000)
    const rootDir = mjsTmp('hmr-hot-update')
    const port = 35000 + Math.floor(Math.random() * 5000)
    const server = new StaticServer({ rootDir, port, host: '127.0.0.1', hmr: true })
    await server.start()
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`)
      const messages: string[] = []
      ws.on('message', (d) => messages.push(d.toString()))
      await new Promise<void>(r => ws.on('open', () => r()))
      await new Promise(r => setTimeout(r, 100))
      const hot = { components: { 'mjs-comp': '/modularjs/comp-abcd1234.js' } }
      server.hmr?.notifyHotUpdate(hot)
      await new Promise(r => setTimeout(r, 100))
      const raw = messages.find(m => m.includes('"type":"hot-update"'))
      assert.ok(raw, 'le message hot-update est diffusé')
      assert.deepEqual(JSON.parse(raw!), { type: 'hot-update', hot })
      ws.close()
    }
    finally {
      await server.stop()
    }
  })

  it('notifyErrorCleared() diffuse {type:"error-cleared"} : la page retire l\'affichage de l\'erreur sans se recharger', async function () {
    this.timeout(10000)
    const rootDir = mjsTmp('hmr-erreur-retiree')
    const port = 35000 + Math.floor(Math.random() * 5000)
    const server = new StaticServer({ rootDir, port, host: '127.0.0.1', hmr: true })
    await server.start()
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`)
      const messages: string[] = []
      ws.on('message', (d) => messages.push(d.toString()))
      await new Promise<void>(r => ws.on('open', () => r()))
      await new Promise(r => setTimeout(r, 100))
      server.hmr?.notifyErrorCleared()
      await new Promise(r => setTimeout(r, 100))
      assert.ok(messages.some(m => JSON.parse(m).type === 'error-cleared'), 'le message error-cleared est diffusé')
      ws.close()
    }
    finally {
      await server.stop()
    }
    const client = hmrClientSnippet('ws://127.0.0.1:1234/__mjs_hmr')
    assert.match(client, /msg\.type === 'error-cleared'\)\s*\{ hideError\(\) \}/)
  })

  // fragment isolé du client (marqueurs extrait-test), joué hors navigateur : la page ne garde son état que si µ._hotSwap rend true
  async function jouer(window: any): Promise<boolean> {
    const corps = extractMarked(hmrClientSnippet('ws://127.0.0.1:1234/__mjs_hmr'), 'hmr-hotswap-fallback')
    let recharge = false
    new Function('msg', 'window', 'location', corps)({ hot: { components: {} } }, window, { reload: () => { recharge = true } })
    await new Promise(r => setTimeout(r, 20))
    return recharge
  }

  it('µ._hotSwap rend true : la page reste', async () => {
    assert.equal(await jouer({ µ: { _hotSwap: () => Promise.resolve(true) } }), false)
  })

  it('µ._hotSwap rend false (échange pas sûr) : rechargement complet', async () => {
    assert.equal(await jouer({ µ: { _hotSwap: () => Promise.resolve(false) } }), true)
  })

  it('µ._hotSwap rejette ou lève : rechargement complet', async () => {
    assert.equal(await jouer({ µ: { _hotSwap: () => Promise.reject(new Error('boom')) } }), true)
    assert.equal(await jouer({ µ: { _hotSwap: () => { throw new Error('boom') } } }), true)
  })

  it('µ._hotSwap absent (build de production servi par erreur) ou µ absent : rechargement complet', async () => {
    assert.equal(await jouer({ µ: {} }), true)
    assert.equal(await jouer({}), true)
  })
})
