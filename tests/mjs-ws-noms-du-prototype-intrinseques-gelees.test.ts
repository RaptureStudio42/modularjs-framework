// Une appli durcie contre la pollution de prototype gèle `Object.prototype` (`Object.freeze`, `node --frozen-intrinsics`, `lockdown()`
// de SES). Le serveur range les identités et les clés de flux, relayées telles quelles, dans des objets ordinaires qu'il construit
// pour l'envoi ; l'affectation `o[k] = v` y levait « Cannot assign to read only property 'constructor' » dès qu'une clé portait le
// nom d'une propriété d'`Object.prototype` (`constructor`, `toString`, `hasOwnProperty`, `valueOf`…) : `snapshot()` d'un flux,
// l'instantané de présence envoyé à un abonné, celui publié aux autres process, l'historique et la grille de MJS-Server. Ces clés
// sont rangées en propriétés propres, sans passer par l'affectation.
//
// Le gel d'`Object.prototype` ne se défait pas : il est joué dans un processus à part.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')

const ENFANT = `
const charger = (f) => import(${JSON.stringify(pathToFileURL(racine).href)} + f)
const { mjsWs } = await charger('/src/mjs-ws/index.ts')
const { MemoryTransport } = await charger('/src/mjs-ws/transport.ts')
const { MemoryAdapter, createMemoryAdapterBus } = await charger('/src/mjs-ws/adapter.ts')
const { createHistory } = await charger('/src/mjs-server/history.ts')
const { createSpace } = await charger('/src/mjs-server/space.ts')
Object.freeze(Object.prototype)
const NOMS = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'ana']
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const propres = (o) => Object.keys(o).sort()
const sortie = {}
async function essai(nom, f) { try { sortie[nom] = await f() } catch (e) { sortie[nom] = 'lève : ' + e.message } }
const bus = createMemoryAdapterBus()
const adapter = new MemoryAdapter({ bus })
const transport = new MemoryTransport()
const app = mjsWs({ transport, adapter, antiEntropy: 40, heartbeat: 0, presence: 'public', auth: (p) => ({ id: p.uid }), onLog: () => {} })
await app.listen()
function visiteur(uid, recus) {
  return new Promise((res) => {
    const ws = transport.connect({ url: 'memory://' + encodeURIComponent(uid) })
    ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); recus.push(m); if (m.t === 'µ:welcome') res(ws) }
    ws.onopen = () => ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, uid } }))
  })
}
// avec un adaptateur, l'écriture d'un flux attend son numéro partagé : l'état se lit au tour suivant
await essai('flux', async () => { const f = app.stream('scores', { public: true }); NOMS.forEach((k, i) => f.add(k, i)); await tick(20); return propres(f.snapshot()) })
const espion = new MemoryAdapter({ bus })
const publies = []
espion.subscribe(adapter.prefix + ':presence:sync', (msg) => { publies.push(msg) })
for (const uid of NOMS) await visiteur(uid, [])
const recus = []
const abonne = await visiteur('bea', recus)
abonne.send(JSON.stringify({ t: 'µ:sub-presence' }))
abonne.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: 'scores' } }))
await tick(150)
const presence = recus.find((m) => m.t === 'µ:presence' && m.p && m.p.op === 'reset')
sortie.presence = presence ? propres(presence.p.peers) : 'aucun instantané : ' + JSON.stringify(recus.map((m) => m.t))
const fluxRecu = recus.find((m) => m.t === 'scores' && m.p && m.p.op === 'reset')
sortie.fluxEnvoye = fluxRecu ? propres(fluxRecu.p.values) : 'aucun instantané du flux : ' + JSON.stringify(recus.map((m) => m.t))
sortie.antiEntropie = publies.length ? propres(publies[publies.length - 1].pairs) : 'rien de publié'
const positions = {}
NOMS.forEach((id, i) => Object.defineProperty(positions, id, { value: { x: i, y: i * 10 }, enumerable: true, writable: true, configurable: true }))
await essai('historique', () => { const h = createHistory(4); h.pousser(1, 1000, positions); return h.rewind(1000, (p) => propres(p)) })
await essai('grille', () => { const g = createSpace(10); NOMS.forEach((id, i) => g.set(id, i, i * 10)); return propres(g._snapshot()) })
await app.stop()
console.log('SORTIE ' + JSON.stringify(sortie))
`

describe('mjs-ws et MJS-Server — Object.prototype gelé : les noms du prototype sont rangés sans lever', function () {
  this.timeout(60000)

  it('flux, présence (abonné et autres process), historique et grille portent ces clés en propriétés propres', () => {
    const script = join(mjsTmp('intrinseques-gelees'), 'enfant.mts')
    writeFileSync(script, ENFANT)
    const r = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: racine, encoding: 'utf8', timeout: 50000 })
    const ligne = (r.stdout || '').split('\n').find(l => l.startsWith('SORTIE '))
    assert.ok(ligne, 'sortie du processus enfant : ' + r.stdout + r.stderr)
    const sortie = JSON.parse(ligne.slice('SORTIE '.length))
    const attendu = ['__proto__', 'ana', 'constructor', 'hasOwnProperty', 'toString', 'valueOf']
    assert.deepEqual(sortie.flux, attendu, 'snapshot() d\'un flux')
    assert.deepEqual(sortie.fluxEnvoye, attendu, 'instantané du flux envoyé à un abonné')
    assert.deepEqual(sortie.presence, [...attendu, 'bea'].sort(), 'instantané de présence envoyé à un abonné')
    assert.deepEqual(sortie.antiEntropie, [...attendu, 'bea'].sort(), 'instantané de présence publié aux autres process')
    assert.deepEqual(sortie.historique, attendu, 'historique de MJS-Server')
    assert.deepEqual(sortie.grille, attendu, 'grille de MJS-Server')
  })
})
