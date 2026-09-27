// schema.ts — la table client→horodatage du throttle de désaccord schéma doit être purgée à la
// déconnexion (WeakMap), pas une Map forte qui grossit avec le nombre CUMULÉ de clients ayant un
// jour déclenché une erreur throttlée, jamais avec le nombre de connexions ACTIVES.
import assert from 'node:assert/strict'
import { createSchemaEngine, resolveSchemaOptions } from '../src/mjs-ws/schema.js'
import type { MjsWsClient } from '../src/mjs-ws/core.js'

function fakeClient(id: string): MjsWsClient {
  return { id, identity: undefined, latency: null, meta: {} as any, send() {}, close() {} }
}

// capture la 1re WeakMap construite par `factory` — instrumente globalThis.WeakMap le temps de
// l'appel (même principe qu'instrumenter Map pour capturer une Map interne) : preuve STRUCTURELLE
// que le moteur retient désormais ses clients dans une table faiblement référencée, pas une Map forte.
function captureFirstWeakMap<T>(factory: () => T): { result: T; map: WeakMap<any, any> | null } {
  const RealWeakMap = globalThis.WeakMap
  let captured: WeakMap<any, any> | null = null
  ;(globalThis as any).WeakMap = class extends RealWeakMap {
    constructor(...args: any[]) { super(...(args as [])); if (!captured) captured = this as any }
  }
  try { return { result: factory(), map: captured } }
  finally { globalThis.WeakMap = RealWeakMap }
}

describe('MJS-WS — schema.ts, table du throttle purgée (WeakMap, pas Map forte)', () => {
  it('createSchemaEngine construit une WeakMap pour lastErrorAt — pas une Map qui grossit sans borne', () => {
    const stats: any = { messages: { binaireIgnorees: 0, texteRejete: 0 } }
    const sent: any[] = []
    const resolved = resolveSchemaOptions({ codec: 'binary' })
    const { result: engine, map } = captureFirstWeakMap(() => createSchemaEngine(resolved, (_c, f) => sent.push(f), () => {}, stats))
    assert.ok(map, 'le moteur crée bien une WeakMap (capturée par le constructeur global instrumenté) — pas une Map forte')

    // fonctionnel : le throttle marche TOUJOURS exactement pareil pour un client donné — 1 µ:error
    // envoyé par fenêtre (1 s), même si texteRejete (stats.ts) compte, LUI, chaque rejet
    const c = fakeClient('c1')
    assert.equal(engine.rejectIfStrictText(c, 'chat:sansschema'), true)
    assert.equal(engine.rejectIfStrictText(c, 'chat:sansschema'), true)
    assert.equal(stats.messages.texteRejete, 2, 'les DEUX rejets sont comptés (stats.ts)')
    assert.equal(sent.length, 1, 'mais un SEUL µ:error envoyé — throttlé dans la même seconde, comportement inchangé')
  })
})
