// opts.onDisconnect est du code de l'auteur, appelé par la purge d'une connexion (finalizeCleanup), elle-même lancée par la
// fermeture du transport : s'il lève (ou renvoie une Promise rejetée), l'erreur ne doit ni atteindre le processus (un throw nu
// dans cette microtâche l'abat), ni interrompre la purge, dont dépend le rendez-vous de fermeture que app.stop() attend. Elle
// est journalisée (error, avec le client et l'erreur) et la purge va à son terme. Vérifié avec un serveur MJS-WS nu et avec un
// serveur de parties MJS-Server, dont l'accroche composée appelle celle de l'appli après son propre nettoyage
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { mjsServer } from '../src/mjs-server/index.js'
import { STOP_CLOSE_TIMEOUT_MS } from '../src/mjs-ws/core.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { setMessagesLang } from '../src/messages/index.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

interface LogEntry { level: string; message: string; meta: any }

function makeSocket(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

// serveur MJS-WS nu dont le journal est relevé ; les clients s'authentifient par l'identité qu'ils annoncent
async function startApp(opts: MjsWsOptions): Promise<{ transport: MemoryTransport; app: MjsWsApp; journal: LogEntry[] }> {
  const transport = new MemoryTransport()
  const journal: LogEntry[] = []
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (level, message, meta) => { journal.push({ level, message: String(message), meta }) }, ...opts })
  await app.listen()
  return { transport, app, journal }
}

const lines = (journal: LogEntry[]): string[] => journal.filter(e => e.level === 'error').map(e => e.message)

describe('MJS-WS — opts.onDisconnect qui lève : la purge de la connexion va à son terme', function () {
  this.timeout(10000)
  afterEach(() => setMessagesLang('fr'))

  it('le throw est journalisé (error, nom de l\'accroche, client et erreur) et n\'atteint jamais le processus', async () => {
    await sansChute(async () => {
      const ids: string[] = []
      const { transport, app, journal } = await startApp({ onDisconnect: (c) => { ids.push(c.id); throw new Error('boum-deconnexion') } })
      const sock = makeSocket(transport, 'u1')
      await tick()
      sock._mjs_ws.close(1006, 'coupure simulée')
      await until(() => journal.some(e => e.level === 'error' && e.message.includes('onDisconnect')), 'le throw de onDisconnect est journalisé')
      const entry = journal.find(e => e.level === 'error' && e.message.includes('onDisconnect'))!
      assert.equal(entry.meta.err.message, 'boum-deconnexion')
      assert.match(entry.message, /a levé/)
      assert.ok(entry.message.includes(ids[0]), 'le message doit nommer la connexion ' + ids[0] + ' : ' + entry.message)
      await tick(30)
      sock.destroy()
      await app.stop()
    })
  })

  it('le message est aussi écrit en anglais quand la langue est anglaise', async () => {
    await sansChute(async () => {
      setMessagesLang('en')
      const { transport, app, journal } = await startApp({ onDisconnect: () => { throw new Error('boum-deconnexion') } })
      const sock = makeSocket(transport, 'u1')
      await tick()
      sock._mjs_ws.close(1006, 'coupure simulée')
      await until(() => journal.some(e => e.level === 'error' && e.message.includes('onDisconnect')), 'le throw de onDisconnect est journalisé')
      assert.match(lines(journal).join('\n'), /onDisconnect threw/)
      sock.destroy()
      await app.stop()
    })
  })

  it('la purge va à son terme : app.stop() n\'attend pas le rendez-vous de fermeture du client jusqu\'au délai borné', async () => {
    await sansChute(async () => {
      const { transport, app } = await startApp({ onDisconnect: () => { throw new Error('boum-deconnexion') } })
      makeSocket(transport, 'u1')
      await tick()
      const start = Date.now()
      await app.stop()
      const elapsed = Date.now() - start
      assert.ok(elapsed < STOP_CLOSE_TIMEOUT_MS / 2, `app.stop() a attendu ${elapsed} ms : la fermeture du client n'a pas abouti`)
    })
  })

  it('les statistiques de connexion sont à jour après la fermeture', async () => {
    await sansChute(async () => {
      const { transport, app } = await startApp({ onDisconnect: () => { throw new Error('boum-deconnexion') } })
      const sock = makeSocket(transport, 'u1')
      await tick()
      assert.equal(app.stats().connexions.actives, 1)
      sock._mjs_ws.close(1006, 'coupure simulée')
      await tick(30)
      assert.equal(app.stats().connexions.actives, 0)
      assert.equal(app.stats().connexions.fermees, 1)
      await app.stop()
    })
  })

  it('une Promise rejetée par onDisconnect est journalisée, jamais un rejet non géré', async () => {
    await sansChute(async () => {
      const { transport, app, journal } = await startApp({ onDisconnect: () => Promise.reject(new Error('boum-promesse')) as unknown as void })
      const sock = makeSocket(transport, 'u1')
      await tick()
      sock._mjs_ws.close(1006, 'coupure simulée')
      await until(() => journal.some(e => e.level === 'error' && e.message.includes('onDisconnect') && e.meta?.err?.message === 'boum-promesse'), 'le rejet de onDisconnect est journalisé')
      assert.match(lines(journal).join('\n'), /a rejeté/)
      await tick(30)
      await app.stop()
    })
  })

  it('témoin : un onDisconnect sain est appelé une fois avec le client et la raison, sans rien journaliser en error', async () => {
    await sansChute(async () => {
      const vus: Array<{ id: string; reason: string | undefined }> = []
      const { transport, app, journal } = await startApp({ onDisconnect: (c, reason) => { vus.push({ id: c.id, reason }) } })
      const sock = makeSocket(transport, 'u1')
      await tick()
      sock._mjs_ws.close(1006, 'coupure simulée')
      await tick(30)
      assert.equal(vus.length, 1)
      assert.equal(vus[0].reason, 'coupure simulée')
      assert.deepEqual(lines(journal), [])
      await app.stop()
    })
  })
})

describe('MJS-Server — un onDisconnect d\'appli qui lève ne fait pas tomber un serveur de parties', function () {
  this.timeout(10000)

  it('le siège est marqué déconnecté chez les autres joueurs, le throw est journalisé, le processus ne tombe pas', async () => {
    await sansChute(async () => {
      const transport = new MemoryTransport()
      const journal: LogEntry[] = []
      const app = mjsServer({
        transport, heartbeat: 0, auth: (hello: any) => hello.auth,
        onLog: (level: any, message: any, meta: any) => { journal.push({ level, message: String(message), meta }) },
        onDisconnect: () => { throw new Error('boum-deconnexion') },
      })
      await app.listen()
      app.game('salle', { seats: 2, code: true, state: () => ({}), moves: {}, view: () => ({}) })
      const host   = makeSocket(transport, 'hote')
      const friend = makeSocket(transport, 'ami')
      await tick()
      const created = await host.request('µgame:play', { type: 'salle', code: true })
      await friend.request('µgame:play', { type: 'salle', code: created.code })
      const rosters: any[] = []
      friend.on('µgame:seat', (p: any) => rosters.push(p))
      host._mjs_ws.close(1006, 'coupure simulée')
      await until(() => rosters.some(r => r.seats[0] && r.seats[0].connected === false), 'l\'ami voit le siège de l\'hôte déconnecté')
      await until(() => journal.some(e => e.level === 'error' && e.meta?.err?.message === 'boum-deconnexion'), 'le throw de onDisconnect est journalisé')
      await tick(30)
      friend.destroy()
      await app.stop()
    })
  })
})
