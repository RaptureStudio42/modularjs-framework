// aides des tests « libellés par module » : les modules du cœur lus comme du texte (quelles clés du groupe `core` chacun lit,
// quels autres modules son gabarit pose), le contrôle de la table module → clés, et la table de libellés qu'un build a posée
// dans son manifeste (en développement comme en production, manifeste éclaté ou fichier unique)

import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOSSIER_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'core-modules')

// les trois écritures d'une lecture : l'appel direct, l'aide `tr('clé', …)` que chaque module pose
// (`tr = (key, lang)-> µ._mjs_label('core', key)`) et la table d'outils de la barre (`label: 'toolBold'`)
const LECTURE_DIRECTE = /_mjs_label\(\s*['"]core['"]\s*,\s*['"](\w+)['"]/g
const LECTURE_AIDE    = /\btr\(\s*['"](\w+)['"]/g
const LECTURE_TABLE   = /\blabel:\s*['"](\w+)['"]/g

// le module appelle le groupe `core` d'une façon ou d'une autre, clé littérale ou non
const APPEL_DU_GROUPE = /_mjs_label\(\s*['"]core['"]/

export type Table    = Record<string, readonly string[]>
export type Lectures = { lues: Set<string>, inconnues: Set<string>, appelle: boolean }

// les fichiers du cœur, par nom de module (`<@@nom>`) ; un modèle en fichier (`select.compact.mjs`) se range sous son module
function fichiersDuCoeur(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of readdirSync(DOSSIER_MODULES)) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue
    const module = basename(f, '.mjs').split('.')[0]
    out.set(module, [...(out.get(module) ?? []), join(DOSSIER_MODULES, f)])
  }
  return out
}

export function modulesDuCoeur(): string[] {
  return [...fichiersDuCoeur().keys()].sort()
}

// les clés que chaque module lit. `groupe` = toutes les clés du groupe `core` : une écriture de la table d'outils ne compte que
// si elle nomme une clé du groupe (un `label: 'Titre'` quelconque ne lit rien) ; un appel direct ou par l'aide qui nomme une clé
// absente du groupe est rangé à part, c'est une faute de frappe. `appelle` : le texte du module appelle le groupe, même sans clé littérale
export function lecturesDesModules(groupe: ReadonlySet<string>): Map<string, Lectures> {
  const out = new Map<string, Lectures>()
  for (const [module, fichiers] of fichiersDuCoeur()) {
    const lectures: Lectures = { lues: new Set(), inconnues: new Set(), appelle: false }
    for (const f of fichiers) {
      const texte = readFileSync(f, 'utf-8')
      if (APPEL_DU_GROUPE.test(texte)) lectures.appelle = true
      for (const re of [LECTURE_DIRECTE, LECTURE_AIDE]) {
        for (const m of texte.matchAll(re)) (groupe.has(m[1]) ? lectures.lues : lectures.inconnues).add(m[1])
      }
      for (const m of texte.matchAll(LECTURE_TABLE)) if (groupe.has(m[1])) lectures.lues.add(m[1])
    }
    out.set(module, lectures)
  }
  return out
}

// les modules du cœur que le gabarit de chaque module pose (`<@@nom`, `<mjs-core-nom`) : le markup seul, sans ses scripts, ses
// styles ni ses commentaires — une phrase de message qui cite `<@@select>` ne pose rien
export function modulesPoses(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [module, fichiers] of fichiersDuCoeur()) {
    const poses = new Set<string>()
    for (const f of fichiers) {
      const markup = readFileSync(f, 'utf-8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')
      for (const m of markup.matchAll(/<(?:@@|mjs-core-)([a-z][a-z0-9-]*)/g)) if (m[1] !== module) poses.add(m[1])
    }
    out.set(module, poses)
  }
  return out
}

// un module et, jusqu'au point fixe, ceux que son gabarit pose
export function moduleEtPoses(module: string, poses: Map<string, Set<string>>): Set<string> {
  const out  = new Set<string>()
  const file = [module]
  while (file.length > 0) {
    const m = file.pop()!
    if (out.has(m)) continue
    out.add(m)
    file.push(...(poses.get(m) ?? []))
  }
  return out
}

// les fautes de la table (liste vide = saine) : chaque clé du groupe a un propriétaire et un seul, chaque module de la table
// a son fichier, chaque lecture d'un module vise une clé de son module ou d'un module qu'il pose, et chaque clé rangée sous
// un module est bien lue par lui
export function fautesDeLaTable(table: Table, groupe: ReadonlySet<string>, lectures: Map<string, Lectures>, poses: Map<string, Set<string>>): string[] {
  const fautes: string[] = []
  const proprietaires = new Map<string, string[]>()
  for (const [module, cles] of Object.entries(table)) {
    if (!lectures.has(module)) fautes.push(`le module « ${module} » de la table n'a pas de fichier dans src/core-modules`)
    for (const cle of cles) proprietaires.set(cle, [...(proprietaires.get(cle) ?? []), module])
  }
  for (const cle of groupe) {
    const modules = proprietaires.get(cle) ?? []
    if (modules.length === 0) fautes.push(`la clé « ${cle} » du groupe core n'appartient à aucun module`)
    if (modules.length > 1) fautes.push(`la clé « ${cle} » du groupe core appartient à plusieurs modules (${modules.join(', ')})`)
  }
  for (const [cle, modules] of proprietaires) if (!groupe.has(cle)) fautes.push(`la clé « ${cle} » (module ${modules.join(', ')}) n'est pas dans le groupe core`)
  for (const [module, { lues, inconnues }] of lectures) {
    const permis = new Set<string>()
    for (const m of moduleEtPoses(module, poses)) for (const cle of table[m] ?? []) permis.add(cle)
    for (const cle of inconnues) fautes.push(`${module} lit « ${cle} », qui n'est pas dans le groupe core`)
    for (const cle of lues) if (!permis.has(cle)) fautes.push(`${module} lit « ${cle} », qui n'est ni à lui ni à un module qu'il pose`)
    for (const cle of table[module] ?? []) if (!lues.has(cle)) fautes.push(`${module} : la clé « ${cle} » est rangée sous lui mais il ne la lit pas`)
  }
  return fautes
}

// les modules qui appellent le groupe `core` sans avoir de ligne dans la table, hors ceux de `exceptions` : une lecture que les trois
// écritures ci-dessus ne reconnaissent pas (un autre nom d'aide, une clé calculée) passerait sinon entre les gardes
export function lecteursSansLigne(table: Table, lectures: Map<string, Lectures>, exceptions: readonly string[]): string[] {
  return [...lectures].filter(([module, { appelle }]) => appelle && !Object.hasOwn(table, module) && !exceptions.includes(module)).map(([module]) => module).sort()
}

// l'objet posé après `_runtimeLabels = ` dans un texte de build : lu par accolades, chaînes respectées (guillemets simples,
// doubles, accent grave) ; la minification de production écrit un objet JavaScript, pas du JSON, d'où l'évaluation
export function tableDeLibelles(texte: string): Record<string, any> | null {
  const m = /_runtimeLabels\s*=\s*\{/.exec(texte)
  if (!m) return null
  const debut = m.index + m[0].length - 1
  let profondeur = 0
  let guillemet  = ''
  for (let j = debut; j < texte.length; j++) {
    const c = texte[j]
    if (guillemet) {
      if (c === '\\') j++
      else if (c === guillemet) guillemet = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') guillemet = c
    else if (c === '{') profondeur++
    else if (c === '}' && --profondeur === 0) return new Function('return ' + texte.slice(debut, j + 1))()
  }
  return null
}

// la table de libellés d'un build : posée par le manifeste, ou, en fichier unique, par le fichier de départ qui l'inclut
export function libellesDuBuild(manifestPath: string, outDir: string): Record<string, any> {
  const candidats = [manifestPath, ...readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => join(outDir, f))]
  for (const f of candidats) {
    let texte = ''
    try { texte = readFileSync(f, 'utf-8') } catch { continue }
    const table = tableDeLibelles(texte)
    if (table) return table
  }
  throw new Error(`aucune table de libellés dans ${manifestPath} ni dans ${outDir}`)
}
