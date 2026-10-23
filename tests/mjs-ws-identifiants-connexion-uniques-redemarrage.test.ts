// serveur seul (ni pont ni adaptateur) : les identifiants de connexion repartaient de `c1` à chaque démarrage. Un siège
// anonyme d'une partie restaurée (gardé sous l'id de connexion de son joueur) était alors repris par la connexion qui
// recevait le même numéro après le redémarrage. Les numéros partent maintenant de l'heure du démarrage, comme les
// identifiants de partie : jamais l'id d'une connexion d'un démarrage précédent
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const index  = pathToFileURL(join(racine, 'src/mjs-ws/index.ts')).href
const memoire = pathToFileURL(join(racine, 'src/mjs-ws/transport.ts')).href

// un démarrage complet dans un processus neuf : une connexion accueillie, son id sur la sortie
const SCRIPT = `
const { mjsWs } = await import(${JSON.stringify(index)})
const { MemoryTransport } = await import(${JSON.stringify(memoire)})
const transport = new MemoryTransport()
const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
await app.listen()
const ws = transport.connect({})
await new Promise(r => setTimeout(r, 0))
const accueil = new Promise(r => { ws.onmessage = ev => { if (JSON.parse(ev.data).t === 'µ:welcome') r() } })
ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
await accueil
console.log(JSON.stringify(Array.from(app.clients, c => c.id)))
await app.stop()
process.exit(0)
`

function demarrer(): string[] {
  const r = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', SCRIPT], { cwd: racine, encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0, 'démarrage : ' + r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop() as string)
}

describe('MJS-WS — serveur seul : identifiants de connexion uniques d’un démarrage à l’autre', function () {
  this.timeout(60000)

  it('deux démarrages successifs ne donnent jamais le même id à leur première connexion', () => {
    const avant    = Date.now()
    const [premier] = demarrer()
    const [second]  = demarrer()
    assert.match(premier, /^c\d+$/, 'format : c suivi d’un nombre')
    assert.match(second, /^c\d+$/, 'format : c suivi d’un nombre')
    assert.notEqual(second, premier, 'le second démarrage ne reprend pas l’id du premier')
    assert.ok(Number(premier.slice(1)) > avant, 'numéro amorcé à l’heure du démarrage')
    assert.ok(Number(second.slice(1)) > Number(premier.slice(1)), 'numéros croissants d’un démarrage à l’autre')
  })
})
