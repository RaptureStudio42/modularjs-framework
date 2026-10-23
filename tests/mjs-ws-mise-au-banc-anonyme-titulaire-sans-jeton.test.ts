// Mise au banc avec le paquet comptes : trois expulsions d'un anonyme mettaient au banc son adresse pour les connexions
// anonymes. Or un titulaire SANS jeton (autre poste, salle informatique, jeton expiré) se connecte par un hello anonyme,
// puis `account:login` : il était refusé pendant 5 minutes, contrairement à ce que dit la doc (« un compte de la même
// adresse reste bienvenu »). Le hello anonyme d'une adresse au banc est maintenant accueilli, mais réduit au paquet
// comptes (se connecter, créer un compte) : tout le reste lui est refusé jusqu'à la connexion au compte. Sans paquet
// comptes, rien ne change : le hello anonyme est refusé
import assert from 'node:assert/strict'
import { mjsWs, accountsPackage, accountsAuth } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const SECRET = 'secret-de-test-du-banc-des-comptes-assez-long'
const IP     = '10.0.0.9'
const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

class TransportAvecAdresse extends MemoryTransport {
  onConnection(handler: Parameters<MemoryTransport['onConnection']>[0]): void {
    super.onConnection((conn) => { (conn.remoteInfo as any).address = conn.remoteInfo.headers?.['x-ip']; handler(conn) })
  }
}

interface Poste { trames: any[]; ferme: boolean; envoyer: (o: unknown) => void; brut: (s: string) => void }

async function arriver(transport: MemoryTransport, ip: string, auth?: unknown): Promise<{ poste: Poste; accueil: any }> {
  const ws = transport.connect({ headers: { 'x-ip': ip } })
  const poste: Poste = { trames: [], ferme: false, envoyer: (o) => ws.send(JSON.stringify(o)), brut: (s) => ws.send(s) }
  ws.onmessage = (ev: any) => poste.trames.push(JSON.parse(ev.data))
  ws.onclose   = () => { poste.ferme = true }
  await tick()
  poste.envoyer({ t: 'µ:hello', p: { protocol: 1, auth } })
  return { poste, accueil: await attendre(poste, f => f.t === 'µ:welcome' || f.t === 'µ:denied') }
}

async function attendre(poste: Poste, pred: (f: any) => boolean, ms = 10000): Promise<any> {
  const debut = Date.now()
  for (;;) {
    const i = poste.trames.findIndex(pred)
    if (i >= 0) return poste.trames.splice(i, 1)[0]
    if (Date.now() - debut > ms) throw new Error('trame attendue jamais reçue')
    await tick(1)
  }
}

let numero = 0
async function requete(poste: Poste, t: string, p: unknown): Promise<any> {
  const id = ++numero
  poste.envoyer({ t, p, id })
  return attendre(poste, f => f.t === 'µ:ack' && f.id === id)
}

// trois expulsions d'un anonyme de l'adresse IP (messages invalides en série)
async function troisExpulsions(transport: MemoryTransport): Promise<void> {
  for (let k = 0; k < 3; k++) {
    const { poste, accueil } = await arriver(transport, IP)
    assert.equal(accueil.t, 'µ:welcome', 'accueilli avant la rafale')
    for (let i = 0; i < 51; i++) poste.brut('{pas du json')
    for (let i = 0; i < 300 && !poste.ferme; i++) await tick(2)
    assert.ok(poste.ferme, 'expulsé')
  }
}

async function demarrer(par: 'account' | 'both', avecComptes: boolean): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new TransportAvecAdresse()
  const app = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), ban: { by: par }, onLog: () => {} })
  if (avecComptes) app.use(accountsPackage({ secret: SECRET, onLog: () => {} }))
  app.serve('profil:voir', () => ({ ok: true }))
  await app.listen()
  return { transport, app }
}

describe('MJS-WS — mise au banc d’une adresse pour la faute d’un anonyme : le titulaire sans jeton se connecte encore', function () {
  this.timeout(30000)

  for (const par of ['account', 'both'] as const) {
    it(`ban.by '${par}' : hello anonyme accueilli, account:login accepté, tout le reste refusé ; avec le jeton, accueil complet`, async () => {
      const { transport, app } = await demarrer(par, true)
      try {
        const { poste: p0 } = await arriver(transport, '10.0.0.50')
        assert.equal(typeof (await requete(p0, 'account:create', { name: 'professeur', secret: 'motdepasseprof' })).p.token, 'string')
        await troisExpulsions(transport)

        const { poste, accueil } = await arriver(transport, IP)
        assert.equal(accueil.t, 'µ:welcome', 'titulaire sans jeton, même adresse : ' + JSON.stringify(accueil.p))
        const refus = await requete(poste, 'profil:voir', {})
        assert.equal(refus.e, true, 'un autre message est refusé')
        assert.match(String(refus.p), /banc/)
        poste.envoyer({ t: 'µ:join', p: { room: 'classe' } })
        const erreur = await attendre(poste, f => f.t === 'µ:error')
        assert.match(String(erreur.p?.message), /banc/)
        assert.equal(app.room('classe').size, 0, 'aucun salon rejoint')
        const login = await requete(poste, 'account:login', { name: 'professeur', secret: 'motdepasseprof' })
        assert.equal(login.e, undefined, 'account:login : ' + login.p)

        const { poste: avecJeton, accueil: accueil2 } = await arriver(transport, IP, { token: login.p.token })
        assert.equal(accueil2.t, 'µ:welcome', 'avec le jeton reçu')
        assert.equal((await requete(avecJeton, 'profil:voir', {})).e, undefined, 'accueil complet avec le jeton')
      } finally {
        await app.stop()
      }
    })
  }

  it('sans paquet comptes : le hello anonyme d’une adresse au banc reste refusé', async () => {
    const { transport, app } = await demarrer('account', false)
    try {
      await troisExpulsions(transport)
      const { accueil } = await arriver(transport, IP)
      assert.equal(accueil.t, 'µ:denied')
    } finally {
      await app.stop()
    }
  })
})
