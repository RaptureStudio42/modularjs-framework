// Régression — µ.optimistic (mjs_optimistic.ts) : base de la file, apply qui lève, apply + after.
//
// Base : la file d'une store gardait sa base de départ pour toujours. Une écriture faite ENTRE deux
// appels, rien en vol (réponse serveur, autre code), était écrasée au suivant, et les clés ajoutées
// entre-temps supprimées. Rien en vol : c'est la store qui fait foi.
// apply qui lève : l'entrée restait dans la file, devant un rejeu non protégé — tous les appels
// suivants sur la store levaient la même erreur, et le compteur des mises à jour en vol (lu par
// *offline) ne redescendait jamais. Même chose pour un `after` qui lève derrière une sœur en vol.
// L'appel rend désormais { ok: false, error }, sans rien publier ni envoyer.
// apply qui rend un nouvel état + after qui mute en place : après le succès, la store revenait à sa
// valeur d'avant — l'ajout optimiste et la valeur du serveur étaient perdus.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OPT_SRC   = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_optimistic.ts'), 'utf-8')

function monter(): any {
  const µ: any = { log() {}, warn() {}, error() {} }
  poserMessages(µ)
  new Function('µ', OPT_SRC)(µ)
  return µ
}

/** Promesse réglée à la main : rend la promesse et ses deux leviers. */
function enAttente() {
  let tenir: (v?: any) => void = () => {}, rompre: (e?: any) => void = () => {}
  const promesse = new Promise((ok, ko) => { tenir = ok; rompre = ko })
  return { promesse, tenir, rompre }
}

describe('µ.optimistic — rien en vol, la store fait foi', function () {
  it('une écriture faite entre deux appels est gardée, ses clés neuves aussi', async function () {
    const µ = monter()
    const store: any = { n: 0 }
    await µ.optimistic(store, { apply: (s: any) => { s.n += 1 }, via: () => Promise.resolve('ok') })
    assert.equal(store.n, 1)
    store.n = 10
    store.items = ['poussé par le serveur']
    const vol = enAttente()
    const p = µ.optimistic(store, { apply: (s: any) => { s.n += 1 }, via: () => vol.promesse })
    assert.equal(store.n, 11, 'le 2e appel repart de la valeur écrite entre-temps')
    assert.deepEqual(store.items, ['poussé par le serveur'], 'la clé ajoutée entre-temps reste')
    vol.tenir('ok')
    assert.equal((await p).ok, true)
    assert.equal(store.n, 11)
    assert.deepEqual(store.items, ['poussé par le serveur'])
  })

  it('après un échec, l\'appel suivant repart lui aussi de la store du moment', async function () {
    const µ = monter()
    const store: any = { n: 0 }
    await µ.optimistic(store, { apply: (s: any) => { s.n += 1 }, via: () => Promise.reject(new Error('refus')) })
    assert.equal(store.n, 0, 'retour en arrière')
    store.n = 7
    await µ.optimistic(store, { apply: (s: any) => { s.n += 1 }, via: () => Promise.resolve() })
    assert.equal(store.n, 8)
  })
})

describe('µ.optimistic — un apply ou un after qui lève n\'empoisonne rien', function () {
  it('apply qui lève : { ok: false, error }, rien d\'envoyé, store saine, compteur à 0', async function () {
    const µ = monter()
    const store: any = { sel: new Set([1]), n: 0 }
    let envois = 0
    let res: any
    let leve = ''
    try {
      res = await µ.optimistic(store, { apply: (s: any) => { s.sel.add(2) }, via: () => { envois++; return Promise.resolve() } })
    }
    catch (e: any) { leve = e.message }
    assert.equal(leve, '', 'µ.optimistic ne lève jamais : il rend { ok: false, error }')
    assert.equal(res.ok, false)
    assert.ok(res.error instanceof Error)
    assert.equal(envois, 0, 'un apply en échec n\'envoie pas la requête')
    assert.equal(µ._mjs_optPending, 0, 'le compteur des mises à jour en vol redescend')
    assert.ok(store.sel instanceof Set && store.sel.has(1), 'la store n\'a pas bougé')
    const res2 = await µ.optimistic(store, { apply: (s: any) => { s.n = 5 }, via: () => Promise.resolve() })
    assert.equal(res2.ok, true, 'l\'appel suivant sur la même store fonctionne')
    assert.equal(store.n, 5)
    assert.equal(µ._mjs_optPending, 0)
  })

  it('after qui lève derrière une sœur encore en vol : la sœur aboutit, la store reste saine', async function () {
    const µ = monter()
    const store: any = { n: 0 }
    const volA = enAttente()
    const rA = µ.optimistic(store, { apply: (s: any) => { s.n += 1 }, via: () => volA.promesse })
    const rB = µ.optimistic(store, {
      apply: (s: any) => { s.n += 1 },
      via: () => Promise.resolve({}),
      after: (s: any, r: any) => { s.n = r.compteur.valeur }
    })
    assert.equal(store.n, 2)
    let resB: any, leveB = ''
    try { resB = await rB } catch (e: any) { leveB = e.message }
    assert.equal(leveB, '', 'la promesse ne rompt jamais')
    assert.equal(resB.ok, false)
    assert.ok(resB.error instanceof TypeError)
    assert.equal(store.n, 1, 'seul l\'effet de A reste affiché')
    volA.tenir('ok')
    let resA: any, leveA = ''
    try { resA = await rA } catch (e: any) { leveA = e.message }
    assert.equal(leveA, '', 'le rejeu de A ne bute plus sur l\'entrée fautive')
    assert.equal(resA.ok, true)
    assert.equal(store.n, 1)
    assert.equal(µ._mjs_optPending, 0)
    await µ.optimistic(store, { apply: (s: any) => { s.n += 10 }, via: () => Promise.resolve() })
    assert.equal(store.n, 11)
  })
})

describe('µ.optimistic — apply qui rend un nouvel état, after qui mute en place', function () {
  it('après le succès, la valeur du serveur est gardée', async function () {
    const µ = monter()
    const store: any = { n: 0 }
    const p = µ.optimistic(store, {
      apply: (s: any) => ({ n: s.n + 1 }),
      via: () => Promise.resolve({ n: 42 }),
      after: (s: any, r: any) => { s.n = r.n }
    })
    assert.equal(store.n, 1, 'valeur optimiste pendant le vol')
    const res = await p
    assert.equal(res.ok, true)
    assert.equal(store.n, 42, 'la valeur du serveur posée par after reste')
  })

  it('after qui rend lui-même un nouvel état : ce nouvel état est publié', async function () {
    const µ = monter()
    const store: any = { n: 0, nom: 'a' }
    await µ.optimistic(store, {
      apply: (s: any) => { s.n += 1 },
      via: () => Promise.resolve({ n: 9 }),
      after: (s: any, r: any) => ({ n: r.n, nom: s.nom })
    })
    assert.deepEqual({ ...store }, { n: 9, nom: 'a' })
  })
})
