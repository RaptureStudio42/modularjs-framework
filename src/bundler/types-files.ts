// bundler/types-files — les fichiers `*.types.mjs` : les règles nommées de l'appli.
//
// Un fichier de types n'est pas un composant : il ne produit aucun custom element, seulement des
// règles nommées (`Percent  int 0..100`), écrites dans un bloc <types> et valables dans toute
// l'appli. Chaque composant qui en cite une dans son <vars> la reçoit au build (TranspileOpts.
// typeDefs) et l'embarque, résolue : rien n'est chargé au runtime. Un composant qui cite une règle
// nommée dépend de ces fichiers — un changement de règle le recompile (cf. CacheEntry.typesDeps).

import { basename } from 'node:path'

import { extractSections } from '../transpiler/sections.js'
import { parseTypesBlock, resolveRule, type RuleAst } from '../transpiler/var-types.js'
import { t } from '../messages/index.js'

export function isTypesFile(filePath: string): boolean {
  return basename(filePath, '.mjs').endsWith('.types')
}

export interface TypeDef {
  name: string
  rule: RuleAst
  file: string
  line: number
}

/** un fichier → ses règles nommées, telles qu'écrites (résolues par chaque composant qui les cite) */
export function readTypesFile(source: string, filePath: string): TypeDef[] {
  const file     = basename(filePath)
  const sections = extractSections(source)
  const impure   = (what: string) => new Error(t('bundler.types-file-impure', { file: file, what: what }))
  if (sections.types.length === 0) throw new Error(t('bundler.types-file-no-block', { file: file }))
  if (sections.types.length > 1)   throw new Error(t('bundler.types-file-multi', { file: file }))
  // un commentaire HTML (et le blanc autour) hors du bloc est toléré, comme dans un *.theme.mjs
  if (sections.html.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '').trim() !== '')                        throw impure('du HTML')
  if (sections.script.raw.trim() !== '' || sections.module.raw.trim() !== '')             throw impure('<script>')
  if (sections.style.raw.trim() !== '' || sections.layouts.length > 0)                     throw impure('<style>')
  if (sections.themes.length > 0)                                                          throw impure('<theme>')
  if (sections.vars)                                                                       throw impure('<vars>')
  if (sections.routes.length > 0)                                                          throw impure('<routes>')
  if (sections.effects.length > 0)                                                         throw impure('<effects>')
  const block = sections.types[0]
  try {
    return parseTypesBlock(block.raw, block.startLine).map(e => ({ name: e.name, rule: e.rule, file: filePath, line: e.line }))
  }
  catch (e: any) {
    throw new Error(`${file} : ${e?.message ?? e}`)
  }
}

/** toutes les règles nommées du projet : un nom par appli ; chaque définition se résout tout de
 *  suite (nom inconnu, règles qui tournent en rond), l'erreur cite son fichier */
export function collectTypeDefs(files: string[], read: (file: string) => string): Record<string, RuleAst> {
  const defs: Record<string, RuleAst>   = {}
  const origin: Record<string, TypeDef> = {}
  for (const f of [...files].sort()) {
    for (const d of readTypesFile(read(f), f)) {
      if (Object.prototype.hasOwnProperty.call(origin, d.name)) throw new Error(t('bundler.types-name-duplicate', { name: d.name, file1: basename(origin[d.name].file), file2: basename(d.file) }))
      origin[d.name] = d
      defs[d.name]   = d.rule
    }
  }
  for (const name of Object.keys(defs)) {
    try {
      resolveRule(defs[name], defs, { block: '<types>', line: origin[name].line }, [name])
    }
    catch (e: any) {
      throw new Error(`${basename(origin[name].file)} : ${e?.message ?? e}`)
    }
  }
  return defs
}
