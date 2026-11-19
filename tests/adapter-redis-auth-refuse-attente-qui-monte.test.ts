// Adaptateur Redis (src/mjs-ws/adapter-redis.ts) — un Redis qui accepte la connexion puis refuse le mot de passe (AUTH) : l'attente
// entre deux essais suit le plan de reconnexion (1 s, 2 s, 5 s, 10 s, puis 10 s), comme après une coupure. Elle repartait de 1 s à
// chaque connexion acceptée, avant la poignée de main : un mot de passe faux faisait réessayer chaque seconde, pour toujours.
// Faux Redis TCP sur 127.0.0.1, minuteries pilotées (node:test mock.timers) : on compte les essais et les attentes annoncées.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createServer } from 'node:net'
import { RedisConnection } from '../src/mjs-ws/adapter-redis.js'

const auTour = () => new Promise<void>(r => setImmediate(r))

describe('MJS-WS — adaptateur Redis : mot de passe refusé, l\'attente monte', function () {
  this.timeout(20000)
  afterEach(() => { mock.timers.reset() })

  it('cinq refus d\'AUTH : attentes de 1, 2, 5, 10 puis 10 s, comme après une coupure', async () => {
    let connexions = 0
    const faux = createServer(sock => { connexions++; sock.on('data', () => sock.write('-WRONGPASS invalid username-password pair\r\n')); sock.on('error', () => {}) })
    await new Promise<void>(ok => faux.listen(0, '127.0.0.1', () => ok()))
    const port = (faux.address() as any).port
    mock.timers.enable({ apis: ['setTimeout'] })
    const attentes: number[] = []
    const conn = new RedisConnection({ host: '127.0.0.1', port, password: 'faux', role: 'command', onLog: (_l, m) => { const d = /(\d{4,5})\s*ms/.exec(m); if (d) attentes.push(Number(d[1])) }, onConnected: () => {} })
    try {
      conn.connect()
      for (let essai = 0; essai < 5; essai++) {
        for (let i = 0; i < 20000 && attentes.length <= essai; i++) await auTour()
        assert.ok(attentes.length > essai, `refus nº ${essai + 1} : aucune attente annoncée`)
        mock.timers.tick(attentes[essai])
      }
      console.log(`      ${connexions} connexions acceptées, attentes annoncées : ${JSON.stringify(attentes.slice(0, 5))}`)
      assert.deepEqual(attentes.slice(0, 5), [1000, 2000, 5000, 10000, 10000])
    } finally {
      conn.stop()
      mock.timers.reset()
      await new Promise<void>(ok => faux.close(() => ok()))
    }
  })
})
