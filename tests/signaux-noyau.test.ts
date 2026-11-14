// Noyau des signaux (src/runtime/mjs_signals.ts), le graphe seul, sans navigateur : une boîte ne naît que pour une variable
// lue par une dérivée ou un reffet ; une écriture avance la version et marque les lecteurs sans rien recalculer ; une dérivée
// se relit par versions (losange calculé une fois, branche quittée oubliée, coupe-circuit sur une valeur égale) ; les reffets
// passent en file, en deux temps autour de l'écran, une fois pour des écritures groupées, toujours avec un propriétaire qui
// les nettoie ; un cycle et une boucle sans fin sont arrêtés avec un message en français et en anglais (garde des 10 000
// reprises dans la même rafale). Le harnais le charge seul, hors de toute construction.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { poserMessages } from './helpers/messages-stub.js'

const MODULE = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime/mjs_signals.ts')

const CYCLE_FR = '[ModularJS] Cycle réactif : la dérivée « $total » se lit elle-même, directement ou par d\'autres dérivées ; cette lecture rend undefined. Retirez de son calcul la lecture qui revient à elle.'
const CYCLE_EN = '[ModularJS] Reactive cycle: the derived value "$total" reads itself, directly or through other derived values; this read returns undefined. Remove from its computation the read that leads back to it.'
const BOUCLE_FR = '[ModularJS] Boucle réactive détectée sur <mjs-boucle> : ses reffets ont repris plus de 10 000 fois dans la même rafale de microtâches. Un reffet écrit sans doute une valeur qu\'il lit ($x = $x + 1 dans un µeffect ?). Ses reffets sont suspendus jusqu\'à la fin de la rafale pour garder la page vivante : vérifiez ce que chacun écrit.'
const BOUCLE_EN = '[ModularJS] Reactive loop detected on <mjs-boucle>: its effects ran again more than 10,000 times in the same burst of microtasks. An effect probably writes a value it reads ($x = $x + 1 inside a µeffect?). Its effects are paused until the end of the burst to keep the page alive: check what each one writes.'
const SANS_PROPRIETAIRE = '[ModularJS] µeffect s\'écrit au premier niveau du <script> d\'un composant, ou au premier niveau d\'un module (fichier .civet ou .coffee, fichier d\'un magasin compris) : dans une fonction appelée plus tard, il n\'a pas de propriétaire et ne tourne pas. Écrivez-le au premier niveau, et faites-lui lire ce qui doit le relancer ; pour un reffet lancé à la demande (à l\'ouverture d\'un panneau, par exemple), écrivez-le dans µeffect.root -> …, qui rend la fonction qui l\'arrête.'

// un µ de harnais qui porte le module seul ; ses avertissements sont relevés dans `µ.avis`, dans la langue demandée
function noyau(lang: 'fr' | 'en' = 'fr'): any {
  const µ: any = { avis: [] as string[] }
  µ.warn = (...args: any[]) => { µ.avis.push(args.map(String).join(' ')) }
  µ._mjs_label = (groupe: string, cle: string) => (RUNTIME_LABELS as any)[lang]?.[groupe]?.[cle]
  poserMessages(µ)
  new Function('µ', readFileSync(MODULE, 'utf-8'))(µ)
  return µ
}

// un composant réduit à son état, lu et écrit comme le fait le code compilé : la lecture n'est notée que pendant un calcul,
// l'écriture range la valeur et prévient sa boîte seulement si la valeur change
const composant = (etat: Record<string, any>, tag?: string): any => (tag ? { state: { ...etat }, tagName: tag.toUpperCase() } : { state: { ...etat } })
const lire = (µ: any, el: any, k: string) => (µ._mjs_sigCur !== null && µ._mjs_sigRead(el, k), el.state[k])

function ecrire(µ: any, el: any, k: string, v: any): void {
  if (el.state[k] === v) return
  el.state[k] = v
  µ._mjs_sigWrite(el, k)
}

const microtache = () => Promise.resolve()
const tache = () => new Promise((r) => setTimeout(r, 0))


describe('noyau des signaux — boîtes paresseuses', () => {
  it('aucune boîte avant la première lecture notée, puis une seule : celle de la variable que la dérivée lit', () => {
    const µ = noyau()
    const el = composant({ a: 1, b: 2 })
    const d = µ._mjs_sigDerived(el, '$d', () => lire(µ, el, 'a') * 10)
    ecrire(µ, el, 'a', 3)
    ecrire(µ, el, 'b', 4)
    assert.ok(el._mjs_sigBoxes == null, 'aucune boîte tant que la dérivée n\'a pas été lue')
    assert.equal(µ._mjs_sigGet(d), 30)
    assert.deepEqual(Object.keys(el._mjs_sigBoxes), ['a'])
    ecrire(µ, el, 'b', 5)
    assert.deepEqual(Object.keys(el._mjs_sigBoxes), ['a'], 'une écriture ne crée jamais de boîte')
  })

  it('une lecture hors calcul ne note rien, appel direct compris', () => {
    const µ = noyau()
    const el = composant({ a: 1 })
    assert.ok(µ._mjs_sigCur === null, 'aucun calcul en cours')
    assert.equal(lire(µ, el, 'a'), 1)
    µ._mjs_sigRead(el, 'a')
    assert.ok(el._mjs_sigBoxes == null, 'aucune boîte créée hors calcul')
  })

  it('une variable au nom d\'un membre d\'Object.prototype a sa boîte en propre ; __proto__ n\'en a jamais', () => {
    const µ = noyau()
    const el = composant({ constructor: 1, toString: 2 })
    const d = µ._mjs_sigDerived(el, '$d', () => lire(µ, el, 'constructor') + lire(µ, el, 'toString'))
    ecrire(µ, el, 'constructor', 5)
    assert.equal(µ._mjs_sigGet(d), 7)
    ecrire(µ, el, 'toString', 10)
    assert.equal(µ._mjs_sigGet(d), 15)
    assert.deepEqual(Object.keys(el._mjs_sigBoxes), ['constructor', 'toString'])
    µ._mjs_sigWrite(el, 'hasOwnProperty')
    const p = µ._mjs_sigDerived(el, '$p', () => {
      µ._mjs_sigRead(el, '__proto__')
      return 1
    })
    assert.equal(µ._mjs_sigGet(p), 1)
    assert.ok(Object.getPrototypeOf(el._mjs_sigBoxes) === Object.prototype, 'le prototype des boîtes reste intact')
    assert.ok(!('ver' in Object.prototype.hasOwnProperty) && !('ver' in Object) && !('ver' in Object.prototype), 'aucun membre hérité n\'est pris pour une boîte')
  })

  it('une écriture avance la version et marque les lecteurs sans rien recalculer ; la relecture recalcule une fois', () => {
    const µ = noyau()
    const el = composant({ a: 1 })
    let calculs = 0
    const d = µ._mjs_sigDerived(el, '$d', () => {
      calculs++
      return lire(µ, el, 'a') + 1
    })
    assert.equal(µ._mjs_sigGet(d), 2)
    const boite = el._mjs_sigBoxes.a
    const avant = boite.ver
    ecrire(µ, el, 'a', 5)
    ecrire(µ, el, 'a', 6)
    assert.equal(boite.ver, avant + 2)
    assert.equal(calculs, 1, 'l\'écriture ne recalcule rien')
    assert.equal(µ._mjs_sigGet(d), 7)
    assert.equal(µ._mjs_sigGet(d), 7)
    assert.equal(calculs, 2, 'relue deux fois après les écritures : un seul calcul')
  })

  it('une fonction du composant appelée par la dérivée : ses lectures notées sont des sources', () => {
    const µ = noyau()
    const el = composant({ prix: 10, qte: 2 })
    const montant = () => lire(µ, el, 'prix') * lire(µ, el, 'qte')
    const d = µ._mjs_sigDerived(el, '$total', () => montant() + ' €')
    assert.equal(µ._mjs_sigGet(d), '20 €')
    assert.equal(montant(), 20, 'appelée hors calcul, elle lit l\'état telle quelle')
    assert.deepEqual(Object.keys(el._mjs_sigBoxes), ['prix', 'qte'])
    ecrire(µ, el, 'prix', 12)
    assert.equal(µ._mjs_sigGet(d), '24 €')
  })
})


describe('noyau des signaux — dérivées relues par versions', () => {
  it('losange A → B, A → C, B + C → D : après une écriture de A, D est recalculée une seule fois, B et C aussi', () => {
    const µ = noyau()
    const el = composant({ a: 1 })
    const n = { b: 0, c: 0, d: 0 }
    const b = µ._mjs_sigDerived(el, '$b', () => {
      n.b++
      return lire(µ, el, 'a') * 2
    })
    const c = µ._mjs_sigDerived(el, '$c', () => {
      n.c++
      return lire(µ, el, 'a') + 100
    })
    const d = µ._mjs_sigDerived(el, '$d', () => {
      n.d++
      return µ._mjs_sigGet(b) + µ._mjs_sigGet(c)
    })
    assert.equal(µ._mjs_sigGet(d), 103)
    ecrire(µ, el, 'a', 2)
    assert.equal(µ._mjs_sigGet(d), 106)
    assert.deepEqual(n, { b: 2, c: 2, d: 2 })
    ecrire(µ, el, 'a', 3)
    assert.deepEqual(n, { b: 2, c: 2, d: 2 }, 'rien n\'est refait avant la lecture')
    assert.equal(µ._mjs_sigGet(d), 109)
    assert.deepEqual(n, { b: 3, c: 3, d: 3 })
  })

  it('losange lu par un reffet : il passe une fois par écriture, les deux côtés à jour', async () => {
    const µ = noyau()
    const el = composant({ a: 1 })
    const b = µ._mjs_sigDerived(el, '$b', () => lire(µ, el, 'a') * 2)
    const c = µ._mjs_sigDerived(el, '$c', () => lire(µ, el, 'a') * 3)
    const vus: string[] = []
    µ._mjs_sigEffect(el, () => { vus.push(µ._mjs_sigGet(b) + '/' + µ._mjs_sigGet(c)) })
    await microtache()
    ecrire(µ, el, 'a', 2)
    await microtache()
    assert.deepEqual(vus, ['2/3', '4/6'])
  })

  it('branches : une dérivée qui change de sources selon une condition oublie l\'ancienne', () => {
    const µ = noyau()
    const el = composant({ cond: true, oui: 'o1', non: 'n1' })
    let calculs = 0
    const d = µ._mjs_sigDerived(el, '$choix', () => {
      calculs++
      return lire(µ, el, 'cond') ? lire(µ, el, 'oui') : lire(µ, el, 'non')
    })
    assert.equal(µ._mjs_sigGet(d), 'o1')
    ecrire(µ, el, 'cond', false)
    assert.equal(µ._mjs_sigGet(d), 'n1')
    assert.equal(calculs, 2)
    ecrire(µ, el, 'oui', 'o2')
    assert.equal(µ._mjs_sigGet(d), 'n1')
    assert.equal(calculs, 2, 'la branche quittée n\'est plus une source : aucun calcul')
    assert.equal(el._mjs_sigBoxes.oui.subs.length, 0, 'la boîte de la branche quittée n\'a plus de lecteur')
    ecrire(µ, el, 'non', 'n2')
    assert.equal(µ._mjs_sigGet(d), 'n2')
    assert.equal(calculs, 3)
  })

  it('branche sautée : la dérivée lue par la branche quittée n\'est pas recalculée pour vérifier', () => {
    const µ = noyau()
    const el = composant({ obj: { items: [1, 2] } })
    let tailles = 0
    const taille = µ._mjs_sigDerived(el, '$taille', () => {
      tailles++
      return lire(µ, el, 'obj').items.length
    })
    const len = µ._mjs_sigDerived(el, '$len', () => (lire(µ, el, 'obj') ? µ._mjs_sigGet(taille) : 0))
    assert.equal(µ._mjs_sigGet(len), 2)
    ecrire(µ, el, 'obj', null)
    assert.equal(µ._mjs_sigGet(len), 0)
    assert.equal(tailles, 1, '$taille n\'est pas relue sur un objet nul')
  })

  it('coupe-circuit : une dérivée qui retombe sur la même valeur ne réveille ni ses dérivées ni ses reffets', async () => {
    const µ = noyau()
    const el = composant({ n: 2 })
    const k = { parite: 0, texte: 0, reffet: 0 }
    const parite = µ._mjs_sigDerived(el, '$parite', () => {
      k.parite++
      return lire(µ, el, 'n') % 2
    })
    const texte = µ._mjs_sigDerived(el, '$texte', () => {
      k.texte++
      return µ._mjs_sigGet(parite) ? 'impair' : 'pair'
    })
    µ._mjs_sigEffect(el, () => {
      k.reffet++
      µ._mjs_sigGet(parite)
    })
    assert.equal(µ._mjs_sigGet(texte), 'pair')
    await microtache()
    assert.deepEqual(k, { parite: 1, texte: 1, reffet: 1 })
    ecrire(µ, el, 'n', 4)
    assert.equal(µ._mjs_sigGet(texte), 'pair')
    await microtache()
    assert.deepEqual(k, { parite: 2, texte: 1, reffet: 1 }, 'seule $parite est refaite')
    ecrire(µ, el, 'n', 5)
    assert.equal(µ._mjs_sigGet(texte), 'impair')
    await microtache()
    assert.deepEqual(k, { parite: 3, texte: 2, reffet: 2 })
  })

  it('coupe-circuit au sens d\'Object.is : NaN retombé sur NaN est la même valeur', () => {
    const µ = noyau()
    const el = composant({ s: 'x' })
    let lecteurs = 0
    const nombre = µ._mjs_sigDerived(el, '$nombre', () => Number(lire(µ, el, 's')))
    const lecteur = µ._mjs_sigDerived(el, '$lecteur', () => {
      lecteurs++
      return String(µ._mjs_sigGet(nombre))
    })
    assert.equal(µ._mjs_sigGet(lecteur), 'NaN')
    ecrire(µ, el, 's', 'y')
    assert.equal(µ._mjs_sigGet(lecteur), 'NaN')
    assert.equal(lecteurs, 1)
  })
})


describe('noyau des signaux — cycle', () => {
  it('une dérivée qui se lit elle-même rend undefined, avec un message clair au vouvoiement', () => {
    const µ = noyau('fr')
    const el = composant({ a: 1 })
    const total: any = µ._mjs_sigDerived(el, '$total', () => lire(µ, el, 'a') + (µ._mjs_sigGet(total) ?? 0))
    assert.equal(µ._mjs_sigGet(total), 1)
    assert.deepEqual(µ.avis, [CYCLE_FR])
  })

  it('le même message en anglais, par la table des messages du framework', () => {
    const µ = noyau('en')
    const el = composant({ a: 1 })
    const total: any = µ._mjs_sigDerived(el, '$total', () => lire(µ, el, 'a') + (µ._mjs_sigGet(total) ?? 0))
    assert.equal(µ._mjs_sigGet(total), 1)
    assert.deepEqual(µ.avis, [CYCLE_EN])
  })

  it('cycle à travers une autre dérivée : arrêté et signalé, sans boucle sans fin', () => {
    const µ = noyau('fr')
    const el = composant({ a: 1 })
    const refs: any = {}
    refs.total = µ._mjs_sigDerived(el, '$total', () => lire(µ, el, 'a') + (µ._mjs_sigGet(refs.autre) ?? 0))
    refs.autre = µ._mjs_sigDerived(el, '$autre', () => (µ._mjs_sigGet(refs.total) ?? 10) * 2)
    assert.equal(µ._mjs_sigGet(refs.total), 21)
    assert.deepEqual(µ.avis, [CYCLE_FR])
    ecrire(µ, el, 'a', 2)
    assert.equal(µ._mjs_sigGet(refs.total), 22)
  })
})


describe('noyau des signaux — reffets en file, en deux temps', () => {
  it('avant l\'écran, puis l\'écran, puis après : le reffet d\'avant lit l\'écran d\'avant', async () => {
    const µ = noyau()
    const el = composant({ n: 1 })
    const ecran = { texte: '' }
    const journal: string[] = []
    µ._mjs_sigScreen = () => {
      ecran.texte = String(el.state.n)
      journal.push('écran ' + ecran.texte)
    }
    µ._mjs_sigEffect(el, () => { journal.push('après ' + lire(µ, el, 'n') + ', écran « ' + ecran.texte + ' »') })
    µ._mjs_sigEffect(el, () => { journal.push('avant ' + lire(µ, el, 'n') + ', écran « ' + ecran.texte + ' »') }, true)
    await microtache()
    assert.deepEqual(journal, ['avant 1, écran «  »', 'écran 1', 'après 1, écran « 1 »'])
    journal.length = 0
    ecrire(µ, el, 'n', 2)
    await microtache()
    assert.deepEqual(journal, ['avant 2, écran « 1 »', 'écran 2', 'après 2, écran « 2 »'])
  })

  it('voie synchrone : _mjs_sigBefore passe tout de suite les reffets d\'avant, ceux d\'après attendent la file', async () => {
    const µ = noyau()
    const el = composant({ n: 1 })
    const journal: string[] = []
    µ._mjs_sigEffect(el, () => { journal.push('après ' + lire(µ, el, 'n')) })
    µ._mjs_sigEffect(el, () => { journal.push('avant ' + lire(µ, el, 'n')) }, true)
    await microtache()
    journal.length = 0
    ecrire(µ, el, 'n', 2)
    µ._mjs_sigBefore()
    journal.push('liaisons')
    assert.deepEqual(journal, ['avant 2', 'liaisons'])
    await microtache()
    assert.deepEqual(journal, ['avant 2', 'liaisons', 'après 2'])
  })

  it('dans un même temps, les reffets passent dans l\'ordre de leur création', async () => {
    const µ = noyau()
    const el = composant({ a: 1, b: 1 })
    const journal: string[] = []
    µ._mjs_sigEffect(el, () => { journal.push('premier ' + lire(µ, el, 'b')) })
    µ._mjs_sigEffect(el, () => { journal.push('second ' + lire(µ, el, 'a')) })
    await microtache()
    journal.length = 0
    ecrire(µ, el, 'a', 2)
    ecrire(µ, el, 'b', 2)
    await microtache()
    assert.deepEqual(journal, ['premier 2', 'second 2'])
  })

  it('écritures groupées : trois écritures de suite, une seule relecture de la dérivée et un seul passage du reffet', async () => {
    const µ = noyau()
    const el = composant({ a: 1, b: 1 })
    const k = { somme: 0, reffet: 0 }
    const somme = µ._mjs_sigDerived(el, '$somme', () => {
      k.somme++
      return lire(µ, el, 'a') + lire(µ, el, 'b')
    })
    const vus: number[] = []
    µ._mjs_sigEffect(el, () => {
      k.reffet++
      vus.push(µ._mjs_sigGet(somme))
    })
    await microtache()
    ecrire(µ, el, 'a', 2)
    ecrire(µ, el, 'b', 3)
    ecrire(µ, el, 'a', 4)
    await microtache()
    assert.deepEqual(vus, [2, 7])
    assert.deepEqual(k, { somme: 2, reffet: 2 })
  })

  it('le dernier nettoyage rendu passe avant le passage suivant', async () => {
    const µ = noyau()
    const el = composant({ n: 1 })
    const journal: string[] = []
    µ._mjs_sigEffect(el, () => {
      const n = lire(µ, el, 'n')
      journal.push('passage ' + n)
      return () => journal.push('nettoyage ' + n)
    })
    await microtache()
    ecrire(µ, el, 'n', 2)
    await microtache()
    assert.deepEqual(journal, ['passage 1', 'nettoyage 1', 'passage 2'])
  })

  it('un reffet qui écrit une variable qu\'il lit repart sur cette écriture, tant que la valeur change', async () => {
    const µ = noyau()
    const el = composant({ n: 0 })
    let passages = 0
    µ._mjs_sigEffect(el, () => {
      passages++
      const n = lire(µ, el, 'n')
      if (n < 3) ecrire(µ, el, 'n', n + 1)
    })
    await microtache()
    assert.equal(el.state.n, 3)
    assert.equal(passages, 4)
  })
})


describe('noyau des signaux — propriétaires', () => {
  it('propriétaire nettoyé : ses reffets ne jouent plus, leur nettoyage passe une fois, ses boîtes se libèrent', async () => {
    const µ = noyau()
    const magasin = composant({ y: 1 })
    const el = composant({ x: 1 })
    const journal: string[] = []
    µ._mjs_sigEffect(el, () => {
      journal.push('reffet ' + lire(µ, el, 'x') + ' ' + lire(µ, magasin, 'y'))
      return () => journal.push('nettoyage')
    })
    const d = µ._mjs_sigDerived(el, '$d', () => lire(µ, magasin, 'y') * 2)
    assert.equal(µ._mjs_sigGet(d), 2)
    await microtache()
    assert.deepEqual(journal, ['reffet 1 1'])
    assert.equal(magasin._mjs_sigBoxes.y.subs.length, 2)
    µ._mjs_sigDispose(el)
    assert.deepEqual(journal, ['reffet 1 1', 'nettoyage'])
    ecrire(µ, magasin, 'y', 2)
    ecrire(µ, el, 'x', 2)
    await microtache()
    assert.deepEqual(journal, ['reffet 1 1', 'nettoyage'], 'aucun passage après le nettoyage')
    assert.equal(magasin._mjs_sigBoxes.y.subs.length, 0, 'la boîte du magasin ne tient plus rien du composant')
    assert.equal(el._mjs_sigBoxes, false, 'les boîtes du composant sont libérées')
    µ._mjs_sigDispose(el)
    assert.deepEqual(journal, ['reffet 1 1', 'nettoyage'], 'un second nettoyage ne rejoue rien')
    assert.ok(µ._mjs_sigEffect(el, () => journal.push('tardif')) === null, 'un propriétaire nettoyé ne reçoit plus de reffet')
    await microtache()
    assert.deepEqual(journal, ['reffet 1 1', 'nettoyage'])
  })

  it('un reffet marqué puis nettoyé avant la passe de la file ne joue pas', async () => {
    const µ = noyau()
    const el = composant({ x: 1 })
    let passages = 0
    µ._mjs_sigEffect(el, () => {
      passages++
      lire(µ, el, 'x')
    })
    await microtache()
    ecrire(µ, el, 'x', 2)
    µ._mjs_sigDispose(el)
    await microtache()
    assert.equal(passages, 1)
  })

  it('propriétaire nettoyé pendant le passage de son reffet : ce que le reffet vient de rendre joue aussitôt', async () => {
    const µ = noyau()
    const el = composant({ x: 1 })
    const journal: string[] = []
    µ._mjs_sigEffect(el, () => {
      journal.push('passage ' + lire(µ, el, 'x'))
      µ._mjs_sigDispose(el)
      return () => journal.push('nettoyage')
    })
    await microtache()
    ecrire(µ, el, 'x', 2)
    await microtache()
    assert.deepEqual(journal, ['passage 1', 'nettoyage'])
    assert.equal(el._mjs_sigBoxes, false)
  })

  it('aucun reffet sans propriétaire : refusé avec l\'avertissement d\'aujourd\'hui ; une racine explicite en est un', async () => {
    const µ = noyau()
    assert.ok(µ._mjs_sigEffect(null, () => {}) === null, 'reffet sans propriétaire refusé')
    assert.deepEqual(µ.avis, [SANS_PROPRIETAIRE])
    const el = composant({ x: 1 })
    const k = { passages: 0, nettoyages: 0 }
    const fin = µ._mjs_sigRoot(() => {
      µ._mjs_sigEffect(null, () => {
        k.passages++
        lire(µ, el, 'x')
        return () => { k.nettoyages++ }
      })
    })
    assert.ok(µ._mjs_sigOwner === null, 'hors de la racine, plus de propriétaire courant')
    await microtache()
    ecrire(µ, el, 'x', 2)
    await microtache()
    assert.deepEqual(k, { passages: 2, nettoyages: 1 })
    fin()
    assert.deepEqual(k, { passages: 2, nettoyages: 2 })
    ecrire(µ, el, 'x', 3)
    await microtache()
    assert.deepEqual(k, { passages: 2, nettoyages: 2 }, 'la racine finie, son reffet ne joue plus')
    assert.equal(el._mjs_sigBoxes.x.subs.length, 0)
    assert.equal(µ.avis.length, 1)
  })
})


describe('noyau des signaux — garde des 10 000 reprises', () => {
  it('un reffet qui écrit sans fin ce qu\'il lit s\'arrête au bout de 10 000 passages dans la rafale, avec un avertissement ; il reprend à la rafale suivante', async () => {
    const µ = noyau('fr')
    const el = composant({ x: 0 }, 'mjs-boucle')
    const autre = composant({ y: 0 })
    const k = { boucle: 0, autre: 0 }
    µ._mjs_sigEffect(el, () => {
      k.boucle++
      ecrire(µ, el, 'x', lire(µ, el, 'x') + 1)
    })
    µ._mjs_sigEffect(autre, () => {
      k.autre++
      lire(µ, autre, 'y')
    })
    await microtache()
    assert.equal(k.boucle, 10000)
    assert.equal(el.state.x, 10000)
    assert.deepEqual(µ.avis, [BOUCLE_FR])
    ecrire(µ, autre, 'y', 1)
    ecrire(µ, el, 'x', -1)
    await microtache()
    assert.equal(k.autre, 2, 'un autre propriétaire n\'est pas suspendu')
    assert.equal(k.boucle, 10000, 'suspendu jusqu\'à la fin de la rafale')
    await tache()
    ecrire(µ, el, 'x', 0)
    await microtache()
    assert.equal(k.boucle, 20000, 'rafale suivante : il reprend, et la garde l\'arrête de nouveau')
    assert.deepEqual(µ.avis, [BOUCLE_FR, BOUCLE_FR])
  })

  it('le même avertissement en anglais, par la table des messages du framework', async () => {
    const µ = noyau('en')
    const el = composant({ x: 0 }, 'mjs-boucle')
    µ._mjs_sigEffect(el, () => { ecrire(µ, el, 'x', lire(µ, el, 'x') + 1) })
    await microtache()
    assert.deepEqual(µ.avis, [BOUCLE_EN])
  })
})


describe('noyau des signaux — exceptions', () => {
  it('une dérivée qui lève : l\'exception sort à chaque lecture, sans recalcul tant qu\'aucune source ne change', () => {
    const µ = noyau()
    const el = composant({ v: -1 })
    let calculs = 0
    const racine = µ._mjs_sigDerived(el, '$racine', () => {
      calculs++
      const v = lire(µ, el, 'v')
      if (v < 0) throw new RangeError('négatif')
      return Math.sqrt(v)
    })
    const texte = µ._mjs_sigDerived(el, '$texte', () => {
      try {
        return 'racine ' + µ._mjs_sigGet(racine)
      }
      catch {
        return 'erreur'
      }
    })
    assert.throws(() => µ._mjs_sigGet(racine), RangeError)
    assert.throws(() => µ._mjs_sigGet(racine), RangeError)
    assert.equal(µ._mjs_sigGet(texte), 'erreur')
    assert.equal(calculs, 1)
    ecrire(µ, el, 'v', 9)
    assert.equal(µ._mjs_sigGet(texte), 'racine 3', 'le lecteur qui avait attrapé l\'exception repart avec la source')
    assert.equal(µ._mjs_sigGet(racine), 3)
    assert.equal(calculs, 2)
  })

  it('un reffet qui lève : le gestionnaire d\'erreurs de son propriétaire la reçoit, les autres reffets passent', async () => {
    const µ = noyau()
    const recues: string[] = []
    const el = composant({ n: 1 })
    el._mjs_catchError = (e: Error) => { recues.push(e.message) }
    let autres = 0
    µ._mjs_sigEffect(el, () => {
      if (lire(µ, el, 'n') > 1) throw new Error('casse ' + el.state.n)
    })
    µ._mjs_sigEffect(el, () => {
      autres++
      lire(µ, el, 'n')
    })
    await microtache()
    ecrire(µ, el, 'n', 2)
    await microtache()
    assert.deepEqual(recues, ['casse 2'])
    assert.equal(autres, 2)
    ecrire(µ, el, 'n', 3)
    await microtache()
    assert.deepEqual(recues, ['casse 2', 'casse 3'], 'le reffet en erreur garde ses sources')
  })
})


describe('noyau des signaux — la place de l\'attente', () => {
  it('chaque nœud porte déjà pending, error et abort, neutres : la place de l\'attente, branchée plus tard', () => {
    const µ = noyau()
    const el = composant({ a: 1 })
    const d = µ._mjs_sigDerived(el, '$d', () => lire(µ, el, 'a'))
    const e = µ._mjs_sigEffect(el, () => {})
    for (const n of [d, e]) {
      assert.equal(n.pending, false)
      assert.ok(n.error === undefined, 'aucune erreur')
      assert.ok(n.abort === null, 'aucune annulation')
    }
  })
})
