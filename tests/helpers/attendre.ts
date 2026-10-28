// attentes des tests : attendre un ÉTAT, jamais une durée. Une pause fixe (« 60 ms suffisent ») devient trop courte
// dès que la machine est chargée (plusieurs suites en parallèle, un navigateur lent à démarrer) et le test rate au
// hasard, vert quand on le rejoue seul ; une porte qui attend l'état voulu ne rate que si cet état n'arrive jamais,
// et dit lequel.
// - attendre(lire, message)                 relit `lire` jusqu'à une valeur vraie et la rend ; une lecture qui lève compte
//                                          pour « pas encore » (le composant n'est pas monté) ; au délai, l'erreur dit
//                                          l'état attendu (message, ou fonction relue au délai), la dernière valeur lue
//                                          et la dernière levée
// - attendreEgal(lire, attendu, message)    relit jusqu'à l'égalité profonde stricte ; au délai, l'échec est celui
//                                          d'`assert.deepStrictEqual`, différence affichée
// - etape(nom, travail, delai)              une étape d'un `before` bornée par son propre délai et nommée dans l'erreur :
//                                          le hook est borné par ses attentes réelles, pas par un chiffre global
// Le délai par défaut est généreux : il ne coûte rien quand l'état arrive, il ne sert qu'à l'échec. Une assertion
// NÉGATIVE (« rien ne bouge pendant 100 ms ») reste une pause : elle ne peut pas rater parce que la machine est lente.
// Minuterie et horloge relevées au chargement : un test qui simule les minuteries de Node ne fige pas ses attentes.

import assert from 'node:assert/strict'
import { inspect, isDeepStrictEqual } from 'node:util'

const minuterie = globalThis.setTimeout
const oubli     = globalThis.clearTimeout
const horloge   = performance.now.bind(performance)

export const DELAI_ATTENTE = 15000

export interface OptionsAttente {
  // l'état attendu, en clair : repris dans l'erreur au délai (une fonction : relue au délai, avec l'état du moment)
  message?: string | (() => string)
  // délai total, en millisecondes
  delai?: number
  // intervalle entre deux lectures, en millisecondes
  pas?: number
}

const dormir  = (ms: number) => new Promise<void>((r) => minuterie(r, ms))
const montrer = (v: unknown) => inspect(v, { depth: 4, breakLength: Infinity, maxStringLength: 400, maxArrayLength: 40 })

export async function attendre<T>(lire: () => T | Promise<T>, options: OptionsAttente | string | (() => string) = {}): Promise<T> {
  const o     = typeof options === 'object' ? options : { message: options }
  const delai = o.delai ?? DELAI_ATTENTE
  const pas   = o.pas ?? 10
  const debut = horloge()
  let derniere: unknown
  let levee: unknown
  for (;;) {
    try {
      derniere = await lire()
      levee    = undefined
      if (derniere) return derniere as T
    }
    catch (e) {
      levee = e
    }
    if (horloge() - debut >= delai) break
    await dormir(pas)
  }
  const cause = levee === undefined ? '' : ` — dernière levée de la lecture : ${levee instanceof Error ? levee.message : montrer(levee)}`
  const quoi  = typeof o.message === 'function' ? o.message() : o.message ?? 'condition jamais vraie'
  throw new Error(`attente dépassée (${delai} ms) : ${quoi} — dernière valeur lue : ${montrer(derniere)}${cause}`)
}

export async function attendreEgal<T>(lire: () => T | Promise<T>, attendu: T, message = 'valeur attendue', delai = DELAI_ATTENTE): Promise<void> {
  let derniere: unknown
  let lue = false
  try {
    await attendre(async () => {
      derniere = await lire()
      lue      = true
      return isDeepStrictEqual(derniere, attendu)
    }, { message, delai })
  }
  catch (e) {
    if (!lue) throw e
    assert.deepStrictEqual(derniere, attendu, `${message} (attendue pendant ${delai} ms)`)
    throw e
  }
}

export async function etape<T>(nom: string, travail: Promise<T> | (() => Promise<T>), delai = DELAI_ATTENTE * 4): Promise<T> {
  let garde: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<never>((_, refuse) => {
    garde = minuterie(() => refuse(new Error(`étape « ${nom} » non terminée après ${delai} ms`)), delai)
  })
  try {
    return await Promise.race([typeof travail === 'function' ? travail() : travail, limite])
  }
  finally {
    oubli(garde)
  }
}
