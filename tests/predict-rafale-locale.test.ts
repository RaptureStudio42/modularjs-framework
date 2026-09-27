// µ.predict (mjs_predict.ts) — une RAFALE de coups locaux (aucun ack entre eux, la file `pending`
// grandit) doit rester réactive à CHAQUE coup, pas seulement au premier : le miroir republie sa clé
// racine par réassignation (jamais une mutation en place, cf. _mjpredictPublier) — un fragment
// réutilisé EN PLACE d'un coup à l'autre romprait cette réassignation (comparaison par référence
// `a === b` dans _mjpredictEq) et gèlerait la réactivité après le 1er coup.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/runtime/mjs_predict.ts', import.meta.url), 'utf8')

// store réactif MINIMAL (Proxy set + Set d'abonnés PAR CLÉ) — même stub que tests/socket-lobby.test.ts :
// prouve qu'une réassignation top-level déclenche un VRAI abonné réactif, pas seulement une relecture.
const subsByStore = new WeakMap<object, Map<string, Set<() => void>>>()
function reactiveState(init: any): any {
  const target: any = { ...init }
  const subs = new Map<string, Set<() => void>>()
  const proxy = new Proxy(target, {
    set(obj, key, value) { obj[key as string] = value; const s = subs.get(key as string); if (s) s.forEach((fn) => fn()); return true },
  })
  subsByStore.set(proxy, subs)
  return proxy
}
function watchKey(store: any, key: string, fn: () => void): void {
  const subs = subsByStore.get(store)!
  let s = subs.get(key)
  if (!s) { s = new Set(); subs.set(key, s) }
  s.add(fn)
}

function makeMu(): any {
  const µ: any = { state: reactiveState }
  new Function('µ', src)(µ)
  return µ
}

function fakeGame(): any {
  const handlers: Record<string, Function[]> = {}
  return {
    state: { moi: { x: 0, y: 0 } },
    move(_name: string, _p: any) { return Promise.resolve() },
    on(evt: string, fn: Function) { (handlers[evt] || (handlers[evt] = [])).push(fn); return () => {} },
  }
}

describe('µ.predict — rafale de coups locaux (file non confirmée)', () => {
  it('chaque coup de la rafale déclenche une réassignation réactive de la clé racine, pas seulement le 1er', () => {
    const µ = makeMu()
    const game = fakeGame()
    const miroir = µ.predict(game, { fields: ['moi'], apply: (f: any, n: string, p: any) => { if (n === 'bouger') f.moi.x += p.dx } })

    let fires = 0
    watchKey(miroir, 'moi', () => { fires++ })

    for (let i = 0; i < 5; i++) { game.move('bouger', { dx: 1 }) }

    assert.equal(miroir.moi.x, 5, 'valeur finale correcte (non-régression)')
    assert.equal(fires, 5, 'les 5 coups doivent CHACUN avoir déclenché une réassignation réactive de .moi — pas seulement le 1er')
  })

  it('le fragment de chaque coup est un objet FRAIS, jamais le même que le précédent (pas de mutation partagée avec le miroir déjà publié)', () => {
    const µ = makeMu()
    const game = fakeGame()
    const miroir = µ.predict(game, { fields: ['moi'], apply: (f: any, n: string, p: any) => { if (n === 'bouger') f.moi.x += p.dx } })

    game.move('bouger', { dx: 1 })
    const apres1 = miroir.moi
    game.move('bouger', { dx: 1 })
    const apres2 = miroir.moi

    assert.notEqual(apres1, apres2, 'chaque republication pose une référence neuve sur le miroir')
    assert.equal(apres1.x, 1, "l'ancienne référence garde SA valeur au moment de la capture (pas de mutation rétroactive)")
    assert.equal(apres2.x, 2)
  })
})
