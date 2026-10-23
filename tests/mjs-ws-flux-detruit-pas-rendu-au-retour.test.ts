// Une connexion qui revient dans un salon retrouve les flux qu'elle a perdus en partant. Un flux détruit (`destroy()`)
// pendant son absence lui était quand même « rendu » : un instantané vide et un avertissement « flux non déclaré » dans le
// journal, pour une demande que le client n'a jamais faite. Détruit, un flux redevient comme s'il n'avait jamais existé :
// rien n'est rendu, rien n'est journalisé ; un flux recréé sous le même nom est rendu
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function essai(recree: boolean): Promise<{ frames: any[]; journal: string[] }> {
  const transport = new MemoryTransport()
  const journal: string[] = []
  const app = mjsWs({ transport, heartbeat: 0, onLog: (niveau, message) => journal.push(niveau + ' ' + message) })
  const partie = app.stream('partie-7', { room: 'partie-7' })
  await app.listen()
  try {
    const ws = transport.connect({ url: 'ws://joueur/' })
    const trames: any[] = []
    ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
    const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
    await tick()
    envoyer('µ:hello', { protocol: 1 })
    await tick(10)
    envoyer('µ:join', { room: 'partie-7' })
    envoyer('µ:sub-stream', { stream: 'partie-7' })
    await tick(20)
    envoyer('µ:leave', { room: 'partie-7' })
    await tick(10)
    partie.destroy()
    if (recree) app.stream('partie-7', { room: 'partie-7' }).add('manche', 2)
    journal.length = 0
    const avant = trames.length
    envoyer('µ:join', { room: 'partie-7' })
    await tick(30)
    return { frames: trames.slice(avant).filter(f => f.t === 'partie-7'), journal: journal.filter(l => l.includes('partie-7')) }
  } finally {
    await app.stop()
  }
}

describe('MJS-WS — flux détruit pendant l’absence : rien de rendu au retour dans le salon', function () {
  this.timeout(10000)

  it('détruit : aucune trame, aucun avertissement', async () => {
    const { frames, journal } = await essai(false)
    assert.deepEqual(frames, [], 'aucune trame du flux détruit')
    assert.deepEqual(journal, [], 'aucun avertissement')
  })

  it('recréé sous le même nom : rendu avec son état', async () => {
    const { frames } = await essai(true)
    assert.deepEqual(frames.map(f => f.p), [{ op: 'reset', values: { manche: 2 } }])
  })
})
