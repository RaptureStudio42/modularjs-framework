// la table « module du cœur → ses clés » du groupe `core` (src/runtime-labels.ts), d'où le manifeste ne prend que les clés des
// modules que le build emporte. Deux gardes, sur le texte des modules (src/core-modules/*.mjs lus comme du texte) :
// - chaque clé du groupe appartient à exactement un module de la table ;
// - chaque lecture d'un libellé du cœur, dans un module, vise une clé de SON module ou d'un module que son gabarit pose.
// Les gardes sont éprouvées sur des tables fautives dont on connaît la réponse : une garde qui ne refuse rien ne protège rien.

import assert from 'node:assert/strict'
import { RUNTIME_LABELS, CORE_LABEL_MODULES, coreLabelKeys, runtimeLabelsFor } from '../src/runtime-labels.js'
import { fautesDeLaTable, lecteursSansLigne, lecturesDesModules, modulesDuCoeur, modulesPoses, moduleEtPoses, type Lectures, type Table } from './helpers/libelles-par-module.js'

const GROUPE_FR = new Set(Object.keys(RUNTIME_LABELS.fr.core))
const GROUPE_EN = new Set(Object.keys(RUNTIME_LABELS.en.core))

const table: Table = CORE_LABEL_MODULES

describe('libellés des modules du cœur — la table module → ses clés', () => {
  it('le groupe core a les mêmes clés en français et en anglais', () => {
    assert.deepEqual([...GROUPE_EN].sort(), [...GROUPE_FR].sort())
    assert.equal(GROUPE_FR.size, 51)
  })

  it('chaque clé du groupe core appartient à exactement un module de la table', () => {
    const proprietaires = new Map<string, string[]>()
    for (const [module, cles] of Object.entries(table)) for (const cle of cles) proprietaires.set(cle, [...(proprietaires.get(cle) ?? []), module])
    for (const cle of GROUPE_FR) assert.equal((proprietaires.get(cle) ?? []).length, 1, `${cle} : ${(proprietaires.get(cle) ?? []).join(', ') || 'aucun module'}`)
    for (const cle of proprietaires.keys()) assert.ok(GROUPE_FR.has(cle), `${cle} est dans la table et pas dans le groupe core`)
    assert.equal(proprietaires.size, GROUPE_FR.size)
  })

  it('chaque module de la table est un module du cœur', () => {
    const modules = new Set(modulesDuCoeur())
    for (const module of Object.keys(table)) assert.ok(modules.has(module), `${module} n'a pas de fichier dans src/core-modules`)
  })

  it('chaque libellé lu par un module du cœur est une clé de son module ou d\'un module qu\'il pose, et chaque clé de la table est lue', () => {
    assert.deepEqual(fautesDeLaTable(table, GROUPE_FR, lecturesDesModules(GROUPE_FR), modulesPoses()), [])
  })

  it('la lecture du texte trouve ce qu\'elle doit : les douze modules à libellé lisent leurs clés, les autres aucune', () => {
    const lectures = lecturesDesModules(GROUPE_FR)
    for (const [module, cles] of Object.entries(table)) assert.deepEqual([...(lectures.get(module)?.lues ?? [])].sort(), [...cles].sort(), module)
    for (const [module, { lues }] of lectures) if (!(module in table)) assert.equal(lues.size, 0, `${module} lit des clés et n'est pas dans la table`)
    assert.equal(Object.keys(table).length, 12)
  })

  it('un module qui appelle le groupe core a sa ligne dans la table, sauf <@@sortable> dont les textes sont dans le module', () => {
    assert.deepEqual(lecteursSansLigne(table, lecturesDesModules(GROUPE_FR), ['sortable']), [])
    assert.deepEqual(lecteursSansLigne(table, lecturesDesModules(GROUPE_FR), []), ['sortable'])
  })

  it('l\'éditeur pose la barre : le gabarit du premier nomme le second', () => {
    const poses = modulesPoses()
    assert.ok(poses.get('editor')!.has('toolbar'))
    assert.deepEqual([...moduleEtPoses('editor', poses)].sort(), ['editor', 'toolbar'])
    assert.deepEqual([...moduleEtPoses('select', poses)], ['select'])
  })

  describe('les gardes refusent une table fautive', () => {
    const lectures = () => lecturesDesModules(GROUPE_FR)
    const poses    = () => modulesPoses()

    it('une clé rangée sous deux modules', () => {
      const fautes = fautesDeLaTable({ ...table, gauge: ['gaugeLabel', 'knobLabel'] }, GROUPE_FR, lectures(), poses())
      assert.ok(fautes.some((f) => f.includes('« knobLabel »') && f.includes('plusieurs modules (gauge, knob)')), fautes.join('\n'))
    })

    it('une clé du groupe qui n\'appartient à aucun module', () => {
      const fautes = fautesDeLaTable({ ...table, gauge: [] }, GROUPE_FR, lectures(), poses())
      assert.ok(fautes.some((f) => f.includes('« gaugeLabel »') && f.includes('n\'appartient à aucun module')), fautes.join('\n'))
    })

    it('un module de la table sans fichier, et une clé de la table absente du groupe', () => {
      const fautes = fautesDeLaTable({ ...table, fantome: ['fantomeLabel'] }, GROUPE_FR, lectures(), poses())
      assert.ok(fautes.some((f) => f.includes('« fantome »') && f.includes('pas de fichier')), fautes.join('\n'))
      assert.ok(fautes.some((f) => f.includes('« fantomeLabel »') && f.includes('n\'est pas dans le groupe core')), fautes.join('\n'))
    })

    it('une clé rangée sous le mauvais module : le module qui la lit n\'est pas à elle, celui qui l\'a ne la lit pas', () => {
      const fautes = fautesDeLaTable({ ...table, select: table.select.filter((c) => c !== 'selectEmpty'), number: [...table.number, 'selectEmpty'] }, GROUPE_FR, lectures(), poses())
      assert.ok(fautes.some((f) => f.startsWith('select lit « selectEmpty »') && f.includes('ni à lui ni à un module qu\'il pose')), fautes.join('\n'))
      assert.ok(fautes.some((f) => f.startsWith('number : la clé « selectEmpty »') && f.includes('ne la lit pas')), fautes.join('\n'))
    })

    it('une clé de l\'éditeur rangée sous la barre : l\'éditeur pose la barre, seule la lecture à l\'envers la dénonce', () => {
      const fautes = fautesDeLaTable({ ...table, editor: table.editor.filter((c) => c !== 'linkDone'), toolbar: [...table.toolbar, 'linkDone'] }, GROUPE_FR, lectures(), poses())
      assert.ok(!fautes.some((f) => f.startsWith('editor lit « linkDone »')), fautes.join('\n'))
      assert.ok(fautes.some((f) => f.startsWith('toolbar : la clé « linkDone »') && f.includes('ne la lit pas')), fautes.join('\n'))
    })

    it('un module qui lit une clé absente du groupe (faute de frappe)', () => {
      const lues = lectures()
      lues.set('select', { lues: new Set(lues.get('select')!.lues), inconnues: new Set(['selectPlacehoder']), appelle: true })
      const fautes = fautesDeLaTable(table, GROUPE_FR, lues, poses())
      assert.ok(fautes.some((f) => f.startsWith('select lit « selectPlacehoder »') && f.includes('pas dans le groupe core')), fautes.join('\n'))
    })

    it('un module qui lit la clé d\'un autre : refusé, sauf si son gabarit pose cet autre module', () => {
      const lues = lectures()
      const voisin = new Map<string, Lectures>(lues)
      voisin.set('editor', { lues: new Set([...lues.get('editor')!.lues, 'toolBold']), inconnues: new Set(), appelle: true })
      const sansPose = fautesDeLaTable(table, GROUPE_FR, voisin, new Map())
      assert.ok(sansPose.some((f) => f.startsWith('editor lit « toolBold »')), sansPose.join('\n'))
      const avecPose = fautesDeLaTable(table, GROUPE_FR, voisin, modulesPoses())
      assert.ok(!avecPose.some((f) => f.startsWith('editor lit « toolBold »')), avecPose.join('\n'))
    })

    it('un module qui appelle le groupe sans ligne dans la table (lecture que les écritures connues ne voient pas)', () => {
      const lues = lectures()
      lues.set('fantome', { lues: new Set(), inconnues: new Set(), appelle: true })
      assert.deepEqual(lecteursSansLigne(table, lues, ['sortable']), ['fantome'])
    })

    it('la table réelle, elle, ne produit aucune de ces fautes', () => {
      assert.deepEqual(fautesDeLaTable(table, GROUPE_FR, lectures(), poses()), [])
    })
  })
})

describe('coreLabelKeys — les clés des modules donnés', () => {
  it('l\'union des clés de chaque module, sans doublon', () => {
    assert.deepEqual([...coreLabelKeys(['select'])].sort(), [...table.select].sort())
    assert.deepEqual([...coreLabelKeys(['editor', 'toolbar'])].sort(), [...table.editor, ...table.toolbar].sort())
    assert.equal(coreLabelKeys(['select', 'select']).size, table.select.length)
  })

  it('un module sans libellé, ou inconnu : aucune clé (jamais une propriété du prototype)', () => {
    for (const nom of ['sortable', 'field', 'checkbox', 'nom-inconnu', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(coreLabelKeys([nom]).size, 0, nom)
  })
})

describe('runtimeLabelsFor — le groupe core limité aux modules emportés', () => {
  const GROUPES = new Set(['core'])
  const ordre   = (lang: 'fr' | 'en', cles: ReadonlySet<string>) => Object.keys(RUNTIME_LABELS[lang].core).filter((k) => cles.has(k))

  it('un module : ses clés seules, dans l\'ordre de la table, en français et en anglais, textes intacts', () => {
    const t = runtimeLabelsFor(false, GROUPES, new Set(['select'])) as any
    const cles = new Set(table.select)
    assert.deepEqual(Object.keys(t.fr.core), ordre('fr', cles))
    assert.deepEqual(Object.keys(t.en.core), ordre('en', cles))
    for (const k of table.select) {
      assert.equal(t.fr.core[k], (RUNTIME_LABELS.fr.core as any)[k])
      assert.equal(t.en.core[k], (RUNTIME_LABELS.en.core as any)[k])
    }
  })

  it('deux modules : l\'union ; l\'ordre ne dépend pas de celui des modules donnés', () => {
    const a = runtimeLabelsFor(false, GROUPES, new Set(['toolbar', 'editor'])) as any
    const b = runtimeLabelsFor(false, GROUPES, new Set(['editor', 'toolbar'])) as any
    assert.deepEqual(Object.keys(a.fr.core), Object.keys(b.fr.core))
    assert.deepEqual(Object.keys(a.fr.core).sort(), [...table.editor, ...table.toolbar].sort())
  })

  it('aucun module à libellé : le groupe core ne part pas', () => {
    for (const modules of [new Set<string>(), new Set(['sortable', 'field'])]) {
      const t = runtimeLabelsFor(false, GROUPES, modules) as any
      assert.equal('core' in t.fr, false)
      assert.equal('core' in t.en, false)
    }
  })

  it('modules inconnus (faits manquants) : tout le groupe, comme avant', () => {
    const t = runtimeLabelsFor(false, GROUPES) as any
    assert.equal(Object.keys(t.fr.core).length, 51)
    assert.equal(Object.keys(t.en.core).length, 51)
  })

  it('groupes inconnus : tout est gardé, la liste des modules n\'y change rien', () => {
    const t = runtimeLabelsFor(false, undefined, new Set(['select'])) as any
    assert.equal(Object.keys(t.fr.core).length, 51)
  })

  it('le groupe core n\'est pas demandé : il ne part pas, quels que soient les modules', () => {
    const t = runtimeLabelsFor(false, new Set(['fx']), new Set(['select'])) as any
    assert.equal('core' in t.fr, false)
    assert.equal('fx' in t.fr, true)
  })

  it('en production : mêmes clés, sans err ni dev', () => {
    const t = runtimeLabelsFor(true, GROUPES, new Set(['editor', 'toolbar'])) as any
    assert.deepEqual(Object.keys(t.fr.core).sort(), [...table.editor, ...table.toolbar].sort())
    assert.equal('err' in t.fr, false)
    assert.equal('dev' in t.fr, false)
  })

  it('les autres groupes ne bougent pas', () => {
    const t = runtimeLabelsFor(false, new Set(['core', 'modal', 'toast']), new Set(['select'])) as any
    assert.deepEqual(t.fr.modal, RUNTIME_LABELS.fr.modal)
    assert.deepEqual(t.en.toast, RUNTIME_LABELS.en.toast)
  })
})
