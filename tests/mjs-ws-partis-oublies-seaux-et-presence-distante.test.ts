// MJS-WS — ce qu'un visiteur parti laisse dans la mémoire du serveur, compté table par table :
// - les seaux de débit d'un salon qui ne se vide jamais (la page d'accueil) : discussion, frappe, curseurs, réactions et suivi
//   gardaient une entrée par visiteur passé, à vie (sans compte, un id par connexion) ; un seau redevenu plein vaut un neuf, il part,
//   et un seau entamé reste, même balayé ;
// - la présence distante (grappe) : l'autre processus gardait une table par nom de salon quitté, à vie ;
// - en grappe, la clé du compteur d'un flux détruit reste dans l'adaptateur : à supprimer soi-même ;
// - le muet d'un visiteur sans compte tombe à sa reconnexion (un id par connexion).
// Toute table (Map, Set) qui reçoit une clé marquée est suivie ; clients bruts sur MemoryTransport, horloge pilotée (Date.now).
import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { mjsWs, MemoryAdapter, createMemoryAdapterBus, chatPackage, cursorsPackage, reactionsPackage, followPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const MARQUE  = 'passant'
const vraiNow = Date.now
let maintenant = vraiNow()

interface Brut { trames: any[]; envoyer(t: string, p?: unknown): void; requete(t: string, p?: unknown): Promise<any>; fermer(): void }

let idRequete = 0
async function brut(transport: MemoryTransport, uid?: string): Promise<Brut> {
  const s: any = transport.connect({})
  const attentes = new Map<number, (m: any) => void>()
  let accueil = () => {}
  const accueilli = new Promise<void>(ok => { accueil = ok })
  const b: Brut = {
    trames: [],
    envoyer(t, p) { s.send(JSON.stringify({ t, p })) },
    requete(t, p) {
      const id = ++idRequete
      return new Promise((ok, ko) => {
        const minuterie = setTimeout(() => ko(new Error('sans accusé : ' + t)), 5000)
        attentes.set(id, m => { clearTimeout(minuterie); attentes.delete(id); ok(m) })
        s.send(JSON.stringify({ t, p, id }))
      })
    },
    fermer() { s.close() }
  }
  s.onmessage = (ev: any) => {
    const m = JSON.parse(ev.data)
    b.trames.push(m)
    if (m.t === 'µ:welcome') accueil()
    if (m.t === 'µ:ack') attentes.get(m.id)?.(m)
  }
  await new Promise(r => setImmediate(r))
  b.envoyer('µ:hello', { protocol: 1, ...(uid ? { auth: { uid } } : {}) })
  await accueilli
  return b
}

// toute table qui reçoit une clé marquée est suivie ; `restes()` compte celles qui en gardent encore une
function suivreLesTables(): { restes(): Array<{ n: number, exemple: string }>, arreter(): void } {
  const suivies: Array<WeakRef<Map<any, any> | Set<any>>> = []
  const vues    = new WeakSet<object>()
  const mapSet  = Map.prototype.set
  const setAdd  = Set.prototype.add
  const noter = (table: any): void => { if (!vues.has(table)) { vues.add(table); suivies.push(new WeakRef(table)) } }
  Map.prototype.set = function (this: Map<any, any>, k: any, v: any) { if (typeof k === 'string' && k.includes(MARQUE)) noter(this); return mapSet.call(this, k, v) } as any
  Set.prototype.add = function (this: Set<any>, k: any) { if (typeof k === 'string' && k.includes(MARQUE)) noter(this); return setAdd.call(this, k) } as any
  return {
    restes() {
      const out: Array<{ n: number, exemple: string }> = []
      for (const ref of suivies) {
        const table = ref.deref()
        if (!table) continue
        let n = 0
        let exemple = ''
        for (const k of table.keys()) if (typeof k === 'string' && k.includes(MARQUE)) { n++; exemple ||= k }
        if (n > 0) out.push({ n, exemple })
      }
      return out
    },
    arreter() { Map.prototype.set = mapSet; Set.prototype.add = setAdd }
  }
}

const LIMITES = { rate: 100000, burst: 100000, kickAfter: 100000 } as any
const auth    = (h: any) => (h.auth?.uid ? { id: h.auth.uid, name: h.auth.uid, role: h.auth.uid === 'moderateur' ? 'admin' : undefined } : {})

describe('MJS-WS — un visiteur parti ne laisse rien dans les tables du serveur', function () {
  this.timeout(120000)
  beforeEach(() => { maintenant = vraiNow(); Date.now = () => maintenant })
  afterEach(() => { Date.now = vraiNow })

  it('salon habité : 60 visiteurs partis, 0 seau gardé (discussion, frappe, curseurs, réactions, suivi) ; un seau entamé reste', async () => {
    const tables    = suivreLesTables()
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, ban: false, onLog: () => {}, auth, limits: LIMITES })
    app.use(chatPackage({ onLog: () => {} }))
    app.use(cursorsPackage())
    app.use(reactionsPackage())
    app.use(followPackage({ canLead: () => true }))
    await app.listen()
    const SALONS = ['chat:general', 'cursors:home', 'reactions:home', 'follow:home']
    try {
      const resident = await brut(transport, 'resident')
      for (const room of SALONS) resident.envoyer('µ:join', { room })
      await resident.requete('chat:me')
      for (let i = 0; i < 60; i++) {
        const v = await brut(transport, `${MARQUE}-u${i}`)
        for (const room of SALONS) v.envoyer('µ:join', { room })
        v.envoyer('chat:send', { room: 'general', text: 'bonjour ' + i })
        v.envoyer('chat:typing', { room: 'general' })
        v.envoyer('cursors:move', { room: 'home', p: { a: [0], x: 0.5, y: 0.5 } })
        v.envoyer('reactions:send', { room: 'home', e: '👍' })
        v.envoyer('follow:at', { room: 'home', a: [0], y: 0 })
        v.envoyer('follow:cursor', { room: 'home', p: { a: [0], x: 0.5, y: 0.5 } })
        await v.requete('follow:last', { room: 'home' })
        await v.requete('chat:me')
        v.fermer()
      }
      // un membre qui a vidé son seau le garde, même balayé : le balayage ne rend aucun jeton
      const gourmand = await brut(transport, 'gourmand')
      gourmand.envoyer('µ:join', { room: 'chat:general' })
      for (let i = 0; i < 6; i++) gourmand.envoyer('chat:send', { room: 'general', text: 'vite ' + i })
      await gourmand.requete('chat:me')
      for (let i = 0; i < 60; i++) resident.envoyer('chat:send', { room: 'general', text: 'balai ' + i })
      await resident.requete('chat:me')
      gourmand.envoyer('chat:send', { room: 'general', text: 'encore' })
      await gourmand.requete('chat:me')
      const refus = gourmand.trames.filter(m => m.t === 'µ:error' && /chat-rate/.test(JSON.stringify(m.p))).length
      assert.equal(refus, 2, 'le sixième message et celui d\'après le balayage sont refusés')
      // les seaux des partis se remplissent ; les balayages se font au fil des demandes du résident
      maintenant += 10 * 60 * 1000
      for (let k = 0; k < 450; k++) {
        maintenant += 1000
        resident.envoyer('chat:typing', { room: 'general' })
        resident.envoyer('cursors:move', { room: 'home', p: null })
        resident.envoyer('reactions:send', { room: 'home', e: '👍' })
        resident.envoyer('follow:at', { room: 'home', a: [0], y: 0 })
        resident.envoyer('follow:cursor', { room: 'home', p: null })
        if (k % 5 === 4) await resident.requete('follow:last', { room: 'home' })
      }
      await resident.requete('chat:me')
      await tick(20)
      gc(); await tick(10); gc()
      const restes = tables.restes()
      console.log(`      tables qui gardent un visiteur parti : ${restes.length}${restes.map(r => ` (${r.n}, ex. ${r.exemple})`).join('')}`)
      assert.equal(restes.length, 0, `${restes.length} table(s) gardent des visiteurs partis`)
    } finally {
      tables.arreter()
      await app.stop()
    }
  })

  it('grappe : 360 salons quittés sur un processus, 0 table de présence gardée sur l\'autre ; la clé du compteur d\'un flux détruit reste', async () => {
    const tables = suivreLesTables()
    const bus    = createMemoryAdapterBus()
    const apps   = [0, 1].map(() => {
      const transport = new MemoryTransport()
      const adapter   = new MemoryAdapter({ bus })
      return { transport, adapter, app: mjsWs({ transport, heartbeat: 0, ban: false, onLog: () => {}, auth, limits: LIMITES, adapter }) }
    })
    for (const a of apps) { a.app.serve('ping', () => 1); await a.app.listen() }
    try {
      // 60 visiteurs, 6 salons chacun : un sur deux les quitte (µ:leave), tous se déconnectent
      for (let i = 0; i < 60; i++) {
        const v = await brut(apps[0].transport, 'visiteur-' + i)
        for (let j = 0; j < 6; j++) v.envoyer('µ:join', { room: `${MARQUE}-s${i}-${j}` })
        await v.requete('ping')
        if (i % 2) { for (let j = 0; j < 6; j++) v.envoyer('µ:leave', { room: `${MARQUE}-s${i}-${j}` }); await v.requete('ping') }
        v.fermer()
      }
      const temoin = await brut(apps[1].transport, 'temoin')
      await temoin.requete('ping')
      await tick(50)
      gc(); await tick(10); gc()
      const restes = tables.restes()
      console.log(`      tables qui gardent un salon quitté : ${restes.length}${restes.map(r => ` (${r.n}, ex. ${r.exemple})`).join('')}`)
      assert.equal(restes.length, 0, `${restes.length} table(s) gardent des salons quittés`)

      // la numérotation d'un flux vit dans l'adaptateur, sous <prefix>:seq:<flux> : destroy() ne la retire pas
      const cle  = `${apps[0].adapter.prefix}:seq:compteur-du-flux`
      const flux = apps[0].app.stream('compteur-du-flux')
      flux.add('k', 1)
      for (let i = 0; i < 200 && !(bus as any).counters.has(cle); i++) await tick(1)
      flux.destroy()
      await tick(20)
      assert.equal((bus as any).counters.get(cle), 1, 'la clé du compteur reste après destroy()')
    } finally {
      tables.arreter()
      for (const a of apps) await a.app.stop()
    }
  })

  it('le muet d\'un visiteur sans compte tombe à sa reconnexion', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, ban: false, onLog: () => {}, auth, limits: LIMITES })
    app.use(chatPackage({ onLog: () => {}, moderators: (identity: any) => identity?.role === 'admin' }))
    await app.listen()
    try {
      const moderateur = await brut(transport, 'moderateur')
      moderateur.envoyer('µ:join', { room: 'chat:general' })
      await moderateur.requete('chat:me')
      const anonyme = await brut(transport)
      anonyme.envoyer('µ:join', { room: 'chat:general' })
      const moi = (await anonyme.requete('chat:me')).p
      moderateur.envoyer('chat:mute', { room: 'general', identityId: moi.id, durationMs: 60 * 60 * 1000 })
      await moderateur.requete('chat:me')
      anonyme.envoyer('chat:send', { room: 'general', text: 'avant reconnexion' })
      await anonyme.requete('chat:me')
      assert.ok(anonyme.trames.some(m => m.t === 'µ:error' && /chat-muted/.test(JSON.stringify(m.p))), 'muet tant que la connexion dure')
      anonyme.fermer()
      const revenu = await brut(transport)
      revenu.envoyer('µ:join', { room: 'chat:general' })
      revenu.envoyer('chat:send', { room: 'general', text: 'après reconnexion' })
      await revenu.requete('chat:me')
      await moderateur.requete('chat:me')
      assert.ok(moderateur.trames.some(m => m.t === 'chat:message' && /après reconnexion/.test(JSON.stringify(m.p))), 'reconnecté, il parle de nouveau')
    } finally {
      await app.stop()
    }
  })
})
