// flux clusterisés (streams.ts) — deux producteurs sur deux instances, propagation différée :
// aucune modification ne doit se perdre et les deux instances doivent converger vers le même état,
// même quand une production LOCALE obtient un seq plus grand qu'un delta distant pas encore arrivé.
import assert from 'node:assert/strict'
import { createStreamsEngine } from '../src/mjs-ws/streams.js'
import type { MjsWsClient } from '../src/mjs-ws/core.js'
import type { MjsWsStreamsCluster } from '../src/mjs-ws/streams.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function fakeClient(id: string): MjsWsClient {
  return { id, identity: undefined, latency: null, meta: {} as any, send() {}, close() {} }
}

describe('MJS-WS — streams.ts, convergence multi-instances sous cluster', () => {
  it('un delta distant en retard n\'est plus jamais perdu — les deux instances convergent vers le même état', async () => {
    // compteur PARTAGÉ (simule Redis INCR) — un SEUL numéroteur pour les deux instances
    let nextSeq = 0
    const allocateSeq = async (_name: string) => ++nextSeq
    // publications INTERCEPTÉES plutôt que livrées tout de suite — simule un délai de propagation
    // réseau normal (pas une panne), même esprit que le scénario du constat
    const inFlight: Array<{ seq: number; p: any }> = []
    const clusterA: MjsWsStreamsCluster = { allocateSeq, publish: (_n, seq, p) => inFlight.push({ seq, p }) }
    const clusterB: MjsWsStreamsCluster = { allocateSeq, publish: (_n, seq, p) => inFlight.push({ seq, p }) }
    const engineA = createStreamsEngine(() => {}, () => {}, clusterA)
    const engineB = createStreamsEngine(() => {}, () => {}, clusterB)
    const hA = engineA.stream('s1')
    const hB = engineB.stream('s1')

    // B écrit EN PREMIER (obtient seq=1) — sa publication reste EN VOL, PAS encore livrée à A
    hB.add('fromB', 'B')
    await tick(20)

    // A écrit ENSUITE (obtient seq=2, le compteur partagé est déjà à 1) — publication ELLE AUSSI
    // en vol pour B, mais SURTOUT : A n'a pas encore vu le delta seq=1 de B
    hA.add('fromA', 'A')
    await tick(20)

    // le delta de B (seq=1) arrive ENFIN chez A — délai de propagation normal, pas une panne
    const fromB = inFlight.find(m => m.seq === 1)!
    engineA.receiveRemote('s1', fromB.seq, fromB.p)
    // le delta de A (seq=2) arrive chez B
    const fromA = inFlight.find(m => m.seq === 2)!
    engineB.receiveRemote('s1', fromA.seq, fromA.p)

    assert.deepEqual(hA.snapshot(), { fromA: 'A', fromB: 'B' }, 'A : aucune modification perdue — le delta distant seq=1, arrivé après, est bien appliqué')
    assert.deepEqual(hB.snapshot(), { fromA: 'A', fromB: 'B' }, 'B : aucune modification perdue')
    assert.deepEqual(hA.snapshot(), hB.snapshot(), 'les deux instances convergent vers le même état')
  })

  it('production locale strictement séquentielle (jamais de trou) : comportement inchangé, seq gapless dans l\'ordre de production', async () => {
    let nextSeq = 0
    const allocateSeq = async (_name: string) => ++nextSeq
    const delivered: Array<{ name: string; seq: number; p: any }> = []
    const cluster: MjsWsStreamsCluster = { allocateSeq, publish: (name, seq, p) => delivered.push({ name, seq, p }) }
    const sent: any[] = []
    const engine = createStreamsEngine((_c, f) => sent.push(f), () => {}, cluster)
    const client = fakeClient('c1')
    engine.handleSubStream(client, 's1')   // flux pas encore déclaré → reset vide, sans conséquence ici
    const h = engine.stream('s1')

    h.add('a', 1); await tick(10)
    h.update('a', { extra: true }); await tick(10)
    h.remove('a'); await tick(10)

    assert.deepEqual(h.snapshot(), {}, 'toutes les mutations appliquées, dans l\'ordre — rien ne bloque en l\'absence de trou')
    assert.deepEqual(delivered.map(d => d.seq), [1, 2, 3], 'seq publiés au cluster strictement croissants, dans l\'ordre de production')
  })
})
