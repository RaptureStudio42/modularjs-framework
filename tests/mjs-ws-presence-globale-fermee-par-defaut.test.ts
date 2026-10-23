// La présence globale (qui est connecté au serveur : µ:sub-presence sans salon) est fermée par défaut, comme celle des
// salons : la demander vaut un refus clair (µ:error, code 'presence-denied', sans salon, en français et en anglais),
// jamais la liste ni les arrivées. mjsWs({ presence: 'public' }) l'ouvre à tous les clients. Avant, tout client, même
// sans compte, lisait qui était connecté, avec sa méta
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t, setMessagesLang } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function demarrer(ouverte = false) {
  const transport = new MemoryTransport()
  const app = mjsWs({
    transport, heartbeat: 0, onLog: () => {}, auth: (hello: any) => hello.auth,
    rooms: { meta: (c: any) => ({ pseudo: c.identity?.pseudo }) },
    ...(ouverte ? { presence: 'public' as const } : {}),
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
  const envoyer  = async (type: string, p: unknown) => { ws.send(JSON.stringify({ t: type, p })); await tick(5) }
  const globales = () => trames.filter(f => f.t === 'µ:presence' && f.p?.room === undefined).map(f => f.p)
  const salon    = (room: string) => trames.filter(f => f.t === 'µ:presence' && f.p?.room === room).map(f => f.p)
  const erreurs  = () => trames.filter(f => f.t === 'µ:error').map(f => f.p)
  const fermer   = async () => { ws.close(); await tick(5) }
  return { trames, envoyer, globales, salon, erreurs, fermer }
}

describe('MJS-WS — présence globale : fermée par défaut', () => {
  afterEach(() => setMessagesLang('fr'))

  it('la demander vaut un refus clair (code presence-denied, sans salon), jamais la liste ni les arrivées', async () => {
    const { transport, app } = await demarrer()
    const zora = await visiteur(transport, '1', 'Zora')
    await zora.envoyer('µ:sub-presence', {})
    const theo = await visiteur(transport, '2', 'Theo')
    await theo.fermer()
    assert.deepEqual(zora.globales(), [], 'ni la liste, ni les arrivées, ni les départs')
    assert.deepEqual(zora.erreurs(), [{ message: t('ws.rooms.presence-globale-fermee'), code: 'presence-denied' }])
    await app.stop()
  })

  it('le refus se lit en français, au vouvoiement, et en anglais, avec la ligne qui l\'ouvre', async () => {
    assert.match(t('ws.rooms.presence-globale-fermee'), /présence globale.*ouvrez-la.*mjsWs\(\{ presence: 'public' \}\)/)
    setMessagesLang('en')
    const { transport, app } = await demarrer()
    const theo = await visiteur(transport, '2', 'Theo')
    await theo.envoyer('µ:sub-presence', {})
    assert.equal(theo.erreurs()[0]?.message, t('ws.rooms.presence-globale-fermee'))
    assert.match(theo.erreurs()[0]?.message ?? '', /global presence.*mjsWs\(\{ presence: 'public' \}\)/)
    await app.stop()
  })

  it('presence: \'public\' l\'ouvre à tous : la liste, puis les arrivées et les départs', async () => {
    const { transport, app } = await demarrer(true)
    const zora = await visiteur(transport, '1', 'Zora')
    await zora.envoyer('µ:sub-presence', {})
    const theo = await visiteur(transport, '2', 'Theo')
    await theo.fermer()
    assert.deepEqual(zora.globales(), [
      { op: 'reset', peers: { 1: { pseudo: 'Zora' } } },
      { op: 'join', id: '2', meta: { pseudo: 'Theo' } },
      { op: 'leave', id: '2' },
    ])
    assert.deepEqual(zora.erreurs(), [])
    await app.stop()
  })

  it('la présence d\'un salon n\'en dépend pas : ses membres la reçoivent, présence globale fermée', async () => {
    const { transport, app } = await demarrer()
    const zora = await visiteur(transport, '1', 'Zora')
    await zora.envoyer('µ:join', { room: 'partie' })
    await zora.envoyer('µ:sub-presence', { room: 'partie' })
    assert.deepEqual(zora.salon('partie'), [{ room: 'partie', op: 'reset', peers: { 1: { pseudo: 'Zora' } } }])
    assert.deepEqual(zora.erreurs(), [])
    await app.stop()
  })
})
