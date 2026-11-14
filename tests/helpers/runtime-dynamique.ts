// mjs_dynamic.ts lu pour un test qui l'évalue seul : le constructeur le met dans le même cœur que mjs_element.ts, dont il se sert de
// deux tables (`_mjs_clsBases`, la classe écrite de chaque balise ; `_mjs_spCk`, sa part étalée) et d'une aide (`µ._mjs_evCopy`, qui
// donne à la balise neuve le routage des gestionnaires de celle qu'elle remplace). Leurs déclarations, reprises telles quelles de
// mjs_element.ts, passent devant : le test suit le cœur réel, et casse net si l'une d'elles change de forme
import { readFileSync } from 'node:fs'

const TABLES_PARTAGEES = ['_mjs_clsBases', '_mjs_spCk']
const AIDES_PARTAGEES  = ['_mjs_evCopy']

export function lireDynamique(dynamique: string, element: string): string {
  const src    = readFileSync(element, 'utf8')
  const tables = TABLES_PARTAGEES.map((nom) => {
    const m = src.match(new RegExp('^var ' + nom + ' = [^\\n]*;$', 'm'))
    if (!m) throw new Error(`déclaration de ${nom} introuvable dans mjs_element.ts`)
    return m[0]
  })
  const aides = AIDES_PARTAGEES.map((nom) => {
    const m = src.match(new RegExp('^µ\\.' + nom + ' = function[^\\n]*\\n(?:.*\\n)*?\\};$', 'm'))
    if (!m) throw new Error(`définition de µ.${nom} introuvable dans mjs_element.ts`)
    return m[0]
  })
  return tables.join('\n') + '\n' + aides.join('\n') + '\n' + readFileSync(dynamique, 'utf8')
}
