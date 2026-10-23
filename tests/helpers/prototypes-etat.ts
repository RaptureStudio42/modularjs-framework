// relevé des prototypes que tous les tests d'un processus se partagent : happy-dom bâtit toutes ses fenêtres sur les mêmes classes (Node, Element,
// HTMLElement, les HTML*Element, CSSStyleDeclaration, l'objet `CSS`…), donc sur les mêmes prototypes ; un test qui y remplace une méthode et ne la remet
// pas tout à fait (propriété propre en plus, descripteur changé) fausse les fichiers suivants, selon l'ordre où mocha les joue
// `releverPrototypes` note les propriétés propres de chacun de ces prototypes avec leurs descripteurs ; `ecartsPrototypes` dit ce qui a changé depuis, un écart par ligne
// ceux de JavaScript ne sont pas relevés : des bibliothèques y posent leurs aides au premier chargement (le compilateur de sass ajoute des `call$N` à
// `Function.prototype`), ce n'est pas la fuite d'un test

import { Window } from 'happy-dom'

type Propres = Map<string | symbol, PropertyDescriptor>
export type Releve = Array<{ nom: string, objet: object, propres: Propres }>

const CHAMPS = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'] as const

const estObjet = (v: any) => v !== null && (typeof v === 'object' || typeof v === 'function')
const dire     = (cle: string | symbol) => typeof cle === 'symbol' ? cle.toString() : cle

// les propriétés propres d'un objet, descripteurs compris
function propres(objet: object): Propres {
  const lues: Propres = new Map()
  for (const cle of Reflect.ownKeys(objet)) lues.set(cle, Object.getOwnPropertyDescriptor(objet, cle) as PropertyDescriptor)
  return lues
}

// le nom d'un prototype est celui de sa classe (`Element.prototype`) ; sans classe, l'endroit d'où la fenêtre l'a fait atteindre
function classe(proto: object) {
  const d = Object.getOwnPropertyDescriptor(proto, 'constructor')
  return typeof d?.value === 'function' && d.value.name ? d.value.name + '.prototype' : ''
}

// tous les prototypes qu'atteint une fenêtre neuve : celui de chaque classe qu'elle expose, celui de chaque objet qu'elle porte (`CSS`, `navigator`…),
// et leurs ancêtres (`EventTarget`, tout au bout de la chaîne d'un nœud, n'est la valeur d'aucune globale)
export function releverPrototypes(): Releve {
  const fenetre: any   = new Window({ url: 'http://localhost/' })
  const vus            = new Set<object>()
  const comptes        = new Map<string, number>()
  const releve: Releve = []
  const noter = (depart: string, proto: object) => {
    if (vus.has(proto)) return
    vus.add(proto)
    const base = classe(proto) || depart
    const rang = (comptes.get(base) || 0) + 1
    comptes.set(base, rang)
    releve.push({ nom: rang > 1 ? `${base} (${rang})` : base, objet: proto, propres: propres(proto) })
  }
  const chaine = (depart: string, proto: any) => {
    for (let o = proto; estObjet(o) && o !== Object.prototype; o = Object.getPrototypeOf(o)) noter(depart, o)
  }
  for (const cle of Object.getOwnPropertyNames(fenetre).sort()) {
    const descripteur = Object.getOwnPropertyDescriptor(fenetre, cle) as PropertyDescriptor
    let valeur: any
    try { valeur = 'value' in descripteur ? descripteur.value : fenetre[cle] }
    catch { continue }
    if (typeof valeur === 'function' && estObjet(valeur.prototype)) chaine(`${cle}.prototype`, valeur.prototype)
    else if (typeof valeur === 'object' && valeur !== null && valeur !== fenetre) chaine(`prototype de window.${cle}`, Object.getPrototypeOf(valeur))
  }
  chaine('prototype de window', Object.getPrototypeOf(fenetre))
  fenetre.close?.()
  return releve
}

// ce qui diffère du relevé : propriété propre ajoutée, retirée, ou descripteur qui n'est plus le même
export function ecartsPrototypes(avant: Releve): string[] {
  const ecarts: string[] = []
  for (const { nom, objet, propres: anciennes } of avant) {
    const actuelles = propres(objet)
    for (const [cle, d] of actuelles) {
      const ancien = anciennes.get(cle)
      if (!ancien) { ecarts.push(`${nom}.${dire(cle)} : propriété propre ajoutée`); continue }
      const changes = CHAMPS.filter((champ) => !Object.is((d as any)[champ], (ancien as any)[champ]))
      if (changes.length) ecarts.push(`${nom}.${dire(cle)} : descripteur changé (${changes.join(', ')})`)
    }
    for (const cle of anciennes.keys()) if (!actuelles.has(cle)) ecarts.push(`${nom}.${dire(cle)} : propriété propre retirée`)
  }
  return ecarts
}
