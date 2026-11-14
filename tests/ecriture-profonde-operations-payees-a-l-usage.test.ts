// écriture profonde compilée (`$o.a.b.c = v`, `µ._mjs_deepSet`, mjs_deep.ts) : au-delà de l'écriture et de sa notification, chaque
// opération sert une fonctionnalité — époque d'un objet tenu par deux composants, d'un objet tenu sous la racine ou d'un objet du milieu
// du chemin, mise à jour fine, compteurs des listes aux lignes propres — et n'est payée que par l'appli qui s'en sert. Une appli qui n'en a aucune (le banc des
// mutations : un composant, `$o = {a: {b: {c: 0}}}`, une boucle d'écritures) fait par écriture les opérations d'avant ces fonctionnalités
// ; chaque appli qui s'en sert garde le travail qui la sert. Opérations COMPTÉES, jamais chronométrées : appels des fonctions du cœur
// (couverture précise de V8, nombre d'appels par fonction), opérations sur Map / WeakMap / Set / WeakSet, compteurs écrits. Cœur de
// production, non minifié pour en lire les noms, monté dans happy-dom ; une fenêtre par appli (les drapeaux du cœur ne se baissent pas)

import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)) }

// la boucle du banc des mutations, écrite comme lui (Civet, `while`) : une méthode pour l'appeler depuis le test
const BOUCLE = ['@ecrire = (n) ->', '  first := $o.a.b.c + 1', '  i .= 0', '  while i < n', '    $o.a.b.c = first + i', '    i++']
const civet = (script: string[], gabarit: string[]) => ['<script lang="civet">', ...script, '</script>', '', ...gabarit].join('\n')
const js = (script: string[], gabarit: string[]) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', ...gabarit].join('\n')

const SOURCES: Record<string, string> = {
  // l'appli du banc : aucune des fonctionnalités
  'ecriture.mjs': civet(['$o = {a: {b: {c: 0}}}', '', ...BOUCLE], ['<p>{$o.a.b.c}</p>']),
  // une liste aux lignes propres dans la page : les écritures d'objets sont comptées pour elle
  'liste.mjs': js(['$data = [];', "@poser = function() { const a = []; for (let i = 0; i < 6; i++) a.push({ id: i + 1, label: 'r' + (i + 1) }); $data = a; };", "@fine = function() { $data[2].label += ' F'; };", '@echanger = function() { const t = $data[1]; $data[1] = $data[4]; $data[4] = t; };'], ['{for row in $data by id}<i>{row.label}</i>{end}']),
  // un enfant qui tient l'objet qu'on lui passe
  'fiche.mjs': js(['$item = null;'], ["<em>{$item ? $item.c : '-'}</em>"]),
  // l'objet écrit, sous la racine, tenu par un enfant
  'tient.mjs': civet(['$o = {a: {b: {c: 0}}}', '', ...BOUCLE], ['<@fiche item={$o.a.b}></@fiche>']),
  // un objet du milieu du chemin (`$o.a`, pour `$o.a.b.c = v`) tenu par un enfant ; écritures de deux et trois segments à côté
  'fiche2.mjs': js(['$item = null;'], ["<em>{$item ? $item.b.c : '-'}</em>"]),
  'milieu.mjs': civet(['$o = {a: {b: {c: 0}}, y: {z: 0}, k: 0}', '', ...BOUCLE, '@ecrire2 = (n) ->', '  i .= 0', '  while i < n', '    $o.k = i + 1', '    i++', '@ecrire3 = (n) ->', '  i .= 0', '  while i < n', '    $o.y.z = i + 1', '    i++'], ['<@fiche2 item={$o.a}></@fiche2>']),
  // la racine tenue par deux composants : objet partagé
  'partage.mjs': civet(['$o = {a: {b: {c: 0}}}', '', ...BOUCLE], ['<@fiche item={$o}></@fiche>']),
  // écritures de trois segments et méthode d'une liste sous la racine, sans enfant ni objet partagé
  'trois.mjs': civet(['$o = {y: {z: 0}, l: {v: []}}', '', '@ecrire = (n) ->', '  i .= 0', '  while i < n', '    $o.y.z = i + 1', '    i++', '@pousser = (n) ->', '  i .= 0', '  while i < n', '    $o.l.v.push(i)', '    i++'], ['<p>{$o.y.z}</p>']),
  // l'objet écrit, tenu par une variable du composant entre deux écritures du même tour
  'tenu-ensuite.mjs': civet(['$o = {a: {b: {c: 0}}}', '$q = null', '', '@melange = ->', '  $o.a.b.c = 1', '  $q = $o.a.b', '  $o.a.b.c = 2'], ['<p>{$o.a.b.c}</p>']),
}

// espions des collections, posés dans la fenêtre avant le cœur : comptent pendant la mesure seulement
const ESPIONS = `globalThis.__ops = { on: false, n: {} };
for (const [nom, K] of [['Map', Map], ['WeakMap', WeakMap], ['Set', Set], ['WeakSet', WeakSet]]) {
  for (const m of ['get', 'set', 'has', 'delete', 'add', 'clear', 'forEach']) {
    const f = K.prototype[m];
    if (typeof f !== 'function') continue;
    K.prototype[m] = function __espion(...a) {
      if (__ops.on) __ops.n[nom + '.' + m] = (__ops.n[nom + '.' + m] || 0) + 1;
      return f.apply(this, a);
    };
  }
}`

// aides des fonctionnalités : époques (objet partagé, objet tenu), mise à jour fine, compteurs des lignes propres
const AIDES = ['_mjsDeepSuite', '_mjsDeepLong', '_mjsDeepEpoque', '_mjsDeepEpoqueObjet', '_mjsDeepMilieu', 'µ._mjs_bumpEpoch', '_mjsFineEcrite', '_mjsFineSet', '_mjsFineStruct', '_mjsFineCompte']
// le niveau d'avant ces fonctionnalités, par écriture : µ._mjs_deepSet, ses trois aides fondues (chemin, racine, objet interdit), la
// notification (_mjs_notifyMutationAliased, _mjs_notifyMutation, _mjs_invalidate, _mjs_varHasUserEffect) ; rawSet.has (racine µraw),
// rootsByTarget.get (variables qui atteignent l'objet) et la clé mise en file de la boucle. La recherche de l'objet écrit parmi les
// objets tenus (`µ._mjs_tenus`) se fait une fois par objet et par tour, pas à chaque écriture (cf. _mjsDeepTenu, mjs_deep.ts)
const APPELS_MAX = 8
const OPS_MAX    = 3
const N1 = 200
const N2 = 600

describe('écriture profonde : chaque opération ajoutée n\'est payée que par l\'appli qui s\'en sert (comptes par écriture)', function () {
  this.timeout(60000)
  let code = ''
  const session = new Session()
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('ecriture-profonde-operations')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    // le cœur de ces applis porte la mise à jour fine (le gabarit lit `$o.a.b.c`, champ nommé) : celui du banc
    assert.match(code, /function _mjsFineEcrite\(/, 'le cœur construit ne porte pas la mise à jour fine : le banc la porte')
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  })

  after(async () => {
    await session.post('Profiler.stopPreciseCoverage')
    await session.post('Profiler.disable')
    session.disconnect()
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // une appli dans sa fenêtre : espions, cœur, composants montés
  async function appli(corps: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(ESPIONS)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = corps
    await tic()
    return win
  }

  // appels par fonction (couverture précise de V8, compteurs remis à zéro à chaque relevé), hors espions
  async function releve(): Promise<Map<string, number>> {
    const { result } = await session.post('Profiler.takePreciseCoverage') as any
    const n = new Map<string, number>()
    for (const s of result) for (const f of s.functions) if (f.ranges[0].count > 0 && f.functionName !== '__espion') n.set(f.functionName || '(anonyme)', (n.get(f.functionName || '(anonyme)') || 0) + f.ranges[0].count)
    return n
  }

  // par écriture : deux fenêtres de N1 et N2 écritures, leur différence divisée par N2 - N1 (le coût fixe de l'appel et du rendu
  // qui suit s'annule)
  async function parEcriture(win: any, el: any, m = 'ecrire') {
    const fenetre = async (n: number) => {
      await releve()
      win.__ops.n  = {}
      win.__ops.on = true
      el[m](n)
      win.__ops.on = false
      const ops = { ...win.__ops.n }
      await tic()
      return { appels: await releve(), ops }
    }
    const a = await fenetre(N1), b = await fenetre(N2)
    const par = (x = 0, y = 0) => (y - x) / (N2 - N1)
    const appels = new Map<string, number>(), ops = new Map<string, number>()
    for (const k of new Set([...a.appels.keys(), ...b.appels.keys()])) if (par(a.appels.get(k), b.appels.get(k)) > 0.5) appels.set(k, par(a.appels.get(k), b.appels.get(k)))
    for (const k of new Set([...Object.keys(a.ops), ...Object.keys(b.ops)])) if (par(a.ops[k], b.ops[k]) > 0.5) ops.set(k, par(a.ops[k], b.ops[k]))
    return { appels, ops }
  }
  const somme = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0)
  const texte = (m: Map<string, number>) => [...m].map(([k, v]) => k + ' ' + v).join(', ')
  const brut = (win: any, v: any) => win.µ._mjs_toRaw(v)

  it('appli sans ces fonctionnalités (le banc des mutations) : aucune aide appelée, aucun compteur tenu, les opérations d\'avant', async () => {
    const win = await appli('<mjs-ecriture></mjs-ecriture>')
    const el  = win.document.querySelector('mjs-ecriture')
    const µ   = win.µ
    const extW = µ._mjs_extW
    const { appels, ops } = await parEcriture(win, el)
    assert.equal(brut(win, el._state.o).a.b.c, N1 + N2, 'dernière valeur écrite')
    await tic()
    assert.equal((el._shadow || el.shadowRoot || el).querySelector('p').textContent, String(N1 + N2), 'valeur affichée')
    assert.deepEqual(AIDES.filter((f) => appels.has(f)), [], `aides appelées par écriture : ${texte(appels)}`)
    assert.ok(somme(appels) <= APPELS_MAX, `${somme(appels)} appels par écriture (au plus ${APPELS_MAX}) : ${texte(appels)}`)
    assert.ok(somme(ops) <= OPS_MAX, `${somme(ops)} opérations sur les collections par écriture (au plus ${OPS_MAX}) : ${texte(ops)}`)
    // la recherche de l'objet écrit parmi les objets tenus (`µ._mjs_tenus`) : une fois par objet et par tour, la réponse « tenu par
    // personne » retenue ; une boucle qui écrit le même objet ne la refait pas (une par écriture, que la 3.1 ne faisait pas)
    assert.equal(ops.get('WeakMap.has'), undefined, `recherches parmi les objets tenus par écriture : ${texte(ops)}`)
    assert.equal(µ._mjs_extW, extW, 'compteur des écritures d\'objets tenu sans liste aux lignes propres pour le lire')
    assert.equal(el._mjs_selfW, undefined, 'compteur des écritures du composant tenu sans liste aux lignes propres pour le lire')
    // la sortie de la boucle n'ajoute aucun champ au composant : sa forme reste celle que la boucle optimisée a vue
    assert.equal(Object.prototype.hasOwnProperty.call(el, '_mjs_lqf'), false, 'file fine des boucles posée sur un composant qui n\'en a pas')
    assert.equal(µ._mjs_partage, false)
  })

  it('écritures de trois segments et méthode d\'une liste sous la racine : la recherche parmi les objets tenus ne se refait pas pour le même objet', async () => {
    const win = await appli('<mjs-trois></mjs-trois>')
    const el  = win.document.querySelector('mjs-trois')
    for (const m of ['ecrire', 'pousser']) {
      const { ops } = await parEcriture(win, el, m)
      assert.equal(ops.get('WeakMap.has'), undefined, `${m}, recherches parmi les objets tenus par écriture : ${texte(ops)}`)
    }
    assert.equal(brut(win, el._state.o).y.z, N2, 'dernière valeur écrite')
    assert.equal(brut(win, el._state.o).l.v.length, N1 + N2, 'éléments ajoutés')
  })

  it('objet tenu par une variable après la réponse « tenu par personne », dans le même tour : son époque avance à l\'écriture suivante', async () => {
    const win = await appli('<mjs-tenu-ensuite></mjs-tenu-ensuite>')
    const el  = win.document.querySelector('mjs-tenu-ensuite')
    const µ   = win.µ
    const b   = brut(win, el._state.o).a.b
    const avant = µ._mjs_epochs.get(b) || 0
    el.melange()
    assert.equal(brut(win, el._state.q), b, 'objet tenu par $q')
    assert.equal(b.c, 2, 'dernière valeur écrite')
    assert.equal((µ._mjs_epochs.get(b) || 0) - avant, 1, 'époque de l\'objet, avancée par la seule écriture faite après qu\'une variable le tient')
    await tic()
    assert.equal(µ._mjs_nonTenu, undefined, 'réponse retenue oubliée à la fin du tour')
  })

  it('liste aux lignes propres dans la page : chaque écriture d\'un autre composant est comptée pour elle', async () => {
    const win   = await appli('<mjs-liste></mjs-liste><mjs-ecriture></mjs-ecriture>')
    const liste = win.document.querySelector('mjs-liste')
    const el    = win.document.querySelector('mjs-ecriture')
    liste.poser()
    await tic()
    liste.fine()
    await tic()
    liste.echanger()
    await tic()
    const extW  = win.µ._mjs_extW, selfW = el._mjs_selfW || 0
    const { appels } = await parEcriture(win, el)
    assert.equal(appels.get('_mjsFineCompte'), 1, `appels par écriture : ${texte(appels)}`)
    assert.equal(win.µ._mjs_extW - extW, N1 + N2, 'écritures d\'objets comptées')
    assert.equal(el._mjs_selfW - selfW, N1 + N2, 'écritures du composant comptées')
  })

  it('objet écrit, sous la racine, tenu par un enfant : son époque avance à chaque écriture', async () => {
    const win = await appli('<mjs-tient></mjs-tient>')
    const el  = win.document.querySelector('mjs-tient')
    const µ   = win.µ
    const o   = brut(win, el._state.o).a.b
    const avant = µ._mjs_epochs.get(o) || 0
    const { appels } = await parEcriture(win, el)
    assert.equal(appels.get('_mjsDeepEpoqueObjet'), 1, `appels par écriture : ${texte(appels)}`)
    assert.equal(µ._mjs_epochs.get(o) - avant, N1 + N2, 'époque de l\'objet tenu')
    assert.equal(µ._mjs_partage, false)
  })

  it('objet du milieu du chemin tenu par un enfant : son époque avance à chaque écriture plus bas, les écritures de deux et trois segments ne paient rien de plus', async () => {
    const win = await appli('<mjs-milieu></mjs-milieu>')
    const el  = win.document.querySelector('mjs-milieu')
    const µ   = win.µ
    const a   = brut(win, el._state.o).a
    assert.equal(µ._mjs_milieu, true, 'objet lu dans l\'état, reçu par un enfant')
    const avant = µ._mjs_epochs.get(a) || 0
    const { appels } = await parEcriture(win, el)
    assert.equal(appels.get('_mjsDeepMilieu'), 1, `appels par écriture : ${texte(appels)}`)
    assert.equal(µ._mjs_epochs.get(a) - avant, N1 + N2, 'époque de l\'objet du milieu tenu')
    for (const m of ['ecrire2', 'ecrire3']) {
      const r = await parEcriture(win, el, m)
      assert.deepEqual(AIDES.filter((f) => f !== '_mjsDeepSuite' && f !== '_mjsFineEcrite' && f !== '_mjsFineSet' && r.appels.has(f)), [], `${m}, aides appelées par écriture : ${texte(r.appels)}`)
    }
    assert.equal(µ._mjs_epochs.get(a) - avant, N1 + N2, 'époque inchangée par les écritures qui ne traversent pas l\'objet')
    assert.equal(µ._mjs_partage, false)
  })

  it('racine tenue par deux composants : l\'époque de la racine avance à chaque écriture', async () => {
    const win = await appli('<mjs-partage></mjs-partage>')
    const el  = win.document.querySelector('mjs-partage')
    const µ   = win.µ
    assert.equal(µ._mjs_partage, true, 'objet tenu par deux composants')
    const root  = brut(win, el._state.o)
    const avant = µ._mjs_epochs.get(root) || 0
    const { appels } = await parEcriture(win, el)
    assert.equal(appels.get('µ._mjs_bumpEpoch'), 1, `appels par écriture : ${texte(appels)}`)
    assert.equal(µ._mjs_epochs.get(root) - avant, N1 + N2, 'époque de la racine')
  })
})
