// La présence d'un salon (qui est dedans, avec sa méta) est réservée à ses membres par défaut : un non-membre qui la
// demande reçoit un refus clair (µ:error, code 'presence-denied', le salon nommé, en français et en anglais), jamais la
// liste. app.room(nom, { presence: 'public' }) l'ouvre à tous pour ce salon, la garde rooms.canSeePresence au cas par
// cas ; qui quitte un salon à présence réservée cesse de la voir. Avant, tout client, même anonyme et non membre, lisait
// la présence de n'importe quel salon.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsRoomsOptions } from '../src/mjs-ws/index.js'
import { t, setMessagesLang } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function demarrer(rooms: Partial<MjsWsRoomsOptions> = {}) {
  const transport = new MemoryTransport()
  const app = mjsWs({
    transport, heartbeat: 0, onLog: () => {}, auth: (hello: any) => hello.auth,
    rooms: { meta: (c: any) => ({ pseudo: c.identity?.pseudo }), ...rooms },
  })
  await app.listen()
  return { transport, app }
}

// un client brut : chaque trame reçue est gardée, telle quelle
async function visiteur(transport: MemoryTransport, id: string, pseudo: string) {
  const trames: any[] = []
  const ws: any = transport.connect({ url: 'ws://visiteur/' })
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id, pseudo } } }))
  await tick(5)
  const envoyer = async (type: string, p: unknown) => { ws.send(JSON.stringify({ t: type, p })); await tick(5) }
  const presences = (room: string) => trames.filter(f => f.t === 'µ:presence' && f.p?.room === room).map(f => f.p)
  const erreurs   = () => trames.filter(f => f.t === 'µ:error').map(f => f.p)
  return { trames, envoyer, presences, erreurs }
}

describe('MJS-WS — présence d\'un salon : réservée à ses membres par défaut', () => {
  afterEach(() => setMessagesLang('fr'))

  it('un non-membre qui la demande reçoit un refus clair (code presence-denied, le salon nommé), jamais la liste', async () => {
    const { transport, app } = await demarrer()
    const zora = await visiteur(transport, '1', 'Zora')
    const theo = await visiteur(transport, '2', 'Theo')
    await zora.envoyer('µ:join', { room: 'partie' })
    await theo.envoyer('µ:sub-presence', { room: 'partie' })
    assert.deepEqual(theo.presences('partie'), [], 'aucune liste pour un non-membre')
    assert.deepEqual(theo.erreurs(), [{ message: t('ws.rooms.presence-reservee-aux-membres'), code: 'presence-denied', room: 'partie' }])
    await zora.envoyer('µ:join', { room: 'autre' })
    assert.deepEqual(theo.presences('partie'), [], 'ni les entrées qui suivent')
    await app.stop()
  })

  it('le refus se lit en français, au vouvoiement, et en anglais', async () => {
    assert.match(t('ws.rooms.presence-reservee-aux-membres'), /membres.*rejoignez/)
    setMessagesLang('en')
    const { transport, app } = await demarrer()
    const theo = await visiteur(transport, '2', 'Theo')
    await theo.envoyer('µ:sub-presence', { room: 'partie' })
    assert.equal(theo.erreurs()[0]?.message, t('ws.rooms.presence-reservee-aux-membres'))
    assert.match(theo.erreurs()[0]?.message ?? '', /members only/)
    await app.stop()
  })

  it('un membre la reçoit, puis suit les entrées et les départs', async () => {
    const { transport, app } = await demarrer()
    const zora = await visiteur(transport, '1', 'Zora')
    const theo = await visiteur(transport, '2', 'Theo')
    await zora.envoyer('µ:join', { room: 'partie' })
    await zora.envoyer('µ:sub-presence', { room: 'partie' })
    await theo.envoyer('µ:join', { room: 'partie' })
    await theo.envoyer('µ:leave', { room: 'partie' })
    assert.deepEqual(zora.presences('partie'), [
      { room: 'partie', op: 'reset', peers: { 1: { pseudo: 'Zora' } } },
      { room: 'partie', op: 'join', id: '2', meta: { pseudo: 'Theo' } },
      { room: 'partie', op: 'leave', id: '2' },
    ])
    assert.deepEqual(zora.erreurs(), [])
    await app.stop()
  })

  it('app.room(nom, { presence: \'public\' }) l\'ouvre à tous, pour ce salon seulement', async () => {
    const { transport, app } = await demarrer()
    app.room('hall', { presence: 'public' })
    const zora = await visiteur(transport, '1', 'Zora')
    const theo = await visiteur(transport, '2', 'Theo')
    await zora.envoyer('µ:join', { room: 'hall' })
    await zora.envoyer('µ:join', { room: 'partie' })
    await theo.envoyer('µ:sub-presence', { room: 'hall' })
    assert.deepEqual(theo.presences('hall'), [{ room: 'hall', op: 'reset', peers: { 1: { pseudo: 'Zora' } } }], 'salon ouvert : la liste, sans y entrer')
    await theo.envoyer('µ:sub-presence', { room: 'partie' })
    assert.deepEqual(theo.presences('partie'), [], 'un autre salon reste réservé')
    assert.deepEqual(theo.erreurs(), [{ message: t('ws.rooms.presence-reservee-aux-membres'), code: 'presence-denied', room: 'partie' }])
    await zora.envoyer('µ:leave', { room: 'hall' })
    assert.deepEqual(theo.presences('hall').at(-1), { room: 'hall', op: 'leave', id: '1' }, 'l\'abonné d\'un salon ouvert suit les départs')
    await app.stop()
  })

  it('la garde rooms.canSeePresence décide au cas par cas, membre ou non ; son refus porte le même code', async () => {
    const { transport, app } = await demarrer({ canSeePresence: (_room, client: any) => client.identity?.id !== '3' })
    const zora = await visiteur(transport, '1', 'Zora')
    const theo = await visiteur(transport, '2', 'Theo')
    const ada  = await visiteur(transport, '3', 'Ada')
    await zora.envoyer('µ:join', { room: 'partie' })
    await theo.envoyer('µ:sub-presence', { room: 'partie' })
    assert.deepEqual(theo.presences('partie'), [{ room: 'partie', op: 'reset', peers: { 1: { pseudo: 'Zora' } } }], 'la garde accepte un non-membre')
    await ada.envoyer('µ:join', { room: 'partie' })
    await ada.envoyer('µ:sub-presence', { room: 'partie' })
    assert.deepEqual(ada.presences('partie'), [], 'la garde refuse, même un membre')
    assert.deepEqual(ada.erreurs(), [{ message: t('ws.rooms.acces-presence-refuse'), code: 'presence-denied', room: 'partie' }])
    await app.stop()
  })

  it('qui quitte le salon cesse de voir sa présence : plus aucun delta de ce salon', async () => {
    const { transport, app } = await demarrer()
    const zora = await visiteur(transport, '1', 'Zora')
    const theo = await visiteur(transport, '2', 'Theo')
    const ada  = await visiteur(transport, '3', 'Ada')
    await zora.envoyer('µ:join', { room: 'partie' })
    await theo.envoyer('µ:join', { room: 'partie' })
    await theo.envoyer('µ:sub-presence', { room: 'partie' })
    assert.equal(theo.presences('partie').length, 1, 'membre : la liste')
    await theo.envoyer('µ:leave', { room: 'partie' })
    const avant = theo.presences('partie').length
    await ada.envoyer('µ:join', { room: 'partie' })
    await zora.envoyer('µ:leave', { room: 'partie' })
    assert.equal(theo.presences('partie').length, avant, 'parti : ni l\'arrivée d\'Ada ni le départ de Zora')
    assert.equal(app.stats().salons.abonnesPresence, 0, 'son abonnement est retiré')
    await app.stop()
  })
})
