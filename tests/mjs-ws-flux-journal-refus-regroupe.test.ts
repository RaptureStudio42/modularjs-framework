// Un µ:sub-stream / µ:resync vers un flux inconnu ou refusé n'écrit plus une ligne d'avertissement par trame avec le
// nom envoyé : une ligne au plus par minute et par motif, nom tronqué, les suivantes comptées et annoncées par la ligne
// d'après. Avant, une seule connexion anonyme écrivait 2,4 Mo de journal par seconde avec des noms de 60 000 caractères.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function demarrer(): Promise<{ app: ReturnType<typeof mjsWs>; avertissements: string[]; envoyer: (t: string, p: unknown) => void }> {
  const transport = new MemoryTransport()
  const avertissements: string[] = []
  const app = mjsWs({ transport, heartbeat: 0, onLog: (level, message) => { if (level === 'warn') avertissements.push(message) } })
  app.stream('prive', { canSubscribe: () => false })
  await app.listen()
  const ws = transport.connect({ url: 'ws://visiteur/' })
  ws.onmessage = () => {}
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1, resub: [], rooms: [] })
  await tick()
  return { app, avertissements, envoyer }
}

describe('MJS-WS — flux inconnus ou refusés : journal regroupé, nom tronqué', function () {
  this.timeout(10000)

  it('60 demandes vers des flux inconnus aux noms géants : une seule ligne, courte', async () => {
    const { app, avertissements, envoyer } = await demarrer()
    const nom = 'x'.repeat(60000)
    for (let i = 0; i < 60; i++) {
      if (i % 2) envoyer('µ:sub-stream', { stream: nom + i })
      else envoyer('µ:resync', { stream: nom + i, from: 0 })
    }
    await tick(50)
    const caracteres = avertissements.reduce((s, l) => s + l.length, 0)
    assert.equal(avertissements.length, 1, 'une ligne pour toute la rafale : ' + avertissements.length)
    assert.ok(caracteres < 1000, 'ligne courte, nom tronqué : ' + caracteres + ' caractères')
    await app.stop()
  })

  it('demandes refusées par la garde : une ligne ; passé la minute, la suivante annonce combien ont été tues', async () => {
    const { app, avertissements, envoyer } = await demarrer()
    for (let i = 0; i < 20; i++) envoyer('µ:sub-stream', { stream: 'prive' })
    await tick(30)
    assert.equal(avertissements.length, 1)
    assert.ok(avertissements[0].includes('prive'))

    const maintenant = Date.now
    Date.now = () => maintenant() + 61000
    try {
      envoyer('µ:sub-stream', { stream: 'prive' })
      await tick(30)
    }
    finally { Date.now = maintenant }
    assert.equal(avertissements.length, 2)
    assert.ok(avertissements[1].includes('19'), 'les 19 refus tus sont annoncés : ' + avertissements[1])
    await app.stop()
  })
})
