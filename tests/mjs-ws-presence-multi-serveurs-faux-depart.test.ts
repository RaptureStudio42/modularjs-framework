// rooms.ts — présence multi-serveurs : join/leave ne doivent partir qu'aux transitions 0↔1 de la
// présence FUSIONNÉE d'une identité (local + tous les process distants), jamais à chaque source
// individuelle — sinon un départ sur UN process publie un faux « parti » alors que l'identité reste
// présente ailleurs (autre process, ou même localement).
import assert from 'node:assert/strict'
import { createRoomsEngine } from '../src/mjs-ws/rooms.js'
import type { MjsWsClient } from '../src/mjs-ws/core.js'

function fakeClient(id: string): MjsWsClient {
  return { id, identity: undefined, latency: null, meta: {} as any, send() {}, close() {} }
}

describe('MJS-WS — rooms.ts, présence multi-serveurs : transitions 0↔1 seulement', () => {
  it('présence GLOBALE : alice présente via p1 ET p2 — p1 part → aucun faux départ, la présence fusionnée la garde', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    engine.applyRemotePresence(undefined, 'p1', 'join', 'alice', {})
    engine.applyRemotePresence(undefined, 'p2', 'join', 'alice', {})   // alice présente via DEUX process distants

    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, undefined)
    sent.length = 0

    engine.applyRemotePresence(undefined, 'p1', 'leave', 'alice')   // p1 part — p2 reste
    const leaveFrames = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames.length, 0, 'aucun delta leave(alice) — elle reste présente ailleurs (p2)')
    const stillThere = engine.presence(undefined).some(p => p.id === 'alice')
    assert.equal(stillThere, true, 'la présence fusionnée contient toujours alice')

    engine.applyRemotePresence(undefined, 'p2', 'leave', 'alice')   // p2 part aussi — plus AUCUNE source
    const leaveFrames2 = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames2.length, 1, 'MAINTENANT un seul delta leave — transition 1→0 réelle')
    assert.equal(engine.presence(undefined).some(p => p.id === 'alice'), false)
  })

  it('présence GLOBALE : identité présente LOCALEMENT et sur un process distant — le départ distant ne publie rien', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    const local = fakeClient('local-1')
    ;(local as any).identity = { id: 'bob' }
    engine.onWelcome(local)                                      // bob présent LOCALEMENT
    engine.applyRemotePresence(undefined, 'p1', 'join', 'bob', {})  // bob AUSSI présent via p1

    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, undefined)
    sent.length = 0

    engine.applyRemotePresence(undefined, 'p1', 'leave', 'bob')   // p1 part — bob reste local
    const leaveFrames = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'bob')
    assert.equal(leaveFrames.length, 0, 'faux départ évité — bob est toujours là localement')
  })

  it('présence DE SALON : même garantie que la globale', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    engine.applyRemotePresence('salle-1', 'p1', 'join', 'alice', {})
    engine.applyRemotePresence('salle-1', 'p2', 'join', 'alice', {})

    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, 'salle-1')
    sent.length = 0

    engine.applyRemotePresence('salle-1', 'p1', 'leave', 'alice')
    const leaveFrames = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames.length, 0, 'aucun faux départ de salon — alice reste présente via p2')
  })

  it('bail expiré (purgeRemoteProcess) : ne publie un leave que si l\'identité ne reste présente NULLE PART ailleurs', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    engine.applyRemotePresence(undefined, 'p1', 'join', 'alice', {})
    engine.applyRemotePresence(undefined, 'p2', 'join', 'alice', {})

    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, undefined)
    sent.length = 0

    engine.purgeRemoteProcess('p1')   // p1 meurt — p2 reste vivant, alice toujours là via p2
    const leaveFrames = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames.length, 0, 'bail p1 expiré mais alice reste présente via p2 — aucun faux départ')

    engine.purgeRemoteProcess('p2')   // p2 meurt aussi — plus aucune source
    const leaveFrames2 = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames2.length, 1, 'plus aucune source vivante — départ réel, publié')
  })

  it('présence GLOBALE : alice déjà présente via p1 (distant) — une connexion LOCALE qui arrive ensuite n\'émet aucun second join', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    engine.applyRemotePresence(undefined, 'p1', 'join', 'alice', {})   // alice déjà là via p1

    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, undefined)
    sent.length = 0

    const local = fakeClient('local-1')
    ;(local as any).identity = { id: 'alice' }
    engine.onWelcome(local)   // alice rejoint EN LOCAL — la vue fusionnée était déjà à 1 (via p1)

    const joinFrames = sent.filter(x => x.f?.p?.op === 'join' && x.f?.p?.id === 'alice')
    assert.equal(joinFrames.length, 0, 'aucun join — alice était déjà visible ailleurs (p1), pas une transition 0→1 fusionnée')
  })

  it('présence GLOBALE : alice présente LOCALEMENT et via p1 — le départ LOCAL ne publie rien tant que p1 reste', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    const local = fakeClient('local-1')
    ;(local as any).identity = { id: 'alice' }
    engine.onWelcome(local)                                         // alice présente LOCALEMENT (1re connexion)
    engine.applyRemotePresence(undefined, 'p1', 'join', 'alice', {})  // alice AUSSI présente via p1

    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, undefined)
    sent.length = 0

    engine.onDisconnect(local)   // alice se déconnecte EN LOCAL — elle reste là via p1
    const leaveFrames = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames.length, 0, 'aucun leave — alice reste présente ailleurs (p1)')

    engine.applyRemotePresence(undefined, 'p1', 'leave', 'alice')   // p1 part aussi — plus aucune source
    const leaveFrames2 = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames2.length, 1, 'maintenant un seul leave — transition 1→0 réelle')
  })

  it('présence DE SALON : même garantie pour une connexion LOCALE qui rejoint après une présence distante déjà connue', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    engine.applyRemotePresence('salle-1', 'p1', 'join', 'alice', {})

    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, 'salle-1')
    sent.length = 0

    const local = fakeClient('local-1')
    ;(local as any).identity = { id: 'alice' }
    await engine.handleJoin(local, 'salle-1')   // alice rejoint le salon EN LOCAL — déjà visible via p1

    const joinFrames = sent.filter(x => x.f?.p?.op === 'join' && x.f?.p?.id === 'alice')
    assert.equal(joinFrames.length, 0, 'aucun join de salon — alice était déjà visible ailleurs (p1)')
  })

  it('ordre inverse — local d\'abord puis distant : pas de second join, la présence tient après le départ distant', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({} as any, (c, f) => sent.push({ c, f }), () => {})
    const sub = fakeClient('sub1')
    await engine.handleSubPresence(sub, undefined)
    sent.length = 0

    const local = fakeClient('local-1')
    ;(local as any).identity = { id: 'alice' }
    engine.onWelcome(local)   // local d'abord — vraie transition 0→1, UN join attendu
    const joinFrames1 = sent.filter(x => x.f?.p?.op === 'join' && x.f?.p?.id === 'alice')
    assert.equal(joinFrames1.length, 1, 'premier join réel — transition 0→1')

    engine.applyRemotePresence(undefined, 'p1', 'join', 'alice', {})   // puis distant — déjà visible localement
    const joinFrames2 = sent.filter(x => x.f?.p?.op === 'join' && x.f?.p?.id === 'alice')
    assert.equal(joinFrames2.length, 1, 'toujours un seul join — le distant ne rejoue rien')

    engine.applyRemotePresence(undefined, 'p1', 'leave', 'alice')   // distant part — local reste
    const leaveFrames = sent.filter(x => x.f?.p?.op === 'leave' && x.f?.p?.id === 'alice')
    assert.equal(leaveFrames.length, 0, 'aucun leave — alice reste présente localement')
  })
})
