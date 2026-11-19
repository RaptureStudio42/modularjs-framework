// Une valeur dérivée nettoyée (son composant quitte la page pour de bon) pendant le calcul d'une autre dérivée qui vient de la lire :
// la fin de ce calcul inscrivait le lecteur auprès d'elle, dans le tableau gelé des nœuds que personne ne lit, et levait l'erreur du
// moteur JavaScript (« object is not extensible ») au lieu de rendre la valeur. Une source nettoyée ne prend plus de lecteur : le calcul
// rend sa valeur, la dérivée nettoyée garde la sienne et ne relance plus rien. Le harnais charge le module seul, hors de toute construction.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { poserMessages } from './helpers/messages-stub.js'

const MODULE = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime/mjs_signals.ts')

// un µ de harnais qui porte le module seul ; ses avertissements sont relevés dans `µ.avis`
function noyau(): any {
  const µ: any = { avis: [] as string[] }
  µ.warn = (...args: any[]) => { µ.avis.push(args.map(String).join(' ')) }
  µ._mjs_label = (groupe: string, cle: string) => (RUNTIME_LABELS as any).fr?.[groupe]?.[cle]
  poserMessages(µ)
  new Function('µ', readFileSync(MODULE, 'utf-8'))(µ)
  return µ
}

// lecture et écriture comme le code compilé : la lecture n'est notée que pendant un calcul
const lire = (µ: any, el: any, k: string) => (µ._mjs_sigCur !== null && µ._mjs_sigRead(el, k), el.state[k])

function ecrire(µ: any, el: any, k: string, v: any): void {
  if (el.state[k] === v) return
  el.state[k] = v
  µ._mjs_sigWrite(el, k)
}


describe('signaux — une dérivée nettoyée pendant le calcul qui la lit', () => {
  it('le calcul rend sa valeur sans erreur ; la dérivée nettoyée garde la sienne et ne relance plus le lecteur', () => {
    const µ       = noyau()
    const source  = { state: { a: 2 } }
    const lecteur = { state: { b: 10 } }
    const prix    = µ._mjs_sigDerived(source, '$prix', () => lire(µ, source, 'a') * 3)
    let calculs   = 0
    const total   = µ._mjs_sigDerived(lecteur, '$total', () => {
      calculs++
      const v = µ._mjs_sigGet(prix) + lire(µ, lecteur, 'b')
      // le composant de la source quitte la page pour de bon pendant ce calcul
      if (calculs === 1) µ._mjs_sigDrop(source)
      return v
    })
    assert.equal(µ._mjs_sigGet(total), 16, 'la valeur du premier calcul')
    assert.equal(prix.subs.length, 0, 'la dérivée nettoyée n\'a aucun lecteur')
    ecrire(µ, source, 'a', 5)
    assert.equal(µ._mjs_sigGet(total), 16, 'la source nettoyée ne relance rien')
    assert.equal(calculs, 1)
    ecrire(µ, lecteur, 'b', 20)
    assert.equal(µ._mjs_sigGet(total), 26, 'une source vivante relance le calcul, qui relit la dernière valeur de la dérivée nettoyée')
    assert.equal(calculs, 2)
    assert.deepEqual(µ.avis, [])
  })

  it('même chose quand le lecteur est un reffet', async () => {
    const µ       = noyau()
    const source  = { state: { a: 1 } }
    const erreurs: string[] = []
    // l'exception d'un reffet va au gestionnaire d'erreurs de son propriétaire
    const lecteur = { state: {}, _mjs_catchError: (e: any) => erreurs.push(String(e && e.message)) }
    const double  = µ._mjs_sigDerived(source, '$double', () => lire(µ, source, 'a') * 2)
    const vus: number[] = []
    µ._mjs_sigEffect(lecteur, () => {
      vus.push(µ._mjs_sigGet(double))
      if (vus.length === 1) µ._mjs_sigDrop(source)
    })
    await new Promise((r) => setTimeout(r, 0))
    ecrire(µ, source, 'a', 7)
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(erreurs, [])
    assert.deepEqual(vus, [2], 'un seul passage : la dérivée nettoyée ne relance pas le reffet')
    assert.deepEqual(µ.avis, [])
  })
})
