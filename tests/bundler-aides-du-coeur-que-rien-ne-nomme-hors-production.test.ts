// les aides du cœur que seuls un autre fichier du cœur ou une écriture précise du code compilé appellent : la copie des écouteurs d'une
// balise remplacée (`µ._mjs_evCopy` : <@element>, <@module>, composant en échec, *marquee), la case écrite sans rendu (`µ._mjs_rawWrite` :
// µwrite), l'index des liaisons filtrées quand plusieurs lignes portent la même valeur (`µ._mjs_filtPut`, `µ._mjs_filtCall`), la plus
// longue suite croissante de la réconciliation (`µ._mjs_lis` : {for}), la copie d'avant d'une écriture que µinspect suit (`µ._mjs_snap`),
// l'appel et la suppression profonds (`µ._mjs_deepCall` : `$l.push(x)` ; `µ._mjs_deepDelete` : `delete $o.a`), l'état lu comme une valeur
// (`µ._mjs_makeDeepProxy` : `Object.assign($, …)`) et, dans le retrait d'un composant de la page, la défaite de ses attaches et de ses
// références (`:attach`, `:this`, un effet posé). Une construction de production n'emporte chacune que si le texte compilé d'une unité
// écrit son nom, où que ce soit (un texte qui la cite la garde : une mention de trop coûte quelques octets, un appel manqué casserait
// l'appli), ou si le cœur assemblé la nomme encore ; le développement et `runtime: 'all'` les gardent toutes (un composant recompilé à
// chaud, une page compilée à la volée peuvent s'en servir), et `runtime: ['deep']` garde les quatre fonctions de l'écriture profonde.
// Les deux pages compilées à la volée (journal, atelier de thème) n'en nomment aucune que ni le cœur ni elles n'apportent

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as bundlerModule from '../src/bundler/index.js'
import * as featuresModule from '../src/bundler/features.js'
import * as viewerModule from '../src/server/viewer-page.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const { Bundler, terminateSharedWorkerPool }                   = bundlerModule
const { getViewerScript, localizeViewerSource, JOURNAL_VIEWER, THEME_VIEWER } = viewerModule

type Sources = Record<string, string>

const HERE                 = dirname(fileURLToPath(import.meta.url))
const page                 = (...lignes: string[]): string => lignes.join('\n')
const NUE: Sources         = { 'carte-nue.mjs': page('<script>', '$titre = \'Bonjour\'', '</script>', '<p>{$titre}</p>') }
const BALISE: Sources      = { 'carte-balise.mjs': page('<script>', '$tag = \'section\'', '</script>', '<@element $tag data-t="el">x</@element>') }
const SANS_RENDU: Sources  = { 'carte-ecrite.mjs': page('<script>', '$n = 0', '@poser = (v) -> µwrite $n, v', '</script>', '<p>{$n}</p>') }
const LISTE: Sources       = { 'carte-liste.mjs': page('<script>', '$rows = [{id: 1, g: \'a\'}, {id: 2, g: \'a\'}]', '$choix = 1', '</script>', '<ul>{for row in $rows by id}<li :class{$choix === row.id}="on">{row.id}</li>{end}</ul>') }
const GROUPES: Sources     = { 'carte-groupes.mjs': page('<script>', '$rows = [{id: 1, g: \'a\'}, {id: 2, g: \'a\'}]', '$choix = \'a\'', '</script>', '<ul>{for row in $rows by id}<li :class{$choix === row.g}="on">{row.id}</li>{end}</ul>') }
const SUIVIE: Sources      = { 'carte-suivie.mjs': page('<script>', '$o = {n: 0}', 'µinspect($o)', '</script>', '<p>{$o.n}</p>') }
const REFERENCE: Sources   = { 'carte-reference.mjs': page('<script>', 'el = null', '</script>', '<b :this=!{el}>x</b>') }
const ATTACHE: Sources     = { 'carte-attache.mjs': page('<script>', 'poser = (n) -> -> 0', '</script>', '<b :attach={poser}>x</b>') }
const EFFET: Sources       = { 'carte-effet.mjs': page('<b *tilt>x</b>') }
const PROFONDE: Sources    = { 'carte-profonde.mjs': page('<script>', '$o = {a: 1}', '@changer = -> $o.a = 2', '</script>', '<p>{$o.a}</p>') }
const POUSSEE: Sources     = { 'carte-poussee.mjs': page('<script>', '$l = [1]', '@ajouter = -> $l.push(2)', '</script>', '<p>{$l.length}</p>') }
const OTEE: Sources        = { 'carte-otee.mjs': page('<script>', '$o = {a: 1}', '@oter = -> delete $o.a', '</script>', '<p>{$o.a}</p>') }
const CITEE: Sources       = { ...LISTE, 'carte-citee.mjs': page('<script>', '$doc = \'_mjs_makeDeepProxy _mjs_deepCall _mjs_deepDelete _mjs_lis _mjs_evCopy _mjs_filtPut _mjs_filtCall _mjs_rawWrite\'', '$o = {a: 1}', '@changer = -> $o.a = 2', '</script>', '<p>{$doc} {$o.a}</p>') }
const EN_VALEUR: Sources   = { 'carte-valeur.mjs': page('<script>', '$n = 1', '@tout = -> Object.assign($, {n: 2})', '</script>', '<p>{$n}</p>') }

// chaque aide : sa définition dans le texte du cœur (non minifié), et les applis qui s'en servent, avec ce que leur code y écrit
interface Cas { aide: string, porte: RegExp, avec: Array<[string, Sources, RegExp]> }
const CAS: Cas[] = [
  { aide: 'la copie des écouteurs d\'une balise remplacée', porte: /µ\._mjs_evCopy = function/, avec: [['<@element>', BALISE, /\._updDynEl\(/]] },
  { aide: 'la case écrite sans rendu', porte: /µ\._mjs_rawWrite = function/, avec: [['µwrite', SANS_RENDU, /\._mjs_rawWrite\(_mjsThis\)/]] },
  { aide: 'l\'index des liaisons filtrées à plusieurs lignes par valeur', porte: /µ\._mjs_filtPut = function[\s\S]*µ\._mjs_filtCall = function/, avec: [['liaison filtrée par un champ qui n\'est pas la clé', GROUPES, /^(?=[\s\S]*µ\._mjs_filtPut\(__fe)(?=[\s\S]*µ\._mjs_filtCall\()/]] },
  { aide: 'la plus longue suite croissante', porte: /µ\._mjs_lis = function/, avec: [['{for}', LISTE, /\._mjs_updFor\(/]] },
  { aide: 'la copie d\'avant d\'une écriture suivie', porte: /µ\._mjs_snap = function\(v\) \{\n\s*if \(v == null\) return v;/, avec: [['µinspect', SUIVIE, /var mjsInspectSources/]] },
  { aide: 'la défaite des attaches au retrait de la page', porte: /if \(this\._mjs_attachments\) \{/, avec: [[':this', REFERENCE, /this\._mjs_attachments\.add\(/], [':attach', ATTACHE, /this\._mjs_attachments/], ['un effet (*tilt)', EFFET, /const __ats = this\._mjs_attachments|c\._mjs_attachments = new Set\(\)/]] },
  { aide: 'l\'appel profond', porte: /µ\._mjs_deepCall = function/, avec: [['$l.push(x)', POUSSEE, /µ\._mjs_deepCall\(_mjsThis/]] },
  { aide: 'la suppression profonde', porte: /µ\._mjs_deepDelete = function/, avec: [['delete $o.a', OTEE, /µ\._mjs_deepDelete\(_mjsThis/]] },
  { aide: 'l\'état lu comme une valeur', porte: /µ\._mjs_makeDeepProxy = function/, avec: [['Object.assign($, …)', EN_VALEUR, /µ\._mjs_makeDeepProxy\(_mjsThis/]] }
]
const PROFONDES = CAS.slice(6)

const faites = new Map<string, Promise<{ texte: string, manifeste: string }>>()
function construire(nom: string, sources: Sources, env: 'dev' | 'prod', runtime: string | string[] = 'core'): Promise<{ texte: string, manifeste: string }> {
  const cle = [nom, env, String(runtime)].join('|')
  let faite = faites.get(cle)
  if (faite === undefined) {
    faite = (async () => {
      const root   = mjsTmp('aides-seules-' + env)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s + '\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime, js: 'bundle', env, minify: false, lint: { a11y: false } } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return { texte: (readdirSync(outDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.js')).sort().map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n'), manifeste: join(outDir, 'bundle.js') }
    })()
    faites.set(cle, faite)
  }
  return faite
}

describe('aides du cœur que rien ne nomme : hors du cœur de production, gardées pour l\'appli qui s\'en sert', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const cas of CAS.slice(0, 6)) {
    it(`production, aucune unité ne s'en sert : ${cas.aide} n'est pas au cœur`, async () => {
      const { texte } = await construire('nue', NUE, 'prod')
      assert.match(texte, /µ\._mjs_toRaw = function/, 'garde muette : le texte lu est celui du cœur, noms en clair')
      assert.doesNotMatch(texte, cas.porte)
    })
  }

  for (const cas of PROFONDES) {
    it(`production, une appli qui n'écrit qu'une affectation profonde : ${cas.aide} n'est pas au cœur`, async () => {
      const { texte } = await construire('profonde', PROFONDE, 'prod')
      assert.match(texte, /µ\._mjs_deepSet = function/, 'garde muette : l\'écriture profonde est au cœur de cette appli')
      assert.doesNotMatch(texte, cas.porte)
    })
  }

  it('production, liaison filtrée par la clé de la ligne : l\'index à plusieurs lignes par valeur n\'est pas au cœur, le retrait d\'une ligne y reste', async () => {
    const { texte } = await construire('liste', LISTE, 'prod')
    assert.match(texte, /µ\._mjs_filtDrop = function/)
    assert.doesNotMatch(texte, /µ\._mjs_filtPut = function/)
    assert.doesNotMatch(texte, /µ\._mjs_filtCall = function/)
  })

  it('production, aucune attache ni référence nulle part : plus rien ne nomme la liste des attaches', async () => {
    const { texte } = await construire('nue', NUE, 'prod')
    assert.doesNotMatch(texte, /_mjs_attachments/)
  })

  for (const cas of CAS) {
    for (const [ecrit, sources, usage] of cas.avec) {
      it(`production, une unité écrit ${ecrit} : ${cas.aide} est au cœur`, async () => {
        const { texte } = await construire(Object.keys(sources)[0], sources, 'prod')
        assert.match(texte, usage, 'garde muette : le code de cette appli s\'en sert')
        assert.match(texte, cas.porte)
      })
    }
  }

  it('production, une unité cite le nom de ces aides dans un texte, sans s\'en servir : chacune reste au cœur (une mention de trop garde, jamais l\'inverse)', async () => {
    const { texte } = await construire('citee', CITEE, 'prod')
    assert.match(texte, /_mjs_deepCall _mjs_deepDelete/, 'garde muette : le texte de l\'unité cite les noms')
    for (const cas of [...CAS.slice(0, 4), ...PROFONDES]) assert.match(texte, cas.porte, cas.aide)
  })

  it('production, `runtime: [\'deep\']` : les quatre fonctions de l\'écriture profonde sont au cœur, même sans unité qui s\'en sert', async () => {
    const { texte } = await construire('nue', NUE, 'prod', ['deep'])
    assert.match(texte, /µ\._mjs_deepSet = function/, 'garde muette : le module demandé est au cœur')
    for (const cas of PROFONDES) assert.match(texte, cas.porte, cas.aide)
  })

  it('développement : le cœur les garde toutes, même sans unité qui s\'en sert', async () => {
    const nue      = (await construire('nue', NUE, 'dev')).texte
    const profonde = (await construire('profonde', PROFONDE, 'dev')).texte
    const liste    = (await construire('liste', LISTE, 'dev')).texte
    for (const cas of CAS.slice(0, 6)) if (cas !== CAS[2]) assert.match(nue, cas.porte, cas.aide)
    for (const cas of PROFONDES) assert.match(profonde, cas.porte, cas.aide)
    assert.match(liste, CAS[2].porte, CAS[2].aide)
  })

  it('production, cœur demandé tout entier (`runtime: \'all\'`) : il les garde toutes', async () => {
    const { texte } = await construire('nue', NUE, 'prod', 'all')
    for (const cas of CAS.slice(0, 6)) if (cas !== CAS[2]) assert.match(texte, cas.porte, cas.aide)
    const profonde  = (await construire('profonde', PROFONDE, 'prod', 'all')).texte
    for (const cas of PROFONDES) assert.match(profonde, cas.porte, cas.aide)
    assert.match((await construire('liste', LISTE, 'prod', 'all')).texte, CAS[2].porte, CAS[2].aide)
  })

  for (const [fichier, spec, dite] of [['errors-viewer.mjs', JOURNAL_VIEWER, 'la page du journal'], ['theme-viewer.mjs', THEME_VIEWER, 'l\'atelier de thème']] as const) {
    it(`${dite}, compilée à la volée, ne nomme aucune de ces aides que ni le cœur ni elle n'apportent`, async () => {
      const seules: Array<[string, string[]]> = ((featuresModule as any).LONE_HELPERS ?? []).map((e: [string, string[]]) => [e[0], [...e[1]]])
      // avec la copie d'avant d'une écriture suivie, que le cœur de production perd avec µinspect
      const noms       = [...seules.flatMap((e) => e[1]), '_mjs_snap']
      assert.ok(noms.length >= 9 && noms.includes('_mjs_evCopy') && noms.includes('_mjs_lis') && noms.includes('_mjs_deepDelete'), `garde muette : la liste des aides retirées est lue (${noms.join(', ')})`)
      const { output } = await transpile(localizeViewerSource(readFileSync(join(HERE, '..', 'src', 'server', fichier), 'utf8')), { moduleName: spec.moduleName })
      const nommes     = new Set([...output.matchAll(/\.(_mjs_\w+)/g)].map((m) => m[1]))
      assert.ok(nommes.has('_mjs_updFor') && nommes.has('_mjs_mount'), 'garde muette : les noms internes du code de la page sont relevés')
      const apportes   = new Set(((viewerModule as any).VIEWER_RUNTIME ?? []).map((e: { member: string }) => e.member))
      assert.deepEqual(noms.filter((n) => nommes.has(n) && !apportes.has(n)), [], dite + ' nomme une aide que la production retire et qu\'elle n\'apporte pas')
      assert.equal(nommes.has('_mjs_attachments'), false, dite + ' pose une attache : son retrait de la page ne la déferait plus sur un cœur sans attache')
    })
  }

  it('production, appli qui écrit en profondeur sans supprimer : l\'atelier de thème, qui supprime, apporte la suppression profonde ; la page du journal, qui n\'en appelle rien, ne joint rien de l\'écriture profonde', async () => {
    const { texte, manifeste } = await construire('profonde', PROFONDE, 'prod')
    assert.match(texte, /µ\._mjs_deepSet = function/, 'garde muette : l\'écriture profonde est au cœur de cette appli')
    assert.doesNotMatch(texte, /µ\._mjs_deepDelete = function/, 'garde muette : la suppression profonde n\'y est pas')
    const atelier = await getViewerScript(manifeste, THEME_VIEWER)
    assert.match(atelier, /µ\._mjs_deepDelete\(_mjsThis/, 'garde muette : l\'atelier supprime en profondeur')
    assert.match(atelier, /if \(!µ\._mjs_deepDelete\) \{[\s\S]*µ\._mjs_deepDelete = function/)
    const journal = await getViewerScript(manifeste, JOURNAL_VIEWER)
    assert.doesNotMatch(journal, /µ\._mjs_deep(?:Set|Delete) = function/)
  })

  it('cœur nu : la page qui apporte l\'écriture profonde ne joint son fichier qu\'une fois', async () => {
    const { manifeste } = await construire('nue', NUE, 'prod')
    const atelier       = await getViewerScript(manifeste, THEME_VIEWER)
    assert.equal([...atelier.matchAll(/µ\._mjs_deepDelete = function/g)].length, 1)
    assert.equal([...atelier.matchAll(/µ\._mjs_deepSet = function/g)].length, 1)
  })

  it('la page du journal, sur le cœur de production d\'une appli sans {for}, apporte la passe des listes et la suite croissante qu\'elle appelle', async () => {
    const { manifeste } = await construire('nue', NUE, 'prod')
    const script        = await getViewerScript(manifeste, JOURNAL_VIEWER)
    assert.match(script, /_mjs_updFor = function/, 'garde muette : la page apporte la passe des listes à un cœur qui ne l\'a pas')
    assert.match(script, /if \(!µ\._mjs_lis\) \{\n\/\/ <longest-run>/)
  })
})
