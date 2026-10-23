// client brut des tests du paquet comptes : trames JSON écrites à la main sur MemoryTransport, sans
// le client µ.socket — les essais simultanés et les adresses distinctes restent ainsi lisibles
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { mjsWs, accountsPackage, accountsAuth } from '../../src/mjs-ws/index.js'
import { MemoryTransport } from '../../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../../src/mjs-ws/index.js'
import type { MjsWsAccountsOptions } from '../../src/mjs-ws/accounts.js'

export const SECRET_JETONS = 'secret-de-test-des-comptes-assez-long'

// MemoryTransport ne pose jamais d'adresse : celui-ci lit l'en-tête x-adresse, pour éprouver les
// limites comptées par adresse
export class TransportAvecAdresse extends MemoryTransport {
  onConnection(handler: Parameters<MemoryTransport['onConnection']>[0]): void {
    super.onConnection(conn => {
      const adresse = conn.remoteInfo.headers?.['x-adresse']
      if (typeof adresse === 'string') conn.remoteInfo.address = adresse
      handler(conn)
    })
  }
}

export interface LigneJournal { niveau: string; message: string; meta?: unknown }

export async function demarrer(opts: Partial<MjsWsAccountsOptions> = {}, transport: MemoryTransport = new MemoryTransport()): Promise<{ transport: MemoryTransport; app: MjsWsApp; journal: LigneJournal[] }> {
  const journal: LigneJournal[] = []
  const app = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET_JETONS), onLog: () => {} })
  app.use(accountsPackage({ secret: SECRET_JETONS, onLog: (niveau, message, meta) => { journal.push({ niveau, message, meta }) }, ...opts } as MjsWsAccountsOptions))
  await app.listen()
  return { transport, app, journal }
}

export interface ClientBrut { trames: any[]; brut: string[]; envoyer(o: unknown): void }

export async function attendreTrame(c: ClientBrut, pred: (m: any) => boolean, ms = 10000): Promise<any> {
  const debut = Date.now()
  for (;;) {
    const i = c.trames.findIndex(pred)
    if (i >= 0) return c.trames.splice(i, 1)[0]
    if (Date.now() - debut > ms) throw new Error('trame attendue jamais reçue')
    await new Promise<void>(r => setTimeout(r, 1))
  }
}

// connexion anonyme, hello compris — `adresse` n'a d'effet qu'avec TransportAvecAdresse
export async function connecter(transport: MemoryTransport, adresse?: string): Promise<ClientBrut> {
  const s = transport.connect(adresse ? { headers: { 'x-adresse': adresse } } : {})
  const c: ClientBrut = { trames: [], brut: [], envoyer(o) { s.send(JSON.stringify(o)) } }
  s.onmessage = (ev: any) => { c.brut.push(String(ev.data)); c.trames.push(JSON.parse(String(ev.data))) }
  await new Promise<void>(r => setTimeout(r, 0))
  c.envoyer({ t: 'µ:hello', p: { protocol: 1 } })
  await attendreTrame(c, m => m.t === 'µ:welcome')
  return c
}

let numero = 0

// requête → son accusé µ:ack ; un refus porte `e: true` et le code en `p`
export async function requete(c: ClientBrut, type: string, p: unknown, ms = 30000): Promise<any> {
  const id = ++numero
  c.envoyer({ t: type, p, id })
  return attendreTrame(c, m => m.t === 'µ:ack' && m.id === id, ms)
}

// compte les appels à crypto.scrypt pendant `corps` — l'import nommé du paquet suit la
// substitution grâce à syncBuiltinESMExports ; l'original revient même si `corps` lève
export async function compterScrypt<T>(corps: (appels: () => number) => Promise<T>): Promise<T> {
  const crypto = createRequire(import.meta.url)('node:crypto')
  const original = crypto.scrypt
  let n = 0
  crypto.scrypt = function(this: unknown, ...args: unknown[]) { n++; return original.apply(this, args) }
  syncBuiltinESMExports()
  try {
    return await corps(() => n)
  } finally {
    crypto.scrypt = original
    syncBuiltinESMExports()
  }
}
