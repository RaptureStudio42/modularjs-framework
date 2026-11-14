// attentes d'un test en navigateur : attendre l'ÉTAT que le test lit ensuite, au lieu d'une pause fixe qui fait attendre pour rien
// quand l'état arrive tôt. L'attente remplace une pause sans rien relâcher : elle est bornée par la durée de cette pause (`delai`),
// et sa dernière lecture part au plus tôt à ce délai, comme la lecture qui suivait la pause ; un rendu plus lent que la pause
// d'origine échoue donc toujours, et l'erreur dit l'état attendu et la dernière valeur lue.
// - attendreEtat(lire, message, delai)                  relit `lire` (depuis Node) toutes les 20 ms jusqu'à une valeur vraie et la rend
// - attendrePage(page, condition, arg, message, delai)  la même chose, la condition relue dans la page
// - animationsFinies(page, hote, selecteur, delai, o)   deux images passées (le geste a posé son style, ses transitions sont nées),
//                                                       puis chaque animation à fin de l'élément (sous-arbre et pseudo-éléments
//                                                       compris : transitions, animations CSS, Web Animations) au bout ; une
//                                                       animation sans fin est laissée de côté ; tout tient dans `delai`. Si
//                                                       aucune animation n'a été vue, l'attente échoue, sauf avec
//                                                       `{ sansAnimation: 'acceptee' }`
// La relecture part de Node, pas d'une boucle dans la page : Firefox espace les images d'une page qui ne bouge plus, et une attente
// à chaque image y a traîné plus de 10 s sur un état déjà là.
// Une vérification NÉGATIVE (« rien ne bouge pendant 1 s ») reste une pause, écrite avec sa raison : aucun évènement ne dit qu'une
// chose n'arrivera pas.

import { inspect } from 'node:util'
import { DELAI_ATTENTE } from './attendre.js'

export type ConditionPage = string | ((arg: any) => unknown)

export interface OptionsAnimations {
  // 'acceptee' : l'attente passe aussi quand rien n'a été animé (un geste qui peut ne rien animer)
  sansAnimation?: 'refusee' | 'acceptee'
}

// minuterie et horloge relevées au chargement : un test qui simule les minuteries de Node ne fige pas ses attentes
const minuterie = globalThis.setTimeout
const oubli     = globalThis.clearTimeout
const horloge   = performance.now.bind(performance)
const dormir    = (ms: number) => new Promise<void>((r) => minuterie(r, ms))
const montrer   = (v: unknown) => inspect(v, { depth: 4, breakLength: Infinity, maxStringLength: 400, maxArrayLength: 40 })

export async function attendreEtat<T>(lire: () => T | Promise<T>, message: string, delai: number): Promise<T> {
  const debut = horloge()
  let derniere: unknown
  let levee: unknown
  for (;;) {
    const ecoule = horloge() - debut
    try {
      derniere = await lire()
      levee    = undefined
      if (derniere) return derniere as T
    }
    catch (e) {
      levee = e
    }
    if (ecoule >= delai) break
    await dormir(Math.min(20, delai - ecoule))
  }
  const cause = levee === undefined ? '' : ` — dernière levée de la lecture : ${levee instanceof Error ? levee.message : montrer(levee)}`
  throw new Error(`attente dépassée (${Math.round(delai)} ms) : ${message} — dernière valeur lue : ${montrer(derniere)}${cause}`)
}

export function attendrePage(page: any, condition: ConditionPage, arg: unknown, message: string, delai = DELAI_ATTENTE): Promise<any> {
  return attendreEtat(() => page.evaluate(condition, arg), message, delai)
}

export async function animationsFinies(page: any, hote: string, selecteur: string | null = null, delai = DELAI_ATTENTE, o: OptionsAnimations = {}): Promise<void> {
  const quoi  = `animations finies : ${hote}${selecteur ? ' ' + selecteur : ''}`
  const debut = horloge()
  let garde: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<'depasse'>((ok) => { garde = minuterie(() => ok('depasse'), delai) })
  try {
    const images = page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok('passees')))))
    if(await Promise.race([images, limite]) === 'depasse') throw new Error(`attente dépassée (${Math.round(delai)} ms) : ${quoi} — les deux images d'entrée ne sont pas passées`)
  }
  finally {
    oubli(garde)
  }
  const accepte = o.sansAnimation === 'acceptee'
  let vue       = false
  await attendreEtat(async () => {
    const etat = await page.evaluate(([h, s]: [string, string | null]) => {
      const racine = document.querySelector(h) as any
      const el     = s ? racine?._shadow?.querySelector(s) : racine
      if(!el) return 'absent'
      const finies = el.getAnimations({ subtree: true }).filter((a: Animation) => a.effect?.getComputedTiming().iterations !== Infinity)
      if(!finies.length) return 'aucune'
      return finies.every((a: Animation) => a.playState !== 'running') ? 'finies' : 'en cours'
    }, [hote, selecteur])
    if(etat === 'en cours' || etat === 'finies') vue = true
    if(etat === 'finies') return true
    return etat === 'aucune' && (vue || accepte)
  }, quoi + (accepte ? '' : ' (une animation au moins attendue)'), Math.max(0, delai - (horloge() - debut)))
}
